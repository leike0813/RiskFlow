import { posix } from "node:path";

import exceljs from "exceljs";
import { parse as parseCsvRecords } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

import {
  type NormalizedBlockV1,
  type ParsedDocumentV1,
  type DocumentInputKindV1,
} from "@riskflow/core/engineering-data/document-conversion";

import {
  DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
  DocumentParserError,
  type DocumentConversionResourcePolicyV1,
  type DocumentParserContextV1,
  parseResourcePolicy,
} from "./schema.js";

const { Workbook } = exceljs;
const XML_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: false,
} as const;

const mediaTypes: Record<DocumentInputKindV1, readonly string[]> = {
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  "text-pdf": ["application/pdf"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/csv"],
  "ocr-layout": ["application/json", "application/vnd.riskflow.ocr-layout+json"],
};

const ensureContext = (context: DocumentParserContextV1): void => {
  if (!mediaTypes[context.inputKind].includes(context.mediaType)) {
    throw new DocumentParserError("MEDIA_TYPE_UNSUPPORTED", "media type does not match input kind");
  }
};

const bytesText = (bytes: Uint8Array, maxBytes: number): string => {
  if (bytes.byteLength > maxBytes)
    throw new DocumentParserError("INPUT_LIMIT_EXCEEDED", "input exceeds policy limit");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentParserError("INPUT_ENCODING_INVALID", "input is not valid UTF-8");
  }
};

const base = (
  context: DocumentParserContextV1,
  blocks: readonly NormalizedBlockV1[],
  inputBytes: number,
): ParsedDocumentV1 => {
  const value = {
    schemaVersion: "1" as const,
    inputKind: context.inputKind,
    sourceVersionRef: context.source.sourceVersionRef,
    sourceArtifactRef: context.source.sourceArtifactRef,
    sourceId: context.source.sourceId,
    spatialScopeRefs: context.source.spatialScopeRefs,
    metadata: {
      projectId: context.source.projectId,
      sourceId: context.source.sourceId,
      sourceItemId: context.source.sourceItemId,
      mediaType: context.mediaType,
    },
    blocks: [...blocks],
    inputBytes,
  };
  return value;
};

const blockId = (kind: string, ...parts: readonly (string | number)[]): string =>
  `${kind}-${parts.map((part) => String(part).replace(/[^A-Za-z0-9_]/gu, "_")).join("-")}`;

type XmlNode = Record<string, unknown>;

const xmlEntries = (
  node: unknown,
): Array<{ name: string; value: unknown; attributes: Record<string, string> }> => {
  if (!Array.isArray(node)) return [];
  const result: Array<{ name: string; value: unknown; attributes: Record<string, string> }> = [];
  for (const item of node) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    for (const [name, value] of Object.entries(item as XmlNode)) {
      if (name === ":@") continue;
      const attributesValue = (item as XmlNode)[":@"];
      const attributes: Record<string, string> = {};
      if (typeof attributesValue === "object" && attributesValue !== null) {
        for (const [key, attribute] of Object.entries(attributesValue)) {
          if (typeof attribute === "string") attributes[key] = attribute;
        }
      }
      result.push({ name, value, attributes });
    }
  }
  return result;
};

const localName = (name: string): string =>
  name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;

const findXmlChildren = (node: unknown, expected: string): unknown[] => {
  return findXmlEntries(node, expected).map((entry) => entry.value);
};

const findXmlEntries = (
  node: unknown,
  expected: string,
): Array<{ name: string; value: unknown; attributes: Record<string, string> }> => {
  const found: Array<{ name: string; value: unknown; attributes: Record<string, string> }> = [];
  const visit = (current: unknown): void => {
    for (const entry of xmlEntries(current)) {
      if (localName(entry.name) === expected) found.push(entry);
      visit(entry.value);
    }
  };
  visit(node);
  return found;
};

const collectXmlText = (node: unknown): string => {
  const pieces: string[] = [];
  const visit = (current: unknown): void => {
    for (const entry of xmlEntries(current)) {
      if (localName(entry.name) === "t") {
        if (typeof entry.value === "string") pieces.push(entry.value);
        else if (Array.isArray(entry.value)) {
          for (const textNode of entry.value) {
            if (typeof textNode === "string") pieces.push(textNode);
            else if (typeof textNode === "object" && textNode !== null) {
              for (const [key, value] of Object.entries(textNode)) {
                if (localName(key) === "#text" && typeof value === "string") pieces.push(value);
              }
            }
          }
        }
      } else visit(entry.value);
    }
  };
  visit(node);
  return pieces.join("");
};

const hasPageBreak = (node: unknown): boolean => {
  let found = false;
  const visit = (current: unknown): void => {
    if (found) return;
    for (const entry of xmlEntries(current)) {
      if (
        (localName(entry.name) === "br" && entry.attributes["@_w:type"] === "page") ||
        localName(entry.name) === "lastRenderedPageBreak"
      ) {
        found = true;
        return;
      }
      visit(entry.value);
    }
  };
  visit(node);
  return found;
};

const paragraphStyle = (node: unknown): string | undefined => {
  for (const style of findXmlEntries(node, "pStyle")) {
    const value = Object.entries(style.attributes).find(
      ([key]) => key === "@_w:val" || key.endsWith(":val"),
    )?.[1];
    if (value !== undefined) return value;
  }
  return undefined;
};

type DocxStyleInfo = {
  readonly kind: NormalizedBlockV1["kind"];
  readonly headingLevel?: number;
};

const docxStyleMap = (
  entries: Record<string, Uint8Array>,
  policy: DocumentConversionResourcePolicyV1,
): ReadonlyMap<string, DocxStyleInfo> => {
  if (entries["word/styles.xml"] === undefined) return new Map();
  const parsed = parseXmlPart(entries, "word/styles.xml", policy, "XML_INVALID");
  const result = new Map<string, DocxStyleInfo>();
  for (const entry of findXmlEntries(parsed, "style")) {
    const styleId = entry.attributes["@_w:styleId"] ?? entry.attributes["@_styleId"];
    if (styleId === undefined) continue;
    const name = findXmlEntries(entry.value, "name")[0]?.attributes["@_w:val"] ?? "";
    const outline = findXmlEntries(entry.value, "outlineLvl")[0]?.attributes["@_w:val"];
    const label = `${styleId} ${name}`.toLowerCase();
    const headingLevel =
      outline === undefined
        ? Number(/(?:heading|标题)\s*([1-9][0-9]*)/iu.exec(label)?.[1] ?? 0)
        : Number(outline) + 1;
    const kind: DocxStyleInfo["kind"] =
      headingLevel > 0
        ? "heading"
        : /caption|题注|图注|表注/iu.test(label)
          ? "caption"
          : /process|工序|步骤/iu.test(label)
            ? "process-step"
            : "paragraph";
    result.set(styleId, { kind, ...(headingLevel > 0 ? { headingLevel } : {}) });
  }
  return result;
};

const validateXmlSecurity = (text: string): void => {
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) {
    throw new DocumentParserError(
      "XML_EXTERNAL_ENTITY",
      "external XML declarations are not allowed",
    );
  }
};

const isUnsafePackagePart = (name: string): boolean =>
  /(?:^|\/)(?:embeddings|activeX)(?:\/|$)/iu.test(name) || /(?:^|\/)vbaProject\.bin$/iu.test(name);

export const readDocumentPackage = (
  bytes: Uint8Array,
  policy: DocumentConversionResourcePolicyV1,
  requiredEntry: string,
): Record<string, Uint8Array> => {
  let entries: Record<string, Uint8Array>;
  try {
    let entryCount = 0;
    let uncompressedBytes = 0;
    entries = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        uncompressedBytes += file.originalSize;
        if (
          entryCount > policy.maxZipEntries ||
          uncompressedBytes > policy.maxZipUncompressedBytes ||
          file.originalSize > policy.maxZipUncompressedBytes ||
          (file.originalSize > 0 &&
            (file.size === 0 || file.originalSize / file.size > policy.maxZipCompressionRatio))
        ) {
          throw new DocumentParserError(
            "ZIP_LIMIT_EXCEEDED",
            "document package exceeds ZIP resource limits",
          );
        }
        if (/(?:^|\/)(?:EncryptionInfo|EncryptedPackage)$/u.test(file.name)) {
          throw new DocumentParserError(
            "ZIP_ENCRYPTED",
            "encrypted document packages are unsupported",
          );
        }
        if (isUnsafePackagePart(file.name)) {
          throw new DocumentParserError(
            "EMBEDDED_OBJECT_UNSUPPORTED",
            "embedded document objects and code are unsupported",
          );
        }
        if (
          file.name.startsWith("/") ||
          file.name.includes("\\") ||
          file.name.split("/").some((part) => part === "..") ||
          file.name.includes("\0")
        ) {
          throw new DocumentParserError("ZIP_PATH_INVALID", "unsafe document package member");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof DocumentParserError) throw error;
    throw new DocumentParserError("ZIP_INVALID", "document package is not a valid ZIP archive");
  }
  const names = Object.keys(entries);
  const uncompressedBytes = names.reduce((sum, name) => sum + (entries[name]?.byteLength ?? 0), 0);
  if (names.length > policy.maxZipEntries || uncompressedBytes > policy.maxZipUncompressedBytes) {
    throw new DocumentParserError(
      "ZIP_LIMIT_EXCEEDED",
      "document package exceeds ZIP resource limits",
    );
  }
  if (names.some((name) => /(?:^|\/)(?:EncryptionInfo|EncryptedPackage)$/u.test(name))) {
    throw new DocumentParserError("ZIP_ENCRYPTED", "encrypted document packages are unsupported");
  }
  if (names.some(isUnsafePackagePart)) {
    throw new DocumentParserError(
      "EMBEDDED_OBJECT_UNSUPPORTED",
      "embedded document objects and code are unsupported",
    );
  }
  for (const name of names) {
    if (!/\.xml$/iu.test(name)) continue;
    const xml = entries[name];
    if (xml === undefined) continue;
    validateXmlSecurity(bytesText(xml, policy.maxXmlBytes));
  }
  if (requiredEntry.length > 0 && entries[requiredEntry] === undefined) {
    throw new DocumentParserError("DOCUMENT_PART_MISSING", "required document part is missing");
  }
  return entries;
};

const parseXmlPart = (
  entries: Record<string, Uint8Array>,
  name: string,
  policy: DocumentConversionResourcePolicyV1,
  code: string,
): unknown => {
  const bytes = entries[name];
  if (bytes === undefined) throw new DocumentParserError(code, `${name} is missing`);
  const text = bytesText(bytes, policy.maxXmlBytes);
  validateXmlSecurity(text);
  try {
    return new XMLParser(XML_OPTIONS).parse(text);
  } catch {
    throw new DocumentParserError("XML_INVALID", `${name} is invalid`);
  }
};

const validateDocxStructure = (
  entries: Record<string, Uint8Array>,
  policy: DocumentConversionResourcePolicyV1,
): void => {
  const contentTypes = parseXmlPart(
    entries,
    "[Content_Types].xml",
    policy,
    "OOXML_STRUCTURE_INVALID",
  );
  const documentContentType = findXmlEntries(contentTypes, "Override").some(
    (entry) =>
      entry.attributes["@_PartName"] === "/word/document.xml" &&
      entry.attributes["@_ContentType"] ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  );
  if (!documentContentType) {
    throw new DocumentParserError(
      "OOXML_STRUCTURE_INVALID",
      "DOCX main document content type is missing",
    );
  }
  const rootRelationships = parseXmlPart(entries, "_rels/.rels", policy, "OOXML_STRUCTURE_INVALID");
  const officeDocumentRelationship = findXmlEntries(rootRelationships, "Relationship").some(
    (entry) => {
      const target = entry.attributes["@_Target"];
      return (
        entry.attributes["@_Type"]?.endsWith("/officeDocument") === true &&
        target !== undefined &&
        posix.normalize(posix.join(".", target)) === "word/document.xml"
      );
    },
  );
  if (!officeDocumentRelationship) {
    throw new DocumentParserError(
      "OOXML_STRUCTURE_INVALID",
      "DOCX office document relationship is missing",
    );
  }
};

const resolvePackageRelationshipTarget = (basePath: string, target: string): string => {
  const parts = target.startsWith("/") ? [] : basePath.split("/").filter((part) => part !== ".");
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new DocumentParserError("RELATIONSHIP_INVALID", "relationship escapes package root");
      }
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
};

const validateRelationships = (
  entries: Record<string, Uint8Array>,
  policy: DocumentConversionResourcePolicyV1,
): void => {
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".rels")) continue;
    const text = bytesText(bytes, policy.maxXmlBytes);
    validateXmlSecurity(text);
    let parsed: unknown;
    try {
      parsed = new XMLParser(XML_OPTIONS).parse(text);
    } catch {
      throw new DocumentParserError("XML_INVALID", "document relationship XML is invalid");
    }
    for (const entry of findXmlEntries(parsed, "Relationship")) {
      const target = entry.attributes["@_Target"];
      const targetMode = entry.attributes["@_TargetMode"];
      if (
        targetMode === "External" ||
        target === undefined ||
        /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target) ||
        target.includes("\\")
      ) {
        throw new DocumentParserError(
          "RELATIONSHIP_EXTERNAL",
          "external document relationships are unsupported",
        );
      }
      const targetPath = resolvePackageRelationshipTarget(
        posix.dirname(posix.dirname(name)),
        target,
      );
      if (targetPath.startsWith("../") || entries[targetPath] === undefined) {
        throw new DocumentParserError(
          "RELATIONSHIP_INVALID",
          "document relationship target is missing",
        );
      }
    }
  }
};

const pushBlock = (
  blocks: NormalizedBlockV1[],
  block: NormalizedBlockV1,
  policy: DocumentConversionResourcePolicyV1,
): void => {
  if (blocks.length >= policy.maxOutputBlocks) {
    throw new DocumentParserError("OUTPUT_LIMIT_EXCEEDED", "document output exceeds policy limit");
  }
  blocks.push(block);
};

export const parseDocx = (
  bytes: Uint8Array,
  context: DocumentParserContextV1,
  configuredPolicy: DocumentConversionResourcePolicyV1 = DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
): ParsedDocumentV1 => {
  ensureContext(context);
  const policy = parseResourcePolicy(configuredPolicy);
  if (bytes.byteLength > policy.maxInputBytes) {
    throw new DocumentParserError("INPUT_LIMIT_EXCEEDED", "input exceeds policy limit");
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new DocumentParserError("FORMAT_INVALID", "DOCX package is not a ZIP archive");
  }
  const entries = readDocumentPackage(bytes, policy, "word/document.xml");
  validateRelationships(entries, policy);
  validateDocxStructure(entries, policy);
  const styles = docxStyleMap(entries, policy);
  const xmlBytes = entries["word/document.xml"]!;
  const xmlText = bytesText(xmlBytes, policy.maxXmlBytes);
  validateXmlSecurity(xmlText);
  let document: unknown;
  try {
    document = new XMLParser(XML_OPTIONS).parse(xmlText);
  } catch {
    throw new DocumentParserError("XML_INVALID", "DOCX document XML is invalid");
  }
  const body = findXmlChildren(document, "body")[0];
  if (body === undefined)
    throw new DocumentParserError("DOCUMENT_STRUCTURE_INVALID", "DOCX body is missing");
  const blocks: NormalizedBlockV1[] = [];
  let tableNumber = 0;
  let pageNumber = 1;
  let pageKnown = false;
  const headingStack: string[] = [];
  const bodyEntries = xmlEntries(body);
  for (const entry of bodyEntries) {
    if (localName(entry.name) === "p") {
      const text = collectXmlText(entry.value);
      const styleId = paragraphStyle(entry.value);
      const style = styleId?.toLowerCase() ?? "";
      const styleInfo = styleId === undefined ? undefined : styles.get(styleId);
      const kind: NormalizedBlockV1["kind"] =
        styleInfo?.kind ??
        (style.includes("caption")
          ? "caption"
          : style.startsWith("heading")
            ? "heading"
            : style.includes("process")
              ? "process-step"
              : "paragraph");
      const levelMatch = /heading\s*([1-9][0-9]*)/iu.exec(style);
      const headingLevel =
        styleInfo?.headingLevel ?? (levelMatch?.[1] === undefined ? 0 : Number(levelMatch[1]));
      if (kind === "heading" && headingLevel > 0) {
        while (headingStack.length < headingLevel - 1) {
          headingStack.push(`heading_${headingStack.length + 1}`);
        }
        headingStack.length = headingLevel - 1;
        headingStack.push(text.slice(0, 256) || `heading_${headingLevel}`);
      }
      const headingPath = headingStack.length === 0 ? ["document"] : [...headingStack];
      const id = blockId("docx", blocks.length + 1);
      const locator = pageKnown
        ? { kind: "document" as const, pageNumber, headingPath }
        : { kind: "record" as const, dataset: "docx", stableRecordKey: id };
      if (text.length > 0) {
        pushBlock(
          blocks,
          {
            blockId: id,
            kind,
            text,
            headingPath,
            locator,
            chapterId: stableComponent(headingPath[0] ?? "document", "chapter"),
            segmentId: `segment_${blocks.length + 1}`,
          },
          policy,
        );
      }
      if (hasPageBreak(entry.value)) {
        if (!pageKnown) {
          pageKnown = true;
          for (const block of blocks) {
            if (block.locator.kind === "record" && block.locator.dataset === "docx") {
              block.locator = {
                kind: "document",
                pageNumber: 1,
                headingPath: block.headingPath,
              };
            }
          }
        }
        pushBlock(
          blocks,
          {
            blockId: blockId("docx-page-break", blocks.length + 1),
            kind: "page-break",
            text: "",
            headingPath,
            locator: { kind: "document", pageNumber, headingPath },
            chapterId: stableComponent(headingPath[0] ?? "document", "chapter"),
            segmentId: `page_${pageNumber}`,
          },
          policy,
        );
        pageNumber += 1;
      }
    } else if (localName(entry.name) === "tbl") {
      tableNumber += 1;
      const tableId = `table_${tableNumber}`;
      const rows = findXmlChildren(entry.value, "tr");
      const rowCount = rows.length;
      const cellsByRow = rows.map((row) => findXmlChildren(row, "tc"));
      const cellSpan = (cell: unknown): number => {
        const value = findXmlEntries(cell, "gridSpan")[0]?.attributes["@_w:val"] ?? "1";
        if (!/^[1-9][0-9]*$/u.test(value)) {
          throw new DocumentParserError("DOCX_TABLE_INVALID", "invalid source cell span");
        }
        const span = Number(value);
        if (!Number.isSafeInteger(span) || span > policy.maxCells) {
          throw new DocumentParserError("DOCX_TABLE_INVALID", "source cell span exceeds budget");
        }
        return span;
      };
      const colCount = cellsByRow.reduce(
        (max, cells) =>
          Math.max(
            max,
            cells.reduce<number>((count, cell) => count + cellSpan(cell), 0),
          ),
        0,
      );
      if (rowCount * colCount > policy.maxCells) {
        throw new DocumentParserError("DOCX_TABLE_INVALID", "source table exceeds cell budget");
      }
      const chapterId = tableId;
      const segmentId = tableId;
      const tableLocator = {
        kind: "table" as const,
        sheet: "docx",
        table: tableId,
        rowRange: { start: 1, end: Math.max(1, rowCount) },
        columnRange: { start: 1, end: Math.max(1, colCount) },
      };
      pushBlock(
        blocks,
        {
          blockId: blockId("docx-table", tableNumber),
          kind: "table",
          text: "",
          headingPath: [tableId],
          locator: tableLocator,
          chapterId,
          segmentId,
          tableId,
          sheet: "docx",
        },
        policy,
      );
      let activeMerges = new Map<number, NormalizedBlockV1>();
      cellsByRow.forEach((cells, rowIndex) => {
        let column = 1;
        const nextMerges = new Map<number, NormalizedBlockV1>();
        for (const cell of cells) {
          const columnSpan = cellSpan(cell);
          const merge = findXmlEntries(cell, "vMerge")[0];
          if (merge !== undefined && merge.attributes["@_w:val"] !== "restart") {
            const parent = activeMerges.get(column);
            if (
              parent === undefined ||
              parent.columnSpan !== columnSpan ||
              Array.from({ length: columnSpan }, (_, offset) =>
                activeMerges.get(column + offset),
              ).some((item) => item !== parent) ||
              collectXmlText(cell).trim().length > 0
            ) {
              throw new DocumentParserError(
                "DOCX_TABLE_INVALID",
                "invalid vertical merge continuation",
              );
            }
            parent.rowSpan = (parent.rowSpan ?? 1) + 1;
            parent.locator = {
              ...tableLocator,
              rowRange: { start: parent.row!, end: rowIndex + 1 },
              columnRange: { start: column, end: column + columnSpan - 1 },
            };
            parent.coordinate = {
              kind: "cell",
              sheet: "docx",
              row: parent.row!,
              column,
              rowSpan: parent.rowSpan,
              columnSpan,
            };
            for (let offset = 0; offset < columnSpan; offset++)
              nextMerges.set(column + offset, parent);
          } else {
            const normalizedCell: NormalizedBlockV1 = {
              blockId: blockId("docx-cell", tableNumber, rowIndex + 1, column),
              kind: "cell",
              text: collectXmlText(cell),
              headingPath: [tableId],
              locator: {
                ...tableLocator,
                rowRange: { start: rowIndex + 1, end: rowIndex + 1 },
                columnRange: { start: column, end: column + columnSpan - 1 },
              },
              coordinate: {
                kind: "cell",
                sheet: "docx",
                row: rowIndex + 1,
                column,
                rowSpan: 1,
                columnSpan,
              },
              chapterId,
              segmentId,
              tableId,
              sheet: "docx",
              row: rowIndex + 1,
              column,
              rowSpan: 1,
              columnSpan,
            };
            pushBlock(blocks, normalizedCell, policy);
            if (merge !== undefined) {
              for (let offset = 0; offset < columnSpan; offset++)
                nextMerges.set(column + offset, normalizedCell);
            }
          }
          column += columnSpan;
        }
        activeMerges = nextMerges;
      });
    }
  }
  return base(context, blocks, bytes.byteLength);
};

const stableComponent = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]/gu, "_")
    .slice(0, 96);
  return normalized.length > 0 ? normalized : fallback;
};

export const parseTextPdf = async (
  bytes: Uint8Array,
  context: DocumentParserContextV1,
  configuredPolicy: DocumentConversionResourcePolicyV1 = DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
): Promise<ParsedDocumentV1> => {
  ensureContext(context);
  const policy = parseResourcePolicy(configuredPolicy);
  if (bytes.byteLength > policy.maxInputBytes) {
    throw new DocumentParserError("INPUT_LIMIT_EXCEEDED", "input exceeds policy limit");
  }
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new DocumentParserError("FORMAT_INVALID", "PDF header is missing");
  }
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw new DocumentParserError("PARSER_UNAVAILABLE", "PDF parser is unavailable");
  }
  let loading: Awaited<ReturnType<typeof pdfjs.getDocument>>;
  try {
    loading = pdfjs.getDocument({ data: bytes });
  } catch {
    throw new DocumentParserError("PDF_INVALID", "PDF document cannot be opened");
  }
  let pdf: Awaited<typeof loading.promise>;
  try {
    pdf = await loading.promise;
  } catch {
    throw new DocumentParserError("PDF_INVALID", "PDF document cannot be parsed");
  }
  if (pdf.numPages < 1 || pdf.numPages > policy.maxPdfPages) {
    throw new DocumentParserError("PDF_LIMIT_EXCEEDED", "PDF page count exceeds policy limit");
  }
  const blocks: NormalizedBlockV1[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ includeMarkedContent: false });
      for (const item of content.items) {
        const value = item as unknown as {
          str?: unknown;
          transform?: unknown;
          width?: unknown;
          height?: unknown;
        };
        if (typeof value.str !== "string" || value.str.length === 0) continue;
        const transform = Array.isArray(value.transform) ? value.transform : [];
        const x = typeof transform[4] === "number" ? transform[4] : 0;
        const baseline = typeof transform[5] === "number" ? transform[5] : 0;
        const height =
          typeof value.height === "number"
            ? Math.abs(value.height)
            : Math.abs(Number(transform[3] ?? 0));
        const width =
          typeof value.width === "number"
            ? Math.abs(value.width)
            : Math.abs(Number(transform[0] ?? 0));
        if (blocks.length >= policy.maxPdfTextItems) {
          throw new DocumentParserError(
            "PDF_LIMIT_EXCEEDED",
            "PDF text item count exceeds policy limit",
          );
        }
        const id = blockId("pdf", pageNumber, blocks.length + 1);
        pushBlock(
          blocks,
          {
            blockId: id,
            kind: "paragraph",
            text: value.str,
            headingPath: [`page_${pageNumber}`],
            locator: { kind: "document", pageNumber, headingPath: [`page_${pageNumber}`] },
            coordinate: {
              kind: "page",
              pageNumber,
              x,
              y: viewport.height - baseline - height,
              width,
              height,
            },
            chapterId: `page_${pageNumber}`,
            segmentId: `item_${blocks.length + 1}`,
          },
          policy,
        );
      }
      page.cleanup();
    }
  } catch (error) {
    if (error instanceof DocumentParserError) throw error;
    throw new DocumentParserError("PDF_TEXT_INVALID", "PDF text layer cannot be read");
  } finally {
    await loading.destroy().catch(() => undefined);
  }
  if (blocks.length === 0) {
    throw new DocumentParserError("PDF_TEXT_LAYER_MISSING", "PDF requires C13 OCR processing");
  }
  return base(context, blocks, bytes.byteLength);
};

type ScalarValue = string | number | boolean | null;

const scalarValue = (value: unknown): ScalarValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if ("result" in object) return scalarValue(object.result);
  if (Array.isArray(object.richText)) {
    return object.richText
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "";
        }
        return "";
      })
      .join("");
  }
  if (typeof object.text === "string") return object.text;
  if (typeof object.error === "string") return object.error;
  return null;
};

const valueText = (value: unknown): string => {
  const normalized = scalarValue(value);
  return normalized === null ? "" : String(normalized);
};

const mergedRangeFor = (
  merges: readonly string[],
  row: number,
  column: number,
): { startRow: number; endRow: number; startColumn: number; endColumn: number } | undefined => {
  for (const range of merges) {
    const match = /^([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)$/u.exec(range);
    if (match === null) continue;
    const startColumn = columnNumber(match[1]!);
    const endColumn = columnNumber(match[3]!);
    const startRow = Number(match[2]);
    const endRow = Number(match[4]);
    if (row >= startRow && row <= endRow && column >= startColumn && column <= endColumn) {
      return { startRow, endRow, startColumn, endColumn };
    }
  }
  return undefined;
};

const columnNumber = (letters: string): number => {
  let result = 0;
  for (const character of letters) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
};

const cellRangeSize = (range: string): number => {
  const match = /^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$/u.exec(range.toUpperCase());
  if (match === null) return 0;
  const startColumn = columnNumber(match[1]!);
  const startRow = Number(match[2]);
  const endColumn = columnNumber(match[3] ?? match[1]!);
  const endRow = Number(match[4] ?? match[2]);
  const size = (endColumn - startColumn + 1) * (endRow - startRow + 1);
  return Number.isSafeInteger(size) && size > 0 ? size : Number.MAX_SAFE_INTEGER;
};

const preflightXlsx = (
  entries: Record<string, Uint8Array>,
  policy: DocumentConversionResourcePolicyV1,
): void => {
  const workbook = parseXmlPart(entries, "xl/workbook.xml", policy, "XLSX_INVALID");
  const sheets = findXmlEntries(workbook, "sheet");
  if (sheets.length < 1 || sheets.length > policy.maxSheets) {
    throw new DocumentParserError("XLSX_LIMIT_EXCEEDED", "XLSX sheet count exceeds policy limit");
  }
  const relationships = parseXmlPart(entries, "xl/_rels/workbook.xml.rels", policy, "XLSX_INVALID");
  const targets = new Map<string, string>();
  for (const relationship of findXmlEntries(relationships, "Relationship")) {
    const id = relationship.attributes["@_Id"];
    const target = relationship.attributes["@_Target"];
    if (id === undefined || target === undefined) continue;
    const targetPath = resolvePackageRelationshipTarget("xl", target);
    if (targetPath.startsWith("../") || entries[targetPath] === undefined) {
      throw new DocumentParserError(
        "XLSX_INVALID",
        "XLSX worksheet relationship target is missing",
      );
    }
    targets.set(id, targetPath);
  }
  let totalCells = 0;
  let totalBlocks = 0;
  for (const sheet of sheets) {
    const relationshipId = sheet.attributes["@_r:id"] ?? sheet.attributes["@_id"];
    const targetPath = relationshipId === undefined ? undefined : targets.get(relationshipId);
    if (targetPath === undefined) {
      throw new DocumentParserError("XLSX_INVALID", "XLSX worksheet relationship is missing");
    }
    const worksheet = parseXmlPart(entries, targetPath, policy, "XLSX_INVALID");
    const explicitCells = findXmlEntries(worksheet, "c").length;
    const dimension = findXmlEntries(worksheet, "dimension")[0]?.attributes["@_ref"];
    const dimensionCells = dimension === undefined ? 0 : cellRangeSize(dimension);
    const mergedCells = findXmlEntries(worksheet, "mergeCell").reduce(
      (count, cell) => count + cellRangeSize(cell.attributes["@_ref"] ?? ""),
      0,
    );
    const cellCount = Math.max(explicitCells, dimensionCells, mergedCells);
    totalCells += cellCount;
    totalBlocks += cellCount + 1;
    if (totalCells > policy.maxCells) {
      throw new DocumentParserError("XLSX_LIMIT_EXCEEDED", "XLSX cell count exceeds policy limit");
    }
    if (totalBlocks > policy.maxOutputBlocks) {
      throw new DocumentParserError("OUTPUT_LIMIT_EXCEEDED", "XLSX output exceeds policy limit");
    }
  }
};

const preflightCsv = (text: string, policy: DocumentConversionResourcePolicyV1): void => {
  if (text.length === 0) return;
  let recordCount = 1;
  let totalFields = 0;
  let fieldCount = 1;
  let inQuotes = false;
  let fieldStart = true;
  let endedAfterRecord = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') index += 1;
        else inQuotes = false;
      }
      endedAfterRecord = false;
      continue;
    }
    if (character === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      endedAfterRecord = false;
    } else if (character === ",") {
      fieldCount += 1;
      fieldStart = true;
      endedAfterRecord = false;
    } else if (character === "\n" || character === "\r") {
      if (fieldCount > policy.maxCsvFields) {
        throw new DocumentParserError("CSV_LIMIT_EXCEEDED", "CSV field count exceeds policy limit");
      }
      totalFields += fieldCount;
      recordCount += 1;
      fieldCount = 1;
      fieldStart = true;
      endedAfterRecord = true;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      fieldStart = false;
      endedAfterRecord = false;
    }
  }
  if (endedAfterRecord) recordCount -= 1;
  else totalFields += fieldCount;
  if (fieldCount > policy.maxCsvFields || recordCount > policy.maxCsvRecords) {
    throw new DocumentParserError(
      "CSV_LIMIT_EXCEEDED",
      "CSV record or field count exceeds policy limit",
    );
  }
  if (totalFields + 1 > policy.maxOutputBlocks) {
    throw new DocumentParserError("CSV_LIMIT_EXCEEDED", "CSV output exceeds policy limit");
  }
};

export const parseXlsx = async (
  bytes: Uint8Array,
  context: DocumentParserContextV1,
  configuredPolicy: DocumentConversionResourcePolicyV1 = DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
): Promise<ParsedDocumentV1> => {
  ensureContext(context);
  const policy = parseResourcePolicy(configuredPolicy);
  if (bytes.byteLength > policy.maxInputBytes) {
    throw new DocumentParserError("INPUT_LIMIT_EXCEEDED", "input exceeds policy limit");
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new DocumentParserError("FORMAT_INVALID", "XLSX package is not a ZIP archive");
  }
  const entries = readDocumentPackage(bytes, policy, "xl/workbook.xml");
  validateRelationships(entries, policy);
  preflightXlsx(entries, policy);
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new DocumentParserError("XLSX_INVALID", "XLSX workbook cannot be parsed");
  }
  if (workbook.worksheets.length < 1 || workbook.worksheets.length > policy.maxSheets) {
    throw new DocumentParserError("XLSX_LIMIT_EXCEEDED", "XLSX sheet count exceeds policy limit");
  }
  const blocks: NormalizedBlockV1[] = [];
  let cellCount = 0;
  workbook.worksheets.forEach((sheet, sheetIndex) => {
    const sheetName = sheet.name || `sheet_${sheetIndex + 1}`;
    const tableId = `sheet_${sheetIndex + 1}`;
    const rowCount = Math.max(1, sheet.rowCount);
    const colCount = Math.max(1, sheet.columnCount);
    const merges = ((sheet.model.merges ?? []) as readonly string[]).slice();
    const tableLocator = {
      kind: "table" as const,
      sheet: sheetName,
      table: tableId,
      rowRange: { start: 1, end: rowCount },
      columnRange: { start: 1, end: colCount },
    };
    pushBlock(
      blocks,
      {
        blockId: blockId("xlsx-table", sheetIndex + 1),
        kind: "table",
        text: "",
        headingPath: [sheetName],
        locator: tableLocator,
        tableId,
        sheet: sheetName,
        chapterId: stableComponent(tableId, "sheet"),
        segmentId: stableComponent(tableId, "table"),
      },
      policy,
    );
    for (let row = 1; row <= rowCount; row += 1) {
      for (let column = 1; column <= colCount; column += 1) {
        cellCount += 1;
        if (cellCount > policy.maxCells)
          throw new DocumentParserError(
            "XLSX_LIMIT_EXCEEDED",
            "XLSX cell count exceeds policy limit",
          );
        const cell = sheet.getCell(row, column);
        const raw = cell.value as unknown;
        let formula: string | undefined;
        let cachedValue: ScalarValue | undefined;
        if (typeof raw === "object" && raw !== null && "formula" in raw) {
          formula =
            typeof (raw as { formula?: unknown }).formula === "string"
              ? (raw as { formula: string }).formula
              : "";
          const result = (raw as { result?: unknown }).result;
          cachedValue = scalarValue(result);
        }
        const text = formula === undefined ? valueText(raw) : valueText(cachedValue);
        const mergedRange = mergedRangeFor(merges, row, column);
        const rowSpan =
          mergedRange === undefined ? 1 : mergedRange.endRow - mergedRange.startRow + 1;
        const columnSpan =
          mergedRange === undefined ? 1 : mergedRange.endColumn - mergedRange.startColumn + 1;
        pushBlock(
          blocks,
          {
            blockId: blockId("xlsx-cell", sheetIndex + 1, row, column),
            kind: "cell",
            text,
            headingPath: [sheetName],
            locator: {
              ...tableLocator,
              rowRange: { start: row, end: row },
              columnRange: { start: column, end: column },
            },
            coordinate: { kind: "cell", sheet: sheetName, row, column, rowSpan, columnSpan },
            tableId,
            sheet: sheetName,
            row,
            column,
            rowSpan,
            columnSpan,
            value: formula === undefined ? scalarValue(raw) : (cachedValue ?? null),
            ...(formula === undefined ? {} : { formula, cachedValue: cachedValue ?? null }),
            chapterId: stableComponent(tableId, "sheet"),
            segmentId: stableComponent(tableId, "table"),
          },
          policy,
        );
      }
    }
  });
  return base(context, blocks, bytes.byteLength);
};

export const parseCsv = (
  bytes: Uint8Array,
  context: DocumentParserContextV1,
  configuredPolicy: DocumentConversionResourcePolicyV1 = DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
): ParsedDocumentV1 => {
  ensureContext(context);
  const policy = parseResourcePolicy(configuredPolicy);
  const text = bytesText(bytes, policy.maxInputBytes);
  preflightCsv(text, policy);
  let records: unknown[][];
  try {
    records = parseCsvRecords(text, {
      bom: true,
      relax_column_count: false,
      skip_empty_lines: false,
    }) as unknown[][];
  } catch {
    throw new DocumentParserError("CSV_INVALID", "CSV content cannot be parsed");
  }
  if (records.length < 1 || records.length > policy.maxCsvRecords) {
    throw new DocumentParserError("CSV_LIMIT_EXCEEDED", "CSV record count exceeds policy limit");
  }
  const maxFields = records.reduce((max, record) => Math.max(max, record.length), 0);
  if (maxFields > policy.maxCsvFields)
    throw new DocumentParserError("CSV_LIMIT_EXCEEDED", "CSV field count exceeds policy limit");
  const blocks: NormalizedBlockV1[] = [];
  const tableId = "csv_1";
  const rowCount = Math.max(1, records.length);
  const columnCount = Math.max(1, maxFields);
  const tableLocator = {
    kind: "table" as const,
    sheet: "csv",
    table: tableId,
    rowRange: { start: 1, end: rowCount },
    columnRange: { start: 1, end: columnCount },
  };
  pushBlock(
    blocks,
    {
      blockId: "csv-table-1",
      kind: "table",
      text: "",
      headingPath: ["csv"],
      locator: tableLocator,
      tableId,
      sheet: "csv",
      chapterId: tableId,
      segmentId: tableId,
    },
    policy,
  );
  records.forEach((record, rowIndex) => {
    record.forEach((value, columnIndex) => {
      pushBlock(
        blocks,
        {
          blockId: blockId("csv-cell", rowIndex + 1, columnIndex + 1),
          kind: "cell",
          text: valueText(value),
          headingPath: ["csv"],
          locator: {
            ...tableLocator,
            rowRange: { start: rowIndex + 1, end: rowIndex + 1 },
            columnRange: { start: columnIndex + 1, end: columnIndex + 1 },
          },
          coordinate: {
            kind: "cell",
            sheet: "csv",
            row: rowIndex + 1,
            column: columnIndex + 1,
            rowSpan: 1,
            columnSpan: 1,
          },
          tableId,
          sheet: "csv",
          row: rowIndex + 1,
          column: columnIndex + 1,
          rowSpan: 1,
          columnSpan: 1,
          value: scalarValue(value),
          chapterId: tableId,
          segmentId: tableId,
        },
        policy,
      );
    });
  });
  return base(context, blocks, bytes.byteLength);
};

export const parseStructuredDocument = async (
  bytes: Uint8Array,
  context: DocumentParserContextV1,
  configuredPolicy: DocumentConversionResourcePolicyV1 = DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
): Promise<ParsedDocumentV1> => {
  switch (context.inputKind) {
    case "docx":
      return parseDocx(bytes, context, configuredPolicy);
    case "text-pdf":
      return parseTextPdf(bytes, context, configuredPolicy);
    case "xlsx":
      return parseXlsx(bytes, context, configuredPolicy);
    case "csv":
      return parseCsv(bytes, context, configuredPolicy);
    case "ocr-layout":
      throw new DocumentParserError(
        "OCR_DELEGATED_TO_C13",
        "OCR layout conversion is owned by C13",
      );
  }
};
