# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base commit：`2ca676833916a2bfdbb250e17582a6fb4ed8688a`。实施前核对实际 HEAD、受影响符号及 OpenSpec `apply` 返回的全部 `contextFiles`；未审阅漂移即升级。
- 权威输入：本 change 的三项 delta、design D1～D5、`approval-2026-09-25-scope-narrowing-trust.md`、已归档直接依赖对应的 `operations/orchestration-execution-status` 与 `operations/orchestration-controlled-actions` 主规格、当前代码和协调端确认的 A/B/C 故障边界。执行图 C42 无路线前置依赖。
- 允许实施文件：`scripts/orchestration/status.mjs`、`scripts/orchestration/status.test.mjs`、`scripts/orchestration/control.mjs`、`scripts/orchestration/control.test.mjs`。不修改 setup、业务代码、已归档目录、执行图或用户 Codex 配置文件。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 唯一事实源 |
|---|---|---|---|
| IP-A1 | `status.mjs` 的 `collectFacts`、`extractOpenSpecChanges`、`collectWorktree` | 读取 main 活动 change 集合，沿用工作树 OpenSpec 名称与精确任务信封 | main 当前 OpenSpec 与 Orca v2 信封 |
| IP-A2 | `status.mjs` 的 `deriveSnapshot`、`taskMatchesNode`、`deriveNodeState` | 仅为精确任务所有者或本地新登记构造 AUX 节点 | IP-A1 的 main/worktree 名称与信封 |
| IP-B1 | `status.mjs` 的 `deriveNodeState`、`featureMerged`、`ancestry` | 在共用合并判据上增加 HEAD 不等门槛 | main/feature 实际 Git HEAD 与已提交归档 |
| IP-C1 | `control.mjs` 的 `startWorker`、`workspaceTrustError`、`terminalShowsWorkspaceTrustPrompt` | 校验精确受管路径；信任提示返回含路径及人工修复指引的类型化结果 | `node.worktree.id/path`、Manifest 角色和既有信任失败链 |
| IP-C2 | `control.test.mjs` 的信任用例 | 验证已信任派发、探测失败闭合与同 Task 恢复 | IP-C1 的实际受控行为 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-A1 | 1.1 | 辅助采纳：继承 main；本地登记 | `scripts/orchestration/status.mjs` 的 `collectFacts` | 在 main 根目录读取 `openspec list --json`，经现有解析器形成内部 `mainActiveChangeNames`；把它交给推导与辅助祖先采集 | 不引入全库资料读取或第二份 OpenSpec 解析器 |
| IP-A2 | 1.2 | 辅助采纳：继承 main、本地待采纳、精确任务所有权、多个真实所有者 | `status.mjs` 的 `deriveSnapshot` 及 `status.test.mjs` 的辅助工作项用例 | AUX 候选先按精确 v2 信封选所有者；无所有者时只采用 main 中不存在的本地活动名称；更新继承/本地/双所有者测试 | 不按分支名、display name 或正文认领；真正双所有者仍 fail-closed |
| IP-B1 | 2.1 | 集成状态：feature 未合并、已合并、main 尖端、main 已归档、main 后续推进、未提交归档 | `status.mjs` 的 `deriveNodeState` 与 `status.test.mjs` 的路线及 AUX 合并用例 | 对未归档工作树的 `featureMerged` 增加 `worktree.git.head !== main.head`，复用原祖先和干净条件；覆盖相等及真实祖先两组 HEAD | 不改归档完成、checkpoint 祖先和回收语义 |
| IP-C1 | 3.1 | Codex 信任：需要信任、已信任、非目标/非 Codex | `scripts/orchestration/control.mjs` 的 `startWorker`、`workspaceTrustError` 与 `control.test.mjs` 的 Codex terminal 用例 | 校验绝对受管路径与完整 ID；信任提示返回含路径、terminalHandle 和人工修复指引的既有类型化结果；启动命令不注入信任覆盖 | 不改用户配置、其他路径、Manifest 模型/强度，不新建第二 terminal |
| IP-C2 | 3.2 | Codex 信任：探测不可用或配置不可读；同 Task 恢复 | `control.test.mjs` 的 `agent_prompt_stalled`/屏幕探测用例 | 保留 `workspace_trust_required`、queued Task、同 handle 恢复；探测不可用时原错误失败闭合，worker 不启动 | 不把提示记成失败尝试，不改消息路由 |

## 4. 调用与副作用顺序

状态采集：main Git/归档/OpenSpec 与各工作树 OpenSpec/任务独立读取 → IP-A1 标记继承名称 → IP-A2 只建立有归属证据的 AUX 工作项 → IP-B1 对每个真实节点统一判断未归档合并。继承副本不进入 AUX 候选或重复所有者计数；真实双所有者仍产出 violation。main HEAD 与 feature HEAD 相等时祖先查询即使为真也不能进入 merged；不同且确为祖先时维持原集成阶段。

派发：`riskflowDispatch` 的 revision、幂等键、工作树身份前置校验不变；已登记 queued Task 后，IP-C1 校验当前绝对路径与完整 ID → 创建 Codex terminal → 等待 `tui-idle` → `worker-start`。控制器不读写用户配置，也不注入信任覆盖；不匹配的路径/ID 在 terminal 创建前拒绝。已传 `terminalHandle` 的恢复路径继续复用原 terminal。若出现信任提示，IP-C2 用现有屏幕探测、结构化 issueRef 和同 Task 恢复收口，错误信息给出完整路径与人工修复指引；探测不可用或配置不可读时不推断信任成功，其他启动错误原样 fail-closed。没有新增事务或外部清理动作。

## 5. Schema、状态与持久化落实

- A：`mainActiveChangeNames` 仅是内部采集 facts，公开 `snapshot`、v2 信封、`resumeQueue` 形状不变；对继承副本不生成 AUX，避免伪 `duplicate_active_worktree`。主线本地新 change 无 Task 仍可 adopt。
- B：`featureMerged` 在主线归档之外增加 HEAD 不等门槛；`mainVerified`、archive 和 checkpoint 版本含义不变。
- C：受控工作树路径是信任阻断的唯一目标；控制器不读取或修改用户级 TOML/其他项目权限。现有 `workspace_trust_required`、attempt ledger、revision、幂等键与审计/错误引用保留。
- 三项均不增加数据库表、业务 Schema、迁移、依赖或 RI/RA 领域规则。

## 6. 验收证据矩阵

状态定向命令：`pnpm exec vitest run scripts/orchestration/status.test.mjs`。控制定向命令：`pnpm exec vitest run scripts/orchestration/control.test.mjs`。规格命令：`openspec validate fix-orchestration-worktree-bootstrap --strict --no-interactive`。

| Requirement/Scenario | IP-ID | 测试文件与前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|
| 辅助采纳／新工作树继承 main 的未归档辅助 change | IP-A1、IP-A2 | `status.test.mjs`：两个新 route worktree、main 同名活动 change、无 AUX 信封 | 无 AUX 节点、无伪重复违规，route 仍可派发 | 状态定向命令 |
| 辅助采纳／工作树本地登记辅助 change 待采纳 | IP-A1、IP-A2 | 同上：main 无此名称、worktree 有且无 Task | `AUX:` 为 untracked/adopt recovery | 状态定向命令 |
| 辅助采纳／精确任务指明辅助 change 所有权 | IP-A2 | 同上：一个精确 v2 AUX 信封、一个继承副本 | 只选信封工作树 | 状态定向命令 |
| 辅助采纳／多个工作树都有真实采纳证据 | IP-A2 | 同上：两个本地登记或两个精确信封 | `duplicate_active_worktree`，不自动选 owner | 状态定向命令 |
| 集成状态／feature 已完成但尚未合并 | IP-B1 | `status.test.mjs`：feature 不为 main 祖先 | 保持未集成及合法下一步 | 状态定向命令 |
| 集成状态／feature 已合并但 main 尚未复验 | IP-B1 | 同上：HEAD 不等、祖先真、未复验 | `merged` 且待 main verify | 状态定向命令 |
| 集成状态／新工作树停在 main 尖端 | IP-B1 | 同上：route 与 AUX 分别 HEAD 等于 main、祖先真 | 不进入 `merged/main_verified` | 状态定向命令 |
| 集成状态／main 已完成归档、后续推进、工作区未提交归档 | IP-B1 | 同上：复用现有归档及 checkpoint 场景 | 已提交归档有效，未提交归档无效 | 状态定向命令 |
| Codex 信任／需要信任、已信任、非目标/非 Codex | IP-C1 | `control.test.mjs`：fake Codex/OMP terminal，等待 idle 与信任提示 | 类型化结果含完整路径、terminalHandle、人工修复指引；已信任正常派发；OMP 不执行 Codex 信任操作 | 控制定向命令 |
| Codex 信任／探测不可用或配置不可读、同 Task 恢复 | IP-C2 | 同上：`agent_prompt_stalled`、屏幕探测异常 | 未确认信任时失败闭合；识别为提示时保留 queued Task 与同 handle 恢复 | 控制定向命令 |
| 三项 delta | IP-A1～IP-C2 | OpenSpec 工件 | 严格校验通过，规格与行为一致 | 规格命令 |

## 7. 文件清单与升级条件

- 修改：`scripts/orchestration/status.mjs`（IP-A1/A2/B1）、`scripts/orchestration/status.test.mjs`（IP-A1/A2/B1）、`scripts/orchestration/control.mjs`（IP-C1）、`scripts/orchestration/control.test.mjs`（IP-C1/C2）。范围收窄批准记录随 change 保存；新依赖和迁移：无。OpenSpec 主规格仅在本 change 后续归档时由 delta 同步。
- 保护：`config/orchestration/execution-graph.json`、已归档规格、业务 `apps/` 和 `packages/`、`~/.codex/config.toml`、Orca 工作树设置、Git 历史。C42 允许范围是上述编排文件与必要测试，不延伸到 setup 校验。
- 实际 HEAD/符号漂移、需由控制器写用户全局配置或修改公共 Schema/权限/持久化/迁移/依赖/执行图语义时，Implementation 必须升级；普通测试失败在当前 Task 内修复。任何标称命令不存在也应升级。

## 8. 验收 Agent 授权与限定审计

Finalizer 按 A/B/C 已批准语义修复普通缺陷、运行上述定向测试及相关 lint/格式检查，并以最终产物填写 verification。状态判定或信任边界如在收尾时被实质修改，执行图的 `critical-state-machine` 或 `permission` 标签可触发本轮唯一一次 Targeted Auditor；Auditor 在自己的活动 Task 内修复已批准范围的 finding、回归并补充同一 verification。信任行为以类型化阻断与恢复证据验收，不以自动信任作为本 change 的验收条件。
