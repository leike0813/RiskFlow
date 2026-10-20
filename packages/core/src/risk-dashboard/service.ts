/**
 * CH-3 风险总览仪表盘聚合服务（design D-03～D-07）。
 *
 * 纯组合层：按六个来源分别取得当前授权决定，分别调用所属模块的窄读，
 * 再把六份独立结果组合成一次公共读。组合层不读跨域私表、不累计目录页、
 * 不评分、不调用模型，也不产生任何业务事实。
 *
 * 授权：入口资格与来源读权是两件事。入口只证明「可以请求仪表盘」，
 * 六个来源各自按自己的业务分支重新取得当前决定；无权来源只产生该来源的失败，
 * 不影响其它来源，也不把入口能力当成来源能力。
 */
import { z } from "zod";

import {
  ModuleErrorV1Schema,
  RiskDashboardReadResultV1Schema,
  RiskDashboardAssessmentsSourceResultV1Schema,
  RiskDashboardDocumentsSourceResultV1Schema,
  RiskDashboardMonitoringSourceResultV1Schema,
  RiskDashboardReviewsSourceResultV1Schema,
  RiskDashboardRiskRecordsSourceResultV1Schema,
  RiskDashboardWarningsSourceResultV1Schema,
  RiskDashboardTimelineAfterV1Schema,
  RiskDashboardTimestampV1Schema,
  SpatialScopeRefV1Schema,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type RiskDashboardAssessmentsSourceResultV1,
  type RiskDashboardDocumentsSourceResultV1,
  type RiskDashboardMonitoringSourceResultV1,
  type RiskDashboardReadQueryV1,
  type RiskDashboardReadResultV1,
  type RiskDashboardReviewsSourceResultV1,
  type RiskDashboardRiskRecordsSourceResultV1,
  type RiskDashboardSourcesV1,
  type RiskDashboardTimelineAfterV1,
  type RiskDashboardTimelineEventV1,
  type RiskDashboardTimelineSourceKeyV1,
  type RiskDashboardWarningsSourceResultV1,
} from "@riskflow/contracts/ports";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type AuthorizationDecisionV1,
  type BusinessActionAuthorizationInputV1,
} from "../access/index.js";

/** 六个来源各自的业务读分支与对应能力位（design D-03）。 */
const SOURCE_BRANCHES_V1 = {
  riskRecords: "risk-identification.record-catalog",
  assessments: "risk-assessment.read",
  warnings: "warning-response.read",
  reviews: "review-audit.queue-read",
  documents: "engineering-data.source-catalog",
  monitoring: "engineering-data.monitoring-catalog",
} as const satisfies Record<keyof RiskDashboardSourcesV1, ModuleBranchV1>;

const SOURCE_CAPABILITIES_V1 = {
  riskRecords: "risk-identification.read",
  assessments: "risk-assessment.read",
  warnings: "warning-response.read",
  reviews: "review-audit.read",
  documents: "engineering-data.read",
  monitoring: "engineering-data.read",
} as const satisfies Record<keyof RiskDashboardSourcesV1, ModuleCapabilityV1>;

type SourceKey = keyof typeof SOURCE_BRANCHES_V1;

const sourceResultSchemas = {
  riskRecords: RiskDashboardRiskRecordsSourceResultV1Schema,
  assessments: RiskDashboardAssessmentsSourceResultV1Schema,
  warnings: RiskDashboardWarningsSourceResultV1Schema,
  reviews: RiskDashboardReviewsSourceResultV1Schema,
  documents: RiskDashboardDocumentsSourceResultV1Schema,
  monitoring: RiskDashboardMonitoringSourceResultV1Schema,
};

const cursorSchema = z.strictObject({
  v: z.literal(1),
  projectId: z.string().trim().min(1),
  spatialScopeRef: SpatialScopeRefV1Schema.optional(),
  asOf: RiskDashboardTimestampV1Schema,
  after: RiskDashboardTimelineAfterV1Schema.optional(),
});

/** 变化页参与合并的三个来源（design D-06）。 */
const TIMELINE_SOURCES_V1 = [
  "assessments",
  "riskRecords",
  "warnings",
] as const satisfies readonly RiskDashboardTimelineSourceKeyV1[];

/** 变化页默认条数与上限。 */
const TIMELINE_PAGE_SIZE_DEFAULT_V1 = 20;
const TIMELINE_PAGE_SIZE_MAX_V1 = 50;

/** 游标载荷：版本、工程、空间、上界与续页位置（design D-06）。 */
export interface RiskDashboardCursorV1 {
  readonly v: 1;
  readonly projectId: string;
  readonly spatialScopeRef?: {
    readonly kind: "spatial-scope";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly asOf: string;
  readonly after?: {
    readonly recordedAt: string;
    readonly source: RiskDashboardTimelineSourceKeyV1;
    readonly entityId: string;
    readonly versionId: string;
  };
}

/** 六位小数 UTC 时间文本：字符串序与时间序一致，可直接用于游标比较。 */
export const dashboardTimestampV1 = (value: Date): string => {
  const iso = value.toISOString();
  return `${iso.slice(0, 19)}.${iso.slice(20, 23)}000Z`;
};

const encodeCursorV1 = (cursor: RiskDashboardCursorV1): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

/** 游标解码：工程、空间与上界不一致一律拒绝，位置必须落在上界之内。 */
const decodeCursorV1 = (
  encoded: string | undefined,
  projectId: string,
  spatialScopeRef: RiskDashboardCursorV1["spatialScopeRef"],
): RiskDashboardCursorV1 | undefined => {
  if (encoded === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const decoded = cursorSchema.safeParse(parsed);
  if (!decoded.success) return undefined;
  const value = decoded.data;
  if (value.v !== 1 || value.projectId !== projectId) return undefined;
  const cursorScope = value.spatialScopeRef;
  if (cursorScope === undefined) {
    if (spatialScopeRef !== undefined) return undefined;
  } else if (
    spatialScopeRef === undefined ||
    cursorScope.reference?.entityId !== spatialScopeRef.reference.entityId ||
    cursorScope.reference?.versionId !== spatialScopeRef.reference.versionId
  ) {
    return undefined;
  }
  if (typeof value.asOf !== "string") return undefined;
  const after = value.after;
  if (after !== undefined) {
    if (!TIMELINE_SOURCES_V1.includes(after.source)) return undefined;
    if (after.recordedAt > value.asOf) return undefined;
  }
  return {
    v: 1,
    projectId,
    ...(spatialScopeRef === undefined ? {} : { spatialScopeRef }),
    asOf: value.asOf,
    ...(after === undefined ? {} : { after }),
  };
};

/** 与 PostgreSQL COLLATE "C" 的 UTF-8 字符序一致，不依赖部署 locale。 */
const compareIdentifiers = (left: string, right: string): number => {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex)!;
    const rightPoint = right.codePointAt(rightIndex)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
};

/** 事件全序：登记时刻降序，来源、主体与版本升序（design D-06）。 */
const compareEventsV1 = (
  left: RiskDashboardTimelineEventV1,
  right: RiskDashboardTimelineEventV1,
): number => {
  if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? 1 : -1;
  if (left.source !== right.source) return left.source < right.source ? -1 : 1;
  const leftEntity = left.subjectRef.reference.entityId;
  const rightEntity = right.subjectRef.reference.entityId;
  if (leftEntity !== rightEntity) return compareIdentifiers(leftEntity, rightEntity);
  const leftVersion = left.subjectRef.reference.versionId;
  const rightVersion = right.subjectRef.reference.versionId;
  if (leftVersion !== rightVersion) return compareIdentifiers(leftVersion, rightVersion);
  return 0;
};

/** 来源无权的稳定错误：不区分「无权」与「不存在」，也不附带任何来源事实。 */
const deniedErrorV1 = (source: SourceKey, queryId: string, occurredAt: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: SOURCE_CAPABILITIES_V1[source],
    authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    stageCode: "risk-dashboard.source-authorization",
    occurredAt,
    causalRunId: queryId,
  });

/** 单个来源的读取结果：成功给出统计与可选事件，失败只给安全错误。 */
type SourceOutcomeV1<T extends { readonly kind: "ready" | "failed" }> =
  T | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

/** 变化页合并结果（design D-02、D-06）。 */
interface MergedTimelineV1 {
  readonly asOf: string;
  readonly items: readonly RiskDashboardTimelineEventV1[];
  readonly sources: Record<
    RiskDashboardTimelineSourceKeyV1,
    { readonly kind: "ready" } | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
  readonly nextCursor?: string;
  readonly retryCursor?: string;
}

/**
 * 变化页合并：三个来源各自给出自己的有界候选与状态；中央按全序合并后取前 pageSize 条。
 *
 * 任一参与来源失败时不出 nextCursor，而给出指向本页原起点的 retryCursor：
 * 重试沿同一上界重放，不推进成功来源，因此不遗漏失败来源的事实。
 */
const mergeTimelineV1 = (
  inputs: readonly {
    readonly source: RiskDashboardTimelineSourceKeyV1;
    readonly result: SourceOutcomeV1<{
      readonly kind: "ready";
      readonly events?: readonly RiskDashboardTimelineEventV1[];
    }>;
  }[],
  context: {
    readonly asOf: string;
    readonly pageSize: number;
    readonly after: RiskDashboardTimelineAfterV1 | undefined;
    readonly projectId: string;
    readonly spatialScopeRef: RiskDashboardCursorV1["spatialScopeRef"];
  },
): MergedTimelineV1 => {
  const sources: MergedTimelineV1["sources"] = {
    assessments: { kind: "ready" },
    riskRecords: { kind: "ready" },
    warnings: { kind: "ready" },
  };
  const candidates: RiskDashboardTimelineEventV1[] = [];
  let incomplete = false;
  for (const input of inputs) {
    if (input.result.kind === "failed") {
      // 撤权来源不参与合并，也不阻断续页；技术失败才使本页不完整。
      if (input.result.error.code !== "AUTHORIZATION_DENIED") incomplete = true;
      sources[input.source] = { kind: "failed", error: input.result.error };
      continue;
    }
    candidates.push(...(input.result.events ?? []));
  }
  candidates.sort(compareEventsV1);
  const items = candidates.slice(0, context.pageSize);
  const hasMore = candidates.length > context.pageSize;
  const cursorBase = {
    v: 1 as const,
    projectId: context.projectId,
    ...(context.spatialScopeRef === undefined ? {} : { spatialScopeRef: context.spatialScopeRef }),
    asOf: context.asOf,
  };
  if (incomplete) {
    return {
      asOf: context.asOf,
      items,
      sources,
      retryCursor: encodeCursorV1(
        context.after === undefined ? cursorBase : { ...cursorBase, after: context.after },
      ),
    };
  }
  const last = items[items.length - 1];
  return {
    asOf: context.asOf,
    items,
    sources,
    ...(hasMore && last !== undefined
      ? {
          nextCursor: encodeCursorV1({
            ...cursorBase,
            after: {
              recordedAt: last.recordedAt,
              source: last.source,
              entityId: last.subjectRef.reference.entityId,
              versionId: last.subjectRef.reference.versionId,
            },
          }),
        }
      : {}),
  };
};

export interface RiskDashboardReadServiceOptionsV1 {
  /** 六个来源的窄读实现；由所属模块提供，组合层只调用其公开窄读方法。 */
  readonly sources: RiskDashboardSourcesV1;
  /** 当前授权决定：按来源分支单独签发，不复用入口能力。 */
  readonly authorizeBusinessAction: (
    input: BusinessActionAuthorizationInputV1,
  ) => Promise<AuthorizationDecisionV1>;
  readonly now?: () => Date;
}

/** 仪表盘公共读端口：一次返回完整有限摘要与一页变化。 */
export interface RiskDashboardReadPortV1 {
  read(query: RiskDashboardReadQueryV1): Promise<RiskDashboardReadResultV1>;
}

export const createRiskDashboardReadService = (
  options: RiskDashboardReadServiceOptionsV1,
): RiskDashboardReadPortV1 => {
  const now = options.now ?? (() => new Date());

  /**
   * 来源授权：按该来源的业务分支单独取得当前决定；无权只影响该来源。
   * 授权判定本身的技术故障按 transient 收口，不 catch 成拒权（design D-07）。
   */
  const authorizeSource = async (
    source: SourceKey,
    query: RiskDashboardReadQueryV1,
  ): Promise<
    | { readonly kind: "granted"; readonly decision: AuthorizationDecisionV1 }
    | { readonly kind: "denied" }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > => {
    const requestedSpatialScopeRefs =
      source === "reviews" || query.payload.spatialScopeRef === undefined
        ? []
        : [query.payload.spatialScopeRef];
    try {
      const decision = await options.authorizeBusinessAction({
        actorId: query.actorId,
        projectId: query.projectId,
        capability: SOURCE_CAPABILITIES_V1[source],
        branch: SOURCE_BRANCHES_V1[source],
        invocationId: `${query.queryId}-${source}`,
        requestedSpatialScopeRefs,
        requestedSourceVersionRefs: [],
      });
      if (
        decision.redacted ||
        decision.context.actorId !== query.actorId ||
        decision.context.projectId !== query.projectId ||
        !decision.context.grantedCapabilities.includes(SOURCE_CAPABILITIES_V1[source])
      ) {
        return { kind: "denied" };
      }
      return { kind: "granted", decision };
    } catch (error) {
      if (
        error instanceof AccessServiceError &&
        error.details.code !== "ACCESS_TRANSIENT_FAILURE" &&
        error.details.code !== "ACCESS_TERMINAL_FAILURE"
      ) {
        return { kind: "denied" };
      }
      return {
        kind: "failed",
        error: ModuleErrorV1Schema.parse({
          code: "TRANSIENT_FAILURE",
          category: "technical",
          retryable: true,
          attempt: 1,
          retryPolicyRef: { entityId: "read-retry-policy", versionId: "v1" },
          diagnosticRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "risk-dashboard-authorization", versionId: "v1" },
          },
          stageCode: "risk-dashboard.source-authorization",
          occurredAt: dashboardTimestampV1(now()),
          causalRunId: query.queryId,
        }),
      };
    }
  };

  return {
    read: async (query: RiskDashboardReadQueryV1): Promise<RiskDashboardReadResultV1> => {
      const occurredAt = dashboardTimestampV1(now());
      const pageSize = Math.min(
        query.payload.timelinePageSize ?? TIMELINE_PAGE_SIZE_DEFAULT_V1,
        TIMELINE_PAGE_SIZE_MAX_V1,
      );
      const cursor = decodeCursorV1(
        query.payload.timelineCursor,
        query.projectId,
        query.payload.spatialScopeRef,
      );
      if (query.payload.timelineCursor !== undefined && cursor === undefined) {
        return RiskDashboardReadResultV1Schema.parse({
          kind: "failed",
          error: ModuleErrorV1Schema.parse({
            code: "UNSUPPORTED_CONTRACT",
            category: "technical",
            retryable: false,
            schemaVersion: "1",
            stageCode: "risk-dashboard.cursor",
            occurredAt,
            causalRunId: query.queryId,
          }),
        });
      }
      const asOf = cursor?.asOf ?? occurredAt;
      const after = cursor?.after;
      const scope = {
        kind: "authorized-spaces" as const,
        ...(query.payload.spatialScopeRef === undefined
          ? {}
          : { spatialScopeRef: query.payload.spatialScopeRef }),
      };
      const base = {
        queryId: query.queryId,
        projectId: query.projectId,
        actorId: query.actorId,
        requestedAt: query.requestedAt,
        ...(query.payload.spatialScopeRef === undefined
          ? {}
          : { spatialScopeRef: query.payload.spatialScopeRef }),
      };
      const timelineRequest = { asOf, pageSize, ...(after === undefined ? {} : { after }) };

      const readOne = async <T extends { readonly kind: "ready" | "failed" }>(
        source: SourceKey,
        invoke: (decision: AuthorizationDecisionV1) => Promise<T>,
      ): Promise<SourceOutcomeV1<T>> => {
        const authorization = await authorizeSource(source, query);
        if (authorization.kind === "denied") {
          return { kind: "failed", error: deniedErrorV1(source, query.queryId, occurredAt) };
        }
        if (authorization.kind === "failed") {
          return { kind: "failed", error: authorization.error };
        }
        try {
          const reader = options.sources[source];
          const method =
            source === "documents"
              ? "readSourceDashboard"
              : source === "monitoring"
                ? "readMonitoringDashboard"
                : "readDashboard";
          if (
            reader === undefined ||
            reader === null ||
            typeof Reflect.get(reader, method) !== "function"
          ) {
            return {
              kind: "failed",
              error: ModuleErrorV1Schema.parse({
                code: "BUSINESS_BLOCKED",
                category: "business-blocked",
                retryable: false,
                blockerKind: "dashboard-source-not-injected",
                blockerRef: {
                  kind: "query-result",
                  reference: { entityId: query.queryId, versionId: "1" },
                },
                stageCode: "risk-dashboard.source-read",
                occurredAt,
                causalRunId: query.queryId,
              }),
            };
          }
          const output = await invoke(authorization.decision);
          const result = sourceResultSchemas[source].safeParse(output);
          if (result.success) return output;
          return {
            kind: "failed",
            error: ModuleErrorV1Schema.parse({
              code: "UNSUPPORTED_CONTRACT",
              category: "technical",
              retryable: false,
              schemaVersion: "1",
              stageCode: "risk-dashboard.source-result",
              occurredAt,
              causalRunId: query.queryId,
            }),
          };
        } catch {
          return {
            kind: "failed",
            error: ModuleErrorV1Schema.parse({
              code: "TRANSIENT_FAILURE",
              category: "technical",
              retryable: true,
              attempt: 1,
              retryPolicyRef: { entityId: "read-retry-policy", versionId: "v1" },
              diagnosticRef: {
                kind: "diagnostic-artifact",
                reference: { entityId: "risk-dashboard-source", versionId: "v1" },
              },
              stageCode: "risk-dashboard.source-read",
              occurredAt,
              causalRunId: query.queryId,
            }),
          };
        }
      };

      const [riskRecords, assessments, warnings, reviews, documents, monitoring] =
        await Promise.all([
          readOne<RiskDashboardRiskRecordsSourceResultV1>("riskRecords", async (decision) =>
            options.sources.riskRecords.readDashboard({
              ...base,
              authorization: decision.context,
              timeline: timelineRequest,
            }),
          ),
          readOne<RiskDashboardAssessmentsSourceResultV1>("assessments", async (decision) =>
            options.sources.assessments.readDashboard({
              ...base,
              authorization: decision.context,
              timeline: timelineRequest,
            }),
          ),
          readOne<RiskDashboardWarningsSourceResultV1>("warnings", async (decision) =>
            options.sources.warnings.readDashboard({
              ...base,
              authorization: decision.context,
              timeline: timelineRequest,
            }),
          ),
          readOne<RiskDashboardReviewsSourceResultV1>("reviews", async (decision) =>
            options.sources.reviews.readDashboard({ ...base, authorization: decision.context }),
          ),
          readOne<RiskDashboardDocumentsSourceResultV1>("documents", async (decision) =>
            options.sources.documents.readSourceDashboard({
              ...base,
              authorization: decision.context,
            }),
          ),
          readOne<RiskDashboardMonitoringSourceResultV1>("monitoring", async (decision) =>
            options.sources.monitoring.readMonitoringDashboard({
              ...base,
              authorization: decision.context,
            }),
          ),
        ]);

      const summaries = {
        riskRecords:
          riskRecords.kind === "failed"
            ? { kind: "failed" as const, error: riskRecords.error }
            : {
                kind: "ready" as const,
                asOf: riskRecords.asOf,
                scope,
                data: riskRecords.data,
              },
        assessments:
          assessments.kind === "failed"
            ? { kind: "failed" as const, error: assessments.error }
            : {
                kind: "ready" as const,
                asOf: assessments.asOf,
                scope,
                data: assessments.data,
              },
        warnings:
          warnings.kind === "failed"
            ? { kind: "failed" as const, error: warnings.error }
            : {
                kind: "ready" as const,
                asOf: warnings.asOf,
                scope,
                data: warnings.data,
              },
        // 复核是工程级队列，不受总览空间筛选影响。
        reviews:
          reviews.kind === "failed"
            ? { kind: "failed" as const, error: reviews.error }
            : {
                kind: "ready" as const,
                asOf: reviews.asOf,
                scope: { kind: "project" as const },
                data: reviews.data,
              },
        documents:
          documents.kind === "failed"
            ? { kind: "failed" as const, error: documents.error }
            : {
                kind: "ready" as const,
                asOf: documents.asOf,
                scope,
                data: documents.data,
              },
        monitoring:
          monitoring.kind === "failed"
            ? { kind: "failed" as const, error: monitoring.error }
            : {
                kind: "ready" as const,
                asOf: monitoring.asOf,
                scope,
                data: monitoring.data,
              },
      };

      const timeline = mergeTimelineV1(
        [
          { source: "riskRecords", result: riskRecords },
          { source: "assessments", result: assessments },
          { source: "warnings", result: warnings },
        ],
        {
          asOf,
          pageSize,
          after,
          projectId: query.projectId,
          spatialScopeRef: query.payload.spatialScopeRef,
        },
      );

      return RiskDashboardReadResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "risk-dashboard",
          schemaVersion: "1",
          projectId: query.projectId,
          ...(query.payload.spatialScopeRef === undefined
            ? {}
            : { spatialScopeRef: query.payload.spatialScopeRef }),
          summaries,
          timeline,
        },
      });
    },
  };
};
