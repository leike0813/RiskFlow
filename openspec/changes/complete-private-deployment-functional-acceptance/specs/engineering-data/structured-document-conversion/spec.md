## ADDED Requirements

### Requirement: 正式JSON-LD按共享文档字节边界读取

文档转换Schema MUST 导出共享16MiB的JSON-LD读取上限。C15冻结/切片及C17精确标准证据核验 MUST 使用该上限读取转换文档；C17单标准条目累计工件读取也 MUST 不超过16MiB。观察、清单、候选包和模型输出 MUST 保持各自原有上限，当前业务入口权限、完整消费及工件completed语义保持。超限 MUST 拒绝，不截断或扩大模型预算。

#### Scenario: 合法大文档读取

- **WHEN** 精确有权JSON-LD大于4MiB且未超过16MiB，相关累计额度也满足要求
- **THEN** C15和C17按共享文档上限完成读取，并继续原结构和业务校验

#### Scenario: 单次或累计文档额度不足

- **WHEN** 转换文档单次读取或C17单标准条目累计工件读取超过16MiB
- **THEN** 核验失败，不返回截断正文，候选包及其它工件的原读取上限保持

### Requirement: 未识别表格图片必须保留来源与单元格位置

系统 MUST 使用唯一strict UnrecognizedTableImageRefV1Schema表达kind=unrecognized-image、rawResponseArtifactRef及规范化packageEntryPath。cell及TableField的可选有界unrecognizedImages MUST 保留实际来源、行列与合并关系；图文混排保留真实文本，纯图value=null且带非空图片引用，空单元格不得冒充图形。图片和路径不得进入正文、指标值或关键字段覆盖；不得推断图形含义。

#### Scenario: 图文及纯图单元格进入JSON-LD

- **WHEN** 已验证表格包含文字与图片或只有图片的单元格
- **THEN** JSON-LD保留真实文字及独立未识别图片引用、逻辑位置与合并关系，不伪造正文或丢弃纯图单元格

#### Scenario: 错来源或不安全路径

- **WHEN** 图片引用缺失、不属于可证明的本次ZIP或路径越界
- **THEN** 转换整体拒绝，不返回部分成功或静默空值

### Requirement: 标准XML字符引用按正文语义解析

系统 MUST 在DOCX及共享OOXML文本解析中将XML预定义和数字字符引用还原为实际字符，且不重复解码已还原文本。解析前 MUST 保留DOCTYPE与ENTITY声明拒绝、包结构及资源上限；不得启用外部实体或HTML实体。MinerU的DOCX源文本一致性核验 MUST 比较还原后的正文，并保留原不一致拒绝和质量要求。

#### Scenario: 合法字符引用与官网正文一致

- **WHEN** 合法DOCX正文包含标准XML字符引用，官网返回对应实际字符
- **THEN** 系统按正文语义还原字符并保留来源结构，通过原一致性与质量核验后登记正式资料段

#### Scenario: 危险实体或真实正文不一致

- **WHEN** 输入包含DOCTYPE/ENTITY声明，或服务正文与源正文实际不一致
- **THEN** 原安全或一致性核验拒绝，不以关闭核验、改写原文或降低质量计作成功

### Requirement: 无属性eq公式文本按惰性纯文本保留

系统 MUST 在MinerU表格HTML文本读取中把无属性`eq`元素视为惰性行内纯文本容器：沿既有递归读取单元格文本并按字面保留公式文本，不渲染、不执行、不求值，不把公式内容解释为指标值或其它源资料事实。带属性的`eq` MUST 继续被拒绝；DOCTYPE/ENTITY声明、危险标签、未知标签、表格结构及资源上限检查 MUST 保持不变；不新增HTML渲染或公式引擎。

#### Scenario: 无属性eq公式文本原样保留

- **WHEN** 官网表格HTML使用无属性`eq`元素保存公式文本
- **THEN** 系统按字面文本读取并保留，不求值、不渲染，继续通过原表格结构与资源校验

#### Scenario: 带属性eq或危险内容继续拒绝

- **WHEN** `eq`携带属性，或输入包含DOCTYPE/ENTITY声明、危险或未知标签
- **THEN** 原拒绝行为保持不变，不以放宽标签集合降低安全边界
