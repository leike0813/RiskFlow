/**
 * C35 应用输出接缝（design D-11）。
 *
 * 健康与模型版本是 API 显式注入的应用输出，不是内部探测：provider 只能来自部署组合根里
 * 已经存在的窄回调，本模块不新建后台任务、不轮询、不扫描进程或硬件。
 *
 * 两条硬边界：单次请求最多 32 项；整体读超时 2 秒。超时或缺席的 component 一律呈现为
 * `unknown`，不返回 URL、路径、堆栈、队列正文或任何秘密。
 */
import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

export const SYSTEM_OPERATIONS_ITEM_MAX_V1 = 32;
export const SYSTEM_OPERATIONS_TIMEOUT_MS_V1 = 2_000;

/** 组件标识固定为四个安全 id：不暴露实例地址、容器名或命名空间。 */
export const SYSTEM_OPERATIONS_COMPONENT_IDS_V1 = [
  "api",
  "postgresql",
  "artifact-store",
  "model-gateway",
] as const;
export const SystemOperationsComponentIdV1Schema = z.enum(SYSTEM_OPERATIONS_COMPONENT_IDS_V1);
export type SystemOperationsComponentIdV1 = z.infer<typeof SystemOperationsComponentIdV1Schema>;

export const SystemOperationsStatusV1Schema = z.enum([
  "available",
  "unavailable",
  "degraded",
  "unknown",
]);
export type SystemOperationsStatusV1 = z.infer<typeof SystemOperationsStatusV1Schema>;

const componentSchema = z.strictObject({
  componentId: SystemOperationsComponentIdV1Schema,
  status: SystemOperationsStatusV1Schema,
  reasonCode: IdentifierSchema.optional(),
});
export type SystemOperationsComponentV1 = z.infer<typeof componentSchema>;

export const SystemOperationsHealthResultV1Schema = z.strictObject({
  kind: z.literal("health"),
  capturedAt: IsoDateTimeSchema,
  components: z.array(componentSchema).max(SYSTEM_OPERATIONS_ITEM_MAX_V1),
});
export type SystemOperationsHealthResultV1 = z.infer<typeof SystemOperationsHealthResultV1Schema>;

/**
 * 模型版本只做安全 pick：部署/模型/构建引用、任务类型与六类策略引用。
 * 绝不返回 baseUrl、modelAlias、权重路径、秘密或提示正文；没有基础-微调关系事实就不补。
 */
export const SystemOperationsModelVersionV1Schema = z.strictObject({
  taskType: IdentifierSchema,
  deploymentRef: VersionReferenceSchema,
  modelVersionRef: VersionReferenceSchema,
  serverBuildRef: VersionReferenceSchema.optional(),
  promptTemplateRef: VersionReferenceSchema,
  toolPolicyRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  supportedTriggerModes: z.array(z.enum(["embedded", "interactive"])).min(1),
});
export type SystemOperationsModelVersionV1 = z.infer<typeof SystemOperationsModelVersionV1Schema>;

export const SystemOperationsModelVersionsResultV1Schema = z.strictObject({
  kind: z.literal("model-versions"),
  capturedAt: IsoDateTimeSchema,
  items: z.array(SystemOperationsModelVersionV1Schema).max(SYSTEM_OPERATIONS_ITEM_MAX_V1),
});
export type SystemOperationsModelVersionsResultV1 = z.infer<
  typeof SystemOperationsModelVersionsResultV1Schema
>;

export const SystemOperationsQueryResultV1Schema = z.discriminatedUnion("kind", [
  SystemOperationsHealthResultV1Schema,
  SystemOperationsModelVersionsResultV1Schema,
]);
export type SystemOperationsQueryResultV1 = z.infer<typeof SystemOperationsQueryResultV1Schema>;

export const SystemOperationsQueryPayloadV1Schema = z.strictObject({
  kind: z.enum(["health", "model-versions"]),
});
export type SystemOperationsQueryPayloadV1 = z.infer<typeof SystemOperationsQueryPayloadV1Schema>;

export const SystemOperationsQueryRequestV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  queryId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  payload: SystemOperationsQueryPayloadV1Schema,
});
export type SystemOperationsQueryRequestV1 = z.infer<typeof SystemOperationsQueryRequestV1Schema>;

export const SystemOperationsQueryResultEnvelopeV1Schema = z.strictObject({
  kind: z.literal("succeeded"),
  result: SystemOperationsQueryResultV1Schema,
});
export type SystemOperationsQueryResultEnvelopeV1 = z.infer<
  typeof SystemOperationsQueryResultEnvelopeV1Schema
>;

/**
 * 接缝形状：调用方已取得当前管理证明，provider 只负责给出这两个事实面。
 * 返回失败由所属组合根决定是否成立；本接口不承载授权判断。
 */
export interface SystemOperationsReadPortV1 {
  read(request: SystemOperationsQueryRequestV1): Promise<SystemOperationsQueryResultEnvelopeV1>;
}

/**
 * 部署组合根注入的窄回调：每个 component 一个，没有回调的呈现为 `unknown`。
 * 回调抛错、超时或返回非法形状都折叠成 `unknown` + 稳定 reasonCode，而不是整体失败，
 * 也不把异常文本当作 reasonCode 泄露。
 */
export type SystemOperationsHealthProbeV1 = (
  componentId: SystemOperationsComponentIdV1,
  signal: AbortSignal,
) => Promise<{ readonly status: SystemOperationsStatusV1; readonly reasonCode?: string }>;

export const SYSTEM_OPERATIONS_REASON_CODES_V1 = {
  probeAbsent: "PROBE_NOT_CONFIGURED",
  probeFailed: "PROBE_FAILED",
  probeTimedOut: "PROBE_TIMED_OUT",
  modelNotConfigured: "MODEL_DEPLOYMENT_NOT_CONFIGURED",
} as const;

/** 逐组件在总预算内求值：缺席、抛错与超时都不升级成整体失败。 */
export const collectSystemOperationsHealth = async (input: {
  readonly probe?: SystemOperationsHealthProbeV1;
  readonly capturedAt: string;
  readonly now: () => Date;
}): Promise<SystemOperationsHealthResultV1> => {
  const components: SystemOperationsComponentV1[] = [];
  for (const componentId of SYSTEM_OPERATIONS_COMPONENT_IDS_V1) {
    if (input.probe === undefined) {
      components.push({
        componentId,
        status: "unknown",
        reasonCode: SYSTEM_OPERATIONS_REASON_CODES_V1.probeAbsent,
      });
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYSTEM_OPERATIONS_TIMEOUT_MS_V1);
    try {
      const value = await input.probe(componentId, controller.signal);
      components.push({
        componentId,
        status: SystemOperationsStatusV1Schema.parse(value.status),
        ...(value.reasonCode === undefined
          ? {}
          : { reasonCode: IdentifierSchema.parse(value.reasonCode) }),
      });
    } catch {
      components.push({
        componentId,
        status: "unknown",
        reasonCode: controller.signal.aborted
          ? SYSTEM_OPERATIONS_REASON_CODES_V1.probeTimedOut
          : SYSTEM_OPERATIONS_REASON_CODES_V1.probeFailed,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return SystemOperationsHealthResultV1Schema.parse({
    kind: "health",
    capturedAt: input.capturedAt,
    components,
  });
};
