// PROTOTYPE · THROWAWAY — 票 05 第 8 页：识别任务详情
// 阶段只用中文名上界面（票 01：I0–I9 是代号词）；识别与检索审阅必经智能助手，此页摆清它做了什么、要人决定什么。

import {
  ACCEPTANCE_ROUTE_LABELS,
  IDENTIFICATION_BASIS_LABELS,
  IDENTIFICATION_BASIS_VERSIONS,
  IDENTIFICATION_STAGE_LABELS,
  IDENTIFICATION_TRIGGER_REASON_LABELS,
  RISK_RECORDS,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_TYPE_LABELS,
  identificationRunById,
  riskRecordKey,
  type IdentificationRunFixture,
  type RunStageFixture,
} from '../../../content/identification';
import { AgentNote, Ids, KeyValue, Section, Stats, StateTag, Tag, Timeline } from '../parts';

const STAGE_STATE = {
  done: 'done',
  active: 'current',
  waiting: 'current',
  failed: 'current',
  pending: 'pending',
} as const satisfies Readonly<Record<RunStageFixture['status'], 'done' | 'current' | 'pending'>>;

const TASK_NUMBER = 'RUN-20260827-001';

export function IdentificationRunDetailPage() {
  const run = identificationRunById(TASK_NUMBER);
  if (!run) {
    return (
      <div className="dl dl-page">
        <Section title="识别任务">本工程尚无识别任务</Section>
      </div>
    );
  }

  const records = RISK_RECORDS.filter((r) => r.producedByRunId === run.runId);
  const reviewRoute = records.filter((r) => r.acceptanceRoute === 'review');
  const autoRoute = records.filter((r) => r.acceptanceRoute === 'auto');

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">
            识别 / 识别任务 /{' '}
            <a href="#/identification">
              {IDENTIFICATION_TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode}
            </a>
          </div>
          <h1 className="dl-h1">识别任务详情</h1>
          <div className="dl-head-meta">
            <StateTag
              state={run.status === 'completed' ? 'done' : run.status === 'running' ? 'current' : 'pending'}
            >
              {RUN_STATUS_LABELS[run.status]}
            </StateTag>
            <Tag accent>{IDENTIFICATION_STAGE_LABELS[run.currentStage]}</Tag>
            <span className="dl-xs dl-faint">
              {RUN_TRIGGER_TYPE_LABELS[run.triggerType]} ·{' '}
              {IDENTIFICATION_TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode}
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">查看风险记录</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">按此范围重新识别</button>
        </div>
      </header>

      <AgentNote
        why={`助手按识别策略集核对了 ${run.summary.plannedWorkItemCount} 个计划工作项，其中 ${run.summary.excludedWorkItemCount} 项按「部分可用」筛除；识别与检索审阅这两类任务必须由助手跑完，已全部完成，本次不需你补做。`}
        actions={
          <button className="dl-btn dl-btn--sm" type="button">查看逐项核对</button>
        }
      >
        本次识别共生成 {run.summary.candidateCount} 条候选，{run.summary.validatedCandidateCount} 条通过确定性校验，
        {' '}{run.summary.acceptedRecordCount} 条入库。{reviewRoute.length} 条因证据需要人工判断走了复核后验收，
        {' '}复核人是发起人 {run.operatorName}。
      </AgentNote>

      <Stats
        items={[
          { label: '计划工作项', value: run.summary.plannedWorkItemCount },
          { label: '部分可用筛除', value: run.summary.excludedWorkItemCount },
          { label: '风险候选', value: run.summary.candidateCount },
          { label: '校验通过', value: run.summary.validatedCandidateCount },
          { label: '入库风险记录', value: run.summary.acceptedRecordCount },
        ]}
      />

      <Section title="阶段推进" flush>
        <div style={{ padding: 'var(--dl-s4)' }}>
          <Timeline
            items={run.stages.map((stage, i) => ({
              at: `第 ${i + 1} 步`,
              title: IDENTIFICATION_STAGE_LABELS[stage.stage],
              state: STAGE_STATE[stage.status],
              meta: stage.summary ? <span className="dl-xs dl-faint">{stage.summary}</span> : null,
              body: stageSubtasks(run, stage.stage),
            }))}
          />
        </div>
      </Section>

      <Section title="识别依据版本">
        <KeyValue
          items={Object.entries(IDENTIFICATION_BASIS_VERSIONS).map(([key, v]) => [
            IDENTIFICATION_BASIS_LABELS[key as keyof typeof IDENTIFICATION_BASIS_LABELS],
            <span className="dl-mono dl-faint">{`${v.entityId} · ${v.versionId}`}</span>,
          ])}
        />
      </Section>

      <Section title="验收路由与入库结果" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>风险事件</th>
              <th>风险因素</th>
              <th>验收方式</th>
              <th className="is-right">综合置信度</th>
              <th>记录号</th>
            </tr>
          </thead>
          <tbody>
            {[...reviewRoute, ...autoRoute].map((r) => (
              <tr key={riskRecordKey(r)}>
                <td>
                  <div className="dl-sm" style={{ fontWeight: 600 }}>{r.record.riskEvent}</div>
                  <div className="dl-xs dl-faint">{r.processNodeName}</div>
                </td>
                <td className="dl-sm dl-muted">{r.record.riskFactor}</td>
                <td>
                  <Tag accent={r.acceptanceRoute === 'review'}>
                    {ACCEPTANCE_ROUTE_LABELS[r.acceptanceRoute]}
                  </Tag>
                </td>
                <td className="is-right is-num dl-sm">{r.compositeConfidence.value.toFixed(2)}</td>
                <td className="dl-xs dl-mono dl-faint">{riskRecordKey(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 'var(--dl-s3) var(--dl-s4)' }}>
          <Ids
            pairs={[
              ['任务号', run.runId],
              ['发起人', run.operatorName],
              ['启动时间', run.startedAt.slice(0, 16).replace('T', ' ')],
            ]}
          />
        </div>
      </Section>
    </div>
  );
}

/** 阶段下的子任务明细：阶段码不出界面，只显示中文名。 */
function stageSubtasks(run: IdentificationRunFixture, stageId: RunStageFixture['stage']) {
  const subtasks = run.subtasks.filter((t) => t.stage === stageId);
  if (subtasks.length === 0) return null;
  return (
    <div className="dl-sm dl-muted">
      {subtasks.map((t, i) => (
        <div key={t.id} style={{ marginTop: i === 0 ? 0 : 4 }}>
          <span>{t.name}</span>
          {t.duration ? <span className="dl-xs dl-faint"> · 用时 {t.duration}</span> : null}
          {t.result ? <div className="dl-xs dl-faint">{t.result}</div> : null}
        </div>
      ))}
    </div>
  );
}
