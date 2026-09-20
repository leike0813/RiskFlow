// P-RV-04 证据追溯（B 详情骨架）。
// 骨架：B 详情（标题区 + 追溯链字段分组卡 + 底部业务事件时间线）。
// 数据 branch：review-audit.trace；页面级能力位：review-audit.read（框架层门控）。
// 端到端追溯链集中呈现：资料段 → 工序节点 → 机理条目 → 标准化风险记录 →
// 评估运行 / 评估记录 → 预警 → 处置建议 → 偏差 / 校准建议，全链深链可点（沿典范链 fixture）。
// 七态：非 ready 态由 PageFrame 承载；本页数据沿典范链恒定存在，无自然空态分支。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  TRACE_CHAIN,
  TRACE_CHAIN_EVENTS,
  TRACE_EVIDENCE_REFERENCES,
  type TraceChainNode,
} from '../../content/review';
import { EventTimeline, Field, FieldCard, VersionedRefText } from './widgets';

function TraceNodeCard({ node, index, total }: { readonly node: TraceChainNode; readonly index: number; readonly total: number }) {
  return (
    <li className="rv-trace-node">
      <span className="rv-trace-step" aria-hidden="true">
        <span className="rv-trace-index">{index + 1}</span>
        {index + 1 < total ? <span className="rv-trace-connector" /> : null}
      </span>
      <div className="rv-trace-card">
        <div className="rv-trace-head">
          <span className="rv-trace-kind">{node.label}</span>
          <a className="mono" href={node.href}>
            {node.id}
          </a>
          <span>{node.summary}</span>
        </div>
        {node.fields.length === 0 ? null : (
          <dl className="rv-field-grid">
            {node.fields.map((field) => (
              <Field key={field.label} label={field.label}>
                {field.value}
              </Field>
            ))}
          </dl>
        )}
        {node.versionRefs.length === 0 ? null : (
          <div className="rv-vref-list">
            {node.versionRefs.map((ref) => (
              <VersionedRefText
                key={`${ref.reference.entityId}-${ref.reference.versionId}`}
                kindLabel={ref.kindLabel}
                reference={ref.reference}
              />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function EvidenceTracePage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="证据追溯"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前没有可呈现的追溯链"
      content={
        <div className="rv-page">
          <p className="rv-context-subtitle">
            示例工程 · 站隧一体化标；沿典范链呈现资料段 → 工序节点 → 机理条目 → 风险记录 →
            评估记录 → 预警 → 处置 → 偏差 / 校准的完整追溯。
          </p>

          <FieldCard title="端到端追溯链">
            <ol className="rv-trace-chain">
              {TRACE_CHAIN.map((node, index) => (
                <TraceNodeCard
                  key={node.key}
                  node={node}
                  index={index}
                  total={TRACE_CHAIN.length}
                />
              ))}
            </ol>
          </FieldCard>

          <FieldCard title="证据引用">
            <div className="rv-table-wrap">
              <table className="rv-table">
                <thead>
                  <tr>
                    <th scope="col">资料段</th>
                    <th scope="col">资料版本</th>
                  </tr>
                </thead>
                <tbody>
                  {TRACE_EVIDENCE_REFERENCES.map((evidence) => (
                    <tr key={evidence.locator.sourceSegmentId}>
                      <td>
                        <a className="mono" href="#/projects/sources/DOC2026001">
                          {evidence.locator.sourceSegmentId}
                        </a>
                      </td>
                      <td>
                        <VersionedRefText kindLabel="资料" reference={evidence.sourceVersion} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FieldCard>

          <EventTimeline events={TRACE_CHAIN_EVENTS} />
        </div>
      }
    />
  );
}
