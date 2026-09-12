## Context

参见 [proposal.md](./proposal.md) 的动因。当前 C02 在 `packages/contracts/src/ports/index.ts` 以 `KnowledgeDefinitionTypeValues` 生成闭合的 `KnowledgeDefinitionTypeV1Schema` 和 TypeScript 联合类型；C16 再以 `(projectId, definitionType)` 确定工程内唯一稳定定义身份。`CONTEXT.md` 已把检索证据库定义为风险机理库、规范标准库与类比工程案例库三类独立发布集合的精确组合，但 contracts 只声明了前者和组合定义，缺少后两类成员。

本 change 使用内置 `spec-driven` workflow，base commit 为 `1e51bec508ddad8e2ccdd5af9a9d17b593458af9`。相关主规格 `knowledge/governed-definition-lifecycle` 只引用共享类型并规定每个类型的稳定身份，没有逐项列出枚举成员；因此 `.openspec.yaml` 设置 `skip_specs: true`，不创建 delta spec。

## Goals / Non-Goals

**Goals:**

- 让 `standard-library`、`case-library` 与 `risk-mechanism` 分别获得 C16 既有生命周期下的稳定定义身份和独立版本链。
- 保持 `retrieval-evidence-base` 为组合定义身份，不改变三类组成集合独立演进后再精确组合的语义。
- 只修改枚举事实源及覆盖新增合法输入的现有 contracts 测试。

**Non-Goals:**

- 不实现 C17 的正文 Schema、确定性校验、知识编制、发布集合组合或用途级解析。
- 不改变 C16 的身份、发布、解析、权限、错误、幂等、事务、审计或持久化语义。
- 不新增注册表、迁移、数据库枚举/CHECK、依赖、配置项或其它枚举成员。

## Decisions

### D-01：只扩展 C02 枚举事实源

在 `KnowledgeDefinitionTypeValues` 的 `risk-mechanism` 与 `retrieval-evidence-base` 之间加入 `standard-library`、`case-library`。`KnowledgeDefinitionTypeV1Schema`、推导类型和 `submit-revision` payload 自动继承新成员，不建立别名、映射表或第二套定义注册表。

备选方案是在 C17 内把两类知识编码为 `retrieval-evidence-base` 的子类型；这会把独立版本链压入组合定义正文，无法利用 C16 的稳定身份和唯一约束，故不采用。

### D-02：沿用 C16 的类型即身份维度

C16 的身份等价判断和 PostgreSQL 查询都以精确 `definitionType` 比较。新增字面量自然使同一工程的规范标准库、类比工程案例库、风险机理库和检索证据库分别占用不同的 `(project_id, definition_type)` 键，并沿用既有修订、发布和解析规则。

数据库 `definition_type` 列是非空 `text`，没有复制完整枚举的 CHECK；`knowledge_definitions_identity_uidx(project_id, definition_type)` 正是所需约束，无需改迁移。新增成员不会合并、覆盖或重解释任何既有身份。

### D-03：消费点按共享 Schema 自动演进

核查结果如下：

| 消费点 | 当前机制 | 是否修改 |
| --- | --- | --- |
| `packages/contracts/src/ports/index.ts` | `KnowledgeDefinitionTypeValues` 生成 Zod Schema、联合类型，并约束 `submit-revision.definitionType` | 修改枚举数组 |
| `packages/core/src/knowledge-governance/schema.ts` | 定义、修订、发布、投影及解析请求均直接复用共享 Schema | 否 |
| `packages/core/src/knowledge-governance/lifecycle.ts` | 通过推导类型做精确相等比较、按值筛选和排序，没有成员分支 | 否 |
| `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts` | 入站命令先过共享 Schema；数据库读回、解析请求和写入路径继续复用共享 Schema/类型 | 否 |
| `000007_governed_definition_lifecycle.ts` | `definition_type` 为非空 `text`；唯一身份约束为 `(project_id, definition_type)`，无枚举镜像 | 否 |
| `packages/contracts/test/module-interfaces-events-workflows.test.ts` | 现有闭合契约测试已覆盖其它共享枚举和治理命令 | 修改，参数化验证两个新增成员可解析 |
| core/adapters 现有测试 | 使用代表性既有成员验证与成员无关的生命周期和数据库行为 | 否 |
| 主 specs、文档和 UI | 主 spec 不逐项枚举；`CONTEXT.md` 已有正确三类集合定义；demo 只有业务导航/展示文案，没有定义类型选择或镜像列表 | 否 |

归档 change 中的旧枚举清单是历史决策记录，不修改。当前生产源码和 UI 均不存在另一份需要同步的成员列表。

### D-04：兼容性保持为纯增量

两个新字面量只扩大合法输入集合：所有既有字面量、已发布引用和持久化行仍按原值解析；发布选择、类型精确匹配和唯一约束的行为不变。新的类型记录在 C17 后续提交时才产生，本 change 不迁移或回填数据。

若未来已持久化新类型记录，回退到不识别它们的旧 contracts 会导致这些行无法通过应用层 Schema；因此部署顺序应先发布本契约再启用 C17 写入，回滚 C17 写入能力时保留已升级的 contracts。

### D-05：验证稳定契约，不重复测试泛化消费方

在现有 contracts 测试中直接解析 `standard-library` 与 `case-library`，证明运行时 Schema 和推导契约接受新增成员。core 和 adapter 没有按成员分支，重复增加生命周期或 PostgreSQL 用例不会覆盖新的行为边界。

实现后依次运行：

1. `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`：contracts 项目编译成功。
2. `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`：目标契约测试全部通过。
3. `pnpm typecheck`：workspace 消费方在扩展后的联合类型下全部通过。
4. `pnpm exec prettier --check packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-knowledge-definition-types/.openspec.yaml openspec/changes/evolve-knowledge-definition-types/proposal.md openspec/changes/evolve-knowledge-definition-types/design.md openspec/changes/evolve-knowledge-definition-types/tasks.md`：计划与实现文件格式通过。
5. `openspec validate evolve-knowledge-definition-types --strict --no-interactive` 与 `git diff --check`：change 结构及补丁格式通过。

## Risks / Trade-offs

- [旧版消费者仍使用旧 Schema 时会拒绝新成员] → contracts 先于 C17 写入方部署；本 change 不引入双写、别名或兼容分支。
- [后续代码再次复制枚举列表会产生漂移] → 继续以 `KnowledgeDefinitionTypeV1Schema`/推导类型为唯一事实源；本 change 不新增导出的平行常量。
- [只测 contracts 未直接执行数据库新类型流程] → adapter 和迁移对类型值完全泛化，workspace typecheck 负责验证消费兼容；待 C17 实现真实组合行为时再覆盖其业务边界。

## Migration Plan

1. 先发布包含扩展枚举的 contracts 及其消费方构建产物。
2. 后续 C17 才可提交和发布 `standard-library`、`case-library` 定义；无需数据库迁移或数据回填。
3. 若本 change 尚未被新类型数据使用，可直接回退代码；一旦已有新类型持久化，保留新版 contracts，并单独停用后续写入能力，避免旧 Schema 读取失败。
