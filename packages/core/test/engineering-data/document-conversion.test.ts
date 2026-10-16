import { describe, expect, it } from "vitest";

import {
  CONTROLLED_JSON_LD_CONTEXT_V1,
  StructuredDocumentJsonLdV1Schema,
  UnrecognizedTableImageRefV1Schema,
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

const tableImage = (packageEntryPath: string, entityId = "mineru_raw_1") => ({
  kind: "unrecognized-image" as const,
  rawResponseArtifactRef: {
    kind: "diagnostic-artifact" as const,
    reference: { entityId, versionId: `sha256:${"b".repeat(64)}` },
  },
  packageEntryPath,
});

type CellInput = {
  blockId: string;
  row: number;
  column: number;
  text: string;
  value?: number | null;
  unrecognizedImages?: ReturnType<typeof tableImage>[];
};

const tableParsed = (cells: readonly CellInput[]): ParsedDocumentV1 => {
  const tableLocator = (row: number, column: number) => ({
    kind: "table" as const,
    sheet: "sheet_1",
    table: "table_1",
    rowRange: { start: row, end: row },
    columnRange: { start: column, end: column },
  });
  return {
    ...parsed("表格"),
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
      ...cells.map((cell) => ({
        blockId: cell.blockId,
        kind: "cell" as const,
        text: cell.text,
        ...(cell.value === undefined ? {} : { value: cell.value }),
        chapterId: "table_1",
        segmentId: "table_1",
        headingPath: ["table_1"],
        locator: tableLocator(cell.row, cell.column),
        tableId: "table_1",
        sheet: "sheet_1",
        row: cell.row,
        column: cell.column,
        rowSpan: 1,
        columnSpan: 1,
        ...(cell.unrecognizedImages === undefined
          ? {}
          : { unrecognizedImages: cell.unrecognizedImages }),
      })),
    ],
  };
};

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

  it("carries OCR page extents and block confidence into normalized and JSON-LD output", () => {
    const scanned = {
      ...parsed("第一页正文"),
      inputKind: "ocr-layout" as const,
      pageExtents: [
        { pageNumber: 1, width: 1240, height: 1754, coordinateSystem: "pixel-top-left" as const },
        { pageNumber: 2, width: 1240, height: 1754, coordinateSystem: "pixel-top-left" as const },
      ],
      blocks: [
        {
          blockId: "ocr_1",
          kind: "paragraph" as const,
          text: "第一页正文",
          chapterId: "page_1",
          segmentId: "region_1",
          headingPath: ["page_1"],
          locator: { kind: "document" as const, pageNumber: 1, headingPath: ["page_1"] },
          coordinate: {
            kind: "page" as const,
            pageNumber: 1,
            x: 10,
            y: 20,
            width: 200,
            height: 40,
          },
          confidence: 0.87,
        },
      ],
    };
    const result = convertParsedDocument(scanned, { strategyVersion: "strategy-v1" });
    expect(result.document.pageExtents).toEqual(scanned.pageExtents);
    expect(result.jsonLd.pageExtents).toEqual(scanned.pageExtents);
    expect(result.document.textBlocks.every((block) => block.confidence === 0.87)).toBe(true);
    expect(result.jsonLd.textBlocks.every((block) => block.confidence === 0.87)).toBe(true);
  });

  it("rejects unordered or duplicate page extents and out-of-range confidence", () => {
    const extent = { width: 1240, height: 1754, coordinateSystem: "pixel-top-left" as const };
    expect(() =>
      convertParsedDocument(
        {
          ...parsed("正文"),
          pageExtents: [
            { pageNumber: 2, ...extent },
            { pageNumber: 1, ...extent },
          ],
        },
        { strategyVersion: "strategy-v1" },
      ),
    ).toThrow();
    expect(() =>
      convertParsedDocument(
        {
          ...parsed("正文"),
          pageExtents: [
            { pageNumber: 1, ...extent },
            { pageNumber: 1, ...extent },
          ],
        },
        { strategyVersion: "strategy-v1" },
      ),
    ).toThrow();
    const withConfidence = parsed("正文");
    expect(() =>
      convertParsedDocument(
        {
          ...withConfidence,
          blocks: [{ ...withConfidence.blocks[0]!, confidence: 1.5 }],
        },
        { strategyVersion: "strategy-v1" },
      ),
    ).toThrow();
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

  it("carries unrecognized table images without polluting cell text or inventing values", () => {
    const imageA = tableImage("images/symbol-a.jpg");
    const imageB = tableImage("images/symbol-b.jpg");
    const result = convertParsedDocument(
      tableParsed([
        { blockId: "cell_mixed", row: 1, column: 1, text: "围岩", unrecognizedImages: [imageA] },
        {
          blockId: "cell_image",
          row: 1,
          column: 2,
          text: "",
          value: null,
          unrecognizedImages: [imageB],
        },
        { blockId: "cell_empty", row: 1, column: 3, text: "" },
      ]),
      { strategyVersion: "strategy-v1" },
    );

    const fields = result.document.tableFields ?? [];
    const mixed = fields.find((field) => field.fieldId === "field-cell_mixed");
    const imageOnly = fields.find((field) => field.fieldId === "field-cell_image");
    const empty = fields.find((field) => field.fieldId === "field-cell_empty");

    expect(mixed?.value).toBe("围岩");
    expect(mixed?.unrecognizedImages).toEqual([imageA]);
    expect(imageOnly?.value).toBeNull();
    expect(imageOnly?.unrecognizedImages).toEqual([imageB]);
    expect(empty?.value).toBe("");
    expect(empty?.unrecognizedImages).toBeUndefined();
    expect(imageOnly?.mergedRange).toEqual({
      startRow: 1,
      endRow: 1,
      startColumn: 2,
      endColumn: 2,
    });

    // Table identity, coordinates and order survive untouched.
    expect(fields.map((field) => [field.tableId, field.row, field.column])).toEqual([
      ["table_1", 1, 1],
      ["table_1", 1, 2],
      ["table_1", 1, 3],
    ]);

    // The image is a structured reference, never inlined into searchable text.
    expect(result.document.textBlocks.map((block) => block.text).join("")).not.toContain("symbol");
  });

  it("round-trips unrecognized image refs through the controlled JSON-LD", () => {
    const image = tableImage("images/symbol-a.jpg");
    const result = convertParsedDocument(
      tableParsed([
        { blockId: "cell_text", row: 1, column: 1, text: "42", value: 42 },
        {
          blockId: "cell_image",
          row: 1,
          column: 2,
          text: "",
          value: null,
          unrecognizedImages: [image],
        },
      ]),
      { strategyVersion: "strategy-v1" },
    );
    expect(result.compliance.passed).toBe(true);
    expect(result.jsonLd.tableFields?.[1]?.unrecognizedImages).toEqual([image]);
    expect(StructuredDocumentJsonLdV1Schema.safeParse(result.jsonLd).success).toBe(true);
    expect(
      UnrecognizedTableImageRefV1Schema.safeParse(
        result.jsonLd.tableFields?.[1]?.unrecognizedImages?.[0],
      ).success,
    ).toBe(true);
  });

  it("rejects unsafe or ambiguous package entry paths", () => {
    for (const path of [
      "/etc/passwd",
      "C:/images/symbol.jpg",
      "images/../../secret.jpg",
      "images/./symbol.jpg",
      "images//symbol.jpg",
      "https://example.invalid/symbol.jpg",
      "data:image/png;base64,AAAA",
      "images\\symbol.jpg",
      "",
    ]) {
      expect(UnrecognizedTableImageRefV1Schema.safeParse(tableImage(path)).success).toBe(false);
    }
    const accepted = UnrecognizedTableImageRefV1Schema.safeParse({
      ...tableImage("images/symbol-a.jpg"),
      rawResponseArtifactRef: {
        kind: "content-artifact",
        reference: { entityId: "x", versionId: `sha256:${"b".repeat(64)}` },
      },
    });
    expect(accepted.success).toBe(true);
  });

  it("only cell blocks carry unrecognized images and the array stays non-empty", () => {
    const image = tableImage("images/symbol-a.jpg");
    const withImages = tableParsed([
      { blockId: "cell_text", row: 1, column: 1, text: "42", value: 42 },
      {
        blockId: "cell_image",
        row: 1,
        column: 2,
        text: "",
        value: null,
        unrecognizedImages: [image],
      },
    ]);
    expect(
      convertParsedDocument(withImages, { strategyVersion: "strategy-v1" }).compliance.passed,
    ).toBe(true);

    expect(() =>
      convertParsedDocument(
        {
          ...withImages,
          blocks: withImages.blocks.map((block) =>
            block.blockId === "table_1" ? { ...block, unrecognizedImages: [image] } : block,
          ),
        },
        { strategyVersion: "strategy-v1" },
      ),
    ).toThrow();

    expect(() =>
      convertParsedDocument(
        {
          ...withImages,
          blocks: withImages.blocks.map((block) =>
            block.blockId === "cell_image" ? { ...block, unrecognizedImages: [] } : block,
          ),
        },
        { strategyVersion: "strategy-v1" },
      ),
    ).toThrow();

    const blank = convertParsedDocument(parsed("正文"), { strategyVersion: "strategy-v1" });
    expect(
      validateNormalizedDocument({
        ...blank.document,
        textBlocks: blank.document.textBlocks.map((block, index) =>
          index === 0 ? { ...block, unrecognizedImages: [image] } : block,
        ),
      }).passed,
    ).toBe(false);
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
