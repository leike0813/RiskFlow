## ADDED Requirements

### Requirement: 结构化生成可显式使用单函数参数承载

openai-chat部署 MUST 显式选择function-call模式才发送唯一emit_result函数，其parameters MUST 从调用方同一Zod Schema生成。仅接收单choice/index0、tool_calls或stop正常终止、恰一个正确命名的function调用及完整arguments JSON；额外正文/调用、错名、缺调用、截断或原Schema失败 MUST 拒绝并保留原响应/真实用量。成功仅映射为既有结构化完成结果，线协议事实保存在原响应。不得执行函数、依赖未声明的强制选择参数、自动重试/换模式，旧模式及会话流保持原契约。

#### Scenario: 单输出函数完成

- **WHEN** 显式新模式返回唯一emit_result调用，arguments通过完整JSON解析与原Zod Schema
- **THEN** 返回已完成的类型化结构化结果、真实用量和原响应引用，不创建或执行领域工具行动

#### Scenario: 函数输出不满足边界

- **WHEN** 函数缺失、多调用、错名、正文混入、截断、参数非法或Schema不符
- **THEN** 返回不可重试错误并保留原响应及计数，不从content提取结果或自动重试

### Requirement: Embedding正文预算与完整请求上限分别校验

网络Embedding网关 MUST 将调用方maxInputBytes用于UTF-8文本正文总量，并独立保持完整序列化请求不超过冻结部署maxInputBytes、保守token估算使用完整请求、批量上限及当前权限复验。协议封装不得挤占正文预算，亦不得借此放宽完整网络载荷或既有检索部署。

#### Scenario: 正文恰好预算而封装仍有界

- **WHEN** 文本正文总量恰好等于请求预算，完整请求及批量均在冻结部署上限内
- **THEN** 可进入正式嵌入；正文、完整请求或批量任一超限仍在上游HTTP前拒绝

### Requirement: 结构化模型请求受本行动token额度约束

StructuredCompletionRequestV1 MUST 支持maxInputTokens与maxContextTokens行动额度；可信Agent宿主提供冻结累计预算下本次预留额度。网关 MUST 使用请求额度与部署上限的较小值，在推理前按已有保守上界或tokenize拒绝不足，并按同一额度校验真实usage。输出继续使用maxOutputTokens；不允许调用方扩大部署或任务预算。

#### Scenario: 行动额度小于部署窗口

- **WHEN** 请求给出的输入或上下文额度小于部署上限
- **THEN** 本次请求按较小额度核验，超限不发起推理，不能借大部署窗口突破任务预算

#### Scenario: 服务返回超额usage

- **WHEN** 服务实际usage超过行动额度
- **THEN** 网关保留原响应、真实计数及结构化预算错误，不返回成功结果，供宿主失败记账

## MODIFIED Requirements

### Requirement: 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验

`completeStructured` MUST 接收版本化提示/输出Schema引用及原Zod Schema，adapter MUST 从同一Zod生成JSON Schema，在正常终止后完整解析承载值并严格复验；额外字段、非法JSON、Schema不符或截断均失败。openai-chat部署 MUST 显式选择无默认值的structuredOutputMode=server-json-schema|schema-prompt|function-call及reasoningEffort=low|medium|high|xhigh|max。server-json-schema须有真实服务端约束证据；schema-prompt MUST 加入固定system Schema提示；function-call MUST 以唯一输出函数parameters承载Schema并核对唯一完整调用，不执行函数。C04证据/正文保护及领域校验边界保持。（RI-S51、RI-S57～RI-S59）

#### Scenario: 双重约束后的结构化结果成功

- **WHEN** openai-chat正常终止并返回满足冻结模式且通过原Zod Schema的单个结构化值
- **THEN** 返回类型化值、精确部署/提示/Schema引用、使用量、终止原因和已耐久原响应引用
- **AND** 下游仍执行RI-S58～RI-S59字段统一、领域规则与仿真约束

#### Scenario: Schema 提示与本地严格复验

- **WHEN** schema-prompt返回单个正常终止JSON值
- **THEN** 固定system包含同一Zod生成的JSON Schema，由原Zod最终接受或拒绝
- **AND** 不依赖模型遵循提示替代本地校验

#### Scenario: 非法 JSON 结构失败

- **WHEN** 模式对应承载字段不是完整JSON、含尾随正文/额外字段或被截断
- **THEN** 返回不可重试结构错误及耐久原响应引用
- **AND** 不局部抽取、修补、返回空成功、重试或静默换模式，不将服务端结构约束等同业务有效

#### Scenario: Zod 复验失败

- **WHEN** JSON违反原Zod字段、类型、范围或refinement
- **THEN** 返回不可重试Schema错误及受保护诊断/原响应引用
- **AND** 服务端约束或本地通过均不替代RI-S58及领域校验

#### Scenario: 服务端 Schema 约束缺少证据

- **WHEN** server-json-schema缺少真实服务执行约束的证据
- **THEN** 配置/就绪核验失败，服务接收请求或单次合规响应不能代替严格约束证明

#### Scenario: 输出 Schema 无法安全转换

- **WHEN** 原Zod无法安全转换为支持的JSON Schema子集
- **THEN** 网络调用前返回不可重试Schema不支持错误，不退化纯文本或依赖不完整提示

#### Scenario: reasoning 内容不进入持久化或展示

- **WHEN** MiniMax响应含reasoning_content
- **THEN** 在C04持久化、API返回、日志、界面及报告前剔除，不保存或展示内部思考
- **AND** C04保留可审计协议证据和受原权限保护的普通正文，普通日志、界面及报告不披露正文或思维内容

#### Scenario: 格式错误可被上层反馈

- **WHEN** 模型正常结束但 JSON 或字段不合规
- **THEN** 网关保存响应并返回可修正结构错误，上层能够在原预算内修正

#### Scenario: 合规输出保留业务校验

- **WHEN** 输出通过 Zod
- **THEN** 仍由所属业务模块校验来源、规则和专业约束

#### Scenario: 不保存思维链

- **WHEN** 响应包含 reasoning_content
- **THEN** 持久化和展示前剔除，保留实际回答和协议元数据
