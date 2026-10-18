// PROTOTYPE · THROWAWAY — 票 05 第 11 页：工序风险关联图谱
// 票 02 已定：图谱页只画图，不重复放风险记录列表。节点与边全部由 fixture 派生，布局种子入图以保证同种子同布局。
// 风险四级色不上图：图里连线一律中性色，等级由右侧 RiskBadge 图例表达（唯一色出口）。

import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_SEED,
  LINKS,
  type GraphNodeFixture,
} from '../../../content/identification';
import { Ids, RiskBadge, Section, Stats, Tag } from '../parts';

/** 列 = 节点类别，顺序取自 fixture 中类别首次出现的次序；行 = 类别内出现次序。 */
const COLUMNS = GRAPH_NODES.filter(
  (node, i) => GRAPH_NODES.findIndex((n) => n.kind === node.kind) === i,
).map((node) => node.kind);

const COLUMN_X = new Map(COLUMNS.map((kind, i) => [kind, 150 + i * 210]));

/** 同类节点的行位由其在该类中的序号推出，无硬编码坐标。 */
const ROW_Y = new Map(
  COLUMNS.flatMap((kind) =>
    GRAPH_NODES.filter((n) => n.kind === kind).map((node, i) => [node.id, 70 + i * 66] as const),
  ),
);

function nodeAt(id: string): { node: GraphNodeFixture; x: number; y: number } | null {
  const node = GRAPH_NODES.find((n) => n.id === id);
  if (!node) return null;
  const x = COLUMN_X.get(node.kind) ?? 150;
  const y = ROW_Y.get(node.id) ?? 70;
  return { node, x, y };
}

export function AssociationGraphPage() {
  const riskNodes = GRAPH_NODES.filter((n) => n.tone === 'risk' && n.riskLevel !== undefined);
  const width = 150 + (COLUMNS.length - 1) * 210 + 120;
  const height = 70 + Math.max(...GRAPH_NODES.map((n) => ROW_Y.get(n.id) ?? 70)) + 50;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">
            识别 / <a href={LINKS.identificationProcessModel}>工序模型</a> / 关联图谱
          </div>
          <h1 className="dl-h1">工序风险关联图谱</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              {GRAPH_NODES.length} 个对象 · {GRAPH_EDGES.length} 条关系 · 布局种子 {GRAPH_SEED}
            </span>
            <Tag>同种子同布局，评审可复现</Tag>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">按对象类别筛选</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">导出图</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '工序节点', value: GRAPH_NODES.filter((n) => n.kind === '工序节点').length },
          { label: '风险记录', value: GRAPH_NODES.filter((n) => n.kind === '风险记录').length },
          { label: '风险机理条目', value: GRAPH_NODES.filter((n) => n.kind === '机理条目').length },
          { label: '资料段', value: GRAPH_NODES.filter((n) => n.kind === '资料段').length },
          { label: '已定级风险', value: riskNodes.length },
        ]}
      />

      <Section title="关系图" flush>
        <div style={{ padding: 'var(--dl-s4)', overflowX: 'auto' }}>
          <svg
            role="img"
            aria-label="工序风险关联图谱"
            width={width}
            height={height}
            style={{ display: 'block', minWidth: width }}
          >
            {COLUMNS.map((kind, i) => (
              <text key={kind} x={150 + i * 210} y={28} textAnchor="middle" className="dl-xs dl-faint">
                {kind}
              </text>
            ))}

            {GRAPH_EDGES.map((edge) => {
              const from = nodeAt(edge.source);
              const to = nodeAt(edge.target);
              if (!from || !to) return null;
              const x1 = from.x + 66;
              const y1 = from.y;
              const x2 = to.x - 66;
              const y2 = to.y;
              const midX = (x1 + x2) / 2;
              return (
                <g key={`${edge.source}->${edge.target}-${edge.label}`}>
                  <path
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--dl-border-strong)"
                    strokeWidth={1}
                  />
                  <text
                    x={midX}
                    y={(y1 + y2) / 2 - 4}
                    textAnchor="middle"
                    className="dl-xs dl-faint"
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}

            {GRAPH_NODES.map((node) => {
              const at = nodeAt(node.id);
              if (!at) return null;
              return (
                <g key={node.id}>
                  <rect
                    x={at.x - 66}
                    y={at.y - 18}
                    width={132}
                    height={36}
                    rx={4}
                    fill="var(--dl-surface)"
                    stroke={node.tone === 'active' ? 'var(--dl-accent)' : 'var(--dl-border-strong)'}
                    strokeWidth={node.tone === 'active' ? 1.5 : 1}
                  />
                  <text x={at.x} y={at.y - 1} textAnchor="middle" className="dl-sm">
                    {node.label}
                  </text>
                  <text x={at.x} y={at.y + 12} textAnchor="middle" className="dl-xs dl-faint">
                    {node.id}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </Section>

      <Section title="图例">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {COLUMNS.map((kind) => (
            <span key={kind} className="dl-sm dl-muted">{kind}</span>
          ))}
          <span style={{ width: 1, height: 16, background: 'var(--dl-border)' }} />
          <span className="dl-xs dl-faint">连线文字为关系类型；风险四级色只在此处以文字等级表达</span>
          <span style={{ width: 1, height: 16, background: 'var(--dl-border)' }} />
          {riskNodes.map((node) => (
            <RiskBadge key={node.id} levelId={`level-${node.riskLevel}`} label={`${node.label} 已定级`} />
          ))}
        </div>
      </Section>

      <Ids
        pairs={[
          ['布局种子', String(GRAPH_SEED)],
          ['节点数', String(GRAPH_NODES.length)],
          ['关系数', String(GRAPH_EDGES.length)],
        ]}
      />
    </div>
  );
}
