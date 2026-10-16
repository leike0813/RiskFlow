# Implementation Plan

## 1. 实施基线与权威来源

固定 base commit：`31ad1a2c47a377f20179e0008241034c14a3bec5`。当前未提交成果属于继承叠加层，代码路径由本文件第7节和 `baseline.json` 定位；这些记录不伪装成提交检查点。实施前核对HEAD、实际符号和继承改动；当前已获准实施，保留工作区改动，不提交Git。

权威输入为proposal、全部delta、design D-01～D-16、审计报告及本change handoff；原验收change只提供继承实现和历史证据，不作为已归档依赖。新change接管减负，原change保留5/19和实机验收责任。

IP顺序：IP-01 → IP-02 → IP-03/IP-04/IP-05 → IP-06/IP-07 → IP-08。斜线表示逻辑可独立验证，实际共享contracts/start.mjs串行编辑。所有公开决定已在design闭合；本文件不新增业务语义。

## 2. 复用与接缝

| IP-ID | 审计项   | 设计决定               | 现有符号                                                                                                                                                                                       | 复用及删除动作                                                                                                                                                                                      |
| ----- | -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IP-01 | 1        | D-01、D-02             | `createDeploymentAuthorizationScopeV1`、`createDeploymentAuthorizationAdapterV1`、`authorizeTaskExecution`、`readDeploymentAuthorizationSource`、`AuthorizationContextV1Schema`                | 新增authorizeBusinessAction并复用当前账号/资料授权查询；移除issuedInvocations、逐层签发及调用ID配对。API与Worker在业务动作入口调用，内部adapter消费同一权限决定；租约取消预算仍由原运行时维护。     |
| IP-02 | 2、14    | D-03、D-04             | `PostgresArtifactRegistry.recordAccessOutcome`、`FilesystemArtifactStore.open`、`FilesystemArtifactStore.verifyContent`、`ArtifactReadHandleV1`、`SourceOriginalReaderV1`                      | 普通访问直接短事务追加UUID访问记录及审计，不写command_receipts；put保留摘要，open取消全文/清单哈希复验，verified改completed；所有真实消费方与远程流协议同批改名，维护显式哈希保留。                 |
| IP-03 | 3        | D-05                   | `authorizationScopeDigest`、`readActiveGeneration`、`HybridRetrievalService`、`PostgresRetrievalAdapter`、`QdrantRestClient`、`ModelContextReaderV1`                                           | 代际读取不要求调用者全授权摘要；从真实知识成员求当前可见ID，向量/BM25召回前同范围过滤，再融合及读原事实；正式查询以业务输入和实际成员范围去重；C21原结果直接读取。                                  |
| IP-04 | 4、7、12 | D-06、D-07             | `collectContractReferences`、`validateReferences`、`createDeploymentCheckpointValidatorV1`、`rebuildCommittedState`、`WaitingRefV1Schema`、`ResumeCauseV1Schema`                               | 删递归业务引用证明和官方metadata白名单，保留图状态/线程归属；用原阶段登记恢复已提交结果；业务准备缺项用新增business-preparation等待及对应ready恢复原因。                                            |
| IP-05 | 5、6、12 | D-08、D-09             | `resolveDeploymentPoliciesV1`、`approvalMetadata`、`AssessmentInputSnapshotV1Schema`、`INPUT_SNAPSHOT_REFERENCE_FIELDS_V1`、`resolveConfigurationSet`、`OpenWarningCommandV1Schema`            | 运行清单单向加载成员；删除releaseId批准绑定与重复budget正文；新增V2九项评分快照及V1reader，C18按purpose解析；各后续阶段从原清单冻结自己策略；Ollama同主次版本补丁按真实协议兼容。                   |
| IP-06 | 8、11    | D-10、D-11             | `cleaningActionSchemaFor`、`readDocumentSlice`、`DataCleaningPolicyV1Schema`、`assessDocument`、`MODEL_OUTPUT_SCHEMA_INVALID`、`agentTaskRefFor`                                               | 任务sourceOption映射真实来源，宿主管理分页；Schema错误经现有runner/C22候选纠错并真实记账；documentRules按inputKind选择结构要求，保护数值/关键段但不强求所有普通段保留，既有单候选参与依据逻辑保持。 |
| IP-07 | 9、10    | D-12                   | `modelContextArtifactSetEntityIdFor`、`retrievalArtifactSetRefFor`、`encodeUiReadCursor`、`decodeUiReadCursor`、`requireCursorBinding`、`AgentTaskDetailPage`                                  | 新上下文采用短UUID与显式关联，旧完整ID直读；游标去全授权摘要和512门槛，按组成字段共享解析；详情直接读目标；未知错误映射真实技术错误，页面结束加载并重试。                                           |
| IP-08 | 13       | D-13、D-14、D-15、D-16 | `KnowledgeReleaseV1Schema`、`parseKnowledgeRelease`、`selectGovernedReleaseCandidates`、`PostgresKnowledgeGovernanceAdapter`、`ApplicableRuleSetDocumentV1Schema`、`assembleApplicableRuleSet` | 新增KnowledgeReleaseV2来源联合和000059来源/适用范围迁移；仅C17/C19内部生成派生发布；assemble公开结果含正式release/basis；多适用性并存，人工语义审核和措施采纳不变；同步部署手册与接续验收。         |

角色/资料权限、业务状态、评分、三项处置约束、预算台账及人工专业决定分别沿原事实源，不能在宿主或UI复制另一实现。新公开数据使用原Schema模块导出；示例与测试导入同一事实源。

## 3. 代码变更映射

以下每行的全部Scenario都归该行IP负责，删除要求则由新职责场景证明迁移。第6节将IP绑定到真实测试、夹具、断言和命令；第7节是精确文件集合。一个Requirement关联多个IP时，在共享接口更新后统一回归。

| Requirement                                                                                                        | IP-ID               | 全部Scenario                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data/agent-cleaning-and-partial-availability：data-cleaning 任务只使用版本化只读领域工具（MODIFIED）               | IP-06               | 清洗任务经生产组合根以受权能力启动；读取获准的文档资料段切片；读取获准的监测快照切片；越权或越界工具请求被拒绝；多资料按短选项读取；模型误选来源                                                                                          |
| data/agent-cleaning-and-partial-availability：业务可用性由确定性策略收口（MODIFIED）                               | IP-06               | 保留子集达到部分可用门槛；无排除且全部门槛通过；低于最低门槛时不可用；表格与空白页正常处理；可解释部分使用                                                                                                                                |
| data/agent-cleaning-and-partial-availability：清洗版本保留且读取独立记账（ADDED）                                  | IP-02               | 重复查看准备；准备冻结防重复                                                                                                                                                                                                              |
| data/agent-cleaning-and-partial-availability：版本、幂等与权限支持精确重放（REMOVED）                              | IP-02               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| domain/calibration-suggestion-and-governance-loop：校准入口只接受精确且已越限的偏差事实（MODIFIED）                | IP-05               | 已越限事实进入校准；冻结评估输入与目标依据精确匹配；其它有效依据不能替代冻结依据；未越限事实不进入校准；无权或错配事实不可枚举                                                                                                            |
| domain/execution-forecast-feedback-and-deviation：效果预测冻结建议、监测和评估依据（MODIFIED）                     | IP-05               | 冻结完整预测输入；预测依据不完整时显式不可用                                                                                                                                                                                              |
| domain/execution-forecast-feedback-and-deviation：偏差事实按冻结策略确定性计算（MODIFIED）                         | IP-05               | 三类策略精确判定阈值边界；无预测或比较口径不一致时不造偏差；C28 不伪造公共偏差记录                                                                                                                                                        |
| domain/module-interfaces-events-workflows：命令、结果和错误具有稳定幂等语义（MODIFIED）                            | IP-02               | 重复命令返回原结果；同键不同载荷冲突；陈旧版本提交被拒绝；双击提交不重复效果；普通查询不占用命令去重键                                                                                                                                    |
| domain/module-interfaces-events-workflows：适用规则集组装命令返回正式派生发布（ADDED）                             | IP-08               | 原组装入口直接得到可用依据                                                                                                                                                                                                                |
| domain/module-interfaces-events-workflows：可信内部调用复用业务上下文（ADDED）                                     | IP-01               | 业务入口向内部传递上下文；内部无需客户端重复声明策略                                                                                                                                                                                      |
| domain/module-interfaces-events-workflows：评估候选按业务条件和当前权限读取（ADDED）                               | IP-05               | 两类目录使用业务条件读取；目录缺少业务条件                                                                                                                                                                                                |
| domain/module-interfaces-events-workflows：评估与后续阶段分别冻结所需配置（ADDED）                                 | IP-05               | 评分启动不要求后续策略；后续阶段准备自己的依据                                                                                                                                                                                            |
| domain/module-interfaces-events-workflows：受保护读端口必须以当前调用的领域标识复验签发身份（REMOVED）             | IP-01               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| domain/module-interfaces-events-workflows：进程内配对的派生调用身份必须纳入调用主体维度（REMOVED）                 | IP-01               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| domain/module-interfaces-events-workflows：每次跨模块调用携带冻结授权上下文（REMOVED）                             | IP-01               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| domain/module-interfaces-events-workflows：评估候选公共输入与授权调用身份必须闭合（REMOVED）                       | IP-05               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| domain/module-interfaces-events-workflows：评估启动输入显式覆盖冻结所需引用（REMOVED）                             | IP-05               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| domain/response-recommendation：措施候选只来自冻结的已发布依据（MODIFIED）                                         | IP-05               | 多预警冻结同一任务的候选；不合格来源不能进入候选；进入处置再准备配置；处置配置待准备                                                                                                                                                      |
| domain/response-recommendation：正式建议不可变且贯通评估到措施（MODIFIED）                                         | IP-05               | 合格建议入库并可重放；不完整或失败结果不可冒充正式建议；正式结果直接供采纳；失败候选不可采纳                                                                                                                                              |
| domain/warning-tasks-and-in-app-notification：预警只能消费已持久化的确定性评估事实（MODIFIED）                     | IP-05               | 由精确评估记录创建预警输入；无触发事实返回空结果；策略或授权不匹配时失败闭合                                                                                                                                                              |
| engineering-data/structured-document-conversion：权限、版本与幂等性在内容读取前生效（MODIFIED）                    | IP-02               | 无正文权限的转换被拒绝；相同命令幂等重试；同键不同载荷冲突；登记原件直接转换；转换与清洗职责区分                                                                                                                                          |
| identification/graph：业务运行事实与 LangGraph 检查点严格分离（MODIFIED）                                          | IP-04               | 真实 StateGraph 落检查点时仅豁免 LangGraph 控制通道；状态物化前的输入检查点仍严格可解析；业务提交后检查点失败；检查点引用不存在的业务事实；业务事实同键异载荷冲突；合并提交后继续；原阶段结果缺失                                         |
| identification/graph：启动、恢复、重试与取消保持冻结身份和当前授权（MODIFIED）                                     | IP-04               | 相同启动命令幂等重放；当前授权撤销后停止推进；协作式取消保留已成立事实；Agent 任务等待原样复原；等待引用缺失或类型不匹配时恢复失败闭合；正常准备缺项进入等待；取消保留完成工作；重复恢复复用结果                                          |
| identification/process-model-mechanism-and-evidence-governance：检索证据库组合精确冻结三个发布集合（MODIFIED）     | IP-08               | 三个合格发布形成组合；成员缺失或停用时组合不可消费；组合发布绑定与事件原子成立；已批准知识自动组合；成员内容变化；组合事件原子提交                                                                                                        |
| identification/relationship-context-and-retrieval-agent-review：混合检索基线与有限补搜严格绑定（MODIFIED）         | IP-03               | 基线和补搜均精确可追溯；基线不合格或补搜越界；新增授权不改变原任务输入；补搜限定当前任务范围                                                                                                                                              |
| identification/relationship-context-and-retrieval-agent-review：已登记五项上下文直接按引用读取（ADDED）            | IP-03               | 完成任务直接提供原上下文                                                                                                                                                                                                                  |
| identification/versioned-dual-index-hybrid-retrieval：查询结果必须保留可重放解释且区分排序分值与置信度（MODIFIED） | IP-03               | 结果可由固定输入重放解释；相同查询标识的载荷冲突；排序分值不进入确定性评估；原结果在权限不变时可读；重复物化返回原结果                                                                                                                    |
| identification/versioned-dual-index-hybrid-retrieval：知识代际与查询可见范围分离（ADDED）                          | IP-03               | 增加无关资料继续检索；有限权限查询只含可见成员；知识版本确实变化                                                                                                                                                                          |
| identification/versioned-dual-index-hybrid-retrieval：查询必须精确绑定输入并在当前权限下回查事实（REMOVED）        | IP-03               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| knowledge/assessment-configuration-and-measure-governance：发布集合固定完整兼容的精确配置（MODIFIED）              | IP-05               | 完整兼容发布形成精确集合；发布变化不改写冻结集合；不完整或不兼容集合不降级                                                                                                                                                                |
| knowledge/governed-definition-lifecycle：发布版本按生效时间组成不可变发布集合（MODIFIED）                          | IP-08               | 发布进入工程发布集合；停用后发布后续修订；停用期间的并发发布仍只有一个成立；并发发布只有一个决定生效；同一修订不被重复发布；未来发布保持可预期；发布来源如实记录；并行适用规则集；旧人工记录继续使用                                      |
| knowledge/governed-definition-lifecycle：内容审核与确定性派生发布分工（ADDED）                                     | IP-08               | 批准内容的确定性组合自动生效；业务含义变化仍审核                                                                                                                                                                                          |
| knowledge/governed-definition-lifecycle：修订必须经显式人工复核后才能发布（REMOVED）                               | IP-08               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| knowledge/structured-scoring-rules-and-applicable-rule-sets：公共评估依据解析（MODIFIED）                          | IP-08               | 组装与 resolve 的时刻字段与真实配置核对；精确依据可供后续评估冻结；未准备完成时不返回默认依据；配置或准备绑定不符时拒绝依据；等待补齐后解析；精确准备匹配                                                                                 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets：适用规则集确定性组装自动生效（ADDED）                 | IP-08               | 适用规则集直接供评分；规则本身需修改；同一规则发布多成员                                                                                                                                                                                  |
| knowledge/structured-scoring-rules-and-applicable-rule-sets：不可变适用规则集组装与人工发布（REMOVED）             | IP-08               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/content-addressed-artifact-store：大文件与并发操作保持流式和有界（MODIFIED）                              | IP-02               | 大工件在有界内存中往返；并发写读受配置约束；超过单工件上限被安全拒绝；性能基线不伪装为生产 SLA；大资料流式往返；普通并发受运行配置限制                                                                                                    |
| platform/content-addressed-artifact-store：登记文件直接流式读取（ADDED）                                           | IP-02               | 日常查看直接读取登记对象；读取失败明确结束；读取块保持稳定                                                                                                                                                                                |
| platform/content-addressed-artifact-store：来源限制由业务入口统一执行（ADDED）                                     | IP-02               | 派生结果沿用来源限制；无关资料授权不影响读取                                                                                                                                                                                              |
| platform/content-addressed-artifact-store：访问记录独立追加并保持可追溯（ADDED）                                   | IP-02               | 两次读取独立记账；流取消或记录失败                                                                                                                                                                                                        |
| platform/content-addressed-artifact-store：读取必须封闭路径并验证内容完整性（REMOVED）                             | IP-02               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/content-addressed-artifact-store：权限从授权上下文和父工件只收窄继承（REMOVED）                           | IP-02               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/content-addressed-artifact-store：错误、审计、敏感数据和可观测性保持闭合（REMOVED）                       | IP-02               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/llamacpp-model-gateway：模型部署能力和尺寸由配置冻结（MODIFIED）                                          | IP-05               | 配置化部署调用成功；业务不能选择模型名；部署能力或版本不匹配；补丁版本兼容；实际模型能力改变                                                                                                                                              |
| platform/llamacpp-model-gateway：结构化生成必须按冻结 Schema 提交并经本地 Zod 复验（MODIFIED）                     | IP-06               | 双重约束后的结构化结果成功；Schema 提示与本地严格复验；非法 JSON 结构失败；Zod 复验失败；服务端 Schema 约束缺少证据；输出 Schema 无法安全转换；reasoning 内容不进入持久化或展示；格式错误可被上层反馈；合规输出保留业务校验；不保存思维链 |
| platform/llamacpp-model-gateway：原始响应通过 C04 先耐久保存再返回引用（MODIFIED）                                 | IP-02               | 同步响应先保存后返回；流式终态等待工件提交；失败流保存已接收原文；工件存储失败时 fail closed；同步响应只消费一次正文；保存失败不伪装成功                                                                                                  |
| platform/llamacpp-model-gateway：网络 API 必须保持原网关的授权预算与证据契约（MODIFIED）                           | IP-05               | 合法联网后端被业务复用；无权资料或秘密进入客户端；网络协议失败保持原错误边界；后端切换不得复用旧向量空间；合法网络调用；协议或模型错误                                                                                                    |
| platform/local-identity-project-authorization：安全审计、错误与敏感数据保持最小披露（MODIFIED）                    | IP-01、IP-02、IP-07 | 登录与越权形成最小安全事件；审计失败不静默放行；应用角色不能改写安全审计；未授权与不存在目标不可区分；读取故障明确呈现；重复查看留下真实访问记录；审计失败如实返回                                                                        |
| platform/local-identity-project-authorization：业务动作入口统一执行当前权限（ADDED）                               | IP-01               | 长任务独立于网页登录期限；撤权在下一业务动作生效；可信内部调用复用入口决定；保留不同账号可见范围                                                                                                                                          |
| platform/local-identity-project-authorization：所有授权由服务端从当前事实签发并默认拒绝（REMOVED）                 | IP-01               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/offline-private-deployment-and-operations：跨虚拟机工件访问必须保持 C04 原契约（MODIFIED）                | IP-02               | 真实跨 VM 写入与读取；断流或传输身份越权；普通远程读取复用当前语义；传输未完成                                                                                                                                                            |
| platform/offline-private-deployment-and-operations：检查点只保存运行进度（ADDED）                                  | IP-04               | 进度读写与业务正文解耦；恢复按已提交阶段继续                                                                                                                                                                                              |
| platform/offline-private-deployment-and-operations：运行清单单向解析阶段配置（ADDED）                              | IP-05               | 软件修复复用原规则；运行清单单向解析；后台消费不依赖旧登录期限                                                                                                                                                                            |
| platform/offline-private-deployment-and-operations：生产检查点按当前运行验证真实引用（REMOVED）                    | IP-04               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/offline-private-deployment-and-operations：生产策略与窄读必须解析精确真实来源（REMOVED）                  | IP-05               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/postgresql-outbox-checkpoint-foundation：LangGraph checkpointer 与业务事实完全隔离（MODIFIED）            | IP-04               | 检查点可以独立保存和恢复；检查点不能补造业务事实；检查点失败不回滚已入库事实；清理检查点不删除业务记录；业务领先进度可续办；列历史不触发业务举证；官方元数据兼容                                                                          |
| platform/unified-bounded-agent-runtime：类型化任务定义与领域工具白名单（MODIFIED）                                 | IP-06               | 调用允许的领域工具；拒绝越权或未列入白名单的工具；拒绝通用修改格式；模型使用短资料选项；普通选项错误可修正                                                                                                                                |
| platform/unified-bounded-agent-runtime：类型化增量与确定性校验收口（MODIFIED）                                     | IP-06               | 可修复格式错误；候选越过冻结集合；不可修正约束失败；结构错误在原任务修正；预算不足停止                                                                                                                                                    |
| platform/unified-bounded-agent-runtime：任务范围冻结且权限按业务动作检查（ADDED）                                  | IP-01               | 任务跨网页登录期限；撤权后阻止新动作                                                                                                                                                                                                      |
| platform/unified-bounded-agent-runtime：失败任务证据按当前权限直接读取（ADDED）                                    | IP-01               | 旧任务证据重复查看；系统异常明确反馈                                                                                                                                                                                                      |
| platform/unified-bounded-agent-runtime：授权范围固定并只可收窄（REMOVED）                                          | IP-01               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| platform/unified-bounded-agent-runtime：终态失败证据只通过公共窄读披露（REMOVED）                                  | IP-02、IP-07        | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| risk-assessment/engine：权限与错误边界不泄露受限事实（MODIFIED）                                                   | IP-05               | 跨工程或越空间评估被拒绝；提交前引用变为无效；正常缺项等待；专业计算边界保留                                                                                                                                                              |
| risk-assessment/engine：评分快照只包含本阶段正式依据（ADDED）                                                      | IP-05               | 后续配置缺少不影响评分；新发布不打断冻结评分；历史输入保持可读                                                                                                                                                                            |
| risk-assessment/engine：评估结果按所属记录读取（ADDED）                                                            | IP-05               | 精简评估结果可供下游读取；原记录可回读                                                                                                                                                                                                    |
| risk-assessment/engine：评估输入快照只由完整且相容的正式版本组成（REMOVED）                                        | IP-05               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| risk-assessment/engine：C25 加法式证明已成立实际评估结果（REMOVED）                                                | IP-05               | 删除旧职责，验收迁移后的对应业务行为                                                                                                                                                                                                      |
| web/agent-audit-and-operations-ui：Agent 三种视图必须共享同一任务及有界刷新（MODIFIED）                            | IP-07               | 停靠与全屏共享任务；预算或确定性拒绝；旧任务直接打开；正常游标可翻页；故障有明确反馈                                                                                                                                                      |

## 4. 调用与副作用顺序

1. 用户会话或任务/事件登记确定actor与工程；业务所有者解析目标来源，C06入口按当前权限与冻结上界检查。
2. 内部模块复用该决定，读取已登记资料；每个实际文件访问生成独立UUID，短事务追加访问记录及审计，不插入命令去重回执。
3. 普通输入一次流式消费并解析。模型响应保存与用量结算完成后，现有运行时判断接受或有界候选修正；网关不自行重试。
4. 写入前统一入口检查当前权限；同一业务事务保存事实、审计、回执和事件，失败整体回滚。临时授权和访问时间不改变业务payload身份。
5. 业务提交后写检查点；失败时保留已提交阶段，按原游标和结果恢复。正常缺项记waiting，补齐后从未完成阶段继续；取消/终态不被恢复覆盖。
6. 确定性组合在所属模块计算成员和适用性，C16同事务提交派生来源、发布、绑定和事件。无新语义不创建人工复核，真实冲突转原人工内容流程。

## 5. Schema、状态与持久化落实

- IP-01：现有AuthorizationContext只作一次决定/审计快照；移除身份配对输入和持久因果授权作为执行前置，旧行保留。所有被第7节列出的verify调用点改为消费所属业务入口结果，不能简单把权限校验改为恒真。
- IP-02：ArtifactReadHandle使用completed终态；所有原verified消费点与协议字段一起更新。仅访问UUID和普通审计改变，业务命令/Outbox基础事务不改。
- IP-03：代际历史摘要列保留读取；新查询按真实成员集合过滤双路并记录范围，不要求数据迁移或重算已有向量。
- IP-04：WaitingRef/ResumeCause使用D-07规定的配对分支；既有状态枚举继续waiting。官方协议交官方库，自有状态Schema及实际阶段恢复保留。
- IP-05：V1/V2评分快照显式联合；新写V2，旧正文只读。C18按purpose解析成员，预警/处置/预测/偏差/校准在原阶段输入或事实字段保存自身策略，不新增通用策略影子表。
- IP-06：任务模型Schema的sourceOption只在任务内映射；执行工具仍用真实版本。文档类型规则和错误可修正分类由D-10/D-11确定，不新增独立重试状态机。
- IP-07：新UUID只用于尚未创建的上下文对象，旧ID/引用不变；游标按共享组成字段解析，切换时重置页面游标；无新增游标存储表。
- IP-08：唯一新迁移为000059，列、索引、来源联合、历史reader与scope语义完全按D-13/D-14；由迁移身份执行，API/Worker不自行迁移。测试fixture迁移列表随发现机制更新，旧迁移文件不修改。

## 6. 验收证据矩阵

综合检查范围补充：`eslint.config.js`与`.prettierignore`排除本地Agent技能目录，避免其独立工具脚本混入产品源码检查；`packages/adapters/test/recommendation/fixture.ts`同步策略引用可省略的已批准契约。部署清单`deployment/release-manifest.example.json`随唯一000059迁移更新，归IP-08；上述均无新依赖或产品行为。

仅扩展既有测试中能够观察业务变化的用例；已删除机制的断言随实现移除。以下命令已核对脚本与测试路径存在，本规划未执行这些业务测试。数据库/浏览器环境不可用时记录实际原因，不记为通过。

### IP-01 统一业务入口权限

- 夹具：既有C06真实账号/成员/指定可见资料及有效后台任务夹具。
- 关键断言：长任务跨旧TTL可继续；注销不杀后台；撤权在下一读或提交拒绝；不同账号仍只见原获准范围。
- 最小命令：

```bash
pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts scripts/deployment/entrypoints.test.mjs scripts/deployment/api-ports.test.mjs

```

- RI/RA：RI-S14、RI-S4～S6；RA-S1～S7。

### IP-02 读取记账及文件直接消费

- 全仓回归复现C03同键并发同时命中命令主键与command_id唯一索引时的23505。将`packages/adapters/src/postgres/transaction-unit.ts`纳入IP-02：插入收据覆盖既有唯一约束冲突，再按原命令唯一键锁定回读与校验payload；数据库唯一约束、事实/审计/事件原子性保持。既有基础库并发用例提高到16请求，并保留错键错载荷拒绝；报告导出既有用例作为调用方回归，不保留诊断改动。
- 夹具：既有真实文件/数据库存储、不同内容多块文件与同任务多来源。
- 关键断言：同任务同用途读取不同文件、新授权重复读均成功；访问记录独立，业务回执不增；普通多块读取内容稳定；维护核验仍可用。
- 最小命令：

```bash
pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts apps/api/test/http-shell.test.ts

```

- RI/RA：RI-S14、RI-S21～S23、RI-S52～S58；RA-S1、RA-S3～S7。

### IP-03 内容索引与查询可见范围分离

- 条目窄读由C17 `readVisibleEntries`承担，C06 `filterVisibleSources`一次读取当前可见来源；000059增加原批准条目登记表，C17发布及原包读取按精确发布登记，旧代际重用原pointId。同步检索composition、生产宿主与既有服务夹具。追加`packages/core/src/access/service.ts`、`packages/core/src/identification-knowledge/schema.ts`、`apps/worker/src/retrieval/composition.ts`及唯一000059迁移到IP-03范围；原文件中C17/C06接线同时归IP-03。

- 夹具：既有检索语料、固定相关性标签、两个可见范围不同的账号及三份无关资料。
- 关键断言：25来源的原知识代际在新增3份监测授权后继续检索；不同账号结果不扩大；双路成员、质量阈值和排名口径保留。
- 最小命令：

```bash
pnpm exec vitest run packages/core/test/retrieval/retrieval.test.ts packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts apps/worker/test/retrieval/projection-handler.test.ts

```

- RI/RA：RI-S3、RI-S4、RI-S53～S56。

### IP-04 阶段续办与正常等待

- 父运行直接引用子运行已登记的失败事实，不再次登记同一错误，避免全工程错误主键重放冲突把可重试失败变成事务终止；同步`apps/worker/src/risk-flow/graph.ts`及既有父图acceptance测试。
- 限定审计在既有`apps/worker/test/assessment/runtime.test.ts`补充A1已提交而A2检查点写入失败的场景，按登记阶段续办并确认不重复准备依据或冻结资料。
- 正常准备等待的读取投影贯通既有 `AssessmentRunViewV1Schema`、`AssessmentRunProjectionV1Schema`、C30/C25 reader与Web运行详情；使用`WaitingRefV1`同一Schema，不复制缺项状态。父运行按已登记等待引用恢复对应子运行，子运行重查阶段配置。预测A0输入保存到原run-state工件，A2及恢复复用，归IP-05。
- 评分依据首次解析取实际准备时刻及原业务validAt，A1成功后在原run-state保存精确集合引用，后续阶段及续办直接复用。运行详情复用ConfirmButton与既有workflow.resume-run分支，原等待引用和状态版本随命令提交；同状态重试复用命令ID。
- 启动入口复用C18既有成员读取（公开为readConfigurationMembers），将preparationMissingKinds附于原entry-context读模型，不在预览登记正式配置集合。启动页显示评分配置缺项和重新检查入口，该展示不代替后台实际准备。追加`apps/web/src/pages/StartAssessmentPage.tsx`到IP-04文件范围，并同步生产与浏览器宿主注入configuration。
- 夹具：既有真实StateGraph/数据库阶段提交与取消恢复夹具。
- 关键断言：I6已提交但检查点失败不重做合并；缺规则显示等待补齐可续；取消后不推进；列历史不读取所有正文。
- 最小命令：

```bash
pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/worker/test/identification/graph/runtime.test.ts apps/worker/test/identification/graph/nested-boundary.test.ts apps/worker/test/assessment/runtime.test.ts apps/worker/test/risk-flow/runtime.test.ts

```

- RI/RA：RI-S1～S6；RA-S1～S7。

### IP-05 单向配置与按阶段准备

- C18按精确发布读取配置正文，不要求该配置曾进入评分集合；C19的同名读取委托C18，删除扫描历史评分集合的重复实现。同步C18/C19既有测试与评分fixture接口。
- C27既有context reader注入C18 `resolveConfigurationSet`与运行清单四项处置策略，措施引用可省略；候选查询从原收据重放。C28既有context reader接C18 `readPublishedConfigurationMember`，按预测/反馈冻结的精确策略读取，评分字段仍从原依据读取。C41首次反馈在既有快照冻结偏差/校准策略，部署组合、浏览器业务宿主及既有夹具同步接线。
- 校准首次策略与A3准备结果复用原run-state的`calibrationPolicy`/`calibrationPreparedInput`，A4传递冻结Agent策略并复用精确输入，避免等待后重选和重复准备；修改既有workflow/schema、assessment/graph及runtime测试。处置generation/validation/agent三个策略reader均按catalog精确引用读取。
- 浏览器业务宿主的`apps/web/test/browser/deploymentPolicies.mjs`与`demo/test/browser/deploymentPolicies.mjs`同步预警策略由宿主选择、显式引用仍核对的契约，归IP-05；不再要求评分入口重复传后续策略。
- 夹具：既有完整V1评估及11类配置夹具、新V2仅评分成员。
- 关键断言：无处置/校准配置仍完成P/C和触发；原旧评估重放不变；各后续阶段使用自身冻结策略；0.40.3兼容0.40.0时可用。
- 最小命令：

```bash
pnpm exec vitest run scripts/deployment/entrypoints.test.mjs packages/adapters/test/deployment/config-operations.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts packages/adapters/test/model/network-api-model-gateway.test.ts scripts/deployment/assessment-composition.test.mjs

```

- RI/RA：RA-S1～S7；RI-S51～S59。

### IP-06 模型工具与适用质量策略

- 夹具：既有脚本化模型响应、C15多资料/表格及空白页夹具。
- 关键断言：模型只需短选项即可完整读取；格式错在同预算修正且不丢usage；CSV无需chapter，正常空白页及合格部分可用；关键字段不变。
- 最小命令：

```bash
pnpm exec vitest run apps/worker/test/agent-runtime/runner.test.ts apps/worker/test/engineering-data/cleaning/runtime.test.ts packages/core/test/engineering-data/cleaning.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts packages/core/test/identification/candidate-finalization.test.ts

```

- RI/RA：RI-S13、RI-S14、RI-S21～S23、RI-S55～S59；RA-S1。

### IP-07 详情、分页与明确错误

- 上下文结果的 `readResult` 增加已有 `agent_task_ref` / `retrieval_artifact_set_ref` 的精确关联选择；新结果首次登记生成 UUID，重复提交按关联读取原引用。同步 `context/ports.ts`、`context/schema.ts`、`context/service.ts`、PostgreSQL context adapter、既有核心/adapter测试与 Worker context fixture，归 IP-07；不新增表或迁移，旧行使用相同关联列。
- C22 `candidate-finalization/schema.ts`、`service.ts` 及既有测试同步删除编号反解，使用已登记上下文的工作项与检索集引用；Worker context/runtime 既有断言改为验证短 UUID 及正式结果。清洗 fixture 的管线输入接受 V1/V2 联合，归 IP-06，原 V1 fixture 保留历史回放场景。
- IP-05 的 C18 阶段集合同步 `assessment-config/schema.ts` 与 `validation.ts`：purpose 的成员集合由一个常量表声明，预测依赖指标体系，偏差按策略实际引用追加矩阵；历史未带 purpose 的集合按 full 解析。同步既有核心配置测试，后续 C19 及各阶段调用显式选 purpose。
- IP-06 的模型解释回调增加可选的已有 `AgentModelStepContextV1`，只传已完成工具记录给清洗宿主确定 offset。同步 `scoring-rules/runtime.ts`、`identification-knowledge/runtime.ts`、`identification/context/runtime.ts` 三个 Worker 透传包装与 `composition/response-model-step.mjs`，以及它们既有回归；不增加运行时或工具协议。
- 夹具：既有Agent目录/详情和Web业务服务器夹具，旧长编号与超过一页任务。
- 关键断言：旧744字符游标可正常分页或刷新重置，新ID简短；详情不在第一页仍可见；错误不持续加载；既有键盘与刷新规则保留。
- 最小命令：

```bash
pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts apps/web/test/ssr-shells.test.tsx
pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/agent-audit-operations.spec.ts
```

- RI/RA：RI-S1、RI-S4～S6；RA-S6～S7。

### IP-08 确定性组合发布与接续收口

- C19依据解析在当前准备缺少派生发布时，按该准备与原评分配置调用同一组装方法，再使用新发布形成依据；复用既有scoring-rules数据库测试覆盖新准备与重复解析。`packages/adapters/test/risk-assessment/production-assessment-basis.fixture.ts`同步真实项目适用性和派生发布注入，移除组装后的重复人工发布，归IP-08；对应测试的过程描述同步。

- 夹具：既有PostgreSQL知识治理、评分配置和规则夹具，迁移前人工发布与两个适用性准备。
- 关键断言：已批准内容自动派生，无伪审核；新增语义仍人工；旧人工发布读取不变；两份不同准备规则集并存，重复命令不重复发布。
- 最小命令：

```bash
pnpm exec vitest run packages/core/test/knowledge-governance/knowledge-governance.test.ts packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-read.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts scripts/deployment/api-ports.test.mjs apps/worker/test/risk-flow/runtime.test.ts

```

- RI/RA：RI-S3、RI-S4、RI-S53～S56；RA-S3、RA-S4、RA-S7。

### 综合收口

全部IP完成后运行一次 `NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`、`pnpm test:browser`、`pnpm test:deployment`，并记录实际结果。只有新变更或未解决失败才扩大或重复回归。性能复用既有检索/文件基准，记录同输入的读取、检索和续办表现，不为内部函数顺序写新测试。

实机接续由原change依次完成：原资料查看与清洗、已有知识检索、识别/人工复核、规则确定性组装、评分、预警、处置/采纳、执行反馈与适用校准。原成果逐项复用，后续正式结果另记证据；本change工程通过不能代替这些真实业务终态。

## 7. 文件清单与升级条件

以下为当前代码与调用方定位得到的精确允许集合。共享文件同时列多个IP；测试内既有fixture的字段和迁移贡献只在对应IP范围更新。所有新增生产文件仅为000059迁移；其余删除职责优先在现有文件内完成，不新建通用框架。

| 文件                                                                                                                                       | IP-ID               | 动作范围           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------ |
| `AGENTS.md`                                                                                                                                | IP-08               | 说明/配置          |
| `apps/api/src/app.ts`                                                                                                                      | IP-01               | 生产实现或共享契约 |
| `apps/api/src/http.ts`                                                                                                                     | IP-01               | 生产实现或共享契约 |
| `apps/api/test/http-shell.test.ts`                                                                                                         | IP-02               | 既有测试/夹具      |
| `apps/web/src/agent/AgentTaskProvider.tsx`                                                                                                 | IP-07               | 生产实现或共享契约 |
| `apps/web/src/api/agentAuditOperations.ts`                                                                                                 | IP-07               | 生产实现或共享契约 |
| `apps/web/src/api/operations.ts`                                                                                                           | IP-04、IP-05        | 生产实现或共享契约 |
| `apps/web/src/pages/AgentTaskDetailPage.tsx`                                                                                               | IP-07               | 生产实现或共享契约 |
| `apps/web/src/pages/AgentWorkbenchPage.tsx`                                                                                                | IP-07               | 生产实现或共享契约 |
| `apps/web/src/pages/AssessmentRunPage.tsx`                                                                                                 | IP-04、IP-08        | 生产实现或共享契约 |
| `apps/web/src/pages/RuleSetsPage.tsx`                                                                                                      | IP-08               | 生产实现或共享契约 |
| `apps/web/test/browser/agent-audit-operations.spec.ts`                                                                                     | IP-07               | 既有测试/夹具      |
| `apps/web/test/browser/business-server.mjs`                                                                                                | IP-02               | 既有测试/夹具      |
| `apps/web/test/ssr-shells.test.tsx`                                                                                                        | IP-07               | 既有测试/夹具      |
| `apps/worker/src/agent-runtime/runner.ts`                                                                                                  | IP-01、IP-02        | 生产实现或共享契约 |
| `apps/worker/src/assessment/composition.ts`                                                                                                | IP-01、IP-05        | 生产实现或共享契约 |
| `apps/worker/src/assessment/graph.ts`                                                                                                      | IP-01、IP-04、IP-05 | 生产实现或共享契约 |
| `apps/worker/src/assessment/runtime.ts`                                                                                                    | IP-01、IP-04        | 生产实现或共享契约 |
| `apps/worker/src/engineering-data/cleaning/runtime.ts`                                                                                     | IP-06               | 生产实现或共享契约 |
| `apps/worker/src/identification/candidate-finalization/runtime.ts`                                                                         | IP-06               | 生产实现或共享契约 |
| `apps/worker/src/identification/context/runtime.ts`                                                                                        | IP-06               | 生产实现或共享契约 |
| `apps/worker/src/identification/graph/composition.ts`                                                                                      | IP-01、IP-04        | 生产实现或共享契约 |
| `apps/worker/src/identification/graph/graph.ts`                                                                                            | IP-01、IP-04        | 生产实现或共享契约 |
| `apps/worker/src/identification/graph/runtime.ts`                                                                                          | IP-01、IP-04        | 生产实现或共享契约 |
| `apps/worker/src/retrieval/projection-handler.ts`                                                                                          | IP-03               | 生产实现或共享契约 |
| `apps/worker/src/risk-flow/graph.ts`                                                                                                       | IP-01、IP-04        | 生产实现或共享契约 |
| `apps/worker/src/risk-flow/runtime.ts`                                                                                                     | IP-01、IP-04        | 生产实现或共享契约 |
| `apps/worker/test/agent-runtime/runner.test.ts`                                                                                            | IP-02、IP-06        | 既有测试/夹具      |
| `apps/worker/test/assessment/runtime.test.ts`                                                                                              | IP-04               | 既有测试/夹具      |
| `apps/worker/test/engineering-data/cleaning/runtime.test.ts`                                                                               | IP-06               | 既有测试/夹具      |
| `apps/worker/test/identification/context/fixture.ts`                                                                                       | IP-02               | 既有测试/夹具      |
| `apps/worker/test/identification/graph/fixture.ts`                                                                                         | IP-02               | 既有测试/夹具      |
| `apps/worker/test/identification/graph/nested-boundary.test.ts`                                                                            | IP-04               | 既有测试/夹具      |
| `apps/worker/test/identification/graph/runtime.test.ts`                                                                                    | IP-04               | 既有测试/夹具      |
| `apps/worker/test/identification-knowledge/composition.test.ts`                                                                            | IP-02               | 既有测试/夹具      |
| `apps/worker/test/retrieval/projection-handler.test.ts`                                                                                    | IP-03               | 既有测试/夹具      |
| `apps/worker/test/risk-flow/runtime.test.ts`                                                                                               | IP-04、IP-08        | 既有测试/夹具      |
| `demo/test/browser/server.mjs`                                                                                                             | IP-02、IP-04        | 既有测试/夹具      |
| `deployment/ACCEPTANCE.md`                                                                                                                 | IP-08               | 说明/配置          |
| `deployment/OPERATIONS.md`                                                                                                                 | IP-08               | 说明/配置          |
| `deployment/config.example.json`                                                                                                           | IP-05               | 说明/配置          |
| `deployment/functional-run-config.example.json`                                                                                            | IP-05               | 说明/配置          |
| `packages/adapters/src/agent-runtime/postgres-agent-task-adapter.ts`                                                                       | IP-02、IP-07        | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/artifact-stream-service-handler.ts`                                                                       | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/artifact-stream-service.ts`                                                                               | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/filesystem-artifact-store.ts`                                                                             | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/index.ts`                                                                                                 | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/maintenance.ts`                                                                                           | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/postgres-artifact-registry.ts`                                                                            | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/artifacts/remote-artifact-store.ts`                                                                                 | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/assessment-config/postgres-assessment-configuration-adapter.ts`                                                     | IP-02、IP-05        | 生产实现或共享契约 |
| `packages/adapters/src/auth/deployment-authorization.ts`                                                                                   | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/auth/index.ts`                                                                                                      | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/auth/postgres-local-identity-access.ts`                                                                             | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/auth/postgres-types.ts`                                                                                             | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/calibration/postgres-calibration-adapter.ts`                                                                        | IP-01、IP-02、IP-05 | 生产实现或共享契约 |
| `packages/adapters/src/deployment/policies.ts`                                                                                             | IP-05               | 生产实现或共享契约 |
| `packages/adapters/src/deployment/readers.ts`                                                                                              | IP-02、IP-05        | 生产实现或共享契约 |
| `packages/adapters/src/deployment/schema.ts`                                                                                               | IP-05               | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts`                                              | IP-01、IP-02        | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`                                                          | IP-01、IP-02、IP-06 | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`                                    | IP-01、IP-02        | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/context-source/postgres-external-risk-input-facts-reader.ts`                                       | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/context-source/source-original-reader.ts`                                                          | IP-01、IP-02        | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts`                                              | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/engineering-data/monitoring/postgres-monitoring-store.ts`                                                           | IP-01、IP-02        | 生产实现或共享契约 |
| `packages/adapters/src/human-decision-feedback/postgres-human-decision-feedback-adapter.ts`                                                | IP-01、IP-05        | 生产实现或共享契约 |
| `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`                                              | IP-01、IP-02、IP-08 | 生产实现或共享契约 |
| `packages/adapters/src/identification/context/postgres-identification-context-adapter.ts`                                                  | IP-02、IP-03        | 生产实现或共享契约 |
| `packages/adapters/src/identification/context/postgres-knowledge-retrieval-read.ts`                                                        | IP-01、IP-02、IP-03 | 生产实现或共享契约 |
| `packages/adapters/src/identification/graph/postgres-identification-graph-adapter.ts`                                                      | IP-01、IP-02、IP-04 | 生产实现或共享契约 |
| `packages/adapters/src/identification/read/postgres-risk-identification-read.ts`                                                           | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`                                                      | IP-01、IP-08        | 生产实现或共享契约 |
| `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-read.ts`                                                         | IP-01、IP-02、IP-08 | 生产实现或共享契约 |
| `packages/adapters/src/model/config.ts`                                                                                                    | IP-05               | 生产实现或共享契约 |
| `packages/adapters/src/model/llamacpp-model-gateway.ts`                                                                                    | IP-06               | 生产实现或共享契约 |
| `packages/adapters/src/model/model-gateway-runtime.ts`                                                                                     | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/model/network-api-model-gateway.ts`                                                                                 | IP-05               | 生产实现或共享契约 |
| `packages/adapters/src/postgres/checkpointer.ts`                                                                                           | IP-04               | 生产实现或共享契约 |
| `packages/adapters/src/postgres/migrations/knowledge-modeling/reduce-defensive-design-overhead/000059_derived_knowledge_release_origin.ts` | IP-08               | 新增迁移           |
| `packages/adapters/src/quality/postgres-quality-evaluation.ts`                                                                             | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/recommendation/postgres-recommendation-adapter.ts`                                                                  | IP-01、IP-02、IP-05 | 生产实现或共享契约 |
| `packages/adapters/src/response-lifecycle/forecast-executors.ts`                                                                           | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/response-lifecycle/forecast-model-reader.ts`                                                                        | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/response-lifecycle/postgres-response-lifecycle-adapter.ts`                                                          | IP-01、IP-02、IP-05 | 生产实现或共享契约 |
| `packages/adapters/src/retrieval/postgres-retrieval-adapter.ts`                                                                            | IP-03               | 生产实现或共享契约 |
| `packages/adapters/src/retrieval/qdrant-rest-client.ts`                                                                                    | IP-03               | 生产实现或共享契约 |
| `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`                                                                      | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts`                                                          | IP-01、IP-02、IP-05 | 生产实现或共享契约 |
| `packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts`                                                                    | IP-01、IP-02、IP-08 | 生产实现或共享契约 |
| `packages/adapters/src/warning/postgres-warning-lifecycle-adapter.ts`                                                                      | IP-01、IP-05        | 生产实现或共享契约 |
| `packages/adapters/src/workflow/postgres-report-export.ts`                                                                                 | IP-02               | 生产实现或共享契约 |
| `packages/adapters/src/workflow/postgres-run-event-reader.ts`                                                                              | IP-01               | 生产实现或共享契约 |
| `packages/adapters/src/workflow/postgres-workflow-adapter.ts`                                                                              | IP-02、IP-04        | 生产实现或共享契约 |
| `packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`                                                                 | IP-07               | 既有测试/夹具      |
| `packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`                                                                | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/artifacts/remote-artifact-store.test.ts`                                                                           | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/assessment-config/fixture.ts`                                                                                      | IP-08               | 既有测试/夹具      |
| `packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts`                                               | IP-05               | 既有测试/夹具      |
| `packages/adapters/test/auth/fixture.ts`                                                                                                   | IP-08               | 既有测试/夹具      |
| `packages/adapters/test/auth/local-identity-project-authorization.test.ts`                                                                 | IP-01               | 既有测试/夹具      |
| `packages/adapters/test/calibration/fixture.ts`                                                                                            | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`                                                                  | IP-05               | 既有测试/夹具      |
| `packages/adapters/test/deployment/config-operations.test.ts`                                                                              | IP-05               | 既有测试/夹具      |
| `packages/adapters/test/deployment/policies-readers.test.ts`                                                                               | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/engineering-data/cleaning/fixture.ts`                                                                              | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`                                                    | IP-02、IP-06        | 既有测试/夹具      |
| `packages/adapters/test/engineering-data/monitoring/postgres-monitoring-store.test.ts`                                                     | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/engineering-data/document-conversion.test.ts`                                                                      | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/engineering-data/document-conversion/mineru/fixture.ts`                                                            | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`                                                        | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/identification-knowledge/fixture.ts`                                                                               | IP-08               | 既有测试/夹具      |
| `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`                                        | IP-02、IP-08        | 既有测试/夹具      |
| `packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`                                     | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts`                                                | IP-04               | 既有测试/夹具      |
| `packages/adapters/test/knowledge-governance/fixture.ts`                                                                                   | IP-08               | 既有测试/夹具      |
| `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`                                                | IP-08               | 既有测试/夹具      |
| `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-read.test.ts`                                                   | IP-02、IP-08        | 既有测试/夹具      |
| `packages/adapters/test/model/fixture.ts`                                                                                                  | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/model/llamacpp-model-gateway.smoke.test.ts`                                                                        | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/model/llamacpp-model-gateway.test.ts`                                                                              | IP-06               | 既有测试/夹具      |
| `packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`                                                                     | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/model/network-api-model-gateway.test.ts`                                                                           | IP-05、IP-06        | 既有测试/夹具      |
| `packages/adapters/test/postgres/postgres-foundation.test.ts`                                                                              | IP-04、IP-08        | 既有测试/夹具      |
| `packages/adapters/test/quality/postgres-quality-evaluation.test.ts`                                                                       | IP-02               | 既有测试/夹具      |
| `packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts`                                                            | IP-05               | 既有测试/夹具      |
| `packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts`                                                    | IP-05               | 既有测试/夹具      |
| `packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts`                                                                     | IP-03               | 既有测试/夹具      |
| `packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts`                                                                        | IP-03               | 既有测试/夹具      |
| `packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts`                                                                      | IP-03               | 既有测试/夹具      |
| `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`                                                           | IP-05               | 既有测试/夹具      |
| `packages/adapters/test/scoring-rules/fixture.ts`                                                                                          | IP-08               | 既有测试/夹具      |
| `packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`                                                              | IP-02、IP-08        | 既有测试/夹具      |
| `packages/contracts/src/ports/index.ts`                                                                                                    | IP-01、IP-05        | 生产实现或共享契约 |
| `packages/contracts/src/workflows/index.ts`                                                                                                | IP-04、IP-05        | 生产实现或共享契约 |
| `packages/core/src/access/authorization.ts`                                                                                                | IP-01               | 生产实现或共享契约 |
| `packages/core/src/access/index.ts`                                                                                                        | IP-01               | 生产实现或共享契约 |
| `packages/core/src/agent-runtime/runtime.ts`                                                                                               | IP-06               | 生产实现或共享契约 |
| `packages/core/src/agent-runtime/schema.ts`                                                                                                | IP-06               | 生产实现或共享契约 |
| `packages/core/src/agent-runtime/ui-read.ts`                                                                                               | IP-07               | 生产实现或共享契约 |
| `packages/core/src/artifacts/index.ts`                                                                                                     | IP-02               | 生产实现或共享契约 |
| `packages/core/src/artifacts/schema.ts`                                                                                                    | IP-02               | 生产实现或共享契约 |
| `packages/core/src/artifacts/store.ts`                                                                                                     | IP-02               | 生产实现或共享契约 |
| `packages/core/src/assessment-config/schema.ts`                                                                                            | IP-05               | 生产实现或共享契约 |
| `packages/core/src/assessment-config/service.ts`                                                                                           | IP-02、IP-05        | 生产实现或共享契约 |
| `packages/core/src/calibration/schema.ts`                                                                                                  | IP-05               | 生产实现或共享契约 |
| `packages/core/src/calibration/service.ts`                                                                                                 | IP-05               | 生产实现或共享契约 |
| `packages/core/src/engineering-data/cleaning/schema.ts`                                                                                    | IP-06               | 生产实现或共享契约 |
| `packages/core/src/engineering-data/cleaning/service.ts`                                                                                   | IP-06               | 生产实现或共享契约 |
| `packages/core/src/human-decision-feedback/service.ts`                                                                                     | IP-01、IP-05        | 生产实现或共享契约 |
| `packages/core/src/identification-knowledge/schema.ts`                                                                                     | IP-08               | 生产实现或共享契约 |
| `packages/core/src/identification-knowledge/service.ts`                                                                                    | IP-08               | 生产实现或共享契约 |
| `packages/core/src/identification/candidate-finalization/service.ts`                                                                       | IP-06               | 生产实现或共享契约 |
| `packages/core/src/identification/context/ports.ts`                                                                                        | IP-01、IP-03        | 生产实现或共享契约 |
| `packages/core/src/identification/context/schema.ts`                                                                                       | IP-05               | 生产实现或共享契约 |
| `packages/core/src/identification/context/service.ts`                                                                                      | IP-01、IP-02、IP-03 | 生产实现或共享契约 |
| `packages/core/src/identification/graph/ports.ts`                                                                                          | IP-01、IP-04        | 生产实现或共享契约 |
| `packages/core/src/identification/graph/schema.ts`                                                                                         | IP-04               | 生产实现或共享契约 |
| `packages/core/src/identification/graph/service.ts`                                                                                        | IP-04               | 生产实现或共享契约 |
| `packages/core/src/knowledge-governance/index.ts`                                                                                          | IP-08               | 生产实现或共享契约 |
| `packages/core/src/knowledge-governance/lifecycle.ts`                                                                                      | IP-08               | 生产实现或共享契约 |
| `packages/core/src/knowledge-governance/schema.ts`                                                                                         | IP-08               | 生产实现或共享契约 |
| `packages/core/src/model/gateway.ts`                                                                                                       | IP-06               | 生产实现或共享契约 |
| `packages/core/src/model/schema.ts`                                                                                                        | IP-06               | 生产实现或共享契约 |
| `packages/core/src/persistence/checkpoint.ts`                                                                                              | IP-04               | 生产实现或共享契约 |
| `packages/core/src/quality/evaluate.ts`                                                                                                    | IP-02               | 生产实现或共享契约 |
| `packages/core/src/recommendation/schema.ts`                                                                                               | IP-05               | 生产实现或共享契约 |
| `packages/core/src/recommendation/service.ts`                                                                                              | IP-05               | 生产实现或共享契约 |
| `packages/core/src/response-lifecycle/schema.ts`                                                                                           | IP-05               | 生产实现或共享契约 |
| `packages/core/src/response-lifecycle/service.ts`                                                                                          | IP-05               | 生产实现或共享契约 |
| `packages/core/src/retrieval/ports.ts`                                                                                                     | IP-03               | 生产实现或共享契约 |
| `packages/core/src/retrieval/schema.ts`                                                                                                    | IP-03               | 生产实现或共享契约 |
| `packages/core/src/retrieval/service.ts`                                                                                                   | IP-03               | 生产实现或共享契约 |
| `packages/core/src/risk-assessment/engine/engine.ts`                                                                                       | IP-05               | 生产实现或共享契约 |
| `packages/core/src/risk-assessment/engine/schema.ts`                                                                                       | IP-05               | 生产实现或共享契约 |
| `packages/core/src/risk-assessment/engine/service.ts`                                                                                      | IP-02、IP-05        | 生产实现或共享契约 |
| `packages/core/src/scoring-rules/schema.ts`                                                                                                | IP-08               | 生产实现或共享契约 |
| `packages/core/src/scoring-rules/service.ts`                                                                                               | IP-08               | 生产实现或共享契约 |
| `packages/core/src/scoring-rules/validation.ts`                                                                                            | IP-08               | 生产实现或共享契约 |
| `packages/core/src/warning/schema.ts`                                                                                                      | IP-05               | 生产实现或共享契约 |
| `packages/core/src/warning/service.ts`                                                                                                     | IP-05               | 生产实现或共享契约 |
| `packages/core/src/workflow/schema.ts`                                                                                                     | IP-04、IP-05        | 生产实现或共享契约 |
| `packages/core/src/workflow/service.ts`                                                                                                    | IP-01、IP-04        | 生产实现或共享契约 |
| `packages/core/test/assessment-config/assessment-config.test.ts`                                                                           | IP-02               | 既有测试/夹具      |
| `packages/core/test/access.test.ts`                                                                                                        | IP-01               | 既有测试/夹具      |
| `packages/core/test/engineering-data/cleaning.test.ts`                                                                                     | IP-06               | 既有测试/夹具      |
| `packages/core/test/identification/candidate-finalization.test.ts`                                                                         | IP-02、IP-06        | 既有测试/夹具      |
| `packages/core/test/identification/context.test.ts`                                                                                        | IP-02               | 既有测试/夹具      |
| `packages/core/test/knowledge-governance/knowledge-governance.test.ts`                                                                     | IP-08               | 既有测试/夹具      |
| `packages/core/test/retrieval/retrieval.test.ts`                                                                                           | IP-03               | 既有测试/夹具      |
| `packages/core/test/scoring-rules/scoring-rules.test.ts`                                                                                   | IP-08               | 既有测试/夹具      |
| `scripts/deployment/api-ports.test.mjs`                                                                                                    | IP-01、IP-08        | 既有测试/夹具      |
| `scripts/deployment/assessment-composition.test.mjs`                                                                                       | IP-05               | 既有测试/夹具      |
| `scripts/deployment/calibration-task.test.mjs`                                                                                             | IP-02               | 既有测试/夹具      |
| `scripts/deployment/composition.test.mjs`                                                                                                  | IP-02、IP-04        | 既有测试/夹具      |
| `scripts/deployment/composition/api-ports.mjs`                                                                                             | IP-01               | 生产实现或共享契约 |
| `scripts/deployment/composition/assessment.mjs`                                                                                            | IP-05               | 生产实现或共享契约 |
| `scripts/deployment/composition/calibration-task.mjs`                                                                                      | IP-02、IP-05        | 生产实现或共享契约 |
| `scripts/deployment/composition/identification.mjs`                                                                                        | IP-02、IP-04        | 生产实现或共享契约 |
| `scripts/deployment/composition/quality-gate.mjs`                                                                                          | IP-03               | 生产实现或共享契约 |
| `scripts/deployment/composition/response-model-step.mjs`                                                                                   | IP-05               | 生产实现或共享契约 |
| `scripts/deployment/entrypoints.test.mjs`                                                                                                  | IP-01、IP-05        | 既有测试/夹具      |
| `scripts/deployment/provision.mjs`                                                                                                         | IP-08               | 生产实现或共享契约 |
| `scripts/deployment/start.mjs`                                                                                                             | IP-01、IP-02        | 生产实现或共享契约 |

整合回归补全的同类调用方与既有夹具如下，均沿对应设计决定，不增加功能范围或依赖。

| 文件                                                                                      | IP-ID        | 实施内容                           |
| ----------------------------------------------------------------------------------------- | ------------ | ---------------------------------- |
| `apps/worker/src/identification-knowledge/runtime.ts`                                     | IP-06        | 将同次模型响应上下文传给内层解释器 |
| `apps/worker/src/scoring-rules/runtime.ts`                                                | IP-06        | 复用同次响应上下文及真实用量       |
| `apps/worker/test/identification-knowledge/runtime.test.ts`                               | IP-06        | 同步解释器上下文接线               |
| `apps/worker/test/scoring-rules/runtime.test.ts`                                          | IP-06        | 同步解释器上下文接线               |
| `packages/adapters/test/human-decision-feedback/fixture.ts`                               | IP-05        | 反馈阶段策略冻结接线               |
| `packages/adapters/test/identification/context/postgres-knowledge-retrieval-read.test.ts` | IP-01、IP-03 | 当前权限有效时允许历史摘要变化     |
| `packages/adapters/test/response-lifecycle/fixture.ts`                                    | IP-05        | 精确读取已发布阶段策略             |
| `packages/adapters/test/retrieval/qdrant-retrieval-adapter.test.ts`                       | IP-03        | 双路召回使用相同可见成员           |
| `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`               | IP-01        | 当前权限跨旧TTL继续读取            |
| `packages/adapters/test/risk-assessment/fixture.ts`                                       | IP-05        | 仅评分配置及新快照                 |
| `packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts`         | IP-01、IP-05 | 按目标来源当前权限读取             |
| `packages/adapters/test/risk-assessment/production-assessment-basis.test.ts`              | IP-05、IP-08 | 正式派生规则集作为评分依据         |
| `packages/adapters/test/warning/fixture.ts`                                               | IP-05        | 预警阶段策略接线                   |
| `packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`               | IP-05        | 预警策略由本阶段提供               |
| `packages/adapters/test/workflow/postgres-workflow-adapter.test.ts`                       | IP-01、IP-04 | 当前授权及正式启动审计绑定         |
| `packages/core/src/assessment-config/validation.ts`                                       | IP-05        | 按purpose校验成员及实际依赖        |
| `packages/core/src/human-decision-feedback/schema.ts`                                     | IP-05        | 类型化阶段策略缺项                 |
| `packages/core/src/identification/candidate-finalization/ports.ts`                        | IP-06        | 原候选循环接结构错误和真实用量     |
| `packages/core/test/warning/fixture.ts`                                                   | IP-05        | 同步预警阶段输入                   |

规划工件、baseline.json、handoff及原验收change整理后的proposal/design/implementation-plan/tasks/handoff和冲突delta属于IP-08文档所有权。原始研究资料、旧evidence、生产秘密与现场数据库、Git历史、执行图/Orca状态、锁文件、旧migration和无关UI样式受保护。

出现公开接口、迁移或文件范围与本design不一致时先修正规划；代码层的普通遗漏和上述列表内测试失败由本轮继续修复。现有测试中仍锁定被移出机制时按新行为调整，不据旧断言重新引入防护。全局迁移序号被其它工作占用须更新D-14和对应文件名，不能覆盖。

## 8. 验收 Agent 授权与限定审计

IP-04接口同步补充：检查点采用一次性的`validateState`回调核对运行归属与图版本，替代逐引用证明；共享导出与初始化同步修改`packages/adapters/src/postgres/index.ts`、`packages/adapters/src/deployment/initialization.ts`。已有调用方同步范围包括`apps/worker/test/risk-flow/composition.test.ts`、`apps/worker/test/risk-flow/acceptance.test.ts`、`apps/worker/test/assessment/composition.test.ts`、`apps/worker/test/identification/graph/control-channels.test.ts`、`apps/web/test/browser/business-server.mjs`、`apps/worker/test/identification/graph/fixture.ts`；这些文件只适配接口及已删除的引用证明职责。

Finalizer按本design与上述文件集合完成独立核验、范围内修复和最小回归。权限入口、普通访问事务、派生发布迁移及阶段恢复触发一次限定审计；同一轮不重复派发全量审计。所有Requirement/Scenario/IP证据闭合后才生成verification，结论对应实际最终检查点；当前规划不预建该工件。
