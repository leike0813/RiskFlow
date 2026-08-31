## Why

RiskFlow 后续模块都要交换同一组专利术语、版本引用、证据和业务记录；当前 `@riskflow/contracts` 仍是空入口，若不先冻结这些契约，识别、评估、预警和处置会各自复制字段并破坏端到端追溯。C00 已提供稳定工程基线，现在需要在 C02 定义模块 interface 前建立可运行时校验、可派生 TypeScript 类型且不包含业务实现的领域契约内核。

## What Changes

- 在 `@riskflow/contracts` 建立唯一领域词汇模块，导出 RI/RA 固定枚举与分类的只读值、Zod Schema 和派生类型。
- 建立标识、不可变版本引用、业务有效时间/系统记录时间、资料段证据、审计上下文、命令信封和结构化错误信封等通用契约。
- 建立模型输出结果、标准化风险记录、适用性元数据、结构化评分规则、风险评估记录、预警信息、处置建议、偏差记录与校准建议的唯一 Zod Schema。
- 在类型和运行时同时强制 `riskRecordId` / `externalRiskEventId` 二选一且仅一个，并保持标准化风险记录的七项内容字段不扩张。
- 为稳定契约补充少量正反例测试，覆盖专利固定枚举、必填字段、资料段标识、时间/置信度边界和风险输入 XOR；不锁定字段顺序、完整错误文案或 Zod 内部结构。
- 为 `packages/contracts` 增加精确版本 `zod@4.5.4`（MIT），只用于共享 DTO 的运行时校验和 TypeScript 类型派生；离线来源为内网 npm 镜像或已制备的 pnpm store。若 Zod 停止维护、Node 24/TypeScript 5.9 兼容性失败，或仓库采用可提供同等运行时与静态单一事实源的标准机制时重新评估。

明确不在本 change 中定义模块端口、命令/查询业务语义、事务事件、LangGraph 状态或 I0～I9/A 工作流 DTO；这些属于 C02。也不实现评分、阈值判断、持久化、授权、Agent 任务、数据库表或迁移。

## Capabilities

### New Capabilities

- `domain/contract-kernel`: 规定 RiskFlow 共享领域词汇、通用信封及识别—评估—预警—处置记录在运行时与类型层的一致校验行为。

### Modified Capabilities

无。

## Impact

- **直接依赖**：已归档的 C00 `platform/engineering-baseline`。
- **下游消费者**：C02 及其后的 API、Worker、Web、Agent、LangGraph 和六个领域模块；它们必须引用本 change 导出的 Schema/类型，不得重定义共享 DTO。
- **事实所有者**：本 change 独占 `packages/contracts/src/vocabulary`、`packages/contracts/src/common`、`packages/contracts/src/records` 中的共享值与 Schema；只引用专利和项目规则，不拥有评分公式、矩阵、阈值、项目数据、规则内容或持久化事实。
- **代码与配置**：修改 `packages/contracts/package.json`、公开入口、依赖治理清单与 `pnpm-lock.yaml`，新增上述三个源码子目录及契约测试；根依赖清单、策略和锁文件由主 Agent 串行提交。
- **RI/RA 追踪**：覆盖 RI-S31～S34、RI-S41、RI-S43、RI-S57～S58、RI-S61～S65 与 RA-S1～S7 的共享词汇和记录字段；流程行为仍由后续 changes 实现。
- **权限与外部系统**：不新增接口、外部写入或权限判断；审计契约只承载已授权调用方提供的上下文。
- **路线偏离条件**：若实现需要修改七字段标准化风险记录、§2.7 最小字段、固定中文术语、C02 所属端口/事件，或需要 Zod 之外的新依赖，必须停止实施并由主 Agent 更新 change 或另开契约演进 change。
