# RiskFlow MVP OpenSpec 实现路线——确认记录

> 状态：本工件记录前沿票《确定覆盖 MVP 的 OpenSpec 实现路线》的决策过程与已确认执行方案。C00～C38 共 39 个 changes 按 G0～G5 阶段门实施。

## 1. 路线目标与事实基线

本路线把已确认的完整产品规划切成一组覆盖 MVP 的 OpenSpec changes。路线终点是：实现、验证并交付一个可在甲方内网私有部署、可由业务人员通过界面真实操作、完整覆盖 RI-S1～RI-S6 与 RA-S1～RA-S7 的 RiskFlow MVP。

事实基线如下：

- 当前 OpenSpec CLI 为 `1.11.0`，使用 `spec-driven` schema，工件顺序为 `proposal → specs → design → tasks`。
- `openspec/specs/`、活动 changes 和归档 changes 均为空；`openspec/config.yaml` 仍是模板，尚未写入项目上下文和工件规则。
- 生产代码是 greenfield。现有 `demo/` 是 React 18 + npm 的汇报原型，不是生产模块；正式基线已经确定为 React 19 + pnpm workspace。
- 正式目录采用三个应用 `apps/web`、`apps/api`、`apps/worker`，以及三个深层共享包 `packages/contracts`、`packages/core`、`packages/adapters`。早期宏观架构原型中更细的多包示意已被后续工具链决策修订。
- PostgreSQL 是业务事实源，Qdrant 是可重建的双索引投影，本地内容寻址目录保存不可变工件；LangGraph checkpointer 与业务事实分离。
- 模型统一经 `llama.cpp` 网关调用；MVP 硬件候选为 Qwen3.8-27B `Q4_K_M`、单槽、32K、F16 KV、关闭 MTP。
- MVP 不包含 CAD 深度解析、实时 MCP、甲方外部系统联调、多渠道通知、LoRA、高可用、多项目规模化或生产级灾备。
- 甲方正式输入未到位时，只能形成“技术就绪”结论；甲方认可验收包到位并现场重跑后，才能形成“MVP 验收通过”结论。

本路线采用以下事实源：

- [项目 Agent 规则](../../../AGENTS.md)
- [统一领域语境](../../../CONTEXT.md)
- [风险识别专利转写](../../../references/发明拟定稿0518-站隧一体化施工风险机理驱动智能识别方法及系统-修回_20260518.md)
- [风险评估与预警专利转写](../../../references/一种地下工程施工的风险智能评估与预警方法及系统_雷可批注_20260417.md)
- [技术研究方案](../../../references/站隧一体化施工风险智能识别与评估技术研究方案_详细版.md)
- [Wayfinder 地图](../map.md)及其全部已解决决策票和规划工件

## 2. 全部待决问题、选项与推荐

### 问题 1：本票应直接创建全部 OpenSpec changes 吗？

可选方向：

- 立即 scaffold 全部 changes；
- 只产出路线，确认后按依赖波次创建；
- 只创建第一个 change，其余不规划。

**推荐：只产出完整路线，确认后按波次创建。**

条件结论：Wayfinder 负责找清路线，不提前交付路线终点。一次性创建大量尚未解锁的 delta specs 会放大上游契约变更造成的漂移；本票确认后先创建 C00，G0 契约闸门归档后再批量规划已解锁 changes。

### 问题 2：OpenSpec change 应拆到多细？

可选方向：

- 约 20 个大 change，以完整纵向旅程为主；
- 约 39 个能力级 change，以深层模块或可独立验收能力为单位；
- 50 个以上，把数据库、路由、页面、测试等编码步骤分别建 change。

**推荐：39 个能力级 change。**

条件结论：39 个 change 足以让工程数据、知识、识别、评估处置、界面、质量和部署多路并行，又不会产生“只建表”“只写类型”“一页一个 change”等浅工件。编码步骤继续拆在各 change 的 `tasks.md` 中。

### 问题 3：以什么轴切分 change？

可选方向：

- 按数据、后端、前端、测试等技术层横切；
- 按 RI/RA 专利子步骤逐项切；
- 按事实所有权和深层模块切，专利步骤作为追踪维度；
- 按少量用户旅程做巨型纵切。

**推荐：按事实所有权和深层模块切，使用少量纵向集成闸门。**

条件结论：技术层横切会把真实集成推迟到最后；专利步骤逐项切会把同一事实生命周期拆散。模块 change 拥有事实、接口和验证出口，RI/RA 标识贯穿其 specs、design、tasks 和证据。

### 问题 4：先完成所有横向基础设施，还是先跑 walking skeleton？

可选方向：

- 基础设施和全部模块完成后首次集成；
- 从资料接入开始一路向右；
- 先冻结契约与最小运行内核，再从“标准化风险记录 → P/C → 矩阵 → 预警”建立早期纵向闸门。

**推荐：契约先行，并尽早跑确定性评估与预警 walking skeleton。**

条件结论：标准化风险记录是识别与评估之间最稳定的专利接缝。C25/C26 可使用正式共享 Schema 和验收夹具，在完整识别完成前验证版本、事务、P/C、矩阵、预警和审计；夹具不形成生产 seed 接口，也不能作为 MVP 完成证据。

### 问题 5：OpenSpec 配置与 monorepo 脚手架是否拆成两个 change？

可选方向：

- 单独创建只修改 `openspec/config.yaml` 的 change；
- 合并为首个工程基线 change；
- 不配置 OpenSpec，靠每个 Agent 自行记忆规则。

**推荐：合并为 C00 `establish-openspec-engineering-baseline`。**

条件结论：C00 的第一项任务先写入 OpenSpec context 和工件规则，后续任务再建立 workspace。单独的配置 change 没有业务或工程验收出口；完全省略配置会让实施 Agent 反复漏掉项目硬约束。

### 问题 6：共享契约一次冻结到什么范围？

可选方向：

- 一次定义全部内部 DTO、数据库表和页面模型；
- 只定义跨模块 SSOT、信封、接口和图状态；
- 各 change 自行定义，集成时再统一。

**推荐：只先冻结跨模块契约，内部工件由事实所属 change 决定。**

条件结论：C01 固定领域枚举、身份/版本/双时间、证据、审计上下文及 §2.6/§2.7 Schema；C02 固定模块接口、命令/查询/事件和图状态。模块私有表行、局部算法工件不提前猜测。

### 问题 7：主 specs 如何组织？

可选方向：

- 按前端/后端/数据库组织；
- 按页面组织；
- 按稳定业务能力路径组织，每个 capability 只有一个 owner。

**推荐：按业务能力路径组织。**

条件结论：采用 `platform/*`、`data/*`、`knowledge/*`、`retrieval/*`、`identification/*`、`assessment/*`、`warning-response/*`、`workflow/*`、`query/*`、`ui/*`、`quality/*`、`operations/*`、`acceptance/*`。并行 changes 不得修改同一主 spec。

### 问题 8：生产代码应拆成多少 npm 包？

可选方向：

- 每个领域模块一个 npm 包；
- 三个深层共享包，领域模块作为 `core` 内部模块；
- 所有代码放进三个应用。

**推荐：沿用已确认的三个深层共享包。**

条件结论：`contracts` 持有跨应用运行时 Schema，`core` 持有六个领域模块和应用模块，`adapters` 持有 PostgreSQL、Qdrant、文件、解析、OCR 与模型适配。避免把六个领域模块拆成浅包，也避免应用内重复实现领域逻辑。

### 问题 9：模块 interface 采用多细的入口？

可选方向：

- 暴露通用仓储、任意查询器和内部表结构；
- 暴露用例级命令、查询和结果引用；
- 用一个 `execute(any)` 统一所有行为。

**推荐：少量用例级 interface，参数使用闭合的可辨识联合类型。**

条件结论：interface 必须隐藏事务、重试、持久化和第三方协议；禁止 `Record<string, unknown>`、通用 JSON Patch、任意 SQL/文件/URL 工具。闭合命令联合可以收敛入口，但每个分支必须有精确 Schema。

### 问题 10：何时建立 adapter seam？

可选方向：

- 为所有未来能力预建 port；
- 只有存在生产实现与测试替身，或确有第二实现时建立 seam；
- 直接在领域代码里调用第三方库。

**推荐：只为真实变化点建 seam。**

条件结论：模型、OCR、格式解析器和持久化有真实 adapter；P/C、矩阵、阈值、特征计算、合并和置信度属于进程内确定性逻辑，不为测试额外制造 port。MCP、图数据库、对象存储、外部通知等不预建空 adapter。

### 问题 11：Agent 能力怎样切分？

可选方向：

- 每个业务环节各建一套 Agent runtime；
- 先建一个统一有界 Agent 任务模块，再由五类业务 change 接入类型化工具、增量和校验；
- 所有 LLM 调用都当作 Agent。

**推荐：统一 runtime + 五类任务集成。**

条件结论：C08 建统一任务信封、工具白名单、预算、失败和审计；C15、C17/C19、C21、C27、C29 分别接入数据清洗、知识编制、检索审阅、处置建议和校准建议。RI-S57 保持专用 LLM 节点，不进行同模型 Agent 自审。

### 问题 12：评估主线是否等待完整识别实现？

可选方向：

- 必须等待标准化风险记录由完整识别产生；
- 通过共享的 `RiskInputRef` 与正式契约夹具并行实现；
- 复制一套临时风险事件模型。

**推荐：基于共享契约并行实现，禁止复制风险模型。**

条件结论：C25 可以用合法的标准化风险记录 fixture 或 `externalRiskEventId` 测试，C30 再与 C24 的真实识别结果连接。fixture 只存在于测试/验收包，不暴露生产写入口。

### 问题 13：UI 何时开始？

可选方向：

- 所有后端完成后统一开始；
- C10 先冻结 shell、骨架和交互原语，业务 UI 在对应接口稳定后并行；
- 先把全部页面做成 Mock，再补后端。

**推荐：shell 先行、业务 UI 随接口并行、关闭前接真实 API。**

条件结论：允许契约 fixture 帮助页面开发，但任何 UI change 的验收都必须使用真实命令/查询接口，不能以 Mock 后端、预写响应或数据库手工数据通过。

### 问题 14：现有 Demo 如何处理？

可选方向：

- 整体迁入并继续保留 npm/React 18；
- 只迁移已确认的视觉语言、页面信息和静态资产；
- 完全丢弃。

**推荐：只迁移可复用视觉与内容，移除第二套工程基线。**

条件结论：C10 和 C32～C35 参考 Demo，但正式页面重新接入共享 Schema、权限、状态、真实 API 和可访问性。迁移完成后不保留独立 `demo/package-lock.json`、第二套路由或 Mock 数据源作为生产路径。

### 问题 15：测试是否拆成独立 change？

可选方向：

- 每个模块另建一个测试 change；
- 每个 change 自带最小稳定行为验证，另设质量评测和系统验收两个收口 change；
- 最后统一补测试。

**推荐：能力验证随 change，C36/C38 负责跨能力质量与系统验收。**

条件结论：不创建“补单测”“补 E2E”类 change。每个能力的 interface 就是其测试面；真实基础设施语义用 Testcontainers 或临时目录验证，少量关键闭环由最终 Playwright 与部署验收覆盖。

### 问题 16：质量评测模块何时开始？

可选方向：

- 系统完成后再实现；
- G0 后先详细规划评测包/运行/报告接口，G2 后实现，各能力逐步接入；
- 每个模块自己写评测脚本。

**推荐：早规划、后实现、统一编排。**

条件结论：C36 的 artifacts 可在 G0 后提前规划，但实现建立在正式能力接口上；评测模块不复制 P/C、矩阵或规则算法，不用综合分掩盖任一硬失败。

### 问题 17：目标硬件基准是否单独建 change？

可选方向：

- 单独建纯性能 change；
- 并入离线部署和最终验收；
- 不做实机基准。

**推荐：部署 change 固定环境并运行基准，最终验收引用其证据。**

条件结论：C37 在 RTX 4090/128GB 基线验证模型、解析、OCR、检索和完整运行；C38 冻结并引用结果。无需为只运行一组命令单开浅 change。

### 问题 18：下游何时可以开始？

可选方向：

- 上游 proposal 完成即可开始实现；
- 上游 design 接口冻结即可开始规划，下游实现必须基于已集成、已归档的直接依赖；
- 所有上游全部完成后才开始任何工作。

**推荐：规划可提前两个波次，实现等待直接依赖归档。**

条件结论：主 Agent 可以在上游实现期间准备下游 proposal/specs/design/tasks，但不据此提前派发实现；Luna 只能进入基于已归档依赖创建的 worktree。需要修改上游契约时先建独立契约演进 change，受影响分支暂停。

### 问题 19：worktree 与 change 怎样对应？

可选方向：

- 多个 change 共用一个长期分支；
- 一个 change 一个 worktree、一个主执行 Agent；
- 一个 change 内多个 Agent 同时改同一目录。

**推荐：一个 change 一个 worktree、一个主执行 Agent。**

条件结论：规划、执行和验证角色可以顺序接力，但同一时刻只有一个写入所有者。Orca 可自行生成实际分支名，协议不依赖 `change/<change-name>` 命名；每次派发以完整 worktree ID、base HEAD 和 change 标识为事实源。合并后删除由实施阶段另行执行，本票不创建正式 change 分支。

### 问题 20：共享文件冲突怎样处理？

可选方向：

- 让并行 Agent 自行解决；
- 由主 Agent 在集成步骤单点拥有根配置、锁文件、公共 exports、路由注册和迁移编号；
- 禁止并行。

**推荐：共享热点由主 Agent 在集成步骤单点拥有，feature worktree 只改自己的目录。**

条件结论：C00～C02 后，`openspec/config.yaml`、根 workspace、锁文件、公共 contracts 与中央注册文件不得被业务 change 顺手修改。迁移号由主 Agent 预分配；API/Web feature 导出后由主 Agent 串行注册。

### 问题 21：谁执行 verify、archive 和主 specs 同步？

可选方向：

- 每个执行 Agent 自行归档；
- Luna 完成 verify，主 Agent 审阅后由 M3 串行 archive；
- 累积多个 changes 后批量归档。

**推荐：Luna 交付并验证，主 Agent 审阅，M3 在批准后机械归档。**

条件结论：Luna 完成 apply、最小验证和 `openspec-verify-change`，在 `worker_done` 前请求主 Agent 审阅；主 Agent 批准并完成必要集成后，MiniMax-M3 才能执行既定的 archive 和 tracker 更新。依赖方只认主分支中已归档的契约。

### 问题 22：详细设计应厚到什么程度？

可选方向：

- 只写目标和技术选型；
- 写到 Luna 无需再决定字段、接口、错误、事务、权限、文件归属和验证方式；
- 在 design 中直接粘贴完整实现代码。

**推荐：消除实施判断，但不预写实现。**

条件结论：每个 design 必须给出精确接口、Schema、状态/时序、事务、错误、权限、审计、文件清单和验收；tasks 必须逐项写目标文件、输入、输出和命令。算法实现可留给执行 Agent，架构和契约选择不可留白。

### 问题 23：是否提前 scaffold MVP 后续扩展？

可选方向：

- 为 CAD、MCP、LoRA、图数据库、HA 等预建空模块；
- 只固定扩展 seam、触发条件和不变量，需求出现后再开 change；
- 完全不记录扩展方向。

**推荐：记录 seam 与触发条件，不创建空 change 或 adapter。**

条件结论：后续能力必须复用工程数据接入、模型网关、检索投影、通知意图和不可变版本接口；真实来源、样例或量化门槛出现后再 scaffold。

### 问题 24：何时初始化 CodeGraph？

可选方向：

- 现在初始化；
- C00 归档、生产目录和 exports 稳定后初始化；
- 永不使用。

**推荐：C00 归档后初始化。**

条件结论：当前仓库主要是 Demo 和规划工件，现在建图很快过时。CodeGraph 初始化是开发准备动作，不是产品能力，不单建 OpenSpec change；初始化前仍需用户授权实际命令。

### 问题 25：路线是否固定人力、工期和日历日期？

可选方向：

- 现在给每个 change 固定天数和负责人；
- 只给依赖、波次、worktree 所有权和容量规则；
- 完全不表达执行顺序。

**推荐：本票只固定依赖和并行规则。**

条件结论：实际速度取决于甲方输入、模型/OCR 实测和可用 Agent 数。虚构日历会很快失真；实施调度按“当前 frontier 中目录所有权互不冲突的 change”动态领取。

## 3. 模块与稳定 interface

下表描述 change 设计必须维持的模块深度。方法名是路线级建议，最终精确签名在 C02 设计中冻结。

| Module | 建议 interface | 隐藏在 implementation 内的复杂度 |
|---|---|---|
| 工程数据 | `apply(command)`、`freeze(request)`、`read(query)` | 工程/区段、资料与监测不可变版本、解析清洗、资料段、权限继承和快照 |
| 知识建模 | `govern(command)`、`resolve(request)`、`retrieve(request)` | 修订、审核、发布集合、适用规则集、证据库组合、双索引与关系上下文 |
| 风险识别 | `plan(inputRef)`、`analyze(workItemRef)`、`finalize(candidateSetRef)` | 检索 Agent、五项上下文、RI-S57、结构校验、合并、置信度、验收入库 |
| 风险评估 | `prepare(request)`、`evaluate(inputRef)` | 指标取值、规则适配、P/C、矩阵、触发指标和重评估依据 |
| 预警处置 | `open(assessmentRef)`、`recommend(taskRef)`、`record(command)` | 预警归集、措施组合、三项校验、预测、执行、反馈、偏差与校准 |
| 复核审计 | `requestReview(request)`、`decideReview(decision)`、`trace(query)` | 类型化决定、陈旧提交、批量操作、只追加审计和运行恢复 |
| Agent 任务 | `start(envelope)`、`resume(taskRef)`、`confirm(commandRef)` | 工具循环、硬预算、任务类型化增量、有限修正、原始工件与失败 |
| LangGraph 工作流 | `startRun(command)`、`resumeRun(runRef)`、`cancelRun(runRef)` | 父子图、检查点、幂等、技术错误、人工复核路由和有限运行 |
| 查询与交付投影 | `query(request)`、`subscribe(runRef)`、`export(request)` | 跨模块只读组合、SSE、权限脱敏、图谱与报告重建 |
| 质量评测 | `registerPack(pack)`、`evaluate(request)`、`report(runRef)` | 数据来源隔离、切片、三次语义运行、硬门槛和证据清单 |

共同 interface 约束：

- 跨模块只传 Zod DTO、实体标识和精确版本引用；`z.infer` 派生 TypeScript 类型，不重复手写 DTO。
- 标准化风险记录七项内容字段不扩张；身份、版本、知识和运行引用放在记录信封。
- `riskRecordId` / `externalRiskEventId` 在类型层表达 XOR。
- 图状态只保存小型引用和路由结果，不保存原文、完整 JSON-LD、完整检索片段或业务事实副本。
- API、Worker、Web、Agent 和 LangGraph 都只能调用 module interface，不直读数据库、Qdrant、文件目录或内部表。

## 4. 每个 OpenSpec change 的工件契约

### 4.1 `proposal.md`

必须包含：

1. 问题与可观察结果；
2. 范围和明确 Non-goals；
3. 直接依赖、下游消费者和受影响 capability；
4. 事实所有者与不拥有的事实；
5. RI/RA、Agent、功能用例和页面追踪；
6. 新依赖的精确版本、用途、许可证、离线来源和退出条件；
7. 与路线偏离时需要重新决策的条件。

### 4.2 `specs/<capability>/spec.md`

每条 requirement 必须：

- 表述稳定、用户或调用方可观察的行为；
- 至少有正常、失败、权限、陈旧版本/并发、重试/幂等场景中适用的 scenarios；
- 明确版本、证据、审计和人工复核语义；
- 标注对应 RI/RA 步骤或说明不适用；
- 不锁定内部调用顺序、完整文案、字段顺序、CSS、Prompt 文本或第三方对象结构。

### 4.3 `design.md`

必须固定：

1. module、interface、入口签名和完整 invariants；
2. 输入/输出 Zod Schema、字段来源、版本语义和禁止复制的 SSOT；
3. 所拥有事实、只引用事实、状态机和双时间语义；
4. 正常流程、失败路径、时序图、暂停/恢复和取消；
5. 事务边界、幂等键、唯一约束、Outbox、检查点和业务事实关系；
6. PostgreSQL 表/迁移所有权、内容工件、Qdrant 投影及重建边界；
7. seam 分类、生产 adapter、测试方式和替换条件；
8. 权限矩阵、证据可见性、Agent 工具白名单和资源预算；
9. 结构化错误码、可重试性、复核或终止条件；
10. API 命令/查询/SSE、页面编号与深链；
11. 性能、资源、日志、指标、链路、审计和秘密要求；
12. 版本迁移、历史重放、发布、回滚与删除/重建语义；
13. RI/RA → interface → DTO → 持久化 → 验收证据追踪表；
14. 精确新增/修改/删除文件清单与禁止修改区域；
15. 被否决方案及重新评估触发条件；
16. 所有新待决问题的“问题、全部选项、推荐、按推荐继续后的影响”。

Luna 读完 design 后，不应再需要决定模块归属、字段名称、数据库模型、错误策略、权限、第三方依赖或测试层次。

### 4.4 `tasks.md`

任务按 `契约夹具 → core → adapter → API/Worker → Web → 最小验证 → OpenSpec verify` 排列。每项写明：

- 目标文件或目录；
- 输入工件和直接前置任务；
- 要产生的行为或文件；
- 验证命令与通过条件；
- 不得修改的共享区域。

禁止使用“实现后端”“完善异常处理”“补充测试”等无法由弱模型直接执行的任务描述。

## 5. 39 个 OpenSpec changes

表中依赖只列直接依赖。每个 change 都必须在自己的 specs 中承诺表列验收出口，并在 design 中展开全部接口和文件。

### Wave A：工程、契约与接口闸门

| ID / Change | 直接依赖 | 主要能力与 interface | 独立验收出口 / 所有权 |
|---|---|---|---|
| C00 `establish-openspec-engineering-baseline` | — | 填充 OpenSpec context/rules；建立 pnpm monorepo、三应用三共享包、精确依赖、exports、构建/测试/边界检查、离线依赖治理 | frozen lockfile 安装、三应用三包构建、`tsc -b`/lint/format/dependency-cruiser 通过；独占根配置、锁文件、CI |
| C01 `define-domain-contract-kernel` | C00 | 领域枚举、身份/版本/双时间、证据、命令/错误/审计信封、§2.6/§2.7 全部 Zod Schema、XOR 风险输入 | Schema 正反例、字段与专利枚举 100% 对账、无重复 DTO；独占 `packages/contracts/src/{vocabulary,common,records}` |
| C02 `define-module-interfaces-events-and-workflows` | C01 | 六领域模块与应用模块 interface、授权上下文、幂等键、事务事件、I0～I9/A 阶段 DTO、Agent/复核引用和依赖方向 | 所有跨模块调用只传版本 DTO/引用；图状态无大对象；RI/RA 追踪完整；独占 contracts 的 ports/events/workflows |

**G0 契约闸门**：C00～C02 必须串行完成、验证、归档并同步主 specs。此后业务 change 不得顺手修改共享字段或 interface；需要修改时先开独立契约演进 change。

### Wave B：运行基础设施

| ID / Change | 直接依赖 | 主要能力与 interface | 独立验收出口 / 所有权 |
|---|---|---|---|
| C03 `deliver-postgresql-outbox-and-checkpoint-foundation` | C02 | PostgreSQL schema/role、Kysely 迁移、事务单元、Outbox、幂等消费、独立 LangGraph checkpointer、模块迁移发现约定 | Testcontainers 验证事实+审计+Outbox 原子性、至少一次消费、检查点与业务事实隔离；拥有 Postgres 基础 adapter |
| C04 `deliver-content-addressed-artifact-store` | C02,C03 | 不可变内容目录、先耐久落位后引用、哈希清单、权限继承、孤儿处理、恢复核对 | 原子落位、哈希校验、DB 无悬空引用、无权读取拒绝；拥有 artifacts adapter |
| C05 `deliver-llamacpp-model-gateway` | C02,C04 | `completeStructured`、`embed`、`streamConversation`，模型能力、超时/取消、原始响应工件和 Zod 复验 | 真实 llama.cpp smoke；非法结构、断流、超时结构化失败；业务代码无模型名；拥有 model adapter |
| C06 `deliver-local-identity-and-project-authorization` | C03,C01 | 本地账号/会话、预设角色、工程成员、空间区段、两级资料权限、服务端授权 | 登录/停用/重置/超时、只读拒写、系统管理员无业务特权、证据正文隔离；拥有 access 模块和 auth adapter |
| C07 `deliver-review-and-audit-runtime` | C03,C06 | 复核任务、类型化决定、领取/陈旧性、批量决定、只追加审计、安全拒绝与中文活动投影 | 重复决定幂等、陈旧提交拒绝、审计失败阻断业务提交、应用角色不能改审计；拥有 review-audit 模块 |
| C08 `deliver-unified-bounded-agent-runtime` | C03,C04,C05,C06,C07 | Agent 任务信封、有限状态、工具白名单、硬预算、候选、类型化增量、有限修正、失败恢复、交互命令确认 | 工具/预算越界、换模型、通用 Patch、必经任务跳过均拒绝；恢复不重复副作用；拥有 agent-runtime 与 Worker agent |
| C09 `deliver-http-command-query-and-sse-shell` | C02,C03,C06 | Fastify 命令/查询、错误映射、幂等、上传边界、OpenAPI 派生、SSE 与 Worker 任务出口 | typed round-trip、服务端权限、重复命令同结果、SSE 断线恢复且不泄露内部错误；拥有 API platform |
| C10 `deliver-web-shell-and-interaction-primitives` | C01,C09 | React 19 shell、七项导航、工程上下文、五类页面骨架、权限态、证据/Agent 停靠区、确认卡、ECharts adapter | 路由、键盘/焦点、空/加载/异常、权限置灰一致；不显示虚假业务入口；拥有 Web app/shell/shared |

**G1 运行内核闸门**：登录后可以提交幂等参考命令；业务事实、审计和 Outbox 原子提交；Worker 状态经 SSE 可见；参考 Agent 任务真实使用模型网关、白名单、预算和工件审计。

### Wave C：工程数据与知识基线

| ID / Change | 直接依赖 | 主要能力与 interface | 独立验收出口 / 所有权 |
|---|---|---|---|
| C11 `deliver-engineering-context-and-source-registry` | C03,C04,C06,C07 | 工程/区段修订、来源交付、资料项/版本、资料ID/资料段身份、元数据、权限、适用性快照 | 三项适用性元数据齐全；版本只追加；幂等交付；资料段格式与权限继承正确；拥有 engineering-data/context-source |
| C12 `deliver-structured-document-conversion` | C11 | DOCX、文本 PDF、XLSX/CSV 结构解析，JSON-LD、坐标、≤512 字符、前后指针、失败段 | 真实格式样例结构/关键值通过门槛；失败定位资料段；不得空成功；拥有 document adapters |
| C13 `deliver-scanned-document-ocr` | C11,C02 | 扫描 PDF/PNG/JPEG，经独立内网 OCR/版面服务复用统一转换 interface，记录模型/服务版本与资源 | 中文扫描样例、页码/版面/表格定位；关键字段门槛；OCR 失败结构化；与 llama.cpp 资源隔离可验证 |
| C14 `deliver-monitoring-batches-snapshots-and-features` | C11 | 序列/批次/更正/迟到/快照，单位、时间对齐、斜率/加速度/频域主峰/异常评分和可用性 | 地表沉降完整样例数值交叉验证；重复幂等；更正/迟到只追加；快照冻结不被后续数据改变 |
| C15 `deliver-agent-cleaning-and-partial-availability` | C08,C11,C12,C13,C14 | 数据清洗 Agent 的工具、类型化增量、质量判断、排除范围、部分可用和确定性收口 | 四类文档与监测形成业务可用结果；关键数值无有害修改；Agent 失败/预算耗尽不得跳过；拥有 cleaning 子模块 |
| C16 `deliver-governed-definition-lifecycle` | C03,C06,C07 | 稳定身份、不可变修订、送审、发布集合、停用、重新启用历史版本、精确配置包导入 | 发布内容不可原地修改；回滚形成新决定；运行只解析精确版本；Agent 无发布权；拥有 knowledge/governance |
| C17 `deliver-process-model-mechanism-and-evidence-governance` | C08,C15,C16 | 工序模型、风险机理、规范/案例发布集合、检索证据库组合和非结构化知识编制 Agent | 五个必含工序、六类机理、关系一致性、证据可达、关键工序覆盖；失败复核；拥有 identification-knowledge |
| C18 `deliver-assessment-configuration-and-measure-governance` | C16,C14 | 指标/字段映射、权重、受控聚合策略、矩阵、两类阈值、联合规则、措施与预测/偏差策略 | 配置包确定性导入/发布/回滚；矩阵与边界精确；两类阈值分离；无任意公式 DSL；拥有 assessment-config |
| C19 `deliver-structured-scoring-rules-and-applicable-rule-sets` | C08,C15,C16,C18 | 规范条文知识编制 Agent、结构化评分规则、冲突/重叠检测、三维适用性、审核与适用规则集 | 至少一条真实规范走通 RA-S3/S4；冲突和不适用规则全拦截；筛除原因完整；拥有 knowledge/rules |

**G2 数据与知识闸门**：四类 MVP 文件与地表沉降批次形成冻结业务输入；项目工序模型、风险机理库、证据库、指标/矩阵/阈值/措施与适用规则集均以审核发布版本存在；配置导入与 Agent 编制进入同一事实模型。

### Wave D：识别、评估与处置闭环

| ID / Change | 直接依赖 | 主要能力与 interface | 独立验收出口 / 所有权 |
|---|---|---|---|
| C20 `deliver-versioned-dual-index-hybrid-retrieval` | C03,C05,C17 | Qdrant 稠密向量+BM25、不可变代际、Outbox 投影、旁路构建/ready/切换、RRF、PG 回查 | 双索引成员/版本/权限对账；缺一路不降级；索引可删除重建；质量与 p95 门槛；拥有 qdrant/retrieval |
| C21 `deliver-relationship-context-and-retrieval-agent-review` | C08,C17,C20 | 关系上下文、基线检索→Agent 补搜→确定性选择、检索增量、RI-S56 五项上下文和预算 | Agent 不改基线分数/资格；冲突不静默删除；五项上下文齐全；必经 Agent 失败不继续；拥有 identification/context |
| C22 `deliver-risk-candidate-validation-merge-and-acceptance` | C05,C07,C21,C01 | RI-S57 专用 LLM、结构修复、Schema/证据/规则校验、全局合并、综合置信度、标准化风险记录/关联事实/事件 | 七字段不变；契约外字段复核；无重复显式跳过；同组不可部分验收；业务入库幂等；拥有 identification/decision |
| C23 `deliver-identification-human-review` | C07,C22 | 一站式修正并通过、证据调整、合并/分立、批量原样通过/拒绝、陈旧性和恢复 | 一次操作完成新候选→重校验→入库→恢复；`modelConfidence` 只读；批量逐项审计；拥有 identification/review |
| C24 `deliver-identification-graph` | C03,C15,C17,C21,C22,C23 | I0～I9、准备/输入快照、工序工作项、合并组、知识等待、暂停/恢复、重试/取消、结果 DTO | 一步启动；争议组不阻塞合格组；恢复不重复模型/入库；技术错误不造复核；RI-S1～S6 全追踪 |
| C25 `deliver-deterministic-risk-assessment` | C03,C11,C14,C18,C19,C01 | 风险输入 XOR、评估快照、指标取值、P/C、矩阵、四类触发与不可变评估记录 | 全配置空间/边界精确；相同输入精确重放；缺值/单位冲突无部分等级；计算链无 Agent；拥有 risk-assessment/engine |
| C26 `deliver-warning-tasks-and-in-app-notification` | C07,C09,C25 | 预警事实、按工程+风险+空间归集处置任务、确认语义、可靠入库后的应用内通知意图 | 重试不重复预警；持续越限正确归集；通知失败不回滚；确认只表示已读接管；拥有 warning 子模块 |
| C27 `deliver-response-recommendation` | C07,C08,C18,C26 | 冻结措施候选、处置建议 Agent、类型化增量、三项确定性校验、正式建议与采纳边界 | 候选集外措施零容忍；三项失败无强行通过；建议不冒充施工指令；拥有 recommendation 子模块 |
| C28 `deliver-execution-forecast-feedback-and-deviation` | C07,C14,C25,C27 | 采纳/独立行动、执行前效果预测、现场执行、反馈、同口径实际变化和偏差记录 | 预测先于执行；无预测不编造偏差；偏差口径冻结；执行人与录入人分开；拥有 feedback 子模块 |
| C29 `deliver-calibration-suggestion-and-governance-loop` | C07,C08,C18,C19,C28 | 偏差超限校准 Agent、候选校验/复核、创建新定义草稿、审核发布后触发重评估 | Agent 不直接改权重/阈值；失败不回滚偏差；人工确认后才发布；拥有 calibration 子模块 |
| C30 `deliver-assessment-and-riskflow-graphs` | C03,C07,C24,C25,C26,C27,C28,C29 | 完整 `assessmentGraph` A0～A9、初评/重评/历史补算/预测/反馈入口，顶层 `riskFlowGraph` 组合和 RI→RA 事件 | 预警/处置无旁路；每个运行有限；暂停恢复幂等；版本变化只新增记录；RI→RA 真实贯通；拥有 workflow 模块 |

**G2.5 早期纵向闸门**：C25/C26 可在识别分支尚未汇合时，通过正式 `RiskInputRef` 和验收 fixture 跑通“标准化风险记录 → P/C → 矩阵 → 预警 → 审计”。不得添加生产 seed API、内存事实源或临时算法。

**G3 业务闭环闸门**：C24 与 C30 归档后，真实跑通 RI-S1～RI-S6、RA-S1～RA-S7；五类必经 Agent、专用 RI-S57、确定性评分、四类预警、处置、反馈、偏差和校准均执行；失败、预算耗尽、恢复和 Outbox 重投不产生重复事实或静默降级。

### Wave E：查询投影与正式界面

| ID / Change | 直接依赖 | 主要能力与 interface | 独立验收出口 / 所有权 |
|---|---|---|---|
| C31 `deliver-graph-trace-and-report-projections` | C03,C22,C25,C26,C28,C29,C30 | 工序风险图谱、当前风险、完整追溯、运行/Agent 视图、双时间查询、报告与审计证据包、feature 查询 transport | 投影可删重建且不反写；API/DB/页面/导出引用一致；无资料权限不泄露正文；拥有 query-projections |
| C32 `deliver-engineering-and-knowledge-ui` | C10,C15,C17,C18,C19,C31 | 工程、资料、接入、监测、工序、机理、规则、矩阵、阈值、措施治理页面，真实命令与版本行为 | 相关日常操作全走 UI；部分可用、Agent 子任务、发布/回滚、证据权限完整；拥有 Web project/knowledge features |
| C33 `deliver-identification-and-review-ui` | C10,C23,C24,C31 | 一步启动、I0～I9、风险记录、图谱、检索基线/Agent 增量/最终证据、一站式复核和批量决定 | 等待复核不伪装完成；技术故障无业务复核入口；`modelConfidence` 只读；拥有 Web identification/review |
| C34 `deliver-assessment-warning-and-response-ui` | C10,C25,C26,C27,C28,C29,C30,C31 | 风险态势、评估/矩阵、预警、处置任务、建议、执行、预测、反馈、偏差、校准页面 | P/C 可核对；两类阈值分离；无强行通过/立即校准；完整闭环只用 UI；拥有 Web overview/assessment/response |
| C35 `deliver-agent-audit-and-operations-ui` | C07,C08,C10,C31 | Agent 停靠栏/全屏/任务详情、统一复核/运行/审计、追溯、报告、最小系统管理 | 停靠与全屏共享任务；命令等待确认；预算/增量/校验可见；不展示思维链或原始 Pino；拥有 Web agent/audit/ops |

**G4 产品闸门**：工程风险管理员只通过界面完成主闭环；只读账号、跨工程访问、资料正文权限、无权 Agent 命令和证据脱敏全部真实生效。页面不得依赖 Mock 或开发人员手工串联。

### Wave F：质量、部署与交付

| ID / Change | 直接依赖 | 主要能力与 interface | 独立验收出口 / 所有权 |
|---|---|---|---|
| C36 `deliver-quality-evaluation-module` | C15,C17,C20,C21,C22,C25,C27,C29 | 开发/冻结/甲方三层包、来源家族隔离、总体/切片/逐例报告、三次语义运行、硬门槛、LoRA 准入 | 已确认质量策略全部门槛；确定性 100%；安全硬失败不能被总分掩盖；拥有 quality-evaluation 与报告 adapter |
| C37 `deliver-offline-private-deployment-and-operations` | C03～C10,C13,C20,C24,C30,C32,C33,C34,C35,C36 | 三 VM、HTTPS/端口、系统秘密文件、离线制品/SBOM/许可证、日志/指标/链路、升级回退、同机逻辑恢复、目标硬件基准 | 断网干净环境安装；三 VM 隔离；4090/128GB 基准；投影重建；秘密不泄露；不宣称 HA/灾备；拥有 deploy/ops |
| C38 `deliver-mvp-acceptance-and-delivery-evidence` | C24,C30,C31,C32,C33,C34,C35,C36,C37 | 冻结验收基线、双向追踪、主线+高风险失败、权限/安全/恢复/部署、缺陷分级、六类交付物和哈希清单 | 全部硬门槛；干净输入完整重跑；阻断缺陷为零；区分技术就绪与甲方验收；拥有 acceptance/evidence |

**G5 技术就绪闸门**：C38 可以基于同形合成或甲方认可样例形成技术就绪。只有甲方认可的脱敏工程资料、风险依据和核查要点到位并现场完整重跑、书面确认后，才形成 MVP 验收通过；该条件工作到位后再创建，不提前 scaffold 空 change。

## 6. 依赖图与最大安全并行

```text
C00 → C01 → C02
                 ├─ C03 → C04 → C05
                 ├─ C03 → C06 → C07 → C08
                 ├─ C03 + C06 → C09 → C10
                 └─ G0

G1 后两条地基并行：
  数据线：C11 → {C12, C13, C14} → C15
  治理线：C16 → C18

G2 前多路并行：
  识别知识：{C15, C16, C08} → C17
  评估知识：{C15, C16, C18, C08} → C19

G2 后两条业务主干并行：
  识别：C20 → C21 → C22 → C23 → C24
  评估：C25 → C26 → C27 → C28 → C29
  汇合：{C24, C25..C29} → C30 → C31

对应接口稳定后，界面并行：
  C32  C33  C34  C35

收口：
  C36 可在 G2 后开始实现
  {C32..C36} → C37 → C38
```

这张静态图一次性完整维护，供主 Agent 计算 frontier 和判断 change 的直接依赖。Orca 采用滚动执行图，不把 39 个 changes 一次性物化为深链：每个 G0～G5 阶段建立一个 Run，只创建当前波次与相邻下一层任务，阶段门通过后再展开下一段。

每个 change 的执行子图固定为：

```text
主 Agent 工件闸门
        ↓
deliver（Luna max：apply + 最小验证 + verify + 请求主 Agent 审阅）
        ↓ 主 Agent 批准
archive（MiniMax-M3 high：机械归档 + tracker/证据更新）
        ↓
下游 deliver
```

`task-create --deps` 表达上述依赖，`task-list --ready` 只计算可派发项，不自动启动 worker。主 Agent 保留最终派发和归档授权。

并行规则：

- G0 前只允许一个串行契约 lane；G0 后才开放业务 worktree。
- 同一波次优先同时领取不同所有权目录的 change；并发数不足时优先选择关键路径和可解锁最多后续项的 change。
- C12/C13/C14、C17/C19、识别/评估两主干、C32～C35 分别是主要并行组。
- 主 Agent 可以提前两个波次准备 OpenSpec 工件；Luna 不得基于未归档依赖写生产代码。
- 工作树按就绪前沿滚动预建，只覆盖直接依赖已归档且目录所有权互不冲突的 change；记录完整 worktree ID、实际分支和 base HEAD，不预建全部 39 个长期阻塞工作树。
- G2.5 在识别长链仍运行时提前验证右半闭环，避免全部问题堆到 G3。

## 7. Worktree 与 Agent 执行协议

### 7.1 角色

- **主 Agent**：维护静态依赖图和滚动 Orca 图，计算 frontier，准备工作树，起草并审阅 proposal/specs/design/tasks，审阅 Luna 交付，处理必要集成并授权归档。
- **Luna 实施 Agent**：固定使用 `gpt-5.6-luna` / `max`，承担全部实质开发、最小验证和 `openspec-verify-change`。不得擅自改接口、增加依赖或扩大范围；发现设计缺口时返回主 Agent 更新工件。
- **M3 杂活 Agent**：固定使用 OMP + `minimax-code-cn/MiniMax-M3` / `high`，只做资料搜索、证据整理、已批准 change 的机械归档和 tracker 更新，不承担规划或实质开发。

### 7.2 领取与完成

1. 主 Agent 依据已归档主 specs 和静态依赖图计算当前 frontier；按 G0～G5 建立或推进当期 Orca Run，只物化当前波次和相邻下一层。
2. 仅为 frontier 中目录所有权互不冲突的 change 创建独立 worktree；记录完整 worktree ID、实际分支、base commit、直接依赖和所有权目录，不从分支名反推 change 身份。
3. 主 Agent 在派发前完成并审阅全部 OpenSpec artifacts；规划闸门未通过时不创建 `deliver` Dispatch。
4. Luna 在该工作树使用 `openspec-apply-change` 实现，运行最小必要验证和 `openspec-verify-change`，不启动开发服务器。
5. Luna 在发送 `worker_done` 前通过 Orca `ask` 请求主 Agent 审阅。需要修改时继续同一 Dispatch；主 Agent 明确批准后才确认交付完成。
6. 经批准的 `deliver` 解锁 `archive`。MiniMax-M3 只按既定步骤归档、同步 tracker 和整理证据；遇到冲突、规格漂移或需要判断的结果立即升级给主 Agent。
7. `archive` 完成后解锁下游 `deliver`；主 Agent 重新计算 frontier，并为新就绪项滚动创建工作树和任务。

### 7.3 冲突热点

- `openspec/config.yaml`、根 `package.json`、`pnpm-lock.yaml`、根 tsconfig、CI：C00 后由主 Agent 串行治理。change 的固有依赖在其 design 中批准后，由主 Agent 在该特性分支提交清单、策略和锁文件检查点；只有跨 change 的工具链升级或替换才单独建立依赖演进 change。
- `packages/contracts`：C01/C02 独占共同契约；业务 change 只在自己的 capability 子路径新增私有 Schema，不修改共享 SSOT。
- migrations：C03 定义按 change ID/领域目录发现的约定；主 Agent 预分配编号，feature worktree 不改中央索引。
- API route、Worker handler、Web router/导航：feature worktree 导出自己的 contribution，中央注册文件由主 Agent 串行更新。
- package barrels/exports：优先使用稳定子路径 exports，避免所有 worktree 修改同一个 `index.ts`。
- 事件名、错误码、任务状态、审计代码、领域枚举：全部走共享常量或契约，禁止散落字符串。
- Demo 迁移：只有 C10/C32～C35 可以处理相关生产迁移；其它 change 不复制 Demo 的 Mock 数据或依赖。

### 7.4 Orca 编排预检

第四轮探测已把原有阻塞改写为可执行协议。C00 仍保持单 lane；C00 归档并验证真实 setup hook 后，才开放 G0 后的业务并行：

- 协调 Agent 绑定真实 Orca terminal identity，并在外部调用中显式传递 `ORCA_TERMINAL_HANDLE` 或 `--from`。
- `worktreeBasePath` 可用；新工作树记录完整 ID 和 base HEAD；复用 terminal 时同时传递其完整 worktree ID。
- C00 创建工作树时显式 `--setup skip`。C00 建立正式 pnpm workspace 和冻结锁文件后，把项目 setup hook 配置为 `pnpm install --frozen-lockfile`，并在下一个受控工作树用 `--setup run` 验证；不添加空 hook，也不安装 Demo 依赖。
- 新目录首次 Codex 启动若出现信任提示，拆分执行 `terminal send --text 1` 与 `terminal send --enter`，随后等待 `tui-idle` 再派发。computer-use 目前只能发现 Orca 顶层窗口，无法读取或操作内部 TUI，因此不作为该门禁的实现方式。
- Luna 固定先用精确 argv 创建 Codex terminal：`--model gpt-5.6-luna -c model_reasoning_effort="max"`，等待 TUI 状态栏显示 `gpt-5.6-luna max` 后，再以完整 worktree ID 执行 `worker-start --terminal`。正式执行不额外传入会触发宿主 `bwrap` 错误的 `--sandbox read-only`。
- `check --wait` 能跨 keepalive 收到唯一 `worker_done`，不留下 waiter；第二轮探测已通过。
- Luna terminal 与 OMP terminal 均按 `external_terminal` 管理。协调端先处理 transcript、唯一 `worker_done` 和 delivery，再调用 `worker-release` 取得 `retained / external_terminal`，确认账面状态后只关闭本 Dispatch 创建的精确 tab；不再使用会进入 `release_unknown / tab_not_found` 的原生 owned terminal 路线。

### 7.5 非开发杂活的低成本模型通道

- OMP + `minimax-code-cn/MiniMax-M3` 固定请求 `--thinking high`，只用于资料搜索、证据整理、已批准 change 的机械归档和 tracker 更新。
- M3 不得起草 proposal/specs/design/tasks，不得编写或修改代码、测试、配置、依赖、迁移，也不负责解决冲突或判断 `openspec-verify-change` 是否可接受。
- Orca 当前不能通过 `worker-start --agent omp --model ...` 选择 OMP 模型。固定流程为：用精确 argv 创建 OMP terminal → 等待 `tui-idle` → 以完整 worktree ID 和 `worker-start --terminal` 纳入 Dispatch → 等待并确认唯一 `worker_done`。
- 自定义 OMP terminal 属于 `external_terminal`。`worker-release` 只完成 retained 记账；协调端在 transcript/结果检查完成后关闭自己创建的精确 terminal，不使用宽泛 terminal 清理。
- 第三轮只读探测已验证 MiniMax-M3 能正确读取当前工作树、完成确定性小任务并遵守 `worker_done` 协议；归档写入仍必须以主 Agent 已批准的 change 和确定步骤为输入。

## 8. Definition of Ready / Done

### 8.1 Change 可交给 Luna 实施的条件

- 所有直接依赖已归档到主 specs；
- proposal/specs/design/tasks 均由主 Agent 完成并通过复核；
- interface、Schema、状态机、错误、事务、权限、审计和文件清单无待决项；
- 所有问题均有选项、推荐和条件化结论；
- 所有新增依赖已固定版本、许可证、离线来源和退出条件；
- worktree 所有权不与其它活跃 change 重叠；
- 验收 fixture、真实样例或缺失原因已经明确。

### 8.2 Change 可归档的条件

- specs 的全部稳定行为已实现，Non-goals 未被偷带；
- 最小高价值验证通过，外部 adapter 使用真实语义验证；
- 权限、失败、幂等、重试/恢复、审计和版本行为有证据；
- RI/RA、Agent、用例、页面追踪无断点；
- 无生产 Mock、占位实现、临时回退或第二套事实源；
- 未修改不属于本 change 的共享区域；
- `openspec-verify-change` 通过，集成分支复验和主 Agent 审阅通过；
- 主 specs 同步完成，依赖图和 frontier 已更新。

## 9. 专利、Agent 与功能覆盖

### 9.1 RI/RA 追踪

| 范围 | 主要 changes |
|---|---|
| RI-S1 | C11、C24 |
| RI-S2 | C12、C13、C14、C15、C24 |
| RI-S3 | C17、C24 |
| RI-S4 | C17、C24 |
| RI-S51～RI-S56 | C05、C17、C20、C21、C24 |
| RI-S57～RI-S59 | C05、C21、C22、C24 |
| RI-S61～RI-S65 | C22、C23、C24、C31 |
| RA-S1 | C11、C14、C25、C30 |
| RA-S2 | C18、C25 |
| RA-S3 | C19、C30 |
| RA-S4 | C19、C25、C30 |
| RA-S5 | C25、C30 |
| RA-S6 | C25、C26、C30 |
| RA-S7 处置建议 | C18、C27、C30 |
| RA-S7 反馈与校准 | C14、C18、C28、C29、C30 |

### 9.2 五类必经 Agent

| Agent 任务 | Runtime | 业务接入 change |
|---|---|---|
| 数据清洗与部分可用 | C08 | C15 |
| 非结构化知识编制 | C08 | C17、C19 |
| 识别检索审阅与有界补搜 | C08 | C21 |
| 处置建议组合排序 | C08 | C27 |
| 偏差超限校准建议 | C08 | C29 |

### 9.3 功能与界面

| 功能簇 | 核心 changes | UI changes |
|---|---|---|
| 工程、资料与监测 | C06、C11～C15 | C32 |
| 知识、规则与版本 | C16～C21 | C32 |
| 风险识别与复核 | C20～C24 | C33 |
| 评估、预警与处置 | C25～C30 | C34 |
| Agent、审计与追溯 | C07、C08、C31 | C35 |
| 风险态势、报告与导出 | C31 | C34、C35 |
| 私有部署、质量与交付 | C36～C38 | C35 的最小系统管理区 |

## 10. MVP 后续扩展入口

以下事项不进入 C00～C38，不提前 scaffold；只保留触发条件和必须复用的 seam。

| 后续能力 | 触发条件 | 必须复用的 seam / 不变量 |
|---|---|---|
| CAD 深度解析 | 甲方提供真实 CAD 样例并确定业务可用字段与准确率门槛 | 统一资料转换 interface、JSON-LD、资料段、证据和处理版本 |
| 实时监测与 MCP | 明确具体平台/MCP Server、认证、样例、时效与责任 | 来源交付、监测批次/快照、截止点、幂等、权限和审计；不得直读最新值评分 |
| 甲方风险系统同步 | 明确系统、字段、认证和联调窗口 | Outbox、版本化消息、结果先入库、原始资料默认不外发 |
| 外部通知渠道 | 明确渠道与送达契约 | 预警先入库、通知意图、重试状态；送达不等于确认 |
| LoRA | 稳定基线在冻结评测包上持续未达门槛，且收益、隔离、许可和回退条件满足 | 模型网关、模型部署版本、质量评测和原/微调权重共存 |
| 图数据库 | PostgreSQL 边表/递归 CTE 经实测不达查询门槛 | 只读可重建投影，不反写领域事实 |
| 专用时序库/对象存储 | PostgreSQL 分区或本地目录在容量、恢复或运维门槛上实测失败 | 领域记录与工件引用不变，替换 adapter 不改调用方 |
| 高可用/冷备 | 甲方另行采购并明确可用性、恢复和运维责任 | 三 VM 职责、不可变版本、发布包、秘密和恢复证据；不得追溯改写历史 |
| 多项目、多 Worker、多模型槽 | 单项目单槽实测出现吞吐或隔离瓶颈 | 工程作用域、幂等、租约、任务预算和模块 interface 不变 |

## 11. 已识别的规划漂移与风险

- 早期宏观架构原型给出了更细的多包目录，后续工具链票已经固定三应用三共享包。本路线以后者为准，六个领域模块留在 `packages/core`。
- Demo 的 React/npm 版本与正式基线不一致。整体保留会制造第二套工具链，只能迁移视觉与页面内容。
- 早期存储规划提及 PITR/RPO/RTO；后续私有部署决策明确 MVP 不承诺生产级备份和灾备。本路线只验证同机逻辑恢复、投影重建、升级与回退。
- 质量评测中的数值门槛不能直接变成 Agent 清洗运行时的隐藏硬门禁。运行时由任务策略和确定性结构约束收口，离线评测另行判定质量。
- “重大风险必须复核”不能使用模型主观标签硬编码；识别阶段使用版本化强制复核策略，评估后重大等级按预警和处置治理工作。
- OpenSpec CLI 本身不原生强制 change DAG。依赖必须同时写入 proposal、路线 frontier 和 tracker；主 Agent 以已归档主 specs 为准。
- 当前存在用户的未提交规划改动。本路线只新增本工件并更新本票，不覆盖其它文件。

## 12. 确认结果

用户已确认全部 39 个 changes、依赖图、阶段门和编排协议。本路线从 C00 开始执行；后续路线级调整统一回写本工件并重算受影响依赖，不在单个 change 中临时绕过。
