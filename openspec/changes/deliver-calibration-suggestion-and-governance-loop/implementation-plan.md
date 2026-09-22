# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`15ddd1ad40782574fb67351a68955fcc852762a8`。Implementation 开始时先运行 `git rev-parse HEAD`、`git status --short`；HEAD 漂移、计划文件与现有用户改动重叠时停止并升级。
- change：`deliver-calibration-suggestion-and-governance-loop`；实际 schema：`orchestrated-delivery`；apply 前置为 `proposal`、`specs`、`design`、`implementation-plan`、`tasks`。Implementation 必须完整读取 `openspec instructions apply --change deliver-calibration-suggestion-and-governance-loop --json` 返回的全部 `contextFiles`。
- 领域权威：本 change 的三份 delta specs 与 D-01～D-12；C28 `ResponseDeviationFactReaderV1`/`ResponseDeviationFactV1Schema`；C08 `calibration-suggestion` 任务契约；C07 复核状态与决定；C16 `KnowledgeModelingPortV1.govern`；C18/C19 配置文档 Schema 与 `AssessmentBasisReleaseSetReaderV1`；C03 事务/回执/Outbox；C06 当前授权。
- 研究输入只允许 `references/风险识别与评估规划事实源摘要.md`。不得读取或转换其它研究原件。
- 已批准边界：只允许向 C07 增加校准批准证明的窄化公共查询和向 C08 增加模块内精确结果读取；不改变现有命令/端口方法签名，不增加角色、能力或权限枚举。无新依赖、无 apps 接线、无发布/回滚、无 verification 工件。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/core/src/response-lifecycle/service.ts::ResponseDeviationFactReaderV1`；`schema.ts::ResponseDeviationFactV1Schema` | 只按当前授权和精确 ref 读取 C28 事实，校验超限与链路后派生稳定身份 | 不复制 C28 表、公式、阈值判断或改读 latest |
| IP-02 | `packages/contracts/src/ports/index.ts::KnowledgeRevisionApprovalProof*`、`ReviewAuditPortV1` | 按既有证明查询的 strict envelope、闭合结果和错误形状增加独立 `CalibrationSuggestionApprovalProofPortV1` | 不做通用 approval API，不改变现有端口/方法或权限值 |
| IP-03 | `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts::verifyKnowledgeRevisionApproval` | 复用授权先行、工程限定、决定/任务一致性与只读路径，实现校准批准证明 | 不从 C29 直读 C07 表，不返回决定/证据正文 |
| IP-04 | `packages/core/src/agent-runtime/runtime.ts`；`packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` | 增加 C08 自有的精确结果窄读，供 C29 获取冻结输入、真实 parent run、结果工件、预算和候选版本 | 不建立 C29 Agent 状态机，不公开列表/latest，不复制任务行 |
| IP-05 | C18 `WeightEntryV1Schema`、`RiskMatrixBandV1Schema`、阈值/偏差策略项目 Schema 与完整 Document Schema；C19 `StructuredScoringRuleDocumentV1Schema` | 直接组成类型化 replacement，应用后重新 parse 完整文档并计算 canonical digest | 不手写第二套配置字段，不允许 JSON Patch/自由路径/整对象增量 |
| IP-06 | `AssessmentBasisReleaseSetReaderV1`、`ArtifactStoreV1`、C25 冻结输入 | 精确解析评估依据成员、目标 release、基准工件与摘要 | 不查询当前发布/latest，不推断未冻结目标 |
| IP-07 | `AgentTaskPortV1`、`ReviewAuditPortV1.requestReview`、`WarningResponseRecordCommandV1Schema` | 供 C30 以任务定义启动/恢复 C08，C29 使用派生建议 ref 请求 C07 并消费既有 calibration 命令 | 不新建任务/复核/record 公共 DTO，不由 C29 生成 workflow run |
| IP-08 | `TransactionUnitV1`、命令回执、audit writer、`warning.calibration-suggestion-created.v1` | 以 C03 事务原子保存 C29 自有事实、回执、审计和现有事件 | 不更改事件 payload，不宣称跨 C07/C16 分布式原子性 |
| IP-09 | `KnowledgeModelingPortV1.govern` 的 `submit-revision`；C04 内容寻址工件 | 证明有效后保存完整候选工件并以精确 base release 创建一项未发布修订 | 不调用 request-review/publish/deactivate/rollback，不改 C16 表 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 建纵向 fixture 与基线硬门 | 全部 Requirement；权限、版本、事务前置 | 新增 `packages/adapters/test/calibration/fixture.ts` | 启动真实 PostgreSQL，运行 C03/C06/C07/C08/C16/C18/C19/C28 与 C29 migration；准备双工程/双空间、已越限/未越限事实、冻结 basis、六类目标、C07 三类决定、失败注入 | 不 seed 正式默认校准规则，不伪造批准证明或公共偏差 |
| IP-02 | 加法式公共批准证明契约 | “系统必须提供校准建议草案创建批准证明只读接缝”的全部 Scenario；“专用只读端口加法式暴露校准批准证明”的全部 Scenario | 修改 `packages/contracts/src/ports/index.ts`：新增 `CalibrationSuggestionApprovalProofQueryV1Schema`、`CalibrationSuggestionApprovalProofV1Schema`、result、branch mapping、独立 `CalibrationSuggestionApprovalProofPortV1`；修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 查询 envelope 复用 querySchema，分支映射 `review-audit.read`；approved 只含 suggestion/task/decision/decidedAt，not-approved 原因闭合；strict 拒绝契约外字段，并以类型 fixture 证明 `ReviewAuditPortV1` 无变化 | 不改既有 schemas/端口/方法/结果/事件签名，不增加 capability/role/permission enum |
| IP-03 | C07 证明只读实现 | 同 IP-02；“无证明拒绝创建草案” | 修改 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts::PostgresReviewAuditAdapter` 使其额外实现专用 proof port；修改 `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` | 授权先行；按 project + decision ref 读取；核对 reviewType、target、decided、stored decision ref、`approve-draft-creation`；跨工程与不存在同结果；证明查询零 C07 写副作用 | 不直读其它模块、不写拒绝审计/业务审计/回执/事件，不放宽知识修订证明 |
| IP-04 | C08 精确结果窄读 | “校准 Agent 只产生受冻结依据约束的类型化操作”的任务绑定/失败场景；“校准闭环保持权限、审计和重放边界” | 修改 `packages/core/src/agent-runtime/runtime.ts` 新增 `AgentTaskCompletedResultRead*` strict 私有 DTO/reader；修改 `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 实现；修改 `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` | 按 project、task ref、result ref、expected task type 与当前授权读取完成结果的 frozenInputRef/parentRunRef/result artifact/usage/actions/candidate version；授权先于存在性；只接受 completed 且 refs 一致 | 不修改 `AgentTaskPortV1`，不读思维链，不提供列表/latest，不扩大冻结授权 |
| IP-05 | 私有 Schema、稳定身份、任务定义与类型化操作纯函数 | “校准入口…”三个 Scenario；“校准 Agent…”三个 Scenario；“第三方按精确引用重放校准” | 新增 `packages/core/src/calibration/schema.ts`、`service.ts`：`CalibrationInputSnapshotV1Schema`、`CalibrationOperationV1Schema`、`CalibrationCandidateV1Schema`、`createCalibrationSuggestionTaskDefinition`、`deriveDeviationRecordRef`、`deriveCalibrationSuggestionRef`、`validateCalibrationCandidate`、`applyCalibrationOperations` | 只允许 D-03 六种定义和 D-04 六类操作；复用 C18/C19 item/document Schema；稳定排序、精确 selector、权重/区间/单位/阈值/证据检查、完整文档 parse 与 canonical digest；任务定义固定 input/tool/budget/result；未越限返回不适用 | 不接受整对象操作、JSON Patch、自由路径、NaN/Infinity、跨定义操作或 latest |
| IP-06 | 精确上下文、冻结输入与候选收口 | “校准入口…”全部；“校准 Agent…”全部；“授权收窄阻断后续阶段” | 新增 `packages/adapters/src/calibration/postgres-calibration-adapter.ts::PostgresCalibrationContextReader`、`PostgresCalibrationAdapter.prepareInput/createSuggestion` | prepareInput 依序复验 C06 → C28 fact → C25/C19 basis → C04 target artifact 并保存冻结输入工件；createSuggestion 经 IP-04 从公共 result ref 读取真实 task/frozen input/parent run，调用 IP-05 收口；可修复错误只沿原 task/budget 返回，非修复错误关闭 | 不在 C29 启动 workflow run，不读其它研究资料，不改上游事实，不扩预算/换模型/换版本/使用基线冒充 |
| IP-07 | 创建建议、复核与 pending 公共记录 | “校准建议与公共偏差记录以真实引用原子成立”的全部 Scenario | `packages/adapters/src/calibration/postgres-calibration-adapter.ts::createSuggestion`；迁移表见 IP-10 | 派生 suggestion ref 后以源任务真实 parentRunRef 和确定性键调用 C07 requestReview；C29 事务插入 suggestion、完整 `DeviationRecordSchema` pending 版本、review linkage、receipt、audit、现有 Outbox；同键重放和并发返回同一结果 | 不伪造 run/ref、不写占位 recommendation、不扩大事件、不把孤立 C07 task 当成功 |
| IP-08 | 收口 reject/return/approve 决定 | “人工复核决定只推进对应建议版本”的全部 Scenario；“校准草案继续受既有知识治理约束”的历史不变 Scenario | `packages/core/src/calibration/service.ts::recordReviewOutcome`；`packages/adapters/src/calibration/postgres-calibration-adapter.ts::recordReviewOutcome` | 精确读取建议和决定；reject 追加 rejected record；return 保存退回关联并要求新 task/suggestion/review；approve 只保存待草案关联且 record 仍 pending；全部只追加、幂等、审计 | 不转移决定、不把 return 映射成 approved/rejected、不修改旧记录或建草案 |
| IP-09 | 证明门禁与 C16 未发布草案 | “只有精确批准证明可以创建未发布配置草案”的全部 Scenario；“校准草案继续受既有知识治理约束”的全部 Scenario；“无证明拒绝创建草案” | `packages/core/src/calibration/service.ts::createGovernanceDraft`；`packages/adapters/src/calibration/postgres-calibration-adapter.ts::createGovernanceDraft` | 复验三项既有授权；调用 IP-03；精确重建/核对候选摘要；证明通过后才存 content artifact 并以确定性命令调用 C16 submit-revision；C16 成功后 C29 事务写 draft linkage、approved record、receipt/audit；重试复用原 revision | 无证明零工件/修订；不改套 latest、不自动请求知识复核/发布/回滚，不让 approved 先于 C16 成功 |
| IP-10 | 只追加持久化与迁移 | “校准建议与公共偏差记录…”原子/幂等；“草案创建重试…”；“校准闭环保持权限、审计和重放边界” | 新增 `packages/adapters/src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.ts` | 建 D-11 三表、JSONB strict payload/digest、精确 FK、项目/版本/幂等唯一约束、三时态、最小 grants、逆序 down；实施前确认 `000047` 空闲 | 不改旧 migration，不回填，不改中央 fixture；冲突则升级 |
| IP-11 | 包导出与领域/纵向验证 | 新 capability 的 20 个 Scenario 和两份 modified capability 的 11 个 Scenario | 新增 `packages/core/src/calibration/index.ts`、`packages/adapters/src/calibration/index.ts`、`packages/core/test/calibration/calibration.test.ts`、`packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`；修改 `packages/core/package.json`、`packages/adapters/package.json` | 仅增加 `./calibration` 子路径；core 表格覆盖纯规则，PG 纵向覆盖完整 saga、权限、事件、幂等、并发、回滚、up/down 与重放 | 不改根 index、apps、依赖/锁文件，不新增低价值文案/SQL 顺序断言 |

## 4. 调用与副作用顺序

### 4.1 准备与创建建议

1. 校验公共 calibration command、当前 C06 `warning-response.record` 授权、actor/project 和幂等信封；授权失败前不读取目标。
2. IP-06 以精确 ref 调 C28 reader；`thresholdExceeded=false` 返回稳定不适用，缺失/跨工程失败关闭。
3. 由 C28 ref 派生 deviation record identity；读取 C25/C19 冻结 basis 与目标 release/artifact，验证目标是六种允许类型之一。
4. `prepareInput` 保存冻结输入工件；C30 以该工件和真实 `parentRunRef` 通过 C08 执行 `calibration-suggestion` task，随后用公共命令提交 completed result ref。
5. `createSuggestion` 通过 IP-04 精确读取 task/result/frozen input/parent run，IP-05 逐项校验并应用操作；可修复错误仅沿原任务与剩余预算返回，其它失败不产生正式建议。
6. 由 candidate digest 派生 suggestion ref，以源任务真实 `parentRunRef` 和确定性 C07 幂等键请求精确 suggestion review。C07 失败则 C29 无写入；重试复用原任务。
7. C29 `TransactionUnitV1` 原子写 suggestion、pending public deviation、review linkage、receipt、audit、现有 Outbox。任一失败全部回滚；C07 已建任务保持可重放但不是成功结果。

### 4.2 人工决定

1. 当前授权先行，按 project + exact suggestion/decision 读取 C29/C07 公共事实并验证 task target/ref。
2. reject：单个 C29 事务追加 rejected record + decision linkage + receipt/audit。
3. return-for-revision：单个 C29 事务追加 returned linkage + receipt/audit；新任务以后从 4.1 开始，使用新 task/result/suggestion/review refs。
4. approve-draft-creation：单个 C29 事务保存 pending-draft approval linkage；不改变公共 record，不创建 artifact/revision。

### 4.3 创建治理草案

1. 复验当前调用者对 `warning-response.record`、`review-audit.read`、`knowledge-modeling.govern` 的现有授权；任何授权失败前不读建议或决定。
2. 通过 IP-03 公共方法读取精确批准证明；not-approved 或技术完整性失败立即返回，零 C04/C16/C29 成功写入。
3. 精确读取建议基准 artifact/release，重放 IP-05 操作并核对 candidate digest；漂移返回 `STALE_VERSION`，不改读 latest。
4. 以 canonical content digest 幂等写 C04 工件，再以确定性命令/幂等键调用 C16 `submit-revision`。C16 失败时不写 approved record；重试复用 content artifact。
5. C16 成功后，C29 事务插入 draft linkage、approved deviation record version、receipt/audit。若尾事务失败，重放同一 C16 命令取得原 revision 后补齐；不得重复 revision。

## 5. Schema、状态与持久化落实

- SSOT：公共 refs/commands/results/event/`DeviationRecordSchema` 只从 `@riskflow/contracts` 导入；C18/C19 replacement 与完整文档直接复用对应 core Schema；C29 私有 DTO 只从 `@riskflow/core/calibration` 导出。
- 状态：偏差资格 `not-applicable | eligible`；建议 `candidate-validated → pending-review → returned | rejected | approved-for-draft`；公共记录仅 `pending → rejected` 或 `pending → approved` 且以新版本表达。return 保存在 suggestion governance fact，不伪造公共枚举。
- 身份：deviation record 由 project + exact C28 fact 派生；suggestion 由 record + exact C08 result + policy + candidate digest 派生；draft 命令由 exact suggestion + approval decision + candidate digest 派生。所有 canonical 输入持久化并可重算。
- 事务：C29 表、C03 receipt、C07 audit 和现有 Outbox 在同一 C03 transaction；C07 request 与 C16 submit 是外部幂等步骤，按 4 节 saga 收敛。禁止跨模块表写入模拟原子事务。
- migration：只新增 `000047` 三表；up/down、重复 up、旧数据保留、最小 grant、唯一/FK、事务回滚均由 IP-01/IP-11 PostgreSQL 测试验证。
- 可观测性：日志只记录 command/task/suggestion/decision/revision ref、阶段、稳定错误码、budget counters 与 digest；不得记录配置正文、模型响应、证据正文、SQL 或思维链。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 校准入口 / 已越限、未越限、无权错配 | IP-01, IP-05, IP-06, IP-11 | core + calibration adapter tests | exact C28 true/false facts；双工程/撤权 | 稳定 ref；false 零 task/write；无权先拒绝且不可枚举 | `pnpm exec vitest run packages/core/test/calibration/calibration.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| 校准 Agent / 合格收口、原预算修复、规则版本失败 | IP-04, IP-05, IP-06, IP-11 | core + agent-runtime + calibration adapter tests | 六类目标；valid/repairable/fatal candidates；预算边界 | typed ops；完整 Schema；同 task retry；fatal 无建议 | `pnpm exec vitest run packages/core/test/calibration/calibration.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| 建议与公共记录 / 创建、幂等、原子失败 | IP-01, IP-07, IP-10, IP-11 | calibration adapter test | valid candidate；C07 task；失败注入/并发 | recommendation 真实 ref；pending record/event；同键一份；回滚无部分事实 | `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| 人工决定 / reject、return、陈旧决定 | IP-08, IP-10, IP-11 | calibration adapter test | 三类 C07 decisions；successor suggestion；stale target | rejected 新版本；return 不造公共状态；决定不转移 | `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| 草案 / 批准、无证明、基准漂移、重试 | IP-02, IP-03, IP-05, IP-09, IP-10, IP-11 | review-audit + calibration adapter tests | approved/not-approved proofs；C16 base；尾事务失败 | proof gate；无 proof 零 artifact/revision；exact base；一项 revision；成功后 approved | `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| 既有治理 / 不等于发布、历史不变 | IP-08, IP-09, IP-11 | calibration adapter test | draft revision；后续 C16 publish/reject fixture | draft 未发布；无自动 request/publish；历史 refs/payload 不变 | `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| 权限、审计与重放 / 收窄、第三方重放 | IP-04, IP-05, IP-06, IP-09, IP-11 | core + calibration adapter tests | authorization revoked between phases；frozen artifact set | 每阶段重新授权；相同候选 digest；完整 refs/usage/audit；无思维链 | `pnpm exec vitest run packages/core/test/calibration/calibration.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |
| C07 证明 / 批准、非批准、错目标、完整性、缺失 | IP-02, IP-03 | contracts + review-audit tests | calibration tasks/decisions for all branches | 闭合 proof/reasons；不一致技术失败；不返回正文 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` |
| C07 查询授权 / authorized、denied、cross-project | IP-02, IP-03 | review-audit adapter test | read grant/revocation；same ref across projects | 映射 review-audit.read；授权先于读；跨工程同 not-found；零写副作用 | `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` |
| 接口加法兼容 / 专用端口、strict、旧契约 | IP-02 | contracts test | existing ReviewAuditPort implementer fixture；new proof port；extra fields | 新查询 strict；`ReviewAuditPortV1` 与旧 schemas/branches 语义不变；无新 capability | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` |
| migration / up-down、约束、权限 | IP-01, IP-10, IP-11 | calibration adapter test | fresh PostgreSQL + prior migrations | 000047 up/down/re-up；三表/FK/unique/grants；旧数据保留 | `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts` |

实现完成后的最小完整命令集：

```bash
pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/calibration/calibration.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts
pnpm typecheck
pnpm deps:check
pnpm exec eslint packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/src/calibration packages/core/src/agent-runtime packages/core/test/calibration packages/adapters/src/calibration packages/adapters/src/agent-runtime packages/adapters/src/review-audit packages/adapters/test/calibration packages/adapters/test/agent-runtime packages/adapters/test/review-audit
pnpm exec prettier --check openspec/changes/deliver-calibration-suggestion-and-governance-loop packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/src/calibration packages/core/src/agent-runtime packages/core/test/calibration packages/adapters/src/calibration packages/adapters/src/agent-runtime packages/adapters/src/review-audit packages/adapters/test/calibration packages/adapters/test/agent-runtime packages/adapters/test/review-audit packages/core/package.json packages/adapters/package.json
openspec validate deliver-calibration-suggestion-and-governance-loop --strict
```

## 7. 文件清单与升级条件

- 新增：`packages/core/src/calibration/{schema,service,index}.ts`；`packages/adapters/src/calibration/{postgres-calibration-adapter,index}.ts`；D-11 migration；`packages/core/test/calibration/calibration.test.ts`；`packages/adapters/test/calibration/{fixture,postgres-calibration-adapter.test}.ts`。
- 修改：`packages/contracts/src/ports/index.ts`；`packages/contracts/test/module-interfaces-events-workflows.test.ts`；`packages/core/src/agent-runtime/runtime.ts`；`packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`；`packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`；`packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`；`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`；`packages/core/package.json`；`packages/adapters/package.json`。
- 删除：无。
- 受保护：`packages/contracts/src/{records,events,workflows}/**`、`apps/**`、C16/C18/C19/C28 生产实现、`000046` 及更早 migrations、中央 migration/auth fixture、根依赖与 lockfile、`openspec/config.yaml`、其它 change。
- 必须升级：base/schema/contextFiles 漂移；`000047` 占用；需要改变现有 command/event/method signature 或权限枚举；C08/C28/C16 精确读取/幂等接缝无法复用；需要直接读写 C07/C16/C28 私表；需要多定义原子校准、自动发布、依赖、中央 fixture 或 allowlist 外生产文件；真实测试命令不存在。不得自行补设计。

## 8. 验收 Agent 授权与限定审计

- Finalizer 可在上述新增/修改文件内完成契约、领域、适配器、migration、测试和 package export 的核验及已批准范围内普通修复；不得接线 apps、发布配置、改变 D-03 单目标或 D-09 proof gate。
- 验收必须核对所有 IP-ID、31 个 Scenario 证据、RA-S7 追踪、无占位、无 C07 私表读取、无 latest、无自动发布、无新增依赖/权限，以及 `git diff --check` 和第 6 节命令。
- 限定审计标签：`public-contract-additive`、`authorization-before-read`、`agent-bounded-increment`、`c07-proof-gate`、`c03-transaction-outbox`、`c16-draft-only`、`migration-000047`、`cross-module-idempotent-saga`。同一收尾轮次最多一次审计，发现的范围内普通缺陷由该审计任务闭合；越界项升级。
