// P-PJ-09 监测概览：A 列表骨架。
// 数据：engineering-data.monitoring-snapshot-query；页面级能力位 engineering-data.read（框架层门控）。
// 每行给出最新样本的双时间（数据时间 / 接入时间）与越限状态（文字徽标）。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { MONITORING_SERIES } from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextSubtitle,
  DataTable,
  FilterChips,
  formatDateTime,
} from './widgets';

type StatusFilter = 'all' | 'exceeded' | 'normal';

const STATUS_FILTER_OPTIONS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'exceeded', label: '越限' },
  { key: 'normal', label: '正常' },
];

const AVAILABILITY_LABELS: Readonly<Record<string, string>> = {
  available: '完整可用',
  partial: '部分可用',
  unavailable: '不可用',
};

function MonitoringContent() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const series = MONITORING_SERIES.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'exceeded') return item.exceeded;
    return !item.exceeded;
  });
  return (
    <>
      <ContextSubtitle
        items={[
          '工程 PRJ-001 · 站隧一体化标',
          '区段 SS-001 · 始发井至换乘段',
          `快照截止 2026-08-27 09:00 · 越限 ${MONITORING_SERIES.filter((item) => item.exceeded).length} 条`,
        ]}
      />
      <div className="pj-actions">
        <a className="pj-btn" href="#/projects/ingestion-tasks">
          查看接入任务
        </a>
      </div>
      <section className="pj-card">
        <FilterChips label="按越限状态筛选" options={STATUS_FILTER_OPTIONS} value={filter} onChange={setFilter} />
        {series.length === 0 ? (
          <p className="pj-notice">当前筛选下没有监测序列。</p>
        ) : (
          <DataTable
            caption="监测序列概览"
            head={['序列标识', '监测对象', '监测指标', '最新值', '数据时间', '接入时间', '快照可用性', '状态']}
          >
            {series.map((item) => (
              <tr key={item.seriesId}>
                <td className="mono">
                  <a href={`#/projects/monitoring/${item.seriesId}`}>{item.seriesId}</a>
                </td>
                <td>{item.monitoringObject}</td>
                <td>{item.monitoringIndicator}</td>
                <td className="mono">
                  {item.latestValue} {item.canonicalUnit}
                </td>
                <td className="mono">{formatDateTime(item.latestSampledAt)}</td>
                <td className="mono">{formatDateTime(item.latestIngestedAt)}</td>
                <td>
                  <Badge tone={item.snapshot.availability === 'available' ? 'success' : item.snapshot.availability === 'partial' ? 'review' : 'risk-1'}>
                    {AVAILABILITY_LABELS[item.snapshot.availability]}
                  </Badge>
                </td>
                <td>
                  <Badge tone={item.exceeded ? 'risk-2' : 'risk-4'}>
                    {item.exceeded ? '越限' : '正常'}
                  </Badge>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}

export function ProjectMonitoringPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="监测概览"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前区段暂无监测序列；登记监测批次后在此查看序列状态。"
      content={<MonitoringContent />}
    />
  );
}
