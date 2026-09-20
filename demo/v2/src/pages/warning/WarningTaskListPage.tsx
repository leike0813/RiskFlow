// P-WR-03 预警处置任务列表（骨架 A 列表；branch warning-response.acknowledge；
// 能力位 warning-response.read）。筛选栏 + 主操作区 + 任务表格（状态机当前态与确认人）。
// 七态：input.pageState 经 PageFrame 承载，本组件不读 URL 参数。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { ROLE_LABELS } from '../../app/contract-mirror';
import {
  SHELL_PROCESS_OPTIONS,
  SHELL_PROJECT_OPTIONS,
  SHELL_SPATIAL_OPTIONS,
} from '../../content/shell-context';
import {
  WARNING_RESPONSE_TASKS,
  WARNING_TASK_STATUSES,
  taskStatusById,
  type WarningTaskStatusId,
} from '../../content/warning';
import { PageFrame } from '../../shared/PageFrame';
import { StatusChip, WarningLevelChip } from './warning-shared';
import './warning.css';

const DATA_AS_OF = '2026-08-27 09:30';

export function WarningTaskListPage({ input }: { readonly input: RouteRenderInput }) {
  const [statusFilter, setStatusFilter] = useState<'' | WarningTaskStatusId>('');

  const rows = WARNING_RESPONSE_TASKS.filter(
    (task) => statusFilter === '' || task.status === statusFilter,
  );

  return (
    <PageFrame
      title="预警处置任务列表"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前上下文没有预警处置任务"
      content={
        <div>
          <p className="wr-subtitle">
            {SHELL_PROJECT_OPTIONS[0].label} · {SHELL_SPATIAL_OPTIONS[0].label} ·{' '}
            {SHELL_PROCESS_OPTIONS[1].label} · 数据时点 <span className="mono">{DATA_AS_OF}</span>
          </p>

          <div className="wr-toolbar">
            <label className="wr-filter">
              任务状态
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
            <div className="wr-toolbar-main">
              <a className="wr-btn wr-btn--primary" href="#/warnings">
                预警中心
              </a>
            </div>
          </div>

          <section className="wr-card" aria-label="预警处置任务">
            <div className="wr-table-wrap">
              <table className="wr-table">
                <thead>
                  <tr>
                    <th>任务标识</th>
                    <th>任务名称</th>
                    <th>关联预警</th>
                    <th>最高等级</th>
                    <th>状态</th>
                    <th>责任角色</th>
                    <th>确认人</th>
                    <th>开立时间</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((task) => (
                    <tr key={task.warningResponseTaskId}>
                      <td>
                        <a className="mono" href={`#/warnings/tasks/${task.warningResponseTaskId}`}>
                          {task.warningResponseTaskId}
                        </a>
                      </td>
                      <td>{task.title}</td>
                      <td>
                        {task.warningRecordIds.map((warningId) => (
                          <a key={warningId} className="mono" href={`#/warnings/${warningId}`}>
                            {warningId}
                          </a>
                        ))}
                      </td>
                      <td>
                        <WarningLevelChip levelId={task.highestWarningLevel} />
                      </td>
                      <td>
                        <StatusChip label={taskStatusById(task.status).label} />
                      </td>
                      <td>{ROLE_LABELS[task.ownerRole]}</td>
                      <td>
                        {task.acknowledgedBy === null ? (
                          <span className="wr-muted">待确认</span>
                        ) : (
                          <>
                            {task.acknowledgedBy.actorLabel}{' '}
                            <span className="mono wr-muted">{task.acknowledgedBy.at}</span>
                          </>
                        )}
                      </td>
                      <td className="mono">{task.openedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 ? <p className="wr-muted">没有符合筛选条件的处置任务</p> : null}
          </section>
        </div>
      }
    />
  );
}
