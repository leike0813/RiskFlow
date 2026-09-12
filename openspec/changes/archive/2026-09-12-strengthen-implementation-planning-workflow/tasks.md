## 1. 五工件 OpenSpec workflow

- [x] 1.1 按 IP-1 从内置 `spec-driven` fork `openspec/schemas/riskflow-delivery/`，加入 `implementation-plan` 工件、模板、依赖图和五工件 apply 硬门；运行 `openspec schema validate riskflow-delivery --verbose`，确认 schema 与模板有效，禁止修改 OpenSpec CLI 或 `.agents/skills/**`。
- [x] 1.2 按 IP-3 新增 `platform/engineering-baseline` delta spec，完整修改“OpenSpec 后续工件继承项目约束”，覆盖五工件指令、apply 直接硬门、contextFiles 与 IP-ID 证据验证；运行当前 change strict validate，禁止改动其它主规格行为。

## 2. 项目规则与调度接线

- [x] 2.1 按 IP-2 修改 `openspec/config.yaml`，将默认 schema 切换为 `riskflow-delivery`，加入 implementation plan 与 IP-ID 规则；运行 `openspec schemas --json` 并确认项目 schema 可发现，保留现有领域 context 和 archive guidance。
- [x] 2.2 按 IP-3 更新 `AGENTS.md`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`、39-change 路线事实源及地图摘要，固定五工件职责、planning/implementation/verification 完成门、Task prompt 和证据回报，并同步实际 archive/frontier；运行定向 Prettier 与 `git diff --check`，保留 handbook 中预先存在的 DeepSeek/OMP 模型调整，禁止修改生产代码、依赖和状态脚本。
- [x] 2.3 按 IP-5 在 handbook 集中写明 `riskflow-delivery` 的 CLI 命令矩阵、schema 确认值、Skill/CLI 边界和误用诊断，并从 `AGENTS.md` 建立强制入口；用 OpenSpec 1.13.0 help、`schema which` 与 `schemas --json` 逐项核对，禁止把帮助文本中的内置默认值当作已创建 change 的实际 schema。

## 3. 行为验证

- [x] 3.1 按 IP-4 分别创建显式 `riskflow-delivery` 与不带 `--schema` 的临时 smoke change，确认默认元数据为 `schema: riskflow-delivery`、缺少工件时 apply 明确阻塞、补齐五工件后 `contextFiles.implementation-plan` 存在且任务可跟踪；验证后只删除临时 changes，并重新运行 `openspec list --json` 确认只保留本 bootstrap change。
- [x] 3.2 运行 `openspec validate strengthen-implementation-planning-workflow --strict --no-interactive`、`openspec schema validate riskflow-delivery --verbose`、定向 Prettier 和 `git diff --check`；逐项核对 IP-1～IP-4 的文件白名单和证据，任何未完成项不得勾选，且不提交、不归档、不修改 Git 历史。
