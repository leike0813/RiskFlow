# Implementation Plan

## 1. 实施基线与权威来源

- 固定 base：`12e7ba21a0c401f0726adf584720ac5da4fc1943`。
- 权威输入：本 change 的两份 delta spec、design D-01～D-08、已归档 `operations/orchestration-execution-status` 主规格、当前 `status.mjs`/测试、OMP 18.1.18 扩展类型与 Orca 1.4.198 CLI。
- 不引入依赖、不改变生产 workspace、不修改数据库或业务 API。完成条件是全部 IP-ID、严格 OpenSpec 校验、脚本测试、doctor、全库 verify 和 rollout 验收均通过。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `config/orchestration/execution-graph.json`、`validateGraph`、`topologicalNodes` | 在现有 Manifest 增加稳定策略，继续使用原 DAG | 角色、阶段顺序和审计规则不得再复制到运行状态文件 |
| IP-02 | `parseTaskEnvelope`、`taskSummary`、`deriveNodeState` | 扩展为 v1 规范化和 v2 原生解析 | 不从标题、正文或分支名推断身份 |
| IP-03 | `collectFacts`、`deriveSnapshot`、`renderHuman` | 继续从 Git/OpenSpec/Orca 重建，增加辅助项和 resumeQueue | 不提交 current-state 快照 |
| IP-04 | `collectStatus`、`defaultExec`、Orca JSON CLI | 控制器直接复用状态与统一命令执行 | 不实现第二套状态采集器或自由 shell 接口 |
| IP-05 | OMP `registerTool`、`tool_call`、`context`、`session_stop` | 薄适配控制器并注入短状态 | 不把扩展当作 OS 权限边界 |
| IP-06 | 现有 handbook、`AGENTS.md`、OpenSpec workflow | 稳定策略留在 handbook；可复用操作经验迁入 Runbook | 不在文档保存动态状态或重复机器策略 |
| IP-07 | Orca worktree/task result 与 Git merge | 以 main 检查点同步和回填 | 不复制未提交文件、不继承旧 PASS |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 策略 SSOT | Controlled Actions 全部；Manifest 拓扑场景 | `execution-graph.json` | schemaVersion 2；增加 roles、phaseOrder、resumePriority、targetedAudit、noProgressLimit | C00–C38 节点、依赖与路线语义 |
| IP-02 | v2 信封 | 结构化身份、状态冲突、新建任务无结论、过期验收 | `status.mjs::parseTaskEnvelope/taskSummary/deriveNodeState`、`status.test.mjs` | 校验 D-02 字段；v1 规范化；按 phase/attempt 选当前任务；使用 outputHead | v1 只读兼容及现有 main checkpoint 语义 |
| IP-03 | 接管队列 | Manifest 外 change、frontier/resumeQueue、重启接管 | `status.mjs::collectWorktree/deriveSnapshot/renderHuman`、测试 | 发现所有未归档 change；生成 AUX adopt 项；确定性排序并输出 revision | 静态 frontier 的既有含义 |
| IP-04 | 受控状态转换 | 前置校验、并发、幂等、目标完成 | 新增 `control.mjs`、`control.test.mjs` | 实现 status/dispatch/wait/settle/integrate/doctor；common-dir 锁与回执；稳定拒绝码 | 不接受调用者提供角色、模型、任意命令 |
| IP-05 | OMP 入口 | finalizing 派发拒绝、goal 完成、session stop | 新增 `omp-extension.mjs`、修改 `package.json` | 注册五工具；短 context；拦截 goal complete 和明显直接绕过；显式扩展启动与 doctor | 不隐藏这是软守卫，不修改 OMP 安装 |
| IP-06 | 规则收口 | Finalizer、重规划、会话移交、高风险 audit | handbook、Runbook、`AGENTS.md`、`openspec/config.yaml`、workflow implementation-plan 模板 | 验证改为 Finalizer；实现普通失败自修；历史状态改为状态命令指针；保留当前有效的工作区信任和故障恢复经验 | 领域、RI/RA 与业务运行契约 |
| IP-07 | 当前状态迁移 | 重启接管、旧 PASS、工作树回收 | 四个活动工作树、Orca v2 task result、三个旧工作树 | merge main；按新 HEAD 回填 C17/C20/C26/AUX-C11；核验后 Orca 回收旧树 | 未提交用户改动、活动 writer、分支历史 |

## 4. 调用与副作用顺序

1. status 读取 Manifest → Git/OpenSpec/Orca → 规范化 v1/v2 → 节点和辅助工作项 → resumeQueue → revision；任一身份/HEAD 冲突 fail-closed。
2. 变更动作先取得 common-dir 锁，再重读状态、比对 expectedRevision、查幂等回执、校验当前 nextAction；成功执行后重读状态并原子写回执，finally 释放锁。
3. dispatch 根据工作项 phase 选择 taskKind/角色/模型和任务模板；finalizing 只能选择 Finalizer 或 targeted auditor。实现阶段普通失败保留当前实现责任；只有批准 replan 才产生新 attemptGroup。
4. settle 只接受当前 task/工作树/产物 HEAD；queued/running/waiting 不接受 outcome。Finalizer PASS 若需 targeted audit，则转换到 audit，不进入 integration。
5. integrate 只允许状态给出的下一步；merge 后旧 feature PASS 不覆盖新 HEAD，main verify、archive 和 reclaim 各自重新预检。
6. OMP 在每轮 context 注入队首摘要；直接调用 goal complete 或明显状态变更命令时由 hook 重读状态后决定阻断。

失败不部分推进状态。Orca/Git/OpenSpec 外部步骤失败时不写成功回执；重复幂等键返回首个已提交结果。三次同一 issueRefs 且无 outputHead/evidence 变化时进入 paused。

## 5. Schema、状态与持久化落实

- v2 信封严格按 D-02；`owner` 至少含 taskId、agentClass、model，`auditPolicy` 为 `self|targeted`。
- phase 顺序和合法 taskKind 由 Manifest 读取；代码只实现通用校验，不复制模型字符串。
- runtime 目录位于 `git rev-parse --git-common-dir` 下，不进入 Git；回执键由调用者幂等键和规范化输入共同校验。
- 无数据库、迁移、生产权限或事务变化。全局文件锁是有意的低吞吐实现；协调写入频率不足以支持更复杂锁。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| v1/v2、运行/质量分离、过期 HEAD | IP-02 | `status.test.mjs` | v1 与 v2 task fixtures | 规范化一致；非 settled 无 outcome；过期 PASS 为 violation | `pnpm exec vitest run scripts/orchestration/status.test.mjs` |
| AUX 发现、frontier/resumeQueue、重启重建 | IP-03 | `status.test.mjs` | Manifest 外 change 与乱序节点 | AUX adopt；队列稳定；frontier 兼容 | 同上 |
| finalizing 不回派、replan、audit、完成门 | IP-04 | `control.test.mjs` | 合成 snapshot | 非法操作稳定拒绝；合法转换唯一 | `pnpm exec vitest run scripts/orchestration/control.test.mjs` |
| revision、幂等、锁、三次无进展 | IP-04 | `control.test.mjs` | 临时 Git common dir | 并发至多一次；重放同结果；阈值 paused | 同上 |
| OMP 注册与显式加载 | IP-05 | doctor + OMP print smoke | OMP 18.1.18 | 五工具注册、扩展路径存在、版本满足 | `pnpm orchestration:doctor` |
| OpenSpec 和 Agent 文档一致 | IP-06 | OpenSpec/格式校验、task prompt 测试 | 全部工件与主规格 | 严格校验通过；Runbook 被派发引用；无动态 frontier 或失效下一 session 指令 | `openspec validate strengthen-orchestration-finalization-and-guards --strict --no-interactive` |
| 当前 frontier 接管与同步 | IP-07 | 实际 Git/Orca 状态 | 四个活动树已 merge main 并回填 | resumeQueue 为 C17、C26、AUX-C11；C20 阻塞 C17；无 mismatch | `pnpm orchestration:status --json && pnpm orchestration:check` |
| 全库回归 | IP-01～IP-06 | 既有套件 | 实现完成 | 构建、类型、lint、格式、测试、依赖和 specs 全绿 | `pnpm verify` |

## 7. 文件清单与升级条件

新增：

- `scripts/orchestration/control.mjs`
- `scripts/orchestration/omp-extension.mjs`
- `scripts/orchestration/control.test.mjs`
- `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md`
- 本 change 的 proposal、两份 delta spec、design、implementation-plan、tasks；归档后新增 controlled-actions 主规格。

修改：

- `config/orchestration/execution-graph.json`
- `scripts/orchestration/status.mjs`、`scripts/orchestration/status.test.mjs`
- `package.json`
- `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`、`AGENTS.md`
- `openspec/config.yaml`、`openspec/schemas/riskflow-delivery/templates/implementation-plan.md`
- 归档时更新 `openspec/specs/operations/orchestration-execution-status/spec.md`

删除：无仓库文件；删除 handbook 内动态状态和失效“下一 session”段落。rollout 经核验后回收三个 Orca 工作树。

升级条件：发现 OMP 18.1.18 实际 API 与本机类型不符、必须新增依赖、Orca 无法结构化写入 v2、当前工作树有未知脏改动/活动 writer、merge 涉及未批准业务语义、或需要改变上述公开信封字段时停止并更新 design。普通测试失败、局部实现缺陷和可在现有文件范围修复的格式问题由当前任务直接修复。
