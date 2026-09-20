// P-RA-07 重新评估历史（A 列表骨架）。
// 骨架：A 列表（上下文副标题 + 筛选栏 + 独立主操作区 + 表格）。
// 数据 branch：risk-assessment.reassessment；页面级能力位：risk-assessment.read。
// 动作级：「发起重新评估」需 risk-assessment.prepare（branch risk-assessment.reassessment 映射）。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「暂无重新评估记录」。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ASSESSMENT_RUNS,
  ENTRY_MODE_LABELS,
  LINKS,
  TRIGGER_REASON_LABELS,
  assessmentRecordById,
  type AssessmentRunFixture,
} from '../../content/assessment';
import { CapabilityAction, RiskLevelBadge, StatusBadge } from './widgets';

const REASSESSMENT_RUNS = ASSESSMENT_RUNS.filter((run) => run.entryMode !== 'assess');

function levelChange(run: AssessmentRunFixture): { previous: string; current: string } | null {
  if (run.previousAssessmentRecordId === undefined || run.outputs.assessmentRecordId === null) {
    return null;
  }
  const previous = assessmentRecordById(run.previousAssessmentRecordId);
  const current = assessmentRecordById(run.outputs.assessmentRecordId);
  if (previous === undefined || current === undefined) return null;
  return { previous: previous.riskLevel, current: current.riskLevel };
}

export function ReassessmentsPage({ input }: { readonly input: RouteRenderInput }) {
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const rows = REASSESSMENT_RUNS.filter(
    (run) => reasonFilter === 'all' || run.triggerReasonCode === reasonFilter,
  );
  const reasons = [...new Set(REASSESSMENT_RUNS.map((run) => run.triggerReasonCode))];

  return (
    <PageFrame
      title="重新评估历史"
      state={input.pageState}
      skeleton="A"
      emptyMessage="暂无重新评估记录"
      content={
        <div className="ra-page">
          <p className="ra-context-subtitle">
            重新评估由监测快照更新、适用性元数据变化、规则集 / 权重 / 矩阵版本更新触发；历史评估记录只追加、不覆盖，前后记录构成版本链。
          </p>
          <div className="ra-list-toolbar">
            <div className="ra-filters" role="group" aria-label="筛选">
              <label>
                触发原因
                <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)}>
                  <option value="all">全部原因</option>
                  {reasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {TRIGGER_REASON_LABELS[reason] ?? reason}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ra-actions">
              <CapabilityAction
                capabilities={input.capabilities}
                capability="risk-assessment.prepare"
                href={LINKS.assessmentStart}
              >
                发起重新评估
              </CapabilityAction>
            </div>
          </div>
          <div className="ra-table-wrap">
            <table className="ra-table">
              <thead>
                <tr>
                  <th>评估运行</th>
                  <th>入口模式</th>
                  <th>触发原因</th>
                  <th>版本链（前次 → 本次）</th>
                  <th>等级变化</th>
                  <th>操作者</th>
                  <th>启动时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => {
                  const change = levelChange(run);
                  return (
                    <tr key={run.runId}>
                      <td>
                        <a className="mono" href={LINKS.assessmentRun(run.runId)}>
                          {run.runId}
                        </a>
                      </td>
                      <td>
                        <StatusBadge tone="waiting">{ENTRY_MODE_LABELS[run.entryMode]}</StatusBadge>
                      </td>
                      <td>{TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode}</td>
                      <td>
                        {run.previousAssessmentRecordId === undefined ? (
                          <span className="ra-form-note">无前次记录（回溯补评）</span>
                        ) : (
                          <>
                            <a className="mono" href={LINKS.assessmentRecord(run.previousAssessmentRecordId)}>
                              {run.previousAssessmentRecordId}
                            </a>
                            {' → '}
                          </>
                        )}
                        {run.outputs.assessmentRecordId === null ? null : (
                          <a className="mono" href={LINKS.assessmentRecord(run.outputs.assessmentRecordId)}>
                            {run.outputs.assessmentRecordId}
                          </a>
                        )}
                      </td>
                      <td>
                        {change === null ? (
                          <span className="ra-form-note">—</span>
                        ) : (
                          <span className="ra-trace-row">
                            <RiskLevelBadge levelKey={change.previous} />
                            <span aria-hidden="true">→</span>
                            <RiskLevelBadge levelKey={change.current} />
                          </span>
                        )}
                      </td>
                      <td>{run.operatorName}</td>
                      <td className="mono">{run.startedAt.slice(0, 16).replace('T', ' ')}</td>
                      <td>
                        <StatusBadge tone={run.status === 'completed' ? 'done' : 'running'}>
                          {run.status === 'completed' ? '已完成' : '运行中'}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
