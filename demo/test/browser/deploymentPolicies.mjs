/**
 * 演示装配的版本化部署策略（design D-04 / task 4.1「登记版本化合成输入和策略」）。
 *
 * 十项运行策略、预警聚合与通知策略、处置生成与验证策略都是甲方审核的版本化配置数据，
 * 由部署组合根注入，不是领域逻辑内部推导的默认值。本模块只做两件事：
 *
 * 1. 登记一份带精确版本引用的合成策略集（合成样本、待甲方复核）；
 * 2. 提供者按调用方请求的精确引用解析，**引用对不上就失败闭合**。
 *
 * 绝不提供 latest/default 回退：C25/C26/C27 的契约要求「只按精确引用解析」，
 * 一次静默替换默认策略会把「未配置」伪装成「已按甲方策略评估」。
 */

const policyFailure = (code, requestId) => ({
  kind: "failed",
  error: { code, causalRunId: requestId },
});

const matchesRef = (candidate, requested) =>
  candidate.entityId === requested.entityId && candidate.versionId === requested.versionId;

const refKey = (ref) => `${ref.entityId}@${ref.versionId}`;

/** C25 十项运行策略的登记引用；与 `ASSESSMENT_RUNTIME_POLICY_SET_V1_FIELDS` 一一对应。 */
const ASSESSMENT_RUNTIME_POLICY_REFS = Object.freeze({
  warningAggregationPolicyRef: Object.freeze({ entityId: "demo-policy-warning-aggregation", versionId: "1" }),
  notificationPolicyRef: Object.freeze({ entityId: "demo-policy-notification", versionId: "1" }),
  responseGenerationPolicyRef: Object.freeze({ entityId: "demo-policy-response-generation", versionId: "1" }),
  responseValidationPolicyRef: Object.freeze({ entityId: "demo-policy-response-validation", versionId: "1" }),
  responseAgentPolicyRef: Object.freeze({ entityId: "demo-policy-response-agent", versionId: "1" }),
  calibrationAgentPolicyRef: Object.freeze({ entityId: "demo-policy-calibration-agent", versionId: "1" }),
  retryPolicyRef: Object.freeze({ entityId: "demo-policy-retry", versionId: "1" }),
  reviewPolicyRef: Object.freeze({ entityId: "demo-policy-review", versionId: "1" }),
  modelDeploymentRef: Object.freeze({ entityId: "demo-policy-model-deployment", versionId: "1" }),
  promptTemplateRef: Object.freeze({ entityId: "demo-policy-prompt-template", versionId: "1" }),
});

export const DEMO_RUNTIME_POLICY_REFS = ASSESSMENT_RUNTIME_POLICY_REFS;

/**
 * C25 运行时策略提供者：按冻结准备快照与依据引用解析十项策略。
 * 部署只登记一套策略，因此任何与登记不符的引用都失败闭合。
 */
export const createRiskAssessmentRuntimePolicies = ({ projectId }) => ({
  readRuntimePolicySet: async (input) => {
    if (input.preparationSnapshotRef === undefined) {
      return policyFailure("PRECONDITION_FAILED", input.requestId);
    }
    return {
      kind: "succeeded",
      policySet: { schemaVersion: "1", projectId, ...ASSESSMENT_RUNTIME_POLICY_REFS },
    };
  },
});

/**
 * C26 预警运行时策略：聚合策略按触发类型给出处置方向，通知策略给出站内渠道与接收主体。
 * 两个引用必须与登记完全一致，否则预警不会带着「未配置」继续登记。
 */
export const createWarningRuntimePolicies = ({
  projectId,
  recipientActorIds,
  responseDirectionByTriggerType,
}) => {
  const aggregationPolicyRef = ASSESSMENT_RUNTIME_POLICY_REFS.warningAggregationPolicyRef;
  const notificationPolicyRef = ASSESSMENT_RUNTIME_POLICY_REFS.notificationPolicyRef;
  return {
    read: async (input) => {
      if (
        !matchesRef(aggregationPolicyRef, input.warningAggregationPolicyRef) ||
        !matchesRef(notificationPolicyRef, input.notificationPolicyRef)
      ) {
        throw Object.assign(new Error("warning-runtime-policy-unavailable"), {
          failure: { code: "PRECONDITION_FAILED", requestId: input.requestId },
        });
      }
      return {
        schemaVersion: "1",
        projectId,
        warningAggregationPolicy: {
          schemaVersion: "1",
          policyRef: aggregationPolicyRef,
          projectId,
          responseDirectionByTriggerType,
        },
        notificationPolicy: {
          schemaVersion: "1",
          policyRef: notificationPolicyRef,
          projectId,
          channel: "in-app",
          recipientActorIds: [...recipientActorIds],
        },
      };
    },
  };
};

/**
 * C27 处置策略：生成策略把风险输入绑定到风险事件分类，验证策略给出目标指标值与
 * 已复核标准证据。两条引用同样只按精确版本解析。
 */
export const createRecommendationPolicies = ({
  projectId,
  bindings,
  targetIndicators,
  reviewedStandardEvidence,
}) => {
  const generationPolicyRef = ASSESSMENT_RUNTIME_POLICY_REFS.responseGenerationPolicyRef;
  const validationPolicyRef = ASSESSMENT_RUNTIME_POLICY_REFS.responseValidationPolicyRef;
  return {
    readGenerationPolicy: async (input) => {
      if (!matchesRef(generationPolicyRef, input.generationPolicyRef)) {
        throw Object.assign(new Error("recommendation-generation-policy-unavailable"), {
          failure: { code: "PRECONDITION_FAILED", requestId: input.requestId },
        });
      }
      return {
        schemaVersion: "1",
        policyRef: generationPolicyRef,
        projectId,
        bindings: [...bindings],
      };
    },
    readValidationContext: async (input) => {
      if (!matchesRef(validationPolicyRef, input.validationPolicyRef)) {
        throw Object.assign(new Error("recommendation-validation-policy-unavailable"), {
          failure: { code: "PRECONDITION_FAILED", requestId: input.requestId },
        });
      }
      return {
        validationPolicy: {
          schemaVersion: "1",
          policyRef: validationPolicyRef,
          projectId,
          targetIndicators: [...targetIndicators],
          reviewedStandardEvidence: [...reviewedStandardEvidence],
          contraindicationRules: [],
        },
        siteContext: {
          schemaVersion: "1",
          contextRef: input.siteContextRef,
          projectId,
        },
      };
    },
  };
};

export { refKey };
