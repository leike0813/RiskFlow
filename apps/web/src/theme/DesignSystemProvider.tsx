/**
 * 生产设计系统的唯一入口：在挂载时读取一次根元素计算后的生产令牌，生成稳定的 AntD
 * ThemeConfig 与图表主题，让 ConfigProvider 与 Canvas 图表消费同一组实际颜色。
 *
 * 约束（见 openspec/specs/web/design-system/spec.md DS-R1）：
 * - 生产默认在浏览器挂载时解析实际颜色；模块加载时不得访问 document。
 * - SSR/隔离测试通过 `themes` 显式注入，不另抄一套 hex 作为默认值。
 * - 解析只发生一次。轮询、图表单元格与每次渲染都不再读 DOM。
 */
import { ConfigProvider, theme as antdTheme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createContext, useContext, useState, type ReactNode } from "react";

import { DEFAULT_CHART_THEME, type ChartTheme } from "../charts/types.js";

export interface DesignSystemThemes {
  readonly antd: ThemeConfig;
  readonly chart: ChartTheme;
}

/** 显式令牌名集合：解析范围固定在此，新增令牌不会自动进入 JS 主题。 */
const CHART_TOKENS = {
  primary: "--blue",
  review: "--review",
  neutralSoft: "--bluegray-soft",
  text: "--text",
  textSecondary: "--text-2",
  border: "--border",
  riskBoundary: "--risk-1-dark",
} as const satisfies Record<
  keyof Omit<ChartTheme, "levelPalette" | "levelForegroundPalette">,
  string
>;

const LEVEL_PALETTE_TOKENS = [
  "--risk-4-soft",
  "--risk-3-soft",
  "--risk-2-soft",
  "--risk-1-soft",
] as const;

const LEVEL_FOREGROUND_TOKENS = [
  "--risk-4-text",
  "--risk-3-text",
  "--risk-2-text",
  "--risk-1-dark",
] as const;

const DesignSystemThemeContext = createContext<DesignSystemThemes>({
  antd: {},
  chart: DEFAULT_CHART_THEME,
});

/**
 * 无 document 时返回 null，调用方退回显式注入或生产 CSS 变量默认；SSR 不会因
 * 缺少 document 而崩溃，也不会凭空造一份与 tokens.css 不同步的色值。
 */
const readThemesFromDocument = (): DesignSystemThemes | null => {
  if (typeof document === "undefined") return null;
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string): string => styles.getPropertyValue(name).trim();
  const chart: ChartTheme = {
    primary: token(CHART_TOKENS.primary),
    review: token(CHART_TOKENS.review),
    neutralSoft: token(CHART_TOKENS.neutralSoft),
    text: token(CHART_TOKENS.text),
    textSecondary: token(CHART_TOKENS.textSecondary),
    border: token(CHART_TOKENS.border),
    riskBoundary: token(CHART_TOKENS.riskBoundary),
    levelPalette: LEVEL_PALETTE_TOKENS.map(token),
    levelForegroundPalette: LEVEL_FOREGROUND_TOKENS.map(token),
  };
  return {
    // 派生算法消费已解析的实际颜色；把 var(...) 当 seed 会得到无效算法输入。
    antd: {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: chart.primary,
        colorSuccess: token("--success"),
        colorError: token("--error"),
        colorInfo: chart.primary,
        colorBgLayout: token("--page-bg"),
        colorBgContainer: token("--card"),
        colorBorder: chart.border,
        colorText: chart.text,
        colorTextSecondary: chart.textSecondary,
        fontFamily: token("--font"),
        fontSize: Number.parseFloat(token("--text-md")),
        lineHeight:
          Number.parseFloat(token("--text-md-lh")) / Number.parseFloat(token("--text-md")),
        borderRadius: Number.parseFloat(token("--radius-md")),
      },
    },
    chart,
  };
};

export function DesignSystemProvider({
  themes,
  children,
}: {
  themes?: DesignSystemThemes;
  children: ReactNode;
}): ReactNode {
  // 惰性初始值只在首次渲染求值，等价于挂载一次；此后不再读 DOM。
  const [resolved] = useState<DesignSystemThemes | null>(() => themes ?? readThemesFromDocument());
  const value = themes ?? resolved ?? { antd: {}, chart: DEFAULT_CHART_THEME };
  return (
    <DesignSystemThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={value.antd}>
        {children}
      </ConfigProvider>
    </DesignSystemThemeContext.Provider>
  );
}

/** 图表统一消费已解析的稳定主题；不在渲染或 resize 时回读 CSS 变量。 */
export const useChartTheme = (): ChartTheme => useContext(DesignSystemThemeContext).chart;
