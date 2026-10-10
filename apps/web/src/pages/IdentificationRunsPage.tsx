import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import { listIdentificationRuns, type IdentificationRunListPageView } from "../api/operations";
import { identificationTabs, RunStatusTag, STAGE_LABEL } from "./identificationShared";
import "./IdentificationRunsPage.css";

const columns: DataTableColumn[] = [
  {
    key: "runRef",
    title: "运行标识",
    width: 190,
    render: (row) => (
      <span className="mono">
        {(row.runRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: "status",
    title: "状态",
    width: 110,
    render: (row) => <RunStatusTag status={row.status as string} />,
  },
  {
    key: "stage",
    title: "阶段",
    width: 190,
    render: (row) => {
      const stage = row.stage as string;
      const label = STAGE_LABEL[stage];
      return (
        <span>
          <span className="mono">{stage}</span>
          {label !== undefined && <span className="runs-dim"> · {label}</span>}
        </span>
      );
    },
  },
  {
    key: "triggerReason",
    title: "触发原因",
    width: 150,
    render: (row) => {
      const reason = row.triggerReason as string | undefined;
      return reason === undefined ? <span className="runs-dim">—</span> : <span>{reason}</span>;
    },
  },
  { key: "startedBy", title: "启动者", width: 130 },
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
  {
    key: "startedAt",
    title: "启动时间",
    render: (row) => <span className="mono">{row.startedAt as string}</span>,
  },
];

export default function IdentificationRunsPage() {
  const navigate = useNavigate();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const { state, retry } = usePageQuery<IdentificationRunListPageView>(
    (projectId, signal) => listIdentificationRuns(projectId, {}, signal),
    [],
  );

  return (
    <AppShell
      activeNav="identification"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">识别任务</h1>
            <p className="page-subtitle">当前工程的风险识别运行</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title="识别运行列表"
          emptyMessage="当前工程暂无识别运行"
          onRetry={retry}
        >
          {(page) => (
            <Card title="识别运行列表" extra={<span>行点击进入运行详情</span>}>
              {page.items.length === 0 ? (
                <div className="runs-dim">当前工程暂无识别运行</div>
              ) : (
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    navigate(
                      projectPath(
                        `/identification/runs/${encodeURIComponent(
                          (row.runRef as { reference: { entityId: string } }).reference.entityId,
                        )}`,
                      ),
                    )
                  }
                />
              )}
              {page.nextCursor !== undefined && (
                <div className="runs-dim">结果按游标分页，当前呈现第一页</div>
              )}
            </Card>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
