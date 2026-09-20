// P-RI-03 识别运行详情（C 运行骨架）。
// 骨架：C 运行（运行头部七字段 + I0–I9 阶段条 + 子任务表 + 结果汇总）。
// 数据 branch：risk-identification.assemble-and-infer；页面级能力位：risk-identification.read。
// 七态：非 ready 态由 PageFrame 承载；路由参数未命中时给出自然「未找到」卡片。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  IDENTIFICATION_BASIS_LABELS,
  IDENTIFICATION_BASIS_VERSIONS,
  IDENTIFICATION_STAGE_LABELS,
  IDENTIFICATION_TRIGGER_REASON_LABELS,
  LINKS,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_TYPE_LABELS,
  identificationRunById,
  type IdentificationRunFixture,
} from '../../content/identification';
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

function runStatusTone(
  status: IdentificationRunFixture['status'],
): 'running' | 'done' | 'waiting' | 'failed' {
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

const BASIS_ORDER = [
  'processModelRelease',
  'riskMechanismRelease',
  'retrievalEvidenceBaseRelease',
  'identificationPolicySet',
  'promptTemplate',
  'modelDeployment',
] as const;

function RunContent({ run }: { readonly run: IdentificationRunFixture }) {
  return (
    <div className="ri-page">
      <FieldCard title="运行头部">
        <dl className="ri-field-grid">
          <FieldRow label="运行标识">
            <span className="mono">{run.runId}</span>
          </FieldRow>
          <FieldRow label="状态">
            <StatusBadge tone={runStatusTone(run.status)}>{RUN_STATUS_LABELS[run.status]}</StatusBadge>
          </FieldRow>
          <FieldRow label="当前阶段">
            <span className="mono">
              {run.currentStage} · {IDENTIFICATION_STAGE_LABELS[run.currentStage]}
            </span>
          </FieldRow>
          <FieldRow label="触发原因">
            {RUN_TRIGGER_TYPE_LABELS[run.triggerType]}；{IDENTIFICATION_TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode}
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
        {run.waitingReason === undefined ? null : (
          <p className="ri-form-note">{run.waitingReason}</p>
        )}
      </FieldCard>

      <FieldCard title="阶段条（I0–I9）">
        <StageBar stages={run.stages} labels={IDENTIFICATION_STAGE_LABELS} />
      </FieldCard>

      <FieldCard title="子任务">
        <div className="ri-table-wrap">
          <table className="ri-table">
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
                    <span className="mono">{subtask.stage}</span>{' '}
                    {IDENTIFICATION_STAGE_LABELS[subtask.stage]}
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
        <div className="ri-stat-row">
          <div className="ri-stat">
            <span className="ri-stat-value">{run.summary.plannedWorkItemCount}</span>
            <span className="ri-stat-label">计划工作项</span>
          </div>
          <div className="ri-stat">
            <span className="ri-stat-value">{run.summary.excludedWorkItemCount}</span>
            <span className="ri-stat-label">筛除工作项</span>
          </div>
          <div className="ri-stat">
            <span className="ri-stat-value">{run.summary.candidateCount}</span>
            <span className="ri-stat-label">风险候选</span>
          </div>
          <div className="ri-stat">
            <span className="ri-stat-value">{run.summary.validatedCandidateCount}</span>
            <span className="ri-stat-label">校验通过</span>
          </div>
          <div className="ri-stat">
            <span className="ri-stat-value">{run.summary.acceptedRecordCount}</span>
            <span className="ri-stat-label">入库记录</span>
          </div>
        </div>
        {run.outputs.acceptedRiskRecordIds.length === 0 ? null : (
          <div className="ri-cell-stack" style={{ marginTop: 'var(--space-3)' }}>
            {run.outputs.acceptedRiskRecordIds.map((recordId) => (
              <span key={recordId}>
                标准化风险记录{' '}
                <a className="mono" href={LINKS.identificationRecord(recordId)}>
                  {recordId}
                </a>
              </span>
            ))}
          </div>
        )}
      </FieldCard>

      <FieldCard title="识别依据版本（输入快照锁定）">
        <div className="ri-version-list">
          {BASIS_ORDER.map((key) => (
            <VersionRefText
              key={key}
              label={IDENTIFICATION_BASIS_LABELS[key]}
              reference={IDENTIFICATION_BASIS_VERSIONS[key]}
            />
          ))}
        </div>
      </FieldCard>

      <EventTimeline
        events={[
          {
            at: run.startedAt.slice(0, 16).replace('T', ' '),
            label: `识别运行 ${run.runId} 启动`,
          },
          ...(run.outputs.acceptedRiskRecordIds.length === 0
            ? []
            : [
                {
                  at: '2026-08-27 08:52',
                  label: `标准化风险记录 ${run.outputs.acceptedRiskRecordIds.length} 条入库`,
                  href: LINKS.identificationRecords,
                },
              ]),
          ...(run.runId === 'RUN-20260827-001'
            ? [
                {
                  at: '2026-08-27 09:04',
                  label: '评估运行 RUN-A-2026-001 启动（因果链下游）',
                  href: LINKS.assessmentRun('RUN-A-2026-001'),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

export function RunDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const runId = input.params['runId'] ?? '';
  const run = identificationRunById(runId);
  return (
    <PageFrame
      title="识别运行详情"
      state={input.pageState}
      skeleton="C"
      emptyMessage="当前没有识别运行"
      content={
        run === undefined ? (
          <NotFoundCard
            kind="识别运行"
            id={runId}
            backHref={LINKS.identificationRuns}
            backLabel="返回识别任务列表"
          />
        ) : (
          <RunContent run={run} />
        )
      }
    />
  );
}
