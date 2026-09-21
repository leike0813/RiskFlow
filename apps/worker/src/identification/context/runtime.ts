import {
  AgentCandidateVersionV1Schema,
  AgentRuntimeError,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  RETRIEVAL_REVIEW_TASK_TYPE,
  RetrievalReviewActionV1Schema,
  RetrievalReviewIncrementV1Schema,
  type RetrievalReviewPolicyV1,
} from "@riskflow/core/identification/context";
import type { StructuredCompletionResultV1 } from "@riskflow/core/model";

import type {
  AgentModelStepContextV1,
  AgentModelStepRequestV1,
  AgentRuntimeRunnerOptionsV1,
  AgentStepOutcomeV1,
} from "../../agent-runtime/runner.js";

/** 模型步只看到固定指令与冻结候选集引用，永远不内联候选正文、证据或工具输出。 */
const RETRIEVAL_REVIEW_MODEL_INSTRUCTION =
  "Choose the next bounded retrieval-review action from the frozen candidate set reference.";

const CANDIDATE_PURPOSE_CODE = "agent-candidate";
const CANDIDATE_INCREMENT_PURPOSE_CODE = "agent-increment";

const invalidAction = (
  task: AgentTaskSnapshotV1,
  stage: string,
  actionId?: string,
): AgentRuntimeError =>
  new AgentRuntimeError(
    makeAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      retryable: false,
      stage,
      taskRef: task.envelope.agentTaskRef,
      ...(actionId === undefined ? {} : { actionId }),
    }),
  );

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

/** 由组合根注入的模型步依赖：冻结审阅策略、候选工件持久化入口与时钟。 */
export interface RetrievalReviewModelStepOptionsV1 {
  readonly policy: RetrievalReviewPolicyV1;
  readonly persistArtifact: (input: {
    readonly task: AgentTaskSnapshotV1;
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }) => Promise<ArtifactRefV1>;
  readonly now?: () => string;
}

/** 渲染审阅模型步：消息只有固定指令、冻结候选集引用与上一轮观察引用。 */
export const renderRetrievalReviewModelStep = (
  options: RetrievalReviewModelStepOptionsV1,
  task: AgentTaskSnapshotV1,
  context?: AgentModelStepContextV1,
): AgentModelStepRequestV1 => {
  const budget = task.budgetPolicy;
  return {
    messages: [
      { role: "system", content: RETRIEVAL_REVIEW_MODEL_INSTRUCTION },
      {
        role: "user",
        content: JSON.stringify({
          frozenCandidateSetRef: task.envelope.frozenInputRef,
          ...(context?.previousObservationArtifactRef === undefined
            ? {}
            : { previousObservationArtifactRef: context.previousObservationArtifactRef }),
        }),
      },
    ],
    maxOutputTokens: Math.min(
      options.policy.modelMaxOutputTokens,
      budget.maxOutputTokens ?? budget.maxContextTokens,
    ),
  };
};

/**
 * 解释审阅模型步：两项有界工具转为对冻结工具引用的工具请求；提交动作落两份工件
 * （候选与增量）后交给同一运行时的校验与收口链路；其余一律关闭失败。
 */
export const interpretRetrievalReviewModelStep = async (
  options: RetrievalReviewModelStepOptionsV1,
  response: StructuredCompletionResultV1<unknown>,
  task: AgentTaskSnapshotV1,
): Promise<AgentStepOutcomeV1> => {
  const parsed = RetrievalReviewActionV1Schema.safeParse(response.value);
  if (!parsed.success) {
    throw invalidAction(task, "worker.retrieval-review.action.schema", response.invocationId);
  }
  const action = parsed.data;
  const policy = options.policy;
  if (action.kind === "read-frozen-result") {
    return { kind: "tool-request", toolRef: policy.readFrozenResultToolRef, toolInput: action };
  }
  if (action.kind === "bounded-hybrid-resupplement") {
    return { kind: "tool-request", toolRef: policy.resupplementToolRef, toolInput: action };
  }
  if (action.kind !== "submit-retrieval-review") {
    throw invalidAction(task, "worker.retrieval-review.action.kind", response.invocationId);
  }
  const increment = RetrievalReviewIncrementV1Schema.parse(action.increment);
  // 模型步回调不携带 actionId；`completeAgentStructured` 以 invocationId 作为动作标识。
  const actionId = response.invocationId;
  const [candidateArtifactRef, incrementArtifactRef] = await Promise.all([
    options.persistArtifact({
      task,
      actionId,
      purposeCode: CANDIDATE_PURPOSE_CODE,
      value: increment,
    }),
    options.persistArtifact({
      task,
      actionId,
      purposeCode: CANDIDATE_INCREMENT_PURPOSE_CODE,
      value: increment,
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
    candidatePayload: increment,
    increment,
    usage: { ...emptyAgentBudgetUsage(), candidates: 1, objects: increment.operations.length },
  };
};

/** 组合根接给共享 runner 的模型步回调：审阅任务走 C21 渲染/解释，其它任务按注入回退。 */
export interface RetrievalReviewModelStepCallbacksV1 {
  readonly renderModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["renderModelStep"]>;
  readonly interpretModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["interpretModelStep"]>;
}

/**
 * 组装 `retrieval-review` 的模型步回调；其他任务类型必须显式注入 `inner` 回退，
 * 否则关闭失败，避免静默给出与任务类型无关的步骤。
 */
export const withRetrievalReviewModelStep = (
  options: RetrievalReviewModelStepOptionsV1 & {
    readonly inner?: {
      readonly renderModelStep?: AgentRuntimeRunnerOptionsV1["renderModelStep"];
      readonly interpretModelStep?: AgentRuntimeRunnerOptionsV1["interpretModelStep"];
    };
  },
): RetrievalReviewModelStepCallbacksV1 => {
  const step: RetrievalReviewModelStepOptionsV1 = {
    policy: options.policy,
    persistArtifact: options.persistArtifact,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  return {
    renderModelStep: (task, definition, context) => {
      if (task.envelope.agentTaskRef.taskType === RETRIEVAL_REVIEW_TASK_TYPE) {
        return renderRetrievalReviewModelStep(step, task, context);
      }
      const inner = options.inner?.renderModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.render");
      return inner(task, definition, context);
    },
    interpretModelStep: (response, task, definition) => {
      if (task.envelope.agentTaskRef.taskType === RETRIEVAL_REVIEW_TASK_TYPE) {
        return interpretRetrievalReviewModelStep(step, response, task);
      }
      const inner = options.inner?.interpretModelStep;
      if (inner === undefined) throw unsupportedTaskType(task, "worker.model-step.interpret");
      return inner(response, task, definition);
    },
  };
};
