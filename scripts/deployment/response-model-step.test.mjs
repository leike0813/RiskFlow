import { describe, expect, it } from "vitest";

import { MODULE_BRANCH_CAPABILITY_V1 } from "../../packages/contracts/dist/ports/index.js";

import {
  AgentTaskEnvelopeV1Schema,
  buildCompletedAgentTaskResult,
} from "../../packages/core/dist/agent-runtime/index.js";
import {
  RiskMatrixDocumentV1Schema,
  assessmentConfigurationDocumentDigest,
} from "../../packages/core/dist/assessment-config/index.js";
import {
  CALIBRATION_AGENT_TASK_TYPE_V1,
  CalibrationCandidateV1Schema,
  CalibrationInputSnapshotV1Schema,
  createCalibrationSuggestionTaskDefinition,
  deriveCalibrationInputSnapshotRef,
} from "../../packages/core/dist/calibration/index.js";
import {
  MeasureCandidateSetV1Schema,
  RECOMMENDATION_TASK_TYPE_V1,
  ResponseAgentPolicyV1Schema,
  createResponseRecommendationTaskDefinition,
} from "../../packages/core/dist/recommendation/index.js";
import { ResponseDeviationFactV1Schema } from "../../packages/core/dist/response-lifecycle/index.js";

import { createDeploymentResponseModelStepV1 } from "./composition/response-model-step.mjs";

/** C37 D-23：宿主模型步对 C27/C29 的编排行为。端口是合成夹具，任务定义与领域正文用真实 core schema。 */

const TIMESTAMP = "2026-10-12T03:00:00.000Z";
const ref = (entityId, versionId = "1") => ({ entityId, versionId });
const digest = (seed) => seed.repeat(64).slice(0, 64);
const SCOPE = Object.freeze({ kind: "spatial-scope", reference: ref("scope-1", "s7") });
const OTHER_SCOPE_VERSION = Object.freeze({
  kind: "spatial-scope",
  reference: ref("scope-1", "s8"),
});
const SOURCE_VERSIONS = Object.freeze([ref("source-version", "2"), ref("other-source", "5")]);
const FROZEN_QUERY_REF = Object.freeze({
  kind: "knowledge-query-result",
  reference: ref("measure-candidate-query"),
});

const authorization = Object.freeze({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: ref("authorization-context"),
  },
  actorId: "operator",
  projectId: "project",
  grantedCapabilities: [
    "agent-task.start",
    MODULE_BRANCH_CAPABILITY_V1["warning-response.read"],
    MODULE_BRANCH_CAPABILITY_V1["warning-response.calculate-deviation"],
  ],
  spatialScopeRefs: [SCOPE],
  sourceAccessGrantRefs: [{ kind: "source-access-grant", reference: ref("grant-1") }],
  authorizationPolicyRef: ref("authorization-policy"),
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});

const budgetPolicyOf = (overrides = {}) => ({
  schemaVersion: "1",
  policyRef: ref("budget"),
  modelDeploymentRef: ref("model"),
  promptTemplateRef: ref("prompt"),
  toolPolicyRef: ref("tools"),
  maxModelInvocations: 4,
  maxToolInvocations: 2,
  maxContextTokens: 4096,
  maxOutputTokens: 1024,
  maxInputBytes: 65536,
  maxOutputBytes: 65536,
  maxCandidates: 4,
  maxObjects: 16,
  maxSupplementarySearches: 1,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 60000,
  ...overrides,
});

const taskRefFor = (taskType, entityId) => ({
  kind: "agent-task",
  reference: ref(entityId, "2"),
  taskType,
  triggerMode: "embedded",
  modelDeploymentRef: ref("model"),
  promptTemplateRef: ref("prompt"),
  toolPolicyRef: ref("tools"),
  budgetPolicyRef: ref("budget"),
  incrementSchemaRef: ref("increment"),
  validationPolicyRef: ref("validation"),
});

const taskOf = ({ taskType, entityId, budgetPolicy, latestCandidateVersion }) => ({
  envelope: AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRefFor(taskType, entityId),
    commandId: "start-task",
    idempotencyKey: "start-task",
    taskType,
    triggerMode: "embedded",
    projectId: "project",
    actorId: "operator",
    parentRunRef: { kind: "workflow-run", reference: ref("run") },
    frozenInputRef:
      taskType === RECOMMENDATION_TASK_TYPE_V1
        ? FROZEN_QUERY_REF
        : { kind: "content-artifact", reference: ref("calibration-input-artifact", "sha256:x") },
    modelDeploymentRef: ref("model"),
    promptTemplateRef: ref("prompt"),
    toolPolicyRef: ref("tools"),
    budgetPolicyRef: ref("budget"),
    incrementSchemaRef: ref("increment"),
    validationPolicyRef: ref("validation"),
    authorization,
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef: authorization.authorizationContextRef,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [SCOPE],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: authorization.authorizationPolicyRef,
      capturedAt: TIMESTAMP,
    },
    createdAt: TIMESTAMP,
  }),
  state: {
    schemaVersion: "1",
    agentTaskRef: taskRefFor(taskType, entityId),
    status: "running",
    taskVersion: 2,
    cancelRequested: false,
    latestCandidateVersion,
    updatedAt: TIMESTAMP,
  },
  budgetPolicy,
});

/* --- C27 冻结候选集正文 ---------------------------------------------------- */

const warningOf = (overrides = {}) => ({
  warningRecordRef: { kind: "warning-record", reference: ref("warning-1") },
  triggerType: "监测指标越限",
  triggerIndicators: [
    { indicatorItem: "indicator-1", triggerType: "监测指标越限", actualValue: 12.5 },
  ],
  resolvedTargetIndicatorIds: ["indicator-1"],
  unresolvedTriggerItems: [],
  evidenceReferences: [
    { locator: { sourceSegmentId: "segment-1" }, sourceVersion: ref("source-version", "2") },
  ],
  assessmentRecordRef: { kind: "risk-assessment-record", reference: ref("assessment-1") },
  assessmentInputSnapshotRef: {
    kind: "assessment-input-snapshot",
    reference: ref("assessment-input"),
  },
  preparationSnapshotRef: {
    kind: "assessment-preparation-snapshot",
    reference: ref("preparation-1"),
  },
  ...overrides,
});

const candidateSetOf = (overrides = {}) =>
  MeasureCandidateSetV1Schema.parse({
    schemaVersion: "1",
    projectId: "project",
    warningResponseTaskRef: {
      kind: "warning-response-task",
      reference: ref("warning-response-task", "3"),
    },
    riskInputRef: { kind: "standardized-risk-record", reference: ref("risk-1") },
    spatialScopeRef: SCOPE,
    applicableRuleSetRef: ref("rule-set-release"),
    basisReleaseSetRef: {
      kind: "assessment-basis-release-set",
      reference: ref("basis-1"),
    },
    measureLibraryReleaseRef: {
      kind: "measure-library-release",
      reference: ref("library-release"),
    },
    measureArtifactRef: {
      kind: "content-artifact",
      reference: ref("library", "sha256:" + digest("a")),
    },
    measureContentDigest: digest("b"),
    generationPolicyRef: ref("generation-policy"),
    validationPolicyRef: ref("validation-policy"),
    agentPolicyRef: ref("agent-policy"),
    reviewPolicyRef: ref("review-policy"),
    riskEventCategory: "突涌",
    warnings: [warningOf()],
    candidates: [
      {
        measure: {
          measureId: "measure-a",
          riskEventCategory: "突涌",
          applicabilityConditions: [],
          triggerTypes: ["监测指标越限"],
          steps: [{ stepOrdinal: 1, instruction: "执行 measure-a 第一步" }],
          resourceRequirements: ["resource-a"],
          targetIndicatorIds: ["indicator-1"],
          evidenceRequirements: ["evidence-a"],
          contraindications: [],
        },
        triggerTypes: ["监测指标越限"],
        warningRecordRefs: [{ kind: "warning-record", reference: ref("warning-1") }],
      },
    ],
    inputDigest: digest("c"),
    frozenAt: TIMESTAMP,
    frozenBy: "operator",
    ...overrides,
  });

/* --- C29 冻结快照、基准与偏差事实 ---------------------------------------- */

const baseDocument = () =>
  RiskMatrixDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType: "risk-matrix",
    projectRevisionRef: { kind: "project-revision", reference: ref("project-revision") },
    configurationSetRef: ref("configuration-set"),
    content: {
      matrixId: "matrix",
      matrixVersion: "1",
      possibilityAxis: { bands: [{ bandId: "p1", lower: "0", upper: "1" }] },
      consequenceAxis: { bands: [{ bandId: "c1", lower: "0", upper: "1" }] },
      riskLevels: [{ levelId: "low", ordinal: 1 }],
      cells: [{ possibilityBandId: "p1", consequenceBandId: "c1", riskLevelId: "low" }],
    },
  });

const INPUT_SNAPSHOT_REF = deriveCalibrationInputSnapshotRef({
  projectId: "project",
  deviationFactRef: ref("deviation-fact"),
  targetReleaseRef: ref("target-release"),
  calibrationValidationPolicyRef: ref("validation"),
});

const inputSnapshotOf = (overrides = {}) =>
  CalibrationInputSnapshotV1Schema.parse({
    schemaVersion: "1",
    projectId: "project",
    deviationFactRef: {
      kind: "response-deviation-fact",
      reference: ref("deviation-fact"),
    },
    deviationRecordRef: { kind: "deviation-record", reference: ref("deviation-record") },
    frozenAssessmentBasisRef: {
      kind: "assessment-input-snapshot",
      reference: ref("assessment-input"),
    },
    basisReleaseSetRef: {
      kind: "assessment-basis-release-set",
      reference: ref("basis-set"),
    },
    targetDefinitionType: "risk-matrix",
    targetReleaseRef: { kind: "knowledge-release", reference: ref("target-release") },
    baseArtifactRef: {
      kind: "content-artifact",
      reference: ref("base-artifact", "sha256:" + digest("d")),
    },
    baseContentDigest: assessmentConfigurationDocumentDigest(baseDocument()),
    calibrationValidationPolicyRef: ref("validation"),
    modelDeploymentRef: ref("model"),
    promptTemplateRef: ref("prompt"),
    toolPolicyRef: ref("tools"),
    budgetPolicyRef: ref("budget"),
    preparedBy: "operator",
    preparedAt: TIMESTAMP,
    ...overrides,
  });

const deviationFactOf = (overrides = {}) =>
  ResponseDeviationFactV1Schema.parse({
    schemaVersion: "1",
    projectId: "project",
    deviationFactRef: {
      kind: "response-deviation-fact",
      reference: ref("deviation-fact"),
    },
    responseRecommendationRef: {
      kind: "response-recommendation",
      reference: ref("recommendation-1"),
    },
    executionRecordRef: { kind: "execution-record", reference: ref("execution-1") },
    effectForecastRef: { kind: "effect-forecast", reference: ref("forecast-1") },
    feedbackRef: { kind: "feedback", reference: ref("feedback-1") },
    frozenAssessmentBasisRef: {
      kind: "assessment-input-snapshot",
      reference: ref("assessment-input"),
    },
    deviationPolicyRef: ref("deviation-policy"),
    basis: "absolute",
    riskMatrixRef: ref("matrix"),
    targetIndicatorId: "indicator-1",
    unit: "mm",
    predictedValue: "1.5",
    actualValue: "4.25",
    deviationValue: "2.75",
    deviationValueNumber: 2.75,
    thresholdExceeded: true,
    direction: "actual-above",
    predictedRiskState: { likelihoodScore: 1, consequenceScore: 1, riskLevel: "low" },
    actualRiskState: { likelihoodScore: 4, consequenceScore: 4, riskLevel: "high" },
    evidenceReferences: [
      { locator: { sourceSegmentId: "segment-1" }, sourceVersion: ref("source-version", "2") },
    ],
    summary: "监测指标越限导致沉降超限",
    spatialScopeRef: SCOPE,
    computedAt: TIMESTAMP,
    ...overrides,
  });

const calibrationCandidateOf = (taskRef, overrides = {}) =>
  CalibrationCandidateV1Schema.parse({
    schemaVersion: "1",
    taskRef,
    resultRef: buildCompletedAgentTaskResult(taskRef, {
      kind: "calibration-suggestion",
      reference: ref("proposed-candidate"),
    }),
    inputSnapshotRef: INPUT_SNAPSHOT_REF,
    rationale: "依据超限偏差调整矩阵阈值",
    evidenceReferences: [
      { locator: { sourceSegmentId: "segment-1" }, sourceVersion: ref("source-version", "2") },
    ],
    operations: [
      {
        kind: "replace-risk-matrix-band",
        definitionType: "risk-matrix",
        axis: "possibility",
        band: { bandId: "p1", lower: "0", upper: "2" },
      },
    ],
    ...overrides,
  });

const recommendationIncrement = (selections = [{ measureId: "measure-a", order: 1 }]) => ({
  schemaVersion: "1",
  selections,
});

/* --- 合成端口夹具 --------------------------------------------------------- */

const unusedPort = () => () => {
  throw new Error("TASK_PORT_MUST_NOT_BE_CALLED");
};

const setup = ({
  taskType = RECOMMENDATION_TASK_TYPE_V1,
  entityId = taskType + "-task",
  budgetOverrides,
  candidateSet,
  candidateRead = { kind: "succeeded" },
  snapshot,
  document = baseDocument(),
  fact,
  deviationRead,
  latestCandidateVersion,
  context = authorization,
  redacted = false,
  source,
  sourceMissing = false,
  inner,
} = {}) => {
  const budgetPolicy = budgetPolicyOf(budgetOverrides);
  const task = taskOf({ taskType, entityId, budgetPolicy, latestCandidateVersion });
  const definition =
    taskType === RECOMMENDATION_TASK_TYPE_V1
      ? createResponseRecommendationTaskDefinition({
          policy: ResponseAgentPolicyV1Schema.parse({
            schemaVersion: "1",
            policyRef: ref("agent-policy"),
            projectId: "project",
            definitionRef: ref("definition"),
            toolPolicyRef: ref("tools"),
            incrementSchemaRef: ref("increment"),
            validationPolicyRef: ref("validation"),
            budgetPolicy,
          }),
          port: { validateIncrement: unusedPort(), finalizeIncrement: unusedPort() },
        })
      : createCalibrationSuggestionTaskDefinition({
          policy: {
            definitionRef: ref("definition"),
            toolPolicyRef: ref("tools"),
            incrementSchemaRef: ref("increment"),
            validationPolicyRef: ref("validation"),
            budgetPolicy,
            evidenceRequirementCount: 1,
            maxOperations: 8,
          },
          port: { validateIncrement: unusedPort(), finalizeIncrement: unusedPort() },
        });

  const calls = {
    source: [],
    verify: [],
    downstream: [],
    candidates: [],
    deviation: [],
    modelInput: [],
    persist: [],
  };
  const effectiveSnapshot = snapshot ?? inputSnapshotOf();
  const step = createDeploymentResponseModelStepV1({
    now: () => TIMESTAMP,
    inner,
    authorizationScope: {
      async runTask(_task, run) {
        return run();
      },
      async authorizeDownstream(input) {
        calls.downstream.push(input);
        return authorization;
      },
    },
    access: {
      async readDeploymentAuthorizationSource(input) {
        calls.source.push(input);
        return sourceMissing
          ? undefined
          : (source ?? { context: authorization, sourceVersionRefs: SOURCE_VERSIONS });
      },
      async verifyDeploymentContext(input) {
        calls.verify.push(input);
        return { context, redacted };
      },
    },
    recommendation: {
      async readMeasureCandidateSet(input) {
        calls.candidates.push(input);
        return candidateRead.kind === "succeeded"
          ? {
              kind: "succeeded",
              knowledgeQueryResultRef: candidateRead.knowledgeQueryResultRef ?? FROZEN_QUERY_REF,
              candidateSet: candidateSet ?? candidateSetOf(),
              candidateSetArtifactRef: {
                kind: "content-artifact",
                reference: ref("candidate-set", "sha256:" + digest("e")),
              },
            }
          : candidateRead;
      },
    },
    responseLifecycle: {
      async readDeviationFact(input) {
        calls.deviation.push(input);
        return deviationRead ?? { kind: "succeeded", result: { fact: fact ?? deviationFactOf() } };
      },
    },
    calibrationTaskPort: {
      async readModelInput() {
        calls.modelInput.push(true);
        return { snapshot: effectiveSnapshot, inputSnapshotRef: INPUT_SNAPSHOT_REF, document };
      },
    },
    persistArtifact: async (input) => {
      calls.persist.push(input);
      return {
        kind: "content-artifact",
        reference: {
          entityId: input.purposeCode + "-artifact",
          versionId: "sha256:" + digest(String(calls.persist.length)),
        },
      };
    },
  });
  return { step, task, definition, calls };
};

const userPayload = (rendered) => JSON.parse(rendered.messages[1].content);
const invalidAt = (stage) => ({
  name: "AgentRuntimeError",
  details: expect.objectContaining({ code: "AGENT_INPUT_INVALID", stage }),
});
const expectNoDomainWork = (calls) => {
  expect(calls.candidates).toHaveLength(0);
  expect(calls.deviation).toHaveLength(0);
  expect(calls.modelInput).toHaveLength(0);
  expect(calls.persist).toHaveLength(0);
};

describe("deployment response model step", () => {
  it("C27 把真实冻结候选集与授权来源版本传入模型输入", async () => {
    const fixture = setup();
    const rendered = await fixture.step.renderModelStep(fixture.task, fixture.definition);
    expect(rendered.messages[0].role).toBe("system");
    expect(userPayload(rendered)).toEqual({
      frozenInputRef: FROZEN_QUERY_REF,
      candidateSet: candidateSetOf(),
    });
    expect(rendered.outputSchemaRef).toEqual(ref("increment"));
    expect(rendered.maxOutputTokens).toBe(fixture.task.budgetPolicy.maxOutputTokens);
    expect(fixture.calls.candidates[0]).toMatchObject({
      projectId: "project",
      actorId: "operator",
      knowledgeQueryResultRef: FROZEN_QUERY_REF,
    });
    expect(fixture.calls.source[0].authorizationContextRef).toEqual(
      authorization.authorizationContextRef,
    );
    for (const call of fixture.calls.verify) {
      expect(call.requestedSourceVersionRefs).toEqual(SOURCE_VERSIONS);
    }
    expect(fixture.calls.verify.map((call) => call.requiredCapability)).toEqual([
      "agent-task.start",
      MODULE_BRANCH_CAPABILITY_V1["warning-response.read"],
    ]);
    expect(fixture.calls.downstream[0]).toMatchObject({
      branch: "warning-response.read",
      invocationId: fixture.task.envelope.agentTaskRef.reference.entityId + ":model-candidates",
      requestedSourceVersionRefs: SOURCE_VERSIONS,
    });
    expect(fixture.calls.persist).toHaveLength(0);
  });

  it("C29 把真实快照、基准与超限偏差传入模型输入", async () => {
    const fixture = setup({ taskType: CALIBRATION_AGENT_TASK_TYPE_V1 });
    const rendered = await fixture.step.renderModelStep(fixture.task, fixture.definition, {
      previousObservationArtifactRef: { kind: "content-artifact", reference: ref("previous") },
    });
    expect(userPayload(rendered)).toEqual({
      taskRef: fixture.task.envelope.agentTaskRef,
      inputSnapshotRef: INPUT_SNAPSHOT_REF,
      snapshot: inputSnapshotOf(),
      document: baseDocument(),
      fact: deviationFactOf(),
      previousObservationArtifactRef: {
        kind: "content-artifact",
        reference: ref("previous"),
      },
    });
    expect(fixture.calls.deviation[0].deviationFactRef).toEqual(inputSnapshotOf().deviationFactRef);
    expect(fixture.calls.downstream[0]).toMatchObject({
      branch: "warning-response.calculate-deviation",
      requestedSourceVersionRefs: SOURCE_VERSIONS,
    });
    expect(fixture.calls.verify.map((call) => call.requiredCapability)).toEqual([
      "agent-task.start",
      MODULE_BRANCH_CAPABILITY_V1["warning-response.calculate-deviation"],
    ]);
  });

  it.each([
    [
      "候选集工程不符",
      { candidateSet: candidateSetOf({ projectId: "other-project" }) },
      "deployment.response-model.candidates-binding",
    ],
    [
      "候选集空间版本不符",
      { candidateSet: candidateSetOf({ spatialScopeRef: OTHER_SCOPE_VERSION }) },
      "deployment.response-model.candidates-binding",
    ],
    [
      "候选集冻结主体不符",
      { candidateSet: candidateSetOf({ frozenBy: "other-operator" }) },
      "deployment.response-model.candidates-binding",
    ],
    [
      "查询结果引用不符",
      {
        candidateRead: {
          kind: "succeeded",
          knowledgeQueryResultRef: {
            kind: "knowledge-query-result",
            reference: ref("other-query"),
          },
        },
      },
      "deployment.response-model.candidates-binding",
    ],
    [
      "冻结候选读失败",
      { candidateRead: { kind: "failed", error: { code: "MEASURE_CANDIDATES_UNAVAILABLE" } } },
      "deployment.response-model.candidates",
    ],
  ])("拒绝 %s 的 C27 输入", async (_name, options, stage) => {
    const fixture = setup(options);
    await expect(
      fixture.step.renderModelStep(fixture.task, fixture.definition),
    ).rejects.toMatchObject(invalidAt(stage));
    expect(fixture.calls.persist).toHaveLength(0);
  });

  it.each([
    [
      "快照准备主体不符",
      { snapshot: inputSnapshotOf({ preparedBy: "other-operator" }) },
      "deployment.response-model.snapshot-subject",
    ],
    [
      "偏差事实工程不符",
      { fact: deviationFactOf({ projectId: "other-project" }) },
      "deployment.response-model.deviation-binding",
    ],
    [
      "偏差事实未超阈值",
      { fact: deviationFactOf({ thresholdExceeded: false }) },
      "deployment.response-model.deviation-binding",
    ],
    [
      "偏差事实引用不符",
      {
        fact: deviationFactOf({
          deviationFactRef: { kind: "response-deviation-fact", reference: ref("other-fact") },
        }),
      },
      "deployment.response-model.deviation-binding",
    ],
    [
      "冻结评估基准不符",
      {
        fact: deviationFactOf({
          frozenAssessmentBasisRef: {
            kind: "assessment-input-snapshot",
            reference: ref("other-assessment-input"),
          },
        }),
      },
      "deployment.response-model.deviation-binding",
    ],
    [
      "偏差事实空间版本不符",
      { fact: deviationFactOf({ spatialScopeRef: OTHER_SCOPE_VERSION }) },
      "deployment.response-model.deviation-binding",
    ],
    [
      "偏差读失败",
      { deviationRead: { kind: "failed", error: { code: "BUSINESS_BLOCKED" } } },
      "deployment.response-model.deviation-binding",
    ],
  ])("拒绝 %s 的 C29 输入", async (_name, options, stage) => {
    const fixture = setup({ taskType: CALIBRATION_AGENT_TASK_TYPE_V1, ...options });
    await expect(
      fixture.step.renderModelStep(fixture.task, fixture.definition),
    ).rejects.toMatchObject(invalidAt(stage));
    expect(fixture.calls.persist).toHaveLength(0);
  });

  it.each([
    [
      "当前授权已撤权",
      { context: { ...authorization, grantedCapabilities: [] } },
      "deployment.response-model.authorization",
    ],
    ["当前授权已脱敏", { redacted: true }, "deployment.response-model.authorization"],
    [
      "当前授权来源不可读",
      { sourceMissing: true },
      "deployment.response-model.authorization-source",
    ],
    [
      "当前授权来源正文不符",
      {
        source: {
          context: { ...authorization, grantedCapabilities: ["agent-task.start"] },
          sourceVersionRefs: SOURCE_VERSIONS,
        },
      },
      "deployment.response-model.authorization-source",
    ],
  ])("%s 时在任何领域读或持久写之前拒绝", async (_name, options, stage) => {
    for (const taskType of [RECOMMENDATION_TASK_TYPE_V1, CALIBRATION_AGENT_TASK_TYPE_V1]) {
      const fixture = setup({ taskType, ...options });
      await expect(
        fixture.step.renderModelStep(fixture.task, fixture.definition),
      ).rejects.toMatchObject(invalidAt(stage));
      await expect(
        fixture.step.interpretModelStep(
          {
            invocationId: "invocation-1",
            value:
              taskType === RECOMMENDATION_TASK_TYPE_V1
                ? recommendationIncrement()
                : calibrationCandidateOf(fixture.task.envelope.agentTaskRef),
          },
          fixture.task,
          fixture.definition,
        ),
      ).rejects.toMatchObject(invalidAt(stage));
      expectNoDomainWork(fixture.calls);
    }
  });

  it("输入超过冻结字节预算时拒绝且不落工件", async () => {
    const fixture = setup({ budgetOverrides: { maxInputBytes: 512 } });
    await expect(
      fixture.step.renderModelStep(fixture.task, fixture.definition),
    ).rejects.toMatchObject(invalidAt("deployment.response-model.input-budget"));
    expect(fixture.calls.persist).toHaveLength(0);
  });

  it("模型输出保存两个真实候选工件并递增候选版本", async () => {
    const fixture = setup({ latestCandidateVersion: 3 });
    const increment = recommendationIncrement();
    const outcome = await fixture.step.interpretModelStep(
      { invocationId: "invocation-9", value: increment },
      fixture.task,
      fixture.definition,
    );
    expect(fixture.calls.persist.map((call) => call.purposeCode)).toEqual([
      "agent-candidate",
      "agent-increment",
    ]);
    for (const call of fixture.calls.persist) {
      expect(call.actionId).toBe("invocation-9");
      expect(call.value).toEqual(increment);
    }
    expect(outcome).toMatchObject({
      kind: "completed",
      candidatePayload: increment,
      increment,
      candidate: {
        taskRef: fixture.task.envelope.agentTaskRef,
        candidateVersion: 4,
        parentCandidateVersion: 3,
        disposition: "pending",
        candidateArtifactRef: { reference: { entityId: "agent-candidate-artifact" } },
        incrementArtifactRef: { reference: { entityId: "agent-increment-artifact" } },
      },
      usage: { candidates: 1, objects: 1 },
    });
  });

  it("首个 C29 候选从版本 1 开始并沿用真实定义用量", async () => {
    const fixture = setup({ taskType: CALIBRATION_AGENT_TASK_TYPE_V1 });
    const candidate = calibrationCandidateOf(fixture.task.envelope.agentTaskRef);
    const outcome = await fixture.step.interpretModelStep(
      { invocationId: "invocation-1", value: candidate },
      fixture.task,
      fixture.definition,
    );
    expect(outcome.candidate).toMatchObject({ candidateVersion: 1, parentCandidateVersion: 0 });
    expect(outcome.usage).toMatchObject({ candidates: 1, objects: candidate.operations.length });
  });

  it.each([
    ["空选择集", { selections: [] }],
    [
      "模型新增未冻结字段",
      {
        selections: [{ measureId: "measure-a", order: 1 }],
        inventedMeasure: "measure-z",
      },
    ],
  ])("原候选 schema 拒绝 %s 的模型输出", async (_name, invalid) => {
    const fixture = setup();
    await expect(
      fixture.step.interpretModelStep(
        {
          invocationId: "invocation-1",
          value: { schemaVersion: "1", ...invalid },
        },
        fixture.task,
        fixture.definition,
      ),
    ).rejects.toMatchObject(invalidAt("deployment.response-model.candidate-schema"));
    expect(fixture.calls.persist).toHaveLength(0);
  });

  it("C29 候选必须绑定原任务、冻结快照与完成结果引用", async () => {
    for (const overrides of [
      {
        taskRef: {
          ...taskRefFor(CALIBRATION_AGENT_TASK_TYPE_V1, "calibration-suggestion-task"),
          reference: ref("other-task", "2"),
        },
      },
      {
        inputSnapshotRef: { kind: "calibration-input-snapshot", reference: ref("other-snapshot") },
      },
    ]) {
      const fixture = setup({ taskType: CALIBRATION_AGENT_TASK_TYPE_V1 });
      await expect(
        fixture.step.interpretModelStep(
          {
            invocationId: "invocation-1",
            value: calibrationCandidateOf(fixture.task.envelope.agentTaskRef, overrides),
          },
          fixture.task,
          fixture.definition,
        ),
      ).rejects.toMatchObject(invalidAt("deployment.response-model.candidate-binding"));
      expect(fixture.calls.persist).toHaveLength(0);
    }

    const notCompleted = setup({ taskType: CALIBRATION_AGENT_TASK_TYPE_V1 });
    const taskRef = notCompleted.task.envelope.agentTaskRef;
    await expect(
      notCompleted.step.interpretModelStep(
        {
          invocationId: "invocation-1",
          value: calibrationCandidateOf(taskRef, {
            resultRef: buildCompletedAgentTaskResult(
              { ...taskRef, reference: ref("other-task", "2") },
              { kind: "calibration-suggestion", reference: ref("proposed-candidate") },
            ),
          }),
        },
        notCompleted.task,
        notCompleted.definition,
      ),
    ).rejects.toMatchObject(invalidAt("deployment.response-model.candidate-binding"));
    expect(notCompleted.calls.persist).toHaveLength(0);
  });

  it("模型输出超过冻结字节预算时拒绝", async () => {
    const fixture = setup({ budgetOverrides: { maxOutputBytes: 64 } });
    await expect(
      fixture.step.interpretModelStep(
        { invocationId: "invocation-1", value: recommendationIncrement() },
        fixture.task,
        fixture.definition,
      ),
    ).rejects.toMatchObject(invalidAt("deployment.response-model.output-budget"));
    expect(fixture.calls.persist).toHaveLength(0);
  });

  it("依赖缺失时立即失败", () => {
    expect(() =>
      createDeploymentResponseModelStepV1({
        authorizationScope: {
          runTask: async () => undefined,
          authorizeDownstream: async () => undefined,
        },
        access: {
          verifyDeploymentContext: async () => undefined,
          readDeploymentAuthorizationSource: async () => undefined,
        },
        recommendation: {},
        responseLifecycle: { readDeviationFact: async () => undefined },
        calibrationTaskPort: { readModelInput: async () => undefined },
        persistArtifact: async () => undefined,
      }),
    ).toThrow("RESPONSE_MODEL_STEP_DEPENDENCY_MISSING:readMeasureCandidateSet");
  });

  it("不支持的任务类型只交给显式 inner，缺失 inner 则失败", async () => {
    const forwarded = { kind: "waiting" };
    const withInner = setup({
      taskType: "data-cleaning",
      entityId: "cleaning-task",
      inner: { renderModelStep: () => forwarded, interpretModelStep: () => forwarded },
    });
    expect(await withInner.step.renderModelStep(withInner.task, withInner.definition)).toBe(
      forwarded,
    );
    expect(
      await withInner.step.interpretModelStep(
        { invocationId: "invocation-1", value: {} },
        withInner.task,
        withInner.definition,
      ),
    ).toBe(forwarded);
    expectNoDomainWork(withInner.calls);

    const withoutInner = setup({ taskType: "data-cleaning", entityId: "cleaning-task" });
    await expect(
      withoutInner.step.renderModelStep(withoutInner.task, withoutInner.definition),
    ).rejects.toMatchObject(invalidAt("deployment.response-model.unsupported"));
    await expect(
      withoutInner.step.interpretModelStep(
        { invocationId: "invocation-1", value: {} },
        withoutInner.task,
        withoutInner.definition,
      ),
    ).rejects.toMatchObject(invalidAt("deployment.response-model.unsupported"));
  });
});
