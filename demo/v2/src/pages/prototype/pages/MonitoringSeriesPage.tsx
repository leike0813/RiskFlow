// PROTOTYPE · THROWAWAY — 票 05 第 5 页：监测序列列表。

import { INDICATOR_ITEMS } from '../../../content/assessment';
import { MONITORING_SERIES, type MonitoringSeriesFixture } from '../../../content/project';
import { AgentNote, Ids, RiskBadge, Section, Stats, Tag } from '../parts';

const AVAILABILITY_LABELS: Readonly<Record<MonitoringSeriesFixture['snapshot']['availability'], string>> = {
  available: '数据完整',
  partial: '部分缺测',
  unavailable: '暂不可用',
};

function goto(pageKey: string) {
  window.location.hash = `#/prototype/ui?p=${pageKey}`;
}

export function MonitoringSeriesPage() {
  const exceeded = MONITORING_SERIES.filter((series) => series.exceeded);
  const partial = MONITORING_SERIES.filter((series) => series.snapshot.availability !== 'available');

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">工程 / 监测</div>
          <h1 className="dl-h1">监测序列</h1>
          <div className="dl-head-meta dl-sm dl-faint">
            <span>本工程 {MONITORING_SERIES.length} 条序列</span>
            <span>·</span>
            <span>
              最新数据时间 {MONITORING_SERIES.reduce((max, s) => (s.latestSampledAt > max ? s.latestSampledAt : max), '').slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--primary" type="button">投送监测批次</button>
        </div>
      </header>

      <AgentNote
        why={`依据 ${MONITORING_SERIES.length} 条序列的已冻结监测数据与各自阈值；是否据此开预警、是否校准阈值都由人决定。`}
        actions={
          <button className="dl-btn dl-btn--sm" type="button" onClick={() => goto('monitoringDetail')}>
            看地表沉降
          </button>
        }
      >
        助手按各自阈值逐条比对：{exceeded.length} 条已越限
        （{exceeded.map((series) => series.monitoringIndicator).join('、')}），
        {partial.length > 0 ? `另有 ${partial.length} 条缺测，判断依据不完整；` : ''}
        是否据此开立预警需要你决定。
      </AgentNote>

      <Stats
        items={[
          { label: '监测序列', value: MONITORING_SERIES.length },
          { label: '已越限', value: exceeded.length },
          { label: '缺测', value: partial.length },
          {
            label: '覆盖率最低',
            value: `${Math.round(Math.min(...MONITORING_SERIES.map((s) => s.snapshot.coverageRatio)) * 100)}%`,
          },
          { label: '纳入评估的量化指标', value: INDICATOR_ITEMS.filter((item) => item.unit !== null).length },
        ]}
      />

      <Section title="序列清单" flush action={<span className="dl-xs dl-faint">点击行进入详情</span>}>
        <table className="dl-table">
          <thead>
            <tr>
              <th>监测对象</th>
              <th style={{ width: 108 }}>指标</th>
              <th style={{ width: 96 }} className="is-right">最新值</th>
              <th style={{ width: '20%' }}>阈值与当前判定</th>
              <th style={{ width: 96 }}>数据完整度</th>
              <th style={{ width: 132 }}>监测截止点</th>
              <th style={{ width: 132 }}>区间</th>
            </tr>
          </thead>
          <tbody>
            {MONITORING_SERIES.map((series) => (
              <tr
                key={series.seriesId}
                onClick={() => goto('monitoringDetail')}
                style={{ cursor: 'pointer' }}
              >
                <td>{series.monitoringObject}</td>
                <td><Tag>{series.monitoringIndicator}</Tag></td>
                <td className="is-num is-right">
                  {series.latestValue} <span className="dl-faint">{series.canonicalUnit}</span>
                </td>
                <td>
                  <div className="dl-sm dl-faint">
                    {series.threshold.direction === 'above' ? '高于' : '低于'} {series.threshold.value}{' '}
                    {series.canonicalUnit} 触发
                  </div>
                  {series.exceeded ? (
                    <RiskBadge levelId={`level-${series.threshold.riskLevel}`} label="已越限" />
                  ) : (
                    <Tag>未越限</Tag>
                  )}
                </td>
                <td className="dl-sm">
                  <div>{AVAILABILITY_LABELS[series.snapshot.availability]}</div>
                  <div className="dl-xs dl-faint">覆盖 {Math.round(series.snapshot.coverageRatio * 100)}%</div>
                </td>
                <td className="dl-sm dl-faint">{series.snapshot.cutoff.slice(0, 16).replace('T', ' ')}</td>
                <td className="dl-sm dl-faint">
                  {series.batches.length} 个批次 · 最新 {series.latestIngestedAt.slice(11, 16)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="评估用到的量化指标"
        action={<span className="dl-xs dl-faint">标有单位的项由监测数据直接供给</span>}
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 76 }}>面向</th>
              <th>指标</th>
              <th style={{ width: 88 }}>单位</th>
              <th style={{ width: 200 }}>数据来源</th>
            </tr>
          </thead>
          <tbody>
            {INDICATOR_ITEMS.map((item) => {
              const fromMonitoring = MONITORING_SERIES.some((series) =>
                item.unit !== null && series.canonicalUnit === item.unit,
              );
              return (
                <tr key={item.indicatorItem}>
                  <td><Tag accent={item.side === 'P'}>{item.side === 'P' ? '可能性' : '后果'}</Tag></td>
                  <td>{item.label}</td>
                  <td className="dl-sm dl-faint">{item.unit ?? '按档判定'}</td>
                  <td className="dl-sm dl-faint">
                    {item.unit === null
                      ? '工程资料与现场判定'
                      : fromMonitoring
                        ? `监测序列自动供给（${MONITORING_SERIES.filter((series) => series.canonicalUnit === item.unit).map((series) => series.monitoringIndicator).join('、')}）`
                        : '由监测特征计算'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Ids
        pairs={MONITORING_SERIES.map((series) => [
          series.monitoringIndicator,
          `${series.seriesId} ${series.monitoringSeriesRef.reference.versionId}`,
        ])}
      />
    </div>
  );
}
