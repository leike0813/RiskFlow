# Implementation Plan

## 1. 实施基线与权威来源

- **固定 base commit**：`5c49f20e615c6507be40b5cc74f734fba4b4fb80`；规划时 `git rev-parse HEAD` 与该值一致，工作区只有本 change 规划工件。
- **change/schema**：`deliver-assessment-configuration-and-measure-governance`；`openspec status --change ... --json` 已确认 `schemaName=riskflow-delivery`。
- **需求事实源**：本 change 的 proposal、delta spec 与 design D1～D11；相关主规格为 `domain/contract-kernel`、`domain/module-interfaces-events-workflows`、`domain/monitoring-batches-snapshots-features`、`knowledge/governed-definition-lifecycle`、`platform/content-addressed-artifact-store`、`platform/local-identity-project-authorization`、`platform/postgresql-outbox-checkpoint-foundation`、`platform/review-and-audit-runtime`。
- **直接依赖实现**：C16 `packages/core/src/knowledge-governance/{schema,lifecycle}.ts` 与 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`；C14 `packages/core/src/engineering-data/monitoring/{schema,features,service}.ts`。代码与归档规格一致，未发现 drift。
- **迁移所有权**：协调端已确认 C18 使用 `000012–000015`，C13 不占号；本计划只创建 `000012_assessment_configuration.ts`。
- **依赖**：零新增。禁止安装或修改 root manifest/workspace、依赖政策与 lockfile。
- **命令存在性**：当前 worktree 已核实 OpenSpec 1.13.0、Vitest 4.1.11、TypeScript 5.9.3、ESLint 10.9.1、Prettier 3.9.6；根 `package.json` 已声明 `build/typecheck/lint/format:check/test/deps:check/deps:policy/openspec:validate/verify`。
- **验收样例**：IP-01 创建 11 类最小完整合成配置，明确标注“合成样本、待甲方复核”；没有甲方真实配置时不伪称业务参数已获批准。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-02 | `packages/contracts/src/vocabulary/index.ts` 的 `MonitoringIndicatorSchema`、`RiskAssessmentIndicatorTypeSchema`、`QuantitativeIndicatorGroupSchema`、`WarningTriggerTypeSchema` | C18 Schema 直接 import 固定枚举 | 不另建中文/英文别名、监测指标或预警触发字符串集合 |
| IP-02 | `packages/contracts/src/ports/index.ts` 的 `KnowledgeDefinitionTypeV1Schema`、`ProjectRevisionRefV1Schema`、各精确引用 Schema | envelope、policy 输入和集合 member 直接引用 | 不修改公共 Schema，不重建 release/revision/project/artifact ref |
| IP-03 | `packages/core/src/persistence/canonical-json.ts` 的 `sha256CanonicalJson` | 计算规范文档和集合 member digest | 不新增 hash 实现或以对象字段顺序作身份 |
| IP-04 | `packages/core/src/knowledge-governance/{schema,lifecycle}.ts` 的 `KnowledgeRevisionV1Schema`、`selectGovernedReleaseCandidates` 结果 | policy 用精确 revision/release；集合解析继续由 C16 选择时态发布 | 不复制 C16 生命周期、发布选择、状态机或“最新版”逻辑 |
| IP-04 | `packages/core/src/artifacts/store.ts` 的 `ArtifactStoreV1.open` | 有界读取配置工件并等待 `verified` | 不直接读文件路径、数据库 blob 或绕过当前授权 |
| IP-05 | `packages/adapters/src/postgres/migrations/provider.ts` 的递归发现约定与 C16 migration 表 | 新目录自动发现；FK 指向既有治理/审计事实 | 不修改 provider、中央 registry 或既有 migration |
| IP-06 | `packages/adapters/src/postgres/transaction-unit.ts` 的 `getPostgresTransaction`、`TransactionUnitV1` | metadata/set/member 与 C16 事务/幂等/审计/Outbox 组合 | 不建第二套命令收据、审计或 outbox |
| IP-07 | `PostgresKnowledgeGovernanceAdapter.govern`、`#submit`、`#publish`、`#rollback`、`#runTransaction`、`resolveGovernedReleases` | 最小接入 D1 policy；保留 C16 其余分支 | 不复制或替换 C16 adapter，不实现 C19/C25 行为 |
| IP-10 | `packages/adapters/test/{artifacts,knowledge-governance,review-audit,postgres}` fixture 链 | 真实 C03/C04/C06/C07/C16/C18 migration、工件与事务 | 不创建内存 adapter、第二 migration runner 或 production seed |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 建立契约夹具 | 全部 Requirement 的合法基线；“导入完整的甲方审核配置”“完整兼容发布形成精确集合” | 新增 `packages/core/test/assessment-config/fixture.ts`：`makeAssessmentConfigurationFixtureSet`、11 个 document builder、`SYNTHETIC_PENDING_CLIENT_REVIEW` 标识 | 只生成最小、排序、互相引用的 11 文档，以及单点覆写 helper；供 core 与 adapter 测试复用 | 不进入 production export，不声称真实甲方数值，不创建 API/seed |
| IP-02 | 定义唯一内容与服务 Schema | “评估配置包具有严格类型与兼容身份”全部；“拒绝不完整指标覆盖”“任意公式 DSL 被拒绝”“混用两类阈值时拒绝”“递归或越界联合规则被拒绝” | 新增 `packages/core/src/assessment-config/schema.ts`：`ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1`、11 content Schema、`AssessmentConfigurationDocumentV1Schema`、prepared/metadata/set/request/result Schema | 按 D2/D3/D5/D6 固定 strict union、集合上限、排序唯一性、引用和服务输入输出；类型全部由 Zod 推导 | 不修改 contracts，不导出 DB row，不提供自由字段袋/公式/递归表达式 |
| IP-03 | 实现精确十进制、局部和跨配置校验 | 指标/映射、权重/聚合、矩阵、阈值、联合规则、措施、预测/偏差 Requirement 的全部确定性场景 | 新增 `packages/core/src/assessment-config/decimal.ts`：parse/compare/multiply/round/band lookup；新增 `validation.ts`：`parseAssessmentConfigurationDocument`、`validateAssessmentConfigurationSet`、`mapRiskMatrixCell`、`selectMeasureCandidates`、稳定 `AssessmentConfigurationError` | 按 D3～D6 使用 BigInt 精确校验 canonical decimal、10000 基点、axis/matrix 笛卡尔积、两类阈值、扁平 joint rule、引用完整性和候选过滤 | 不实现指标取值/P/C/预警/建议/预测/偏差，不增加 decimal/DSL 依赖 |
| IP-04 | 提供工件读取与集合解析服务 | “非法配置包整体拒绝”“发布集合固定完整兼容的精确配置”全部；“映射 C14 冻结监测特征” | 新增 `packages/core/src/assessment-config/service.ts`：D1 policy/resolver 窄接口、error shape、`readPreparedAssessmentConfiguration` 与 `AssessmentConfigurationResolverV1` 行为；新增 `index.ts` 导出 IP-02～IP-04 production 能力 | 授权后有界读取 1 MiB UTF-8 JSON、核 media type/工程/type、等待 verified；解析 11 members、重读工件核 digest、cross validate、派生稳定 set identity；闭合映射 C04/C16/C18 错误 | 不直接查询 C16/C14 表，不缓存可变“当前”集合，不返回公共 `AssessmentBasisReleaseSetRefV1` |
| IP-05 | 建立 C18 PostgreSQL 事实 | “同一配置包重放保持幂等”“发布变化不改写冻结集合”“任一原子写入失败整体回滚” | 新增 `packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.ts` 的 `up/down` | 创建 D8 三表、FK/check/unique/index、延迟 audit FK、`riskflow_app` SELECT/INSERT，撤销 UPDATE/DELETE/PUBLIC；down 精确逆序 | 不复制正文/枚举，不改 `000001`/`000007`/`000011` 或 migration provider/中央测试清单 |
| IP-06 | 实现 PostgreSQL C18 policy/store | 配置包、发布集合、配置治理 Requirement 的所有持久化/权限/幂等/审计场景 | 新增 `packages/adapters/src/assessment-config/postgres-assessment-configuration-adapter.ts`：`PostgresAssessmentConfigurationAdapter` 实现 D1 policy 与 resolver；新增 `index.ts` | `prepareRevision` 组合 IP-04 工件读取；`appendPreparedRevision` 用传入事务插 metadata；`assertRevisionMetadata` 阻断绕行修订送审；`appendRelease` 验 metadata 并构造既有 event；`resolveConfigurationSet` 用 C16 members + C04 文档在 C03 事务插 set/members/audit；统一错误映射 | 不自建 public KnowledgeModelingPort、不读取 C14 表、不复制 C16 govern SQL、不在错误/事件保存正文 |
| IP-07 | 将 C18 原子接缝接入 C16 | “导入完整的甲方审核配置”“非法配置包整体拒绝”“人工批准后发布配置”“回滚形成新的配置发布”“Agent 或无权调用不能发布”“任一原子写入失败整体回滚” | 修改 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`：options/field/constructor；`govern/#submit/#requestReview/#publish/#rollback/#runTransaction/resolveGovernedReleases` | 先 C06 授权再 prepare；把 transaction context 传 policy；C18 类型缺 policy 拒绝；submit 原子 append metadata；request-review 先验 metadata；publish/rollback 原子加入 event；resolver success 加排序 members | 非 C18 定义和 deactivate 行为不变；不新增通用 registry、公开 DTO、C19 resolve 或 retrieve |
| IP-08 | 暴露稳定 feature 子路径 | 模块可被 C19/C25/C27/C28/C29 消费 | 修改 `packages/core/package.json`、`packages/adapters/package.json` 的 `exports["./assessment-config"]` | 指向既有 `dist/assessment-config/index.{d.ts,js}`；生产源码由 IP-02/IP-03/IP-04/IP-06 的 index 导出 | 不改根 `src/index.ts`、根 manifest/workspace、依赖、锁文件或其它 exports |
| IP-09 | 验证纯领域规则 | 除治理事务外的全部 Requirement/Scenario，重点矩阵边界、两阈值、DSL、候选和策略 | 新增 `packages/core/test/assessment-config/assessment-config.test.ts`，复用 IP-01 | 表格驱动覆盖 11 strict branches、映射、覆盖、权重/策略、decimal/matrix、阈值/joint、措施、forecast/deviation、完整/不兼容 set；断言稳定 reason/ref/digest | 不精确断言完整错误文案、Zod issue 顺序、字段顺序或内部调用 |
| IP-10 | 验证真实工件、治理和 PostgreSQL | 配置包/发布集合/配置治理全部场景及其权限、事务、幂等、版本 | 新增 `packages/adapters/test/assessment-config/fixture.ts` 和 `postgres-assessment-configuration-adapter.test.ts`；修改 `packages/adapters/test/knowledge-governance/fixture.ts` 与 `postgres-knowledge-governance-adapter.test.ts` | fixture 组合真实 artifact store 与 C16/C18 adapter；全链上传 11 文档→submit→review→approve→publish→resolve；验证 `000012 up/down/up`、角色权限、metadata/event/outbox/audit、幂等/并发、invalid no revision、missing/deactivate/incompatible、rollback、旧 set 不变、故障回滚；C16 测试补非 C18 不漂移和 C18 缺 policy 拒绝 | 不改 production migration 清单，不 skip 无容器场景，不回退内存实现，不改 C16 既有行为期望 |
| IP-11 | 变更级静态/范围/OpenSpec 验证 | 所有 Requirement/Scenario 的可执行证据收口 | 无生产文件；检查 IP-01～IP-10 产物与 git/OpenSpec 状态 | 运行 §6 全部命令，核对 protected paths、无新增依赖、无 Mock/TODO/DSL/默认配置、每个失败边界有证据 | 不提交、不归档、不启动服务、不修改 tasks 勾选以外的规划目标 |

删除文件：无。API/Worker/Web：无计划文件；C09 generic HTTP route 已能转发 C02 命令，但 C18 不新增应用装配或页面，后续由 C19/C32 完成。

## 4. 调用与副作用顺序

### 4.1 配置导入（IP-04、IP-06、IP-07）

1. `PostgresKnowledgeGovernanceAdapter.govern(submit-revision)` 以 C02 strict Schema 解析，先调用 C06 `LocalIdentityAccessV1.verify` 校验工程与 `knowledge-modeling.govern`；无权时尚未读取工件或目标。
2. 非 C18 type 直接沿 C16 原路径。C18 type 缺 policy 返回 `BUSINESS_BLOCKED/assessment-configuration-policy-required`；存在 policy 则 `prepareRevision` 通过 C04 `open` 重新校验当前授权、media type、长度、完整性，完整消费并等待 verified。
3. IP-02/IP-03 校验 document type/project/local invariants，生成 canonical digest 和有界摘要；任何失败在 C16 transaction 前结束，无 revision/audit/receipt。
4. C16 进入原 `TransactionUnitV1.execute`，按原锁和 base/identity 校验创建 knowledge definition/revision；同一 transaction context 调用 `appendPreparedRevision` 插入 metadata，使用同一 audit entry id。
5. C03 原子提交 revision、metadata、audit、receipt，events 为空；同键同载荷返回原 revision，同键异载荷整体 `IDEMPOTENCY_CONFLICT`。metadata/FK/audit 失败使全部回滚。

### 4.2 送审、发布、停用与历史版本重新发布（IP-06、IP-07）

1. `request-review` 完全沿 C16；C18 revision 必须已存在 metadata，否则在送审目标校验处 `BUSINESS_BLOCKED`，避免旧绕行修订进入发布。
2. publish/rollback 先执行 C16 C06 授权、人类 invocation、精确 revision/release、C07 approval proof、时间线与幂等检查。
3. C16 transaction 持有原 definition lock 后生成新 release ref；`appendRelease` 通过精确 revision metadata 核对 C18 type、project、artifact digest 与 project revision，构建一个 `knowledge.assessment-basis-published.v1`。
4. C03 原子提交 release、必要 review link 补齐、audit、receipt、outbox event；任何 policy/DB/audit/event failure 全部回滚。重放返回原 release/event refs，不重复 outbox。
5. deactivate 只追加 C16 决定，不产生“published”事件；旧 revision、release、metadata 和已物化 set 不变，新解析按 C16 as-of 语义排除。

### 4.3 配置集合解析（IP-04、IP-06）

1. 调用方提交精确 project/project revision/requiredAt/asOfRecordedAt/auth/request/idempotency；先校验 `knowledge-modeling.read`，不先探测成员。
2. 注入的 C16 resolver 用工程、11 definition types 和双时间查询，返回唯一有效 release refs 及其 revision/artifact members；缺失/停用/未生效整体失败。
3. 对 11 artifacts 逐一用 C04 当前授权有界读取，核 metadata digest，然后 IP-03 验同 project revision/configurationSetRef 及所有 cross references。
4. canonical member 列表派生 deterministic set identity。在 C03 transaction 中插 set + 11 members + audit/receipt；数据库唯一约束收口并发相同集合。
5. 成功返回私有 set ref 与精确 members。后续新发布/停用/rollback 只影响新 resolve；旧 set 表和 member refs 不更新。失败不返回部分 members 或默认/历史内容。

### 4.4 错误、可观测性与重试（IP-04、IP-06、IP-07、IP-10）

- 授权/不可枚举、not-found/stale、business-blocked、idempotency、transient/terminal 按 D9 映射；普通错误只暴露 code、stage/reason 和获准 refs。
- Zod issues、配置字节、字段值、SQL 错误只用于受保护诊断，不进入日志、事件或 API error。
- artifact/database 临时故障允许沿原 command/request identity 重试；不换 artifact、模型或默认配置。结构/兼容错误不可通过重试绕过。
- C18 无 Agent 任务；P/C、矩阵、阈值和发布均确定性执行。Agent authorization 由 C16 在 publish/deactivate/rollback 前拒绝。

## 5. Schema、状态与持久化落实

- **Schema SSOT（IP-02）**：11 个 definition type 直接取 C02；监测/指标/触发枚举直接取 C01；C18 document、decimal、内容、metadata、set 只在 `@riskflow/core/assessment-config` 定义，adapter 不重建字段。
- **内容状态**：artifact durable/verified（C04）→ prepared（内存、未成立业务事实）→ C16 revision + C18 metadata（原子成立）→ C16 in-review/approved/published/deactivated（C16 派生）→ C18 immutable configuration set（显式 resolve）。无可覆盖 current 行。
- **十进制与矩阵（IP-03）**：最多 6 位 canonical decimal 全程 BigInt；axis contiguous、left-closed/right-open、last inclusive；cell 笛卡尔积 complete。任何转换为 JS number 只允许最终受界展示，不用于校验/映射。
- **持久化（IP-05/IP-06）**：正文仅 C04；metadata 保存精确 refs/digest/计数摘要；set/member 只追加。所有写入经 C03 transaction，audit FK `DEFERRABLE INITIALLY DEFERRED`。
- **权限（IP-05/IP-07）**：app SELECT/INSERT，零历史 UPDATE/DELETE；业务命令先 C06；artifact 再 C04；human-only 复用 C16。PUBLIC/outbox worker/checkpointer 无 C18 表权限。
- **版本（IP-06）**：document schema version、project revision、configuration set ref、C16 release/revision/artifact refs、required/as-of、digest 全冻结；新版本只追加 revision/release/set。
- **事件（IP-06/IP-07）**：publish/rollback 各一个既有 event，payload 不新增字段；deactivate 无伪造 publish event；set resolve 不发布跨阶段事件。
- **迁移（IP-05）**：`000012` 单文件，无中央注册/回填；up/down/up 真实验证。若实现发现 `000012` 已占用，立即 ask，禁止自行换号。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 评估配置包具有严格类型与兼容身份 / 导入完整的甲方审核配置 | IP-01, IP-02, IP-04, IP-06, IP-07, IP-10 | `packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts` | 真实 C04 工件、C16 govern、合成合法 document | verified 后 revision+metadata 同时存在；无 Agent | `pnpm exec vitest run packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts --testTimeout=240000` |
| 同 Requirement / 非法配置包整体拒绝 | IP-02, IP-04, IP-07, IP-10 | 同上 | 未知字段/type/project/media/size/JSON 变体 | `BUSINESS_BLOCKED`/授权失败；零 revision/metadata/audit success | 同上 |
| 同 Requirement / 同一配置包重放保持幂等 | IP-05, IP-06, IP-07, IP-10 | 同上 | 同 command 与 changed payload | 同载荷同 ref/单事实；异载荷 `IDEMPOTENCY_CONFLICT` | 同上 |
| 指标体系和字段映射显式连接冻结输入 / 映射 C14 冻结监测特征 | IP-01, IP-02, IP-03, IP-09 | `packages/core/test/assessment-config/assessment-config.test.ts` | 六项指标与四项 feature 表格 | source/metric/unit/target 精确保留且 cross validate | `pnpm exec vitest run packages/core/test/assessment-config/assessment-config.test.ts` |
| 同 Requirement / 拒绝猜测式字段或单位映射 | IP-02, IP-03, IP-09 | 同上 | JSONPath、未知 feature、unit mismatch、missing target | stable reason，parse/set validation 失败 | 同上 |
| 同 Requirement / 拒绝不完整指标覆盖 | IP-02, IP-03, IP-09 | 同上 | 缺 P/C、仅一量化组 | Schema/validation 失败 | 同上 |
| 权重与聚合策略使用闭合确定性模型 / 精确权重集可以发布 | IP-02, IP-03, IP-09 | 同上 | P/C basis points tables | 两轴完整且各和 10000 | 同上 |
| 同 Requirement / 聚合策略与权重不兼容时拒绝 | IP-03, IP-09 | 同上 | missing/wrong-axis/maximum-with-weight | `assessment-configuration-incompatible` | 同上 |
| 同 Requirement / 任意公式 DSL 被拒绝 | IP-02, IP-09 | 同上 | formula/expression/script unknown fields | strict parse false | 同上 |
| 风险矩阵使用无歧义十进制边界与穷尽单元 / 非 5×5 矩阵通过完整校验 | IP-01, IP-02, IP-03, IP-09 | 同上 | 3×4 complete matrix | accept, 12 unique cells | 同上 |
| 同 Requirement / 共享边界只有一个归属 | IP-03, IP-09 | 同上 | lower/shared/final upper decimals | exact expected band/cell, deterministic replay | 同上 |
| 同 Requirement / 缺口、重叠或矩阵缺格整体拒绝 | IP-03, IP-09 | 同上 | table-driven gap/overlap/reverse/noncanonical/missing/duplicate | stable reason，无补格 | 同上 |
| 风险可接受阈值与监测预警阈值保持分离 / 风险等级越限只使用接受阈值 | IP-02, IP-03, IP-09 | 同上 | risk threshold + matrix levels | 仅 level ref 可用，monitor fields strict reject | 同上 |
| 同 Requirement / 监测值和趋势越限只使用监测阈值 | IP-02, IP-03, IP-09 | 同上 | value/slope/accel/frequency/anomaly variants | metric/operator/boundary/unit exact | 同上 |
| 同 Requirement / 混用两类阈值时拒绝 | IP-02, IP-09 | 同上 | cross fields/refs | strict parse false | 同上 |
| 联合触发规则只能组合已发布监测阈值 / 合法多指标联合规则可重放 | IP-02, IP-03, IP-09 | 同上 | all/any/at-least refs | ordered unique refs and valid count | 同上 |
| 同 Requirement / 递归或越界联合规则被拒绝 | IP-02, IP-03, IP-09 | 同上 | nested/duplicate/missing/risk/count variants | parse/cross validate fails | 同上 |
| 措施库限制候选并固定目标与适用性 / 按风险与适用性形成冻结候选 | IP-01, IP-02, IP-03, IP-09 | 同上 | two measures, matching/nonmatching applicability | only matching sorted ids/versions; input immutable | 同上 |
| 同 Requirement / 候选外措施不可进入正式建议 | IP-02, IP-03, IP-09 | 同上 | unknown measure ref | selection/validation rejects; library unchanged | 同上 |
| 预测与偏差策略只声明可执行的版本化口径 / 预测和偏差使用同一冻结口径 | IP-02, IP-03, IP-09 | 同上 | three forecast methods/three deviation kinds | target/unit/horizon/version compatibility | 同上 |
| 同 Requirement / 无预测不得产生替代偏差 | IP-02, IP-03, IP-09 | 同上 | missing forecast binding | no default value/path; validation failure | 同上 |
| 同 Requirement / 偏差越限不直接改配置 | IP-02, IP-03, IP-09 | 同上 | threshold exceeded input | output only policy/candidate eligibility, no mutation field | 同上 |
| 发布集合 / 完整兼容发布形成精确集合 | IP-01, IP-04, IP-05, IP-06, IP-10 | adapter test | 11 approved C16 releases, same project/config set | one immutable set, 11 members, same digest/ref replay | adapter command above |
| 同 Requirement / 发布变化不改写冻结集合 | IP-05, IP-06, IP-10 | adapter test | set A then new publish/deactivate/rollback and set B | set A rows/digest unchanged; B explicit | adapter command above |
| 同 Requirement / 不完整或不兼容集合不降级 | IP-03, IP-04, IP-06, IP-10 | core + adapter tests | missing/deactivated/cross-project/set/ref mismatch | waiting/business blocked, zero partial set | `pnpm exec vitest run packages/core/test/assessment-config/assessment-config.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts --testTimeout=240000` |
| 配置治理复用人工发布、原子审计与最小披露 / 人工批准后发布配置 | IP-06, IP-07, IP-10 | adapter test | real review approval + outbox | release+audit+receipt+one event; payload only refs | adapter command above |
| 同 Requirement / 回滚形成新的配置发布 | IP-06, IP-07, IP-10 | adapter test | publish/deactivate/approve historical/rollback | new release/event, old facts/set retained | adapter command above |
| 同 Requirement / Agent 或无权调用不能发布 | IP-07, IP-10 | adapter + C16 test | agent, wrong project, missing capability | `AUTHORIZATION_DENIED` before target/artifact; zero writes | `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/assessment-config/postgres-assessment-configuration-adapter.test.ts --testTimeout=240000` |
| 同 Requirement / 任一原子写入失败整体回滚 | IP-05, IP-06, IP-07, IP-10 | adapter test | deferred audit/outbox/metadata/member fault injection | zero partial facts; same identity retry succeeds | adapter command above |
| C16/C14 回归与导出边界 | IP-07, IP-08, IP-10, IP-11 | existing C16/C14 tests + TypeScript | non-C18 definition and monitoring fixtures | existing behavior unchanged; subpath resolves | `pnpm exec vitest run packages/core/test/engineering-data/monitoring.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts --testTimeout=240000 && pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false` |
| 静态、依赖、格式、OpenSpec、范围 | IP-11 | repository checks | completed IP-01～IP-10 | all exit 0; diff only allowlist; no protected path/dependency | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy && openspec validate deliver-assessment-configuration-and-measure-governance --strict --no-interactive && git diff --check` |

实现 Agent只在行为与对应命令通过后勾选 task。PostgreSQL 容器不可用必须报告失败，不得 skip 或改用内存实现；根 `pnpm test`/`pnpm verify` 留给主调度在检查点按风险决定，C18 最小必跑命令如上。

## 7. 文件清单与升级条件

### 新增文件及唯一 IP 归属

- IP-01：`packages/core/test/assessment-config/fixture.ts`
- IP-02：`packages/core/src/assessment-config/schema.ts`
- IP-03：`packages/core/src/assessment-config/decimal.ts`、`validation.ts`
- IP-04：`packages/core/src/assessment-config/service.ts`、`index.ts`
- IP-05：`packages/adapters/src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.ts`
- IP-06：`packages/adapters/src/assessment-config/postgres-assessment-configuration-adapter.ts`、`index.ts`
- IP-09：`packages/core/test/assessment-config/assessment-config.test.ts`
- IP-10：`packages/adapters/test/assessment-config/fixture.ts`、`postgres-assessment-configuration-adapter.test.ts`

### 修改文件及唯一 IP 归属

- IP-07：`packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts`
- IP-08：`packages/core/package.json`、`packages/adapters/package.json`
- IP-10：`packages/adapters/test/knowledge-governance/fixture.ts`、`packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts`

### 删除文件

无。

### 保护区

不得修改：`packages/contracts/**`、`apps/**`、`packages/core/src/engineering-data/monitoring/**`、`packages/adapters/src/engineering-data/monitoring/**`、`packages/core/src/knowledge-governance/**`、C16/C14 既有 migrations、`packages/adapters/src/postgres/{bootstrap,pool,types,transaction-unit,outbox,idempotent-consumer,checkpointer,index}.ts`、migration provider/run、`packages/adapters/test/postgres/postgres-foundation.test.ts` 中央迁移测试清单、根 `package.json`/workspace/config/scripts、`config/dependency-policy.json`、`pnpm-lock.yaml`、`openspec/config.yaml`、主 specs、归档和其它 change。

### 必须 ask/escalation 的条件

- HEAD 不再是固定 base，或计划符号/签名不存在、已有用户改动与 allowlist 重叠。
- `000012` 已占用，或单 migration 无法表达 D8；不得自行改号或使用 `000013–000015`。
- 需要修改 `packages/contracts/**`、公共事件 payload、端口结果、C14 Schema/算法、C16 core 生命周期或任何保护区。
- D1 专用 policy 无法在 C16 原事务内保证 revision metadata 或 publish/rollback event 原子性。
- C04 无法在现有授权下验证 JSON 工件，或必须新增依赖、可执行公式/DSL、默认配置、生产 seed/Mock。
- 发现主 specs、C14/C16 归档工件与代码 drift，或 C19 的适用规则被证明必须进入 C18 私有集合才能满足本 change。
- 任一计划命令不存在，真实 PostgreSQL 测试失败且修复需要计划外文件/权限/依赖/契约，或 Requirement/Scenario 无法由 §6 证据证明。

以上条件外不存在会改变接口、持久化、权限、依赖、范围或任务拆分的 Open Question。
