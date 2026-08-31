import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);

export const IdentifierSchema = NonEmptyStringSchema;
export type Identifier = z.infer<typeof IdentifierSchema>;

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const VersionReferenceSchema = z.strictObject({
  entityId: IdentifierSchema,
  versionId: IdentifierSchema,
});
export type VersionReference = z.infer<typeof VersionReferenceSchema>;

export const EffectivePeriodSchema = z
  .strictObject({
    validFrom: IsoDateTimeSchema,
    validTo: IsoDateTimeSchema.optional(),
  })
  .superRefine((period, context) => {
    if (
      period.validTo !== undefined &&
      Date.parse(period.validTo) <= Date.parse(period.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "validTo must be later than validFrom",
      });
    }
  });
export type EffectivePeriod = z.infer<typeof EffectivePeriodSchema>;

export const SystemRecordTimeSchema = z
  .strictObject({
    recordedAt: IsoDateTimeSchema,
    supersededAt: IsoDateTimeSchema.optional(),
  })
  .superRefine((time, context) => {
    if (
      time.supersededAt !== undefined &&
      Date.parse(time.supersededAt) <= Date.parse(time.recordedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "supersededAt must be later than recordedAt",
      });
    }
  });
export type SystemRecordTime = z.infer<typeof SystemRecordTimeSchema>;

export const VersionedRecordInfoSchema = z.strictObject({
  reference: VersionReferenceSchema,
  effectivePeriod: EffectivePeriodSchema,
  systemTime: SystemRecordTimeSchema,
});
export type VersionedRecordInfo = z.infer<typeof VersionedRecordInfoSchema>;

export const EvidenceLocatorSchema = z.strictObject({
  sourceSegmentId: IdentifierSchema,
});
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;

export const EvidenceReferenceSchema = z.strictObject({
  locator: EvidenceLocatorSchema,
  sourceVersion: VersionReferenceSchema,
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const AuditInfoSchema = z.strictObject({
  actorId: IdentifierSchema,
  action: IdentifierSchema,
  recordedAt: IsoDateTimeSchema,
  reason: NonEmptyStringSchema.optional(),
});
export type AuditInfo = z.infer<typeof AuditInfoSchema>;

export const ReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ValidationResultSchema = z.strictObject({
  passed: z.boolean(),
  issues: z.array(NonEmptyStringSchema),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const CommandEnvelopeSchema = z.strictObject({
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  payload: z.unknown(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export const ErrorEnvelopeSchema = z.strictObject({
  code: IdentifierSchema,
  retryable: z.boolean(),
  message: NonEmptyStringSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
