import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AgentRuntimeError,
  AgentTaskDefinitionRegistry,
  AgentTaskEnvelopeV1Schema,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentBudgetUsageV1,
  type AgentStructuredErrorV1,
  type AgentTaskActionV1,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import type { ModelGatewayPortV1, StructuredCompletionRequestV1 } from "@riskflow/core/model";
import {
  SCORING_RULE_AUTHORING_TASK_TYPE_V1,
  ScoringRuleActionV1Schema,
  ScoringRuleAuthoringManifestV1Schema,
  ScoringRulesPolicyV1Schema,
  createScoringRuleAuthoringTaskDefinition,
  validateScoringRuleOperations,
  type ScoringRuleAuthoringCandidateV1,
  type ScoringRuleAuthoringManifestV1,
  type ScoringRuleAuthoringTaskPortV1,
  type ScoringRuleIndicatorCatalogSliceRequestV1,
  type ScoringRuleStandardSegmentSliceRequestV1,
  type ScoringRuleValidationViewV1,
  type ScoringRulesPolicyV1,
} from "@riskflow/core/scoring-rules";
import type { AgentTaskRefV1, KnowledgeRevisionRefV1 } from "@riskflow/contracts/ports";
import type { AgentTaskExecutionStoreV1 } from "@riskflow/adapters/agent-runtime";

import { AgentRuntimeRunner } from "../../src/agent-runtime/index.js";
import {
  interpretScoringRuleAuthoringModelStep,
  withScoringRuleAuthoringModelStep,
  type ScoringRuleAuthoringModelStepOptionsV1,
} from "../../src/scoring-rules/runtime.js";

const NOW = "2030-01-01T00:00:01.000Z";
const EPOCH = "2030-01-01T00:00:00.000Z";

const sha256 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const versionRef = (entityId: string, versionId = "1") => ({ entityId, versionId });

const contentArtifactRef = (entityId: string): ArtifactRefV1 => ({
  kind: "content-artifact",
  reference: { entityId, versionId: `sha256:${sha256(entityId)}` },
});

const POLICY_REF = versionRef("policy:scoring-rules", "1");
const SOURCE_VERSION = versionRef("source-version:standard", "1");
const SEGMENT_ID = "std-segment-bearing-capacity";
const RULE_ID = "rule:bearing-capacity";
const INDICATOR_ID = "indicator:bearing-capacity";
const KNOWLEDGE_REVISION_REF: KnowledgeRevisionRefV1 = {
  kind: "knowledge-revision",
  reference: versionRef("knowledge-revision:scoring-rules", "1"),
};

const definitionRef = versionRef("agent-definition:scoring-rule-authoring", "1");
const modelDeploymentRef = versionRef("model-deployment:scoring-rule-authoring", "1");
const promptTemplateRef = versionRef("prompt-template:scoring-rule-authoring", "1");
const toolPolicyRef = versionRef("tool-policy:scoring-rule-authoring", "1");
const budgetPolicyRef = versionRef("budget-policy:scoring-rule-authoring", "1");
const incrementSchemaRef = versionRef("increment-schema:scoring-rule-authoring", "1");
const validationPolicyRef = versionRef("validation-policy:scoring-rule-authoring", "1");

const policy: ScoringRulesPolicyV1 = ScoringRulesPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: POLICY_REF,
  compatibilityRef: versionRef("compatibility:scoring-rules", "1"),
  assemblyPolicyRef: versionRef("assembly-policy:scoring-rules", "1"),
  conflictPriorityPolicyRef: versionRef("conflict-priority-policy:scoring-rules", "1"),
  allowedSourceStandardKinds: ["national-standard"],
  tools: {
    standardSegmentToolRef: versionRef("tool:standard-segment-slice", "1"),
    indicatorCatalogToolRef: versionRef("tool:indicator-catalog-slice", "1"),
    maxSegmentsPerRead: 4,
    maxIndicatorsPerRead: 4,
  },
  agent: {
    definitionRef,
    modelDeploymentRef,
    promptTemplateRef,
    toolPolicyRef,
    budgetPolicyRef,
    incrementSchemaRef,
    validationPolicyRef,
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: budgetPolicyRef,
      modelDeploymentRef,
      promptTemplateRef,
      toolPolicyRef,
      maxModelInvocations: 4,
      maxToolInvocations: 2,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      maxInputBytes: 65_536,
      maxOutputBytes: 65_536,
      maxCandidates: 2,
      maxObjects: 8,
      maxSupplementarySearches: 0,
      maxCorrections: 2,
      maxTransientRetries: 0,
      maxConcurrentActions: 1,
      maxWallClockMs: 60_000,
    },
  },
});

const manifest: ScoringRuleAuthoringManifestV1 = ScoringRuleAuthoringManifestV1Schema.parse({
  schemaVersion: "1",
  projectId: "project-1",
  compatibilityRef: { entityId: "compatibility-c19", versionId: "1" },
  actorId: "actor-1",
  projectRevisionRef: {
    kind: "project-revision",
    reference: versionRef("project-revision:project-1", "1"),
  },
  authorizationContextRef: {
    kind: "authorization-context",
    reference: versionRef("authorization", "1"),
  },
  cleaningResultArtifactRef: contentArtifactRef("cleaning-result"),
  cleaningResultDigest: sha256("cleaning-result"),
  dataCleaningTaskRef: {
    kind: "agent-task",
    reference: versionRef("agent-task:project-1:cleaning", "1"),
    taskType: "data-cleaning",
    triggerMode: "embedded",
    modelDeploymentRef: versionRef("model-deployment:data-cleaning", "1"),
    promptTemplateRef: versionRef("prompt-template:data-cleaning", "1"),
    toolPolicyRef: versionRef("tool-policy:data-cleaning", "1"),
    budgetPolicyRef: versionRef("budget-policy:data-cleaning", "1"),
    incrementSchemaRef: versionRef("increment-schema:data-cleaning", "1"),
    validationPolicyRef: versionRef("validation-policy:data-cleaning", "1"),
  },
  retainedSourceSegments: [
    {
      sourceVersionRef: { kind: "source-version", reference: SOURCE_VERSION },
      sourceSegmentIds: [SEGMENT_ID],
    },
  ],
  sourceStandardKinds: ["national-standard"],
  configurationSetRef: versionRef("configuration-set:project-1", "1"),
  indicatorSystemMember: {
    releaseRef: {
      kind: "knowledge-release",
      reference: versionRef("indicator-system-release", "1"),
    },
    revisionRef: {
      kind: "knowledge-revision",
      reference: versionRef("indicator-system-revision", "1"),
    },
    artifactRef: contentArtifactRef("indicator-system"),
    contentDigest: sha256("indicator-system"),
  },
  scoringPolicyRef: POLICY_REF,
  taskPolicy: {
    modelDeploymentRef,
    promptTemplateRef,
    toolPolicyRef,
    budgetPolicyRef,
    incrementSchemaRef,
    validationPolicyRef,
  },
});

const taskRef: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: versionRef("agent-task:project-1:command-1", "1"),
  taskType: SCORING_RULE_AUTHORING_TASK_TYPE_V1,
  triggerMode: "embedded",
  modelDeploymentRef,
  promptTemplateRef,
  toolPolicyRef,
  budgetPolicyRef,
  incrementSchemaRef,
  validationPolicyRef,
};

const task = {
  envelope: AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: "command-1",
    idempotencyKey: "task-idempotency-1",
    taskType: SCORING_RULE_AUTHORING_TASK_TYPE_V1,
    triggerMode: "embedded",
    projectId: "project-1",
    actorId: "actor-1",
    parentRunRef: { kind: "workflow-run", reference: versionRef("run-1", "1") },
    frozenInputRef: contentArtifactRef("frozen-authoring-manifest"),
    modelDeploymentRef,
    promptTemplateRef,
    toolPolicyRef,
    budgetPolicyRef,
    incrementSchemaRef,
    validationPolicyRef,
    authorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: versionRef("authorization", "1"),
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: versionRef("authorization-policy", "1"),
      decidedAt: EPOCH,
      invocation: { kind: "human" },
    },
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: versionRef("authorization", "1"),
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: versionRef("authorization-policy", "1"),
      capturedAt: EPOCH,
    },
    createdAt: EPOCH,
  }),
  state: {
    schemaVersion: "1",
    agentTaskRef: taskRef,
    status: "running",
    taskVersion: 2,
    cancelRequested: false,
    latestCandidateVersion: 0,
    updatedAt: EPOCH,
  },
  budgetPolicy: policy.agent.budgetPolicy,
  budgetLedger: {
    schemaVersion: "1",
    reserved: emptyAgentBudgetUsage(),
    used: emptyAgentBudgetUsage(),
    activeWallClockMs: 0,
    currentConcurrency: 0,
    ledgerVersion: 1,
    changedAt: EPOCH,
  },
} as unknown as AgentTaskSnapshotV1;

const claim = {
  task,
  attemptNumber: 1,
  workerId: "worker-1",
  leaseToken: "lease-1",
  leaseUntil: "2030-01-01T00:00:30.000Z",
};

const observationRef = contentArtifactRef("observation:standard-segment-slice");

const segmentSliceRequest = {
  kind: "read-standard-segment-slice" as const,
  sourceVersionRef: { kind: "source-version" as const, reference: SOURCE_VERSION },
  sourceSegmentIds: [SEGMENT_ID],
};

const indicatorCatalogSliceRequest = {
  kind: "read-indicator-catalog-slice" as const,
  indicatorIds: [INDICATOR_ID],
};

/** 冻结读上限之外的切片请求：源段数量超过 `maxSegmentsPerRead`。 */
const oversizedSegmentSliceRequest = {
  kind: "read-standard-segment-slice" as const,
  sourceVersionRef: { kind: "source-version" as const, reference: SOURCE_VERSION },
  sourceSegmentIds: Array.from(
    { length: policy.tools.maxSegmentsPerRead + 1 },
    (_value, index) => `${SEGMENT_ID}:${index}`,
  ),
};

const rule = {
  ruleId: RULE_ID,
  applicabilityConditions: {
    constructionMethod: ["open-cut"],
    stratumCondition: ["soft-soil"],
    engineeringStage: ["design"],
  },
  indicatorItem: INDICATOR_ID,
  scoringThresholds: [
    { thresholdId: "threshold-low", operator: "lt" as const, value: 0.5, score: 1 },
    { thresholdId: "threshold-high", operator: "gte" as const, value: 0.5, score: 3 },
  ],
  gradeIntervals: [
    { grade: "low", lowerBound: 0, upperBound: 1 },
    { grade: "medium", lowerBound: 1, upperBound: 2 },
    { grade: "high", lowerBound: 2, upperBound: 3 },
  ],
  exceptionClauses: [],
  evidenceLocator: { sourceSegmentId: SEGMENT_ID },
  ruleVersion: versionRef(RULE_ID, "1"),
  reviewStatus: "pending" as const,
};

/** 证据落在冻结清单保留段之内/之外的两种候选提交。 */
const candidateSubmission = (evidenceSegmentId: string) => ({
  kind: "submit-scoring-rule-candidate" as const,
  candidate: {
    schemaVersion: "1" as const,
    candidateVersion: 1,
    operations: [
      {
        kind: "add-rule" as const,
        ruleId: RULE_ID,
        rule: { ...rule, evidenceLocator: { sourceSegmentId: evidenceSegmentId } },
        sourceVersionRef: { kind: "source-version" as const, reference: SOURCE_VERSION },
        evidenceReferences: [
          { locator: { sourceSegmentId: evidenceSegmentId }, sourceVersion: SOURCE_VERSION },
        ],
      },
    ],
  },
});

const acceptedSubmission = candidateSubmission(SEGMENT_ID);
const outOfManifestSubmission = candidateSubmission("std-segment-outside-manifest");

interface FailureRecordV1 {
  readonly code: string;
  readonly reasonCode: string | undefined;
  readonly evidenceRef: ArtifactRefV1 | undefined;
}

interface CandidateRecordV1 {
  readonly disposition: string;
  readonly rejectionClass: string | undefined;
}

const makeStore = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const actionFailures: FailureRecordV1[] = [];
  const taskFailures: FailureRecordV1[] = [];
  const candidates: CandidateRecordV1[] = [];
  let claimed = false;
  const store = {
    calls,
    actionFailures,
    taskFailures,
    candidates,
    async claim() {
      if (claimed) return undefined;
      claimed = true;
      return claim;
    },
    async verifyWorker() {
      calls.push("verify");
    },
    async findAction() {
      return undefined;
    },
    async reserveAction(input: {
      readonly actionId: string;
      readonly reservationId: string;
      readonly actionType: AgentTaskActionV1["actionType"];
      readonly amount?: Partial<AgentBudgetUsageV1>;
    }) {
      calls.push("reserve");
      const amount = { ...emptyAgentBudgetUsage(), ...input.amount };
      if (input.actionType === "model-invocation") amount.modelInvocations = 1;
      if (input.actionType === "domain-tool") amount.toolInvocations = 1;
      return {
        task,
        reservation: {
          schemaVersion: "1" as const,
          reservationId: input.reservationId,
          actionId: input.actionId,
          amount,
          concurrency: 1,
          reservedAt: EPOCH,
        },
      };
    },
    async heartbeat() {
      calls.push("heartbeat");
      return "2030-01-01T00:00:30.000Z";
    },
    async recordCandidate(input: {
      readonly candidate: { readonly disposition: string; readonly rejectionClass?: string };
    }) {
      calls.push("candidate");
      candidates.push({
        disposition: input.candidate.disposition,
        rejectionClass: input.candidate.rejectionClass,
      });
    },
    async completeAction() {
      calls.push("complete-action");
      return task;
    },
    async completeTask() {
      calls.push("complete-task");
      return task;
    },
    async failAction(input: {
      readonly error: AgentStructuredErrorV1;
      readonly resultArtifactRef?: ArtifactRefV1;
    }) {
      calls.push("fail");
      actionFailures.push({
        code: input.error.code,
        reasonCode: input.error.reasonCode,
        evidenceRef: input.resultArtifactRef,
      });
      return task;
    },
    async releaseLease() {
      calls.push("release");
    },
    async failTask(input: { readonly error: AgentStructuredErrorV1 }) {
      calls.push("fail-task");
      taskFailures.push({
        code: input.error.code,
        reasonCode: input.error.reasonCode,
        evidenceRef: undefined,
      });
      return task;
    },
    ...overrides,
  } as unknown as AgentTaskExecutionStoreV1 & {
    calls: string[];
    actionFailures: FailureRecordV1[];
    taskFailures: FailureRecordV1[];
    candidates: CandidateRecordV1[];
  };
  return store;
};

interface PortCallsV1 {
  readonly standardSlices: ScoringRuleStandardSegmentSliceRequestV1[];
  readonly indicatorSlices: ScoringRuleIndicatorCatalogSliceRequestV1[];
  readonly validations: ScoringRuleValidationViewV1[];
  readonly finalizations: ScoringRuleAuthoringCandidateV1[];
}

/** 端口里的校验复用 C19 真实判定器，从而覆盖清单范围与证据保留语义。 */
const makePort = () => {
  const calls: PortCallsV1 = {
    standardSlices: [],
    indicatorSlices: [],
    validations: [],
    finalizations: [],
  };
  const port = {
    calls,
    async loadAuthoringManifest() {
      return {
        manifest,
        manifestArtifactRef: contentArtifactRef("frozen-authoring-manifest"),
        manifestDigest: sha256("frozen-authoring-manifest"),
      };
    },
    async readStandardSegmentSlice(input: ScoringRuleStandardSegmentSliceRequestV1) {
      calls.standardSlices.push(input);
      return { observationArtifactRef: observationRef, effect: "none" as const };
    },
    async readIndicatorCatalogSlice(input: ScoringRuleIndicatorCatalogSliceRequestV1) {
      calls.indicatorSlices.push(input);
      return { observationArtifactRef: observationRef, effect: "none" as const };
    },
    async validateAuthoringCandidate(input: {
      readonly candidate: ScoringRuleAuthoringCandidateV1;
    }) {
      const outcome = validateScoringRuleOperations({
        manifest,
        policy,
        agentTaskRef: taskRef,
        candidate: input.candidate,
        indicatorIds: [INDICATOR_ID],
        configurationSetRef: manifest.configurationSetRef,
        compatibilityRef: policy.compatibilityRef,
      });
      calls.validations.push(outcome.validation);
      return {
        validation: outcome.validation,
        validationArtifactRef: contentArtifactRef(`validation:${calls.validations.length}`),
      };
    },
    async finalizeAuthoringCandidate(input: {
      readonly candidate: ScoringRuleAuthoringCandidateV1;
    }) {
      calls.finalizations.push(input.candidate);
      return buildCompletedAgentTaskResult(taskRef, KNOWLEDGE_REVISION_REF);
    },
  } as unknown as ScoringRuleAuthoringTaskPortV1 & { calls: PortCallsV1 };
  return port;
};

const makeGateway = (...values: readonly unknown[]) => {
  let index = 0;
  const completeStructured = vi.fn(async (request: StructuredCompletionRequestV1) => {
    if (index >= values.length) throw new Error("model gateway script exhausted");
    const value = values[index];
    index += 1;
    if (value instanceof Error) throw value;
    return {
      schemaVersion: "1" as const,
      invocationId: request.invocationId,
      modelDeploymentRef: request.modelDeploymentRef,
      serverBuildRef: versionRef("server-build", "1"),
      modelVersionRef: versionRef("model-version", "1"),
      usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      rawResponseRef: {
        kind: "diagnostic-artifact" as const,
        reference: versionRef("raw-model-response", "1"),
      },
      promptTemplateRef: request.promptTemplateRef,
      outputSchemaRef: request.outputSchemaRef,
      value,
      finishReason: "stop" as const,
    };
  });
  return { completeStructured, port: { completeStructured } as unknown as ModelGatewayPortV1 };
};

type RenderedStepV1 = {
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly maxOutputTokens: number;
  readonly domainTool?: unknown;
};

const setup = (options: {
  readonly script: readonly unknown[];
  readonly definition?: AgentTaskDefinitionV1;
  readonly storeOverrides?: Record<string, unknown>;
}) => {
  const store = makeStore(options.storeOverrides);
  const port = makePort();
  const persisted: Array<{
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }> = [];
  const persistArtifact = vi.fn(
    async (input: {
      readonly task: AgentTaskSnapshotV1;
      readonly actionId: string;
      readonly purposeCode: string;
      readonly value: unknown;
    }) => {
      persisted.push(input);
      return contentArtifactRef(`${input.actionId}:${input.purposeCode}`);
    },
  );
  const definition =
    options.definition ?? createScoringRuleAuthoringTaskDefinition({ policy, port });
  const modelStep = withScoringRuleAuthoringModelStep({ policy, persistArtifact, now: () => NOW });
  const renderModelStep = vi.fn(modelStep.renderModelStep);
  const gateway = makeGateway(...options.script);
  const runner = new AgentRuntimeRunner({
    store,
    registry: new AgentTaskDefinitionRegistry([definition]),
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    maxConcurrentTasks: 1,
    modelGateway: gateway.port,
    renderModelStep,
    interpretModelStep: modelStep.interpretModelStep,
    persistArtifact,
    now: () => NOW,
  });
  return { store, port, persisted, persistArtifact, renderModelStep, gateway, definition, runner };
};

describe("structured scoring rule authoring model step", () => {
  it("routes a bounded standard read to the frozen tool and finalizes the validated candidate", async () => {
    const { store, port, persisted, renderModelStep, runner } = setup({
      script: [segmentSliceRequest, acceptedSubmission],
    });

    expect(await runner.runOnce()).toBe(1);

    // 只读切片按冻结工具引用路由，观察工件在下一轮渲染中回填。
    expect(port.calls.standardSlices).toEqual([segmentSliceRequest]);
    expect(port.calls.indicatorSlices).toEqual([]);
    const toolIntent = persisted.find(
      (entry) =>
        entry.purposeCode === "agent-action-intent" &&
        (entry.value as { readonly actionType?: string }).actionType === "domain-tool",
    );
    expect((toolIntent?.value as { readonly toolRef?: unknown } | undefined)?.toolRef).toEqual(
      policy.tools.standardSegmentToolRef,
    );
    expect(renderModelStep.mock.calls[0]?.[2]).toEqual({});
    expect(renderModelStep.mock.calls[1]?.[2]).toEqual({
      previousObservationArtifactRef: observationRef,
    });

    // 渲染请求只携带冻结引用与策略预算，不设置领域工具。
    const firstStep = renderModelStep.mock.results[0]?.value as RenderedStepV1 | undefined;
    expect(firstStep?.maxOutputTokens).toBe(policy.agent.budgetPolicy.maxOutputTokens);
    expect(firstStep?.domainTool).toBeUndefined();
    expect(JSON.parse(firstStep?.messages[1]?.content ?? "")).toEqual({
      frozenAuthoringManifestArtifactRef: task.envelope.frozenInputRef,
    });

    // 候选提交走完真实校验与收口，任务以 C16 修订结果完成。
    expect(port.calls.validations).toHaveLength(1);
    expect(port.calls.validations[0]?.disposition).toBe("accepted");
    expect(port.calls.finalizations).toEqual([acceptedSubmission.candidate]);
    expect(store.calls).not.toContain("fail");
    expect(store.calls).not.toContain("fail-task");
    expect(store.calls.filter((call) => call === "complete-action")).toHaveLength(3);
    expect(store.calls).toContain("complete-task");
    expect(store.candidates).toEqual([{ disposition: "completed", rejectionClass: undefined }]);

    // 候选与增量各自落一份 JSON 工件，供 C08 复验。
    const candidateArtifacts = persisted.filter(
      (entry) => entry.purposeCode === "agent-candidate" || entry.purposeCode === "agent-increment",
    );
    expect([...candidateArtifacts.map((entry) => entry.purposeCode)].sort()).toEqual([
      "agent-candidate",
      "agent-increment",
    ]);
    expect(
      candidateArtifacts.map(
        (entry) => (entry.value as { readonly operations: readonly unknown[] }).operations.length,
      ),
    ).toEqual([1, 1]);
  });

  it("rejects a candidate whose evidence falls outside the frozen manifest and never finalizes", async () => {
    const { store, port, runner } = setup({ script: [outOfManifestSubmission] });

    expect(await runner.runOnce()).toBe(1);

    expect(port.calls.validations[0]?.disposition).toBe("rejected");
    // 证据超出冻结清单保留段属可修复拒绝：可在原预算内更正，但本轮不得收口。
    expect(port.calls.validations[0]?.rejectionClass).toBe("repairable");
    expect(port.calls.finalizations).toEqual([]);
    expect(store.candidates).toEqual([{ disposition: "rejected", rejectionClass: "repairable" }]);
    expect(store.actionFailures).toEqual([
      {
        code: "AGENT_VALIDATION_REJECTED",
        reasonCode: "scoring-rule-evidence-unverified",
        evidenceRef: expect.any(Object),
      },
    ]);
    expect(store.calls).not.toContain("complete-task");
    expect(store.calls).toContain("release");
  });

  it("rejects an oversized read before the frozen tool is invoked", async () => {
    const { store, port, persisted, runner } = setup({ script: [oversizedSegmentSliceRequest] });

    expect(await runner.runOnce()).toBe(1);

    expect(port.calls.standardSlices).toEqual([]);
    // 请求本身通过动作 schema，拒绝只来自冻结读上限（清单范围），不是形状错误。
    expect(ScoringRuleActionV1Schema.safeParse(oversizedSegmentSliceRequest).success).toBe(true);
    // 切片在模型步就被拒：动作未落结果工件，仍保留动作意图工件供复验。
    expect(store.actionFailures).toEqual([
      { code: "AGENT_INPUT_INVALID", reasonCode: undefined, evidenceRef: undefined },
    ]);
    expect(store.calls).not.toContain("complete-task");
    expect(persisted.filter((entry) => entry.purposeCode === "agent-action-intent")).toHaveLength(
      1,
    );
  });

  it("rejects a tool outside the definition tool whitelist without executing it", async () => {
    const full = createScoringRuleAuthoringTaskDefinition({ policy, port: makePort() });
    const narrowed: AgentTaskDefinitionV1 = {
      ...full,
      metadata: {
        ...full.metadata,
        allowedToolRefs: [policy.tools.indicatorCatalogToolRef],
      },
      tools: full.tools.filter(
        (tool) =>
          tool.toolRef.entityId === policy.tools.indicatorCatalogToolRef.entityId &&
          tool.toolRef.versionId === policy.tools.indicatorCatalogToolRef.versionId,
      ),
    };
    const { store, port, persisted, runner } = setup({
      script: [segmentSliceRequest],
      definition: narrowed,
    });

    expect(await runner.runOnce()).toBe(1);

    expect(port.calls.standardSlices).toEqual([]);
    expect(port.calls.indicatorSlices).toEqual([]);
    expect(store.actionFailures).toEqual([
      { code: "AGENT_TOOL_NOT_ALLOWED", reasonCode: undefined, evidenceRef: undefined },
    ]);
    expect(store.calls).not.toContain("complete-task");
    expect(persisted.some((entry) => entry.purposeCode === "agent-action-intent")).toBe(true);
  });

  it("records a model failure instead of completing with a fallback result", async () => {
    const { store, port, persisted, gateway, runner } = setup({
      script: [new Error("gateway down")],
    });

    expect(await runner.runOnce()).toBe(1);

    expect(gateway.completeStructured).toHaveBeenCalledTimes(1);
    expect(store.actionFailures).toEqual([
      { code: "AGENT_MODEL_FAILURE", reasonCode: undefined, evidenceRef: undefined },
    ]);
    expect(store.calls).not.toContain("complete-task");
    expect(port.calls.finalizations).toEqual([]);
    expect(persisted.filter((entry) => entry.purposeCode === "agent-action-intent")).toHaveLength(
      1,
    );
  });

  it("fails the task terminally when the budget cannot be reserved", async () => {
    const { store, runner } = setup({
      script: [segmentSliceRequest],
      storeOverrides: {
        async reserveAction() {
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_BUDGET_EXHAUSTED",
              category: "budget",
              retryable: false,
              stage: "test.budget",
              taskRef,
            }),
          );
        },
      },
    });

    expect(await runner.runOnce()).toBe(1);

    expect(store.taskFailures).toEqual([
      { code: "AGENT_BUDGET_EXHAUSTED", reasonCode: undefined, evidenceRef: undefined },
    ]);
    expect(store.actionFailures).toEqual([]);
    expect(store.calls).not.toContain("complete-task");
  });
});

describe("structured scoring rule authoring model step routing", () => {
  const persistArtifact = vi.fn(async () => observationRef);
  const options: ScoringRuleAuthoringModelStepOptionsV1 = { policy, persistArtifact };
  const definition = createScoringRuleAuthoringTaskDefinition({ policy, port: makePort() });

  const foreignTask = {
    ...task,
    envelope: {
      ...task.envelope,
      agentTaskRef: { ...taskRef, taskType: "data-cleaning" },
    },
  } as unknown as AgentTaskSnapshotV1;
  const mismatchedDefinition: AgentTaskDefinitionV1 = {
    ...definition,
    metadata: {
      ...definition.metadata,
      definitionRef: versionRef("agent-definition:elsewhere", "1"),
    },
  };

  const modelResponse = (value: unknown) => ({
    schemaVersion: "1" as const,
    invocationId: "agent-task:project-1:command-1:action:3",
    modelDeploymentRef,
    serverBuildRef: versionRef("server-build", "1"),
    modelVersionRef: versionRef("model-version", "1"),
    usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    rawResponseRef: {
      kind: "diagnostic-artifact" as const,
      reference: versionRef("raw-model-response", "1"),
    },
    promptTemplateRef,
    outputSchemaRef: incrementSchemaRef,
    value,
    finishReason: "stop" as const,
  });

  const capture = async (run: () => unknown): Promise<unknown> => {
    try {
      return await run();
    } catch (error) {
      return error;
    }
  };

  it("maps read actions to the frozen tool references and rejects unparseable actions", async () => {
    await expect(
      interpretScoringRuleAuthoringModelStep(options, modelResponse(segmentSliceRequest), task),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: policy.tools.standardSegmentToolRef,
      toolInput: segmentSliceRequest,
    });
    await expect(
      interpretScoringRuleAuthoringModelStep(
        options,
        modelResponse(indicatorCatalogSliceRequest),
        task,
      ),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: policy.tools.indicatorCatalogToolRef,
      toolInput: indicatorCatalogSliceRequest,
    });
    await expect(
      interpretScoringRuleAuthoringModelStep(
        options,
        modelResponse({ kind: "unexpected-action" }),
        task,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    expect(persistArtifact).not.toHaveBeenCalled();
  });

  it("delegates non-C19 tasks and foreign definitions to the inner model step", async () => {
    const innerStep = {
      messages: [{ role: "user" as const, content: "inner" }],
      maxOutputTokens: 1,
    };
    const inner = {
      renderModelStep: vi.fn(() => innerStep),
      interpretModelStep: vi.fn(() => ({ kind: "failed" as const })),
    };
    const delegated = withScoringRuleAuthoringModelStep({ ...options, inner });
    expect(delegated.renderModelStep(foreignTask, definition)).toEqual(innerStep);
    expect(inner.renderModelStep).toHaveBeenCalledWith(foreignTask, definition, undefined);
    expect(delegated.renderModelStep(task, mismatchedDefinition)).toEqual(innerStep);
    expect(await delegated.interpretModelStep(modelResponse({}), foreignTask, definition)).toEqual({
      kind: "failed",
    });
  });

  it("propagates inner errors untouched and fails closed without an inner fallback", async () => {
    const innerError = new AgentRuntimeError(
      makeAgentError({
        code: "AGENT_POLICY_NOT_FOUND",
        category: "policy",
        stage: "test.inner",
        taskRef,
      }),
    );
    const inner = {
      renderModelStep: vi.fn(() => {
        throw innerError;
      }),
      interpretModelStep: vi.fn(() => {
        throw innerError;
      }),
    };
    const delegated = withScoringRuleAuthoringModelStep({ ...options, inner });
    expect(await capture(() => delegated.renderModelStep(foreignTask, definition))).toBe(
      innerError,
    );
    expect(
      await capture(() => delegated.interpretModelStep(modelResponse({}), foreignTask, definition)),
    ).toBe(innerError);

    const withoutInner = withScoringRuleAuthoringModelStep(options);
    for (const error of [
      await capture(() => withoutInner.renderModelStep(foreignTask, definition)),
      await capture(() =>
        withoutInner.interpretModelStep(modelResponse({}), foreignTask, definition),
      ),
    ]) {
      expect(error).toBeInstanceOf(AgentRuntimeError);
      expect((error as AgentRuntimeError).details.code).toBe("AGENT_INPUT_INVALID");
    }
  });
});
