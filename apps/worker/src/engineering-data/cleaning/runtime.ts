import { VersionReferenceSchema, type VersionReference } from "@riskflow/contracts/common";
import { MonitoringSnapshotRefV1Schema } from "@riskflow/contracts/ports";
import {
  AgentCandidateVersionV1Schema,
  AgentRuntimeError,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  DATA_CLEANING_TASK_TYPE,
  DataCleaningActionV1Schema,
  DataCleaningCandidateSubmissionV1Schema,
  DataCleaningDocumentSliceRequestV1Schema,
  DataCleaningMonitoringSliceRequestV1Schema,
  DataCleaningFrozenInputV1Schema,
  DataCleaningPolicySchema,
  type DataCleaningFrozenDocumentV1,
  type DataCleaningFrozenInputV1,
  type DataCleaningPolicy,
} from "@riskflow/core/engineering-data/cleaning";
import type { JsonValue } from "@riskflow/core/persistence";
import type { StructuredCompletionResultV1 } from "@riskflow/core/model";
import { z } from "@riskflow/core/model";
import type {
  AgentCompletedToolCallV1,
  AgentModelStepContextV1,
  AgentModelStepRequestV1,
  AgentRuntimeRunnerOptionsV1,
  AgentStepOutcomeV1,
} from "../../agent-runtime/runner.js";

/** 模型步只看到固定指令与冻结准备的最小定位清单；正文只经受权观察 reader 进入消息。 */
const DATA_CLEANING_MODEL_INSTRUCTION =
  "Choose the next bounded data-cleaning action from the frozen preparation listing; read slices only through the frozen domain tools. " +
  "Frozen documents are numbered by sourceOption in the listing; select a document by that number and never restate version identifiers, offsets or artifact paths. " +
  "Locate segments either from the full listing (segmentIdPrefix plus a segmentIdSuffixesByKind suffix) or, when a preparation catalog tool is registered, by asking that tool for the next unlisted page of the selected document. " +
  "The host derives each page offset and the progress shown in completedReads; each document read must contain only segment IDs belonging to the selected sourceOption. " +
  "Only exclude references the listed constraints still allow, and use the remaining cumulative budget to decide whether to read another slice or submit a cleaning candidate.";

/** 单次调用的输出上界；累计输出额度仍由任务台账约束，避免每次预留整份累计额度。 */
const DATA_CLEANING_MODEL_STEP_MAX_OUTPUT_TOKENS = 8_192;

const CANDIDATE_PURPOSE_CODE = "agent-candidate";
const CANDIDATE_INCREMENT_PURPOSE_CODE = "agent-increment";

const unsupportedTaskType = (task: AgentTaskSnapshotV1, stage: string): AgentRuntimeError =>
  new AgentRuntimeError(
    makeAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      retryable: false,
      stage,
      taskRef: task.envelope.agentTaskRef,
    }),
  );

const invalidAction = (
  task: AgentTaskSnapshotV1,
  actionId: string,
  stage: string,
): AgentRuntimeError =>
  new AgentRuntimeError(
    makeAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      retryable: false,
      stage,
      taskRef: task.envelope.agentTaskRef,
      actionId,
    }),
  );

/**
 * 模型输出形态错误沿网关既有分类：普通选错短选项或字段错误可在原预算内修正，
 * 不等同于真实撤权或来源资格失效的不可修复失败。
 */
const repairableModelOutput = (
  task: AgentTaskSnapshotV1,
  actionId: string,
  stage: string,
): AgentRuntimeError =>
  new AgentRuntimeError(
    makeAgentError({
      code: "AGENT_VALIDATION_REJECTED",
      category: "validation",
      retryable: true,
      reasonCode: "model-output-schema-invalid",
      stage,
      taskRef: task.envelope.agentTaskRef,
      actionId,
    }),
  );

const sameVersion = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const sameReferenced = (
  left: { readonly kind: string; readonly reference: VersionReference },
  right: { readonly kind: string; readonly reference: VersionReference },
): boolean => left.kind === right.kind && sameVersion(left.reference, right.reference);

/** 注入的读取函数可能被多工程调用方错绑定，冻结清单必须复验属于本任务与本策略。 */
const assertFrozenBinding = (
  frozen: DataCleaningFrozenInputV1,
  task: AgentTaskSnapshotV1,
  policy: DataCleaningPolicy,
): void => {
  const frozenInputRef = task.envelope.frozenInputRef;
  if (
    !sameReferenced(frozen.agentTaskRef, task.envelope.agentTaskRef) ||
    frozenInputRef.kind !== "content-artifact" ||
    !sameReferenced(frozen.manifestArtifactRef, frozenInputRef) ||
    !sameVersion(frozen.policyRef, policy.policyRef)
  )
    throw new AgentRuntimeError(
      makeAgentError({
        code: "AGENT_INPUT_INVALID",
        category: "input",
        retryable: false,
        stage: "worker.cleaning.model-input-binding",
        taskRef: task.envelope.agentTaskRef,
      }),
    );
};

/** 由组合根注入的模型步依赖：冻结策略、候选工件持久化入口、受权冻结定位 reader 与时钟。 */
export interface DataCleaningModelStepOptionsV1 {
  readonly policy: DataCleaningPolicy;
  readonly persistArtifact: (input: {
    readonly task: AgentTaskSnapshotV1;
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }) => Promise<ArtifactRefV1>;
  /** 读取本任务的冻结准备清单：只取资料/段/样本的真实定位，不取正文与哈希。 */
  readonly loadFrozenInput: (task: AgentTaskSnapshotV1) => Promise<DataCleaningFrozenInputV1>;
  /** 经 C04 受权 reader 读取上一轮观察内容；用途码、能力与上限由该 reader 决定。 */
  readonly readObservation: (
    task: AgentTaskSnapshotV1,
    artifactRef: ArtifactRefV1,
  ) => Promise<JsonValue>;
  readonly now?: () => string;
}

/**
 * 冻结清单定位：资料只以任务内短选项出现，真实版本由宿主解析；声明定位工具的版本
 * 只列选项与段数，由分页工具按宿主机推进的 offset 读取段；未声明的版本保留原全定位视图，
 * 避免静默切换模型可见范围。
 */
const frozenDocumentListing = (
  document: DataCleaningFrozenDocumentV1,
  sourceOption: number,
  paged: boolean,
): Record<string, unknown> => {
  if (paged)
    return {
      sourceOption,
      inputKind: document.inputKind,
      segmentCount: document.segments.length,
      ...(document.unrecognizedTableImageCount === undefined
        ? {}
        : {
            unrecognizedTableImageCount: document.unrecognizedTableImageCount,
          }),
    };
  // 无损提取公共前缀，避免每个段重复长来源标识；不假定标识的构造格式。
  let segmentIdPrefix = document.segments[0]?.sourceSegmentId ?? "";
  for (const segment of document.segments)
    while (!segment.sourceSegmentId.startsWith(segmentIdPrefix))
      segmentIdPrefix = segmentIdPrefix.slice(0, -1);
  const segmentIdSuffixesByKind: Record<string, string[]> = {};
  for (const segment of document.segments)
    (segmentIdSuffixesByKind[segment.kind] ??= []).push(
      segment.sourceSegmentId.slice(segmentIdPrefix.length),
    );
  return {
    sourceOption,
    inputKind: document.inputKind,
    segmentIdPrefix,
    segmentIdSuffixesByKind,
    ...(document.unrecognizedTableImageCount === undefined
      ? {}
      : {
          unrecognizedTableImageCount: document.unrecognizedTableImageCount,
        }),
  };
};

/** 资料短选项 = 冻结清单内的位置；宿主据此解析真实引用，模型不回抄长标识。 */
const documentOptionOf = (
  frozen: DataCleaningFrozenInputV1,
  document: DataCleaningFrozenDocumentV1,
): number => frozen.documents.indexOf(document) + 1;

/** 已完成读取按内部精确工具输入复验后，以任务内短选项呈现给模型；分页位置由宿主保留。 */
const completedReadsFor = (
  task: AgentTaskSnapshotV1,
  frozen: DataCleaningFrozenInputV1,
  policy: DataCleaningPolicy,
  calls: NonNullable<AgentModelStepContextV1["completedToolCalls"]>,
) => {
  const reject = (): never => {
    throw invalidAction(task, task.envelope.commandId, "worker.cleaning.completed-reads");
  };
  if (calls.length > task.budgetPolicy.maxToolInvocations) reject();
  return calls.map((call) => {
    const parsed = DataCleaningActionV1Schema.safeParse(call.input);
    if (!parsed.success || parsed.data.kind === "submit-cleaning-candidate") return reject();
    const action = parsed.data;
    if (action.kind === "read-monitoring-snapshot-slice") {
      const monitoring = frozen.monitoring;
      if (
        !sameVersion(call.toolRef, policy.tools.monitoringSnapshotToolRef) ||
        monitoring === undefined ||
        !sameReferenced(action.monitoringSnapshotRef, monitoring.monitoringSnapshotRef) ||
        action.sampleVersionRefs.length > policy.tools.maxMonitoringItemsPerRead ||
        action.sampleVersionRefs.some(
          (ref) =>
            !monitoring.members.some((member) => sameReferenced(ref, member.sampleVersionRef)),
        )
      )
        return reject();
      return { ...action, observationArtifactRef: call.observationArtifactRef };
    }
    const document = frozen.documents.find((item) =>
      sameReferenced(item.sourceVersionRef, action.sourceVersionRef),
    );
    if (document === undefined) return reject();
    if (action.kind === "read-document-segment-slice") {
      if (
        !sameVersion(call.toolRef, policy.tools.documentSegmentToolRef) ||
        action.sourceSegmentIds.length > policy.tools.maxSegmentsPerRead ||
        action.sourceSegmentIds.some(
          (id) => !document.segments.some((segment) => segment.sourceSegmentId === id),
        )
      )
        return reject();
      return {
        kind: action.kind,
        sourceOption: documentOptionOf(frozen, document),
        sourceSegmentIds: action.sourceSegmentIds,
        observationArtifactRef: call.observationArtifactRef,
      };
    }
    const catalogTool = policy.tools.preparationCatalogToolRef;
    if (
      catalogTool === undefined ||
      !sameVersion(call.toolRef, catalogTool) ||
      action.offset > document.segments.length
    )
      return reject();
    const segments = document.segments
      .slice(action.offset, action.offset + policy.tools.maxSegmentsPerRead)
      .map(({ sourceSegmentId, kind }) => ({ sourceSegmentId, kind }));
    const nextOffset = action.offset + segments.length;
    return {
      kind: action.kind,
      sourceOption: documentOptionOf(frozen, document),
      observationArtifactRef: call.observationArtifactRef,
      totalCount: document.segments.length,
      segments,
      complete: nextOffset === document.segments.length,
      ...(nextOffset < document.segments.length ? { nextOffset } : {}),
    };
  });
};

/** 模型可见动作：资料与分页只按任务内短选项选择，真实版本、资料段与 offset 由宿主解析。 */
const dataCleaningModelSliceSchema = z.strictObject({
  kind: z.literal("read-document-segment-slice"),
  sourceOption: z.number().int().positive(),
  sourceSegmentIds: DataCleaningDocumentSliceRequestV1Schema.shape.sourceSegmentIds,
});

const dataCleaningModelCatalogSchema = z.strictObject({
  kind: z.literal("read-cleaning-preparation-catalog-slice"),
  sourceOption: z.number().int().positive(),
});

type DataCleaningModelActionV1 =
  | z.infer<typeof DataCleaningCandidateSubmissionV1Schema>
  | z.infer<typeof dataCleaningModelSliceSchema>
  | z.infer<typeof dataCleaningModelCatalogSchema>
  | z.infer<typeof DataCleaningMonitoringSliceRequestV1Schema>;

/**
 * 模型输出 Schema：每个冻结资料一个短选项；越界选项、模型自带长标识或 offset 都不合法，
 * 由网关既有结构校验归类为可修正错误。内部工具继续执行原精确动作契约。
 */
const cleaningActionSchemaFor = (frozen: DataCleaningFrozenInputV1, policy: DataCleaningPolicy) => {
  const exactVersion = (ref: VersionReference) =>
    VersionReferenceSchema.extend({
      entityId: z.literal(ref.entityId),
      versionId: z.literal(ref.versionId),
    });
  return z.union([
    DataCleaningCandidateSubmissionV1Schema,
    ...frozen.documents.flatMap((_, index) => {
      const sourceOption = z.literal(index + 1);
      return [
        dataCleaningModelSliceSchema.extend({
          sourceOption,
          sourceSegmentIds: dataCleaningModelSliceSchema.shape.sourceSegmentIds.max(
            policy.tools.maxSegmentsPerRead,
          ),
        }),
        ...(policy.tools.preparationCatalogToolRef === undefined
          ? []
          : [dataCleaningModelCatalogSchema.extend({ sourceOption })]),
      ];
    }),
    ...(frozen.monitoring === undefined
      ? []
      : [
          DataCleaningMonitoringSliceRequestV1Schema.extend({
            monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.extend({
              reference: exactVersion(frozen.monitoring.monitoringSnapshotRef.reference),
            }),
            sampleVersionRefs:
              DataCleaningMonitoringSliceRequestV1Schema.shape.sampleVersionRefs.max(
                policy.tools.maxMonitoringItemsPerRead,
              ),
          }),
        ]),
  ]);
};

const parseModelAction = (
  frozen: DataCleaningFrozenInputV1,
  policy: DataCleaningPolicy,
  value: unknown,
): DataCleaningModelActionV1 | undefined => {
  const parsed = cleaningActionSchemaFor(frozen, policy).safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const documentForOption = (
  frozen: DataCleaningFrozenInputV1,
  option: number,
  task: AgentTaskSnapshotV1,
  actionId: string,
): DataCleaningFrozenDocumentV1 => {
  const document = frozen.documents[option - 1];
  if (document === undefined)
    throw repairableModelOutput(task, actionId, "worker.cleaning.action.source-option");
  return document;
};

/** 已读位置由已完成工具记录推进：模型只选资料，不能指定 offset 或任意工件路径。 */
const nextCatalogOffsetFor = (
  policy: DataCleaningPolicy,
  document: DataCleaningFrozenDocumentV1,
  calls: ReadonlyArray<AgentCompletedToolCallV1>,
): number => {
  const catalogToolRef = policy.tools.preparationCatalogToolRef;
  let offset = 0;
  for (const call of calls) {
    if (catalogToolRef === undefined || !sameVersion(call.toolRef, catalogToolRef)) continue;
    const parsed = DataCleaningActionV1Schema.safeParse(call.input);
    if (!parsed.success || parsed.data.kind !== "read-cleaning-preparation-catalog-slice") continue;
    if (!sameReferenced(parsed.data.sourceVersionRef, document.sourceVersionRef)) continue;
    offset = Math.max(
      offset,
      Math.min(parsed.data.offset + policy.tools.maxSegmentsPerRead, document.segments.length),
    );
  }
  return offset;
};

/** 模型消息只带冻结准备的最小定位与受权观察内容，超出冻结输入预算时明确报错而非截断。 */
export const renderDataCleaningModelStep = async (
  options: DataCleaningModelStepOptionsV1,
  task: AgentTaskSnapshotV1,
  context?: AgentModelStepContextV1,
): Promise<AgentModelStepRequestV1> => {
  const budget = options.policy.agent.budgetPolicy;
  const frozen = DataCleaningFrozenInputV1Schema.parse(await options.loadFrozenInput(task));
  assertFrozenBinding(frozen, task, options.policy);
  const previousObservationArtifactRef = context?.previousObservationArtifactRef;
  const tools = options.policy.tools;
  const paged = tools.preparationCatalogToolRef !== undefined;
  const payload = {
    frozenManifestArtifactRef: task.envelope.frozenInputRef,
    tools: {
      documentSegmentToolRef: tools.documentSegmentToolRef,
      monitoringSnapshotToolRef: tools.monitoringSnapshotToolRef,
      maxSegmentsPerRead: tools.maxSegmentsPerRead,
      maxMonitoringItemsPerRead: tools.maxMonitoringItemsPerRead,
      ...(tools.preparationCatalogToolRef === undefined
        ? {}
        : { preparationCatalogToolRef: tools.preparationCatalogToolRef }),
    },
    constraints: {
      allowedExclusionReasonCodes: options.policy.allowedExclusionReasonCodes,
      ...(options.policy.schemaVersion === "1"
        ? {
            requiredSegmentKinds: options.policy.requiredSegmentKinds,
            minimumRetainedSegmentRatio: options.policy.minimumRetainedSegmentRatio,
          }
        : { documentRules: options.policy.documentRules }),
      protectedSegmentKinds: options.policy.protectedSegmentKinds,
      protectedMonitoringSelectionReasons: options.policy.protectedMonitoringSelectionReasons,
      minimumRetainedSampleRatio: options.policy.minimumRetainedSampleRatio,
      minimumDocumentCoverageRatio: options.policy.minimumDocumentCoverageRatio,
    },
    documents: frozen.documents.map((document, index) =>
      frozenDocumentListing(document, index + 1, paged),
    ),
    completedReads: completedReadsFor(
      task,
      frozen,
      options.policy,
      context?.completedToolCalls ?? [],
    ),
    remainingBudget: {
      modelInvocations: Math.max(
        0,
        budget.maxModelInvocations - task.budgetLedger.used.modelInvocations,
      ),
      toolInvocations: Math.max(
        0,
        budget.maxToolInvocations - task.budgetLedger.used.toolInvocations,
      ),
      inputTokens: Math.max(
        0,
        (budget.maxInputTokens ?? budget.maxContextTokens) - task.budgetLedger.used.inputTokens,
      ),
      outputTokens: Math.max(
        0,
        (budget.maxOutputTokens ?? budget.maxContextTokens) - task.budgetLedger.used.outputTokens,
      ),
    },
    ...(frozen.monitoring === undefined
      ? {}
      : {
          monitoring: {
            snapshotRef: frozen.monitoring.monitoringSnapshotRef,
            sampleVersionRefs: frozen.monitoring.members.map((member) => member.sampleVersionRef),
          },
        }),
    ...(previousObservationArtifactRef === undefined
      ? {}
      : {
          previousObservationArtifactRef,
          previousObservation: await options.readObservation(task, previousObservationArtifactRef),
        }),
  };
  const messages: AgentModelStepRequestV1["messages"] = [
    { role: "system", content: DATA_CLEANING_MODEL_INSTRUCTION },
    { role: "user", content: JSON.stringify(payload) },
  ];
  // 冻结输入预算是硬门：超限时给出明确预算错误，不截断消息、不改用更小上下文冒充。
  if (
    new TextEncoder().encode(JSON.stringify(messages)).byteLength > task.budgetPolicy.maxInputBytes
  )
    throw new AgentRuntimeError(
      makeAgentError({
        code: "AGENT_BUDGET_EXHAUSTED",
        category: "budget",
        retryable: false,
        stage: "worker.cleaning.model-input-budget",
        taskRef: task.envelope.agentTaskRef,
      }),
    );
  return {
    messages,
    outputSchema: cleaningActionSchemaFor(frozen, options.policy),
    maxOutputTokens: Math.min(
      DATA_CLEANING_MODEL_STEP_MAX_OUTPUT_TOKENS,
      budget.maxOutputTokens ?? budget.maxContextTokens,
    ),
  };
};

/**
 * 解释清洗模型步：模型只选资料短选项，宿主还原精确引用（分页位置按已完成工具记录推进）
 * 后转为对冻结工具引用的工具请求；候选提交动作落两份 JSON 工件（候选与增量）并交给
 * 运行时的校验/收口链路；其余一律关闭失败。
 */
export const interpretDataCleaningModelStep = async (
  options: DataCleaningModelStepOptionsV1,
  response: StructuredCompletionResultV1<unknown>,
  task: AgentTaskSnapshotV1,
  context?: AgentModelStepContextV1,
): Promise<AgentStepOutcomeV1> => {
  const policy = options.policy;
  const frozen = DataCleaningFrozenInputV1Schema.parse(await options.loadFrozenInput(task));
  assertFrozenBinding(frozen, task, policy);
  const action = parseModelAction(frozen, policy, response.value);
  if (action === undefined)
    throw repairableModelOutput(task, response.invocationId, "worker.cleaning.action.schema");

  if (action.kind === "read-document-segment-slice")
    return {
      kind: "tool-request",
      toolRef: policy.tools.documentSegmentToolRef,
      toolInput: {
        kind: action.kind,
        sourceVersionRef: documentForOption(
          frozen,
          action.sourceOption,
          task,
          response.invocationId,
        ).sourceVersionRef,
        sourceSegmentIds: action.sourceSegmentIds,
      },
    };
  if (action.kind === "read-monitoring-snapshot-slice")
    return {
      kind: "tool-request",
      toolRef: policy.tools.monitoringSnapshotToolRef,
      toolInput: action,
    };
  if (action.kind === "read-cleaning-preparation-catalog-slice") {
    const toolRef = policy.tools.preparationCatalogToolRef;
    // 未登记定位工具的版本没有该工具，按输入/策略拒绝而不是落到同名工具或模型故障。
    if (toolRef === undefined)
      throw invalidAction(task, response.invocationId, "worker.cleaning.action.tool-policy");
    const document = documentForOption(frozen, action.sourceOption, task, response.invocationId);
    return {
      kind: "tool-request",
      toolRef,
      toolInput: {
        kind: action.kind,
        sourceVersionRef: document.sourceVersionRef,
        offset: nextCatalogOffsetFor(policy, document, context?.completedToolCalls ?? []),
      },
    };
  }
  if (action.kind !== "submit-cleaning-candidate")
    throw invalidAction(task, response.invocationId, "worker.cleaning.action.kind");

  const candidate = action.candidate;
  // 运行时的模型步回调不携带 actionId；`completeAgentStructured` 以 actionId 作为
  // `invocationId`，因此这里用它作为工件归属的动作标识。
  const actionId = response.invocationId;
  const [candidateArtifactRef, incrementArtifactRef] = await Promise.all([
    options.persistArtifact({
      task,
      actionId,
      purposeCode: CANDIDATE_PURPOSE_CODE,
      value: candidate,
    }),
    options.persistArtifact({
      task,
      actionId,
      purposeCode: CANDIDATE_INCREMENT_PURPOSE_CODE,
      value: candidate,
    }),
  ]);
  const parentCandidateVersion = task.state.latestCandidateVersion ?? 0;

  return {
    kind: "completed",
    candidate: AgentCandidateVersionV1Schema.parse({
      schemaVersion: "1",
      taskRef: task.envelope.agentTaskRef,
      candidateVersion: parentCandidateVersion + 1,
      parentCandidateVersion,
      candidateArtifactRef,
      incrementArtifactRef,
      disposition: "pending",
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
    }),
    candidatePayload: candidate,
    increment: candidate,
    usage: { ...emptyAgentBudgetUsage(), candidates: 1, objects: candidate.exclusions.length },
  };
};

/**
 * 组装 `data-cleaning` 的模型步回调；其他任务类型必须显式注入 `inner` 回退，
 * 否则关闭失败，避免静默地给出与任务类型无关的步骤。
 */
export const withDataCleaningModelStep = (
  options: DataCleaningModelStepOptionsV1 & {
    readonly inner?: {
      readonly renderModelStep?: AgentRuntimeRunnerOptionsV1["renderModelStep"];
      readonly interpretModelStep?: AgentRuntimeRunnerOptionsV1["interpretModelStep"];
    };
  },
): {
  readonly renderModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["renderModelStep"]>;
  readonly interpretModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["interpretModelStep"]>;
} => {
  const step: DataCleaningModelStepOptionsV1 = {
    policy: DataCleaningPolicySchema.parse(options.policy),
    persistArtifact: options.persistArtifact,
    loadFrozenInput: options.loadFrozenInput,
    readObservation: options.readObservation,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  return {
    renderModelStep: (task, definition, context) => {
      if (task.envelope.agentTaskRef.taskType === DATA_CLEANING_TASK_TYPE)
        return renderDataCleaningModelStep(step, task, context);
      const inner = options.inner?.renderModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.render");
      return inner(task, definition, context);
    },
    interpretModelStep: (response, task, definition, context) => {
      if (task.envelope.agentTaskRef.taskType === DATA_CLEANING_TASK_TYPE)
        return interpretDataCleaningModelStep(step, response, task, context);
      const inner = options.inner?.interpretModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.interpret");
      return inner(response, task, definition, context);
    },
  };
};
