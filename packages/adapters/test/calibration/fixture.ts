/**
 * C29 PostgreSQL 纵向夹具：正式迁移链 + C03 事务 + C04 内容寻址工件 + 真实 C06 会话/授权 +
 * 真实 C07 复核与审计适配器 + 真实 C08 bounded agent 运行时 + calibration adapter。
 *
 * 夹具只按公共契约提供 C29 无法自造的三类前置：C28 偏差事实、C19 评估依据成员与 C16 治理接缝；
 * 批准证明、复核决定、任务完成结果与公共偏差记录全部由真实适配器与真实事务产生。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Kysely } from "kysely";

import {
  AccessServiceError,
  type AuthorizationDecisionV1,
  type AuthorizationVerificationRequestV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  AgentCommandProposalV1Schema,
  AgentTaskBudgetPolicyV1Schema,
  AgentTaskDefinitionRegistry,
  buildCompletedAgentTaskResult,
  type AgentTaskDefinitionV1,
  type AgentTaskRefV1,
  type AgentTaskResultRefV1,
} from "@riskflow/core/agent-runtime";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactRefV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  DeviationPolicyV1Schema,
  type AssessmentConfigurationDocumentV1,
  type DeviationPolicyV1,
} from "@riskflow/core/assessment-config";
import {
  CalibrationCandidateV1Schema,
  CalibrationReviewOutcomeCommandV1Schema,
  CalibrationValidationPolicyV1Schema,
  type CalibrationGovernanceDraftResultV1,
  type CalibrationInputSnapshotRefV1,
  type CalibrationOperationV1,
  type CalibrationPrepareInputCommandV1,
  type CalibrationPrepareInputResultV1,
  type CalibrationReviewOutcomeCommandV1,
  type CalibrationReviewOutcomeResultV1,
  type CalibrationValidationPolicyV1,
  type CreateCalibrationSuggestionCommandV1,
} from "@riskflow/core/calibration";
import { canonicalJson, sha256CanonicalJson } from "@riskflow/core/persistence";
import {
  ResponseDeviationFactV1Schema,
  type ResponseDeviationFactReaderV1,
  type ResponseDeviationFactV1,
} from "@riskflow/core/response-lifecycle";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import type { AssessmentInputSnapshotReaderV1 } from "@riskflow/core/risk-assessment/engine";
import {
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  SpatialScopeRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewRequestV1Schema,
  WarningResponseRecordCommandV1Schema,
  WarningResponseRecordResultV1Schema,
  type AuthorizationContextV1,
  type CalibrationSuggestionApprovalProofPortV1,
  type ContentArtifactRefV1,
  type DeviationRecordRefV1,
  type KnowledgeReleaseRefV1,
  type ModuleCapabilityV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
  type SpatialScopeRefV1,
  type VersionReference,
  type WarningResponseRecordResultV1,
} from "@riskflow/contracts/ports";
import { CalibrationSuggestionRefV1Schema } from "@riskflow/contracts/ports";

import {
  createPostgresCalibrationAdapter,
  type CalibrationDownstreamAuthorizerV1,
  type PostgresCalibrationAdapter,
  type SubmitRevisionCommandV1,
} from "../../src/calibration/index.js";
import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
  type PostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import type { PostgresDatabase } from "../../src/postgres/types.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";
import {
  c25ConfigurationDocuments,
  c25Digest,
  c25ReleaseRef,
  c25RevisionRef,
  c25Version,
} from "../../../core/test/risk-assessment/fixture.js";

export const C29_FIXTURE_TIME = "2031-01-01T00:00:00.000Z";
/** C29 命令分支：与公共 `create-calibration-suggestion` 同属 `warning-response.record` 能力。 */
const C29_CALIBRATION_BRANCH = "warning-response.create-calibration-suggestion";
const C29_CALIBRATION_CAPABILITY = "warning-response.record";
/**
 * C04 读取所需的 `knowledge-modeling.read` 由 C19 依据分支签发；C08 结果窄读所需的
 * `agent-task.read` 由 C08 私有分支签发。夹具按精确用途现取，绝不复用上游上下文。
 */
const C29_ARTIFACT_READ_BRANCH = "knowledge-modeling.assessment-basis";
const C29_START_TASK_BRANCH = "agent-task.start-task";
export const C29_SUGGESTION_EVENT_TYPE = "warning.calibration-suggestion-created.v1";
const C29_CONFIGURATION_MEDIA_TYPE = "application/vnd.riskflow.assessment-configuration+json";
/** C29 冻结输入工件与候选工件的用途码/媒体类型（C04 读取按用途精确匹配）。 */
export const C29_FROZEN_INPUT_PURPOSE = "warning-response.calibration-input-snapshot";
export const C29_CANDIDATE_PURPOSE = "knowledge-modeling.calibration-candidate";
/** C08 自有的工件用途码：C29 必须按同一用途读取候选正文。 */
const C29_AGENT_INCREMENT_PURPOSE = "agent-increment";
const C29_AGENT_CANDIDATE_PURPOSE = "agent-candidate";
const C29_AGENT_INTENT_PURPOSE = "agent-action-intent";
const C29_AGENT_ACTION_RESULT_PURPOSE = "agent-action-result";
const CALIBRATION_TASK_TYPE = "calibration-suggestion";
const AGENT_MEDIA_TYPE = "application/json";

const ADMIN_LOGIN_NAME = "c29-admin";
const ADMIN_PASSWORD = "c29-admin-password-v1";
const ADMIN_PASSWORD_CHANGED = "c29-admin-password-changed-v1";
const MANAGER_LOGIN_NAME = "c29-manager";
const MANAGER_PASSWORD = "c29-manager-password-v1";
const MANAGER_PASSWORD_CHANGED = "c29-manager-password-changed-v1";

const ref = (entityId: string, versionId = "1"): VersionReference => ({ entityId, versionId });
const evidence = [
  {
    locator: { sourceSegmentId: "c29-evidence" },
    sourceVersion: ref("c29-source-version"),
  },
];

/** 夹具自有的 C08 任务定义：与 C29 公共定义同类型同结果族，预算与 schema 由夹具固定。 */
const CALIBRATION_BUDGET_POLICY = AgentTaskBudgetPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: ref("c29-calibration-budget"),
  modelDeploymentRef: ref("c29-calibration-model"),
  promptTemplateRef: ref("c29-calibration-prompt"),
  toolPolicyRef: ref("c29-calibration-tools"),
  maxModelInvocations: 1,
  maxToolInvocations: 1,
  maxContextTokens: 100,
  maxInputBytes: 1_000,
  maxOutputBytes: 1_000,
  maxCandidates: 1,
  maxObjects: 8,
  maxSupplementarySearches: 0,
  maxCorrections: 0,
  maxTransientRetries: 0,
  maxConcurrentActions: 1,
  maxWallClockMs: 60_000,
});

const calibrationDefinition: AgentTaskDefinitionV1 = {
  metadata: {
    schemaVersion: "1",
    definitionRef: ref("c29-calibration-definition"),
    taskType: CALIBRATION_TASK_TYPE,
    toolPolicyRef: CALIBRATION_BUDGET_POLICY.toolPolicyRef,
    incrementSchemaRef: ref("c29-calibration-increment"),
    validationPolicyRef: ref("c29-calibration-validation"),
    supportedTriggerModes: ["embedded"],
    allowedToolRefs: [],
    resultFamilies: ["calibration-suggestion"],
  },
  budgetPolicy: CALIBRATION_BUDGET_POLICY,
  actionSchema: AgentCommandProposalV1Schema,
  incrementSchema: CalibrationCandidateV1Schema,
  candidateSchema: CalibrationCandidateV1Schema,
  tools: [],
  measureCandidateUsage: () => ({ candidates: 1, objects: 1 }),
  validateCandidate: () => ({
    schemaVersion: "1",
    items: [],
    disposition: "accepted",
    validationArtifactRef: {
      kind: "diagnostic-artifact",
      reference: ref("c29-validation"),
    },
    validatedAt: C29_FIXTURE_TIME,
  }),
  finalizeCandidate: (_candidate, context) =>
    buildCompletedAgentTaskResult(context.envelope.agentTaskRef, {
      kind: "calibration-suggestion",
      reference: ref("c29-candidate"),
    }),
};

export interface CalibrationDeviationFactStubV1 {
  readonly readCalls: readonly { readonly requestId: string; readonly deviationFactRef: string }[];
  /** 按精确引用登记一条真实 C28 偏差事实；`thresholdExceeded` 决定是否进入校准。 */
  seed(input: {
    readonly suffix: string;
    readonly thresholdExceeded: boolean;
  }): ResponseDeviationFactV1;
  setUnavailable(value: boolean): void;
}

export interface CalibrationGovernanceStubV1 {
  readonly submitRevisions: readonly SubmitRevisionCommandV1[];
  setFailure(value: boolean): void;
  reset(): void;
}

export interface CalibrationPreparedInputV1 {
  readonly command: CalibrationPrepareInputCommandV1;
  readonly frozenInputRef: ContentArtifactRefV1;
  readonly inputSnapshotRef: CalibrationInputSnapshotRefV1;
  readonly deviationRecordRef: DeviationRecordRefV1;
}

export interface CalibrationPostgresFixtureV1 {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly artifactStore: ArtifactStoreV1;
  readonly projectId: string;
  readonly managerId: string;
  readonly rootScopeRef: SpatialScopeRefV1;
  readonly calibration: PostgresCalibrationAdapter;
  readonly reviews: PostgresReviewAuditAdapter & CalibrationSuggestionApprovalProofPortV1;
  readonly agentTasks: PostgresAgentTaskAdapter;
  readonly deviationFacts: CalibrationDeviationFactStubV1;
  readonly inputSnapshots: {
    remove(entityId: string): void;
    mismatchScope(entityId: string): void;
  };
  readonly governance: CalibrationGovernanceStubV1;
  readonly basisReleaseSetRef: {
    readonly kind: "assessment-basis-release-set";
    readonly reference: VersionReference;
  };
  readonly targetReleaseRef: KnowledgeReleaseRefV1;
  readonly targetDefinitionType: "deviation-policy";
  readonly baseDocument: AssessmentConfigurationDocumentV1;
  readonly validationPolicy: CalibrationValidationPolicyV1;
  readonly access: {
    readonly verifyCalls: readonly AuthorizationVerificationRequestV1[];
    readonly downstreamBranches: readonly string[];
    deny(): void;
    allow(): void;
  };

  /** C29 输入授权：真实 C06 校准分支上下文，能力按调用方实际需要补齐。 */
  inputAuthorization(commandId: string): Promise<AuthorizationContextV1>;
  /** 按精确分支与调用标识现取真实 C06 上下文：用于核对单能力收窄结果。 */
  authorizationFor(branch: string, invocationId: string): Promise<AuthorizationContextV1>;
  /** C34 窄读授权：真实 C06 读分支上下文，空间范围按用例显式给出。 */
  readAuthorization(input: {
    readonly invocationId: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  }): Promise<AuthorizationContextV1>;
  /** 目标定义上的闭合类型化操作：只改偏差阈值，其余字段取自冻结基准。 */
  operations(threshold: string): readonly CalibrationOperationV1[];
  prepareCommand(input: {
    readonly requestId: string;
    readonly deviationFactRef: {
      readonly kind: "response-deviation-fact";
      readonly reference: VersionReference;
    };
    readonly targetReleaseRef?: KnowledgeReleaseRefV1;
  }): Promise<CalibrationPrepareInputCommandV1>;
  /** 已越限事实的冻结输入：工件、快照引用与派生的公共记录引用。 */
  prepareInput(input: {
    readonly requestId: string;
    readonly deviationFactRef: {
      readonly kind: "response-deviation-fact";
      readonly reference: VersionReference;
    };
  }): Promise<CalibrationPrepareInputResultV1>;
  /** 真实 C08 执行：start → claim → reserve → candidate → complete action → complete task。 */
  runCalibrationTask(input: {
    readonly suffix: string;
    readonly frozenInputRef: ContentArtifactRefV1;
    readonly inputSnapshotRef: CalibrationInputSnapshotRefV1;
    readonly operations: readonly CalibrationOperationV1[];
  }): Promise<{
    readonly taskRef: AgentTaskRefV1;
    readonly resultRef: AgentTaskResultRefV1;
  }>;
  suggestionCommand(input: {
    readonly commandId: string;
    readonly deviationRecordRef: DeviationRecordRefV1;
    readonly agentTaskResultRef: AgentTaskResultRefV1;
  }): Promise<CreateCalibrationSuggestionCommandV1>;
  createSuggestion(
    command: CreateCalibrationSuggestionCommandV1,
  ): Promise<WarningResponseRecordResultV1>;
  /** 用真实 C07 适配器请求并决定一个复核任务；请求方与决定方各持自己的分支能力。 */
  decideReview(input: {
    readonly suffix: string;
    readonly projectId: string;
    readonly targetRef: {
      readonly kind: "calibration-suggestion";
      readonly reference: VersionReference;
    };
    readonly reviewTaskRef?: ReviewTaskRefV1;
    readonly kind: "approve-draft-creation" | "reject" | "return-for-revision";
    readonly requestAuthorization?: AuthorizationContextV1;
    readonly decideAuthorization?: AuthorizationContextV1;
  }): Promise<ReviewDecisionRefV1>;
  /** 为另一工程请求并决定复核任务：仅用于跨工程不可枚举用例。 */
  requestAndDecideForeignReview(input: {
    readonly suffix: string;
    readonly projectId: string;
    readonly kind: "approve-draft-creation" | "reject" | "return-for-revision";
  }): Promise<ReviewDecisionRefV1>;
  reviewOutcomeCommand(input: {
    readonly commandId: string;
    readonly projectId?: string;
    readonly outcome: "reject" | "return-for-revision" | "approve-draft-creation";
    readonly suggestionRef: {
      readonly kind: "calibration-suggestion";
      readonly reference: VersionReference;
    };
    readonly reviewDecisionRef: ReviewDecisionRefV1;
  }): Promise<CalibrationReviewOutcomeCommandV1>;
  recordReviewOutcome(
    command: CalibrationReviewOutcomeCommandV1,
  ): Promise<CalibrationReviewOutcomeResultV1>;
  createGovernanceDraft(
    command: CalibrationReviewOutcomeCommandV1,
  ): Promise<CalibrationGovernanceDraftResultV1>;
  readArtifact(artifactRef: ArtifactRefV1, purposeCode: string): Promise<unknown>;
  rows<T>(statement: string, values?: readonly unknown[]): Promise<T[]>;
  countReceipts(commandId?: string): Promise<number>;
  countEvents(eventType: string, producerCommandId?: string): Promise<number>;
  countAudit(action?: string): Promise<number>;
  /** 预置审计主键冲突：C29 事务内的审计写入失败必须整体回滚。 */
  preinsertAuditConflict(auditEntryId: string): Promise<void>;
  clearAuditConflict(auditEntryId: string): Promise<void>;
  close(): Promise<void>;
}

export const startCalibrationFixture = async (): Promise<CalibrationPostgresFixtureV1> => {
  const postgres = await startPostgresFixture();
  let rootDirectory: string | undefined;
  let runtime: PostgresRuntime | undefined;
  let session: PostgresLocalIdentityAccess | undefined;
  let store: Awaited<ReturnType<typeof createFilesystemArtifactStore>> | undefined;
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
    });
    rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c29-calibration-"));
    runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const db = runtime.db as Kysely<PostgresDatabase>;
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const registry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
    });
    const createdStore = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry,
      transactionUnit,
    });
    store = createdStore;
    const artifactStore: ArtifactStoreV1 = createdStore;
    const adminPool = postgres.adminPool;

    /* ---------------------------------------------------------------- C06 会话 */

    const clock = () => new Date(C29_FIXTURE_TIME);
    await bootstrapInitialSystemAdministrator({
      connection: postgres.migrator,
      loginName: ADMIN_LOGIN_NAME,
      displayName: "C29 initial administrator",
      password: ADMIN_PASSWORD,
      accountId: "c29-account-admin",
      now: clock,
    });
    const access = createPostgresLocalIdentityAccess({
      ...postgres.app,
      hmacKey: new Uint8Array(32).fill(29),
      keyVersion: "key-v1",
      now: clock,
    });
    session = access;
    const adminLogin = await access.login({
      kind: "login",
      loginAttemptId: "c29-login-admin",
      loginName: ADMIN_LOGIN_NAME,
      password: ADMIN_PASSWORD,
    });
    const preparedAdmin = await access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: ADMIN_PASSWORD_CHANGED,
    });
    const projectId = "c29-project";
    const manager = await access.administerIdentity({
      kind: "create-account",
      commandId: "c29-create-manager",
      idempotencyKey: "c29-create-manager",
      expectedVersion: "none",
      authorizationContextRef: preparedAdmin.systemAdministrationContextRef!,
      loginName: MANAGER_LOGIN_NAME,
      displayName: "C29 risk manager",
      password: MANAGER_PASSWORD,
    });
    const managerId = manager.resultRef.entityId;
    await access.administerProject({
      kind: "open-project",
      projectId,
      commandId: "c29-open-project",
      idempotencyKey: "c29-open-project",
      expectedVersion: "none",
      authorizationContextRef: preparedAdmin.systemAdministrationContextRef!,
      initialRiskManagerAccountId: managerId,
    });
    const managerLogin = await access.login({
      kind: "login",
      loginAttemptId: "c29-login-manager",
      loginName: MANAGER_LOGIN_NAME,
      password: MANAGER_PASSWORD,
    });
    const preparedManager = await access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: MANAGER_PASSWORD_CHANGED,
    });
    const sessionToken = preparedManager.sessionToken;

    /**
     * 工程登记的根空间：校准事实与 C34 窄读都用它，使读授权可由真实 C06 覆盖。
     * 偏差事实的空间必须落在已登记空间图内，否则任何读授权都不成立。
     */
    const rootScopeRef: SpatialScopeRefV1 = await (async () => {
      const identities = await db
        .selectFrom("business.access_spatial_scopes")
        .select(["scope_id", "current_revision_id"])
        .where("project_id", "=", projectId)
        .execute();
      for (const identity of identities) {
        const revision = await db
          .selectFrom("business.access_spatial_scope_revisions")
          .select(["revision_id", "parent_scope_id", "status"])
          .where("revision_id", "=", identity.current_revision_id)
          .executeTakeFirst();
        if (revision?.parent_scope_id === null && revision.status === "active") {
          return SpatialScopeRefV1Schema.parse({
            kind: "spatial-scope",
            reference: { entityId: identity.scope_id, versionId: revision.revision_id },
          });
        }
      }
      throw new Error("c29 fixture: 工程未登记可用根空间");
    })();

    /** 真实 C06 授权按用途与精确 invocationId 现取；同一 invocationId 只签发一次。 */
    const authorizations = new Map<string, Promise<AuthorizationContextV1>>();
    const authorizeFor = (
      branch: string,
      invocationId: string,
      project = projectId,
    ): Promise<AuthorizationContextV1> => {
      const key = `${project}\u0000${branch}\u0000${invocationId}`;
      const cached = authorizations.get(key);
      if (cached !== undefined) return cached;
      const pending = access
        .authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId,
          projectId: project,
          branch: branch as never,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        })
        .then((decision) => AuthorizationContextV1Schema.parse(decision.context));
      authorizations.set(key, pending);
      return pending;
    };

    /* --------------------------------------------- 访问接缝：按用途签发的当前授权 */

    const verifyCalls: AuthorizationVerificationRequestV1[] = [];
    let denied = false;
    const deniedError = (): AccessServiceError =>
      new AccessServiceError({
        code: "AUTHORIZATION_DENIED",
        stage: "verify",
        occurredAt: C29_FIXTURE_TIME,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: ref("c29-diagnostic-denied"),
        },
        contextRefs: [],
        retryable: false,
        requiredCapability: C29_CALIBRATION_CAPABILITY,
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    const accessSeam = {
      async verify(request: AuthorizationVerificationRequestV1): Promise<AuthorizationDecisionV1> {
        verifyCalls.push(request);
        if (denied) throw deniedError();
        if (request.projectId !== projectId) {
          // 跨工程决定用例：另一工程未登记 C06 事实，接缝按请求分支签发等价上下文。
          const context = AuthorizationContextV1Schema.parse({
            schemaVersion: "1",
            authorizationContextRef: {
              kind: "authorization-context",
              reference: ref(`c29-foreign-${request.invocationId}`),
            },
            actorId: managerId,
            projectId: request.projectId,
            grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[request.branch]],
            spatialScopeRefs: [...request.requestedSpatialScopeRefs],
            sourceAccessGrantRefs: [],
            authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
            decidedAt: C29_FIXTURE_TIME,
            invocation: { kind: "human" },
          });
          return {
            context,
            contextRef: context.authorizationContextRef,
            redacted: false,
          };
        }
        const context = await authorizeFor(request.branch, request.invocationId, request.projectId);
        return {
          context,
          contextRef: context.authorizationContextRef,
          redacted: false,
        };
      },
    } as unknown as LocalIdentityAccessV1;

    /* -------------------------------------------------------------- C08 运行时 */

    const agentTasks = new PostgresAgentTaskAdapter({
      db: runtime.db,
      registry: new AgentTaskDefinitionRegistry([calibrationDefinition]),
      transactionUnit,
      artifactStore,
      referenceGuard: registry,
      authorization: access,
      commandExecutor: {
        async execute({ proposal }) {
          return { resultRef: proposal.targetRef };
        },
      },
    });

    /* ---------------------------------------------------------------- C07 复核 */

    const reviews = new PostgresReviewAuditAdapter({
      db: runtime.db,
      transactionUnit,
      access: accessSeam,
      now: () => new Date(C29_FIXTURE_TIME),
    });

    /* -------------------------------------------- C19 依据：11 类配置成员真实发布 */

    const publishArtifact = async (input: {
      readonly commandId: string;
      readonly authorization: AuthorizationContextV1;
      readonly requiredCapability: ModuleCapabilityV1;
      readonly artifactId: string;
      readonly artifactKind: "content" | "diagnostic";
      readonly purposeCode: string;
      readonly mediaType: string;
      readonly value: unknown;
    }): Promise<ArtifactRefV1> => {
      const result = await artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId,
          actorId: input.authorization.actorId,
          issuedAt: C29_FIXTURE_TIME,
          authorization: input.authorization,
          requiredCapability: input.requiredCapability,
          artifactId: input.artifactId,
          artifactKind: input.artifactKind,
          purposeCode: input.purposeCode,
          mediaType: input.mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(canonicalJson(input.value));
        })(),
      );
      return ArtifactRefV1Schema.parse(result.artifactRef);
    };

    const documents = c25ConfigurationDocuments();
    const basisAuthorization = await authorizeFor(C29_ARTIFACT_READ_BRANCH, "c29-basis-publish");
    const configurationMembers: {
      definitionType: string;
      releaseRef: unknown;
      revisionRef: unknown;
      artifactRef: ContentArtifactRefV1;
      contentDigest: string;
    }[] = [];
    for (const definitionType of Object.keys(documents).sort()) {
      const document = documents[definitionType as keyof typeof documents];
      const artifactId = `c29-configuration-${definitionType}`;
      configurationMembers.push({
        definitionType,
        releaseRef: c25ReleaseRef(definitionType),
        revisionRef: c25RevisionRef(definitionType),
        artifactRef: ContentArtifactRefV1Schema.parse(
          await publishArtifact({
            commandId: artifactId,
            authorization: basisAuthorization,
            requiredCapability: "knowledge-modeling.read",
            artifactId,
            artifactKind: "content",
            purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
            mediaType: C29_CONFIGURATION_MEDIA_TYPE,
            value: document,
          }),
        ),
        contentDigest: c25Digest(document),
      });
    }
    const basisReleaseSetRef = {
      kind: "assessment-basis-release-set" as const,
      reference: ref("c29-assessment-basis"),
    };
    const basisReader: AssessmentBasisReleaseSetReaderV1 = {
      readAssessmentBasisReleaseSet: async (input) =>
        AssessmentBasisReleaseSetReadResultV1Schema.parse({
          kind: "succeeded",
          schemaVersion: "1",
          assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
          memberDigest: sha256CanonicalJson({ members: configurationMembers }),
          applicableRuleSetMember: {
            releaseRef: c25ReleaseRef("set-applicable-rule-set"),
            revisionRef: c25RevisionRef("set-applicable-rule-set"),
            artifactRef: {
              kind: "content-artifact",
              reference: ref("c29-applicable-rule-set"),
            },
            contentDigest: c25Digest({ applicableRuleSet: "c29" }),
          },
          scoringRuleMembers: [
            {
              releaseRef: c25ReleaseRef("rule-c29-double"),
              revisionRef: c25RevisionRef("rule-c29-double"),
              artifactRef: {
                kind: "content-artifact",
                reference: ref("c29-scoring-rule"),
              },
              contentDigest: c25Digest({ scoringRule: "c29-double" }),
            },
          ],
          configurationMembers,
        }),
    };

    const frozenSnapshots = new Map<
      string,
      Extract<
        Awaited<ReturnType<AssessmentInputSnapshotReaderV1["readInputSnapshot"]>>,
        { kind: "succeeded" }
      >
    >();
    const inputSnapshots: AssessmentInputSnapshotReaderV1 = {
      readInputSnapshot: async (input) => {
        const frozen = frozenSnapshots.get(input.inputSnapshotRef.reference.entityId);
        if (
          input.authorization.projectId !== input.projectId ||
          !input.authorization.grantedCapabilities.includes("risk-assessment.read") ||
          frozen === undefined ||
          frozen.targetReleaseRef.reference.entityId !==
            input.targetReleaseRef.reference.entityId ||
          frozen.targetReleaseRef.reference.versionId !== input.targetReleaseRef.reference.versionId
        ) {
          return {
            kind: "failed",
            error: ModuleErrorV1Schema.parse({
              stageCode: "c25.input-snapshot",
              occurredAt: C29_FIXTURE_TIME,
              causalRunId: input.requestId,
              code: "AUTHORIZATION_DENIED",
              category: "authorization",
              retryable: false,
              requiredCapability: "risk-assessment.read",
              authorizationPolicyRef: ref("access-policy"),
            }),
          };
        }
        return frozen;
      },
    };

    /* ----------------------------------------------------------- C28 偏差事实 */

    const facts = new Map<string, ResponseDeviationFactV1>();
    const readCalls: { requestId: string; deviationFactRef: string }[] = [];
    let deviationFactsUnavailable = false;
    const deviationFactMiss = (input: {
      readonly requestId: string;
      readonly deviationFactRef: { readonly kind: string; readonly reference: VersionReference };
    }) =>
      ModuleErrorV1Schema.parse({
        stageCode: "c29.deviation-fact",
        occurredAt: C29_FIXTURE_TIME,
        causalRunId: input.requestId,
        code: "ENTITY_NOT_FOUND",
        category: "not-found",
        retryable: false,
        targetRef: input.deviationFactRef,
      });
    const deviationFacts: ResponseDeviationFactReaderV1 = {
      readDeviationFact: async (input) => {
        readCalls.push({
          requestId: input.requestId,
          deviationFactRef: input.deviationFactRef.reference.entityId,
        });
        const fact = facts.get(input.deviationFactRef.reference.entityId);
        if (
          deviationFactsUnavailable ||
          fact === undefined ||
          fact.deviationFactRef.reference.versionId !== input.deviationFactRef.reference.versionId
        ) {
          return { kind: "failed", error: deviationFactMiss(input) };
        }
        return { kind: "succeeded", result: { fact } };
      },
    };

    /* ---------------------------------------------------------- C16 治理接缝 */

    /** 已登记修订：同一命令/幂等键重放只复用原修订，不登记第二次（C16 幂等语义）。 */
    const submitRevisions: SubmitRevisionCommandV1[] = [];
    const registeredRevisions = new Map<
      string,
      SubmitRevisionCommandV1["payload"]["definitionType"]
    >();
    let governanceFails = false;
    const governance = {
      async govern(command: SubmitRevisionCommandV1) {
        if (governanceFails) {
          return {
            kind: "failed" as const,
            error: ModuleErrorV1Schema.parse({
              stageCode: "knowledge-modeling.submit-revision",
              occurredAt: C29_FIXTURE_TIME,
              causalRunId: command.commandId,
              code: "TRANSIENT_FAILURE",
              category: "technical",
              retryable: true,
              attempt: 1,
              retryPolicyRef: ref("c29-governance-retry"),
              diagnosticRef: {
                kind: "diagnostic-artifact",
                reference: ref("c29-governance-diagnostic"),
              },
            }),
          };
        }
        const previouslyRegistered = registeredRevisions.get(command.commandId);
        if (previouslyRegistered === undefined) {
          submitRevisions.push(command);
          registeredRevisions.set(command.commandId, command.payload.definitionType);
        }
        return {
          kind: "succeeded" as const,
          result: {
            kind: "revision" as const,
            knowledgeRevisionRef: {
              kind: "knowledge-revision" as const,
              reference: ref(
                `c29-revision-${previouslyRegistered ?? command.payload.definitionType}`,
              ),
            },
          },
        };
      },
    };

    /* --------------------------------------------------------- C29 适配器装配 */

    const downstreamBranches: string[] = [];
    const authorizeDownstream: CalibrationDownstreamAuthorizerV1 = (request) => {
      downstreamBranches.push(request.branch);
      return authorizeFor(request.branch, request.invocationId, request.projectId);
    };

    const calibration = createPostgresCalibrationAdapter({
      db,
      transactionUnit,
      access: accessSeam,
      deviationFacts,
      inputSnapshots,
      basis: basisReader,
      artifactStore,
      agentResults: agentTasks,
      reviews,
      governance,
      authorizeDownstream,
      now: () => new Date(C29_FIXTURE_TIME),
    });

    const targetDefinitionType = "deviation-policy" as const;
    const baseDocument = documents[targetDefinitionType];
    const baseDeviationPolicy = DeviationPolicyV1Schema.parse(
      (baseDocument.content as { policies: readonly DeviationPolicyV1[] }).policies[0]!,
    );
    const validationPolicy = CalibrationValidationPolicyV1Schema.parse({
      schemaVersion: "1",
      policyRef: ref("c29-calibration-validation-policy"),
      projectId,
      definitionRef: ref("c29-calibration-definition"),
      toolPolicyRef: CALIBRATION_BUDGET_POLICY.toolPolicyRef,
      incrementSchemaRef: ref("c29-calibration-increment"),
      validationPolicyRef: ref("c29-calibration-validation"),
      budgetPolicy: CALIBRATION_BUDGET_POLICY,
      evidenceRequirementCount: 1,
      maxOperations: 4,
    });
    const targetReleaseRef = c25ReleaseRef(targetDefinitionType);

    const seedDeviationFact = (input: {
      suffix: string;
      thresholdExceeded: boolean;
    }): ResponseDeviationFactV1 => {
      const deviationFactRef = {
        kind: "response-deviation-fact" as const,
        reference: ref(`c29-deviation-fact-${input.suffix}`),
      };
      const fact = ResponseDeviationFactV1Schema.parse({
        schemaVersion: "1",
        projectId,
        deviationFactRef,
        responseRecommendationRef: {
          kind: "response-recommendation",
          reference: ref(`c29-recommendation-${input.suffix}`),
        },
        executionRecordRef: {
          kind: "execution-record",
          reference: ref(`c29-execution-${input.suffix}`),
        },
        effectForecastRef: {
          kind: "effect-forecast",
          reference: ref(`c29-forecast-${input.suffix}`),
        },
        feedbackRef: { kind: "feedback", reference: ref(`c29-feedback-${input.suffix}`) },
        frozenAssessmentBasisRef: {
          kind: "assessment-input-snapshot",
          reference: ref(`c29-assessment-input-${input.suffix}`),
        },
        deviationPolicyRef: c25Version("deviation-policy"),
        basis: "absolute",
        riskMatrixRef: c25Version("risk-matrix"),
        targetIndicatorId: "indicator-consequence-1",
        unit: "mm",
        predictedValue: "2",
        actualValue: input.thresholdExceeded ? "7" : "2.5",
        deviationValue: input.thresholdExceeded ? "5" : "0.5",
        deviationValueNumber: input.thresholdExceeded ? 5 : 0.5,
        thresholdExceeded: input.thresholdExceeded,
        direction: "actual-above",
        predictedRiskState: { likelihoodScore: 2, consequenceScore: 3, riskLevel: "medium" },
        actualRiskState: { likelihoodScore: 3, consequenceScore: 4, riskLevel: "high" },
        evidenceReferences: evidence,
        summary: `c29-deviation-${input.suffix}`,
        spatialScopeRef: rootScopeRef,
        computedAt: C29_FIXTURE_TIME,
      });
      facts.set(deviationFactRef.reference.entityId, fact);
      frozenSnapshots.set(fact.frozenAssessmentBasisRef.reference.entityId, {
        kind: "succeeded",
        projectId,
        spatialScopeRef: fact.spatialScopeRef,
        basisReleaseSetRef,
        targetReleaseRef: c25ReleaseRef("deviation-policy"),
        targetContentDigest: configurationMembers.find(
          (member) => member.definitionType === "deviation-policy",
        )!.contentDigest,
      });
      return fact;
    };

    /* ----------------------------------------------------------------- 用例装配 */

    const inputAuthorization = async (commandId: string): Promise<AuthorizationContextV1> => {
      const base = await authorizeFor(C29_CALIBRATION_BRANCH, commandId);
      return AuthorizationContextV1Schema.parse({
        ...base,
        grantedCapabilities: [
          C29_CALIBRATION_CAPABILITY,
          "knowledge-modeling.govern",
          "review-audit.read",
        ],
      });
    };

    const operations = (threshold: string): readonly CalibrationOperationV1[] => [
      {
        kind: "replace-deviation-policy",
        definitionType: "deviation-policy",
        policy: { ...baseDeviationPolicy, threshold },
      },
    ];

    const prepareCommand = async (input: {
      requestId: string;
      deviationFactRef: { kind: "response-deviation-fact"; reference: VersionReference };
      targetReleaseRef?: KnowledgeReleaseRefV1;
    }): Promise<CalibrationPrepareInputCommandV1> => ({
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      requestedAt: C29_FIXTURE_TIME,
      projectId,
      actorId: managerId,
      authorization: await inputAuthorization(input.requestId),
      deviationFactRef: input.deviationFactRef,
      basisReleaseSetRef,
      targetReleaseRef: input.targetReleaseRef ?? targetReleaseRef,
      calibrationValidationPolicyRef: validationPolicy.policyRef,
      agentPolicy: validationPolicy,
    });

    const prepareInput = (input: {
      requestId: string;
      deviationFactRef: { kind: "response-deviation-fact"; reference: VersionReference };
    }): Promise<CalibrationPrepareInputResultV1> =>
      prepareCommand(input).then((command) => calibration.prepareInput(command));

    const runCalibrationTask = async (input: {
      suffix: string;
      frozenInputRef: ContentArtifactRefV1;
      inputSnapshotRef: CalibrationInputSnapshotRefV1;
      operations: readonly CalibrationOperationV1[];
    }): Promise<{ taskRef: AgentTaskRefV1; resultRef: AgentTaskResultRefV1 }> => {
      const commandId = `c29-start-${input.suffix}`;
      const startAuthorization = await authorizeFor(C29_START_TASK_BRANCH, commandId);
      const started = await agentTasks.startTask({
        kind: "start-task",
        commandId,
        idempotencyKey: commandId,
        projectId,
        actorId: managerId,
        issuedAt: C29_FIXTURE_TIME,
        authorization: startAuthorization,
        payload: {
          taskType: CALIBRATION_TASK_TYPE,
          triggerMode: "embedded",
          parentRunRef: { kind: "workflow-run", reference: ref(`c29-run-${input.suffix}`) },
          frozenInputRef: input.frozenInputRef,
          modelDeploymentRef: validationPolicy.budgetPolicy.modelDeploymentRef,
          promptTemplateRef: validationPolicy.budgetPolicy.promptTemplateRef,
          toolPolicyRef: validationPolicy.toolPolicyRef,
          budgetPolicyRef: validationPolicy.budgetPolicy.policyRef,
          incrementSchemaRef: validationPolicy.incrementSchemaRef,
          validationPolicyRef: validationPolicy.validationPolicyRef,
        },
      });
      if (started.kind !== "succeeded") {
        throw new Error(`C29 fixture C08 start failed: ${JSON.stringify(started).slice(0, 400)}`);
      }
      const taskRef = started.result.agentTaskRef;
      const claim = await agentTasks.claim({
        workerId: `c29-worker-${input.suffix}`,
        leaseDurationMs: 60_000,
        now: C29_FIXTURE_TIME,
      });
      if (
        claim === undefined ||
        claim.task.envelope.agentTaskRef.reference.entityId !== taskRef.reference.entityId
      ) {
        throw new Error("C29 fixture C08 claim did not return the calibration task");
      }
      const resultRef = buildCompletedAgentTaskResult(taskRef, {
        kind: "calibration-suggestion",
        reference: ref(`c29-candidate-${input.suffix}`),
      });
      const candidate = CalibrationCandidateV1Schema.parse({
        schemaVersion: "1",
        taskRef,
        resultRef,
        inputSnapshotRef: input.inputSnapshotRef,
        rationale: `c29 calibration candidate ${input.suffix}`,
        evidenceReferences: evidence,
        operations: [...input.operations],
      });
      const putAgentArtifact = async (
        artifactId: string,
        artifactKind: "content" | "diagnostic",
        purposeCode: string,
      ): Promise<ArtifactRefV1> =>
        await publishArtifact({
          commandId: `c29-put-${artifactId}`,
          authorization: startAuthorization,
          requiredCapability: "agent-task.start",
          artifactId,
          artifactKind,
          purposeCode,
          mediaType: AGENT_MEDIA_TYPE,
          value: candidate,
        });
      const intent = await putAgentArtifact(
        `c29-intent-${input.suffix}`,
        "diagnostic",
        C29_AGENT_INTENT_PURPOSE,
      );
      const candidateArtifact = await putAgentArtifact(
        `c29-candidate-${input.suffix}`,
        "content",
        C29_AGENT_CANDIDATE_PURPOSE,
      );
      const increment = await putAgentArtifact(
        `c29-increment-${input.suffix}`,
        "diagnostic",
        C29_AGENT_INCREMENT_PURPOSE,
      );
      const actionResult = await putAgentArtifact(
        `c29-action-result-${input.suffix}`,
        "diagnostic",
        C29_AGENT_ACTION_RESULT_PURPOSE,
      );
      const reserved = await agentTasks.reserveAction({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        actionId: `c29-action-${input.suffix}`,
        reservationId: `c29-reservation-${input.suffix}`,
        actionType: "model-invocation",
        sequence: 1,
        idempotencyKey: `c29-action-key-${input.suffix}`,
        intentArtifactRef: intent,
        amount: { inputTokens: 10 },
        now: C29_FIXTURE_TIME,
      });
      await agentTasks.recordCandidate({
        candidate: {
          schemaVersion: "1",
          taskRef,
          candidateVersion: 1,
          parentCandidateVersion: 0,
          candidateArtifactRef: candidateArtifact,
          incrementArtifactRef: increment,
          resultRef,
          disposition: "accepted",
          createdAt: C29_FIXTURE_TIME,
        },
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
      });
      await agentTasks.completeAction({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        actionId: `c29-action-${input.suffix}`,
        resultRef: candidateArtifact,
        resultArtifactRef: actionResult,
        usage: { ...reserved.reservation.amount, inputTokens: 4 },
        activeWallClockMs: 1_000,
        now: C29_FIXTURE_TIME,
      });
      await agentTasks.completeTask({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        resultRef,
        now: C29_FIXTURE_TIME,
      });
      const snapshot = await agentTasks.getTask(taskRef);
      if (snapshot?.state.status !== "completed") {
        throw new Error("C29 fixture C08 task did not complete");
      }
      return { taskRef, resultRef };
    };

    const suggestionCommand = async (input: {
      commandId: string;
      deviationRecordRef: DeviationRecordRefV1;
      agentTaskResultRef: AgentTaskResultRefV1;
    }): Promise<CreateCalibrationSuggestionCommandV1> =>
      WarningResponseRecordCommandV1Schema.parse({
        kind: "create-calibration-suggestion",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C29_FIXTURE_TIME,
        authorization: await inputAuthorization(input.commandId),
        payload: {
          deviationRecordRef: input.deviationRecordRef,
          agentTaskResultRef: input.agentTaskResultRef,
          calibrationValidationPolicyRef: validationPolicy.policyRef,
        },
      }) as CreateCalibrationSuggestionCommandV1;

    /** C07 复核命令各自需要自己的分支能力：请求方与决定方分别现取真实 C06 授权。 */
    const reviewAuthorization = (
      input: {
        readonly requestAuthorization?: AuthorizationContextV1;
        readonly decideAuthorization?: AuthorizationContextV1;
      },
      suffix: string,
    ): Promise<{
      readonly request: AuthorizationContextV1;
      readonly decide: AuthorizationContextV1;
    }> =>
      Promise.all([
        input.requestAuthorization ??
          authorizeFor("review-audit.request-review", `c29-review-request-${suffix}`),
        input.decideAuthorization ??
          authorizeFor("review-audit.decide-review", `c29-decide-${suffix}`),
      ]).then(([request, decide]) => ({ request, decide }));

    const decideReview = async (input: {
      suffix: string;
      projectId: string;
      targetRef: { kind: "calibration-suggestion"; reference: VersionReference };
      reviewTaskRef?: ReviewTaskRefV1;
      kind: "approve-draft-creation" | "reject" | "return-for-revision";
      requestAuthorization?: AuthorizationContextV1;
      decideAuthorization?: AuthorizationContextV1;
    }): Promise<ReviewDecisionRefV1> => {
      const authorization = await reviewAuthorization(input, input.suffix);
      const reviewTaskRef =
        input.reviewTaskRef ??
        (
          await reviews.requestReview(
            ReviewRequestV1Schema.parse({
              kind: "request-review",
              commandId: `c29-review-request-${input.suffix}`,
              idempotencyKey: `c29-review-request-${input.suffix}`,
              projectId: input.projectId,
              actorId: authorization.request.actorId,
              issuedAt: C29_FIXTURE_TIME,
              authorization: authorization.request,
              payload: {
                reviewType: "calibration-suggestion",
                targetRef: input.targetRef,
                validationSnapshotRef: {
                  kind: "validation-snapshot",
                  reference: ref(`c29-review-validation-${input.suffix}`),
                },
                evidenceSnapshotRef: {
                  kind: "evidence-snapshot",
                  reference: ref(`c29-review-evidence-${input.suffix}`),
                },
                waitingRunRef: {
                  kind: "workflow-run",
                  reference: ref(`c29-review-run-${input.suffix}`),
                },
                reviewPolicyRef: validationPolicy.policyRef,
              },
            }),
          )
        ).result.reviewTaskRef;
      const decided = await reviews.decideReview(
        ReviewDecisionCommandV1Schema.parse({
          kind: "decide-review",
          commandId: `c29-decide-${input.suffix}`,
          idempotencyKey: `c29-decide-${input.suffix}`,
          projectId: input.projectId,
          actorId: authorization.decide.actorId,
          issuedAt: C29_FIXTURE_TIME,
          authorization: authorization.decide,
          payload: {
            reviewTaskRef,
            targetRef: input.targetRef,
            decision: { reviewType: "calibration-suggestion", kind: input.kind },
            reasonCode: "reviewed",
          },
        }),
      );
      if (decided.kind !== "succeeded") {
        throw new Error(
          `C29 fixture review decision failed: ${JSON.stringify(decided).slice(0, 300)}`,
        );
      }
      return decided.result.reviewDecisionRef;
    };

    const reviewOutcomeCommand = async (input: {
      commandId: string;
      projectId?: string;
      outcome: "reject" | "return-for-revision" | "approve-draft-creation";
      suggestionRef: { kind: "calibration-suggestion"; reference: VersionReference };
      reviewDecisionRef: ReviewDecisionRefV1;
    }): Promise<CalibrationReviewOutcomeCommandV1> =>
      CalibrationReviewOutcomeCommandV1Schema.parse({
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId: input.projectId ?? projectId,
        actorId: managerId,
        issuedAt: C29_FIXTURE_TIME,
        authorization: await inputAuthorization(input.commandId),
        payload: {
          schemaVersion: "1",
          calibrationSuggestionRef: CalibrationSuggestionRefV1Schema.parse(input.suggestionRef),
          reviewDecisionRef: input.reviewDecisionRef,
          outcome: input.outcome,
        },
      });

    const rows = async <T>(statement: string, values: readonly unknown[] = []): Promise<T[]> =>
      (await adminPool.query<T>(statement, [...values])).rows;

    return {
      postgres,
      runtime,
      db,
      transactionUnit,
      artifactStore,
      projectId,
      managerId,
      rootScopeRef,
      calibration,
      reviews: reviews as PostgresReviewAuditAdapter & CalibrationSuggestionApprovalProofPortV1,
      agentTasks,
      deviationFacts: {
        readCalls,
        seed: seedDeviationFact,
        setUnavailable: (value) => {
          deviationFactsUnavailable = value;
        },
      },
      inputSnapshots: {
        remove: (entityId) => {
          frozenSnapshots.delete(entityId);
        },
        mismatchScope: (entityId) => {
          const frozen = frozenSnapshots.get(entityId);
          if (frozen !== undefined) {
            frozenSnapshots.set(entityId, {
              ...frozen,
              spatialScopeRef: {
                ...frozen.spatialScopeRef,
                reference: ref("c29-other-spatial-scope"),
              },
            });
          }
        },
      },
      governance: {
        submitRevisions,
        setFailure: (value) => {
          governanceFails = value;
        },
        reset: () => {
          submitRevisions.splice(0, submitRevisions.length);
        },
      },
      basisReleaseSetRef,
      targetReleaseRef,
      targetDefinitionType,
      baseDocument,
      validationPolicy,
      access: {
        verifyCalls,
        downstreamBranches,
        deny: () => {
          denied = true;
        },
        allow: () => {
          denied = false;
        },
      },
      inputAuthorization,
      authorizationFor: (branch, invocationId) => authorizeFor(branch, invocationId),
      readAuthorization: (input) =>
        access
          .authorize({
            invocation: { kind: "human-session", sessionToken },
            invocationId: input.invocationId,
            projectId,
            branch: "warning-response.read" as never,
            requestedSpatialScopeRefs: [...input.spatialScopeRefs],
            requestedSourceVersionRefs: [],
          })
          .then((decision) => AuthorizationContextV1Schema.parse(decision.context)),
      operations,
      prepareCommand,
      prepareInput,
      runCalibrationTask,
      suggestionCommand,
      createSuggestion: (command) =>
        calibration
          .createSuggestion(command)
          .then((result) => WarningResponseRecordResultV1Schema.parse(result)),
      decideReview,
      requestAndDecideForeignReview: (input) => {
        // 另一工程未登记 C06 事实：接缝按请求分支签发等价单能力上下文。
        const foreignAuthorization = (capability: ModuleCapabilityV1, role: string) =>
          AuthorizationContextV1Schema.parse({
            schemaVersion: "1",
            authorizationContextRef: {
              kind: "authorization-context",
              reference: ref(`c29-foreign-${role}-${input.suffix}`),
            },
            actorId: managerId,
            projectId: input.projectId,
            grantedCapabilities: [capability],
            spatialScopeRefs: [],
            sourceAccessGrantRefs: [],
            authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
            decidedAt: C29_FIXTURE_TIME,
            invocation: { kind: "human" },
          });
        return decideReview({
          suffix: input.suffix,
          projectId: input.projectId,
          targetRef: {
            kind: "calibration-suggestion",
            reference: ref(`c29-foreign-suggestion-${input.suffix}`),
          },
          kind: input.kind,
          requestAuthorization: foreignAuthorization("review-audit.request", "request"),
          decideAuthorization: foreignAuthorization("review-audit.decide", "decide"),
        });
      },
      reviewOutcomeCommand,
      recordReviewOutcome: (command) => calibration.recordReviewOutcome(command),
      createGovernanceDraft: (command) => calibration.createGovernanceDraft(command),
      readArtifact: async (value, purposeCode) => {
        const handle = await artifactStore.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: `c29-read-${value.reference.entityId}`,
            idempotencyKey: `c29-read-${value.reference.entityId}`,
            artifactRef: value,
            projectId,
            actorId: managerId,
            requestedAt: C29_FIXTURE_TIME,
            purposeCode,
            requiredCapability: "knowledge-modeling.read",
            authorization: await authorizeFor(
              C29_ARTIFACT_READ_BRANCH,
              `c29-read-${value.reference.entityId}`,
            ),
          }),
        );
        const chunks: Uint8Array[] = [];
        let length = 0;
        for await (const chunk of handle.content) {
          chunks.push(chunk);
          length += chunk.byteLength;
        }
        await handle.verified;
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return JSON.parse(new TextDecoder().decode(body)) as unknown;
      },
      rows,
      countReceipts: async (commandId) =>
        Number(
          (
            await rows<{ count: string }>(
              commandId === undefined
                ? "SELECT count(*)::text AS count FROM business.command_receipts WHERE project_id = $1"
                : "SELECT count(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_id = $2",
              commandId === undefined ? [projectId] : [projectId, commandId],
            )
          )[0]?.count ?? "0",
        ),
      countEvents: async (eventType, producerCommandId) =>
        Number(
          (
            await rows<{ count: string }>(
              producerCommandId === undefined
                ? "SELECT count(*)::text AS count FROM outbox.events WHERE project_id = $1 AND event_type = $2"
                : `SELECT count(*)::text AS count FROM outbox.events
                   WHERE project_id = $1 AND event_type = $2 AND producer_command_id = $3`,
              producerCommandId === undefined
                ? [projectId, eventType]
                : [projectId, eventType, producerCommandId],
            )
          )[0]?.count ?? "0",
        ),
      countAudit: async (action) =>
        Number(
          (
            await rows<{ count: string }>(
              action === undefined
                ? "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1"
                : "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2",
              action === undefined ? [projectId] : [projectId, action],
            )
          )[0]?.count ?? "0",
        ),
      preinsertAuditConflict: async (auditEntryId) => {
        await adminPool.query(
          `INSERT INTO audit.entries
             (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref,
              version_ref, occurred_at, recorded_at, command_id, idempotency_key)
           VALUES ($1, $2, 'c29.fixture.conflict',
             '{"kind":"calibration-suggestion","reference":{"entityId":"c29-fixture","versionId":"1"}}',
             $3,
             '{"kind":"authorization-context","reference":{"entityId":"c29-fixture","versionId":"1"}}',
             '{"entityId":"c29-fixture","versionId":"1"}', NOW(), NOW(), $1, $1)
           ON CONFLICT (audit_entry_id) DO NOTHING`,
          [auditEntryId, projectId, managerId],
        );
      },
      clearAuditConflict: async (auditEntryId) => {
        await adminPool.query("DELETE FROM audit.entries WHERE audit_entry_id = $1", [
          auditEntryId,
        ]);
      },
      async close() {
        await store?.close().catch(() => undefined);
        await runtime?.close().catch(() => undefined);
        if (rootDirectory !== undefined) {
          await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
        await session?.close().catch(() => undefined);
        await postgres.close();
      },
    };
  } catch (error) {
    await store?.close().catch(() => undefined);
    await runtime?.close().catch(() => undefined);
    if (rootDirectory !== undefined) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    await session?.close().catch(() => undefined);
    await postgres.close().catch(() => undefined);
    throw error;
  }
};
