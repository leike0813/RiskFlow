import { z } from "zod";

import {
  AuditInfoSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  MonitoringBatchRefV1Schema,
  MonitoringSeriesRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  QueryResultRefV1Schema,
  SourceAccessGrantRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  ModuleErrorV1Schema,
} from "@riskflow/contracts/ports";
import { MonitoringIndicatorSchema } from "@riskflow/contracts/vocabulary";
import type { ModuleErrorV1 } from "@riskflow/contracts/ports";

const finiteNumber = z.number().finite();
const safeInteger = finiteNumber.int().refine(Number.isSafeInteger, "must be a safe integer");
const positiveInteger = safeInteger.positive();
const nonNegativeInteger = safeInteger.nonnegative();
const text = z.string().trim().min(1).max(200);
const unit = z.string().regex(/^[\x21-\x7e]{1,32}$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const versionedRef = <const T extends string>(kind: T) =>
  z.strictObject({ kind: z.literal(kind), reference: VersionReferenceSchema });

const uniqueBy = <T extends z.ZodTypeAny>(
  schema: T,
  key: (value: z.infer<T>) => string,
  max: number,
  min = 0,
) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, context) => {
      const keys = values.map(key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "collection must not contain duplicates" });
      }
    });

const refKey = (value: { kind: string; reference: { entityId: string; versionId: string } }) =>
  `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;
const evidenceKey = (value: {
  locator: { sourceSegmentId: string };
  sourceVersion: { entityId: string; versionId: string };
}) =>
  `${value.sourceVersion.entityId}/${value.sourceVersion.versionId}/${value.locator.sourceSegmentId}`;

export const MONITORING_SCHEMA_VERSION_V1 = "1" as const;
export const MONITORING_MEDIA_TYPE_V1 = "application/x-ndjson" as const;
export const MONITORING_MAX_ENVELOPE_BYTES = 64 * 1024;
export const MONITORING_MAX_SAMPLE_LINE_BYTES = 16 * 1024;
export const MONITORING_MAX_SAMPLES = 100_000;
export const MONITORING_MAX_SNAPSHOT_POINTS = 10_000;
export const MONITORING_MAX_FREQUENCY_SAMPLES = 512;

export const MonitoringUnitConversionV1Schema = z
  .strictObject({
    fromUnit: unit,
    scale: finiteNumber,
    offset: finiteNumber,
  })
  .superRefine((value, context) => {
    if (value.scale === 0) {
      context.addIssue({ code: "custom", path: ["scale"], message: "scale must be non-zero" });
    }
  });
export type MonitoringUnitConversionV1 = z.infer<typeof MonitoringUnitConversionV1Schema>;
export const MonitoringUnitConversionRuleV1Schema = MonitoringUnitConversionV1Schema;
export type MonitoringUnitConversionRuleV1 = MonitoringUnitConversionV1;

const monitoringSeriesRevisionShapeV1 = {
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  seriesId: IdentifierSchema,
  projectId: IdentifierSchema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  monitoringObject: text,
  monitoringIndicator: MonitoringIndicatorSchema,
  parameterCode: text,
  canonicalUnit: unit,
  unitConversions: uniqueBy(MonitoringUnitConversionV1Schema, (value) => value.fromUnit, 32),
  effectivePeriod: z.strictObject({
    validFrom: IsoDateTimeSchema,
    validTo: IsoDateTimeSchema.optional(),
  }),
  recordedAt: IsoDateTimeSchema,
  previousRevisionRef: MonitoringSeriesRefV1Schema.optional(),
};

const validateMonitoringSeriesRevision = (value: unknown, context: z.RefinementCtx): void => {
  const revision = value as {
    monitoringSeriesRef: { reference: { entityId: string } };
    seriesId: string;
    canonicalUnit: string;
    unitConversions: readonly { fromUnit: string }[];
    effectivePeriod: { validFrom: string; validTo?: string };
    previousRevisionRef?: { reference: { entityId: string } };
  };
  if (revision.seriesId !== revision.monitoringSeriesRef.reference.entityId) {
    context.addIssue({
      code: "custom",
      path: ["seriesId"],
      message: "series id must match the reference",
    });
  }
  if (revision.unitConversions.some((item) => item.fromUnit === revision.canonicalUnit)) {
    context.addIssue({
      code: "custom",
      path: ["unitConversions"],
      message: "canonical unit must not have a conversion rule",
    });
  }
  if (
    revision.effectivePeriod.validTo !== undefined &&
    Date.parse(revision.effectivePeriod.validTo) <= Date.parse(revision.effectivePeriod.validFrom)
  ) {
    context.addIssue({
      code: "custom",
      path: ["effectivePeriod", "validTo"],
      message: "validTo must be later than validFrom",
    });
  }
  if (
    revision.previousRevisionRef !== undefined &&
    revision.previousRevisionRef.reference.entityId !==
      revision.monitoringSeriesRef.reference.entityId
  ) {
    context.addIssue({
      code: "custom",
      path: ["previousRevisionRef"],
      message: "previous revision must belong to the same series",
    });
  }
};

export const MonitoringSeriesRevisionV1Schema = z
  .strictObject({ ...monitoringSeriesRevisionShapeV1, audit: AuditInfoSchema })
  .superRefine(validateMonitoringSeriesRevision);
export type MonitoringSeriesRevisionV1 = z.infer<typeof MonitoringSeriesRevisionV1Schema>;

export const MonitoringSeriesRevisionStatusV1Schema = z.enum(["current", "superseded"]);
export type MonitoringSeriesRevisionStatusV1 = z.infer<
  typeof MonitoringSeriesRevisionStatusV1Schema
>;

export const MonitoringSeriesRevisionReadV1Schema = z
  .strictObject({
    ...monitoringSeriesRevisionShapeV1,
    status: MonitoringSeriesRevisionStatusV1Schema,
  })
  .superRefine(validateMonitoringSeriesRevision);
export type MonitoringSeriesRevisionReadV1 = z.infer<typeof MonitoringSeriesRevisionReadV1Schema>;

export const MonitoringSampleInputV1Schema = z.strictObject({
  sourceSampleKey: text,
  sampledAt: IsoDateTimeSchema,
  value: finiteNumber,
  unit,
  evidenceReferences: uniqueBy(EvidenceReferenceSchema, evidenceKey, 128, 1),
});
export type MonitoringSampleInputV1 = z.infer<typeof MonitoringSampleInputV1Schema>;

export const MonitoringSampleArtifactEnvelopeV1Schema = z.strictObject({
  schemaVersion: z.literal(MONITORING_SCHEMA_VERSION_V1),
  mediaType: z.literal(MONITORING_MEDIA_TYPE_V1),
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  productionStrategyRef: VersionReferenceSchema,
  sampleCount: nonNegativeInteger.max(MONITORING_MAX_SAMPLES),
});
export type MonitoringSampleArtifactEnvelopeV1 = z.infer<
  typeof MonitoringSampleArtifactEnvelopeV1Schema
>;
export const MonitoringSampleArtifactV1Schema = MonitoringSampleArtifactEnvelopeV1Schema;
export type MonitoringSampleArtifactV1 = MonitoringSampleArtifactEnvelopeV1;
export const MonitoringSampleArtifactSampleV1Schema = MonitoringSampleInputV1Schema;

export const MonitoringBatchRelationV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("original") }),
  z.strictObject({ kind: z.literal("correction"), priorBatchRef: MonitoringBatchRefV1Schema }),
  z.strictObject({ kind: z.literal("supplement"), priorBatchRef: MonitoringBatchRefV1Schema }),
]);
export type MonitoringBatchRelationV1 = z.infer<typeof MonitoringBatchRelationV1Schema>;

export const MonitoringBatchV1Schema = z.strictObject({
  monitoringBatchRef: MonitoringBatchRefV1Schema,
  projectId: IdentifierSchema,
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  deliveryKey: IdentifierSchema,
  deliveryFingerprint: hash,
  sampleArtifactRef: ContentArtifactRefV1Schema,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  window: z
    .strictObject({ from: IsoDateTimeSchema, to: IsoDateTimeSchema })
    .superRefine((value, context) => {
      if (Date.parse(value.to) <= Date.parse(value.from)) {
        context.addIssue({ code: "custom", path: ["to"], message: "to must be later than from" });
      }
    }),
  relation: MonitoringBatchRelationV1Schema,
  sampleCount: nonNegativeInteger.max(MONITORING_MAX_SAMPLES),
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  audit: AuditInfoSchema,
});
export type MonitoringBatchV1 = z.infer<typeof MonitoringBatchV1Schema>;

export const MonitoringSampleVersionRefV1Schema = versionedRef("monitoring-sample-version");
export type MonitoringSampleVersionRefV1 = z.infer<typeof MonitoringSampleVersionRefV1Schema>;

export const MonitoringSampleVersionV1Schema = z.strictObject({
  sampleVersionRef: MonitoringSampleVersionRefV1Schema,
  monitoringBatchRef: MonitoringBatchRefV1Schema,
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  sourceSampleKey: text,
  sampledAt: IsoDateTimeSchema,
  value: finiteNumber,
  unit,
  canonicalValue: finiteNumber,
  canonicalUnit: unit,
  previousSampleVersionRef: MonitoringSampleVersionRefV1Schema.optional(),
  relationKind: z.enum(["original", "correction", "supplement"]),
  evidenceReferences: uniqueBy(EvidenceReferenceSchema, evidenceKey, 128, 1),
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  recordedAt: IsoDateTimeSchema,
});
export type MonitoringSampleVersionV1 = z.infer<typeof MonitoringSampleVersionV1Schema>;

const algorithmVersions = z.strictObject({
  alignment: IdentifierSchema,
  slope: IdentifierSchema,
  acceleration: IdentifierSchema,
  frequency: IdentifierSchema,
  anomaly: IdentifierSchema,
});
export const MonitoringAlgorithmVersionsV1Schema = algorithmVersions;
export type MonitoringAlgorithmVersionsV1 = z.infer<typeof algorithmVersions>;

export const MonitoringAvailabilityPolicyV1Schema = z
  .strictObject({
    availabilityPolicyRef: VersionReferenceSchema,
    projectId: IdentifierSchema,
    monitoringSeriesRef: MonitoringSeriesRefV1Schema,
    windowDurationMs: positiveInteger,
    intervalMs: positiveInteger,
    maxInterpolationGapMs: nonNegativeInteger,
    slopeWindowSize: positiveInteger,
    accelerationWindowSize: positiveInteger,
    frequencyWindowSize: positiveInteger,
    anomalyBaselineSize: positiveInteger,
    anomalyScaleFloor: finiteNumber,
    frequencyPowerFloor: finiteNumber,
    minimumCoverageRatio: finiteNumber,
    maxFrequencySamples: positiveInteger.max(MONITORING_MAX_FREQUENCY_SAMPLES),
    algorithmVersions,
    recordedAt: IsoDateTimeSchema,
    audit: AuditInfoSchema,
  })
  .superRefine((value, context) => {
    if (value.slopeWindowSize < 2) {
      context.addIssue({
        code: "custom",
        path: ["slopeWindowSize"],
        message: "slope window requires at least two points",
      });
    }
    if (value.accelerationWindowSize < 3) {
      context.addIssue({
        code: "custom",
        path: ["accelerationWindowSize"],
        message: "acceleration window requires at least three points",
      });
    }
    if (value.frequencyWindowSize < 2) {
      context.addIssue({
        code: "custom",
        path: ["frequencyWindowSize"],
        message: "frequency window requires at least two points",
      });
    }
    if (value.anomalyScaleFloor <= 0) {
      context.addIssue({
        code: "custom",
        path: ["anomalyScaleFloor"],
        message: "anomaly scale floor must be positive",
      });
    }
    if (value.frequencyPowerFloor < 0) {
      context.addIssue({
        code: "custom",
        path: ["frequencyPowerFloor"],
        message: "frequency power floor must not be negative",
      });
    }
    if (value.minimumCoverageRatio < 0 || value.minimumCoverageRatio > 1) {
      context.addIssue({
        code: "custom",
        path: ["minimumCoverageRatio"],
        message: "minimum coverage ratio must be between zero and one",
      });
    }
    if (value.frequencyWindowSize > value.maxFrequencySamples) {
      context.addIssue({
        code: "custom",
        path: ["frequencyWindowSize"],
        message: "frequency window exceeds the bounded input size",
      });
    }
    if (Math.ceil(value.windowDurationMs / value.intervalMs) > MONITORING_MAX_SNAPSHOT_POINTS) {
      context.addIssue({
        code: "custom",
        path: ["windowDurationMs"],
        message: "availability window exceeds the bounded snapshot grid",
      });
    }
  });
export type MonitoringAvailabilityPolicyV1 = z.infer<typeof MonitoringAvailabilityPolicyV1Schema>;

export const MonitoringSamplePointStatusV1Schema = z.enum(["available", "interpolated", "missing"]);
export type MonitoringSamplePointStatusV1 = z.infer<typeof MonitoringSamplePointStatusV1Schema>;

export const MonitoringAlignedPointV1Schema = z
  .strictObject({
    sampledAt: IsoDateTimeSchema,
    value: finiteNumber.nullable(),
    unit,
    status: MonitoringSamplePointStatusV1Schema,
    sourceSampleRefs: uniqueBy(MonitoringSampleVersionRefV1Schema, refKey, 2),
    reasonCode: IdentifierSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "missing" && value.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "missing point must not have a value",
      });
    }
    if (value.status !== "missing" && value.value === null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "available point must have a value",
      });
    }
    if (value.status === "missing" && value.reasonCode === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "missing point must have a reason",
      });
    }
  });
export type MonitoringAlignedPointV1 = z.infer<typeof MonitoringAlignedPointV1Schema>;

export const MonitoringFeatureTypeV1Schema = z.enum([
  "short-term-slope",
  "acceleration",
  "dominant-frequency",
  "anomaly-score",
]);
export type MonitoringFeatureTypeV1 = z.infer<typeof MonitoringFeatureTypeV1Schema>;

export const MonitoringFeatureStatusV1Schema = z.enum(["available", "unavailable"]);
export type MonitoringFeatureStatusV1 = z.infer<typeof MonitoringFeatureStatusV1Schema>;

export const MonitoringFeatureResultV1Schema = z
  .strictObject({
    featureType: MonitoringFeatureTypeV1Schema,
    value: finiteNumber.optional(),
    unit: unit.optional(),
    windowSize: positiveInteger,
    inputCount: nonNegativeInteger,
    algorithmVersion: IdentifierSchema,
    status: MonitoringFeatureStatusV1Schema,
    reasonCode: IdentifierSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "available" && value.value === undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "available feature must have a value",
      });
    }
    if (value.status === "unavailable" && value.value !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "unavailable feature must not have a value",
      });
    }
    if (value.status === "unavailable" && value.reasonCode === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "unavailable feature must have a reason",
      });
    }
  });
export type MonitoringFeatureResultV1 = z.infer<typeof MonitoringFeatureResultV1Schema>;

export const MonitoringFeatureSetV1Schema = z
  .strictObject({
    shortTermSlope: MonitoringFeatureResultV1Schema,
    acceleration: MonitoringFeatureResultV1Schema,
    dominantFrequency: MonitoringFeatureResultV1Schema,
    anomalyScore: MonitoringFeatureResultV1Schema,
  })
  .superRefine((value, context) => {
    const expected: Record<string, MonitoringFeatureTypeV1> = {
      shortTermSlope: "short-term-slope",
      acceleration: "acceleration",
      dominantFrequency: "dominant-frequency",
      anomalyScore: "anomaly-score",
    };
    for (const key of Object.keys(expected) as Array<keyof typeof value>) {
      if (value[key].featureType !== expected[key]) {
        context.addIssue({
          code: "custom",
          path: [key, "featureType"],
          message: "feature type does not match its field",
        });
      }
    }
  });
export type MonitoringFeatureSetV1 = z.infer<typeof MonitoringFeatureSetV1Schema>;

export const MonitoringAvailabilityV1Schema = z.enum(["available", "partial", "unavailable"]);
export type MonitoringAvailabilityV1 = z.infer<typeof MonitoringAvailabilityV1Schema>;

export const MonitoringSnapshotMemberV1Schema = z.strictObject({
  memberIndex: nonNegativeInteger,
  monitoringBatchRef: MonitoringBatchRefV1Schema,
  sampleVersionRef: MonitoringSampleVersionRefV1Schema,
  selectionReason: z.enum(["latest-valid", "correction", "supplement", "original"]),
});
export type MonitoringSnapshotMemberV1 = z.infer<typeof MonitoringSnapshotMemberV1Schema>;

export const MonitoringSnapshotV1Schema = z.strictObject({
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  projectId: IdentifierSchema,
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  cutoff: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  window: z
    .strictObject({ from: IsoDateTimeSchema, to: IsoDateTimeSchema })
    .superRefine((value, context) => {
      if (Date.parse(value.to) <= Date.parse(value.from)) {
        context.addIssue({ code: "custom", path: ["to"], message: "to must be later than from" });
      }
    }),
  availabilityPolicyRef: VersionReferenceSchema,
  algorithmVersions,
  monitoringBatchRefs: uniqueBy(MonitoringBatchRefV1Schema, refKey, 100_000),
  sampleVersionRefs: uniqueBy(MonitoringSampleVersionRefV1Schema, refKey, MONITORING_MAX_SAMPLES),
  members: z.array(MonitoringSnapshotMemberV1Schema).max(MONITORING_MAX_SAMPLES),
  alignedPoints: z.array(MonitoringAlignedPointV1Schema).max(MONITORING_MAX_SNAPSHOT_POINTS),
  features: MonitoringFeatureSetV1Schema,
  availability: MonitoringAvailabilityV1Schema,
  coverageRatio: finiteNumber.min(0).max(1),
  availabilityReasons: z.array(IdentifierSchema).max(32),
  evidenceReferences: uniqueBy(EvidenceReferenceSchema, evidenceKey, 100_000),
  authorizationSnapshot: z.strictObject({
    authorizationContextRef: AuthorizationContextRefV1Schema,
    spatialScopeRefs: uniqueBy(SpatialScopeRefV1Schema, refKey, 128),
    sourceAccessGrantRefs: uniqueBy(SourceAccessGrantRefV1Schema, refKey, 256),
  }),
  audit: AuditInfoSchema,
});
export type MonitoringSnapshotV1 = z.infer<typeof MonitoringSnapshotV1Schema>;

export const MonitoringSnapshotQueryV1Schema = z.strictObject({
  queryResultRef: QueryResultRefV1Schema,
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  projectId: IdentifierSchema,
  snapshot: MonitoringSnapshotV1Schema,
  requestedBy: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  recordedAt: IsoDateTimeSchema,
  audit: AuditInfoSchema,
});
export type MonitoringSnapshotQueryV1 = z.infer<typeof MonitoringSnapshotQueryV1Schema>;

const commandBase = {
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  authorization: AuthorizationContextV1Schema,
};

export const ReviseMonitoringSeriesCommandV1Schema = z
  .strictObject({
    ...commandBase,
    monitoringSeriesRef: MonitoringSeriesRefV1Schema,
    expectedVersion: z.union([VersionReferenceSchema, z.literal("none")]),
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    monitoringObject: text,
    monitoringIndicator: MonitoringIndicatorSchema,
    parameterCode: text,
    canonicalUnit: unit,
    unitConversions: uniqueBy(MonitoringUnitConversionV1Schema, (value) => value.fromUnit, 32),
    effectivePeriod: z.strictObject({
      validFrom: IsoDateTimeSchema,
      validTo: IsoDateTimeSchema.optional(),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.expectedVersion !== "none" &&
      value.expectedVersion.entityId !== value.monitoringSeriesRef.reference.entityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "series identity mismatch",
      });
    }
    if (value.unitConversions.some((item) => item.fromUnit === value.canonicalUnit)) {
      context.addIssue({
        code: "custom",
        path: ["unitConversions"],
        message: "canonical unit must not have a conversion rule",
      });
    }
    if (
      value.effectivePeriod.validTo !== undefined &&
      Date.parse(value.effectivePeriod.validTo) <= Date.parse(value.effectivePeriod.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectivePeriod", "validTo"],
        message: "validTo must be later than validFrom",
      });
    }
  });
export type ReviseMonitoringSeriesCommandV1 = z.infer<typeof ReviseMonitoringSeriesCommandV1Schema>;

export const RegisterMonitoringAvailabilityPolicyCommandV1Schema = z
  .strictObject({
    ...commandBase,
    policy: MonitoringAvailabilityPolicyV1Schema,
  })
  .superRefine((value, context) => {
    if (value.projectId !== value.policy.projectId) {
      context.addIssue({
        code: "custom",
        path: ["policy", "projectId"],
        message: "policy project does not match command project",
      });
    }
  });
export type RegisterMonitoringAvailabilityPolicyCommandV1 = z.infer<
  typeof RegisterMonitoringAvailabilityPolicyCommandV1Schema
>;

export const ResolveMonitoringSnapshotQueryV1Schema = z.strictObject({
  queryResultRef: QueryResultRefV1Schema,
  invocationId: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  authorization: AuthorizationContextV1Schema,
});
export type ResolveMonitoringSnapshotQueryV1 = z.infer<
  typeof ResolveMonitoringSnapshotQueryV1Schema
>;

export const ReadMonitoringSeriesRevisionQueryV1Schema = z
  .strictObject({
    queryId: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  })
  .superRefine((query, context) => {
    if (query.projectId !== query.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "query project does not match authorization context",
      });
    }
    if (query.actorId !== query.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "query actor does not match authorization context",
      });
    }
    if (!query.authorization.grantedCapabilities.includes("engineering-data.read")) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "required capability is not granted",
      });
    }
  });
export type ReadMonitoringSeriesRevisionQueryV1 = z.infer<
  typeof ReadMonitoringSeriesRevisionQueryV1Schema
>;

export const MonitoringSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("series-revision"),
    revision: MonitoringSeriesRevisionV1Schema,
  }),
  z.strictObject({
    kind: z.literal("availability-policy"),
    policy: MonitoringAvailabilityPolicyV1Schema,
  }),
  z.strictObject({
    kind: z.literal("snapshot-query"),
    query: MonitoringSnapshotQueryV1Schema,
  }),
]);
export type MonitoringSuccessV1 = z.infer<typeof MonitoringSuccessV1Schema>;

export const MonitoringResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), result: MonitoringSuccessV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type MonitoringResultV1 = z.infer<typeof MonitoringResultV1Schema>;

export const MonitoringSeriesReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), result: MonitoringSeriesRevisionReadV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type MonitoringSeriesReadResultV1 = z.infer<typeof MonitoringSeriesReadResultV1Schema>;

export type MonitoringErrorV1 = ModuleErrorV1;
