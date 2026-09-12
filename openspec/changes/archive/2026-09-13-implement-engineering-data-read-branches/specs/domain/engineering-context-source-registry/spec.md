## ADDED Requirements

### Requirement: 资料段与证据读取形成受权且脱敏的查询结果

系统 MUST 通过既有 `EngineeringDataPortV1.read` 的 `source-segments` 与 `evidence-access` 分支读取 C11 已登记的资料段事实。系统 MUST 在记录或返回查询结果前调用 C06 `verify`，校验与请求一致的精确工程数据分支、工程、空间区段和资料版本；目标定位所需的最小内部查找不得产生外部可观察差异，并且必须在精确复验失败时丢弃。查询成功 MUST 在 C11 自有事实内只追加保存查询分支、输入精确引用、用途、授权上下文、操作者、记录时间和审计引用，并返回既有 `{queryResultRef}` 成功形状；resolve MUST 重新校验当前授权后，依据该引用解析不可变 C11 资料段事实，不复制资料段、C04 工件或其它模块事实。（RI-S13、RI-S14）

#### Scenario: 读取完整资料段集合定位

- **WHEN** 调用方通过 `source-segments` 分支请求同一工程中已存在、已就绪且当前获准的资料段集合
- **THEN** 系统只追加查询结果与成功审计并返回稳定 `queryResultRef`
- **AND** 受权 resolve 返回该集合的精确引用、来源版本、继承的 `SourceAccessGrantRefV1` 及类型化资料段定位，不返回资料正文

#### Scenario: 按证据引用读取安全定位

- **WHEN** 调用方通过 `evidence-access` 分支提交非空证据引用和用途代码，且每项资料版本、资料段与空间区段均属于同一工程并获当前授权
- **THEN** 系统只追加一个覆盖全部请求证据的查询结果并返回稳定 `queryResultRef`
- **AND** 受权 resolve 最多返回原证据引用、资料段定位、资料段集合引用和继承的 `SourceAccessGrantRefV1`，不打开或返回原始正文

#### Scenario: 缺失跨工程与越权使用同类拒绝

- **WHEN** 任一读取或 resolve 请求缺少所需能力、引用另一工程、超出空间或资料授权，或者目标查询结果、资料版本、资料段集合或资料段不存在
- **THEN** 系统对这些情况返回同一外部 `AUTHORIZATION_DENIED` 类别
- **AND** 不泄露目标存在性，不返回部分证据，不写入查询结果或业务成功审计

#### Scenario: 当前授权撤销后不能解析历史查询

- **WHEN** 查询结果创建后，调用方的工程、空间或资料当前授权被撤销或不再覆盖原查询全部目标
- **THEN** resolve 以 `AUTHORIZATION_DENIED` 拒绝访问
- **AND** 历史查询结果、资料段和原授权引用保持不可变，系统不以创建时授权替代当前复验

#### Scenario: 查询结果不形成正文旁路

- **WHEN** 调用方成功读取资料段或证据查询结果
- **THEN** 返回内容不包含原文、解析正文、完整 JSON-LD、任意工件字节或可绕过 C04 的读取句柄
- **AND** 正文仍只能通过 C04 的受权工件读取并按其契约审计；C11 不拥有脱敏摘要事实时不虚构摘要引用

#### Scenario: 相同查询重放不重复结果与审计

- **WHEN** 调用方以相同工程、分支、`queryId` 和相同 strict 查询载荷重试
- **THEN** 系统返回首次创建的 `queryResultRef`
- **AND** 不重复写入查询结果或成功审计；相同 `queryId` 攀附不同载荷时返回幂等冲突

#### Scenario: 查询结果或审计失败整体回滚

- **WHEN** C11 查询结果、命令收据或只追加审计任一步无法在本地事务写入
- **THEN** 整个查询记录事务回滚且不返回业务成功
- **AND** 原查询身份可以安全重试，不引入新的事务或补偿模型

## MODIFIED Requirements

### Requirement: C11 保持既有工程数据公共端口边界

系统 MUST 保持 C02 `EngineeringDataPortV1` 的 `apply`、`freeze`、`read` 方法及其闭合公共分支不变，并在 C11 PostgreSQL adapter 内实现 C02 已声明的 `source-segments` 与 `evidence-access` 读取分支。C11 的工程/区段业务修订、资料段集合登记、适用性元数据快照和工程资料查询结果是工程数据模块拥有的领域能力；它们不得伪装成开放 repository、任意 JSON patch 或 `metadataArtifactRef` 内不可校验的自由字段。跨模块消费者若需要新增公共命令、查询分支或成功形状，MUST 先通过独立契约演进 change 明确 Schema、授权和结果。（RI-S1、RI-S13、RI-S14、RA-S1）

#### Scenario: 现有来源交付端口完成公共登记

- **WHEN** 调用方通过 `register-source-delivery` 提交既有 strict 公共载荷
- **THEN** 模块以 `metadataArtifactRef` 解析并验证 C11 所需来源元数据，返回既有成功引用
- **AND** C02/C09 的公共方法、分支名称和 transport route 无需改变

#### Scenario: 拒绝借自由元数据扩张公共调用

- **WHEN** 调用方试图把任意命令、连接凭据、跨工程引用或未经 Schema 验证的领域写入塞入元数据工件
- **THEN** C11 在产生业务事实前拒绝该内容
- **AND** 不把元数据工件当作通用扩展协议

#### Scenario: 既有读取分支通过公共端口返回结果引用

- **WHEN** 调用方通过 C02 已声明的 `source-segments` 或 `evidence-access` strict 查询分支读取 C11 资料事实
- **THEN** C11 返回既有 `{queryResultRef}` 成功形状并提供同所有者窄 resolve 能力
- **AND** 不修改 `packages/contracts`、新增公共端口、分支、能力或 transport route
