import { z } from "zod";
import { ArtifactRefV1Schema } from "../../artifacts/schema.js";

import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";
import {
  ContentArtifactRefV1Schema,
  SourceVersionRefV1Schema,
  StructuredDocumentConversionStatisticsV1Schema,
  type StructuredDocumentConversionStatisticsV1,
} from "@riskflow/contracts/ports";

import { SourceSegmentIdV1Schema } from "@riskflow/contracts/engineering-workspace";
import {
  SourceSegmentLocatorV1Schema,
  SourceSegmentKindV1Schema,
  SpatialScopeRefSetV1Schema,
} from "../context-source/schema.js";

export const DOCUMENT_CONVERSION_SCHEMA_VERSION_V1 = "1" as const;
export const STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1 = 16 * 1024 * 1024;
export const DOCUMENT_CONVERSION_MAX_BLOCK_CODE_POINTS = 512;
export const DOCUMENT_CONVERSION_MAX_BLOCKS = 10_000;
export const DOCUMENT_CONVERSION_MAX_TEXT_BLOCKS = 50_000;

const safeInteger = z.number().int().safe();
const positiveInteger = safeInteger.positive();
const finiteNumber = z.number().finite();
const boundedText = z.string().max(200_000);
const identifierPart = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/u)
  .max(128);
const nonEmptyIdentifier = IdentifierSchema.max(256);

export const DocumentInputKindV1Schema = z.enum(["docx", "text-pdf", "xlsx", "csv", "ocr-layout"]);
export type DocumentInputKindV1 = z.infer<typeof DocumentInputKindV1Schema>;

export const DocumentCoordinateV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page"),
    pageNumber: positiveInteger,
    x: finiteNumber,
    y: finiteNumber,
    width: finiteNumber.nonnegative(),
    height: finiteNumber.nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("cell"),
    sheet: nonEmptyIdentifier,
    row: positiveInteger,
    column: positiveInteger,
    rowSpan: positiveInteger,
    columnSpan: positiveInteger,
  }),
  z.strictObject({
    kind: z.literal("record"),
    dataset: nonEmptyIdentifier,
    row: positiveInteger,
  }),
]);
export type DocumentCoordinateV1 = z.infer<typeof DocumentCoordinateV1Schema>;

export const DocumentPageExtentV1Schema = z.strictObject({
  pageNumber: positiveInteger,
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
  coordinateSystem: z.enum(["pixel-top-left", "point-top-left"]),
});
export type DocumentPageExtentV1 = z.infer<typeof DocumentPageExtentV1Schema>;

const pageExtentsSchema = z
  .array(DocumentPageExtentV1Schema)
  .min(1)
  .max(DOCUMENT_CONVERSION_MAX_BLOCKS)
  .superRefine((extents, context) => {
    for (let index = 1; index < extents.length; index += 1) {
      if (extents[index]!.pageNumber <= extents[index - 1]!.pageNumber) {
        context.addIssue({
          code: "custom",
          path: [index, "pageNumber"],
          message: "page extents must be unique and ascending by page number",
        });
      }
    }
  });

const confidenceSchema = z.number().finite().min(0).max(1);

// 仅引用耐久ZIP内的规范化相对路径。
const packageEntryPath = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[A-Za-z0-9_\u4e00-\u9fff][A-Za-z0-9_.\-\u4e00-\u9fff]*(?:\/[A-Za-z0-9_\u4e00-\u9fff][A-Za-z0-9_.\-\u4e00-\u9fff]*)*$/u,
  );

/** 未识别视觉载荷引用：指向已耐久 MinerU 原响应 ZIP 中经复验的唯一图片条目，不表达业务值。 */
export const UnrecognizedTableImageRefV1Schema = z.strictObject({
  kind: z.literal("unrecognized-image"),
  rawResponseArtifactRef: ArtifactRefV1Schema,
  packageEntryPath,
});
export type UnrecognizedTableImageRefV1 = z.infer<typeof UnrecognizedTableImageRefV1Schema>;

const unrecognizedImagesSchema = z
  .array(UnrecognizedTableImageRefV1Schema)
  .min(1)
  .max(DOCUMENT_CONVERSION_MAX_BLOCKS);

export const NormalizedBlockKindV1Schema = z.enum([
  "heading",
  "paragraph",
  "caption",
  "table",
  "cell",
  "record",
  "process-step",
  "page-break",
]);
export type NormalizedBlockKindV1 = z.infer<typeof NormalizedBlockKindV1Schema>;

const scalarValue = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const NormalizedBlockV1Schema = z
  .strictObject({
    blockId: nonEmptyIdentifier,
    kind: NormalizedBlockKindV1Schema,
    text: boundedText,
    value: scalarValue.optional(),
    chapterId: identifierPart.optional(),
    segmentId: identifierPart.optional(),
    headingPath: z.array(nonEmptyIdentifier).max(64),
    locator: SourceSegmentLocatorV1Schema,
    coordinate: DocumentCoordinateV1Schema.optional(),
    confidence: confidenceSchema.optional(),
    tableId: nonEmptyIdentifier.optional(),
    sheet: nonEmptyIdentifier.optional(),
    row: positiveInteger.optional(),
    column: positiveInteger.optional(),
    rowSpan: positiveInteger.optional(),
    columnSpan: positiveInteger.optional(),
    formula: boundedText.optional(),
    cachedValue: scalarValue.optional(),
    unrecognizedImages: unrecognizedImagesSchema.optional(),
  })
  .superRefine((block, context) => {
    if (block.kind === "cell") {
      if (block.tableId === undefined || block.sheet === undefined) {
        context.addIssue({
          code: "custom",
          path: ["tableId"],
          message: "cell table identity required",
        });
      }
      if (block.row === undefined || block.column === undefined) {
        context.addIssue({ code: "custom", path: ["row"], message: "cell coordinate required" });
      }
    }
    if (block.unrecognizedImages !== undefined && block.kind !== "cell") {
      context.addIssue({
        code: "custom",
        path: ["unrecognizedImages"],
        message: "unrecognized images are only allowed on cell blocks",
      });
    }
    if (block.kind === "table" && block.tableId === undefined) {
      context.addIssue({ code: "custom", path: ["tableId"], message: "table identity required" });
    }
    if (block.formula !== undefined && block.cachedValue === undefined) {
      context.addIssue({
        code: "custom",
        path: ["cachedValue"],
        message: "formula block must preserve cached value",
      });
    }
  });
export type NormalizedBlockV1 = z.infer<typeof NormalizedBlockV1Schema>;

export const DocumentMetadataV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  sourceId: identifierPart,
  sourceItemId: IdentifierSchema,
  mediaType: nonEmptyIdentifier,
  title: nonEmptyIdentifier.optional(),
  formedAt: IsoDateTimeSchema.optional(),
});
export type DocumentMetadataV1 = z.infer<typeof DocumentMetadataV1Schema>;

export const ParsedDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
  inputKind: DocumentInputKindV1Schema,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceArtifactRef: ContentArtifactRefV1Schema,
  sourceId: identifierPart,
  spatialScopeRefs: SpatialScopeRefSetV1Schema,
  metadata: DocumentMetadataV1Schema,
  blocks: z.array(NormalizedBlockV1Schema).min(1).max(DOCUMENT_CONVERSION_MAX_BLOCKS),
  pageExtents: pageExtentsSchema.optional(),
  inputBytes: safeInteger.nonnegative(),
});
export type ParsedDocumentV1 = z.infer<typeof ParsedDocumentV1Schema>;

export const TextBlockV1Schema = z
  .strictObject({
    blockId: nonEmptyIdentifier,
    sourceBlockId: nonEmptyIdentifier,
    sourceVersionRef: SourceVersionRefV1Schema,
    sourceSegmentId: SourceSegmentIdV1Schema,
    sequence: positiveInteger,
    text: boundedText.max(DOCUMENT_CONVERSION_MAX_BLOCK_CODE_POINTS),
    previousBlockId: nonEmptyIdentifier.optional(),
    nextBlockId: nonEmptyIdentifier.optional(),
    headingPath: z.array(nonEmptyIdentifier).max(64),
    coordinate: DocumentCoordinateV1Schema.optional(),
    confidence: confidenceSchema.optional(),
  })
  .superRefine((block, context) => {
    if (Array.from(block.text).length > DOCUMENT_CONVERSION_MAX_BLOCK_CODE_POINTS) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "text block exceeds 512 code points",
      });
    }
    if (block.previousBlockId === block.blockId || block.nextBlockId === block.blockId) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "text block pointer cannot be self-referential",
      });
    }
  });
export type TextBlockV1 = z.infer<typeof TextBlockV1Schema>;

export const StructureEntityTypeV1Schema = z.enum([
  "document",
  "heading",
  "paragraph",
  "caption",
  "table",
  "cell",
  "record",
  "process-step",
  "page-break",
]);
export type StructureEntityTypeV1 = z.infer<typeof StructureEntityTypeV1Schema>;

export const StructureEntityV1Schema = z.strictObject({
  entityId: nonEmptyIdentifier,
  entityType: StructureEntityTypeV1Schema,
  sourceBlockId: nonEmptyIdentifier.optional(),
  parentEntityId: nonEmptyIdentifier.optional(),
});
export type StructureEntityV1 = z.infer<typeof StructureEntityV1Schema>;

export const StructureRelationTypeV1Schema = z.enum(["contains", "follows", "has-cell"]);
export type StructureRelationTypeV1 = z.infer<typeof StructureRelationTypeV1Schema>;

export const StructureRelationV1Schema = z.strictObject({
  relationId: nonEmptyIdentifier,
  relationType: StructureRelationTypeV1Schema,
  fromEntityId: nonEmptyIdentifier,
  toEntityId: nonEmptyIdentifier,
  sourceVersionRef: SourceVersionRefV1Schema,
});
export type StructureRelationV1 = z.infer<typeof StructureRelationV1Schema>;

export const EvidenceFragmentV1Schema = z.strictObject({
  evidenceId: nonEmptyIdentifier,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentId: SourceSegmentIdV1Schema,
  textBlockIds: z.array(nonEmptyIdentifier).min(1),
});
export type EvidenceFragmentV1 = z.infer<typeof EvidenceFragmentV1Schema>;

export const SourceSegmentDraftV1Schema = z.strictObject({
  sourceSegmentId: SourceSegmentIdV1Schema,
  sourceId: identifierPart,
  chapterId: identifierPart,
  segmentId: identifierPart,
  kind: SourceSegmentKindV1Schema,
  spatialScopeRefs: SpatialScopeRefSetV1Schema,
  locator: SourceSegmentLocatorV1Schema,
  textBlockIds: z.array(nonEmptyIdentifier).min(1),
});
export type SourceSegmentDraftV1 = z.infer<typeof SourceSegmentDraftV1Schema>;

export const TableFieldV1Schema = z.strictObject({
  fieldId: nonEmptyIdentifier,
  tableId: nonEmptyIdentifier,
  sheet: nonEmptyIdentifier,
  row: positiveInteger,
  column: positiveInteger,
  value: scalarValue,
  formula: boundedText.optional(),
  cachedValue: scalarValue.optional(),
  mergedRange: z
    .strictObject({
      startRow: positiveInteger,
      endRow: positiveInteger,
      startColumn: positiveInteger,
      endColumn: positiveInteger,
    })
    .optional(),
  unrecognizedImages: unrecognizedImagesSchema.optional(),
});
export type TableFieldV1 = z.infer<typeof TableFieldV1Schema>;

export const ProcessStepV1Schema = z.strictObject({
  stepId: nonEmptyIdentifier,
  sourceBlockId: nonEmptyIdentifier,
  textBlockIds: z.array(nonEmptyIdentifier).min(1),
  sequence: positiveInteger,
});
export type ProcessStepV1 = z.infer<typeof ProcessStepV1Schema>;

export const DocumentConversionStatisticsV1Schema = StructuredDocumentConversionStatisticsV1Schema;
export type DocumentConversionStatisticsV1 = StructuredDocumentConversionStatisticsV1;

export const ComplianceIssueV1Schema = z.strictObject({
  code: IdentifierSchema,
  stage: IdentifierSchema,
  sourceSegmentId: SourceSegmentIdV1Schema.optional(),
});
export type ComplianceIssueV1 = z.infer<typeof ComplianceIssueV1Schema>;

export const ComplianceCheckV1Schema = z.strictObject({
  code: IdentifierSchema,
  passed: z.boolean(),
});
export type ComplianceCheckV1 = z.infer<typeof ComplianceCheckV1Schema>;

export const ComplianceReportV1Schema = z.strictObject({
  schemaVersion: z.literal(DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
  passed: z.boolean(),
  fieldChecks: z.array(ComplianceCheckV1Schema),
  entityChecks: z.array(ComplianceCheckV1Schema),
  relationChecks: z.array(ComplianceCheckV1Schema),
  segmentChecks: z.array(ComplianceCheckV1Schema),
  issues: z.array(ComplianceIssueV1Schema),
});
export type ComplianceReportV1 = z.infer<typeof ComplianceReportV1Schema>;

export const NormalizedDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
  inputKind: DocumentInputKindV1Schema,
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceArtifactRef: ContentArtifactRefV1Schema,
  sourceId: identifierPart,
  metadata: DocumentMetadataV1Schema,
  textBlocks: z.array(TextBlockV1Schema).min(1).max(DOCUMENT_CONVERSION_MAX_TEXT_BLOCKS),
  entities: z
    .array(StructureEntityV1Schema)
    .min(1)
    .max(DOCUMENT_CONVERSION_MAX_BLOCKS + 1),
  relations: z.array(StructureRelationV1Schema).max(DOCUMENT_CONVERSION_MAX_BLOCKS * 2),
  evidenceFragments: z
    .array(EvidenceFragmentV1Schema)
    .min(1)
    .max(DOCUMENT_CONVERSION_MAX_TEXT_BLOCKS),
  sourceSegments: z.array(SourceSegmentDraftV1Schema).min(1).max(DOCUMENT_CONVERSION_MAX_BLOCKS),
  pageExtents: pageExtentsSchema.optional(),
  tableFields: z.array(TableFieldV1Schema).max(DOCUMENT_CONVERSION_MAX_BLOCKS).optional(),
  processSteps: z.array(ProcessStepV1Schema).max(DOCUMENT_CONVERSION_MAX_BLOCKS).optional(),
  statistics: DocumentConversionStatisticsV1Schema,
});
export type NormalizedDocumentV1 = z.infer<typeof NormalizedDocumentV1Schema>;

const controlledContext = z.strictObject({
  "@version": z.literal(1.1),
  riskflow: z.literal("urn:riskflow:structured-document:v1#"),
});

export const StructuredDocumentJsonLdV1Schema = z.strictObject({
  "@context": controlledContext,
  "@id": nonEmptyIdentifier,
  "@type": z.literal("riskflow:StructuredDocument"),
  schemaVersion: z.literal(DOCUMENT_CONVERSION_SCHEMA_VERSION_V1),
  metadata: DocumentMetadataV1Schema,
  textBlocks: z.array(TextBlockV1Schema).min(1),
  evidenceFragments: z.array(EvidenceFragmentV1Schema).min(1),
  entities: z.array(StructureEntityV1Schema).min(1),
  relations: z.array(StructureRelationV1Schema),
  pageExtents: pageExtentsSchema.optional(),
  tableFields: z.array(TableFieldV1Schema).optional(),
  processSteps: z.array(ProcessStepV1Schema).optional(),
});
export type StructuredDocumentJsonLdV1 = z.infer<typeof StructuredDocumentJsonLdV1Schema>;

export const NormalizedDocumentResultV1Schema = z.strictObject({
  document: NormalizedDocumentV1Schema,
  compliance: ComplianceReportV1Schema,
  jsonLd: StructuredDocumentJsonLdV1Schema,
});
export type NormalizedDocumentResultV1 = z.infer<typeof NormalizedDocumentResultV1Schema>;

export const CONTROLLED_JSON_LD_CONTEXT_V1 = Object.freeze({
  "@version": 1.1,
  riskflow: "urn:riskflow:structured-document:v1#",
});
