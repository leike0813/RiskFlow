import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  ParsedDocumentV1Schema,
  type DocumentPageExtentV1,
  type NormalizedBlockV1,
  type ParsedDocumentV1,
} from "@riskflow/core/engineering-data/document-conversion";
import type { JsonValue } from "@riskflow/core/persistence";

import type { DocumentConversionResourcePolicyV1 } from "../schema.js";
import {
  DocumentServiceParserError,
  type DocumentServiceParserRequestV1,
} from "../structured-document-converter.js";
import type { MineruConfigV1 } from "./schema.js";
import type { MineruSourceInfoV1 } from "./source.js";

type UnknownRecord = Record<string, unknown>;
type TypedRecord = UnknownRecord & { readonly type: string };
type HtmlCell = { readonly text: string; readonly rowSpan: number; readonly columnSpan: number };
type HtmlTable = readonly (readonly HtmlCell[])[];

const sourceComponent = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/gu, "_").slice(0, 96) || "document";

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const failure = (
  code: "MINERU_MIDDLE_INVALID" | "MINERU_QUALITY_REJECTED",
  stage: "normalize" | "quality",
  detail: Record<string, JsonValue>,
): DocumentServiceParserError =>
  new DocumentServiceParserError({
    code,
    stage,
    retryable: false,
    diagnostic: { failure: detail },
  });

const invalid = (detail: Record<string, JsonValue>): DocumentServiceParserError =>
  failure("MINERU_MIDDLE_INVALID", "normalize", detail);

const qualityFailure = (detail: Record<string, JsonValue>): DocumentServiceParserError =>
  failure("MINERU_QUALITY_REJECTED", "quality", detail);

const getText = (value: unknown, location: string, depth = 0): string => {
  if (depth > 32) throw invalid({ issue: "span-depth-limit", location });
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw invalid({ issue: "content-shape", location });
  if (value.length > 50_000) throw invalid({ issue: "span-count-limit", location });
  let text = "";
  for (let index = 0; index < value.length; index += 1) {
    const span = record(value[index]);
    if (span === undefined || typeof span.type !== "string")
      throw invalid({ issue: "span-shape", location, spanIndex: index });
    if (["text", "equation_inline", "code_inline"].includes(span.type)) {
      if (typeof span.content !== "string")
        throw invalid({ issue: "span-content", location, spanIndex: index });
      text += span.content;
    } else if (span.type === "hyperlink") {
      text += getText(span.content, `${location}.content[${index}]`, depth + 1);
    } else if (typeof span.content === "string" || Array.isArray(span.content)) {
      throw invalid({ issue: "span-type-unsupported", location, spanIndex: index });
    }
  }
  if (text.length > 200_000) throw invalid({ issue: "text-length-limit", location });
  return text;
};

const contentOf = (block: UnknownRecord, location: string): string => {
  if (!Object.hasOwn(block, "content")) throw invalid({ issue: "content-missing", location });
  return getText(block.content, location);
};

const validBbox = (value: unknown, location: string): [number, number, number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((part) => typeof part !== "number" || !Number.isFinite(part))
  ) {
    throw invalid({ issue: "bbox-shape", location });
  }
  const [x0, y0, x1, y1] = value as number[];
  if (x0! < 0 || y0! < 0 || x1! > 1 || y1! > 1 || x1! <= x0! || y1! <= y0!) {
    throw invalid({ issue: "bbox-bounds", location });
  }
  return [x0!, y0!, x1!, y1!];
};

const pageCoordinate = (
  bbox: unknown,
  extent: DocumentPageExtentV1 | undefined,
  pageNumber: number,
  location: string,
): NormalizedBlockV1["coordinate"] => {
  if (extent === undefined) throw invalid({ issue: "page-extent-missing", pageNumber, location });
  const [x0, y0, x1, y1] = validBbox(bbox, location);
  return {
    kind: "page",
    pageNumber,
    x: x0 * extent.width,
    y: y0 * extent.height,
    width: (x1 - x0) * extent.width,
    height: (y1 - y0) * extent.height,
  };
};

const TABLE_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th"]);
const INLINE_TAGS = new Set(["p", "br", "span", "b", "strong", "i", "em", "u", "s", "sub", "sup"]);

const parseHtmlTable = (
  html: string,
  maxBytes: number,
  maxCells: number,
  location: string,
): HtmlTable => {
  if (
    Buffer.byteLength(html, "utf8") > maxBytes ||
    /<!\s*(?:doctype|entity)|<\s*(?:script|style|iframe|object|img)\b/iu.test(html)
  ) {
    throw invalid({ issue: "table-html-rejected", location });
  }
  if (XMLValidator.validate(`<root>${html}</root>`) !== true)
    throw invalid({ issue: "table-html-malformed", location });
  let tree: unknown;
  try {
    tree = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      parseTagValue: false,
      processEntities: false,
      htmlEntities: false,
      allowBooleanAttributes: false,
    }).parse(`<root>${html}</root>`);
  } catch {
    throw invalid({ issue: "table-html-malformed", location });
  }
  let nodeCount = 0;
  let cellCount = 0;
  const rows: HtmlCell[][] = [];
  const readText = (items: unknown[], allowText: boolean): string => {
    let text = "";
    for (const itemValue of items) {
      if (++nodeCount > maxCells * 8 + 64)
        throw invalid({ issue: "table-html-node-limit", location });
      const item = record(itemValue);
      if (item === undefined) continue;
      for (const [tag, childValue] of Object.entries(item)) {
        if (tag === ":@") continue;
        if (tag === "#text") {
          if (typeof childValue !== "string") throw invalid({ issue: "table-html-text", location });
          if (!allowText && childValue.trim().length > 0)
            throw invalid({ issue: "table-html-outside-cell", location });
          text += childValue;
          continue;
        }
        const children = Array.isArray(childValue) ? childValue : [];
        if (tag === "table") {
          for (const rowItemValue of children) {
            const rowItem = record(rowItemValue);
            if (rowItem === undefined) continue;
            const rowTag = Object.keys(rowItem).find((key) => key !== ":@");
            if (rowTag === undefined) continue;
            if (["tbody", "thead", "tfoot"].includes(rowTag)) {
              const section = rowItem[rowTag];
              if (!Array.isArray(section)) throw invalid({ issue: "table-html-section", location });
              for (const nested of section) readRow(nested);
            } else readRow(rowItemValue);
          }
        } else if (INLINE_TAGS.has(tag)) {
          const attrs = record(item[":@"]) ?? {};
          if (Object.keys(attrs).length > 0)
            throw invalid({ issue: "table-html-inline-attributes", location });
          text += readText(children, allowText);
        } else if (TABLE_TAGS.has(tag) && tag !== "td" && tag !== "th" && tag !== "tr") {
          text += readText(children, allowText);
        } else if (tag !== "td" && tag !== "th" && tag !== "tr") {
          throw invalid({ issue: "table-html-tag-unsupported", location, tag });
        }
      }
    }
    return text;
  };
  const parseSpan = (attrs: UnknownRecord, key: string): number => {
    const value = attrs[`@_${key}`];
    if (value === undefined) return 1;
    if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value))
      throw invalid({ issue: "table-span-invalid", location, span: key });
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maxCells)
      throw invalid({ issue: "table-span-limit", location, span: key });
    return number;
  };
  const readRow = (rowValue: unknown): void => {
    const rowItem = record(rowValue);
    if (rowItem === undefined) throw invalid({ issue: "table-row-shape", location });
    const rowTag = Object.keys(rowItem).find((key) => key !== ":@");
    if (rowTag !== "tr" || !Array.isArray(rowItem.tr))
      throw invalid({ issue: "table-row-shape", location });
    if (Object.keys(record(rowItem[":@"]) ?? {}).length > 0)
      throw invalid({ issue: "table-row-attributes", location });
    const cells: HtmlCell[] = [];
    for (const cellValue of rowItem.tr) {
      const cellItem = record(cellValue);
      if (cellItem === undefined) continue;
      const tag = Object.keys(cellItem).find((key) => key !== ":@");
      if (tag !== "td" && tag !== "th") throw invalid({ issue: "table-cell-shape", location });
      const attrs = record(cellItem[":@"]) ?? {};
      for (const key of Object.keys(attrs))
        if (key !== "@_rowspan" && key !== "@_colspan")
          throw invalid({ issue: "table-cell-attribute", location, attribute: key });
      const children = cellItem[tag];
      if (!Array.isArray(children)) throw invalid({ issue: "table-cell-content", location });
      const content = readText(children, true);
      cells.push({
        text: content,
        rowSpan: parseSpan(attrs, "rowspan"),
        columnSpan: parseSpan(attrs, "colspan"),
      });
      cellCount += 1;
      if (cellCount > maxCells) throw invalid({ issue: "table-cell-limit", location });
    }
    rows.push(cells);
  };
  const root = record(Array.isArray(tree) ? tree[0] : undefined);
  const rootChildren = root?.root;
  if (!Array.isArray(rootChildren)) throw invalid({ issue: "table-html-root", location });
  readText(rootChildren, false);
  if (rows.length === 0) throw invalid({ issue: "table-rows-missing", location });
  return rows;
};

const expandTable = (
  htmlTable: HtmlTable,
  pageNumber: number,
  tableId: string,
  tableCoordinate: NormalizedBlockV1["coordinate"],
  maxCells: number,
  blockId: (suffix: string) => string,
  headingPath: readonly string[],
  maxBlocks: number,
  output: NormalizedBlockV1[],
  location: string,
): void => {
  const occupied = new Set<string>();
  let maxColumn = 0;
  let cellNumber = 0;
  for (let rowIndex = 0; rowIndex < htmlTable.length; rowIndex += 1) {
    let column = 1;
    for (const cell of htmlTable[rowIndex]!) {
      while (occupied.has(`${rowIndex + 1}:${column}`)) column += 1;
      const row = rowIndex + 1;
      const columnStart = column;
      const coveredCellCount = cell.rowSpan * cell.columnSpan;
      if (
        !Number.isSafeInteger(coveredCellCount) ||
        coveredCellCount > maxCells ||
        occupied.size > maxCells - coveredCellCount
      ) {
        throw invalid({ issue: "table-cell-limit", location, row, column });
      }
      if (row + cell.rowSpan - 1 > htmlTable.length || column + cell.columnSpan - 1 > maxCells) {
        throw invalid({ issue: "table-span-out-of-bounds", location, row, column });
      }
      for (let coveredRow = row; coveredRow < row + cell.rowSpan; coveredRow += 1) {
        for (
          let coveredColumn = column;
          coveredColumn < column + cell.columnSpan;
          coveredColumn += 1
        ) {
          const key = `${coveredRow}:${coveredColumn}`;
          if (occupied.has(key))
            throw invalid({
              issue: "table-cell-overlap",
              location,
              row: coveredRow,
              column: coveredColumn,
            });
          occupied.add(key);
        }
      }
      column += cell.columnSpan;
      maxColumn = Math.max(maxColumn, column - 1);
      cellNumber += 1;
      output.push({
        blockId: blockId(`cell-${cellNumber}`),
        kind: "cell",
        text: cell.text,
        chapterId: sourceComponent(tableId),
        segmentId: sourceComponent(tableId),
        headingPath: [...headingPath],
        locator: {
          kind: "table",
          sheet: "mineru",
          table: tableId,
          rowRange: { start: row, end: row + cell.rowSpan - 1 },
          columnRange: { start: columnStart, end: columnStart + cell.columnSpan - 1 },
        },
        coordinate: {
          kind: "cell",
          sheet: "mineru",
          row,
          column: columnStart,
          rowSpan: cell.rowSpan,
          columnSpan: cell.columnSpan,
        },
        tableId,
        sheet: "mineru",
        row,
        column: columnStart,
        rowSpan: cell.rowSpan,
        columnSpan: cell.columnSpan,
      });
      if (output.length > maxBlocks || cellNumber > maxCells)
        throw invalid({ issue: "table-output-limit", location });
    }
  }
  if (maxColumn === 0) throw invalid({ issue: "table-cells-missing", location });
  const tableBlockIndex = output.findIndex(
    (block) => block.tableId === tableId && block.kind === "table",
  );
  if (tableBlockIndex < 0) throw invalid({ issue: "table-block-missing", location });
  const table = output[tableBlockIndex]!;
  output[tableBlockIndex] = {
    ...table,
    locator: {
      kind: "table",
      sheet: "mineru",
      table: tableId,
      rowRange: { start: 1, end: htmlTable.length },
      columnRange: { start: 1, end: maxColumn },
    },
    coordinate: tableCoordinate,
  };
  void pageNumber;
};

const normalizeWhitespace = (text: string): string => text.replace(/\s/gu, "");

const attachDocxStructure = (
  blocks: NormalizedBlockV1[],
  source: ParsedDocumentV1,
  location: string,
): NormalizedBlockV1[] => {
  const sourceText = source.blocks.filter(
    (block) => block.kind !== "table" && block.kind !== "page-break" && block.text.length > 0,
  );
  const targetText = blocks.filter((block) => block.text.length > 0);
  const sourceFlat = sourceText.map((block) => normalizeWhitespace(block.text)).join("");
  const targetFlat = targetText.map((block) => normalizeWhitespace(block.text)).join("");
  if (sourceFlat.length === 0 || sourceFlat !== targetFlat) {
    throw invalid({
      issue: "docx-source-text-mismatch",
      location,
      sourceCharacters: sourceFlat.length,
      serviceCharacters: targetFlat.length,
    });
  }
  let offset = 0;
  let sourceOffset = 0;
  let sourceIndex = 0;
  const mapped = blocks.map((block) => {
    if (block.text.length === 0) return block;
    const value = normalizeWhitespace(block.text);
    const start = offset;
    const end = start + value.length;
    offset = end;
    if (block.kind === "cell") return block;
    while (
      sourceIndex < sourceText.length &&
      sourceOffset + normalizeWhitespace(sourceText[sourceIndex]!.text).length <= start
    ) {
      sourceOffset += normalizeWhitespace(sourceText[sourceIndex]!.text).length;
      sourceIndex += 1;
    }
    const overlaps: ParsedDocumentV1["blocks"][number][] = [];
    let index = sourceIndex;
    let cursor = sourceOffset;
    while (index < sourceText.length && cursor < end) {
      const textBlock = sourceText[index]!;
      const blockEnd = cursor + normalizeWhitespace(textBlock.text).length;
      if (blockEnd > start && cursor < end) overlaps.push(textBlock);
      cursor = blockEnd;
      index += 1;
    }
    if (overlaps.length === 0)
      throw invalid({ issue: "docx-source-association-missing", location });
    const signature = (item: ParsedDocumentV1["blocks"][number]): string =>
      `${item.kind}|${item.headingPath.join("/")}|${JSON.stringify(item.locator)}`;
    if (new Set(overlaps.map(signature)).size !== 1)
      throw invalid({ issue: "docx-source-association-ambiguous", location });
    const sourceBlock = overlaps[0]!;
    return {
      ...block,
      kind: sourceBlock.kind === "cell" ? "cell" : sourceBlock.kind,
      headingPath: [...sourceBlock.headingPath],
      locator: sourceBlock.locator,
      ...(sourceBlock.chapterId === undefined ? {} : { chapterId: sourceBlock.chapterId }),
      ...(sourceBlock.segmentId === undefined ? {} : { segmentId: sourceBlock.segmentId }),
    } as NormalizedBlockV1;
  });

  const sourceTables = source.blocks.filter((block) => block.kind === "table");
  const targetTables = mapped.filter((block) => block.kind === "table");
  if (sourceTables.length !== targetTables.length) {
    throw invalid({
      issue: "docx-table-count-mismatch",
      location,
      sourceTables: sourceTables.length,
      serviceTables: targetTables.length,
    });
  }
  for (let tableIndex = 0; tableIndex < sourceTables.length; tableIndex += 1) {
    const sourceTable = sourceTables[tableIndex]!;
    const targetTable = targetTables[tableIndex]!;
    const sourceCells = source.blocks.filter(
      (block) => block.kind === "cell" && block.tableId === sourceTable.tableId,
    );
    const targetCells = mapped.filter(
      (block) => block.kind === "cell" && block.tableId === targetTable.tableId,
    );
    if (sourceCells.length !== targetCells.length) {
      throw invalid({
        issue: "docx-table-cell-count-mismatch",
        location,
        tableIndex,
        sourceCells: sourceCells.length,
        serviceCells: targetCells.length,
      });
    }
    if (sourceTable.locator.kind !== "table" || targetTable.locator.kind !== "table") {
      throw invalid({ issue: "docx-table-locator-invalid", location, tableIndex });
    }
    const sourceBounds = sourceTable.locator;
    const targetBounds = targetTable.locator;
    if (
      sourceBounds.rowRange.end !== targetBounds.rowRange.end ||
      sourceBounds.columnRange.end !== targetBounds.columnRange.end
    ) {
      throw invalid({ issue: "docx-table-bounds-mismatch", location, tableIndex });
    }
    const tableId = sourceTable.tableId ?? `table_${tableIndex + 1}`;
    const replace = (block: NormalizedBlockV1, next: NormalizedBlockV1): void => {
      const index = mapped.findIndex((item) => item.blockId === block.blockId);
      if (index < 0) throw invalid({ issue: "docx-table-block-missing", location, tableIndex });
      mapped[index] = next;
    };
    replace(targetTable, {
      ...targetTable,
      tableId,
      sheet: "docx",
      ...(sourceTable.chapterId === undefined ? {} : { chapterId: sourceTable.chapterId }),
      ...(sourceTable.segmentId === undefined ? {} : { segmentId: sourceTable.segmentId }),
      headingPath: [...sourceTable.headingPath],
      locator: { ...targetBounds, sheet: "docx", table: tableId },
    });
    for (let cellIndex = 0; cellIndex < sourceCells.length; cellIndex += 1) {
      const sourceCell = sourceCells[cellIndex]!;
      const targetCell = targetCells[cellIndex]!;
      if (
        sourceCell.row !== targetCell.row ||
        sourceCell.column !== targetCell.column ||
        sourceCell.rowSpan !== targetCell.rowSpan ||
        sourceCell.columnSpan !== targetCell.columnSpan ||
        sourceCell.row === undefined ||
        sourceCell.column === undefined ||
        sourceCell.rowSpan === undefined ||
        sourceCell.columnSpan === undefined ||
        normalizeWhitespace(sourceCell.text) !== normalizeWhitespace(targetCell.text)
      ) {
        throw invalid({ issue: "docx-table-cell-mismatch", location, tableIndex, cellIndex });
      }
      if (targetCell.locator.kind !== "table")
        throw invalid({ issue: "docx-cell-locator-invalid", location, tableIndex, cellIndex });
      replace(targetCell, {
        ...targetCell,
        tableId,
        sheet: "docx",
        coordinate: {
          kind: "cell",
          sheet: "docx",
          row: sourceCell.row,
          column: sourceCell.column,
          rowSpan: sourceCell.rowSpan,
          columnSpan: sourceCell.columnSpan,
        },
        ...(sourceCell.chapterId === undefined ? {} : { chapterId: sourceCell.chapterId }),
        ...(sourceCell.segmentId === undefined ? {} : { segmentId: sourceCell.segmentId }),
        headingPath: [...sourceTable.headingPath],
        locator: { ...targetCell.locator, sheet: "docx", table: tableId },
      });
    }
  }

  const breaks = source.blocks.filter((block) => block.kind === "page-break");
  if (breaks.length > 0) {
    const textualSourceIndexes = new Map(sourceText.map((block, index) => [block.blockId, index]));
    const sourceBreakOffsets = source.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.kind === "page-break")
      .map(({ block, index }) => ({
        block,
        before: source.blocks
          .slice(0, index)
          .filter((item) => textualSourceIndexes.has(item.blockId))
          .reduce((sum, item) => sum + normalizeWhitespace(item.text).length, 0),
      }));
    for (const item of sourceBreakOffsets) {
      const targetOffset = item.before;
      let consumed = 0;
      let insertAt = mapped.length;
      for (let index = 0; index < mapped.length; index += 1) {
        const block = mapped[index]!;
        if (block.kind === "page-break") {
          if (consumed <= targetOffset) insertAt = index + 1;
          continue;
        }
        if (block.text.length === 0) {
          if (consumed >= targetOffset) {
            insertAt = index;
            break;
          }
          continue;
        }
        const length = normalizeWhitespace(block.text).length;
        if (consumed >= targetOffset) {
          insertAt = index;
          break;
        }
        consumed += length;
      }
      mapped.splice(insertAt, 0, item.block);
    }
  }
  return mapped;
};

export const normalizeMineruMiddle = (
  middle: unknown,
  request: DocumentServiceParserRequestV1,
  config: MineruConfigV1,
  sourceInfo: MineruSourceInfoV1,
): { parsedDocument: ParsedDocumentV1; diagnostic: JsonValue } => {
  const root = record(middle);
  if (root === undefined || !Array.isArray(root.pages) || root.pages.length === 0) {
    throw invalid({ issue: "document-shape" });
  }
  if (
    config.protocol === "self-hosted-v1" &&
    (root.schema !== "docvortex.middle" ||
      root.schema_version !== "2.0" ||
      root.is_full_document !== true)
  ) {
    throw new DocumentServiceParserError({
      code: "MINERU_PROTOCOL_INVALID",
      stage: "protocol",
      retryable: false,
      diagnostic: { failure: { issue: "middle-identity" } },
    });
  }
  const metadata = record(root.metadata);
  const producer = record(metadata?.producer);
  const extensions = record(root.extensions);
  const mineruExtension = record(extensions?.mineru);
  const producerVersion = typeof producer?.version === "string" ? producer.version : null;
  const tier =
    config.protocol === "official-v4"
      ? null
      : typeof mineruExtension?.tier === "string"
        ? mineruExtension.tier
        : null;
  const inputKind = request.command.input.kind;
  if (config.protocol === "self-hosted-v1") {
    const expectedTier = inputKind === "docx" ? "flash" : "standard";
    if (producerVersion !== "4.0.12" || tier !== expectedTier) {
      throw new DocumentServiceParserError({
        code: "MINERU_DEPLOYMENT_MISMATCH",
        stage: "deployment",
        retryable: false,
        diagnostic: {
          failure: { issue: "producer-or-tier-mismatch", producerVersion, tier, expectedTier },
        },
      });
    }
  }

  const pages = root.pages;
  const expectedCount = sourceInfo.pageCount;
  if (expectedCount !== undefined && pages.length !== expectedCount) {
    throw invalid({ issue: "page-count-mismatch", expected: expectedCount, actual: pages.length });
  }
  const pageExtents: DocumentPageExtentV1[] = [];
  const pdfLayout = record(extensions?.docvortex_layout);
  const layoutPages = Array.isArray(pdfLayout?.pages) ? pdfLayout.pages : undefined;
  if (inputKind !== "docx") {
    if (sourceInfo.pageExtents !== undefined) pageExtents.push(...sourceInfo.pageExtents);
    else if (layoutPages !== undefined) {
      for (let index = 0; index < layoutPages.length; index += 1) {
        const layout = record(layoutPages[index]);
        if (
          layout === undefined ||
          layout.page_idx !== index ||
          typeof layout.width_pt !== "number" ||
          !Number.isFinite(layout.width_pt) ||
          layout.width_pt <= 0 ||
          typeof layout.height_pt !== "number" ||
          !Number.isFinite(layout.height_pt) ||
          layout.height_pt <= 0
        ) {
          throw invalid({ issue: "page-layout-invalid", pageIndex: index });
        }
        pageExtents.push({
          pageNumber: index + 1,
          width: layout.width_pt,
          height: layout.height_pt,
          coordinateSystem: "point-top-left",
        });
      }
    } else throw invalid({ issue: "page-layout-missing" });
    if (pageExtents.length !== pages.length)
      throw invalid({
        issue: "page-extents-count-mismatch",
        pages: pages.length,
        extents: pageExtents.length,
      });
  }
  if (inputKind === "text-pdf" && sourceInfo.pageCount !== undefined && layoutPages === undefined) {
    throw invalid({ issue: "pdf-page-layout-missing" });
  }

  const policy: DocumentConversionResourcePolicyV1 = request.resourcePolicy;
  const blocks: NormalizedBlockV1[] = [];
  const nonEmptyPages = new Set<number>();
  let regionCount = 0;
  let tableCount = 0;
  let cellCount = 0;
  let serviceTextCharacters = 0;
  const pageSeen = new Set<number>();
  for (let pageArrayIndex = 0; pageArrayIndex < pages.length; pageArrayIndex += 1) {
    const page = record(pages[pageArrayIndex]);
    const pageIndex = page?.page_idx;
    if (
      page === undefined ||
      !Number.isSafeInteger(pageIndex) ||
      pageIndex !== pageArrayIndex ||
      pageSeen.has(pageIndex as number) ||
      !Array.isArray(page.blocks)
    ) {
      throw invalid({
        issue: "page-order-invalid",
        pageIndex: typeof pageIndex === "number" ? pageIndex : null,
        arrayIndex: pageArrayIndex,
      });
    }
    pageSeen.add(pageIndex as number);
    const pageNumber = (pageIndex as number) + 1;
    const extent = pageExtents[pageArrayIndex];
    const blockIndexes = new Set<number>();
    let priorIndex = -1;
    for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex += 1) {
      const rawBlock = record(page.blocks[blockIndex]);
      const location = `pages[${pageArrayIndex}].blocks[${blockIndex}]`;
      if (rawBlock === undefined || typeof rawBlock.type !== "string")
        throw invalid({ issue: "block-shape", location });
      if (rawBlock.index !== undefined) {
        if (
          !Number.isSafeInteger(rawBlock.index) ||
          (rawBlock.index as number) < 0 ||
          blockIndexes.has(rawBlock.index as number) ||
          (rawBlock.index as number) <= priorIndex
        ) {
          throw invalid({
            issue: "reading-order-invalid",
            location,
            blockIndex: rawBlock.index as number,
          });
        }
        blockIndexes.add(rawBlock.index as number);
        priorIndex = rawBlock.index as number;
      }
      const type = rawBlock.type;
      if (
        inputKind !== "docx" &&
        [
          "text",
          "ref_text",
          "aside_text",
          "header",
          "footer",
          "page_number",
          "page_footnote",
          "doc_title",
          "paragraph_title",
          "equation",
          "algorithm_body",
          "code_body",
          "list",
          "index",
          "image",
          "table",
          "chart",
          "code",
        ].includes(type)
      )
        validBbox(rawBlock.bbox, location);
      const idBase = `mineru-p${pageNumber}-b${blockIndex + 1}`;
      const baseBlock = (
        kind: NormalizedBlockV1["kind"],
        text: string,
        bbox: unknown,
        suffix = "",
      ): NormalizedBlockV1 => ({
        blockId: `${idBase}${suffix}`,
        kind,
        text,
        chapterId: `page_${pageNumber}`,
        segmentId: sourceComponent(`region_p${pageNumber}_b${blockIndex + 1}${suffix}`),
        headingPath: [`page_${pageNumber}`],
        locator: { kind: "document", pageNumber, headingPath: [`page_${pageNumber}`] },
        ...(inputKind === "docx"
          ? {}
          : { coordinate: pageCoordinate(bbox, extent, pageNumber, location) }),
      });
      const pushText = (kind: "paragraph" | "heading" | "caption", text: string): void => {
        if (text.trim().length === 0) return;
        blocks.push(baseBlock(kind, text, rawBlock.bbox));
        regionCount += 1;
        serviceTextCharacters += text.length;
        nonEmptyPages.add(pageNumber);
      };
      if (
        [
          "text",
          "ref_text",
          "aside_text",
          "header",
          "footer",
          "page_number",
          "page_footnote",
          "doc_title",
          "paragraph_title",
          "equation",
          "algorithm_body",
          "code_body",
        ].includes(type)
      ) {
        const text = contentOf(rawBlock, location);
        pushText(
          type === "doc_title" || type === "paragraph_title" ? "heading" : "paragraph",
          text,
        );
      } else if (type === "list" || type === "index") {
        const flatten = (value: unknown, depth: number): string => {
          if (depth > 32) throw invalid({ issue: "nested-content-depth", location });
          if (!Array.isArray(value)) throw invalid({ issue: "nested-content-shape", location });
          return value
            .map((childValue, childIndex) => {
              const child = record(childValue);
              if (child === undefined || typeof child.type !== "string")
                throw invalid({ issue: "nested-block-shape", location, childIndex });
              if (["text", "ref_text", "doc_title", "paragraph_title"].includes(child.type))
                return contentOf(child, `${location}.content[${childIndex}]`);
              if (child.type === "list" || child.type === "index")
                return flatten(child.content, depth + 1);
              throw invalid({ issue: "nested-block-unsupported", location, blockType: child.type });
            })
            .join("");
        };
        pushText("paragraph", flatten(rawBlock.content, 0));
      } else if (["image", "table", "chart", "code"].includes(type)) {
        if (!Array.isArray(rawBlock.content))
          throw invalid({ issue: "visual-content-shape", location });
        const children: TypedRecord[] = rawBlock.content.map((value, index) => {
          const child = record(value);
          if (child === undefined || typeof child.type !== "string")
            throw invalid({ issue: "visual-child-shape", location, childIndex: index });
          return child as TypedRecord;
        });
        if (type === "table") {
          const bodies = children.filter((child) => child.type === "table_body");
          if (bodies.length !== 1) throw invalid({ issue: "table-body-count", location });
          const html = bodies[0]!.content;
          if (typeof html !== "string") throw invalid({ issue: "table-body-html", location });
          const tableId = `mineru-table-p${pageNumber}-b${blockIndex + 1}`;
          const coordinate =
            inputKind === "docx"
              ? undefined
              : pageCoordinate(rawBlock.bbox, extent, pageNumber, location);
          const tableBlock: NormalizedBlockV1 = {
            blockId: `${idBase}-table`,
            kind: "table",
            text: "",
            chapterId: sourceComponent(tableId),
            segmentId: sourceComponent(tableId),
            headingPath: [`page_${pageNumber}`],
            locator: {
              kind: "table",
              sheet: "mineru",
              table: tableId,
              rowRange: { start: 1, end: 1 },
              columnRange: { start: 1, end: 1 },
            },
            tableId,
            sheet: "mineru",
            ...(coordinate === undefined ? {} : { coordinate }),
          };
          blocks.push(tableBlock);
          regionCount += 1;
          const table = parseHtmlTable(
            html,
            Math.min(policy.maxXmlBytes, config.maxResponseBytes),
            policy.maxCells,
            location,
          );
          const tableCellCount = table.reduce((sum, row) => sum + row.length, 0);
          if (cellCount + tableCellCount > policy.maxCells)
            throw invalid({
              issue: "table-cell-limit",
              location,
              observedCells: cellCount + tableCellCount,
              maximum: policy.maxCells,
            });
          expandTable(
            table,
            pageNumber,
            tableId,
            coordinate,
            policy.maxCells,
            (suffix) => `${idBase}-${suffix}`,
            [`page_${pageNumber}`],
            policy.maxOutputBlocks,
            blocks,
            location,
          );
          tableCount += 1;
          cellCount += tableCellCount;
          for (const cell of table.flat()) {
            if (cell.text.trim().length > 0) {
              serviceTextCharacters += cell.text.length;
              nonEmptyPages.add(pageNumber);
            }
          }
          for (const [childIndex, child] of children.entries())
            if (child.type === "table_caption" || child.type === "table_footnote") {
              const caption = contentOf(child, location);
              if (caption.trim().length > 0) {
                const block = baseBlock(
                  "caption",
                  caption,
                  child.bbox ?? rawBlock.bbox,
                  `-caption-${childIndex + 1}`,
                );
                blocks.push(block);
                regionCount += 1;
                serviceTextCharacters += caption.length;
                nonEmptyPages.add(pageNumber);
              }
            }
          for (const child of children)
            if (!new Set(["table_body", "table_caption", "table_footnote"]).has(child.type)) {
              if (
                Array.isArray(child.content)
                  ? child.content.length > 0
                  : typeof child.content === "string" && child.content.trim().length > 0
              )
                throw invalid({
                  issue: "table-child-unsupported",
                  location,
                  blockType: child.type,
                });
            }
        } else {
          const annotationTypes = new Set(
            type === "image"
              ? ["image_caption", "image_footnote"]
              : type === "chart"
                ? ["chart_caption", "chart_footnote"]
                : ["code_caption", "code_footnote"],
          );
          const bodyTypes = new Set(
            type === "image"
              ? ["image_body"]
              : type === "chart"
                ? ["chart_body"]
                : ["code_body", "algorithm_body"],
          );
          for (const [childIndex, child] of children.entries()) {
            if (annotationTypes.has(child.type)) {
              const caption = contentOf(child, location);
              if (caption.trim().length > 0) {
                blocks.push(
                  baseBlock(
                    "caption",
                    caption,
                    child.bbox ?? rawBlock.bbox,
                    `-caption-${childIndex + 1}`,
                  ),
                );
                regionCount += 1;
                serviceTextCharacters += caption.length;
                nonEmptyPages.add(pageNumber);
              }
            } else if (bodyTypes.has(child.type)) {
              if (child.type === "algorithm_body")
                pushText("paragraph", contentOf(child, location));
              else if (child.type === "code_body")
                pushText("paragraph", contentOf(child, location));
              // Image and chart body strings identify payloads; they are not recognized text.
              else if (typeof child.content !== "string")
                throw invalid({ issue: "visual-body-content", location, blockType: child.type });
            } else if (
              Array.isArray(child.content)
                ? child.content.length > 0
                : typeof child.content === "string" && child.content.trim().length > 0
            ) {
              throw invalid({ issue: "visual-child-unsupported", location, blockType: child.type });
            }
          }
        }
      } else {
        const content = rawBlock.content;
        const hasContent =
          typeof content === "string"
            ? content.trim().length > 0
            : Array.isArray(content)
              ? content.length > 0
              : false;
        if (hasContent)
          throw invalid({ issue: "block-type-unsupported", location, blockType: type });
      }
      if (blocks.length > policy.maxOutputBlocks)
        throw invalid({ issue: "output-block-limit", location });
    }
  }

  if (
    blocks.filter((block) => block.kind === "cell").some((block) => block.text.trim().length > 0)
  ) {
    for (const block of blocks)
      if (block.kind === "cell" && block.text.trim().length > 0)
        nonEmptyPages.add(Number(/-p([0-9]+)-/u.exec(block.blockId)?.[1] ?? 1));
  }
  const totalPages = pages.length;
  const nonEmptyPageRatio = totalPages === 0 ? 0 : nonEmptyPages.size / totalPages;
  if (serviceTextCharacters === 0 || !blocks.some((block) => block.text.trim().length > 0)) {
    throw qualityFailure({
      issue: "empty-document",
      nonEmptyPages: nonEmptyPages.size,
      totalPages,
    });
  }
  const searchableText = normalizeWhitespace(
    blocks.map((block) => block.text).join(""),
  ).toLocaleLowerCase();
  const missingKeyFields = config.qualityPolicy.keyFields.filter(
    (field) => !searchableText.includes(normalizeWhitespace(field).toLocaleLowerCase()),
  );
  const keyFieldCoverage =
    config.qualityPolicy.keyFields.length === 0
      ? 1
      : (config.qualityPolicy.keyFields.length - missingKeyFields.length) /
        config.qualityPolicy.keyFields.length;
  if (
    nonEmptyPageRatio < config.qualityPolicy.minNonEmptyPageRatio ||
    keyFieldCoverage < config.qualityPolicy.minKeyFieldCoverage
  ) {
    throw qualityFailure({
      issue: "quality-threshold",
      nonEmptyPages: nonEmptyPages.size,
      totalPages,
      nonEmptyPageRatio,
      minNonEmptyPageRatio: config.qualityPolicy.minNonEmptyPageRatio,
      keyFieldCoverage,
      minKeyFieldCoverage: config.qualityPolicy.minKeyFieldCoverage,
      missingKeyFields,
    });
  }

  let normalizedBlocks = blocks;
  if (inputKind === "docx") {
    if (sourceInfo.docx === undefined) throw invalid({ issue: "docx-source-missing" });
    normalizedBlocks = attachDocxStructure(blocks, sourceInfo.docx, "docx");
  }
  const candidate = {
    schemaVersion: "1" as const,
    inputKind,
    sourceVersionRef: request.source.sourceVersionRef,
    sourceArtifactRef: request.source.sourceArtifactRef,
    sourceId: request.source.sourceId,
    spatialScopeRefs: request.source.spatialScopeRefs,
    metadata: {
      projectId: request.source.projectId,
      sourceId: request.source.sourceId,
      sourceItemId: request.source.sourceItemId,
      mediaType: request.command.mediaType,
      ...(typeof metadata?.title === "string" ? { title: metadata.title } : {}),
    },
    blocks: normalizedBlocks,
    ...(inputKind === "docx" ? {} : { pageExtents }),
    inputBytes: request.bytes.byteLength,
  };
  const parsed = ParsedDocumentV1Schema.safeParse(candidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw invalid({
      issue: "parsed-document-schema",
      path: firstIssue?.path.map(String).join(".") ?? "",
      schemaCode: firstIssue?.code ?? "unknown",
    });
  }
  const diagnostic: JsonValue = {
    sourceFormat: config.protocol === "self-hosted-v1" ? "docvortex.middle/2.0" : null,
    protocol: config.protocol,
    producer: {
      name: typeof producer?.name === "string" ? producer.name : null,
      version: producerVersion,
    },
    tier,
    pageCount: pages.length,
    regionCount,
    tableCount,
    cellCount,
    confidence: "unavailable",
    perCellGeometry: "unavailable",
    quality: {
      nonEmptyPageRatio,
      minNonEmptyPageRatio: config.qualityPolicy.minNonEmptyPageRatio,
      keyFieldCoverage,
      minKeyFieldCoverage: config.qualityPolicy.minKeyFieldCoverage,
      missingKeyFields,
    },
  };
  return { parsedDocument: parsed.data, diagnostic };
};
