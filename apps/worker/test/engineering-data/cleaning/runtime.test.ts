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
  type AgentDomainToolResultV1,
  type AgentStructuredErrorV1,
  type AgentTaskActionV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { AgentTaskRefV1 } from "@riskflow/contracts/ports";
import {
  DATA_CLEANING_TASK_TYPE,
  DataCleaningFrozenInputV1Schema,
  DataCleaningPolicyV1Schema,
  createDataCleaningTaskDefinition,
  type DataCleaningCandidateV1,
  type DataCleaningDocumentSliceRequestV1,
  type DataCleaningMonitoringSliceRequestV1,
  type DataCleaningPolicyV1,
  type DataCleaningPreparationCatalogSliceRequestV1,
  type DataCleaningSettlementV1,
  type DataCleaningTaskPortV1,
  type DataCleaningValidationViewV1,
} from "@riskflow/core/engineering-data/cleaning";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import type { ModelGatewayPortV1, StructuredCompletionRequestV1 } from "@riskflow/core/model";
import type { AgentTaskExecutionStoreV1 } from "@riskflow/adapters/agent-runtime";

import { AgentRuntimeRunner } from "../../../src/agent-runtime/index.js";
import {
  interpretDataCleaningModelStep,
  renderDataCleaningModelStep,
  withDataCleaningModelStep,
  type DataCleaningModelStepOptionsV1,
} from "../../../src/engineering-data/cleaning/index.js";

const NOW = "2030-01-01T00:00:01.000Z";
const EPOCH = "2030-01-01T00:00:00.000Z";

const sha256 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const versionRef = (entityId: string, versionId = "1") => ({ entityId, versionId });

const artifactRef = (entityId: string): ArtifactRefV1 => ({
  kind: "content-artifact",
  reference: { entityId, versionId: `sha256:${sha256(entityId)}` },
});

const POLICY_REF = versionRef("policy:data-cleaning", "1");

const policy: DataCleaningPolicyV1 = DataCleaningPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: POLICY_REF,
  allowedConversionPolicyRefs: [versionRef("conversion-policy", "1")],
  allowedQualityPolicyRefs: [versionRef("quality-policy", "1")],
  allowedConverterDeploymentRefs: [versionRef("converter-deployment", "1")],
  allowedExclusionReasonCodes: ["not-applicable"],
  protectedSegmentKinds: ["chapter"],
  requiredSegmentKinds: ["chapter"],
  protectedMonitoringSelectionReasons: ["latest-valid"],
  minimumRetainedSegmentRatio: 0.5,
  minimumRetainedSampleRatio: 0.5,
  minimumDocumentCoverageRatio: 0.5,
  tools: {
    documentSegmentToolRef: versionRef("tool:document-segment-slice", "1"),
    monitoringSnapshotToolRef: versionRef("tool:monitoring-snapshot-slice", "1"),
    maxSegmentsPerRead: 8,
    maxMonitoringItemsPerRead: 8,
  },
  agent: {
    definitionRef: versionRef("agent-definition:data-cleaning", "1"),
    modelDeploymentRef: versionRef("model-deployment:data-cleaning", "1"),
    promptTemplateRef: versionRef("prompt-template:data-cleaning", "1"),
    toolPolicyRef: versionRef("tool-policy:data-cleaning", "1"),
    budgetPolicyRef: versionRef("budget-policy:data-cleaning", "1"),
    incrementSchemaRef: versionRef("increment-schema:data-cleaning", "1"),
    validationPolicyRef: versionRef("validation-policy:data-cleaning", "1"),
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: versionRef("budget-policy:data-cleaning", "1"),
      modelDeploymentRef: versionRef("model-deployment:data-cleaning", "1"),
      promptTemplateRef: versionRef("prompt-template:data-cleaning", "1"),
      toolPolicyRef: versionRef("tool-policy:data-cleaning", "1"),
      maxModelInvocations: 4,
      maxToolInvocations: 2,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      maxInputBytes: 65_536,
      maxOutputBytes: 65_536,
      maxCandidates: 2,
      maxObjects: 8,
      maxSupplementarySearches: 0,
      maxCorrections: 0,
      maxTransientRetries: 0,
      maxConcurrentActions: 1,
      maxWallClockMs: 60_000,
    },
  },
});

const taskRef: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: versionRef("agent-task:project-1:command-1", "1"),
  taskType: DATA_CLEANING_TASK_TYPE,
  triggerMode: "embedded",
  modelDeploymentRef: policy.agent.modelDeploymentRef,
  promptTemplateRef: policy.agent.promptTemplateRef,
  toolPolicyRef: policy.agent.toolPolicyRef,
  budgetPolicyRef: policy.agent.budgetPolicyRef,
  incrementSchemaRef: policy.agent.incrementSchemaRef,
  validationPolicyRef: policy.agent.validationPolicyRef,
};

const SOURCE_VERSION = versionRef("source-version:manual", "1");
const CHAPTER_SEGMENT_ID = "manual-chapter-overview";
const TABLE_SEGMENT_ID = "manual-table-annex";

const frozenInput = DataCleaningFrozenInputV1Schema.parse({
  schemaVersion: "1",
  // 冻结清单工件引用由任务信封的 frozenInputRef 派生，二者必须一致。
  manifestArtifactRef: artifactRef("frozen-input"),
  manifestDigest: sha256("frozen-manifest"),
  agentTaskRef: taskRef,
  policyRef: POLICY_REF,
  documents: [
    {
      sourceVersionRef: { kind: "source-version", reference: SOURCE_VERSION },
      conversionRef: {
        kind: "structured-document-conversion",
        reference: versionRef("conversion:manual", "1"),
      },
      jsonLdArtifactRef: artifactRef("json-ld:manual"),
      sourceSegmentSetRef: {
        kind: "source-segment-set",
        reference: versionRef("segment-set:manual", "1"),
      },
      inputKind: "docx",
      jsonLdFingerprint: sha256("json-ld:manual"),
      segments: [
        {
          sourceSegmentId: CHAPTER_SEGMENT_ID,
          kind: "chapter",
          locator: { kind: "document", pageNumber: 1, headingPath: ["overview"] },
          textBlockIds: ["block-overview"],
          parsedFingerprint: sha256("segment:overview"),
        },
        {
          sourceSegmentId: TABLE_SEGMENT_ID,
          kind: "table",
          locator: { kind: "document", pageNumber: 2, headingPath: ["annex"] },
          textBlockIds: ["block-annex"],
          parsedFingerprint: sha256("segment:annex"),
        },
      ],
    },
  ],
});

const task = {
  envelope: AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: "command-1",
    idempotencyKey: "task-idempotency-1",
    taskType: DATA_CLEANING_TASK_TYPE,
    triggerMode: "embedded",
    projectId: "project-1",
    actorId: "actor-1",
    parentRunRef: { kind: "workflow-run", reference: versionRef("run-1", "1") },
    frozenInputRef: artifactRef("frozen-input"),
    modelDeploymentRef: taskRef.modelDeploymentRef,
    promptTemplateRef: taskRef.promptTemplateRef,
    toolPolicyRef: taskRef.toolPolicyRef,
    budgetPolicyRef: taskRef.budgetPolicyRef,
    incrementSchemaRef: taskRef.incrementSchemaRef,
    validationPolicyRef: taskRef.validationPolicyRef,
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

const observationRef = artifactRef("observation:document-slice");

/** 受权 reader 返回的上一轮观察内容；模型消息只接受它，不接受清单正文。 */
const observationContent = {
  schemaVersion: "1",
  manifestArtifactRef: frozenInput.manifestArtifactRef,
  sourceVersionRef: { kind: "source-version", reference: SOURCE_VERSION },
  inputKind: "docx",
  segments: [{ sourceSegmentId: TABLE_SEGMENT_ID, kind: "table" }],
};

/** 模型形态：只回抄任务内短选项。 */
const documentSliceRequest = {
  kind: "read-document-segment-slice",
  sourceOption: 1,
  sourceSegmentIds: [TABLE_SEGMENT_ID],
};

/** 内部工具形态：宿主解析出的冻结精确引用，历史已登记动作同样使用该形态。 */
const documentSliceToolInput = {
  kind: "read-document-segment-slice",
  sourceVersionRef: { kind: "source-version", reference: SOURCE_VERSION },
  sourceSegmentIds: [TABLE_SEGMENT_ID],
};

const monitoringSliceRequest = {
  kind: "read-monitoring-snapshot-slice",
  monitoringSnapshotRef: {
    kind: "monitoring-snapshot",
    reference: versionRef("monitoring-snapshot", "1"),
  },
  sampleVersionRefs: [
    { kind: "monitoring-sample-version", reference: versionRef("sample:1", "1") },
  ],
};

const observations = [
  { observationCode: "segment-not-applicable", summaryText: "Segment is not applicable." },
];

const tableCandidateSubmission = {
  kind: "submit-cleaning-candidate" as const,
  candidate: {
    schemaVersion: "1" as const,
    candidateVersion: 1,
    observations,
    exclusions: [
      {
        targetKind: "document-segment" as const,
        sourceVersionRef: { kind: "source-version" as const, reference: SOURCE_VERSION },
        sourceSegmentId: TABLE_SEGMENT_ID,
        reasonCode: "not-applicable",
        evidenceReferences: [
          { locator: { sourceSegmentId: TABLE_SEGMENT_ID }, sourceVersion: SOURCE_VERSION },
        ],
      },
    ],
  },
};

const protectedCandidateSubmission = {
  kind: "submit-cleaning-candidate" as const,
  candidate: {
    schemaVersion: "1" as const,
    candidateVersion: 1,
    observations,
    exclusions: [
      {
        targetKind: "document-segment" as const,
        sourceVersionRef: { kind: "source-version" as const, reference: SOURCE_VERSION },
        sourceSegmentId: CHAPTER_SEGMENT_ID,
        reasonCode: "not-applicable",
        evidenceReferences: [
          { locator: { sourceSegmentId: CHAPTER_SEGMENT_ID }, sourceVersion: SOURCE_VERSION },
        ],
      },
    ],
  },
};

interface FailureRecordV1 {
  readonly code: string;
  readonly reasonCode: string | undefined;
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
    async failAction(input: { readonly error: AgentStructuredErrorV1 }) {
      calls.push("fail");
      actionFailures.push({ code: input.error.code, reasonCode: input.error.reasonCode });
      return task;
    },
    async releaseLease() {
      calls.push("release");
    },
    async failTask(input: { readonly error: AgentStructuredErrorV1 }) {
      calls.push("fail-task");
      taskFailures.push({ code: input.error.code, reasonCode: input.error.reasonCode });
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
  readonly documentSlices: DataCleaningDocumentSliceRequestV1[];
  readonly monitoringSlices: DataCleaningMonitoringSliceRequestV1[];
  readonly catalogSlices: DataCleaningPreparationCatalogSliceRequestV1[];
  readonly validations: DataCleaningValidationViewV1[];
  readonly settlements: DataCleaningSettlementV1[];
}

const makePort = (documentSlice?: AgentDomainToolResultV1) => {
  const calls: PortCallsV1 = {
    documentSlices: [],
    monitoringSlices: [],
    catalogSlices: [],
    validations: [],
    settlements: [],
  };
  const port = {
    calls,
    async loadFrozenInput() {
      return frozenInput;
    },
    async persistValidationArtifact(input: {
      readonly candidate: DataCleaningCandidateV1;
      readonly validation: DataCleaningValidationViewV1;
      readonly settlement: DataCleaningSettlementV1;
    }) {
      calls.validations.push(input.validation);
      calls.settlements.push(input.settlement);
      return artifactRef(`validation:${calls.validations.length}`);
    },
    async persistCleaningResult(input: { readonly settlement: DataCleaningSettlementV1 }) {
      calls.settlements.push(input.settlement);
      return buildCompletedAgentTaskResult(taskRef, artifactRef("cleaned-output"));
    },
    async readDocumentSlice(input: DataCleaningDocumentSliceRequestV1) {
      calls.documentSlices.push(input);
      return documentSlice ?? { observationArtifactRef: observationRef, effect: "none" as const };
    },
    async readMonitoringSlice(input: DataCleaningMonitoringSliceRequestV1) {
      calls.monitoringSlices.push(input);
      return { observationArtifactRef: observationRef, effect: "none" as const };
    },
    async readPreparationCatalogSlice(input: DataCleaningPreparationCatalogSliceRequestV1) {
      calls.catalogSlices.push(input);
      return { observationArtifactRef: observationRef, effect: "none" as const };
    },
  } as unknown as DataCleaningTaskPortV1 & { calls: PortCallsV1 };
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
  readonly documentSlice?: AgentDomainToolResultV1;
  readonly storeOverrides?: Record<string, unknown>;
  readonly policy?: DataCleaningPolicyV1;
}) => {
  const activePolicy = options.policy ?? policy;
  const store = makeStore(options.storeOverrides);
  const port = makePort(options.documentSlice);
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
      return artifactRef(`${input.actionId}:${input.purposeCode}`);
    },
  );
  const readObservation = vi.fn(async () => observationContent);
  const definition = createDataCleaningTaskDefinition({ policy: activePolicy, port });
  const modelStep = withDataCleaningModelStep({
    policy: activePolicy,
    persistArtifact,
    loadFrozenInput: async () => frozenInput,
    readObservation,
    now: () => NOW,
  });
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
  return {
    store,
    port,
    persisted,
    persistArtifact,
    readObservation,
    renderModelStep,
    gateway,
    definition,
    runner,
  };
};

describe("data cleaning model step", () => {
  it("routes a read request to the frozen tool and feeds the observation back before finalizing", async () => {
    const { store, port, persisted, readObservation, renderModelStep, runner } = setup({
      script: [documentSliceRequest, tableCandidateSubmission],
    });

    expect(await runner.runOnce()).toBe(1);

    // 模型短选项由宿主解析为冻结工具精确输入，观察工件在下一轮渲染中回填。
    expect(port.calls.documentSlices).toEqual([documentSliceToolInput]);
    expect(port.calls.monitoringSlices).toEqual([]);
    const toolIntent = persisted.find(
      (entry) =>
        entry.purposeCode === "agent-action-intent" &&
        (entry.value as { readonly actionType?: string }).actionType === "domain-tool",
    );
    expect((toolIntent?.value as { readonly toolRef?: unknown } | undefined)?.toolRef).toEqual(
      policy.tools.documentSegmentToolRef,
    );
    expect(renderModelStep.mock.calls[0]?.[2]).toEqual({});
    expect(renderModelStep.mock.calls[1]?.[2]).toMatchObject({
      previousObservationArtifactRef: observationRef,
    });
    // 上一轮观察内容只经受权 reader 进入消息，模型据此继续决策。
    expect(readObservation).toHaveBeenCalledWith(task, observationRef);
    const secondStep = (await renderModelStep.mock.results[1]?.value) as RenderedStepV1 | undefined;
    expect(JSON.parse(secondStep?.messages[1]?.content ?? "")).toMatchObject({
      previousObservationArtifactRef: observationRef,
      previousObservation: observationContent,
    });

    // 渲染请求携带冻结准备的真实定位与策略预算，不设置领域工具、不含清单正文。
    const firstStep = (await renderModelStep.mock.results[0]?.value) as RenderedStepV1 | undefined;
    expect(firstStep?.maxOutputTokens).toBe(policy.agent.budgetPolicy.maxOutputTokens);
    expect(firstStep?.domainTool).toBeUndefined();
    expect(firstStep?.messages).toHaveLength(2);
    const listed = JSON.parse(firstStep?.messages[1]?.content ?? "") as {
      readonly frozenManifestArtifactRef: unknown;
      readonly documents: readonly {
        readonly sourceVersionRef: unknown;
        readonly inputKind: string;
        readonly segmentIdPrefix: string;
        readonly segmentIdSuffixesByKind: Readonly<Record<string, readonly string[]>>;
      }[];
      readonly previousObservation?: unknown;
    };
    expect(listed).toMatchObject({
      frozenManifestArtifactRef: task.envelope.frozenInputRef,
      // 清单只给短选项，模型据此选择资料，不接触资料版本引用。
      documents: [{ sourceOption: 1, inputKind: "docx" }],
    });
    // 清单不再出现资料版本长标识，模型不改写内部精确来源。
    expect(firstStep?.messages[1]?.content ?? "").not.toContain(SOURCE_VERSION.entityId);
    const listedDocument = listed.documents[0]!;
    expect(
      Object.entries(listedDocument.segmentIdSuffixesByKind).flatMap(([kind, suffixes]) =>
        suffixes.map((suffix) => ({
          sourceSegmentId: listedDocument.segmentIdPrefix + suffix,
          kind,
        })),
      ),
    ).toEqual([
      { sourceSegmentId: CHAPTER_SEGMENT_ID, kind: "chapter" },
      { sourceSegmentId: TABLE_SEGMENT_ID, kind: "table" },
    ]);

    // 候选提交走完校验与收口，任务以正式结果完成。
    expect(port.calls.validations).toHaveLength(2);
    expect(port.calls.settlements).toHaveLength(3);
    expect(port.calls.settlements[0]?.exclusions[0]?.disposition).toBe("accepted");
    expect(port.calls.settlements[0]?.overallAvailability).toBe("partial");
    expect(store.calls).not.toContain("fail");
    expect(store.calls).not.toContain("fail-task");
    expect(store.calls.filter((call) => call === "complete-action")).toHaveLength(3);
    expect(store.calls).toContain("complete-task");
    expect(store.candidates).toEqual([{ disposition: "completed", rejectionClass: undefined }]);

    // 候选与增量各自落一份 JSON 工件。
    const candidateArtifacts = persisted.filter(
      (entry) => entry.purposeCode === "agent-candidate" || entry.purposeCode === "agent-increment",
    );
    // C08 `recordCandidate` 以 `agent-candidate` / `agent-increment` 复验两份工件。
    expect([...candidateArtifacts.map((entry) => entry.purposeCode)].sort()).toEqual([
      "agent-candidate",
      "agent-increment",
    ]);
    expect(
      candidateArtifacts.map(
        (entry) => (entry.value as { readonly exclusions: readonly unknown[] }).exclusions.length,
      ),
    ).toEqual([1, 1]);
  });

  it("does not finalize a rejected candidate", async () => {
    const { store, port, runner } = setup({ script: [protectedCandidateSubmission] });

    expect(await runner.runOnce()).toBe(1);

    expect(port.calls.validations).toHaveLength(1);
    expect(port.calls.validations[0]?.disposition).toBe("rejected");
    expect(port.calls.settlements).toHaveLength(1);
    expect(store.calls).not.toContain("complete-task");
    expect(store.candidates).toEqual([{ disposition: "rejected", rejectionClass: "terminal" }]);
    expect(store.actionFailures).toEqual([
      { code: "AGENT_VALIDATION_REJECTED", reasonCode: "protected-segment" },
    ]);
    expect(store.calls).toContain("release");
  });

  it("records a tool failure instead of completing with a fallback result", async () => {
    const { store, port, runner } = setup({
      script: [documentSliceRequest],
      documentSlice: { observationArtifactRef: observationRef, effect: "committed" },
    });

    expect(await runner.runOnce()).toBe(1);

    expect(store.actionFailures).toEqual([{ code: "AGENT_TOOL_FAILURE" }]);
    expect(store.taskFailures).toEqual([]);
    expect(store.calls).not.toContain("complete-task");
    expect(port.calls.settlements).toEqual([]);
  });

  it("records a model failure instead of completing with a fallback result", async () => {
    const { store, port, gateway, runner } = setup({ script: [new Error("gateway down")] });

    expect(await runner.runOnce()).toBe(1);

    expect(gateway.completeStructured).toHaveBeenCalledTimes(1);
    expect(store.actionFailures).toEqual([{ code: "AGENT_MODEL_FAILURE" }]);
    expect(store.calls).not.toContain("complete-task");
    expect(port.calls.settlements).toEqual([]);
  });

  it("fails the task terminally when the budget cannot be reserved", async () => {
    const { store, port, runner } = setup({
      script: [documentSliceRequest],
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

    expect(store.taskFailures).toEqual([{ code: "AGENT_BUDGET_EXHAUSTED" }]);
    expect(store.actionFailures).toEqual([]);
    expect(store.calls).not.toContain("complete-task");
    expect(port.calls.settlements).toEqual([]);
  });
});

describe("data cleaning model step routing", () => {
  const persistArtifact = vi.fn(async () => observationRef);
  const options: DataCleaningModelStepOptionsV1 = {
    policy,
    persistArtifact,
    loadFrozenInput: async () => frozenInput,
    readObservation: async () => observationContent,
  };
  it("生成Schema只允许任务内短选项与已登记动作", async () => {
    const catalogToolRef = versionRef("tool:preparation-catalog-slice", "1");
    const pagedPolicy = DataCleaningPolicyV1Schema.parse({
      ...policy,
      tools: { ...policy.tools, preparationCatalogToolRef: catalogToolRef },
    });
    const step = await renderDataCleaningModelStep({ ...options, policy: pagedPolicy }, task);
    const catalog = { kind: "read-cleaning-preparation-catalog-slice", sourceOption: 1 };
    expect(step.outputSchema?.safeParse(catalog).success).toBe(true);
    expect(step.outputSchema?.safeParse(documentSliceRequest).success).toBe(true);
    expect(step.outputSchema?.safeParse(tableCandidateSubmission).success).toBe(true);
    for (const input of [
      // 冻结清单外或非法的短选项，以及模型自带的资料长标识与 offset 都不合法。
      { ...catalog, sourceOption: frozenInput.documents.length + 1 },
      { ...catalog, sourceOption: 0 },
      { ...catalog, offset: 0 },
      { ...catalog, sourceVersionRef: frozenInput.documents[0]!.sourceVersionRef },
      monitoringSliceRequest,
    ])
      expect(step.outputSchema?.safeParse(input).success).toBe(false);
    const unpaged = await renderDataCleaningModelStep(options, task);
    expect(unpaged.outputSchema?.safeParse(catalog).success).toBe(false);
  });
  it.each([1, 8])("保留已完成目录页和正文读取，分页大小=%s", async (pageSize) => {
    const catalogToolRef = versionRef("tool:preparation-catalog-slice", "1");
    const pagedPolicy = DataCleaningPolicyV1Schema.parse({
      ...policy,
      tools: {
        ...policy.tools,
        maxSegmentsPerRead: pageSize,
        preparationCatalogToolRef: catalogToolRef,
      },
    });
    const completedToolCalls = [
      {
        toolRef: catalogToolRef,
        input: {
          kind: "read-cleaning-preparation-catalog-slice",
          sourceVersionRef: frozenInput.documents[0]!.sourceVersionRef,
          offset: 0,
        },
        observationArtifactRef: observationRef,
      },
      {
        toolRef: pagedPolicy.tools.documentSegmentToolRef,
        input: documentSliceToolInput,
        observationArtifactRef: observationRef,
      },
    ];
    const rendered = await renderDataCleaningModelStep({ ...options, policy: pagedPolicy }, task, {
      completedToolCalls,
    });
    const payload = JSON.parse(rendered.messages[1]!.content);
    expect(payload.completedReads).toMatchObject([
      {
        kind: "read-cleaning-preparation-catalog-slice",
        sourceOption: 1,
        totalCount: frozenInput.documents[0]!.segments.length,
        segments: frozenInput.documents[0]!.segments.slice(0, pageSize).map(
          ({ sourceSegmentId, kind }) => ({ sourceSegmentId, kind }),
        ),
        complete: pageSize >= frozenInput.documents[0]!.segments.length,
        ...(pageSize < frozenInput.documents[0]!.segments.length ? { nextOffset: pageSize } : {}),
      },
      {
        kind: "read-document-segment-slice",
        sourceOption: 1,
        sourceSegmentIds: documentSliceToolInput.sourceSegmentIds,
      },
    ]);
    await expect(
      renderDataCleaningModelStep({ ...options, policy: pagedPolicy }, task, {
        completedToolCalls: [
          {
            ...completedToolCalls[1]!,
            input: { ...documentSliceToolInput, sourceSegmentIds: ["other-source-1-1"] },
          },
        ],
      }),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
  });
  it.each(["tool", "offset", "count", "monitoring"])(
    "已完成读取记录拒绝错误绑定或越界：%s",
    async (invalid) => {
      const catalogToolRef = versionRef("tool:preparation-catalog-slice", "1");
      const pagedPolicy = DataCleaningPolicyV1Schema.parse({
        ...policy,
        tools: { ...policy.tools, preparationCatalogToolRef: catalogToolRef },
      });
      const call = {
        toolRef: invalid === "tool" ? versionRef("other-tool") : catalogToolRef,
        input:
          invalid === "monitoring"
            ? monitoringSliceRequest
            : {
                kind: "read-cleaning-preparation-catalog-slice",
                sourceVersionRef: frozenInput.documents[0]!.sourceVersionRef,
                offset: invalid === "offset" ? frozenInput.documents[0]!.segments.length + 1 : 0,
              },
        observationArtifactRef: observationRef,
      };
      await expect(
        renderDataCleaningModelStep({ ...options, policy: pagedPolicy }, task, {
          completedToolCalls:
            invalid === "count"
              ? Array.from({ length: task.budgetPolicy.maxToolInvocations + 1 }, () => call)
              : [call],
        }),
      ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    },
  );
  const foreignTask = {
    ...task,
    envelope: {
      ...task.envelope,
      agentTaskRef: { ...taskRef, taskType: "knowledge-authoring" },
    },
  } as unknown as AgentTaskSnapshotV1;
  const definition = createDataCleaningTaskDefinition({ policy, port: makePort() });
  const modelResponse = (value: unknown) => ({
    schemaVersion: "1" as const,
    invocationId: "agent-task:project-1:command-1:action:3",
    modelDeploymentRef: policy.agent.modelDeploymentRef,
    serverBuildRef: versionRef("server-build", "1"),
    modelVersionRef: versionRef("model-version", "1"),
    usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    rawResponseRef: {
      kind: "diagnostic-artifact" as const,
      reference: versionRef("raw-model-response", "1"),
    },
    promptTemplateRef: policy.agent.promptTemplateRef,
    outputSchemaRef: policy.agent.incrementSchemaRef,
    value,
    finishReason: "stop" as const,
  });

  const throwCode = (run: () => unknown): string => {
    try {
      run();
    } catch (error) {
      if (error instanceof AgentRuntimeError) return error.details.code;
      throw error;
    }
    throw new Error("expected the model step callback to throw");
  };

  it("maps read actions to the frozen tool references and rejects unknown actions", async () => {
    await expect(
      interpretDataCleaningModelStep(options, modelResponse(documentSliceRequest), task),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: policy.tools.documentSegmentToolRef,
      toolInput: documentSliceToolInput,
    });
    const withMonitoring = {
      ...options,
      loadFrozenInput: async () =>
        DataCleaningFrozenInputV1Schema.parse({
          ...frozenInput,
          monitoring: {
            monitoringSnapshotRef: monitoringSliceRequest.monitoringSnapshotRef,
            monitoringSeriesRef: {
              kind: "monitoring-series",
              reference: versionRef("monitoring-series"),
            },
            availability: "available",
            coverageRatio: 1,
            availabilityReasons: [],
            members: monitoringSliceRequest.sampleVersionRefs.map(
              (sampleVersionRef, memberIndex) => ({
                memberIndex,
                sampleVersionRef,
                selectionReason: "latest-valid",
              }),
            ),
            pointStatuses: [],
            snapshotFingerprint: sha256("monitoring-snapshot"),
          },
        }),
    };
    await expect(
      interpretDataCleaningModelStep(withMonitoring, modelResponse(monitoringSliceRequest), task),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: policy.tools.monitoringSnapshotToolRef,
      toolInput: monitoringSliceRequest,
    });
    await expect(
      interpretDataCleaningModelStep(options, modelResponse({ kind: "unexpected-action" }), task),
    ).rejects.toMatchObject({ details: { code: "AGENT_VALIDATION_REJECTED", retryable: true } });
    expect(persistArtifact).not.toHaveBeenCalled();
  });

  it.each([false, true])("清洗消息显示未识别表格图片数量，分页模式=%s", async (paged) => {
    const input = structuredClone(frozenInput);
    input.documents[0]!.unrecognizedTableImageCount = 2;
    const step = (await renderDataCleaningModelStep(
      {
        ...options,
        policy: {
          ...policy,
          tools: {
            ...policy.tools,
            ...(paged ? { preparationCatalogToolRef: versionRef("tool:catalog") } : {}),
          },
        },
        loadFrozenInput: async () => input,
      },
      task,
    )) as RenderedStepV1;
    expect(JSON.parse(step.messages[1]!.content).documents[0]).toMatchObject({
      unrecognizedTableImageCount: 2,
    });
  });

  it("分页模式初始消息只列资料身份与段数，并把分页动作路由到登记的工具", async () => {
    const catalogToolRef = versionRef("tool:preparation-catalog-slice", "1");
    const pagedPolicy = DataCleaningPolicyV1Schema.parse({
      ...policy,
      tools: { ...policy.tools, preparationCatalogToolRef: catalogToolRef },
      agent: {
        ...policy.agent,
        budgetPolicy: { ...policy.agent.budgetPolicy, maxOutputTokens: 32_768 },
      },
    });

    const step = (await renderDataCleaningModelStep(
      { ...options, policy: pagedPolicy },
      task,
    )) as RenderedStepV1;
    const listing = step.messages[1]?.content ?? "";
    const payload = JSON.parse(listing) as {
      readonly documents: readonly {
        readonly inputKind: string;
        readonly segmentCount: number;
        readonly sourceOption: number;
      }[];
      readonly tools: Readonly<Record<string, unknown>>;
      readonly constraints: Readonly<Record<string, unknown>>;
      readonly remainingBudget: unknown;
    };

    expect(payload.documents).toEqual([
      {
        sourceOption: 1,
        inputKind: "docx",
        segmentCount: frozenInput.documents[0]!.segments.length,
      },
    ]);
    // 初始消息不再逐个列出段标识，模型改用登记的分页工具定位。
    expect(listing).not.toContain(CHAPTER_SEGMENT_ID);
    expect(listing).not.toContain(TABLE_SEGMENT_ID);
    expect(payload.tools.preparationCatalogToolRef).toEqual(catalogToolRef);
    expect(payload.tools.maxSegmentsPerRead).toBe(policy.tools.maxSegmentsPerRead);
    expect(payload.constraints.minimumRetainedSegmentRatio).toBe(
      policy.minimumRetainedSegmentRatio,
    );
    expect(payload.remainingBudget).toBeDefined();
    // 单次调用不预留整份累计输出额度。
    expect(step.maxOutputTokens).toBe(8_192);

    const request = {
      kind: "read-cleaning-preparation-catalog-slice",
      sourceOption: 1,
    };
    await expect(
      interpretDataCleaningModelStep(
        { ...options, policy: pagedPolicy },
        modelResponse(request),
        task,
      ),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: catalogToolRef,
      toolInput: {
        kind: request.kind,
        sourceVersionRef: frozenInput.documents[0]!.sourceVersionRef,
        offset: 0,
      },
    });
    // 未登记该工具的版本没有对应工具，按输入拒绝而不是落到同名工具。
    await expect(
      interpretDataCleaningModelStep(options, modelResponse(request), task),
    ).rejects.toMatchObject({ details: { code: "AGENT_VALIDATION_REJECTED", retryable: true } });
  });

  it("delegates non-cleaning task types to the inner model step and fails closed without one", () => {
    const innerStep = {
      messages: [{ role: "user" as const, content: "inner" }],
      maxOutputTokens: 1,
    };
    const inner = {
      renderModelStep: vi.fn(() => innerStep),
      interpretModelStep: vi.fn(() => ({ kind: "failed" as const })),
    };
    const delegated = withDataCleaningModelStep({ ...options, inner });
    expect(delegated.renderModelStep(foreignTask, definition)).toEqual(innerStep);
    expect(inner.renderModelStep).toHaveBeenCalledWith(foreignTask, definition, undefined);
    expect(delegated.interpretModelStep(modelResponse({}), foreignTask, definition)).toEqual({
      kind: "failed",
    });

    const withoutInner = withDataCleaningModelStep(options);
    expect(throwCode(() => withoutInner.renderModelStep(foreignTask, definition))).toBe(
      "AGENT_INPUT_INVALID",
    );
    expect(
      throwCode(() => withoutInner.interpretModelStep(modelResponse({}), foreignTask, definition)),
    ).toBe("AGENT_INPUT_INVALID");
  });

  it("fails with an explicit budget error instead of truncating an over-budget input", async () => {
    const overBudgetTask = {
      ...task,
      budgetPolicy: { ...policy.agent.budgetPolicy, maxInputBytes: 16 },
    } as unknown as AgentTaskSnapshotV1;

    await expect(renderDataCleaningModelStep(options, overBudgetTask)).rejects.toMatchObject({
      details: { code: "AGENT_BUDGET_EXHAUSTED", category: "budget", retryable: false },
    });
  });

  it("refuses a frozen inventory bound to another task, manifest or policy", async () => {
    const mismatches = [
      { policyRef: versionRef("policy:other", "1") },
      { agentTaskRef: { ...taskRef, reference: versionRef("agent-task:other", "1") } },
      { manifestArtifactRef: artifactRef("other-frozen-manifest") },
    ];

    for (const mismatch of mismatches) {
      await expect(
        renderDataCleaningModelStep(
          { ...options, loadFrozenInput: async () => ({ ...frozenInput, ...mismatch }) },
          task,
        ),
      ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    }
  });
});
