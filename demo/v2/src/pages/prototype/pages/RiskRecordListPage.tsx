// PROTOTYPE · THROWAWAY — 票 05 第 9 页：风险记录列表
// 密集表格：按工序节点与验收方式筛选；风险记录是识别侧成立的事实，不是知识侧的风险源清单（票 01）。

import {
  ACCEPTANCE_ROUTE_LABELS,
  RISK_RECORDS,
  riskRecordKey,
} from '../../../content/identification';
import { Section, Stats, Tag } from '../parts';

const PROCESS_NODES = [...new Set(RISK_RECORDS.map((r) => r.processNodeName))];
const ROUTES = [...new Set(RISK_RECORDS.map((r) => r.acceptanceRoute))];

export function RiskRecordListPage() {
  const withAssessments = RISK_RECORDS.filter((r) => r.downstream.assessmentRecordIds.length > 0);
  const withWarnings = RISK_RECORDS.filter((r) => r.downstream.warningResponseTaskId !== null);
  const avgConfidence =
    RISK_RECORDS.reduce((sum, r) => sum + r.compositeConfidence.value, 0) / RISK_RECORDS.length;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">识别 / 风险记录</div>
          <h1 className="dl-h1">风险记录</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              共 {RISK_RECORDS.length} 条，全部由 {new Set(RISK_RECORDS.map((r) => r.producedByRunId)).size} 次识别任务产出
            </span>
            <Tag>识别侧成立的事实</Tag>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">导出记录清单</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '风险记录', value: RISK_RECORDS.length },
          { label: '覆盖工序节点', value: PROCESS_NODES.length },
          { label: '已有评估记录', value: withAssessments.length },
          { label: '已开处置任务', value: withWarnings.length },
          { label: '平均综合置信度', value: avgConfidence.toFixed(2) },
        ]}
      />

      <Section
        title="按工序节点与验收方式筛选"
        action={
          <div style={{ display: 'flex', gap: 'var(--dl-s2)' }}>
            {PROCESS_NODES.map((node) => (
              <button className="dl-btn dl-btn--sm" key={node} type="button">
                {node}
              </button>
            ))}
            <span style={{ width: 12 }} />
            {ROUTES.map((route) => (
              <button className="dl-btn dl-btn--sm dl-btn--quiet" key={route} type="button">
                {ACCEPTANCE_ROUTE_LABELS[route]}
              </button>
            ))}
          </div>
        }
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th>风险事件</th>
              <th>风险源</th>
              <th>工序节点</th>
              <th>验收方式</th>
              <th>入库时间</th>
              <th className="is-right">综合置信度</th>
              <th>下游评估</th>
              <th>记录号</th>
            </tr>
          </thead>
          <tbody>
            {RISK_RECORDS.map((r) => (
              <tr key={riskRecordKey(r)}>
                <td>
                  <div className="dl-sm" style={{ fontWeight: 600 }}>{r.record.riskEvent}</div>
                  <div className="dl-xs dl-faint">{r.record.riskFactor}</div>
                </td>
                <td className="dl-sm dl-muted">{r.record.riskSource}</td>
                <td className="dl-sm">{r.processNodeName}</td>
                <td>
                  <Tag accent={r.acceptanceRoute === 'review'}>
                    {ACCEPTANCE_ROUTE_LABELS[r.acceptanceRoute]}
                  </Tag>
                </td>
                <td className="dl-sm dl-num dl-muted">
                  {r.version.systemTime.recordedAt.slice(0, 10)}
                </td>
                <td className="is-right is-num dl-sm">{r.compositeConfidence.value.toFixed(2)}</td>
                <td className="dl-sm dl-muted">
                  {r.downstream.assessmentRecordIds.length > 0
                    ? `${r.downstream.assessmentRecordIds.length} 条评估记录`
                    : r.downstream.activeAssessmentRunId
                      ? '评估进行中'
                      : '尚未评估'}
                </td>
                <td className="dl-xs dl-mono dl-faint">{riskRecordKey(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
