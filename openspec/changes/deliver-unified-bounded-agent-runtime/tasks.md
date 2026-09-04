## 1. 实现前检查点

- [ ] 1.1 确认 C03、C04、C05、C06、C07 已归档，核对 `TransactionUnitV1`、`ArtifactStoreV1`、C05 model gateway、`LocalIdentityAccessV1`、C07 审阅接口与 C02 `AgentTaskPortV1` 未发生漂移。
- [ ] 1.2 由主调度确认迁移号 `000005`、共享 `package.json`/Worker 注册文件所有权和实现分支基线；若前置接口或迁移顺序变化，停止并重新规划。

## 2. Core：DTO、策略与状态机

- [x] 2.1 在 `packages/core/src/agent-runtime/schema.ts` 定义严格 Zod DTO：统一任务信封、五类任务定义、预算策略/台账、动作辨识联合、候选版本、逐项校验、交互命令提案和结构化错误；复用 C02 公共 DTO，不修改 `packages/contracts/**`。
- [x] 2.2 在 `packages/core/src/agent-runtime/state.ts` 实现内部状态转换与 C02 状态映射，使用任务版本保护 pending/running/waiting/retryable/completed/terminal/cancelled 合法边；终态不可逆，恢复不重置信封和预算。
- [x] 2.3 实现原子预算申请/结算领域逻辑，覆盖模型、工具、上下文、输入输出、候选、对象、补搜、并发、墙钟、修正和瞬态重试；拒绝换模型、换提示、换工具策略或扩预算。
- [x] 2.4 实现按五类任务键控的 `AgentTaskDefinitionV1` 注册和严格动作/增量/候选校验；只允许类型化领域操作，显式拒绝 JSON Patch、整对象覆盖与未注册工具。
- [x] 2.5 实现可修复错误与终止拒绝的确定性分类：字段/格式/引用/候选范围/不完整增量可在原预算内修正；权限、来源、版本、规则冲突和处置三项约束不得循环绕过。
- [x] 2.6 实现运行时服务对 C02 start/resume/cancel/confirm 语义的编排，保证交互写命令先形成版本化提案，确认后才调用原领域接口。
- [x] 2.7 在 `packages/core/src/agent-runtime/index.ts` 导出 feature-owned API，并以表格驱动测试覆盖五类信封、状态、预算竞争、策略不匹配、拒绝分类、确认和结果引用族。

## 3. Adapter：PostgreSQL、C03–C07 组合边界

- [x] 3.1 新增 `packages/adapters/src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.ts`，建立 `agent_tasks`、`agent_task_attempts`、`agent_task_actions`、`agent_task_candidates`、`agent_command_confirmations` 的最小表、唯一约束、版本检查和必要 DML 权限；不新增 schema、角色、审计表或 Agent 专用 Outbox 事件。
- [x] 3.2 在 `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts` 实现任务仓储、compare-and-set、稳定幂等键、有界 `FOR UPDATE SKIP LOCKED` claim、租约续期/接管、动作意图、预算预留/结算和终态复用。
- [x] 3.3 组合 C03 `TransactionUnitV1`：每个任务事实与一条审计、命令收据及零个或多个已声明领域事件原子提交；审计失败必须回滚事实，checkpoint 只保存引用。
- [x] 3.4 组合 C04 `ArtifactStoreV1`：渲染输入、C05 原始响应引用、工具观察、候选、增量、校验、失败和提案先耐久，再写数据库引用；继承工程/资料授权，不存路径、URL、大正文或思维链。
- [x] 3.5 组合 C05：只以信封中的精确部署/提示调用 `completeStructured`，由 C08 执行严格工具循环和重试预算；禁止 C05 fallback、模型切换或未计费重试。
- [x] 3.6 组合 C06：start/resume/cancel/confirm 校验准确能力，Worker 权限由父运行冻结范围与当前授权求交；拒绝跨工程、资料空间、来源、已撤销资格和任何授权扩大。
- [x] 3.7 保持 C07 边界：仅提供候选、确定性校验和 C03 审计引用；人工审阅任务由下游创建，不在 C08 复制审阅决定或发布动作。
- [x] 3.8 在 `packages/adapters/src/agent-runtime/index.ts` 导出 feature-owned adapter，并补充 migration fixture 与集成测试，覆盖约束、RLS/权限、幂等、租约、C04-before-reference、审计原子性和零 Outbox 事件。

## 4. Worker：有界执行与恢复

- [x] 4.1 在 `apps/worker/src/agent-runtime/runner.ts` 实现有界 claim/lease/heartbeat 循环；并发取部署上限和任务预算较小值，不启动开发服务器或动态扩容。
- [x] 4.2 实现单步执行：预算预留 → 动作意图提交 → C05/领域工具调用 → C04 工件耐久 → C03 结算/状态提交；每步使用稳定 action ID 和幂等键。
- [x] 4.3 实现恢复规则：复用已完成动作；仅在明确无效果或目标端口保证幂等时重试；效果不确定记录 `AGENT_ACTION_UNCERTAIN` 并停止自动重发；租约接管不重置预算。
- [x] 4.4 实现协作式取消与交互等待：传播 `AbortSignal`、停止新动作、保留已提交证据；等待用户确认时释放 Worker 租约。
- [x] 4.5 在 `apps/worker/src/agent-runtime/index.ts` 导出 runner，并测试崩溃恢复、重复完成、租约接管、并发预算、取消、确认等待、重试耗尽及必经任务失败不降级。

## 5. 下游接入契约验证

- [x] 5.1 用测试定义验证 C15 `data-cleaning`、C17/C19 `knowledge-authoring`、C21 `retrieval-review`、C27 `response-recommendation`、C29 `calibration-suggestion` 均可通过同一注册入口运行，并只能返回 C02 对应输出引用族。
- [x] 5.2 验证 RI-S21–RI-S23、RI-S31–RI-S45、RI-S52–RI-S56、RA-S3、RA-S7 追踪关系；确认 RI-S57、P/C、矩阵、阈值、业务入库、发布和回滚不进入 C08。
- [x] 5.3 验证安全拒绝：未列工具、跨权限、模型切换、预算扩容、候选越界、通用 patch/整对象覆盖、不可修正规则冲突、处置三项约束失败、未确认写命令和基线冒充正式结果。

## 6. 共享接线与依赖约束

- [ ] 6.1 由主调度统一为 `packages/core`、`packages/adapters` 添加 `./agent-runtime` 导出，并将现有 `@riskflow/contracts`、`@riskflow/core`、`@riskflow/adapters` workspace 依赖接入 Worker；不新增外部依赖，不修改锁文件。
- [ ] 6.2 由主调度在 Worker 中央注册处接入 agent runtime runner，避免 C08 直接修改并行 change 共享入口。

## 7. 验证与交付门

- [x] 7.1 运行 feature 相关 core、adapter、worker 测试；测试断言稳定错误码、状态、引用和可观察效果，不锁定提示文案、SQL 文本或内部调用顺序。
- [x] 7.2 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，记录任何非 C08 基线失败。
- [x] 7.3 运行 `openspec validate deliver-unified-bounded-agent-runtime --strict --no-interactive`。
- [x] 7.4 运行 `git diff --check` 并确认没有修改生产实现、归档内容或无关文件。
- [ ] 7.5 按项目 OpenSpec 流程执行独立 verify；只有实现任务全部完成、验证通过且主调度授权后才进入归档与 Git 检查点。
