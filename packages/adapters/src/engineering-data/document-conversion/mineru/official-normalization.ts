import { z } from "@riskflow/core/model";
import type { ParsedDocumentV1 } from "@riskflow/core/engineering-data/document-conversion";
import type { JsonValue } from "@riskflow/core/persistence";

import {
  DocumentServiceParserError,
  type DocumentServiceParserRequestV1,
} from "../structured-document-converter.js";
import { normalizeMineruMiddle } from "./normalization.js";
import type { MineruConfigV1 } from "./schema.js";
import type { MineruSourceInfoV1 } from "./source.js";

const number = z.number().finite();
const box = z.tuple([number, number, number, number]);
const span = z.object({
  type: z.enum(["text", "table", "image", "inline_equation", "interline_equation"]),
  content: z.string().max(200_000).optional(),
  html: z.string().max(200_000).optional(),
  bbox: box.optional(),
  image_path: z.string().max(200_000).optional(),
  cross_page: z.boolean().optional(),
  score: number.min(0).max(1).optional(),
});
const line = z.object({ bbox: box.optional(), spans: z.array(span).max(10_000) });
type OfficialBlock = {
  type: string;
  index: number;
  bbox?: [number, number, number, number] | undefined;
  level?: number | undefined;
  angle?: number | undefined;
  merge_prev?: boolean | undefined;
  lines_deleted?: boolean | undefined;
  lines?:
    | {
        bbox?: [number, number, number, number] | undefined;
        spans: z.infer<typeof span>[];
      }[]
    | undefined;
  blocks?: OfficialBlock[] | undefined;
};
const block: z.ZodType<OfficialBlock> = z.lazy(() =>
  z.object({
    type: z.enum([
      "text",
      "title",
      "interline_equation",
      "table",
      "table_body",
      "table_caption",
      "table_footnote",
      "image",
      "image_body",
      "image_caption",
      "image_footnote",
    ]),
    index: z.number().int().nonnegative().safe(),
    bbox: box.optional(),
    level: z.number().int().positive().max(64).optional(),
    angle: number.optional(),
    merge_prev: z.boolean().optional(),
    lines_deleted: z.boolean().optional(),
    lines: z.array(line).max(10_000).optional(),
    blocks: z.array(block).max(10_000).optional(),
  }),
);
const layout = z.object({
  _version_name: z.literal("3.4.4"),
  _backend: z.enum(["hybrid", "office"]),
  pdf_info: z
    .array(
      z.object({
        page_idx: z.number().int().nonnegative().safe(),
        page_size: z.tuple([number.positive(), number.positive()]).optional(),
        para_blocks: z.array(block).max(10_000),
        preproc_blocks: z.array(block).max(10_000).optional(),
        discarded_blocks: z.array(z.unknown()).max(10_000).optional(),
      }),
    )
    .min(1)
    .max(10_000),
});

const invalid = (detail: string): never => {
  throw new DocumentServiceParserError({
    code: "MINERU_PROTOCOL_INVALID",
    stage: "protocol",
    retryable: false,
    diagnostic: { format: "official-layout-3.4.4", detail },
  });
};

/** 官网 v4 实测布局映射到共享规范化输入；协议身份仍保留官网版本。 */
export const normalizeOfficialMineruLayout = (
  value: unknown,
  request: DocumentServiceParserRequestV1,
  config: MineruConfigV1,
  source: MineruSourceInfoV1,
): { parsedDocument: ParsedDocumentV1; diagnostic: JsonValue } => {
  const parsed = layout.safeParse(value);
  if (!parsed.success) return invalid("layout-schema");
  const document = parsed.data;
  if (document.pdf_info.length > request.resourcePolicy.maxPdfPages) return invalid("page-budget");
  const office = request.command.input.kind === "docx";
  if ((document._backend === "office") !== office) return invalid("backend-input-mismatch");
  let observedBlocks = 0;
  let observedInputBlocks = 0;
  let scoredSpans = 0;
  let preprocPages = 0;
  let paraPages = 0;
  let noBodyPages = 0;
  const pages = document.pdf_info.map((page) => {
    const size = page.page_size;
    if (!office && size === undefined) return invalid("page-size-missing");
    const hasPreprocBlocks = Object.hasOwn(page, "preproc_blocks");
    const selectedBlocks = !office && hasPreprocBlocks ? page.preproc_blocks! : page.para_blocks;
    if (!office && hasPreprocBlocks) preprocPages++;
    else paraPages++;
    if (selectedBlocks.length === 0) noBodyPages++;

    const validateCollection = (items: OfficialBlock[], depth = 0): boolean => {
      let priorIndex = -1;
      let hasCrossPageMarkers = false;
      for (const current of items) {
        observedInputBlocks++;
        // The input budget covers both official representations: preproc and para.
        if (depth > 3 || observedInputBlocks > request.resourcePolicy.maxOutputBlocks * 2)
          return invalid("input-block-budget");
        if (current.index <= priorIndex) return invalid("block-index-order");
        priorIndex = current.index;
        hasCrossPageMarkers ||=
          current.lines_deleted === true ||
          (current.lines ?? []).some((currentLine) =>
            currentLine.spans.some((currentSpan) => currentSpan.cross_page === true),
          );
        const validateBbox = (value: readonly number[] | undefined): void => {
          if (value === undefined) return;
          if (office) return;
          if (size === undefined) return invalid("page-size-missing");
          const [left, top, right, bottom] = value;
          if (
            left! < 0 ||
            top! < 0 ||
            right! <= left! ||
            bottom! <= top! ||
            right! > size[0] ||
            bottom! > size[1]
          )
            return invalid("bbox-bounds");
        };
        validateBbox(current.bbox);
        for (const currentLine of current.lines ?? []) {
          validateBbox(currentLine.bbox);
          for (const currentSpan of currentLine.spans) validateBbox(currentSpan.bbox);
        }
        if (current.blocks !== undefined) {
          const childHasCrossPageMarkers = validateCollection(current.blocks, depth + 1);
          hasCrossPageMarkers ||= childHasCrossPageMarkers;
        }
      }
      return hasCrossPageMarkers;
    };
    const paraHasCrossPageMarkers = validateCollection(page.para_blocks);
    if (hasPreprocBlocks) validateCollection(page.preproc_blocks!);
    if (!office && !hasPreprocBlocks && paraHasCrossPageMarkers)
      return invalid("original-page-blocks-missing");

    const mapBlock = (current: OfficialBlock, depth: number): Record<string, unknown> => {
      observedBlocks++;
      if (depth > 3 || observedBlocks > request.resourcePolicy.maxOutputBlocks)
        return invalid("block-budget");
      const spans = (current.lines ?? []).flatMap((line) => line.spans);
      scoredSpans += spans.filter((item) => item.score !== undefined).length;
      let bbox: number[] | undefined;
      if (!office) {
        if (current.bbox === undefined || size === undefined) return invalid("bbox-missing");
        const [left, top, right, bottom] = current.bbox;
        if (
          left < 0 ||
          top < 0 ||
          right <= left ||
          bottom <= top ||
          right > size[0] ||
          bottom > size[1]
        )
          return invalid("bbox-bounds");
        bbox = [left / size[0], top / size[1], right / size[0], bottom / size[1]];
      }
      const common = { index: current.index, ...(bbox === undefined ? {} : { bbox }) };
      if (current.type === "table" || current.type === "image") {
        if (current.blocks === undefined || current.blocks.length === 0)
          return invalid("container-empty");
        return {
          ...common,
          type: current.type,
          content: current.blocks.map((child) => mapBlock(child, depth + 1)),
        };
      }
      if (current.type === "table_body") {
        if (spans.length !== 1 || spans[0]?.type !== "table" || spans[0].html === undefined)
          return invalid("table-html");
        return { ...common, type: "table_body", content: spans[0].html };
      }
      if (current.type === "image_body") {
        if (spans.length === 0 || spans.some((item) => item.type !== "image"))
          return invalid("image-body");
        return { ...common, type: "image_body", content: "" };
      }
      const content = (current.lines ?? []).flatMap((line, lineIndex) => [
        ...(lineIndex === 0 ? [] : [{ type: "text", content: "\n" }]),
        ...line.spans.map((item) => {
          if (
            !["text", "inline_equation", "interline_equation"].includes(item.type) ||
            item.content === undefined
          )
            return invalid("text-span");
          return item.type === "text"
            ? { type: "text", content: item.content }
            : { type: "equation_inline", content: item.content };
        }),
      ]);
      return {
        ...common,
        type:
          current.type === "title"
            ? "paragraph_title"
            : current.type === "interline_equation"
              ? "equation"
              : current.type,
        ...(current.level === undefined ? {} : { level: current.level }),
        content,
      };
    };
    return { page_idx: page.page_idx, blocks: selectedBlocks.map((item) => mapBlock(item, 0)) };
  });
  const normalized = normalizeMineruMiddle(
    {
      schema: "docvortex.middle",
      schema_version: "2.0",
      is_full_document: true,
      metadata: { producer: { name: "mineru", version: document._version_name } },
      extensions: {
        mineru: { tier: office ? "flash" : "standard", parse_mode: office ? "txt" : "ocr" },
        ...(!office
          ? {
              docvortex_layout: {
                version: 1,
                pages: document.pdf_info.map((page) => ({
                  page_idx: page.page_idx,
                  width_pt: page.page_size![0],
                  height_pt: page.page_size![1],
                })),
              },
            }
          : {}),
      },
      pages,
    },
    request,
    config,
    source,
  );
  return {
    parsedDocument: normalized.parsedDocument,
    diagnostic: {
      normalization: normalized.diagnostic,
      sourceFormat: "official-layout-3.4.4",
      producerVersion: document._version_name,
      backend: document._backend,
      modelRevision: null,
      serviceBuild: null,
      discardedRegionCount: document.pdf_info.reduce(
        (sum, page) => sum + (page.discarded_blocks?.length ?? 0),
        0,
      ),
      serviceSpanScoreCount: scoredSpans,
      pageBlockSourceCounts: { preprocPages, paraPages, noBodyPages },
      blockConfidence: "not-provided",
      perCellGeometry: "not-provided",
    },
  };
};
