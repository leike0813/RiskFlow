# Implementation Plan

## 1. 实施基线与权威来源

- **固定 base commit**：`251af7e7c6ec55865092e6aa1ba1a4c839d8d495`。Implementation 开始前必须核对 `git rev-parse HEAD`；若 HEAD 漂移导致 C07/C22 符号、数据库对象、C03/C04 接缝或文件 allowlist 失效，停止并升级，不自行补设计。
- **实际 schema / applyRequires**：`orchestrated-delivery`；apply 前置为 proposal、specs、design、implementation-plan、tasks。Implementation 必须重新运行 `openspec instructions apply --change deliver-identification-human-review --json` 并完整读取全部 `contextFiles`，不得创建 verification。
- **权威行为**：`specs/identification/human-review/spec.md`；技术边界为 `design.md` D-01～D-11；公共 DTO、决定、错误和事件 SSOT 为 `packages/contracts/src/ports/index.ts`、`packages/contracts/src/records/index.ts`、`packages/contracts/src/events/index.ts`。
- **直接依赖**：C07 `PostgresReviewAuditAdapter` / `ReviewAuditPortV1`；C22 `RiskCandidateFinalizationService`、其 Schema/ports/PostgreSQL result store；C03 `TransactionUnitV1`；C04 `ArtifactStoreV1`；C06 当前授权复验。它们均已归档并在 base 上存在。
- **不变裁决**：不修改公共 C02 契约、角色能力矩阵、表结构/迁移、领域事件、HTTP/UI 或依赖；发现必须修改其中任一项时停止并 escalation。
- **验证命令别名**：
  - `V-01=pnpm exec vitest run packages/core/test/identification/human-review.test.ts packages/core/test/identification/candidate-finalization.test.ts`
  - `V-02=pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`
  - `V-03=pnpm exec vitest run apps/worker/test/identification/human-review/composition.test.ts apps/worker/test/identification/candidate-finalization/composition.test.ts`
  - `V-04=pnpm typecheck`
  - `V-05=pnpm deps:check && pnpm deps:policy`
  - `V-06=pnpm exec eslint packages/core/src/identification/human-review packages/core/src/identification/candidate-finalization packages/core/test/identification/human-review.test.ts packages/core/test/identification/candidate-finalization.test.ts packages/adapters/src/review-audit/postgres-review-audit-adapter.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts apps/worker/src/identification/human-review apps/worker/src/identification/candidate-finalization apps/worker/test/identification/human-review apps/worker/test/identification/candidate-finalization && pnpm exec prettier --check openspec/changes/deliver-identification-human-review packages/core/src/identification/human-review packages/core/src/identification/candidate-finalization packages/core/test/identification/human-review.test.ts packages/core/test/identification/candidate-finalization.test.ts packages/adapters/src/review-audit/postgres-review-audit-adapter.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts apps/worker/src/identification/human-review apps/worker/src/identification/candidate-finalization apps/worker/test/identification/human-review apps/worker/test/identification/candidate-finalization`
  - `V-07=openspec validate deliver-identification-human-review --strict --no-interactive`
  - `V-08=git diff --check && git status --short`

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `ReviewTaskRefV1Schema`、`ReviewDecisionV1Schema`、`ReviewDecisionCommandV1Schema`、`ModuleErrorV1Schema`；`packages/contracts/src/records/index.ts` 的 `RiskElementRelationSchema`；`packages/contracts/src/common/index.ts` 的 `EvidenceLocatorSchema` | C23 私有动作只组合既有严格 Schema，并从公共决定联合构造 C07 命令 | 复核类型、决定 kind、任务/目标引用、错误码、候选内容字段 |
| IP-02 | `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 的 `PostgresReviewAuditAdapter.#verify`、`taskFromRow`、`reviewTaskRefEquals` | 增加授权先行的 pending 任务窄读，只返回冻结引用和状态 | C07 任务状态、授权、数据库行形状、决定事实 |
| IP-03 | `packages/core/src/identification/candidate-finalization/service.ts` 的 `#readRegistered`、`#persistRows`、`#persistCandidates`、`buildVisibleEvidenceIndex`、`evaluateCandidateSet`；`schema.ts` 的候选/校验 Schema 与身份函数 | 在 C22 内实现精确来源读取、单候选后继版本、确定性重校验和既有 result kind 登记 | 候选身份、工件 purpose、校验算法、内容摘要、C03/C04 写入顺序 |
| IP-04 | `ReviewAuditPortV1.decideReview` 与 C07 `review.review-resolved.v1` 事务事件 | 单项 C23 操作最终只提交一次标准 C07 决定；恢复由既有事件表达 | C07 行锁、决定/审计/回执/事件原子性、等待运行引用 |
| IP-05 | C07 规范中的逐项批量语义与 `MAX_RISK_CANDIDATES_V1` | 批量只做输入预检和顺序逐项调用，不建并发池/大事务 | 每项授权、命令身份、幂等、结果、审计和事件 |
| IP-06 | `apps/worker/src/identification/candidate-finalization/composition.ts` 的必需依赖检查与现有 C22 service | 组合具体 C07 adapter、C22 revision seam 和 C23 service；缺依赖构造失败 | 内存回退、测试 fixture 生产化、C24/C33 责任 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 定义 C23 私有动作/结果 | “识别复核只能作用于精确待处理任务和冻结目标”；“修正并通过必须先形成不可变候选新版本并重新校验”；批量输入边界 | 新增 `packages/core/src/identification/human-review/schema.ts` | 定义 strict `IdentificationHumanReviewCommandV1Schema`、单候选 `revision`（source candidate set、source validated set、candidate ref、允许字段 partial）、逐项结果和批量结果；禁止 revision 中出现 `modelConfidence/nodeId`；至少一个真实字段；批量只允许 approve-unchanged/reject、上限 `MAX_RISK_CANDIDATES_V1`、任务 ref 去重 | 公共 contracts、候选七字段、决定联合、错误码 |
| IP-02 | 提供 C07 pending 任务窄读 | 精确待处理/陈旧/错配场景；快照外或撤权证据场景 | 新增 `packages/core/src/identification/human-review/ports.ts` 的 `IdentificationPendingReviewReaderV1`；修改 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 的 `PostgresReviewAuditAdapter.readPendingIdentificationReview` | 先 `#verify(..., "review-audit.decide-review")`，再以工程、任务 entity/version 查询；解析完整 task ref，要求 identification-group、目标和 waiting run 精确匹配，返回 pending 的 validation/evidence/policy/waiting refs；decided/superseded/错配/无权用闭合结果收口且不返回正文 | `ReviewAuditPortV1`、C07 表/索引/权限、现有 `readIdentificationGroupDecision` 语义 |
| IP-03 | 在 C22 独占实现人工修订事实 | 修正通过/置信度只读/校验失败；证据调整两场景；重试两场景 | 修改 `packages/core/src/identification/candidate-finalization/ports.ts` 新增 `IdentificationReviewRevisionPortV1`；修改 `service.ts` 的 `RiskCandidateFinalizationService.prepareReviewRevision` 并复用/抽取现有私有 helper | 复验 review branch；精确读取 group/source candidate set/source validated set/candidate/snapshots，证明同工程、同路线、成员关系和策略一致；复制来源集合，仅目标候选 `candidateVersion+1`/`parentCandidateRef`，保留 modelConfidence/node/model refs/raw response/generatedAt；从 source validation set 复用策略，调用 `evaluateCandidateSet`，任一非 accepted 即 BUSINESS_BLOCKED；成功把候选工件、candidate-set、validated-candidate-set 写 C04，再以派生内部命令在一个 C03 事务登记两类现有结果与一条审计，无领域事件 | 模型调用、自动修正、C22 公共 analyze/finalize 行为、result kind、表结构、正式记录入库 |
| IP-04 | 单项决定编排 | 合并/分立/其它决定三场景；成功恢复两场景；修正决定 | 新增 `packages/core/src/identification/human-review/service.ts` 的 `IdentificationHumanReviewService.decide` 与 `index.ts` | 解析动作→IP-02 读取当前任务→修订分支调用 IP-03→构造标准 `ReviewDecisionCommandV1`→仅调用一次 `decideReview`；修订决定引用新 candidate set；C07 失败原样映射；成功返回决定/等待运行/可选候选和校验引用；不调用 workflow resume | C07 决定事务、C22 后续重路由/入库、C24 事件消费、HTTP/UI |
| IP-05 | 批量与两阶段对账 | “批量原样通过和拒绝必须逐项隔离”全部场景；响应丢失/同键异载荷场景 | `packages/core/src/identification/human-review/service.ts` 的 `decideBatch` 与 IP-03 稳定内部身份 | 全批结构/上限/重复预检后顺序调用 `decide`，保留输入顺序并收集每项结果；修订阶段身份由外层 command/idempotency + strict 摘要派生，相同载荷复用 C04/C03/C07 结果，同键异载荷冲突；阶段一成功阶段二失败的工件不可消费 | 跨任务事务、自动重试新命令、替代决定、盲目恢复运行 |
| IP-06 | 生产组合与模块导出 | 全部需求的可达性；D-01/D-10/D-11 | 修改 `packages/core/package.json`；修改 `apps/worker/src/identification/candidate-finalization/composition.ts`；新增 `apps/worker/src/identification/human-review/{composition,index}.ts`；修改 `apps/worker/src/index.ts` | 增加 core 子路径导出；C22 composition service 暴露 `prepareReviewRevision`；C23 composition 要求同时具备 C07 pending reader + decideReview 与 C22 revision seam，构造 `IdentificationHumanReviewService`；无依赖即抛错 | 新依赖、API 路由、Web 页面、内存/默认 fallback |
| IP-07 | 聚焦行为与回归证据 | 所有 Requirement/Scenario | 新增 `packages/core/test/identification/human-review.test.ts`、`apps/worker/test/identification/human-review/composition.test.ts`；修改 `packages/core/test/identification/candidate-finalization.test.ts`、`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`、`apps/worker/test/identification/candidate-finalization/composition.test.ts` | 用“合成样本、待甲方复核”覆盖允许修订、置信度/节点越界、证据快照与撤权、策略复用、校验失败、六类决定、事件、批量部分失败、并发陈旧、重放/冲突和缺依赖；复用现有 fixture，参数化相似决定分支 | 完整文案、SQL 调用顺序、随机 ID、内部 helper、C24/C33 行为 |

## 4. 调用与副作用顺序

### 4.1 非修订单项

1. IP-01 strict 解析完整命令身份、工程、主体、授权、任务/目标、决定和原因码。
2. IP-02 在读取任务前验证 `review-audit.decide-review`，只返回精确 pending 冻结引用；此读取不锁行、不写审计或事件。
3. IP-04 从私有动作构造现有 `ReviewDecisionCommandV1` 并调用一次 C07 `decideReview`。
4. C07 在事务内重新授权、锁任务行并重验状态/版本；成功原子提交决定、命令回执、业务审计和 `review.review-resolved.v1`，竞态 loser 返回 `STALE_VERSION`。
5. C23 仅在 C07 成功后返回成功；C24 后续消费事件恢复，不由 C23 发第二个命令。

### 4.2 修订并通过

1. 完成 4.1 的步骤 1～2，并取得任务冻结 validation/evidence/policy/waiting refs。
2. IP-03 用 review 分支复验当前授权，按完整 ref 读取 group、source candidate set、source validated set、candidate、validation snapshot、evidence snapshot 和五项上下文；任一错配/撤权先失败。
3. 复制来源候选集并只修改目标候选允许字段；candidate/set 版本和父引用由 strict payload 摘要确定，`modelConfidence` 与所有冻结模型事实原样保留。
4. 使用来源已校验集冻结的策略和任务快照执行 `evaluateCandidateSet`；任一非 accepted 停止，不调用模型、不提交 C07 决定。
5. 候选正文、candidate-set、validated-candidate-set 先按确定性 artifact id 写 C04；随后一个 C03 事务登记两个现有 result kind、内部命令回执和 `identification.review-revision-validated` 审计。C03 失败不返回引用；C04 孤儿沿既有回收处理。
6. IP-04 构造 `approve-revised-candidate`，其 `revisedCandidateRef` 指向步骤 5 的 candidate set，再执行 4.1 步骤 3～5。
7. 若 C07 因并发变陈旧，步骤 5 的不可变修订仍无正式决定且不可消费；相同命令重试先复用步骤 5 结果，再由 C07 回执对账。

### 4.3 批量

1. IP-05 在任何副作用前解析全部项目、检查上限、仅允许 approve-unchanged/reject，并拒绝重复任务 ref。
2. 按输入顺序执行 4.1；每项独立授权与事务，一项失败记录自己的结果后继续后续项。
3. 返回同长度结果数组；不提供“全批成功”承诺，不回滚已提交项。

## 5. Schema、状态与持久化落实

- **Schema**：公共任务/决定/错误/事件只引用 C02；候选内容只引用 `ModelOutputResultSchema` 的字段 Schema；C23 私有 revision 是 strict partial 且显式排除只读字段。C22 的 `RiskCandidateSetV1Schema`、`CandidateValidationSetV1Schema`、`IdentificationGroupV1Schema` 继续是工件事实源。
- **状态**：C07 仍只有 `pending | decided | superseded`；C23 不新增状态。修订工件是否可消费由精确 C07 决定引用决定，工件存在本身不代表通过。
- **版本**：新 candidate `candidateVersion=source+1`、`parentCandidateRef=source`；新 candidate set `candidateSetVersion=source+1`、`parentCandidateSetRef=source`；内容摘要决定精确版本 ref。同一摘要重放，同版本异摘要冲突。
- **权限**：pending reader 与 revision seam 都验证 `review-audit.decide-review`；C07 决定前再次验证。不得要求或授予 reviewer `risk-identification.run/finalize`、`workflow.resume`，不得读取 C06 内部表。
- **持久化**：只复用 C04 和 `business.identification_finalization_results` 的 `candidate-set` / `validated-candidate-set`，以及 C07 既有表；无新表、列、索引、角色授权或 migration。
- **事务**：修订登记一个 C03 本地事务，决定一个 C07/C03 本地事务；不跨 C04/PostgreSQL/C07 伪造分布式事务。标准化风险记录仍只由 C22 `accept-groups` 后续事务产生。
- **审计/事件**：修订登记写一条不含正文的 C03 审计且无事件；正式人工决定及唯一恢复事件由 C07 原子写入。批量逐项计数。
- **错误**：按 D-09 稳定映射；日志、错误、审计和事件不包含候选/证据正文、模型响应、连接信息或内部驱动错误。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 精确待处理分组进入复核 | IP-01, IP-02, IP-04 | `packages/core/test/identification/human-review.test.ts`; `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts` | pending identification-group 合成任务 | 返回同任务/目标/等待运行；C07 决定一次 | V-01, V-02 |
| 陈旧任务拒绝且不泄露目标 | IP-02, IP-04 | 同上 | decided、superseded、跨工程、错版本 | 稳定 STALE/AUTH 结果；无新决定/事件；跨工程同形 | V-01, V-02 |
| 修正候选通过重校验并提交决定 | IP-01, IP-03, IP-04 | `packages/core/test/identification/candidate-finalization.test.ts`; `packages/core/test/identification/human-review.test.ts` | group + source candidate/validated set + 合成五项上下文 | parent/version 正确；全部 accepted；决定引用新 set；原事实不变 | V-01 |
| 禁止修改模型置信度或工序绑定 | IP-01, IP-03 | `packages/core/test/identification/human-review.test.ts` | 带契约外只读字段的修订 | strict 拒绝且零工件/决定副作用；合法修订 confidence/node 原值 | V-01 |
| 修正未通过确定性校验 | IP-03, IP-04 | `packages/core/test/identification/candidate-finalization.test.ts`; `packages/core/test/identification/human-review.test.ts` | 关系/规则/仿真失败样本 | BUSINESS_BLOCKED；任务 pending；无决定/恢复事件/模型调用 | V-01 |
| 调整到冻结范围内证据 | IP-02, IP-03 | 同上 | 任务快照和五项上下文均含目标资料段 | 新 candidate locator 与精确来源一致；校验 accepted | V-01, V-02 |
| 快照外或已撤权证据被拒绝 | IP-02, IP-03 | 同上 | 快照外、跨工程、撤权来源 | 正文读取前拒绝；无泄露、决定或事件 | V-01, V-02 |
| 原样通过或确认合并 | IP-04 | `packages/core/test/identification/human-review.test.ts`; C07 adapter test | 两种决定参数化 | C07 决定/审计/事件各一；C23 不直接写正式记录 | V-01, V-02 |
| 保持分立触发既有重路由 | IP-04 | `packages/core/test/identification/human-review.test.ts`; existing C22 core test | keep-separate | 决定 kind 保持；C22 disposition 为 reroute；无复制合并逻辑 | V-01 |
| 拒绝或退回不产生正式记录 | IP-04 | 同上 | reject、return-upstream 参数化 | 决定成立；C22 disposition blocked；零标准记录 | V-01 |
| 决定与恢复信号原子成立 | IP-04 | C07 adapter test；C23 core test | 成功决定与同命令重放 | 决定/回执/审计/event 同事务；resumeRunRef 精确；重放不重复 | V-01, V-02 |
| 决定事务失败 | IP-03, IP-04 | C07 adapter test；C23 core test | 审计/Outbox 注入失败 | 回滚决定；无可消费事件；阶段一工件不被验收 | V-01, V-02 |
| 批量中部分任务陈旧 | IP-05 | `packages/core/test/identification/human-review.test.ts` | 有效 + stale 混合批 | 结果逐项对应；有效项提交，失败项无决定；后续项继续 | V-01 |
| 批量请求超过受控上限 | IP-01, IP-05 | 同上 | 超限、重复任务 | 执行前整体拒绝；decideReview 调用 0 次 | V-01 |
| 修正操作在响应丢失后重试 | IP-03, IP-04 | C22/C23 core tests；C07 adapter test | 阶段一/二已提交后重放 | ref 相同；工件登记、审计、决定和事件计数不增 | V-01, V-02 |
| 同一幂等键改变修正内容 | IP-03, IP-04 | 同上 | 相同 key 改字段/目标/决定/原因 | IDEMPOTENCY_CONFLICT；原事实不变 | V-01, V-02 |
| 组合与边界回归 | IP-06, IP-07 | 两个 Worker composition tests | 完整/缺失依赖 | 完整组合暴露 decide/batch/revision；缺依赖构造失败；无 contracts/API drift | V-03, V-04, V-05 |

## 7. 文件清单与升级条件

### 新增

- `packages/core/src/identification/human-review/schema.ts`
- `packages/core/src/identification/human-review/ports.ts`
- `packages/core/src/identification/human-review/service.ts`
- `packages/core/src/identification/human-review/index.ts`
- `packages/core/test/identification/human-review.test.ts`
- `apps/worker/src/identification/human-review/composition.ts`
- `apps/worker/src/identification/human-review/index.ts`
- `apps/worker/test/identification/human-review/composition.test.ts`

### 修改

- `packages/core/src/identification/candidate-finalization/ports.ts`
- `packages/core/src/identification/candidate-finalization/service.ts`
- `packages/core/test/identification/candidate-finalization.test.ts`
- `packages/core/package.json`
- `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`
- `packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`
- `apps/worker/src/identification/candidate-finalization/composition.ts`
- `apps/worker/test/identification/candidate-finalization/composition.test.ts`
- `apps/worker/src/index.ts`

### 删除

- 无。

### 保护文件

- `packages/contracts/**`、`packages/core/src/access/**`、除上述 C07 adapter 文件外的 `packages/adapters/**`、全部迁移、`apps/api/**`、`apps/web/**`、`pnpm-lock.yaml`、`package.json` 依赖清单均不得修改。

### 升级条件

- 需要新增或修改公共 DTO/端口/事件、权限能力/角色、持久化结构/迁移、第三方依赖或 HTTP/UI 范围。
- 当前 C07 任务事实无法通过窄读提供冻结 snapshot/policy，或 C22 source candidate/validated set 无法证明与 group/candidate 的精确关系。
- 必须改变 C22 候选/校验 Schema 版本、result kind、正式记录事务或 C07 决定状态机才能实现。
- base HEAD 漂移、计划文件/符号不存在、指定验证命令不存在，或修复要求触碰 allowlist 外文件。

上述任一情况均停止 Implementation 并 escalation；不得用客户端字段、全库扫描、字符串反解 artifact id、默认策略、内存事实或新增兼容分支绕过。

## 8. 验收 Agent 授权与限定审计

- Finalizer 可在 §7 allowlist 内修复已批准行为的普通缺陷、补充/调整对应测试并更新 verification；不得改变 D-01～D-11、公共契约、权限、事务、持久化或范围。
- 必须核对：reviewer 仅凭 `review-audit.decide-review` 完成 C23 操作；候选修订没有 model 调用；C07 决定事务仍是唯一正式人工决定与恢复事件；阶段一孤儿工件不可被 C22 验收；批量没有跨任务事务。
- 本 change 涉及权限先行读取、两阶段幂等和 C07 关键状态机，`auditPolicy` 应标记 `authorization`、`transaction`、`critical-state-machine`，按执行图触发至多一次 Targeted Auditor。
- Finalizer 最终运行 V-01～V-08；若 PostgreSQL/Testcontainers 环境不可用，必须记录 BLOCKED，不能以单元 fake 替代 V-02 的权限、事务、审计和事件证据。
