# TypeScript 私有化数据与检索组件核查

核查日期：2026-08-28  
核查范围：业务关系数据、LangGraph PostgreSQL checkpointer、事务事件 / Outbox、对象文件、监测时序、向量检索、BM25 与工序 / 风险图查询。  
部署基线：完全内网；TypeScript 模块化单体；API / Worker 分进程；单机 RTX 4090 24GB + 128GB 主机内存。  
资料口径：只使用项目官方文档、官方源码仓库、官方许可证和 PostgreSQL 标准文档。版本与产品形态均按核查日重新确认。

许可证判断只用于工程初筛，不构成法律意见；AGPL、GPL、Timescale License 及商业双许可对甲方交付形态的影响仍须法务确认。

## 结论

RiskFlow 的最小 MVP 不需要为每类数据部署一种数据库。当前推荐的最小组合是：

1. **一个 PostgreSQL 18 实例**承担业务事实、版本与审计、事务 Outbox、LangGraph 检查点、监测分区表、证据元数据和图关系表。
2. **`@langchain/langgraph-checkpoint-postgres`** 放在独立 schema、使用独立数据库角色；它只保存图的恢复状态，不拥有业务事实。
3. **一个 Qdrant 服务**作为可全量重建的检索投影，同时保存同一证据版本的稠密向量和 BM25 稀疏向量；两路索引与评分独立，用 RRF / DBSF 或应用层版本化策略融合。PostgreSQL Outbox 负责至少一次投影，Qdrant 不拥有证据事实。
4. 原始资料和解析大文件先放在**单机本地不可变文件目录**，PostgreSQL 只保存内容哈希、长度、MIME、存储键和证据引用。写入协议保证“允许孤儿文件，不允许已提交记录引用缺失文件”。
5. 工序风险关联图先使用**节点表、边表、闭包 / 路径投影和递归 CTE**；它是可从领域事实重建的查询投影，不另设图事实源。
6. MVP 的批量地表沉降监测先使用 PostgreSQL 原生分区。`pgvector + pg_textsearch`、TimescaleDB、OpenSearch、Apache AGE、Neo4j 和独立对象存储均延后到明确的容量、查询或运维门槛被触发之后。

这是一条**有验收门槛的推荐**，不是已经完成的产品选型。选择 Qdrant 的决定性理由不是它能与 PostgreSQL 原子提交——它不能——而是检索本来就是可重建投影：把新的 BM25 / 中文分词 native extension 留在业务 PostgreSQL 之外，可以降低主库扩展升级、崩溃恢复和 PITR 的组合风险；Qdrant 又以一个服务同时覆盖真正的 BM25、稠密向量和融合。代价是增加一个服务、Outbox 延迟、对账和独立 snapshot。只要检索接口在返回候选后回查 PostgreSQL 事实，并允许“投影落后 / 暂不可用但不丢业务事实”，这个边界比把索引当 SSOT 更符合本项目约束。

备选的**单数据库扩展路线**是 `pgvector + pg_textsearch + 经确认的中文 parser`。它少一个服务，索引更新可与同库行事务提交，并可纳入 PostgreSQL WAL / PITR；但 `pg_textsearch` 只支持 PostgreSQL 17/18、要求 `shared_preload_libraries` 和重启，中文还要额外 parser，而且 native extension 的版本冻结、组合升级、崩溃恢复与 PITR 都会落到业务主库。只有这条路线在中文相关性、并发、强杀恢复、PITR、升级和扩展共存测试中全部通过，且团队明确优先“少一个服务”，才替换主推荐。

RTX 4090 对这些数据组件没有直接加速价值。128GB 内存也不能单独证明任何组合“必然能跑”：语料数量、向量维度、索引参数、NVMe、监测写入率和 LLM 的 CPU offload 占用尚未给出。官方资料能够证明能力和调参方向，不能替代本机基准。

## 判定口径

下文明确区分三类结论：

- **官方事实**：来源直接声明的能力、许可证、接口或限制。
- **工程推断**：从官方事实与 RiskFlow 已确认约束推出的设计判断；不是组件厂商承诺。
- **项目假设 / 待实测**：只有在目标主机、目标数据和冻结版本上才能关闭的问题。

## 推荐的最小 MVP 数据面

### 逻辑职责

| 职责 | MVP 候选 | 一致性边界 | 备份 / 恢复边界 |
|---|---|---|---|
| 业务事实、不可变版本、双时间、审计 | PostgreSQL 普通关系表 | 业务记录、审计事件和 Outbox 在同一事务提交 | 物理基准备份 + WAL / PITR；另保留逻辑导出用于迁移 |
| LangGraph 恢复状态 | 官方 Postgres checkpointer 的独立 schema | 与业务事务分离，以 `runId/threadId/checkpointId` 关联 | 随 PostgreSQL 备份；可单独设保留和清理策略 |
| 事务事件 | PostgreSQL Outbox 表 | 与产生事件的业务事实同一事务；消费至少一次、按事件 ID 幂等 | 随业务库一起恢复，不靠内存队列或 `NOTIFY` 恢复 |
| 工程原件、OCR 中间文件、解析附件 | 本地不可变文件目录 + PostgreSQL 元数据 | 文件先耐久落盘，再提交引用；失败可留下无引用孤儿 | 文件快照 / 文件级备份与数据库恢复点建立备份批次关系 |
| 监测时序 | PostgreSQL 原生范围分区 | 与监测批次、清洗结果、摘要和审计可同事务关联 | PostgreSQL 原生备份；旧分区的保留由版本化策略控制 |
| 稠密向量 + BM25 | Qdrant dense / sparse 两套索引 | 由 PostgreSQL Outbox 至少一次、幂等投影；与业务事务非原子，允许有界延迟 | snapshot 用于缩短 RTO；正确性恢复以 PostgreSQL 事实全量重建为准 |
| 工序 / 风险图 | 关系节点、边及可重建投影 | 边引用领域实体的精确版本；投影失败不改变领域事实 | 随 PostgreSQL 恢复，也可以从事实全量重建 |

### 建议的物理隔离

这是工程推断，留给“确定数据与知识持久化架构”票最终确认：

- 同一 PostgreSQL 实例内至少分出 `business`、`audit`、`outbox`、`langgraph_checkpoint`、`retrieval`、`projection` 等 schema，并使用不同数据库角色限制跨边界写入。
- checkpointer 的 `setup()` 作为受控部署迁移执行，应用启动不反复运行。当前官方 TypeScript 包支持自定义 schema，默认是 `public`；首次使用必须调用 `setup()`。[LangGraph JS 文档](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[npm 包说明](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres)
- “同一 PostgreSQL 实例”只减少运维单元，并不自动让 checkpointer 与业务写入成为一个事务。图节点恢复、重试和 `interrupt/resume` 仍按至少一次执行设计。
- BM25 和向量检索返回的只是候选证据标识与分数。原文、证据定位、机理条目和版本必须回到业务事实查询；Qdrant 不得成为证据 SSOT。检索不可用时可以降级，审计链和业务入库不能因此失败。

## PostgreSQL 基线能力

### 官方事实

截至核查日，PostgreSQL 当前稳定维护版为 18.6（同时发布 17.11、16.15 等维护版本）。本报告推荐 18 系列不等于允许浮动升级；实施票仍须冻结精确小版本和镜像。[官方发布公告](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/)

PostgreSQL 原生提供事务、JSONB、声明式分区、递归 CTE、全文检索、逻辑解码、物理 / 逻辑备份和 PITR。声明式分区会把逻辑表的数据路由到各物理分区，规划器可以做 partition pruning；这足以建立首版按工程、指标和时间范围裁剪的监测表。[分区文档](https://www.postgresql.org/docs/current/ddl-partitioning.html)

`WITH RECURSIVE` 支持递归遍历，`SEARCH` 可以生成深度 / 广度优先顺序，`CYCLE` 可以检测循环。[递归查询文档](https://www.postgresql.org/docs/current/queries-with.html) 对 RiskFlow 的工序依赖、风险因素到风险事件、追溯链等有限深度查询，这是明确可用的关系查询能力。

PostgreSQL 内置全文检索使用 `tsvector` / `tsquery`，GIN 是推荐的全文索引。`ts_rank` 按匹配词频排名，`ts_rank_cd` 使用 cover density；官方还明确指出内置排名函数不使用全局信息。[文本检索函数](https://www.postgresql.org/docs/current/functions-textsearch.html)、[排名说明](https://www.postgresql.org/docs/current/textsearch-controls.html)、[索引类型](https://www.postgresql.org/docs/current/textsearch-indexes.html)

因此，**PostgreSQL 内置 FTS 是全文过滤和本地相关性排名能力，不是真正的 BM25**。RiskFlow 的“双索引 = 向量 + BM25”不能只靠 `ts_rank` / `ts_rank_cd` 满足。

PostgreSQL 可用物理基准备份与连续 WAL 归档实现 PITR；`pg_dump` / `pg_dumpall` 是逻辑备份，不能代替连续归档。[PITR 文档](https://www.postgresql.org/docs/current/continuous-archiving.html) PostgreSQL 使用 PostgreSQL License。[官方许可证](https://www.postgresql.org/about/licence/)

Node.js 可通过 `node-postgres` 使用同一连接显式执行 `BEGIN / COMMIT / ROLLBACK`；官方特别提醒一个事务的所有语句必须使用同一个 client，不能用 `pool.query` 拼事务。[node-postgres 事务文档](https://node-postgres.com/features/transactions)

### 工程推断

- 业务事实、版本、审计、Outbox 和规则发布天然需要强关系约束与事务，PostgreSQL 应是唯一主事实库。
- 批量地表沉降的 MVP 规模未知，先用原生分区能够保留退出空间；没有数据证明必须先安装时序扩展。
- 递归 CTE 适合当前可重建图投影。只有多跳查询的深度、基数或 p95 证明关系实现达不到目标，才需要 AGE / Neo4j。
- PostgreSQL 的备份策略必须包含“定期恢复演练”，只成功生成备份文件不能证明 RTO / RPO。

## LangGraph PostgreSQL checkpointer

### 官方事实

LangGraph 在每个 super-step 保存 checkpoint，并按 thread 组织，从而支持人工复核、状态历史、time travel 和故障恢复；官方将 `@langchain/langgraph-checkpoint-postgres` 列为生产级 Postgres 实现。[持久化文档](https://docs.langchain.com/oss/javascript/langgraph/persistence)

当前 TypeScript 包 `@langchain/langgraph-checkpoint-postgres`：

- 提供 `PostgresSaver`，内置 TypeScript 声明，许可证为 MIT；
- 支持连接字符串或既有 `pg.Pool`；
- 首次必须运行 `setup()`；
- 支持自定义 schema；
- 包的 `put`、`putWrites`、`get`、`list` 等能力对应检查点和 pending writes。[官方 npm 包](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres)、[LangGraph JS 源码仓库](https://github.com/langchain-ai/langgraphjs)

### 工程推断

- 使用独立 schema、独立 owner 和最小权限角色，避免领域迁移、查询和清理逻辑碰触 LangGraph 内部表。
- 只把小型、版本化 DTO、实体 ID 和结果引用写入图状态。工程原件、完整模型响应、证据正文和领域事实不进入检查点。
- 业务入库成功后，即使后续 checkpoint 写入或节点失败，也不能回滚或删除已提交业务事实；恢复后用业务幂等键识别已完成写入。
- checkpointer 与业务库可以共用 PostgreSQL 实例和备份设施，但它们的保留期不同。清理旧 checkpoint 不得级联删除运行审计、复核决定或风险事实。

### 待实测

- 在 API / Worker 分进程、连接池耗尽、进程强杀、数据库重启和 `interrupt/resume` 下能否稳定恢复；
- checkpoint 大小、写放大、保留天数和清理耗时；
- 固定版本升级时 `setup()` / 迁移的前向、回滚和备份恢复行为。

## 事务 Outbox 与投影一致性

### 官方事实

`SELECT ... FOR UPDATE SKIP LOCKED` 会跳过已锁定的行；PostgreSQL 官方明确说这会产生不一致视图，不适合一般查询，但适合多个消费者访问 queue-like table。[`SELECT` 文档](https://www.postgresql.org/docs/current/sql-select.html)

`NOTIFY` 只有事务提交后才发送，重复的同 payload 通知还可能在同一事务内折叠。官方建议结构化或大数据放在表中，只把键放进通知。[`NOTIFY` 文档](https://www.postgresql.org/docs/current/sql-notify.html)

逻辑解码可以把 WAL 变化转成外部消费流；但逻辑 slot 的位置只在 checkpoint 持久化，崩溃后可能重发，消费者必须处理重复。失去消费者的 slot 还会长期保留 WAL 和系统目录行，极端情况下耗尽存储。[逻辑解码概念](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html)

### 工程推断

MVP 首选表式 Outbox：

1. 领域命令在同一数据库事务中写业务事实、审计事件和 Outbox 行。
2. Worker 用 `FOR UPDATE SKIP LOCKED` 短事务领取一批事件，提交领取状态后处理。
3. 每个事件有稳定 `eventId`、聚合身份 / 版本、因果 `runId` 和业务幂等键；消费者记录处理结果，允许重复投递。
4. `LISTEN/NOTIFY` 只能作为降低轮询延迟的唤醒信号。Worker 启动、重连和定时兜底都必须扫描 Outbox 表。
5. 投影到 Qdrant、OpenSearch、Neo4j 或文件删除时，Outbox 是数据库事务与外部系统之间的桥；禁止在应用请求里“同时写两边并祈祷都成功”。

逻辑解码 / CDC 可以在事件吞吐证明表式 Outbox 轮询成为瓶颈后再引入。它不是“恰好一次”，还会增加 slot 监控、WAL 容量和故障切换成本。

## 向量与 BM25 候选

### 两条最小路线的取舍

| 维度 | 主推荐：PostgreSQL + Qdrant | 备选：PostgreSQL + `pgvector + pg_textsearch` |
|---|---|---|
| 真正 BM25 + 稠密向量 | Qdrant 在同一 collection 内维护 dense / BM25 sparse 两套独立索引并支持融合 | `pg_textsearch` 提供 BM25，`pgvector` 提供向量；由应用层融合 |
| 中文 | 官方 `multilingual` tokenizer 明确覆盖非空格语言，但盾构术语、规范号和专名仍须以项目查询集实测 | PostgreSQL 核心 parser 不会中文分词；官方示例要求另装 `zhparser` 等 parser，新增许可证、构建和词典治理边界 |
| 事务 / 可见性 | 与 PostgreSQL 非原子；Outbox 至少一次投影，存在可度量的索引延迟 | 已生成的索引内容可随同库数据事务可见；embedding 生成若在事务外，仍要 Outbox / 幂等更新 |
| 备份 / 恢复 | collection snapshot 有版本兼容边界且不含 alias；不提供与业务库一致的 PITR。索引被定义为派生物，可按版本从 PostgreSQL 重建 | `pgvector` 与 `pg_textsearch` 可进入 PostgreSQL WAL / PITR，但恢复依赖完全一致的主版本和 native extension 二进制，必须验证组合恢复 |
| 故障影响 | 检索服务故障不会直接破坏业务主库；可降级到按标识 / 元数据查询 | 索引、compaction 或扩展故障与业务 PostgreSQL 共用进程、I/O、WAL 和升级窗口 |
| 运维 | 多一个服务、端口、数据卷、snapshot、Outbox 水位与重建任务；官方 TS 客户端直接接入 | 少一个服务和网络跳转，但多两个 native extension，中文还多一个 parser；升级 / 回滚与 PostgreSQL 主版本绑在一起 |
| 一致性边界是否符合项目 | 符合：检索是可重建投影，审计与证据事实留在 PostgreSQL | 也符合，但“同库”不能把异步 embedding 或 LangGraph checkpoint 自动变成同一业务事务 |

**工程判断：选择 Qdrant 路线作为 MVP 基线。** 本项目对业务事实、审计和历史重放要求强，对检索投影只要求可重建和可追溯；因此把实验性更强的中文 BM25 依赖与主库故障域分开，比减少一个进程更重要。若实测表明 Qdrant 的 Outbox 延迟、内存或恢复 RTO 不达标，再比较同库路线；反向切换必须连同中文 parser 和 PostgreSQL 扩展组合一起验收，不能只比较查询延迟。

### `pgvector`

**官方事实。** `pgvector` 当前版本为 0.8.6，使用 PostgreSQL License，支持精确近邻和 HNSW / IVFFlat 近似近邻，支持 L2、内积、余弦等距离，并可从任何 PostgreSQL 客户端使用。默认精确搜索；HNSW 的速度 / 召回优于 IVFFlat，但构建更慢、占用更多内存；官方建议索引图能装入 `maintenance_work_mem` 时构建更快，并警告不能因此耗尽服务器内存。[变更记录](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md)、[官方仓库与调优说明](https://github.com/pgvector/pgvector)、[许可证](https://github.com/pgvector/pgvector/blob/master/LICENSE)

当前官方说明的类型上限包括 `vector` 2,000 维、`halfvec` 4,000 维。`pgvector` 直接继承 PostgreSQL 的 ACID、PITR、JOIN 和 WAL 备份能力。[官方 README](https://github.com/pgvector/pgvector)

**工程推断。** 对 MVP 的证据段规模，同库向量减少一个服务、一个同步链和一套快照。向量仍是由证据段版本与 embedding 模型版本生成的派生物；重建键至少包含 `sourceSegmentVersionId + embeddingModelVersion + chunkingVersion`。模型升级不覆盖旧向量，而是创建新索引版本并切换生效引用。

**待实测。** 固定嵌入维度和真实过滤条件后，比较 exact、HNSW 与 `halfvec` 的 recall@K、p95、写入吞吐、构建时间、峰值内存和磁盘；恢复后复查索引可用性。4090 不参与 pgvector 查询，主机内存 / NVMe 才是主要资源。

### `pg_textsearch`：备选的同库 BM25 候选

**官方事实。** `pg_textsearch` 是 Timescale 维护的 PostgreSQL BM25 扩展，使用 PostgreSQL License；官方在 2026-03 宣布 1.0 GA / production ready，当前支持 PostgreSQL 17 和 18。[官方仓库](https://github.com/timescale/pg_textsearch)、[官方发布说明](https://github.com/timescale/docs/blob/latest/about/changelog.md#pg_textsearch-v100--production-ready)

它提供可配置 `k1` / `b` 的 BM25、Block-Max WAND Top-K、并行构建、部分 / 表达式索引和分区表支持；要求加入 `shared_preload_libraries` 并重启 PostgreSQL。当前实现把索引页变更写入 PostgreSQL WAL，官方声明崩溃恢复与流复制由标准 WAL 重放完成。[官方 README：性能与恢复](https://github.com/timescale/pg_textsearch#performance)

与 RiskFlow 直接相关的限制：

- 没有原生 phrase query 和专用 faceting；
- 同步 compaction 可能影响持续写入；
- 分区表按分区计算 BM25 统计，跨分区分数不一定可比；
- PostgreSQL 内置 parser 不会把中文切成词，官方示例要求使用 `zhparser` 等中文 parser；文档和查询必须使用同一 text search configuration。[官方 README：限制与中文检索](https://github.com/timescale/pg_textsearch#limitations)、[中文配置](https://github.com/timescale/pg_textsearch#chinese-full-text-search)

**工程推断。** 检索证据表不应按时间切成会被同一查询跨越的分区，否则分区局部 IDF 会破坏全局排序可比性。监测时序表和检索语料表应该分开设计。`pg_textsearch` 的扩展许可证宽松，但中文 parser 是另一个独立依赖，必须在依赖票中单独确认来源、许可证、PG17/18 构建、词典治理和升级方式。

**待实测。** 用 RiskFlow 中文术语和自定义词典做 NDCG@10 / Recall@K；同时测试批量入库、更新 / 作废版本、并发查询、崩溃恢复、PITR、`pgvector + pg_textsearch` 共存、升级和 `REINDEX`。官方仓库在 2026 年仍出现过已修复的索引页 / tombstone 问题，这意味着“GA”不能替代本项目恢复测试。[官方问题记录](https://github.com/timescale/pg_textsearch/issues/427)

### ParadeDB / `pg_search`

**官方事实。** ParadeDB 当前版本为 0.25.0；其 `pg_search` 是 PostgreSQL 扩展，基于 Tantivy 提供 BM25、过滤、聚合和混合搜索，支持 PostgreSQL 15–18，且要求 `shared_preload_libraries`；它还依赖 `pgvector` 做向量能力。[发布记录](https://github.com/paradedb/paradedb/releases/tag/v0.25.0)、[官方仓库](https://github.com/paradedb/paradedb)、[扩展开发说明](https://github.com/paradedb/paradedb/blob/main/pg_search/README.md)

ParadeDB Community 当前使用 **AGPL-3.0**，同时提供商业许可；官方企业版页面说明 enterprise 会豁免 copyleft，并包含若干面向企业生产负载的闭源功能。[许可证与部署](https://github.com/paradedb/paradedb#license)、[Community / Enterprise](https://docs.paradedb.com/deploy/enterprise)

恢复边界是本项目的硬门槛：官方当前能力矩阵说明 Community BM25 索引不提供 physical WAL replication、crash recovery 和 PITR，这些能力属于 Enterprise；Community 可通过逻辑复制或从 PostgreSQL 事实重新加载 / 重建索引。[Community / Enterprise](https://docs.paradedb.com/deploy/enterprise)、[保证与限制](https://docs.paradedb.com/welcome/guarantees)

**工程推断。** 它比 `pg_textsearch` 功能更宽，但 RiskFlow MVP 不需要先承担 AGPL / 商业许可决策和更大的扩展面。若后续需要同库 faceting、复杂过滤 / 聚合且 OpenSearch 又过重，可重新评估。

**延后条件。** 只有在法务确认许可、功能差距确实存在，并决定接受“Community 可重建投影”或购买 Enterprise 恢复能力后，再对选定版本的 WAL / 备份 / 逻辑复制与中文 tokenizer 做测试。当前不把 ParadeDB 当作默认 BM25。

### Qdrant

**官方事实。** Qdrant 当前服务端版本为 1.19.0，服务端和官方 JS / TS SDK 均为 Apache-2.0。官方客户端提供 REST 和 gRPC 包，支持 Node.js 18+ 的 ESM / CJS。[发布记录](https://github.com/qdrant/qdrant/releases/tag/v1.19.0)、[服务端仓库](https://github.com/qdrant/qdrant)、[TypeScript SDK](https://github.com/qdrant/qdrant-js)

Qdrant 同时支持稠密和稀疏向量、过滤、BM25 与服务端 RRF / DBSF 混合查询。当前 BM25 使用稀疏向量与 IDF modifier，BM25 是自托管 inference 的例外；`multilingual` tokenizer 支持非空格语言，官方 TypeScript 示例直接查询“村上春树”。[全文 / BM25](https://qdrant.tech/documentation/search/text-search/full-text-search/)、[混合查询](https://qdrant.tech/documentation/search/hybrid-queries/)、[自托管 inference 边界](https://qdrant.tech/documentation/guides/text-search/)

单节点可创建和启动时恢复 snapshot。snapshot 恢复只保证同 minor 或下一 minor 兼容，collection snapshot 不包含 alias；分布式时需要逐节点快照。[snapshot 文档](https://qdrant.tech/documentation/operations/snapshots/)

Qdrant 默认偏向可用性和吞吐；集群默认 read consistency 为 1、write ordering 为 weak。可以提高读一致性和使用 medium / strong ordering，但仍不是 PostgreSQL 业务事务的一部分。[一致性保证](https://qdrant.tech/documentation/scaling/consistency-guarantees/)

**工程推断。** Qdrant 是主推荐：一个额外服务同时覆盖向量、真正 BM25 和融合，许可证清晰，TypeScript 接口一手支持。代价是所有内容都成为 PostgreSQL 的异步检索投影，必须保留 Outbox、投影版本、重建和对账任务。

**移除 / 回退条件。** 若 Qdrant 的中文质量、dense+sparse 召回、Outbox 新鲜度、内存或重建 RTO 在目标主机上失败，则用同一数据集评估 `pgvector + pg_textsearch` 或 OpenSearch。无论保留哪条路线，PostgreSQL 中都保存原文、段版本、embedding 版本和投影水位，不把 Qdrant payload 当业务事实。

### OpenSearch

**官方事实。** OpenSearch 当前发布线为 3.8.0，采用 Apache-2.0；BM25 是所有文本字段的默认 similarity，3.x 使用 Lucene 原生 BM25。它提供官方 Node.js 客户端、k-NN / 向量检索和自托管单节点部署。[3.8.0 发布说明](https://github.com/opensearch-project/opensearch-build/blob/main/release-notes/opensearch-release-notes-3.8.0.md)、[许可证](https://github.com/opensearch-project/OpenSearch)、[BM25 similarity](https://docs.opensearch.org/latest/im-plugin/similarity/)、[JavaScript 客户端](https://docs.opensearch.org/latest/clients/javascript/index/)

OpenSearch 是 near-real-time：写入先进入 translog / 内存，refresh 后才可搜索。官方默认活跃索引约每秒 refresh，并建议用 `refresh=wait_for`，不要在生产中频繁强制 refresh。[refresh 文档](https://docs.opensearch.org/latest/api-reference/index-apis/refresh/)

snapshot 是增量的，但不是整个集群的完美单一时点；不同 shard 可能代表稍有差异的时刻。它需要注册文件系统、S3、HDFS 等 repository。[snapshot 文档](https://docs.opensearch.org/latest/tuning-your-cluster/availability-and-recovery/snapshots/snapshot-restore/)

官方要求调高 `vm.max_map_count`、避免 swap，并建议 JVM heap 约为分配给进程内存的一半。[系统设置](https://docs.opensearch.org/latest/install-and-configure/configuring-opensearch/configuration-system/)

**工程推断。** OpenSearch 的中文 analyzer、BM25、复杂搜索和聚合上限高，但它引入 JVM、独立安全 / 证书、索引生命周期、snapshot repository、近实时一致性和 Outbox 同步。在与 27B 模型共享 128GB 主机时，heap、page cache 和模型 CPU offload 还会争用内存。MVP 不应在 Qdrant / 同库方案尚未失败前引入。

**升级条件。** 只有在需要 Qdrant / PostgreSQL 不覆盖的复杂 analyzer、聚合、highlight、搜索运维工具或数据规模，并且能给 OpenSearch 独立资源预算时使用。

## 监测时序：原生分区与 TimescaleDB

### PostgreSQL 原生分区

**工程推断。** 已确认的 MVP 输入是批量地表沉降监测，不是高频实时流。按 `projectId / spatialSectionId / indicatorId / observedAt` 建普通表和月 / 周范围分区，配合批次、质量标记、原始值、清洗值和摘要版本，先能满足确定性重放和审计。

**待实测。** 需要用甲方样例或合成上限测持续写入率、迟到数据、范围查询、趋势窗口、批量重评估和分区维护。没有这些数字，不能以“监测数据是时序”直接推导必须采用时序扩展。

### TimescaleDB

**官方事实。** TimescaleDB 当前版本为 2.29.1，该版本支持 PostgreSQL 16–18，已移除 PostgreSQL 15 支持。它是 PostgreSQL 扩展，hypertable 自动把数据按时间切成 chunk，并提供 time bucket、continuous aggregate、columnstore / compression 和 retention 能力。[发布记录](https://github.com/timescale/timescaledb/releases/tag/2.29.1)、[官方仓库](https://github.com/timescale/timescaledb)

它是混合许可证：`tsl` 目录外通常 Apache-2.0，`tsl` 内使用 Timescale License；Community 版可以免费在自管基础设施运行，但不能把它作为托管服务出售。[仓库许可证](https://github.com/timescale/timescaledb/blob/main/LICENSE)、[版本与许可证比较](https://github.com/timescale/docs/blob/latest/about/timescaledb-editions.md)

自托管备份复用 PostgreSQL 的 `pg_dump / pg_restore` 或 `pg_basebackup`；逻辑恢复要执行 Timescale 的 pre / post restore，并记录 PostgreSQL 与 TimescaleDB 扩展版本。[备份恢复](https://github.com/timescale/docs/blob/latest/self-hosted/backup-and-restore/index.md)、[逻辑恢复步骤](https://github.com/timescale/Tiger-Data-Docs/blob/main/src/content/docs/deploy/self-hosted/backup-and-restore/logical-backup.mdx)

**工程推断。** 它与 Node.js 的接入仍是 PostgreSQL SQL，不增加应用客户端种类；但会增加 extension 版本、后台 worker、许可分层和恢复步骤。当前没有必要让监测数据和检索证据共用 hypertable，也不应把 BM25 索引放在跨时间分区且需要全局可比分数的表上。

**升级条件。** 当原生分区在真实数据上不能满足写入 / 范围聚合 p95，或 retention、continuous aggregate、压缩能显著降低可量化运维成本时再引入；引入前要测试与 `pg_textsearch`、`pgvector`、checkpointer 的同实例兼容和 worker / 内存预算。

## 对象文件

### 本地不可变文件系统：MVP 推荐

**官方事实。** Node.js 自带 `fs` / stream 能力，不需要另一个存储服务。文件系统本身不提供 PostgreSQL 事务、S3 API、跨节点副本或对象版本语义。

**工程推断。** 单机 MVP 使用专用数据卷上的内容寻址目录最简单：

- 存储键由内容哈希派生，目录和文件名不使用用户原始文件名；原始名称只作为元数据。
- 上传写入 staging，计算哈希、长度和 MIME，刷新并关闭文件后原子移动到不可变路径，再提交数据库引用。
- 数据库事务失败只会留下孤儿文件，后台按宽限期清理；数据库成功但文件尚未耐久的路径必须禁止。
- 删除资料版本时只写删除 / 保留任务；确认没有引用且满足审计保留策略后由 Outbox 异步删除文件。
- 文件读取每次校验长度 / 哈希或定期做 scrubbing；路径穿越、符号链接和权限需要在适配器边界封死。

本地目录的数据库与文件快照不是天然同一事务。备份流程应记录 `backupBatchId`、数据库恢复点 / LSN、文件快照标识和清单。由于文件不可变，可先确保文件备份是数据库引用的超集；恢复后允许清理孤儿，绝不能接受缺失被引用对象。

### MinIO：不推荐新引入

**官方事实。** MinIO 社区源码使用 AGPL-3.0。官方仓库当前已归档，README 明确社区版只再提供源码、不再发布或维护预编译二进制，并提示源码编译用于生产需自行承担风险。[官方仓库与当前分发说明](https://github.com/minio/minio)、[许可合规说明](https://github.com/minio/minio/blob/master/COMPLIANCE.md)

历史官方文档显示 MinIO 提供 S3 API、versioning、erasure coding 和多种拓扑，但单节点单盘只适合开发 / 有限可靠性；真正的 erasure coding 需要多盘，不能把单机一个目录包装成服务就视为获得冗余。[部署拓扑](https://min.io/docs/minio/linux/operations/installation.html)、[erasure coding](https://min.io/docs/minio/linux/operations/concepts/erasure-coding.html)

**工程推断。** 2026-08 新项目没有理由以已归档、source-only、AGPL 的 MinIO Community 作为默认对象层。历史熟悉度不是当前可维护性证据。

### SeaweedFS 等 S3 候选：只在升级时研究

SeaweedFS 官方仓库为 Apache-2.0，提供 S3 API、文件接口、复制和纠删码。[官方仓库](https://github.com/seaweedfs/seaweedfs) 它是比当前 MinIO Community 更值得进入未来短名单的候选，但本票没有完成其单机恢复、权限、对象锁、Node SDK 兼容和长期维护验收，不能直接替换成本票推荐。

**升级条件。** 多节点对象存储、S3 生态接入、对象锁 / 法规保留、跨站点复制或容量超出单卷管理边界时，另开对象存储专项比较；在此之前本地不可变文件目录更少、更可控。

## 工序 / 风险图查询

### 关系表 + 递归 CTE：MVP 推荐

**工程推断。** 使用显式 `graph_node` / `graph_edge` 或更具领域含义的关系表，边包含 from / to 身份、关系类型、来源事实版本和生效区间。常用有限路径可以物化成可重建 projection；非常用路径用递归 CTE。这样节点和边仍受外键、版本和业务事务约束，查询投影丢失时可重建。

必须避免把“图页面需要画节点和边”误判成“业务必须使用图数据库”。先基准以下固定查询：当前工序前后依赖、工序到机理 / 风险、完整追溯链、指定深度影响范围、循环检测。

### Apache AGE

**官方事实。** Apache AGE 是 Apache-2.0 的 PostgreSQL extension，支持 Cypher / property graph；官方当前 README 声明支持 PostgreSQL 11–18，并提供 Docker / 源码安装。[官方仓库](https://github.com/apache/age)、[安装与兼容版本](https://github.com/apache/age/blob/master/README.md)

**工程推断。** AGE 能在不增加独立数据库服务的前提下提供 Cypher，但会增加另一个 native extension、`agtype` / Cypher 查询层和 PostgreSQL 大版本耦合。TypeScript 可以继续通过 PostgreSQL SQL 调用，没有必要让领域层直接依赖 AGE 数据类型。

**升级条件。** 只有递归关系查询在真实图规模上失败，且团队明确需要 Cypher 表达力时引入；若同时采用同库检索 / 时序扩展，必须验证 AGE 与这些扩展的二进制兼容、备份、升级和查询计划。

### Neo4j

**官方事实。** Neo4j Community 是 GPLv3，支持单实例、ACID、Cypher 和 API；Enterprise 增加集群、在线备份、故障转移和更完整的安全能力。[官方仓库许可证](https://github.com/neo4j/neo4j)、[版本能力比较](https://neo4j.com/docs/operations-manual/current/introduction/)

Community 可做离线 dump；在线 backup 是 Enterprise 能力。[备份与恢复](https://neo4j.com/docs/operations-manual/current/backup-restore/) Neo4j 提供官方 JavaScript driver 和 TypeScript API。[JavaScript driver](https://neo4j.com/docs/javascript-manual/current/)

**工程推断。** 作为独立图投影，Neo4j 会引入第二事务系统、Bolt 客户端、JVM / page cache、单独备份和 Outbox 对账。MVP 图是可重建投影且查询规模未知，不能证明这些成本合理。若未来图算法、复杂可变长度遍历和专职图分析成为核心能力，再做 Neo4j CE / 商业版许可与运行专项。

## 组件总表

| 组件 | 许可证 / 私有部署 | Node / TS 接入 | 一致性与恢复 | 单机运维成本 | MVP 判定 |
|---|---|---|---|---|---|
| PostgreSQL | PostgreSQL License；完全自托管 | `pg` | ACID；WAL / PITR；逻辑导出 | 中 | 必选 SSOT |
| LangGraph Postgres checkpointer | MIT；完全自托管 | 原生 TS 包 | 线程 checkpoint；不等于业务入库 | 低（复用 PG） | 必选，独立 schema |
| PostgreSQL Outbox | 无额外产品 | `pg` | 与领域事实同事务；至少一次消费 | 低 | 必选 |
| pgvector | PostgreSQL License | PostgreSQL SQL | 同库事务 / WAL；HNSW 有召回权衡 | 低到中 | 单数据库备选路线 |
| pg_textsearch | PostgreSQL License；PG17/18 | PostgreSQL SQL | 同库事务 / WAL；扩展版本需冻结 | 中 | 单数据库备选路线 |
| ParadeDB / pg_search | AGPL-3.0 或商业 | PostgreSQL SQL | Community BM25 无 physical WAL replication、crash recovery、PITR；Enterprise 才提供 | 中 | 延后 |
| Qdrant | Apache-2.0 | 官方 TS REST / gRPC | 独立可重建投影；snapshot；集群一致性可调 | 中 | MVP 检索主推荐 |
| OpenSearch | Apache-2.0 | 官方 Node client | 近实时；独立 snapshot，不与 PG 原子 | 高 | 延后 |
| PostgreSQL 原生分区 | PostgreSQL License | `pg` | 同 SSOT 事务 / 备份 | 低增量 | MVP 监测首选 |
| TimescaleDB | Apache-2.0 + TSL | PostgreSQL SQL | 复用 PG，但恢复有扩展步骤 | 中 | 指标触发后引入 |
| 本地不可变文件目录 | 无外部许可 | Node `fs` | 与 DB 非原子，靠写入协议和备份批次 | 低 | MVP 首选 |
| MinIO Community | AGPL-3.0；仓库已归档、source-only | S3 / SDK | 对象层独立；单盘无额外冗余 | 中且维护风险高 | 不推荐 |
| SeaweedFS | Apache-2.0 | S3 API | 独立对象系统 | 中到高 | 后续短名单 |
| 关系表 / 递归 CTE | PostgreSQL License | `pg` | 与业务事实同事务，可重建 | 低增量 | MVP 图首选 |
| Apache AGE | Apache-2.0 | PostgreSQL SQL | 同 PG 扩展边界 | 中 | 延后 |
| Neo4j CE / EE | CE GPLv3；EE 商业 | 官方 JS driver | 独立事务 / 备份；在线备份属 EE | 高 | 延后 |

## 单机 4090 / 128GB 的资源判断

### 可以直接确认

- 上述数据库与搜索引擎主要使用 CPU、主机内存和磁盘；RTX 4090 留给 llama.cpp / embedding 推理，不应写入数据组件容量论证。
- `pgvector` HNSW 构建会显著受 `maintenance_work_mem` 影响；更高值提高构建速度但可能耗尽内存。[pgvector 调优](https://github.com/pgvector/pgvector#index-build-time)
- OpenSearch 同时需要 JVM heap 和操作系统 page cache，官方还要求避免 swap；它不是一个“只多开几百 MB”的组件。
- LLM 已确认可能进行 CPU / RAM offload，因此数据库不能按“主机有 128GB”独占规划。

### 工程推断

- 首版给 PostgreSQL、Worker、文件缓存和 llama.cpp 设置明确的进程 / 容器内存上限；索引构建作为受控批任务，不能与长上下文 LLM 峰值并发抢内存。
- OpenSearch / Neo4j 若以后引入，优先迁到独立机器或至少分配独立资源预算。把多个内存型索引和 27B 模型无上限地放在一台主机上，会使任何单项基准失去意义。
- 检索文档按专利约束最多 512 字符语义块，原始文件不进入向量 / BM25 索引；这能明显控制索引工作集，但实际块数仍未知。

### 不能从现有资料确认

- 可容纳多少证据段、多少维向量、多少监测点；
- pgvector HNSW 是否全在内存、构建是否会 OOM；
- Qdrant 中文 BM25、向量融合与 Outbox 新鲜度的 p95；
- Qdrant 与同库 / OpenSearch 路线在同一数据集下谁更合适；
- 数据库、OCR、embedding、LLM 同时运行时的峰值 RAM、I/O 和温度稳定性。

这些都必须以本机基准回答，不能引用厂商通用 benchmark 填数。

## 最小验收与升级门槛

### PostgreSQL / 事务 / 恢复

- 在同一事务写入标准化风险记录或评估记录、审计事件和 Outbox；分别在 `COMMIT` 前后强杀进程，确认不存在“事实已提交但事件永久丢失”。
- 两个 Worker 并发领取 Outbox，验证无并发重复执行；故意制造处理超时和宕机，验证事件会重投且业务副作用由幂等键去重。
- `NOTIFY` 断线不影响补投；禁用通知后纯轮询仍能清空积压。
- 对 PostgreSQL 做物理基准备份 + WAL 恢复到指定时间，随机抽查审计链和 checkpoints。随后从恢复后的事实重建 Qdrant 并抽查向量 / BM25 结果集合；另测 Qdrant snapshot 恢复以比较 RTO。记录两段恢复各自的 RPO、RTO、备份大小和精确版本。
- 删除 checkpointer 历史，确认业务事实和审计不受影响；删除 / 重建检索投影，确认可从 SSOT 恢复。

### 检索质量与性能

- 在关闭所有出站网络的环境中，从内部制品库安装并启动冻结版本；BM25、向量查询、重建和恢复不得依赖云 API 或运行时下载。镜像、npm 包、模型 / tokenizer 资产及许可证清单进入离线发布包。
- 冻结中文工程查询集与相关性标注，分别测 BM25、向量、融合后的 Recall@K、MRR / NDCG@10；融合策略、权重和 Top-K 作为版本化配置。
- 测同义工程词、精确规范号、里程 / 数值、设备名、错别字、长查询和否定条件；中文分词词典版本进入索引版本。
- 固定向量模型、维度、距离、HNSW 参数、BM25 `k1/b`、分词配置、语料版本；记录热 / 冷 p50/p95、并发、构建时间、峰值 RAM 和索引磁盘。
- 先验收 PostgreSQL + Qdrant 主路线；若中文质量、Outbox 新鲜度、资源或恢复 RTO 失败，再用完全相同的数据、查询和故障脚本比较 `pgvector + pg_textsearch + 中文 parser`。不得用不同 embedding 或语料版本制造虚假优劣。

### 监测与图

- 用预期上限的批量监测样本验证导入、迟到 / 修订数据、范围查询、趋势 / 加速度窗口、摘要生成和重评估触发。
- 对五类固定图查询分别测深度、节点 / 边规模和 p95；关系实现未失败前不引入 AGE / Neo4j。
- 投影表或检索库全部删除后能从领域事实重建，重建结果的实体 / 版本集合相同；排名分数可以随算法版本变化，但必须记录索引和策略版本。

### 文件与备份

- 上传时在文件落盘、数据库提交和 Outbox 提交的每个边界强杀进程；恢复后只允许无引用孤儿，不允许数据库引用缺失文件。
- 文件快照与 PostgreSQL PITR 组合恢复，运行引用完整性和哈希校验；统计恢复耗时、缺失 / 孤儿数量。
- 备份副本必须在另一故障域；同一物理盘上的“备份目录”不算灾难恢复。

## 明确不推荐或延后的事项

- **不以 PostgreSQL 内置 FTS 代替 BM25。** 移除该限制的条件不存在；这是算法契约。
- **MVP 不同时维护 Qdrant 与 pgvector / pg_textsearch 的同一份生产索引。** 单数据库路线只作为可替换候选；双写两套索引会增加漂移、重建和版本切换成本。只有迁移期或有明确、可测的不同职责时允许短期并存。
- **不把 checkpointer 当业务事实库。** 检查点可清理、可因图版本变化失效，且节点可能重跑。
- **不把 `LISTEN/NOTIFY` 当消息队列。** 它只做唤醒，Outbox 表才是可恢复事实。
- **不在 MVP 新引入 MinIO Community。** 只有选用商业 AIStor 或社区重新出现受维护、可审计的发行路线并通过许可审查时才重评估。
- **暂不引入 OpenSearch。** 触发条件是 PostgreSQL / Qdrant 无法满足的搜索功能或规模，且有独立 JVM / 运维预算。
- **暂不引入 TimescaleDB。** 触发条件是原生分区的真实基准失败，或 continuous aggregate / retention / compression 带来可量化收益。
- **暂不引入 AGE / Neo4j。** 触发条件是固定图查询在真实规模上失败，或产品明确需要 Cypher / 图算法；Neo4j 还需单独决定 GPL / 商业版和在线备份要求。
- **暂不使用逻辑解码替代表式 Outbox。** 触发条件是轮询吞吐或跨系统投影规模成为已测瓶颈，并能承担 slot / WAL 监控。

## 交给“确定数据与知识持久化架构”票的待决事项

本研究提供事实和候选，不替后续票决定以下领域架构：

1. PostgreSQL 是单数据库多 schema，还是业务 / checkpointer 分数据库但共实例；角色、迁移和保留期如何划分。
2. 业务表、审计表、投影表、向量和 BM25 的稳定标识、版本信封与物理表结构。
3. Outbox 的事件信封、领取租约、重试 / 死信、幂等记录和积压告警。
4. 本地文件目录的存储键、备份批次、保留 / 删除和恢复后对账协议。
5. 检索索引版本、中文 tokenizer / 词典、embedding 模型、融合策略和在线切换协议。
6. 监测表的分区键、分区粒度、保留策略与 TimescaleDB 升级门槛。
7. 工序风险图的领域边表、可重建投影和固定查询契约。
8. 生产 PostgreSQL 与 Qdrant 的精确冻结版本；若选择单数据库备选路线，再冻结 `pgvector` / `pg_textsearch` / 中文 parser，并形成 native extension 组合镜像、升级与回滚矩阵。
9. RPO / RTO、备份介质、异机副本、恢复演练频率和审计保留期限。

在这些决定完成前，可以把后续 OpenSpec 的技术基线表述为：**PostgreSQL 是唯一业务事实源；Qdrant 是 Outbox 驱动、可全量重建的向量 + BM25 检索投影；图先使用 PostgreSQL 关系投影；本地文件采用不可变内容寻址。任何独立检索 / 图 / 对象服务都不得绕过事务 Outbox 和全量重建路径。**
