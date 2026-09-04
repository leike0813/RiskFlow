# C07 实施任务：人工复核与审计运行时

## 1. 规划与契约基线

- [x] 1.1 核对 C02 `ReviewAuditPortV1`、五类 `ReviewDecisionV1`、`review.review-requested.v1`、`review.review-resolved.v1`，C03 `TransactionUnitV1`/审计/Outbox，以及 C06 `LocalIdentityAccessV1.verify`/角色能力表；产物为实现 PR 中的依赖核对记录；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`；禁止修改 `packages/contracts/**`、C03/C06 既有迁移或授权矩阵。
- [x] 1.2 按 design §9 确认 C07 文件所有权和现有 workspace 导出方式；产物仅限 `review-audit` core/adapter、C07 迁移和测试；运行 `git diff --name-only -- packages/contracts packages/core/src/persistence packages/core/src/access packages/adapters/src/auth` 并确认无输出；禁止创建 C08、HTTP、UI、通知或导出实现。

## 2. 核心领域

- [x] 2.1 在 `packages/core/src/review-audit/schema.ts` 定义 `pending | decided | superseded` 状态、任务事实、决定事实、拒绝审计与活动投影 Schema，直接引用 C02 refs/decision Schema；运行 `pnpm exec vitest run packages/core/test/review-audit/review-audit.test.ts -t "schema|reference|decision type"`；禁止复制 C02 字段、候选正文或证据正文。
- [x] 2.2 在 `packages/core/src/review-audit/service.ts` 实现请求、替代、原子决定前置校验与闭合活动码到中文参数的纯领域逻辑；运行 `pnpm exec vitest run packages/core/test/review-audit/review-audit.test.ts -t "state|superseded|stale|activity"`；禁止把授权、SQL、模型判断或发布逻辑放入核心领域。
- [x] 2.3 在 `packages/core/src/review-audit/index.ts` 和 `packages/core/package.json` 增加最小子路径导出；运行 `pnpm --filter @riskflow/core typecheck`；禁止新增依赖或通用工厂/注册表。

## 3. PostgreSQL 迁移与权限

- [x] 3.1 新增 `packages/adapters/src/postgres/migrations/platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.ts`，创建 `business.review_tasks`、`business.review_decisions`、`audit.review_rejections` 及 design §7 的 CHECK/唯一约束和索引；运行迁移 `up -> down -> up` 集成用例；禁止修改 000001/000003 或另建命令回执、通用审计、Outbox。
- [x] 3.2 在同一迁移创建只读 `audit.review_activity_v1`，统一 C03 业务审计、C06 安全审计与 C07 复核拒绝为闭合活动字段；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "activity projection|as of|project isolation" --testTimeout=240000`；禁止把敏感正文或自由文本错误写入视图。
- [x] 3.3 显式授予 `riskflow_app` 最小 SELECT/INSERT/限定状态 UPDATE 权限并撤销 PUBLIC；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "database role|immutable audit|immutable decision" --testTimeout=240000`；验证应用角色无法 UPDATE/DELETE 三类审计来源、决定事实或执行 DDL。

## 4. PostgreSQL 适配器

- [x] 4.1 在 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 实现 `requestReview`，先用 C06 校验精确分支，再用 C03 原子写任务、审计、回执和 `review.review-requested.v1`；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "request review|idempotency|supersede|rollback" --testTimeout=240000`；禁止绕过 transaction context 或读取 C06 内部表。
- [x] 4.2 实现 `decideReview` 的工程内行锁、状态/目标/版本校验、唯一决定、任务转换、C03 审计和 `review.review-resolved.v1`；对已授权业务拒绝追加 `audit.review_rejections`；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "decide review|concurrent|stale|rejection audit" --testTimeout=240000`；禁止覆盖决定、人工绕过确定性校验或把检查点当业务事实。
- [x] 4.3 实现 `trace`，先用 C06 校验 `review-audit.trace`，再按工程、主题和包含式 `asOfRecordedAt` 查询活动投影并返回 C02 引用；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "trace|evidence summary|non-enumeration" --testTimeout=240000`；禁止跨工程扫描、返回证据正文或泄露资源存在性。
- [x] 4.4 在 `packages/adapters/src/review-audit/index.ts` 和 `packages/adapters/package.json` 增加最小导出，并让集成测试通过现有 migration roots 装载 C07 迁移；运行 `pnpm --filter @riskflow/adapters typecheck`；禁止增加新依赖、第二套端口或默认放宽授权。

## 5. 可观察行为测试

- [x] 5.1 扩展 `packages/core/test/review-audit/review-audit.test.ts`，以表格驱动覆盖五类决定代表路径、非法类型组合、替代状态和稳定活动码；运行该文件全部测试；禁止断言完整中文句子、内部调用顺序或 SQL 文本。
- [x] 5.2 扩展 PostgreSQL 集成测试，覆盖同键重放/异载荷冲突、两个不同命令并发决定仅一个成功、新版本送审后旧提交拒绝、审计/Outbox 注入失败回滚；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "idempotency|concurrent|stale|audit failure|outbox failure" --testTimeout=240000`。
- [x] 5.3 覆盖 C06 授权边界：reviewer 可决定/追溯但不能发起任务，工程风险负责人可执行三分支，过期/错工程/错分支上下文统一拒绝且不泄露目标存在性；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "authorization|reviewer|project boundary|non-enumeration" --testTimeout=240000`。
- [x] 5.4 覆盖多命令批量语义：每项独立命令、授权、事务、结果和审计，单项冲突不回滚其他项；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "multiple decisions|partial failure" --testTimeout=240000`；禁止增加批量 DTO 或跨任务大事务。

## 6. 验证与完成门

- [x] 6.1 运行 `pnpm exec vitest run packages/core/test/review-audit/review-audit.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts --testTimeout=240000`，确认核心与 PostgreSQL 适配器测试全部通过。
- [x] 6.2 运行 `pnpm typecheck` 与 `pnpm lint`，确认 workspace 类型与静态检查通过；如仓库脚本不同，只使用仓库已声明的等价脚本并记录实际命令。
- [x] 6.3 运行 `openspec validate deliver-review-and-audit-runtime --strict --no-interactive`，确认 change 结构、delta spec 和场景严格有效。
- [x] 6.4 运行 `git diff --check` 与 `git diff --name-only`，确认无空白错误，且改动仅位于 design §9 的允许范围。
- [x] 6.5 完成前核对：重复决定幂等、过期提交拒绝、审计故障阻断业务提交、应用角色不能修改审计、追溯引用包含运行/版本/输入/输出、无 C08/HTTP/UI 代码；全部满足后方可交付验证，禁止提交或归档 change，除非用户另行授权。
