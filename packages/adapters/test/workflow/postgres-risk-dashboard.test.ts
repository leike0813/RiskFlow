/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、命令身份与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AuthorizationContextV1Schema,
  ModuleErrorV1Schema,
  ReviewRequestV1Schema,
  RiskDashboardReadQueryV1Schema,
  RiskDashboardReadResultV1Schema,
  RiskDashboardRiskRecordsSourceRequestV1Schema,
  type AuthorizationContextV1,
  type ModuleErrorV1,
  type RiskDashboardAssessmentsSourceV1,
  type RiskDashboardReadPortV1,
  type RiskDashboardReadResultV1,
  type RiskDashboardRiskRecordsSourceResultV1,
  type RiskDashboardSourcesV1,
  type RiskDashboardTimelineEventV1,
  type RiskDashboardWarningsSourceV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";
import {
  AccessServiceError,
  type AuthorizationDecisionV1,
  type BusinessActionAuthorizationInputV1,
} from "@riskflow/core/access";
import { StandardizedRiskRecordWriteV1Schema } from "@riskflow/core/identification/candidate-finalization";
import type { AtomicCommandV1, AtomicCommitV1 } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  createRiskDashboardReadService,
  dashboardTimestampV1,
} from "@riskflow/core/risk-dashboard";

import { PostgresEngineeringDataCatalogAdapter } from "../../src/engineering-data/catalog/index.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../src/identification/candidate-finalization/postgres-risk-candidate-adapter.js";
import { PostgresRiskIdentificationReadAdapter } from "../../src/identification/read/index.js";
import {
  PostgresReviewAuditAdapter,
  PostgresReviewQueueReadAdapter,
} from "../../src/review-audit/index.js";
import {
  startWarningLifecycleFixture,
  type WarningLifecyclePostgresFixtureV1,
} from "../warning/fixture.js";

const PROJECT_TIMESTAMP = "2030-01-01T00:00:00.000Z";
const DASHBOARD_REQUESTED_AT = "2040-01-01T00:00:00.000Z";
const DASHBOARD_AS_OF = dashboardTimestampV1(new Date(DASHBOARD_REQUESTED_AT));
const RISK_RECORDED_AT = "2034-01-01T00:00:00.123456Z";
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

const SUMMARY_KEYS = [
  "riskRecords",
  "assessments",
  "warnings",
  "reviews",
  "documents",
  "monitoring",
] as const;

interface RiskRecordSeedV1 {
  readonly suffix: string;
  readonly processNodeId: string;
}

/** 三条 accepted 风险记录：两条同工序、一条另一工序。 */
const RISK_RECORD_SEEDS: readonly RiskRecordSeedV1[] = [
  { suffix: "dashboard-risk-a", processNodeId: "node-dashboard-a" },
  { suffix: "dashboard-risk-b", processNodeId: "node-dashboard-a" },
  { suffix: "dashboard-risk-c", processNodeId: "node-dashboard-b" },
];

const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const refOf = <const T extends string>(kind: T, entityId: string, versionId = "1") =>
  ({ kind, reference: { entityId, versionId } }) as const;

const plainRef = (entityId: string, versionId = "1") => ({ entityId, versionId });

type DashboardSuccessV1 = Extract<RiskDashboardReadResultV1, { kind: "succeeded" }>["result"];

const expectSucceeded = (result: RiskDashboardReadResultV1): DashboardSuccessV1 => {
  expect(result.kind).toBe("succeeded");
  if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
  return result.result;
};

const readySummary = <T extends { readonly kind: "ready" | "failed" }>(
  summary: T,
): Extract<T, { readonly kind: "ready" }> => {
  expect(summary.kind).toBe("ready");
  if (summary.kind !== "ready") throw new TypeError("expected a ready summary");
  return summary as Extract<T, { readonly kind: "ready" }>;
};

/** 注入的失败分支：只表达本来源不可用，不伪造任何统计。 */
const injectedFailure = (queryId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind: "dashboard-source-unavailable",
    blockerRef: refOf("query-result", queryId),
    stageCode: "dashboard.test.injected-source",
    occurredAt: DASHBOARD_REQUESTED_AT,
    causalRunId: queryId,
  });

interface TimelinePositionV1 {
  readonly source: RiskDashboardTimelineEventV1["source"];
  readonly recordedAt: string;
  readonly entityId: string;
  readonly versionId: string;
}

/** 事件全序与契约一致：登记时刻降序，来源、主体与版本升序。 */
const comparePositions = (left: TimelinePositionV1, right: TimelinePositionV1): number => {
  if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? 1 : -1;
  if (left.source !== right.source) return left.source < right.source ? -1 : 1;
  if (left.entityId !== right.entityId) return left.entityId < right.entityId ? -1 : 1;
  if (left.versionId !== right.versionId) return left.versionId < right.versionId ? -1 : 1;
  return 0;
};

const positionOf = (event: RiskDashboardTimelineEventV1): TimelinePositionV1 => ({
  source: event.source,
  recordedAt: event.recordedAt,
  entityId: event.subjectRef.reference.entityId,
  versionId: event.subjectRef.reference.versionId,
});

const positionKeyOf = (position: TimelinePositionV1): string =>
  `${position.recordedAt}|${position.source}|${position.entityId}|${position.versionId}`;

interface DashboardFixtureV1 {
  readonly warning: WarningLifecyclePostgresFixtureV1;
  readonly sources: RiskDashboardSourcesV1;
  readonly service: RiskDashboardReadPortV1;
  readonly failingAssessments: RiskDashboardReadPortV1;
  readonly failingWarnings: RiskDashboardReadPortV1;
  readonly expected: {
    readonly readySourceVersionCount: number;
    readonly warningCount: number;
    readonly warningRiskLevel: string;
    readonly events: readonly TimelinePositionV1[];
  };
  baseline?: DashboardSuccessV1;
  setRevoked(value: boolean): void;
  read(
    service: RiskDashboardReadPortV1,
    options?: {
      readonly pageSize?: number;
      readonly cursor?: string;
      readonly spatialScopeRef?: SpatialScopeRefV1;
    },
  ): Promise<RiskDashboardReadResultV1>;
  rowCounts(): Promise<Record<string, number>>;
  entryAuthorization(queryId: string): Promise<AuthorizationContextV1>;
  seedRiskRecordBatch(
    specs: readonly RiskRecordSeedV1[],
    occurredAt: string,
    commandId: string,
  ): Promise<void>;
  readRiskSource(pageSize: number): Promise<RiskDashboardRiskRecordsSourceResultV1>;
  close(): Promise<void>;
}

const startDashboardFixture = async (): Promise<DashboardFixtureV1> => {
  const warning = await startWarningLifecycleFixture();
  try {
    const c25 = warning.c25;
    const projectId = c25.projectId;
    const managerId = c25.managerId;
    const adminPool = c25.postgres.postgres.adminPool;
    const clock = (): Date => new Date(DASHBOARD_REQUESTED_AT);
    const scopeEntityId = c25.accessRootScopeRef.reference.entityId;

    const seedContext = AuthorizationContextV1Schema.parse({
      schemaVersion: "1",
      authorizationContextRef: refOf("authorization-context", "dashboard-seed-context"),
      actorId: managerId,
      projectId,
      grantedCapabilities: ["risk-identification.read"],
      spatialScopeRefs: [c25.accessRootScopeRef],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
      decidedAt: PROJECT_TIMESTAMP,
      invocation: { kind: "human" },
    });
    const seedScopeDigest = authorizationScopeDigest(seedContext);

    // ---------------------------------------------------------------- 风险记录（真实 C22 写路径）
    const finalization = new PostgresRiskCandidateFinalizationAdapter({
      db: c25.postgres.runtime.db,
      transactionUnit: c25.postgres.transactionUnit,
    });
    const seedRiskRecordBatch = async (
      specs: readonly RiskRecordSeedV1[],
      occurredAt: string,
      commandId: string,
    ): Promise<void> => {
      const rows = specs.map((seed) => {
        const riskRecordId = `risk-record:${projectId}:${seed.suffix}`;
        return StandardizedRiskRecordWriteV1Schema.parse({
          riskRecordId,
          versionId: "v1",
          riskRecordRef: refOf("standardized-risk-record", riskRecordId, "v1"),
          rowId: `row-${seed.suffix}`,
          idempotencyKey: `identification.accept-groups:${seed.suffix}`,
          requestDigest: sha(`dashboard-record-request-${seed.suffix}`),
          projectId,
          workPlanRef: refOf("identification-work-plan", "identification-work-plan:dashboard"),
          identificationRunRef: refOf("workflow-run", `workflow-run:${projectId}:dashboard`),
          inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot-dashboard"),
          mergePlanRef: refOf("merge-plan", "merge-plan:dashboard"),
          routeDecisionRef: refOf("route-decision", `route-decision:${seed.suffix}`),
          groupId: "group-dashboard",
          groupVersionId: sha(`group-version-${seed.suffix}`),
          groupRef: refOf(
            "identification-group",
            `identification-group:dashboard:${seed.suffix}`,
            sha(`group-${seed.suffix}`),
          ),
          representativeCandidateRefs: [
            refOf(
              "content-artifact",
              `candidate-artifact-${seed.suffix}`,
              `sha256:${sha(`candidate-${seed.suffix}`)}`,
            ),
          ],
          sourceSegmentIds: [`segment-${seed.suffix}`],
          mechanismEntryIds: [`mechanism-${seed.suffix}`],
          spatialScopeRefs: [c25.accessRootScopeRef],
          sourceVersionRefs: [c25.sourceVersionRef],
          evidenceReferences: [
            {
              locator: { sourceSegmentId: `segment-${seed.suffix}` },
              sourceVersion: {
                entityId: c25.sourceVersionRef.reference.entityId,
                versionId: c25.sourceVersionRef.reference.versionId,
              },
            },
          ],
          authorizationScopeDigest: seedScopeDigest,
          authorizationContextRef: seedContext.authorizationContextRef,
          actorRef: managerId,
          commandId,
          occurredAt,
        });
      });
      const records = specs.map((seed) => {
        const riskRecordId = `risk-record:${projectId}:${seed.suffix}`;
        return StandardizedRiskRecordEnvelopeSchema.parse({
          riskRecordId,
          record: {
            processNodeId: seed.processNodeId,
            riskSource: `risk-source-${seed.suffix}`,
            riskFactor: `risk-factor-${seed.suffix}`,
            riskEvent: `risk-event-${seed.suffix}`,
            riskElementRelations: [
              { sourceElement: "element-a", relation: "induces", targetElement: "element-b" },
            ],
            evidenceLocator: { sourceSegmentId: `segment-${seed.suffix}` },
            modelConfidence: 0.6,
          },
          riskMechanismEntryIds: [`mechanism-${seed.suffix}`],
          sourceIds: [`segment-${seed.suffix}`],
          compositeConfidence: { value: 0.6, basis: ["model-confidence"] },
          version: {
            reference: plainRef(riskRecordId, "v1"),
            effectivePeriod: { validFrom: occurredAt },
            systemTime: { recordedAt: occurredAt },
          },
          audit: {
            actorId: managerId,
            action: "identification.accept-groups",
            recordedAt: occurredAt,
          },
        });
      });
      const head = rows[0];
      if (head === undefined) throw new TypeError("risk record seeding requires rows");
      const riskCommand: AtomicCommandV1 = {
        projectId,
        commandKind: "identification.accept-groups",
        commandId,
        idempotencyKey: commandId,
        payload: {
          fixture: "合成样本、待甲方复核",
          recordIds: rows.map((row) => row.riskRecordId),
        },
        actorRef: managerId,
        authorizationContextRef: seedContext.authorizationContextRef,
        issuedAt: PROJECT_TIMESTAMP,
      };
      await c25.postgres.transactionUnit.execute(riskCommand, async (context) => {
        const outcome = await finalization.insertRecords({ rows, records, occurredAt }, context);
        if (outcome.kind !== "inserted") throw new TypeError("risk record seeding failed");
        return {
          resultRef: head.riskRecordRef,
          audit: {
            auditEntryId: `${commandId}:audit`,
            projectId,
            action: riskCommand.commandKind,
            targetRef: head.riskRecordRef,
            actorRef: managerId,
            authorizationContextRef: riskCommand.authorizationContextRef,
            occurredAt,
            recordedAt: occurredAt,
            version: head.riskRecordRef.reference,
            commandId: riskCommand.commandId,
            idempotencyKey: riskCommand.idempotencyKey,
          },
          events: [],
        } satisfies AtomicCommitV1;
      });
    };
    await seedRiskRecordBatch(RISK_RECORD_SEEDS, RISK_RECORDED_AT, "dashboard-risk-seed");

    // ---------------------------------------------------------------- 评估记录（真实 C25 写路径）
    const assessmentA = await warning.assess({ suffix: "dashboard-warning" });
    const evaluateSecondAssessment = async (): Promise<void> => {
      const preparation = await c25.freezePreparation({
        suffix: "dashboard-assessment-b",
        entryMode: "assess",
        triggerReasonCode: "manual-assessment",
        monitoringSnapshotRefs: c25.monitoringSnapshotRefs,
      });
      const prepared = await c25.engine.prepare(
        (await c25.prepareCommand({
          commandId: "dashboard-assessment-b-prepare",
          preparation,
        })) as never,
      );
      if (prepared.kind !== "succeeded") {
        throw new TypeError(`dashboard assessment prepare failed: ${prepared.kind}`);
      }
      const evaluated = await c25.engine.evaluate(
        (await c25.evaluateCommand({
          commandId: "dashboard-assessment-b-evaluate",
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      if (evaluated.kind !== "succeeded") {
        throw new TypeError(`dashboard assessment evaluate failed: ${evaluated.kind}`);
      }
    };
    await evaluateSecondAssessment();

    // ---------------------------------------------------------------- 预警（真实 C26 写路径）
    const opened = await warning.adapter.open(
      await warning.openCommand({
        commandId: "dashboard-warning-open",
        assessmentRecordRef: assessmentA.assessmentRecordRef,
      }),
    );
    if (opened.kind !== "succeeded") {
      throw new TypeError(`dashboard warning open failed: ${opened.kind}`);
    }
    const warningRows = await warning.warningRows({
      assessmentRecordRef: assessmentA.assessmentRecordRef,
    });

    // ---------------------------------------------------------------- 待决定复核（真实 C33 写路径）
    const reviewAudit = new PostgresReviewAuditAdapter({
      db: c25.postgres.runtime.db,
      transactionUnit: c25.postgres.transactionUnit,
      access: c25.postgres.access,
      now: clock,
    });
    const reviewDecision = await c25.postgres.access.authorizeBusinessAction({
      actorId: managerId,
      projectId,
      capability: "review-audit.request",
      branch: "review-audit.request-review",
      invocationId: "dashboard-review-request",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    const reviewRequest = ReviewRequestV1Schema.parse({
      kind: "request-review",
      commandId: "dashboard-review-request",
      idempotencyKey: "dashboard-review-request",
      projectId,
      actorId: managerId,
      issuedAt: DASHBOARD_REQUESTED_AT,
      authorization: reviewDecision.context,
      payload: {
        reviewType: "identification-group",
        targetRef: refOf("identification-group", "dashboard-review-target"),
        validationSnapshotRef: refOf("validation-snapshot", "dashboard-review-validation"),
        evidenceSnapshotRef: refOf("evidence-snapshot", "dashboard-review-evidence"),
        waitingRunRef: refOf("workflow-run", "dashboard-review-run"),
        reviewPolicyRef: plainRef("review-policy"),
      },
    });
    const reviewResult = await reviewAudit.requestReview(reviewRequest);
    if (reviewResult.kind !== "succeeded") {
      throw new TypeError(`dashboard review request failed: ${reviewResult.kind}`);
    }

    // ---------------------------------------------------------------- 六个真实来源
    const identification = new PostgresRiskIdentificationReadAdapter({
      db: c25.postgres.runtime.db,
      artifactStore: c25.postgres.artifactStore,
      authorization: c25.postgres.access,
      now: clock,
    });
    const reviewQueue = new PostgresReviewQueueReadAdapter({
      db: c25.postgres.runtime.db,
      authorization: c25.postgres.access,
      now: clock,
    });
    const catalog = new PostgresEngineeringDataCatalogAdapter({
      db: c25.postgres.runtime.db,
      access: c25.postgres.access,
      artifactStore: c25.postgres.artifactStore,
      resolvers: {
        resolveReadQuery: (query, options) =>
          c25.postgres.registry.resolveReadQuery(query, options),
        resolveSnapshotQuery: (query, options) =>
          c25.postgres.monitoringStore.resolveSnapshotQuery(query, options),
      },
      now: clock,
    });
    const sources: RiskDashboardSourcesV1 = {
      riskRecords: identification,
      assessments: c25.engine,
      warnings: warning.adapter,
      reviews: reviewQueue,
      documents: catalog,
      monitoring: catalog,
    };

    let revoked = false;
    const authorizeBusinessAction = async (
      input: BusinessActionAuthorizationInputV1,
    ): Promise<AuthorizationDecisionV1> => {
      const decision = await c25.postgres.access.authorizeBusinessAction(input);
      // 受控撤权替身：当前决定仍由真实 C06 签发，但撤权后不再授予来源能力。
      if (!revoked) return decision;
      return {
        ...decision,
        context: { ...decision.context, grantedCapabilities: ["projection.query"] },
      };
    };
    const createService = (overrides: Partial<RiskDashboardSourcesV1> = {}) =>
      createRiskDashboardReadService({
        sources: { ...sources, ...overrides },
        authorizeBusinessAction,
        now: clock,
      });
    const service = createService();
    const failingAssessments = createService({
      assessments: {
        readDashboard: async (request) => ({
          kind: "failed",
          error: injectedFailure(request.queryId),
        }),
      } satisfies RiskDashboardAssessmentsSourceV1,
    });
    const failingWarnings = createService({
      warnings: {
        readDashboard: async (request) => ({
          kind: "failed",
          error: injectedFailure(request.queryId),
        }),
      } satisfies RiskDashboardWarningsSourceV1,
    });

    let queryCount = 0;
    const entryAuthorization = async (queryId: string): Promise<AuthorizationContextV1> => {
      const decision = await c25.postgres.access.authorizeBusinessAction({
        actorId: managerId,
        projectId,
        capability: "projection.query",
        branch: "projection.dashboard-read",
        invocationId: queryId,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      return decision.context;
    };
    const read: DashboardFixtureV1["read"] = async (port, options = {}) => {
      const queryId = `dashboard-query-${++queryCount}`;
      const authorization = await entryAuthorization(queryId);
      const query = RiskDashboardReadQueryV1Schema.parse({
        queryId,
        projectId,
        actorId: managerId,
        requestedAt: DASHBOARD_REQUESTED_AT,
        authorization,
        kind: "read",
        payload: {
          ...(options.pageSize === undefined ? {} : { timelinePageSize: options.pageSize }),
          ...(options.cursor === undefined ? {} : { timelineCursor: options.cursor }),
          ...(options.spatialScopeRef === undefined
            ? {}
            : { spatialScopeRef: options.spatialScopeRef }),
        },
      });
      return RiskDashboardReadResultV1Schema.parse(await port.read(query));
    };
    const readRiskSource = async (
      pageSize: number,
    ): Promise<RiskDashboardRiskRecordsSourceResultV1> => {
      const queryId = `dashboard-source-query-${++queryCount}`;
      const decision = await c25.postgres.access.authorizeBusinessAction({
        actorId: managerId,
        projectId,
        capability: "risk-identification.read",
        branch: "risk-identification.record-catalog",
        invocationId: queryId,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      return identification.readDashboard(
        RiskDashboardRiskRecordsSourceRequestV1Schema.parse({
          queryId,
          projectId,
          actorId: managerId,
          requestedAt: DASHBOARD_REQUESTED_AT,
          authorization: decision.context,
          timeline: { asOf: DASHBOARD_AS_OF, pageSize },
        }),
      );
    };
    const rowCounts = async (): Promise<Record<string, number>> => {
      const tables = [
        "business.standardized_risk_records",
        "business.risk_assessment_records",
        "business.warning_records",
        "business.review_tasks",
        "business.command_receipts",
        "business.agent_tasks",
      ] as const;
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const result = await adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${table} WHERE project_id = $1`,
          [projectId],
        );
        counts[table] = Number(result.rows[0]?.count ?? "0");
      }
      const outbox = await adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM outbox.events WHERE project_id = $1",
        [projectId],
      );
      counts["outbox.events"] = Number(outbox.rows[0]?.count ?? "0");
      return counts;
    };

    // ---------------------------------------------------------------- 读前事实 oracle
    const readySources = await adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.source_versions WHERE project_id = $1 AND access_status = 'ready'",
      [projectId],
    );
    const eventRows = await adminPool.query<{
      source: TimelinePositionV1["source"];
      recorded_at: string;
      entity_id: string;
      version_id: string;
    }>(
      `SELECT 'riskRecords' AS source,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
              risk_record_id AS entity_id,
              version_id
         FROM business.standardized_risk_records
        WHERE project_id = $1
          AND (route_decision_ref IS NOT NULL OR review_decision_ref IS NOT NULL)
          AND spatial_scope_refs IS NOT NULL
          AND source_version_refs IS NOT NULL
          AND evidence_references IS NOT NULL
          AND jsonb_array_length(spatial_scope_refs) > 0
          AND jsonb_array_length(source_version_refs) > 0
          AND jsonb_array_length(evidence_references) > 0
          AND created_at <= $2::timestamptz
       UNION ALL
       SELECT 'assessments' AS source,
              to_char(r.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
              r.record_id AS entity_id,
              r.version_id
         FROM business.risk_assessment_records r
         JOIN business.assessment_input_snapshots i
           ON i.project_id = r.project_id
          AND i.input_snapshot_id = r.input_snapshot_id
          AND i.version_id = r.input_snapshot_version_id
         JOIN business.assessment_preparation_snapshots p
           ON p.project_id = i.project_id
          AND p.snapshot_id = i.preparation_snapshot_id
          AND p.version_id = i.preparation_snapshot_version_id
        WHERE r.project_id = $1
          AND p.spatial_scope_ref -> 'reference' ->> 'entityId' = $3
          AND jsonb_typeof(p.snapshot_payload -> 'sourceEvidenceReferences') = 'array'
          AND r.recorded_at <= $2::timestamptz
       UNION ALL
       SELECT 'warnings' AS source,
              to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
              warning_record_id AS entity_id,
              version_id
         FROM business.warning_records
        WHERE project_id = $1
          AND spatial_scope_entity_id = $3
          AND recorded_at <= $2::timestamptz`,
      [projectId, DASHBOARD_AS_OF, scopeEntityId],
    );
    const events = eventRows.rows
      .map((row) => ({
        source: row.source,
        recordedAt: row.recorded_at,
        entityId: row.entity_id,
        versionId: row.version_id,
      }))
      .sort(comparePositions);

    return {
      warning,
      sources,
      service,
      failingAssessments,
      failingWarnings,
      expected: {
        readySourceVersionCount: Number(readySources.rows[0]?.count ?? "0"),
        warningCount: warningRows.length,
        warningRiskLevel: assessmentA.riskLevel,
        events,
      },
      setRevoked(value) {
        revoked = value;
      },
      read,
      rowCounts,
      entryAuthorization,
      seedRiskRecordBatch,
      readRiskSource,
      async close() {
        await warning.close();
      },
    };
  } catch (error) {
    await warning.close().catch(() => undefined);
    throw error;
  }
};

describe.sequential("CH-3 PostgreSQL risk dashboard aggregate read", () => {
  let fixture: DashboardFixtureV1 | undefined;

  beforeAll(async () => {
    fixture = await startDashboardFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 120_000);

  const requireFixture = (): DashboardFixtureV1 => {
    if (fixture === undefined) throw new TypeError("fixture not started");
    return fixture;
  };

  it("六个来源按真实持久化事实独立统计，聚合读不产生业务写入", async () => {
    const f = requireFixture();
    const before = await f.rowCounts();

    const success = expectSucceeded(await f.read(f.service, { pageSize: 20 }));
    f.baseline = success;

    const after = await f.rowCounts();
    expect(after).toEqual(before);
    const modelTables = await f.warning.c25.postgres.postgres.adminPool.query<{
      table_name: string;
    }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'business' AND table_name LIKE 'model%'",
    );
    expect(modelTables.rows).toEqual([]);

    expect(Object.keys(success.summaries).sort()).toEqual([...SUMMARY_KEYS].sort());

    const riskRecords = readySummary(success.summaries.riskRecords);
    expect(riskRecords.scope).toEqual({
      kind: "authorized-spaces",
      spatialScopeRef: undefined,
    });
    expect(riskRecords.data.recordedVersionCount).toBe(RISK_RECORD_SEEDS.length);
    expect(
      Object.fromEntries(
        riskRecords.data.processCounts.map((entry) => [entry.processNodeId, entry.count]),
      ),
    ).toEqual({ "node-dashboard-a": 2, "node-dashboard-b": 1 });

    const assessments = readySummary(success.summaries.assessments);
    expect(assessments.scope.kind).toBe("authorized-spaces");
    expect(assessments.data.recordedAssessmentCount).toBe(2);
    expect(
      assessments.data.matrixLevelCounts.reduce((total, entry) => total + entry.count, 0),
    ).toBe(2);

    const warnings = readySummary(success.summaries.warnings);
    expect(warnings.scope.kind).toBe("authorized-spaces");
    expect(warnings.data).toEqual({
      openTaskCount: 1,
      openTaskWarningCount: f.expected.warningCount,
      warningLevelCounts: [
        { warningLevel: f.expected.warningRiskLevel, count: f.expected.warningCount },
      ],
      unacknowledgedWarningCount: f.expected.warningCount,
      unacknowledgedLevelCounts: [
        { warningLevel: f.expected.warningRiskLevel, count: f.expected.warningCount },
      ],
    });

    const reviews = readySummary(success.summaries.reviews);
    expect(reviews.scope).toEqual({ kind: "project" });
    expect(reviews.data).toEqual({
      pendingCount: 1,
      reviewTypeCounts: [{ reviewType: "identification-group", count: 1 }],
    });

    const documents = readySummary(success.summaries.documents);
    expect(documents.scope.kind).toBe("authorized-spaces");
    expect(documents.data.sourceVersionCount).toBe(f.expected.readySourceVersionCount);
    expect(documents.data.parseStatusCounts.reduce((total, entry) => total + entry.count, 0)).toBe(
      f.expected.readySourceVersionCount,
    );
    expect(documents.data.cleaningStatusCounts).toEqual([
      { status: { kind: "not-registered" }, count: f.expected.readySourceVersionCount },
    ]);

    const monitoring = readySummary(success.summaries.monitoring);
    expect(monitoring.scope.kind).toBe("authorized-spaces");
    expect(monitoring.data).toEqual({
      seriesCount: 3,
      seriesWithBatchCount: 3,
      seriesWithSnapshotCount: 3,
    });
  });

  it("单来源失败不伪造零值，其余五来源计数不变", async () => {
    const f = requireFixture();
    if (f.baseline === undefined) throw new TypeError("baseline read missing");

    const success = expectSucceeded(await f.read(f.failingAssessments, { pageSize: 20 }));
    const assessments = success.summaries.assessments;
    expect(assessments).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
    expect(assessments).not.toHaveProperty("data");

    for (const key of SUMMARY_KEYS) {
      if (key === "assessments") continue;
      expect(success.summaries[key]).toEqual(f.baseline.summaries[key]);
    }
    expect(success.timeline.sources.assessments).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
  });

  it("变化页跨三来源全序有界，续页不重不漏且沿用同一上界", async () => {
    const f = requireFixture();
    const expected = f.expected.events;
    expect(expected.length).toBeGreaterThan(RISK_RECORD_SEEDS.length);
    const pageSize = Math.max(2, Math.ceil(expected.length / 2));

    const first = expectSucceeded(await f.read(f.service, { pageSize }));
    expect(first.timeline.items).toHaveLength(pageSize);
    expect(first.timeline.nextCursor).toBeDefined();
    expect(first.timeline.retryCursor).toBeUndefined();
    if (first.timeline.nextCursor === undefined) throw new TypeError("next cursor missing");

    const second = expectSucceeded(
      await f.read(f.service, { pageSize, cursor: first.timeline.nextCursor }),
    );
    expect(second.timeline.asOf).toBe(first.timeline.asOf);
    expect(second.timeline.nextCursor).toBeUndefined();
    expect(second.timeline.retryCursor).toBeUndefined();

    const collected = [...first.timeline.items, ...second.timeline.items];
    expect(collected).toHaveLength(expected.length);
    for (const event of collected) expect(event.recordedAt).toMatch(TIMESTAMP_PATTERN);
    for (let index = 1; index < collected.length; index += 1) {
      const previous = positionOf(collected[index - 1]!);
      const current = positionOf(collected[index]!);
      expect(comparePositions(previous, current)).toBeLessThan(0);
    }

    const firstPageKeys = new Set(
      first.timeline.items.map((event) => positionKeyOf(positionOf(event))),
    );
    const secondPageKeys = new Set(
      second.timeline.items.map((event) => positionKeyOf(positionOf(event))),
    );
    expect([...firstPageKeys].filter((key) => secondPageKeys.has(key))).toEqual([]);

    const collectedKeys = collected.map((event) => positionKeyOf(positionOf(event)));
    expect(new Set(collectedKeys).size).toBe(collectedKeys.length);
    expect(collectedKeys.sort()).toEqual(
      expected.map((position) => positionKeyOf(position)).sort(),
    );
    expect(new Set(collected.map((event) => event.subjectRef.reference.entityId))).toEqual(
      new Set(expected.map((position) => position.entityId)),
    );
  });

  it("参与来源失败时不出续页游标，重试从同一页起点重放", async () => {
    const f = requireFixture();
    const pageSize = Math.max(2, Math.ceil(f.expected.events.length / 2));

    const first = expectSucceeded(await f.read(f.failingWarnings, { pageSize }));
    expect(first.timeline.nextCursor).toBeUndefined();
    expect(first.timeline.retryCursor).toBeDefined();
    expect(first.timeline.sources.warnings).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
    expect(first.summaries.warnings).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
    if (first.timeline.retryCursor === undefined) throw new TypeError("retry cursor missing");

    const retried = expectSucceeded(
      await f.read(f.failingWarnings, { pageSize, cursor: first.timeline.retryCursor }),
    );
    expect(retried.timeline.items).toEqual(first.timeline.items);
    expect(retried.timeline.nextCursor).toBeUndefined();
    expect(retried.timeline.retryCursor).toBeDefined();
    const recovered = expectSucceeded(
      await f.read(f.service, { pageSize, cursor: first.timeline.retryCursor }),
    );
    expect(recovered.timeline.asOf).toBe(first.timeline.asOf);
    expect(recovered.timeline.items.map(positionOf)).toEqual(f.expected.events.slice(0, pageSize));
  });

  it("错工程、错空间与非法游标整体拒绝，页大小越界由请求 Schema 拒绝", async () => {
    const f = requireFixture();
    const foreignCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        projectId: "project-dashboard-foreign",
        asOf: DASHBOARD_AS_OF,
        after: {
          recordedAt: DASHBOARD_AS_OF,
          source: "riskRecords",
          entityId: "foreign-record",
          versionId: "v1",
        },
      }),
      "utf8",
    ).toString("base64url");
    const wrongScopeCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        projectId: f.warning.projectId,
        asOf: DASHBOARD_AS_OF,
      }),
      "utf8",
    ).toString("base64url");
    const cursorBase = { v: 1, projectId: f.warning.projectId, asOf: DASHBOARD_AS_OF };
    const invalidCursors = [
      { ...cursorBase, extra: true },
      { ...cursorBase, asOf: "2040-99-01T00:00:00.000000Z" },
      { ...cursorBase, after: null },
      { ...cursorBase, after: { source: "riskRecords", recordedAt: DASHBOARD_AS_OF } },
      {
        ...cursorBase,
        after: {
          source: "riskRecords",
          recordedAt: DASHBOARD_AS_OF,
          entityId: "",
          versionId: "v1",
        },
      },
    ].map((cursor) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url"));

    for (const result of [
      await f.read(f.service, { cursor: foreignCursor }),
      await f.read(f.service, { cursor: "not-a-dashboard-cursor" }),
      ...(await Promise.all(invalidCursors.map((cursor) => f.read(f.service, { cursor })))),
      await f.read(f.service, {
        cursor: wrongScopeCursor,
        spatialScopeRef: f.warning.c25.accessRootScopeRef,
      }),
    ]) {
      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "UNSUPPORTED_CONTRACT" },
      });
    }

    const authorization = await f.entryAuthorization("dashboard-page-size-schema");
    const base = {
      projectId: f.warning.projectId,
      actorId: f.warning.managerId,
      requestedAt: DASHBOARD_REQUESTED_AT,
      authorization,
      kind: "read" as const,
    };
    for (const timelinePageSize of [0, 51]) {
      expect(
        RiskDashboardReadQueryV1Schema.safeParse({
          ...base,
          queryId: `dashboard-page-size-${timelinePageSize}`,
          payload: { timelinePageSize },
        }).success,
      ).toBe(false);
    }
  });

  it("来源抛错或返回额外字段均局部失败，其余真实来源仍可读取", async () => {
    const f = requireFixture();
    for (const invalidResult of [false, true]) {
      const service = createRiskDashboardReadService({
        sources: {
          ...f.sources,
          warnings: {
            readDashboard: async (request) => {
              if (!invalidResult) throw new Error("private database failure");
              const result = await f.sources.warnings.readDashboard(request);
              return { ...result, privateData: "must not escape" } as typeof result;
            },
          },
        },
        authorizeBusinessAction: (input) =>
          f.warning.c25.postgres.access.authorizeBusinessAction(input),
        now: () => new Date(DASHBOARD_REQUESTED_AT),
      });
      const result = expectSucceeded(await f.read(service, { pageSize: 2 }));
      expect(result.summaries.warnings).toMatchObject({ kind: "failed" });
      expect(result.summaries.riskRecords.kind).toBe("ready");
      expect(result.summaries.documents.kind).toBe("ready");
      expect(result.timeline.nextCursor).toBeUndefined();
      expect(result.timeline.retryCursor).toBeDefined();
      expect(JSON.stringify(result)).not.toContain("private");
    }
    const missingService = createRiskDashboardReadService({
      sources: { ...f.sources, warnings: {} as RiskDashboardWarningsSourceV1 },
      authorizeBusinessAction: (input) =>
        f.warning.c25.postgres.access.authorizeBusinessAction(input),
      now: () => new Date(DASHBOARD_REQUESTED_AT),
    });
    const missing = expectSucceeded(await f.read(missingService, { pageSize: 2 }));
    expect(missing.summaries.warnings).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "dashboard-source-not-injected" },
    });
    expect(missing.timeline.retryCursor).toBeDefined();
  });

  it("来源授权的安全审计技术故障不能伪装拒权或允许时间线推进", async () => {
    const f = requireFixture();
    const service = createRiskDashboardReadService({
      sources: f.sources,
      authorizeBusinessAction: (input) => {
        if (input.branch === "warning-response.read") {
          throw new AccessServiceError({
            code: "ACCESS_TRANSIENT_FAILURE",
            retryable: true,
            attempt: 1,
            stage: "authorize.audit",
            occurredAt: DASHBOARD_REQUESTED_AT,
            diagnosticRef: refOf("diagnostic-artifact", "dashboard-audit-failure"),
            contextRefs: [],
          });
        }
        return f.warning.c25.postgres.access.authorizeBusinessAction(input);
      },
      now: () => new Date(DASHBOARD_REQUESTED_AT),
    });
    const result = expectSucceeded(await f.read(service, { pageSize: 1 }));
    expect(result.timeline.sources.warnings).toMatchObject({
      kind: "failed",
      error: { code: "TRANSIENT_FAILURE" },
    });
    expect(result.timeline.nextCursor).toBeUndefined();
    expect(result.timeline.retryCursor).toBeDefined();
  });

  it("撤权后来源立即失败闭合且不泄露撤权前的计数", async () => {
    const f = requireFixture();
    f.setRevoked(true);
    try {
      const success = expectSucceeded(await f.read(f.service, { pageSize: 5 }));
      for (const key of SUMMARY_KEYS) {
        expect(success.summaries[key].kind).toBe("failed");
        expect(success.summaries[key]).not.toHaveProperty("data");
      }
      const riskRecords = success.summaries.riskRecords;
      if (riskRecords.kind !== "failed") throw new TypeError("risk source not closed");
      expect(riskRecords.error.code).toBe("AUTHORIZATION_DENIED");
      expect(riskRecords.error).not.toHaveProperty("data");
      for (const source of ["riskRecords", "assessments", "warnings"] as const) {
        expect(success.timeline.sources[source]).toMatchObject({
          kind: "failed",
          error: { code: "AUTHORIZATION_DENIED" },
        });
      }
      expect(success.timeline.items).toEqual([]);
      expect(success.timeline.nextCursor).toBeUndefined();
    } finally {
      f.setRevoked(false);
    }
  });

  it("保持不变的外部时钟使两次读取的 timeline 上界一致", async () => {
    const f = requireFixture();
    const first = expectSucceeded(await f.read(f.service, { pageSize: 2 }));
    const second = expectSucceeded(await f.read(f.service, { pageSize: 2 }));
    expect(first.timeline.asOf).toBe(DASHBOARD_AS_OF);
    expect(second.timeline.asOf).toBe(first.timeline.asOf);
    expect(first.timeline.items).toEqual(second.timeline.items);
  });

  // implementation-plan V-02：真实规模下记录来源的耗时、候选/事件数与统计计数，不设 SLA 断言。
  it("规模证据：100 与 1000 条风险记录的真实来源读有界且计数相等", async () => {
    const f = requireFixture();
    let expectedTotal = RISK_RECORD_SEEDS.length;
    for (const count of [100, 1000]) {
      const specs = Array.from({ length: count }, (_, index) => ({
        suffix: `scale-${count}-${index}`,
        processNodeId: `node-scale-${index % 2}`,
      }));
      const seedStarted = performance.now();
      await f.seedRiskRecordBatch(
        specs,
        count === 100 ? "2035-01-01T00:00:00.100000Z" : "2036-01-01T00:00:00.100000Z",
        `dashboard-scale-${count}`,
      );
      const seedMs = performance.now() - seedStarted;
      expectedTotal += count;

      const readStarted = performance.now();
      const result = await f.readRiskSource(50);
      const readMs = performance.now() - readStarted;
      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") throw new TypeError("scale source read failed");
      expect(result.data.recordedVersionCount).toBe(expectedTotal);
      // 来源只返回 pageSize+1 条候选，供中央合并判定是否还有后续页。
      expect(result.events.length).toBeLessThanOrEqual(51);
      expect(result.events.length).toBeGreaterThan(50);
      expect(result.data.processCounts.every((entry) => entry.count > 0)).toBe(true);
      console.log(
        `[scale] records=${count} seedMs=${seedMs.toFixed(0)} readMs=${readMs.toFixed(0)} total=${result.data.recordedVersionCount} events=${result.events.length} processGroups=${result.data.processCounts.length} bytes=${Buffer.byteLength(JSON.stringify(result), "utf8")}`,
      );
    }
  });
  it("同刻 Unicode 主体的数据库 keyset 与中央全序一致", async () => {
    const f = requireFixture();
    const suffixes = ["dashboard-order-A", "dashboard-order-\uE000", "dashboard-order-\u{10000}"];
    await f.seedRiskRecordBatch(
      suffixes.map((suffix) => ({ suffix, processNodeId: "node-order" })),
      "2039-01-01T00:00:00.000001Z",
      "dashboard-order",
    );
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < suffixes.length; page += 1) {
      const result = expectSucceeded(
        await f.read(f.service, { pageSize: 1, ...(cursor === undefined ? {} : { cursor }) }),
      );
      expect(result.timeline.items).toHaveLength(1);
      collected.push(result.timeline.items[0]!.subjectRef.reference.entityId);
      cursor = result.timeline.nextCursor;
    }
    expect(collected.map((id) => id.split(":").at(-1))).toEqual(suffixes);
  });
});
