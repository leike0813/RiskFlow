import { describe, expect, it } from "vitest";

import {
  CONTROLLED_JSON_LD_CONTEXT_V1,
  StructuredDocumentJsonLdV1Schema,
  convertParsedDocument,
  validateNormalizedDocument,
  type ParsedDocumentV1,
} from "../../src/engineering-data/document-conversion/index.js";

const sourceVersionRef = {
  kind: "source-version" as const,
  reference: { entityId: "source_1", versionId: "v1" },
};
const sourceArtifactRef = {
  kind: "content-artifact" as const,
  reference: { entityId: "source_1", versionId: `sha256:${"a".repeat(64)}` },
};

const parsed = (text: string): ParsedDocumentV1 => ({
  schemaVersion: "1",
  inputKind: "docx",
  sourceVersionRef,
  sourceArtifactRef,
  sourceId: "source_1",
  spatialScopeRefs: [
    { kind: "spatial-scope", reference: { entityId: "scope_1", versionId: "v1" } },
  ],
  metadata: {
    projectId: "project_1",
    sourceId: "source_1",
    sourceItemId: "item_1",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  blocks: [
    {
      blockId: "paragraph_1",
      kind: "paragraph",
      text,
      chapterId: "chapter_1",
      segmentId: "segment_1",
      headingPath: ["chapter_1"],
      locator: { kind: "document", pageNumber: 1, headingPath: ["chapter_1"] },
    },
  ],
  inputBytes: new TextEncoder().encode(text).byteLength,
});

describe("structured document conversion core", () => {
  it("chunks Unicode code points deterministically and closes adjacent pointers", () => {
    const text = `${"安全".repeat(255)}😀尾`; // 512 code points, including a surrogate pair.
    const first = convertParsedDocument(parsed(`${text}再${"长".repeat(20)}`), {
      strategyVersion: "strategy-v1",
    });
    const second = convertParsedDocument(parsed(`${text}再${"长".repeat(20)}`), {
      strategyVersion: "strategy-v1",
    });

    expect(first.document.textBlocks).toEqual(second.document.textBlocks);
    expect(first.document.textBlocks.map((block) => block.text).join("")).toBe(
      `${text}再${"长".repeat(20)}`,
    );
    expect(first.document.textBlocks.every((block) => Array.from(block.text).length <= 512)).toBe(
      true,
    );
    expect(first.document.textBlocks[0]?.previousBlockId).toBeUndefined();
    expect(first.document.textBlocks.at(-1)?.nextBlockId).toBeUndefined();
    for (let index = 1; index < first.document.textBlocks.length; index += 1) {
      expect(first.document.textBlocks[index]?.previousBlockId).toBe(
        first.document.textBlocks[index - 1]?.blockId,
      );
      expect(first.document.textBlocks[index - 1]?.nextBlockId).toBe(
        first.document.textBlocks[index]?.blockId,
      );
    }
  });

  it("emits complete local JSON-LD and rejects a remote context", () => {
    const result = convertParsedDocument(parsed("章节内容"), { strategyVersion: "strategy-v1" });
    expect(result.jsonLd["@context"]).toEqual(CONTROLLED_JSON_LD_CONTEXT_V1);
    expect(result.jsonLd.textBlocks.length).toBeGreaterThan(0);
    expect(result.jsonLd.evidenceFragments.length).toBeGreaterThan(0);
    expect(
      StructuredDocumentJsonLdV1Schema.safeParse({
        ...result.jsonLd,
        "@context": "https://example.invalid/context.jsonld",
      }).success,
    ).toBe(false);
  });

  it("preserves scalar table values and uses the table locator for cell segments", () => {
    const table = parsed("表格值");
    const result = convertParsedDocument(
      {
        ...table,
        blocks: [
          {
            blockId: "table_1",
            kind: "table",
            text: "",
            chapterId: "table_1",
            segmentId: "table_1",
            headingPath: ["table_1"],
            locator: {
              kind: "table",
              sheet: "sheet_1",
              table: "table_1",
              rowRange: { start: 1, end: 2 },
              columnRange: { start: 1, end: 3 },
            },
            tableId: "table_1",
            sheet: "sheet_1",
          },
          {
            blockId: "cell_1",
            kind: "cell",
            text: "42",
            value: 42,
            chapterId: "table_1",
            segmentId: "table_1",
            headingPath: ["table_1"],
            locator: {
              kind: "table",
              sheet: "sheet_1",
              table: "table_1",
              rowRange: { start: 1, end: 1 },
              columnRange: { start: 2, end: 2 },
            },
            coordinate: {
              kind: "cell",
              sheet: "sheet_1",
              row: 1,
              column: 2,
              rowSpan: 1,
              columnSpan: 1,
            },
            tableId: "table_1",
            sheet: "sheet_1",
            row: 1,
            column: 2,
            rowSpan: 1,
            columnSpan: 1,
          },
        ],
      },
      { strategyVersion: "strategy-v1" },
    );
    expect(result.document.tableFields?.[0]?.value).toBe(42);
    expect(result.document.sourceSegments[0]?.locator).toMatchObject({
      rowRange: { start: 1, end: 2 },
      columnRange: { start: 1, end: 3 },
    });
  });

  it("rejects dangling relations and cross-version pointers as one failed batch", () => {
    const result = convertParsedDocument(parsed("正文"), { strategyVersion: "strategy-v1" });
    const invalidRelation = {
      ...result.document,
      relations: result.document.relations.map((relation, index) =>
        index === 0 ? { ...relation, toEntityId: "missing_entity" } : relation,
      ),
    };
    expect(validateNormalizedDocument(invalidRelation)).toMatchObject({
      passed: false,
      issues: [{ code: "DANGLING_RELATION" }],
    });

    const long = convertParsedDocument(parsed("长".repeat(2000)), {
      strategyVersion: "strategy-v1",
    });
    const crossVersion = {
      ...long.document,
      textBlocks: long.document.textBlocks.map((block, index) =>
        index === 1
          ? {
              ...block,
              sourceVersionRef: {
                kind: "source-version" as const,
                reference: { entityId: "source_1", versionId: "v2" },
              },
            }
          : block,
      ),
    };
    expect(validateNormalizedDocument(crossVersion)).toMatchObject({
      passed: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "CROSS_VERSION_POINTER" })]),
    });
  });
});
