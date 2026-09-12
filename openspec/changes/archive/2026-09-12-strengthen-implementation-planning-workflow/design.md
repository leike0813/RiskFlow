## Context

见 [proposal.md](./proposal.md)。OpenSpec 1.13.0 的内置 `spec-driven` workflow 只声明 proposal、specs、design、tasks；`openspec instructions apply` 会把所用 schema 的现存工件全部放入 `contextFiles`，但 apply 的缺失检查只针对 `apply.requires` 直接列出的工件。当前 handbook 要求 Sol 解决文件清单、事务、权限、错误、审计和测试层次，却没有为这些代码级映射指定正式工件或完成证据。

## Goals / Non-Goals

**Goals:**

- 为大型交付 change 增加一份基于固定 Git 基线的代码施工图。
- 让 OpenSpec 自动生成、加载并硬性要求该工件，而不是依赖 prompt 猜测额外文件。
- 让规划、实现、验证三个角色围绕同一组 `IP-ID` 和证据矩阵交接。
- 保持 proposal、specs、design、implementation plan 与 tasks 各自只有一个职责。

**Non-Goals:**

- 不修改 OpenSpec CLI、项目生产代码、状态聚合器或 Orca 数据模型。
- 不把 implementation plan 同步到主 specs，也不取消独立验证。
- 不要求实现方案预写完整生产代码、固定行号或描述机械语法。
- 不为 prompt 新建生成器、校验器或新的 Task 类型。

## Decisions

### D1. 使用独立的 `riskflow-delivery` workflow

从内置 `spec-driven` fork 项目级 schema，保留原四类工件的规则与模板，增加 `implementation-plan`。不覆盖包内 schema，避免 OpenSpec 升级覆盖项目约束；小型机械、纯文档或紧急 drift change 仍可显式选择内置 `spec-driven`。

备选是在 handbook 中约定一个 OpenSpec 不认识的附加文件。该文件不会自动进入 `contextFiles` 或 apply 完成门，正是当前容易遗漏的交接方式，因此不采用。

### D2. 工件按单一职责串联

依赖顺序固定为：`proposal → specs → design → implementation-plan → tasks`。其中 proposal 管范围，specs 管可观察行为，design 管技术决策，implementation plan 管固定基线上的代码映射，tasks 只管执行顺序、进度和验证入口。

Implementation plan 只引用 requirement/scenario 名称和 design decision ID，不复制需求正文或设计理由。若公共接口、Schema、事务边界或依赖尚未在 design 决定，规划 Agent 必须先修正 design。

### D3. `implementation-plan.md` 使用 IP-ID 建立闭合映射

模板固定七类信息：实施基线、权威来源、复用接缝、代码变更映射、调用与副作用顺序、Schema/持久化落实、验收证据与升级条件。每个实现切片分配稳定 `IP-ID`；每个 task 引用至少一个 IP-ID，每个计划文件和 Requirement/Scenario 都能反向找到所属切片与验证证据。

方案固定文件路径与现有符号，不固定行号。普通实现语法留给代码 Agent；会影响接口、状态、数据完整性、安全、权限、并发、错误、幂等、版本、审计或验收范围的选择必须在规划阶段闭合。

### D4. Apply 同时硬门全部五类工件

`apply.requires` 直接列出 proposal、specs、design、implementation-plan、tasks。只让 tasks 传递依赖 implementation plan 不够，因为 OpenSpec 当前只对 `apply.requires` 做直接缺失检查。

Apply instruction 要求实现 Agent 逐项核对 IP-ID、只修改文件白名单、运行计划命令，并在行为与证据都完成后勾选任务。工件冲突、代码漂移、计划外公共契约/依赖/迁移/文件或不存在的验证命令都进入 ask/escalation。

### D5. 详细质量规则以 schema 为事实源

Schema instruction 是工件内容与 apply 行为的详细事实源；handbook 只保留无需跳转即可派发的 prompt 摘要，并补充角色、模型、base checkpoint、Orca 升级和 `worker_done` 交接格式。这样无需新增 prompt 生成器，也不在两个长文档维护两份完整模板。

验证任务在原 Completeness、Correctness、Coherence 之外增加 Implementation fidelity：逐个 IP-ID 核对文件、行为和证据。Schema 只能保证工件存在和进入上下文，主调度仍需在 planning checkpoint 前审阅方案质量。

### D6. 默认只切换后续 change，并同步工程基线规格

`openspec/config.yaml` 的默认 schema 改为 `riskflow-delivery`。已有 change 的 `.openspec.yaml` 已固定各自 schema，不迁移、不重写归档历史。本 bootstrap change 使用 `spec-driven` 创建 schema，并通过 `platform/engineering-baseline` delta spec 记录后续工件和 apply 行为的变化。

### D7. CLI 动词不变，只在创建时显式选择 schema

`riskflow-delivery` 改变工件图、工件 ID、生成指令和 apply 上下文，不增加新的 OpenSpec 顶层命令。大型 change 创建时显式传 `--schema riskflow-delivery`；创建后的 status、instructions、validate、show 与 archive 均按 change 自身 `.openspec.yaml` 解析，不再传 schema override。handbook 维护一份命令矩阵，并明确 OpenSpec Skill 名不是 CLI 子命令。

OpenSpec 1.13.0 的 `new change --help` 和 `status.planningHome.defaultSchema` 仍可能展示内置 `spec-driven` 默认值，不能据此判断已创建 change 的 schema；唯一检查值是创建结果中的 `change.schema` 或 `status.schemaName`。

## Risks / Trade-offs

- [OpenSpec schema 功能仍标记 experimental] → 项目保留完整本地 schema；CLI 升级后运行 `openspec schema validate riskflow-delivery --verbose` 和 smoke change。
- [本地 fork 不自动继承内置 schema 后续改进] → 升级 OpenSpec 时显式比较内置 schema；日常执行不依赖全局包内容变化。
- [方案过细可能把代码写两遍] → 固定符号、行为和证明义务，不固定行号、导入顺序或机械实现。
- [方案存在但质量不足] → planning checkpoint 使用可检查的覆盖门；独立验证继续保留。
- [简单 change 流程过重] → 允许显式 `--schema spec-driven`，但大型路线和能力/接口/模块 change 使用 `riskflow-delivery`。

## Migration Plan

1. 创建并验证项目级 `riskflow-delivery` schema 和模板。
2. 更新工程基线 delta spec、默认 OpenSpec 配置、项目 Agent 规则、handbook 与路线事实源。
3. 创建临时 smoke change，验证五工件顺序、缺失 plan 时 apply 阻塞、完成后 plan 进入 `contextFiles`；随后删除该临时 change。
4. 保留所有既有 active/archive change 的 schema 与历史内容不变。
5. 若新 schema 无法被当前 CLI 解析，恢复 `openspec/config.yaml` 的 `spec-driven` 默认并移除未被 change 使用的 schema 目录。
