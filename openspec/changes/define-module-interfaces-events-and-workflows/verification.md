# Verification Report: define-module-interfaces-events-and-workflows

验证日期：2026-08-31  
固定 implementation checkpoint：`43942dc25db7f4bf7fa55b46ef419a6050011f5e`

## 结论

**不通过。当前 checkpoint 不可归档，也不应开放 G1。**

| 维度 | 结果 |
| --- | --- |
| 完整性 | `11/12` tasks 已勾选；本报告对应的 7.2 尚未由主 Agent验收并勾选；1.1 虽已勾选，但测试未覆盖其声明的结果/capability/A 阶段验收面 |
| 正确性 | 11 条 requirements 中 3 条完整满足、8 条存在阻断缺陷；8/8 现有测试通过，但反例探针证明公共 Schema 有未覆盖的运行时崩溃和错误接受/拒绝 |
| 一致性 | 文件范围、依赖方向、Non-Goals、十个事件和三个子路径基本遵守 design；授权、结果联合、RA-S1、状态机、Agent/复核与顶层子运行引用偏离 design/spec |

验收时已通读两份专利事实源、研究方案、proposal、delta spec、design、tasks、C01 公共契约、C02 三个生产文件及单一测试文件。两份 DOCX 使用 MinerU `pipeline` 精确提取到工作区外的临时目录；未向仓库写入转换产物。

## CRITICAL（归档前必须修复）

### C1. `decide-review` 公共 Schema 在运行时直接抛异常

- `packages/contracts/src/ports/index.ts:1241-1279` 将四组 decision options 展开到同一个 `z.discriminatedUnion("kind", ...)`；多个组重复使用 `reject`、`return-upstream`。
- 首次调用 `ReviewDecisionCommandV1Schema.safeParse(...)` 会抛出 `Error: Duplicate discriminator value "reject"`，没有返回 `success: false`，因此 `ReviewAuditPortV1.decideReview`（`packages/contracts/src/ports/index.ts:1654-1657`）不可安全使用。
- `packages/contracts/test/module-interfaces-events-workflows.test.ts:3-46` 未导入 `ReviewDecisionCommandV1Schema`，domain cases 在 `:533-549` 只覆盖 `request-review` 和 `trace`，现有 8 个测试无法发现该崩溃。
- 这同时违反 spec 的“调用所属模块完成用例”“复核决定针对精确版本”和“陈旧复核决定被拒绝”。

建议：先以 `reviewType`/subject 构造外层闭合联合，再在各 subject 内定义 decision 联合；补充所有 subject/decision 的参数化解析，以及错误 subject + decision 配对反例。

### C2. 多个方法级成功结果无法表达 design 已声明的分支结果

以下不是缺测试导致的推测，运行时 `safeParse` 已证明期望结果被拒绝：

| 调用分支 | design 结果 | 当前 Schema | 反例结果 |
| --- | --- | --- | --- |
| Engineering `register-monitoring-batch` | `MonitoringBatchRefV1`（`design.md:188`） | `EngineeringDataApplySuccessV1Schema` 只接受 source delivery + source version（`packages/contracts/src/ports/index.ts:1322-1325`） | `{ monitoringBatchRef }` 被拒绝 |
| Engineering `register-external-risk-event` | `ExternalRiskEventRefV1`（`design.md:189`） | 同上 | `{ externalRiskEventRef }` 被拒绝 |
| Knowledge `assessment-basis` | `AssessmentBasisReleaseSetRefV1`（`design.md:209`） | `KnowledgeResolutionSuccessV1Schema` 只接受识别侧四个 release/policy refs（`packages/contracts/src/ports/index.ts:1360-1365`） | assessment basis 结果被拒绝 |
| Identification `repair-and-validate` | `ValidatedCandidateSetRefV1`（`design.md:228`） | `IdentificationAnalysisSuccessV1Schema` 只接受 context + candidate（`packages/contracts/src/ports/index.ts:1378-1381`） | validation 结果被拒绝 |
| Warning `calculate-deviation` | deviation ref 或显式 unavailable（`design.md:265`） | `WarningResponseRecordSuccessV1Schema` 没有 unavailable 分支（`packages/contracts/src/ports/index.ts:1434-1444`） | unavailable 结果被拒绝 |

`packages/contracts/test/module-interfaces-events-workflows.test.ts:213-553` 只解析命令/查询输入，没有导入任何方法成功/结果 Schema，因而 task 1.1/2.2 声称的“全部分支及类型化结果”未被验收。

建议：按 command/query kind 定义闭合成功结果联合，使每个方法的每个分支只能返回自己的精确引用；参数化覆盖输入 kind → 成功结果 kind/ref 的完整映射。

### C3. 授权快照的强制因果与边界一致性没有落实

- `AuthorizationContextV1Schema.causalRunRef` 对所有 invocation 均为 optional（`packages/contracts/src/ports/index.ts:449-460`），但 `design.md:113` 要求 system、Agent 和下游编排必须提供。运行时反例证明 system/agent invocation 缺少 `causalRunRef` 仍被接受。
- `commandSchema`/`querySchema` 同时接受信封与 authorization 内的 `actorId/projectId`，却未校验相等（`packages/contracts/src/ports/index.ts:564-580`）；跨工程或主体不一致的输入会通过 Schema。
- 代码没有公开“branch → required capability”映射；测试仅在 `packages/contracts/test/module-interfaces-events-workflows.test.ts:205-210` 验证一个 capability 字面量，并给所有命令共用一份包含全部 capability 的 authorization（`:104-144`），没有验证任一 port 分支的 required capability，也没有验证权限收窄。
- 因此 spec `:47-63` 的三个授权 scenarios 均缺少可执行契约证据。

建议：用 invocation 可辨识联合约束 causal run；在具体 command/query Schema 上校验 actor/project 一致性；增加唯一的 branch/capability SSOT 并用表格驱动验证所有九个 port 分支。

### C4. RA-S1 必含适用性元数据快照被设为可选

- 专利与项目契约要求评估绑定施工工法、地层条件、工程阶段，并保存适用性元数据快照；delta spec `:131-135` 要求 A0～A9 完整追踪 RA-S1～RA-S7。
- `assessment-preparation` 把 `applicabilityMetadataSnapshotRef` 设为 optional（`packages/contracts/src/ports/index.ts:650-656`）。
- `assess` 入口同样设为 optional（`packages/contracts/src/ports/index.ts:1062-1069`）。
- `AssessmentPreparationSnapshotV1Schema` 再次设为 optional（`packages/contracts/src/workflows/index.ts:116-132`）。
- 测试明确把缺少该引用的 command 和 snapshot 当作合法正例（`packages/contracts/test/module-interfaces-events-workflows.test.ts:260-265`、`:1091-1109`）。

建议：在 assessment preparation command、`assess`/相关入口和冻结 snapshot 中统一要求精确 `ApplicabilityMetadataSnapshotRefV1`；只允许 monitoring snapshot optional。

### C5. waiting 状态没有类型化等待原因，I1/A1 还能形成“既非 ready 也非 waiting”的空结果

- `lifecycleStateRefine` 仅禁止 waiting 携带 result，没有要求 waiting reason（`packages/contracts/src/workflows/index.ts:385-420`）。
- `IdentificationGraphStateV1Schema` 与 `AssessmentGraphStateV1Schema` 没有 `waitingRef(s)` 字段（`:422-488`）。运行时反例中 `status: "waiting"`、没有 knowledge/review/user-confirmation 引用仍通过。
- 顶层状态虽有 `waitingRefs`（`:498-515`），但 waiting 时不要求非空。
- I1 的 ready、knowledge task 都是 optional（`:252-258`），A1 亦然（`:324-330`）；运行时反例证明两者都能在没有 ready ref、没有 knowledge task、空 review tasks 时通过。
- 这违反 spec `:116-119`、`:175-187` 及 design `:571-579` 的暂停、恢复和原冻结版本语义。

建议：把 lifecycle 建模为按 status 判别的闭合联合，waiting 必须携带且只携带 `WaitingRefV1`；把 I1/A1 建模为 `ready | waiting` 的嵌套闭合联合，禁止空中间态。

### C6. 顶层图保存的是“结果引用”，不是 design 要求的“子运行引用”

- design `:551-565` 要求 `riskFlowGraph` 组合独立 identification/assessment runs，顶层只关联一个识别子运行和多个评估子运行。
- 当前 `RiskFlowGraphStateV1Schema` 的 `identificationRunRef` 使用 `IdentificationRunResultRefV1Schema`，`assessmentRunRefs` 使用 `AssessmentRunResultRefV1Schema`（`packages/contracts/src/workflows/index.ts:498-515`）。
- 运行时反例证明真实 `WorkflowRunRefV1` 子运行引用被拒绝。结果引用不能标识仍在 running/waiting 的子运行，也不能承担恢复/取消路由。
- 测试 `packages/contracts/test/module-interfaces-events-workflows.test.ts:1025-1040` 固化了错误的 result-ref 形状。

建议：顶层改用 `WorkflowRunRefV1Schema` 关联子运行，结果继续只放 `resultRef`；同步核对事件中的 `identificationRunRef`/`assessmentRunRef`（`packages/contracts/src/events/index.ts:93-98`、`:113-119`），避免同名字段携带 run-result。

### C7. Agent 结果与人工复核 subject/decision 边界不是闭合契约

- `AgentTaskResultRefV1Schema` 把 increment/candidate/validation/error/formal result 全部设为独立 optional（`packages/contracts/src/ports/index.ts:551-561`），没有按 status/taskType 约束合法组合。运行时反例证明 `status: "completed"` 且没有任何产物/正式结果仍通过。
- 即使修复 C1 的重复 discriminator，当前 `ReviewDecisionCommandV1Schema` 也没有把 `reviewTaskRef.reviewType`、`targetRef.kind` 与 decision family 关联（`packages/contracts/src/ports/index.ts:1274-1308`），无法阻止 knowledge review 使用 identification decision。
- 这违反 spec `:194-211` 和 design `:72-86`、`:270-287`。

建议：Agent result 以 status 再按 taskType/产物类别形成闭合联合；复核命令以 subject 为外层 discriminator，并校验 task/target/decision 同属该 subject。

### C8. graph state 与公共引用没有完全遵守 Zod SSOT

- `AssessmentGraphStateV1Schema.responseRecommendationRef` 在 `packages/contracts/src/workflows/index.ts:470-475` 手写了与 `ResponseRecommendationRefV1Schema` 相同的对象，而文件已在 `:49` 导入该命名 Schema。
- delta spec `:213-220` 要求公共 DTO 复用唯一 Schema，不存在并行手写 DTO；此处会让未来引用演进产生漂移。

建议：直接复用 `ResponseRecommendationRefV1Schema`；增加一个静态/运行时契约用例，证明 graph state 使用公开命名引用而非复制形状。

## WARNING（修复 CRITICAL 时一并处理）

### W1. A0～A9 的测试只检查枚举，没有解析 `AssessmentStageResultV1Schema`

- `packages/contracts/test/module-interfaces-events-workflows.test.ts:917-947` 为识别阶段逐项解析 stage result，但评估阶段只调用 `AssessmentStageV1Schema.safeParse(stage)`。
- 测试甚至没有导入 `AssessmentStageResultV1Schema`（`:49-60`）。task 1.1/4.1 所称“两个 stage result 可辨识联合、I/A 各恰好覆盖一次”只有识别侧成立。

建议：像 I0～I9 一样为 A0～A9（含 A8 两个 resultKind）逐项解析，并增加 A3～A6 不允许 Agent 正文/任务字段、A6 空/非空触发、A8 互斥的反例。

### W2. `AssessmentStageResultV1Schema` 使用普通 `z.union`

- `packages/contracts/src/workflows/index.ts:318-382` 使用 `z.union`，而 task 4.1 与 design `:500-515` 要求可辨识联合。
- A8 有两个相同 `stage`，可用 `stage` 外层 + A8 `resultKind` 内层建模，既保留闭合分支，也避免普通 union 的模糊错误定位。

### W3. 子路径导入命令依赖 cwd，但 tasks 未注明

- 从仓库根运行 task 5.1 写明的 `node --input-type=module -e 'import("@riskflow/contracts/...")'` 会报 `ERR_MODULE_NOT_FOUND`。
- 在 `packages/contracts` 目录运行同一命令通过，三个 exports 本身正确（`packages/contracts/package.json:26-37`）。

建议：tasks/后续运行手册明确该命令的 cwd，或使用不依赖 cwd 的 workspace 执行形式。此项不要求修改当前生产代码。

## Requirement 逐条核对

| # | Requirement | 结果 | 精确证据 |
| --- | --- | --- | --- |
| 1 | 六个领域模块只暴露用例级 interface | **FAIL** | 九个 interface 已存在（`packages/contracts/src/ports/index.ts:1623-1677`），但 C1/C2 使复核入口崩溃且多个领域分支无法返回其声明结果 |
| 2 | 应用模块只能组合领域 interface | **PASS** | Agent/Workflow/Projection 仅传命名引用（`packages/contracts/src/ports/index.ts:988-1239,1460-1505,1660-1677`）；无数据库、文件、LangGraph 或 adapter 导入 |
| 3 | 每次跨模块调用携带冻结授权上下文 | **FAIL** | C3：system/Agent 可无 causal run，actor/project 不一致可通过，无分支 capability SSOT |
| 4 | 命令、结果和错误具有稳定幂等语义 | **PASS（契约层）** | 写命令复用 command/idempotency 字段（`:564-569`），八类错误闭合（`:477-549`）；行为实现按 Non-Goal 留给领域模块/C03 |
| 5 | 已入库事实通过事务领域事件衔接 | **PASS（契约层）** | 元数据及十事件闭合（`packages/contracts/src/events/index.ts:36-162`），现有十事件测试通过；原子提交/至少一次消费是 C03 后续证明项 |
| 6 | 识别工作流具有 I0 至 I9 的版本化阶段契约 | **FAIL** | I0～I9 分支存在（`packages/contracts/src/workflows/index.ts:211-310`），但 I1 空状态、C2 repair 结果、C5 waiting 语义不满足 |
| 7 | 评估工作流具有 A0 至 A9 的版本化阶段契约 | **FAIL** | A0～A9 结构存在（`:225-237,318-383`），但 C4 RA-S1 快照可缺失、A1 空状态，且测试未解析 A stage results |
| 8 | 图状态只保存小型版本化引用 | **FAIL** | strict Schema 与大对象拒绝成立（`:422-525`；测试 `:967-1046`），但 C6 用结果 ref 冒充子运行，C8 复制命名引用 |
| 9 | 暂停、恢复、重试和取消保持业务事实完整 | **FAIL** | start/resume/cancel 输入闭合（`packages/contracts/src/ports/index.ts:988-1132`），但 C5 允许无 waiting reason 的等待状态，状态联合不完整 |
| 10 | Agent 与人工复核使用不同引用和决定边界 | **FAIL** | 引用类型分开（`:295-316`），但 C1/C7 导致决定入口崩溃、Agent result 开放组合、subject/decision 无关联 |
| 11 | 公共契约保持 Zod SSOT 和完整追踪 | **FAIL** | 子路径与依赖方向通过；C4/C6/C8 造成 RA-S1、子运行与引用 SSOT 断点 |

## 六领域与三应用 ports

| Port | 方法面 | 结论 |
| --- | --- | --- |
| `EngineeringDataPortV1` | apply/freeze/read | **FAIL**：monitoring/external apply 结果无法表达；RA-S1 metadata 可缺失 |
| `KnowledgeModelingPortV1` | govern/resolve/retrieve | **FAIL**：assessment-basis resolve 结果无法表达 |
| `RiskIdentificationPortV1` | plan/analyze/finalize | **FAIL**：repair-and-validate 结果无法表达 |
| `RiskAssessmentPortV1` | prepare/evaluate | **PASS（自身方法面）**：evaluate 固定三引用（`packages/contracts/src/ports/index.ts:1402-1412`）；上游 RA-S1/knowledge 仍阻断端到端 |
| `WarningResponsePortV1` | open/recommend/record | **FAIL**：calculate-deviation 缺显式 unavailable 结果 |
| `ReviewAuditPortV1` | requestReview/decideReview/trace | **FAIL**：decideReview 解析抛异常 |
| `AgentTaskPortV1` | start/resume/cancel/confirm | **FAIL**：Agent result 合法组合未闭合 |
| `WorkflowPortV1` | start/resume/cancel | **FAIL**：调用 DTO 闭合，但 graph waiting/child-run 契约错误 |
| `ProjectionPortV1` | query/subscribe/export | **PASS**：只返回 query/event/export refs，无反写命令 |

## RI-S1～RI-S6 与 RA-S1～RA-S7 追踪

| 追踪 | interface / DTO / 事件证据 | 结果 |
| --- | --- | --- |
| RI-S1 | Engineering apply/freeze/read（`ports/index.ts:611-688`）→ I0（`workflows/index.ts:245-251`）→ `engineering.inputs-ready.v1`（`events/index.ts:56-67,91`） | **PASS** |
| RI-S2 | identification preparation snapshot 保留 source/segment/policy/tool/model refs（`workflows/index.ts:73-89`）；strict graph 拒绝 JSON-LD/正文 | **PASS（契约层）** |
| RI-S3 | Knowledge resolve + Identification plan（`ports/index.ts:750-766,795-801`）→ I1/I2（`workflows/index.ts:252-265`） | **PASS** |
| RI-S4 | Knowledge resolve/retrieve（`ports/index.ts:750-793`）→ process/mechanism/evidence refs（`workflows/index.ts:94-113`）→ I1/I3 | **PASS** |
| RI-S5 | retrieve/analyze/Agent refs → I3～I5（`workflows/index.ts:266-285`） | **PARTIAL**：repair result 不可表达，I1/I3 终态约束不足 |
| RI-S6 | finalize（`ports/index.ts:825-853`）→ I6～I9（`workflows/index.ts:286-309`）→ accepted event（`events/index.ts:92-99`） | **PASS（需随 C6 核对 run ref）** |
| RA-S1 | Engineering freeze + risk input XOR → A0/A2 | **FAIL**：C4 允许缺少必含 applicability metadata snapshot |
| RA-S2 | knowledge definition values（`ports/index.ts:690-709`）与 assessment input 冻结版本（`workflows/index.ts:135-165`） | **PASS** |
| RA-S3 | Knowledge govern + Agent + Review | **FAIL**：C1 使复核决定不可解析 |
| RA-S4 | Knowledge resolve/Assessment prepare → A1/A2 | **FAIL**：assessment-basis success 结果不可表达，A1 可为空 |
| RA-S5 | Assessment evaluate → A3/A4/A5（`ports/index.ts:889-895,1407-1412`; `workflows/index.ts:336-350`） | **PASS** |
| RA-S6 | Assessment decision → warning open → A4～A6，warning 事件先引用已入库 assessment record（`events/index.ts:113-128`） | **PASS（契约层）** |
| RA-S7 | recommend/record + forecast/feedback entry（`ports/index.ts:909-986,1090-1102`; `workflows/index.ts:167-209,358-381`） | **FAIL**：deviation unavailable 结果缺失，Agent/复核边界不闭合 |

完整追踪结果：8/13 为完整契约映射，5/13 存在断点。识别通过 `StandardizedRiskRecordRefV1` 精确版本进入评估的 XOR 联合正确（`packages/contracts/src/ports/index.ts:318-322`），预警/处置入口均引用 `RiskAssessmentRecordRefV1`，未发现绕过评估记录的正文旁路。

## 事务事件、幂等、错误与审计

- **通过：** `DomainEventMetadataV1Schema` 固定 schema/event 版本、project、aggregate、双时间、causation/correlation、producer command、idempotency、authorization 和 audit refs（`packages/contracts/src/events/index.ts:36-50`）。
- **通过：** 十个 eventType 均为 strict 引用 payload；测试逐项解析并拒绝业务正文/未知字段（`packages/contracts/test/module-interfaces-events-workflows.test.ts:801-915`）。
- **通过：** 八类错误代码、category、retryable 与精确诊断引用闭合（`packages/contracts/src/ports/index.ts:477-549`）；测试不匹配完整文案（`packages/contracts/test/module-interfaces-events-workflows.test.ts:679-777`）。
- **通过（契约层）：** commandId/idempotencyKey 固定，`IDEMPOTENCY_CONFLICT` 携带原 command；未新增开放 `details`。
- **后续证据边界：** 事实 + audit + Outbox 的真实原子提交、consumer `(eventId, consumerName)` 去重与失败回滚由 design 明确分配给 C03（`design.md:456-460,587-599`），C02 没有也不应伪造运行时证明。

## 依赖方向、文件范围与 Non-Goals

以下检查通过：

- checkpoint 只改动本 change 的 `tasks.md`、三个 C02 生产文件、单一测试和 `packages/contracts/package.json`；未修改 C01 vocabulary/common/records、根 barrel、主 specs、config、依赖或锁文件。
- `ports` 只依赖 C01 common/records；`events`、`workflows` 只依赖 common + ports，二者互不依赖；没有 contracts → core/adapters/apps/LangGraph/基础设施反向边。
- `pnpm deps:check` 报告 20 modules / 27 dependencies，无违规；`pnpm deps:policy` 为 `OK`。
- 没有新增领域逻辑、数据库、Outbox、broker、checkpointer、HTTP/SSE、Agent runtime/tool loop、LangGraph 节点/边、查询实现、adapter、通知、图数据库或开发服务器。
- 没有 `Record<string, unknown>`、开放 `z.unknown()` payload、`.passthrough()`、JSON Patch、通用 `execute` 或业务正文进入 C02 生产 DTO。
- package 只增加 `./ports`、`./events`、`./workflows` 三个 exports（`packages/contracts/package.json:26-37`），未改变依赖、版本、scripts 或既有 exports。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `git rev-parse HEAD` | `43942dc25db7f4bf7fa55b46ef419a6050011f5e` |
| `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` | PASS |
| `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` | PASS：1 file，8 tests |
| `pnpm exec eslint packages/contracts/src/ports packages/contracts/src/events packages/contracts/src/workflows packages/contracts/test/module-interfaces-events-workflows.test.ts` | PASS |
| `pnpm exec prettier --check packages/contracts/src/ports packages/contracts/src/events packages/contracts/src/workflows packages/contracts/test/module-interfaces-events-workflows.test.ts packages/contracts/package.json` | PASS |
| `pnpm deps:check` | PASS：无 dependency violations |
| `pnpm deps:policy` | PASS：`dependency policy: OK` |
| `git diff 43942dc^ 43942dc --check` | PASS |
| `openspec validate define-module-interfaces-events-and-workflows --strict --no-interactive` | PASS |
| 在 `packages/contracts` 执行三个公开子路径动态 import | PASS |
| 从仓库根执行 tasks 5.1 原命令 | FAIL：`ERR_MODULE_NOT_FOUND`；见 W3 |
| 独立 Node 运行时反例探针 | FAIL：C1 抛 duplicate discriminator；C2/C4/C5/C6/C7 的错误接受/拒绝均可复现 |

未运行根 `pnpm verify`：C02 局部静态验证已完成，且已出现公共契约语义 CRITICAL；此时重复执行无关应用构建不会改变验收结论。未启动开发服务器。

## 最终判定

发现 **8 个 CRITICAL** 与 **3 个 WARNING**。按 handbook `:118-128` 与 `:243-254`，本 checkpoint 必须退回代码执行 Agent在同一 change 内修复，并形成新的 implementation checkpoint；本报告对任何新 checkpoint 自动失效，须重新独立验证。

本验证没有修改生产代码、测试、proposal/spec/design/tasks、主 specs、依赖或锁文件，没有提交、归档、派发下游任务或启动服务。主 Agent验收本报告后再决定任务状态；当前不得归档。
