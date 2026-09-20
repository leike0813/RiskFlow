// P-RA-03 评估运行详情（C 运行骨架）。
// 骨架：C 运行（运行头部七字段 + A0–A9 阶段条 + 子任务表 + 结果汇总）。
// 数据 branch：risk-assessment.evaluate；页面级能力位：risk-assessment.read。
// 七态：非 ready 态由 PageFrame 承载；路由参数未命中时给出自然「未找到」卡片。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ASSESSMENT_BASIS_VERSIONS,
  ASSESSMENT_STAGE_LABELS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  LINKS,
  TRIGGER_REASON_LABELS,
  assessmentRecordById,
  assessmentRunById,
  type AssessmentRunFixture,
} from '../../content/assessment';
import {
  EventTimeline,
  FieldCard,
  FieldRow,
  NotFoundCard,
  StageBar,
  StatusBadge,
  VersionRefText,
  stageStatusLabel,
} from './widgets';

const RUN_STATUS_LABELS: Readonly<Record<AssessmentRunFixture['status'], string>> = {
  completed: '已完成',
  running: '运行中',
  waiting: '等待中',
  'terminal-failure': '失败终止',
};

function runStatusTone(status: AssessmentRunFixture['status']): 'running' | 'done' | 'waiting' | 'failed' {
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

function RunContent({ run }: { readonly run: AssessmentRunFixture }) {
  const outputRecord =
    run.outputs.assessmentRecordId === null
      ? undefined
      : assessmentRecordById(run.outputs.assessmentRecordId);
  return (
    <div className="ra-page">
      <FieldCard title="运行头部">
        <dl className="ra-field-grid">
          <FieldRow label="运行标识">
            <span className="mono">{run.runId}</span>
          </FieldRow>
          <FieldRow label="状态">
            <StatusBadge tone={runStatusTone(run.status)}>{RUN_STATUS_LABELS[run.status]}</StatusBadge>
          </FieldRow>
          <FieldRow label="当前阶段">
            <span className="mono">
              {run.currentStage} · {ASSESSMENT_STAGE_LABELS[run.currentStage]}
            </span>
          </FieldRow>
          <FieldRow label="触发原因">
            {ENTRY_MODE_LABELS[run.entryMode]}；{TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode}
          </FieldRow>
          <FieldRow label="操作者">
            {run.operatorName}（<span className="mono">{run.operatorId}</span>）
          </FieldRow>
          <FieldRow label="启动时间">
            <span className="mono">{run.startedAt}</span>
          </FieldRow>
          <FieldRow label="幂等键">
            <span className="mono">{run.idempotencyKey}</span>
          </FieldRow>
        </dl>
        <p className="ra-form-note">
          风险输入{' '}
          <a className="mono" href={LINKS.identificationRecord(run.riskRecordId)}>
            {run.riskRecordId}
          </a>{' '}
          · 因果链上游识别运行{' '}
          <a className="mono" href={LINKS.identificationRun(run.causalIdentificationRunId)}>
            {run.causalIdentificationRunId}
          </a>
          {run.previousAssessmentRecordId === undefined ? null : (
            <>
              {' '}
              · 前次评估记录{' '}
              <a className="mono" href={LINKS.assessmentRecord(run.previousAssessmentRecordId)}>
                {run.previousAssessmentRecordId}
              </a>
            </>
          )}
        </p>
      </FieldCard>

      <FieldCard title="阶段条（A0–A9）">
        <StageBar stages={run.stages} labels={ASSESSMENT_STAGE_LABELS} />
      </FieldCard>

      <FieldCard title="子任务">
        <div className="ra-table-wrap">
          <table className="ra-table">
            <thead>
              <tr>
                <th>阶段</th>
                <th>子任务</th>
                <th>状态</th>
                <th>耗时</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {run.subtasks.map((subtask) => (
                <tr key={subtask.id}>
                  <td>
                    <span className="mono">{subtask.stage}</span> {ASSESSMENT_STAGE_LABELS[subtask.stage]}
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

      <FieldCard title="适用性筛除（评分规则）">
        <div className="ra-table-wrap">
          <table className="ra-table">
            <thead>
              <tr>
                <th>规则</th>
                <th>筛除维度</th>
                <th>筛除原因</th>
              </tr>
            </thead>
            <tbody>
              {run.applicabilityExclusions.map((exclusion) => (
                <tr key={exclusion.ruleId}>
                  <td>
                    <a className="mono" href={LINKS.knowledgeRuleSets}>
                      {exclusion.ruleId}
                    </a>{' '}
                    {exclusion.ruleName}
                  </td>
                  <td>{exclusion.dimension}</td>
                  <td>{exclusion.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="结果汇总">
        <div className="ra-stat-row">
          <div className="ra-stat">
            <span className="ra-stat-value">{run.summary.indicatorValueCount}</span>
            <span className="ra-stat-label">指标取值</span>
          </div>
          <div className="ra-stat">
            <span className="ra-stat-value">{run.summary.appliedRuleCount}</span>
            <span className="ra-stat-label">适用规则</span>
          </div>
          <div className="ra-stat">
            <span className="ra-stat-value">{run.summary.excludedRuleCount}</span>
            <span className="ra-stat-label">筛除规则</span>
          </div>
          <div className="ra-stat">
            <span className="ra-stat-value">{run.summary.triggerHitCount}</span>
            <span className="ra-stat-label">命中触发类型</span>
          </div>
        </div>
        <div className="ra-cell-stack" style={{ marginTop: 'var(--space-3)' }}>
          {run.outputs.assessmentRecordId === null ? null : (
            <span>
              评估记录{' '}
              <a className="mono" href={LINKS.assessmentRecord(run.outputs.assessmentRecordId)}>
                {run.outputs.assessmentRecordId}
              </a>
            </span>
          )}
          {run.outputs.warningRecordId === null ? null : (
            <span>
              预警信息{' '}
              <a className="mono" href={LINKS.warning(run.outputs.warningRecordId)}>
                {run.outputs.warningRecordId}
              </a>
            </span>
          )}
          {run.outputs.responseRecommendationId === null ? null : (
            <span>
              处置建议{' '}
              <a className="mono" href={LINKS.responseRecommendation(run.outputs.responseRecommendationId)}>
                {run.outputs.responseRecommendationId}
              </a>
            </span>
          )}
        </div>
        <div className="ra-version-list" style={{ marginTop: 'var(--space-3)' }}>
          <VersionRefText
            label={BASIS_VERSION_LABELS.applicableRuleSet}
            reference={ASSESSMENT_BASIS_VERSIONS.applicableRuleSet}
          />
          <VersionRefText
            label={BASIS_VERSION_LABELS.weightSet}
            reference={ASSESSMENT_BASIS_VERSIONS.weightSet}
          />
          <VersionRefText
            label={BASIS_VERSION_LABELS.riskMatrix}
            reference={ASSESSMENT_BASIS_VERSIONS.riskMatrix}
          />
        </div>
      </FieldCard>

      <EventTimeline
        events={[
          {
            at: '2026-08-27 08:52',
            label: `标准化风险记录 ${run.riskRecordId} 入库`,
            href: LINKS.identificationRecord(run.riskRecordId),
          },
          {
            at: run.startedAt.slice(0, 16).replace('T', ' '),
            label: `评估运行 ${run.runId} 启动`,
          },
          ...(outputRecord === undefined
            ? []
            : [
                {
                  at: outputRecord.audit.recordedAt.slice(0, 16).replace('T', ' '),
                  label: `评估记录 ${outputRecord.assessmentRecordId} 入库`,
                  href: LINKS.assessmentRecord(outputRecord.assessmentRecordId),
                },
              ]),
          ...(run.outputs.warningRecordId === null
            ? []
            : [
                {
                  at: run.startedAt.slice(0, 16).replace('T', ' '),
                  label: `预警 ${run.outputs.warningRecordId} 归集`,
                  href: LINKS.warning(run.outputs.warningRecordId),
                },
              ]),
        ]}
      />
    </div>
  );
}

export function RunDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const runId = input.params['runId'] ?? '';
  const run = assessmentRunById(runId);
  return (
    <PageFrame
      title="评估运行详情"
      state={input.pageState}
      skeleton="C"
      emptyMessage="当前没有评估运行"
      content={
        run === undefined ? (
          <NotFoundCard
            kind="评估运行"
            id={runId}
            backHref={LINKS.assessmentRecords}
            backLabel="返回风险评估记录列表"
          />
        ) : (
          <RunContent run={run} />
        )
      }
    />
  );
}
