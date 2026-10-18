// PROTOTYPE · THROWAWAY — 停靠区的「助手工作」页签。
// 回答「Agent 在当前业务域的工作流程输出在哪看」。
// 展示结构化过程（输入版本 / 工具行动 / 候选 / 逐项确定性校验 / 预算 / 正式结果引用），
// **不展示模型内部思维链**（AGENTS.md §2.1 禁止保存与展示）。

import { useState } from 'react';
import {
  AGENT_TASKS,
  AGENT_TASK_STATUS_LABELS,
  AGENT_TASK_TYPE_LABELS,
  AGENT_TRIGGER_MODE_LABELS,
  type AgentTaskView,
} from '../../content/agent';
import { StateTag } from './parts';

function BudgetBar({ b }: { b: AgentTaskView['budget'] }) {
  const pct = (used: number, limit: number) => `${Math.round((used / limit) * 100)}%`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
      {[
        { l: 'Token', u: b.tokensUsed, t: b.tokensLimit },
        { l: '工具调用', u: b.toolCallsUsed, t: b.toolCallsLimit },
        { l: '候选', u: b.candidatesUsed, t: b.candidatesLimit },
      ].map((r) => (
        <div key={r.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dl-xs dl-faint" style={{ width: 48 }}>{r.l}</span>
          <span style={{ flex: 1, height: 3, background: 'var(--dl-border)', borderRadius: 2, overflow: 'hidden' }}>
            <span style={{ display: 'block', width: pct(r.u, r.t), height: '100%', background: r.u / r.t > 0.8 ? 'var(--dl-accent)' : 'var(--dl-text-3)' }} />
          </span>
          <span className="dl-xs dl-faint dl-num">{r.u}/{r.t}</span>
        </div>
      ))}
    </div>
  );
}

function TaskCard({ t }: { t: AgentTaskView }) {
  const [open, setOpen] = useState(false);
  const id = t.ref.reference.entityId;

  return (
    <div className="dl-dock-item" style={{ borderBottom: '1px solid var(--dl-border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
        aria-expanded={open}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <span className="dl-sm" style={{ fontWeight: 600 }}>{AGENT_TASK_TYPE_LABELS[t.ref.taskType]}</span>
          <StateTag state={t.status === 'completed' ? 'done' : t.status === 'failed' ? 'pending' : 'current'}>
            {AGENT_TASK_STATUS_LABELS[t.status]}
          </StateTag>
        </div>
        <div className="dl-xs dl-faint" style={{ marginTop: 2 }}>
          {AGENT_TRIGGER_MODE_LABELS[t.ref.triggerMode]} · {t.frozenInputKindLabel} · {id}
        </div>
        <div className="dl-xs dl-muted" style={{ marginTop: 4, lineHeight: '16px' }}>{t.summary}</div>
      </button>

      {open ? (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--dl-border)' }}>
          <div className="dl-h3 dl-faint" style={{ marginBottom: 4 }}>工具行动</div>
          {t.toolActions.map((a) => (
            <div key={a.actionId} className="dl-xs" style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
              <span style={{ color: a.outcome === 'succeeded' ? 'var(--dl-text-2)' : 'var(--risk-1)' }}>●</span>
              <span className="dl-muted">{a.toolLabel}</span>
              <span className="dl-faint" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.summary}</span>
            </div>
          ))}

          <div className="dl-h3 dl-faint" style={{ margin: '10px 0 4px' }}>确定性校验 · 逐项决定</div>
          {t.increments.map((inc) => (
            <div key={inc.incrementItemId} className="dl-xs" style={{ padding: '3px 0', borderBottom: '1px solid var(--dl-border)' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span className="dl-mono dl-faint">{inc.operationType}</span>
              </div>
              <div className="dl-muted" style={{ lineHeight: '16px' }}>{inc.summary}</div>
              <div style={{ marginTop: 2 }}>
                {inc.decision === 'accepted'
                  ? <StateTag state="done">接受</StateTag>
                  : <StateTag state="pending">拒绝</StateTag>}
                <span className="dl-faint" style={{ marginLeft: 6 }}>{inc.reason}</span>
              </div>
            </div>
          ))}

          <div className="dl-h3 dl-faint" style={{ margin: '10px 0 2px' }}>资源预算</div>
          <BudgetBar b={t.budget} />
          <div className="dl-xs dl-faint" style={{ marginTop: 4 }}>墙钟 {t.budget.wallClockSeconds}s / 上限 {t.budget.wallClockLimitSeconds}s</div>

          {t.outcome ? (
            <>
              <div className="dl-h3 dl-faint" style={{ margin: '10px 0 2px' }}>正式结果</div>
              <div className="dl-xs dl-muted">{t.outcome.candidateLabel}</div>
              <div className="dl-xs dl-faint">{t.outcome.formalResultNote}</div>
            </>
          ) : null}
          {t.waitingNote ? <div className="dl-xs dl-muted" style={{ marginTop: 4 }}>等待：{t.waitingNote}</div> : null}
          {t.failure ? (
            <div className="dl-xs" style={{ marginTop: 4 }}>
              失败：{t.failure.errorCode} · {t.failure.stageCode} ·{' '}
              {t.failure.retryable ? '可重试' : '不可重试'}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AgentWorkTab() {
  const running = AGENT_TASKS.filter((t: AgentTaskView) => t.status === 'running' || t.status === 'waiting');
  const rest = AGENT_TASKS.filter((t: AgentTaskView) => !(t.status === 'running' || t.status === 'waiting'));

  return (
    <>
      <div className="dl-xs dl-faint" style={{ marginBottom: 6, lineHeight: '16px' }}>
        本工程 {AGENT_TASKS.length} 个助手任务，其中 {running.length} 个进行中。展开可看工具行动、逐项校验与资源预算。
      </div>
      {running.length ? (
        <>
          <div className="dl-h3 dl-faint" style={{ margin: '4px 0 2px' }}>进行中</div>
          {running.map((t: AgentTaskView) => <TaskCard key={t.ref.reference.entityId} t={t} />)}
        </>
      ) : null}
      <div className="dl-h3 dl-faint" style={{ margin: '10px 0 2px' }}>已结束</div>
      {rest.map((t: AgentTaskView) => <TaskCard key={t.ref.reference.entityId} t={t} />)}
    </>
  );
}
