/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 */
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactRefV1, ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphResultRowV1Schema,
  IdentificationGraphRunResultV1Schema,
  IdentificationGraphRunStateV1Schema,
  IdentificationGraphWorkPlanBodyV1Schema,
  type IdentificationGraphResultKindV1,
  type IdentificationGraphResultRowV1,
  type IdentificationGraphWorkPlanBodyV1,
} from "@riskflow/core/identification/graph";
import type {
  AtomicCommandV1,
  AtomicCommitReceiptV1,
  AtomicCommitV1,
} from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationGraphStateV1Schema,
  IdentificationInputSnapshotV1Schema,
  type IdentificationGraphStateV1,
  type IdentificationInputSnapshotV1,
} from "@riskflow/contracts/workflows";

import { createFilesystemArtifactStore } from "../../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../../src/artifacts/postgres-artifact-registry.js";
import {
  createPostgresIdentificationGraphAdapter,
  identificationGraphReadInvocationIdV1,
  type PostgresIdentificationGraphAdapterV1,
  type PostgresIdentificationGraphRegistrationOutcomeV1,
} from "../../../src/identification/graph/index.js";
import { runPostgresMigrations } from "../../../src/postgres/migrations/run.js";
import * as identificationGraphMigration from "../../../src/postgres/migrations/risk-identification/deliver-identification-graph/000043_identification_graph.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../../src/postgres/transaction-unit.js";
import { artifactPolicy } from "../../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../../postgres/fixture.js";

const PROJECT_ID = "project-c24";
const OTHER_PROJECT_ID = "project-c24-other";
const ACTOR_ID = "actor-c24";
const RUN_ID = `workflow-run:${PROJECT_ID}`;
const OTHER_RUN_ID = `workflow-run:${PROJECT_ID}:other`;
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const OTHER_TIMESTAMP = "2030-01-01T00:00:01.000Z";
const encoder = new TextEncoder();
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const RUN_VERSION_ID = sha("run-version");
const SCOPES = [{ kind: "spatial-scope", reference: { entityId: "scope-c24", versionId: "v1" } }];
const SOURCE_GRANTS = [
  { kind: "source-access-grant", reference: { entityId: "source-grant-c24", versionId: "v1" } },
];

const plainRef = (entityId: string, versionId = "v1") => ({ entityId, versionId });
const refOf = <const T extends string>(kind: T, entityId: string, versionId = "v1") =>
  ({ kind, reference: { entityId, versionId } }) as const;

const registrationScopeDigest = authorizationScopeDigest(
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: refOf("authorization-context", "authorization-c24"),
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: ["risk-identification.run"],
    spatialScopeRefs: SCOPES,
    sourceAccessGrantRefs: SOURCE_GRANTS,
    authorizationPolicyRef: plainRef("authorization-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  }),
);

const PREPARATION_SNAPSHOT_REF = refOf(
  "identification-preparation-snapshot",
  `identification-preparation-snapshot:${PROJECT_ID}`,
);
const RUN_REF = refOf("workflow-run", RUN_ID, RUN_VERSION_ID);
const PARENT_RUN_REF = refOf("workflow-run", `risk-flow-run:${PROJECT_ID}`, sha("parent-version"));
const AUDIT_TRAIL_REF = refOf("audit-trail", `audit-trail:${PROJECT_ID}`);
const WORKFLOW_ERROR_REF = refOf(
  "workflow-error",
  `workflow-error:${PROJECT_ID}`,
  sha("workflow-error-request"),
);
const WAITING_REF = {
  kind: "knowledge-preparation",
  knowledgePreparationTaskRef: refOf(
    "knowledge-preparation-task",
    `knowledge-preparation-task:${PROJECT_ID}`,
  ),
} as const;

/** 每例自带的精确引用组：不同用例不共用主键，避免相互掩盖登记冲突。 */
const referenceKitFor = (suffix: string) => ({
  suffix,
  workPlanRef: refOf(
    "identification-work-plan",
    `identification-work-plan:${PROJECT_ID}`,
    sha(`work-plan-request-${suffix}`),
  ),
  inputSnapshotRef: refOf(
    "identification-input-snapshot",
    `identification-input-snapshot:${PROJECT_ID}`,
    sha(`input-snapshot-request-${suffix}`),
  ),
  workItemRef: refOf(
    "identification-work-item",
    `identification-work-item:${PROJECT_ID}:node-1`,
    sha(`work-item-request-${suffix}`),
  ),
  absentWorkItemRef: refOf(
    "identification-work-item",
    `identification-work-item:${PROJECT_ID}:node-absent`,
    sha(`work-item-request-absent-${suffix}`),
  ),
  stageResultRef: refOf(
    "stage-result",
    `stage-result:${PROJECT_ID}:I5`,
    sha(`stage-result-request-${suffix}`),
  ),
  runResultRef: refOf(
    "identification-run-result",
    `identification-run-result:${PROJECT_ID}`,
    sha(`run-result-request-${suffix}`),
  ),
  validatedCandidateSetRef: refOf(
    "validated-candidate-set",
    `validated-candidate-set:${PROJECT_ID}:node-1`,
    sha(`validated-candidate-set-request-${suffix}`),
  ),
});

type ReferenceKitV1 = ReturnType<typeof referenceKitFor>;

const inputSnapshot = (): IdentificationInputSnapshotV1 =>
  IdentificationInputSnapshotV1Schema.parse({
    schemaVersion: "1",
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    processModelReleaseRef: refOf("process-model-release", "process-model-c24"),
    riskMechanismReleaseRef: refOf("risk-mechanism-release", "risk-mechanism-c24"),
    retrievalEvidenceBaseReleaseRef: refOf(
      "retrieval-evidence-base-release",
      "retrieval-evidence-base-c24",
    ),
    identificationPolicySetRef: refOf("identification-policy-set", "identification-policy-set-c24"),
    retrievalPolicyRef: plainRef("policy-retrieval"),
    retrievalReviewAgentPolicyRef: plainRef("policy-retrieval-review-agent"),
    repairPolicyRef: plainRef("policy-repair"),
    confidencePolicyRef: plainRef("policy-confidence"),
    forcedReviewPolicyRef: plainRef("policy-forced-review"),
    retryPolicyRef: plainRef("policy-retry"),
    modelDeploymentRef: plainRef("model-deployment"),
    promptTemplateRef: plainRef("prompt-template"),
    authorizationContextRef: refOf("authorization-context", "authorization-c24"),
    auditTrailRef: AUDIT_TRAIL_REF,
    createdBy: ACTOR_ID,
    createdAt: TIMESTAMP,
  });

const FROZEN_QUERY_TEXT = "node-1 冻结查询依据";
const WORK_ITEM_SOURCE_VERSION_REF = refOf("source-version", "source-version-c24");

const workPlanBody = (kit: ReferenceKitV1): IdentificationGraphWorkPlanBodyV1 =>
  IdentificationGraphWorkPlanBodyV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    workPlanRef: kit.workPlanRef,
    inputSnapshotRef: kit.inputSnapshotRef,
    inputSnapshot: inputSnapshot(),
    workItems: [
      {
        schemaVersion: "1",
        workItemRef: kit.workItemRef,
        nodeId: "node-1",
        spatialScopeRefs: [...SCOPES],
        sourceVersionRefs: [WORK_ITEM_SOURCE_VERSION_REF],
        sourceSegmentSetRefs: [refOf("source-segment-set", "source-segment-set-c24")],
        frozenQueryText: FROZEN_QUERY_TEXT,
      },
    ],
    excludedWorkItems: [],
  });

const stageResultI5Body = (kit: ReferenceKitV1) => ({
  bodyKind: "stage-result" as const,
  stageResult: {
    schemaVersion: "1" as const,
    runRef: RUN_REF,
    recordedAt: TIMESTAMP,
    stage: "I5" as const,
    validatedCandidateSetRef: kit.validatedCandidateSetRef,
    reviewTaskRefs: [],
  },
});

const runStateBody = (input: {
  readonly runVersionId: string;
  readonly stage: "I2" | "I5";
  readonly workItemRef: ReferenceKitV1["workItemRef"];
}) => ({
  bodyKind: "run-state" as const,
  runState: IdentificationGraphRunStateV1Schema.parse({
    schemaVersion: "1",
    runId: RUN_ID,
    runVersionId: input.runVersionId,
    stage: input.stage,
    status: "running",
    completedWorkItemRefs: [],
    pendingWorkItemRefs: [input.workItemRef],
    validatedCandidateSetRefs: [],
    failedWorkItemRefs: [],
    acceptedRiskRecordRefs: [],
    rejectedGroupRefs: [],
    pendingGroupRefs: [],
  }),
});

const runResultBody = (kit: ReferenceKitV1) => ({
  bodyKind: "run-result" as const,
  runResult: IdentificationGraphRunResultV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    runRef: RUN_REF,
    parentRiskFlowRunRef: PARENT_RUN_REF,
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    inputSnapshotRef: kit.inputSnapshotRef,
    workPlanRef: kit.workPlanRef,
    acceptedRiskRecordRefs: [],
    acceptedEventRefs: [],
    rejectedGroupRefs: [],
    pendingReviewTaskRefs: [],
    failedWorkItemRefs: [],
    skippedWorkItemRefs: [],
    auditTrailRef: AUDIT_TRAIL_REF,
    recordedAt: TIMESTAMP,
  }),
});

const graphState = (kit: ReferenceKitV1, overrides: Partial<IdentificationGraphStateV1> = {}) =>
  IdentificationGraphStateV1Schema.parse({
    schemaVersion: "1",
    graphVersion: plainRef("identification-graph-version", "1"),
    parentRiskFlowRunRef: PARENT_RUN_REF,
    runRef: RUN_REF,
    threadId: `thread:${RUN_ID}`,
    triggerType: "manual",
    triggerReasonCode: "operator-request",
    authorizationContextRef: refOf("authorization-context", "authorization-c24"),
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    status: "running",
    stage: "I5",
    agentTaskRefs: [],
    acceptedRiskRecordRefs: [],
    reviewTaskRefs: [],
    rejectedGroupRefs: [],
    failedWorkItemRefs: [],
    ...overrides,
  });

/**
 * C05 复验端口的受控替身：只按签发身份放行、撤销后一律拒绝，并记录每次复验请求，使
 * “每个受保护读写前都复验当前授权”可被观察。真实撤销语义由 `test/auth` 套件覆盖。
 */
interface IssuedGraphAccessV1 {
  readonly authorization: AuthorizationContextV1;
  readonly invocationId: string;
  readonly branch: ModuleBranchV1;
  readonly capability: ModuleCapabilityV1;
}

interface GraphAccessControllerV1 {
  readonly port: Pick<LocalIdentityAccessV1, "verify">;
  readonly calls: readonly { readonly invocationId: string; readonly branch: ModuleBranchV1 }[];
  revoke(): void;
  narrowScope(): void;
  restore(): void;
  issue(input: {
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly capability: ModuleCapabilityV1;
    readonly projectId?: string;
    readonly actorId?: string;
  }): IssuedGraphAccessV1;
}

const createGraphAccess = (): GraphAccessControllerV1 => {
  const issued = new Map<string, IssuedGraphAccessV1>();
  const calls: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  let revoked = false;
  let scopeNarrowed = false;
  // 显式变量类型注解使 `denied(...)` 调用参与控制流收窄（TS 只在被调方有类型注解时认定 never 返回）。
  const denied: (stage: string, code: string) => never = (stage, code) => {
    throw new AccessServiceError({
      code: code as "AUTHORIZATION_DENIED",
      retryable: false,
      stage,
      occurredAt: TIMESTAMP,
      diagnosticRef: refOf("audit-trail", `access-diagnostic:${stage}`),
      contextRefs: [],
      requiredCapability: "risk-identification.run",
      authorizationPolicyRef: plainRef("authorization-policy"),
    });
  };
  return {
    calls,
    revoke: () => {
      revoked = true;
    },
    narrowScope: () => {
      scopeNarrowed = true;
    },
    restore: () => {
      revoked = false;
      scopeNarrowed = false;
    },
    issue: (input) => {
      const entityId = `authorization-c24:${input.branch}:${input.invocationId}`;
      const access: IssuedGraphAccessV1 = {
        authorization: AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: refOf("authorization-context", entityId),
          actorId: input.actorId ?? ACTOR_ID,
          projectId: input.projectId ?? PROJECT_ID,
          grantedCapabilities: [input.capability],
          spatialScopeRefs: [...SCOPES],
          sourceAccessGrantRefs: [...SOURCE_GRANTS],
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
      verify: async (request) => {
        calls.push({ invocationId: request.invocationId, branch: request.branch });
        if (revoked) denied("verify.current", "SESSION_REVOKED");
        const stored = issued.get(request.authorizationContextRef.reference.entityId);
        if (
          stored === undefined ||
          stored.invocationId !== request.invocationId ||
          stored.branch !== request.branch ||
          stored.authorization.projectId !== request.projectId
        ) {
          denied("verify.binding", "AUTHORIZATION_DENIED");
        }
        return {
          context: AuthorizationContextV1Schema.parse({
            ...stored.authorization,
            grantedCapabilities: [stored.capability],
            spatialScopeRefs: scopeNarrowed ? [] : [...SCOPES],
            sourceAccessGrantRefs: [...SOURCE_GRANTS],
          }),
          contextRef: stored.authorization.authorizationContextRef,
          redacted: false,
        };
      },
    },
  };
};

interface IdentificationGraphTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly migratorRuntime: PostgresRuntime;
  readonly checkpointerRuntime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly adapter: PostgresIdentificationGraphAdapterV1;
  readonly artifactStore: ArtifactStoreV1 & { close(): Promise<void> };
  readonly access: GraphAccessControllerV1;
  readonly rootDirectory: string;
  close(): Promise<void>;
}

/** 单容器夹具：完整生产迁移链 + C04 文件系统工件存储，登记与正文共用同一 riskflow_app 连接。 */
const startIdentificationGraphFixture = async (): Promise<IdentificationGraphTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c24-graph-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const migratorRuntime = createPostgresRuntime(postgres.migrator, "riskflow_migrator");
    const checkpointerRuntime = createPostgresRuntime(
      postgres.checkpointer,
      "riskflow_checkpointer",
    );
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
    const access = createGraphAccess();
    const adapter = createPostgresIdentificationGraphAdapter({
      db: runtime.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      now: () => new Date(TIMESTAMP),
    });
    return {
      postgres,
      runtime,
      migratorRuntime,
      checkpointerRuntime,
      transactionUnit,
      adapter,
      artifactStore,
      access,
      rootDirectory,
      async close() {
        await artifactStore.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await migratorRuntime.close().catch(() => undefined);
        await checkpointerRuntime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

/** 每类登记行的最小合法夹具：完整引用形状由核心判别联合与迁移 CHECK 互为对照。 */
const resultRowFor = (
  kind: IdentificationGraphResultKindV1,
  suffix: string,
  input: {
    readonly occurredAt?: string;
    readonly runVersionId?: string;
    /** D-15：工作计划形成前的 I0/I1 阶段结果没有工作计划引用。 */
    readonly withoutWorkPlan?: boolean;
  } = {},
): IdentificationGraphResultRowV1 => {
  const base = {
    schemaVersion: "1" as const,
    projectId: PROJECT_ID,
    resultId: `result-${kind}-${suffix}`,
    resultVersionId: sha(`result-version-${kind}-${suffix}`),
    runId: RUN_ID,
    runVersionId: input.runVersionId ?? RUN_VERSION_ID,
    commandId: `c24-fixture-${kind}-${suffix}`,
    idempotencyKey: `idempotency-${kind}-${suffix}`,
    requestDigest: sha(`request-${kind}-${suffix}`),
    artifactRef: refOf(
      "content-artifact",
      `artifact-${kind}-${suffix}`,
      `sha256:${sha(`artifact-body-${kind}-${suffix}`)}`,
    ),
    authorizationScopeDigest: registrationScopeDigest,
    actorRef: ACTOR_ID,
    authorizationContextRef: refOf("authorization-context", "authorization-c24"),
    validAt: TIMESTAMP,
    recordedAt: input.occurredAt ?? TIMESTAMP,
    persistedAt: input.occurredAt ?? TIMESTAMP,
    auditEntryId: `c24-fixture-${kind}-${suffix}:audit`,
  };
  switch (kind) {
    case "input-snapshot":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "input-snapshot",
        parentRunRef: PARENT_RUN_REF,
        preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
        inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot-batch"),
      });
    case "work-plan":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "work-plan",
        parentRunRef: PARENT_RUN_REF,
        inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot-batch"),
        workPlanRef: refOf("identification-work-plan", "identification-work-plan:batch"),
      });
    case "stage-result":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "stage-result",
        ...(input.withoutWorkPlan === true
          ? {}
          : { workPlanRef: refOf("identification-work-plan", "identification-work-plan:batch") }),
        stageResultRef: refOf("stage-result", "stage-result-batch"),
      });
    case "waiting":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "waiting",
        waitingRef: WAITING_REF,
      });
    case "workflow-error":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "workflow-error",
        workflowErrorRef: WORKFLOW_ERROR_REF,
      });
    case "run-state":
      return IdentificationGraphResultRowV1Schema.parse({ ...base, resultKind: "run-state" });
    case "run-result":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "run-result",
        workPlanRef: refOf("identification-work-plan", "identification-work-plan:batch"),
        runResultRef: refOf("identification-run-result", "identification-run-result-batch"),
      });
    case "cancellation":
      return IdentificationGraphResultRowV1Schema.parse({ ...base, resultKind: "cancellation" });
  }
};

const identityOf = (ref: {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}) => ({
  resultId: ref.reference.entityId,
  resultVersionId: ref.reference.versionId,
});

const planRowFor = (
  kit: ReferenceKitV1,
  artifactRef: ArtifactRefV1,
): IdentificationGraphResultRowV1 =>
  IdentificationGraphResultRowV1Schema.parse({
    ...resultRowFor("work-plan", kit.suffix),
    ...identityOf(kit.workPlanRef),
    artifactRef,
    workPlanRef: kit.workPlanRef,
    inputSnapshotRef: kit.inputSnapshotRef,
  });

const snapshotRowFor = (
  kit: ReferenceKitV1,
  artifactRef: ArtifactRefV1,
): IdentificationGraphResultRowV1 =>
  IdentificationGraphResultRowV1Schema.parse({
    ...resultRowFor("input-snapshot", kit.suffix),
    ...identityOf(kit.inputSnapshotRef),
    artifactRef,
    inputSnapshotRef: kit.inputSnapshotRef,
  });

const stageRowFor = (
  kit: ReferenceKitV1,
  artifactRef: ArtifactRefV1,
): IdentificationGraphResultRowV1 =>
  IdentificationGraphResultRowV1Schema.parse({
    ...resultRowFor("stage-result", kit.suffix),
    ...identityOf(kit.stageResultRef),
    artifactRef,
    workPlanRef: kit.workPlanRef,
    stageResultRef: kit.stageResultRef,
  });

const runResultRowFor = (
  kit: ReferenceKitV1,
  artifactRef: ArtifactRefV1,
): IdentificationGraphResultRowV1 =>
  IdentificationGraphResultRowV1Schema.parse({
    ...resultRowFor("run-result", kit.suffix),
    ...identityOf(kit.runResultRef),
    artifactRef,
    workPlanRef: kit.workPlanRef,
    runResultRef: kit.runResultRef,
  });

/** 经适配器写入 C04 正文：身份与 reader 使用同一 `body-write` 派生约定。 */
const putBodyAs = (
  fixture: IdentificationGraphTestFixture,
  input: {
    readonly artifactId: string;
    readonly body: unknown;
    readonly projectId?: string;
    readonly actorId?: string;
  },
): Promise<ArtifactRefV1> => {
  const projectId = input.projectId ?? PROJECT_ID;
  const actorId = input.actorId ?? ACTOR_ID;
  const issued = fixture.access.issue({
    invocationId: identificationGraphReadInvocationIdV1({
      operation: "body-write",
      projectId,
      targetId: input.artifactId,
    }),
    branch: "risk-identification.plan",
    capability: "risk-identification.run",
    projectId,
    actorId,
  });
  return fixture.adapter.putBody({
    projectId,
    actorId,
    commandId: `c24-fixture-put-${input.artifactId}`,
    issuedAt: TIMESTAMP,
    artifactId: input.artifactId,
    body: IdentificationGraphArtifactBodyV1Schema.parse(input.body),
    authorization: issued.authorization,
  });
};

const registrationCommit = (
  command: AtomicCommandV1,
  row: IdentificationGraphResultRowV1,
): AtomicCommitV1 => ({
  resultRef: row.artifactRef,
  audit: {
    // 首次登记必须写核心约定的 `${commandId}:audit`；审计外键延迟到提交时校验。
    auditEntryId: `${command.commandId}:audit`,
    projectId: command.projectId,
    action: command.commandKind,
    targetRef: row.artifactRef,
    actorRef: command.actorRef,
    authorizationContextRef: command.authorizationContextRef,
    occurredAt: TIMESTAMP,
    recordedAt: TIMESTAMP,
    version: { entityId: row.resultId, versionId: row.resultVersionId },
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
  },
  events: [],
});

/**
 * 登记只在调用方 ambient C03 事务内发生：这里按与生产同一顺序驱动 commit 与审计。批量登记共用
 * 同一命令身份与同一条审计行（C03 `AtomicCommitV1` 只承载一条审计），因此批次内每行都按该命令
 * 派生 `auditEntryId`；单行登记时该归一化与行自身派生的审计身份逐字相同。
 */
const registerThroughTransaction = async (
  fixture: IdentificationGraphTestFixture,
  rows: readonly IdentificationGraphResultRowV1[],
  attempt: string,
): Promise<{
  readonly receipt: AtomicCommitReceiptV1;
  readonly outcome: PostgresIdentificationGraphRegistrationOutcomeV1 | undefined;
}> => {
  const head = rows[0] as IdentificationGraphResultRowV1;
  const commandId = attempt === "first" ? head.commandId : `${head.commandId}:${attempt}`;
  const normalized = rows.map((row) =>
    IdentificationGraphResultRowV1Schema.parse({
      ...row,
      commandId,
      auditEntryId: `${commandId}:audit`,
    }),
  );
  const command: AtomicCommandV1 = {
    projectId: head.projectId,
    commandKind: "identification-graph-result-register",
    commandId,
    idempotencyKey: commandId,
    payload: {
      fixture: "合成样本、待甲方复核",
      attempt,
      resultKinds: normalized.map((row) => row.resultKind),
    },
    actorRef: head.actorRef,
    authorizationContextRef: head.authorizationContextRef,
    issuedAt: TIMESTAMP,
  };
  let outcome: PostgresIdentificationGraphRegistrationOutcomeV1 | undefined;
  const receipt = await fixture.transactionUnit.execute(command, async (context) => {
    outcome = await fixture.adapter.registerResults(
      { rows: normalized, occurredAt: TIMESTAMP },
      context,
    );
    return registrationCommit(command, head);
  });
  return { receipt, outcome };
};

/** 计划与输入快照的登记 + C04 正文：reader 路径的最小可读闭环。 */
const registerPlanFixture = async (fixture: IdentificationGraphTestFixture, suffix: string) => {
  const kit = referenceKitFor(suffix);
  const body = workPlanBody(kit);
  const planArtifactRef = await putBodyAs(fixture, {
    artifactId: `c24-body-plan-${suffix}`,
    body: { bodyKind: "work-plan", workPlan: body },
  });
  const snapshotArtifactRef = await putBodyAs(fixture, {
    artifactId: `c24-body-snapshot-${suffix}`,
    body: { bodyKind: "input-snapshot", inputSnapshot: body.inputSnapshot },
  });
  await registerThroughTransaction(
    fixture,
    [planRowFor(kit, planArtifactRef), snapshotRowFor(kit, snapshotArtifactRef)],
    "first",
  );
  return { ...kit, body, planArtifactRef, snapshotArtifactRef };
};

/** C22 复验身份：与 reader 的 `work-plan` 派生约定同形。 */
const workPlanAuthorization = (
  fixture: IdentificationGraphTestFixture,
  ref: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  projectId = PROJECT_ID,
): AuthorizationContextV1 =>
  fixture.access.issue({
    invocationId: identificationGraphReadInvocationIdV1({
      operation: "work-plan",
      projectId,
      targetId: `${ref.reference.entityId}@${ref.reference.versionId}`,
    }),
    branch: "risk-identification.merge-run-candidates",
    capability: "risk-identification.finalize",
    projectId,
  }).authorization;

/**
 * C21 复验身份：冻结的 C21 核心服务以其 `queryId` 同时作为签发与复验身份
 * （`IdentificationContextService` 的 `verifyCurrent({invocationId: query.queryId})`），
 * 因此 C24 reader 沿用同一身份，无需第二套派生。
 */
const contextAuthorization = (fixture: IdentificationGraphTestFixture, queryId: string) =>
  fixture.access.issue({
    invocationId: queryId,
    branch: "knowledge-modeling.relationship-context",
    capability: "knowledge-modeling.retrieve",
  }).authorization;

const reconcileAuthorization = (
  fixture: IdentificationGraphTestFixture,
  runId = RUN_ID,
  projectId = PROJECT_ID,
) =>
  fixture.access.issue({
    invocationId: identificationGraphReadInvocationIdV1({
      operation: "reconcile",
      projectId,
      targetId: runId,
    }),
    branch: "risk-identification.plan",
    capability: "risk-identification.run",
    projectId,
  }).authorization;

const registrationRead = (
  fixture: IdentificationGraphTestFixture,
  operation: "result-row" | "run-rows" | "run-state",
  targetId: string,
  projectId = PROJECT_ID,
  actorId = ACTOR_ID,
) => ({
  actorId,
  requestedAt: TIMESTAMP,
  authorization: fixture.access.issue({
    invocationId: identificationGraphReadInvocationIdV1({ operation, projectId, targetId }),
    branch: "risk-identification.plan",
    capability: "risk-identification.run",
    projectId,
    actorId,
  }).authorization,
});

const countRows = async (
  fixture: IdentificationGraphTestFixture,
  query: { readonly projectId: string; readonly resultId?: string },
): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM business.identification_graph_results
    WHERE project_id = ${query.projectId}
      AND (${query.resultId ?? null}::text IS NULL OR result_id = ${query.resultId ?? null}::text)
  `.execute(fixture.runtime.db);
  return Number(result.rows[0]?.count ?? "0");
};

const tableExists = async (
  fixture: IdentificationGraphTestFixture,
  table: string,
): Promise<boolean> => {
  const result = await sql<{ name: string | null }>`
    SELECT to_regclass(${table})::text AS name
  `.execute(fixture.runtime.db);
  return result.rows[0]?.name !== null;
};

const objectPathFor = (
  fixture: IdentificationGraphTestFixture,
  artifactRef: ArtifactRefV1,
): string => {
  const hash = artifactRef.reference.versionId.replace(/^sha256:/u, "");
  return join(fixture.rootDirectory, "objects", "sha256", hash.slice(0, 2), hash.slice(2, 4), hash);
};

/** 判别约束的规范定义文本：重入 `up` 后必须与首次执行完全相同（D-15）。 */
const kindCheckDefinitionOf = async (
  fixture: IdentificationGraphTestFixture,
): Promise<string | undefined> => {
  const result = await sql<{ definition: string }>`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'business.identification_graph_results'::regclass
      AND conname = 'identification_graph_results_kind_ck'
  `.execute(fixture.runtime.db);
  return result.rows[0]?.definition;
};

/** 表上的索引与最小授权集合：重入 `up` 不得增减。授权用迁移角色读取，避免成员关系过滤。 */
const tableIndexesOf = async (
  fixture: IdentificationGraphTestFixture,
): Promise<readonly string[]> =>
  (
    await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'business' AND tablename = 'identification_graph_results'
      ORDER BY indexname
    `.execute(fixture.migratorRuntime.db)
  ).rows.map((row) => row.indexname);

const tableGrantsOf = async (fixture: IdentificationGraphTestFixture): Promise<readonly string[]> =>
  (
    await sql<{ grantee: string; privilege_type: string }>`
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'business' AND table_name = 'identification_graph_results'
      ORDER BY grantee, privilege_type
    `.execute(fixture.migratorRuntime.db)
  ).rows.map((row) => `${row.grantee}:${row.privilege_type}`);

/** 越界组合直接经 SQL 写入：核心判别 Schema 拒绝的形状必须同样由数据库拒绝（23514）。 */
const insertRawCombination = async (
  fixture: IdentificationGraphTestFixture,
  input: {
    readonly suffix: string;
    readonly resultKind: string;
    readonly parentRunRef?: unknown;
    readonly inputSnapshotRef?: unknown;
    readonly workPlanRef?: unknown;
    readonly stageResultRef?: unknown;
    readonly waitingRef?: unknown;
    readonly workflowErrorRef?: unknown;
    readonly runResultRef?: unknown;
  },
): Promise<void> => {
  const json = (value: unknown): string | null =>
    value === undefined ? null : JSON.stringify(value);
  await sql`
    INSERT INTO business.identification_graph_results (
      project_id, result_kind, result_id, result_version_id, run_id, run_version_id, command_id,
      idempotency_key, request_digest, artifact_ref, authorization_scope_digest, actor_ref,
      authorization_context_ref, parent_run_ref, input_snapshot_ref, work_plan_ref,
      stage_result_ref, waiting_ref, workflow_error_ref, run_result_ref,
      valid_at, recorded_at, audit_entry_id
    ) VALUES (
      ${PROJECT_ID}, ${input.resultKind}, ${`raw-result-${input.suffix}`},
      ${sha(`raw-version-${input.suffix}`)}, ${RUN_ID}, ${RUN_VERSION_ID},
      ${`raw-command-${input.suffix}`}, ${`raw-idempotency-${input.suffix}`},
      ${sha(`raw-request-${input.suffix}`)},
      ${json(refOf("content-artifact", `raw-artifact-${input.suffix}`))}::jsonb,
      ${registrationScopeDigest}, ${ACTOR_ID},
      ${json(refOf("authorization-context", "authorization-c24"))}::jsonb,
      ${json(input.parentRunRef)}::jsonb, ${json(input.inputSnapshotRef)}::jsonb,
      ${json(input.workPlanRef)}::jsonb, ${json(input.stageResultRef)}::jsonb,
      ${json(input.waitingRef)}::jsonb, ${json(input.workflowErrorRef)}::jsonb,
      ${json(input.runResultRef)}::jsonb,
      ${TIMESTAMP}::timestamptz, ${TIMESTAMP}::timestamptz, ${`raw-command-${input.suffix}:audit`}
    )
  `.execute(fixture.runtime.db);
};

let fixture: IdentificationGraphTestFixture | undefined;

beforeAll(async () => {
  fixture = await startIdentificationGraphFixture();
}, 180_000);

afterAll(async () => {
  await fixture?.close();
});

describe("PostgreSQL identification graph persistence", () => {
  it("applies migration 000043 with append-only app grants and no checkpointer access", async () => {
    expect(await tableExists(fixture!, "business.identification_graph_results")).toBe(true);

    // 应用角色只追加：UPDATE/DELETE 必须被数据库拒绝（42501）。
    await expect(
      sql`UPDATE business.identification_graph_results SET actor_ref = 'tampered'`.execute(
        fixture!.runtime.db,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sql`DELETE FROM business.identification_graph_results`.execute(fixture!.runtime.db),
    ).rejects.toMatchObject({ code: "42501" });

    // checkpointer 与本表无任何权限：识别业务事实与 LangGraph 检查点严格分离。
    await expect(
      sql`SELECT count(*) FROM business.identification_graph_results`.execute(
        fixture!.checkpointerRuntime.db,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  }, 90_000);

  it("converges the kind check on an existing table and keeps indexes and grants on re-apply", async () => {
    const converged = await kindCheckDefinitionOf(fixture!);
    const indexes = await tableIndexesOf(fixture!);
    const grants = await tableGrantsOf(fixture!);
    expect(converged).toContain("stage_result_ref IS NOT NULL");
    // 最小授权：应用与 Outbox 只得到追加权限，checkpointer 与本表无关。
    const appendRoles = ["riskflow_app", "riskflow_outbox_worker"];
    expect(
      grants
        .filter((grant) => appendRoles.some((role) => grant.startsWith(`${role}:`)))
        .sort((left, right) => (left < right ? -1 : 1)),
    ).toEqual([
      "riskflow_app:INSERT",
      "riskflow_app:SELECT",
      "riskflow_outbox_worker:INSERT",
      "riskflow_outbox_worker:SELECT",
    ]);
    expect(grants.some((grant) => grant.startsWith("riskflow_checkpointer"))).toBe(false);

    // 模拟已部署的旧表：同名 check 仍是 D-15 之前的允许组合（stage-result 必须有工作计划引用）。
    await sql`
      ALTER TABLE business.identification_graph_results
        DROP CONSTRAINT identification_graph_results_kind_ck
    `.execute(fixture!.migratorRuntime.db);
    await sql`
      ALTER TABLE business.identification_graph_results
        ADD CONSTRAINT identification_graph_results_kind_ck CHECK (
          result_kind IN (
            'input-snapshot', 'work-plan', 'stage-result', 'waiting',
            'workflow-error', 'run-state', 'run-result', 'cancellation'
          ) AND (result_kind <> 'stage-result' OR work_plan_ref IS NOT NULL)
        )
    `.execute(fixture!.migratorRuntime.db);
    await expect(
      insertRawCombination(fixture!, {
        suffix: "legacy-without-plan",
        resultKind: "stage-result",
        stageResultRef: refOf("stage-result", "stage-result-legacy"),
      }),
    ).rejects.toMatchObject({ code: "23514" });

    // 重入 `up` 两次：约束收敛到新允许组合，索引与最小授权不变。
    await identificationGraphMigration.up(fixture!.migratorRuntime.db);
    await identificationGraphMigration.up(fixture!.migratorRuntime.db);
    expect(await kindCheckDefinitionOf(fixture!)).toBe(converged);
    expect(await tableIndexesOf(fixture!)).toEqual(indexes);
    expect(await tableGrantsOf(fixture!)).toEqual(grants);

    // 收敛后无工作计划的 stage-result 与既有组合一并可用。
    const planless = resultRowFor("stage-result", "converged-without-plan", {
      withoutWorkPlan: true,
    });
    expect(await registerThroughTransaction(fixture!, [planless], "first")).toMatchObject({
      outcome: { kind: "registered", replayed: false },
    });
  }, 120_000);

  it("accepts plan-less stage results and rejects unlisted kind combinations", async () => {
    const planless = resultRowFor("stage-result", "without-plan", { withoutWorkPlan: true });
    const withPlan = resultRowFor("stage-result", "with-plan");

    // D-15 允许组合：无工作计划引用的阶段结果可登记并按完整身份精确回读。
    const registered = await registerThroughTransaction(fixture!, [planless], "first");
    expect(registered.outcome).toEqual({ kind: "registered", replayed: false });
    const read = await fixture!.adapter.registrationStore.readRow({
      projectId: PROJECT_ID,
      ...registrationRead(
        fixture!,
        "result-row",
        `stage-result:${planless.resultId}:${planless.resultVersionId}`,
      ),
      resultKind: "stage-result",
      resultId: planless.resultId,
      resultVersionId: planless.resultVersionId,
    });
    expect(read).toEqual({ ...planless, workPlanRef: null, persistedAt: expect.any(String) });
    expect(read?.resultKind === "stage-result" ? read.workPlanRef : "unexpected").toBeNull();

    // 缺省的计划引用不写工作计划列：数据库列为 NULL。
    const stored = await sql<{ work_plan_ref: unknown }>`
      SELECT work_plan_ref FROM business.identification_graph_results
      WHERE project_id = ${PROJECT_ID} AND result_id = ${planless.resultId}
    `.execute(fixture!.runtime.db);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.work_plan_ref).toBeNull();

    // 同键同载荷重放不增行；同键异载荷保持首次事实并返回不可重试冲突。
    expect(await registerThroughTransaction(fixture!, [planless], "second")).toMatchObject({
      outcome: { kind: "registered", replayed: true },
    });
    expect(await countRows(fixture!, { projectId: PROJECT_ID, resultId: planless.resultId })).toBe(
      1,
    );
    expect(
      await registerThroughTransaction(
        fixture!,
        [
          IdentificationGraphResultRowV1Schema.parse({
            ...planless,
            requestDigest: sha("request-stage-result-without-plan-conflict"),
          }),
        ],
        "conflict",
      ),
    ).toMatchObject({
      outcome: { kind: "idempotency-conflict", priorCommandId: planless.commandId },
    });

    // 携带冻结工作计划的同类登记仍照常可用。
    expect(await registerThroughTransaction(fixture!, [withPlan], "first")).toMatchObject({
      outcome: { kind: "registered", replayed: false },
    });

    // 越界组合：缺同类专列、携带它类专列与未声明类别都由数据库拒绝。
    const plan = refOf("identification-work-plan", "identification-work-plan:batch");
    const stage = refOf("stage-result", "stage-result-batch");
    const rejected = [
      { suffix: "stage-without-stage-ref", resultKind: "stage-result", workPlanRef: plan },
      {
        suffix: "stage-with-foreign-ref",
        resultKind: "stage-result",
        stageResultRef: stage,
        waitingRef: WAITING_REF,
      },
      {
        suffix: "work-plan-with-foreign-ref",
        resultKind: "work-plan",
        parentRunRef: PARENT_RUN_REF,
        inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot-batch"),
        workPlanRef: plan,
        runResultRef: refOf("identification-run-result", "identification-run-result-batch"),
      },
      { suffix: "run-result-without-result", resultKind: "run-result", workPlanRef: plan },
      { suffix: "waiting-without-ref", resultKind: "waiting" },
      { suffix: "unlisted-kind", resultKind: "unlisted-kind" },
    ];
    for (const combination of rejected) {
      await expect(insertRawCombination(fixture!, combination)).rejects.toMatchObject({
        code: "23514",
      });
    }
  }, 120_000);

  it("registers all eight result kinds with exact identity and keeps bodies out of the table", async () => {
    const kinds: readonly IdentificationGraphResultKindV1[] = [
      "input-snapshot",
      "work-plan",
      "stage-result",
      "waiting",
      "workflow-error",
      "run-state",
      "run-result",
      "cancellation",
    ];
    for (const kind of kinds) {
      const row = resultRowFor(kind, "batch");
      const registered = await registerThroughTransaction(fixture!, [row], "first");
      expect(registered.outcome).toEqual({ kind: "registered", replayed: false });
      expect(
        await fixture!.adapter.registrationStore.readRow({
          projectId: PROJECT_ID,
          ...registrationRead(
            fixture!,
            "result-row",
            `${kind}:${row.resultId}:${row.resultVersionId}`,
          ),
          resultKind: kind,
          resultId: row.resultId,
          resultVersionId: row.resultVersionId,
        }),
      ).toEqual({ ...row, persistedAt: expect.any(String) });
    }

    // `agent-task` 等待变体（协调者裁决新增）在登记行与 CHECK 约束上同样被接受。
    const agentTaskWaitingRow = IdentificationGraphResultRowV1Schema.parse({
      ...resultRowFor("waiting", "agent-task"),
      waitingRef: {
        kind: "agent-task",
        agentTaskRef: {
          kind: "agent-task",
          reference: plainRef("agent-task:c24"),
          taskType: "retrieval-review",
          triggerMode: "embedded",
          modelDeploymentRef: plainRef("model-deployment"),
          promptTemplateRef: plainRef("prompt-template"),
          toolPolicyRef: plainRef("tool-policy"),
          budgetPolicyRef: plainRef("budget-policy"),
          incrementSchemaRef: plainRef("increment-schema"),
          validationPolicyRef: plainRef("validation-policy"),
        },
      },
    });
    const waitingRegistered = await registerThroughTransaction(
      fixture!,
      [agentTaskWaitingRow],
      "first",
    );
    expect(waitingRegistered.outcome).toEqual({ kind: "registered", replayed: false });
    expect(
      await fixture!.adapter.registrationStore.readRow({
        projectId: PROJECT_ID,
        ...registrationRead(
          fixture!,
          "result-row",
          `waiting:${agentTaskWaitingRow.resultId}:${agentTaskWaitingRow.resultVersionId}`,
        ),
        resultKind: "waiting",
        resultId: agentTaskWaitingRow.resultId,
        resultVersionId: agentTaskWaitingRow.resultVersionId,
      }),
    ).toEqual({ ...agentTaskWaitingRow, persistedAt: expect.any(String) });

    // 正文只在 C04：登记表内不得出现正文内容，且未登记的引用读不到正文。
    const plan = await registerPlanFixture(fixture!, "artifact");
    const dumped = await sql<Record<string, unknown>>`
      SELECT * FROM business.identification_graph_results
      WHERE project_id = ${PROJECT_ID} AND result_id = ${plan.workPlanRef.reference.entityId}
    `.execute(fixture!.runtime.db);
    expect(dumped.rows).toHaveLength(1);
    expect(JSON.stringify(dumped.rows)).not.toContain(FROZEN_QUERY_TEXT);
    expect(
      await fixture!.adapter.readWorkPlanBody({
        projectId: PROJECT_ID,
        workPlanRef: refOf("identification-work-plan", "identification-work-plan:absent"),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: workPlanAuthorization(
          fixture!,
          refOf("identification-work-plan", "identification-work-plan:absent"),
        ),
      }),
    ).toBeUndefined();
  }, 120_000);

  it("replays the same key and payload and conflicts on another payload for the same key", async () => {
    const row = resultRowFor("stage-result", "replay");

    const first = await registerThroughTransaction(fixture!, [row], "first");
    expect(first.outcome).toEqual({ kind: "registered", replayed: false });

    // 同命令重放：C03 收据直接重放，handler 不再执行，登记行与审计都不新增。
    const receiptReplay = await registerThroughTransaction(fixture!, [row], "first");
    expect(receiptReplay.receipt.replayed).toBe(true);
    expect(receiptReplay.outcome).toBeUndefined();

    // 异命令同载荷：适配器按完整身份判为同摘要重放，原行不被改写。
    const adapterReplay = await registerThroughTransaction(fixture!, [row], "second");
    expect(adapterReplay.outcome).toEqual({ kind: "registered", replayed: true });

    // 同幂等键异载荷：唯一键命中但摘要不同，返回不可重试冲突与首次命令身份。
    const conflicting = IdentificationGraphResultRowV1Schema.parse({
      ...row,
      resultVersionId: sha("result-version-stage-result-conflict"),
      requestDigest: sha("request-stage-result-conflict"),
    });
    const conflicted = await registerThroughTransaction(fixture!, [conflicting], "conflict");
    expect(conflicted.outcome).toEqual({
      kind: "idempotency-conflict",
      priorCommandId: row.commandId,
    });

    expect(await countRows(fixture!, { projectId: PROJECT_ID, resultId: row.resultId })).toBe(1);
    expect(
      await fixture!.adapter.registrationStore.readRow({
        projectId: PROJECT_ID,
        ...registrationRead(
          fixture!,
          "result-row",
          `stage-result:${row.resultId}:${row.resultVersionId}`,
        ),
        resultKind: "stage-result",
        resultId: row.resultId,
        resultVersionId: row.resultVersionId,
      }),
    ).toEqual({ ...row, persistedAt: expect.any(String) });
  }, 90_000);

  it("reads run rows and the latest run state by exact project and run identity", async () => {
    const kit = referenceKitFor("run-state");
    const olderVersionId = sha("run-version-older");
    const newerVersionId = sha("run-version-newer");
    const older = resultRowFor("run-state", "older", {
      occurredAt: TIMESTAMP,
      runVersionId: olderVersionId,
    });
    const newerVersionRow = resultRowFor("run-state", "newer", {
      occurredAt: OTHER_TIMESTAMP,
      runVersionId: newerVersionId,
    });
    const artifactRef = await putBodyAs(fixture!, {
      artifactId: "c24-body-run-state",
      body: runStateBody({
        runVersionId: newerVersionId,
        stage: "I5",
        workItemRef: kit.workItemRef,
      }),
    });
    // 登记端口不携带调用方授权，因此 run-state 的读取按登记行冻结引用复验同一派生身份。
    const storedNewer = IdentificationGraphResultRowV1Schema.parse({
      ...newerVersionRow,
      artifactRef,
      authorizationContextRef: fixture!.access.issue({
        invocationId: identificationGraphReadInvocationIdV1({
          operation: "run-state",
          projectId: PROJECT_ID,
          targetId: newerVersionRow.resultVersionId,
        }),
        branch: "risk-identification.plan",
        capability: "risk-identification.run",
      }).authorization.authorizationContextRef,
    });

    await registerThroughTransaction(fixture!, [older], "first");
    await registerThroughTransaction(fixture!, [storedNewer], "first");

    const rows = await fixture!.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      ...registrationRead(fixture!, "run-rows", RUN_ID),
    });
    expect(rows.some((row) => row.resultId === older.resultId)).toBe(true);
    expect(rows.every((row) => row.projectId === PROJECT_ID && row.runId === RUN_ID)).toBe(true);

    const latest = await fixture!.adapter.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      ...registrationRead(fixture!, "run-state", RUN_ID),
    });
    expect(latest?.row.resultId).toBe(storedNewer.resultId);
    expect(latest?.state.runVersionId).toBe(newerVersionId);
    expect(latest?.state.stage).toBe("I5");

    const otherActor = registrationRead(fixture!, "run-state", RUN_ID, PROJECT_ID, "other-actor");
    expect(
      await fixture!.adapter.registrationStore.readLatestRunState({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        ...otherActor,
        actorId: ACTOR_ID,
      }),
    ).toBeUndefined();
    fixture!.access.narrowScope();
    expect(
      await fixture!.adapter.registrationStore.readLatestRunState({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        ...registrationRead(fixture!, "run-state", RUN_ID),
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.registrationStore.listRunRows({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        ...registrationRead(fixture!, "run-rows", RUN_ID),
      }),
    ).toEqual([]);
    fixture!.access.restore();

    // 跨工程不得命中同运行身份：既没有登记行，也不泄露对象是否存在。
    expect(
      await fixture!.adapter.registrationStore.readLatestRunState({
        projectId: OTHER_PROJECT_ID,
        runId: RUN_ID,
        ...registrationRead(fixture!, "run-state", RUN_ID, OTHER_PROJECT_ID),
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.registrationStore.readRow({
        projectId: OTHER_PROJECT_ID,
        ...registrationRead(
          fixture!,
          "result-row",
          `run-state:${storedNewer.resultId}:${storedNewer.resultVersionId}`,
          OTHER_PROJECT_ID,
        ),
        resultKind: "run-state",
        resultId: storedNewer.resultId,
        resultVersionId: storedNewer.resultVersionId,
      }),
    ).toBeUndefined();
  }, 90_000);

  it("denies protected reads and writes when the current authorization is revoked, leaking nothing", async () => {
    const revokedPlan = await registerPlanFixture(fixture!, "revoked");
    const revokedContext = contextAuthorization(fixture!, "c24-query-revoked");
    const revokedFinalize = workPlanAuthorization(fixture!, revokedPlan.workPlanRef);
    const revokedReconcile = reconcileAuthorization(fixture!);
    const rowsBefore = await countRows(fixture!, { projectId: PROJECT_ID });

    fixture!.access.revoke();
    try {
      // 已登记的精确引用与不存在的引用得到同一失败形状，不泄露对象是否存在。
      const exact = await fixture!.adapter.contextInputReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        queryId: "c24-query-revoked",
        inputSnapshotRef: revokedPlan.inputSnapshotRef,
        workItemRef: revokedPlan.workItemRef,
        authorization: revokedContext,
      });
      const absent = await fixture!.adapter.contextInputReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        queryId: "c24-query-revoked",
        inputSnapshotRef: refOf("identification-input-snapshot", "absent"),
        workItemRef: revokedPlan.absentWorkItemRef,
        authorization: revokedContext,
      });
      expect(exact).toEqual({
        kind: "failed",
        code: "AUTHORIZATION_DENIED",
        detailCode: "authorization-denied",
      });
      expect(absent).toEqual(exact);

      expect(
        await fixture!.adapter.workPlanReader.readExact({
          projectId: PROJECT_ID,
          actorId: ACTOR_ID,
          requestedAt: TIMESTAMP,
          workPlanRef: revokedPlan.workPlanRef,
          authorization: revokedFinalize,
        }),
      ).toEqual({
        kind: "failed",
        code: "AUTHORIZATION_DENIED",
        detailCode: "authorization-denied",
      });
      expect(
        await fixture!.adapter.readWorkPlanBody({
          projectId: PROJECT_ID,
          workPlanRef: revokedPlan.workPlanRef,
          actorId: ACTOR_ID,
          requestedAt: TIMESTAMP,
          authorization: revokedFinalize,
        }),
      ).toBeUndefined();
      expect(
        await fixture!.adapter.reconcileCheckpointReferences({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          state: graphState(revokedPlan, { workPlanRef: revokedPlan.workPlanRef }),
          actorId: ACTOR_ID,
          requestedAt: TIMESTAMP,
          authorization: revokedReconcile,
        }),
      ).toEqual({ kind: "inconsistent", detailCode: "authorization-denied" });

      // 撤销后禁止正文写入，也不留下登记行。
      await expect(
        putBodyAs(fixture!, {
          artifactId: "c24-body-after-revoke",
          body: {
            bodyKind: "cancellation",
            cancellation: {
              schemaVersion: "1",
              runRef: RUN_REF,
              reasonCode: "operator-request",
              cancelledAt: TIMESTAMP,
            },
          },
        }),
      ).rejects.toMatchObject({ name: "IdentificationGraphDeniedError" });
      expect(await countRows(fixture!, { projectId: PROJECT_ID })).toBe(rowsBefore);
    } finally {
      fixture!.access.restore();
    }
  }, 120_000);

  it("verifies the current authorization before every protected read", async () => {
    const plan = await registerPlanFixture(fixture!, "verify");
    const before = fixture!.access.calls.length;
    const queryId = "c24-query-verified";
    await fixture!.adapter.contextInputReader.readExact({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      queryId,
      inputSnapshotRef: plan.inputSnapshotRef,
      workItemRef: plan.workItemRef,
      authorization: contextAuthorization(fixture!, queryId),
    });
    expect(fixture!.access.calls.slice(before)).toEqual([
      { invocationId: queryId, branch: "knowledge-modeling.relationship-context" },
    ]);
  }, 90_000);

  it("rejects an unlisted capability and a foreign project before touching any registration row", async () => {
    const unlisted = fixture!.access.issue({
      invocationId: "c24-query-unlisted",
      branch: "engineering-data.source-segments",
      capability: "engineering-data.read",
    }).authorization;
    expect(
      await fixture!.adapter.contextInputReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        queryId: "c24-query-unlisted",
        inputSnapshotRef: refOf("identification-input-snapshot", "foreign"),
        workItemRef: refOf("identification-work-item", "foreign"),
        authorization: unlisted,
      }),
    ).toEqual({ kind: "failed", code: "AUTHORIZATION_DENIED", detailCode: "authorization-denied" });

    // 授权工程与调用工程不一致：不得用别工程授权读取本工程登记行。
    const foreignProject = fixture!.access.issue({
      invocationId: "c24-query-foreign-project",
      branch: "knowledge-modeling.relationship-context",
      capability: "knowledge-modeling.retrieve",
      projectId: OTHER_PROJECT_ID,
    }).authorization;
    expect(
      await fixture!.adapter.contextInputReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        queryId: "c24-query-foreign-project",
        inputSnapshotRef: refOf("identification-input-snapshot", "foreign"),
        workItemRef: refOf("identification-work-item", "foreign"),
        authorization: foreignProject,
      }),
    ).toEqual({ kind: "failed", code: "AUTHORIZATION_DENIED", detailCode: "authorization-denied" });
  }, 90_000);

  it("reads the C21 exact input and the C22 work plan from registration rows and C04 bodies", async () => {
    const plan = await registerPlanFixture(fixture!, "read");
    const stageArtifactRef = await putBodyAs(fixture!, {
      artifactId: "c24-body-stage-read",
      body: stageResultI5Body(plan),
    });
    await registerThroughTransaction(fixture!, [stageRowFor(plan, stageArtifactRef)], "first");

    const queryId = "c24-query-read";
    const exact = await fixture!.adapter.contextInputReader.readExact({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      queryId,
      inputSnapshotRef: plan.inputSnapshotRef,
      workItemRef: plan.workItemRef,
      authorization: contextAuthorization(fixture!, queryId),
    });
    expect(exact).toEqual({
      kind: "succeeded",
      read: {
        inputSnapshot: inputSnapshot(),
        workItem: {
          workItemRef: plan.workItemRef,
          nodeId: "node-1",
          spatialScopeRefs: [...SCOPES],
          sourceVersionRefs: [WORK_ITEM_SOURCE_VERSION_REF],
          frozenQueryText: FROZEN_QUERY_TEXT,
        },
      },
    });

    expect(
      await fixture!.adapter.workPlanReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        workPlanRef: plan.workPlanRef,
        authorization: workPlanAuthorization(fixture!, plan.workPlanRef),
      }),
    ).toEqual({
      kind: "succeeded",
      read: {
        workPlanRef: plan.workPlanRef,
        inputSnapshotRef: plan.inputSnapshotRef,
        inputSnapshot: inputSnapshot(),
        workItems: [
          {
            workItemRef: plan.workItemRef,
            nodeId: "node-1",
            spatialScopeRefs: [...SCOPES],
            sourceVersionRefs: [WORK_ITEM_SOURCE_VERSION_REF],
          },
        ],
        // 已校验候选集只来自本运行已登记的 I5 结果，稳定排序、去重。
        validatedCandidateSetRefs: [plan.validatedCandidateSetRef],
      },
    });

    // 同一输入快照经适配器自身的精确回读入口可读，且必须携带同一派生身份的当前授权。
    const inputSnapshotRead = await fixture!.adapter.readInputSnapshotBody({
      projectId: PROJECT_ID,
      inputSnapshotRef: plan.inputSnapshotRef,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: fixture!.access.issue({
        invocationId: identificationGraphReadInvocationIdV1({
          operation: "context-input",
          projectId: PROJECT_ID,
          targetId: `${plan.inputSnapshotRef.reference.entityId}@${plan.inputSnapshotRef.reference.versionId}`,
        }),
        branch: "risk-identification.plan",
        capability: "risk-identification.run",
      }).authorization,
    });
    expect(inputSnapshotRead).toEqual(inputSnapshot());
    expect(
      await fixture!.adapter.readInputSnapshotBody({
        projectId: PROJECT_ID,
        inputSnapshotRef: plan.inputSnapshotRef,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: contextAuthorization(fixture!, queryId),
      }),
    ).toBeUndefined();

    // 工作项不在冻结计划内属于输入漂移，不是"未找到"。
    expect(
      await fixture!.adapter.contextInputReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        queryId,
        inputSnapshotRef: plan.inputSnapshotRef,
        workItemRef: plan.absentWorkItemRef,
        authorization: contextAuthorization(fixture!, queryId),
      }),
    ).toEqual({
      kind: "failed",
      code: "IDENTIFICATION_INPUT_DRIFT",
      detailCode: "work-item-not-in-work-plan",
    });

    // 不存在的登记行与跨工程身份同形返回"未找到"，不泄露对象是否存在。
    const absentPlanRef = refOf("identification-work-plan", "identification-work-plan:absent");
    expect(
      await fixture!.adapter.workPlanReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        workPlanRef: absentPlanRef,
        authorization: workPlanAuthorization(fixture!, absentPlanRef),
      }),
    ).toEqual({
      kind: "failed",
      code: "ENTITY_NOT_FOUND",
      detailCode: "work-plan-registration-missing",
    });
  }, 120_000);

  it("detects a C04 digest mismatch instead of accepting the registered reference", async () => {
    const plan = await registerPlanFixture(fixture!, "tampered");

    // 登记行与引用本身合法：先证明未篡改时可读，再破坏对象文件使摘要不一致。
    expect(
      await fixture!.adapter.readWorkPlanBody({
        projectId: PROJECT_ID,
        workPlanRef: plan.workPlanRef,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: workPlanAuthorization(fixture!, plan.workPlanRef),
      }),
    ).toEqual(plan.body);

    const objectPath = objectPathFor(fixture!, plan.planArtifactRef);
    await chmod(objectPath, 0o600);
    await writeFile(objectPath, encoder.encode(JSON.stringify({ bodyKind: "work-plan" })));

    expect(
      await fixture!.adapter.readWorkPlanBody({
        projectId: PROJECT_ID,
        workPlanRef: plan.workPlanRef,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: workPlanAuthorization(fixture!, plan.workPlanRef),
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.workPlanReader.readExact({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        workPlanRef: plan.workPlanRef,
        authorization: workPlanAuthorization(fixture!, plan.workPlanRef),
      }),
    ).toEqual({
      kind: "failed",
      code: "IDENTIFICATION_WORK_PLAN_DRIFT",
      detailCode: "work-plan-read-unavailable",
    });
  }, 90_000);

  it("reconciles checkpoint references without backfilling any business fact", async () => {
    const kit = referenceKitFor("reconcile");
    const plan = await registerPlanFixture(fixture!, "reconcile");
    const stageArtifactRef = await putBodyAs(fixture!, {
      artifactId: "c24-body-stage-reconcile",
      body: stageResultI5Body(kit),
    });
    const resultArtifactRef = await putBodyAs(fixture!, {
      artifactId: "c24-body-run-result-reconcile",
      body: runResultBody(kit),
    });
    await registerThroughTransaction(
      fixture!,
      [
        stageRowFor(kit, stageArtifactRef),
        runResultRowFor(kit, resultArtifactRef),
        resultRowFor("waiting", "reconcile"),
        resultRowFor("workflow-error", "reconcile"),
      ],
      "first",
    );

    const stageAuthorization = fixture!.access.issue({
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "stage-result",
        projectId: PROJECT_ID,
        targetId: `${kit.stageResultRef.reference.entityId}@${kit.stageResultRef.reference.versionId}`,
      }),
      branch: "risk-identification.plan",
      capability: "risk-identification.run",
    }).authorization;
    expect(
      await fixture!.adapter.readStageResultBody({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        stageResultRef: kit.stageResultRef,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: stageAuthorization,
      }),
    ).toEqual(stageResultI5Body(kit).stageResult);
    expect(
      await fixture!.adapter.readStageResultBody({
        projectId: PROJECT_ID,
        runId: OTHER_RUN_ID,
        stageResultRef: kit.stageResultRef,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: stageAuthorization,
      }),
    ).toBeUndefined();

    const before = await countRows(fixture!, { projectId: PROJECT_ID });
    // 等待态：等待引用与错误引用都必须能在本次运行内证明。
    const consistent = await fixture!.adapter.reconcileCheckpointReferences({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      state: graphState(kit, {
        status: "waiting",
        waitingRef: WAITING_REF,
        workPlanRef: kit.workPlanRef,
        inputSnapshotRef: kit.inputSnapshotRef,
        lastStageResultRef: kit.stageResultRef,
        lastErrorRef: WORKFLOW_ERROR_REF,
        failedWorkItemRefs: [],
      }),
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: reconcileAuthorization(fixture!),
    });
    expect(consistent).toEqual({
      kind: "consistent",
      workPlan: {
        workPlanRef: kit.workPlanRef,
        inputSnapshotRef: kit.inputSnapshotRef,
        inputSnapshot: inputSnapshot(),
        workItems: [
          {
            workItemRef: kit.workItemRef,
            nodeId: "node-1",
            spatialScopeRefs: [...SCOPES],
            sourceVersionRefs: [WORK_ITEM_SOURCE_VERSION_REF],
            frozenQueryText: FROZEN_QUERY_TEXT,
          },
        ],
        validatedCandidateSetRefs: [kit.validatedCandidateSetRef],
      },
    });

    // 终态：I9 运行汇总引用同样必须能被当前授权精确回读。
    expect(
      await fixture!.adapter.reconcileCheckpointReferences({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        state: graphState(kit, {
          status: "completed",
          stage: "I9",
          resultRef: kit.runResultRef,
          workPlanRef: kit.workPlanRef,
          inputSnapshotRef: kit.inputSnapshotRef,
        }),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: reconcileAuthorization(fixture!),
      }),
    ).toMatchObject({ kind: "consistent" });

    // 有效工作计划不能让其它 checkpoint 引用绕过逐项对账。
    const forgedReferences = [
      {
        state: graphState(kit, {
          workPlanRef: kit.workPlanRef,
          lastStageResultRef: refOf("stage-result", "stage-result:forged"),
        }),
        detailCode: "stage-result-reference-missing",
      },
      {
        state: graphState(kit, {
          workPlanRef: kit.workPlanRef,
          lastErrorRef: refOf("workflow-error", "workflow-error:forged"),
        }),
        detailCode: "workflow-error-reference-missing",
      },
      {
        state: graphState(kit, {
          status: "waiting",
          workPlanRef: kit.workPlanRef,
          waitingRef: {
            kind: "knowledge-preparation",
            knowledgePreparationTaskRef: refOf(
              "knowledge-preparation-task",
              "knowledge-preparation-task:forged",
            ),
          },
        }),
        detailCode: "waiting-reference-missing",
      },
      {
        state: graphState(kit, {
          status: "completed",
          stage: "I9",
          workPlanRef: kit.workPlanRef,
          resultRef: refOf("identification-run-result", "identification-run-result:forged"),
        }),
        detailCode: "run-result-reference-missing",
      },
    ];
    for (const { state, detailCode } of forgedReferences) {
      expect(
        await fixture!.adapter.reconcileCheckpointReferences({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          state,
          actorId: ACTOR_ID,
          requestedAt: TIMESTAMP,
          authorization: reconcileAuthorization(fixture!),
        }),
      ).toEqual({ kind: "inconsistent", detailCode });
    }

    // 计划内工作项缺失：状态引用了不属于本工作计划的工作项。
    expect(
      await fixture!.adapter.reconcileCheckpointReferences({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        state: graphState(kit, {
          workPlanRef: kit.workPlanRef,
          failedWorkItemRefs: [kit.absentWorkItemRef],
        }),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: reconcileAuthorization(fixture!),
      }),
    ).toEqual({ kind: "inconsistent", detailCode: "work-item-reference-missing" });

    // 缺失引用：状态指向从未登记的版本。
    expect(
      await fixture!.adapter.reconcileCheckpointReferences({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        state: graphState(kit, {
          workPlanRef: refOf("identification-work-plan", "identification-work-plan:forged"),
        }),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: reconcileAuthorization(fixture!),
      }),
    ).toEqual({ kind: "inconsistent", detailCode: "work-plan-reference-missing" });

    // 伪引用：登记行的判别列与正文指向不同工作计划，正文核对必须拒绝。
    const forgedPlanRef = refOf(
      "identification-work-plan",
      "identification-work-plan:forged-body",
      sha("forged-body"),
    );
    await registerThroughTransaction(
      fixture!,
      [planRowFor({ ...kit, suffix: "forged", workPlanRef: forgedPlanRef }, plan.planArtifactRef)],
      "forged",
    );
    expect(
      await fixture!.adapter.reconcileCheckpointReferences({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        state: graphState(kit, { workPlanRef: forgedPlanRef }),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: reconcileAuthorization(fixture!),
      }),
    ).toEqual({ kind: "inconsistent", detailCode: "work-plan-reference-mismatch" });

    // 跨运行与跨工程身份都不能借本运行的登记行通过。
    expect(
      await fixture!.adapter.reconcileCheckpointReferences({
        projectId: PROJECT_ID,
        runId: OTHER_RUN_ID,
        state: graphState(kit, { workPlanRef: kit.workPlanRef }),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: reconcileAuthorization(fixture!, OTHER_RUN_ID),
      }),
    ).toEqual({ kind: "inconsistent", detailCode: "run-reference-mismatch" });
    expect(
      await fixture!.adapter.reconcileCheckpointReferences({
        projectId: OTHER_PROJECT_ID,
        runId: RUN_ID,
        state: graphState(kit, { workPlanRef: kit.workPlanRef }),
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: reconcileAuthorization(fixture!, RUN_ID, OTHER_PROJECT_ID),
      }),
    ).toEqual({ kind: "inconsistent", detailCode: "work-plan-reference-missing" });

    // 对账全过程零补写：除伪造用例新增一行外，登记行数量与内容都不变。
    expect(await countRows(fixture!, { projectId: PROJECT_ID })).toBe(before + 1);
  }, 120_000);
});
