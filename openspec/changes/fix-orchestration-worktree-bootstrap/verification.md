# Verification

## 验收对象

- Change：`fix-orchestration-worktree-bootstrap`（实际 schema：`orchestrated-delivery`）。
- 输入实现 HEAD：`18e34660e724f819610c1d34fe4e501b4811bccb`。
- 当前产物 HEAD：`18e34660e724f819610c1d34fe4e501b4811bccb`；验收改动仍在工作树，最终产物为该 HEAD 加本 change 的未提交差异。受控检查点形成后须将新 HEAD 回填。
- 验收 Agent：Codex Finalizer，`task_b97752099ffe`。
- 范围裁决：`approval-2026-09-25-scope-narrowing-trust.md`，用户经协调端批准 C 改为人工信任与类型化恢复。

## 结论

**PASS。** 修订后 A/B/C 的 Requirement、Scenario 与 IP-A1～IP-C2 均有对应实现和定向证据，任务 6/6 已完成。本轮依实时信封 `auditPolicy=self`、`auditRequired=false` 执行自审，结论通过。C 的自动信任不属于本次获批范围；工作树与 main 的 OpenSpec 全量校验差异见下文基线事实。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 代码及行为证据 | 实际命令与结果 |
|---|---|---|
| 辅助采纳：继承副本、本地待采纳、精确信封、双真实所有者；IP-A1/A2 | `status.mjs:1191` 的 `ownsAuxiliaryChange` 同时供采集和推导使用；`status.mjs:1327` 只收精确归属或 main 中没有的本地登记，保留全部真实候选。`status.test.mjs` 的继承、待采纳、单一信封、双所有者及混合双归属用例覆盖四个场景。 | `pnpm exec vitest run scripts/orchestration/control.test.mjs scripts/orchestration/status.test.mjs`：2 文件、113/113 通过。 |
| 集成状态：未合并、真实祖先、main 尖端、归档、主线推进、未提交归档；IP-B1 | `status.mjs:999` 的共享 `featureMerged` 在有工作树时要求非空且不同于 main 的 HEAD；无工作树历史节点与 main 已归档路径沿原判据。`status.test.mjs` 覆盖 route/AUX 的 main 尖端、真实祖先、非祖先、缺失 HEAD 与历史归档/检查点。 | 同上，状态测试 47/47 通过。 |
| Codex 信任阻断：需要信任、已信任、非目标/非 Codex；IP-C1 | `control.mjs:1048` 以既有 `workspace_trust_required` 返回完整路径、terminalHandle、Orca terminal 手动确认或仅目标路径用户配置的指引；`control.mjs:1060` 在创建 Codex terminal 前验证绝对路径与受管 ID；`control.mjs:1095` 的启动命令不再注入信任覆盖。`control.test.mjs:277` 验证阻断前不执行 worker-start、指引内容和同 handle 恢复后成功派发；身份不符拒绝、OMP 分支无 Codex 信任操作。 | 同上，控制测试 66/66 通过。 |
| Codex 信任阻断：探测不可用/配置不可读、提示恢复；IP-C2 | `control.mjs:1123` 与 `:1146` 保留屏幕探测、queued Task 台账与同 terminalHandle 恢复；探测不可用时抛出原错误。`control.test.mjs:530` 模拟配置不可读且屏幕不可用，断言 worker-start 为零；`control.test.mjs:355`、`:839` 覆盖结构化失败及屏幕提示恢复。 | 同上，控制测试 66/66 通过。 |
| OpenSpec、代码风格与差异 | 本 change 的 proposal、两份 delta、design、implementation-plan、tasks 及批准记录一致。 | `openspec validate fix-orchestration-worktree-bootstrap --strict --no-interactive`：通过；`pnpm exec eslint scripts/orchestration/control.mjs scripts/orchestration/control.test.mjs scripts/orchestration/status.mjs scripts/orchestration/status.test.mjs`：通过；`pnpm exec prettier --check scripts/orchestration/control.mjs scripts/orchestration/control.test.mjs scripts/orchestration/status.mjs scripts/orchestration/status.test.mjs openspec/changes/fix-orchestration-worktree-bootstrap/*.md`：通过；`git diff --check`：通过。 |

验收期修复：A/B 保留全部真实 AUX 归属候选，并在存在工作树却缺失 HEAD 时阻止误判已合并，分别由 `status.mjs` 和 `status.test.mjs` 的当前差异体现。C 按用户裁决移除失效的 Codex `-c` 信任覆盖，补充目标路径与人工修复指引，验证已信任派发及探测失败闭合；对应 `control.mjs`、`control.test.mjs`。本轮同步修订 proposal、delta spec、design、implementation-plan、tasks，并新增批准记录。

### 历史验收证据

此前按旧版“首次启动自动信任”的 MUST 验收为 BLOCKED：Codex CLI 0.156.1 在全新目录使用 `-c projects.<path>.trust_level="trusted"` 后仍显示 `Folder access / Trust this folder?`，没有达到无需人工确认的 idle。`--strict-config` 的报错指向现有用户配置中的 `disable_response_storage`，不能单独证明信任覆盖被拒。该旧结论对应已被用户裁决移出范围的条款，运行时证据保留在此，当前结论依据修订后的 delta。

## 限定审计

实时 C42 信封为 `auditPolicy=self`、`auditRequired=false`；协调端裁决本轮由 Finalizer 自审，不派独立 Auditor。自审结论：**通过**。

- 权限边界：`control.mjs:1048-1160` 仅验证受管路径、在等待 idle 或 worker-start 失败时探测提示、返回类型化错误并记录同 Task 恢复；启动命令无 `trust_level`，没有读写用户级 `config.toml`，也没有改变 `-a never`、`-s danger-full-access` 或其他路径的信任。`control.test.mjs:638` 断言重复启动命令无信任覆盖，`:650` 断言身份不符时 terminal 未创建。
- 状态机：`status.mjs:1191` 的 `ownsAuxiliaryChange` 同时用于 `:1331` 推导与 `:1708` 采集；`featureMerged` 仅在存在工作树时新增非空且不同于 main 的 HEAD 门槛，main 归档和无工作树历史语义未变。`status.test.mjs:1475` 的混合双归属仍报重复，`:1526` 的继承副本不占所有权，`:1659` 的 main 尖端不报合并，`:1726` 的真实祖先仍报 merged、非祖先仍 finalized、缺失 HEAD 不报合并。
- 失败闭合：`control.test.mjs:530` 模拟配置不可读与屏幕探测不可用，原错误上抛且没有 worker-start。反例断言：若重新把继承副本计为所有者，`:1604` 会出现伪 AUX/重复违规；若把真实已合并分支误判为未合并，`:1726` 的 merged 断言失败。

## 基线事实与后续注意事项

- 本工作树基线早于 main 的 `fc7ec5c`，`pnpm openspec:validate` 在本工作树复现 33 passed、1 failed：范围外的已归档 `spec/orchestration/trust-recovery` Purpose 仍为占位文本；本 change 严格校验通过。当前 main 的 `fc7ec5c` 已修正该 Purpose（`git show main:openspec/specs/orchestration/trust-recovery/spec.md` 可见）；main 的 34/34 为协调端报告。本任务曾在 bare main 仓库路径尝试 `pnpm openspec:validate`，因无 `package.json` 无法重跑，未更改 main。不得在本 change 内修改该已归档规格。
- 范围外已知限制：自动信任未实现。按用户裁决，新工作树的 Codex 信任由协调端通过 Orca terminal 手动完成。
