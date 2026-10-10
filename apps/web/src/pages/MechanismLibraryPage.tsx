import { useState } from "react";
import AppShell from "../components/AppShell";
import { AssociatedObjects } from "../components/AssociatedObjects";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { EvidenceLink } from "../components/EvidenceLink";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery } from "../api/engineering";
import {
  listKnowledgeDefinitions,
  type GovernanceLifecycleStatus,
  type GovernanceListPageView,
  type GovernanceReleaseView,
  type GovernanceRevisionView,
  type MechanismView,
} from "../api/operations";
import {
  LifecycleFilters,
  LifecycleTag,
  knowledgeTabs,
  lifecycleStatusOf,
  readGovernanceDetail,
} from "./knowledgeShared";
import "./MechanismLibraryPage.css";

const columns: DataTableColumn[] = [
  {
    key: "definitionRef",
    title: "定义标识",
    render: (row) => (
      <span className="mono">
        {(row.definitionRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: "lifecycleStatus",
    title: "审核状态",
    width: 100,
    render: (row) => <LifecycleTag status={row.lifecycleStatus as GovernanceLifecycleStatus} />,
  },
  {
    key: "currentReleaseRef",
    title: "当前发布",
    width: 140,
    render: (row) => {
      const release = row.currentReleaseRef as
        { reference: { entityId: string; versionId: string } } | undefined;
      return release === undefined ? "—" : <VersionTag>{release.reference.versionId}</VersionTag>;
    },
  },
  { key: "updatedAt", title: "更新时间", width: 170 },
];

type GovernanceDetail = GovernanceReleaseView | GovernanceRevisionView;

export default function MechanismLibraryPage() {
  const { selector } = useEngineering();
  const [statusFilter, setStatusFilter] = useState<GovernanceLifecycleStatus | undefined>(
    undefined,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = usePageQuery<GovernanceListPageView>(
    (projectId, signal) =>
      listKnowledgeDefinitions(
        projectId,
        {
          definitionType: "risk-mechanism",
          ...(statusFilter === undefined ? {} : { lifecycleStatus: statusFilter }),
        },
        signal,
      ),
    [statusFilter],
  );

  const selectedItem =
    list.state.kind === "ready"
      ? (list.state.value.items.find(
          (item) => item.definitionRef.reference.entityId === selectedId,
        ) ?? list.state.value.items[0])
      : undefined;

  const detail = usePageQuery<GovernanceDetail | null>(
    (projectId, signal) =>
      selectedItem === undefined
        ? Promise.resolve(null)
        : readGovernanceDetail(projectId, selectedItem, signal),
    [
      selectedItem?.definitionRef.reference.entityId,
      selectedItem?.currentReleaseRef?.reference.versionId,
      selectedItem?.currentRevisionRef?.reference.versionId,
    ],
  );

  return (
    <AppShell
      activeNav="knowledge"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险机理库</h1>
            <p className="page-subtitle">风险机理条目及其与工序、监测指标的关联（只读）</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <LifecycleFilters value={statusFilter} onChange={setStatusFilter} className="kme-filters" />

        <PageStateView
          state={list.state}
          title="机理条目"
          emptyMessage="当前筛选下无机理条目"
          forbiddenHint="当前角色不具备知识库读取权限"
          onRetry={list.retry}
        >
          {(page) => (
            <div className="kme-layout">
              <Card title="机理条目" extra={`共 ${page.totalCount} 条`}>
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    setSelectedId(
                      (row.definitionRef as { reference: { entityId: string } }).reference.entityId,
                    )
                  }
                />
              </Card>

              {selectedItem !== undefined && (
                <PageStateView
                  state={detail.state}
                  title="条目详情"
                  emptyMessage="该定义暂无可读版本"
                  onRetry={detail.retry}
                >
                  {(value) =>
                    value === null ? (
                      <Card title="条目详情">
                        <div className="kme-empty">该定义暂无可读版本</div>
                      </Card>
                    ) : (
                      <MechanismDetail detail={value} />
                    )
                  }
                </PageStateView>
              )}
            </div>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}

function MechanismDetail({ detail }: { detail: GovernanceDetail }) {
  const versionRef = "releaseRef" in detail ? detail.releaseRef : detail.revisionRef;
  const mechanisms = detail.body.definitionType === "risk-mechanism" ? detail.body.mechanisms : [];
  return (
    <>
      <Card
        title={`${detail.definitionRef.reference.entityId}`}
        extra={
          <>
            <LifecycleTag status={lifecycleStatusOf(detail)} />
            <VersionTag>{versionRef.reference.versionId}</VersionTag>
          </>
        }
      >
        {mechanisms.length === 0 ? (
          <div className="kme-empty">该版本不含机理条目</div>
        ) : (
          mechanisms.map((mechanism) => (
            <MechanismCard key={mechanism.mechanismId} mechanism={mechanism} />
          ))
        )}
      </Card>
      <AssociatedObjects subjectRef={versionRef} />
    </>
  );
}

function MechanismCard({ mechanism }: { mechanism: MechanismView }) {
  return (
    <div className="kme-detail-grid">
      <div className="kme-field">
        <div className="kme-field-label">机理条目</div>
        <div className="kme-field-value mono">{mechanism.mechanismId}</div>
      </div>
      <div className="kme-field">
        <div className="kme-field-label">机理类型</div>
        <div className="kme-field-value">{mechanism.mechanismType}</div>
      </div>
      <div className="kme-field">
        <div className="kme-field-label">适用工序</div>
        <div className="kme-tags">
          {mechanism.nodeIds.map((node) => (
            <span key={node} className="kme-tag">
              {node}
            </span>
          ))}
        </div>
      </div>
      <div className="kme-field">
        <div className="kme-field-label">地质水文适用</div>
        <div className="kme-field-value">{mechanism.applicability.stratumCondition.join("、")}</div>
      </div>
      <div className="kme-field kme-field--full">
        <div className="kme-field-label">触发条件</div>
        <div className="kme-field-value">
          {mechanism.triggeringFactors.join("；")}
          {mechanism.preconditions.length > 0 && `（前提：${mechanism.preconditions.join("；")}）`}
        </div>
      </div>
      <div className="kme-field">
        <div className="kme-field-label">监测征兆</div>
        <div className="kme-tags">
          {mechanism.monitoringIndicators.map((indicator) => (
            <span key={indicator} className="kme-tag">
              {indicator}
            </span>
          ))}
        </div>
      </div>
      <div className="kme-field">
        <div className="kme-field-label">风险事件表达</div>
        <div className="kme-field-value">{mechanism.consequences.join("；")}</div>
      </div>
      <div className="kme-field kme-field--full">
        <div className="kme-field-label">证据定位</div>
        <div className="kme-evidence-list">
          {mechanism.evidence.map((reference) => (
            <EvidenceLink
              key={reference.sourceSegmentId}
              segmentId={reference.sourceSegmentId}
              sourceVersionRef={reference.sourceVersionRef}
              referencedBy={mechanism.mechanismId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
