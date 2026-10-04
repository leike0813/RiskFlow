import { ModuleErrorV1Schema, type ModuleErrorV1 } from "@riskflow/contracts/ports";
import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";

import { RiskInputFactsReadRequestV1Schema, type RiskInputFactsReadRequestV1 } from "./schema.js";
import type { RiskInputFactsReaderV1 } from "./service.js";

/**
 * 风险输入 XOR 的两个分支由各自所有者实现：标准化风险记录归识别验收域，
 * 外部风险事件归工程数据源登记域。组合工厂只做 strict 校验与按 kind 分派，
 * 不查询存储、不改写调用身份、不内嵌字段或证据。
 */
export interface RiskInputFactsReaderBranchesV1 {
  readonly standardizedRiskRecord: RiskInputFactsReaderV1;
  readonly externalRiskEvent: RiskInputFactsReaderV1;
}

const STAGE_CODE_V1 = "risk-assessment.risk-input-facts";

/**
 * 非法读取请求按契约失败闭合：XOR 无对应分支、调用身份缺项或请求形状越界都属于
 * 稳定可观察的关闭失败，不抛给调用方，也不退化成空事实。
 */
const unsupportedContract = (input: unknown): ModuleErrorV1 => {
  const request = (typeof input === "object" && input !== null ? input : {}) as {
    readonly requestId?: unknown;
    readonly requestedAt?: unknown;
  };
  const requestId = IdentifierSchema.safeParse(request.requestId);
  const requestedAt = IsoDateTimeSchema.safeParse(request.requestedAt);
  return ModuleErrorV1Schema.parse({
    code: "UNSUPPORTED_CONTRACT",
    category: "technical",
    retryable: false,
    schemaVersion: "1",
    stageCode: STAGE_CODE_V1,
    occurredAt: requestedAt.success ? requestedAt.data : "1970-01-01T00:00:00.000Z",
    causalRunId: requestId.success ? requestId.data : STAGE_CODE_V1,
  });
};

export const createRiskInputFactsReader = (
  branches: RiskInputFactsReaderBranchesV1,
): RiskInputFactsReaderV1 => ({
  readRiskInputFacts: (input: RiskInputFactsReadRequestV1) => {
    const parsed = RiskInputFactsReadRequestV1Schema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve({ kind: "failed", error: unsupportedContract(input) });
    }
    const request = parsed.data;
    const branch =
      request.riskInput.kind === "standardized-risk-record"
        ? branches.standardizedRiskRecord
        : branches.externalRiskEvent;
    return branch.readRiskInputFacts(request);
  },
});
