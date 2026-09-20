# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`5d077587219adf4f95ede28fcf4cf7bbc116a49c`。
- 权威输入：本 change 的 proposal、两份 delta specs、design（D-01～D-06），以及当前 `riskflow-delivery` schema、OpenSpec 1.13.1 CLI 实际输出、编排控制器和两份操作文档。
- 直接依赖：复用仓库已有 OpenSpec CLI、`readJsonCommand`、Vitest 与编排控制器；不新增或升级依赖。
- 就绪条件：旧 schema 目录保持原样；新 schema 通过校验；控制器门禁在 Git 副作用前执行；相关测试和仓库验证通过。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `openspec/schemas/riskflow-delivery/schema.yaml` 与五个模板 | 复制稳定的五工件 DAG 与模板到新 schema，并只增加 verification | 不修改旧 schema；不在多个文档维护另一套工件 ID 或 apply 前置集合 |
| IP-02 | `scripts/orchestration/control.mjs` 的 `taskSpec`、`riskflowSettle`；`status.mjs` 的 `readJsonCommand` | 在既有成功收口路径读取 change 实际 artifact 状态 | 不解析 verification 自然语言，也不按 schema 名称硬编码分支 |
| IP-03 | `AGENTS.md`、Handbook、Runbook 的现有角色与 CLI 说明 | 原位更新稳定规则、责任和命令 | 不复制执行图、角色模型或 OpenSpec CLI 实现细节 |
| IP-04 | 现有 OpenSpec 与 pnpm 验证命令 | 校验新旧 schema、change、控制器和全仓库 | 不新增测试框架或专用验证脚本 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 新增通用 schema 并切换后续默认值 | `OpenSpec 后续工件继承项目约束` 的全部场景 | 新增 `openspec/schemas/orchestrated-delivery/schema.yaml`、`templates/{proposal,spec,design,implementation-plan,tasks,verification}.md`；修改 `openspec/config.yaml` | schema 保留五个 apply 前置工件，增加依赖五工件但不进入 `apply.requires` 的 verification；模板规定最终 HEAD、PASS/FAIL/BLOCKED、证据、修复、限定审计和后续事项；配置增加 verification 规则并切换默认 schema | `openspec/schemas/riskflow-delivery/**` 的任何字节；既有 change 元数据；业务运行时 |
| IP-02 | 让编排提示与成功收口遵守实际 artifact 图 | `Finalizer 必须持有收尾责任` 的“形成验收工件”“限定审计补充验收工件”；`受控操作必须执行状态前置校验` 的“缺少 schema 声明的验收工件”“兼容不含验收工件的旧 schema” | `scripts/orchestration/control.mjs` 的 `taskSpec`、`riskflowSettle`；`scripts/orchestration/control.test.mjs` | Planning 提示改为按实际 schema/applyRequires；Finalizer/Auditor 提示写入或补充 verification；finalization/audit 的 succeeded settle 在任何 Git 写入前读取 `openspec status`，若存在未 done 的 verification 则抛出 `verification_artifact_required`；增加一个表格驱动的门禁测试覆盖新旧 artifact 图 | 失败/阻塞/暂停路径；旧 schema 既有证据门禁；报告正文解析；Orca 状态模型 |
| IP-03 | 同步项目规则与操作说明 | 上述两个 Requirement 的全部场景 | `AGENTS.md`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`、`IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md` | 记录新 schema、Planning 五工件边界、verification 责任、OpenSpec 提前 ready/all-done 陷阱、CLI 命令、settle 门禁和归档条件 | 执行图唯一事实源、Git 授权边界、研究资料边界、旧 change 的 metadata 解析 |
| IP-04 | 校验、验收并归档 change | `OpenSpec 后续工件继承项目约束` 的“使用 CLI”“完成能力级变更”及所有门禁场景 | 本 change 的 `tasks.md`；归档时由 OpenSpec 同步 `openspec/specs/platform/engineering-baseline/spec.md`、`openspec/specs/operations/orchestration-controlled-actions/spec.md` | 执行 schema/change/控制器/全仓库验证，逐项核对 IP-ID；通过官方归档流程同步主规格 | 不提交 Git，不修复既有 OMP 版本漂移，不迁移历史 change |

## 4. 调用与副作用顺序

1. Planning 通过 change 实际 `schemaName` 与 `applyRequires` 确认 proposal、specs、design、implementation-plan、tasks 完成；即使 verification 显示 ready 也不创建。
2. Implementation 读取 apply 返回的全部 `contextFiles`，按 IP-ID 修改并验证，完成 tasks 后交出固定 HEAD。
3. Finalizer 基于该 HEAD 核验、在批准范围内修复并回归，然后按 verification 指令更新同一报告；若产物再次变化，报告中的最终 HEAD 与证据一并更新。
4. 若触发限定审计，Auditor 将结论补入 verification；审计未完成时不能给出可收口的 PASS。
5. `riskflowSettle` 仅对 `finalization`/`audit` 且最终 outcome 为 `succeeded` 的请求执行 artifact 检查。读取失败或 verification 非 `done` 时抛错，不执行 `git add`、`git commit` 或 Orca `task-update`；重试在工件完成后沿用既有幂等路径。
6. 不含 verification artifact 的旧 schema 跳过新增检查，继续原有门禁与副作用顺序。

## 5. Schema、状态与持久化落实

- Schema SSOT：`orchestrated-delivery/schema.yaml`；verification 依赖五个规划工件，`apply.requires` 仍为这五个工件。
- 状态判断：控制器读取 `openspec status --change <change> --json` 的 `artifacts`，只判断 `id === "verification"` 的 `status === "done"`。
- 错误契约：缺失工件返回 `ControlError` 代码 `verification_artifact_required`，下一动作指向 `openspec instructions verification --change <change> --json`。
- 持久化、事务、权限、迁移：本 change 不涉及数据库或业务持久化；Git 与 Orca 副作用仍由现有 settle 路径负责，新增读取门在其之前。
- 版本与审计：报告绑定最终 HEAD；Git 保存迭代历史。旧 schema 和历史 change 不迁移。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 获取后续工件指令；应用大型 change；最终验收大型 change；CLI；提前 ready；完成能力级变更 | IP-01, IP-03, IP-04 | OpenSpec schema/change 与临时 smoke change | 新旧 schema 均存在；临时 change 使用新 schema | 五工件满足 apply；verification 独立 ready/done；旧 schema 仍有效；change 严格校验 | `openspec schema validate orchestrated-delivery --verbose`; `openspec schema validate riskflow-delivery --verbose`; `openspec validate adopt-orchestrated-delivery-schema --strict --no-interactive` |
| Finalizer 形成验收工件；限定审计补充验收工件 | IP-01, IP-02, IP-03 | schema 模板与控制器提示 | finalization/audit 任务 | 提示明确最终 HEAD、报告更新及审计结论 | `pnpm exec vitest run scripts/orchestration/control.test.mjs` |
| 缺少 schema 声明的验收工件；兼容旧 schema | IP-02 | `scripts/orchestration/control.test.mjs` | status 分别返回 verification ready/done/不存在 | ready 在 Git 与 Orca 写入前拒绝；done 与旧 schema 延续成功路径 | `pnpm exec vitest run scripts/orchestration/control.test.mjs` |
| 全部修改后的稳定约束 | IP-01～IP-04 | 仓库既有校验 | 无新增依赖，格式完成 | OpenSpec、格式、类型与测试通过；无空白错误 | `pnpm verify`; `git diff --check` |

## 7. 文件清单与升级条件

- 新增：`openspec/schemas/orchestrated-delivery/schema.yaml` 及六个模板。
- 修改：`openspec/config.yaml`、`AGENTS.md`、两份编排文档、`scripts/orchestration/control.mjs`、`scripts/orchestration/control.test.mjs`、本 change 的任务工件；归档时同步两份主规格。
- 删除：无。
- 保护区：`openspec/schemas/riskflow-delivery/**`、历史 change、执行图、业务应用与包、锁文件。
- 升级条件：OpenSpec 无法表达所定 artifact 图；必须修改公共 CLI/控制器输入输出；需要新依赖；测试证明旧 schema 被破坏；或实现要求改变权限、事务、持久化、迁移与批准范围。发生任一项即停止并回到 design/用户决策。

## 8. Finalizer 授权与限定审计

- Finalizer 可在 IP-01～IP-04 涉及的 schema、配置、文档、控制器和测试范围内修复缺陷并重跑验证，不得修改受保护区域或扩展公共契约。
- 本次变更不触及权限、事务、关键业务状态机或语义 merge；若控制器 settle 状态转换的修改超出“成功前只读 artifact 门禁”，触发 `critical-state-machine` 限定审计。
- 最终核对新旧 schema、默认配置、实际 artifact 图、门禁副作用顺序和归档后的主规格；未解决失败或必需证据缺口不得验收为通过。
