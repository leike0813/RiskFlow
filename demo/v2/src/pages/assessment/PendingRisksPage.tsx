// P-RA-01 待评估风险（A 列表骨架）。
// 骨架：A 列表（上下文副标题 + 筛选栏 + 独立主操作区 + 表格）。
// 数据 branch：risk-assessment.initial；页面级能力位：risk-assessment.read（框架层门控）。
// 动作级：「启动评估」需 risk-assessment.prepare（branch risk-assessment.initial 映射）。
// 七态：非 ready 态统一由 PageFrame 承载；empty 态说明「当前没有待评估的风险记录」。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  LINKS,
  PENDING_RISKS,
  PENDING_STATUS_LABELS,
  type PendingRiskStatus,
} from '../../content/assessment';
import { CapabilityAction, StatusBadge } from './widgets';

const STATUS_FILTER_OPTIONS: readonly { readonly value: PendingRiskStatus | 'all'; readonly label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待评估' },
  { value: 'in-run', label: '评估中' },
  { value: 'assessed', label: '已评估' },
];

function statusTone(status: PendingRiskStatus): 'running' | 'done' | 'neutral' {
  if (status === 'in-run') return 'running';
  if (status === 'assessed') return 'done';
  return 'neutral';
}

export function PendingRisksPage({ input }: { readonly input: RouteRenderInput }) {
  const [statusFilter, setStatusFilter] = useState<PendingRiskStatus | 'all'>('all');
  const rows =
    statusFilter === 'all'
      ? PENDING_RISKS
      : PENDING_RISKS.filter((risk) => risk.status === statusFilter);

  return (
    <PageFrame
      title="待评估风险"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前没有待评估的风险记录"
      content={
        <div className="ra-page">
          <p className="ra-context-subtitle">
            示例工程 · 站隧一体化标 / 工序节点 变径空间扩挖（<span className="mono">PN-VDS-04</span>）；
            队列来自识别域已入库的标准化风险记录。
          </p>
          <div className="ra-list-toolbar">
            <div className="ra-filters" role="group" aria-label="筛选">
              <label>
                评估状态
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as PendingRiskStatus | 'all')}
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
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
                启动评估
              </CapabilityAction>
            </div>
          </div>
          <div className="ra-table-wrap">
            <table className="ra-table">
              <thead>
                <tr>
                  <th>风险记录</th>
                  <th>风险事件</th>
                  <th>机理条目</th>
                  <th>综合置信度</th>
                  <th>来源资料段</th>
                  <th>评估状态</th>
                  <th>追溯</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((risk) => (
                  <tr key={risk.riskRecordId}>
                    <td>
                      <a className="mono" href={LINKS.identificationRecord(risk.riskRecordId)}>
                        {risk.riskRecordId}
                      </a>
                    </td>
                    <td>{risk.riskEvent}</td>
                    <td>
                      <a className="mono" href={LINKS.knowledgeMechanisms}>
                        {risk.mechanismEntryId}
                      </a>
                    </td>
                    <td>
                      <span className="mono">{risk.compositeConfidence.value.toFixed(2)}</span>
                      <div className="ra-cell-stack">
                        {risk.compositeConfidence.basis.map((basis) => (
                          <span key={basis} className="ra-form-note">
                            {basis}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <a className="mono" href={LINKS.evidenceTrace}>
                        {risk.sourceSegmentId}
                      </a>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(risk.status)}>
                        {PENDING_STATUS_LABELS[risk.status]}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="ra-cell-stack">
                        {risk.latestAssessmentRecordId === undefined ? null : (
                          <a href={LINKS.assessmentRecord(risk.latestAssessmentRecordId)}>
                            最新评估记录
                          </a>
                        )}
                        {risk.activeRunId === undefined ? null : (
                          <a href={LINKS.assessmentRun(risk.activeRunId)}>评估运行</a>
                        )}
                        {risk.status === 'pending' ? <a href={LINKS.assessmentStart}>启动评估</a> : null}
                      </div>
                    </td>
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
