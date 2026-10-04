import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  EffectForecastModelArtifactV1Schema,
  EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1,
  EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
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
 * 读取失败、字节超限、摘要校验未完成与正文不满足 Schema 一律收敛为不可用：预测执行器据此
 * 交回受控原因，而不是把半读到的正文当成可用模型。
 */
export const createEffectForecastModelReaderV1 = (
  options: EffectForecastModelReaderOptionsV1,
): EffectForecastModelReaderV1 => {
  const maxBytes = options.maxBytes ?? EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1;
  return {
    async readModelArtifact(request) {
      try {
        const handle = await options.artifactStore.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: request.invocationId,
            idempotencyKey: request.invocationId,
            artifactRef: { kind: "content-artifact", reference: request.modelRef },
            projectId: request.authorization.projectId,
            actorId: request.authorization.actorId,
            requestedAt: request.authorization.decidedAt,
            purposeCode: EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
            requiredCapability: "knowledge-modeling.retrieve",
            authorization: request.authorization,
          }),
        );
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        for await (const chunk of handle.content) {
          byteLength += chunk.byteLength;
          if (byteLength > request.maxBytes || byteLength > maxBytes)
            return { kind: "unavailable" };
          chunks.push(chunk);
        }
        // 摘要未通过就不解析正文：完整性是读取的准入条件，不是事后补记。
        await handle.verified;
        const buffer = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const model = EffectForecastModelArtifactV1Schema.safeParse(
          JSON.parse(new TextDecoder().decode(buffer)) as unknown,
        );
        return model.success
          ? { kind: "succeeded" as const, model: model.data }
          : { kind: "unavailable" as const };
      } catch {
        return { kind: "unavailable" as const };
      }
    },
  };
};
