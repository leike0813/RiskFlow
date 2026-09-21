# Implementation Plan

## 1. 实施基线与权威来源

- **固定代码基线**：`cafdecfb78d1ebebf4fccd4260422f6cb4eb7556`；本次重开规划输入 HEAD 与该提交一致。代码是实现现状事实源。
- **规格事实源**：本 change 的 delta spec；设计决定 D1～D13；已归档 C03 `platform/postgresql-outbox-checkpoint-foundation`、C05 `platform/llamacpp-model-gateway`、C04 `platform/content-addressed-artifact-store`、C06 当前授权主规格；已归档 C17 的 `IdentificationKnowledgeReleaseReaderV1`、发布包及 `retrieve()` 可选委派语义。D13 的三个 C17 接缝文件按 `approval://riskflow/C20/scope-2026-09-21-c17-retrieval-delegate` 纳入 C20。
- **实施硬门（IP-00）**：开始 C20 代码前，核验已归档 `evolve-identification-basis-published-event` 和 C17 发布事务发送 `knowledge.identification-basis-published.v1` 的当前检查点；contracts 严格事件测试、C17 同事务 Outbox 测试和 `readExact` 测试必须通过。实现者读取当前公共事件 Schema 与 C17 reader，不在 C20 猜测或复制字段。C17 检索委派接缝由 IP-06 实施，不列为主调度前置。
- **依赖硬门（IP-00）**：主调度按 handbook §5.2 完成 `qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc` OCI 制品、根 `testcontainers@12.1.0` 直接开发依赖、锁文件/依赖政策，以及 core/adapters `./retrieval` package exports，并形成检查点。C20 实现者不安装依赖、不改 manifest、锁文件或依赖政策。
- **就绪判断**：前置合并后若事件引用与 C17 `releaseBinding` 不能完成 D1 精确相等校验，或 C17 reader/export 名称偏离批准工件，立即升级；不得通过本地兼容 DTO、私表读取或扩大 C20 修补。
- **迁移号段**：只使用 `000040`；`000041`～`000043` 不创建文件。迁移 provider 已递归发现 `knowledge-modeling`，无需改中央注册。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-00 | `packages/contracts/src/ports/index.ts` 的 `KnowledgeRetrievalQueryV1Schema`、`KnowledgeModelingPortV1.retrieve`；前置公共 `DomainEventV1`；C17 `IdentificationKnowledgeReleaseReaderV1.readExact` | 直接导入公共查询/结果/事件和 C17 reader；仅实现 `hybrid-evidence` 分支 | 不复制公共 DTO、能力映射、事件或 C17 发布包 Schema |
| IP-01 | `packages/core/src/model/index.ts` 的 `ModelGatewayPortV1.embed` 与模型错误映射；`packages/core/src/artifacts/store.ts` 的 `ArtifactStoreV1` | 核心 Schema 引用既有 versioned/artifact refs；服务直接依赖已有端口 | 不复制 Embedding 请求/响应、模型部署事实或 artifact manifest |
| IP-02 | `packages/core/src/persistence/{transaction,idempotent-consumer,schema}.ts`；`packages/core/src/access/authorization.ts` | 复用 `TransactionUnitV1`、`IdempotentConsumerV1`、`AtomicCommandV1`、授权上下文；核心只补检索状态/对账规则 | 不创建第二事务协议、幂等收据或权限枚举 |
| IP-03 | `packages/adapters/src/postgres/{pool,transaction-unit,idempotent-consumer}.ts` 与本域 adapter 的 `PostgresDatabase & DomainDatabase` 范式 | `PostgresRetrievalAdapter` 组合 C03，并以局部 Kysely 类型读写 C20 表 | 不改 C03 表、公共 `PostgresDatabase` 或实现第二 Outbox/consumer receipt |
| IP-04 | Node 24 `fetch`、`AbortSignal.timeout`、现有 Zod；C05 `LlamaCppModelGateway.embed` 由端口注入 | 最小 Qdrant REST adapter；严格解析 create/upsert/query/inspect/delete 边界 | 不加 Qdrant SDK、不在 adapter 实现业务默认策略或备用内存索引 |
| IP-05 | C03 `PostgresIdempotentConsumer.consume`；C17 reader；C05 embed | Worker projection handler 按 D5 顺序组合，不读取任何私表 | 不复制 C17 规范化/授权、C05 重试或 C03 消费状态机 |
| IP-06 | 公共 `KnowledgeModelingPortV1.retrieve`、C17 `PostgresIdentificationKnowledgeAdapter.retrieve`、`PostgresIdentificationKnowledgeCompositionOptionsV1`；C04 store | 按 D13 在 C17 门面和组合根补齐可选 `retrievalDelegate`；`HybridRetrievalService.retrieve` 返回公共 `knowledgeQueryResultRef`，完整结果保存 C04 | 不新增 API/Web DTO，不把 Qdrant payload 当结果事实，不复制检索授权或错误映射 |
| IP-07 | `packages/adapters/test/postgres/fixture.ts`、既有 PostgreSQL Testcontainers fixture、C05 adapter fixture | 复用真实容器生命周期、数据库 bootstrap/migration 和 adapter 失败注入方式 | 不复制容器框架，不使用 Qdrant 协议 Mock 证明 adapter |
| IP-08 | 根 scripts：`typecheck`、`deps:check`、`deps:policy`、`openspec:validate` | 运行已核实命令并调用独立 `openspec-verify-change` 验收 | 不新增中央测试清单或自定义 verify wrapper |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-00 | 前置契约、C17 发件与依赖检查点 | “已发布检索证据库事件是投影的唯一入口”的全部场景；依赖可行性 | **主调度提供**公共事件、C17 发布/reader 检查点及根 `package.json`、`pnpm-lock.yaml`、依赖政策、`packages/core/package.json`、`packages/adapters/package.json` 的机械前置；C20 只读核验 | 证明事件与发布同一 C03 事务、事件 Schema 与 C17 reader 可导入；固定服务/依赖版本、许可证、来源、离线方式和退出条件；增加 `./retrieval` package exports | C20 不编辑公共 contracts、C17 发布文件或依赖文件；C17 检索 delegate 归 IP-06，不由主调度代改 |
| IP-01 | 契约夹具与核心严格 Schema | 不可变代际、双成员、策略、结果解释、质量门禁、外部失败相关场景 | **新增** `packages/core/src/retrieval/schema.ts`：D2/D3/D5/D9/D11 全部 Schema；**新增** `packages/core/src/retrieval/ports.ts`：三个必要端口；**新增** `packages/core/src/retrieval/index.ts` 导出；**新增** `packages/core/test/retrieval/retrieval.test.ts` 的 parse/拒绝表 | 定义 strict、判别、有限数值、资源上限、稳定引用和错误码；测试未知字段、非法参数、跨版本、敏感字段禁入、排序分值非置信度 | 不增加公共 contracts 字段、私有兼容 Schema、通用搜索框架或完整文案断言 |
| IP-02 | 核心身份、状态、对账、融合解释和门禁 | “一个发布组合对应一个不可变双索引代际”“每个合格成员必须同时存在稠密与 BM25 表示”“旁路构建完成后才原子切换活动代际”“混合查询必须独立召回双路并按版本化 RRF 融合”“质量、性能和权限门禁必须独立通过”的全部场景 | **新增** `packages/core/src/retrieval/service.ts`：`deriveRetrievalGenerationRef`、`deriveRetrievalMemberRef`、`assertGenerationTransition`、`reconcileDualIndexManifest`、`reconcileRrfResult`、`evaluateRetrievalAcceptance`、`HybridRetrievalService`；**扩展** IP-01 测试 | SHA-256 规范身份；状态机和切换前置；集合/版本/权限逐项对账；按策略复验 RRF 每路贡献；每个硬门独立判定；服务以依赖端口编排查询 | 不重做 C05 Embedding、C17 发布校验或第二套融合排序；不允许单路/旧代际 fallback |
| IP-03 | PostgreSQL migration 与持久化 adapter | 重复事件、原子切换、查询幂等、结果持久化失败、进程重启场景 | **新增** `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.ts`：`up/down`；**新增** `packages/adapters/src/retrieval/postgres-retrieval-adapter.ts`：`PostgresRetrievalAdapter`、局部 row/DB types；**新增** `packages/adapters/src/retrieval/index.ts` 导出；**新增** `packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts`；复用 `packages/adapters/test/retrieval/fixture.ts` | 创建 D8 四类表、唯一/外键/check/index/RLS-compatible grants；实现 ensure building、append transition、serializable advisory-lock activation、active exact read、结果登记与 idempotency；事务失败无半正式记录；验证 up/down/up | 不改 migration provider/C03 表/中央清单；不在 JSON 保存正文或替代索引键；生产数据不可直接 down |
| IP-04 | Qdrant REST adapter | 双索引成员、RRF、缺一路、可删除重建、外部错误和 p95 场景 | **新增** `packages/adapters/src/retrieval/qdrant-rest-client.ts`：`QdrantRetrievalProjection` 及私有 strict REST Schemas；**新增** `packages/adapters/test/retrieval/qdrant-retrieval-adapter.test.ts`；复用 IP-03 `index.ts`/fixture | 以 native fetch 实现确定性 collection create、双向量批量 upsert、双 prefetch+RRF query、分页 inspect、exact delete；超时/HTTP/Schema/代际或路线缺失映射 D9 错误；只写 D4 最小 payload | 不存正文/片段/授权名单；不加 SDK、Mock 验收、单路 fallback、隐式默认配置或 Qdrant alias 事实 |
| IP-05 | Outbox projection Worker | 事件入口、三类发布同代际、旁路 ready/切换、构建失败、重复与重启全部场景 | **新增** `apps/worker/src/retrieval/projection-handler.ts`：`VersionedHybridRetrievalProjectionHandler.handle`；**新增** `apps/worker/src/retrieval/composition.ts`：`createHybridRetrievalProjectionComposition`；**新增** `apps/worker/src/retrieval/index.ts`；**修改** `apps/worker/src/index.ts` 增加导出；**新增** `apps/worker/test/retrieval/projection-handler.test.ts`、`composition.test.ts` | 按 D1/D5 六步执行；直接导入公共事件 Schema，C17 exact read，C05 分批 embed，Qdrant 幂等续作，manifest/质量门禁，C03 serializable ready+activation+audit+receipt；受控 AbortSignal 与资源上限 | 不启动常驻服务器、不扫描 C17、不私建 queue/checkpoint、不修改 C17 发布/reader 逻辑或 C03/C05；非目标事件明确忽略而非误消费 |
| IP-06 | 公共混合查询、C17 委派与受保护结果 | “查询必须精确绑定输入并在当前权限下回查事实”的全部场景，含“既有知识端口透传已注入的混合检索”；“查询结果必须保留可重放解释且区分排序分值与置信度”“外部失败不得产生半正式状态”的查询场景 | **完成** `packages/core/src/retrieval/service.ts` 的 `HybridRetrievalService.retrieve`；**完成** `packages/adapters/src/retrieval/postgres-retrieval-adapter.ts` 的结果登记/读取；**新增** `packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts`；**修改** `apps/worker/src/retrieval/composition.ts` 提供查询 delegate；**修改** `apps/worker/test/retrieval/composition.test.ts` 验证注入链；**修改** `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts` 的选项、私有 delegate 与 `retrieve()`；**修改** `apps/worker/src/identification-knowledge/composition.ts` 的可选注入；**修改** `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts` 的两条边界 | D6 顺序完成查询；D13 定义 `retrievalDelegate?: Pick<KnowledgeModelingPortV1, "retrieve">`，C20 composition 提供、调用方交给 C17 composition 原样注入；未注入保留 `UNSUPPORTED_CONTRACT`，已注入同一查询一次转发、成功/失败对象原样返回；C17 adapter 测试在现有文件内直接构造带/不带 delegate 的门面，C20 Worker composition 测试注入链；同 queryId 同摘要回放、异摘要冲突 | 不在 C17 解析、授权、重试、持久化或改写错误；不返回正文或内部失败细节到公共 DTO；不得将排序分值改名为置信度或接入 P/C/矩阵 |
| IP-07 | 固定真实验收、全删重建和回归夹具 | “Qdrant 投影必须可删除并从事实重建”“质量、性能和权限门禁必须独立通过”全部场景，以及 adapter 端到端失败边界 | **新增** `packages/adapters/test/retrieval/fixture.ts`、`fixture-contract.test.ts`；**新增** `packages/adapters/test/retrieval/fixtures/synthetic-hybrid-retrieval.v1.json`、`acceptance-policy.v1.json`；**新增** `packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts` | 先以 IP-01 Schema 验证夹具契约；再用真实 Qdrant 1.19.0（Testcontainers 或同版本 endpoint）+ PostgreSQL+C04+C05 test double at port boundary，检查 D11 阈值、0 泄露、配置/成员 parity、全部 collection 删除、合法事件重放与排名等价；输出环境/边界报告 | C05 Llama 服务不在此验收启动，固定 query/document vectors 只替代模型端口且不冒充 Qdrant；不跳过 Qdrant、不以融合均值掩盖硬门 |
| IP-08 | 最小验证、所有权检查与独立 OpenSpec verify | 全部 Requirement/Scenario 与 D1～D13 | **不新增生产文件**；检查本表全量文件、受保护路径和 git diff；执行第 6 节 V-01～V-09；最后调用 `openspec-verify-change` | 确认 D13 三文件以外的 C17 内容未改、所有场景可观察证据齐备、tasks 仅在行为和证据完成后勾选 | 不提交、不归档、不启动开发服务器；验证失败不得勾选对应 task |

## 4. 调用与副作用顺序

### 4.1 发布投影（IP-03、IP-04、IP-05）

1. Worker composition 把公共 Outbox 事件交给版本化 handler；非 `knowledge.identification-basis-published.v1` 事件返回 ignored，不写 C20 状态。
2. Handler 严格解析受支持事件版本和项目/审计/因果引用，再调用 `IdempotentConsumerV1.consume`。已 completed 的同事件直接返回既有 receipt；同 eventId 异 payload 由 C03 幂等冲突拒绝。
3. consumer handler 以稳定身份 `ensureBuilding`；同身份字段不一致返回 `SOURCE_FACT_DRIFT`。随后以 project-scoped Worker 授权调用 C17 `readExact`，核对 event、release binding、三类发布和权限摘要。
4. 核心按 source kind/release/entry/content digest 排序并规范化成员，检查重复、空内容、单项/总字节、成员数、批次和墙钟预算。失败追加失败审计，C03 transaction 回滚正式 ready/activation。
5. 每批调用 C05 `embed`，请求绑定 policy/model deployment/input digest；检查模型部署、返回数量、维度、有限数值。模型失败保留其 durable diagnostic ref，只记录不含正文的 C20 failure。
6. Qdrant adapter create collection；已存在则 inspect 配置并要求完全相等。批量 point upsert 同时包含 dense 和 `qdrant/bm25` document，point identity 不变；超时可重投续作。
7. adapter 分页 inspect point count、双向量存在性及最小 payload；核心与 C17/PostgreSQL 预期 manifest 逐项对账。任一路、版本、权限、内容摘要差异均失败，collection 保持不可查询。
8. 用固定验收策略执行双路/RRF/权限/性能门禁。全部通过后，在一个 serializable PG 事务中加 project/evidence-series advisory lock，复读 current activation，追加 ready、activation、superseded audit 和 completed consumer receipt。compare-and-swap 失配返回可重试 `ACTIVATION_CONFLICT`，不得覆盖胜出者。
9. PG 回滚而 Qdrant 已写时，至少一次重投从步骤 2 开始，按稳定 generation/point inspect 后只补缺项；不删除其他 generation，不返回半成品。

### 4.2 混合查询（IP-02、IP-03、IP-04、IP-06）

1. C17 façade 按 D13 将注入时收到的原查询直接交给 C20 delegate；未注入时保留原有 `UNSUPPORTED_CONTRACT`。`HybridRetrievalService.retrieve` 只处理公共 `hybrid-evidence` 分支，其他分支由所注入实现按既有公共结果契约处理；先严格解析并校验 capability、project、actor、空间/资料 authorization。
2. input reader 按三个公共引用返回冻结 query input、required evidence release、published policy 和 current authorization scope digest；引用/工程/版本任一漂移立即失败。
3. PG adapter 精确读取与 release+policy+authorization digest 匹配的 active、ready generation；无匹配时 `GENERATION_NOT_READY`，不借用旧发布或单路。
4. C05 生成 query dense vector并核对固定部署/维度；Qdrant 在该 generation collection 中，以 project/generation/scope payload filter 发出 dense 和 bm25 两个 prefetch，服务端按策略 RRF。
5. adapter 要求双路响应、代际和关键字段完整；核心复验每路 rank、权重贡献、`k` 和最终顺序。缺一路/不一致直接失败。
6. 按稳定 member ref 通过 C17 reader 回查已发布事实，重新验证 project、source release、content digest 和当前权限；任一失败拒绝整次结果，不生成可观察的部分 hit。
7. 完整 `HybridRetrievalResultV1` 写入 C04；随后 `TransactionUnitV1.execute` 以 `{projectId, queryId}` 登记 request digest、generation、policy、artifact/public result refs 和审计。PG 失败时不返回 ref，孤儿 C04 工件沿 C04 维护机制回收。
8. 成功后只映射到公共 `KnowledgeRetrievalResultV1`；重复同载荷返回原 ref，冲突载荷返回 `IDEMPOTENCY_CONFLICT`。日志/错误不携带 query 或知识正文。

### 4.3 删除与重建（IP-04、IP-05、IP-07）

1. 精确删除接口只接受 generation ref，经运维授权和 PG 引用检查后删除对应 collection；“删除全部”验收枚举 C20 命名前缀后逐一传精确 ref，不使用宽泛删除。
2. 重建必须提交 C03 保留且可验证的原发布事件；从未收到或不兼容事件拒绝。既有合法事件按 4.1 重放，稳定身份得到相同 manifest；重建动作追加新审计。
3. 固定 query fixture 比较成员 identity/config digest 与等价 Top-K 顺序，而不锁定浮点打印格式。重建未通过全部 ready 门不得恢复查询。

## 5. Schema、状态与持久化落实

### 5.1 Schema 与版本

- IP-01 的所有结构使用 `z.strictObject`/discriminated union 和推导类型；引用直接组合 contracts、C17、C04/C05 Schema。Qdrant wire Schema 留在 IP-04 adapter 内，不泄漏为领域 API。
- `HybridRetrievalPolicyV1`、generation/member identity 与 acceptance policy 均显式 `schemaVersion: "1"`；无隐式默认。规范 JSON key/order、UTF-8、SHA-256 使用现有平台/Node 实现。
- 正式结果仅由一个 `HybridRetrievalResultV1Schema` 生成；PG 只存其 C04 ref 和查询/代际键，Qdrant 只存最小 payload，避免第二事实源。

### 5.2 状态、事务、幂等与审计

- 核心允许转换仅为 D5；`failed`、`superseded` 终止，历史行不 update/delete。current activation 为每 series 最大 ordinal，并受 serializable+advisory lock 保护。
- 事件幂等由 C03 consumer receipt 与稳定 generation/point 双层保证；查询幂等由 PG `(project_id, query_id)` 唯一约束和 request digest 保证。
- ready、activation、superseded audit 与 consumer completion 同一 PG 事务；query result row 与 audit 同一 PG 事务。Qdrant 外部副作用不能事务回滚，所以只以 PG ready/activation 暴露，并靠稳定身份重试收口。
- 所有 failure/observation 按 D9 记录引用、阶段、耗时、计数、retryable 和 diagnostic ref；正文、片段、query 原文、授权名单禁止进入日志/错误。

### 5.3 数据库与权限

- IP-03 migration 创建 D8 四表；身份唯一约束、ordinal/status check、generation/previous FK、result artifact/ref 非空、project+release+policy 查询 index 必须由数据库保证。
- app role 只读 active generation/result metadata；worker role 可 insert generation/transition/activation/result，历史 update/delete 默认拒绝；migration role 管 DDL。Qdrant collection 凭证仅 Worker/adapter composition 获得，不暴露给 Web/浏览器。
- query 和 projection 都先执行 C06 当前授权，再调用 C17 reader；payload filter 只是边界收窄。测试用权限 revision 变化证明 build 后撤权仍封闭失败。

### 5.4 外部版本和预算

- Qdrant image、Testcontainers 精确版本、许可证、来源、离线方式、退出条件以 D10 和 IP-00 为准；REST adapter 启动时查询 service version/capabilities，不兼容即 `POLICY_INCOMPATIBLE`。
- batch/member/text/timeout/topK/prefetch 限制来自策略；AbortSignal 同时传给 C05 与 Qdrant。预算耗尽不可自动增配、换模型或降级。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 已发布检索证据库事件是投影的唯一入口：合法事件、重复投递、缺失/不兼容 | IP-00、IP-05 | `apps/worker/test/retrieval/projection-handler.test.ts`；前置 contracts/C17 tests | 归档事件 fixture、重复 event、坏版本/坏 binding | 唯一 generation；completed replay；坏事件零 Qdrant/零 activation；无私表扫描 | V-04、V-05 |
| 一个发布组合对应一个不可变双索引代际：三类同代、输入变化新代 | IP-01、IP-02、IP-05 | core retrieval test、projection handler test | 三类发布包；策略/模型/发布变体 | 稳定成员可追溯；任一 identity input 变化产生新 generation；旧代际不变 | V-01、V-04 |
| 每个合格成员必须同时存在稠密与 BM25 表示：完全对账、缺路、权限/版本差异 | IP-02、IP-04、IP-07 | core retrieval test、Qdrant adapter/acceptance test | 孤点、缺 vector、错误 digest/version/scope | 100% parity 才 ready；每个差异有结构化 code；Qdrant 从不成为事实 | V-01、V-03、V-06 |
| 旁路构建完成后才原子切换活动代际：成功、失败保旧、并发冲突 | IP-02、IP-03、IP-05 | PG adapter test、projection handler test | 两个并发 activation、构建失败、旧 active | 一次 CAS 胜出；旧发布仍精确可用；新发布不借旧；失败零半状态 | V-02、V-04 |
| 混合查询必须独立召回双路并按版本化 RRF 融合：同策略、不同策略、缺一路 | IP-01、IP-02、IP-04、IP-06 | core retrieval、Qdrant adapter、hybrid service tests | 两个 policy 版本、固定双路 ranks、故障路线 | RRF contribution/Top-K 可复验；结果绑定 policy；缺一路无 result ref | V-01、V-03、V-05 |
| 查询必须精确绑定输入并在当前权限下回查事实：有权、C17 委派、无权、引用漂移 | IP-03、IP-06、IP-07 | hybrid service/acceptance tests；C17 adapter test；C20 Worker composition test | 当前授权/撤权、跨工程干扰 hit、漂移 refs；未注入与注入的 success/failure delegate | 只返回回查事实；C17 未注入时保留既有错误，注入后同一查询与结果对象原样透传；撤权/跨工程整次拒绝且不泄露 | V-05、V-06、V-07 |
| 查询结果必须保留可重放解释且区分排序分值与置信度：解释、queryId 冲突、非 P/C | IP-01、IP-03、IP-06 | core retrieval、PG adapter、hybrid service tests | 固定 query/result；同键异载荷 | C04 result 包含全链引用/双路贡献；PG 原值不覆盖；Schema 无 confidence/P/C/matrix | V-01、V-02、V-05 |
| Qdrant 投影必须可删除并从事实重建：全删重建、等价对账、坏事件拒绝 | IP-04、IP-05、IP-07 | Qdrant adapter/acceptance tests | 已保存合法事件；删除全部 collection；缺失/篡改事件 | 全删后仅凭 PG/C17/C04/policy/event 恢复；identity/config/rank 等价；坏事件零重建 | V-03、V-06 |
| 质量、性能和权限门禁必须独立通过：全通过、单项失败、合成标记 | IP-02、IP-07 | core retrieval、acceptance test | 两个 JSON fixtures；真实 Qdrant 1.19.0 | D11 每项阈值独立；任一 fail 使 overall fail；报告含合成标记、环境、p95 边界 | V-01、V-06 |
| 外部失败不得产生半正式状态：构建失败、结果持久化失败、重启 | IP-03、IP-04、IP-05、IP-06 | PG/Qdrant/Worker/hybrid service tests | fetch abort/非法响应、PG failpoint、部分 points | 错误结构稳定且无正文；零 ready/ref；重投补齐同 generation 而非复制 | V-02、V-03、V-04、V-05 |
| 迁移、依赖、边界与全部既有调用方回归 | IP-00、IP-03、IP-06、IP-08 | PG adapter test；C03/C04/C05/contracts/C17 existing tests；C20 Worker composition test | 前置检查点与真实 PostgreSQL | 000040 up/down/up；公共查询/模型/工件/Outbox/C17 reader 无回归；仅 D13 三个 C17 文件变化 | V-02、V-07、V-08、V-09 |

核实存在的命令：

- **V-01 核心**：`pnpm exec vitest run packages/core/test/retrieval/retrieval.test.ts`
- **V-02 PostgreSQL**：`pnpm exec vitest run packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts`
- **V-03 Qdrant adapter**：`pnpm exec vitest run packages/adapters/test/retrieval/qdrant-retrieval-adapter.test.ts --testTimeout=120000`
- **V-04 Worker**：`pnpm exec vitest run apps/worker/test/retrieval`
- **V-05 查询服务**：`pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts`
- **V-06 真实验收**：`pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts --testTimeout=180000`；默认启动固定 Testcontainers，设置 `RISKFLOW_QDRANT_URL` 时连接同版本真实 endpoint。
- **V-07 直接回归与委派接缝**：`pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/model.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/test/retrieval/composition.test.ts`
- **V-08 类型、静态、格式与依赖**：`pnpm typecheck && pnpm exec eslint packages/core/src/retrieval packages/core/test/retrieval packages/adapters/src/retrieval packages/adapters/test/retrieval packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/src/retrieval apps/worker/test/retrieval apps/worker/src/identification-knowledge/composition.ts apps/worker/src/index.ts && pnpm exec prettier --check packages/core/src/retrieval packages/core/test/retrieval packages/adapters/src/retrieval packages/adapters/test/retrieval packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts apps/worker/src/retrieval apps/worker/test/retrieval apps/worker/src/identification-knowledge/composition.ts apps/worker/src/index.ts openspec/changes/deliver-versioned-dual-index-hybrid-retrieval && pnpm deps:check && pnpm deps:policy`
- **V-09 OpenSpec**：`openspec validate deliver-versioned-dual-index-hybrid-retrieval --type change --strict --no-interactive`，随后由独立验证 Agent 使用 `openspec-verify-change` 对批准工件、代码和 V-01～V-08 证据验收。

`openspec`、`validate --type/--strict/--no-interactive`、Vitest filters/`--testTimeout`、TypeScript build、ESLint、Prettier 及根 scripts 均已在规划 worktree 核实存在。V-07 的 C17 adapter 测试与 C20 Worker composition 测试路径已在本次输入 HEAD 核实；后续检查点若改变路径，先升级而不是静默删去回归。

## 7. 文件清单与升级条件

### 7.1 C20 实现 Agent 文件 allowlist

**新增（IP-01、IP-02）**

- `packages/core/src/retrieval/schema.ts`
- `packages/core/src/retrieval/ports.ts`
- `packages/core/src/retrieval/service.ts`
- `packages/core/src/retrieval/index.ts`
- `packages/core/test/retrieval/retrieval.test.ts`

**新增（IP-03、IP-04、IP-06、IP-07）**

- `packages/adapters/src/retrieval/postgres-retrieval-adapter.ts`
- `packages/adapters/src/retrieval/qdrant-rest-client.ts`
- `packages/adapters/src/retrieval/index.ts`
- `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.ts`
- `packages/adapters/test/retrieval/fixture.ts`
- `packages/adapters/test/retrieval/fixture-contract.test.ts`
- `packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts`
- `packages/adapters/test/retrieval/qdrant-retrieval-adapter.test.ts`
- `packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts`
- `packages/adapters/test/retrieval/hybrid-retrieval-acceptance.test.ts`
- `packages/adapters/test/retrieval/fixtures/synthetic-hybrid-retrieval.v1.json`
- `packages/adapters/test/retrieval/fixtures/acceptance-policy.v1.json`

**新增/修改（IP-05）**

- `apps/worker/src/retrieval/projection-handler.ts`
- `apps/worker/src/retrieval/composition.ts`
- `apps/worker/src/retrieval/index.ts`
- `apps/worker/test/retrieval/projection-handler.test.ts`
- `apps/worker/test/retrieval/composition.test.ts`
- `apps/worker/src/index.ts`（只增加 retrieval export）

**仅 D13 检索委派接缝（IP-06，已批准 C17 侧）**

- `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`（只增加可选 `retrievalDelegate` 选项、保存引用并在 `retrieve()` 原样委派；缺省行为不变）
- `apps/worker/src/identification-knowledge/composition.ts`（只声明并注入同名可选 delegate，不加入必需依赖检查）
- `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`（只覆盖已注入逐对象成功/失败透传和未注入 `UNSUPPORTED_CONTRACT`）

**规划与任务证据（IP-08）**

- `openspec/changes/deliver-versioned-dual-index-hybrid-retrieval/{proposal.md,design.md,implementation-plan.md,tasks.md}`
- `openspec/changes/deliver-versioned-dual-index-hybrid-retrieval/specs/identification/versioned-dual-index-hybrid-retrieval/spec.md`

不删除任何文件。主调度只提供公共事件、C17 已归档发布/reader、package exports、依赖及锁文件等机械前置检查点；C20 实现者消费检查点，并在上述三个已批准文件内自己完成 C17 检索委派。除这三个文件外，C17/C18/C19 生产及测试文件不在 allowlist。

### 7.2 必须 ask/escalation 的条件

- 前置公共事件未归档、C17 未在发布事务发件、事件与 C17 `releaseBinding` 不能精确对账，或需要 C20 修改 contracts/三个获批接缝文件以外的 C17 文件。
- 合并前置检查点后，批准的公共 Schema、C17 reader、C03/C04/C05 端口、包导出或文件路径与本计划发生实质 drift。
- Qdrant 固定 image/API、Testcontainers 版本、许可证、官方/离线来源或 Node/Docker 兼容性与 D10 不符；需要安装、改 manifest/锁文件/依赖政策。
- 实现需要 `000041`～`000043`、改中央 migration provider、增加/修改公共接口、事务边界、依赖、API/Web、自动 GC、第二队列或计划外生产文件。
- 真实 Qdrant 双路/RRF、权限、删除重建、质量或 p95 门禁无法通过；不得以 Mock、单路、旧代际、降低硬门或跳过测试收口。
- 工作区出现与本 change 重叠的用户未提交改动，或任一核实命令在合并后不存在/含义变化。

## 8. Finalizer 授权与限定审计

Finalizer 可在第 7.1 节文件 allowlist 内修复本 change 的实现与测试，包括 D13 三个接缝文件及其 C20 组合测试；以 D1～D13、全部 Requirement/Scenario 和 V-01～V-09 的实际运行结果为核验依据。公共 contracts、授权语义、事务/持久化边界、依赖、迁移号段或三个接缝文件以外的 C17 变更仍须升级。权限、事务、代际关键状态机及语义 merge 冲突触发同一收尾轮次的一次限定审计，结论写入 verification。
