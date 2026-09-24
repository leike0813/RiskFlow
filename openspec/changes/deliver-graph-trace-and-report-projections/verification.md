# Verification

## 验收对象

- Change：`deliver-graph-trace-and-report-projections`（`orchestrated-delivery`）
- 输入实现 HEAD：`202788bb5402192ecac1a1b11f0e46b3f978865a`
- 最终验收 HEAD：`202788bb5402192ecac1a1b11f0e46b3f978865a` 加本轮未提交的五个受审文件；主调度形成 Git 检查点后须以检查点 HEAD 对账本产物。
- 验收 Agent：C31 当前收尾任务（`task_911c68969a6d`，`policy=self`）

## 结论

**PASS**：R1～R3 的七个 Scenario、IP-01～IP-06 与本轮限定自审均通过；结论适用于上述工作树产物，主调度形成检查点后须核对 HEAD 与所审文件一致。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| R1/S1 获权主题关联图；IP-01/03/04/06 | `postgres-workflow-projection.test.ts` 的多运行图测试；`postgres-workflow-projection.ts` 的 `#readAssociationGraph`、`#graphRunIds`、`#graphLinks` | 真实 PostgreSQL 下按精确边返回关系、版本、阶段、审计和 C22 当前允许的定位；无领域正文。 |
| R1/S2 未触发或不可证明；IP-04/06 | 图测试的 C22 失败、错引用、无定位、缺失窄读端口与越界分支；`#evidenceBatch` | 来源不可证明时整页失败；C22 仅确认记录而未给定位时不猜造来源段定位。 |
| R2/S1 同修订报告；IP-01/02/03/05/06 | 报告测试的 101 项续页、同 ID 不同事实类型、状态审计引用、历史重读和结果正文错运行身份；`#reportRunEntries` | 事实与缺席项按稳定身份续页；运行摘要引用实际状态审计；晚于登记时点的运行不进入旧查询；正文所指运行不一致时显式失败。 |
| R2/S2 缺失或依据不足；IP-03/05/06 | 空修订及 `skippedTails` 测试 | 合法空修订返回空页；已有运行只返回成立事实和登记的缺席原因，无默认等级。 |
| R3/S1 撤权后不可读；IP-02/03/06 | 撤权同形测试、C30 查询登记测试；`readPage` 的 C05 复验与授权摘要对账 | 撤权后的结果与不存在目标同形；空间目标随登记冻结并逐页复验。 |
| R3/S2 有界分页与伪游标；IP-02/03/04/05/06 | 图、报告测试中的伪造位置、错查询游标、分页与硬上限；迁移 up/down 与索引测试 | C31 游标位置须属于冻结图边或报告候选；图最多 32 个关联运行、1000 条边，单运行报告最多 1000 项；越界显式失败。 |
| R3/S3 旧/未知分支；IP-01/03/06 | contracts 测试、`run-view`/`trace-chain` 回归及旧分支无 C22 读端口测试 | 旧分支继续可读，未知查询类型稳定拒绝。 |
| IP-02 持久化与审计 | `postgres-workflow-adapter.test.ts`、`postgres-foundation.test.ts` | `000051` 迁移可往返；并发异空间同查询身份仅一项登记成功，另一项冲突；收据、回读及只追加角色限制通过。 |

输入检查点已包含上一轮对分页排序键、C22 精确来源复验、游标位置、运行身份和图边界的修复。本轮修改 `postgres-workflow-projection.ts` 与既有 projection 测试：C22 缺席定位时不再以首个来源段伪造定位，报告运行摘要改引用状态行审计；修改 `postgres-workflow-adapter.ts` 与既有 adapter 测试：按协调端裁决补齐 D-03 冻结空间/结果版本的收据载荷，在事务内核对冲突行，并在重放后核对实际登记版本；加入并发真实 PostgreSQL 回归。未新增依赖、公共字段或迁移，旧 `run-view`/`trace-chain` 收据载荷保持原语义。

实际命令与结果：

- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`：最终代码 4 文件、60 测试通过（真实 Testcontainers PostgreSQL）。
- `pnpm typecheck`、`pnpm lint`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm format:check`、`pnpm openspec:validate`、`git diff --check`：均通过；OpenSpec 严格校验为 34 项通过、0 失败。合成夹具均为“合成样本、待甲方复核”。

## 限定审计

**本轮限定自审 PASS（`policy=self`）**。核对了 C05 逐页复验与授权摘要、C22 当前来源批读、旧 `trace-chain` 可选 C22 行为、冻结查询和游标位置、C03 登记事务以及 `000051` 迁移/索引。发现并修复了缺席定位时伪造来源段、状态摘要引用入口审计、并发异空间查询登记可错误重放三个已批准范围内缺陷；并发事务修复获协调端裁决 `msg_9d52853284a2`。对应真实 PostgreSQL 回归为上述 60 项；未发生待执行的独立审计。

## 后续注意事项

报告只披露已成立的精确引用、审计与获准定位；P/C 和风险等级正文不在本 change 的只读契约内。C40/C41 尚未闭合的全链场景只能按已成立切片解释。
