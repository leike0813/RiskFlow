/**
 * C26 PostgreSQL 组合夹具：真实 C03/C06/C07 + 正式 C25 评估链 + 本 change 的 warning adapter。
 * 上游评估事实一律经 C25 正式 adapter 持久化，策略由部署形态的精确引用提供者注入。
 */
import type { Kysely } from "kysely";

import {
  failWarningLifecycle,
  type InAppNotificationPolicyV1,
  type WarningAggregationPolicyV1,
  type WarningRuntimePolicyProviderV1,
} from "@riskflow/core/warning";
import {
  OpenWarningCommandV1Schema,
  WarningResponseRecordCommandV1Schema,
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type OpenWarningCommandV1,
  type RiskAssessmentRecordRefV1,
  type WarningRecordRefV1,
  type WarningResponseRecordCommandV1,
  type WarningResponseTaskRefV1,
} from "@riskflow/contracts/ports";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import type { VersionReference } from "@riskflow/contracts/common";

import {
  createPostgresIdempotentConsumer,
  type PostgresIdempotentConsumerHandle,
} from "../../src/postgres/index.js";
import {
  PostgresWarningAssessmentContextReader,
  createPostgresWarningLifecycleAdapter,
  type PostgresWarningLifecycleAdapter,
  type WarningResponseCalibrationReaderV1,
  type WarningResponseLifecycleReaderV1,
  type WarningResponseRecommendationReaderV1,
  type WarningResponseRouteDecisionReaderV1,
} from "../../src/warning/index.js";
import type { PostgresDatabase } from "../../src/postgres/types.js";
import {
  startRiskAssessmentEngineFixture,
  type RiskAssessmentEngineFixtureV1,
} from "../risk-assessment/fixture.js";
import { c25RuntimePolicySet } from "../../../core/test/risk-assessment/fixture.js";
import type { AssessmentConfigurationDocumentsV1 } from "../../../core/test/assessment-config/fixture.js";

export const C26_FIXTURE_TIME = "2032-05-06T07:08:09.000Z";
const FOREIGN_PROJECT_ID = "project-c26-warning-foreign";
/** 与 C25 组合夹具一致的成员身份：登录名与换密后口令由该夹具固定。 */
const C25_MANAGER_LOGIN_NAME = "c25-engine-manager";
const C25_MANAGER_PASSWORD = "c25-engine-manager-password-changed";

export interface AssessmentWithTriggersV1 {
  readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  readonly triggerTypes: readonly string[];
  readonly riskLevel: string;
  readonly evidenceSegmentIds: readonly string[];
}

export interface WarningLifecyclePostgresFixtureV1 {
  readonly c25: RiskAssessmentEngineFixtureV1;
  readonly db: Kysely<PostgresDatabase>;
  readonly adapter: PostgresWarningLifecycleAdapter;
  /**
   * C03 PostgreSQL 幂等消费者（与本夹具同一模块图）。
   * 事务绑定把 Kysely 事务挂在模块级 WeakMap 上，因此消费与投递必须来自同一份 adapters 模块。
   */
  readonly consumer: PostgresIdempotentConsumerHandle;
  readonly projectId: string;
  readonly managerId: string;
  readonly recipients: readonly string[];
  readonly aggregationPolicyRef: VersionReference;
  readonly notificationPolicyRef: VersionReference;
  /** 真实 C25 assessment → 持久化记录：经 C25 正式 adapter 冻结准备、prepare 与 evaluate。 */
  assess(input: { readonly suffix: string }): Promise<AssessmentWithTriggersV1>;
  openCommand(input: {
    readonly commandId: string;
    readonly idempotencyKey?: string;
    readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  }): Promise<OpenWarningCommandV1>;
  acknowledgeCommand(input: {
    readonly commandId: string;
    readonly idempotencyKey?: string;
    readonly warningRecordRef: WarningRecordRefV1;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
  }): Promise<WarningResponseRecordCommandV1>;
  /** 未获准工程的身份声明命令：服务端必须在读取目标前失败闭合。 */
  foreignOpenCommand(input: {
    readonly commandId: string;
    readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  }): OpenWarningCommandV1;
  /** 同工程但仅获准另一空间的命令，用于验证目标存在与否均不可枚举。 */
  spatiallyRestrictedOpenCommand(input: {
    readonly commandId: string;
    readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  }): Promise<OpenWarningCommandV1>;
  /** 只按精确引用解析；`missing` 让提供者表现为未解析到策略（失败闭合用例）。 */
  /** C34 读契约的授权入口：与命令同走真实 C06 签发，身份即 queryId。 */
  readAuthorization(
    queryId: string,
    spatialScopeRefs?: readonly unknown[],
  ): Promise<AuthorizationContextV1>;
  /** 未获准空间的读授权：用于验证目标存在与否均不可枚举。 */
  restrictedReadAuthorization(
    queryId: string,
    spatialScopeRefs: readonly unknown[],
  ): Promise<AuthorizationContextV1>;
  /** 显式未接线的所属读依赖覆盖：按用例需要注入真实 C27/C41 窄读。 */
  withOwningReaders(readers: {
    readonly recommendations?: WarningResponseRecommendationReaderV1;
    readonly routeDecisions?: WarningResponseRouteDecisionReaderV1;
    readonly calibration?: WarningResponseCalibrationReaderV1;
  }): PostgresWarningLifecycleAdapter;
  /** 未获准空间的精确范围引用：用于验证目标存在与否均不可枚举。 */
  readonly restrictedScopeRef: {
    readonly kind: "spatial-scope";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  /** 真实触发一次幂等投递：与 Worker 同一事件、同一消费者、同一事务边界。 */
  deliverInApp(input: {
    /** 产生该预警事件的真实命令身份：投递按这条已登记事件触发，不手工拼造事件。 */
    readonly producerCommandId: string;
    readonly warningRecordRef: WarningRecordRefV1;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    readonly notificationIntentRefs: readonly NotificationIntentRefV1[];
  }): Promise<void>;
  setPolicyAvailability(value: "available" | "missing"): void;
  setNotificationPolicy(recipients: readonly string[]): void;
  warningRows(input: { readonly assessmentRecordRef: RiskAssessmentRecordRefV1 }): Promise<
    readonly {
      readonly warningRecordId: string;
      readonly versionId: string;
      readonly triggerType: string;
      readonly payload: unknown;
      readonly contentDigest: string;
      readonly auditEntryId: string;
      readonly idempotencyKey: string;
    }[]
  >;
  taskRows(): Promise<
    readonly {
      readonly taskId: string;
      readonly status: string;
      readonly currentVersionId: string;
      readonly riskInputEntityId: string;
      readonly spatialScopeEntityId: string;
    }[]
  >;
  taskVersionRows(
    taskId: string,
  ): Promise<readonly { readonly versionId: string; readonly status: string }[]>;
  /** 任务的空间身份是否可回溯到其预警引用的 C25 准备快照。 */
  taskSpatialScopeTrace(taskId: string): Promise<string | undefined>;
  taskLinkRows(taskId: string): Promise<
    readonly {
      readonly warningRecordId: string;
      readonly warningRecordVersionId: string;
      readonly firstIncludedVersionId: string;
    }[]
  >;
  intentRows(warningRecordId: string): Promise<
    readonly {
      readonly intentId: string;
      readonly intentVersionId: string;
      readonly recipientActorId: string;
      readonly channel: string;
      readonly taskId: string;
      readonly taskVersionId: string;
      readonly notificationPolicyEntityId: string;
    }[]
  >;
  notificationRows(
    intentIds: readonly string[],
  ): Promise<readonly { readonly intentId: string; readonly recipientActorId: string }[]>;
  acknowledgementRows(input: {
    readonly warningRecordRef: WarningRecordRefV1;
  }): Promise<
    readonly { readonly acknowledgedByActorId: string; readonly taskVersionId: string }[]
  >;
  countRows(table: string): Promise<number>;
  countEvents(eventType: string, producerCommandId?: string): Promise<number>;
  lastEvent(eventType: string): Promise<DomainEventV1 | undefined>;
  events(eventType: string): Promise<readonly DomainEventV1[]>;
  consumerReceipt(
    consumerName: string,
    eventId: string,
  ): Promise<
    | {
        readonly status: string;
        readonly attemptCount: number;
        readonly resultRef: unknown;
        readonly lastErrorCode: string | null;
      }
    | undefined
  >;
  countReceipts(commandKind: string): Promise<number>;
  countAuditEntries(action: string): Promise<number>;
  /** 直接按 DB 边界关闭任务：C26 不提供关闭命令，后续处置流程拥有该状态。 */
  closeTask(taskId: string): Promise<void>;
  /** 预置审计主键冲突：open 事务内的审计写入真实失败，用于整体回滚证据。 */
  preinsertAuditConflict(commandId: string): Promise<void>;
  clearAuditConflict(commandId: string): Promise<void>;
  assessWithMissingAssessment(): Promise<RiskAssessmentRecordRefV1>;
  close(): Promise<void>;
}

export const startWarningLifecycleFixture = async (
  options: {
    /** 透传给 C25 组合夹具的配置正文覆盖；缺省保持既有合成内容。 */
    readonly configurationDocuments?: AssessmentConfigurationDocumentsV1;
  } = {},
): Promise<WarningLifecyclePostgresFixtureV1> => {
  const c25 = await startRiskAssessmentEngineFixture(options);
  const db = c25.postgres.runtime.db;
  const projectId = c25.projectId;
  const access = c25.postgres.access;
  const adminPool = c25.postgres.postgres.adminPool;
  const runtimePolicies = c25RuntimePolicySet();
  const aggregationPolicyRef = runtimePolicies.warningAggregationPolicyRef;
  const notificationPolicyRef = runtimePolicies.notificationPolicyRef;
  const defaultRecipients = ["actor-c26-field-a", "actor-c26-field-b"];

  const login = await access
    .login({
      kind: "login",
      loginAttemptId: "c26-warning-fixture-login",
      loginName: C25_MANAGER_LOGIN_NAME,
      password: C25_MANAGER_PASSWORD,
    })
    .catch((error: unknown) => {
      throw new Error(`C26 fixture requires the C25 manager session: ${String(error)}`);
    });
  const sessionToken = login.sessionToken;
  const rootRow = await adminPool.query<{ scope_id: string; revision_id: string }>(
    "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
    [projectId],
  );
  const authorizationFor = async (input: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly spatialScopeRefs?: readonly unknown[];
  }): Promise<AuthorizationContextV1> =>
    (
      await access.authorize({
        invocation: { kind: "human-session", sessionToken },
        invocationId: input.invocationId,
        projectId,
        branch: input.branch,
        requestedSpatialScopeRefs: [
          ...((input.spatialScopeRefs ?? [
            {
              kind: "spatial-scope" as const,
              reference: {
                entityId: rootRow.rows[0]!.scope_id,
                versionId: rootRow.rows[0]!.revision_id,
              },
            },
          ]) as never[]),
        ] as never,
        requestedSourceVersionRefs: [],
        requestedAt: C26_FIXTURE_TIME,
      })
    ).context;

  const restrictedScopeRef = {
    kind: "spatial-scope" as const,
    reference: {
      entityId: "scope-c26-restricted",
      versionId: "scope-c26-restricted-r1",
    },
  };
  await adminPool.query(
    `INSERT INTO business.access_spatial_scopes (scope_id, project_id, current_revision_id)
       VALUES ($1, $2, $3)`,
    [restrictedScopeRef.reference.entityId, projectId, restrictedScopeRef.reference.versionId],
  );
  await adminPool.query(
    `INSERT INTO business.access_spatial_scope_revisions
         (revision_id, scope_id, project_id, revision_no, parent_scope_id, status, recorded_by)
       VALUES ($1, $2, $3, 1, $4, 'active', $5)`,
    [
      restrictedScopeRef.reference.versionId,
      restrictedScopeRef.reference.entityId,
      projectId,
      rootRow.rows[0]!.scope_id,
      c25.managerId,
    ],
  );

  const aggregationPolicy: WarningAggregationPolicyV1 = {
    schemaVersion: "1",
    policyRef: aggregationPolicyRef,
    projectId,
    responseDirectionByTriggerType: {
      风险等级超过风险可接受阈值: "评估并制定处置方案",
      监测指标越限: "加密监测并复核处置范围",
      "趋势/加速度/异常评分越限": "趋势复核与现场核查",
      多指标联合规则命中: "联合规则专项处置",
    },
  };
  let notificationPolicy: InAppNotificationPolicyV1 = {
    schemaVersion: "1",
    policyRef: notificationPolicyRef,
    projectId,
    channel: "in-app",
    recipientActorIds: [...defaultRecipients],
  };
  let policyAvailability: "available" | "missing" = "available";
  const policyProvider: WarningRuntimePolicyProviderV1 = {
    read: async (input) => {
      if (policyAvailability === "missing") {
        failWarningLifecycle("policy-unavailable", {
          kind: "assessment-input-snapshot",
          reference: { entityId: "c26-fixture-policy", versionId: "1" },
        });
      }
      const matchesAggregation =
        input.warningAggregationPolicyRef === undefined ||
        (input.warningAggregationPolicyRef.entityId === aggregationPolicy.policyRef.entityId &&
          input.warningAggregationPolicyRef.versionId === aggregationPolicy.policyRef.versionId);
      const matchesNotification =
        input.notificationPolicyRef === undefined ||
        (input.notificationPolicyRef.entityId === notificationPolicy.policyRef.entityId &&
          input.notificationPolicyRef.versionId === notificationPolicy.policyRef.versionId);
      if (!matchesAggregation || !matchesNotification) {
        failWarningLifecycle("policy-unavailable", {
          kind: "assessment-input-snapshot",
          reference: aggregationPolicyRef,
        });
      }
      return {
        schemaVersion: "1",
        projectId,
        warningAggregationPolicy: aggregationPolicy,
        notificationPolicy,
      };
    },
  };

  const reader = new PostgresWarningAssessmentContextReader({ db });
  const consumer = createPostgresIdempotentConsumer(c25.postgres.postgres.worker);
  // 动作门控按用途逐次签发下游授权：与 C25 夹具同一真实 C06 签发路径。
  const authorizeDownstream = (request: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs?: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1> =>
    authorizationFor({
      branch: request.branch,
      invocationId: request.invocationId,
      spatialScopeRefs: request.requestedSpatialScopeRefs,
    });
  // C27 正式建议与 C41 终局决定分属两个拥有方，本夹具不跨域代写：需要这些事实的用例
  // 由各拥有方自己的夹具覆盖，这里显式未接线，一旦被误调用立即失败。
  const unwiredOwningReader = (label: string): never => {
    throw new Error(`C26 fixture seam 之外的所属读依赖未接线：${label}`);
  };
  /** 未接线的有界关系页按接缝契约返回失败结果：消费方据此收口成稳定失败码。 */
  const unwiredRelationPage = (label: string) => {
    void label;
    return { kind: "failed", error: { code: "OWNING_READ_SEAM_NOT_INJECTED" } } as const;
  };
  const unwiredRecommendations: WarningResponseRecommendationReaderV1 = {
    readRecommendationView: () => unwiredOwningReader("recommendations.readRecommendationView"),
    readRecommendationRefsForTask: () => unwiredRelationPage("readRecommendationRefsForTask"),
    resolveRecommendationRefs: () => unwiredRelationPage("resolveRecommendationRefs"),
  };
  const unwiredRouteDecisions: WarningResponseRouteDecisionReaderV1 = {
    readRouteDecision: () => unwiredOwningReader("routeDecisions.readRouteDecision"),
  };
  const unwiredCalibration: WarningResponseCalibrationReaderV1 = {
    readCalibrationView: () => unwiredOwningReader("calibration.readCalibrationView"),
    readCalibrationRefsForDeviationFacts: () =>
      unwiredRelationPage("readCalibrationRefsForDeviationFacts"),
    readDeviationRecordForDeviationFact: () =>
      unwiredRelationPage("readDeviationRecordForDeviationFact"),
    resolveCalibrationRefs: () => unwiredRelationPage("resolveCalibrationRefs"),
  };
  const unwiredLifecycle: WarningResponseLifecycleReaderV1 = {
    readForecastView: () => unwiredOwningReader("lifecycle.readForecastView"),
    readExecutionView: () => unwiredOwningReader("lifecycle.readExecutionView"),
    readFeedbackView: () => unwiredOwningReader("lifecycle.readFeedbackView"),
    readDecisionRefsForRecommendations: () =>
      unwiredRelationPage("readDecisionRefsForRecommendations"),
    readForecastRefsForRecommendations: () =>
      unwiredRelationPage("readForecastRefsForRecommendations"),
    readExecutionRefsForRecommendations: () =>
      unwiredRelationPage("readExecutionRefsForRecommendations"),
    readFeedbackRefsForRecommendations: () =>
      unwiredRelationPage("readFeedbackRefsForRecommendations"),
    readDeviationFactRefsForRecommendations: () =>
      unwiredRelationPage("readDeviationFactRefsForRecommendations"),
    resolveLifecycleRefs: () => unwiredRelationPage("resolveLifecycleRefs"),
  };
  const adapter = createPostgresWarningLifecycleAdapter({
    db,
    transactionUnit: c25.postgres.transactionUnit,
    access,
    assessmentContext: reader,
    runtimePolicies: policyProvider,
    authorizeDownstream,
    recommendations: unwiredRecommendations,
    routeDecisions: unwiredRouteDecisions,
    lifecycle: unwiredLifecycle,
    calibration: unwiredCalibration,
    now: () => new Date(C26_FIXTURE_TIME),
  });

  const readRecordedEvent = async (commandId: string): Promise<DomainEventV1 | undefined> => {
    const row = await adminPool.query<{ event_json: unknown }>(
      `SELECT event_json FROM outbox.events
        WHERE project_id = $1 AND producer_command_id = $2 AND event_type = 'warning.warning-recorded.v1'
        ORDER BY persisted_at DESC, event_id DESC LIMIT 1`,
      [projectId, commandId],
    );
    const parsed = DomainEventV1Schema.safeParse(row.rows[0]?.event_json);
    return parsed.success ? parsed.data : undefined;
  };

  const assess = async (input: { readonly suffix: string }): Promise<AssessmentWithTriggersV1> => {
    const preparation = await c25.freezePreparation({
      suffix: input.suffix,
      entryMode: "assess",
      triggerReasonCode: "manual-assessment",
      monitoringSnapshotRefs: c25.monitoringSnapshotRefs,
    });
    const prepared = await c25.engine.prepare(
      (await c25.prepareCommand({
        commandId: `c26-prepare-${input.suffix}`,
        preparation,
      })) as never,
    );
    if (prepared.kind !== "succeeded") {
      throw new Error(`C26 fixture prepare failed: ${JSON.stringify(prepared).slice(0, 400)}`);
    }
    const evaluated = await c25.engine.evaluate(
      (await c25.evaluateCommand({
        commandId: `c26-evaluate-${input.suffix}`,
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    if (evaluated.kind !== "succeeded") {
      throw new Error(`C26 fixture evaluate failed: ${JSON.stringify(evaluated).slice(0, 400)}`);
    }
    const assessmentRecordRef = evaluated.result.assessmentRecordRef;
    const row = await adminPool.query<{
      record_payload: {
        riskLevel: string;
        triggerIndicators: readonly { triggerType: string }[];
        evidenceReferences: readonly { locator: { sourceSegmentId: string } }[];
        indicatorResults: readonly {
          evidenceReferences: readonly { locator: { sourceSegmentId: string } }[];
        }[];
      };
    }>(
      "SELECT record_payload FROM business.risk_assessment_records WHERE project_id = $1 AND record_id = $2 AND version_id = $3",
      [projectId, assessmentRecordRef.reference.entityId, assessmentRecordRef.reference.versionId],
    );
    const payload = row.rows[0]?.record_payload;
    if (payload === undefined) throw new Error("C26 fixture assessment record is not persisted");
    return {
      assessmentRecordRef,
      triggerTypes: [...new Set(payload.triggerIndicators.map((entry) => entry.triggerType))],
      riskLevel: payload.riskLevel,
      evidenceSegmentIds: [
        ...new Set([
          ...payload.evidenceReferences.map((entry) => entry.locator.sourceSegmentId),
          ...payload.indicatorResults.flatMap((result) =>
            result.evidenceReferences.map((entry) => entry.locator.sourceSegmentId),
          ),
        ]),
      ].sort(),
    };
  };

  const openCommand = async (input: {
    readonly commandId: string;
    readonly idempotencyKey?: string;
    readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  }): Promise<OpenWarningCommandV1> =>
    OpenWarningCommandV1Schema.parse({
      kind: "open",
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey ?? input.commandId,
      projectId,
      actorId: c25.managerId,
      issuedAt: C26_FIXTURE_TIME,
      authorization: await authorizationFor({
        branch: "warning-response.open",
        invocationId: input.commandId,
      }),
      payload: {
        assessmentRecordRef: input.assessmentRecordRef,
      },
    }) as OpenWarningCommandV1;

  const acknowledgeCommand = async (input: {
    readonly commandId: string;
    readonly idempotencyKey?: string;
    readonly warningRecordRef: WarningRecordRefV1;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
  }): Promise<WarningResponseRecordCommandV1> =>
    WarningResponseRecordCommandV1Schema.parse({
      kind: "acknowledge",
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey ?? input.commandId,
      projectId,
      actorId: c25.managerId,
      issuedAt: C26_FIXTURE_TIME,
      authorization: await authorizationFor({
        branch: "warning-response.acknowledge",
        invocationId: input.commandId,
      }),
      payload: {
        warningRecordRef: input.warningRecordRef,
        warningResponseTaskRef: input.warningResponseTaskRef,
      },
    }) as WarningResponseRecordCommandV1;

  const countRows = async (table: string): Promise<number> => {
    const result = await adminPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE project_id = $1`,
      [projectId],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  return {
    c25,
    db,
    adapter,
    consumer,
    projectId,
    managerId: c25.managerId,
    recipients: defaultRecipients,
    restrictedScopeRef,
    aggregationPolicyRef,
    notificationPolicyRef,
    assess,
    openCommand,
    acknowledgeCommand,
    async deliverInApp(input) {
      // 用开预警时真实登记的那条事件，不手工拼造事件外壳。
      const event = await readRecordedEvent(input.producerCommandId);
      if (event === undefined) {
        throw new Error(
          `C26 fixture delivery found no recorded event for ${input.producerCommandId}`,
        );
      }
      const result = await consumer.consume(
        "warning-in-app-notification",
        event,
        async (context, consumed) => {
          if (consumed.eventType !== "warning.warning-recorded.v1") {
            throw new Error("unexpected event type in the C26 delivery fixture");
          }
          await adapter.deliverInAppNotifications(context, {
            projectId,
            warningRecordRef: input.warningRecordRef,
            warningResponseTaskRef: input.warningResponseTaskRef,
            notificationIntentRefs: input.notificationIntentRefs,
          });
          return { resultRef: input.warningRecordRef };
        },
      );
      if (result.kind === "failed") {
        throw new Error(`C26 fixture delivery failed: ${JSON.stringify(result).slice(0, 300)}`);
      }
    },
    readAuthorization(queryId, spatialScopeRefs) {
      return authorizationFor({
        branch: "warning-response.read",
        invocationId: queryId,
        ...(spatialScopeRefs === undefined ? {} : { spatialScopeRefs }),
      });
    },
    restrictedReadAuthorization(queryId, spatialScopeRefs) {
      return authorizationFor({
        branch: "warning-response.read",
        invocationId: queryId,
        spatialScopeRefs,
      });
    },
    withOwningReaders(readers) {
      return createPostgresWarningLifecycleAdapter({
        db,
        transactionUnit: c25.postgres.transactionUnit,
        access,
        assessmentContext: reader,
        runtimePolicies: policyProvider,
        authorizeDownstream,
        recommendations: readers.recommendations ?? unwiredRecommendations,
        routeDecisions: readers.routeDecisions ?? unwiredRouteDecisions,
        lifecycle: readers.lifecycle ?? unwiredLifecycle,
        calibration: readers.calibration ?? unwiredCalibration,
        now: () => new Date(C26_FIXTURE_TIME),
      });
    },
    setPolicyAvailability(value) {
      policyAvailability = value;
    },
    setNotificationPolicy(recipients) {
      notificationPolicy = { ...notificationPolicy, recipientActorIds: [...recipients] };
    },
    foreignOpenCommand(input) {
      return OpenWarningCommandV1Schema.parse({
        kind: "open",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId: FOREIGN_PROJECT_ID,
        actorId: c25.managerId,
        issuedAt: C26_FIXTURE_TIME,
        authorization: {
          schemaVersion: "1",
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: `authorization-${FOREIGN_PROJECT_ID}`, versionId: "1" },
          },
          actorId: c25.managerId,
          projectId: FOREIGN_PROJECT_ID,
          grantedCapabilities: ["warning-response.record"],
          spatialScopeRefs: [
            {
              kind: "spatial-scope",
              reference: {
                entityId: rootRow.rows[0]!.scope_id,
                versionId: rootRow.rows[0]!.revision_id,
              },
            },
          ],
          sourceAccessGrantRefs: [],
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          decidedAt: C26_FIXTURE_TIME,
          invocation: { kind: "human" },
        },
        payload: {
          assessmentRecordRef: input.assessmentRecordRef,
        },
      }) as OpenWarningCommandV1;
    },
    async spatiallyRestrictedOpenCommand(input) {
      return OpenWarningCommandV1Schema.parse({
        kind: "open",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: c25.managerId,
        issuedAt: C26_FIXTURE_TIME,
        authorization: await authorizationFor({
          branch: "warning-response.open",
          invocationId: input.commandId,
          spatialScopeRefs: [restrictedScopeRef],
        }),
        payload: {
          assessmentRecordRef: input.assessmentRecordRef,
        },
      }) as OpenWarningCommandV1;
    },
    async warningRows(input) {
      const rows = await adminPool.query<{
        warning_record_id: string;
        version_id: string;
        trigger_type: string;
        warning_payload: unknown;
        content_digest: string;
        audit_entry_id: string;
        idempotency_key: string;
      }>(
        `SELECT warning_record_id, version_id, trigger_type, warning_payload, content_digest, audit_entry_id, idempotency_key
         FROM business.warning_records WHERE project_id = $1 AND assessment_record_id = $2 AND assessment_record_version_id = $3
         ORDER BY trigger_type`,
        [
          projectId,
          input.assessmentRecordRef.reference.entityId,
          input.assessmentRecordRef.reference.versionId,
        ],
      );
      return rows.rows.map((row) => ({
        warningRecordId: row.warning_record_id,
        versionId: row.version_id,
        triggerType: row.trigger_type,
        payload: row.warning_payload,
        contentDigest: row.content_digest,
        auditEntryId: row.audit_entry_id,
        idempotencyKey: row.idempotency_key,
      }));
    },
    async taskRows() {
      const rows = await adminPool.query<{
        task_id: string;
        status: string;
        current_version_id: string;
        risk_input_entity_id: string;
        spatial_scope_entity_id: string;
      }>(
        `SELECT task_id, status, current_version_id, risk_input_entity_id, spatial_scope_entity_id
         FROM business.warning_response_tasks WHERE project_id = $1 ORDER BY created_at, task_id`,
        [projectId],
      );
      return rows.rows.map((row) => ({
        taskId: row.task_id,
        status: row.status,
        currentVersionId: row.current_version_id,
        riskInputEntityId: row.risk_input_entity_id,
        spatialScopeEntityId: row.spatial_scope_entity_id,
      }));
    },
    async taskVersionRows(taskId) {
      const rows = await adminPool.query<{ version_id: string; status: string }>(
        `SELECT version_id, status FROM business.warning_response_task_versions WHERE project_id = $1 AND task_id = $2 ORDER BY version_id`,
        [projectId, taskId],
      );
      return rows.rows.map((row) => ({ versionId: row.version_id, status: row.status }));
    },
    async taskSpatialScopeTrace(taskId) {
      const rows = await adminPool.query<{ entity_id: string }>(
        `SELECT preparation.spatial_scope_ref -> 'reference' ->> 'entityId' AS entity_id
         FROM business.warning_response_tasks AS task
         JOIN business.warning_response_task_warnings AS link ON link.task_id = task.task_id
         JOIN business.warning_records AS warning
           ON warning.warning_record_id = link.warning_record_id
          AND warning.version_id = link.warning_record_version_id
         JOIN business.assessment_preparation_snapshots AS preparation
           ON preparation.snapshot_id = warning.preparation_snapshot_id
          AND preparation.version_id = warning.preparation_snapshot_version_id
         WHERE task.project_id = $1 AND task.task_id = $2
         LIMIT 1`,
        [projectId, taskId],
      );
      return rows.rows[0]?.entity_id;
    },
    async taskLinkRows(taskId) {
      const rows = await adminPool.query<{
        warning_record_id: string;
        warning_record_version_id: string;
        first_included_version_id: string;
      }>(
        `SELECT warning_record_id, warning_record_version_id, first_included_version_id
         FROM business.warning_response_task_warnings WHERE project_id = $1 AND task_id = $2
         ORDER BY warning_record_id`,
        [projectId, taskId],
      );
      return rows.rows.map((row) => ({
        warningRecordId: row.warning_record_id,
        warningRecordVersionId: row.warning_record_version_id,
        firstIncludedVersionId: row.first_included_version_id,
      }));
    },
    async intentRows(warningRecordId) {
      const rows = await adminPool.query<{
        intent_id: string;
        version_id: string;
        recipient_actor_id: string;
        channel: string;
        task_id: string;
        task_version_id: string;
        notification_policy_entity_id: string;
      }>(
        `SELECT intent_id, version_id, recipient_actor_id, channel, task_id, task_version_id, notification_policy_entity_id
         FROM business.notification_intents WHERE project_id = $1 AND warning_record_id = $2 ORDER BY recipient_actor_id`,
        [projectId, warningRecordId],
      );
      return rows.rows.map((row) => ({
        intentId: row.intent_id,
        intentVersionId: row.version_id,
        recipientActorId: row.recipient_actor_id,
        channel: row.channel,
        taskId: row.task_id,
        taskVersionId: row.task_version_id,
        notificationPolicyEntityId: row.notification_policy_entity_id,
      }));
    },
    async notificationRows(intentIds) {
      const rows = await adminPool.query<{
        notification_intent_id: string;
        recipient_actor_id: string;
      }>(
        `SELECT notification_intent_id, recipient_actor_id FROM business.in_app_notifications
         WHERE project_id = $1 AND notification_intent_id = ANY($2::text[]) ORDER BY notification_intent_id`,
        [projectId, [...intentIds]],
      );
      return rows.rows.map((row) => ({
        intentId: row.notification_intent_id,
        recipientActorId: row.recipient_actor_id,
      }));
    },
    async acknowledgementRows(input) {
      const rows = await adminPool.query<{
        acknowledged_by_actor_id: string;
        task_version_id: string;
      }>(
        `SELECT acknowledged_by_actor_id, task_version_id FROM business.warning_acknowledgements
         WHERE project_id = $1 AND warning_record_id = $2 AND warning_record_version_id = $3`,
        [
          projectId,
          input.warningRecordRef.reference.entityId,
          input.warningRecordRef.reference.versionId,
        ],
      );
      return rows.rows.map((row) => ({
        acknowledgedByActorId: row.acknowledged_by_actor_id,
        taskVersionId: row.task_version_id,
      }));
    },
    countRows,
    async countEvents(eventType, producerCommandId) {
      const result = await adminPool.query<{ count: string }>(
        producerCommandId === undefined
          ? "SELECT COUNT(*)::text AS count FROM outbox.events WHERE project_id = $1 AND event_type = $2"
          : "SELECT COUNT(*)::text AS count FROM outbox.events WHERE project_id = $1 AND event_type = $2 AND producer_command_id = $3",
        producerCommandId === undefined
          ? [projectId, eventType]
          : [projectId, eventType, producerCommandId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async lastEvent(eventType) {
      const result = await adminPool.query<{ event_json: DomainEventV1 }>(
        `SELECT event_json FROM outbox.events WHERE project_id = $1 AND event_type = $2 ORDER BY persisted_at DESC, event_id DESC LIMIT 1`,
        [projectId, eventType],
      );
      return result.rows[0]?.event_json;
    },
    async events(eventType) {
      const result = await adminPool.query<{ event_json: DomainEventV1 }>(
        `SELECT event_json FROM outbox.events WHERE project_id = $1 AND event_type = $2 ORDER BY persisted_at, event_id`,
        [projectId, eventType],
      );
      return result.rows.map((row) => row.event_json);
    },
    async consumerReceipt(consumerName, eventId) {
      const result = await adminPool.query<{
        status: string;
        attempt_count: number;
        result_ref: unknown;
        last_error_code: string | null;
      }>(
        `SELECT status, attempt_count, result_ref, last_error_code FROM outbox.consumer_receipts
         WHERE consumer_name = $1 AND event_id = $2`,
        [consumerName, eventId],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : {
            status: row.status,
            attemptCount: row.attempt_count,
            resultRef: row.result_ref,
            lastErrorCode: row.last_error_code,
          };
    },
    async countReceipts(commandKind) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2",
        [projectId, commandKind],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countAuditEntries(action) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2",
        [projectId, action],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async closeTask(taskId) {
      await adminPool.query(
        "UPDATE business.warning_response_tasks SET status = 'closed', updated_at = NOW() WHERE project_id = $1 AND task_id = $2",
        [projectId, taskId],
      );
    },
    async preinsertAuditConflict(commandId) {
      await adminPool.query(
        `INSERT INTO audit.entries (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref, version_ref, occurred_at, recorded_at, command_id, idempotency_key)
         VALUES ($1, $2, 'fixture.conflict', '{"kind":"project-revision","reference":{"entityId":"fixture","versionId":"1"}}', $3, '{"kind":"authorization-context","reference":{"entityId":"fixture","versionId":"1"}}', '{"entityId":"fixture","versionId":"1"}', NOW(), NOW(), $4, $4)
         ON CONFLICT (audit_entry_id) DO NOTHING`,
        [`audit-${commandId}:warning-open`, projectId, c25.managerId, commandId],
      );
    },
    async clearAuditConflict(commandId) {
      await adminPool.query("DELETE FROM audit.entries WHERE audit_entry_id = $1", [
        `audit-${commandId}:warning-open`,
      ]);
    },
    async assessWithMissingAssessment() {
      return {
        kind: "risk-assessment-record",
        reference: { entityId: "assessment-record-absent", versionId: "99" },
      };
    },
    async close() {
      await consumer.close().catch(() => undefined);
      await c25.postgres.close();
    },
  };
};
