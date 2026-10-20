import { useState } from "react";

import AppShell from "../../components/AppShell";
import { Card } from "../../components/Card";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { PageStateView } from "../../components/PageStateView";
import { SectionTabs } from "../../components/SectionTabs";
import { useEngineering, usePageQuery } from "../../api/engineering";
import {
  listMonitoringSeries,
  listSourceCatalog,
  type MonitoringSeriesPageView,
  type SourceCatalogPageView,
} from "../../api/operations";
import { IngestionFacts } from "./IngestionFacts";
import { PROJECT_INGESTION_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import type { KindRefView } from "../../api/engineeringWorkspace";
import "./ProjectWorkspace.css";

/**
 * 接入任务页（design D-02、D-06）。
 *
 * 一个复合页面同时呈现来源列表与所选来源的接入事实：资料与监测是两个独立来源页，
 * 切换来源清空本页游标；对象引用与版本成套选择，不另造任务标识或详情路由。
 */
const documentColumns: DataTableColumn[] = [
  {
    key: "name",
    title: "资料名称",
    render: (row) => String(row.name),
  },
  {
    key: "id",
    title: "资料标识",
    width: 220,
    render: (row) => <span className="mono">{String(row.id)}</span>,
  },
  {
    key: "version",
    title: "版本",
    width: 120,
    render: (row) => <span className="mono">{String(row.version)}</span>,
  },
];

const seriesColumns: DataTableColumn[] = [
  {
    key: "object",
    title: "监测对象",
    render: (row) => String(row.object),
  },
  {
    key: "indicator",
    title: "监测指标",
    width: 160,
    render: (row) => String(row.indicator),
  },
  {
    key: "version",
    title: "版本",
    width: 120,
    render: (row) => <span className="mono">{String(row.version)}</span>,
  },
];

export default function IngestionPage() {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const [kind, setKind] = useState<"document" | "monitoring">("document");
  const [selected, setSelected] = useState<KindRefView | null>(null);

  const documents = usePageQuery<SourceCatalogPageView>(
    (id, signal) =>
      kind === "document"
        ? listSourceCatalog(id, {}, signal)
        : Promise.resolve({ items: [], totalCount: 0 }),
    [projectId, kind],
  );
  const series = usePageQuery<MonitoringSeriesPageView>(
    (id, signal) =>
      kind === "monitoring"
        ? listMonitoringSeries(id, {}, signal)
        : Promise.resolve({ items: [], totalCount: 0 }),
    [projectId, kind],
  );

  return (
    <AppShell activeNav="project" agentContext={projectId === null ? [] : [projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">接入任务</h1>
            <p className="page-subtitle">已登记资料的解析、清洗与监测快照事实</p>
          </div>
        </header>

        <SectionTabs items={[...PROJECT_INGESTION_NAVIGATION_ITEMS_V1]} />

        <div className="pjwf-regions">
          <Card title="接入来源">
            <div className="pjwf-switch">
              <button
                type="button"
                className={kind === "document" ? "pjwf-switch-active" : "pjwf-switch"}
                onClick={() => {
                  setKind("document");
                  setSelected(null);
                }}
              >
                资料
              </button>
              <button
                type="button"
                className={kind === "monitoring" ? "pjwf-switch-active" : "pjwf-switch"}
                onClick={() => {
                  setKind("monitoring");
                  setSelected(null);
                }}
              >
                监测
              </button>
            </div>
            {kind === "document" ? (
              <PageStateView
                state={documents.state}
                title="资料来源"
                emptyMessage="当前工程尚无已登记资料"
                onRetry={documents.retry}
              >
                {(page) => (
                  <DataTable
                    columns={documentColumns}
                    rows={page.items.map((item) => ({
                      name: item.sourceName ?? item.sourceId,
                      id: item.sourceVersionRef.reference.entityId,
                      version: item.sourceVersionRef.reference.versionId,
                    }))}
                    onRowClick={(row) => {
                      const item = page.items.find(
                        (entry) => entry.sourceVersionRef.reference.entityId === String(row.id),
                      );
                      if (item === undefined) return;
                      setSelected(item.sourceVersionRef);
                    }}
                  />
                )}
              </PageStateView>
            ) : (
              <PageStateView
                state={series.state}
                title="监测来源"
                emptyMessage="当前工程尚无已登记监测序列"
                onRetry={series.retry}
              >
                {(page) => (
                  <DataTable
                    columns={seriesColumns}
                    rows={page.items.map((item) => ({
                      object: item.monitoringObject,
                      indicator: item.monitoringIndicator,
                      version: item.monitoringSeriesRef.reference.versionId,
                    }))}
                    onRowClick={(row) => {
                      const item = page.items.find(
                        (entry) => entry.monitoringObject === String(row.object),
                      );
                      if (item === undefined) return;
                      setSelected(item.monitoringSeriesRef);
                    }}
                  />
                )}
              </PageStateView>
            )}
          </Card>

          {selected !== null && (
            <IngestionFacts
              subject={selected}
              cleaningResultRef={selected.kind === "source-version" ? selected : undefined}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
