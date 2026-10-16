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
  warningAggregationPolicyRef: Object.freeze({
    entityId: "demo-policy-warning-aggregation",
    versionId: "1",
  }),
  notificationPolicyRef: Object.freeze({ entityId: "demo-policy-notification", versionId: "1" }),
  responseGenerationPolicyRef: Object.freeze({
    entityId: "demo-policy-response-generation",
    versionId: "1",
  }),
  responseValidationPolicyRef: Object.freeze({
    entityId: "demo-policy-response-validation",
    versionId: "1",
  }),
  responseAgentPolicyRef: Object.freeze({ entityId: "demo-policy-response-agent", versionId: "1" }),
  calibrationAgentPolicyRef: Object.freeze({
    entityId: "demo-policy-calibration-agent",
    versionId: "1",
  }),
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
        (input.warningAggregationPolicyRef !== undefined &&
          !matchesRef(aggregationPolicyRef, input.warningAggregationPolicyRef)) ||
        (input.notificationPolicyRef !== undefined &&
          !matchesRef(notificationPolicyRef, input.notificationPolicyRef))
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
  spatialScopeRef,
  bindings,
  targetIndicators,
  reviewedStandardEvidence,
  siteProcess,
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
          // 现场上下文声明的工序状态必须落在本策略的可执行状态里，否则站点可行性
          // 校验会以 `process-not-executable` 关闭。演示只登记一条真实工序状态。
          executableProcessStatuses: [siteProcess.processStatus],
        },
        // 现场上下文按 `RecommendationSiteContextV1` 的完整字段返回：只回声引用而不给
        // 工序节点、资源与证据，站点可行性校验会在 `resource-unavailable` 处关闭失败。
        siteContext: {
          schemaVersion: "1",
          projectId,
          siteContextRef: input.siteContextRef,
          // C27 要求现场上下文与候选集合落在同一空间修订上：只回声引用而不给空间，
          // 正式建议会在 `site-context-mismatch` 处关闭失败。
          spatialScopeRef,
          processNodeRef: siteProcess.processNodeRef,
          processStatus: siteProcess.processStatus,
          availableResources: [...siteProcess.availableResources],
          constraints: [...siteProcess.constraints],
          evidenceReferences: [...siteProcess.evidenceReferences],
          observedAt: input.requestedAt,
        },
      };
    },
  };
};

/**
 * C35 报告导出策略（合成样本、待甲方复核）。
 *
 * 导出策略是部署冻结的不可变配置：能导出哪些查询类型、取哪些章节、最多多少页与多少条，
 * 全部由这份版本化文档决定，装配根不再另给一套默认值。导出策略集合缺省为空＝无导出能力，
 * 所以这里必须显式登记一条，`/report/export` 才有真实可核对的策略引用。
 */
export const DEMO_REPORT_EXPORT_POLICY = Object.freeze({
  schemaVersion: "1",
  policyRef: Object.freeze({ entityId: "demo-policy-report-export", versionId: "1" }),
  format: "json",
  queryTypes: Object.freeze(["risk-overview"]),
  sections: Object.freeze(["run-summary", "report-fact", "report-absence"]),
  maxPages: 8,
  maxItems: 200,
  maxBytes: 1_048_576,
});

/**
 * 当前部署登记的 llama.cpp 部署配置（合成样本、待甲方复核）。
 *
 * 模型版本运维面（`/ops/model-versions`）只做安全 pick：任务类型、部署引用、模型引用、
 * 提示模板与策略引用都取自真实登记事实——部署引用来自 Agent 任务信封，模型与构建引用来自
 * 这里。任何真实任务信封引用了未登记的部署，运维面就不列这一行，而不是补一个猜测的模型版本。
 *
 * `baseUrl` 只是部署端 origin：模型版本面按 design D-13 不发起推理，真实可达性由
 * `/ops/health` 的模型网关探针独立判定，探针缺席即如实呈现未知，两者不会互相冒充。
 */
const modelDeployment = ({ deploymentId, modelId, alias, buildId }) =>
  Object.freeze({
    schemaVersion: "1",
    deploymentRef: Object.freeze({ entityId: deploymentId, versionId: "1" }),
    serverBuildRef: Object.freeze({ entityId: buildId, versionId: "1" }),
    expectedBuildInfo: `${buildId}-demo`,
    modelVersionRef: Object.freeze({ entityId: modelId, versionId: "1" }),
    modelAlias: alias,
    baseUrl: "http://127.0.0.1:8080",
    capabilities: Object.freeze(["completeStructured"]),
    contextWindowTokens: 8_192,
    requestTimeoutMs: 30_000,
    streamIdleTimeoutMs: 10_000,
    maxResponseBytes: 262_144,
    maxInputBytes: 262_144,
    maxBatchItems: 8,
    maxOutputTokens: 2_048,
    samplingPolicy: Object.freeze({ temperature: 0.2, topP: 0.9 }),
  });

export const DEMO_MODEL_DEPLOYMENTS = Object.freeze([
  // C15 数据清洗任务的部署：任务信封里登记的模型部署引用。
  modelDeployment({
    deploymentId: "demo-c15-cleaning-model",
    modelId: "demo-model-cleaning-7b",
    alias: "riskflow-cleaning-7b-instruct",
    buildId: "demo-llamacpp-build",
  }),
  // 识别检索审阅任务的部署。
  modelDeployment({
    deploymentId: "demo-model-deployment",
    modelId: "demo-model-retrieval-review-14b",
    alias: "riskflow-review-14b-instruct",
    buildId: "demo-llamacpp-build",
  }),
  // C26/C27 处置生成与校准建议 Agent 共用的部署（`ASSESSMENT_RUNTIME_POLICY_REFS`）。
  modelDeployment({
    deploymentId: "demo-policy-model-deployment",
    modelId: "demo-model-response-14b",
    alias: "riskflow-response-14b-instruct",
    buildId: "demo-llamacpp-build",
  }),
]);

/**
 * C18 已发布预测策略（合成样本、待甲方复核）。
 *
 * 工厂按 `requiredRef` 唯一装配执行器，运行期不再选择；重复策略直接失败，
 * 不任意挑一个。每个策略的方法、输入指标与步长都是版本化配置，不是代码默认值。
 */
const SETTLEMENT_INDICATOR_ID = "demo-indicator-settlement";

export const DEMO_FORECAST_POLICIES = Object.freeze([
  Object.freeze({
    policyId: "demo-forecast-policy-settlement",
    method: "monitoring-trend",
    // 指标用 C18 已发布的 indicatorId，不是显示名：预测执行按指标标识取实际值，
    // 沿用旧夹具的显示名会让两个读取分支都取不到序列。
    inputIndicatorIds: Object.freeze([SETTLEMENT_INDICATOR_ID]),
    targetIndicatorId: SETTLEMENT_INDICATOR_ID,
    horizonSteps: 1,
    unit: "mm",
    requiredRef: Object.freeze({ entityId: "demo-policy-forecast", versionId: "1" }),
  }),
]);

/**
 * C19 版本化编制策略（合成样本、待甲方复核）。
 *
 * 编制路径本身仍不接线；这里只登记组合根必须冻结的那份策略文档，让 C17/C19 在被
 * 真正调用时能按精确 `policyRef` 冻结同一版本，而不是在读侧现编一份默认策略。
 */
const SCORING_RULES_AGENT_TOOLS = Object.freeze({
  entityId: "demo-policy-scoring-rule-tools",
  versionId: "1",
});

export const createScoringRulesPolicy = () =>
  Object.freeze({
    schemaVersion: "1",
    policyRef: Object.freeze({ entityId: "demo-policy-scoring-rules", versionId: "1" }),
    compatibilityRef: Object.freeze({
      entityId: "demo-policy-scoring-rules-compatibility",
      versionId: "1",
    }),
    assemblyPolicyRef: Object.freeze({
      entityId: "demo-policy-scoring-rules-assembly",
      versionId: "1",
    }),
    conflictPriorityPolicyRef: Object.freeze({
      entityId: "demo-policy-scoring-rules-conflict-priority",
      versionId: "1",
    }),
    allowedSourceStandardKinds: Object.freeze(["国家标准", "行业标准"]),
    tools: Object.freeze({
      standardSegmentToolRef: Object.freeze({
        entityId: "demo-tool-standard-segment",
        versionId: "1",
      }),
      indicatorCatalogToolRef: Object.freeze({
        entityId: "demo-tool-indicator-catalog",
        versionId: "1",
      }),
      maxSegmentsPerRead: 64,
      maxIndicatorsPerRead: 128,
    }),
    agent: Object.freeze({
      definitionRef: Object.freeze({
        entityId: "demo-definition-scoring-rule",
        versionId: "1",
      }),
      modelDeploymentRef: ASSESSMENT_RUNTIME_POLICY_REFS.modelDeploymentRef,
      promptTemplateRef: ASSESSMENT_RUNTIME_POLICY_REFS.promptTemplateRef,
      toolPolicyRef: SCORING_RULES_AGENT_TOOLS,
      budgetPolicyRef: Object.freeze({
        entityId: "demo-policy-scoring-rule-budget",
        versionId: "1",
      }),
      incrementSchemaRef: Object.freeze({
        entityId: "demo-schema-scoring-rule-increment",
        versionId: "1",
      }),
      validationPolicyRef: ASSESSMENT_RUNTIME_POLICY_REFS.responseValidationPolicyRef,
      budgetPolicy: Object.freeze({
        schemaVersion: "1",
        policyRef: Object.freeze({
          entityId: "demo-policy-scoring-rule-budget",
          versionId: "1",
        }),
        modelDeploymentRef: ASSESSMENT_RUNTIME_POLICY_REFS.modelDeploymentRef,
        promptTemplateRef: ASSESSMENT_RUNTIME_POLICY_REFS.promptTemplateRef,
        toolPolicyRef: SCORING_RULES_AGENT_TOOLS,
        maxModelInvocations: 2,
        maxToolInvocations: 4,
        maxContextTokens: 16000,
        maxInputBytes: 65536,
        maxOutputBytes: 16384,
        maxCandidates: 4,
        maxObjects: 16,
        maxSupplementarySearches: 1,
        maxCorrections: 1,
        maxTransientRetries: 1,
        maxConcurrentActions: 1,
        maxWallClockMs: 30000,
      }),
    }),
  });

/**
 * C29 校准校验策略（合成样本、待甲方复核）：固定工具白名单、预算与拒绝分类。
 * 与上面十项运行策略不是同一族（C25 的 `calibrationAgentPolicyRef` 是 Agent 策略引用，
 * 这里是被 C29 逐项核对的校验策略文档），因此单独登记，不混进运行策略集。
 */
/**
 * C29 组合 Agent 的冻结合成增量（合成样本、待甲方复核）。
 *
 * 证据取本次评估真实登记的来源资料段（监测数据即出自该段），操作只放宽一档可接受等级
 * 上限：收紧会让演示数据整体越限，那是数据问题而不是校准结论。
 */
export const DEMO_CALIBRATION_EVIDENCE = Object.freeze([
  Object.freeze({
    locator: Object.freeze({
      sourceSegmentId: "s_8c79d2bf12558fa45b039bb369a6eaf2-chapter_1-segment_1",
    }),
    sourceVersion: Object.freeze({
      entityId: "s_8c79d2bf12558fa45b039bb369a6eaf2",
      versionId: "1",
    }),
  }),
]);

export const DEMO_CALIBRATION_OPERATIONS = Object.freeze([
  Object.freeze({
    kind: "replace-risk-acceptance-threshold",
    definitionType: "risk-acceptance-threshold",
    threshold: Object.freeze({
      thresholdId: "demo-acceptance-default",
      applicabilityConditions: Object.freeze([
        Object.freeze({ dimension: "工程阶段数据", values: Object.freeze(["变径空间扩挖"]) }),
      ]),
      maximumAcceptedLevelId: "demo-level-3",
    }),
  }),
]);

export const CALIBRATION_VALIDATION_POLICY = Object.freeze({
  policyRef: Object.freeze({ entityId: "demo-policy-calibration-validation", versionId: "1" }),
  definitionRef: Object.freeze({ entityId: "demo-definition-calibration", versionId: "1" }),
  toolPolicyRef: Object.freeze({ entityId: "demo-policy-calibration-tools", versionId: "1" }),
  incrementSchemaRef: Object.freeze({
    entityId: "demo-schema-calibration-increment",
    versionId: "1",
  }),
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
      // 签发身份必须是本次分段入口的请求者本人：签发出的上下文 actorId 与调用方主体
      // 不一致时，C04 会关闭该次读取。运行上下文里就有主体，不另取默认身份。
      actorId: input.authorization.actorId,
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
      {
        entityId: read.assessmentBasisReleaseSetRef.reference.entityId,
        versionId: read.assessmentBasisReleaseSetRef.reference.versionId,
      },
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
      // 校准目标必须是「可受校准影响且 C16 可 submit-revision」的定义类型之一
      // （C29 白名单）。适用规则集不在白名单内，用它当目标会在 prepareInput 直接关闭
      // 失败；这里取同一依据集合里已发布的风险可接受阈值释放——它属于依据集合自身的
      // 真实发布，不取「最新一条」，也不离开本次评估的冻结依据。
      const calibrationTarget = basis.configurationMembers.find(
        (member) => member.definitionType === "risk-acceptance-threshold",
      );
      if (calibrationTarget === undefined) {
        return { kind: "unavailable", reasonCode: "calibration-target-not-in-basis-set" };
      }
      return {
        kind: "resolved",
        targetReleaseRef: calibrationTarget.releaseRef,
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
      ? {
          maxAttempts: DEMO_RISK_FLOW_CONFIG.retryBudget.maxAttempts,
          backoffMs: DEMO_RISK_FLOW_CONFIG.retryBudget.backoffMs,
        }
      : undefined,
});

/**
 * C18 评估配置集合（合成样本、待甲方复核）：11 类版本化配置正文。
 *
 * 这些正文是甲方审核的配置数据（design D-04），按 `definitionType` 逐类经 C16 提交、
 * C07 审核、C16 发布，解析身份由内容摘要铸出。P/C 与风险等级的算式全部在这些正文里：
 * 指标取值经字段映射与量纲换算后按权重集加权、落入风险矩阵分区。评估链路上任何一步
 * 读不到这里的发布集，都应如实报不可用，而不是回落到别处的默认值。
 */
const DEMO_CONFIGURATION_SET_REF = Object.freeze({
  entityId: "demo-config-set",
  versionId: "1",
});

// 引用风险矩阵的文档按 C18 交叉引用约定携带 `{matrixId, matrixVersion}`，不是发布集引用。
const DEMO_RISK_MATRIX_REF = Object.freeze({
  entityId: "demo-c32-matrix",
  versionId: "2026.06",
});

/**
 * 地表沉降短期速率：后果侧第二个指标，毫米每秒量纲，经同一条沉降序列的短期斜率特征取值。
 *
 * 监测预警阈值 `demo-threshold-settlement-slope` 落在同一条沉降序列上。原先这条阈值没有任何
 * 指标映射，它开出的预警在原理上无法被任何措施覆盖（措施目标只能是指标），C27 的触发一致性
 * 因此必然失败闭合——是已发布配置自相矛盾，不是校验过严。补上这条映射后：该阈值经同版字段
 * 映射解析为「沉降短期速率」指标，与措施目标、审核目标值一一对应。
 *
 * 后果侧按 `maximum` 组合，速率的实际值（2 mm/s）低于自身分档线（10 mm/s），因此最大值仍由
 * 累计沉降决定，P/C 与风险等级不因新增该指标而改变。
 */
const SETTLEMENT_SLOPE_INDICATOR_ID = "demo-indicator-settlement-slope";

const indicatorBase = Object.freeze({
  applicabilityConditions: [],
  quantizationIntervalRef: Object.freeze({
    entityId: "demo-quantization-interval",
    versionId: "1",
  }),
});

/** 地表沉降：后果侧唯一指标，毫米量纲，经监测值映射取值。 */
/**
 * 泥水压力：可能性侧唯一指标，千帕量纲，经监测值映射取值。
 *
 * 可能性侧不能指向风险记录里不存在的资料字段：C25 的风险输入事实只投影
 * `processNodeId`/`riskSource`/`riskFactor`/`riskEvent`/`modelConfidence` 五项，其中
 * `modelConfidence` 是结构化置信度对象而非标量，按外部文档类型映射的指标则永远取不到实际
 * 取值，两者都会在评分覆盖检查处以 `risk-assessment-rule-coverage` 关闭失败。所以可能性侧
 * 同样取自真实监测序列——本装配登记的「泥水压力」序列。
 */
const SLURRY_PRESSURE_INDICATOR_ID = "demo-indicator-slurry-pressure";

const configurationContents = Object.freeze({
  "indicator-system": {
    // 指标集合按 indicatorId 升序。
    indicators: [
      {
        ...indicatorBase,
        indicatorId: SETTLEMENT_INDICATOR_ID,
        indicatorType: "后果严重性评估指标",
        group: "监测量测与周边环境",
        valueKind: "numeric",
        canonicalUnit: "mm",
      },
      {
        ...indicatorBase,
        indicatorId: SETTLEMENT_SLOPE_INDICATOR_ID,
        indicatorType: "后果严重性评估指标",
        group: "监测量测与周边环境",
        valueKind: "numeric",
        canonicalUnit: "mm/s",
      },
      {
        ...indicatorBase,
        indicatorId: SLURRY_PRESSURE_INDICATOR_ID,
        indicatorType: "发生可能性评估指标",
        group: "开挖与支护参数",
        valueKind: "numeric",
        canonicalUnit: "kPa",
      },
    ],
  },
  "indicator-field-mapping": {
    // 集合按标识严格字典序：C18 契约要求同一集合内键升序且不重复。
    // 一个目标指标只能有一条映射：同一指标的多个来源在 C25 物化实际取值时构成歧义，
    // 以 `risk-assessment-indicator-ambiguous` 关闭失败。累计值与短期速率是两个指标，
    // 各取同一条沉降序列上的不同度量（原始值 / 短期斜率特征），彼此不构成歧义。
    mappings: [
      {
        mappingId: "demo-mapping-settlement-slope",
        targetIndicatorId: SETTLEMENT_SLOPE_INDICATOR_ID,
        origin: {
          kind: "monitoring-feature",
          monitoringIndicator: "地表沉降",
          parameterCode: "settlement",
          metric: "short-term-slope",
        },
        sourceUnit: "mm/s",
        targetUnit: "mm/s",
        conversion: { kind: "identity" },
      },
      {
        mappingId: "demo-mapping-settlement-value",
        targetIndicatorId: SETTLEMENT_INDICATOR_ID,
        origin: {
          kind: "monitoring-value",
          monitoringIndicator: "地表沉降",
          parameterCode: "settlement",
          metric: "value",
        },
        sourceUnit: "mm",
        targetUnit: "mm",
        conversion: { kind: "identity" },
      },
      {
        mappingId: "demo-mapping-slurry-pressure",
        targetIndicatorId: SLURRY_PRESSURE_INDICATOR_ID,
        origin: {
          kind: "monitoring-value",
          monitoringIndicator: "泥水压力",
          parameterCode: "slurry-pressure",
          metric: "value",
        },
        sourceUnit: "kPa",
        targetUnit: "kPa",
        conversion: { kind: "identity" },
      },
    ],
  },
  "weight-set": {
    weightSetId: "demo-weight-set",
    weightSetVersion: "1",
    sourceRef: { entityId: "demo-weight-source", versionId: "1" },
    // 权重集合同样按指标标识升序；可能性侧基数点合计 10000。
    possibilityWeights: [{ indicatorId: SLURRY_PRESSURE_INDICATOR_ID, basisPoints: 10000 }],
    // 后果侧两个指标各占一半。后果按 `maximum` 组合，基数点只参与发布校验，不改变分值。
    consequenceWeights: [
      { indicatorId: SETTLEMENT_INDICATOR_ID, basisPoints: 5000 },
      { indicatorId: SETTLEMENT_SLOPE_INDICATOR_ID, basisPoints: 5000 },
    ],
  },
  "scoring-strategy": {
    possibility: {
      kind: "weighted-average",
      weightSetRef: { entityId: "demo-weight-set", versionId: "1" },
      rounding: { mode: "half-away-from-zero", decimalScale: 2 },
    },
    consequence: { kind: "maximum" },
  },
  "risk-matrix": {
    matrixId: "demo-c32-matrix",
    matrixVersion: "2026.06",
    possibilityAxis: {
      bands: [
        { bandId: "demo-p1", lower: "0", upper: "1" },
        { bandId: "demo-p2", lower: "1", upper: "3" },
        { bandId: "demo-p3", lower: "3", upper: "5" },
      ],
    },
    consequenceAxis: {
      bands: [
        { bandId: "demo-c1", lower: "0", upper: "10" },
        { bandId: "demo-c2", lower: "10", upper: "100" },
      ],
    },
    riskLevels: [
      { levelId: "demo-level-1", ordinal: 1 },
      { levelId: "demo-level-2", ordinal: 2 },
      { levelId: "demo-level-3", ordinal: 3 },
      { levelId: "demo-level-4", ordinal: 4 },
    ],
    cells: [
      { possibilityBandId: "demo-p1", consequenceBandId: "demo-c1", riskLevelId: "demo-level-1" },
      { possibilityBandId: "demo-p1", consequenceBandId: "demo-c2", riskLevelId: "demo-level-2" },
      { possibilityBandId: "demo-p2", consequenceBandId: "demo-c1", riskLevelId: "demo-level-2" },
      { possibilityBandId: "demo-p2", consequenceBandId: "demo-c2", riskLevelId: "demo-level-3" },
      { possibilityBandId: "demo-p3", consequenceBandId: "demo-c1", riskLevelId: "demo-level-3" },
      { possibilityBandId: "demo-p3", consequenceBandId: "demo-c2", riskLevelId: "demo-level-4" },
    ],
  },
  "risk-acceptance-threshold": {
    riskMatrixRef: DEMO_RISK_MATRIX_REF,
    thresholds: [
      {
        thresholdId: "demo-acceptance-default",
        applicabilityConditions: [{ dimension: "工程阶段数据", values: ["变径空间扩挖"] }],
        maximumAcceptedLevelId: "demo-level-2",
      },
    ],
  },
  "monitoring-warning-threshold": {
    riskMatrixRef: DEMO_RISK_MATRIX_REF,
    thresholds: [
      {
        thresholdId: "demo-threshold-settlement-slope",
        monitoringIndicator: "地表沉降",
        parameterCode: "settlement",
        metric: "short-term-slope",
        unit: "mm/s",
        comparison: { operator: "gte", boundary: "0.5" },
        warningLevelId: "demo-level-4",
      },
      {
        thresholdId: "demo-threshold-settlement-value",
        monitoringIndicator: "地表沉降",
        parameterCode: "settlement",
        metric: "value",
        unit: "mm",
        comparison: { operator: "gte", boundary: "5" },
        warningLevelId: "demo-level-3",
      },
    ],
  },
  "joint-trigger-policy": {
    rules: [
      {
        ruleId: "demo-joint-settlement",
        applicabilityConditions: [],
        operator: "any-of",
        // 阈值标识同样要求升序。
        monitoringThresholdIds: [
          "demo-threshold-settlement-slope",
          "demo-threshold-settlement-value",
        ],
      },
    ],
  },
  "measure-library": {
    measures: [
      {
        measureId: "demo-measure-settlement",
        riskEventCategory: "地表沉降超限",
        applicabilityConditions: [
          { dimension: "地层条件数据", values: ["富水软弱地层"] },
          { dimension: "工程阶段数据", values: ["变径空间扩挖"] },
          { dimension: "施工工法数据", values: ["变径盾构法"] },
        ],
        // 触发类型按实测覆盖登记：累计沉降越限、短期沉降速率越限、二者的联合规则命中，
        // 以及整体风险等级越过可接受阈值，处置方向同为「降速＋同步注浆补充」。少登记一类，
        // 该类预警就没有对应措施，触发一致性会以 `trigger-indicator-uncovered` 关闭失败。
        // 数组按标识升序：配置 Schema 的 `sortedUnique` 按码位比较，顺序错会被 C18 判非法。
        triggerTypes: [
          "多指标联合规则命中",
          "监测指标越限",
          "趋势/加速度/异常评分越限",
          "风险等级超过风险可接受阈值",
        ],
        steps: [{ stepOrdinal: 1, instruction: "降低推进速率并同步注浆补充" }],
        resourceRequirements: ["注浆设备"],
        // 目标指标按标识升序；累计值与短期速率都在目标内，触发一致性才能覆盖两条预警。
        targetIndicatorIds: [SETTLEMENT_INDICATOR_ID, SETTLEMENT_SLOPE_INDICATOR_ID],
        evidenceRequirements: ["监测日报"],
        contraindications: [],
      },
    ],
  },
  // 发布的 `forecast-policy` 成员就是 `DEMO_FORECAST_POLICIES[0]` 本身：分段入口冻结的
  // `forecastPolicyRef` 指向本类配置的已发布释放，成员正文的 `requiredRef` 则是预测执行器
  // 读取模型工件的精确引用。两者语义不同，不能互相冒充；执行器按 `requiredRef` 精确匹配，
  // 正文里留占位字面量会让执行器永远找不到实现（C28 记 `executor-unavailable`）。
  // 调用方在模型工件经 C04 登记后把真实引用注入此处，故本类配置也推迟到那时才发布。
  "forecast-policy": ({ forecastModelRef }) => ({
    policies: [
      {
        policyId: DEMO_FORECAST_POLICIES[0].policyId,
        method: DEMO_FORECAST_POLICIES[0].method,
        inputIndicatorIds: [...DEMO_FORECAST_POLICIES[0].inputIndicatorIds],
        targetIndicatorId: DEMO_FORECAST_POLICIES[0].targetIndicatorId,
        horizonSteps: DEMO_FORECAST_POLICIES[0].horizonSteps,
        unit: DEMO_FORECAST_POLICIES[0].unit,
        requiredRef: forecastModelRef,
      },
    ],
  }),
  /**
   * C28 私有偏差事实按冻结依据里的这一份唯一策略计算：`policies.length > 1` 会以
   * `response-deviation-policy-mismatch` 关闭失败，所以这里只发布一条绝对偏差策略。
   *
   * 阈值取 1 mm：演示数据的地表沉降序列 2 mm/s 线性上升，趋势预测（horizonSteps=1）
   * 给出 22 mm，而实际评估在同一 cutoff 处是 20 mm，绝对偏差 2 mm 严格大于 1 mm，
   * 偏差记录才真实成立并驱动 A3/A4 校准。阈值不是为了让流程通过而调松的装饰参数：
   * 它就是「多大偏差算值得校准」这条业务口径的合成取值（待甲方复核）。
   */
  "deviation-policy": {
    policies: [
      {
        policyId: "demo-deviation-absolute",
        basis: "absolute",
        threshold: "1",
        evidenceRequirements: ["monitoring-record"],
      },
    ],
  },
});

/** C18 指标标识：C19 编制与 C25 取值都只认这里登记的指标，不自造指标名。 */
/** 按 indicatorId 升序：地表沉降 < 地表沉降短期速率 < 泥水压力。 */
export const DEMO_CONFIGURATION_INDICATOR_IDS = Object.freeze([
  SETTLEMENT_INDICATOR_ID,
  SETTLEMENT_SLOPE_INDICATOR_ID,
  SLURRY_PRESSURE_INDICATOR_ID,
]);

/** 可能性侧指标标识：编制规则候选按量纲分档时需要区分它与后果侧指标。 */
export const POSSIBILITY_DEMO_INDICATOR_ID = SLURRY_PRESSURE_INDICATOR_ID;

/** 沉降短期速率指标标识：分档线量纲与累计沉降不同，编制时单独取一条。 */
export const SETTLEMENT_SLOPE_DEMO_INDICATOR_ID = SETTLEMENT_SLOPE_INDICATOR_ID;

/**
 * 已发布措施库里的措施标识（按 `measureId` 升序）。
 *
 * C27 组合 Agent 的冻结候选选择只取这份已发布清单：选到未发布的措施会在 C27 的
 * 确定性校验处被拒，而不是靠部署私藏一份候选冒充冻结集合。
 */
export const DEMO_MEASURE_IDS = Object.freeze(
  configurationContents["measure-library"].measures.map((measure) => measure.measureId).sort(),
);

/**
 * 生成 11 类配置正文文档。`projectRevisionRef` 与 `configurationSetRef` 由装配注入，
 * 决定配置集身份：同一工程修订下的同一配置集才被认为是一个可解析的集合。
 */
/**
 * `forecast-policy` 的 `requiredRef` 只能取真实登记后的模型工件引用（C04 内容寻址），
 * 因此该类配置必须晚于模型工件生成；调用方未给出引用时该类不可发布，不填占位值。
 */
export const makeDemoAssessmentConfigurationDocuments = ({
  projectRevisionRef,
  configurationSetRef = DEMO_CONFIGURATION_SET_REF,
  forecastModelRef,
}) =>
  Object.fromEntries(
    Object.entries(configurationContents).map(([definitionType, content]) => [
      definitionType,
      {
        schemaVersion: "1",
        definitionType,
        projectRevisionRef,
        configurationSetRef,
        content: typeof content === "function" ? content({ forecastModelRef }) : content,
      },
    ]),
  );

export { DEMO_CONFIGURATION_SET_REF, DEMO_RISK_MATRIX_REF };

export { refKey };
