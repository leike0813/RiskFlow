## Context

见 [proposal.md](./proposal.md) 的动机与范围。当前 C02 已公开 `ContentArtifactRefV1Schema`、`DiagnosticArtifactRefV1Schema`、`EvidenceReferenceSchema`、`AuthorizationContextV1Schema`、`ContractReferenceV1Schema` 和闭合 `ModuleErrorV1Schema`；图状态、事件和领域 interface 只允许保存小型精确引用。C03 已实现 `TransactionUnitV1`、不透明 `TransactionContextV1`、规范 JSON/SHA-256、PostgreSQL 角色/schema、只追加审计、零或多个 Outbox 事件及按 change 自动发现的 migration。

当前没有工件正文实现。数据库引用与本地文件系统不能组成分布式事务，因此 C04 必须固定可恢复的不对称一致性：允许“文件存在、数据库无引用”，禁止“数据库已提交引用、文件未耐久存在”。本 change 是横切平台能力，不拥有工程资料、知识、识别、评估、预警、处置、Agent 或工作流事实。

## Goals / Non-Goals

**Goals:**

- 固定工件 V1 DTO、流式 interface、内容/诊断引用版本语义及证据/权限继承。
- 用 Node 24 标准库实现单数据卷不可变 SHA-256 目录，不增加存储服务或 npm 依赖。
- 复用 C03 事务保存工件清单、命令收据和审计，并为后续领域事务提供同事务引用校验。
- 固定安全读取、哈希清单、孤儿维护、恢复对账、错误、审计、性能和测试边界。

**Non-Goals:**

- 不修改 C01/C02 Schema、引用种类、能力枚举或领域事件；不修改 C03 现有代码、表或归档工件。
- 不实现业务资料注册、资料段、保留/删除政策、用户角色、API 上传、解析/OCR、模型、Agent、查询投影、备份调度或灾备。
- 不引入对象存储、跨节点复制、对象锁、分层存储、加密密钥管理、病毒扫描或任意路径/URL adapter。
- 不自动删除任何已有工件清单；C04 只清理数据库零清单引用的物理孤儿和超期 staging。

## Decisions

### 1. 两个 core port、一个本地 adapter，避免建立通用文件系统

新增 `@riskflow/core/artifacts`，只公开 DTO 与两个窄 port：

```ts
export interface ArtifactStoreV1 {
  put(
    command: ArtifactPutCommandV1,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ArtifactPutResultV1>;

  open(request: ArtifactReadRequestV1): Promise<ArtifactReadHandleV1>;
}

export interface ArtifactReferenceGuardV1 {
  assertUsable(
    context: TransactionContextV1,
    request: ArtifactReferenceCheckRequestV1,
  ): Promise<ArtifactReferenceCheckResultV1>;
}

export interface ArtifactMaintenanceV1 {
  createHashManifest(
    command: ArtifactHashManifestCommandV1,
  ): Promise<ArtifactPutResultV1>;

  reconcile(request: ArtifactReconcileRequestV1): ArtifactReconcileHandleV1;

  sweepOrphans(command: ArtifactSweepCommandV1): Promise<ArtifactSweepResultV1>;
}
```

`ArtifactReadHandleV1` 只包含已经授权的 `manifest`、`content: AsyncIterable<Uint8Array>` 和 `verified: Promise<ArtifactReadReceiptV1>`。只有内容流完整消费且长度/SHA-256 一致时 `verified` 才成功；调用方必须等待它后才能提交派生事实。

`ArtifactReferenceGuardV1` 接收 C03 不透明事务上下文，只允许同 package 的领域 adapter 在其业务事务 handler 内调用。它不暴露 SQL、Kysely、表名、路径、文件句柄或任意查询能力。`ArtifactMaintenanceV1` 只在离线运维 composition root 装配，不进入六个领域 interface 或应用路由。

生产实现为 `@riskflow/adapters/artifacts`：本地文件对象、PostgreSQL 工件清单和维护操作在一个深层 adapter 内协作。不会为当前唯一实现增加 factory registry、对象存储抽象、provider 插件或通用 blob API。

**选项：**（A）把文件读写塞入工程数据模块；（B）建立通用文件系统/URL port；（C）独立内容工件 port，领域只持有 C02 精确引用。  
**决定：** C。工件同时服务工程资料、模型、Agent、诊断和导出；放入单一领域会反转所有权，开放文件系统则违反 C02。

### 2. V1 Schema 与 TypeScript 类型

所有对象使用 `z.strictObject`/闭合联合，类型只用 `z.infer`。复用的 C01/C02 类型不复制字段：

- `IdentifierSchema`、`IsoDateTimeSchema`、`VersionReferenceSchema`、`EvidenceReferenceSchema`；
- `ContentArtifactRefV1Schema`、`DiagnosticArtifactRefV1Schema`、`AuthorizationContextV1Schema`、`ModuleCapabilityV1Schema`；
- C03 `TransactionContextV1`、`JsonValue` 和规范 JSON/SHA-256。

#### 2.1 基础值对象

```text
ArtifactKindV1 = "content" | "diagnostic"
ArtifactRefV1 = ContentArtifactRefV1 | DiagnosticArtifactRefV1
ArtifactHashV1 = {
  algorithm: "sha256",
  value: /^[0-9a-f]{64}$/
}
ArtifactContentIdentityV1 = {
  hash: ArtifactHashV1,
  byteLength: nonnegative safe integer
}
```

Node 读取的文件长度可能超过 JavaScript safe integer 前不得继续；MVP `maxArtifactBytes` 必须低于该边界。数据库使用 `bigint`，adapter 在 DTO 边界验证可安全转换。

`ArtifactRefV1.reference.entityId = artifactId`；`versionId = "sha256:" + actualSha256`。同一逻辑 `artifactId` 可以有多个不可变内容版本，但任何已发布引用永远指向一个摘要版本。`kind` 与引用分支必须一致。

#### 2.2 策略与权限快照

```text
ArtifactStorePolicyV1 = {
  schemaVersion: "1",
  policyRef: VersionReference,
  maxArtifactBytes: positive safe integer,
  maxConcurrentWrites: positive integer,
  maxConcurrentReads: positive integer,
  stagingMaxBytes: positive safe integer,
  orphanGracePeriodMs: positive integer,
  registrationTimeoutMs: positive integer,
  maintenanceBatchSize: 1..10000
}
```

约束：`orphanGracePeriodMs > registrationTimeoutMs`；任何超限在提交引用前失败。策略由 composition root 显式注入，不由 adapter 自行读取环境变量；其精确 `policyRef` 写入清单和审计。

```text
ArtifactAccessSnapshotV1 = {
  projectId,
  spatialScopeRefs: unique sorted SpatialScopeRefV1[],
  sourceAccessGrantRefs: unique sorted SourceAccessGrantRefV1[],
  authorizationPolicyRefs: nonempty unique sorted VersionReference[]
}
```

数组统一按 `kind/entityId/versionId` 或 `entityId/versionId` 排序、去重。直接工件从当前授权上下文形成快照；派生工件取全部父快照与当前策略的集合并，再加入调用方显式附加且当前授权已覆盖的限制。

#### 2.3 写入与清单 DTO

```text
ArtifactPutCommandV1 = {
  schemaVersion: "1",
  commandId,
  idempotencyKey,
  projectId,
  actorId,
  issuedAt,
  authorization: AuthorizationContextV1,
  requiredCapability: ModuleCapabilityV1,
  artifactId,
  artifactKind: ArtifactKindV1,
  purposeCode,
  mediaType,
  expectedHash?: ArtifactHashV1,
  expectedByteLength?: nonnegative safe integer,
  parentArtifactRefs: unique ArtifactRefV1[],
  evidenceReferences: unique EvidenceReference[],
  additionalSpatialScopeRefs: unique SpatialScopeRefV1[],
  additionalSourceAccessGrantRefs: unique SourceAccessGrantRefV1[]
}
```

`projectId/actorId` 必须等于授权上下文；`requiredCapability` 必须已授予。`mediaType` 只接受规范、非空、无控制字符的 MIME 值；C04 不嗅探或解释格式。父引用种类可混合，但必须同工程、可读且精确版本存在。原始输入允许父引用和证据均为空；有父工件时其证据不能被删除。

```text
ArtifactManifestV1 = {
  schemaVersion: "1",
  artifactRef: ArtifactRefV1,
  artifactKind: ArtifactKindV1,
  content: ArtifactContentIdentityV1,
  mediaType,
  purposeCode,
  access: ArtifactAccessSnapshotV1,
  writePolicyRef: VersionReference,
  parentArtifactRefs: unique sorted ArtifactRefV1[],
  evidenceReferences: unique sorted EvidenceReference[],
  producerCommandId,
  authorizationContextRef: AuthorizationContextRefV1,
  auditTrailRef: AuditTrailRefV1,
  occurredAt,
  recordedAt,
  persistedAt
}
```

`manifestSha256` 是上述清单除 `persistedAt` 与 `auditTrailRef` 外不可变字段的 C03 规范 JSON SHA-256；数据库时间与审计身份仍单独核对。`ArtifactPutResultV1 = { artifactRef, manifest, manifestSha256, replayed, deduplicated }`。

#### 2.4 读取与事务引用校验 DTO

```text
ArtifactReadRequestV1 = {
  schemaVersion: "1", requestId, idempotencyKey,
  artifactRef, projectId, actorId, requestedAt,
  purposeCode, requiredCapability,
  authorization: AuthorizationContextV1
}
ArtifactReadReceiptV1 = {
  schemaVersion: "1", requestId, artifactRef,
  content: ArtifactContentIdentityV1,
  authorizationContextRef, verifiedAt
}
ArtifactReferenceCheckRequestV1 = {
  schemaVersion: "1", artifactRef, projectId,
  purposeCode, requiredCapability,
  authorization: AuthorizationContextV1
}
ArtifactReferenceCheckResultV1 = {
  artifactRef, manifestSha256, content, mediaType,
  access, evidenceReferences
}
```

读取请求使用 C03 命令收据幂等追加一次 `artifact.read-started` 审计，审计失败不返回字节。读取完成收据不是业务事实，不进入 Outbox；结构化运行日志记录成功/完整性失败。

#### 2.5 哈希清单、核对与孤儿 DTO

`ArtifactHashManifestCommandV1` 固定 `schemaVersion`、命令/幂等/工程/主体/授权、`backupBatchRef`、`databaseSnapshotRef`、`fileSnapshotRef`、`purposeCode` 与 `requiredCapability`。输出内容为 UTF-8 NDJSON 工件：第一行 `ArtifactHashManifestHeaderV1`，后续每行一个 `ArtifactHashManifestEntryV1`，末行 `ArtifactHashManifestTrailerV1`。

```text
header = {
  schemaVersion: "1", manifestId, projectId,
  backupBatchRef, databaseSnapshotRef, fileSnapshotRef, generatedAt
}
entry = {
  artifactRef, artifactKind, content, mediaType,
  manifestSha256, authorizationPolicyRefs,
  evidenceReferencesSha256
}
trailer = { entryCount, entriesSha256 }
```

条目按 `artifactRef.kind/entityId/versionId` 排序；`entriesSha256` 对规范 NDJSON 条目字节计算。哈希清单本身通过普通 `put` 保存为 `ContentArtifactRefV1`，但不递归加入本次已冻结输入集合。

`ArtifactReconcileRequestV1` 固定运行、工程、模式（`audit|recovery`）、授权、策略、给定哈希清单引用/字节流和快照引用。`ArtifactReconcileFindingV1` 是闭合联合：`complete`、`missing-object`、`content-mismatch`、`manifest-conflict`、`orphan-object`、`stale-staging`、`quarantined-object`。`ArtifactReconcileSummaryV1` 给出各类计数、`passed`、开始/完成时间与诊断引用；任何前三类非零时 `passed=false`。

`ArtifactSweepCommandV1` 固定命令身份、授权、维护策略、`observedBefore` 与 `dryRun`。`ArtifactSweepResultV1` 只返回计数、处理摘要、审计引用和可选详情诊断工件引用，不返回正文或宿主路径。

**选项：**（A）把完整字节作为 Zod DTO；（B）DTO 与流分离；（C）接受调用方路径。  
**决定：** B。A 会使内存随文件增长，C 会暴露宿主文件系统；二进制流是受控能力，不是领域数据。

### 3. 物理布局与路径安全

构造器只接受由部署层解析后的绝对 `rootDirectory` 和 `ArtifactStorePolicyV1`。固定布局：

```text
<root>/
  staging/<uuid>.part
  objects/sha256/<h0h1>/<h2h3>/<64-lower-hex>
  quarantine/<maintenance-run-id>/<64-lower-hex>
```

`staging`、`objects`、`quarantine` 必须位于同一文件系统；启动时以 `realpath` 验证三者均在根目录内、目录链无符号链接，权限由部署层设置为专用 OS 账户可读写。文件以排他创建和 `0600` 权限写入；对象路径只从正则校验后的实际 SHA-256 派生，不拼接用户值。读取使用 `lstat`/文件句柄再次拒绝符号链接、目录和非普通文件。

选择两级 `aa/bb/hash`，避免单目录对象过多。数据库和公共 DTO 不保存绝对路径；规范存储键可由摘要重建，因此也不建立第二套可变 location 映射。

**选项：**（A）原始文件名路径；（B）UUID 路径 + DB 映射；（C）SHA-256 分片目录。  
**决定：** C。它天然去重、可核对且不暴露原始名称；UUID 映射增加无价值状态。

### 4. 写入时序固定为 staging、耐久对象、事务清单

`put` 算法：

1. strict 校验命令、授权工程/主体/能力及配置上限；在 `staging` 以随机 UUID 和排他模式创建文件。
2. `for await` 消费 `AsyncIterable<Uint8Array>`，每块同时写入、累计长度、更新 Node `createHash("sha256")`；执行并发/总 staging 配额。空文件允许，但仍有标准 SHA-256 和 MIME。
3. 超限、流失败或取消时关闭文件并保留/清理为 staging；不得进入数据库。
4. 写完后 `FileHandle.sync()`、关闭，比较期望长度/摘要；不一致即失败。
5. 获取数据库固定 advisory key 的**共享 session lock**。它只覆盖最终对象落位、清单事务和 staging 收尾；孤儿维护使用同 key 的排他锁。锁由 C04 adapter 的专用 pg session 持有，不进入 core port。
6. 创建摘要分片目录，以同文件系统 `link(staging, object)` 原子发布并保留 staging；`EEXIST` 时打开既有普通文件，完整核对长度/SHA-256。新建时刷新对象文件句柄及新增的 `bb`、`aa`、`sha256`/`objects` 父目录。
7. 在共享锁仍持有时解析全部父清单、推导权限/证据，构造含实际摘要的 C03 `AtomicCommandV1.payload`，调用 `TransactionUnitV1.execute`。handler 通过 C04 私有 registry 和同一 `TransactionContextV1` 插入工件清单，返回目标工件引用、审计和空 `events`。
8. C03 以 `(projectId, "artifact.put.v1", idempotencyKey)` 和含实际摘要/元数据的规范 payload 收口。重放返回原清单引用；adapter 复核返回版本与实际摘要相同。
9. 提交后删除 staging 并刷新 staging 目录，再释放共享锁；收尾失败只形成可清理 staging，不使已提交对象失效。

`link` 比 `rename` 更适合重试：它不会覆盖已存在对象，并让已 fsync 的 staging 在数据库提交完成前继续作为恢复副本。staging 与 objects 同卷是构造期硬约束，因此不提供跨卷复制回退。

故障边界：

| 故障点 | 可观察结果 | 恢复 |
| --- | --- | --- |
| 流/刷新前 | 无清单；可能有 `.part` | 超期 staging 清理 |
| 对象发布后、DB 前 | 无清单；对象孤儿，staging 仍在 | 重试复用对象或宽限期清理 |
| 清单/审计事务内 | 整体回滚；对象孤儿 | 原幂等身份重试 |
| DB 提交后、staging 删除前 | 清单与对象有效；额外 staging | 启动/维护清理 staging |
| 返回响应前 | 重试返回原工件引用 | C03 命令收据收口 |

### 5. PostgreSQL 清单、事务、Outbox 与引用守卫

C04 migration 使用 C03 约定：

```text
packages/adapters/src/postgres/migrations/
  platform/deliver-content-addressed-artifact-store/
    000002_artifact_manifests.ts
```

只新增 `business.artifact_manifests`：

| 列 | 约束/语义 |
| --- | --- |
| `artifact_id`, `version_id` | 联合主键；非空；`version_id = 'sha256:' || content_sha256` |
| `artifact_kind` | `content|diagnostic` |
| `content_sha256` | 64 位小写 hex；索引用于物理引用计数 |
| `byte_length` | `bigint >= 0` |
| `media_type`, `purpose_code` | 非空，无正文/路径 |
| `project_id` | 工程隔离索引 |
| `spatial_scope_refs` | strict 引用数组 JSONB |
| `source_access_grant_refs` | strict 引用数组 JSONB |
| `authorization_policy_refs` | 非空 strict 版本引用数组 JSONB |
| `write_policy_ref` | strict 精确版本引用 JSONB |
| `parent_artifact_refs` | strict 工件引用数组 JSONB |
| `evidence_references` | strict C01 证据引用数组 JSONB |
| `producer_command_id` | 非空；外键到 `business.command_receipts(command_id)` |
| `authorization_context_ref` | C02 精确引用 JSONB |
| `audit_entry_id` | 非空；延迟外键到 `audit.entries(audit_entry_id)` |
| `manifest_sha256` | 64 位小写 hex |
| `occurred_at`, `recorded_at`, `persisted_at` | 三个 `timestamptz`，数据库时间不覆盖业务/系统时间 |

索引只有 `(project_id, artifact_id, version_id)` 和 `(content_sha256)`；真实查询证明需要前不增加 GIN 或用途索引。表只允许 `riskflow_app` `SELECT/INSERT`，撤销 `UPDATE/DELETE`；清单不可原地修改。C04 不新增 role、schema、中央 migration index 或 C03 `PostgresDatabase` 表类型。

`postgres-artifact-registry.ts` 在 C04 私有位置声明 `ArtifactManifestRow` 与 `ArtifactRegistryDatabase`，通过 C03 package-internal `getPostgresTransaction(context)` 获得受限事务并进行一次局部类型收窄。该 cast 不从 exports 暴露；不修改 `packages/adapters/src/postgres/types.ts` 或 `transaction-unit.ts`。

`ArtifactReferenceGuardV1.assertUsable` 在领域事实同一事务中：按精确主键读取清单，strict 解析 JSONB，校验 project、required capability 和访问集合，返回只读摘要。失败抛出闭合工件错误，使 C03 回滚领域事实、审计、命令收据和 Outbox。它不重新读取/哈希物理文件；C04 无已登记对象删除路径，在线完整性由读取/定期 scrub 与恢复门保证。

工件登记和读取审计使用 C03 原子提交，`events=[]`。没有 C02 `artifact-created` 事件，因此禁止自创；后续 `input-ready`、风险、评估、预警等事件由事实所属 change 在引用校验通过后按 C02 契约发布。

### 6. 权限继承与证据传播

最小授权判定在返回清单字段/正文或允许领域引用前执行：

1. 请求 `projectId`、`actorId` 必须与授权上下文一致；`requiredCapability` 必须出现在 `grantedCapabilities`。
2. 请求工程必须等于清单工程。
3. 清单每个 `spatialScopeRef` 必须存在于当前授权上下文；每个 `sourceAccessGrantRef` 也必须存在。
4. 派生写入前，对所有父工件逐项执行相同检查；任一父无权、缺失、损坏标记或跨工程即整体失败。
5. 新快照 = 全部父工件空间/资料授权/策略版本 + 当前授权策略 + 当前显式附加限制的排序去重并集。显式附加空间/资料引用也必须已在当前授权中，不能凭空制造限制身份。
6. 新证据 = 全部父清单证据 + 请求新证据的排序去重并集。证据 strict 校验失败时不写入；C04 不解释证据正文。

C06 后续实现授权决策事实与策略兼容性，但不能放宽 C04 已冻结的工程/范围/资料授权集合。历史策略版本只用于追溯；策略升级若需要把旧 grant 映射到新 grant，由 C06 形成新的授权上下文，C04 不自行改写。

无权、跨工程和不存在对象对普通读取统一映射到 `AUTHORIZATION_DENIED` 的外部语义，内部诊断只对获授权运维可见，避免存在性侧漏。已经通过工程/范围预检且明确获准诊断的系统维护调用才区分 `ARTIFACT_REFERENCE_NOT_FOUND`。

### 7. 读取、完整性与路径攻击防护

`open` 顺序：strict 请求 → 权限/清单查询 → 幂等 `artifact.read-started` 审计 → 从摘要重建路径 → `realpath/lstat` 与普通文件检查 → 长度预检 → 返回单次消费流。流对每块更新 SHA-256，EOF 时比较清单并 resolve `verified`；提早取消、长度不符或摘要不符 reject `verified` 并生成结构化完整性记录。

调用方不得在 `verified` 成功前提交派生工件或领域事实。adapter 不把失败流缓存、补零、换成同名文件或自动重写清单。对已登记对象的缺失/损坏，普通写入也不能覆盖；必须由恢复流程从可信备份恢复原摘要字节后重新核对。

防护边界：

- 摘要必须先匹配小写 64 hex，再派生路径；不接收 `../`、分隔符、URL、原始名称或调用方存储键。
- 任何根目录/对象目录符号链接、对象符号链接、硬链接数异常策略或非普通文件均终止并进入诊断。
- 文件句柄打开后再 `fstat`，避免检查与打开之间被替换；部署账户之外禁止目录写权限。
- C04 不记录完整绝对路径；诊断使用阶段、摘要短标识和受保护引用。

### 8. 孤儿与 staging 维护

分类：

- `stale-staging`：`.part` 修改时间早于 `observedBefore`，没有活动写句柄；
- `orphan-object`：合法 SHA-256 对象，早于宽限期，`business.artifact_manifests` 中 `content_sha256` 引用数为 0；
- `unreferenced-manifest`：清单存在但尚无领域事实引用，不是物理孤儿，C04 不删除；
- `shared-object`：至少一个清单引用，始终保留；
- `quarantined-object`：先前维护中断后的隔离文件。

`sweepOrphans` 默认 `dryRun=true`。执行删除时获取与 put 相同 advisory key 的**排他 session lock**；锁超时返回可重试 `ARTIFACT_MAINTENANCE_BUSY`。锁内重新扫描候选、检查规范路径/mtime、查询摘要引用数；零引用且超期才原子移动到 `quarantine/<runId>/hash` 并刷新目录。随后以 C03 零事件事务追加维护审计；审计提交后删除隔离文件并刷新目录。审计失败则尽力还原，进程崩溃则下次依据数据库引用和维护 run/audit 身份决定还原或删除。

维护批次最多 `maintenanceBatchSize`；每批释放资源后继续。它不跟踪“领域引用计数”，因为任何清单本身就是文件存在的有效引用；领域保留/删除清单由 C11/C37 后续 change 规划。这个边界避免 C04 猜测业务保留政策。

### 9. 哈希清单、备份与恢复核对

`createHashManifest` 在调用方已冻结的 PostgreSQL 读取快照下按主键游标流式扫描获准工程清单；每行 strict 解析并核对 `manifestSha256`，输出确定性 NDJSON 后通过普通 `put` 保存。`backupBatchRef`、`databaseSnapshotRef` 与 `fileSnapshotRef` 由 C37 提供；C04 不创建备份或声称快照原子。

备份顺序由 C37 保证“文件快照是数据库恢复点引用集合的超集”。恢复时，C37 把哈希清单字节流与已恢复数据库/文件根交给 `reconcile`：

1. strict/流式验证 header、每个 entry、排序、entryCount、`entriesSha256` 和快照引用；
2. 对数据库每个已提交清单核对清单 entry、物理普通文件、长度、SHA-256 与 `manifestSha256`；
3. 扫描物理对象，把数据库无摘要引用的对象列为 orphan；
4. 输出流式 findings 与最终 summary；`missing-object`、`content-mismatch`、`manifest-conflict` 任一存在即 `passed=false`；
5. 不从文件/清单 INSERT 数据库，不从 checkpoint、Outbox 或目录补造领域事实。

恢复核对可以修复的唯一动作是由运维从可信备份恢复**同一 SHA-256 字节**后重新执行；改变摘要意味着新工件版本，不能修补旧引用。RPO/RTO、异机副本、备份介质和演练频率属于 C37。

### 10. 错误映射、审计与可观测性

内部闭合 `ArtifactErrorCodeV1`：

```text
ARTIFACT_INPUT_INVALID              non-retryable
ARTIFACT_TOO_LARGE                  non-retryable
ARTIFACT_HASH_MISMATCH              non-retryable
ARTIFACT_REFERENCE_NOT_FOUND        non-retryable
ARTIFACT_ACCESS_DENIED              non-retryable
ARTIFACT_INHERITANCE_CONFLICT       non-retryable
ARTIFACT_IO_FAILURE                 retryable when classified transient
ARTIFACT_REGISTRY_FAILURE           retryable when DB/lock transient
ARTIFACT_INTEGRITY_FAILURE          non-retryable
ARTIFACT_MAINTENANCE_BUSY           retryable
ARTIFACT_RECOVERY_BLOCKED           non-retryable
ARTIFACT_UNSUPPORTED_VERSION        non-retryable
```

`ArtifactErrorV1 = { code, retryable, stage, occurredAt, diagnosticRef, contextRefs }`，不含自由对象袋。映射：访问拒绝 → `AUTHORIZATION_DENIED`；已授权不存在 → `ENTITY_NOT_FOUND`；临时 I/O/数据库/维护锁 → `TRANSIENT_FAILURE`；Schema/完整性/继承/恢复阻断 → `TERMINAL_FAILURE`；未知 schema → `UNSUPPORTED_CONTRACT`；C03 幂等冲突保持 `IDEMPOTENCY_CONFLICT`。

只追加审计动作固定为 `artifact.put`、`artifact.read-started`、`artifact.hash-manifest-created`、`artifact.orphan-sweep`、`artifact.reconcile`。写入/哈希清单/清理审计失败阻断其数据库提交；读取审计失败不返回字节。完整性失败和授权拒绝另写受保护安全/运维日志；不能因无法写普通日志而伪装成功。

指标：写/读请求数与字节、成功/失败、去重命中、staging 占用、孤儿/隔离数量、完整性失败、维护锁等待、hash/reconcile 速率；维度只含阶段、结果、种类和受保护工程引用，禁止完整摘要形成高基数标签。日志/错误不含正文、原始文件名、绝对路径、连接串、token、模型响应或思维链。

### 11. 性能与资源上限

所有字节、哈希清单和 findings 都使用 `AsyncIterable<Uint8Array>`/逐行流式处理；核心逻辑不得调用会把完整工件载入内存的 `readFile` 或无界 `Buffer.concat`。写入/读取信号量和 staging 字节预算来自冻结策略；超限通过背压或结构化错误返回，不跳过校验。

C04 验收不冻结硬件 SLA，只证明实现形态：

- 一个 256 MiB 确定性生成流，以不超过 1 MiB chunk 完成写入/读取/摘要往返；采集 peak heap，确认正文不以 256 MiB 整体缓冲。
- 8 个并发 16 MiB 不同内容和 8 个并发相同内容完成，无损坏、无重复物理对象、无文件描述符泄漏。
- 10,000 条合成清单的哈希清单与 reconcile 使用游标/批次，记录条目/秒和 heap。
- 报告 Node/OS、存储类型、样本、并发、冷/热状态、wall time、吞吐、heap 和磁盘变化；不设置易受 CI 磁盘影响的毫秒硬断言。

若真实目标硬件基准显示本地目录在容量、并发或运维上不足，由 C37 的量化结果另开对象存储 change；C04 不预建 S3 seam。

### 12. 测试层次与验收

`packages/core/test/artifacts.test.ts` 使用表驱动方式验证：strict V1 DTO、kind/ref 对齐、版本由 SHA-256 形成、策略关系、权限集合排序去重、父证据并集、错误映射与哈希清单规范行。它不断言完整错误文案、字段顺序或内部调用顺序。

`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 每文件启动一个固定 PostgreSQL Testcontainer并创建一个 `mkdtemp` 数据根；复用 C03 bootstrap/生产 migrations，再运行 C04 migration。测试结束关闭流/pg/Kysely 后移除精确临时目录并停止容器。容器不可用时明确失败，不回退内存 registry。

同一集成文件覆盖：

- 初次落位、相同内容去重、并发相同/不同内容、空文件、期望长度/摘要错误、大小上限；
- 在 staging sync、object link、DB handler、audit commit、DB commit 后通过测试私有 failpoint 强杀/抛错，重启后证明只有孤儿、没有悬空清单；
- 同命令重放、同键不同内容/权限冲突、不同命令同内容独立清单；
- 直接权限快照、多父继承、跨工程、缺 grant/scope/能力、无权不存在不泄露；
- 路径穿越输入无入口、对象/目录 symlink、非普通文件、截断/篡改、读取未完成和 verified 收据；
- 下游夹具事实 + 工件 guard + 审计 + Outbox 的同事务成功/回滚，未登记引用零部分事实；
- dry-run、宽限期、共享对象、维护/put 竞争、隔离阶段崩溃与重启收口；
- 确定哈希清单、完整恢复、缺失/损坏/冲突、额外孤儿、数据库点晚于文件快照；
- §11 的流式/并发/10,000 条基准证据。

测试 failpoint 与 fixture 表只存在 `packages/adapters/test/artifacts/**`，不进入生产 exports、migration root 或 API。

### 13. RI/RA、接口、持久化与验收追踪

| 来源 | C04 interface/DTO | 持久化/文件 | 验收 |
| --- | --- | --- | --- |
| RI-S14 | put/read/maintenance 授权与审计 | access snapshot、audit | 越权、审计失败、历史策略 |
| RI-S21～S23 | put/open、content identity | 不可变对象、长度/SHA-256 | 流失败、摘要错误、损坏 |
| RI-S42、RI-S44 | manifest evidence/parents/version | 清单证据与精确版本 | 证据继承、版本不可改 |
| RI-S52～S58 | content artifact refs | 检索/模型/候选正文工件 | 大正文不进状态/DB |
| RI-S61～S65 | reference guard/hash manifest | 清单 + 领域事务校验 | 无悬空领域引用、恢复 |
| RA-S1、RA-S3～S4 | put/manifest evidence | 资料、规则候选/版本正文 | 权限/版本/证据可追溯 |
| RA-S5～S7 | artifact refs/read verification | 评估依据、处置/反馈/报告正文 | 完整性、派生继承、审计 |
| C02 graph/events | ArtifactRefV1 | 只传精确引用 | 图状态/Outbox 无正文 |
| C03 persistence | put/guard/maintenance | 事务清单、收据、审计、零事件 | 原子回滚、幂等、无自创事件 |

### 14. 精确文件所有权与依赖门

实施允许新增：

```text
packages/core/src/artifacts/schema.ts
packages/core/src/artifacts/store.ts
packages/core/src/artifacts/index.ts
packages/core/test/artifacts.test.ts

packages/adapters/src/artifacts/filesystem-artifact-store.ts
packages/adapters/src/artifacts/postgres-artifact-registry.ts
packages/adapters/src/artifacts/maintenance.ts
packages/adapters/src/artifacts/index.ts
packages/adapters/test/artifacts/fixture.ts
packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts

packages/adapters/src/postgres/migrations/platform/
  deliver-content-addressed-artifact-store/000002_artifact_manifests.ts
```

主调度 Agent 在 planning checkpoint 后串行修改：

- `packages/core/package.json`：新增 `./artifacts` export；
- `packages/adapters/package.json`：新增 `./artifacts` export。

无任何新依赖，不修改依赖字段、`config/dependency-policy.json` 或 `pnpm-lock.yaml`，不形成 dependency checkpoint。实现 worker 不修改 package manifests；它以已完成 export checkpoint 为前置。

明确禁止修改：`packages/contracts/**`、`packages/core/src/persistence/**`、`packages/adapters/src/postgres/{bootstrap,pool,types,transaction-unit,outbox,idempotent-consumer,checkpointer,index}.ts`、C03 migration、`apps/**`、`demo/**`、根配置/清单、锁文件、`openspec/config.yaml`、`openspec/specs/**`、归档 change 和其它活动 change。删除文件为零。

### 15. 被否决方案与重新评估条件

| 方案 | 决定 | 重新评估条件 |
| --- | --- | --- |
| PostgreSQL `bytea` 保存正文 | 否决；扩大 WAL/备份且把大正文混入事实库 | 只有工件被证明均极小且外部文件一致性成本更高时另开 change |
| MinIO/S3 默认对象层 | 否决；当前单机 MVP 增服务与许可/运维负担 | 多节点、对象锁、S3 生态、跨站点复制或单卷容量门槛出现 |
| 用户文件名/UUID 作为路径 | 否决；不可核对、易泄露/穿越、需额外映射 | 无；内容寻址是本 capability 契约 |
| 数据库先提交、异步写文件 | 否决；产生悬空引用 | 无；违反硬一致性方向 |
| 两阶段提交/分布式事务 | 否决；文件系统无 XA，复杂度不换来恢复收益 | 存储后端将来提供已验证原子事务并另开架构 change |
| 每次引用都全量重哈希 | 否决；长事务和大文件成本过高 | 定期 scrub/读取检测仍不能满足实测完整性风险时 |
| 在线删除已登记对象 | 否决；保留政策尚属 C11/C37 | 领域保留/合法删除和引用追踪契约已归档后另开 change |

## Risks / Trade-offs

- **单卷故障仍会同时影响对象集合** → C04 用哈希清单发现损坏；C37 负责异故障域备份、恢复点与演练，不能把同盘目录称为灾备。
- **文件与 PostgreSQL 无共同事务** → 严格采用文件先行、命令幂等、孤儿宽限期和恢复硬核对，绝不接受悬空引用。
- **每次完整读取计算 SHA-256 增加 I/O/CPU** → 保持流式并记录性能；只有目标硬件基准证明不可接受才规划受审计 scrub/可信校验缓存。
- **session advisory lock 使清理与最终登记互斥** → put 只在内容已 staging 后持共享锁，维护分批；观测锁等待后再考虑按摘要分片锁。
- **C06 尚未实现策略解释** → C04 只做工程、能力与精确 scope/grant 集合的保守包含校验并保存策略版本；不自行推断角色或扩大权限。
- **清单 JSONB 未来可能变大** → 父/证据引用只保存精确小引用并设策略上限；真实数据超限后再设计分页关系表，不预建。

## Migration Plan

1. 主调度 Agent审阅 planning artifacts，确认 `000002` 未冲突并形成 planning checkpoint。
2. 主调度 Agent只为两个 package 增加 `./artifacts` exports，冻结安装/锁文件不变，形成 export checkpoint。
3. 实现 core Schema/ports 与纯函数测试。
4. 实现 C04 migration、PostgreSQL registry、本地目录写读与引用 guard。
5. 实现 hash manifest、reconcile、staging/orphan maintenance 和真实 PostgreSQL+临时目录测试。
6. 运行定向测试、类型/格式/依赖边界、全仓 `pnpm verify` 与独立 `openspec-verify-change`；不启动服务。

部署时先以 C03 migrator 执行 `000002`，再以部署配置创建同卷根目录并校验权限/无符号链接，最后装配 adapter。migration 或根目录预检失败时应用不得启用工件引用路径。

非生产回滚可以在确认没有任何下游事实引用后删除 C04 清单表与精确测试目录；生产不自动执行破坏性 down。代码回退必须保留目录和清单表以继续读取已有引用；若旧版本不认识 V1，则停止而不是删除数据。

## Open Questions

无。所有会改变 capability、接口、依赖、迁移、权限或任务拆分的选择均已固定；命中重新评估条件时停止实现并另开 OpenSpec change。
