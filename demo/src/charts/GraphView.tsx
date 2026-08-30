import { useChart } from './useChart'
import type { EChartsCoreOption } from 'echarts/core'

/** 图谱节点分类配色：工序=工程蓝、机理=紫灰、风险事件=红描边、资料证据=浅灰、装备构件=蓝灰 */
const categoryStyles: Record<
  string,
  { color: string; borderColor?: string; borderWidth?: number; textColor: string }
> = {
  工序: { color: '#2166d1', textColor: '#ffffff' },
  机理: { color: '#7e7390', textColor: '#ffffff' },
  风险事件: { color: '#ffffff', borderColor: '#d9363e', borderWidth: 2, textColor: '#d9363e' },
  资料证据: { color: '#edf1f6', borderColor: '#dce4ee', borderWidth: 1, textColor: '#63758a' },
  装备构件: { color: '#8fa6c0', textColor: '#ffffff' },
}

const fallbackStyle = { color: '#8fa6c0', textColor: '#ffffff' }

/** 工序风险关联图谱视图（echarts graph，力导向布局） */
export function GraphView({
  nodes,
  edges,
  height,
}: {
  nodes: { id: string; name: string; category: string }[]
  edges: { source: string; target: string; label?: string }[]
  height: number
}) {
  const option: EChartsCoreOption = {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        force: { repulsion: 320, edgeLength: [80, 140], gravity: 0.08 },
        label: {
          show: true,
          position: 'inside',
          fontSize: 11,
          formatter: '{b}',
        },
        edgeLabel: {
          show: true,
          fontSize: 10,
          color: '#63758a',
          formatter: (p: { data?: { edgeLabel?: string } }) => p.data?.edgeLabel ?? '',
        },
        lineStyle: { color: '#c3cfdd', width: 1.2, curveness: 0.08 },
        emphasis: { disabled: true },
        data: nodes.map((n) => {
          const st = categoryStyles[n.category] ?? fallbackStyle
          return {
            id: n.id,
            name: n.name,
            symbolSize: n.category === '工序' ? 64 : 52,
            itemStyle: {
              color: st.color,
              borderColor: st.borderColor,
              borderWidth: st.borderWidth,
            },
            label: { color: st.textColor },
          }
        }),
        links: edges.map((e) => ({
          source: e.source,
          target: e.target,
          edgeLabel: e.label,
        })),
      },
    ],
  }

  const ref = useChart(option, [JSON.stringify(nodes), JSON.stringify(edges), height])
  return <div ref={ref} style={{ height, width: '100%' }} />
}
