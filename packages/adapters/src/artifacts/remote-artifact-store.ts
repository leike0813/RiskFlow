import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import {
  ArtifactManifestV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactPutResultV1Schema,
  ArtifactReadReceiptV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactPutCommandV1,
  type ArtifactReadHandleV1,
  type ArtifactReadReceiptV1,
  type ArtifactReadRequestV1,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";

import {
  ARTIFACT_STREAM_ERROR_V1,
  ARTIFACT_STREAM_FRAME_V1,
  ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES,
  ArtifactStreamDecoderV1,
  ArtifactStreamError,
  chunkArtifactStreamV1,
  encodeArtifactStreamEndV1,
  encodeArtifactStreamJsonV1,
  type ArtifactStreamDirectionV1,
  type ArtifactStreamLimitsV1,
} from "./artifact-stream-service.js";

/**
 * C37 D-18：应用 VM 侧的 C04 工件 HTTPS 流适配。
 *
 * 它只搬运字节：所有 DTO 仍是原 C04 Schema，所有权限与事务仍在数据 VM 与应用 VM 的
 * PostgreSQL 事务内判定。传输凭据不等于业务授权——服务端会用真实 C06 上下文复验。
 * 取消、超时与断流都不产生成功响应；重试沿原 commandId/idempotencyKey，不生成新身份。
 */

export interface ArtifactTransportPolicyV1 {
  readonly artifactEndpointRef: string;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly metadataMaxBytes: number;
  readonly maxConcurrentRequests: number;
  readonly shutdownTimeoutMs: number;
}

/** 应用 VM 侧的窄 HTTP 执行器；宿主注入真实 HTTPS/mTLS 实现，测试注入受控替身。 */
export type ArtifactStreamRequestV1 = (input: {
  readonly method: "POST";
  readonly path: "/internal/v1/artifacts/put" | "/internal/v1/artifacts/open";
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array> | Uint8Array;
  readonly signal: AbortSignal;
}) => AsyncIterable<Uint8Array>;

export interface RemoteArtifactStoreV1Options {
  readonly request: ArtifactStreamRequestV1;
  readonly policy: ArtifactTransportPolicyV1;
  /** C04 ArtifactStorePolicyV1 的 maxArtifactBytes，作为累计上限。 */
  readonly maxArtifactBytes: number;
  /**
   * 参考登记守卫。应用 VM 以自己的 PostgreSQL 事务检查登记，不经 HTTP，
   * 也不把 getPostgresTransaction 暴露给宿主。
   */
  readonly referenceGuard: ArtifactReferenceGuardV1;
  readonly requestIdGenerator?: () => string;
}

export interface RemoteArtifactStoreHandleV1 extends ArtifactStoreV1 {
  readonly referenceGuard: ArtifactReferenceGuardV1;
  /** 在有限期限内停止新请求；超时由宿主按 systemd 边界处理。 */
  drain(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

const streamLimits = (
  policy: ArtifactTransportPolicyV1,
  maxArtifactBytes: number,
): ArtifactStreamLimitsV1 => ({
  metadataMaxBytes: policy.metadataMaxBytes,
  maxDataFrameBytes: ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES,
  maxTotalBytes: maxArtifactBytes,
});

/** 逐帧消费 async iterable；任一帧违规立即中断迭代器并抛出。 */
const collectFrames = async function* (
  source: AsyncIterable<Uint8Array>,
  direction: ArtifactStreamDirectionV1,
  limits: ArtifactStreamLimitsV1,
): AsyncGenerator<{ type: number; payload: Uint8Array }> {
  const decoder = new ArtifactStreamDecoderV1(direction, limits);
  for await (const chunk of source) {
    decoder.push(chunk);
    for (;;) {
      const frame = decoder.next();
      if (frame === undefined) break;
      yield frame;
    }
  }
  // 结束帧由方向决定是否必需；open 响应允许以错误帧收口。
  decoder.finish(direction !== "open-request");
};

const jsonOf = (payload: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(payload));

export const createRemoteArtifactStoreV1 = (
  options: RemoteArtifactStoreV1Options,
): RemoteArtifactStoreHandleV1 => {
  const { policy, referenceGuard } = options;
  const limits = streamLimits(policy, options.maxArtifactBytes);
  let inFlight = 0;
  let draining = false;
  let requestCounter = 0;
  const nextRequestId = options.requestIdGenerator ?? (() => `artifact-stream-${++requestCounter}`);

  const acquire = (): AbortController => {
    if (draining) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.draining);
    }
    if (inFlight >= policy.maxConcurrentRequests) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.overConcurrentLimit);
    }
    inFlight += 1;
    return new AbortController();
  };

  return {
    referenceGuard,

    async put(command: ArtifactPutCommandV1, content: AsyncIterable<Uint8Array>) {
      const parsedCommand = ArtifactPutCommandV1Schema.parse(command);
      const controller = acquire();
      const timer = setTimeout(() => controller.abort(), policy.totalTimeoutMs);
      try {
        const body = (async function* () {
          yield encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, parsedCommand);
          for await (const frame of chunkArtifactStreamV1(
            content,
            ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES,
          )) {
            if (controller.signal.aborted)
              throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.aborted);
            yield frame;
          }
          yield encodeArtifactStreamEndV1();
        })();

        const response = options.request({
          method: "POST",
          path: "/internal/v1/artifacts/put",
          contentType: "application/vnd.riskflow.artifact-stream-v1",
          headers: { "x-artifact-request-id": nextRequestId() },
          body,
          signal: controller.signal,
        });

        // put 响应是单个 JSON（ArtifactPutResultV1）；耐久登记后才发。
        // 服务端以类型 4 错误帧拒绝时，必须收口为失败而不是当作成功。
        let payload: unknown;
        let sawPayload = false;
        for await (const frame of collectFrames(response, "put-response", limits)) {
          if (frame.type === ARTIFACT_STREAM_FRAME_V1.error) {
            throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.remoteError);
          }
          // 类型 3 在 put 响应里是零长度结束帧，只用于收口，不承载结果。
          if (frame.type === ARTIFACT_STREAM_FRAME_V1.receipt) {
            if (frame.payload.byteLength !== 0) {
              throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.nonZeroEndFrame);
            }
            continue;
          }
          if (frame.type !== ARTIFACT_STREAM_FRAME_V1.json) {
            throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unexpectedFrame);
          }
          payload = jsonOf(frame.payload);
          sawPayload = true;
        }
        if (!sawPayload || payload === undefined) {
          throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.missingJsonFrame);
        }
        return ArtifactPutResultV1Schema.parse(payload);
      } finally {
        clearTimeout(timer);
        inFlight -= 1;
      }
    },

    async open(request: ArtifactReadRequestV1): Promise<ArtifactReadHandleV1> {
      const parsedRequest = ArtifactReadRequestV1Schema.parse(request);
      const controller = acquire();
      const timer = setTimeout(() => controller.abort(), policy.totalTimeoutMs);
      const finish = () => {
        clearTimeout(timer);
        inFlight -= 1;
      };

      const body = encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, parsedRequest);
      const response = options.request({
        method: "POST",
        path: "/internal/v1/artifacts/open",
        contentType: "application/vnd.riskflow.artifact-stream-v1",
        headers: { "x-artifact-request-id": nextRequestId() },
        // 请求侧也是帧流：单个 JSON 帧包成 async iterable。
        body: (async function* (): AsyncGenerator<Uint8Array> {
          yield body;
        })(),
        signal: controller.signal,
      });

      // 单一迭代器顺序消费：先 manifest，再内容，最后回执；不得二次读取。
      const frames = collectFrames(response, "open-response", limits);
      const iterator = frames[Symbol.asyncIterator]();
      let receipt: ArtifactReadReceiptV1 | undefined;

      const first = await iterator.next();
      if (first.done === true) {
        finish();
        throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.missingJsonFrame);
      }
      // 服务端以错误帧拒绝时不返回 manifest，也不泄漏内部存在性。
      if (first.value.type === ARTIFACT_STREAM_FRAME_V1.error) {
        finish();
        throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.remoteError);
      }
      if (first.value.type !== ARTIFACT_STREAM_FRAME_V1.json) {
        finish();
        throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unexpectedFrame);
      }
      const resolvedManifest = ArtifactManifestV1Schema.parse(jsonOf(first.value.payload));

      // completed 只反映消费结果，自身不驱动迭代。
      // 与 C04 filesystem store 相同：显式 deferred，避免 ES2023 下缺 withResolvers。
      let resolveVerified!: (receipt: ArtifactReadReceiptV1) => void;
      let rejectVerified!: (error: unknown) => void;
      const completed = new Promise<ArtifactReadReceiptV1>((resolvePromise, rejectPromise) => {
        resolveVerified = resolvePromise;
        rejectVerified = rejectPromise;
      });
      void completed.catch(() => undefined);

      const content = (async function* (): AsyncGenerator<Uint8Array> {
        let drained = false;
        try {
          for (;;) {
            const result = await iterator.next();
            if (result.done === true) {
              drained = true;
              break;
            }
            const frame = result.value;
            if (frame.type === ARTIFACT_STREAM_FRAME_V1.bytes) {
              yield frame.payload;
              continue;
            }
            if (frame.type === ARTIFACT_STREAM_FRAME_V1.error) {
              throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.remoteError);
            }
            if (frame.type === ARTIFACT_STREAM_FRAME_V1.receipt) {
              receipt = ArtifactReadReceiptV1Schema.parse(jsonOf(frame.payload));
              continue;
            }
            throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unexpectedFrame);
          }
          // 只有消费方把正文读完，且回执与 manifest 一致，才算 completed。
          if (receipt === undefined) {
            throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.incompleteRead);
          }
          if (
            receipt.artifactRef.reference.entityId !==
              resolvedManifest.artifactRef.reference.entityId ||
            receipt.content.hash.value !== resolvedManifest.content.hash.value ||
            receipt.content.byteLength !== resolvedManifest.content.byteLength
          ) {
            throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.receiptMismatch);
          }
          resolveVerified(receipt);
        } catch (error) {
          rejectVerified(error);
          throw error;
        } finally {
          // 提前 break 时必须主动关掉底层迭代器，否则服务端流与连接不会收口。
          if (!drained) {
            await iterator.return?.(undefined);
            rejectVerified(new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.incompleteRead));
          }
          finish();
        }
      })();

      return { manifest: resolvedManifest, content, completed };
    },

    async drain(timeoutMs: number) {
      draining = true;
      const deadline = Date.now() + Math.min(timeoutMs, policy.shutdownTimeoutMs);
      while (inFlight > 0 && Date.now() < deadline) {
        await delay(10);
      }
      // 超时不是停写证明；宿主据此报告未完成，不伪造已收口。
    },
    async close() {
      draining = true;
    },
  };
};

export type { Readable };
