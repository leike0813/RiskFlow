# Implementation Plan

## 1. 实施基线与权威来源

- 固定 HEAD `6ffe9d5879fd6ec9ba252a79aa843c430158abf4`；只读取 `references/风险识别与评估规划事实源摘要.md`，不读取原始研究材料。事实源为本 change 的 [spec](./specs/identification/relationship-context-and-retrieval-agent-review/spec.md)、[design](./design.md)、已归档 C02/C08/C17/C20 主规格和当前代码。涉及 RI-S53～RI-S56；不把 C24/I0～I9 或 C22/RI-S57 的实现提前纳入。
- 前置检查：C17 `PostgresIdentificationKnowledgeAdapter.retrieve/readExact` 仍有原样 `retrievalDelegate`；C20 `HybridRetrievalService.retrieve` 只支持 hybrid，`PostgresRetrievalAdapter.readQueryResult` 可按精确查询查正式行；C08 `AgentTaskDefinitionRegistry` 和 `buildCompletedAgentTaskResult` 可注册/收口 `retrieval-review`。若任一前置相对 HEAD 漂移，停止并升级。
- 主调度已在本树将 `./identification/context` export 加入 core/adapters 的 package manifests，这两个既有 dirty paths 属主调度机械前置，不由本任务编辑或提交。`000041` 是 C21 自有迁移；中央清单由主调度登记。无需新依赖。
- 命令代号：V-01 `pnpm exec vitest run packages/core/test/identification/context.test.ts`；V-02 `pnpm exec vitest run packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`；V-03 `pnpm exec vitest run apps/worker/test/identification/context/composition.test.ts apps/worker/test/identification/context/runtime.test.ts`；V-04 `pnpm exec vitest run packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts apps/worker/test/retrieval/composition.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/core/test/agent-runtime/agent-runtime.test.ts`；V-05 `pnpm exec tsc -b packages/core packages/adapters && pnpm typecheck && pnpm deps:check`；V-06 `pnpm exec eslint packages/core/src/identification/context packages/core/test/identification/context.test.ts packages/adapters/src/identification/context packages/adapters/test/identification/context apps/worker/src/identification/context apps/worker/test/identification/context apps/worker/src/index.ts && pnpm exec prettier --check openspec/changes/deliver-relationship-context-and-retrieval-agent-review packages/core/src/identification/context packages/core/test/identification/context.test.ts packages/adapters/src/identification/context packages/adapters/test/identification/context apps/worker/src/identification/context apps/worker/test/identification/context apps/worker/src/index.ts`；V-07 `openspec validate deliver-relationship-context-and-retrieval-agent-review --type change --strict --no-interactive`。V-01～V-06 仅在计划代码/测试文件创建后运行；V-02 需要真实 PostgreSQL 容器，不得将关键 skip 当 PASS。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `KnowledgeRetrievalQueryV1Schema`、`KnowledgeQueryResultRefV1Schema`；`packages/contracts/src/workflows/index.ts` 的 `IdentificationInputSnapshotV1Schema` | 直接引用公共分支与冻结输入，C21 定义内部严格 DTO | 不重新定义 C02 端口、权限或图状态 |
| IP-02 | `packages/core/src/identification-knowledge/schema.ts` 的 `ProcessModelPackageV1Schema`、`RiskMechanismPackageV1Schema`、`IdentificationKnowledgeReleaseReaderV1`；`PostgresIdentificationKnowledgeAdapter.readExact` | 精确发布窄读并经 C06 为 `knowledge-modeling.identification-basis` 另签最小授权；一跳确定性关系 | 不读 C17 私表、Qdrant 成员载荷或默认知识 |
| IP-03 | C03 `TransactionUnitV1`、C04 `ArtifactStoreV1`；C20 `PostgresRetrievalAdapter.readQueryResult` 的只读/写事务模式及 `000040` 的审计 FK/权限模式 | 一表登记三类结果引用，事务原子审计，工件先耐久 | 不复制 C08 任务台账/C20 代际/知识正文 |
| IP-04 | `packages/core/src/retrieval/service.ts` 的 `HybridRetrievalService.retrieve`、`packages/core/src/retrieval/schema.ts` 的 `HybridRetrievalResultPayloadV1Schema`；`packages/core/src/retrieval/ports.ts` 的 `HybridRetrievalInputReaderV1` | 必经基线和每次补搜都调用正式 C20 分支，按实际持久化 payload 校验成员 | 不另实现 RRF、单路回退或第二索引 |
| IP-05 | `packages/core/src/agent-runtime/runtime.ts` 的 `AgentTaskDefinitionV1`、`AgentTaskDefinitionRegistry`、`buildCompletedAgentTaskResult`；`apps/worker/src/agent-runtime/runner.ts` | 在同一个 registry/runner 注册审阅动作、工具、增量、校验和结果族 | 不另建 C08 claim 循环、预算或存储 |
| IP-06 | `packages/contracts/src/ports/index.ts` 的 `ModelContextArtifactSetRefV1Schema`、`RetrievalArtifactSetRefV1Schema`；C17 已有 `retrievalDelegate` | 五项合格上下文给 C24/C22 精确引用，两个查询分支交同一注入位 | 不创建 I0～I9 图、模型风险候选 |
| IP-07 | `packages/adapters/test/retrieval/postgres-retrieval-fixture.ts`、`apps/worker/test/retrieval/composition.test.ts` 和 C08/C17/C20 已有行为测试 | 复用真实 PostgreSQL/工件/授权测试范式及已有接缝回归 | 不复制内部顺序/提示词快照测试 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 1.1 | 全部六项的输入/输出与错误形状 | `packages/core/src/identification/context/schema.ts`、`ports.ts`、`index.ts` | 新增 `RelationshipContextPayloadV1Schema`、`RetrievalReviewIncrementV1Schema`、`ReviewedRetrievalSetV1Schema`、`ModelContextPayloadV1Schema` 与最窄 `IdentificationContextInputReaderV1`、`IdentificationContextResultStoreV1`、C20 正式结果读取端口；严格派生类型，单一输出 schema | 公共 contracts、C20 结果 schema |
| IP-02 | 1.2 | 关系检索只读取同一识别输入的精确发布事实（成功、错配/撤权） | `packages/core/src/identification/context/service.ts` 的 `retrieveRelationship`、`readRelationshipFacts` | 按 D-02 先验 C06 retrieve 授权、C24 冻结输入窄读、C17 专用 read 授权/精确包，核对发布与一跳关系，失败同形 | C17 查询/发布实现、C06 策略 |
| IP-03 | 2.1～2.2 | 关系查询结果具有不可变身份和幂等审计（重放、冲突/回滚） | `packages/adapters/src/postgres/migrations/identification/deliver-relationship-context-and-retrieval-agent-review/000041_identification_context_results.ts`；`packages/adapters/src/identification/context/postgres-identification-context-adapter.ts`、`index.ts`；`service.ts` 的 `persistExact` | D-03 单表/约束/role/grant/up/down；C04 工件先行、C03 事务登记+审计，读复验授权；统一关系/审阅/上下文的 `(identity,digest)` 守卫 | 中央迁移清单、C20 表、其它角色授权 |
| IP-04 | 3.1 | 混合检索基线与有限补搜严格绑定（成功、任一路/预算失败） | `service.ts` 的 `retrieveBaseline`、`readOfficialHybrid`；`apps/worker/src/identification/context/composition.ts` 的 `retrieve` router | D-05 复用 C20 `retrieve` 与 PG/C04 已登记结果精确读取；稳定 queryId/文本冻结解析，补搜不换版本 | C20 service/projection、C17 façade |
| IP-05 | 3.2～3.3 | Agent 只能提交类型化检索选择增量（接受、越界/失效）；必经审阅失败和恢复不产生伪正式结果（失败、恢复） | `service.ts` 的 `createTaskDefinition`、`validateReviewIncrement`、`finalizeReview`；`apps/worker/src/identification/context/runtime.ts` 的 `renderReviewModelStep`、`interpretReviewModelStep`、`index.ts` | D-05/06 C08 两项白名单工具、预算/候选边界、逐项校验和同任务重放；结果 C04→C21 表→C08 completed，无第二 runner | C08 表、registry/claim 实现、公共 Agent 输出族 |
| IP-06 | 4.1 | RI-S56 上下文恰好保留五项依据与版本（完成、缺项） | `service.ts` 的 `assembleContext`；`composition.ts`、`apps/worker/src/index.ts` | D-07 只有 C08 completed + 三种已登记结果/权限一致时组装五项并保存 ref；`retrieve` router 的 hybrid 只委派 C20、relationship 只交 C21；输出供 C24 注入 | C17 生产文件、C24 图、C22 推理 |
| IP-07 | 1.1～4.2 | 上述全部正反场景 | `packages/core/test/identification/context.test.ts`；`packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`；`apps/worker/test/identification/context/{composition,runtime}.test.ts` | 冻结合成夹具标明“合成样本、待甲方复核”；核心/真实 PG/Worker 边界代表场景，无全量 fixture 框架 | 无新增依赖，关键测试不可 skip |

## 4. 调用与副作用顺序

1. `retrieve(relationship-context)`：C02 strict parse → 当前 C06 retrieve 能力/工程/范围 → C24 提供的必需精确输入 reader → C06 针对同 actor/工程签发收窄的 identification-basis read 上下文 → 将三项具体发布引用的精确 `reference` 包装为 C17 既有 `KnowledgeReleaseRefV1` 再调用 `readExact`，核对组合成员/资料段/引用/关系 → 当前授权再次复验 → C04 `put` → C03 `TransactionUnitV1` 同事务写 C21 row、收据、单条审计（零 Outbox）→ 公共 `knowledgeQueryResultRef`。读取失败时不探测其它工程发布；重试相同 `(projectId,queryId,digest)` 读原行并以当前授权检查后返回，异载荷不可重试冲突。
2. `review`：先拿 C20 正式基线 query ref，从其 `(projectId,queryId)` 行及 C04 受保护内容回读 `HybridRetrievalResultPayloadV1`；同一 registry 注册 `retrieval-review`，C08 固定输入、五类策略、工具和预算。工具 `read-frozen-result` 仅读已获准正式查询，`bounded-hybrid-resupplement` 用任务/动作稳定 queryId，有限附加文本按 C24 冻结查询来源解析并调用同一 C20 检索；C08 记录动作意图/资源/候选，C21 校验版本与证据后 C04 写集合及 C03 登记。只有 C08 completed 才把集合当正式引用；终态失败、效果不确定或权限撤销均不继续上下文。
3. `assembleContext`：按精确 row/C08 终态重读关系与审阅结果和 C17/C20 来源，校验五组均非空、授权仍有效、同工程/工作项/发布/策略且每条 `sourceSegmentId` 可达 → C04 保存五项不可变上下文 → C03 登记及审计 → 返回 `model-context-artifact-set`。没有受力边、机理或选中证据则失败，不以模型补充；C24 承担后续 I3/I4 路由。
4. 中途失败：工件失败前不得登记，C03 回滚则无正式 ref；重复投递同身份只收口未完成步骤；C20 已登记补搜按稳定 queryId 取回，不确定效果且无法核对时进入 C08 `AGENT_ACTION_UNCERTAIN`，不盲重试、不更改预算或模型。

## 5. Schema、状态与持久化落实

- D-01/02/06：所有输入、动作、结果和增量用 strict Zod + `z.infer`，引用来自 C02/C17/C20；一跳边保持原方向/关系类型，状态参数用共享词汇；C21 只消费 C08 已声明状态与结果族，禁止第二状态机。关系结果允许合法空受力边供诊断，但五项正式上下文必需非空受力组；工作项证据断裂与权限失败使用现有 `ModuleErrorV1`/`AgentStructuredErrorV1` 结构化码，不增公共错误枚举。
- D-03/04：`business.identification_context_results` 仅保存 `(project_id,result_kind,result_id,result_version_id)`、`query_id`（关系行）、`request_digest`、精确来源/任务引用、`artifact_ref`、`authorization_scope_digest`、actor、授权引用、审计 FK 与时间。表级唯一、非空、kind 条件、摘要形状、role INSERT/SELECT 和延迟审计 FK；业务正文/模型响应只在 C04。C03 事务内对竞争写入 `ON CONFLICT DO NOTHING` 再按 digest/read 校验，不用预查询决定唯一性；相同重放不重复审计，冲突不覆盖。新增迁移只占 `000041`，C20 `000040` 保持原样。
- D-05：新增补搜永远仍由 C20 策略及稠密/BM25/RRF 决定；冻结查询 reader 只允许使用 C08 动作内的附加文本，不更换其它三引用/代际/授权。调用者查询 capability 与 C17 read capability 必须分开由 C06 精确签发，且后者不得扩大原资料范围。模型预算、工具预算、候选数、上下文大小、墙钟及恢复台账只由 C08 持久执行。
- D-07/08：上下文以 `ModelContextArtifactSetRefV1` 外露，保护源段定位与各组精确引用，C20 排序信号明确不参与风险置信度。生产 Worker 仅提供可注入的必需 inputReader/C20/C17/C08 接口和单一 router；C24 生产输入、策略和图接线不在 C21 创建。禁止为了测试绕过任一资格创建假后端。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 关系检索只读取同一识别输入的精确发布事实：精确当前工序及依赖返回结果 | IP-01、IP-02、IP-07 | core context、Worker composition | C17 合法模型/机理包，当前工序及前后/受力边 | 精确发布、节点/关系/机理、资料段可回读，公共 ref | V-01、V-03 |
| 同项：错工程、关系断裂或撤权封闭失败 | IP-02、IP-07 | core context、Worker composition | 错工程/错发布/断边/撤权 | 同形无泄露失败、零正式结果 | V-01、V-03 |
| 关系查询结果具有不可变身份和幂等审计：相同查询重放 | IP-03、IP-07 | PG adapter | 原 `(project,queryId,digest)` 双调用 | 同一 ref，一条审计，一行绑定 | V-02 |
| 同项：同键异载荷或事务失败 | IP-03、IP-07 | PG adapter | 改 payload/授权、注入审计失败 | 冲突不覆盖，事务回滚无结果 | V-02 |
| 混合检索基线与有限补搜严格绑定：基线和补搜均精确可追溯 | IP-04、IP-05、IP-07 | Worker runtime/composition、C20 service | 已 ready 双路代际；固定合成候选 | 同一发布/策略/授权，稳定 queryId，候选版本留痕 | V-03、V-04 |
| 同项：基线不合格或补搜越界 | IP-04、IP-05、IP-07 | Worker runtime | C20 任一路失败、工具/预算越界 | 显式失败、零正式集、零单路降级 | V-03 |
| Agent 只能提交类型化检索选择增量：合格增量成为正式检索工件集 | IP-05、IP-07 | core context、Worker runtime | 同版合法来源与证据 | C08 completed 的 incrementRef、逐项校验、原排名不变 | V-01、V-03 |
| 同项：越界候选与来源失效 | IP-05、IP-07 | core context、Worker runtime | 冻结外成员、撤权、错发布 | 拒绝且不可用修正循环绕过权限 | V-01、V-03 |
| RI-S56 上下文恰好保留五项依据与版本：五项依据可从固定引用重放 | IP-06、IP-07 | core context、Worker composition | C08 completed，C21 三类结果绑定 | 五组均非空，来源段/任务/发布齐全，排序≠置信度 | V-01、V-03 |
| 同项：五项之一缺失 | IP-06、IP-07 | core context | 无受力边/状态描述/机理/正式检索证据 | 每种缺项阻止正式上下文，无伪造 | V-01 |
| 必经审阅失败和恢复不产生伪正式结果：失败不推进上下文 | IP-05、IP-06、IP-07 | Worker runtime/composition | C08 终态失败、C04 或审计故障 | 基线不冒充正式集、无五项 ref，错误可审计 | V-03 |
| 同项：恢复沿用任务及预算 | IP-05、IP-07 | Worker runtime、PG adapter | C20 同 queryId 已登记，C08 动作已耐久 | 已成立动作不重复，预算连续、冲突显式 | V-02、V-03 |
| C17/C20/C08 原有行为不漂移；依赖/规格/静态门 | IP-01～IP-07 | 现有检索/Agent/C17 测试、全部计划文件 | 主调度机械 exports 与 C20 迁移已在基线/工作树 | 无第二委派、无包边界反转、严格 change 合规 | V-04、V-05、V-06、V-07 |

## 7. 文件清单与升级条件

**新增（IP-01～IP-07）**：`packages/core/src/identification/context/{schema,ports,service,index}.ts`、`packages/core/test/identification/context.test.ts`；`packages/adapters/src/identification/context/{postgres-identification-context-adapter,index}.ts`、`packages/adapters/src/postgres/migrations/identification/deliver-relationship-context-and-retrieval-agent-review/000041_identification_context_results.ts`、`packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts`；`apps/worker/src/identification/context/{composition,runtime,index}.ts`、`apps/worker/test/identification/context/{composition,runtime}.test.ts`。路径花括号表示各独立文件。

**修改（IP-06）**：`apps/worker/src/index.ts` 仅导出 C21 模块。**删除**：无。**主调度机械前置、不得编辑**：`packages/core/package.json`、`packages/adapters/package.json` 两处已新增 `./identification/context` export；中央迁移清单如需显式登记由主调度处理。**保持不动**：公共 contracts、C17 façade/组合、C20 混合检索实现/迁移、C08 任务执行/表、C24 图、C22 候选、API/Web、锁文件。执行前 `rg --files packages/{core,adapters}/src/identification/context` 可核对新增路径；实施后 `git diff --name-only 6ffe9d5879fd6ec9ba252a79aa843c430158abf4` 对 allowlist 与主调度已有 dirty manifests 分开审阅。

遇到 C02/C17/C20/C08 合同变化、C17 精确读取权限无法在现有 C06 分支签发、C08 registry/单 runner 无法接入、C20 正式结果不可精确读取、`000041` 碰号、事务/role 约束变更、需新迁移表/依赖/公共事件/公共 DTO、C24 生产输入不能提供冻结文本或计划外文件时先 escalation，不自行扩大权限或添加伪回退；普通测试失败在原 Implementation/Finalizer Task 内修复。

## 8. 验收 Agent 授权与限定审计

Finalizer 可在上列 C21 自有文件及其测试、现有 C17/C20/C08 **测试文件**的已批准语义范围内修复和回归，验证真实 C03/C04/C06/C08/C17/C20 接缝，填写最终 verification 并记录最终 HEAD 与命令；不得改 C02 contracts、C17/C20/C08 生产代码、主调度 manifests/迁移清单或 C24/C22。权限/事务/关键状态恢复触发一次限定审计：Auditor 对同一 verification 补充当前 HEAD 的授读拒绝、审计回滚和稳定补搜重放证据，当前 Task 内修复范围内普通缺陷并回归；越界则升级，不再派第二次审计。
