# Implementation Plan

## 1. 实施基线与权威来源

- **固定 base commit**：`07d1a599ae91be781c490090dad2e8a77dc2f625`。Implementation 开始前必须核对 `git rev-parse HEAD`；若 HEAD 漂移导致本计划符号、`000042` 序号、C21/C07/C10 接缝或文件 allowlist 失效，停止并升级，不自行补设计。
- **实际 schema / applyRequires**：`orchestrated-delivery`；apply 前置为 proposal、specs、design、implementation-plan、tasks。Implementation 必须重新运行 `openspec instructions apply --change deliver-risk-candidate-validation-merge-and-acceptance --json` 并完整读取其全部 `contextFiles`，不得提前创建 verification。
- **权威行为**：本 change 的 `specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md`；技术边界为 `design.md` D-01～D-12；领域字段 SSOT 为 `packages/contracts/src/records/index.ts` 的 `ModelOutputResultSchema`、`StandardizedRiskRecordSchema`、`StandardizedRiskRecordEnvelopeSchema`。
- **直接依赖**：C02 `packages/contracts/src/ports/index.ts` 的识别命令/结果/ref 与 C07 复核；C03 persistence；C04 artifacts；C05 access；C10 model gateway；C21 `ModelContextPayloadV1Schema` / `IdentificationContextResultStoreV1`。依赖均已归档并在 base 上存在。
- **协调裁决**：批准 C22 自有追加式中间登记表、不可变标准化记录表和 `000042_risk_candidate_finalization.ts`；正文/SSOT/事务/机械迁移接缝必须保持 design D-02、D-09、D-10、D-12 的边界。
- **验证命令别名**：
  - `V-01=pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts`
  - `V-02=pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`
  - `V-03=pnpm exec vitest run apps/worker/test/identification/candidate-finalization/runtime.test.ts apps/worker/test/identification/candidate-finalization/composition.test.ts`
  - `V-04=pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts`
  - `V-05=pnpm exec vitest run packages/core/test/identification/context.test.ts packages/adapters/test/identification/context/postgres-identification-context-adapter.test.ts apps/worker/test/identification/context/composition.test.ts apps/worker/test/identification/context/runtime.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts`
  - `V-06=pnpm exec tsc -b packages/core packages/adapters apps/worker && pnpm typecheck && pnpm deps:check`
  - `V-07=pnpm exec eslint packages/core/src/identification/candidate-finalization packages/core/test/identification/candidate-finalization.test.ts packages/adapters/src/identification/candidate-finalization packages/adapters/test/identification/candidate-finalization packages/adapters/src/review-audit/postgres-review-audit-adapter.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts apps/worker/src/identification/candidate-finalization apps/worker/test/identification/candidate-finalization apps/worker/src/index.ts && pnpm exec prettier --check openspec/changes/deliver-risk-candidate-validation-merge-and-acceptance packages/core/src/identification/candidate-finalization packages/core/test/identification/candidate-finalization.test.ts packages/adapters/src/identification/candidate-finalization packages/adapters/test/identification/candidate-finalization packages/adapters/src/postgres/migrations/risk-identification/deliver-risk-candidate-validation-merge-and-acceptance packages/adapters/src/review-audit/postgres-review-audit-adapter.ts packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/fixture.ts packages/core/package.json packages/adapters/package.json apps/worker/src/identification/candidate-finalization apps/worker/test/identification/candidate-finalization apps/worker/src/index.ts`
  - `V-08=openspec validate deliver-risk-candidate-validation-merge-and-acceptance --strict --no-interactive && git diff --check`

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | `packages/contracts/src/records/index.ts` 的三个识别 Schema；`packages/contracts/src/ports/index.ts` 的 candidate/group/plan/route/record ref | C22 私有 Schema 组合现有内容与 ref；正式记录直接 parse 公共 Schema | 六/七字段、公共 ref、命令/结果联合 |
| IP-02 | `packages/core/src/identification/context/schema.ts` 的 `ModelContextPayloadV1Schema`；`ports.ts` 的 `IdentificationContextResultStoreV1` | 按精确 `model-context` 登记与 C04 工件读取五项上下文 | C21 结果表、五项内容、发布/授权摘要 |
| IP-03 | `packages/core/src/model/gateway.ts` 的 `ModelGatewayPortV1.completeStructured`；`schema.ts` 的请求/结果/错误 | 专用 RI-S57 结构化调用与原始响应证据；同 gateway `embed` 提供冻结事件向量 | 模型协议、原始响应持久化、错误映射 |
| IP-04 | `packages/core/src/persistence/canonical-json.ts` 的 canonical/digest；C01 记录 Schema | 纯函数校验、稳定身份、父子候选和策略化置信度 | 业务相似性不得由 hash/字符串替代 |
| IP-05 | C10 `embed`；C21 上下文和 C24 注入的 `IdentificationWorkPlanReaderV1` | 完整工作计划上计算余弦、工序、资料段三信号并稳定聚类 | 不读取 C24 私表、不猜缺失工作项 |
| IP-06 | `ReviewAuditPortV1.requestReview`；`PostgresReviewAuditAdapter.readRuleConflictDecision` 现有窄读模式 | 请求 C07 identification-group 复核；新增同形 identification 决定窄读 | C07 任务/决定表、公共端口、权限与事件 |
| IP-07 | `ArtifactStoreV1`、`TransactionUnitV1`、`LocalIdentityAccessV1`；`000041`/`000045` 迁移模式 | C04 正文 + C03 原子登记；`000042` 追加表、角色、FK、CHECK | 工件正文、命令回执、审计、Outbox、授权事实 |
| IP-08 | `StandardizedRiskRecordEnvelopeSchema`；`DomainEventV1Schema` 的 `identification.risk-record-accepted.v1` | 构造唯一正式记录并原子发既有事件 | 第二套记录字段、第二事件、评估事实 |
| IP-09 | `packages/core/package.json`、`packages/adapters/package.json`、`apps/worker/src/index.ts` | 仅增加正式 C22 子路径和 Worker 导出 | 新 workspace、新依赖、API/C24 接线 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 私有 Schema 与策略 | 全部 requirement 的结构前提；“精确上下文生成候选”“候选通过全部确定性校验”“综合置信度可重放” | 新增 `packages/core/src/identification/candidate-finalization/schema.ts` | 定义 D-02 的候选、校验、组、计划、路线、自动决定、快照、策略、登记行严格 Schema；集合上限/唯一/稳定序；正式内容嵌入公共 Schema | 公共 contracts；第二套标准记录字段；开放对象袋 |
| IP-02 | 窄端口和输入一致性 | “上下文或模型输出不合格”“合并输入不完整或策略错配”“处理期间撤权”“跨工程引用不可枚举” | 新增 `packages/core/src/identification/candidate-finalization/ports.ts`；复用 C21 ports | 定义 context/work-plan/policy/review-decision/auth/result-store 窄接口、公开分支抽取类型和组合 options；所有 reader 精确 ref、闭合结果 | latest/default；跨层数据库接口；测试 fallback 进入生产 |
| IP-03 | RI-S57 模型运行 | Requirement“风险候选只从冻结五项上下文生成”全部 scenarios | 新增 `apps/worker/src/identification/candidate-finalization/runtime.ts` 的 render/invoke/interpret；复用 `ModelGatewayPortV1` | 读取五项上下文，构建结构化请求，按策略预算调用 `completeStructured`；保存候选/原始响应 ref；失败映射 C02 error；不注册 C08 | Agent task type、模型自评、旧候选 fallback、提示全文测试 |
| IP-04 | 确定性校验和有界修正 | Requirement“候选确定性校验逐项收口且修正有界”全部 scenarios | 新增 `packages/core/src/identification/candidate-finalization/service.ts` 的 `validateCandidateSet`；`runtime.ts` 修正循环 | 实现 Schema/node/relation/evidence/mechanism/rule/simulation checks；按 policy 区分 repairable/terminal；原预算内父子候选，全部通过后正式 validated set | 模型执行校验；换模型/提示/上下文/预算；失败候选进入后续 |
| IP-05 | 全运行合并与置信度 | Requirement“全运行重复检测和合并由冻结策略决定”“综合置信度可解释且只由版本化策略计算”全部 scenarios | `service.ts` 的 `buildMergePlan`、`calculateCompositeConfidence`；`runtime.ts` 的 embedding；新 core test | 核对 work plan 完整性；冻结 embed 调用；余弦/工序/资料段三信号稳定聚类；独立组显式 skip；四依据权重/缺项/舍入策略化 | 纯字符串门禁；RRF 充置信度；首项/部分计划；硬编码权重阈值 |
| IP-06 | 验收路由与 C07 决定窄读 | Requirement“每个合并组恰好进入一种验收路线”“验收决定必须逐组匹配当前路由”全部 scenarios | `service.ts` 路由/决定解释；修改 `packages/adapters/src/review-audit/postgres-review-audit-adapter.ts` 新增 `readIdentificationGroupDecision`；修改其测试 | 自动 route decision；人工 validation/evidence snapshot + C07 request；窄读 task/target/decision/current auth；决定一一对应，修订/分离返回重新路由阻断 | C07 公共端口/权限/表所有权；技术失败自动放行；人工覆盖确定性校验 |
| IP-07 | C04/C03/PostgreSQL 实现 | Requirement“标准化风险记录与评估事件原子成立”的“中间结果登记保持追加式引用边界”；权限 requirement 全部 scenarios | 新增 `packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts`、`index.ts`；新迁移 `.../000042_risk_candidate_finalization.ts`；新 adapter test | 实现精确 reader/registry/auth、C04 put/read、C03 原子登记、两表/约束/角色/审计 FK；同 ref replay/conflict；撤权前置 | 中间正文入表；UPDATE/DELETE；第二幂等/审计/Outbox；直接读其它模块私表 |
| IP-08 | 验收记录和事件原子提交 | “合格组原子入库”“事务任一步失败”“重放和并发不重复记录” | `postgres-risk-candidate-adapter.ts` 的 accept commit；复用公共 record/event Schema；adapter test | 一条命令先完整验证所有组/决定，再单一 C03 事务写记录、回执、审计和逐记录事件；`riskRecordId` 唯一同载荷重放/异载荷冲突 | 部分验收；复制风险正文到事件；新事件；覆盖历史 |
| IP-09 | Worker 组合与包导出 | 全部公开分支可调用；D-01/D-03/D-12 | 新增 `apps/worker/src/identification/candidate-finalization/{composition,index}.ts` 和两测试；新增 core/adapters `index.ts`；修改两个 package manifests、Worker index | 组合 required dependencies，暴露 C22 analyze/finalize partial service；缺必需 reader/provider 时构造失败；正式子路径导出 | C24 图/API wiring；隐藏 fallback；新 dependency/lockfile |
| IP-10 | 迁移机械清单与跨依赖回归 | 迁移/权限/追加式/跨层引用要求 | 修改 `packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts` | 按序加入 `000042` module、manifest、测试白名单；验证发现顺序、up/down/up、角色、后续无预建解除块 | provider 语义；其它迁移；占用 43～45；生产授权矩阵 |

## 4. 调用与副作用顺序

1. **共同入口**：解析 C02 命令 → 校验 branch capability 与 authorization 绑定 → C05 `verify` 当前工程/空间/资料范围 → 按完整 result ref 查询已成立回执/登记；授权失败发生在目标存在性读取前。
2. **assemble-and-infer（IP-02/03/07）**：读取 C21 `model-context` 登记 → C04 读取并 parse 五项上下文 → policy provider 核对 input policy set、模型/提示/预算 → C10 `completeStructured` 落原始响应 → C22 candidate 工件 → C03 事务登记候选 ref/回执/审计 → 返回原 context ref + candidate ref。C10/C04 失败不登记；C03 失败不返回可消费 ref。
3. **repair-and-validate（IP-04/07）**：当前授权复验 → 精确候选/上下文/策略读取 → 纯确定性逐项检查 → terminal 失败落校验证据并返回阻断；repairable 且预算剩余时沿用同模型/提示/上下文调用修正、写父子候选、再次检查 → 全部通过后 C04 写 validation + validated set → C03 登记。不得扩大预算或改变冻结版本。
4. **merge-run-candidates（IP-05/07）**：读取 work plan 并证明命令集合完整 → 精确读取所有 validated sets → C10 `embed` 冻结 riskEvent 向量并写工件 → 核心三信号聚类/独立 skip → C04 写每个 group 和 merge plan → 一个 C03 命令事务登记全部 refs/审计/回执。任一输入/embedding/登记失败不产生部分 merge plan。
5. **route-acceptance（IP-05/06/07）**：读取 merge plan 和 confidence/forced-review policies → 每组计算综合置信度 → 自动组写 route-decision 工件；人工组先写 validation/evidence snapshots，再以 provider 签发的现有 C07 授权逐组 `requestReview` → 全部路线已成立后写 acceptance-route-set 工件并登记。C07 每任务保持自己的事务；中途失败不创建 route set，已成立 C07 任务按精确 ref 对账重用，不重复请求。
6. **accept-groups（IP-06/08）**：复验 finalize 权限 → 读取 route set，检查 group/decision 一一对应 → 自动决定查 C22 registry，人工决定经 C07 窄读和当前 trace 授权 → 先在事务外完整解析并判断决定语义；修订/分离/拒绝/退回返回稳定阻断 → 为全部可验收组构造公共记录 envelope/event → 单个 C03 事务插入全部 records、命令回执、审计与 Outbox → 返回 record/event refs。唯一键竞争按同 payload 重放或冲突，不部分提交。
7. **恢复**：任何重试先按 C03 command receipt、C22 完整 ref/digest、C10 invocation id 和 C07 task ref 对账已成立效果；相同输入复用，异载荷冲突，未知外部效果不盲重发。错误/日志只含 ref、code、digest 和诊断 ref。

## 5. Schema、状态与持久化落实

- **Schema**：IP-01 仅组合 C01/C02/C21 公共 Schema；候选状态为 immutable version chain，校验 disposition 为 `accepted | repairable | terminal`，合并 disposition 为 `merged | no-duplicate`，路线为 `automatic | review`。没有开放 JSON Patch、自由字段、未声明状态或默认策略。
- **版本与身份**：候选、校验、组、计划、快照、决定、路线的 versionId 来自规范输入摘要；hash 只标识内容。模型/embedding deployment、prompt/output schema、预算、规则、仿真、merge、confidence、forced-review policy 全部保存精确 ref。
- **表与约束**：D-09 两表；中间表完整 ref 复合主键和 kind-specific CHECK；记录表 `(project_id,risk_record_id)` 唯一且 payload 每次由共享 envelope parse。两表 audit FK deferred；必要的 project/kind/input/work-plan/run 查询索引；JSONB 只存 strict ref/conclusion 或正式公共 record payload。
- **权限**：迁移对 `riskflow_app` 及现有必要 worker 角色只授 SELECT/INSERT，撤销 PUBLIC，明确无 UPDATE/DELETE；D-08 C07 读取使用 `review-audit.trace`，所有下游授权由 provider 保持或收窄。
- **事务**：中间结果 C04 后 C03 原子登记；正式 accept 单个 C03 事务内 records + command receipt + audit + outbox。C07 task/decision 是已成立外部事实，只读验证，不跨事务更新。
- **跨层引用**：C24/C25/C31 只能消费公共 `StandardizedRiskRecordRefV1` 和既有 event；不能读取 `identification_finalization_results` 或复制七字段。中间 registry 不成为 projection/API。
- **迁移**：`000042` 位于 design 指定目录；实施前确认序号唯一。`down()` 先撤权限/索引/FK，再删本 change 表；当前无后续 FK 时不预建解除块。两个中央测试文件按 IP-10 更新。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 风险候选只从冻结五项上下文生成：精确上下文生成候选 | IP-01～IP-03、IP-07、IP-09 | core + Worker runtime/composition | 合成五项 C21 payload、固定 C10 structured stub、精确模型/提示/预算 | 六字段严格、原 response/context refs、无 C08 task、正式候选登记 | V-01、V-03 |
| 同 requirement：上下文或模型输出不合格 | IP-02/03/07 | Worker tests、core | 五项缺一、错工程/版本、空/额外字段、length/timeout/budget | 结构化失败、诊断可回读、零正式候选/零 fallback | V-01、V-03 |
| 候选确定性校验：通过全部校验 | IP-01/04/07 | core + adapter | 合法 node/evidence/mechanism/rule/simulation | 逐 check 通过、modelConfidence 不取 RRF、validated ref | V-01、V-02 |
| 同 requirement：可修正错误在原预算内重试 | IP-03/04 | core + Worker runtime | 第一版格式/引用错误，第二版合法；固定总预算 | 父子版本、同模型/提示/context、预算连续、原候选不改 | V-01、V-03 |
| 同 requirement：不可修正失败封闭 | IP-02/04/07 | core + adapter | 撤权/错来源/规则冲突/仿真失败/耗尽 | terminal、证据保留、零 merge/record | V-01、V-02 |
| 全运行重复检测：多来源同一风险形成合并组 | IP-05/07 | core + Worker | 完整 work plan、固定 embeddings、跨来源证据 | 三信号阈值、稳定成员/依据、原候选保留 | V-01、V-03 |
| 同 requirement：无重复时显式跳过 | IP-05 | core | 低 event/evidence similarity | 独立非空 group、`no-duplicate`、无虚假成员 | V-01 |
| 同 requirement：合并输入不完整或策略错配 | IP-02/05/07 | core + adapter | 漏 validated set、跨 run、错 policy/deployment | 整体拒绝、零部分 plan/route | V-01、V-02 |
| 综合置信度：可重放 | IP-04/05 | core | 四依据、固定权重/缺项/舍入 | `[0,1]`、basis 齐全、重复计算相同、RRF 排除 | V-01 |
| 同 requirement：缺少策略或必需依据 | IP-02/05 | core | 无 policy、simulation required 但缺失 | BUSINESS_BLOCKED、无默认权重/阈值 | V-01 |
| 每组合并组恰好一种路线：自动验收 | IP-06/07 | core + adapter | 高置信、无 forced flag | 单 route-decision、零 review task | V-01、V-02 |
| 同 requirement：低置信/歧义人工复核 | IP-06/07 | adapter + C07 regression | C07 real PG、低置信/merge ambiguity | 精确 snapshots/task/ref，未决定不可入库 | V-02 |
| 同 requirement：路由失败不自动放行 | IP-06/07 | adapter | policy/C04/C07/audit fault injection | 无 route set、零 automatic fallback、已成立任务可对账 | V-02 |
| 验收决定逐组匹配：自动与人工共同验收 | IP-06/08 | adapter + C07 test | automatic decision + decided C07 approve/confirm | 一一对应、全部先验证、公共 records/events | V-02 |
| 同 requirement：陈旧或错配决定被拒绝 | IP-06/08 | C07 + adapter | pending/superseded/wrong target/cross-project/reject/return/revised/separate | stable blocked/stale、零部分入库；revised/separate 回前阶段 | V-02 |
| 标准化记录：合格组原子入库 | IP-01/07/08 | adapter real PG | valid groups、C03 transaction/outbox | 共享 envelope、records/audit/receipt/events 同事务、event 无正文 | V-02 |
| 同 requirement：事务任一步失败 | IP-07/08 | adapter real PG | record/audit/outbox fault injection | 全部回滚、原幂等键可重试 | V-02 |
| 同 requirement：重放和并发不重复记录 | IP-07/08 | adapter real PG | 同 command/payload、同 riskRecordId 异 payload、并发 | 原结果 / conflict；一 record、一组 events/audits | V-02 |
| 同 requirement：中间登记追加式引用边界 | IP-07/10 | adapter + foundation | C04 artifact + same/different digest、DB role | 表无正文、replay/conflict、UPDATE/DELETE 拒绝、迁移顺序 | V-02、V-04 |
| 权限与资料可见性：处理期间撤权 | IP-02/07/08 | core + adapter | 生成后撤销 source/spatial capability | 后续读/写前拒绝、零正式副作用、错误无正文 | V-01、V-02 |
| 同 requirement：跨工程引用不可枚举 | IP-02/06/07 | adapter + C07 | 其它工程 context/group/decision | 与 not-found 同形、零存在性/正文泄露 | V-02 |
| C21/C07/C10/迁移/包边界不漂移 | IP-02/03/06/09/10 | 直接依赖现有测试 + static | base 依赖全部存在 | 原行为通过、无反向依赖、无公共契约 diff | V-04～V-08 |

## 7. 文件清单与升级条件

**新增：**

- IP-01/02/04/05/06：`packages/core/src/identification/candidate-finalization/schema.ts`、`ports.ts`、`service.ts`、`index.ts`；`packages/core/test/identification/candidate-finalization.test.ts`。
- IP-07/08：`packages/adapters/src/identification/candidate-finalization/postgres-risk-candidate-adapter.ts`、`index.ts`；`packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`。
- IP-07/10：`packages/adapters/src/postgres/migrations/risk-identification/deliver-risk-candidate-validation-merge-and-acceptance/000042_risk_candidate_finalization.ts`。
- IP-03/04/05/09：`apps/worker/src/identification/candidate-finalization/runtime.ts`、`composition.ts`、`index.ts`；`apps/worker/test/identification/candidate-finalization/runtime.test.ts`、`composition.test.ts`。

**修改：**

- IP-06：`packages/adapters/src/review-audit/postgres-review-audit-adapter.ts`、`packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts`，只增加 identification-group 决定内部窄读及测试。
- IP-09：`packages/core/package.json`、`packages/adapters/package.json`、`apps/worker/src/index.ts`，只增加 C22 子路径/导出；不改依赖或 lockfile。
- IP-10：`packages/adapters/test/postgres/postgres-foundation.test.ts`、`packages/adapters/test/auth/fixture.ts`，只登记 `000042` 测试 module/manifest/白名单。

**删除：**无。**保护不改：**`packages/contracts/**`、C05 access、C21 生产代码与迁移、C07 公共契约、`apps/api/**`、`apps/web/**`、C24 图、`pnpm-lock.yaml`。

以下情况必须 escalation：任何公共 contract/event/permission 改动；`000042` 已占用或需额外迁移/表；C07 无法在既有 `review-audit.trace` 下提供窄读；C21 正式上下文不能按 ref 精确读取；C10 无法冻结 structured/embedding 模型证据；C03 不能满足 D-10 原子性；C24 work-plan seam 需要本 change 生产实现；需要新增依赖、改 protected file 或扩大 Non-Goals；base 漂移使上述命令/符号/allowlist 不存在。普通实现/测试失败、fixture 调整和 allowlist 内跨文件修复由当前 Implementation/Finalizer 任务闭合。

## 8. 验收 Agent 授权与限定审计

Finalizer 可修改 §7 新增文件和列出的修改文件，以核验、修复并回归已批准行为；必须检查 `git diff --name-only 07d1a599ae91be781c490090dad2e8a77dc2f625` 与 allowlist，运行 V-01～V-08，并按 verification instructions 记录最终 HEAD、命令、关键 skip（关键场景不得 skip）和合成样本标识。不得补公共 contract、权限、额外迁移、C24 图/API/Web 或依赖。

本 change 涉及权限、事务、人工决定状态和正式记录唯一性，默认触发一次 Targeted Auditor。Auditor 在同一 verification 补充：撤权/跨工程不可枚举；C07 pending/superseded/wrong-target 决定；C03 audit/outbox 故障回滚；同 `riskRecordId` 并发；中间表无 UPDATE/DELETE 和跨层只按公共 record ref 消费。已批准范围内普通缺陷由 Auditor 当前 Task 修复并回归；越界问题升级，不派第二次审计或新 Finalizer。
