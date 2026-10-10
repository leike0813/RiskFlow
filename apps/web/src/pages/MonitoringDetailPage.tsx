import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { EvidenceLink } from "../components/EvidenceLink";
import { KpiCard } from "../components/KpiCard";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { TrendLine } from "../charts/TrendLine";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  listMonitoringSeries,
  readCurrentReleaseSet,
  readMonitoringSeriesDetail,
  readMonitoringSnapshot,
  type MonitoringSeriesItemView,
  type MonitoringSeriesPageView,
  type MonitoringSnapshotView,
} from "../api/operations";
import "./MonitoringDetailPage.css";

const sectionTabs = [
  { to: "/project", label: "工程概览" },
  { to: "/projects/documents", label: "资料目录" },
  { to: "/projects/monitoring", label: "监测数据" },
];

const RELATION_LABEL: Record<string, string> = {
  original: "原始批次",
  correction: "更正批次",
  supplement: "补充批次",
};

const AVAILABILITY_LABEL: Record<string, string> = {
  available: "可用",
  partial: "部分可用",
  unavailable: "不可用",
};

const FEATURE_LABEL: Record<string, string> = {
  shortTermSlope: "短期斜率",
  acceleration: "加速度",
  dominantFrequency: "主频",
  anomalyScore: "异常评分",
};

const seriesColumns: DataTableColumn[] = [
  {
    key: "monitoringObject",
    title: "监测对象",
    render: (row) => row.monitoringObject as string,
  },
  { key: "monitoringIndicator", title: "监测指标" },
  { key: "canonicalUnit", title: "单位", width: 90 },
  { key: "batchCount", title: "批次数", width: 90, align: "right" },
  {
    key: "latestSnapshotRef",
    title: "最新快照",
    width: 140,
    render: (row) =>
      row.latestSnapshotRef === undefined ? (
        <StatusTag tone="neutral">无快照</StatusTag>
      ) : (
        <StatusTag tone="success">已冻结</StatusTag>
      ),
  },
];

const batchColumns: DataTableColumn[] = [
  {
    key: "monitoringBatchRef",
    title: "批次标识",
    render: (row) => (
      <span className="mono">
        {(row.monitoringBatchRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: "relation",
    title: "批次关系",
    width: 110,
    render: (row) => RELATION_LABEL[row.relation as string] ?? String(row.relation),
  },
  {
    key: "window",
    title: "时间窗",
    render: (row) => {
      const window = row.window as { from: string; to: string };
      return (
        <span className="mono">
          {window.from.slice(0, 10)} ~ {window.to.slice(0, 10)}
        </span>
      );
    },
  },
  { key: "sampleCount", title: "样本量", width: 90, align: "right" },
  { key: "occurredAt", title: "登记时间", width: 170 },
];

interface MonitoringDetailFacts {
  readonly series: MonitoringSeriesItemView | undefined;
  readonly detail: Awaited<ReturnType<typeof readMonitoringSeriesDetail>> | null;
  readonly snapshot: MonitoringSnapshotView | null;
  readonly thresholdRelease: string | null;
}

export default function MonitoringDetailPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();

  const list = usePageQuery<MonitoringSeriesPageView>(
    (projectId, signal) => listMonitoringSeries(projectId, {}, signal),
    [],
  );

  const detail = usePageQuery<MonitoringDetailFacts>(
    async (projectId, signal) => {
      const catalog = await listMonitoringSeries(projectId, {}, signal);
      const series = catalog.items.find(
        (item) => item.monitoringSeriesRef.reference.entityId === seriesId,
      );
      if (series === undefined) {
        return { series: undefined, detail: null, snapshot: null, thresholdRelease: null };
      }
      const seriesDetail = await readMonitoringSeriesDetail(
        projectId,
        series.monitoringSeriesRef,
        signal,
      );
      const snapshotRef =
        series.latestSnapshotRef ?? seriesDetail.snapshots[0]?.monitoringSnapshotRef;
      // 快照正文继承其证据来源的访问边界：按目录暴露的快照证据来源版本声明授权。
      const snapshotSources = [
        ...new Map(
          seriesDetail.snapshots
            .flatMap((entry) => entry.evidenceSourceVersionRefs)
            .map((ref) => [`${ref.reference.entityId}@${ref.reference.versionId}`, ref] as const),
        ).values(),
      ];
      const snapshot =
        snapshotRef === undefined
          ? null
          : await readMonitoringSnapshot(projectId, snapshotRef, snapshotSources, signal);
      const releaseSet = await readCurrentReleaseSet(projectId, signal);
      const thresholdRelease =
        releaseSet.find((member) => member.definitionType === "monitoring-warning-threshold")
          ?.releaseRef.reference.versionId ?? null;
      return { series, detail: seriesDetail, snapshot, thresholdRelease };
    },
    [seriesId],
  );

  return (
    <AppShell
      activeNav="project"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">监测数据</h1>
            <p className="page-subtitle">监测序列、批次与冻结快照的统计事实</p>
          </div>
        </header>

        <SectionTabs items={sectionTabs} />

        {seriesId === undefined ? (
          <PageStateView
            state={list.state}
            title="监测序列"
            emptyMessage="当前工程尚无登记监测序列"
            onRetry={list.retry}
          >
            {(page) => (
              <Card title="监测序列">
                <DataTable
                  columns={seriesColumns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    navigate(
                      projectPath(
                        `/projects/monitoring/${encodeURIComponent(
                          (row.monitoringSeriesRef as { reference: { entityId: string } }).reference
                            .entityId,
                        )}`,
                      ),
                    )
                  }
                />
              </Card>
            )}
          </PageStateView>
        ) : (
          <PageStateView
            state={detail.state}
            title="监测序列详情"
            emptyMessage="未找到该监测序列"
            onRetry={detail.retry}
          >
            {(facts) =>
              facts.series === undefined || facts.detail === null ? (
                <Card title="监测序列详情">
                  <div className="pjmon-empty">未找到该监测序列，或当前会话无权访问</div>
                </Card>
              ) : (
                <>
                  <div className="pjmon-head">
                    <h2 className="pjmon-title">{facts.series.monitoringObject}</h2>
                    <span className="page-subtitle">
                      {facts.series.monitoringIndicator} · 单位 {facts.series.canonicalUnit}
                    </span>
                    {facts.thresholdRelease !== null && (
                      <VersionTag>监测预警阈值 {facts.thresholdRelease}</VersionTag>
                    )}
                  </div>

                  {facts.snapshot === null ? (
                    <Card title="监测快照">
                      <div className="pjmon-empty">
                        该序列尚无冻结快照，快照产生前不呈现趋势曲线或统计估值
                      </div>
                    </Card>
                  ) : (
                    <>
                      <div className="pjmon-chart-row">
                        <Card
                          title={`快照对齐点序列（${facts.snapshot.window.from.slice(0, 10)} ~ ${facts.snapshot.window.to.slice(0, 10)}）`}
                          extra={
                            <VersionTag>
                              快照 {facts.snapshot.monitoringSnapshotRef.reference.versionId}
                            </VersionTag>
                          }
                        >
                          {facts.snapshot.alignedPoints.length === 0 ? (
                            <div className="pjmon-empty">快照窗口内无对齐点</div>
                          ) : (
                            <TrendLine
                              points={facts.snapshot.alignedPoints.map((point) => ({
                                date: point.sampledAt.slice(5, 16).replace("T", " "),
                                value: point.value ?? Number.NaN,
                              }))}
                              height={220}
                            />
                          )}
                        </Card>
                      </div>

                      <div className="pjmon-kpis">
                        <KpiCard
                          label="样本覆盖率"
                          value={(facts.snapshot.coverageRatio * 100).toFixed(1)}
                          unit="%"
                          tag={AVAILABILITY_LABEL[facts.snapshot.availability]}
                          tone={facts.snapshot.availability === "unavailable" ? "risk" : "default"}
                        />
                        {(
                          [
                            "shortTermSlope",
                            "acceleration",
                            "dominantFrequency",
                            "anomalyScore",
                          ] as const
                        ).map((key) => {
                          const feature = facts.snapshot!.features[key];
                          return (
                            <KpiCard
                              key={key}
                              label={FEATURE_LABEL[key] ?? key}
                              value={
                                feature.status === "available" && feature.value !== undefined
                                  ? feature.value
                                  : "—"
                              }
                              unit={feature.unit ?? ""}
                              tag={feature.status === "available" ? "有效" : "不可用"}
                            />
                          );
                        })}
                      </div>

                      {facts.snapshot.evidenceReferences.length > 0 && (
                        <Card title="快照证据定位">
                          <div className="pjmon-evidence">
                            {facts.snapshot.evidenceReferences.map((reference) => (
                              <EvidenceLink
                                key={reference.sourceSegmentId}
                                segmentId={reference.sourceSegmentId}
                                sourceVersionRef={reference.sourceVersionRef}
                                referencedBy={
                                  facts.snapshot!.monitoringSnapshotRef.reference.entityId
                                }
                              />
                            ))}
                          </div>
                        </Card>
                      )}
                    </>
                  )}

                  <Card title="批次与快照登记事实">
                    <DataTable
                      columns={batchColumns}
                      rows={facts.detail.batches.map((batch) => ({ ...batch }))}
                    />
                    {facts.detail.batches.length === 0 && (
                      <div className="pjmon-empty">该序列尚无登记批次</div>
                    )}
                  </Card>
                </>
              )
            }
          </PageStateView>
        )}
      </div>
    </AppShell>
  );
}
