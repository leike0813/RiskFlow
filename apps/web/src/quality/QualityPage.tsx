import { useEffect, useState, type ReactNode } from "react";

import {
  QUALITY_EVALUATION_METRIC_CODES_V1,
  QUALITY_EVALUATION_SYNTHETIC_LABEL_V1,
  type ProjectRevisionRefV1,
  type QualityEvaluationMetricCodeV1,
  type QualityEvaluationMetricV1,
  type QualityEvaluationSummaryV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";

import {
  C09HttpError,
  makeSafeHttpError,
  type C09ClientV1,
  type HttpErrorCodeV1,
  type SafeHttpErrorV1,
} from "../api/http.js";
import type { WebRouteContributionV1 } from "../app/routes.js";
import type { PageLoadStateV1 } from "../app/state.js";
import { ListPageShell } from "../shared/page-shells/index.js";
import {
  QUALITY_EVALUATION_QUERY_OPERATION_V1,
  qualityEvaluationListSelector,
  qualityMetricByCode,
  type QualityEvaluationQueryRequestV1,
} from "./operation.js";

/** 页面只持有已解码的有界摘要，不缓存正文、不读数据库或 C04 工件。 */
export type QualitySummaryListViewV1 = readonly QualityEvaluationSummaryV1[];
export type QualityPageStateV1 = PageLoadStateV1<QualitySummaryListViewV1>;

export type QualityPagePropsV1 = Readonly<{
  client: C09ClientV1;
  projectId: string | null;
  projectRevisionRef: ProjectRevisionRefV1 | null;
  spatialScopeRef?: SpatialScopeRefV1 | null;
}>;

/** 指标中文可读名；键为契约枚举，契约新增指标时由 tsc 强制补齐。 */
export const QUALITY_METRIC_LABELS_V1: Readonly<Record<QualityEvaluationMetricCodeV1, string>> =
  Object.freeze({
    accuracy: "准确率",
    precision: "精确率",
    coverage: "覆盖度",
    "source-consistency": "跨来源一致性",
    "grade-match": "等级匹配率",
    "replay-rate": "可重放率",
    "audit-completeness": "审计链完整率",
  });

const metricValueAttribute = (metric: QualityEvaluationMetricV1 | undefined): string =>
  metric !== undefined && metric.status === "computed" && metric.value !== null
    ? String(metric.value)
    : "not-computable";

const MetricValue = ({ metric }: { metric: QualityEvaluationMetricV1 | undefined }): ReactNode => {
  if (metric === undefined || metric.status !== "computed" || metric.value === null)
    return (
      <>
        <span className="quality-metric-value">不可计算</span>
        {metric?.reasonCode === undefined ? null : (
          <code data-quality-metric-reason={metric.reasonCode}>{metric.reasonCode}</code>
        )}
      </>
    );
  return (
    <span className="quality-metric-value">
      {(metric.value * 100).toFixed(1)}%（{metric.numerator}/{metric.denominator}）
    </span>
  );
};

const QualityMetricRow = ({
  summary,
  metricCode,
}: {
  summary: QualityEvaluationSummaryV1;
  metricCode: QualityEvaluationMetricCodeV1;
}): ReactNode => {
  const metric = qualityMetricByCode(summary, metricCode);
  return (
    <span data-quality-metric={metricCode} data-quality-metric-value={metricValueAttribute(metric)}>
      <span className="quality-metric-name">{QUALITY_METRIC_LABELS_V1[metricCode]}</span>
      <MetricValue metric={metric} />
    </span>
  );
};

/** 纯渲染：把已解码摘要映射为视图，7 项指标全渲染，合成样例的固定标记直接可见。 */
export const QualitySummaryList = ({
  summaries,
}: {
  summaries: QualitySummaryListViewV1;
}): ReactNode => (
  <ul className="quality-summary-list">
    {summaries.map((summary) => (
      <li
        key={`${summary.reportArtifactRef.reference.entityId}@${summary.reportArtifactRef.reference.versionId}`}
        data-quality-summary={summary.reportArtifactRef.reference.entityId}
        data-quality-version={summary.reportArtifactRef.reference.versionId}
        data-quality-label={summary.label}
        data-quality-evidence-count={summary.evidenceRefs.length}
      >
        <p className="quality-summary-label">{summary.label}</p>
        <p className="quality-summary-meta">
          {summary.sampleKind === "synthetic" ? (
            <strong data-quality-sample-kind="synthetic">
              {QUALITY_EVALUATION_SYNTHETIC_LABEL_V1}
            </strong>
          ) : (
            <span data-quality-sample-kind="deidentified-real">脱敏真实样例</span>
          )}
          <span className="quality-summary-dataset">
            数据集 {summary.datasetArtifactRef.reference.entityId}
          </span>
          <time dateTime={summary.createdAt}>{summary.createdAt}</time>
        </p>
        <div className="quality-metric-list">
          {QUALITY_EVALUATION_METRIC_CODES_V1.map((metricCode) => (
            <QualityMetricRow key={metricCode} summary={summary} metricCode={metricCode} />
          ))}
        </div>
      </li>
    ))}
  </ul>
);

const emptyMessageFor = (projectRevisionRef: ProjectRevisionRefV1 | null): string =>
  projectRevisionRef === null
    ? "尚未选择项目修订，无法查询质量评估报告"
    : "当前工程修订还没有质量评估报告";

/** 纯渲染：状态到页面骨架，`data-page-state` 与 C10 页面状态取值一致。 */
export const qualityPageView = (
  state: QualityPageStateV1,
  projectRevisionRef: ProjectRevisionRefV1 | null,
): ReactNode => (
  <div data-quality-page="1" data-page-state={state.kind}>
    <ListPageShell
      title="质量评估"
      state={state}
      emptyMessage={emptyMessageFor(projectRevisionRef)}
      table={(summaries: QualitySummaryListViewV1) => <QualitySummaryList summaries={summaries} />}
    />
  </div>
);

let querySequence = 0;

/** 查询标识只用于本次请求的审计关联，不承载业务语义，也不参与授权。 */
const nextQualityQueryId = (projectId: string): string => {
  querySequence += 1;
  return `web-quality-${projectId}-${Date.now().toString(36)}-${querySequence}`;
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly name?: unknown }).name === "AbortError";

/** 服务端把无权、跨工程与不存在统一收口为 NOT_FOUND；会话失效同样不呈现为普通错误。 */
const FORBIDDEN_ERROR_CODES: readonly HttpErrorCodeV1[] = Object.freeze([
  "NOT_FOUND",
  "AUTHENTICATION_REQUIRED",
]);

/** 只保留安全字段：C09 错误已是脱敏载荷，其它异常降级为 TERMINAL_FAILURE。 */
export const safeHttpErrorOf = (error: unknown): SafeHttpErrorV1 =>
  error instanceof C09HttpError ? error.error : makeSafeHttpError({ code: "TERMINAL_FAILURE" });

const stateForFailure = (error: unknown): QualityPageStateV1 =>
  error instanceof C09HttpError && FORBIDDEN_ERROR_CODES.includes(error.error.code)
    ? { kind: "forbidden", requiredCapability: "projection.query" }
    : { kind: "error", error: safeHttpErrorOf(error) };

/**
 * 查询一份项目修订的有界质量摘要。取消（AbortError）返回 null，调用方保持原状态，
 * 让“切换工程”既不落 error 也不闪现上一工程的摘要。
 */
export const loadQualitySummaries = async (input: {
  readonly client: C09ClientV1;
  readonly projectId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly spatialScopeRef?: SpatialScopeRefV1 | null;
  readonly signal: AbortSignal;
}): Promise<QualityPageStateV1 | null> => {
  const spatialScopeRef = input.spatialScopeRef ?? null;
  const request: QualityEvaluationQueryRequestV1 = {
    projectId: input.projectId,
    requestedSpatialScopeRefs: spatialScopeRef === null ? [] : [spatialScopeRef],
    requestedSourceVersionRefs: [],
    queryId: nextQualityQueryId(input.projectId),
    requestedAt: new Date().toISOString(),
    payload: {
      queryType: "quality-evaluation",
      selector: qualityEvaluationListSelector(input.projectRevisionRef),
    },
  };
  try {
    const result = await input.client.submit(
      QUALITY_EVALUATION_QUERY_OPERATION_V1,
      request,
      input.signal,
    );
    const summaries = result.value.qualitySummaries ?? [];
    return summaries.length === 0 ? { kind: "empty" } : { kind: "ready", value: summaries };
  } catch (error) {
    if (input.signal.aborted || isAbortError(error)) return null;
    return stateForFailure(error);
  }
};

export const QualityPage = ({
  client,
  projectId,
  projectRevisionRef,
  spatialScopeRef = null,
}: QualityPagePropsV1): ReactNode => {
  const [state, setState] = useState<QualityPageStateV1>(() =>
    projectId === null || projectRevisionRef === null
      ? { kind: "empty" }
      : { kind: "loading", previous: null },
  );
  const revisionEntityId = projectRevisionRef?.reference.entityId ?? null;
  const revisionVersionId = projectRevisionRef?.reference.versionId ?? null;
  const spatialEntityId = spatialScopeRef?.reference.entityId ?? null;
  const spatialVersionId = spatialScopeRef?.reference.versionId ?? null;
  useEffect(() => {
    // 依赖按修订与空间区段的身份取值（引用对象每次渲染都是新的）。工程或修订一变即取消旧查询，
    // 并先切 loading（previous 固定 null），旧工程的摘要不会短暂留在页面上。
    if (projectId === null || projectRevisionRef === null) {
      setState({ kind: "empty" });
      return undefined;
    }
    const controller = new AbortController();
    setState({ kind: "loading", previous: null });
    void loadQualitySummaries({
      client,
      projectId,
      projectRevisionRef,
      spatialScopeRef,
      signal: controller.signal,
    }).then((next) => {
      if (next !== null) setState(next);
    });
    return () => controller.abort();
  }, [client, projectId, revisionEntityId, revisionVersionId, spatialEntityId, spatialVersionId]);
  return qualityPageView(state, projectRevisionRef);
};

/**
 * 替换 base 的 `/assessment` 贡献：客户端不做授权声明（requiredViewCapability 固定 null），
 * 由服务端按 `projection.query` 判定，页面把拒绝映射为 forbidden。
 * 这里的 render 是不经上下文注入时的独立入口；`App` 的 `routeContent` 会传入实时上下文。
 */
/**
 * C37 D-17：C36 质量页改为 `/assessment/quality` 子路径。
 *
 * `/assessment` 仍是待评估页的 section 根；质量入口不从七项导航直达，
 * 只作为评估区的二级入口，因此这里只改 path，不新增导航项。
 */
export const createQualityAssessmentRouteContribution = (input: {
  readonly client: C09ClientV1;
  readonly projectRevisionRef: ProjectRevisionRefV1 | null;
}): WebRouteContributionV1 =>
  Object.freeze({
    routeId: "assessment.quality",
    path: "/assessment/quality",
    title: "质量评估",
    section: "assessment",
    regions: [{ kind: "list" as const }],
    contextRequirement: "project",
    requiredViewCapability: null,
    render: (): ReactNode => (
      <QualityPage
        client={input.client}
        projectId={input.projectRevisionRef?.reference.entityId ?? null}
        projectRevisionRef={input.projectRevisionRef}
      />
    ),
  });
