# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`f7b568907026864735dee8599f8aae1a1cf34794`。实现前先执行 `git diff --name-only f7b568907026864735dee8599f8aae1a1cf34794 -- <第 7 节文件白名单>` 并重新读取受影响符号；若符号或公共契约已漂移，停止并升级。
- 本 change 的行为事实源：`specs/platform/unified-bounded-agent-runtime/spec.md` 的 Requirement“终态失败证据只通过公共窄读披露”及 6 个 Scenario；技术决定：`design.md` D-01～D-07。
- 上游事实源：已归档 `platform/unified-bounded-agent-runtime`、`platform/local-identity-project-authorization`、`platform/postgresql-outbox-checkpoint-foundation` 主 specs/design；当前代码是实现现状事实源。
- C17 集成事实源：`deliver-process-model-mechanism-and-evidence-governance/design.md` D-09，以及 implementation-plan §2 IP-07/IP-08、§4.4 第 1 条。只用于固定 reader 签名与消费边界，不修改 C17 文件。
- 当前代码核对结果：contracts 尚无 `agent-task.read` 或 `agent-task.read-failure-evidence`；C06 的 branch Schema、角色全集、capability 派生、authorize/verify 均从 `MODULE_BRANCH_CAPABILITY_V1` 数据驱动；C08 三张既有表已保存全部投影字段，C03 已提供幂等收据/审计。无需依赖、迁移、数据回填、package export 或新文件。
- 无 Open Question；实施 Agent 不得自行改变 D-01 公共签名、D-04 错误/查询顺序、D-06 幂等审计或文件范围。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `ModuleCapabilityV1_VALUES`、`MODULE_BRANCH_CAPABILITY_V1`；`packages/core/src/access/schema.ts` 的 `ModuleBranchV1Schema`；`policy.ts` 的 `allBranches`、`branchCapability()`、`branchesForRoles()`；`PostgresLocalIdentityAccess.authorize()/verify()` | 只扩 contracts 两个闭合集合；C06 生产逻辑自动按 map 签发/复验唯一 capability，测试证明真实路径 | 不新增第二份 branch/capability map，不改角色模型、policy 版本或 C06 生产算法 |
| IP-02 | `packages/core/src/agent-runtime/runtime.ts` 已导入的 Agent task/type/error/usage 事实；`schema.ts` 的 `AgentStructuredErrorV1`、`AgentBudgetUsageV1`；`packages/core/src/artifacts/schema.ts` 的 `ArtifactRefV1`；agent-runtime barrel 的通配导出 | 在现有 runtime 公共模块声明 D-01 四个类型，继续由现有 barrel/subpath 导出 | 不扩 `AgentTaskPortV1`，不导出 `AgentTaskSnapshotV1` 作为 reader 结果，不复制 Schema/引用类型 |
| IP-03 | `PostgresAgentTaskAdapter`、`AgentRuntimeDatabase` 三张既有表、`#authorization`、`#transactionUnit`、`commandFor()`、`commit()`、`agentTaskRefEquals()`、现有 Schema parsers | 在表属主 adapter 实现 D-03～D-06 的 exact reader、白名单投影和 C03 收口 | 不调用公共/私有 `getTask()` 形成 envelope 返回，不新建 store/adapter，不打开 C04、不扫任务列表 |
| IP-04 | `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` 的 PostgreSQL/C03/C04 fixture、公开 start/claim/action/candidate/fail/cancel 方法；现有 C06 PostgreSQL fixture | 复用真实表和公开状态转换构造成功/失败边界；C06 映射在其属主测试中验收 | 不直接写 C08 私表造成功结果，不 snapshot 完整响应或断言 SQL/helper 调用顺序 |
| IP-05 | 根 `build`、`typecheck`、`lint`、`format:check`、`deps:check`、`deps:policy` scripts 与 OpenSpec CLI | 运行最小定向行为测试后执行静态、依赖和规格完成门 | 不安装依赖、不改锁文件、不提交、不归档、不启动服务 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | contracts 与 C06 exact branch | `C06 签发并复验精确读取能力` | **修改** `packages/contracts/src/ports/index.ts`：`ModuleCapabilityV1_VALUES`、`MODULE_BRANCH_CAPABILITY_V1`；**修改** `packages/contracts/test/module-interfaces-events-workflows.test.ts`；**修改** `packages/core/test/access.test.ts`；**修改** `packages/adapters/test/auth/local-identity-project-authorization.test.ts` | 增加 `agent-task.read` 与 `"agent-task.read-failure-evidence": "agent-task.read"`；在既有闭合契约/策略/真实 authorize+verify 测试中断言唯一 capability，且 start/resume/cancel/confirm 不混入 | 不改 `packages/core/src/access/**` 或 `packages/adapters/src/auth/**` 生产代码，不给 reviewer/field-responder/business-viewer 加 branch |
| IP-02 | 公共失败证据接口 | Requirement 全部；重点为两个成功 Scenario 和窄读字段边界 | **修改** `packages/core/src/agent-runtime/runtime.ts`：新增 `AgentTaskFailureEvidenceReaderV1`、`AgentTaskFailureEvidenceReadRequestV1`、`AgentTaskFailureEvidenceReadResultV1`、`AgentTaskFailureEvidenceV1` 及所需 type imports | 按 D-01 逐字声明签名和 readonly 字段，复用现有类型；现有 `index.ts` 通配导出自动生效 | 不新增同义 Zod DTO、package subpath、通用 repository、列表接口或 C02 port 方法 |
| IP-03 | PostgreSQL 窄读实现 | `读取 terminal-failure 证据`、`读取 cancelled 证据`、`不可枚举失败保持同形`、`窄读不泄露信封和正文`、`成功读取幂等审计` | **修改** `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`：`PostgresAgentTaskAdapter` implements 列表、专用 denial/投影 helper、`readTerminalFailure()` | 按 D-04 顺序校验身份并在目标查询前 C06 verify；只选 task/action/candidate 必需列；映射 used usage、有序 action/candidate refs、首次 validation ref；手工构造白名单 evidence；成功经 D-06 C03 命令/审计/零事件收口；统一指定边界为 `AUTHORIZATION_DENIED`，保留技术/幂等错误 | 不改任务状态、预算、动作、候选或现有错误映射；不使用 `getTask()`、`selectAll()` 读取子表、artifact open、SQL 列表/搜索或 C17 私表 |
| IP-04 | 公共行为回归 | 除 C06 场景外其余 5 个 Scenario | **修改** `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`：复用 fixture，增加 read authorization 与失败证据用例 | 用公开 C08 方法构造 terminal-failure/cancelled 任务、动作、两版候选和重复 validation ref；表驱动覆盖不存在、跨工程、错完整 ref/expected type、非终态、未授权/缺 verifier；断言同形错误、字段白名单、排序/去重、used usage、C03 audit/receipt 重放及异载荷冲突 | 不直接插入 C08 私表，不断言完整错误文案、查询次数/SQL 文本、字段顺序或内部调用顺序；不改现有用例含义 |
| IP-05 | 完成门与回归 | Requirement 全部 | **不新增生产文件**；实现完成后只按证据更新 `tasks.md` 勾选状态 | 执行 V-01～V-07；检查 git diff 仅含白名单、无 migration/dependency/C17 文件；每项 task 仅在对应证据通过后勾选 | 不用跳过测试、更新 snapshot 或扩大命令范围掩盖失败 |

## 4. 调用与副作用顺序

1. `readTerminalFailure()` 解析 `projectId/actorId/requestId/requestedAt/taskRef/expectedTaskType/authorization`；身份与授权上下文不一致、capability 不是唯一 `agent-task.read` 或 adapter 缺 verifier 时立即返回 D-04 同形拒绝，数据库读取为零。
2. 以 `requestId`、请求工程和 exact `agent-task.read-failure-evidence` branch 调用 C06 `verify()`；传入授权上下文引用及其有界空间。C06 复验当前账号/工程/角色/策略与 invocation 绑定并写安全审计；拒绝时不查询 C08 目标。
3. C06 成功后按 `project_id + taskRef.reference.entityId + taskRef.reference.versionId` 查询一个 task 投影；strict parse 持久化 task ref/error/budget ledger，并复验完整 task ref、row task type、`expectedTaskType` 和 `terminal-failure | cancelled`。任一失败都返回同形拒绝，不查子表。
4. 对通过的同一 task id，动作查询仅选 `action_id/sequence` 并按 sequence 升序；候选查询仅选 `candidate_version/candidate_artifact_ref/validation` 并按 candidate_version 升序。解析公开引用，校验引用按完整 ref 首次出现去重；不打开工件，不加载模型或正文。
5. 构造 D-01 evidence：`usage=budgetLedger.used`，可选 error/cancel reason 仅在持久化存在时加入，除此之外只返回白名单引用字段。
6. 以 `commandId=requestId`、固定 command kind/idempotency key `agent-task.read-failure-evidence` 和规范请求 payload 调用 `TransactionUnitV1.execute()`；handler 追加一条同名事实审计、零事件。审计/收据失败不返回成功；同载荷重放复用收据且审计不增加，异载荷由 C03 返回 `IDEMPOTENCY_CONFLICT`。
7. C06 授权拒绝与 D-04 目标边界统一为 `AUTHORIZATION_DENIED/agent-task.read`；C06/数据库/C03 可重试技术故障保持 `TRANSIENT_FAILURE`，不可恢复持久化故障保持 `TERMINAL_FAILURE`。错误不带实际任务类型、状态、内部原因、envelope 或工件引用。

## 5. Schema、状态与持久化落实

- **Schema SSOT（IP-01、IP-02）**：branch/capability 只在 contracts map 定义；reader 复用既有 task/type/authorization/error/usage/artifact/reference 类型。D-01 是公共 TypeScript 签名，不增加平行 task DTO。
- **状态（IP-03）**：reader 只接受现有 `terminal-failure | cancelled`，不产生状态转换；`pending/running/waiting-user-confirmation/retryable-failure/completed` 均按不可枚举拒绝处理。
- **权限（IP-01、IP-03）**：C06 verify 必须早于目标定位；上下文严格绑定 requestId/project/branch 且唯一 capability 为 `agent-task.read`。不接受 task envelope 内冻结授权作为读取授权。
- **持久化（IP-03）**：只读现有 `business.agent_tasks`、`business.agent_task_actions`、`business.agent_task_candidates` 的窄列；不新增/修改表、索引、约束或权限，因此没有 migration 和中央迁移清单登记。
- **事务与幂等（IP-03）**：终态投影只读；C03 仅原子写命令收据和一条事实审计，零 Outbox。requestId 同载荷重放不重复事实，异载荷冲突。
- **版本与顺序（IP-03）**：完整 `AgentTaskRefV1` 必须相等；action `versionId=String(sequence)`；candidate/validation 顺序来自 candidate_version，不按 artifact hash 排序。
- **可观测性（IP-03、IP-04）**：C06 安全审计证明授权决定，C03 audit/receipt 证明成功读取；日志和错误不记录 envelope、模型响应、正文、SQL 或目标差异。
- **依赖（IP-05）**：只使用现有 TypeScript、Zod、Kysely、C03/C06 模块，无 package manifest 或 lockfile 变化。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| `终态失败证据只通过公共窄读披露 / C06 签发并复验精确读取能力` | IP-01 | contracts module interfaces、core access、PostgreSQL C06 tests | 工程风险管理员真实 session/project；exact branch authorize+verify | schema 接受新 capability；map/`branchCapability` 精确；context 仅 `agent-task.read`；其它角色和 agent-task 能力不扩大 | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/access.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts` |
| 同 Requirement / `读取 terminal-failure 证据` | IP-02～IP-04 | PostgreSQL C08 adapter test | 公开 start/claim/action/candidate/fail 流程；两动作、两候选、重复 validation ref | exact error；usage 等于 used ledger；action 映射升序；candidate 升序；validation 首次去重 | `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts` |
| 同 Requirement / `读取 cancelled 证据` | IP-02～IP-04 | 同上 | 公开 cancel request + cooperative fail；已有动作/候选可选 | terminalStatus cancelled；cancelReasonCode/error 及已提交 refs/usage 保留 | 同 V-02 C08 命令 |
| 同 Requirement / `不可枚举失败保持同形` | IP-03、IP-04 | 同上 | 表驱动：不存在、跨工程、错完整 ref、错 expected type、pending/retryable/completed、错 capability/缺 verifier | 全部为 failed `AUTHORIZATION_DENIED`、required `agent-task.read`；无实际状态/类型/error/refs；未授权时目标查询前收口 | 同 V-02 C08 命令 |
| 同 Requirement / `窄读不泄露信封和正文` | IP-02～IP-04 | 同上 | 数据库中存在 envelope、intent/result/increment/validation 和 C04 内容 | 成功对象键集合仅为 D-01；序列化结果不含敏感字段/正文标记；无列表结果 | 同 V-02 C08 命令 |
| 同 Requirement / `成功读取幂等审计` | IP-03、IP-04 | 同上 | 相同 request+payload 重放；相同 request 改 target/type/project/authorization ref | evidence 相等；command receipt/audit 各 1；Outbox 0；异载荷 `IDEMPOTENCY_CONFLICT` | 同 V-02 C08 命令 |
| 三包编译与公共导出 | IP-01～IP-03、IP-05 | TypeScript project references | 生产与测试修改完成 | contracts/core/adapters 类型检查通过，C17 可从 core subpath 导入 D-01 接口 | `pnpm exec tsc -b packages/contracts packages/core packages/adapters --pretty false` |
| lint、格式与依赖边界 | IP-01～IP-05 | 全部计划文件 | 无新增依赖 | ESLint/Prettier 通过；dependency-cruiser/policy 通过 | `pnpm exec eslint packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/src/agent-runtime/runtime.ts packages/core/test/access.test.ts packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts && pnpm exec prettier --check openspec/changes/implement-agent-task-failure-evidence-reader packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/src/agent-runtime/runtime.ts packages/core/test/access.test.ts packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts && pnpm deps:check && pnpm deps:policy` |
| 构建与 OpenSpec 完成门 | IP-05 | workspace/change | V-01～V-04 已通过 | build 通过；strict change validate 通过；文件白名单、无迁移/依赖/C17 改动 | `pnpm build && openspec validate implement-agent-task-failure-evidence-reader --strict --no-interactive` |

验证编号：V-01=C06/contracts 三测试；V-02=C08 adapter 测试；V-03=三包 TypeScript；V-04=ESLint；V-05=Prettier；V-06=依赖检查；V-07=build + strict OpenSpec。

## 7. 文件清单与升级条件

**新增生产/测试文件：**无。

**修改：**

- `packages/contracts/src/ports/index.ts`（IP-01）
- `packages/contracts/test/module-interfaces-events-workflows.test.ts`（IP-01）
- `packages/core/src/agent-runtime/runtime.ts`（IP-02）
- `packages/core/test/access.test.ts`（IP-01）
- `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`（IP-03）
- `packages/adapters/test/auth/local-identity-project-authorization.test.ts`（IP-01）
- `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`（IP-04）

**删除：**无。

**无需修改但必须复验：**`packages/core/src/agent-runtime/index.ts`、`packages/adapters/src/agent-runtime/index.ts` 与两包 `package.json` 的既有 subpath export；`apps/api/src/http.ts` 不为内部 reader 增加 route。

**保护区：**全部 migration/provider/中央迁移清单、`pnpm-lock.yaml`、所有 package manifest、`openspec/config.yaml`、C17/C15/C16 文件、`apps/**`、其它 change、Agent runner、现有任务状态/预算/候选 Schema 和 C02 `AgentTaskPortV1`。

出现以下任一情况必须停止并升级：

1. D-01 任一名称、字段、readonly、联合分支或方法签名需要变化。
2. 现有三张 C08 表不能无损生成 error/cancel/used usage/action/candidate/validation refs，因而需要迁移、索引、权限或中央清单登记。
3. C06 不能仅凭 contracts map 为新 branch 签发并复验唯一 `agent-task.read`，必须修改角色、policy 版本或 auth 生产算法。
4. C03 无法以现有 `TransactionUnitV1` 完成同载荷重放、异载荷冲突和单审计/零事件收口。
5. 实现需要 `getTask()`、envelope fallback、C04 正文读取、任务列表/扫描、C17 私表或计划外公共接口。
6. 任一计划文件/符号在 base 后漂移，或 V-01～V-07 命令不存在/失败且修复将超出本文件白名单。
