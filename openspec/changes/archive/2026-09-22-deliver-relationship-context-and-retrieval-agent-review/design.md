## Context

固定输入 HEAD：`6ffe9d5879fd6ec9ba252a79aa843c430158abf4`。C02 已定义 `KnowledgeModelingPortV1.retrieve` 的 `relationship-context`/`hybrid-evidence` 两分支、`retrieval-review` 任务结果族、`RetrievalArtifactSetRefV1` 与 `ModelContextArtifactSetRefV1`；C17 的 `retrievalDelegate` 已能原样转发，但 C20 的检索服务只接受 hybrid 分支。C17 `IdentificationKnowledgeReleaseReaderV1.readExact` 读取精确知识发布，C20 以 PostgreSQL 登记混合查询和 C04 工件；C08 负责 Agent 预算/恢复/审计，均不能作为 C21 私有事实库替代品。C21 上游的 C24 冻结工作项与识别策略尚未实现，故 C21 以必需窄读取端口接入，不能伪造生产输入。

## Goals / Non-Goals

**Goals:** 本模块独立完成关系结果、正式检索增量及五项上下文；冻结来源与权限，失败封闭，可审计重放；以已有公共分支和 C08/C20 能力接入。

**Non-Goals:** C24 的 `IdentificationPolicySetProviderV1`、I0～I9 图与输入冻结生产者；C22 的 RI-S57 LLM 推理、风险候选和合并；新的公共 contracts/权限能力/C17 注入点、新依赖、前端与通用搜索平台。

## Decisions

### D-01. C21 一个深模块，两个现有公共分支由同一委派路由

新增 `packages/core/src/identification/context/{schema,service,ports,index}.ts`；`KnowledgeModelingPortV1.retrieve` 的 `relationship-context` 由 C21 服务实现，`hybrid-evidence` 原样交给已注入的 C20 服务。`apps/worker/src/identification/context/composition.ts` 只组合这两个已有实现并交给 C17 **同一个** `retrievalDelegate` 注入位；不修改 C17 façade、不在 C20 服务内为关系结果塞入虚拟代际。C21 的 `retrieval-review` 定义注册到组合根暴露的**同一个** C08 `AgentTaskDefinitionRegistry`，模型步骤回调按任务类型接入一个共享 runner；禁止另起轮询同一张任务表、但只认识部分任务类型的第二 runner。未配置任一必需端口时组合失败，不以 unsupported 或合成数据冒充成功。C24 后续将窄读、共享 runner 和委派接到识别图，C21 不擅自接线。

### D-02. 精确冻结输入与关系算法

C21 内部 `IdentificationContextInputReaderV1.readExact({projectId, actorId, queryId, inputSnapshotRef, workItemRef, authorization})` 必须返回同工程精确 `IdentificationInputSnapshotV1`、工作项所属的 `nodeId`、工作项授权范围及 C24 冻结策略引用；没有 C24 输入生产者时由测试严格注入真实形状夹具，不创建占位生产实现。查询入口按 C02 校验并复验当前 `knowledge-modeling.relationship-context → knowledge-modeling.retrieve` 能力；C17 的 `readExact` 另要求 `knowledge-modeling.identification-basis → knowledge-modeling.read`，故由已有 C06 授权签发者按同一 actor/工程/精确调用身份签发该读分支上下文，并保持或收窄原资料范围，缺少该资格即拒绝，不扩张公共能力。读取前和正式结果返回前复验权限。C17 exact reader 以已有 `KnowledgeReleaseRefV1` 壳包裹模型、机理及检索证据库三个精确版本引用后读取包，不能直接传各自不同 `kind` 的发布引用；验证三个发布的组合成员、工程、适用性及证据可达性。节点关系只取与当前 `nodeId` 相接的一跳有向时间/资源/受力边，不做隐式多跳；前后工序按时间边方向区分，受力依赖按边原方向保留，风险机理仅取同发布中显式关联当前节点且满足适用性的条目。对每个所需字段和端点保留原 ID、发布和资料段证据；排序按输入包原序和稳定 ID，不以自然语言相似度猜关系。缺失一项所需受力边时五项上下文不能收口；关系查询可以保存完整有效但无受力边的查询结果，供诊断缺口，不伪造受力关系。

### D-03. 一个 C21 结果登记表，正文只入 C04

新增 `business.identification_context_results` 一张追加表，`result_kind` 严格限定 `relationship | reviewed-retrieval | model-context`；键 `(project_id,result_kind,result_id,result_version_id)`，另对关系查询 `(project_id,query_id)` 条件唯一。必填 `request_digest`、`artifact_ref`、`input_snapshot_ref`、`work_item_ref`、`authorization_scope_digest`、`actor_ref`、`authorization_context_ref`、`audit_entry_id`、`created_at`；审阅行还要 `agent_task_ref`、`baseline_query_result_ref`，上下文行还要 `relationship_query_result_ref`、`retrieval_artifact_set_ref`。严格判别 Schema 在核心层限定每种结果行的完整引用形状；数据库 CHECK 限制种类/非空配对，唯一键阻止同键异载荷覆盖，受约束 JSONB 只存结构化引用、不存正文或模型响应。`knowledge-query-result` 使用 `relationship-query-result:<project>:<queryId>`；`retrieval-artifact-set` 使用 `retrieval-review:<taskId>`；`model-context-artifact-set` 使用 `identification-context:<project>:<workItemId>:<taskId>`，各自 `versionId=sha256:<规范请求摘要>`。审阅结果行只在 C08 任务完成后视为可消费，未完成任务写入后失败可用相同键对账续作；不删除已成立审计。选单表而非三份 repository，因为结构均为“精确输出引用→受保护工件”且只需一种幂等守卫。

迁移精确路径 `packages/adapters/src/postgres/migrations/risk-identification/deliver-relationship-context-and-retrieval-agent-review/000041_identification_context_results.ts`。使用现有 provider 的递归发现；`riskflow_app` 与 `riskflow_outbox_worker` 仅 SELECT/INSERT，不授 UPDATE/DELETE，PUBLIC/其它角色撤权，审计 FK `DEFERRABLE INITIALLY DEFERRED` 以适配 C03 的审计写入顺序；down 只用于测试/显式运维，不自动回滚历史。中央迁移清单若有并行编辑由主调度处理。若 `000041` 在合并前被占用，停止升级，不自行改号。

### D-04. 幂等、事务和授权顺序

关系查询以 `(projectId,queryId)` 和规范化 `{input/workItem refs,精确发布,授权范围摘要}` 守卫；同载荷已成立结果经当前授权复验后返回原 ref，同键异载荷不可重试冲突。审阅和上下文以冻结任务/工作项身份加各自规范化内容摘要守卫。流程为 C06 当前能力校验 → 冻结输入与 C17/C20 精确读取 → 严格校验 → C04 受保护结果耐久 → C03 `TransactionUnitV1.execute` 写 C21 登记、命令收据和一条事实审计、零个新领域事件 → 返回正式引用；C04 失败不入库，PG/审计失败不返回正式引用，事务前孤儿工件仅按 C04 既有规则回收。重放重新验证当前授权，旧授权摘要绝不放行已撤销资料；所有跨工程、发布不一致和无权结果对调用方同形拒绝、错误/日志不含正文或成员存在性。C08 任务自身的候选、动作、预算台账不复制到 C21 表。

### D-05. C20 基线与有界补搜的单一事实源

`HybridRetrievalInputReaderV1.readExact` 仍是 C20 的查询输入唯一窄读；C21 按冻结工作项和检索策略先调用已接入的 C20 `retrieve(hybrid-evidence)`，再按 `(projectId,queryId)` 由 C20 现有只读结果登记及 C04 读取实际 `HybridRetrievalResultPayloadV1`，核对返回的结果引用、发布、代际、策略、成员、授权及命中。C21 的 C08 注册工具仅有 `read-frozen-result` 与 `bounded-hybrid-resupplement` 两项：后者的附加查询文本从获准工作项/Agent 类型化意图派生，经 C21 内部精确读将稳定 `queryId=taskId:actionId` 映射为 C20 冻结查询文本，其余快照、工作项、策略及授权一律不变；调用 C20 同一正式查询分支，不调用 Qdrant 私有 client 或自行融合。工具策略可收窄白名单；C08 原预算强制 model、工具、轮数、候选、字节与墙钟上限，C21 校验工具输出的集合规模和同版本资格。补搜动作意图/输出由 C08 耐久记录，未证明 C20 查询效果可从稳定 queryId 查回时不自动重发。基线无完整双路查询或审阅未完成均不产生正式集合。

### D-06. 候选类型化增量与确定性收口

`RetrievalReviewIncrementV1` 是固定候选成员引用的 `select | exclude` 封闭操作联合，`select` 只能引用基线/已完成获准补搜的正式结果中真实成员及其 `sourceSegmentId` 证据，不能传自由正文、排序数值、风险分值或修改知识。任务定义用 C08 `AgentTaskDefinitionV1` 注册严格动作/增量/候选 Schema、两项工具、确定性 validator/finalizer；逐项检查候选属于冻结版本、C17 已发布成员和当前授权，接受/拒绝与原因写 C08 校验工件。格式/引用可修正项只能在原任务剩余预算内重新候选；权限、来源资格、发布兼容和规则冲突终止拒绝。至少一个合法选择且全部操作接受后 C04 先保存检索工件集，D-03 登记，再用 C08 已允许的 `buildCompletedAgentTaskResult(..., 'retrieval-artifact-set')` 返回 `incrementRef` 和可选 `validationRef`；C08 真正 completed 方可消费。Agent 不直接写 C21 表。

### D-07. 五项上下文只组装已成立事实

严格 `ModelContextPayloadV1` 固定五个必需非空组：当前工序节点描述（输入、输出及邻接时间节点）、状态参数描述（共享领域词汇）、原方向受力依赖及其证据、同版机理条目、审阅选中证据及来源；还固定精确输入/工作项/三种知识发布、关系查询、C20 查询、C08 任务、检索工件集、策略、授权和资料段定位。由 C21 `assembleContext` 从 D-03 结果和 C08 completed 状态重新读取，复验当前资格与引用一致性后写 C04/登记，返回现有 `ModelContextArtifactSetRefV1`；失败写结构化诊断并阻断该工作项，C24 决定 I3/I4 路由，C22 单独执行 RI-S57。RRF 分数只留检索证据的排序语义，不写入置信度字段。

### D-08. 验证与所有权

只改 C21 自有 core/adapters/worker 模块、`apps/worker/src/index.ts` 必要导出、上述迁移和测试；Worker 从 `@riskflow/core/identification/context`、`@riskflow/adapters/identification/context` 正式子路径导入。主调度已在本工作区添加两个 package manifest 的机械 export，C21 不编辑、回滚或声称拥有它们；运行跨包测试/typecheck 前执行 `pnpm exec tsc -b packages/core packages/adapters` 构建对应 `dist/`。不修改公共事件、C17/C20/C08 生产实现、前端/HTTP、锁文件。核心测试覆盖一跳关系与五项缺失、增量越界和同版本选择；真实 PG 测试覆盖迁移、重复/冲突、审计回滚及撤权；Worker 组合测试覆盖 C17 唯一委派接缝、C20 两路结果读取、C08 硬预算/恢复和失败零正式产物。合成夹具标记“合成样本、待甲方复核”；不测试提示词全文或内部调用顺序。C24 的输入生产者和策略提供者未就绪时，独立 C21 测试验证必需窄读接口，但不得宣称端到端识别图已就绪。

## Risks / Trade-offs

- 一跳关系不推断复杂多跳机理：若真实发布数据缺受力边，按要求阻断五项上下文并保留明确缺口，不调用模型补全。
- 一个工作项可能产生多个 C04 工件与一条结果绑定；C08 已持久化动作和预算，C21 表只登记正式结果，不承担第二队列或第二预算事实。
- 补搜文本的内部冻结解析依赖 C24 后续提供的工作项生产者；C21 必须以缺失必需端口封闭失败，不提供测试夹具充当生产 fallback。

## Migration Plan

先运行 C21 单表迁移 up/down/up 和同事务审计测试，再组合 C17 精确读取与 C20/C08 服务；上线前核对 `000041` 尚未占用、已有 `000040` 已应用，生产历史行只追加，旧 C20 hybrid 查询不变。回退应用时停用 C21 委派组合，保留已成立审阅/上下文工件与审计，不自动删除迁移表或改变 C20 active generation。

## Open Questions

无影响本 change 契约或施工范围的待决问题；C24 生产者及识别图接线是明确的后续依赖，不在本 change 补建。
