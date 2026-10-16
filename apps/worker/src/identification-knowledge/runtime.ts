import {
  AgentCandidateVersionV1Schema,
  AgentRuntimeError,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  KNOWLEDGE_AUTHORING_TASK_TYPE,
  IdentificationKnowledgeValidationPolicyV1Schema,
  KnowledgeAuthoringActionV1Schema,
  type IdentificationKnowledgeValidationPolicyV1,
} from "@riskflow/core/identification-knowledge";
import type { StructuredCompletionResultV1 } from "@riskflow/core/model";
import type { IdentificationKnowledgeFailureSettlementV1 } from "@riskflow/adapters/identification-knowledge";
import type {
  AgentModelStepContextV1,
  AgentModelStepRequestV1,
  AgentRuntimeRunner,
  AgentRuntimeRunnerOptionsV1,
  AgentStepOutcomeV1,
} from "../agent-runtime/runner.js";

/** 模型步只看到固定指令与工件引用，永远不内联知识正文。 */
const KNOWLEDGE_AUTHORING_MODEL_INSTRUCTION =
  "Choose the next bounded knowledge-authoring action from the frozen manifest reference.";

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
export interface KnowledgeAuthoringModelStepOptionsV1 {
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
  readonly persistArtifact: (input: {
    readonly task: AgentTaskSnapshotV1;
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }) => Promise<ArtifactRefV1>;
  readonly now?: () => string;
}

/**
 * 渲染编制模型步：消息只包含固定指令、冻结清单工件引用与上一轮观察引用，
 * 输出预算取自冻结策略；不设置领域工具，由模型自行决定读取哪一段或提交候选。
 */
export const renderKnowledgeAuthoringModelStep = (
  options: KnowledgeAuthoringModelStepOptionsV1,
  task: AgentTaskSnapshotV1,
  context?: AgentModelStepContextV1,
): AgentModelStepRequestV1 => {
  const budget = options.policy.agent.budgetPolicy;
  return {
    messages: [
      { role: "system", content: KNOWLEDGE_AUTHORING_MODEL_INSTRUCTION },
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
 * 解释编制模型步：两个有界只读动作转为对冻结工具引用的工具请求；候选提交动作
 * 落两份 JSON 工件（候选与增量）并交给运行时的校验/收口链路；其余一律关闭失败。
 */
export const interpretKnowledgeAuthoringModelStep = async (
  options: KnowledgeAuthoringModelStepOptionsV1,
  response: StructuredCompletionResultV1<unknown>,
  task: AgentTaskSnapshotV1,
): Promise<AgentStepOutcomeV1> => {
  const parsed = KnowledgeAuthoringActionV1Schema.safeParse(response.value);
  if (!parsed.success)
    throw invalidAction(task, response.invocationId, "worker.knowledge-authoring.action.schema");
  const action = parsed.data;
  const policy = options.policy;

  if (action.kind === "read-knowledge-segment-slice")
    return {
      kind: "tool-request",
      toolRef: policy.tools.segmentSliceToolRef,
      toolInput: action,
    };
  if (action.kind === "read-exact-knowledge")
    return {
      kind: "tool-request",
      toolRef: policy.tools.baselineKnowledgeToolRef,
      toolInput: action,
    };
  if (action.kind !== "submit-knowledge-candidate")
    throw invalidAction(task, response.invocationId, "worker.knowledge-authoring.action.kind");

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
    usage: { ...emptyAgentBudgetUsage(), candidates: 1, objects: candidate.operations.length },
  };
};

/** 组合根接给共享 runner 的模型步回调：编制任务走 C17 渲染/解释，其它任务按注入回退。 */
export interface KnowledgeAuthoringModelStepCallbacksV1 {
  readonly renderModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["renderModelStep"]>;
  readonly interpretModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["interpretModelStep"]>;
}

/**
 * 组装 `knowledge-authoring` 的模型步回调；其他任务类型必须显式注入 `inner` 回退，
 * 否则关闭失败，避免静默地给出与任务类型无关的步骤。
 */
export const withKnowledgeAuthoringModelStep = (
  options: KnowledgeAuthoringModelStepOptionsV1 & {
    readonly inner?: {
      readonly renderModelStep?: AgentRuntimeRunnerOptionsV1["renderModelStep"];
      readonly interpretModelStep?: AgentRuntimeRunnerOptionsV1["interpretModelStep"];
    };
  },
): KnowledgeAuthoringModelStepCallbacksV1 => {
  const step: KnowledgeAuthoringModelStepOptionsV1 = {
    policy: IdentificationKnowledgeValidationPolicyV1Schema.parse(options.policy),
    persistArtifact: options.persistArtifact,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  return {
    renderModelStep: (task, definition, context) => {
      if (task.envelope.agentTaskRef.taskType === KNOWLEDGE_AUTHORING_TASK_TYPE)
        return renderKnowledgeAuthoringModelStep(step, task, context);
      const inner = options.inner?.renderModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.render");
      return inner(task, definition, context);
    },
    interpretModelStep: (response, task, definition, context) => {
      if (task.envelope.agentTaskRef.taskType === KNOWLEDGE_AUTHORING_TASK_TYPE)
        return interpretKnowledgeAuthoringModelStep(step, response, task);
      const inner = options.inner?.interpretModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.interpret");
      return inner(response, task, definition, context);
    },
  };
};

/** 由组合根注入的编制运行依赖：共享 runner 与 C17 终态失败收口回调。 */
export interface KnowledgeAuthoringRunnerOptionsV1 {
  readonly runner: AgentRuntimeRunner;
  readonly settleAuthoringFailures: (
    signal?: AbortSignal,
  ) => Promise<IdentificationKnowledgeFailureSettlementV1>;
}

export interface KnowledgeAuthoringRunSummaryV1 {
  readonly processedTasks: number;
  readonly settledFailures: number;
  /** 逐 attempt 隔离后的未收口原因；非空表示本轮存在可查的授权/调用失败。 */
  readonly unsettledFailures: IdentificationKnowledgeFailureSettlementV1["failures"];
}

/**
 * 编制运行封装：shared runner 先按 C08 处理 claim、租约、预算、模型循环与重试，
 * 模块侧只对 C17 attempt 的终态失败收口一次；不复制任何通用运行时语义。
 */
export class KnowledgeAuthoringRunner {
  readonly #options: KnowledgeAuthoringRunnerOptionsV1;

  constructor(options: KnowledgeAuthoringRunnerOptionsV1) {
    this.#options = options;
  }

  async runOnce(signal?: AbortSignal): Promise<KnowledgeAuthoringRunSummaryV1> {
    const processedTasks = await this.#options.runner.runOnce(signal);
    const settlement = await this.#options.settleAuthoringFailures(signal);
    return {
      processedTasks,
      settledFailures: settlement.settled,
      unsettledFailures: settlement.failures,
    };
  }
}
