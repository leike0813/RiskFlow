import { setTimeout as delay } from "node:timers/promises";

import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactPutCommandV1,
  type ArtifactReadRequestV1,
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
  type ArtifactStreamLimitsV1,
} from "./artifact-stream-service.js";

/**
 * C37 D-18：数据 VM 侧的内部工件流服务。
 *
 * 只有 put 与 open 两个闭合动作，没有通用路径、列表、删除或远程 maintenance。
 * 请求内的 C06 上下文由宿主在真实数据库中复验后才交给 C04：
 * 传输凭据（mTLS）只证明调用方是应用 VM，不构成业务授权。
 */

export interface ArtifactAuthorizationVerifierV1 {
  /** 复验当前主体、工程、capability、资料与空间；不通过即拒绝，不查询存在性。 */
  verifyPut(command: ArtifactPutCommandV1): Promise<boolean>;
  verifyOpen(request: ArtifactReadRequestV1): Promise<boolean>;
}

export interface ArtifactStreamServiceV1Options {
  readonly store: ArtifactStoreV1;
  readonly verifier: ArtifactAuthorizationVerifierV1;
  readonly limits: ArtifactStreamLimitsV1;
  /** 服务端在有限期限停止接受新 put/open。 */
  readonly shutdownTimeoutMs: number;
}

export interface ArtifactStreamServiceHandleV1 {
  handlePut(body: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
  handleOpen(body: AsyncIterable<Uint8Array>): Promise<AsyncIterable<Uint8Array>>;
  drain(timeoutMs: number): Promise<boolean>;
}

export const createArtifactStreamServiceV1 = (
  options: ArtifactStreamServiceV1Options,
): ArtifactStreamServiceHandleV1 => {
  let draining = false;
  let inFlight = 0;

  /** 授权不成立时统一以远端错误帧收口，不暴露内部存在性或拒绝细节。 */
  const refuse = (): ArtifactStreamError =>
    new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.remoteError);

  const guardAdmission = (): void => {
    if (draining) {
      throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.draining);
    }
    inFlight += 1;
  };

  const errorFrame = (error: unknown): Uint8Array => {
    const code =
      error instanceof ArtifactStreamError ? error.code : ARTIFACT_STREAM_ERROR_V1.remoteError;
    return encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.error, { code });
  };

  return {
    handlePut(body) {
      guardAdmission();
      return (async function* (): AsyncGenerator<Uint8Array> {
        // C04 会按需拉取正文，因此帧源必须能被内容生成器主动驱动：
        // 命令帧先解析出来，其余帧由 content 迭代器一边拉 body 一边消费。
        const decoder = new ArtifactStreamDecoderV1("put-request", options.limits);
        const iterator = body[Symbol.asyncIterator]();
        let exhausted = false;

        const pump = async (): Promise<void> => {
          if (exhausted) return;
          const next = await iterator.next();
          if (next.done === true) {
            exhausted = true;
            decoder.finish(true);
            return;
          }
          decoder.push(next.value);
        };

        try {
          let command: ArtifactPutCommandV1 | undefined;
          for (;;) {
            await pump();
            const frame = decoder.next();
            if (frame === undefined) continue;
            if (frame.type !== ARTIFACT_STREAM_FRAME_V1.json) {
              throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unexpectedFrame);
            }
            command = ArtifactPutCommandV1Schema.parse(
              JSON.parse(new TextDecoder().decode(frame.payload)),
            );
            break;
          }
          if (command === undefined) {
            throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.missingJsonFrame);
          }
          if (!(await options.verifier.verifyPut(command))) throw refuse();

          const content = (async function* (): AsyncGenerator<Uint8Array> {
            for (;;) {
              await pump();
              const next = decoder.next();
              if (next === undefined) return;
              if (next.type === ARTIFACT_STREAM_FRAME_V1.bytes) {
                yield next.payload;
                continue;
              }
              if (next.type === ARTIFACT_STREAM_FRAME_V1.receipt) return;
              throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.unexpectedFrame);
            }
          })();

          // 耐久登记成功后才发出结果。
          const result = await options.store.put(command, content);
          yield encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, result);
          yield encodeArtifactStreamEndV1();
        } catch (error) {
          yield errorFrame(error);
        } finally {
          inFlight -= 1;
        }
      })();
    },

    async handleOpen(body) {
      guardAdmission();
      try {
        const frames = new ArtifactStreamDecoderV1("open-request", options.limits);
        let request: ArtifactReadRequestV1 | undefined;
        for await (const chunk of body) {
          frames.push(chunk);
          for (;;) {
            const frame = frames.next();
            if (frame === undefined) break;
            request = ArtifactReadRequestV1Schema.parse(
              JSON.parse(new TextDecoder().decode(frame.payload)),
            );
          }
        }
        if (request === undefined) {
          throw new ArtifactStreamError(ARTIFACT_STREAM_ERROR_V1.missingJsonFrame);
        }
        if (!(await options.verifier.verifyOpen(request))) throw refuse();
        const handle = await options.store.open(request);
        return (async function* (): AsyncGenerator<Uint8Array> {
          try {
            yield encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, handle.manifest);
            for await (const frame of chunkArtifactStreamV1(
              handle.content,
              ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES,
            )) {
              yield frame;
            }
            // 回执只在其字节被完整消费后才 resolve。
            const receipt = await handle.verified;
            yield encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.receipt, receipt);
          } catch (error) {
            yield errorFrame(error);
          } finally {
            inFlight -= 1;
          }
        })();
      } catch (error) {
        inFlight -= 1;
        return (async function* (): AsyncGenerator<Uint8Array> {
          yield errorFrame(error);
        })();
      }
    },

    async drain(timeoutMs: number) {
      draining = true;
      const deadline = Date.now() + Math.min(timeoutMs, options.shutdownTimeoutMs);
      while (inFlight > 0 && Date.now() < deadline) {
        await delay(10);
      }
      // 返回是否真正收口；false 意味着宿主必须报告未完成，不能声称停写。
      return inFlight === 0;
    },
  };
};
