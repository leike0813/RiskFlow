# Verification

## 验收对象

- Change：`deliver-relationship-context-and-retrieval-agent-review`（`orchestrated-delivery`）
- 输入实现 HEAD：`e3fe616a05f16b3e75f342a75ed22ff749c1c1bd`
- 当前验收代码基础 HEAD：`e3fe616a05f16b3e75f342a75ed22ff749c1c1bd`，叠加本任务未提交修复；正式输出 HEAD 待协调端形成 Git 检查点后填入。
- 验收 Agent：C21 Finalizer，`task_20116417c841`

## 结论

**BLOCKED（限定审计待完成）。** 当前已批准的 C21 实现与本轮修复通过下列行为、真实 PostgreSQL 和静态验证；权限范围、来源绑定与上下文结果身份的限定审计尚未完成，因此不能给出最终 PASS。C24 的生产冻结输入和识别图接线、C22 的风险候选生成属于后续 change，不计入本次结论。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| 精确关系查询：一跳节点/依赖/机理，错工程、断边、撤权；IP-01、IP-02、IP-07 | `packages/core/test/identification/context.test.ts`；V-01 | 精确发布和资料段可回读；拒绝路径不登记部分结果 |
| 关系结果不可变身份：同键重放、异载荷冲突、事务回滚；IP-03、IP-07 | `packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`；V-02 | 真实 PostgreSQL 容器覆盖追加表、角色权限、审计回滚与重复登记 |
| C20 双路基线与有限补搜：正式查询引用、稳定 queryId、越界/预算失败；IP-04、IP-05、IP-07 | `apps/worker/test/identification/context/{composition,runtime}.test.ts`、C20 回归；V-03、V-04 | 单一委派与共享 C08 runner；失败不产生正式检索集 |
| 类型化选择增量：冻结版本/成员/证据/范围校验、来源失效；IP-05、IP-07 | `packages/core/test/identification/context.test.ts`；V-01、V-03 | 本轮增加版本和授权摘要绑定、按精确工作项范围复验与越界拒绝 |
| RI-S56 五项上下文：固定来源重放、缺受力/状态/机理/证据阻断；IP-06、IP-07 | `packages/core/test/identification/context.test.ts`；V-01 | 逐项核对关系结果、已完成审阅、三类发布与 C20 正式基线；同工作项不同任务得到独立身份 |
| 必经审阅失败及恢复：撤权重放、引用不符、零正式结果；IP-05、IP-06、IP-07 | C21 核心/Worker、C08/C17/C20 回归；V-01～V-04 | 已成立动作沿任务预算重放；失效资格不进入正式上下文 |
| 工件、类型、依赖和格式；IP-01～IP-07 | V-05～V-07，`git diff --check` | 检查通过；本轮未引入依赖或公共契约变更 |

本轮修复：

1. `service.ts`：候选版本、冻结授权摘要与授权上下文不符时终止；按精确工作项空间/资料范围复验当前权限，并在候选事实回读时向 C06 传递该范围。审阅准备发现越界时，在关系登记与 C04 写入前拒绝。
2. `service.ts`：五项上下文在写入前核对任务、输入、工作项、三类发布、授权摘要、C20 正式基线和审阅引用；缺状态参数返回结构化阻断。相同任务重放读取既有不可变产物，不重复审计。
3. `schema.ts` 与 `service.ts`：上下文结果实体身份包含工程、工作项和审阅任务；同工作项不同审阅任务互不覆盖。
4. C21 核心及 Worker 现有测试：补冻结版本、越界范围、撤权重放、跨工作项引用、发布不符、五项缺失、双任务身份与零副作用回归；修正夹具授权摘要。
5. `design.md`、`implementation-plan.md`：迁移路径措辞与 provider 的唯一迁移域 `risk-identification` 对齐；未移动迁移文件或修改 `000041`。

实际验证命令：

```text
pnpm exec vitest run packages/core/test/identification/context.test.ts packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts apps/worker/test/identification/context/composition.test.ts apps/worker/test/identification/context/runtime.test.ts packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts apps/worker/test/retrieval/composition.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/core/test/agent-runtime/agent-runtime.test.ts
pnpm exec tsc -b packages/core packages/adapters && pnpm typecheck && pnpm deps:check
pnpm exec eslint packages/core/src/identification/context packages/core/test/identification/context.test.ts packages/adapters/src/identification/context packages/adapters/test/identification/context apps/worker/src/identification/context apps/worker/test/identification/context apps/worker/src/index.ts && pnpm exec prettier --check openspec/changes/deliver-relationship-context-and-retrieval-agent-review packages/core/src/identification/context packages/core/test/identification/context.test.ts packages/adapters/src/identification/context packages/adapters/test/identification/context apps/worker/src/identification/context apps/worker/test/identification/context apps/worker/src/index.ts
openspec validate deliver-relationship-context-and-retrieval-agent-review --type change --strict --no-interactive
git diff --check
```

结果：8 个测试文件、79 项测试全部通过（含真实 PostgreSQL 容器）；TypeScript 构建与全仓类型检查、依赖边界、定向 ESLint、Prettier、严格 OpenSpec 校验及 diff 空白检查均通过。

## 限定审计

- 范围：C06 空间/资料授权签发与撤权重放、C21 来源及 C20 基线引用绑定、C03 审计事务回滚、同工作项双任务结果身份和稳定补搜恢复。
- 结论与证据：**待协调端派发本轮唯一一次 Targeted Auditor 后补入**；审计必须针对最终检查点 HEAD，发现的批准范围内缺陷由审计任务内修复并回归。

## 后续注意事项

- 甲方脱敏工程资料尚未提供；现有冻结样本均为“合成样本、待甲方复核”。
- C24 需提供生产冻结输入与策略并连接识别图；C21 当前仅暴露必需窄端口与组合根。
