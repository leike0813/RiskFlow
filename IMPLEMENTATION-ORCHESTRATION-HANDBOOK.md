# RiskFlow 实现编排手册

## 1. 适用范围与事实源

本手册只规定大型 OpenSpec 路线的稳定编排策略，不记录某次会话的进度、旧 HEAD、Run、Task 或“下一步必须执行”的历史命令。

具体的 Orca/OMP/Codex 启动、工作区信任、等待、故障恢复、同步和回收步骤见 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md`。凡是创建或接管 worktree、启动 Agent、处理工具故障或同步活动分支，必须先读该 Runbook；其中的操作经验不能写回本手册，也不能取代实时状态。

事实源按用途分开：

- 领域与交付契约：`AGENTS.md`、已归档 `openspec/specs/` 和当前 change。
- 路线节点与依赖：`config/orchestration/execution-graph.json`。
- 当前状态与接管顺序：Git、OpenSpec、Orca 的实时事实，经 `pnpm orchestration:status --json` 生成。
- 历史：Git、OpenSpec archive 和已收口 Orca 记录；历史没有当前指令效力。

接管 Agent 不从聊天记录或本文推测 frontier。开始工作时运行：

```bash
pnpm orchestration:doctor
pnpm orchestration:status --json
```

读取返回的 `revision` 和 `resumeQueue`，从队首合法动作继续。状态无法生成、存在 `violations` 或工作项为 `unknown` 时，先修复状态，不派发、不合并、不归档。

## 2. 角色与责任

角色、模型和强度只在执行图 Manifest 的 `policy.roles` 中配置。手册说明职责，不复制具体模型值。

| 角色 | 责任 | 禁止 |
|---|---|---|
| 主调度 | 读取状态，选择合法动作，审阅检查点，处理升级，受控集成与回收 | 自由拼接 Orca/Git 调度写命令；替代规划、实现或收尾角色写生产代码 |
| Planning | 研究代码与规格，创建并闭合 proposal、specs、design、implementation-plan、tasks | 实现、提交、合并、归档 |
| Implementation | 按已批准 IP-ID 实现、自检，并在当前任务内修复普通测试失败 | 自行改公共契约、权限、持久化、依赖、迁移或范围 |
| Finalizer | 独立初审当前产物，按已批准语义修复、回归并对最终产物负责 | 借收尾改变需求或设计边界；把普通缺陷退回首轮实现角色 |
| Targeted Auditor | 对权限、事务、关键状态机或语义 merge 冲突做限定范围独立检查 | 重做所有 change 的全量验收 |
| Archiver | 在集成门禁通过后机械归档 | 处理语义冲突或补实现 |

主调度保留调度与 Git 权限，不因此获得生产实现权限。Agent 之间只通过已审阅的 Git 检查点和结构化执行信封交接。

## 3. 状态机与责任移交

主流程固定为：

```text
PLANNING → IMPLEMENTING → FINALIZING → INTEGRATING → ARCHIVING → COMPLETED
```

核心不变量：

1. 同一已批准版本的 change 进入 `FINALIZING` 后，普通实现缺陷不再把责任退回 Implementation。
2. 升级改变待解决的问题，不自动改变当前收尾责任。
3. 只有重新批准了新的规划版本，才能显式重开 `IMPLEMENTING`；`riskflow_dispatch` 必须携带非空 `replanApprovalRef`，由控制器创建 planning v2 边界并记录被取代的 `attemptGroup`。
4. Finalizer 会话崩溃、预算耗尽或上下文不足时，留下结构化交接包，由新的强模型 Finalizer 接管；不得因此改派低成本实现角色。
5. 运行状态与质量结论分离。Task 创建时只能是 `queued`、`running` 或 `waiting`，不能预填成功。

`FINALIZING` 中的修改范围按语义判断：为落实已批准行为而联动修改 service、adapter 和测试，仍可属于收尾；改变公共事件、权限、事务、持久化或业务含义，即使只改一行，也必须升级。

## 4. 规划与实现门

### 4.1 Planning

大型 change 使用 `riskflow-delivery`，顺序为 proposal → specs → design → implementation-plan → tasks。Planning 必须读取真实代码、调用方、测试和全部相关主规格；研究资料只通过规划 Task 明确注入。

规划完成必须满足：

- 固定 base commit；
- 每个 Requirement/Scenario、计划文件、现有符号、实现动作和可运行证据映射到稳定 IP-ID；
- 公共接口、Schema、状态、权限、事务、审计、依赖和迁移决定位于 design；
- 关键接缝场景被前移：发布生命周期、reader 对实际 payload 的解析、失败路径可达、幂等重试、事务回滚和权限拒绝；
- 没有需要 Implementation 自行决定的公共语义。

### 4.2 Implementation

Implementation 先运行 `openspec instructions apply --change <name> --json`，完整读取 `contextFiles`，再按 IP-ID 和依赖顺序实施。

以下属于当前实现任务的正常闭环，不升级：

- 自己的实现导致相关测试失败；
- 已批准行为的局部或跨文件实现不完整；
- 范围内测试或 fixture 需要同步调整。

以下情况才升级：

- 规格或规划互相矛盾；
- 代码相对 base commit 漂移，使计划符号或接缝失效；
- 修复需要改变公共契约、权限、事务、持久化、迁移、依赖或 Non-goals；
- 指定命令不存在，或外部工具/权限阻止继续。

实现完成后运行最小必要验证，主调度审阅并形成固定 implementation checkpoint，再移交写入权与收尾责任。

## 5. Finalizer 与审计门

Finalizer Task 是“验收与收尾”，`openspec-verify-change` 只是其中的核验步骤。Finalizer 必须：

1. 固定输入 implementation checkpoint，核对当前 worktree HEAD；
2. 对照 requirements、scenarios、design、IP-ID、调用链和现有测试；
3. 运行关键接缝场景，确认目标分支实际执行，不能把关键 skip 或早退当作通过；
4. 在已批准语义内直接修复发现的问题；
5. 对修复后的最终产物运行受影响回归；
6. 报告最终 HEAD、修改、证据、命令和剩余事项。

Finalizer 遇到以下问题时暂停并升级，但仍保留收尾责任：

- 需求、公共契约、权限边界、事务或持久化语义需要改变；
- 需要新增依赖、迁移或超出批准范围的文件所有权；
- 必需的机械前置操作需要主调度权限。

Finalizer 完成修复后不为形式独立性重复启动全量复验。最终产物若又发生实质变化，必须核验受影响范围。以下风险默认触发 Targeted Auditor：权限、事务、关键状态机、语义 merge 冲突。

## 6. 受控操作层

主调度通过以下 OMP 工具推进：

- `riskflow_status`：读取实时状态、`revision` 和 `resumeQueue`；
- `riskflow_dispatch`：按阶段和 Manifest 角色派发；
- `riskflow_wait`：等待当前 worker 事件，单次不超过 60 秒；
- `riskflow_settle`：以证据收口当前任务；
- `riskflow_integrate`：执行允许的 merge、main 门禁、归档或回收步骤。

每个写操作必须携带最新 `expectedRevision` 和唯一 `idempotencyKey`。控制器在公共 Git 目录持锁，重新采集事实后，在任何外部副作用前持久写入 `inflight` 回执，成功后更新为 `completed`。相同幂等键若仍为 `inflight`，必须以 `uncertain_prior_execution` fail-closed，要求重新读取状态并对账，绝不自动重做副作用。状态变化、重复 writer、过期 HEAD、证据不足或阶段不合法时，操作在执行前被拒绝，并返回合法下一步。

Finalizer 报告后，主调度先审阅该专用 feature worktree 的全部改动，再调用 `riskflow_settle`。成功收口必须提供证据；若工作树有已审阅改动，调用者必须提交与实时 `dirtyPaths` 完全一致的 `reviewedPaths`，settle 只暂存这些路径并形成 Git 检查点，再把实际新 HEAD 写入 v2 信封。失败、阻塞、暂停或路径不一致时不得自动提交改动。

正常编排禁止直接调用以下写操作：Orca Task/Dispatch 创建或更新、worktree 创建或删除、`git merge/commit/rebase/cherry-pick`、`openspec archive`。只有控制器故障且用户明确批准 break-glass 恢复时，才允许手工操作，并须随后运行状态对账。

`/goal` 只负责在仍有合法工作时持续推进。目标完成必须同时满足授权范围内工作项均完成、无状态违规、集成和归档证据齐全。`session_stop` 只防误停；用户暂停、真实阻塞或预算耗尽时进入 `paused`/`blocked`，不无限续跑。

启动协调会话使用显式扩展路径：

```bash
pnpm orchestration:coordinator
```

## 7. v2 执行信封与当前状态

每个 Task 创建后立即写入 v2 信封。最小结构为：

```json
{
  "schemaVersion": 2,
  "workItemId": "C26",
  "routeNodeId": "C26",
  "changeName": "deliver-warning-tasks-and-in-app-notification",
  "taskKind": "finalization",
  "phase": "finalizing",
  "runState": "queued",
  "worktreeId": "<full-id>",
  "inputHead": "<commit>",
  "owner": {
    "taskId": "<task-id>",
    "agentClass": "strong-finalizer",
    "model": "<manifest-selected-model>"
  },
  "attemptGroup": "C26:finalizing",
  "attempt": 1,
  "auditPolicy": "self",
  "issueRefs": [],
  "evidenceRefs": []
}
```

收口时才增加 `outputHead` 和 `outcome`。`runState` 只允许 `queued`、`running`、`waiting`、`settled`；`outcome` 只允许 `succeeded`、`failed`、`blocked`、`paused`，且只在 `settled` 出现。`main` 子对象记录 merge commit、main HEAD、主线验证和 archive commit。

获批重新规划的 planning 信封额外记录 `approvalRef` 与 `supersedesAttemptGroup`。状态从最新、有效且确实指向已进入 finalizing 尝试组的 replan Task 创建边界重新计算；边界之前的旧 finalizing 不再覆盖新规划。缺少批准引用时不得回退阶段。

状态观察器兼容读取旧 v1 信封，但所有新写入只使用 v2。它从实时事实生成：

- `revision`：本次状态版本，写操作用于乐观并发校验；
- `resumeQueue`：确定性的跨会话接管队列；
- `violations`：必须先解决的身份、HEAD、writer 或证据冲突；
- `AUX:<changeName>`：Manifest 外但存在于活动 worktree 的独立前置/drift change。

恢复优先级为 recovery → finalizing → integrating → implementing → planning → ready → cleanup。等待依赖的工作项不进入可执行队列。

## 8. 集成、同步与回收

受控集成按固定顺序执行：

1. Finalizer（及必要的 Targeted Auditor）对最终 feature HEAD 通过；
2. feature worktree clean，任务信封 `outputHead` 与实际 HEAD 一致；
3. merge 到 main；
4. 在 main 运行 `pnpm verify`；
5. 归档 OpenSpec 并记录 archive commit；
6. 确认无活动 writer、无未知改动、Orca terminal 已结束后回收 worktree。

语义 merge 冲突解决会改变最终产物，必须触发受影响范围审计。旧检查点的 PASS 不能覆盖冲突解决后的代码。

编排策略、状态 Schema、共享脚本或基础契约合入 main 后，必须同步所有仍活动的 feature worktree：

1. 等待并冻结该树 writer；
2. 记录同步前 HEAD 和 clean/dirty 状态；
3. 将 main 合入该分支；
4. 无冲突则运行最小相关检查；
5. 有冲突则停止该树，记录 `blocked` 与冲突文件，不强行解决；
6. 以同步后 HEAD 更新 v2 信封，再重新计算状态。

过期 worktree 只能通过 Orca 的完整 worktree ID 回收。禁止 `git clean`、手工删目录或按 display name 猜测目标。已有未提交改动、活动 terminal 或未归档产物时不得回收。

## 9. 无进展与完成判定

相同 attempt group 在相同 HEAD 上连续出现相同缺陷和证据，且没有有效修改时，不得靠新建 Task 重置次数。达到 Manifest 的 `noProgressLimit` 后进入 `paused`，向用户报告缺少的决定、权限或外部条件。

困难、耗时或普通测试失败不构成阻塞。预算耗尽的结果是未完成并暂停，不能放宽验收或换角色绕过。

一个工作项完成必须具备：规划工件闭合、实现和收尾任务完成、最终 HEAD 与证据匹配、必要审计通过、main 门禁通过、OpenSpec 已归档、worktree 已回收或明确可回收。整个目标完成还要求用户授权范围内所有工作项满足以上条件，且 `violations` 为空。

## 10. Task 提示词最小契约

所有 Task 至少写明：工作项与 change、固定输入 HEAD、完整 worktree ID、角色责任、允许和禁止的语义范围、必读 `contextFiles`、验证命令、升级条件、最终证据格式。Task 还必须要求执行 Agent 先读 `IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` 中与其启动方式和工具链有关的章节。

Implementation 提示词必须明确“普通测试失败在当前任务内自修”。Finalizer 提示词必须明确“核验—修复—回归—最终报告，普通缺陷不回派 Implementation”。一句“实现/验证 Cxx”不构成可派发任务。
