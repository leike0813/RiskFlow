# RiskFlow v2 设计原型 · 移交说明

> **性质声明**：本目录是**阶段性设计原型**，用于 C32–C35 开工前的设计评审与汇报。
> 全部数据为 fixture 演示数据；本文档与 `demo/v2/**` 均**不是规格事实源**，
> 规格事实源以 `openspec/` 与 `packages/contracts` 为准。本原型**未实现 C32–C35 的任何真实能力**，
> 不进入生产迁移；生产可移植子集仅为 `src/` 的视觉与交互设计（零第三方运行时依赖）。

## 快速开始

```bash
cd demo/v2
npm install        # 首次
npm run review     # 构建并启动审阅 Harness → http://<本机IP>:5320/#/__review
npm run capture    # 产出 5 张 1920×1080 汇报图到 screenshots/
npm run check      # 契约镜像 + 红线 + 缺口台账三项硬校验
```

浏览器要求：Playwright 缓存的 chromium 或系统 google-chrome（仅 `capture` 需要）。

## 审阅入口

- `#/__review` 审阅控制台：57 页索引、七态 × 五角色状态矩阵、缺口台账面板
- 任意页面可叠加审阅参数：`?state=idle|loading|ready|empty|error|forbidden|unavailable`、`?roles=<角色并集>`、`?gaps=on`（缺口覆盖层，默认关闭）、`?vp=`、`?safearea=on`
- GAP-013 提示：风险识别/风险评估/预警处置三项导航对全部预设角色呈现 denied（三个 `.read` 能力位无 branch 授予通路），审阅对应页面请用 `?state=ready` 强制注入

## 目录导读

| 路径 | 内容 |
|---|---|
| `docs/page-manifest.json` | 57 页单一事实源（pageId/routeId/path/skeleton/change/branch/capability） |
| `docs/DESIGN-SPEC.md` | 设计令牌、a11y 基线、Electron 约束、图表规范、骨架扩展方案 |
| `docs/PAGE-GUIDE.md` | 页面实现约定（骨架、fixture、门控、七态、文案红线） |
| `docs/GAP-LEDGER.md` + `docs/gaps/` | 缺口台账 54 条（生成产物；维护点是 `src/review/gap-ledger.data.json`） |
| `docs/V1-COMPARISON.md` | v1 ↔ v2 页面对照深链 |
| `src/app/contract-mirror.ts` | 契约/角色策略冻结镜像（check 与 packages 事实源逐项比对） |
| `src/pages/<域>/` + `src/content/<域>.ts` | 11 域页面与 fixture |
| `tools/` | 审阅设施（serve/capture/校验脚本），永不迁移 |
| `screenshots/` | 5 张汇报图（派生点见下） |

## 汇报图派生点（产品规格 §18）

1. `01-risk-overview.png` ← P-OV-01 风险态势总览
2. `02-agent-workbench.png` ← P-AG-02 Agent 全屏工作台
3. `03-identification-run.png` ← P-RI-03 识别运行详情（RUN-20260827-001）
4. `04-assessment-warning.png` ← 组合视图：P-RA-05 + P-RA-06 + P-WR-01（`#/compose/assessment-warning`）
5. `05-risk-response-trace.png` ← 组合视图：P-RI-06 + P-WR-04 + P-RV-04（`#/compose/trace`）

截图管线自带静态服务起停，可重复执行；产物不含审阅控制台与缺口覆盖层（脚本内有断言）。

## 演示数据主线（典范追溯链）

`DOC2026001` → 资料段 `DOC2026001-S32-SEG007` → 工序节点 `PN-VDS-04` → 机理条目 `MEC-VDS-017`
→ 风险记录 `RISK-2026-001` → 评估运行 `RUN-A-2026-001` / 评估记录 `ASSESS-2026-001`
→ 预警 `WARN-2026-001` → 处置任务 `WRT-2026-001` → 处置建议 `RESP-2026-001`
→ 采纳 `RD-2026-001` → 执行 `EXE-2026-001` → 反馈 `FBK-2026-001`
→ 偏差 `DEV-2026-001` → 校准建议 `CAL-2026-001`（Agent 任务 `AGT-001`）

识别运行 `RUN-20260827-001`；复核任务 `RVW-001`～`RVW-004`、`RVT-2026-001`。

## 已知边界

- 57 页中 4 页归属双写待裁决（GAP-005/006/007）；段标识正则、能力位补位等 54 条缺口全部记录在台账，供 C32–C35 design 阶段裁决
- `dist/` 为相对路径构建，可用任意静态服务托管；不交付 Dockerfile
- 组合视图路由（`/compose/*`）不属于 57 页清单，仅为汇报图服务
