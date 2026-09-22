# Verification

## 验收对象

- Change：`deliver-risk-candidate-validation-merge-and-acceptance`
- 实际 schema：`orchestrated-delivery`
- 输入实现 HEAD：`7b2a1408368ff202fc845e9fd1096c72d44160aa`
- 当前工作树 HEAD：`7b2a1408368ff202fc845e9fd1096c72d44160aa`
- 最终验收产物：上述 HEAD 加本轮未提交修复；生产代码与测试 diff 摘要为 `51518be06b3d7fb370beddf129613081ec39f5b3cc07bc90dcc9f2d534e9ea2c`。受控 settle 形成的 `outputHead` 由协调端记录，限定审计须在最终检查点上补记实际 HEAD。
- 验收 Agent：Finalizer Task `task_c21da8eecb96`，Dispatch `ctx_cfc562b442b0`
- 样本边界：本 change 的模型、上下文、候选、策略和决定测试均为“合成样本、待甲方复核”。

## 结论

**BLOCKED（待本收尾轮次唯一一次 Targeted Auditor 限定审计）。** Finalizer 已完成 15/15 tasks、8 项 Requirement、21 个 Scenario 与 IP-01～IP-10 的实现核验、范围内修复和 V-01～V-08 回归，未发现剩余普通缺陷。由于 change 本身涉及权限、事务、人工决定关键状态和正式记录唯一性，且本轮修复触及验收决定状态机、写前授权复验与事务回放，implementation-plan §8 要求的限定审计完成前不得给出 PASS 或进入集成。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
| --- | --- | --- |
| 风险候选只从冻结五项上下文生成；精确生成、输入/输出不合格；IP-01～IP-03、IP-07、IP-09 | V-01、V-03；`service.ts` 的 `assemble-and-infer` 成功路径与动态预算失败关闭；Worker structured gateway 定向测试 | PASS；新增成功登记与超候选数预算零正式候选回归 |
| 候选逐项校验与有界修正；通过、可修正重试、不可修正失败；IP-01、IP-03、IP-04、IP-07 | V-01、V-03；确定性 check、terminal 优先关闭、修正输出与父候选一一对应、累计 token/字节/墙钟预算 | PASS；修复 terminal 与 repairable 混合时错误继续修正并丢候选的问题 |
| 全运行重复检测和冻结策略合并；多来源合并、无重复显式跳过、输入/策略错配；IP-02、IP-05、IP-07 | V-01～V-03；三信号稳定分组、完整工作计划、embedding 与 `no-duplicate` 断言 | PASS |
| 综合置信度可解释、可重放、缺依据关闭；IP-04、IP-05 | V-01；四类 basis、权重归一、缺项策略、舍入与 RRF 排除 | PASS |
| 每组合并组唯一验收路线；自动、人工、路由失败；IP-06、IP-07 | V-01、V-02；新增高置信自动路线成功回归，既有人工快照/C07 请求及失败关闭测试 | PASS |
| 决定逐组匹配；自动与人工共同验收、陈旧/错配阻断；IP-06、IP-08 | V-01、V-02；新增自动决定按 route 精确匹配并成功入库回归；C07 pending/superseded/wrong-target/cross-project 适配器测试 | PASS；修复原实现以 decision ref 查询 group ref、导致正常验收恒定 `decision-missing` 的错误 |
| 标准化记录与事件原子成立；合格入库、失败回滚、重放/并发、中间登记追加式；IP-01、IP-07、IP-08、IP-10 | V-01、V-02、V-04；真实 PostgreSQL 事务、审计/Outbox、唯一键、同 ref replay/conflict、角色与无 UPDATE/DELETE | PASS；修复事务 receipt 重放丢失原事件引用并误报 arity failure；正常回放保持一份记录与事件 |
| 权限与资料可见性；处理期间撤权、跨工程不可枚举；IP-02、IP-06～IP-08 | V-01、V-02、V-05；分支当前授权、C21/C07 窄读与跨工程拒绝 | PASS（Finalizer）；正式记录事务前新增第二次当前授权复验并使用收口后的 scope/context，仍须按下节限定审计 |
| 包导出、迁移机械清单与直接依赖无漂移；IP-09、IP-10 | V-04～V-07；base→HEAD 文件均在 implementation-plan §7 allowlist，protected files 与 lockfile 未修改 | PASS |

### 验收阶段修复

1. 将中间结果待写 `artifactRef` 从严格 Schema 无法接受的空字符串改为确定性待写引用；`#persistRows` 仍在登记前以 C04 返回的真实内容引用覆盖。修复前 assemble、repair、merge、route 的正常结果会在工件写入前直接抛出 ZodError。
2. 对生成与修正执行冻结的候选数、总 token、输出字节和墙钟预算；超限失败关闭，不再用 `slice` 静默截断。修正只接受与 repairable 父候选等数的输出，保留精确父候选引用和递增版本；任一 terminal 候选立即阻断。
3. `accept-groups` 按 route 中的系统决定或 C07 返回的人工决定精确匹配提交的决定集合；自动路线不再无条件申请 `review-audit.trace`。正式写入前再次复验当前授权，并把收口 scope/context 用于记录、命令、审计与事件。
4. 相同原子命令重放沿用 C03 receipt 的原事件引用，不再因 `eventRefs` 被清空而误报 `acceptance-event-arity`。
5. 新增正常 assemble、自动 route、自动 accept 与 receipt replay、候选预算超限、terminal/repairable 混合关闭等稳定行为回归；未增加依赖或修改公共契约、权限矩阵、迁移及 protected files。

### 实际命令

| 命令 | 结果 |
| --- | --- |
| V-01 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts` | PASS：1 file / 40 tests |
| V-02 `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` | PASS：2 files / 20 tests；真实 PostgreSQL，无关键 skip |
| V-03 `pnpm exec vitest run apps/worker/test/identification/candidate-finalization/runtime.test.ts apps/worker/test/identification/candidate-finalization/composition.test.ts` | PASS：2 files / 17 tests |
| V-04 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` | PASS：1 file / 17 tests；迁移 up/down/up、角色与追加式约束实际执行 |
| V-05 `pnpm exec vitest run packages/core/test/identification/context.test.ts packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts apps/worker/test/identification/context/composition.test.ts apps/worker/test/identification/context/runtime.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts` | PASS：5 files / 49 tests |
| V-06 `pnpm exec tsc -b packages/core packages/adapters apps/worker && pnpm typecheck && pnpm deps:check` | PASS；344 modules / 966 dependencies，无边界违规 |
| V-07 implementation-plan §1 的 ESLint 与 Prettier 命令 | PASS |
| V-08 `openspec validate deliver-risk-candidate-validation-merge-and-acceptance --strict --no-interactive && git diff --check` | PASS：change valid；diff 无空白错误 |

## 限定审计

本轮必须且最多执行一次 Targeted Auditor。审计范围：

- 撤权后的写前复验、跨工程/越界引用不可枚举，以及错误、日志、事件不泄露正文；
- C07 pending、superseded、wrong-target、cross-project 与决定集合逐组匹配；
- C03 audit/Outbox 故障整体回滚、receipt replay、同 `riskRecordId` 并发唯一性；
- 中间表无 UPDATE/DELETE、正文仅在 C04、跨层只按公共 standardized record ref 消费；
- 本轮修复的 terminal/repairable 状态转换、父子候选版本和冻结总预算不得被重试绕过。

审计结论、最终检查点 HEAD、finding、任务内修复和实际回归证据：**待 Targeted Auditor 在本节补写。**

## 后续注意事项

- C24 的生产工作计划 reader 与 I0～I9 图接线仍属于后续 change；不影响 C22 深模块在已批准窄端口上的当前结论。
- 甲方脱敏样例尚未提供；当前行为证据使用已明确标识的合成样本。
