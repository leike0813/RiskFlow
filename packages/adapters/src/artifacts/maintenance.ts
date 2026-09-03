import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  ArtifactHashManifestCommandV1Schema,
  ArtifactHashManifestEntryV1Schema,
  ArtifactHashManifestHeaderV1Schema,
  ArtifactHashManifestTrailerV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactReconcileFindingV1Schema,
  ArtifactReconcileRequestV1Schema,
  ArtifactReconcileSummaryV1Schema,
  ArtifactStoreError,
  ArtifactSweepCommandV1Schema,
  ArtifactSweepResultV1Schema,
  evidenceReferencesSha256,
  makeArtifactError,
  manifestSha256,
  type ArtifactContentIdentityV1,
  type ArtifactHashManifestCommandV1,
  type ArtifactHashManifestEntryV1,
  type ArtifactHashManifestHeaderV1,
  type ArtifactHashManifestTrailerV1,
  type ArtifactManifestV1,
  type ArtifactReconcileFindingV1,
  type ArtifactReconcileRequestV1,
  type ArtifactReconcileSummaryV1,
  type ArtifactSweepCommandV1,
  type ArtifactSweepResultV1,
  type ArtifactMaintenanceV1,
} from "@riskflow/core/artifacts";
import { canonicalJson } from "@riskflow/core/persistence";

import { FilesystemArtifactStore, type ArtifactFailpointV1 } from "./filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "./postgres-artifact-registry.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_PAIR_PATTERN = /^[0-9a-f]{2}$/u;
const encoder = new TextEncoder();

const refKey = (value: ArtifactManifestV1["artifactRef"]): string =>
  `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

const compareRefs = (
  left: ArtifactManifestV1["artifactRef"],
  right: ArtifactManifestV1["artifactRef"],
): number => {
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return (
    compare(left.kind, right.kind) ||
    compare(left.reference.entityId, right.reference.entityId) ||
    compare(left.reference.versionId, right.reference.versionId)
  );
};

const findingKindToCount = (
  kind: ArtifactReconcileFindingV1["kind"],
): keyof ArtifactReconcileSummaryV1["counts"] | undefined => {
  switch (kind) {
    case "complete":
      return "complete";
    case "missing-object":
      return "missingObject";
    case "content-mismatch":
      return "contentMismatch";
    case "manifest-conflict":
      return "manifestConflict";
    case "orphan-object":
      return "orphanObject";
    case "stale-staging":
      return "staleStaging";
    case "quarantined-object":
      return "quarantinedObject";
  }
};

const emptyCounts = (): ArtifactReconcileSummaryV1["counts"] => ({
  complete: 0,
  missingObject: 0,
  contentMismatch: 0,
  manifestConflict: 0,
  orphanObject: 0,
  staleStaging: 0,
  quarantinedObject: 0,
});

const readLines = async function* (
  chunks: AsyncIterable<Uint8Array>,
  contentHash?: ReturnType<typeof createHash>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array))
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "manifest.chunk");
    contentHash?.update(chunk);
    try {
      pending += decoder.decode(chunk, { stream: true });
    } catch {
      throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "manifest.utf8");
    }
    if (pending.length > 2 * 1024 * 1024)
      throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "manifest.line-size");
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.length === 0)
        throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "manifest.empty-line");
      yield line;
    }
  }
  try {
    pending += decoder.decode();
  } catch {
    throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "manifest.utf8");
  }
  if (pending.length > 0) yield pending;
};

const lineBytes = (value: unknown): Uint8Array => encoder.encode(`${canonicalJson(value)}\n`);

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const entryForManifest = (
  manifest: ArtifactManifestV1,
  digest: string,
): ArtifactHashManifestEntryV1 =>
  ArtifactHashManifestEntryV1Schema.parse({
    artifactRef: manifest.artifactRef,
    artifactKind: manifest.artifactKind,
    content: manifest.content,
    mediaType: manifest.mediaType,
    manifestSha256: digest,
    authorizationPolicyRefs: manifest.access.authorizationPolicyRefs,
    evidenceReferencesSha256: evidenceReferencesSha256(manifest.evidenceReferences),
  });

const compareContent = (
  left: ArtifactContentIdentityV1,
  right: ArtifactContentIdentityV1,
): boolean =>
  left.byteLength === right.byteLength &&
  left.hash.algorithm === right.hash.algorithm &&
  left.hash.value === right.hash.value;

export interface ArtifactMaintenanceOptionsV1 {
  readonly rootDirectory: string;
  readonly policy: ArtifactHashManifestCommandV1["policy"];
  readonly store: FilesystemArtifactStore;
  readonly registry: PostgresArtifactRegistry;
  readonly now?: () => Date;
  readonly failpoint?: (point: ArtifactFailpointV1) => void | Promise<void>;
}

export class ArtifactMaintenance implements ArtifactMaintenanceV1 {
  readonly #stagingDirectory: string;
  readonly #objectsDirectory: string;
  readonly #quarantineDirectory: string;
  readonly #store: FilesystemArtifactStore;
  readonly #registry: PostgresArtifactRegistry;
  readonly #failpoint: (point: ArtifactFailpointV1) => void | Promise<void>;
  readonly #now: () => Date;

  constructor(options: ArtifactMaintenanceOptionsV1) {
    this.#stagingDirectory = join(options.rootDirectory, "staging");
    this.#objectsDirectory = join(options.rootDirectory, "objects", "sha256");
    this.#quarantineDirectory = join(options.rootDirectory, "quarantine");
    this.#store = options.store;
    this.#registry = options.registry;
    this.#failpoint = options.failpoint ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }

  async #runFailpoint(point: ArtifactFailpointV1): Promise<void> {
    await this.#failpoint(point);
  }

  async createHashManifest(
    command: ArtifactHashManifestCommandV1,
  ): Promise<import("@riskflow/core/artifacts").ArtifactPutResultV1> {
    const parsed = ArtifactHashManifestCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "manifest.command");
    const value = parsed.data;
    if (value.purposeCode !== "artifact-hash-manifest") {
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "manifest.purpose");
    }
    const header: ArtifactHashManifestHeaderV1 = ArtifactHashManifestHeaderV1Schema.parse({
      schemaVersion: "1",
      manifestId: value.manifestId,
      projectId: value.projectId,
      backupBatchRef: value.backupBatchRef,
      databaseSnapshotRef: value.databaseSnapshotRef,
      fileSnapshotRef: value.fileSnapshotRef,
      generatedAt: value.generatedAt,
    });
    const content = (async function* (
      registry: PostgresArtifactRegistry,
    ): AsyncGenerator<Uint8Array> {
      yield lineBytes(header);
      const entriesHash = createHash("sha256");
      let entryCount = 0;
      for await (const manifest of registry.listManifests(
        value.projectId,
        value.policy.maintenanceBatchSize,
        value.manifestId,
      )) {
        try {
          registry.assertReadable(manifest, {
            projectId: value.projectId,
            purposeCode: manifest.purposeCode,
            requiredCapability: value.requiredCapability,
            authorization: value.authorization,
          });
        } catch (error) {
          if (error instanceof ArtifactStoreError && error.code === "ARTIFACT_ACCESS_DENIED") {
            continue;
          }
          throw error;
        }
        const digest = await registry.readManifestDigest(value.projectId, manifest.artifactRef);
        if (digest === undefined || digest !== manifestSha256(manifest)) {
          throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "manifest.source");
        }
        const line = lineBytes(entryForManifest(manifest, digest));
        entriesHash.update(line);
        entryCount += 1;
        yield line;
      }
      const trailer: ArtifactHashManifestTrailerV1 = ArtifactHashManifestTrailerV1Schema.parse({
        entryCount,
        entriesSha256: entriesHash.digest("hex"),
      });
      yield lineBytes(trailer);
    })(this.#registry);
    const putCommand = ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: value.commandId,
      idempotencyKey: value.idempotencyKey,
      projectId: value.projectId,
      actorId: value.actorId,
      issuedAt: value.generatedAt,
      authorization: value.authorization,
      requiredCapability: value.requiredCapability,
      artifactId: value.manifestId,
      artifactKind: "content",
      purposeCode: "artifact-hash-manifest",
      mediaType: "application/x-ndjson",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    });
    return this.#store.put(putCommand, content);
  }

  reconcile(
    request: ArtifactReconcileRequestV1,
    manifestContent?: AsyncIterable<Uint8Array>,
  ): import("@riskflow/core/artifacts").ArtifactReconcileHandleV1 {
    const parsed = ArtifactReconcileRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      const error = makeArtifactError("ARTIFACT_INPUT_INVALID", "reconcile.command");
      return {
        findings: (async function* () {
          yield* [];
          throw error;
        })(),
        summary: Promise.reject(error),
      };
    }
    const value = parsed.data;
    let resolveSummary!: (summary: ArtifactReconcileSummaryV1) => void;
    let rejectSummary!: (error: unknown) => void;
    const summary = new Promise<ArtifactReconcileSummaryV1>((resolvePromise, rejectPromise) => {
      resolveSummary = resolvePromise;
      rejectSummary = rejectPromise;
    });
    const findings = this.#reconcile(value, manifestContent, resolveSummary, rejectSummary);
    return { findings, summary };
  }

  async *#reconcile(
    request: ArtifactReconcileRequestV1,
    manifestContent: AsyncIterable<Uint8Array> | undefined,
    resolveSummary: (summary: ArtifactReconcileSummaryV1) => void,
    rejectSummary: (error: unknown) => void,
  ): AsyncGenerator<ArtifactReconcileFindingV1> {
    const startedAt = this.#nowIso();
    const counts = emptyCounts();
    const seen = new Set<string>();
    let lastRef: ArtifactManifestV1["artifactRef"] | undefined;
    const emit = (finding: ArtifactReconcileFindingV1): ArtifactReconcileFindingV1 => {
      const key = findingKindToCount(finding.kind);
      if (key !== undefined) counts[key] += 1;
      return finding;
    };
    try {
      let content = manifestContent;
      let verified: Promise<unknown> | undefined;
      if (content === undefined) {
        const read = await this.#store.open({
          schemaVersion: "1",
          requestId: `reconcile-read-${request.runId}`,
          idempotencyKey: `reconcile-read-${request.runId}`,
          artifactRef: request.hashManifestRef,
          projectId: request.projectId,
          actorId: request.authorization.actorId,
          requestedAt: startedAt,
          purposeCode: "artifact-hash-manifest",
          requiredCapability: request.requiredCapability,
          authorization: request.authorization,
        });
        content = read.content;
        verified = read.verified;
      }
      let header: ArtifactHashManifestHeaderV1 | undefined;
      let trailerSeen = false;
      let entryCount = 0;
      const entriesHash = createHash("sha256");
      const contentHash = createHash("sha256");
      for await (const line of readLines(content, contentHash)) {
        let value: unknown;
        try {
          value = JSON.parse(line) as unknown;
        } catch {
          throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.json");
        }
        if (header === undefined) {
          header = ArtifactHashManifestHeaderV1Schema.parse(value);
          if (
            header.manifestId !== request.hashManifestRef.reference.entityId ||
            header.projectId !== request.projectId ||
            header.databaseSnapshotRef.entityId !== request.databaseSnapshotRef.entityId ||
            header.databaseSnapshotRef.versionId !== request.databaseSnapshotRef.versionId ||
            header.fileSnapshotRef.entityId !== request.fileSnapshotRef.entityId ||
            header.fileSnapshotRef.versionId !== request.fileSnapshotRef.versionId
          ) {
            throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.snapshot");
          }
          continue;
        }
        if (trailerSeen) throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.trailing");
        const maybeTrailer = ArtifactHashManifestTrailerV1Schema.safeParse(value);
        if (maybeTrailer.success) {
          if (trailerSeen)
            throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.trailing");
          const trailer = maybeTrailer.data;
          const entriesDigest = entriesHash.digest("hex");
          if (trailer.entryCount !== entryCount || trailer.entriesSha256 !== entriesDigest) {
            throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.trailer");
          }
          trailerSeen = true;
          continue;
        }
        const entry = ArtifactHashManifestEntryV1Schema.parse(value);
        const key = refKey(entry.artifactRef);
        if (
          seen.has(key) ||
          (lastRef !== undefined && compareRefs(entry.artifactRef, lastRef) <= 0)
        ) {
          throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.order");
        }
        seen.add(key);
        lastRef = entry.artifactRef;
        const entryLine = lineBytes(entry);
        entriesHash.update(entryLine);
        entryCount += 1;
        const manifest = await this.#registry.readManifest(request.projectId, entry.artifactRef);
        const base = {
          artifactRef: entry.artifactRef,
          content: entry.content,
          manifestSha256: entry.manifestSha256,
          observedAt: this.#nowIso(),
        };
        if (
          manifest === undefined ||
          manifestSha256(manifest) !== entry.manifestSha256 ||
          !compareContent(manifest.content, entry.content) ||
          manifest.mediaType !== entry.mediaType ||
          canonicalJson(manifest.access.authorizationPolicyRefs) !==
            canonicalJson(entry.authorizationPolicyRefs) ||
          evidenceReferencesSha256(manifest.evidenceReferences) !== entry.evidenceReferencesSha256
        ) {
          yield emit(
            ArtifactReconcileFindingV1Schema.parse({ kind: "manifest-conflict", ...base }),
          );
          continue;
        }
        try {
          await this.#store.verifyObjectForMaintenance(entry.content);
          yield emit(ArtifactReconcileFindingV1Schema.parse({ kind: "complete", ...base }));
        } catch (error) {
          if (error instanceof ArtifactStoreError && error.code === "ARTIFACT_INTEGRITY_FAILURE") {
            yield emit(
              ArtifactReconcileFindingV1Schema.parse({ kind: "content-mismatch", ...base }),
            );
          } else {
            yield emit(ArtifactReconcileFindingV1Schema.parse({ kind: "missing-object", ...base }));
          }
        }
      }
      if (header === undefined || !trailerSeen)
        throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.header");
      if (`sha256:${contentHash.digest("hex")}` !== request.hashManifestRef.reference.versionId)
        throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.manifest-hash");
      if (verified !== undefined) await verified;
      for await (const manifest of this.#registry.listManifests(
        request.projectId,
        request.policy.maintenanceBatchSize,
        request.hashManifestRef.reference.entityId,
      )) {
        try {
          this.#registry.assertReadable(manifest, {
            projectId: request.projectId,
            purposeCode: manifest.purposeCode,
            requiredCapability: request.requiredCapability,
            authorization: request.authorization,
          });
        } catch (error) {
          if (error instanceof ArtifactStoreError && error.code === "ARTIFACT_ACCESS_DENIED") {
            continue;
          }
          throw error;
        }
        if (!seen.has(refKey(manifest.artifactRef))) {
          yield emit(
            ArtifactReconcileFindingV1Schema.parse({
              kind: "manifest-conflict",
              artifactRef: manifest.artifactRef,
              content: manifest.content,
              manifestSha256: manifestSha256(manifest),
              observedAt: this.#nowIso(),
            }),
          );
        }
      }
      yield* this.#scanOrphans(request, emit);
      const passed =
        counts.missingObject === 0 && counts.contentMismatch === 0 && counts.manifestConflict === 0;
      const auditTrail = await this.#registry.appendMaintenanceAudit({
        runId: request.runId,
        commandId: `reconcile-${request.runId}`,
        idempotencyKey: `reconcile-${request.runId}`,
        projectId: request.projectId,
        actorId: request.authorization.actorId,
        authorizationContextRef: request.authorization.authorizationContextRef,
        issuedAt: startedAt,
        action: "artifact.reconcile",
        payload: { mode: request.mode, passed, counts },
      });
      const result = ArtifactReconcileSummaryV1Schema.parse({
        schemaVersion: "1",
        runId: request.runId,
        projectId: request.projectId,
        mode: request.mode,
        counts,
        passed,
        startedAt,
        completedAt: this.#nowIso(),
        auditTrailRef: auditTrail,
      });
      resolveSummary(result);
    } catch (error) {
      const failure =
        error instanceof ArtifactStoreError
          ? error
          : makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile");
      rejectSummary(failure);
      throw failure;
    }
  }

  async *#scanOrphans(
    request: ArtifactReconcileRequestV1,
    emit: (finding: ArtifactReconcileFindingV1) => ArtifactReconcileFindingV1,
  ): AsyncGenerator<ArtifactReconcileFindingV1> {
    const first = await readdir(this.#objectsDirectory, { withFileTypes: true });
    for (const aa of first) {
      if (!aa.isDirectory() || !HEX_PAIR_PATTERN.test(aa.name)) continue;
      const secondPath = join(this.#objectsDirectory, aa.name);
      const second = await readdir(secondPath, { withFileTypes: true });
      for (const bb of second) {
        if (!bb.isDirectory() || !HEX_PAIR_PATTERN.test(bb.name)) continue;
        const leafPath = join(secondPath, bb.name);
        const leaves = await readdir(leafPath, { withFileTypes: true });
        for (const leaf of leaves) {
          if (!leaf.isFile() || !HASH_PATTERN.test(leaf.name)) continue;
          const hash = leaf.name;
          const path = join(leafPath, hash);
          const details = await lstat(path);
          if (details.mtimeMs > Date.parse(request.observedBefore)) continue;
          const hasManifest = await this.#registry.hasContentHash(hash);
          if (!hasManifest) {
            yield emit(
              ArtifactReconcileFindingV1Schema.parse({
                kind: "orphan-object",
                contentHash: { algorithm: "sha256", value: hash },
                byteLength: details.size,
                observedAt: this.#nowIso(),
              }),
            );
          }
        }
      }
    }
    const staging = await readdir(this.#stagingDirectory, { withFileTypes: true });
    const observedBefore = Date.parse(request.observedBefore);
    for (const entry of staging) {
      if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
      if (this.#store.isStagingActiveForMaintenance(entry.name.slice(0, -5))) continue;
      const details = await lstat(join(this.#stagingDirectory, entry.name));
      if (details.mtimeMs <= observedBefore) {
        yield emit(
          ArtifactReconcileFindingV1Schema.parse({
            kind: "stale-staging",
            stagingId: entry.name.slice(0, -5),
            observedAt: this.#nowIso(),
          }),
        );
      }
    }
    const quarantines = await readdir(this.#quarantineDirectory, { withFileTypes: true });
    for (const run of quarantines) {
      if (!run.isDirectory()) continue;
      const entries = await readdir(join(this.#quarantineDirectory, run.name), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !HASH_PATTERN.test(entry.name)) continue;
        yield emit(
          ArtifactReconcileFindingV1Schema.parse({
            kind: "quarantined-object",
            contentHash: { algorithm: "sha256", value: entry.name },
            quarantineRunId: run.name,
            observedAt: this.#nowIso(),
          }),
        );
      }
    }
  }

  async sweepOrphans(command: ArtifactSweepCommandV1): Promise<ArtifactSweepResultV1> {
    const parsed = ArtifactSweepCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "sweep.command");
    const value = parsed.data;
    return this.#registry.withAdvisoryLock(value.policy, async () => {
      const result = await this.#sweepLocked(value);
      return ArtifactSweepResultV1Schema.parse(result);
    });
  }

  async #sweepLocked(command: ArtifactSweepCommandV1): Promise<ArtifactSweepResultV1> {
    const observedBefore = Date.parse(command.observedBefore);
    const staging = await readdir(this.#stagingDirectory, { withFileTypes: true });
    let stagingObserved = 0;
    let stagingRemoved = 0;
    for (const entry of staging) {
      if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
      if (this.#store.isStagingActiveForMaintenance(entry.name.slice(0, -5))) continue;
      const path = join(this.#stagingDirectory, entry.name);
      const details = await lstat(path);
      if (details.mtimeMs > observedBefore) continue;
      stagingObserved += 1;
      // Staging removal follows the maintenance audit so an audit failure
      // leaves the cleanup candidate available for the next run.
    }
    const candidates: Array<{ hash: string; path: string }> = [];
    const first = await readdir(this.#objectsDirectory, { withFileTypes: true });
    for (const aa of first) {
      if (!aa.isDirectory() || !HEX_PAIR_PATTERN.test(aa.name)) continue;
      const second = await readdir(join(this.#objectsDirectory, aa.name), { withFileTypes: true });
      for (const bb of second) {
        if (!bb.isDirectory() || !HEX_PAIR_PATTERN.test(bb.name)) continue;
        const leafPath = join(this.#objectsDirectory, aa.name, bb.name);
        const leaves = await readdir(leafPath, { withFileTypes: true });
        for (const leaf of leaves) {
          if (!leaf.isFile() || !HASH_PATTERN.test(leaf.name)) continue;
          const path = join(leafPath, leaf.name);
          const details = await lstat(path);
          if (
            details.mtimeMs > observedBefore ||
            (await this.#registry.countContentHash(leaf.name)) > 0
          )
            continue;
          candidates.push({ hash: leaf.name, path });
          if (candidates.length >= command.policy.maintenanceBatchSize) break;
        }
        if (candidates.length >= command.policy.maintenanceBatchSize) break;
      }
      if (candidates.length >= command.policy.maintenanceBatchSize) break;
    }
    let orphanQuarantined = 0;
    let orphanRemoved = 0;
    const quarantined: Array<{ source: string; destination: string; hash: string }> = [];
    if (!command.dryRun && candidates.length > 0) {
      const runDirectory = join(this.#quarantineDirectory, command.runId);
      await mkdir(runDirectory, { recursive: true, mode: 0o700 });
      for (const candidate of candidates) {
        const destination = join(runDirectory, candidate.hash);
        await rename(candidate.path, destination);
        quarantined.push({ source: candidate.path, destination, hash: candidate.hash });
        orphanQuarantined += 1;
      }
      await syncDirectory(runDirectory);
      await syncDirectory(this.#quarantineDirectory);
    }
    let auditTrailRef: ArtifactSweepResultV1["auditTrailRef"];
    try {
      await this.#runFailpoint("audit");
      auditTrailRef = await this.#registry.appendMaintenanceAudit({
        runId: command.runId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        projectId: command.projectId,
        actorId: command.actorId,
        authorizationContextRef: command.authorization.authorizationContextRef,
        issuedAt: command.observedBefore,
        action: "artifact.orphan-sweep",
        payload: {
          dryRun: command.dryRun,
          stagingObserved,
          orphanObserved: candidates.length,
        },
      });
    } catch (error) {
      for (const item of quarantined)
        await rename(item.destination, item.source).catch(() => undefined);
      throw error;
    }
    if (!command.dryRun) {
      for (const entry of staging) {
        if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
        if (this.#store.isStagingActiveForMaintenance(entry.name.slice(0, -5))) continue;
        const path = join(this.#stagingDirectory, entry.name);
        const details = await lstat(path);
        if (details.mtimeMs <= observedBefore) {
          await rm(path, { force: true });
          stagingRemoved += 1;
        }
      }
      await syncDirectory(this.#stagingDirectory);
    }
    if (!command.dryRun) {
      for (const item of quarantined) {
        await rm(item.destination, { force: true });
        orphanRemoved += 1;
      }
      if (quarantined.length > 0) {
        await syncDirectory(join(this.#quarantineDirectory, command.runId));
        await syncDirectory(this.#quarantineDirectory);
      }
    }
    return {
      schemaVersion: "1",
      runId: command.runId,
      projectId: command.projectId,
      dryRun: command.dryRun,
      stagingObserved,
      stagingRemoved,
      orphanObserved: candidates.length,
      orphanQuarantined,
      orphanRemoved,
      retained: Math.max(0, candidates.length - orphanRemoved),
      auditTrailRef,
    };
  }
}

export const createArtifactMaintenance = (
  options: ArtifactMaintenanceOptionsV1,
): ArtifactMaintenance => new ArtifactMaintenance(options);
