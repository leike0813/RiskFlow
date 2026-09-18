# RiskFlow v2 原型 · M4 波次交接工件

> 状态：**M0–M5 全部完成，v2 终点达成**（57 页可点击原型 + 审阅 Harness + 54 条缺口台账 + 5 张汇报图 + 移交文档）。
> 指导性方案：`prototype-v2-guiding-plan.md`（同目录）。本文件是最终交接快照。
> 日期：2026-09-19（M5 收尾，全部里程碑闭合）。

---

## 1. 已批准的范围与决策

按指导性方案落地 `demo/v2/`：覆盖规格 57 页的可点击设计原型 + 审阅 Harness，终点 M5，不进入生产迁移。用户已确认四项：

- 授权 `demo/v2/` 独立 `npm install`：最小集（react 19.2.8 / react-dom / vite 6 / typescript / @vitejs/plugin-react）+ playwright 1.63
- 审阅 Harness 监听 `0.0.0.0:5320`（严格端口，占用即报错）
- 不交付 Dockerfile，只交付 `dist/` + `npm run review`
- 5 张汇报图 M5 统一产出（第 4、5 张走组合视图）

红线（全程有效，已做成 `npm run check` 硬校验）：只动 `demo/v2/**`；不建 OpenSpec change；`src/` 运行时依赖仅 react/react-dom；校验脚本 `*.check.mjs` 命名；页面文案禁实现名/TODO/Mock/占位；状态与角色注入只在框架层；风险矩阵数据驱动；system-administrator 空能力集。

## 2. 进度总览

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 底座与隔离 | 骨架、install、build/check/review、契约镜像、根门禁基线 | ✅ 完成（主代理） |
| M1 设计系统 | tokens 补全、暗色结构、a11y 基线、DESIGN-SPEC | ✅ 完成（子代理 agent-2） |
| M2 外壳与骨架 | AppShell/导航/RightDock/PageFrame 七态/骨架集/57 页脚手架注册/框架层注入 | ✅ 完成（同上） |
| M3 审阅控制台 | `#/__review` 四块 + 视口/安全区预设 + 缺口台账机制 | ✅ 完成（同上） |
| M4 页面铺量 | 57 页 × 11 域批次，AgentSwarm 并行 | ✅ 三波完成（29+23+5），57/57 全量核验通过 |
| M5 截图与移交 | capture.mjs、v1 对照、HANDOFF、终验 | ✅ 完成（2026-09-19，用户批准执行） |

### M5 结果（主代理）

- **组合视图对齐规格 §18**（修正项）：M3 搭的组合视图原先渲染 PageScaffold 脚手架，M5a 改为按 routeId 复用各域路由的真实页面渲染（路由参数由被组合页 samplePath 解出）；组合成员从指导性方案的暂定改为 §18 钦定：#/compose/assessment-warning = P-RA-05+P-RA-06+P-WR-01，#/compose/trace = P-RI-06+P-WR-04+P-RV-04
- **截图管线 `tools/capture.mjs`**：自带静态服务起停（可重复、无手工浏览器状态）；5 张 1920×1080 派生点对齐 §18；断言截取地址不含 `#/__review` 与 `gaps=on`、页面文本无 GAP- 覆盖层内容；截图前移除 a11y 程序化焦点环；浏览器 chromium-1223 缓存优先、回退系统 google-chrome；产物 `demo/v2/screenshots/01～05.png`，已目视检查
- **v1 对照深链** `docs/V1-COMPARISON.md`：v1（5319，BrowserRouter）↔ v2（5320，hash）25 条映射，4 处合并页标注拆分结果，v2 新增页单列
- **移交说明 `docs/HANDOFF.md`**：显式标注「阶段性设计原型、非规格事实源、未实现 C32–C35 任何能力」；含快速开始、审阅入口（含 GAP-013 提示）、目录导读、派生点表、典范追溯链、已知边界
- **终验**：`npm run build` ✅、`npm run check` 三项全绿 ✅、`npm run capture` 两次执行均产出 5 图 ✅、`npm run review` 起停 200→stopped ✅、无常驻进程与临时文件 ✅；根门禁 `pnpm lint` 0、`pnpm format:check` 0、`pnpm test` 与基线一致（`scripts/orchestration/control.test.mjs` 4 个预存失败，非本任务引入）✅；`git status` 仅 `demo/v2/` 与 `.scratch/` 两工件（未提交，Git 操作留待用户）✅

### M0 验证（主代理实测）

- `npm install` 71 包成功；`npm run build`（tsc + vite）通过；`npm run check` 全绿
- `tools/serve.mjs` 起服 → curl 200 → kill，无常驻进程
- 契约镜像校验：29 能力位 / 53 branch / I0–I9、A0–A9 / 五角色策略及并集推导语义，与 `packages/contracts`、`packages/core` 构建产物逐项一致
- 根门禁基线：lint 0、format:check 0、test 1（**基线即失败**：`scripts/orchestration/control.test.mjs` 4 个预存失败，与本任务无关，M5 终验以此基线对比）
- `git status` 仅 `?? demo/v2/` 与指导性方案文件本身（会话前已存在）

### M1–M3 验证（子代理报告，主代理已抽查关键产物）

- build / check（契约镜像 + 红线含 57 页覆盖 + 缺口台账同步三项）全绿
- serve 起→200→停；Playwright 临时脚本 30 项断言全过（控制台渲染、57 卡片、57×7 状态矩阵、error 安全字段、system-administrator 全 denied、角色并集、gaps 覆盖层默认关闭、组合视图并置、64rem 塌列、角色切换写回 URL），脚本已删

### 关键产物（审阅入口）

- 启动审阅：`cd demo/v2 && npm run review` → 浏览器开 `http://<本机IP>:5320/#/__review`
- `docs/page-manifest.json` —— 57 页单一事实源（pageId/routeId/path/title/domain/skeleton/change/branch/capability）
- `docs/PAGE-GUIDE.md` —— M4 批次页面实现约定（骨架选用、fixture 规则、能力门控、版本引用、七态、文案红线）
- `docs/GAP-LEDGER.md` + `docs/gaps/` —— 缺口台账 54 条（单一维护点 `src/review/gap-ledger.data.json`，文档为生成产物）
- `docs/DESIGN-SPEC.md` —— 令牌冻结清单、a11y 基线、Electron 九条约束、五类图表视觉规范、骨架扩展方案
- `src/app/contract-mirror.ts` + `.data.json` —— 冻结契约/角色策略镜像（check 脚本与 packages 事实源比对）
- `src/shell/`、`src/shared/PageFrame.tsx`、`src/shell/skeletons/` —— 外壳、七态、A/B/C/D/E/AG+复合骨架
- `src/app/review-params.ts` —— `?state=` / `?roles=` / `?gaps=on` 框架层注入唯一入口

## 3. M4 执行计划（第一波已完成，第二、三波待审批）

### 第一波结果（P-PJ 10 + P-KM 8 + P-RA 7 + P-WR 4 = 29 页，已验证）

启动前先做共享图表库（agent-2 续）：`src/charts/` 纯 SVG 五类（ChartSurface 接缝 + Donut/HBars/Trend/Graph/RiskMatrix），RiskMatrix 完全数据驱动（行列刻度/等级文案/cellLevels/acceptable 掩码/thresholdVersion 全在 fixture），PAGE-GUIDE §10 补图表使用约定。

四个批次并行交付要点：

- **P-PJ**（`src/pages/project/` + `src/content/project.ts`）：上下文修订（revision 单调递增、三级依赖链）、P-PJ-08 A+C 复合骨架、监测 TrendChart（阈值线/越限段）、资料段标识与脱敏 full|redacted 两态、双时间呈现
- **P-KM**（`src/pages/knowledge/` + `src/content/knowledge.ts`）：八页统一 D 治理骨架（五态生命周期 + 版本 diff 入口 + 五个治理动作三态门控）、P-KM-07 RiskMatrixVersionChart 数据驱动（含回滚演示版本链）、工序节点「必含 5 项」与适用性「必含 3 维」覆盖清单
- **P-RA**（`src/pages/assessment/` + `src/content/assessment.ts`）：G2 校正落实（weightVersion/indicatorResults/判别联合 kind/三类版本引用可重放）、P-RA-03 C 骨架 A0–A9 阶段条 + 运行头部七字段 + 适用性筛除原因表、P-RA-06 矩阵落点来自评估记录
- **P-WR**（`src/pages/warning/` + `src/content/warning.ts`）：triggerType 单值校正（v1 数组语义废弃，改 triggerIndicators 逐项表达）、预警中心 Donut/HBars、任务六态状态机、确认人审计

第一波收尾（主代理）：

- **段标识迁移（GAP-PJ-01 落实）**：典范链段标识 `DOC-2026-001-S3.2-SEG-007` 违反 `packages/core/src/engineering-data/context-source/schema.ts:334` 三段式正则（sourceId/chapterId/segmentId 组件均限 `[A-Za-z0-9_]`）。已全量迁移为契约合法形态（`DOC2026001-S32-SEG007`；`DOC-2026-001`→`DOC2026001`、`S3.2`→`S32`、`SEG-007`→`SEG007`，18 个段标识 + 5 个资料 ID 及散字段共 90+ 处）。**第二、三波批次的典范链统一用新标识**（见下）
- **缺口合并**：4 批收件箱 15 条全部编号合并进台账（GAP-014～028，单一维护点 `src/review/gap-ledger.data.json`，文档已重新生成）；另修正 PAGE-GUIDE §3 triggerType 文档漂移（GAP-025 记录）
- **验证**：`npx tsc --noEmit` 零错误；`npm run check` 三项全绿（台账 28 条同步）；`npm run build` 通过；Playwright 冒烟 8 页（含强制 ready/empty、system-administrator 空能力集）渲染正常、零 JS 错误；服务起停正常

### 第二波结果（P-RI 7 + P-RS 5 + P-RV 6 + P-OP 5 = 23 页，已验证）

四个批次并行交付要点：

- **P-RI**（`src/pages/identification/` + `src/content/identification.ts`）：识别运行详情（I0–I9 阶段条、运行头部）、标准化风险记录详情（evidenceReferences 投影，GAP-030）、关系三元组按契约字段名 sourceElement/relation/targetElement、知识图谱页（graph-canvas 形态）
- **P-RS**（`src/pages/response/` + `src/content/response.ts`）：处置建议详情（implementationOrder + 展示用 orderingBasis，GAP-036）、执行/反馈登记（ActionSource 判别联合）、效果预测视图、校准建议（含 Agent 任务来源与预算策略版本）；GAP-033/034/035 三处无记录 Schema 的 fixture 视图类型
- **P-RV**（`src/pages/review/` + `src/content/review.ts`）：待复核队列（批量确认=逐项提交语义，GAP-038）、复核详情、证据追溯页（典范链全链呈现）、跨类型运行台账（聚合 fixture，GAP-040）、业务审计条目（活动码字符串待枚举，GAP-039）
- **P-OP**（`src/pages/ops/` + `src/content/ops.ts`）：系统管理六动作三态门控（空能力集代理系统管理员身份，GAP-041）、数据源适配器视图、模型部署/提示模板版本登记、备份恢复（两步确认危险交互）

第二波收尾（主代理）：

- **fixture 漂移收敛**（GAP-032/037 落实）：`content/warning.ts` 的 WARN-2026-002/003/004 改挂 RISK-2026-002/001/003 及对应评估记录（消除与 assessment.ts PENDING_RISKS 的文本冲突）；WRT-2026-001 状态补登采纳后时间线（采纳 RD-2026-001 → 执行 EXE-2026-001 → 反馈 FBK-2026-001）；DOC2026001 版本三处统一为 `v2026.06`（以 project.ts 资料登记为准）；PAGE-GUIDE §3 三元组改契约字段名（GAP-029 落实）
- **manifest 对齐**：`docs/page-manifest.json` 的 samplePath 全部对齐典范链与收敛后 fixture ID（P-RI-03/06、P-RA-03/05、P-WR-02/04、P-RS-01/03/04/05 等 10 处）
- **缺口合并**：4 批收件箱 16 条编号合并进台账（GAP-029～044，台账共 **44 条**，文档已重新生成）；其中 GAP-029/032/037 三条由本次收尾直接解决，GAP-031（RISK-2026-003/004 机理归属 MEC-VDS-017 语义不匹配）保留待裁决
- **验证**：`npx tsc --noEmit` 零错误；`npm run check` 三项全绿（台账 44 条同步）；`npm run build` 通过；Playwright 冒烟 13 项断言全过（P-RV-04 证据追溯全链含新段标识、P-RS-01、P-RI-03、P-OP-01 ready 态 + 状态矩阵 9 个第二波页面落位）；服务起停正常、临时脚本已删

### 第三波结果（P-AG 3 + P-OV 1 + P-AU 1 = 5 页，已验证）

两个批次并行交付要点：

- **P-AG**（`src/pages/agent/` + `src/content/agent.ts`）：P-AG-01/02 用 AG 骨架（消息流三层样式 + 输入区 + 任务摘要 + 待确认命令卡，写命令提交前必须用户确认）；P-AG-02 会话任务表覆盖五类必经内嵌任务类型；P-AG-03 用 C 骨架呈现任务信封全貌（发起者/工程/输入版本/六项版本引用）、工具行动表（含白名单外拦截记录）、增量逐项校验（接受/拒绝及原因）、资源消耗 vs 硬预算、失败与结果引用；明示不保存不展示思维链。另核实：agent-task.read 经 `read-failure-evidence` branch 对 project-risk-manager 有授予通路，不适用 GAP-013
- **P-OV**（`src/pages/overview/` + `src/content/overview.ts`）：KPI 横条全部从既有域 fixture 派生（禁止复制漂移），矩阵落点按「各风险记录最新评估」口径（重评估覆盖首次），趋势取 MON-001（对齐 I 级预警触发指标）
- **P-AU**（`src/pages/report/` + `src/content/report.ts`）：报告导出独立界面（无 window.print、无浏览器打印文案）；报告范围（时间窗 + 四章节）挂导出策略版本 EXP-POLICY-001 · v2026.08；版本引用清单 9 项全部 import 自既有事实源；导出历史含失败可重试条目

第三波收尾（主代理）：

- **标识漂移收敛**（GAP-048 落实）：处置域 `content/response.ts` 两处 AGT-CAL-2026-001 改为 AGT-001，与 agent 域及 manifest samplePath 统一
- **缺口合并**：3 批收件箱 10 条编号合并（GAP-045～054，台账共 **54 条**，文档已重新生成）
- **验证**：`npx tsc --noEmit` 零错误；`npm run check` 三项全绿；`npm run build` 通过；Playwright 冒烟 11 项断言全过（含 CAL-2026-001 → AGT-001 深链命中）

### M4 收尾（主代理，已闭合）

- **57 页全量核验**：全部 samplePath × 强制 ready × 五角色并集注入，57/57 渲染通过、零 JS 错误；服务起停正常、临时脚本已删
- **缺口台账闭合**：54 条全部编号合并，文档同步校验通过
- 剩余待裁决项全部记录在台账，供 C32–C35 design 阶段处理

### 后续波次安排

AgentSwarm 分批（每批一个 coder 子代理，3–4 个并行一波），批次即域：

| 波次 | 批次（页数） | 优先级依据 |
|---|---|---|
| 一 ✅ | P-PJ(10)、P-KM(8)、P-RA(7)、P-WR(4) | C32/C34 契约依据最实，优先保 |
| 二 ✅ | P-RI(7)、P-RS(5)、P-RV(6)、P-OP(5) | C33/C35 |
| 三 ✅ | P-AG(3)、P-OV(1)、P-AU(1) | 小批次收尾（用户 2026-09-19 批准连续推进） |

**典范追溯链（段标识迁移后版本，第二、三波统一使用）**：资料 `DOC2026001` → 资料段 `DOC2026001-S32-SEG007` → 工序节点 `PN-VDS-04`（变径空间扩挖）→ 机理条目 `MEC-VDS-017` → 标准化风险记录 `RISK-2026-001` → 评估运行 `RUN-A-2026-001` / 评估记录 `ASSESS-2026-001` → 预警 `WARN-2026-001` → 处置建议 `RESP-2026-001` → 偏差 `DEV-2026-001` / 校准建议 `CAL-2026-001`。识别运行 `RUN-20260827-001`。

每批交付：该域页面真实内容（替换 PageScaffold 接线，路由注册/manifest 不动）+ 该域 fixtures（字段形状以 `packages/contracts` 为准）+ `docs/gap-inbox/<域>.md` 缺口分片（临时 ID `GAP-<域缩写>-NN`，主代理统一编号合并）。批次文件所有权隔离；每批自验 `npx tsc --noEmit && npm run check`（不做全量 build，避免并行争用）。拆页规则照指导性方案 §8.2。

M4 收尾（主代理）：57 页全量核验、缺口台账合并闭合。

## 4. M5 执行计划（M4 完成后）

1. `tools/capture.mjs`：Playwright 截 5 张汇报图（1920×1080），断言产物不含 `#/__review` 与 `gaps=on`；产物 `demo/v2/screenshots/`。注意：playwright 1.63 期望的浏览器版本与本机缓存不符，需用 `executablePath` 显式指向 `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`（第一波冒烟已验证可行）
2. v1 对照深链清单（v1 5319 / v2 5320，22 个重叠页）
3. `docs/HANDOFF.md` + DESIGN-SPEC 收尾：显式标注「阶段性设计原型、设计输入非规格、未实现 C32–C35 任何能力」
4. 终验：build/check/截图可重复/review 起停；根门禁与基线一致；`git status` 仅 `demo/v2/**`

## 5. 审批记录与待裁决事项

1. **GAP-013（契约张力）**：三个 `.read` 能力位无 branch 授予通路 → 三项导航全角色 denied、页面默认 forbidden，审阅走 `?state=ready` 强制注入。✅ 用户已确认接受（2026-09-18）；契约层裁决留给将来 change。
2. **GAP-005/006/007**：四页归属双写维持不裁决、页面照做。✅ 用户已确认维持（2026-09-18）。
3. **波次推进**：M4 三波与 M5 全部完成（M5 由用户 2026-09-19「执行剩余任务」批准）。**项目到达指导性方案终点，停手，不进入生产迁移。**
4. 新增待裁决（不阻塞 M5）：GAP-014（段标识正则）、GAP-015（PM 四动作能力位）、GAP-017/018（branch 标注，与 GAP-012 合并裁决）、GAP-020（治理生命周期枚举）、GAP-021（矩阵定义 Schema）、GAP-022（entryMode 投影）、GAP-024（分带规则入矩阵版本）、GAP-031（RISK-2026-003/004 机理归属）、GAP-030/033/034/035/038/040（记录 Schema 补位）、GAP-041（系统管理身份信号）、GAP-042/043/044（设施域记录契约）、GAP-045/046/047/049（Agent 任务记录契约）、GAP-050/051（总览投影口径）、GAP-052/053/054（报告导出契约与章节口径）。均在台账（54 条），供 C32–C35 design 阶段裁决。

## 6. 风险登记（沿指导性方案 §12，当前评估）

- 范围风险：57 页工作量大 → 三波次 + 优先保 C32/C34 域；中途收缩先砍 P-AG/P-OP
- Harness 膨胀 → 框架层注入约束 + check 硬校验已就位，M4 批次 Prompt 会重申
- 预设被推翻（G1/G3） → 预设集中在骨架与状态层；缺口台账逐条记录预设与推翻影响面
- 权威性漂移 → M5 HANDOFF 显式标注非规格事实源
- 依赖回潮 → check-redlines 依赖白名单硬校验已就位
