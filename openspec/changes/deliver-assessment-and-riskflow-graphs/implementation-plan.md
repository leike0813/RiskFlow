## 1. 实施基线与权威来源

- 原实施基线 HEAD：`f8920b4254a4d638356678d5a6a82d801a86d6af`；本次重开规划输入 HEAD：`277b931d5e1381bfdd2252bb8ae603ab21fd46ec`；schema：`orchestrated-delivery`。原批准引用为 `approval://riskflow/C30/scope-2026-09-23-assessment-and-riskflow-graphs`，本次收窄批准引用为 `approval://riskflow/C30/finalization-2026-09-23-narrow-scope-and-archive`。实施前核对集成 HEAD 与迁移号；发生公共契约或计划文件漂移时升级。
- 规格：本 change 的 `specs/domain/module-interfaces-events-workflows/spec.md`；已归档 C03/C07/C24～C29、必要的 C11/C14/C18/C19 主规格；代码只说明现状。研究资料只用 `references/风险识别与评估规划事实源摘要.md`。
- 本 change 规划只闭合 `proposal`、`specs`、`design`、`implementation-plan`、`tasks`。实施按下列 IP-ID 交付；verification 由收尾角色在可运行证据齐备后创建。
- 批准范围 ① `assessmentGraph` 与父 `riskFlowGraph`：IP-01～IP-06、IP-09；② C30 自有页面/追踪投影：IP-04、IP-07、IP-08；③ 逐跳、可重放的耐久证据：IP-04、IP-07～IP-09；④ 受保护边界与不扩大范围：IP-01、IP-03、IP-07、IP-10。每项的允许文件和命令见 §3、§6、§7。

### 本次重开规划的逐项收窄

以下允许文件均在本 change 目录内；本轮只修改规划工件，`verification.md` 由后续 Finalizer 依批准记录更新。下列测试命令是当前可运行的回归或诊断入口，绿色结果仅证明对应已覆盖切片，不能当作转交场景通过。C40/C41 的实现文件、公共契约及成功验收命令由各自 change 规划，本 change 不代为设计。

| 批准项与当前结论 | 原 IP-ID / 后续归属 | 本轮允许文件 | 当前可运行命令与证据边界 |
| --- | --- | --- | --- |
| R2/S1 多风险父图扇出：真实 C24 同容器待复核中断破坏检查点，未闭合 | IP-03、IP-09、IP-10；C40 `fix-c24-nested-graph-interrupt-checkpoint-boundary` | `proposal.md`、`specs/domain/module-interfaces-events-workflows/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md`；Finalizer：`verification.md` | `pnpm exec vitest run apps/worker/test/risk-flow/composition.test.ts apps/worker/test/risk-flow/acceptance.test.ts`；受控端口/分段测试不能证明真实多风险扇出。真实 C24 诊断失败命令及 `graph-state-invalid` 见 `verification.md`。 |
| R6/S1 同容器逐跳全链：依赖真实 C24 与正式 C28 反馈，未闭合 | IP-03、IP-06、IP-09、IP-10；C40 + C41 `wire-human-decision-and-feedback-commands` | `proposal.md`、`specs/domain/module-interfaces-events-workflows/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md`；Finalizer：`verification.md` | `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts`；只覆盖当前分段耐久证据，不能认定完整 RI/RA 全链。 |
| `forecast-response` 成功路径：只有评估依据冻结/缺失门禁有证据，合法路由决定与其余精确引用输入未闭合 | R1/S5、R3/S4；IP-01、IP-02、IP-06、IP-10；C41 | `proposal.md`、`specs/domain/module-interfaces-events-workflows/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md`；Finalizer：`verification.md` | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/workflow/service.test.ts apps/worker/test/risk-flow/acceptance.test.ts`；证明依据解析和缺失时零副作用，不证明成功预测。 |
| `record-response-feedback` 成功路径：正式反馈命令输入与执行后评估绑定未闭合 | R1/S5、R3/S4；IP-01、IP-02、IP-06、IP-10；C41 | `proposal.md`、`specs/domain/module-interfaces-events-workflows/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md`；Finalizer：`verification.md` | `pnpm exec vitest run packages/core/test/workflow/service.test.ts apps/worker/test/risk-flow/acceptance.test.ts`；证明缺失依据门禁及已成立反馈后的尾链切片，不证明正式反馈入口成功。 |

本轮规划收口命令：`openspec status --change deliver-assessment-and-riskflow-graphs --json`、`openspec validate deliver-assessment-and-riskflow-graphs --strict --no-interactive`、`pnpm openspec:validate`。交接前检查 `tasks.md` 仍为 8/13，且 Finalizer 逐项将 `verification.md` 的 BLOCKED 原因标注 C40/C41；不得把文件存在或校验通过视作场景实现。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `StartWorkflowRunCommandV1Schema`、`WorkflowPortV1`、`ProjectionPortV1` | 只给现有评估入口增加设计 D-01 的可选传输字段，新增两项独立只读端口；C30 前置门禁要求完整引用 | 不增加能力、角色，不改旧签名/判别值 |
| IP-02 | `packages/contracts/src/workflows/index.ts` 的 `AssessmentGraphStateV1Schema`、`RiskFlowGraphStateV1Schema`、`AssessmentPreparationSnapshotV1Schema` | 图状态仍引用单一公共 Schema；C30 核心只定义本模块登记行/状态规则 | 不另造图状态、评估记录或领域枚举 |
| IP-03 | `packages/core/src/identification/graph/ports.ts` 的 `IdentificationGraphRuntimeV1`；`apps/worker/src/identification/graph/composition.ts` 的生产组合 | 传入真实父 run/ref 与 C11 准备，消费已验收精确记录 | 不修改 C24 I0～I9 或复制 C22 记录正文 |
| IP-04 | `packages/adapters/src/postgres/migrations/provider.ts` 的自动发现；C03 `TransactionUnitV1`、Outbox/审计/checkpointer | 单个 C30 自有迁移，领域登记与审计同事务，检查点只做恢复线索 | 不写其它 change 表、不把检查点当业务事实 |
| IP-05 | C11 `EngineeringDataPortV1.freeze`、C18 `AssessmentConfigurationResolverV1`、C19 `AssessmentBasisReleaseSetReaderV1`、C25 `RiskAssessmentPortV1.prepare/evaluate` | A0～A5 按精确输入与版本组合现有窄用例 | 不重算指标、P/C、矩阵、触发 |
| IP-06 | C26 `WarningLifecycleServiceV1.open`、C27 `RecommendationServiceV1`、C28 `ResponseLifecycleServiceV1`、C29 `CalibrationServiceV1` | A6～A9 与独立预测/执行后评估/反馈入口调用既有服务 | 不重算预警、处置三项约束或发布校准 |
| IP-07 | `packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts` 的 C22 自有标准化记录表及 `PostgresRiskCandidateFinalizationAdapter.readRecord`；C06 当前授权 | 在同一 C22 所有者模块增加专用只读适配器，批量返回来源段/工序/机理最小引用 | 不跨模块读其私表、不返回正文 |
| IP-08 | `ProjectionPortV1.query`、C07 `ReviewAuditPortV1.trace`、C30 自有登记/链边 | query 登记后经独立只读端口分页，来源最多一次批读 | 不做 C31 图/报告、C34 页面布局或全库投影 |
| IP-09 | `apps/worker/test/identification/graph/fixture.ts`、`packages/adapters/test/risk-assessment/fixture.ts` | 使用真实 PostgreSQL/检查点和合成、待甲方复核样本验证精确链 | 不以模型响应硬编码期望 |
| IP-10 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`、现有模块测试 | 用稳定行为和最小边界断言验证权限/回滚/兼容 | 不测试提示词、完整文案、内部节点顺序 |

## 3. 代码变更映射

下表保留原实施允许文件与 IP-ID 对照，用于解释已交付切片和未完成任务；本次重开规划的实际编辑范围仅为 §1 表列出的规划工件。转交 C40/C41 的行为不得再按下表在 C30 内实施。计划外公共契约、依赖、迁移、文件、权限或业务语义先升级，不自行扩表。

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | T1 | R1 全部；R5 S3 | 修改 `packages/contracts/src/ports/index.ts`：`StartWorkflowRunCommandV1Schema`、新 `RiskRecordTraceReadPortV1`、`ProjectionResultReadPortV1`；修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 落实 D-01/D-06 的 strict 输入输出、上限、闭合失败码、单数兼容；两个分段入口可选解析精确评估依据，缺少时由 C30 入口门禁拒绝；覆盖缺失/跨域输入和有界读契约 | 旧字段解析、旧端口签名、既有能力值 |
| IP-02 | T2 | R1 S5；R2 S1～S2；R4 S1～S3 | 新建 `packages/core/src/workflow/{schema,service,index}.ts`；修改 `packages/core/package.json`；新建 `packages/core/test/workflow/service.test.ts` | 定义只追加登记行与链接的类型化写端口、父子身份/状态版本/幂等规则、入口冻结门禁与对账；分段入口在父运行副作用前校验并冻结显式评估依据；导出 `./workflow` | 公共图状态 Schema、领域事实正文 |
| IP-03 | T3 | R2 S1～S2；R4 S1～S3 | 新建 `apps/worker/src/risk-flow/{graph,runtime,composition,index}.ts`；修改 `apps/worker/src/index.ts`；新建 `apps/worker/test/risk-flow/{runtime,composition}.test.ts` | 唯一父图组合 C24 子图与每条验收风险的独立评估子运行；消费事件、等待/恢复/取消、检查点对账 | C24 实现及事件语义 |
| IP-04 | T4 | R4 S1～S3；R5 S1～S3；R6 S1～S2 | 新建 `packages/adapters/src/postgres/migrations/workflow/deliver-assessment-and-riskflow-graphs/000050_assessment_riskflow_graphs.ts`、`packages/adapters/src/workflow/{postgres-workflow-adapter,index}.ts`；修改 `packages/adapters/package.json`、`packages/adapters/test/auth/fixture.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts`；新建 `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts` | 三张自有表、最小 SELECT/INSERT、唯一约束、事务审计/事件、重入/回滚/逆迁移、精确运行/链边/查询登记 | C03 迁移提供者、其它模块表及其历史 |
| IP-05 | T5 | R1 全部；R3 S1～S3 | 新建 `apps/worker/src/assessment/{graph,runtime,composition,index}.ts`；新建 `apps/worker/test/assessment/{runtime,composition}.test.ts` | A0～A5 冻结和 C25、A6～A9 C26/C27；对完整/缺失/多空间/多序列/历史时点及无预警/有预警进行路由验证 | C25 计算、C26 阈值、C27 三项规则 |
| IP-06 | T6 | R3 S2、S4；R6 S1～S2 | 同 IP-05 的 `apps/worker/src/assessment/{graph,runtime,composition}.ts` 与测试，及 IP-03 的 `apps/worker/src/risk-flow/{runtime,composition}.ts` 与测试 | 人工采纳后独立预测；执行后显式重评取得 C25 事实；正式反馈后偏差和待审核校准；无触发/不可计算时停在最后成立事实 | C28/C29 私有读接口、人工决定和发布权限 |
| IP-07 | T7 | R5 S1～S3；R6 S1 | 新建 `packages/adapters/src/identification/candidate-finalization/postgres-risk-record-trace-reader.ts`；修改 `packages/adapters/src/identification/candidate-finalization/index.ts`、`packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts` | C22 所有者为专用读适配器注入必需 C06 校验并实现 `readBatch`，单批 100、每条来源 256/机理 64、精确版本与当前工程/空间/资料授权 | C22 写适配器构造/写入/`readRecord` 签名、私有表跨模块暴露 |
| IP-08 | T8 | R5 S1～S3；R6 S1～S2 | 新建 `packages/adapters/src/workflow/postgres-workflow-projection.ts`、`packages/adapters/test/workflow/postgres-workflow-projection.test.ts`；修改 IP-04 的 `packages/adapters/src/workflow/index.ts`；修改 IP-03 的 `apps/worker/src/risk-flow/composition.ts` | 实现 `query` 登记和 `readPage` 的 100 项稳定游标、授权复验、批量来源补齐、失败原因及审计；仅从 C30 表和 C22 公开批读组装 | 其它领域私表、HTTP query 旧结果签名 |
| IP-09 | T9 | R2/R3/R4/R5/R6 全部关键链路 | 新建 `apps/worker/test/risk-flow/acceptance.test.ts`；复用既有 fixture（不修改） | 真实 PostgreSQL、C04、C03 checkpoint/Outbox、公开端口跑 RI-S1～S6 与 RA-S1～S7，全链/无尾/幂等/重放证据 | Mock 后端、未持久化的成功断言 |
| IP-10 | T10 | R1～R6 边界 | 上述各自测试文件；无独立生产文件 | 运行 §6 命令并记录输入、配置、工件、审计和事件 ref；静态检查文件边界 | 扩大角色、能力、依赖或 C31～C38 功能 |

R1～R6 是本 change delta spec 中按出现次序的六项 Requirement；S 编号是该项下 Scenario 的出现次序。IP-05/06/08 在同一生产文件内完成，不为每条验收场景另建模块。现有 `packages/contracts/src/workflows/index.ts` 只读复用，不修改。没有新依赖、C10/C14/C24～C29 生产文件修改、web 文件或 C31 投影文件。

## 4. 调用与副作用顺序

1. `WorkflowPortV1.startRun` 校验 strict 命令、C06 当前权限和所有必要精确引用；单数监测规范化为单项，多空间逐项核对。缺失/越界在正式准备、父子副作用前拒绝。
2. C30 事务登记父 run/输入/命令/审计后，C11 冻结识别或评估准备。`identify-and-assess` 把真实父 ref 交 C24；只消费其正式验收结果，逐风险版本登记一个评估子 run。无合格风险时登记等待/终态及原因。
3. 每个评估子 run 在同一冻结输入下依次用 C19/C18 与 C25；C25 成功后才由 C26 建预警。触发为空直接汇总；触发成立后 C27 建候选、完成三项校验后才记正式建议。跨模块仅以结果/事件精确 ref 衔接，C30 阶段登记与审计同事务。
4. 人工采纳命令已成立后，C30 登记路由和独立预测 run，再调 C28；执行命令由既有 C28 端口单独完成。执行后先建立新 C25 评估，正式反馈成立后另开有限偏差/校准 run。C29 只形成候选，发布由人工治理端口负责。
5. checkpoint 保存公共小状态；恢复先核对 C30 append-only 最新事实与各领域正式结果。能证明的已提交结果沿原身份续跑；不能证明或 checkpoint 虚指时安全失败。`cancelRun` 停未开始动作，已提交事实保留。
6. `ProjectionPortV1.query` 经当前授权登记精确目标和审计；独立 `ProjectionResultReadPortV1.readPage` 每页重验授权，从 C30 运行/链边分页，最多一批 C22 `RiskRecordTraceReadPortV1.readBatch` 补齐来源。无法证明任一链边时返回明确不完整失败，不生成占位链尾。

## 5. Schema、状态与持久化落实

- 公共 Schema 只在 IP-01 加字段/端口；类型均由 strict Zod 派生。设计 D-01 的 `assessmentContexts` 逐空间唯一；`reassess` 的旧记录相容性由 C25 `prepare` 核对，C30 不另读 C25 私表。
- IP-02 的内部状态规则从已有 `AssessmentGraphStateV1Schema`、`RiskFlowGraphStateV1Schema` 推导，不扩充第二套公共状态机。父/子 run、线程、入口、冻结输入、graph/policy/model/prompt/budget 及阶段 ref 在 C30 行中按精确版本登记。Agent 预算与 C08 输入保持已批准契约。
- IP-04 只建 `workflow_graph_results`、`workflow_graph_links`、`workflow_query_results`。迁移 `up` 可重入，`down` 逆序只删自有表；不设跨 change 外键，不改旧迁移。C03 与 C04 分别承载审计/事务/Outbox/检查点和受权正文；C30 行只存 ref、元数据与授权摘要。唯一键和状态版本阻断重复与同键异载荷；跨域引用经公开端口复验。
- IP-07/08 的只读结果只含版本 ref、允许披露的证据定位和有界摘要。每页最多 100，单批来源最多 100 条、每条最多 256 段/64 机理；游标绑定查询 ref、排序键和授权摘要。当前权限失效立即安全失败；无权与不存在同形。不存在静默截断或全库读取。
- 输出记录中标明业务时点、记录时点与持久化时点。C25 的 P/C、矩阵、权重、适用性快照由其唯一事实源保留，C30 链接只指向正式记录/证据；新发布版本不得重写旧链。

## 6. 验收证据矩阵

命令均在仓库根目录执行；`pnpm exec vitest run <路径>` 是现有 Vitest 入口，`pnpm typecheck` 等由根 `package.json` 提供。下表每个 Scenario 有稳定 IP-ID、测试文件、输入条件、调用方可见断言及可运行命令；具体 fixture 使用合成样本并标记“待甲方复核”，正式依据标版本。

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- | --- |
| R1/S1 历史完整输入 | IP-01,05,09 | `apps/worker/test/assessment/runtime.test.ts` | 历史时点、精确适用性/依据 | 新准备与记录，旧记录不变 | `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts` |
| R1/S2 单/多序列 | IP-01,05 | `apps/worker/test/assessment/runtime.test.ts` | 单数、多个正式序列 | 同等单项解析；多项逐序列冻结 | 同上 |
| R1/S3 缺失/错配 | IP-01,05,10 | `packages/contracts/test/module-interfaces-events-workflows.test.ts`；`apps/worker/test/assessment/runtime.test.ts` | 缺修订、冲突单数、跨工程/不可见 | 副作用前失败、不可枚举 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts apps/worker/test/assessment/runtime.test.ts` |
| R1/S4 多空间配对 | IP-01,03,05 | `apps/worker/test/risk-flow/runtime.test.ts` | 两空间各有适用性/监测，漏配对 | 各风险只用本空间；缺项阻断 | `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts` |
| R1/S5 分段入口冻结依据 | IP-01,02,06；成功路径 C41 | `packages/core/test/workflow/service.test.ts`；`apps/worker/test/risk-flow/acceptance.test.ts` | 预测/反馈携带或缺少精确依据集合 | C30 仅已证明解析/冻结依据和缺失时父运行零副作用；成功路径未闭合 | `pnpm exec vitest run packages/core/test/workflow/service.test.ts apps/worker/test/risk-flow/acceptance.test.ts` |
| R2/S1 多已验收风险 | IP-02,03,09；真实同容器 C40 | `apps/worker/test/risk-flow/acceptance.test.ts` | 多条已验收、一个待复核、重复事件 | 当前受控端口切片不能证明真实 C24 同容器子 run；检查点边界未闭合 | `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts` |
| R2/S2 无合格风险 | IP-02,03 | `apps/worker/test/risk-flow/runtime.test.ts` | 仅拒绝/待复核 | 真实终态/等待，无空评估 | `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts` |
| R3/S1 无预警 | IP-05,09 | `apps/worker/test/assessment/runtime.test.ts` | C25 完整记录、空触发 | 有记录，无预警/建议/Agent | `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts` |
| R3/S2 预警处置 | IP-05,06,09 | `apps/worker/test/risk-flow/acceptance.test.ts` | 正式触发、三项校验通过及失败 | 先预警后正式建议；失败只留候选 | `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts` |
| R3/S3 重评/补算 | IP-01,05,09 | `apps/worker/test/assessment/runtime.test.ts` | 改变输入与历史依据 | 新冻结记录，旧 P/C/审计未改 | `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts` |
| R3/S4 反馈越限 | IP-06,09；正式反馈入口 C41 | `apps/worker/test/risk-flow/acceptance.test.ts` | 正式执行后评估、反馈、越限偏差 | C30 已证明已成立反馈后的偏差/待审校准切片；正式反馈命令输入未闭合 | `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts` |
| R4/S1 等待恢复 | IP-02,03,04,10 | `apps/worker/test/risk-flow/runtime.test.ts` | 原线程/等待 ref、C03 checkpoint | 复用已提交结果，无重复副作用 | `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts` |
| R4/S2 checkpoint 不一致 | IP-02,03,04,10 | `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`；`apps/worker/test/risk-flow/runtime.test.ts` | 伪 ref、业务领先且无法证明 | 稳定失败，零补写 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts` |
| R4/S3 取消/技术失败 | IP-02,03,04 | `apps/worker/test/risk-flow/runtime.test.ts` | 部分提交、瞬态失败、规则冲突 | 历史可查，未开始动作停止，规则冲突不重试 | `pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts` |
| R5/S1 授权历史视图 | IP-04,07,08,09 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 冻结多版本父子 run 与授权来源 | 稳定分页、精确结论/审计/定位 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| R5/S2 越权不可枚举 | IP-07,08,10 | `packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`；`packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 撤权/跨工程/来源隐藏 | 同形失败，无受限信息 | `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| R5/S3 有界只读结果 | IP-01,07,08,10 | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` | 101 行、伪游标、超上限来源 | 稳定下一页或失败；无 N+1/全表读 | `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts` |
| R6/S1 全链耐久证据 | IP-03,04,05,06,07,08,09；C40/C41 | `apps/worker/test/risk-flow/acceptance.test.ts` | 真实 PG/C04/C03；合成输入、版本化规则 | C30 分段证据已成立；真实 C24 与正式反馈两段未闭合，不能报告完整逐跳链 | `pnpm exec vitest run apps/worker/test/risk-flow/acceptance.test.ts` |
| R6/S2 缺席链尾 | IP-05,06,08,09 | `apps/worker/test/risk-flow/acceptance.test.ts` | 无触发、三项失败、不可计算、Agent 失败 | 最后成立事实与类型化原因，无占位尾 | 同上 |

模块与迁移共用门禁：`pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`（迁移发现、重入、逆序、最小角色及审计事务）、`pnpm typecheck`、`pnpm lint`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm format:check`、`pnpm openspec:validate`。全链测试必须输出输入/配置版本、资料段、工序、机理、风险记录、评估、预警、建议、偏差/校准、各阶段/事件/审计 ref 和复现命令，形成 verification 的真实依据；任何链路未触发须保留类型化原因。

## 7. 文件清单与升级条件

§3 是原实施文件与 IP-ID 映射；本轮重开规划的允许文件以 §1 收窄表为准。新/改 OpenSpec 仅限本 change 的 `proposal.md`、`specs/domain/module-interfaces-events-workflows/spec.md`、`design.md`、`implementation-plan.md`、`tasks.md`，收尾后由验收角色补 `verification.md`。本规划不触及主规格、生产代码、测试、旧迁移、`pnpm-lock.yaml`、`config/orchestration`、AGENTS、C10/C14/C24～C29 生产文件及 C31～C38 文件。

若实作要求计划外公共 Schema/接口、跨所有权私表、额外迁移或依赖、角色/能力值、C24～C29 既有业务语义改动，或发现 §6 命令在当前项目工具链不存在，先向主调度升级并修订已批准工件。若 C22 自有批读仍无法证明资料段→工序→机理，必须记录无法闭合的跳和证据，不能把空摘要、Mock 或缩小范围当作完成。并行集成占用 `000049` 时升级迁移号，不直接覆盖。

## 8. 验收 Agent 授权与限定审计

验收 Agent 以本 change 批准范围、§6 可运行证据、代码及已归档主规格核验；可在当前 Task 内修复已批准范围的普通缺陷并回归，再写 verification。只有公共契约、权限、持久化、迁移、依赖或范围决定发生变化时升级。若触发限定审计，同一收尾轮次最多一次；审计 Agent 在自己的活动 Task 内修复普通缺陷并补入同一 verification。最终归档/提交由主调度按授权另行执行。
