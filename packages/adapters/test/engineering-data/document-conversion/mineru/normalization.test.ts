import { strToU8, zipSync } from "fflate";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { convertParsedDocument } from "@riskflow/core/engineering-data/document-conversion";
import { DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1 } from "../../../../src/engineering-data/document-conversion/schema.js";
import { parseDocx } from "../../../../src/engineering-data/document-conversion/parsers.js";
import { DocumentServiceParserError } from "../../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { normalizeMineruMiddle } from "../../../../src/engineering-data/document-conversion/mineru/normalization.js";
import { preflightMineruSource } from "../../../../src/engineering-data/document-conversion/mineru/source.js";
import { makeConfig, makeRequest, middle } from "./fixture.js";

const errorOf = (run: () => unknown): DocumentServiceParserError => {
  try {
    run();
  } catch (error) {
    if (error instanceof DocumentServiceParserError) return error;
    throw error;
  }
  throw new Error("expected normalization failure");
};

const makeMiddle = (blocks: unknown[], pageIndexes = [0]) => ({
  ...middle,
  pages: pageIndexes.map((page_idx) => ({ page_idx, blocks })),
});

const pngCrc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
};

const tinyPng = (extraChunk?: Uint8Array): Uint8Array => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 2);
  view.setUint32(4, 1);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    pngChunk("IHDR", header),
    ...(extraChunk === undefined ? [] : [extraChunk]),
    pngChunk("IDAT", deflateSync(new Uint8Array(9))),
    pngChunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(
    signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  result.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const makeDocx = (): Uint8Array =>
  zipSync({
    "[Content_Types].xml": strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml":
      strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>源标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>正文一</w:t><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>值合并</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单元格甲</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>单元格乙</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body></w:document>`),
  });

describe("MinerU Middle normalization", () => {
  it("scales normalized PDF coordinates by point extents and retains logical HTML cell spans/text", () => {
    const table = {
      type: "table",
      index: 1,
      bbox: [0.1, 0.2, 0.9, 0.8],
      content: [
        {
          type: "table_body",
          content:
            '<table><tr><td rowspan="2" colspan="2"><p>1.2</p></td><td>甲</td></tr><tr><td>乙</td></tr></table>',
        },
        { type: "table_caption", content: [{ type: "text", content: "表注" }] },
        { type: "table_footnote", content: [{ type: "text", content: "脚注" }] },
      ],
    };
    const result = normalizeMineruMiddle(
      makeMiddle([
        {
          type: "text",
          index: 0,
          bbox: [0.1, 0.2, 0.3, 0.4],
          content: [{ type: "text", content: "正文" }],
        },
        table,
      ]),
      makeRequest(),
      makeConfig("self-hosted-v1"),
      { pageCount: 1 },
    );

    expect(result.parsedDocument.pageExtents).toEqual([
      { pageNumber: 1, width: 300, height: 200, coordinateSystem: "point-top-left" },
    ]);
    const textCoordinate = result.parsedDocument.blocks.find(
      (block) => block.text === "正文",
    )?.coordinate;
    expect(textCoordinate).toMatchObject({ kind: "page", pageNumber: 1, x: 30, y: 40, height: 40 });
    expect(textCoordinate?.kind === "page" ? textCoordinate.width : 0).toBeCloseTo(60, 8);
    expect(result.parsedDocument.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "cell",
          text: "1.2",
          row: 1,
          column: 1,
          rowSpan: 2,
          columnSpan: 2,
        }),
        expect.objectContaining({ kind: "cell", text: "甲", row: 1, column: 3 }),
        expect.objectContaining({ kind: "cell", text: "乙", row: 2, column: 3 }),
        expect.objectContaining({ kind: "caption", text: "表注" }),
        expect.objectContaining({ kind: "caption", text: "脚注" }),
      ]),
    );
    expect(result.parsedDocument.blocks.every((block) => block.confidence === undefined)).toBe(
      true,
    );
    expect(result.diagnostic).toMatchObject({
      confidence: "unavailable",
      perCellGeometry: "unavailable",
    });
    const converted = convertParsedDocument(result.parsedDocument, {
      strategyVersion: "normalization-test-v1",
    });
    expect(converted.document.tableFields?.map((field) => field.value)).toContain("1.2");
  });

  it.each([
    [
      "page order",
      makeMiddle([{ type: "text", index: 0, bbox: [0, 0, 1, 1], content: "x" }], [1]),
      "page-order-invalid",
    ],
    [
      "invalid bounds",
      makeMiddle([{ type: "text", index: 0, bbox: [0, 0, 1.1, 1], content: "x" }]),
      "bbox-bounds",
    ],
    ["missing page", { ...middle, pages: [middle.pages[0]] }, "page-count-mismatch"],
  ])("rejects %s with a stable normalization diagnostic", (_case, input, issue) => {
    const pageCount = issue === "page-count-mismatch" ? 2 : 1;
    const error = errorOf(() =>
      normalizeMineruMiddle(input, makeRequest(), makeConfig("self-hosted-v1"), { pageCount }),
    );
    expect(error.code).toBe("MINERU_MIDDLE_INVALID");
    expect(error.stage).toBe("normalize");
    expect(error.diagnostic).toMatchObject({ failure: { issue } });
  });

  it("rejects overlapping spans and malformed HTML tables", () => {
    const request = makeRequest();
    const config = makeConfig("self-hosted-v1");
    const overlaps = {
      type: "table",
      index: 0,
      bbox: [0, 0, 1, 1],
      content: [
        {
          type: "table_body",
          content:
            '<table><tr><td rowspan="2">a</td><td>b</td><td rowspan="2">c</td></tr><tr><td colspan="2">d</td></tr></table>',
        },
      ],
    };
    const malformed = {
      ...overlaps,
      content: [{ type: "table_body", content: '<table><tr><td rowspan="0">x</td></tr></table>' }],
    };
    expect(
      errorOf(() =>
        normalizeMineruMiddle(makeMiddle([overlaps]), request, config, { pageCount: 1 }),
      ).diagnostic,
    ).toMatchObject({ failure: { issue: "table-cell-overlap" } });
    expect(
      errorOf(() =>
        normalizeMineruMiddle(makeMiddle([malformed]), request, config, { pageCount: 1 }),
      ).diagnostic,
    ).toMatchObject({ failure: { issue: "table-span-invalid" } });
  });

  it("rejects expanded merged-cell grids before allocating beyond the cell budget", () => {
    const boundedRequest = {
      ...makeRequest(),
      resourcePolicy: { ...DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1, maxCells: 4 },
    };
    const table = {
      type: "table",
      index: 0,
      bbox: [0, 0, 1, 1],
      content: [
        {
          type: "table_body",
          content: '<table><tr><td rowspan="2" colspan="3">x</td></tr><tr></tr></table>',
        },
      ],
    };
    const error = errorOf(() =>
      normalizeMineruMiddle(makeMiddle([table]), boundedRequest, makeConfig("self-hosted-v1"), {
        pageCount: 1,
      }),
    );
    expect(error.diagnostic).toMatchObject({ failure: { issue: "table-cell-limit" } });
  });

  it("enforces non-empty page and key-field quality thresholds without accepting an empty page", () => {
    const request = makeRequest();
    const emptyPageMiddle = {
      ...middle,
      pages: [
        {
          page_idx: 0,
          blocks: [{ type: "text", index: 0, bbox: [0, 0, 1, 1], content: "已识别" }],
        },
        { page_idx: 1, blocks: [{ type: "text", index: 0, bbox: [0, 0, 1, 1], content: [] }] },
      ],
      extensions: {
        ...middle.extensions,
        docvortex_layout: {
          pages: [0, 1].map((page_idx) => ({ page_idx, width_pt: 300, height_pt: 200 })),
        },
      },
    };
    const error = errorOf(() =>
      normalizeMineruMiddle(
        emptyPageMiddle,
        request,
        makeConfig("self-hosted-v1", {
          qualityPolicy: {
            minNonEmptyPageRatio: 1,
            minKeyFieldCoverage: 1,
            keyFields: ["风险等级"],
          },
        }),
        { pageCount: 2 },
      ),
    );
    expect(error.code).toBe("MINERU_QUALITY_REJECTED");
    expect(error.stage).toBe("quality");
    expect(error.diagnostic).toMatchObject({
      failure: {
        issue: "quality-threshold",
        nonEmptyPages: 1,
        totalPages: 2,
        missingKeyFields: ["风险等级"],
      },
    });
  });

  it("attaches DOCX title, explicit page break and merged source table structure while preserving service cell text", () => {
    const bytes = makeDocx();
    const request = makeRequest({
      bytes,
      command: {
        ...makeRequest().command,
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        input: { kind: "docx" },
      },
    });
    const sourceDocx = parseDocx(
      bytes,
      { source: request.source, inputKind: "docx", mediaType: request.command.mediaType },
      DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
    );
    const docxMiddle = {
      ...middle,
      pages: [
        {
          page_idx: 0,
          blocks: [
            { type: "paragraph_title", index: 0, content: [{ type: "text", content: "源标题" }] },
            { type: "text", index: 1, content: [{ type: "text", content: "正文一" }] },
            {
              type: "table",
              index: 2,
              content: [
                {
                  type: "table_body",
                  content:
                    '<table><tr><td rowspan="2" colspan="2">值合并</td><td>单元格甲</td></tr><tr><td>单元格乙</td></tr></table>',
                },
              ],
            },
          ],
        },
      ],
    };
    const config = makeConfig("official-v4", {
      qualityPolicy: { minNonEmptyPageRatio: 0, minKeyFieldCoverage: 0, keyFields: [] },
    });
    const result = normalizeMineruMiddle(docxMiddle, request, config, { docx: sourceDocx });

    expect(result.parsedDocument.pageExtents).toBeUndefined();
    expect(result.parsedDocument.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "heading", text: "源标题", headingPath: ["源标题"] }),
        expect.objectContaining({ kind: "page-break" }),
        expect.objectContaining({
          kind: "cell",
          text: "值合并",
          row: 1,
          column: 1,
          rowSpan: 2,
          columnSpan: 2,
          tableId: "table_1",
          sheet: "docx",
          chapterId: "table_1",
          segmentId: "table_1",
          coordinate: { kind: "cell", sheet: "docx", row: 1, column: 1, rowSpan: 2, columnSpan: 2 },
        }),
      ]),
    );
    expect(result.parsedDocument.blocks.some((block) => block.text === "正文一")).toBe(true);
    const breakIndexes = result.parsedDocument.blocks.flatMap((block, index) =>
      block.kind === "page-break" ? [index] : [],
    );
    const tableIndex = result.parsedDocument.blocks.findIndex((block) => block.kind === "table");
    expect(breakIndexes).toHaveLength(2);
    expect(Math.max(...breakIndexes)).toBeLessThan(tableIndex);
    const converted = convertParsedDocument(result.parsedDocument, {
      strategyVersion: "normalization-test-v1",
    });
    expect(converted.document.tableFields?.some((field) => field.value === "值合并")).toBe(true);

    const mismatched = {
      ...docxMiddle,
      pages: [
        {
          ...docxMiddle.pages[0]!,
          blocks: [
            docxMiddle.pages[0]!.blocks[0],
            { type: "text", index: 1, content: [{ type: "text", content: "错配正文" }] },
            docxMiddle.pages[0]!.blocks[2],
          ],
        },
      ],
    };
    const error = errorOf(() =>
      normalizeMineruMiddle(mismatched, request, config, { docx: sourceDocx }),
    );
    expect(error.code).toBe("MINERU_MIDDLE_INVALID");
    expect(error.diagnostic).toMatchObject({ failure: { issue: "docx-source-text-mismatch" } });
  });

  it("uses source image bytes for pixel extents and rejects malformed image data", async () => {
    const bytes = tinyPng();
    const imageRequest = makeRequest({
      bytes,
      command: { ...makeRequest().command, mediaType: "image/png", input: { kind: "ocr-layout" } },
    });
    const sourceInfo = await preflightMineruSource(imageRequest);
    expect(sourceInfo.pageExtents).toEqual([
      { pageNumber: 1, width: 2, height: 1, coordinateSystem: "pixel-top-left" },
    ]);
    const result = normalizeMineruMiddle(
      makeMiddle([
        {
          type: "text",
          index: 0,
          bbox: [0, 0, 0.5, 1],
          content: [{ type: "text", content: "像素" }],
        },
      ]),
      imageRequest,
      makeConfig("self-hosted-v1"),
      sourceInfo,
    );
    expect(result.parsedDocument.blocks[0]?.coordinate).toEqual({
      kind: "page",
      pageNumber: 1,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    const broken = await preflightMineruSource({
      ...imageRequest,
      bytes: new Uint8Array([137, 80, 78, 71]),
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(broken).toBeInstanceOf(DocumentServiceParserError);
    expect((broken as DocumentServiceParserError).code).toBe("MINERU_IMAGE_INVALID");

    const criticalChunk = await preflightMineruSource({
      ...imageRequest,
      bytes: tinyPng(pngChunk("ABCD", new Uint8Array([0x20]))),
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(criticalChunk).toBeInstanceOf(DocumentServiceParserError);
    expect((criticalChunk as DocumentServiceParserError).code).toBe("MINERU_IMAGE_INVALID");
  });
});
