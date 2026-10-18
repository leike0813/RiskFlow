// PROTOTYPE · THROWAWAY — 票 05 第 7 页：识别任务列表
// 命名依据票 01：runId 显示为「任务号」，实体一律叫「识别任务」，不叫「运行」。

import {
  IDENTIFICATION_RUNS,
  IDENTIFICATION_STAGE_LABELS,
  IDENTIFICATION_TRIGGER_REASON_LABELS,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_TYPE_LABELS,
  type IdentificationRunFixture,
} from '../../../content/identification';
import { Section, Stats, StateTag, Tag } from '../parts';

const STATUS_STATE = {
  completed: 'done',
  running: 'current',
  waiting: 'pending',
  'terminal-failure': 'pending',
} as const satisfies Readonly<Record<IdentificationRunFixture['status'], 'done' | 'current' | 'pending'>>;

export function IdentificationRunListPage() {
  const runs = IDENTIFICATION_RUNS;
  const completed = runs.filter((r) => r.status === 'completed');
  const running = runs.filter((r) => r.status === 'running');
  const waiting = runs.filter((r) => r.status === 'waiting');
  const accepted = runs.reduce((sum, r) => sum + r.outputs.acceptedRiskRecordIds.length, 0);

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">识别 / 识别任务</div>
          <h1 className="dl-h1">识别任务</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">共 {runs.length} 次识别任务，按启动时间倒序</span>
            {waiting.length > 0 ? <Tag accent>{waiting.length} 项等待人工前置条件</Tag> : null}
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">按工序节点筛选</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">启动识别任务</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '识别任务', value: runs.length },
          { label: '已完成', value: completed.length },
          { label: '进行中', value: running.length },
          { label: '等待前置条件', value: waiting.length },
          { label: '已入库风险记录', value: accepted },
        ]}
      />

      <Section title="识别任务" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>启动原因</th>
              <th>状态</th>
              <th>推进到</th>
              <th>启动方式</th>
              <th>发起人</th>
              <th>启动时间</th>
              <th className="is-right">候选 / 入库</th>
              <th>任务号</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runId}>
                <td className="dl-sm" style={{ fontWeight: 600 }}>
                  {IDENTIFICATION_TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode}
                </td>
                <td>
                  <StateTag state={STATUS_STATE[run.status]}>{RUN_STATUS_LABELS[run.status]}</StateTag>
                </td>
                <td className="dl-sm">{IDENTIFICATION_STAGE_LABELS[run.currentStage]}</td>
                <td className="dl-sm dl-muted">{RUN_TRIGGER_TYPE_LABELS[run.triggerType]}</td>
                <td className="dl-sm dl-muted">{run.operatorName}</td>
                <td className="dl-sm dl-num dl-muted">{run.startedAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="is-right is-num dl-sm">
                  {run.summary.candidateCount} / {run.summary.acceptedRecordCount}
                </td>
                <td className="dl-xs dl-mono dl-faint">{run.runId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="待人工前置条件">
        <div className="dl-timeline">
          {runs
            .filter((r) => r.waitingReason)
            .map((run) => (
              <article className="dl-tl-item" data-state="current" key={run.runId}>
                <div className="dl-tl-when">{run.startedAt.slice(5, 10)}</div>
                <div className="dl-tl-rail"><span className="dl-tl-node" /></div>
                <div className="dl-tl-body">
                  <div className="dl-tl-hd">
                    <span className="dl-tl-title">{run.runId}</span>
                    <Tag accent>{IDENTIFICATION_STAGE_LABELS[run.currentStage]}</Tag>
                  </div>
                  <div className="dl-sm dl-muted">{run.waitingReason}</div>
                  <div className="dl-xs dl-faint" style={{ marginTop: 2 }}>
                    工序模型审核发布是人的决定，本页不代为放行
                  </div>
                </div>
              </article>
            ))}
        </div>
      </Section>
    </div>
  );
}
