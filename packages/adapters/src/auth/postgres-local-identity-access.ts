import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AgentTaskSnapshotV1 } from "@riskflow/core/agent-runtime";

import {
  ACCESS_POLICY_REF_V1,
  AccessCommandResultV1Schema,
  AccessErrorV1Schema,
  AccessServiceError,
  allSpatialScopesCovered,
  assertSpatialScopeTree,
  AuthorizationDecisionV1Schema,
  AuthorizationRequestV1Schema,
  AuthorizationVerificationRequestV1Schema,
  branchCapability,
  branchesForRoles,
  ChangePasswordCommandV1Schema,
  CanonicalLoginNameV1Schema,
  IdentityAdministrationCommandV1Schema,
  isAuthorizationSubset,
  isBranchAllowed,
  isRegisteredAccessPolicyVersion,
  LoginCommandV1Schema,
  LogoutCommandV1Schema,
  ModuleBranchV1Schema,
  PasswordV1Schema,
  ProjectAccessCommandV1Schema,
  ProjectAccessPresentationRequestV1Schema,
  capabilitiesForBranches,
  evaluateSourceAccess,
  projectionAccess,
  ReadSessionCommandV1Schema,
  SessionMetadataV1Schema,
  SessionResultV1Schema,
  SourceVersionRefSetV1Schema,
  SYSTEM_ACCESS_ACTIONS_V1,
  SYSTEM_ADMINISTRATION_PAGE_SIZE_DEFAULT_V1,
  SystemAdministrationCommandV1Schema,
  SystemAdministrationExecuteResultV1Schema,
  SystemAdministrationReadQueryV1Schema,
  SystemAdministrationReadResultV1Schema,
  type AccessCommandResultV1,
  type AccessErrorCodeV1,
  type AuthorizationDecisionV1,
  type AuthorizationRequestV1,
  type BusinessActionAuthorizationInputV1,
  type ChangePasswordCommandV1,
  type IdentityAdministrationCommandV1,
  type LoginCommandV1,
  type LogoutCommandV1,
  type ProjectAccessCommandV1,
  type ProjectAccessPresentationPortV1,
  type ProjectAccessPresentationRequestV1,
  type ReadSessionCommandV1,
  type SessionMetadataV1,
  type SessionResultV1,
  type SpatialScopeNodeV1,
  type SourceAccessPolicyV1,
  type SystemAdministrationCommandV1,
  type SystemAdministrationExecuteResultV1,
  type SystemAdministrationPortV1,
  type SystemAdministrationReadQueryV1,
  type SystemAdministrationReadResultPayloadV1,
  type SystemAdministrationReadResultV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  sha256CanonicalJson,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
} from "@riskflow/core/persistence";
import {
  AuthorizationContextV1Schema,
  ModuleCapabilityV1Schema,
  ProjectAccessPresentationV1Schema,
  type ProjectAccessPresentationV1,
  type AuthorizationContextV1,
  type AgentTaskRefV1,
  type AuthorizationContextRefV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type SourceAccessGrantRefV1,
  type SourceVersionRefV1,
  SourceVersionRefV1Schema,
  SourceAccessGrantRefV1Schema,
  type SpatialScopeRefV1,
  type WorkflowRunRefV1,
  WorkflowRunRefV1Schema,
  CommandCausalRefV1Schema,
  type CommandCausalRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";

import {
  createPostgresRuntime,
  makePersistenceError,
  mapPostgresError,
  type PostgresConnectionConfig,
} from "../postgres/pool.js";
import { getPostgresTransaction, PostgresTransactionUnit } from "../postgres/transaction-unit.js";
import type {
  AccessDb,
  AccessPostgresDatabase,
  AccessProjectRow,
  AccessSpatialScopeRevisionRow,
  AuthorizationContextRow,
  LocalAccountRow,
  LocalCredentialRow,
  LocalSessionRow,
  SecurityAuditEventRow,
} from "./postgres-types.js";
import {
  createSessionToken,
  decodeAndVerifySessionToken,
  derivePassword,
  DUMMY_PASSWORD,
  encodeSessionToken,
  makeDummyCredential,
  sessionTokenSha256,
  type RandomBytes,
  type SessionTokenKeyV1,
  validatePassword,
  verifyPassword,
} from "./crypto.js";

const SYSTEM_NAMESPACE = "riskflow-system";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const CONTEXT_TTL_MS = 5 * 60 * 1000;
// D-20 来源读取的有界上限：签发快照里的来源版本引用逐项校验，不截断后宣称覆盖完整。
const DEPLOYMENT_SOURCE_VERSION_REF_LIMIT = 256;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

type AccessTransaction = Transaction<AccessPostgresDatabase>;

export interface LocalIdentityAccessConfig extends PostgresConnectionConfig {
  readonly registeredTaskReader?: (
    taskRef: AgentTaskRefV1,
  ) => Promise<AgentTaskSnapshotV1 | undefined>;
  readonly hmacKey: Uint8Array;
  readonly keyVersion: string;
  readonly now?: () => Date;
  readonly randomBytes?: RandomBytes;
}

export interface BootstrapInitialSystemAdministratorConfig {
  readonly connection: PostgresConnectionConfig;
  readonly loginName: string;
  readonly displayName: string;
  readonly password: string;
  readonly accountId?: string;
  readonly now?: () => Date;
  readonly randomBytes?: RandomBytes;
}

type WithoutAuthorizationContextRef<T> = T extends unknown
  ? Omit<T, "authorizationContextRef">
  : never;

export type DeploymentProjectAccessCommandV1 =
  WithoutAuthorizationContextRef<ProjectAccessCommandV1>;

const [
  openProjectCommandSchema,
  suspendProjectCommandSchema,
  reviseMembershipCommandSchema,
  createSpatialScopeCommandSchema,
  reviseSpatialScopeCommandSchema,
  reviseSourceAccessCommandSchema,
] = ProjectAccessCommandV1Schema.options;
const deploymentProjectAccessCommandSchema = z.discriminatedUnion("kind", [
  openProjectCommandSchema.omit({ authorizationContextRef: true }),
  suspendProjectCommandSchema.omit({ authorizationContextRef: true }),
  reviseMembershipCommandSchema.omit({ authorizationContextRef: true }),
  createSpatialScopeCommandSchema.omit({ authorizationContextRef: true }),
  reviseSpatialScopeCommandSchema.omit({ authorizationContextRef: true }),
  reviseSourceAccessCommandSchema.omit({ authorizationContextRef: true }),
]);

/**
 * C06 适配器：原 LocalIdentityAccessV1 与独立系统管理面并列挂在同一个对象上。
 *
 * 系统管理面由同一个适配器实现，因此共用同一连接、同一时钟与同一 C06 事务语义；
 * 它不改变 LocalIdentityAccessV1 的任何方法语义，上层 mock 也无需实现它。
 */
export interface PostgresLocalIdentityAccess extends LocalIdentityAccessV1 {
  authorizeBusinessAction(
    input: BusinessActionAuthorizationInputV1,
  ): Promise<AuthorizationDecisionV1>;
  close(): Promise<void>;
  executeDeploymentProjectAccess(input: {
    readonly sessionToken: string;
    readonly command: DeploymentProjectAccessCommandV1;
  }): Promise<AccessCommandResultV1>;
  readIssuedContext(input: {
    readonly invocationId: string;
    readonly branch: string;
    readonly projectId: string;
    readonly actorId: string;
  }): Promise<AuthorizationContextV1 | undefined>;
  readDeploymentAuthorizationSource(input: {
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly projectId: string;
    readonly actorId?: string;
  }): Promise<DeploymentAuthorizationSourceV1 | undefined>;
  verifyDeploymentContext(input: {
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly requiredCapability: ModuleCapabilityV1;
    readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs: readonly SourceVersionRefV1[];
    readonly requestedSourceAccessGrantRefs?: readonly SourceAccessGrantRefV1[];
    readonly requestedAt: string;
  }): Promise<AuthorizationDecisionV1>;
  readonly systemAdministration: SystemAdministrationPortV1;
  /**
   * CH-2（design D-07）：当前工程入口能力读取的独立注入位。
   *
   * 刻意不加进 LocalIdentityAccessV1：既有实现与全部 mock 都不必为入口读取补假方法，
   * 缺真实实现时部署装配直接拒绝，而不是降级为空能力。
   */
  readonly projectAccessPresentation: ProjectAccessPresentationPortV1;
}

/**
 * C37 D-20：已签发业务上下文的真实来源快照。
 *
 * 只按精确引用读回原签发事实——原 invocationId、branch、父上下文引用、原因果运行引用
 * 与签发时的来源版本引用集合。读取不签发、不续期，也不替代当前 verify：当前权限由
 * 调用方单独用 verifyDeploymentContext 复验。不存在、管理上下文或绑定不符一律 undefined，
 * 数据库故障原样抛出。
 */
export interface DeploymentAuthorizationSourceV1 {
  readonly context: AuthorizationContextV1;
  readonly invocationId: string;
  readonly branch: ModuleBranchV1;
  readonly parentContextRef: AuthorizationContextRefV1 | undefined;
  readonly causalRunRef: WorkflowRunRefV1 | undefined;
  readonly causalCommandRef: CommandCausalRefV1 | undefined;
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
}

const jsonValue = (value: unknown): JsonValue => value as JsonValue;

const asAccessDb = (db: Kysely<import("../postgres/types.js").PostgresDatabase>): AccessDb =>
  db as unknown as AccessDb;
const asAccessTransaction = (context: TransactionContextV1): AccessTransaction =>
  getPostgresTransaction(context) as unknown as AccessTransaction;

const nowDate = (clock: () => Date): Date => {
  const value = clock();
  if (Number.isNaN(value.getTime())) throw new TypeError("clock returned an invalid date");
  return new Date(value.getTime());
};

const iso = (date: Date): string => date.toISOString();
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const ref = (entityId: string, versionId: string): VersionReference => ({ entityId, versionId });
const contextRef = (entityId: string, versionId = "1"): AuthorizationContextRefV1 => ({
  kind: "authorization-context",
  reference: ref(entityId, versionId),
});
const scopeRef = (scopeId: string, revisionId: string): SpatialScopeRefV1 => ({
  kind: "spatial-scope",
  reference: ref(scopeId, revisionId),
});
const sourceGrantRef = (grantId: string, revisionId: string): SourceAccessGrantRefV1 => ({
  kind: "source-access-grant",
  reference: ref(grantId, revisionId),
});
const projectRef = (projectId: string, versionId: string): ContractReferenceV1 => ({
  kind: "project-revision",
  reference: ref(projectId, versionId),
});
const targetRef = (entityId: string, versionId: string): ContractReferenceV1 => ({
  kind: "authorization-context",
  reference: ref(entityId, versionId),
});

const makeDiagnosticRef = (code: AccessErrorCodeV1): ContractReferenceV1 => ({
  kind: "diagnostic-artifact",
  reference: ref(`access-${code.toLowerCase()}`, "v1"),
});

const makeAccessError = (
  code: AccessErrorCodeV1,
  stage: string,
  clock: () => Date,
  extras: Record<string, unknown> = {},
): AccessServiceError => {
  const details = {
    code,
    retryable: code === "ACCESS_TRANSIENT_FAILURE",
    stage,
    occurredAt: iso(nowDate(clock)),
    diagnosticRef: makeDiagnosticRef(code),
    contextRefs: [],
    ...(code === "AUTHORIZATION_DENIED"
      ? {
          requiredCapability: branchCapability("projection.query"),
          authorizationPolicyRef: ACCESS_POLICY_REF_V1,
        }
      : {}),
    ...(code === "STALE_ACCESS_VERSION" ? { targetRef: targetRef("access-version", "1") } : {}),
    ...(code === "IDEMPOTENCY_CONFLICT"
      ? { idempotencyKey: "unknown", priorCommandId: "unknown" }
      : {}),
    ...(code === "ACCESS_TRANSIENT_FAILURE" ? { attempt: 1 } : {}),
    ...extras,
  };
  return new AccessServiceError(AccessErrorV1Schema.parse(details));
};

const asAccessError = (error: unknown, stage: string, clock: () => Date): AccessServiceError => {
  if (error instanceof AccessServiceError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "accessError" in error &&
    (error as { accessError?: unknown }).accessError instanceof AccessServiceError
  ) {
    return (error as { accessError: AccessServiceError }).accessError;
  }
  const mapped = mapPostgresError(error, stage);
  if (mapped.code === "IDEMPOTENCY_CONFLICT") {
    return makeAccessError("IDEMPOTENCY_CONFLICT", stage, clock);
  }
  return makeAccessError(
    mapped.retryable ? "ACCESS_TRANSIENT_FAILURE" : "ACCESS_TERMINAL_FAILURE",
    stage,
    clock,
  );
};

const canonicalLoginName = (loginName: string): string => {
  const canonical = loginName.trim().toLowerCase();
  if (!CanonicalLoginNameV1Schema.safeParse(canonical).success) {
    throw new TypeError("login name is not canonical");
  }
  return canonical;
};

const expectedVersionNumber = (value: unknown): number | undefined => {
  if (value === "none") return 0;
  const parsed = VersionReferenceSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const number = Number(parsed.data.versionId);
  return Number.isSafeInteger(number) && number > 0 && String(number) === parsed.data.versionId
    ? number
    : undefined;
};

const expectedVersionMatches = (value: unknown, entityId: string, current: number): boolean => {
  if (value === "none") return current === 0;
  const parsed = VersionReferenceSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.entityId === entityId &&
    expectedVersionNumber(parsed.data) === current
  );
};

const accessResult = (
  kind: AccessCommandResultV1["kind"],
  entityId: string,
  versionId: string,
  references: readonly VersionReference[] = [],
): AccessCommandResultV1 =>
  AccessCommandResultV1Schema.parse({
    kind,
    resultRef: ref(entityId, versionId),
    references: [ref(entityId, versionId), ...references],
  });

const c02ResultRef = (entityId: string, versionId: string): ContractReferenceV1 =>
  contextRef(entityId, versionId);

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const accountRevisionRef = (accountId: string, version: number): VersionReference =>
  ref(accountId, String(version));

/**
 * 会话元数据：会话与账号引用、到期时间、首次改密限制与受限标志的唯一投影。
 * 自省只回报它；登录结果在它之上追加 token 与管理上下文，两处不各写一套字段计算。
 */
const sessionMetadata = (
  session: LocalSessionRow,
  passwordChangeRequired: boolean,
  restricted: boolean,
): SessionMetadataV1 =>
  SessionMetadataV1Schema.parse({
    sessionRef: ref(session.session_id, "1"),
    accountRef: ref(session.account_id, String(session.credential_version)),
    passwordChangeRequired,
    restricted,
    expiresAt: iso(
      new Date(
        Math.min(
          asDate(session.idle_expires_at).getTime(),
          asDate(session.absolute_expires_at).getTime(),
        ),
      ),
    ),
  });

const sessionResult = (
  session: LocalSessionRow,
  token: string,
  passwordChangeRequired: boolean,
  restricted: boolean,
  systemAdministrationContextRef?: AuthorizationContextRefV1,
): SessionResultV1 =>
  SessionResultV1Schema.parse({
    ...sessionMetadata(session, passwordChangeRequired, restricted),
    sessionToken: token,
    ...(systemAdministrationContextRef === undefined ? {} : { systemAdministrationContextRef }),
  });

const loginFingerprint = (canonical: string, key: Uint8Array): string =>
  createHmac("sha256", key).update(canonical, "utf8").digest("hex");

const queryAccount = async (
  db: AccessDb,
  accountId: string,
  forUpdate = false,
): Promise<LocalAccountRow | undefined> => {
  const query = db
    .selectFrom("business.local_accounts")
    .selectAll()
    .where("account_id", "=", accountId);
  return (await (forUpdate ? query.forUpdate() : query).executeTakeFirst()) as
    LocalAccountRow | undefined;
};

const queryAccountByLogin = async (
  db: AccessDb,
  loginName: string,
  forUpdate = false,
): Promise<LocalAccountRow | undefined> => {
  const query = db
    .selectFrom("business.local_accounts")
    .selectAll()
    .where("login_name", "=", loginName);
  return (await (forUpdate ? query.forUpdate() : query).executeTakeFirst()) as
    LocalAccountRow | undefined;
};

const queryCredential = async (
  db: AccessDb,
  account: LocalAccountRow,
): Promise<LocalCredentialRow | undefined> =>
  db
    .selectFrom("business.local_credentials")
    .selectAll()
    .where("account_id", "=", account.account_id)
    .where("credential_version", "=", account.current_credential_version)
    .executeTakeFirst();

const querySession = async (
  db: AccessDb,
  sessionId: string,
  forUpdate = false,
): Promise<LocalSessionRow | undefined> => {
  const query = db
    .selectFrom("business.local_sessions")
    .selectAll()
    .where("session_id", "=", sessionId);
  return (forUpdate ? query.forUpdate() : query).executeTakeFirst();
};

const queryProject = async (
  db: AccessDb,
  projectId: string,
  forUpdate = false,
): Promise<AccessProjectRow | undefined> => {
  const query = db
    .selectFrom("business.access_projects")
    .selectAll()
    .where("project_id", "=", projectId);
  return (forUpdate ? query.forUpdate() : query).executeTakeFirst();
};

const queryCurrentScopeRevisions = async (
  db: AccessDb,
  projectId: string,
): Promise<AccessSpatialScopeRevisionRow[]> => {
  const identities = await db
    .selectFrom("business.access_spatial_scopes")
    .select(["scope_id", "current_revision_id"])
    .where("project_id", "=", projectId)
    .execute();
  const revisionIds = identities.map((item) => item.current_revision_id);
  if (revisionIds.length === 0) return [];
  return db
    .selectFrom("business.access_spatial_scope_revisions")
    .selectAll()
    .where("revision_id", "in", revisionIds)
    .execute();
};

const scopeNodes = async (db: AccessDb, projectId: string): Promise<SpatialScopeNodeV1[]> => {
  const revisions = await queryCurrentScopeRevisions(db, projectId);
  return revisions.map((revision) => ({
    projectId: revision.project_id,
    scopeId: revision.scope_id,
    revisionId: revision.revision_id,
    ...(revision.parent_scope_id === null ? {} : { parentScopeId: revision.parent_scope_id }),
    status: revision.status,
  }));
};

interface MembershipSnapshot {
  readonly membershipId: string;
  readonly revisionId: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly revisionNo: number;
  readonly status: "active" | "removed";
  readonly roles: readonly import("@riskflow/core/access").PresetRoleV1[];
  readonly scopeIds: readonly string[];
}

const queryMembership = async (
  db: AccessDb,
  projectId: string,
  accountId: string,
  forUpdate = false,
): Promise<MembershipSnapshot | undefined> => {
  const membershipQuery = db
    .selectFrom("business.project_memberships")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("account_id", "=", accountId);
  const membership = await (
    forUpdate ? membershipQuery.forUpdate() : membershipQuery
  ).executeTakeFirst();
  if (membership === undefined) return undefined;
  const revisionQuery = db
    .selectFrom("business.project_membership_revisions")
    .selectAll()
    .where("revision_id", "=", membership.current_revision_id);
  const revision = await revisionQuery.executeTakeFirst();
  if (revision === undefined) return undefined;
  if (
    revision.membership_id !== membership.membership_id ||
    revision.project_id !== membership.project_id ||
    revision.account_id !== membership.account_id
  )
    return undefined;
  const [roles, scopes] = await Promise.all([
    db
      .selectFrom("business.project_membership_revision_roles")
      .select("role")
      .where("revision_id", "=", revision.revision_id)
      .execute(),
    db
      .selectFrom("business.project_membership_revision_scopes")
      .select("scope_id")
      .where("revision_id", "=", revision.revision_id)
      .execute(),
  ]);
  return {
    membershipId: membership.membership_id,
    revisionId: revision.revision_id,
    accountId: revision.account_id,
    projectId: revision.project_id,
    revisionNo: revision.revision_no,
    status: revision.status,
    roles: roles.map((role) => role.role) as MembershipSnapshot["roles"],
    scopeIds: scopes.map((scope) => scope.scope_id),
  };
};

const currentScopeRefsForMembership = (
  membership: MembershipSnapshot,
  revisions: readonly AccessSpatialScopeRevisionRow[],
): SpatialScopeRefV1[] => {
  const byScope = new Map(revisions.map((revision) => [revision.scope_id, revision]));
  return membership.scopeIds.flatMap((scopeId) => {
    const revision = byScope.get(scopeId);
    return revision === undefined || revision.status !== "active"
      ? []
      : [scopeRef(revision.scope_id, revision.revision_id)];
  });
};

const sourceVersionsForAccessGrants = async (
  db: AccessDb,
  input: Pick<
    BusinessActionAuthorizationInputV1,
    "projectId" | "requestedSourceVersionRefs" | "requestedSourceAccessGrantRefs"
  >,
  clock: () => Date,
): Promise<readonly SourceVersionRefV1[]> => {
  const grants = input.requestedSourceAccessGrantRefs ?? [];
  if (grants.length === 0) return input.requestedSourceVersionRefs;
  const ids = [...new Set(grants.map((grant) => grant.reference.entityId))];
  const policies = await db
    .selectFrom("business.source_access_policies")
    .select(["source_entity_id", "source_version_id"])
    .where("project_id", "=", input.projectId)
    .where("source_access_grant_id", "in", ids)
    .execute();
  if (policies.length !== ids.length)
    throw makeAccessError("AUTHORIZATION_DENIED", "authorize.artifact-sources", clock);
  return SourceVersionRefSetV1Schema.parse([
    ...new Map(
      [
        ...input.requestedSourceVersionRefs,
        ...policies.map((policy) => ({
          kind: "source-version" as const,
          reference: { entityId: policy.source_entity_id, versionId: policy.source_version_id },
        })),
      ].map((source) => [JSON.stringify(source.reference), source]),
    ).values(),
  ]);
};

const querySourcePolicy = async (
  db: AccessDb,
  projectId: string,
  sourceVersionRef: SourceVersionRefV1,
  rootScopeRef: SpatialScopeRefV1,
  currentScopes: readonly AccessSpatialScopeRevisionRow[] = [],
): Promise<SourceAccessPolicyV1 | undefined> => {
  const policy = await db
    .selectFrom("business.source_access_policies")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("source_entity_id", "=", sourceVersionRef.reference.entityId)
    .where("source_version_id", "=", sourceVersionRef.reference.versionId)
    .executeTakeFirst();
  if (policy === undefined) return undefined;
  const revision = await db
    .selectFrom("business.source_access_policy_revisions")
    .selectAll()
    .where("revision_id", "=", policy.current_revision_id)
    .executeTakeFirst();
  if (revision === undefined) return undefined;
  const [accounts, scopes] = await Promise.all([
    db
      .selectFrom("business.source_access_policy_revision_accounts")
      .select("account_id")
      .where("revision_id", "=", revision.revision_id)
      .execute(),
    db
      .selectFrom("business.source_access_policy_revision_scopes")
      .select("scope_id")
      .where("revision_id", "=", revision.revision_id)
      .execute(),
  ]);
  const currentScopeById = new Map(currentScopes.map((item) => [item.scope_id, item]));
  if (scopes.some((item) => !currentScopeById.has(item.scope_id))) return undefined;
  return {
    projectId,
    sourceVersionRef,
    revisionRef: sourceGrantRef(policy.source_access_grant_id, revision.revision_id),
    visibility: revision.visibility,
    allowedAccountIds: accounts.map((account) => account.account_id),
    spatialScopeRefs:
      scopes.length === 0
        ? [rootScopeRef]
        : scopes.flatMap((scope) => {
            const revision = currentScopeById.get(scope.scope_id);
            return revision === undefined ? [] : [scopeRef(scope.scope_id, revision.revision_id)];
          }),
  };
};

const appendSecurityAudit = async (
  db: AccessDb,
  details: Omit<SecurityAuditEventRow, "recorded_at"> & { recorded_at?: Date },
): Promise<void> => {
  await db
    .insertInto("business.security_audit_events")
    .values({
      event_id: details.event_id,
      event_kind: details.event_kind,
      outcome: details.outcome,
      reason_code: details.reason_code,
      subject_ref: details.subject_ref,
      project_ref: details.project_ref,
      request_ref: details.request_ref,
      policy_ref: details.policy_ref,
      context_ref: details.context_ref,
      diagnostic_ref: details.diagnostic_ref,
      occurred_at: details.occurred_at,
      recorded_at: (details.recorded_at ?? sql`clock_timestamp()`) as never,
    })
    .execute();
};

const securityAudit = (
  eventKind: string,
  outcome: "success" | "rejected" | "failure",
  reasonCode: string,
  occurredAt: Date,
  details: Partial<
    Pick<
      SecurityAuditEventRow,
      | "subject_ref"
      | "project_ref"
      | "request_ref"
      | "policy_ref"
      | "context_ref"
      | "diagnostic_ref"
    >
  > = {},
): Omit<SecurityAuditEventRow, "recorded_at"> => ({
  event_id: randomId("security"),
  event_kind: eventKind,
  outcome,
  reason_code: reasonCode,
  subject_ref: details.subject_ref ?? null,
  project_ref: details.project_ref ?? null,
  request_ref: details.request_ref ?? null,
  policy_ref: details.policy_ref ?? null,
  context_ref: details.context_ref ?? null,
  diagnostic_ref: details.diagnostic_ref ?? null,
  occurred_at: occurredAt,
});

interface StoredContext {
  readonly row: AuthorizationContextRow;
  readonly context?: AuthorizationContextV1;
}

const loadStoredContext = async (
  db: AccessDb,
  authorizationContextRef: AuthorizationContextRefV1,
): Promise<StoredContext | undefined> => {
  const row = await db
    .selectFrom("business.authorization_contexts")
    .selectAll()
    .where("context_id", "=", authorizationContextRef.reference.entityId)
    .where("version_id", "=", authorizationContextRef.reference.versionId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  if (row.context_kind === "system-administration") return { row };
  if (row.context_json === null) return { row };
  const parsed = AuthorizationContextV1Schema.safeParse(row.context_json);
  return parsed.success ? { row, context: parsed.data } : { row };
};

const assertActiveAccount = (
  account: LocalAccountRow | undefined,
  stage: string,
  clock: () => Date,
): LocalAccountRow => {
  if (account === undefined || account.status !== "active") {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  return account;
};

const isSystemAdministrator = (account: LocalAccountRow | undefined): boolean =>
  account !== undefined && (account.system_administrator as unknown as boolean) === true;

const currentAdminActor = async (
  db: AccessDb,
  authorizationContextRef: AuthorizationContextRefV1,
  stage: string,
  clock: () => Date,
): Promise<string> => {
  const stored = await loadStoredContext(db, authorizationContextRef);
  if (stored === undefined) throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  const account = await queryAccount(db, stored.row.actor_id);
  if (
    stored.row.context_kind !== "system-administration" ||
    stored.row.project_id !== SYSTEM_NAMESPACE ||
    stored.row.branch !== "access-administration" ||
    stored.row.context_json !== null ||
    !isSystemAdministrator(account)
  ) {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  const activeAccount = assertActiveAccount(account, stage, clock);
  if (activeAccount.password_change_required) {
    throw makeAccessError("PASSWORD_CHANGE_REQUIRED", stage, clock);
  }
  const snapshot = stored.row.revision_snapshot;
  if (
    typeof snapshot === "object" &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    "accountSecurityVersion" in snapshot &&
    snapshot.accountSecurityVersion !== activeAccount.security_version
  ) {
    throw makeAccessError("SESSION_REVOKED", stage, clock);
  }
  if (asDate(stored.row.expires_at).getTime() <= nowDate(clock).getTime()) {
    throw makeAccessError("SESSION_EXPIRED", stage, clock);
  }
  return activeAccount.account_id;
};

const currentProjectManagerActor = async (
  db: AccessDb,
  authorizationContextRef: AuthorizationContextRefV1,
  projectId: string,
  branch: ModuleBranchV1,
  stage: string,
  clock: () => Date,
): Promise<string> => {
  const stored = await loadStoredContext(db, authorizationContextRef);
  if (stored === undefined || stored.context === undefined) {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  if (stored.context.projectId !== projectId || stored.context.actorId !== stored.row.actor_id) {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  // CH-2（design D-06）：已登记的 v1/v2 策略身份都用于恢复旧快照的主体与范围，
  // 未知策略身份拒绝；放行与否仍取决于下方当前账号、当前成员与 isBranchAllowed。
  if (
    stored.row.branch !== branch ||
    !isRegisteredAccessPolicyVersion(stored.context.authorizationPolicyRef.versionId) ||
    stored.context.authorizationPolicyRef.entityId !== ACCESS_POLICY_REF_V1.entityId ||
    !stored.context.grantedCapabilities.includes(branchCapability(branch))
  ) {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  if (asDate(stored.row.expires_at).getTime() <= nowDate(clock).getTime()) {
    throw makeAccessError("SESSION_EXPIRED", stage, clock);
  }
  ModuleBranchV1Schema.parse(branch);
  const account = assertActiveAccount(await queryAccount(db, stored.context.actorId), stage, clock);
  const project = await queryProject(db, projectId);
  if (project === undefined || project.status !== "active") {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  const membership = await queryMembership(db, projectId, account.account_id);
  if (
    membership === undefined ||
    membership.status !== "active" ||
    !membership.roles.includes("project-risk-manager") ||
    !isBranchAllowed(membership.roles, branch)
  ) {
    throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
  }
  return account.account_id;
};

const adminActorForProjectCommand = async (
  db: AccessDb,
  command: ProjectAccessCommandV1,
  clock: () => Date,
): Promise<string> => {
  if (command.kind === "open-project" || command.kind === "suspend-project") {
    return currentAdminActor(db, command.authorizationContextRef, `project.${command.kind}`, clock);
  }
  if (command.kind === "revise-membership") {
    const stored = await loadStoredContext(db, command.authorizationContextRef);
    if (stored?.row.context_kind === "system-administration") {
      return currentAdminActor(
        db,
        command.authorizationContextRef,
        `project.${command.kind}`,
        clock,
      );
    }
  }
  return currentProjectManagerActor(
    db,
    command.authorizationContextRef,
    command.projectId,
    "engineering-data.register-source-delivery",
    `project.${command.kind}`,
    clock,
  );
};

const atomicCommand = (
  command: IdentityAdministrationCommandV1 | ProjectAccessCommandV1,
  actorRef: string,
  projectId: string,
  payload: JsonValue,
) => ({
  projectId,
  commandKind: `access.${command.kind}`,
  commandId: command.commandId,
  idempotencyKey: command.idempotencyKey,
  payload: jsonValue(payload) as Record<string, JsonValue>,
  actorRef,
  authorizationContextRef: command.authorizationContextRef,
});

const commitFor = (
  command: IdentityAdministrationCommandV1 | ProjectAccessCommandV1,
  actorRef: string,
  target: ContractReferenceV1,
  version: VersionReference,
  clock: () => Date,
) => {
  const occurredAt = iso(nowDate(clock));
  const auditEntryId = randomId("audit");
  return {
    resultRef: c02ResultRef(version.entityId, version.versionId),
    audit: {
      auditEntryId,
      projectId:
        command.kind.startsWith("create-account") ||
        command.kind === "disable-account" ||
        command.kind === "reset-password"
          ? SYSTEM_NAMESPACE
          : "projectId" in command
            ? command.projectId
            : SYSTEM_NAMESPACE,
      action: `access.${command.kind}`,
      targetRef: target,
      actorRef,
      authorizationContextRef: command.authorizationContextRef,
      occurredAt,
      recordedAt: occurredAt,
      version,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
    },
    events: [],
  };
};

const commitWithSecurityAudit = async (
  db: AccessDb,
  command: IdentityAdministrationCommandV1 | ProjectAccessCommandV1,
  actorRef: string,
  target: ContractReferenceV1,
  version: VersionReference,
  clock: () => Date,
): Promise<ReturnType<typeof commitFor>> => {
  const commit = commitFor(command, actorRef, target, version, clock);
  await appendSecurityAudit(
    db,
    securityAudit(`access.${command.kind}`, "success", "COMMITTED", nowDate(clock), {
      subject_ref: actorRef,
      project_ref: "projectId" in command ? command.projectId : null,
      request_ref: command.commandId,
      policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
      context_ref: jsonValue(command.authorizationContextRef),
    }),
  );
  return commit;
};

const commandResultFromReceipt = (
  receipt: { resultRef: ContractReferenceV1 },
  kind: AccessCommandResultV1["kind"],
): AccessCommandResultV1 => {
  const value = receipt.resultRef as ContractReferenceV1 & { reference?: VersionReference };
  const resultRef = value.reference ?? ref("access-result", "1");
  return AccessCommandResultV1Schema.parse({ kind, resultRef, references: [resultRef] });
};

const insertCredential = async (
  db: AccessDb,
  accountId: string,
  credentialVersion: number,
  password: string,
  randomBytes: RandomBytes | undefined,
): Promise<void> => {
  const credential = await derivePassword(password, undefined, randomBytes);
  await db
    .insertInto("business.local_credentials")
    .values({
      account_id: accountId,
      credential_version: credentialVersion,
      algorithm: credential.algorithm,
      policy_version: credential.policyVersion,
      cost: credential.cost,
      block_size: credential.blockSize,
      parallelization: credential.parallelization,
      key_length: credential.keyLength,
      salt: credential.salt,
      derived_key: credential.derivedKey,
      created_at: sql`clock_timestamp()`,
    })
    .execute();
};

const preserveAccessErrorsInTransaction =
  (
    handler: (context: TransactionContextV1) => Promise<AtomicCommitV1>,
  ): ((context: TransactionContextV1) => Promise<AtomicCommitV1>) =>
  async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      if (!(error instanceof AccessServiceError)) throw error;
      const wrapped = makePersistenceError("TRANSACTION_FAILED", "access.transaction");
      Object.defineProperty(wrapped, "accessError", { value: error });
      throw wrapped;
    }
  };

export const bootstrapInitialSystemAdministrator = async (
  config: BootstrapInitialSystemAdministratorConfig,
): Promise<AccessCommandResultV1> => {
  const clock = config.now ?? (() => new Date());
  const runtime = createPostgresRuntime(config.connection, "riskflow_migrator");
  const db = asAccessDb(runtime.db);
  try {
    const result = await db
      .transaction()
      .setIsolationLevel("serializable")
      .execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('riskflow.local-identity.bootstrap', 0))`.execute(
          tx,
        );
        const existing = await tx
          .selectFrom("business.local_accounts")
          .select("account_id")
          .executeTakeFirst();
        if (existing !== undefined) {
          throw makeAccessError("ACCESS_TERMINAL_FAILURE", "bootstrap.exists", clock);
        }
        const accountId = config.accountId ?? randomId("account");
        const canonical = canonicalLoginName(config.loginName);
        validatePassword(config.password);
        const now = nowDate(clock);
        await tx
          .insertInto("business.local_accounts")
          .values({
            account_id: accountId,
            login_name: canonical,
            display_name: config.displayName.trim(),
            status: "active",
            system_administrator: true,
            security_version: 1,
            current_credential_version: 1,
            password_change_required: true,
            created_at: now,
            updated_at: now,
            disabled_at: null,
          })
          .execute();
        await insertCredential(tx, accountId, 1, config.password, config.randomBytes);
        await appendSecurityAudit(
          tx,
          securityAudit("initial-bootstrap", "success", "BOOTSTRAP_CREATED", now, {
            subject_ref: accountId,
          }),
        );
        return accessResult("account", accountId, "1");
      });
    return result;
  } catch (error) {
    const mapped = asAccessError(error, "bootstrap", clock);
    try {
      await db.transaction().execute(async (transaction) => {
        await appendSecurityAudit(
          transaction as unknown as AccessDb,
          securityAudit("initial-bootstrap", "rejected", mapped.details.code, nowDate(clock)),
        );
      });
    } catch (auditError) {
      throw asAccessError(auditError, "bootstrap.audit", clock);
    }
    throw mapped;
  } finally {
    await runtime.close().catch(() => undefined);
  }
};

export const createPostgresLocalIdentityAccess = (
  config: LocalIdentityAccessConfig,
): PostgresLocalIdentityAccess => {
  const {
    hmacKey,
    keyVersion,
    now: configuredClock,
    randomBytes,
    registeredTaskReader,
    ...connection
  } = config;
  if (
    !(hmacKey instanceof Uint8Array) ||
    hmacKey.byteLength < 32 ||
    typeof keyVersion !== "string" ||
    keyVersion.length === 0
  ) {
    throw makeAccessError(
      "ACCESS_CONTRACT_INVALID",
      "factory",
      configuredClock ?? (() => new Date()),
    );
  }
  const clock = configuredClock ?? (() => new Date());
  const runtime = createPostgresRuntime(connection, "riskflow_app");
  const db = asAccessDb(runtime.db);
  const transactionUnit = new PostgresTransactionUnit(runtime.db);
  const tokenKey: SessionTokenKeyV1 = { keyVersion, hmacKey };
  let dummyCredentialPromise: Promise<Awaited<ReturnType<typeof makeDummyCredential>>> | undefined;

  const dummyCredential = (): Promise<Awaited<ReturnType<typeof makeDummyCredential>>> => {
    dummyCredentialPromise ??= makeDummyCredential(randomBytes);
    return dummyCredentialPromise;
  };

  const identityCommand = async (
    command: IdentityAdministrationCommandV1,
  ): Promise<AccessCommandResultV1> => {
    const parsed = IdentityAdministrationCommandV1Schema.safeParse(command);
    if (!parsed.success)
      throw makeAccessError("ACCESS_CONTRACT_INVALID", "identity.command", clock);
    const valid = parsed.data;
    const canonicalCreateLoginName =
      valid.kind === "create-account" ? valid.loginName.trim().toLowerCase() : undefined;
    const sanitizedPayload: JsonValue =
      valid.kind === "create-account"
        ? {
            kind: valid.kind,
            commandId: valid.commandId,
            idempotencyKey: valid.idempotencyKey,
            expectedVersion: valid.expectedVersion,
            authorizationContextRef: valid.authorizationContextRef,
            loginName: canonicalCreateLoginName ?? valid.loginName,
            displayName: valid.displayName,
            passwordProvided: true,
          }
        : valid.kind === "reset-password"
          ? {
              kind: valid.kind,
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
              expectedVersion: valid.expectedVersion,
              authorizationContextRef: valid.authorizationContextRef,
              accountId: valid.accountId,
              passwordProvided: true,
            }
          : {
              kind: valid.kind,
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
              expectedVersion: valid.expectedVersion,
              authorizationContextRef: valid.authorizationContextRef,
              accountId: valid.accountId,
            };
    try {
      if (valid.kind === "create-account") {
        try {
          canonicalLoginName(valid.loginName);
        } catch {
          throw makeAccessError("ACCESS_CONTRACT_INVALID", "identity.create-account", clock);
        }
      }
      const actor = await currentAdminActor(
        db,
        valid.authorizationContextRef,
        "identity.authorize",
        clock,
      );
      const receipt = await transactionUnit.execute(
        atomicCommand(valid, actor, SYSTEM_NAMESPACE, sanitizedPayload),
        preserveAccessErrorsInTransaction(async (context) => {
          const tx = asAccessTransaction(context);
          const txActor = await currentAdminActor(
            tx,
            valid.authorizationContextRef,
            "identity.authorize",
            clock,
          );
          if (txActor !== actor)
            throw makeAccessError("STALE_ACCESS_VERSION", "identity.authorize", clock);
          if (valid.kind === "create-account") {
            if (valid.expectedVersion !== "none") {
              throw makeAccessError("ACCESS_CONTRACT_INVALID", "identity.create-account", clock);
            }
            const canonical = canonicalLoginName(valid.loginName);
            const existing = await queryAccountByLogin(tx, canonical);
            if (existing !== undefined) {
              throw makeAccessError("ACCESS_TERMINAL_FAILURE", "identity.create-account", clock);
            }
            const accountId = randomId("account");
            const now = nowDate(clock);
            await tx
              .insertInto("business.local_accounts")
              .values({
                account_id: accountId,
                login_name: canonical,
                display_name: valid.displayName.trim(),
                status: "active",
                security_version: 1,
                current_credential_version: 1,
                password_change_required: true,
                created_at: now,
                updated_at: now,
                disabled_at: null,
              })
              .execute();
            await insertCredential(tx, accountId, 1, valid.password, randomBytes);
            const commit = await commitWithSecurityAudit(
              tx,
              valid,
              actor,
              targetRef(accountId, "1"),
              accountRevisionRef(accountId, 1),
              clock,
            );
            return commit;
          }

          const account = await queryAccount(tx, valid.accountId, true);
          if (account === undefined)
            throw makeAccessError("AUTHORIZATION_DENIED", `identity.${valid.kind}`, clock);
          if (
            !expectedVersionMatches(
              valid.expectedVersion,
              account.account_id,
              account.security_version,
            )
          ) {
            throw makeAccessError("STALE_ACCESS_VERSION", `identity.${valid.kind}`, clock, {
              targetRef: targetRef(account.account_id, String(account.security_version)),
            });
          }
          if (valid.kind === "disable-account") {
            if (account.status === "disabled") {
              throw makeAccessError("ACCESS_TERMINAL_FAILURE", "identity.disable-account", clock);
            }
            if (account.system_administrator) {
              const admins = await tx
                .selectFrom("business.local_accounts")
                .select("account_id")
                .where("system_administrator", "=", true)
                .where("status", "=", "active")
                .execute();
              if (admins.length <= 1) {
                throw makeAccessError("ACCESS_TERMINAL_FAILURE", "identity.disable-account", clock);
              }
            }
            const version = account.security_version + 1;
            const now = nowDate(clock);
            await tx
              .updateTable("business.local_accounts")
              .set({
                status: "disabled",
                security_version: version,
                updated_at: now,
                disabled_at: now,
              })
              .where("account_id", "=", account.account_id)
              .execute();
            await tx
              .updateTable("business.local_sessions")
              .set({ revoked_at: now, revocation_reason: "account-disabled" })
              .where("account_id", "=", account.account_id)
              .where("revoked_at", "is", null)
              .execute();
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              targetRef(account.account_id, String(version)),
              accountRevisionRef(account.account_id, version),
              clock,
            );
          }

          const version = account.security_version + 1;
          await insertCredential(
            tx,
            account.account_id,
            account.current_credential_version + 1,
            valid.password,
            randomBytes,
          );
          const now = nowDate(clock);
          await tx
            .updateTable("business.local_accounts")
            .set({
              security_version: version,
              current_credential_version: account.current_credential_version + 1,
              password_change_required: true,
              updated_at: now,
            })
            .where("account_id", "=", account.account_id)
            .execute();
          await tx
            .updateTable("business.local_sessions")
            .set({ revoked_at: now, revocation_reason: "password-reset" })
            .where("account_id", "=", account.account_id)
            .where("revoked_at", "is", null)
            .execute();
          const resetAttemptId = randomId("password-reset");
          await tx
            .insertInto("business.local_login_attempts")
            .values({
              login_attempt_id: resetAttemptId,
              canonical_login_name: account.login_name,
              login_name_fingerprint: loginFingerprint(account.login_name, tokenKey.hmacKey),
              account_id: account.account_id,
              payload_sha256: sha256CanonicalJson({
                kind: "password-reset",
                accountId: account.account_id,
              }),
              attempt_count: 0,
              window_started_at: now,
              locked_until: null,
              last_success_at: null,
              last_reset_at: now,
              last_result: "success",
              last_reason_code: "PASSWORD_RESET",
              last_attempt_at: now,
            })
            .execute();
          return commitWithSecurityAudit(
            tx,
            valid,
            actor,
            targetRef(account.account_id, String(version)),
            accountRevisionRef(account.account_id, version),
            clock,
          );
        }),
      );
      return commandResultFromReceipt(
        receipt,
        valid.kind === "create-account" ? "account" : "account",
      );
    } catch (error) {
      const mapped = asAccessError(error, `identity.${valid.kind}`, clock);
      await appendSecurityOutcomeOrThrow("identity", "rejected", mapped.details.code, {
        request_ref: valid.commandId,
        policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
        diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
      });
      throw mapped;
    }
  };

  const projectCommand = async (
    command: ProjectAccessCommandV1,
  ): Promise<AccessCommandResultV1> => {
    const parsed = ProjectAccessCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.projectId === SYSTEM_NAMESPACE) {
      throw makeAccessError("ACCESS_CONTRACT_INVALID", "project.command", clock);
    }
    const valid = parsed.data;
    try {
      const actor = await adminActorForProjectCommand(db, valid, clock);
      const receipt = await transactionUnit.execute(
        atomicCommand(valid, actor, valid.projectId, jsonValue(valid) as Record<string, JsonValue>),
        preserveAccessErrorsInTransaction(async (context) => {
          const tx = asAccessTransaction(context);
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.project-access.${valid.projectId}`}, 0))`.execute(
            tx,
          );
          const txActor = await adminActorForProjectCommand(tx, valid, clock);
          if (txActor !== actor)
            throw makeAccessError("STALE_ACCESS_VERSION", "project.authorize", clock);
          const now = nowDate(clock);

          if (valid.kind === "open-project") {
            if (valid.expectedVersion !== "none") {
              throw makeAccessError("ACCESS_CONTRACT_INVALID", "project.open-project", clock);
            }
            const initialManager = await queryAccount(tx, valid.initialRiskManagerAccountId);
            if (initialManager === undefined || initialManager.status !== "active") {
              throw makeAccessError("AUTHORIZATION_DENIED", "project.open-project", clock);
            }
            const existing = await queryProject(tx, valid.projectId, true);
            if (existing !== undefined)
              throw makeAccessError("ACCESS_TERMINAL_FAILURE", "project.open-project", clock);
            const rootScopeId = randomId("scope");
            const rootRevisionId = randomId("scope-revision");
            await tx
              .insertInto("business.access_projects")
              .values({
                project_id: valid.projectId,
                status: "active",
                access_version: 1,
                root_scope_id: rootScopeId,
                created_at: now,
                updated_at: now,
              })
              .execute();
            await tx
              .insertInto("business.access_spatial_scopes")
              .values({
                scope_id: rootScopeId,
                project_id: valid.projectId,
                current_revision_id: rootRevisionId,
                created_at: now,
              })
              .execute();
            await tx
              .insertInto("business.access_spatial_scope_revisions")
              .values({
                revision_id: rootRevisionId,
                scope_id: rootScopeId,
                project_id: valid.projectId,
                revision_no: 1,
                parent_scope_id: null,
                status: "active",
                previous_revision_id: null,
                created_at: now,
                recorded_by: actor,
              })
              .execute();
            const membershipId = randomId("membership");
            const membershipRevisionId = randomId("membership-revision");
            await tx
              .insertInto("business.project_memberships")
              .values({
                membership_id: membershipId,
                project_id: valid.projectId,
                account_id: initialManager.account_id,
                current_revision_id: membershipRevisionId,
                created_at: now,
              })
              .execute();
            await tx
              .insertInto("business.project_membership_revisions")
              .values({
                revision_id: membershipRevisionId,
                membership_id: membershipId,
                project_id: valid.projectId,
                account_id: initialManager.account_id,
                revision_no: 1,
                status: "active",
                previous_revision_id: null,
                created_at: now,
                recorded_by: actor,
              })
              .execute();
            await tx
              .insertInto("business.project_membership_revision_roles")
              .values({ revision_id: membershipRevisionId, role: "project-risk-manager" })
              .execute();
            await tx
              .insertInto("business.project_membership_revision_scopes")
              .values({
                revision_id: membershipRevisionId,
                project_id: valid.projectId,
                scope_id: rootScopeId,
              })
              .execute();
            if (valid.includeAdministrator === true && actor !== initialManager.account_id) {
              const adminMembershipId = randomId("membership");
              const adminRevisionId = randomId("membership-revision");
              await tx
                .insertInto("business.project_memberships")
                .values({
                  membership_id: adminMembershipId,
                  project_id: valid.projectId,
                  account_id: actor,
                  current_revision_id: adminRevisionId,
                  created_at: now,
                })
                .execute();
              await tx
                .insertInto("business.project_membership_revisions")
                .values({
                  revision_id: adminRevisionId,
                  membership_id: adminMembershipId,
                  project_id: valid.projectId,
                  account_id: actor,
                  revision_no: 1,
                  status: "active",
                  previous_revision_id: null,
                  created_at: now,
                  recorded_by: actor,
                })
                .execute();
              await tx
                .insertInto("business.project_membership_revision_roles")
                .values({ revision_id: adminRevisionId, role: "system-administrator" })
                .execute();
              await tx
                .insertInto("business.project_membership_revision_scopes")
                .values({
                  revision_id: adminRevisionId,
                  project_id: valid.projectId,
                  scope_id: rootScopeId,
                })
                .execute();
            }
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              projectRef(valid.projectId, "1"),
              ref(valid.projectId, "1"),
              clock,
            );
          }

          const project = await queryProject(tx, valid.projectId, true);
          if (project === undefined)
            throw makeAccessError("AUTHORIZATION_DENIED", `project.${valid.kind}`, clock);
          if (valid.kind === "suspend-project") {
            if (
              !expectedVersionMatches(
                valid.expectedVersion,
                project.project_id,
                project.access_version,
              )
            ) {
              throw makeAccessError("STALE_ACCESS_VERSION", "project.suspend-project", clock, {
                targetRef: projectRef(project.project_id, String(project.access_version)),
              });
            }
            const nextVersion = project.access_version + 1;
            await tx
              .updateTable("business.access_projects")
              .set({ status: "suspended", access_version: nextVersion, updated_at: now })
              .where("project_id", "=", project.project_id)
              .where("access_version", "=", project.access_version)
              .execute();
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              projectRef(project.project_id, String(nextVersion)),
              ref(project.project_id, String(nextVersion)),
              clock,
            );
          }

          const scopes = await queryCurrentScopeRevisions(tx, valid.projectId);
          const rootScope = scopes.find((scope) => scope.scope_id === project.root_scope_id);
          if (rootScope === undefined)
            throw makeAccessError("ACCESS_TERMINAL_FAILURE", `project.${valid.kind}`, clock);

          if (valid.kind === "revise-membership") {
            const account = await queryAccount(tx, valid.accountId);
            if (account === undefined || account.status !== "active") {
              throw makeAccessError("AUTHORIZATION_DENIED", "project.revise-membership", clock);
            }
            const scopeIds = valid.spatialScopeRefs.map((scope) => scope.reference.entityId);
            const scopeById = new Map(scopes.map((scope) => [scope.scope_id, scope]));
            if (
              valid.spatialScopeRefs.some(
                (scope) =>
                  scope.reference.versionId !==
                    scopeById.get(scope.reference.entityId)?.revision_id ||
                  scopeById.get(scope.reference.entityId)?.status !== "active",
              )
            ) {
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-membership", clock);
            }
            const existingMembership = await tx
              .selectFrom("business.project_memberships")
              .selectAll()
              .where("membership_id", "=", valid.membershipId)
              .where("project_id", "=", valid.projectId)
              .forUpdate()
              .executeTakeFirst();
            if (existingMembership === undefined) {
              if (valid.expectedVersion !== "none") {
                throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-membership", clock);
              }
              await tx
                .insertInto("business.project_memberships")
                .values({
                  membership_id: valid.membershipId,
                  project_id: valid.projectId,
                  account_id: account.account_id,
                  current_revision_id: randomId("membership-revision"),
                  created_at: now,
                })
                .execute();
              const inserted = await tx
                .selectFrom("business.project_memberships")
                .select("current_revision_id")
                .where("membership_id", "=", valid.membershipId)
                .executeTakeFirstOrThrow();
              const revisionId = inserted.current_revision_id;
              await tx
                .insertInto("business.project_membership_revisions")
                .values({
                  revision_id: revisionId,
                  membership_id: valid.membershipId,
                  project_id: valid.projectId,
                  account_id: account.account_id,
                  revision_no: 1,
                  status: valid.status,
                  previous_revision_id: null,
                  created_at: now,
                  recorded_by: actor,
                })
                .execute();
              await tx
                .insertInto("business.project_membership_revision_roles")
                .values(valid.roles.map((role) => ({ revision_id: revisionId, role })))
                .execute();
              await tx
                .insertInto("business.project_membership_revision_scopes")
                .values(
                  scopeIds.map((scopeId) => ({
                    revision_id: revisionId,
                    project_id: valid.projectId,
                    scope_id: scopeId,
                  })),
                )
                .execute();
              return commitWithSecurityAudit(
                tx,
                valid,
                actor,
                targetRef(valid.membershipId, "1"),
                ref(valid.membershipId, "1"),
                clock,
              );
            }
            if (existingMembership.account_id !== account.account_id) {
              throw makeAccessError("ACCESS_CONTRACT_INVALID", "project.revise-membership", clock);
            }
            const previous = await tx
              .selectFrom("business.project_membership_revisions")
              .selectAll()
              .where("revision_id", "=", existingMembership.current_revision_id)
              .executeTakeFirst();
            if (
              previous === undefined ||
              !expectedVersionMatches(
                valid.expectedVersion,
                valid.membershipId,
                previous.revision_no,
              )
            ) {
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-membership", clock, {
                targetRef: targetRef(valid.membershipId, String(previous?.revision_no ?? 0)),
              });
            }
            const duplicateMembership = await tx
              .selectFrom("business.project_memberships")
              .select("membership_id")
              .where("project_id", "=", valid.projectId)
              .where("account_id", "=", account.account_id)
              .where("membership_id", "!=", valid.membershipId)
              .executeTakeFirst();
            if (duplicateMembership !== undefined) {
              throw makeAccessError("ACCESS_TERMINAL_FAILURE", "project.revise-membership", clock);
            }
            const members = await tx
              .selectFrom("business.project_memberships as membership")
              .innerJoin(
                "business.project_membership_revisions as revision",
                "revision.revision_id",
                "membership.current_revision_id",
              )
              .select([
                "revision.account_id",
                "revision.status",
                "revision.revision_id",
                "revision.revision_no",
              ])
              .where("membership.project_id", "=", valid.projectId)
              .execute();
            const candidateManager =
              valid.status === "active" && valid.roles.includes("project-risk-manager");
            const roleRows = await tx
              .selectFrom("business.project_membership_revision_roles")
              .select(["revision_id", "role"])
              .where(
                "revision_id",
                "in",
                members.map((member) => member.revision_id),
              )
              .execute();
            const managerIds = new Set(
              members
                .filter((member) => member.status === "active")
                .filter((member) =>
                  roleRows.some(
                    (row) =>
                      row.revision_id === member.revision_id && row.role === "project-risk-manager",
                  ),
                )
                .map((member) => member.account_id),
            );
            managerIds.delete(previous.account_id);
            if (candidateManager) managerIds.add(account.account_id);
            if (managerIds.size === 0)
              throw makeAccessError("ACCESS_TERMINAL_FAILURE", "project.revise-membership", clock);
            const nextRevisionId = randomId("membership-revision");
            await tx
              .insertInto("business.project_membership_revisions")
              .values({
                revision_id: nextRevisionId,
                membership_id: valid.membershipId,
                project_id: valid.projectId,
                account_id: account.account_id,
                revision_no: previous.revision_no + 1,
                status: valid.status,
                previous_revision_id: previous.revision_id,
                created_at: now,
                recorded_by: actor,
              })
              .execute();
            await tx
              .insertInto("business.project_membership_revision_roles")
              .values(valid.roles.map((role) => ({ revision_id: nextRevisionId, role })))
              .execute();
            await tx
              .insertInto("business.project_membership_revision_scopes")
              .values(
                scopeIds.map((scopeId) => ({
                  revision_id: nextRevisionId,
                  project_id: valid.projectId,
                  scope_id: scopeId,
                })),
              )
              .execute();
            const updated = await tx
              .updateTable("business.project_memberships")
              .set({ current_revision_id: nextRevisionId })
              .where("membership_id", "=", existingMembership.membership_id)
              .where("current_revision_id", "=", previous.revision_id)
              .executeTakeFirst();
            if (Number(updated.numUpdatedRows) !== 1)
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-membership", clock);
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              targetRef(valid.membershipId, String(previous.revision_no + 1)),
              ref(valid.membershipId, String(previous.revision_no + 1)),
              clock,
            );
          }

          if (valid.kind === "create-spatial-scope") {
            if (valid.expectedVersion !== "none" || valid.parentScopeRef === undefined) {
              throw makeAccessError(
                "ACCESS_CONTRACT_INVALID",
                "project.create-spatial-scope",
                clock,
              );
            }
            if (scopes.some((scope) => scope.scope_id === valid.scopeId)) {
              throw makeAccessError(
                "ACCESS_TERMINAL_FAILURE",
                "project.create-spatial-scope",
                clock,
              );
            }
            const parent = scopes.find(
              (scope) => scope.scope_id === valid.parentScopeRef!.reference.entityId,
            );
            if (
              parent === undefined ||
              parent.project_id !== valid.projectId ||
              parent.revision_id !== valid.parentScopeRef!.reference.versionId ||
              parent.status !== "active"
            )
              throw makeAccessError("AUTHORIZATION_DENIED", "project.create-spatial-scope", clock);
            const revisionId = randomId("scope-revision");
            await tx
              .insertInto("business.access_spatial_scopes")
              .values({
                scope_id: valid.scopeId,
                project_id: valid.projectId,
                current_revision_id: revisionId,
                created_at: now,
              })
              .execute();
            await tx
              .insertInto("business.access_spatial_scope_revisions")
              .values({
                revision_id: revisionId,
                scope_id: valid.scopeId,
                project_id: valid.projectId,
                revision_no: 1,
                parent_scope_id: parent.scope_id,
                status: "active",
                previous_revision_id: null,
                created_at: now,
                recorded_by: actor,
              })
              .execute();
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              scopeRef(valid.scopeId, revisionId),
              ref(valid.scopeId, "1"),
              clock,
            );
          }

          if (valid.kind === "revise-spatial-scope") {
            const identity = await tx
              .selectFrom("business.access_spatial_scopes")
              .selectAll()
              .where("scope_id", "=", valid.scopeId)
              .where("project_id", "=", valid.projectId)
              .forUpdate()
              .executeTakeFirst();
            if (identity === undefined)
              throw makeAccessError("AUTHORIZATION_DENIED", "project.revise-spatial-scope", clock);
            const previous = scopes.find((scope) => scope.scope_id === valid.scopeId);
            if (
              previous === undefined ||
              !expectedVersionMatches(valid.expectedVersion, valid.scopeId, previous.revision_no)
            ) {
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-spatial-scope", clock, {
                targetRef: scopeRef(valid.scopeId, previous?.revision_id ?? "unknown"),
              });
            }
            const parentId = valid.parentScopeRef?.reference.entityId ?? null;
            if (valid.scopeId === project.root_scope_id && parentId !== null) {
              throw makeAccessError(
                "ACCESS_CONTRACT_INVALID",
                "project.revise-spatial-scope",
                clock,
              );
            }
            if (valid.scopeId !== project.root_scope_id && parentId === null) {
              throw makeAccessError(
                "ACCESS_CONTRACT_INVALID",
                "project.revise-spatial-scope",
                clock,
              );
            }
            const parent =
              parentId === null ? undefined : scopes.find((scope) => scope.scope_id === parentId);
            if (
              parentId !== null &&
              (parent === undefined ||
                parent.revision_id !== valid.parentScopeRef!.reference.versionId ||
                parent.status !== "active")
            )
              throw makeAccessError("AUTHORIZATION_DENIED", "project.revise-spatial-scope", clock);
            const candidateNodes: SpatialScopeNodeV1[] = scopes.map((scope) =>
              scope.scope_id === valid.scopeId
                ? {
                    projectId: scope.project_id,
                    scopeId: scope.scope_id,
                    revisionId: randomId("scope-revision-check"),
                    ...(parentId === null ? {} : { parentScopeId: parentId }),
                    status: valid.status,
                  }
                : {
                    projectId: scope.project_id,
                    scopeId: scope.scope_id,
                    revisionId: scope.revision_id,
                    ...(scope.parent_scope_id === null
                      ? {}
                      : { parentScopeId: scope.parent_scope_id }),
                    status: scope.status,
                  },
            );
            try {
              assertSpatialScopeTree(candidateNodes, valid.projectId);
            } catch {
              throw makeAccessError(
                "ACCESS_CONTRACT_INVALID",
                "project.revise-spatial-scope",
                clock,
              );
            }
            const nextRevisionId = randomId("scope-revision");
            await tx
              .insertInto("business.access_spatial_scope_revisions")
              .values({
                revision_id: nextRevisionId,
                scope_id: valid.scopeId,
                project_id: valid.projectId,
                revision_no: previous.revision_no + 1,
                parent_scope_id: parentId,
                status: valid.status,
                previous_revision_id: previous.revision_id,
                created_at: now,
                recorded_by: actor,
              })
              .execute();
            const updated = await tx
              .updateTable("business.access_spatial_scopes")
              .set({ current_revision_id: nextRevisionId })
              .where("scope_id", "=", valid.scopeId)
              .where("current_revision_id", "=", previous.revision_id)
              .executeTakeFirst();
            if (Number(updated.numUpdatedRows) !== 1)
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-spatial-scope", clock);
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              scopeRef(valid.scopeId, nextRevisionId),
              ref(valid.scopeId, String(previous.revision_no + 1)),
              clock,
            );
          }

          if (valid.kind === "revise-source-access") {
            const registered = assertActiveAccount(
              await queryAccount(tx, valid.registeredByAccountId),
              "project.revise-source-access",
              clock,
            );
            const registeredMembership = await queryMembership(
              tx,
              valid.projectId,
              registered.account_id,
            );
            if (registeredMembership?.status !== "active")
              throw makeAccessError("AUTHORIZATION_DENIED", "project.revise-source-access", clock);
            const source = await tx
              .selectFrom("business.source_access_policies")
              .selectAll()
              .where("project_id", "=", valid.projectId)
              .where("source_entity_id", "=", valid.sourceVersionRef.reference.entityId)
              .where("source_version_id", "=", valid.sourceVersionRef.reference.versionId)
              .forUpdate()
              .executeTakeFirst();
            const requestedAccounts = new Set(valid.allowedAccountIds);
            if (valid.visibility === "project-shared" && requestedAccounts.size > 0) {
              throw makeAccessError(
                "ACCESS_CONTRACT_INVALID",
                "project.revise-source-access",
                clock,
              );
            }
            if (valid.visibility === "restricted") requestedAccounts.add(registered.account_id);
            const sourceScopes =
              valid.spatialScopeRefs.length === 0
                ? [scopeRef(rootScope.scope_id, rootScope.revision_id)]
                : valid.spatialScopeRefs;
            const scopeById = new Map(scopes.map((scope) => [scope.scope_id, scope]));
            if (
              sourceScopes.some(
                (scope) =>
                  scopeById.get(scope.reference.entityId)?.project_id !== valid.projectId ||
                  scopeById.get(scope.reference.entityId)?.revision_id !==
                    scope.reference.versionId ||
                  scopeById.get(scope.reference.entityId)?.status !== "active",
              )
            )
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-source-access", clock);
            const revision =
              source === undefined
                ? undefined
                : await tx
                    .selectFrom("business.source_access_policy_revisions")
                    .selectAll()
                    .where("revision_id", "=", source.current_revision_id)
                    .executeTakeFirst();
            if (source === undefined) {
              if (valid.expectedVersion !== "none")
                throw makeAccessError(
                  "STALE_ACCESS_VERSION",
                  "project.revise-source-access",
                  clock,
                );
              const grantId = randomId("source-grant");
              const revisionId = randomId("source-access-revision");
              await tx
                .insertInto("business.source_access_policies")
                .values({
                  source_access_grant_id: grantId,
                  project_id: valid.projectId,
                  source_entity_id: valid.sourceVersionRef.reference.entityId,
                  source_version_id: valid.sourceVersionRef.reference.versionId,
                  current_revision_id: revisionId,
                  created_at: now,
                })
                .execute();
              await tx
                .insertInto("business.source_access_policy_revisions")
                .values({
                  revision_id: revisionId,
                  source_access_grant_id: grantId,
                  project_id: valid.projectId,
                  source_entity_id: valid.sourceVersionRef.reference.entityId,
                  source_version_id: valid.sourceVersionRef.reference.versionId,
                  revision_no: 1,
                  visibility: valid.visibility,
                  registered_by: registered.account_id,
                  previous_revision_id: null,
                  created_at: now,
                })
                .execute();
              if (requestedAccounts.size > 0) {
                await tx
                  .insertInto("business.source_access_policy_revision_accounts")
                  .values(
                    Array.from(requestedAccounts).map((accountId) => ({
                      revision_id: revisionId,
                      account_id: accountId,
                    })),
                  )
                  .execute();
              }
              await tx
                .insertInto("business.source_access_policy_revision_scopes")
                .values(
                  sourceScopes.map((scope) => ({
                    revision_id: revisionId,
                    project_id: valid.projectId,
                    scope_id: scope.reference.entityId,
                  })),
                )
                .execute();
              return commitWithSecurityAudit(
                tx,
                valid,
                actor,
                sourceGrantRef(grantId, revisionId),
                ref(grantId, "1"),
                clock,
              );
            }
            if (
              revision === undefined ||
              !expectedVersionMatches(
                valid.expectedVersion,
                source.source_access_grant_id,
                revision.revision_no,
              )
            ) {
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-source-access", clock, {
                targetRef: sourceGrantRef(
                  source.source_access_grant_id,
                  String(revision?.revision_no ?? 0),
                ),
              });
            }
            const nextRevisionId = randomId("source-access-revision");
            await tx
              .insertInto("business.source_access_policy_revisions")
              .values({
                revision_id: nextRevisionId,
                source_access_grant_id: source.source_access_grant_id,
                project_id: valid.projectId,
                source_entity_id: valid.sourceVersionRef.reference.entityId,
                source_version_id: valid.sourceVersionRef.reference.versionId,
                revision_no: revision.revision_no + 1,
                visibility: valid.visibility,
                registered_by: registered.account_id,
                previous_revision_id: revision.revision_id,
                created_at: now,
              })
              .execute();
            if (requestedAccounts.size > 0) {
              await tx
                .insertInto("business.source_access_policy_revision_accounts")
                .values(
                  Array.from(requestedAccounts).map((accountId) => ({
                    revision_id: nextRevisionId,
                    account_id: accountId,
                  })),
                )
                .execute();
            }
            await tx
              .insertInto("business.source_access_policy_revision_scopes")
              .values(
                sourceScopes.map((scope) => ({
                  revision_id: nextRevisionId,
                  project_id: valid.projectId,
                  scope_id: scope.reference.entityId,
                })),
              )
              .execute();
            const updated = await tx
              .updateTable("business.source_access_policies")
              .set({ current_revision_id: nextRevisionId })
              .where("source_access_grant_id", "=", source.source_access_grant_id)
              .where("current_revision_id", "=", revision.revision_id)
              .executeTakeFirst();
            if (Number(updated.numUpdatedRows) !== 1)
              throw makeAccessError("STALE_ACCESS_VERSION", "project.revise-source-access", clock);
            return commitWithSecurityAudit(
              tx,
              valid,
              actor,
              sourceGrantRef(source.source_access_grant_id, nextRevisionId),
              ref(source.source_access_grant_id, String(revision.revision_no + 1)),
              clock,
            );
          }

          throw makeAccessError("ACCESS_CONTRACT_INVALID", "project.command", clock);
        }),
      );
      const resultKind =
        valid.kind === "revise-membership"
          ? "membership"
          : valid.kind === "create-spatial-scope" || valid.kind === "revise-spatial-scope"
            ? "spatial-scope"
            : valid.kind === "revise-source-access"
              ? "source-access"
              : "project";
      const result = commandResultFromReceipt(receipt, resultKind);
      if (valid.kind !== "open-project") return result;
      const openedProject = await queryProject(db, valid.projectId);
      if (openedProject === undefined) return result;
      const openedScopes = await queryCurrentScopeRevisions(db, valid.projectId);
      const openedRoot = openedScopes.find(
        (scope) => scope.scope_id === openedProject.root_scope_id,
      );
      if (openedRoot === undefined) return result;
      return AccessCommandResultV1Schema.parse({
        ...result,
        references: [
          result.resultRef,
          { entityId: openedRoot.scope_id, versionId: openedRoot.revision_id },
        ],
      });
    } catch (error) {
      const mapped = asAccessError(error, `project.${valid.kind}`, clock);
      await appendSecurityOutcomeOrThrow("project", "rejected", mapped.details.code, {
        project_ref: valid.projectId,
        request_ref: valid.commandId,
        policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
        diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
      });
      throw mapped;
    }
  };

  interface AuthenticatedSession {
    readonly session: LocalSessionRow;
    readonly account: LocalAccountRow;
  }

  const tokenSessionId = (token: string): string | undefined => {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1] ?? ""))
      return undefined;
    const value = Buffer.from(parts[1] ?? "", "base64url");
    return value.length === 16 ? value.toString("base64url") : undefined;
  };

  const revokeKnownToken = async (token: string, reason: string): Promise<void> => {
    const sessionId = tokenSessionId(token);
    if (sessionId === undefined) return;
    const row = await querySession(db, sessionId, true);
    if (
      row === undefined ||
      row.token_sha256 !== sessionTokenSha256(token) ||
      row.revoked_at !== null
    )
      return;
    const now = nowDate(clock);
    await db
      .updateTable("business.local_sessions")
      .set({ revoked_at: now, revocation_reason: reason })
      .where("session_id", "=", row.session_id)
      .where("revoked_at", "is", null)
      .execute();
  };

  const authenticateSession = async (
    database: AccessDb,
    token: string,
    stage: string,
    allowPasswordChange = false,
  ): Promise<AuthenticatedSession> => {
    const parts = decodeAndVerifySessionToken(token, tokenKey);
    if (parts === undefined) {
      if (tokenSessionId(token) !== undefined) {
        const oldKeyRow = await querySession(database, tokenSessionId(token)!, false);
        if (
          oldKeyRow?.token_sha256 === sessionTokenSha256(token) &&
          oldKeyRow.key_version !== tokenKey.keyVersion
        ) {
          throw makeAccessError("SESSION_REVOKED", stage, clock);
        }
      }
      throw makeAccessError("SESSION_REVOKED", stage, clock);
    }
    const sessionId = parts.sessionId.toString("base64url");
    const session = await querySession(database, sessionId, true);
    if (session === undefined || session.token_sha256 !== sessionTokenSha256(token)) {
      throw makeAccessError("SESSION_REVOKED", stage, clock);
    }
    const storedNonce = Buffer.from(session.nonce);
    if (storedNonce.length !== parts.nonce.length || !timingSafeEqual(storedNonce, parts.nonce)) {
      throw makeAccessError("SESSION_REVOKED", stage, clock);
    }
    if (session.key_version !== tokenKey.keyVersion)
      throw makeAccessError("SESSION_REVOKED", stage, clock);
    const account = assertActiveAccount(
      await queryAccount(database, session.account_id),
      stage,
      clock,
    );
    const now = nowDate(clock).getTime();
    if (session.revoked_at !== null) throw makeAccessError("SESSION_REVOKED", stage, clock);
    if (
      now >=
      Math.min(
        asDate(session.idle_expires_at).getTime(),
        asDate(session.absolute_expires_at).getTime(),
      )
    ) {
      throw makeAccessError("SESSION_EXPIRED", stage, clock);
    }
    if (
      account.security_version !== session.account_security_version ||
      account.current_credential_version !== session.credential_version
    ) {
      throw makeAccessError("SESSION_REVOKED", stage, clock);
    }
    if (account.password_change_required && !allowPasswordChange) {
      throw makeAccessError("PASSWORD_CHANGE_REQUIRED", stage, clock);
    }
    return { session, account };
  };

  const touchSession = async (
    database: AccessDb,
    authenticated: AuthenticatedSession,
  ): Promise<AuthenticatedSession> => {
    const now = nowDate(clock);
    const absolute = asDate(authenticated.session.absolute_expires_at);
    const idle = new Date(now.getTime() + SESSION_IDLE_MS);
    const nextIdle = idle.getTime() < absolute.getTime() ? idle : absolute;
    if (nextIdle.getTime() <= now.getTime())
      throw makeAccessError("SESSION_EXPIRED", "session.touch", clock);
    await database
      .updateTable("business.local_sessions")
      .set({ last_seen_at: now, idle_expires_at: nextIdle })
      .where("session_id", "=", authenticated.session.session_id)
      .where("revoked_at", "is", null)
      .execute();
    return {
      account: authenticated.account,
      session: { ...authenticated.session, last_seen_at: now, idle_expires_at: nextIdle },
    };
  };

  const insertSystemAdministrationContext = async (
    database: AccessDb,
    account: LocalAccountRow,
    invocationId: string,
    now: Date,
  ): Promise<AuthorizationContextRefV1> => {
    const context = contextRef(randomId("authorization-context"), "1");
    await database
      .insertInto("business.authorization_contexts")
      .values({
        context_id: context.reference.entityId,
        version_id: context.reference.versionId,
        invocation_id: invocationId,
        project_id: SYSTEM_NAMESPACE,
        actor_id: account.account_id,
        branch: "access-administration",
        context_kind: "system-administration",
        context_json: null,
        parent_context_id: null,
        causal_run_ref: null,
        policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
        revision_snapshot: jsonValue({ accountSecurityVersion: account.security_version }),
        expires_at: new Date(now.getTime() + CONTEXT_TTL_MS),
        decided_at: now,
      })
      .execute();
    return context;
  };

  interface CurrentAccess {
    readonly account: LocalAccountRow;
    readonly project: AccessProjectRow;
    readonly membership: MembershipSnapshot;
    readonly scopeNodes: readonly SpatialScopeNodeV1[];
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceAccessGrantRefs: readonly SourceAccessGrantRefV1[];
    readonly redacted: boolean;
  }

  const authorizationDenied = (stage: string, branch?: ModuleBranchV1): AccessServiceError =>
    makeAccessError("AUTHORIZATION_DENIED", stage, clock, {
      ...(branch === undefined ? {} : { requiredCapability: branchCapability(branch) }),
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    });

  const evaluateCurrentAccess = async (
    database: AccessDb,
    actorId: string,
    projectId: string,
    branch: ModuleBranchV1,
    requestedSpatialScopeRefs: readonly SpatialScopeRefV1[],
    requestedSourceVersionRefs: readonly SourceVersionRefV1[],
    stage: string,
  ): Promise<CurrentAccess> => {
    ModuleBranchV1Schema.parse(branch);
    if (projectId === SYSTEM_NAMESPACE) throw authorizationDenied(stage, branch);
    const account = assertActiveAccount(await queryAccount(database, actorId), stage, clock);
    const project = await queryProject(database, projectId);
    if (project === undefined || project.status !== "active")
      throw authorizationDenied(stage, branch);
    const membership = await queryMembership(database, projectId, actorId);
    if (
      membership === undefined ||
      membership.status !== "active" ||
      !isBranchAllowed(membership.roles, branch)
    )
      throw authorizationDenied(stage, branch);
    const currentScopeRevisions = await queryCurrentScopeRevisions(database, projectId);
    const scopeGraph = await scopeNodes(database, projectId);
    const membershipScopeRefs = currentScopeRefsForMembership(membership, currentScopeRevisions);
    if (membershipScopeRefs.length === 0) throw authorizationDenied(stage, branch);
    const spatialScopeRefs =
      requestedSpatialScopeRefs.length === 0 ? membershipScopeRefs : requestedSpatialScopeRefs;
    if (!allSpatialScopesCovered(membershipScopeRefs, spatialScopeRefs, scopeGraph)) {
      throw authorizationDenied(stage, branch);
    }
    const rootNode = scopeGraph.find(
      (scope) => scope.scopeId === project.root_scope_id && scope.status === "active",
    );
    if (rootNode === undefined) throw authorizationDenied(stage, branch);
    const sourcePolicies: SourceAccessPolicyV1[] = [];
    for (const sourceVersionRef of requestedSourceVersionRefs) {
      const policy = await querySourcePolicy(
        database,
        projectId,
        sourceVersionRef,
        scopeRef(rootNode.scopeId, rootNode.revisionId),
        currentScopeRevisions,
      );
      if (policy === undefined) throw authorizationDenied(stage, branch);
      sourcePolicies.push(policy);
    }
    if (sourcePolicies.length === 0) {
      return {
        account,
        project,
        membership,
        scopeNodes: scopeGraph,
        spatialScopeRefs,
        sourceAccessGrantRefs: [],
        redacted: false,
      };
    }
    const requireBody = branch === "engineering-data.evidence-access";
    const sourceAccess = sourcePolicies.map((policy) =>
      evaluateSourceAccess({
        accountId: actorId,
        projectId,
        roles: membership.roles,
        branch,
        membershipActive: membership.status === "active",
        grantedScopeRefs: membershipScopeRefs,
        policy,
        scopeNodes: scopeGraph,
        requireBody,
      }),
    );
    if (requireBody && sourceAccess.some((item) => !item.allowed)) {
      throw authorizationDenied(stage, branch);
    }
    const projection = projectionAccess(sourceAccess);
    if (!projection.allowed) throw authorizationDenied(stage, branch);
    return {
      account,
      project,
      membership,
      scopeNodes: scopeGraph,
      spatialScopeRefs,
      sourceAccessGrantRefs: projection.sourceAccessGrantRefs,
      redacted: projection.redacted,
    };
  };

  const loadParentContext = async (
    database: AccessDb,
    supplied: AuthorizationContextV1,
    projectId: string,
    stage: string,
  ): Promise<AuthorizationContextV1> => {
    const parsed = AuthorizationContextV1Schema.safeParse(supplied);
    if (!parsed.success) throw authorizationDenied(stage);
    const stored = await loadStoredContext(database, parsed.data.authorizationContextRef);
    if (stored?.context === undefined) throw authorizationDenied(stage);
    if (
      stored.context.authorizationContextRef.reference.entityId !==
        parsed.data.authorizationContextRef.reference.entityId ||
      stored.context.authorizationContextRef.reference.versionId !==
        parsed.data.authorizationContextRef.reference.versionId ||
      sha256CanonicalJson(stored.context) !== sha256CanonicalJson(parsed.data)
    )
      throw authorizationDenied(stage);
    if (parsed.data.projectId !== projectId) throw authorizationDenied(stage);
    if (asDate(stored.row.expires_at).getTime() <= nowDate(clock).getTime()) {
      throw makeAccessError("SESSION_EXPIRED", stage, clock);
    }
    const account = assertActiveAccount(
      await queryAccount(database, parsed.data.actorId),
      stage,
      clock,
    );
    const snapshot = stored.row.revision_snapshot;
    if (
      typeof snapshot === "object" &&
      snapshot !== null &&
      !Array.isArray(snapshot) &&
      "accountSecurityVersion" in snapshot &&
      snapshot.accountSecurityVersion !== account.security_version
    )
      throw makeAccessError("SESSION_REVOKED", stage, clock);
    return parsed.data;
  };

  const assertCommandCause = async (
    database: AccessDb,
    cause: CommandCausalRefV1,
    parent: AuthorizationContextV1,
    projectId: string,
    branch: ModuleBranchV1,
  ): Promise<Date> => {
    const root = await loadStoredContext(database, cause.authorizationContextRef);
    if (
      (branch !== "knowledge-modeling.identification-basis" &&
        branch !== "knowledge-modeling.hybrid-evidence") ||
      root?.context?.invocation.kind !== "human" ||
      root.row.context_kind !== "c02" ||
      root.row.branch !== "knowledge-modeling.publish-approved-release" ||
      root.row.invocation_id !== cause.commandId ||
      root.row.project_id !== projectId ||
      root.row.actor_id !== parent.actorId
    )
      throw authorizationDenied("authorize.command-cause", branch);
    await loadParentContext(database, root.context, projectId, "authorize.command-root");
    const snapshot = root.row.revision_snapshot;
    const sources = SourceVersionRefSetV1Schema.safeParse(
      typeof snapshot === "object" &&
        snapshot !== null &&
        !Array.isArray(snapshot) &&
        "sourceVersionRefs" in snapshot
        ? snapshot.sourceVersionRefs
        : undefined,
    );
    if (!sources.success) throw authorizationDenied("authorize.command-sources", branch);
    await evaluateCurrentAccess(
      database,
      parent.actorId,
      projectId,
      "knowledge-modeling.publish-approved-release",
      root.context.spatialScopeRefs,
      sources.data,
      "authorize.command-current",
    );
    const links = await sql<{ child_context_ref: string }>`
      SELECT child_context_ref FROM business.deployment_causal_authorizations
      WHERE root_context_ref = ${JSON.stringify(cause.authorizationContextRef.reference)}::jsonb
        AND project_id = ${projectId} AND actor_id = ${parent.actorId}
        AND branch = ${branch}
      LIMIT 2`.execute(database);
    if (links.rows.length !== 1) throw authorizationDenied("authorize.command-link", branch);
    const linkedRef = JSON.parse(links.rows[0]!.child_context_ref) as unknown;
    if (
      sha256CanonicalJson(linkedRef) !==
      sha256CanonicalJson(parent.authorizationContextRef.reference)
    )
      throw authorizationDenied("authorize.command-link", branch);
    return asDate(root.row.expires_at);
  };

  const persistAuthorizationContext = async (
    database: AccessDb,
    context: AuthorizationContextV1,
    actorId: string,
    invocationId: string,
    branch: ModuleBranchV1,
    revisionSnapshot: JsonValue,
    parentContextId: string | null,
    causalRunRef: JsonValue | null,
    expiresAt: Date,
    decidedAt: Date,
  ): Promise<void> => {
    await database
      .insertInto("business.authorization_contexts")
      .values({
        context_id: context.authorizationContextRef.reference.entityId,
        version_id: context.authorizationContextRef.reference.versionId,
        invocation_id: invocationId,
        project_id: context.projectId,
        actor_id: actorId,
        branch,
        context_kind: "c02",
        context_json: jsonValue(context),
        parent_context_id: parentContextId,
        causal_run_ref: causalRunRef,
        policy_ref: jsonValue(context.authorizationPolicyRef),
        revision_snapshot: revisionSnapshot,
        expires_at: expiresAt,
        decided_at: decidedAt,
      })
      .execute();
  };

  const issueSession = async (
    database: AccessDb,
    account: LocalAccountRow,
    loginAttemptId: string,
    canonical: string,
    now: Date,
  ): Promise<{ readonly session: LocalSessionRow; readonly token: string }> => {
    const generated = createSessionToken(tokenKey, randomBytes);
    const sessionId = generated.sessionId.toString("base64url");
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    const session: LocalSessionRow = {
      session_id: sessionId,
      nonce: generated.nonce,
      token_sha256: sessionTokenSha256(generated.token),
      key_version: tokenKey.keyVersion,
      account_id: account.account_id,
      login_attempt_id: loginAttemptId,
      canonical_login_name: canonical,
      credential_version: account.current_credential_version,
      account_security_version: account.security_version,
      created_at: now,
      last_seen_at: now,
      idle_expires_at: idleExpiresAt,
      absolute_expires_at: absoluteExpiresAt,
      revoked_at: null,
      revocation_reason: null,
    };
    await database.insertInto("business.local_sessions").values(session).execute();
    return { session, token: generated.token };
  };

  const login = async (command: LoginCommandV1): Promise<SessionResultV1> => {
    const parsed = LoginCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeAccessError("ACCESS_CONTRACT_INVALID", "login.command", clock);
    const valid = parsed.data;
    let canonical: string;
    try {
      canonical = canonicalLoginName(valid.loginName);
    } catch {
      try {
        await db.transaction().execute(async (transaction) => {
          await appendSecurityAudit(
            transaction as unknown as AccessDb,
            securityAudit("login", "rejected", "AUTHENTICATION_REJECTED", nowDate(clock), {
              request_ref: valid.loginAttemptId,
            }),
          );
        });
      } catch (auditError) {
        throw asAccessError(auditError, "login.audit", clock);
      }
      throw makeAccessError("AUTHENTICATION_REJECTED", "login", clock);
    }
    const payloadSha256 = sha256CanonicalJson({ kind: "login", loginName: canonical });
    try {
      const result = await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.local-login.${canonical}`}, 0))`.execute(
          tx,
        );
        const existing = await tx
          .selectFrom("business.local_login_attempts")
          .selectAll()
          .where("login_attempt_id", "=", valid.loginAttemptId)
          .executeTakeFirst();
        if (existing !== undefined) {
          if (
            existing.canonical_login_name !== canonical ||
            existing.payload_sha256 !== payloadSha256
          ) {
            throw makeAccessError("IDEMPOTENCY_CONFLICT", "login.idempotency", clock, {
              idempotencyKey: valid.loginAttemptId,
              priorCommandId: existing.login_attempt_id,
            });
          }
          if (existing.last_result === "success") {
            const session = await tx
              .selectFrom("business.local_sessions")
              .selectAll()
              .where("login_attempt_id", "=", existing.login_attempt_id)
              .executeTakeFirst();
            const account =
              existing.account_id === null
                ? undefined
                : await queryAccount(tx, existing.account_id);
            const credential =
              account === undefined ? undefined : await queryCredential(tx, account);
            const passwordMatches =
              account !== undefined &&
              account.status === "active" &&
              PasswordV1Schema.safeParse(valid.password).success &&
              credential !== undefined
                ? await verifyPassword(valid.password, {
                    salt: credential.salt,
                    derivedKey: credential.derived_key,
                  })
                : (await verifyPassword(DUMMY_PASSWORD, await dummyCredential()), false);
            if (!passwordMatches) {
              throw makeAccessError("AUTHENTICATION_REJECTED", "login.idempotency", clock);
            }
            const sessionActive =
              session !== undefined &&
              session.revoked_at === null &&
              asDate(session.absolute_expires_at).getTime() > nowDate(clock).getTime() &&
              asDate(session.idle_expires_at).getTime() > nowDate(clock).getTime();
            if (
              sessionActive &&
              account !== undefined &&
              account.status === "active" &&
              session!.key_version === tokenKey.keyVersion &&
              session!.account_security_version === account.security_version &&
              session!.credential_version === account.current_credential_version
            ) {
              const token = encodeSessionToken(
                {
                  sessionId: Buffer.from(session.session_id, "base64url"),
                  nonce: Buffer.from(session.nonce),
                },
                tokenKey,
              );
              return sessionResult(
                session,
                token,
                account.password_change_required,
                account.password_change_required,
              );
            }
            throw makeAccessError("SESSION_REVOKED", "login.idempotency", clock);
          }
          await verifyPassword(DUMMY_PASSWORD, await dummyCredential());
          return { rejected: true as const };
        }

        const now = nowDate(clock);
        const account = await queryAccountByLogin(tx, canonical, true);
        const resetMarkers = await tx
          .selectFrom("business.local_login_attempts")
          .select(["last_success_at", "last_reset_at"])
          .where("canonical_login_name", "=", canonical)
          .execute();
        const windowFloor = now.getTime() - LOGIN_WINDOW_MS;
        const resetFloor = resetMarkers.reduce((floor, marker) => {
          const successAt =
            marker.last_success_at === null
              ? floor
              : Math.max(floor, asDate(marker.last_success_at).getTime());
          return marker.last_reset_at === null
            ? successAt
            : Math.max(successAt, asDate(marker.last_reset_at).getTime());
        }, windowFloor);
        const recentFailures = await tx
          .selectFrom("business.local_login_attempts")
          .select(["login_attempt_id", "locked_until"])
          .where("canonical_login_name", "=", canonical)
          .where("last_result", "=", "failure")
          .where("last_attempt_at", ">", new Date(resetFloor))
          .execute();
        const locked = recentFailures.some(
          (item) =>
            item.locked_until !== null && asDate(item.locked_until).getTime() > now.getTime(),
        );
        const throttled = locked || recentFailures.length >= LOGIN_FAILURE_LIMIT;
        const passwordWithinPolicy = PasswordV1Schema.safeParse(valid.password).success;
        const accountEligible =
          account !== undefined &&
          account.status === "active" &&
          !throttled &&
          passwordWithinPolicy;
        const credential =
          accountEligible && account !== undefined ? await queryCredential(tx, account) : undefined;
        const passwordMatches =
          accountEligible && credential !== undefined
            ? await verifyPassword(valid.password, {
                salt: credential.salt,
                derivedKey: credential.derived_key,
              })
            : (await verifyPassword(DUMMY_PASSWORD, await dummyCredential()), false);
        if (passwordMatches) {
          await tx
            .insertInto("business.local_login_attempts")
            .values({
              login_attempt_id: valid.loginAttemptId,
              canonical_login_name: canonical,
              login_name_fingerprint: loginFingerprint(canonical, tokenKey.hmacKey),
              account_id: account!.account_id,
              payload_sha256: payloadSha256,
              attempt_count: 0,
              window_started_at: now,
              locked_until: null,
              last_success_at: now,
              last_reset_at: null,
              last_result: "success",
              last_reason_code: "AUTHENTICATED",
              last_attempt_at: now,
            })
            .execute();
          const session = await issueSession(tx, account!, valid.loginAttemptId, canonical, now);
          const adminContext = account!.system_administrator
            ? await insertSystemAdministrationContext(tx, account!, valid.loginAttemptId, now)
            : undefined;
          await appendSecurityAudit(
            tx,
            securityAudit("login", "success", "AUTHENTICATED", now, {
              subject_ref: account!.account_id,
              request_ref: valid.loginAttemptId,
              ...(adminContext === undefined ? {} : { context_ref: jsonValue(adminContext) }),
            }),
          );
          return sessionResult(
            session.session,
            session.token,
            account!.password_change_required,
            account!.password_change_required,
            adminContext,
          );
        }
        const failures = recentFailures.length + 1;
        const lockedUntil =
          failures >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_LOCK_MS) : null;
        await tx
          .insertInto("business.local_login_attempts")
          .values({
            login_attempt_id: valid.loginAttemptId,
            canonical_login_name: canonical,
            login_name_fingerprint: loginFingerprint(canonical, tokenKey.hmacKey),
            account_id: account?.account_id ?? null,
            payload_sha256: payloadSha256,
            attempt_count: failures,
            window_started_at: now,
            locked_until: lockedUntil,
            last_success_at: null,
            last_reset_at: null,
            last_result: "failure",
            last_reason_code: throttled ? "THROTTLED" : "AUTHENTICATION_REJECTED",
            last_attempt_at: now,
          })
          .execute();
        await appendSecurityAudit(
          tx,
          securityAudit(
            "login",
            "rejected",
            throttled ? "THROTTLED" : "AUTHENTICATION_REJECTED",
            now,
            {
              subject_ref: account?.account_id ?? null,
              request_ref: valid.loginAttemptId,
            },
          ),
        );
        return { rejected: true as const };
      });
      if ("rejected" in result) throw makeAccessError("AUTHENTICATION_REJECTED", "login", clock);
      return result;
    } catch (error) {
      const mapped = asAccessError(error, "login", clock);
      if (mapped.details.code !== "AUTHENTICATION_REJECTED") {
        await appendSecurityOutcomeOrThrow("login", "rejected", mapped.details.code, {
          request_ref: valid.loginAttemptId,
          diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
        });
      }
      throw mapped;
    }
  };

  const changePassword = async (command: ChangePasswordCommandV1): Promise<SessionResultV1> => {
    const parsed = ChangePasswordCommandV1Schema.safeParse(command);
    if (!parsed.success)
      throw makeAccessError("ACCESS_CONTRACT_INVALID", "password-change.command", clock);
    const valid = parsed.data;
    try {
      return await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        const authenticated = await authenticateSession(
          tx,
          valid.sessionToken,
          "password-change.session",
          true,
        );
        const lockedSession = await querySession(tx, authenticated.session.session_id, true);
        if (lockedSession === undefined)
          throw makeAccessError("SESSION_REVOKED", "password-change.session", clock);
        const lockedAuthenticated = { ...authenticated, session: lockedSession };
        const now = nowDate(clock);
        validatePassword(valid.newPassword);
        const nextCredentialVersion = lockedAuthenticated.account.current_credential_version + 1;
        const nextSecurityVersion = lockedAuthenticated.account.security_version + 1;
        await insertCredential(
          tx,
          lockedAuthenticated.account.account_id,
          nextCredentialVersion,
          valid.newPassword,
          randomBytes,
        );
        await tx
          .updateTable("business.local_accounts")
          .set({
            security_version: nextSecurityVersion,
            current_credential_version: nextCredentialVersion,
            password_change_required: false,
            updated_at: now,
          })
          .where("account_id", "=", lockedAuthenticated.account.account_id)
          .where("security_version", "=", lockedAuthenticated.account.security_version)
          .execute();
        await tx
          .updateTable("business.local_sessions")
          .set({ revoked_at: now, revocation_reason: "password-changed" })
          .where("account_id", "=", lockedAuthenticated.account.account_id)
          .where("revoked_at", "is", null)
          .execute();
        const attemptId = randomId("password-change");
        const canonical = lockedAuthenticated.account.login_name;
        await tx
          .insertInto("business.local_login_attempts")
          .values({
            login_attempt_id: attemptId,
            canonical_login_name: canonical,
            login_name_fingerprint: loginFingerprint(canonical, tokenKey.hmacKey),
            account_id: lockedAuthenticated.account.account_id,
            payload_sha256: sha256CanonicalJson({
              kind: "password-change",
              sessionId: lockedSession.session_id,
            }),
            attempt_count: 0,
            window_started_at: now,
            locked_until: null,
            last_success_at: now,
            last_reset_at: now,
            last_result: "success",
            last_reason_code: "PASSWORD_CHANGED",
            last_attempt_at: now,
          })
          .execute();
        const nextAccount: LocalAccountRow = {
          ...lockedAuthenticated.account,
          security_version: nextSecurityVersion,
          current_credential_version: nextCredentialVersion,
          password_change_required: false,
          updated_at: now,
        };
        const nextSession = await issueSession(tx, nextAccount, attemptId, canonical, now);
        const adminContext = nextAccount.system_administrator
          ? await insertSystemAdministrationContext(tx, nextAccount, attemptId, now)
          : undefined;
        await appendSecurityAudit(
          tx,
          securityAudit("password-change", "success", "PASSWORD_CHANGED", now, {
            subject_ref: nextAccount.account_id,
            request_ref: lockedSession.session_id,
            ...(adminContext === undefined ? {} : { context_ref: jsonValue(adminContext) }),
          }),
        );
        return sessionResult(nextSession.session, nextSession.token, false, false, adminContext);
      });
    } catch (error) {
      const mapped = asAccessError(error, "password-change", clock);
      if (mapped.details.code === "SESSION_REVOKED") {
        await revokeKnownToken(valid.sessionToken, "session-invalid").catch(() => undefined);
      }
      await appendSecurityOutcomeOrThrow("password-change", "rejected", mapped.details.code, {
        request_ref: sessionTokenSha256(valid.sessionToken),
        diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
      });
      throw mapped;
    }
  };

  const logout = async (command: LogoutCommandV1): Promise<AccessCommandResultV1> => {
    const parsed = LogoutCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeAccessError("ACCESS_CONTRACT_INVALID", "logout.command", clock);
    const valid = parsed.data;
    try {
      return await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        const parts = decodeAndVerifySessionToken(valid.sessionToken, tokenKey);
        const sessionId =
          parts?.sessionId.toString("base64url") ?? tokenSessionId(valid.sessionToken);
        if (sessionId === undefined) throw makeAccessError("SESSION_REVOKED", "logout", clock);
        const session = await querySession(tx, sessionId, true);
        if (
          session === undefined ||
          session.token_sha256 !== sessionTokenSha256(valid.sessionToken)
        ) {
          throw makeAccessError("SESSION_REVOKED", "logout", clock);
        }
        const now = nowDate(clock);
        if (session.revoked_at === null) {
          await tx
            .updateTable("business.local_sessions")
            .set({ revoked_at: now, revocation_reason: "logout" })
            .where("session_id", "=", session.session_id)
            .where("revoked_at", "is", null)
            .execute();
        }
        await appendSecurityAudit(
          tx,
          securityAudit("logout", "success", "LOGGED_OUT", now, {
            subject_ref: session.account_id,
            request_ref: session.session_id,
          }),
        );
        return accessResult("session", session.session_id, "1");
      });
    } catch (error) {
      const mapped = asAccessError(error, "logout", clock);
      await revokeKnownToken(valid.sessionToken, "session-invalid").catch(() => undefined);
      await appendSecurityOutcomeOrThrow("logout", "rejected", mapped.details.code, {
        request_ref: sessionTokenSha256(valid.sessionToken),
        diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
      });
      throw mapped;
    }
  };

  type SecurityAuditDetails = Partial<
    Pick<
      SecurityAuditEventRow,
      | "subject_ref"
      | "project_ref"
      | "request_ref"
      | "policy_ref"
      | "context_ref"
      | "diagnostic_ref"
    >
  >;

  const appendSecurityOutcome = async (
    eventKind: string,
    outcome: "success" | "rejected" | "failure",
    reasonCode: string,
    details: SecurityAuditDetails = {},
  ): Promise<void> => {
    const occurredAt = nowDate(clock);
    await db.transaction().execute(async (transaction) => {
      await appendSecurityAudit(
        transaction as unknown as AccessDb,
        securityAudit(eventKind, outcome, reasonCode, occurredAt, details),
      );
    });
  };

  const appendSecurityOutcomeOrThrow = async (
    eventKind: string,
    outcome: "success" | "rejected" | "failure",
    reasonCode: string,
    details: SecurityAuditDetails,
  ): Promise<void> => {
    try {
      await appendSecurityOutcome(eventKind, outcome, reasonCode, details);
    } catch (error) {
      throw asAccessError(error, `${eventKind}.audit`, clock);
    }
  };

  /**
   * 会话自省：沿既有会话验证路径回报无 token 元数据。
   *
   * 允许受限会话通过（改密仍受业务授权限制），并按既有会话使用规则推进空闲期限——
   * 绝不越过绝对期限。停用、撤销、密码或密钥版本不符、空闲/绝对期限到达都按会话失效类别
   * 失败，调用方据此区分「没有有效会话」与技术故障。这里不签发任何授权上下文。
   */
  const readSession = async (command: ReadSessionCommandV1): Promise<SessionMetadataV1> => {
    const parsed = ReadSessionCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeAccessError("ACCESS_CONTRACT_INVALID", "session.command", clock);
    const valid = parsed.data;
    try {
      return await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        const authenticated = await authenticateSession(
          tx,
          valid.sessionToken,
          "session.read",
          true,
        );
        const touched = await touchSession(tx, authenticated);
        return sessionMetadata(
          touched.session,
          touched.account.password_change_required,
          touched.account.password_change_required,
        );
      });
    } catch (error) {
      throw asAccessError(error, "session.read", clock);
    }
  };

  const authorize = async (request: AuthorizationRequestV1): Promise<AuthorizationDecisionV1> => {
    const parsed = AuthorizationRequestV1Schema.safeParse(request);
    if (!parsed.success)
      throw makeAccessError("ACCESS_CONTRACT_INVALID", "authorize.command", clock);
    const valid = parsed.data;
    const parentContext = "parentContext" in valid ? valid.parentContext : undefined;
    const causalRunRef = "causalRunRef" in valid ? valid.causalRunRef : undefined;
    const causalCommandRef = "causalCommandRef" in valid ? valid.causalCommandRef : undefined;
    try {
      return await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        let actorId: string;
        let parent: AuthorizationContextV1 | undefined;
        let commandExpiresAt: Date | undefined;
        let effectiveScopes = valid.requestedSpatialScopeRefs;
        if (valid.invocation.kind === "human-session") {
          const authenticated = await authenticateSession(
            tx,
            valid.invocation.sessionToken,
            "authorize.session",
          );
          const touched = await touchSession(tx, authenticated);
          actorId = touched.account.account_id;
        } else {
          if (
            parentContext === undefined ||
            (causalRunRef === undefined && causalCommandRef === undefined)
          ) {
            throw makeAccessError("ACCESS_CONTRACT_INVALID", "authorize.parent", clock);
          }
          parent = await loadParentContext(tx, parentContext, valid.projectId, "authorize.parent");
          actorId = parent.actorId;
          if (causalCommandRef !== undefined) {
            commandExpiresAt = await assertCommandCause(
              tx,
              causalCommandRef,
              parent,
              valid.projectId,
              valid.branch,
            );
          }
          if (valid.invocation.kind === "system" && valid.invocation.systemActorId !== actorId) {
            throw authorizationDenied("authorize.parent", valid.branch);
          }
          if (effectiveScopes.length === 0) effectiveScopes = parent.spatialScopeRefs;
        }
        const current = await evaluateCurrentAccess(
          tx,
          actorId,
          valid.projectId,
          valid.branch,
          effectiveScopes,
          valid.requestedSourceVersionRefs,
          "authorize.current",
        );
        const contextRefValue = contextRef(randomId("authorization-context"), "1");
        const invocation =
          valid.invocation.kind === "human-session"
            ? { kind: "human" as const }
            : valid.invocation.kind === "system"
              ? {
                  kind: "system" as const,
                  systemActorId: valid.invocation.systemActorId,
                  reasonCode: valid.invocation.reasonCode,
                }
              : { kind: "agent-task" as const, agentTaskRef: valid.invocation.agentTaskRef };
        const context = AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: contextRefValue,
          actorId,
          projectId: valid.projectId,
          grantedCapabilities: [branchCapability(valid.branch)],
          spatialScopeRefs: current.spatialScopeRefs,
          sourceAccessGrantRefs: current.sourceAccessGrantRefs,
          authorizationPolicyRef: ACCESS_POLICY_REF_V1,
          decidedAt: iso(nowDate(clock)),
          invocation,
          ...(causalRunRef === undefined ? {} : { causalRunRef }),
          ...(causalCommandRef === undefined ? {} : { causalCommandRef }),
        });
        if (
          parent !== undefined &&
          !isAuthorizationSubset(parent, context, { scopeNodes: current.scopeNodes })
        ) {
          throw authorizationDenied("authorize.narrowing", valid.branch);
        }
        const existing = await tx
          .selectFrom("business.authorization_contexts")
          .selectAll()
          .where("invocation_id", "=", valid.invocationId)
          .where("project_id", "=", valid.projectId)
          .where("branch", "=", valid.branch)
          .executeTakeFirst();
        if (existing !== undefined) {
          const existingContext = await loadStoredContext(
            tx,
            contextRef(existing.context_id, existing.version_id),
          );
          if (
            existingContext?.context === undefined ||
            asDate(existing.expires_at).getTime() <= nowDate(clock).getTime()
          )
            throw makeAccessError("SESSION_EXPIRED", "authorize.context", clock);
          const existingSnapshot = existing.revision_snapshot;
          const existingSourceVersionRefs =
            typeof existingSnapshot === "object" &&
            existingSnapshot !== null &&
            !Array.isArray(existingSnapshot) &&
            "sourceVersionRefs" in existingSnapshot
              ? existingSnapshot.sourceVersionRefs
              : undefined;
          if (
            existingContext.context.actorId !== context.actorId ||
            existingContext.context.projectId !== context.projectId ||
            sha256CanonicalJson(existingContext.context.invocation) !==
              sha256CanonicalJson(context.invocation) ||
            existing.parent_context_id !==
              (parent?.authorizationContextRef.reference.entityId ?? null) ||
            sha256CanonicalJson(existing.causal_run_ref) !==
              sha256CanonicalJson(causalRunRef ?? null) ||
            sha256CanonicalJson(
              "causalCommandRef" in existingContext.context
                ? existingContext.context.causalCommandRef
                : null,
            ) !== sha256CanonicalJson(causalCommandRef ?? null) ||
            sha256CanonicalJson(existingSourceVersionRefs) !==
              sha256CanonicalJson(valid.requestedSourceVersionRefs) ||
            JSON.stringify(existingContext.context.grantedCapabilities) !==
              JSON.stringify(context.grantedCapabilities) ||
            JSON.stringify(existingContext.context.spatialScopeRefs) !==
              JSON.stringify(context.spatialScopeRefs) ||
            JSON.stringify(existingContext.context.sourceAccessGrantRefs) !==
              JSON.stringify(context.sourceAccessGrantRefs)
          ) {
            throw makeAccessError("IDEMPOTENCY_CONFLICT", "authorize.idempotency", clock, {
              idempotencyKey: valid.invocationId,
              priorCommandId: existing.invocation_id,
            });
          }
          await appendSecurityAudit(
            tx,
            securityAudit("authorize", "success", "AUTHORIZED_REPLAY", nowDate(clock), {
              subject_ref: actorId,
              project_ref: valid.projectId,
              request_ref: valid.invocationId,
              context_ref: jsonValue(existingContext.context.authorizationContextRef),
              policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
            }),
          );
          return AuthorizationDecisionV1Schema.parse({
            context: existingContext.context,
            contextRef: existingContext.context.authorizationContextRef,
            redacted: current.redacted,
          });
        }
        const sourceRefs = current.sourceAccessGrantRefs.map((grant) => grant.reference);
        const revisionSnapshot: JsonValue = {
          accountSecurityVersion: current.account.security_version,
          projectAccessVersion: current.project.access_version,
          membershipRevisionId: current.membership.revisionId,
          scopeRevisionIds: current.scopeNodes.map((node) => node.revisionId),
          sourceAccessGrantRefs: sourceRefs,
          sourceVersionRefs: valid.requestedSourceVersionRefs,
          ...(causalCommandRef === undefined ? {} : { causalCommandRef }),
        };
        await persistAuthorizationContext(
          tx,
          context,
          actorId,
          valid.invocationId,
          valid.branch,
          revisionSnapshot,
          parent?.authorizationContextRef.reference.entityId ?? null,
          causalRunRef === undefined ? null : jsonValue(causalRunRef),
          new Date(
            Math.min(
              new Date(context.decidedAt).getTime() + CONTEXT_TTL_MS,
              commandExpiresAt?.getTime() ?? Infinity,
            ),
          ),
          new Date(context.decidedAt),
        );
        await appendSecurityAudit(
          tx,
          securityAudit("authorize", "success", "AUTHORIZED", new Date(context.decidedAt), {
            subject_ref: actorId,
            project_ref: valid.projectId,
            request_ref: valid.invocationId,
            context_ref: jsonValue(context.authorizationContextRef),
            policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
          }),
        );
        return AuthorizationDecisionV1Schema.parse({
          context,
          contextRef: context.authorizationContextRef,
          redacted: current.redacted,
        });
      });
    } catch (error) {
      const mapped = asAccessError(error, "authorize", clock);
      if (valid.invocation.kind === "human-session" && mapped.details.code === "SESSION_REVOKED") {
        await revokeKnownToken(valid.invocation.sessionToken, "session-invalid").catch(
          () => undefined,
        );
      }
      await appendSecurityOutcomeOrThrow("authorize", "rejected", mapped.details.code, {
        project_ref: valid.projectId,
        request_ref: valid.invocationId,
        policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
        diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
      });
      throw mapped;
    }
  };

  const authorizeBusinessAction = async (
    input: BusinessActionAuthorizationInputV1,
  ): Promise<AuthorizationDecisionV1> => {
    const stage = "authorize.business-action";
    try {
      return await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        const membership = await queryMembership(tx, input.projectId, input.actorId);
        const branch =
          input.branch ??
          branchesForRoles(membership?.roles ?? []).find(
            (candidate) => branchCapability(candidate) === input.capability,
          );
        if (branch === undefined || branchCapability(branch) !== input.capability)
          throw authorizationDenied(stage, branch);
        const requestedSourceVersionRefs = await sourceVersionsForAccessGrants(tx, input, clock);
        const scopeGraph = await scopeNodes(tx, input.projectId);
        const currentScopes = (refs: readonly SpatialScopeRefV1[]): SpatialScopeRefV1[] =>
          refs.map((ref) => {
            const node = scopeGraph.find((scope) => scope.scopeId === ref.reference.entityId);
            if (node === undefined || node.status !== "active")
              throw authorizationDenied(stage, branch);
            return scopeRef(node.scopeId, node.revisionId);
          });
        const existing =
          input.authorizationContextRef === undefined
            ? undefined
            : await loadStoredContext(tx, input.authorizationContextRef);
        const taskRef =
          input.taskRef ??
          (existing?.context?.invocation.kind === "agent-task"
            ? existing.context.invocation.agentTaskRef
            : undefined);
        let requestedScopes = currentScopes(input.requestedSpatialScopeRefs);
        if (taskRef !== undefined) {
          const task = (await registeredTaskReader?.(taskRef))?.envelope;
          if (task === undefined) throw authorizationDenied(stage, branch);
          if (task.actorId !== input.actorId || task.projectId !== input.projectId)
            throw authorizationDenied(stage, branch);
          const frozenScopes = currentScopes(task.frozenAuthorization.spatialScopeRefs);
          if (requestedScopes.length === 0) requestedScopes = frozenScopes;
          if (!allSpatialScopesCovered(frozenScopes, requestedScopes, scopeGraph))
            throw authorizationDenied(stage, branch);
          const frozen = await loadStoredContext(tx, task.authorization.authorizationContextRef);
          const snapshot = frozen?.row.revision_snapshot;
          const sources =
            typeof snapshot === "object" &&
            snapshot !== null &&
            !Array.isArray(snapshot) &&
            "sourceVersionRefs" in snapshot &&
            Array.isArray(snapshot.sourceVersionRefs)
              ? snapshot.sourceVersionRefs
              : [];
          if (
            !requestedSourceVersionRefs.every((source) =>
              sources.some(
                (allowed) => sha256CanonicalJson(source) === sha256CanonicalJson(allowed),
              ),
            )
          )
            throw authorizationDenied(stage, branch);
        }
        const current = await evaluateCurrentAccess(
          tx,
          input.actorId,
          input.projectId,
          branch,
          requestedScopes,
          requestedSourceVersionRefs,
          stage,
        );
        const decidedAt = nowDate(clock);
        if (
          input.authorizationContextRef !== undefined &&
          (existing?.context === undefined ||
            existing.context.actorId !== input.actorId ||
            existing.context.projectId !== input.projectId ||
            !existing.context.grantedCapabilities.includes(input.capability))
        )
          throw authorizationDenied(stage, branch);
        const context = AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef:
            existing?.context?.authorizationContextRef ??
            contextRef(randomId("authorization-context"), "1"),
          actorId: input.actorId,
          projectId: input.projectId,
          grantedCapabilities: [input.capability],
          spatialScopeRefs: current.spatialScopeRefs,
          sourceAccessGrantRefs: current.sourceAccessGrantRefs,
          authorizationPolicyRef: ACCESS_POLICY_REF_V1,
          decidedAt: existing?.context?.decidedAt ?? iso(decidedAt),
          invocation:
            existing?.context?.invocation ??
            (taskRef === undefined
              ? { kind: "human" }
              : { kind: "agent-task", agentTaskRef: taskRef }),
          ...((existing?.context?.causalRunRef ?? input.causalRunRef) === undefined
            ? {}
            : { causalRunRef: existing?.context?.causalRunRef ?? input.causalRunRef }),
          ...(existing?.context !== undefined && "causalCommandRef" in existing.context
            ? { causalCommandRef: existing.context.causalCommandRef }
            : {}),
        });
        if (existing === undefined)
          await persistAuthorizationContext(
            tx,
            context,
            input.actorId,
            randomId("business-action"),
            branch,
            { sourceVersionRefs: jsonValue(requestedSourceVersionRefs) },
            null,
            input.causalRunRef === undefined ? null : jsonValue(input.causalRunRef),
            new Date(decidedAt.getTime() + CONTEXT_TTL_MS),
            decidedAt,
          );
        await appendSecurityAudit(
          tx,
          securityAudit("authorize", "success", "AUTHORIZED", decidedAt, {
            subject_ref: input.actorId,
            project_ref: input.projectId,
            request_ref: input.invocationId,
            context_ref: jsonValue(context.authorizationContextRef),
            policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
          }),
        );
        return AuthorizationDecisionV1Schema.parse({
          context,
          contextRef: context.authorizationContextRef,
          redacted: current.redacted,
        });
      });
    } catch (error) {
      const mapped = asAccessError(error, stage, clock);
      await appendSecurityOutcomeOrThrow("authorize", "rejected", mapped.details.code, {
        subject_ref: input.actorId,
        project_ref: input.projectId,
        request_ref: input.invocationId,
      });
      throw mapped;
    }
  };

  const filterVisibleSources: NonNullable<LocalIdentityAccessV1["filterVisibleSources"]> = async (
    input,
  ) => {
    const stage = "authorize.visible-sources";
    const branch = input.branch ?? "knowledge-modeling.hybrid-evidence";
    return db.transaction().execute(async (transaction) => {
      const tx = transaction as unknown as AccessDb;
      const authorization = input.authorization;
      const recorded = await loadStoredContext(tx, authorization.authorizationContextRef);
      if (
        recorded?.context === undefined ||
        recorded.context.actorId !== authorization.actorId ||
        recorded.context.projectId !== authorization.projectId ||
        !recorded.context.grantedCapabilities.includes(branchCapability(branch))
      )
        throw authorizationDenied(stage, branch);
      const current = await evaluateCurrentAccess(
        tx,
        authorization.actorId,
        authorization.projectId,
        branch,
        [],
        [],
        stage,
      );
      let sources = input.sourceVersionRefs;
      if (recorded.context.invocation.kind === "agent-task") {
        const task = (await registeredTaskReader?.(recorded.context.invocation.agentTaskRef))
          ?.envelope;
        if (
          task === undefined ||
          task.actorId !== authorization.actorId ||
          task.projectId !== authorization.projectId
        )
          throw authorizationDenied(stage, branch);
        const stored = await loadStoredContext(tx, task.authorization.authorizationContextRef);
        const snapshot = stored?.row.revision_snapshot as
          { sourceVersionRefs?: unknown[] } | undefined;
        const frozenSources = snapshot?.sourceVersionRefs ?? [];
        sources = sources.filter((source) =>
          frozenSources.some(
            (frozen) => sha256CanonicalJson(frozen) === sha256CanonicalJson(source),
          ),
        );
      }
      const revisions = await queryCurrentScopeRevisions(tx, authorization.projectId);
      const root = current.scopeNodes.find(
        (node) => node.scopeId === current.project.root_scope_id,
      )!;
      const visible: SourceVersionRefV1[] = [];
      for (const source of sources) {
        const policy = await querySourcePolicy(
          tx,
          authorization.projectId,
          source,
          scopeRef(root.scopeId, root.revisionId),
          revisions,
        );
        if (policy === undefined) continue;
        const access = evaluateSourceAccess({
          accountId: authorization.actorId,
          projectId: authorization.projectId,
          roles: current.membership.roles,
          branch,
          membershipActive: true,
          grantedScopeRefs: current.spatialScopeRefs,
          policy,
          scopeNodes: current.scopeNodes,
          requireBody: true,
        });
        const frozenScopes = recorded.context.spatialScopeRefs.flatMap((ref) => {
          const node = current.scopeNodes.find(
            (node) => node.scopeId === ref.reference.entityId && node.status === "active",
          );
          return node === undefined ? [] : [scopeRef(node.scopeId, node.revisionId)];
        });
        if (
          access.bodyAllowed &&
          allSpatialScopesCovered(frozenScopes, policy.spatialScopeRefs, current.scopeNodes)
        )
          visible.push(source);
      }
      await appendSecurityAudit(
        tx,
        securityAudit("authorize", "success", "AUTHORIZED", nowDate(clock), {
          subject_ref: authorization.actorId,
          project_ref: authorization.projectId,
          context_ref: jsonValue(authorization.authorizationContextRef),
          policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
        }),
      );
      return visible;
    });
  };

  const verify: PostgresLocalIdentityAccess["verify"] = async (request) => {
    const valid = AuthorizationVerificationRequestV1Schema.parse(request);
    const stored = await loadStoredContext(db, valid.authorizationContextRef);
    if (stored?.context === undefined || stored.context.projectId !== valid.projectId)
      throw authorizationDenied("verify.context", valid.branch);
    const snapshot = stored.row.revision_snapshot;
    const sources =
      typeof snapshot === "object" &&
      snapshot !== null &&
      !Array.isArray(snapshot) &&
      "sourceVersionRefs" in snapshot &&
      Array.isArray(snapshot.sourceVersionRefs)
        ? snapshot.sourceVersionRefs.map((source) => SourceVersionRefV1Schema.parse(source))
        : [];
    return authorizeBusinessAction({
      actorId: stored.context.actorId,
      projectId: valid.projectId,
      branch: valid.branch,
      capability: branchCapability(valid.branch),
      invocationId: valid.invocationId,
      authorizationContextRef: valid.authorizationContextRef,
      requestedSpatialScopeRefs:
        valid.requestedSpatialScopeRefs.length === 0
          ? stored.context.spatialScopeRefs
          : valid.requestedSpatialScopeRefs,
      requestedSourceVersionRefs:
        valid.requestedSourceVersionRefs.length === 0 ? sources : valid.requestedSourceVersionRefs,
    });
  };

  const readIssuedContext: PostgresLocalIdentityAccess["readIssuedContext"] = async (input) => {
    const branch = ModuleBranchV1Schema.safeParse(input.branch);
    if (!branch.success) return undefined;
    const rows = await db
      .selectFrom("business.authorization_contexts")
      .selectAll()
      .where("invocation_id", "=", input.invocationId)
      .where("branch", "=", input.branch)
      .where("project_id", "=", input.projectId)
      .where("actor_id", "=", input.actorId)
      .execute();
    if (rows.length !== 1) return undefined;
    const row = rows[0]!;
    if (row.context_kind !== "c02" || row.context_json === null) return undefined;
    const parsed = AuthorizationContextV1Schema.safeParse(row.context_json);
    if (
      !parsed.success ||
      parsed.data.actorId !== row.actor_id ||
      parsed.data.projectId !== row.project_id ||
      parsed.data.authorizationContextRef.reference.entityId !== row.context_id ||
      parsed.data.authorizationContextRef.reference.versionId !== row.version_id ||
      parsed.data.grantedCapabilities.length !== 1 ||
      !parsed.data.grantedCapabilities.includes(branchCapability(branch.data))
    ) {
      return undefined;
    }
    return parsed.data;
  };

  const readDeploymentAuthorizationSource: PostgresLocalIdentityAccess["readDeploymentAuthorizationSource"] =
    async (input) => {
      const stored = await loadStoredContext(db, input.authorizationContextRef);
      if (stored?.context === undefined || stored.row.context_kind !== "c02") return undefined;
      const row = stored.row;
      const context = stored.context;
      const branch = ModuleBranchV1Schema.safeParse(row.branch);
      if (
        (input.actorId !== undefined && row.actor_id !== input.actorId) ||
        context.actorId !== row.actor_id ||
        row.project_id !== input.projectId ||
        context.projectId !== input.projectId ||
        context.authorizationContextRef.reference.entityId !== row.context_id ||
        context.authorizationContextRef.reference.versionId !== row.version_id ||
        !branch.success ||
        context.grantedCapabilities.length !== 1 ||
        !context.grantedCapabilities.includes(branchCapability(branch.data)) ||
        context.authorizationPolicyRef.entityId !== ACCESS_POLICY_REF_V1.entityId ||
        // CH-2（design D-06）：这里只解析旧快照的登记来源与范围，返回值不是放行凭据；
        // 当前动作仍由 verifyDeploymentContext / authorizeBusinessAction 重新判权。
        !isRegisteredAccessPolicyVersion(context.authorizationPolicyRef.versionId)
      ) {
        return undefined;
      }

      // 原因果引用：行与正文必须一致；human 会话两边都没有是合法来源。
      let causalRunRef: WorkflowRunRefV1 | undefined;
      if (row.causal_run_ref !== null) {
        const parsedRowCausal = WorkflowRunRefV1Schema.safeParse(row.causal_run_ref);
        if (!parsedRowCausal.success) return undefined;
        causalRunRef = parsedRowCausal.data;
      }
      const contextCausal = "causalRunRef" in context ? context.causalRunRef : undefined;
      if (causalRunRef === undefined) {
        if (contextCausal !== undefined) return undefined;
      } else if (
        contextCausal === undefined ||
        contextCausal.kind !== causalRunRef.kind ||
        contextCausal.reference.entityId !== causalRunRef.reference.entityId ||
        contextCausal.reference.versionId !== causalRunRef.reference.versionId
      ) {
        return undefined;
      }

      // 父引用：从实际父行取 versionId，不补默认版本；父必须同工程同主体且存在。
      let parentContextRef: AuthorizationContextRefV1 | undefined;
      if (row.parent_context_id !== null) {
        const parentRows = await db
          .selectFrom("business.authorization_contexts")
          .select(["context_id", "version_id", "project_id", "actor_id"])
          .where("context_id", "=", row.parent_context_id)
          .limit(2)
          .execute();
        const parentRow = parentRows.find(
          (candidate) =>
            candidate.project_id === input.projectId && candidate.actor_id === context.actorId,
        );
        if (parentRows.length !== 1 || parentRow === undefined) return undefined;
        parentContextRef = contextRef(parentRow.context_id, parentRow.version_id);
      }

      // 来源版本引用：签发快照里逐项用原 Schema 严格解析，坏项不忽略；有界不截断。
      const snapshot = row.revision_snapshot;
      if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot))
        return undefined;
      const rawCommand = "causalCommandRef" in snapshot ? snapshot.causalCommandRef : undefined;
      const contextCommand = "causalCommandRef" in context ? context.causalCommandRef : undefined;
      let causalCommandRef: CommandCausalRefV1 | undefined;
      if (rawCommand !== undefined || contextCommand !== undefined) {
        const parsedCommand = CommandCausalRefV1Schema.safeParse(rawCommand);
        if (
          !parsedCommand.success ||
          contextCommand === undefined ||
          causalRunRef !== undefined ||
          sha256CanonicalJson(parsedCommand.data) !== sha256CanonicalJson(contextCommand)
        )
          return undefined;
        causalCommandRef = parsedCommand.data;
      }
      const rawSources = "sourceVersionRefs" in snapshot ? snapshot.sourceVersionRefs : undefined;
      if (!Array.isArray(rawSources)) return undefined;
      if (rawSources.length > DEPLOYMENT_SOURCE_VERSION_REF_LIMIT) return undefined;
      const sourceVersionRefs = rawSources.map((value) => {
        const parsedSource = SourceVersionRefV1Schema.safeParse(value);
        if (!parsedSource.success) return undefined;
        return parsedSource.data;
      });
      if (sourceVersionRefs.some((item) => item === undefined)) return undefined;

      return {
        context,
        invocationId: row.invocation_id,
        branch: branch.data,
        parentContextRef,
        causalRunRef,
        causalCommandRef,
        sourceVersionRefs: sourceVersionRefs as readonly SourceVersionRefV1[],
      };
    };

  const deploymentVerificationSchema = AuthorizationVerificationRequestV1Schema.omit({
    invocationId: true,
    branch: true,
  }).extend({
    actorId: IdentifierSchema,
    requiredCapability: ModuleCapabilityV1Schema,
    requestedSourceAccessGrantRefs: z.array(SourceAccessGrantRefV1Schema).max(256).optional(),
  });
  const verifyDeploymentContext: PostgresLocalIdentityAccess["verifyDeploymentContext"] = async (
    input,
  ) => {
    const parsed = deploymentVerificationSchema.safeParse(input);
    if (!parsed.success)
      throw makeAccessError("ACCESS_CONTRACT_INVALID", "verify.deployment-command", clock);
    const valid = parsed.data;
    let invocationId: string;
    let branch: ModuleBranchV1;
    try {
      const stored = await loadStoredContext(db, valid.authorizationContextRef);
      const storedBranch = ModuleBranchV1Schema.safeParse(stored?.row.branch);
      if (
        stored?.context === undefined ||
        stored.row.context_kind !== "c02" ||
        !storedBranch.success ||
        stored.row.actor_id !== valid.actorId ||
        stored.context.actorId !== valid.actorId ||
        stored.row.project_id !== valid.projectId ||
        stored.context.projectId !== valid.projectId ||
        branchCapability(storedBranch.data) !== valid.requiredCapability
      )
        throw makeAccessError("AUTHORIZATION_DENIED", "verify.deployment-binding", clock);
      invocationId = stored.row.invocation_id;
      branch = storedBranch.data;
    } catch (error) {
      const mapped = asAccessError(error, "verify.deployment-context", clock);
      await appendSecurityOutcomeOrThrow("verify", "rejected", mapped.details.code, {
        subject_ref: valid.actorId,
        project_ref: valid.projectId,
        context_ref: jsonValue(valid.authorizationContextRef),
        diagnostic_ref: jsonValue(mapped.details.diagnosticRef),
      });
      throw mapped;
    }
    return verify({
      authorizationContextRef: valid.authorizationContextRef,
      invocationId,
      branch,
      projectId: valid.projectId,
      requestedSpatialScopeRefs: valid.requestedSpatialScopeRefs,
      requestedSourceVersionRefs: [...(await sourceVersionsForAccessGrants(db, valid, clock))],
      requestedAt: valid.requestedAt,
    });
  };

  /**
   * 会话自省同一路径上的管理身份判定：只有账号当前持有管理员授予才返回管理员身份。
   *
   * 刻意不接受任何调用方传入的管理上下文，也不在此推断工程业务能力——管理面只回答
   * 「这个账号现在是不是系统管理员」，普通有效会话因此只会得到 false。
   */
  const currentAdministrationIdentity = async (
    database: AccessDb,
    sessionToken: string,
    stage: string,
    requireAdministration: boolean,
  ): Promise<{ readonly account: LocalAccountRow; readonly isSystemAdministrator: boolean }> => {
    const authenticated = await authenticateSession(database, sessionToken, stage, true);
    const administrator = isSystemAdministrator(authenticated.account);
    if (!administrator && requireAdministration) {
      throw makeAccessError("AUTHORIZATION_DENIED", stage, clock);
    }
    return { account: authenticated.account, isSystemAdministrator: administrator };
  };

  const directoryPageSize = (pageSize: number | undefined): number =>
    pageSize ?? SYSTEM_ADMINISTRATION_PAGE_SIZE_DEFAULT_V1;

  /**
   * 取本次调用的服务端管理授权引用。
   *
   * 授权上下文由唯一约束绑定在 (invocation_id, project_id, branch) 上，因此同一 commandId
   * 的网络重试必须复用同一个引用——幂等收据才认得这是同一次命令，而不是异载荷冲突。
   * 只有仍然有效、属于同一 actor 且安全修订一致的那一个才可复用；已过期或已冻结的引用
   * 不会被捡起来继续用。
   */
  const administrationContextRef = async (
    database: AccessDb,
    account: LocalAccountRow,
    invocationId: string,
    now: Date,
  ): Promise<AuthorizationContextRefV1> => {
    const existing = await database
      .selectFrom("business.authorization_contexts")
      .select(["context_id", "version_id", "actor_id", "revision_snapshot", "expires_at"])
      .where("invocation_id", "=", invocationId)
      .where("project_id", "=", SYSTEM_NAMESPACE)
      .where("branch", "=", "access-administration")
      .executeTakeFirst();
    const snapshot = existing?.revision_snapshot;
    const currentSecurityVersion =
      typeof snapshot === "object" &&
      snapshot !== null &&
      !Array.isArray(snapshot) &&
      "accountSecurityVersion" in snapshot
        ? snapshot.accountSecurityVersion
        : undefined;
    if (
      existing !== undefined &&
      existing.actor_id === account.account_id &&
      currentSecurityVersion === account.security_version &&
      asDate(existing.expires_at).getTime() > now.getTime()
    ) {
      return contextRef(existing.context_id, existing.version_id);
    }
    return insertSystemAdministrationContext(database, account, invocationId, now);
  };

  /**
   * 账号目录：有界 keyset，只按当前访问事实投影显示身份、状态与当前版本引用。
   *
   * 游标是上一页最后一个账号标识；`security_version` 作为账号当前修订，
   * 密码派生值与会话 token 都不在此投影。
   */
  const readAccountDirectory = async (
    database: AccessDb,
    cursor: string | undefined,
    pageSize: number,
  ): Promise<SystemAdministrationReadResultPayloadV1> => {
    const rows = await database
      .selectFrom("business.local_accounts")
      .select([
        "account_id",
        "login_name",
        "display_name",
        "status",
        "password_change_required",
        "security_version",
      ])
      .where("account_id", ">", cursor ?? "")
      .orderBy("account_id")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    return {
      kind: "accounts",
      items: page.map((row) => ({
        accountRef: accountRevisionRef(row.account_id, row.security_version),
        loginName: row.login_name,
        displayName: row.display_name,
        status: row.status,
        passwordChangeRequired: row.password_change_required,
      })),
      ...(rows.length > pageSize && page.length > 0
        ? { nextCursor: page[page.length - 1]!.account_id }
        : {}),
    };
  };

  /** 工程目录：工程标识、状态、当前访问修订与根范围引用，不含任何业务对象。 */
  const readProjectDirectory = async (
    database: AccessDb,
    cursor: string | undefined,
    pageSize: number,
  ): Promise<SystemAdministrationReadResultPayloadV1> => {
    const rows = await database
      .selectFrom("business.access_projects")
      .select(["project_id", "status", "access_version", "root_scope_id"])
      .where("project_id", ">", cursor ?? "")
      .orderBy("project_id")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    const rootScopeIds = page.map((row) => row.root_scope_id);
    const roots =
      rootScopeIds.length === 0
        ? []
        : await database
            .selectFrom("business.access_spatial_scopes")
            .select(["scope_id", "current_revision_id"])
            .where("scope_id", "in", rootScopeIds)
            .execute();
    const rootByScope = new Map(roots.map((root) => [root.scope_id, root.current_revision_id]));
    return {
      kind: "projects",
      items: page.map((row) => {
        const rootRevisionId = rootByScope.get(row.root_scope_id);
        return {
          projectId: row.project_id,
          status: row.status,
          accessRevisionRef: ref(row.project_id, String(row.access_version)),
          ...(rootRevisionId === undefined
            ? {}
            : { rootScopeRef: scopeRef(row.root_scope_id, rootRevisionId) }),
        };
      }),
      ...(rows.length > pageSize && page.length > 0
        ? { nextCursor: page[page.length - 1]!.project_id }
        : {}),
    };
  };

  /**
   * 成员目录：只暴露成员引用、所属账号、原预设角色集合、当前空间范围引用与状态。
   * 角色集合原样取自当前修订，不做任何角色扩写或能力推断。
   */
  const readMembershipDirectory = async (
    database: AccessDb,
    projectId: string,
    cursor: string | undefined,
    pageSize: number,
  ): Promise<SystemAdministrationReadResultPayloadV1> => {
    const rows = await database
      .selectFrom("business.project_memberships")
      .select(["membership_id", "current_revision_id"])
      .where("project_id", "=", projectId)
      .where("membership_id", ">", cursor ?? "")
      .orderBy("membership_id")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    const revisionIds = page.map((row) => row.current_revision_id);
    if (revisionIds.length === 0) {
      return { kind: "memberships", projectId, items: [] };
    }
    const [revisions, currentScopes] = await Promise.all([
      database
        .selectFrom("business.project_membership_revisions")
        .select(["revision_id", "account_id", "revision_no", "status"])
        .where("revision_id", "in", revisionIds)
        .execute(),
      queryCurrentScopeRevisions(database, projectId),
    ]);
    const [roles, scopeLinks] = await Promise.all([
      database
        .selectFrom("business.project_membership_revision_roles")
        .select(["revision_id", "role"])
        .where("revision_id", "in", revisionIds)
        .execute(),
      database
        .selectFrom("business.project_membership_revision_scopes")
        .select(["revision_id", "scope_id"])
        .where("revision_id", "in", revisionIds)
        .execute(),
    ]);
    const revisionById = new Map(revisions.map((revision) => [revision.revision_id, revision]));
    const accountIds = [...new Set(revisions.map((revision) => revision.account_id))];
    const accounts =
      accountIds.length === 0
        ? []
        : await database
            .selectFrom("business.local_accounts")
            .select(["account_id", "security_version"])
            .where("account_id", "in", accountIds)
            .execute();
    const accountById = new Map(accounts.map((account) => [account.account_id, account]));
    const roleByRevision = new Map<string, string[]>();
    for (const row of roles) {
      const bucket = roleByRevision.get(row.revision_id) ?? [];
      bucket.push(row.role);
      roleByRevision.set(row.revision_id, bucket);
    }
    const scopeByRevision = new Map<string, string[]>();
    for (const row of scopeLinks) {
      const bucket = scopeByRevision.get(row.revision_id) ?? [];
      bucket.push(row.scope_id);
      scopeByRevision.set(row.revision_id, bucket);
    }
    const items = page.flatMap((row) => {
      const revision = revisionById.get(row.current_revision_id);
      if (revision === undefined) return [];
      const membership: MembershipSnapshot = {
        membershipId: row.membership_id,
        revisionId: revision.revision_id,
        accountId: revision.account_id,
        projectId,
        revisionNo: revision.revision_no,
        status: revision.status,
        roles: (roleByRevision.get(revision.revision_id) ?? []) as MembershipSnapshot["roles"],
        scopeIds: scopeByRevision.get(revision.revision_id) ?? [],
      };
      return [
        {
          membershipRef: ref(membership.membershipId, String(membership.revisionNo)),
          accountRef: accountRevisionRef(
            membership.accountId,
            accountById.get(membership.accountId)?.security_version ?? 1,
          ),
          roles: [...membership.roles],
          spatialScopeRefs: currentScopeRefsForMembership(membership, currentScopes),
          status: membership.status,
        },
      ];
    });
    return {
      kind: "memberships",
      projectId,
      items,
      ...(rows.length > pageSize && page.length > 0
        ? { nextCursor: page[page.length - 1]!.membership_id }
        : {}),
    };
  };

  /** 空间范围目录：精确范围引用、可选父引用与状态，全部取自当前修订。 */
  const readSpatialScopeDirectory = async (
    database: AccessDb,
    projectId: string,
    cursor: string | undefined,
    pageSize: number,
  ): Promise<SystemAdministrationReadResultPayloadV1> => {
    const rows = await database
      .selectFrom("business.access_spatial_scopes")
      .select(["scope_id", "current_revision_id"])
      .where("project_id", "=", projectId)
      .where("scope_id", ">", cursor ?? "")
      .orderBy("scope_id")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    const revisionIds = page.map((row) => row.current_revision_id);
    if (revisionIds.length === 0) {
      return { kind: "spatial-scopes", projectId, items: [] };
    }
    const revisions = await database
      .selectFrom("business.access_spatial_scope_revisions")
      .select(["revision_id", "scope_id", "parent_scope_id", "status"])
      .where("revision_id", "in", revisionIds)
      .execute();
    const revisionById = new Map(revisions.map((revision) => [revision.revision_id, revision]));
    const parentScopeIds = [
      ...new Set(
        revisions.flatMap((revision) =>
          revision.parent_scope_id === null ? [] : [revision.parent_scope_id],
        ),
      ),
    ];
    const parents =
      parentScopeIds.length === 0
        ? []
        : await database
            .selectFrom("business.access_spatial_scopes")
            .select(["scope_id", "current_revision_id"])
            .where("scope_id", "in", parentScopeIds)
            .execute();
    const parentByScope = new Map(
      parents.map((parent) => [parent.scope_id, parent.current_revision_id]),
    );
    const items = page.flatMap((row) => {
      const revision = revisionById.get(row.current_revision_id);
      if (revision === undefined) return [];
      const parentScopeId = revision.parent_scope_id ?? undefined;
      const parentRevisionId =
        parentScopeId === undefined ? undefined : parentByScope.get(parentScopeId);
      return [
        {
          scopeId: revision.scope_id,
          scopeRef: scopeRef(revision.scope_id, revision.revision_id),
          ...(parentScopeId === undefined || parentRevisionId === undefined
            ? {}
            : { parentScopeRef: scopeRef(parentScopeId, parentRevisionId) }),
          status: revision.status,
        },
      ];
    });
    return {
      kind: "spatial-scopes",
      projectId,
      items,
      ...(rows.length > pageSize && page.length > 0
        ? { nextCursor: page[page.length - 1]!.scope_id }
        : {}),
    };
  };

  /**
   * 系统管理读：只接受服务端取得的 Cookie 会话 token。
   *
   * `identity` 是普通有效会话唯一能成功返回的读；其余目录在任何目标查询之前先重新验证
   * 会话有效、账号当前持有管理员授予、首次改密不阻塞与安全修订一致，因此无资格调用方
   * 既拿不到目录，也无法通过差异响应探测工程、成员或范围是否存在。
   */
  const administrationRead = async (
    request: SystemAdministrationReadQueryV1,
  ): Promise<SystemAdministrationReadResultV1> => {
    const parsed = SystemAdministrationReadQueryV1Schema.safeParse(request);
    if (!parsed.success)
      return {
        kind: "failed",
        error: makeAccessError("ACCESS_CONTRACT_INVALID", "administration.read", clock).details,
      };
    const valid = parsed.data;
    const stage = `administration.${valid.kind}`;
    try {
      return await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        const identity = await currentAdministrationIdentity(
          tx,
          valid.sessionToken,
          stage,
          valid.kind !== "identity",
        );
        if (valid.kind === "identity") {
          // 在端口边界按唯一 DTO 校验，管理面不会返回契约之外的形状。
          return SystemAdministrationReadResultV1Schema.parse({
            kind: "succeeded",
            result: {
              kind: "identity",
              isSystemAdministrator: identity.isSystemAdministrator,
              accountRef: accountRevisionRef(
                identity.account.account_id,
                identity.account.security_version,
              ),
              allowedActions: identity.isSystemAdministrator ? [...SYSTEM_ACCESS_ACTIONS_V1] : [],
            },
          });
        }
        const pageSize = directoryPageSize(valid.pageSize);
        const result =
          valid.kind === "accounts"
            ? await readAccountDirectory(tx, valid.cursor, pageSize)
            : valid.kind === "projects"
              ? await readProjectDirectory(tx, valid.cursor, pageSize)
              : valid.kind === "memberships"
                ? await readMembershipDirectory(tx, valid.projectId, valid.cursor, pageSize)
                : await readSpatialScopeDirectory(tx, valid.projectId, valid.cursor, pageSize);
        return SystemAdministrationReadResultV1Schema.parse({ kind: "succeeded", result });
      });
    } catch (error) {
      return {
        kind: "failed",
        error: asAccessError(error, stage, clock).details,
      };
    }
  };

  /**
   * 系统管理写：把六项原 C06 管理命令的载荷包进服务端铸造的管理授权上下文后转发。
   *
   * 载荷原样保留 expectedVersion 与工程标识，密码只存在于本次请求对象中，
   * 幂等收据、密码策略、凭据撤销与原子安全审计全部沿原命令实现。
   */
  const administrationExecute = async (
    command: SystemAdministrationCommandV1,
  ): Promise<SystemAdministrationExecuteResultV1> => {
    const parsed = SystemAdministrationCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return {
        kind: "failed",
        error: makeAccessError("ACCESS_CONTRACT_INVALID", "administration.execute", clock).details,
      };
    const valid = parsed.data;
    const stage = `administration.${valid.payload.kind}`;
    try {
      const authorizationContextRef = await db.transaction().execute(async (transaction) => {
        const tx = transaction as unknown as AccessDb;
        const identity = await currentAdministrationIdentity(tx, valid.sessionToken, stage, true);
        if (identity.account.password_change_required) {
          throw makeAccessError("PASSWORD_CHANGE_REQUIRED", stage, clock);
        }
        return administrationContextRef(tx, identity.account, valid.commandId, nowDate(clock));
      });
      const forwarded = {
        ...valid.payload,
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        authorizationContextRef,
      };
      const result =
        valid.payload.kind === "open-project" ||
        valid.payload.kind === "suspend-project" ||
        valid.payload.kind === "revise-membership"
          ? await projectCommand(forwarded as ProjectAccessCommandV1)
          : await identityCommand(forwarded as IdentityAdministrationCommandV1);
      return SystemAdministrationExecuteResultV1Schema.parse({ kind: "succeeded", result });
    } catch (error) {
      return {
        kind: "failed",
        error: asAccessError(error, stage, clock).details,
      };
    }
  };

  const executeDeploymentProjectAccess: PostgresLocalIdentityAccess["executeDeploymentProjectAccess"] =
    async ({ sessionToken, command }) => {
      const stage = "deployment.project-access";
      try {
        const { authorizationContextRef, projectCommandInput } = await db
          .transaction()
          .execute(async (transaction) => {
            const tx = transaction as unknown as AccessDb;
            const identity = await currentAdministrationIdentity(tx, sessionToken, stage, true);
            if (identity.account.password_change_required) {
              throw makeAccessError("PASSWORD_CHANGE_REQUIRED", stage, clock);
            }
            const parsedCommand = deploymentProjectAccessCommandSchema.safeParse(command);
            if (!parsedCommand.success) {
              throw makeAccessError("ACCESS_CONTRACT_INVALID", stage, clock);
            }
            return {
              projectCommandInput: parsedCommand.data,
              authorizationContextRef: await administrationContextRef(
                tx,
                identity.account,
                parsedCommand.data.commandId,
                nowDate(clock),
              ),
            };
          });
        return await projectCommand(
          ProjectAccessCommandV1Schema.parse({
            ...projectCommandInput,
            authorizationContextRef,
          }),
        );
      } catch (error) {
        throw asAccessError(error, stage, clock);
      }
    };

  const systemAdministration: SystemAdministrationPortV1 = {
    read: administrationRead,
    execute: administrationExecute,
  };

  /**
   * CH-2（design D-07）：当前工程入口能力呈现。
   *
   * 在短只读事务里复用既有会话验证、当前账号、工程与当前成员查询，按服务端角色并集
   * 映射出入口资格投影。它不签发授权上下文、不新建业务收据：受限会话、停用账号、
   * 非成员或暂停工程一律按既有边界拒绝，审计沿用既有安全访问事件且失败即整体失败。
   * 权限被撤销后旧工程不再返回任何能力，前端拿到的只是当前角色级入口资格。
   */
  const projectAccessPresentation: ProjectAccessPresentationPortV1 = {
    read: async (
      request: ProjectAccessPresentationRequestV1,
    ): Promise<ProjectAccessPresentationV1> => {
      const parsed = ProjectAccessPresentationRequestV1Schema.safeParse(request);
      if (!parsed.success)
        throw makeAccessError("ACCESS_CONTRACT_INVALID", "project-access.read", clock);
      const valid = parsed.data;
      try {
        return await db.transaction().execute(async (transaction) => {
          const tx = transaction as unknown as AccessDb;
          // 首次改密按原会话规则拒绝（PASSWORD_CHANGE_REQUIRED），不接受受限会话读入口。
          const authenticated = await authenticateSession(
            tx,
            valid.sessionToken,
            "project-access.read",
          );
          const project = await queryProject(tx, valid.projectId);
          if (project === undefined || project.status !== "active") {
            throw makeAccessError("AUTHORIZATION_DENIED", "project-access.read", clock);
          }
          const membership = await queryMembership(
            tx,
            valid.projectId,
            authenticated.account.account_id,
          );
          if (membership === undefined || membership.status !== "active") {
            throw makeAccessError("AUTHORIZATION_DENIED", "project-access.read", clock);
          }
          const touched = await touchSession(tx, authenticated);
          await appendSecurityAudit(
            tx,
            securityAudit("project-access.read", "success", "ACCESS_PRESENTED", nowDate(clock), {
              subject_ref: touched.account.account_id,
              project_ref: valid.projectId,
              request_ref: valid.requestId,
              policy_ref: jsonValue(ACCESS_POLICY_REF_V1),
            }),
          );
          return ProjectAccessPresentationV1Schema.parse({
            schemaVersion: "1",
            projectId: valid.projectId,
            capabilities: capabilitiesForBranches(branchesForRoles(membership.roles)),
            authorizationPolicyRef: ACCESS_POLICY_REF_V1,
          });
        });
      } catch (error) {
        throw asAccessError(error, "project-access.read", clock);
      }
    },
  };

  return {
    systemAdministration,
    projectAccessPresentation,
    executeDeploymentProjectAccess,
    administerIdentity: identityCommand,
    administerProject: projectCommand,
    login,
    changePassword,
    logout,
    readSession,
    authorize,
    authorizeBusinessAction,
    filterVisibleSources,
    verify,
    readIssuedContext,
    readDeploymentAuthorizationSource,
    verifyDeploymentContext,
    close: runtime.close,
  };
};
