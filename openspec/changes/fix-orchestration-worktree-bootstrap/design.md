## Context

基线 `2ca676833916a2bfdbb250e17582a6fb4ed8688a`。协调端提供了三项复现：A，新工作树继承 main 的未归档非路线 change，`deriveSnapshot` 仅凭 `openSpecNames` 生成辅助节点并在多个工作树上报 `duplicate_active_worktree`；B，`deriveNodeState` 只用祖先关系判 `featureMerged`，HEAD 等于 main HEAD 的新分支也满足该关系；C，Codex 初次启动卡在工作区信任提示，现有 `startWorker` 只能在失败后通过屏幕探测归类、交给操作者手工确认。

现有 `status.test.mjs` 和 `control.test.mjs` 已覆盖辅助工作项采纳、祖先关系及信任恢复的邻近路径。OpenAI 的 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)将 `projects.<path>.trust_level` 定义为工作树信任项；[配置优先级](https://learn.chatgpt.com/docs/config-file/config-basic)说明 CLI `-c` 覆盖用户配置且仅作用于本次进程。该来源只用于确定 Codex CLI 配置方式，项目行为仍以本 change 的 specs 为准。

## Goals / Non-Goals

**Goals:** 用真实归属证据隔离继承副本；未归档工作树必须有区别于 main 的产物提交才可判已合并；受控 Codex terminal 只信任当前工作树并保留既有失败恢复。

**Non-Goals:** 不验证 pnpm/OpenSpec/Mattpack/CodeGraph setup 就绪，不重跑 setup，不修改用户级 Codex 配置文件，不改业务代码、已归档规格、执行图语义或本任务消息路由。

## Decisions

### D1：辅助工作项归属从 main 与精确信封共同确定

`collectFacts` 额外读取当前 main 的活动 OpenSpec change 名称，并传入状态推导的内部 facts。`deriveSnapshot` 对非路线名称先找有效 v2 辅助任务/尝试信封，其 `workItemId`、`changeName`、`worktreeId` 必须精确匹配；存在这种归属时只使用归属工作树。没有信封时，仅将 worktree 有而 main 活动列表没有的 change 当作本地登记，进入待采纳。main 已有的同名活动 change，即使出现在新工作树目录中，也不构成采纳。两个工作树各有独立本地登记或精确信封时继续报告重复冲突。备选的“看到文件就采纳”是 A 的根因；按分支名或自然语言推断所有权不符合现有结构化身份契约。

### D2：未归档合并要求 feature HEAD 与 main HEAD 不同

`deriveNodeState` 的 `featureMerged` 仍以 main 已提交归档为优先证据。没有该归档时，同时要求工作树干净、`ancestry[node.id]` 为真、工作树 HEAD 存在且 `worktree.git.head !== main.head`。这一个共享判据用于路线与辅助节点；`collectFacts` 仍按各自 id 采集祖先关系。已归档后的完成与回收条件、主线 checkpoint 的祖先检查均不改。备选的在每处状态分支分别打补丁会让 merged、main_verified、resumeQueue 再次漂移。

### D3：Codex 信任只作为本次受控 terminal 的配置覆盖

`startWorker` 仅在新建 Planning、Finalizer、Targeted Auditor 的 Codex terminal 时，将精确 `node.worktree.path` 编码为 TOML 引号键，通过 Codex CLI 的单次 `-c projects.<quoted-path>.trust_level="trusted"` 传入启动命令。路径须是与完整 `worktree.id` 一致的绝对受管路径；构造 Orca 的 `--command` 字符串时对整个 `-c` 参数做 shell 安全引用。Implementation 的 OMP terminal 不使用该配置；已有 `terminalHandle` 的恢复分支不另建 terminal。配置随该 Codex 进程结束而消失，因此重复派发没有持久重复项，也不改 `~/.codex/config.toml` 中用户的其他项目、全局选项或权限策略。直接改写用户 TOML 会引入并发覆盖和格式保留问题，不采用。

### D4：信任失败继续原有可诊断链路

若本次 CLI 覆盖仍未让 terminal 到达 idle，或 `worker-start` 的 `dispatch_input` 阶段仍报 `agent_prompt_stalled`，继续调用现有 `terminalShowsWorkspaceTrustPrompt` 与 `recordWorkspaceTrustRecovery`，返回 `workspace_trust_required`、精确 terminalHandle 和同 Task 恢复动作。不得静默扩大信任范围或创建第二个 Task。配置参数无效、工作树身份不一致或路径编码失败在 terminal 创建前 fail-closed，错误指向当前目标；不伪报为已信任。

### D5：状态与文件所有权

`scripts/orchestration/status.mjs` 和 `status.test.mjs` 负责 A/B；`scripts/orchestration/control.mjs` 和 `control.test.mjs` 负责 C。内部 facts 可增加 main 活动名称，公开 snapshot、v2 信封、Orca API、运行时台账和数据库结构不变。不新增依赖、迁移、业务权限或审计字段；受控派发的 revision 与幂等键、已有 fail-closed 错误边界保留。RI/RA 业务链路不受影响。

## Risks / Trade-offs

- A 的无 Task 待采纳只对 main 中没有的本地 change 自动成立。若同名 change 已在 main，工作树需要精确辅助任务/尝试信封才能表明自己的归属；这是避免继承污染的有意收窄。
- B 只用 HEAD 不等与祖先关系判“已进主线”，不推断未提交改动；主线归档仍可独立证明完成。
- C 依赖当前 Codex CLI 对 `projects.<path>.trust_level` 的单次覆盖生效。实施测试应验证构造出的启动参数及现有屏幕探测回退；若真实 TUI 仍要求手工信任，记录精确 terminal 和错误，不改写用户配置或扩大路径。
- 已知限制：worker 的 `ask` 可能落在其 Dispatch 自己的 Run 上，协调端需按 Run 拉取。本 change 不修改消息路由。

## Migration Plan

无数据迁移、依赖安装或配置文件转换。三项修复及定向测试在同一 change 实施；回退仅回退本 change 的代码，已有 Orca worktree、Task 与 Codex 用户配置保持原样。
