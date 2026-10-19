import { useEffect, useRef, type DependencyList } from "react";
import { echarts } from "./echarts";
import type { EChartsCoreOption } from "echarts/core";
import type { SeriesOption } from "echarts";

/** 挂载/更新 echarts 实例的通用 Hook；容器尺寸变化时自适应 */
export function useChart(option: EChartsCoreOption, deps: DependencyList) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const createChart = () => {
      const chart = echarts.init(container);
      if (motion.matches) {
        const reduceSeries = (series: SeriesOption): SeriesOption =>
          series.type === "graph"
            ? { ...series, animation: false, force: { ...series.force, layoutAnimation: false } }
            : { ...series, animation: false };
        const series = option.series as SeriesOption | SeriesOption[] | undefined;
        chart.setOption({
          ...option,
          animation: false,
          ...(series === undefined
            ? {}
            : { series: Array.isArray(series) ? series.map(reduceSeries) : reduceSeries(series) }),
        });
      } else {
        chart.setOption(option);
      }
      return chart;
    };
    let chart = createChart();
    const onMotionChange = () => {
      chart.dispose();
      chart = createChart();
    };
    motion.addEventListener("change", onMotionChange);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      motion.removeEventListener("change", onMotionChange);
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, deps);

  return ref;
}
