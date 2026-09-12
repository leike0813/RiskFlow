import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { deflateSync } from "node:zlib";

import {
  ArtifactPutResultV1Schema,
  type ArtifactManifestV1,
  type ArtifactPutCommandV1,
  type ArtifactPutResultV1,
  type ArtifactReadHandleV1,
  type ArtifactReadRequestV1,
  type ArtifactReadReceiptV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import type {
  ContextSourceResultV1,
  EngineeringContextSourceRegistryV1,
  SourceProcessingInputV1,
} from "@riskflow/core/engineering-data/context-source";
import {
  AuthorizationContextV1Schema,
  StructuredDocumentConversionCommandV1Schema,
  type StructuredDocumentConversionCommandV1,
} from "@riskflow/contracts/ports";

import { StructuredDocumentConversionAdapter } from "../../../../src/engineering-data/document-conversion/index.js";
import { createPaddleOcrLayoutParser } from "../../../../src/engineering-data/document-conversion/ocr/index.js";

/**
 * C13 测试夹具体：合成扫描样例、机器可读验收清单、本地 HTTP 协议替身、C04 工件
 * 替身与 C11 授权替身。替身只存在于测试目录，生产包不导出任何替身或静态 OCR 结果。
 *
 * 样例为最小合成结构样例（无甲方脱敏资料前使用），fixtures/*.pdf|png|jpeg 必须与
 * 本文件的构建函数逐字节一致；真实识别准确率需由 C37 预置服务与甲方样例另行验证。
 */

const crcTable = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

const SCAN_WIDTH = 320;
const SCAN_HEIGHT = 200;

/** 合成扫描位图：浅底 + 深色文本条，确定性生成，不含真实工程正文。 */
const scanPixels = (): { readonly rgb: Uint8Array; readonly gray: Uint8Array } => {
  const rgb = new Uint8Array(SCAN_WIDTH * SCAN_HEIGHT * 3);
  const gray = new Uint8Array(SCAN_WIDTH * SCAN_HEIGHT);
  const rows = [24, 40, 56, 88, 104, 136, 152];
  for (let y = 0; y < SCAN_HEIGHT; y += 1) {
    for (let x = 0; x < SCAN_WIDTH; x += 1) {
      const offset = (y * SCAN_WIDTH + x) * 3;
      const inRow = rows.some((row) => y >= row && y < row + 10);
      const dark = inRow && x >= 20 && x < SCAN_WIDTH - 20;
      const value = dark ? 32 : 240;
      rgb[offset] = value;
      rgb[offset + 1] = value;
      rgb[offset + 2] = value;
      gray[y * SCAN_WIDTH + x] = value;
    }
  }
  return { rgb, gray };
};

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = ascii(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.byteLength);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([typeBytes, data])));
  return concat([length, typeBytes, data, crc]);
};

export const buildSyntheticScannedPng = (): Uint8Array => {
  const { rgb } = scanPixels();
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, SCAN_WIDTH);
  view.setUint32(4, SCAN_HEIGHT);
  header[8] = 8;
  header[9] = 2;
  const raw = new Uint8Array(SCAN_HEIGHT * (1 + SCAN_WIDTH * 3));
  for (let y = 0; y < SCAN_HEIGHT; y += 1) {
    raw[y * (1 + SCAN_WIDTH * 3)] = 0;
    raw.set(rgb.subarray(y * SCAN_WIDTH * 3, (y + 1) * SCAN_WIDTH * 3), y * (1 + SCAN_WIDTH * 3) + 1);
  }
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
};

/**
 * 最简 baseline JPEG：16×16 灰度、单一量化表、仅使用 DC 类别 0 与 AC EOB 的
 * 自建 Huffman 表，因此不需要外部编解码依赖；结构样例用于协议/清单校验。
 */
export const buildSyntheticScannedJpeg = (): Uint8Array => {
  const marker = (code: number, payload: readonly number[]): number[] => [
    0xff,
    code,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 0xff,
    ...payload,
  ];
  const quantization = [0x00, ...new Array<number>(64).fill(1)];
  const frame = [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00];
  const dcTable = [0x00, ...new Array<number>(3).fill(0), 12, ...new Array<number>(12).fill(0), 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const acTable = [0x10, 1, ...new Array<number>(15).fill(0), 0x00];
  const scan = [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return Uint8Array.from([
    0xff, 0xd8,
    ...marker(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    ...marker(0xdb, quantization),
    ...marker(0xc0, frame),
    ...marker(0xc4, dcTable),
    ...marker(0xc4, acTable),
    ...marker(0xda, scan),
    0x07,
    0xff, 0xd9,
  ]);
};

/** 两页扫描 PDF：每页嵌入同一张位图（FlateDecode 原始 RGB），页码与尺寸可核验。 */
export const buildSyntheticScannedPdf = (): Uint8Array => {
  const { rgb } = scanPixels();
  const image = new Uint8Array(deflateSync(rgb));
  const content = ascii("q 320 0 0 200 0 0 cm /Im0 Do Q");
  const pages = [1, 2];
  const objects: Uint8Array[] = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>"),
    ascii(`<< /Type /Pages /Kids [${pages.map((page) => `${3 + (page - 1) * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`),
  ];
  for (const page of pages) {
    objects.push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << /XObject << /Im0 4 0 R >> >> /Contents ${4 + (page - 1) * 2} 0 R >>`,
      ),
      ascii(`<< /Length ${content.byteLength} >>\nstream\n${new TextDecoder().decode(content)}\nendstream`),
    );
  }
  objects.push(
    concat([
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${SCAN_WIDTH} /Height ${SCAN_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.byteLength} >>\nstream\n`,
      ),
      image,
      ascii("\nendstream"),
    ]),
  );
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).byteLength);
    pdf += `${index + 1} 0 obj\n${new TextDecoder().decode(object)}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
};

export const OCR_FIXTURE_MEDIA_TYPES = Object.freeze({
  "synthetic-scanned.pdf": "application/pdf",
  "synthetic-scanned.png": "image/png",
  "synthetic-scanned.jpeg": "image/jpeg",
});

export interface AcceptanceManifestV1 {
  readonly schemaVersion: "1";
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly synthetic: true;
  readonly awaitingClientReview: true;
  readonly note: string;
  readonly samples: ReadonlyArray<{
    readonly fileName: string;
    readonly mediaType: string;
    readonly pageCount: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly keyFields: ReadonlyArray<{
    readonly fieldId: string;
    readonly pageNumber: number;
    readonly expectedText: string;
  }>;
  readonly qualityPolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly deploymentRef: { readonly entityId: string; readonly versionId: string };
}

export const buildAcceptanceManifest = (): AcceptanceManifestV1 => ({
  schemaVersion: "1",
  manifestId: "c13-synthetic-scanned-acceptance",
  manifestVersion: "1",
  synthetic: true,
  awaitingClientReview: true,
  note: "合成样例、待甲方复核；真实识别准确率由 C37 预置服务与甲方脱敏样例验证。",
  samples: [
    { fileName: "synthetic-scanned.pdf", mediaType: "application/pdf", pageCount: 2, width: 320, height: 200 },
    { fileName: "synthetic-scanned.png", mediaType: "image/png", pageCount: 1, width: 320, height: 200 },
    { fileName: "synthetic-scanned.jpeg", mediaType: "image/jpeg", pageCount: 1, width: 16, height: 16 },
  ],
  keyFields: [
    { fieldId: "page_1_heading", pageNumber: 1, expectedText: "合成扫描样例第一页标题" },
    { fieldId: "page_2_span_value", pageNumber: 2, expectedText: "监测值12.5" },
  ],
  qualityPolicyRef: { entityId: "ocr-quality-policy", versionId: "1" },
  deploymentRef: { entityId: "ocr-deployment", versionId: "1" },
});

const fixtureUrl = (name: string): URL =>
  new URL(`./fixtures/${name}`, import.meta.url);

export const loadOcrFixture = async (name: keyof typeof OCR_FIXTURE_MEDIA_TYPES): Promise<Uint8Array> =>
  new Uint8Array(await readFile(fixtureUrl(name)));

export const loadAcceptanceManifest = async (): Promise<AcceptanceManifestV1> =>
  JSON.parse(
    await readFile(fixtureUrl("acceptance-manifest.v1.json"), "utf8"),
  ) as AcceptanceManifestV1;

export const OCR_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";

export const ocrTestAuthorization = (overrides: Record<string, unknown> = {}) =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "auth-ocr", versionId: "1" },
    },
    actorId: "actor-ocr",
    projectId: "project-ocr",
    grantedCapabilities: ["engineering-data.read", "engineering-data.write"],
    spatialScopeRefs: [{ kind: "spatial-scope", reference: { entityId: "scope-ocr", versionId: "1" } }],
    sourceAccessGrantRefs: [
      { kind: "source-access-grant", reference: { entityId: "grant-ocr", versionId: "1" } },
    ],
    authorizationPolicyRef: { entityId: "access-policy", versionId: "1" },
    decidedAt: OCR_TEST_TIMESTAMP,
    invocation: { kind: "human" },
    ...overrides,
  });

export const ocrTestSource = (): SourceProcessingInputV1 => ({
  sourceVersionRef: {
    kind: "source-version",
    reference: { entityId: "source_ocr", versionId: "1" },
  },
  projectId: "project-ocr",
  sourceId: "source_ocr",
  sourceItemId: "item-ocr",
  projectRevisionRef: {
    kind: "project-revision",
    reference: { entityId: "project-ocr", versionId: "1" },
  },
  spatialScopeRefs: [
    { kind: "spatial-scope", reference: { entityId: "scope-ocr", versionId: "1" } },
  ],
  sourceArtifactRef: {
    kind: "content-artifact",
    reference: { entityId: "source_ocr", versionId: `sha256:${"a".repeat(64)}` },
  },
  metadataArtifactRef: {
    kind: "content-artifact",
    reference: { entityId: "source_ocr_metadata", versionId: `sha256:${"b".repeat(64)}` },
  },
  sourceAccessGrantRef: {
    kind: "source-access-grant",
    reference: { entityId: "grant-ocr", versionId: "1" },
  },
  applicabilityMetadataSnapshotRef: {
    kind: "applicability-metadata-snapshot",
    reference: { entityId: "snapshot-ocr", versionId: "1" },
  },
});

export const ocrTestCommand = (
  overrides: Partial<StructuredDocumentConversionCommandV1> = {},
): StructuredDocumentConversionCommandV1 => {
  const source = ocrTestSource();
  return StructuredDocumentConversionCommandV1Schema.parse({
    schemaVersion: "1",
    conversionId: "conversion-ocr",
    idempotencyKey: "conversion-ocr-key",
    runId: "run-ocr",
    threadId: "thread-ocr",
    issuedAt: OCR_TEST_TIMESTAMP,
    deadlineAt: "2030-01-01T00:30:00.000Z",
    projectId: source.projectId,
    actorId: "actor-ocr",
    authorization: ocrTestAuthorization(),
    sourceVersionRef: source.sourceVersionRef,
    sourceArtifactRef: source.sourceArtifactRef,
    mediaType: "application/pdf",
    input: { kind: "ocr-layout" },
    conversionPolicyRef: { entityId: "document-conversion-policy", versionId: "1" },
    qualityPolicyRef: { entityId: "ocr-quality-policy", versionId: "1" },
    converterDeploymentRef: { entityId: "ocr-deployment", versionId: "1" },
    ...overrides,
  });
};

export const ocrTestConfig = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  deployment: {
    schemaVersion: "1",
    deploymentRef: { entityId: "ocr-deployment", versionId: "1" },
    serviceBuildRef: { entityId: "paddleocr", versionId: "3.7.0" },
    pipelineRef: { entityId: "pp-structurev3", versionId: "3.7.0" },
    modelVersionRefs: [
      { entityId: "layout-model", versionId: "3.7.0" },
      { entityId: "ocr-model", versionId: "3.7.0" },
      { entityId: "table-model", versionId: "3.7.0" },
    ],
    resourceAllocationRef: { entityId: "ocr-gpu-quota", versionId: "1" },
    retryPolicyRef: { entityId: "ocr-retry-policy", versionId: "1" },
    baseUrl: "http://ocr-service.test",
    protocolVersion: "pp-structurev3-layout-parsing-1",
    maxInputBytes: 8 * 1024 * 1024,
    maxResponseBytes: 16 * 1024 * 1024,
    maxPages: 32,
    maxConcurrentRequests: 2,
    maxQueuedRequests: 1,
    requestTimeoutMs: 5_000,
    maxAttempts: 3,
    retryDelayMs: 5,
    ...(overrides.deployment as Record<string, unknown> | undefined),
  },
  quality: {
    schemaVersion: "1",
    policyRef: { entityId: "ocr-quality-policy", versionId: "1" },
    requiredPageCoverage: 1,
    minimumNonEmptyPageRatio: 1,
    minimumValidRegionRatio: 1,
    minimumReadingOrderRatio: 1,
    minimumMeanServiceConfidence: 0.5,
    minimumRegionConfidence: 0.3,
    requireCompleteTableCells: true,
    minimumKeyFieldCoverage: 0,
    ...(overrides.quality as Record<string, unknown> | undefined),
  },
  keyFields: (overrides.keyFields as unknown[] | undefined) ?? [],
});

export interface OcrStubRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

export interface OcrStubScript {
  readonly status?: number;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly delayMs?: number;
  readonly drop?: boolean;
}

export interface OcrProtocolStubV1 {
  readonly origin: string;
  readonly requests: OcrStubRequest[];
  readonly pending: () => number;
  readonly baseUrl: string;
  enqueue(script: OcrStubScript): void;
  queueLength(): number;
  close(): Promise<void>;
}

/** 仅存在于测试目录的本地 HTTP 协议替身；生产包不导出替身，也不作任何自动回退。 */
export const startOcrProtocolStub = async (): Promise<OcrProtocolStubV1> => {
  const requests: OcrStubRequest[] = [];
  const scripts: OcrStubScript[] = [];
  let pending = 0;
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      pending += 1;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown;
        try {
          body = raw.length === 0 ? undefined : JSON.parse(raw);
        } catch {
          body = raw;
        }
        requests.push({ method: request.method ?? "GET", url: request.url ?? "/", body });
        const script = scripts.shift();
        if (script === undefined || script.drop === true) {
          request.socket.destroy();
          return;
        }
        if (script.delayMs !== undefined && script.delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, script.delayMs));
        }
        if (request.socket.destroyed) return;
        const payload =
          script.rawBody ?? JSON.stringify(script.body ?? { logId: "stub", errorCode: 0, result: { layoutParsingResults: [] } });
        response.writeHead(script.status ?? 200, { "content-type": "application/json" });
        response.end(payload);
      } finally {
        pending -= 1;
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server did not bind");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    baseUrl: origin,
    pending: () => pending,
    enqueue: (script) => scripts.push(script),
    queueLength: () => scripts.length,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
};

interface StoredArtifact {
  readonly bytes: Uint8Array;
  readonly result: ArtifactPutResultV1;
}

export interface OcrArtifactStoreLatchV1 extends ArtifactStoreV1 {
  readonly events: string[];
  readonly commands: ArtifactPutCommandV1[];
  readonly opened: ArtifactReadRequestV1[];
  bytesFor(artifactId: string): Uint8Array | undefined;
  bodyFor(artifactId: string): Record<string, unknown> | undefined;
  commandsFor(artifactId: string): ArtifactPutCommandV1[];
  failNextPut(error?: Error): void;
  failPutFor(artifactId: string): void;
  seedInput(bytes: Uint8Array, mediaType: string): SourceProcessingInputV1["sourceArtifactRef"];
}

/** C04 内存替身：内容工件返回 content-artifact，诊断工件返回 diagnostic-artifact。 */
export const createOcrArtifactStoreLatch = (): OcrArtifactStoreLatchV1 => {
  const artifacts = new Map<string, StoredArtifact>();
  const events: string[] = [];
  const commands: ArtifactPutCommandV1[] = [];
  const opened: ArtifactReadRequestV1[] = [];
  let failNext: Error | undefined;
  let failingArtifactId: string | undefined;
  return {
    events,
    commands,
    opened,
    bytesFor: (artifactId) => artifacts.get(artifactId)?.bytes,
    commandsFor: (artifactId) => commands.filter((command) => command.artifactId === artifactId),
    bodyFor: (artifactId) => {
      const bytes = artifacts.get(artifactId)?.bytes;
      return bytes === undefined
        ? undefined
        : (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
    },
    failNextPut: (error = new Error("artifact put failed")) => {
      failNext = error;
    },
    failPutFor: (artifactId) => {
      failingArtifactId = artifactId;
    },
    seedInput: (bytes, mediaType) => {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const artifactRef = {
        kind: "content-artifact" as const,
        reference: { entityId: "source_ocr", versionId: `sha256:${hash}` },
      };
      const manifest: ArtifactManifestV1 = {
        schemaVersion: "1",
        artifactRef,
        artifactKind: "content",
        content: { hash: { algorithm: "sha256", value: hash }, byteLength: bytes.byteLength },
        mediaType,
        purposeCode: "engineering-data.register-source-delivery",
        access: {
          projectId: "project-ocr",
          spatialScopeRefs: [
            { kind: "spatial-scope", reference: { entityId: "scope-ocr", versionId: "1" } },
          ],
          sourceAccessGrantRefs: [
            { kind: "source-access-grant", reference: { entityId: "grant-ocr", versionId: "1" } },
          ],
          authorizationPolicyRefs: [{ entityId: "access-policy", versionId: "1" }],
        },
        writePolicyRef: { entityId: "artifact-policy", versionId: "1" },
        parentArtifactRefs: [],
        evidenceReferences: [],
        producerCommandId: "seed-input",
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: "auth-ocr", versionId: "1" },
        },
        auditTrailRef: { kind: "audit-trail", reference: { entityId: "audit-seed", versionId: "1" } },
        occurredAt: OCR_TEST_TIMESTAMP,
        recordedAt: OCR_TEST_TIMESTAMP,
        persistedAt: OCR_TEST_TIMESTAMP,
      };
      artifacts.set("source_ocr", {
        bytes,
        result: ArtifactPutResultV1Schema.parse({
          artifactRef,
          manifest,
          manifestSha256: createHash("sha256").update("seed-input").digest("hex"),
          replayed: false,
          deduplicated: false,
        }),
      });
      return artifactRef;
    },
    async put(
      command: ArtifactPutCommandV1,
      content: AsyncIterable<Uint8Array>,
    ): Promise<ArtifactPutResultV1> {
      events.push(`put:${command.artifactId}`);
      if (failNext !== undefined) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      if (failingArtifactId === command.artifactId) throw new Error("artifact put failed");
      const parts: Uint8Array[] = [];
      for await (const chunk of content) parts.push(new Uint8Array(chunk));
      const bytes = concat(parts);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const artifactRef = {
        kind:
          command.artifactKind === "content"
            ? ("content-artifact" as const)
            : ("diagnostic-artifact" as const),
        reference: { entityId: command.artifactId, versionId: `sha256:${contentHash}` },
      };
      const manifest: ArtifactManifestV1 = {
        schemaVersion: "1",
        artifactRef,
        artifactKind: command.artifactKind,
        content: { hash: { algorithm: "sha256", value: contentHash }, byteLength: bytes.byteLength },
        mediaType: command.mediaType,
        purposeCode: command.purposeCode,
        access: {
          projectId: command.projectId,
          spatialScopeRefs: command.authorization.spatialScopeRefs,
          sourceAccessGrantRefs: command.authorization.sourceAccessGrantRefs,
          authorizationPolicyRefs: [command.authorization.authorizationPolicyRef],
        },
        writePolicyRef: { entityId: "artifact-policy", versionId: "1" },
        parentArtifactRefs: command.parentArtifactRefs,
        evidenceReferences: command.evidenceReferences,
        producerCommandId: command.commandId,
        authorizationContextRef: command.authorization.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: `audit-${command.commandId}`, versionId: "1" },
        },
        occurredAt: command.issuedAt,
        recordedAt: command.issuedAt,
        persistedAt: command.issuedAt,
      };
      const result = ArtifactPutResultV1Schema.parse({
        artifactRef,
        manifest,
        manifestSha256: createHash("sha256").update(command.commandId).digest("hex"),
        replayed: false,
        deduplicated: false,
      });
      commands.push(command);
      artifacts.set(command.artifactId, { bytes, result });
      return result;
    },
    async open(request: ArtifactReadRequestV1): Promise<ArtifactReadHandleV1> {
      events.push(`open:${request.artifactRef.reference.entityId}`);
      opened.push(request);
      const stored = artifacts.get(request.artifactRef.reference.entityId);
      if (stored === undefined) throw new Error("artifact not found");
      const verified: ArtifactReadReceiptV1 = {
        schemaVersion: "1",
        requestId: request.requestId,
        artifactRef: stored.result.artifactRef,
        content: stored.result.manifest.content,
        authorizationContextRef: stored.result.manifest.authorizationContextRef,
        verifiedAt: request.requestedAt,
      };
      return {
        manifest: stored.result.manifest,
        content: (async function* (): AsyncGenerator<Uint8Array> {
          yield new Uint8Array(stored.bytes);
        })(),
        verified: Promise.resolve(verified),
      };
    },
  };
};

export interface ContextSourceLatchV1 extends EngineeringContextSourceRegistryV1 {
  readonly registered: unknown[];
  readonly resolved: unknown[];
  failRegistration(error?: unknown): void;
}

export const createContextSourceLatch = (
  input: SourceProcessingInputV1 = ocrTestSource(),
): ContextSourceLatchV1 => {
  const registered: unknown[] = [];
  const resolved: unknown[] = [];
  let registrationFailure: unknown;
  return {
    registered,
    resolved,
    failRegistration: (error) => {
      registrationFailure = error;
    },
    resolveSourceProcessingInput: async (query): Promise<ContextSourceResultV1> => {
      resolved.push(query);
      return {
        kind: "succeeded",
        result: { kind: "source-processing-input", input },
      } as ContextSourceResultV1;
    },
    resolveSourceVersionForRead: async (): Promise<ContextSourceResultV1> =>
      ({
        kind: "succeeded",
        result: { kind: "source-processing-input", input },
      }) as ContextSourceResultV1,
    registerSegments: async (command): Promise<ContextSourceResultV1> => {
      if (registrationFailure !== undefined) throw registrationFailure;
      registered.push(command);
      return {
        kind: "succeeded",
        result: {
          kind: "source-segment-set",
          segmentSet: {
            sourceSegmentSetRef: {
              kind: "source-segment-set",
              reference: { entityId: `segment-set-${command.commandId}`, versionId: "1" },
            },
          },
        },
      } as unknown as ContextSourceResultV1;
    },
    reviseContext: async (): Promise<ContextSourceResultV1> =>
      ({ kind: "failed", error: new Error("not used") }) as unknown as ContextSourceResultV1,
    createApplicabilitySnapshot: async (): Promise<ContextSourceResultV1> =>
      ({ kind: "failed", error: new Error("not used") }) as unknown as ContextSourceResultV1,
  };
};

export interface OcrTestHarnessV1 {
  readonly adapter: StructuredDocumentConversionAdapter;
  readonly artifactStore: OcrArtifactStoreLatchV1;
  readonly contextSource: ContextSourceLatchV1;
  readonly command: StructuredDocumentConversionCommandV1;
  readonly source: SourceProcessingInputV1;
}

export interface OcrTestHarnessOptionsV1 {
  readonly baseUrl: string;
  readonly inputBytes: Uint8Array;
  readonly mediaType?: string;
  readonly command?: Partial<StructuredDocumentConversionCommandV1>;
  readonly config?: Record<string, unknown>;
  readonly now?: () => Date;
  readonly artifactStore?: OcrArtifactStoreLatchV1;
  readonly contextSource?: ContextSourceLatchV1;
}

export const createOcrTestHarness = (options: OcrTestHarnessOptionsV1): OcrTestHarnessV1 => {
  const mediaType = options.mediaType ?? "application/pdf";
  const artifactStore = options.artifactStore ?? createOcrArtifactStoreLatch();
  const artifactRef = artifactStore.seedInput(options.inputBytes, mediaType);
  const source: SourceProcessingInputV1 = { ...ocrTestSource(), sourceArtifactRef: artifactRef };
  const contextSource = options.contextSource ?? createContextSourceLatch(source);
  const command = ocrTestCommand({
    mediaType,
    sourceArtifactRef: artifactRef,
    ...options.command,
  });
  const adapter = new StructuredDocumentConversionAdapter({
    contextSource,
    artifactStore,
    qualityPolicyRef: { entityId: "ocr-quality-policy", versionId: "1" },
    converterDeploymentRef: { entityId: "ocr-deployment", versionId: "1" },
    ocrLayoutParser: createPaddleOcrLayoutParser({
      config: ocrTestConfig({
        ...options.config,
        deployment: {
          ...(options.config?.deployment as Record<string, unknown> | undefined),
          baseUrl: options.baseUrl,
        },
      }),
      now: options.now ?? (() => new Date(OCR_TEST_TIMESTAMP)),
    }),
  });
  return { adapter, artifactStore, contextSource, command, source };
};

export interface OcrStubRegionV1 {
  readonly block_label: string;
  readonly block_content: string;
  readonly block_bbox: readonly [number, number, number, number];
  readonly block_id: number;
}

export const ocrTextRegion = (
  label: string,
  text: string,
  bbox: readonly [number, number, number, number],
  blockId: number,
): OcrStubRegionV1 => ({ block_label: label, block_content: text, block_bbox: bbox, block_id: blockId });

export const ocrPage = (
  pageIndex: number,
  regions: readonly OcrStubRegionV1[],
  extras: Record<string, unknown> = {},
) => ({
  prunedResult: {
    page_index: pageIndex,
    doc_preprocessor_res: { output_img_shape: [200, 320] },
    parsing_res_list: regions,
    overall_ocr_res: {
      rec_texts: regions.map((region) => region.block_content),
      rec_scores: regions.map(() => 0.93),
      rec_boxes: regions.map((region) => region.block_bbox),
    },
    ...extras,
  },
});

export const ocrTablePage = (
  pageIndex: number,
  cells: readonly (readonly [number, number, number, number])[],
  texts: readonly string[],
) => ({
  prunedResult: {
    page_index: pageIndex,
    doc_preprocessor_res: { output_img_shape: [200, 320] },
    parsing_res_list: [ocrTextRegion("table", "", [20, 20, 300, 180], 1)],
    table_res_list: [
      {
        cell_box_list: cells,
        table_ocr_pred: {
          rec_texts: texts,
          rec_scores: texts.map(() => 0.91),
          rec_boxes: cells,
        },
      },
    ],
    overall_ocr_res: { rec_texts: texts, rec_scores: texts.map(() => 0.91), rec_boxes: cells },
  },
});

export const layoutResponse = (
  pages: readonly unknown[],
  extras: Record<string, unknown> = {},
): Record<string, unknown> => ({
  logId: "stub-log",
  errorCode: 0,
  errorMsg: "Success",
  result: { layoutParsingResults: pages, ...extras },
});

