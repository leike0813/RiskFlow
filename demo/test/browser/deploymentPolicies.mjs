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
/**
 * C27 处置建议生成的 Agent 策略（合成样本、待甲方复核）。
 *
 * 工具白名单、预算与增量 Schema 都是版本化配置：Agent 只能按这里的精确引用动作，
 * 超出预算或引用不匹配由 C08 按硬预算关闭失败，不由模型自由发挥。
 */
export const createResponseAgentPolicy = ({ projectId }) =>
  Object.freeze({
    schemaVersion: "1",
    policyRef: ASSESSMENT_RUNTIME_POLICY_REFS.responseAgentPolicyRef,
    projectId,
    definitionRef: Object.freeze({
      entityId: "demo-definition-response-recommendation",
      versionId: "1",
    }),
    toolPolicyRef: Object.freeze({
      entityId: "demo-policy-response-recommendation-tools",
      versionId: "1",
    }),
    incrementSchemaRef: Object.freeze({
      entityId: "demo-schema-response-recommendation-increment",
      versionId: "1",
    }),
    validationPolicyRef: ASSESSMENT_RUNTIME_POLICY_REFS.responseValidationPolicyRef,
    budgetPolicy: Object.freeze({
      schemaVersion: "1",
      policyRef: Object.freeze({ entityId: "demo-policy-response-agent-budget", versionId: "1" }),
      modelDeploymentRef: ASSESSMENT_RUNTIME_POLICY_REFS.modelDeploymentRef,
      promptTemplateRef: ASSESSMENT_RUNTIME_POLICY_REFS.promptTemplateRef,
      toolPolicyRef: Object.freeze({
        entityId: "demo-policy-response-recommendation-tools",
        versionId: "1",
      }),
      maxModelInvocations: 4,
      maxToolInvocations: 4,
      maxContextTokens: 16384,
      maxInputBytes: 262144,
      maxOutputBytes: 65536,
      maxCandidates: 8,
      maxObjects: 64,
      maxSupplementarySearches: 0,
      maxCorrections: 2,
      maxTransientRetries: 1,
      maxConcurrentActions: 1,
      maxWallClockMs: 600000,
    }),
  });

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

/**
 * C18 已发布预测策略（合成样本、待甲方复核）。
 *
 * 工厂按 `requiredRef` 唯一装配执行器，运行期不再选择；重复策略直接失败，
 * 不任意挑一个。每个策略的方法、输入指标与步长都是版本化配置，不是代码默认值。
 */
export const DEMO_FORECAST_POLICIES = Object.freeze([
  Object.freeze({
    policyId: "demo-forecast-policy-settlement",
    method: "monitoring-trend",
    inputIndicatorIds: Object.freeze(["地表沉降"]),
    targetIndicatorId: "地表沉降",
    horizonSteps: 1,
    unit: "mm",
    requiredRef: Object.freeze({ entityId: "demo-policy-forecast", versionId: "1" }),
  }),
]);

/**
 * C29 校准校验策略（合成样本、待甲方复核）：固定工具白名单、预算与拒绝分类。
 * 与上面十项运行策略不是同一族（C25 的 `calibrationAgentPolicyRef` 是 Agent 策略引用，
 * 这里是被 C29 逐项核对的校验策略文档），因此单独登记，不混进运行策略集。
 */
const CALIBRATION_VALIDATION_POLICY = Object.freeze({
  policyRef: Object.freeze({ entityId: "demo-policy-calibration-validation", versionId: "1" }),
  definitionRef: Object.freeze({ entityId: "demo-definition-calibration", versionId: "1" }),
  toolPolicyRef: Object.freeze({ entityId: "demo-policy-calibration-tools", versionId: "1" }),
  incrementSchemaRef: Object.freeze({ entityId: "demo-schema-calibration-increment", versionId: "1" }),
  validationPolicyRef: ASSESSMENT_RUNTIME_POLICY_REFS.responseValidationPolicyRef,
  budgetPolicy: Object.freeze({
    schemaVersion: "1",
    policyRef: Object.freeze({ entityId: "demo-policy-calibration-budget", versionId: "1" }),
    modelDeploymentRef: ASSESSMENT_RUNTIME_POLICY_REFS.modelDeploymentRef,
    promptTemplateRef: ASSESSMENT_RUNTIME_POLICY_REFS.promptTemplateRef,
    toolPolicyRef: Object.freeze({ entityId: "demo-policy-calibration-tools", versionId: "1" }),
    maxModelInvocations: 2,
    maxToolInvocations: 4,
    maxContextTokens: 16000,
    maxInputBytes: 65536,
    maxOutputBytes: 16384,
    maxCandidates: 4,
    maxObjects: 8,
    maxSupplementarySearches: 1,
    maxCorrections: 1,
    maxTransientRetries: 1,
    maxConcurrentActions: 2,
    maxWallClockMs: 30000,
  }),
  evidenceRequirementCount: 1,
  maxOperations: 4,
});

/**
 * C34 分段入口的冻结策略目录（design D-11）：`forecast-response` 的 A0 与
 * `record-response-feedback` 的 A0/A3/A4 只按调用方给出的**精确依据集合引用**解析策略。
 *
 * 依据集合引用是 C19 按内容摘要铸出的（`assessment-basis-<identityDigest>`），部署无法
 * 预先登记。因此本目录不登记「哪些引用可用」，而是反过来：先用 C19 的真实读取证明调用方
 * 给的引用确属本工程且已登记，再交出本部署唯一登记的策略。读不到就 `unavailable`——
 * 目录内没有任何 latest/default 回退，未登记的工程或读不通的引用都不会拿到策略。
 *
 * 下游读取身份按用途单独签发（`knowledge-modeling.assessment-basis`），不复用运行上下文：
 * C06 要求一个授权上下文只对应一个 invocation_id。
 */
export const createAssessmentPolicyCatalog = ({
  projectId,
  basisReader,
  authorizeDownstream,
  forecastPolicyRef = DEMO_FORECAST_POLICIES[0].requiredRef,
  calibrationPolicy = CALIBRATION_VALIDATION_POLICY,
}) => {
  const readRegisteredBasisSet = async (input) => {
    if (input.projectId !== projectId) return undefined;
    const authorization = await authorizeDownstream({
      invocationId: `${input.basisReleaseSetRef.reference.entityId}:policy-catalog`,
      projectId: input.projectId,
      branch: "knowledge-modeling.assessment-basis",
    });
    const read = await basisReader.readAssessmentBasisReleaseSet({
      requestId: `${input.basisReleaseSetRef.reference.entityId}:policy-catalog`,
      idempotencyKey: `${input.basisReleaseSetRef.reference.entityId}:policy-catalog`,
      requestedAt: input.requiredAt,
      authorization,
      assessmentBasisReleaseSetRef: input.basisReleaseSetRef,
    });
    if (read.kind !== "succeeded") return undefined;
    return matchesRef(
      { entityId: read.assessmentBasisReleaseSetRef.reference.entityId,
        versionId: read.assessmentBasisReleaseSetRef.reference.versionId },
      input.basisReleaseSetRef.reference,
    )
      ? read
      : undefined;
  };

  return {
    resolveForecastPolicy: async (input) => {
      const basis = await readRegisteredBasisSet(input);
      if (basis === undefined) {
        return { kind: "unavailable", reasonCode: "basis-release-set-not-registered" };
      }
      return { kind: "resolved", forecastPolicyRef };
    },
    resolveCalibrationPolicy: async (input) => {
      const basis = await readRegisteredBasisSet(input);
      if (basis === undefined) {
        return { kind: "unavailable", reasonCode: "basis-release-set-not-registered" };
      }
      return {
        kind: "resolved",
        // 校准目标是本次依据集合里已发布的适用规则集释放，不是「最新一条」。
        targetReleaseRef: basis.applicableRuleSetMember.releaseRef,
        calibrationValidationPolicyRef: calibrationPolicy.policyRef,
        agentPolicy: {
          schemaVersion: "1",
          projectId,
          ...calibrationPolicy,
        },
      };
    },
  };
};

/**
 * 风险流程父图的冻结配置身份（design D-08）：重试预算只从冻结引用解析，
 * 子图版本由部署注入不从调用方猜测，验收风险的空间配对只按调用方给出的精确来源解析。
 *
 * 引用对不上即返回 undefined（关闭失败），不返回内建默认预算或默认配对。
 */
export const DEMO_RISK_FLOW_CONFIG = Object.freeze({
  retryPolicyRef: Object.freeze({ entityId: "demo-policy-retry", versionId: "1" }),
  subGraphVersions: Object.freeze({
    identification: Object.freeze({ entityId: "demo-subgraph-identification", versionId: "1" }),
    assessment: Object.freeze({ entityId: "demo-subgraph-assessment", versionId: "1" }),
  }),
  retryBudget: Object.freeze({ maxAttempts: 3, backoffMs: 1000 }),
});

export const createRiskFlowRetryPolicyReader = () => ({
  read: async (input) =>
    matchesRef(DEMO_RISK_FLOW_CONFIG.retryPolicyRef, input.retryPolicyRef)
      ? { maxAttempts: DEMO_RISK_FLOW_CONFIG.retryBudget.maxAttempts, backoffMs: DEMO_RISK_FLOW_CONFIG.retryBudget.backoffMs }
      : undefined,
});

export { refKey };
