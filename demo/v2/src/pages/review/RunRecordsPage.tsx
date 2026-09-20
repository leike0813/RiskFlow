// P-RV-05 运行记录（A+C 复合骨架：左运行列表 + 右运行详情）。
// 骨架：A+C 复合（左 A 列表带类型筛选，右 C 运行区：头部七字段 + 阶段条 + 子任务表 + 结果汇总）。
// 数据 branch：review-audit.trace；页面级能力位：review-audit.read（框架层门控）。
// 覆盖识别（I0–I9）与评估（A0–A9）两类运行；「打开运行详情页」深链回归属域 C 页。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「当前没有运行记录」。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  RUN_KIND_LABELS,
  RUN_RECORDS,
  RUN_STATUS_LABELS,
  type RunKind,
  type RunRecordView,
  type RunStatus,
} from '../../content/review';
import { Field, FieldCard, StageBar, StatusBadge, stageStatusLabel } from './widgets';

const KIND_FILTER_OPTIONS: readonly { readonly key: RunKind | 'all'; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'identification', label: '识别运行' },
  { key: 'assessment', label: '评估运行' },
];

function statusTone(status: RunStatus): 'running' | 'done' | 'waiting' | 'failed' {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  if (status === 'waiting') return 'waiting';
  return 'failed';
}

function subtaskTone(status: string): 'running' | 'done' | 'waiting' | 'neutral' | 'failed' {
  if (status === 'done') return 'done';
  if (status === 'active') return 'running';
  if (status === 'waiting') return 'waiting';
  if (status === 'failed') return 'failed';
  return 'neutral';
}

function RunDetail({ run }: { readonly run: RunRecordView }) {
  return (
    <div className="rv-page">
      <FieldCard title="运行详情">
        <dl className="rv-field-grid">
          <Field label="运行标识">
            <span className="mono">{run.runId}</span>
          </Field>
          <Field label="状态">
            <StatusBadge tone={statusTone(run.status)}>{RUN_STATUS_LABELS[run.status]}</StatusBadge>
          </Field>
          <Field label="当前阶段">
            <span className="mono">
              {run.currentStage} · {run.stageLabels[run.currentStage] ?? run.currentStage}
            </span>
          </Field>
          <Field label="触发原因">{run.triggerReason}</Field>
          <Field label="操作者">
            {run.operatorName}（<span className="mono">{run.operatorId}</span>）
          </Field>
          <Field label="启动时间">
            <span className="mono">{run.startedAt.slice(0, 16).replace('T', ' ')}</span>
          </Field>
          <Field label="幂等键">
            <span className="mono">{run.idempotencyKey}</span>
          </Field>
        </dl>
        <p className="rv-muted" style={{ marginTop: 'var(--space-3)' }}>
          <a href={run.detailHref}>打开运行详情页</a>
          {run.related.map((link) => (
            <span key={link.href}>
              {' · '}
              <a href={link.href}>{link.label}</a>
            </span>
          ))}
        </p>
      </FieldCard>

      <FieldCard title={`阶段条（${run.kind === 'identification' ? 'I0–I9' : 'A0–A9'}）`}>
        <StageBar stages={run.stages} labels={run.stageLabels} />
      </FieldCard>

      <FieldCard title="子任务">
        <div className="rv-table-wrap">
          <table className="rv-table">
            <thead>
              <tr>
                <th scope="col">阶段</th>
                <th scope="col">子任务</th>
                <th scope="col">状态</th>
                <th scope="col">耗时</th>
                <th scope="col">结果</th>
              </tr>
            </thead>
            <tbody>
              {run.subtasks.map((subtask) => (
                <tr key={subtask.id}>
                  <td>
                    <span className="mono">{subtask.stage}</span>{' '}
                    {run.stageLabels[subtask.stage] ?? subtask.stage}
                  </td>
                  <td>{subtask.name}</td>
                  <td>
                    <StatusBadge tone={subtaskTone(subtask.status)}>
                      {stageStatusLabel(subtask.status)}
                    </StatusBadge>
                  </td>
                  <td className="mono">{subtask.duration ?? '—'}</td>
                  <td>{subtask.result ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="结果汇总">
        <div className="rv-stat-row">
          {run.summaryItems.map((item) => (
            <div key={item.label} className="rv-stat">
              <span className="rv-stat-value">{item.value}</span>
              <span className="rv-stat-label">{item.label}</span>
            </div>
          ))}
        </div>
      </FieldCard>
    </div>
  );
}

export function RunRecordsPage({ input }: { readonly input: RouteRenderInput }) {
  const [kindFilter, setKindFilter] = useState<RunKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState(RUN_RECORDS[0]?.runId ?? '');

  const runs =
    kindFilter === 'all' ? RUN_RECORDS : RUN_RECORDS.filter((run) => run.kind === kindFilter);
  const selected = RUN_RECORDS.find((run) => run.runId === selectedId) ?? RUN_RECORDS[0];

  return (
    <PageFrame
      title="运行记录"
      state={input.pageState}
      skeleton="A+C"
      emptyMessage="当前没有运行记录；识别或评估运行启动后在此跟踪。"
      content={
        <div className="rv-page">
          <p className="rv-context-subtitle">
            示例工程 · 站隧一体化标；跨识别与评估两类运行的统一运行台账。
          </p>
          <div className="rv-master-detail">
            <div>
              <div className="rv-chips" role="group" aria-label="按运行类型筛选">
                {KIND_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`rv-chip${kindFilter === option.key ? ' rv-chip-active' : ''}`}
                    aria-pressed={kindFilter === option.key}
                    onClick={() => setKindFilter(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <ul className="rv-run-list" style={{ marginTop: 'var(--space-3)' }}>
                {runs.map((run) => (
                  <li key={run.runId}>
                    <button
                      type="button"
                      className={`rv-run-item${run.runId === selected?.runId ? ' rv-run-item-active' : ''}`}
                      aria-pressed={run.runId === selected?.runId}
                      onClick={() => setSelectedId(run.runId)}
                    >
                      <span className="rv-run-item-title">
                        <span className="mono">{run.runId}</span>
                        <StatusBadge tone={statusTone(run.status)}>
                          {RUN_STATUS_LABELS[run.status]}
                        </StatusBadge>
                      </span>
                      <span className="rv-run-item-sub">
                        {RUN_KIND_LABELS[run.kind]} · {run.triggerReason}
                      </span>
                      <span className="rv-run-item-sub mono">
                        {run.startedAt.slice(0, 16).replace('T', ' ')} · {run.idempotencyKey}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {runs.length === 0 ? <p className="rv-muted">当前筛选下没有运行记录。</p> : null}
            </div>
            {selected === undefined ? null : <RunDetail run={selected} />}
          </div>
        </div>
      }
    />
  );
}
