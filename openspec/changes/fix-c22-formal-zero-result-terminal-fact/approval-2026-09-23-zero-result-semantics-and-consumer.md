# C39 规划变更批准记录（2026-09-23，第二轮：语义变更与消费面）

- 批准引用：`approval://riskflow/C39/scope-2026-09-23-zero-result-semantics-and-consumer`
- 批准来源：项目方在本会话明确指示（「planner 在我的指示下自己做出了裁决并完成了规划；若与协调端裁决不一致，可追加一轮规划变更，特别允许复用 session」）。
- 取代：本 change 首轮的窄加法裁决（`approval://riskflow/C30/...` 无关；针对 C39 的首轮口径见 `msg_fe3bc751e790` 的回复）。首轮口径要求「纯加法、不得改动『模型输出为空 ⇒ 结构化失败』语义」；本轮**明确改为**：允许**有意变更**该语义，理由与边界见下。
- 触发事实：C39 规划者在项目方指示下作出裁决并完成规划：`design.md` 明确写入「本 change 是有意改变『合法空输出为失败』的既有语义」；`D-01` 把 `RiskCandidateModelOutputV1Schema.candidates` 放开为允许 0 个，并定义 `RiskCandidateZeroResultV1`、`IdentificationZeroResultRefV1`、`IdentificationAnalysisSuccessV1Schema` 的 `zero-result` 分支与 `000049_formal_zero_result.ts`（含 C24 `zeroResults[]` 与 I4/I9 汇总）。该规划已含：无新 capability/角色/权限值（沿原 `risk-identification.run`）、无新依赖、非空路径行为不变、迁移可重复且回滚需在存在零结果行时保留可读版本。

## 本轮规划变更必须闭合的四项

1. **把语义变更写成批准事实**：在 `proposal.md`/`design.md` 明确：(a) 本 change 有意改变 C22 已归档语义（空候选输出由「失败」改为「合法的零结果成功终态」），(b) 受影响并**必须逐项列出**的已归档 change 与文件（至少 C02 `packages/contracts/src/{ports,workflows}/index.ts`、C22 `packages/core/src/identification/candidate-finalization/**` 与 adapter/迁移、C24 `apps/worker/src/identification/graph/**` 与 `packages/core/src/identification/graph/**`），(c) 为什么「运行级零结果事实」必须由「合法空输出」表达（把空候选塞进非空候选集或伪造风险记录都不可接受）。若与已归档 C22 规格文字冲突，在本 change 的 spec delta 中给出前后对照，不改写既有归档快照。
2. **闭合消费面（C36 的 TN/覆盖证明）**：明确一个**可被 C36 使用**的精确读路径：由谁（C24 `IdentificationGraphRunResultV1.zeroResults[]`、C22 零结果引用或其只读接缝）在什么授权与失败闭合语义下证明「该运行在其冻结范围内没有任何 accepted 记录」。必须落到 IP-ID、允许文件与可运行验证命令；不得只在 design 里描述语义。这是本 change 存在的理由，缺失即视为未闭合。
3. **不越界**：不得改动 C24 已审计的 D-15（stage-result 判别与 `000043` 收敛）与 D-07（逐引用对账 + checkpoint 恢复）语义，只允许**加法**（如 `zeroResults[]` 字段与 I4/I9 汇总分支）；不得改写 `000042` 或更早迁移，`000049` 之外的 schema 变化必须先 escalation；不得新增 capability/角色/权限值、不得引入生产运行时依赖；不得改动其它 change 的既有对外行为（非空候选路径、I5～I8 复核/风险记录/事件）。
4. **迁移与回滚纪律**：`up` 可重复执行、`down` 逆序且在有零结果行时保留可读版本（其自身已写明，需落到任务与验证命令）；必须按既有方式登记测试侧迁移 id（`packages/adapters/test/auth/fixture.ts`、`packages/adapters/test/postgres/postgres-foundation.test.ts`）；若对其它 change 已发布表建外键，须在该旧迁移 `down` 中补跨 change 回滚解除块。

## 提交方式

本轮允许**复用原规划 session**（项目方明确许可）：在本 change 现有规划工件上增量补齐上述四项，不需要重写既有结论；完成后 `worker_done` 列出新增/修改的工件、精确消费路径与验证命令，以及仍未闭合项。
