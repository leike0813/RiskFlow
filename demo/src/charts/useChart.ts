import { useEffect, useRef, type DependencyList } from 'react'
import { echarts } from './echarts'
import type { EChartsCoreOption } from 'echarts/core'

/** 挂载/更新 echarts 实例的通用 Hook；容器尺寸变化时自适应 */
export function useChart(option: EChartsCoreOption, deps: DependencyList) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chart.setOption(option)
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
