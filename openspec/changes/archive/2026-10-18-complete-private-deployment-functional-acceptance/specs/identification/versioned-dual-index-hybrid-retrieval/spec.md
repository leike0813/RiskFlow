## ADDED Requirements

### Requirement: 检索成员文本与稠密查询指令使用共享确定性表示

标准库成员的投影文本和事实回查摘要 MUST 共用`retrievalMemberText`，并仅纳入C17已发布事实中的可选`retrievalText`。检索策略可包含非空`queryInstruction`；正式检索和质量测量 MUST 共用渲染`Instruct: {instruction}\nQuery:{queryText}`，且仅将渲染结果用于稠密查询。BM25查询和文档Embedding继续使用原文本；指令缺省时查询保持原样。指令受现有请求字节/token预算限制，不得写入相关性标签或运行中切换策略。

#### Scenario: 投影和事实回查表示一致

- **WHEN** 标准库成员含已验证检索正文并参与投影、内容摘要和查询事实回查
- **THEN** 各路径使用同一`retrievalMemberText`，成员身份仍为原standard entryId

#### Scenario: 指令只包装稠密查询

- **WHEN** 查询策略包含`queryInstruction`
- **THEN** 检索和质量门使用同一渲染后的稠密查询，BM25及文档Embedding使用原文本，旧发布和旧代际保持不变

### Requirement: 构建质量门沿原事务读取正式代际

质量门evaluate MUST 接受可选的既有TransactionContextV1；投影构建 MUST 将当前C03消费者上下文传给质量门，质量门将其传给generationStore.readGeneration以读取同事务building代际。独立测量已提交代际可不传上下文。系统 MUST 保留正式身份、当前权限、双路与融合质量、成员对账、泄漏、p95及耐久报告门禁，不新增或拆分事务，不跳过正式代际读取。

#### Scenario: 同事务代际通过正式质量读取

- **WHEN** 消费者事务已创建building代际但尚未提交
- **THEN** 质量门通过同一上下文读取并验证该代际，事务外读取仍不可见；仅全部质量门通过且报告耐久保存后允许ready及激活

#### Scenario: 质量失败保持非活动

- **WHEN** 代际读取、身份、权限、质量或报告保存失败
- **THEN** 该代际不得ready或激活，不降低阈值、不改标签、预算或旧失败事实
