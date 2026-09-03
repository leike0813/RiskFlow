import { describe, expect, it } from "vitest";

import {
  ArtifactAccessRecordV1Schema,
  ArtifactHashManifestEntryV1Schema,
  ArtifactHashManifestCommandV1Schema,
  ArtifactMaintenanceBatchV1Schema,
  ArtifactManifestV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactReconcileRequestV1Schema,
  ArtifactReconcileSummaryV1Schema,
  ArtifactStorePolicyV1Schema,
  ArtifactSweepCommandV1Schema,
  ArtifactRefV1Schema,
  artifactError,
  artifactPolicySha256,
  mapArtifactErrorToModuleError,
  manifestSha256,
  mergeArtifactAccessSnapshots,
  mergeEvidenceReferences,
  normalizeArtifactAccessSnapshot,
} from "../src/artifacts/index.js";

const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "auth-1", versionId: "v1" },
  },
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: ["engineering-data.write" as const],
  spatialScopeRefs: [
    { kind: "spatial-scope" as const, reference: { entityId: "scope-1", versionId: "v1" } },
  ],
  sourceAccessGrantRefs: [
    { kind: "source-access-grant" as const, reference: { entityId: "grant-1", versionId: "v1" } },
  ],
  authorizationPolicyRef: { entityId: "policy-1", versionId: "v1" },
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

const readAuthorization = {
  ...authorization,
  grantedCapabilities: [...authorization.grantedCapabilities, "engineering-data.read" as const],
};

const freezeAuthorization = {
  ...readAuthorization,
  grantedCapabilities: [
    ...readAuthorization.grantedCapabilities,
    "engineering-data.freeze" as const,
  ],
};

const policy = {
  schemaVersion: "1" as const,
  policyRef: { entityId: "artifact-policy", versionId: "v1" },
  maxArtifactBytes: 1024 * 1024,
  maxConcurrentWrites: 2,
  maxConcurrentReads: 2,
  stagingMaxBytes: 4 * 1024 * 1024,
  orphanGracePeriodMs: 60_000,
  registrationTimeoutMs: 5_000,
  maintenanceBatchSize: 100,
};

const content = {
  hash: { algorithm: "sha256" as const, value: "a".repeat(64) },
  byteLength: 3,
};

const artifactRef = {
  kind: "content-artifact" as const,
  reference: { entityId: "artifact-1", versionId: `sha256:${content.hash.value}` },
};

const evidence = {
  locator: { sourceSegmentId: "source-1-chapter-1-segment-1" },
  sourceVersion: { entityId: "source-1", versionId: "v1" },
};

const makePut = () =>
  ArtifactPutCommandV1Schema.parse({
    schemaVersion: "1",
    commandId: "command-1",
    idempotencyKey: "idempotency-1",
    projectId: "project-1",
    actorId: "actor-1",
    issuedAt: "2030-01-01T00:00:00.000Z",
    authorization,
    requiredCapability: "engineering-data.write",
    artifactId: "artifact-1",
    artifactKind: "content",
    purposeCode: "source-input",
    mediaType: "text/plain",
    expectedHash: content.hash,
    expectedByteLength: 3,
    parentArtifactRefs: [],
    evidenceReferences: [evidence],
    additionalSpatialScopeRefs: [],
    additionalSourceAccessGrantRefs: [],
  });

const makeManifest = () =>
  ArtifactManifestV1Schema.parse({
    schemaVersion: "1",
    artifactRef,
    artifactKind: "content",
    content,
    mediaType: "text/plain",
    purposeCode: "source-input",
    access: normalizeArtifactAccessSnapshot({
      projectId: "project-1",
      spatialScopeRefs: authorization.spatialScopeRefs,
      sourceAccessGrantRefs: authorization.sourceAccessGrantRefs,
      authorizationPolicyRefs: [authorization.authorizationPolicyRef],
    }),
    writePolicyRef: policy.policyRef,
    parentArtifactRefs: [],
    evidenceReferences: [evidence],
    producerCommandId: "command-1",
    authorizationContextRef: authorization.authorizationContextRef,
    auditTrailRef: { kind: "audit-trail", reference: { entityId: "audit-1", versionId: "v1" } },
    occurredAt: "2030-01-01T00:00:00.000Z",
    recordedAt: "2030-01-01T00:00:00.000Z",
    persistedAt: "2030-01-01T00:00:00.000Z",
  });

describe("content-addressed artifact schemas", () => {
  it.each([
    ["put command", () => makePut()],
    ["manifest", () => makeManifest()],
    ["policy", () => ArtifactStorePolicyV1Schema.parse(policy)],
  ])("accepts %s", (_name, parse) => {
    expect(parse()).toBeDefined();
  });

  it.each([
    [
      "unknown put field",
      () => ArtifactPutCommandV1Schema.safeParse({ ...makePut(), extra: true }),
    ],
    [
      "wrong artifact version",
      () =>
        ArtifactRefV1Schema.safeParse({
          ...artifactRef,
          reference: { ...artifactRef.reference, versionId: "v1" },
        }),
    ],
    [
      "kind mismatch",
      () => ArtifactManifestV1Schema.safeParse({ ...makeManifest(), artifactKind: "diagnostic" }),
    ],
    [
      "policy upper bound",
      () => ArtifactStorePolicyV1Schema.safeParse({ ...policy, orphanGracePeriodMs: 5_000 }),
    ],
  ])("rejects %s", (_name, parse) => {
    expect(parse().success).toBe(false);
  });

  it("rejects a put when the authorization lacks its required capability", () => {
    expect(
      ArtifactPutCommandV1Schema.safeParse({
        ...makePut(),
        authorization: { ...authorization, grantedCapabilities: ["engineering-data.read"] },
      }).success,
    ).toBe(false);
  });

  it("keeps content and diagnostic references distinct", () => {
    expect(ArtifactRefV1Schema.safeParse(artifactRef).success).toBe(true);
    expect(
      ArtifactRefV1Schema.safeParse({
        kind: "diagnostic-artifact",
        reference: artifactRef.reference,
      }).success,
    ).toBe(true);
    expect(
      ArtifactManifestV1Schema.safeParse({
        ...makeManifest(),
        artifactRef: { kind: "diagnostic-artifact", reference: artifactRef.reference },
      }).success,
    ).toBe(false);
  });

  it("derives the manifest digest from the content version and excludes mutable fields", () => {
    const manifest = makeManifest();
    expect(manifestSha256(manifest)).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifestSha256({ ...manifest, persistedAt: "2030-01-02T00:00:00.000Z" })).toBe(
      manifestSha256(manifest),
    );
  });

  it("normalizes parent access and evidence as sorted unions", () => {
    const secondScope = {
      kind: "spatial-scope" as const,
      reference: { entityId: "scope-2", versionId: "v1" },
    };
    const union = mergeArtifactAccessSnapshots([
      normalizeArtifactAccessSnapshot({
        ...makeManifest().access,
        spatialScopeRefs: [secondScope, ...authorization.spatialScopeRefs],
      }),
      makeManifest().access,
    ]);
    expect(union.spatialScopeRefs.map((item) => item.reference.entityId)).toEqual([
      "scope-1",
      "scope-2",
    ]);
    expect(mergeEvidenceReferences([[evidence], [evidence]])).toHaveLength(1);
  });

  it("accepts a strict hash manifest entry and maps closed errors", () => {
    const manifest = makeManifest();
    const entry = ArtifactHashManifestEntryV1Schema.parse({
      artifactRef: manifest.artifactRef,
      artifactKind: manifest.artifactKind,
      content: manifest.content,
      mediaType: manifest.mediaType,
      manifestSha256: manifestSha256(manifest),
      authorizationPolicyRefs: manifest.access.authorizationPolicyRefs,
      evidenceReferencesSha256: "b".repeat(64),
    });
    expect(entry.artifactRef.reference.versionId).toContain("sha256:");
    const error = artifactError("ARTIFACT_ACCESS_DENIED", "read.authorization");
    expect(
      mapArtifactErrorToModuleError(error, {
        causalRunId: "run-1",
        requiredCapability: "engineering-data.read",
        authorizationPolicyRef: authorization.authorizationPolicyRef,
      }).code,
    ).toBe("AUTHORIZATION_DENIED");
  });

  it("keeps maintenance commands closed and policy-reference based", () => {
    const hashCommand = {
      schemaVersion: "1" as const,
      commandId: "hash-command",
      idempotencyKey: "hash-idem",
      projectId: "project-1",
      actorId: "actor-1",
      authorization: freezeAuthorization,
      requiredCapability: "engineering-data.freeze" as const,
      manifestId: "hash-manifest",
      backupBatchRef: { entityId: "backup", versionId: "v1" },
      databaseSnapshotRef: { entityId: "database", versionId: "v1" },
      fileSnapshotRef: { entityId: "files", versionId: "v1" },
      purposeCode: "artifact-hash-manifest",
      generatedAt: "2030-01-01T00:00:00.000Z",
      policyRef: policy.policyRef,
    };
    const reconcileRequest = {
      schemaVersion: "1" as const,
      runId: "reconcile-run",
      projectId: "project-1",
      mode: "audit" as const,
      authorization: readAuthorization,
      requiredCapability: "engineering-data.read" as const,
      policyRef: policy.policyRef,
      hashManifestRef: {
        kind: "content-artifact" as const,
        reference: { entityId: "hash-manifest", versionId: `sha256:${"c".repeat(64)}` },
      },
      databaseSnapshotRef: { entityId: "database", versionId: "v1" },
      fileSnapshotRef: { entityId: "files", versionId: "v1" },
    };
    const sweepCommand = {
      schemaVersion: "1" as const,
      runId: "sweep-run",
      commandId: "sweep-command",
      idempotencyKey: "sweep-idem",
      projectId: "project-1",
      actorId: "actor-1",
      authorization: freezeAuthorization,
      requiredCapability: "engineering-data.freeze" as const,
      policyRef: policy.policyRef,
      dryRun: true,
    };
    expect(ArtifactHashManifestCommandV1Schema.safeParse(hashCommand).success).toBe(true);
    expect(ArtifactReconcileRequestV1Schema.safeParse(reconcileRequest).success).toBe(true);
    expect(ArtifactSweepCommandV1Schema.safeParse(sweepCommand).success).toBe(true);
    expect(ArtifactHashManifestCommandV1Schema.safeParse({ ...hashCommand, policy }).success).toBe(
      false,
    );
    expect(
      ArtifactReconcileRequestV1Schema.safeParse({
        ...reconcileRequest,
        observedBefore: "2030-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(ArtifactSweepCommandV1Schema.safeParse({ ...sweepCommand, policy }).success).toBe(false);
    expect(
      ArtifactSweepCommandV1Schema.safeParse({
        ...sweepCommand,
        observedBefore: "2030-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it.each(["authorized", "succeeded", "denied", "cancelled", "integrity-failed"] as const)(
    "accepts closed access outcome %s",
    (outcome) => {
      const record = ArtifactAccessRecordV1Schema.parse({
        schemaVersion: "1",
        requestId: "request-1",
        projectId: "project-1",
        actorId: "actor-1",
        purposeCode: "engineering-input",
        authorizationContextRef: authorization.authorizationContextRef,
        authorizationPolicyRef: authorization.authorizationPolicyRef,
        outcome,
        stage: "read.state",
        occurredAt: "2030-01-01T00:00:00.000Z",
        auditTrailRef: { kind: "audit-trail", reference: { entityId: "audit-1", versionId: "v1" } },
        ...(outcome === "integrity-failed"
          ? {
              diagnosticRef: {
                kind: "diagnostic-artifact" as const,
                reference: { entityId: "diagnostic-1", versionId: `sha256:${"d".repeat(64)}` },
              },
            }
          : {}),
      });
      expect(record.outcome).toBe(outcome);
      expect(ArtifactAccessRecordV1Schema.safeParse({ ...record, unexpected: true }).success).toBe(
        false,
      );
    },
  );

  it("binds summary and maintenance batches to the frozen policy digest and bound", () => {
    const summary = ArtifactReconcileSummaryV1Schema.parse({
      schemaVersion: "1",
      runId: "reconcile-run",
      projectId: "project-1",
      mode: "audit",
      policyRef: policy.policyRef,
      policySha256: artifactPolicySha256(policy),
      runStartedAt: "2030-01-01T00:00:00.000Z",
      cutoff: "2029-12-31T23:59:00.000Z",
      counts: {
        complete: 0,
        missingObject: 0,
        contentMismatch: 0,
        manifestConflict: 0,
        orphanObject: 0,
        staleStaging: 0,
        quarantinedObject: 0,
      },
      passed: true,
      completedAt: "2030-01-01T00:00:01.000Z",
    });
    expect(summary.policySha256).toBe(artifactPolicySha256(policy));
    const batch = ArtifactMaintenanceBatchV1Schema.parse({
      schemaVersion: "1",
      runId: "sweep-run",
      batchNumber: 1,
      projectId: "project-1",
      commandId: "sweep-batch",
      operation: "orphan-sweep",
      policyRef: policy.policyRef,
      policySha256: artifactPolicySha256(policy),
      runStartedAt: "2030-01-01T00:00:00.000Z",
      cutoff: "2029-12-31T23:59:00.000Z",
      dryRun: true,
      candidateHashes: [
        { algorithm: "sha256", value: "a".repeat(64) },
        { algorithm: "sha256", value: "b".repeat(64) },
      ],
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: "audit-batch", versionId: "v1" },
      },
      persistedAt: "2030-01-01T00:00:01.000Z",
    });
    expect(batch.candidateHashes).toHaveLength(2);
    const tooManyHashes = Array.from({ length: 10_001 }, (_, index) => ({
      algorithm: "sha256" as const,
      value: index.toString(16).padStart(64, "0"),
    }));
    expect(
      ArtifactMaintenanceBatchV1Schema.safeParse({ ...batch, candidateHashes: tooManyHashes })
        .success,
    ).toBe(false);
  });
});
