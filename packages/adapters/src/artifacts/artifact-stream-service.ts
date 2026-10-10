import type { Readable } from "node:stream";

/**
 * C37 D-18：数据 VM 工件流协议。
 *
 * 帧格式固定为「一字节类型 + 四字节大端长度 + payload」：
 * put 请求 1=JSON command、2=bytes、3=结束帧（零长度）；
 * open 响应 1=ArtifactManifestV1、2=bytes、3=ArtifactReadReceiptV1、4=既有 ModuleErrorV1。
 * 未知/重复/缺帧一律拒绝；JSON 不超 metadataMaxBytes、数据帧不超 1MiB。
 * 该编解码只搬运字节，不解释业务语义，也不放宽 C04 的 DTO 与权限。
 */

export const ARTIFACT_STREAM_CONTENT_TYPE = "application/vnd.riskflow.artifact-stream-v1";

export const ARTIFACT_STREAM_FRAME_V1 = {
  json: 1,
  bytes: 2,
  end: 3,
  receipt: 3,
  error: 4,
} as const;

export type ArtifactStreamFrameTypeV1 =
  (typeof ARTIFACT_STREAM_FRAME_V1)[keyof typeof ARTIFACT_STREAM_FRAME_V1];

export const ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES = 1_048_576;

/** 静态帧类型合法集合；数字键用 Record 表达，未知类型一律拒绝。 */
const KNOWN_FRAME_TYPES: Readonly<Record<number, true>> = Object.freeze({
  1: true,
  2: true,
  3: true,
  4: true,
});

export const ARTIFACT_STREAM_ERROR_V1 = {
  unknownFrameType: "ARTIFACT_STREAM_UNKNOWN_FRAME",
  truncatedHeader: "ARTIFACT_STREAM_TRUNCATED_HEADER",
  truncatedPayload: "ARTIFACT_STREAM_TRUNCATED_PAYLOAD",
  duplicateJsonFrame: "ARTIFACT_STREAM_DUPLICATE_JSON_FRAME",
  missingJsonFrame: "ARTIFACT_STREAM_MISSING_JSON_FRAME",
  missingEndFrame: "ARTIFACT_STREAM_MISSING_END_FRAME",
  frameTooLarge: "ARTIFACT_STREAM_FRAME_TOO_LARGE",
  metadataTooLarge: "ARTIFACT_STREAM_METADATA_TOO_LARGE",
  totalExceeded: "ARTIFACT_STREAM_TOTAL_EXCEEDED",
  unexpectedFrame: "ARTIFACT_STREAM_UNEXPECTED_FRAME",
  nonZeroEndFrame: "ARTIFACT_STREAM_NON_ZERO_END_FRAME",
  incompleteRead: "ARTIFACT_STREAM_INCOMPLETE_READ",
  aborted: "ARTIFACT_STREAM_ABORTED",
  draining: "ARTIFACT_STREAM_DRAINING",
  overConcurrentLimit: "ARTIFACT_STREAM_OVER_CONCURRENT_LIMIT",
  remoteError: "ARTIFACT_STREAM_REMOTE_ERROR",
  receiptMismatch: "ARTIFACT_STREAM_RECEIPT_MISMATCH",
} as const;
export type ArtifactStreamErrorCodeV1 =
  (typeof ARTIFACT_STREAM_ERROR_V1)[keyof typeof ARTIFACT_STREAM_ERROR_V1];

export class ArtifactStreamError extends Error {
  readonly code: ArtifactStreamErrorCodeV1;
  readonly detail: string;

  constructor(code: ArtifactStreamErrorCodeV1, detail = "") {
    super(code);
    this.name = "ArtifactStreamError";
    this.code = code;
    this.detail = detail;
  }
}

const HEADER_BYTES = 5;

/**
 * 流方向。帧类型 3 在两个方向含义不同：put 请求是零长度结束帧，
 * open 响应是 ArtifactReadReceiptV1，因此解码必须显式声明方向。
 */
export type ArtifactStreamDirectionV1 =
  "put-request" | "put-response" | "open-request" | "open-response";

export interface ArtifactStreamLimitsV1 {
  readonly metadataMaxBytes: number;
  readonly maxDataFrameBytes: number;
  /** C04 maxArtifactBytes；累计载荷超过即拒绝。 */
  readonly maxTotalBytes: number;
}

export const encodeArtifactStreamFrameV1 = (type: number, payload: Uint8Array): Uint8Array => {
  const frame = new Uint8Array(HEADER_BYTES + payload.length);
  frame[0] = type;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, HEADER_BYTES);
  return frame;
};

export const encodeArtifactStreamJsonV1 = (type: number, value: unknown): Uint8Array =>
  encodeArtifactStreamFrameV1(type, new TextEncoder().encode(JSON.stringify(value)));

export const encodeArtifactStreamEndV1 = (): Uint8Array =>
  encodeArtifactStreamFrameV1(ARTIFACT_STREAM_FRAME_V1.end, new Uint8Array(0));

export interface DecodedArtifactStreamFrameV1 {
  readonly type: number;
  readonly payload: Uint8Array;
}

/**
 * 顺序帧解码器。调用方逐帧消费；任一违规立即抛 ArtifactStreamError，
 * 不做部分成功，也不回退到“尽力而为”的解析。
 */
export class ArtifactStreamDecoderV1 {
  readonly #limits: ArtifactStreamLimitsV1;
  readonly #direction: ArtifactStreamDirectionV1;
  #buffer: Uint8Array = new Uint8Array(0);
  #totalBytes = 0;
  #sawJson = false;
  #sawTerminator = false;

  constructor(direction: ArtifactStreamDirectionV1, limits: ArtifactStreamLimitsV1) {
    this.#direction = direction;
    this.#limits = limits;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  get sawJson(): boolean {
    return this.#sawJson;
  }

  push(chunk: Uint8Array): void {
    if (this.#buffer.length === 0) {
      this.#buffer = chunk.slice();
      return;
    }
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;
  }

  next(): DecodedArtifactStreamFrameV1 | undefined {
    if (this.#buffer.length < HEADER_BYTES) return undefined;
    const view = new DataView(this.#buffer.buffer, this.#buffer.byteOffset, this.#buffer.length);
    const type = this.#buffer[0]!;
    const length = view.getUint32(1, false);

    // open 请求是单一 JSON（普通 HTTP body），其余三个方向走帧协议。
    const framed = this.#direction !== "open-request";
    if (!framed) {
      if (type !== ARTIFACT_STREAM_FRAME_V1.json) {
        throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unexpectedFrame, `type=${type}`);
      }
    } else if (KNOWN_FRAME_TYPES[type] !== true) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unknownFrameType, `type=${type}`);
    }
    const terminatorIsEmpty =
      this.#direction === "put-request" || this.#direction === "put-response";
    if (type === ARTIFACT_STREAM_FRAME_V1.bytes && length > this.#limits.maxDataFrameBytes) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.frameTooLarge, `length=${length}`);
    }
    if (type !== ARTIFACT_STREAM_FRAME_V1.bytes && length > this.#limits.metadataMaxBytes) {
      throw new ArtifactStreamError(
        ARTIFACT_STREAM_ERROR_V1.metadataTooLarge,
        `type=${type} length=${length}`,
      );
    }
    // put 的结束帧必须零长度；open 响应里类型 3 是回执，可以带 JSON。
    if (terminatorIsEmpty && this.#sawTerminator && length !== 0) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.nonZeroEndFrame);
    }
    if (this.#buffer.length < HEADER_BYTES + length) return undefined;
    const payload = this.#buffer.slice(HEADER_BYTES, HEADER_BYTES + length);
    this.#buffer = this.#buffer.slice(HEADER_BYTES + length);
    this.#totalBytes += length;
    if (this.#totalBytes > this.#limits.maxTotalBytes) {
      throw new ArtifactStreamError(
        ARTIFACT_STREAM_ERROR_V1.totalExceeded,
        `total=${this.#totalBytes}`,
      );
    }
    if (type === ARTIFACT_STREAM_FRAME_V1.json) {
      if (this.#sawJson) {
        throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.duplicateJsonFrame);
      }
      this.#sawJson = true;
    }
    if (type === ARTIFACT_STREAM_FRAME_V1.receipt && terminatorIsEmpty) this.#sawTerminator = true;
    return { type, payload };
  }

  /**
   * 流结束后确认没有未消费字节与缺失帧。
   * open 响应必须以回执或错误帧收口；put 方向必须以零长度结束帧收口。
   */
  finish(requireJson: boolean): void {
    if (this.#buffer.length > 0) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.truncatedPayload);
    }
    if (requireJson && !this.#sawJson) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.missingJsonFrame);
    }
    if (this.#direction === "put-request" || this.#direction === "put-response") {
      if (!this.#sawTerminator) {
        throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.missingEndFrame);
      }
    }
  }
}

/** 把 AsyncIterable<Uint8Array> 按固定数据帧大小切分，不缓冲整个工件。 */
export const chunkArtifactStreamV1 = async function* (
  content: AsyncIterable<Uint8Array>,
  maxFrameBytes: number,
): AsyncGenerator<Uint8Array> {
  let pending = new Uint8Array(0);
  for await (const chunk of content) {
    let offset = 0;
    // 先消费上一轮残留，再拼接本轮数据，保证每帧不超过上限。
    if (pending.length > 0) {
      const take = Math.min(maxFrameBytes - pending.length, chunk.length);
      const merged = new Uint8Array(pending.length + take);
      merged.set(pending);
      merged.set(chunk.subarray(0, take), pending.length);
      pending = merged;
      offset = take;
      if (pending.length === maxFrameBytes) {
        yield encodeArtifactStreamFrameV1(ARTIFACT_STREAM_FRAME_V1.bytes, pending);
        pending = new Uint8Array(0);
      }
    }
    while (offset < chunk.length) {
      const take = Math.min(maxFrameBytes, chunk.length - offset);
      yield encodeArtifactStreamFrameV1(
        ARTIFACT_STREAM_FRAME_V1.bytes,
        chunk.subarray(offset, offset + take),
      );
      offset += take;
    }
  }
  if (pending.length > 0) {
    yield encodeArtifactStreamFrameV1(ARTIFACT_STREAM_FRAME_V1.bytes, pending);
  }
};

export type ArtifactStreamReadableV1 = Pick<Readable, "on" | "once" | "destroy">;
