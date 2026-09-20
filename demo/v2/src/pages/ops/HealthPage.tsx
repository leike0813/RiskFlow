// P-OP-03 运行与设施健康（骨架 A 列表；branch null / 页面级能力位 null，设施域）。
// 各设施状态用 HBarsChart（近 30 日可用率 + 目标阈值）与状态徽标呈现；
// 可用率为设计样例数据并在页内标注，不声称真实运行指标。
// 七态由 PageFrame 经 input.pageState 承载，本组件不读取 URL 参数。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { HBarsChart } from '../../charts';
import {
  FACILITY_AVAILABILITY_TARGET,
  FACILITY_HEALTH,
  FACILITY_STATUS_LABELS,
  RECENT_RUN_LINKS,
  type FacilityCategory,
  type FacilityStatus,
} from '../../content/ops';
import { PageFrame } from '../../shared/PageFrame';
import { Badge, ContextLine, DataTable, FilterChips, formatDateTime } from './widgets';

type StatusFilter = 'all' | FacilityStatus;

const STATUS_FILTERS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: '全部状态' },
  { key: 'healthy', label: '正常' },
  { key: 'degraded', label: '降级' },
  { key: 'down', label: '不可用' },
];

const CATEGORY_FILTERS: readonly { readonly key: 'all' | FacilityCategory; readonly label: string }[] = [
  { key: 'all', label: '全部类别' },
  { key: '应用服务', label: '应用服务' },
  { key: '数据存储', label: '数据存储' },
  { key: '模型服务', label: '模型服务' },
  { key: '检索索引', label: '检索索引' },
  { key: '任务调度', label: '任务调度' },
];

const STATUS_TONES: Readonly<Record<FacilityStatus, 'success' | 'review' | 'neutral'>> = {
  healthy: 'success',
  degraded: 'review',
  down: 'neutral',
};

export function HealthPage({ input }: { readonly input: RouteRenderInput }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FacilityCategory>('all');

  const bars = FACILITY_HEALTH.map((facility) => ({
    key: facility.facilityId,
    label: facility.name,
    value: facility.availabilityPct,
    exceeded: facility.availabilityPct < FACILITY_AVAILABILITY_TARGET,
    riskLevel: 3 as const,
  }));

  const rows = FACILITY_HEALTH.filter((facility) => {
    if (statusFilter !== 'all' && facility.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && facility.category !== categoryFilter) return false;
    return true;
  });

  return (
    <PageFrame
      title="运行与设施健康"
      state={input.pageState}
      skeleton="A"
      emptyMessage="暂无设施健康数据"
      content={
        <div>
          <ContextLine
            items={[
              `设施 ${FACILITY_HEALTH.length} 项`,
              `降级 ${FACILITY_HEALTH.filter((facility) => facility.status === 'degraded').length} 项`,
              '数据时点 2026-09-18 09:00',
            ]}
          />

          <section className="op-card">
            <div className="op-card-head">
              <h3>近 30 日可用率</h3>
              <a href="#/review-audit/runs">运行记录</a>
            </div>
            <p className="op-note">可用率为设计样例数据，用于表达呈现形式，不代表真实运行指标。</p>
            <HBarsChart
              title="设施近 30 日可用率"
              data={bars}
              unit="%"
              maxValue={100}
              threshold={{ value: FACILITY_AVAILABILITY_TARGET, label: '可用率目标' }}
              emptyMessage="暂无可用率数据"
            />
          </section>

          <section className="op-card">
            <div className="op-card-head">
              <h3>设施状态</h3>
              <a href="#/review-audit/runs">查看运行记录</a>
            </div>
            <FilterChips
              label="按状态筛选"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <FilterChips
              label="按类别筛选"
              options={CATEGORY_FILTERS}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
            {rows.length === 0 ? (
              <p className="op-muted">当前筛选下没有设施。</p>
            ) : (
              <DataTable
                caption="设施状态列表"
                head={['设施标识', '设施', '类别', '状态', '近 30 日可用率', '说明', '最近检查']}
              >
                {rows.map((facility) => (
                  <tr key={facility.facilityId}>
                    <td className="mono">{facility.facilityId}</td>
                    <td>{facility.name}</td>
                    <td>{facility.category}</td>
                    <td>
                      <Badge tone={STATUS_TONES[facility.status]}>
                        {FACILITY_STATUS_LABELS[facility.status]}
                      </Badge>
                    </td>
                    <td className="mono">{facility.availabilityPct}%</td>
                    <td>{facility.note}</td>
                    <td className="mono">{formatDateTime(facility.audit.recordedAt)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </section>

          <section className="op-card">
            <h3>近期业务运行</h3>
            <ul className="op-timeline">
              {RECENT_RUN_LINKS.map((run) => (
                <li key={run.label}>
                  <a className="mono" href={`#${run.path}`}>
                    {run.label}
                  </a>
                  <span>{run.summary}</span>
                </li>
              ))}
            </ul>
            <p className="op-muted">
              运行全量记录见 <a href="#/review-audit/runs">运行记录</a>。
            </p>
          </section>
        </div>
      }
    />
  );
}
