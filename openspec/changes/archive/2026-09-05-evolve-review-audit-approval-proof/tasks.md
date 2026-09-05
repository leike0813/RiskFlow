## 1. 公共契约演进

- [x] 1.1 在 `packages/contracts/src/ports/index.ts` 为 `ReviewAuditPortV1` 增加 `verifyKnowledgeRevisionApproval`，定义 strict `KnowledgeRevisionApprovalProofQueryV1`、`approved | not-approved` 结果和 `decision-not-found | target-mismatch | decision-not-approval` 三个未批准原因，并把专用分支映射到既有 `review-audit.read`；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t "approval proof|review audit"` 与 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，禁止新增平行端口、能力枚举、决定类型、事件或开放字段袋。
- [x] 1.2 扩展 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的既有 C02 表格驱动契约用例，验证查询拒绝额外字段和工程/主体/能力错配、结果联合闭合、批准证明只含精确引用与决定时间、端口方法为必需方法；运行该测试文件全部用例，不断言完整错误文案、字段顺序或实现调用次数。

## 2. C07 只读证明实现

- [x] 2.1 在 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 实现专用查询：strict 解析后先通过 C06 校验 `review-audit.verify-knowledge-revision-approval`，再按工程和精确决定引用连接 C07 自有决定/任务事实，折叠为 design §3 的闭合结果；运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "approval proof" --testTimeout=240000`，禁止跨工程回退查询、读取 C06 内部表或知识治理表、返回决定/证据正文、写审计/回执/Outbox。
- [x] 2.2 保持 `requestReview`、`decideReview`、`trace` 和适配器构造/导出不变，运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts --testTimeout=240000` 与 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false`；如新增方法暴露测试替身缺口，只补齐现有替身的精确方法，禁止可选方法、默认批准或第二套实现。

## 3. 可观察安全与失败边界

- [x] 3.1 在 `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` 复用现有 fixture 和真实 `knowledge-revision` 复核决定，以紧凑表格驱动覆盖批准、拒绝、退回、错修订和决定不存在；验证只有 `approve-publication` 且工程/目标/任务/决定引用全部匹配时返回证明，并确认违反既有任务/决定状态约束时技术失败关闭，不精确断言 SQL、日志或完整错误文案。
- [x] 3.2 在同一测试中覆盖授权先于读取、错误分支/能力/工程统一拒绝，以及其它工程决定与当前工程不存在同样返回 `decision-not-found`；同时比较查询前后 C07 任务、决定、拒绝审计、业务审计、命令回执和 Outbox 计数不变，运行 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts -t "approval proof|authorization|project isolation|read only" --testTimeout=240000`。
- [x] 3.3 若 C06 或依赖边界测试静态列举模块分支，只最小更新相应契约断言以接受 `review-audit.verify-knowledge-revision-approval -> review-audit.read`，运行发现到的现有定向测试；禁止修改角色能力、授权算法、迁移、根配置或锁文件。

## 4. 完成门与 C16 解锁核对

- [x] 4.1 运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts --testTimeout=240000`、`pnpm typecheck`、`pnpm lint`、`pnpm deps:check` 与 `pnpm deps:policy`，确认公共 Schema、唯一生产实现、既有 C07 回归和依赖方向全部通过；不安装/升级依赖、不启动服务。
- [x] 4.2 运行 `openspec validate evolve-review-audit-approval-proof --strict --no-interactive && git diff --check && git status --short`，核对实现仅涉及 design §6 允许文件，且没有迁移、HTTP/UI、通用决定读取、业务写路径、跨工程扫描、新依赖或范围外事实所有权。
- [x] 4.3 完成前以 C16 `publish-approved-release` 和 `rollback-by-new-release` 的精确 `revisionRef + reviewDecisionRef` 作为消费样例执行一次 approved 与一次 not-approved 契约验证，确认 C16 可只依赖 `ReviewAuditPortV1.verifyKnowledgeRevisionApproval` 阻断未批准发布；产物为实现交付摘要中的解锁结论，不修改 C16 worktree、C16 规划工件或知识治理实现。
