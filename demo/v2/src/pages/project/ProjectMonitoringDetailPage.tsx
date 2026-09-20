// P-PJ-10 监测序列详情：B 详情骨架。
// 数据：engineering-data.monitoring-snapshot-query；页面级能力位 engineering-data.read（框架层门控）。
// TrendChart 呈现序列趋势（阈值线 + 越限段），样本与批次均呈现双时间（数据时间 / 接入时间）。

import type { RouteRenderInput } from '../../app/routes';
import { TrendChart, type TrendPoint } from '../../charts';
import {
  findMonitoringSeries,
  type MonitoringSeriesFixture,
} from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  BusinessTimeline,
  DataTable,
  Field,
  FieldGroup,
  VersionedRefText,
  formatDateTime,
} from './widgets';

const AVAILABILITY_LABELS: Readonly<Record<string, string>> = {
  available: '完整可用',
  partial: '部分可用',
  unavailable: '不可用',
};

const FEATURE_LABELS: Readonly<Record<string, string>> = {
  'short-term-slope': '短期斜率',
  acceleration: '加速度',
  'dominant-frequency': '主频',
  'anomaly-score': '异常评分',
};

const POINT_STATUS_LABELS: Readonly<Record<string, string>> = {
  available: '有效',
  interpolated: '插值',
  missing: '缺失',
};

const RELATION_LABELS: Readonly<Record<string, string>> = {
  original: '原始批次',
  correction: '订正批次',
  supplement: '补充批次',
};

function isExceeded(series: MonitoringSeriesFixture, value: number): boolean {
  return series.threshold.direction === 'above'
    ? value > series.threshold.value
    : value < series.threshold.value;
}

function SeriesDetail({ series }: { readonly series: MonitoringSeriesFixture }) {
  const points: TrendPoint[] = series.snapshot.points
    .filter((point) => point.value !== null)
    .map((point) => ({
      x: point.sampledAt.slice(5, 10),
      y: point.value ?? 0,
      exceeded: isExceeded(series, point.value ?? 0),
      riskLevel: series.threshold.riskLevel,
    }));
  return (
    <>
      <FieldGroup title="序列信息">
        <Field label="序列标识">
          <span className="mono">{series.seriesId}</span>
        </Field>
        <Field label="监测对象">{series.monitoringObject}</Field>
        <Field label="监测指标">{series.monitoringIndicator}</Field>
        <Field label="参数代码">
          <span className="mono">{series.parameterCode}</span>
        </Field>
        <Field label="标准单位">
          <span className="mono">{series.canonicalUnit}</span>
        </Field>
        <Field label="空间区段">
          <span className="mono">{series.spatialScopeRef.reference.entityId}</span>
        </Field>
        <Field label="序列修订">
          <VersionedRefText label="监测序列" reference={series.monitoringSeriesRef} />
        </Field>
        <Field label="生效区间">自 {series.effectivePeriod.validFrom.slice(0, 10)} 起</Field>
      </FieldGroup>
      <FieldGroup title="阈值与快照配置">
        <Field label="监测预警阈值">
          {series.threshold.label}
          <br />
          <span className="mono pj-form-note">
            阈值配置 {series.threshold.thresholdRef.entityId} · {series.threshold.thresholdRef.versionId}
          </span>
        </Field>
        <Field label="越限方向">
          {series.threshold.direction === 'above' ? '超过阈值即越限' : '低于阈值即越限'}
        </Field>
        <Field label="可用性策略">
          <span className="mono">
            可用性策略 {series.availabilityPolicyRef.entityId} · {series.availabilityPolicyRef.versionId}
          </span>
        </Field>
        <Field label="算法版本">
          <span className="mono pj-form-note">
            对齐 {series.algorithmVersions.alignment} · 斜率 {series.algorithmVersions.slope} ·
            加速度 {series.algorithmVersions.acceleration} · 主频 {series.algorithmVersions.frequency} ·
            异常 {series.algorithmVersions.anomaly}
          </span>
        </Field>
      </FieldGroup>
      <section className="pj-card">
        <h3>序列趋势（数据时间轴）</h3>
        <TrendChart
          title={`${series.monitoringIndicator}趋势`}
          yUnit={series.canonicalUnit}
          thresholds={[
            {
              value: series.threshold.value,
              label: series.threshold.label,
              riskLevel: series.threshold.riskLevel,
            },
          ]}
          series={[{ key: series.seriesId, label: series.monitoringIndicator, points }]}
          emptyMessage="暂无监测样本"
        />
        <p className="pj-form-note">
          横轴为数据时间（样本发生时间）；接入时间见下方样本表与批次表。
        </p>
      </section>
      <section className="pj-card">
        <h3>快照与特征</h3>
        <dl className="pj-field-grid">
          <Field label="监测快照">
            <VersionedRefText label="监测快照" reference={series.snapshot.monitoringSnapshotRef} />
          </Field>
          <Field label="快照截止">{formatDateTime(series.snapshot.cutoff)}</Field>
          <Field label="可用性">
            <Badge tone={series.snapshot.availability === 'available' ? 'success' : series.snapshot.availability === 'partial' ? 'review' : 'risk-1'}>
              {AVAILABILITY_LABELS[series.snapshot.availability]}
            </Badge>
          </Field>
          <Field label="覆盖率">
            <span className="mono">{Math.round(series.snapshot.coverageRatio * 100)}%</span>
          </Field>
          <Field label="可用性原因">
            {series.snapshot.availabilityReasons.length === 0
              ? '无'
              : series.snapshot.availabilityReasons.join('、')}
          </Field>
        </dl>
        <h4>派生特征</h4>
        <DataTable caption="派生特征" head={['特征', '取值', '窗口', '算法版本', '状态']}>
          {series.snapshot.features.map((feature) => (
            <tr key={feature.featureType}>
              <td>{FEATURE_LABELS[feature.featureType]}</td>
              <td className="mono">
                {feature.status === 'available'
                  ? `${feature.value}${feature.unit === undefined ? '' : ` ${feature.unit}`}`
                  : '—'}
              </td>
              <td className="mono">{feature.windowSize}</td>
              <td className="mono">{feature.algorithmVersion}</td>
              <td>
                <Badge tone={feature.status === 'available' ? 'success' : 'neutral'}>
                  {feature.status === 'available' ? '可用' : `不可用（${feature.reasonCode}）`}
                </Badge>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="pj-card">
        <h3>样本（双时间）</h3>
        <DataTable caption="对齐样本" head={['数据时间', '接入时间', '取值', '样本状态', '越限']}>
          {series.snapshot.points.map((point) => (
            <tr key={point.sampledAt}>
              <td className="mono">{formatDateTime(point.sampledAt)}</td>
              <td className="mono">{formatDateTime(point.ingestedAt)}</td>
              <td className="mono">
                {point.value === null ? '—' : `${point.value} ${series.canonicalUnit}`}
              </td>
              <td>
                <Badge tone={point.status === 'available' ? 'success' : point.status === 'interpolated' ? 'review' : 'neutral'}>
                  {POINT_STATUS_LABELS[point.status]}
                  {point.reasonCode === undefined ? '' : `（${point.reasonCode}）`}
                </Badge>
              </td>
              <td>
                {point.value !== null && isExceeded(series, point.value) ? (
                  <Badge tone="risk-2">越限</Badge>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="pj-card">
        <h3>接入批次（双时间）</h3>
        <DataTable
          caption="监测批次"
          head={['批次标识', '批次关系', '数据时间窗', '接入时间', '样本数', '指纹']}
        >
          {series.batches.map((batch) => (
            <tr key={batch.monitoringBatchRef.reference.entityId}>
              <td className="mono">{batch.monitoringBatchRef.reference.entityId}</td>
              <td>
                {RELATION_LABELS[batch.relation.kind]}
                {batch.relation.kind === 'original' ? null : (
                  <>
                    <br />
                    <span className="mono pj-form-note">
                      前批 {batch.relation.priorBatchRef.reference.entityId}
                    </span>
                  </>
                )}
              </td>
              <td className="mono">
                {formatDateTime(batch.window.from)} — {formatDateTime(batch.window.to)}
              </td>
              <td className="mono">{formatDateTime(batch.recordedAt)}</td>
              <td className="mono">{batch.sampleCount}</td>
              <td className="mono">{batch.deliveryFingerprint.slice(0, 12)}…</td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="pj-card">
        <h3>证据与追溯</h3>
        <ul className="pj-list">
          {series.snapshot.evidenceReferences.map((evidence) => (
            <li key={evidence.sourceSegmentId} className="pj-list-item">
              <span className="pj-list-item-title">
                <span className="mono">{evidence.sourceSegmentId}</span>
                <a href="#/review-audit/trace">证据追溯</a>
              </span>
              <span className="pj-list-item-sub mono">
                资料版本 {evidence.sourceVersion.entityId} · {evidence.sourceVersion.versionId} ·{' '}
                <a href={`#/projects/sources/${evidence.sourceVersion.entityId}`}>资料详情</a>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <BusinessTimeline
        events={series.batches.map((batch) => ({
          time: batch.recordedAt,
          title: `${RELATION_LABELS[batch.relation.kind]} ${batch.monitoringBatchRef.reference.entityId} 接入（样本 ${batch.sampleCount} 条）`,
          actor: batch.audit.actorId,
        }))}
      />
    </>
  );
}

export function ProjectMonitoringDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const seriesId = input.params['seriesId'] ?? '';
  const series = findMonitoringSeries(seriesId);
  return (
    <PageFrame
      title={series === undefined ? '监测序列详情' : `监测序列详情 · ${series.monitoringIndicator}`}
      state={input.pageState}
      skeleton="B"
      emptyMessage="该监测序列暂无快照数据。"
      content={
        series === undefined ? (
          <p className="pj-notice">
            未找到监测序列 <span className="mono">{seriesId}</span>，返回{' '}
            <a href="#/projects/monitoring">监测概览</a>。
          </p>
        ) : (
          <SeriesDetail series={series} />
        )
      }
    />
  );
}
