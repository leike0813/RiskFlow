/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 评估子图运行时行为验证（IP-05/IP-06，implementation-plan §6：R1/S1～S3、R3/S1、R3/S3，
 * 以及运行时自有契约：start 幂等、resume/对账、取消收口、失败分类）：
 * 真实 Testcontainers PostgreSQL + 完整生产迁移链 + 真实 C03 事务单元 / C04 内容寻址工件存储 /
 * 真实 LangGraph PostgreSQL checkpointer；只有 C11/C17/C18/C19/C25～C29/C08 公开端口与 C05 复验用
 * 可控替身注入，替身只返回闭合结果，不读任何私表、不复制领域算法。
 *
 * 断言只针对调用方可见契约：登记行、运行状态与版本、运行汇总正文、链边、稳定错误码与幂等，
 * 不断言私有实现、提示词或文案全文。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentEvaluationSuccessV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AuthorizationContextV1Schema,
  ModuleErrorV1Schema,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WorkflowRunRefV1Schema,
  type AssessmentBasisReleaseSetRefV1,
  type AssessmentEvaluationCommandV1,
  type AssessmentPreparationCommandV1,
  type ApplicabilityMetadataSnapshotRefV1,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type EngineeringDataPortV1,
  type EngineeringFreezeCommandV1,
  type KnowledgeModelingPortV1,
  type KnowledgeResolutionCommandV1,
  type ModuleBranchV1,
  type MonitoringSnapshotRefV1,
  type OpenWarningCommandV1,
  type ProjectRevisionRefV1,
  type RiskAssessmentPortV1,
  type StandardizedRiskRecordRefV1,
  type WorkflowEntryModeV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  AssessmentGraphStateV1Schema,
  type AssessmentGraphStateV1,
} from "@riskflow/contracts/workflows";
import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import { ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1 } from "@riskflow/core/assessment-config";
import type { CalibrationServiceV1 } from "@riskflow/core/calibration";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import type { RecommendationServiceV1 } from "@riskflow/core/recommendation";
import type { ResponseLifecycleServiceV1 } from "@riskflow/core/response-lifecycle";
import type { AssessmentRuntimePolicySetProviderV1 } from "@riskflow/core/risk-assessment/engine";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
  type ReadAssessmentBasisReleaseSetV1,
} from "@riskflow/core/scoring-rules";
import type { WarningLifecycleServiceV1 } from "@riskflow/core/warning";
import {
  WorkflowGraphRunResultV1Schema,
  assessmentSubRunIdentityFor,
  segmentedAssessmentSubRunIdentityFor,
  workflowEntryIdentityFor,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunCommandV1,
  type WorkflowGraphRunResultV1,
  type WorkflowGraphRunStateV1,
} from "@riskflow/core/workflow";

import {
  createArtifactStore,
  type ContentAddressedArtifactStoreHandleV1,
} from "@riskflow/adapters/artifacts";
import {
  createPostgresTransactionUnit,
  runPostgresMigrations,
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
} from "@riskflow/adapters/postgres";

import {
  createPostgresRuntime,
  type PostgresRuntime,
} from "../../../../packages/adapters/test/identification/graph/wiring.js";
import {
  startPostgresFixture,
  type PostgresTestFixture,
} from "../../../../packages/adapters/test/postgres/fixture.js";
import {
  AssessmentGraphRunErrorV1,
  createAssessmentGraphComposition,
  type AssessmentGraphCalibrationAgentPortV1,
  type AssessmentGraphCompositionV1,
  type AssessmentGraphPolicyCatalogV1,
  type AssessmentGraphRecommendationAgentPortV1,
  type AssessmentGraphRunnerV1,
  type AssessmentGraphRuntimeV1,
  type AssessmentRunOutcomeV1,
} from "../../src/assessment/index.js";

const PROJECT_ID = "project-c30-assessment";
const ACTOR_ID = "actor-c30-assessment";
const TIMESTAMP = "2030-03-01T00:00:00.000Z";

const digest = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const versionRef = (entityId: string, versionId = "1"): VersionReference => ({
  entityId,
  versionId,
});

/** 严格 Schema 解析的精确引用：夹具与公共契约同名，不另造引用形状。 */
const parseRef = <T>(
  schema: { parse: (value: unknown) => T },
  kind: ContractReferenceV1["kind"],
  entityId: string,
  versionId = "1",
): T => schema.parse({ kind, reference: versionRef(entityId, versionId) });

const SPATIAL_SCOPE_REF = parseRef(
  SpatialScopeRefV1Schema,
  "spatial-scope",
  `spatial-scope:${PROJECT_ID}`,
);
const AUTHORIZATION = AuthorizationContextV1Schema.parse({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: versionRef(
      `authorization-context:${PROJECT_ID}`,
      digest("authorization-context-v1"),
    ),
  },
  actorId: ACTOR_ID,
  projectId: PROJECT_ID,
  grantedCapabilities: ["workflow.start"],
  spatialScopeRefs: [SPATIAL_SCOPE_REF],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: versionRef("authorization-policy", "1"),
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});
const PARENT_RUN_REF = parseRef(
  WorkflowRunRefV1Schema,
  "workflow-run",
  `risk-flow-run:${PROJECT_ID}:assess`,
  digest("parent-run-v1"),
);
const GRAPH_VERSION = versionRef("assessment-graph", "1");
const RETRY_POLICY_REF = versionRef("retry-policy", "1");

/** C05 复验替身：只按签发身份放行，撤销后一律拒绝，并记录每次复验请求。 */
const createAccess = () => {
  const calls: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  let revoked = false;
  return {
    port: {
      verify: async (input) => {
        calls.push({ invocationId: input.invocationId, branch: input.branch });
        if (revoked) {
          throw new AccessServiceError({
            code: "AUTHORIZATION_DENIED",
            retryable: false,
            stage: "c30-assessment-test-verify",
            occurredAt: TIMESTAMP,
            diagnosticRef: {
              kind: "diagnostic-artifact",
              reference: versionRef("c30-assessment-diagnostic"),
            },
            contextRefs: [],
            requiredCapability: "workflow.start",
            authorizationPolicyRef: versionRef("authorization-policy"),
          });
        }
        return {
          context: { ...AUTHORIZATION, authorizationContextRef: input.authorizationContextRef },
          contextRef: input.authorizationContextRef,
          redacted: false,
        };
      },
    } satisfies Pick<LocalIdentityAccessV1, "verify">,
    runtimeAuthorization: {
      verifyCurrent: async (input: { readonly authorization: AuthorizationContextV1 }) => {
        if (revoked) return undefined;
        return AuthorizationContextV1Schema.safeParse(input.authorization).success
          ? AUTHORIZATION
          : undefined;
      },
    },
    calls,
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
  };
};

/** C19 依据集合成员：十一类配置成员按规范序覆盖，度量库成员供 A7 解析精确释放引用。 */
const basisMembersV1 = () => {
  const member = (name: string) => ({
    releaseRef: { kind: "knowledge-release" as const, reference: versionRef(`release-${name}`) },
    revisionRef: { kind: "knowledge-revision" as const, reference: versionRef(`revision-${name}`) },
    artifactRef: { kind: "content-artifact" as const, reference: versionRef(`artifact-${name}`) },
    contentDigest: digest(`content-${name}`),
  });
  return {
    applicableRuleSetMember: member("applicable-rule-set"),
    scoringRuleMembers: [member("rule-a")],
    configurationMembers: [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1]
      .sort()
      .map((definitionType) => ({ definitionType, ...member(definitionType) })),
  };
};

const diagnosticRef = (name: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: versionRef(`${name}-diagnostic`),
});

const transientFailure = (stageCode: string) =>
  ModuleErrorV1Schema.parse({
    code: "TRANSIENT_FAILURE",
    category: "technical",
    retryable: true,
    stageCode,
    occurredAt: TIMESTAMP,
    causalRunId: PARENT_RUN_REF.reference.entityId,
    attempt: 1,
    retryPolicyRef: RETRY_POLICY_REF,
    diagnosticRef: diagnosticRef(stageCode),
  });

const businessBlockedFailure = (stageCode: string, blockerRef: ContractReferenceV1) =>
  ModuleErrorV1Schema.parse({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    stageCode,
    occurredAt: TIMESTAMP,
    causalRunId: PARENT_RUN_REF.reference.entityId,
    blockerKind: "insufficient-basis",
    blockerRef,
  });

/**
 * 端口行为开关：用例通过 `world` 声明本轮替身返回哪种闭合结果，并断言图只按冻结引用调用端口。
 * `calls` 记录每次调用，用于证明“未发生的动作没有被执行”。
 */
interface AssessmentWorldV1 {
  readonly clock: { current: Date };
  prepareOutcome: "succeeded" | "waiting" | "business-blocked";
  evaluateOutcome: "succeeded" | "transient";
  basisResolution: "succeeded" | "unavailable";
  readonly calls: {
    readonly freeze: EngineeringFreezeCommandV1[];
    readonly basisResolve: KnowledgeResolutionCommandV1[];
    readonly basisRead: ReadAssessmentBasisReleaseSetV1[];
    readonly policyRead: unknown[];
    readonly prepare: AssessmentPreparationCommandV1[];
    readonly evaluate: AssessmentEvaluationCommandV1[];
    readonly warningOpen: OpenWarningCommandV1[];
  };
}

const createWorld = (): AssessmentWorldV1 => ({
  clock: { current: new Date(TIMESTAMP) },
  prepareOutcome: "succeeded",
  evaluateOutcome: "succeeded",
  basisResolution: "succeeded",
  calls: {
    freeze: [],
    basisResolve: [],
    basisRead: [],
    policyRead: [],
    prepare: [],
    evaluate: [],
    warningOpen: [],
  },
});

/** 本轮不应发生的动作：一旦被调用，用例立即失败（缺席链尾不得靠调用下游端口伪造成立）。 */
const forbidden = (name: string) => async (): Promise<never> => {
  throw new TypeError(`${name} must not be called by this run`);
};

interface AssessmentPortDoublesV1 {
  readonly engineeringData: Pick<EngineeringDataPortV1, "freeze">;
  readonly basis: AssessmentBasisReleaseSetReaderV1;
  readonly basisResolver: Pick<KnowledgeModelingPortV1, "resolve">;
  readonly runtimePolicies: AssessmentRuntimePolicySetProviderV1;
  readonly riskAssessment: RiskAssessmentPortV1;
  readonly warning: Pick<WarningLifecycleServiceV1, "open">;
  readonly recommendation: Pick<
    RecommendationServiceV1,
    "measureCandidates" | "createCandidate" | "validateAndRecord"
  >;
  readonly recommendationAgent: AssessmentGraphRecommendationAgentPortV1;
  readonly responseLifecycle: Pick<
    ResponseLifecycleServiceV1,
    "forecastResponse" | "calculateDeviation"
  >;
  readonly calibration: Pick<CalibrationServiceV1, "prepareInput" | "createSuggestion">;
  readonly calibrationAgent: AssessmentGraphCalibrationAgentPortV1;
  readonly policies: AssessmentGraphPolicyCatalogV1;
}

const createPortDoubles = (world: AssessmentWorldV1): AssessmentPortDoublesV1 => ({
  engineeringData: {
    freeze: async (command) => {
      world.calls.freeze.push(command);
      if (command.kind !== "assessment-preparation") {
        throw new TypeError("the assessment graph only freezes an assessment preparation");
      }
      const payload = command.payload;
      return {
        kind: "succeeded",
        result: {
          kind: "assessment-preparation",
          assessmentPreparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema.parse({
            kind: "assessment-preparation-snapshot",
            reference: versionRef(
              `assessment-preparation:${payload.riskInput.reference.entityId}`,
              sha256CanonicalJson(payload),
            ),
          }),
        },
      };
    },
  },
  basis: {
    readAssessmentBasisReleaseSet: async (input) => {
      world.calls.basisRead.push(input);
      return AssessmentBasisReleaseSetReadResultV1Schema.parse({
        kind: "succeeded",
        schemaVersion: "1",
        assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
        memberDigest: digest("basis-members"),
        ...basisMembersV1(),
      });
    },
  },
  basisResolver: {
    resolve: async (command) => {
      world.calls.basisResolve.push(command);
      if (command.kind !== "assessment-basis") {
        throw new TypeError("the assessment graph only resolves the assessment basis");
      }
      if (world.basisResolution === "unavailable") {
        return { kind: "failed", error: transientFailure("c17-resolve") };
      }
      const payload = command.payload;
      return {
        kind: "succeeded",
        result: {
          kind: "assessment-basis",
          assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema.parse({
            kind: "assessment-basis-release-set",
            reference: versionRef(
              `assessment-basis:${payload.preparationSnapshotRef.reference.entityId}`,
              sha256CanonicalJson({
                preparationSnapshotRef: payload.preparationSnapshotRef,
                requiredAt: payload.requiredAt,
              }),
            ),
          }),
        },
      };
    },
  },
  runtimePolicies: {
    readRuntimePolicySet: async (input) => {
      world.calls.policyRead.push(input);
      return {
        kind: "succeeded",
        policySet: {
          schemaVersion: "1",
          projectId: PROJECT_ID,
          warningAggregationPolicyRef: versionRef("warning-aggregation-policy"),
          notificationPolicyRef: versionRef("notification-policy"),
          responseGenerationPolicyRef: versionRef("response-generation-policy"),
          responseValidationPolicyRef: versionRef("response-validation-policy"),
          responseAgentPolicyRef: versionRef("response-agent-policy"),
          calibrationAgentPolicyRef: versionRef("calibration-agent-policy"),
          retryPolicyRef: RETRY_POLICY_REF,
          reviewPolicyRef: versionRef("review-policy"),
          modelDeploymentRef: versionRef("model-deployment"),
          promptTemplateRef: versionRef("prompt-template"),
        },
      };
    },
  },
  riskAssessment: {
    prepare: async (command) => {
      world.calls.prepare.push(command);
      const { preparationSnapshotRef } = command.payload;
      if (world.prepareOutcome === "business-blocked") {
        return {
          kind: "failed",
          error: businessBlockedFailure("c25-prepare", SPATIAL_SCOPE_REF),
        };
      }
      if (world.prepareOutcome === "waiting") {
        return {
          kind: "waiting",
          waiting: {
            kind: "user-confirmation",
            userConfirmationRef: {
              kind: "user-confirmation",
              reference: versionRef(`confirmation:${preparationSnapshotRef.reference.entityId}`),
            },
          },
        };
      }
      return {
        kind: "succeeded",
        result: {
          assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema.parse({
            kind: "assessment-input-snapshot",
            reference: versionRef(
              `assessment-input:${sha256CanonicalJson(command.payload).slice(0, 32)}`,
              digest(`assessment-input:${preparationSnapshotRef.reference.versionId}`),
            ),
          }),
        },
      };
    },
    evaluate: async (command) => {
      world.calls.evaluate.push(command);
      if (world.evaluateOutcome === "transient") {
        return { kind: "failed", error: transientFailure("c25-evaluate") };
      }
      const versionId = sha256CanonicalJson(command.payload);
      return {
        kind: "succeeded",
        result: AssessmentEvaluationSuccessV1Schema.parse({
          indicatorActualValueSetRef: {
            kind: "indicator-actual-value-set",
            reference: versionRef(`values:${versionId.slice(0, 16)}`),
          },
          assessmentDecisionArtifactRef: {
            kind: "assessment-decision-artifact",
            reference: versionRef(`decision:${versionId.slice(0, 16)}`),
          },
          assessmentRecordRef: RiskAssessmentRecordRefV1Schema.parse({
            kind: "risk-assessment-record",
            reference: versionRef(`assessment-record:${versionId.slice(0, 16)}`, versionId),
          }),
        }),
      };
    },
  },
  warning: {
    open: async (command) => {
      world.calls.warningOpen.push(command);
      return {
        kind: "succeeded",
        result: { warningRecordRefs: [], warningResponseTaskRefs: [], notificationIntentRefs: [] },
      };
    },
  },
  recommendation: {
    measureCandidates: forbidden("C27 measureCandidates"),
    createCandidate: forbidden("C27 createCandidate"),
    validateAndRecord: forbidden("C27 validateAndRecord"),
  },
  recommendationAgent: {
    resolveSiteContextRef: forbidden("C27 agent resolveSiteContextRef"),
    ensureTask: forbidden("C27 agent ensureTask"),
  },
  responseLifecycle: {
    forecastResponse: forbidden("C28 forecastResponse"),
    calculateDeviation: forbidden("C28 calculateDeviation"),
  },
  calibration: {
    prepareInput: forbidden("C29 prepareInput"),
    createSuggestion: forbidden("C29 createSuggestion"),
  },
  calibrationAgent: {
    ensureTask: forbidden("C29 agent ensureTask"),
  },
  policies: {
    resolveForecastPolicy: forbidden("forecast policy resolution"),
    resolveCalibrationPolicy: forbidden("calibration policy resolution"),
  },
});

const artifactPolicy = (): ArtifactStorePolicyV1 => ({
  schemaVersion: "1",
  policyRef: versionRef("artifact-policy"),
  maxArtifactBytes: 512 * 1024 * 1024,
  maxConcurrentWrites: 4,
  maxConcurrentReads: 4,
  stagingMaxBytes: 768 * 1024 * 1024,
  orphanGracePeriodMs: 10_000,
  registrationTimeoutMs: 1_000,
  maintenanceBatchSize: 250,
});

interface RunScopeV1 {
  readonly runRef: WorkflowRunRefV1;
  readonly threadId: string;
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly parentRunRef: WorkflowRunRefV1;
}

interface AssessmentGraphHarnessV1 {
  readonly postgres: PostgresTestFixture;
  readonly app: PostgresRuntime;
  readonly world: AssessmentWorldV1;
  readonly access: ReturnType<typeof createAccess>;
  readonly composition: AssessmentGraphCompositionV1;
  readonly runtime: AssessmentGraphRuntimeV1;
  readonly graph: AssessmentGraphRunnerV1;
  scope(input: {
    readonly entryMode: WorkflowEntryModeV1;
    readonly frozenRefs: readonly ContractReferenceV1[];
    readonly riskRecordRef?: StandardizedRiskRecordRefV1;
  }): RunScopeV1;
  startCommand(input: {
    readonly scope: RunScopeV1;
    readonly entryMode: WorkflowEntryModeV1;
    readonly overrides?: Partial<WorkflowGraphRunCommandV1>;
  }): WorkflowGraphRunCommandV1;
  rows(runRef: WorkflowRunRefV1): Promise<readonly WorkflowGraphResultRowV1[]>;
  links(runRef: WorkflowRunRefV1): Promise<readonly { readonly relation: string }[]>;
  latestState(
    runRef: WorkflowRunRefV1,
  ): Promise<
    { readonly row: WorkflowGraphResultRowV1; readonly state: WorkflowGraphRunStateV1 } | undefined
  >;
  runResultBody(runRef: WorkflowRunRefV1): Promise<WorkflowGraphRunResultV1>;
  checkpointState(threadId: string): Promise<AssessmentGraphStateV1>;
  checkpointConfig(threadId: string): LangGraphRunnableConfig;
  close(): Promise<void>;
}

/** 单容器夹具：整个文件共享一次完整生产迁移链与一次真实组合根构造。 */
const startHarness = async (): Promise<AssessmentGraphHarnessV1> => {
  const postgres = await startPostgresFixture();
  let rootDirectory: string | undefined;
  let artifactStore: ContentAddressedArtifactStoreHandleV1 | undefined;
  let transactionUnit: ReturnType<typeof createPostgresTransactionUnit> | undefined;
  let app: PostgresRuntime | undefined;
  let checkpointer: PostgresCheckpointer | undefined;
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-assessment-"));
    app = createPostgresRuntime(postgres.app, "riskflow_app");
    transactionUnit = createPostgresTransactionUnit(postgres.app);
    artifactStore = await createArtifactStore({
      ...postgres.app,
      rootDirectory,
      policy: artifactPolicy(),
    });
    checkpointer = await setupPostgresCheckpointer({
      ...postgres.checkpointer,
      validateReference: () => true,
    });
    const world = createWorld();
    const access = createAccess();
    const doubles = createPortDoubles(world);
    const composition = createAssessmentGraphComposition({
      db: app.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      runtimeAuthorization: access.runtimeAuthorization,
      checkpointer,
      ...doubles,
      now: () => world.clock.current,
    });
    const registrationStore = composition.registrationStore;
    const now = () => world.clock.current;
    const checkpointConfig = (threadId: string): LangGraphRunnableConfig => ({
      configurable: { thread_id: threadId },
    });
    return {
      postgres,
      app,
      world,
      access,
      composition,
      runtime: composition.runtime,
      graph: composition.graph,
      scope(input) {
        const entryIdentity = workflowEntryIdentityFor({
          entryMode: input.entryMode,
          projectId: PROJECT_ID,
          frozenRefs: input.frozenRefs,
        });
        // 每个用例的运行自带父运行身份：父运行身份由本次运行的入口身份唯一确定，不同运行因此
        // 落在不同 `runId` 分区，登记事实互不可见。（同一父运行下的兄弟子运行共享 `runId`
        // 分区，属 IP-02 身份议题，见交付说明中的残留项。）
        const parentRunRef = parseRef(
          WorkflowRunRefV1Schema,
          "workflow-run",
          `risk-flow-run:${PROJECT_ID}:${input.entryMode}:${entryIdentity.versionId.slice(0, 16)}`,
          entryIdentity.versionId,
        );
        const identity =
          input.riskRecordRef === undefined
            ? segmentedAssessmentSubRunIdentityFor({
                projectId: PROJECT_ID,
                parentRunRef,
                entryMode: input.entryMode,
                entryIdentity,
              })
            : assessmentSubRunIdentityFor({
                projectId: PROJECT_ID,
                parentRunRef,
                riskRecordRef: input.riskRecordRef,
              });
        return { ...identity, entryIdentity, frozenRefs: input.frozenRefs, parentRunRef };
      },
      startCommand(input) {
        const commandId = `c30-assessment-start:${input.scope.runRef.reference.versionId}`;
        return {
          projectId: PROJECT_ID,
          actorId: ACTOR_ID,
          authorization: AUTHORIZATION,
          commandId,
          idempotencyKey: commandId,
          issuedAt: now().toISOString(),
          validAt: now().toISOString(),
          graphVersion: GRAPH_VERSION,
          retryPolicyRef: RETRY_POLICY_REF,
          runRef: input.scope.runRef,
          threadId: input.scope.threadId,
          entryMode: input.entryMode,
          entryIdentity: input.scope.entryIdentity,
          frozenRefs: input.scope.frozenRefs,
          parentRunRef: input.scope.parentRunRef,
          ...input.overrides,
        };
      },
      async rows(runRef) {
        return await registrationStore.listRunRows({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
        });
      },
      async links(runRef) {
        return await registrationStore.listRunLinks({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
        });
      },
      async latestState(runRef) {
        return await registrationStore.readLatestRunState({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
          actorId: ACTOR_ID,
          requestedAt: now().toISOString(),
          authorization: AUTHORIZATION,
        });
      },
      async runResultBody(runRef) {
        const row = (
          await registrationStore.listRunRows({
            projectId: PROJECT_ID,
            runId: runRef.reference.entityId,
          })
        ).find((candidate) => candidate.resultKind === "run-result");
        if (row?.artifactRef === undefined) throw new TypeError("run-result body is missing");
        const body = await composition.adapter.bodies.readBody({
          projectId: PROJECT_ID,
          artifactRef: row.artifactRef,
          actorId: ACTOR_ID,
          requestedAt: now().toISOString(),
          authorization: AUTHORIZATION,
        });
        if (body === undefined || body.bodyKind !== "run-result") {
          throw new TypeError("run-result body is unreadable");
        }
        return WorkflowGraphRunResultV1Schema.parse(body.runResult);
      },
      async checkpointState(threadId) {
        const snapshot = await composition.graph.getState(checkpointConfig(threadId));
        const values = (snapshot as { readonly values?: unknown }).values;
        if (typeof values !== "object" || values === null) {
          throw new TypeError("checkpoint state is missing");
        }
        const declared = new Set(Object.keys(AssessmentGraphStateV1Schema.shape));
        const parsed = AssessmentGraphStateV1Schema.safeParse(
          Object.fromEntries(
            Object.entries(values as Record<string, unknown>).filter(([key]) => declared.has(key)),
          ),
        );
        if (!parsed.success) {
          throw new TypeError(
            `checkpoint state is not a valid assessment state: ${JSON.stringify(parsed.error.issues)}`,
          );
        }
        return parsed.data;
      },
      checkpointConfig,
      async close() {
        await checkpointer?.end().catch(() => undefined);
        await artifactStore?.close().catch(() => undefined);
        await transactionUnit?.close().catch(() => undefined);
        await app?.close().catch(() => undefined);
        if (rootDirectory !== undefined) {
          await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await checkpointer?.end().catch(() => undefined);
    await artifactStore?.close().catch(() => undefined);
    await transactionUnit?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    if (rootDirectory !== undefined) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

let harness: AssessmentGraphHarnessV1;

beforeAll(async () => {
  harness = await startHarness();
}, 300_000);

afterAll(async () => {
  await harness?.close();
});

/** 每轮用例重置端口行为开关与调用记录：本轮替身返回哪种闭合结果由用例自己声明。 */
const resetWorld = (
  input: Partial<
    Pick<AssessmentWorldV1, "prepareOutcome" | "evaluateOutcome" | "basisResolution">
  > = {},
) => {
  harness.world.prepareOutcome = input.prepareOutcome ?? "succeeded";
  harness.world.evaluateOutcome = input.evaluateOutcome ?? "succeeded";
  harness.world.basisResolution = input.basisResolution ?? "succeeded";
  for (const calls of Object.values(harness.world.calls)) calls.length = 0;
};

const failureOf = async (promise: Promise<unknown>): Promise<AssessmentGraphRunErrorV1> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AssessmentGraphRunErrorV1) return error;
    throw error;
  }
  throw new TypeError("expected the assessment run to fail");
};

const expectFailure = async (
  promise: Promise<unknown>,
  expected: { readonly code: string; readonly detailCode: string; readonly retryable: boolean },
): Promise<AssessmentGraphRunErrorV1> => {
  const error = await failureOf(promise);
  expect({
    code: error.code,
    detailCode: error.detailCode,
    retryable: error.retryable,
  }).toEqual(expected);
  return error;
};

/**
 * 入口门禁在阶段节点内失败：图按状态收口（不抛异常），只登记本运行的失败事实——失败原因是
 * 可观察的 `workflow-error` 行身份（阶段 + 稳定 detailCode），不重试即 `terminal-failure`。
 */
const expectEntryGateFailure = async (
  promise: Promise<AssessmentRunOutcomeV1>,
  expected: { readonly stage: string; readonly detailCode: string },
): Promise<AssessmentRunOutcomeV1> => {
  const outcome = await promise;
  expect({ status: outcome.status, stage: outcome.stage }).toEqual({
    status: "terminal-failure",
    stage: expected.stage,
  });
  expect(outcome.errorRef?.reference.entityId).toBe(
    `assessment-graph-workflow-error:${expected.stage}:${expected.detailCode}`,
  );
  expect(outcome.resultRef).toBeUndefined();
  return outcome;
};

/** 已登记的失败事实：按阶段与稳定原因核对，不复制实现内部的错误分类。 */
const failureFactsOf = async (runRef: WorkflowRunRefV1): Promise<readonly string[]> =>
  (await harness.rows(runRef))
    .filter((row) => row.resultKind === "workflow-error")
    .map((row) => `${row.stage ?? "?"}|${row.resultId}`);

interface EntryInputsV1 {
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1;
  readonly riskInput: StandardizedRiskRecordRefV1;
  readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
  readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1 | undefined;
  readonly frozenRefs: readonly ContractReferenceV1[];
}

/** 入口冻结输入：按用例 seed 派生精确引用，运行身份随之独立（同容器不共享登记事实）。 */
const entryInputsFor = (
  seed: string,
  options: {
    readonly basisVersionId?: string;
    readonly monitoringCount?: number;
    readonly extraRefs?: readonly ContractReferenceV1[];
  } = {},
): EntryInputsV1 => {
  const projectRevisionRef = parseRef(
    ProjectRevisionRefV1Schema,
    "project-revision",
    `project-revision:${PROJECT_ID}`,
    seed,
  );
  const applicabilityMetadataSnapshotRef = parseRef(
    ApplicabilityMetadataSnapshotRefV1Schema,
    "applicability-metadata-snapshot",
    `applicability:${PROJECT_ID}`,
    seed,
  );
  const riskInput = parseRef(
    StandardizedRiskRecordRefV1Schema,
    "standardized-risk-record",
    `risk-record:${PROJECT_ID}`,
    seed,
  );
  const monitoringSnapshotRefs = Array.from(
    { length: options.monitoringCount ?? 1 },
    (_value, index) =>
      parseRef(
        MonitoringSnapshotRefV1Schema,
        "monitoring-snapshot",
        `monitoring:${PROJECT_ID}:${seed}:${index}`,
      ),
  );
  const basisReleaseSetRef =
    options.basisVersionId === undefined
      ? undefined
      : parseRef(
          AssessmentBasisReleaseSetRefV1Schema,
          "assessment-basis-release-set",
          `assessment-basis:${PROJECT_ID}`,
          options.basisVersionId,
        );
  return {
    projectRevisionRef,
    applicabilityMetadataSnapshotRef,
    riskInput,
    monitoringSnapshotRefs,
    basisReleaseSetRef,
    frozenRefs: [
      projectRevisionRef,
      SPATIAL_SCOPE_REF,
      applicabilityMetadataSnapshotRef,
      riskInput,
      ...monitoringSnapshotRefs,
      ...(basisReleaseSetRef === undefined ? [] : [basisReleaseSetRef]),
      ...(options.extraRefs ?? []),
    ],
  };
};

/** 第 N 次冻结命令的载荷：只有评估准备冻结，形状不符即是夹具本身写错。 */
const monitoringInputOf = (index: number) => {
  const command = harness.world.calls.freeze[index];
  if (command?.kind !== "assessment-preparation") {
    throw new TypeError(`freeze #${index} must be an assessment preparation`);
  }
  return command.payload;
};

/** 分段入口启动命令：冻结引用、风险输入与监测集合都来自调用方显式入口。 */
const startSegmented = async (
  inputs: EntryInputsV1,
  entryMode: Extract<WorkflowEntryModeV1, "assess" | "reassess" | "historical-backfill">,
  overrides: Partial<WorkflowGraphRunCommandV1> = {},
): Promise<AssessmentRunOutcomeV1> => {
  const scope = harness.scope({
    entryMode,
    frozenRefs: inputs.frozenRefs,
    riskRecordRef: inputs.riskInput,
  });
  const outcome = await harness.runtime.start(
    harness.startCommand({
      scope,
      entryMode,
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
        acceptedRiskRecordRef: inputs.riskInput,
        ...overrides,
      },
    }),
  );
  return outcome;
};

const stageResultStages = (
  rows: readonly WorkflowGraphResultRowV1[],
): readonly (string | undefined)[] =>
  rows.filter((row) => row.resultKind === "stage-result").map((row) => row.stage);

describe("C30 评估子图运行时（真实 PostgreSQL + 真实 LangGraph）", () => {
  it("R1/S1 历史完整输入：historical-backfill 只用冻结的历史依据引用，登记新的评估记录", async () => {
    resetWorld();
    const inputs = entryInputsFor("r1s1", { basisVersionId: "historical-3" });
    const outcome = await startSegmented(inputs, "historical-backfill");

    expect(outcome.disposition).toBe("created");
    expect(outcome.status).toBe("completed");
    expect(outcome.stage).toBe("A9");
    expect(outcome.assessmentRunRefs).toEqual([]);

    // C11 冻结命令只携带历史入口的显式引用：历史修订、历史依据与显式监控集合。
    const freezeCommand = harness.world.calls.freeze[0];
    if (freezeCommand?.kind !== "assessment-preparation") {
      throw new TypeError("the run must freeze exactly one assessment preparation");
    }
    expect(freezeCommand.payload.projectRevisionRef).toEqual(inputs.projectRevisionRef);
    expect(freezeCommand.payload.spatialScopeRef).toEqual(SPATIAL_SCOPE_REF);
    expect(freezeCommand.payload.entryMode).toBe("historical-backfill");
    expect(monitoringInputOf(0).monitoringSnapshotRefs).toEqual(inputs.monitoringSnapshotRefs);

    // 冻结的历史依据引用直接交给 C19 读取，不走依据解析（那是无冻结引用入口的路径）。
    expect(harness.world.calls.basisResolve).toEqual([]);
    expect(harness.world.calls.basisRead).toHaveLength(1);
    expect(harness.world.calls.basisRead[0]?.assessmentBasisReleaseSetRef).toEqual(
      inputs.basisReleaseSetRef,
    );

    // C25 `historical-backfill`：effectiveAt 取命令业务时刻，输入是冻结的准备快照与历史依据。
    const prepareCommand = harness.world.calls.prepare[0];
    if (prepareCommand?.kind !== "historical-backfill") {
      throw new TypeError("the historical backfill entry must prepare a historical assessment");
    }
    expect(prepareCommand.payload.effectiveAt).toBe(TIMESTAMP);
    expect(prepareCommand.payload.assessmentBasisReleaseSetRef).toEqual(inputs.basisReleaseSetRef);

    // 新评估记录以已提交事实登记：游标、运行汇总与运行状态指向同一精确引用。
    const latest = await harness.latestState(outcome.runRef);
    expect(latest?.state.status).toBe("completed");
    expect(latest?.state.assessmentRecordRefs).toHaveLength(1);
    const runResult = await harness.runResultBody(outcome.runRef);
    expect(runResult.assessmentRecordRefs).toEqual(latest?.state.assessmentRecordRefs);
    const rows = await harness.rows(outcome.runRef);
    const runResultRow = rows.filter((row) => row.resultKind === "run-result");
    expect(runResultRow).toHaveLength(1);
    expect(runResultRow[0]?.runResultRef).toEqual(outcome.resultRef);
    expect(stageResultStages(rows)).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A9"]);
  });

  it("R1/S2 单/多序列：监测输入逐项冻结，同一父运行下的兄弟子运行彼此独立", async () => {
    resetWorld();
    const single = entryInputsFor("r1s2-single", { monitoringCount: 1 });
    const singleOutcome = await startSegmented(single, "assess");
    expect(singleOutcome.status).toBe("completed");
    expect(monitoringInputOf(0).monitoringSnapshotRefs).toEqual(single.monitoringSnapshotRefs);

    const multiple = entryInputsFor("r1s2-multiple", { monitoringCount: 3 });
    const multipleOutcome = await startSegmented(multiple, "assess");
    expect(multipleOutcome.status).toBe("completed");
    // 多序列逐项冻结：顺序与数量都不做归纳或“代表项”替换。
    expect(monitoringInputOf(1).monitoringSnapshotRefs).toEqual(multiple.monitoringSnapshotRefs);
    expect(multiple.monitoringSnapshotRefs).toHaveLength(3);

    // 两次运行各自登记自己的阶段事实，互不重放、互不继承。
    expect(singleOutcome.runRef.reference.entityId).not.toBe(
      multipleOutcome.runRef.reference.entityId,
    );
    expect(stageResultStages(await harness.rows(singleOutcome.runRef))).toEqual([
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A9",
    ]);
    expect(stageResultStages(await harness.rows(multipleOutcome.runRef))).toEqual([
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A9",
    ]);
    expect(harness.world.calls.prepare).toHaveLength(2);

    // 重复监测引用：等价单项才允许，重复即冲突。门禁在阶段节点内失败，运行如实登记失败原因，
    // 但不创建正式评估准备、不产生任何阶段成功事实。
    const duplicated = entryInputsFor("r1s2-duplicate", { monitoringCount: 1 });
    const duplicatedMonitoring = [
      duplicated.monitoringSnapshotRefs[0]!,
      duplicated.monitoringSnapshotRefs[0]!,
    ];
    const duplicatedScope = harness.scope({
      entryMode: "assess",
      frozenRefs: [...duplicated.frozenRefs, duplicated.monitoringSnapshotRefs[0]!],
      riskRecordRef: duplicated.riskInput,
    });
    const freezeCount = harness.world.calls.freeze.length;
    const duplicatedOutcome = await expectEntryGateFailure(
      harness.runtime.start(
        harness.startCommand({
          scope: duplicatedScope,
          entryMode: "assess",
          overrides: {
            spatialScopeRef: SPATIAL_SCOPE_REF,
            applicabilityMetadataSnapshotRef: duplicated.applicabilityMetadataSnapshotRef,
            monitoringSnapshotRefs: duplicatedMonitoring,
            acceptedRiskRecordRef: duplicated.riskInput,
          },
        }),
      ),
      { stage: "A0", detailCode: "monitoring-input" },
    );
    expect(harness.world.calls.freeze).toHaveLength(freezeCount);
    expect(duplicatedOutcome.assessmentRunRefs).toEqual([]);
    expect(await harness.links(duplicatedScope.runRef)).toEqual([]);
    expect(stageResultStages(await harness.rows(duplicatedScope.runRef))).toEqual([]);
    expect(await failureFactsOf(duplicatedScope.runRef)).toEqual([
      "A0|assessment-graph-workflow-error:A0:monitoring-input",
    ]);
  });

  it("R1/S3 缺失与错配：缺修订、重复单值引用在副作用前失败；授权撤销同形拒绝且零补写", async () => {
    resetWorld();
    // 缺工程修订冻结引用：入口门禁在 C11 冻结与任何登记之前失败。
    const missing = entryInputsFor("r1s3-missing");
    const missingRefs = missing.frozenRefs.filter((ref) => ref.kind !== "project-revision");
    const missingScope = harness.scope({
      entryMode: "assess",
      frozenRefs: missingRefs,
      riskRecordRef: missing.riskInput,
    });
    await expectEntryGateFailure(
      harness.runtime.start(
        harness.startCommand({
          scope: missingScope,
          entryMode: "assess",
          overrides: {
            spatialScopeRef: SPATIAL_SCOPE_REF,
            applicabilityMetadataSnapshotRef: missing.applicabilityMetadataSnapshotRef,
            monitoringSnapshotRefs: missing.monitoringSnapshotRefs,
            acceptedRiskRecordRef: missing.riskInput,
          },
        }),
      ),
      { stage: "A0", detailCode: "project-revision-missing" },
    );
    expect(harness.world.calls.freeze).toEqual([]);
    expect(stageResultStages(await harness.rows(missingScope.runRef))).toEqual([]);
    expect(await failureFactsOf(missingScope.runRef)).toEqual([
      "A0|assessment-graph-workflow-error:A0:project-revision-missing",
    ]);
    expect(await harness.links(missingScope.runRef)).toEqual([]);

    // 重复单值冻结引用（同一空间两个适用性元数据快照）：契约冲突，不猜“哪一个”。
    const duplicated = entryInputsFor("r1s3-duplicate", {
      extraRefs: [
        parseRef(
          ApplicabilityMetadataSnapshotRefV1Schema,
          "applicability-metadata-snapshot",
          `applicability:${PROJECT_ID}`,
          "second",
        ),
      ],
    });
    const duplicatedScope = harness.scope({
      entryMode: "assess",
      frozenRefs: duplicated.frozenRefs,
      riskRecordRef: duplicated.riskInput,
    });
    await expectEntryGateFailure(
      harness.runtime.start(
        harness.startCommand({
          scope: duplicatedScope,
          entryMode: "assess",
          // 命令不携带单值引用：重复只可能来自冻结引用集合，按契约冲突拒绝。
          overrides: {
            spatialScopeRef: SPATIAL_SCOPE_REF,
            monitoringSnapshotRefs: duplicated.monitoringSnapshotRefs,
            acceptedRiskRecordRef: duplicated.riskInput,
          },
        }),
      ),
      { stage: "A0", detailCode: "applicability-metadata-missing-duplicate" },
    );
    expect(harness.world.calls.freeze).toEqual([]);
    expect(stageResultStages(await harness.rows(duplicatedScope.runRef))).toEqual([]);

    // 跨工程/不可见授权：撤销后一律拒绝，且与“不存在”同形（只给稳定 detailCode）。
    harness.access.revoke();
    try {
      const denied = entryInputsFor("r1s3-denied");
      const deniedScope = harness.scope({
        entryMode: "assess",
        frozenRefs: denied.frozenRefs,
        riskRecordRef: denied.riskInput,
      });
      await expectFailure(
        harness.runtime.start(
          harness.startCommand({
            scope: deniedScope,
            entryMode: "assess",
            overrides: {
              spatialScopeRef: SPATIAL_SCOPE_REF,
              applicabilityMetadataSnapshotRef: denied.applicabilityMetadataSnapshotRef,
              monitoringSnapshotRefs: denied.monitoringSnapshotRefs,
              acceptedRiskRecordRef: denied.riskInput,
            },
          }),
        ),
        { code: "AUTHORIZATION_DENIED", detailCode: "authorization_denied", retryable: false },
      );
      expect(harness.world.calls.freeze).toEqual([]);
      expect(await harness.rows(deniedScope.runRef)).toEqual([]);
    } finally {
      harness.access.restore();
    }
  });

  it("R3/S1 无预警：评估记录成立但不建预警/建议/Agent，缺席原因进入运行汇总", async () => {
    resetWorld();
    // `assess` 入口按公共载荷只能显式给出监测与适用性：依据由 A0 冻结的准备快照解析得到。
    const inputs = entryInputsFor("r3s1");
    const outcome = await startSegmented(inputs, "assess");
    expect(outcome.status).toBe("completed");
    expect(outcome.stage).toBe("A9");

    // 无冻结依据引用的分段入口按 A0 冻结的评估准备快照 + 业务时刻解析依据：每次解析输入相同。
    expect(harness.world.calls.basisResolve.length).toBeGreaterThan(0);
    const resolvePayloads = harness.world.calls.basisResolve.map((command) =>
      JSON.stringify(command.payload),
    );
    expect(new Set(resolvePayloads).size).toBe(1);
    const resolveCommand = harness.world.calls.basisResolve[0] as KnowledgeResolutionCommandV1;
    expect(resolveCommand.kind).toBe("assessment-basis");
    expect(resolveCommand.payload.requiredAt).toBe(TIMESTAMP);
    // 解析输入是 A0 冻结并由入口快照行登记的评估准备快照，不是调用方当前视图。
    const entryRow = (await harness.rows(outcome.runRef)).find(
      (row) => row.resultKind === "entry-snapshot",
    );
    expect(resolveCommand.payload.preparationSnapshotRef).toEqual({
      kind: "assessment-preparation-snapshot",
      reference: entryRow?.entryIdentity,
    });
    // C19 读取的正是解析结果本身：解析到什么就读什么，不回退到“最新”。
    expect(harness.world.calls.basisRead).toHaveLength(1);
    expect(harness.world.calls.basisRead[0]?.assessmentBasisReleaseSetRef).toMatchObject({
      kind: "assessment-basis-release-set",
      reference: { entityId: `assessment-basis:${entryRow?.entryIdentity?.entityId}` },
    });

    // C26 只按已提交的评估记录开一次预警登记，返回空触发集合：没有预警行，也没有任何 C27/C28/C29/Agent 调用。
    expect(harness.world.calls.warningOpen).toHaveLength(1);
    const warningCommand = harness.world.calls.warningOpen[0] as OpenWarningCommandV1;
    expect(warningCommand.payload.warningAggregationPolicyRef).toEqual(
      versionRef("warning-aggregation-policy"),
    );
    const latest = await harness.latestState(outcome.runRef);
    expect(latest?.state.warningRecordRefs).toEqual([]);
    expect(latest?.state.assessmentRecordRefs).toEqual([
      warningCommand.payload.assessmentRecordRef,
    ]);
    expect(latest?.state.status).toBe("completed");

    const runResult = await harness.runResultBody(outcome.runRef);
    expect(runResult.assessmentRecordRefs).toEqual(latest?.state.assessmentRecordRefs);
    expect(runResult.warningRecordRefs).toEqual([]);
    expect(runResult.responseRecommendationRefs).toEqual([]);
    expect(runResult.skippedTails).toEqual([
      {
        tailKind: "warning",
        reasonCode: "no-trigger-indicators",
        lastEstablishedRef: warningCommand.payload.assessmentRecordRef,
      },
      { tailKind: "recommendation", reasonCode: "recommendation-not-established" },
    ]);

    // 链边只沉淀已发生的关系：风险输入 → 评估记录存在，预警与建议链边缺席。
    const relations = (await harness.links(outcome.runRef)).map((link) => link.relation);
    expect(relations).toContain("risk-assessment");
    expect(relations).not.toContain("assessment-warning");
    expect(relations).not.toContain("warning-recommendation");
  });

  it("R3/S3 重评与补算：reassess 按上一记录与新依据追加新记录，旧运行事实零改写", async () => {
    resetWorld();
    const first = entryInputsFor("r3s3-first", { basisVersionId: "basis-1" });
    const firstOutcome = await startSegmented(first, "historical-backfill");
    const firstRows = await harness.rows(firstOutcome.runRef);
    const firstLinks = await harness.links(firstOutcome.runRef);
    const firstState = await harness.latestState(firstOutcome.runRef);
    const firstRecord = firstState?.state.assessmentRecordRefs[0];
    if (firstRecord === undefined)
      throw new TypeError("the first run must register an assessment record");

    // 重评：输入发生变化并显式携带完整重评入口事实（design D-12：前驱、原因与变化引用
    // 作为不可变入口事实传入，不从冻结引用集合反推）。
    const reassess = entryInputsFor("r3s3-reassess", { monitoringCount: 2 });
    const reassessOutcome = await startSegmented(reassess, "reassess", {
      reassessmentEntry: {
        previousAssessmentRecordRef: firstRecord,
        reason: "monitoring-snapshot",
        changedInputRefs: [reassess.monitoringSnapshotRefs[1]],
      },
    });
    expect(reassessOutcome.status).toBe("completed");

    // C25 `reassessment`：上一记录与改变原因只来自已登记的入口事实。
    const prepareCommands = harness.world.calls.prepare;
    expect(prepareCommands.map((command) => command.kind)).toEqual([
      "historical-backfill",
      "reassessment",
    ]);
    const reassessCommand = prepareCommands.at(-1);
    if (reassessCommand?.kind !== "reassessment") {
      throw new TypeError("the reassess entry must prepare a reassessment");
    }
    expect(reassessCommand.payload.previousAssessmentRecordRef).toEqual(firstRecord);
    expect(reassessCommand.payload.reason).toBe("monitoring-snapshot");

    // 新记录与旧记录不同，且旧运行的登记行、链边与运行状态逐项未变（只追加）。
    const reassessState = await harness.latestState(reassessOutcome.runRef);
    expect(reassessState?.state.assessmentRecordRefs).toHaveLength(1);
    expect(reassessState?.state.assessmentRecordRefs[0]).not.toEqual(firstRecord);
    expect(await harness.rows(firstOutcome.runRef)).toEqual(firstRows);
    expect(await harness.links(firstOutcome.runRef)).toEqual(firstLinks);
    expect(await harness.latestState(firstOutcome.runRef)).toEqual(firstState);

    // 重评入口事实被真实保存进 run-state 工件，可从登记事实直接读回（design D-12），
    // 不再需要从冻结引用集合反推前驱或原因。
    expect(reassessState?.state.reassessmentEntry).toEqual({
      previousAssessmentRecordRef: firstRecord,
      reason: "monitoring-snapshot",
      changedInputRefs: [reassess.monitoringSnapshotRefs[1]],
    });
    // 非重评运行不携带该入口字段。
    expect(firstState?.state.reassessmentEntry).toBeUndefined();
  });

  it("同一前驱但不同原因的重评不共享运行分区，原因按唯一映射送到 C25", async () => {
    resetWorld();
    const first = entryInputsFor("partition-first", { basisVersionId: "basis-1" });
    const firstOutcome = await startSegmented(first, "historical-backfill");
    const firstRecord = (await harness.latestState(firstOutcome.runRef))?.state
      .assessmentRecordRefs[0];
    if (firstRecord === undefined) {
      throw new TypeError("the first run must register an assessment record");
    }

    const runRefsFor = async (
      reason: "monitoring-snapshot" | "risk-matrix" | "weight-strategy",
    ) => {
      const inputs = entryInputsFor(`partition-${reason}`, { monitoringCount: 2 });
      const outcome = await startSegmented(inputs, "reassess", {
        reassessmentEntry: {
          previousAssessmentRecordRef: firstRecord,
          reason,
          changedInputRefs: [inputs.monitoringSnapshotRefs[1]],
        },
      });
      expect(outcome.status).toBe("completed");
      return outcome.runRef;
    };

    const monitoringRun = await runRefsFor("monitoring-snapshot");
    const matrixRun = await runRefsFor("risk-matrix");
    const strategyRun = await runRefsFor("weight-strategy");
    // 前驱相同但原因不同：三个独立运行分区。
    const runIds = [monitoringRun, matrixRun, strategyRun].map(
      (runRef) => runRef.reference.entityId,
    );
    expect(new Set(runIds).size).toBe(3);

    // 只有 weight-strategy 需要改名，其余两码原样透传（design D-12 唯一映射）。
    const reasons = harness.world.calls.prepare
      .filter((command) => command.kind === "reassessment")
      .map((command) => (command.kind === "reassessment" ? command.payload.reason : undefined));
    expect(new Set(reasons)).toEqual(
      new Set(["monitoring-snapshot", "risk-matrix", "weight-or-strategy"]),
    );
  });

  it("已知缺口边界：冻结依据引用与解析都不可得时稳定失败且不产生阶段成功事实", async () => {
    resetWorld({ basisResolution: "unavailable" });
    const inputs = entryInputsFor("basis-unavailable");
    const scope = harness.scope({
      entryMode: "assess",
      frozenRefs: inputs.frozenRefs,
      riskRecordRef: inputs.riskInput,
    });
    const outcome = await harness.runtime.start(
      harness.startCommand({
        scope,
        entryMode: "assess",
        overrides: {
          spatialScopeRef: SPATIAL_SCOPE_REF,
          applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
          monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
          acceptedRiskRecordRef: inputs.riskInput,
        },
      }),
    );
    // 依据不可得：A0 已成立事实保留，A1 起没有阶段成功事实，运行以不可重试错误收口。
    expect(outcome.status).toBe("terminal-failure");
    expect(outcome.stage).toBe("A1");
    expect(outcome.errorRef).toBeDefined();
    expect(stageResultStages(await harness.rows(scope.runRef))).toEqual(["A0"]);
    expect(await harness.rows(scope.runRef)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resultKind: "workflow-error", stage: "A1" }),
      ]),
    );
  });

  it("start 幂等与入口身份：同载荷重放返回既有事实，同运行异载荷按契约冲突拒绝且零改写", async () => {
    resetWorld();
    const inputs = entryInputsFor("idempotent", { basisVersionId: "basis-1" });
    const scope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: inputs.frozenRefs,
      riskRecordRef: inputs.riskInput,
    });
    const command = harness.startCommand({
      scope,
      entryMode: "historical-backfill",
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
        acceptedRiskRecordRef: inputs.riskInput,
      },
    });
    const first = await harness.runtime.start(command);
    expect(first.disposition).toBe("created");
    const rows = await harness.rows(scope.runRef);
    const links = await harness.links(scope.runRef);
    const freezeCount = harness.world.calls.freeze.length;

    // 同载荷重放：返回既有运行与既有版本，不重复任何业务动作。
    const replay = await harness.runtime.start({
      ...command,
      commandId: `${command.commandId}:replay`,
    });
    expect(replay.disposition).toBe("existing");
    expect(replay.runVersionId).toBe(first.runVersionId);
    expect(replay.status).toBe(first.status);
    expect(await harness.rows(scope.runRef)).toEqual(rows);
    expect(harness.world.calls.freeze).toHaveLength(freezeCount);

    // 同一运行身份但冻结载荷不同（缺冻结依据引用）：入口身份与冻结引用不一致，按契约冲突拒绝，零改写。
    const conflictingRefs = inputs.frozenRefs.filter(
      (ref) => ref.kind !== "assessment-basis-release-set",
    );
    await expectFailure(
      harness.runtime.start({
        ...command,
        commandId: `${command.commandId}:conflict`,
        frozenRefs: conflictingRefs,
      }),
      { code: "CONTRACT_INVALID", detailCode: "entry-identity-mismatch", retryable: false },
    );
    expect(await harness.rows(scope.runRef)).toEqual(rows);
    expect(await harness.links(scope.runRef)).toEqual(links);
  });

  it("resume 契约：陈旧版本、未知运行与终态运行分别稳定拒绝且零补写", async () => {
    // 陈旧版本只在未终态的运行上可达（终态运行的判定先于版本判定）。
    resetWorld({ prepareOutcome: "waiting" });
    const inputs = entryInputsFor("resume-contract", { basisVersionId: "basis-1" });
    const scope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: inputs.frozenRefs,
      riskRecordRef: inputs.riskInput,
    });
    const command = harness.startCommand({
      scope,
      entryMode: "historical-backfill",
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
        acceptedRiskRecordRef: inputs.riskInput,
      },
    });
    const waiting = await harness.runtime.start(command);
    expect(waiting.status).toBe("waiting");
    const waitingRows = await harness.rows(scope.runRef);
    const waitingLinks = await harness.links(scope.runRef);

    // 陈旧 `expectedRunVersionId`：不猜“最新”，零补写。
    await expectFailure(
      harness.runtime.resume({
        ...command,
        commandId: `${command.commandId}:stale`,
        expectedRunVersionId: digest("stale-run-version"),
        resumeCause: { kind: "user-confirmed" },
      }),
      { code: "VERSION_CONFLICT", detailCode: "stale_version", retryable: false },
    );
    expect(await harness.rows(scope.runRef)).toEqual(waitingRows);
    expect(await harness.links(scope.runRef)).toEqual(waitingLinks);

    // 未知运行：与“无权”同形的稳定 `RUN_NOT_FOUND`。
    const unknown = entryInputsFor("resume-unknown", { basisVersionId: "basis-1" });
    const unknownScope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: unknown.frozenRefs,
      riskRecordRef: unknown.riskInput,
    });
    await expectFailure(
      harness.runtime.resume({
        ...harness.startCommand({
          scope: unknownScope,
          entryMode: "historical-backfill",
          overrides: {
            spatialScopeRef: SPATIAL_SCOPE_REF,
            applicabilityMetadataSnapshotRef: unknown.applicabilityMetadataSnapshotRef,
            monitoringSnapshotRefs: unknown.monitoringSnapshotRefs,
            acceptedRiskRecordRef: unknown.riskInput,
          },
        }),
        expectedRunVersionId: digest("unknown-run-version"),
        resumeCause: { kind: "user-confirmed" },
      }),
      { code: "RUN_NOT_FOUND", detailCode: "entity_not_found", retryable: false },
    );

    // 终态运行：完成后的运行拒绝恢复（即使携带正确版本），零补写。
    resetWorld();
    const terminal = entryInputsFor("resume-terminal", { basisVersionId: "basis-1" });
    const terminalScope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: terminal.frozenRefs,
      riskRecordRef: terminal.riskInput,
    });
    const terminalCommand = harness.startCommand({
      scope: terminalScope,
      entryMode: "historical-backfill",
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: terminal.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: terminal.monitoringSnapshotRefs,
        acceptedRiskRecordRef: terminal.riskInput,
      },
    });
    const started = await harness.runtime.start(terminalCommand);
    expect(started.status).toBe("completed");
    const rows = await harness.rows(terminalScope.runRef);
    const links = await harness.links(terminalScope.runRef);

    await expectFailure(
      harness.runtime.resume({
        ...terminalCommand,
        commandId: `${terminalCommand.commandId}:terminal`,
        expectedRunVersionId: started.runVersionId,
        resumeCause: { kind: "user-confirmed" },
      }),
      { code: "RUN_TERMINATED", detailCode: "run-already-terminal", retryable: false },
    );
    expect(await harness.rows(terminalScope.runRef)).toEqual(rows);
    expect(await harness.links(terminalScope.runRef)).toEqual(links);
  });

  it("等待与取消：等待事实同事务登记，取消追加式收口且已提交事实与链边保留", async () => {
    resetWorld({ prepareOutcome: "waiting" });
    const inputs = entryInputsFor("waiting-cancel", { basisVersionId: "basis-1" });
    const scope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: inputs.frozenRefs,
      riskRecordRef: inputs.riskInput,
    });
    const command = harness.startCommand({
      scope,
      entryMode: "historical-backfill",
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
        acceptedRiskRecordRef: inputs.riskInput,
      },
    });
    const waiting = await harness.runtime.start(command);
    expect(waiting.status).toBe("waiting");
    expect(waiting.stage).toBe("A2");
    expect(waiting.lastWaitingRef?.kind).toBe("user-confirmation");

    const committedRows = await harness.rows(scope.runRef);
    const committedLinks = await harness.links(scope.runRef);
    expect(committedRows.filter((row) => row.resultKind === "waiting")).toHaveLength(1);
    expect(stageResultStages(committedRows)).toEqual(["A0", "A1"]);
    expect(committedLinks.length).toBeGreaterThan(0);

    // 取消：只追加取消态运行状态与类型化原因，已提交的运行事实、审计与链边一律保留。
    const cancelled = await harness.runtime.cancel({
      ...command,
      commandId: `${command.commandId}:cancel`,
      expectedRunVersionId: waiting.runVersionId,
      reasonCode: "operator-cancelled",
    });
    expect(cancelled.disposition).toBe("cancellation-recorded");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.runVersionId).not.toBe(waiting.runVersionId);
    expect(cancelled.errorRef).toBeDefined();

    const afterCancel = await harness.rows(scope.runRef);
    for (const row of committedRows) {
      expect(
        afterCancel.some(
          (candidate) =>
            candidate.resultKind === row.resultKind &&
            candidate.resultId === row.resultId &&
            candidate.resultVersionId === row.resultVersionId,
        ),
      ).toBe(true);
    }
    expect(afterCancel.length).toBeGreaterThan(committedRows.length);
    expect(await harness.links(scope.runRef)).toEqual(committedLinks);

    // 已取消运行再取消：已成立事实原样返回，不重复追加。
    const again = await harness.runtime.cancel({
      ...command,
      commandId: `${command.commandId}:cancel-again`,
      reasonCode: "operator-cancelled",
    });
    expect(again.disposition).toBe("already-cancelled");
    expect(again.runVersionId).toBe(cancelled.runVersionId);
    expect(await harness.rows(scope.runRef)).toEqual(afterCancel);
  });

  it("技术失败与规则冲突：瞬态失败只重试一次即终态，规则冲突不进入重试", async () => {
    resetWorld({ evaluateOutcome: "transient" });
    const inputs = entryInputsFor("transient", { basisVersionId: "basis-1" });
    const scope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: inputs.frozenRefs,
      riskRecordRef: inputs.riskInput,
    });
    const command = harness.startCommand({
      scope,
      entryMode: "historical-backfill",
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
        acceptedRiskRecordRef: inputs.riskInput,
      },
    });
    const failed = await harness.runtime.start(command);
    expect(failed.status).toBe("retryable-failure");
    expect(failed.errorRef).toBeDefined();
    const failedRows = await harness.rows(scope.runRef);

    // 第一次恢复回到同一阶段重放：同一评估动作身份，第二次仍失败即收口为终态（不无限重试）。
    const retried = await harness.runtime.resume({
      ...command,
      commandId: `${command.commandId}:retry`,
      expectedRunVersionId: failed.runVersionId,
      resumeCause: { kind: "technical-retry" },
    });
    expect(retried.status).toBe("terminal-failure");
    expect(harness.world.calls.evaluate).toHaveLength(2);
    expect(
      new Set(harness.world.calls.evaluate.map((entry) => sha256CanonicalJson(entry.payload))).size,
    ).toBe(1);
    expect((await harness.rows(scope.runRef)).length).toBeGreaterThan(failedRows.length);

    // 终态后不再有重试通道。
    await expectFailure(
      harness.runtime.resume({
        ...command,
        commandId: `${command.commandId}:after-terminal`,
        expectedRunVersionId: retried.runVersionId,
        resumeCause: { kind: "technical-retry" },
      }),
      { code: "RUN_TERMINATED", detailCode: "run-already-terminal", retryable: false },
    );

    // 规则冲突（业务阻断）：失败不可重试，运行直接进入终态。
    resetWorld({ prepareOutcome: "business-blocked" });
    const blocked = entryInputsFor("business-blocked", { basisVersionId: "basis-1" });
    const blockedOutcome = await startSegmented(blocked, "historical-backfill");
    expect(blockedOutcome.status).toBe("terminal-failure");
    const errorRow = (await harness.rows(blockedOutcome.runRef)).find((row) =>
      row.workflowErrorRef?.reference.entityId.startsWith("assessment-graph-workflow-error:A2:"),
    );
    expect(errorRow).toMatchObject({ resultKind: "workflow-error", stage: "A2" });
  });

  it("checkpoint 与业务事实不一致：CHECKPOINT_INCONSISTENT 零补写", async () => {
    resetWorld({ prepareOutcome: "waiting" });
    const inputs = entryInputsFor("checkpoint", { basisVersionId: "basis-1" });
    const scope = harness.scope({
      entryMode: "historical-backfill",
      frozenRefs: inputs.frozenRefs,
      riskRecordRef: inputs.riskInput,
    });
    const command = harness.startCommand({
      scope,
      entryMode: "historical-backfill",
      overrides: {
        spatialScopeRef: SPATIAL_SCOPE_REF,
        applicabilityMetadataSnapshotRef: inputs.applicabilityMetadataSnapshotRef,
        monitoringSnapshotRefs: inputs.monitoringSnapshotRefs,
        acceptedRiskRecordRef: inputs.riskInput,
      },
    });
    const waiting = await harness.runtime.start(command);
    expect(waiting.status).toBe("waiting");

    // 检查点伪造为指向不存在的业务提交（业务停在 A2，检查点声称已到 A9）。
    const state = await harness.checkpointState(scope.threadId);
    await harness.graph.recover(
      AssessmentGraphStateV1Schema.parse({
        ...state,
        waitingRef: undefined,
        stage: "A9",
        status: "completed",
        resultRef: {
          kind: "assessment-run-result",
          reference: versionRef(`injected:${scope.runRef.reference.versionId}`),
        },
      }),
      "A9",
      harness.checkpointConfig(scope.threadId),
    );

    const rowsBefore = await harness.rows(scope.runRef);
    const linksBefore = await harness.links(scope.runRef);
    await expectFailure(
      harness.runtime.resume({
        ...command,
        commandId: `${command.commandId}:resume`,
        expectedRunVersionId: waiting.runVersionId,
        resumeCause: { kind: "user-confirmed" },
      }),
      { code: "CHECKPOINT_INCONSISTENT", detailCode: "checkpoint-inconsistent", retryable: false },
    );
    expect(await harness.rows(scope.runRef)).toEqual(rowsBefore);
    expect(await harness.links(scope.runRef)).toEqual(linksBefore);
  });
});
