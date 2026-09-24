/**
 * C30 有界运行/追踪投影（design D-06）。
 *
 * `ProjectionPortV1.query` 只登记精确目标、权限快照与记录时点；`ProjectionResultReadPortV1.readPage`
 * 每页重验授权，从 C30 自有运行/链边事实分页，最多一批 C22 `readBatch` 补齐来源定位。
 * 不可由已成立事实证明的链边不生成占位链尾；无权与不存在对调用方同形。
 */
import type { Kysely } from "kysely";

import type {
  AuthorizationContextV1,
  ContractReferenceV1,
  ModuleErrorV1,
  ModuleBranchV1,
  ModuleCapabilityV1,
  ProjectionExportRequestV1,
  ProjectionExportResultV1,
  ProjectionPortV1,
  ProjectionQueryV1,
  ProjectionResultItemV1,
  ProjectionResultReadPortV1,
  ProjectionResultReadRequestV1,
  ProjectionResultReadResultV1,
  ProjectionSubscriptionResultV1,
  RiskRecordTraceReadPortV1,
  RunSubscriptionRequestV1,
} from "@riskflow/contracts/ports";
import {
  ProjectionQueryV1Schema,
  ProjectionResultReadRequestV1Schema,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { sha256CanonicalJson, type JsonValue } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  WorkflowGraphLinkV1Schema,
  type WorkflowGraphBodyPortV1,
  type WorkflowGraphLinkV1,
  type WorkflowGraphRegistrationStoreV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunStateV1,
} from "@riskflow/core/workflow";

import type { PostgresDatabase } from "../postgres/types.js";

const LINKS_TABLE = "business.workflow_graph_links";
const MAX_PAGE_SIZE_V1 = 100;
const MAX_SCAN_V1 = 200;

interface WorkflowGraphLinkDbRow {
  project_id: string;
  link_id: string;
  run_id: string;
  from_ref: JsonValue;
  to_ref: JsonValue;
  relation: string;
  source_stage: string;
  stage_result_ref: JsonValue | null;
  evidence_locator: JsonValue | null;
  authorization_context_ref: JsonValue;
  authorization_scope_digest: string;
  actor_ref: string;
  recorded_at: Date | string;
  audit_entry_id: string;
}

interface WorkflowGraphProjectionDatabaseV1 {
  "business.workflow_graph_links": WorkflowGraphLinkDbRow;
}

type ProjectionDatabaseV1 = PostgresDatabase & WorkflowGraphProjectionDatabaseV1;
type ProjectionQueryExecutorV1 = Kysely<ProjectionDatabaseV1>;

const BRANCH_BY_CAPABILITY_V1: Partial<Record<ModuleCapabilityV1, ModuleBranchV1>> = {
  "projection.query": "projection.query",
  "workflow.start": "workflow.start-run",
  "workflow.resume": "workflow.resume-run",
  "workflow.cancel": "workflow.cancel-run",
};

const isoOf = (value: Date | string): string =>
  typeof value === "string" ? new Date(value).toISOString() : value.toISOString();

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

export interface PostgresWorkflowProjectionOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & WorkflowGraphProjectionDatabaseV1>`。 */
  readonly db: unknown;
  /** C30 自有登记面：查询登记经同一端口写入，避免出现第二条登记路径。 */
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  /** C04 正文端口：运行汇总只读状态正文，不复制领域事实。 */
  readonly bodies: WorkflowGraphBodyPortV1;
  /** C05 当前授权复验端口：每次受保护读写前按当前 actor/工程/空间/资料范围复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  /** C22 公开批读（可选注入）：每页最多一批补齐来源定位，缺失时不产出该段定位。 */
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
        requestedSpatialScopeRefs: [],
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
    const verified = await this.#verify({
      authorization: parsed.data.authorization,
      projectId: parsed.data.projectId,
      actorId: parsed.data.actorId,
      invocationId: `c30-query:${parsed.data.projectId}:${parsed.data.queryId}`,
      requestedAt: parsed.data.requestedAt,
    });
    if (verified === undefined) {
      return { kind: "failed", error: this.#notFound("projection-query") };
    }
    const payload = parsed.data.payload;
    if (payload.queryType !== "run-view" && payload.queryType !== "trace-chain") {
      // C31/C34 的图谱与页面分支不属于本 change：显式失败，不用空投影冒充结果。
      return { kind: "failed", error: this.#blocked("projection-query", "query-type-unsupported") };
    }
    const targetRef: ContractReferenceV1 =
      payload.queryType === "run-view"
        ? { kind: "workflow-run", reference: payload.workflowRunRef.reference }
        : payload.subjectRef;
    const scopeDigest = authorizationScopeDigest(verified);
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
    const queryResultId = `query-result:${parsed.data.projectId}:${parsed.data.queryId}`;
    const queryResultVersionId = sha256CanonicalJson({
      queryType: payload.queryType,
      targetRef,
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
        ...(visible.runId === undefined ? {} : { runId: visible.runId }),
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

  async #linksForSubject(input: {
    readonly projectId: string;
    readonly subjectRef: ContractReferenceV1;
    readonly scopeDigest: string;
  }): Promise<readonly WorkflowGraphLinkV1[]> {
    if (input.subjectRef.kind === "domain-event") return [];
    const subjectJson = JSON.stringify(input.subjectRef) as unknown as JsonValue;
    const rows = await this.#db
      .selectFrom(LINKS_TABLE)
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where((expression) =>
        expression.or([
          expression("from_ref", "=", subjectJson),
          expression("to_ref", "=", subjectJson),
        ]),
      )
      .orderBy("recorded_at", "asc")
      .orderBy("link_id", "asc")
      .limit(MAX_SCAN_V1)
      .execute();
    return rows
      .filter((row) => row.authorization_scope_digest === input.scopeDigest)
      .map((row) =>
        WorkflowGraphLinkV1Schema.parse({
          schemaVersion: "1",
          projectId: row.project_id,
          linkId: row.link_id,
          runId: row.run_id,
          fromRef: row.from_ref,
          toRef: row.to_ref,
          relation: row.relation,
          sourceStage: row.source_stage,
          ...(row.stage_result_ref === null ? {} : { stageResultRef: row.stage_result_ref }),
          ...(row.evidence_locator === null ? {} : { evidenceLocator: row.evidence_locator }),
          authorizationContextRef: row.authorization_context_ref,
          authorizationScopeDigest: row.authorization_scope_digest,
          actorRef: row.actor_ref,
          recordedAt: isoOf(row.recorded_at),
          auditEntryId: row.audit_entry_id,
        }),
      );
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
    const evidence = await this.#evidenceForSubject(
      input.registration.targetRef,
      input.authorization,
    );
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
   * 来源定位补齐（design D-06）：只对标准化风险记录主题发起**一批** C22 `readBatch`；
   * 无权/不存在/越界一律按“不可证明”收口，不生成占位链尾。
   */
  async #evidenceForSubject(
    subjectRef: ContractReferenceV1,
    authorization: AuthorizationContextV1,
  ): Promise<string | undefined | "unprovable"> {
    if (this.#trace === undefined || subjectRef.kind !== "standardized-risk-record") {
      return undefined;
    }
    const result = await this.#trace.readBatch({
      projectId: authorization.projectId,
      riskRecordRefs: [subjectRef],
      requestedAt: this.#now().toISOString(),
      authorization,
    });
    if (result.kind === "failed") return "unprovable";
    const item = result.items[0];
    if (item === undefined || item.kind !== "found") return "unprovable";
    return item.sourceSegmentIds[0];
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
