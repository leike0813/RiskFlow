import { sha256CanonicalJson } from "../../persistence/canonical-json.js";

import {
  makeSourceSegmentId,
  parseSourceSegmentId,
  SourceSegmentIdV1Schema,
} from "../context-source/schema.js";
import {
  CONTROLLED_JSON_LD_CONTEXT_V1,
  DOCUMENT_CONVERSION_SCHEMA_VERSION_V1,
  DocumentConversionStatisticsV1Schema,
  NormalizedDocumentResultV1Schema,
  NormalizedDocumentV1Schema,
  ParsedDocumentV1Schema,
  StructuredDocumentJsonLdV1Schema,
  type ComplianceCheckV1,
  type ComplianceIssueV1,
  type ComplianceReportV1,
  type DocumentConversionStatisticsV1,
  type NormalizedBlockV1,
  type NormalizedDocumentResultV1,
  type NormalizedDocumentV1,
  type ParsedDocumentV1,
  type ProcessStepV1,
  type SourceSegmentDraftV1,
  type StructureEntityV1,
  type StructureRelationV1,
  type StructuredDocumentJsonLdV1,
  type TableFieldV1,
  type TextBlockV1,
} from "./schema.js";

export interface DocumentConversionStrategyV1 {
  readonly strategyVersion: string;
  readonly maxTextBlockCodePoints?: number;
}

const maxCodePoints = 512;
const sentenceBoundary = /[。！？!?；;\n]/u;
const whitespace = /\s/u;

const issue = (
  code: string,
  stage: string,
  sourceSegmentId?: ComplianceIssueV1["sourceSegmentId"],
): ComplianceIssueV1 => ({
  code,
  stage,
  ...(sourceSegmentId === undefined ? {} : { sourceSegmentId }),
});

const checks = (...items: readonly [string, boolean][]): ComplianceCheckV1[] =>
  items.map(([code, passed]) => ({ code, passed }));

const stablePart = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]/gu, "_")
    .slice(0, 96);
  return normalized.length > 0
    ? normalized
    : `${fallback}_${sha256CanonicalJson(value).slice(0, 16)}`;
};

const segmentKindFor = (block: NormalizedBlockV1): SourceSegmentDraftV1["kind"] =>
  block.kind === "table" || block.kind === "cell" ? "table" : "chapter";

const segmentLocatorFor = (block: NormalizedBlockV1): SourceSegmentDraftV1["locator"] => {
  if (block.kind === "table" || block.kind === "cell") {
    if (block.locator.kind !== "table") throw new Error("table block requires a table locator");
    return block.locator;
  }
  return block.locator;
};

const splitText = (text: string, limit = maxCodePoints): string[] => {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const parts: string[] = [];
  let offset = 0;
  while (offset < chars.length) {
    const remaining = chars.length - offset;
    if (remaining <= limit) {
      parts.push(chars.slice(offset).join(""));
      break;
    }
    let end = offset + limit;
    for (let index = end; index > offset; index -= 1) {
      const character = chars[index - 1];
      if (
        character !== undefined &&
        (sentenceBoundary.test(character) || whitespace.test(character))
      ) {
        end = index;
        break;
      }
    }
    parts.push(chars.slice(offset, end).join(""));
    offset = end;
  }
  return parts;
};

export const chunkNormalizedBlocks = (
  parsed: Pick<ParsedDocumentV1, "sourceVersionRef" | "sourceId" | "blocks">,
  strategy: DocumentConversionStrategyV1,
): TextBlockV1[] => {
  const limit = strategy.maxTextBlockCodePoints ?? maxCodePoints;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxCodePoints) {
    throw new RangeError("text block limit must be between 1 and 512 code points");
  }
  const chunks: TextBlockV1[] = [];
  for (const [blockIndex, block] of parsed.blocks.entries()) {
    if (block.text.length === 0) continue;
    const chapterId = block.chapterId ?? stablePart(block.headingPath[0] ?? "document", "chapter");
    const segmentId = block.segmentId ?? `segment_${blockIndex + 1}`;
    const sourceSegmentId = makeSourceSegmentId(parsed.sourceId, chapterId, segmentId);
    const pieces = splitText(block.text, limit);
    for (const [pieceIndex, text] of pieces.entries()) {
      const blockId = `text-${sha256CanonicalJson({
        sourceVersionRef: parsed.sourceVersionRef,
        sourceBlockId: block.blockId,
        pieceIndex,
        strategyVersion: strategy.strategyVersion,
      }).slice(0, 32)}`;
      chunks.push({
        blockId,
        sourceBlockId: block.blockId,
        sourceVersionRef: parsed.sourceVersionRef,
        sourceSegmentId,
        sequence: chunks.length + 1,
        text,
        ...(block.coordinate === undefined ? {} : { coordinate: block.coordinate }),
        headingPath: block.headingPath,
      });
    }
  }
  return chunks.map((chunk, index) => ({
    ...chunk,
    ...(index === 0 ? {} : { previousBlockId: chunks[index - 1]!.blockId }),
    ...(index === chunks.length - 1 ? {} : { nextBlockId: chunks[index + 1]!.blockId }),
  }));
};

const entityTypeFor = (block: NormalizedBlockV1): StructureEntityV1["entityType"] => block.kind;

const entityIdFor = (blockId: string): string => `entity-${blockId}`;

const buildEntitiesAndRelations = (
  parsed: ParsedDocumentV1,
  textBlocks: readonly TextBlockV1[],
): { entities: StructureEntityV1[]; relations: StructureRelationV1[] } => {
  const entities: StructureEntityV1[] = [
    { entityId: `document-${parsed.sourceId}`, entityType: "document" },
  ];
  const relations: StructureRelationV1[] = [];
  const seen = new Set<string>(entities.map((entity) => entity.entityId));
  const blockById = new Map(parsed.blocks.map((block) => [block.blockId, block]));
  const tableEntities = new Map<string, string>();
  for (const block of parsed.blocks) {
    const entityId = entityIdFor(block.blockId);
    if (seen.has(entityId)) throw new Error("duplicate structure entity");
    seen.add(entityId);
    entities.push({
      entityId,
      entityType: entityTypeFor(block),
      sourceBlockId: block.blockId,
      parentEntityId: `document-${parsed.sourceId}`,
    });
    relations.push({
      relationId: `relation-${sha256CanonicalJson(["contains", parsed.sourceVersionRef, entityId]).slice(0, 24)}`,
      relationType: "contains",
      fromEntityId: `document-${parsed.sourceId}`,
      toEntityId: entityId,
      sourceVersionRef: parsed.sourceVersionRef,
    });
    if (block.tableId !== undefined) {
      const tableId = tableEntities.get(block.tableId) ?? entityId;
      tableEntities.set(block.tableId, tableId);
      if (block.kind === "cell" && tableId !== entityId) {
        relations.push({
          relationId: `relation-${sha256CanonicalJson(["has-cell", tableId, entityId]).slice(0, 24)}`,
          relationType: "has-cell",
          fromEntityId: tableId,
          toEntityId: entityId,
          sourceVersionRef: parsed.sourceVersionRef,
        });
      }
    }
  }
  for (let index = 1; index < textBlocks.length; index += 1) {
    const previous = textBlocks[index - 1]!;
    const current = textBlocks[index]!;
    const previousEntity = entityIdFor(previous.sourceBlockId);
    const currentEntity = entityIdFor(current.sourceBlockId);
    if (
      previous.sourceBlockId !== current.sourceBlockId &&
      blockById.has(previous.sourceBlockId) &&
      blockById.has(current.sourceBlockId)
    ) {
      relations.push({
        relationId: `relation-${sha256CanonicalJson(["follows", previousEntity, currentEntity]).slice(0, 24)}`,
        relationType: "follows",
        fromEntityId: previousEntity,
        toEntityId: currentEntity,
        sourceVersionRef: parsed.sourceVersionRef,
      });
    }
  }
  return { entities, relations };
};

const buildSegments = (
  parsed: ParsedDocumentV1,
  textBlocks: readonly TextBlockV1[],
): SourceSegmentDraftV1[] => {
  const blocksById = new Map(parsed.blocks.map((block) => [block.blockId, block]));
  const groups = new Map<string, { block: NormalizedBlockV1; textBlockIds: string[] }>();
  for (const textBlock of textBlocks) {
    const block = blocksById.get(textBlock.sourceBlockId);
    if (block === undefined) throw new Error("text block has no source block");
    const current = groups.get(textBlock.sourceSegmentId);
    if (current === undefined)
      groups.set(textBlock.sourceSegmentId, { block, textBlockIds: [textBlock.blockId] });
    else current.textBlockIds.push(textBlock.blockId);
  }
  return [...groups.entries()].map(([sourceSegmentId, group]) => {
    const chapterId =
      group.block.chapterId ?? stablePart(group.block.headingPath[0] ?? "document", "chapter");
    const segmentId = group.block.segmentId ?? stablePart(group.block.blockId, "segment");
    const parsedId = parseSourceSegmentId(sourceSegmentId);
    if (
      parsedId === undefined ||
      parsedId.chapterId !== chapterId ||
      parsedId.segmentId !== segmentId
    ) {
      throw new Error("source segment id does not match block components");
    }
    return {
      sourceSegmentId: SourceSegmentIdV1Schema.parse(sourceSegmentId),
      sourceId: parsed.sourceId,
      chapterId,
      segmentId,
      kind: segmentKindFor(group.block),
      spatialScopeRefs: parsed.spatialScopeRefs,
      locator: segmentLocatorFor(group.block),
      textBlockIds: group.textBlockIds,
    };
  });
};

const scalarFromBlock = (block: NormalizedBlockV1): TableFieldV1["value"] => block.text;

const buildTableFields = (parsed: ParsedDocumentV1): TableFieldV1[] =>
  parsed.blocks
    .filter((block) => block.kind === "cell")
    .map((block) => {
      if (
        block.tableId === undefined ||
        block.sheet === undefined ||
        block.row === undefined ||
        block.column === undefined
      ) {
        throw new Error("cell block is missing table coordinate");
      }
      const value: TableFieldV1["value"] = scalarFromBlock(block);
      return {
        fieldId: `field-${block.blockId}`,
        tableId: block.tableId,
        sheet: block.sheet,
        row: block.row,
        column: block.column,
        value,
        ...(block.formula === undefined ? {} : { formula: block.formula }),
        ...(block.cachedValue === undefined ? {} : { cachedValue: block.cachedValue }),
        ...(block.rowSpan === undefined || block.columnSpan === undefined
          ? {}
          : {
              mergedRange: {
                startRow: block.row,
                endRow: block.row + block.rowSpan - 1,
                startColumn: block.column,
                endColumn: block.column + block.columnSpan - 1,
              },
            }),
      };
    });

const buildProcessSteps = (
  parsed: ParsedDocumentV1,
  textBlocks: readonly TextBlockV1[],
): ProcessStepV1[] => {
  const bySource = new Map<string, string[]>();
  for (const block of textBlocks) {
    const current = bySource.get(block.sourceBlockId);
    if (current === undefined) bySource.set(block.sourceBlockId, [block.blockId]);
    else current.push(block.blockId);
  }
  return parsed.blocks
    .filter((block) => block.kind === "process-step")
    .map((block, index) => ({
      stepId: `step-${block.blockId}`,
      sourceBlockId: block.blockId,
      textBlockIds: bySource.get(block.blockId) ?? [],
      sequence: index + 1,
    }))
    .filter((step) => step.textBlockIds.length > 0);
};

const countPages = (parsed: ParsedDocumentV1): number => {
  const pages = new Set<number>();
  for (const block of parsed.blocks) {
    if (block.coordinate?.kind === "page") pages.add(block.coordinate.pageNumber);
    if (block.locator.kind === "document") pages.add(block.locator.pageNumber);
  }
  return pages.size;
};

const buildStatistics = (
  parsed: ParsedDocumentV1,
  textBlocks: readonly TextBlockV1[],
  sourceSegments: readonly SourceSegmentDraftV1[],
  tableFields: readonly TableFieldV1[],
): DocumentConversionStatisticsV1 =>
  DocumentConversionStatisticsV1Schema.parse({
    inputBytes: parsed.inputBytes,
    outputBytes: 0,
    textBlockCount: textBlocks.length,
    sourceSegmentCount: sourceSegments.length,
    pageCount: countPages(parsed),
    tableCount: new Set(parsed.blocks.map((block) => block.tableId).filter(Boolean)).size,
    cellCount: tableFields.length,
    durationMs: 0,
  });

export const normalizeStructuredDocument = (
  input: ParsedDocumentV1,
  strategy: DocumentConversionStrategyV1,
): NormalizedDocumentV1 => {
  const parsed = ParsedDocumentV1Schema.parse(input);
  const textBlocks = chunkNormalizedBlocks(parsed, strategy);
  if (textBlocks.length === 0) throw new Error("document contains no text blocks");
  const sourceSegments = buildSegments(parsed, textBlocks);
  const { entities, relations } = buildEntitiesAndRelations(parsed, textBlocks);
  const tableFields = buildTableFields(parsed);
  const processSteps = buildProcessSteps(parsed, textBlocks);
  return NormalizedDocumentV1Schema.parse({
    schemaVersion: DOCUMENT_CONVERSION_SCHEMA_VERSION_V1,
    inputKind: parsed.inputKind,
    sourceVersionRef: parsed.sourceVersionRef,
    sourceArtifactRef: parsed.sourceArtifactRef,
    sourceId: parsed.sourceId,
    metadata: parsed.metadata,
    textBlocks,
    entities,
    relations,
    evidenceFragments: sourceSegments.map((segment) => ({
      evidenceId: `evidence-${segment.sourceSegmentId}`,
      sourceVersionRef: parsed.sourceVersionRef,
      sourceSegmentId: segment.sourceSegmentId,
      textBlockIds: segment.textBlockIds,
    })),
    sourceSegments,
    ...(tableFields.length === 0 ? {} : { tableFields }),
    ...(processSteps.length === 0 ? {} : { processSteps }),
    statistics: buildStatistics(parsed, textBlocks, sourceSegments, tableFields),
  });
};

export const validateNormalizedDocument = (document: unknown): ComplianceReportV1 => {
  const parsed = NormalizedDocumentV1Schema.safeParse(document);
  if (!parsed.success) {
    return {
      schemaVersion: DOCUMENT_CONVERSION_SCHEMA_VERSION_V1,
      passed: false,
      fieldChecks: checks(["schema", false]),
      entityChecks: [],
      relationChecks: [],
      segmentChecks: [],
      issues: [issue("SCHEMA_INVALID", "schema")],
    };
  }
  const value = parsed.data;
  const issues: ComplianceIssueV1[] = [];
  const entityIds = new Set<string>();
  for (const entity of value.entities) {
    if (entityIds.has(entity.entityId)) issues.push(issue("DUPLICATE_ENTITY", "entities"));
    entityIds.add(entity.entityId);
  }
  for (const entity of value.entities) {
    if (entity.parentEntityId !== undefined && !entityIds.has(entity.parentEntityId)) {
      issues.push(issue("DANGLING_ENTITY_PARENT", "entities"));
    }
  }
  const blockIds = new Set(value.textBlocks.map((block) => block.blockId));
  const segmentIds = new Set(value.sourceSegments.map((segment) => segment.sourceSegmentId));
  const evidenceIds = new Set<string>();
  const relationIds = new Set<string>();
  for (const relation of value.relations) {
    if (relationIds.has(relation.relationId)) issues.push(issue("DUPLICATE_RELATION", "relations"));
    relationIds.add(relation.relationId);
    if (!entityIds.has(relation.fromEntityId) || !entityIds.has(relation.toEntityId)) {
      issues.push(issue("DANGLING_RELATION", "relations"));
    }
    if (
      relation.sourceVersionRef.reference.entityId !== value.sourceVersionRef.reference.entityId ||
      relation.sourceVersionRef.reference.versionId !== value.sourceVersionRef.reference.versionId
    ) {
      issues.push(issue("CROSS_VERSION_RELATION", "relations"));
    }
  }
  const textBlockIds = new Set<string>();
  for (const textBlock of value.textBlocks) {
    if (textBlockIds.has(textBlock.blockId)) issues.push(issue("DUPLICATE_TEXT_BLOCK", "fields"));
    textBlockIds.add(textBlock.blockId);
    if (
      textBlock.sourceVersionRef.reference.entityId !== value.sourceVersionRef.reference.entityId ||
      textBlock.sourceVersionRef.reference.versionId !== value.sourceVersionRef.reference.versionId
    ) {
      issues.push(issue("CROSS_VERSION_TEXT_BLOCK", "fields", textBlock.sourceSegmentId));
    }
    if (Array.from(textBlock.text).length > maxCodePoints) {
      issues.push(issue("TEXT_BLOCK_TOO_LONG", "fields", textBlock.sourceSegmentId));
    }
    if (!segmentIds.has(textBlock.sourceSegmentId)) {
      issues.push(issue("UNKNOWN_TEXT_SEGMENT", "segments", textBlock.sourceSegmentId));
    }
  }
  for (const evidence of value.evidenceFragments) {
    if (evidenceIds.has(evidence.evidenceId))
      issues.push(issue("DUPLICATE_EVIDENCE", "segments", evidence.sourceSegmentId));
    evidenceIds.add(evidence.evidenceId);
    if (!segmentIds.has(evidence.sourceSegmentId))
      issues.push(issue("UNKNOWN_EVIDENCE_SEGMENT", "segments"));
    if (evidence.textBlockIds.some((id) => !blockIds.has(id)))
      issues.push(issue("DANGLING_EVIDENCE_BLOCK", "segments"));
    if (
      evidence.sourceVersionRef.reference.entityId !== value.sourceVersionRef.reference.entityId ||
      evidence.sourceVersionRef.reference.versionId !== value.sourceVersionRef.reference.versionId
    ) {
      issues.push(issue("CROSS_VERSION_EVIDENCE", "segments", evidence.sourceSegmentId));
    }
  }
  const segmentIdsSeen = new Set<string>();
  for (const segment of value.sourceSegments) {
    if (segmentIdsSeen.has(segment.sourceSegmentId))
      issues.push(issue("DUPLICATE_SEGMENT", "segments", segment.sourceSegmentId));
    segmentIdsSeen.add(segment.sourceSegmentId);
    const parsedId = parseSourceSegmentId(segment.sourceSegmentId);
    if (
      parsedId === undefined ||
      parsedId.sourceId !== value.sourceId ||
      parsedId.chapterId !== segment.chapterId ||
      parsedId.segmentId !== segment.segmentId
    ) {
      issues.push(issue("INVALID_SEGMENT_ID", "segments", segment.sourceSegmentId));
    }
    if (segment.textBlockIds.some((id) => !blockIds.has(id))) {
      issues.push(issue("DANGLING_SEGMENT_BLOCK", "segments", segment.sourceSegmentId));
    }
  }
  for (let index = 0; index < value.textBlocks.length; index += 1) {
    const current = value.textBlocks[index]!;
    const previous = value.textBlocks[index - 1];
    const next = value.textBlocks[index + 1];
    if (current.previousBlockId !== previous?.blockId)
      issues.push(issue("BROKEN_PREVIOUS_POINTER", "fields"));
    if (current.nextBlockId !== next?.blockId) issues.push(issue("BROKEN_NEXT_POINTER", "fields"));
    if (
      (previous !== undefined &&
        (current.sourceVersionRef.reference.entityId !==
          previous.sourceVersionRef.reference.entityId ||
          current.sourceVersionRef.reference.versionId !==
            previous.sourceVersionRef.reference.versionId)) ||
      (next !== undefined &&
        (current.sourceVersionRef.reference.entityId !== next.sourceVersionRef.reference.entityId ||
          current.sourceVersionRef.reference.versionId !==
            next.sourceVersionRef.reference.versionId))
    ) {
      issues.push(issue("CROSS_VERSION_POINTER", "fields", current.sourceSegmentId));
    }
  }
  const passed = issues.length === 0;
  return {
    schemaVersion: DOCUMENT_CONVERSION_SCHEMA_VERSION_V1,
    passed,
    fieldChecks: checks(
      ["metadata", true],
      ["text-block-limit", !issues.some((item) => item.code === "TEXT_BLOCK_TOO_LONG")],
      ["text-block-pointers", !issues.some((item) => item.code.includes("POINTER"))],
    ),
    entityChecks: checks([
      "entity-references",
      !issues.some((item) => item.code.includes("ENTITY")),
    ]),
    relationChecks: checks(
      ["relation-references", !issues.some((item) => item.code.includes("RELATION"))],
      ["relation-identities", relationIds.size === value.relations.length],
    ),
    segmentChecks: checks(
      [
        "segment-identities",
        !issues.some(
          (item) => item.code === "INVALID_SEGMENT_ID" || item.code === "DUPLICATE_SEGMENT",
        ),
      ],
      ["segment-references", !issues.some((item) => item.code.includes("SEGMENT"))],
      [
        "evidence-references",
        !issues.some(
          (item) => item.code.includes("EVIDENCE") || item.code === "DUPLICATE_EVIDENCE",
        ),
      ],
    ),
    issues,
  };
};

export class DocumentConversionValidationError extends Error {
  readonly report: ComplianceReportV1;

  constructor(report: ComplianceReportV1) {
    super("structured document conversion failed compliance");
    this.name = "DocumentConversionValidationError";
    this.report = report;
  }
}

export const buildStructuredDocumentJsonLd = (document: unknown): StructuredDocumentJsonLdV1 => {
  const parsed = NormalizedDocumentV1Schema.parse(document);
  const report = validateNormalizedDocument(parsed);
  if (!report.passed) throw new DocumentConversionValidationError(report);
  return StructuredDocumentJsonLdV1Schema.parse({
    "@context": CONTROLLED_JSON_LD_CONTEXT_V1,
    "@id": `source-version-${parsed.sourceVersionRef.reference.entityId}-${parsed.sourceVersionRef.reference.versionId}`,
    "@type": "riskflow:StructuredDocument",
    schemaVersion: DOCUMENT_CONVERSION_SCHEMA_VERSION_V1,
    metadata: parsed.metadata,
    textBlocks: parsed.textBlocks,
    evidenceFragments: parsed.evidenceFragments,
    entities: parsed.entities,
    relations: parsed.relations,
    ...(parsed.tableFields === undefined ? {} : { tableFields: parsed.tableFields }),
    ...(parsed.processSteps === undefined ? {} : { processSteps: parsed.processSteps }),
  });
};

export const convertParsedDocument = (
  input: ParsedDocumentV1,
  strategy: DocumentConversionStrategyV1,
): NormalizedDocumentResultV1 => {
  const document = normalizeStructuredDocument(input, strategy);
  const compliance = validateNormalizedDocument(document);
  if (!compliance.passed) throw new DocumentConversionValidationError(compliance);
  const jsonLd = buildStructuredDocumentJsonLd(document);
  const outputBytes = new TextEncoder().encode(JSON.stringify(jsonLd)).byteLength;
  return NormalizedDocumentResultV1Schema.parse({
    document: {
      ...document,
      statistics: { ...document.statistics, outputBytes },
    },
    compliance,
    jsonLd,
  });
};

export const normalizeAndValidateStructuredDocument = convertParsedDocument;
