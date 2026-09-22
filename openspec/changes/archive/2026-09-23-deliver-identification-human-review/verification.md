# Verification

## 验收对象

- Change：`deliver-identification-human-review`
- 实际 schema：`orchestrated-delivery`
- 输入实现 HEAD：`a038b45f67ef2bb24c6a51ae88e4e750f7cbb55c`
- Finalizer 检查点 / 限定审计输入 HEAD：`face42d2a96247ce89856afdfdf6fbb1aa880899`
- 当前工作树 HEAD：`face42d2a96247ce89856afdfdf6fbb1aa880899`
- 最终验收产物：上述 HEAD 加本轮仅对本 verification 的结论补充；生产代码与测试未修改，受控 settle 形成的 `outputHead` 由协调端记录
- 验收 Agent：Finalizer Task `task_1f4844a18eac`，Dispatch `ctx_396b4dde891d`
- 限定审计 Agent：Targeted Auditor Task `task_331784a67f1c`，Dispatch `ctx_fb0a401a5487`
- 样本边界：候选、证据、策略、任务和决定测试均为“合成样本、待甲方复核”

## 结论

**PASS。** Finalizer 已核对 10/10 tasks、7 项 Requirement、16 个 Scenario 与 IP-01～IP-07，并在已批准范围内修复三项偏差；本收尾轮次唯一一次 Targeted Auditor 又独立核对了授权先行、已决定任务对账、两阶段事务幂等、唯一恢复事件、冻结合并关系、陈旧竞态和语义 merge 影响。审计未发现剩余缺陷或范围漂移，V-01～V-08 均通过，可以进入受控集成。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
| --- | --- | --- |
| 精确待处理任务和冻结目标；pending、decided 同命令重放、superseded、错工程/目标/版本；IP-01、IP-02、IP-04 | V-01、V-02；C23 strict Schema、C07 授权先行窄读和任务事实对账 | PASS；已决定任务现在只在命令标识、幂等键、完成回执及决定引用全部匹配时开放重放，不同命令在任何修订副作用前返回陈旧结果 |
| 修正形成不可变后继并确定性重校验；合法修订、只读字段拒绝、校验失败；IP-01、IP-03、IP-04 | V-01；C22 `prepareReviewRevision` 的父子版本、模型事实保留、确定性校验及零模型调用断言 | PASS；修订字段运行时 Schema 直接裁剪 C01 `ModelOutputResultSchema`，C22 原 Schema 文件恢复不变 |
| 冻结证据和当前资料权限；范围内调整、快照外/撤权拒绝；IP-02、IP-03 | V-01、V-02；证据快照、五项上下文、当前授权复验及无正文结果断言 | PASS；新增来源已校验集必须属于任务冻结合并计划的回归，阻断跨路线策略/候选集替换 |
| 合并、分立及其它决定沿用 C07/C22；六类决定及后续 disposition；IP-04 | V-01；五类非修订决定参数化测试、修订决定引用及 C22 既有路线回归 | PASS；C23 未复制合并算法、未写正式记录、未新增决定种类 |
| 成功决定产生唯一恢复信号；原子提交、事务失败、重放；IP-04 | V-01、V-02；真实 PostgreSQL 的决定/回执/审计/Outbox 同事务与失败回滚 | PASS；V-02 为 1 file / 16 tests，无关键场景 skip |
| 批量原样通过/拒绝逐项隔离；部分陈旧、超限和重复任务；IP-01、IP-05 | V-01；批量全批预检、顺序结果和逐项 C07 调用计数 | PASS；没有跨任务事务、并发池或第二套公共批量 DTO |
| 重试与中断恢复保持候选/决定唯一；响应丢失、同键异载荷；IP-03～IP-05 | V-01、V-02；C03 修订回执、C07 决定回执和不同命令已决定任务负向回归 | PASS；相同载荷复用精确引用，异载荷冲突，不重复审计或恢复事件 |
| Worker 组合、导出和边界；IP-06、IP-07 | V-03～V-06；组合缺依赖失败、typecheck、依赖边界和代码格式 | PASS；未修改 contracts、权限矩阵、迁移、依赖、API/UI 或锁文件 |

### 验收阶段修复

1. 已决定任务原先向任意新命令返回冻结事实，修订分支会先登记新的候选/校验工件，再由 C07 判陈旧。现由 C07 adapter 在授权后核对 `review.decide-review.v1` 完成回执的命令标识、幂等键和任务决定引用；只有原命令可进入两阶段幂等对账。
2. C22 修订原先只核对分组、快照、候选集和已校验集的局部关系，未证明调用方提供的已校验集属于快照冻结的合并计划。现读取精确 `mergePlanRef`，核对工程、输入、工作计划、策略集、分组事实和 `validatedCandidateSetRefs` 成员关系；错路线在读取候选正文和登记结果前关闭。
3. 实现曾在计划外修改 C22 `schema.ts` 保存 C23 私有修订字段。现将运行时 Schema 收回 C23，并直接由 C01 `ModelOutputResultSchema` 排除只读 `modelConfidence` 后派生；C22 只保留计划内的窄端口类型和实现改动。

### 实际命令

| 命令 | 结果 |
| --- | --- |
| V-01 `pnpm exec vitest run packages/core/test/identification/human-review.test.ts packages/core/test/identification/candidate-finalization.test.ts` | PASS：2 files / 77 tests |
| V-02 `pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` | PASS：1 file / 16 tests；真实 PostgreSQL/Testcontainers，无关键 skip |
| V-03 `pnpm exec vitest run apps/worker/test/identification/human-review/composition.test.ts apps/worker/test/identification/candidate-finalization/composition.test.ts` | PASS：2 files / 15 tests |
| V-04 `pnpm typecheck` | PASS |
| V-05 `pnpm deps:check && pnpm deps:policy` | PASS：352 modules / 982 dependencies，无边界违规；policy OK |
| V-06 implementation-plan §1 的 ESLint 与 Prettier 命令 | PASS |
| V-07 `openspec validate deliver-identification-human-review --strict --no-interactive` | PASS：change valid；`openspec status` 显示 `orchestrated-delivery` 全部六项工件 done |
| V-08 `git diff --check && git status --short` | diff check PASS；工作树仅含本轮 9 个已审阅代码/测试路径及本 verification |

## 限定审计

- 状态：**PASS**；审计输入 HEAD 为 `face42d2a96247ce89856afdfdf6fbb1aa880899`。
- 授权：C07 在读取任务事实前验证 `review-audit.decide-review`；无权、错工程、错目标和错版本均闭合，不返回目标正文。已决定任务只有在 `review.decide-review.v1` 完成回执的命令 ID、幂等键和决定引用同时匹配时才开放原命令对账，其它命令在 C22 修订副作用前返回陈旧结果。
- 事务与幂等：C22 修订登记与 C07 决定保持两个既有本地事务；同载荷重放复用原候选、校验和决定引用，同键异载荷冲突。C07 决定、回执、审计和唯一 `review.review-resolved.v1` 事件同事务成立，失败回滚且不产生可消费恢复信号。
- 关键状态机：`pending | decided | superseded` 未扩张；冻结验证/证据快照、合并计划、来源候选集和来源已校验集关系均按精确引用收口。并发 loser 或阶段二失败留下的内容寻址工件没有 C07 决定引用，不能进入 C22 验收。
- 语义 merge：`251af7e7c6ec55865092e6aa1ba1a4c839d8d495..face42d2a96247ce89856afdfdf6fbb1aa880899` 为线性检查点序列，没有 merge commit 或冲突解决带来的额外语义影响；未发现公共契约、权限矩阵、持久化、迁移、依赖、API/UI drift。
- 审计发现与修复：无；本轮未修改生产代码或测试，仅补充本 verification 的最终结论。
- 独立回归：V-01 PASS（2 files / 77 tests）；V-02 PASS（1 file / 16 tests，真实 PostgreSQL/Testcontainers，无关键 skip）；V-03 PASS（2 files / 15 tests）；V-04～V-08 PASS。实际命令与 §“实际命令”一致，由本轮 Auditor 在上述固定 HEAD 重新运行。

## 后续注意事项

- C24 负责消费既有 `review.review-resolved.v1` 并恢复 I0～I9 识别图，C31/C33 分别负责查询投影和 Web/API 交互；这些后续范围不影响 C23 当前后端深模块核验。
- 甲方脱敏工程样例尚未提供，当前行为证据使用已明确标识的合成样本。
- 协调端须审阅全部 dirty paths 并形成受控检查点；本 Task 不提交、不合并、不归档。
