# Verification

## 验收对象

- Change：`deliver-relationship-context-and-retrieval-agent-review`（`orchestrated-delivery`）
- 输入实现 HEAD：`11545c9ac1480c3466d0d458b7f2b4f555a68132`（同步 main 后的 C21 检查点）
- 最终验收产物 HEAD：`11545c9ac1480c3466d0d458b7f2b4f555a68132`；本轮仅更新本 verification，待协调端形成工件检查点。
- 验收 Agent：本轮 Finalizer `task_8a44bbf229af`；此前 Finalizer `task_20116417c841`、限定审计 Agent `task_d24cb6989f7c`

## 结论

**PASS（产物 HEAD `11545c9ac1480c3466d0d458b7f2b4f555a68132`）。** 已批准的 C21 实现、此前收尾修复和限定审计已进入 Git 检查点；本轮在同步 main 后重新通过 C21 行为、真实 PostgreSQL、共享迁移及静态验证。C24 的生产冻结输入和识别图接线、C22 的风险候选生成属于后续 change，不计入本次结论。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| 精确关系查询：一跳节点/依赖/机理，错工程、断边、撤权；IP-01、IP-02、IP-07 | `packages/core/test/identification/context.test.ts`；V-01 | 精确发布和资料段可回读；拒绝路径不登记部分结果 |
| 关系结果不可变身份：同键重放、异载荷冲突、事务回滚；IP-03、IP-07 | `packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`；V-02 | 真实 PostgreSQL 容器覆盖追加表、角色权限、审计回滚与重复登记 |
| C20 双路基线与有限补搜：正式查询引用、稳定 queryId、越界/预算失败；IP-04、IP-05、IP-07 | `apps/worker/test/identification/context/{composition,runtime}.test.ts`、C20 回归；V-03、V-04 | 单一委派与共享 C08 runner；失败不产生正式检索集 |
| 类型化选择增量：冻结版本/成员/证据/范围校验、来源失效；IP-05、IP-07 | `packages/core/test/identification/context.test.ts`；V-01、V-03 | 既有修复覆盖版本和授权摘要绑定、按精确工作项范围复验与越界拒绝 |
| RI-S56 五项上下文：固定来源重放、缺受力/状态/机理/证据阻断；IP-06、IP-07 | `packages/core/test/identification/context.test.ts`；V-01 | 逐项核对关系结果、已完成审阅、三类发布与 C20 正式基线；同工作项不同任务得到独立身份 |
| 必经审阅失败及恢复：撤权重放、引用不符、零正式结果；IP-05、IP-06、IP-07 | C21 核心/Worker、C08/C17/C20 回归；V-01～V-04 | 已成立动作沿任务预算重放；失效资格不进入正式上下文 |
| 同步 main 的共享迁移解除块；IP-03、IP-07 | `git show --cc HEAD -- packages/adapters/src/postgres/migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.ts`；`pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` | C21 与 C27 各自的外键解除块均保留；真实 PostgreSQL 测试 17/17 通过 |
| 工件、类型、依赖和格式；IP-01～IP-07 | V-05～V-07，`git diff --check` | 检查通过；本轮未引入依赖或公共契约变更 |

此前收尾及限定审计修复（已纳入同步前的 `101a2e7` 检查点）：

1. `service.ts`：候选版本、冻结授权摘要与授权上下文不符时终止；按精确工作项空间/资料范围复验当前权限，并在候选事实回读时向 C06 传递该范围。审阅准备发现越界时，在关系登记与 C04 写入前拒绝。
2. `service.ts`：五项上下文在写入前核对任务、输入、工作项、三类发布、授权摘要、C20 正式基线和审阅引用；缺状态参数返回结构化阻断。相同任务重放读取既有不可变产物，不重复审计。
3. `schema.ts` 与 `service.ts`：上下文结果实体身份包含工程、工作项和审阅任务；同工作项不同审阅任务互不覆盖。
4. C21 核心及 Worker 现有测试：补冻结版本、越界范围、撤权重放、跨工作项引用、发布不符、五项缺失、双任务身份与零副作用回归；修正夹具授权摘要。
5. `design.md`、`implementation-plan.md`：迁移路径措辞与 provider 的唯一迁移域 `risk-identification` 对齐；未移动迁移文件或修改 `000041`。
6. 限定审计在 `service.ts` 统一复验冻结候选集与任务的授权摘要/上下文引用，并在冻结结果工具、补搜工具和正式收口前复验工作项当前空间与资料权限；C20 正式结果回读同时核对 actor。`context.test.ts` 覆盖“校验通过后撤权”的时序及跨 actor 正式结果拒绝。

本轮代码修复：无。

本轮在最终产物 HEAD 上实际运行的验证命令：

```text
pnpm exec vitest run packages/core/test/identification/context.test.ts packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts apps/worker/test/identification/context/composition.test.ts apps/worker/test/identification/context/runtime.test.ts packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts apps/worker/test/retrieval/composition.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/core/test/agent-runtime/agent-runtime.test.ts
pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts
pnpm exec tsc -b packages/core packages/adapters && pnpm typecheck && pnpm deps:check
pnpm exec eslint packages/core/src/identification/context packages/core/test/identification/context.test.ts packages/adapters/src/identification/context packages/adapters/test/identification/context apps/worker/src/identification/context apps/worker/test/identification/context apps/worker/src/index.ts && pnpm exec prettier --check openspec/changes/deliver-relationship-context-and-retrieval-agent-review packages/core/src/identification/context packages/core/test/identification/context.test.ts packages/adapters/src/identification/context packages/adapters/test/identification/context apps/worker/src/identification/context apps/worker/test/identification/context apps/worker/src/index.ts
openspec validate deliver-relationship-context-and-retrieval-agent-review --type change --strict --no-interactive
git diff --check
```

结果：8 个 C21 及直接依赖测试文件、81 项测试全部通过；共享迁移测试 17/17 通过，均包含真实 PostgreSQL 容器路径且无关键 skip。TypeScript 构建与全仓类型检查、依赖边界、定向 ESLint、Prettier、严格 OpenSpec 校验及 diff 空白检查均通过。

## 限定审计

- 此前限定审计范围：C06 空间/资料授权与撤权时序、C21 来源及 C20 基线引用绑定、C03 审计事务回滚、同工作项双任务结果身份和稳定补搜恢复。
- 结论：**PASS**。审计发现 C08 候选校验与 C21 工具读取/正式登记之间缺少当前授权复验，且 C20 正式结果未核对 actor；已在此前审计任务内修复，并保持 C06/C08/C20 公共契约、迁移和事务语义不变。
- 权限与来源证据：`context.test.ts` 新增校验后撤权用例，确认冻结读取、补搜和正式收口均拒绝，零 C20 调用、零正式登记与审计；跨 actor 的 C20 正式结果拒绝。原有测试覆盖错工程、越界资料、撤权重放、发布/来源引用不符及五项上下文身份。
- 事务与恢复证据：真实 PostgreSQL 适配器测试覆盖追加表角色权限、同键重放、异载荷冲突、审计 FK 与回滚；C21/C08/C20 Worker 测试覆盖稳定补搜 queryId、候选版本、失败零正式结果及共享 runner。审计后运行上述 8 文件命令，81/81 通过；另运行 `pnpm exec tsc -b packages/core packages/adapters`、`pnpm typecheck`、`pnpm deps:check`、定向 ESLint/Prettier、严格 OpenSpec 校验及 `git diff --check`，均通过。
- 本轮机械同步核对：`11545c9` 的冲突解决仅涉及 `000001_foundation.ts` 的 `down()`；C21 的 `identification_context_results_audit_fk` 解除块与 C27 四张表的 command/audit 外键解除块按并集合入，各有表存在性守卫及 `DROP CONSTRAINT IF EXISTS`，前向迁移、权限、事务和状态机语义未变。协调端已核对两组解除块均在且无冲突标记，并在同步后运行共享迁移与 C21 core 测试 32/32 通过；本轮又在产物 HEAD 上运行共享迁移 17/17 及 C21/直接依赖 81/81。此前限定审计覆盖的 C21 自有权限、事务与身份语义未发生变更，协调端裁决本轮无需再触发限定审计。

## 后续注意事项

- 甲方脱敏工程资料尚未提供；现有冻结样本均为“合成样本、待甲方复核”。
- C24 需提供生产冻结输入与策略并连接识别图；C21 当前仅暴露必需窄端口与组合根。
