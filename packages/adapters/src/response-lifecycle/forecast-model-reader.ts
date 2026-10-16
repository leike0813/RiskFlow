import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  ArtifactReadRequestV1Schema,
  ArtifactStoreError,
  mapArtifactErrorToModuleError,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  EffectForecastModelArtifactV1Schema,
  EFFECT_FORECAST_MODEL_MEDIA_TYPE_V1,
  EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1,
  EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
  failResponseLifecycle,
  type EffectForecastModelArtifactV1,
} from "@riskflow/core/response-lifecycle";

/**
 * 模型工件读取端口（design D-07）。
 *
 * 读取限定在部署组合根注入这一个实现上：调用者身份、精确 `requiredRef`、用途码与字节上限
 * 都由调用点固定，读取端不提供「读最近一版」「读任意工程工件」这类放宽入口。
 */
export interface EffectForecastModelReadRequestV1 {
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly modelRef: VersionReference;
  readonly maxBytes: number;
}

export type EffectForecastModelReadResultV1 =
  | { readonly kind: "succeeded"; readonly model: EffectForecastModelArtifactV1 }
  | { readonly kind: "unavailable" };

export interface EffectForecastModelReaderV1 {
  readModelArtifact(
    request: EffectForecastModelReadRequestV1,
  ): Promise<EffectForecastModelReadResultV1>;
}

export interface EffectForecastModelReaderOptionsV1 {
  readonly artifactStore: ArtifactStoreV1;
  readonly maxBytes?: number;
}

/**
 * 打开受权工件、流式读取并按所属 Schema 解析模型正文。
 *
 * 只有精确模型引用不存在才是业务不可用。权限、契约、完整性和技术故障沿模块失败通道传播。
 */
export const createEffectForecastModelReaderV1 = (
  options: EffectForecastModelReaderOptionsV1,
): EffectForecastModelReaderV1 => {
  const configuredMaxBytes = options.maxBytes ?? EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1;
  if (
    !Number.isSafeInteger(configuredMaxBytes) ||
    configuredMaxBytes < 1 ||
    configuredMaxBytes > EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1
  ) {
    throw new RangeError("forecast model artifact budget must be a positive safe integer");
  }
  const maxBytes = configuredMaxBytes;
  return {
    async readModelArtifact(request) {
      if (
        !Number.isSafeInteger(request.maxBytes) ||
        request.maxBytes < 1 ||
        request.maxBytes > EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1
      ) {
        failResponseLifecycle("response-forecast-result-invalid", {
          kind: "content-artifact",
          reference: request.modelRef,
        });
      }
      const limit = Math.min(request.maxBytes, maxBytes);
      const targetRef = { kind: "content-artifact", reference: request.modelRef } as const;
      const rethrowArtifactError = (error: unknown): EffectForecastModelReadResultV1 => {
        if (!(error instanceof ArtifactStoreError)) throw error;
        if (error.code === "ARTIFACT_REFERENCE_NOT_FOUND") {
          return { kind: "unavailable" };
        }
        throw mapArtifactErrorToModuleError(error, {
          causalRunId: request.invocationId,
          requiredCapability: "knowledge-modeling.read",
          authorizationPolicyRef: request.authorization.authorizationPolicyRef,
          targetRef,
          schemaVersion: "1",
        });
      };
      let handle;
      try {
        handle = await options.artifactStore.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: request.invocationId,
            idempotencyKey: request.invocationId,
            artifactRef: { kind: "content-artifact", reference: request.modelRef },
            projectId: request.authorization.projectId,
            actorId: request.authorization.actorId,
            requestedAt: request.authorization.decidedAt,
            purposeCode: EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
            requiredCapability: "knowledge-modeling.read",
            authorization: request.authorization,
          }),
        );
      } catch (error) {
        return rethrowArtifactError(error);
      }
      const iterator = handle.content[Symbol.asyncIterator]();
      try {
        if (
          handle.manifest.mediaType !== EFFECT_FORECAST_MODEL_MEDIA_TYPE_V1 ||
          !Number.isSafeInteger(handle.manifest.content.byteLength) ||
          handle.manifest.content.byteLength > limit
        ) {
          failResponseLifecycle("response-forecast-result-invalid", targetRef);
        }
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          byteLength += next.value.byteLength;
          if (byteLength > limit) {
            failResponseLifecycle("response-forecast-result-invalid", targetRef);
          }
          chunks.push(next.value);
        }
        // 内容完整消费并由 C04 完成摘要校验后，才允许解析模型正文。
        await handle.completed;
        const buffer = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) as unknown;
        } catch {
          failResponseLifecycle("response-forecast-result-invalid", targetRef);
        }
        const model = EffectForecastModelArtifactV1Schema.safeParse(raw);
        if (!model.success || model.data.projectId !== request.authorization.projectId) {
          failResponseLifecycle("response-forecast-result-invalid", targetRef);
        }
        return { kind: "succeeded", model: model.data };
      } catch (error) {
        if (error instanceof ArtifactStoreError) return rethrowArtifactError(error);
        throw error;
      } finally {
        try {
          await iterator.return?.();
        } finally {
          // 提前取消会拒绝 C04 的 completed promise；先校验失败时也必须观察该结果。
          await handle.completed.then(
            () => undefined,
            () => undefined,
          );
        }
      }
    },
  };
};
