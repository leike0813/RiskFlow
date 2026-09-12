## Why

`KnowledgeDefinitionTypeV1` 目前把组合后的检索证据库列为独立定义类型，却没有为其组成的规范标准库与类比工程案例库提供独立定义身份，无法表达三类发布集合各自演进后再精确组合的领域事实。C17 实现前需要先补齐这一共享契约缺口，避免在后续知识治理代码中引入临时类型或第二套定义注册表。

## What Changes

- 向闭合的 `KnowledgeDefinitionTypeV1` 增量加入 `standard-library` 与 `case-library`。
- 保留既有 `risk-mechanism` 与 `retrieval-evidence-base`：前三者分别标识独立演进的知识定义，后者仍标识由三类已发布集合精确组合而成的检索证据库定义。
- 扩展现有 contracts 契约测试，验证两个新增字面量可由共享 Schema 接受。
- 明确非目标：不实现 C17 的知识正文 Schema、校验、编制或组合逻辑；不改变 C16 的 `(project_id, definition_type)` 唯一身份语义；不新增定义注册表、依赖或迁移；不修改其它枚举。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。现有 `knowledge/governed-definition-lifecycle` 主规格以 `KnowledgeDefinitionTypeV1` 泛化约束每种类型的稳定身份和独立修订链，没有逐项枚举成员；新增合法成员不改变其 Requirement 或 Scenario，因此本 change 显式跳过 spec delta。

## Impact

- **契约与所有权**：仅修改 C02 所有的 `packages/contracts/src/ports/index.ts` 中 `KnowledgeDefinitionTypeValues`，由既有 `KnowledgeDefinitionTypeV1Schema` 和推导类型继续充当唯一事实源。
- **消费方**：core 生命周期 Schema、确定性规则与 PostgreSQL adapter 均通过共享 Schema/类型泛化消费，无需分支或镜像列表改动；数据库 `definition_type` 为 `text`，既有 `(project_id, definition_type)` 唯一约束保持不变。
- **测试**：仅修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts`，覆盖新增合法输入；不新增 core 或数据库测试，因为其行为不依赖具体枚举成员。
- **兼容性与依赖**：这是只增加合法输入的向后兼容契约演进，既有发布、解析和持久化数据保持有效；不新增或调整依赖、锁文件及依赖政策。
- **RI/RA 追踪**：补齐 RI-S44 所需的独立知识定义版本身份，并为 C17 后续落实 RI-S31～RI-S45 的风险机理、规范和案例知识治理提供前置契约；本 change 不实现 C17。
