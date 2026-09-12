import { inflateSync } from "node:zlib";

import { describe, expect, it, afterEach, vi } from "vitest";

import { z } from "@riskflow/core/model";
import type { ArtifactErrorCodeV1, ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  ModuleErrorV1Schema,
  type StructuredDocumentConversionCommandV1,
} from "@riskflow/contracts/ports";

import { createModelGateway } from "../../../../src/model/index.js";

import {
  ArtifactStoreLatch,
  ScriptedFetch,
  jsonResponse,
  modelProbeResponses,
  structuredRequest,
  testDeployment,
} from "../../../model/fixture.js";

import {
  OCR_ERROR_CODES_V1,
  createPaddleOcrLayoutParser,
} from "../../../../src/engineering-data/document-conversion/ocr/index.js";

import {
  buildAcceptanceManifest,
  buildSyntheticScannedJpeg,
  buildSyntheticScannedPdf,
  buildSyntheticScannedPng,
  createContextSourceLatch,
  createOcrTestHarness,
  decodeJpegBlockValues,
  layoutResponse,
  loadAcceptanceManifest,
  loadOcrFixture,
  ocrPage,
  ocrTablePage,
  ocrTestConfig,
  ocrTestSource,
  ocrTextRegion,
  scanPixels,
  SCAN_HEIGHT,
  SCAN_WIDTH,
  startOcrProtocolStub,
  type OcrProtocolStubV1,
} from "./fixture.js";

const PDF_PAGE_1 = [
  ocrTextRegion("title", "合成扫描样例第一页标题", [20, 20, 300, 44], 1),
  ocrTextRegion("text", "监测值12.5", [20, 60, 300, 90], 2),
];

const FOREIGN_ARTIFACT_REF: ArtifactRefV1 = {
  kind: "content-artifact",
  reference: { entityId: "source_other", versionId: `sha256:${"c".repeat(64)}` },
};

const FOREIGN_SOURCE_VERSION_REF = {
  kind: "source-version" as const,
  reference: { entityId: "source_other", versionId: "1" },
};

const authorizationCases: ReadonlyArray<{
  readonly name: string;
  readonly command?: Partial<StructuredDocumentConversionCommandV1>;
  readonly openOverride?: {
    readonly errorCode?: ArtifactErrorCodeV1;
    readonly manifestArtifactRef?: ArtifactRefV1;
  };
  readonly opened?: number;
}> = [
  {
    name: "a source artifact reference that is not the authorized one",
    command: { sourceArtifactRef: FOREIGN_ARTIFACT_REF },
  },
  {
    name: "a source version reference that is not the authorized one",
    command: { sourceVersionRef: FOREIGN_SOURCE_VERSION_REF },
  },
  {
    name: "an input artifact the store cannot find",
    openOverride: { errorCode: "ARTIFACT_REFERENCE_NOT_FOUND" },
    opened: 1,
  },
  {
    name: "an input artifact the store denies access to",
    openOverride: { errorCode: "ARTIFACT_ACCESS_DENIED" },
    opened: 1,
  },
  {
    name: "a manifest reference that differs from the authorized artifact",
    openOverride: { manifestArtifactRef: FOREIGN_ARTIFACT_REF },
    opened: 1,
  },
];

const stubs: OcrProtocolStubV1[] = [];

afterEach(async () => {
  await Promise.all(stubs.splice(0).map((stub) => stub.close()));
});

const startStub = async (): Promise<OcrProtocolStubV1> => {
  const stub = await startOcrProtocolStub();
  stubs.push(stub);
  return stub;
};

const failureBody = (
  store: ReturnType<typeof createOcrTestHarness>["artifactStore"],
  conversionId = "conversion-ocr",
): Record<string, unknown> | undefined => store.bodyFor(`conversion-diagnostic-${conversionId}`);

const jsonLdBody = (
  store: ReturnType<typeof createOcrTestHarness>["artifactStore"],
  conversionId = "conversion-ocr",
): Record<string, unknown> => {
  const body = store.bodyFor(`conversion-${conversionId}`);
  if (body === undefined) throw new Error("json-ld artifact was not written");
  return body;
};

describe("paddle ocr layout parser", () => {
  it("maps the request, persists the raw response trace first and returns the C12 artifact chain", async () => {
    const stub = await startStub();
    const bytes = buildSyntheticScannedPdf();
    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const { adapter, artifactStore, contextSource, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: bytes,
    });

    const result = await adapter.convert(command);

    expect(result.kind).toBe("succeeded");
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.method).toBe("POST");
    expect(stub.requests[0]!.url).toBe("/layout-parsing");
    const requestBody = stub.requests[0]!.body as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      fileType: 0,
      visualize: false,
      returnMarkdownImages: false,
    });
    expect(requestBody).not.toHaveProperty("outputImages");
    expect(Buffer.from(String(requestBody.file), "base64")).toEqual(Buffer.from(bytes));

    const rawEnvelope = artifactStore.bodyFor("ocr-raw-response-conversion-ocr-attempt-1");
    expect(rawEnvelope).toMatchObject({ stage: "ocr-raw-response", attempt: 1, httpStatus: 200 });
    const trace = rawEnvelope!.trace as Record<string, unknown>;
    expect(trace).toMatchObject({
      deploymentRef: { entityId: "ocr-deployment", versionId: "1" },
      serviceBuildRef: { entityId: "paddleocr", versionId: "3.7.0" },
      pipelineRef: { entityId: "pp-structurev3", versionId: "3.7.0" },
      protocolVersion: "pp-structurev3-layout-parsing-1",
    });
    expect(Array.isArray(trace.modelVersionRefs)).toBe(true);
    expect(
      JSON.parse(
        String(
          rawEnvelope!.responseBodyBase64 &&
            Buffer.from(String(rawEnvelope!.responseBodyBase64), "base64").toString("utf8"),
        ),
      ),
    ).toMatchObject({
      errorCode: 0,
    });

    const jsonLd = jsonLdBody(artifactStore);
    expect(jsonLd.pageExtents).toEqual([
      { pageNumber: 1, width: 320, height: 200, coordinateSystem: "pixel-top-left" },
    ]);
    const textBlocks = jsonLd.textBlocks as Array<Record<string, unknown>>;
    expect(textBlocks.map((block) => block.text)).toEqual(["合成扫描样例第一页标题", "监测值12.5"]);
    expect(textBlocks.every((block) => typeof block.confidence === "number")).toBe(true);
    expect(textBlocks[0]!.coordinate).toMatchObject({ kind: "page", pageNumber: 1 });
    const rawRef = artifactStore.commandsFor("ocr-raw-response-conversion-ocr-attempt-1")[0]!
      .artifactId;
    const jsonLdCommand = artifactStore.commandsFor("conversion-conversion-ocr")[0]!;
    const normalizationEnvelope = artifactStore.bodyFor(
      "ocr-normalization-diagnostic-conversion-ocr",
    );
    expect(normalizationEnvelope).toMatchObject({
      stage: "ocr-normalization-diagnostic",
      converterDeploymentRef: { entityId: "ocr-deployment", versionId: "1" },
      qualityPolicyRef: { entityId: "ocr-quality-policy", versionId: "1" },
      diagnostic: { pageCount: 1, regionCount: 2, attempt: 1, httpStatus: 200 },
    });
    const normalizationCommand = artifactStore.commandsFor(
      "ocr-normalization-diagnostic-conversion-ocr",
    )[0]!;
    expect(normalizationCommand).toMatchObject({
      artifactKind: "diagnostic",
      commandId: "conversion-ocr:ocr-normalization-diagnostic",
      idempotencyKey: "conversion-ocr-key:ocr-normalization-diagnostic",
      parentArtifactRefs: [
        expect.objectContaining({ kind: "content-artifact" }),
        expect.objectContaining({
          kind: "diagnostic-artifact",
          reference: expect.objectContaining({ entityId: rawRef }),
        }),
      ],
    });
    expect(artifactStore.opened.map((request) => request.artifactRef.reference.entityId)).toContain(
      "ocr-normalization-diagnostic-conversion-ocr",
    );
    expect(jsonLdCommand.parentArtifactRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diagnostic-artifact",
          reference: expect.objectContaining({
            entityId: "ocr-normalization-diagnostic-conversion-ocr",
          }),
        }),
      ]),
    );
    expect(jsonLdCommand.evidenceReferences.length).toBeGreaterThan(0);
    expect(contextSource.registered).toHaveLength(1);
  });

  it("does not route non-OCR inputs or unsupported media types through the OCR service", async () => {
    const stub = await startStub();
    const csv = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: new TextEncoder().encode("指标,备注\n地表沉降,稳定\n"),
      mediaType: "text/csv",
      command: { input: { kind: "csv" } },
    });
    const csvResult = await csv.adapter.convert(csv.command);
    expect(csvResult.kind).toBe("succeeded");
    expect(stub.requests).toHaveLength(0);

    const ocrWithWrongMedia = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: new TextEncoder().encode("not-a-scan"),
      mediaType: "application/msword",
    });
    const rejected = await ocrWithWrongMedia.adapter.convert(ocrWithWrongMedia.command);
    expect(rejected).toMatchObject({ kind: "failed" });
    expect(failureBody(ocrWithWrongMedia.artifactStore)).toMatchObject({
      reasonCode: "OCR_MEDIA_TYPE_UNSUPPORTED",
      ocrStage: "input",
    });
    expect(stub.requests).toHaveLength(0);
    expect(ocrWithWrongMedia.artifactStore.commandsFor("conversion-conversion-ocr")).toHaveLength(
      0,
    );
  });

  it("returns the same non-enumerable authorization denial before contacting the service", async () => {
    const stub = await startStub();
    const source = ocrTestSource();
    const contextSource = createContextSourceLatch(source);
    contextSource.resolveSourceProcessingInput = async () => ({
      kind: "failed",
      error: ModuleErrorV1Schema.parse({
        stageCode: "engineering-data.context-source.authorization_denied",
        occurredAt: "2030-01-01T00:00:00.000Z",
        causalRunId: "conversion-ocr",
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "engineering-data.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "1" },
      }),
    });
    const { adapter, artifactStore, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPng(),
      mediaType: "image/png",
      contextSource,
    });

    const result = await adapter.convert(command);

    expect(result).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED", retryable: false },
    });
    expect(stub.requests).toHaveLength(0);
    expect(artifactStore.commands).toHaveLength(0);
    expect(artifactStore.opened).toHaveLength(0);
  });

  it.each(authorizationCases)(
    "returns the same non-enumerable authorization denial for $name",
    async (item) => {
      const stub = await startStub();
      stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
      const harness = createOcrTestHarness({
        baseUrl: stub.origin,
        inputBytes: buildSyntheticScannedPdf(),
        ...(item.command === undefined ? {} : { command: item.command }),
      });
      if (item.openOverride !== undefined) {
        harness.artifactStore.overrideOpenFor("source_ocr", item.openOverride);
      }

      const result = await harness.adapter.convert(harness.command);

      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED", retryable: false },
      });
      expect(stub.requests).toHaveLength(0);
      expect(harness.artifactStore.commands).toHaveLength(0);
      expect(harness.artifactStore.opened).toHaveLength(item.opened ?? 0);
      expect(harness.contextSource.registered).toHaveLength(0);
    },
  );

  it("keeps the non-OCR reference mismatch on the existing error path (authorization)", async () => {
    const stub = await startStub();
    const harness = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: new TextEncoder().encode("指标,备注\n地表沉降,稳定\n"),
      mediaType: "text/csv",
      command: { input: { kind: "csv" }, sourceArtifactRef: FOREIGN_ARTIFACT_REF },
    });

    const result = await harness.adapter.convert(harness.command);

    expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(stub.requests).toHaveLength(0);
    expect(harness.artifactStore.opened).toHaveLength(0);
  });

  it("rejects an unfrozen deployment or quality reference before any network call", async () => {
    const stub = await startStub();
    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const { adapter, artifactStore, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: {
        quality: {
          policyRef: { entityId: "ocr-quality-policy", versionId: "2" },
        },
      },
    });

    const result = await adapter.convert(command);

    expect(result).toMatchObject({ kind: "failed" });
    expect(failureBody(artifactStore)).toMatchObject({
      reasonCode: "OCR_DEPLOYMENT_MISMATCH",
      ocrStage: "deployment",
      retryable: false,
    });
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    {
      name: "missing page geometry",
      pages: [
        {
          prunedResult: {
            page_index: 0,
            parsing_res_list: [ocrTextRegion("text", "正文", [10, 10, 100, 40], 1)],
          },
        },
      ],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "duplicate page index",
      pages: [ocrPage(0, PDF_PAGE_1), ocrPage(0, PDF_PAGE_1)],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "missing first page index",
      pages: [ocrPage(1, PDF_PAGE_1)],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "unknown layout label",
      pages: [ocrPage(0, [ocrTextRegion("image", "", [10, 10, 100, 100], 1)])],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "region outside the page",
      pages: [ocrPage(0, [ocrTextRegion("text", "正文", [10, 10, 400, 40], 1)])],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "OCR text box outside the page",
      pages: [
        ocrPage(0, PDF_PAGE_1, {
          overall_ocr_res: {
            rec_texts: ["正文"],
            rec_scores: [0.93],
            rec_boxes: [[-10, 10, 20, 30]],
          },
        }),
      ],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "non-axis-aligned OCR polygon",
      pages: [
        ocrPage(0, PDF_PAGE_1, {
          overall_ocr_res: {
            rec_texts: ["正文"],
            rec_scores: [0.93],
            rec_polys: [
              [
                [10, 10],
                [30, 5],
                [40, 20],
                [20, 25],
              ],
            ],
          },
        }),
      ],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "zero-area region",
      pages: [ocrPage(0, [ocrTextRegion("text", "正文", [10, 10, 10, 40], 1)])],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "declared page count mismatch",
      pages: [ocrPage(0, PDF_PAGE_1)],
      extras: {
        dataInfo: {
          type: "pdf",
          numPages: 2,
          pages: [
            { width: 320, height: 200 },
            { width: 320, height: 200 },
          ],
        },
      },
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "cell outside the table region",
      pages: [ocrTablePage(0, [[10, 10, 120, 60]] as unknown as never, ["表头"])],
      reasonCode: "OCR_OUTPUT_INVALID",
    },
    {
      name: "service confidence outside the closed unit interval",
      pages: [
        ocrPage(0, PDF_PAGE_1, {
          overall_ocr_res: {
            rec_texts: ["合成扫描样例第一页标题", "监测值12.5"],
            rec_scores: [1.2, 0.93],
            rec_boxes: PDF_PAGE_1.map((region) => region.block_bbox),
          },
        }),
      ],
      reasonCode: "OCR_PROTOCOL_INVALID",
    },
  ])("rejects illegal service structure: $name", async ({ pages, extras, reasonCode }) => {
    const stub = await startStub();
    stub.enqueue({ body: layoutResponse(pages, extras ?? {}) });
    const { adapter, artifactStore, contextSource, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });

    const result = await adapter.convert(command);

    expect(result).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
    expect(failureBody(artifactStore)).toMatchObject({ reasonCode });
    expect(contextSource.registered).toHaveLength(0);
    expect(artifactStore.commandsFor("conversion-conversion-ocr")).toHaveLength(0);
    expect(artifactStore.commandsFor("ocr-raw-response-conversion-ocr-attempt-1")).toHaveLength(1);
  });

  it("keeps table cells addressable back to their page and reading order", async () => {
    const stub = await startStub();
    const cells = [
      [20, 20, 300, 80],
      [20, 80, 160, 180],
      [160, 80, 300, 130],
      [160, 130, 300, 180],
    ] as const;
    stub.enqueue({
      body: layoutResponse([
        { ...ocrTablePage(0, cells, ["指标", "监测点", "地表沉降", "12.5"]) },
        ocrPage(1, PDF_PAGE_1),
      ]),
    });
    const { adapter, artifactStore, contextSource, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });

    const result = await adapter.convert(command);

    expect(result.kind).toBe("succeeded");
    const jsonLd = jsonLdBody(artifactStore);
    const tableFields = jsonLd.tableFields as Array<Record<string, unknown>>;
    expect(tableFields).toHaveLength(4);
    expect(tableFields[0]).toMatchObject({
      row: 1,
      column: 1,
      mergedRange: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 2 },
      value: "指标",
    });
    expect(tableFields[1]).toMatchObject({
      row: 2,
      column: 1,
      mergedRange: { startRow: 2, endRow: 3, startColumn: 1, endColumn: 1 },
      value: "监测点",
    });
    expect(tableFields[3]).toMatchObject({ row: 3, column: 2, value: "12.5" });
    const cellBlocks = (jsonLd.textBlocks as Array<Record<string, unknown>>).filter((block) =>
      ["指标", "监测点", "地表沉降", "12.5"].includes(String(block.text)),
    );
    expect(cellBlocks).toHaveLength(4);
    expect(cellBlocks[0]!.coordinate).toMatchObject({
      kind: "page",
      pageNumber: 1,
      x: 20,
      y: 20,
      width: 280,
      height: 60,
    });
    const registration = contextSource.registered[0] as {
      segments: Array<Record<string, unknown>>;
    };
    expect(registration.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "table",
          locator: expect.objectContaining({
            kind: "table",
            table: expect.stringContaining("ocr_page_1_table_1"),
          }),
        }),
      ]),
    );
  });

  it("keeps table cells adjacent to their table in the service reading order", async () => {
    const stub = await startStub();
    const before = ocrTextRegion("text", "表前正文", [20, 5, 300, 15], 1);
    const table = ocrTablePage(
      0,
      [
        [20, 20, 160, 100],
        [160, 20, 300, 100],
      ],
      ["指标", "监测值"],
    );
    const after = ocrTextRegion("text", "表后正文", [20, 185, 300, 195], 3);
    stub.enqueue({
      body: layoutResponse([
        {
          prunedResult: {
            ...table.prunedResult,
            parsing_res_list: [before, table.prunedResult.parsing_res_list[0], after],
            overall_ocr_res: {
              rec_texts: ["表前正文", "指标", "监测值", "表后正文"],
              rec_scores: [0.93, 0.91, 0.91, 0.93],
              rec_boxes: [
                before.block_bbox,
                [20, 20, 160, 100],
                [160, 20, 300, 100],
                after.block_bbox,
              ],
            },
          },
        },
      ]),
    });
    const harness = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });

    expect((await harness.adapter.convert(harness.command)).kind).toBe("succeeded");
    expect(
      (jsonLdBody(harness.artifactStore).textBlocks as Array<{ text: string }>).map(
        (block) => block.text,
      ),
    ).toEqual(["表前正文", "指标", "监测值", "表后正文"]);
  });

  it("blocks empty or uncovered pages with a quality gate instead of returning an empty success", async () => {
    const stub = await startStub();
    stub.enqueue({
      body: layoutResponse([ocrPage(0, [ocrTextRegion("text", "", [20, 20, 300, 44], 1)])], {
        dataInfo: { type: "image", width: 320, height: 200 },
      }),
    });
    const { adapter, artifactStore, contextSource, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPng(),
      mediaType: "image/png",
    });

    const result = await adapter.convert(command);

    expect(result).toMatchObject({ kind: "failed" });
    const body = failureBody(artifactStore);
    expect(body).toMatchObject({ reasonCode: "OCR_QUALITY_BLOCKED", ocrStage: "quality" });
    const metrics = (body!.ocrDiagnostic as { metrics: Array<Record<string, unknown>> }).metrics;
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "non-empty-page-ratio", passed: false }),
      ]),
    );
    expect(contextSource.registered).toHaveLength(0);
  });

  it("evaluates the versioned quality policy key-field coverage from the acceptance manifest", async () => {
    const stub = await startStub();
    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const { adapter, artifactStore, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: {
        keyFields: [
          {
            fieldId: "page_1_heading",
            pageNumber: 1,
            regionId: "ocr_page_1_region_1",
            expectedText: "第一页标题",
          },
        ],
        quality: { minimumKeyFieldCoverage: 1 },
      },
    });

    expect((await adapter.convert(command)).kind).toBe("succeeded");

    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const partial = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: {
        keyFields: [
          {
            fieldId: "page_1_heading",
            pageNumber: 1,
            regionId: "ocr_page_1_region_1",
            expectedText: "第一页标题",
          },
          {
            fieldId: "page_2_span",
            pageNumber: 2,
            regionId: "ocr_page_2_region_1",
            expectedText: "监测值12.5",
          },
        ],
        quality: { minimumKeyFieldCoverage: 0.5 },
      },
    });
    expect((await partial.adapter.convert(partial.command)).kind).toBe("succeeded");

    const missingStub = await startStub();
    missingStub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const missing = createOcrTestHarness({
      baseUrl: missingStub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: {
        keyFields: [
          {
            fieldId: "page_2_span",
            pageNumber: 2,
            regionId: "ocr_page_2_region_1",
            expectedText: "监测值12.5",
          },
        ],
        quality: { minimumKeyFieldCoverage: 1 },
      },
    });
    const blocked = await missing.adapter.convert(missing.command);
    expect(blocked).toMatchObject({ kind: "failed" });
    const metrics = (
      failureBody(missing.artifactStore)!.ocrDiagnostic as {
        metrics: Array<Record<string, unknown>>;
      }
    ).metrics;
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "key-field-coverage", passed: false, observed: 0 }),
      ]),
    );
    expect(artifactStore.commandsFor("conversion-conversion-ocr")).toHaveLength(1);
  });

  it("retries retryable service failures within the frozen budget and keeps every raw attempt", async () => {
    const stub = await startStub();
    stub.enqueue({ status: 503, body: { errorCode: 1, errorMsg: "busy" } });
    stub.enqueue({ status: 429, body: { errorCode: 1, errorMsg: "slow down" } });
    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const { adapter, artifactStore, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });

    const result = await adapter.convert(command);

    expect(result.kind).toBe("succeeded");
    expect(stub.requests).toHaveLength(3);
    expect(artifactStore.commandsFor("ocr-raw-response-conversion-ocr-attempt-2")).toHaveLength(1);
    const parents = artifactStore.commandsFor("conversion-conversion-ocr")[0]!.parentArtifactRefs;
    const rawParents = parents.filter((ref) =>
      ref.reference.entityId.startsWith("ocr-raw-response-"),
    );
    expect(rawParents).toHaveLength(3);
    expect(parents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: expect.objectContaining({
            entityId: "ocr-normalization-diagnostic-conversion-ocr",
          }),
        }),
      ]),
    );
  });

  it("keeps an earlier raw response parent when the final retry cannot reach the service", async () => {
    const stub = await startStub();
    stub.enqueue({ status: 503, body: { errorCode: 1, errorMsg: "busy" } });
    stub.enqueue({ drop: true });
    const harness = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: { deployment: { maxAttempts: 2 } },
    });

    expect(await harness.adapter.convert(harness.command)).toMatchObject({ kind: "failed" });
    expect(
      harness.artifactStore.commandsFor("conversion-diagnostic-conversion-ocr")[0]!
        .parentArtifactRefs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diagnostic-artifact",
          reference: expect.objectContaining({
            entityId: "ocr-raw-response-conversion-ocr-attempt-1",
          }),
        }),
      ]),
    );
  });

  it.each([
    {
      name: "rate limited without budget",
      script: { status: 429, body: { errorCode: 1 } },
      config: { deployment: { maxAttempts: 1 } },
      reasonCode: "OCR_SERVICE_RATE_LIMITED",
      retryable: true,
      stage: "service",
      hasRaw: true,
    },
    {
      name: "non JSON body",
      script: { rawBody: "<html>gateway</html>" },
      config: {},
      reasonCode: "OCR_PROTOCOL_INVALID",
      retryable: false,
      stage: "protocol",
      hasRaw: true,
    },
    {
      name: "service error code",
      script: { body: { logId: "x", errorCode: 42, errorMsg: "bad input" } },
      config: {},
      reasonCode: "OCR_PROTOCOL_INVALID",
      retryable: false,
      stage: "protocol",
      hasRaw: true,
    },
    {
      name: "connection dropped",
      script: { drop: true },
      config: { deployment: { maxAttempts: 1 } },
      reasonCode: "OCR_SERVICE_UNAVAILABLE",
      retryable: true,
      stage: "service",
      hasRaw: false,
    },
    {
      name: "frozen timeout",
      script: { delayMs: 400, body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) },
      config: { deployment: { maxAttempts: 1, requestTimeoutMs: 60 } },
      reasonCode: "OCR_TIMEOUT",
      retryable: true,
      stage: "service",
      hasRaw: false,
    },
  ])(
    "closes the failure deterministically: $name",
    async ({ script, config, reasonCode, retryable, stage, hasRaw }) => {
      const stub = await startStub();
      stub.enqueue(script);
      const { adapter, artifactStore, contextSource, command } = createOcrTestHarness({
        baseUrl: stub.origin,
        inputBytes: buildSyntheticScannedPdf(),
        config,
      });

      const result = await adapter.convert(command);

      expect(result).toMatchObject({ kind: "failed" });
      expect(failureBody(artifactStore)).toMatchObject({
        reasonCode,
        retryable,
        ocrStage: stage,
      });
      expect(contextSource.registered).toHaveLength(0);
      expect(artifactStore.commandsFor("conversion-conversion-ocr")).toHaveLength(0);
      const rawEnvelope = artifactStore.bodyFor("ocr-raw-response-conversion-ocr-attempt-1");
      if (hasRaw) expect(rawEnvelope).toMatchObject({ attempt: 1 });
      else expect(rawEnvelope).toBeUndefined();
    },
  );

  it("keeps caller cancellation and queue saturation inside their own failure domain", async () => {
    const stub = await startStub();
    stub.enqueue({ delayMs: 150, body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const controller = new AbortController();
    controller.abort();
    const cancelled = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });
    const cancelledResult = await cancelled.adapter.convert(cancelled.command, {
      signal: controller.signal,
    });
    expect(cancelledResult).toMatchObject({ kind: "failed" });
    expect(failureBody(cancelled.artifactStore)).toMatchObject({
      reasonCode: "OCR_CANCELLED",
      retryable: false,
      ocrStage: "control",
    });

    stub.enqueue({ delayMs: 150, body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const saturated = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: { deployment: { maxConcurrentRequests: 1, maxQueuedRequests: 0 } },
    });
    const first = saturated.adapter.convert(saturated.command);
    const second = saturated.adapter.convert({
      ...saturated.command,
      conversionId: "conversion-ocr-2",
      idempotencyKey: "conversion-ocr-key-2",
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.kind).toBe("succeeded");
    expect(secondResult).toMatchObject({ kind: "failed" });
    expect(failureBody(saturated.artifactStore, "conversion-ocr-2")).toMatchObject({
      reasonCode: "OCR_SERVICE_RATE_LIMITED",
    });
    expect(stub.requests).toHaveLength(1);
  });

  it("removes a cancelled request from the bounded queue without waiting for the active call", async () => {
    let releaseActive: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseActive = resolve;
        }),
    ) as unknown as typeof fetch;
    const harness = createOcrTestHarness({
      baseUrl: "http://ocr-service.test",
      inputBytes: buildSyntheticScannedPdf(),
      fetchImpl,
      config: { deployment: { maxConcurrentRequests: 1, maxQueuedRequests: 1, maxAttempts: 1 } },
    });
    const active = harness.adapter.convert(harness.command);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const queued = harness.adapter.convert(
      {
        ...harness.command,
        conversionId: "conversion-ocr-queued",
        idempotencyKey: "conversion-ocr-key-queued",
      },
      { signal: controller.signal },
    );
    controller.abort();

    expect(await queued).toMatchObject({ kind: "failed" });
    expect(failureBody(harness.artifactStore, "conversion-ocr-queued")).toMatchObject({
      reasonCode: "OCR_CANCELLED",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    releaseActive?.(
      new Response(JSON.stringify(layoutResponse([ocrPage(0, PDF_PAGE_1)])), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect((await active).kind).toBe("succeeded");
  });

  it("keeps established raw artifacts when a later artifact stage fails", async () => {
    const rawFailureStub = await startStub();
    rawFailureStub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const rawFailure = createOcrTestHarness({
      baseUrl: rawFailureStub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });
    rawFailure.artifactStore.failPutFor("ocr-raw-response-conversion-ocr-attempt-1");
    const rawResult = await rawFailure.adapter.convert(rawFailure.command);
    expect(rawResult).toMatchObject({ kind: "failed" });
    expect(failureBody(rawFailure.artifactStore)).toMatchObject({
      reasonCode: "OCR_ARTIFACT_PERSISTENCE_FAILED",
      retryable: true,
      ocrStage: "artifact",
    });
    expect(rawFailure.artifactStore.commandsFor("conversion-conversion-ocr")).toHaveLength(0);
    expect(rawFailure.contextSource.registered).toHaveLength(0);
    expect(rawFailureStub.requests).toHaveLength(1);

    const jsonLdStub = await startStub();
    jsonLdStub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const jsonLdFailure = createOcrTestHarness({
      baseUrl: jsonLdStub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });
    jsonLdFailure.artifactStore.failPutFor("conversion-conversion-ocr");
    const jsonLdResult = await jsonLdFailure.adapter.convert(jsonLdFailure.command);
    expect(jsonLdResult).toMatchObject({ kind: "failed" });
    const parents = jsonLdFailure.artifactStore.commandsFor(
      "conversion-diagnostic-conversion-ocr",
    )[0]!.parentArtifactRefs;
    expect(parents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diagnostic-artifact",
          reference: expect.objectContaining({
            entityId: "ocr-raw-response-conversion-ocr-attempt-1",
          }),
        }),
      ]),
    );
    expect(jsonLdFailure.contextSource.registered).toHaveLength(0);

    const normalizationStub = await startStub();
    normalizationStub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const normalizationFailure = createOcrTestHarness({
      baseUrl: normalizationStub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });
    normalizationFailure.artifactStore.failPutFor("ocr-normalization-diagnostic-conversion-ocr");
    const normalizationResult = await normalizationFailure.adapter.convert(
      normalizationFailure.command,
    );
    expect(normalizationResult).toMatchObject({ kind: "failed" });
    expect(failureBody(normalizationFailure.artifactStore)).toMatchObject({
      reasonCode: "OCR_ARTIFACT_PERSISTENCE_FAILED",
      retryable: true,
      ocrStage: "artifact",
    });
    expect(
      normalizationFailure.artifactStore.commandsFor("conversion-conversion-ocr"),
    ).toHaveLength(0);
    expect(normalizationFailure.contextSource.registered).toHaveLength(0);
    expect(
      normalizationFailure.artifactStore.bodyFor("ocr-raw-response-conversion-ocr-attempt-1"),
    ).toMatchObject({ stage: "ocr-raw-response" });
    expect(
      normalizationFailure.artifactStore.commandsFor("conversion-diagnostic-conversion-ocr")[0]!
        .parentArtifactRefs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diagnostic-artifact",
          reference: expect.objectContaining({
            entityId: "ocr-raw-response-conversion-ocr-attempt-1",
          }),
        }),
      ]),
    );
  });

  it("replays a successful conversion and conflicts on a reused idempotency key with a different payload", async () => {
    const stub = await startStub();
    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const { adapter, artifactStore, contextSource, command } = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
    });

    const first = await adapter.convert(command);
    const putsAfterFirst = artifactStore.commands.length;
    const second = await adapter.convert(command);

    expect(second).toEqual(first);
    expect(stub.requests).toHaveLength(1);
    expect(artifactStore.commands).toHaveLength(putsAfterFirst);
    expect(contextSource.registered).toHaveLength(1);

    const conflict = await adapter.convert({ ...command, mediaType: "image/png" });
    expect(conflict).toMatchObject({
      kind: "failed",
      error: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(stub.requests).toHaveLength(1);
    expect(artifactStore.commands).toHaveLength(putsAfterFirst);
  });

  it("keeps the frozen fixtures and the acceptance manifest aligned with the builders", async () => {
    const [pdf, png, jpeg, manifest] = await Promise.all([
      loadOcrFixture("synthetic-scanned.pdf"),
      loadOcrFixture("synthetic-scanned.png"),
      loadOcrFixture("synthetic-scanned.jpeg"),
      loadAcceptanceManifest(),
    ]);
    expect(Buffer.from(pdf)).toEqual(Buffer.from(buildSyntheticScannedPdf()));
    expect(Buffer.from(png)).toEqual(Buffer.from(buildSyntheticScannedPng()));
    expect(Buffer.from(jpeg)).toEqual(Buffer.from(buildSyntheticScannedJpeg()));
    expect(manifest).toEqual(buildAcceptanceManifest());
    expect(manifest).toMatchObject({ synthetic: true, awaitingClientReview: true });
    expect(manifest.keyFields.map((field) => field.fieldId)).toEqual([
      "page_1_heading",
      "page_2_span_value",
    ]);
    expect(
      [pdf.subarray(0, 4), png.subarray(0, 4), jpeg.subarray(0, 2)].map((magic) =>
        Buffer.from(magic).toString("latin1"),
      ),
    ).toEqual(["%PDF", "\x89PNG", "\u00ff\u00d8"]);
  });

  it("keeps the handwritten CJK fixture raster identical across PDF, PNG, JPEG and the manifest", async () => {
    const [pdf, png, jpeg, manifest] = await Promise.all([
      loadOcrFixture("synthetic-scanned.pdf"),
      loadOcrFixture("synthetic-scanned.png"),
      loadOcrFixture("synthetic-scanned.jpeg"),
      loadAcceptanceManifest(),
    ]);
    const { rgb, gray } = scanPixels();

    expect(manifest.glyphs).toMatchObject({
      fontVersion: "c13-synthetic-handwritten-16x16.v1",
      text: "扫描",
      sourcePixels: 16,
      scale: 8,
    });
    expect(manifest.samples.map((sample) => [sample.width, sample.height])).toEqual([
      [SCAN_WIDTH, SCAN_HEIGHT],
      [SCAN_WIDTH, SCAN_HEIGHT],
      [SCAN_WIDTH, SCAN_HEIGHT],
    ]);
    for (const entry of manifest.glyphs.entries) {
      expect(entry).toMatchObject({ width: 128, height: 128 });
      const stroke = entry.strokePixel.y * SCAN_WIDTH + entry.strokePixel.x;
      const blank = entry.blankPixel.y * SCAN_WIDTH + entry.blankPixel.x;
      expect(gray[stroke]).toBe(32);
      expect(gray[blank]).toBe(240);
      expect(rgb[stroke * 3]).toBe(32);
      expect(rgb[blank * 3]).toBe(240);
    }

    const pngBytes = Buffer.from(png);
    const idatAt = pngBytes.indexOf("IDAT");
    const pngRaster = new Uint8Array(SCAN_WIDTH * SCAN_HEIGHT * 3);
    const inflated = new Uint8Array(
      inflateSync(pngBytes.subarray(idatAt + 4, idatAt + 4 + pngBytes.readUInt32BE(idatAt - 4))),
    );
    for (let y = 0; y < SCAN_HEIGHT; y += 1) {
      expect(inflated[y * (1 + SCAN_WIDTH * 3)]).toBe(0);
      pngRaster.set(
        inflated.subarray(y * (1 + SCAN_WIDTH * 3) + 1, (y + 1) * (1 + SCAN_WIDTH * 3)),
        y * SCAN_WIDTH * 3,
      );
    }
    expect(pngRaster).toEqual(rgb);

    const pdfBytes = Buffer.from(pdf);
    const imageAt = pdfBytes.indexOf("/Subtype /Image");
    const pdfText = pdfBytes.toString("latin1");
    const imageObjectId = [...pdfText.slice(0, imageAt).matchAll(/(\d+) 0 obj\n/g)].at(-1)?.[1];
    expect(imageObjectId).toBeDefined();
    expect([...pdfText.matchAll(/\/Im0 (\d+) 0 R/g)].map((match) => match[1])).toEqual([
      imageObjectId,
      imageObjectId,
    ]);
    const streamAt = pdfBytes.indexOf("stream\n", imageAt);
    const imageLength = Number(
      pdfBytes
        .subarray(pdfBytes.indexOf("/Length ", imageAt), streamAt)
        .toString("latin1")
        .match(/\d+/)![0],
    );
    expect(
      new Uint8Array(inflateSync(pdfBytes.subarray(streamAt + 7, streamAt + 7 + imageLength))),
    ).toEqual(rgb);
    expect(pdfText).toContain(`/MediaBox [0 0 ${SCAN_WIDTH} ${SCAN_HEIGHT}]`);

    const decoded = decodeJpegBlockValues(jpeg);
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: SCAN_WIDTH,
      height: SCAN_HEIGHT,
    });
    const expectedBlocks: number[] = [];
    for (let y = 0; y < SCAN_HEIGHT; y += 8) {
      for (let x = 0; x < SCAN_WIDTH; x += 8) expectedBlocks.push(gray[y * SCAN_WIDTH + x]!);
    }
    expect(decoded.values).toEqual(expectedBlocks);
    expect([...new Set(decoded.values)].sort((left, right) => left - right)).toEqual([32, 240]);
  });

  it("keeps OCR resource isolation from llama.cpp calls under saturation, cancel and crash (isolation)", async () => {
    const stub = await startStub();
    const llamaFetch = new ScriptedFetch();
    const llamaStore = new ArtifactStoreLatch();
    const gateway = createModelGateway({
      deployments: [testDeployment],
      artifactStore: llamaStore,
      fetchImpl: llamaFetch.fetch,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    });
    const queueLlamaProbe = (): void => {
      for (const response of modelProbeResponses()) llamaFetch.enqueue(response);
    };
    const queueLlamaCompletion = (): void => {
      llamaFetch.enqueue(jsonResponse({ tokens: 5 }));
      llamaFetch.enqueue(
        jsonResponse({
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"risk":"stable"}' },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      );
    };
    const llamaCall = () =>
      gateway.completeStructured(structuredRequest(), z.strictObject({ risk: z.string() }));

    queueLlamaProbe();
    queueLlamaCompletion();
    queueLlamaCompletion();

    stub.enqueue({ delayMs: 200, body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    const saturated = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: { deployment: { maxConcurrentRequests: 1, maxQueuedRequests: 0 } },
    });
    const holding = saturated.adapter.convert(saturated.command);
    const throttled = saturated.adapter.convert({
      ...saturated.command,
      conversionId: "conversion-ocr-2",
      idempotencyKey: "conversion-ocr-key-2",
    });
    const [holdingResult, throttledResult, duringSaturation] = await Promise.all([
      holding,
      throttled,
      llamaCall(),
    ]);

    expect(holdingResult.kind).toBe("succeeded");
    expect(throttledResult).toMatchObject({ kind: "failed" });
    expect(failureBody(saturated.artifactStore, "conversion-ocr-2")).toMatchObject({
      reasonCode: "OCR_SERVICE_RATE_LIMITED",
    });
    expect(duringSaturation.value).toEqual({ risk: "stable" });

    const controller = new AbortController();
    controller.abort();
    const cancelled = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: { deployment: { maxAttempts: 1 } },
    });
    expect(
      await cancelled.adapter.convert(cancelled.command, { signal: controller.signal }),
    ).toMatchObject({ kind: "failed" });
    expect(failureBody(cancelled.artifactStore)).toMatchObject({ reasonCode: "OCR_CANCELLED" });

    stub.enqueue({ drop: true });
    const crashed = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config: { deployment: { maxAttempts: 1 } },
    });
    expect(await crashed.adapter.convert(crashed.command)).toMatchObject({ kind: "failed" });
    expect(failureBody(crashed.artifactStore)).toMatchObject({
      reasonCode: "OCR_SERVICE_UNAVAILABLE",
    });

    expect((await llamaCall()).value).toEqual({ risk: "stable" });
    expect(llamaFetch.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/health",
      "/props",
      "/v1/models",
      "/v1/chat/completions/input_tokens",
      "/v1/chat/completions",
      "/v1/chat/completions/input_tokens",
      "/v1/chat/completions",
    ]);
    expect(llamaStore.events.filter((event) => event === "put:done")).toHaveLength(2);
    // 只有被取消的调用不产生请求：饱和放行 1 次，崩溃 1 次。
    expect(stub.requests).toHaveLength(2);
    expect(ocrTestConfig().deployment.deploymentRef).not.toEqual(testDeployment.deploymentRef);
    expect(ocrTestConfig().deployment.resourceAllocationRef).not.toEqual(
      testDeployment.deploymentRef,
    );
  });

  it("rejects invalid or extensible OCR deployment config before any network call (config)", async () => {
    const stub = await startStub();
    for (const baseUrl of [
      `${stub.origin}/gateway`,
      "http://user:secret@ocr-service.test",
      "http://ocr-service.test?model=latest",
      "ftp://ocr-service.test",
    ]) {
      expect(() =>
        createPaddleOcrLayoutParser({ config: ocrTestConfig({ deployment: { baseUrl } }) }),
      ).toThrow();
    }
    expect(() =>
      createPaddleOcrLayoutParser({
        config: ocrTestConfig({ deployment: { maxAttempts: 0, maxConcurrentRequests: 0 } }),
      }),
    ).toThrow();
    expect(() =>
      createPaddleOcrLayoutParser({
        config: ocrTestConfig({
          deployment: {
            modelVersionRefs: [
              { entityId: "ocr-model", versionId: "3.7.0" },
              { entityId: "layout-model", versionId: "3.7.0" },
            ],
          },
        }),
      }),
    ).toThrow();
    expect(() =>
      createPaddleOcrLayoutParser({
        config: ocrTestConfig({ quality: { minimumMeanServiceConfidence: 1.4 } }),
      }),
    ).toThrow();
    expect(() =>
      createPaddleOcrLayoutParser({
        config: ocrTestConfig({ quality: { requiredPageCoverage: 0.9 } }),
      }),
    ).toThrow();
    expect(() =>
      createPaddleOcrLayoutParser({
        config: ocrTestConfig({
          quality: { minimumKeyFieldCoverage: 1 },
        }),
      }),
    ).toThrow();

    const config = ocrTestConfig({ deployment: { baseUrl: stub.origin, maxPages: 1 } });
    const harness = createOcrTestHarness({
      baseUrl: stub.origin,
      inputBytes: buildSyntheticScannedPdf(),
      config,
    });
    config.deployment.maxPages = 0;
    config.quality.minimumNonEmptyPageRatio = 1;
    stub.enqueue({ body: layoutResponse([ocrPage(0, PDF_PAGE_1)]) });
    expect((await harness.adapter.convert(harness.command)).kind).toBe("succeeded");
  });

  it("documents the closed error table that the harness observes", () => {
    expect(OCR_ERROR_CODES_V1.OCR_QUALITY_BLOCKED).toEqual({
      stage: "quality",
      retryable: false,
    });
    expect(OCR_ERROR_CODES_V1.OCR_ARTIFACT_PERSISTENCE_FAILED).toEqual({
      stage: "artifact",
      retryable: true,
    });
    expect(OCR_ERROR_CODES_V1.OCR_CANCELLED).toEqual({ stage: "control", retryable: false });
  });

  it("constructs the parser through its public factory only", () => {
    const parser = createPaddleOcrLayoutParser({ config: ocrTestConfig() });
    expect(typeof parser.parse).toBe("function");
    expect(Object.keys(ocrTestConfig())).toEqual([
      "schemaVersion",
      "deployment",
      "quality",
      "keyFields",
    ]);
  });
});
