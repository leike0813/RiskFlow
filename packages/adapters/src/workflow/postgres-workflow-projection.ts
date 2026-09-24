/**
 * C30 有界运行/追踪投影与 C31 关联图/报告投影（design D-06/D-03）。
 *
 * `ProjectionPortV1.query` 只登记精确目标、权限快照与记录时点；`ProjectionResultReadPortV1.readPage`
 * 每页重验授权，从 C30 自有运行/链边事实分页，最多一批 C22 `readBatch` 补齐来源定位。
 * 不可由已成立事实证明的链边不生成占位链尾；无权与不存在对调用方同形。
 * C31 的关联图按已证明的运行连接扩展，报告按冻结修订/空间逐运行展开；越界与不可证明一律显式失败。
 */
import { sql, type Kysely, type SqlBool } from "kysely";

import type {
  AuthorizationContextV1,
  ContentArtifactRefV1,
  ContractReferenceV1,
  ModuleErrorV1,
  ModuleBranchV1,
  ModuleCapabilityV1,
  ProjectionExportRequestV1,
  ProjectionExportResultV1,
  ProjectionPortV1,
  ProjectionQueryV1,
  ProjectionReportFactRefV1,
  ProjectionResultItemV1,
  ProjectionResultReadPortV1,
  ProjectionResultReadRequestV1,
  ProjectionResultReadResultV1,
  ProjectionSubscriptionResultV1,
  RiskRecordTraceReadPortV1,
  RiskRecordTraceReadResultV1,
  RunSubscriptionRequestV1,
  SpatialScopeRefV1,
  StandardizedRiskRecordRefV1,
} from "@riskflow/contracts/ports";
import {
  ContractReferenceV1Schema,
  ProjectionQueryV1Schema,
  ProjectionResultReadRequestV1Schema,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  type WorkflowGraphArtifactBodyV1,
  type WorkflowGraphBodyPortV1,
  type WorkflowGraphLinkV1,
  type WorkflowGraphRegistrationStoreV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunResultV1,
  type WorkflowGraphRunStateV1,
} from "@riskflow/core/workflow";

import {
  workflowGraphLinkFromDb,
  workflowGraphResultRowFromDb,
  type WorkflowGraphLinkDbRow,
  type WorkflowGraphResultDbRow,
} from "./postgres-workflow-adapter.js";
import type { PostgresDatabase } from "../postgres/types.js";

const RESULTS_TABLE = "business.workflow_graph_results";
const LINKS_TABLE = "business.workflow_graph_links";
const MAX_PAGE_SIZE_V1 = 100;
const MAX_SCAN_V1 = 200;
/** 图分页与图规模上限（C31 design D-02/D-03）：越界显式失败，不裁成伪完整图。 */
const MAX_GRAPH_PAGE_SIZE_V1 = 50;
const MAX_GRAPH_RUNS_V1 = 32;
const MAX_GRAPH_LINKS_V1 = 1000;
/** 单运行报告事实/缺席项展开上限，避免跨 C04 逐行调用（C31 design D-03）。 */
const MAX_REPORT_ITEMS_PER_RUN_V1 = 1000;
const MAX_EVIDENCE_REFS_V1 = 100;

interface WorkflowGraphProjectionDatabaseV1 {
  "business.workflow_graph_links": WorkflowGraphLinkDbRow;
  "business.workflow_graph_results": WorkflowGraphResultDbRow;
}

type ProjectionDatabaseV1 = PostgresDatabase & WorkflowGraphProjectionDatabaseV1;
type ProjectionQueryExecutorV1 = Kysely<ProjectionDatabaseV1>;

const BRANCH_BY_CAPABILITY_V1: Partial<Record<ModuleCapabilityV1, ModuleBranchV1>> = {
  "projection.query": "projection.query",
  "workflow.start": "workflow.start-run",
  "workflow.resume": "workflow.resume-run",
  "workflow.cancel": "workflow.cancel-run",
};

const auditTrailRefOf = (auditEntryId: string) => ({
  kind: "audit-trail" as const,
  reference: { entityId: auditEntryId, versionId: "1" },
});

/** 稳定游标（design D-06）：绑定查询引用、排序键与授权摘要，并带不可伪造的摘要后缀。 */
const encodeCursor = (input: {
  readonly queryResultRef: { readonly entityId: string; readonly versionId: string };
  readonly sortKey: string;
  readonly scopeDigest: string;
}): string => {
  const fields = [
    input.queryResultRef.entityId,
    input.queryResultRef.versionId,
    input.sortKey,
    input.scopeDigest,
  ];
  const encoded = Buffer.from(JSON.stringify(fields), "utf8").toString("base64url");
  return `${encoded}.${sha256CanonicalJson(fields)}`;
};

const decodeCursor = (input: {
  readonly cursor: string;
  readonly queryResultRef: { readonly entityId: string; readonly versionId: string };
  readonly scopeDigest: string;
}): { readonly sortKey: string } | undefined => {
  const separator = input.cursor.lastIndexOf(".");
  if (separator <= 0) return undefined;
  const encoded = input.cursor.slice(0, separator);
  const digest = input.cursor.slice(separator + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) return undefined;
  const fields = parsed as readonly string[];
  if (sha256CanonicalJson(fields) !== digest) return undefined;
  if (
    fields[0] !== input.queryResultRef.entityId ||
    fields[1] !== input.queryResultRef.versionId ||
    fields[3] !== input.scopeDigest ||
    typeof fields[2] !== "string"
  ) {
    return undefined;
  }
  return { sortKey: fields[2] };
};

const unsupportedBranch = (stageCode: string, occurredAt: string): ModuleErrorV1 =>
  ({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    stageCode,
    occurredAt,
    causalRunId: "c30-projection",
    blockerKind: "projection-branch-unsupported",
    blockerRef: {
      kind: "query-result",
      reference: { entityId: "c30-projection", versionId: "1" },
    },
  }) as ModuleErrorV1;

/** 报告排序键（C31 design D-03）：运行内顺序为运行摘要、事实、缺席项，各自带稳定身份键。 */
const REPORT_SUMMARY_RANK_V1 = "0";
const REPORT_FACT_RANK_V1 = "1";
const REPORT_ABSENCE_RANK_V1 = "2";
const REPORT_SUMMARY_KEY_V1 = `${REPORT_SUMMARY_RANK_V1}|run-summary`;

/** 报告游标载荷（C31 design D-03）：运行键与运行内事实排序键；外层仍绑定查询引用与授权摘要。 */
const encodeReportSortKey = (input: { readonly runId: string; readonly itemKey: string }): string =>
  JSON.stringify([input.runId, input.itemKey]);

const decodeReportSortKey = (
  sortKey: string,
): { readonly runId: string; readonly itemKey: string } | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sortKey);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [runId, itemKey] = parsed as readonly unknown[];
  if (typeof runId !== "string" || typeof itemKey !== "string") return undefined;
  return { runId, itemKey };
};

interface ProjectionReportEntryV1 {
  readonly key: string;
  readonly item: ProjectionResultItemV1;
}

/** 报告读取的冻结范围（design D-03/D-04）：精确修订、可选空间、授权摘要与登记时点。 */
interface ProjectionReportScopeV1 {
  readonly projectId: string;
  readonly revisionRef: ContractReferenceV1;
  readonly spatialScopeRef?: SpatialScopeRefV1 | undefined;
  readonly scopeDigest: string;
  readonly recordedAtAtMost: string;
}

/** 有界来源读取的两种收口：越界不裁半份结果，由调用方映射为稳定失败。 */
type ProjectionBoundedReadV1<T> =
  { readonly kind: "ok"; readonly value: T } | { readonly kind: "overflow" };

export interface PostgresWorkflowProjectionOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & WorkflowGraphProjectionDatabaseV1>`。 */
  readonly db: unknown;
  /** C30 自有登记面：查询登记经同一端口写入，避免出现第二条登记路径。 */
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  /** C04 正文端口：运行汇总只读状态正文，不复制领域事实。 */
  readonly bodies: WorkflowGraphBodyPortV1;
  /** C05 当前授权复验端口：每次受保护读写前按当前 actor/工程/空间/资料范围复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  /** C22 公开批读：旧 trace-chain 可省略；C31 风险记录图/报告缺失时显式失败。 */
  readonly riskRecordTrace?: RiskRecordTraceReadPortV1;
  readonly now?: () => Date;
}

export interface PostgresWorkflowProjectionV1 {
  readonly queryProjection: ProjectionPortV1;
  readonly resultRead: ProjectionResultReadPortV1;
}

class WorkflowGraphProjection {
  readonly #db: ProjectionQueryExecutorV1;
  readonly #store: WorkflowGraphRegistrationStoreV1;
  readonly #bodies: WorkflowGraphBodyPortV1;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #trace: RiskRecordTraceReadPortV1 | undefined;
  readonly #now: () => Date;

  constructor(options: PostgresWorkflowProjectionOptionsV1) {
    this.#db = options.db as unknown as ProjectionQueryExecutorV1;
    this.#store = options.registrationStore;
    this.#bodies = options.bodies;
    this.#authorization = options.authorization;
    this.#trace = options.riskRecordTrace;
    this.#now = options.now ?? (() => new Date());
  }

  /** 复验当前授权；无权与异常一律返回 `undefined`，由调用方按同形失败收口。 */
  async #verify(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    /** C31 工程总览的精确空间目标：随复验收窄，不凭查询引用推断空间权限（design D-04）。 */
    readonly spatialScopeRefs?: readonly SpatialScopeRefV1[] | undefined;
  }): Promise<AuthorizationContextV1 | undefined> {
    if (input.authorization.projectId !== input.projectId) return undefined;
    if (input.authorization.actorId !== input.actorId) return undefined;
    if (input.authorization.grantedCapabilities.length !== 1) return undefined;
    const capability = input.authorization.grantedCapabilities[0];
    if (capability === undefined) return undefined;
    const branch = BRANCH_BY_CAPABILITY_V1[capability];
    if (branch === undefined) return undefined;
    try {
      const decision = await this.#authorization.verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: input.invocationId,
        projectId: input.projectId,
        branch,
        requestedSpatialScopeRefs: [...(input.spatialScopeRefs ?? [])],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      });
      const verified = decision.context;
      if (
        verified.projectId !== input.projectId ||
        verified.actorId !== input.actorId ||
        verified.grantedCapabilities.length !== 1 ||
        verified.grantedCapabilities[0] !== capability
      ) {
        return undefined;
      }
      return verified;
    } catch {
      return undefined;
    }
  }

  #blocked(stageCode: string, blockerKind: string): ModuleErrorV1 {
    return {
      code: "BUSINESS_BLOCKED",
      category: "business-blocked",
      retryable: false,
      stageCode,
      occurredAt: this.#now().toISOString(),
      causalRunId: "c30-projection",
      blockerKind,
      blockerRef: {
        kind: "query-result",
        reference: { entityId: "c30-projection", versionId: "1" },
      },
    } as ModuleErrorV1;
  }

  /** 无权与不存在同形：只带稳定 code 与阶段，不泄露受限目标存在性。 */
  #notFound(stageCode: string): ModuleErrorV1 {
    return {
      code: "ENTITY_NOT_FOUND",
      category: "not-found",
      retryable: false,
      stageCode,
      occurredAt: this.#now().toISOString(),
      causalRunId: "c30-projection",
      targetRef: {
        kind: "query-result",
        reference: { entityId: "c30-projection-unavailable", versionId: "1" },
      },
    } as ModuleErrorV1;
  }

  async query(request: ProjectionQueryV1): Promise<Awaited<ReturnType<ProjectionPortV1["query"]>>> {
    const parsed = ProjectionQueryV1Schema.safeParse(request);
    if (!parsed.success) {
      return { kind: "failed", error: this.#blocked("projection-query", "query-invalid") };
    }
    const payload = parsed.data.payload;
    // 工程总览的空结果在合法授权下是正式结果，其空间目标先按登记输入复验收窄（design D-04）。
    const requestedSpatialScopeRefs =
      payload.queryType === "risk-overview" && payload.spatialScopeRef !== undefined
        ? [payload.spatialScopeRef]
        : [];
    const verified = await this.#verify({
      authorization: parsed.data.authorization,
      projectId: parsed.data.projectId,
      actorId: parsed.data.actorId,
      invocationId: `c30-query:${parsed.data.projectId}:${parsed.data.queryId}`,
      requestedAt: parsed.data.requestedAt,
      spatialScopeRefs: requestedSpatialScopeRefs,
    });
    if (verified === undefined) {
      return { kind: "failed", error: this.#notFound("projection-query") };
    }
    const targetRef = this.#registrationTarget(payload);
    if (targetRef === undefined) {
      // C34 的页面分支不属于本 change：显式失败，不用空投影冒充结果。
      return { kind: "failed", error: this.#blocked("projection-query", "query-type-unsupported") };
    }
    const spatialScopeRef =
      payload.queryType === "risk-overview" ? payload.spatialScopeRef : undefined;
    const scopeDigest = authorizationScopeDigest(verified);
    let registrationRunId: string | undefined;
    if (payload.queryType !== "risk-overview") {
      const visible = await this.#visibleTargets({
        projectId: parsed.data.projectId,
        targetRef,
        runId:
          payload.queryType === "run-view" ? payload.workflowRunRef.reference.entityId : undefined,
        scopeDigest,
      });
      if (visible.visibleCount === 0) {
        return { kind: "failed", error: this.#notFound("projection-query") };
      }
      if (
        payload.queryType === "association-graph" &&
        (await this.#evidenceForSubject(targetRef, verified)) === "unprovable"
      ) {
        return { kind: "failed", error: this.#notFound("projection-query") };
      }
      registrationRunId = visible.runId;
    }
    const queryResultId = `query-result:${parsed.data.projectId}:${parsed.data.queryId}`;
    const queryResultVersionId = sha256CanonicalJson({
      queryType: payload.queryType,
      targetRef,
      // 旧分支的登记版本保持原载荷，不因 C31 加法字段漂移。
      ...(spatialScopeRef === undefined ? {} : { spatialScopeRef }),
      scopeDigest,
    });
    const outcome = await this.#store.registerQuery({
      registration: {
        schemaVersion: "1",
        projectId: parsed.data.projectId,
        queryResultId,
        queryResultVersionId,
        queryType: payload.queryType,
        targetRef,
        ...(registrationRunId === undefined ? {} : { runId: registrationRunId }),
        ...(spatialScopeRef === undefined ? {} : { spatialScopeRef }),
        actorRef: parsed.data.actorId,
        authorizationContextRef: parsed.data.authorization.authorizationContextRef,
        authorizationScopeDigest: scopeDigest,
        requestedAt: parsed.data.requestedAt,
        recordedAt: parsed.data.requestedAt,
        persistedAt: parsed.data.requestedAt,
        auditEntryId: `${queryResultId}:audit`,
      },
    });
    if (outcome.kind === "idempotency-conflict") {
      return {
        kind: "failed",
        error: this.#blocked("projection-query", "query-identity-conflict"),
      };
    }
    return {
      kind: "succeeded",
      result: {
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: queryResultId, versionId: queryResultVersionId },
        },
      },
    };
  }

  /** 登记目标（design D-02/D-03）：旧分支取原有目标，关联图取精确主题，总览取精确工程修订。 */
  #registrationTarget(payload: ProjectionQueryV1["payload"]): ContractReferenceV1 | undefined {
    switch (payload.queryType) {
      case "run-view":
        return { kind: "workflow-run", reference: payload.workflowRunRef.reference };
      case "trace-chain":
      case "association-graph":
        return payload.subjectRef;
      case "risk-overview":
        return payload.projectRevisionRef;
      default:
        return undefined;
    }
  }

  subscribe(request: RunSubscriptionRequestV1): Promise<ProjectionSubscriptionResultV1> {
    void request;
    return Promise.resolve({
      kind: "failed",
      error: unsupportedBranch("projection-subscribe", this.#now().toISOString()),
    });
  }

  export(request: ProjectionExportRequestV1): Promise<ProjectionExportResultV1> {
    void request;
    return Promise.resolve({
      kind: "failed",
      error: unsupportedBranch("projection-export", this.#now().toISOString()),
    });
  }

  /** 目标可见性判定：只统计当前授权摘要下确实成立的事实，不做全库读取。 */
  async #visibleTargets(input: {
    readonly projectId: string;
    readonly targetRef: ContractReferenceV1;
    readonly runId: string | undefined;
    readonly scopeDigest: string;
  }): Promise<{ readonly visibleCount: number; readonly runId: string | undefined }> {
    if (input.runId !== undefined) {
      const rows = await this.#store.listRunRows({
        projectId: input.projectId,
        runId: input.runId,
        limit: MAX_SCAN_V1,
      });
      return {
        visibleCount: rows.filter((row) => row.authorizationScopeDigest === input.scopeDigest)
          .length,
        runId: input.runId,
      };
    }
    const links = await this.#linksForSubject({
      projectId: input.projectId,
      subjectRef: input.targetRef,
      scopeDigest: input.scopeDigest,
    });
    return { visibleCount: links.length, runId: links[0]?.runId };
  }

  /**
   * 主题相邻边（design D-02）：精确 JSONB 包含谓词可用定向 GIN 索引，并按当前授权摘要与（C31 图分支的）
   * 登记时点截断；JS 侧不再过滤授权摘要，谓词即边界。
   */
  async #linksForSubject(input: {
    readonly projectId: string;
    readonly subjectRef: ContractReferenceV1;
    readonly scopeDigest: string;
    readonly recordedAtAtMost?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly WorkflowGraphLinkV1[]> {
    if (input.subjectRef.kind === "domain-event") return [];
    const subjectJson = JSON.stringify(input.subjectRef);
    const base = this.#db
      .selectFrom(LINKS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("authorization_scope_digest", "=", input.scopeDigest)
      .where(sql<SqlBool>`from_ref @> ${subjectJson}::jsonb OR to_ref @> ${subjectJson}::jsonb`);
    const scoped =
      input.recordedAtAtMost === undefined
        ? base
        : base.where("recorded_at", "<=", input.recordedAtAtMost);
    const rows = await scoped
      .orderBy("recorded_at", "asc")
      .orderBy("link_id", "asc")
      .limit(input.limit ?? MAX_SCAN_V1)
      .execute();
    return rows.map((row) => workflowGraphLinkFromDb(row));
  }

  /**
   * 有界分页读取（design D-06）：先按查询登记的记录时点截取 C30 自有事实，再按持久化时间与稳定键
   * 分页；最多一批 C22 `readBatch` 补齐来源定位；游标绑定查询引用、排序键与授权摘要。
   */
  async readPage(request: ProjectionResultReadRequestV1): Promise<ProjectionResultReadResultV1> {
    const parsed = ProjectionResultReadRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return { kind: "failed", error: this.#blocked("read-page", "read-request-invalid") };
    }
    const queryResultRef = parsed.data.queryResultRef;
    const registration = await this.#store.readQuery({
      projectId: parsed.data.projectId,
      queryResultId: queryResultRef.reference.entityId,
      queryResultVersionId: queryResultRef.reference.versionId,
    });
    if (registration === undefined) {
      return { kind: "failed", error: this.#notFound("read-page") };
    }
    const verified = await this.#verify({
      authorization: parsed.data.authorization,
      projectId: parsed.data.projectId,
      actorId: parsed.data.authorization.actorId,
      invocationId: `c30-read-page:${parsed.data.projectId}:${registration.queryResultId}`,
      requestedAt: parsed.data.requestedAt,
      spatialScopeRefs:
        registration.spatialScopeRef === undefined ? [] : [registration.spatialScopeRef],
    });
    if (verified === undefined) {
      return { kind: "failed", error: this.#notFound("read-page") };
    }
    const scopeDigest = authorizationScopeDigest(verified);
    if (scopeDigest !== registration.authorizationScopeDigest) {
      // 后续撤权使历史查询不可见；历史业务事实与审计不变。
      return { kind: "failed", error: this.#notFound("read-page") };
    }
    const limit = Math.min(Math.max(parsed.data.limit, 1), MAX_PAGE_SIZE_V1);
    let sortKey: string | undefined;
    if (parsed.data.cursor !== undefined) {
      const decoded = decodeCursor({
        cursor: parsed.data.cursor,
        queryResultRef: queryResultRef.reference,
        scopeDigest,
      });
      if (decoded === undefined) {
        return { kind: "failed", error: this.#blocked("read-page", "cursor-invalid") };
      }
      sortKey = decoded.sortKey;
    }
    if (registration.queryType === "run-view") {
      if (registration.runId === undefined) {
        return { kind: "failed", error: this.#blocked("read-page", "run-view-target-missing") };
      }
      return await this.#readRunView({
        registration,
        scopeDigest,
        limit,
        sortKey,
        actorId: verified.actorId,
        authorization: verified,
      });
    }
    if (registration.queryType === "association-graph") {
      return await this.#readAssociationGraph({
        registration,
        scopeDigest,
        limit,
        sortKey,
        authorization: verified,
      });
    }
    if (registration.queryType === "risk-overview") {
      return await this.#readRiskOverview({
        registration,
        scopeDigest,
        limit,
        sortKey,
        authorization: verified,
      });
    }
    if (registration.queryType !== "trace-chain") {
      return { kind: "failed", error: this.#blocked("read-page", "query-type-unsupported") };
    }
    return await this.#readTraceChain({
      registration,
      scopeDigest,
      limit,
      sortKey,
      authorization: verified,
    });
  }

  async #readRunView(input: {
    readonly registration: {
      readonly projectId: string;
      readonly queryResultId: string;
      readonly queryResultVersionId: string;
      readonly runId?: string | undefined;
    };
    readonly scopeDigest: string;
    readonly limit: number;
    readonly sortKey: string | undefined;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ProjectionResultReadResultV1> {
    const rootRunId = input.registration.runId as string;
    const ordered = await this.#runSummaries({
      projectId: input.registration.projectId,
      rootRunId,
      scopeDigest: input.scopeDigest,
      actorId: input.actorId,
      authorization: input.authorization,
    });
    const remaining = ordered.filter(
      (entry) => input.sortKey === undefined || entry.sortKey > input.sortKey,
    );
    const page = remaining.slice(0, input.limit);
    const nextCursor =
      remaining.length > page.length && page.length > 0
        ? encodeCursor({
            queryResultRef: {
              entityId: input.registration.queryResultId,
              versionId: input.registration.queryResultVersionId,
            },
            sortKey: (page[page.length - 1] as { readonly sortKey: string }).sortKey,
            scopeDigest: input.scopeDigest,
          })
        : undefined;
    return {
      kind: "page",
      queryType: "run-view",
      items: page.map((entry) => entry.item),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  /** 根运行与其直接子运行的版本化摘要；链路缺失的跳不生成占位项。 */
  async #runSummaries(input: {
    readonly projectId: string;
    readonly rootRunId: string;
    readonly scopeDigest: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<readonly { readonly sortKey: string; readonly item: ProjectionResultItemV1 }[]> {
    const runIds = await this.#runFamily(input);
    const summaries: { readonly sortKey: string; readonly item: ProjectionResultItemV1 }[] = [];
    for (const runId of runIds) {
      const rows = (
        await this.#store.listRunRows({
          projectId: input.projectId,
          runId,
          limit: MAX_SCAN_V1,
        })
      ).filter((row) => row.authorizationScopeDigest === input.scopeDigest);
      const entryRow = rows.find((row) => row.resultKind === "entry-snapshot");
      const state = await this.#latestRunState({
        projectId: input.projectId,
        rows,
        actorId: input.actorId,
        authorization: input.authorization,
      });
      if (entryRow === undefined || state === undefined) continue;
      summaries.push({
        sortKey: runId,
        item: {
          kind: "run-summary",
          workflowRunRef: {
            kind: "workflow-run",
            reference: { entityId: runId, versionId: state.runVersionId },
          },
          ...(state.parentRunRef === undefined ? {} : { parentRunRef: state.parentRunRef }),
          status: state.status,
          entryIdentity: entryRow.entryIdentity ?? {
            entityId: `workflow-entry:${input.projectId}:${state.entryMode}`,
            versionId: state.runVersionId,
          },
          ...(state.resultRef === undefined ? {} : { latestResultRef: state.resultRef }),
          auditTrailRef: auditTrailRefOf(entryRow.auditEntryId),
        },
      });
    }
    return summaries.sort((left, right) => (left.sortKey < right.sortKey ? -1 : 1));
  }

  async #runFamily(input: {
    readonly projectId: string;
    readonly rootRunId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<readonly string[]> {
    const rootRows = await this.#store.listRunRows({
      projectId: input.projectId,
      runId: input.rootRunId,
      limit: MAX_SCAN_V1,
    });
    const state = await this.#latestRunState({
      projectId: input.projectId,
      rows: rootRows,
      actorId: input.actorId,
      authorization: input.authorization,
    });
    const children = new Set<string>();
    if (state?.identificationRunRef !== undefined) {
      children.add(state.identificationRunRef.reference.entityId);
    }
    for (const runRef of state?.assessmentRunRefs ?? []) {
      children.add(runRef.reference.entityId);
    }
    return [input.rootRunId, ...[...children].sort()];
  }

  async #readTraceChain(input: {
    readonly registration: {
      readonly projectId: string;
      readonly queryResultId: string;
      readonly queryResultVersionId: string;
      readonly targetRef: ContractReferenceV1;
    };
    readonly scopeDigest: string;
    readonly limit: number;
    readonly sortKey: string | undefined;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ProjectionResultReadResultV1> {
    const links = await this.#linksForSubject({
      projectId: input.registration.projectId,
      subjectRef: input.registration.targetRef,
      scopeDigest: input.scopeDigest,
    });
    const keyed = links
      .map((link) => ({ key: `${link.recordedAt}/${link.linkId}`, link }))
      .sort((left, right) => (left.key < right.key ? -1 : 1));
    const remaining = keyed.filter(
      (entry) => input.sortKey === undefined || entry.key > input.sortKey,
    );
    const page = remaining.slice(0, input.limit);
    const evidence =
      this.#trace === undefined
        ? undefined
        : await this.#evidenceForSubject(input.registration.targetRef, input.authorization);
    if (evidence === "unprovable") {
      return { kind: "failed", error: this.#blocked("read-page", "trace-chain-incomplete") };
    }
    const items: ProjectionResultItemV1[] = page.map((entry) => ({
      kind: "trace-link",
      fromRef: entry.link.fromRef,
      toRef: entry.link.toRef,
      relation: entry.link.relation,
      ...(entry.link.stageResultRef === undefined
        ? {}
        : { stageResultRef: entry.link.stageResultRef }),
      auditTrailRef: auditTrailRefOf(entry.link.auditEntryId),
      ...(entry.link.evidenceLocator === undefined
        ? evidence === undefined
          ? {}
          : { evidenceLocator: { sourceSegmentId: evidence } }
        : { evidenceLocator: entry.link.evidenceLocator }),
    }));
    const nextCursor =
      remaining.length > page.length && page.length > 0
        ? encodeCursor({
            queryResultRef: {
              entityId: input.registration.queryResultId,
              versionId: input.registration.queryResultVersionId,
            },
            sortKey: (page[page.length - 1] as { readonly key: string }).key,
            scopeDigest: input.scopeDigest,
          })
        : undefined;
    return {
      kind: "page",
      queryType: "trace-chain",
      items,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  /**
   * 来源定位批量补齐（design D-02/D-03）：只对精确引用发起**一批** C22 `readBatch`；
   * 无权、缺失、越界或调用异常一律按“不可证明”收口，由调用方决定整页失败，不生成占位定位。
   */
  async #evidenceBatch(input: {
    readonly refs: readonly StandardizedRiskRecordRefV1[];
    readonly authorization: AuthorizationContextV1;
  }): Promise<ReadonlyMap<string, string | undefined> | "unprovable"> {
    const trace = this.#trace;
    if (input.refs.length === 0) return new Map();
    if (trace === undefined) return "unprovable";
    if (input.refs.length > MAX_EVIDENCE_REFS_V1) return "unprovable";
    let result: RiskRecordTraceReadResultV1;
    try {
      result = await trace.readBatch({
        projectId: input.authorization.projectId,
        riskRecordRefs: [...input.refs],
        requestedAt: this.#now().toISOString(),
        authorization: input.authorization,
      });
    } catch {
      return "unprovable";
    }
    if (result.kind === "failed") return "unprovable";
    const found = new Map<string, string | undefined>();
    for (const item of result.items) {
      if (item.kind !== "found") return "unprovable";
      found.set(
        `${item.riskRecordRef.reference.entityId}/${item.riskRecordRef.reference.versionId}`,
        item.evidenceLocator?.sourceSegmentId,
      );
    }
    return found.size === input.refs.length &&
      input.refs.every((ref) => found.has(`${ref.reference.entityId}/${ref.reference.versionId}`))
      ? found
      : "unprovable";
  }

  /**
   * 来源定位补齐（design D-06）：只对标准化风险记录主题发起一批 C22 `readBatch`；
   * 无权/不存在/越界一律按“不可证明”收口，不生成占位链尾。
   */
  async #evidenceForSubject(
    subjectRef: ContractReferenceV1,
    authorization: AuthorizationContextV1,
  ): Promise<string | undefined | "unprovable"> {
    if (subjectRef.kind !== "standardized-risk-record") return undefined;
    const evidence = await this.#evidenceBatch({ refs: [subjectRef], authorization });
    if (evidence === "unprovable") return "unprovable";
    return evidence.get(`${subjectRef.reference.entityId}/${subjectRef.reference.versionId}`);
  }

  /**
   * 关联图（design D-02）：主题相邻边确定可见运行，只沿已登记 `parent-child` 链边扩展关联运行，
   * 再按运行集合一次取边；运行数/边数越界显式失败，分页按 `(recorded_at, link_id)` 稳定续页。
   */
  async #readAssociationGraph(input: {
    readonly registration: {
      readonly projectId: string;
      readonly queryResultId: string;
      readonly queryResultVersionId: string;
      readonly targetRef: ContractReferenceV1;
      readonly recordedAt: string;
    };
    readonly scopeDigest: string;
    readonly limit: number;
    readonly sortKey: string | undefined;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ProjectionResultReadResultV1> {
    const seeded = await this.#linksForSubject({
      projectId: input.registration.projectId,
      subjectRef: input.registration.targetRef,
      scopeDigest: input.scopeDigest,
      recordedAtAtMost: input.registration.recordedAt,
      limit: MAX_GRAPH_LINKS_V1 + 1,
    });
    if (seeded.length > MAX_GRAPH_LINKS_V1) {
      return { kind: "failed", error: this.#blocked("read-page", "association-graph-overflow") };
    }
    if (seeded.length === 0) {
      // 主题在登记时点已无可证明的已成立边：与不存在同形，不用空图冒充结果。
      return { kind: "failed", error: this.#notFound("read-page") };
    }
    const runs = await this.#graphRunIds({
      projectId: input.registration.projectId,
      seeds: seeded.map((link) => link.runId),
      scopeDigest: input.scopeDigest,
      recordedAtAtMost: input.registration.recordedAt,
    });
    if (runs.kind === "overflow") {
      return { kind: "failed", error: this.#blocked("read-page", "association-graph-overflow") };
    }
    const links = await this.#graphLinks({
      projectId: input.registration.projectId,
      runIds: runs.value,
      scopeDigest: input.scopeDigest,
      recordedAtAtMost: input.registration.recordedAt,
    });
    if (links.kind === "overflow") {
      return { kind: "failed", error: this.#blocked("read-page", "association-graph-overflow") };
    }
    const keyed = links.value
      .map((link) => ({ key: `${link.recordedAt}/${link.linkId}`, link }))
      .sort((left, right) => (left.key < right.key ? -1 : 1));
    if (input.sortKey !== undefined && !keyed.some((entry) => entry.key === input.sortKey)) {
      return { kind: "failed", error: this.#blocked("read-page", "cursor-invalid") };
    }
    const remaining = keyed.filter(
      (entry) => input.sortKey === undefined || entry.key > input.sortKey,
    );
    const page = remaining.slice(0, Math.min(input.limit, MAX_GRAPH_PAGE_SIZE_V1));
    // 每页按风险记录精确引用复验来源；登记时留下的定位不替代当前来源资格。
    const needed = new Map<string, StandardizedRiskRecordRefV1>();
    for (const entry of page) {
      for (const ref of [entry.link.fromRef, entry.link.toRef]) {
        if (ref.kind !== "standardized-risk-record") continue;
        needed.set(`${ref.reference.entityId}/${ref.reference.versionId}`, ref);
      }
    }
    const evidence = await this.#evidenceBatch({
      refs: [...needed.values()],
      authorization: input.authorization,
    });
    if (evidence === "unprovable") {
      return { kind: "failed", error: this.#blocked("read-page", "association-graph-incomplete") };
    }
    const items: ProjectionResultItemV1[] = page.map((entry) => {
      const link = entry.link;
      const riskRef = [link.fromRef, link.toRef].find(
        (ref): ref is StandardizedRiskRecordRefV1 => ref.kind === "standardized-risk-record",
      );
      const segment =
        riskRef === undefined
          ? undefined
          : evidence.get(`${riskRef.reference.entityId}/${riskRef.reference.versionId}`);
      const locator =
        riskRef === undefined
          ? link.evidenceLocator
          : segment === undefined
            ? undefined
            : { sourceSegmentId: segment };
      return {
        kind: "trace-link",
        fromRef: link.fromRef,
        toRef: link.toRef,
        relation: link.relation,
        ...(link.stageResultRef === undefined ? {} : { stageResultRef: link.stageResultRef }),
        auditTrailRef: auditTrailRefOf(link.auditEntryId),
        ...(locator === undefined ? {} : { evidenceLocator: locator }),
      };
    });
    const last = page[page.length - 1];
    const nextCursor =
      last === undefined || remaining.length <= page.length
        ? undefined
        : encodeCursor({
            queryResultRef: {
              entityId: input.registration.queryResultId,
              versionId: input.registration.queryResultVersionId,
            },
            sortKey: last.key,
            scopeDigest: input.scopeDigest,
          });
    return {
      kind: "page",
      queryType: "association-graph",
      items,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  /** 关联运行扩展（design D-02）：只沿已登记 `parent-child` 边扩展，运行数越界不裁图。 */
  async #graphRunIds(input: {
    readonly projectId: string;
    readonly seeds: readonly string[];
    readonly scopeDigest: string;
    readonly recordedAtAtMost: string;
  }): Promise<ProjectionBoundedReadV1<readonly string[]>> {
    const known = new Set(input.seeds);
    if (known.size > MAX_GRAPH_RUNS_V1) return { kind: "overflow" };
    let frontier = [...known];
    while (frontier.length > 0) {
      // 父运行与子运行都可能不在同一行 `run_id` 下，因此按两端精确引用任一命中即视为已证明的相邻运行。
      const frontierRuns = sql.join(
        frontier.map((runId) => sql`${runId}`),
        sql`, `,
      );
      const frontierRefs = sql.join(
        frontier.map(
          (runId) =>
            sql`(from_ref @> ${JSON.stringify({
              kind: "workflow-run",
              reference: { entityId: runId },
            })}::jsonb OR to_ref @> ${JSON.stringify({
              kind: "workflow-run",
              reference: { entityId: runId },
            })}::jsonb)`,
        ),
        sql` OR `,
      );
      const rows = await this.#db
        .selectFrom(LINKS_TABLE)
        .select(["run_id", "from_ref", "to_ref"])
        .where("project_id", "=", input.projectId)
        .where("authorization_scope_digest", "=", input.scopeDigest)
        .where("relation", "=", "parent-child")
        .where("recorded_at", "<=", input.recordedAtAtMost)
        .where(sql<SqlBool>`(run_id IN (${frontierRuns}) OR ${frontierRefs})`)
        .orderBy("recorded_at", "asc")
        .orderBy("link_id", "asc")
        .limit(MAX_GRAPH_LINKS_V1 + 1)
        .execute();
      if (rows.length > MAX_GRAPH_LINKS_V1) return { kind: "overflow" };
      const discovered: string[] = [];
      for (const row of rows) {
        for (const candidate of [row.from_ref, row.to_ref]) {
          const ref = ContractReferenceV1Schema.safeParse(candidate);
          if (!ref.success || ref.data.kind !== "workflow-run") continue;
          const runId = ref.data.reference.entityId;
          if (known.has(runId)) continue;
          known.add(runId);
          discovered.push(runId);
        }
      }
      if (known.size > MAX_GRAPH_RUNS_V1) return { kind: "overflow" };
      frontier = discovered;
    }
    return { kind: "ok", value: [...known].sort() };
  }

  /** 图边集合（design D-02）：按运行集合一次批量取边，不按单边往返；超过上限显式失败。 */
  async #graphLinks(input: {
    readonly projectId: string;
    readonly runIds: readonly string[];
    readonly scopeDigest: string;
    readonly recordedAtAtMost: string;
  }): Promise<ProjectionBoundedReadV1<readonly WorkflowGraphLinkV1[]>> {
    if (input.runIds.length === 0) return { kind: "ok", value: [] };
    const rows = await this.#db
      .selectFrom(LINKS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("authorization_scope_digest", "=", input.scopeDigest)
      .where("recorded_at", "<=", input.recordedAtAtMost)
      .where("run_id", "in", [...input.runIds])
      .orderBy("recorded_at", "asc")
      .orderBy("link_id", "asc")
      .limit(MAX_GRAPH_LINKS_V1 + 1)
      .execute();
    if (rows.length > MAX_GRAPH_LINKS_V1) return { kind: "overflow" };
    return { kind: "ok", value: rows.map((row) => workflowGraphLinkFromDb(row)) };
  }

  /**
   * 工程风险总览/报告（design D-03）：按登记的精确修订与可选空间选出候选运行，每页最多展开一个运行，
   * 最多回读该运行的一份状态正文与一份结果正文；事实与缺席项只来自已成立的引用。
   */
  async #readRiskOverview(input: {
    readonly registration: {
      readonly projectId: string;
      readonly queryResultId: string;
      readonly queryResultVersionId: string;
      readonly targetRef: ContractReferenceV1;
      readonly spatialScopeRef?: SpatialScopeRefV1 | undefined;
      readonly recordedAt: string;
    };
    readonly scopeDigest: string;
    readonly limit: number;
    readonly sortKey: string | undefined;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ProjectionResultReadResultV1> {
    const scope: ProjectionReportScopeV1 = {
      projectId: input.registration.projectId,
      revisionRef: input.registration.targetRef,
      ...(input.registration.spatialScopeRef === undefined
        ? {}
        : { spatialScopeRef: input.registration.spatialScopeRef }),
      scopeDigest: input.scopeDigest,
      recordedAtAtMost: input.registration.recordedAt,
    };
    const cursor = input.sortKey === undefined ? undefined : decodeReportSortKey(input.sortKey);
    if (input.sortKey !== undefined && cursor === undefined) {
      return { kind: "failed", error: this.#blocked("read-page", "cursor-invalid") };
    }
    if (
      cursor !== undefined &&
      (await this.#overviewRunId({ ...scope, atRunId: cursor.runId })) !== cursor.runId
    ) {
      return { kind: "failed", error: this.#blocked("read-page", "cursor-invalid") };
    }
    const runId = cursor?.runId ?? (await this.#overviewRunId({ ...scope, afterRunId: "" }));
    if (runId === undefined) {
      // 登记时点下没有可读运行的已成立事实：返回真正的空页，不生成占位运行。
      return { kind: "page", queryType: "risk-overview", items: [] };
    }
    const expanded = await this.#reportRunEntries({
      ...scope,
      runId,
      actorId: input.authorization.actorId,
      authorization: input.authorization,
    });
    if (expanded.kind === "failed") return { kind: "failed", error: expanded.error };
    if (
      cursor !== undefined &&
      cursor.itemKey !== "" &&
      !expanded.entries.some((entry) => entry.key === cursor.itemKey)
    ) {
      return { kind: "failed", error: this.#blocked("read-page", "cursor-invalid") };
    }
    const remaining = expanded.entries.filter(
      (entry) => entry.key > (cursor?.runId === runId ? cursor.itemKey : ""),
    );
    const page = remaining.slice(0, Math.min(input.limit, MAX_PAGE_SIZE_V1));
    const nextRunId = await this.#overviewRunId({ ...scope, afterRunId: runId });
    const nextCursor = (sortKey: string): string =>
      encodeCursor({
        queryResultRef: {
          entityId: input.registration.queryResultId,
          versionId: input.registration.queryResultVersionId,
        },
        sortKey,
        scopeDigest: input.scopeDigest,
      });
    const last = page[page.length - 1];
    if (last === undefined) {
      // 游标所指运行已读完：下一页从下一个运行继续，不在本页展开第二个运行（design D-03）。
      return nextRunId === undefined
        ? { kind: "page", queryType: "risk-overview", items: [] }
        : {
            kind: "page",
            queryType: "risk-overview",
            items: [],
            nextCursor: nextCursor(encodeReportSortKey({ runId: nextRunId, itemKey: "" })),
          };
    }
    // 报告只对标准化风险记录的来源定位发起一批精确 C22 窄读；不可证明即整页失败，不披露半份报告。
    const needed = new Map<string, StandardizedRiskRecordRefV1>();
    for (const entry of page) {
      if (entry.item.kind !== "report-fact") continue;
      const factRef = entry.item.factRef;
      if (factRef.kind !== "standardized-risk-record") continue;
      needed.set(`${factRef.reference.entityId}/${factRef.reference.versionId}`, factRef);
    }
    const evidence = await this.#evidenceBatch({
      refs: [...needed.values()],
      authorization: input.authorization,
    });
    if (evidence === "unprovable") {
      return { kind: "failed", error: this.#blocked("read-page", "risk-overview-incomplete") };
    }
    const items: ProjectionResultItemV1[] = page.map((entry) => {
      if (entry.item.kind !== "report-fact") return entry.item;
      const factRef = entry.item.factRef;
      if (factRef.kind !== "standardized-risk-record") return entry.item;
      const segment = evidence.get(`${factRef.reference.entityId}/${factRef.reference.versionId}`);
      return segment === undefined
        ? entry.item
        : { ...entry.item, evidenceLocator: { sourceSegmentId: segment } };
    });
    const cursorSortKey =
      remaining.length > page.length
        ? encodeReportSortKey({ runId, itemKey: last.key })
        : nextRunId === undefined
          ? undefined
          : encodeReportSortKey({ runId: nextRunId, itemKey: "" });
    return {
      kind: "page",
      queryType: "risk-overview",
      items,
      ...(cursorSortKey === undefined ? {} : { nextCursor: nextCursor(cursorSortKey) }),
    };
  }

  /**
   * 报告运行选择（design D-03/D-05）：在 C30 自有 `entry-snapshot` 行上以 `project_id`、精确冻结引用、
   * 授权摘要与登记时点作数据库谓词，并要求该运行已有可读状态正文登记；不逐个 `runId` 试探或全工程扫描。
   */
  async #overviewRunId(
    input: ProjectionReportScopeV1 &
      ({ readonly afterRunId: string } | { readonly atRunId: string }),
  ): Promise<string | undefined> {
    const frozen = JSON.stringify([
      input.revisionRef,
      ...(input.spatialScopeRef === undefined ? [] : [input.spatialScopeRef]),
    ]);
    const base = this.#db
      .selectFrom(RESULTS_TABLE)
      .select("run_id")
      .distinct()
      .where("project_id", "=", input.projectId)
      .where("result_kind", "=", "entry-snapshot")
      .where("authorization_scope_digest", "=", input.scopeDigest)
      .where("recorded_at", "<=", input.recordedAtAtMost)
      .where(sql<SqlBool>`frozen_refs @> ${frozen}::jsonb`)
      .where(
        sql<SqlBool>`EXISTS (
        SELECT 1 FROM ${sql.raw(RESULTS_TABLE)} AS state
        WHERE state.project_id = ${sql.raw(RESULTS_TABLE)}.project_id
          AND state.run_id = ${sql.raw(RESULTS_TABLE)}.run_id
          AND state.result_kind = 'run-state'
          AND state.artifact_ref IS NOT NULL
          AND state.recorded_at <= ${input.recordedAtAtMost}
      )`,
      );
    const scoped =
      "atRunId" in input
        ? base.where("run_id", "=", input.atRunId)
        : base.where("run_id", ">", input.afterRunId);
    const rows = await scoped.orderBy("run_id", "asc").limit(1).execute();
    return rows[0]?.run_id;
  }

  /**
   * 单个运行的报告项（design D-03）：运行摘要来自入口行与最新状态正文；事实取状态与结果正文里已成立的
   * 精确引用；缺席项只读结果正文登记的 `skippedTails`。单运行展开越界显式失败，不裁半份报告。
   */
  async #reportRunEntries(
    input: ProjectionReportScopeV1 & {
      readonly runId: string;
      readonly actorId: string;
      readonly authorization: AuthorizationContextV1;
    },
  ): Promise<
    | { readonly kind: "ok"; readonly entries: readonly ProjectionReportEntryV1[] }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const frozen = JSON.stringify([
      input.revisionRef,
      ...(input.spatialScopeRef === undefined ? [] : [input.spatialScopeRef]),
    ]);
    const rowParams = {
      projectId: input.projectId,
      runId: input.runId,
      scopeDigest: input.scopeDigest,
      recordedAtAtMost: input.recordedAtAtMost,
    };
    const entryRow = await this.#selectResultRow({
      ...rowParams,
      resultKind: "entry-snapshot",
      frozenRefsJson: frozen,
      artifactRequired: false,
      newestFirst: false,
    });
    const stateRow = await this.#selectResultRow({
      ...rowParams,
      resultKind: "run-state",
      artifactRequired: true,
      newestFirst: true,
    });
    const resultRow = await this.#selectResultRow({
      ...rowParams,
      resultKind: "run-result",
      artifactRequired: true,
      newestFirst: true,
    });
    if (
      entryRow === undefined ||
      stateRow === undefined ||
      stateRow.resultKind !== "run-state" ||
      stateRow.artifactRef === undefined
    ) {
      return { kind: "failed", error: this.#blocked("read-page", "risk-overview-incomplete") };
    }
    const incomplete = {
      kind: "failed" as const,
      error: this.#blocked("read-page", "risk-overview-incomplete"),
    };
    const stateBody = await this.#readReportBody({
      projectId: input.projectId,
      artifactRef: stateRow.artifactRef,
      actorId: input.actorId,
      authorization: input.authorization,
    });
    if (stateBody === undefined || stateBody.bodyKind !== "run-state") return incomplete;
    const state = stateBody.runState;
    if (
      state.projectId !== input.projectId ||
      state.runId !== input.runId ||
      state.runVersionId !== stateRow.runVersionId
    ) {
      return incomplete;
    }
    let result: WorkflowGraphRunResultV1 | undefined;
    if (resultRow !== undefined) {
      if (resultRow.artifactRef === undefined) return incomplete;
      const resultBody = await this.#readReportBody({
        projectId: input.projectId,
        artifactRef: resultRow.artifactRef,
        actorId: input.actorId,
        authorization: input.authorization,
      });
      if (resultBody === undefined || resultBody.bodyKind !== "run-result") return incomplete;
      result = resultBody.runResult;
      if (
        result.projectId !== input.projectId ||
        result.runRef.reference.entityId !== input.runId
      ) {
        return incomplete;
      }
    }
    const factSources: readonly (readonly [readonly ProjectionReportFactRefV1[], string])[] = [
      [state.acceptedRiskRecordRefs, stateRow.auditEntryId],
      [state.assessmentRecordRefs, stateRow.auditEntryId],
      [state.warningRecordRefs, stateRow.auditEntryId],
      [state.responseRecommendationRefs, stateRow.auditEntryId],
      [state.deviationRecordRefs, stateRow.auditEntryId],
      [state.calibrationSuggestionRefs, stateRow.auditEntryId],
      ...(result === undefined || resultRow === undefined
        ? []
        : ([
            [result.assessmentRecordRefs, resultRow.auditEntryId],
            [result.warningRecordRefs, resultRow.auditEntryId],
            [result.responseRecommendationRefs, resultRow.auditEntryId],
            [result.deviationRecordRefs, resultRow.auditEntryId],
            [result.calibrationSuggestionRefs, resultRow.auditEntryId],
          ] as const)),
    ];
    const facts = new Map<string, { factRef: ProjectionReportFactRefV1; auditEntryId: string }>();
    for (const [refs, auditEntryId] of factSources) {
      for (const factRef of refs) {
        const identity = `${factRef.kind}|${factRef.reference.entityId}/${factRef.reference.versionId}`;
        if (!facts.has(identity)) facts.set(identity, { factRef, auditEntryId });
      }
    }
    const absences = result?.skippedTails ?? [];
    if (facts.size + absences.length > MAX_REPORT_ITEMS_PER_RUN_V1) {
      return { kind: "failed", error: this.#blocked("read-page", "risk-overview-overflow") };
    }
    const runRef = {
      kind: "workflow-run" as const,
      reference: { entityId: input.runId, versionId: state.runVersionId },
    };
    const absenceAuditEntryId = resultRow?.auditEntryId ?? stateRow.auditEntryId;
    const entries: ProjectionReportEntryV1[] = [
      {
        key: REPORT_SUMMARY_KEY_V1,
        item: {
          kind: "run-summary",
          workflowRunRef: runRef,
          ...(state.parentRunRef === undefined ? {} : { parentRunRef: state.parentRunRef }),
          status: state.status,
          entryIdentity: entryRow.entryIdentity ?? {
            entityId: `workflow-entry:${input.projectId}:${state.entryMode}`,
            versionId: state.runVersionId,
          },
          ...(state.resultRef === undefined ? {} : { latestResultRef: state.resultRef }),
          auditTrailRef: auditTrailRefOf(stateRow.auditEntryId),
        },
      },
      ...[...facts.entries()]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([, fact]) => ({
          key: `${REPORT_FACT_RANK_V1}|${fact.factRef.kind}/${fact.factRef.reference.entityId}/${fact.factRef.reference.versionId}`,
          item: {
            kind: "report-fact" as const,
            workflowRunRef: runRef,
            factRef: fact.factRef,
            auditTrailRef: auditTrailRefOf(fact.auditEntryId),
          },
        })),
      ...absences
        .map((absence) => {
          const lastRef = absence.lastEstablishedRef;
          const lastRefKey =
            lastRef === undefined || !("reference" in lastRef)
              ? ""
              : `${lastRef.reference.entityId}/${lastRef.reference.versionId}`;
          return {
            key: `${REPORT_ABSENCE_RANK_V1}|${absence.tailKind}/${absence.reasonCode}/${lastRefKey}`,
            item: {
              kind: "report-absence" as const,
              workflowRunRef: runRef,
              tailKind: absence.tailKind,
              reasonCode: absence.reasonCode,
              ...(absence.lastEstablishedRef === undefined
                ? {}
                : { lastEstablishedRef: absence.lastEstablishedRef }),
              auditTrailRef: auditTrailRefOf(absenceAuditEntryId),
            },
          };
        })
        .sort((left, right) => (left.key < right.key ? -1 : 1)),
    ];
    return { kind: "ok", entries };
  }

  /**
   * 单个运行的精确结果行（design D-03）：登记时点、授权摘要与入口行的冻结引用都作为数据库谓词，
   * 只回读已提交事实，不从最新版本推测；`LIMIT 1` 保证每次只取一行。
   */
  async #selectResultRow(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly resultKind: WorkflowGraphResultRowV1["resultKind"];
    readonly scopeDigest: string;
    readonly recordedAtAtMost: string;
    readonly frozenRefsJson?: string | undefined;
    readonly artifactRequired: boolean;
    readonly newestFirst: boolean;
  }): Promise<WorkflowGraphResultRowV1 | undefined> {
    const base = this.#db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runId)
      .where("result_kind", "=", input.resultKind)
      .where("authorization_scope_digest", "=", input.scopeDigest)
      .where("recorded_at", "<=", input.recordedAtAtMost);
    const frozen =
      input.frozenRefsJson === undefined
        ? base
        : base.where(sql<SqlBool>`frozen_refs @> ${input.frozenRefsJson}::jsonb`);
    const scoped = input.artifactRequired ? frozen.where("artifact_ref", "is not", null) : frozen;
    const ordered = input.newestFirst
      ? scoped.orderBy("persisted_at", "desc").orderBy("result_version_id", "desc")
      : scoped.orderBy("persisted_at", "asc").orderBy("result_version_id", "asc");
    const row = await ordered.limit(1).executeTakeFirst();
    return row === undefined ? undefined : workflowGraphResultRowFromDb(row);
  }

  /** 报告正文回读（design D-03）：只按精确 `artifactRef` 读该运行的状态/结果正文，不可读即不可重建。 */
  async #readReportBody(input: {
    readonly projectId: string;
    readonly artifactRef: ContentArtifactRefV1;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WorkflowGraphArtifactBodyV1 | undefined> {
    try {
      return await this.#bodies.readBody({
        projectId: input.projectId,
        artifactRef: input.artifactRef,
        actorId: input.actorId,
        requestedAt: this.#now().toISOString(),
        authorization: input.authorization,
      });
    } catch {
      return undefined;
    }
  }

  /** 最新运行状态：只取已登记行与其 C04 正文；正文不可读即视为不可重建，不猜测。 */
  async #latestRunState(input: {
    readonly projectId: string;
    readonly rows: readonly WorkflowGraphResultRowV1[];
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WorkflowGraphRunStateV1 | undefined> {
    const states = input.rows.filter((row) => row.resultKind === "run-state");
    const latest = states[states.length - 1];
    if (latest?.artifactRef === undefined) return undefined;
    const body = await this.#bodies.readBody({
      projectId: input.projectId,
      artifactRef: latest.artifactRef,
      actorId: input.actorId,
      requestedAt: this.#now().toISOString(),
      authorization: input.authorization,
    });
    return body !== undefined && body.bodyKind === "run-state" ? body.runState : undefined;
  }
}

export const createPostgresWorkflowProjection = (
  options: PostgresWorkflowProjectionOptionsV1,
): PostgresWorkflowProjectionV1 => {
  const projection = new WorkflowGraphProjection(options);
  return {
    queryProjection: {
      query: (request) => projection.query(request),
      subscribe: (request) => projection.subscribe(request),
      export: (request) => projection.export(request),
    },
    resultRead: {
      readPage: (request) => projection.readPage(request),
    },
  };
};
