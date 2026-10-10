import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  listSourceCatalog,
  type CleaningAvailability,
  type SourceCatalogPageView,
  type SourceParseStatus,
} from "../api/operations";
import "./DocumentListPage.css";

const sectionTabs = [
  { to: "/project", label: "工程概览" },
  { to: "/projects/documents", label: "资料目录" },
  { to: "/projects/monitoring", label: "监测数据" },
];

const PARSE_STATUS_LABEL: Record<SourceParseStatus, string> = {
  registered: "已登记",
  processing: "解析中",
  parsed: "解析通过",
  failed: "解析失败",
};

const PARSE_STATUS_TONE: Record<SourceParseStatus, "success" | "running" | "failed" | "neutral"> = {
  registered: "neutral",
  processing: "running",
  parsed: "success",
  failed: "failed",
};

const CLEANING_LABEL: Record<CleaningAvailability, string> = {
  available: "清洗可用",
  partial: "部分可用",
  unavailable: "不可用",
};

const columns: DataTableColumn[] = [
  {
    key: "sourceId",
    title: "资料标识",
    width: 180,
    render: (row) => <span className="mono">{row.sourceId as string}</span>,
  },
  {
    key: "documentType",
    title: "类型",
    width: 120,
    render: (row) => (row.documentType as string | undefined) ?? "—",
  },
  {
    key: "formedAt",
    title: "形成时间",
    width: 150,
    render: (row) => (row.formedAt as string | undefined) ?? "—",
  },
  {
    key: "sourceOrganization",
    title: "来源单位",
    width: 160,
    render: (row) => (row.sourceOrganization as string | undefined) ?? "—",
  },
  {
    key: "externalVersion",
    title: "版本",
    width: 120,
    render: (row) => <VersionTag>{(row.externalVersion as string | undefined) ?? "—"}</VersionTag>,
  },
  {
    key: "parseStatus",
    title: "解析状态",
    width: 100,
    render: (row) => {
      const status = row.parseStatus as SourceParseStatus;
      return <StatusTag tone={PARSE_STATUS_TONE[status]}>{PARSE_STATUS_LABEL[status]}</StatusTag>;
    },
  },
  {
    key: "cleaningAvailability",
    title: "清洗可用性",
    width: 130,
    render: (row) => {
      const availability = row.cleaningAvailability as CleaningAvailability | undefined;
      if (availability === undefined) return <StatusTag tone="neutral">未清洗</StatusTag>;
      const exclusionCount = row.cleaningExclusionCount as number | undefined;
      return (
        <StatusTag tone={availability === "available" ? "success" : "review"}>
          {CLEANING_LABEL[availability]}
          {availability === "partial" && exclusionCount !== undefined
            ? `（排除 ${exclusionCount}）`
            : ""}
        </StatusTag>
      );
    },
  },
];

export default function DocumentListPage() {
  const navigate = useNavigate();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const { state, retry } = usePageQuery<SourceCatalogPageView>(
    (projectId, signal) => listSourceCatalog(projectId, {}, signal),
    [],
  );

  return (
    <AppShell
      activeNav="project"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">资料目录</h1>
            <p className="page-subtitle">工程资料版本清单、来源单位与解析状态</p>
          </div>
        </header>

        <SectionTabs items={sectionTabs} />

        <PageStateView
          state={state}
          title="工程资料版本列表"
          emptyMessage="当前工程尚无登记资料版本"
          onRetry={retry}
        >
          {(page) => (
            <>
              <div className="pjdl-kpis">
                <KpiCard label="登记资料" value={page.totalCount} unit="份" />
                <KpiCard
                  label="解析通过"
                  value={page.items.filter((item) => item.parseStatus === "parsed").length}
                  unit="份（本页）"
                />
                <KpiCard
                  label="清洗可用"
                  value={
                    page.items.filter((item) => item.cleaningAvailability === "available").length
                  }
                  unit="份（本页）"
                />
              </div>
              <Card title="工程资料版本列表">
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    navigate(
                      projectPath(
                        `/projects/documents/${encodeURIComponent(
                          (row.sourceVersionRef as { reference: { entityId: string } }).reference
                            .entityId,
                        )}`,
                      ),
                    )
                  }
                />
                {page.nextCursor !== undefined && (
                  <div className="pjdl-more">结果按游标分页，更多条目请经目录查询继续翻页</div>
                )}
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
