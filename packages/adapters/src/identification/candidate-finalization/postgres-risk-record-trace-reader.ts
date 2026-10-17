import type { Kysely } from "kysely";

import type { JsonValue } from "@riskflow/core/persistence";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  RiskRecordTraceReadRequestV1Schema,
  RiskRecordTraceReadResultV1Schema,
  SpatialScopeRefV1Schema,
  SourceVersionRefV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type RiskRecordTraceReadPortV1,
  type RiskRecordTraceReadResultV1,
  type StandardizedRiskRecordRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";

import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";
import type { PostgresLocalIdentityAccess } from "../../auth/index.js";

const RECORDS_TABLE = "business.standardized_risk_records";
const STAGE_CODE_V1 = "identification-candidate-finalization.trace-read";

/** design D-06 的有界披露上限：单批 100 条，每条最多 256 资料段 / 64 机理条目。 */
const MAX_BATCH_SIZE_V1 = 100;
const MAX_SOURCE_SEGMENTS_V1 = 256;
const MAX_MECHANISM_ENTRIES_V1 = 64;

/**
 * design D-06：本读接缝不新增 capability，只复用调用方已持有的 `projection.query` 能力位；
 * 空间与资料可见性由 C06 按记录登记的实际范围检查，历史摘要只留作审计。
 * 复验 branch 由请求携带（外层调用入口的路由 branch），本端口不硬编码——C06 verify 精确
 * 绑定 branch，而 capability 与 branch 一对多，反推恒可能错配。
 */
const TRACE_READ_CAPABILITY_V1 = MODULE_BRANCH_CAPABILITY_V1["projection.query"];

/** 稳定边界原因码（design D-06）：调用方可据此区分整批超限与单条披露超限。 */
const TRACE_BATCH_OVERFLOW_V1 = "trace-batch-overflow";
const TRACE_REQUEST_INVALID_V1 = "trace-request-invalid";
const TRACE_SOURCE_OVERFLOW_V1 = "trace-source-overflow";
const TRACE_MECHANISM_OVERFLOW_V1 = "trace-mechanism-overflow";

interface StandardizedRiskRecordTraceDbRow {
  project_id: string;
  risk_record_id: string;
  version_id: string;
  source_segment_ids: JsonValue;
  mechanism_entry_ids: JsonValue;
  payload: JsonValue;
  spatial_scope_refs: JsonValue | null;
  source_version_refs: JsonValue | null;
  audit_entry_id: string;
}

interface RiskRecordTraceDatabase {
  "business.standardized_risk_records": StandardizedRiskRecordTraceDbRow;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type RiskRecordTraceDatabaseV1 = PostgresDatabase & RiskRecordTraceDatabase;
type RiskRecordTraceQueryExecutorV1 = Kysely<RiskRecordTraceDatabaseV1>;

type RiskRecordTraceItemV1 = Extract<
  RiskRecordTraceReadResultV1,
  { kind: "succeeded" }
>["items"][number];

/** 标识符列表事实：含非字符串或空串即视为不可披露来源（fail closed，不部分披露）。 */
const identifierListV1 = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? (value as readonly string[])
    : undefined;

export interface PostgresRiskRecordTraceReaderOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & RiskRecordTraceDatabase>`。 */
  readonly db: unknown;
  /** C06 当前授权复验端口：每次批读在披露任何目标之前按当前 actor/工程/空间/资料范围复验。 */
  readonly authorization: Pick<PostgresLocalIdentityAccess, "verify" | "authorizeBusinessAction">;
  readonly now?: () => Date;
}

/**
 * C22 只读追溯适配器（design D-06/IP-07）：按工程与精确 `(entityId, versionId)` 批量读取自有
 * `business.standardized_risk_records`，只返回资料段、工序、机理与审计的最小可披露引用，永不
 * 返回风险正文。读取前先解析 strict 请求、再复验当前授权；不存在、跨工程与当前授权看不到范围
 * 的记录收口为逐字相同的 `ENTITY_NOT_FOUND`（不提供存在性 oracle）。批/单条越界返回
 * `BUSINESS_BLOCKED` 与稳定 `blockerKind`，不静默截断。
 *
 * 逐条可见性使用 C22 登记的来源与空间，通过 C06 检查当前权限，不跨模块读取权限私表。
 */
export class PostgresRiskRecordTraceReader implements RiskRecordTraceReadPortV1 {
  readonly #db: RiskRecordTraceQueryExecutorV1;
  readonly #authorization: PostgresRiskRecordTraceReaderOptionsV1["authorization"];
  readonly #now: () => Date;

  constructor(options: PostgresRiskRecordTraceReaderOptionsV1) {
    this.#db = options.db as unknown as RiskRecordTraceQueryExecutorV1;
    this.#authorization = options.authorization;
    this.#now = options.now ?? (() => new Date());
  }

  async readBatch(request: unknown): Promise<RiskRecordTraceReadResultV1> {
    const parsed = RiskRecordTraceReadRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      // 解析前先判整批边界：`riskRecordRefs` 超过上限时 Schema 必然失败，但调用方需要稳定的
      // `blockerKind` 区分"整批超限"与"请求形状非法"，因此按原始输入分类，不把两者混为一谈。
      const refs = (request as { readonly riskRecordRefs?: unknown } | null)?.riskRecordRefs;
      return {
        kind: "failed",
        error: this.#moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: STAGE_CODE_V1,
          occurredAt: this.#now().toISOString(),
          blockerKind:
            Array.isArray(refs) && refs.length > MAX_BATCH_SIZE_V1
              ? TRACE_BATCH_OVERFLOW_V1
              : TRACE_REQUEST_INVALID_V1,
          // 只标识本读接缝自身的边界，不指向任何受限目标。
          blockerRef: {
            kind: "content-artifact",
            reference: { entityId: "risk-record-trace-read-request", versionId: "v1" },
          },
        }),
      };
    }
    const valid = parsed.data;
    const invocationId = valid.invocationId;
    const verified = await this.#verifyCurrentAuthorization({
      authorization: valid.authorization,
      projectId: valid.projectId,
      invocationId,
      branch: valid.branch,
      requestedAt: valid.requestedAt,
    });
    if (verified === undefined) {
      return {
        kind: "failed",
        error: this.#moduleError({
          code: "AUTHORIZATION_DENIED",
          causalRunId: invocationId,
          occurredAt: valid.requestedAt,
          authorizationPolicyRef: valid.authorization.authorizationPolicyRef,
        }),
      };
    }

    const rows = await this.#readRows(valid.projectId, valid.riskRecordRefs);
    const visibility = new Map<string, Promise<boolean>>();
    const items: RiskRecordTraceItemV1[] = [];
    for (const riskRecordRef of valid.riskRecordRefs) {
      const row = rows.get(riskRecordRef.reference.entityId);
      let visible = false;
      if (row?.version_id === riskRecordRef.reference.versionId) {
        const scopes = SpatialScopeRefV1Schema.array()
          .min(1)
          .max(64)
          .safeParse(row.spatial_scope_refs);
        const sources = SourceVersionRefV1Schema.array()
          .min(1)
          .max(64)
          .safeParse(row.source_version_refs);
        if (scopes.success && sources.success) {
          const key = JSON.stringify([scopes.data, sources.data]);
          let decision = visibility.get(key);
          if (decision === undefined) {
            decision = this.#canReadScope({
              authorization: verified,
              invocationId,
              branch: valid.branch,
              spatialScopeRefs: scopes.data,
              sourceVersionRefs: sources.data,
            });
            visibility.set(key, decision);
          }
          visible = await decision;
        }
      }
      items.push(
        this.#itemFor({
          riskRecordRef,
          row,
          visible,
          invocationId,
          occurredAt: valid.requestedAt,
        }),
      );
    }
    return RiskRecordTraceReadResultV1Schema.parse({ kind: "succeeded", items });
  }

  async #canReadScope(input: {
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly spatialScopeRefs: AuthorizationContextV1["spatialScopeRefs"];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<boolean> {
    try {
      const decision = await this.#authorization.authorizeBusinessAction({
        actorId: input.authorization.actorId,
        projectId: input.authorization.projectId,
        branch: input.branch,
        capability: MODULE_BRANCH_CAPABILITY_V1[input.branch],
        invocationId: input.invocationId,
        requestedSpatialScopeRefs: input.spatialScopeRefs,
        requestedSourceVersionRefs: input.sourceVersionRefs,
        authorizationContextRef: input.authorization.authorizationContextRef,
        ...(input.authorization.invocation.kind === "agent-task"
          ? { taskRef: input.authorization.invocation.agentTaskRef }
          : {}),
      });
      return (
        !decision.redacted &&
        decision.context.actorId === input.authorization.actorId &&
        decision.context.projectId === input.authorization.projectId &&
        decision.context.grantedCapabilities.length === 1 &&
        decision.context.grantedCapabilities[0] === MODULE_BRANCH_CAPABILITY_V1[input.branch]
      );
    } catch {
      return false;
    }
  }

  /** 一条 SQL 读齐本批身份，不做逐条查询；版本与范围在逐条组装时精确核对。 */
  async #readRows(
    projectId: string,
    riskRecordRefs: readonly StandardizedRiskRecordRefV1[],
  ): Promise<ReadonlyMap<string, StandardizedRiskRecordTraceDbRow>> {
    const recordIds = [...new Set(riskRecordRefs.map((ref) => ref.reference.entityId))];
    try {
      const rows = await this.#db
        .selectFrom(RECORDS_TABLE)
        .select([
          "project_id",
          "risk_record_id",
          "version_id",
          "source_segment_ids",
          "mechanism_entry_ids",
          "payload",
          "spatial_scope_refs",
          "source_version_refs",
          "audit_entry_id",
        ])
        .where("project_id", "=", projectId)
        .where("risk_record_id", "in", recordIds)
        .execute();
      return new Map(rows.map((row) => [row.risk_record_id, row]));
    } catch (error) {
      throw mapPostgresError(error, `${STAGE_CODE_V1}.rows`);
    }
  }

  #itemFor(input: {
    readonly riskRecordRef: StandardizedRiskRecordRefV1;
    readonly row: StandardizedRiskRecordTraceDbRow | undefined;
    readonly visible: boolean;
    readonly invocationId: string;
    readonly occurredAt: string;
  }): RiskRecordTraceItemV1 {
    const notFound = (): RiskRecordTraceItemV1 => ({
      kind: "failed",
      riskRecordRef: input.riskRecordRef,
      error: this.#moduleError({
        code: "ENTITY_NOT_FOUND",
        causalRunId: input.invocationId,
        occurredAt: input.occurredAt,
        targetRef: input.riskRecordRef,
      }),
    });
    const blocked = (blockerKind: string): RiskRecordTraceItemV1 => ({
      kind: "failed",
      riskRecordRef: input.riskRecordRef,
      error: this.#moduleError({
        code: "BUSINESS_BLOCKED",
        causalRunId: input.invocationId,
        occurredAt: input.occurredAt,
        blockerKind,
        blockerRef: input.riskRecordRef,
      }),
    });

    // 不存在、跨工程（SQL 已按工程过滤）、版本不符与当前授权看不到范围：逐字同形，不提供 oracle。
    const row = input.row;
    if (
      row === undefined ||
      row.version_id !== input.riskRecordRef.reference.versionId ||
      !input.visible
    ) {
      return notFound();
    }
    const sourceSegmentIds = identifierListV1(row.source_segment_ids);
    const riskMechanismEntryIds = identifierListV1(row.mechanism_entry_ids);
    if (
      sourceSegmentIds === undefined ||
      sourceSegmentIds.length === 0 ||
      riskMechanismEntryIds === undefined
    ) {
      return notFound();
    }
    if (sourceSegmentIds.length > MAX_SOURCE_SEGMENTS_V1) return blocked(TRACE_SOURCE_OVERFLOW_V1);
    if (riskMechanismEntryIds.length > MAX_MECHANISM_ENTRIES_V1) {
      return blocked(TRACE_MECHANISM_OVERFLOW_V1);
    }

    // 工序与证据定位是正文内允许披露的两个最小引用，其余正文（风险源/因子/事件/关系/置信度）不返回。
    const envelope = StandardizedRiskRecordEnvelopeSchema.safeParse(row.payload);
    if (!envelope.success || envelope.data.riskRecordId !== row.risk_record_id) return notFound();
    const evidenceSourceSegmentId = envelope.data.record.evidenceLocator.sourceSegmentId;
    return {
      kind: "found",
      riskRecordRef: input.riskRecordRef,
      processNodeId: envelope.data.record.processNodeId,
      sourceSegmentIds: [...sourceSegmentIds],
      riskMechanismEntryIds: [...riskMechanismEntryIds],
      // 证据定位只在本记录自身来源段内披露；越界定位不返回，不报错也不伪造。
      ...(sourceSegmentIds.includes(evidenceSourceSegmentId)
        ? { evidenceLocator: { sourceSegmentId: evidenceSourceSegmentId } }
        : {}),
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: row.audit_entry_id, versionId: "v1" },
      },
    };
  }

  /**
   * 当前授权复验（design D-07）：复验身份对（`invocationId` + `branch`）与签发身份必须逐字
   * 相同，复验返回的是当前收窄上下文，冻结引用不能替代它。任何形状不符或异常都按拒绝收口，
   * 不区分"无权"与"不存在"。
   */
  async #verifyCurrentAuthorization(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }): Promise<AuthorizationContextV1 | undefined> {
    if (input.authorization.projectId !== input.projectId) return undefined;
    if (input.authorization.grantedCapabilities.length !== 1) return undefined;
    try {
      const decision = await this.#authorization.verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: input.invocationId,
        projectId: input.projectId,
        branch: input.branch,
        // 读不申请额外范围：复验上下文保持调用方自身成员范围，范围摘要据此与记录冻结摘要对账。
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      });
      const verified = decision.context;
      if (
        verified.projectId !== input.projectId ||
        verified.actorId !== input.authorization.actorId ||
        verified.grantedCapabilities.length !== 1 ||
        verified.grantedCapabilities[0] !== TRACE_READ_CAPABILITY_V1
      ) {
        return undefined;
      }
      return verified;
    } catch {
      return undefined;
    }
  }

  #moduleError(
    value:
      | {
          readonly code: "AUTHORIZATION_DENIED";
          readonly causalRunId: string;
          readonly occurredAt: string;
          readonly authorizationPolicyRef: AuthorizationContextV1["authorizationPolicyRef"];
        }
      | {
          readonly code: "ENTITY_NOT_FOUND";
          readonly causalRunId: string;
          readonly occurredAt: string;
          readonly targetRef: ContractReferenceV1;
        }
      | {
          readonly code: "BUSINESS_BLOCKED";
          readonly causalRunId: string;
          readonly occurredAt: string;
          readonly blockerKind: string;
          readonly blockerRef: ContractReferenceV1;
        },
  ): ModuleErrorV1 {
    const common = {
      stageCode: STAGE_CODE_V1,
      occurredAt: value.occurredAt,
      causalRunId: value.causalRunId,
    };
    switch (value.code) {
      case "AUTHORIZATION_DENIED":
        return ModuleErrorV1Schema.parse({
          ...common,
          code: value.code,
          category: "authorization",
          retryable: false,
          requiredCapability: TRACE_READ_CAPABILITY_V1,
          authorizationPolicyRef: value.authorizationPolicyRef,
        });
      case "ENTITY_NOT_FOUND":
        return ModuleErrorV1Schema.parse({
          ...common,
          code: value.code,
          category: "not-found",
          retryable: false,
          targetRef: value.targetRef,
        });
      case "BUSINESS_BLOCKED":
        return ModuleErrorV1Schema.parse({
          ...common,
          code: value.code,
          category: "business-blocked",
          retryable: false,
          blockerKind: value.blockerKind,
          blockerRef: value.blockerRef,
        });
    }
  }
}

export const createPostgresRiskRecordTraceReader = (
  options: PostgresRiskRecordTraceReaderOptionsV1,
): PostgresRiskRecordTraceReader => new PostgresRiskRecordTraceReader(options);
