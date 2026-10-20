import { TextDecoder } from "node:util";

import { sql, type Kysely, type SqlBool } from "kysely";

import {
  EngineeringDataCatalogQueryV1Schema,
  EngineeringDataCatalogSuccessV1Schema,
  EngineeringReadEvidenceSuccessV1Schema,
  EngineeringReadMonitoringSnapshotSuccessV1Schema,
  EngineeringReadSegmentSetSuccessV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  RiskDashboardDocumentsSourceRequestV1Schema,
  RiskDashboardDocumentsSourceResultV1Schema,
  RiskDashboardMonitoringSourceRequestV1Schema,
  RiskDashboardMonitoringSourceResultV1Schema,
  type AuthorizationContextV1,
  type CleaningAvailabilityV1,
  type EngineeringDataCatalogPortV1,
  type EngineeringDataCatalogQueryV1,
  type EngineeringDataCatalogResultV1,
  type EngineeringDataCatalogSuccessV1,
  type EngineeringReadSourceSegmentV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type MonitoringSnapshotCatalogItemV1,
  type MonitoringSeriesCatalogItemV1,
  type RiskDashboardDocumentsSourceRequestV1,
  type RiskDashboardDocumentsSourceResultV1,
  type RiskDashboardDocumentsSourceV1,
  type RiskDashboardMonitoringSourceRequestV1,
  type RiskDashboardMonitoringSourceResultV1,
  type RiskDashboardMonitoringSourceV1,
  type SourceCatalogItemV1,
  type SourceVersionRefV1,
  SourceVersionRefV1Schema,
  SourceAccessGrantRefV1Schema,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import { ApplicabilityMetadataSchema } from "@riskflow/contracts/records";
import type { ApplicabilityMetadataDimension } from "@riskflow/contracts/vocabulary";
import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  DataCleaningResultV1Schema,
  type DataCleaningResultV1,
} from "@riskflow/core/engineering-data/cleaning";
import {
  SourceDeliveryDescriptorV1Schema,
  type EngineeringDataReadResolutionResultV1,
  type ResolveEngineeringDataReadQueryV1,
  type SourceDeliveryDescriptorV1,
} from "@riskflow/core/engineering-data/context-source";
import type {
  MonitoringResultV1,
  ResolveMonitoringSnapshotQueryV1,
} from "@riskflow/core/engineering-data/monitoring";
import type { PostgresDatabase } from "../../postgres/types.js";
import { monitoringEvidenceSourceVersionRefs } from "../monitoring/postgres-monitoring-store.js";

type TimestampColumn = Date | string;

interface ProjectIdentityRow {
  project_id: string;
  current_revision_id: string;
}

interface ProjectRevisionRow {
  revision_id: string;
  project_id: string;
  project_revision_ref: unknown;
  lifecycle: string;
  applicability_metadata: unknown;
}

interface SpatialRevisionRow {
  revision_id: string;
  scope_id: string;
  project_id: string;
  spatial_scope_ref: unknown;
  parent_scope_ref: unknown;
  name: string;
  worksite_location: string;
  status: string;
}

interface SpatialIdentityRow {
  scope_id: string;
  project_id: string;
  current_revision_id: string;
}

interface SourceVersionRow {
  source_version_id: string;
  version_id: string;
  source_id: string;
  source_item_id: string;
  project_id: string;
  source_delivery_id: string;
  source_version_ref: unknown;
  source_access_grant_ref: unknown;
  access_status: "pending-access" | "ready";
  recorded_at: TimestampColumn;
}

interface SourceDeliveryRow {
  source_delivery_id: string;
  project_id: string;
  source_metadata: unknown;
  descriptor: unknown;
}

interface SourceItemRow {
  source_item_id: string;
  project_id: string;
  name: string;
}

interface ConversionRow {
  project_id: string;
  source_version_ref: unknown;
  status: "succeeded" | "failed";
  completed_at: TimestampColumn;
}

interface SegmentSetRow {
  source_segment_set_id: string;
  project_id: string;
  source_version_id: string;
  source_segment_set_ref: unknown;
}

interface PreparationSnapshotRow {
  project_id: string;
  snapshot_payload: unknown;
  cleaning_result_artifact_ref: unknown;
}

interface MonitoringSeriesRow {
  series_id: string;
  project_id: string;
  current_revision_id: string | null;
}

interface MonitoringSeriesRevisionRow {
  revision_id: string;
  series_id: string;
  project_id: string;
  monitoring_series_ref: unknown;
  spatial_scope_ref: unknown;
  monitoring_object: string;
  monitoring_indicator: string;
  canonical_unit: string;
}

interface MonitoringBatchRow {
  batch_id: string;
  project_id: string;
  series_id: string;
  series_revision_id: string;
  monitoring_batch_ref: unknown;
  window_from: TimestampColumn;
  window_to: TimestampColumn;
  relation_kind: "original" | "correction" | "supplement";
  sample_count: number;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
}

interface MonitoringSnapshotRow {
  snapshot_id: string;
  project_id: string;
  series_id: string;
  series_revision_id: string;
  monitoring_snapshot_ref: unknown;
  cutoff: TimestampColumn;
  recorded_at: TimestampColumn;
  availability: CleaningAvailabilityV1;
  coverage_ratio: number;
  evidence_references: unknown;
}

type CatalogDatabase = PostgresDatabase & {
  "business.engineering_projects": ProjectIdentityRow;
  "business.engineering_project_revisions": ProjectRevisionRow;
  "business.engineering_spatial_segments": SpatialIdentityRow;
  "business.engineering_spatial_segment_revisions": SpatialRevisionRow;
  "business.source_versions": SourceVersionRow;
  "business.source_deliveries": SourceDeliveryRow;
  "business.source_items": SourceItemRow;
  "business.structured_document_conversions": ConversionRow;
  "business.source_segment_sets": SegmentSetRow;
  "business.identification_preparation_snapshots": PreparationSnapshotRow;
  "business.monitoring_series": MonitoringSeriesRow;
  "business.monitoring_series_revisions": MonitoringSeriesRevisionRow;
  "business.monitoring_batches": MonitoringBatchRow;
  "business.monitoring_snapshots": MonitoringSnapshotRow;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const refKey = (value: { kind: string; reference: { entityId: string; versionId: string } }) =>
  `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

const catalogError = (
  code: "AUTHORIZATION_DENIED" | "UNSUPPORTED_CONTRACT" | "TRANSIENT_FAILURE",
  causalRunId: string,
  capability: string,
): ModuleErrorV1 => {
  if (code === "AUTHORIZATION_DENIED") {
    return {
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: capability,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      stageCode: "engineering-data.catalog-read",
      occurredAt: new Date().toISOString(),
      causalRunId,
    } as ModuleErrorV1;
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return {
      code,
      category: "technical",
      retryable: false,
      schemaVersion: "1",
      stageCode: "engineering-data.catalog-read",
      occurredAt: new Date().toISOString(),
      causalRunId,
    } as ModuleErrorV1;
  }
  return {
    code,
    category: "technical",
    retryable: true,
    attempt: 1,
    retryPolicyRef: { entityId: "engineering-data-retry-policy", versionId: "1" },
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "engineering-data-catalog-failure", versionId: "1" },
    },
    stageCode: "engineering-data.catalog-read",
    occurredAt: new Date().toISOString(),
    causalRunId,
  } as ModuleErrorV1;
};

const CATALOG_BRANCH = {
  "context-read": "engineering-data.context-read",
  "source-catalog": "engineering-data.source-catalog",
  "monitoring-catalog": "engineering-data.monitoring-catalog",
  "read-result": "engineering-data.read-result",
} as const satisfies Record<EngineeringDataCatalogQueryV1["kind"], ModuleBranchV1>;

const APPLICABILITY_DIMENSION_BY_FIELD = {
  constructionMethod: "施工工法数据",
  stratumCondition: "地层条件数据",
  engineeringStage: "工程阶段数据",
} as const satisfies Record<string, ApplicabilityMetadataDimension>;

const readDenied = (queryId: string, kind: EngineeringDataCatalogQueryV1["kind"]) =>
  catalogError("AUTHORIZATION_DENIED", queryId, MODULE_BRANCH_CAPABILITY_V1[CATALOG_BRANCH[kind]]);

const failed = (error: ModuleErrorV1): EngineeringDataCatalogResultV1 => ({
  kind: "failed",
  error,
});

const succeeded = (result: EngineeringDataCatalogSuccessV1): EngineeringDataCatalogResultV1 => ({
  kind: "succeeded",
  result,
});

interface VersionedRefValue {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

const asVersionedRef = (value: unknown): VersionedRefValue | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { kind?: unknown; reference?: unknown };
  if (typeof candidate.kind !== "string") return undefined;
  const reference = candidate.reference as { entityId?: unknown; versionId?: unknown } | undefined;
  if (
    reference === undefined ||
    typeof reference.entityId !== "string" ||
    typeof reference.versionId !== "string"
  ) {
    return undefined;
  }
  return {
    kind: candidate.kind,
    reference: { entityId: reference.entityId, versionId: reference.versionId },
  };
};

/** read-result 的登记引用按既有固定前缀分发；其它前缀与伪造引用同形拒绝。 */
const READ_RESULT_OWNER = {
  "source-segments-": "registry",
  "evidence-access-": "registry",
  "monitoring-": "monitoring",
} as const;

const readResultOwnerOf = (entityId: string): "registry" | "monitoring" | undefined => {
  for (const [prefix, owner] of Object.entries(READ_RESULT_OWNER)) {
    if (entityId.startsWith(prefix)) return owner as "registry" | "monitoring";
  }
  return undefined;
};

export interface EngineeringDataReadResolversV1 {
  readonly resolveReadQuery: (
    query: ResolveEngineeringDataReadQueryV1,
    options?: { readonly verifyBranch?: ModuleBranchV1 },
  ) => Promise<EngineeringDataReadResolutionResultV1>;
  readonly resolveSnapshotQuery: (
    query: ResolveMonitoringSnapshotQueryV1,
    options?: { readonly verifyBranch?: ModuleBranchV1 },
  ) => Promise<MonitoringResultV1>;
}

export interface PostgresEngineeringDataCatalogAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly resolvers: EngineeringDataReadResolversV1;
  /** 仪表盘概况的统计时点；缺省取系统时钟。 */
  readonly now?: () => Date;
}

/**
 * C32 工程数据目录与结果再读取适配器（IP-03）。只读组合 engineering-data 模块既有
 * 登记行（工程上下文、资料、监测、清洗、转换），不新建表、不反写事实；每个分支先经
 * C06 `verify` 复验当前授权，再按授权范围过滤条目；无权、跨工程与不存在同形失败。
 */
/**
 * 指向其它工程、其它操作者或未持读能力的请求先按授权失败收口，伪造请求无法探出差异
 * （与 registry `readRequestDenied` 同形）。
 */
const catalogRequestDenied = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const authorization = request.authorization;
  if (typeof authorization !== "object" || authorization === null) return false;
  const context = authorization as Record<string, unknown>;
  if (
    typeof request.projectId === "string" &&
    typeof context.projectId === "string" &&
    request.projectId !== context.projectId
  ) {
    return true;
  }
  if (
    typeof request.actorId === "string" &&
    typeof context.actorId === "string" &&
    request.actorId !== context.actorId
  ) {
    return true;
  }
  const capabilities = context.grantedCapabilities;
  return (
    Array.isArray(capabilities) &&
    !capabilities.includes("engineering-data.read") &&
    !capabilities.includes("knowledge-modeling.read") &&
    !capabilities.includes("knowledge-modeling.retrieve") &&
    !capabilities.includes("projection.query")
  );
};

/** 仪表盘分组超界：整来源失败，不截断后宣称完整。 */
const dashboardBlocked = (queryId: string, blockerKind: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind,
    blockerRef: { kind: "query-result", reference: { entityId: queryId, versionId: "1" } },
    stageCode: "engineering-data.dashboard-read",
    occurredAt: new Date().toISOString(),
    causalRunId: queryId,
  });

/** 仪表盘来源无权：与目录读同形的稳定失败，不区分「无权」与「不存在」。 */
const dashboardDenied = (queryId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: "engineering-data.read",
    authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    stageCode: "engineering-data.dashboard-read",
    occurredAt: new Date().toISOString(),
    causalRunId: queryId,
  });

/** 仪表盘来源元数据上限：沿既有 256 项来源边界，超界整来源失败。 */
const DASHBOARD_SOURCE_GROUP_LIMIT_V1 = 256;

/** 授权不符：C06 的授权失败形状，让调用方能区分拒权与技术故障。 */
const dashboardDeniedError = (): AccessServiceError =>
  new AccessServiceError({
    code: "AUTHORIZATION_DENIED",
    stage: "verify",
    occurredAt: new Date().toISOString(),
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "engineering-data-dashboard-denied", versionId: "1" },
    },
    contextRefs: [],
    retryable: false,
    requiredCapability: "engineering-data.read",
    authorizationPolicyRef: ACCESS_POLICY_REF_V1,
  });

/** 仪表盘来源的技术故障：按 transient 收口，不折算成权限拒绝（design D-07）。 */
const dashboardFailed = (queryId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "TRANSIENT_FAILURE",
    category: "technical",
    retryable: true,
    attempt: 1,
    retryPolicyRef: { entityId: "read-retry-policy", versionId: "v1" },
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "engineering-data-dashboard-failure", versionId: "1" },
    },
    stageCode: "engineering-data.dashboard-read",
    occurredAt: new Date().toISOString(),
    causalRunId: queryId,
  });

/** 清洗摘要读取所需的最小请求事实：目录读与仪表盘概况共用。 */
interface DashboardCleaningQueryV1 {
  readonly queryId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
}

export class PostgresEngineeringDataCatalogAdapter implements EngineeringDataCatalogPortV1 {
  readonly #db: Kysely<CatalogDatabase>;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #resolvers: EngineeringDataReadResolversV1;
  readonly #now: () => Date;

  constructor(options: PostgresEngineeringDataCatalogAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<CatalogDatabase>;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#resolvers = options.resolvers;
    this.#now = options.now ?? (() => new Date());
  }

  async read(query: EngineeringDataCatalogQueryV1): Promise<EngineeringDataCatalogResultV1> {
    const parsed = EngineeringDataCatalogQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      const queryId =
        typeof (query as { queryId?: unknown })?.queryId === "string"
          ? (query as { queryId: string }).queryId
          : "engineering-data.catalog-read";
      if (catalogRequestDenied(query)) {
        return failed(catalogError("AUTHORIZATION_DENIED", queryId, "engineering-data.read"));
      }
      return failed(catalogError("UNSUPPORTED_CONTRACT", queryId, "engineering-data.read"));
    }
    const valid = parsed.data;
    const branch = CATALOG_BRANCH[valid.kind];
    try {
      const decision = await this.#verify(valid, branch, [], []);
      switch (valid.kind) {
        case "context-read":
          return await this.#readContext(valid, decision);
        case "source-catalog":
          return await this.#readSourceCatalog(valid, decision);
        case "monitoring-catalog":
          return await this.#readMonitoringCatalog(valid, decision);
        case "read-result":
          return await this.#readResult(valid);
      }
    } catch {
      return failed(readDenied(valid.queryId, valid.kind));
    }
  }

  async #verify(
    query: EngineeringDataCatalogQueryV1,
    branch: ModuleBranchV1,
    resolvedSpatialScopeRefs: readonly SpatialScopeRefV1[],
    requestedSourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationDecisionV1> {
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      !query.authorization.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
    ) {
      throw new Error("catalog authorization denied");
    }
    const requestedScopeRefs = new Map<string, SpatialScopeRefV1>();
    for (const resolved of resolvedSpatialScopeRefs) {
      const authorized = query.authorization.spatialScopeRefs.find(
        (scope) => scope.reference.entityId === resolved.reference.entityId,
      );
      if (authorized === undefined) throw new Error("catalog authorization denied");
      requestedScopeRefs.set(refKey(authorized), authorized);
    }
    const decision = await this.#access.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch,
      requestedSpatialScopeRefs: [...requestedScopeRefs.values()],
      requestedSourceVersionRefs: [...requestedSourceVersionRefs],
      requestedAt: query.authorization.decidedAt,
    });
    if (decision.context.actorId !== query.actorId) {
      throw new Error("catalog authorization denied");
    }
    return decision;
  }

  /**
   * CH-3 仪表盘资料概况（design D-04、D-05）。
   *
   * 资料概况与资料目录共用同一可见候选关系：目录可见的资料版本集合就是概况的统计单位，
   * 不在此处重新定义可见性，也不把目录分页结果累计成统计。
   * 解析状态与清洗状态都取自登记事实：未登记清洗结果的资料版本不折算为任何可用性。
   */
  async readSourceDashboard(
    request: RiskDashboardDocumentsSourceRequestV1,
  ): Promise<RiskDashboardDocumentsSourceResultV1> {
    const parsed = RiskDashboardDocumentsSourceRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return { kind: "failed", error: dashboardDenied(request.queryId) };
    }
    const valid = parsed.data;
    try {
      const decision = await this.#verifyDashboard(valid, "engineering-data.source-catalog");
      const rows = await this.#visibleSourceVersions(valid.projectId, decision)
        .select([
          "source_version_id",
          "version_id",
          "source_access_grant_ref",
          "source_version_ref",
        ])
        .limit(DASHBOARD_SOURCE_GROUP_LIMIT_V1 + 1)
        .execute();
      if (rows.length > DASHBOARD_SOURCE_GROUP_LIMIT_V1) {
        return { kind: "failed", error: dashboardBlocked(valid.queryId, "dashboard-source-limit") };
      }
      const grantedSources = new Set(
        decision.context.sourceAccessGrantRefs.map((grant) => grant.reference.entityId),
      );
      const seenGrants = new Set<string>();
      const visible = rows.filter((row) => {
        if (grantedSources.size === 0) return true;
        const grant = SourceAccessGrantRefV1Schema.safeParse(row.source_access_grant_ref);
        if (!grant.success || !grantedSources.has(grant.data.reference.entityId)) return false;
        const source = SourceVersionRefV1Schema.safeParse(row.source_version_ref);
        if (
          !source.success ||
          source.data.reference.entityId !== row.source_version_id ||
          source.data.reference.versionId !== row.version_id ||
          seenGrants.has(grant.data.reference.entityId)
        ) {
          throw new Error("catalog source grant identity mismatch");
        }
        seenGrants.add(grant.data.reference.entityId);
        return true;
      });
      const sourceRefs = visible.flatMap((row) => {
        const source = asVersionedRef(row.source_version_ref);
        return source === undefined
          ? []
          : [{ kind: "source-version" as const, reference: source.reference }];
      });
      const cleaning = await this.#cleaningSummaries(
        {
          queryId: valid.queryId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          requestedAt: valid.requestedAt,
          authorization: decision.context,
        },
        decision,
        sourceRefs,
      );
      const cleaningMetadata = sourceRefs.flatMap((sourceRef) => {
        const summary = cleaning.get(refKey(sourceRef));
        return summary === undefined
          ? []
          : [{ source_ref: sourceRef, availability: summary.availability }];
      });
      type DashboardData = Extract<RiskDashboardDocumentsSourceResultV1, { kind: "ready" }>["data"];
      const aggregated = await sql<{ data: DashboardData }>`
        WITH projected AS (
          SELECT
            CASE WHEN conversion.status IS NOT NULL
              THEN CASE WHEN conversion.status = 'succeeded' THEN 'parsed' ELSE 'failed' END
              WHEN EXISTS (
                SELECT 1 FROM business.source_segment_sets segments
                WHERE segments.project_id = ${valid.projectId}
                  AND segments.source_version_id = source.ref -> 'reference' ->> 'entityId'
                  AND jsonb_typeof(segments.source_segment_set_ref -> 'kind') = 'string'
                  AND length(btrim(segments.source_segment_set_ref -> 'reference' ->> 'entityId')) > 0
                  AND length(btrim(segments.source_segment_set_ref -> 'reference' ->> 'versionId')) > 0
              ) THEN 'parsed' ELSE 'registered' END AS parse_status,
            clean.availability
          FROM jsonb_array_elements(${JSON.stringify(sourceRefs)}::jsonb) AS source(ref)
          LEFT JOIN LATERAL (
            SELECT conversions.status
            FROM business.structured_document_conversions conversions
            WHERE conversions.project_id = ${valid.projectId}
              AND conversions.source_version_ref = source.ref
            ORDER BY conversions.completed_at DESC
            LIMIT 1
          ) conversion ON true
          LEFT JOIN jsonb_to_recordset(${JSON.stringify(cleaningMetadata)}::jsonb)
            AS clean(source_ref jsonb, availability text) ON clean.source_ref = source.ref
        )
        SELECT jsonb_build_object(
          'sourceVersionCount', count(*),
          'parseStatusCounts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('parseStatus', parse_status, 'count', count)
              ORDER BY parse_status)
            FROM (SELECT parse_status, count(*) AS count FROM projected GROUP BY parse_status) status_counts
          ), '[]'::jsonb),
          'cleaningStatusCounts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'status', CASE WHEN availability IS NULL
                THEN jsonb_build_object('kind', 'not-registered')
                ELSE jsonb_build_object('kind', 'availability', 'availability', availability) END,
              'count', count) ORDER BY availability NULLS FIRST)
            FROM (SELECT availability, count(*) AS count FROM projected GROUP BY availability) status_counts
          ), '[]'::jsonb)
        ) AS data FROM projected
      `.execute(this.#db);
      return RiskDashboardDocumentsSourceResultV1Schema.parse({
        kind: "ready",
        asOf: this.#now().toISOString(),
        data: aggregated.rows[0]!.data,
      });
    } catch (error) {
      // 授权不符按拒权；未知 DB／I/O 异常按 transient 收口，不折算成权限拒绝（design D-07）。
      if (
        error instanceof AccessServiceError &&
        error.details.code !== "ACCESS_TRANSIENT_FAILURE" &&
        error.details.code !== "ACCESS_TERMINAL_FAILURE"
      ) {
        return { kind: "failed", error: dashboardDenied(valid.queryId) };
      }
      return { kind: "failed", error: dashboardFailed(valid.queryId) };
    }
  }

  /**
   * CH-3 仪表盘监测概况（design D-04、D-05）。
   *
   * 可见序列关系与监测目录一致：授权空间的后代闭包内的当前序列。
   * 批次与快照只统计真实存在的登记行，不外推测点数量、时效或健康状态。
   */
  async readMonitoringDashboard(
    request: RiskDashboardMonitoringSourceRequestV1,
  ): Promise<RiskDashboardMonitoringSourceResultV1> {
    const parsed = RiskDashboardMonitoringSourceRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return { kind: "failed", error: dashboardDenied(request.queryId) };
    }
    const valid = parsed.data;
    try {
      const decision = await this.#verifyDashboard(valid, "engineering-data.monitoring-catalog");
      const covered = await this.#coveredScopeEntityIds(valid.projectId, decision);
      const counts = await this.#visibleMonitoringSeries(valid.projectId, covered)
        .select([
          sql<string>`count(*)`.as("series_count"),
          sql<string>`count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM business.monitoring_batches b
            WHERE b.project_id = s.project_id AND b.series_id = s.series_id
          ))`.as("batch_count"),
          sql<string>`count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM business.monitoring_snapshots snapshot
            WHERE snapshot.project_id = s.project_id AND snapshot.series_id = s.series_id
          ))`.as("snapshot_count"),
        ])
        .executeTakeFirstOrThrow();
      const values = [counts.series_count, counts.batch_count, counts.snapshot_count].map(Number);
      if (values.some((count) => !Number.isSafeInteger(count) || count < 0)) {
        return {
          kind: "failed",
          error: dashboardBlocked(valid.queryId, "dashboard-count-overflow"),
        };
      }
      return RiskDashboardMonitoringSourceResultV1Schema.parse({
        kind: "ready",
        asOf: this.#now().toISOString(),
        data: {
          seriesCount: Number(counts.series_count),
          seriesWithBatchCount: Number(counts.batch_count),
          seriesWithSnapshotCount: Number(counts.snapshot_count),
        },
      });
    } catch (error) {
      if (
        error instanceof AccessServiceError &&
        error.details.code !== "ACCESS_TRANSIENT_FAILURE" &&
        error.details.code !== "ACCESS_TERMINAL_FAILURE"
      ) {
        return { kind: "failed", error: dashboardDenied(valid.queryId) };
      }
      return { kind: "failed", error: dashboardFailed(valid.queryId) };
    }
  }

  /** 仪表盘来源授权复验：按来源分支重新判定当前权限。 */
  async #verifyDashboard(
    request: RiskDashboardDocumentsSourceRequestV1 | RiskDashboardMonitoringSourceRequestV1,
    branch: ModuleBranchV1,
  ): Promise<AuthorizationDecisionV1> {
    if (
      request.projectId !== request.authorization.projectId ||
      request.actorId !== request.authorization.actorId ||
      !request.authorization.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
    ) {
      throw dashboardDeniedError();
    }
    const decision = await this.#access.verify({
      authorizationContextRef: request.authorization.authorizationContextRef,
      invocationId: request.queryId,
      projectId: request.projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: request.requestedAt,
    });
    if (
      decision.redacted ||
      decision.context.projectId !== request.projectId ||
      decision.context.actorId !== request.actorId ||
      !decision.context.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
    ) {
      throw dashboardDeniedError();
    }
    return decision;
  }

  #visibleSourceVersions(projectId: string, decision: AuthorizationDecisionV1) {
    const query = this.#db
      .selectFrom("business.source_versions")
      .where("project_id", "=", projectId)
      .where("access_status", "=", "ready");
    const grants = decision.context.sourceAccessGrantRefs.map((grant) => grant.reference.entityId);
    return grants.length === 0
      ? query
      : query.where(
          sql<SqlBool>`source_access_grant_ref -> 'reference' ->> 'entityId' = ANY(${grants})`,
        );
  }

  #visibleMonitoringSeries(projectId: string, covered: ReadonlySet<string> | null) {
    const query = this.#db
      .selectFrom("business.monitoring_series as s")
      .innerJoin("business.monitoring_series_revisions as r", (join) =>
        join
          .onRef("r.project_id", "=", "s.project_id")
          .onRef("r.series_id", "=", "s.series_id")
          .onRef("r.revision_id", "=", "s.current_revision_id"),
      )
      .where("s.project_id", "=", projectId);
    return covered === null
      ? query
      : query.where(
          sql<SqlBool>`(
          r.spatial_scope_ref -> 'reference' ->> 'entityId' IS NULL
          OR r.spatial_scope_ref -> 'reference' ->> 'entityId' = ANY(${[...covered]})
        )`,
        );
  }

  /** 授权空间范围的后代闭包；空授权范围表示工程级不受限（与 C09 查询语义一致）。 */
  async #coveredScopeEntityIds(
    projectId: string,
    decision: AuthorizationDecisionV1,
  ): Promise<ReadonlySet<string> | null> {
    const granted = decision.context.spatialScopeRefs.map((scope) => scope.reference.entityId);
    if (granted.length === 0) return null;
    const rows = await this.#db
      .selectFrom("business.engineering_spatial_segment_revisions")
      .select(["scope_id", "parent_scope_ref"])
      .where("project_id", "=", projectId)
      .execute();
    const parentByScope = new Map<string, string>();
    for (const row of rows) {
      const parent = asVersionedRef(row.parent_scope_ref);
      if (parent !== undefined) parentByScope.set(row.scope_id, parent.reference.entityId);
    }
    const covered = new Set<string>();
    const queue = [...granted];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      if (covered.has(current)) continue;
      covered.add(current);
      for (const [scopeId, parentId] of parentByScope) {
        if (parentId === current && !covered.has(scopeId)) queue.push(scopeId);
      }
    }
    return covered;
  }

  async #readContext(
    query: Extract<EngineeringDataCatalogQueryV1, { kind: "context-read" }>,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringDataCatalogResultV1> {
    const identity = await this.#db
      .selectFrom("business.engineering_projects")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .executeTakeFirst();
    if (identity === undefined) return failed(readDenied(query.queryId, query.kind));
    const revision = await this.#db
      .selectFrom("business.engineering_project_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("revision_id", "=", identity.current_revision_id)
      .executeTakeFirst();
    if (revision === undefined) return failed(readDenied(query.queryId, query.kind));
    const covered = await this.#coveredScopeEntityIds(query.projectId, decision);
    const scopeRows = await this.#db
      .selectFrom("business.engineering_spatial_segment_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .execute();
    const spatialScopes = scopeRows
      .filter((row) => row.status === "active" && (covered === null || covered.has(row.scope_id)))
      .map((row) => {
        const parent = asVersionedRef(row.parent_scope_ref);
        return {
          spatialScopeRef: row.spatial_scope_ref,
          ...(parent === undefined
            ? {}
            : {
                parentSpatialScopeRef: {
                  kind: "spatial-scope",
                  reference: parent.reference,
                },
              }),
          name: row.name,
          ...(row.worksite_location === "" ? {} : { worksiteLocation: row.worksite_location }),
        };
      });
    const metadataCandidate = ApplicabilityMetadataSchema.safeParse(
      revision.applicability_metadata,
    );
    const missing = (
      Object.entries(APPLICABILITY_DIMENSION_BY_FIELD) as [
        keyof typeof APPLICABILITY_DIMENSION_BY_FIELD,
        ApplicabilityMetadataDimension,
      ][]
    )
      .filter(([field]) => {
        const value = (revision.applicability_metadata as Record<string, unknown> | null)?.[field];
        return typeof value !== "string" || value.trim() === "";
      })
      .map(([, dimension]) => dimension);
    const contextRef = asVersionedRef(revision.project_revision_ref);
    const result = EngineeringDataCatalogSuccessV1Schema.parse({
      kind: "context-read",
      projectId: query.projectId,
      contextStatus: revision.lifecycle === "active" ? "active" : "preparing",
      ...(contextRef === undefined
        ? {}
        : {
            currentProjectRevisionRef: {
              kind: "project-revision",
              reference: contextRef.reference,
            },
          }),
      ...(metadataCandidate.success ? { applicabilityMetadata: metadataCandidate.data } : {}),
      missingApplicabilityDimensions: missing,
      spatialScopes,
    });
    return succeeded(result);
  }

  async #readSourceCatalog(
    query: Extract<EngineeringDataCatalogQueryV1, { kind: "source-catalog" }>,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringDataCatalogResultV1> {
    const pageSize = query.payload.pageSize ?? 50;
    const cursor = decodeCursor(query.payload.cursor);
    if (cursor === "invalid") {
      return failed(readDenied(query.queryId, query.kind));
    }
    const rows = await this.#visibleSourceVersions(query.projectId, decision)
      .selectAll()
      .orderBy("recorded_at", "desc")
      .orderBy("source_version_id", "desc")
      .execute();
    // C11 的登记修订与 C06 当前授权修订不同；当前复验后按稳定授予身份关联精确资料。
    const grantedSources = new Set(
      decision.context.sourceAccessGrantRefs.map((grant) => grant.reference.entityId),
    );
    const seenGrants = new Set<string>();
    const visible = rows.filter((row) => {
      if (grantedSources.size === 0) return true;
      const grant = SourceAccessGrantRefV1Schema.safeParse(row.source_access_grant_ref);
      if (!grant.success || !grantedSources.has(grant.data.reference.entityId)) return false;
      const source = SourceVersionRefV1Schema.safeParse(row.source_version_ref);
      if (
        !source.success ||
        source.data.reference.entityId !== row.source_version_id ||
        source.data.reference.versionId !== row.version_id ||
        seenGrants.has(grant.data.reference.entityId)
      ) {
        throw new Error("catalog source grant identity mismatch");
      }
      seenGrants.add(grant.data.reference.entityId);
      return true;
    });
    const deliveries = await this.#db
      .selectFrom("business.source_deliveries")
      .select(["source_delivery_id", "project_id", "source_metadata", "descriptor"])
      .where("project_id", "=", query.projectId)
      .execute();
    const metadataByDelivery = new Map(
      deliveries.map((row) => [row.source_delivery_id, row.source_metadata] as const),
    );
    // 交付 descriptor 按登记 Schema 解析：只取交付方式与已登记的连接定义引用，摘要、指纹与
    // 任何连接秘密都不转出。解析不出的登记不参与投影，也不据此推断连接状态。
    const descriptorByDelivery = new Map<string, SourceDeliveryDescriptorV1>();
    for (const row of deliveries) {
      const parsed = SourceDeliveryDescriptorV1Schema.safeParse(row.descriptor);
      if (parsed.success) descriptorByDelivery.set(row.source_delivery_id, parsed.data);
    }
    const conversions = await this.#db
      .selectFrom("business.structured_document_conversions")
      .select(["project_id", "source_version_ref", "status", "completed_at"])
      .where("project_id", "=", query.projectId)
      .execute();
    const conversionBySource = new Map<string, ConversionRow>();
    for (const row of conversions) {
      const sourceRef = asVersionedRef(row.source_version_ref);
      if (sourceRef === undefined) continue;
      const key = refKey(sourceRef);
      const existing = conversionBySource.get(key);
      if (existing === undefined || asIso(existing.completed_at) < asIso(row.completed_at)) {
        conversionBySource.set(key, row);
      }
    }
    const segmentSets = await this.#db
      .selectFrom("business.source_segment_sets")
      .select([
        "source_segment_set_id",
        "project_id",
        "source_version_id",
        "source_segment_set_ref",
      ])
      .where("project_id", "=", query.projectId)
      .execute();
    const segmentSetBySourceVersionId = new Map(
      segmentSets.flatMap((row) => {
        const parsed = asVersionedRef(row.source_segment_set_ref);
        return parsed === undefined
          ? []
          : [
              [
                row.source_version_id,
                { kind: "source-segment-set", reference: parsed.reference } as const,
              ],
            ];
      }),
    );
    const items: SourceCatalogItemV1[] = [];
    for (const row of visible) {
      const sourceRef = asVersionedRef(row.source_version_ref);
      if (sourceRef === undefined) continue;
      const metadata = metadataByDelivery.get(row.source_delivery_id) as
        Record<string, unknown> | undefined;
      const documentType =
        typeof metadata?.documentType === "string" && metadata.documentType.trim() !== ""
          ? metadata.documentType
          : undefined;
      if (query.payload.documentType !== undefined && documentType !== query.payload.documentType) {
        continue;
      }
      const conversion = conversionBySource.get(refKey(sourceRef));
      const segmentSetRef = segmentSetBySourceVersionId.get(row.source_version_id);
      const descriptor = descriptorByDelivery.get(row.source_delivery_id);
      // file-upload 的登记 descriptor 本身不持有连接定义引用，缺席即「未登记连接」。
      const connectionDefinitionRef =
        descriptor === undefined || descriptor.kind === "file-upload"
          ? undefined
          : descriptor.connectionDefinitionRef;
      items.push({
        sourceVersionRef: { kind: "source-version", reference: sourceRef.reference },
        sourceId: row.source_id,
        ...(documentType === undefined ? {} : { documentType }),
        ...(typeof metadata?.formedAt === "string" ? { formedAt: metadata.formedAt } : {}),
        ...(typeof metadata?.sourceOrganization === "string" &&
        metadata.sourceOrganization.trim() !== ""
          ? { sourceOrganization: metadata.sourceOrganization }
          : {}),
        ...(typeof metadata?.externalVersion === "string" && metadata.externalVersion.trim() !== ""
          ? { externalVersion: metadata.externalVersion }
          : {}),
        parseStatus:
          conversion === undefined
            ? segmentSetRef === undefined
              ? "registered"
              : "parsed"
            : conversion.status === "succeeded"
              ? "parsed"
              : "failed",
        ...(segmentSetRef === undefined ? {} : { sourceSegmentSetRef: segmentSetRef }),
        ...(descriptor === undefined ? {} : { deliveryKind: descriptor.kind }),
        ...(connectionDefinitionRef === undefined ? {} : { connectionDefinitionRef }),
      });
    }
    const from = cursor ?? 0;
    const page = items.slice(from, from + pageSize);
    const cleaning = await this.#cleaningSummaries(
      query,
      decision,
      page.map((item) => item.sourceVersionRef),
    );
    const next = from + pageSize < items.length ? encodeCursor(from + pageSize) : undefined;
    const sourceNames =
      page.length === 0
        ? []
        : await this.#db
            .selectFrom("business.source_versions as version")
            .innerJoin("business.source_items as item", (join) =>
              join
                .onRef("item.source_item_id", "=", "version.source_item_id")
                .onRef("item.project_id", "=", "version.project_id"),
            )
            .select(["version.source_version_id", "item.name"])
            .where("version.project_id", "=", query.projectId)
            .where(
              "version.source_version_id",
              "in",
              page.map((item) => item.sourceVersionRef.reference.entityId),
            )
            .execute();
    const names = new Map(sourceNames.map((row) => [row.source_version_id, row.name]));
    return succeeded({
      kind: "source-catalog",
      items: page.map((item) => {
        const sourceName = names.get(item.sourceVersionRef.reference.entityId);
        item = { ...item, ...(sourceName === undefined ? {} : { sourceName }) };
        const summary = cleaning.get(refKey(item.sourceVersionRef));
        return summary === undefined
          ? item
          : {
              ...item,
              cleaningAvailability: summary.availability,
              cleaningExclusionCount: summary.exclusionCount,
            };
      }),
      totalCount: items.length,
      ...(next === undefined ? {} : { nextCursor: next }),
    });
  }

  async #cleaningSummaries(
    query: DashboardCleaningQueryV1,
    decision: AuthorizationDecisionV1,
    sourceRefs: readonly VersionedRefValue[],
  ): Promise<
    ReadonlyMap<string, { availability: CleaningAvailabilityV1; exclusionCount: number }>
  > {
    const result = new Map<
      string,
      { availability: CleaningAvailabilityV1; exclusionCount: number }
    >();
    if (sourceRefs.length === 0 || decision.context.sourceAccessGrantRefs.length === 0)
      return result;
    const snapshots = await this.#db
      .selectFrom("business.identification_preparation_snapshots")
      .select(["project_id", "snapshot_payload", "cleaning_result_artifact_ref"])
      .where("project_id", "=", query.projectId)
      .limit(200)
      .execute();
    const artifactBySource = new Map<string, unknown>();
    for (const row of snapshots) {
      const payload = row.snapshot_payload as { sourceVersionRefs?: unknown } | null;
      const refs = Array.isArray(payload?.sourceVersionRefs) ? payload.sourceVersionRefs : [];
      for (const candidate of refs) {
        const parsed = asVersionedRef(candidate);
        if (parsed === undefined) continue;
        const key = refKey(parsed);
        if (!artifactBySource.has(key) && row.cleaning_result_artifact_ref !== null) {
          artifactBySource.set(key, row.cleaning_result_artifact_ref);
        }
      }
    }
    const artifactCache = new Map<string, DataCleaningResultV1 | undefined>();
    for (const sourceRef of sourceRefs) {
      const artifactRefValue = artifactBySource.get(refKey(sourceRef));
      if (artifactRefValue === undefined) continue;
      const cacheKey = JSON.stringify(artifactRefValue);
      if (!artifactCache.has(cacheKey)) {
        artifactCache.set(
          cacheKey,
          await this.#readCleaningArtifact(query, decision, artifactRefValue),
        );
      }
      const cleaningResult = artifactCache.get(cacheKey);
      if (cleaningResult === undefined) continue;
      const input = cleaningResult.inputs.find(
        (entry) =>
          entry.sourceVersionRef !== undefined &&
          entry.sourceVersionRef.reference.entityId === sourceRef.reference.entityId &&
          entry.sourceVersionRef.reference.versionId === sourceRef.reference.versionId,
      );
      if (input === undefined) continue;
      const exclusionCount = cleaningResult.exclusions.filter(
        (exclusion) =>
          exclusion.sourceVersionRef !== undefined &&
          exclusion.sourceVersionRef.reference.entityId === sourceRef.reference.entityId &&
          exclusion.sourceVersionRef.reference.versionId === sourceRef.reference.versionId,
      ).length;
      result.set(refKey(sourceRef), {
        availability: input.availability,
        exclusionCount,
      });
    }
    return result;
  }

  async #readCleaningArtifact(
    query: DashboardCleaningQueryV1,
    decision: AuthorizationDecisionV1,
    artifactRefValue: unknown,
  ): Promise<DataCleaningResultV1 | undefined> {
    try {
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId: `${query.queryId}:cleaning-summary`,
          idempotencyKey: `${query.queryId}:cleaning-summary`,
          artifactRef: artifactRefValue,
          projectId: query.projectId,
          actorId: decision.context.actorId,
          requestedAt: query.requestedAt,
          purposeCode: "engineering-data.data-cleaning-result",
          requiredCapability: "engineering-data.read",
          authorization: decision.context,
        }),
      );
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of handle.content) {
        size += chunk.byteLength;
        if (size > 4 * 1024 * 1024) throw new RangeError("cleaning artifact exceeds read bound");
        chunks.push(chunk);
      }
      await handle.completed;
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const parsed = DataCleaningResultV1Schema.safeParse(
        JSON.parse(new TextDecoder().decode(buffer)),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async #readMonitoringCatalog(
    query: Extract<EngineeringDataCatalogQueryV1, { kind: "monitoring-catalog" }>,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringDataCatalogResultV1> {
    const covered = await this.#coveredScopeEntityIds(query.projectId, decision);
    if (query.payload.monitoringSeriesRef !== undefined) {
      return this.#readMonitoringSeriesDetail(query, decision, covered);
    }
    const pageSize = query.payload.pageSize ?? 50;
    const cursor = decodeCursor(query.payload.cursor);
    if (cursor === "invalid") {
      return failed(readDenied(query.queryId, query.kind));
    }
    const seriesRows = await this.#visibleMonitoringSeries(query.projectId, covered)
      .selectAll("s")
      .orderBy("s.series_id", "asc")
      .execute();
    const revisionRows = await this.#db
      .selectFrom("business.monitoring_series_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .execute();
    const revisionById = new Map(revisionRows.map((row) => [row.revision_id, row] as const));
    const batchCounts = await this.#db
      .selectFrom("business.monitoring_batches")
      .select(["series_id"])
      .where("project_id", "=", query.projectId)
      .execute();
    const countBySeries = new Map<string, number>();
    for (const row of batchCounts) {
      countBySeries.set(row.series_id, (countBySeries.get(row.series_id) ?? 0) + 1);
    }
    const snapshotRows = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .select(["snapshot_id", "project_id", "series_id", "monitoring_snapshot_ref", "recorded_at"])
      .where("project_id", "=", query.projectId)
      .orderBy("recorded_at", "desc")
      .execute();
    const latestSnapshotBySeries = new Map<string, unknown>();
    for (const row of snapshotRows) {
      if (!latestSnapshotBySeries.has(row.series_id)) {
        latestSnapshotBySeries.set(row.series_id, row.monitoring_snapshot_ref);
      }
    }
    const items: MonitoringSeriesCatalogItemV1[] = [];
    for (const series of seriesRows) {
      if (series.current_revision_id === null) continue;
      const revision = revisionById.get(series.current_revision_id);
      if (revision === undefined) continue;
      const scopeRef = asVersionedRef(revision.spatial_scope_ref);
      if (scopeRef !== undefined && covered !== null && !covered.has(scopeRef.reference.entityId)) {
        continue;
      }
      const latestSnapshotRef = asVersionedRef(latestSnapshotBySeries.get(series.series_id));
      items.push({
        monitoringSeriesRef:
          revision.monitoring_series_ref as MonitoringSeriesCatalogItemV1["monitoringSeriesRef"],
        monitoringIndicator:
          revision.monitoring_indicator as MonitoringSeriesCatalogItemV1["monitoringIndicator"],
        monitoringObject: revision.monitoring_object,
        canonicalUnit: revision.canonical_unit,
        spatialScopeRef:
          revision.spatial_scope_ref as MonitoringSeriesCatalogItemV1["spatialScopeRef"],
        batchCount: countBySeries.get(series.series_id) ?? 0,
        ...(latestSnapshotRef === undefined
          ? {}
          : {
              latestSnapshotRef: {
                kind: "monitoring-snapshot",
                reference: latestSnapshotRef.reference,
              },
            }),
      });
    }
    const start = cursor ?? 0;
    const page = items.slice(start, start + pageSize);
    const next = start + pageSize < items.length ? encodeCursor(start + pageSize) : undefined;
    return succeeded({
      kind: "monitoring-series-list",
      items: page,
      totalCount: items.length,
      ...(next === undefined ? {} : { nextCursor: next }),
    });
  }

  async #readMonitoringSeriesDetail(
    query: Extract<EngineeringDataCatalogQueryV1, { kind: "monitoring-catalog" }>,
    decision: AuthorizationDecisionV1,
    covered: ReadonlySet<string> | null,
  ): Promise<EngineeringDataCatalogResultV1> {
    const seriesRef = query.payload.monitoringSeriesRef!;
    const offset = decodeCursor(query.payload.cursor);
    if (offset === "invalid") return failed(readDenied(query.queryId, query.kind));
    const pageSize = query.payload.pageSize ?? 50;
    const revision = await this.#db
      .selectFrom("business.monitoring_series_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where(sql<boolean>`monitoring_series_ref = ${JSON.stringify(seriesRef)}::jsonb`)
      .executeTakeFirst();
    if (revision === undefined) return failed(readDenied(query.queryId, query.kind));
    const scopeRef = asVersionedRef(revision.spatial_scope_ref);
    if (scopeRef !== undefined && covered !== null && !covered.has(scopeRef.reference.entityId)) {
      return failed(readDenied(query.queryId, query.kind));
    }
    const batchRows = await this.#db
      .selectFrom("business.monitoring_batches")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("series_revision_id", "=", revision.revision_id)
      .orderBy("recorded_at", "desc")
      .orderBy(sql`batch_id COLLATE "C"`)
      .offset(offset)
      .limit(pageSize + 1)
      .execute();
    const snapshotRows = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("series_revision_id", "=", revision.revision_id)
      .orderBy("cutoff", "desc")
      .orderBy(sql`snapshot_id COLLATE "C"`)
      .offset(offset)
      .limit(pageSize + 1)
      .execute();
    const batches = batchRows.slice(0, pageSize).map((row) => ({
      monitoringBatchRef: row.monitoring_batch_ref,
      relation: row.relation_kind,
      window: { from: asIso(row.window_from), to: asIso(row.window_to) },
      sampleCount: row.sample_count,
      occurredAt: asIso(row.occurred_at),
    }));
    const snapshots: MonitoringSnapshotCatalogItemV1[] = snapshotRows
      .slice(0, pageSize)
      .map((row) => ({
        monitoringSnapshotRef:
          row.monitoring_snapshot_ref as MonitoringSnapshotCatalogItemV1["monitoringSnapshotRef"],
        cutoff: asIso(row.cutoff),
        availability: row.availability,
        coverageRatio: row.coverage_ratio,
        evidenceSourceVersionRefs: monitoringEvidenceSourceVersionRefs(row.evidence_references),
      }));
    return succeeded({
      kind: "monitoring-series-detail",
      monitoringSeriesRef: revision.monitoring_series_ref,
      monitoringIndicator: revision.monitoring_indicator,
      monitoringObject: revision.monitoring_object,
      canonicalUnit: revision.canonical_unit,
      batches,
      snapshots,
      ...(batchRows.length > pageSize || snapshotRows.length > pageSize
        ? { nextCursor: encodeCursor(offset + pageSize) }
        : {}),
    } as EngineeringDataCatalogSuccessV1);
  }

  async #readResult(
    query: Extract<EngineeringDataCatalogQueryV1, { kind: "read-result" }>,
  ): Promise<EngineeringDataCatalogResultV1> {
    const entityId = query.payload.queryResultRef.reference.entityId;
    const owner = readResultOwnerOf(entityId);
    if (owner === undefined) return failed(readDenied(query.queryId, query.kind));
    if (owner === "registry") {
      // 下游拥有方会自行复验（含空间与来源目标），必须传调用方原始的 authorize 签发上下文；
      // verify 收窄后的上下文只含成员根范围，无法通过目标级空间核对。
      const resolved = await this.#resolvers.resolveReadQuery(
        {
          queryResultRef: query.payload.queryResultRef,
          invocationId: query.queryId,
          projectId: query.projectId,
          actorId: query.actorId,
          requestedAt: query.requestedAt,
          authorization: query.authorization,
        },
        { verifyBranch: "engineering-data.read-result" },
      );
      if (resolved.kind !== "succeeded") {
        return failed(readDenied(query.queryId, query.kind));
      }
      const payload = mapRegistryReadResult(resolved.result);
      if (payload === undefined) {
        return failed(readDenied(query.queryId, query.kind));
      }
      return succeeded({ kind: "read-result", result: payload });
    }
    const resolved = await this.#resolvers.resolveSnapshotQuery(
      {
        queryResultRef: query.payload.queryResultRef,
        invocationId: query.queryId,
        projectId: query.projectId,
        actorId: query.actorId,
        requestedAt: query.requestedAt,
        authorization: query.authorization,
      },
      { verifyBranch: "engineering-data.read-result" },
    );
    if (resolved.kind !== "succeeded" || resolved.result.kind !== "snapshot-query") {
      return failed(readDenied(query.queryId, query.kind));
    }
    const snapshot = resolved.result.query.snapshot;
    const payload = EngineeringReadMonitoringSnapshotSuccessV1Schema.safeParse({
      kind: "monitoring-snapshot",
      queryResultRef: query.payload.queryResultRef,
      snapshot: {
        monitoringSnapshotRef: snapshot.monitoringSnapshotRef,
        monitoringSeriesRef: snapshot.monitoringSeriesRef,
        cutoff: snapshot.cutoff,
        recordedAt: snapshot.recordedAt,
        window: snapshot.window,
        availabilityPolicyRef: snapshot.availabilityPolicyRef,
        availability: snapshot.availability,
        coverageRatio: snapshot.coverageRatio,
        availabilityReasons: snapshot.availabilityReasons,
        alignedPoints: snapshot.alignedPoints.map((point) => ({
          sampledAt: point.sampledAt,
          value: point.value,
          unit: point.unit,
          status: point.status,
          ...(point.reasonCode === undefined ? {} : { reasonCode: point.reasonCode }),
        })),
        features: {
          shortTermSlope: mapFeature(snapshot.features.shortTermSlope),
          acceleration: mapFeature(snapshot.features.acceleration),
          dominantFrequency: mapFeature(snapshot.features.dominantFrequency),
          anomalyScore: mapFeature(snapshot.features.anomalyScore),
        },
        monitoringBatchRefs: snapshot.monitoringBatchRefs.slice(0, 100),
        evidenceReferences: snapshot.evidenceReferences.slice(0, 256),
      },
    });
    if (!payload.success) {
      return failed(readDenied(query.queryId, query.kind));
    }
    return succeeded({ kind: "read-result", result: payload.data });
  }
}

const mapFeature = (feature: {
  readonly featureType: string;
  readonly value?: number | undefined;
  readonly unit?: string | undefined;
  readonly status: string;
  readonly reasonCode?: string | undefined;
}) => ({
  featureType: feature.featureType,
  ...(feature.value === undefined ? {} : { value: feature.value }),
  ...(feature.unit === undefined ? {} : { unit: feature.unit }),
  status: feature.status,
  ...(feature.reasonCode === undefined ? {} : { reasonCode: feature.reasonCode }),
});

const mapSegment = (segment: {
  readonly sourceSegmentId: string;
  readonly chapterId: string;
  readonly segmentId: string;
  readonly kind: string;
  readonly locator: unknown;
}): EngineeringReadSourceSegmentV1 => ({
  sourceSegmentId: segment.sourceSegmentId,
  chapterId: segment.chapterId,
  segmentId: segment.segmentId,
  kind: segment.kind as EngineeringReadSourceSegmentV1["kind"],
  locator: segment.locator as EngineeringReadSourceSegmentV1["locator"],
});

const mapRegistryReadResult = (
  result: Extract<EngineeringDataReadResolutionResultV1, { kind: "succeeded" }>["result"],
) => {
  if (result.kind === "source-segments") {
    const parsed = EngineeringReadSegmentSetSuccessV1Schema.safeParse({
      kind: "source-segments",
      queryResultRef: result.queryResultRef,
      segmentSet: {
        sourceSegmentSetRef: result.segmentSet.sourceSegmentSetRef,
        sourceVersionRef: result.segmentSet.sourceVersionRef,
        sourceId: result.segmentSet.sourceId,
        segments: result.segmentSet.segments.map(mapSegment),
        recordedAt: result.segmentSet.recordedAt,
      },
      sourceAccessGrantRef: result.sourceAccessGrantRef,
    });
    return parsed.success ? parsed.data : undefined;
  }
  const parsed = EngineeringReadEvidenceSuccessV1Schema.safeParse({
    kind: "evidence-access",
    queryResultRef: result.queryResultRef,
    purposeCode: result.purposeCode,
    items: result.items.map((item) => ({
      evidenceReference: item.evidenceReference,
      sourceVersionRef: item.sourceVersionRef,
      sourceSegmentSetRef: item.sourceSegmentSetRef,
      sourceAccessGrantRef: item.sourceAccessGrantRef,
      segment: mapSegment(item.segment),
    })),
  });
  return parsed.success ? parsed.data : undefined;
};

const decodeCursor = (cursor: string | undefined): number | "invalid" => {
  if (cursor === undefined) return 0;
  if (!/^offset-\d+$/u.test(cursor)) return "invalid";
  return Number.parseInt(cursor.slice("offset-".length), 10);
};

const encodeCursor = (offset: number): string => `offset-${offset}`;

/**
 * 工程目录适配器的完整公开面：原目录 port 加上 CH-3 的两条仪表盘窄读。
 * 组合根据此注入仪表盘来源，不需要额外包装层。
 */
export interface EngineeringDataCatalogAdapterV1
  extends
    EngineeringDataCatalogPortV1,
    RiskDashboardDocumentsSourceV1,
    RiskDashboardMonitoringSourceV1 {}

export const createPostgresEngineeringDataCatalogAdapter = (
  options: PostgresEngineeringDataCatalogAdapterOptionsV1,
): EngineeringDataCatalogAdapterV1 => new PostgresEngineeringDataCatalogAdapter(options);
