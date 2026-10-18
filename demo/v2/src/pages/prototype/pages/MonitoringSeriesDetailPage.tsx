// PROTOTYPE · THROWAWAY — 票 05 第 6 页：监测序列详情。
// 用词：不用「快照」，一律说「监测截止点」「已冻结的监测数据」。

import { TrendChart, type TrendPoint } from '../../../charts';
import { MONITORING_SERIES, type MonitoringFeatureFixture } from '../../../content/project';
import { AgentNote, Ids, KeyValue, RiskBadge, Section, StateTag, Tag, Timeline } from '../parts';

/** 主路径那条地表沉降序列。 */
const series = MONITORING_SERIES[0];

const AVAILABILITY_LABELS: Readonly<Record<string, string>> = {
  available: '数据完整',
  partial: '部分缺测',
  unavailable: '暂不可用',
};

const FEATURE_LABELS: Readonly<Record<MonitoringFeatureFixture['featureType'], string>> = {
  'short-term-slope': '短期斜率',
  acceleration: '加速度',
  'dominant-frequency': '主频',
  'anomaly-score': '异常评分',
};

const BATCH_RELATION_LABELS: Readonly<Record<string, string>> = {
  original: '首批接入',
  correction: '订正',
  supplement: '补充',
};

const points: readonly TrendPoint[] = series.snapshot.points
  .filter((point) => point.value !== null)
  .map((point) => {
    const value = point.value ?? 0;
    const exceeded =
      series.threshold.direction === 'above'
        ? value > series.threshold.value
        : value < series.threshold.value;
    return {
      x: point.sampledAt.slice(5, 10),
      y: value,
      exceeded,
      ...(exceeded ? { riskLevel: series.threshold.riskLevel } : {}),
    };
  });

export function MonitoringSeriesDetailPage() {
  const missingPoints = series.snapshot.points.filter((point) => point.value === null);

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">工程 / 监测 / {series.monitoringIndicator}</div>
          <h1 className="dl-h1">{series.monitoringObject}</h1>
          <div className="dl-head-meta dl-sm dl-faint">
            <Tag>{series.monitoringIndicator}</Tag>
            <span>
              最新 {series.latestValue} {series.canonicalUnit}（{series.latestSampledAt.slice(0, 16).replace('T', ' ')}）
            </span>
            <span>·</span>
            <span>监测截止点 {series.snapshot.cutoff.slice(0, 16).replace('T', ' ')}</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">导出本期数据</button>
          <button className="dl-btn" type="button">申请阈值校准</button>
        </div>
      </header>

      <AgentNote
        why={`依据截止点之前的 ${series.snapshot.points.length} 个样本、${series.batches.length} 个接入批次与本序列的阈值配置；开预警与调阈值都是人的决定。`}
        actions={<button className="dl-btn dl-btn--sm" type="button">开立预警</button>}
      >
        助手比对了本期已冻结的监测数据：最近值 {series.latestValue} {series.canonicalUnit}，
        {series.exceeded
          ? `已越过${series.threshold.label}，方向为${series.threshold.direction === 'above' ? '偏高' : '偏低'}。`
          : `尚未越过${series.threshold.label}。`}
        {missingPoints.length > 0 ? `另有 ${missingPoints.length} 个样本缺测，趋势判断按可用部分给出。` : ''}
      </AgentNote>

      <Section
        title="监测曲线"
        action={<span className="dl-xs dl-faint">越限区间铺风险色；刻度按数据与阈值自适应</span>}
      >
        <TrendChart
          series={[{ key: series.seriesId, label: `${series.monitoringIndicator}（${series.canonicalUnit}）`, points }]}
          thresholds={[
            { value: series.threshold.value, label: series.threshold.label, riskLevel: series.threshold.riskLevel },
          ]}
          yUnit={series.canonicalUnit}
          width={760}
          height={220}
        />
      </Section>

      <Section title="序列口径">
        <KeyValue
          items={[
            ['监测对象', series.monitoringObject],
            ['监测指标', series.monitoringIndicator],
            ['计量单位', series.canonicalUnit],
            [
              '预警阈值',
              <>
                {series.threshold.value} {series.canonicalUnit}
                <span className="dl-faint"> · {series.threshold.direction === 'above' ? '高于阈值触发' : '低于阈值触发'}</span>
              </>,
            ],
            [
              '当前判定',
              series.exceeded ? (
                <RiskBadge levelId={`level-${series.threshold.riskLevel}`} label="已越限" />
              ) : (
                <Tag>未越限</Tag>
              ),
            ],
            ['监测截止点', series.snapshot.cutoff.slice(0, 16).replace('T', ' ')],
            [
              '数据完整度',
              <>
                {AVAILABILITY_LABELS[series.snapshot.availability]} · 覆盖{' '}
                {Math.round(series.snapshot.coverageRatio * 100)}%
                {series.snapshot.availabilityReasons.length > 0
                  ? ` · ${series.snapshot.availabilityReasons.join('、')}`
                  : ''}
              </>,
            ],
            ['生效期间', `自 ${series.effectivePeriod.validFrom.slice(0, 10)}`],
          ]}
        />
      </Section>

      <Section title="逐期读数" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>数据时间</th>
              <th style={{ width: 88 }} className="is-right">读数</th>
              <th style={{ width: 88 }}>状态</th>
              <th>接入时间</th>
              <th>与阈值比较</th>
            </tr>
          </thead>
          <tbody>
            {[...series.snapshot.points].reverse().map((point) => {
              const value = point.value;
              const exceeded =
                value !== null &&
                (series.threshold.direction === 'above'
                  ? value > series.threshold.value
                  : value < series.threshold.value);
              return (
                <tr key={point.sampledAt}>
                  <td className="dl-sm">{point.sampledAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="is-num is-right">
                    {value === null ? '—' : `${value} ${series.canonicalUnit}`}
                  </td>
                  <td>
                    <StateTag state={point.status === 'available' ? 'done' : 'pending'}>
                      {point.status === 'available' ? '实测' : point.status === 'interpolated' ? '插补' : '缺测'}
                    </StateTag>
                  </td>
                  <td className="dl-sm dl-faint">{point.ingestedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="dl-sm">
                    {value === null ? (
                      <span className="dl-faint">缺测（{point.reasonCode ?? '未说明'}）</span>
                    ) : exceeded ? (
                      <RiskBadge levelId={`level-${series.threshold.riskLevel}`} label="越过阈值" />
                    ) : (
                      <span className="dl-faint">未越过阈值</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="趋势特征" flush action={<span className="dl-xs dl-faint">由本序列样本计算，随算法版本标注</span>}>
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>特征</th>
              <th style={{ width: 104 }} className="is-right">取值</th>
              <th style={{ width: 104 }}>计算窗口</th>
              <th>算法</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {series.snapshot.features.map((feature) => (
              <tr key={feature.featureType}>
                <td>{FEATURE_LABELS[feature.featureType]}</td>
                <td className="is-num is-right">
                  {feature.value === undefined ? '—' : `${feature.value}${feature.unit ? ` ${feature.unit}` : ''}`}
                </td>
                <td className="dl-sm dl-faint">{feature.windowSize} 期</td>
                <td className="dl-xs dl-faint dl-mono">{feature.algorithmVersion}</td>
                <td>
                  <StateTag state={feature.status === 'available' ? 'done' : 'pending'}>
                    {feature.status === 'available' ? '可用' : `不可用（${feature.reasonCode ?? '未说明'}）`}
                  </StateTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="接入批次" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 176 }}>数据时间窗</th>
              <th style={{ width: 76 }}>关系</th>
              <th style={{ width: 64 }} className="is-right">样本数</th>
              <th>来源资料</th>
              <th style={{ width: 120 }}>接入时间</th>
            </tr>
          </thead>
          <tbody>
            {series.batches.map((batch) => (
              <tr key={batch.monitoringBatchRef.reference.entityId}>
                <td className="dl-sm">
                  {batch.window.from.slice(0, 10)} → {batch.window.to.slice(0, 16).replace('T', ' ')}
                </td>
                <td>
                  <Tag>{BATCH_RELATION_LABELS[batch.relation.kind] ?? batch.relation.kind}</Tag>
                </td>
                <td className="is-num is-right">{batch.sampleCount}</td>
                <td className="dl-sm dl-faint">
                  {batch.sourceVersionRef.reference.entityId} {batch.sourceVersionRef.reference.versionId}
                </td>
                <td className="dl-sm dl-faint">{batch.recordedAt.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="数据来源" flush action={<span className="dl-xs dl-faint">本序列每个读数都能回到资料的具体时段</span>}>
        <table className="dl-table">
          <thead>
            <tr>
              <th>证据资料段</th>
              <th style={{ width: 160 }}>资料版本</th>
            </tr>
          </thead>
          <tbody>
            {series.snapshot.evidenceReferences.map((reference) => (
              <tr key={reference.sourceSegmentId}>
                <td className="dl-mono">{reference.sourceSegmentId}</td>
                <td className="dl-sm dl-faint">
                  {reference.sourceVersion.entityId} {reference.sourceVersion.versionId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="处理过程" flush>
        <Timeline
          items={series.batches.map((batch, index) => ({
            at: batch.recordedAt.slice(5, 16).replace('T', ' '),
            title: `${batch.window.from.slice(0, 10)} 至 ${batch.window.to.slice(0, 16).replace('T', ' ')} 区间接入`,
            state: index === 0 ? 'current' : 'done',
            meta: <Tag>{BATCH_RELATION_LABELS[batch.relation.kind] ?? batch.relation.kind}</Tag>,
            body: (
              <div className="dl-sm dl-faint">
                样本 {batch.sampleCount} 条 · 来自 {batch.sourceVersionRef.reference.entityId} · 登记说明{' '}
                {batch.audit.reason}
              </div>
            ),
          }))}
        />
      </Section>

      <Ids
        pairs={[
          ['序列', `${series.seriesId} ${series.monitoringSeriesRef.reference.versionId}`],
          ['阈值配置', `${series.threshold.thresholdRef.entityId} ${series.threshold.thresholdRef.versionId}`],
          ['可用性口径', `${series.availabilityPolicyRef.entityId} ${series.availabilityPolicyRef.versionId}`],
          ['监测截止点数据', `${series.snapshot.monitoringSnapshotRef.reference.entityId} ${series.snapshot.monitoringSnapshotRef.reference.versionId}`],
          ...Object.entries(series.algorithmVersions).map(([key, value]) => [key, value] as const),
        ]}
      />
    </div>
  );
}
