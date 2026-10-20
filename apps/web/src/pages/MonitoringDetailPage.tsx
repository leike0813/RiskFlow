import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  type MonitoringSeriesPageView,
  type MonitoringSnapshotView,
} from "../api/operations";
import {
  readEngineeringWorkspaceSnapshots,
  resolveEngineeringWorkspaceMonitoringSeries,
  type EngineeringWorkspaceSnapshotView,
  type KindRefView,
  type WorkspacePageView,
} from "../api/engineeringWorkspace";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./project/projectNavigation";
import "./MonitoringDetailPage.css";

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

/**
 * 目录行来自受控读取，但表格行是 `Record<string, unknown>`；
 * 这里按运行时形状收窄，不对未校验对象做断言成员访问。
 */
const seriesRefOf = (row: Record<string, unknown>): KindRefView | null => {
  const value = row.monitoringSeriesRef;
  if (typeof value !== "object" || value === null) return null;
  const kind = "kind" in value ? value.kind : undefined;
  const reference = "reference" in value ? value.reference : undefined;
  if (typeof kind !== "string") return null;
  if (typeof reference !== "object" || reference === null) return null;
  const entityId = "entityId" in reference ? reference.entityId : undefined;
  const versionId = "versionId" in reference ? reference.versionId : undefined;
  if (typeof entityId !== "string" || typeof versionId !== "string") return null;
  return { kind, reference: { entityId, versionId } };
};

const seriesColumns: DataTableColumn[] = [
  {
    key: "monitoringObject",
    title: "监测对象",
    render: (row) => row.monitoringObject as string,
  },
  { key: "monitoringIndicator", title: "监测指标" },
  {
    key: "monitoringSeriesRef",
    title: "序列标识",
    width: 240,
    render: (row) => {
      const ref = seriesRefOf(row);
      return ref === null ? (
        "—"
      ) : (
        <span className="mono">
          {ref.reference.entityId}@{ref.reference.versionId}
        </span>
      );
    },
  },
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
    render: (row) => {
      // 行由本页从已解码批次项映射而来；列回调只拿到 Record，这里按其构造约定取精确标识。
      const batchRef = row.monitoringBatchRef as {
        readonly reference: { readonly entityId: string };
      };
      return <span className="mono">{batchRef.reference.entityId}</span>;
    },
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

type MonitoringSnapshotSelection =
  | { readonly read: false }
  | {
      readonly read: true;
      readonly value: MonitoringSnapshotView;
      /** 服务端返回的快照/序列引用必须与 URL 成套参数一致；不一致即拒绝呈现。 */
      readonly matched: boolean;
    };

export default function MonitoringDetailPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();

  // 精确版本来自 URL；没有版本时由所属实体窄解析后写回地址。
  const seriesVersion = searchParams.get("version");
  const snapshotId = searchParams.get("snapshot");
  const snapshotVersion = searchParams.get("snapshotVersion");
  // 快照参数必须成套：只出现一半时不读取快照，也不回落成「未选择」。
  const snapshotMismatch = (snapshotId === null) !== (snapshotVersion === null);

  const projectKey = selector.projectId ?? "";

  // 列表续页游标绑定当前工程；切工程即失效，不把上一工程的游标带过来。
  const [listPaging, setListPaging] = useState<{
    readonly key: string;
    readonly cursor: string;
  }>();
  const listKey = `${projectKey}:monitoring-series`;
  const listCursor = listPaging?.key === listKey ? listPaging.cursor : undefined;

  // 详情续页游标绑定工程 + 序列精确版本；换版本沿用旧游标会读到另一对象的页。
  const [detailPaging, setDetailPaging] = useState<{
    readonly key: string;
    readonly cursor: string;
  }>();
  const detailKey = `${projectKey}:${seriesId ?? ""}:${seriesVersion ?? ""}`;
  const detailCursor = detailPaging?.key === detailKey ? detailPaging.cursor : undefined;

  const list = usePageQuery<MonitoringSeriesPageView | null>(
    (projectId, signal) =>
      seriesId !== undefined
        ? Promise.resolve(null)
        : listMonitoringSeries(
            projectId,
            listCursor === undefined ? {} : { cursor: listCursor },
            signal,
          ),
    [seriesId, listCursor],
  );

  // 窄解析只在没有版本时发生：它只用于把旧地址写回精确版本。
  const resolved = usePageQuery(
    async (projectId, signal) => {
      if (seriesId === undefined || seriesVersion !== null) return null;
      return resolveEngineeringWorkspaceMonitoringSeries(projectId, seriesId, signal);
    },
    [seriesId, seriesVersion],
  );

  useEffect(() => {
    if (seriesId === undefined || seriesVersion !== null) return;
    if (resolved.state.kind !== "ready") return;
    const versionId = resolved.state.value?.monitoringSeriesRef.reference.versionId;
    if (versionId === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.set("version", versionId);
    setSearchParams(next, { replace: true });
  }, [seriesId, seriesVersion, resolved.state, searchParams, setSearchParams]);

  // 精确详情：给了版本就直接按该版本读取，不查目录首页、也不依赖窄解析。
  const detail = usePageQuery(
    async (projectId, signal) => {
      if (seriesId === undefined || seriesVersion === null) return null;
      return readMonitoringSeriesDetail(
        projectId,
        { kind: "monitoring-series", reference: { entityId: seriesId, versionId: seriesVersion } },
        signal,
        detailCursor === undefined ? {} : { cursor: detailCursor },
      );
    },
    [seriesId, seriesVersion, detailCursor],
  );

  // 快照目录走所属精确序列的分页读面：页大小由服务端拥有，页面只显式续页。
  const [snapshotPaging, setSnapshotPaging] = useState<{
    readonly key: string;
    readonly cursor: string;
  }>();
  const snapshotCatalogKey = `${detailKey}:snapshots`;
  const snapshotCatalogCursor =
    snapshotPaging?.key === snapshotCatalogKey ? snapshotPaging.cursor : undefined;
  const snapshots = usePageQuery<WorkspacePageView<EngineeringWorkspaceSnapshotView> | null>(
    async (projectId, signal) => {
      if (seriesId === undefined || seriesVersion === null) return null;
      return readEngineeringWorkspaceSnapshots(
        projectId,
        { kind: "monitoring-series", reference: { entityId: seriesId, versionId: seriesVersion } },
        signal,
        snapshotCatalogCursor === undefined ? {} : { cursor: snapshotCatalogCursor },
      );
    },
    [seriesId, seriesVersion, snapshotCatalogCursor],
  );

  // 所选快照直接按 URL 引用读取；来源由服务端从目标登记恢复，客户端不从目录页拼装。
  const snapshot = usePageQuery<MonitoringSnapshotSelection>(
    async (projectId, signal) => {
      if (seriesId === undefined || seriesVersion === null) return { read: false };
      if (snapshotId === null || snapshotVersion === null) return { read: false };
      const value = await readMonitoringSnapshot(
        projectId,
        {
          kind: "monitoring-snapshot",
          reference: { entityId: snapshotId, versionId: snapshotVersion },
        },
        [],
        signal,
      );
      const snapshotRef = value.monitoringSnapshotRef.reference;
      const seriesRef = value.monitoringSeriesRef.reference;
      return {
        read: true,
        value,
        matched:
          snapshotRef.entityId === snapshotId &&
          snapshotRef.versionId === snapshotVersion &&
          seriesRef.entityId === seriesId &&
          seriesRef.versionId === seriesVersion,
      };
    },
    [seriesId, seriesVersion, snapshotId, snapshotVersion],
  );

  // 当前知识阈值是独立可读区域：它失败不得抹掉已获准的快照与批次。
  const threshold = usePageQuery(async (projectId, signal) => {
    const releases = await readCurrentReleaseSet(projectId, signal);
    return (
      releases.find((member) => member.definitionType === "monitoring-warning-threshold")
        ?.releaseRef ?? null
    );
  }, []);

  const renderThreshold = () => {
    const state = threshold.state;
    if (state.kind === "ready") {
      return state.value === null ? (
        <p className="pjmon-note">当前知识发布未包含监测预警阈值。</p>
      ) : (
        <p className="pjmon-note">
          当前阈值版本 <VersionTag>{state.value.reference.versionId}</VersionTag>
          ，它只表示当前知识配置；历史快照的判定依据以该快照已保存的冻结事实为准。
        </p>
      );
    }
    if (state.kind === "forbidden") {
      return (
        <p className="pjmon-note">
          当前会话无权读取当前知识阈值；快照与批次仍按已获准的领域事实呈现。
        </p>
      );
    }
    if (state.kind === "unavailable") {
      return (
        <p className="pjmon-note">
          当前知识阈值不可用（{state.reasons.map((reason) => reason.code).join("、")}
          ）；不影响快照读取。
        </p>
      );
    }
    if (state.kind === "error") {
      return (
        <>
          <p className="pjmon-note">
            当前知识阈值读取失败（{state.error.code}）；已获准的快照与批次保持呈现。
          </p>
          <button type="button" className="pjmon-action" onClick={threshold.retry}>
            重试读取阈值
          </button>
        </>
      );
    }
    return <p className="pjmon-note">正在读取当前知识阈值…</p>;
  };

  return (
    <AppShell
      activeNav="project"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{seriesId === undefined ? "监测数据" : "监测序列详情"}</h1>
            <p className="page-subtitle">监测序列、批次与冻结快照的统计事实</p>
          </div>
        </header>

        <SectionTabs items={[...PROJECT_NAVIGATION_ITEMS_V1]} />

        {seriesId === undefined ? (
          <PageStateView
            state={list.state}
            title="监测序列"
            emptyMessage="当前工程尚无登记监测序列"
            onRetry={list.retry}
          >
            {(page) =>
              page === null ? null : (
                <Card
                  title="监测序列"
                  extra={
                    <span className="page-subtitle">
                      共 {page.totalCount} 条 · 当前页 {page.items.length} 条
                    </span>
                  }
                >
                  {page.items.length === 0 ? (
                    <div className="pjmon-empty">当前页无登记监测序列</div>
                  ) : (
                    <DataTable
                      columns={seriesColumns}
                      rows={page.items.map((item) => ({ ...item }))}
                      onRowClick={(row) => {
                        const ref = seriesRefOf(row);
                        if (ref === null) return;
                        navigate(
                          projectPath(
                            `/projects/monitoring/${encodeURIComponent(
                              ref.reference.entityId,
                            )}?version=${encodeURIComponent(ref.reference.versionId)}`,
                          ),
                        );
                      }}
                    />
                  )}
                  {page.nextCursor !== undefined && (
                    <div className="pjmon-more">
                      <button
                        type="button"
                        className="pjmon-action"
                        onClick={() => {
                          setListPaging({ key: listKey, cursor: page.nextCursor! });
                        }}
                      >
                        继续读取后续页
                      </button>
                    </div>
                  )}
                </Card>
              )
            }
          </PageStateView>
        ) : seriesVersion === null ? (
          <PageStateView
            state={resolved.state}
            title="监测序列详情"
            forbiddenHint="该监测序列不存在或当前会话无权访问"
            onRetry={resolved.retry}
          >
            {() => (
              <Card title="监测序列详情">
                <div className="pjmon-empty">正在解析该序列的当前可见版本…</div>
              </Card>
            )}
          </PageStateView>
        ) : (
          <PageStateView
            state={detail.state}
            title="监测序列详情"
            forbiddenHint="该监测序列版本不存在或当前会话无权访问"
            onRetry={detail.retry}
          >
            {(facts) =>
              facts === null ? (
                <Card title="监测序列详情">
                  <div className="pjmon-empty">正在读取所选序列版本…</div>
                </Card>
              ) : (
                <>
                  <div className="pjmon-head">
                    <h2 className="pjmon-title">{facts.monitoringObject}</h2>
                    <span className="page-subtitle">
                      {facts.monitoringIndicator} · 单位 {facts.canonicalUnit} · 版本{" "}
                      <span className="mono">{facts.monitoringSeriesRef.reference.versionId}</span>
                    </span>
                  </div>

                  <Card title="当前知识阈值">{renderThreshold()}</Card>

                  <PageStateView
                    state={snapshots.state}
                    title="快照目录"
                    emptyMessage="该序列尚无冻结快照，快照产生前不呈现趋势曲线或统计估值"
                    onRetry={snapshots.retry}
                  >
                    {(page) =>
                      page === null ? (
                        <Card title="快照目录">
                          <div className="pjmon-empty">正在读取快照目录…</div>
                        </Card>
                      ) : (
                        <Card
                          title="快照目录"
                          extra={
                            <span className="page-subtitle">本页 {page.items.length} 个快照</span>
                          }
                        >
                          {page.items.length === 0 ? (
                            <div className="pjmon-empty">
                              该序列尚无冻结快照，快照产生前不呈现趋势曲线或统计估值
                            </div>
                          ) : (
                            <ul className="pjmon-snapshots">
                              {page.items.map((entry) => {
                                const selected =
                                  entry.monitoringSnapshotRef.reference.entityId === snapshotId &&
                                  entry.monitoringSnapshotRef.reference.versionId ===
                                    snapshotVersion;
                                return (
                                  <li
                                    key={`${entry.monitoringSnapshotRef.reference.entityId}@${entry.monitoringSnapshotRef.reference.versionId}`}
                                  >
                                    <button
                                      type="button"
                                      className={
                                        selected ? "pjmon-snapshot--active" : "pjmon-snapshot"
                                      }
                                      onClick={() => {
                                        const next = new URLSearchParams(searchParams);
                                        next.set(
                                          "snapshot",
                                          entry.monitoringSnapshotRef.reference.entityId,
                                        );
                                        next.set(
                                          "snapshotVersion",
                                          entry.monitoringSnapshotRef.reference.versionId,
                                        );
                                        setSearchParams(next, { replace: true });
                                      }}
                                    >
                                      <span className="mono">
                                        {entry.monitoringSnapshotRef.reference.entityId}@
                                        {entry.monitoringSnapshotRef.reference.versionId}
                                      </span>
                                      <span>{entry.cutoff.slice(0, 19).replace("T", " ")}</span>
                                      <span>
                                        {AVAILABILITY_LABEL[entry.availability] ??
                                          entry.availability}
                                      </span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {page.nextCursor !== undefined && (
                            <div className="pjmon-more">
                              <button
                                type="button"
                                className="pjmon-action"
                                onClick={() =>
                                  setSnapshotPaging({
                                    key: snapshotCatalogKey,
                                    cursor: page.nextCursor!,
                                  })
                                }
                              >
                                继续读取后续快照
                              </button>
                            </div>
                          )}
                        </Card>
                      )
                    }
                  </PageStateView>

                  {snapshotMismatch ? (
                    <Card title="监测快照">
                      <div className="pjmon-empty">
                        快照参数必须成套给出（snapshot 与
                        snapshotVersion）；当前不成套，未读取任何快照，也不回落到「未选择」状态。
                      </div>
                    </Card>
                  ) : snapshotId === null ? (
                    snapshots.state.kind === "ready" &&
                    snapshots.state.value !== null &&
                    snapshots.state.value.items.length > 0 ? (
                      <Card title="监测快照">
                        <div className="pjmon-empty">
                          尚未选择快照；选定后按该版本读取冻结统计，不擅自改成最新。
                        </div>
                      </Card>
                    ) : null
                  ) : (
                    <PageStateView
                      state={snapshot.state}
                      title="监测快照"
                      emptyMessage="未读取到该快照"
                      forbiddenHint="所选快照不存在或当前会话无权访问"
                      onRetry={snapshot.retry}
                    >
                      {(selected) =>
                        !selected.read ? (
                          <Card title="监测快照">
                            <div className="pjmon-empty">正在读取所选快照…</div>
                          </Card>
                        ) : !selected.matched ? (
                          <Card title="监测快照">
                            <div className="pjmon-empty">
                              所选快照不属于该序列版本（参数错配）；已拒绝呈现，不回落其它对象或最新快照。
                            </div>
                          </Card>
                        ) : (
                          (() => {
                            const value = selected.value;
                            const unavailableFeatures = (
                              [
                                "shortTermSlope",
                                "acceleration",
                                "dominantFrequency",
                                "anomalyScore",
                              ] as const
                            )
                              .map((key) => ({ key, feature: value.features[key] }))
                              .filter((entry) => entry.feature.status !== "available");
                            return (
                              <>
                                <div className="pjmon-chart-row">
                                  <Card
                                    title={`快照对齐点序列（${value.window.from.slice(0, 10)} ~ ${value.window.to.slice(0, 10)}）`}
                                    extra={
                                      <VersionTag>
                                        快照 {value.monitoringSnapshotRef.reference.versionId}
                                      </VersionTag>
                                    }
                                  >
                                    {value.alignedPoints.length === 0 ? (
                                      <div className="pjmon-empty">快照窗口内无对齐点</div>
                                    ) : (
                                      <TrendLine
                                        points={value.alignedPoints.map((point) => ({
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
                                    value={(value.coverageRatio * 100).toFixed(1)}
                                    unit="%"
                                    tag={AVAILABILITY_LABEL[value.availability]}
                                    tone={value.availability === "unavailable" ? "risk" : "default"}
                                  />
                                  {(
                                    [
                                      "shortTermSlope",
                                      "acceleration",
                                      "dominantFrequency",
                                      "anomalyScore",
                                    ] as const
                                  ).map((key) => {
                                    const feature = value.features[key];
                                    return (
                                      <KpiCard
                                        key={key}
                                        label={FEATURE_LABEL[key] ?? key}
                                        value={
                                          feature.status === "available" &&
                                          feature.value !== undefined
                                            ? feature.value
                                            : "—"
                                        }
                                        unit={feature.unit ?? ""}
                                        tag={
                                          feature.status === "available"
                                            ? "有效"
                                            : (feature.reasonCode ?? "不可用")
                                        }
                                      />
                                    );
                                  })}
                                </div>

                                {value.availabilityReasons.length > 0 && (
                                  <p className="pjmon-note">
                                    快照可用性原因：{value.availabilityReasons.join("、")}
                                  </p>
                                )}
                                {unavailableFeatures.length > 0 && (
                                  <p className="pjmon-note">
                                    特征不可用原因：
                                    {unavailableFeatures
                                      .map(
                                        (entry) =>
                                          `${FEATURE_LABEL[entry.key]} ${entry.feature.reasonCode ?? "未说明"}`,
                                      )
                                      .join("；")}
                                  </p>
                                )}

                                {value.evidenceReferences.length > 0 && (
                                  <Card title="快照证据定位">
                                    <div className="pjmon-evidence">
                                      {value.evidenceReferences.map((reference) => (
                                        <EvidenceLink
                                          key={reference.sourceSegmentId}
                                          segmentId={reference.sourceSegmentId}
                                          sourceVersionRef={reference.sourceVersionRef}
                                          referencedBy={
                                            value.monitoringSnapshotRef.reference.entityId
                                          }
                                        />
                                      ))}
                                    </div>
                                  </Card>
                                )}
                              </>
                            );
                          })()
                        )
                      }
                    </PageStateView>
                  )}

                  <Card title="批次与快照登记事实">
                    <DataTable
                      columns={batchColumns}
                      rows={facts.batches.map((batch) => ({ ...batch }))}
                    />
                    {facts.batches.length === 0 && (
                      <div className="pjmon-empty">该序列尚无登记批次</div>
                    )}
                    {facts.nextCursor !== undefined && (
                      <div className="pjmon-more">
                        <button
                          type="button"
                          className="pjmon-action"
                          onClick={() =>
                            setDetailPaging({ key: detailKey, cursor: facts.nextCursor! })
                          }
                        >
                          继续读取后续批次
                        </button>
                      </div>
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
