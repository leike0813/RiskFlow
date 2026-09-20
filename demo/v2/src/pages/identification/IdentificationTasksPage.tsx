// P-RI-01 识别任务列表（A 列表骨架）。
// 骨架：A 列表（上下文副标题 + 筛选栏 + 独立主操作区 + 表格）。
// 数据 branch：risk-identification.plan；页面级能力位：risk-identification.read（框架层门控）。
// 动作级：「启动识别」需 risk-identification.run（branch risk-identification.plan 映射）。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明并保留主操作入口。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  IDENTIFICATION_RUNS,
  IDENTIFICATION_STAGE_LABELS,
  IDENTIFICATION_TRIGGER_REASON_LABELS,
  LINKS,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_TYPE_LABELS,
  type IdentificationRunStatus,
} from '../../content/identification';
import { CapabilityAction, StatusBadge } from './widgets';

const STATUS_FILTER_OPTIONS: readonly {
  readonly value: IdentificationRunStatus | 'all';
  readonly label: string;
}[] = [
  { value: 'all', label: '全部状态' },
  { value: 'completed', label: '已完成' },
  { value: 'running', label: '运行中' },
  { value: 'waiting', label: '等待中' },
  { value: 'terminal-failure', label: '失败终止' },
];

function statusTone(status: IdentificationRunStatus): 'running' | 'done' | 'waiting' | 'failed' {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  if (status === 'waiting') return 'waiting';
  return 'failed';
}

export function IdentificationTasksPage({ input }: { readonly input: RouteRenderInput }) {
  const [statusFilter, setStatusFilter] = useState<IdentificationRunStatus | 'all'>('all');
  const rows =
    statusFilter === 'all'
      ? IDENTIFICATION_RUNS
      : IDENTIFICATION_RUNS.filter((run) => run.status === statusFilter);

  return (
    <PageFrame
      title="识别任务列表"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前没有识别运行，可从右上「启动识别」发起首次识别"
      content={
        <div className="ri-page">
          <p className="ri-context-subtitle">
            示例工程 · 站隧一体化标；识别运行按 I0–I9 阶段推进，产出入库为标准化风险记录。
          </p>
          <div className="ri-list-toolbar">
            <div className="ri-filters" role="group" aria-label="筛选">
              <label>
                运行状态
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as IdentificationRunStatus | 'all')
                  }
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ri-actions">
              <CapabilityAction
                capabilities={input.capabilities}
                capability="risk-identification.run"
                href={LINKS.identificationStart}
              >
                启动识别
              </CapabilityAction>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="ri-form-note">没有符合筛选条件的识别运行。</p>
          ) : (
            <div className="ri-table-wrap">
              <table className="ri-table">
                <thead>
                  <tr>
                    <th>运行标识</th>
                    <th>状态</th>
                    <th>当前阶段</th>
                    <th>触发</th>
                    <th>操作者</th>
                    <th>启动时间</th>
                    <th>入库记录</th>
                    <th>幂等键</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((run) => (
                    <tr key={run.runId}>
                      <td>
                        <a className="mono" href={LINKS.identificationRun(run.runId)}>
                          {run.runId}
                        </a>
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(run.status)}>
                          {RUN_STATUS_LABELS[run.status]}
                        </StatusBadge>
                      </td>
                      <td>
                        <span className="mono">{run.currentStage}</span>{' '}
                        {IDENTIFICATION_STAGE_LABELS[run.currentStage]}
                      </td>
                      <td>
                        {RUN_TRIGGER_TYPE_LABELS[run.triggerType]}；<br />
                        {IDENTIFICATION_TRIGGER_REASON_LABELS[run.triggerReasonCode] ??
                          run.triggerReasonCode}
                      </td>
                      <td>
                        {run.operatorName}（<span className="mono">{run.operatorId}</span>）
                      </td>
                      <td className="mono">{run.startedAt.slice(0, 16).replace('T', ' ')}</td>
                      <td className="mono">{run.summary.acceptedRecordCount}</td>
                      <td className="mono">{run.idempotencyKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      }
    />
  );
}
