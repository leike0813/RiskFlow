## Context

见 [proposal.md](./proposal.md) 与 [工程上下文及来源登记 delta spec](./specs/domain/engineering-context-source-registry/spec.md)。C01 已提供 `ApplicabilityMetadataSchema`、通用身份/版本/双时间/证据 DTO；C02 已冻结 `ProjectRevisionRefV1`、`SpatialScopeRefV1`、`SourceDeliveryRefV1`、`SourceVersionRefV1`、`SourceSegmentSetRefV1`、`ApplicabilityMetadataSnapshotRefV1`、`EngineeringDataPortV1`、工程事件和闭合错误；C03 已提供 PostgreSQL 迁移、命令幂等事务、审计和 Outbox；C04 已提供内容工件及事务内引用守卫；C06 已提供工程访问壳、空间授权树、两级资料权限和 `LocalIdentityAccessV1.verify`；C07 已提供统一审计追溯。

C11 只拥有 `engineering-data/context-source`。当前 `EngineeringDataPortV1` 的 `register-source-delivery` 足以承载公共交付入口，但没有工程/区段业务修订、资料段集合登记和适用性快照写分支。按协调裁决，C11 不修改 C02/C09 公共签名：上述新增对象由 C11 strict Schema 与窄模块内部能力建立，公共来源登记继续从 `metadataArtifactRef` 读取并验证版本化元数据；出现真实跨模块写入调用时，另开契约演进 change。

依赖基线固定为：C01 strict Schema 与精确引用 V1；C02 `EngineeringDataPortV1`、命令/结果/事件与闭合错误 V1；C03 `AtomicCommandV1`、`TransactionUnitV1` 及 `000001` foundation migration；C04 `ArtifactStoreV1`、`ArtifactReferenceGuardV1` 及 `000002` migration；C06 `LocalIdentityAccessV1`、资料授权 V1 及 `000003` migration；C07 审计追溯 V1 及 `000004` migration。C05 的 `000005`、`000006` migration 仍按全局顺序先于 C11 执行，但不是 C11 业务依赖。第三方版本沿用 workspace 已锁定的 Zod 4.5.4、Kysely 0.29.5、pg 8.23.0 和测试侧 Testcontainers 12.1.0；C11 不改变 manifest 或 lockfile。

## Goals / Non-Goals

**Goals:**

- 用一个深工程数据模块拥有工程/区段业务修订、资料项/版本、资料段集合和适用性元数据快照，避免同一上下文在接入、识别和评估各存一份。
- 实现现有 `EngineeringDataPortV1.apply(register-source-delivery)`，同时给 C12～C15 提供同包窄能力以登记资料段和冻结适用性上下文。
- 复用 C03/C04/C06/C07 的事务、工件、授权和审计语义，保证资料事实只追加、交付幂等、正文不进入领域表或事件。
- 固定 Schema、状态、持久化、权限、错误、可观测性、文件所有权与 RI-S1/RA-S1 追踪，使实现 Agent 不再决定字段或边界。

**Non-Goals:**

- 不修改 `packages/contracts/**`、`apps/api/**`、C02 `EngineeringDataPortV1` 或 C09 路由；不增加第二个公共端口。
- 不实现 C12/C13 的解析、JSON-LD、512 字符语义分块、相邻指针或 OCR，不实现 C14 的监测批次/快照/特征，不实现 C15 清洗与部分可用。
- 不连接真实数据库/API，不保存连接凭据或自由 URL；本 change 只登记其冻结交付工件和来源指纹。
- 不实现知识、识别、评估评分、预警、UI、查询投影或保留/删除策略；不新增依赖或修改 lockfile。

## Decisions

### 1. 一个深模块、两个窄调用面

新增 `packages/core/src/engineering-data/context-source/`，公开 `EngineeringContextSourceRegistryV1`，包含：

```ts
interface EngineeringContextSourceRegistryV1 {
  reviseContext(command: EngineeringContextRevisionCommandV1): Promise<ContextSourceResultV1>;
  registerSegments(command: RegisterSourceSegmentSetCommandV1): Promise<ContextSourceResultV1>;
  createApplicabilitySnapshot(command: CreateApplicabilitySnapshotCommandV1): Promise<ContextSourceResultV1>;
}
```

PostgreSQL composition 同时实现现有 `EngineeringDataPortV1`，其中 `apply` 只支持 `register-source-delivery`；其余 `apply` 分支以及全部 `freeze/read` 分支在 C14/C24/C25 等所属 change 装配完整端口前返回 `UNSUPPORTED_CONTRACT`，不得用 C11 假实现。C11 内部接口不是跨模块通用契约：C12～C15 在同一 engineering-data 所有权内直接消费；若其它模块需要提交这些命令，必须先做 C02 契约演进。

**选项：**（A）在 C11 修改 C02/C09；（B）把全部数据塞入自由 metadata；（C）保持公共端口并新增同所有者窄接口。  
**决定：** C。它满足裁决和 SSOT，同时避免破坏已归档契约；metadata 仍是版本化输入，不是开放命令协议。

### 2. Schema 以 C01/C02 为引用事实源，领域内容在 core 单处定义

`schema.ts` 先定义 strict Zod Schema，再以 `z.infer` 派生类型；不复制通用引用形状。集合设固定上限并规范排序/去重：每工程最多 128 个关联空间、每资料版本最多 10,000 个段登记项，名称/来源字段 1～200 字符，外部版本/位置字段 1～500 字符，里程使用有限数值且终点大于起点。

关键内容：

| 对象 | 必含内容 |
| --- | --- |
| `ProjectBusinessRevisionV1` | `ProjectRevisionRefV1`、名称、`preparing \| active \| ended \| archived`、`ApplicabilityMetadata`、有效/记录时间、前序修订、审计引用 |
| `SpatialBusinessRevisionV1` | `SpatialScopeRefV1`、工程修订、可选父 scope、名称、工点位置、可选里程、`active \| inactive`、前序修订、审计引用 |
| `SourceMetadataV1` | `documentType`、`formedAt`、`worksiteLocation`、`chainage?`、`sourceOrganization`、`externalVersion`；六项至少一项，交付还必须关联一个完整适用性快照 |
| `SourceDeliveryDescriptorV1` | `file-upload \| database-snapshot \| api-snapshot`；分别固定内容摘要，或受控连接定义版本 + 查询/游标/请求响应指纹；无凭据/URL |
| `SourceDeliveryMetadataEnvelopeV1` | `schemaVersion: "1"`、工程/空间精确修订、登记人、资料项身份/名称/分类、`SourceMetadataV1`、`SourceDeliveryDescriptorV1`、适用性快照 ref；是 `metadataArtifactRef` 内容的唯一 strict 形状，UTF-8 JSON 最大 1 MiB |
| `SourceItemV1` | 稳定 item identity、工程、名称/分类、创建审计 |
| `SourceVersionV1` | `SourceVersionRefV1`、资料 ID、item、工程/区段修订、交付/内容/元数据/权限/适用性快照 refs、前序版本、双时间、审计 |
| `SourceSegmentSetV1` | `SourceSegmentSetRefV1`、资料版本/资料 ID、非空段数组、记录时间、审计 |
| `SourceSegmentV1` | `sourceSegmentId`、`chapterId`、`segmentId`、`chapter \| table \| monitoring-window`、空间 refs、类型化 locator |
| `ApplicabilityMetadataSnapshotV1` | ref、C01 三维 `ApplicabilityMetadata`、工程/空间精确修订、形成时间、工点/区段扩展、审计 |

资料段组成标识仅接受 `[A-Za-z0-9_]+`，最终串由 `sourceId + "-" + chapterId + "-" + segmentId` 生成；禁止调用方单独提交一个无法核对的拼接字符串。该限制确保三个组成部分可无歧义拆解，不增加额外哈希或映射表。

**选项：**（A）所有内容只存 JSONB；（B）每个可选元数据单独建 DTO/表；（C）稳定查询键列化、版本化内容用 strict JSONB 辅助。  
**决定：** C。Schema 是字段 SSOT，数据库约束承担身份/版本/归属不变量；避免大量稀疏表，也不把 JSONB 变成自由字段袋。

### 3. 工程业务修订绑定 C06 身份，不复制授权状态

工程业务 identity 直接使用 C06 `projectId`；其修订返回 C02 `ProjectRevisionRefV1`。空间业务修订使用 C06 `SpatialScopeRefV1` 的稳定 `entityId`，并固定精确访问修订；父关系只作为当次业务上下文快照，创建前调用 C06 `verify` 且读取 C11 自己的业务父修订，不读取 C06 内表。C06 决定成员、授权 scope 树与 active/suspended；C11 决定工程名称、里程、三维适用性和 `preparing/active/ended/archived` 业务生命周期。

普通资料登记只允许 C06 工程 active 且 C11 生命周期为 `preparing|active`。`ended` 后仅允许受控完成在途审计；`archived` 只读。生命周期只能前进，不能“回滚”覆盖旧修订；确需重开另开新工程身份或后续受治理决定。

**选项：**（A）复用 C06 表增加业务列；（B）C11 建第二棵工程/空间树；（C）共享稳定身份、各自拥有修订。  
**决定：** C。A 跨模块改表，B 产生漂移；C 保持 C06 与 C11 各自事实所有权。

### 4. 来源交付采用文件先行、领域事务引用核对、权限后置收口

调用方先用 C04 `put` 耐久保存原始内容与 strict metadata JSON，再调用既有 `register-source-delivery`。Adapter 先 strict 解析公共命令并调用 C06 `verify`；随后通过注入的 C04 `ArtifactStoreV1.open` 读取元数据工件，最多接受 1 MiB UTF-8 JSON，完整消费字节流、等待 `verified` 成功并解析 `SourceDeliveryMetadataEnvelopeV1`。这个只读步骤会形成 C04 自己的访问审计，但不产生 C11 业务事实。内容寻址保证之后不会读取到另一版字节；C11 写事务内仍用 `ArtifactReferenceGuardV1` 对元数据与原始内容的精确引用、清单摘要、工程和授权范围做二次核对。

Adapter 随后在 C03 写事务内：

1. 核对已解析元数据中的 schema/version、工程/空间/登记人与公共命令一致；
2. 用 C04 `ArtifactReferenceGuardV1.assertUsable` 核对两个工件已耐久、属于同工程且当前授权不扩大，并把元数据读取时的内容身份/清单摘要与 guard 结果精确比对；
3. 锁定工程/资料项当前版本，生成交付、资料版本和资料 ID；
4. 在同一 C03 事务写领域事实、命令收据、审计和零个事件；
5. 事务提交后调用 C06 `administerProject(revise-source-access)` 创建默认 `restricted` 权限，显式包含登记人和全部关联空间；随后以从首次登记命令确定性派生的新 C11 幂等收口命令绑定 grant ref；绑定失败时资料保持 `pending-access`，不得进入处理。

公共调用只有在权限收口为 `ready` 后才返回业务成功。若 C11 初始事务已经提交而 C06 或最终收口失败，重放同一公共命令 MUST 从命令收据取回原资料版本，复用确定性 C06/收口幂等身份继续未完成步骤；不得再次创建交付或只返回一个仍为 `pending-access` 的成功结果。

PostgreSQL 与文件系统无法组成 XA；C04 工件先行失败只留下可维护孤儿，C11 事务不产生悬空引用。C06 权限表先于 C11 已存在且跨模块不能纳入同一 C03 handler，因此资料版本状态只允许 `pending-access | ready`；这不是可编辑业务内容，唯一更新是由精确 grant ref 完成的单向收口。`ready` 后不可退回；当前读取仍由 C06 最新修订控制。

只有完成资料段集合登记且权限为 `ready` 的资料版本才可按现有事件契约形成 `engineering.inputs-ready.v1`。C02 的该事件 payload 要求 identification/assessment preparation ref，C11 不伪造这些后续快照，因此 C11 自身不发该事件；C15/C24/C25 在真正形成 preparation 时负责发布。C11 只写零事件 AtomicCommit。

**选项：**（A）在一个不存在的跨模块事务里假装原子；（B）权限失败时默认共享；（C）工件先行 + C11 pending-access + C06 后置幂等收口。  
**决定：** C。失败默认不可读且可重试，满足 C04/C06 边界。

### 5. 资料段是版本内不可变集合，不承担转换内容

`registerSegments` 只接受目标资料版本、资料 ID、段身份数组、授权和命令身份。每个 locator 是闭合联合：`document`（页码/标题路径）、`table`（sheet/table/row/column range）、`record`（dataset + stable record key）、`time-window`（from/to）。C12/C13/C14 负责决定章节与段划分、正文/JSON-LD/相邻指针/512 字符约束，并把其内容作为 C04 派生工件保存；C11 只核对身份、单一归属、空间覆盖与定位范围。

同一资料版本只能有一个最终 `SourceSegmentSetRefV1`；相同命令重放返回原集合，不支持原地增加/删段。重处理产生新资料版本、新资料 ID 和新集合。一个集合可包含不同区段，但所有区段必须属于同工程并被资料权限完整覆盖。

**选项：**（A）段逐条可变写入；（B）集合一次冻结；（C）把段留给解析模块独占。  
**决定：** B。下游需要一个精确集合引用，C11 仍拥有 RI-S13 身份；转换内容继续由 C12～C14 拥有。

### 6. 适用性快照由工程与单一区段当前修订确定性合成

工程修订提供三维默认值；空间修订可对每一维给出显式覆盖值。`createApplicabilitySnapshot` 锁定并验证两个 current pointer、工程一致性与 C06 scope 有效性，按“区段显式值优先，否则工程值”合成。任一维仍缺失或冲突即失败；不调用 LLM、不读取自由资料正文、不猜默认值。快照保存三个值及来源字段级 provenance（工程修订或区段修订），从而可以重放与解释。

工程/区段上下文改变只产生新修订；新评估准备创建新快照，旧快照不被覆盖。C11 不自动触发 `engineering.assessment-input-changed.v1`，因为事件要求 previous/new 两个快照及原因且是否需要重评估属于 C25/C30；后续调用方形成新快照后负责在业务事务中产生该事件。

### 7. PostgreSQL 使用一个 C11 迁移和只追加/当前指针分表

迁移路径固定为：

```text
packages/adapters/src/postgres/migrations/engineering-data/
  deliver-engineering-context-and-source-registry/
    000007_engineering_context_source_registry.ts
```

表位于既有 `business` schema：

| 表 | 作用 |
| --- | --- |
| `engineering_projects` / `engineering_project_revisions` | 稳定工程 identity、current pointer；不可变业务修订 |
| `engineering_spatial_segments` / `engineering_spatial_segment_revisions` | C06 scope identity 绑定、current pointer；不可变业务修订 |
| `source_items` | 工程内稳定资料项 |
| `source_deliveries` | 不可变交付身份、delivery key、descriptor/fingerprint、内容/元数据 refs |
| `source_versions` | 不可变资料版本、资料 ID、item/前序/上下文/权限/快照 refs、`pending-access|ready` |
| `source_segment_sets` / `source_segments` | 每资料版本一个不可变集合及段定位 |
| `applicability_metadata_snapshots` | 三维值、字段来源、工程/区段修订和审计 |

全局迁移序号 `000007` 在当前 `000001`～`000006` 后分配。identity 表只允许 current pointer 的 compare-and-swap；revision、delivery、version、segment、snapshot 表对 `riskflow_app` 仅 SELECT/INSERT，资料版本只额外授予 `source_access_grant_ref/status` 的受限 UPDATE，并用 trigger 保证只能 `pending-access → ready` 一次。PUBLIC、Outbox Worker 与 checkpointer 无业务表权限；应用角色无 DELETE/DDL/历史 UPDATE。

唯一约束至少覆盖 `(project_id, delivery_key)`、`(project_id, source_id)`、`(source_item_id, source_version_sequence)`、`source_segment_id`、`(source_version_id, chapter_id, segment_id)` 和每版本一个段集合。FK/check 约束工程归属、非空、时间/里程正序、状态闭合和 JSON object；跨模块 C04/C06 引用通过事务 guard/服务验证，不能建数据库 FK。

### 8. 授权、幂等、错误与审计沿用现有事实源

公共来源登记使用 `engineering-data.register-source-delivery`；C11 内部三个写族分别绑定同一 `engineering-data.write` 能力，并要求当前工程风险管理员上下文。每次执行先通过 C06 `verify`，requested scope/source refs 与目标完全匹配；无权与不存在统一 `AUTHORIZATION_DENIED`。读取段定位可以返回安全定位，正文仍走 C04/C06；C11 不自行打开 C04 字节。

所有写族转换为 C03 `AtomicCommandV1`，幂等唯一键为 `(projectId, commandKind, idempotencyKey)`；strict canonical payload 摘要复用 C03 实现。同键同载荷返回原结果，同键异载荷映射 `IDEMPOTENCY_CONFLICT`，expected ref 不匹配映射 `STALE_VERSION`。Schema/领域不变量失败使用 `BUSINESS_BLOCKED` 的闭合 blocker；技术细节只进受保护诊断工件。

每次成功修订/登记/快照写一条 C03 审计，包含操作者、授权上下文、目标精确版本、命令/幂等身份、业务/记录时间和前序原因引用。C07 trace 通过现有审计投影读取，无需 C11 新建活动表。普通日志只记录 code/stage/命令/目标引用，不记录元数据正文、凭据、URL、文件名、工件内容或资料正文。

### 9. 可观测性与性能使用结构计数，不预建指标框架

Adapter 接受现有 logger seam（若 composition 已有）或不输出日志；不新增 metrics/tracing 依赖。成功/失败审计和 C03 命令收据是业务可观测事实。实现测试记录交付事务、段批量写入和适用性快照的 wall time/行数，仅设结构硬门：单次段数组最多 10,000、分批参数化插入每批最多 500，不扫描其它工程或全部历史；C38 再以实际硬件设 SLA。

### 10. 文件所有权与禁止修改区

新增：

```text
packages/core/src/engineering-data/context-source/{schema,service,index}.ts
packages/core/test/engineering-data/context-source.test.ts
packages/adapters/src/engineering-data/context-source/{postgres-engineering-context-source-registry,index}.ts
packages/adapters/test/engineering-data/context-source/{fixture,postgres-engineering-context-source-registry.test}.ts
packages/adapters/src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000007_engineering_context_source_registry.ts
```

主调度 Agent 在 planning checkpoint 后串行修改：

```text
packages/core/package.json                         # 只增 ./engineering-data/context-source export
packages/adapters/package.json                     # 只增 ./engineering-data/context-source export
packages/core/src/index.ts                         # 只增对应根导出（若现有约定要求）
packages/adapters/src/index.ts                     # 只增对应根导出（若现有约定要求）
```

禁止修改：`packages/contracts/**`、`apps/**`、C03/C04/C06/C07 现有代码与迁移、其它领域目录、根 manifest、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、依赖/构建/CI 配置、`openspec/config.yaml`、`openspec/specs/**`、归档及其它活动 change。若实现证明必须改变 C02/C09 或增加依赖，停止并由主调度另开 change。

### 11. 验证层次与 RI/RA 追踪

核心表格测试只覆盖稳定 Schema 与纯函数：三维元数据、状态前进、source ID/segment ID、版本链、locator、权限/快照合成和错误映射；不精确断言文案、SQL、字段顺序或私有调用。

PostgreSQL 集成测试使用现有固定 Testcontainers PostgreSQL 镜像与真实 C03/C04/C06/C07 迁移，覆盖 migration `up/down/up`、角色权限、幂等/并发、工件 guard、权限后置收口、段集合、审计/Outbox 故障回滚、跨工程和不可枚举。无容器时失败，不回退内存 adapter。

| 来源 | Schema/能力 | 持久化 | 验收 |
| --- | --- | --- | --- |
| RI-S11 | `SourceDeliveryDescriptorV1` + `register-source-delivery` | delivery/source item/version | 文件、数据库、API 三类登记；无在线空连接器 |
| RI-S12 | `SourceMetadataV1` | metadata 工件 + source version refs | 六项至少一项、来源版本可追溯 |
| RI-S13 | `SourceSegmentSetV1` | segment set/segment | `资料ID-章节ID-资料段ID`、唯一归属、非法整体拒绝 |
| RI-S14 | C06 source grant + C03/C07 audit | access ref/status/audit | 默认指定、权限失败不可读、操作者/时间/变更链 |
| RA-S1 | project/spatial revisions + applicability snapshot | immutable revisions/snapshot | 三维齐全、字段 provenance、变化只新增 |

## Risks / Trade-offs

- [C02 没有新增对象的公共写分支] → C11 将其保持在同所有者内部接口；真实跨模块调用出现前另开契约演进，不把自由 metadata 当通用协议。
- [C11 与 C06 权限绑定无法单事务提交] → 资料先以 `pending-access` 默认拒绝，C06 成功后幂等单向收口；失败不发就绪事件且可安全重试。
- [数据库/API 只做登记可能被误认为可在线接入] → Schema/结果明确 `snapshot`，验收只宣称登记支持；真实连接 adapter 由后续独立 change。
- [10,000 段一次冻结会放大事务] → 输入有界并分批参数化插入；只有 C12/C13 真实样例超过上限时通过新版本策略演进。
- [工程/C06 生命周期可能短暂不一致] → 每次命令同时复验 C06 当前状态和 C11 当前修订；任一不允许即默认拒绝，不做后台自动同步。

## Migration Plan

1. 主调度确认 C01～C07 直接契约已归档、迁移号 `000007` 未占用，并串行增加两个 package 子路径 export 后形成 checkpoint；不改依赖或 lockfile。
2. 实现 C11 core Schema/纯领域规则，再新增 migration 和 PostgreSQL adapter；集成测试从 C03～C07 迁移顺序执行 `000001`～`000007`。
3. 部署先运行 C11 migration，再装配 C04 reference guard、C06 access 和 C03 transaction unit；任一依赖不可用时不暴露资料登记能力。
4. 现有 C06 source access 行没有 C11 对应事实，不迁移或猜测补建；仅新 C11 资料版本走默认指定权限绑定。
5. 非生产且尚无下游引用时可执行 `down`；一旦有资料/段/快照历史，只允许向前修复，不删除或覆盖业务事实。

## Open Questions

无。公共端口边界、内部能力、Schema、状态、事务拆分、迁移序号、文件所有权和验收命令均已固定；需要跨模块新分支时由独立契约演进 change 处理，不阻塞 C11 实现。
