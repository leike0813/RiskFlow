# demo/v2 GAP 台账 54 条逐条重判

本表是「demo/v2 的 54 条 GAP 台账逐条重判」票（`.scratch/ui-redesign-spec/issues/03-gap-ledger-adjudication.md`）的产出资产，属 UI 重做规格的一部分。

## 台账的性质与核心发现

台账记录C32–C35开工前的设计差距，不能直接继承为当前backlog；`HANDOFF.md`明确其非规格事实源。下表区分已核、历史自报修正与待核，不以抽样推断54条整体解决率。

台账的单一维护点是 `demo/v2/src/review/gap-ledger.data.json`，`GAP-LEDGER.md` 与 `docs/gaps/` 由 `node tools/build-gap-docs.mjs` 生成，**禁止手工编辑**。本次重判不回填该文件（v2 是只读参考资产）。

## 核验口径

不提供「约30已解决/约12缺口」统计承诺。正文Schema与权限证据已经核对的条目列明证据；仅台账自报修正者只代表历史材料状态；未逐字段核对者保留待核，不能算已解决或已确认缺口。导航重组不自动消除契约、旧承载或历史深链。

## 逐条判定

### G1 外壳契约（4 条）→ 全部转入票 04

| ID | 缺口 | 判定 |
|---|---|---|
| GAP-001 | C10 五类骨架缺 15 处结构 slot | **仍成立**。v2 的 `DESIGN-SPEC.md` §3 已给出骨架扩展方案，转入票 04「布局骨架层」 |
| GAP-002 | 复合骨架 A+C / A+B 无法由单值枚举表达 | **方案已定，待实施**。票 04 采用区域块组合，不新增页面引擎 |
| GAP-003 | Agent 专用骨架无枚举值 | **仍成立**。P-AG-01/02 需要；票 04「布局骨架层」已含 Agent 停靠栏与全屏工作台 |
| GAP-004 | 主从复合页 / KPI 横条网格 / 图谱画布三种形态无骨架承载 | **仍成立**。P-OV-01（新仪表盘）、P-PJ-08、P-RI-07（图谱）、P-RA-06 都需要；**P-OV-01 是票 02 新定的多区块仪表盘，这一条直接决定其骨架** |

### G4 归属待定（3 条）→ 全部因票 02 的重组而失效

| ID | 缺口 | 判定 |
|---|---|---|
| GAP-005 | P-OV-01 归属 C34/C35 待定 | **作废**。P-OV-01 已是票 02 定的新一级导航「风险总览」，归属由新导航树决定，不再需要双写待裁决 |
| GAP-006 | P-RV-01/P-RV-02 复核归属待定 | **作废**。复核队列与详情已合并进停靠区待办（票 02 原则 4），归属确定 |
| GAP-007 | P-AU-01 报告导出归属 C34/C35 待定 | **作废**。已定归「治理 > 审计日志」下 |

### G5 依赖决策（3 条）→ 路线已定

| ID | 缺口 | 判定 |
|---|---|---|
| GAP-008 | 图表库选型属 C34 dependency checkpoint | **路线已定**。沿用生产 echarts 与 ChartSurface，原型纯 SVG 红线不作为生产约束，见票 04 |
| GAP-009 | 路由库是否需要 | **已被解决**。生产已用 `react-router-dom 6.30.6` |
| GAP-010 | Electron 路由模式预设 | **已被解决**。`apps/desktop` 薄壳已按 `desktop-client-architecture.md` 加载同一 HTTPS 页面，不自建路由 |

### G6 规格空白（17 条）→ 逐条判定

| ID | 缺口 | 判定 |
|---|---|---|
| GAP-011 | 可访问性无规格依据 | **已被解决**。已有 `openspec/specs/platform/web-shell-interaction-primitives/spec.md`、`openspec/specs/web/*` 及 `evaluation-and-browser-acceptance/spec.md:126`（要求验收键盘焦点行为）。**且 v2 自己已给出可验的 a11y 基线表**，见下节 |
| GAP-020 | 治理生命周期状态词汇无契约枚举 | **部分解决**。`vocabulary/index.ts:131,134` 已有 `pending-review`、`approved-for-draft`。转入票 04（治理区状态标签） |
| GAP-027 | 预警处置任务无记录 schema 与状态机枚举 | **仍成立**，转入票 06。**注意**：处置任务详情是票 02 定的新闭环枢纽页，其七类关系页签依赖此 schema |
| GAP-033 | 处置效果预测无记录 Schema | **旧判断不成立**：已有forecast-read正文与正式记录；B-4逐字段映射待核 |
| GAP-034 | 执行记录与反馈记录无契约记录 Schema | **旧判断不成立**：已有execution-read/feedback-read正文及正式记录；B-4只扩实际缺字段 |
| GAP-035 | 校准建议无记录 Schema | **旧判断不成立**：已有calibration-read正文及正式记录；人工整体三类决定，不支持部分接受 |
| GAP-038 | 批量确认无契约批量决定命令 | **本次不新增 bulk API**。保留原逐项独立授权、确认与回执，不因聚合待办要求新建批量命令 |
| GAP-042 | 数据源适配器与连接定义无契约记录与命令 | **仍成立**，转入票 06 |
| GAP-043 | 模型部署与提示模板版本登记无契约 schema | **仍成立**，转入票 06 |
| GAP-044 | 备份策略、恢复点与恢复操作无契约 schema 与命令 | **仍成立**，转入票 06 |
| GAP-045 | Agent 工具行动无记录 Schema | **既有 actions 安全读面可复用**；展示字段按实际响应核对，不将工具身份不足误说成整个读面缺失 |
| GAP-046 | Agent 增量校验无记录 Schema | **既有 validation 与候选引用可复用**；正文读取资格逐字段核对，不复制领域结果 |
| GAP-047 | Agent 用量与预算无契约字段 | **已有预算读视图**；按正式策略上限和用量渲染，不从 fixture 推导生产字段 |
| GAP-049 | 会话消息流无契约 Schema | **不创建第二套聊天事实**；本次复用任务／行动安全摘要，额外消息流能力未逐字段核对，不列为本次新增前提 |
| GAP-050 | risk-overview 投影内容形状未入契约 | **仍成立**，转入票 06。**这条优先级最高**——票 02 已定总览为多区块仪表盘（态势分布 + 变化时间线 + 待办摘要 + 投料入口），其投影形状必须先定 |
| GAP-051 | 总览趋势序列选取规则未规格化 | **仍成立**，转入票 06。与 GAP-050 同批 |
| GAP-054 | 报告「审计摘要」章节收录范围未规格化 | **仍成立**，转入票 08（演示叙事线需说明审计摘要范围） |

### G2 契约字段（25条）→ 区分已核与待核

已核证据与历史材料自报修正如下，后者不等同当前生产端到端验收：

| ID | 缺口 | 解决位置 |
|---|---|---|
| GAP-019 | 量化标准无 KnowledgeDefinitionType 枚举值 | **部分解决，见下节专述** |
| GAP-021 | 风险矩阵版本化定义无 Schema | `schema.ts:299-377`：`RiskMatrixBandV1Schema` / `RiskMatrixAxisV1Schema` / `RiskMatrixCellV1Schema` / `RiskMatrixContentV1Schema` 全在 |
| GAP-013 | 三个 `.read` 能力位无branch授予通路 | **v2断言不直接成立**，生产逐项核对，见下节 |
| GAP-025 | PAGE-GUIDE §3 把 triggerType 写成数组语义 | 台账自身标注「文档漂移，已修正」 |
| GAP-029 | 关系三元组字段命名不一致 | 台账自身标注「文档漂移，已修正」 |
| GAP-032 | 跨域 fixture 漂移 | 台账自身标注「已收敛」 |
| GAP-037 | 预警域与处置域 fixture 叙事漂移 | 台账自身标注「已收敛」 |
| GAP-048 | 校准建议 Agent 任务标识跨域漂移 | 台账自身标注「已收敛」 |

**其余G2条目**（GAP-012/014/015/016/017/018/022/023/024/026/028/030/031/036/039/040/041/052/053）尚未逐字段核对。保留为待核，不当作已解决或已确认缺口；实施前以既有契约和读面核对，缺字段才扩原Schema。页面重组不能代替字段语义及历史深链验收。

**页面重组后的待核项**：

| ID | 缺口 | 处置理由 |
|---|---|---|
| GAP-022 | 评估入口类别与kind语义冲突 | 入口改为上下文发起，但字段语义仍待核，不能因导航改组宣告作废 |
| GAP-040 | 跨类型运行列表投影载体 | 新承载/权限/历史深链验收通过后才能切换旧页；接口是否无人调用待核，不预先下线 |

## 三条需要单独强调的结论

### 1. GAP-019 部分解决，影响治理区信息架构

`ASSESSMENT_SCORING_CONFIGURATION_TYPES`（8 类）+ `measure-library`/`forecast-policy`/`deviation-policy` = 11 类枚举已定（`schema.ts:40-58`），与 `openspec/specs/knowledge/assessment-configuration-and-measure-governance/spec.md:9` 一致。

枚举没有独立 `quantization-standard` 治理类型，不代表量化标准没有精确版本引用。指标体系通过 `quantizationIntervalRef` 引用既有量化区间；展示与追溯必须保留该引用的entityId/versionId，不降为名称或当前版本。界面不新增独立发布流程，但不能删除精确版本读取/引用能力。

### 2. GAP-013：v2能力断言不能照搬生产

v2的denied与fixture能力注入是历史材料，不证明当前生产全部无branch授予。`core/access/policy.ts:22-44` 已给reviewer授予risk-assessment.read、warning-response.read及review-audit.read，且刻意不给Agent读权。B-6应核对导航→branch→capability→角色→会话传递，不重复添加已经存在的授予。

CH-2落实 `review-todo.read` 入口授权与公共接缝，不增本域读写；CH-9逐项沿来源原权限裁剪。既有四web与platform shell用delta，只新增design-system/dashboard/search-and-dock规格；九工作包不是九个新capability。业务CH完成新承载、权限、历史深链验收后原子切换，不提前撤旧承载。

### 3. v2 的 a11y 基线与图表规范可直接复用，不必重写

**a11y 基线**（`DESIGN-SPEC.md` §2，六项逐项带验证方式）：

| 项 | 实现 | 验证方式 |
|---|---|---|
| skip-link | `.skip-link` 跳到 `#main-content` | Tab 首焦点即跳转链接 |
| focusMainHeading | 路由或上下文 revision 变化后聚焦 `#main-heading`（`tabIndex=-1`） | 翻页后焦点落在主标题 |
| aria-busy | PageFrame 在 loading 态置 `aria-busy="true"` | 状态矩阵 loading 格 |
| aria-live | 页面状态与标题以 `role="status" aria-live="polite"` visually-hidden 播报 | 读屏走查 |
| prefers-reduced-motion | `global.css` 全局关闭动画与过渡 | 系统开启减弱动态效果后骨架屏静止 |
| 桌面适配 | 左导航152px/48px、右停靠区22rem，可手动收起，内容局部滚动 | 1280×720、1440×900、1920×1080；100%/200%缩放，正文折行且关键控件不裁切 |

前五项可复用；不继承v2按64rem自动切13rem导航/停靠区下沉的规则。

**图表规范**（`§4`）：五类图表（donut / hbars / trend / graph / matrix）统一走 `ChartSurface` 抽象接缝——输入数据形状 + 尺寸 + 主题令牌；主数据色一律工程蓝 `--blue`，风险四级色只允许表达等级/越限/预警；空态显示图表框 + 骨架 + 「暂无可显示内容」，无数据态不渲染图表框。

**实现路线已由票 04 闭合**：沿用生产 echarts 与 `ChartSurface`；不为满足只读原型的纯 SVG 红线重写图表。风险配色与数据维度按设计系统附件统一，图表库类型不替代可访问性验收。

## v2 原型资产的去留

**保留为只读参考，不提炼为回归夹具。** 理由：

1. `HANDOFF.md` 已声明「不进入生产迁移；生产可移植子集仅为 `src/` 的视觉与交互设计」；
2. 历史台账不能代替当前逐字段核对，继续维护为生产事实源会造成双写；
3. `demo/v2/tools/` 明确「永不迁移」；
4. 其 `dist/` 依赖 fixture 数据，而真实数据形态会随甲方配置变化。

**可取用的部分**：`DESIGN-SPEC.md` 的令牌体系与 a11y 基线（进票 04）、`GAP-LEDGER.md` 作为**历史记录**保留（说明 v2 设计意图与当时的差距判断），57 页页面清单作为票 02 的对照输入。

## 遗留风险

1. **GAP-050/051（risk-overview 投影形状与趋势序列规则）是票 06 的最高优先级**。票 02 已定总览为多区块仪表盘，投影形状未定则仪表盘无法施工。建议在票 06 中排第一。
2. **导航授权须按生产逐项核对**，不能继承v2全部denied；新增待办入口不授予域权限，Agent关联独立授权。
3. **G2未核字段仍待核**，不承诺已解决数量；GAP-033/034/035已确认有正文与正式记录（`ports/index.ts:5384-5471`、`core/response-lifecycle/schema.ts:223-273,299-329`），展示字段映射由B-4继续核对，禁止平行Schema。
4. **图表数据维度仍须实际验收**：路线已定为 echarts；CH-1／CH-6 用真实引用配置验证 3×2、5×5 等形态，不把原型可渲染当生产证据。
