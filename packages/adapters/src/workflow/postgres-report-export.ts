/**
 * C35 报告导出与安全读取适配器（IP-05，design D-08/D-09）。
 *
 * 范围完全由 C31 精确登记的 `queryResultRef` 固定：格式、章节与三项资源上限只取自部署组合根
 * 显式注入的不可变导出策略，缺省空集合即「没有导出能力」，不提供任意时间窗、PDF 或自由参数。
 * 分页复用同一所属 projection 的 `readPage`，报告正文是独立的 `riskflow-report` 内容正文，
 * 不扩展运行状态/结果正文联合，也不重读领域正文或重算分值。
 *
 * 耐久边界是两个显式事务：绑定事务只登记 `requested` 审计与同一 `projection.export` 收据，
 * 绑定成功不等于导出成功；真实内容经 C04 耐久化后，尾事务在同一事务内写 completed 收据与
 * `generated` 审计并产出 `ExportArtifactRefV1`。两段都按原 `queryId` 幂等，重试复用同一身份，
 * 全程不发 Outbox 事件、不改任何领域事实。
 */
import { sql, type Kysely, type SqlBool } from "kysely";

import type {
  AuthorizationContextV1,
  ContentArtifactRefV1,
  ExportArtifactRefV1,
  ModuleBranchV1,
  ModuleErrorV1,
  ProjectionExportRequestV1,
  ProjectionExportResultV1,
  ProjectionResultItemV1,
  ProjectionResultReadPortV1,
  QueryResultRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  ExportArtifactRefV1Schema,
  ProjectionExportRequestV1Schema,
  QueryResultRefV1Schema,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import { ArtifactPutCommandV1Schema, ArtifactReadRequestV1Schema } from "@riskflow/core/artifacts";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import type { RegisteredResourceAuthorizerV1 } from "../auth/deployment-authorization.js";
import {
  REPORT_EXPORT_PAGE_SIZE_DEFAULT_V1,
  ReportArtifactBodyV1Schema,
  ProjectionReportReadQueryV1Schema,
  ReportExportPolicyV1Schema,
  ReportExportScopeV1Schema,
  type ProjectionReportReadPortV1,
  type ProjectionReportReadQueryV1,
  type ProjectionReportReadResultV1,
  type ReportArtifactBodyV1,
  type ReportExportPolicyV1,
  type ReportExportScopeV1,
} from "@riskflow/core/workflow";
import type { WorkflowGraphRegistrationStoreV1 } from "@riskflow/core/workflow";

import type { PostgresDatabase } from "../postgres/types.js";

type ReportExportSectionV1 = ReportExportPolicyV1["sections"][number];
type ReportExportQueryTypeV1 = ReportExportPolicyV1["queryTypes"][number];

/** 绑定事务与尾事务共用原 `queryId`，只以 commandKind 区分（design D-09）。 */
const EXPORT_BIND_COMMAND_KIND_V1 = "projection.export";
const EXPORT_COMPLETE_COMMAND_KIND_V1 = "projection.export.completed";
const EXPORT_REQUESTED_ACTION_V1 = "projection.export.requested";
const EXPORT_GENERATED_ACTION_V1 = "projection.export.generated";
const REPORT_PURPOSE_CODE_V1 = "riskflow-report";
const REPORT_MEDIA_TYPE_V1 = "application/json";
const EXPORT_CAPABILITY_V1 = "projection.export";
/** `readPage` 单页上限；导出按剩余条目预算再收窄。 */
const PROJECTION_PAGE_LIMIT_V1 = 100;
/** 工件正文读取的硬上限：策略 `maxBytes` 上限本身即 8MiB。 */
const MAX_REPORT_BODY_BYTES_V1 = 8 * 1024 * 1024;
const HISTORY_PAGE_SIZE_MAX_V1 = 50;
const HISTORY_PAGE_SIZE_DEFAULT_V1 = 25;

const referenceKey = (value: {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}): string => `${value.reference.entityId}/${value.reference.versionId}`;

/** 条目族即策略可选章节；链边项不属于报告章节，任何策略都不会导出它。 */
const sectionOfItem = (item: ProjectionResultItemV1): ReportExportSectionV1 | undefined =>
  item.kind === "trace-link" ? undefined : item.kind;

const asIsoDateTime = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * 稳定报告身份（design D-09）：只由工程、调用者、查询身份、来源引用与策略引用派生，
 * 不含当前授权签名或重试时间，因此同源同策略的重试永远命中同一工件与同一审计引用。
 */
const reportIdentityV1 = (input: {
  readonly projectId: string;
  readonly actorId: string;
  readonly queryId: string;
  readonly sourceRef: QueryResultRefV1;
  readonly exportPolicyRef: VersionReference;
}): string =>
  sha256CanonicalJson({
    projectId: input.projectId,
    actorId: input.actorId,
    queryId: input.queryId,
    sourceRef: input.sourceRef,
    exportPolicyRef: input.exportPolicyRef,
  });

export interface PostgresReportExportOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase>`。 */
  readonly db: unknown;
  readonly transactionUnit: TransactionUnitV1;
  readonly artifactStore: ArtifactStoreV1;
  /** C30 自有查询登记面：导出范围只按已登记查询结果解析。 */
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  /** 同一所属 C31 projection 的读取端口：预览、生成与范围复验都只经它分页。 */
  readonly resultRead: ProjectionResultReadPortV1;
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly authorizeResource: RegisteredResourceAuthorizerV1;
  /** 部署组合根显式注入的不可变导出策略；缺省空集合＝无导出能力。 */
  readonly exportPolicies?: readonly unknown[];
  readonly now?: () => Date;
}

export interface PostgresReportExportV1 {
  readonly reportRead: ProjectionReportReadPortV1;
  /** `projection.export` 的报告用途实现；由所属 projection 的 `export` 显式委托。 */
  readonly exportReport: (request: ProjectionExportRequestV1) => Promise<ProjectionExportResultV1>;
}

type ReportExecutorV1 = Kysely<PostgresDatabase>;

class ReportExportService {
  readonly #db: ReportExecutorV1;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #store: WorkflowGraphRegistrationStoreV1;
  readonly #resultRead: ProjectionResultReadPortV1;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #authorizeResource: RegisteredResourceAuthorizerV1;
  readonly #policies: readonly ReportExportPolicyV1[];
  readonly #now: () => Date;

  constructor(options: PostgresReportExportOptionsV1) {
    this.#db = options.db as unknown as ReportExecutorV1;
    this.#transactionUnit = options.transactionUnit;
    this.#artifactStore = options.artifactStore;
    this.#store = options.registrationStore;
    this.#resultRead = options.resultRead;
    this.#authorization = options.authorization;
    this.#authorizeResource = options.authorizeResource;
    this.#policies = (options.exportPolicies ?? []).flatMap((policy) => {
      const parsed = ReportExportPolicyV1Schema.safeParse(policy);
      return parsed.success ? [parsed.data] : [];
    });
    this.#now = options.now ?? (() => new Date());
  }

  #blocked(stageCode: string, blockerKind: string): ModuleErrorV1 {
    return {
      code: "BUSINESS_BLOCKED",
      category: "business-blocked",
      retryable: false,
      stageCode,
      occurredAt: this.#now().toISOString(),
      causalRunId: "c35-report-export",
      blockerKind,
      blockerRef: {
        kind: "query-result",
        reference: { entityId: "c35-report-export", versionId: "1" },
      },
    } as ModuleErrorV1;
  }

  /** 无权与不存在同形：只带稳定 code 与阶段，不泄露受限查询或工件的存在性。 */
  #notFound(stageCode: string): ModuleErrorV1 {
    return {
      code: "ENTITY_NOT_FOUND",
      category: "not-found",
      retryable: false,
      stageCode,
      occurredAt: this.#now().toISOString(),
      causalRunId: "c35-report-export",
      targetRef: {
        kind: "query-result",
        reference: { entityId: "c35-report-export-unavailable", versionId: "1" },
      },
    } as ModuleErrorV1;
  }

  /** 当前授权复验；无权与异常一律按同形失败收口，不放宽可见性判断。 */
  async #verify(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }): Promise<AuthorizationContextV1 | undefined> {
    if (input.authorization.projectId !== input.projectId) return undefined;
    if (input.authorization.grantedCapabilities.length !== 1) return undefined;
    const capability = input.authorization.grantedCapabilities[0];
    if (capability !== EXPORT_CAPABILITY_V1) return undefined;
    try {
      const decision = await this.#authorization.verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: input.invocationId,
        projectId: input.projectId,
        branch: input.branch,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      });
      const verified = decision.context;
      if (
        verified.projectId !== input.projectId ||
        verified.actorId !== input.authorization.actorId ||
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

  #policyFor(policyRef: VersionReference): ReportExportPolicyV1 | undefined {
    return this.#policies.find(
      (policy) =>
        policy.policyRef.entityId === policyRef.entityId &&
        policy.policyRef.versionId === policyRef.versionId,
    );
  }

  async #registrationFor(
    projectId: string,
    sourceRef: QueryResultRefV1,
  ): Promise<
    | {
        readonly ok: true;
        readonly registration: Awaited<
          ReturnType<WorkflowGraphRegistrationStoreV1["readQuery"]>
        > & {};
      }
    | { readonly ok: false }
  > {
    const registration = await this.#store.readQuery({
      projectId,
      queryResultId: sourceRef.reference.entityId,
      queryResultVersionId: sourceRef.reference.versionId,
    });
    if (registration === undefined) return { ok: false };
    return { ok: true, registration };
  }

  /**
   * 报告范围（design D-08）：完全取自已登记查询结果——精确工程修订、空间目标与登记
   * `recordedAt` 时点。登记未冻结空间时按当前已复验的空间范围披露，不接受客户端自造范围。
   */
  #scopeOf(
    registration: {
      readonly targetRef: unknown;
      readonly spatialScopeRef?: SpatialScopeRefV1 | undefined;
      readonly recordedAt: string;
    },
    verified: AuthorizationContextV1,
  ): ReportExportScopeV1 | undefined {
    const revision = ContractReferenceV1Schema.safeParse(registration.targetRef);
    if (!revision.success || revision.data.kind !== "project-revision") return undefined;
    const spatialScopeRefs =
      registration.spatialScopeRef === undefined
        ? [...verified.spatialScopeRefs]
        : [registration.spatialScopeRef];
    if (spatialScopeRefs.length === 0) return undefined;
    const scope = ReportExportScopeV1Schema.safeParse({
      projectRevisionRef: revision.data,
      spatialScopeRefs,
      asOfRecordedAt: registration.recordedAt,
    });
    return scope.success ? scope.data : undefined;
  }

  async #readOnePage(input: {
    readonly projectId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly sourceRef: QueryResultRefV1;
    readonly limit: number;
    readonly cursor: string | undefined;
    readonly verified: AuthorizationContextV1;
    readonly registration: {
      readonly spatialScopeRef?: SpatialScopeRefV1 | undefined;
    };
  }): Promise<
    | {
        readonly ok: true;
        readonly items: readonly ProjectionResultItemV1[];
        readonly nextCursor?: string;
      }
    | { readonly ok: false }
  > {
    let result: Awaited<ReturnType<ProjectionResultReadPortV1["readPage"]>>;
    try {
      result = await this.#resultRead.readPage({
        projectId: input.projectId,
        queryResultRef: input.sourceRef,
        requestedAt: input.requestedAt,
        queryId: input.invocationId,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        authorization: input.verified,
      });
    } catch {
      return { ok: false };
    }
    if (result.kind !== "page") return { ok: false };
    return {
      ok: true,
      items: result.items,
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
    };
  }

  /**
   * 同次导出分页复用入口决定，按策略 `maxPages/maxItems` 硬收口，
   * 游标重复视为未证明结束直接失败；不裁半份报告、不返回部分成功。
   */
  async #readAllPages(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly requestedAt: string;
    readonly sourceRef: QueryResultRefV1;
    readonly policy: ReportExportPolicyV1;
    readonly authorization: AuthorizationContextV1;
    readonly registration: { readonly spatialScopeRef?: SpatialScopeRefV1 | undefined };
  }): Promise<
    | { readonly ok: true; readonly items: readonly ProjectionResultItemV1[] }
    | { readonly ok: false; readonly error: ModuleErrorV1 }
  > {
    const items: ProjectionResultItemV1[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 1; page <= input.policy.maxPages; page += 1) {
      const verified = input.authorization;
      const remaining = input.policy.maxItems - items.length;
      if (remaining < 1) {
        return { ok: false, error: this.#blocked("report-export", "export-items-exceeded") };
      }
      const read = await this.#readOnePage({
        projectId: input.projectId,
        invocationId: `${input.queryId}:page:${page}`,
        requestedAt: input.requestedAt,
        sourceRef: input.sourceRef,
        limit: Math.min(PROJECTION_PAGE_LIMIT_V1, remaining),
        cursor,
        verified,
        registration: input.registration,
      });
      if (!read.ok) {
        return {
          ok: false,
          error: this.#blocked("report-export-page", "source-page-unreadable"),
        };
      }
      for (const item of read.items) {
        const section = sectionOfItem(item);
        if (section === undefined || !input.policy.sections.includes(section)) continue;
        items.push(item);
        if (items.length > input.policy.maxItems) {
          return { ok: false, error: this.#blocked("report-export", "export-items-exceeded") };
        }
      }
      if (read.nextCursor === undefined) return { ok: true, items };
      if (seenCursors.has(read.nextCursor)) {
        return { ok: false, error: this.#blocked("report-export", "export-cursor-loop") };
      }
      seenCursors.add(read.nextCursor);
      cursor = read.nextCursor;
    }
    // 预算用尽仍有下一页：没有证明导出结束，按超限失败而不是交付不完整报告。
    return { ok: false, error: this.#blocked("report-export", "export-pages-exceeded") };
  }

  async #completedReceiptFor(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly exportArtifactRef: ExportArtifactRefV1;
  }): Promise<
    | { readonly ok: true; readonly idempotencyKey: string; readonly auditEntryId: string }
    | { readonly ok: false }
  > {
    const row = await this.#db
      .selectFrom("business.command_receipts")
      .select(["idempotency_key", "audit_entry_id"])
      .where("project_id", "=", input.projectId)
      .where("command_kind", "=", EXPORT_COMPLETE_COMMAND_KIND_V1)
      .where("actor_ref", "=", input.actorId)
      .where(sql<SqlBool>`result_ref @> ${JSON.stringify(input.exportArtifactRef)}::jsonb`)
      .where("completed_at", "is not", null)
      .limit(1)
      .executeTakeFirst();
    if (row === undefined || row.audit_entry_id === null) return { ok: false };
    return { ok: true, idempotencyKey: row.idempotency_key, auditEntryId: row.audit_entry_id };
  }

  /**
   * 绑定收据按同一 `idempotencyKey` 找回：C03 的 `command_id` 全局唯一，尾事务因此不能复用
   * 绑定命令的 commandId，两段只以 commandKind 与同一幂等键关联。
   */
  async #bindingReceiptFor(input: {
    readonly projectId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly ok: true; readonly auditEntryId: string } | { readonly ok: false }> {
    const row = await this.#db
      .selectFrom("business.command_receipts")
      .select(["audit_entry_id"])
      .where("project_id", "=", input.projectId)
      .where("command_kind", "=", EXPORT_BIND_COMMAND_KIND_V1)
      .where("idempotency_key", "=", input.idempotencyKey)
      .where("completed_at", "is not", null)
      .limit(1)
      .executeTakeFirst();
    if (row === undefined || row.audit_entry_id === null) return { ok: false };
    return { ok: true, auditEntryId: row.audit_entry_id };
  }

  async #auditRow(projectId: string, auditEntryId: string) {
    return await this.#db
      .selectFrom("audit.entries")
      .select(["action", "target_ref", "actor_ref", "recorded_at"])
      .where("project_id", "=", projectId)
      .where("audit_entry_id", "=", auditEntryId)
      .limit(1)
      .executeTakeFirst();
  }

  /** 已完成导出的完整证明：completed 收据 + `generated` 审计 + 精确 C04 内容引用。 */
  async #completedExport(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly exportArtifactRef: ExportArtifactRefV1;
  }): Promise<
    | {
        readonly ok: true;
        readonly sourceRef: QueryResultRefV1;
        readonly contentRef: ContentArtifactRefV1;
        readonly recordedAt: string;
      }
    | { readonly ok: false }
  > {
    const receipt = await this.#completedReceiptFor(input);
    if (!receipt.ok) return { ok: false };
    const audit = await this.#auditRow(input.projectId, receipt.auditEntryId);
    if (audit === undefined || audit.action !== EXPORT_GENERATED_ACTION_V1) return { ok: false };
    if (audit.actor_ref !== input.actorId) return { ok: false };
    const content = ContentArtifactRefV1Schema.safeParse(audit.target_ref);
    if (!content.success) return { ok: false };
    const binding = await this.#bindingReceiptFor({
      projectId: input.projectId,
      idempotencyKey: receipt.idempotencyKey,
    });
    if (!binding.ok) return { ok: false };
    const bindingAudit = await this.#auditRow(input.projectId, binding.auditEntryId);
    if (bindingAudit === undefined || bindingAudit.action !== EXPORT_REQUESTED_ACTION_V1) {
      return { ok: false };
    }
    const source = QueryResultRefV1Schema.safeParse(bindingAudit.target_ref);
    if (!source.success) return { ok: false };
    return {
      ok: true,
      sourceRef: source.data,
      contentRef: content.data,
      recordedAt: asIsoDateTime(audit.recorded_at),
    };
  }

  /**
   * 按原绑定 sourceRef 取得冻结资源，历史授权只定位范围，当前账号决定读取资格。
   */
  async #sourceAuthorization(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly sourceRef: QueryResultRefV1;
    readonly parent: AuthorizationContextV1;
  }): Promise<AuthorizationContextV1 | undefined> {
    const registration = await this.#registrationFor(input.projectId, input.sourceRef);
    if (!registration.ok) return undefined;
    return this.#authorizeResource({
      authorization: input.parent,
      resourceAuthorizationContextRef: registration.registration.authorizationContextRef,
      invocationId: input.invocationId,
      branch: "projection.export",
      ...(registration.registration.spatialScopeRef === undefined
        ? {}
        : { spatialScopeRefs: [registration.registration.spatialScopeRef] }),
    }).catch(() => undefined);
  }

  /** 生成导出（design D-09）：绑定事务 → 有限全量分页 → C04 耐久化 → 尾事务。 */
  readonly exportReport = async (
    request: ProjectionExportRequestV1,
  ): Promise<ProjectionExportResultV1> => {
    const parsed = ProjectionExportRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return { kind: "failed", error: this.#blocked("report-export", "export-request-invalid") };
    }
    const { projectId, actorId, queryId, requestedAt, payload } = parsed.data;
    let verified = await this.#verify({
      authorization: parsed.data.authorization,
      projectId,
      invocationId: queryId,
      branch: "projection.export",
      requestedAt,
    });
    if (verified === undefined) {
      return { kind: "failed", error: this.#notFound("report-export") };
    }
    // 只有精确登记的 C31 查询结果可导出；其它引用按既有稳定「不支持」语义失败。
    const source = QueryResultRefV1Schema.safeParse(payload.sourceRef);
    if (!source.success) {
      return { kind: "failed", error: this.#blocked("report-export", "export-source-unsupported") };
    }
    const sourceRef = source.data;
    const policy = this.#policyFor(payload.exportPolicyRef);
    if (policy === undefined) {
      return { kind: "failed", error: this.#blocked("report-export", "export-policy-unavailable") };
    }
    const found = await this.#registrationFor(projectId, sourceRef);
    if (!found.ok) {
      return { kind: "failed", error: this.#notFound("report-export") };
    }
    const registration = found.registration;
    verified = await this.#sourceAuthorization({
      projectId,
      actorId,
      invocationId: queryId,
      requestedAt,
      sourceRef,
      parent: verified,
    });
    if (verified === undefined) return { kind: "failed", error: this.#notFound("report-export") };
    if (!policy.queryTypes.includes(registration.queryType as ReportExportQueryTypeV1)) {
      return {
        kind: "failed",
        error: this.#blocked("report-export", "export-query-type-unsupported"),
      };
    }
    const scope = this.#scopeOf(registration, verified);
    if (scope === undefined) {
      return { kind: "failed", error: this.#blocked("report-export", "export-scope-unavailable") };
    }
    const digest = reportIdentityV1({
      projectId,
      actorId,
      queryId,
      sourceRef,
      exportPolicyRef: policy.policyRef,
    });
    const artifactId = `riskflow-report:${digest}`;
    const bindingAuditEntryId = `riskflow-report-requested:${digest}`;
    const generatedAuditEntryId = `riskflow-report-generated:${digest}`;
    const putCommandId = `riskflow-report-put:${digest}`;
    const completeCommandId = `riskflow-report-complete:${digest}`;

    try {
      await this.#transactionUnit.execute(
        {
          projectId,
          commandKind: EXPORT_BIND_COMMAND_KIND_V1,
          commandId: queryId,
          idempotencyKey: queryId,
          payload: { sourceRef, exportPolicyRef: policy.policyRef, actorId },
          actorRef: actorId,
          authorizationContextRef: verified.authorizationContextRef,
          // 报告时间取查询登记时点，不取每次重试的当前时钟。
          issuedAt: registration.recordedAt,
        },
        async () => ({
          resultRef: sourceRef,
          audit: {
            auditEntryId: bindingAuditEntryId,
            projectId,
            action: EXPORT_REQUESTED_ACTION_V1,
            targetRef: sourceRef,
            actorRef: actorId,
            authorizationContextRef: verified.authorizationContextRef,
            occurredAt: registration.recordedAt,
            recordedAt: registration.recordedAt,
            version: sourceRef.reference,
            commandId: queryId,
            idempotencyKey: queryId,
          },
          events: [],
        }),
      );
    } catch {
      // 绑定冲突或事务失败：绑定成功也不等于导出成功，这里一律不发布成功引用。
      return { kind: "failed", error: this.#blocked("report-export", "export-bind-failed") };
    }

    const existing = await this.#db
      .selectFrom("business.command_receipts")
      .select(["result_ref"])
      .where("project_id", "=", projectId)
      .where("command_kind", "=", EXPORT_COMPLETE_COMMAND_KIND_V1)
      .where("idempotency_key", "=", queryId)
      .where("completed_at", "is not", null)
      .limit(1)
      .executeTakeFirst();
    if (existing !== undefined) {
      const prior = ExportArtifactRefV1Schema.safeParse(existing.result_ref);
      if (prior.success) {
        return { kind: "succeeded", result: { exportArtifactRef: prior.data } };
      }
    }

    const pages = await this.#readAllPages({
      projectId,
      queryId,
      requestedAt,
      sourceRef,
      policy,
      authorization: verified,
      registration,
    });
    if (!pages.ok) {
      return { kind: "failed", error: pages.error };
    }
    const body = ReportArtifactBodyV1Schema.parse({
      bodyKind: "riskflow-report",
      schemaVersion: "1",
      projectId,
      queryResultRef: sourceRef,
      exportPolicyRef: policy.policyRef,
      scope,
      format: policy.format,
      sections: policy.sections,
      items: pages.items,
      // 生成审计引用按稳定身份预分配并进入正文，尾事务保存同一引用。
      generationAuditRef: { entityId: generatedAuditEntryId, versionId: "1" },
    }) satisfies ReportArtifactBodyV1;
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    if (encoded.byteLength > policy.maxBytes) {
      return { kind: "failed", error: this.#blocked("report-export", "export-bytes-exceeded") };
    }

    let contentRef: ContentArtifactRefV1;
    try {
      const put = await this.#artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: putCommandId,
          idempotencyKey: putCommandId,
          projectId,
          actorId,
          issuedAt: registration.recordedAt,
          // 写工件使用原精确导出范围；能力不足或范围不符由 C04 原样拒绝。
          authorization: verified,
          requiredCapability: EXPORT_CAPABILITY_V1,
          artifactId,
          artifactKind: "content",
          purposeCode: REPORT_PURPOSE_CODE_V1,
          mediaType: REPORT_MEDIA_TYPE_V1,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield encoded;
        })(),
      );
      if (put.artifactRef.kind !== "content-artifact") {
        return { kind: "failed", error: this.#blocked("report-export", "export-artifact-kind") };
      }
      contentRef = put.artifactRef;
    } catch {
      // C04 未耐久化即失败：不写尾收据、不发布成功引用，原身份可安全重试。
      return { kind: "failed", error: this.#blocked("report-export", "export-artifact-failed") };
    }

    const exportArtifactRef: ExportArtifactRefV1 = {
      kind: "export-artifact",
      reference: { ...contentRef.reference },
    };

    // 写工件后再次复验当前导出授权：绑定与尾之间被撤权时按失败收口。
    const beforeTail = await this.#sourceAuthorization({
      parent: verified,
      projectId,
      actorId,
      invocationId: queryId,
      requestedAt,
      sourceRef,
    });
    if (beforeTail === undefined) {
      return { kind: "failed", error: this.#notFound("report-export-complete") };
    }

    let tail: Awaited<ReturnType<TransactionUnitV1["execute"]>>;
    try {
      tail = await this.#transactionUnit.execute(
        {
          projectId,
          commandKind: EXPORT_COMPLETE_COMMAND_KIND_V1,
          // C03 的 `command_id` 全局唯一，尾事务不能复用绑定命令的 queryId：改用同一稳定摘要
          // 派生的独立身份，幂等键仍是原 queryId，重试因此仍复用同一逻辑报告。
          commandId: completeCommandId,
          idempotencyKey: queryId,
          payload: { sourceRef, exportPolicyRef: policy.policyRef, actorId, exportArtifactRef },
          actorRef: actorId,
          authorizationContextRef: beforeTail.authorizationContextRef,
          issuedAt: registration.recordedAt,
        },
        async () => ({
          resultRef: exportArtifactRef,
          audit: {
            auditEntryId: generatedAuditEntryId,
            projectId,
            action: EXPORT_GENERATED_ACTION_V1,
            targetRef: contentRef,
            actorRef: actorId,
            authorizationContextRef: beforeTail.authorizationContextRef,
            occurredAt: registration.recordedAt,
            recordedAt: registration.recordedAt,
            version: exportArtifactRef.reference,
            commandId: completeCommandId,
            idempotencyKey: queryId,
          },
          events: [],
        }),
      );
    } catch {
      // 尾事务失败同样不发布成功；已耐久化内容按 C04 现有维护机制收口。
      return { kind: "failed", error: this.#blocked("report-export", "export-complete-failed") };
    }
    const completed = ExportArtifactRefV1Schema.safeParse(tail.resultRef);
    if (!completed.success) {
      return { kind: "failed", error: this.#blocked("report-export", "export-complete-invalid") };
    }
    return { kind: "succeeded", result: { exportArtifactRef: completed.data } };
  };

  /** 报告窄读端口：策略、预览、工件与历史（design D-08/D-09）。 */
  readonly read = async (
    query: ProjectionReportReadQueryV1,
  ): Promise<ProjectionReportReadResultV1> => {
    const parsed = ProjectionReportReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return { kind: "failed", error: this.#blocked("report-read", "report-read-invalid") };
    }
    const verified = await this.#verify({
      authorization: parsed.data.authorization,
      projectId: parsed.data.projectId,
      invocationId: parsed.data.queryId,
      branch: "projection.report-read",
      requestedAt: parsed.data.requestedAt,
    });
    if (verified === undefined) {
      return { kind: "failed", error: this.#notFound("report-read") };
    }
    const envelope = {
      projectId: parsed.data.projectId,
      actorId: parsed.data.actorId,
      queryId: parsed.data.queryId,
      requestedAt: parsed.data.requestedAt,
      verified,
    };
    switch (parsed.data.kind) {
      case "policies":
        return { kind: "succeeded", result: { kind: "policies", items: [...this.#policies] } };
      case "preview":
        return await this.#readPreview(parsed.data, envelope);
      case "artifact":
        return await this.#readArtifact(parsed.data.payload.exportArtifactRef, envelope);
      case "history":
        return await this.#readHistory(parsed.data, envelope);
    }
  };

  async #readPreview(
    query: Extract<ProjectionReportReadQueryV1, { kind: "preview" }>,
    envelope: {
      readonly projectId: string;
      readonly actorId: string;
      readonly queryId: string;
      readonly requestedAt: string;
      readonly verified: AuthorizationContextV1;
    },
  ): Promise<ProjectionReportReadResultV1> {
    const { queryResultRef: sourceRef, exportPolicyRef } = query.payload;
    const policy = this.#policyFor(exportPolicyRef);
    if (policy === undefined) {
      return {
        kind: "failed",
        error: this.#blocked("report-preview", "export-policy-unavailable"),
      };
    }
    const found = await this.#registrationFor(envelope.projectId, sourceRef);
    if (!found.ok) {
      return { kind: "failed", error: this.#notFound("report-preview") };
    }
    const registration = found.registration;
    if (!policy.queryTypes.includes(registration.queryType as ReportExportQueryTypeV1)) {
      return {
        kind: "failed",
        error: this.#blocked("report-preview", "export-query-type-unsupported"),
      };
    }
    const verified = await this.#sourceAuthorization({
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      invocationId: envelope.queryId,
      requestedAt: envelope.requestedAt,
      sourceRef,
      parent: envelope.verified,
    });
    if (verified === undefined) return { kind: "failed", error: this.#notFound("report-preview") };
    const scope = this.#scopeOf(registration, verified);
    if (scope === undefined) {
      return { kind: "failed", error: this.#blocked("report-preview", "export-scope-unavailable") };
    }
    // 预览只取有界首页：引用超过页大小时由调用方续页，不扫描完整工程。
    const page = await this.#readOnePage({
      projectId: envelope.projectId,
      invocationId: `${envelope.queryId}:preview`,
      requestedAt: envelope.requestedAt,
      sourceRef,
      limit: REPORT_EXPORT_PAGE_SIZE_DEFAULT_V1,
      cursor: undefined,
      verified,
      registration,
    });
    if (!page.ok) {
      return { kind: "failed", error: this.#blocked("report-preview", "source-page-unreadable") };
    }
    const items = page.items.filter((item) => {
      const section = sectionOfItem(item);
      return section !== undefined && policy.sections.includes(section);
    });
    return {
      kind: "succeeded",
      result: {
        kind: "preview",
        projectId: envelope.projectId,
        sourceRef,
        queryType: registration.queryType as ReportExportQueryTypeV1,
        scope,
        policy,
        items,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      },
    };
  }

  async #readArtifact(
    exportArtifactRef: ExportArtifactRefV1,
    envelope: {
      readonly projectId: string;
      readonly actorId: string;
      readonly queryId: string;
      readonly requestedAt: string;
      readonly verified: AuthorizationContextV1;
    },
  ): Promise<ProjectionReportReadResultV1> {
    const completed = await this.#completedExport({
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      exportArtifactRef,
    });
    if (!completed.ok) {
      return { kind: "failed", error: this.#notFound("report-artifact") };
    }
    const visible = await this.#sourceAuthorization({
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      invocationId: `${envelope.queryId}:artifact-source`,
      requestedAt: envelope.requestedAt,
      sourceRef: completed.sourceRef,
      parent: envelope.verified,
    });
    if (!visible) {
      // 生成后失去工程、空间、来源或导出权限：安全失败，不用旧授权快照或下载链接绕过。
      return { kind: "failed", error: this.#notFound("report-artifact") };
    }
    const body = await this.#openReportBody({
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      requestedAt: envelope.requestedAt,
      invocationId: `${envelope.queryId}:artifact-body`,
      contentRef: completed.contentRef,
      verified: visible,
    });
    if (body === undefined) {
      return { kind: "failed", error: this.#notFound("report-artifact-body") };
    }
    if (
      body.body.projectId !== envelope.projectId ||
      referenceKey(body.body.queryResultRef) !== referenceKey(completed.sourceRef)
    ) {
      return { kind: "failed", error: this.#blocked("report-artifact", "export-body-mismatch") };
    }
    const policy = this.#policyFor(body.body.exportPolicyRef);
    if (policy === undefined) {
      return {
        kind: "failed",
        error: this.#blocked("report-artifact", "export-policy-unavailable"),
      };
    }
    if (body.byteLength > policy.maxBytes) {
      return { kind: "failed", error: this.#blocked("report-artifact", "export-bytes-exceeded") };
    }
    return {
      kind: "succeeded",
      result: {
        kind: "artifact",
        exportArtifactRef,
        fileName: reportFileNameV1(exportArtifactRef),
        byteLength: body.byteLength,
        body: body.body,
      },
    };
  }

  /** 只按 completed 收据登记的精确 C04 引用打开：校验 completed、JSON Schema 与字节上限。 */
  async #openReportBody(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId: string;
    readonly contentRef: ContentArtifactRefV1;
    readonly verified: AuthorizationContextV1;
  }): Promise<{ readonly body: ReportArtifactBodyV1; readonly byteLength: number } | undefined> {
    try {
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          // C04 把读取登记成以 `requestId` 为 commandId 的原子命令，该列全局唯一：
          // 因此请求身份必须绑定本次调用的 invocationId，同一工件被重复读取才不会互撞。
          requestId: `c35-report-read:${input.invocationId}:${input.contentRef.reference.versionId}`,
          idempotencyKey: `c35-report-read:${input.invocationId}:${input.contentRef.reference.versionId}`,
          artifactRef: input.contentRef,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          purposeCode: REPORT_PURPOSE_CODE_V1,
          requiredCapability: EXPORT_CAPABILITY_V1,
          authorization: input.verified,
        }),
      );
      if (handle.manifest.mediaType !== REPORT_MEDIA_TYPE_V1) return undefined;
      if (handle.manifest.purposeCode !== REPORT_PURPOSE_CODE_V1) return undefined;
      if (handle.manifest.content.byteLength > MAX_REPORT_BODY_BYTES_V1) return undefined;
      const bytes = await readBoundedV1(handle.content, MAX_REPORT_BODY_BYTES_V1);
      await handle.completed;
      const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const parsed = ReportArtifactBodyV1Schema.safeParse(decoded);
      if (!parsed.success) return undefined;
      return { body: parsed.data, byteLength: bytes.byteLength };
    } catch {
      return undefined;
    }
  }

  /**
   * 历史（design D-09）：只列当前工程/actor 的 completed 收据，按原绑定审计取回 sourceRef，
   * 逐条复验来源当前授权；至多一页 50 项，不建立第二套持久化历史，也不全库扫描。
   */
  async #readHistory(
    query: Extract<ProjectionReportReadQueryV1, { kind: "history" }>,
    envelope: {
      readonly projectId: string;
      readonly actorId: string;
      readonly queryId: string;
      readonly requestedAt: string;
      readonly verified: AuthorizationContextV1;
    },
  ): Promise<ProjectionReportReadResultV1> {
    const pageSize = Math.min(
      Math.max(query.payload.pageSize ?? HISTORY_PAGE_SIZE_DEFAULT_V1, 1),
      HISTORY_PAGE_SIZE_MAX_V1,
    );
    const cursor = query.payload.cursor;
    let base = this.#db
      .selectFrom("business.command_receipts")
      .select(["command_id", "audit_entry_id", "result_ref", "created_at"])
      .where("project_id", "=", envelope.projectId)
      .where("command_kind", "=", EXPORT_COMPLETE_COMMAND_KIND_V1)
      .where("actor_ref", "=", envelope.actorId)
      .where("completed_at", "is not", null);
    if (cursor !== undefined) {
      const decoded = decodeHistoryCursorV1(cursor);
      if (decoded === undefined) {
        return { kind: "failed", error: this.#blocked("report-history", "cursor-invalid") };
      }
      base = base.where(
        sql<SqlBool>`(created_at, command_id) < (${decoded.createdAt}::timestamptz, ${decoded.commandId})`,
      );
    }
    const rows = await base
      .orderBy("created_at", "desc")
      .orderBy("command_id", "desc")
      .limit(pageSize + 1)
      .execute();
    const items: {
      readonly exportArtifactRef: ExportArtifactRefV1;
      readonly sourceRef: QueryResultRefV1;
      readonly exportPolicyRef: VersionReference;
      readonly recordedAt: string;
      readonly result: {
        readonly kind: "project";
        readonly resultRef: { entityId: string; versionId: string };
        readonly references: { entityId: string; versionId: string }[];
      };
    }[] = [];
    let nextCursor: string | undefined;
    for (const [index, row] of rows.entries()) {
      if (index === pageSize) {
        const previous = rows[pageSize - 1];
        if (previous !== undefined) {
          nextCursor = encodeHistoryCursorV1({
            createdAt: asIsoDateTime(previous.created_at),
            commandId: previous.command_id,
          });
        }
        break;
      }
      const exportRef = ExportArtifactRefV1Schema.safeParse(row.result_ref);
      if (!exportRef.success || row.audit_entry_id === null) continue;
      const completed = await this.#completedExport({
        projectId: envelope.projectId,
        actorId: envelope.actorId,
        exportArtifactRef: exportRef.data,
      });
      if (!completed.ok) continue;
      if (
        query.payload.sourceRef !== undefined &&
        referenceKey(query.payload.sourceRef) !== referenceKey(completed.sourceRef)
      ) {
        continue;
      }
      const visible = await this.#sourceAuthorization({
        projectId: envelope.projectId,
        actorId: envelope.actorId,
        invocationId: `${envelope.queryId}:history:${row.command_id}`,
        requestedAt: envelope.requestedAt,
        sourceRef: completed.sourceRef,
        parent: envelope.verified,
      });
      if (!visible) continue;
      const body = await this.#openReportBody({
        projectId: envelope.projectId,
        actorId: envelope.actorId,
        requestedAt: envelope.requestedAt,
        invocationId: `${envelope.queryId}:history-body:${row.command_id}`,
        contentRef: completed.contentRef,
        verified: visible,
      });
      if (body === undefined) continue;
      if (referenceKey(body.body.queryResultRef) !== referenceKey(completed.sourceRef)) continue;
      items.push({
        exportArtifactRef: exportRef.data,
        sourceRef: completed.sourceRef,
        exportPolicyRef: body.body.exportPolicyRef,
        recordedAt: completed.recordedAt,
        result: {
          kind: "project",
          resultRef: { ...exportRef.data.reference },
          references: [],
        },
      });
    }
    return {
      kind: "succeeded",
      result: {
        kind: "history",
        projectId: envelope.projectId,
        items,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      },
    };
  }
}

const encodeHistoryCursorV1 = (input: {
  readonly createdAt: string;
  readonly commandId: string;
}): string => {
  const fields = [input.createdAt, input.commandId];
  return `${Buffer.from(JSON.stringify(fields), "utf8").toString("base64url")}.${sha256CanonicalJson(fields)}`;
};

const decodeHistoryCursorV1 = (
  cursor: string,
): { readonly createdAt: string; readonly commandId: string } | undefined => {
  const separator = cursor.lastIndexOf(".");
  if (separator <= 0) return undefined;
  const encoded = cursor.slice(0, separator);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [createdAt, commandId] = parsed as readonly unknown[];
  if (typeof createdAt !== "string" || typeof commandId !== "string") return undefined;
  if (sha256CanonicalJson([createdAt, commandId]) !== cursor.slice(separator + 1)) return undefined;
  return { createdAt, commandId };
};

/** 服务端固定 ASCII 文件名：只由 export 引用派生，满足契约正则，不含路径或外链。 */
const reportFileNameV1 = (exportArtifactRef: ExportArtifactRefV1): string =>
  `riskflow-report-${sha256CanonicalJson(exportArtifactRef).slice(0, 32)}.json`;

const readBoundedV1 = async (
  content: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of content) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error("report-body-bytes-exceeded");
    chunks.push(chunk);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

export const createPostgresReportExport = (
  options: PostgresReportExportOptionsV1,
): PostgresReportExportV1 => {
  const service = new ReportExportService(options);
  return {
    reportRead: { read: (query) => service.read(query) },
    exportReport: (request) => service.exportReport(request),
  };
};
