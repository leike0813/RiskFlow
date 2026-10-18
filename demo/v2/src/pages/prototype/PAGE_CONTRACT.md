# 页面契约 — UI 重做票 05（铺 24 页）

所有页面组件必须遵守本文件。违反即返工。

## 已定的方向（用户 2026-10-18 拍板，不可再讨论）

1. **紧凑高密度** — 行高 28px 级，一屏装得下东西。替代 v2 的大卡片、松行高。
2. **弱化卡片** — 靠对齐、分隔线、字号层级组织，不用卡片网格堆砌。
3. **克制中性色** — 浅灰底 + 白面。工程蓝只用于交互与强调，**风险四级色只表达等级/越限/预警**。
4. **宽屏不塌陷** — 这是 Electron 桌面端，不为窄屏做响应式折叠。保底可读宽度即可。
5. **⌘K 是一级入口** — 搜索 / 命令 / Agent 三合一。
6. **全键盘可达** — 所有交互有快捷键，`:focus-visible` 必须可见。
7. **Agent 主动在场** — Agent 不是右侧聊天框，是按上下文主动把「我看到什么、要你决定什么」摆到页面上。
8. **页面方向：B 纵向叙事** — 以时间轴/纵向序列为主结构，不是一堆并排卡片。

## 用词规则（票 01，不可违反）

- 业务名称为主，**技术 ID 降到页面底部或详情角落**，等宽小字，不进标题、不进列表首列。
- 界面词只用 `ui-vocabulary-mapping.md` 的三层分工：业务对象层用 CONTEXT.md 术语、操作层用动词、证据层用甲方原词。
- **禁止出现**：JSON、Schema、Token、游标、投影、幂等、runId、快照 ID、发布集合、修订、章节、I0–I9。
- 风险四级色**只允许**通过 `RiskBadge`（下方已给）渲染，**必带文字标签**。
- 空状态说业务语言：「本工程尚无可用于评估的数据」，不说「暂无运行投影」。

## 必须复用的零件（已建好，不要重写）

从 `./parts` 导入：

- `RiskBadge({ levelId, label })` — 风险四级色唯一出口
- `StateTag({ state, children })` — done / current / pending
- `Tag({ children, accent? })` — 中性标签
- `KeyValue({ items })` — 键值列表，替代字段堆
- `Stats({ items })` — 横向统计条
- `AgentNote({ why, children, actions })` — **Agent 主动在场提示条**
- `AgentDelta({ rows })` — Agent 增量，逐项可接受/拒绝
- `Ids({ pairs })` — 技术 ID 辅助区，等宽小字沉底
- `Shortcuts({ groups })` — 快捷键帮助面板

## 页面骨架约定

```tsx
export function XxxPage() {
  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">识别 / 风险记录</div>
          <h1 className="dl-h1">…</h1>
          <div className="dl-head-meta">…</div>
        </div>
        <div className="dl-head-actions">…</div>
      </header>
      <AgentNote … />        {/* 有 Agent 上下文时才出现 */}
      <section className="dl-section">…</section>
    </div>
  );
}
```

## 数据

**一律用 `src/content/<域>.ts` 的真 fixture**，不要造假数据。这些 fixture 已对齐 `packages/contracts`，字段名可信。跨域标识走典范追溯链：
`DOC2026001-S32-SEG007 → PN-VDS-04 → MEC-VDS-017 → RISK-2026-001 → ASSESS-2026-001 → WARN-2026-001 → WRT-2026-001 → RESP-2026-001 → EXE-2026-001 → FBK-2026-001 → DEV-2026-001 → CAL-2026-001`

矩阵维度必须从 fixture 的 `RISK_MATRIX_CONFIG` 派生，**不得硬编码 5×5**（当前配置是 3 可能性档 × 2 后果档 × 4 级）。

## 硬边界（AGENTS.md §2.1）

- Agent **不能代替人做正式决定**。复核、发布、采纳、校准生效都是人的决定。
- Agent 增量只能是**任务类型化的领域操作**，逐项可接受/拒绝，不写长文。
- 页面上不得出现 Agent 内部思维链。
- 不得出现「甲方已确认」这类未发生的声称。

## 文件与注册

- 每页一个文件，放 `src/pages/prototype/pages/<Name>.tsx`
- 在 `src/pages/prototype/pages/index.ts` 导出 `PROTOTYPE_PAGES` 路由数组，形状照抄 `routes.ts`
- 不要改 `src/pages/routes.tsx`（注册由集成者统一做）
- 类名只用 `dl-` 前缀；**不得**引入新的 CSS 文件（视觉语言已在 `dl.css`）
- 每个页面组件必须 `export function`，并在顶部注释里写一行 `// PROTOTYPE · THROWAWAY — 票 05 第 N 页：<页面名>`

## 自检

交付前跑 `cd demo/v2 && npm run build`。**tsc 必须零错误**。不接受 `any`，不接受未使用的导入（`noUnusedLocals` 是开的）。
