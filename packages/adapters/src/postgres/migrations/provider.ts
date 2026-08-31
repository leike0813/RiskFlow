import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, relative, sep } from "node:path";

import type { Migration, MigrationProvider } from "kysely/migration";

import { makePersistenceError, type PostgresPersistenceError } from "../pool.js";

export const POSTGRES_MIGRATION_DOMAINS = [
  "platform",
  "engineering-data",
  "knowledge-modeling",
  "risk-identification",
  "risk-assessment",
  "warning-response",
  "review-audit",
  "agent-task",
  "workflow",
  "query-projection",
] as const;

const domainSet = new Set<string>(POSTGRES_MIGRATION_DOMAINS);
const changeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const migrationFilePattern = /^([0-9]{6})_([a-z0-9]+(?:[-_][a-z0-9]+)*)\.(ts|js|mjs|cjs)$/;
const providerSupportFilePattern = /^(provider|run)\.(ts|js|mjs|cjs)$/;

export interface PostgresMigrationModule {
  up: Migration["up"];
  down: NonNullable<Migration["down"]>;
}

export interface PostgresMigrationDescriptor {
  readonly filePath: string;
  readonly domain: string;
  readonly changeId: string;
  readonly sequence: number;
  readonly sequenceText: string;
  readonly migrationName: string;
  readonly module: PostgresMigrationModule;
}

export interface PostgresMigrationProviderOptions {
  migrationRoot: string;
  additionalMigrationRoots?: readonly string[];
  migrationRoots?: readonly string[];
  loadModule?: (filePath: string) => Promise<unknown>;
  moduleLoader?: (filePath: string) => Promise<unknown>;
}

const defaultLoader = async (filePath: string): Promise<unknown> =>
  import(pathToFileURL(filePath).href);

const invalidMigration = (stage: string): PostgresPersistenceError =>
  makePersistenceError("MIGRATION_INVALID", stage);

const sequenceConflict = (stage: string): PostgresPersistenceError =>
  makePersistenceError("MIGRATION_SEQUENCE_CONFLICT", stage);

const findFiles = async (root: string, current = root): Promise<string[]> => {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(root, filePath)));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
};

const validatePath = (root: string, filePath: string) => {
  const relativePath = relative(root, filePath);
  const parts = relativePath.split(sep);
  if (parts.length !== 3) throw invalidMigration("migration.path");
  const [domain, changeId, fileName] = parts;
  if (!domainSet.has(domain ?? "") || !changeIdPattern.test(changeId ?? "")) {
    throw invalidMigration("migration.path");
  }
  const match = migrationFilePattern.exec(fileName ?? "");
  if (!match) throw invalidMigration("migration.filename");
  const sequenceText = match[1];
  const name = match[2];
  if (sequenceText === undefined || name === undefined)
    throw invalidMigration("migration.filename");
  return {
    domain: domain ?? "",
    changeId: changeId ?? "",
    sequenceText,
    sequence: Number(sequenceText),
    name,
  };
};

export class PostgresMigrationProvider implements MigrationProvider {
  readonly #roots: readonly string[];
  readonly #loadModule: (filePath: string) => Promise<unknown>;

  constructor(options: PostgresMigrationProviderOptions) {
    this.#roots = [
      ...new Set([
        options.migrationRoot,
        ...(options.additionalMigrationRoots ?? []),
        ...(options.migrationRoots ?? []),
      ]),
    ];
    this.#loadModule = options.loadModule ?? options.moduleLoader ?? defaultLoader;
  }

  async getDescriptors(): Promise<ReadonlyArray<PostgresMigrationDescriptor>> {
    let files: Array<{ root: string; filePath: string }>;
    try {
      files = (
        await Promise.all(
          this.#roots.map(async (root) =>
            (await findFiles(root)).map((filePath) => ({ root, filePath })),
          ),
        )
      ).flat();
    } catch {
      throw invalidMigration("migration.discovery");
    }

    const structural = files
      .filter(({ root, filePath }) => {
        const relativePath = relative(root, filePath);
        return !(
          relativePath.split(sep).length === 1 && providerSupportFilePattern.test(relativePath)
        );
      })
      .map(({ root, filePath }) => ({
        filePath,
        ...validatePath(root, filePath),
      }));
    const sequences = new Set<number>();
    const names = new Set<string>();
    for (const item of structural) {
      if (sequences.has(item.sequence)) throw sequenceConflict("migration.sequence");
      if (names.has(item.name)) throw sequenceConflict("migration.name");
      sequences.add(item.sequence);
      names.add(item.name);
    }

    const descriptors: PostgresMigrationDescriptor[] = [];
    for (const item of structural.sort((a, b) => a.sequence - b.sequence)) {
      let loaded: unknown;
      try {
        loaded = await this.#loadModule(item.filePath);
      } catch {
        throw invalidMigration("migration.load");
      }
      const candidate =
        typeof loaded === "object" && loaded !== null && "default" in loaded
          ? (loaded as { default?: unknown }).default
          : loaded;
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        !("up" in candidate) ||
        typeof candidate.up !== "function" ||
        !("down" in candidate) ||
        typeof candidate.down !== "function"
      ) {
        throw invalidMigration("migration.exports");
      }
      descriptors.push({
        filePath: item.filePath,
        domain: item.domain,
        changeId: item.changeId,
        sequence: item.sequence,
        sequenceText: item.sequenceText,
        migrationName: `${item.sequenceText}_${item.domain}_${item.changeId}_${item.name}`,
        module: candidate as PostgresMigrationModule,
      });
    }
    return descriptors;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const descriptors = await this.getDescriptors();
    return Object.fromEntries(
      descriptors.map(({ migrationName, module }) => [migrationName, module]),
    );
  }
}

export const createPostgresMigrationProvider = (
  options: PostgresMigrationProviderOptions,
): PostgresMigrationProvider => new PostgresMigrationProvider(options);
