## Context

动机见 [proposal.md](./proposal.md#why)，行为边界见 [versioned-dual-index-hybrid-retrieval spec](./specs/identification/versioned-dual-index-hybrid-retrieval/spec.md)。当前基线 `8fe4c1f07dd469ed15b7b6da6c4c98292dd476f5` 已归档 C03 的 PostgreSQL 事务、Outbox、幂等消费者和迁移发现机制，以及 C05 的 `ModelGatewayPortV1.embed` 与内容寻址工件；C17 的已批准五工件固定了 `IdentificationKnowledgeReleaseReaderV1.readExact` 和检索证据库发布包，但 C17 尚在实现中。

C02 现有 `DomainEventV1` 尚无识别知识发布事件，C17 当前批准设计也未发 Outbox 事件。这与 C20 的唯一 Outbox 投影入口冲突。主调度已选择先归档 `evolve-identification-basis-published-event`，再受限修订 C17，使发布事务写入 `knowledge.identification-basis-published.v1`；二者是 C20 实现前置，C20 只消费最终公共事件，不复制临时形状。

生产运行时是 Node.js 24。仓库已有原生 `fetch`、Zod 边界校验和 `@testcontainers/postgresql@12.1.0` 真实容器范式；锁文件中已有传递依赖 `testcontainers@12.1.0`，但未声明直接依赖，也没有 Qdrant 客户端。C20 的迁移号段为 `000040`～`000043`，当前方案只需 `000040`。

## Goals / Non-Goals

**Goals:**

- 用最少的新模块把已发布的 C17 三类知识成员投影为一个可对账的 Qdrant 双索引代际，并通过现有公共检索端口查询。
- 让 PostgreSQL 保持代际、激活、结果和审计事实，Qdrant 仅持有可删除的检索投影。
- 以稳定身份、严格 Schema、幂等步骤和真实 Qdrant 验收闭合失败、权限、重建、质量和 p95 语义。

**Non-Goals:**

- 不设计 C21 的关系上下文、Agent 审阅/补搜、C22 风险候选或任何 P/C、矩阵、阈值逻辑。
- 不新增 HTTP/Web 接口，不修改 C02/C17/C18/C19 生产文件；公共事件演进与 C17 发件由前置 change 完成。
- 不实现通用搜索框架、第二套任务队列、自动垃圾回收器、Qdrant 内唯一正文存储或单路回退。

## Decisions

### D1. 公共事件和 C17 精确读取是唯一事实入口

C20 Worker 只接受前置 change 归档后的 `knowledge.identification-basis-published.v1`，并直接用 contracts 导出的严格 Schema 解析，不在 C20 定义兼容 DTO。事件只携带精确项目、识别知识发布组合、审计和因果引用；正文与成员集合由 `IdentificationKnowledgeReleaseReaderV1.readExact({ projectId, releaseRef, actorId, requestedAt, authorization })` 读取。事件引用、C17 `releaseBinding` 与严格 `RetrievalEvidenceBasePackageV1` 的风险机理库、标准库、案例库引用必须相等。

实现前置按顺序为：归档公共事件 change → C17 发布事务通过 C03 Outbox 发件并有验收证据 → C20 合并/变基到两者检查点。任一前置未满足即停止实施。选择该路径是为了维持“发布事务与事件同提交”和单一事实源；放弃 C20 轮询 C17 私表、私有事件或全库扫描，因为这些方案会制造丢事件窗口和第二契约。

### D2. `packages/core/src/retrieval` 是 C20 唯一领域模块

模块只导出三组内容：

1. `schema.ts`：严格 Zod Schema 与推导类型，包括 `HybridRetrievalPolicyV1`、`RetrievalGenerationV1`、`RetrievalGenerationTransitionV1`、`RetrievalIndexManifestV1`、`HybridRetrievalResultV1`、`HybridRetrievalFailureV1` 和固定验收报告。
2. `service.ts`：纯确定性函数，负责生成稳定代际/成员身份、校验策略与代际状态、核对双索引清单、验证发布/权限摘要、计算验收门禁和装配结果；不访问网络或数据库。
3. `ports.ts`：仅保留跨层必需端口——`RetrievalGenerationStoreV1`（PostgreSQL 状态与结果事实）、`RetrievalProjectionPortV1`（Qdrant create/upsert/query/inspect/delete）和 `HybridRetrievalInputReaderV1`（按现有查询三引用解析冻结输入）。C17 reader、C05 `ModelGatewayPortV1`、C04 `ArtifactStoreV1`、C03 `TransactionUnitV1`/`IdempotentConsumerV1` 直接复用，不再包一层。

`HybridRetrievalService` 实现现有 `KnowledgeModelingPortV1.retrieve` 的 `hybrid-evidence` 分支；C17 façade 按其已批准注入点组合该服务，C20 不修改 façade。端口存在是四层边界和真实 adapter 测试替换点所需，不建立 factory、repository 基类或通用搜索抽象。

### D3. 策略和身份全部版本化且可重算

`HybridRetrievalPolicyV1` 至少固定：`policyRef`、`schemaVersion`、适用的检索证据库类型、`modelDeploymentRef`、稠密维度/距离、稠密与 BM25 prefetch 上限、Top-K、RRF `k` 与双路权重、Qdrant BM25 model/tokenizer/language/stemmer/stopwords、批量成员数、单成员 UTF-8 字节上限、总成员上限、Embedding/Qdrant 超时及验收策略引用。数值必须有限、非负且满足 `topK <= 各路 prefetch <= 成员上限`，双路权重均大于零。

代际身份由规范化的 `{projectId, sourceEventId, evidenceBaseReleaseRef, 三类 memberReleaseRef, policyRef, modelDeploymentRef, projectionCompatibilityRef}` 经已有 SHA-256 规范产生；成员身份由 `{generationRef, sourceKind, sourceReleaseRef, sourceEntryRef, contentDigest}` 产生。`projectionCompatibilityRef` 固定 Qdrant 主版本能力、向量名和 BM25配置，防止相同业务发布在不兼容服务语义下误判为同代际。身份算法、规范化顺序和摘要算法固定为 Schema 版本的一部分。

策略来自 `HybridRetrievalInputReaderV1` 的精确发布配置，不在 adapter 或调用点写默认值。相比允许调用方直接传参数，这能重放历史查询并防止绕过质量门禁。

### D4. 每个代际使用一个含 named dense/sparse vectors 的 Qdrant collection

每个不可变代际对应一个确定性 collection 名称。collection 定义一个 named dense vector `dense`，其维度和距离来自 C05 部署/策略；再定义 named sparse vector `bm25`，启用 IDF。成员作为单个稳定 point，同时写入稠密值和由 Qdrant `qdrant/bm25` document inference 生成的稀疏值。中文工程文本使用 Qdrant 1.19.0 的 `multilingual` tokenizer、`stemmer: none` 和空 stopwords；确切配置由策略冻结，query 与 document 必须一致。

point payload 只含 `projectId`、`generationRef`、来源类型/发布/条目引用、`contentDigest`、`authorizationScopeDigest` 和 Schema 版本，不存正文、证据片段或授权名单。正文只在构建请求中短暂发送给 Qdrant document inference；正式返回内容从 C17/PostgreSQL 回查。若安全评审不允许正文发送到部署内 Qdrant，则触发依赖退出条件，不能改成本地伪 BM25。

选择“一代一 collection”是因为旁路构建、原子切换和整代删除均可用 Qdrant 原生 collection 操作完成，代码少于在共享 collection 中维护复杂分区与可见性状态。代价是 collection 数增加；旧代际删除由显式运维命令按引用执行，本 change 不做自动 GC。

### D5. 代际状态采用追加事实，Qdrant 副作用可幂等续作

`RetrievalGenerationV1` 创建后不可改写，状态变化写 `RetrievalGenerationTransitionV1`：`building → ready | failed`，`ready → active | failed`，`active → superseded`。查询以 PostgreSQL 最新有效 transition/activation 为准；Qdrant collection 自身的存在或 alias 不是活动事实。

Outbox handler 使用 C03 `IdempotentConsumerV1.consume`，`consumerName` 固定版本。稳定 collection/point 身份使 create、批量 upsert、inspect 可安全重试：

1. 严格解析事件并创建或核对 `building` 事实；
2. 用 C17 精确读取并规范化三类成员，超限即失败；
3. 通过 C05 `embed` 分批生成稠密向量，核对部署、维度和输入输出数量；
4. 创建旁路 collection，按稳定 point upsert 双路表示；
5. 从 Qdrant 分页读取最小 payload/向量元数据，与 PostgreSQL 预期清单逐项核对；
6. 执行固定质量门禁；
7. 在 serializable PostgreSQL 事务中追加 ready、活动切换、审计与 consumer completed receipt。

外部网络步骤可能发生在幂等消费事务存续期间，这是当前 C03 API 在不增加第二队列前提下的最小闭合方式；策略的成员、批量和墙钟上限约束事务长度。Qdrant 已写而 PostgreSQL 回滚时，重复投递按稳定身份 inspect 后续作；collection 永远不可因局部写入而被查询。若实测长事务超过数据库门槛，需要另开规格增加已有 Outbox 的分阶段命令，不能在 C20 私建队列。

切换在 PostgreSQL 对工程与证据库系列加事务级 advisory lock，读取当前 activation 后以 compare-and-swap 语义追加新 activation；并发失配返回 `ACTIVATION_CONFLICT`。旧活动代际只服务其精确发布绑定；新发布查询不能借用旧代际。

### D6. 查询顺序为当前授权 → 精确代际 → 双路检索 → 事实回查 → 受保护结果

`HybridRetrievalInputReaderV1.readExact` 根据公共查询的 `inputSnapshotRef`、`workItemRef`、`retrievalPolicyRef` 返回冻结查询文本/表达、所需 `evidenceBaseReleaseRef`、策略和当前 C06 授权上下文；它是 C21/C24 组合时必须提供的窄读取端口，不提供内存或生产 fallback。服务依次：

1. 用公共查询中的 `authorization` 校验 `knowledge-modeling.hybrid-evidence` 以及工程、空间、资料范围；
2. 精确选择匹配发布、策略和授权摘要的 active+ready 代际；
3. 调 C05 `embed` 得到 query dense vector，并在一次 Qdrant Query API 请求内发出两个独立 prefetch；
4. 要求响应标明同一 collection/代际且双路均成功；
5. 按稳定成员引用调用 C17 exact reader，核对内容摘要与当前授权，随后生成允许的正文/片段；
6. 把完整解释结果写 C04，随后用 C03 `TransactionUnitV1` 登记 `knowledgeQueryResultRef`、工件引用和审计，成功后才返回公共结果引用。

Qdrant payload filter 先约束 project/generation/authorization scope 以减少无权候选，但不能代替步骤 5。任何候选权限摘要不一致、跨工程、条目不存在或内容漂移都以 `AUTHORIZATION_RECONCILIATION_FAILED`/`SOURCE_FACT_DRIFT` 拒绝整个正式结果，不泄露被拒成员存在性。C04 open 继续执行自己的当前授权检查。

查询幂等键为 `{projectId, queryId}`；内部 `AtomicCommandV1` 的 payload 摘要还包含三个公共引用、活动 generation、策略和授权摘要。同键同载荷返回原 `knowledgeQueryResultRef`，同键异载荷返回 `IDEMPOTENCY_CONFLICT`。这样无需新公共 Schema。

### D7. RRF 由 Qdrant Query API 执行，核心层复验解释

Qdrant adapter 把冻结策略映射为两个 prefetch（`using: dense` 与 `using: bm25`）及带 `k`/双路权重的 RRF fusion；REST 请求和响应均使用本模块严格 Zod Schema，未知字段可忽略，但关键字段、point 身份、分值和路线信息不可缺失。核心层不重新实现另一套排序，只根据返回的每路名次与策略复算贡献并核对最终顺序；差异返回 `FUSION_RECONCILIATION_FAILED`。

选择服务端 RRF 是因为固定 Qdrant 1.19.0 已原生支持带参数的 RRF，一次请求能锁定同一 collection 快照并减少自写融合代码。未选用原始向量/BM25 分值加权，因为两路分值尺度不可直接比较；也不允许一个 prefetch 失败后使用另一路。

### D8. PostgreSQL 迁移只占用 `000040`

自动发现迁移文件为 `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.ts`，创建四类表：

- `business.retrieval_generations`：稳定 generation 主键、工程、源事件、四个发布引用、策略/模型/兼容摘要、预期成员数和创建审计；对身份输入设唯一约束。
- `business.retrieval_generation_transitions`：追加状态、清单摘要、差异/失败码、发生时间与审计引用；`generation_ref + ordinal` 唯一。
- `business.retrieval_activations`：工程/证据库系列、generation、previous generation、activation ordinal 和审计；追加记录决定当前活动代际。
- `business.retrieval_query_results`：`project_id + query_id` 唯一，保存请求摘要、generation/策略、C04 工件和公共结果引用，不保存命中正文。

所有表带 `project_id`，时间由数据库写入；JSON 仅保存通过核心严格 Schema 的版本化 manifest/差异，不以无结构 JSON 替代查询键。迁移沿用现有 `business` schema、角色授权和 down 对称删除；不改中央迁移列表，因为 provider 已递归发现。`000041`～`000043` 留空而不建占位迁移。

`PostgresRetrievalAdapter` 以现有 `PostgresDatabase & RetrievalDatabase` 局部交集扩展 Kysely 类型，组合 C03 transaction/idempotent consumer，不修改 C03 公共数据库类型。该 adapter 同时实现 generation store 与结果登记，避免把同一事务拆成多个 repository。

### D9. 错误与审计使用单一结构化语义

`HybridRetrievalFailureV1` 固定阶段 `event | source-read | embedding | projection | reconciliation | quality | activation | query | authorization | result-persistence`、稳定错误码、retryable、project/event/query/generation 引用和不含正文的 detail 摘要。至少覆盖 `UNSUPPORTED_EVENT_VERSION`、`SOURCE_FACT_DRIFT`、`POLICY_NOT_FOUND`、`POLICY_INCOMPATIBLE`、`RESOURCE_LIMIT_EXCEEDED`、`EMBEDDING_FAILED`、`EMBEDDING_DIMENSION_MISMATCH`、`QDRANT_UNAVAILABLE`、`QDRANT_INVALID_RESPONSE`、`DUAL_INDEX_MISMATCH`、`QUALITY_GATE_FAILED`、`ACTIVATION_CONFLICT`、`GENERATION_NOT_READY`、`AUTHORIZATION_DENIED`、`AUTHORIZATION_RECONCILIATION_FAILED`、`FUSION_RECONCILIATION_FAILED`、`IDEMPOTENCY_CONFLICT` 和 `RESULT_PERSISTENCE_FAILED`。

构建开始、失败、ready、激活、替换、删除/重建和查询结果登记均通过 C03 原子审计追加；外部调用观察量另记录 operation、duration、status、service/model/policy/generation 引用、成员数和错误码。日志不得包含知识正文、query 原文、授权名单或模型内部内容。Qdrant、Embedding 和数据库失败均不伪装成空结果。

### D10. 仅新增固定 Qdrant 服务和真实容器测试依赖

运行服务固定 `qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`，许可证 Apache-2.0。它提供 named dense/sparse vectors、server-side `qdrant/bm25`、多语言 tokenizer、IDF 和带可配置 `k`/权重的 RRF；官方来源为 Qdrant GitHub v1.19.0 release 与 Docker Hub。离线通过批准 OCI tar `docker load` 或内网 registry 拉取，并校验该多架构 digest；退出条件是固定服务不提供这些 API、离线制品、安全部署或可接受性能，届时停止并重新选型，不能退化为内存/单路索引。

测试直接依赖固定 `testcontainers@12.1.0`，许可证 MIT、Node `>=22.22`，官方来源为 npm 与 Testcontainers for Node.js 文档；离线通过内网 npm 镜像或预热 `pnpm fetch` store。若容器运行时不可用，允许同一套测试连接运维提供的同版本真实 Qdrant endpoint；两者均不可用则 adapter 验收失败。生产 adapter 使用 Node 24 原生 `fetch` 和现有 Zod，因此不新增 `@qdrant/js-client-rest`。

本机 Docker Engine client/server `29.7.2` 可达；`docker buildx imagetools inspect` 已解析上述多架构 digest及 amd64 `sha256:6c0652f8d6925b22f2f6f0e0a5365a6c9dbc8768bd6e70ccc1cdc14847e452a0`、arm64 `sha256:139bbec1a1e6c0f04c978c96b5359568e72e60ae6abc9db0ab4b7643a8cd957f`，本机未缓存且规划任务未拉取。仓库现有 PostgreSQL Testcontainers fixture 证明同版本范式可用。依 handbook §5.2，只有主调度 Agent 可改 manifest、锁文件和依赖政策；C20 实现 Agent不得自行安装或修改这些文件。

### D11. 固定验收夹具同时验证质量、权限、重建和 p95

`packages/adapters/test/retrieval/fixtures/synthetic-hybrid-retrieval.v1.json` 是版本化夹具，至少含三类中文工程条目、词法独有命中、语义改写命中、双路互补查询、跨工程/无权限干扰项和期望相关集合；显式标注“合成样本、待甲方复核”。相邻 `acceptance-policy.v1.json` 固定质量与性能阈值，不把阈值写入测试代码。首版门禁为：dense Recall@5 ≥ 0.80、BM25 Recall@5 ≥ 0.80、RRF Recall@5 ≥ 0.90、RRF nDCG@5 ≥ 0.85、成员/版本/权限对账 100%、授权泄露 0，准备好 query dense vector 后的真实 Qdrant 双路+RRF 请求 p95 ≤ 500 ms（20 次预热、200 次串行测量）。

核心测试用表驱动覆盖状态、身份、对账、硬门禁和错误；adapter 真实 Qdrant/PostgreSQL 测试覆盖 create/upsert/query/inspect/delete、重复事件、并发激活、当前授权回查、全删除重建及迁移 up/down/up。质量/性能测试记录 Node/Qdrant/Docker/CPU、数据集、策略、采样数和测量边界；C05 query embedding 延迟单列观察，不混入 Qdrant p95。甲方样例到位后替换数据集并按相同指标复验，阈值变更必须发布新验收策略。

不使用 Qdrant 协议 Mock 作为验收；纯核心测试只传结构化 route/rank 数据，不伪造外部服务成功。

### D12. 文件所有权和组合边界固定在 C20

C20 新增并拥有：

- `packages/core/src/retrieval/{schema,ports,service,index}.ts` 与 `packages/core/test/retrieval/retrieval.test.ts`；
- `packages/adapters/src/retrieval/{qdrant-rest-client,postgres-retrieval-adapter,index}.ts`、`packages/adapters/test/retrieval/**` 和迁移 `000040`；
- `apps/worker/src/retrieval/{projection-handler,composition,index}.ts` 与 `apps/worker/test/retrieval/**`。

只对 `apps/worker/src/index.ts` 添加 C20 根导出；core/adapters 从各自新增的 `retrieval/index.ts` 提供子路径导出。由主调度按依赖门修改根 `package.json`、`pnpm-lock.yaml`、依赖政策，以及 `packages/core/package.json`、`packages/adapters/package.json` 的 `./retrieval` export，并提供检查点；C20 实现者不改任何 manifest/锁文件/依赖政策，不改 `packages/contracts/**`、C17/C18/C19 文件、根 workspace、`openspec/config.yaml`、主 specs、中央测试清单或迁移 provider。没有 API/Web 文件，因为现有公共端口已经覆盖查询入口。

RI 追踪：D1/D4/D5 覆盖 RI-S53 双索引发布投影；D6/D7 覆盖 RI-S54～RI-S55 的查询、双路召回与融合接缝；C20 只向 RI-S56 提供候选与可解释排序，Agent 审阅由 C21 实现。RA-S1～RA-S7、P/C 和矩阵不在本模块。

## Risks / Trade-offs

- **[前置公共事件和 C17 发件尚未落地]** → 把两者设为实施硬门；合并检查点后先跑 contracts/C17 出站验收，再开始 C20。
- **[Qdrant 1.19.0 server-side BM25 对中文工程词汇的质量不足]** → 双路指标独立硬门，策略冻结 tokenizer 参数；未达标即停止，不由 dense 总分掩盖，后续重新选型需新 change。
- **[Outbox 消费事务包含有界外部构建，可能形成长事务]** → 策略限制成员、批次和墙钟，Qdrant 操作幂等且无业务锁；若实测超限，另开规格把步骤拆为既有 Outbox 驱动阶段。
- **[一代一 collection 增加 collection 数与磁盘占用]** → 只保留活动、受引用和审计保留期内代际；由显式精确删除路径处理，不在 C20 加自动 GC。
- **[Qdrant payload 预过滤不能代表当前权限]** → PostgreSQL/C17 当前授权回查是正式结果硬门；任何不一致拒绝整次结果并避免泄露。
- **[容器或固定镜像在离线环境不可得]** → 预置 digest 锁定的 OCI tar/内网 registry；可连接同版本真实 endpoint，均不可得则 adapter 验收明确失败。
- **[合成夹具不能代表甲方真实语料]** → 报告显式标注待复核；甲方脱敏样例到位后发布新数据集版本并重跑同类门禁。

## Migration Plan

1. 归档并集成 `evolve-identification-basis-published-event`，完成 C17 发布事务发件修订；保存 contracts、C17 Outbox 和 C17 reader 验收证据。
2. 主调度按 §5.2 固定 Qdrant OCI 制品，声明 `testcontainers@12.1.0`，更新锁文件与依赖政策后形成 Git 检查点。
3. 应用 `000040` migration；该步骤只创建空表/约束/授权，不触发历史全库扫描，也不改变现有活动服务。
4. 部署 Qdrant 1.19.0 与 C20 adapter/Worker，运行真实容器/endpoint 契约、迁移、权限、质量和 p95 验收。
5. 对每个需要启用的已保存合法发布事件显式重放；旁路代际逐个通过 ready 后才激活。未收到发布事件的历史发布保持不可检索，不能自动补扫。
6. 观察结构化失败、构建时长、成员对账、Qdrant p95 和权限拒绝；确认后再开放上游组合对 `hybrid-evidence` 的调用。

回滚时先停止 C20 事件消费和新查询组合，保留 PostgreSQL 追加事实及 C04 结果工件用于审计；恢复前一活动代际只能追加新的受审计 activation，不改写历史。Qdrant 新代际可按精确 generation 删除，之后可由已保存合法事件重建。`000040` down 仅限尚未产生交付审计数据的测试/全量退役场景；生产有记录时不得直接 down，应先走数据保留和正式迁移 change。

## Open Questions

无。原公共事件缺口已由主调度选择前置 contract evolution + C17 Outbox 发件方案闭合；真实甲方验收样例何时到位只影响数据集版本，不改变本设计或任务拆分。
