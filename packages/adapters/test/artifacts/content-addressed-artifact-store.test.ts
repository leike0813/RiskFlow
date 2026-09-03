import { createHash } from "node:crypto";
import { mkdir, rm, statfs, truncate, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactStoreError,
  makeArtifactError,
  type ArtifactPutCommandV1,
  type ArtifactReadRequestV1,
} from "@riskflow/core/artifacts";
import {
  canonicalJson,
  type AtomicCommandV1,
  type TransactionContextV1,
} from "@riskflow/core/persistence";
import { AuthorizationContextV1Schema } from "@riskflow/contracts/ports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ARTIFACT_TEST_TIMESTAMP,
  artifactPolicy,
  startArtifactFixture,
  type ArtifactTestFixture,
} from "./fixture.js";
import type { ArtifactFailpointV1 } from "../../src/artifacts/filesystem-artifact-store.js";
import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
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
    readonly capabilities?: readonly ("engineering-data.read" | "engineering-data.write")[];
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
    ],
    spatialScopeRefs: options.scopes ?? [scope("all")],
    sourceAccessGrantRefs: options.grants ?? [grant("all")],
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
    const constraints = await fixture.postgres.adminPool.query<{ name: string }>(
      `SELECT conname AS name
       FROM pg_constraint
       WHERE conrelid = 'business.artifact_manifests'::regclass
       ORDER BY conname`,
    );
    expect(constraints.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "artifact_manifests_pk",
        "artifact_manifests_kind_ck",
        "artifact_manifests_hash_ck",
        "artifact_manifests_version_ck",
        "artifact_manifests_command_fk",
        "artifact_manifests_audit_fk",
      ]),
    );
    await expect(
      fixture.runtime.pool.query("UPDATE business.artifact_manifests SET purpose_code = 'x'"),
    ).rejects.toBeDefined();
    await expect(
      fixture.runtime.pool.query("DELETE FROM business.artifact_manifests"),
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

    const second = await fixture.store.open(readRequest("read-cancel", result.artifactRef));
    await second.content[Symbol.asyncIterator]().return?.();
    await expect(second.verified).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILURE" });
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

  it("hash manifest writes deterministically and reconciles database and files", async () => {
    const result = await fixture.maintenance.createHashManifest({
      schemaVersion: "1",
      commandId: "hash-manifest-command",
      idempotencyKey: "hash-manifest-idem",
      projectId,
      actorId: "actor-artifacts",
      authorization: authorization(),
      requiredCapability: "engineering-data.read",
      manifestId: "hash-manifest",
      backupBatchRef: { entityId: "backup", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database", versionId: "v1" },
      fileSnapshotRef: { entityId: "files", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policy: artifactPolicy(),
    });
    const request = {
      schemaVersion: "1" as const,
      runId: "reconcile-run",
      projectId,
      mode: "audit" as const,
      authorization: authorization(),
      requiredCapability: "engineering-data.read" as const,
      policy: artifactPolicy(),
      hashManifestRef: result.artifactRef,
      databaseSnapshotRef: { entityId: "database", versionId: "v1" },
      fileSnapshotRef: { entityId: "files", versionId: "v1" },
      observedBefore: "2040-01-01T00:00:00.000Z",
    };
    const handle = fixture.maintenance.reconcile(request);
    const findings = [];
    for await (const finding of handle.findings) findings.push(finding);
    const summary = await handle.summary;
    expect(findings.filter((finding) => finding.kind === "complete").length).toBeGreaterThan(0);
    expect(summary.passed).toBe(true);
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
      requiredCapability: "engineering-data.read",
      manifestId: "hash-manifest-edge",
      backupBatchRef: { entityId: "backup-edge", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-edge", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-edge", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policy: artifactPolicy(),
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
      requiredCapability: "engineering-data.read",
      policy: artifactPolicy(),
      hashManifestRef: hashManifest.artifactRef,
      databaseSnapshotRef: { entityId: "database-edge", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-edge", versionId: "v1" },
      observedBefore: "2040-01-01T00:00:00.000Z",
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
      requiredCapability: "engineering-data.read",
      manifestId: "hash-manifest-corrupt",
      backupBatchRef: { entityId: "backup-corrupt", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-corrupt", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-corrupt", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
      policy: artifactPolicy(),
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
      policy: artifactPolicy(),
      hashManifestRef: hashManifest.artifactRef,
      databaseSnapshotRef: { entityId: "database-corrupt", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-corrupt", versionId: "v1" },
      observedBefore: "2040-01-01T00:00:00.000Z",
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
      requiredCapability: "engineering-data.write" as const,
      policy: artifactPolicy(),
      observedBefore: "2030-01-01T00:00:01.000Z",
      dryRun: false,
    };
    failAt = "audit";
    await expectArtifactError(fixture.maintenance.sweepOrphans(command), "ARTIFACT_IO_FAILURE");
    failAt = undefined;
    await expect(truncate(orphanPath, 0)).resolves.toBeUndefined();
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
          requiredCapability: "engineering-data.write",
          policy: artifactPolicy({ registrationTimeoutMs: 50, orphanGracePeriodMs: 1_000 }),
          observedBefore: "2040-01-01T00:00:00.000Z",
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
      requiredCapability: "engineering-data.write" as const,
      policy: artifactPolicy(),
      observedBefore: "2030-01-01T00:00:01.000Z",
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
    await rm(path);
    await rm(`${path}.outside`);
    await fixture.store.put(
      putCommand("symlink", { artifactId: "artifact-symlink" }),
      chunks(content),
    );
  });

  it("performance keeps large and concurrent transfers bounded to configured chunks", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill(17);
    const storageBefore = await statfs(fixture.rootDirectory);
    const initialObjects = await fixture.store.listObjectHashesForTesting();
    let peakHeapBytes = process.memoryUsage().heapUsed;
    const sampleHeap = () => {
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    };
    const largeHash = createHash("sha256");
    for (let index = 0; index < 256; index += 1) largeHash.update(chunk);
    const coldWriteStarted = performance.now();
    const large = await fixture.store.put(
      putCommand("large", {
        artifactId: "artifact-large",
        expectedByteLength: 256 * 1024 * 1024,
        expectedHash: { algorithm: "sha256", value: largeHash.digest("hex") },
      }),
      (async function* () {
        for (let index = 0; index < 256; index += 1) yield chunk;
      })(),
    );
    const coldWriteMs = performance.now() - coldWriteStarted;
    sampleHeap();
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
    sampleHeap();
    expect(readLength).toBe(256 * 1024 * 1024);
    expect(readHash.digest("hex")).toBe(large.manifest.content.hash.value);

    const concurrentStarted = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        fixture.store.put(
          putCommand(`concurrent-${index}`, { artifactId: `artifact-concurrent-${index}` }),
          (async function* () {
            const payload = index < 4 ? chunk : new Uint8Array(chunk.length).fill(index + 17);
            for (let part = 0; part < 16; part += 1) yield payload;
          })(),
        ),
      ),
    );
    const concurrentWriteMs = performance.now() - concurrentStarted;
    sampleHeap();
    expect(
      new Set(concurrent.slice(0, 4).map((item) => item.artifactRef.reference.versionId)).size,
    ).toBe(1);
    expect(
      new Set(concurrent.slice(4).map((item) => item.artifactRef.reference.versionId)).size,
    ).toBe(4);
    const storageAfter = await statfs(fixture.rootDirectory);
    const finalObjects = await fixture.store.listObjectHashesForTesting();
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
        hotReadMs,
        concurrentWriteMs,
        peakHeapBytes,
        requests,
        uniqueObjects,
        dedupRate: 1 - uniqueObjects / requests,
      }),
    );
  }, 180_000);

  it("performance reconciles a ten-thousand-entry streamed manifest on real PostgreSQL", async () => {
    const syntheticProjectId = "project-artifacts-synthetic";
    const lines: string[] = [];
    const header = {
      schemaVersion: "1",
      manifestId: "synthetic-manifest",
      projectId: syntheticProjectId,
      backupBatchRef: { entityId: "backup-large", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database-large", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-large", versionId: "v1" },
      generatedAt: ARTIFACT_TEST_TIMESTAMP,
    };
    lines.push(`${canonicalJson(header)}\n`);
    const entry = (index: number) => ({
      artifactRef: {
        kind: "content-artifact" as const,
        reference: {
          entityId: `synthetic-${String(index).padStart(5, "0")}`,
          versionId: `sha256:${"a".repeat(64)}`,
        },
      },
      artifactKind: "content" as const,
      content: { hash: { algorithm: "sha256" as const, value: "a".repeat(64) }, byteLength: 1 },
      mediaType: "application/octet-stream",
      manifestSha256: "b".repeat(64),
      authorizationPolicyRefs: [policyRef],
      evidenceReferencesSha256: "c".repeat(64),
    });
    const entryHash = createHash("sha256");
    for (let index = 0; index < 10_000; index += 1) {
      const line = `${canonicalJson(entry(index))}\n`;
      lines.push(line);
      entryHash.update(encoder.encode(line));
    }
    lines.push(
      `${canonicalJson({ entryCount: 10_000, entriesSha256: entryHash.digest("hex") })}\n`,
    );
    const bytes = encoder.encode(lines.join(""));
    const request = {
      schemaVersion: "1" as const,
      runId: "synthetic-reconcile",
      projectId: syntheticProjectId,
      mode: "audit" as const,
      authorization: authorization("actor-artifacts", { project: syntheticProjectId }),
      requiredCapability: "engineering-data.read" as const,
      policy: artifactPolicy(),
      hashManifestRef: {
        kind: "content-artifact" as const,
        reference: { entityId: "synthetic-manifest", versionId: `sha256:${digest(bytes)}` },
      },
      databaseSnapshotRef: { entityId: "database-large", versionId: "v1" },
      fileSnapshotRef: { entityId: "files-large", versionId: "v1" },
      observedBefore: "2040-01-01T00:00:00.000Z",
    };
    const handle = fixture.maintenance.reconcile(request, chunks(bytes, 32 * 1024));
    let count = 0;
    for await (const finding of handle.findings) {
      if (finding.kind === "manifest-conflict") count += 1;
    }
    const summary = await handle.summary;
    expect(count).toBe(10_000);
    expect(summary.counts.manifestConflict).toBe(10_000);
    expect(summary.passed).toBe(false);
  }, 180_000);
});
