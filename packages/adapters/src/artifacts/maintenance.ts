import { createHash } from "node:crypto";
import { lstat, mkdir, opendir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  ArtifactHashManifestCommandV1Schema,
  ArtifactHashManifestEntryV1Schema,
  ArtifactHashManifestHeaderV1Schema,
  ArtifactHashManifestTrailerV1Schema,
  ArtifactMaintenanceBatchV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactReconcileFindingV1Schema,
  ArtifactReconcileRequestV1Schema,
  ArtifactReconcileSummaryV1Schema,
  ArtifactStoreError,
  ArtifactStorePolicyV1Schema,
  ArtifactSweepCommandV1Schema,
  ArtifactSweepResultV1Schema,
  artifactPolicySha256,
  evidenceReferencesSha256,
  makeArtifactError,
  manifestSha256,
  type ArtifactContentIdentityV1,
  type ArtifactHashManifestCommandV1,
  type ArtifactHashManifestEntryV1,
  type ArtifactHashManifestHeaderV1,
  type ArtifactHashManifestTrailerV1,
  type ArtifactManifestV1,
  type ArtifactMaintenanceV1,
  type ArtifactReconcileFindingV1,
  type ArtifactReconcileRequestV1,
  type ArtifactReconcileSummaryV1,
  type ArtifactStorePolicyV1,
  type ArtifactSweepCommandV1,
  type ArtifactSweepResultV1,
} from "@riskflow/core/artifacts";
import { canonicalJson } from "@riskflow/core/persistence";
import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";

import { FilesystemArtifactStore, type ArtifactFailpointV1 } from "./filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "./postgres-artifact-registry.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_PAIR_PATTERN = /^[0-9a-f]{2}$/u;
const SAFE_DIRECTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const encoder = new TextEncoder();

const refKey = (value: ArtifactManifestV1["artifactRef"]): string =>
  `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

const compareRefs = (
  left: ArtifactManifestV1["artifactRef"],
  right: ArtifactManifestV1["artifactRef"],
): number => {
  const compare = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
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

type MaintenanceDirectoryEntry = {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
};

const readDirectoryEntryBatches = async function* (
  directoryPath: string,
  batchSize: number,
): AsyncGenerator<MaintenanceDirectoryEntry[]> {
  // ponytail: bounded keyset rescans trade O(n²) directory reads for constant memory;
  // replace with a native sorted directory cursor if the target filesystem provides one.
  let after = "";
  for (;;) {
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    const entries: MaintenanceDirectoryEntry[] = [];
    try {
      for await (const entry of directory) {
        if (entry.name <= after) continue;
        const candidate = {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        };
        if (entries.length < batchSize) entries.push(candidate);
        else if (candidate.name < entries.at(-1)!.name) entries[entries.length - 1] = candidate;
        else continue;
        entries.sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    if (entries.length === 0) return;
    yield entries;
    after = entries.at(-1)!.name;
  }
};

const readObjectFiles = async function* (
  objectsDirectory: string,
  batchSize: number,
): AsyncGenerator<{ readonly hash: string; readonly path: string }> {
  for await (const first of readDirectoryEntryBatches(objectsDirectory, batchSize)) {
    for (const aa of first) {
      if (!aa.isDirectory || !HEX_PAIR_PATTERN.test(aa.name)) continue;
      for await (const second of readDirectoryEntryBatches(
        join(objectsDirectory, aa.name),
        batchSize,
      )) {
        for (const bb of second) {
          if (!bb.isDirectory || !HEX_PAIR_PATTERN.test(bb.name)) continue;
          for await (const leaves of readDirectoryEntryBatches(
            join(objectsDirectory, aa.name, bb.name),
            batchSize,
          )) {
            for (const leaf of leaves) {
              if (!leaf.isFile || !HASH_PATTERN.test(leaf.name)) continue;
              yield {
                hash: leaf.name,
                path: join(objectsDirectory, aa.name, bb.name, leaf.name),
              };
            }
          }
        }
      }
    }
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

const errorCode = (error: unknown): string =>
  error instanceof ArtifactStoreError ? error.code : "ARTIFACT_RECOVERY_BLOCKED";

type ArtifactSweepMetricsV1 = Omit<ArtifactSweepResultV1, "auditTrailRef" | "diagnosticRef">;

export interface ArtifactMaintenanceOptionsV1 {
  readonly rootDirectory: string;
  readonly policy: ArtifactStorePolicyV1;
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
  readonly #policy: ArtifactStorePolicyV1;
  readonly #policySha256: string;
  readonly #failpoint: (point: ArtifactFailpointV1) => void | Promise<void>;
  readonly #now: () => Date;

  constructor(options: ArtifactMaintenanceOptionsV1) {
    this.#stagingDirectory = join(options.rootDirectory, "staging");
    this.#objectsDirectory = join(options.rootDirectory, "objects", "sha256");
    this.#quarantineDirectory = join(options.rootDirectory, "quarantine");
    this.#store = options.store;
    this.#registry = options.registry;
    const parsedPolicy = ArtifactStorePolicyV1Schema.parse(options.policy);
    this.#policy = Object.freeze({
      ...parsedPolicy,
      policyRef: Object.freeze({ ...parsedPolicy.policyRef }),
    });
    this.#policySha256 = artifactPolicySha256(this.#policy);
    this.#failpoint = options.failpoint ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }

  #cutoff(startedAt: string): string {
    return new Date(Date.parse(startedAt) - this.#policy.orphanGracePeriodMs).toISOString();
  }

  #assertPolicyRef(policyRef: ArtifactStorePolicyV1["policyRef"]): void {
    if (
      policyRef.entityId !== this.#policy.policyRef.entityId ||
      policyRef.versionId !== this.#policy.policyRef.versionId
    ) {
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "maintenance.policy-ref");
    }
  }

  #assertCapability(
    authorization: AuthorizationContextV1,
    capability: string,
    stage: string,
  ): void {
    if (!authorization.grantedCapabilities.includes(capability as never))
      throw makeArtifactError("ARTIFACT_ACCESS_DENIED", stage);
  }

  async #runFailpoint(point: ArtifactFailpointV1): Promise<void> {
    await this.#failpoint(point);
  }

  async #saveDiagnostic(input: {
    id: string;
    stage: string;
    projectId: string;
    actorId: string;
    authorization: AuthorizationContextV1;
    requiredCapability: ArtifactHashManifestCommandV1["requiredCapability"];
    details: unknown;
  }): Promise<ArtifactSweepResultV1["diagnosticRef"]> {
    const suffix = input.stage.replace(/[^A-Za-z0-9._-]/gu, "-");
    const body = encoder.encode(
      canonicalJson({ schemaVersion: "1", stage: input.stage, details: input.details }),
    );
    const command = ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `diagnostic-${input.id}-${suffix}`,
      idempotencyKey: `diagnostic-${input.id}-${suffix}`,
      projectId: input.projectId,
      actorId: input.actorId,
      issuedAt: this.#nowIso(),
      authorization: input.authorization,
      requiredCapability: input.requiredCapability,
      artifactId: `diagnostic-${input.id}-${suffix}`,
      artifactKind: "diagnostic",
      purposeCode: "artifact-diagnostic",
      mediaType: "application/json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    });
    const result = await this.#store.put(
      command,
      (async function* () {
        yield body;
      })(),
    );
    return result.artifactRef.kind === "diagnostic-artifact" ? result.artifactRef : undefined;
  }

  async #assertProjectReadable(
    projectId: string,
    authorization: AuthorizationContextV1,
    requiredCapability: ArtifactHashManifestCommandV1["requiredCapability"],
  ): Promise<void> {
    const snapshot = await this.#registry.openManifestSnapshot(projectId);
    let committed = false;
    try {
      await this.#assertSnapshotReadable(snapshot, projectId, authorization, requiredCapability);
      committed = true;
    } finally {
      await snapshot.close(committed);
    }
  }

  async #assertSnapshotReadable(
    snapshot: import("./postgres-artifact-registry.js").ArtifactManifestSnapshotReaderV1,
    projectId: string,
    authorization: AuthorizationContextV1,
    requiredCapability: ArtifactHashManifestCommandV1["requiredCapability"],
  ): Promise<void> {
    for await (const manifest of snapshot.listManifests(this.#policy.maintenanceBatchSize)) {
      this.#registry.assertReadable(manifest, {
        projectId,
        purposeCode: manifest.purposeCode,
        requiredCapability,
        authorization,
      });
    }
  }

  async createHashManifest(
    command: ArtifactHashManifestCommandV1,
  ): Promise<import("@riskflow/core/artifacts").ArtifactPutResultV1> {
    const parsed = ArtifactHashManifestCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "manifest.command");
    const value = parsed.data;
    this.#assertPolicyRef(value.policyRef);
    this.#assertCapability(
      value.authorization,
      "engineering-data.freeze",
      "manifest.authorization",
    );
    if (value.requiredCapability !== "engineering-data.freeze")
      throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "manifest.capability");
    if (value.purposeCode !== "artifact-hash-manifest")
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "manifest.purpose");
    const replay = await this.#registry.readCompletedPutResult(value);
    if (replay !== undefined) {
      this.#registry.assertReadable(replay.manifest, {
        projectId: value.projectId,
        purposeCode: "artifact-hash-manifest",
        requiredCapability: value.requiredCapability,
        authorization: value.authorization,
      });
      return replay;
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
    const snapshot = await this.#registry.openManifestSnapshot(value.projectId);
    try {
      await this.#assertSnapshotReadable(
        snapshot,
        value.projectId,
        value.authorization,
        value.requiredCapability,
      );
    } catch (error) {
      await snapshot.close(false);
      throw error;
    }
    const content = (async function* (
      registry: PostgresArtifactRegistry,
      maintenance: ArtifactMaintenance,
    ): AsyncGenerator<Uint8Array> {
      let committed = false;
      try {
        yield lineBytes(header);
        const entriesHash = createHash("sha256");
        let entryCount = 0;
        for await (const manifest of snapshot.listManifests(
          maintenance.#policy.maintenanceBatchSize,
        )) {
          registry.assertReadable(manifest, {
            projectId: value.projectId,
            purposeCode: manifest.purposeCode,
            requiredCapability: value.requiredCapability,
            authorization: value.authorization,
          });
          const digest = manifestSha256(manifest);
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
        committed = true;
      } finally {
        await snapshot.close(committed);
      }
    })(this.#registry, this);
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
    try {
      return await this.#store.put(putCommand, content);
    } catch (error) {
      await snapshot.close(false);
      throw error;
    }
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
          throw error;
          yield* [] as never[];
        })(),
        summary: Promise.reject(error),
      };
    }
    const value = parsed.data;
    try {
      this.#assertPolicyRef(value.policyRef);
      this.#assertCapability(
        value.authorization,
        value.mode === "recovery" ? "engineering-data.freeze" : "engineering-data.read",
        "reconcile.authorization",
      );
    } catch (error) {
      return {
        findings: (async function* () {
          throw error;
          yield* [] as never[];
        })(),
        summary: Promise.reject(error),
      };
    }
    let resolveSummary!: (summary: ArtifactReconcileSummaryV1) => void;
    let rejectSummary!: (error: unknown) => void;
    const summary = new Promise<ArtifactReconcileSummaryV1>((resolvePromise, rejectPromise) => {
      resolveSummary = resolvePromise;
      rejectSummary = rejectPromise;
    });
    void summary.catch(() => undefined);
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
    const cutoff = this.#cutoff(startedAt);
    const counts = emptyCounts();
    const seen = new Set<string>();
    let lastRef: ArtifactManifestV1["artifactRef"] | undefined;
    const emit = (finding: ArtifactReconcileFindingV1): ArtifactReconcileFindingV1 => {
      const key = findingKindToCount(finding.kind);
      if (key !== undefined) counts[key] += 1;
      return finding;
    };
    let snapshot:
      import("./postgres-artifact-registry.js").ArtifactManifestSnapshotReaderV1 | undefined;
    try {
      const requiredCapability =
        request.mode === "recovery" ? "engineering-data.freeze" : "engineering-data.read";
      snapshot = await this.#registry.openManifestSnapshot(request.projectId);
      await this.#assertSnapshotReadable(
        snapshot,
        request.projectId,
        request.authorization,
        requiredCapability,
      );
      let content = manifestContent;
      let completed: Promise<unknown> | undefined;
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
          requiredCapability,
          authorization: request.authorization,
        });
        content = read.content;
        completed = read.completed;
      }
      let header: ArtifactHashManifestHeaderV1 | undefined;
      let trailerSeen = false;
      let entryCount = 0;
      const entriesHash = createHash("sha256");
      const contentHash = createHash("sha256");
      for await (const line of readLines(content, contentHash)) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(line) as unknown;
        } catch {
          throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.json");
        }
        if (header === undefined) {
          header = ArtifactHashManifestHeaderV1Schema.parse(decoded);
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
        const maybeTrailer = ArtifactHashManifestTrailerV1Schema.safeParse(decoded);
        if (maybeTrailer.success) {
          const trailer = maybeTrailer.data;
          if (
            trailer.entryCount !== entryCount ||
            trailer.entriesSha256 !== entriesHash.digest("hex")
          ) {
            throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.trailer");
          }
          trailerSeen = true;
          continue;
        }
        const entry = ArtifactHashManifestEntryV1Schema.parse(decoded);
        const key = refKey(entry.artifactRef);
        if (
          seen.has(key) ||
          (lastRef !== undefined && compareRefs(entry.artifactRef, lastRef) <= 0)
        )
          throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.order");
        seen.add(key);
        lastRef = entry.artifactRef;
        const entryLine = lineBytes(entry);
        entriesHash.update(entryLine);
        entryCount += 1;
        const manifest = await snapshot.readManifest(entry.artifactRef);
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
          yield emit(
            ArtifactReconcileFindingV1Schema.parse({
              kind:
                errorCode(error) === "ARTIFACT_INTEGRITY_FAILURE"
                  ? "content-mismatch"
                  : "missing-object",
              ...base,
            }),
          );
        }
      }
      if (header === undefined || !trailerSeen)
        throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.header");
      if (`sha256:${contentHash.digest("hex")}` !== request.hashManifestRef.reference.versionId)
        throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile.manifest-hash");
      if (completed !== undefined) await completed;
      for await (const manifest of snapshot.listManifests(
        this.#policy.maintenanceBatchSize,
        request.hashManifestRef,
      )) {
        this.#registry.assertReadable(manifest, {
          projectId: request.projectId,
          purposeCode: manifest.purposeCode,
          requiredCapability,
          authorization: request.authorization,
        });
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
      await snapshot.close(true);
      snapshot = undefined;
      yield* this.#scanOrphans(request, cutoff, emit);
      const passed =
        counts.missingObject === 0 &&
        counts.contentMismatch === 0 &&
        counts.manifestConflict === 0 &&
        counts.orphanObject === 0 &&
        counts.staleStaging === 0 &&
        counts.quarantinedObject === 0;
      const requiredForDiagnostic = requiredCapability;
      const diagnosticRef = passed
        ? undefined
        : await this.#saveDiagnostic({
            id: request.runId,
            stage: "reconcile-findings",
            projectId: request.projectId,
            actorId: request.authorization.actorId,
            authorization: request.authorization,
            requiredCapability: requiredForDiagnostic,
            details: counts,
          });
      const auditTrail = await this.#registry.appendMaintenanceAudit({
        runId: request.runId,
        commandId: `reconcile-${request.runId}`,
        idempotencyKey: `reconcile-${request.runId}`,
        projectId: request.projectId,
        actorId: request.authorization.actorId,
        authorizationContextRef: request.authorization.authorizationContextRef,
        issuedAt: startedAt,
        action: "artifact.reconcile",
        payload: {
          mode: request.mode,
          policyRef: request.policyRef,
          policySha256: this.#policySha256,
          runStartedAt: startedAt,
          cutoff,
          passed,
          counts,
          ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
        },
      });
      resolveSummary(
        ArtifactReconcileSummaryV1Schema.parse({
          schemaVersion: "1",
          runId: request.runId,
          projectId: request.projectId,
          mode: request.mode,
          policyRef: request.policyRef,
          policySha256: this.#policySha256,
          runStartedAt: startedAt,
          cutoff,
          counts,
          passed,
          completedAt: this.#nowIso(),
          auditTrailRef: auditTrail,
          ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
        }),
      );
    } catch (error) {
      const failure =
        request.mode === "recovery" &&
        error instanceof ArtifactStoreError &&
        error.code === "ARTIFACT_ACCESS_DENIED"
          ? makeArtifactError(
              "ARTIFACT_RECOVERY_BLOCKED",
              "reconcile.authorization",
              error.contextRefs,
            )
          : error instanceof ArtifactStoreError
            ? error
            : makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "reconcile");
      rejectSummary(failure);
      throw failure;
    } finally {
      await snapshot?.close(false);
    }
  }

  async *#scanOrphans(
    request: ArtifactReconcileRequestV1,
    cutoff: string,
    emit: (finding: ArtifactReconcileFindingV1) => ArtifactReconcileFindingV1,
  ): AsyncGenerator<ArtifactReconcileFindingV1> {
    for await (const object of readObjectFiles(
      this.#objectsDirectory,
      this.#policy.maintenanceBatchSize,
    )) {
      const details = await lstat(object.path);
      if (details.mtimeMs > Date.parse(cutoff)) continue;
      if ((await this.#registry.countContentHash(object.hash)) > 0) continue;
      yield emit(
        ArtifactReconcileFindingV1Schema.parse({
          kind: "orphan-object",
          contentHash: { algorithm: "sha256", value: object.hash },
          byteLength: details.size,
          observedAt: this.#nowIso(),
        }),
      );
    }
    let staging;
    try {
      staging = await opendir(this.#stagingDirectory);
    } catch {
      staging = undefined;
    }
    if (staging !== undefined) {
      try {
        for await (const entry of staging) {
          if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
          const stagingId = entry.name.slice(0, -5);
          if (this.#store.isStagingActiveForMaintenance(stagingId)) continue;
          const details = await lstat(join(this.#stagingDirectory, entry.name));
          if (details.mtimeMs <= Date.parse(cutoff)) {
            yield emit(
              ArtifactReconcileFindingV1Schema.parse({
                kind: "stale-staging",
                stagingId,
                observedAt: this.#nowIso(),
              }),
            );
          }
        }
      } finally {
        await staging.close().catch(() => undefined);
      }
    }
    for await (const quarantines of readDirectoryEntryBatches(
      this.#quarantineDirectory,
      this.#policy.maintenanceBatchSize,
    )) {
      for (const run of quarantines) {
        if (!run.isDirectory || !SAFE_DIRECTORY_NAME.test(run.name)) continue;
        for await (const entries of readDirectoryEntryBatches(
          join(this.#quarantineDirectory, run.name),
          this.#policy.maintenanceBatchSize,
        )) {
          for (const entry of entries) {
            if (!entry.isFile || !HASH_PATTERN.test(entry.name)) continue;
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
    }
  }

  async sweepOrphans(command: ArtifactSweepCommandV1): Promise<ArtifactSweepResultV1> {
    const parsed = ArtifactSweepCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "sweep.command");
    const value = parsed.data;
    this.#assertPolicyRef(value.policyRef);
    this.#assertCapability(value.authorization, "engineering-data.freeze", "sweep.authorization");
    if (value.requiredCapability !== "engineering-data.freeze")
      throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "sweep.capability");
    await this.#assertProjectReadable(
      value.projectId,
      value.authorization,
      "engineering-data.freeze",
    );
    const result = await this.#registry.withAdvisoryLock(this.#policy, () =>
      this.#sweepLocked(value),
    );
    const diagnosticRef =
      result.retained > 0
        ? await this.#saveDiagnostic({
            id: value.runId,
            stage: "sweep-retained",
            projectId: value.projectId,
            actorId: value.actorId,
            authorization: value.authorization,
            requiredCapability: value.requiredCapability,
            details: {
              orphanObserved: result.orphanObserved,
              orphanRemoved: result.orphanRemoved,
              retained: result.retained,
            },
          })
        : undefined;
    const auditTrailRef = await this.#registry.appendMaintenanceAudit({
      runId: value.runId,
      commandId: value.commandId,
      idempotencyKey: value.idempotencyKey,
      projectId: value.projectId,
      actorId: value.actorId,
      authorizationContextRef: value.authorization.authorizationContextRef,
      issuedAt: result.runStartedAt,
      action: "artifact.orphan-sweep",
      payload: {
        dryRun: value.dryRun,
        policyRef: value.policyRef,
        policySha256: this.#policySha256,
        runStartedAt: result.runStartedAt,
        cutoff: result.cutoff,
        stagingObserved: result.stagingObserved,
        stagingRemoved: result.stagingRemoved,
        orphanObserved: result.orphanObserved,
        orphanQuarantined: result.orphanQuarantined,
        orphanRemoved: result.orphanRemoved,
        retained: result.retained,
        ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
      },
    });
    return ArtifactSweepResultV1Schema.parse({
      ...result,
      auditTrailRef,
      ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
    });
  }

  async *#candidateObjects(cutoff: string): AsyncGenerator<{ hash: string; path: string }> {
    for await (const object of readObjectFiles(
      this.#objectsDirectory,
      this.#policy.maintenanceBatchSize,
    )) {
      const details = await lstat(object.path);
      if (
        details.mtimeMs <= Date.parse(cutoff) &&
        (await this.#registry.countContentHash(object.hash)) === 0
      ) {
        yield object;
      }
    }
  }

  async #recoverQuarantine(
    command: ArtifactSweepCommandV1,
    runStartedAt: string,
    cutoff: string,
  ): Promise<void> {
    for await (const runs of readDirectoryEntryBatches(
      this.#quarantineDirectory,
      this.#policy.maintenanceBatchSize,
    )) {
      for (const run of runs) {
        if (!run.isDirectory || !SAFE_DIRECTORY_NAME.test(run.name))
          throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "sweep.quarantine-name");
        const runDirectory = join(this.#quarantineDirectory, run.name);
        const batches = await this.#registry.listMaintenanceBatches(command.projectId, run.name);
        let recoveryBatchNumber = Math.max(0, ...batches.map((batch) => batch.batchNumber));
        try {
          for await (const entries of readDirectoryEntryBatches(
            runDirectory,
            this.#policy.maintenanceBatchSize,
          )) {
            for (const entry of entries) {
              if (!entry.isFile || !HASH_PATTERN.test(entry.name))
                throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "sweep.quarantine-hash");
              const hash = entry.name;
              const destination = join(runDirectory, hash);
              const objectPath = this.#store.objectPathForTesting({
                algorithm: "sha256",
                value: hash,
              });
              const committedBatch = batches.find((batch) =>
                batch.candidateHashes.some((candidate) => candidate.value === hash),
              );
              const refs = await this.#registry.countContentHash(hash);
              const hasObject = await lstat(objectPath)
                .then(() => true)
                .catch(() => false);
              const quarantineDetails = await lstat(destination);
              await this.#store.verifyPathForMaintenance(destination, {
                hash: { algorithm: "sha256", value: hash },
                byteLength: quarantineDetails.size,
              });
              if (hasObject) {
                const objectDetails = await lstat(objectPath);
                if (objectDetails.size !== quarantineDetails.size)
                  throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "sweep.quarantine-conflict");
                await this.#store.verifyPathForMaintenance(objectPath, {
                  hash: { algorithm: "sha256", value: hash },
                  byteLength: objectDetails.size,
                });
                await rm(destination, { force: true });
              } else if (committedBatch !== undefined && refs === 0) {
                await rm(destination, { force: true });
              } else {
                await mkdir(join(objectPath, ".."), { recursive: true });
                await rename(destination, objectPath);
              }
              recoveryBatchNumber += 1;
              const recoveryBatch = ArtifactMaintenanceBatchV1Schema.parse({
                schemaVersion: "1",
                runId: run.name,
                batchNumber: recoveryBatchNumber,
                projectId: command.projectId,
                commandId: `recovery-${run.name}-${hash}`,
                operation: "quarantine-recovery",
                policyRef: command.policyRef,
                policySha256: this.#policySha256,
                runStartedAt,
                cutoff,
                dryRun: false,
                candidateHashes: [{ algorithm: "sha256", value: hash }],
                auditTrailRef: {
                  kind: "audit-trail",
                  reference: {
                    entityId: `recovery-audit-${run.name}-${hash}`,
                    versionId: "v1",
                  },
                },
                persistedAt: this.#nowIso(),
              });
              await this.#registry.recordMaintenanceBatch({
                batch: recoveryBatch,
                idempotencyKey: `recovery-${run.name}-${hash}`,
                actorId: command.actorId,
                authorizationContextRef: command.authorization.authorizationContextRef,
              });
            }
          }
        } catch (error) {
          if (error instanceof ArtifactStoreError) throw error;
          throw makeArtifactError("ARTIFACT_RECOVERY_BLOCKED", "sweep.quarantine-open");
        }
        await rm(runDirectory, { recursive: true, force: true });
      }
    }
    await syncDirectory(this.#quarantineDirectory);
  }

  async #persistBatch(
    command: ArtifactSweepCommandV1,
    batchNumber: number,
    hashes: readonly string[],
    runStartedAt: string,
    cutoff: string,
  ): Promise<void> {
    const candidateHashes = [...new Set(hashes)]
      .sort()
      .map((value) => ({ algorithm: "sha256" as const, value }));
    if (candidateHashes.length === 0) return;
    const batch = {
      schemaVersion: "1" as const,
      runId: command.runId,
      batchNumber,
      projectId: command.projectId,
      commandId: `sweep-${command.runId}-${batchNumber}`,
      operation: "orphan-sweep" as const,
      policyRef: command.policyRef,
      policySha256: this.#policySha256,
      runStartedAt,
      cutoff,
      dryRun: command.dryRun,
      candidateHashes,
      auditTrailRef: {
        kind: "audit-trail" as const,
        reference: {
          entityId: `sweep-batch-audit-${command.runId}-${batchNumber}`,
          versionId: "v1",
        },
      },
      persistedAt: this.#nowIso(),
    };
    await this.#registry.recordMaintenanceBatch({
      batch,
      idempotencyKey: `sweep-${command.runId}-${batchNumber}`,
      actorId: command.actorId,
      authorizationContextRef: command.authorization.authorizationContextRef,
    });
  }

  async #sweepLocked(command: ArtifactSweepCommandV1): Promise<ArtifactSweepMetricsV1> {
    const runStartedAt = this.#nowIso();
    const cutoff = this.#cutoff(runStartedAt);
    if (!command.dryRun) await this.#recoverQuarantine(command, runStartedAt, cutoff);
    let stagingObserved = 0;
    let stagingRemoved = 0;
    let staging;
    try {
      staging = await opendir(this.#stagingDirectory);
    } catch {
      staging = undefined;
    }
    if (staging !== undefined) {
      try {
        for await (const entry of staging) {
          if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
          const stagingId = entry.name.slice(0, -5);
          if (this.#store.isStagingActiveForMaintenance(stagingId)) continue;
          const details = await lstat(join(this.#stagingDirectory, entry.name));
          if (details.mtimeMs <= Date.parse(cutoff)) stagingObserved += 1;
        }
      } finally {
        await staging.close().catch(() => undefined);
      }
    }
    let orphanObserved = 0;
    let orphanQuarantined = 0;
    let orphanRemoved = 0;
    let batchNumber = (
      await this.#registry.listMaintenanceBatches(command.projectId, command.runId)
    ).reduce((maximum, batch) => Math.max(maximum, batch.batchNumber), 0);
    const candidates: Array<{ hash: string; path: string }> = [];
    const flush = async (): Promise<void> => {
      if (candidates.length === 0) return;
      const current = candidates.splice(0, candidates.length);
      orphanObserved += current.length;
      if (command.dryRun) {
        batchNumber += 1;
        await this.#persistBatch(
          command,
          batchNumber,
          current.map((candidate) => candidate.hash),
          runStartedAt,
          cutoff,
        );
        return;
      }
      const runDirectory = join(this.#quarantineDirectory, command.runId);
      await mkdir(runDirectory, { recursive: true, mode: 0o700 });
      const quarantined: Array<{ hash: string; source: string; destination: string }> = [];
      for (const candidate of current) {
        const details = await lstat(candidate.path).catch(() => undefined);
        if (details === undefined || details.mtimeMs > Date.parse(cutoff)) continue;
        if ((await this.#registry.countContentHash(candidate.hash)) > 0) continue;
        const destination = join(runDirectory, candidate.hash);
        await rename(candidate.path, destination);
        await this.#runFailpoint("quarantine.rename");
        quarantined.push({ hash: candidate.hash, source: candidate.path, destination });
      }
      if (quarantined.length === 0) return;
      await syncDirectory(runDirectory);
      await syncDirectory(this.#quarantineDirectory);
      await this.#runFailpoint("audit");
      batchNumber += 1;
      await this.#persistBatch(
        command,
        batchNumber,
        quarantined.map((item) => item.hash),
        runStartedAt,
        cutoff,
      );
      await this.#runFailpoint("response");
      orphanQuarantined += quarantined.length;
      for (const item of quarantined) {
        await rm(item.destination, { force: true });
        orphanRemoved += 1;
      }
      await syncDirectory(runDirectory);
      await syncDirectory(this.#quarantineDirectory);
    };
    for await (const candidate of this.#candidateObjects(cutoff)) {
      candidates.push(candidate);
      if (candidates.length >= this.#policy.maintenanceBatchSize) await flush();
    }
    await flush();
    if (!command.dryRun && stagingObserved > 0) {
      let currentStaging;
      try {
        currentStaging = await opendir(this.#stagingDirectory);
      } catch {
        currentStaging = undefined;
      }
      if (currentStaging !== undefined) {
        try {
          for await (const entry of currentStaging) {
            if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
            const stagingId = entry.name.slice(0, -5);
            if (this.#store.isStagingActiveForMaintenance(stagingId)) continue;
            const path = join(this.#stagingDirectory, entry.name);
            const details = await lstat(path).catch(() => undefined);
            if (details !== undefined && details.mtimeMs <= Date.parse(cutoff)) {
              await rm(path, { force: true });
              stagingRemoved += 1;
            }
          }
        } finally {
          await currentStaging.close().catch(() => undefined);
        }
        await syncDirectory(this.#stagingDirectory);
      }
    }
    const retained = Math.max(0, orphanObserved - orphanRemoved);
    return {
      schemaVersion: "1",
      runId: command.runId,
      projectId: command.projectId,
      policyRef: command.policyRef,
      policySha256: this.#policySha256,
      runStartedAt,
      cutoff,
      dryRun: command.dryRun,
      stagingObserved,
      stagingRemoved,
      orphanObserved,
      orphanQuarantined,
      orphanRemoved,
      retained,
    };
  }
}

export const createArtifactMaintenance = (
  options: ArtifactMaintenanceOptionsV1,
): ArtifactMaintenance => new ArtifactMaintenance(options);
