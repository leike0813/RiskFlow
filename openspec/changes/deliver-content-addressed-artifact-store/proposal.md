## Why

C02 已冻结 `ContentArtifactRefV1`、`DiagnosticArtifactRefV1`、证据引用和授权上下文，C03 已提供 PostgreSQL 原子提交、审计、Outbox 与迁移基础，但这些引用尚无可运行的内容存储。C04 需要先建立单机可恢复的不可变内容寻址目录，使工程原件、解析中间物、模型原始响应、Agent 增量、诊断和导出可以在“文件先耐久落位、数据库后提交引用”的约束下被后续模块安全复用。

## What Changes

- 新增内容寻址工件存储 capability：以 SHA-256 派生不可变存储键，流式写入 staging，校验长度/期望摘要，刷新文件与目录后原子落位；相同内容复用同一物理对象，不覆盖既有字节。
- 新增严格 Zod V1 DTO 和窄 interface，复用 C02 的内容/诊断工件引用、`EvidenceReference`、`AuthorizationContextV1` 与精确版本语义；TypeScript 类型仅由 Schema 推导，二进制流不进入 DTO、事件、检查点或数据库正文。
- 新增 PostgreSQL 工件清单与 C03 事务接入：物理对象耐久后，工件清单、命令结果和只追加审计在同一事务提交；领域 adapter 只有在工件引用已注册且权限范围兼容时才能在自己的事务中引用它。
- 固定权限继承：直接工件冻结当前工程、空间范围、资料访问授权和授权策略版本；派生工件继承全部父工件限制且只能收窄，读取在返回任何字节前执行服务端授权，不泄露无权对象是否存在。
- 新增哈希清单、完整性核验、孤儿识别/宽限期清理和恢复后对账；允许数据库事务失败后留下无引用文件，禁止任何已提交清单或领域事实引用缺失、长度不符或摘要不符的文件。
- 用临时目录与固定 PostgreSQL Testcontainers 覆盖原子落位、崩溃边界、并发去重、幂等冲突、越权拒绝、损坏检测、孤儿清理及备份恢复对账；增加流式大文件和并发写读的资源/吞吐基线。

### Non-goals

- 不实现 S3/MinIO/SeaweedFS、跨节点副本、对象锁、云上传、多卷分层、CDN、病毒扫描、格式解析、OCR、模型网关、Qdrant、备份调度、生产级灾备或高可用。
- 不实现资料版本、资料段、保留/删除业务政策或用户/工程授权事实；C04 只冻结并执行调用方提供的 C02 授权引用，C06/C11/C37 分别拥有授权、工程资料和部署恢复流程。
- 不修改 C01/C02 公共契约，不新增工件领域事件，不把文件正文放入 PostgreSQL、Outbox、审计、错误、日志或 LangGraph checkpoint，不提供任意路径/URL/文件名读取接口。
- 不删除仍被任何清单引用的对象，不承诺数据库与文件系统的分布式原子事务，也不把无引用孤儿误报为已提交事实损坏。

## Capabilities

### New Capabilities

- `platform/content-addressed-artifact-store`: 规定不可变本地内容目录、V1 工件清单与引用、先耐久落位后提交、权限继承、哈希校验、孤儿处理及恢复对账的稳定行为。

### Modified Capabilities

无。

## Impact

- **直接依赖**：仅已归档 C02 `domain/module-interfaces-events-workflows` 与 C03 `platform/postgresql-outbox-checkpoint-foundation`。复用 C02 的 `ContentArtifactRefV1Schema`、`DiagnosticArtifactRefV1Schema`、`EvidenceReferenceSchema`、`AuthorizationContextV1Schema` 和闭合 `ModuleErrorV1` 语义；复用 C03 的 `TransactionUnitV1`、不透明事务上下文、规范 JSON/SHA-256、审计和模块迁移发现，不改变两者契约。
- **下游消费者**：C05、C08、C11～C13、C15、C17、C19～C22、C24、C27、C29、C31、C36～C38 通过工件引用保存模型/Agent/解析/证据/报告内容；它们不能直读存储目录或数据库清单。
- **RI/RA 追踪**：为 RI-S14、RI-S21～RI-S23、RI-S42、RI-S44、RI-S52～RI-S58、RI-S61～RI-S65 及 RA-S1、RA-S3～RA-S7 提供原始资料版本、证据、模型/Agent 产物、规则/报告内容的不可变载体；C04 不解释这些领域内容，也不计算识别、P/C、矩阵、预警或处置结果。
- **事实与文件所有权**：`packages/core/src/artifacts/**` 拥有与存储产品无关的 DTO/port；`packages/adapters/src/artifacts/**` 拥有本地目录与 PostgreSQL 工件清单 adapter；C04 只拥有 `business.artifact_manifests` 及其 `000002` migration，不拥有 C03 表、领域事实或 checkpoint。
- **计划实现范围**：新增 `packages/core/src/artifacts/**`、`packages/core/test/artifacts.test.ts`、`packages/adapters/src/artifacts/**`、`packages/adapters/test/artifacts/**` 和 `packages/adapters/src/postgres/migrations/platform/deliver-content-addressed-artifact-store/000002_artifact_manifests.ts`。稳定子路径 exports 由主调度 Agent在 planning checkpoint 后串行加入两个 package manifest；本 change 不修改根配置、锁文件或中央注册表。
- **依赖治理**：无新 npm、系统或服务依赖；精确复用 Node.js `>=24.12.0 <25` 的 `node:fs/promises`、`node:crypto`、`node:path`、`node:stream`，以及现有 `zod@4.5.4`、`kysely@0.29.5`、`pg@8.23.0`、`@testcontainers/postgresql@12.1.0` 和 `postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`。因此无依赖门、许可证、离线包或锁文件变化。
- **禁止修改**：`packages/contracts/**`、C03 现有生产文件和归档工件、`apps/**`、`demo/**`、根工具链/清单、`openspec/config.yaml`、`openspec/specs/**`、其它 change 与 `pnpm-lock.yaml`。

若实现需要修改 C01/C02 引用字段、增加新领域事件、暴露路径/URL、让数据库先于文件提交、引入对象存储服务或删除有引用对象，必须停止并由主调度 Agent重新规划。
