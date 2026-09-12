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
  DataCleaningPolicyV1Schema,
  type DataCleaningPolicyV1,
} from "@riskflow/core/engineering-data/cleaning";
import type { StructuredCompletionResultV1 } from "@riskflow/core/model";
import type {
  AgentModelStepContextV1,
  AgentModelStepRequestV1,
  AgentRuntimeRunnerOptionsV1,
  AgentStepOutcomeV1,
} from "../../agent-runtime/runner.js";

/** 模型步只看到固定指令与工件引用，永远不内联清单正文。 */
const DATA_CLEANING_MODEL_INSTRUCTION =
  "Choose the next bounded data-cleaning action from the frozen preparation manifest reference.";

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

/** 由组合根注入的模型步依赖：冻结策略、候选工件持久化入口与时钟。 */
export interface DataCleaningModelStepOptionsV1 {
  readonly policy: DataCleaningPolicyV1;
  readonly persistArtifact: (input: {
    readonly task: AgentTaskSnapshotV1;
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }) => Promise<ArtifactRefV1>;
  readonly now?: () => string;
}

/**
 * 渲染清洗模型步：消息只包含固定指令、冻结清单工件引用与上一轮观察引用，
 * 输出预算取自冻结策略；不设置领域工具，由模型自行决定读取哪一段。
 */
export const renderDataCleaningModelStep = (
  options: DataCleaningModelStepOptionsV1,
  task: AgentTaskSnapshotV1,
  context?: AgentModelStepContextV1,
): AgentModelStepRequestV1 => {
  const budget = options.policy.agent.budgetPolicy;
  return {
    messages: [
      { role: "system", content: DATA_CLEANING_MODEL_INSTRUCTION },
      {
        role: "user",
        content: JSON.stringify({
          frozenManifestArtifactRef: task.envelope.frozenInputRef,
          ...(context?.previousObservationArtifactRef === undefined
            ? {}
            : { previousObservationArtifactRef: context.previousObservationArtifactRef }),
        }),
      },
    ],
    maxOutputTokens: budget.maxOutputTokens ?? budget.maxContextTokens,
  };
};

/**
 * 解释清洗模型步：只读切片动作转为对冻结工具引用的工具请求；候选提交动作
 * 落两份 JSON 工件（候选与增量）并交给运行时的校验/收口链路；其余一律关闭失败。
 */
export const interpretDataCleaningModelStep = async (
  options: DataCleaningModelStepOptionsV1,
  response: StructuredCompletionResultV1<unknown>,
  task: AgentTaskSnapshotV1,
): Promise<AgentStepOutcomeV1> => {
  const parsed = DataCleaningActionV1Schema.safeParse(response.value);
  if (!parsed.success)
    throw invalidAction(task, response.invocationId, "worker.cleaning.action.schema");
  const action = parsed.data;
  const policy = options.policy;

  if (action.kind === "read-document-segment-slice")
    return {
      kind: "tool-request",
      toolRef: policy.tools.documentSegmentToolRef,
      toolInput: action,
    };
  if (action.kind === "read-monitoring-snapshot-slice")
    return {
      kind: "tool-request",
      toolRef: policy.tools.monitoringSnapshotToolRef,
      toolInput: action,
    };
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
    policy: DataCleaningPolicyV1Schema.parse(options.policy),
    persistArtifact: options.persistArtifact,
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
    interpretModelStep: (response, task, definition) => {
      if (task.envelope.agentTaskRef.taskType === DATA_CLEANING_TASK_TYPE)
        return interpretDataCleaningModelStep(step, response, task);
      const inner = options.inner?.interpretModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.interpret");
      return inner(response, task, definition);
    },
  };
};
