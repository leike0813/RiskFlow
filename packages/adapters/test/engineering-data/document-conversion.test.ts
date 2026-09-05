import { readFile } from "node:fs/promises";

import { Workbook } from "exceljs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  DocumentParserError,
  parseCsv,
  parseDocx,
  parseStructuredDocument,
  parseTextPdf,
  parseXlsx,
  StructuredDocumentConversionAdapter,
} from "../../src/engineering-data/document-conversion/index.js";
import type {
  ArtifactPutCommandV1,
  ArtifactPutResultV1,
  ArtifactReadHandleV1,
  ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import type {
  ContextSourceResultV1,
  EngineeringContextSourceRegistryV1,
  SourceProcessingInputV1,
} from "@riskflow/core/engineering-data/context-source";
import {
  AuthorizationContextV1Schema,
  StructuredDocumentConversionCommandV1Schema,
  StructuredDocumentConversionQueryV1Schema,
} from "@riskflow/contracts/ports";

const source = {
  sourceVersionRef: {
    kind: "source-version" as const,
    reference: { entityId: "source_1", versionId: "v1" },
  },
  projectId: "project_1",
  sourceId: "source_1",
  sourceItemId: "item_1",
  projectRevisionRef: {
    kind: "project-revision" as const,
    reference: { entityId: "project_1", versionId: "v1" },
  },
  spatialScopeRefs: [
    { kind: "spatial-scope" as const, reference: { entityId: "scope_1", versionId: "v1" } },
  ],
  sourceArtifactRef: {
    kind: "content-artifact" as const,
    reference: { entityId: "source_1", versionId: `sha256:${"a".repeat(64)}` },
  },
  metadataArtifactRef: {
    kind: "content-artifact" as const,
    reference: { entityId: "metadata_1", versionId: `sha256:${"b".repeat(64)}` },
  },
  sourceAccessGrantRef: {
    kind: "source-access-grant" as const,
    reference: { entityId: "grant_1", versionId: "v1" },
  },
  applicabilityMetadataSnapshotRef: {
    kind: "applicability-metadata-snapshot" as const,
    reference: { entityId: "snapshot_1", versionId: "v1" },
  },
};

const context = (
  inputKind: "docx" | "text-pdf" | "xlsx" | "csv" | "ocr-layout",
  mediaType: string,
) => ({
  source,
  inputKind,
  mediaType,
});

const minimalTextPdf = (text: string): Uint8Array => {
  const content = `BT\n/F1 12 Tf\n72 120 Td\n(${text}) Tj\nET`;
  const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
};

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof DocumentParserError) return error.code;
    throw error;
  }
  throw new Error("expected parser to fail");
};

const fixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(
    await readFile(new URL(`../fixtures/structured-document-conversion/${name}`, import.meta.url)),
  );

describe("structured document format adapters", () => {
  it("parses the on-disk DOCX, PDF, XLSX and CSV fixtures", async () => {
    const [docx, pdf, xlsx, csv] = await Promise.all([
      fixture("sample.docx"),
      fixture("sample.pdf"),
      fixture("sample.xlsx"),
      fixture("sample.csv"),
    ]);
    const parsedDocx = parseDocx(
      docx,
      context("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    expect(parsedDocx.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "heading", text: "工序标题" }),
        expect.objectContaining({ kind: "cell", text: "表格值" }),
      ]),
    );
    const parsedPdf = await parseTextPdf(pdf, context("text-pdf", "application/pdf"));
    expect(parsedPdf.blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "C12 fixture PDF" })]),
    );
    const parsedXlsx = await parseXlsx(
      xlsx,
      context("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    expect(parsedXlsx.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "指标" }),
        expect.objectContaining({ formula: "1+1", cachedValue: 2 }),
        expect.objectContaining({ value: 1.2 }),
      ]),
    );
    const parsedCsv = parseCsv(csv, context("csv", "text/csv"));
    expect(parsedCsv.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: 1, text: "地表沉降" }),
        expect.objectContaining({ row: 2, column: 2, text: "第一行\n第二行" }),
      ]),
    );
  });

  it("keeps DOCX structure, caption, table values and explicit page breaks", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="heading_custom"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>图注</w:t></w:r></w:p>
          <w:p><w:r><w:t>第一页</w:t><w:br w:type="page"/></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格值</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:body>
      </w:document>`;
    const bytes = zipSync({
      "[Content_Types].xml": strToU8(`<?xml version="1.0"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        </Types>`),
      "_rels/.rels": strToU8(`<?xml version="1.0"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        </Relationships>`),
      "word/styles.xml": strToU8(`<?xml version="1.0"?>
        <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:style w:type="paragraph" w:styleId="heading_custom"><w:name w:val="标题1"/></w:style>
        </w:styles>`),
      "word/document.xml": strToU8(xml),
    });
    const document = parseDocx(
      bytes,
      context("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    expect(document.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "caption",
      "paragraph",
      "page-break",
      "table",
      "cell",
    ]);
    expect(document.blocks[0]).toMatchObject({
      headingPath: ["标题"],
      locator: { kind: "document", pageNumber: 1 },
    });
    expect(document.blocks.at(-1)?.text).toBe("表格值");
  });

  it("keeps XLSX formula/cache and CSV quoting, BOM, newline and coordinates", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("指标");
    sheet.getCell("A1").value = "指标";
    sheet.getCell("B1").value = { formula: "1+1", result: 2 };
    sheet.mergeCells("A2:B2");
    sheet.getCell("A2").value = "合并值";
    sheet.getCell("D5").value = false;
    const xlsx = new Uint8Array(await workbook.xlsx.writeBuffer());
    const parsedXlsx = await parseXlsx(
      xlsx,
      context("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    const formula = parsedXlsx.blocks.find((block) => block.formula !== undefined);
    expect(formula).toMatchObject({ formula: "1+1", cachedValue: 2, row: 1, column: 2 });
    expect(parsedXlsx.blocks.find((block) => block.row === 5 && block.column === 4)).toMatchObject({
      value: false,
      text: "false",
    });
    expect(parsedXlsx.blocks.some((block) => block.rowSpan === 1 && block.columnSpan === 2)).toBe(
      true,
    );
    const oversizedMerge = unzipSync(xlsx);
    oversizedMerge["xl/worksheets/sheet1.xml"] = strToU8(
      new TextDecoder()
        .decode(oversizedMerge["xl/worksheets/sheet1.xml"])
        .replace('ref="A2:B2"', 'ref="A1:XFD1048576"'),
    );
    await expect(
      parseXlsx(
        zipSync(oversizedMerge),
        context("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      ),
    ).rejects.toMatchObject({ code: "XLSX_LIMIT_EXCEEDED" });

    const csv = parseCsv(
      new TextEncoder().encode('\uFEFF指标,备注\n"值,一","第一行\n第二行"\n'),
      context("csv", "text/csv"),
    );
    expect(csv.blocks.find((block) => block.row === 1 && block.column === 1)?.text).toBe("指标");
    expect(csv.blocks.find((block) => block.row === 2 && block.column === 1)?.text).toBe("值,一");
    expect(csv.blocks.find((block) => block.row === 2 && block.column === 2)?.text).toBe(
      "第一行\n第二行",
    );
  });

  it("keeps text PDF page coordinates and routes empty text layers to C13", async () => {
    const parsed = await parseTextPdf(
      minimalTextPdf("PDF risk"),
      context("text-pdf", "application/pdf"),
    );
    expect(parsed.blocks.find((block) => block.text === "PDF risk")).toMatchObject({
      locator: { kind: "document", pageNumber: 1 },
      coordinate: { kind: "page", pageNumber: 1, x: 72 },
    });
    await expect(
      parseTextPdf(minimalTextPdf(""), context("text-pdf", "application/pdf")),
    ).rejects.toMatchObject({ code: "PDF_TEXT_LAYER_MISSING" });
  });

  it("rejects non-UTF-8 CSV and delegates OCR without an empty success", async () => {
    expect(codeOf(() => parseCsv(new Uint8Array([0xff, 0xfe]), context("csv", "text/csv")))).toBe(
      "INPUT_ENCODING_INVALID",
    );
    await expect(
      parseStructuredDocument(new Uint8Array(), context("ocr-layout", "application/json")),
    ).rejects.toMatchObject({ code: "OCR_DELEGATED_TO_C13" });
    const xml = `<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body/></w:document>`;
    expect(
      codeOf(() =>
        parseDocx(
          zipSync({
            "word/document.xml": strToU8(xml),
            "word/embeddings/object.bin": strToU8("x"),
          }),
          context(
            "docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ),
        ),
      ),
    ).toBe("EMBEDDED_OBJECT_UNSUPPORTED");
  });

  it("converts through the C11/C04 seam and replays the same in-memory result", async () => {
    const authorization = AuthorizationContextV1Schema.parse({
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "auth_1", versionId: "v1" },
      },
      actorId: "actor_1",
      projectId: "project_1",
      grantedCapabilities: ["engineering-data.read", "engineering-data.write"],
      spatialScopeRefs: source.spatialScopeRefs,
      sourceAccessGrantRefs: [source.sourceAccessGrantRef],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: "2030-01-01T00:00:00.000Z",
      invocation: { kind: "human" },
    });
    const input: SourceProcessingInputV1 = source;
    const contextSource = {
      resolveSourceProcessingInput: async (): Promise<ContextSourceResultV1> => ({
        kind: "succeeded",
        result: { kind: "source-processing-input", input },
      }),
      resolveSourceVersionForRead: async (): Promise<ContextSourceResultV1> => ({
        kind: "succeeded",
        result: { kind: "source-processing-input", input },
      }),
      registerSegments: async (): Promise<ContextSourceResultV1> => {
        segmentCount += 1;
        return {
          kind: "succeeded",
          result: {
            kind: "source-segment-set",
            segmentSet: {
              sourceSegmentSetRef: {
                kind: "source-segment-set",
                reference: { entityId: "segments_1", versionId: "v1" },
              },
            },
          },
        } as unknown as ContextSourceResultV1;
      },
    } as unknown as EngineeringContextSourceRegistryV1;
    const bytes = new TextEncoder().encode("指标,备注\n盾构,稳定\n");
    let openCount = 0;
    let putCount = 0;
    let segmentCount = 0;
    let completedReads = 0;
    let diagnostic: Record<string, unknown> | undefined;
    const artifactStore: ArtifactStoreV1 = {
      async open(): Promise<ArtifactReadHandleV1> {
        openCount += 1;
        return {
          manifest: {
            artifactRef: source.sourceArtifactRef,
            mediaType: "text/csv",
          },
          content: (async function* () {
            yield bytes;
            completedReads += 1;
          })(),
          verified: Promise.resolve({} as never),
        } as unknown as ArtifactReadHandleV1;
      },
      async put(
        command: ArtifactPutCommandV1,
        content: AsyncIterable<Uint8Array>,
      ): Promise<ArtifactPutResultV1> {
        putCount += 1;
        if (command.artifactKind === "diagnostic") {
          const chunks: Uint8Array[] = [];
          for await (const chunk of content) chunks.push(chunk);
          const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          diagnostic = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
        }
        const artifactRef =
          command.artifactKind === "diagnostic"
            ? {
                kind: "diagnostic-artifact" as const,
                reference: { entityId: command.artifactId, versionId: "v1" },
              }
            : {
                kind: "content-artifact" as const,
                reference: { entityId: command.artifactId, versionId: "v1" },
              };
        return {
          artifactRef,
          manifest: {} as never,
          manifestSha256: "a".repeat(64),
          replayed: false,
          deduplicated: false,
        };
      },
    };
    const command = StructuredDocumentConversionCommandV1Schema.parse({
      schemaVersion: "1",
      conversionId: "conversion_1",
      idempotencyKey: "conversion_idempotency_1",
      runId: "run_1",
      threadId: "thread_1",
      issuedAt: "2030-01-01T00:00:00.000Z",
      deadlineAt: "2030-01-01T01:00:00.000Z",
      projectId: "project_1",
      actorId: "actor_1",
      authorization,
      sourceVersionRef: source.sourceVersionRef,
      sourceArtifactRef: source.sourceArtifactRef,
      mediaType: "text/csv",
      input: { kind: "csv" },
      conversionPolicyRef: { entityId: "document-conversion-policy", versionId: "1" },
      qualityPolicyRef: { entityId: "quality-policy", versionId: "v1" },
      converterDeploymentRef: { entityId: "converter", versionId: "v1" },
    });
    const adapter = new StructuredDocumentConversionAdapter({
      contextSource,
      artifactStore,
      qualityPolicyRef: { entityId: "quality-policy", versionId: "v1" },
      converterDeploymentRef: { entityId: "converter", versionId: "v1" },
    });
    const blocked = await adapter.convert(
      StructuredDocumentConversionCommandV1Schema.parse({
        ...command,
        conversionId: "conversion_blocked",
        idempotencyKey: "conversion_idempotency_blocked",
        conversionPolicyRef: { entityId: "wrong-policy", versionId: "1" },
      }),
    );
    expect(blocked).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(openCount).toBe(0);
    const first = await adapter.convert(command);
    expect(first.kind).toBe("succeeded");
    const second = await adapter.convert(command);
    expect(second).toEqual(first);
    expect(openCount).toBe(1);
    expect(putCount).toBe(1);
    expect(segmentCount).toBe(1);
    const failedConversion = await adapter.convert(
      StructuredDocumentConversionCommandV1Schema.parse({
        ...command,
        conversionId: "conversion_2",
        idempotencyKey: "conversion_idempotency_2",
        mediaType: "text/csv",
        input: { kind: "text-pdf" },
      }),
    );
    expect(failedConversion).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
    expect(diagnostic).toMatchObject({
      reasonCode: "MEDIA_TYPE_UNSUPPORTED",
      retryable: false,
      inputBytes: bytes.byteLength,
    });
    expect(segmentCount).toBe(1);
    expect(putCount).toBe(2);
    const mismatchedMedia = await adapter.convert({
      ...command,
      conversionId: "conversion_media_mismatch",
      idempotencyKey: "conversion_media_mismatch",
      mediaType: "application/pdf",
    });
    expect(mismatchedMedia).toMatchObject({ kind: "failed" });
    expect(completedReads).toBe(openCount);
    if (first.kind !== "succeeded") return;
    const read = await adapter.read(
      StructuredDocumentConversionQueryV1Schema.parse({
        schemaVersion: "1",
        queryId: "query_1",
        projectId: "project_1",
        actorId: "actor_1",
        requestedAt: "2030-01-01T01:00:00.000Z",
        authorization,
        conversionRef: first.result.conversionRef,
      }),
    );
    expect(read).toMatchObject({
      kind: "succeeded",
      result: { conversion: { status: "succeeded", runId: "run_1", threadId: "thread_1" } },
    });
  });
});
