## 1. 结构化路线与任务信封

- [x] 1.1 在 `config/orchestration/execution-graph.json` 录入 C00～C38 及 G0～G5 的节点、change 名称、直接依赖、wave/gate 和必要并发组；用脚本解析校验节点唯一、依赖存在且无自依赖/环，运行 `node scripts/orchestration/status.mjs --check --graph-only` 通过。
- [x] 1.2 在 `design.md` 固定并在实现中复用 Task result 执行信封的字段、版本和身份键；通过单元测试验证缺少 `changeId`、`taskKind`、完整 `worktreeId`、base/head 时被拒绝，合法信封可解析。
- [x] 1.3 为 planning、implementation、verification、archive 四类任务定义最小 `taskKind`/`phase` 映射，并更新 Handbook 的 Task 创建后登记、阶段收口和证据引用规则；通过文档差异检查确认未要求解析自由文本状态。

## 2. Worktree-aware 状态采集

- [x] 2.1 在 `scripts/orchestration/status.mjs` 实现有限命令执行器和 JSON 解析边界；支持当前 Orca CLI 约定、仓库根路径、完整 worktree ID 和缺失路径的结构化错误，不修改任何 Git/OpenSpec/Orca 状态；用模拟命令执行器测试超时、非零退出和非法 JSON。
- [x] 2.2 读取 Orca 当前仓库的 worktree、Task/Run/worker 状态，并按完整 `worktreeId` 关联任务；对每个仍存在的非主 worktree 以其路径为 `cwd` 读取 Git 状态和 OpenSpec 状态；通过 fixture 测试 main 缺少活动 change 时仍识别 feature-local change。
- [x] 2.3 单独采集 `main` 的 HEAD、feature ancestry、主线验证和归档证据；实现 feature 本地完成、已合并、主线未复验、已归档四种边界；通过表格化状态测试验证 main 事实不会覆盖 feature-local 状态。

## 3. 确定性状态与输出

- [x] 3.1 实现 frontier、dependency blockers、running、verification_failed、merged、main_verified、archived、reclaimable、stale、unknown 和 violations 的推导；通过行为测试覆盖依赖未归档、重复活动 worktree、worktree_missing、checkpoint mismatch 和未知 dirty 状态。
- [x] 3.2 实现机器 JSON 和人类摘要输出，至少包含 main、frontier、节点 phase/status、依赖、worktree、Orca task、checkpoints、evidenceRefs、nextActions 和 violations；通过 JSON 结构测试确认生成时间不会影响派生状态。
- [x] 3.3 实现 `--check` 只读门禁：发现执行图非法、身份冲突、main 集成事实缺失、stale/reclaimable worktree 或未知脏改动时返回非零并输出结构化原因；验证命令不得产生 Git、OpenSpec 或 Orca 副作用。

## 4. 流程接线与验证

- [x] 4.1 在根 `package.json` 增加 `orchestration:status` 与 `orchestration:check` 命令，不新增依赖；运行 `pnpm orchestration:status --json` 能在当前无非主 worktree 时输出合法状态。
- [x] 4.2 更新 `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`，明确活动 change 必须查询对应 worktree，Task 创建后写入执行信封，main 只负责集成事实，回收前运行状态检查；运行 `git diff --check`。
- [x] 4.3 更新 `.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md`，声明 Manifest 为机器依赖图事实源、Orca/各 worktree/main 的字段分工和不从 main 缺失推断活动状态；运行 `git diff --check`。
- [x] 4.4 运行 `pnpm exec vitest run scripts/orchestration/status.test.mjs --run`、`pnpm orchestration:status --json`、`pnpm orchestration:check`、`openspec validate deliver-structured-orchestration-status --strict --no-interactive` 和 `git diff --check`，记录状态聚合器、OpenSpec 与现有未提交用户改动的结果。
  - 结果：状态聚合器、执行图、OpenSpec 严格校验和 `git diff --check` 通过；`pnpm orchestration:check` 按 fail-closed 规则返回 1，当前 `main` 缺少 C00～C08 的结构化主线验证摘要，并检测到 5 个历史 active Orca Task 缺少执行信封。

