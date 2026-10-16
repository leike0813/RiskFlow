import {
  AgentCandidateVersionV1Schema,
  AgentRuntimeError,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import type { StructuredCompletionResultV1 } from "@riskflow/core/model";
import {
  SCORING_RULE_AUTHORING_TASK_TYPE_V1,
  ScoringRuleActionV1Schema,
  ScoringRulesPolicyV1Schema,
  type ScoringRulesPolicyV1,
} from "@riskflow/core/scoring-rules";
import type {
  AgentModelStepContextV1,
  AgentModelStepRequestV1,
  AgentRuntimeRunnerOptionsV1,
  AgentStepOutcomeV1,
} from "../agent-runtime/runner.js";

/** 模型步只看到固定指令与冻结工件引用，永远不内联清单正文、规则正文或工具输出。 */
const SCORING_RULE_AUTHORING_MODEL_INSTRUCTION =
  "Propose the next bounded structured scoring rule action from the frozen authoring manifest reference.";

const CANDIDATE_PURPOSE_CODE = "agent-candidate";
const CANDIDATE_INCREMENT_PURPOSE_CODE = "agent-increment";

const invalidStep = (
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

/** 由组合根注入的模型步依赖：冻结的 C19 策略、候选工件持久化入口与时钟。 */
export interface ScoringRuleAuthoringModelStepOptionsV1 {
  readonly policy: ScoringRulesPolicyV1;
  readonly persistArtifact: (input: {
    readonly task: AgentTaskSnapshotV1;
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }) => Promise<ArtifactRefV1>;
  readonly now?: () => string;
}

/**
 * 只接管与冻结 C19 策略精确同版的 `knowledge-authoring` 任务定义；定义引用或工具策略
 * 任一不匹配都视为非 C19 任务，交由 `inner` 回退，避免按名字猜测任务归属。
 */
const isScoringRuleAuthoringStep = (
  policy: ScoringRulesPolicyV1,
  task: AgentTaskSnapshotV1,
  definition: AgentTaskDefinitionV1,
): boolean => {
  const definitionRef = definition.metadata.definitionRef;
  const toolPolicyRef = definition.metadata.toolPolicyRef;
  return (
    task.envelope.agentTaskRef.taskType === SCORING_RULE_AUTHORING_TASK_TYPE_V1 &&
    definitionRef.entityId === policy.agent.definitionRef.entityId &&
    definitionRef.versionId === policy.agent.definitionRef.versionId &&
    toolPolicyRef.entityId === policy.agent.toolPolicyRef.entityId &&
    toolPolicyRef.versionId === policy.agent.toolPolicyRef.versionId
  );
};

/**
 * 渲染编制模型步：消息只包含固定指令、冻结清单工件引用与上一轮观察引用，输出预算取自
 * 冻结策略；不设置领域工具，由模型自行决定读取哪一段。
 */
export const renderScoringRuleAuthoringModelStep = (
  options: ScoringRuleAuthoringModelStepOptionsV1,
  task: AgentTaskSnapshotV1,
  context?: AgentModelStepContextV1,
): AgentModelStepRequestV1 => {
  const budget = options.policy.agent.budgetPolicy;
  return {
    messages: [
      { role: "system", content: SCORING_RULE_AUTHORING_MODEL_INSTRUCTION },
      {
        role: "user",
        content: JSON.stringify({
          frozenAuthoringManifestArtifactRef: task.envelope.frozenInputRef,
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
 * 解释编制模型步：只读切片动作在冻结读上限内转为对冻结工具引用的工具请求；候选提交动作
 * 落两份 JSON 工件（候选与增量）并交给运行时的校验/收口链路；其余一律关闭失败。
 */
export const interpretScoringRuleAuthoringModelStep = async (
  options: ScoringRuleAuthoringModelStepOptionsV1,
  response: StructuredCompletionResultV1<unknown>,
  task: AgentTaskSnapshotV1,
): Promise<AgentStepOutcomeV1> => {
  const parsed = ScoringRuleActionV1Schema.safeParse(response.value);
  if (!parsed.success)
    throw invalidStep(task, "worker.scoring-rule.action.schema", response.invocationId);
  const action = parsed.data;
  const tools = options.policy.tools;

  if (action.kind === "read-standard-segment-slice") {
    if (action.sourceSegmentIds.length > tools.maxSegmentsPerRead)
      throw invalidStep(task, "worker.scoring-rule.action.manifest-scope", response.invocationId);
    return {
      kind: "tool-request",
      toolRef: tools.standardSegmentToolRef,
      toolInput: action,
    };
  }
  if (action.kind === "read-indicator-catalog-slice") {
    if (action.indicatorIds.length > tools.maxIndicatorsPerRead)
      throw invalidStep(task, "worker.scoring-rule.action.manifest-scope", response.invocationId);
    return {
      kind: "tool-request",
      toolRef: tools.indicatorCatalogToolRef,
      toolInput: action,
    };
  }
  if (action.kind !== "submit-scoring-rule-candidate")
    throw invalidStep(task, "worker.scoring-rule.action.kind", response.invocationId);

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

/**
 * 组装 C19 编制任务的模型步回调；其他任务类型或非同一 C19 定义必须显式注入 `inner`
 * 回退，否则关闭失败，避免静默地给出与任务类型无关的步骤。`inner` 抛出的 C08 错误
 * 原样上抛，不做包装或吞并。
 */
export const withScoringRuleAuthoringModelStep = (
  options: ScoringRuleAuthoringModelStepOptionsV1 & {
    readonly inner?: {
      readonly renderModelStep?: AgentRuntimeRunnerOptionsV1["renderModelStep"];
      readonly interpretModelStep?: AgentRuntimeRunnerOptionsV1["interpretModelStep"];
    };
  },
): {
  readonly renderModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["renderModelStep"]>;
  readonly interpretModelStep: NonNullable<AgentRuntimeRunnerOptionsV1["interpretModelStep"]>;
} => {
  const step: ScoringRuleAuthoringModelStepOptionsV1 = {
    policy: ScoringRulesPolicyV1Schema.parse(options.policy),
    persistArtifact: options.persistArtifact,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  return {
    renderModelStep: (task, definition, context) => {
      if (isScoringRuleAuthoringStep(step.policy, task, definition))
        return renderScoringRuleAuthoringModelStep(step, task, context);
      const inner = options.inner?.renderModelStep;
      if (inner === undefined) throw invalidStep(task, "worker.scoring-rule.render");
      return inner(task, definition, context);
    },
    interpretModelStep: (response, task, definition, context) => {
      if (isScoringRuleAuthoringStep(step.policy, task, definition))
        return interpretScoringRuleAuthoringModelStep(step, response, task);
      const inner = options.inner?.interpretModelStep;
      if (inner === undefined) throw invalidStep(task, "worker.scoring-rule.interpret");
      return inner(response, task, definition, context);
    },
  };
};
