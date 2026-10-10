import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag, type StatusTone } from "../components/StatusTag";
import { useEngineering, usePageQuery, type PageState } from "../api/engineering";
import {
  readReviewActivities,
  type KindRef,
  type ReviewActivityPageView,
} from "../api/agentAuditOperations";
import { reviewTabs } from "./ReviewDetailPage";
import "./ReviewDetailPage.css";

/** 活动来源中文呈现（契约 ReviewActivitySourceTypeV1 四值）。 */
const SOURCE_TYPE_LABEL: Record<string, string> = {
  "business-audit": "业务审计",
  "review-task": "复核任务",
  "review-rejection": "复核拒绝",
  "security-audit": "安全审计",
};

/** 闭合活动码中文呈现：未知码按原标识符呈现，不解释自由文本。 */
const ACTIVITY_CODE_LABEL: Record<string, string> = {
  "review.requested": "复核已请求",
  "review.superseded": "复核被取代",
  "review.decided": "复核已决定",
  "review.decision-rejected": "复核决定被拒绝",
  "security.authorization-allowed": "授权通过",
  "security.authorization-rejected": "授权被拒",
  "business.recorded": "业务已登记",
};

const RESULT_TONE: Record<string, StatusTone> = {
  rejected: "failed",
  denied: "failed",
  superseded: "neutral",
  succeeded: "success",
};

interface ActivityFeed {
  /** 已取得的页按游标顺序保留：新活动到来不改动既有行的位置。 */
  readonly pages: readonly ReviewActivityPageView[];
  readonly nextCursor?: string | undefined;
}

/** 首屏活动页：每来源有界一页，游标续页由用户显式加载。 */
const useActivityFeed = (
  sourceType: string,
  subjectRef: KindRef | undefined,
): {
  readonly state: PageState<ActivityFeed> | { readonly kind: "idle" };
  readonly retry: () => void;
} =>
  usePageQuery<ActivityFeed>(
    async (projectId, signal) => {
      const page = await readReviewActivities(
        projectId,
        {
          ...(sourceType === "全部" ? {} : { sourceType }),
          ...(subjectRef === undefined ? {} : { subjectRef }),
        },
        signal,
      );
      return {
        pages: [page],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
    [sourceType, subjectRef?.kind, subjectRef?.reference.entityId, subjectRef?.reference.versionId],
  );

const activityRows = (feed: ActivityFeed) =>
  feed.pages.flatMap((page) => page.items.map((item) => ({ ...item })));

/** 可证明的精确主题过滤：三个参数齐备才构造引用，缺一即读整个工程的活动。 */
const subjectRefFrom = (params: URLSearchParams): KindRef | undefined => {
  const kind = params.get("subjectKind");
  const entityId = params.get("subjectId");
  const versionId = params.get("subjectVersion");
  if (kind === null || entityId === null || versionId === null) return undefined;
  return { kind, reference: { entityId, versionId } };
};

/**
 * 版本与操作审计：活动流是一组独立的有界查询（每页一个游标、每页有界），
 * 与追溯链、关联图各自的既有查询互不合并；证据只呈现定位码，不导出审计载荷正文。
 */
export default function AuditLogPage() {
  const { selector } = useEngineering();
  const [searchParams] = useSearchParams();
  const subjectRef = subjectRefFrom(searchParams);
  const [sourceType, setSourceType] = useState<string>("全部");
  const [appended, setAppended] = useState<ActivityFeed | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailure, setMoreFailure] = useState<string | null>(null);

  const { state, retry } = useActivityFeed(sourceType, subjectRef);
  const firstCursor = state.kind === "ready" ? state.value.nextCursor : undefined;
  const cursor = appended?.nextCursor ?? firstCursor;

  /** 刷新只重取首屏：已追加的续页随首屏一起作废，避免新旧页混排。 */
  const refresh = () => {
    setAppended(null);
    setMoreFailure(null);
    retry();
  };

  /** 续页只追加，不重取首页：新活动到达时既有行位置不变。 */
  const loadMore = async () => {
    const projectId = selector.projectId;
    if (projectId === null || cursor === undefined) return;
    setLoadingMore(true);
    setMoreFailure(null);
    try {
      const page = await readReviewActivities(projectId, {
        ...(sourceType === "全部" ? {} : { sourceType }),
        ...(subjectRef === undefined ? {} : { subjectRef }),
        cursor,
      });
      setAppended((prev) => ({
        pages: [...(prev === null ? [] : prev.pages), page],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }));
    } catch (error) {
      setMoreFailure(error instanceof Error ? error.message : "TERMINAL_FAILURE");
    } finally {
      setLoadingMore(false);
    }
  };

  const columns: DataTableColumn[] = [
    {
      key: "occurredAt",
      title: "发生时间",
      width: 190,
      render: (row) => <span className="mono">{String(row.occurredAt).replace("T", " ")}</span>,
    },
    {
      key: "recordedAt",
      title: "记录时间",
      width: 190,
      render: (row) => <span className="mono">{String(row.recordedAt).replace("T", " ")}</span>,
    },
    {
      key: "sourceType",
      title: "来源",
      width: 110,
      render: (row) => (
        <StatusTag tone="neutral">
          {SOURCE_TYPE_LABEL[String(row.sourceType)] ?? String(row.sourceType)}
        </StatusTag>
      ),
    },
    {
      key: "activityCode",
      title: "活动",
      width: 180,
      render: (row) => (
        <span className="rv-cell-stack">
          <span>{ACTIVITY_CODE_LABEL[String(row.activityCode)] ?? String(row.activityCode)}</span>
          <span className="rv-muted mono">{String(row.activityCode)}</span>
        </span>
      ),
    },
    {
      key: "actionCode",
      title: "已登记动作码",
      width: 180,
      render: (row) =>
        row.actionCode === undefined ? (
          <span className="rv-muted">—</span>
        ) : (
          <span className="mono">{String(row.actionCode)}</span>
        ),
    },
    {
      key: "actorRef",
      title: "操作者",
      width: 150,
      render: (row) =>
        row.actorRef === undefined ? (
          <span className="rv-muted">—</span>
        ) : (
          <span>{String(row.actorRef)}</span>
        ),
    },
    {
      key: "result",
      title: "结果",
      width: 220,
      render: (row) => {
        const resultCode = row.resultCode === undefined ? undefined : String(row.resultCode);
        const reasonCode = row.reasonCode === undefined ? undefined : String(row.reasonCode);
        if (resultCode === undefined && reasonCode === undefined)
          return <span className="rv-muted">—</span>;
        return (
          <span className="rv-cell-stack">
            {resultCode !== undefined && (
              <StatusTag tone={RESULT_TONE[resultCode] ?? "neutral"}>{resultCode}</StatusTag>
            )}
            {reasonCode !== undefined && <span className="rv-muted mono">{reasonCode}</span>}
          </span>
        );
      },
    },
    {
      key: "activityId",
      title: "活动标识",
      render: (row) => <span className="rv-muted mono">{String(row.activityId)}</span>,
    },
  ];

  return (
    <AppShell
      activeNav="review"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">版本与操作审计</h1>
            <p className="page-subtitle">
              复核请求、决定、被拒绝的决定与授权校验按游标分页倒序呈现；证据以定位码与已登记标识符呈现
            </p>
          </div>
        </header>

        <SectionTabs items={reviewTabs} />

        <Card title="筛选与操作">
          <div className="rv-batch-bar">
            <div className="rv-chips" role="group" aria-label="按活动来源筛选">
              {["全部", ...Object.keys(SOURCE_TYPE_LABEL)].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rv-chip${sourceType === value ? " rv-chip-active" : ""}`}
                  aria-pressed={sourceType === value}
                  onClick={() => {
                    setSourceType(value);
                    setAppended(null);
                    setMoreFailure(null);
                  }}
                >
                  {value === "全部" ? value : SOURCE_TYPE_LABEL[value]}
                </button>
              ))}
            </div>
            <div className="rv-chip-note">
              {subjectRef === undefined
                ? "未指定精确主题：呈现当前权限范围内的工程级活动"
                : `主题 ${subjectRef.kind} ${subjectRef.reference.entityId}`}
            </div>
            <button type="button" className="rv-btn" onClick={refresh}>
              刷新首屏
            </button>
          </div>
        </Card>

        <PageStateView
          state={state}
          title="审计活动"
          emptyMessage="当前筛选下没有审计活动"
          forbiddenHint="当前角色不具备审计活动读取权限"
          onRetry={refresh}
        >
          {(feed) => {
            const merged: ActivityFeed = {
              pages: appended === null ? feed.pages : [...feed.pages, ...appended.pages],
              ...(cursor === undefined ? {} : { nextCursor: cursor }),
            };
            const rows = activityRows(merged);
            const firstPageAsOf = feed.pages[0]?.asOfRecordedAt;
            return (
              <>
                <Card title="审计活动" extra={<span>已加载 {rows.length} 条</span>}>
                  <p className="rv-muted">
                    首屏读时点 {firstPageAsOf ?? "—"}
                    {firstPageAsOf === undefined
                      ? ""
                      : "：续页只追加、不重排，新活动到达不会改变已呈现行的位置。"}
                  </p>
                  {rows.length === 0 ? (
                    <div className="rv-muted">当前筛选下没有审计活动。</div>
                  ) : (
                    <DataTable columns={columns} rows={rows} />
                  )}
                  {moreFailure !== null && (
                    <p className="rv-fail">续页失败（{moreFailure}），可重试加载更早一页。</p>
                  )}
                  <div className="rv-actions">
                    {merged.nextCursor === undefined ? (
                      <span className="rv-muted">已读尽当前可证明的活动页。</span>
                    ) : (
                      <button
                        type="button"
                        className="rv-btn rv-btn--primary"
                        onClick={() => void loadMore()}
                        disabled={loadingMore}
                      >
                        {loadingMore ? "加载中…" : "加载更早一页"}
                      </button>
                    )}
                  </div>
                </Card>
                <p className="rv-muted">
                  证据仍以定位码与已登记引用呈现：页面不导出审计载荷正文，也不重算分值或风险统计。
                </p>
              </>
            );
          }}
        </PageStateView>
      </div>
    </AppShell>
  );
}
