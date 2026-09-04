## Why

C01/C02 已冻结授权上下文、能力和错误契约，C03 已提供 PostgreSQL 原子提交、幂等与只追加审计基础，但系统仍没有能够签发这些授权上下文的真实身份与访问控制实现。C06 需要先建立本地账号、服务端会话和工程访问边界，后续复核、Agent、HTTP、工程资料与界面才能在默认拒绝且不泄露资料正文的前提下复用同一授权事实。

## What Changes

- 建立禁止自助注册的 RiskFlow 本地账号与一次性初始系统管理员引导；系统管理员可创建、停用和重置账号，但系统管理员角色本身不产生任何工程业务能力。
- 建立服务端有状态会话：密码使用 Node.js `crypto.scrypt` 强哈希，Bearer token 由 CSPRNG 与 HMAC 生成且不明文落库，会话具有空闲/绝对超时、注销、密码变更/重置与账号停用后的强制失效语义。
- 固定五个预设角色：系统管理员、工程风险管理员、复核人、现场处置人员、业务查看者；工程角色映射到 C02 `ModuleCapabilityV1`，同一账号可按工程叠加角色，MVP 不提供自定义角色设计器或强制双人审批。
- 建立工程访问壳、工程成员与空间授权范围；每个工程自动建立根空间范围，成员角色和空间范围使用只追加修订，跨工程、越出父范围、陈旧修订和移除后重放全部拒绝。
- 固定资料访问范围只有“工程内共享”和“指定可见”两级，新资料默认“指定可见”；资料段、解析工件和证据正文继承资料版本权限，风险结论与证据定位可按工程权限展示，正文与原件仍逐次独立授权。
- 提供服务端授权入口：调用方只提交当前会话/因果授权引用、目标工程、所需 C02 能力、空间和资料引用；服务端从当前账号、会话、成员、角色、空间和资料授权事实计算并保存不可变 `AuthorizationContextV1`，客户端提交的能力或授权上下文一律忽略。
- 所有账号、会话、工程成员、空间和资料授权变更使用 PostgreSQL 真实约束；已认证管理命令复用 C03 `(projectId, commandKind, idempotencyKey)`、事务、审计和零事件提交，认证/越权安全事件单独只追加且不得包含密码、token、资料正文或目标存在性。
- 使用已有 Vitest 与 `postgres:18.6-bookworm` Testcontainers 验证账号/登录/停用/重置/超时、并发与幂等、角色与空间边界、系统管理员无业务特权、两级资料权限继承和正文隔离，并留下非脆弱的授权性能检查。

### Non-goals

- 不接 LDAP、OIDC、SAML、MFA、邮件/短信找回、外部统一身份平台或自助注册；不实现自定义角色/权限设计器、多人强制审批或岗位组织模型。
- 不实现 C09 的 HTTP 路由、Cookie/CSRF/CORS/TLS 配置，C10/C35 的登录与系统管理界面，C11 的工程业务修订、资料版本/资料段正文，C07 的统一复核审计查询，或 C37 的秘密文件、部署 LOGIN 主体和密钥轮换流程。
- 不让 Agent、Worker、系统管理员、数据库角色、连接凭据或前端缓存成为独立业务主体或扩大当前用户权限。
- 不修改 C01/C02 共享 Schema、C03 基础迁移/事务实现、根配置、依赖清单、锁文件、主 specs 或任何归档 change；不增加生产 Mock、内存账号库、JWT、自研加密算法、Redis 或第二套授权事实源。

## Capabilities

### New Capabilities

- `platform/local-identity-project-authorization`: 规定本地账号与安全会话、预设角色、工程成员与空间范围、两级资料权限、服务端授权决定、版本/事务/幂等/审计及安全失败的稳定行为。

### Modified Capabilities

无。

## Impact

- **直接依赖**：已归档 C01 `domain/contract-kernel` 与 C03 `platform/postgresql-outbox-checkpoint-foundation`；同时只消费 C02 已冻结的 `AuthorizationContextV1`、`ModuleCapabilityV1`、`ModuleErrorV1` 和分支能力映射，不修改它们。
- **下游消费者**：C07 复核审计、C08 Agent runtime、C09 HTTP shell、C10 Web shell、C11 工程资料、C16 知识治理、C20 检索、C24/C30 工作流、C31 投影、C32～C35 页面以及 C37/C38 部署验收。
- **事实所有权**：C06 拥有本地账号状态与凭据修订、会话、工程访问壳、空间授权身份、工程成员修订、资料访问授权修订、授权决定快照和安全审计事件；只引用 C01/C02 的身份/版本/能力与后续 C11 的工程业务修订、资料版本和正文，不拥有工程业务元数据、资料正文、风险/评估/预警/处置事实或统一审计投影。
- **代码范围**：计划新增 `packages/core/src/access/**`、`packages/core/test/access.test.ts`、`packages/adapters/src/auth/**`、`packages/adapters/test/auth/**`，以及 C03 约定下的 `packages/adapters/src/postgres/migrations/platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.ts`；package exports 由主调度 Agent 在后续实现检查点串行登记。
- **依赖治理**：无新 npm 或非 npm 依赖。实现遵守仓库运行时 `node >=24.12.0 <25` 与 `pnpm@11.10.0`，复用 Node.js `node:crypto`、现有 `zod@4.5.4`、`kysely@0.29.5`、`pg@8.23.0`、`@types/pg@8.23.1`、`@testcontainers/postgresql@12.1.0` 和固定 `postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`；因此不修改 manifest、依赖政策或锁文件。
- **RI/RA 与功能追踪**：横切支撑 RI-S14 权限登记和变更日志、RI-S42/RI-S61～S65 证据正文隔离、RA-S1 工程/空间作用域及 RA-S3～S7 的证据与业务操作权限；对应 F-PJ-01～03、F-DA-01、F-AU-01/02、F-AG-01/02 和 MVP 只读账号验收，不替代任何 RI/RA 领域步骤。
- **重新决策条件**：若实现要求扩张 C01/C02 Schema、修改 C03 基础表或迁移发现规则、增加身份/密码/会话依赖、把工程业务修订或资料正文移入 access、允许系统管理员自动获得业务权限，或改变“两级资料权限/五预设角色”基线，必须停止并由主调度 Agent更新或另开契约演进 change。
