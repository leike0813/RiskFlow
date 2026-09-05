import { z } from "@riskflow/core/model";

import {
  DOCUMENT_CONVERSION_MAX_BLOCKS,
  ParsedDocumentV1Schema,
  type DocumentInputKindV1,
  type ParsedDocumentV1,
} from "@riskflow/core/engineering-data/document-conversion";
import type { SourceProcessingInputV1 } from "@riskflow/core/engineering-data/context-source";

const positiveSafeInteger = z.number().int().positive().safe();

export const DocumentConversionResourcePolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    policyRef: z.strictObject({ entityId: z.string().min(1), versionId: z.string().min(1) }),
    maxInputBytes: positiveSafeInteger,
    maxZipEntries: positiveSafeInteger,
    maxZipUncompressedBytes: positiveSafeInteger,
    maxZipCompressionRatio: z.number().finite().positive(),
    maxXmlBytes: positiveSafeInteger,
    maxPdfPages: positiveSafeInteger,
    maxPdfTextItems: positiveSafeInteger,
    maxSheets: positiveSafeInteger,
    maxCells: positiveSafeInteger,
    maxCsvRecords: positiveSafeInteger,
    maxCsvFields: positiveSafeInteger,
    maxOutputBlocks: positiveSafeInteger,
  })
  .superRefine((policy, context) => {
    if (policy.maxZipCompressionRatio < 1) {
      context.addIssue({
        code: "custom",
        path: ["maxZipCompressionRatio"],
        message: "zip compression ratio must be at least one",
      });
    }
    if (policy.maxOutputBlocks > DOCUMENT_CONVERSION_MAX_BLOCKS) {
      context.addIssue({
        code: "custom",
        path: ["maxOutputBlocks"],
        message: "output block limit exceeds the core document limit",
      });
    }
  });
export type DocumentConversionResourcePolicyV1 = z.infer<
  typeof DocumentConversionResourcePolicyV1Schema
>;

export const DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1 = Object.freeze(
  DocumentConversionResourcePolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: { entityId: "document-conversion-policy", versionId: "1" },
    maxInputBytes: 100 * 1024 * 1024,
    maxZipEntries: 4_096,
    maxZipUncompressedBytes: 400 * 1024 * 1024,
    maxZipCompressionRatio: 200,
    maxXmlBytes: 50 * 1024 * 1024,
    maxPdfPages: 10_000,
    maxPdfTextItems: 1_000_000,
    maxSheets: 256,
    maxCells: 1_000_000,
    maxCsvRecords: 1_000_000,
    maxCsvFields: 10_000,
    maxOutputBlocks: DOCUMENT_CONVERSION_MAX_BLOCKS,
  }),
);

export type DocumentParserContextV1 = {
  readonly source: SourceProcessingInputV1;
  readonly inputKind: DocumentInputKindV1;
  readonly mediaType: string;
};

export class DocumentParserError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly sourceSegmentId: string | undefined;
  readonly observedBytes: number | undefined;

  constructor(
    code: string,
    message: string,
    retryable = false,
    sourceSegmentId?: string,
    observedBytes?: number,
  ) {
    super(message);
    this.name = "DocumentParserError";
    this.code = code;
    this.retryable = retryable;
    this.sourceSegmentId = sourceSegmentId;
    this.observedBytes = observedBytes;
  }
}

export const parseResourcePolicy = (
  policy: unknown = DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
): DocumentConversionResourcePolicyV1 => DocumentConversionResourcePolicyV1Schema.parse(policy);

export const validateParsedDocument = (value: unknown): ParsedDocumentV1 =>
  ParsedDocumentV1Schema.parse(value);
