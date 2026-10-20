import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import AppShell from "../../components/AppShell";
import { Card } from "../../components/Card";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { PageStateView } from "../../components/PageStateView";
import { SectionTabs } from "../../components/SectionTabs";
import { useEngineering, usePageQuery, useProjectPath } from "../../api/engineering";
import {
  listMonitoringSeries,
  listSourceCatalog,
  type MonitoringSeriesPageView,
  type SourceCatalogPageView,
} from "../../api/operations";
import { readAgentTaskList, type AgentTaskListView } from "../../api/agentAuditOperations";
import { useAgentTaskOptional } from "../../agent/AgentTaskProvider";
import { agentTaskDetailPath } from "../../agent/agentShared";
import { IngestionFacts } from "./IngestionFacts";
import { PROJECT_INGESTION_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import type { KindRefView } from "../../api/engineeringWorkspace";
import "./ProjectWorkspace.css";

/**
 * 接入任务页（design D-02、D-06）。
 *
 * 一个复合页面同时呈现来源列表与所选来源的接入事实：资料与监测是两个独立来源页，
 * 切换来源清空本页游标；`kind`/`source`/`version` 由 URL 恢复并写回，刷新不改读其它对象。
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
    key: "id",
    title: "序列标识",
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

const agentColumns: DataTableColumn[] = [
  {
    key: "task",
    title: "清洗任务",
    render: (row) => <span className="mono">{String(row.task)}</span>,
  },
  { key: "status", title: "任务状态", width: 140 },
  { key: "updatedAt", title: "更新时间", width: 190 },
  { key: "link", title: "精确详情", width: 120 },
];

type IngestionKind = "document" | "monitoring";

const isIngestionKind = (value: string | null): value is IngestionKind =>
  value === "document" || value === "monitoring";

export default function IngestionPage() {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const projectPath = useProjectPath();
  const [searchParams, setSearchParams] = useSearchParams();

  // 来源类型、来源与版本都从 URL 恢复：刷新与深链重建同一选择，不用本地状态记忆。
  const kindParam = searchParams.get("kind");
  const kind: IngestionKind = isIngestionKind(kindParam) ? kindParam : "document";
  const kindInvalid = kindParam !== null && !isIngestionKind(kindParam);
  const sourceParam = searchParams.get("source");
  const versionParam = searchParams.get("version");
  // 来源与版本必须成套：只出现一半时不读取任何接入事实。
  const subjectBroken = (sourceParam === null) !== (versionParam === null);
  const subject: KindRefView | null =
    !subjectBroken && sourceParam !== null && versionParam !== null
      ? {
          kind: kind === "document" ? "source-version" : "monitoring-series",
          reference: { entityId: sourceParam, versionId: versionParam },
        }
      : null;

  const [paging, setPaging] = useState<{ readonly key: string; readonly cursor: string }>();
  const listKey = `${projectId ?? ""}:${kind}`;
  const cursor = paging?.key === listKey ? paging.cursor : undefined;

  const documents = usePageQuery<SourceCatalogPageView | null>(
    (id, signal) =>
      kind === "document"
        ? listSourceCatalog(id, cursor === undefined ? {} : { cursor }, signal)
        : Promise.resolve(null),
    [kind, cursor],
  );
  const series = usePageQuery<MonitoringSeriesPageView | null>(
    (id, signal) =>
      kind === "monitoring"
        ? listMonitoringSeries(id, cursor === undefined ? {} : { cursor }, signal)
        : Promise.resolve(null),
    [kind, cursor],
  );

  // 可选清洗任务沿用原 Agent 读取权限：未获准时这里不渲染区域，也不发请求。
  const agent = useAgentTaskOptional();
  const agentAllowed = agent?.allowed === true;
  const [agentPaging, setAgentPaging] = useState<{
    readonly key: string;
    readonly cursor: string;
  }>();
  const agentKey = `${projectId ?? ""}:data-cleaning`;
  const agentCursor = agentPaging?.key === agentKey ? agentPaging.cursor : undefined;
  const cleaningTasks = usePageQuery<AgentTaskListView | null>(
    (id, signal) =>
      agentAllowed
        ? readAgentTaskList(
            id,
            {
              taskType: "data-cleaning",
              ...(agentCursor === undefined ? {} : { cursor: agentCursor }),
            },
            signal,
          )
        : Promise.resolve(null),
    [agentAllowed, agentCursor],
  );

  const selectKind = (next: IngestionKind) => {
    const params = new URLSearchParams(searchParams);
    params.set("kind", next);
    params.delete("source");
    params.delete("version");
    setSearchParams(params, { replace: true });
  };

  const openSubject = (entityId: string, versionId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("kind", kind);
    params.set("source", entityId);
    params.set("version", versionId);
    setSearchParams(params, { replace: true });
  };

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
                onClick={() => selectKind("document")}
              >
                资料
              </button>
              <button
                type="button"
                className={kind === "monitoring" ? "pjwf-switch-active" : "pjwf-switch"}
                onClick={() => selectKind("monitoring")}
              >
                监测
              </button>
            </div>
            {kindInvalid && (
              <p className="pjwf-note">来源类型参数无效；按“资料”呈现，未读取其它来源。</p>
            )}
            {kind === "document" ? (
              <PageStateView
                state={documents.state}
                title="资料来源"
                emptyMessage="当前工程尚无已登记资料"
                onRetry={documents.retry}
              >
                {(page) =>
                  page === null ? null : (
                    <>
                      <p className="pjwf-note">
                        共 {page.totalCount} 条 · 当前页 {page.items.length} 条
                      </p>
                      {page.items.length === 0 ? (
                        <p className="pjwf-note">当前页无已登记资料。</p>
                      ) : (
                        <DataTable
                          columns={documentColumns}
                          rows={page.items.map((item) => ({
                            name: item.sourceName ?? item.sourceId,
                            id: item.sourceVersionRef.reference.entityId,
                            version: item.sourceVersionRef.reference.versionId,
                          }))}
                          onRowClick={(row) => {
                            if (typeof row.id !== "string" || typeof row.version !== "string")
                              return;
                            openSubject(row.id, row.version);
                          }}
                        />
                      )}
                      {page.nextCursor !== undefined && (
                        <div className="pjwf-more">
                          <button
                            type="button"
                            className="pjwf-secondary"
                            onClick={() => setPaging({ key: listKey, cursor: page.nextCursor! })}
                          >
                            继续读取后续页
                          </button>
                        </div>
                      )}
                    </>
                  )
                }
              </PageStateView>
            ) : (
              <PageStateView
                state={series.state}
                title="监测来源"
                emptyMessage="当前工程尚无已登记监测序列"
                onRetry={series.retry}
              >
                {(page) =>
                  page === null ? null : (
                    <>
                      <p className="pjwf-note">
                        共 {page.totalCount} 条 · 当前页 {page.items.length} 条
                      </p>
                      {page.items.length === 0 ? (
                        <p className="pjwf-note">当前页无已登记监测序列。</p>
                      ) : (
                        <DataTable
                          columns={seriesColumns}
                          rows={page.items.map((item) => ({
                            object: item.monitoringObject,
                            indicator: item.monitoringIndicator,
                            id: item.monitoringSeriesRef.reference.entityId,
                            version: item.monitoringSeriesRef.reference.versionId,
                          }))}
                          onRowClick={(row) => {
                            if (typeof row.id !== "string" || typeof row.version !== "string")
                              return;
                            openSubject(row.id, row.version);
                          }}
                        />
                      )}
                      {page.nextCursor !== undefined && (
                        <div className="pjwf-more">
                          <button
                            type="button"
                            className="pjwf-secondary"
                            onClick={() => setPaging({ key: listKey, cursor: page.nextCursor! })}
                          >
                            继续读取后续页
                          </button>
                        </div>
                      )}
                    </>
                  )
                }
              </PageStateView>
            )}
          </Card>

          {subjectBroken ? (
            <Card title="接入事实">
              <p className="pjwf-note">
                来源与版本必须成套给出（source 与 version）；当前不成套，未读取任何接入事实。
              </p>
            </Card>
          ) : subject === null ? (
            <Card title="接入事实">
              <p className="pjwf-note">
                尚未选择来源；从上方列表按真实标识选择资料或监测序列后读取已登记的处理关系。
              </p>
            </Card>
          ) : (
            <IngestionFacts
              key={`${projectId ?? ""}:${subject.kind}:${subject.reference.entityId}@${subject.reference.versionId}`}
              subject={subject}
            />
          )}

          {agentAllowed && (
            <Card title="可选清洗任务（Agent）">
              <PageStateView
                state={cleaningTasks.state}
                title="清洗任务"
                emptyMessage="当前工程尚无已登记的数据清洗任务"
                onRetry={cleaningTasks.retry}
              >
                {(list) =>
                  list === null ? null : (
                    <>
                      <p className="pjwf-note">
                        这份列表只列已登记的数据清洗任务，不代表它们与上方所选来源的处理关系；来源关联以接入事实为准。
                      </p>
                      {list.items.length === 0 ? (
                        <p className="pjwf-note">当前页无数据清洗任务。</p>
                      ) : (
                        <DataTable
                          columns={agentColumns}
                          rows={list.items.map((item) => ({
                            task: item.agentTaskRef.reference.entityId,
                            status: item.status,
                            updatedAt: item.updatedAt,
                            link: (
                              <Link to={projectPath(agentTaskDetailPath(item.agentTaskRef))}>
                                打开任务详情
                              </Link>
                            ),
                          }))}
                        />
                      )}
                      {list.nextCursor !== undefined && (
                        <div className="pjwf-more">
                          <button
                            type="button"
                            className="pjwf-secondary"
                            onClick={() =>
                              setAgentPaging({ key: agentKey, cursor: list.nextCursor! })
                            }
                          >
                            继续读取后续清洗任务
                          </button>
                        </div>
                      )}
                    </>
                  )
                }
              </PageStateView>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
