## Why

RiskFlow 已能审核发布检索证据库并调用统一 Embedding 网关，但尚不能把精确发布内容可靠投影为可切换、可重建的双索引，也不能在当前授权下返回可对账的混合检索结果。C20 需要在 C21 识别检索审阅前闭合 RI-S53 的 Qdrant 稠密向量、BM25 与版本化融合链路，并保证任一路缺失、版本或权限不一致时封闭失败。

## What Changes

- 新增版本化混合检索能力：同一检索证据库发布的每个合格成员在 Qdrant 代际集合中同时拥有 C05 生成的稠密向量和 Qdrant `qdrant/bm25` 多语言稀疏向量；成员身份、来源发布、内容摘要、Embedding 部署/维度、BM25 配置和权限摘要可逐项对账。
- 消费前置契约演进 `knowledge.identification-basis-published.v1` 及 C17 发布路径写入的 C03 Outbox 事件，以至少一次、幂等方式旁路构建新代际；完成双索引、PG 事实、版本和权限对账后才标记 ready 并原子切换活动代际，旧代际保留到受控回收。
- 使用版本化检索策略驱动稠密/BM25 召回上限、RRF `k`/双路权重、Top-K、BM25 多语言分词配置和资源限制；策略缺失、不兼容或任一路失败时不返回单路或历史结果。
- 通过 C02 已冻结的 `KnowledgeModelingPortV1.retrieve(hybrid-evidence)` 返回内容寻址的查询结果引用；Qdrant 只保存最小投影载荷，命中后必须按精确成员引用回查 PostgreSQL/C17 窄读接口并复验当前工程、空间和资料权限，正文与证据事实不以 Qdrant 为准。
- 提供删除全部 Qdrant 检索集合后由 C17/C04/PostgreSQL 事实与已保存发布事件重建的验收路径，以及双路质量、融合质量和 Qdrant 查询 p95 的显式门槛；甲方样例未到位时使用标明“合成样本、待甲方复核”的固定夹具。
- 不实现 C21 的关系上下文、检索 Agent 审阅或补搜，不实现 C22 风险候选、P/C、矩阵或任何 Web/API 新入口；公共 contracts、C17/C18/C19 的其他生产逻辑和主 specs 保持原有边界。C20 仅补齐 C17 已批准的 `retrieve()` 可选检索委派接缝。

## Capabilities

### New Capabilities

- `identification/versioned-dual-index-hybrid-retrieval`: 规定 Outbox 驱动的不可变 Qdrant 双索引代际、旁路构建与切换、版本化 RRF、PG 回查授权、可删除重建和质量/性能门禁。

### Modified Capabilities

无。

## Impact

- **重开规划批准**：[C17 检索委派接缝批准记录](./approval-2026-09-21-c17-retrieval-delegate.md) 限定 C20 可修改的三个 C17 侧文件及原样转发语义；施工归属见 IP-06。
- **前置依赖**：直接复用已归档 C03 `platform/postgresql-outbox-checkpoint-foundation`、C05 `platform/llamacpp-model-gateway`、`evolve-identification-basis-published-event` 和 C17 的 `IdentificationKnowledgeReleaseReaderV1.readExact` 与同事务发件；C20 不代发事件、不轮询 C17 私表、不新建第二套队列。
- **计划代码**：新增 `packages/core/src/retrieval/`、`packages/adapters/src/retrieval/`、`apps/worker/src/retrieval/` 及对应测试；新增自动发现的 `knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.ts`，`000041`～`000043` 保持未占用。C20 另仅修改 C17 façade、Worker 组合根和现有 adapter 测试三个获批文件，完成可选检索委派；主调度负责 core/adapters 的 `./retrieval` package export、测试依赖声明等机械前置，Worker 根导出由 C20 添加；不新增 API/Web 文件。
- **Qdrant 服务依赖**：固定 `qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`（Apache-2.0），用于 named dense vector、带 IDF 的 server-side `qdrant/bm25`、多语言 tokenizer 和带可配置 `k`/权重的 RRF Query API；官方来源为 `https://github.com/qdrant/qdrant/releases/tag/v1.19.0` 与 `https://hub.docker.com/r/qdrant/qdrant`。离线部署从批准的 OCI tar 以 `docker load` 导入或从内网 registry 拉取并按 digest 校验；若该固定服务缺少上述 API、离线制品或安全部署能力，停止实现并重新选型，不以自写单路/内存索引回退。
- **npm 测试依赖**：由主调度 Agent将已在锁文件中作为传递包存在的 `testcontainers@12.1.0`（MIT，Node `>=22.22`）提升为根开发直接依赖，用于启动真实固定 Qdrant 容器；官方来源为 `https://www.npmjs.com/package/testcontainers` 与 `https://node.testcontainers.org/`，离线使用内网 npm 镜像或预热 `pnpm fetch` store。若容器运行时不可用但可提供同版本真实 Qdrant endpoint，则同一验收套件改连该 endpoint；两者均不可用时外部 adapter 验收不能完成，禁止用协议 Mock 冒充。
- **依赖可行性证据**：本机 Docker Engine `29.7.2` 客户端/服务端可达，远端 OCI manifest 已解析出固定多架构 digest（amd64 `sha256:6c0652…`、arm64 `sha256:139bb…`），本机当前未缓存该镜像且本任务未拉取；仓库已有 `@testcontainers/postgresql@12.1.0` 的真实容器 fixture 范式。生产侧使用 Node 24 原生 `fetch` 和现有 Zod 校验 Qdrant REST，不新增 `@qdrant/js-client-rest`。
- **所有权与追踪**：C20 独占 qdrant/retrieval 投影和检索实现，覆盖 RI-S53～RI-S56 的证据召回接缝；关系上下文和 Agent 选择归 C21，风险候选及置信度归 C22，P/C 与矩阵仍由后续确定性评估模块执行。
