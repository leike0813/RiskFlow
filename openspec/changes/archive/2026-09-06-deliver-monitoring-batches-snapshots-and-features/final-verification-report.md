# C14 最终审核报告

验证对象：`deliver-monitoring-batches-snapshots-and-features`

基线：`4f1895ab359a901f1cb63adb702fca249acd2f16`，加本轮未提交修复。上一轮 `verification-report.md` 对应 `37cebbd`，本报告记录修复后的结论。

## 结论

| 维度   | 结果                                                                 |
| ------ | -------------------------------------------------------------------- |
| 完整性 | 16/16 tasks 已勾选；10 项 requirement 均已核对实现，补充关键风险回归 |
| 正确性 | 隔离级别修复原先未生效，本轮修正后数据库实际隔离检查通过             |
| 一致性 | 保持 C11 composition、确定性特征、只追加事实与零下游事件边界         |

未发现剩余已确认的 CRITICAL 实现缺陷。协调者可审阅本轮差异、形成检查点后继续合并与归档；本轮未提交、未合并、未归档。

## 原问题复核与本轮修复

1. **事务隔离**：`PostgresTransactionUnit.execute` 原先丢弃 Kysely `setIsolationLevel()` 返回的新 builder，实际仍使用默认隔离。本轮接收返回值；在真实 PostgreSQL 事务中执行 `SHOW transaction_isolation`，验证 read committed、repeatable read、serializable 三种选择。C14 冻结在该事务中读取数据库时钟、精确修订、策略及来源样本集合。
2. **版本选择**：登记与冻结均复用 `latestSample` 的记录时间、持久化时间和稳定决胜规则。新增相同 `recordedAt` 的更正回归，断言新快照采用值 99，旧快照查询结果不变。
3. **查询重授权**：`resolveSnapshotQuery` 按调用上下文重新校验当前工程、空间与来源权限；已有会话撤销测试确认旧 query ref 不能继续解析正文。
4. **验收证据**：扩展现有集成测试，覆盖合法 correction/supplement、相同命令重放与并发重试、不同命令相同指纹、同键异载荷、不同证据保留独立交付、未知字段、重复/乱序/窗外时间、未知单位、缺失证据、非有限值、无效 UTF-8、行长度上限、审计失败回滚、空窗口及旧快照不变。
5. **前序关系和数据库权限**：保留无效 correction 前序与 pointer 回退测试；新增迁移 down/up 与应用、Outbox、checkpointer 角色的代表性表权限检查。
6. **特征计算**：补二次曲线及缩放样例的 OLS、加速度、Hann 频域和 median/MAD 独立数值核对、确定性重放、常量序列、MAD 尺度下限、partial 和频域并列选择最低频率。窗口最小值 Schema 回归仍通过。
7. **全量测试迁移登记**：首次 `pnpm verify` 因授权测试夹具未登记 C14 `000011` 而报 `MIGRATION_INVALID`；补该静态 manifest 项后，12 项授权测试通过。

## 验证记录

- `pnpm verify`：修复后通过，31 个测试文件通过、1 个跳过，279 项测试通过、1 项跳过；耗时约 114 秒。包含 build、typecheck、lint、format、依赖边界/政策及 15 项 OpenSpec 严格校验。
- `pnpm exec vitest run packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts`：33 项通过。
- 完整门禁之后新增的特征及批次边界测试，另以两个 C14 测试文件执行定向验证：14 项通过，约 21 秒。
- `pnpm typecheck`、变更文件 ESLint 与 `git diff --check`：最终检查通过；变更文件 Prettier 检查通过。

## 范围与证据边界

C03 builder 修复及授权夹具迁移登记均获协调者明确授权。未修改 contracts、apps、根清单、依赖、锁文件、已归档规格或其它生产领域模块；未引入 Agent/LLM、评分、阈值、预警或 UI 行为。

测试采用代表性行为与故障边界，未对所有上限组合、每种来源撤权方式及每个流式读取故障点做穷举。测试记录不构成最大批次规模的性能 SLA；C38 仍负责真实硬件性能验收。
