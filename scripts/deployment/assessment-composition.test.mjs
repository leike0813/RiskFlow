import { describe, expect, it, vi } from "vitest";

import {
  createAssessmentRuntimePolicyProviderV1,
  createDeploymentCalibrationAgentV1,
  createDeploymentAssessmentV1,
  createDeploymentAssessmentGraphPoliciesV1,
  createDeploymentRecommendationAgentV1,
  createRecommendationPolicyProviderV1,
  createWarningRuntimePolicyProviderV1,
} from "./composition/assessment.mjs";

const reference = (entityId, versionId = "v1") => ({ entityId, versionId });

const budgetPolicy = (projectId, prefix) => ({
  schemaVersion: "1",
  policyRef: reference(`${prefix}-budget:${projectId}`),
  modelDeploymentRef: reference(`model:${projectId}`),
  promptTemplateRef: reference(`prompt:${projectId}`),
  toolPolicyRef: reference(`${prefix}-tools:${projectId}`),
  maxModelInvocations: 4,
  maxToolInvocations: 8,
  maxContextTokens: 4096,
  maxInputBytes: 65_536,
  maxOutputBytes: 65_536,
  maxCandidates: 4,
  maxObjects: 8,
  maxSupplementarySearches: 1,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 2,
  maxWallClockMs: 60_000,
});

const projectPolicies = (projectId) => ({
  binding: {
    projectId,
    forecastPolicyReleaseRef: {
      kind: "knowledge-release",
      reference: reference(`forecast:${projectId}`),
    },
    calibrationTargetReleaseRef: {
      kind: "knowledge-release",
      reference: reference(`calibration-target:${projectId}`),
    },
  },
  policies: {
    "assessment-runtime": {
      schemaVersion: "1",
      projectId,
      responseGenerationPolicyRef: reference(`response-generation:${projectId}`),
      responseValidationPolicyRef: reference(`response-validation:${projectId}`),
      responseAgentPolicyRef: reference(`response-agent:${projectId}`),
      calibrationAgentPolicyRef: reference(`calibration:${projectId}`),
      retryPolicyRef: reference(`retry:${projectId}`),
      reviewPolicyRef: reference(`retrieval-review:${projectId}`),
      warningAggregationPolicyRef: reference(`aggregation:${projectId}`),
      notificationPolicyRef: reference(`notification:${projectId}`),
      modelDeploymentRef: reference(`model:${projectId}`),
      promptTemplateRef: reference(`prompt:${projectId}`),
    },
    "warning-runtime": {
      schemaVersion: "1",
      projectId,
      warningAggregationPolicy: {
        schemaVersion: "1",
        projectId,
        policyRef: reference(`aggregation:${projectId}`),
        responseDirectionByTriggerType: {},
      },
      notificationPolicy: {
        policyRef: reference(`notification:${projectId}`),
      },
    },
    "response-agent": {
      schemaVersion: "1",
      projectId,
      policyRef: reference(`response-agent:${projectId}`),
      definitionRef: reference(`response-agent-definition:${projectId}`),
      toolPolicyRef: reference(`response-agent-tools:${projectId}`),
      incrementSchemaRef: reference(`response-agent-increment:${projectId}`),
      validationPolicyRef: reference(`response-validation:${projectId}`),
      budgetPolicy: budgetPolicy(projectId, "response-agent"),
    },
    "response-generation": {
      schemaVersion: "1",
      projectId,
      policyRef: reference(`response-generation:${projectId}`),
    },
    "response-validation": {
      schemaVersion: "1",
      projectId,
      policyRef: reference(`response-validation:${projectId}`),
    },
    calibration: {
      schemaVersion: "1",
      projectId,
      policyRef: reference(`calibration:${projectId}`),
      definitionRef: reference(`calibration-definition:${projectId}`),
      toolPolicyRef: reference(`calibration-tools:${projectId}`),
      incrementSchemaRef: reference(`calibration-increment:${projectId}`),
      validationPolicyRef: reference(`calibration-validation:${projectId}`),
      budgetPolicy: budgetPolicy(projectId, "calibration"),
      evidenceRequirementCount: 1,
      maxOperations: 1,
    },
  },
});

/**
 * 真实 provider 的占位：本文件只验证装配与精确策略解析契约，不接数据库。
 * 工厂构造阶段不触碰数据库，占位对象不会被用来断言任何业务结果。
 */
const options = (overrides = {}) => {
  const registered = [];
  const providers = {
    foundation: {
      config: { projectBindings: [{ projectId: "project-a" }] },
      runtime: { db: {} },
      transactionUnit: { execute: () => undefined },
      access: { verify: () => undefined },
      artifactStore: { put: () => undefined, open: () => undefined },
      referenceGuard: { assertUsable: () => undefined },
      monitoringStore: { readSnapshot: () => undefined },
      contextSource: { freeze: () => undefined },
    },
    resolveDeploymentPolicies: {
      resolveProject: (projectId) => {
        const project = projects.get(projectId);
        if (project === undefined) throw new TypeError("DEPLOYMENT_PROJECT_BINDING_MISSING");
        return project;
      },
    },
    registry: {
      register: (definition) => registered.push(definition.metadata.taskType),
      assertComplete: () => undefined,
    },
    checkpointer: { getTuple: () => undefined },
    basis: { readAssessmentBasisReleaseSet: () => undefined },
    review: {
      requestReview: () => undefined,
      verifyCalibrationSuggestionApproval: () => undefined,
    },
    workflowAdapter: {
      entriesRead: { readAssessmentEntriesForRecords: () => undefined },
      runRead: { readAssessmentRun: () => undefined },
    },
    riskInputFacts: { readRiskInputFacts: () => undefined },
    identificationRead: { read: () => undefined },
    governance: { govern: () => undefined },
    routeDecisions: { readRouteDecision: () => undefined },
    taskAuthorization: { authorize: () => undefined },
    reviewAuthorization: { authorize: () => undefined },
    measureReleaseReader: { readPublishedMeasureReleases: () => undefined },
    recommendationAgent: {
      resolveSiteContextRef: () => undefined,
      ensureTask: () => undefined,
    },
    calibrationAgent: { ensureTask: () => undefined },
    calibrationTaskPort: {
      validateIncrement: () => undefined,
      finalizeIncrement: () => undefined,
    },
    forecastPolicies: [{ method: "deterministic", requiredRef: reference("forecast-model") }],
    policies: {
      resolveForecastPolicy: () => undefined,
      resolveCalibrationPolicy: () => undefined,
    },
    authorizeDownstream: async () => undefined,
    runtimeAuthorization: { verifyCurrent: () => undefined },
    siteBindings: [],
    ...overrides,
  };
  return Object.assign(providers, { registered });
};

const projects = new Map([["project-a", projectPolicies("project-a")]]);

const basisRef = (projectId = "project-a") => ({
  kind: "assessment-basis-release-set",
  reference: reference(`basis:${projectId}`),
});

const basisMember = (releaseRef) => ({
  releaseRef,
  revisionRef: {
    kind: "knowledge-revision",
    reference: reference(`revision:${releaseRef.reference.entityId}`),
  },
  artifactRef: {
    kind: "content-artifact",
    reference: reference(`artifact:${releaseRef.reference.entityId}`),
  },
  contentDigest: "a".repeat(64),
});

const successfulBasis = (requestedRef, overrides = {}) => {
  const { forecastReleaseRef, configurationMembers, scoringRuleMembers } = overrides;
  const definitionTypes = [
    "indicator-system",
    "indicator-field-mapping",
    "weight-set",
    "scoring-strategy",
    "risk-matrix",
    "risk-acceptance-threshold",
    "monitoring-warning-threshold",
    "joint-trigger-policy",
    "measure-library",
    "forecast-policy",
    "deviation-policy",
  ].sort();
  return {
    kind: "succeeded",
    schemaVersion: "1",
    assessmentBasisReleaseSetRef: requestedRef,
    memberDigest: "b".repeat(64),
    applicableRuleSetMember: basisMember({
      kind: "knowledge-release",
      reference: reference("rules"),
    }),
    scoringRuleMembers: [
      basisMember({
        kind: "knowledge-release",
        reference: reference("scoring-rule"),
      }),
    ],
    configurationMembers: definitionTypes.map((definitionType) => ({
      definitionType,
      ...basisMember(
        definitionType === "forecast-policy"
          ? (forecastReleaseRef ?? requestedRefFor("forecast"))
          : definitionType === "weight-set"
            ? {
                kind: "knowledge-release",
                reference: reference("calibration-target:project-a"),
              }
            : { kind: "knowledge-release", reference: reference(`release:${definitionType}`) },
      ),
    })),
    ...(scoringRuleMembers === undefined ? {} : { scoringRuleMembers }),
    ...(configurationMembers === undefined ? {} : { configurationMembers }),
  };
};

const requestedRefFor = (type) => ({
  kind: "knowledge-release",
  reference: reference(`${type}:project-a`),
});

const graphPolicyInput = (projectId = "project-a") => ({
  projectId,
  basisReleaseSetRef: basisRef(projectId),
  requiredAt: "2026-10-11T00:00:00.000Z",
  authorization: {
    projectId,
    actorId: "actor-1",
    spatialScopeRefs: [],
  },
});

const runForAgentTask = (frozenRefs = []) => {
  const scope = { kind: "spatial-scope", reference: reference("scope-a") };
  return {
    projectId: "project-a",
    actorId: "actor-1",
    commandId: "assessment-command",
    issuedInvocationId: "assessment-invocation",
    idempotencyKey: "assessment-run-idempotency",
    issuedAt: "2026-10-11T00:00:00.000Z",
    validAt: "2026-10-11T00:00:00.000Z",
    runRef: { kind: "workflow-run", reference: reference("run-a") },
    parentRunRef: undefined,
    entryMode: "assess",
    entryIdentity: reference("entry-a"),
    frozenRefs,
    spatialScopeRef: scope,
    authorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: reference("authorization-a"),
      },
      projectId: "project-a",
      actorId: "actor-1",
      grantedCapabilities: ["agent-task.start", "warning-response.recommend"],
      spatialScopeRefs: [scope],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: reference("authorization-policy"),
      decidedAt: "2026-10-11T00:00:00.000Z",
      invocation: { kind: "human" },
    },
  };
};

const agentTaskRefFor = (input, taskType) => {
  const policy = projects.get(input.run.projectId).policies[
    taskType === "response-recommendation" ? "response-agent" : "calibration"
  ];
  return {
    kind: "agent-task",
    reference: reference(`agent-task:${input.run.projectId}:${input.actionId}`, "1"),
    taskType,
    triggerMode: "embedded",
    modelDeploymentRef: policy.budgetPolicy.modelDeploymentRef,
    promptTemplateRef: policy.budgetPolicy.promptTemplateRef,
    toolPolicyRef: policy.toolPolicyRef,
    budgetPolicyRef: policy.budgetPolicy.policyRef,
    incrementSchemaRef: policy.incrementSchemaRef,
    validationPolicyRef: policy.validationPolicyRef,
  };
};

const agentTaskSnapshot = ({ taskRef, input, taskType, status, resultRef }) => ({
  envelope: {
    agentTaskRef: taskRef,
    commandId: input.actionId,
    idempotencyKey: input.actionId,
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    taskType,
    parentRunRef: input.run.runRef,
    frozenInputRef: input.frozenInputRef ?? input.queryResultRef,
    modelDeploymentRef: projects.get(input.run.projectId).policies[
      taskType === "response-recommendation" ? "response-agent" : "calibration"
    ].budgetPolicy.modelDeploymentRef,
    promptTemplateRef: projects.get(input.run.projectId).policies[
      taskType === "response-recommendation" ? "response-agent" : "calibration"
    ].budgetPolicy.promptTemplateRef,
    toolPolicyRef: projects.get(input.run.projectId).policies[
      taskType === "response-recommendation" ? "response-agent" : "calibration"
    ].toolPolicyRef,
    budgetPolicyRef: projects.get(input.run.projectId).policies[
      taskType === "response-recommendation" ? "response-agent" : "calibration"
    ].budgetPolicy.policyRef,
    incrementSchemaRef: projects.get(input.run.projectId).policies[
      taskType === "response-recommendation" ? "response-agent" : "calibration"
    ].incrementSchemaRef,
    validationPolicyRef: projects.get(input.run.projectId).policies[
      taskType === "response-recommendation" ? "response-agent" : "calibration"
    ].validationPolicyRef,
  },
  state: {
    agentTaskRef: taskRef,
    status,
    ...(resultRef === undefined ? {} : { resultRef }),
    ...(status === "terminal-failure" ? { error: { code: "AGENT_MODEL_FAILED" } } : {}),
    ...(status === "cancelled" ? { cancelReasonCode: "operator-cancelled" } : {}),
  },
});

describe("评估生产组合的装配契约", () => {
  it("装配成功后暴露组合、API、只读接缝与就绪核验", () => {
    const providers = options();
    const result = createDeploymentAssessmentV1(providers);

    expect(Object.keys(result.compositions)).toEqual([
      "riskAssessment",
      "warning",
      "recommendation",
      "responseLifecycle",
      "calibration",
      "graph",
    ]);
    expect(result.api.riskAssessment).toBe(result.compositions.riskAssessment);
    expect(result.readers.agentTasks).toBeDefined();
    expect(result.assertReady()).toBe(result);
  });

  it("C27 与 C29 任务定义注册在宿主同一 registry 上且顺序固定", () => {
    const providers = options();
    createDeploymentAssessmentV1(providers);
    expect(providers.registered).toEqual(["response-recommendation", "calibration-suggestion"]);
  });

  it("缺任一必需依赖即构造失败，不以占位实现补位", () => {
    for (const name of [
      "registry",
      "checkpointer",
      "basis",
      "review",
      "workflowAdapter",
      "riskInputFacts",
      "identificationRead",
      "governance",
      "routeDecisions",
      "taskAuthorization",
      "reviewAuthorization",
      "measureReleaseReader",
      "recommendationAgent",
      "calibrationAgent",
      "calibrationTaskPort",
      "forecastPolicies",
      "policies",
      "runtimeAuthorization",
      "siteBindings",
    ]) {
      expect(
        () => createDeploymentAssessmentV1(options({ [name]: undefined })),
        `缺少 ${name} 时应报缺`,
      ).toThrow("DEPLOYMENT_ASSESSMENT_DEPENDENCY_MISSING");
    }
  });

  it("端口存在但缺方法时同样失败关闭", () => {
    expect(() =>
      createDeploymentAssessmentV1(options({ review: { requestReview: () => undefined } })),
    ).toThrow("DEPLOYMENT_ASSESSMENT_PORT_INVALID:review.verifyCalibrationSuggestionApproval");
    expect(() => createDeploymentAssessmentV1(options({ forecastPolicies: [] }))).toThrow(
      "DEPLOYMENT_FORECAST_POLICIES_REQUIRED",
    );
  });

  it("工程重复、策略工程不符与无绑定工程都拒绝装配", () => {
    const duplicated = options();
    duplicated.foundation.config.projectBindings = [
      { projectId: "project-a" },
      { projectId: "project-a" },
    ];
    expect(() => createDeploymentAssessmentV1(duplicated)).toThrow(
      "DEPLOYMENT_ASSESSMENT_PROJECT_DUPLICATE",
    );

    const mismatched = options({
      resolveDeploymentPolicies: {
        resolveProject: () => ({ binding: { projectId: "project-b" }, policies: {} }),
      },
    });
    expect(() => createDeploymentAssessmentV1(mismatched)).toThrow(
      "DEPLOYMENT_ASSESSMENT_POLICY_PROJECT_MISMATCH",
    );

    const unbound = options();
    unbound.foundation.config.projectBindings = [];
    expect(() => createDeploymentAssessmentV1(unbound)).toThrow(
      "DEPLOYMENT_ASSESSMENT_PROJECT_BINDINGS_REQUIRED",
    );
  });
});

describe("评估运行策略按工程精确解析", () => {
  it("C25 十项策略只返回该工程登记的批准组合身份", async () => {
    const provider = createAssessmentRuntimePolicyProviderV1(projects);
    const authorization = { projectId: "project-a" };
    await expect(provider.readRuntimePolicySet({ authorization })).resolves.toMatchObject({
      kind: "succeeded",
      policySet: projects.get("project-a").policies["assessment-runtime"],
    });
  });

  it("工程未登记时抛宿主错误，不返回伪造的失败 DTO", async () => {
    const provider = createAssessmentRuntimePolicyProviderV1(projects);
    await expect(
      provider.readRuntimePolicySet({ authorization: { projectId: "project-b" } }),
    ).rejects.toThrow("DEPLOYMENT_ASSESSMENT_PROJECT_POLICY_MISSING");
  });

  it("C26 策略集的两项成员引用必须逐字匹配该工程登记", async () => {
    const provider = createWarningRuntimePolicyProviderV1(projects);
    const expected = projects.get("project-a").policies["warning-runtime"];
    const input = {
      authorization: { projectId: "project-a" },
      warningAggregationPolicyRef: reference("aggregation:project-a"),
      notificationPolicyRef: reference("notification:project-a"),
    };
    await expect(provider.read(input)).resolves.toBe(expected);
    await expect(
      provider.read({ ...input, warningAggregationPolicyRef: reference("aggregation:other") }),
    ).rejects.toThrow("DEPLOYMENT_WARNING_RUNTIME_POLICY_MEMBER_MISMATCH");
  });
});

describe("C25 预测与校准策略按冻结依据精确解析", () => {
  const authorizationFor = async ({ projectId, actorId, invocationId, decidedAt }) => ({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: reference(`auth:${invocationId}`),
    },
    projectId,
    actorId,
    grantedCapabilities: ["knowledge-modeling.read"],
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: reference("auth-policy"),
    decidedAt: decidedAt ?? "2026-10-11T00:00:00.000Z",
    invocation: { kind: "human" },
  });

  const providerFor = (read, map = projects, authorize = authorizationFor) =>
    createDeploymentAssessmentGraphPoliciesV1({
      projects: map,
      basis: { readAssessmentBasisReleaseSet: read },
      authorizeDownstream: authorize,
    });

  it("预测和校准只接受同一冻结集合中的指定成员并返回原 Schema 策略", async () => {
    const reads = [];
    const signed = [];
    const provider = providerFor(
      async (request) => {
        reads.push(request);
        return successfulBasis(request.assessmentBasisReleaseSetRef);
      },
      projects,
      async (request) => {
        signed.push(request);
        return authorizationFor(request);
      },
    );
    const input = graphPolicyInput();

    await expect(provider.resolveForecastPolicy(input)).resolves.toEqual({
      kind: "resolved",
      forecastPolicyRef: reference("forecast:project-a"),
    });
    await expect(provider.resolveCalibrationPolicy(input)).resolves.toEqual({
      kind: "resolved",
      targetReleaseRef: projects.get("project-a").binding.calibrationTargetReleaseRef,
      calibrationValidationPolicyRef: reference("calibration-validation:project-a"),
      agentPolicy: projects.get("project-a").policies.calibration,
    });
    await provider.resolveForecastPolicy(input);
    expect(reads).toHaveLength(3);
    for (const request of reads) {
      expect(request.requestId).toBe(request.idempotencyKey);
      expect(request.authorization.grantedCapabilities).toContain("knowledge-modeling.read");
    }
    expect(reads[0].requestId).not.toBe(reads[1].requestId);
    expect(reads[0].requestId).toBe(reads[2].requestId);
    expect(signed.map((request) => request.invocationId)).toEqual(
      reads.map((request) => request.requestId),
    );
    expect(
      signed.every((request) => request.branch === "knowledge-modeling.assessment-basis"),
    ).toBe(true);
  });

  it("历史 requiredAt 保留冻结语义，依据读取仍使用当前下游授权时刻", async () => {
    const reads = [];
    const provider = providerFor(
      async (request) => {
        reads.push(request);
        return successfulBasis(request.assessmentBasisReleaseSetRef);
      },
      projects,
      async (request) => authorizationFor({ ...request, decidedAt: "2026-10-11T12:00:00.000Z" }),
    );

    const historicalInput = {
      ...graphPolicyInput(),
      requiredAt: "2020-01-01T00:00:00.000Z",
    };
    await expect(provider.resolveForecastPolicy(historicalInput)).resolves.toMatchObject({
      kind: "resolved",
    });
    await expect(provider.resolveForecastPolicy(graphPolicyInput())).resolves.toMatchObject({
      kind: "resolved",
    });
    expect(reads.map((request) => request.requestedAt)).toEqual([
      "2026-10-11T12:00:00.000Z",
      "2026-10-11T12:00:00.000Z",
    ]);
    expect(reads[0].requestId).not.toBe(reads[1].requestId);
  });

  it("下游授权上下文缺少 decidedAt 时以当前时钟复验依据读取", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:34:56.000Z"));
    try {
      const reads = [];
      const provider = providerFor(
        async (request) => {
          reads.push(request);
          return successfulBasis(request.assessmentBasisReleaseSetRef);
        },
        projects,
        async (request) => {
          const authorization = await authorizationFor(request);
          delete authorization.decidedAt;
          return authorization;
        },
      );

      await expect(provider.resolveForecastPolicy(graphPolicyInput())).resolves.toMatchObject({
        kind: "resolved",
      });
      expect(reads[0].requestedAt).toBe("2026-10-11T12:34:56.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("成员缺失、版本漂移或 definitionType 不符时返回 unavailable", async () => {
    const drifted = providerFor(async (request) =>
      successfulBasis(request.assessmentBasisReleaseSetRef, {
        forecastReleaseRef: {
          kind: "knowledge-release",
          reference: reference("forecast:project-a", "v2"),
        },
      }),
    );
    await expect(drifted.resolveForecastPolicy(graphPolicyInput())).resolves.toMatchObject({
      kind: "unavailable",
    });

    const missingMember = providerFor(async (request) => {
      const read = successfulBasis(request.assessmentBasisReleaseSetRef);
      read.configurationMembers.find(
        (entry) => entry.definitionType === "forecast-policy",
      ).releaseRef = {
        kind: "knowledge-release",
        reference: reference("other-forecast"),
      };
      return read;
    });
    await expect(missingMember.resolveForecastPolicy(graphPolicyInput())).resolves.toMatchObject({
      kind: "unavailable",
    });

    const wrongDefinition = providerFor(async (request) => {
      const read = successfulBasis(request.assessmentBasisReleaseSetRef);
      const target = read.configurationMembers.find(
        (entry) => entry.definitionType === "weight-set",
      );
      target.definitionType = "indicator-system";
      const other = read.configurationMembers.find(
        (entry) => entry !== target && entry.definitionType === "indicator-system",
      );
      other.definitionType = "weight-set";
      read.configurationMembers.sort((left, right) =>
        left.definitionType.localeCompare(right.definitionType),
      );
      return read;
    });
    await expect(
      wrongDefinition.resolveCalibrationPolicy(graphPolicyInput()),
    ).resolves.toMatchObject({ kind: "unavailable" });

    const missing = providerFor(async () => ({ kind: "unavailable", error: {} }));
    await expect(missing.resolveForecastPolicy(graphPolicyInput())).resolves.toMatchObject({
      kind: "unavailable",
    });
  });

  it("校准目标也可精确来自原 C19 scoringRuleMembers", async () => {
    const provider = providerFor(async (request) => {
      const read = successfulBasis(request.assessmentBasisReleaseSetRef, {
        scoringRuleMembers: [
          basisMember(projects.get("project-a").binding.calibrationTargetReleaseRef),
        ],
      });
      read.configurationMembers.find((entry) => entry.definitionType === "weight-set").releaseRef =
        {
          kind: "knowledge-release",
          reference: reference("other-calibration-target"),
        };
      return read;
    });
    await expect(provider.resolveCalibrationPolicy(graphPolicyInput())).resolves.toMatchObject({
      kind: "resolved",
      targetReleaseRef: projects.get("project-a").binding.calibrationTargetReleaseRef,
    });
  });

  it("按输入工程读取 binding，不会使用另一工程的首个策略", async () => {
    const projectB = projectPolicies("project-b");
    const projectMap = new Map([...projects, ["project-b", projectB]]);
    const provider = providerFor(
      async (request) =>
        successfulBasis(request.assessmentBasisReleaseSetRef, {
          forecastReleaseRef: projectB.binding.forecastPolicyReleaseRef,
        }),
      projectMap,
    );
    await expect(provider.resolveForecastPolicy(graphPolicyInput("project-b"))).resolves.toEqual({
      kind: "resolved",
      forecastPolicyRef: reference("forecast:project-b"),
    });
  });

  it("C19 技术异常向上传递，不降级成 unavailable", async () => {
    const provider = providerFor(async () => {
      throw new Error("database unavailable");
    });
    await expect(provider.resolveForecastPolicy(graphPolicyInput())).rejects.toThrow(
      "database unavailable",
    );
  });
});

describe("C27 处置策略与现场上下文按精确引用解析", () => {
  const siteContext = { schemaVersion: "1", siteContextRef: reference("site") };

  it("三项策略只按请求给出的精确引用返回该工程批准正文", async () => {
    const provider = createRecommendationPolicyProviderV1(projects, {
      read: async () => siteContext,
    });
    const authorization = { projectId: "project-a" };
    await expect(
      provider.readGenerationPolicy({
        authorization,
        generationPolicyRef: reference("response-generation:project-a"),
      }),
    ).resolves.toBe(projects.get("project-a").policies["response-generation"]);
    await expect(
      provider.readAgentPolicy({
        authorization,
        agentPolicyRef: reference("response-agent:project-a"),
      }),
    ).resolves.toBe(projects.get("project-a").policies["response-agent"]);
    await expect(
      provider.readValidationContext({
        requestId: "read-validation",
        requestedAt: "2026-10-11T00:00:00.000Z",
        authorization,
        validationPolicyRef: reference("response-validation:project-a"),
        siteContextRef: reference("site"),
      }),
    ).resolves.toMatchObject({ siteContext });
  });

  it("引用不属于该工程登记时失败关闭，不回退到同工程其它版本", async () => {
    const provider = createRecommendationPolicyProviderV1(projects, {
      read: async () => siteContext,
    });
    await expect(
      provider.readGenerationPolicy({
        authorization: { projectId: "project-a" },
        generationPolicyRef: reference("response-generation:project-a", "v2"),
      }),
    ).rejects.toThrow("DEPLOYMENT_RECOMMENDATION_POLICY_REF_MISMATCH:response-generation");
  });

  it("受权现场正文缺失时按部署缺陷失败，不返回空白现场", async () => {
    const provider = createRecommendationPolicyProviderV1(projects, {
      read: async () => undefined,
    });
    await expect(
      provider.readValidationContext({
        requestId: "read-validation",
        requestedAt: "2026-10-11T00:00:00.000Z",
        authorization: { projectId: "project-a" },
        validationPolicyRef: reference("response-validation:project-a"),
        siteContextRef: reference("site"),
      }),
    ).rejects.toThrow("DEPLOYMENT_SITE_CONTEXT_UNAVAILABLE");
  });
});

describe("C27/C29 生产 Agent provider", () => {
  const completedTask = ({ taskType, taskRef, candidateRef, input }) =>
    agentTaskSnapshot({
      taskRef,
      input,
      taskType,
      status: "completed",
      resultRef: {
        kind: "agent-task-result",
        reference: reference(`result:${taskRef.reference.entityId}`),
        status: "completed",
        agentTaskRef: taskRef,
        candidateRef,
      },
    });

  it("C27 用 actionId 幂等启动真实任务，pending 等待，completed 只返回 C08 终态结果", async () => {
    const input = {
      run: runForAgentTask(),
      actionId: "run-a:A7:recommendation-agent",
      queryResultRef: {
        kind: "knowledge-query-result",
        reference: reference("query-a"),
      },
      warningResponseTaskRef: {
        kind: "warning-response-task",
        reference: reference("warning-task-a"),
      },
      responseGenerationPolicyRef: reference("response-generation:project-a"),
      responseAgentPolicyRef: reference("response-agent:project-a"),
    };
    const taskRef = agentTaskRefFor(input, "response-recommendation");
    const candidateRef = {
      kind: "recommendation-candidate",
      reference: reference("recommendation-candidate-a"),
    };
    let state = agentTaskSnapshot({
      taskRef,
      input,
      taskType: "response-recommendation",
      status: "running",
    });
    const starts = [];
    const authorizations = [];
    const provider = createDeploymentRecommendationAgentV1({
      tasks: {
        startTask: async (command) => {
          starts.push(command);
          return { kind: "succeeded", result: { agentTaskRef: taskRef } };
        },
        getTask: async (ref) => {
          expect(ref).toEqual(taskRef);
          return state;
        },
      },
      resolveProject: (projectId) => projects.get(projectId),
      authorizeDownstream: async (request) => {
        authorizations.push(request);
        return {
          ...input.run.authorization,
          grantedCapabilities: ["agent-task.start"],
        };
      },
      siteBindings: [],
      siteContextReader: { read: vi.fn() },
    });

    await expect(provider.ensureTask(input)).resolves.toEqual({
      kind: "waiting",
      agentTaskRef: taskRef,
    });
    state = completedTask({
      taskType: "response-recommendation",
      taskRef,
      candidateRef,
      input,
    });
    await expect(provider.ensureTask(input)).resolves.toMatchObject({
      kind: "completed",
      agentTaskRef: taskRef,
      agentTaskResultRef: { candidateRef },
    });
    expect(starts).toHaveLength(2);
    expect(starts[0].commandId).toBe(input.actionId);
    expect(starts[0].idempotencyKey).toBe(input.actionId);
    expect(starts[1]).toEqual(starts[0]);
    expect(starts[0].payload).toMatchObject({
      taskType: "response-recommendation",
      triggerMode: "embedded",
      parentRunRef: input.run.runRef,
      frozenInputRef: input.queryResultRef,
      budgetPolicyRef: projects.get("project-a").policies["response-agent"].budgetPolicy.policyRef,
    });
    expect(authorizations.map(({ invocationId, branch }) => ({ invocationId, branch }))).toEqual([
      { invocationId: input.actionId, branch: "agent-task.start-task" },
      { invocationId: input.actionId, branch: "agent-task.start-task" },
    ]);
  });

  it("C27 任务失败显式失败，C29 使用本次冻结工件和项目校准预算", async () => {
    const recommendationInput = {
      run: runForAgentTask(),
      actionId: "run-a:A7:failed-agent",
      queryResultRef: { kind: "knowledge-query-result", reference: reference("query-b") },
      warningResponseTaskRef: {
        kind: "warning-response-task",
        reference: reference("warning-task-b"),
      },
      responseGenerationPolicyRef: reference("response-generation:project-a"),
      responseAgentPolicyRef: reference("response-agent:project-a"),
    };
    const failedRef = agentTaskRefFor(recommendationInput, "response-recommendation");
    const recommendation = createDeploymentRecommendationAgentV1({
      tasks: {
        startTask: async () => ({ kind: "succeeded", result: { agentTaskRef: failedRef } }),
        getTask: async () =>
          agentTaskSnapshot({
            taskRef: failedRef,
            input: recommendationInput,
            taskType: "response-recommendation",
            status: "terminal-failure",
          }),
      },
      resolveProject: (projectId) => projects.get(projectId),
      authorizeDownstream: async () => ({
        ...recommendationInput.run.authorization,
        grantedCapabilities: ["agent-task.start"],
      }),
      siteBindings: [],
      siteContextReader: { read: vi.fn() },
    });
    await expect(recommendation.ensureTask(recommendationInput)).resolves.toEqual({
      kind: "failed",
      reasonCode: "AGENT_MODEL_FAILED",
    });

    const calibrationInput = {
      run: runForAgentTask(),
      actionId: "run-a:A4:calibration-agent",
      frozenInputRef: { kind: "content-artifact", reference: reference("calibration-input") },
      inputSnapshotRef: { kind: "calibration-input-snapshot", reference: reference("snapshot-a") },
      deviationRecordRef: { kind: "deviation-record", reference: reference("deviation-a") },
      calibrationValidationPolicyRef: reference("calibration-validation:project-a"),
    };
    const calibrationTaskRef = agentTaskRefFor(calibrationInput, "calibration-suggestion");
    let calibrationCommand;
    const calibration = createDeploymentCalibrationAgentV1({
      tasks: {
        startTask: async (command) => {
          calibrationCommand = command;
          return { kind: "succeeded", result: { agentTaskRef: calibrationTaskRef } };
        },
        getTask: async () => undefined,
      },
      resolveProject: (projectId) => projects.get(projectId),
      authorizeDownstream: async () => ({
        ...calibrationInput.run.authorization,
        grantedCapabilities: ["agent-task.start"],
      }),
    });
    await expect(calibration.ensureTask(calibrationInput)).resolves.toEqual({
      kind: "waiting",
      agentTaskRef: calibrationTaskRef,
    });
    expect(calibrationCommand.payload).toMatchObject({
      taskType: "calibration-suggestion",
      frozenInputRef: calibrationInput.frozenInputRef,
      budgetPolicyRef: projects.get("project-a").policies.calibration.budgetPolicy.policyRef,
      incrementSchemaRef: projects.get("project-a").policies.calibration.incrementSchemaRef,
      validationPolicyRef: calibrationInput.calibrationValidationPolicyRef,
    });
  });

  it("C27 现场 ref 必须同时出现在本次 frozenRefs 和同工程绑定中且唯一", async () => {
    const first = reference("site-a");
    const second = reference("site-b");
    const frozenRefs = [{ kind: "site-context", reference: first }];
    const run = runForAgentTask(frozenRefs);
    const siteContextReader = {
      read: async ({ siteContextRef }) => ({
        projectId: "project-a",
        siteContextRef,
        spatialScopeRef: run.spatialScopeRef,
        observedAt: "2026-10-10T23:00:00.000Z",
      }),
    };
    const provider = createDeploymentRecommendationAgentV1({
      tasks: { startTask: vi.fn(), getTask: vi.fn() },
      resolveProject: (projectId) => projects.get(projectId),
      authorizeDownstream: vi.fn(),
      siteBindings: [
        { projectId: "project-a", siteContextRef: first, artifactRef: reference("artifact-a") },
        { projectId: "project-a", siteContextRef: second, artifactRef: reference("artifact-b") },
        { projectId: "project-b", siteContextRef: first, artifactRef: reference("artifact-c") },
      ],
      siteContextReader,
    });
    await expect(provider.resolveSiteContextRef({ run, requiredAt: run.validAt })).resolves.toEqual(
      first,
    );
    run.frozenRefs = [...frozenRefs, { kind: "site-context", reference: second }];
    await expect(provider.resolveSiteContextRef({ run, requiredAt: run.validAt })).resolves.toBe(
      undefined,
    );
  });
});
