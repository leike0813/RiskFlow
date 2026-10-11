import { sql, type Kysely } from "kysely";
import { isDeepStrictEqual } from "node:util";

import type { AuthorizationContextV1, CommandCausalRefV1 } from "@riskflow/contracts/ports";
import type {
  AuthorizationDecisionV1,
  AuthorizationRequestV1,
  AuthorizationVerificationRequestV1,
} from "@riskflow/core/access";
import type { PostgresLocalIdentityAccess } from "./postgres-local-identity-access.js";
import {
  DeploymentDownstreamAuthorizationPolicyV1Schema,
  type DeploymentDownstreamAuthorizationPolicyV1,
} from "../deployment/policies.js";

/**
 * C37 D-20：受控的服务端跨能力授权适配。
 *
 * 跨能力调用在 HTTP 受理、任何业务副作用之前完成：用本次真实 sessionToken 分别为固定
 * 下游 branch 调用原 `authorize`，并把 rootContextRef 与各 contextRef 耐久关联。
 *
 * 不变量：
 * - 只签发固定流程所需分支，actor/project/空间/来源都不扩大；
 * - 一次拒绝即阻止受理；已签发但未关联的上下文不能用于执行；
 * - 令牌只存本次调用内存，不持久化；
 * - 后台复验时逐项 verify 当前权限，再用目标分支 parentContext 调原 system authorize，
 *   并保留 `isAuthorizationSubset` 判定；关联行本身不产生新权限。
 */

export const DEPLOYMENT_AUTHORIZATION_ERROR_V1 = {
  rootNotGranted: "DEPLOYMENT_AUTHORIZATION_ROOT_NOT_GRANTED",
  downstreamRejected: "DEPLOYMENT_AUTHORIZATION_DOWNSTREAM_REJECTED",
  notAssociated: "DEPLOYMENT_AUTHORIZATION_NOT_ASSOCIATED",
  currentVerificationFailed: "DEPLOYMENT_AUTHORIZATION_CURRENT_VERIFICATION_FAILED",
  notSubset: "DEPLOYMENT_AUTHORIZATION_NOT_SUBSET",
  policyRejected: "DEPLOYMENT_AUTHORIZATION_POLICY_REJECTED",
} as const;
export type DeploymentAuthorizationErrorCodeV1 =
  (typeof DEPLOYMENT_AUTHORIZATION_ERROR_V1)[keyof typeof DEPLOYMENT_AUTHORIZATION_ERROR_V1];

export class DeploymentAuthorizationError extends Error {
  readonly code: DeploymentAuthorizationErrorCodeV1;
  readonly branch: string;

  constructor(code: DeploymentAuthorizationErrorCodeV1, branch: string) {
    super(code);
    this.name = "DeploymentAuthorizationError";
    this.code = code;
    this.branch = branch;
  }
}

/** 关联行：只保存引用与签发事实，不保存 sessionToken 或上下文正文。 */
export interface DeploymentCausalAuthorizationRowV1 {
  readonly rootContextRef: { readonly entityId: string; readonly versionId: string };
  readonly projectId: string;
  readonly actorId: string;
  readonly branch: string;
  readonly childContextRef: { readonly entityId: string; readonly versionId: string };
  readonly invocationId: string;
  readonly policyRef: string;
}

export interface DeploymentCausalAuthorizationStoreV1 {
  recordMany(rows: readonly DeploymentCausalAuthorizationRowV1[]): Promise<void>;
  find(input: {
    readonly rootContextRef: { readonly entityId: string; readonly versionId: string };
    readonly projectId: string;
    readonly actorId: string;
    readonly branch: string;
  }): Promise<DeploymentCausalAuthorizationRowV1 | undefined>;
  /** 按目标 branch 读取本次因果链已签发的全部关联。 */
  listByRoot(input: {
    readonly rootContextRef: { readonly entityId: string; readonly versionId: string };
    readonly projectId: string;
  }): Promise<readonly DeploymentCausalAuthorizationRowV1[]>;
}

export interface DeploymentAuthorizationAdapterV1 {
  /**
   * 受理阶段：用真实会话为固定下游分支签发并耐久关联。
   * 任一分支拒绝即整体失败，不留下可执行的半成品关联。
   */
  issueDownstreamContexts(input: {
    readonly root: AuthorizationContextV1;
    readonly sessionToken: string;
    readonly invocationId: string;
    readonly branches: readonly string[];
    readonly requestedSpatialScopeRefs: AuthorizationContextV1["spatialScopeRefs"];
    readonly requestedSourceVersionRefs: AuthorizationRequestV1["requestedSourceVersionRefs"];
  }): Promise<readonly AuthorizationContextV1[]>;
  /**
   * 后台阶段：按目标 branch 取已关联上下文，逐项复验当前权限后返回。
   * 没有关联就失败——不能重构令牌，也不能借用其它用户或其它分支。
   */
  resolveDownstreamContext(input: {
    readonly root: AuthorizationContextV1;
    readonly branch: string;
    readonly invocationId: string;
    readonly requestedSpatialScopeRefs: AuthorizationContextV1["spatialScopeRefs"];
    readonly requestedSourceVersionRefs: AuthorizationRequestV1["requestedSourceVersionRefs"];
    readonly causalRunRef?: {
      readonly kind: "workflow-run";
      readonly reference: { entityId: string; versionId: string };
    };
    readonly causalCommandRef?: CommandCausalRefV1;
  }): Promise<AuthorizationContextV1>;
}

export interface DeploymentAuthorizationAdapterOptionsV1 {
  readonly db: Kysely<unknown>;
  readonly access: PostgresLocalIdentityAccess;
  readonly policy: DeploymentDownstreamAuthorizationPolicyV1;
  /** 读取已签发上下文正文的读面；只允许按 invocationId + branch 取回本次签发的结果。 */
  readonly issuedContextReader?: {
    read(input: {
      readonly invocationId: string;
      readonly branch: string;
      readonly projectId: string;
      readonly actorId: string;
    }): Promise<AuthorizationContextV1 | undefined>;
  };
  readonly now?: () => Date;
}

/** jsonb 列由驱动解析为对象；若为字符串再解析一次，兼容两种驱动形态。 */
const readJsonbRef = (value: unknown): { entityId: string; versionId: string } => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("causal authorization reference is not a valid reference");
  }
  const record = parsed as Record<string, unknown>;
  return { entityId: String(record.entityId), versionId: String(record.versionId) };
};

const rowFromDb = (row: Record<string, unknown>): DeploymentCausalAuthorizationRowV1 => ({
  rootContextRef: readJsonbRef(row.root_context_ref),
  projectId: String(row.project_id),
  actorId: String(row.actor_id),
  branch: String(row.branch),
  childContextRef: readJsonbRef(row.child_context_ref),
  invocationId: String(row.invocation_id),
  policyRef: String(row.policy_ref),
});

const refOf = (reference: { entityId: string; versionId: string }): string =>
  `${reference.entityId}/${reference.versionId}`;

export const createDeploymentAuthorizationAdapterV1 = (
  options: DeploymentAuthorizationAdapterOptionsV1,
): DeploymentAuthorizationAdapterV1 => {
  const now = options.now ?? (() => new Date());
  const policy = DeploymentDownstreamAuthorizationPolicyV1Schema.parse(options.policy);
  const bindings = new Map<string, readonly string[]>(
    policy.bindings.map((binding) => [binding.rootBranch, binding.downstreamBranches]),
  );
  const issuedContextReader = options.issuedContextReader ?? {
    read: (input: Parameters<PostgresLocalIdentityAccess["readIssuedContext"]>[0]) =>
      options.access.readIssuedContext(input),
  };

  const store: DeploymentCausalAuthorizationStoreV1 = {
    async recordMany(rows) {
      await options.db.transaction().execute(async (transaction) => {
        for (const row of rows) {
          await sql`INSERT INTO business.deployment_causal_authorizations
            (root_context_ref, project_id, actor_id, branch, child_context_ref, invocation_id,
             policy_ref, recorded_at)
            VALUES (${JSON.stringify(row.rootContextRef)}::jsonb, ${row.projectId}, ${row.actorId},
                    ${row.branch}, ${JSON.stringify(row.childContextRef)}::jsonb, ${row.invocationId},
                    ${row.policyRef}, ${now().toISOString()})
            ON CONFLICT (root_context_ref, project_id, actor_id, branch) DO NOTHING`.execute(
            transaction,
          );
          const existing = await sql<Record<string, unknown>>`
            SELECT * FROM business.deployment_causal_authorizations
            WHERE root_context_ref = ${JSON.stringify(row.rootContextRef)}::jsonb
              AND project_id = ${row.projectId} AND actor_id = ${row.actorId}
              AND branch = ${row.branch}`.execute(transaction);
          const persisted =
            existing.rows[0] === undefined ? undefined : rowFromDb(existing.rows[0]);
          if (
            persisted === undefined ||
            !samePlainRef(persisted.rootContextRef, row.rootContextRef) ||
            persisted.projectId !== row.projectId ||
            persisted.actorId !== row.actorId ||
            persisted.branch !== row.branch ||
            !samePlainRef(persisted.childContextRef, row.childContextRef) ||
            persisted.invocationId !== row.invocationId ||
            persisted.policyRef !== row.policyRef
          ) {
            throw new Error("deployment causal authorization conflict");
          }
        }
      });
    },
    async find(input) {
      const result = await sql<
        Record<string, unknown>
      >`SELECT * FROM business.deployment_causal_authorizations
        WHERE root_context_ref = ${JSON.stringify(input.rootContextRef)}::jsonb
          AND project_id = ${input.projectId} AND actor_id = ${input.actorId}
          AND branch = ${input.branch}
        LIMIT 1`.execute(options.db);
      return result.rows[0] === undefined ? undefined : rowFromDb(result.rows[0]);
    },
    async listByRoot(input) {
      const result = await sql<
        Record<string, unknown>
      >`SELECT * FROM business.deployment_causal_authorizations
        WHERE root_context_ref = ${JSON.stringify(input.rootContextRef)}::jsonb
          AND project_id = ${input.projectId}
        ORDER BY branch`.execute(options.db);
      return result.rows.map(rowFromDb);
    },
  };

  /**
   * 原 access 以抛错表示拒绝；这里把拒绝收敛成带 branch 的稳定类别，
   * 避免把内部错误细节或存在性差异透给上层。
   */
  const granting = async (
    branch: string,
    failureCode: DeploymentAuthorizationErrorCodeV1,
    call: () => Promise<AuthorizationDecisionV1>,
  ): Promise<AuthorizationDecisionV1> => {
    try {
      return await call();
    } catch (error) {
      if (isAccessError(error)) throw new DeploymentAuthorizationError(failureCode, branch);
      throw error;
    }
  };

  const rootSource = async (root: AuthorizationContextV1) => {
    const source = await options.access.readDeploymentAuthorizationSource({
      authorizationContextRef: root.authorizationContextRef,
      projectId: root.projectId,
      actorId: root.actorId,
    });
    if (source === undefined || !isDeepStrictEqual(source.context, root)) {
      throw new DeploymentAuthorizationError(
        DEPLOYMENT_AUTHORIZATION_ERROR_V1.rootNotGranted,
        "root",
      );
    }
    return source;
  };

  const requireAllowed = (rootBranch: string, branches: readonly string[], exact: boolean) => {
    const allowed = bindings.get(rootBranch);
    if (
      allowed === undefined ||
      new Set(branches).size !== branches.length ||
      (exact && branches.length !== allowed.length) ||
      !branches.every((branch) => allowed.includes(branch))
    ) {
      throw new DeploymentAuthorizationError(
        DEPLOYMENT_AUTHORIZATION_ERROR_V1.policyRejected,
        rootBranch,
      );
    }
  };

  return {
    async issueDownstreamContexts(input) {
      const source = await rootSource(input.root);
      requireAllowed(source.branch, input.branches, true);
      await granting(source.branch, DEPLOYMENT_AUTHORIZATION_ERROR_V1.rootNotGranted, () =>
        options.access.verify({
          authorizationContextRef: source.context.authorizationContextRef,
          invocationId: source.invocationId,
          projectId: source.context.projectId,
          branch: source.branch,
          requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
          requestedSourceVersionRefs: input.requestedSourceVersionRefs,
        }),
      );
      const issued: AuthorizationContextV1[] = [];
      const associations: DeploymentCausalAuthorizationRowV1[] = [];
      for (const branch of input.branches) {
        const decision = await granting(
          branch,
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.downstreamRejected,
          () =>
            options.access.authorize({
              invocationId: input.invocationId,
              projectId: input.root.projectId,
              branch,
              requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
              requestedSourceVersionRefs: input.requestedSourceVersionRefs,
              invocation: { kind: "human-session", sessionToken: input.sessionToken },
            } as AuthorizationRequestV1),
        );
        // 收窄方向固定：签发的上下文不得扩大原会话的工程、主体或资料范围。
        if (!isBranchNarrowing(input.root, decision.context)) {
          throw new DeploymentAuthorizationError(
            DEPLOYMENT_AUTHORIZATION_ERROR_V1.notSubset,
            branch,
          );
        }
        issued.push(decision.context);
        associations.push({
          rootContextRef: input.root.authorizationContextRef.reference,
          projectId: input.root.projectId,
          actorId: input.root.actorId,
          branch,
          childContextRef: decision.context.authorizationContextRef.reference,
          invocationId: input.invocationId,
          policyRef: refOf(policy.policyRef),
        });
      }
      await store.recordMany(associations);
      return Object.freeze(issued);
    },

    async resolveDownstreamContext(input) {
      if ((input.causalRunRef === undefined) === (input.causalCommandRef === undefined)) {
        throw new DeploymentAuthorizationError(
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.notAssociated,
          input.branch,
        );
      }
      let source = await rootSource(input.root);
      const visited = new Set<string>();
      let association: DeploymentCausalAuthorizationRowV1 | undefined;
      for (let depth = 0; depth < 32; depth += 1) {
        const reference = source.context.authorizationContextRef.reference;
        const key = refOf(reference);
        if (visited.has(key)) break;
        visited.add(key);
        association = await store.find({
          rootContextRef: reference,
          projectId: input.root.projectId,
          actorId: input.root.actorId,
          branch: input.branch,
        });
        if (association !== undefined) break;
        let parentContextRef = source.parentContextRef;
        if (parentContextRef === undefined) {
          const links = await sql<Record<string, unknown>>`
            SELECT root_context_ref FROM business.deployment_causal_authorizations
            WHERE child_context_ref::jsonb = ${JSON.stringify(reference)}::jsonb
              AND project_id = ${input.root.projectId} AND actor_id = ${input.root.actorId}
              AND policy_ref = ${refOf(policy.policyRef)}
            LIMIT 2`.execute(options.db);
          if (links.rows.length !== 1) break;
          parentContextRef = {
            kind: "authorization-context",
            reference: readJsonbRef(links.rows[0]!.root_context_ref),
          };
        }
        const parent = await options.access.readDeploymentAuthorizationSource({
          authorizationContextRef: parentContextRef,
          projectId: input.root.projectId,
          actorId: input.root.actorId,
        });
        if (parent === undefined) break;
        source = parent;
      }
      // 没有关联即失败：不得重构令牌，也不得借用其它用户或分支。
      if (association === undefined || association.policyRef !== refOf(policy.policyRef)) {
        throw new DeploymentAuthorizationError(
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.notAssociated,
          input.branch,
        );
      }
      requireAllowed(source.branch, [input.branch], false);
      if (
        input.causalCommandRef !== undefined &&
        (source.branch !== "knowledge-modeling.publish-approved-release" ||
          source.invocationId !== input.causalCommandRef.commandId ||
          !samePlainRef(
            source.context.authorizationContextRef.reference,
            input.causalCommandRef.authorizationContextRef.reference,
          ))
      )
        throw new DeploymentAuthorizationError(
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.notAssociated,
          input.branch,
        );
      const issuedContext = await issuedContextReader.read({
        invocationId: association.invocationId,
        branch: input.branch,
        projectId: input.root.projectId,
        actorId: input.root.actorId,
      });
      if (issuedContext === undefined) {
        throw new DeploymentAuthorizationError(
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.notAssociated,
          input.branch,
        );
      }
      if (
        !samePlainRef(
          issuedContext.authorizationContextRef.reference,
          association.childContextRef,
        ) ||
        issuedContext.projectId !== association.projectId ||
        issuedContext.actorId !== association.actorId
      ) {
        throw new DeploymentAuthorizationError(
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.notAssociated,
          input.branch,
        );
      }

      // 后台 action 使用自己的 invocationId；verify 仍绑定原签发 invocation。
      // 先按目标分支复验该分支已签发上下文的当前权限：原 C06 verify 要求
      // 被验上下文必须正是该 branch 的已登记上下文，因此不能拿 root 上下文代替。
      // 会话或权限失效时直接失败，不得据此扩大或重构任何上下文。
      await granting(
        input.branch,
        DEPLOYMENT_AUTHORIZATION_ERROR_V1.currentVerificationFailed,
        () =>
          options.access.verify({
            authorizationContextRef: issuedContext.authorizationContextRef,
            invocationId: association.invocationId,
            projectId: input.root.projectId,
            branch: input.branch,
            requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
            requestedSourceVersionRefs: input.requestedSourceVersionRefs,
          } as AuthorizationVerificationRequestV1),
      );

      // 再用该目标分支的 parentContext 调原 system authorize 并复验收窄关系。
      const decision = await granting(
        input.branch,
        DEPLOYMENT_AUTHORIZATION_ERROR_V1.downstreamRejected,
        () =>
          options.access.authorize({
            invocationId: input.invocationId,
            projectId: input.root.projectId,
            branch: input.branch,
            requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
            requestedSourceVersionRefs: input.requestedSourceVersionRefs,
            invocation: {
              kind: "system",
              systemActorId: input.root.actorId,
              reasonCode: "deployment-causal-branch-resolution",
            },
            parentContext: issuedContext,
            ...(input.causalRunRef === undefined
              ? { causalCommandRef: input.causalCommandRef }
              : { causalRunRef: input.causalRunRef }),
          } as AuthorizationRequestV1),
      );
      if (
        !isBranchNarrowing(issuedContext, decision.context) ||
        !isBranchNarrowing(input.root, decision.context)
      ) {
        throw new DeploymentAuthorizationError(
          DEPLOYMENT_AUTHORIZATION_ERROR_V1.notSubset,
          input.branch,
        );
      }
      return decision.context;
    },
  };
};

/**
 * C06 以抛错表示拒绝；据此判定是否为授权失败而非宿主/技术故障。
 */
const isAccessError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    readonly code?: unknown;
    readonly details?: { readonly code?: unknown };
  };
  const code = candidate.code ?? candidate.details?.code;
  return typeof code === "string" && code.startsWith("AUTH");
};

const samePlainRef = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

/**
 * 跨分支收窄判定。
 *
 * 不能直接用 `isAuthorizationSubset`：每个 branch 的 grantedCapabilities 由该分支决定，
 * 因此「子上下文能力 ⊆ 父上下文能力」在跨分支签发时本就不成立。
 * D-20 真正要求的不变量是：同一主体、同一工程、同一授权策略，
 * 且空间范围与资料授权不得扩大——能力由目标 branch 收窄签发。
 */
const isBranchNarrowing = (
  parent: AuthorizationContextV1,
  child: AuthorizationContextV1,
): boolean => {
  if (parent.projectId !== child.projectId || parent.actorId !== child.actorId) return false;
  if (!samePlainRef(parent.authorizationPolicyRef, child.authorizationPolicyRef)) return false;
  if (
    !child.spatialScopeRefs.every((scope) =>
      parent.spatialScopeRefs.some((item) => samePlainRef(item.reference, scope.reference)),
    )
  ) {
    return false;
  }
  return child.sourceAccessGrantRefs.every((grant) =>
    parent.sourceAccessGrantRefs.some((item) => samePlainRef(item.reference, grant.reference)),
  );
};

/** 供运维与调试核对关联图；只返回引用，不返回上下文正文。 */
export type DeploymentAuthorizationDecisionV1 = AuthorizationDecisionV1;
