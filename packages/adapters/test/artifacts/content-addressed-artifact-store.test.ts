import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  statfs,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ArtifactPutCommandV1Schema,
  ArtifactManifestV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactStoreError,
  makeArtifactError,
  manifestSha256,
  type ArtifactPutCommandV1,
  type ArtifactReadRequestV1,
} from "@riskflow/core/artifacts";
import { type AtomicCommandV1, type TransactionContextV1 } from "@riskflow/core/persistence";
import { AuthorizationContextV1Schema } from "@riskflow/contracts/ports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ARTIFACT_TEST_TIMESTAMP,
  artifactPolicy,
  startArtifactFixture,
  type ArtifactTestFixture,
} from "./fixture.js";
import { createContentAddressedArtifactStore } from "../../src/artifacts/index.js";
import type { ArtifactFailpointV1 } from "../../src/artifacts/filesystem-artifact-store.js";
import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { ArtifactMaintenance } from "../../src/artifacts/maintenance.js";
import { getPostgresTransaction } from "../../src/postgres/transaction-unit.js";

const encoder = new TextEncoder();
const projectId = "project-artifacts";
const scope = (id: string) => ({
  kind: "spatial-scope" as const,
  reference: { entityId: `scope-${id}`, versionId: "v1" },
});
const grant = (id: string) => ({
  kind: "source-access-grant" as const,
  reference: { entityId: `grant-${id}`, versionId: "v1" },
});
const policyRef = { entityId: "artifact-policy", versionId: "v1" };

const authorization = (
  actorId = "actor-artifacts",
  options: {
    readonly project?: string;
    readonly scopes?: readonly ReturnType<typeof scope>[];
    readonly grants?: readonly ReturnType<typeof grant>[];
    readonly capabilities?: readonly (
      "engineering-data.read" | "engineering-data.write" | "engineering-data.freeze"
    )[];
    readonly policy?: { entityId: string; versionId: string };
  } = {},
) =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: `auth-${actorId}`, versionId: "v1" },
    },
    actorId,
    projectId: options.project ?? projectId,
    grantedCapabilities: options.capabilities ?? [
      "engineering-data.read",
      "engineering-data.write",
      "engineering-data.freeze",
    ],
    spatialScopeRefs: options.scopes ?? [scope("all"), scope("parent")],
    sourceAccessGrantRefs: options.grants ?? [grant("all"), grant("parent")],
    authorizationPolicyRef: options.policy ?? policyRef,
    decidedAt: ARTIFACT_TEST_TIMESTAMP,
    invocation: { kind: "human" },
  });

const chunks = async function* (bytes: Uint8Array, chunkSize = 64 * 1024) {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength));
  }
};

const textChunks = (value: string, chunkSize = 7) => chunks(encoder.encode(value), chunkSize);

const putCommand = (
  id: string,
  options: {
    readonly actorId?: string;
    readonly artifactId?: string;
    readonly purposeCode?: string;
    readonly authorization?: ReturnType<typeof authorization>;
    readonly expectedHash?: { algorithm: "sha256"; value: string };
    readonly expectedByteLength?: number;
    readonly parentArtifactRefs?: ArtifactPutCommandV1["parentArtifactRefs"];
    readonly evidenceReferences?: ArtifactPutCommandV1["evidenceReferences"];
  } = {},
): ArtifactPutCommandV1 =>
  ArtifactPutCommandV1Schema.parse({
    schemaVersion: "1",
    commandId: `command-${id}`,
    idempotencyKey: `idem-${id}`,
    projectId: options.authorization?.projectId ?? projectId,
    actorId: options.actorId ?? options.authorization?.actorId ?? "actor-artifacts",
    issuedAt: ARTIFACT_TEST_TIMESTAMP,
    authorization: options.authorization ?? authorization(options.actorId),
    requiredCapability: "engineering-data.write",
    artifactId: options.artifactId ?? `artifact-${id}`,
    artifactKind: "content",
    purposeCode: options.purposeCode ?? "engineering-input",
    mediaType: "text/plain",
    ...(options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash }),
    ...(options.expectedByteLength === undefined
      ? {}
      : { expectedByteLength: options.expectedByteLength }),
    parentArtifactRefs: options.parentArtifactRefs ?? [],
    evidenceReferences: options.evidenceReferences ?? [],
    additionalSpatialScopeRefs: [],
    additionalSourceAccessGrantRefs: [],
  });

const readRequest = (
  id: string,
  artifactRef: Awaited<ReturnType<ArtifactTestFixture["store"]["put"]>>["artifactRef"],
  options: {
    readonly purposeCode?: string;
    readonly authorization?: ReturnType<typeof authorization>;
  } = {},
): ArtifactReadRequestV1 =>
  ArtifactReadRequestV1Schema.parse({
    schemaVersion: "1",
    requestId: `request-${id}`,
    idempotencyKey: `read-idem-${id}`,
    artifactRef,
    projectId: options.authorization?.projectId ?? projectId,
    actorId: options.authorization?.actorId ?? "actor-artifacts",
    requestedAt: ARTIFACT_TEST_TIMESTAMP,
    purposeCode: options.purposeCode ?? "engineering-input",
    requiredCapability: "engineering-data.read",
    authorization: options.authorization ?? authorization(),
  });

const digest = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

const seedSyntheticManifests = async (
  fixture: ArtifactTestFixture,
  syntheticProjectId: string,
  seed: Awaited<ReturnType<ArtifactTestFixture["store"]["put"]>>,
  count: number,
): Promise<void> => {
  const syntheticAuthorization = authorization("actor-artifacts", { project: syntheticProjectId });
  const access = {
    projectId: syntheticProjectId,
    spatialScopeRefs: syntheticAuthorization.spatialScopeRefs,
    sourceAccessGrantRefs: syntheticAuthorization.sourceAccessGrantRefs,
    authorizationPolicyRefs: [policyRef],
  } as const;
  const arrays = {
    artifactId: [] as string[],
    versionId: [] as string[],
    contentSha256: [] as string[],
    byteLength: [] as number[],
    mediaType: [] as string[],
    purposeCode: [] as string[],
    projectId: [] as string[],
    spatialScopeRefs: [] as string[],
    sourceAccessGrantRefs: [] as string[],
    authorizationPolicyRefs: [] as string[],
    writePolicyRef: [] as string[],
    parentArtifactRefs: [] as string[],
    evidenceReferences: [] as string[],
    producerCommandId: [] as string[],
    authorizationContextRef: [] as string[],
    auditEntryId: [] as string[],
    manifestSha256: [] as string[],
    occurredAt: [] as string[],
    recordedAt: [] as string[],
    persistedAt: [] as string[],
    auditTargetRef: [] as string[],
    auditVersionRef: [] as string[],
    commandId: [] as string[],
    idempotencyKey: [] as string[],
    resultRef: [] as string[],
  };
  const accessJson = {
    spatialScopeRefs: JSON.stringify(access.spatialScopeRefs),
    sourceAccessGrantRefs: JSON.stringify(access.sourceAccessGrantRefs),
    authorizationPolicyRefs: JSON.stringify(access.authorizationPolicyRefs),
    writePolicyRef: JSON.stringify(policyRef),
    parentArtifactRefs: "[]",
    evidenceReferences: "[]",
    authorizationContextRef: JSON.stringify(syntheticAuthorization.authorizationContextRef),
  };
  const seedContent = seed.manifest.content;
  const timestamp = ARTIFACT_TEST_TIMESTAMP;
  for (let index = 0; index < count; index += 1) {
    const artifactId = `synthetic-db-${String(index).padStart(5, "0")}`;
    const commandId = `synthetic-db-command-${String(index).padStart(5, "0")}`;
    const auditEntryId = `synthetic-db-audit-${String(index).padStart(5, "0")}`;
    const artifactRef = {
      kind: "content-artifact" as const,
      reference: { entityId: artifactId, versionId: seed.manifest.artifactRef.reference.versionId },
    };
    const manifest = ArtifactManifestV1Schema.parse({
      schemaVersion: "1",
      artifactRef,
      artifactKind: "content",
      content: seedContent,
      mediaType: "application/octet-stream",
      purposeCode: "engineering-input",
      access,
      writePolicyRef: policyRef,
      parentArtifactRefs: [],
      evidenceReferences: [],
      producerCommandId: commandId,
      authorizationContextRef: syntheticAuthorization.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: auditEntryId, versionId: "v1" },
      },
      occurredAt: timestamp,
      recordedAt: timestamp,
      persistedAt: timestamp,
    });
    arrays.artifactId.push(artifactId);
    arrays.versionId.push(artifactRef.reference.versionId);
    arrays.contentSha256.push(seedContent.hash.value);
    arrays.byteLength.push(seedContent.byteLength);
    arrays.mediaType.push(manifest.mediaType);
    arrays.purposeCode.push(manifest.purposeCode);
    arrays.projectId.push(syntheticProjectId);
    arrays.spatialScopeRefs.push(accessJson.spatialScopeRefs);
    arrays.sourceAccessGrantRefs.push(accessJson.sourceAccessGrantRefs);
    arrays.authorizationPolicyRefs.push(accessJson.authorizationPolicyRefs);
    arrays.writePolicyRef.push(accessJson.writePolicyRef);
    arrays.parentArtifactRefs.push(accessJson.parentArtifactRefs);
    arrays.evidenceReferences.push(accessJson.evidenceReferences);
    arrays.producerCommandId.push(commandId);
    arrays.authorizationContextRef.push(accessJson.authorizationContextRef);
    arrays.auditEntryId.push(auditEntryId);
    arrays.manifestSha256.push(manifestSha256(manifest));
    arrays.occurredAt.push(timestamp);
    arrays.recordedAt.push(timestamp);
    arrays.persistedAt.push(timestamp);
    arrays.auditTargetRef.push(JSON.stringify(artifactRef));
    arrays.auditVersionRef.push(JSON.stringify(artifactRef.reference));
    arrays.commandId.push(commandId);
    arrays.idempotencyKey.push(`synthetic-db-idem-${String(index).padStart(5, "0")}`);
    arrays.resultRef.push(JSON.stringify(artifactRef));
  }
  const client = await fixture.postgres.adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO audit.entries (
         audit_entry_id, project_id, action, target_ref, actor_ref,
         authorization_context_ref, version_ref, occurred_at, recorded_at,
         command_id, idempotency_key
       )
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::jsonb[], $5::text[],
         $6::jsonb[], $7::jsonb[], $8::timestamptz[], $9::timestamptz[],
         $10::text[], $11::text[]
       )`,
      [
        arrays.auditEntryId,
        arrays.projectId,
        arrays.commandId.map(() => "artifact.put"),
        arrays.auditTargetRef,
        arrays.commandId.map(() => "actor-artifacts"),
        arrays.authorizationContextRef,
        arrays.auditVersionRef,
        arrays.occurredAt,
        arrays.recordedAt,
        arrays.commandId,
        arrays.idempotencyKey,
      ],
    );
    await client.query(
      `INSERT INTO business.command_receipts (
         project_id, command_kind, idempotency_key, command_id, payload_sha256,
         result_ref, audit_entry_id, actor_ref, authorization_context_ref,
         completed_at
       )
       SELECT project_id, command_kind, idempotency_key, command_id, payload_sha256,
              result_ref, audit_entry_id, actor_ref, authorization_context_ref,
              clock_timestamp()
       FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::char(64)[],
         $6::jsonb[], $7::text[], $8::text[], $9::jsonb[]
       ) AS rows(project_id, command_kind, idempotency_key, command_id,
                 payload_sha256, result_ref, audit_entry_id, actor_ref,
                 authorization_context_ref)`,
      [
        arrays.projectId,
        arrays.commandId.map(() => "synthetic.artifact.put.v1"),
        arrays.idempotencyKey,
        arrays.commandId,
        arrays.commandId.map(() => "0".repeat(64)),
        arrays.resultRef,
        arrays.auditEntryId,
        arrays.commandId.map(() => "actor-artifacts"),
        arrays.authorizationContextRef,
      ],
    );
    await client.query(
      `INSERT INTO business.artifact_manifests (
         artifact_id, version_id, artifact_kind, content_sha256, byte_length,
         media_type, purpose_code, project_id, spatial_scope_refs,
         source_access_grant_refs, authorization_policy_refs, write_policy_ref,
         parent_artifact_refs, evidence_references, producer_command_id,
         authorization_context_ref, audit_entry_id, manifest_sha256,
         occurred_at, recorded_at, persisted_at
       )
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::char(64)[], $5::bigint[],
         $6::text[], $7::text[], $8::text[], $9::jsonb[], $10::jsonb[],
         $11::jsonb[], $12::jsonb[], $13::jsonb[], $14::jsonb[], $15::text[],
         $16::jsonb[], $17::text[], $18::char(64)[], $19::timestamptz[],
         $20::timestamptz[], $21::timestamptz[]
       )`,
      [
        arrays.artifactId,
        arrays.versionId,
        arrays.commandId.map(() => "content"),
        arrays.contentSha256,
        arrays.byteLength,
        arrays.mediaType,
        arrays.purposeCode,
        arrays.projectId,
        arrays.spatialScopeRefs,
        arrays.sourceAccessGrantRefs,
        arrays.authorizationPolicyRefs,
        arrays.writePolicyRef,
        arrays.parentArtifactRefs,
        arrays.evidenceReferences,
        arrays.producerCommandId,
        arrays.authorizationContextRef,
        arrays.auditEntryId,
        arrays.manifestSha256,
        arrays.occurredAt,
        arrays.recordedAt,
        arrays.persistedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const collect = async (stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of stream) {
    parts.push(part);
    size += part.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const startPerformanceSampling = (rootDirectory: string) => {
  const metrics = { peakHeapBytes: 0, peakFileDescriptors: 0, peakStagingFiles: 0 };
  const countEntries = (directory: string): number => {
    try {
      return readdirSync(directory).length;
    } catch {
      return 0;
    }
  };
  const sample = (): void => {
    metrics.peakHeapBytes = Math.max(metrics.peakHeapBytes, process.memoryUsage().heapUsed);
    metrics.peakFileDescriptors = Math.max(
      metrics.peakFileDescriptors,
      countEntries("/proc/self/fd"),
    );
    metrics.peakStagingFiles = Math.max(
      metrics.peakStagingFiles,
      countEntries(join(rootDirectory, "staging")),
    );
  };
  sample();
  const timer = setInterval(sample, 50);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      sample();
      return metrics;
    },
  };
};

const expectArtifactError = async (action: Promise<unknown>, code: string): Promise<void> => {
  try {
    await action;
    throw new Error(`expected ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `expected ${code}`) throw error;
    expect(error).toBeInstanceOf(ArtifactStoreError);
    expect((error as ArtifactStoreError).code).toBe(code);
  }
};

const killChildAtFailpoint = async (
  phase: ArtifactFailpointV1,
  connection: unknown,
  rootDirectory: string,
  policy: unknown,
  command: unknown,
  operation: "put" | "sweep" = "put",
): Promise<void> => {
  const modulePath = (name: string) =>
    pathToFileURL(join(process.cwd(), "packages/adapters/dist", name)).href;
  const script = `
    import { createPostgresRuntime } from ${JSON.stringify(modulePath("postgres/pool.js"))};
    import { PostgresTransactionUnit } from ${JSON.stringify(modulePath("postgres/transaction-unit.js"))};
    import { PostgresArtifactRegistry } from ${JSON.stringify(modulePath("artifacts/postgres-artifact-registry.js"))};
    import { createFilesystemArtifactStore } from ${JSON.stringify(modulePath("artifacts/filesystem-artifact-store.js"))};
    import { ArtifactMaintenance } from ${JSON.stringify(modulePath("artifacts/maintenance.js"))};
    const connection = JSON.parse(process.argv[1]);
    const rootDirectory = process.argv[2];
    const phase = process.argv[3];
    const policy = JSON.parse(process.argv[4]);
    const command = JSON.parse(process.argv[5]);
    const operation = process.argv[6] ?? "put";
    const runtime = createPostgresRuntime(connection, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const failpoint = async (point) => {
      if (point === phase) {
        process.stdout.write("C04-BOUNDARY:" + point + "\\n");
        await new Promise(() => undefined);
      }
    };
    const registry = new PostgresArtifactRegistry({ db: runtime.db, transactionUnit, pool: runtime.pool, failpoint });
    const store = await createFilesystemArtifactStore({
      rootDirectory,
      policy,
      registry,
      transactionUnit,
      failpoint,
    });
    if (operation === "put") {
      await store.put(command, (async function* () {
        yield new TextEncoder().encode("sigkill payload " + phase);
      })());
    } else {
      const maintenance = new ArtifactMaintenance({ rootDirectory, policy, store, registry, failpoint });
      await maintenance.sweepOrphans(command);
    }
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      script,
      JSON.stringify(connection),
      rootDirectory,
      phase,
      JSON.stringify(policy),
      JSON.stringify(command),
      operation,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let killed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (error === undefined) resolvePromise();
      else rejectPromise(error);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!killed && stdout.includes(`C04-BOUNDARY:${phase}`)) {
        killed = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (!killed) {
        finish(
          new Error(`SIGKILL child exited before ${phase}: ${code}/${signal}: ${stdout} ${stderr}`),
        );
      } else if (signal !== "SIGKILL") {
        finish(new Error(`SIGKILL child ended with ${signal ?? code}: ${stdout} ${stderr}`));
      } else {
        finish();
      }
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`SIGKILL child timed out at ${phase}: ${stdout} ${stderr}`));
    }, 30_000);
  });
};

describe("content-addressed artifact store", () => {
  let fixture: ArtifactTestFixture;
  let failAt: ArtifactFailpointV1 | undefined;

  beforeAll(async () => {
    fixture = await startArtifactFixture({
      failpoint: async (point) => {
        if (point === failAt) throw makeArtifactError("ARTIFACT_IO_FAILURE", `failpoint.${point}`);
      },
    });
  }, 120_000);

  afterAll(async () => {
    await fixture.close();
  }, 120_000);

  it("migration permission lifecycle keeps the app manifest table append-only", async () => {
    const constraints = await fixture.postgres.adminPool.query<{
      table_name: string;
      name: string;
      deferrable: boolean;
      deferred: boolean;
    }>(
      `SELECT conname AS name
              , conrelid::regclass::text AS table_name
              , condeferrable AS deferrable
              , condeferred AS deferred
       FROM pg_constraint
       WHERE conrelid IN (
         'business.artifact_manifests'::regclass,
         'business.artifact_access_records'::regclass,
         'business.artifact_maintenance_batches'::regclass
       )
       ORDER BY table_name, name`,
    );
    expect(constraints.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "artifact_manifests_pk",
        "artifact_manifests_kind_ck",
        "artifact_manifests_hash_ck",
        "artifact_manifests_version_ck",
        "artifact_manifests_command_fk",
        "artifact_manifests_audit_fk",
        "artifact_access_records_pk",
        "artifact_access_records_outcome_ck",
        "artifact_access_records_audit_fk",
        "artifact_maintenance_batches_pk",
        "artifact_maintenance_batches_operation_ck",
        "artifact_maintenance_batches_audit_fk",
      ]),
    );
    expect(
      constraints.rows
        .filter((row) => row.name.endsWith("_audit_fk"))
        .every((row) => row.deferrable && row.deferred),
    ).toBe(true);
    const indexes = await fixture.postgres.adminPool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'business'
         AND tablename IN ('artifact_manifests', 'artifact_access_records', 'artifact_maintenance_batches')`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "artifact_manifests_project_artifact_idx",
        "artifact_manifests_content_idx",
        "artifact_access_records_request_idx",
        "artifact_maintenance_batches_project_run_idx",
      ]),
    );
    const privileges = await fixture.postgres.adminPool.query<{
      table_name: string;
      privilege_type: string;
    }>(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = 'riskflow_app'
         AND table_schema = 'business'
         AND table_name IN ('artifact_manifests', 'artifact_access_records', 'artifact_maintenance_batches')`,
    );
    expect(privileges.rows).toEqual(
      expect.arrayContaining([
        { table_name: "artifact_manifests", privilege_type: "SELECT" },
        { table_name: "artifact_manifests", privilege_type: "INSERT" },
        { table_name: "artifact_access_records", privilege_type: "SELECT" },
        { table_name: "artifact_access_records", privilege_type: "INSERT" },
        { table_name: "artifact_maintenance_batches", privilege_type: "SELECT" },
        { table_name: "artifact_maintenance_batches", privilege_type: "INSERT" },
      ]),
    );
    expect(privileges.rows.some((row) => ["UPDATE", "DELETE"].includes(row.privilege_type))).toBe(
      false,
    );
    await expect(
      fixture.runtime.pool.query("UPDATE business.artifact_manifests SET purpose_code = 'x'"),
    ).rejects.toBeDefined();
    await expect(
      fixture.runtime.pool.query("DELETE FROM business.artifact_manifests"),
    ).rejects.toBeDefined();
    await expect(
      fixture.runtime.pool.query("UPDATE business.artifact_access_records SET stage = 'x'"),
    ).rejects.toBeDefined();
    await expect(
      fixture.runtime.pool.query("DELETE FROM business.artifact_access_records"),
    ).rejects.toBeDefined();
    await expect(
      fixture.runtime.pool.query(
        "UPDATE business.artifact_maintenance_batches SET dry_run = false",
      ),
    ).rejects.toBeDefined();
    await expect(
      fixture.runtime.pool.query("DELETE FROM business.artifact_maintenance_batches"),
    ).rejects.toBeDefined();
  }, 120_000);

  it("put persists, de-duplicates, and replays immutable manifests", async () => {
    const content = encoder.encode("same bytes");
    const firstCommand = putCommand("dedupe-one", { artifactId: "artifact-one" });
    const first = await fixture.store.put(firstCommand, chunks(content));
    const second = await fixture.store.put(
      putCommand("dedupe-two", { artifactId: "artifact-two" }),
      chunks(content),
    );
    expect(first.artifactRef.reference.versionId).toBe(`sha256:${digest(content)}`);
    expect(second.artifactRef.reference.versionId).toBe(first.artifactRef.reference.versionId);
    expect(await fixture.store.listObjectHashesForTesting()).toEqual([digest(content)]);

    const replay = await fixture.store.put(firstCommand, chunks(content));
    expect(replay.replayed).toBe(true);
    expect(replay.artifactRef).toEqual(first.artifactRef);
    await expectArtifactError(
      fixture.store.put(firstCommand, textChunks("different bytes")),
      "ARTIFACT_IDEMPOTENCY_CONFLICT",
    );
    const empty = await fixture.store.put(
      putCommand("empty", { artifactId: "artifact-empty" }),
      chunks(new Uint8Array()),
    );
    expect(empty.manifest.content.byteLength).toBe(0);
    expect(empty.manifest.content.hash.value).toBe(digest(new Uint8Array()));
    const rows = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.artifact_manifests",
    );
    expect(Number(rows.rows[0]?.count)).toBe(3);
    const audits = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE action = 'artifact.put'",
    );
    expect(Number(audits.rows[0]?.count)).toBe(3);
  });

  it("keeps a dedicated read-only snapshot stable across keyset batches", async () => {
    const countBefore = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.artifact_manifests WHERE project_id = $1",
      [projectId],
    );
    const snapshot = await fixture.registry.openManifestSnapshot(projectId);
    const iterator = snapshot.listManifests(1);
    let committed = false;
    try {
      const first = await iterator.next();
      expect(first.done).toBe(false);
      const late = await fixture.store.put(
        putCommand("snapshot-late", { artifactId: "zz-snapshot-late" }),
        textChunks("inserted after snapshot"),
      );
      const refs = first.value === undefined ? [] : [first.value.artifactRef];
      for await (const manifest of iterator) refs.push(manifest.artifactRef);
      expect(refs).toHaveLength(Number(countBefore.rows[0]?.count));
      expect(refs).not.toContainEqual(late.artifactRef);
      committed = true;
    } finally {
      await snapshot.close(committed);
    }
  });

  it("put rejects expected digest/length errors before registration", async () => {
    const content = encoder.encode("expected content");
    await expectArtifactError(
      fixture.store.put(
        putCommand("bad-digest", {
          expectedHash: { algorithm: "sha256", value: "0".repeat(64) },
        }),
        chunks(content),
      ),
      "ARTIFACT_HASH_MISMATCH",
    );
    await expectArtifactError(
      fixture.store.put(
        putCommand("bad-length", { expectedByteLength: content.byteLength + 1 }),
        chunks(content),
      ),
      "ARTIFACT_HASH_MISMATCH",
    );
    const rows = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.artifact_manifests WHERE artifact_id IN ('artifact-bad-digest', 'artifact-bad-length')",
    );
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

  it("put enforces the configured artifact byte ceiling", async () => {
    const limited = await createFilesystemArtifactStore({
      rootDirectory: join(fixture.rootDirectory, "limited-store"),
      policy: artifactPolicy({ maxArtifactBytes: 4, stagingMaxBytes: 8 }),
      registry: fixture.registry,
      transactionUnit: fixture.transactionUnit,
      failpoint: undefined,
    });
    try {
      await expectArtifactError(
        limited.put(
          putCommand("too-large", { artifactId: "artifact-too-large" }),
          textChunks("12345"),
        ),
        "ARTIFACT_TOO_LARGE",
      );
    } finally {
      await limited.close();
    }
  });

  it("crash failpoints leave no dangling manifest and response retry replays", async () => {
    const content = encoder.encode("failpoint content");
    for (const point of [
      "staging.sync",
      "object.link",
      "registry",
      "registry.handler",
      "audit.commit",
    ] as const) {
      failAt = point;
      await expectArtifactError(
        fixture.store.put(
          putCommand(`crash-${point}`, { artifactId: `artifact-${point}` }),
          chunks(content),
        ),
        point === "registry.handler" || point === "audit.commit"
          ? "ARTIFACT_REGISTRY_FAILURE"
          : "ARTIFACT_IO_FAILURE",
      );
      failAt = undefined;
      expect(
        await fixture.registry.readManifest(projectId, {
          kind: "content-artifact",
          reference: { entityId: `artifact-${point}`, versionId: `sha256:${digest(content)}` },
        }),
      ).toBeUndefined();
    }
    for (const point of ["database.commit", "response"] as const) {
      const command = putCommand(`crash-${point}`, { artifactId: `artifact-crash-${point}` });
      failAt = point;
      await expectArtifactError(fixture.store.put(command, chunks(content)), "ARTIFACT_IO_FAILURE");
      failAt = undefined;
      const committed = await fixture.registry.readManifest(projectId, {
        kind: "content-artifact",
        reference: { entityId: command.artifactId, versionId: `sha256:${digest(content)}` },
      });
      expect(committed).toBeDefined();
      const replay = await fixture.store.put(command, chunks(content));
      expect(replay.replayed).toBe(true);
    }
  });

  it("recovers real SIGKILLs at each persistence boundary", async () => {
    const phases = [
      "staging.sync",
      "object.link",
      "registry.handler",
      "audit.commit",
      "database.commit",
      "response",
    ] as const;
    for (const phase of phases) {
      const command = putCommand(`sigkill-${phase}`, {
        artifactId: `artifact-sigkill-${phase}`,
      });
      await killChildAtFailpoint(
        phase,
        fixture.postgres.app,
        fixture.rootDirectory,
        artifactPolicy(),
        command,
      );
      const fresh = await createContentAddressedArtifactStore({
        ...fixture.postgres.app,
        rootDirectory: fixture.rootDirectory,
        policy: artifactPolicy(),
      });
      try {
        const replay = await fresh.put(command, textChunks(`sigkill payload ${phase}`));
        expect(replay.replayed).toBe(phase === "database.commit" || phase === "response");
      } finally {
        await fresh.close();
      }
    }
  }, 180_000);

  it("closes quarantines after real SIGKILLs at maintenance boundaries", async () => {
    const phases = ["quarantine.rename", "audit", "audit.commit", "response"] as const;
    for (const phase of phases) {
      const content = encoder.encode(`maintenance sigkill orphan ${phase}`);
      const hash = digest(content);
      const objectPath = fixture.store.objectPathForTesting({ algorithm: "sha256", value: hash });
      await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
      await writeFile(objectPath, content, { mode: 0o600 });
      const old = new Date("2020-01-01T00:00:00.000Z");
      await utimes(objectPath, old, old);
      const command = {
        schemaVersion: "1" as const,
        runId: `maintenance-sigkill-${phase}`,
        commandId: `maintenance-sigkill-command-${phase}`,
        idempotencyKey: `maintenance-sigkill-idem-${phase}`,
        projectId,
        actorId: "actor-artifacts",
        authorization: authorization(),
        requiredCapability: "engineering-data.freeze" as const,
        policyRef,
        dryRun: false,
      };
      await killChildAtFailpoint(
        phase,
        fixture.postgres.app,
        fixture.rootDirectory,
        artifactPolicy(),
        command,
        "sweep",
      );
      const fresh = await createContentAddressedArtifactStore({
        ...fixture.postgres.app,
        rootDirectory: fixture.rootDirectory,
        policy: artifactPolicy(),
      });
      try {
        await fresh.maintenance.sweepOrphans(command);
      } finally {
        await fresh.close();
      }
      await expect(stat(objectPath)).rejects.toBeDefined();
      await expect(
        stat(join(fixture.rootDirectory, "quarantine", command.runId, hash)),
      ).rejects.toBeDefined();
    }
  }, 180_000);

  it("read only resolves verified after complete streaming reads", async () => {
    const content = encoder.encode("readable content");
    const result = await fixture.store.put(
      putCommand("read", { artifactId: "artifact-read" }),
      chunks(content, 3),
    );
    const handle = await fixture.store.open(readRequest("read", result.artifactRef));
    expect(await collect(handle.content)).toEqual(content);
    const receipt = await handle.verified;
    expect(receipt.artifactRef).toEqual(result.artifactRef);

    const replay = await fixture.store.open(readRequest("read", result.artifactRef));
    expect(await collect(replay.content)).toEqual(content);
    await expect(replay.verified).resolves.toMatchObject({ artifactRef: result.artifactRef });

    const second = await fixture.store.open(readRequest("read-cancel", result.artifactRef));
    await second.content[Symbol.asyncIterator]().return?.();
    await expect(second.verified).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILURE" });
    const accessRows = await fixture.postgres.adminPool.query<{
      request_id: string;
      outcome: string;
      diagnostic_ref: unknown;
    }>(
      `SELECT request_id, outcome, diagnostic_ref
       FROM business.artifact_access_records
       WHERE request_id IN ('request-read', 'request-read-cancel')
       ORDER BY request_id, outcome`,
    );
    expect(accessRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ request_id: "request-read", outcome: "authorized" }),
        expect.objectContaining({ request_id: "request-read", outcome: "succeeded" }),
        expect.objectContaining({ request_id: "request-read-cancel", outcome: "authorized" }),
        expect.objectContaining({ request_id: "request-read-cancel", outcome: "cancelled" }),
      ]),
    );
    expect(accessRows.rows.filter((row) => row.request_id === "request-read")).toHaveLength(2);
  });

  it("access inheritance preserves parent evidence without widening it", async () => {
    const parentAuth = authorization("actor-parent", {
      scopes: [scope("parent")],
      grants: [grant("parent")],
    });
    const evidence = {
      locator: { sourceSegmentId: "source-parent-segment" },
      sourceVersion: { entityId: "source-parent", versionId: "v1" },
    } as const;
    const parent = await fixture.store.put(
      putCommand("parent", {
        actorId: "actor-parent",
        artifactId: "artifact-parent",
        authorization: parentAuth,
        evidenceReferences: [evidence],
      }),
      textChunks("parent"),
    );
    const childAuth = authorization("actor-child", {
      scopes: [scope("parent"), scope("all")],
      grants: [grant("parent"), grant("all")],
    });
    const child = await fixture.store.put(
      putCommand("child", {
        actorId: "actor-child",
        artifactId: "artifact-child",
        authorization: childAuth,
        parentArtifactRefs: [parent.artifactRef],
      }),
      textChunks("child"),
    );
    expect(child.manifest.access.spatialScopeRefs).toEqual(
      expect.arrayContaining([scope("parent"), scope("all")]),
    );
    expect(child.manifest.evidenceReferences).toEqual([evidence]);
    await expectArtifactError(
      fixture.store.open(
        readRequest("child-denied", child.artifactRef, {
          authorization: authorization("actor-other", {
            scopes: [scope("all")],
            grants: [grant("all")],
          }),
        }),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );
    const denied = await fixture.postgres.adminPool.query<{ outcome: string }>(
      `SELECT outcome
       FROM business.artifact_access_records
       WHERE request_id = 'request-child-denied'`,
    );
    expect(denied.rows).toEqual([{ outcome: "denied" }]);
  });

  it("reference guard runs in a transaction and hides missing objects", async () => {
    const content = encoder.encode("guarded");
    const result = await fixture.store.put(
      putCommand("guard", { artifactId: "artifact-guard" }),
      chunks(content),
    );
    const command: AtomicCommandV1 = {
      projectId,
      commandKind: "artifact-guard-test",
      commandId: "artifact-guard-command",
      idempotencyKey: "artifact-guard-idem",
      payload: { artifactRef: result.artifactRef },
      actorRef: "actor-artifacts",
      authorizationContextRef: authorization().authorizationContextRef,
      issuedAt: ARTIFACT_TEST_TIMESTAMP,
    };
    let checked: Awaited<ReturnType<typeof fixture.registry.assertUsable>> | undefined;
    await fixture.transactionUnit.execute(command, async (context: TransactionContextV1) => {
      checked = await fixture.registry.assertUsable(context, {
        schemaVersion: "1",
        artifactRef: result.artifactRef,
        projectId,
        purposeCode: "engineering-input",
        requiredCapability: "engineering-data.read",
        authorization: authorization(),
      });
      await getPostgresTransaction(context)
        .insertInto("business.fixture_facts")
        .values({
          fact_id: "artifact-guard-fact",
          project_id: projectId,
          value: 1,
          occurred_at: ARTIFACT_TEST_TIMESTAMP,
        })
        .execute();
      return {
        resultRef: result.artifactRef,
        audit: {
          auditEntryId: "artifact-guard-audit",
          projectId,
          action: "artifact.reference-checked",
          targetRef: result.artifactRef,
          actorRef: command.actorRef,
          authorizationContextRef: command.authorizationContextRef,
          occurredAt: ARTIFACT_TEST_TIMESTAMP,
          recordedAt: ARTIFACT_TEST_TIMESTAMP,
          version: result.artifactRef.reference,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
        },
        events: [],
      };
    });
    expect(checked?.artifactRef).toEqual(result.artifactRef);
    const committedFact = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.fixture_facts WHERE fact_id = 'artifact-guard-fact'",
    );
    expect(Number(committedFact.rows[0]?.count)).toBe(1);
    const invalidCommand = {
      ...command,
      commandId: "artifact-guard-missing-command",
      idempotencyKey: "artifact-guard-missing-idem",
    };
    await expect(
      fixture.transactionUnit.execute(invalidCommand, async (context) => {
        await getPostgresTransaction(context)
          .insertInto("business.fixture_facts")
          .values({
            fact_id: "artifact-guard-rolled-back-fact",
            project_id: projectId,
            value: 1,
            occurred_at: ARTIFACT_TEST_TIMESTAMP,
          })
          .execute();
        await fixture.registry.assertUsable(context, {
          schemaVersion: "1",
          artifactRef: {
            kind: "content-artifact",
            reference: { entityId: "missing", versionId: `sha256:${"1".repeat(64)}` },
          },
          projectId,
          purposeCode: "engineering-input",
          requiredCapability: "engineering-data.read",
          authorization: authorization(),
        });
        throw new Error("unreachable");
      }),
    ).rejects.toBeDefined();
    const rolledBackFact = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.fixture_facts WHERE fact_id = 'artifact-guard-rolled-back-fact'",
    );
    expect(Number(rolledBackFact.rows[0]?.count)).toBe(0);
    await expectArtifactError(
      fixture.store.open(
        readRequest("missing", {
          kind: "content-artifact",
          reference: { entityId: "missing", versionId: `sha256:${"1".repeat(64)}` },
        }),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );
  });

  it("maps missing, cross-project, and unauthorized parents to access denial before staging", async () => {
    const missingBefore = await fixture.store.listObjectHashesForTesting();
    await expectArtifactError(
      fixture.store.put(
        putCommand("parent-missing", {
          artifactId: "artifact-parent-missing",
          parentArtifactRefs: [
            {
              kind: "content-artifact",
              reference: { entityId: "does-not-exist", versionId: `sha256:${"1".repeat(64)}` },
            },
          ],
        }),
        textChunks("must not stage"),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );
    expect(await fixture.store.listObjectHashesForTesting()).toEqual(missingBefore);

    const otherParent = await fixture.store.put(
      putCommand("parent-other-project", {
        artifactId: "artifact-parent-other-project",
        authorization: authorization("actor-other-project", { project: "project-other" }),
      }),
      textChunks("other project parent"),
    );
    const crossProjectBefore = await fixture.store.listObjectHashesForTesting();
    await expectArtifactError(
      fixture.store.put(
        putCommand("parent-cross-project", {
          artifactId: "artifact-parent-cross-project",
          parentArtifactRefs: [otherParent.artifactRef],
        }),
        textChunks("must not stage"),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );
    expect(await fixture.store.listObjectHashesForTesting()).toEqual(crossProjectBefore);

    const restrictedParent = await fixture.store.put(
      putCommand("parent-restricted", {
        artifactId: "artifact-parent-restricted",
        authorization: authorization("actor-restricted", {
          scopes: [scope("parent")],
          grants: [grant("parent")],
        }),
      }),
      textChunks("restricted parent"),
    );
    const unauthorizedBefore = await fixture.store.listObjectHashesForTesting();
    await expectArtifactError(
      fixture.store.put(
        putCommand("parent-unauthorized", {
          artifactId: "artifact-parent-unauthorized",
          authorization: authorization("actor-without-parent", {
            scopes: [scope("all")],
            grants: [grant("all")],
          }),
          parentArtifactRefs: [restrictedParent.artifactRef],
        }),
        textChunks("must not stage"),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );
    expect(await fixture.store.listObjectHashesForTesting()).toEqual(unauthorizedBefore);

    const missingScopeParent = await fixture.store.put(
      putCommand("parent-missing-scope", {
        artifactId: "artifact-parent-missing-scope",
        authorization: authorization("actor-parent-missing-scope", {
          scopes: [scope("all"), scope("parent")],
          grants: [grant("all"), grant("parent")],
        }),
      }),
      textChunks("scope parent"),
    );
    await expectArtifactError(
      fixture.store.put(
        putCommand("parent-missing-scope-child", {
          artifactId: "artifact-parent-missing-scope-child",
          authorization: authorization("actor-missing-scope-child", {
            scopes: [scope("all")],
            grants: [grant("all"), grant("parent")],
          }),
          parentArtifactRefs: [missingScopeParent.artifactRef],
        }),
        textChunks("must not stage"),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );

    const missingGrantParent = await fixture.store.put(
      putCommand("parent-missing-grant", {
        artifactId: "artifact-parent-missing-grant",
        authorization: authorization("actor-parent-missing-grant", {
          scopes: [scope("all"), scope("parent")],
          grants: [grant("all"), grant("parent")],
        }),
      }),
      textChunks("grant parent"),
    );
    await expectArtifactError(
      fixture.store.put(
        putCommand("parent-missing-grant-child", {
          artifactId: "artifact-parent-missing-grant-child",
          authorization: authorization("actor-missing-grant-child", {
            scopes: [scope("all"), scope("parent")],
            grants: [grant("all")],
          }),
          parentArtifactRefs: [missingGrantParent.artifactRef],
        }),
        textChunks("must not stage"),
      ),
      "ARTIFACT_ACCESS_DENIED",
    );

    await expectArtifactError(
      fixture.maintenance.sweepOrphans({
        schemaVersion: "1",
        runId: "wrong-policy-sweep",
        commandId: "wrong-policy-command",
        idempotencyKey: "wrong-policy-idem",
        projectId,
        actorId: "actor-artifacts",
        authorization: authorization(),
        requiredCapability: "engineering-data.freeze",
        policyRef: { entityId: "wrong-policy", versionId: "v1" },
        dryRun: true,
      }),
      "ARTIFACT_INPUT_INVALID",
    );
  });

  it("hash manifest writes deterministically and reconciles database and files", async () => {
    await fixture.store.put(
      putCommand("hash-source", { artifactId: "hash-source" }),
      textChunks("hash source"),
    );
    const command = {
      schemaVersion: "1",
      commandId: "hash-manifest-command",
      idempotencyKey: "hash-manifest-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-manifest",
      backupBatchRef: { entityId: "backup", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database", versionId: "v1" },
      fileSnapshotRef: { entityId: "files", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    } as const;
    const result = await fixture.maintenance.createHashManifest(command);
    const request = {
      schemaVersion: "1" as const,
      runId: "reconcile-run",
      projectId,
      mode: "audit" as const,
      authorization: authorization(),
      requiredCapability: "engineering-data.read" as const,
      policyRef,
      hashManifestRef: result.artifactRef,
      databaseSnapshotRef: { entityId: "database", versionId: "v1" },
      fileSnapshotRef: { entityId: "files", versionId: "v1" },
    };
    const handle = fixture.maintenance.reconcile(request);
    const findings = [];
    for await (const finding of handle.findings) findings.push(finding);
    const summary = await handle.summary;
    expect(findings.filter((finding) => finding.kind === "complete").length).toBeGreaterThan(0);
    expect(summary.passed).toBe(true);
    await fixture.store.put(
      putCommand("hash-replay-marker", { artifactId: "hash-replay-marker" }),
      textChunks("change the current snapshot"),
    );
    const replay = await fixture.maintenance.createHashManifest(command);
    expect(replay.replayed).toBe(true);
    expect(replay.artifactRef).toEqual(result.artifactRef);
  });

  it("keeps historical versions visible while excluding only the exact hash reference", async () => {
    const first = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-history-command-1",
      idempotencyKey: "hash-history-idem-1",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-history-manifest",
      backupBatchRef: { entityId: "backup-history", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-history", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-history", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    });
    await fixture.store.put(
      putCommand("hash-history-marker", { artifactId: "hash-history-marker" }),
      textChunks("new historical input"),
    );
    const second = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-history-command-2",
      idempotencyKey: "hash-history-idem-2",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-history-manifest",
      backupBatchRef: { entityId: "backup-history-2", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-history-2", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-history-2", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    });
    expect(second.artifactRef.reference.versionId).not.toBe(first.artifactRef.reference.versionId);
    const handle = fixture.maintenance.reconcile({
      schemaVersion: "1",
      runId: "hash-history-reconcile",
      projectId,
      mode: "audit",
      authorization: authorization(),
      requiredCapability: "engineering-data.read",
      policyRef,
      hashManifestRef: first.artifactRef,
      databaseSnapshotRef: { entityId: "database-history", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-history", versionId: "v1" },
    });
    const findings = [];
    for await (const finding of handle.findings) findings.push(finding);
    await handle.summary;
    expect(
      findings.some(
        (finding) =>
          finding.kind === "manifest-conflict" &&
          finding.artifactRef.reference.entityId === "hash-history-manifest" &&
          finding.artifactRef.reference.versionId === second.artifactRef.reference.versionId,
      ),
    ).toBe(true);
  });

  it("blocks recovery before findings when any project manifest is unauthorized", async () => {
    const hash = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-recovery-auth-command",
      idempotencyKey: "hash-recovery-auth-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-recovery-auth-manifest",
      backupBatchRef: { entityId: "backup-recovery-auth", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-recovery-auth", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-recovery-auth", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    });
    const restrictedAuthorization = authorization("actor-recovery-restricted", {
      scopes: [scope("all")],
      grants: [grant("all")],
      capabilities: ["engineering-data.freeze"],
    });
    const handle = fixture.maintenance.reconcile({
      schemaVersion: "1",
      runId: "recovery-auth-blocked",
      projectId,
      mode: "recovery",
      authorization: restrictedAuthorization,
      requiredCapability: "engineering-data.freeze",
      policyRef,
      hashManifestRef: hash.artifactRef,
      databaseSnapshotRef: { entityId: "database-recovery-auth", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-recovery-auth", versionId: "v1" },
    });
    const findings: unknown[] = [];
    await expectArtifactError(
      (async () => {
        for await (const finding of handle.findings) findings.push(finding);
      })(),
      "ARTIFACT_RECOVERY_BLOCKED",
    );
    expect(findings).toHaveLength(0);
    await expect(handle.summary).rejects.toMatchObject({ code: "ARTIFACT_RECOVERY_BLOCKED" });
  });

  it("keeps recovery authorization and findings on one database snapshot", async () => {
    const snapshotProjectId = "project-recovery-snapshot";
    const snapshotAuthorization = authorization("actor-artifacts", {
      project: snapshotProjectId,
      scopes: [scope("all")],
      grants: [grant("all")],
    });
    await fixture.store.put(
      putCommand("recovery-snapshot-source", { authorization: snapshotAuthorization }),
      textChunks("snapshot source"),
    );
    const hash = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-recovery-snapshot-command",
      idempotencyKey: "hash-recovery-snapshot-idem",
      projectId: snapshotProjectId,
      actorId: "actor-artifacts",
      authorization: snapshotAuthorization,
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-recovery-snapshot-manifest",
      backupBatchRef: { entityId: "backup-recovery-snapshot", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-recovery-snapshot", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-recovery-snapshot", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    });
    const handle = fixture.maintenance.reconcile({
      schemaVersion: "1",
      runId: "recovery-snapshot",
      projectId: snapshotProjectId,
      mode: "recovery",
      authorization: snapshotAuthorization,
      requiredCapability: "engineering-data.freeze",
      policyRef,
      hashManifestRef: hash.artifactRef,
      databaseSnapshotRef: { entityId: "database-recovery-snapshot", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-recovery-snapshot", versionId: "v1" },
    });
    const findings = handle.findings[Symbol.asyncIterator]();
    expect((await findings.next()).done).toBe(false);
    const privateAuthorization = authorization("actor-private", {
      project: snapshotProjectId,
      scopes: [scope("private")],
      grants: [grant("private")],
    });
    await fixture.store.put(
      putCommand("recovery-concurrent-private", { authorization: privateAuthorization }),
      textChunks("concurrent private content"),
    );
    for (;;) {
      const finding = await findings.next();
      if (finding.done) break;
    }
    await expect(handle.summary).resolves.toMatchObject({ passed: true });
  });

  it("reconcile blocks missing content and reports stale staging", async () => {
    const content = encoder.encode("reconcile missing");
    const result = await fixture.store.put(
      putCommand("reconcile-missing", { artifactId: "artifact-reconcile-missing" }),
      chunks(content),
    );
    const hashManifest = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-manifest-edge-command",
      idempotencyKey: "hash-manifest-edge-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-manifest-edge",
      backupBatchRef: { entityId: "backup-edge", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-edge", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-edge", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    });
    await rm(fixture.store.objectPathForTesting(result.manifest.content.hash));
    const stalePath = join(fixture.rootDirectory, "staging", "stale-edge.part");
    await writeFile(stalePath, "stale", { mode: 0o600 });
    const stale = new Date("2020-01-01T00:00:00.000Z");
    await utimes(stalePath, stale, stale);
    const handle = fixture.maintenance.reconcile({
      schemaVersion: "1",
      runId: "reconcile-edge",
      projectId,
      mode: "recovery",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      policyRef,
      hashManifestRef: hashManifest.artifactRef,
      databaseSnapshotRef: { entityId: "database-edge", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-edge", versionId: "v1" },
    });
    const findings = [];
    for await (const finding of handle.findings) findings.push(finding);
    const summary = await handle.summary;
    expect(findings.some((finding) => finding.kind === "missing-object")).toBe(true);
    expect(findings.some((finding) => finding.kind === "stale-staging")).toBe(true);
    expect(summary.passed).toBe(false);
    await writeFile(fixture.store.objectPathForTesting(result.manifest.content.hash), content, {
      mode: 0o600,
    });
    await rm(stalePath);
  });

  it("reconcile detects corruption and sweep restores after audit failure", async () => {
    const content = encoder.encode("reconcile corruption");
    const result = await fixture.store.put(
      putCommand("reconcile-corrupt", { artifactId: "artifact-reconcile-corrupt" }),
      chunks(content),
    );
    const hashManifest = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-manifest-corrupt-command",
      idempotencyKey: "hash-manifest-corrupt-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze",
      manifestId: "hash-manifest-corrupt",
      backupBatchRef: { entityId: "backup-corrupt", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-corrupt", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-corrupt", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policyRef,
    });
    const objectPath = fixture.store.objectPathForTesting(result.manifest.content.hash);
    await writeFile(objectPath, encoder.encode("tampered corruption"), { mode: 0o600 });
    const handle = fixture.maintenance.reconcile({
      schemaVersion: "1",
      runId: "reconcile-corrupt",
      projectId,
      mode: "audit",
      authorization: authorization(),
      requiredCapability: "engineering-data.read",
      policyRef,
      hashManifestRef: hashManifest.artifactRef,
      databaseSnapshotRef: { entityId: "database-corrupt", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-corrupt", versionId: "v1" },
    });
    const findings = [];
    for await (const finding of handle.findings) findings.push(finding);
    const summary = await handle.summary;
    expect(findings.some((finding) => finding.kind === "content-mismatch")).toBe(true);
    expect(summary.passed).toBe(false);
    await writeFile(objectPath, content, { mode: 0o600 });

    const orphanContent = encoder.encode("audit restore orphan");
    const orphanHash = digest(orphanContent);
    const orphanPath = fixture.store.objectPathForTesting({
      algorithm: "sha256",
      value: orphanHash,
    });
    await mkdir(dirname(orphanPath), { recursive: true, mode: 0o700 });
    await writeFile(orphanPath, orphanContent, { mode: 0o600 });
    const old = new Date("2020-01-01T00:00:00.000Z");
    await utimes(orphanPath, old, old);
    const command = {
      schemaVersion: "1" as const,
      runId: "orphan-audit-restore",
      commandId: "orphan-audit-restore-command",
      idempotencyKey: "orphan-audit-restore-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze" as const,
      policyRef,
      dryRun: false,
    };
    failAt = "audit";
    await expectArtifactError(fixture.maintenance.sweepOrphans(command), "ARTIFACT_IO_FAILURE");
    failAt = undefined;
    const quarantinedPath = join(fixture.rootDirectory, "quarantine", command.runId, orphanHash);
    await expect(stat(quarantinedPath)).resolves.toBeDefined();
    await expect(truncate(orphanPath, 0)).rejects.toBeDefined();
    const swept = await fixture.maintenance.sweepOrphans({
      ...command,
      runId: "orphan-audit-restore-2",
      commandId: "orphan-audit-restore-command-2",
      idempotencyKey: "orphan-audit-restore-idem-2",
    });
    expect(swept.orphanRemoved).toBeGreaterThanOrEqual(1);
    await expect(truncate(orphanPath, 0)).rejects.toBeDefined();
  });

  it("maintenance reports a busy advisory lock as retryable", async () => {
    const client = await fixture.postgres.adminPool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('riskflow.c04.artifact-store'))");
      await expectArtifactError(
        fixture.maintenance.sweepOrphans({
          schemaVersion: "1",
          runId: "busy-sweep",
          commandId: "busy-sweep-command",
          idempotencyKey: "busy-sweep-idem",
          projectId,
          actorId: "actor-artifacts",
          authorization: authorization(),
          requiredCapability: "engineering-data.freeze",
          policyRef,
          dryRun: true,
        }),
        "ARTIFACT_MAINTENANCE_BUSY",
      );
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('riskflow.c04.artifact-store'))");
      client.release();
    }
  });

  it("maintenance reports and then removes only old unreferenced objects", async () => {
    const bytes = encoder.encode("orphan-object");
    const hash = digest(bytes);
    const path = fixture.store.objectPathForTesting({ algorithm: "sha256", value: hash });
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
    const old = new Date("2020-01-01T00:00:00.000Z");
    await utimes(path, old, old);
    const command = {
      schemaVersion: "1" as const,
      runId: "orphan-sweep",
      commandId: "orphan-sweep-command",
      idempotencyKey: "orphan-sweep-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.freeze" as const,
      policyRef,
      dryRun: true,
    };
    const dryRun = await fixture.maintenance.sweepOrphans(command);
    expect(dryRun.orphanObserved).toBeGreaterThanOrEqual(1);
    const swept = await fixture.maintenance.sweepOrphans({
      ...command,
      runId: "orphan-sweep-2",
      commandId: "orphan-sweep-command-2",
      idempotencyKey: "orphan-sweep-idem-2",
      dryRun: false,
    });
    expect(swept.orphanRemoved).toBeGreaterThanOrEqual(1);
    await expect(truncate(path, 0)).rejects.toBeDefined();
  });

  it("continues through every bounded maintenance batch", async () => {
    const boundedRoot = join(fixture.rootDirectory, "bounded-sweep");
    const boundedPolicy = artifactPolicy({ maintenanceBatchSize: 2 });
    const boundedStore = await createFilesystemArtifactStore({
      rootDirectory: boundedRoot,
      policy: boundedPolicy,
      registry: fixture.registry,
      transactionUnit: fixture.transactionUnit,
    });
    try {
      const old = new Date("2020-01-01T00:00:00.000Z");
      for (let index = 0; index < 5; index += 1) {
        const content = encoder.encode(`bounded orphan ${index}`);
        const objectPath = boundedStore.objectPathForTesting({
          algorithm: "sha256",
          value: digest(content),
        });
        await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
        await writeFile(objectPath, content, { mode: 0o600 });
        await utimes(objectPath, old, old);
      }
      const runId = "bounded-sweep-run";
      await new ArtifactMaintenance({
        rootDirectory: boundedRoot,
        policy: boundedPolicy,
        store: boundedStore,
        registry: fixture.registry,
      }).sweepOrphans({
        schemaVersion: "1",
        runId,
        commandId: "bounded-sweep-command",
        idempotencyKey: "bounded-sweep-idem",
        projectId,
        actorId: "actor-artifacts",
        authorization: authorization(),
        requiredCapability: "engineering-data.freeze",
        policyRef,
        dryRun: false,
      });
      expect((await fixture.registry.listMaintenanceBatches(projectId, runId)).length).toBe(3);
    } finally {
      await boundedStore.close();
    }
  });

  it("integrity rejects a symlink in the content-addressed object path", async () => {
    const content = encoder.encode("symlink target");
    const result = await fixture.store.put(
      putCommand("symlink", { artifactId: "artifact-symlink" }),
      chunks(content),
    );
    const path = fixture.store.objectPathForTesting(result.manifest.content.hash);
    await rm(path);
    await writeFile(`${path}.outside`, content);
    const { symlink } = await import("node:fs/promises");
    await symlink(`${path}.outside`, path);
    await expectArtifactError(
      fixture.store.open(readRequest("symlink", result.artifactRef)),
      "ARTIFACT_INTEGRITY_FAILURE",
    );
    const integrity = await fixture.postgres.adminPool.query<{
      outcome: string;
      diagnostic_ref: unknown;
    }>(
      `SELECT outcome, diagnostic_ref
       FROM business.artifact_access_records
       WHERE request_id = 'request-symlink' AND outcome = 'integrity-failed'`,
    );
    expect(integrity.rows).toEqual([
      expect.objectContaining({ outcome: "integrity-failed", diagnostic_ref: expect.anything() }),
    ]);
    await rm(path, { recursive: true });
    await rm(`${path}.outside`);
    await fixture.store.put(
      putCommand("symlink", { artifactId: "artifact-symlink" }),
      chunks(content),
    );
    await rm(path);
    await mkdir(path, { mode: 0o700 });
    await expectArtifactError(
      fixture.store.open(readRequest("directory", result.artifactRef)),
      "ARTIFACT_INTEGRITY_FAILURE",
    );
    await rm(path, { recursive: true });
    await fixture.store.put(
      putCommand("symlink", { artifactId: "artifact-symlink" }),
      chunks(content),
    );
    await chmod(path, 0o000);
    await expectArtifactError(
      fixture.store.open(readRequest("permissions", result.artifactRef)),
      "ARTIFACT_IO_FAILURE",
    );
    await chmod(path, 0o600);
  });

  it("integrity rejects a Unix socket in the content-addressed object path", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "c04-socket-"));
    const store = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry: fixture.registry,
      transactionUnit: fixture.transactionUnit,
    });
    let server: ReturnType<typeof createServer> | undefined;
    try {
      const result = await store.put(
        putCommand("unix-socket", { artifactId: "artifact-unix-socket" }),
        textChunks("unix socket target"),
      );
      const path = store.objectPathForTesting(result.manifest.content.hash);
      await rm(path);
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, resolve);
      });
      await expectArtifactError(
        store.open(readRequest("unix-socket", result.artifactRef)),
        "ARTIFACT_INTEGRITY_FAILURE",
      );
    } finally {
      await new Promise<void>((resolve) => {
        if (server === undefined) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      await store.close();
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });

  it("records a diagnostic before rejecting a truncated object", async () => {
    const content = encoder.encode("truncate me");
    const result = await fixture.store.put(
      putCommand("truncated", { artifactId: "artifact-truncated" }),
      textChunks("truncate me"),
    );
    const path = fixture.store.objectPathForTesting(result.manifest.content.hash);
    await truncate(path, content.byteLength - 1);
    await expectArtifactError(
      fixture.store.open(readRequest("truncated", result.artifactRef)),
      "ARTIFACT_INTEGRITY_FAILURE",
    );
    const records = await fixture.postgres.adminPool.query<{
      outcome: string;
      diagnostic_ref: unknown;
    }>(
      `SELECT outcome, diagnostic_ref
       FROM business.artifact_access_records
       WHERE request_id = 'request-truncated' AND outcome = 'integrity-failed'`,
    );
    expect(records.rows).toEqual([
      expect.objectContaining({ outcome: "integrity-failed", diagnostic_ref: expect.anything() }),
    ]);
    await writeFile(path, content, { mode: 0o600 });
  });

  it("performance keeps large and concurrent transfers bounded to configured chunks", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill(17);
    const storageBefore = await statfs(fixture.rootDirectory);
    const initialObjects = await fixture.store.listObjectHashesForTesting();
    const sampler = startPerformanceSampling(fixture.rootDirectory);
    const largeByteLength = 256 * 1024 * 1024;
    const largeHash = createHash("sha256");
    for (let index = 0; index < 256; index += 1) largeHash.update(chunk);
    const coldWriteStarted = performance.now();
    const large = await fixture.store.put(
      putCommand("large", {
        artifactId: "artifact-large",
        expectedByteLength: largeByteLength,
        expectedHash: { algorithm: "sha256", value: largeHash.digest("hex") },
      }),
      (async function* () {
        for (let index = 0; index < 256; index += 1) yield chunk;
      })(),
    );
    const coldWriteMs = performance.now() - coldWriteStarted;
    const read = await fixture.store.open(readRequest("large", large.artifactRef));
    const readHash = createHash("sha256");
    let readLength = 0;
    const hotReadStarted = performance.now();
    for await (const part of read.content) {
      expect(part.byteLength).toBeLessThanOrEqual(1024 * 1024);
      readHash.update(part);
      readLength += part.byteLength;
    }
    await read.verified;
    const hotReadMs = performance.now() - hotReadStarted;
    expect(readLength).toBe(largeByteLength);
    expect(readHash.digest("hex")).toBe(large.manifest.content.hash.value);

    const concurrentStarted = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        fixture.store.put(
          putCommand(`concurrent-${index}`, { artifactId: `artifact-concurrent-${index}` }),
          (async function* () {
            const payload = index < 8 ? chunk : new Uint8Array(chunk.length).fill(index + 17);
            for (let part = 0; part < 16; part += 1) yield payload;
          })(),
        ),
      ),
    );
    const concurrentWriteMs = performance.now() - concurrentStarted;
    expect(
      new Set(concurrent.slice(0, 8).map((item) => item.artifactRef.reference.versionId)).size,
    ).toBe(1);
    expect(
      new Set(concurrent.slice(8).map((item) => item.artifactRef.reference.versionId)).size,
    ).toBe(8);
    const storageAfter = await statfs(fixture.rootDirectory);
    const finalObjects = await fixture.store.listObjectHashesForTesting();
    const performanceMetrics = sampler.stop();
    const requests = 1 + concurrent.length;
    const uniqueObjects = finalObjects.length - initialObjects.length;
    console.info(
      "artifact performance",
      JSON.stringify({
        node: process.version,
        os: `${process.platform}/${process.arch}`,
        storage: {
          type: storageBefore.type,
          blockSize: storageBefore.bsize,
          freeBytesBefore: Number(storageBefore.bfree) * Number(storageBefore.bsize),
          freeBytesAfter: Number(storageAfter.bfree) * Number(storageAfter.bsize),
        },
        coldWriteMs,
        coldWriteMiBPerSecond: largeByteLength / 1024 / 1024 / (coldWriteMs / 1000),
        hotReadMs,
        hotReadMiBPerSecond: largeByteLength / 1024 / 1024 / (hotReadMs / 1000),
        concurrentWriteMs,
        concurrentWriteMiBPerSecond:
          (16 * 16 * 1024 * 1024) / 1024 / 1024 / (concurrentWriteMs / 1000),
        peakHeapBytes: performanceMetrics.peakHeapBytes,
        peakFileDescriptors: performanceMetrics.peakFileDescriptors,
        peakStagingFiles: performanceMetrics.peakStagingFiles,
        requests,
        uniqueObjects,
        dedupRate: 1 - uniqueObjects / requests,
      }),
    );
  }, 180_000);

  it("performance reconciles a ten-thousand-entry streamed manifest on real PostgreSQL", async () => {
    const syntheticProjectId = "project-artifacts-synthetic";
    const syntheticAuthorization = authorization("actor-artifacts", {
      project: syntheticProjectId,
    });
    const performanceRoot = await mkdtemp(join(tmpdir(), "c04-artifact-performance-"));
    const performancePolicy = artifactPolicy();
    const performanceStore = await createFilesystemArtifactStore({
      rootDirectory: performanceRoot,
      policy: performancePolicy,
      registry: fixture.registry,
      transactionUnit: fixture.transactionUnit,
    });
    const performanceMaintenance = new ArtifactMaintenance({
      rootDirectory: performanceRoot,
      policy: performancePolicy,
      store: performanceStore,
      registry: fixture.registry,
    });
    try {
      const seed = await performanceStore.put(
        putCommand("synthetic-seed", {
          artifactId: "synthetic-seed",
          authorization: syntheticAuthorization,
        }),
        textChunks("s"),
      );
      await seedSyntheticManifests(fixture, syntheticProjectId, seed, 10_000);
      const storageBefore = await statfs(performanceRoot);
      const sampler = startPerformanceSampling(performanceRoot);
      const hashStarted = performance.now();
      const hash = await performanceMaintenance.createHashManifest({
        schemaVersion: "1",
        commandId: "synthetic-hash-command",
        idempotencyKey: "synthetic-hash-idem",
        projectId: syntheticProjectId,
        actorId: "actor-artifacts",
        authorization: syntheticAuthorization,
        requiredCapability: "engineering-data.freeze",
        manifestId: "synthetic-manifest",
        backupBatchRef: { entityId: "backup-large", versionId: "v1" },
        databaseSnapshotRef: { entityId: "database-large", versionId: "v1" },
        fileSnapshotRef: { entityId: "files-large", versionId: "v1" },
        purposeCode: "artifact-hash-manifest",
        generatedAt: ARTIFACT_TEST_TIMESTAMP,
        policyRef,
      });
      const hashManifestMs = performance.now() - hashStarted;
      const reconcileStarted = performance.now();
      const request = {
        schemaVersion: "1" as const,
        runId: "synthetic-reconcile",
        projectId: syntheticProjectId,
        mode: "audit" as const,
        authorization: syntheticAuthorization,
        requiredCapability: "engineering-data.read" as const,
        policyRef,
        hashManifestRef: hash.artifactRef,
        databaseSnapshotRef: { entityId: "database-large", versionId: "v1" },
        fileSnapshotRef: { entityId: "files-large", versionId: "v1" },
      };
      const handle = performanceMaintenance.reconcile(request);
      let count = 0;
      for await (const finding of handle.findings) {
        if (finding.kind === "complete") count += 1;
      }
      const summary = await handle.summary;
      const reconcileMs = performance.now() - reconcileStarted;
      const storageAfter = await statfs(performanceRoot);
      const performanceMetrics = sampler.stop();
      console.info(
        "artifact 10k performance",
        JSON.stringify({
          node: process.version,
          os: `${process.platform}/${process.arch}`,
          count,
          hashManifestMs,
          hashManifestEntriesPerSecond: count / (hashManifestMs / 1000),
          reconcileMs,
          reconcileEntriesPerSecond: count / (reconcileMs / 1000),
          peakHeapBytes: performanceMetrics.peakHeapBytes,
          peakFileDescriptors: performanceMetrics.peakFileDescriptors,
          peakStagingFiles: performanceMetrics.peakStagingFiles,
          storageFreeBytesBefore: Number(storageBefore.bfree) * Number(storageBefore.bsize),
          storageFreeBytesAfter: Number(storageAfter.bfree) * Number(storageAfter.bsize),
        }),
      );
      expect(count).toBe(10_001);
      expect(summary.counts.complete).toBe(10_001);
      expect(summary.passed).toBe(true);
    } finally {
      await performanceStore.close();
      await rm(performanceRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
