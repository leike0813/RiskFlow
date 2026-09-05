## Why

RiskFlow 已有通用版本、工件、授权、审计和事务能力，但尚无工程业务上下文与工程资料的事实源，后续文档转换、OCR、监测处理、识别和评估因此没有可冻结、可授权、可追溯的输入。C11 需要先落实 RI-S1 与 RA-S1 的共同数据基线，使每个下游结果都能引用确定的工程/空间修订、资料版本、资料段身份和适用性元数据快照。

## What Changes

- 新增工程与空间区段业务修订：稳定身份、不可变修订、当前指针和显式有效状态；业务空间绑定 C06 的授权 scope identity，不复制访问树。
- 新增来源交付、资料项与资料版本登记，支持文件上传、数据库直连和 API 接口三类交付描述；原始二进制内容复用 C04 工件引用，不在领域表复制正文。
- 固定资料 ID 与资料段标识（Source-Segment ID）生成和校验规则；资料段登记只保存身份、父级结构/时间范围和来源定位，格式转换内容留给 C12～C14。
- 绑定 RI-S12 来源元数据、C06 两级资料权限修订，以及 RA-S1 三维适用性元数据；任何供评估使用的适用性信息都冻结为不可变快照。
- 所有写能力复用 C03 幂等事务、C06 服务端授权和 C07 只追加审计；C11 不伪造后续 preparation 引用或发布输入就绪事件，由形成真实 preparation 的后续所有者按既有事件契约发布。
- 不实现 DOCX/PDF/XLSX/CSV 解析、OCR、监测特征、清洗 Agent、知识建模、风险识别、P/C 评分或界面页面；这些能力由 C12～C15 及后续 change 承担。

## Goals

- 建立工程/区段业务修订、工程资料交付与版本、资料段身份和适用性元数据快照的唯一事实源。
- 让每个登记结果都以不可变精确引用复用 C03 事务、C04 工件、C06 权限与 C07 审计，并可供后续处理重放。
- 在不改 C02 公共签名的前提下完成 `register-source-delivery`，把新增写能力限制在 `engineering-data/context-source` 所有权内。

## Non-Goals

- 不实现上传 HTTP route、在线数据库/API connector、格式转换、OCR、监测处理、知识建模、识别、评估、预警、投影或 UI。
- 不修改 `packages/contracts/**`、现有主 specs、C03/C04/C06/C07 代码与迁移，也不新增公共端口、依赖或 lockfile 变更。
- 不把 metadata 工件变成任意命令协议，不复制 C06 授权树，不让 C11 发布需要后续 preparation 引用的输入就绪事件。

## Success Criteria

- 工程/区段与资料版本只追加；相同交付幂等返回原引用，同键异载荷失败，历史引用不被覆盖。
- 每个评估适用性快照同时冻结施工工法、地层条件和工程阶段，并保存工程/区段精确修订及字段来源。
- 资料段标识严格为 `资料ID-章节ID-资料段ID`，归属唯一、定位可追溯，段和派生读取不扩大来源权限。
- 来源登记在 C04 工件校验、C06 默认指定权限收口和 C03/C07 审计完成前不返回业务成功；失败可用同一命令安全续跑。
- `openspec validate deliver-engineering-context-and-source-registry --strict --no-interactive` 通过，且 proposal、delta spec、design、tasks 无未决 Open Questions。

## Capabilities

### New Capabilities

- `domain/engineering-context-source-registry`: 规定工程/空间区段修订、来源交付、资料项/版本、资料段身份、元数据、权限绑定和适用性快照的可观察行为。

### Modified Capabilities

无。C11 实现既有 `domain/contract-kernel`、`domain/module-interfaces-events-workflows`、`platform/postgresql-outbox-checkpoint-foundation`、`platform/content-addressed-artifact-store`、`platform/local-identity-project-authorization` 与 `platform/review-and-audit-runtime` 契约，不改变其 requirements。

## Impact

- **直接依赖**：C03、C04、C06、C07；同时复用 C01/C02 已归档公共 Schema、端口、事件与错误语义。
- **代码所有权**：新增 `packages/core/src/engineering-data/context-source/` 与 `packages/adapters/src/engineering-data/context-source/`，并仅修改对应 package 公开入口及迁移 provider；数据库新增 C11 专属 migration。
- **接口与事件**：保持 C02 `EngineeringDataPortV1` 公共签名不变，实现 `register-source-delivery` 分支并新增 C11 私有领域用例；C11 采用零事件事务，后续 preparation 所有者只产生既有输入就绪事件，不新增开放仓储、任意 patch 或跨层存储访问。若后续消费者需要直接调用新用例，另开契约演进 change。
- **后续消费者**：C12、C13、C14、C15、C25 与 C30 只通过精确版本/快照引用消费 C11 事实。
- **依赖治理**：不新增、升级或删除第三方依赖，不修改 lockfile；使用现有 Zod、PostgreSQL、C03/C04/C06/C07 能力。
