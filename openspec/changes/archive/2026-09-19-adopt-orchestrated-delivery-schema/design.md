## Context

见 `proposal.md` 的 Why。当前 `riskflow-delivery` 将五个规划工件全部列入 `apply.requires`，Finalizer 的核验、修复和报告责任则由手册与编排控制器约束。OpenSpec 1.13.1 的自定义 schema 只有工件依赖图和 apply 配置，无法让工件依赖一次 apply 运行；CLI 还会把 schema 中的全部工件统称为 planning artifacts。

## Goals / Non-Goals

**Goals:**

- 用项目无关的 schema 名称表达 Planning、Implementation、Verification 三类责任。
- 让最终验收结论随 change 归档，同时不阻塞 apply。
- 用确定性门禁保证新 schema 的成功收口确实产生验收工件。
- 保持旧 schema 和既有 change 的元数据解析行为。

**Non-Goals:**

- 不修改 OpenSpec CLI 或实现新的工作流引擎。
- 不迁移既有/归档 change，不改变角色模型、执行图或业务运行时。
- 不解析 verification 的自然语言结论；其语义由验收 Agent 和主调度审阅负责。

## Decisions

### D-01：新增 `orchestrated-delivery`，旧 schema 原样保留

新 schema 使用 `name: orchestrated-delivery`、`version: 1`，复制 `riskflow-delivery` 的五个稳定规划工件及模板，并增加 verification。`openspec/config.yaml` 只切换后续 change 的默认值；已有 change 继续由 `.openspec.yaml` 固定实际 schema。

选择新增目录而非修改或重命名旧目录，因为 OpenSpec 以 schema 名称解析历史 change。跨 schema 共享模板不采用符号链接：OpenSpec 要求模板的规范路径位于各 schema 的 `templates/` 内。

### D-02：verification 属于工件图，但不属于 apply 门

`verification` 生成 `verification.md`，直接 `requires` proposal、specs、design、implementation-plan、tasks，使其指令明确列出所有验收输入。`apply.requires` 仍只含五个规划工件；否则实现前就会被要求生成只能基于最终实现填写的报告。

OpenSpec 因缺少 post-apply edge 会在五个工件完成后把 verification 标为 ready，并在 tasks 全勾选后显示通用的“ready to archive”提示。手册和 Agent 规则以 `applyRequires` 的传递闭包定义 Planning 完成条件，并明确该提示不能替代 verification 门禁。

### D-03：verification 记录当前最终结论，不维护迭代历史

模板固定为验收对象、结论、核验与修复证据、限定审计、后续注意事项五部分。结论使用 `PASS`、`FAIL` 或 `BLOCKED`；PASS 必须绑定最终 HEAD，且不能把范围内缺陷、必需证据或待执行审计降级成后续事项。最终产物变化后更新同一文件，历史由 Git 保存。

### D-04：RiskFlow 的 Finalizer 是默认验收 Agent

Planning 提示改为按 change 实际 schema 闭合 apply 前置工件，不再硬编码 schema 名称。Finalizer 在修复和回归完成后按 `openspec instructions verification` 写报告；触发限定审计时，Targeted Auditor 将其结论和证据补入同一工件后才能集成。Implementation 不创建 verification。

### D-05：成功 settle 只检查工件状态，不解析报告文本

`riskflowSettle` 仅在 `finalization` 或 `audit` 成功收口时，于任何 Git 暂存/提交之前读取目标 worktree 的 `openspec status --change ... --json`。若实际 schema 的 artifacts 含 `verification` 且状态不是 `done`，返回稳定错误码 `verification_artifact_required`；未声明该工件的旧 schema 沿用既有证据门禁。

选择工件状态检查而非标题/结论字符串匹配，避免脆弱文本门禁；内容正确性仍由验收 Agent 和主调度审阅保证。

### D-06：规格、配置与操作文档同步切换

工程基线规格记录默认 schema 和 apply/verification 分工；编排控制规格记录 Finalizer/Auditor 责任与 settle 门禁。`AGENTS.md` 保留稳定规则，Handbook 记录责任与状态，Runbook 记录具体 CLI 操作及 OpenSpec 1.13.1 的提示陷阱。

## Risks / Trade-offs

- [OpenSpec 将 verification 计入 `isPlanningComplete`] → Planning 只使用 `applyRequires` 传递闭包，文档明确忽略提前 ready 的 verification。
- [apply 完成提示误称可归档] → Finalizer 提示和 settle 门禁共同要求 verification；archive 指引再次检查工件状态。
- [旧 change 被新默认值影响] → 所有读取按 change 元数据解析，门禁仅在实际 artifact 图包含 verification 时生效。
- [验收报告内容失真] → 不做脆弱字符串解析，由固定最终 HEAD、可运行证据和主调度审阅收口。

## Migration Plan

1. 新增并校验 `orchestrated-delivery`，确认旧 schema 仍可解析。
2. 更新配置、规则、控制器和文档；后续新 change 显式选择新 schema。
3. 既有与归档 change 保持原 schema；回滚时将默认配置与文档恢复到 `riskflow-delivery`，删除新 schema 和门禁分支即可，不涉及数据迁移。
