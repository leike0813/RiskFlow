# demo/v2 的 54 条 GAP 台账逐条重判

Type: task
Status: resolved

## Question

`demo/v2` 自带一份 54 条 GAP 台账，分六类：G1 外壳契约 / G2 契约字段 / G3 未建能力 / G4 归属待定 / G5 依赖决策 / G6 规格空白。它是 v2 设计意图与生产实体之间的差距记录，记录于 C32–C35 落地之前。

现在基线定为「以 demo/v2 设计系统为基线向生产收拢」，这份台账就需要逐条重判，而不是默默继承或默默丢弃。

具体要回答：

1. 54 条中每一条的处置结论：仍然成立 → 写进新规格哪一节；已被后续 change 解决 → 标记并给出证据位置；因本次重组而作废 → 说明作废理由；需要甲方决定 → 归入待确认清单。
2. G4「归属待定」和 G5「依赖决策」这两类是否仍有未决项？若有，它们是否应该升级成地图上的独立决策票？
3. G3「未建能力」中，有哪些是本次 UI 重做**必须先具备**的后端能力？这直接喂给后端变更清单那票。
4. `demo/v2` 这份原型资产在新规格定稿后的去留：留作文档参考、就地废弃、还是提炼为可运行的设计系统回归夹具？

这一票是**整理既有材料**，不需要新的设计判断。产出是逐条结论表 + 待确认清单。

## Answer

产出资产：[demo/v2 GAP 台账重判](../../riskflow-master-plan/prototypes/gap-ledger-adjudication.md)。

**核验口径**：历史台账不是生产backlog；不回填只读v2生成资产。撤销「约30已解决/约12缺口」分布承诺，区分已核事实、台账自报修正与待核字段，不把抽样推及54条。

**已核证据**：

- GAP-021（矩阵版本化定义无 Schema）→ `packages/core/src/assessment-config/schema.ts:299-377` 已有 `RiskMatrixBandV1Schema` / `RiskMatrixAxisV1Schema` / `RiskMatrixCellV1Schema` / `RiskMatrixContentV1Schema`。
- GAP-019（量化标准无枚举值）→ `ASSESSMENT_SCORING_CONFIGURATION_TYPES` 8 类 + 3 类 = 11 类枚举已定（`schema.ts:40-58`），与 `openspec/specs/knowledge/assessment-configuration-and-measure-governance/spec.md:9` 一致。
- GAP-008（图表库选型）/ GAP-009（路由库）→ 生产已用 `echarts 5.6.0`、`react-router-dom 6.30.6`（`apps/web/package.json:8,12`）。GAP-010（Electron 路由模式）已按 `desktop-client-architecture.md` 定案。
- GAP-011（可访问性无规格依据）→ 已有 `openspec/specs/platform/web-shell-interaction-primitives/spec.md`、`openspec/specs/web/*` 及 `evaluation-and-browser-acceptance/spec.md:126`（要求验收键盘焦点行为）。
- GAP-025/029/032/037/048 → 台账自身已标注「已修正/已收敛」。

**归属与契约分开**：GAP-005/006/007的导航归属已有决定，但旧承载须待业务CH新承载、权限与历史深链验收后原子切换；GAP-022字段语义与GAP-040投影调用仍待核，不因导航重组自动作废或下线。

**三条需单独强调的结论**：

1. **GAP-019部分解决**：没有独立 `quantization-standard` 治理类型，不等于没有精确版本引用。指标体系的 `quantizationIntervalRef` 保留entityId/versionId，界面支持准确展示/追溯，但不凭空新增独立发布流程。
2. **GAP-013须按生产核对**：v2全部denied不能照搬；`core/access/policy.ts:22-44` reviewer已有risk-assessment.read、warning-response.read及review-audit.read，刻意无Agent权。B-6核对导航→branch→capability→角色→会话链路；CH-2交公共接缝与入口授权，`review-todo.read`不授域读写。
3. **a11y与图表规则复用**：保留skip-link、标题焦点、aria-busy、aria-live、减弱动态效果；桌面左导航152px/48px、右停靠区22rem，可手动收起与局部滚动，不继承64rem自动改13rem导航/右栏下沉。验收1280×720、1440×900、1920×1080及100%/200%缩放。图表视觉语义规则转票04。

**图表路线已由票 04 决定**：统一沿用生产 echarts 与 ChartSurface，原型纯 SVG 红线不再约束生产。仍需在 CH-1／CH-6 验证矩阵维度、落点和等级配色由精确引用配置驱动。

**v2 原型资产去留**：**保留为只读参考，不提炼为回归夹具**。理由：`HANDOFF.md` 声明不进入生产迁移、台账已过时会产生第二套事实源、`tools/` 明确「永不迁移」、`dist/` 依赖会随甲方配置变化的 fixture。可取用部分已全部转入票 04 与票 02。

**G2 未核项**保留逐字段核对资格，不视为已解决或已确认缺口。GAP-033/034/035 已有四读正文与正式生命周期记录；B-4 只扩实际缺字段，并保全子记录到预警处置任务的精确关联，不是到 Agent 的反查。Agent 可选关联属 B-2／CH-9，返回前独立授权。

**遗留风险**：

1. GAP-050/051（risk-overview 投影形状与趋势序列规则）是票 06 的最高优先级——票 02 已定总览为多区块仪表盘，投影形状未定则无法施工。
2. 导航授予链须按当前生产逐项核对，新增待办入口不增域读写；reviewer无Agent权仍能复核，Agent关联无权不得披露存在性。
3. G2未核字段移交逐字段核对，不提供缺口/已解决数量承诺；量化标准精确版本引用不可丢失。
4. 图表路线已定，真实配置维度与落点仍须在 CH-1／CH-6 以生产读面验收，不由原型截图证明。
