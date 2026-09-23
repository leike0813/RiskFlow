/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 评估子图组合根验证（design D-02/D-05，IP-05）：
 * 一、构造期闭合与接线：全部必需依赖（C03-C29）缺失任一项即构造期失败，齐全时按同一性透传注入端口；
 * 二、真实接线运行：真实 Testcontainers PostgreSQL + 完整生产迁移链 + 真实 C03 事务单元 /
 *     C04 工件存储 / 真实 LangGraph PostgreSQL checkpointer 上跑通 `runtime.start`——入口门禁
 *     不通过时结构化失败且零业务登记，门禁通过时登记首版运行状态与 A0 阶段事实。
 *
 * 断言只针对调用方可见契约：构造结果与端口同一性、登记行、运行状态与版本、稳定错误码，
 * 不断言私有实现、提示词或文案全文。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentEvaluationSuccessV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AuthorizationContextV1Schema,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WorkflowRunRefV1Schema,
  type ApplicabilityMetadataSnapshotRefV1,
  type ContractReferenceV1,
  type EngineeringDataPortV1,
  type EngineeringFreezeCommandV1,
  type KnowledgeResolutionCommandV1,
  type MonitoringSnapshotRefV1,
  type StandardizedRiskRecordRefV1,
  type WorkflowEntryModeV1,
} from "@riskflow/contracts/ports";
import { ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1 } from "@riskflow/core/assessment-config";
import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { AssessmentBasisReleaseSetReadResultV1Schema } from "@riskflow/core/scoring-rules";
import {
  initialRunVersionId,
  segmentedAssessmentSubRunIdentityFor,
  workflowEntryIdentityFor,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunCommandV1,
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
  type AssessmentGraphCompositionOptionsV1,
  type AssessmentGraphCompositionV1,
  type AssessmentGraphPortsV1,
} from "../../src/assessment/index.js";

const PROJECT_ID = "project-c30-composition";
const ACTOR_ID = "actor-c30-composition";
const TIMESTAMP = "2030-04-01T00:00:00.000Z";

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
const GRAPH_VERSION = versionRef("assessment-graph", "1");
const RETRY_POLICY_REF = versionRef("retry-policy", "1");

/** 与组合根 `REQUIRED_DEPENDENCIES_V1` 逐项对照的必需依赖表（缺任一项即拒绝构造）。 */
const REQUIRED_DEPENDENCIES = [
  "db",
  "transactionUnit",
  "artifactStore",
  "authorization",
  "runtimeAuthorization",
  "checkpointer",
  "engineeringData",
  "basis",
  "basisResolver",
  "runtimePolicies",
  "riskAssessment",
  "warning",
  "recommendation",
  "recommendationAgent",
  "responseLifecycle",
  "calibration",
  "calibrationAgent",
  "policies",
] as const;

/** 组合根不持有的注入端口：由真实夹具或闭合替身提供，其余三件套由组合根自建。 */
type InjectedPortsV1 = Omit<
  AssessmentGraphPortsV1,
  "transactionUnit" | "registrationStore" | "bodies" | "now"
>;

/** 本轮不应发生的动作：一旦被调用，用例立即失败（缺席链尾不得靠调用下游端口伪造成立）。 */
const forbidden = (name: string) => async (): Promise<never> => {
  throw new TypeError(`${name} must not be called by this run`);
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

/** 端口调用记录：用于证明“未发生的动作没有被执行”。 */
interface CallLogV1 {
  readonly freeze: EngineeringFreezeCommandV1[];
  readonly basisResolve: KnowledgeResolutionCommandV1[];
}

/**
 * 注入端口替身：只返回闭合结果，不读任何私表、不复制领域算法。
 */
const createPortDoubles = (calls: CallLogV1): InjectedPortsV1 => ({
  engineeringData: {
    freeze: async (command) => {
      calls.freeze.push(command);
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
  } satisfies Pick<EngineeringDataPortV1, "freeze">,
  basis: {
    readAssessmentBasisReleaseSet: async (input) =>
      AssessmentBasisReleaseSetReadResultV1Schema.parse({
        kind: "succeeded",
        schemaVersion: "1",
        assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
        memberDigest: digest("basis-members"),
        ...basisMembersV1(),
      }),
  },
  basisResolver: {
    resolve: async (command) => {
      calls.basisResolve.push(command);
      if (command.kind !== "assessment-basis") {
        throw new TypeError("the assessment graph only resolves the assessment basis");
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
    readRuntimePolicySet: async () => ({
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
    }),
  },
  riskAssessment: {
    prepare: async (command) => {
      const { preparationSnapshotRef } = command.payload;
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
    open: async () => ({
      kind: "succeeded",
      result: { warningRecordRefs: [], warningResponseTaskRefs: [], notificationIntentRefs: [] },
    }),
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

type AssessmentEntryModeV1 = Extract<WorkflowEntryModeV1, "assess" | "reassess">;

/** 用例运行范围：入口身份由冻结引用派生，运行身份随之独立（同容器不共享登记事实）。 */
interface CompositionScopeV1 {
  readonly runRef: WorkflowGraphRunCommandV1["runRef"];
  readonly threadId: string;
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly parentRunRef: WorkflowGraphRunCommandV1["runRef"];
  readonly riskInput: StandardizedRiskRecordRefV1;
  readonly applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1;
  readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
}

describe("C30 评估子图组合根（构造期闭合）", () => {
  /**
   * 只做接线：必需依赖用最小替身注入，缺失任一项必须构造期失败。
   * 端口传递与真实运行行为由下方真实 PostgreSQL 用例覆盖。
   */
  const requiredOptions = (): AssessmentGraphCompositionOptionsV1 =>
    ({
      db: {},
      transactionUnit: {},
      artifactStore: {},
      authorization: {},
      runtimeAuthorization: {},
      checkpointer: {},
      ...createPortDoubles({ freeze: [], basisResolve: [] }),
      now: () => new Date(TIMESTAMP),
    }) as unknown as AssessmentGraphCompositionOptionsV1;

  it.each(REQUIRED_DEPENDENCIES)("缺少必需依赖 %s 时构造期失败闭合", (dependency) => {
    const options = { ...requiredOptions(), [dependency]: undefined } as never;
    expect(() => createAssessmentGraphComposition(options)).toThrow(
      new TypeError("assessment graph composition requires every C03-C29 dependency"),
    );
  });

  it("依赖齐全时只暴露登记的闭合结果，且注入端口按同一性透传", () => {
    const doubles = createPortDoubles({ freeze: [], basisResolve: [] });
    const options = { ...requiredOptions(), ...doubles };
    const composition = createAssessmentGraphComposition(options);

    expect(Object.keys(composition).sort()).toEqual([
      "adapter",
      "graph",
      "ports",
      "registrationStore",
      "runtime",
    ]);
    expect(composition.registrationStore).toBe(composition.adapter.registrationStore);
    expect(composition.ports.registrationStore).toBe(composition.adapter.registrationStore);
    expect(composition.ports.bodies).toBe(composition.adapter.bodies);
    expect(composition.ports.transactionUnit).toBe(options.transactionUnit);
    expect(composition.ports.engineeringData).toBe(doubles.engineeringData);
    expect(composition.ports.basis).toBe(doubles.basis);
    expect(composition.ports.basisResolver).toBe(doubles.basisResolver);
    expect(composition.ports.runtimePolicies).toBe(doubles.runtimePolicies);
    expect(composition.ports.riskAssessment).toBe(doubles.riskAssessment);
    expect(composition.ports.warning).toBe(doubles.warning);
    expect(composition.ports.recommendation).toBe(doubles.recommendation);
    expect(composition.ports.recommendationAgent).toBe(doubles.recommendationAgent);
    expect(composition.ports.responseLifecycle).toBe(doubles.responseLifecycle);
    expect(composition.ports.calibration).toBe(doubles.calibration);
    expect(composition.ports.calibrationAgent).toBe(doubles.calibrationAgent);
    expect(composition.ports.policies).toBe(doubles.policies);
    expect(composition.runtime).toHaveProperty("start");
    expect(composition.runtime).toHaveProperty("resume");
    expect(composition.runtime).toHaveProperty("cancel");

    // `now` 是可选注入：缺省时组合根必须给出真实时钟，而不是内建固定时刻。
    const defaulted = requiredOptions();
    const withoutNow = { ...defaulted, now: undefined } as never;
    expect(createAssessmentGraphComposition(withoutNow).ports.now()).toBeInstanceOf(Date);
  });
});

describe("C30 评估子图组合根（真实 PostgreSQL 接线）", () => {
  let postgres: PostgresTestFixture;
  let app: PostgresRuntime;
  let composition: AssessmentGraphCompositionV1;
  let options: AssessmentGraphCompositionOptionsV1;
  let artifactStore: ContentAddressedArtifactStoreHandleV1 | undefined;
  let transactionUnit: ReturnType<typeof createPostgresTransactionUnit> | undefined;
  let checkpointer: PostgresCheckpointer | undefined;
  let rootDirectory: string | undefined;
  const calls: CallLogV1 = { freeze: [], basisResolve: [] };

  beforeAll(async () => {
    postgres = await startPostgresFixture();
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-composition-"));
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
    options = {
      db: app.db,
      transactionUnit,
      artifactStore,
      authorization: {
        verify: async (input) => ({
          context: { ...AUTHORIZATION, authorizationContextRef: input.authorizationContextRef },
          contextRef: input.authorizationContextRef,
          redacted: false,
        }),
      },
      runtimeAuthorization: {
        verifyCurrent: async (input) =>
          AuthorizationContextV1Schema.safeParse(input.authorization).success
            ? AUTHORIZATION
            : undefined,
      },
      checkpointer,
      ...createPortDoubles(calls),
      now: () => new Date(TIMESTAMP),
    };
    composition = createAssessmentGraphComposition(options);
  }, 300_000);

  afterAll(async () => {
    await checkpointer?.end().catch(() => undefined);
    await artifactStore?.close().catch(() => undefined);
    await transactionUnit?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    if (rootDirectory !== undefined) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    await postgres.close().catch(() => undefined);
  });

  /** 用例运行范围：冻结引用与入口身份逐用例派生，运行身份因此独立。 */
  const scopeOf = (input: {
    readonly seed: string;
    readonly entryMode: AssessmentEntryModeV1;
    readonly droppedKinds?: readonly ContractReferenceV1["kind"][];
  }): CompositionScopeV1 => {
    const projectRevisionRef = parseRef(
      ProjectRevisionRefV1Schema,
      "project-revision",
      `project-revision:${PROJECT_ID}`,
      input.seed,
    );
    const applicabilityMetadataSnapshotRef = parseRef(
      ApplicabilityMetadataSnapshotRefV1Schema,
      "applicability-metadata-snapshot",
      `applicability:${PROJECT_ID}`,
      input.seed,
    );
    const riskInput = parseRef(
      StandardizedRiskRecordRefV1Schema,
      "standardized-risk-record",
      `risk-record:${PROJECT_ID}`,
      input.seed,
    );
    const monitoringSnapshotRefs = [
      parseRef(
        MonitoringSnapshotRefV1Schema,
        "monitoring-snapshot",
        `monitoring:${PROJECT_ID}:${input.seed}`,
      ),
    ];
    const droppedKinds = input.droppedKinds ?? [];
    const frozenRefs: readonly ContractReferenceV1[] = [
      projectRevisionRef,
      SPATIAL_SCOPE_REF,
      applicabilityMetadataSnapshotRef,
      riskInput,
      ...monitoringSnapshotRefs,
    ].filter((ref) => !droppedKinds.includes(ref.kind));
    const entryIdentity = workflowEntryIdentityFor({
      entryMode: input.entryMode,
      projectId: PROJECT_ID,
      frozenRefs,
    });
    const parentRunRef = parseRef(
      WorkflowRunRefV1Schema,
      "workflow-run",
      `risk-flow-run:${PROJECT_ID}:${input.seed}`,
      entryIdentity.versionId,
    );
    return {
      ...segmentedAssessmentSubRunIdentityFor({
        projectId: PROJECT_ID,
        parentRunRef,
        entryMode: input.entryMode,
        entryIdentity,
      }),
      entryIdentity,
      frozenRefs,
      parentRunRef,
      riskInput,
      applicabilityMetadataSnapshotRef,
      monitoringSnapshotRefs,
    };
  };

  const startCommandOf = (scope: CompositionScopeV1): WorkflowGraphRunCommandV1 => {
    const commandId = `c30-assessment-start:${scope.runRef.reference.versionId}`;
    return {
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: AUTHORIZATION,
      commandId,
      idempotencyKey: commandId,
      issuedAt: TIMESTAMP,
      validAt: TIMESTAMP,
      graphVersion: GRAPH_VERSION,
      retryPolicyRef: RETRY_POLICY_REF,
      runRef: scope.runRef,
      threadId: scope.threadId,
      entryMode: "assess",
      entryIdentity: scope.entryIdentity,
      frozenRefs: scope.frozenRefs,
      parentRunRef: scope.parentRunRef,
      spatialScopeRef: SPATIAL_SCOPE_REF,
      applicabilityMetadataSnapshotRef: scope.applicabilityMetadataSnapshotRef,
      monitoringSnapshotRefs: scope.monitoringSnapshotRefs,
      acceptedRiskRecordRef: scope.riskInput,
    };
  };

  const rowsOf = async (scope: CompositionScopeV1): Promise<readonly WorkflowGraphResultRowV1[]> =>
    await composition.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: scope.runRef.reference.entityId,
    });

  const linksOf = async (scope: CompositionScopeV1) =>
    await composition.registrationStore.listRunLinks({
      projectId: PROJECT_ID,
      runId: scope.runRef.reference.entityId,
    });

  it("入口门禁不通过：结构化失败且零业务登记（无冻结、无阶段事实、无链边）", async () => {
    // 缺工程修订冻结引用：入口门禁证明不通过，运行如实登记失败原因，但不创建正式评估准备。
    const scope = scopeOf({
      seed: "composition-gate-incomplete",
      entryMode: "assess",
      droppedKinds: ["project-revision"],
    });
    const outcome = await composition.runtime.start(startCommandOf(scope));

    expect({ status: outcome.status, stage: outcome.stage }).toEqual({
      status: "terminal-failure",
      stage: "A0",
    });
    expect(outcome.errorRef?.reference.entityId).toBe(
      "assessment-graph-workflow-error:A0:project-revision-missing",
    );
    expect(outcome.resultRef).toBeUndefined();
    expect(calls.freeze).toEqual([]);
    const rows = await rowsOf(scope);
    expect(
      rows.filter((row) => row.resultKind === "workflow-error").map((row) => row.resultId),
    ).toEqual(["assessment-graph-workflow-error:A0:project-revision-missing"]);
    expect(rows.filter((row) => row.resultKind === "stage-result")).toEqual([]);
    expect(rows.filter((row) => row.resultKind === "entry-snapshot")).toEqual([]);
    expect(await linksOf(scope)).toEqual([]);
  });

  it("授权不通过：命令入口复验即在任何读写之前拒绝，运行分区零登记", async () => {
    const denied = scopeOf({ seed: "composition-gate-denied", entryMode: "assess" });
    const deniedComposition = createAssessmentGraphComposition({
      ...options,
      runtimeAuthorization: { verifyCurrent: async () => undefined },
    });
    const failure = await deniedComposition.runtime.start(startCommandOf(denied)).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(failure instanceof AssessmentGraphRunErrorV1)) {
      throw new TypeError("expected the assessment run to be rejected");
    }
    expect({
      code: failure.code,
      detailCode: failure.detailCode,
      retryable: failure.retryable,
    }).toEqual({
      code: "AUTHORIZATION_DENIED",
      detailCode: "authorization_denied",
      retryable: false,
    });
    expect(await rowsOf(denied)).toEqual([]);
    expect(await linksOf(denied)).toEqual([]);
  });

  it("入口门禁通过：登记首版运行状态与 A0 阶段事实，冻结与依据解析按精确引用调用", async () => {
    const scope = scopeOf({ seed: "composition-gate-ready", entryMode: "assess" });
    const outcome = await composition.runtime.start(startCommandOf(scope));
    expect(outcome.status).toBe("completed");
    expect(outcome.stage).toBe("A9");
    expect(outcome.runRef).toEqual(scope.runRef);

    const runId = scope.runRef.reference.entityId;
    const rows = await rowsOf(scope);
    // 首版运行状态版本只由运行身份、入口与记录时刻决定：可精确核对，不猜“最新”。
    const initialRunStates = rows.filter(
      (row) =>
        row.resultKind === "run-state" &&
        row.runVersionId ===
          initialRunVersionId({ runId, entryMode: "assess", recordedAt: TIMESTAMP }),
    );
    expect(initialRunStates).toHaveLength(1);
    expect(initialRunStates[0]?.runId).toBe(runId);

    // A0 阶段事实：入口快照行登记 A0 冻结出的评估准备快照与本次运行的冻结输入，
    // 阶段结果行自 A0 起成立并推进到 A9。
    const entryRow = rows.find((row) => row.resultKind === "entry-snapshot");
    expect(entryRow?.stage).toBe("A0");
    expect(entryRow?.entryIdentity?.entityId).toBe(
      `assessment-preparation:${scope.riskInput.reference.entityId}`,
    );
    expect(entryRow?.frozenRefs).toEqual([...scope.frozenRefs]);
    const stageResultStages = rows
      .filter((row) => row.resultKind === "stage-result")
      .map((row) => row.stage);
    expect(stageResultStages[0]).toBe("A0");
    expect(stageResultStages).toContain("A9");

    // 注入的 C11 冻结端口与 C17/C19 依据解析端口真实接线：只按入口冻结引用调用。
    expect(calls.freeze).toHaveLength(1);
    const freezeCommand = calls.freeze[0];
    if (freezeCommand?.kind !== "assessment-preparation") {
      throw new TypeError("the run must freeze exactly one assessment preparation");
    }
    expect(freezeCommand.payload.riskInput).toEqual(scope.riskInput);
    expect(freezeCommand.payload.monitoringSnapshotRefs).toEqual([...scope.monitoringSnapshotRefs]);
    expect(freezeCommand.payload.entryMode).toBe("assess");
    expect(calls.basisResolve.length).toBeGreaterThan(0);
    // 依据解析身份由冻结输入确定性派生：每次解析输入相同，绝不选择“当前最新值”。
    expect(new Set(calls.basisResolve.map((command) => JSON.stringify(command.payload))).size).toBe(
      1,
    );
    expect(calls.basisResolve[0]?.payload.preparationSnapshotRef).toEqual({
      kind: "assessment-preparation-snapshot",
      reference: entryRow?.entryIdentity,
    });

    const latest = await composition.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
    });
    const latestState: WorkflowGraphRunStateV1 | undefined = latest?.state;
    expect(latestState?.status).toBe("completed");
    expect(latestState?.entryMode).toBe("assess");
    expect(latestState?.assessmentRecordRefs).toHaveLength(1);
    expect(outcome.resultRef).toBeDefined();
    expect(outcome.resultRef).toEqual(latestState?.resultRef);
  });
});
