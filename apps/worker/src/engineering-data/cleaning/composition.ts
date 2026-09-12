import {
  PostgresAgentTaskAdapter,
  type PostgresAgentTaskAdapterOptions,
} from "@riskflow/adapters/agent-runtime";
import {
  createPostgresDataCleaningStore,
  type DataCleaningAgentTaskStartRequestV1,
  type PostgresDataCleaningStore,
  type PostgresDataCleaningStoreOptions,
} from "@riskflow/adapters/engineering-data/cleaning";
import {
  ACCESS_POLICY_REF_V1,
  AccessErrorV1Schema,
  AccessServiceError,
  type AuthorizationRequestV1,
} from "@riskflow/core/access";
import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  StartAgentTaskCommandV1Schema,
  type AuthorizationContextV1,
  type StartAgentTaskResultV1,
} from "@riskflow/contracts/ports";

const START_BRANCH = "agent-task.start-task" as const;
const START_CAPABILITY = "agent-task.start" as const;

/**
 * C06 认可的受信调用来源：请求作用域内的 `human-session`，或携带 C06 已签发父上下文与
 * 同一 causal run 的 `system` 调用。组合根不接受自造的 `AuthorizationContextV1`。
 */
export type DataCleaningStartAuthorizationSourceV1 =
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

export interface PostgresDataCleaningCompositionOptionsV1 {
  /** C15 store 选项；启动接缝由本工厂提供，因此这里不允许注入。 */
  readonly store: Omit<PostgresDataCleaningStoreOptions, "startAgentTask">;
  /** C08 adapter 的其余可选项；db/事务/工件/授权/registry 由本工厂从 store 选项组装。 */
  readonly agentTask?: Omit<
    PostgresAgentTaskAdapterOptions,
    "db" | "registry" | "transactionUnit" | "referenceGuard" | "authorization" | "artifactStore"
  >;
  /**
   * 服务端受信调用来源解析器。它只能返回 C06 已支持的调用来源，不得直接返回授权上下文，
   * 也不得复制冻结命令的 `engineering-data.freeze` 上下文。
   */
  readonly resolveStartAuthorizationInvocation: (
    request: DataCleaningAgentTaskStartRequestV1,
  ) => DataCleaningStartAuthorizationSourceV1 | Promise<DataCleaningStartAuthorizationSourceV1>;
}

export interface PostgresDataCleaningCompositionV1 {
  readonly store: PostgresDataCleaningStore;
  readonly agentTaskAdapter: PostgresAgentTaskAdapter;
  readonly registry: AgentTaskDefinitionRegistry;
  /** store 实际使用的启动接缝：经 C06 签发 `agent-task.start` 上下文后调用同一 C08 adapter。 */
  readonly startCleaningTask: (
    request: DataCleaningAgentTaskStartRequestV1,
  ) => Promise<StartAgentTaskResultV1>;
}

const startDenial = (stage: string): AccessServiceError =>
  new AccessServiceError(
    AccessErrorV1Schema.parse({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
      stage,
      occurredAt: new Date().toISOString(),
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "data-cleaning-start-authorization", versionId: "v1" },
      },
      contextRefs: [],
      requiredCapability: START_CAPABILITY,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    }),
  );

/**
 * C15 唯一生产组合根：组装清洗 store、C15 任务定义注册表与 C08 `PostgresAgentTaskAdapter`，
 * 让 store 提交的无授权启动草案经 C06 的 `agent-task.start-task` exact branch 取得唯一
 * `agent-task.start` 上下文，再由同一个注入 C06 verifier 的 adapter 创建任务。
 */
export const createPostgresDataCleaningComposition = (
  options: PostgresDataCleaningCompositionOptionsV1,
): PostgresDataCleaningCompositionV1 => {
  const storeOptions = options.store;
  const access = storeOptions.access;
  const registry = new AgentTaskDefinitionRegistry();
  const agentTaskAdapter = new PostgresAgentTaskAdapter({
    db: storeOptions.db,
    registry,
    transactionUnit: storeOptions.transactionUnit,
    artifactStore: storeOptions.artifactStore,
    referenceGuard: storeOptions.artifactReferenceGuard,
    authorization: access,
    ...options.agentTask,
  });

  const startCleaningTask = async (
    request: DataCleaningAgentTaskStartRequestV1,
  ): Promise<StartAgentTaskResultV1> => {
    const source = await options.resolveStartAuthorizationInvocation(request);
    const draft = request.command;
    // invocationId 固定为启动 commandId，使 C06 与 C08 的身份和范围复验对得上。
    const shared = {
      invocationId: draft.commandId,
      projectId: draft.projectId,
      branch: START_BRANCH,
      requestedSpatialScopeRefs: [...request.requestedSpatialScopeRefs],
      requestedSourceVersionRefs: [...request.requestedSourceVersionRefs],
      requestedAt: draft.issuedAt,
    };
    const authorizationRequest: AuthorizationRequestV1 =
      source.kind === "human-session"
        ? {
            ...shared,
            invocation: { kind: "human-session", sessionToken: source.sessionToken },
          }
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
    const decision = await access.authorize(authorizationRequest);
    const context = decision.context;
    if (
      context.actorId !== draft.actorId ||
      context.projectId !== draft.projectId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(START_CAPABILITY)
    ) {
      throw startDenial("data-cleaning.start-authorization.binding");
    }
    return agentTaskAdapter.startTask(
      StartAgentTaskCommandV1Schema.parse({ ...draft, authorization: context }),
    );
  };

  const store = createPostgresDataCleaningStore({
    ...storeOptions,
    startAgentTask: startCleaningTask,
  });
  registry.register(store.createTaskDefinition());
  return { store, agentTaskAdapter, registry, startCleaningTask };
};
