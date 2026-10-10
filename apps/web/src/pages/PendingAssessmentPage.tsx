import { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  readPendingRiskCatalog,
  type PendingCatalogView,
  type PendingRiskItemView,
} from "../api/operations";
import { NextPageButton, tableRow } from "./assessmentResponseShared";
import "./assessment-response.css";

const ASSESSMENT_TABS = [
  { to: "/assessment", label: "待评估" },
  { to: "/assessment/records", label: "评估记录" },
  { to: "/assessment/reassessments", label: "重评历史" },
  { to: "/assessment/matrix", label: "风险矩阵" },
];

/**
 * P-RA-01 待评估风险（design D-02、D-04）。
 *
 * 目录条目只来自所属登记事实：评估状态与最近一次评估记录引用都由 C25 判定，
 * 页面不按列表长度猜状态，也不推断风险是否"已评估"。
 */
export default function PendingAssessmentPage() {
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const [riskInputKind, setRiskInputKind] = useState<"risk-record" | "external-risk-event">(
    "risk-record",
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const { state, retry } = usePageQuery<PendingCatalogView>(
    (projectId, signal) =>
      readPendingRiskCatalog(
        projectId,
        { riskInputKind, ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [riskInputKind, cursor],
  );

  const columns: DataTableColumn[] = [
    {
      key: "riskInput",
      title: "风险输入",
      width: 280,
      render: (row) => {
        const ref = tableRow<PendingRiskItemView>(row).riskInput.reference;
        return (
          <div className="ar-cell">
            <Link className="mono" to={projectPath(`assessment/records`)}>
              {ref.entityId}
            </Link>
            <span className="ar-note">{tableRow<PendingRiskItemView>(row).riskInput.kind}</span>
          </div>
        );
      },
    },
    {
      key: "spatialScopeRefs",
      title: "空间范围",
      width: 200,
      render: (row) => (
        <ul className="ar-ref-list">
          {tableRow<PendingRiskItemView>(row).spatialScopeRefs.map((ref) => (
            <li key={ref.reference.entityId} className="mono">
              {ref.reference.entityId}
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "evidenceReferences",
      title: "证据条目",
      width: 100,
      align: "center",
      render: (row) => (
        <span className="mono">{tableRow<PendingRiskItemView>(row).evidenceReferences.length}</span>
      ),
    },
    {
      key: "assessmentState",
      title: "评估状态",
      width: 120,
      render: (row) => {
        const value = String(row.assessmentState);
        return (
          <StatusTag tone={value === "assessed" ? "success" : "review"}>
            {value === "assessed" ? "已评估" : "未评估"}
          </StatusTag>
        );
      },
    },
    {
      key: "lastAssessmentRecordRef",
      title: "最近评估记录",
      width: 220,
      render: (row) => {
        const ref = tableRow<PendingRiskItemView>(row).lastAssessmentRecordRef;
        if (ref === undefined) return <span className="ar-note">尚无评估记录</span>;
        return (
          <Link
            className="mono"
            to={projectPath(
              `assessment/records/${ref.reference.entityId}?version=${ref.reference.versionId}`,
            )}
          >
            {ref.reference.entityId}
          </Link>
        );
      },
    },
    {
      key: "start",
      title: "操作",
      width: 110,
      render: (row) => {
        const ref = tableRow<PendingRiskItemView>(row).riskInput.reference;
        return (
          <Link
            className="ar-chip"
            to={projectPath(`assessment/start?riskInput=${encodeURIComponent(ref.entityId)}`)}
          >
            启动评估
          </Link>
        );
      },
    },
  ];

  return (
    <AppShell
      activeNav="assessment"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">待评估风险</h1>
            <p className="page-subtitle">已入库风险输入的评估候选队列</p>
          </div>
        </header>
        <SectionTabs items={ASSESSMENT_TABS} />

        <PageStateView
          state={state}
          title="待评估队列"
          emptyMessage="当前来源下暂无待评估的风险输入"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="待评估队列"
              extra={
                <div className="wc-filter">
                  <span className="wc-filter-label">风险来源</span>
                  {(
                    [
                      ["risk-record", "标准化风险记录"],
                      ["external-risk-event", "外部风险事件"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`wc-chip${riskInputKind === value ? " wc-chip--active" : ""}`}
                      onClick={() => {
                        setRiskInputKind(value);
                        setCursor(undefined);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            >
              <DataTable columns={columns} rows={page.items.map((item) => ({ ...item }))} />
              <NextPageButton nextCursor={page.nextCursor} onContinue={setCursor} />
            </Card>
          )}
        </PageStateView>

        {state.kind === "ready" && (
          <Card title="候选口径" style={{ marginTop: 16 }}>
            <p className="ar-note">
              本次读取主体 <span className="mono">{state.value.actorId}</span>
              可用动作 {state.value.actions.length}{" "}
              项。是否已评估由领域侧按精确记录判定，页面不做推断。
            </p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
