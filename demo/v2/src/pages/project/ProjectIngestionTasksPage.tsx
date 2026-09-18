// P-PJ-08 接入任务列表/详情：A+C 复合骨架（左 2fr 列表，右 3fr 运行区）。
// 数据：engineering-data.register-monitoring-batch 所属接入通路；
// 页面级能力位 engineering-data.read（框架层门控）。
// 运行区：运行头部七字段 + 阶段条 + 子任务表 + 结果汇总。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import {
  INGESTION_TASKS,
  type IngestionTaskFixture,
  type IngestionTaskStatus,
} from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextSubtitle,
  DataTable,
  Field,
  FilterChips,
  VersionedRefText,
  formatDateTime,
  formatDuration,
} from './widgets';

type KindFilter = 'all' | 'source-delivery' | 'monitoring-batch';

const KIND_FILTER_OPTIONS: readonly { readonly key: KindFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'source-delivery', label: '资料交付' },
  { key: 'monitoring-batch', label: '监测批次' },
];

const TASK_STATUS_LABELS: Readonly<Record<IngestionTaskStatus, string>> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  failed: '失败',
};

const TASK_STATUS_TONES: Readonly<Record<IngestionTaskStatus, 'neutral' | 'blue' | 'success' | 'risk-1'>> = {
  queued: 'neutral',
  running: 'blue',
  succeeded: 'success',
  failed: 'risk-1',
};

const STAGE_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: '未开始',
  running: '进行中',
  succeeded: '已完成',
  failed: '失败',
};

function RunDetail({ task }: { readonly task: IngestionTaskFixture }) {
  return (
    <div>
      <section className="pj-card">
        <h3>运行详情</h3>
        <dl className="pj-field-grid">
          <Field label="运行标识">
            <span className="mono">{task.taskId}</span>
          </Field>
          <Field label="状态">
            <Badge tone={TASK_STATUS_TONES[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
          </Field>
          <Field label="阶段">
            <span className="mono">
              {task.stages.find((stage) => stage.status === 'running')?.code ??
                (task.status === 'succeeded'
                  ? task.stages[task.stages.length - 1]?.code
                  : task.stages.find((stage) => stage.status === 'failed')?.code ??
                    task.stages[0]?.code)}
            </span>
          </Field>
          <Field label="触发原因">{task.triggerReason}</Field>
          <Field label="操作者">
            <span className="mono">{task.operatorId}</span>
          </Field>
          <Field label="启动时间">{formatDateTime(task.startedAt)}</Field>
          <Field label="幂等键">
            <span className="mono">{task.idempotencyKey}</span>
          </Field>
        </dl>
        <p className="pj-form-note" style={{ marginTop: 'var(--space-3)' }}>
          接入对象 <VersionedRefText label="接入对象" reference={task.subjectRef} /> · {task.subjectLabel}
        </p>
      </section>
      <section className="pj-card">
        <h3>阶段条</h3>
        <ol className="pj-stage-bar">
          {task.stages.map((stage) => (
            <li key={stage.code} className={`pj-stage pj-stage-${stage.status}`}>
              <code>{stage.code}</code>
              <span>{stage.label}</span>
              <span>{STAGE_STATUS_LABELS[stage.status]}</span>
            </li>
          ))}
        </ol>
        <DataTable caption="子任务表" head={['阶段', '子任务', '状态', '耗时', '错误码']}>
          {task.stages.map((stage) => (
            <tr key={stage.code}>
              <td className="mono">{stage.code}</td>
              <td>{stage.label}</td>
              <td>
                <Badge tone={stage.status === 'failed' ? 'risk-1' : stage.status === 'succeeded' ? 'success' : stage.status === 'running' ? 'blue' : 'neutral'}>
                  {STAGE_STATUS_LABELS[stage.status]}
                </Badge>
              </td>
              <td className="mono">
                {stage.durationMs === undefined ? '—' : formatDuration(stage.durationMs)}
              </td>
              <td className="mono">{stage.errorCode ?? '—'}</td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="pj-card">
        <h3>结果汇总</h3>
        {task.summary === null ? (
          <p className="pj-notice">
            {task.status === 'failed'
              ? '任务失败，未产生入库结果；修正后可凭同一幂等键重新提交。'
              : '任务尚未完成，结果将在阶段条全部结束后汇总。'}
          </p>
        ) : (
          <>
            <dl className="pj-field-grid">
              <Field label="产出计数">
                <span className="mono">{task.summary.outputCount}</span>
              </Field>
              <Field label="成功率">
                <span className="mono">{Math.round(task.summary.successRatio * 100)}%</span>
              </Field>
            </dl>
            <ul className="pj-list" style={{ marginTop: 'var(--space-3)' }}>
              {task.summary.outputRefs.map((ref) => (
                <li key={ref.path} className="pj-list-item">
                  <a href={`#${ref.path}`}>{ref.label}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function IngestionContent() {
  const [filter, setFilter] = useState<KindFilter>('all');
  const [selectedId, setSelectedId] = useState(INGESTION_TASKS[0]?.taskId ?? '');
  const tasks = INGESTION_TASKS.filter((task) => filter === 'all' || task.kind === filter);
  const selected = INGESTION_TASKS.find((task) => task.taskId === selectedId) ?? INGESTION_TASKS[0];
  return (
    <>
      <ContextSubtitle
        items={[
          '工程 PRJ-001 · 站隧一体化标',
          '数据时点 2026-08-29 08:30',
          `接入任务 ${INGESTION_TASKS.length} 条`,
        ]}
      />
      <div className="pj-master-detail">
        <div>
          <FilterChips label="按任务类型筛选" options={KIND_FILTER_OPTIONS} value={filter} onChange={setFilter} />
          {tasks.length === 0 ? (
            <p className="pj-notice">当前筛选下没有接入任务。</p>
          ) : (
            <ul className="pj-list">
              {tasks.map((task) => (
                <li key={task.taskId}>
                  <button
                    type="button"
                    className={`pj-list-item${task.taskId === selected.taskId ? ' pj-list-item-active' : ''}`}
                    aria-pressed={task.taskId === selected.taskId}
                    onClick={() => setSelectedId(task.taskId)}
                  >
                    <span className="pj-list-item-title">
                      <span className="mono">{task.taskId}</span>
                      <Badge tone={TASK_STATUS_TONES[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
                    </span>
                    <span className="pj-list-item-sub">
                      {task.kind === 'source-delivery' ? '资料交付' : '监测批次'} · {task.subjectLabel}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <RunDetail task={selected} />
      </div>
    </>
  );
}

export function ProjectIngestionTasksPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="接入任务列表/详情"
      state={input.pageState}
      skeleton="A+C"
      emptyMessage="当前工程暂无接入任务；登记资料或监测批次后在此跟踪接入进度。"
      content={<IngestionContent />}
    />
  );
}
