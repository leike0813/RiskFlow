// P-RI-07 工序风险关联图谱（B 详情骨架 + 图谱画布叠加形态）。
// 骨架：B 详情；图谱画布全宽呈现，数据全部来自 fixture（seed 固定，评审可复现）。
// 数据 branch：knowledge-modeling.relationship-context；页面级能力位：risk-identification.read。
// tone 'risk' 的边必须带 label（识别产出等级依据入图例）；风险色只经
// GraphView 的 riskLevel 通道进入，页面不拼风险色样式。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「暂无关联数据」。

import type { RouteRenderInput } from '../../app/routes';
import { GraphView } from '../../charts';
import { PageFrame } from '../../shared/PageFrame';
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_SEED,
  LINKS,
  riskRecordById,
  type GraphNodeFixture,
} from '../../content/identification';
import { EventTimeline, FieldCard } from './widgets';

function nodeHref(node: GraphNodeFixture): string {
  if (node.kind === '工序节点') return LINKS.identificationProcessModel;
  if (node.kind === '机理条目') return LINKS.knowledgeMechanisms;
  if (node.kind === '资料段') return LINKS.evidenceTrace;
  return LINKS.identificationRecord(node.id);
}

export function GraphViewPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="工序风险关联图谱"
      state={input.pageState}
      skeleton="B"
      emptyMessage="暂无关联数据"
      content={
        <div className="ri-page">
          <p className="ri-context-subtitle">
            呈现工序节点、风险机理条目、标准化风险记录与资料段证据的关联；
            风险记录节点与「识别产出」边的颜色按最新评估等级呈现（未评估记录不着风险色）。
          </p>

          <FieldCard title="关联图谱">
            <GraphView
              nodes={GRAPH_NODES.map((node) => ({
                id: node.id,
                label: node.label,
                tone: node.tone,
                riskLevel: node.riskLevel,
              }))}
              edges={GRAPH_EDGES.map((edge) => ({
                source: edge.source,
                target: edge.target,
                label: edge.label,
                tone: edge.tone,
                riskLevel: edge.riskLevel,
              }))}
              width={960}
              height={460}
              seed={GRAPH_SEED}
              selectedNodeId="PN-VDS-04"
              title="工序风险关联图谱"
              emptyMessage="暂无关联数据"
            />
          </FieldCard>

          <FieldCard title="节点清单与跳转">
            <div className="ri-table-wrap">
              <table className="ri-table">
                <thead>
                  <tr>
                    <th>节点</th>
                    <th>类型</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {GRAPH_NODES.map((node) => {
                    const record = riskRecordById(node.id);
                    return (
                      <tr key={node.id}>
                        <td>
                          <a className="mono" href={nodeHref(node)}>
                            {node.id}
                          </a>
                        </td>
                        <td>{node.kind}</td>
                        <td>
                          {record === undefined
                            ? node.label
                            : `${record.record.riskEvent}；综合置信度 ${record.compositeConfidence.value.toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FieldCard>

          <FieldCard title="追溯链">
            <p className="ri-trace-row">
              资料段{' '}
              <a className="mono" href={LINKS.evidenceTrace}>
                DOC2026001-S32-SEG007
              </a>
              {' → '}工序节点{' '}
              <a href={LINKS.identificationProcessModel}>
                变径空间扩挖（<span className="mono">PN-VDS-04</span>）
              </a>
              {' → '}机理条目{' '}
              <a className="mono" href={LINKS.knowledgeMechanisms}>
                MEC-VDS-017
              </a>
              {' → '}标准化风险记录{' '}
              <a className="mono" href={LINKS.identificationRecord('RISK-2026-001')}>
                RISK-2026-001
              </a>
              {' → '}风险评估记录{' '}
              <a className="mono" href={LINKS.assessmentRecord('ASSESS-2026-001')}>
                ASSESS-2026-001
              </a>
            </p>
          </FieldCard>

          <EventTimeline
            events={[
              {
                at: '2026-08-20 10:00',
                label: '机理库 MEC-LIB-VDS · v2026.08 发布',
                href: LINKS.knowledgeMechanisms,
              },
              {
                at: '2026-08-27 09:18',
                label: '识别运行 RUN-20260827-001 完成，关联关系刷新',
                href: LINKS.identificationRun('RUN-20260827-001'),
              },
              { at: '2026-08-27 09:30', label: '图谱按最新评估等级重绘' },
            ]}
          />
        </div>
      }
    />
  );
}
