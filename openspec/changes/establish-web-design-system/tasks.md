## 1. 依赖准备与可交接基线

- [ ] 1.1 [IP-01] 主调度在取得依赖及 Git 操作所需授权后，按 D-02 固定 antd 6.6.6，同步 manifest、七字段治理记录和锁文件；形成包含批准工件的交接基线，不提交用户无关改动。验证：`pnpm deps:policy`；缺少授权时不执行安装或提交。
- [ ] 1.2 [IP-01] 准备冻结传递依赖与离线材料，不放宽现有脚本/许可证政策。验证：联网交付机 `pnpm fetch --frozen-lockfile`；隔离验收副本 `pnpm install --offline --frozen-lockfile`，保留版本、来源与结果；不得删除用户工作区依赖。

## 2. 生产令牌与唯一主题入口

- [ ] 2.1 [IP-02] 按 D-03 更新生产令牌、成对字号行高、焦点、动效与减少动态效果；目标宽度只声明令牌，保留当前壳层布局。完成检查：既有七导航/停靠内容与深链不变；最终运行 `pnpm typecheck` 及实施计划命令 B。
- [ ] 2.2 [IP-02] 在唯一入口接入 DesignSystemProvider、中文 AntD 主题与稳定 ChartTheme，按 D-03 支持显式 SSR 注入，挂载一次解析真实颜色，不在渲染/轮询中反复读 DOM。验证：`pnpm build`；生产页面计算主题及资源请求按命令 B 核对。
- [ ] 2.3 [IP-02] 仅迁移 allowlist 中的普通错误/失败/危险操作色与 Login 普通说明色，保留真实预警风险语义；修正迁移区域折行/局部滚动和焦点样式，不改确认状态机。验证：命令 B 中真实失败反馈、键盘与缩放分支。

## 3. 共享基础组件实际消费

- [ ] 3.1 [IP-03] 将既有 DataTable 内部接到 AntD Table，保留原 props、当前页全部 rows、链接/列 render 和显式操作，关闭内置分页及额外数据变换；限定样式范围并保留原生表格消费者。验证：`pnpm exec vitest run apps/web/test/design-system.test.tsx`，覆盖至少 12 个不同对象链接；命令 B 核对键盘及原查询翻页。
- [ ] 3.2 [IP-03] 在原 PageStateView 七态中补 unavailable 安全原因与既有重试，不更换证据或确认机制。验证：`pnpm exec vitest run apps/web/test/design-system.test.tsx apps/web/test/ssr-shells.test.tsx`；命令 B 核对空/错误/无权与证据脱敏。

## 4. 风险语义与配置驱动图表

- [ ] 4.1 [IP-04] 按 D-05 实现 presentRiskLevel 和 RiskBadge，迁移 WarningCenter/WarningDetail；未知 ordinal 保留原标识并中性呈现，确认状态只用 StatusTag，迁完删除 WarningBadge 及其 CSS。验证：`pnpm exec vitest run apps/web/test/design-system.test.tsx`；命令 B 核对真实等级与确认状态。
- [ ] 4.2 [IP-04] 在现有动态矩阵和 definitionOf 中传递原 ordinal，统一图例/格子映射并删除取模，不改变冻结版本、bandId、落点及请求范围。验证：命令 A 的 3×2/5×5、稀疏轴、未知级用例，以及命令 B 的历史两版本用例。
- [ ] 4.3 [IP-04] TrendLine/GraphView 使用统一的实际颜色主题并保留 ECharts 生命周期；对象类别不当作风险等级，既有正式预警边界不重算。验证：`pnpm build`；命令 B 查看原监测/关联图正式数据、状态与资源，无 CSS var 字面量参与 Canvas 颜色计算。

## 5. 删除已确认的死实现

- [ ] 5.1 [IP-05] 核对当前消费者后删除施工图列出的固定矩阵、未消费图表/图例及专属样式，移除仅服务它们的 Pie/Bar 注册；保留两种在用 AppShell 与动态矩阵。验证：`pnpm typecheck && pnpm deps:check`；命令 B 的正式页面不再依赖被删实现；出现基线外消费者则升级。

## 6. 行为取证与收尾

- [ ] 6.1 [IP-06] 建立一个最小 design-system 行为测试文件并扩展既有两份真实浏览器验收，覆盖施工图 §6 的全部场景，不新增演示路线/假后端/低价值文本断言。验证：命令 A；保留原七导航及权限、历史版本回归。
- [ ] 6.2 [IP-06] 在生产 dist 和原真实 HTTP/PostgreSQL 接缝执行命令 B；以实际浏览器核对计算颜色、正式数据、取消零提交、原请求身份、证据脱敏与资源请求，不把静态结果当作运行证明。验证：命令 B、C，记录真实构建分包与初始资源。
- [ ] 6.3 [IP-06] 真实 Chromium 完成三种窗口 × 100%/200% 六组合的键盘、局部滚动、遮挡与焦点恢复检查，并验证 reduced-motion；在冻结离线材料下完成生产运行。验证：实施计划命令 B、D 和 §6.2 的真实缩放操作记录；缺环境明确阻塞，不跳过。
- [ ] 6.4 [IP-06] Finalizer 逐条核对 DS-S01～DS-S14，以实际实现 HEAD、命令和证据创建 verification，质量材料保留合成/待甲方复核资格；按项目规则处理范围内缺陷与至多一次限定审计，不自动提交/归档。验证：`openspec validate establish-web-design-system --strict --no-interactive`，并确认全部实现与验收任务确有证据后才勾选。

命令 A～E 的完整内容及前置条件见 implementation-plan §6.1。任务中的命令是该切片最终验证，不要求边写边重复运行全套检查；按依赖顺序实施，完成相应行为与证据后才勾选。本轮只创建规划，以上任务均未执行。
