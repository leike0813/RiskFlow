## Context

基线 `2ca676833916a2bfdbb250e17582a6fb4ed8688a`。协调端提供了三项复现：A，新工作树继承 main 的未归档非路线 change，`deriveSnapshot` 仅凭 `openSpecNames` 生成辅助节点并在多个工作树上报 `duplicate_active_worktree`；B，`deriveNodeState` 只用祖先关系判 `featureMerged`，HEAD 等于 main HEAD 的新分支也满足该关系；C，Codex 初次启动卡在工作区信任提示，现有 `startWorker` 只能在失败后通过屏幕探测归类、交给操作者手工确认。

现有 `status.test.mjs` 和 `control.test.mjs` 已覆盖辅助工作项采纳、祖先关系及信任恢复的邻近路径。Codex 的用户级 `[projects."<path>"]` 信任条目仅作为协调端可执行的修复指引；控制器不读取或写入该配置。

## Goals / Non-Goals

**Goals:** 用真实归属证据隔离继承副本；未归档工作树必须有区别于 main 的产物提交才可判已合并；受控 Codex terminal 明确报告当前工作树的信任阻断并保留既有恢复。

**Non-Goals:** 不验证 pnpm/OpenSpec/Mattpack/CodeGraph setup 就绪，不重跑 setup，不修改用户级 Codex 配置文件，不改业务代码、已归档规格、执行图语义或本任务消息路由。

## Decisions

### D1：辅助工作项归属从 main 与精确信封共同确定

`collectFacts` 额外读取当前 main 的活动 OpenSpec change 名称，并传入状态推导的内部 facts。`deriveSnapshot` 对非路线名称先找有效 v2 辅助任务/尝试信封，其 `workItemId`、`changeName`、`worktreeId` 必须精确匹配；存在这种归属时只使用归属工作树。没有信封时，仅将 worktree 有而 main 活动列表没有的 change 当作本地登记，进入待采纳。main 已有的同名活动 change，即使出现在新工作树目录中，也不构成采纳。两个工作树各有独立本地登记或精确信封时继续报告重复冲突。备选的“看到文件就采纳”是 A 的根因；按分支名或自然语言推断所有权不符合现有结构化身份契约。

### D2：未归档合并要求 feature HEAD 与 main HEAD 不同

`deriveNodeState` 的 `featureMerged` 仍以 main 已提交归档为优先证据。没有该归档时，同时要求工作树干净、`ancestry[node.id]` 为真、工作树 HEAD 存在且 `worktree.git.head !== main.head`。这一个共享判据用于路线与辅助节点；`collectFacts` 仍按各自 id 采集祖先关系。已归档后的完成与回收条件、主线 checkpoint 的祖先检查均不改。备选的在每处状态分支分别打补丁会让 merged、main_verified、resumeQueue 再次漂移。

### D3：Codex 信任由协调端在精确 terminal 完成

`startWorker` 在 Planning、Finalizer、Targeted Auditor 的 Codex terminal 启动前校验 `node.worktree.path` 为与完整 `worktree.id` 一致的绝对受管路径。控制器不向 Codex 启动命令注入信任覆盖，不读取或改写用户级 `config.toml`。若该路径尚未信任，由协调端或人在精确 Orca terminal 完成确认；也可只为该路径配置用户级 `[projects."<path>"]` 下的 `trust_level = "trusted"`。Implementation 的 OMP terminal 不执行 Codex 信任操作；已有 `terminalHandle` 的恢复分支不另建 terminal。

### D4：信任失败继续原有可诊断链路

若 terminal 未达到 idle，或 `worker-start` 的 `dispatch_input` 阶段报 `agent_prompt_stalled`，继续调用现有 `terminalShowsWorkspaceTrustPrompt` 与 `recordWorkspaceTrustRecovery`。识别为信任提示时返回 `workspace_trust_required`、完整工作树路径、精确 terminalHandle、人工修复指引和同 Task 恢复动作。探测不可用或 Codex 配置不可读时沿原始错误失败闭合，不提交 worker 任务；工作树身份不一致在 terminal 创建前拒绝。

### 本 change 边界与用户裁决

用户于 2026-09-25 裁决由协调端通过 Orca terminal 手动完成新工作树信任，自动信任移出本 change 范围；批准记录见 `approval-2026-09-25-scope-narrowing-trust.md`。本机 Codex CLI 0.156.1 实测：预置目标路径信任条目后，`worker-start` 成功派发 c31、c41、c42；未预置时返回 `agent_prompt_stalled`。该版本的 `-c` 信任覆盖不能使全新目录跳过信任提示，因此不作为验收依据。

### D5：状态与文件所有权

`scripts/orchestration/status.mjs` 和 `status.test.mjs` 负责 A/B；`scripts/orchestration/control.mjs` 和 `control.test.mjs` 负责 C。内部 facts 可增加 main 活动名称，公开 snapshot、v2 信封、Orca API、运行时台账和数据库结构不变。不新增依赖、迁移、业务权限或审计字段；受控派发的 revision 与幂等键、已有 fail-closed 错误边界保留。RI/RA 业务链路不受影响。

## Risks / Trade-offs

- A 的无 Task 待采纳只对 main 中没有的本地 change 自动成立。若同名 change 已在 main，工作树需要精确辅助任务/尝试信封才能表明自己的归属；这是避免继承污染的有意收窄。
- B 只用 HEAD 不等与祖先关系判“已进主线”，不推断未提交改动；主线归档仍可独立证明完成。
- C 的信任提示需要协调端处理。实施测试验证类型化结果包含完整路径与修复指引、已信任后正常派发，以及探测不可用时失败闭合；控制器不改写用户配置或扩大路径。
- 已知限制：worker 的 `ask` 可能落在其 Dispatch 自己的 Run 上，协调端需按 Run 拉取。本 change 不修改消息路由。

## Migration Plan

无数据迁移、依赖安装或配置文件转换。三项修复及定向测试在同一 change 实施；回退仅回退本 change 的代码，已有 Orca worktree、Task 与 Codex 用户配置保持原样。
