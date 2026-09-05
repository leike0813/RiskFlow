## 1. 前置契约与实现边界

- [x] 1.1 主调度 Agent 在派发实现前确认独立的 review-audit 契约演进 change 已实现、验证并归档，且公开 `KnowledgeRevisionApprovalProofReaderV1` 等价的最小只读接缝：输入工程、精确修订、复核决定和授权上下文，闭合返回批准证明或未批准原因。运行该前置 change 声明的定向测试与 `openspec validate <review-audit-change-id> --strict --no-interactive`；若接缝不存在或不能证明决定类型、目标、工程及任务未被替代，停止 C16 实现并升级主调度，禁止读取 C07 内部表、复制复核事实或在 C16 修改 `packages/contracts/**`、C07 主 spec/实现/迁移。
- [x] 1.2 实施 Agent 核对当前基线、C01/C02 契约、C03 事务基础、C06 授权、C07 复核实现和前置批准证明接缝，保存 `git status --short` 与精确路径清单；确认 C16 只写 `packages/core/src/knowledge-governance/**`、`packages/core/test/knowledge-governance/**`、`packages/adapters/src/knowledge-governance/**`、`packages/adapters/test/knowledge-governance/**`、`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/**` 及必要 package exports，禁止修改应用、主 specs、其它 change、根配置、依赖和锁文件。

## 2. 治理领域模型

- [x] 2.1 在 `packages/core/src/knowledge-governance/schema.ts` 定义模块唯一的稳定定义、不可变修订、复核关联、发布、停用决定、导入回执、状态投影与精确解析 Schema；复用 C01/C02 的定义类型、版本/证据/工件/复核引用，不复制公共 DTO，不导出数据库行，并以 `(projectId, definitionType)` 表达唯一稳定身份。
- [x] 2.2 在 `packages/core/src/knowledge-governance/lifecycle.ts` 实现无 I/O 的确定性规则：首次提交与精确基线、工件身份冲突、批准证明校验、发布时间线、停用、历史修订重新发布及 `requiredAt + asOfRecordedAt` 候选选择；错误只映射到既有闭合代码，不提供 latest/current、别名、模糊匹配或正文解析。
- [x] 2.3 在 `packages/core/test/knowledge-governance/knowledge-governance.test.ts` 用表格驱动用例覆盖任务 2.2 的稳定行为，包括错误基线、错工程/目标/类型的批准证明、拒绝/退回/替代任务、停用和历史版本重新发布；运行 `pnpm exec vitest run packages/core/test/knowledge-governance/knowledge-governance.test.ts`，不精确断言完整错误文案、字段顺序或内部调用次数。
- [x] 2.4 在 `packages/core/src/knowledge-governance/index.ts` 与现有 core export 约定的最小位置导出治理 Schema 和生命周期能力；运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`，禁止新增通用 repository、接口的单实现包装、依赖或尚未使用的扩展点。

## 3. PostgreSQL 事实与治理适配器

- [x] 3.1 新增 `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.ts`，创建 `business.knowledge_definitions`、`knowledge_revisions`、`knowledge_review_links`、`knowledge_releases`、`knowledge_release_decisions` 及必要索引、外键、唯一/检查约束和最小角色权限；主体事实只插入，除复核关联的受限补齐列外不授予 UPDATE，不授予 DELETE，迁移 `down` 仅精确撤销本迁移对象。
- [x] 3.2 在 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts` 实现 C02 `KnowledgeModelingPortV1.govern` 五个分支及内部 `resolveGovernedReleases`：所有分支先走 C06 精确授权，发布/停用/回滚额外拒绝非 human 调用，发布/回滚仅通过前置批准证明接缝验证 C07 决定，不读取复核表或正文工件。
- [x] 3.3 在同一 adapter 内复用 C03 `TransactionUnitV1` 落实事实、审计、命令回执和适用事件原子写入；提交与配置包重放使用稳定幂等身份，异载荷冲突整体拒绝，送审按“快照/等待引用 → C07 幂等建任务 → 补齐关联”收口失败重试，不新增分布式事务、队列或部分导入路径。
- [x] 3.4 在 `packages/adapters/src/knowledge-governance/index.ts` 与现有 adapter/package export 约定的最小位置导出治理适配器；只在既有 package manifest 确有子路径白名单时追加 `knowledge-governance` export，运行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false`，禁止新增依赖、改锁文件或实现 C02 尚未到期的用途级 `resolve`/`retrieve` 分支。

## 4. 真实数据库验证

- [x] 4.1 在 `packages/adapters/test/knowledge-governance/fixture.ts` 复用现有 PostgreSQL/Testcontainers、迁移、C06 身份和 C07 复核夹具，只补齐 C16 所需的项目、授权、工件引用与批准证明测试接缝；禁止建立第二套迁移 runner、身份模型、复核表或内存治理实现。
- [x] 4.2 在 `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` 验证不可变修订、同载荷幂等/异载荷冲突、并发发布唯一获胜、真实送审与批准证明、拒绝/退回/错目标不发布、停用/回滚、精确时间解析、Agent 发布拒绝、无权/跨工程不泄露目标存在性、审计/事务故障整体回滚及送审补偿；测试稳定事实和错误码，不锁定 SQL、日志、完整文案或内部调用顺序。
- [x] 4.3 在同一 PostgreSQL 测试中覆盖 `000007` 的 `up → down → up`、应用角色无 UPDATE/DELETE、复核关联仅可单向补齐和解析查询使用工程/类型/时间索引；运行 `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts --testTimeout=240000`，失败时只修复 C16 根因，不扩张共享契约或测试夹具权限。

## 5. 质量门与范围审计

- [x] 5.1 运行 `pnpm typecheck && pnpm lint && pnpm deps:check && pnpm deps:policy`，确认类型、静态规则和依赖边界通过；不安装/升级依赖、不启动服务，project-wide `pnpm test`/`pnpm verify` 是否执行由主调度按检查点决定。
- [x] 5.2 运行 `openspec validate deliver-governed-definition-lifecycle --strict --no-interactive && git diff --check && git status --short`，核对 proposal、delta spec、design、tasks 与实现一致，且没有 latest/current、可变别名、物理删除、C07 内部表读取、Agent 发布、业务正文解析、通用发布事件、新依赖或范围外文件；不归档、不提交、不修改 Git 历史。
