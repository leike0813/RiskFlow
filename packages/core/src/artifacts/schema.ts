import { z } from "zod";

import {
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  AuditTrailRefV1Schema,
  ContentArtifactRefV1Schema,
  DiagnosticArtifactRefV1Schema,
  ModuleCapabilityV1Schema,
  SourceAccessGrantRefV1Schema,
  SpatialScopeRefV1Schema,
  ContractReferenceV1Schema,
} from "@riskflow/contracts/ports";
import type { ModuleErrorV1 } from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  EvidenceReferenceSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

import { sha256CanonicalJson } from "../persistence/canonical-json.js";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "must be a safe integer");
const nonNegativeSafeInteger = safeInteger.nonnegative();
const positiveSafeInteger = safeInteger.positive();
const hashValue = z.string().regex(/^[0-9a-f]{64}$/);
const noControlCharacters = (value: string): boolean =>
  [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 0x1f && codePoint !== 0x7f;
  });
const text = z
  .string()
  .trim()
  .min(1)
  .refine(noControlCharacters, "must not contain control characters");

const referenceKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}) => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;
const versionKey = (value: { entityId: string; versionId: string }) =>
  `${value.entityId}/${value.versionId}`;
const compareKeys = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const evidenceKey = (value: {
  locator: { sourceSegmentId: string };
  sourceVersion: { entityId: string; versionId: string };
}) =>
  `${value.locator.sourceSegmentId}/${value.sourceVersion.entityId}/${value.sourceVersion.versionId}`;

const sortedUnique = <T>(schema: z.ZodType<T>, key: (value: T) => string, minimum = 0) =>
  z
    .array(schema)
    .min(minimum)
    .superRefine((values, context) => {
      const keys = values.map(key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "collection must not contain duplicates" });
      }
      for (let index = 1; index < keys.length; index += 1) {
        if (keys[index - 1]! >= keys[index]!) {
          context.addIssue({ code: "custom", message: "collection must be sorted" });
          break;
        }
      }
    });

export const ARTIFACT_KIND_V1_VALUES = ["content", "diagnostic"] as const;
export const ArtifactKindV1Schema = z.enum(ARTIFACT_KIND_V1_VALUES);
export type ArtifactKindV1 = z.infer<typeof ArtifactKindV1Schema>;

export const ArtifactHashV1Schema = z.strictObject({
  algorithm: z.literal("sha256"),
  value: hashValue,
});
export type ArtifactHashV1 = z.infer<typeof ArtifactHashV1Schema>;

export const ArtifactContentIdentityV1Schema = z.strictObject({
  hash: ArtifactHashV1Schema,
  byteLength: nonNegativeSafeInteger,
});
export type ArtifactContentIdentityV1 = z.infer<typeof ArtifactContentIdentityV1Schema>;

const artifactReference = z.discriminatedUnion("kind", [
  ContentArtifactRefV1Schema,
  DiagnosticArtifactRefV1Schema,
]);

export const ArtifactRefV1Schema = artifactReference.superRefine((value, context) => {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.reference.versionId)) {
    context.addIssue({
      code: "custom",
      path: ["reference", "versionId"],
      message: "artifact version must be sha256:<64 lowercase hex>.",
    });
  }
});
export type ArtifactRefV1 = z.infer<typeof ArtifactRefV1Schema>;

export const ArtifactAccessSnapshotV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  spatialScopeRefs: sortedUnique(SpatialScopeRefV1Schema, referenceKey),
  sourceAccessGrantRefs: sortedUnique(SourceAccessGrantRefV1Schema, referenceKey),
  authorizationPolicyRefs: sortedUnique(VersionReferenceSchema, versionKey, 1),
});
export type ArtifactAccessSnapshotV1 = z.infer<typeof ArtifactAccessSnapshotV1Schema>;

export const ArtifactStorePolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    policyRef: VersionReferenceSchema,
    maxArtifactBytes: positiveSafeInteger,
    maxConcurrentWrites: positiveSafeInteger,
    maxConcurrentReads: positiveSafeInteger,
    stagingMaxBytes: positiveSafeInteger,
    orphanGracePeriodMs: positiveSafeInteger,
    registrationTimeoutMs: positiveSafeInteger,
    maintenanceBatchSize: positiveSafeInteger.max(10_000),
  })
  .superRefine((policy, context) => {
    if (policy.orphanGracePeriodMs <= policy.registrationTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["orphanGracePeriodMs"],
        message: "orphanGracePeriodMs must exceed registrationTimeoutMs",
      });
    }
  });
export type ArtifactStorePolicyV1 = z.infer<typeof ArtifactStorePolicyV1Schema>;

export const ArtifactPutCommandV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    issuedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    requiredCapability: ModuleCapabilityV1Schema,
    artifactId: IdentifierSchema,
    artifactKind: ArtifactKindV1Schema,
    purposeCode: IdentifierSchema,
    mediaType: text,
    expectedHash: ArtifactHashV1Schema.optional(),
    expectedByteLength: nonNegativeSafeInteger.optional(),
    parentArtifactRefs: sortedUnique(ArtifactRefV1Schema, referenceKey),
    evidenceReferences: sortedUnique(EvidenceReferenceSchema, evidenceKey),
    additionalSpatialScopeRefs: sortedUnique(SpatialScopeRefV1Schema, referenceKey),
    additionalSourceAccessGrantRefs: sortedUnique(SourceAccessGrantRefV1Schema, referenceKey),
  })
  .superRefine((command, context) => {
    if (command.projectId !== command.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "project does not match authorization",
      });
    }
    if (command.actorId !== command.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "actor does not match authorization",
      });
    }
    if (!command.authorization.grantedCapabilities.includes(command.requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapability"],
        message: "required capability is not granted",
      });
    }
    const scopeKeys = new Set(command.authorization.spatialScopeRefs.map(referenceKey));
    for (const scope of command.additionalSpatialScopeRefs) {
      if (!scopeKeys.has(referenceKey(scope))) {
        context.addIssue({
          code: "custom",
          path: ["additionalSpatialScopeRefs"],
          message: "scope is not granted",
        });
      }
    }
    const grantKeys = new Set(command.authorization.sourceAccessGrantRefs.map(referenceKey));
    for (const grant of command.additionalSourceAccessGrantRefs) {
      if (!grantKeys.has(referenceKey(grant))) {
        context.addIssue({
          code: "custom",
          path: ["additionalSourceAccessGrantRefs"],
          message: "source access grant is not granted",
        });
      }
    }
  });
export type ArtifactPutCommandV1 = z.infer<typeof ArtifactPutCommandV1Schema>;

export const ArtifactManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    artifactRef: ArtifactRefV1Schema,
    artifactKind: ArtifactKindV1Schema,
    content: ArtifactContentIdentityV1Schema,
    mediaType: text,
    purposeCode: IdentifierSchema,
    access: ArtifactAccessSnapshotV1Schema,
    writePolicyRef: VersionReferenceSchema,
    parentArtifactRefs: sortedUnique(ArtifactRefV1Schema, referenceKey),
    evidenceReferences: sortedUnique(EvidenceReferenceSchema, evidenceKey),
    producerCommandId: IdentifierSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    auditTrailRef: AuditTrailRefV1Schema,
    occurredAt: IsoDateTimeSchema,
    recordedAt: IsoDateTimeSchema,
    persistedAt: IsoDateTimeSchema,
  })
  .superRefine((manifest, context) => {
    const expectedKind =
      manifest.artifactRef.kind === "content-artifact" ? "content" : "diagnostic";
    if (manifest.artifactKind !== expectedKind) {
      context.addIssue({
        code: "custom",
        path: ["artifactKind"],
        message: "artifact kind does not match reference",
      });
    }
    if (manifest.artifactRef.reference.versionId !== `sha256:${manifest.content.hash.value}`) {
      context.addIssue({
        code: "custom",
        path: ["artifactRef", "reference", "versionId"],
        message: "version does not match content hash",
      });
    }
    if (manifest.access.projectId.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["access", "projectId"],
        message: "project is required",
      });
    }
  });
export type ArtifactManifestV1 = z.infer<typeof ArtifactManifestV1Schema>;

export const ArtifactPutResultV1Schema = z.strictObject({
  artifactRef: ArtifactRefV1Schema,
  manifest: ArtifactManifestV1Schema,
  manifestSha256: hashValue,
  replayed: z.boolean(),
  deduplicated: z.boolean(),
});
export type ArtifactPutResultV1 = z.infer<typeof ArtifactPutResultV1Schema>;

export const ArtifactReadRequestV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    requestId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    artifactRef: ArtifactRefV1Schema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    purposeCode: IdentifierSchema,
    requiredCapability: ModuleCapabilityV1Schema,
    authorization: AuthorizationContextV1Schema,
  })
  .superRefine((request, context) => {
    if (request.projectId !== request.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "project does not match authorization",
      });
    }
    if (request.actorId !== request.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "actor does not match authorization",
      });
    }
    if (!request.authorization.grantedCapabilities.includes(request.requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapability"],
        message: "required capability is not granted",
      });
    }
  });
export type ArtifactReadRequestV1 = z.infer<typeof ArtifactReadRequestV1Schema>;

export const ArtifactReadReceiptV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  requestId: IdentifierSchema,
  artifactRef: ArtifactRefV1Schema,
  content: ArtifactContentIdentityV1Schema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  verifiedAt: IsoDateTimeSchema,
});
export type ArtifactReadReceiptV1 = z.infer<typeof ArtifactReadReceiptV1Schema>;

export const ArtifactReferenceCheckRequestV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    artifactRef: ArtifactRefV1Schema,
    projectId: IdentifierSchema,
    purposeCode: IdentifierSchema,
    requiredCapability: ModuleCapabilityV1Schema,
    authorization: AuthorizationContextV1Schema,
  })
  .superRefine((request, context) => {
    if (request.projectId !== request.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "project does not match authorization",
      });
    }
    if (!request.authorization.grantedCapabilities.includes(request.requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapability"],
        message: "required capability is not granted",
      });
    }
  });
export type ArtifactReferenceCheckRequestV1 = z.infer<typeof ArtifactReferenceCheckRequestV1Schema>;

export const ArtifactReferenceCheckResultV1Schema = z.strictObject({
  artifactRef: ArtifactRefV1Schema,
  manifestSha256: hashValue,
  content: ArtifactContentIdentityV1Schema,
  mediaType: text,
  access: ArtifactAccessSnapshotV1Schema,
  evidenceReferences: sortedUnique(EvidenceReferenceSchema, evidenceKey),
});
export type ArtifactReferenceCheckResultV1 = z.infer<typeof ArtifactReferenceCheckResultV1Schema>;

export const ArtifactHashManifestCommandV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    authorization: AuthorizationContextV1Schema,
    requiredCapability: ModuleCapabilityV1Schema,
    manifestId: IdentifierSchema,
    backupBatchRef: VersionReferenceSchema,
    databaseSnapshotRef: VersionReferenceSchema,
    fileSnapshotRef: VersionReferenceSchema,
    purposeCode: IdentifierSchema,
    generatedAt: IsoDateTimeSchema,
    policy: ArtifactStorePolicyV1Schema,
  })
  .superRefine((command, context) => {
    if (command.projectId !== command.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "project does not match authorization",
      });
    }
    if (command.actorId !== command.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "actor does not match authorization",
      });
    }
    if (!command.authorization.grantedCapabilities.includes(command.requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapability"],
        message: "required capability is not granted",
      });
    }
  });
export type ArtifactHashManifestCommandV1 = z.infer<typeof ArtifactHashManifestCommandV1Schema>;

export const ArtifactHashManifestHeaderV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  manifestId: IdentifierSchema,
  projectId: IdentifierSchema,
  backupBatchRef: VersionReferenceSchema,
  databaseSnapshotRef: VersionReferenceSchema,
  fileSnapshotRef: VersionReferenceSchema,
  generatedAt: IsoDateTimeSchema,
});
export type ArtifactHashManifestHeaderV1 = z.infer<typeof ArtifactHashManifestHeaderV1Schema>;

export const ArtifactHashManifestEntryV1Schema = z
  .strictObject({
    artifactRef: ArtifactRefV1Schema,
    artifactKind: ArtifactKindV1Schema,
    content: ArtifactContentIdentityV1Schema,
    mediaType: text,
    manifestSha256: hashValue,
    authorizationPolicyRefs: sortedUnique(VersionReferenceSchema, versionKey, 1),
    evidenceReferencesSha256: hashValue,
  })
  .superRefine((entry, context) => {
    const expectedKind = entry.artifactRef.kind === "content-artifact" ? "content" : "diagnostic";
    if (entry.artifactKind !== expectedKind) {
      context.addIssue({
        code: "custom",
        path: ["artifactKind"],
        message: "artifact kind does not match reference",
      });
    }
    if (entry.artifactRef.reference.versionId !== `sha256:${entry.content.hash.value}`) {
      context.addIssue({
        code: "custom",
        path: ["artifactRef", "reference", "versionId"],
        message: "version does not match content hash",
      });
    }
  });
export type ArtifactHashManifestEntryV1 = z.infer<typeof ArtifactHashManifestEntryV1Schema>;

export const ArtifactHashManifestTrailerV1Schema = z.strictObject({
  entryCount: nonNegativeSafeInteger,
  entriesSha256: hashValue,
});
export type ArtifactHashManifestTrailerV1 = z.infer<typeof ArtifactHashManifestTrailerV1Schema>;

export const ArtifactReconcileModeV1Schema = z.enum(["audit", "recovery"]);
export type ArtifactReconcileModeV1 = z.infer<typeof ArtifactReconcileModeV1Schema>;

export const ArtifactReconcileRequestV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    runId: IdentifierSchema,
    projectId: IdentifierSchema,
    mode: ArtifactReconcileModeV1Schema,
    authorization: AuthorizationContextV1Schema,
    requiredCapability: ModuleCapabilityV1Schema,
    policy: ArtifactStorePolicyV1Schema,
    hashManifestRef: ArtifactRefV1Schema,
    databaseSnapshotRef: VersionReferenceSchema,
    fileSnapshotRef: VersionReferenceSchema,
    observedBefore: IsoDateTimeSchema,
  })
  .superRefine((request, context) => {
    if (request.projectId !== request.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "project does not match authorization",
      });
    }
    if (!request.authorization.grantedCapabilities.includes(request.requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapability"],
        message: "required capability is not granted",
      });
    }
    if (request.hashManifestRef.kind !== "content-artifact") {
      context.addIssue({
        code: "custom",
        path: ["hashManifestRef", "kind"],
        message: "hash manifest must be a content artifact",
      });
    }
  });
export type ArtifactReconcileRequestV1 = z.infer<typeof ArtifactReconcileRequestV1Schema>;

const reconcileFindingBase = {
  artifactRef: ArtifactRefV1Schema,
  content: ArtifactContentIdentityV1Schema,
  observedAt: IsoDateTimeSchema,
};

export const ArtifactReconcileFindingV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("complete"),
    ...reconcileFindingBase,
    manifestSha256: hashValue,
  }),
  z.strictObject({
    kind: z.literal("missing-object"),
    ...reconcileFindingBase,
    manifestSha256: hashValue,
  }),
  z.strictObject({
    kind: z.literal("content-mismatch"),
    ...reconcileFindingBase,
    manifestSha256: hashValue,
  }),
  z.strictObject({
    kind: z.literal("manifest-conflict"),
    ...reconcileFindingBase,
    manifestSha256: hashValue,
  }),
  z.strictObject({
    kind: z.literal("orphan-object"),
    contentHash: ArtifactHashV1Schema,
    byteLength: nonNegativeSafeInteger,
    observedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("stale-staging"),
    stagingId: IdentifierSchema,
    observedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("quarantined-object"),
    contentHash: ArtifactHashV1Schema,
    quarantineRunId: IdentifierSchema,
    observedAt: IsoDateTimeSchema,
  }),
]);
export type ArtifactReconcileFindingV1 = z.infer<typeof ArtifactReconcileFindingV1Schema>;

export const ArtifactReconcileCountsV1Schema = z.strictObject({
  complete: nonNegativeSafeInteger,
  missingObject: nonNegativeSafeInteger,
  contentMismatch: nonNegativeSafeInteger,
  manifestConflict: nonNegativeSafeInteger,
  orphanObject: nonNegativeSafeInteger,
  staleStaging: nonNegativeSafeInteger,
  quarantinedObject: nonNegativeSafeInteger,
});
export type ArtifactReconcileCountsV1 = z.infer<typeof ArtifactReconcileCountsV1Schema>;

export const ArtifactReconcileSummaryV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  runId: IdentifierSchema,
  projectId: IdentifierSchema,
  mode: ArtifactReconcileModeV1Schema,
  counts: ArtifactReconcileCountsV1Schema,
  passed: z.boolean(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  auditTrailRef: AuditTrailRefV1Schema.optional(),
  diagnosticRef: DiagnosticArtifactRefV1Schema.optional(),
});
export type ArtifactReconcileSummaryV1 = z.infer<typeof ArtifactReconcileSummaryV1Schema>;

export const ArtifactSweepCommandV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    runId: IdentifierSchema,
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    authorization: AuthorizationContextV1Schema,
    requiredCapability: ModuleCapabilityV1Schema,
    policy: ArtifactStorePolicyV1Schema,
    observedBefore: IsoDateTimeSchema,
    dryRun: z.boolean().default(true),
  })
  .superRefine((command, context) => {
    if (command.projectId !== command.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "project does not match authorization",
      });
    }
    if (command.actorId !== command.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "actor does not match authorization",
      });
    }
    if (!command.authorization.grantedCapabilities.includes(command.requiredCapability)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapability"],
        message: "required capability is not granted",
      });
    }
  });
export type ArtifactSweepCommandV1 = z.infer<typeof ArtifactSweepCommandV1Schema>;

export const ArtifactSweepResultV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  runId: IdentifierSchema,
  projectId: IdentifierSchema,
  dryRun: z.boolean(),
  stagingObserved: nonNegativeSafeInteger,
  stagingRemoved: nonNegativeSafeInteger,
  orphanObserved: nonNegativeSafeInteger,
  orphanQuarantined: nonNegativeSafeInteger,
  orphanRemoved: nonNegativeSafeInteger,
  retained: nonNegativeSafeInteger,
  auditTrailRef: AuditTrailRefV1Schema.optional(),
  diagnosticRef: DiagnosticArtifactRefV1Schema.optional(),
});
export type ArtifactSweepResultV1 = z.infer<typeof ArtifactSweepResultV1Schema>;

export const ARTIFACT_ERROR_CODE_V1_VALUES = [
  "ARTIFACT_INPUT_INVALID",
  "ARTIFACT_TOO_LARGE",
  "ARTIFACT_HASH_MISMATCH",
  "ARTIFACT_REFERENCE_NOT_FOUND",
  "ARTIFACT_ACCESS_DENIED",
  "ARTIFACT_INHERITANCE_CONFLICT",
  "ARTIFACT_IO_FAILURE",
  "ARTIFACT_REGISTRY_FAILURE",
  "ARTIFACT_INTEGRITY_FAILURE",
  "ARTIFACT_MAINTENANCE_BUSY",
  "ARTIFACT_RECOVERY_BLOCKED",
  "ARTIFACT_UNSUPPORTED_VERSION",
  "ARTIFACT_IDEMPOTENCY_CONFLICT",
] as const;
export const ArtifactErrorCodeV1Schema = z.enum(ARTIFACT_ERROR_CODE_V1_VALUES);
export type ArtifactErrorCodeV1 = z.infer<typeof ArtifactErrorCodeV1Schema>;

export const ArtifactErrorV1Schema = z.strictObject({
  code: ArtifactErrorCodeV1Schema,
  retryable: z.boolean(),
  stage: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  diagnosticRef: DiagnosticArtifactRefV1Schema,
  contextRefs: z.array(ContractReferenceV1Schema),
});
export type ArtifactErrorV1 = z.infer<typeof ArtifactErrorV1Schema>;

export const artifactDiagnosticRef = (
  code: ArtifactErrorCodeV1,
): ArtifactErrorV1["diagnosticRef"] => ({
  kind: "diagnostic-artifact",
  reference: { entityId: `artifact-${code.toLowerCase()}`, versionId: "v1" },
});

export const artifactError = (
  code: ArtifactErrorCodeV1,
  stage: string,
  contextRefs: ArtifactErrorV1["contextRefs"] = [],
  retryable = false,
): ArtifactErrorV1 =>
  ArtifactErrorV1Schema.parse({
    code,
    retryable,
    stage,
    occurredAt: new Date().toISOString(),
    diagnosticRef: artifactDiagnosticRef(code),
    contextRefs,
  });

export class ArtifactStoreError extends Error implements ArtifactErrorV1 {
  readonly code: ArtifactErrorCodeV1;
  readonly retryable: boolean;
  readonly stage: string;
  readonly occurredAt: string;
  readonly diagnosticRef: ArtifactErrorV1["diagnosticRef"];
  readonly contextRefs: ArtifactErrorV1["contextRefs"];

  constructor(details: ArtifactErrorV1) {
    super(details.code);
    this.name = "ArtifactStoreError";
    this.code = details.code;
    this.retryable = details.retryable;
    this.stage = details.stage;
    this.occurredAt = details.occurredAt;
    this.diagnosticRef = details.diagnosticRef;
    this.contextRefs = details.contextRefs;
  }
}

export const makeArtifactError = (
  code: ArtifactErrorCodeV1,
  stage: string,
  contextRefs: ArtifactErrorV1["contextRefs"] = [],
  retryable = false,
): ArtifactStoreError => new ArtifactStoreError(artifactError(code, stage, contextRefs, retryable));

export interface ArtifactModuleErrorContextV1 {
  causalRunId: string;
  requiredCapability: z.infer<typeof ModuleCapabilityV1Schema>;
  authorizationPolicyRef: z.infer<typeof VersionReferenceSchema>;
  attempt?: number;
  retryPolicyRef?: z.infer<typeof VersionReferenceSchema>;
  idempotencyKey?: string;
  priorCommandId?: string;
  targetRef?: z.infer<typeof ContractReferenceV1Schema>;
  schemaVersion?: string;
}

export const mapArtifactErrorToModuleError = (
  error: ArtifactErrorV1,
  context: ArtifactModuleErrorContextV1,
): ModuleErrorV1 => {
  const common = {
    stageCode: error.stage,
    occurredAt: error.occurredAt,
    causalRunId: context.causalRunId,
  };
  if (error.code === "ARTIFACT_ACCESS_DENIED") {
    return {
      ...common,
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability: context.requiredCapability,
      authorizationPolicyRef: context.authorizationPolicyRef,
    };
  }
  if (error.code === "ARTIFACT_REFERENCE_NOT_FOUND" && context.targetRef !== undefined) {
    return {
      ...common,
      code: "ENTITY_NOT_FOUND",
      category: "not-found",
      retryable: false,
      targetRef: context.targetRef,
    };
  }
  if (
    error.code === "ARTIFACT_IDEMPOTENCY_CONFLICT" &&
    context.idempotencyKey &&
    context.priorCommandId
  ) {
    return {
      ...common,
      code: "IDEMPOTENCY_CONFLICT",
      category: "idempotency",
      retryable: false,
      idempotencyKey: context.idempotencyKey,
      priorCommandId: context.priorCommandId,
    };
  }
  if (error.retryable) {
    return {
      ...common,
      code: "TRANSIENT_FAILURE",
      category: "technical",
      retryable: true,
      attempt: context.attempt ?? 1,
      retryPolicyRef: context.retryPolicyRef ?? context.authorizationPolicyRef,
      diagnosticRef: error.diagnosticRef,
    };
  }
  if (error.code === "ARTIFACT_UNSUPPORTED_VERSION") {
    return {
      ...common,
      code: "UNSUPPORTED_CONTRACT",
      category: "technical",
      retryable: false,
      schemaVersion: context.schemaVersion ?? "1",
    };
  }
  return {
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: error.diagnosticRef,
  };
};

export const manifestHashInput = (
  manifest: ArtifactManifestV1,
): Omit<ArtifactManifestV1, "persistedAt" | "auditTrailRef"> => {
  const hashable = { ...manifest } as Record<string, unknown>;
  delete hashable.persistedAt;
  delete hashable.auditTrailRef;
  return hashable as Omit<ArtifactManifestV1, "persistedAt" | "auditTrailRef">;
};

export const manifestSha256 = (manifest: ArtifactManifestV1): string =>
  sha256CanonicalJson(manifestHashInput(manifest));

export const evidenceReferencesSha256 = (
  references: ArtifactManifestV1["evidenceReferences"],
): string => sha256CanonicalJson(references);

export const normalizeArtifactReferences = <T extends ArtifactRefV1>(values: readonly T[]): T[] =>
  [...values]
    .sort((left, right) => compareKeys(referenceKey(left), referenceKey(right)))
    .filter(
      (value, index, all) => index === 0 || referenceKey(all[index - 1]!) !== referenceKey(value),
    );

export const normalizeEvidenceReferences = <T extends z.infer<typeof EvidenceReferenceSchema>>(
  values: readonly T[],
): T[] =>
  [...values]
    .sort((left, right) => compareKeys(evidenceKey(left), evidenceKey(right)))
    .filter(
      (value, index, all) => index === 0 || evidenceKey(all[index - 1]!) !== evidenceKey(value),
    );

export const normalizeArtifactAccessSnapshot = (
  snapshot: Omit<
    ArtifactAccessSnapshotV1,
    "spatialScopeRefs" | "sourceAccessGrantRefs" | "authorizationPolicyRefs"
  > & {
    spatialScopeRefs: readonly z.infer<typeof SpatialScopeRefV1Schema>[];
    sourceAccessGrantRefs: readonly z.infer<typeof SourceAccessGrantRefV1Schema>[];
    authorizationPolicyRefs: readonly z.infer<typeof VersionReferenceSchema>[];
  },
): ArtifactAccessSnapshotV1 =>
  ArtifactAccessSnapshotV1Schema.parse({
    ...snapshot,
    spatialScopeRefs: [...snapshot.spatialScopeRefs]
      .sort((left, right) => compareKeys(referenceKey(left), referenceKey(right)))
      .filter(
        (value, index, all) => index === 0 || referenceKey(all[index - 1]!) !== referenceKey(value),
      ),
    sourceAccessGrantRefs: [...snapshot.sourceAccessGrantRefs]
      .sort((left, right) => compareKeys(referenceKey(left), referenceKey(right)))
      .filter(
        (value, index, all) => index === 0 || referenceKey(all[index - 1]!) !== referenceKey(value),
      ),
    authorizationPolicyRefs: [...snapshot.authorizationPolicyRefs]
      .sort((left, right) => compareKeys(versionKey(left), versionKey(right)))
      .filter(
        (value, index, all) => index === 0 || versionKey(all[index - 1]!) !== versionKey(value),
      ),
  });

export const mergeArtifactAccessSnapshots = (
  snapshots: readonly ArtifactAccessSnapshotV1[],
): ArtifactAccessSnapshotV1 => {
  const first = snapshots[0];
  if (first === undefined) throw new Error("at least one access snapshot is required");
  if (snapshots.some((snapshot) => snapshot.projectId !== first.projectId)) {
    throw makeArtifactError("ARTIFACT_INHERITANCE_CONFLICT", "access.project");
  }
  return normalizeArtifactAccessSnapshot({
    projectId: first.projectId,
    spatialScopeRefs: snapshots.flatMap((snapshot) => snapshot.spatialScopeRefs),
    sourceAccessGrantRefs: snapshots.flatMap((snapshot) => snapshot.sourceAccessGrantRefs),
    authorizationPolicyRefs: snapshots.flatMap((snapshot) => snapshot.authorizationPolicyRefs),
  });
};

export const mergeEvidenceReferences = (
  references: readonly (readonly z.infer<typeof EvidenceReferenceSchema>[])[],
): z.infer<typeof EvidenceReferenceSchema>[] => normalizeEvidenceReferences(references.flat());
