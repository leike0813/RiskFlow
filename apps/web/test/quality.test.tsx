import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ProjectRevisionRefV1,
  QualityEvaluationMetricCodeV1,
  QualityEvaluationMetricV1,
  QualityEvaluationSummaryV1,
} from "@riskflow/contracts/ports";

import { createC09Client, type C09Fetch } from "../src/api/http.js";
import { QUALITY_EVALUATION_QUERY_OPERATION_V1 } from "../src/quality/operation.js";
import {
  loadQualitySummaries,
  QualityPage,
  qualityPageView,
  type QualityPageStateV1,
} from "../src/quality/QualityPage.js";

const NOW = "2026-09-23T00:00:00.000Z";
const PROJECT_ID = "project-1";
const REPORT_ID = "quality-report-1";
const REPORT_VERSION = `sha256:${"a".repeat(64)}`;
const REVISION_REF: ProjectRevisionRefV1 = {
  kind: "project-revision",
  reference: { entityId: PROJECT_ID, versionId: "revision-7" },
};

/** 指标顺序故意打乱：页面必须按码取用，而不是照抄载荷顺序。 */
const metrics: readonly QualityEvaluationMetricV1[] = [
  { metricCode: "coverage", numerator: 7, denominator: 10, value: 0.7, status: "computed" },
  { metricCode: "accuracy", numerator: 9, denominator: 10, value: 0.9, status: "computed" },
  {
    metricCode: "replay-rate",
    numerator: 0,
    denominator: 0,
    value: null,
    status: "not-computable",
    reasonCode: "quality-assessment-replay-context-missing",
  },
  {
    metricCode: "audit-completeness",
    numerator: 10,
    denominator: 10,
    value: 1,
    status: "computed",
  },
  { metricCode: "precision", numerator: 8, denominator: 10, value: 0.8, status: "computed" },
  { metricCode: "grade-match", numerator: 5, denominator: 10, value: 0.5, status: "computed" },
  {
    metricCode: "source-consistency",
    numerator: 6,
    denominator: 10,
    value: 0.6,
    status: "computed",
  },
];

const summaries: readonly QualityEvaluationSummaryV1[] = [
  {
    schemaVersion: "1",
    projectId: PROJECT_ID,
    reportArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: REPORT_ID, versionId: REPORT_VERSION },
    },
    datasetArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "quality-dataset-1", versionId: "2030-06-01.1" },
    },
    sampleKind: "synthetic",
    label: "合成样本，待甲方复核",
    metrics,
    evidenceRefs: [
      {
        locator: { sourceSegmentId: "source-segment-1" },
        sourceVersion: { entityId: "source-1", versionId: "v1" },
      },
    ],
    createdAt: NOW,
  },
];

const METRIC_CODES: readonly QualityEvaluationMetricCodeV1[] = [
  "accuracy",
  "precision",
  "coverage",
  "source-consistency",
  "grade-match",
  "replay-rate",
  "audit-completeness",
];

const successBody = (qualitySummaries: readonly QualityEvaluationSummaryV1[]): unknown => ({
  kind: "succeeded",
  result: {
    queryResultRef: { kind: "query-result", reference: { entityId: "query-1", versionId: "1" } },
    qualitySummaries,
  },
});

const notFoundBody = {
  schemaVersion: "1",
  requestId: "request-7",
  code: "NOT_FOUND",
  retryable: false,
  occurredAt: NOW,
  references: [],
};

type CallV1 = Readonly<{ input: RequestInfo | URL; init: RequestInit | undefined }>;

const load = (fetcher: C09Fetch, signal?: AbortSignal): Promise<QualityPageStateV1 | null> =>
  loadQualitySummaries({
    client: createC09Client({ fetcher, operations: [QUALITY_EVALUATION_QUERY_OPERATION_V1] }),
    projectId: PROJECT_ID,
    projectRevisionRef: REVISION_REF,
    signal: signal ?? new AbortController().signal,
  });

describe("C36 质量评估页面", () => {
  it("查询一份合成报告并按 DOM 契约渲染 7 项指标", async () => {
    const calls: CallV1[] = [];
    const fetcher: C09Fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(successBody(summaries)), { status: 200 });
    };
    const state = await load(fetcher);
    expect(state).toEqual({ kind: "ready", value: summaries });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(`/api/v1/projects/${PROJECT_ID}/queries/projection.query`);
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      schemaVersion: "1",
      payload: {
        queryType: "quality-evaluation",
        selector: { mode: "list", projectRevisionRef: REVISION_REF, pageSize: 50 },
      },
    });
    expect(body).not.toHaveProperty("projectId");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();

    const html = renderToStaticMarkup(qualityPageView(state as QualityPageStateV1, REVISION_REF));
    expect(html).toContain('data-quality-page="1"');
    expect(html).toContain('data-page-state="ready"');
    expect(html).toContain(`data-quality-summary="${REPORT_ID}"`);
    expect(html).toContain(`data-quality-version="${REPORT_VERSION}"`);
    expect(html).toContain('data-quality-label="合成样本，待甲方复核"');
    expect(html).toContain('data-quality-evidence-count="1"');
    expect(html).toContain("合成样本，待甲方复核");
    expect((html.match(/data-quality-metric=/g) ?? []).length).toBe(7);
    for (const metricCode of METRIC_CODES)
      expect(html).toContain(`data-quality-metric="${metricCode}"`);
    expect(html).toMatch(/data-quality-metric="accuracy"[^>]*data-quality-metric-value="0\.9"/);
    expect(html).toMatch(
      /data-quality-metric="audit-completeness"[^>]*data-quality-metric-value="1"/,
    );
    expect(html).toContain("准确率");
    expect(html).toContain("审计链完整率");
    expect(html).toMatch(
      /data-quality-metric="replay-rate"[^>]*data-quality-metric-value="not-computable"/,
    );
    expect(html).toContain("不可计算");
    expect(html).toContain("quality-assessment-replay-context-missing");
  });

  it("空列表与服务端拒绝分别呈现 empty 与 forbidden", async () => {
    const empty = await load(
      async () => new Response(JSON.stringify(successBody([])), { status: 200 }),
    );
    expect(empty).toEqual({ kind: "empty" });
    expect(
      renderToStaticMarkup(qualityPageView(empty as QualityPageStateV1, REVISION_REF)),
    ).toContain('data-page-state="empty"');
    expect(renderToStaticMarkup(qualityPageView({ kind: "empty" }, null))).toContain(
      "尚未选择项目修订",
    );

    const calls: CallV1[] = [];
    const fetcher: C09Fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(notFoundBody), { status: 404 });
    };
    const forbidden = await load(fetcher);
    expect(forbidden).toEqual({ kind: "forbidden", requiredCapability: "projection.query" });
    expect(calls).toHaveLength(1);
    const html = renderToStaticMarkup(
      qualityPageView(forbidden as QualityPageStateV1, REVISION_REF),
    );
    expect(html).toContain('data-page-state="forbidden"');
    expect(html).toContain("projection.query");
  });

  it("缺少工程或项目修订时呈现 empty 且不发起请求", () => {
    const calls: CallV1[] = [];
    const fetcher: C09Fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(successBody(summaries)), { status: 200 });
    };
    const client = createC09Client({
      fetcher,
      operations: [QUALITY_EVALUATION_QUERY_OPERATION_V1],
    });
    const missingProject = renderToStaticMarkup(
      <QualityPage client={client} projectId={null} projectRevisionRef={REVISION_REF} />,
    );
    expect(missingProject).toContain('data-quality-page="1"');
    expect(missingProject).toContain('data-page-state="empty"');
    expect(missingProject).not.toContain("data-quality-summary");
    const missingRevision = renderToStaticMarkup(
      <QualityPage client={client} projectId={PROJECT_ID} projectRevisionRef={null} />,
    );
    expect(missingRevision).toContain('data-page-state="empty"');
    expect(calls).toHaveLength(0);

    const loading = renderToStaticMarkup(
      <QualityPage client={client} projectId={PROJECT_ID} projectRevisionRef={REVISION_REF} />,
    );
    expect(loading).toContain('data-page-state="loading"');
    expect(loading).not.toContain("data-quality-summary");
  });

  it("取消查询不进入 error 状态也不请求服务端", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const calls: CallV1[] = [];
    const recorded: C09Fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(successBody(summaries)), { status: 200 });
    };
    await expect(load(recorded, aborted.signal)).resolves.toBeNull();
    expect(calls).toHaveLength(0);

    const controller = new AbortController();
    const inflight: C09Fetch = (_input, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
      return promise;
    };
    const pending = load(inflight, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});
