import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import { listIdentificationRuns, type IdentificationRunListPageView } from "../api/operations";
import {
  IDENTIFICATION_ROUTE_TITLES,
  identificationTabs,
  RUN_STATUS_LABEL,
  RunStatusTag,
  STAGE_LABEL,
} from "./identificationShared";
import "./IdentificationRunsPage.css";

/** 运行状态筛选项：取值来自既有状态词表，不自造枚举。 */
const statusOptions = [
  { value: "", label: "全部状态" },
  ...Object.entries(RUN_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

const columns: DataTableColumn[] = [
  {
    key: "stage",
    title: "当前阶段",
    width: 240,
    render: (row) => {
      const stage = row.stage as string;
      const label = STAGE_LABEL[stage] ?? stage;
      return (
        <span>
          <span className="mono">{stage}</span>
          <span className="runs-dim"> · {label}</span>
        </span>
      );
    },
  },
  {
    key: "startedAt",
    title: "启动时间",
    width: 200,
    render: (row) => <span className="mono">{row.startedAt as string}</span>,
  },
  {
    key: "status",
    title: "状态",
    width: 110,
    render: (row) => <RunStatusTag status={row.status as string} />,
  },
  {
    key: "counts",
    title: "验收 / 待复核 / 拒收",
    width: 140,
    align: "center",
    render: (row) => (
      <span className="mono">
        {`${row.acceptedCount as number} / ${row.pendingReviewCount as number} / ${row.rejectedCount as number}`}
      </span>
    ),
  },
  { key: "startedBy", title: "启动者", width: 130 },
  {
    key: "runRef",
    title: "运行标识",
    width: 260,
    render: (row) => {
      const reference = (row.runRef as { reference: { entityId: string; versionId: string } })
        .reference;
      return (
        <span className="runs-ref">
          <span className="mono">{reference.entityId}</span>
          <VersionTag>{reference.versionId}</VersionTag>
        </span>
      );
    },
  },
];

export default function IdentificationRunsPage() {
  const navigate = useNavigate();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");

  const { state, retry } = usePageQuery<IdentificationRunListPageView>(
    (projectId, signal) =>
      listIdentificationRuns(
        projectId,
        {
          ...(cursor === undefined ? {} : { cursor }),
          ...(status === "" ? {} : { status }),
        },
        signal,
      ),
    [cursor, status],
  );

  // 筛选变化回到首屏：旧游标指向的页属于旧筛选范围，继续沿用会读出越界条目。
  const resetPaging = () => setCursor(undefined);

  return (
    <AppShell
      activeNav="identification"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{IDENTIFICATION_ROUTE_TITLES["/identification"]}</h1>
            <p className="page-subtitle">当前工程的风险识别任务</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title={IDENTIFICATION_ROUTE_TITLES["/identification"]}
          emptyMessage="当前工程暂无识别任务"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="识别任务"
              extra={
                <>
                  <select
                    className="runs-filter"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      resetPaging();
                    }}
                    aria-label="按状态筛选"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span>本页 {page.items.length} 条</span>
                </>
              }
            >
              {page.items.length === 0 ? (
                <div className="runs-dim">当前工程暂无识别任务</div>
              ) : (
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    navigate(
                      projectPath(
                        `/identification/runs/${encodeURIComponent(
                          (row.runRef as { reference: { entityId: string } }).reference.entityId,
                        )}?version=${encodeURIComponent(
                          (row.runRef as { reference: { versionId: string } }).reference.versionId,
                        )}`,
                      ),
                    )
                  }
                />
              )}
              <div className="runs-paging">
                <button
                  type="button"
                  className="runs-page-btn"
                  disabled={cursor === undefined}
                  onClick={resetPaging}
                >
                  返回首屏
                </button>
                <button
                  type="button"
                  className="runs-page-btn"
                  disabled={page.nextCursor === undefined}
                  onClick={() => {
                    if (page.nextCursor === undefined) return;
                    setCursor(page.nextCursor);
                  }}
                >
                  下一页
                </button>
              </div>
            </Card>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
