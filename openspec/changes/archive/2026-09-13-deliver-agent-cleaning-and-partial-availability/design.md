## Context

动机见 [proposal.md](./proposal.md#why)。本 change 的行为契约见 [specs/data/agent-cleaning-and-partial-availability/spec.md](./specs/data/agent-cleaning-and-partial-availability/spec.md)。

当前代码已经提供三条可复用路径：C08 的 `AgentTaskDefinitionV1`、`AgentTaskDefinitionRegistry`、`AgentRuntimeRunner` 与 PostgreSQL 任务账本；C11 的 `PostgresEngineeringContextSourceRegistry.freeze()`、资料授权和 C03 事务/Outbox；C12 的成功转换记录、JSON-LD 工件和资料段集合，以及 C14 的不可变监测快照、样本/对齐点/特征。C13 已在检查点 `e0c928105de371668f7619145eb87a2272854b12` 批准以 C12 的 `ocr-layout` 契约输出相同三类引用，但尚未归档，当前工作区也尚无其生产实现。

当前公共 `IdentificationPreparationSnapshotV1` 只能保存单数 `includedSourceSegmentSetRef`，而冻结命令允许多个 `sourceVersionRefs`；这无法表达本 change 要求的逐资料一一对应。协调决策已把公共契约修正归入独立前置 change `evolve-identification-preparation-segment-set-refs`，其字段固定为 `includedSourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1)`。C15 只消费该复数契约，不修改 `packages/contracts`。

## Goals / Non-Goals

**Goals:**

- 在 `engineering-data` 内拥有一个 `cleaning` 子模块，以一项必经 `data-cleaning` 任务收口一次识别准备的全部文档和可选监测输入。
- 让 Agent 仅提出引用级排除；最终保留范围、每项决定和 `available | partial | unavailable` 由确定性策略计算。
- 让正式清洗事实自动生效，但只在 C08 任务完成且结果引用吻合后进入识别准备事务。
- 用既有 `identification-preparation` 冻结命令驱动准备、任务创建和最终冻结，不扩展公共 API。

**Non-Goals:**

- 不新增公开 Schema/端口、HTTP 路由、Web 页面、依赖、模型或中央任务注册表。
- 不修改 C12/C13 原始转换、资料段集合、C14 批次/样本/快照，也不提供值修正功能。
- 不实现 OCR、监测算法、风险识别、人工发布或通用数据质量平台。

## Decisions

### D-01：以现有冻结命令作为唯一业务入口

`PostgresEngineeringContextSourceRegistry.freeze()` 在 `kind === "identification-preparation"` 时委派给 C15 的 `PostgresDataCleaningStore.freezeIdentificationPreparation()`。首次调用解析并冻结输入，再经 D-13 的 Worker 生产组合取得独立的 `agent-task.start-task` 授权并创建或重放一项 C08 `embedded/data-cleaning` 任务，然后返回带该任务引用的 `BUSINESS_BLOCKED`；任务仍运行、失败或取消时继续阻断。相同命令在任务完成后复验结果并原子提交识别准备快照。

选择该方式是因为 `EngineeringFreezeCommandV1`、API 通用传输和 C08 任务端口已经覆盖所需外部契约。备选方案是在 contracts 增加清洗命令或专用 HTTP 路由；它会扩大公共面且不是 C15 验收所需，因此不采用。

### D-02：版本化清洗策略由组合根注入，引用必须精确匹配

核心子模块定义内部 strict Schema `DataCleaningPolicyV1`，包含：`policyRef`、允许的转换策略/质量策略/转换器引用、可选监测序列及 C14 可用性策略引用、两个工具引用和每次返回上限、允许排除原因码、关键数值判定规则、各输入最低保留比例/必需结构、整体最低文档覆盖、C08 增量/校验/预算/模型/提示引用。实现只接收启动时注入并冻结的策略对象；命令的 `dataProcessingPolicyRef` 必须与对象的 `policyRef` 相等。

这避免在 C15 新建第二套配置发布事实，也避免按 generic reference 猜测数据库“最新版”。运行部署选择哪一份已审核策略属于组合根配置；策略或任一引用变化都会改变规范化输入摘要并产生新任务。备选方案是新增策略注册表；当前仅有一个消费方且没有公共治理需求，属于过早抽象，不采用。

### D-03：一次识别准备对应一个冻结清单和一个 Agent 任务

`CleaningPreparationManifestV1` 是存入 C04 的不可变内容工件，不复制正文或数值。它固定命令身份、工程修订/空间/授权、父运行、策略全版本，以及按命令顺序排列的每份资料：`sourceVersionRef`、唯一成功 `conversionRef`、`jsonLdArtifactRef`、`sourceSegmentSetRef`、输入类型；另可固定一个由策略指定序列和命令截止点产生的 `monitoringSnapshotRef`。清单工件引用作为 C08 `inputArtifactRefs` 中的主输入。

适配器按 `sourceVersionRef` 和策略允许的三个转换引用查找成功 C12/C13 转换；必须恰好一条，零条或多条都阻断。监测策略存在时，适配器通过 C14 冻结/幂等重放精确快照；策略不存在时忽略 `monitoringCutoff` 以外的监测数据。一个任务统一判断跨资料整体覆盖，避免多个任务之间再造协调状态。

备选方案是每份输入一个任务；它需要额外聚合任务、预算和一致性协议，而且不能简洁表达整体覆盖，因此不采用。

### D-04：白名单只含两个有界只读领域工具

`createDataCleaningTaskDefinition()` 向 C08 注册且仅注册：

1. `read-document-segment-slice`：输入为清单内 `sourceVersionRef`、`sourceSegmentIds[]`；复验任务类型、策略、工程/空间/资料权限、集合归属和对象数，读取 C12/C13 JSON-LD 与段集合后写入受保护观察工件。
2. `read-monitoring-snapshot-slice`：输入为清单内 `monitoringSnapshotRef` 和获准成员/对齐点/特征标识；复验相同边界，经 C14 精确读取后写入受保护观察工件。

两个工具都返回 `effect: "none"`，把实际返回对象数和字节数交给 C08 预算计量；工具不计算、不写业务事实，也不提供全文扫描。授权在每次调用时由既有 C11 授权服务复验，失败统一映射为不可枚举 `AUTHORIZATION_DENIED`。

备选方案是让模型直接读取清单引用的完整工件；这会绕过对象/上下文预算并扩大资料暴露，不采用。

### D-05：候选只有排除操作，Schema 从结构上禁止改值

内部 `DataCleaningCandidateV1` 只包含候选版本、质量观察和 `exclusions[]`。每项排除是判别联合：文档项携带 `sourceVersionRef + sourceSegmentId`，监测项携带 `monitoringSnapshotRef + sampleVersionRef`；两类均携带策略允许的 `reasonCode` 与至少一个现有证据引用。没有 `value`、`text`、`replacement`、`path`、`patch`、单位、坐标或时间字段，strict 解析会拒绝未知字段。

`incrementSchema` 与候选中的 `exclusions[]` 使用同一个 Schema；不定义通用 Patch，也不把 Agent 质量观察作为规则输入。确定性校验逐项检查目标存在、证据属于冻结输入、原因受策略允许、无重复，以及目标未被标为关键数值/必需结构/受保护监测样本，并输出 C08 标准 `accepted | rejected` 项和可修复分类。

备选方案是让 Agent 返回清洗后的对象再做 diff；这仍允许有害修改且生成第二份事实，不采用。

### D-06：确定性收口计算保留集和三级业务可用性

`settleDataCleaningCandidate()` 从清单、原始 C12/C13/C14 事实、策略和通过的排除项计算，不接受 Agent 提供的可用性字段。对每个输入：

- 基线不可计算、关键数值/必需结构缺失或保留比例低于最低值为 `unavailable`；
- 基线可计算、存在已接受排除且仍满足所有门为 `partial`；
- 基线可计算、无已接受排除且所有门通过为 `available`。

C14 `unavailable` 是不可提升下界；C14 `available | partial` 仍需通过 C15 业务门。整体结果要求至少一份文档非 `unavailable` 且非不可用文档数/总文档数达到策略下限；监测不可用不会伪造快照，但其原因留在覆盖决定。结果保存输入级状态、保留/排除引用、逐项校验、整体状态、稳定原因和全部版本引用。

备选方案是让模型给质量分或可用标签；其不可重放且违反确定性收口，不采用。

### D-07：正式结果是 C04 工件加 C15 只追加索引事实

`finalizeCandidate` 闭包调用 C15 store：先把 `DataCleaningResultV1` 作为 C04 内容工件写入，再在 C03 事务中插入只追加的清洗结果、输入状态、排除决定、命令收据和一条事实审计，最后返回 C08 `content-artifact` 结果族。清洗结果无需人工审核；C08 后续候选记录或任务完成失败时，该结果即使已持久化也只是孤儿，识别准备通过 `agentTaskRef + resultArtifactRef` 双向匹配拒绝消费。

选择“工件为完整载荷、PostgreSQL 为受约束索引”可复用 C04 保护传播并减少关系表复制正文。备选方案是仅把 JSON 存数据库；它绕过工件完整性/权限模型，不采用。

### D-08：识别准备在单个 C03 事务中收口

任务完成后，store 依次复验：当前授权；清单与命令规范化摘要；C08 任务类型、状态、全部策略/模型/工具/预算引用；任务正式结果引用；C15 结果索引与工件摘要；每个转换、资料段集合及可选 C14 快照仍与清单一致。随后按命令顺序构造前置契约提供的 `includedSourceSegmentSetRefs[]`，使其与 `sourceVersionRefs[]` 一一对应；每个不可用文档的全部段以及部分可用文档的已接受段形成 `excludedSegmentDecisionRefs[]`。监测非不可用时写入原 `monitoringSnapshotRef`，否则只在 `coverageDecisionRef` 指向的决定工件中记录原因。

准备快照、覆盖/排除决定工件引用、C03 命令收据、事实审计和单条 `engineering.inputs-ready.v1` Outbox 在一个 `TransactionUnitV1.execute()` 中提交。Outbox 只携带 `identificationPreparationSnapshotRef`。返回成功前再次复验授权；若撤销，返回授权失败但历史事务事实不被删除。

备选方案是在 Agent 完成时直接发布输入就绪事件；那时还没有跨输入覆盖决定，且无法和准备快照原子提交，不采用。

### D-09：失败、幂等和恢复沿用 C03/C08 语义

准备身份为 `(projectId, commandId)`，业务幂等为 `(projectId, idempotencyKey, canonical command + policy + resolved input refs)`；同键异载荷返回 `IDEMPOTENCY_CONFLICT`。C08 任务 ID 从该规范化摘要派生，首次 freeze 创建任务，后续 freeze 只读取/重放同一任务。转换缺失/歧义、覆盖不足、任务未完成映射为 `BUSINESS_BLOCKED`；契约/版本不兼容映射为 `UNSUPPORTED_CONTRACT`；权限失败为 `AUTHORIZATION_DENIED`；可重试存储/工件故障为 `TRANSIENT_FAILURE`；已进入不可恢复终态为 `TERMINAL_FAILURE`。

模型、工具、预算、租约和修正失败完全由 C08 保存与恢复；C15 不换模型、不扩预算、不建立旁路。任务启动授权由 D-13 通过 C06 独立签发：授权来源缺失、过期、撤销、越权或与命令 actor/project 不一致时，组合根关闭失败且不调用 C08；C06 的授权成功或拒绝安全审计照常成立。C08 返回结构化失败时原样交回 C15 错误映射，不用旧任务、缓存上下文或伪造成功替代。C03 收据与唯一约束确保重复 freeze 不重复任务、清洗事实、决定、审计或事件。

### D-10：文件所有权保持在现有模块边界内

- `packages/core/src/engineering-data/cleaning/{schema,service,index}.ts`：内部 Schema、确定性校验/收口和 C08 定义/工具协议；`packages/core/package.json` 只增加该子路径导出。
- `packages/adapters/src/engineering-data/cleaning/{postgres-data-cleaning-store,index}.ts`：C12/C13/C14/C04/C08/C03 组合、工具读取和持久化；store 向组合根提交不含授权上下文的启动草案及精确空间/资料范围，不自行扩写 capability；`packages/adapters/package.json` 只增加该子路径导出。
- `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`：只增加可选 cleaning store 依赖与 `identification-preparation` 分派；不复制清洗逻辑。
- `packages/adapters/src/postgres/migrations/engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.ts`：C15 表、约束、索引和迁移注册；序号来自协调端为 C15 预留的 `000016–000019` 号段。
- `packages/adapters/test/postgres/postgres-foundation.test.ts`：把自动发现序列的既有期望推进到 `000016`，证明未引入手写中央迁移注册。
- `apps/worker/src/engineering-data/cleaning/runtime.ts`：把 C15 定义的渲染/解释器接到既有 Runner 的 task-type 分派。
- `apps/worker/src/engineering-data/cleaning/composition.ts`：唯一生产组合位置，组装 C15 store、既有 `AgentTaskDefinitionRegistry` 与 `PostgresAgentTaskAdapter`，通过 C06 签发启动授权后调用既有 C08 `startTask`；`apps/worker/src/engineering-data/cleaning/index.ts` 与根 `index.ts` 只导出该组合，不创建第二个 runner 或全局单例。
- 对应测试文件只覆盖跨层稳定行为；不修改 `packages/contracts`、根 workspace/锁文件、`openspec/config.yaml`、API/Web 或中央注册文件。

备选方案是把所有逻辑塞进 C11 registry 或 C08 runner；那会混合领域判断、持久化与通用运行时，增加隐式耦合，不采用。

### D-11：测试使用确定性夹具，不把 LLM 文案当期望

核心表格驱动测试覆盖四类文档、OCR 兼容结构、监测快照、非法改值/越权排除、关键数值保护及三级可用性。适配器集成测试复用现有 PostgreSQL/C04/C03/C08/C11/C12/C14 fixture，验证唯一转换解析、只追加结果、任务/结果双向绑定、事务回滚、幂等、授权撤销和 Outbox。Worker 测试给 Runner 注入协议级模型脚本，只断言 strict 候选、工具路由、失败封闭和正式结果，不断言提示词或模型自然语言。组合测试断言 C06 授权请求固定为 `agent-task.start-task`、最终命令只有 `agent-task.start`、授权失败不触达 C08；PostgreSQL 集成测试使用真实 C06 会话/授权与 C08 adapter，删除测试内手工追加 capability 的旁路，并核对授权安全审计、任务事实审计及任务信封中的授权引用。

API 现有通用 `invokeEngineeringFreeze` 回归测试证明无需新增路由；Web 无用户可见变更，因此不新增 UI 或脆弱文案测试。

### D-12：前置依赖是实现门，不在 C15 内兼容旧契约

开始实现前必须满足：`evolve-identification-preparation-segment-set-refs` 与 C13 均已归档并集成；生成类型为复数，C13 仍输出相同 C12 公共转换记录，C08/C11/C12/C14 均在实现基线。实现者从固定 base `5c49f20e615c6507be40b5cc74f734fba4b4fb80` 检查集成后的符号漂移；不添加单复数字段兼容分支，不读取 C13 私有 PaddleX 结构。

### D-13：Worker 组合根经 C06 签发独立启动授权

`apps/worker/src/engineering-data/cleaning/composition.ts` 新增唯一生产工厂 `createPostgresDataCleaningComposition()`。其输入固定为：去掉 `startAgentTask` 的 `PostgresDataCleaningStoreOptions`；去掉 `db/registry/transactionUnit/referenceGuard/authorization/artifactStore` 的既有 `PostgresAgentTaskAdapterOptions`；以及 `resolveStartAuthorizationInvocation()`。后者只能返回 C06 `AuthorizationRequestV1` 已有的受信调用来源：请求作用域内的 `human-session`，或携带 C06 已签发父上下文和同一 causal run 的 `system` 调用；它不得返回自造的 `AuthorizationContextV1`。

store 把启动接缝收窄为内部 `DataCleaningAgentTaskStartRequestV1`：`command` 是缺少 `authorization` 的既有 `StartAgentTaskCommandV1` 草案，另带清洗命令的精确 `requestedSpatialScopeRefs` 与 `requestedSourceVersionRefs`。工厂收到请求后按以下顺序执行：

1. 调用 `resolveStartAuthorizationInvocation()` 取得服务端持有的调用来源；该来源不得来自任务信封、客户端 capability 字段或对冻结上下文的复制。
2. 以启动 `commandId` 作为 `invocationId`，固定 branch 为 `agent-task.start-task`，并携带草案的工程、时间及精确空间/资料范围调用同一个 `LocalIdentityAccessV1.authorize()`。`human-session` 由 C06 认证同一发起者；`system` 的父上下文必须已由 C06 对同一 actor/project 和 `agent-task.start-task` 签发，原 `engineering-data.freeze` 上下文因 capability 不同不得作为父上下文。
3. 校验 C06 决定的 actor/project 与草案相等、能力集合恰为 `agent-task.start`，再注入该上下文并通过 `StartAgentTaskCommandV1Schema` strict parse；任一不一致均关闭失败。
4. 调用工厂组装的同一个 `PostgresAgentTaskAdapter.startTask()`。该 adapter 必须注入同一个 `LocalIdentityAccessV1`，使 C08 在创建和 Worker 执行时按原 `commandId`、branch 与冻结范围复验；不得使用无授权 verifier 的 adapter。

C06 是 capability 的唯一签发者：角色/branch 映射、父上下文子集、当前成员/空间/资料修订和 context 生命周期仍由 `access-policy/v1` 与 PostgreSQL 授权事实治理，C15 不新增角色、能力或授权缓存。C06 为授权成功与拒绝写安全审计；C08 以 C03 事务写任务及 `agent-task.start-task` 事实审计，并把新授权引用冻结进任务信封；C15 后续清洗结果和准备审计继续引用任务与原 freeze 授权，因此两段授权可沿任务引用重建。来源解析失败、C06 拒绝或返回不一致上下文时不调用 C08；C08 结构化失败由 store 按 D-09 映射且不得降级。

选择 Worker 工厂而非把授权写进 store，是因为 store 不拥有身份凭据或 capability 签发权，C08/C06 已分别拥有任务和授权事实。备选的测试内追加 `agent-task.start`、修改 C08 capability、让 store 接受两个公共授权字段或另建运行时都会扩大或伪造边界，因此不采用。

## Risks / Trade-offs

- [前置复数契约或 C13 尚未归档] → 在实现首项设置硬门；未满足时停止，不在 C15 打补丁。
- [一个任务处理多份资料可能接近对象预算] → 工具只分片读取，预算由版本化策略硬限制；耗尽即失败，不拆隐式子任务。
- [C04 工件成功而后续任务持久化失败会留下孤儿] → 消费时要求 C08 完成状态与结果双向匹配；内容寻址工件可安全去重并由后续保留策略回收。
- [数据处理策略目前没有公共治理仓库] → 由组合根注入唯一版本对象并校验引用；只有出现多租户动态治理需求时再开独立 change。
- [准备提交后授权立即撤销] → 工具、最终收口和返回前均复验；历史事实保留审计，但后续读取继续受当前授权约束。
- [C12/C13 对同一资料版本产生多条允许转换] → 要求策略过滤后恰好一条，否则业务阻断，避免任意选择。
- [部署未提供受信的启动授权调用来源] → IP-09 关闭失败并阻断清洗准备；不得退回 freeze 上下文或手工 capability。协调端必须把请求作用域 human session 或已有 C06 同能力父上下文接入 `resolveStartAuthorizationInvocation()`。

## Migration Plan

1. 确认前置契约 change 与 C13 已归档并集成，在集成分支重新核对 C08/C11/C12/C13/C14 符号。
2. 部署 `000016_agent_cleaning_partial_availability` 的只追加表、唯一约束与索引；迁移不回填历史准备，也不改旧表语义。
3. 部署 core/adapters/worker 后注入一份经审核、引用完全匹配的清洗策略，并把服务端受信调用来源接入 `resolveStartAuthorizationInvocation()`；先用合成四文档和地表沉降快照跑确定性验收，再允许新识别准备进入。
4. 旧识别准备快照保持可读；新冻结请求必须走 C15，不能降级到未清洗路径。
5. 回滚应用时停止创建新 C15 任务并恢复上一应用版本；保留 `000016` 表和已成立事实以供审计，不执行破坏性 down migration。重新部署同版本后依据 C03/C08 身份继续恢复。

## Open Questions

无。公共复数资料段集合问题已由协调决策移至前置 change；启动授权的 capability、签发者、组合位置、调用输入与失败语义已由 D-13 固定，协调端只需提供受信调用来源的部署绑定，不再决定公共接口或授权方向。
