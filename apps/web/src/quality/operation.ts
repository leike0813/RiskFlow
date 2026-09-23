import {
  ProjectionQueryResultV1Schema,
  QualityEvaluationSummaryV1Schema,
  type ProjectRevisionRefV1,
  type ProjectionQuerySuccessV1,
  type QualityEvaluationMetricCodeV1,
  type QualityEvaluationMetricV1,
  type QualityEvaluationQuerySelectorV1,
  type QualityEvaluationSummaryV1,
} from "@riskflow/contracts/ports";

import {
  C09HttpError,
  HTTP_SCHEMA_VERSION_V1,
  createQueryOperation,
  makeSafeHttpError,
  type C09QueryRequestV1,
} from "../api/http.js";

/** 一页摘要上限：与契约 `pageSize` 上界一致，页面一次只取最新的有界列表。 */
export const QUALITY_EVALUATION_PAGE_SIZE_V1 = 50;

/** C36 页面只发这一种投影查询；报告正文与数据集正文仍留在 C04 工件与拥有方。 */
export type QualityEvaluationQueryRequestV1 = C09QueryRequestV1<{
  queryType: "quality-evaluation";
  selector: QualityEvaluationQuerySelectorV1;
}>;

/**
 * 只把 `succeeded` 的结果交给页面：`failed` 与非法包体一律按契约不符处理。
 * `ProjectionQueryResultV1Schema` 已用 strictObject 校验 `qualitySummaries`，此处仍按本模块
 * 边界逐项解析一次，缺字段或多余字段都不接受。
 */
const decodeQualityEvaluation = (response: unknown): ProjectionQuerySuccessV1 => {
  const parsed = ProjectionQueryResultV1Schema.safeParse(response);
  if (!parsed.success || parsed.data.kind !== "succeeded")
    throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
  const { result } = parsed.data;
  if (result.qualitySummaries === undefined) return result;
  return {
    ...result,
    qualitySummaries: result.qualitySummaries.map((summary) =>
      QualityEvaluationSummaryV1Schema.parse(summary),
    ),
  };
};

/**
 * C36 质量评估查询：branch 固定 `projection.query`，路径由 C09 客户端派生为
 * `/api/v1/projects/:projectId/queries/projection.query`；授权由服务端按能力判定。
 */
export const QUALITY_EVALUATION_QUERY_OPERATION_V1 = createQueryOperation<
  QualityEvaluationQueryRequestV1,
  ProjectionQuerySuccessV1
>({
  operationId: "quality-evaluation.query",
  branch: "projection.query",
  encode: (request) => ({ schemaVersion: HTTP_SCHEMA_VERSION_V1, ...request }),
  decode: decodeQualityEvaluation,
});

/** 有界列表选择器：只按项目修订取最新一页，不接受任意过滤与超大页。 */
export const qualityEvaluationListSelector = (
  projectRevisionRef: ProjectRevisionRefV1,
): QualityEvaluationQuerySelectorV1 => ({
  mode: "list",
  projectRevisionRef,
  pageSize: QUALITY_EVALUATION_PAGE_SIZE_V1,
});

/** 指标按码取用；契约要求 7 项齐全，取不到时返回 undefined，由调用方呈现缺口。 */
export const qualityMetricByCode = (
  summary: QualityEvaluationSummaryV1,
  metricCode: QualityEvaluationMetricCodeV1,
): QualityEvaluationMetricV1 | undefined =>
  summary.metrics.find((metric) => metric.metricCode === metricCode);
