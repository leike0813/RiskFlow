/**
 * C28 PostgreSQL 组合夹具：真实 C03/C04/C06/C07 + 正式 C14/C25/C26/C27 链 + response-lifecycle adapter。
 * 预测策略、偏差策略、指标系统与风险矩阵由夹具按精确引用发布为 C19 basis 成员；
 * C30 尚未实现，因此 workflow binding 与预测/反馈输入快照由夹具按公共契约提供。
 */
import type { Kysely } from "kysely";

import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  DeviationPolicyDocumentV1Schema,
  ForecastPolicyDocumentV1Schema,
  IndicatorSystemDocumentV1Schema,
  RiskMatrixDocumentV1Schema,
  type AssessmentConfigurationDocumentV1,
  type DeviationPolicyV1,
  type ForecastPolicyV1,
} from "@riskflow/core/assessment-config";
import {
  canonicalJson,
  sha256CanonicalJson,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import {
  AuthorizationContextV1Schema,
  SpatialScopeRefV1Schema,
  WarningResponseRecordCommandV1Schema,
  WarningResponseRecordResultV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type EffectForecastRefV1,
  type ExecutionRecordRefV1,
  type FeedbackRefV1,
  type MonitoringSnapshotRefV1,
  type ResponseFeedbackInputSnapshotRefV1,
  type ResponseForecastInputSnapshotRefV1,
  type ResponseRecommendationRefV1,
  type SpatialScopeRefV1,
  type WarningRecordRefV1,
  type WarningResponseRecordCommandV1,
  type WarningResponseRecordResultV1,
} from "@riskflow/contracts/ports";
import {
  ResponseFeedbackInputSnapshotV1Schema,
  ResponseForecastInputSnapshotV1Schema,
  type ResponseFeedbackInputSnapshotV1,
  type ResponseForecastInputSnapshotV1,
} from "@riskflow/contracts/workflows";
import {
  EFFECT_FORECAST_MODEL_MEDIA_TYPE_V1,
  EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
  ResponseDeviationResultV1Schema,
  ResponseForecastResultV1Schema,
  type EffectForecastExecutorV1,
  type ResponseDeviationFactReadResultV1,
  type ResponseDeviationResultV1,
  type ResponseForecastResultV1,
  type VerifiedResponseWorkflowBindingV1,
} from "@riskflow/core/response-lifecycle";
import type { ForecastRiskStatePortV1 } from "@riskflow/core/risk-assessment/engine";

import {
  createPostgresResponseLifecycleAdapter,
  createPostgresResponseLifecycleContextReader,
  type EffectForecastExecutorSourceV1,
  type PostgresResponseLifecycleAdapter,
  type PostgresResponseLifecycleContextReader,
  type ResponseLifecycleDownstreamAuthorizationRequestV1,
  type ResponseLifecycleDownstreamAuthorizerV1,
  type ResponseLifecycleMeasureReleaseReaderV1,
} from "../../src/response-lifecycle/index.js";
import type { PostgresDatabase } from "../../src/postgres/types.js";
import {
  c25ConfigurationDocuments,
  c25Digest,
  c25ReleaseRef,
  c25RevisionRef,
  c25Version,
} from "../../../core/test/risk-assessment/fixture.js";
import {
  startRecommendationFixture,
  type RecommendationPostgresFixtureV1,
} from "../recommendation/fixture.js";

export const C28_FIXTURE_TIME = "2029-12-31T22:00:00.000Z";
/** 执行发生时间晚于采纳决定，反馈发生时间晚于执行：三个时点都早于 C25 监测快照 cutoff。 */
export const C28_EXECUTION_TIME = "2029-12-31T23:00:00.000Z";
export const C28_FEEDBACK_TIME = "2030-01-01T00:30:00.000Z";
export const C28_TARGET_INDICATOR = "indicator-consequence-1";
export const C28_TARGET_UNIT = "mm";
export const C28_FORECAST_METHOD = "historical-statistics";
export const C28_FORECAST_REQUIRED_REF = { entityId: "forecast-statistics-model", versionId: "1" };
export const C28_FORECAST_ARTIFACT_PURPOSE = "warning-response.feedback-artifact";
const MEASURE_GR = "measure-grouting";
const C28_MANAGER_LOGIN_NAME = "c25-engine-manager";
const C28_MANAGER_PASSWORD = "c25-engine-manager-password-changed";
const FEEDBACK_ARTIFACT_MEDIA_TYPE = "application/vnd.riskflow.feedback-artifact+json";
const CONFIGURATION_MEDIA_TYPE = "application/vnd.riskflow.assessment-configuration+json";

type ContentArtifactRef = {
  readonly kind: "content-artifact";
  readonly reference: { readonly entityId: string; readonly versionId: string };
};

export interface ForecastSnapshotInputV1 {
  readonly recommendationRef: ResponseRecommendationRefV1;
  readonly routeDecisionRef: VerifiedResponseWorkflowBindingV1["routeDecisionRef"];
  readonly preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1;
  readonly basisRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly forecastPolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly authorizationContextRef: {
    readonly kind: "authorization-context";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
}

export interface ResponseLifecyclePostgresFixtureV1 {
  readonly recommendation: RecommendationPostgresFixtureV1;
  readonly db: Kysely<PostgresDatabase>;
  readonly adapter: PostgresResponseLifecycleAdapter;
  readonly contextReader: PostgresResponseLifecycleContextReader;
  readonly projectId: string;
  readonly managerId: string;
  readonly rootSpatialScopeRef: SpatialScopeRefV1;
  readonly basisReleaseSetRef: {
    readonly kind: "assessment-basis-release-set";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly forecastPolicyReleaseRef: { readonly entityId: string; readonly versionId: string };
  readonly deviationPolicyReleaseRef: { readonly entityId: string; readonly versionId: string };
  readonly riskMatrixReleaseRef: { readonly entityId: string; readonly versionId: string };

  /** 真实 C27 建议链：冻结候选、运行 Agent、记录建议，返回正式建议与基线监测快照。 */
  prepareRecommendation(input: {
    readonly prefix: string;
    readonly assessments?: number;
  }): Promise<{
    readonly recommendationRef: ResponseRecommendationRefV1;
    readonly warningRecordRefs: readonly WarningRecordRefV1[];
    readonly preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1;
    readonly baselineAssessmentInputSnapshotRef: {
      readonly kind: "assessment-input-snapshot";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly riskInputKey: string;
  }>;
  recommendationScope(recommendationRef: ResponseRecommendationRefV1): Promise<SpatialScopeRefV1>;
  spatialScopeFor(scope: "root" | "restricted"): Promise<{
    readonly kind: "spatial-scope";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;

  binding(input: {
    readonly suffix: string;
    readonly recommendationRef: ResponseRecommendationRefV1;
    readonly spatialScopeRef: SpatialScopeRefV1;
  }): VerifiedResponseWorkflowBindingV1;
  forecastSnapshot(input: ForecastSnapshotInputV1): {
    readonly ref: ResponseForecastInputSnapshotRefV1;
    readonly body: ResponseForecastInputSnapshotV1;
  };
  feedbackSnapshot(input: {
    readonly suffix: string;
    readonly executionRecordRef: ExecutionRecordRefV1;
    readonly forecastRef?: EffectForecastRefV1;
  }): {
    readonly ref: ResponseFeedbackInputSnapshotRefV1;
    readonly body: ResponseFeedbackInputSnapshotV1;
  };
  publishFeedbackArtifact(input: { readonly suffix: string }): Promise<ContentArtifactRef>;

  decisionCommand(input: {
    readonly commandId: string;
    readonly decision: "adopted" | "declined";
    readonly binding: VerifiedResponseWorkflowBindingV1;
    readonly spatialScope?: "root" | "restricted";
  }): Promise<{
    readonly schemaVersion: "1";
    readonly binding: VerifiedResponseWorkflowBindingV1;
    readonly command: Extract<WarningResponseRecordCommandV1, { kind: "adopt-recommendation" }>;
  }>;
  forecastCommand(input: {
    readonly commandId: string;
    readonly binding: VerifiedResponseWorkflowBindingV1;
    readonly snapshotRef: ResponseForecastInputSnapshotRefV1;
    readonly snapshot: ResponseForecastInputSnapshotV1;
    readonly spatialScope?: "root" | "restricted";
  }): Promise<{
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly payload: {
      readonly binding: VerifiedResponseWorkflowBindingV1;
      readonly forecastInputSnapshotRef: ResponseForecastInputSnapshotRefV1;
      readonly forecastInputSnapshot: ResponseForecastInputSnapshotV1;
    };
  }>;
  executionCommand(input: {
    readonly commandId: string;
    readonly actionSource: WarningResponseRecordCommandV1 extends { payload: infer P }
      ? P extends { actionSource: infer A }
        ? A
        : never
      : never;
    readonly executedByActorId?: string;
    /** 录入主体，缺省为当前验证主体；用于冒充录入用例。 */
    readonly recordedByActorId?: string;
    readonly occurredAt?: string;
    readonly spatialScope?: "root" | "restricted";
  }): Promise<Extract<WarningResponseRecordCommandV1, { kind: "record-execution" }>>;
  feedbackCommand(input: {
    readonly commandId: string;
    readonly executionRecordRef: ExecutionRecordRefV1;
    readonly postActionMonitoringSnapshotRef: MonitoringSnapshotRefV1;
    readonly feedbackArtifactRef: ContentArtifactRefV1;
    readonly actualAssessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly snapshotRef: ResponseFeedbackInputSnapshotRefV1;
    readonly snapshot: ResponseFeedbackInputSnapshotV1;
    readonly occurredAt?: string;
    readonly spatialScope?: "root" | "restricted";
  }): Promise<{
    readonly schemaVersion: "1";
    readonly command: Extract<WarningResponseRecordCommandV1, { kind: "record-feedback" }>;
    readonly feedbackInputSnapshotRef: ResponseFeedbackInputSnapshotRefV1;
    readonly feedbackInputSnapshot: ResponseFeedbackInputSnapshotV1;
    readonly actualAssessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
  }>;
  deviationCommand(input: {
    readonly commandId: string;
    readonly effectForecastRef: EffectForecastRefV1;
    readonly feedbackRef: FeedbackRefV1;
    readonly frozenAssessmentBasisRef: {
      readonly kind: "assessment-input-snapshot";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly spatialScope?: "root" | "restricted";
  }): Promise<Extract<WarningResponseRecordCommandV1, { kind: "calculate-deviation" }>>;

  recordDecision(command: unknown): Promise<WarningResponseRecordResultV1>;
  forecastResponse(command: unknown): Promise<ResponseForecastResultV1>;
  recordExecution(command: WarningResponseRecordCommandV1): Promise<WarningResponseRecordResultV1>;
  recordFeedback(command: unknown): Promise<WarningResponseRecordResultV1>;
  calculateDeviation(command: WarningResponseRecordCommandV1): Promise<ResponseDeviationResultV1>;
  /** C34 读契约的授权入口：与命令同走真实 C06 签发，身份即调用 id。 */
  readAuthorization(
    invocationId: string,
    spatialScope?: "root" | "restricted",
  ): Promise<AuthorizationContextV1>;
  readDeviationFact(input: {
    readonly requestId: string;
    readonly deviationFactRef: {
      readonly kind: "response-deviation-fact";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly spatialScope?: "root" | "restricted";
    readonly authorization?: AuthorizationContextV1;
  }): Promise<ResponseDeviationFactReadResultV1>;

  /** 执行后 C25 实际评估：真实冻结准备 + prepare + evaluate。 */
  postActionAssessment(input: {
    readonly suffix: string;
    readonly riskInputKey: string;
    readonly monitoringSnapshotRef?: MonitoringSnapshotRefV1;
  }): Promise<{
    readonly monitoringSnapshotRef: MonitoringSnapshotRefV1;
    readonly assessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
  }>;

  /** 覆盖冻结文档正文后重新发布成员工件：摘要与正文必须一起更新。 */
  setForecastPolicies(value: readonly ForecastPolicyV1[]): Promise<void>;
  setDeviationPolicies(value: readonly DeviationPolicyV1[]): Promise<void>;
  /** 发布不覆盖建议目标指标的预测策略文档：表达按精确引用解析不到策略。 */
  setUnmatchedForecastPolicy(): Promise<void>;
  setIndicatorUnit(value: string | null): Promise<void>;
  setExecutors(value: readonly EffectForecastExecutorV1[]): void;
  /** 生产执行器用的同一 C06 下游授权签发：不在测试侧另造一套上下文。 */
  authorizeDownstream: ResponseLifecycleDownstreamAuthorizerV1;
  /** 真实 C25 评估引擎（含窄预测端口），供生产执行器投影预测风险状态。 */
  assessment: ForecastRiskStatePortV1;
  /** 按精确引用发布参数模型工件：正文即模型 Schema，生产读取走真实 C04。 */
  publishForecastModel(input: {
    readonly artifactId: string;
    readonly model: unknown;
  }): Promise<ContentArtifactRef>;
  readonly measureLibraryReleaseRef: { readonly entityId: string; readonly versionId: string };
  setDownstreamScopeExpansion(value: boolean): void;
  setNow(value: string): void;

  countRows(table: ResponseLifecycleTableV1): Promise<number>;
  countCommandRows(table: ResponseLifecycleTableV1, commandId: string): Promise<number>;
  countReceipts(commandKind: string): Promise<number>;
  countAudit(action: string): Promise<number>;
  countEvents(eventType: string, producerCommandId?: string): Promise<number>;
  lastEvent(eventType: string): Promise<Record<string, unknown> | undefined>;
  countDeviationRowsForBasis(basis: string): Promise<number>;
  recommendationRevenueRowCount(recommendationRef: ResponseRecommendationRefV1): Promise<number>;
  preinsertAuditConflict(auditEntryId: string): Promise<void>;
  clearAuditConflict(auditEntryId: string): Promise<void>;
  close(): Promise<void>;
}

export type ResponseLifecycleTableV1 =
  | "response_adoption_decisions"
  | "response_forecast_outcomes"
  | "response_execution_records"
  | "response_feedback_records"
  | "response_deviation_facts";

/** 省略 forecastExecutors 即沿用活数组；生产窄口用例显式传入 resolver 来源。 */
export type C28FixtureOptionsV1 = {
  readonly forecastExecutors?: EffectForecastExecutorSourceV1;
};

export const startResponseLifecycleFixture = async (
  options: C28FixtureOptionsV1 = {},
): Promise<ResponseLifecyclePostgresFixtureV1> => {
  const recommendation = await startRecommendationFixture();
  const db = recommendation.db;
  const projectId = recommendation.projectId;
  const managerId = recommendation.managerId;
  const access: LocalIdentityAccessV1 = recommendation.c26.c25.postgres.access;
  const transactionUnit: TransactionUnitV1 = recommendation.c26.c25.postgres.transactionUnit;
  const artifactStore: ArtifactStoreV1 = recommendation.c26.c25.postgres.artifactStore;
  const adminPool = recommendation.c26.c25.postgres.postgres.adminPool;

  const rootRow = (
    await adminPool.query<{ scope_id: string; current_revision_id: string }>(
      "SELECT scope_id, current_revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [projectId],
    )
  ).rows[0];
  if (rootRow === undefined) throw new Error("C28 fixture requires the C25 root spatial scope");
  const rootSpatialScopeRef = SpatialScopeRefV1Schema.parse({
    kind: "spatial-scope",
    reference: { entityId: rootRow.scope_id, versionId: rootRow.current_revision_id },
  });
  const restrictedSpatialScopeRef = SpatialScopeRefV1Schema.parse({
    kind: "spatial-scope",
    reference: { entityId: "scope-c28-restricted", versionId: "scope-c28-restricted-r1" },
  });
  await adminPool.query(
    `INSERT INTO business.access_spatial_scopes (scope_id, project_id, current_revision_id)
     VALUES ($1, $2, $3) ON CONFLICT (scope_id) DO NOTHING`,
    [
      restrictedSpatialScopeRef.reference.entityId,
      projectId,
      restrictedSpatialScopeRef.reference.versionId,
    ],
  );
  await adminPool.query(
    `INSERT INTO business.access_spatial_scope_revisions
       (revision_id, scope_id, project_id, revision_no, parent_scope_id, status, recorded_by)
     VALUES ($1, $2, $3, 1, $4, 'active', $5) ON CONFLICT (revision_id) DO NOTHING`,
    [
      restrictedSpatialScopeRef.reference.versionId,
      restrictedSpatialScopeRef.reference.entityId,
      projectId,
      rootSpatialScopeRef.reference.entityId,
      managerId,
    ],
  );

  // 下游事实（C14/C19/C04）各自带自己的空间修订：组合根代替品按工程活动空间集合签发精确上下文，
  // 仍受 C06 成员覆盖约束；C28 读者只声明调用方已获授权空间。
  const projectScopeRows = await adminPool.query<{ scope_id: string; revision_id: string }>(
    `SELECT r.scope_id, r.revision_id FROM business.access_spatial_scope_revisions r
         WHERE r.project_id = $1 AND r.status = 'active' ORDER BY r.scope_id, r.revision_id`,
    [projectId],
  );
  const projectSourceRows = await adminPool.query<{
    source_version_id: string;
    version_id: string;
  }>(
    `SELECT source_version_id, version_id FROM business.source_versions
       WHERE project_id = $1 ORDER BY source_version_id, version_id`,
    [projectId],
  );
  const projectSourceVersionRefs = projectSourceRows.rows.map((row) => ({
    kind: "source-version" as const,
    reference: { entityId: row.source_version_id, versionId: row.version_id },
  }));
  const projectScopeRefs = [
    rootSpatialScopeRef,
    ...projectScopeRows.rows.map((row) =>
      SpatialScopeRefV1Schema.parse({
        kind: "spatial-scope",
        reference: { entityId: row.scope_id, versionId: row.revision_id },
      }),
    ),
  ];
  let expandDownstreamScopes = false;
  let currentTime = C28_FIXTURE_TIME;

  const login = await access
    .login({
      kind: "login",
      loginAttemptId: "c28-response-lifecycle-fixture-login",
      loginName: C28_MANAGER_LOGIN_NAME,
      password: C28_MANAGER_PASSWORD,
    })
    .catch((error: unknown) => {
      throw new Error(`C28 fixture requires the C25 manager session: ${String(error)}`);
    });
  const sessionToken = login.sessionToken;
  const authorizeFor = async (input: {
    readonly branch: string;
    readonly invocationId: string;
    readonly requestedAt?: string;
    readonly spatialScopeRefs?: readonly {
      readonly kind: "spatial-scope";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
    readonly sourceVersionRefs?: readonly {
      readonly kind: "source-version";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
  }): Promise<AuthorizationContextV1> =>
    AuthorizationContextV1Schema.parse(
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId: input.invocationId,
          projectId,
          branch: input.branch as "engineering-data.register-source-delivery",
          requestedSpatialScopeRefs: [
            ...(input.spatialScopeRefs ?? [rootSpatialScopeRef]),
          ] as never,
          requestedSourceVersionRefs: [...(input.sourceVersionRefs ?? [])] as never,
          ...(input.requestedAt === undefined ? {} : { requestedAt: input.requestedAt }),
        })
      ).context,
    );

  const publishArtifact = async (input: {
    readonly commandId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly artifactId: string;
    readonly value: unknown;
  }): Promise<ContentArtifactRef> => {
    const authorization = await authorizeFor({
      branch: "engineering-data.register-source-delivery",
      invocationId: `${input.commandId}:put`,
    });
    const result = await artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C28_FIXTURE_TIME,
        authorization,
        requiredCapability: "engineering-data.write",
        artifactId: input.artifactId,
        artifactKind: "content",
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
    return { kind: "content-artifact", reference: result.artifactRef.reference };
  };

  /* ------------------------------------------------------------------------ */
  /* C18 成员：预测策略、偏差策略、指标系统与风险矩阵按精确引用发布为 basis 成员。 */
  /* ------------------------------------------------------------------------ */

  const c28Document = (
    definitionType: string,
    content: unknown,
  ): AssessmentConfigurationDocumentV1 =>
    ({
      schemaVersion: "1",
      definitionType,
      projectRevisionRef: { kind: "project-revision", reference: rootSpatialScopeRef.reference },
      configurationSetRef: c25Version("configuration-set-c25"),
      content,
    }) as AssessmentConfigurationDocumentV1;

  /** 不覆盖建议目标指标的策略文档：用于「按精确引用解析不到策略」的不可用场景。 */
  const unmatchedForecastPolicy = (): ForecastPolicyV1 =>
    ForecastPolicyDocumentV1Schema.parse({
      ...c28Document("forecast-policy", { policies: [] }),
      content: {
        policies: [
          {
            policyId: "c28-forecast-unmatched",
            method: C28_FORECAST_METHOD,
            inputIndicatorIds: ["indicator-possibility-1"],
            targetIndicatorId: "indicator-possibility-1",
            horizonSteps: 3,
            unit: "1",
            requiredRef: { entityId: "forecast-unmatched-model", versionId: "1" },
          },
        ],
      },
    }).content.policies[0]!;

  const defaultForecastPolicy = (): ForecastPolicyV1 =>
    ForecastPolicyDocumentV1Schema.parse({
      ...c28Document("forecast-policy", { policies: [] }),
      content: {
        policies: [
          {
            policyId: "c28-forecast-policy",
            method: C28_FORECAST_METHOD,
            inputIndicatorIds: ["indicator-possibility-1"],
            targetIndicatorId: C28_TARGET_INDICATOR,
            horizonSteps: 5,
            unit: C28_TARGET_UNIT,
            requiredRef: C28_FORECAST_REQUIRED_REF,
          },
        ],
      },
    }).content.policies[0]!;
  let forecastPolicies: readonly ForecastPolicyV1[] = [defaultForecastPolicy()];
  let deviationPolicies: readonly DeviationPolicyV1[] = [
    {
      policyId: "c28-deviation-absolute",
      basis: "absolute",
      threshold: "2",
      evidenceRequirements: ["monitoring-record"],
    },
  ];
  let indicatorUnit: string | null = C28_TARGET_UNIT;
  /** 每次重新发布成员工件都使用新标识：命令幂等不得跨版本复用同一身份。 */
  let configurationRevision = 1;
  /** 执行后监测快照按序列修订递增：C14 只接受紧邻上一修订。 */
  let postActionSeriesVersion = 1;
  /**
   * 已发布成员正文按精确释放引用登记：预测/偏差策略按阶段冻结的精确引用取回同一份发布事实，
   * 与生产组合接 C18 `readPublishedConfigurationMember` 的读取语义一致。
   */
  const publishedConfigurationBodies = new Map<string, { body: unknown; sha256: string }>();
  const referenceKeyOf = (reference: { readonly entityId: string; readonly versionId: string }) =>
    `${reference.entityId}\u0000${reference.versionId}`;

  /** C25 合成配置正文：指标系统与风险矩阵按同一冻结依据复用，避免第二套定义。 */
  const c25Documents = c25ConfigurationDocuments();
  const defaultIndicatorSystem = IndicatorSystemDocumentV1Schema.parse(
    c25Documents["indicator-system"],
  );
  const defaultRiskMatrix = RiskMatrixDocumentV1Schema.parse(c25Documents["risk-matrix"]);

  const publishConfigurationMembers = async (): Promise<
    readonly {
      readonly definitionType: string;
      readonly releaseRef: unknown;
      readonly revisionRef: unknown;
      readonly artifactRef: ContentArtifactRef;
      readonly contentDigest: string;
    }[]
  > => {
    const members: {
      definitionType: string;
      releaseRef: unknown;
      revisionRef: unknown;
      artifactRef: ContentArtifactRef;
      contentDigest: string;
    }[] = [];
    // C19 要求 11 类配置成员按定义类型规范顺序完整覆盖：只覆盖 C28 拥有的四类正文。
    const definitions: readonly {
      readonly definitionType: string;
      readonly document: unknown;
    }[] = ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.map((definitionType) => {
      switch (definitionType) {
        case "forecast-policy":
          return {
            definitionType,
            document: ForecastPolicyDocumentV1Schema.parse({
              ...c28Document(definitionType, { policies: [] }),
              content: { policies: [...forecastPolicies] },
            }),
          };
        case "deviation-policy":
          return {
            definitionType,
            document: DeviationPolicyDocumentV1Schema.parse({
              ...c28Document(definitionType, { policies: [] }),
              content: {
                policies: [...deviationPolicies].sort((left, right) =>
                  left.policyId < right.policyId ? -1 : 1,
                ),
              },
            }),
          };
        case "indicator-system":
          return {
            definitionType,
            document: IndicatorSystemDocumentV1Schema.parse({
              ...c28Document(definitionType, { indicators: [] }),
              content: {
                indicators: defaultIndicatorSystem.content.indicators.map((indicator) =>
                  indicator.indicatorId === C28_TARGET_INDICATOR
                    ? { ...indicator, canonicalUnit: indicatorUnit ?? C28_TARGET_UNIT }
                    : indicator,
                ),
              },
            }),
          };
        case "risk-matrix":
          return {
            definitionType,
            document: RiskMatrixDocumentV1Schema.parse({
              ...c28Document(definitionType, {}),
              content: defaultRiskMatrix.content,
            }),
          };
        default:
          // 其余七类沿用 C25 合成正文：C28 不改写它们，只按精确引用发布为成员。
          return { definitionType, document: c25Documents[definitionType] };
      }
    });
    for (const definition of definitions) {
      const artifactId = `c28-configuration-${definition.definitionType}-r${configurationRevision}`;
      const artifactRef = await publishArtifact({
        commandId: artifactId,
        purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
        mediaType: CONFIGURATION_MEDIA_TYPE,
        artifactId,
        value: definition.document,
      });
      // 重新发布只换修订与成员工件；释放引用仍是同一正式身份，冻结引用继续精确命中。
      publishedConfigurationBodies.set(
        referenceKeyOf(c25ReleaseRef(definition.definitionType).reference),
        { body: definition.document, sha256: c25Digest(definition.document) },
      );
      members.push({
        definitionType: definition.definitionType,
        releaseRef: c25ReleaseRef(definition.definitionType),
        revisionRef: c25RevisionRef(definition.definitionType),
        artifactRef,
        contentDigest: c25Digest(definition.document),
      });
    }
    return members.sort((left, right) => (left.definitionType < right.definitionType ? -1 : 1));
  };

  let configurationMembers = await publishConfigurationMembers();
  const refreshConfigurationMembers = async (): Promise<void> => {
    configurationRevision += 1;
    configurationMembers = await publishConfigurationMembers();
  };

  const basisReader: AssessmentBasisReleaseSetReaderV1 = {
    readAssessmentBasisReleaseSet: async (input) =>
      input.assessmentBasisReleaseSetRef.reference.entityId !== "assessment-basis-c25" ||
      input.assessmentBasisReleaseSetRef.reference.versionId !== "1"
        ? AssessmentBasisReleaseSetReadResultV1Schema.parse({
            kind: "unavailable",
            error: {
              code: "AUTHORIZATION_DENIED",
              category: "authorization",
              retryable: false,
              requiredCapability: "knowledge-modeling.read",
              authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
              stageCode: "c28.basis-read",
              occurredAt: C28_FIXTURE_TIME,
              causalRunId: input.requestId,
            },
          })
        : AssessmentBasisReleaseSetReadResultV1Schema.parse({
            kind: "succeeded",
            schemaVersion: "1",
            assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
            memberDigest: sha256CanonicalJson({ members: configurationMembers }),
            applicableRuleSetMember: {
              releaseRef: c25ReleaseRef("set-applicable-rule-set"),
              revisionRef: c25RevisionRef("set-applicable-rule-set"),
              artifactRef: {
                kind: "content-artifact",
                reference: { entityId: "c28-applicable-rule-set", versionId: "1" },
              },
              contentDigest: c25Digest({ applicableRuleSet: "c28-double" }),
            },
            scoringRuleMembers: [
              {
                releaseRef: c25ReleaseRef("rule-c28-double"),
                revisionRef: c25RevisionRef("rule-c28-double"),
                artifactRef: {
                  kind: "content-artifact",
                  reference: { entityId: "c28-scoring-rule", versionId: "1" },
                },
                contentDigest: c25Digest({ scoringRule: "c28-double" }),
              },
            ],
            configurationMembers,
          }),
  };

  const authorizeDownstream: ResponseLifecycleDownstreamAuthorizerV1 = (
    request: ResponseLifecycleDownstreamAuthorizationRequestV1,
  ) =>
    authorizeFor({
      branch: request.branch,
      invocationId: request.invocationId,
      requestedAt: request.requestedAt,
      spatialScopeRefs: expandDownstreamScopes
        ? [
            ...new Map(
              [...(request.requestedSpatialScopeRefs ?? []), ...projectScopeRefs].map((scope) => [
                `${scope.reference.entityId}\u0000${scope.reference.versionId}`,
                scope,
              ]),
            ).values(),
          ]
        : (request.requestedSpatialScopeRefs ?? []),
      // C14 快照与 C25 输入快照读取各自需要在冻结依据里复验的来源授权：只为这两条分支
      // 补全工程来源授权，其它分支不扩大来源范围。
      sourceVersionRefs:
        request.branch === "engineering-data.monitoring-snapshot-query" ||
        request.branch === "risk-assessment.read-input-snapshot"
          ? projectSourceVersionRefs
          : [],
    });

  /** C19 发布事实接缝：夹具把已发布措施成员作为精确引用事实提供。 */
  const measureReleases: ResponseLifecycleMeasureReleaseReaderV1 = {
    readPublishedMeasureReleases: async (input) => {
      const publishedRef = c25ReleaseRef("measure-library").reference;
      return configurationMembers.some((member) => member.definitionType === "measure-library")
        ? input.measureLibraryReleaseRefs.filter(
            (candidate) =>
              candidate.entityId === publishedRef.entityId &&
              candidate.versionId === publishedRef.versionId,
          )
        : [];
    },
  };

  const contextReader = createPostgresResponseLifecycleContextReader({
    db,
    artifactStore,
    basis: basisReader,
    monitoring: recommendation.c26.c25.postgres.monitoringStore,
    measureReleases,
    authorizeDownstream,
    // 预测/偏差策略按阶段冻结的精确引用读取已发布成员，不塞回评分依据快照。
    readStagePolicy: async (input) =>
      publishedConfigurationBodies.get(referenceKeyOf(input.releaseRef)),
  });

  /** 活数组：夹具按用例替换执行器，adapter 始终读取当前集合，不新增生产测试接缝。 */
  const executors: EffectForecastExecutorV1[] = [];
  const adapter = createPostgresResponseLifecycleAdapter({
    db,
    transactionUnit,
    access,
    reader: contextReader,
    forecastExecutors: options.forecastExecutors ?? executors,
    now: () => new Date(currentTime),
  });

  const basisReleaseSetRef = {
    kind: "assessment-basis-release-set" as const,
    reference: { entityId: "assessment-basis-c25", versionId: "1" },
  };
  const forecastPolicyReleaseRef = c25ReleaseRef("forecast-policy").reference;
  const deviationPolicyReleaseRef = c25ReleaseRef("deviation-policy").reference;
  const riskMatrixReleaseRef = c25ReleaseRef("risk-matrix").reference;

  const countRows = async (table: ResponseLifecycleTableV1): Promise<number> => {
    const result = await adminPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM business.${table} WHERE project_id = $1`,
      [projectId],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  return {
    recommendation,
    db,
    adapter,
    contextReader,
    projectId,
    managerId,
    rootSpatialScopeRef,
    basisReleaseSetRef,
    forecastPolicyReleaseRef,
    deviationPolicyReleaseRef,
    riskMatrixReleaseRef,

    async prepareRecommendation(input) {
      const riskInputKey = `${input.prefix}-risk`;
      const opened = await recommendation.openWarnings({
        commandPrefix: `${input.prefix}-open`,
        assessments: input.assessments ?? 1,
        riskInputKey,
      });
      const query = await recommendation.measureCandidates({
        queryId: `${input.prefix}-query`,
        warningResponseTaskRef: opened.taskRef,
        assessmentRecordRef: opened.assessmentRecordRefs[0]!,
        measureLibraryReleaseRef: recommendation.measureLibraryReleaseRef,
      });
      if (query.kind !== "succeeded") {
        throw new Error(
          `C28 fixture frozen candidates failed: ${JSON.stringify(query).slice(0, 400)}`,
        );
      }
      const queryResultRef = query.result.knowledgeQueryResultRef;
      const agent = await recommendation.runAgent({
        suffix: `${input.prefix}-agent`,
        queryResultRef,
        selections: [{ measureId: MEASURE_GR, order: 1 }],
      });
      if (agent.agentResultRef === undefined || agent.candidateRef === undefined) {
        throw new Error("C28 fixture agent did not produce a candidate");
      }
      const candidate = await recommendation.createCandidate({
        commandId: `${input.prefix}-candidate`,
        warningResponseTaskRef: opened.taskRef,
        measureCandidateQueryResultRef: queryResultRef,
        agentTaskResultRef: agent.agentResultRef,
        responseGenerationPolicyRef: recommendation.generationPolicyRef,
      });
      if (candidate.kind !== "succeeded" || candidate.result.kind !== "candidate") {
        throw new Error(`C28 fixture candidate failed: ${JSON.stringify(candidate).slice(0, 400)}`);
      }
      const recorded = await recommendation.validateAndRecord({
        commandId: `${input.prefix}-record`,
        recommendationCandidateRef: candidate.result.recommendationCandidateRef,
        responseValidationPolicyRef: recommendation.validationPolicyRef,
        siteContextRef: recommendation.siteContextRef,
      });
      if (recorded.kind !== "succeeded" || recorded.result.kind !== "recorded") {
        throw new Error(`C28 fixture record failed: ${JSON.stringify(recorded).slice(0, 400)}`);
      }
      // 只从这条建议链自身的行读取基线：预警引用与其 C25 输入快照必须精确对应。
      const chainRow = await adminPool.query<{
        warning_record_id: string;
        warning_record_version_id: string;
        assessment_record_id: string;
        assessment_record_version_id: string;
      }>(
        `SELECT warning_record_id, warning_record_version_id, assessment_record_id, assessment_record_version_id
           FROM business.response_recommendations
           WHERE project_id = $1 AND recommendation_id = $2 AND version_id = $3`,
        [
          projectId,
          recorded.result.responseRecommendationRef.reference.entityId,
          recorded.result.responseRecommendationRef.reference.versionId,
        ],
      );
      const chain = chainRow.rows[0];
      const baselineSnapshot = await adminPool.query<{
        input_snapshot_id: string;
        input_snapshot_version_id: string;
      }>(
        `SELECT input_snapshot_id, input_snapshot_version_id FROM business.risk_assessment_records
           WHERE project_id = $1 AND record_id = $2 AND version_id = $3`,
        [projectId, chain?.assessment_record_id ?? "", chain?.assessment_record_version_id ?? ""],
      );
      const baseline = baselineSnapshot.rows[0];
      if (chain === undefined || baseline === undefined) {
        throw new Error("C28 fixture requires the persisted recommendation chain");
      }
      return {
        recommendationRef: recorded.result.responseRecommendationRef,
        warningRecordRefs: [
          {
            kind: "warning-record",
            reference: {
              entityId: chain.warning_record_id,
              versionId: chain.warning_record_version_id,
            },
          },
        ],
        preActionMonitoringSnapshotRef: recommendation.c26.c25.monitoringSnapshotRefs[0]!,
        baselineAssessmentInputSnapshotRef: {
          kind: "assessment-input-snapshot",
          reference: {
            entityId: baseline.input_snapshot_id,
            versionId: baseline.input_snapshot_version_id,
          },
        },
        riskInputKey,
      };
    },

    async recommendationScope(recommendationRef) {
      const row = await adminPool.query<{
        spatial_scope_entity_id: string;
        spatial_scope_version_id: string;
      }>(
        `SELECT spatial_scope_entity_id, spatial_scope_version_id FROM business.response_recommendations
           WHERE project_id = $1 AND recommendation_id = $2 AND version_id = $3`,
        [projectId, recommendationRef.reference.entityId, recommendationRef.reference.versionId],
      );
      const value = row.rows[0];
      if (value === undefined) throw new Error("C28 fixture recommendation row is missing");
      return SpatialScopeRefV1Schema.parse({
        kind: "spatial-scope",
        reference: {
          entityId: value.spatial_scope_entity_id,
          versionId: value.spatial_scope_version_id,
        },
      });
    },

    async spatialScopeFor(scope) {
      return scope === "root" ? rootSpatialScopeRef : restrictedSpatialScopeRef;
    },

    binding(input) {
      return {
        schemaVersion: "1",
        projectId,
        responseRecommendationRef: input.recommendationRef,
        spatialScopeRef: input.spatialScopeRef,
        routeDecisionRef: {
          kind: "route-decision",
          reference: { entityId: `route-decision-${input.suffix}`, versionId: "1" },
        },
        forecastRunRef: {
          kind: "workflow-run",
          reference: { entityId: `forecast-run-${input.suffix}`, versionId: "1" },
        },
        boundAt: C28_FIXTURE_TIME,
      };
    },

    forecastSnapshot(input) {
      return {
        ref: {
          kind: "response-forecast-input-snapshot",
          reference: {
            entityId: `forecast-input-${input.recommendationRef.reference.entityId}`,
            versionId: "1",
          },
        },
        body: ResponseForecastInputSnapshotV1Schema.parse({
          schemaVersion: "1",
          responseRecommendationRef: input.recommendationRef,
          adoptionDecisionRef: input.routeDecisionRef,
          preActionMonitoringSnapshotRef: input.preActionMonitoringSnapshotRef,
          frozenAssessmentBasisRef: {
            kind: "assessment-input-snapshot",
            reference: input.basisRef.reference,
          },
          forecastPolicyRef: input.forecastPolicyRef,
          authorizationContextRef: input.authorizationContextRef,
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: "audit-c28-forecast-input", versionId: "1" },
          },
          createdBy: managerId,
          createdAt: C28_FIXTURE_TIME,
        }),
      };
    },

    feedbackSnapshot(input) {
      return {
        ref: {
          kind: "response-feedback-input-snapshot",
          reference: {
            entityId: `feedback-input-${input.executionRecordRef.reference.entityId}`,
            versionId: "1",
          },
        },
        body: ResponseFeedbackInputSnapshotV1Schema.parse({
          schemaVersion: "1",
          executionRecordRef: input.executionRecordRef,
          feedbackRef: {
            kind: "feedback",
            reference: {
              entityId: `feedback-snapshot-${input.suffix}`,
              versionId: "1",
            },
          },
          ...(input.forecastRef === undefined ? {} : { effectForecastRef: input.forecastRef }),
          // 阶段冻结的是 C18 已发布成员的释放引用：偏差事实、窄读投影都以该引用为准。
          deviationPolicyRef: c25ReleaseRef("deviation-policy").reference,
          calibrationAgentPolicyRef: c25Version("calibration-agent-policy"),
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "authorization-c28-feedback-input", versionId: "1" },
          },
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: "audit-c28-feedback-input", versionId: "1" },
          },
          createdBy: managerId,
          createdAt: C28_FIXTURE_TIME,
        }),
      };
    },

    async publishFeedbackArtifact(input) {
      return publishArtifact({
        commandId: `c28-feedback-artifact-${input.suffix}`,
        purposeCode: C28_FORECAST_ARTIFACT_PURPOSE,
        mediaType: FEEDBACK_ARTIFACT_MEDIA_TYPE,
        artifactId: `c28-feedback-artifact-${input.suffix}`,
        value: { schemaVersion: "1", observation: `feedback-${input.suffix}` },
      });
    },

    async decisionCommand(input) {
      const spatialScopeRef = await this.spatialScopeFor(input.spatialScope ?? "root");
      return {
        schemaVersion: "1",
        binding: input.binding,
        command: WarningResponseRecordCommandV1Schema.parse({
          kind: "adopt-recommendation",
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId,
          actorId: managerId,
          issuedAt: C28_FIXTURE_TIME,
          authorization: await authorizeFor({
            branch: "warning-response.adopt-recommendation",
            invocationId: input.commandId,
            spatialScopeRefs: [spatialScopeRef],
          }),
          payload: {
            responseRecommendationRef: input.binding.responseRecommendationRef,
            decision: input.decision,
            reasonCode: input.decision === "adopted" ? "field-verified" : "not-applicable",
          },
        }) as Extract<WarningResponseRecordCommandV1, { kind: "adopt-recommendation" }>,
      };
    },

    async forecastCommand(input) {
      const spatialScopeRef = await this.spatialScopeFor(input.spatialScope ?? "root");
      return {
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C28_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "warning-response.adopt-recommendation",
          invocationId: input.commandId,
          spatialScopeRefs: [spatialScopeRef],
        }),
        payload: {
          binding: input.binding,
          forecastInputSnapshotRef: input.snapshotRef,
          forecastInputSnapshot: input.snapshot,
        },
      };
    },

    async executionCommand(input) {
      const spatialScopeRef = await this.spatialScopeFor(input.spatialScope ?? "root");
      return WarningResponseRecordCommandV1Schema.parse({
        kind: "record-execution",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C28_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "warning-response.record-execution",
          invocationId: input.commandId,
          spatialScopeRefs: [spatialScopeRef],
        }),
        payload: {
          actionSource: input.actionSource,
          executedByActorId: input.executedByActorId ?? managerId,
          recordedByActorId: input.recordedByActorId ?? managerId,
          occurredAt: input.occurredAt ?? C28_EXECUTION_TIME,
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "c28-execution-evidence" },
              sourceVersion: { entityId: "source-version-c28", versionId: "1" },
            },
          ],
        },
      }) as Extract<WarningResponseRecordCommandV1, { kind: "record-execution" }>;
    },

    async feedbackCommand(input) {
      const spatialScopeRef = await this.spatialScopeFor(input.spatialScope ?? "root");
      const command = WarningResponseRecordCommandV1Schema.parse({
        kind: "record-feedback",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C28_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "warning-response.record-feedback",
          invocationId: input.commandId,
          spatialScopeRefs: [spatialScopeRef],
        }),
        payload: {
          executionRecordRef: input.executionRecordRef,
          postActionMonitoringSnapshotRef: input.postActionMonitoringSnapshotRef,
          feedbackArtifactRef: input.feedbackArtifactRef,
          occurredAt: input.occurredAt ?? C28_FEEDBACK_TIME,
        },
      }) as Extract<WarningResponseRecordCommandV1, { kind: "record-feedback" }>;
      return {
        schemaVersion: "1",
        command,
        feedbackInputSnapshotRef: input.snapshotRef,
        feedbackInputSnapshot: {
          ...input.snapshot,
          authorizationContextRef: command.authorization.authorizationContextRef,
        },
        actualAssessmentRecordRef: input.actualAssessmentRecordRef,
      };
    },

    async deviationCommand(input) {
      const spatialScopeRef = await this.spatialScopeFor(input.spatialScope ?? "root");
      return WarningResponseRecordCommandV1Schema.parse({
        kind: "calculate-deviation",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C28_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "warning-response.calculate-deviation",
          invocationId: input.commandId,
          spatialScopeRefs: [spatialScopeRef],
        }),
        payload: {
          effectForecastRef: input.effectForecastRef,
          feedbackRef: input.feedbackRef,
          frozenAssessmentBasisRef: input.frozenAssessmentBasisRef,
        },
      }) as Extract<WarningResponseRecordCommandV1, { kind: "calculate-deviation" }>;
    },

    async recordDecision(command) {
      return WarningResponseRecordResultV1Schema.parse(await adapter.recordDecision(command));
    },
    async forecastResponse(command) {
      return ResponseForecastResultV1Schema.parse(await adapter.forecastResponse(command));
    },
    async recordExecution(command) {
      return WarningResponseRecordResultV1Schema.parse(await adapter.recordExecution(command));
    },
    async recordFeedback(command) {
      return WarningResponseRecordResultV1Schema.parse(await adapter.recordFeedback(command));
    },
    async calculateDeviation(command) {
      return ResponseDeviationResultV1Schema.parse(await adapter.calculateDeviation(command));
    },
    async readAuthorization(invocationId, spatialScope) {
      const scopeRefs =
        spatialScope === "restricted" ? [restrictedSpatialScopeRef] : [rootSpatialScopeRef];
      return authorizeFor({
        branch: "warning-response.read",
        invocationId,
        spatialScopeRefs: scopeRefs,
      });
    },
    async readDeviationFact(input) {
      return adapter.readDeviationFact({
        requestId: input.requestId,
        idempotencyKey: input.requestId,
        requestedAt: C28_FIXTURE_TIME,
        authorization:
          input.authorization ??
          (await authorizeFor({
            branch: "warning-response.calculate-deviation",
            invocationId: input.requestId,
            spatialScopeRefs: [await this.spatialScopeFor(input.spatialScope ?? "root")],
          })),
        deviationFactRef: input.deviationFactRef,
      });
    },

    async postActionAssessment(input) {
      // 同序列后续修订：执行后快照必须覆盖原准备阶段的全部监测序列。
      const monitoringSnapshotRefs = await (async () => {
        if (input.monitoringSnapshotRef !== undefined) return [input.monitoringSnapshotRef];
        postActionSeriesVersion += 1;
        const seriesVersion = String(postActionSeriesVersion);
        return Promise.all(
          [
            {
              seriesId: "c25-series-settlement",
              canonicalUnit: "mm",
              values: [7.5, 8, 8.5, 9, 9.5],
            },
            {
              seriesId: "c25-series-water-level",
              canonicalUnit: "m",
              values: [11, 11.2, 11.5, 11.8, 12],
            },
            {
              seriesId: "c25-series-cutter-frequency",
              canonicalUnit: "Hz",
              values: [0.45, 0.5, 0.55, 0.6, 0.65],
            },
          ].map((entry) => recommendation.c26.c25.seriesVariant({ ...entry, seriesVersion })),
        );
      })();
      const monitoringSnapshotRef = monitoringSnapshotRefs[0]!;
      const preparation = await recommendation.c26.c25.freezePreparation({
        suffix: input.suffix,
        entryMode: "assess",
        triggerReasonCode: "post-action-monitoring",
        monitoringSnapshotRefs: [...monitoringSnapshotRefs],
        riskInput: {
          kind: "standardized-risk-record",
          reference: { entityId: `risk-record-${input.riskInputKey}`, versionId: "1" },
        },
      });
      const prepared = await recommendation.c26.c25.engine.prepare(
        await recommendation.c26.c25.prepareCommand({
          commandId: `c28-post-prepare-${input.suffix}`,
          preparation,
        }),
      );
      if (prepared.kind !== "succeeded") {
        throw new Error(
          `C28 post-action prepare failed: ${JSON.stringify(prepared).slice(0, 400)}`,
        );
      }
      const evaluated = await recommendation.c26.c25.engine.evaluate(
        await recommendation.c26.c25.evaluateCommand({
          commandId: `c28-post-evaluate-${input.suffix}`,
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        }),
      );
      if (evaluated.kind !== "succeeded") {
        throw new Error(
          `C28 post-action evaluate failed: ${JSON.stringify(evaluated).slice(0, 400)}`,
        );
      }
      return {
        monitoringSnapshotRef,
        assessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: evaluated.result.assessmentRecordRef.reference,
        },
      };
    },

    async setForecastPolicies(value) {
      forecastPolicies = value;
      await refreshConfigurationMembers();
    },
    async setUnmatchedForecastPolicy() {
      forecastPolicies = [unmatchedForecastPolicy()];
      await refreshConfigurationMembers();
    },
    async setDeviationPolicies(value) {
      deviationPolicies = value;
      await refreshConfigurationMembers();
    },
    async setIndicatorUnit(value) {
      indicatorUnit = value;
      await refreshConfigurationMembers();
    },
    setExecutors(value) {
      executors.splice(0, executors.length, ...value);
    },
    authorizeDownstream,
    assessment: recommendation.c26.c25.engine,
    async publishForecastModel(input) {
      return await publishArtifact({
        commandId: `c28-model-${input.artifactId}`,
        purposeCode: EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
        mediaType: EFFECT_FORECAST_MODEL_MEDIA_TYPE_V1,
        artifactId: input.artifactId,
        value: input.model,
      });
    },
    measureLibraryReleaseRef: recommendation.measureLibraryReleaseRef.reference,
    setDownstreamScopeExpansion(value) {
      expandDownstreamScopes = value;
    },
    setNow(value) {
      currentTime = value;
    },

    countRows,
    async countCommandRows(table, commandId) {
      const result = await adminPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM business.${table} WHERE project_id = $1 AND command_id = $2`,
        [projectId, commandId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countReceipts(commandKind) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2",
        [projectId, commandKind],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countAudit(action) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2",
        [projectId, action],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countEvents(eventType, producerCommandId) {
      const result = await adminPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM outbox.events
           WHERE project_id = $1 AND event_type = $2
             ${producerCommandId === undefined ? "" : "AND producer_command_id = $3"}`,
        producerCommandId === undefined
          ? [projectId, eventType]
          : [projectId, eventType, producerCommandId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async lastEvent(eventType) {
      const result = await adminPool.query<{ event_json: Record<string, unknown> }>(
        `SELECT event_json FROM outbox.events WHERE project_id = $1 AND event_type = $2
             ORDER BY persisted_at DESC, event_id DESC LIMIT 1`,
        [projectId, eventType],
      );
      return result.rows[0]?.event_json;
    },
    async countDeviationRowsForBasis(basis) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.response_deviation_facts WHERE project_id = $1 AND basis = $2",
        [projectId, basis],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async recommendationRevenueRowCount(recommendationRef) {
      const result = await adminPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM business.response_recommendations
           WHERE project_id = $1 AND recommendation_id = $2 AND version_id = $3`,
        [projectId, recommendationRef.reference.entityId, recommendationRef.reference.versionId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async preinsertAuditConflict(auditEntryId) {
      await adminPool.query(
        `INSERT INTO audit.entries (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref, version_ref, occurred_at, recorded_at, command_id, idempotency_key)
         VALUES ($1, $2, 'c28.fixture.conflict', '{"kind":"response-recommendation","reference":{"entityId":"c28-fixture","versionId":"1"}}', $3, '{"kind":"authorization-context","reference":{"entityId":"c28-fixture","versionId":"1"}}', '{"entityId":"c28-fixture","versionId":"1"}', NOW(), NOW(), $1, $1)
         ON CONFLICT (audit_entry_id) DO NOTHING`,
        [auditEntryId, projectId, managerId],
      );
    },
    async clearAuditConflict(auditEntryId) {
      await adminPool.query("DELETE FROM audit.entries WHERE audit_entry_id = $1", [auditEntryId]);
    },
    async close() {
      await recommendation.close();
    },
  };
};
