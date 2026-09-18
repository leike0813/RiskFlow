// graph（关系图谱）：节点/边数据驱动，确定性力导向布局（同一种子同一布局）。
// 节点：圆角矩形白底 1px 描边；active 节点 1.5px 工程蓝；risk 节点按级别取风险色。
// 边：1.5px 蓝灰带箭头；risk 边按级别取风险色并须配文字标签（label 由调用方给出）。
// 左下角缩放控件（放大 / 缩小 / 重置），画布可拖拽平移。空态：居中提示。

import { useMemo, useRef, useState, useId, type PointerEvent } from 'react';
import { ChartSurface } from './ChartSurface';
import {
  DEFAULT_CHART_THEME,
  resolveChartStatus,
  type ChartStateProps,
  type ChartTheme,
  type RiskLevelKey,
} from './types';

export type GraphNodeTone = 'default' | 'active' | 'risk';

export interface GraphNodeData {
  readonly id: string;
  readonly label: string;
  readonly tone?: GraphNodeTone;
  readonly riskLevel?: RiskLevelKey;
}

export interface GraphEdgeData {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly tone?: 'default' | 'risk';
  readonly riskLevel?: RiskLevelKey;
}

export interface GraphViewProps extends ChartStateProps {
  readonly nodes: readonly GraphNodeData[];
  readonly edges: readonly GraphEdgeData[];
  /** viewBox 尺寸，默认 720×420。 */
  readonly width?: number;
  readonly height?: number;
  /** 布局种子：同节点集 + 同种子 → 同布局。 */
  readonly seed?: number;
  /** 当前选中节点（按 active 呈现）。 */
  readonly selectedNodeId?: string;
  readonly title?: string;
  readonly theme?: ChartTheme;
}

interface LayoutPoint {
  x: number;
  y: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layoutGraph(
  nodes: readonly GraphNodeData[],
  edges: readonly GraphEdgeData[],
  width: number,
  height: number,
  seed: number,
): Map<string, LayoutPoint> {
  const rand = mulberry32(seed);
  const positions = new Map<string, LayoutPoint>();
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * width * 0.28 + (rand() - 0.5) * 24,
      y: height / 2 + Math.sin(angle) * height * 0.28 + (rand() - 0.5) * 24,
    });
  });
  const margin = 72;
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const deltas = new Map<string, LayoutPoint>(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = positions.get(nodes[i].id)!;
        const b = positions.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq < 1) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          distanceSq = 1;
        }
        const force = 9000 / distanceSq;
        const distance = Math.sqrt(distanceSq);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        deltas.get(nodes[i].id)!.x += fx;
        deltas.get(nodes[i].id)!.y += fy;
        deltas.get(nodes[j].id)!.x -= fx;
        deltas.get(nodes[j].id)!.y -= fy;
      }
    }
    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 150) * 0.015;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      deltas.get(edge.source)!.x += fx;
      deltas.get(edge.source)!.y += fy;
      deltas.get(edge.target)!.x -= fx;
      deltas.get(edge.target)!.y -= fy;
    }
    for (const node of nodes) {
      const point = positions.get(node.id)!;
      const delta = deltas.get(node.id)!;
      point.x = Math.min(width - margin, Math.max(margin, point.x + delta.x + (width / 2 - point.x) * 0.008));
      point.y = Math.min(height - margin, Math.max(margin, point.y + delta.y + (height / 2 - point.y) * 0.008));
    }
  }
  return positions;
}

function nodeSize(label: string): { width: number; height: number } {
  return { width: Math.max(64, label.length * 13 + 20), height: 30 };
}

export function GraphView({
  nodes,
  edges,
  width = 720,
  height = 420,
  seed = 1,
  selectedNodeId,
  title,
  theme = DEFAULT_CHART_THEME,
  status: statusProp,
  unavailableReasons,
  emptyMessage = '暂无关联数据',
}: GraphViewProps) {
  const status = resolveChartStatus(nodes.length > 0, statusProp);
  const positions = useMemo(
    () => layoutGraph(nodes, edges, width, height, seed),
    [nodes, edges, width, height, seed],
  );
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const markerPrefix = useId().replace(/[^a-zA-Z0-9]/g, '');

  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: view.x,
      baseY: view.y,
    };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: drag.baseX + (event.clientX - drag.startX),
      y: drag.baseY + (event.clientY - drag.startY),
    }));
  };
  const onPointerUp = (): void => {
    dragRef.current = null;
  };

  const trimEdge = (
    from: LayoutPoint,
    to: LayoutPoint,
    fromLabel: string,
    toLabel: string,
  ): { x1: number; y1: number; x2: number; y2: number } => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const trimFor = (label: string): number => {
      const { width: w, height: h } = nodeSize(label);
      const tx = Math.abs(ux) < 1e-6 ? Number.POSITIVE_INFINITY : w / 2 / Math.abs(ux);
      const ty = Math.abs(uy) < 1e-6 ? Number.POSITIVE_INFINITY : h / 2 / Math.abs(uy);
      return Math.min(tx, ty) + 2;
    };
    const start = trimFor(fromLabel);
    const end = trimFor(toLabel) + 4;
    return {
      x1: from.x + ux * start,
      y1: from.y + uy * start,
      x2: to.x - ux * end,
      y2: to.y - uy * end,
    };
  };

  const body = (
    <div className="chart-graph-wrap">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title ?? '关系图谱'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="chart-graph-canvas"
      >
        <defs>
          <marker
            id={`${markerPrefix}-arrow`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill={theme.neutral} />
          </marker>
          <marker
            id={`${markerPrefix}-arrow-risk`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill={theme.risk[2]} />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map((edge, index) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            const sourceNode = nodes.find((node) => node.id === edge.source);
            const targetNode = nodes.find((node) => node.id === edge.target);
            if (!source || !target || !sourceNode || !targetNode) return null;
            const { x1, y1, x2, y2 } = trimEdge(source, target, sourceNode.label, targetNode.label);
            const risk = edge.tone === 'risk';
            const stroke = risk ? theme.risk[edge.riskLevel ?? 2] : theme.neutral;
            return (
              <g key={`${edge.source}->${edge.target}-${index}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth={1.5}
                  markerEnd={`url(#${markerPrefix}-arrow${risk ? '-risk' : ''})`}
                />
                {edge.label === undefined ? null : (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 4}
                    textAnchor="middle"
                    className="chart-edge-label"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const { width: nodeWidth, height: nodeHeight } = nodeSize(node.label);
            const active = node.id === selectedNodeId || node.tone === 'active';
            const risk = !active && node.tone === 'risk';
            const level = node.riskLevel ?? 2;
            const fill = active ? theme.primarySoft : risk ? theme.riskSoft[level] : theme.surface;
            const stroke = active ? theme.primary : risk ? theme.risk[level] : theme.border;
            return (
              <g key={node.id}>
                <rect
                  x={point.x - nodeWidth / 2}
                  y={point.y - nodeHeight / 2}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={active || risk ? 1.5 : 1}
                />
                <text x={point.x} y={point.y + 4} textAnchor="middle" className="chart-label">
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="chart-graph-controls" role="group" aria-label="图谱缩放">
        <button
          type="button"
          aria-label="放大"
          onClick={() => setView((current) => ({ ...current, k: Math.min(2.5, current.k * 1.25) }))}
        >
          +
        </button>
        <button
          type="button"
          aria-label="缩小"
          onClick={() => setView((current) => ({ ...current, k: Math.max(0.4, current.k / 1.25) }))}
        >
          −
        </button>
        <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          重置
        </button>
      </div>
    </div>
  );

  return (
    <ChartSurface
      title={title}
      status={status}
      unavailableReasons={unavailableReasons}
      emptyMessage={emptyMessage}
      maxWidth={width + 32}
    >
      {body}
    </ChartSurface>
  );
}
