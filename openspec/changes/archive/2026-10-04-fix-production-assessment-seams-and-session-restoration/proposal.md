## Why

C34 的真实写入装配被只有接口、没有生产实现的 `RiskInputFactsReaderV1` 阻断，C11 无法冻结评估准备，C25 及后续预警、处置链无法产生正式事实。同时，C28 尚无可部署的版本化预测执行器，两套前端也没有通过有效 Cookie 恢复会话的入口；需要独立 change 闭合这三个接缝，避免在装配代码中补造业务事实。

## What Changes

- 补齐工程数据和识别记录所有者的精确风险事实读取，提供仅按风险输入 `kind` 分派的组合工厂，统一供 C11/C25 注入。
- 闭合 C11/C25 向事实读取接缝传递授权范围的路径：C11 从当前复验的来源授权解析精确来源版本，C25 使用已复验准备快照的空间和来源；下游权限须落在调用方已有授权内。
- 补齐 C11 向 C19 提供的生产准备投影，将其收窄为准备身份、工程修订及冻结适用性；规则编制的 C15 绑定保存在编制 manifest，配置集合与兼容身份由 C19/C18 发布事实核对。
- 标准记录只投影已有真实标量；新增外部风险事件结构化字段工件契约，逐字段绑定登记证据。已有任意事件工件仍可登记，只有满足新字段契约的工件可作为该 reader 的可评估输入。
- 提供历史统计、监测趋势、机理模型三类确定性生产执行器、不可变模型参数工件及显式不可用分支；正式预测仍由 C28 按原事务、授权和幂等边界保存。
- 增加由 C25 拥有的预测风险状态窄能力，复用已冻结评分规则、权重与矩阵，进行不保存实际评估记录的纯计算。
- 增加 C06 会话元数据读取及 `GET /api/v1/session`；demo 与 `apps/web` 在启动时恢复正常或受限会话，处理恢复失败、改密、登出和迟到响应。
- 新公开 HTTP 能力为加法式扩展；现有风险输入 XOR、记录、命令、事件和评分结果契约保持单一事实源。**BREAKING（内部接缝）**：预测执行请求增加明确输入，执行返回改为可用／不可用判别联合；C19 准备投影移除清洗、配置、兼容及业务时刻字段，相关调用者与测试同步调整。

## Capabilities

### New Capabilities

无。复用已有 capability 的所有权与路径。

### Modified Capabilities

- `domain/engineering-context-source-registry`：受权读取已登记外部事件的结构化标量与原证据，准备冻结向事实读取传递已复验的来源范围。
- `identification/risk-candidate-validation-merge-and-acceptance`：记录所有者向评估提供精确版本、完整作用域的标量投影。
- `domain/module-interfaces-events-workflows`：统一风险事实读取和预测风险状态计算窄契约，保持调用身份、字段与所有权闭合。
- `risk-assessment/engine`：从冻结依据和预测指标值计算预测风险状态，不产生实际评估或预警。
- `knowledge/structured-scoring-rules-and-applicable-rule-sets`：C11 提供精确受权准备投影，C19 组装及 resolve 以该投影和真实 C18 配置发布事实核对依据。
- `domain/execution-forecast-feedback-and-deviation`：三类可执行参数模型、措施绑定、精确模型重放和类型化不可用结果。
- `platform/local-identity-project-authorization`：提供无 token 的当前会话元数据，沿用失效、空闲/绝对期限和受限会话规则。
- `platform/http-command-query-sse-shell`：安全 Cookie 会话自省路由、错误映射与 OpenAPI 描述。
- `platform/web-shell-interaction-primitives`：两套前端的启动恢复、深链保持、受限会话和认证请求竞态收口。

## Impact

- 固定基线：`e26ca45db5d124793b1c323ac83687f629913a3f`。直接复用已归档 C02/C03/C04/C06/C11/C14/C18/C19/C22/C25/C28 的公开事实和现有 `000054` 记录作用域列、`000055` 候选读取接缝。实现时必须核对基线与这些符号，不读取研究资料原件。
- 风险输入事实由 C11 外部事件域及识别记录域各自读取；C25 只消费投影。预测参数由精确模型工件和 C18 已发布策略固定，C28 保存预测事实；会话由 C06 保存，API 与前端只消费正式元数据。
- 涉及 contracts 共享字段 Schema、core 风险事实/评分/预测/访问契约、所属 adapters、API、demo 和 `apps/web` 会话路径及已有测试。精确文件清单、现有符号和证据映射写入 implementation-plan。
- 无新增依赖、锁文件、数据库表或迁移；不改 LangGraph 状态机、P/C 业务口径、发布流程或 Agent 必经任务。模型参数是版本化数据，不硬编码工程规则。
- 追踪 RI-S14、RI-S63～RI-S65、RA-S1、RA-S3～RA-S5、RA-S7，以及 F-AG-01/02 的会话约束。模型/事件验收数据使用明确标记的“合成样本、待甲方复核”；提供可用算法不代表甲方正式参数已经交付。
- 本 change 是 C34 的独立前置：规划和实现按所有权串行推进，生产能力与所属集成测试在本 change 内闭合。IP-04 在同一测试数据库内复用 C15/C08/C07/C16/C18/C19 适配器与最小夹具装配，以合成资料经清洗收口、规则编制、审核发布和真实依据解析形成评估输入。两套浏览器 harness 仅允许增加会话验收所需的真实受限账号；C34 的业务装配、两套业务组合根、checkpointer、basis 登记和 17 页验收仍由原 change 完成。本 change 归档后再更新其依赖和基线。规划只创建 apply 前置工件，verification 在固定实现检查点后生成。
