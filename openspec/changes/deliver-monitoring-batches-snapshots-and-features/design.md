## Context

见 [proposal.md](./proposal.md) 与 [监测批次、快照和特征 delta spec](./specs/domain/monitoring-batches-snapshots-features/spec.md)。C02 已冻结 `MonitoringSeriesRefV1`、`MonitoringBatchRefV1`、`MonitoringSnapshotRefV1` 以及 `EngineeringDataPortV1` 的 `register-monitoring-batch`、`monitoring-snapshot` freeze/read 分支；C11 的 PostgreSQL composition 目前只实现来源登记，并对这三个分支返回 `UNSUPPORTED_CONTRACT`。C14 必须补齐这些既有分支，不能修改 `packages/contracts/**` 或另建公共端口。

C11 已提供工程/区段业务修订、资料版本/资料段、适用性快照及 `PostgresEngineeringContextSourceRegistry`，并复用 C03 `TransactionUnitV1`、C04 `ArtifactStoreV1`/`ArtifactReferenceGuardV1`、C06 `LocalIdentityAccessV1`、C07 审计事实。C14 位于同一 `engineering-data` 所有权内，只通过事务内窄查询读取精确 C11 业务事实，不更新或复制 C11 数据，也不复制授权逻辑。

RI-S21 要求监测数据时间对齐、异常值和缺失值处理，并计算短期斜率、加速度、频域主峰和监测摘要；RA-S1 要求监测数据按时间对齐并提供斜率、加速度、异常评分。项目 Agent-native 基线又把数据清洗与业务部分可用判断归 C15 的必经 Agent。C14 因此只拥有原始/规范化监测事实、确定性时间对齐、四项基础特征及算法可计算性；异常值排除、修正、业务可用结论和清洗增量仍由 C15 拥有。

依赖版本沿用 workspace 已锁定的 Node.js 24、TypeScript、Zod 4.5.4、Kysely 0.29.5、pg 8.23.0 和测试侧 Testcontainers 12.1.0。C14 使用标准 `Math` 和有界 O(n²) DFT，不修改 manifest、依赖政策或 lockfile；若目标规模基准证明频域计算不能满足要求，再开独立依赖 change。

## Goals / Non-Goals

**Goals:**

- 用一个监测子模块定义序列修订、样本工件、批次关系、快照策略、对齐点、特征和可计算性 Schema，并从 Schema 派生 TypeScript 类型。
- 在现有 C11 PostgreSQL composition 中补齐 C02 的三个监测分支，保持其它 `apply`、`freeze`、`read` 分支行为不变。
- 让原始、更正、补录、单位换算、双时间快照、特征和审计形成可重放链，不让持续到达的数据改变旧快照。
- 固定算法、状态、权限、错误、事务、表结构、文件所有权和最小数值验证，使实现阶段无需补做领域决策。

**Non-Goals:**

- 不实现 XLSX/CSV 解析、上传/API/数据库/实时流入口；C14 从 C04 中读取已由调用方形成的版本化 NDJSON 样本工件。
- 不实现 C15 数据清洗 Agent、异常值删除/替换、缺失值任意填补、清洗增量和业务部分可用决定。
- 不实现 C18 指标映射、监测阈值、联合规则与策略治理；C14 只验证并冻结调用方提供的精确策略内容与引用。
- 不实现 C25 P/C、风险矩阵、预警触发，C28 反馈/偏差，UI、API、Worker、查询投影或外部事件消费者。
- 不修改 `packages/contracts/**`，不新增第三方依赖，不启动服务，不创建内存 adapter 或开放 repository。

## Decisions

### 1. 在 C11 composition 中组合一个同所有者监测服务

新增 `packages/core/src/engineering-data/monitoring/`，公开纯领域能力与 `MonitoringRegistryV1` 窄接口：

```ts
interface MonitoringRegistryV1 {
  reviseSeries(command: ReviseMonitoringSeriesCommandV1): Promise<MonitoringResultV1>;
  registerAvailabilityPolicy(command: RegisterMonitoringAvailabilityPolicyCommandV1): Promise<MonitoringResultV1>;
  resolveSnapshotQuery(query: ResolveMonitoringSnapshotQueryV1): Promise<MonitoringResultV1>;
}
```

`reviseSeries` 和 `registerAvailabilityPolicy` 是 C14 创建序列修订与不可变策略的同模块写入口，`resolveSnapshotQuery` 只解析已经由公共 `read` 授权并登记的精确查询结果；它们不进入 C02，因为当前没有相应跨模块用例。`PostgresEngineeringContextSourceRegistry` 继续作为唯一公共 `EngineeringDataPortV1` composition，通过注入的 `PostgresMonitoringStoreV1` 把现有三个监测分支委派给 C14，并保持来源登记、上下文窄接口及仍未实现分支原样。监测 store 使用同一事务连接对 C11 `business` 事实执行按精确引用限定的只读查询，不引入开放 repository，不更新 C11 表。

**选项：**（A）直接把全部监测逻辑加进约 2,000 行 C11 adapter；（B）另建第二个 `EngineeringDataPortV1`；（C）C11 composition 委派同所有者监测子模块。  
**决定：** C。A 继续膨胀深文件，B 造成端口装配冲突；C 保持公共端口唯一并隔离算法与存储。

### 2. 领域 Schema 固定批次、快照和策略，公共 DTO 保持不变

`schema.ts` 复用 C01/C02 引用和固定 `MonitoringIndicatorSchema`，所有对象为 strict Schema，集合规范排序且有界：

| 对象 | 必含内容 |
| --- | --- |
| `MonitoringSeriesRevisionV1` | 稳定 series ID、`MonitoringSeriesRefV1` 精确修订、工程/空间修订、监测对象、固定监测指标、参数码、规范单位、单位换算、有效/记录时间、前序修订、审计 |
| `MonitoringSampleInputV1` | `sourceSampleKey`、`sampledAt`、有限 `value`、`unit`、至少一个 `EvidenceReference` |
| `MonitoringSampleArtifactV1` | NDJSON 首行 envelope 固定 `schemaVersion: "1"`、序列引用、工程/空间引用、来源版本/资料段集合、生产策略版本和样本数；后续逐行一个样本 |
| `MonitoringBatchV1` | batch ref、序列修订、delivery key/fingerprint、工件/来源 refs、时间窗、`original \| correction \| supplement`、前序批次、样本计数、记录/审计 |
| `MonitoringSampleVersionV1` | 样本版本身份、批次、来源键、采样时间、原值/单位、规范值/单位、前序样本版本、关系和证据 |
| `MonitoringAvailabilityPolicyV1` | 精确 ref、窗口、网格间隔、最大插值跨度、各特征窗口/最少样本、MAD 尺度下限、覆盖/缺失界限、最大频域样本数、算法版本集合 |
| `MonitoringSnapshotV1` | snapshot ref、序列修订、cutoff、recordedAt、策略/算法版本、实际 batch/sample refs、对齐点、四项特征、`available \| partial \| unavailable`、逐项原因、来源授权快照、审计 |
| `MonitoringSnapshotQueryV1` | 精确 snapshot ref 与可展示的冻结数据、特征、可用性、版本、获准证据摘要；作为 `QueryResultRefV1` 背后的 C14 事实 |

单位只允许 1～32 个 ASCII 字符的显式代码。每个序列修订至少声明规范单位的 identity 规则；其它输入单位以不可重复的 `{fromUnit, scale, offset}` 定义仿射换算 `canonical = value * scale + offset`，`scale` 必须有限且非零。C14 不维护全局单位词典，也不猜测中文别名；C18 后续只按序列/快照冻结的单位字段映射指标。

`MonitoringSampleArtifactV1` 使用 `application/x-ndjson`，而非把大数组读入一个 JSON 对象。首行 envelope 最多 64 KiB，单样本行最多 16 KiB，每批最多 100,000 个样本，整个工件仍受 C04 `maxArtifactBytes` 控制；读取逐行解码，超过任一上限立即失败。样本必须按 `(sampledAt, sourceSampleKey)` 严格递增，同一工件不得重复采样时间。

**选项：**（A）自由 CSV/表格对象；（B）单个 JSON 大数组；（C）版本化 NDJSON。  
**决定：** C。它可严格校验且可流式读取；格式解析仍留在 C12/C15 或后续接入 change。

### 3. 批次登记先验证工件，再在单事务中只追加

`register-monitoring-batch` 流程固定为：

1. strict 解析 C02 命令，核对分支能力、工程与目标序列修订；调用 C06 `verify` 校验当前工程/空间和样本来源资料权限。
2. 通过 C04 `ArtifactStoreV1.open` 流式读取 NDJSON；核对 manifest、media type、工程/空间/资料授权和 envelope 的精确引用，并完整等待 `verified`。
3. 逐样本校验顺序、命令窗口 `[from,to)`、有限值、单位规则与证据，通过仿射规则计算规范值；使用增量 canonical SHA-256 形成样本 fingerprint，不缓存原始工件全文。
4. 对 `correction`/`supplement` 读取并锁定同序列前序批次。更正要求每个时间点已有当时有效样本且规范值不同；补录要求时间早于既有最大采样时间且该时点从未有有效样本；`original` 不得与已有有效时间点产生不同值。
5. 使用 C03 `TransactionUnitV1` 在一个事务内写批次、样本版本、命令收据与审计，`events: []`。数据库唯一约束和 advisory/行锁收口并发语义。

语义重复键为 `(project_id, series_revision_id, delivery_fingerprint)`；fingerprint 包含规范化样本、命令时间窗、批次关系、精确来源版本/资料段和逐样本证据，不包含 command ID 或 delivery key。来源与证据相同的完全重复交付命中时返回既有 batch ref；相同数值来自不同来源或证据时形成独立批次，保留未来多来源合并所需事实。C03 的幂等键仍负责同键同/异载荷语义。批次 identity 与每个样本版本 identity 从 `series ref + fingerprint` 确定性生成，避免并发竞态产生不同引用。

C14 不为批次创建 C11 `SourceVersionV1` 副本。样本工件 envelope 必须引用其来源 `SourceVersionRefV1` 和 `SourceSegmentSetRefV1`；批次/样本直接保存这些精确引用和 `EvidenceReference`，从而贯通 RI-S13/RI-S14，而不重建资料所有权。

### 4. 快照使用 bitemporal 选择并物化实际成员

`freeze(monitoring-snapshot)` 在 C03 `REPEATABLE READ` 写事务内取数据库 `clock_timestamp()` 为 `recordedAt`，锁定精确序列修订和精确策略内容。策略的 `windowDurationMs` 形成 `(cutoff-windowDurationMs, cutoff]` 业务窗口；只选择 `sampledAt <= cutoff` 且 batch `recordedAt <= snapshot.recordedAt` 的样本版本。

同一采样时间的有效值按更正链选择在 snapshot `recordedAt` 已存在的最后一个合法版本；补录只增加此前不存在的时间点。快照把实际 batch refs、sample refs 和选择原因物化到成员表，之后不再重跑“当前有效值”查询。相同命令幂等重放返回原快照；不同命令即使 cutoff/策略相同也创建新 snapshot，保留各自 record time，除非命中完全相同的 C03 幂等键。

空窗口不是技术失败：创建 `unavailable` 快照并保存 `no-samples`。序列/策略不存在、跨工程、陈旧或未授权分别映射到 C02 闭合错误；不能计算某项特征也不使整个快照失败。

### 5. 对齐、特征和可计算性由纯函数一次计算

`features.ts` 提供纯函数，输入已按时间排序的冻结规范样本和已校验策略，输出对齐点、四项特征及原因。所有时间以 Unix epoch 毫秒计算；网格以 cutoff 向过去按 `intervalMs` 对齐，精确样本优先。缺点只在左右样本都存在且间隔不超过 `maxInterpolationGapMs` 时线性插值，保存两个 source sample refs；禁止外推、最近值或零填充。

公式固定如下：

- 短期斜率：策略最后 `slopeWindowSize` 个连续有效点，对 `t=(sampledAt-first)/1000` 与规范值做普通最小二乘，输出 `canonicalUnit/s`。
- 加速度：在最后 `accelerationWindowSize` 个连续有效点上先算相邻一阶斜率 `(vᵢ-vᵢ₋₁)/(tᵢ-tᵢ₋₁)`，再对每段中点时间与这些斜率做普通最小二乘，输出 `canonicalUnit/s²`；至少三个点。
- 频域主峰：最后 `frequencyWindowSize` 个连续等间隔有效点，先减算术均值，再乘 `w[n]=0.5*(1-cos(2πn/(N-1)))`；用标准 `Math.sin/cos` 计算实数 DFT，仅扫描 `k=1..floor(N/2)`，功率 `re²+im²`，并列按最低频率，频率为 `k/(N*intervalSeconds)`。常量序列或所有正频率功率不大于策略 `frequencyPowerFloor` 时返回 `no-dominant-frequency`；不补零，`N <= maxFrequencySamples <= 512`。
- 异常评分：当前点之前最后 `anomalyBaselineSize` 个连续有效值为基线，`median` 使用排序中值，`MAD=median(|x-median|)`，有符号分数为 `(current-median)/max(1.4826*MAD, anomalyScaleFloor)`；输出无量纲。当前值不参与基线。

所有中间量和输出必须有限；数值退化返回单项 `unavailable` 原因，不保存 `NaN`/`Infinity`。快照总可用性由策略确定：没有有效点或覆盖率低于 `minimumCoverageRatio` 为 `unavailable`；存在有效点但有缺点或任一必需特征不可计算为 `partial`；其余为 `available`。这只是算法可计算性，不执行 C15 的异常排除或业务覆盖判断。

**选项：**（A）引入 `fft.js`；（B）手写 radix-2 FFT；（C）限制 N≤512 的朴素 DFT。  
**决定：** C。一次快照的最坏 262,144 个频点乘加在 Node 24 可直接验证，代码和供应链更小；基准超限时才用新 change 替换实现。

### 6. 查询结果是持久化窄投影引用，不返回开放正文

`read(monitoring-snapshot)` 先读取快照的工程、空间及来源资料授权快照，再调用 C06 `verify` 重新校验当前权限。成功时在一个 C03 事务中幂等登记 `business.monitoring_snapshot_query_results`，只保存 query result ref、目标 snapshot ref、请求授权上下文、记录时间和审计；返回 C02 `QueryResultRefV1`。实际读取 DTO 由 C14 窄只读接口按该 query ref 获取，严格限定为冻结成员、对齐点、特征、可用性、策略/算法版本和获准证据摘要。

无权、跨工程与不存在统一返回 `AUTHORIZATION_DENIED`，避免枚举。读取审计失败不得返回成功引用。C14 不引入通用 projection/query repository；C30/C36 需要页面查询时使用其 own projection change 消费领域事实。

### 7. PostgreSQL 迁移 000011 使用只追加事实表

协调方已预分配迁移号，路径固定为：

```text
packages/adapters/src/postgres/migrations/engineering-data/
  deliver-monitoring-batches-snapshots-and-features/
    000011_monitoring_batches_snapshots_features.ts
```

表位于既有 `business` schema：

| 表 | 作用 |
| --- | --- |
| `monitoring_series` / `monitoring_series_revisions` | 稳定序列 identity/current pointer 与不可变修订 |
| `monitoring_batches` | 不可变交付、fingerprint、时间窗、原始/更正/补录关系和来源工件 |
| `monitoring_sample_versions` | 原值、规范值、采样时间、来源键、前序样本版本和证据 |
| `monitoring_availability_policies` | 精确策略版本及 canonical 内容摘要；C18 接管治理前由受控种子/命令登记 |
| `monitoring_snapshots` | cutoff/recordedAt、策略/算法版本、可用性、计数、摘要和审计 |
| `monitoring_snapshot_members` | 每个快照实际采用的 batch/sample 版本及成员顺序 |
| `monitoring_snapshot_points` | 有界对齐点、缺失/插值原因及来源样本 refs |
| `monitoring_snapshot_features` | 四项特征值/单位/窗口/输入数、状态和原因 |
| `monitoring_snapshot_query_results` | 查询结果 identity、精确 snapshot ref、授权/审计 |

稳定 identity 表只允许 current pointer 的 compare-and-swap；修订、批次、样本、策略、快照、成员、点、特征、查询结果表对 `riskflow_app` 只授予 SELECT/INSERT。PUBLIC、Outbox Worker 和 checkpointer 无权访问；应用角色无 DELETE/DDL/历史 UPDATE。FK/check/unique 至少保证工程归属、修订链、同序列批次关系、fingerprint 唯一、时间窗正序、有限 JSON/数值、每快照成员顺序唯一和每快照四种特征至多一项。跨模块 C04/C06/C11 引用仍由 guard/服务校验，不建跨所有者 FK。

迁移必须提供 `down`，按子表到父表逆序删除，并验证 `up/down/up`。当前主线并行 change 已占用其它序号，C14 不自行改号。

### 8. 授权、错误、事务和审计复用既有事实源

序列修订和批次登记要求 `engineering-data.write`，快照要求 `engineering-data.freeze`，查询要求 `engineering-data.read`。每次副作用前先执行 C06 当前授权校验；样本工件读取再由 C04 校验资料授权和正文访问。任何 child context 只能保持或收窄工程、空间和 source grant。

领域失败只映射到 C02 `ModuleErrorV1`：无权/不可枚举为 `AUTHORIZATION_DENIED`，缺少精确已授权前序可用 `ENTITY_NOT_FOUND`，陈旧序列/批次/策略为 `STALE_VERSION`，同键异载荷为 `IDEMPOTENCY_CONFLICT`，关系/单位/样本/策略不变量为 `BUSINESS_BLOCKED`，可重试数据库/工件故障为 `TRANSIENT_FAILURE`，其余为 `TERMINAL_FAILURE`。strict Schema 无法识别的公共命令仍为 `UNSUPPORTED_CONTRACT`。普通错误不包含样本值或来源正文。

每次成功序列修订、批次、快照和查询结果在同一个 C03 事务内提交领域事实、command receipt 与 audit，事件数组为空。审计目标使用精确 public ref，关联操作者、授权、命令/幂等、业务/记录时间及可用的原因 ref。C14 不发布 `engineering.assessment-input-changed.v1`：只有后续所属流程能同时拥有并比较 previous/new 快照及评估上下文。

### 9. 验证集中在一个纯函数测试和一个 PostgreSQL 集成测试族

核心测试使用参数化代表用例覆盖 strict Schema、单位换算、网格、OLS、加速度、Hann+DFT、median/MAD、缺样原因和确定性重放；不精确断言完整错误文案、SQL、字段顺序或私有调用。地表沉降数值样例用独立直接公式交叉验证四项特征，容差按特征显式设定。

PostgreSQL 集成测试扩展现有 C11 fixture，使用真实 C03/C04/C06/C07/C11 migrations 和现有 Testcontainers PostgreSQL，覆盖 `000011` 的 `up/down/up`、角色权限、序列修订、NDJSON 边界、批次幂等/并发、原始/更正/补录、整批回滚、双时间快照、后续数据不改旧快照、查询权限撤销、审计原子性及零 C14 事件。没有容器时测试失败，不回退内存 adapter。

结构上限不是性能 SLA：每批最多 100,000 样本，快照对齐点最多 10,000，频域 N≤512；实现需记录测试样例数量与 wall time，不新增 metrics 框架。C38 再按真实目标硬件制定 SLA。

### 10. 文件所有权与禁止修改区

新增：

```text
packages/core/src/engineering-data/monitoring/{schema,features,service,index}.ts
packages/core/test/engineering-data/monitoring.test.ts
packages/adapters/src/engineering-data/monitoring/{postgres-monitoring-store,index}.ts
packages/adapters/src/postgres/migrations/engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.ts
packages/adapters/test/engineering-data/monitoring/{fixture,postgres-monitoring-store.test}.ts
```

修改：

```text
packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts
packages/adapters/test/engineering-data/context-source/fixture.ts
packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts
packages/adapters/test/postgres/postgres-foundation.test.ts
packages/core/package.json
packages/adapters/package.json
packages/core/src/index.ts
packages/adapters/src/index.ts
```

前四个新增实现文件承担 Schema/纯算法/窄服务，adapter 子模块承担 PostgreSQL，C11 文件只增加注入/委派，不复制监测逻辑。package manifest 只增加 `./engineering-data/monitoring` export；根 barrel 只增加对应导出。

禁止修改：`packages/contracts/**`、`apps/**`、C03/C04/C06/C07/C11 已有 Schema 和 migrations、其它领域目录、根 manifest、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、依赖/构建/CI 配置、`openspec/config.yaml`、`openspec/specs/**`、归档及其它活动 change。若实现证明必须新增公共字段、事件、依赖或跨模块写入口，停止并交由主调度另开 change。

### 11. RI/RA 追踪

| 来源 | C14 对应物 | 验收证据 |
| --- | --- | --- |
| RI-S13/S14 | 样本工件来源版本、资料段集合、证据和当前授权；批次/快照审计 | 来源可追溯、无权不可枚举、审计失败回滚 |
| RI-S21 | 单位换算、时间对齐、缺失保留、斜率、加速度、频域主峰、异常评分及快照摘要 | 地表沉降数值交叉验证；同输入同版本重放一致 |
| RI-S23 | strict NDJSON、逐样本/批次合规性及整批拒绝 | 任一样本失败无部分事实 |
| RI-S43 | 序列修订引用 C01 固定监测指标 | 六项接受，近义词/未知值拒绝 |
| RA-S1 | 监测序列/批次/快照、双时间、异常与缺失事实、四项衍生特征 | 更正/迟到只追加；旧快照不变；冻结可解释 |
| RA-S5/S6 | 冻结规范值、斜率、加速度、异常评分及版本引用 | C25 以后只消费快照，不直读最新值；C14 不判阈值 |
| RA-S7 | 处置后监测仍通过新批次/快照进入 | C14 不覆盖旧事实、不计算偏差或自动校准 |

## Risks / Trade-offs

- **朴素 DFT 为 O(n²)** → 把频域窗口硬限制为 512 点并基准验证；超过目标后以独立依赖 change 替换，领域 Schema 和结果不变。
- **C04 工件读取与 PostgreSQL 写入不能形成单一 XA** → 工件必须先耐久落位并完成 verified，领域事务仅引用精确内容寻址版本；失败最多留下由 C04 清理的孤儿工件。
- **C18 尚未治理可用性策略** → C14 只接受精确 ref + canonical 内容并验证哈希/不可变性，提供一个测试/验收基线策略；生产发布治理留给 C18，不接受可变“latest”。
- **公共命令不含来源 ref 和策略正文** → 来源 ref 位于 strict 样本工件 envelope，策略正文由精确 `availabilityPolicyRef` 查得；两者在副作用前严格核对，不扩张 C02 契约。
- **同一序列内大批量更正需要锁定有效时间点** → 每批最多 100,000，按序列修订获取事务级 advisory lock 并批量查询/写入；实际吞吐由 C38 验证。
- **`partial` 容易与 C15 业务部分可用混淆** → C14 字段和文档始终称“算法可计算性”，C15 另存 Agent 清洗/业务可用结果，不覆写 C14 状态。

## Migration Plan

1. 在当前已归档 C01～C07 与 C11 migrations 之后执行 `000011`；先建父表，再建批次/样本、快照成员/点/特征/查询结果，最后配置角色权限。
2. 部署含监测子模块及 C11 委派的同一应用版本；没有既有 C14 数据需要回填，迁移后原 C11 来源事实保持不变。
3. 用一个受控地表沉降序列、原始批次、更正批次、补录批次和两个不同记录时点的快照完成数值与追溯验收，再允许 C15/C25 消费。
4. 回滚仅在尚无下游精确快照引用时执行 `down` 并回退应用；一旦快照被下游事实引用，不删除数据，改为前向修复迁移。
