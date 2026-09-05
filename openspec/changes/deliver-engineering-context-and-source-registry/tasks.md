## 1. Core 领域模型与调用面

- [ ] 1.1 在 `packages/core/src/engineering-data/context-source/schema.ts` 定义并导出 strict Zod Schema、派生类型、闭合状态/定位联合、资料 ID 与资料段 ID 生成校验、集合上限和规范化规则；前置输入为 C01/C02 既有引用与本 change delta spec，产物不得复制通用引用形状；运行 `pnpm exec vitest run packages/core/test/engineering-data/context-source.test.ts` 验证三维适用性、状态、版本链、定位和标识边界。
- [ ] 1.2 在 `packages/core/src/engineering-data/context-source/service.ts` 实现 `EngineeringContextSourceRegistryV1` 的上下文修订、资料段集合冻结、适用性快照确定性合成及闭合错误映射，并在 `index.ts` 汇总公开；前置输入为 1.1 Schema 与 C03/C06 端口契约，产物保持 `reviseContext`、`registerSegments`、`createApplicabilitySnapshot` 三个窄方法且不增加公共端口；运行 `pnpm exec vitest run packages/core/test/engineering-data/context-source.test.ts` 验证陈旧版本、生命周期前进、区段覆盖和字段级 provenance。
- [ ] 1.3 在 `packages/core/test/engineering-data/context-source.test.ts` 以表格测试覆盖 RI-S11～RI-S14、RA-S1 的稳定纯领域行为，复用既有 fixtures/引用构造方式且不锁定错误全文、字段顺序或私有调用；运行 `pnpm exec vitest run packages/core/test/engineering-data/context-source.test.ts` 并确认全部通过。

## 2. PostgreSQL 持久化基线

- [ ] 2.1 新增 `packages/adapters/src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000007_engineering_context_source_registry.ts`，创建工程/区段 identity 与修订、资料项/交付/版本、资料段集合/段、适用性快照表及唯一键、FK/check、只追加权限和 `pending-access -> ready` 单向收口；前置输入为 1.1 Schema 与 C03～C07 迁移约定，产物不得给 PUBLIC、Outbox Worker 或 checkpointer 授予业务表权限；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 验证 `up/down/up`、约束和角色权限。
- [ ] 2.2 在 `packages/adapters/test/engineering-data/context-source/fixture.ts` 复用现有固定 Testcontainers PostgreSQL 镜像和递归迁移 runner，按 `000001`～`000007` 启动真实 C03/C04/C06/C07/C11 依赖并提供最小种子/清理能力；无容器时保持失败而不回退内存 adapter；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 验证 fixture 可重复启动和关闭。

## 3. PostgreSQL Adapter 与事务编排

- [ ] 3.1 在 `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` 实现工程/区段不可变修订、资料段集合冻结和适用性快照写入，所有写族复用 C03 `AtomicCommandV1`、C06 `verify`、C07/C03 审计及 compare-and-swap；前置输入为 1.2 服务接口、2.1 表结构和现有事务 unit，产物不得跨层读取 C04/C06 内表；运行目标 adapter 测试验证幂等重放、同键异载荷、并发陈旧、跨工程拒绝及审计失败整笔回滚。
- [ ] 3.2 在同一 adapter 中实现既有 `EngineeringDataPortV1.apply(register-source-delivery)`：事务前用 C06 `verify` 和 C04 `ArtifactStoreV1.open` 受权限长读取最多 1 MiB strict metadata JSON 并等待 `verified`，事务内再用 C04 guard 核对两个冻结工件及元数据内容身份后追加交付/资料项/资料版本；其余 `apply` 及全部 `freeze/read` 分支返回 `UNSUPPORTED_CONTRACT`；前置输入为 C02 公共签名与 C04 store/guard，产物不修改 transport 或把 metadata 当任意命令协议；运行目标 adapter 测试验证三类 snapshot 交付、元数据限长/完整性、工件不可用整体失败、新交付只追加和公共签名不变。
- [ ] 3.3 在同一 adapter 中完成 C06 默认 `restricted` 资料权限的后置幂等收口：资料先写为 `pending-access`，以首次登记命令确定性派生 C06/最终绑定幂等身份，授权成功后只以精确 grant ref 转为 `ready`，公共调用达到 `ready` 才返回成功；前置输入为 C06 `administerProject(revise-source-access)` 与 source grant 契约，产物不实现补偿性共享或跨库 XA；运行目标 adapter 测试验证授权成功/失败/同一公共命令重试续跑、无重复交付/授权修订、关联空间完整覆盖和当前正文权限复验。
- [ ] 3.4 在 `packages/adapters/src/engineering-data/context-source/index.ts` 汇总 PostgreSQL composition，并确保批量段写入使用参数化语句且每批最多 500、单集合最多 10,000，不扫描其它工程或全历史；运行目标 adapter 测试，以记录的 wall time/写入行数验证 10,000 段边界和越界整体拒绝，不设置硬件相关 SLA。

## 4. 集成验收与公开出口

- [ ] 4.1 在 `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 使用 2.2 fixture 覆盖 migration 权限、公共交付、内部三用例、C04 guard、C06 授权收口、C03 幂等/并发、C07 审计、零事件事务、不可枚举和故障回滚；断言稳定外部行为而非 SQL/日志/错误全文；运行该测试文件并确认全部通过。
- [ ] 4.2 仅在 `packages/core/package.json`、`packages/adapters/package.json` 及现有约定要求时的两个 `src/index.ts` 增加 `./engineering-data/context-source` 导出，产物不得新增依赖或修改 lockfile；运行 `pnpm typecheck && pnpm deps:check && pnpm deps:policy` 验证类型与四层依赖边界。
- [ ] 4.3 完成最小全量验收：运行 `pnpm exec vitest run packages/core/test/engineering-data/context-source.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`、`pnpm lint`、`pnpm format:check`、`pnpm openspec:validate`，并核对 RI-S11～RI-S14、RA-S1 场景均有实现证据且不存在未解决失败。

## 5. 禁止修改区核对

- [ ] 5.1 用 `git diff --name-only b27b7c30972c8ea31b90c1aa7e46a1ad9dc35f3f --` 核对实现只触及本 change 规划的 core、adapter、测试、`000007` migration 与必要 package 出口；确认未修改 `packages/contracts/**`、`apps/**`、C03/C04/C06/C07 既有代码和迁移、其它领域目录、根 manifest、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、依赖/构建/CI 配置、`openspec/config.yaml`、`openspec/specs/**`、归档或其它活动 change，若边界无法满足则停止实现并转交独立契约演进 change。
