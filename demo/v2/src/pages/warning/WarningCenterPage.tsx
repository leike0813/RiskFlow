// P-WR-01 预警中心（骨架 A 列表；branch warning-response.open；能力位 warning-response.read）。
// 等级分布 DonutChart + 处置状态分布 HBarsChart（全量口径）+ 筛选栏 + 主操作区 + 预警表格。
// 七态：input.pageState 经 PageFrame 承载（强制态 > 门控 > 自然 ready），本组件不读 URL 参数。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { DonutChart, HBarsChart } from '../../charts';
import {
  SHELL_PROCESS_OPTIONS,
  SHELL_PROJECT_OPTIONS,
  SHELL_SPATIAL_OPTIONS,
} from '../../content/shell-context';
import {
  WARNING_LEVELS,
  WARNING_RECORDS,
  WARNING_TASK_STATUSES,
  WARNING_TRIGGER_TYPES,
  taskStatusById,
  triggerSummaryOf,
  warningTaskForWarning,
  type WarningLevelId,
  type WarningTaskStatusId,
  type WarningTriggerType,
} from '../../content/warning';
import { PageFrame } from '../../shared/PageFrame';
import { GatedAction, StatusChip, WarningLevelChip } from './warning-shared';
import './warning.css';

const DATA_AS_OF = '2026-08-27 09:30';

export function WarningCenterPage({ input }: { readonly input: RouteRenderInput }) {
  const [levelFilter, setLevelFilter] = useState<'' | WarningLevelId>('');
  const [statusFilter, setStatusFilter] = useState<'' | WarningTaskStatusId>('');
  const [triggerFilter, setTriggerFilter] = useState<'' | WarningTriggerType>('');

  const levelSlices = WARNING_LEVELS.map((level) => ({
    key: level.id,
    label: level.label,
    value: WARNING_RECORDS.filter((warning) => warning.warningLevel === level.id).length,
    exceeded: true,
    riskLevel: level.riskLevel,
  })).filter((slice) => slice.value > 0);

  const statusBars = WARNING_TASK_STATUSES.map((status) => ({
    key: status.id,
    label: status.label,
    value: WARNING_RECORDS.filter(
      (warning) => warningTaskForWarning(warning.warningRecordId)?.status === status.id,
    ).length,
  })).filter((bar) => bar.value > 0);

  const rows = WARNING_RECORDS.filter((warning) => {
    if (levelFilter !== '' && warning.warningLevel !== levelFilter) return false;
    if (triggerFilter !== '' && warning.triggerType !== triggerFilter) return false;
    if (statusFilter !== '') {
      const task = warningTaskForWarning(warning.warningRecordId);
      if (task?.status !== statusFilter) return false;
    }
    return true;
  });

  return (
    <PageFrame
      title="预警中心"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前上下文没有生效预警"
      content={
        <div>
          <p className="wr-subtitle">
            {SHELL_PROJECT_OPTIONS[0].label} · {SHELL_SPATIAL_OPTIONS[0].label} ·{' '}
            {SHELL_PROCESS_OPTIONS[1].label} · 数据时点 <span className="mono">{DATA_AS_OF}</span>
          </p>

          <div className="wr-charts-row">
            <DonutChart
              title="预警等级分布"
              data={levelSlices}
              centerLabel="生效预警"
              emptyMessage="暂无生效预警"
            />
            <HBarsChart
              title="处置状态分布"
              data={statusBars}
              unit="条"
              emptyMessage="暂无生效预警"
            />
          </div>

          <div className="wr-toolbar">
            <label className="wr-filter">
              预警等级
              <select
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value as '' | WarningLevelId)}
              >
                <option value="">全部等级</option>
                {WARNING_LEVELS.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="wr-filter">
              处置状态
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as '' | WarningTaskStatusId)}
              >
                <option value="">全部状态</option>
                {WARNING_TASK_STATUSES.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="wr-filter">
              触发类型
              <select
                value={triggerFilter}
                onChange={(event) => setTriggerFilter(event.target.value as '' | WarningTriggerType)}
              >
                <option value="">全部类型</option>
                {WARNING_TRIGGER_TYPES.map((triggerType) => (
                  <option key={triggerType} value={triggerType}>
                    {triggerType}
                  </option>
                ))}
              </select>
            </label>
            <div className="wr-toolbar-main">
              <a className="wr-btn wr-btn--primary" href="#/warnings/tasks">
                预警处置任务
              </a>
            </div>
          </div>

          <section className="wr-card" aria-label="预警列表">
            {rows.length === 0 ? (
              <p className="wr-muted" style={{ margin: 0 }}>
                没有符合筛选条件的预警
              </p>
            ) : (
            <div className="wr-table-wrap">
              <table className="wr-table">
                <thead>
                  <tr>
                    <th>预警标识</th>
                    <th>等级</th>
                    <th>风险事件</th>
                    <th>触发类型</th>
                    <th>触发摘要</th>
                    <th>通知状态</th>
                    <th>处置状态</th>
                    <th>开立时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((warning) => {
                    const task = warningTaskForWarning(warning.warningRecordId);
                    return (
                      <tr key={warning.warningRecordId}>
                        <td>
                          <a className="mono" href={`#/warnings/${warning.warningRecordId}`}>
                            {warning.warningRecordId}
                          </a>
                        </td>
                        <td>
                          <WarningLevelChip levelId={warning.warningLevel} />
                        </td>
                        <td>{warning.riskEventSummary}</td>
                        <td>{warning.triggerType}</td>
                        <td>{triggerSummaryOf(warning)}</td>
                        <td>{warning.notificationStatus}</td>
                        <td>
                          {task === undefined ? (
                            <span className="wr-muted">未归集</span>
                          ) : (
                            <a href={`#/warnings/tasks/${task.warningResponseTaskId}`}>
                              <StatusChip label={taskStatusById(task.status).label} />
                            </a>
                          )}
                        </td>
                        <td className="mono">{warning.openedAt}</td>
                        <td>
                          {task?.status === 'open' ? (
                            <GatedAction
                              label="确认预警"
                              branch="warning-response.acknowledge"
                              capabilities={input.capabilities}
                            />
                          ) : (
                            <span className="wr-muted">
                              {task === undefined ? '—' : `已确认 · ${task.acknowledgedBy?.actorLabel ?? ''}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </section>
        </div>
      }
    />
  );
}
