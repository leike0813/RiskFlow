import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "../src/components/DataTable.js";
import { PageStateView } from "../src/components/PageStateView.js";
import { RiskBadge } from "../src/components/RiskBadge.js";
import {
  RiskMatrixVersionChart,
  type RiskMatrixDefinition,
} from "../src/charts/RiskMatrixChart.js";
import { DEFAULT_CHART_THEME, type ChartTheme } from "../src/charts/types.js";
import {
  DesignSystemProvider,
  type DesignSystemThemes,
} from "../src/theme/DesignSystemProvider.js";
import { presentRiskLevel } from "../src/theme/riskPresentation.js";

/** 显式主题让断言落在具体色值上，不依赖 jsdom 计算样式或 CSS 变量解析。 */
const CHART_THEME: ChartTheme = {
  primary: "#2166d1",
  review: "#7e7390",
  neutralSoft: "#eef2f7",
  text: "#172b4d",
  textSecondary: "#63758a",
  border: "#dce4ee",
  riskBoundary: "#a61e24",
  levelPalette: ["#e6f5ee", "#fdf6e0", "#fef1e7", "#fdebec"],
  levelForegroundPalette: ["#12633d", "#8a6604", "#9a3412", "#a61e24"],
};

const THEMES: DesignSystemThemes = { antd: {}, chart: CHART_THEME };

const withTheme = (node: React.ReactNode): string =>
  renderToStaticMarkup(<DesignSystemProvider themes={THEMES}>{node}</DesignSystemProvider>);

/** 矩阵格子都带可读 <title>；图例色点没有，据此只数真正的单元格。 */
const CELL_RECT_GLOBAL = /<rect[^>]*><title/g;

describe("受控风险等级呈现", () => {
  // 合法配置的等级标识与 level-1 等原型字面量无关，呈现只认 ordinal 与显示名。
  const cases = [
    { levelId: "低度", ordinal: 1, displayName: "低度", expected: "#e6f5ee", text: "#12633d" },
    {
      levelId: "甲类-黄色关注",
      ordinal: 2,
      displayName: undefined,
      expected: "#fdf6e0",
      text: "#8a6604",
    },
    { levelId: "III-橙", ordinal: 3, displayName: "中度", expected: "#fef1e7", text: "#9a3412" },
    { levelId: "严重", ordinal: 4, displayName: "重度", expected: "#fdebec", text: "#a61e24" },
  ] as const;

  it.each(cases)(
    "$levelId（序 $ordinal）取该序的受控配色",
    ({ levelId, ordinal, displayName, expected, text }) => {
      const shown = presentRiskLevel({ levelId, ordinal, displayName }, CHART_THEME);
      expect(shown.mapped).toBe(true);
      expect(shown.label).toBe(displayName ?? levelId);
      expect(shown.background).toBe(expected);
      expect(shown.foreground).toBe(text);
    },
  );

  it("四个已定义等级得到互不相同的底色", () => {
    const backgrounds = cases.map(
      (item) =>
        presentRiskLevel({ levelId: item.levelId, ordinal: item.ordinal }, CHART_THEME).background,
    );
    expect(new Set(backgrounds).size).toBe(cases.length);
  });

  // 缺 ordinal、超出已定义四级、以及 0/负序都不得被夹取或取模成别的等级。
  const unmapped = [
    { name: "缺顺序", input: { levelId: "未知等级甲" } },
    { name: "超出四级", input: { levelId: "第五级", ordinal: 5 } },
    { name: "顺序为零", input: { levelId: "零级", ordinal: 0 } },
    { name: "顺序为负", input: { levelId: "负级", ordinal: -1 } },
  ] as const;

  it.each(unmapped)("$name 保留实际标识并中性呈现", ({ input }) => {
    const shown = presentRiskLevel(input, CHART_THEME);
    expect(shown.mapped).toBe(false);
    expect(shown.label).toBe(input.levelId);
    expect(shown.background).toBe(CHART_THEME.neutralSoft);
    expect(shown.foreground).toBe(CHART_THEME.text);
  });

  it("不可映射等级不会复用第一级配色", () => {
    const first = presentRiskLevel({ levelId: "一级", ordinal: 1 }, CHART_THEME);
    const overflow = presentRiskLevel({ levelId: "第五级", ordinal: 5 }, CHART_THEME);
    expect(overflow.background).not.toBe(first.background);
  });

  it.each([undefined, 5, 1.5, Number.NaN])(
    "徽章在不可映射顺序 %s 时保留显示名、原始标识与安全说明",
    (ordinal) => {
      const input = { levelId: "预警-自定义级", displayName: "特殊关注", ordinal };
      const shown = presentRiskLevel(input, CHART_THEME);
      expect(shown.mapped).toBe(false);
      expect(shown.label).toContain(input.levelId);
      expect(shown.label).toContain(input.displayName);
      expect(shown.background).toBe(CHART_THEME.neutralSoft);
      expect(shown.foreground).toBe(CHART_THEME.text);
      const markup = withTheme(<RiskBadge {...input} />);
      expect(markup).toContain(input.levelId);
      expect(markup).toContain(input.displayName);
      expect(markup).toContain("配色未定义");
    },
  );

  it("可映射等级不显示未定义说明", () => {
    const markup = withTheme(<RiskBadge levelId="自定义级" ordinal={2} displayName="中度" />);
    expect(markup).toContain("中度");
    expect(markup).not.toContain("该等级配色未定义");
  });
});

describe("配置驱动矩阵", () => {
  const buildDefinition = (
    probabilityTicks: readonly string[],
    consequenceTicks: readonly string[],
    levelIds: readonly string[],
  ): RiskMatrixDefinition => ({
    probability: { label: "发生可能性 P", ticks: probabilityTicks },
    consequence: { label: "后果严重度 C", ticks: consequenceTicks },
    levels: levelIds.map((levelId, index) => ({
      key: levelId,
      label: levelId,
      ordinal: index + 1,
    })),
    cellLevels: probabilityTicks.map((_pTick, p) =>
      consequenceTicks.map(() => levelIds[p % levelIds.length]),
    ),
  });

  // 3×2 与 5×5 都是已授权配置形态，轴标识也不必是连续整数。
  const shapes = [
    {
      name: "3×2",
      p: ["p-91", "p-11", "p-46"],
      c: ["c-81", "c-03"],
      levels: ["低", "中", "高"],
    },
    {
      name: "5×5",
      p: ["p-10", "p-20", "p-30", "p-40", "p-50"],
      c: ["c-07", "c-13", "c-21", "c-34", "c-55"],
      levels: ["一档", "二档", "三档", "四档", "五档"],
    },
  ] as const;

  it.each(shapes)("$name 的稀疏轴决定落点位置、重复计数和版本隔离", ({ p, c, levels }) => {
    const other = shapes.find((shape) => shape.p !== p)!;
    const markup = withTheme(
      <RiskMatrixVersionChart
        definition={buildDefinition(p, c, [...levels])}
        plots={[
          { possibilityBandId: p[0], consequenceBandId: c[1] },
          { possibilityBandId: p[0], consequenceBandId: c[1], count: 3 },
          { possibilityBandId: p[p.length - 1], consequenceBandId: c[0] },
          { possibilityBandId: other.p[0], consequenceBandId: other.c[0], count: 9 },
        ]}
      />,
    );
    for (const tick of [...p, ...c]) expect(markup).toContain(tick);
    for (const foreign of [...other.p, ...other.c, ...other.levels]) {
      expect(markup).not.toContain(foreign);
    }
    for (const level of levels) expect(markup).toContain(level);
    const cells = [...markup.matchAll(/<rect\b([^>]*)><title>([^<]*)<\/title><\/rect>/g)];
    expect(cells).toHaveLength(p.length * c.length);
    const attribute = (attributes: string, name: string): number =>
      Number(new RegExp(`\\b${name}="([^"]+)"`).exec(attributes)?.[1]);
    const dots = [...markup.matchAll(/<circle\b([^>]*\br="4"[^>]*)>/g)];
    expect(dots).toHaveLength(2);
    const expectedCells = [cells[(p.length - 1) * c.length], cells[1]];
    dots.forEach((dot, index) => {
      const cell = expectedCells[index][1];
      expect(attribute(dot[1], "cx")).toBe(attribute(cell, "x") + attribute(cell, "width") / 2);
      expect(attribute(dot[1], "cy")).toBe(attribute(cell, "y") + attribute(cell, "height") / 2);
      expect(expectedCells[index][2]).toContain(index === 0 ? levels[p.length - 1] : levels[0]);
    });
    const counts = [...markup.matchAll(/<text\b([^>]*)>(\d+)<\/text>/g)];
    expect(counts).toHaveLength(1);
    expect(counts[0][2]).toBe("4");
    expect(attribute(counts[0][1], "x")).toBe(attribute(dots[1][1], "cx") + 10);
    expect(attribute(counts[0][1], "y")).toBe(attribute(dots[1][1], "cy") - 7);
  });

  it("未被格子引用的未知等级仍在图例保留原 ID、显示名与安全说明", () => {
    const definition = buildDefinition(["p-甲"], ["c-甲"], ["已知"]);
    const markup = withTheme(
      <RiskMatrixVersionChart
        definition={{
          ...definition,
          levels: [...definition.levels, { key: "未落点级-ID", label: "特殊关注", ordinal: 8 }],
        }}
      />,
    );
    const outsideCells = markup.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, "");
    expect(outsideCells).toContain("未落点级-ID");
    expect(outsideCells).toContain("特殊关注");
    expect(outsideCells).toContain("配色未定义");
  });

  it("未知等级格子的可访问名称保留原 ID、显示名与安全说明", () => {
    const definition = buildDefinition(["p-甲"], ["c-甲"], ["未知-ID"]);
    const markup = withTheme(
      <RiskMatrixVersionChart
        definition={{
          ...definition,
          levels: [{ key: "未知-ID", label: "特殊关注", ordinal: 8 }],
        }}
      />,
    );
    const title = /<rect\b[^>]*><title>([^<]*)<\/title>/.exec(markup)?.[1];
    expect(title).toContain("未知-ID");
    expect(title).toContain("特殊关注");
    expect(title).toContain("配色未定义");
  });

  it("缺少维度时按 empty 呈现而不是补画固定行列", () => {
    const markup = withTheme(
      <RiskMatrixVersionChart definition={buildDefinition([], ["c-甲"], ["低", "中"])} />,
    );
    expect(markup).toContain("chart-frame-empty");
    expect(markup.match(CELL_RECT_GLOBAL) ?? []).toHaveLength(0);
  });

  it("来源不可用时说明原因码且不渲染矩阵", () => {
    const markup = withTheme(
      <RiskMatrixVersionChart
        definition={buildDefinition(["p-甲"], ["c-甲"], ["低"])}
        status="unavailable"
        unavailableReasons={[{ code: "SOURCE_READ_FAILED" }]}
      />,
    );
    expect(markup).toContain("SOURCE_READ_FAILED");
    expect(markup.match(CELL_RECT_GLOBAL) ?? []).toHaveLength(0);
  });
});

describe("共享数据表格", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    recordId: `record-${index + 1}`,
    label: `条目 ${index + 1}`,
  }));

  const columns: DataTableColumn[] = [
    { key: "recordId", title: "标识", width: 200 },
    {
      key: "label",
      title: "名称",
      render: (row) => <a href={`/records/${String(row.recordId)}`}>{String(row.label)}</a>,
    },
  ];

  it("超过内置分页容量的当前页条目全部保留", () => {
    const markup = withTheme(<DataTable columns={columns} rows={rows} />);
    for (const row of rows) {
      expect(markup).toContain(String(row.recordId));
      expect(markup).toContain(`/records/${String(row.recordId)}`);
    }
  });

  it("不引入第二套客户端分页", () => {
    const markup = withTheme(<DataTable columns={columns} rows={rows} />);
    expect(markup).not.toContain("ant-pagination");
  });

  it("行点击可用时提供键盘可聚焦的行", () => {
    const markup = withTheme(<DataTable columns={columns} rows={rows} onRowClick={() => {}} />);
    expect(markup).toContain("data-table-row--clickable");
    expect(markup).toContain(`tabindex="0"`);
  });
});

describe("页面不可用状态", () => {
  it("只披露已脱敏的原因码并保留重试入口", () => {
    const markup = withTheme(
      <PageStateView
        state={{ kind: "unavailable", reasons: [{ code: "MATRIX_DEFINITION_MISSING" }] }}
        title="风险矩阵"
        onRetry={() => {}}
      >
        {() => <div>ready</div>}
      </PageStateView>,
    );
    expect(markup).toContain("MATRIX_DEFINITION_MISSING");
    expect(markup).toContain("重试");
    expect(markup).not.toContain("ready");
  });

  it("不可用不混同为 empty 或 forbidden", () => {
    const markup = withTheme(
      <PageStateView state={{ kind: "unavailable", reasons: [] }} title="风险矩阵">
        {() => <div>ready</div>}
      </PageStateView>,
    );
    expect(markup).toContain('data-page-state="unavailable"');
  });
});

describe("图表主题默认值", () => {
  it("默认等级前景与底色同序且长度一致", () => {
    expect(DEFAULT_CHART_THEME.levelForegroundPalette).toHaveLength(
      DEFAULT_CHART_THEME.levelPalette.length,
    );
  });
});
