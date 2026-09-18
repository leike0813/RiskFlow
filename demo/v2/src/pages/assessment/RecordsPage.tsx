// P-RA-04 风险评估记录列表（A 列表骨架）。
// 骨架：A 列表（上下文副标题 + 筛选栏 + 独立主操作区 + 表格）。
// 数据 branch：risk-assessment.evaluate；页面级能力位：risk-assessment.read。
// 动作级：「启动评估」需 risk-assessment.prepare。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「暂无风险评估记录」。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ASSESSMENT_RECORDS,
  ENTRY_MODE_LABELS,
  LINKS,
  type AssessmentEntryMode,
} from '../../content/assessment';
import { CapabilityAction, RiskLevelBadge, StatusBadge } from './widgets';

const ENTRY_FILTER_OPTIONS: readonly { readonly value: AssessmentEntryMode | 'all'; readonly label: string }[] = [
  { value: 'all', label: '全部类别' },
  { value: 'assess', label: '首次评估' },
  { value: 'reassess', label: '重新评估' },
  { value: 'historical-backfill', label: '历史回溯评估' },
];

const LEVELS = ['I', 'II', 'III', 'IV'] as const;

export function RecordsPage({ input }: { readonly input: RouteRenderInput }) {
  const [entryFilter, setEntryFilter] = useState<AssessmentEntryMode | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const rows = ASSESSMENT_RECORDS.filter(
    (record) =>
      (entryFilter === 'all' || record.entryMode === entryFilter) &&
      (levelFilter === 'all' || record.riskLevel === levelFilter),
  );

  return (
    <PageFrame
      title="风险评估记录列表"
      state={input.pageState}
      skeleton="A"
      emptyMessage="暂无风险评估记录"
      content={
        <div className="ra-page">
          <p className="ra-context-subtitle">
            历史评估记录只追加、不覆盖；每条记录固定引用适用规则集 / 风险矩阵 / 权重版本与适用性元数据快照，可按版本重放。
          </p>
          <div className="ra-list-toolbar">
            <div className="ra-filters" role="group" aria-label="筛选">
              <label>
                入口类别
                <select
                  value={entryFilter}
                  onChange={(event) => setEntryFilter(event.target.value as AssessmentEntryMode | 'all')}
                >
                  {ENTRY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                风险等级
                <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                  <option value="all">全部等级</option>
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level} 级
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ra-actions">
              <a className="ra-action ra-action-secondary" href={LINKS.assessmentMatrix}>
                P/C 风险矩阵
              </a>
              <CapabilityAction
                capabilities={input.capabilities}
                capability="risk-assessment.prepare"
                href={LINKS.assessmentStart}
              >
                启动评估
              </CapabilityAction>
            </div>
          </div>
          <div className="ra-table-wrap">
            <table className="ra-table">
              <thead>
                <tr>
                  <th>评估记录</th>
                  <th>风险输入</th>
                  <th>入口类别</th>
                  <th>P / C</th>
                  <th>风险等级</th>
                  <th>触发指标</th>
                  <th>版本引用</th>
                  <th>评估运行</th>
                  <th>记录时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => (
                  <tr key={record.assessmentRecordId}>
                    <td>
                      <a className="mono" href={LINKS.assessmentRecord(record.assessmentRecordId)}>
                        {record.assessmentRecordId}
                      </a>
                    </td>
                    <td>
                      <a className="mono" href={LINKS.identificationRecord(record.riskRecordId)}>
                        {record.riskRecordId}
                      </a>
                    </td>
                    <td>
                      <StatusBadge tone={record.entryMode === 'assess' ? 'neutral' : 'waiting'}>
                        {ENTRY_MODE_LABELS[record.entryMode]}
                      </StatusBadge>
                    </td>
                    <td className="mono">
                      {record.likelihoodScore} / {record.consequenceScore}
                    </td>
                    <td>
                      <RiskLevelBadge levelKey={record.riskLevel} />
                    </td>
                    <td className="mono">{record.triggerIndicators.length}</td>
                    <td>
                      <div className="ra-cell-stack mono">
                        <span>
                          {record.applicableRuleSetVersion.entityId} · {record.applicableRuleSetVersion.versionId}
                        </span>
                        <span>
                          {record.riskMatrixVersion.entityId} · {record.riskMatrixVersion.versionId}
                        </span>
                        <span>
                          {record.weightVersion.entityId} · {record.weightVersion.versionId}
                        </span>
                      </div>
                    </td>
                    <td>
                      <a className="mono" href={LINKS.assessmentRun(record.producedByRunId)}>
                        {record.producedByRunId}
                      </a>
                    </td>
                    <td className="mono">{record.audit.recordedAt.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
