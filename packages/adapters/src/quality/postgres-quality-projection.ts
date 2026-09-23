import type { ColumnType, Kysely, Selectable } from "kysely";
import { sql } from "kysely";

import {
  ModuleErrorV1Schema,
  ProjectionQueryV1Schema,
  ProjectionQuerySuccessV1Schema,
  QualityEvaluationSummaryV1Schema,
  type ProjectionQueryResultV1,
  type ProjectionQuerySuccessV1,
} from "@riskflow/contracts/ports";
import type { JsonValue } from "@riskflow/core/persistence";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { IdentifierSchema, IsoDateTimeSchema, VersionReferenceSchema } from "@riskflow/contracts/common";

import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;

const REPORT_INDEX_TABLE = "business.quality_evaluation_report_index" as const;
const PAGE_SIZE_MAX_V1 = 50;
const UNSUPPORTED_SCHEMA_VERSION_V1 = "quality-evaluation-query/unsupported";

interface QualityEvaluationReportIndexRow {
  readonly project_id: string;
  readonly report_artifact_id: string;
  readonly report_artifact_version_id: string;
  readonly project_revision_id: string;
  readonly project_revision_version_id: string;
  readonly sample_kind: string;
  readonly spatial_scope_refs: JsonColumn;
  readonly summary_digest: string;
  readonly summary_payload: JsonColumn;
  readonly created_at: ColumnType<Date, Date | string, Date | string>;
}

type QualityIndexRow = Selectable<QualityEvaluationReportIndexRow>;

interface QualityProjectionDatabase extends PostgresDatabase {
  "business.quality_evaluation_report_index": QualityEvaluationReportIndexRow;
}

interface QualityCursorV1 {
  readonly projectId: string;
  readonly projectRevisionRef: { readonly entityId: string; readonly versionId: string };
  readonly createdAt: string;
  readonly reportArtifactId: string;
  readonly reportArtifactVersionId: string;
}

const notFound = (queryId: string, occurredAt: string): ProjectionQueryResultV1 => ({
  kind: "failed",
  error: ModuleErrorV1Schema.parse({
    code: "ENTITY_NOT_FOUND",
    category: "not-found",
    retryable: false,
    stageCode: "quality-evaluation.query",
    occurredAt,
    causalRunId: queryId,
    targetRef: { kind: "query-result", reference: { entityId: queryId, versionId: "1" } },
  }),
});

const unsupported = (queryId: string, occurredAt: string): ProjectionQueryResultV1 => ({
  kind: "failed",
  error: ModuleErrorV1Schema.parse({
    code: "UNSUPPORTED_CONTRACT",
    category: "technical",
    retryable: false,
    stageCode: "quality-evaluation.query",
    occurredAt,
    causalRunId: queryId,
    schemaVersion: UNSUPPORTED_SCHEMA_VERSION_V1,
  }),
});

const encodeCursor = (cursor: QualityCursorV1): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const decodeCursor = (value: string): QualityCursorV1 | undefined => {
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value))
    return undefined;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const cursor = parsed as Partial<QualityCursorV1>;
    if (
      Object.keys(cursor).sort().join(",") !==
        "createdAt,projectId,projectRevisionRef,reportArtifactId,reportArtifactVersionId" ||
      !IdentifierSchema.safeParse(cursor.projectId).success ||
      !VersionReferenceSchema.safeParse(cursor.projectRevisionRef).success ||
      !IsoDateTimeSchema.safeParse(cursor.createdAt).success ||
      !IdentifierSchema.safeParse(cursor.reportArtifactId).success ||
      !IdentifierSchema.safeParse(cursor.reportArtifactVersionId).success
    ) return undefined;
    return cursor as QualityCursorV1;
  } catch {
    return undefined;
  }
};

const asIso = (value: Date | string): string =>
  typeof value === "string" ? value : value.toISOString();

export interface PostgresQualityProjectionOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly now?: () => Date;
}

/**
 * C36 窄查询投影（D-04/D-06）：只读 `business.quality_evaluation_report_index` 中
 * 写入时已由 C04 `verified` 核对的安全摘要，不打开报告正文，也不读取 C22/C29/C14 私表。
 * 无权、跨工程与不存在统一收口为同形 `ENTITY_NOT_FOUND`，查询不写任何业务事实。
 */
export class PostgresQualityProjectionAdapter {
  readonly #db: Kysely<QualityProjectionDatabase>;
  readonly #now: () => Date;

  constructor(options: PostgresQualityProjectionOptionsV1) {
    this.#db = options.db as unknown as Kysely<QualityProjectionDatabase>;
    this.#now = options.now ?? (() => new Date());
  }

  async query(request: unknown): Promise<ProjectionQueryResultV1> {
    const parsed = ProjectionQueryV1Schema.safeParse(request);
    if (!parsed.success) throw parsed.error;
    const query = parsed.data;
    const occurredAt = this.#now().toISOString();
    if (query.payload.queryType !== "quality-evaluation")
      return unsupported(query.queryId, occurredAt);
    const authorization = query.authorization;
    if (
      authorization.projectId !== query.projectId ||
      authorization.actorId !== query.actorId ||
      authorization.grantedCapabilities.length !== 1 ||
      authorization.grantedCapabilities[0] !== "projection.query" ||
      authorization.spatialScopeRefs.length === 0
    ) {
      return notFound(query.queryId, occurredAt);
    }

    const selector = query.payload.selector;
    const allowedSpatialScopes = JSON.stringify(authorization.spatialScopeRefs);
    const rows =
      selector.mode === "exact"
        ? await this.#db
            .selectFrom(REPORT_INDEX_TABLE)
            .selectAll()
            .where("project_id", "=", query.projectId)
            .where(sql<boolean>`spatial_scope_refs <@ ${allowedSpatialScopes}::jsonb`)
            .where("report_artifact_id", "=", selector.reportArtifactRef.reference.entityId)
            .where(
              "report_artifact_version_id",
              "=",
              selector.reportArtifactRef.reference.versionId,
            )
            .execute()
        : await this.#listRows(
            query.projectId,
            selector.projectRevisionRef,
            selector.pageSize,
            selector.cursor,
            allowedSpatialScopes,
          );
    // 精确查询只返一项：跨工程、撤权与不存在都收口为同形拒绝；空列表只在列表模式下成立。
    if (rows === undefined || (selector.mode === "exact" && rows.length === 0)) {
      return notFound(query.queryId, occurredAt);
    }

    const summaries = [];
    for (const row of rows) {
      const summary = QualityEvaluationSummaryV1Schema.safeParse(row.summary_payload);
      if (!summary.success || sha256CanonicalJson(summary.data) !== row.summary_digest) {
        return notFound(query.queryId, occurredAt);
      }
      summaries.push({
        ...summary.data,
        // C06 grant 引用与资料版本引用不是同一身份；缺少授权映射时关闭定位引用。
        evidenceRefs: [],
      });
    }
    const last = rows.at(-1);
    const success: ProjectionQuerySuccessV1 = ProjectionQuerySuccessV1Schema.parse({
      queryResultRef: {
        kind: "query-result",
        reference: {
          entityId: `quality-evaluation-query-${sha256CanonicalJson({
            projectId: query.projectId,
            projectRevisionRef:
              selector.mode === "list" ? selector.projectRevisionRef : query.payload.selector,
          })}`,
          versionId: "1",
        },
      },
      qualitySummaries: summaries,
      ...(selector.mode === "list" && rows.length === selector.pageSize && last !== undefined
        ? {
            nextCursor: encodeCursor({
              projectId: query.projectId,
              projectRevisionRef: selector.projectRevisionRef.reference,
              createdAt: asIso(last.created_at),
              reportArtifactId: last.report_artifact_id,
              reportArtifactVersionId: last.report_artifact_version_id,
            }),
          }
        : {}),
    });
    return { kind: "succeeded", result: success };
  }

  async #listRows(
    projectId: string,
    projectRevisionRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    },
    pageSize: number,
    cursor: string | undefined,
    allowedSpatialScopes: string,
  ): Promise<readonly QualityIndexRow[] | undefined> {
    const limit = Math.min(pageSize, PAGE_SIZE_MAX_V1);
    let builder = this.#db
      .selectFrom(REPORT_INDEX_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where(sql<boolean>`spatial_scope_refs <@ ${allowedSpatialScopes}::jsonb`)
      .where("project_revision_id", "=", projectRevisionRef.reference.entityId)
      .where("project_revision_version_id", "=", projectRevisionRef.reference.versionId);
    if (cursor !== undefined) {
      const decoded = decodeCursor(cursor);
      if (
        decoded === undefined ||
        decoded.projectId !== projectId ||
        decoded.projectRevisionRef.entityId !== projectRevisionRef.reference.entityId ||
        decoded.projectRevisionRef.versionId !== projectRevisionRef.reference.versionId
      ) {
        return undefined;
      }
      builder = builder.where(
        sql<boolean>`(created_at, report_artifact_id, report_artifact_version_id) < (${decoded.createdAt}::timestamp with time zone, ${decoded.reportArtifactId}, ${decoded.reportArtifactVersionId})`,
      );
    }
    return await builder
      .orderBy("created_at", "desc")
      .orderBy("report_artifact_id", "desc")
      .orderBy("report_artifact_version_id", "desc")
      .limit(limit)
      .execute();
  }
}

export const createPostgresQualityProjectionAdapter = (
  options: PostgresQualityProjectionOptionsV1,
): PostgresQualityProjectionAdapter => new PostgresQualityProjectionAdapter(options);
