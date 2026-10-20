import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import { listRiskRecords, type RiskRecordCatalogPageView } from "../api/operations";
import {
  ACCEPTANCE_KIND_LABEL,
  IDENTIFICATION_ROUTE_TITLES,
  identificationTabs,
} from "./identificationShared";
import "./RiskRecordListPage.css";

const acceptanceOptions: { value: string; label: string }[] = [
  { value: "", label: "全部验收方式" },
  { value: "automatic", label: ACCEPTANCE_KIND_LABEL.automatic ?? "自动验收" },
  { value: "review", label: ACCEPTANCE_KIND_LABEL.review ?? "人工复核验收" },
];

const columns: DataTableColumn[] = [
  {
    key: "riskEventSummary",
    title: "风险事件",
    width: 260,
    render: (row) => <span>{row.riskEventSummary as string}</span>,
  },
  {
    key: "processNodeId",
    title: "工序节点",
    width: 150,
    render: (row) => <span className="mono">{row.processNodeId as string}</span>,
  },
  {
    key: "compositeConfidence",
    title: "综合置信度",
    width: 110,
    align: "center",
    render: (row) => (
      <span className="mono">
        {(row.compositeConfidence as { value: number }).value.toFixed(2)}
      </span>
    ),
  },
  {
    key: "acceptanceKind",
    title: "验收方式",
    width: 140,
    render: (row) => {
      const kind = row.acceptanceKind as string;
      return (
        <StatusTag tone={kind === "review" ? "review" : "success"}>
          {ACCEPTANCE_KIND_LABEL[kind] ?? kind}
        </StatusTag>
      );
    },
  },
  {
    key: "supersededBy",
    title: "当前效力",
    width: 110,
    render: (row) =>
      row.supersededBy === undefined ? (
        <StatusTag tone="neutral">现行</StatusTag>
      ) : (
        <StatusTag tone="failed">已被取代</StatusTag>
      ),
  },
  {
    key: "riskRecordRef",
    title: "记录标识",
    width: 260,
    render: (row) => {
      const reference = (
        row.riskRecordRef as { reference: { entityId: string; versionId: string } }
      ).reference;
      return (
        <span className="records-ref">
          <span className="mono">{reference.entityId}</span>
          <VersionTag>{reference.versionId}</VersionTag>
        </span>
      );
    },
  },
];

export default function RiskRecordListPage() {
  const navigate = useNavigate();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [processNodeId, setProcessNodeId] = useState("");
  const [acceptanceKind, setAcceptanceKind] = useState("");
  // 工序节点选项只来自已读到的目录结果：不是完整工序全集，也不要求手输技术标识。
  const knownNodes = useRef<Set<string>>(new Set());
  const [nodeOptions, setNodeOptions] = useState<readonly string[]>([]);

  const { state, retry } = usePageQuery<RiskRecordCatalogPageView>(
    (projectId, signal) =>
      listRiskRecords(
        projectId,
        {
          ...(cursor === undefined ? {} : { cursor }),
          ...(processNodeId === "" ? {} : { processNodeId }),
          ...(acceptanceKind === "" ? {} : { acceptanceKind }),
        },
        signal,
      ),
    [cursor, processNodeId, acceptanceKind],
  );

  useEffect(() => {
    if (state.kind !== "ready") return;
    const before = knownNodes.current.size;
    for (const item of state.value.items) knownNodes.current.add(item.processNodeId);
    if (knownNodes.current.size !== before) setNodeOptions([...knownNodes.current].sort());
  }, [state]);

  // 筛选变化回到首屏：旧游标属于旧筛选范围，继续沿用会读出越界条目。
  const resetPaging = () => setCursor(undefined);

  return (
    <AppShell
      activeNav="identification"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{IDENTIFICATION_ROUTE_TITLES["/identification/records"]}</h1>
            <p className="page-subtitle">当前工程已入库的风险记录</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title={IDENTIFICATION_ROUTE_TITLES["/identification/records"]}
          emptyMessage="当前筛选下暂无风险记录"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="风险记录"
              extra={
                <>
                  <select
                    className="records-filter"
                    value={processNodeId}
                    onChange={(e) => {
                      setProcessNodeId(e.target.value);
                      resetPaging();
                    }}
                    aria-label="按工序节点筛选"
                  >
                    <option value="">全部工序节点</option>
                    {nodeOptions.map((node) => (
                      <option key={node} value={node}>
                        {node}
                      </option>
                    ))}
                  </select>
                  <select
                    className="records-filter"
                    value={acceptanceKind}
                    onChange={(e) => {
                      setAcceptanceKind(e.target.value);
                      resetPaging();
                    }}
                    aria-label="按验收方式筛选"
                  >
                    {acceptanceOptions.map((option) => (
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
                <div className="records-dim">当前筛选下暂无风险记录</div>
              ) : (
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    navigate(
                      projectPath(
                        `/identification/records/${encodeURIComponent(
                          (row.riskRecordRef as { reference: { entityId: string } }).reference
                            .entityId,
                        )}?version=${encodeURIComponent(
                          (row.riskRecordRef as { reference: { versionId: string } }).reference
                            .versionId,
                        )}`,
                      ),
                    )
                  }
                />
              )}
              <div className="records-paging">
                <button
                  type="button"
                  className="records-page-btn"
                  disabled={cursor === undefined}
                  onClick={resetPaging}
                >
                  返回首屏
                </button>
                <button
                  type="button"
                  className="records-page-btn"
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
