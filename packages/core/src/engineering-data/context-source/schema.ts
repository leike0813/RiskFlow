import { z } from "zod";

import {
  AuditInfoSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import { ApplicabilityMetadataSchema } from "@riskflow/contracts/records";
import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AuthorizationContextV1Schema,
  AuthorizationContextRefV1Schema,
  ContentArtifactRefV1Schema,
  ProjectRevisionRefV1Schema,
  SourceAccessGrantRefV1Schema,
  SourceDeliveryRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  ModuleErrorV1Schema,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";

const finiteNumber = z.number().finite();
const boundedText = z.string().trim().min(1).max(200);
const extendedText = z.string().trim().min(1).max(500);
const component = z.string().regex(/^[A-Za-z0-9_]+$/u);
const expectedVersion = z.union([VersionReferenceSchema, z.literal("none")]);

export const CONTEXT_SOURCE_SCHEMA_VERSION_V1 = "1" as const;
export const CONTEXT_SOURCE_MAX_SPATIAL_SCOPES = 128;
export const CONTEXT_SOURCE_MAX_SEGMENTS = 10_000;
export const CONTEXT_SOURCE_MAX_SEGMENT_BATCH = 500;

export const ProjectBusinessLifecycleV1Schema = z.enum([
  "preparing",
  "active",
  "ended",
  "archived",
]);
export type ProjectBusinessLifecycleV1 = z.infer<typeof ProjectBusinessLifecycleV1Schema>;

export const SpatialBusinessStatusV1Schema = z.enum(["active", "inactive"]);
export type SpatialBusinessStatusV1 = z.infer<typeof SpatialBusinessStatusV1Schema>;

export const SourceSegmentKindV1Schema = z.enum(["chapter", "table", "monitoring-window"]);
export type SourceSegmentKindV1 = z.infer<typeof SourceSegmentKindV1Schema>;

export const SourceDeliveryKindV1Schema = z.enum([
  "file-upload",
  "database-snapshot",
  "api-snapshot",
]);
export type SourceDeliveryKindV1 = z.infer<typeof SourceDeliveryKindV1Schema>;

export const SourceAccessStatusV1Schema = z.enum(["pending-access", "ready"]);
export type SourceAccessStatusV1 = z.infer<typeof SourceAccessStatusV1Schema>;

export const ChainageRangeV1Schema = z
  .strictObject({ start: finiteNumber, end: finiteNumber })
  .superRefine((value, context) => {
    if (value.end <= value.start) {
      context.addIssue({ code: "custom", path: ["end"], message: "end must be later than start" });
    }
  });
export type ChainageRangeV1 = z.infer<typeof ChainageRangeV1Schema>;

export const EffectivePeriodV1Schema = z
  .strictObject({ validFrom: IsoDateTimeSchema, validTo: IsoDateTimeSchema.optional() })
  .superRefine((value, context) => {
    if (value.validTo !== undefined && Date.parse(value.validTo) <= Date.parse(value.validFrom)) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "validTo must be later than validFrom",
      });
    }
  });
export type EffectivePeriodV1 = z.infer<typeof EffectivePeriodV1Schema>;

export const SystemTimeV1Schema = z
  .strictObject({ recordedAt: IsoDateTimeSchema, supersededAt: IsoDateTimeSchema.optional() })
  .superRefine((value, context) => {
    if (
      value.supersededAt !== undefined &&
      Date.parse(value.supersededAt) <= Date.parse(value.recordedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "supersededAt must be later than recordedAt",
      });
    }
  });
export type SystemTimeV1 = z.infer<typeof SystemTimeV1Schema>;

export const ContextAuditV1Schema = AuditInfoSchema;
export type ContextAuditV1 = z.infer<typeof ContextAuditV1Schema>;

const uniqueReferences = <T extends z.ZodTypeAny>(schema: T, max: number, minimum = 0) =>
  z
    .array(schema)
    .min(minimum)
    .max(max)
    .superRefine((values, context) => {
      const keys = values.map((value) => JSON.stringify(value));
      if (new Set(keys).size !== values.length) {
        context.addIssue({ code: "custom", message: "collection must not contain duplicates" });
      }
    });

export const SpatialScopeRefSetV1Schema = uniqueReferences(
  SpatialScopeRefV1Schema,
  CONTEXT_SOURCE_MAX_SPATIAL_SCOPES,
  1,
);
export type SpatialScopeRefSetV1 = z.infer<typeof SpatialScopeRefSetV1Schema>;

export const ProjectBusinessRevisionV1Schema = z.strictObject({
  projectRevisionRef: ProjectRevisionRefV1Schema,
  name: boundedText,
  lifecycle: ProjectBusinessLifecycleV1Schema,
  applicabilityMetadata: ApplicabilityMetadataSchema,
  effectivePeriod: EffectivePeriodV1Schema,
  systemTime: SystemTimeV1Schema,
  previousRevisionRef: ProjectRevisionRefV1Schema.optional(),
  audit: ContextAuditV1Schema,
});
export type ProjectBusinessRevisionV1 = z.infer<typeof ProjectBusinessRevisionV1Schema>;

export const SpatialApplicabilityOverridesV1Schema = z.strictObject({
  constructionMethod: IdentifierSchema.optional(),
  stratumCondition: IdentifierSchema.optional(),
  engineeringStage: IdentifierSchema.optional(),
});
export type SpatialApplicabilityOverridesV1 = z.infer<typeof SpatialApplicabilityOverridesV1Schema>;

export const SpatialBusinessRevisionV1Schema = z.strictObject({
  spatialScopeRef: SpatialScopeRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  parentScopeRef: SpatialScopeRefV1Schema.optional(),
  name: boundedText,
  worksiteLocation: extendedText,
  chainage: ChainageRangeV1Schema.optional(),
  applicabilityOverrides: SpatialApplicabilityOverridesV1Schema,
  status: SpatialBusinessStatusV1Schema,
  effectivePeriod: EffectivePeriodV1Schema,
  systemTime: SystemTimeV1Schema,
  previousRevisionRef: SpatialScopeRefV1Schema.optional(),
  audit: ContextAuditV1Schema,
});
export type SpatialBusinessRevisionV1 = z.infer<typeof SpatialBusinessRevisionV1Schema>;

export const SourceMetadataV1Schema = z
  .strictObject({
    documentType: boundedText.optional(),
    formedAt: IsoDateTimeSchema.optional(),
    worksiteLocation: extendedText.optional(),
    chainage: ChainageRangeV1Schema.optional(),
    sourceOrganization: boundedText.optional(),
    externalVersion: extendedText.optional(),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((item) => item === undefined)) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "at least one source metadata field is required",
      });
    }
  });
export type SourceMetadataV1 = z.infer<typeof SourceMetadataV1Schema>;

export const SourceDeliveryDescriptorV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file-upload"),
    contentFingerprint: extendedText,
  }),
  z.strictObject({
    kind: z.literal("database-snapshot"),
    connectionDefinitionRef: VersionReferenceSchema,
    queryFingerprint: extendedText,
    cursorFingerprint: extendedText.optional(),
  }),
  z.strictObject({
    kind: z.literal("api-snapshot"),
    connectionDefinitionRef: VersionReferenceSchema,
    requestFingerprint: extendedText,
    responseFingerprint: extendedText,
  }),
]);
export type SourceDeliveryDescriptorV1 = z.infer<typeof SourceDeliveryDescriptorV1Schema>;

export const SourceDeliveryMetadataEnvelopeV1Schema = z.strictObject({
  schemaVersion: z.literal(CONTEXT_SOURCE_SCHEMA_VERSION_V1),
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRefs: SpatialScopeRefSetV1Schema,
  registeredByAccountId: IdentifierSchema,
  sourceItemId: IdentifierSchema,
  sourceItemName: boundedText,
  sourceCategory: boundedText,
  sourceMetadata: SourceMetadataV1Schema,
  descriptor: SourceDeliveryDescriptorV1Schema,
  applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
});
export type SourceDeliveryMetadataEnvelopeV1 = z.infer<
  typeof SourceDeliveryMetadataEnvelopeV1Schema
>;

export const SourceItemV1Schema = z.strictObject({
  sourceItemId: IdentifierSchema,
  projectId: IdentifierSchema,
  name: boundedText,
  category: boundedText,
  audit: ContextAuditV1Schema,
});
export type SourceItemV1 = z.infer<typeof SourceItemV1Schema>;

export const SourceDeliveryV1Schema = z.strictObject({
  sourceDeliveryRef: SourceDeliveryRefV1Schema,
  projectId: IdentifierSchema,
  sourceItemId: IdentifierSchema,
  sourceVersionRef: SourceVersionRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRefs: SpatialScopeRefSetV1Schema,
  descriptor: SourceDeliveryDescriptorV1Schema,
  sourceMetadata: SourceMetadataV1Schema,
  sourceArtifactRef: ContentArtifactRefV1Schema,
  metadataArtifactRef: ContentArtifactRefV1Schema,
  applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  registeredByAccountId: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  audit: ContextAuditV1Schema,
});
export type SourceDeliveryV1 = z.infer<typeof SourceDeliveryV1Schema>;

export const SourceVersionV1Schema = z
  .strictObject({
    sourceVersionRef: SourceVersionRefV1Schema,
    projectId: IdentifierSchema,
    sourceId: component,
    sourceItemId: IdentifierSchema,
    sourceDeliveryRef: SourceDeliveryRefV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRefs: SpatialScopeRefSetV1Schema,
    sourceArtifactRef: ContentArtifactRefV1Schema,
    metadataArtifactRef: ContentArtifactRefV1Schema,
    sourceAccessGrantRef: SourceAccessGrantRefV1Schema.optional(),
    accessStatus: SourceAccessStatusV1Schema,
    applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    previousSourceVersionRef: SourceVersionRefV1Schema.optional(),
    recordedAt: IsoDateTimeSchema,
    audit: ContextAuditV1Schema,
  })
  .superRefine((value, context) => {
    if (value.accessStatus === "pending-access" && value.sourceAccessGrantRef !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceAccessGrantRef"],
        message: "pending source cannot have a grant",
      });
    }
    if (value.accessStatus === "ready" && value.sourceAccessGrantRef === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceAccessGrantRef"],
        message: "ready source requires a grant",
      });
    }
  });
export type SourceVersionV1 = z.infer<typeof SourceVersionV1Schema>;

export const SegmentIndexRangeV1Schema = z
  .strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .superRefine((value, context) => {
    if (value.end < value.start) {
      context.addIssue({ code: "custom", path: ["end"], message: "end must not precede start" });
    }
  });
export type SegmentIndexRangeV1 = z.infer<typeof SegmentIndexRangeV1Schema>;

export const SourceSegmentLocatorV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("document"),
    pageNumber: z.number().int().positive(),
    headingPath: z.array(boundedText).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("table"),
    sheet: boundedText,
    table: boundedText,
    rowRange: SegmentIndexRangeV1Schema,
    columnRange: SegmentIndexRangeV1Schema,
  }),
  z.strictObject({
    kind: z.literal("record"),
    dataset: boundedText,
    stableRecordKey: extendedText,
  }),
  z
    .strictObject({
      kind: z.literal("time-window"),
      from: IsoDateTimeSchema,
      to: IsoDateTimeSchema,
    })
    .superRefine((value, context) => {
      if (Date.parse(value.to) <= Date.parse(value.from)) {
        context.addIssue({ code: "custom", path: ["to"], message: "to must be later than from" });
      }
    }),
]);
export type SourceSegmentLocatorV1 = z.infer<typeof SourceSegmentLocatorV1Schema>;

export const SourceSegmentIdV1Schema = z
  .string()
  .regex(/^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[A-Za-z0-9_]+$/u)
  .brand<"SourceSegmentIdV1">();
export type SourceSegmentIdV1 = z.infer<typeof SourceSegmentIdV1Schema>;

export const SourceSegmentV1Schema = z
  .strictObject({
    sourceSegmentId: SourceSegmentIdV1Schema,
    chapterId: component,
    segmentId: component,
    kind: SourceSegmentKindV1Schema,
    spatialScopeRefs: SpatialScopeRefSetV1Schema,
    locator: SourceSegmentLocatorV1Schema,
  })
  .superRefine((value, context) => {
    const parsed = parseSourceSegmentId(value.sourceSegmentId);
    if (
      parsed === undefined ||
      parsed.chapterId !== value.chapterId ||
      parsed.segmentId !== value.segmentId
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceSegmentId"],
        message: "source segment id does not match its components",
      });
    }
  });
export type SourceSegmentV1 = z.infer<typeof SourceSegmentV1Schema>;

export const SourceSegmentSetV1Schema = z
  .strictObject({
    sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
    sourceVersionRef: SourceVersionRefV1Schema,
    sourceId: component,
    segments: z.array(SourceSegmentV1Schema).min(1).max(CONTEXT_SOURCE_MAX_SEGMENTS),
    recordedAt: IsoDateTimeSchema,
    audit: ContextAuditV1Schema,
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, segment] of value.segments.entries()) {
      if (ids.has(segment.sourceSegmentId)) {
        context.addIssue({
          code: "custom",
          path: ["segments", index, "sourceSegmentId"],
          message: "source segment id must be unique",
        });
      }
      ids.add(segment.sourceSegmentId);
      const parsed = parseSourceSegmentId(segment.sourceSegmentId);
      if (parsed === undefined || parsed.sourceId !== value.sourceId) {
        context.addIssue({
          code: "custom",
          path: ["segments", index, "sourceSegmentId"],
          message: "source segment id does not match source id",
        });
      }
    }
  });
export type SourceSegmentSetV1 = z.infer<typeof SourceSegmentSetV1Schema>;

export const ApplicabilityValueProvenanceV1Schema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("project-revision"),
    revisionRef: ProjectRevisionRefV1Schema,
  }),
  z.strictObject({
    source: z.literal("spatial-scope-revision"),
    revisionRef: SpatialScopeRefV1Schema,
  }),
]);
export type ApplicabilityValueProvenanceV1 = z.infer<typeof ApplicabilityValueProvenanceV1Schema>;

export const ApplicabilityProvenanceV1Schema = z.strictObject({
  constructionMethod: ApplicabilityValueProvenanceV1Schema,
  stratumCondition: ApplicabilityValueProvenanceV1Schema,
  engineeringStage: ApplicabilityValueProvenanceV1Schema,
});
export type ApplicabilityProvenanceV1 = z.infer<typeof ApplicabilityProvenanceV1Schema>;

export const ApplicabilityMetadataSnapshotV1Schema = z.strictObject({
  snapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  applicabilityMetadata: ApplicabilityMetadataSchema,
  provenance: ApplicabilityProvenanceV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  formedAt: IsoDateTimeSchema,
  worksiteLocation: extendedText.optional(),
  chainage: ChainageRangeV1Schema.optional(),
  audit: ContextAuditV1Schema,
});
export type ApplicabilityMetadataSnapshotV1 = z.infer<typeof ApplicabilityMetadataSnapshotV1Schema>;

const commandBase = {
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  authorization: AuthorizationContextV1Schema,
};

export const EngineeringContextRevisionCommandV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commandBase,
    kind: z.literal("project"),
    expectedVersion,
    name: boundedText,
    lifecycle: ProjectBusinessLifecycleV1Schema,
    applicabilityMetadata: ApplicabilityMetadataSchema,
    effectivePeriod: EffectivePeriodV1Schema,
  }),
  z.strictObject({
    ...commandBase,
    kind: z.literal("spatial"),
    spatialScopeRef: SpatialScopeRefV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    expectedVersion,
    parentScopeRef: SpatialScopeRefV1Schema.optional(),
    name: boundedText,
    worksiteLocation: extendedText,
    chainage: ChainageRangeV1Schema.optional(),
    applicabilityOverrides: SpatialApplicabilityOverridesV1Schema,
    status: SpatialBusinessStatusV1Schema,
    effectivePeriod: EffectivePeriodV1Schema,
  }),
]);
export type EngineeringContextRevisionCommandV1 = z.infer<
  typeof EngineeringContextRevisionCommandV1Schema
>;

export const RegisterSourceSegmentSetCommandV1Schema = z.strictObject({
  ...commandBase,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceId: component,
  segments: z.array(SourceSegmentV1Schema).min(1).max(CONTEXT_SOURCE_MAX_SEGMENTS),
});
export type RegisterSourceSegmentSetCommandV1 = z.infer<
  typeof RegisterSourceSegmentSetCommandV1Schema
>;

export const CreateApplicabilitySnapshotCommandV1Schema = z.strictObject({
  ...commandBase,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  formedAt: IsoDateTimeSchema,
});
export type CreateApplicabilitySnapshotCommandV1 = z.infer<
  typeof CreateApplicabilitySnapshotCommandV1Schema
>;

export const ContextSourceSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("project-revision"),
    revision: ProjectBusinessRevisionV1Schema,
  }),
  z.strictObject({
    kind: z.literal("spatial-revision"),
    revision: SpatialBusinessRevisionV1Schema,
  }),
  z.strictObject({ kind: z.literal("source-segment-set"), segmentSet: SourceSegmentSetV1Schema }),
  z.strictObject({
    kind: z.literal("applicability-snapshot"),
    snapshot: ApplicabilityMetadataSnapshotV1Schema,
  }),
]);
export type ContextSourceSuccessV1 = z.infer<typeof ContextSourceSuccessV1Schema>;

export const ContextSourceErrorV1Schema = ModuleErrorV1Schema;
export type ContextSourceErrorV1 = ModuleErrorV1;

export const ContextSourceResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), result: ContextSourceSuccessV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: ContextSourceErrorV1Schema }),
]);
export type ContextSourceResultV1 = z.infer<typeof ContextSourceResultV1Schema>;

const referenceKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}) => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

export const makeSourceSegmentId = (
  sourceId: string,
  chapterId: string,
  segmentId: string,
): SourceSegmentIdV1 =>
  SourceSegmentIdV1Schema.parse(
    `${component.parse(sourceId)}-${component.parse(chapterId)}-${component.parse(segmentId)}`,
  );

export const parseSourceSegmentId = (
  value: string,
): { sourceId: string; chapterId: string; segmentId: string } | undefined => {
  const parsed = SourceSegmentIdV1Schema.safeParse(value);
  if (!parsed.success) return undefined;
  const [sourceId, chapterId, segmentId] = parsed.data.split("-");
  return sourceId === undefined || chapterId === undefined || segmentId === undefined
    ? undefined
    : { sourceId, chapterId, segmentId };
};

export const normalizeSpatialScopeRefs = (
  refs: readonly z.infer<typeof SpatialScopeRefV1Schema>[],
): z.infer<typeof SpatialScopeRefSetV1Schema> =>
  SpatialScopeRefSetV1Schema.parse(
    [...refs].sort((left, right) => {
      const leftKey = referenceKey(left);
      const rightKey = referenceKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  );

export const normalizeSourceSegments = (segments: readonly SourceSegmentV1[]): SourceSegmentV1[] =>
  [...segments].sort((left, right) =>
    left.sourceSegmentId < right.sourceSegmentId
      ? -1
      : left.sourceSegmentId > right.sourceSegmentId
        ? 1
        : 0,
  );

export const versionReferenceEquals = (
  left: { reference: { entityId: string; versionId: string } },
  right: { reference: { entityId: string; versionId: string } },
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

export const contextSourceReferenceKey = referenceKey;

export type ContextSourceCommandV1 =
  | EngineeringContextRevisionCommandV1
  | RegisterSourceSegmentSetCommandV1
  | CreateApplicabilitySnapshotCommandV1;

export type ContextSourceAuthorizationV1 = z.infer<typeof AuthorizationContextV1Schema>;
export type ContextSourceAuthorizationRefV1 = z.infer<typeof AuthorizationContextRefV1Schema>;
export type ContextSourceDeliveryRefV1 = z.infer<typeof SourceDeliveryRefV1Schema>;
export type ContextSourceSegmentSetRefV1 = z.infer<typeof SourceSegmentSetRefV1Schema>;
