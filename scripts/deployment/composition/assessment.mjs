import { createHash } from "node:crypto";
import { createDeploymentResponseModelStepV1 } from "./response-model-step.mjs";

import { createAssessmentGraphComposition } from "../../../apps/worker/dist/index.js";
import { createPostgresRiskAssessmentEngine } from "../../../packages/adapters/dist/risk-assessment/engine/index.js";
import { createAssessmentEntryContextReadPort } from "../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createDeploymentSiteContextReaderV1 } from "../../../packages/adapters/dist/deployment/index.js";
import {
  PostgresWarningAssessmentContextReader,
  createPostgresWarningLifecycleAdapter,
} from "../../../packages/adapters/dist/warning/index.js";
import {
  createPostgresRecommendationAdapter,
  createPostgresRecommendationContextReader,
} from "../../../packages/adapters/dist/recommendation/index.js";
import {
  createEffectForecastModelReaderV1,
  createPostgresResponseLifecycleAdapter,
  createPostgresResponseLifecycleContextReader,
  createProductionEffectForecastExecutorResolverV1,
} from "../../../packages/adapters/dist/response-lifecycle/index.js";
import { createPostgresCalibrationAdapter } from "../../../packages/adapters/dist/calibration/index.js";
import { PostgresAgentTaskAdapter } from "../../../packages/adapters/dist/agent-runtime/index.js";
import {
  createResponseRecommendationTaskDefinition,
  RECOMMENDATION_TASK_TYPE_V1,
  ResponseAgentPolicyV1Schema,
} from "../../../packages/core/dist/recommendation/index.js";
import {
  CALIBRATION_AGENT_TASK_TYPE_V1,
  CalibrationValidationPolicyV1Schema,
  createCalibrationSuggestionTaskDefinition,
} from "../../../packages/core/dist/calibration/index.js";
import { CALIBRATION_TARGET_DEFINITION_TYPES_V1 } from "../../../packages/core/dist/calibration/index.js";
import { AssessmentBasisReleaseSetReadResultV1Schema } from "../../../packages/core/dist/scoring-rules/index.js";
import {
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  CalibrationInputSnapshotRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  ContentArtifactRefV1Schema,
  DeviationRecordRefV1Schema,
  KnowledgeQueryResultRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  RecommendationCandidateRefV1Schema,
  StartAgentTaskCommandV1Schema,
  WarningResponseTaskRefV1Schema,
} from "../../../packages/contracts/dist/ports/index.js";

const required = (value, name) => {
  if (value === undefined || value === null) {
    throw new TypeError(`DEPLOYMENT_ASSESSMENT_DEPENDENCY_MISSING:${name}`);
  }
  return value;
};

const requiredMethod = (value, name, method) => {
  required(value, name);
  if (typeof value[method] !== "function") {
    throw new TypeError(`DEPLOYMENT_ASSESSMENT_PORT_INVALID:${name}.${method}`);
  }
  return value;
};

const sameRef = (left, right) =>
  left?.entityId === right?.entityId && left?.versionId === right?.versionId;

/**
 * 按调用方工程取精确登记策略；工程未登记即宿主装配缺陷，直接失败而不是伪造失败 DTO。
 */
const policiesOf = (projects, projectId) => {
  const project = projects.get(projectId);
  if (project === undefined) {
    throw new TypeError("DEPLOYMENT_ASSESSMENT_PROJECT_POLICY_MISSING");
  }
  return project.policies;
};

/** C25 十项运行策略：组合身份由批准目录分配，只按工程精确解析，不挑成员冒充。 */
export const createAssessmentRuntimePolicyProviderV1 = (projects) => ({
  readRuntimePolicySet: async (input) => ({
    kind: "succeeded",
    policySet: policiesOf(projects, input.authorization.projectId)["assessment-runtime"],
  }),
});

/** C26 预警运行策略：策略集身份无自有 ref，两项成员引用必须逐字匹配该工程登记。 */
export const createWarningRuntimePolicyProviderV1 = (projects) => ({
  read: async (input) => {
    const policies = policiesOf(projects, input.authorization.projectId)["warning-runtime"];
    if (
      !sameRef(input.warningAggregationPolicyRef, policies.warningAggregationPolicy.policyRef) ||
      !sameRef(input.notificationPolicyRef, policies.notificationPolicy.policyRef)
    ) {
      throw new TypeError("DEPLOYMENT_WARNING_RUNTIME_POLICY_MEMBER_MISMATCH");
    }
    return policies;
  },
});

/** C25 分段入口策略：只接受同工程绑定且由 C19 冻结依据集合证明的精确发布。 */
export const createDeploymentAssessmentGraphPoliciesV1 = ({
  projects,
  basis,
  authorizeDownstream,
}) => {
  requiredMethod(basis, "basis", "readAssessmentBasisReleaseSet");
  requiredMethod({ authorizeDownstream }, "authorizeDownstream", "authorizeDownstream");

  const resolveMember = async (input, actionType, releaseRef, allowedDefinitionTypes) => {
    const project = projects.get(input.projectId);
    if (
      project === undefined ||
      project.binding?.projectId !== input.projectId ||
      input.authorization?.projectId !== input.projectId ||
      typeof input.authorization?.actorId !== "string" ||
      !AssessmentBasisReleaseSetRefV1Schema.safeParse(input.basisReleaseSetRef).success ||
      !KnowledgeReleaseRefV1Schema.safeParse(releaseRef).success
    ) {
      return undefined;
    }

    const identity = createHash("sha256")
      .update(
        JSON.stringify([
          input.basisReleaseSetRef.kind,
          input.basisReleaseSetRef.reference.entityId,
          input.basisReleaseSetRef.reference.versionId,
          actionType,
          input.requiredAt,
        ]),
      )
      .digest("hex");
    const requestId = `assessment-policy:${identity}`;
    const authorization = await authorizeDownstream({
      projectId: input.projectId,
      actorId: input.authorization.actorId,
      branch: "knowledge-modeling.assessment-basis",
      invocationId: requestId,
    });
    if (
      authorization?.projectId !== input.projectId ||
      authorization.actorId !== input.authorization.actorId ||
      !authorization.grantedCapabilities?.includes("knowledge-modeling.read")
    ) {
      return undefined;
    }

    const result = await basis.readAssessmentBasisReleaseSet({
      requestId,
      idempotencyKey: requestId,
      requestedAt: authorization.decidedAt ?? new Date().toISOString(),
      authorization,
      assessmentBasisReleaseSetRef: input.basisReleaseSetRef,
    });
    const parsed = AssessmentBasisReleaseSetReadResultV1Schema.safeParse(result);
    if (
      !parsed.success ||
      parsed.data.kind !== "succeeded" ||
      !sameRef(
        parsed.data.assessmentBasisReleaseSetRef.reference,
        input.basisReleaseSetRef.reference,
      )
    ) {
      return undefined;
    }

    const members = [
      ...parsed.data.configurationMembers,
      ...(actionType === "calibration-policy"
        ? parsed.data.scoringRuleMembers.map((member) => ({
            ...member,
            definitionType: "structured-scoring-rule",
          }))
        : []),
    ].filter((member) => sameRef(member.releaseRef.reference, releaseRef.reference));
    if (members.length !== 1 || !allowedDefinitionTypes.includes(members[0].definitionType)) {
      return undefined;
    }
    return { member: members[0], releaseRef };
  };

  return {
    async resolveForecastPolicy(input) {
      const project = projects.get(input.projectId);
      const releaseRef = project?.binding.forecastPolicyReleaseRef;
      const resolved = await resolveMember(input, "forecast-policy", releaseRef, [
        "forecast-policy",
      ]);
      return resolved === undefined
        ? { kind: "unavailable", reasonCode: "forecast-policy-unavailable" }
        : { kind: "resolved", forecastPolicyRef: resolved.member.releaseRef.reference };
    },
    async resolveCalibrationPolicy(input) {
      const project = projects.get(input.projectId);
      const releaseRef = project?.binding.calibrationTargetReleaseRef;
      const calibration = project?.policies.calibration;
      const agentPolicy = CalibrationValidationPolicyV1Schema.safeParse(calibration);
      if (!agentPolicy.success || agentPolicy.data.projectId !== input.projectId) {
        return { kind: "unavailable", reasonCode: "calibration-policy-unavailable" };
      }
      const resolved = await resolveMember(
        input,
        "calibration-policy",
        releaseRef,
        CALIBRATION_TARGET_DEFINITION_TYPES_V1,
      );
      return resolved === undefined
        ? { kind: "unavailable", reasonCode: "calibration-target-unavailable" }
        : {
            kind: "resolved",
            targetReleaseRef: resolved.releaseRef,
            calibrationValidationPolicyRef: agentPolicy.data.validationPolicyRef,
            agentPolicy: agentPolicy.data,
          };
    },
  };
};

/**
 * C28 措施发布读取：按请求给出的精确引用逐项经 C19 已发布配置成员 reader 确认。
 * 下游身份按 `knowledge-modeling.assessment-basis` 逐引用派生，重放同一请求得到同一签发。
 * 任一引用不可读、类型非 measure-library 或版本不匹配即整批拒绝，不返回部分结果。
 */
export const createDeploymentMeasureReleaseReaderV1 = ({ basis, authorizeDownstream }) => {
  requiredMethod(basis, "basis", "readPublishedConfigurationMember");
  requiredMethod({ authorizeDownstream }, "authorizeDownstream", "authorizeDownstream");

  return Object.freeze({
    async readPublishedMeasureReleases(input) {
      const { authorization, measureLibraryReleaseRefs } = input;
      const projectId = authorization?.projectId;
      if (
        typeof projectId !== "string" ||
        projectId.length === 0 ||
        typeof authorization.actorId !== "string" ||
        !Array.isArray(measureLibraryReleaseRefs) ||
        measureLibraryReleaseRefs.length === 0
      ) {
        return [];
      }

      const published = [];
      for (const releaseRef of measureLibraryReleaseRefs) {
        const requestId = `${input.requestId}:measure-release:${releaseRef.entityId}:${releaseRef.versionId}`;
        const context = await authorizeDownstream({
          projectId,
          actorId: authorization.actorId,
          branch: "knowledge-modeling.assessment-basis",
          invocationId: requestId,
        });
        if (
          context?.projectId !== projectId ||
          context.actorId !== authorization.actorId ||
          !context.grantedCapabilities?.includes("knowledge-modeling.read")
        ) {
          return [];
        }
        // 正文已由 C19 reader 解析为 AssessmentConfigurationDocumentV1；此处只认措施库判别式。
        const member = await basis.readPublishedConfigurationMember({
          projectId,
          requestId,
          releaseRef,
          authorization: context,
        });
        if (member?.body?.definitionType !== "measure-library") {
          return [];
        }
        published.push(releaseRef);
      }
      return published;
    },
  });
};

/**
 * C27 处置策略：三项策略按请求给出的精确 ref 解析；现场正文只经部署注入的 C04 绑定读取。
 * 三类策略正文自带 policyRef，引用不符即非本工程批准正文。
 */
export const createRecommendationPolicyProviderV1 = (projects, siteContextReader) => {
  const exact = (input, policyType, requestedRef) => {
    const policies = policiesOf(projects, input.authorization.projectId);
    const policy = policies[policyType];
    if (!sameRef(requestedRef, policy.policyRef)) {
      throw new TypeError(`DEPLOYMENT_RECOMMENDATION_POLICY_REF_MISMATCH:${policyType}`);
    }
    return policy;
  };
  return {
    readGenerationPolicy: async (input) =>
      exact(input, "response-generation", input.generationPolicyRef),
    readValidationContext: async (input) => {
      const siteContext = await siteContextReader.read({
        requestId: `${input.requestId}:site-context`,
        requestedAt: input.requestedAt,
        authorization: input.authorization,
        siteContextRef: input.siteContextRef,
      });
      if (siteContext === undefined) {
        throw new TypeError("DEPLOYMENT_SITE_CONTEXT_UNAVAILABLE");
      }
      return {
        validationPolicy: exact(input, "response-validation", input.validationPolicyRef),
        siteContext,
      };
    },
    readAgentPolicy: async (input) => exact(input, "response-agent", input.agentPolicyRef),
  };
};

const requireTaskPorts = (tasks) => {
  requiredMethod(tasks, "tasks", "startTask");
  requiredMethod(tasks, "tasks", "getTask");
  return tasks;
};

const projectOf = (resolveProject, projectId) => {
  const project = resolveProject(projectId);
  if (project?.binding?.projectId !== projectId || project.policies === undefined) {
    throw new TypeError("DEPLOYMENT_AGENT_PROJECT_BINDING_MISSING");
  }
  return project;
};

const authorizationForTask = async (authorizeDownstream, input) => {
  const run = input.run;
  const authorization = await authorizeDownstream({
    projectId: run.projectId,
    actorId: run.actorId,
    branch: "agent-task.start-task",
    invocationId: input.actionId,
    requestedSpatialScopeRefs: run.authorization.spatialScopeRefs,
  });
  if (
    authorization?.projectId !== run.projectId ||
    authorization.actorId !== run.actorId ||
    !authorization.grantedCapabilities?.includes("agent-task.start")
  ) {
    throw new TypeError("DEPLOYMENT_AGENT_TASK_AUTHORIZATION_INVALID");
  }
  return authorization;
};

const observeAgentTask = async ({ tasks, taskRef, input, taskType, policy, frozenInputRef }) => {
  const task = await tasks.getTask(taskRef);
  if (task === undefined) return { kind: "waiting", agentTaskRef: taskRef };
  const envelope = task.envelope;
  if (
    envelope.projectId !== input.run.projectId ||
    envelope.actorId !== input.run.actorId ||
    envelope.agentTaskRef?.reference?.entityId !== taskRef.reference.entityId ||
    envelope.agentTaskRef?.reference?.versionId !== taskRef.reference.versionId ||
    envelope.taskType !== taskType ||
    envelope.commandId !== input.actionId ||
    envelope.idempotencyKey !== input.actionId ||
    envelope.parentRunRef?.reference?.entityId !== input.run.runRef.reference.entityId ||
    envelope.parentRunRef?.reference?.versionId !== input.run.runRef.reference.versionId ||
    !sameRef(envelope.modelDeploymentRef, policy.budgetPolicy.modelDeploymentRef) ||
    !sameRef(envelope.promptTemplateRef, policy.budgetPolicy.promptTemplateRef) ||
    !sameRef(envelope.toolPolicyRef, policy.toolPolicyRef) ||
    !sameRef(envelope.budgetPolicyRef, policy.budgetPolicy.policyRef) ||
    !sameRef(envelope.incrementSchemaRef, policy.incrementSchemaRef) ||
    !sameRef(envelope.validationPolicyRef, policy.validationPolicyRef) ||
    task.state.agentTaskRef?.reference?.entityId !== taskRef.reference.entityId ||
    task.state.agentTaskRef?.reference?.versionId !== taskRef.reference.versionId ||
    task.state.agentTaskRef?.taskType !== taskType ||
    task.state.agentTaskRef?.triggerMode !== "embedded" ||
    !sameRef(task.state.agentTaskRef?.modelDeploymentRef, policy.budgetPolicy.modelDeploymentRef) ||
    !sameRef(task.state.agentTaskRef?.promptTemplateRef, policy.budgetPolicy.promptTemplateRef) ||
    !sameRef(task.state.agentTaskRef?.toolPolicyRef, policy.toolPolicyRef) ||
    !sameRef(task.state.agentTaskRef?.budgetPolicyRef, policy.budgetPolicy.policyRef) ||
    !sameRef(task.state.agentTaskRef?.incrementSchemaRef, policy.incrementSchemaRef) ||
    !sameRef(task.state.agentTaskRef?.validationPolicyRef, policy.validationPolicyRef) ||
    (frozenInputRef !== undefined &&
      (envelope.frozenInputRef?.kind !== frozenInputRef.kind ||
        !sameRef(envelope.frozenInputRef?.reference, frozenInputRef.reference)))
  ) {
    return { kind: "failed", reasonCode: "agent-task-identity-mismatch" };
  }
  if (task.state.status === "terminal-failure") {
    return { kind: "failed", reasonCode: task.state.error?.code ?? "agent-task-terminal-failure" };
  }
  if (task.state.status === "cancelled") {
    return { kind: "failed", reasonCode: task.state.cancelReasonCode ?? "agent-task-cancelled" };
  }
  if (task.state.status !== "completed") return { kind: "waiting", agentTaskRef: taskRef };

  const parsedResult = AgentTaskResultRefV1Schema.safeParse(task.state.resultRef);
  if (!parsedResult.success) {
    return { kind: "failed", reasonCode: "agent-task-completed-result-invalid" };
  }
  const result = parsedResult.data;
  if (
    result.status !== "completed" ||
    result.agentTaskRef.reference.entityId !== taskRef.reference.entityId ||
    result.agentTaskRef.reference.versionId !== taskRef.reference.versionId ||
    result.agentTaskRef.taskType !== taskType ||
    result.agentTaskRef.triggerMode !== "embedded" ||
    !sameRef(result.agentTaskRef.modelDeploymentRef, policy.budgetPolicy.modelDeploymentRef) ||
    !sameRef(result.agentTaskRef.promptTemplateRef, policy.budgetPolicy.promptTemplateRef) ||
    !sameRef(result.agentTaskRef.toolPolicyRef, policy.toolPolicyRef) ||
    !sameRef(result.agentTaskRef.budgetPolicyRef, policy.budgetPolicy.policyRef) ||
    !sameRef(result.agentTaskRef.incrementSchemaRef, policy.incrementSchemaRef) ||
    !sameRef(result.agentTaskRef.validationPolicyRef, policy.validationPolicyRef)
  ) {
    return { kind: "failed", reasonCode: "agent-task-completed-result-mismatch" };
  }
  return { task, result };
};

const startEmbeddedTask = async ({
  tasks,
  authorizeDownstream,
  input,
  policy,
  taskType,
  frozenInputRef,
}) => {
  const { run, actionId } = input;
  const command = StartAgentTaskCommandV1Schema.parse({
    kind: "start-task",
    commandId: actionId,
    idempotencyKey: actionId,
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: await authorizationForTask(authorizeDownstream, input),
    payload: {
      taskType,
      triggerMode: "embedded",
      parentRunRef: run.runRef,
      frozenInputRef,
      modelDeploymentRef: policy.budgetPolicy.modelDeploymentRef,
      promptTemplateRef: policy.budgetPolicy.promptTemplateRef,
      toolPolicyRef: policy.toolPolicyRef,
      budgetPolicyRef: policy.budgetPolicy.policyRef,
      incrementSchemaRef: policy.incrementSchemaRef,
      validationPolicyRef: policy.validationPolicyRef,
    },
  });
  const started = await tasks.startTask(command);
  if (started?.kind !== "succeeded" || started.result?.agentTaskRef === undefined) {
    return { kind: "failed", reasonCode: started?.error?.code ?? "agent-task-start-failed" };
  }
  const parsedTaskRef = AgentTaskRefV1Schema.safeParse(started.result.agentTaskRef);
  const expectedEntityId = `agent-task:${run.projectId}:${actionId}`;
  if (
    !parsedTaskRef.success ||
    parsedTaskRef.data.taskType !== taskType ||
    parsedTaskRef.data.triggerMode !== "embedded" ||
    parsedTaskRef.data.reference.entityId !== expectedEntityId ||
    parsedTaskRef.data.reference.versionId !== "1" ||
    !sameRef(parsedTaskRef.data.modelDeploymentRef, policy.budgetPolicy.modelDeploymentRef) ||
    !sameRef(parsedTaskRef.data.promptTemplateRef, policy.budgetPolicy.promptTemplateRef) ||
    !sameRef(parsedTaskRef.data.toolPolicyRef, policy.toolPolicyRef) ||
    !sameRef(parsedTaskRef.data.budgetPolicyRef, policy.budgetPolicy.policyRef) ||
    !sameRef(parsedTaskRef.data.incrementSchemaRef, policy.incrementSchemaRef) ||
    !sameRef(parsedTaskRef.data.validationPolicyRef, policy.validationPolicyRef)
  ) {
    return { kind: "failed", reasonCode: "agent-task-start-identity-mismatch" };
  }
  const taskRef = parsedTaskRef.data;
  const observed = await observeAgentTask({
    tasks,
    taskRef,
    input,
    taskType,
    policy,
    frozenInputRef,
  });
  if (observed.kind !== undefined) return observed;
  return { kind: "completed", agentTaskRef: taskRef, agentTaskResultRef: observed.result };
};

/** C27 C08 provider：只启动/读取同一 actionId 的真实任务，候选由终态结果引用给出。 */
export const createDeploymentRecommendationAgentV1 = ({
  tasks: taskPort,
  resolveProject,
  authorizeDownstream,
  siteBindings,
  siteContextReader,
}) => {
  const tasks = requireTaskPorts(taskPort);
  requiredMethod({ resolveProject }, "resolveProject", "resolveProject");
  requiredMethod({ authorizeDownstream }, "authorizeDownstream", "authorizeDownstream");
  required(siteBindings, "siteBindings");
  requiredMethod(siteContextReader, "siteContextReader", "read");
  if (!Array.isArray(siteBindings) || siteBindings.length > 256) {
    throw new TypeError("DEPLOYMENT_SITE_BINDINGS_INVALID");
  }

  return Object.freeze({
    async resolveSiteContextRef({ run, requiredAt }) {
      const bindings = siteBindings.filter(
        (binding) =>
          binding.projectId === run.projectId &&
          run.frozenRefs.some((ref) => sameRef(ref.reference, binding.siteContextRef)),
      );
      const exact = [];
      for (const binding of bindings) {
        const context = await siteContextReader.read({
          requestId: `${run.runRef.reference.entityId}:site-context:${binding.siteContextRef.entityId}`,
          requestedAt: requiredAt,
          authorization: run.authorization,
          siteContextRef: binding.siteContextRef,
        });
        if (
          context?.projectId === run.projectId &&
          sameRef(context.siteContextRef, binding.siteContextRef) &&
          run.spatialScopeRef !== undefined &&
          sameRef(context.spatialScopeRef.reference, run.spatialScopeRef.reference) &&
          Date.parse(context.observedAt) <= Date.parse(requiredAt)
        ) {
          exact.push(binding.siteContextRef);
        }
      }
      return exact.length === 1 ? exact[0] : undefined;
    },
    async ensureTask(input) {
      if (
        !KnowledgeQueryResultRefV1Schema.safeParse(input.queryResultRef).success ||
        !WarningResponseTaskRefV1Schema.safeParse(input.warningResponseTaskRef).success
      ) {
        return { kind: "failed", reasonCode: "recommendation-agent-input-invalid" };
      }
      const project = projectOf(resolveProject, input.run.projectId);
      const policy = ResponseAgentPolicyV1Schema.parse(project.policies["response-agent"]);
      if (
        policy.projectId !== input.run.projectId ||
        !sameRef(policy.policyRef, input.responseAgentPolicyRef) ||
        !sameRef(
          project.policies["response-generation"]?.policyRef,
          input.responseGenerationPolicyRef,
        )
      ) {
        return { kind: "failed", reasonCode: "recommendation-agent-policy-mismatch" };
      }
      const result = await startEmbeddedTask({
        tasks,
        authorizeDownstream,
        input,
        policy,
        taskType: RECOMMENDATION_TASK_TYPE_V1,
        frozenInputRef: input.queryResultRef,
      });
      if (result.kind !== "completed") return result;
      if (result.agentTaskResultRef.candidateRef === undefined) {
        return { kind: "failed", reasonCode: "recommendation-agent-result-candidate-missing" };
      }
      const candidateRef = RecommendationCandidateRefV1Schema.safeParse(
        result.agentTaskResultRef.candidateRef,
      );
      return candidateRef.success
        ? result
        : { kind: "failed", reasonCode: "recommendation-agent-result-candidate-invalid" };
    },
  });
};

/** C29 C08 provider：冻结输入及策略来自本次图调用，终态只由 C08 快照确认。 */
export const createDeploymentCalibrationAgentV1 = ({
  tasks: taskPort,
  resolveProject,
  authorizeDownstream,
}) => {
  const tasks = requireTaskPorts(taskPort);
  requiredMethod({ resolveProject }, "resolveProject", "resolveProject");
  requiredMethod({ authorizeDownstream }, "authorizeDownstream", "authorizeDownstream");

  return Object.freeze({
    async ensureTask(input) {
      if (
        !ContentArtifactRefV1Schema.safeParse(input.frozenInputRef).success ||
        !CalibrationInputSnapshotRefV1Schema.safeParse(input.inputSnapshotRef).success ||
        !DeviationRecordRefV1Schema.safeParse(input.deviationRecordRef).success
      ) {
        return { kind: "failed", reasonCode: "calibration-agent-input-invalid" };
      }
      const project = projectOf(resolveProject, input.run.projectId);
      const policy = CalibrationValidationPolicyV1Schema.parse(project.policies.calibration);
      if (
        policy.projectId !== input.run.projectId ||
        !sameRef(policy.validationPolicyRef, input.calibrationValidationPolicyRef)
      ) {
        return { kind: "failed", reasonCode: "calibration-agent-policy-mismatch" };
      }
      const result = await startEmbeddedTask({
        tasks,
        authorizeDownstream,
        input,
        policy,
        taskType: CALIBRATION_AGENT_TASK_TYPE_V1,
        frozenInputRef: input.frozenInputRef,
      });
      if (result.kind !== "completed") return result;
      if (result.agentTaskResultRef.candidateRef === undefined) {
        return { kind: "failed", reasonCode: "calibration-agent-result-candidate-missing" };
      }
      const candidateRef = CalibrationSuggestionRefV1Schema.safeParse(
        result.agentTaskResultRef.candidateRef,
      );
      return candidateRef.success
        ? result
        : { kind: "failed", reasonCode: "calibration-agent-result-candidate-missing" };
    },
  });
};

/**
 * C37 IP-05 的评估生产组合：C25 评估、C26 预警、C27 处置、C28 预测与 C29 校准。
 *
 * 本模块只装配已发布工厂与宿主注入的生产端口。全部策略按 `projectBindings` 的精确批准
 * 版本解析；缺项、错版本与跨工程引用一律失败关闭，不取最近版本、不退回 demo 常量。
 * 构造引用环只有 C27 任务定义回指 C27 适配器一处，用一次绑定解开。
 */
export const createDeploymentAssessmentV1 = (options) => {
  required(options, "options");
  const foundation = required(options.foundation, "foundation");
  const config = required(foundation.config, "foundation.config");
  const db = required(foundation.runtime?.db, "foundation.runtime.db");
  const transactionUnit = required(foundation.transactionUnit, "foundation.transactionUnit");
  const access = requiredMethod(foundation.access, "foundation.access", "verify");
  const authorizationScope = requiredMethod(
    foundation.authorizationScope,
    "foundation.authorizationScope",
    "runTask",
  );
  const persistArtifact = required(options.persistArtifact, "persistArtifact");
  const artifactStore = required(foundation.artifactStore, "foundation.artifactStore");
  requiredMethod(artifactStore, "foundation.artifactStore", "put");
  requiredMethod(artifactStore, "foundation.artifactStore", "open");
  const monitoringStore = requiredMethod(
    foundation.monitoringStore,
    "foundation.monitoringStore",
    "readSnapshot",
  );
  const engineeringData = requiredMethod(
    foundation.contextSource,
    "foundation.contextSource",
    "freeze",
  );
  const referenceGuard = required(foundation.referenceGuard, "foundation.referenceGuard");

  const resolveDeploymentPolicies = requiredMethod(
    options.resolveDeploymentPolicies,
    "resolveDeploymentPolicies",
    "resolveProject",
  );
  const registry = requiredMethod(options.registry, "registry", "register");
  requiredMethod(registry, "registry", "assertComplete");
  const checkpointer = requiredMethod(options.checkpointer, "checkpointer", "getTuple");
  const basis = requiredMethod(options.basis, "basis", "readAssessmentBasisReleaseSet");
  const review = requiredMethod(options.review, "review", "requestReview");
  requiredMethod(review, "review", "verifyCalibrationSuggestionApproval");
  const workflowAdapter = required(options.workflowAdapter, "workflowAdapter");
  requiredMethod(
    workflowAdapter.entriesRead,
    "workflowAdapter.entriesRead",
    "readAssessmentEntriesForRecords",
  );
  requiredMethod(workflowAdapter.runRead, "workflowAdapter.runRead", "readAssessmentRun");
  const riskInputFacts = requiredMethod(
    options.riskInputFacts,
    "riskInputFacts",
    "readRiskInputFacts",
  );
  const identificationRead = requiredMethod(
    options.identificationRead,
    "identificationRead",
    "read",
  );
  const governance = requiredMethod(options.governance, "governance", "govern");
  const routeDecisions = requiredMethod(
    options.routeDecisions,
    "routeDecisions",
    "readRouteDecision",
  );
  const taskAuthorization = requiredMethod(
    options.taskAuthorization,
    "taskAuthorization",
    "authorize",
  );
  const reviewAuthorization = requiredMethod(
    options.reviewAuthorization,
    "reviewAuthorization",
    "authorize",
  );
  const measureReleaseReader = requiredMethod(
    options.measureReleaseReader,
    "measureReleaseReader",
    "readPublishedMeasureReleases",
  );
  const recommendationAgent = required(options.recommendationAgent, "recommendationAgent");
  requiredMethod(recommendationAgent, "recommendationAgent", "resolveSiteContextRef");
  requiredMethod(recommendationAgent, "recommendationAgent", "ensureTask");
  const calibrationAgent = required(options.calibrationAgent, "calibrationAgent");
  requiredMethod(calibrationAgent, "calibrationAgent", "ensureTask");
  const calibrationTaskPort = required(options.calibrationTaskPort, "calibrationTaskPort");
  requiredMethod(calibrationTaskPort, "calibrationTaskPort", "validateIncrement");
  requiredMethod(calibrationTaskPort, "calibrationTaskPort", "finalizeIncrement");
  const policies = required(options.policies, "policies");
  requiredMethod(policies, "policies", "resolveForecastPolicy");
  requiredMethod(policies, "policies", "resolveCalibrationPolicy");
  const authorizeDownstream = required(options.authorizeDownstream, "authorizeDownstream");
  const runtimeAuthorization = requiredMethod(
    options.runtimeAuthorization,
    "runtimeAuthorization",
    "verifyCurrent",
  );
  const siteBindings = required(options.siteBindings, "siteBindings");

  const projectBindings = required(config.projectBindings, "config.projectBindings");
  if (projectBindings.length === 0) {
    throw new TypeError("DEPLOYMENT_ASSESSMENT_PROJECT_BINDINGS_REQUIRED");
  }
  const projects = new Map();
  for (const binding of projectBindings) {
    if (projects.has(binding.projectId)) {
      throw new TypeError("DEPLOYMENT_ASSESSMENT_PROJECT_DUPLICATE");
    }
    const project = resolveDeploymentPolicies.resolveProject(binding.projectId);
    if (project.binding.projectId !== binding.projectId) {
      throw new TypeError("DEPLOYMENT_ASSESSMENT_POLICY_PROJECT_MISMATCH");
    }
    projects.set(binding.projectId, project);
  }
  // C27/C29 任务定义按同实例共享策略注册；跨工程定义正文不一致时由策略解析器先行拒绝。
  const commonPolicies = [...projects.values()][0].policies;

  const siteContextReader = createDeploymentSiteContextReaderV1({
    artifactStore,
    bindings: siteBindings,
  });
  const agentTasks = new PostgresAgentTaskAdapter({
    db,
    registry,
    transactionUnit,
    artifactStore,
    referenceGuard,
    authorization: access,
  });

  // C27 任务定义的增量端口回指 C27 适配器自身（C27 既是定义所有者也是确定性校验者），
  // 这里只延迟解析引用，不预造候选；绑定在推荐适配器构造后一次完成。
  const recommendationAdapterRef = { current: undefined };
  registry.register(
    createResponseRecommendationTaskDefinition({
      policy: commonPolicies["response-agent"],
      port: {
        validateIncrement: (input) =>
          authorizationScope.runTask(input.task, () =>
            recommendationAdapterRef.current.validateIncrement(input),
          ),
        finalizeIncrement: (input) =>
          authorizationScope.runTask(input.task, () =>
            recommendationAdapterRef.current.finalizeIncrement(input),
          ),
      },
    }),
  );
  registry.register(
    createCalibrationSuggestionTaskDefinition({
      policy: commonPolicies.calibration,
      port: {
        validateIncrement: (input) =>
          authorizationScope.runTask(input.task, () =>
            calibrationTaskPort.validateIncrement(input),
          ),
        finalizeIncrement: (input) =>
          authorizationScope.runTask(input.task, () =>
            calibrationTaskPort.finalizeIncrement(input),
          ),
      },
    }),
  );

  const riskAssessment = createPostgresRiskAssessmentEngine({
    db,
    transactionUnit,
    access,
    artifactStore,
    preparationContext: engineeringData,
    riskInputFacts,
    basisReader: basis,
    runtimePolicies: createAssessmentRuntimePolicyProviderV1(projects),
    monitoring: monitoringStore,
    authorizeDownstream,
    entryContext: createAssessmentEntryContextReadPort(engineeringData),
    runRead: workflowAdapter.runRead,
    entriesRead: workflowAdapter.entriesRead,
    recordCatalog: identificationRead,
  });

  const recommendation = createPostgresRecommendationAdapter({
    db,
    transactionUnit,
    access,
    artifactStore,
    reader: createPostgresRecommendationContextReader({
      db,
      artifactStore,
      basis,
      authorizeDownstream,
    }),
    policies: createRecommendationPolicyProviderV1(projects, siteContextReader),
    agentTasks,
    taskAuthorization,
    reviewAuthorization,
  });
  recommendationAdapterRef.current = recommendation;

  const responseLifecycle = createPostgresResponseLifecycleAdapter({
    db,
    transactionUnit,
    access,
    reader: createPostgresResponseLifecycleContextReader({
      db,
      artifactStore,
      basis,
      monitoring: monitoringStore,
      measureReleases: measureReleaseReader,
      authorizeDownstream,
    }),
    // C28 预测策略正文只在运行期受权读取；宿主不预装第二份策略集合。
    forecastExecutors: createProductionEffectForecastExecutorResolverV1({
      models: createEffectForecastModelReaderV1({ artifactStore }),
      assessment: riskAssessment,
      authorizeDownstream,
    }),
  });

  const calibration = createPostgresCalibrationAdapter({
    db,
    transactionUnit,
    access,
    deviationFacts: responseLifecycle,
    inputSnapshots: riskAssessment,
    basis,
    artifactStore,
    agentResults: agentTasks,
    reviews: review,
    governance: { govern: (command) => governance.govern(command) },
    authorizeDownstream,
  });

  const warning = createPostgresWarningLifecycleAdapter({
    db,
    transactionUnit,
    access,
    assessmentContext: new PostgresWarningAssessmentContextReader({ db }),
    runtimePolicies: createWarningRuntimePolicyProviderV1(projects),
    authorizeDownstream,
    recommendations: recommendation,
    routeDecisions,
    lifecycle: responseLifecycle,
    calibration,
  });

  const graph = createAssessmentGraphComposition({
    db,
    transactionUnit,
    artifactStore,
    authorization: access,
    runtimeAuthorization,
    checkpointer,
    engineeringData,
    basis,
    basisResolver: basis,
    runtimePolicies: createAssessmentRuntimePolicyProviderV1(projects),
    riskAssessment,
    warning,
    recommendation,
    recommendationAgent,
    responseLifecycle,
    calibration,
    calibrationAgent,
    policies,
    authorizeDownstream,
  });

  const result = {
    modelStep: createDeploymentResponseModelStepV1({
      authorizationScope,
      access,
      recommendation,
      responseLifecycle,
      calibrationTaskPort,
      persistArtifact,
      inner: options.innerModelStep,
    }),
    compositions: {
      riskAssessment,
      warning,
      recommendation,
      responseLifecycle,
      calibration,
      graph,
    },
    api: {
      riskAssessment,
      warningResponse: warning,
      warningResponseRead: warning,
      calibrationGovernance: calibration,
    },
    readers: {
      riskAssessment,
      agentTasks,
      siteContext: siteContextReader,
      warning: warning,
      calibration,
    },
    /** 五类 Agent 任务定义齐备才允许监听/claim：与识别组合共用同一 registry。 */
    assertReady() {
      registry.assertComplete();
      return result;
    },
  };
  return result;
};
