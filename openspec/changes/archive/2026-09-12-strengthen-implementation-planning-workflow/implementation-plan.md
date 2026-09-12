# Implementation Plan

## 1. 实施基线与权威来源

- Base commit：`8bb3e9b`
- Bootstrap workflow：`spec-driven`
- 权威输入：本 change 的 proposal/spec delta/design、主 `platform/engineering-baseline` spec、OpenSpec 1.13.0 内置 schema、`openspec/config.yaml`、`AGENTS.md`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`、39-change 路线及其地图摘要
- 预先存在的用户改动：handbook 中 Luna/Codex 角色已调整为 DeepSeek/OMP；所有 IP 必须保留该差异。
- 状态：READY；没有会改变文件范围、schema 图或任务拆分的 Open Question。

## 2. 复用与接缝

| IP-ID | 现有文件或机制 | 复用方式 | 禁止形成的第二事实源 |
|---|---|---|---|
| IP-1 | OpenSpec 内置 `spec-driven` schema | 使用 `openspec schema fork` 复制兼容结构，再做项目级最小修改 | 不手写新的 OpenSpec CLI 或工件解析器 |
| IP-2 | `openspec/config.yaml` 的 schema、rules、operations | 将默认 schema 和第五工件规则接入现有配置 | 不另建平行项目配置 |
| IP-3 | 工程基线 spec、`AGENTS.md` §3、handbook §1/§5/§8/§10 与 39-change 路线 | 加入强规划—弱实现交接门和 prompt 契约，并同步当前接管状态与路线摘要 | 不把完整 schema instruction 复制进多处文档 |
| IP-4 | `openspec status/instructions/schema validate` | 用 CLI 行为验证状态图和上下文 | 不新增静态文本断言或自定义测试脚本 |
| IP-5 | OpenSpec 1.13.0 `--help` 与 change 元数据解析 | 在 handbook 集中记录命令矩阵、schema 确认值和误用诊断 | 不复制完整 CLI 帮助，不虚构 apply/verify/continue 子命令 |

## 3. 代码与文档变更映射

| IP-ID | 目标文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|
| IP-1 | `openspec/schemas/riskflow-delivery/schema.yaml` | 名称改为 `riskflow-delivery`；design 依赖 specs；新增 implementation-plan；tasks 依赖 implementation-plan；apply 直接要求五类工件并按 IP-ID/证据完成 | proposal/specs 的行为契约语义、OpenSpec checkbox 格式 |
| IP-1 | `openspec/schemas/riskflow-delivery/templates/*.md` | 复用四个内置模板；新增最小 implementation plan 七段模板 | 不预填项目领域事实或示例生产代码 |
| IP-2 | `openspec/config.yaml` | 默认 schema 改为 `riskflow-delivery`；新增 implementation-plan rule；强化 tasks 对 IP-ID 的引用 | 四层架构、RI/RA 和现有 operation guidance |
| IP-3 | `specs/platform/engineering-baseline/spec.md` delta | 将后续工件约束改为五工件、apply 直接硬门、自动 contextFiles、IP-ID 证据验证 | 其它工程基线 requirements |
| IP-3 | `AGENTS.md` §3/§3.1 | 将 OpenSpec 工件序列和大型 change 的施工图门写成项目硬约束 | 领域契约和现有 Git 授权规则 |
| IP-3 | `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §1/§2/§5/§8/§10 | 当前接管点、角色职责、执行子图、规划/实现/验证门和 Task prompt 模板接入 implementation plan 与证据回报 | 用户现有模型改动、Orca 生命周期和提交权限 |
| IP-3 | `.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md` §1/§4/§6～§8 | 路线事实源改为五工件与 handbook 角色分工；DoR 加入施工图覆盖门 | 39-change 内容、依赖和阶段门 |
| IP-3 | `.scratch/riskflow-master-plan/map.md` 路线摘要 | 同步 Sol 规划/验证、DeepSeek 实现与 M3 机械归档 | 其它决策摘要 |
| IP-4 | 临时 smoke changes | 显式 schema 验证完整图；无 `--schema` 验证项目默认值；观察 status/apply 后精确删除 | 不留下活动 change 或修改主 specs |
| IP-5 | `IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md` §5.0/§8.1/§10 | 增加创建、工件生成、apply、validate、verify、archive 命令矩阵与三个常见误区；规划 prompt 和接管步骤使用显式 schema | 其它 Orca/Git 命令与权限边界 |
| IP-5 | `AGENTS.md` §3 | 增加指向 handbook §5.0 的强制 CLI 入口 | 不在 AGENTS 重复整张命令矩阵 |

## 4. 调用与副作用顺序

1. 完成 bootstrap planning artifacts。
2. `openspec schema fork spec-driven riskflow-delivery`，再用内置编辑工具修改 schema/template。
3. 修改工程基线 delta spec、config、AGENTS、handbook、路线事实源及地图摘要；不修改生产 workspace。
4. 运行 schema validate。
5. 先以 `openspec new change <temp> --schema riskflow-delivery` 验证完整图和 apply 行为，再以不带 `--schema` 的临时 change 验证 `.openspec.yaml` 为 `schema: riskflow-delivery`；缺少 plan 时 apply 必须阻塞，五工件齐全后 `instructions apply --json` 必须包含 `implementation-plan`。
6. 精确移除临时 smoke change；保留 bootstrap change 供验证与后续提交/归档。

任一步失败即停止在当前可检查状态，不把 config 切回无法解析的 schema。所有文件修改通过内置编辑工具完成；CLI 仅负责 OpenSpec 自身的 scaffold、schema fork 和只读验证。

## 5. Schema 与配置落实

- Workflow 名称：`riskflow-delivery`，版本 1。
- 工件顺序：proposal → specs → design → implementation-plan → tasks。
- `skip_specs: true` 仍可由 OpenSpec 原生机制处理，但大型能力、接口或模块 change 必须有 specs、design 与 implementation plan。
- `apply.requires` 直接包含五类工件，`tracks` 仍为 `tasks.md`。
- 归档仅移动整个 change，不把 implementation plan 合并到主 specs。

## 6. 验收证据矩阵

| 证明义务 | 证据 | 命令 |
|---|---|---|
| 自定义 schema 结构有效 | OpenSpec schema validation 通过 | `openspec schema validate riskflow-delivery --verbose` |
| 新 change 默认使用新 schema | 无 `--schema` 创建的 change 元数据为 `schema: riskflow-delivery` | `openspec new change <smoke> --json` 并读取其 `.openspec.yaml` |
| plan 是 apply 直接硬门 | 缺失时 apply state=`blocked` 且 missingArtifacts 含 `implementation-plan` | `openspec instructions apply --change <smoke> --json` |
| plan 自动进入实现上下文 | 完成后 `contextFiles.implementation-plan` 存在 | 同上 |
| CLI 约定与当前版本一致 | help、schema 来源与可用工件和文档矩阵一致 | `openspec new change --help`；`openspec status --help`；`openspec instructions --help`；`openspec archive --help`；`openspec schema which riskflow-delivery`；`openspec schemas --json` |
| 工程基线 workflow 行为已更新 | delta spec 与主 requirement 完整对应 | `openspec validate strengthen-implementation-planning-workflow --strict --no-interactive` |
| Bootstrap change 合法 | 当前 change 与全部 specs strict validate 通过 | `openspec validate strengthen-implementation-planning-workflow --strict --no-interactive`；`openspec validate --all --strict --no-interactive` |
| 文档与格式无破损 | 差异无空白错误，Prettier 检查相关 Markdown/YAML | `git diff --check`；`pnpm exec prettier --check AGENTS.md IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md openspec/config.yaml openspec/schemas/riskflow-delivery openspec/changes/strengthen-implementation-planning-workflow` |

## 7. 完成与升级条件

- 文件白名单：本 change 工件、`openspec/schemas/riskflow-delivery/**`、`openspec/config.yaml`、`AGENTS.md`、handbook、`.scratch/riskflow-master-plan/prototypes/openspec-delivery-roadmap.md`、`.scratch/riskflow-master-plan/map.md`。
- 不修改 `.agents/skills/**`：OpenSpec apply 已按 schema 返回并要求读取全部 `contextFiles`，schema instruction 足以承载执行规则。
- 任何需要修改 OpenSpec CLI、状态脚本、依赖、生产代码或既有归档 change 的情况必须升级。
- 只有 IP-1～IP-4 的命令均产生预期证据后才勾选 tasks。
