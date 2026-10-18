// PROTOTYPE · THROWAWAY — 票 05 第 13 页：待评估风险

import { useState } from 'react';
import {
  ASSESSMENT_BASIS_VERSIONS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  PENDING_RISKS,
  PENDING_STATUS_LABELS,
  TRIGGER_REASON_LABELS,
  type AssessmentEntryMode,
  type PendingRiskFixture,
} from '../../../content/assessment';
import { AgentNote, Ids, KeyValue, Section, Shortcuts, StateTag, Stats } from '../parts';

type BasisKey = keyof typeof BASIS_VERSION_LABELS;
const BASIS_KEYS = Object.keys(BASIS_VERSION_LABELS) as BasisKey[];
const ENTRY_MODES = Object.keys(ENTRY_MODE_LABELS) as AssessmentEntryMode[];
const TRIGGER_REASONS = Object.keys(TRIGGER_REASON_LABELS);

function StartForm({ row, onClose }: { row: PendingRiskFixture; onClose: () => void }) {
  const reassess = row.status === 'assessed';
  const [mode, setMode] = useState<AssessmentEntryMode>(reassess ? 'reassess' : 'assess');
  const [reason, setReason] = useState<string>(reassess ? 'monitoring-snapshot' : 'initial-assessment');

  return (
    <div style={{ padding: 'var(--dl-s4)', display: 'grid', gap: 'var(--dl-s4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 'var(--dl-s5)', alignItems: 'start' }}>
        <div>
          <div className="dl-h3" style={{ marginBottom: 6 }}>本次评估的风险输入</div>
          <KeyValue
            items={[
              ['风险事件', row.riskEvent],
              ['工序节点', row.processNodeName],
              ['机理条目', row.mechanismEntryId],
              ['来源资料段', row.sourceSegmentId],
              [
                '综合置信度',
                <>
                  <span className="dl-num">{row.compositeConfidence.value.toFixed(2)}</span>
                  <div className="dl-xs dl-faint">{row.compositeConfidence.basis.join(' · ')}</div>
                </>,
              ],
            ]}
          />
        </div>

        <div style={{ display: 'grid', gap: 'var(--dl-s3)' }}>
          <div>
            <div className="dl-h3 dl-faint" style={{ marginBottom: 6 }}>入口模式</div>
            <div style={{ display: 'flex', gap: 'var(--dl-s3)', flexWrap: 'wrap' }}>
              {ENTRY_MODES.map((m) => (
                <label key={m} className="dl-sm" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <input type="radio" name={`mode-${row.riskRecordId}`} checked={mode === m} onChange={() => setMode(m)} />
                  {ENTRY_MODE_LABELS[m]}
                </label>
              ))}
            </div>
          </div>

          <label className="dl-sm" style={{ display: 'grid', gap: 4, maxWidth: 420 }}>
            <span className="dl-h3 dl-faint">触发原因</span>
            <select className="dl-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {TRIGGER_REASONS.map((r) => (
                <option key={r} value={r}>{TRIGGER_REASON_LABELS[r]}</option>
              ))}
            </select>
          </label>

          <div>
            <div className="dl-h3 dl-faint" style={{ marginBottom: 6 }}>评估依据版本（启动时按下列版本固定为不可变快照）</div>
            <KeyValue
              items={BASIS_KEYS.map((k) => [
                BASIS_VERSION_LABELS[k],
                <span className="dl-mono">{ASSESSMENT_BASIS_VERSIONS[k].entityId} · {ASSESSMENT_BASIS_VERSIONS[k].versionId}</span>,
              ])}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dl-s3)' }}>
        <button className="dl-btn dl-btn--primary" type="button">启动评估</button>
        <button className="dl-btn" type="button" onClick={onClose}>取消</button>
        <span className="dl-xs dl-faint">评估结果由你复核确认，系统不自动生效。</span>
      </div>
    </div>
  );
}

export function PendingAssessmentPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const waiting = PENDING_RISKS.filter((r) => r.status === 'pending');
  const running = PENDING_RISKS.filter((r) => r.status === 'in-run');
  const done = PENDING_RISKS.filter((r) => r.status === 'assessed');
  const avg = PENDING_RISKS.reduce((s, r) => s + r.compositeConfidence.value, 0) / PENDING_RISKS.length;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">评估 / 待评估风险</div>
          <h1 className="dl-h1">待评估风险</h1>
          <div className="dl-head-meta">
            <span className="dl-sm dl-muted">识别域已入库的风险输入在此排队；评估从本行就地发起。</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button" onClick={() => setOpenId(waiting[0]?.riskRecordId ?? null)}>
            启动下一项评估
          </button>
        </div>
      </header>

      <AgentNote
        why="依据：识别记录的综合置信度构成与工序节点，Agent 只提示差距，正式决定由你做出"
        actions={
          <>
            <button className="dl-btn dl-btn--sm dl-btn--primary" type="button" onClick={() => setOpenId(waiting[0]?.riskRecordId ?? null)}>
              启动评估
            </button>
            <button className="dl-btn dl-btn--sm" type="button">暂不启动</button>
          </>
        }
      >
        <strong>{waiting[0]?.riskEvent ?? '无待评估风险'}</strong>
        <span className="dl-muted">
          （{waiting[0]?.processNodeName}）综合置信度 {waiting[0]?.compositeConfidence.value.toFixed(2)}，低于已评估同类风险；尚未产生评估记录，可直接启动首次评估。
        </span>
      </AgentNote>

      <Stats
        items={[
          { label: '待评估', value: waiting.length },
          { label: '评估中', value: running.length },
          { label: '已评估', value: done.length },
          { label: '平均综合置信度', value: avg.toFixed(2) },
        ]}
      />

      <Section
        title="队列"
        action={<span className="dl-xs dl-faint">共 {PENDING_RISKS.length} 条 · 展开任一行可就地发起评估</span>}
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th>风险事件</th>
              <th>工序节点</th>
              <th className="is-right">综合置信度</th>
              <th>来源资料段</th>
              <th>状态</th>
              <th>最近一次评估</th>
              <th className="is-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {PENDING_RISKS.map((row) => (
              <tr key={row.riskRecordId}>
                <td>{row.riskEvent}</td>
                <td>{row.processNodeName}</td>
                <td className="is-right is-num">{row.compositeConfidence.value.toFixed(2)}</td>
                <td className="dl-mono dl-xs">{row.sourceSegmentId}</td>
                <td>
                  <StateTag state={row.status === 'assessed' ? 'done' : row.status === 'in-run' ? 'current' : 'pending'}>
                    {PENDING_STATUS_LABELS[row.status]}
                  </StateTag>
                </td>
                <td className="dl-mono dl-xs">{row.latestAssessmentRecordId ?? '—'}</td>
                <td className="is-right" style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className={`dl-btn dl-btn--sm${row.status === 'pending' ? ' dl-btn--primary' : ''}`}
                    type="button"
                    disabled={row.status === 'in-run'}
                    onClick={() => setOpenId(openId === row.riskRecordId ? null : row.riskRecordId)}
                  >
                    {row.status === 'assessed' ? '重新评估' : '启动评估'}
                  </button>
                </td>
              </tr>
            ))}
            {PENDING_RISKS.map((row) =>
              openId === row.riskRecordId ? (
                <tr key={`${row.riskRecordId}-form`}>
                  <td colSpan={7} style={{ background: 'var(--dl-surface-2)' }}>
                    <StartForm row={row} onClose={() => setOpenId(null)} />
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </Section>

      <Section title="快捷键">
        <Shortcuts
          groups={[
            {
              title: '队列',
              items: [
                ['J / K', '上下移动队列行'],
                ['Enter', '在选中行就地展开评估表单'],
                ['Esc', '收起表单'],
                ['⌘K', '搜索风险事件、工序节点或标识'],
              ],
            },
          ]}
        />
      </Section>

      <Ids pairs={PENDING_RISKS.map((r) => [`风险输入`, r.riskRecordId])} />
    </div>
  );
}
