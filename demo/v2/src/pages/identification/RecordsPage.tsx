// P-RI-05 标准化风险记录列表（A 列表骨架）。
// 骨架：A 列表（上下文副标题 + 筛选栏 + 独立主操作区 + 表格）。
// 数据 branch：risk-identification.merge-run-candidates；页面级能力位：risk-identification.read。
// 动作级：「启动识别」需 risk-identification.run（branch risk-identification.plan 映射）。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明并保留主操作入口。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ACCEPTANCE_ROUTE_LABELS,
  LINKS,
  RISK_RECORDS,
  riskRecordKey,
} from '../../content/identification';
import { CapabilityAction } from './widgets';

const MECHANISM_OPTIONS: readonly string[] = [
  ...new Set(RISK_RECORDS.flatMap((view) => view.riskMechanismEntryIds)),
];

export function RecordsPage({ input }: { readonly input: RouteRenderInput }) {
  const [mechanismFilter, setMechanismFilter] = useState<string>('all');
  const rows =
    mechanismFilter === 'all'
      ? RISK_RECORDS
      : RISK_RECORDS.filter((view) => view.riskMechanismEntryIds.includes(mechanismFilter));

  return (
    <PageFrame
      title="标准化风险记录列表"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前没有标准化风险记录，可从右上「启动识别」发起识别运行"
      content={
        <div className="ri-page">
          <p className="ri-context-subtitle">
            示例工程 · 站隧一体化标；记录由识别运行验收入库，每条可追溯到
            资料段 → 工序节点 → 风险机理条目。
          </p>
          <div className="ri-list-toolbar">
            <div className="ri-filters" role="group" aria-label="筛选">
              <label>
                机理条目
                <select
                  value={mechanismFilter}
                  onChange={(event) => setMechanismFilter(event.target.value)}
                >
                  <option value="all">全部机理条目</option>
                  {MECHANISM_OPTIONS.map((mechanismId) => (
                    <option key={mechanismId} value={mechanismId}>
                      {mechanismId}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ri-actions">
              <a className="ri-action ri-action-secondary" href={LINKS.graph}>
                工序风险关联图谱
              </a>
              <CapabilityAction
                capabilities={input.capabilities}
                capability="risk-identification.run"
                href={LINKS.identificationStart}
              >
                启动识别
              </CapabilityAction>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="ri-form-note">没有符合筛选条件的标准化风险记录。</p>
          ) : (
            <div className="ri-table-wrap">
              <table className="ri-table">
                <thead>
                  <tr>
                    <th>记录标识</th>
                    <th>风险事件</th>
                    <th>工序节点</th>
                    <th>机理条目</th>
                    <th>综合置信度</th>
                    <th>来源资料段</th>
                    <th>验收路由</th>
                    <th>入库时间</th>
                    <th>追溯</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((view) => {
                    const recordId = riskRecordKey(view);
                    return (
                      <tr key={recordId}>
                        <td>
                          <a className="mono" href={LINKS.identificationRecord(recordId)}>
                            {recordId}
                          </a>
                        </td>
                        <td>{view.record.riskEvent}</td>
                        <td>
                          <a href={LINKS.identificationProcessModel}>
                            {view.processNodeName}（
                            <span className="mono">{view.record.processNodeId}</span>）
                          </a>
                        </td>
                        <td>
                          <div className="ri-cell-stack">
                            {view.riskMechanismEntryIds.map((mechanismId) => (
                              <a key={mechanismId} className="mono" href={LINKS.knowledgeMechanisms}>
                                {mechanismId}
                              </a>
                            ))}
                          </div>
                        </td>
                        <td>
                          <span className="mono">{view.compositeConfidence.value.toFixed(2)}</span>
                          <div className="ri-cell-stack">
                            {view.compositeConfidence.basis.map((basis) => (
                              <span key={basis} className="ri-form-note">
                                {basis}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <a className="mono" href={LINKS.evidenceTrace}>
                            {view.record.evidenceLocator.sourceSegmentId}
                          </a>
                        </td>
                        <td>{ACCEPTANCE_ROUTE_LABELS[view.acceptanceRoute]}</td>
                        <td className="mono">
                          {view.audit.recordedAt.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td>
                          <div className="ri-cell-stack">
                            {view.downstream.assessmentRecordIds.map((assessmentId) => (
                              <a
                                key={assessmentId}
                                className="mono"
                                href={LINKS.assessmentRecord(assessmentId)}
                              >
                                {assessmentId}
                              </a>
                            ))}
                            {view.downstream.activeAssessmentRunId === null ? null : (
                              <a
                                className="mono"
                                href={LINKS.assessmentRun(view.downstream.activeAssessmentRunId)}
                              >
                                {view.downstream.activeAssessmentRunId}（评估中）
                              </a>
                            )}
                            {view.downstream.assessmentRecordIds.length === 0 &&
                            view.downstream.activeAssessmentRunId === null ? (
                              <a href={LINKS.assessmentRoot}>待评估</a>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      }
    />
  );
}
