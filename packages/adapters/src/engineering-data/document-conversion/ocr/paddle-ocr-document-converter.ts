import { makeSourceSegmentId } from "@riskflow/core/engineering-data/context-source";
import {
  ParsedDocumentV1Schema,
  type DocumentPageExtentV1,
  type NormalizedBlockV1,
} from "@riskflow/core/engineering-data/document-conversion";

import type {
  OcrLayoutParserOutcomeV1,
  OcrLayoutParserRequestV1,
  OcrLayoutParserV1,
  PersistedOcrRawResponseV1,
} from "../structured-document-converter.js";
import { OcrLayoutParserError } from "../structured-document-converter.js";
import { parsePaddleOcrLayoutConfig } from "./config.js";
import {
  OCR_LAYOUT_PROTOCOL_VERSION_V1,
  OcrTraceV1Schema,
  PaddleLayoutRequestV1Schema,
  PaddleLayoutResponseV1Schema,
  ocrFailure,
  toJsonValue,
  type OcrKeyFieldV1,
  type OcrQualityMetricV1,
  type OcrQualityPolicyV1,
  type PaddleBoundingBoxV1,
  type PaddleLayoutPageV1,
  type PaddleLayoutResponseV1,
  type PaddleOcrDeploymentConfigV1,
  type PaddleOcrLayoutConfigV1,
} from "./schema.js";

/**
 * C13 扫描转换 adapter：把 PaddleX PP-StructureV3 `POST /layout-parsing` 私有协议
 * 确定性收敛为 C12 规范化页/块/表格结构。原始响应先经 C12 闭包耐久保存并受权
 * 重读，只有重读字节才进入协议、结构与质量校验；服务端成功码不构成业务成功。
 */

/** 版面标签到 C12 闭合类别的唯一映射；未列出的标签不猜测语义，直接拒绝。 */
const LAYOUT_LABEL_KINDS: Readonly<Record<string, NormalizedBlockV1["kind"]>> = Object.freeze({
  title: "heading",
  doc_title: "heading",
  paragraph_title: "heading",
  text: "paragraph",
  figure_title: "caption",
  table_title: "caption",
  image_caption: "caption",
  caption: "caption",
  table: "table",
});

const MEDIA_TYPE_FILE_TYPES: Readonly<Record<string, 0 | 1>> = Object.freeze({
  "application/pdf": 0,
  "image/png": 1,
  "image/jpeg": 1,
});

type BoundingBox = PaddleBoundingBoxV1;

interface SegmentIdentityV1 {
  readonly chapterId: string;
  readonly segmentId: string;
}

interface OcrItemV1 {
  readonly text: string;
  readonly score: number;
  readonly bbox: BoundingBox;
}

interface NormalizedRegionV1 {
  readonly block: NormalizedBlockV1;
  readonly hasText: boolean;
  readonly confidence: number | undefined;
}

interface NormalizedTableV1 {
  readonly blocks: readonly NormalizedBlockV1[];
  readonly cellCount: number;
  readonly complete: boolean;
}

interface NormalizedPageV1 {
  readonly pageNumber: number;
  readonly extent: DocumentPageExtentV1;
  readonly regions: readonly NormalizedRegionV1[];
  readonly tables: readonly NormalizedTableV1[];
}

interface LayoutNormalizationV1 {
  readonly pages: readonly NormalizedPageV1[];
  readonly blocks: readonly NormalizedBlockV1[];
  readonly segmentIdentities: readonly SegmentIdentityV1[];
  readonly pageExtents: readonly DocumentPageExtentV1[];
  readonly regionCount: number;
  readonly tableCount: number;
  readonly cellCount: number;
  readonly regionConfidences: readonly number[];
  readonly perPageText: readonly string[];
  readonly declaredPageCount: number | undefined;
}

const pageChapterId = (pageNumber: number): string => `page_${pageNumber}`;
const boxWidth = (bbox: BoundingBox): number => bbox[2] - bbox[0];
const boxHeight = (bbox: BoundingBox): number => bbox[3] - bbox[1];
const boxCenter = (bbox: BoundingBox): readonly [number, number] => [
  (bbox[0] + bbox[2]) / 2,
  (bbox[1] + bbox[3]) / 2,
];
const boxContains = (outer: BoundingBox, inner: BoundingBox): boolean =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
const withinPage = (bbox: BoundingBox, width: number, height: number): boolean =>
  bbox[0] >= 0 && bbox[1] >= 0 && bbox[2] <= width && bbox[3] <= height;
const centerInside = (bbox: BoundingBox, outer: BoundingBox): boolean => {
  const [x, y] = boxCenter(bbox);
  return x >= outer[0] && x <= outer[2] && y >= outer[1] && y <= outer[3];
};
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
const normalizeText = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");

/** 服务四点多边形按外包矩形无损映射；非轴对齐多边形不在此协议视图中出现。 */
const polygonBounds = (points: readonly (readonly [number, number])[]): BoundingBox => {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

const ocrItems = (page: PaddleLayoutPageV1): OcrItemV1[] => {
  const source = page.prunedResult.overall_ocr_res;
  if (source === undefined) return [];
  const boxes = source.rec_boxes ?? source.rec_polys?.map(polygonBounds);
  if (boxes === undefined || boxes.length !== source.rec_texts.length) return [];
  return source.rec_texts.map((text, index) => ({
    text,
    score: source.rec_scores[index] ?? 0,
    bbox: boxes[index]!,
  }));
};

/**
 * 由服务返回的单元格坐标推导行列网格：以全部单元格边界为切割点，单元格覆盖的
 * 连续切割区间即其行列范围（起点为一基行号，终点为等于上界的行号，因此跨行/跨列
 * 单元格的 span 直接由覆盖区间得出）。纯几何、确定性，不依据空白或文本排列猜测
 * 合并单元格，也不补造服务未返回的单元格；假设服务单元格共享表格分割线。
 */
const gridRanges = (
  intervals: readonly (readonly [number, number])[],
): Array<{ start: number; end: number }> => {
  const cuts = [...new Set(intervals.flatMap((interval) => [interval[0], interval[1]]))].sort(
    (left, right) => left - right,
  );
  const indexOf = new Map(cuts.map((cut, index) => [cut, index]));
  return intervals.map((interval) => ({
    start: indexOf.get(interval[0])! + 1,
    end: Math.max(indexOf.get(interval[0])! + 1, indexOf.get(interval[1])!),
  }));
};

const normalizeTable = (
  page: PaddleLayoutPageV1,
  pageNumber: number,
  tableIndex: number,
  regionBbox: BoundingBox,
  items: readonly OcrItemV1[],
): NormalizedTableV1 => {
  const chapterId = pageChapterId(pageNumber);
  const tableId = `ocr_${chapterId}_table_${tableIndex + 1}`;
  const cellBoxes = page.prunedResult.table_res_list?.[tableIndex]?.cell_box_list ?? [];
  if (cellBoxes.length === 0) {
    return {
      blocks: [
        {
          blockId: tableId,
          kind: "table",
          text: "",
          headingPath: [chapterId],
          locator: {
            kind: "table",
            sheet: chapterId,
            table: tableId,
            rowRange: { start: 1, end: 1 },
            columnRange: { start: 1, end: 1 },
          },
          coordinate: {
            kind: "page",
            pageNumber,
            x: regionBbox[0],
            y: regionBbox[1],
            width: boxWidth(regionBbox),
            height: boxHeight(regionBbox),
          },
          tableId,
          sheet: chapterId,
          chapterId,
          segmentId: tableId,
        },
      ],
      cellCount: 0,
      complete: false,
    };
  }
  for (const cell of cellBoxes) {
    if (!boxContains(regionBbox, cell) || boxWidth(cell) <= 0 || boxHeight(cell) <= 0) {
      throw ocrFailure("OCR_OUTPUT_INVALID", {
        message: "table cell lies outside its table region",
        diagnostic: { pageNumber, tableId },
      });
    }
  }
  const rowRanges = gridRanges(cellBoxes.map((cell) => [cell[1], cell[3]] as const));
  const columnRanges = gridRanges(cellBoxes.map((cell) => [cell[0], cell[2]] as const));
  const rowCount = Math.max(...rowRanges.map((range) => range.end));
  const columnCount = Math.max(...columnRanges.map((range) => range.end));
  const cells: NormalizedBlockV1[] = [];
  for (const [index, cell] of cellBoxes.entries()) {
    const rowRange = rowRanges[index]!;
    const columnRange = columnRanges[index]!;
    const cellItems = items.filter((item) => centerInside(item.bbox, cell));
    const text = cellItems
      .map((item) => item.text)
      .join("")
      .trim();
    const confidence =
      cellItems.length === 0 ? undefined : mean(cellItems.map((item) => item.score));
    const rowSpan = rowRange.end - rowRange.start + 1;
    const columnSpan = columnRange.end - columnRange.start + 1;
    const segmentId = `${tableId}_r${rowRange.start}_c${columnRange.start}`;
    cells.push({
      blockId: `${tableId}_cell_${index + 1}`,
      kind: "cell",
      text,
      headingPath: [chapterId],
      locator: {
        kind: "table",
        sheet: chapterId,
        table: tableId,
        rowRange: { start: rowRange.start, end: rowRange.end },
        columnRange: { start: columnRange.start, end: columnRange.end },
      },
      coordinate: {
        kind: "page",
        pageNumber,
        x: cell[0],
        y: cell[1],
        width: boxWidth(cell),
        height: boxHeight(cell),
      },
      tableId,
      sheet: chapterId,
      row: rowRange.start,
      column: columnRange.start,
      rowSpan,
      columnSpan,
      ...(confidence === undefined ? {} : { confidence }),
      chapterId,
      segmentId,
    });
  }
  return {
    blocks: [
      {
        blockId: tableId,
        kind: "table",
        text: "",
        headingPath: [chapterId],
        locator: {
          kind: "table",
          sheet: chapterId,
          table: tableId,
          rowRange: { start: 1, end: rowCount },
          columnRange: { start: 1, end: columnCount },
        },
        coordinate: {
          kind: "page",
          pageNumber,
          x: regionBbox[0],
          y: regionBbox[1],
          width: boxWidth(regionBbox),
          height: boxHeight(regionBbox),
        },
        tableId,
        sheet: chapterId,
        chapterId,
        segmentId: tableId,
      },
      ...cells,
    ],
    cellCount: cells.length,
    complete: cells.every((cell) => cell.text.trim().length > 0),
  };
};

const normalizePage = (page: PaddleLayoutPageV1, position: number): NormalizedPageV1 => {
  const pageNumber = (page.prunedResult.page_index ?? position) + 1;
  const shape = page.prunedResult.doc_preprocessor_res?.output_img_shape;
  if (shape === undefined) {
    throw ocrFailure("OCR_OUTPUT_INVALID", {
      message: "page result is missing the decoded image shape",
      diagnostic: { pageNumber },
    });
  }
  const height = shape[0];
  const width = shape[1];
  const chapterId = pageChapterId(pageNumber);
  const items = ocrItems(page);
  const regions: NormalizedRegionV1[] = [];
  const tables: NormalizedTableV1[] = [];
  let tableRegions = 0;
  for (const [index, block] of page.prunedResult.parsing_res_list.entries()) {
    const kind = LAYOUT_LABEL_KINDS[block.block_label];
    if (kind === undefined) {
      throw ocrFailure("OCR_OUTPUT_INVALID", {
        message: "layout label is not in the closed C12 category mapping",
        diagnostic: { pageNumber, readingOrder: index + 1 },
      });
    }
    const bbox = block.block_bbox;
    if (!withinPage(bbox, width, height) || boxWidth(bbox) <= 0 || boxHeight(bbox) <= 0) {
      throw ocrFailure("OCR_OUTPUT_INVALID", {
        message: "layout region coordinates fall outside the page",
        diagnostic: { pageNumber, readingOrder: index + 1 },
      });
    }
    if (kind === "table") {
      tableRegions += 1;
      const table = normalizeTable(page, pageNumber, tableRegions - 1, bbox, items);
      tables.push(table);
      regions.push({
        block: table.blocks[0]!,
        hasText: false,
        confidence: undefined,
      });
      continue;
    }
    const scores = items.filter((item) => centerInside(item.bbox, bbox)).map((item) => item.score);
    const regionNumber = regions.length + 1;
    regions.push({
      block: {
        blockId: `ocr_${chapterId}_region_${regionNumber}`,
        kind,
        text: block.block_content,
        headingPath: [chapterId],
        locator: { kind: "document", pageNumber, headingPath: [chapterId] },
        coordinate: {
          kind: "page",
          pageNumber,
          x: bbox[0],
          y: bbox[1],
          width: boxWidth(bbox),
          height: boxHeight(bbox),
        },
        ...(scores.length === 0 ? {} : { confidence: mean(scores) }),
        chapterId,
        segmentId: `region_${pageNumber}_${regionNumber}`,
      },
      hasText: block.block_content.trim().length > 0,
      confidence: scores.length === 0 ? undefined : mean(scores),
    });
  }
  return {
    pageNumber,
    extent: { pageNumber, width, height, coordinateSystem: "pixel-top-left" },
    regions,
    tables,
  };
};

const toPageResults = (
  page: NormalizedPageV1,
): { readonly blocks: NormalizedBlockV1[]; readonly identities: SegmentIdentityV1[] } => {
  const blocks: NormalizedBlockV1[] = [];
  const identities: SegmentIdentityV1[] = [];
  const tables = new Map(page.tables.map((table) => [table.blocks[0]!.tableId!, table] as const));
  for (const region of page.regions) {
    blocks.push(region.block);
    if (region.hasText) {
      identities.push({ chapterId: region.block.chapterId!, segmentId: region.block.segmentId! });
    }
    const table = region.block.tableId === undefined ? undefined : tables.get(region.block.tableId);
    if (table === undefined) continue;
    for (const cell of table.blocks.slice(1)) {
      blocks.push(cell);
      if (cell.text.trim().length === 0) continue;
      identities.push({ chapterId: cell.chapterId!, segmentId: cell.segmentId! });
    }
  }
  return { blocks, identities };
};

const normalizeLayout = (
  result: PaddleLayoutResponseV1["result"],
  fileType: 0 | 1,
  maxPages: number,
): LayoutNormalizationV1 => {
  const pages = result.layoutParsingResults;
  if (pages.length > maxPages) {
    throw ocrFailure("OCR_BUDGET_EXCEEDED", {
      message: "layout response exceeds the frozen page budget",
    });
  }
  const normalized = pages.map((page, position) => normalizePage(page, position));
  for (const [index, page] of normalized.entries()) {
    if (page.pageNumber !== index + 1) {
      throw ocrFailure("OCR_OUTPUT_INVALID", {
        message: "page results are duplicated, missing or out of order",
        diagnostic: { pageNumber: page.pageNumber },
      });
    }
  }
  const expectedType = fileType === 0 ? "pdf" : "image";
  const declaredPageCount = result.dataInfo.type === "pdf" ? result.dataInfo.numPages : 1;
  if (
    result.dataInfo.type !== expectedType ||
    declaredPageCount !== pages.length ||
    (result.dataInfo.type === "pdf" && result.dataInfo.pages.length !== result.dataInfo.numPages)
  ) {
    throw ocrFailure("OCR_OUTPUT_INVALID", {
      message: "input type or declared page count does not match the returned page results",
      diagnostic: { pageCount: pages.length, declaredPageCount, inputType: result.dataInfo.type },
    });
  }
  const blocks: NormalizedBlockV1[] = [];
  const identities: SegmentIdentityV1[] = [];
  let regionCount = 0;
  let tableCount = 0;
  let cellCount = 0;
  for (const page of normalized) {
    const pageResults = toPageResults(page);
    blocks.push(...pageResults.blocks);
    identities.push(...pageResults.identities);
    regionCount += page.regions.length;
    tableCount += page.tables.length;
    cellCount += page.tables.reduce((total, table) => total + table.cellCount, 0);
  }
  return {
    pages: normalized,
    blocks,
    segmentIdentities: identities,
    pageExtents: normalized.map((page) => page.extent),
    regionCount,
    tableCount,
    cellCount,
    regionConfidences: blocks.flatMap((block) =>
      block.confidence === undefined ? [] : [block.confidence],
    ),
    perPageText: normalized.map((page) =>
      toPageResults(page)
        .blocks.filter((block) => block.text.trim().length > 0)
        .map((block) => block.text)
        .join(""),
    ),
    declaredPageCount,
  };
};

const qualityCheck = (
  policy: OcrQualityPolicyV1,
  keyFields: readonly OcrKeyFieldV1[],
  layout: LayoutNormalizationV1,
  items: readonly OcrItemV1[],
): {
  readonly metrics: OcrQualityMetricV1[];
  readonly failures: OcrQualityMetricV1[];
  readonly failedKeyFields: OcrKeyFieldV1[];
} => {
  const metrics: OcrQualityMetricV1[] = [];
  const record = (
    metricId: string,
    observed: number,
    threshold: number,
    pageNumber?: number,
    regionId?: string,
  ): void => {
    metrics.push({
      metricId,
      passed: observed >= threshold,
      observed: Number.isFinite(observed) ? observed : 0,
      threshold,
      ...(pageNumber === undefined ? {} : { pageNumber }),
      ...(regionId === undefined ? {} : { regionId }),
    });
  };
  const pageNumbers = layout.pages.map((page) => page.pageNumber);
  const covered = pageNumbers.length === 0 ? 0 : pageNumbers.length / pageNumbers.at(-1)!;
  record("page-coverage", covered, policy.requiredPageCoverage);
  const nonEmptyPages = layout.perPageText.filter((text) => normalizeText(text).length > 0).length;
  record(
    "non-empty-page-ratio",
    layout.pages.length === 0 ? 0 : nonEmptyPages / layout.pages.length,
    policy.minimumNonEmptyPageRatio,
  );
  const regions = layout.pages.flatMap((page) => page.regions);
  record(
    "valid-region-ratio",
    regions.length === 0
      ? 0
      : regions.filter((region) => region.block.coordinate?.kind === "page").length /
          regions.length,
    policy.minimumValidRegionRatio,
  );
  record(
    "reading-order-ratio",
    regions.length === 0
      ? 0
      : regions.filter((region) => region.block.locator !== undefined).length / regions.length,
    policy.minimumReadingOrderRatio,
  );
  record(
    "mean-service-confidence",
    mean(items.map((item) => item.score)),
    policy.minimumMeanServiceConfidence,
  );
  if (policy.minimumRegionConfidence !== undefined) {
    record(
      "minimum-region-confidence",
      layout.regionConfidences.length === 0 ? 0 : Math.min(...layout.regionConfidences),
      policy.minimumRegionConfidence,
    );
  }
  if (policy.requireCompleteTableCells) {
    const tables = layout.pages.flatMap((page) => page.tables);
    const incomplete = tables.filter((table) => !table.complete);
    record(
      "complete-table-cells",
      tables.length === 0 ? 1 : (tables.length - incomplete.length) / tables.length,
      1,
    );
  }
  const failedKeyFields = keyFields.filter((field) => {
    const block = layout.blocks.find(
      (candidate) =>
        candidate.blockId === field.regionId &&
        candidate.coordinate?.kind === "page" &&
        candidate.coordinate.pageNumber === field.pageNumber,
    );
    const matched =
      block !== undefined && normalizeText(block.text).includes(normalizeText(field.expectedText));
    return !matched;
  });
  if (keyFields.length > 0) {
    record(
      "key-field-coverage",
      (keyFields.length - failedKeyFields.length) / keyFields.length,
      policy.minimumKeyFieldCoverage,
      failedKeyFields[0]?.pageNumber,
      failedKeyFields[0]?.regionId,
    );
  }
  return {
    metrics,
    failures: metrics.filter((metric) => !metric.passed),
    failedKeyFields,
  };
};

interface SlotsV1 {
  acquire(signal: AbortSignal, callerSignal: AbortSignal | undefined): Promise<void>;
  release(): void;
}

const createSlots = (maxConcurrent: number, maxQueued: number): SlotsV1 => {
  let active = 0;
  const waiting: Array<{ readonly resume: () => void; readonly cancel: () => void }> = [];
  return {
    async acquire(signal, callerSignal): Promise<void> {
      const controlFailure = () =>
        callerSignal?.aborted === true
          ? ocrFailure("OCR_CANCELLED", { message: "ocr request was cancelled by the caller" })
          : ocrFailure("OCR_TIMEOUT", { message: "ocr request exceeded the frozen timeout" });
      if (signal.aborted) throw controlFailure();
      if (active < maxConcurrent) {
        active += 1;
        return;
      }
      if (waiting.length >= maxQueued) {
        throw ocrFailure("OCR_SERVICE_RATE_LIMITED", {
          message: "ocr request queue is saturated",
        });
      }
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          resume: () => {
            signal.removeEventListener("abort", waiter.cancel);
            resolve();
          },
          cancel: () => {
            const index = waiting.indexOf(waiter);
            if (index >= 0) waiting.splice(index, 1);
            reject(controlFailure());
          },
        };
        waiting.push(waiter);
        signal.addEventListener("abort", waiter.cancel, { once: true });
      });
    },
    release(): void {
      const next = waiting.shift();
      if (next === undefined) active -= 1;
      else next.resume();
    },
  };
};

const readBounded = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw ocrFailure("OCR_BUDGET_EXCEEDED", {
        message: "ocr response exceeds the frozen byte budget",
        observedBytes: size,
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const asControlFailure = (error: unknown, callerSignal: AbortSignal | undefined): never => {
  if (callerSignal?.aborted === true) {
    throw ocrFailure("OCR_CANCELLED", { message: "ocr request was cancelled by the caller" });
  }
  if (error instanceof OcrLayoutParserError) throw error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    throw ocrFailure("OCR_TIMEOUT", { message: "ocr request exceeded the frozen timeout" });
  }
  throw ocrFailure("OCR_SERVICE_UNAVAILABLE", { message: "ocr service cannot be reached" });
};

const holdFor = async (
  delayMs: number,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
): Promise<void> => {
  if (delayMs > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  if (signal.aborted) {
    if (callerSignal?.aborted === true) {
      throw ocrFailure("OCR_CANCELLED", { message: "ocr request was cancelled by the caller" });
    }
    throw ocrFailure("OCR_TIMEOUT", { message: "ocr request exceeded the frozen timeout" });
  }
};

export interface PaddleOcrLayoutParserOptionsV1 {
  readonly config: unknown;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

class PaddleOcrLayoutParser implements OcrLayoutParserV1 {
  readonly #config: PaddleOcrLayoutConfigV1;
  readonly #deployment: PaddleOcrDeploymentConfigV1;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #slots: SlotsV1;

  constructor(options: PaddleOcrLayoutParserOptionsV1) {
    this.#config = parsePaddleOcrLayoutConfig(options.config);
    this.#deployment = this.#config.deployment;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#slots = createSlots(
      this.#deployment.maxConcurrentRequests,
      this.#deployment.maxQueuedRequests,
    );
  }

  async parse(request: OcrLayoutParserRequestV1): Promise<OcrLayoutParserOutcomeV1> {
    const { command } = request;
    const deployment = this.#deployment;
    const matches = (
      left: { entityId: string; versionId: string },
      right: { entityId: string; versionId: string },
    ): boolean => left.entityId === right.entityId && left.versionId === right.versionId;
    if (
      !matches(command.converterDeploymentRef, deployment.deploymentRef) ||
      !matches(command.qualityPolicyRef, this.#config.quality.policyRef)
    ) {
      throw ocrFailure("OCR_DEPLOYMENT_MISMATCH", {
        message: "conversion references do not match the frozen OCR deployment and quality policy",
      });
    }
    if (command.input.kind !== "ocr-layout") {
      throw ocrFailure("OCR_INPUT_INVALID", {
        message: "ocr parser received a non-OCR input kind",
      });
    }
    const fileType = MEDIA_TYPE_FILE_TYPES[command.mediaType];
    if (fileType === undefined) {
      throw ocrFailure("OCR_MEDIA_TYPE_UNSUPPORTED", {
        message: "media type is not a supported scanned document type",
      });
    }
    const inputLimit = Math.min(deployment.maxInputBytes, request.resourcePolicy.maxInputBytes);
    if (request.bytes.byteLength === 0 || request.bytes.byteLength > inputLimit) {
      throw ocrFailure("OCR_INPUT_INVALID", {
        message: "scanned input is empty or exceeds the frozen input budget",
        observedBytes: request.bytes.byteLength,
      });
    }
    const remainingMs = Date.parse(command.deadlineAt) - this.#now().getTime();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      throw ocrFailure("OCR_TIMEOUT", {
        message: "conversion deadline has already elapsed",
      });
    }
    const signals: AbortSignal[] = [
      AbortSignal.timeout(Math.min(deployment.requestTimeoutMs, remainingMs)),
    ];
    if (request.signal !== undefined) signals.push(request.signal);
    const signal = AbortSignal.any(signals);
    await this.#slots.acquire(signal, request.signal);
    try {
      const parents: PersistedOcrRawResponseV1[] = [];
      let lastFailure: unknown;
      for (let attempt = 1; attempt <= deployment.maxAttempts; attempt += 1) {
        try {
          return await this.#attempt(request, fileType, attempt, signal, parents);
        } catch (error) {
          if (
            !(error instanceof OcrLayoutParserError) ||
            error.stage !== "service" ||
            !error.retryable
          ) {
            throw error;
          }
          lastFailure = new OcrLayoutParserError({
            code: error.code,
            stage: error.stage,
            retryable: true,
            message: error.message,
            parents: [...parents.map((item) => item.artifactRef), ...error.parents],
            evidence: error.evidence,
            ...(error.diagnostic === undefined ? {} : { diagnostic: error.diagnostic }),
            ...(error.sourceSegmentId === undefined
              ? {}
              : { sourceSegmentId: error.sourceSegmentId }),
            ...(error.observedBytes === undefined ? {} : { observedBytes: error.observedBytes }),
          });
          if (attempt < deployment.maxAttempts) {
            await holdFor(deployment.retryDelayMs, signal, request.signal);
          }
        }
      }
      throw (
        lastFailure ?? ocrFailure("OCR_SERVICE_UNAVAILABLE", { message: "ocr attempts exhausted" })
      );
    } finally {
      this.#slots.release();
    }
  }

  async #send(
    body: unknown,
    signal: AbortSignal,
    callerSignal: AbortSignal | undefined,
  ): Promise<{ readonly response: Response; readonly bytes: Uint8Array }> {
    try {
      const response = await this.#fetch(`${this.#deployment.baseUrl}/layout-parsing`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      return { response, bytes: await readBounded(response, this.#deployment.maxResponseBytes) };
    } catch (error) {
      return asControlFailure(error, callerSignal);
    }
  }

  async #attempt(
    request: OcrLayoutParserRequestV1,
    fileType: 0 | 1,
    attempt: number,
    signal: AbortSignal,
    parents: PersistedOcrRawResponseV1[],
  ): Promise<OcrLayoutParserOutcomeV1> {
    const { command, source } = request;
    const deployment = this.#deployment;
    const startedAt = this.#now().toISOString();
    const body = PaddleLayoutRequestV1Schema.parse({
      file: Buffer.from(request.bytes).toString("base64"),
      fileType,
      visualize: false,
      returnMarkdownImages: false,
    });
    const { response, bytes: responseBytes } = await this.#send(body, signal, request.signal);
    let persisted: PersistedOcrRawResponseV1;
    try {
      persisted = await request.persistRawResponse({
        attempt,
        httpStatus: response.status,
        maxBytes: deployment.maxResponseBytes,
        bytes: responseBytes,
        trace: toJsonValue(
          OcrTraceV1Schema.parse({
            schemaVersion: "1",
            conversionId: command.conversionId,
            deploymentRef: deployment.deploymentRef,
            serviceBuildRef: deployment.serviceBuildRef,
            pipelineRef: deployment.pipelineRef,
            modelVersionRefs: deployment.modelVersionRefs,
            resourceAllocationRef: deployment.resourceAllocationRef,
            retryPolicyRef: deployment.retryPolicyRef,
            qualityPolicyRef: this.#config.quality.policyRef,
            protocolVersion: OCR_LAYOUT_PROTOCOL_VERSION_V1,
            attempt,
            httpStatus: response.status,
            inputBytes: request.bytes.byteLength,
            responseBytes: responseBytes.byteLength,
            pageCount: 0,
            regionCount: 0,
            tableCount: 0,
            cellCount: 0,
            startedAt,
            completedAt: this.#now().toISOString(),
            metrics: [],
          }),
        ),
      });
    } catch {
      throw ocrFailure("OCR_ARTIFACT_PERSISTENCE_FAILED", {
        message: "raw ocr response could not be durably stored and re-read",
        parents: parents.map((item) => item.artifactRef),
        observedBytes: responseBytes.byteLength,
      });
    }
    parents.push(persisted);
    const parentRefs = parents.map((item) => item.artifactRef);
    if (response.status === 429) {
      throw ocrFailure("OCR_SERVICE_RATE_LIMITED", {
        message: "ocr service reported rate limiting",
        parents: parentRefs,
      });
    }
    if (response.status >= 500) {
      throw ocrFailure("OCR_SERVICE_UNAVAILABLE", {
        message: "ocr service returned a server error",
        parents: parentRefs,
      });
    }
    if (response.status !== 200) {
      throw ocrFailure("OCR_PROTOCOL_INVALID", {
        message: "ocr service returned an unexpected status",
        parents: parentRefs,
        diagnostic: { httpStatus: response.status },
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(persisted.bytes));
    } catch {
      throw ocrFailure("OCR_PROTOCOL_INVALID", {
        message: "ocr service response is not JSON",
        parents: parentRefs,
      });
    }
    const parsed = PaddleLayoutResponseV1Schema.safeParse(payload);
    if (!parsed.success) {
      throw ocrFailure("OCR_PROTOCOL_INVALID", {
        message: "ocr service response does not match the frozen protocol view",
        parents: parentRefs,
      });
    }
    if (parsed.data.errorCode !== 0) {
      throw ocrFailure("OCR_PROTOCOL_INVALID", {
        message: "ocr service reported a non-success error code",
        parents: parentRefs,
        diagnostic: { errorCode: parsed.data.errorCode },
      });
    }
    const items = parsed.data.result.layoutParsingResults.flatMap((page) => ocrItems(page));
    const layout = normalizeLayout(parsed.data.result, fileType, deployment.maxPages);
    const quality = qualityCheck(this.#config.quality, this.#config.keyFields, layout, items);
    if (quality.failures.length > 0) {
      throw ocrFailure("OCR_QUALITY_BLOCKED", {
        message: "ocr output did not reach the frozen quality policy",
        parents: parentRefs,
        diagnostic: { metrics: quality.metrics, failedKeyFields: quality.failedKeyFields },
      });
    }
    return {
      parsedDocument: ParsedDocumentV1Schema.parse({
        schemaVersion: "1",
        inputKind: "ocr-layout",
        sourceVersionRef: source.sourceVersionRef,
        sourceArtifactRef: source.sourceArtifactRef,
        sourceId: source.sourceId,
        spatialScopeRefs: source.spatialScopeRefs,
        metadata: {
          projectId: source.projectId,
          sourceId: source.sourceId,
          sourceItemId: source.sourceItemId,
          mediaType: command.mediaType,
        },
        blocks: layout.blocks,
        pageExtents: layout.pageExtents,
        inputBytes: request.bytes.byteLength,
      }),
      additionalParentArtifactRefs: parentRefs,
      additionalEvidenceReferences: layout.segmentIdentities.map((identity) => ({
        locator: {
          sourceSegmentId: makeSourceSegmentId(
            source.sourceId,
            identity.chapterId,
            identity.segmentId,
          ),
        },
        sourceVersion: source.sourceVersionRef.reference,
      })),
      diagnostic: toJsonValue({
        pageCount: layout.pages.length,
        regionCount: layout.regionCount,
        tableCount: layout.tableCount,
        cellCount: layout.cellCount,
        declaredPageCount: layout.declaredPageCount ?? null,
        attempt,
        httpStatus: response.status,
        metrics: quality.metrics,
        failedKeyFields: quality.failedKeyFields,
      }),
    };
  }
}

export const createPaddleOcrLayoutParser = (
  options: PaddleOcrLayoutParserOptionsV1,
): OcrLayoutParserV1 => new PaddleOcrLayoutParser(options);
