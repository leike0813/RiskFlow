import { inflateSync } from "node:zlib";

import type {
  DocumentPageExtentV1,
  ParsedDocumentV1,
} from "@riskflow/core/engineering-data/document-conversion";
import type { JsonValue } from "@riskflow/core/persistence";

import {
  DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
  DocumentParserError,
  parseResourcePolicy,
  type DocumentConversionResourcePolicyV1,
} from "../schema.js";
import {
  DocumentServiceParserError,
  type DocumentServiceParserRequestV1,
} from "../structured-document-converter.js";
import { parseDocx } from "../parsers.js";

export interface MineruSourceInfoV1 {
  readonly pageCount?: number;
  readonly pageExtents?: readonly DocumentPageExtentV1[];
  readonly docx?: ParsedDocumentV1;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const sourceFailure = (
  code: string,
  diagnostic: Record<string, JsonValue>,
): DocumentServiceParserError =>
  new DocumentServiceParserError({
    code,
    stage: "input",
    retryable: false,
    diagnostic: { failure: diagnostic },
  });

const uint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    value = crc32Table[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const pngDecodedLength = (
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
): number => {
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channelCount = channels[colorType];
  if (channelCount === undefined)
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "color-type" });
  const passes =
    interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  let size = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.max(0, Math.ceil((width - x0!) / dx!));
    const passHeight = Math.max(0, Math.ceil((height - y0!) / dy!));
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * channelCount * bitDepth) / 8);
    size += (rowBytes + 1) * passHeight;
    if (!Number.isSafeInteger(size))
      throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "decoded-size" });
  }
  return size;
};

const inspectPng = (
  bytes: Uint8Array,
  policy: DocumentConversionResourcePolicyV1,
): { width: number; height: number } => {
  if (bytes.length < 45 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "signature-or-length" });
  }
  let offset: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let seenHeader = false;
  let seenData = false;
  let seenEnd = false;
  const compressed: Uint8Array[] = [];
  let compressedLength = 0;
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      throw sourceFailure("MINERU_IMAGE_INVALID", {
        format: "png",
        issue: "truncated-chunk",
        offset,
      });
    }
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (crc32(bytes, offset + 4, dataEnd) !== uint32(bytes, dataEnd)) {
      throw sourceFailure("MINERU_IMAGE_INVALID", {
        format: "png",
        issue: "chunk-checksum",
        chunk: type,
      });
    }
    if (!seenHeader && type !== "IHDR")
      throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "header-order" });
    if (type === "IHDR") {
      if (seenHeader || length !== 13)
        throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "header" });
      width = uint32(bytes, dataStart);
      height = uint32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      if (
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        bytes[dataStart + 12]! > 1
      ) {
        throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "header-method" });
      }
      interlace = bytes[dataStart + 12]!;
      const validDepths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!validDepths[colorType]?.includes(bitDepth) || width === 0 || height === 0) {
        throw sourceFailure("MINERU_IMAGE_INVALID", {
          format: "png",
          issue: "dimensions-or-depth",
        });
      }
      seenHeader = true;
    } else if (type === "IDAT") {
      if (seenEnd || compressedLength + length > policy.maxInputBytes) {
        throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "data-limit" });
      }
      seenData = true;
      compressed.push(bytes.subarray(dataStart, dataEnd));
      compressedLength += length;
    } else if (type === "IEND") {
      if (length !== 0 || !seenData)
        throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "end" });
      seenEnd = true;
      offset = end;
      break;
    } else if ((bytes[offset + 4]! & 0x20) === 0 && !["PLTE"].includes(type)) {
      throw sourceFailure("MINERU_IMAGE_INVALID", {
        format: "png",
        issue: "unknown-critical-chunk",
        chunk: type,
      });
    }
    offset = end;
  }
  if (!seenHeader || !seenData || !seenEnd || offset !== bytes.length) {
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "incomplete-file" });
  }
  const expectedLength = pngDecodedLength(width, height, bitDepth, colorType, interlace);
  if (expectedLength > policy.maxZipUncompressedBytes) {
    throw sourceFailure("MINERU_IMAGE_LIMIT_EXCEEDED", { format: "png", issue: "decoded-size" });
  }
  let decoded: Uint8Array;
  try {
    decoded = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: policy.maxZipUncompressedBytes,
    });
  } catch {
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "compressed-data" });
  }
  if (decoded.byteLength !== expectedLength) {
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "png", issue: "pixel-data-length" });
  }
  return { width, height };
};

const inspectJpeg = (
  bytes: Uint8Array,
  policy: DocumentConversionResourcePolicyV1,
): { width: number; height: number } => {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "signature-or-end" });
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let seenScan = false;
  let seenEnd = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff)
      throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "marker", offset });
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) {
      seenEnd = true;
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length)
      throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "truncated-marker" });
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length)
      throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "segment-length" });
    const data = offset + 2;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8)
        throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "frame-header" });
      height = (bytes[data + 1]! << 8) | bytes[data + 2]!;
      width = (bytes[data + 3]! << 8) | bytes[data + 4]!;
      if (width === 0 || height === 0)
        throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "dimensions" });
    }
    offset += length;
    if (marker !== 0xda) continue;
    seenScan = true;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      while (bytes[offset] === 0xff) offset += 1;
      const next = bytes[offset]!;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        offset += 1;
        continue;
      }
      if (next === 0xd9) {
        offset += 1;
        seenEnd = true;
        break;
      }
      offset -= 1;
      break;
    }
    if (seenEnd) break;
  }
  if (!seenScan || !seenEnd || width === 0 || height === 0 || offset !== bytes.length) {
    throw sourceFailure("MINERU_IMAGE_INVALID", { format: "jpeg", issue: "incomplete-image" });
  }
  if (width * height * 4 > policy.maxZipUncompressedBytes) {
    throw sourceFailure("MINERU_IMAGE_LIMIT_EXCEEDED", { format: "jpeg", issue: "decoded-size" });
  }
  return { width, height };
};

const pdfPageCount = async (
  bytes: Uint8Array,
  policy: DocumentConversionResourcePolicyV1,
): Promise<number> => {
  if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw sourceFailure("MINERU_PDF_INVALID", { issue: "header" });
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > policy.maxPdfPages) {
      throw sourceFailure("MINERU_PDF_LIMIT_EXCEEDED", {
        issue: "page-count",
        pageCount: pdf.numPages,
        maximum: policy.maxPdfPages,
      });
    }
    return pdf.numPages;
  } catch (error) {
    if (error instanceof DocumentServiceParserError) throw error;
    const name = error instanceof Error ? error.name : "";
    throw sourceFailure(
      name === "PasswordException" ? "MINERU_PDF_ENCRYPTED" : "MINERU_PDF_INVALID",
      { issue: name === "PasswordException" ? "encrypted" : "parse" },
    );
  } finally {
    await loading.destroy();
  }
};

export const preflightMineruSource = async (
  request: DocumentServiceParserRequestV1,
): Promise<MineruSourceInfoV1> => {
  const policy = parseResourcePolicy(
    request.resourcePolicy ?? DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
  );
  if (request.bytes.byteLength === 0 || request.bytes.byteLength > policy.maxInputBytes) {
    throw sourceFailure("MINERU_INPUT_LIMIT_EXCEEDED", {
      observedBytes: request.bytes.byteLength,
      maximum: policy.maxInputBytes,
    });
  }
  const mediaType = request.command.mediaType;
  if (mediaType === "application/pdf") {
    return { pageCount: await pdfPageCount(request.bytes, policy) };
  }
  if (mediaType === "image/png" || mediaType === "image/jpeg") {
    const dimensions =
      mediaType === "image/png"
        ? inspectPng(request.bytes, policy)
        : inspectJpeg(request.bytes, policy);
    return {
      pageCount: 1,
      pageExtents: [{ pageNumber: 1, ...dimensions, coordinateSystem: "pixel-top-left" }],
    };
  }
  if (
    mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
    request.command.input.kind === "docx"
  ) {
    try {
      const docx = parseDocx(
        request.bytes,
        {
          source: request.source,
          inputKind: "docx",
          mediaType,
        },
        policy,
      );
      if (docx.blocks.length === 0)
        throw new DocumentParserError("DOCUMENT_STRUCTURE_INVALID", "DOCX has no source structure");
      return { docx };
    } catch (error) {
      if (error instanceof DocumentServiceParserError) throw error;
      throw sourceFailure("MINERU_DOCX_SOURCE_INVALID", {
        parserCode: error instanceof DocumentParserError ? error.code : "DOCX_PARSE_FAILED",
      });
    }
  }
  throw sourceFailure("MINERU_INPUT_INVALID", { issue: "unsupported-media-type", mediaType });
};
