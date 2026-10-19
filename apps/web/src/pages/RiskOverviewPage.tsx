import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type {
  ModuleErrorV1,
  RiskDashboardAssessmentsDataV1,
  RiskDashboardDocumentsDataV1,
  RiskDashboardMatrixLevelCountV1,
  RiskDashboardMonitoringDataV1,
  RiskDashboardReadSuccessV1,
  RiskDashboardReviewsDataV1,
  RiskDashboardRiskRecordsDataV1,
  RiskDashboardScopeV1,
  RiskDashboardTimelineEventV1,
  RiskDashboardTimelineV1,
  RiskDashboardWarningsDataV1,
} from "@riskflow/contracts/ports";

import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { PageStateView } from "../components/PageStateView";
import { Timeline, type TimelineItem } from "../components/Timeline";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import { readRiskDashboard } from "../api/operations";
import { PageRegions, type PageRegionV1 } from "../shared/page-shells/index.js";
import { AssessmentLevelDonut, ProcessDistributionBars } from "./RiskOverviewCharts";
import { OverviewRunsSection } from "./OverviewRunsSection";
import "./RiskOverviewPage.css";
import "./assessment-response.css";

/** 六个来源各自成功或失败；失败不折算成零，也不借另一来源冒充完整态势。 */
type SourceSummaryV1<T> =
  | {
      readonly kind: "ready";
      readonly asOf: string;
      readonly scope: RiskDashboardScopeV1;
      readonly data: T;
    }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

function SourceCard<T>({
  title,
  note,
  summary,
  retry,
  children,
}: {
  title: string;
  note?: string;
  summary: SourceSummaryV1<T>;
  retry: () => void;
  children: (data: T, asOf: string) => ReactNode;
}) {
  const scopeText =
    summary.kind === "failed"
      ? ""
      : summary.scope.kind === "project"
        ? "工程级口径"
        : summary.scope.spatialScopeRef === undefined
          ? "授权空间合计"
          : `空间 ${summary.scope.spatialScopeRef.reference.entityId}`;
  return (
    <Card title={title} extra={<span className="ov-source-scope">{note ?? scopeText}</span>}>
      {summary.kind === "ready" ? (
        <>
          {children(summary.data, summary.asOf)}
          <p className="ov-asof mono">asOf {summary.asOf.slice(0, 19).replace("T", " ")}</p>
        </>
      ) : (
        <div className="ov-source-failed" data-source-state="failed" role="alert">
          <p>该来源当前不可用（{summary.error.code}）。</p>
          <button type="button" className="ar-chip" onClick={retry}>
            重试
          </button>
        </div>
      )}
    </Card>
  );
}

interface MatrixGroupV1 {
  readonly key: string;
  readonly entityId: string;
  readonly versionId: string;
  readonly levels: readonly RiskDashboardMatrixLevelCountV1[];
}

/** 按冻结矩阵精确版本分组；不同矩阵的同名等级不混画。 */
const matrixGroupsFor = (data: RiskDashboardAssessmentsDataV1): MatrixGroupV1[] => {
  const groups = new Map<string, MatrixGroupV1>();
  for (const entry of data.matrixLevelCounts) {
    const { entityId, versionId } = entry.riskMatrixRef;
    const key = `${entityId}@${versionId}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { key, entityId, versionId, levels: [entry] });
    } else {
      groups.set(key, { ...group, levels: [...group.levels, entry] });
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.entityId.localeCompare(right.entityId) || left.versionId.localeCompare(right.versionId),
  );
};

const TIMELINE_SOURCES = ["riskRecords", "assessments", "warnings"] as const;
const TIMELINE_SOURCE_LABEL: Record<(typeof TIMELINE_SOURCES)[number], string> = {
  riskRecords: "风险记录",
  assessments: "评估记录",
  warnings: "预警记录",
};

const displayTime = (value: string): string => value.slice(0, 19).replace("T", " ");

/** 变更计数条：单位由调用方写明，页面不把不同口径的计数相加。 */
function MetricLine({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: number;
  unit: string;
  note?: string;
}) {
  return (
    <div className="ov-metric-line">
      <span className="ov-metric-label">
        {label}
        {note === undefined ? null : <span className="ov-metric-note">{note}</span>}
      </span>
      <span className="mono ov-metric-value">
        {value} {unit}
      </span>
    </div>
  );
}

/**
 * 风险态势总览（design D-09、D-10）。
 *
 * 单次仪表盘读面提供六个来源的有限摘要与一页变化：每个来源独立呈现成功或失败，
 * 失败不折算成零；历史运行是独立查询区，不以仪表盘成功为前提。
 */
export default function RiskOverviewPage() {
  const { selector, context: webContext } = useEngineering();
  const projectPath = useProjectPath();
  const [searchParams] = useSearchParams();
  const runsHeading = useRef<HTMLHeadingElement>(null);

  const spatialScopeRef = webContext.spatialScopeRef;
  const scopeKey =
    spatialScopeRef === null
      ? "all"
      : `${spatialScopeRef.reference.entityId}@${spatialScopeRef.reference.versionId}`;
  const pageKey = `${selector.projectId ?? ""}|${scopeKey}`;

  // 分页位置绑定工程与空间：上下文一变即丢弃旧游标，迟到响应由 usePageQuery 代次拦住。
  const [paging, setPaging] = useState<{ readonly key: string; readonly cursor?: string }>();
  const timelineCursor = paging?.key === pageKey ? paging.cursor : undefined;
  const [matrixChoice, setMatrixChoice] = useState<string | null>(null);

  const dashboard = usePageQuery<RiskDashboardReadSuccessV1>(
    (projectId, signal) =>
      readRiskDashboard(
        projectId,
        {
          ...(spatialScopeRef === null ? {} : { spatialScopeRef }),
          ...(timelineCursor === undefined ? {} : { timelineCursor }),
        },
        signal,
      ),
    [scopeKey, timelineCursor],
  );

  const tab = searchParams.get("tab");
  useEffect(() => {
    if (tab !== "runs") return;
    const heading = runsHeading.current;
    if (heading === null) return;
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  }, [tab]);

  const eventLink = (event: RiskDashboardTimelineEventV1): string => {
    const { entityId, versionId } = event.subjectRef.reference;
    switch (event.source) {
      case "riskRecords":
        return projectPath(`/identification/records/${encodeURIComponent(entityId)}`);
      case "assessments":
        return projectPath(
          `/assessment/records/${encodeURIComponent(entityId)}?version=${encodeURIComponent(versionId)}`,
        );
      case "warnings":
        return projectPath(
          `/warnings/${encodeURIComponent(entityId)}?version=${encodeURIComponent(versionId)}`,
        );
    }
  };

  const timelineItems = (timeline: RiskDashboardTimelineV1): TimelineItem[] =>
    timeline.items.map((event) => ({
      time: displayTime(event.recordedAt),
      title: (
        <>
          <Link to={eventLink(event)}>{TIMELINE_SOURCE_LABEL[event.source]}</Link>
          <span className="mono ov-event-ref">
            {event.subjectRef.reference.entityId} · {event.subjectRef.reference.versionId}
          </span>
        </>
      ),
    }));

  const regionsFor = (value: RiskDashboardReadSuccessV1): readonly PageRegionV1<null>[] => {
    const { summaries, timeline } = value;
    const incomplete = TIMELINE_SOURCES.some(
      (source) => timeline.sources[source].kind === "failed",
    );

    return [
      {
        descriptor: { key: "assessment-levels", kind: "chart", variant: "donut" },
        content: (
          <SourceCard title="评估等级分布" summary={summaries.assessments} retry={dashboard.retry}>
            {(data: RiskDashboardAssessmentsDataV1) => {
              const groups = matrixGroupsFor(data);
              const selected = groups.find((group) => group.key === matrixChoice) ?? groups[0];
              return (
                <>
                  {selected !== undefined && (
                    <div className="ov-chart-toolbar">
                      <label>
                        冻结矩阵版本
                        <select
                          value={selected.key}
                          onChange={(event) => setMatrixChoice(event.currentTarget.value)}
                        >
                          {groups.map((group) => (
                            <option key={group.key} value={group.key}>
                              {group.entityId}@{group.versionId}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  <AssessmentLevelDonut
                    levels={
                      selected === undefined
                        ? []
                        : selected.levels.map((level) => ({
                            levelId: level.riskLevelId,
                            count: level.count,
                          }))
                    }
                  />
                  <p className="ov-note">
                    已入库评估记录版本 {data.recordedAssessmentCount}{" "}
                    条；一次初评与一次重评分别是两个记录版本。
                  </p>
                </>
              );
            }}
          </SourceCard>
        ),
      },
      {
        descriptor: { key: "process-distribution", kind: "chart", variant: "hbars" },
        content: (
          <SourceCard
            title="工序风险记录分布"
            summary={summaries.riskRecords}
            retry={dashboard.retry}
          >
            {(data: RiskDashboardRiskRecordsDataV1) => (
              <>
                <ProcessDistributionBars
                  processes={data.processCounts.map((entry) => ({
                    processNodeId: entry.processNodeId,
                    count: entry.count,
                  }))}
                />
                <p className="ov-note">
                  已入库风险记录版本 {data.recordedVersionCount} 条；工序按 processNodeId 统计。
                </p>
              </>
            )}
          </SourceCard>
        ),
      },
      {
        descriptor: { key: "change-timeline", kind: "timeline" },
        content: (
          <Card title="变化时间线" extra={<span>按登记时间倒序 · 非现场发生时序</span>}>
            {timeline.items.length === 0 ? (
              <p className="ov-note">当前统计范围内暂无已登记的记录变化。</p>
            ) : (
              <Timeline items={timelineItems(timeline)} />
            )}
            <ul className="ov-source-status" aria-label="时间线来源状态">
              {TIMELINE_SOURCES.map((source) => {
                const status = timeline.sources[source];
                return (
                  <li key={source}>
                    <span>{TIMELINE_SOURCE_LABEL[source]}</span>
                    <span data-timeline-source-state={status.kind}>
                      {status.kind === "ready" ? "已就绪" : `不可用（${status.error.code}）`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {incomplete ? (
              <p className="ov-note">
                本页来源不完整，重试将从本页起点重新读取。
                <button type="button" className="ar-chip" onClick={dashboard.retry}>
                  重试本页
                </button>
              </p>
            ) : (
              (() => {
                const nextCursor = timeline.nextCursor;
                if (nextCursor === undefined) return null;
                return (
                  <button
                    type="button"
                    className="ar-chip"
                    onClick={() => setPaging({ key: pageKey, cursor: nextCursor })}
                  >
                    继续读取更早变化
                  </button>
                );
              })()
            )}
          </Card>
        ),
      },
      {
        descriptor: { key: "pending-summary", kind: "detail" },
        content: (
          <div className="ov-source-grid">
            <SourceCard
              title="待复核"
              note="工程级口径 · 含 stale pending"
              summary={summaries.reviews}
              retry={dashboard.retry}
            >
              {(data: RiskDashboardReviewsDataV1) => (
                <>
                  <MetricLine label="待决定复核任务" value={data.pendingCount} unit="项" />
                  <ul className="ov-status-list">
                    {data.reviewTypeCounts.map((entry) => (
                      <li key={entry.reviewType}>
                        <span className="mono">{entry.reviewType}</span>
                        <span className="mono">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="ov-note">
                    工程级待决定口径，包含已过期但仍待决定的复核；已过期不等于已决定，也不受空间筛选。
                  </p>
                </>
              )}
            </SourceCard>
            <SourceCard
              title="未确认预警"
              note="按正式确认事实"
              summary={summaries.warnings}
              retry={dashboard.retry}
            >
              {(data: RiskDashboardWarningsDataV1) => (
                <>
                  <MetricLine
                    label="尚未确认预警"
                    value={data.unacknowledgedWarningCount}
                    unit="项"
                  />
                  <ul className="ov-status-list">
                    {data.unacknowledgedLevelCounts.map((entry) => (
                      <li key={entry.warningLevel}>
                        <span className="mono">{entry.warningLevel}</span>
                        <span className="mono">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="ov-note">
                    仅未确认预警参与按等级待决口径；全部预警等级分布不作该分母。
                  </p>
                </>
              )}
            </SourceCard>
            <SourceCard
              title="开放处置任务"
              note="开放任务口径"
              summary={summaries.warnings}
              retry={dashboard.retry}
            >
              {(data: RiskDashboardWarningsDataV1) => (
                <>
                  <MetricLine label="开放处置任务" value={data.openTaskCount} unit="项" />
                  <MetricLine
                    label="开放任务关联预警"
                    value={data.openTaskWarningCount}
                    unit="项"
                    note="去重"
                  />
                  <p className="ov-note">
                    任务开放不等于预警未确认，也不与复核、预警数量相加成风险事件总数。
                  </p>
                </>
              )}
            </SourceCard>
          </div>
        ),
      },
      {
        descriptor: { key: "source-access", kind: "detail" },
        content: (
          <div className="ov-source-row">
            <SourceCard title="资料接入" summary={summaries.documents} retry={dashboard.retry}>
              {(data: RiskDashboardDocumentsDataV1) => (
                <>
                  <MetricLine label="目录可见资料版本" value={data.sourceVersionCount} unit="个" />
                  <ul className="ov-status-list" aria-label="解析状态">
                    {data.parseStatusCounts.map((entry) => (
                      <li key={entry.parseStatus}>
                        <span className="mono">{entry.parseStatus}</span>
                        <span className="mono">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="ov-status-list" aria-label="清洗状态">
                    {data.cleaningStatusCounts.map((entry) => (
                      <li
                        key={
                          entry.status.kind === "not-registered"
                            ? "not-registered"
                            : `availability:${entry.status.availability}`
                        }
                      >
                        <span className="mono">
                          {entry.status.kind === "not-registered"
                            ? "not-registered"
                            : entry.status.availability}
                        </span>
                        <span className="mono">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="ov-note">单位是目录可见资料版本；未登记清洗结果单独计数。</p>
                </>
              )}
            </SourceCard>
            <SourceCard title="监测接入" summary={summaries.monitoring} retry={dashboard.retry}>
              {(data: RiskDashboardMonitoringDataV1) => (
                <>
                  <MetricLine label="可见监测序列" value={data.seriesCount} unit="条" />
                  <MetricLine label="至少一个批次" value={data.seriesWithBatchCount} unit="条" />
                  <MetricLine
                    label="至少一个冻结快照"
                    value={data.seriesWithSnapshotCount}
                    unit="条"
                  />
                  <p className="ov-note">单位是可见监测序列；不表示监测点数、最新测值或时效。</p>
                </>
              )}
            </SourceCard>
          </div>
        ),
      },
    ];
  };

  return (
    <AppShell
      activeNav="overview"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page ov-page">
        <header className="page-header ov-header">
          <div>
            <h1 className="page-title">风险态势总览</h1>
            <p className="page-subtitle">按已入库记录统计的风险、评估、预警与接入态势</p>
          </div>
          <div className="ov-header-actions">
            <Link className="ov-action" to={projectPath("/projects/documents")}>
              资料目录
            </Link>
            <Link className="ov-action" to={projectPath("/projects/monitoring")}>
              监测数据
            </Link>
          </div>
        </header>

        <PageStateView
          state={dashboard.state}
          title="风险态势"
          emptyMessage="当前工程暂无仪表盘统计"
          onRetry={dashboard.retry}
        >
          {(value) => <PageRegions regions={regionsFor(value)} value={null} />}
        </PageStateView>

        <h2 className="ov-section-title" id="overview-runs" ref={runsHeading} tabIndex={-1}>
          历史运行
        </h2>
        <OverviewRunsSection />
      </div>
    </AppShell>
  );
}
