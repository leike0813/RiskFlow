# Verification

## 验收对象

- Change：`deliver-graph-trace-and-report-projections`（`orchestrated-delivery`）
- 输入实现 HEAD：`1790efd56e49865c02d10b75566dd950c3e3beea`
- 最终验收 HEAD：当前仍为 `1790efd56e49865c02d10b75566dd950c3e3beea`；本轮修复与本文件尚未由主调度形成 Git 检查点，限定审计应填入检查点 HEAD 并复核其后的任何实质改动。
- 验收 Agent：C31 Finalizer（`task_b2a7d2c35c40`）

## 结论

**BLOCKED**：已批准范围内的实现、修复与回归通过；本轮修改了 C31 来源资格和游标读取边界，限定审计尚未执行，故当前不能给出 PASS。审计须核对本文件列出的范围、证据和实际检查点 HEAD，并在同一工件填写结论。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| R1/S1 获权主题关联图；IP-01/03/04/06 | `postgres-workflow-projection.test.ts` 的多运行图测试；`postgres-workflow-projection.ts` 的 `#readAssociationGraph`、`#graphRunIds`、`#graphLinks` | 真实 PostgreSQL 下按精确边返回关系、版本、阶段、审计和 C22 当前允许的定位；无领域正文。 |
| R1/S2 未触发或不可证明；IP-04/06 | 图测试的 C22 失败、错引用、缺失窄读端口与越界分支；`#evidenceBatch` | 整页失败，不以登记时的旧定位或半页结果冒充完整图。 |
| R2/S1 同修订报告；IP-01/02/03/05/06 | 报告测试的 101 项续页、同 ID 不同事实类型、历史重读和结果正文错运行身份；`#reportRunEntries` | 事实与缺席项按稳定身份续页；晚于登记时点的运行不进入旧查询；正文所指运行不一致时显式失败。 |
| R2/S2 缺失或依据不足；IP-03/05/06 | 空修订及 `skippedTails` 测试 | 合法空修订返回空页；已有运行只返回成立事实和登记的缺席原因，无默认等级。 |
| R3/S1 撤权后不可读；IP-02/03/06 | 撤权同形测试、C30 查询登记测试；`readPage` 的 C05 复验与授权摘要对账 | 撤权后的结果与不存在目标同形；空间目标随登记冻结并逐页复验。 |
| R3/S2 有界分页与伪游标；IP-02/03/04/05/06 | 图、报告测试中的伪造位置、错查询游标、分页与硬上限；迁移 up/down 与索引测试 | C31 游标位置须属于冻结图边或报告候选；图最多 32 个关联运行、1000 条边，单运行报告最多 1000 项；越界显式失败。 |
| R3/S3 旧/未知分支；IP-01/03/06 | contracts 测试、`run-view`/`trace-chain` 回归及旧分支无 C22 读端口测试 | 旧分支继续可读，未知查询类型稳定拒绝。 |
| IP-02 持久化与审计 | `postgres-workflow-adapter.test.ts`、`postgres-foundation.test.ts` | `000051` 迁移可往返；查询登记、回读、幂等及只追加角色限制通过。 |

本轮修复仅涉及 `packages/adapters/src/workflow/postgres-workflow-projection.ts` 与现有 `packages/adapters/test/workflow/postgres-workflow-projection.test.ts`：修正同 ID 不同事实类型的分页排序键；对 C31 图/报告按 C22 精确引用复验来源并优先使用当前证据定位；拒绝缺失或错配来源、无效游标位置及错配的运行身份；提高图主题种子读取上限至硬边界以避免伪完整图。旧 `trace-chain` 在未注入 C22 时保留原行为。未新增依赖、公共字段或迁移。

实际命令与结果：

- `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`：4 文件、59 测试通过（真实 Testcontainers PostgreSQL）。
- 最后一次局部修复后 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts`：1 文件、12 测试通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm format:check`、`pnpm openspec:validate`、`git diff --check`：均通过；OpenSpec 严格校验为 34 项通过、0 失败。合成夹具均为“合成样本、待甲方复核”。

## 限定审计

**必须执行，当前待审计**。范围：C31 图与报告的 C05 当前授权及 C22 来源资格复验、旧 `trace-chain` 权限语义、冻结查询与游标位置绑定、C30 查询登记及 `000051` 迁移的权限/事务/索引边界。Targeted Auditor 在此处补入检查点 HEAD、发现、任务内修复、回归命令、审计结论与证据；有实质修复时同步更新上方结论和最终验收 HEAD。

## 后续注意事项

报告只披露已成立的精确引用、审计与获准定位；P/C 和风险等级正文不在本 change 的只读契约内。C40/C41 尚未闭合的全链场景只能按已成立切片解释。
