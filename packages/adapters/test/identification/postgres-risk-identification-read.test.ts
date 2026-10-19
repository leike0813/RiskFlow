/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError } from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  AcceptanceRouteSetV1Schema,
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
  RiskCandidateFinalizationResultRowV1Schema,
  StandardizedRiskRecordWriteV1Schema,
  candidateSetRefFor,
  RiskCandidateSetV1Schema,
} from "@riskflow/core/identification/candidate-finalization";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphResultRowV1Schema,
  IdentificationGraphRunStateV1Schema,
  type IdentificationGraphResultRowV1,
} from "@riskflow/core/identification/graph";
import type { AtomicCommandV1, AtomicCommitV1 } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  AuthorizationContextV1Schema,
  RiskIdentificationReadQueryV1Schema,
  RiskDashboardRiskRecordsSourceRequestV1Schema,
  type AgentTaskRefV1,
  type AuthorizationContextV1,
  type IdentificationCandidateSetRefV1,
  type IdentificationGroupRefV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ReviewTaskRefV1,
  type RiskDashboardRiskRecordsSourceRequestV1,
  type RiskDashboardTimelineAfterV1,
  type RiskDashboardTimelineEventV1,
  type RiskIdentificationReadQueryV1,
  type RiskRecordCatalogItemV1,
  type StandardizedRiskRecordRefV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";
import { IdentificationInputSnapshotV1Schema } from "@riskflow/contracts/workflows";

import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../src/identification/candidate-finalization/postgres-risk-candidate-adapter.js";
import {
  createPostgresIdentificationGraphAdapter,
  identificationGraphReadInvocationIdV1,
  type PostgresIdentificationGraphAdapterV1,
} from "../../src/identification/graph/index.js";
import { PostgresRiskIdentificationReadAdapter } from "../../src/identification/read/index.js";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
  type PostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

const PROJECT_ID = "project-c33-read";
const OTHER_PROJECT_ID = "project-c33-read-other";
const ACTOR_ID = "actor-c33";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const SCOPES = [
  { kind: "spatial-scope", reference: { entityId: "scope-c33", versionId: "v1" } },
] as const;
const SOURCE_GRANTS = [
  {
    kind: "source-access-grant",
    reference: { entityId: "source-grant-c33", versionId: "v1" },
  },
] as const;

const plainRef = (entityId: string, versionId = "v1") => ({ entityId, versionId });
const refOf = <const T extends string>(kind: T, entityId: string, versionId = "v1") =>
  ({ kind, reference: { entityId, versionId } }) as const;

/** 登记行的范围摘要：与签发上下文的空间/资料范围逐字对应（摘要不含能力与身份）。 */
const registrationScopeDigest = authorizationScopeDigest(
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: ["risk-identification.run"],
    spatialScopeRefs: [...SCOPES],
    sourceAccessGrantRefs: [...SOURCE_GRANTS],
    authorizationPolicyRef: plainRef("authorization-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  }),
);

/**
 * C05 当前授权复验端口的受控替身（同 C24 读侧夹具）：只按签发身份放行，撤销后一律拒绝；
 * `narrowScope` 模拟当前范围收窄，使登记范围摘要对账失败可观察。
 */
interface IssuedAccessV1 {
  readonly authorization: AuthorizationContextV1;
  readonly invocationId: string;
  readonly branch: ModuleBranchV1;
  readonly capability: ModuleCapabilityV1;
}

interface ReadAccessControllerV1 {
  readonly port: Pick<
    PostgresLocalIdentityAccess,
    "verify" | "readDeploymentAuthorizationSource" | "authorizeBusinessAction"
  > & {
    filterVisibleSources(input: {
      readonly branch?: ModuleBranchV1;
      readonly authorization: AuthorizationContextV1;
      readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    }): Promise<readonly SourceVersionRefV1[]>;
  };
  revoke(): void;
  narrowScope(): void;
  widenScope(): void;
  denySource(sourceId: string): void;
  denyVisibleSources(): void;
  hideResource(contextId: string): void;
  restore(): void;
  issue(input: {
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly capability: ModuleCapabilityV1;
    readonly projectId?: string;
    readonly actorId?: string;
    readonly emptySources?: boolean;
  }): IssuedAccessV1;
}

const createReadAccess = (): ReadAccessControllerV1 => {
  const issued = new Map<string, IssuedAccessV1>();
  let revoked = false;
  let scopeNarrowed = false;
  let scopeWidened = false;
  const deniedSources = new Set<string>();
  const hiddenResources = new Set<string>();
  let visibleSourcesDenied = false;
  const historical = AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: ["risk-identification.read"],
    spatialScopeRefs: [...SCOPES],
    sourceAccessGrantRefs: [...SOURCE_GRANTS],
    authorizationPolicyRef: plainRef("authorization-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });
  const denied: (stage: string) => never = (stage) => {
    throw new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
      stage,
      occurredAt: TIMESTAMP,
      diagnosticRef: refOf("audit-trail", `access-diagnostic:${stage}`),
      contextRefs: [],
      requiredCapability: "risk-identification.read",
      authorizationPolicyRef: plainRef("authorization-policy"),
    });
  };
  return {
    revoke: () => {
      revoked = true;
    },
    narrowScope: () => {
      scopeNarrowed = true;
    },
    widenScope: () => {
      scopeWidened = true;
    },
    denySource: (sourceId) => {
      deniedSources.add(sourceId);
    },
    denyVisibleSources: () => {
      visibleSourcesDenied = true;
    },
    hideResource: (contextId) => {
      hiddenResources.add(contextId);
    },
    restore: () => {
      revoked = false;
      scopeNarrowed = false;
      scopeWidened = false;
      deniedSources.clear();
      hiddenResources.clear();
      visibleSourcesDenied = false;
    },
    issue: (input) => {
      const projectId = input.projectId ?? PROJECT_ID;
      const entityId = `authorization-c33:${input.branch}:${input.invocationId}`;
      const access: IssuedAccessV1 = {
        authorization: AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: refOf("authorization-context", entityId),
          actorId: input.actorId ?? ACTOR_ID,
          projectId,
          grantedCapabilities: [input.capability],
          spatialScopeRefs: [...SCOPES],
          sourceAccessGrantRefs: input.emptySources
            ? []
            : scopeWidened
              ? [...SOURCE_GRANTS, refOf("source-access-grant", "unrelated-grant")]
              : [...SOURCE_GRANTS],
          authorizationPolicyRef: plainRef("authorization-policy"),
          decidedAt: TIMESTAMP,
          invocation: { kind: "human" },
        }),
        invocationId: input.invocationId,
        branch: input.branch,
        capability: input.capability,
      };
      issued.set(entityId, access);
      return access;
    },
    port: {
      readDeploymentAuthorizationSource: async (request) => {
        const id = request.authorizationContextRef.reference.entityId;
        if (hiddenResources.has(id)) return undefined;
        const context =
          id === "authorization-c33"
            ? historical
            : id === "authorization-c33-empty"
              ? {
                  ...historical,
                  authorizationContextRef: request.authorizationContextRef,
                  sourceAccessGrantRefs: [],
                }
              : issued.get(id)?.authorization;
        if (
          context === undefined ||
          context.projectId !== request.projectId ||
          context.authorizationContextRef.reference.versionId !==
            request.authorizationContextRef.reference.versionId
        )
          return undefined;
        return {
          context,
          invocationId: id,
          branch: "risk-identification.run-read",
          parentContextRef: undefined,
          causalRunRef: undefined,
          causalCommandRef: undefined,
          sourceVersionRefs:
            context.sourceAccessGrantRefs.length === 0
              ? []
              : [refOf("source-version", "source-version-c33")],
        };
      },
      authorizeBusinessAction: async (request) => {
        if (
          revoked ||
          scopeNarrowed ||
          request.requestedSourceVersionRefs.some((ref) =>
            deniedSources.has(ref.reference.entityId),
          )
        )
          denied("authorize.current-resource");
        const context = AuthorizationContextV1Schema.parse({
          ...historical,
          actorId: request.actorId,
          projectId: request.projectId,
          authorizationContextRef:
            request.authorizationContextRef ?? historical.authorizationContextRef,
          grantedCapabilities: [request.capability],
          spatialScopeRefs: request.requestedSpatialScopeRefs,
          sourceAccessGrantRefs:
            request.requestedSourceVersionRefs.length === 0 ? [] : [...SOURCE_GRANTS],
        });
        return { context, contextRef: context.authorizationContextRef, redacted: false };
      },
      filterVisibleSources: async (request) => {
        if (revoked || visibleSourcesDenied) denied("authorize.visible-sources");
        // 与真实 C06 同形：无来源权时只是不进入可见子集，不抛错也不返回空成功统计。
        return request.sourceVersionRefs.filter(
          (ref) => !deniedSources.has(ref.reference.entityId),
        );
      },
      verify: async (request) => {
        if (revoked) denied("verify.current");
        const stored = issued.get(request.authorizationContextRef.reference.entityId);
        if (
          stored === undefined ||
          stored.invocationId !== request.invocationId ||
          stored.branch !== request.branch ||
          stored.authorization.projectId !== request.projectId
        ) {
          denied("verify.binding");
        }
        return {
          context: AuthorizationContextV1Schema.parse({
            ...stored.authorization,
            spatialScopeRefs: scopeNarrowed ? [] : [...SCOPES],
          }),
          contextRef: stored.authorization.authorizationContextRef,
          redacted: false,
        };
      },
    },
  };
};

interface ReadTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly graphAdapter: PostgresIdentificationGraphAdapterV1;
  readonly finalizationAdapter: PostgresRiskCandidateFinalizationAdapter;
  readonly reader: PostgresRiskIdentificationReadAdapter;
  readonly artifactStore: ArtifactStoreV1 & { close(): Promise<void> };
  readonly access: ReadAccessControllerV1;
  readonly rootDirectory: string;
  close(): Promise<void>;
}

/** 单容器夹具：完整生产迁移链 + C04 文件系统工件存储；播种与读取共用同一 riskflow_app 连接。 */
const startReadFixture = async (): Promise<ReadTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c33-read-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const registry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
    });
    const artifactStore = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry,
      transactionUnit,
    });
    const access = createReadAccess();
    const graphAdapter = createPostgresIdentificationGraphAdapter({
      db: runtime.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      now: () => new Date(TIMESTAMP),
    });
    const finalizationAdapter = new PostgresRiskCandidateFinalizationAdapter({
      db: runtime.db,
      transactionUnit,
    });
    const reader = new PostgresRiskIdentificationReadAdapter({
      db: runtime.db,
      artifactStore,
      authorization: access.port,
      now: () => new Date(TIMESTAMP),
    });
    return {
      postgres,
      runtime,
      transactionUnit,
      graphAdapter,
      finalizationAdapter,
      reader,
      artifactStore,
      access,
      rootDirectory,
      async close() {
        await artifactStore.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

const inputSnapshot = () =>
  IdentificationInputSnapshotV1Schema.parse({
    schemaVersion: "1",
    preparationSnapshotRef: refOf(
      "identification-preparation-snapshot",
      "identification-preparation-snapshot:c33",
    ),
    processModelReleaseRef: refOf("process-model-release", "process-model-c33"),
    riskMechanismReleaseRef: refOf("risk-mechanism-release", "risk-mechanism-c33"),
    retrievalEvidenceBaseReleaseRef: refOf(
      "retrieval-evidence-base-release",
      "retrieval-evidence-base-c33",
    ),
    identificationPolicySetRef: refOf("identification-policy-set", "identification-policy-set-c33"),
    retrievalPolicyRef: plainRef("policy-retrieval"),
    retrievalReviewAgentPolicyRef: plainRef("policy-retrieval-review-agent"),
    repairPolicyRef: plainRef("policy-repair"),
    confidencePolicyRef: plainRef("policy-confidence"),
    forcedReviewPolicyRef: plainRef("policy-forced-review"),
    retryPolicyRef: plainRef("policy-retry"),
    modelDeploymentRef: plainRef("model-deployment"),
    promptTemplateRef: plainRef("prompt-template"),
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    auditTrailRef: refOf("audit-trail", "audit-trail:c33"),
    createdBy: ACTOR_ID,
    createdAt: TIMESTAMP,
  });

const agentTaskRefFor = (suffix: string): AgentTaskRefV1 => ({
  kind: "agent-task",
  reference: plainRef(`agent-task:c33:${suffix}`),
  taskType: "retrieval-review",
  triggerMode: "embedded",
  modelDeploymentRef: plainRef("model-deployment"),
  promptTemplateRef: plainRef("prompt-template"),
  toolPolicyRef: plainRef("policy-tool"),
  budgetPolicyRef: plainRef("policy-budget"),
  incrementSchemaRef: plainRef("schema-increment"),
  validationPolicyRef: plainRef("policy-validation"),
});

const reviewTaskRefFor = (
  suffix: string,
  groupRef: IdentificationGroupRefV1,
  runRef: WorkflowRunRefV1,
): ReviewTaskRefV1 => ({
  kind: "review-task",
  reference: plainRef(`review-task:c33:${suffix}`),
  reviewType: "identification-group",
  targetRef: groupRef,
  waitingRunRef: runRef,
});

const groupRefFor = (runId: string, groupId: string): IdentificationGroupRefV1 =>
  refOf(
    "identification-group",
    `identification-group:${runId}:${groupId}`,
    sha(`group-${runId}-${groupId}`),
  );

/** 经图适配器写入 C04 正文：身份与生产读侧使用同一 `body-write` 派生约定。 */
const putGraphBody = (
  fixture: ReadTestFixture,
  input: { readonly artifactId: string; readonly body: unknown; readonly emptySources?: boolean },
): Promise<ArtifactRefV1> => {
  const issued = fixture.access.issue({
    invocationId: identificationGraphReadInvocationIdV1({
      operation: "body-write",
      projectId: PROJECT_ID,
      targetId: input.artifactId,
    }),
    branch: "risk-identification.plan",
    capability: "risk-identification.run",
    emptySources: input.emptySources,
  });
  return fixture.graphAdapter.putBody({
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    commandId: `c33-fixture-put-${input.artifactId}`,
    issuedAt: TIMESTAMP,
    artifactId: input.artifactId,
    body: IdentificationGraphArtifactBodyV1Schema.parse(input.body),
    authorization: issued.authorization,
  });
};

const graphRowFor = (input: {
  readonly kind: "work-plan" | "stage-result" | "run-state";
  readonly suffix: string;
  readonly runId: string;
  readonly runVersionId: string;
  readonly artifactRef: ArtifactRefV1;
  readonly validAt: string;
  readonly resultId: string;
  readonly workPlanRef?: ReturnType<typeof refOf>;
  readonly stageResultRef?: ReturnType<typeof refOf>;
  readonly inputSnapshotRef?: ReturnType<typeof refOf>;
  readonly emptySources?: boolean;
}): IdentificationGraphResultRowV1 => {
  const base = {
    schemaVersion: "1" as const,
    projectId: PROJECT_ID,
    resultId: input.resultId,
    resultVersionId: sha(`result-version-${input.suffix}`),
    runId: input.runId,
    runVersionId: input.runVersionId,
    commandId: `c33-fixture-${input.suffix}`,
    idempotencyKey: `idempotency-${input.suffix}`,
    requestDigest: sha(`request-${input.suffix}`),
    artifactRef: input.artifactRef,
    authorizationScopeDigest: input.emptySources ? sha("empty-sources") : registrationScopeDigest,
    actorRef: ACTOR_ID,
    authorizationContextRef: refOf(
      "authorization-context",
      input.emptySources ? "authorization-c33-empty" : "authorization-c33",
    ),
    validAt: input.validAt,
    recordedAt: input.validAt,
    persistedAt: input.validAt,
    auditEntryId: `c33-fixture-${input.suffix}:audit`,
  };
  switch (input.kind) {
    case "work-plan":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "work-plan",
        parentRunRef: refOf("workflow-run", `risk-flow-run:${PROJECT_ID}`, sha("parent-version")),
        inputSnapshotRef: input.inputSnapshotRef,
        workPlanRef: input.workPlanRef,
      });
    case "stage-result":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "stage-result",
        workPlanRef: input.workPlanRef,
        stageResultRef: input.stageResultRef,
      });
    case "run-state":
      return IdentificationGraphResultRowV1Schema.parse({ ...base, resultKind: "run-state" });
  }
};

/**
 * 登记只在调用方 ambient C03 事务内发生：这里按与生产同一顺序驱动 commit 与审计。批量登记共用
 * 同一命令身份与同一条审计行（C03 `AtomicCommitV1` 只承载一条审计），因此批次内每行都按该命令
 * 派生 `auditEntryId`。
 */
const registerGraphRows = async (
  fixture: ReadTestFixture,
  rows: readonly IdentificationGraphResultRowV1[],
  commandId: string,
): Promise<void> => {
  const head = rows[0] as IdentificationGraphResultRowV1;
  const normalized = rows.map((row) =>
    IdentificationGraphResultRowV1Schema.parse({
      ...row,
      commandId,
      auditEntryId: `${commandId}:audit`,
    }),
  );
  const command: AtomicCommandV1 = {
    projectId: PROJECT_ID,
    commandKind: "identification-graph-result-register",
    commandId,
    idempotencyKey: commandId,
    payload: {
      fixture: "合成样本、待甲方复核",
      resultKinds: normalized.map((row) => row.resultKind),
    },
    actorRef: ACTOR_ID,
    authorizationContextRef: head.authorizationContextRef,
    issuedAt: TIMESTAMP,
  };
  const commit: AtomicCommitV1 = {
    resultRef: head.artifactRef,
    audit: {
      auditEntryId: `${commandId}:audit`,
      projectId: PROJECT_ID,
      action: command.commandKind,
      targetRef: head.artifactRef,
      actorRef: ACTOR_ID,
      authorizationContextRef: head.authorizationContextRef,
      occurredAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      version: { entityId: head.resultId, versionId: head.resultVersionId },
      commandId,
      idempotencyKey: commandId,
    },
    events: [],
  };
  await fixture.transactionUnit.execute(command, async (context) => {
    const outcome = await fixture.graphAdapter.registerResults(
      { rows: normalized, occurredAt: TIMESTAMP },
      context,
    );
    if (outcome.kind !== "registered") throw new TypeError("graph row seeding failed");
    return commit;
  });
};

/** C22 中间正文经 C04 写入：目的码由调用方给出，正文不进入登记表。 */
const putFinalizationBody = async (
  fixture: ReadTestFixture,
  input: {
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly body: unknown;
  },
): Promise<ArtifactRefV1> => {
  const commandId = `c33-fixture-put-${input.artifactId}`;
  const put = await fixture.artifactStore.put(
    ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId,
      idempotencyKey: commandId,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: AuthorizationContextV1Schema.parse({
        schemaVersion: "1",
        authorizationContextRef: refOf("authorization-context", "authorization-c33"),
        actorId: ACTOR_ID,
        projectId: PROJECT_ID,
        grantedCapabilities: ["risk-identification.finalize"],
        spatialScopeRefs: [...SCOPES],
        sourceAccessGrantRefs: [...SOURCE_GRANTS],
        authorizationPolicyRef: plainRef("authorization-policy"),
        decidedAt: TIMESTAMP,
        invocation: { kind: "human" },
      }),
      requiredCapability: "risk-identification.finalize",
      artifactId: input.artifactId,
      artifactKind: "content",
      purposeCode: input.purposeCode,
      mediaType: "application/json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    }),
    (async function* () {
      yield new TextEncoder().encode(JSON.stringify(input.body));
    })(),
  );
  return put.artifactRef;
};

/**
 * 登记 C22 候选集行：登记引用逐字取自调用方给定的候选集引用，夹具不替生产派生任何身份。
 * 同一工作项的多个版本即该工作项下先后登记的候选集（含修正登记）。
 */
const registerCandidateSets = async (
  fixture: ReadTestFixture,
  input: {
    readonly candidateSetRefs: readonly IdentificationCandidateSetRefV1[];
    readonly workItemRef: ReturnType<typeof refOf>;
    readonly inputSnapshotRef: ReturnType<typeof refOf>;
    readonly artifactRef: ArtifactRefV1;
    readonly occurredAt: string;
    readonly commandSuffix: string;
  },
): Promise<void> => {
  const rows = input.candidateSetRefs.map((candidateSetRef) =>
    RiskCandidateFinalizationResultRowV1Schema.parse({
      schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
      commandId: `c33-fixture-candidate-${input.commandSuffix}`,
      projectId: PROJECT_ID,
      resultId: candidateSetRef.reference.entityId,
      resultVersionId: candidateSetRef.reference.versionId,
      requestDigest: sha(`candidate-request-${candidateSetRef.reference.versionId}`),
      artifactRef: input.artifactRef,
      inputSnapshotRef: input.inputSnapshotRef,
      authorizationScopeDigest: registrationScopeDigest,
      actorRef: ACTOR_ID,
      authorizationContextRef: refOf("authorization-context", "authorization-c33"),
      resultKind: "candidate-set",
      workItemRef: input.workItemRef,
      modelContextArtifactSetRef: refOf(
        "model-context-artifact-set",
        `model-context:${PROJECT_ID}:${input.workItemRef.reference.entityId}`,
      ),
      candidateSetRef,
    }),
  );
  const head = rows[0] as (typeof rows)[number];
  const command: AtomicCommandV1 = {
    projectId: PROJECT_ID,
    commandKind: "identification.generate-candidates",
    commandId: `c33-fixture-candidate-${input.commandSuffix}`,
    idempotencyKey: `c33-fixture-candidate-${input.commandSuffix}`,
    payload: { fixture: "合成样本、待甲方复核" },
    actorRef: ACTOR_ID,
    authorizationContextRef: head.authorizationContextRef,
    issuedAt: TIMESTAMP,
  };
  await fixture.transactionUnit.execute(command, async (context) => {
    const outcome = await fixture.finalizationAdapter.registerResults(
      { rows, occurredAt: input.occurredAt },
      context,
    );
    if (outcome.kind !== "registered") throw new TypeError("candidate set seeding failed");
    return {
      resultRef: head.artifactRef,
      audit: {
        auditEntryId: `${command.commandId}:audit`,
        projectId: PROJECT_ID,
        action: command.commandKind,
        targetRef: head.artifactRef,
        actorRef: ACTOR_ID,
        authorizationContextRef: command.authorizationContextRef,
        occurredAt: input.occurredAt,
        recordedAt: input.occurredAt,
        version: { entityId: head.resultId, versionId: head.resultVersionId },
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
      },
      events: [],
    } satisfies AtomicCommitV1;
  });
};

const candidateBody = (
  workItemRef: ReturnType<typeof refOf>,
  inputSnapshotRef: ReturnType<typeof refOf>,
) => {
  const common = {
    projectId: PROJECT_ID,
    workItemRef,
    inputSnapshotRef,
    nodeId: "node-1",
    modelContextArtifactSetRef: refOf("model-context-artifact-set", "context-c33"),
    modelDeploymentRef: plainRef("model-deployment"),
    promptTemplateRef: plainRef("prompt-template"),
    outputSchemaRef: plainRef("output-schema"),
    budgetPolicyRef: plainRef("budget-policy"),
  };
  const rawResponseRef = refOf("diagnostic-artifact", "raw-c33", `sha256:${sha("raw-c33")}`);
  return RiskCandidateSetV1Schema.parse({
    schemaVersion: "1",
    ...common,
    retrievalArtifactSetRef: refOf("retrieval-artifact-set", "retrieval-c33"),
    modelContextPayloadDigest: sha("context-c33"),
    policySetRef: refOf("identification-policy-set", "identification-policy-set-c33"),
    generationPolicyRef: plainRef("generation-policy"),
    candidateSetVersion: 1,
    candidates: [
      {
        ...common,
        candidateId: "candidate-c33",
        candidateVersion: 1,
        output: {
          riskSource: "source",
          riskFactor: "factor",
          riskEvent: "event",
          riskElementRelations: [{ sourceElement: "a", relation: "induces", targetElement: "b" }],
          evidenceLocator: { sourceSegmentId: "segment-c33" },
          modelConfidence: 0.8,
        },
        rawResponseRef,
        invocationId: "model-c33",
        generatedAt: TIMESTAMP,
      },
    ],
    rawResponseRefs: [rawResponseRef],
    usage: {
      modelInvocations: 1,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      outputBytes: 1,
      elapsedMs: 1,
      repairRounds: 0,
    },
    authorizationScopeDigest: registrationScopeDigest,
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    generatedAt: TIMESTAMP,
  });
};

const READ_BRANCH_FOR: Record<RiskIdentificationReadQueryV1["kind"], ModuleBranchV1> = {
  "run-list": "risk-identification.run-list",
  "run-read": "risk-identification.run-read",
  "record-catalog": "risk-identification.record-catalog",
  "record-read": "risk-identification.record-read",
};

let queryCount = 0;
const readQuery = <K extends RiskIdentificationReadQueryV1["kind"]>(
  fixture: ReadTestFixture,
  kind: K,
  payload: Extract<RiskIdentificationReadQueryV1, { kind: K }>["payload"],
  options: { readonly projectId?: string; readonly actorId?: string } = {},
): RiskIdentificationReadQueryV1 => {
  const queryId = `c33-query-${++queryCount}`;
  const authorization = fixture.access.issue({
    invocationId: queryId,
    branch: READ_BRANCH_FOR[kind],
    capability: "risk-identification.read",
    projectId: options.projectId,
    actorId: options.actorId,
  }).authorization;
  return RiskIdentificationReadQueryV1Schema.parse({
    queryId,
    projectId: options.projectId ?? PROJECT_ID,
    actorId: authorization.actorId,
    requestedAt: TIMESTAMP,
    authorization,
    kind,
    payload,
  }) as RiskIdentificationReadQueryV1;
};

const runStateBody = (input: {
  readonly runId: string;
  readonly runVersionId: string;
  readonly stage: "I3" | "I5" | "I9";
  readonly status: "running" | "waiting" | "retryable-failure" | "terminal-failure" | "completed";
  readonly workItemRef: ReturnType<typeof refOf>;
  readonly extra?: Record<string, unknown>;
}) => ({
  bodyKind: "run-state" as const,
  runState: IdentificationGraphRunStateV1Schema.parse({
    schemaVersion: "1",
    runId: input.runId,
    runVersionId: input.runVersionId,
    stage: input.stage,
    status: input.status,
    completedWorkItemRefs: [],
    pendingWorkItemRefs: [input.workItemRef],
    validatedCandidateSetRefs: [],
    failedWorkItemRefs: [],
    acceptedRiskRecordRefs: [],
    rejectedGroupRefs: [],
    pendingGroupRefs: [],
    ...input.extra,
  }),
});

/** 只含 run-state 登记行与正文的运行：run-list 只消费这类事实。 */
const seedBareRun = async (
  fixture: ReadTestFixture,
  input: {
    readonly suffix: string;
    readonly validAt: string;
    readonly stage: "I3" | "I5" | "I9";
    readonly status: "running" | "waiting" | "completed";
    readonly extra?: Record<string, unknown>;
    readonly emptySources?: boolean;
  },
): Promise<WorkflowRunRefV1> => {
  const runId = `workflow-run:${PROJECT_ID}:${input.suffix}`;
  const runVersionId = sha(`run-version-${input.suffix}`);
  const artifactRef = await putGraphBody(fixture, {
    artifactId: `c33-body-run-state-${input.suffix}`,
    emptySources: input.emptySources,
    body: runStateBody({
      runId,
      runVersionId,
      stage: input.stage,
      status: input.status,
      workItemRef: refOf("identification-work-item", `work-item:${runId}:node-1`),
      extra: input.extra,
    }),
  });
  await registerGraphRows(
    fixture,
    [
      graphRowFor({
        kind: "run-state",
        suffix: `run-state-${input.suffix}`,
        emptySources: input.emptySources,
        runId,
        runVersionId,
        artifactRef,
        validAt: input.validAt,
        resultId: `result-run-state-${input.suffix}`,
      }),
    ],
    `c33-fixture-register-${input.suffix}`,
  );
  return refOf("workflow-run", runId, runVersionId);
};

interface SeededRunV1 {
  readonly runRef: WorkflowRunRefV1;
  readonly workItemRef: ReturnType<typeof refOf>;
  readonly workPlanRef: ReturnType<typeof refOf>;
  readonly agentTaskRef: AgentTaskRefV1;
  readonly reviewTaskRef: ReviewTaskRefV1;
  readonly acceptedGroupRef: IdentificationGroupRefV1;
  readonly pendingGroupRef: IdentificationGroupRefV1;
  readonly rejectedGroupRef: IdentificationGroupRefV1;
  readonly recordRef: StandardizedRiskRecordRefV1;
  readonly routeDecisionRef: ReturnType<typeof refOf>;
  readonly reviewDecisionRef: ReturnType<typeof refOf>;
  readonly routeSetRef: ReturnType<typeof refOf>;
  /** 本运行工作项下已登记的候选集引用（按登记顺序），测试据此核对读结果。 */
  readonly candidateSetRefs: readonly IdentificationCandidateSetRefV1[];
}

/** 完整运行：工作计划 + I1/I3/I5/I7 阶段正文 + 验收路由集 + 一条标准化风险记录 + run-state。 */
const seedCompletedRun = async (
  fixture: ReadTestFixture,
  input: {
    readonly suffix: string;
    readonly validAt: string;
    readonly candidateSetVersions?: readonly string[];
    readonly emptyFinalSources?: boolean;
  },
): Promise<SeededRunV1> => {
  const { suffix } = input;
  const runId = `workflow-run:${PROJECT_ID}:${suffix}`;
  const runVersionId = sha(`run-version-${suffix}`);
  const runRef = refOf("workflow-run", runId, runVersionId);
  const workPlanRef = refOf(
    "identification-work-plan",
    `identification-work-plan:${runId}`,
    sha(`work-plan-request-${suffix}`),
  );
  const inputSnapshotRef = refOf(
    "identification-input-snapshot",
    `identification-input-snapshot:${runId}`,
    sha(`input-snapshot-request-${suffix}`),
  );
  const workItemRef = refOf(
    "identification-work-item",
    `identification-work-item:${runId}:node-1`,
    sha(`work-item-request-${suffix}`),
  );
  const agentTaskRef = agentTaskRefFor(suffix);
  const acceptedGroupRef = groupRefFor(runId, "group-accepted");
  const pendingGroupRef = groupRefFor(runId, "group-pending");
  const rejectedGroupRef = groupRefFor(runId, "group-rejected");
  const reviewTaskRef = reviewTaskRefFor(suffix, pendingGroupRef, runRef);
  const recordRef: StandardizedRiskRecordRefV1 = refOf(
    "standardized-risk-record",
    `risk-record:${runId}:record-1`,
    "v1",
  );
  const routeDecisionRef = refOf(
    "route-decision",
    `route-decision:${runId}:group-accepted`,
    sha(`route-decision-${suffix}`),
  );
  const reviewDecisionRef = refOf(
    "review-decision",
    `review-decision:${runId}:group-pending`,
    sha(`review-decision-${suffix}`),
  );
  const routeSetRef = refOf(
    "acceptance-route-set",
    `acceptance-route-set:${runId}`,
    sha(`route-set-${suffix}`),
  );
  const mergePlanRef = refOf("merge-plan", `merge-plan:${runId}`, sha(`merge-plan-${suffix}`));

  const planArtifactRef = await putGraphBody(fixture, {
    artifactId: `c33-body-plan-${suffix}`,
    body: {
      bodyKind: "work-plan",
      workPlan: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        workPlanRef,
        inputSnapshotRef,
        inputSnapshot: inputSnapshot(),
        workItems: [
          {
            schemaVersion: "1",
            workItemRef,
            nodeId: "node-1",
            spatialScopeRefs: [...SCOPES],
            sourceVersionRefs: [refOf("source-version", "source-version-c33")],
            sourceSegmentSetRefs: [refOf("source-segment-set", "source-segment-set-c33")],
            frozenQueryText: "node-1 冻结查询依据",
          },
        ],
        excludedWorkItems: [],
      },
    },
  });

  const stageBodies: readonly {
    readonly stage: string;
    readonly body: Record<string, unknown>;
  }[] = [
    {
      stage: "I1",
      body: {
        stage: "I1",
        resultKind: "ready",
        inputSnapshotRef,
      },
    },
    {
      stage: "I3",
      body: {
        stage: "I3",
        retrievalArtifactSetRefs: [],
        agentTaskRefs: [agentTaskRef],
        failedWorkItemRefs: [],
      },
    },
    {
      stage: "I5",
      body: {
        stage: "I5",
        validatedCandidateSetRef: refOf(
          "validated-candidate-set",
          `validated-candidate-set:${runId}:node-1`,
          sha(`validated-${suffix}`),
        ),
        reviewTaskRefs: [reviewTaskRef],
      },
    },
    {
      stage: "I7",
      body: {
        stage: "I7",
        acceptanceRouteSetRef: routeSetRef,
        reviewTaskRefs: [reviewTaskRef],
      },
    },
  ];
  const stageRows: IdentificationGraphResultRowV1[] = [];
  for (const stage of stageBodies) {
    const stageResultRef = refOf(
      "stage-result",
      `stage-result:${runId}:${stage.stage}`,
      sha(`stage-result-${suffix}-${stage.stage}`),
    );
    const artifactRef = await putGraphBody(fixture, {
      artifactId: `c33-body-stage-${suffix}-${stage.stage}`,
      body: {
        bodyKind: "stage-result",
        stageResult: { schemaVersion: "1", runRef, recordedAt: input.validAt, ...stage.body },
      },
    });
    stageRows.push(
      graphRowFor({
        kind: "stage-result",
        suffix: `${suffix}-stage-${stage.stage}`,
        runId,
        runVersionId: sha(`stage-state-${suffix}-${stage.stage}`),
        artifactRef,
        validAt: input.validAt,
        resultId: stageResultRef.reference.entityId,
        workPlanRef,
        stageResultRef,
      }),
    );
  }

  // 验收路由集正文走 C04（C22 写入语义），登记行走既有 C22 适配器。
  const routeSet = AcceptanceRouteSetV1Schema.parse({
    schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
    projectId: PROJECT_ID,
    workPlanRef,
    identificationRunRef: runRef,
    inputSnapshotRef,
    policySetRef: refOf("identification-policy-set", "identification-policy-set-c33"),
    mergePlanRef,
    confidencePolicyRef: plainRef("policy-confidence"),
    forcedReviewPolicyRef: plainRef("policy-forced-review"),
    routes: [
      {
        routeKind: "automatic",
        groupId: "group-accepted",
        groupVersionId: acceptedGroupRef.reference.versionId,
        groupRef: acceptedGroupRef,
        compositeConfidence: {
          value: 0.8,
          basis: [
            {
              source: "model-confidence",
              available: true,
              value: 0.8,
              weight: 1,
              contribution: 0.8,
            },
            {
              source: "rule-consistency",
              available: true,
              value: 0.8,
              weight: 1,
              contribution: 0.8,
            },
            {
              source: "simulation-constraint",
              available: true,
              value: 0.8,
              weight: 1,
              contribution: 0.8,
            },
            {
              source: "multi-source-merge",
              available: true,
              value: 0.8,
              weight: 1,
              contribution: 0.8,
            },
          ],
          policyRef: plainRef("policy-confidence"),
          missingBasisBehavior: "block",
          roundingDecimals: 4,
        },
        routeDecisionRef,
      },
      {
        routeKind: "review",
        groupId: "group-pending",
        groupVersionId: pendingGroupRef.reference.versionId,
        groupRef: pendingGroupRef,
        compositeConfidence: {
          value: 0.5,
          basis: [
            {
              source: "model-confidence",
              available: true,
              value: 0.5,
              weight: 1,
              contribution: 0.5,
            },
            {
              source: "rule-consistency",
              available: true,
              value: 0.5,
              weight: 1,
              contribution: 0.5,
            },
            {
              source: "simulation-constraint",
              available: true,
              value: 0.5,
              weight: 1,
              contribution: 0.5,
            },
            {
              source: "multi-source-merge",
              available: true,
              value: 0.5,
              weight: 1,
              contribution: 0.5,
            },
          ],
          policyRef: plainRef("policy-confidence"),
          missingBasisBehavior: "block",
          roundingDecimals: 4,
        },
        reviewTaskRef,
        waitingRunRef: runRef,
        validationSnapshotRef: refOf("validation-snapshot", `validation-snapshot:${runId}`),
        evidenceSnapshotRef: refOf("evidence-snapshot", `evidence-snapshot:${runId}`),
        reviewPolicyRef: plainRef("policy-review"),
        forcedReviewReasonCode: "below-confidence-threshold",
      },
    ],
    authorizationScopeDigest: registrationScopeDigest,
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    routedAt: input.validAt,
  });
  const routeSetArtifactRef = await putFinalizationBody(fixture, {
    artifactId: `c33-body-route-set-${suffix}`,
    purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.acceptanceRouteSet,
    body: routeSet,
  });
  const routeSetRow = RiskCandidateFinalizationResultRowV1Schema.parse({
    schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
    commandId: `c33-fixture-route-set-${suffix}`,
    projectId: PROJECT_ID,
    resultId: routeSetRef.reference.entityId,
    resultVersionId: routeSetRef.reference.versionId,
    requestDigest: sha(`route-set-request-${suffix}`),
    artifactRef: routeSetArtifactRef,
    inputSnapshotRef,
    authorizationScopeDigest: registrationScopeDigest,
    actorRef: ACTOR_ID,
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    resultKind: "acceptance-route-set",
    workPlanRef,
    mergePlanRef,
    acceptanceRouteSetRef: routeSetRef,
  });
  {
    const command: AtomicCommandV1 = {
      projectId: PROJECT_ID,
      commandKind: "identification.accept-groups",
      commandId: `c33-fixture-route-set-${suffix}`,
      idempotencyKey: `c33-fixture-route-set-${suffix}`,
      payload: { fixture: "合成样本、待甲方复核" },
      actorRef: ACTOR_ID,
      authorizationContextRef: refOf("authorization-context", "authorization-c33"),
      issuedAt: TIMESTAMP,
    };
    await fixture.transactionUnit.execute(command, async (context) => {
      const outcome = await fixture.finalizationAdapter.registerResults(
        { rows: [routeSetRow], occurredAt: input.validAt },
        context,
      );
      if (outcome.kind !== "registered") throw new TypeError("route set seeding failed");
      return {
        resultRef: routeSetRef,
        audit: {
          auditEntryId: `c33-fixture-route-set-${suffix}:audit`,
          projectId: PROJECT_ID,
          action: command.commandKind,
          targetRef: routeSetRef,
          actorRef: ACTOR_ID,
          authorizationContextRef: command.authorizationContextRef,
          occurredAt: input.validAt,
          recordedAt: input.validAt,
          version: routeSetRef.reference,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
        },
        events: [],
      } satisfies AtomicCommitV1;
    });
  }

  // 标准化风险记录：自动路线记录挂在已验收组上，经既有 C22 写入路径入库。
  const recordWrite = StandardizedRiskRecordWriteV1Schema.parse({
    riskRecordId: recordRef.reference.entityId,
    versionId: "v1",
    riskRecordRef: recordRef,
    rowId: `row-${suffix}`,
    idempotencyKey: `identification.accept-groups:${suffix}`,
    requestDigest: sha(`record-request-${suffix}`),
    projectId: PROJECT_ID,
    workPlanRef,
    identificationRunRef: runRef,
    inputSnapshotRef,
    mergePlanRef,
    routeDecisionRef,
    groupId: "group-accepted",
    groupVersionId: acceptedGroupRef.reference.versionId,
    groupRef: acceptedGroupRef,
    representativeCandidateRefs: [
      refOf(
        "content-artifact",
        `candidate-artifact-${suffix}`,
        `sha256:${sha(`candidate-${suffix}`)}`,
      ),
    ],
    sourceSegmentIds: [`segment-${suffix}-1`, `segment-${suffix}-2`],
    mechanismEntryIds: [`mechanism-${suffix}-1`],
    spatialScopeRefs: [refOf("spatial-scope", `spatial-scope-${suffix}`)],
    sourceVersionRefs: [refOf("source-version", `source-version-${suffix}`)],
    evidenceReferences: [
      {
        locator: { sourceSegmentId: `segment-${suffix}-1` },
        sourceVersion: { entityId: `source-version-${suffix}`, versionId: "v1" },
      },
    ],
    authorizationScopeDigest: registrationScopeDigest,
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    actorRef: ACTOR_ID,
    commandId: `c33-fixture-record-${suffix}`,
    occurredAt: input.validAt,
  });
  const recordEnvelope = StandardizedRiskRecordEnvelopeSchema.parse({
    riskRecordId: recordRef.reference.entityId,
    record: {
      processNodeId: "node-1",
      riskSource: `risk-source-${suffix}`,
      riskFactor: `risk-factor-${suffix}`,
      riskEvent: `risk-event-${suffix}`,
      riskElementRelations: [
        { sourceElement: "element-a", relation: "induces", targetElement: "element-b" },
      ],
      evidenceLocator: { sourceSegmentId: `segment-${suffix}-1` },
      modelConfidence: 0.8,
    },
    riskMechanismEntryIds: [`mechanism-${suffix}-1`],
    sourceIds: [`segment-${suffix}-1`, `segment-${suffix}-2`],
    compositeConfidence: { value: 0.7, basis: ["model-confidence"] },
    version: {
      reference: plainRef(recordRef.reference.entityId, "v1"),
      effectivePeriod: { validFrom: input.validAt },
      systemTime: { recordedAt: input.validAt },
    },
    audit: { actorId: ACTOR_ID, action: "identification.accept-groups", recordedAt: input.validAt },
  });
  {
    const command: AtomicCommandV1 = {
      projectId: PROJECT_ID,
      commandKind: "identification.accept-groups",
      commandId: `c33-fixture-record-${suffix}`,
      idempotencyKey: `c33-fixture-record-${suffix}`,
      payload: { fixture: "合成样本、待甲方复核", recordIds: [recordWrite.riskRecordId] },
      actorRef: ACTOR_ID,
      authorizationContextRef: refOf("authorization-context", "authorization-c33"),
      issuedAt: TIMESTAMP,
    };
    await fixture.transactionUnit.execute(command, async (context) => {
      const outcome = await fixture.finalizationAdapter.insertRecords(
        { rows: [recordWrite], records: [recordEnvelope], occurredAt: input.validAt },
        context,
      );
      if (outcome.kind !== "inserted") throw new TypeError("record seeding failed");
      return {
        resultRef: recordRef,
        audit: {
          auditEntryId: `c33-fixture-record-${suffix}:audit`,
          projectId: PROJECT_ID,
          action: command.commandKind,
          targetRef: recordRef,
          actorRef: ACTOR_ID,
          authorizationContextRef: command.authorizationContextRef,
          occurredAt: input.validAt,
          recordedAt: input.validAt,
          version: recordRef.reference,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
        },
        events: [],
      } satisfies AtomicCommitV1;
    });
  }

  // 候选集登记按生产顺序落在 run-state 之前：run-read 的精确版本快照只组合不晚于该
  // run-state 版本落库的登记事实，晚于它的登记不进入该版本读结果。
  const candidateSetRefs = (input.candidateSetVersions ?? []).map((requestDigest) =>
    candidateSetRefFor({
      projectId: PROJECT_ID,
      workItemEntityId: workItemRef.reference.entityId,
      requestDigest,
    }),
  );
  if (candidateSetRefs.length > 0) {
    const candidateArtifactRef = await putFinalizationBody(fixture, {
      artifactId: `c33-body-candidate-set-${suffix}`,
      purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
      body: candidateBody(workItemRef, inputSnapshotRef),
    });
    await registerCandidateSets(fixture, {
      candidateSetRefs,
      workItemRef,
      inputSnapshotRef,
      artifactRef: candidateArtifactRef,
      occurredAt: input.validAt,
      commandSuffix: suffix,
    });
  }

  const runStateArtifactRef = await putGraphBody(fixture, {
    artifactId: `c33-body-run-state-${suffix}`,
    emptySources: input.emptyFinalSources,
    body: runStateBody({
      runId,
      runVersionId,
      stage: "I9",
      status: "completed",
      workItemRef,
      extra: {
        completedWorkItemRefs: [workItemRef],
        pendingWorkItemRefs: [],
        acceptedRiskRecordRefs: [recordRef],
        pendingGroupRefs: [pendingGroupRef],
        rejectedGroupRefs: [rejectedGroupRef],
        acceptedRouteSetRef: routeSetRef,
        resultRef: refOf(
          "identification-run-result",
          `identification-run-result:${runId}`,
          sha(`run-result-${suffix}`),
        ),
      },
    }),
  });
  await registerGraphRows(
    fixture,
    [
      graphRowFor({
        kind: "work-plan",
        suffix: `${suffix}-plan`,
        runId,
        runVersionId,
        artifactRef: planArtifactRef,
        validAt: input.validAt,
        resultId: workPlanRef.reference.entityId,
        workPlanRef,
        inputSnapshotRef,
      }),
      ...stageRows,
      graphRowFor({
        kind: "run-state",
        suffix: `${suffix}-run-state`,
        emptySources: input.emptyFinalSources,
        runId,
        runVersionId,
        artifactRef: runStateArtifactRef,
        validAt: input.validAt,
        resultId: `result-run-state-${suffix}`,
      }),
    ],
    `c33-fixture-register-${suffix}`,
  );

  return {
    runRef,
    workItemRef,
    workPlanRef,
    agentTaskRef,
    reviewTaskRef,
    acceptedGroupRef,
    pendingGroupRef,
    rejectedGroupRef,
    recordRef,
    routeDecisionRef,
    reviewDecisionRef,
    routeSetRef,
    candidateSetRefs,
  };
};

interface DashboardRecordSpecV1 {
  readonly suffix: string;
  readonly processNodeId?: string;
  readonly spatialScope?: string;
  readonly sourceVersion?: string;
}

/** 仪表盘夹具：一次命令成批登记同一 occurredAt 的风险记录版本（与生产 insertRecords 同路径）。 */
const seedDashboardRecords = async (
  f: ReadTestFixture,
  occurredAt: string,
  specs: readonly DashboardRecordSpecV1[],
  commandSuffix: string,
): Promise<void> => {
  const rows = specs.map((spec) => {
    const recordId = `risk-record:${PROJECT_ID}:${spec.suffix}`;
    return StandardizedRiskRecordWriteV1Schema.parse({
      riskRecordId: recordId,
      versionId: "v1",
      riskRecordRef: refOf("standardized-risk-record", recordId, "v1"),
      rowId: `row-${spec.suffix}`,
      idempotencyKey: `identification.accept-groups:${spec.suffix}`,
      requestDigest: sha(`dashboard-record-request-${spec.suffix}`),
      projectId: PROJECT_ID,
      workPlanRef: refOf("identification-work-plan", "identification-work-plan:dashboard"),
      identificationRunRef: refOf(
        "workflow-run",
        `workflow-run:${PROJECT_ID}:dashboard`,
        sha("dashboard-run-version"),
      ),
      inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot-dashboard"),
      mergePlanRef: refOf("merge-plan", "merge-plan:dashboard"),
      routeDecisionRef: refOf("route-decision", `route-decision:${spec.suffix}`),
      groupId: "group-1",
      groupVersionId: sha(`group-version-${spec.suffix}`),
      groupRef: refOf(
        "identification-group",
        `identification-group:dashboard:${spec.suffix}`,
        sha(`group-${spec.suffix}`),
      ),
      representativeCandidateRefs: [
        refOf(
          "content-artifact",
          `candidate-artifact-${spec.suffix}`,
          `sha256:${sha(`candidate-${spec.suffix}`)}`,
        ),
      ],
      sourceSegmentIds: [`segment-${spec.suffix}`],
      mechanismEntryIds: [`mechanism-${spec.suffix}`],
      spatialScopeRefs: [refOf("spatial-scope", spec.spatialScope ?? "scope-c33")],
      sourceVersionRefs: [
        refOf("source-version", spec.sourceVersion ?? `source-version-${spec.suffix}`),
      ],
      evidenceReferences: [
        {
          locator: { sourceSegmentId: `segment-${spec.suffix}` },
          sourceVersion: {
            entityId: spec.sourceVersion ?? `source-version-${spec.suffix}`,
            versionId: "v1",
          },
        },
      ],
      authorizationScopeDigest: registrationScopeDigest,
      authorizationContextRef: refOf("authorization-context", "authorization-c33"),
      actorRef: ACTOR_ID,
      commandId: `c33-fixture-dashboard-${commandSuffix}`,
      occurredAt,
    });
  });
  const records = specs.map((spec) => {
    const recordId = `risk-record:${PROJECT_ID}:${spec.suffix}`;
    return StandardizedRiskRecordEnvelopeSchema.parse({
      riskRecordId: recordId,
      record: {
        processNodeId: spec.processNodeId ?? "node-dashboard",
        riskSource: `risk-source-${spec.suffix}`,
        riskFactor: `risk-factor-${spec.suffix}`,
        riskEvent: `risk-event-${spec.suffix}`,
        riskElementRelations: [
          { sourceElement: "element-a", relation: "induces", targetElement: "element-b" },
        ],
        evidenceLocator: { sourceSegmentId: `segment-${spec.suffix}` },
        modelConfidence: 0.6,
      },
      riskMechanismEntryIds: [`mechanism-${spec.suffix}`],
      sourceIds: [`segment-${spec.suffix}`],
      compositeConfidence: { value: 0.6, basis: ["model-confidence"] },
      version: {
        reference: plainRef(recordId, "v1"),
        effectivePeriod: { validFrom: occurredAt },
        systemTime: { recordedAt: occurredAt },
      },
      audit: {
        actorId: ACTOR_ID,
        action: "identification.accept-groups",
        recordedAt: occurredAt,
      },
    });
  });
  const head = rows[0];
  if (head === undefined) throw new TypeError("dashboard record seeding requires rows");
  const command: AtomicCommandV1 = {
    projectId: PROJECT_ID,
    commandKind: "identification.accept-groups",
    commandId: `c33-fixture-dashboard-${commandSuffix}`,
    idempotencyKey: `c33-fixture-dashboard-${commandSuffix}`,
    payload: {
      fixture: "合成样本、待甲方复核",
      recordIds: rows.map((row) => row.riskRecordId),
    },
    actorRef: ACTOR_ID,
    authorizationContextRef: refOf("authorization-context", "authorization-c33"),
    issuedAt: TIMESTAMP,
  };
  await f.transactionUnit.execute(command, async (context) => {
    const outcome = await f.finalizationAdapter.insertRecords(
      { rows, records, occurredAt },
      context,
    );
    if (outcome.kind !== "inserted") throw new TypeError("dashboard record seeding failed");
    return {
      resultRef: head.riskRecordRef,
      audit: {
        auditEntryId: `${command.commandId}:audit`,
        projectId: PROJECT_ID,
        action: command.commandKind,
        targetRef: head.riskRecordRef,
        actorRef: ACTOR_ID,
        authorizationContextRef: command.authorizationContextRef,
        occurredAt,
        recordedAt: occurredAt,
        version: head.riskRecordRef.reference,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
      },
      events: [],
    } satisfies AtomicCommitV1;
  });
};

/** 仪表盘来源请求：授权按 `risk-identification.record-catalog` 分支签发。 */
const dashboardRequest = (
  f: ReadTestFixture,
  options: {
    readonly pageSize?: number;
    readonly asOf?: string;
    readonly after?: RiskDashboardTimelineAfterV1;
    readonly spatialScopeRef?: SpatialScopeRefV1;
  } = {},
): RiskDashboardRiskRecordsSourceRequestV1 => {
  const queryId = `c33-dashboard-query-${++queryCount}`;
  const authorization = f.access.issue({
    invocationId: queryId,
    branch: "risk-identification.record-catalog",
    capability: "risk-identification.read",
  }).authorization;
  return RiskDashboardRiskRecordsSourceRequestV1Schema.parse({
    queryId,
    projectId: PROJECT_ID,
    actorId: authorization.actorId,
    requestedAt: TIMESTAMP,
    authorization,
    ...(options.spatialScopeRef === undefined ? {} : { spatialScopeRef: options.spatialScopeRef }),
    timeline: {
      asOf: options.asOf ?? "2034-12-31T00:00:00.000000Z",
      pageSize: options.pageSize ?? 5,
      ...(options.after === undefined ? {} : { after: options.after }),
    },
  });
};

/** 目录读全量（跨页）后按空间范围筛选：作为仪表盘统计的同口径 oracle。 */
const catalogItemsInScopes = async (
  f: ReadTestFixture,
  scopeEntityIds: readonly string[],
): Promise<RiskRecordCatalogItemV1[]> => {
  const items: RiskRecordCatalogItemV1[] = [];
  let cursor: string | undefined;
  do {
    const page = await f.reader.read(
      readQuery(f, "record-catalog", {
        pageSize: 50,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    );
    if (page.kind !== "succeeded") throw new TypeError("record-catalog page failed");
    items.push(...page.result.items);
    cursor = page.result.nextCursor;
  } while (cursor !== undefined);
  return items.filter((item) =>
    item.spatialScopeRefs.every((ref) => scopeEntityIds.includes(ref.reference.entityId)),
  );
};

const DENIED_SHAPE = {
  code: "AUTHORIZATION_DENIED",
  category: "authorization",
  retryable: false,
  stageCode: "risk-identification.read",
  requiredCapability: "risk-identification.read",
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
} as const;

describe.sequential("PostgreSQL risk identification read adapter (C33)", () => {
  let fixture: ReadTestFixture | undefined;

  beforeAll(async () => {
    fixture = await startReadFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close();
  });

  const requireFixture = (): ReadTestFixture => {
    if (fixture === undefined) throw new TypeError("fixture not started");
    return fixture;
  };

  it("run-list 返回有界分页条目，排序与游标稳定，不伪造触发原因", async () => {
    const f = requireFixture();
    const first = await seedBareRun(f, {
      suffix: "list-a",
      validAt: "2030-01-01T00:00:01.000Z",
      stage: "I9",
      status: "completed",
    });
    const second = await seedBareRun(f, {
      suffix: "list-b",
      validAt: "2030-01-01T00:00:02.000Z",
      stage: "I5",
      status: "running",
    });
    const third = await seedBareRun(f, {
      suffix: "list-c",
      validAt: "2030-01-01T00:00:03.000Z",
      stage: "I9",
      status: "completed",
    });

    const page1 = await f.reader.read(readQuery(f, "run-list", { pageSize: 2 }));
    if (page1.kind !== "succeeded") throw new TypeError("run-list first page failed");
    // 按启动时间倒序：list-c（最新）、list-b；第二页为 list-a。
    expect(page1.result.items.map((item) => item.runRef)).toEqual([third, second]);
    expect(page1.result.items[0]).toMatchObject({
      stage: "I9",
      status: "completed",
      startedBy: ACTOR_ID,
      startedAt: "2030-01-01T00:00:03.000Z",
      acceptedCount: 0,
      pendingReviewCount: 0,
      rejectedCount: 0,
    });
    expect("triggerReason" in (page1.result.items[0] as object)).toBe(false);
    expect(page1.result.nextCursor).toBe("offset-2");

    const page2 = await f.reader.read(
      readQuery(f, "run-list", { pageSize: 2, cursor: page1.result.nextCursor }),
    );
    if (page2.kind !== "succeeded") throw new TypeError("run-list second page failed");
    expect(page2.result.items.map((item) => item.runRef)).toEqual([first]);
    expect(page2.result.items[0]!.status).toBe("completed");
    expect(page2.result.nextCursor).toBeUndefined();

    // 状态筛选限当前扫描页，空页仍须可继续。
    const filtered1 = await f.reader.read(
      readQuery(f, "run-list", { pageSize: 1, status: "completed" }),
    );
    if (filtered1.kind !== "succeeded") throw new TypeError("run-list filtered page failed");
    expect(filtered1.result.items.map((item) => item.runRef)).toEqual([third]);
    expect(filtered1.result.nextCursor).toBe("offset-1");
    const filtered2 = await f.reader.read(
      readQuery(f, "run-list", { pageSize: 1, status: "completed", cursor: "offset-1" }),
    );
    if (filtered2.kind !== "succeeded") throw new TypeError("run-list filtered replay failed");
    expect(filtered2.result.items).toEqual([]);
    expect(filtered2.result.nextCursor).toBe("offset-2");
    const filtered3 = await f.reader.read(
      readQuery(f, "run-list", {
        pageSize: 1,
        status: "completed",
        cursor: "offset-2",
      }),
    );
    expect(filtered3).toMatchObject({ kind: "succeeded", result: { items: [{ runRef: first }] } });
  });

  it("run-read 返回阶段进度、覆盖、合并组与关联引用，并支持精确版本重放", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, {
      suffix: "detail",
      validAt: "2030-01-01T00:01:00.000Z",
    });

    const result = await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }));
    if (result.kind !== "succeeded") throw new TypeError("run-read failed");
    const detail = result.result;
    expect(detail.kind).toBe("run-read");
    expect(detail.runRef).toEqual(seeded.runRef);
    expect(detail.stage).toBe("I9");
    expect(detail.status).toBe("completed");
    expect(detail.stageEntries).toEqual([
      { stage: "I1", status: "completed" },
      { stage: "I3", status: "completed" },
      { stage: "I5", status: "completed" },
      { stage: "I7", status: "completed" },
      { stage: "I9", status: "completed" },
    ]);
    expect(detail.workItemCoverage).toEqual([
      { workItemRef: seeded.workItemRef, processNodeId: "node-1", status: "completed" },
    ]);
    expect(detail.mergeGroups).toEqual([
      {
        groupRef: seeded.acceptedGroupRef,
        status: "accepted",
        acceptanceKind: "automatic",
      },
      {
        groupRef: seeded.pendingGroupRef,
        status: "pending-review",
        acceptanceKind: "review",
      },
      { groupRef: seeded.rejectedGroupRef, status: "rejected" },
    ]);
    expect(detail.agentTaskRefs).toEqual([seeded.agentTaskRef]);
    expect(detail.reviewTaskRefs).toEqual([seeded.reviewTaskRef]);
    expect(detail.resultCounts).toEqual({
      plannedWorkItemCount: 1,
      completedWorkItemCount: 1,
      failedWorkItemCount: 0,
      zeroResultCount: 0,
      acceptedCount: 1,
      pendingReviewCount: 1,
      rejectedCount: 1,
    });
    expect(detail.acceptedRiskRecordRefs).toEqual([seeded.recordRef]);
    expect(detail.pendingReviewGroupRefs).toEqual([seeded.pendingGroupRef]);
    expect(detail.rejectedGroupRefs).toEqual([seeded.rejectedGroupRef]);
    expect(detail.waitingRef).toBeUndefined();

    // 精确版本重放：登记同一运行的更新版本后，旧版本读取仍逐字同形。
    const replay = await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }));
    expect(replay).toEqual(result);

    const newerVersionId = sha("run-version-detail-next");
    const newerArtifactRef = await putGraphBody(f, {
      artifactId: "c33-body-run-state-detail-next",
      body: runStateBody({
        runId: seeded.runRef.reference.entityId,
        runVersionId: newerVersionId,
        stage: "I9",
        status: "completed",
        workItemRef: seeded.workItemRef,
        extra: {
          completedWorkItemRefs: [seeded.workItemRef],
          pendingWorkItemRefs: [],
          acceptedRiskRecordRefs: [seeded.recordRef],
          pendingGroupRefs: [],
          rejectedGroupRefs: [seeded.rejectedGroupRef],
          acceptedRouteSetRef: seeded.routeSetRef,
        },
      }),
    });
    await registerGraphRows(
      f,
      [
        graphRowFor({
          kind: "run-state",
          suffix: "detail-run-state-next",
          runId: seeded.runRef.reference.entityId,
          runVersionId: newerVersionId,
          artifactRef: newerArtifactRef,
          validAt: "2030-01-01T00:02:00.000Z",
          resultId: "result-run-state-detail-next",
        }),
      ],
      "c33-fixture-register-detail-next",
    );
    const afterNewer = await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }));
    expect(afterNewer).toEqual(result);
    const newer = await f.reader.read(
      readQuery(f, "run-read", {
        runRef: refOf("workflow-run", seeded.runRef.reference.entityId, newerVersionId),
      }),
    );
    if (newer.kind !== "succeeded") throw new TypeError("newer version run-read failed");
    expect(newer.result.pendingReviewGroupRefs).toEqual([]);
    expect(newer.result.resultCounts.pendingReviewCount).toBe(0);
  });

  it("run-read 如实呈现等待复核与可重试失败，不把暂停或失败伪装为完成", async () => {
    const f = requireFixture();
    const waitingRunId = `workflow-run:${PROJECT_ID}:waiting`;
    const waitingVersionId = sha("run-version-waiting");
    const waitingRunRef = refOf("workflow-run", waitingRunId, waitingVersionId);
    const pendingGroupRef = groupRefFor(waitingRunId, "group-pending");
    const reviewTaskRef = reviewTaskRefFor("waiting", pendingGroupRef, waitingRunRef);
    await seedBareRun(f, {
      suffix: "waiting",
      validAt: "2030-01-01T00:03:00.000Z",
      stage: "I5",
      status: "waiting",
      extra: {
        pendingGroupRefs: [pendingGroupRef],
        lastWaitingRef: {
          kind: "human-review",
          reviewTaskRef,
          groupRef: pendingGroupRef,
        },
      },
    });
    const waiting = await f.reader.read(readQuery(f, "run-read", { runRef: waitingRunRef }));
    if (waiting.kind !== "succeeded") throw new TypeError("waiting run-read failed");
    expect(waiting.result.status).toBe("waiting");
    expect(waiting.result.stageEntries).toEqual([{ stage: "I5", status: "waiting" }]);
    expect(waiting.result.waitingRef).toEqual({ kind: "review", reviewTaskRef });
    expect(waiting.result.reviewTaskRefs).toEqual([reviewTaskRef]);
    expect(waiting.result.mergeGroups).toEqual([
      { groupRef: pendingGroupRef, status: "pending-review" },
    ]);
    expect(waiting.result.workItemCoverage).toEqual([]);

    const failedRunRef = await seedBareRun(f, {
      suffix: "failed",
      validAt: "2030-01-01T00:04:00.000Z",
      stage: "I3",
      status: "retryable-failure",
      extra: {
        lastErrorRef: refOf(
          "workflow-error",
          "identification-graph-workflow-error:I3:RETRYABLE_INFRASTRUCTURE_FAILURE",
          "v1",
        ),
      },
    });
    const failedRun = await f.reader.read(readQuery(f, "run-read", { runRef: failedRunRef }));
    if (failedRun.kind !== "succeeded") throw new TypeError("failed run-read failed");
    expect(failedRun.result.status).toBe("retryable-failure");
    expect(failedRun.result.stageEntries).toEqual([
      {
        stage: "I3",
        status: "retryable-failure",
        failureCode: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
      },
    ]);
  });

  it("record-catalog 返回有界分页条目并支持工序节点、验收方式与运行筛选", async () => {
    const f = requireFixture();
    // 三条记录：两条自动路线（node-1）、一条人工路线（node-2），created_at 依次递增。
    const seededRecords: {
      readonly ref: StandardizedRiskRecordRefV1;
      readonly processNodeId: string;
      readonly riskEvent: string;
      readonly acceptance: "automatic" | "review";
    }[] = [];
    const recordAt = [
      "2030-01-01T00:05:01.000Z",
      "2030-01-01T00:05:02.000Z",
      "2030-01-01T00:05:03.000Z",
    ];
    const specs = [
      { suffix: "catalog-1", processNodeId: "node-1", acceptance: "automatic" as const },
      { suffix: "catalog-2", processNodeId: "node-1", acceptance: "automatic" as const },
      { suffix: "catalog-3", processNodeId: "node-2", acceptance: "review" as const },
    ];
    for (const [index, spec] of specs.entries()) {
      const recordId = `risk-record:${PROJECT_ID}:${spec.suffix}`;
      const runRef = refOf(
        "workflow-run",
        `workflow-run:${PROJECT_ID}:catalog-run`,
        sha("catalog-run-version"),
      );
      const groupRef = groupRefFor(`catalog-${spec.suffix}`, "group-1");
      const decisionRef =
        spec.acceptance === "automatic"
          ? { routeDecisionRef: refOf("route-decision", `route-decision:${spec.suffix}`) }
          : { reviewDecisionRef: refOf("review-decision", `review-decision:${spec.suffix}`) };
      const write = StandardizedRiskRecordWriteV1Schema.parse({
        riskRecordId: recordId,
        versionId: "v1",
        riskRecordRef: refOf("standardized-risk-record", recordId, "v1"),
        rowId: `row-${spec.suffix}`,
        idempotencyKey: `identification.accept-groups:${spec.suffix}`,
        requestDigest: sha(`record-request-${spec.suffix}`),
        projectId: PROJECT_ID,
        workPlanRef: refOf("identification-work-plan", `identification-work-plan:catalog`),
        identificationRunRef: runRef,
        inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot-catalog"),
        mergePlanRef: refOf("merge-plan", `merge-plan:catalog`),
        ...decisionRef,
        groupId: "group-1",
        groupVersionId: groupRef.reference.versionId,
        groupRef,
        representativeCandidateRefs: [
          refOf(
            "content-artifact",
            `candidate-artifact-${spec.suffix}`,
            `sha256:${sha(`candidate-${spec.suffix}`)}`,
          ),
        ],
        sourceSegmentIds: [`segment-${spec.suffix}`],
        mechanismEntryIds: [`mechanism-${spec.suffix}`],
        spatialScopeRefs: [refOf("spatial-scope", `spatial-scope-${spec.suffix}`)],
        sourceVersionRefs: [refOf("source-version", `source-version-${spec.suffix}`)],
        evidenceReferences: [
          {
            locator: { sourceSegmentId: `segment-${spec.suffix}` },
            sourceVersion: { entityId: `source-version-${spec.suffix}`, versionId: "v1" },
          },
        ],
        authorizationScopeDigest: registrationScopeDigest,
        authorizationContextRef: refOf("authorization-context", "authorization-c33"),
        actorRef: ACTOR_ID,
        commandId: `c33-fixture-record-${spec.suffix}`,
        occurredAt: recordAt[index] as string,
      });
      const envelope = StandardizedRiskRecordEnvelopeSchema.parse({
        riskRecordId: recordId,
        record: {
          processNodeId: spec.processNodeId,
          riskSource: `risk-source-${spec.suffix}`,
          riskFactor: `risk-factor-${spec.suffix}`,
          riskEvent: `risk-event-${spec.suffix}`,
          riskElementRelations: [
            { sourceElement: "element-a", relation: "induces", targetElement: "element-b" },
          ],
          evidenceLocator: { sourceSegmentId: `segment-${spec.suffix}` },
          modelConfidence: 0.6,
        },
        riskMechanismEntryIds: [`mechanism-${spec.suffix}`],
        sourceIds: [`segment-${spec.suffix}`],
        compositeConfidence: { value: 0.6, basis: ["model-confidence"] },
        version: {
          reference: plainRef(recordId, "v1"),
          effectivePeriod: { validFrom: recordAt[index] as string },
          systemTime: { recordedAt: recordAt[index] as string },
        },
        audit: {
          actorId: ACTOR_ID,
          action: "identification.accept-groups",
          recordedAt: recordAt[index] as string,
        },
      });
      const command: AtomicCommandV1 = {
        projectId: PROJECT_ID,
        commandKind: "identification.accept-groups",
        commandId: `c33-fixture-record-${spec.suffix}`,
        idempotencyKey: `c33-fixture-record-${spec.suffix}`,
        payload: { fixture: "合成样本、待甲方复核", recordIds: [recordId] },
        actorRef: ACTOR_ID,
        authorizationContextRef: refOf("authorization-context", "authorization-c33"),
        issuedAt: TIMESTAMP,
      };
      await f.transactionUnit.execute(command, async (context) => {
        const outcome = await f.finalizationAdapter.insertRecords(
          { rows: [write], records: [envelope], occurredAt: recordAt[index] as string },
          context,
        );
        if (outcome.kind !== "inserted") throw new TypeError("record seeding failed");
        return {
          resultRef: write.riskRecordRef,
          audit: {
            auditEntryId: `c33-fixture-record-${spec.suffix}:audit`,
            projectId: PROJECT_ID,
            action: command.commandKind,
            targetRef: write.riskRecordRef,
            actorRef: ACTOR_ID,
            authorizationContextRef: command.authorizationContextRef,
            occurredAt: recordAt[index] as string,
            recordedAt: recordAt[index] as string,
            version: { entityId: recordId, versionId: "v1" },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
          },
          events: [],
        } satisfies AtomicCommitV1;
      });
      seededRecords.push({
        ref: refOf("standardized-risk-record", recordId, "v1"),
        processNodeId: spec.processNodeId,
        riskEvent: `risk-event-${spec.suffix}`,
        acceptance: spec.acceptance,
      });
    }
    const [record1, record2, record3] = seededRecords as [
      (typeof seededRecords)[number],
      (typeof seededRecords)[number],
      (typeof seededRecords)[number],
    ];

    const page1 = await f.reader.read(readQuery(f, "record-catalog", { pageSize: 2 }));
    if (page1.kind !== "succeeded") throw new TypeError("record-catalog first page failed");
    // 目录按登记时间倒序：最新记录在前；本工程此前播种的记录也按同一序排在后面页。
    expect(page1.result.items.map((item) => item.riskRecordRef)).toEqual([
      record3.ref,
      record2.ref,
    ]);
    expect(page1.result.items[0]).toMatchObject({
      processNodeId: "node-2",
      riskEventSummary: "risk-event-catalog-3",
      compositeConfidence: { value: 0.6, basis: ["model-confidence"] },
      acceptanceKind: "review",
    });
    expect("supersededBy" in (page1.result.items[0] as object)).toBe(false);
    expect(page1.result.nextCursor).toBe("offset-2");
    const page2 = await f.reader.read(
      readQuery(f, "record-catalog", { pageSize: 2, cursor: "offset-2" }),
    );
    if (page2.kind !== "succeeded") throw new TypeError("record-catalog second page failed");
    // 第二页之后是更早登记的 detail 运行记录（`seedCompletedRun`，登记于 00:01:00）。
    expect(page2.result.items.map((item) => item.riskRecordRef.reference.entityId)).toEqual([
      record1.ref.reference.entityId,
      `risk-record:workflow-run:${PROJECT_ID}:detail:record-1`,
    ]);
    expect(page2.result.nextCursor).toBeUndefined();

    const byNode = await f.reader.read(readQuery(f, "record-catalog", { processNodeId: "node-2" }));
    if (byNode.kind !== "succeeded") throw new TypeError("record-catalog node filter failed");
    expect(byNode.result.items.map((item) => item.riskRecordRef)).toEqual([record3.ref]);

    const byAcceptance = await f.reader.read(
      readQuery(f, "record-catalog", { acceptanceKind: "automatic" }),
    );
    if (byAcceptance.kind !== "succeeded") {
      throw new TypeError("record-catalog acceptance filter failed");
    }
    expect(byAcceptance.result.items.map((item) => item.riskRecordRef.reference.entityId)).toEqual([
      record2.ref.reference.entityId,
      record1.ref.reference.entityId,
      `risk-record:workflow-run:${PROJECT_ID}:detail:record-1`,
    ]);
    expect(byAcceptance.result.items.every((item) => item.acceptanceKind === "automatic")).toBe(
      true,
    );

    const byRun = await f.reader.read(
      readQuery(f, "record-catalog", {
        identificationRunRef: refOf(
          "workflow-run",
          `workflow-run:${PROJECT_ID}:catalog-run`,
          sha("catalog-run-version"),
        ),
      }),
    );
    if (byRun.kind !== "succeeded") throw new TypeError("record-catalog run filter failed");
    expect(byRun.result.items.map((item) => item.riskRecordRef.reference.entityId)).toEqual([
      record3.ref.reference.entityId,
      record2.ref.reference.entityId,
      record1.ref.reference.entityId,
    ]);
  });

  it("record-read 返回精确版本的识别侧正文与验收决定引用", async () => {
    const f = requireFixture();
    const recordRef = refOf(
      "standardized-risk-record",
      `risk-record:${PROJECT_ID}:catalog-3`,
      "v1",
    );
    const result = await f.reader.read(readQuery(f, "record-read", { riskRecordRef: recordRef }));
    if (result.kind !== "succeeded") throw new TypeError("record-read failed");
    const detail = result.result;
    expect(detail.kind).toBe("record-read");
    expect(detail.riskRecordRef).toEqual(recordRef);
    expect(detail.record).toMatchObject({
      processNodeId: "node-2",
      riskEvent: "risk-event-catalog-3",
      evidenceLocator: { sourceSegmentId: "segment-catalog-3" },
      modelConfidence: 0.6,
    });
    expect(detail.riskMechanismEntryIds).toEqual(["mechanism-catalog-3"]);
    expect(detail.sourceSegmentIds).toEqual(["segment-catalog-3"]);
    expect(detail.compositeConfidence).toEqual({ value: 0.6, basis: ["model-confidence"] });
    expect(detail.acceptanceDecisionRef).toEqual(
      refOf("review-decision", "review-decision:catalog-3"),
    );
    expect(detail.identificationRunRef).toEqual(
      refOf("workflow-run", `workflow-run:${PROJECT_ID}:catalog-run`, sha("catalog-run-version")),
    );
    expect(detail.supersededBy).toBeUndefined();
    expect(detail.auditTrailRef).toEqual({
      kind: "audit-trail",
      reference: { entityId: "c33-fixture-record-catalog-3:audit", versionId: "v1" },
    });

    // 重复读取同一精确版本逐字同形。
    const replay = await f.reader.read(readQuery(f, "record-read", { riskRecordRef: recordRef }));
    expect(replay).toEqual(result);
  });

  it("无权、跨工程、范围收窄、不存在与游标篡改同形失败且不可枚举", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, {
      suffix: "guarded",
      validAt: "2030-01-01T00:06:00.000Z",
    });

    const expectDenied = (result: Awaited<ReturnType<typeof f.reader.read>>): void => {
      if (result.kind !== "failed") throw new TypeError("expected a failed result");
      expect(result.error).toMatchObject(DENIED_SHAPE);
    };

    // 冻结上下文不持识别读能力：契约解析失败且呈伪造形状 → 同形授权失败。
    expectDenied(
      await f.reader.read({
        queryId: "c33-query-forged-capability",
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: refOf("authorization-context", "authorization-c33-forged"),
          actorId: ACTOR_ID,
          projectId: PROJECT_ID,
          grantedCapabilities: ["risk-identification.run"],
          spatialScopeRefs: [...SCOPES],
          sourceAccessGrantRefs: [...SOURCE_GRANTS],
          authorizationPolicyRef: plainRef("authorization-policy"),
          decidedAt: TIMESTAMP,
          invocation: { kind: "human" },
        }),
        kind: "run-list",
        payload: {},
      } as RiskIdentificationReadQueryV1),
    );

    // 冻结上下文指向其它工程 → 同形授权失败。
    expectDenied(
      await f.reader.read({
        queryId: "c33-query-forged-project",
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: f.access.issue({
          invocationId: "c33-query-forged-project",
          branch: "risk-identification.run-list",
          capability: "risk-identification.read",
          projectId: OTHER_PROJECT_ID,
        }).authorization,
        kind: "run-list",
        payload: {},
      } as RiskIdentificationReadQueryV1),
    );

    // 撤权后再次读取：列表、运行详情、记录详情同形失败。
    f.access.revoke();
    try {
      expectDenied(await f.reader.read(readQuery(f, "run-list", {})));
      expectDenied(await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef })));
      expectDenied(
        await f.reader.read(readQuery(f, "record-read", { riskRecordRef: seeded.recordRef })),
      );
    } finally {
      f.access.restore();
    }

    // 当前范围收窄（登记范围摘要不再对账）：列表为空页，精确读取同形失败。
    f.access.narrowScope();
    try {
      const narrowedList = await f.reader.read(readQuery(f, "run-list", {}));
      if (narrowedList.kind !== "succeeded") throw new TypeError("narrowed run-list failed");
      expect(narrowedList.result.items).toEqual([]);
      expectDenied(await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef })));
      expectDenied(
        await f.reader.read(readQuery(f, "record-read", { riskRecordRef: seeded.recordRef })),
      );
    } finally {
      f.access.restore();
    }

    // 不存在的运行、版本不符的记录与篡改游标：同形失败，不提供存在性线索。
    expectDenied(
      await f.reader.read(
        readQuery(f, "run-read", {
          runRef: refOf("workflow-run", `workflow-run:${PROJECT_ID}:absent`, "v1"),
        }),
      ),
    );
    expectDenied(
      await f.reader.read(
        readQuery(f, "run-read", {
          runRef: refOf(
            "workflow-run",
            seeded.runRef.reference.entityId,
            sha("run-version-guarded-absent"),
          ),
        }),
      ),
    );
    expectDenied(
      await f.reader.read(
        readQuery(f, "record-read", {
          riskRecordRef: refOf(
            "standardized-risk-record",
            seeded.recordRef.reference.entityId,
            "v-absent",
          ),
        }),
      ),
    );
    expectDenied(await f.reader.read(readQuery(f, "record-catalog", { cursor: "tampered" })));

    // 合法但无可见行的工程：列表为空页而非失败。
    const emptyList = await f.reader.read(
      readQuery(f, "run-list", {}, { projectId: OTHER_PROJECT_ID }),
    );
    if (emptyList.kind !== "succeeded") throw new TypeError("other project run-list failed");
    expect(emptyList.result.items).toEqual([]);
  });

  it("run-read 只转出本运行工作项下已登记的候选集引用，实体与身份版本逐字取自登记行", async () => {
    const f = requireFixture();
    // 同一工作项的修正登记是同一身份的新版本：原候选集与修正候选集都必须可选。
    const seeded = await seedCompletedRun(f, {
      suffix: "candidate",
      validAt: "2030-01-01T00:05:00.000Z",
      candidateSetVersions: [sha("candidate-set-original"), sha("candidate-set-revised")],
    });
    expect(seeded.candidateSetRefs).toHaveLength(2);
    expect(seeded.candidateSetRefs[0]?.reference.entityId).toBe(
      seeded.candidateSetRefs[1]?.reference.entityId,
    );
    // 属于另一个工作项的登记事实，不得混入本运行。
    const otherWorkItemRef = refOf("identification-work-item", "candidate-work-item-other");
    const foreignRef = candidateSetRefFor({
      projectId: PROJECT_ID,
      workItemEntityId: otherWorkItemRef.reference.entityId,
      requestDigest: sha("candidate-set-foreign"),
    });
    await registerCandidateSets(f, {
      candidateSetRefs: [foreignRef],
      workItemRef: otherWorkItemRef,
      inputSnapshotRef: refOf("identification-input-snapshot", "identification-input-snapshot:c33"),
      artifactRef: await putFinalizationBody(f, {
        artifactId: "c33-body-candidate-set-foreign",
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
        body: { fixture: "合成样本、待甲方复核" },
      }),
      occurredAt: "2030-01-01T00:05:00.000Z",
      commandSuffix: "foreign",
    });

    const result = await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }));
    if (result.kind !== "succeeded") throw new TypeError("run-read failed");
    // 本运行工作项下的原登记与修正登记都在集合内，实体与身份版本逐字等于登记行。
    expect(result.result.revisedCandidateRefs).toEqual(seeded.candidateSetRefs);
    expect(result.result.revisedCandidateRefs).not.toContainEqual(foreignRef);

    // 未登记候选集事实的运行不留空集合冒充「已登记且无候选」。
    const bare = await seedBareRun(f, {
      suffix: "candidate-bare",
      validAt: "2030-01-01T00:06:00.000Z",
      stage: "I3",
      status: "running",
    });
    const bareResult = await f.reader.read(readQuery(f, "run-read", { runRef: bare }));
    if (bareResult.kind !== "succeeded") throw new TypeError("bare run-read failed");
    expect(bareResult.result.revisedCandidateRefs).toBeUndefined();
  });

  it("run-read 候选集引用超出契约上界时整读失败，不截断冒充完整", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, {
      suffix: "candidate-overflow",
      validAt: "2030-01-01T00:07:00.000Z",
      candidateSetVersions: Array.from({ length: 257 }, (_, index) =>
        sha(`candidate-set-overflow-${index}`),
      ),
    });

    const result = await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }));
    if (result.kind !== "failed") throw new TypeError("overflow run-read should fail closed");
    expect(result.error.code).toBe("BUSINESS_BLOCKED");
    expect(result.error.blockerKind).toBe("run-read-reference-overflow");
  });

  it("D178 跨阶段来源变化与更宽当前授权下四读面仍保留完整事实", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, {
      suffix: "d178-cross-scope",
      validAt: "2030-01-02T00:00:00.000Z",
      emptyFinalSources: true,
    });
    const readAll = () =>
      Promise.all([
        f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef })),
        f.reader.read(readQuery(f, "run-list", { pageSize: 1 })),
        f.reader.read(readQuery(f, "record-read", { riskRecordRef: seeded.recordRef })),
        f.reader.read(readQuery(f, "record-catalog", { identificationRunRef: seeded.runRef })),
      ]);
    const original = await readAll();
    expect(original.every((result) => result.kind === "succeeded")).toBe(true);
    expect(original[0]).toMatchObject({
      kind: "succeeded",
      result: {
        stageEntries: expect.arrayContaining([{ stage: "I1", status: "completed" }]),
        resultCounts: { plannedWorkItemCount: 1 },
        workItemCoverage: [{ workItemRef: seeded.workItemRef }],
      },
    });
    expect(original[1]).toMatchObject({ result: { items: [{ runRef: seeded.runRef }] } });
    expect(original[3]).toMatchObject({ result: { items: [{ riskRecordRef: seeded.recordRef }] } });
    f.access.widenScope();
    try {
      expect(await readAll()).toEqual(original);
    } finally {
      f.access.restore();
    }
    // 终态本身无来源不能绕过工作计划所需资料的当前权限。
    f.access.denySource("source-version-c33");
    try {
      expect(
        await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef })),
      ).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
      expect(await f.reader.read(readQuery(f, "run-list", { pageSize: 1 }))).toMatchObject({
        kind: "succeeded",
        result: { items: [] },
      });
    } finally {
      f.access.restore();
    }
  });

  it("D178 不可见页不扫描后续运行或记录，游标按实际扫描位置继续", async () => {
    const f = requireFixture();
    const visible = await seedBareRun(f, {
      suffix: "d178-visible-page",
      validAt: "2030-02-01T00:00:01Z",
      stage: "I9",
      status: "completed",
      emptySources: true,
    });
    await seedBareRun(f, {
      suffix: "d178-hidden-page",
      validAt: "2030-02-01T00:00:02Z",
      stage: "I9",
      status: "completed",
    });
    f.access.denySource("source-version-c33");
    try {
      expect(await f.reader.read(readQuery(f, "run-list", { pageSize: 1 }))).toMatchObject({
        kind: "succeeded",
        result: { items: [], nextCursor: "offset-1" },
      });
      expect(
        await f.reader.read(readQuery(f, "run-list", { pageSize: 1, cursor: "offset-1" })),
      ).toMatchObject({ kind: "succeeded", result: { items: [{ runRef: visible }] } });
    } finally {
      f.access.restore();
    }
    const record = await seedCompletedRun(f, {
      suffix: "d178-hidden-record",
      validAt: "2030-02-01T00:00:03Z",
    });
    f.access.denySource("source-version-d178-hidden-record");
    try {
      expect(await f.reader.read(readQuery(f, "record-catalog", { pageSize: 1 }))).toMatchObject({
        kind: "succeeded",
        result: { items: [], nextCursor: "offset-1" },
      });
      const next = await f.reader.read(
        readQuery(f, "record-catalog", { pageSize: 1, cursor: "offset-1" }),
      );
      expect(next).toMatchObject({
        kind: "succeeded",
        result: { items: [{ riskRecordRef: expect.any(Object) }] },
      });
      expect(
        await f.reader.read(readQuery(f, "record-read", { riskRecordRef: record.recordRef })),
      ).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
    } finally {
      f.access.restore();
    }
  });

  it("D178 历史状态不混入之后登记的候选，候选正文必须经C04完整读取", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, {
      suffix: "d178-candidate-bound",
      validAt: TIMESTAMP,
      candidateSetVersions: [sha("d178-original")],
    });
    const original = await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }));
    expect(original).toMatchObject({
      kind: "succeeded",
      result: { revisedCandidateRefs: seeded.candidateSetRefs },
    });
    const inputRef = refOf(
      "identification-input-snapshot",
      `identification-input-snapshot:${seeded.runRef.reference.entityId}`,
      sha("input-snapshot-request-d178-candidate-bound"),
    );
    const futureRefs = Array.from({ length: 257 }, (_, i) =>
      candidateSetRefFor({
        projectId: PROJECT_ID,
        workItemEntityId: seeded.workItemRef.reference.entityId,
        requestDigest: sha(`d178-future-${i}`),
      }),
    );
    await registerCandidateSets(f, {
      candidateSetRefs: futureRefs,
      workItemRef: seeded.workItemRef,
      inputSnapshotRef: inputRef,
      artifactRef: await putFinalizationBody(f, {
        artifactId: "d178-future-candidates",
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
        body: candidateBody(seeded.workItemRef, inputRef),
      }),
      occurredAt: TIMESTAMP,
      commandSuffix: "d178-future",
    });
    expect(await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }))).toEqual(
      original,
    );
    const reader = new PostgresRiskIdentificationReadAdapter({
      db: f.runtime.db,
      authorization: f.access.port,
      artifactStore: {
        ...f.artifactStore,
        open: async (request) => {
          if (request.purposeCode === RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet)
            throw new Error("candidate unavailable");
          return f.artifactStore.open(request);
        },
      },
      now: () => new Date(TIMESTAMP),
    });
    expect(await reader.read(readQuery(f, "run-read", { runRef: seeded.runRef }))).toMatchObject({
      kind: "failed",
      error: DENIED_SHAPE,
    });
  });

  it("D178 缺登记资源和缺记录来源元数据同形拒绝", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, { suffix: "d178-missing", validAt: TIMESTAMP });
    f.access.hideResource("authorization-c33");
    try {
      expect(
        await f.reader.read(readQuery(f, "run-read", { runRef: seeded.runRef })),
      ).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
    } finally {
      f.access.restore();
    }
    await f.postgres.adminPool.query(
      "UPDATE business.standardized_risk_records SET source_version_refs = NULL WHERE risk_record_id = $1",
      [seeded.recordRef.reference.entityId],
    );
    expect(
      await f.reader.read(readQuery(f, "record-read", { riskRecordRef: seeded.recordRef })),
    ).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
    expect(
      await f.reader.read(readQuery(f, "record-catalog", { identificationRunRef: seeded.runRef })),
    ).toMatchObject({ kind: "succeeded", result: { items: [] } });
  });

  it("D178 真实C06空来源深链检查记录及证据来源，撤权/异空间/错版本均拒绝", async () => {
    const f = requireFixture();
    const seeded = await seedCompletedRun(f, { suffix: "d178-real-access", validAt: TIMESTAMP });
    await bootstrapInitialSystemAdministrator({
      connection: f.postgres.migrator,
      loginName: "d178admin",
      displayName: "合成管理员",
      password: "d178-admin-initial",
      accountId: "d178-admin",
      now: () => new Date(TIMESTAMP),
    });
    const access = createPostgresLocalIdentityAccess({
      ...f.postgres.app,
      hmacKey: new Uint8Array(32).fill(7),
      keyVersion: "v1",
      now: () => new Date(TIMESTAMP),
    });
    try {
      const initial = await access.login({
        kind: "login",
        loginAttemptId: "d178-admin-login",
        loginName: "d178admin",
        password: "d178-admin-initial",
      });
      const admin = await access.changePassword({
        kind: "change-password",
        sessionToken: initial.sessionToken,
        newPassword: "d178-admin-changed",
      });
      const manager = await access.administerIdentity({
        kind: "create-account",
        commandId: "d178-create-manager",
        idempotencyKey: "d178-create-manager",
        expectedVersion: "none",
        authorizationContextRef: admin.systemAdministrationContextRef!,
        loginName: "d178manager",
        displayName: "合成验收用户",
        password: "d178-manager-initial",
      });
      await access.administerProject({
        kind: "open-project",
        projectId: PROJECT_ID,
        commandId: "d178-open-project",
        idempotencyKey: "d178-open-project",
        expectedVersion: "none",
        authorizationContextRef: admin.systemAdministrationContextRef!,
        initialRiskManagerAccountId: manager.resultRef.entityId,
        includeAdministrator: true,
      });
      const login = await access.login({
        kind: "login",
        loginAttemptId: "d178-manager-login",
        loginName: "d178manager",
        password: "d178-manager-initial",
      });
      const current = await access.changePassword({
        kind: "change-password",
        sessionToken: login.sessionToken,
        newPassword: "d178-manager-changed",
      });
      const registration = await access.authorize({
        invocation: { kind: "human-session", sessionToken: current.sessionToken },
        invocationId: "d178-register-source",
        projectId: PROJECT_ID,
        branch: "engineering-data.register-source-delivery",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      const sources = [
        refOf("source-version", "d178-engineering-source"),
        refOf("source-version", "d178-evidence-source"),
      ];
      const scopes = registration.context.spatialScopeRefs;
      const policies = [];
      for (const [i, source] of sources.entries()) {
        policies.push(
          await access.administerProject({
            kind: "revise-source-access",
            projectId: PROJECT_ID,
            commandId: `d178-source-${i}`,
            idempotencyKey: `d178-source-${i}`,
            expectedVersion: "none",
            authorizationContextRef: registration.contextRef,
            sourceVersionRef: source,
            visibility: "restricted",
            allowedAccountIds: [manager.resultRef.entityId],
            spatialScopeRefs: scopes,
            registeredByAccountId: manager.resultRef.entityId,
          }),
        );
      }
      const setMetadata = (spatial: readonly SpatialScopeRefV1[], source = sources[0]!) =>
        f.postgres.adminPool.query(
          "UPDATE business.standardized_risk_records SET spatial_scope_refs=$2::jsonb, source_version_refs=$3::jsonb, evidence_references=$4::jsonb WHERE risk_record_id=$1",
          [
            seeded.recordRef.reference.entityId,
            JSON.stringify(spatial),
            JSON.stringify([source]),
            JSON.stringify([
              {
                sourceVersion: sources[1]!.reference,
                locator: { sourceSegmentId: "d178-evidence" },
              },
            ]),
          ],
        );
      await setMetadata(scopes);
      const reader = new PostgresRiskIdentificationReadAdapter({
        db: f.runtime.db,
        artifactStore: f.artifactStore,
        authorization: access,
        now: () => new Date(TIMESTAMP),
      });
      const read = async (kind: "record-read" | "record-catalog") => {
        const queryId = `d178-real-query-${++queryCount}`;
        const decision = await access.authorize({
          invocation: { kind: "human-session", sessionToken: current.sessionToken },
          invocationId: queryId,
          projectId: PROJECT_ID,
          branch: READ_BRANCH_FOR[kind],
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        expect(decision.context.sourceAccessGrantRefs).toEqual([]);
        return reader.read(
          RiskIdentificationReadQueryV1Schema.parse({
            queryId,
            projectId: PROJECT_ID,
            actorId: manager.resultRef.entityId,
            requestedAt: TIMESTAMP,
            authorization: decision.context,
            kind,
            payload:
              kind === "record-read"
                ? { riskRecordRef: seeded.recordRef }
                : { identificationRunRef: seeded.runRef },
          }),
        );
      };
      expect(await read("record-read")).toMatchObject({
        kind: "succeeded",
        result: { riskRecordRef: seeded.recordRef },
      });
      expect(await read("record-catalog")).toMatchObject({
        kind: "succeeded",
        result: { items: [{ riskRecordRef: seeded.recordRef }] },
      });
      await setMetadata([refOf("spatial-scope", "d178-foreign-space")]);
      expect(await read("record-read")).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
      await setMetadata(
        scopes,
        refOf("source-version", sources[0]!.reference.entityId, "wrong-version"),
      );
      expect(await read("record-read")).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
      await setMetadata(scopes);
      await access.administerProject({
        kind: "revise-source-access",
        projectId: PROJECT_ID,
        commandId: "d178-revoke-evidence",
        idempotencyKey: "d178-revoke-evidence",
        expectedVersion: policies[1]!.resultRef,
        authorizationContextRef: registration.contextRef,
        sourceVersionRef: sources[1]!,
        visibility: "restricted",
        allowedAccountIds: [],
        spatialScopeRefs: scopes,
        registeredByAccountId: "d178-admin",
      });
      expect(await read("record-read")).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
      expect(await read("record-catalog")).toMatchObject({
        kind: "succeeded",
        result: { items: [] },
      });
    } finally {
      await access.close();
    }
  });

  it("readDashboard 与 record-catalog 同口径完整计数并按工序分组", async () => {
    const f = requireFixture();
    const specs: DashboardRecordSpecV1[] = [
      ...Array.from({ length: 45 }, (_, index) => ({
        suffix: `dash-a-${index}`,
        processNodeId: "node-dash-a",
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        suffix: `dash-b-${index}`,
        processNodeId: "node-dash-b",
      })),
      // 当前授权看不到的空间：不计入统计，也不影响其它记录。
      {
        suffix: "dash-other-space",
        processNodeId: "node-dash-hidden",
        spatialScope: "spatial-scope-other",
      },
    ];
    await seedDashboardRecords(f, "2033-01-01T00:00:00.123456Z", specs, "dashboard-a");

    const expected = await catalogItemsInScopes(f, ["scope-c33"]);
    // 目录需要翻页两次（50/页）才算完整：只取第一页会少算。
    expect(expected.length).toBeGreaterThan(50);
    const expectedGroups: Record<string, number> = {};
    for (const item of expected) {
      expectedGroups[item.processNodeId] = (expectedGroups[item.processNodeId] ?? 0) + 1;
    }

    const result = await f.reader.readDashboard(dashboardRequest(f, { pageSize: 1 }));
    if (result.kind !== "ready") throw new TypeError("dashboard read failed");
    expect(result.data.recordedVersionCount).toBe(expected.length);
    expect(
      Object.fromEntries(
        result.data.processCounts.map((entry) => [entry.processNodeId, entry.count]),
      ),
    ).toEqual(expectedGroups);
    expect(result.events).toHaveLength(2);
    expect(result.events.every((event) => event.source === "riskRecords")).toBe(true);
    expect(result.asOf).toBe(TIMESTAMP);
  });

  it("readDashboard 变化页按登记时间倒序、同刻按主体升序，续页不重不漏且遵守 asOf", async () => {
    const f = requireFixture();
    await seedDashboardRecords(
      f,
      "2033-02-01T00:00:01.123456Z",
      [{ suffix: "dash-t1", processNodeId: "node-dash-timeline" }],
      "dashboard-t1",
    );
    await seedDashboardRecords(
      f,
      "2033-02-01T00:00:02.000001Z",
      [
        { suffix: "dash-t2", processNodeId: "node-dash-timeline" },
        { suffix: "dash-t3", processNodeId: "node-dash-timeline" },
      ],
      "dashboard-t23",
    );
    await seedDashboardRecords(
      f,
      "2033-02-01T00:00:03.500000Z",
      [{ suffix: "dash-t4", processNodeId: "node-dash-timeline" }],
      "dashboard-t4",
    );
    // asOf 之后登记的记录不得出现在变化页。
    await seedDashboardRecords(
      f,
      "2033-02-02T00:00:00.000000Z",
      [{ suffix: "dash-future", processNodeId: "node-dash-timeline" }],
      "dashboard-future",
    );
    const asOf = "2033-02-01T23:59:59.999999Z";
    const expected = (await catalogItemsInScopes(f, ["scope-c33"]))
      .filter((item) => !item.riskRecordRef.reference.entityId.endsWith("dash-future"))
      .map((item) => item.riskRecordRef.reference);

    const collected: RiskDashboardTimelineEventV1[] = [];
    let after: RiskDashboardTimelineAfterV1 | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = await f.reader.readDashboard(
        dashboardRequest(f, {
          pageSize: 7,
          asOf,
          ...(after === undefined ? {} : { after }),
        }),
      );
      if (result.kind !== "ready") throw new TypeError("dashboard timeline read failed");
      expect(result.events.length).toBeLessThanOrEqual(8);
      collected.push(...result.events.slice(0, 7));
      if (result.events.length <= 7) break;
      const last = result.events[6];
      if (last === undefined) throw new TypeError("dashboard timeline page missing position");
      after = {
        recordedAt: last.recordedAt,
        source: "riskRecords",
        entityId: last.subjectRef.reference.entityId,
        versionId: last.subjectRef.reference.versionId,
      };
    }

    expect(collected.map((event) => event.subjectRef.reference)).toEqual(expected);
    expect(
      new Set(
        collected.map(
          (event) =>
            `${event.subjectRef.reference.entityId}@${event.subjectRef.reference.versionId}`,
        ),
      ).size,
    ).toBe(collected.length);
    expect(
      collected.some((event) => event.subjectRef.reference.entityId.endsWith("dash-future")),
    ).toBe(false);
    expect(collected[0]?.recordedAt).toBe("2033-02-01T00:00:03.500000Z");
    expect(
      collected.find((event) => event.subjectRef.reference.entityId.endsWith("dash-t1"))
        ?.recordedAt,
    ).toBe("2033-02-01T00:00:01.123456Z");
    expect(
      collected.every((event) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(event.recordedAt),
      ),
    ).toBe(true);
    // 同刻按主体标识升序：dash-t2 在 dash-t3 之前。
    expect(
      collected
        .filter((event) => event.recordedAt === "2033-02-01T00:00:02.000001Z")
        .map((event) => event.subjectRef.reference.entityId.split(":").at(-1)),
    ).toEqual(["dash-t2", "dash-t3"]);

    // 全局位置折算：位置来源在本来源之前（assessments）时同刻仍计入，之后（warnings）时越过。
    const atOrBefore = await f.reader.readDashboard(
      dashboardRequest(f, {
        pageSize: 7,
        asOf,
        after: {
          recordedAt: "2033-02-01T00:00:02.000001Z",
          source: "assessments",
          entityId: "assessment-position",
          versionId: "v1",
        },
      }),
    );
    if (atOrBefore.kind !== "ready") throw new TypeError("dashboard at-or-before failed");
    expect(atOrBefore.events[0]?.recordedAt).toBe("2033-02-01T00:00:02.000001Z");
    const before = await f.reader.readDashboard(
      dashboardRequest(f, {
        pageSize: 7,
        asOf,
        after: {
          recordedAt: "2033-02-01T00:00:02.000001Z",
          source: "warnings",
          entityId: "warning-position",
          versionId: "v1",
        },
      }),
    );
    if (before.kind !== "ready") throw new TypeError("dashboard before failed");
    expect(before.events[0]?.recordedAt).toBe("2033-02-01T00:00:01.123456Z");
  });

  it("readDashboard 来源不可见时整来源失败且不吞成零，恢复后与目录同口径", async () => {
    const f = requireFixture();
    const baseline = await f.reader.readDashboard(dashboardRequest(f));
    if (baseline.kind !== "ready") throw new TypeError("dashboard baseline failed");

    f.access.denyVisibleSources();
    try {
      expect(await f.reader.readDashboard(dashboardRequest(f))).toMatchObject({
        kind: "failed",
        error: DENIED_SHAPE,
      });
      // 同一工程其它读面不受该来源失败影响。
      expect(await f.reader.read(readQuery(f, "record-catalog", { pageSize: 1 }))).toMatchObject({
        kind: "succeeded",
      });
    } finally {
      f.access.restore();
    }

    // 单条记录来源不可见：批验返回子集，该版本不计入，但不使整个来源失败。
    f.access.denySource("source-version-dash-a-0");
    try {
      const filtered = await f.reader.readDashboard(dashboardRequest(f));
      if (filtered.kind !== "ready") throw new TypeError("dashboard filtered failed");
      expect(filtered.data.recordedVersionCount).toBe(baseline.data.recordedVersionCount - 1);
      expect(await f.reader.readDashboard(dashboardRequest(f))).toEqual(filtered);
    } finally {
      f.access.restore();
    }

    // 当前空间不在现行授权内：不返回其它空间统计。
    expect(
      await f.reader.readDashboard(
        dashboardRequest(f, { spatialScopeRef: refOf("spatial-scope", "spatial-scope-other") }),
      ),
    ).toMatchObject({ kind: "failed", error: DENIED_SHAPE });
  });

  /**
   * 规模证据（implementation-plan V-02）：100 与 1000 条可见记录下的真实读取表现。
   * 只记录真实耗时与读取边界，不设未经批准的延迟阈值。
   */
  it("readDashboard 在 100 与 1000 条规模下计数准确、事件有界且耗时可观测", async () => {
    const f = requireFixture();
    for (const size of [100, 1000]) {
      await seedDashboardRecords(
        f,
        "2033-06-01T00:00:00.000000Z",
        Array.from({ length: size }, (_, index) => ({
          suffix: `dash-scale-${size}-${index}`,
          processNodeId: `node-dash-scale-${index % 8}`,
          // 规模场景共用一份资料来源：可见来源集合必须与记录条数解耦。
          sourceVersion: "source-version-dash-scale",
        })),
        `dashboard-scale-${size}`,
      );
      const before = Date.now();
      const result = await f.reader.readDashboard(dashboardRequest(f, { pageSize: 50 }));
      const durationMs = Date.now() - before;
      if (result.kind !== "ready") throw new TypeError("dashboard scale read failed");
      // 计数等于同筛选下的完整可见集合，不受目录页大小影响。
      const expected = await catalogItemsInScopes(f, ["scope-c33"]);
      expect(result.data.recordedVersionCount).toBe(expected.length);
      expect(result.data.recordedVersionCount).toBeGreaterThanOrEqual(size);
      // 事件页有界：最多 pageSize+1 条候选。
      expect(result.events.length).toBeLessThanOrEqual(51);
      // 工序分组有界：不超过受控分组上限。
      expect(result.data.processCounts.length).toBeLessThanOrEqual(256);
      // 授权元数据批量有界：可见来源集合不随记录条数线性增长。
      console.info(
        `[dashboard-scale] size=${size} durationMs=${durationMs} visibleRecords=${result.data.recordedVersionCount} events=${result.events.length} processGroups=${result.data.processCounts.length}`,
      );
    }
  });

  it("readDashboard 工序号缺失的版本计入总数但不进入工序分组", async () => {
    const f = requireFixture();
    const before = await f.reader.readDashboard(dashboardRequest(f));
    if (before.kind !== "ready") throw new TypeError("dashboard before missing-process failed");
    await seedDashboardRecords(
      f,
      "2033-03-01T00:00:00.000000Z",
      [{ suffix: "dash-missing-process", processNodeId: "node-dash-missing" }],
      "dashboard-missing",
    );
    await f.postgres.adminPool.query(
      "UPDATE business.standardized_risk_records SET payload = payload #- '{record,processNodeId}' WHERE risk_record_id = $1",
      [`risk-record:${PROJECT_ID}:dash-missing-process`],
    );
    const after = await f.reader.readDashboard(dashboardRequest(f));
    if (after.kind !== "ready") throw new TypeError("dashboard after missing-process failed");
    expect(after.data.recordedVersionCount).toBe(before.data.recordedVersionCount + 1);
    expect(after.data.processCounts).toEqual(before.data.processCounts);
  });

  it("readDashboard 工序分组超界时整来源失败而不是截断", async () => {
    const f = requireFixture();
    await seedDashboardRecords(
      f,
      "2033-04-01T00:00:00.000000Z",
      Array.from({ length: 257 }, (_, index) => ({
        suffix: `dash-group-${index}`,
        processNodeId: `node-dash-group-${index}`,
        sourceVersion: "source-version-dash-group-shared",
      })),
      "dashboard-groups",
    );
    expect(await f.reader.readDashboard(dashboardRequest(f))).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "dashboard-group-limit" },
    });
  });

  it("readDashboard 来源集合超界时整来源失败", async () => {
    const f = requireFixture();
    await seedDashboardRecords(
      f,
      "2033-05-01T00:00:00.000000Z",
      Array.from({ length: 257 }, (_, index) => ({
        suffix: `dash-source-${index}`,
        processNodeId: "node-dash-source",
      })),
      "dashboard-sources",
    );
    expect(await f.reader.readDashboard(dashboardRequest(f))).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "dashboard-source-limit" },
    });
  });
});
