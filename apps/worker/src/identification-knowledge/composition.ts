import {
  PostgresAgentTaskAdapter,
  type PostgresAgentTaskAdapterOptions,
} from "@riskflow/adapters/agent-runtime";
import {
  PostgresIdentificationKnowledgeAdapter,
  PostgresIdentificationKnowledgeReleasePolicy,
  type IdentificationKnowledgeAuthorizationRequestV1,
  type IdentificationPreparationNarrowReadV1,
  type PostgresIdentificationKnowledgeAdapterOptionsV1,
} from "@riskflow/adapters/identification-knowledge";
import {
  PostgresKnowledgeGovernanceAdapter,
  type PostgresKnowledgeGovernanceAdapterOptionsV1,
} from "@riskflow/adapters/knowledge-governance";
import {
  ACCESS_POLICY_REF_V1,
  AccessErrorV1Schema,
  AccessServiceError,
  type AuthorizationRequestV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import {
  ArtifactPutCommandV1Schema,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  IdentificationKnowledgeValidationPolicyV1Schema,
  type IdentificationKnowledgeValidationPolicyV1,
  type IdentificationPolicySetProviderV1,
} from "@riskflow/core/identification-knowledge";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import type { PostgresDataCleaningStore } from "@riskflow/adapters/engineering-data/cleaning";
import type {
  EngineeringDataReadResolutionResultV1,
  ResolveEngineeringDataReadQueryV1,
} from "@riskflow/core/engineering-data/context-source";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import {
  ContentArtifactRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  type AuthorizationContextV1,
  type EngineeringDataQueryV1,
  type EngineeringDataReadResultV1,
  type KnowledgeGovernanceCommandV1,
  type ReviewAuditPortV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import {
  AgentRuntimeRunner,
  createAgentRuntimeRunner,
  type AgentRuntimeRunnerOptionsV1,
} from "../agent-runtime/index.js";
import {
  KnowledgeAuthoringRunner,
  withKnowledgeAuthoringModelStep,
  type KnowledgeAuthoringModelStepCallbacksV1,
} from "./runtime.js";

/**
 * C06 认可的受信调用来源：请求作用域的 `human-session`，或携带 C06 已签发父上下文与同一
 * causal run 的 `system` 调用。组合根不接受自造的 `AuthorizationContextV1`。
 */
export type IdentificationKnowledgeAuthorizationSourceV1 =
  | { readonly kind: "human-session"; readonly sessionToken: string }
  | {
      readonly kind: "system";
      readonly systemActorId: string;
      readonly reasonCode: string;
      readonly parentContext: AuthorizationContextV1;
      readonly causalRunRef: {
        readonly kind: "workflow-run";
        readonly reference: VersionReference;
      };
    };

export interface PostgresIdentificationKnowledgeCompositionOptionsV1 {
  readonly db: PostgresKnowledgeGovernanceAdapterOptionsV1["db"];
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  /** C15 公开精确准备窄读：生产组合必须复用该入口，不读上游私有表。 */
  readonly preparationRead: Pick<PostgresDataCleaningStore, "readExactPreparation">;
  /** C02 公共读取端口。 */
  readonly engineeringData: {
    read(query: EngineeringDataQueryV1): Promise<EngineeringDataReadResultV1>;
    resolveReadQuery(
      query: ResolveEngineeringDataReadQueryV1,
    ): Promise<EngineeringDataReadResolutionResultV1>;
  };
  /** C07 复核端口：C16 在其生命周期内转交人工复核。 */
  readonly reviewAudit: ReviewAuditPortV1;
  readonly validationPolicy: IdentificationKnowledgeValidationPolicyV1;
  /** C21/C24 拥有的精确识别策略提供者；缺失只阻断 identification-basis。 */
  readonly policySetProvider?: IdentificationPolicySetProviderV1;
  /**
   * 服务端受信调用来源解析器。它只能返回 C06 已支持的调用来源，不得直接返回授权上下文，
   * 也不得复制调用方命令的能力。
   */
  readonly resolveAuthorizationSource: (
    request: IdentificationKnowledgeAuthorizationRequestV1,
  ) =>
    | IdentificationKnowledgeAuthorizationSourceV1
    | Promise<IdentificationKnowledgeAuthorizationSourceV1>;
  /** C08 adapter 的其余可选项；db/事务/工件/授权/registry 由本工厂组装。 */
  readonly agentTask?: Omit<
    PostgresAgentTaskAdapterOptions,
    "db" | "registry" | "transactionUnit" | "referenceGuard" | "authorization" | "artifactStore"
  >;
  readonly now?: () => Date;
}

export interface PostgresIdentificationKnowledgeCompositionV1 {
  /** 生产组合只暴露 C17 façade，不暴露裸 C16 adapter。 */
  readonly adapter: PostgresIdentificationKnowledgeAdapter;
  readonly agentTaskAdapter: PostgresAgentTaskAdapter;
  readonly registry: AgentTaskDefinitionRegistry;
  /** 共享 runner 的 C17 模型步回调：其它任务类型必须由调用方注入 `inner`。 */
  readonly modelStep: KnowledgeAuthoringModelStepCallbacksV1;
  /** 用共享 C08 runner 组装编制运行封装；模型步与候选工件写入已由本工厂接好。 */
  createAuthoringRunner(
    options: Omit<
      AgentRuntimeRunnerOptionsV1,
      "registry" | "artifactStore" | "renderModelStep" | "interpretModelStep" | "persistArtifact"
    > & { readonly modelGateway?: ModelGatewayPortV1 },
  ): { readonly runner: KnowledgeAuthoringRunner; readonly shared: AgentRuntimeRunner };
}

const authorizationDenial = (stage: string, capability: string): AccessServiceError =>
  new AccessServiceError(
    AccessErrorV1Schema.parse({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
      stage,
      occurredAt: new Date().toISOString(),
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "identification-knowledge-authorization", versionId: "v1" },
      },
      contextRefs: [],
      requiredCapability: capability,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    }),
  );

/**
 * C17 唯一生产组合根：先以共享依赖构造 release policy 并注入 C16，再把同一个 C16 adapter
 * 注入 C17 façade，最后把 façade 的任务定义接入 C08 adapter 与共享 runner 回调。
 * 任一必需依赖缺失时工厂在构造阶段拒绝，不产生部分组合。
 */
export const createPostgresIdentificationKnowledgeComposition = (
  options: PostgresIdentificationKnowledgeCompositionOptionsV1,
): PostgresIdentificationKnowledgeCompositionV1 => {
  if (
    options.db === undefined ||
    options.transactionUnit === undefined ||
    options.access === undefined ||
    options.artifactStore === undefined ||
    options.artifactReferenceGuard === undefined ||
    options.preparationRead === undefined ||
    options.engineeringData === undefined ||
    options.reviewAudit === undefined ||
    options.validationPolicy === undefined ||
    options.resolveAuthorizationSource === undefined
  ) {
    throw new TypeError("identification knowledge composition requires every C03–C17 dependency");
  }
  const policy = IdentificationKnowledgeValidationPolicyV1Schema.parse(options.validationPolicy);
  const now = options.now ?? (() => new Date());
  const registry = new AgentTaskDefinitionRegistry();
  const holders: {
    governance?: PostgresKnowledgeGovernanceAdapter;
    taskAdapter?: PostgresAgentTaskAdapter;
  } = {};

  /** 只为 exact branch 签发内部控制台上下文；任何缺失或绑定不符都关闭失败。 */
  const authorize = async (
    request: IdentificationKnowledgeAuthorizationRequestV1,
  ): Promise<AuthorizationContextV1> => {
    const source = await options.resolveAuthorizationSource(request);
    const shared = {
      invocationId: request.invocationId,
      projectId: request.projectId,
      branch: request.branch,
      requestedSpatialScopeRefs: [...(request.requestedSpatialScopeRefs ?? [])],
      requestedSourceVersionRefs: [...(request.requestedSourceVersionRefs ?? [])],
      requestedAt: request.requestedAt,
    };
    const authorizationRequest: AuthorizationRequestV1 =
      source.kind === "human-session"
        ? { ...shared, invocation: { kind: "human-session", sessionToken: source.sessionToken } }
        : {
            ...shared,
            invocation: {
              kind: "system",
              systemActorId: source.systemActorId,
              reasonCode: source.reasonCode,
            },
            parentContext: source.parentContext,
            causalRunRef: source.causalRunRef,
          };
    const capability = MODULE_BRANCH_CAPABILITY_V1[request.branch];
    const decision = await options.access.authorize(authorizationRequest);
    const context = decision.context;
    const boundTaskRef =
      source.kind === "system" && source.parentContext.invocation.kind === "agent-task"
        ? source.parentContext.invocation.agentTaskRef
        : undefined;
    if (
      context.actorId !== request.actorId ||
      context.projectId !== request.projectId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(capability) ||
      (request.taskRef !== undefined &&
        boundTaskRef?.reference.entityId !== request.taskRef.reference.entityId)
    ) {
      throw authorizationDenial(
        `identification-knowledge.authorization.${request.branch}`,
        capability,
      );
    }
    return context;
  };

  const releasePolicy = new PostgresIdentificationKnowledgeReleasePolicy({
    db: options.db,
    artifactStore: options.artifactStore,
    governance: () => {
      if (holders.governance === undefined) {
        throw new TypeError("the C16 governance adapter is not constructed yet");
      }
      return holders.governance;
    },
    authorize,
  });

  const governance = new PostgresKnowledgeGovernanceAdapter({
    db: options.db,
    transactionUnit: options.transactionUnit,
    access: options.access,
    reviewAudit: options.reviewAudit,
    identificationKnowledgePolicy: releasePolicy,
    // C16→C07 的评审请求与批准证明各自使用组合根按调用身份签发的独立上下文。
    reviewAuthorization: (command: KnowledgeGovernanceCommandV1, link) =>
      authorize({
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: `${link.reviewAttemptId}:review`,
        branch: "review-audit.request-review",
        requestedAt: command.issuedAt,
      }),
    approvalAuthorization: (command: KnowledgeGovernanceCommandV1) =>
      authorize({
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: `${command.commandId}:approval`,
        branch: "review-audit.verify-knowledge-revision-approval",
        requestedAt: command.issuedAt,
      }),
    now,
  });
  holders.governance = governance;

  const narrowRead: IdentificationPreparationNarrowReadV1 = {
    preparationRead: options.preparationRead,
    engineeringData: options.engineeringData,
  };

  const agentTaskPort: NonNullable<
    PostgresIdentificationKnowledgeAdapterOptionsV1["agentTaskPort"]
  > = {
    startTask: async (command) => {
      if (holders.taskAdapter === undefined) {
        throw new TypeError("the C08 task adapter is not constructed yet");
      }
      return await holders.taskAdapter.startTask(command);
    },
    resumeTask: async () => {
      throw new TypeError("the C17 façade never resumes C08 tasks directly");
    },
    cancelTask: async () => {
      throw new TypeError("the C17 façade never cancels C08 tasks directly");
    },
    confirmCommand: async () => {
      throw new TypeError("the C17 façade never confirms C08 commands directly");
    },
  };

  const adapter = new PostgresIdentificationKnowledgeAdapter({
    db: options.db,
    transactionUnit: options.transactionUnit,
    access: options.access,
    artifactStore: options.artifactStore,
    artifactReferenceGuard: options.artifactReferenceGuard,
    governance,
    narrowRead,
    policy,
    ...(options.policySetProvider === undefined
      ? {}
      : { policySetProvider: options.policySetProvider }),
    agentTaskPort,
    agentTaskStore: {
      createTask: async () => {
        throw new TypeError("the C17 façade never creates C08 tasks directly");
      },
      getTask: async (ref) => {
        if (holders.taskAdapter === undefined) {
          throw new TypeError("the C08 task adapter is not constructed yet");
        }
        return (await holders.taskAdapter.getTask(ref)) as never;
      },
      resumeTask: async () => {
        throw new TypeError("the C17 façade never resumes C08 tasks directly");
      },
      cancelTask: async () => {
        throw new TypeError("the C17 façade never cancels C08 tasks directly");
      },
      confirmCommand: async () => {
        throw new TypeError("the C17 façade never confirms C08 commands directly");
      },
    },
    authorize,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const agentTaskAdapter = new PostgresAgentTaskAdapter({
    ...options.agentTask,
    db: options.db,
    registry,
    transactionUnit: options.transactionUnit,
    artifactStore: options.artifactStore,
    referenceGuard: options.artifactReferenceGuard,
    authorization: options.access,
  });
  holders.taskAdapter = agentTaskAdapter;
  registry.register(adapter.createTaskDefinition());

  const modelStep = withKnowledgeAuthoringModelStep({
    policy,
    persistArtifact: async ({ task, actionId, purposeCode, value }) => {
      const result = await options.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${actionId}:${purposeCode}`,
          idempotencyKey: `${actionId}:${purposeCode}`,
          projectId: task.envelope.projectId,
          actorId: task.envelope.actorId,
          issuedAt: task.envelope.createdAt,
          authorization: task.envelope.authorization,
          requiredCapability: task.envelope.authorization.grantedCapabilities[0],
          artifactId: `${actionId}:${purposeCode}`,
          artifactKind: "content",
          purposeCode,
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(JSON.stringify(value));
        })(),
      );
      return ContentArtifactRefV1Schema.parse(result.artifactRef);
    },
  });

  return {
    adapter,
    agentTaskAdapter,
    registry,
    modelStep,
    createAuthoringRunner: (runnerOptions) => {
      const shared = createAgentRuntimeRunner({
        ...runnerOptions,
        registry,
        artifactStore: options.artifactStore,
        renderModelStep: modelStep.renderModelStep,
        interpretModelStep: modelStep.interpretModelStep,
      });
      return {
        shared,
        runner: new KnowledgeAuthoringRunner({
          runner: shared,
          settleAuthoringFailures: () => adapter.settleAuthoringFailures(),
        }),
      };
    },
  };
};
