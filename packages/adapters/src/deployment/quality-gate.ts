import {
  evaluateRetrievalAcceptance,
  HybridRetrievalAcceptanceReportV1Schema,
  type HybridRetrievalAcceptancePolicyV1,
  type HybridRetrievalAcceptanceReportV1,
} from "@riskflow/core/retrieval";

/**
 * C37 D-20：C20 qualityGate 的生产实现。
 *
 * 门禁复用 core 的 `evaluateRetrievalAcceptance` 确定性计算，不复制阈值、不自建分数。
 * 任一门槛缺证据或失败都不能 ready；摘要本身不足以掩盖单路、权限、版本或 p95 失败。
 */

export const DEPLOYMENT_QUALITY_GATE_ERROR_V1 = {
  measurementsMissing: "DEPLOYMENT_QUALITY_GATE_MEASUREMENTS_MISSING",
  policyRefMismatch: "DEPLOYMENT_QUALITY_GATE_POLICY_REF_MISMATCH",
  datasetRefMismatch: "DEPLOYMENT_QUALITY_GATE_DATASET_REF_MISMATCH",
} as const;
export type DeploymentQualityGateErrorCodeV1 =
  (typeof DEPLOYMENT_QUALITY_GATE_ERROR_V1)[keyof typeof DEPLOYMENT_QUALITY_GATE_ERROR_V1];

export class DeploymentQualityGateError extends Error {
  readonly code: DeploymentQualityGateErrorCodeV1;

  constructor(code: DeploymentQualityGateErrorCodeV1) {
    super(code);
    this.name = "DeploymentQualityGateError";
    this.code = code;
  }
}

/** 真实测量来源：dense/BM25/RRF、reconciliation、授权泄漏与 p95 必须全部提供。 */
export interface RetrievalQualityMeasurementSourceV1 {
  /**
   * 返回真实代际的测量结果；无法测量时抛错或返回 undefined，
   * 宿主据此判定缺证据，不得以合成常量替代。
   *
   * 必须同时回报本次测量所依据的策略与数据集身份：报告本身由策略派生，
   * 只有测量来源的身份才能证明它确实测的是本代数据，而不是上一代残留。
   */
  measure(input: {
    readonly policy: HybridRetrievalAcceptancePolicyV1;
    readonly signal: AbortSignal;
  }): Promise<DeploymentRetrievalMeasurementsV1 | undefined>;
}

/** 测量结果与它所依据的策略/数据集身份。 */
export interface DeploymentRetrievalMeasurementsV1 {
  readonly acceptancePolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly datasetRef: { readonly entityId: string; readonly versionId: string };
  readonly measurements: unknown;
}

export interface DeploymentRetrievalQualityGateV1 {
  /** 返回原始报告；是否通过由调用方读取 report.ready，不得由本方法代答。 */
  evaluate(input: {
    readonly policy: HybridRetrievalAcceptancePolicyV1;
    readonly signal: AbortSignal;
  }): Promise<HybridRetrievalAcceptanceReportV1>;
}

const sameRef = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

export const createDeploymentRetrievalQualityGateV1 = (
  source: RetrievalQualityMeasurementSourceV1,
): DeploymentRetrievalQualityGateV1 => ({
  async evaluate(input) {
    const measured = await source.measure(input);
    if (measured === undefined) {
      throw new DeploymentQualityGateError(DEPLOYMENT_QUALITY_GATE_ERROR_V1.measurementsMissing);
    }
    // 报告的 ref 由策略派生，恒等于输入；真正的漂移风险在测量来源，
    // 因此要求它自证测的是本代策略与数据集，否则拒绝这份证据。
    if (!sameRef(measured.acceptancePolicyRef, input.policy.acceptancePolicyRef)) {
      throw new DeploymentQualityGateError(DEPLOYMENT_QUALITY_GATE_ERROR_V1.policyRefMismatch);
    }
    if (!sameRef(measured.datasetRef, input.policy.datasetRef)) {
      throw new DeploymentQualityGateError(DEPLOYMENT_QUALITY_GATE_ERROR_V1.datasetRefMismatch);
    }
    const report = evaluateRetrievalAcceptance({
      policy: input.policy,
      measurements: measured.measurements,
    });
    return HybridRetrievalAcceptanceReportV1Schema.parse(report);
  },
});
