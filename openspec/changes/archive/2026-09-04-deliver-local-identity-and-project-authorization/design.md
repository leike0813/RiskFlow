## Context

见 [proposal.md](./proposal.md) 的动机与 [spec](./specs/platform/local-identity-project-authorization/spec.md) 的稳定行为。C01 已提供身份、版本和审计值对象；C02 已冻结 `AuthorizationContextV1`、`ModuleCapabilityV1`、`MODULE_BRANCH_CAPABILITY_V1`、`ModuleErrorV1` 以及所有命令/查询授权字段；C03 已提供 PostgreSQL 18.6、模块迁移发现、不透明事务上下文、命令幂等收据和只追加 `audit.entries`。

C06 必须消费上述契约而不修改它们。工程业务修订、适用性元数据、资料版本/资料段和正文属于 C11；C06 只拥有可在这些对象出现前独立验收的工程访问壳、空间授权身份和资料访问授予。认证发生在授权上下文形成之前，因此登录/拒绝安全事件不能伪造一个 C02 授权上下文塞入 C03 命令事务；它们使用 C06 自有、同样只追加的安全审计表，C07 后续统一投影。

## Goals / Non-Goals

**Goals:**

- 用少量领域级入口完成本地账号管理、服务端会话、工程访问管理和授权决定；不暴露数据库、Kysely、密码派生值或通用权限查询器。
- 以 C02 精确 branch 为授权输入，再派生单一所需 `ModuleCapabilityV1`，避免粗粒度 capability 让现场处置人员或复核人取得同能力下的其它动作。
- 对账号、成员、空间、资料权限和策略变化默认拒绝并立即收口；历史业务事实仍能引用原授权版本。
- 复用 C03 的迁移、事务、幂等和审计基础；认证前后的特殊安全事务仍在同一 PostgreSQL 实例中原子完成。
- 只使用 Node.js 标准密码学和现有依赖，留下可运行的真实 PostgreSQL 安全与性能验收。

**Non-Goals:**

- 不创建第二套 C02 module interface、能力枚举或授权上下文；不修改 C01/C02/C03 文件。
- 不实现 HTTP Cookie、CSRF、TLS、登录页面、账号管理页面或项目业务页面；C09 必须把 opaque token 放入 `__Host-riskflow_session`、`Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/` 且无 `Domain` 的 Cookie，并忽略客户端授权字段。
- 不接外部身份、MFA、邮件/短信找回、密码泄露在线查询或自定义角色设计器。离线密码泄露字典只有在 C37 提供有版本、许可证和更新责任的数据集后另开 change；C06 不硬编码脆弱的字符串黑名单。
- 不拥有工程施工工法、地层条件、工程阶段、里程修订、资料正文/资料段、风险、规则、评估、预警、处置、统一审计投影或部署秘密文件。
- 不为未来 Redis/JWT/集中式会话、组织架构、审批流或多租户规模化预建 adapter。

## Decisions

### 1. 深层 access 模块保存规则，auth adapter 保存 PostgreSQL 与密码学细节

计划公开两个稳定子路径：

| 子路径 | 内容 | 不导出 |
| --- | --- | --- |
| `@riskflow/core/access` | strict DTO、状态/错误、预设角色策略、branch 允许表、空间闭包与资料权限交集、窄用例 interface | 密码派生值、SQL、表行、任意策略表达式 |
| `@riskflow/adapters/auth` | 本地账号/会话/授权 PostgreSQL 实现、密码派生、token 编解码、一次性引导和工厂 | `Pool`、`Kysely`、transaction、表行、盐、派生值、HMAC key |

`packages/core/src/access/` 只依赖 `@riskflow/contracts`、现有 Zod 和 Node 类型；确定性策略不访问存储。`packages/adapters/src/auth/` 通过相对内部导入复用 C03 `createPostgresRuntime`、`PostgresTransactionUnit`、`getPostgresTransaction` 和错误映射。C03 当前私有 transaction 类型只列基础表，C06 在 `postgres-types.ts` 定义 `AccessPostgresDatabase`，并仅在 adapter 私有辅助函数中把不透明 transaction 收窄为该扩展类型；不把 cast 或数据库类型带出 adapter。

备选“直接在 C02 增加账号命令”会破坏 G0 已冻结共享契约；备选“把权限写进每个业务模块”会形成多套事实源；备选 JWT 会让停用、撤权和资料权限修订无法即时收口。均否决。

### 2. 用例 interface 与 strict Schema

`schema.ts` 定义并导出以下闭合值：

| Schema / 值 | 冻结内容 |
| --- | --- |
| `LocalAccountStatusV1Schema` | `active \| disabled` |
| `PresetRoleV1Schema` | `system-administrator \| project-risk-manager \| reviewer \| field-responder \| business-viewer` |
| `ProjectAccessStatusV1Schema` | `active \| suspended`；不替代 C11 工程业务生命周期 |
| `SpatialAccessStatusV1Schema` | `active \| inactive` |
| `SourceVisibilityV1Schema` | `project-shared \| restricted`，界面分别显示“工程内共享”“指定可见” |
| `AuthorizationInvocationRequestV1Schema` | `human-session \| system \| agent-task` 三分支；后两者必须带父上下文与因果 run，Agent 还带任务引用 |
| `AccessErrorV1Schema` | 闭合错误联合，见 §10 |

固定输入上限：规范化登录名 3～64 个 ASCII 小写字母/数字及 `._-`，首字符为字母；显示名 1～100 个 Unicode 字符；密码 15～128 个 Unicode 字符且 UTF-8 ≤512 字节；单成员工程角色 1～4 项、空间引用 1～128 项；单资料指定账号 1～512 项、关联空间 1～128 项；一次授权请求空间 1～128 项、资料引用 0～256 项。数组去重并拒绝未知字段。

`commands.ts` 定义三组 union：

- `IdentityAdministrationCommandV1`：`create-account`、`disable-account`、`reset-password`；全部带 `commandId/idempotencyKey/expectedVersion` 和当前系统管理员授权引用。
- `ProjectAccessCommandV1`：`open-project`、`suspend-project`、`revise-membership`、`create-spatial-scope`、`revise-spatial-scope`、`revise-source-access`；更新分支带目标当前精确版本。
- `SessionCommandV1`：`login`、`change-password`、`logout`。`login` 使用 `loginAttemptId`；另两项使用当前 session token。密码只存在于进程内命令，不参与审计/日志/普通命令收据 JSON。

`service.ts` 只暴露用例级 interface：

```ts
interface LocalIdentityAccessV1 {
  administerIdentity(command: IdentityAdministrationCommandV1): Promise<AccessCommandResultV1>;
  administerProject(command: ProjectAccessCommandV1): Promise<AccessCommandResultV1>;
  login(command: LoginCommandV1): Promise<SessionResultV1>;
  changePassword(command: ChangePasswordCommandV1): Promise<SessionResultV1>;
  logout(command: LogoutCommandV1): Promise<AccessCommandResultV1>;
  authorize(request: AuthorizationRequestV1): Promise<AuthorizationDecisionV1>;
  verify(request: AuthorizationVerificationRequestV1): Promise<AuthorizationDecisionV1>;
}
```

成功结果只返回账号/工程/成员/空间/资料授权精确引用、C02 `AuthorizationContextV1` 或 opaque token；失败为 `AccessErrorV1`。没有 `execute(any)`、`getUserPermissions()`、任意资源字符串、通用 repository 或直接读表方法。`bootstrapInitialSystemAdministrator` 是 auth adapter 的独立部署动作，只接受显式配置与密码，不属于运行时 interface。

### 3. 本地账号、密码和初始引导

登录名在边界执行 trim + ASCII lowercase；密码按收到的 Unicode 标量原样编码 UTF-8，不 trim、不规范化、不截断。显示名可 trim，但不参与认证身份。

密码使用 Node.js 24 异步 `crypto.scrypt`，冻结 `password-policy/v1`：

```text
N/cost = 131072 (2^17)
r/blockSize = 8
p/parallelization = 1
keyLength = 32 bytes
saltLength = 16 random bytes
maxmem = 268435456 bytes (256 MiB)
最多 4 个并发 scrypt 作业/进程
```

凭据行保存算法 `scrypt`、策略版本、参数、随机盐和 32 字节派生值。比较使用等长 Buffer 与 `timingSafeEqual`。未知/停用/节流账号走同参数 dummy credential，外部统一返回 `AUTHENTICATION_REJECTED`；内部安全审计保存闭合原因码。滚动 15 分钟内第 5 次失败开始锁定 15 分钟；查询以最近成功登录或管理员重置为失败窗口起点，不维护可漂移的内存计数。

初始引导在 `SERIALIZABLE` 事务/数据库 advisory lock 内检查账号表为空，创建要求首次改密的账号和系统管理员授予，并追加安全事件。账号创建和重置也设置 `passwordChangeRequired=true`。首次登录得到 restricted session；只有改密、会话查询和注销可用。成功改密新增凭据修订、增加 `securityVersion`、撤销全部旧会话并签发新会话。

不使用 Argon2 依赖，因为仓库运行时 `node >=24.12.0 <25` 的标准库已经提供满足冻结参数的 scrypt；实现沿用 `pnpm@11.10.0`，不增加依赖。以后只有明确的合规/性能门槛要求 Argon2/FIPS 算法时另开依赖 change。

### 4. 会话 token、超时和重放

运行组合根显式注入至少 32 随机字节的 HMAC key 与非空 `keyVersion`；C06 不读环境变量、不创建秘密文件。token 格式固定为：

```text
v1.<128-bit random sessionId>.<128-bit random nonce>.<HMAC-SHA-256>
HMAC input = "riskflow-session-v1\0" + sessionId + "\0" + nonce
```

各二进制段用无 padding base64url。数据库保存 sessionId、nonce、keyVersion 和 token SHA-256 指纹，不保存完整 token/HMAC；服务端可用注入 key 重建同一 token，既支持同一 `loginAttemptId` 的安全幂等返回，也不让数据库单独泄露 bearer 凭据。解析先做长度/版本上限检查，再用 `timingSafeEqual` 校验 HMAC；只接受服务端已创建的 sessionId。

会话状态由 `active/revoked/expired` 推导，行保存 `credentialVersion`、`accountSecurityVersion`、`createdAt`、`lastSeenAt`、`idleExpiresAt=lastSeenAt+30m`、`absoluteExpiresAt=createdAt+12h`、可选撤销时间/原因。每次成功人类认证在短事务中读取账号/凭据版本并更新 `lastSeenAt/idleExpiresAt`，绝对时间不变；超时只在首次观察时追加一次安全事件。注销幂等。账号停用、重置、改密或 HMAC keyVersion 不匹配均拒绝并撤销会话。

同一 `loginAttemptId + canonicalLoginName` 在验证当前密码成功后读取既有 session、重建 token 并返回，既不新增会话也不重复成功审计；同 attempt ID 不同登录名返回 `IDEMPOTENCY_CONFLICT`。密码不写入幂等摘要。HMAC key 轮换使旧 token 全部失效；轮换流程和秘密文件属于 C37。

### 5. 预设角色按 branch 允许表映射，不只看粗 capability

`policy.ts` 是唯一 `access-policy/v1` 事实源。授权输入必须是 C02 `ModuleBranchV1`；实现从 `MODULE_BRANCH_CAPABILITY_V1[branch]` 派生上下文中唯一 capability。角色允许表如下：

| 角色 | 允许的 C02 branch |
| --- | --- |
| 系统管理员 | 无；系统级 access 管理动作另表判断 |
| 工程风险管理员 | C02 v1 `MODULE_BRANCH_CAPABILITY_V1` 的全部 branch |
| 复核人 | `review-audit.decide-review`、`review-audit.trace`、`projection.query`、`projection.subscribe`、`engineering-data.evidence-access` |
| 现场处置人员 | `warning-response.record-execution`、`warning-response.record-feedback`、`projection.query`、`projection.subscribe`、`engineering-data.evidence-access` |
| 业务查看者 | `projection.query`、`projection.subscribe`、`projection.export`、`engineering-data.evidence-access` |

系统级 access 动作表：系统管理员可创建/停用/重置账号、开通/暂停工程、修订工程成员；工程风险管理员可修订所在工程成员、空间范围与资料权限。系统管理员若要读取/处理工程业务，必须显式成为该工程成员并获得工程角色；这次授予形成独立命令和审计。工程成员修订不得移除最后一名有效工程风险管理员。

相比把角色直接映射到 `ModuleCapabilityV1`，branch 允许表可避免 `warning-response.record` 同时覆盖开预警、采纳建议、记录执行、计算偏差等动作造成权限扩大。上下文仍只携带 C02 capability，不扩张 C02 Schema；`verify` 同时核对绑定 branch。

### 6. 工程访问壳、空间树和成员修订

工程访问壳只含稳定 `projectId`、`active/suspended`、根 `SpatialScopeRefV1` 与访问版本；C11 后续拥有工程名称、施工工法、地层、阶段、里程和业务生命周期。`open-project` 原子创建访问壳、根 scope 与至少一名工程风险管理员。系统管理员可选择自己作为初始成员，但这必须是显式工程角色授予，不由系统角色继承。

空间身份稳定且只属于一个工程；修订只含父 scope、`active/inactive` 和版本。根无父项；其它 scope 必须引用同工程当前有效父项。创建/修订在数据库递归查询中拒绝跨工程、循环和失效父项。授权闭包规则只有一条：授予父 scope 包含其当前有效后代，授予子 scope 不包含父/兄弟。C11 可把业务空间修订绑定到同一稳定 scope identity，不复制访问树。

成员具有稳定 membership ID 和不可变修订；修订成员为角色集合、scope 集合、`active/removed`、操作者、业务/系统时间和前一版本引用。identity 表只更新 `currentRevisionId`，旧修订不更新。任何变更使用 `expectedRevisionRef`，并以 current pointer compare-and-swap 收口并发。

### 7. 两级资料权限与继承算法

资料权限身份以 C01 `VersionReferenceSchema` 表示待保护资料版本，不读取正文。每个资料版本只有一个当前访问修订：

- `project-shared`：允许满足工程成员、branch 和空间条件的账号；
- `restricted`：在上述条件上还要求账号位于显式允许集合。新建缺省为 `restricted`，允许集合必须包含登记人。

资料访问请求必须给出资料关联 scope；无 scope 的资料按根 scope 处理。打开整份资料/原件要求成员授权闭包覆盖资料全部关联 scope，防止一份跨区间文档向局部成员泄露其它区段。后续 C11 若提供段级 scope，可对单个资料段逐项授权。

派生工件保存全部来源访问修订引用，其有效读者集合为来源集合的交集：任一来源 `restricted` 则结果保持 restricted，显式账号取交集，scope 要求取并集后由请求方完整覆盖。权限变化不改写派生工件，但 `authorize/verify` 每次解析各来源当前修订，因此收窄即时生效；读取历史“当时授权”只用于审计，不作为当前放行依据。

风险结论、评估、预警和处置按工程/空间业务权限展示；证据定位和脱敏摘要不是正文。`authorize` 对无正文权限的投影请求可返回空 `sourceAccessGrantRefs` 和 redacted 决定；`engineering-data.evidence-access`、原件导出或 Agent 取证必须取得每个来源的精确 grant ref，否则整体拒绝。无权与不存在在校验成员前统一返回授权拒绝。

### 8. 服务端授权签发、验证和因果收窄

`AuthorizationRequestV1` 固定 `invocation`、`invocationId`（commandId/queryId/toolCallId）、`projectId`、精确 `branch`、请求 scope/source refs、可选父上下文与 `requestedAt`。人类分支只接受 opaque session token；系统/Agent 分支必须带父上下文、因果 run，Agent 还必须带 C02 `AgentTaskRefV1`。客户端提交的 capability/context/grant 字段不在 strict Schema 中。

`authorize` 在一个短 PostgreSQL 事务中：

1. 校验 token 或父上下文、账号状态/安全版本；
2. 读取目标工程、当前 membership/space/source 修订与 `access-policy/v1`；
3. 校验 exact branch、空间闭包、资料权限以及父上下文子集；
4. 构造 C02 strict `AuthorizationContextV1`，仅含一个 required capability 和实际使用的 scope/grant refs；
5. 保存不可变 context snapshot 与安全成功事件后返回。

context 以随机 `entityId`、`versionId="1"` 表示，数据库另存绑定 invocationId、branch、父上下文、当前修订摘要和 `expiresAt=decidedAt+5m`。`verify` 在领域副作用/正文读取前按 context ref + invocationId + branch 重新读取当前账号、工程、成员和资料授权；只有完全一致、未过期且未扩大时成功。相同 invocation 可重复验证；context 不能换命令、query、branch 或工程使用。

人类 context 的 `invocation.kind="human"`；系统/Agent 沿用原业务 `actorId`，分别填写 C02 system/agent invocation 与 causal run。系统/Agent 没有独立账号、角色或 session，且每一跳都同时受父上下文和当前有效授权约束。外部连接凭据永不参与能力计算。

### 9. PostgreSQL 表、迁移和权限

C06 使用 C03 已允许的 `platform` 迁移目录和主调度预留全局序号：

```text
packages/adapters/src/postgres/migrations/platform/
  deliver-local-identity-and-project-authorization/
    000003_local_identity_and_authorization.ts
```

不新增 schema。迁移在 `business` 建立：

| 表 | 关键约束 |
| --- | --- |
| `local_accounts` | account PK、规范登录名唯一、状态/security/current credential version |
| `local_credentials` | `(account_id, credential_version)` PK；算法/策略/参数/盐/派生值；只新增 |
| `local_sessions` | session PK、`login_attempt_id` 唯一、token 指纹唯一、credential/security/key 版本、超时/撤销 |
| `local_login_attempts` | attempt PK、HMAC 登录名指纹、可选 account ref、闭合结果/原因/时间；只新增 |
| `access_projects` | project PK、状态/版本、唯一根 scope |
| `access_spatial_scopes` / `access_spatial_scope_revisions` | 稳定 identity + immutable revision/current pointer；同工程父关系 |
| `project_memberships` / `project_membership_revisions` / revision role/scope 子表 | `(project_id,account_id)` 唯一；immutable revision/current pointer；角色/scope FK 去重 |
| `source_access_policies` / `source_access_policy_revisions` / revision account/scope 子表 | `(project_id,source_entity_id,source_version_id)` 唯一；两级 visibility；immutable revision/current pointer |
| `authorization_contexts` | context PK/version、绑定 invocation/branch、C02 context JSON、修订摘要、5m expiry；只新增 |
| `security_audit_events` | event PK、闭合 event/outcome/reason、最小 refs、业务/持久化时间；只新增 |

数据库 CHECK/unique/FK 保证闭合状态、正版本、时间顺序、同工程引用和当前 pointer；复杂树环和“最后一名风险管理员”在 serializable/row-lock 事务中确定性校验。所有时间为 `timestamptz`，token/盐/派生值为 `bytea`，正文不存在。

迁移 owner 为 `riskflow_migrator`。`riskflow_app` 只获得运行所需 SELECT/INSERT 和对 current pointer/session/account 状态列的 UPDATE；没有 DELETE/DDL，也不能 UPDATE/DELETE `local_login_attempts`、`authorization_contexts`、`security_audit_events` 和 immutable revision 表。PUBLIC 无权限。C37 仍负责 LOGIN 主体和秘密。

### 10. 事务、幂等、审计和错误

已认证身份/工程管理命令转换为 C03 `AtomicCommandV1`。账号级命令以保留常量 `riskflow-system` 作为 C03 命令唯一键 namespace；该值不允许作为 `access_projects.project_id`，也不代表工程或业务授权。handler 经不透明 transaction 写 C06 表，返回一条 C03 `AuditAppendV1`、零个事件和精确结果引用。当前 C02 没有 access 事件类型，C06 不伪造事件；C07/C09 直接调用 access interface。

登录、登录失败、session touch/过期、注销和授权决定在授权上下文出现前或不构成领域写命令，使用 auth adapter 自己的短事务，并与 `security_audit_events` 原子提交。安全审计写失败时不创建 session、不返回成功 context、不应用 access 变更；拒绝路径仍默认拒绝并把审计故障映射为技术错误。安全表不能替代 C03/C07 业务审计，C07 后续以只读方式统一投影两者。

闭合错误：

| code | retryable | 对外语义 / C02 映射 |
| --- | --- | --- |
| `AUTHENTICATION_REJECTED` | false | 未知/错误/停用/节流统一登录失败，不给账号细节 |
| `PASSWORD_CHANGE_REQUIRED` | false | 仅允许改密/注销 |
| `SESSION_EXPIRED` / `SESSION_REVOKED` | false | 重新认证 |
| `AUTHORIZATION_DENIED` | false | 映射 C02 同名错误；无存在性信息 |
| `STALE_ACCESS_VERSION` | false | 映射 `STALE_VERSION` |
| `IDEMPOTENCY_CONFLICT` | false | 映射 C02 同名错误 |
| `ACCESS_CONTRACT_INVALID` | false | strict 输入/策略不支持，终止 |
| `ACCESS_TRANSIENT_FAILURE` | true | 映射 `TRANSIENT_FAILURE`，保留诊断引用 |
| `ACCESS_TERMINAL_FAILURE` | false | 映射 `TERMINAL_FAILURE` |

每个错误带 stage、occurredAt、diagnosticRef 和有限 identity refs；不带 SQL、driver message、登录名、token、密码、角色清单、目标正文或存在性。普通日志只能记录同一最小 refs；安全审计是合同证据，Pino/指标/链路不能替代。

### 11. 版本、状态和时间语义

- `password-policy/v1`、`access-policy/v1`、`session-token/v1` 是不可变技术策略引用；调整行为需新版本与 OpenSpec change。
- 账号 `securityVersion` 在停用、重置、改密和 HMAC key 失效时单调递增；session 固定创建时版本。
- membership、scope、source access 使用稳定 identity + immutable revision + current pointer；更新必须提供 expected ref。
- authorization context 是一次请求的不可变快照，保存当时策略与 revision refs，但当前放行仍重新校验现行状态。
- 业务发生时间来自已校验命令，系统决定/持久化时间来自 PostgreSQL；重试不得改写首次结果、版本或审计引用。
- 不删除账号、工程、scope、membership、source grant、context 或安全事件；撤销使用新修订或状态/撤销时间。

### 12. 验证和性能

`packages/core/test/access.test.ts` 使用表驱动测试覆盖：五角色 exact branch 允许/拒绝、系统管理员空业务 branch、scope 父子闭包/跨工程/环、两级资料策略与多来源交集、密码边界、strict 上限、上下文收窄和错误映射。它不逐角色复制全部 branch、不断言完整文案、数组顺序或私有函数调用。

`packages/adapters/test/auth/local-identity-project-authorization.test.ts` 每文件启动一个固定 PostgreSQL 容器，依次执行 C03 bootstrap/生产迁移与 C06 migration，并以不同项目/账号隔离场景。它验证：

1. 首次引导单次性、账号创建/停用/重置、scrypt 参数和数据库无明文；
2. 正确/错误/未知/节流登录、幂等重放、首次改密、token 防伪、空闲/绝对超时、注销和全部强制失效；
3. 工程开通、根 scope、五角色、叠加/跨工程、最后风险管理员、scope 并发与陈旧版本；
4. 共享/指定资料、默认指定、空间覆盖、派生交集、收窄即时生效、结论/定位与正文分离；
5. 人类/系统/Agent context、伪造字段拒绝、branch 精确允许、每跳收窄、旧 context/跨工程拒绝；
6. C03 命令同载荷重放/不同载荷冲突、事实+审计+收据原子回滚、安全审计不可改、无权与不存在同错误类别；
7. 预热后 200 次普通授权 p95 ≤100ms；容器不可用时明确失败，不回退内存或 skip。

测试通过注入 clock 推进超时，不用真实 sleep；固定随机源只在 token 单元向量使用，集成场景使用真实 CSPRNG。性能场景单独命名 `authorization performance`，不把 scrypt 时间混入；实现使用以 current pointer/project/account/source 为前缀的索引，不扫描其它工程或历史。

### 13. 文件所有权与禁止修改区域

新增：

```text
packages/core/src/access/schema.ts
packages/core/src/access/policy.ts
packages/core/src/access/authorization.ts
packages/core/src/access/service.ts
packages/core/src/access/index.ts
packages/core/test/access.test.ts
packages/adapters/src/auth/crypto.ts
packages/adapters/src/auth/postgres-types.ts
packages/adapters/src/auth/postgres-local-identity-access.ts
packages/adapters/src/auth/index.ts
packages/adapters/src/postgres/migrations/platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.ts
packages/adapters/test/auth/fixture.ts
packages/adapters/test/auth/local-identity-project-authorization.test.ts
openspec/changes/deliver-local-identity-and-project-authorization/**
```

由主调度 Agent 串行修改：`packages/core/package.json` 只增加 `./access` export，`packages/adapters/package.json` 只增加 `./auth` export。无新依赖，不修改任何 dependencies/devDependencies，也不更新锁文件或依赖政策。

删除：无。

禁止修改：`packages/contracts/**`；`packages/core/src/persistence/**` 及其测试；`packages/adapters/src/postgres/**` 中除上述新 migration 目录外的全部既有文件；`apps/**`、`demo/**`；根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、tsconfig/ESLint/Prettier/dependency-cruiser/CI、`config/dependency-policy.json`、`openspec/config.yaml`、`openspec/specs/**`、所有归档 change 和其它活动 change。当前工作树已有 `pnpm-workspace.yaml` 改动不属于 C06，任何执行者不得触碰、格式化、暂存或回滚。

### 14. 追踪矩阵

| 来源 | interface / DTO | 持久化 | 验收 |
| --- | --- | --- | --- |
| RI-S14 | project/source access commands、授权 context | membership/source revision、audit | 权限登记、变更、回滚与审计原子性 |
| RI-S42、RI-S61～S65 | evidence access authorization | source grant/context refs | 定位可见、正文隔离、派生不扩大 |
| RA-S1 | project + spatial authorization refs | access project/scope/membership revisions | 三维业务元数据留给 C11，工程/空间边界真实生效 |
| RA-S3～S7 | exact branch authorization | immutable context + policy ref | 规则/评估/预警/处置后续命令只能在获准工程执行 |
| F-PJ-01～03 | account/project administration | account/project/member/scope | 开通、成员叠加、跨工程拒绝、系统管理员无业务特权 |
| F-DA-01、F-AU-01/02 | source visibility and grant | source access revisions | 默认指定、共享/指定、查看/导出正文门禁 |
| F-AG-01/02 | system/agent causal authorization | parent/current context refs | Agent 无独立身份、每跳收窄、只读拒写 |

## Risks / Trade-offs

- [scrypt v1 每次校验约占 128 MiB，登录洪泛可能造成资源压力] → 单进程最多 4 个派生作业，输入先做长度/节流检查；未知账号仍执行 dummy scrypt防枚举。只有目标硬件实测不达安全/延迟门槛时调整新策略版本。
- [服务端授权每次读当前修订并写 context，写放大高于缓存 JWT] → MVP 低频、撤权即时性和审计优先；先用索引和 5 分钟 context 生命周期，只有 C37/C38 基准证明不达门槛才评估短期缓存，缓存仍必须按 security/revision version 失效。
- [系统管理员能显式把自己加入工程] → 这是已确认的角色叠加能力；操作只改变成员授权，不读取业务数据，必须显式、幂等并审计，系统角色本身仍无业务能力。
- [C06 在资料事实出现前保存外部 source version ref，无法用数据库 FK 验证 C11 实体] → 默认无 grant 即拒绝；C11 在资料事实提交后调用 narrow `revise-source-access`，失败时资料保持不可读且不启动处理，不通过宽松默认补偿。
- [固定五分钟 context 可能在长命令准备后过期] → context 只用于一次具体 invocation；调用方在提交前重新 authorize，不延长旧 context。异步 Worker 每一步从父引用重新签发收窄 context。
- [没有离线泄露密码字典] → 以 15 字符最小长度、scrypt、节流和管理员重置覆盖 MVP；甲方提供可审计离线数据集及更新责任后另开 change，不使用在线服务或随意硬编码列表。

## Migration Plan

1. 主调度 Agent 确认直接依赖 C01/C03 已归档、迁移序号 `000003` 未冲突，并只为两个 package 增加 `./access`/`./auth` exports；不改依赖或锁文件。
2. 执行 C06 migration，创建表、索引、约束与最小权限；应用/Worker 启动不隐式迁移或引导账号。
3. 部署者以显式 HMAC key/version 和初始管理员密码调用一次 bootstrap，完成后销毁输入载体；初始管理员首次登录后立即改密。
4. C09 后续只从请求读取 session token，调用 `authorize` 后在服务端组装 C02 命令/查询；C07/C08/C11 等按各自 change 接入，不读取 C06 表。
5. 回滚仅在无业务接入的开发/测试环境执行 migration `down`。生产不自动删除账号、会话、授权 context 或安全审计；修复使用新 migration。若 C06 尚未被下游使用，可整体回退 feature commit 和非生产表；已有历史引用时只能向前迁移。

## Open Questions

无。依赖、密码/会话参数、角色 branch、空间和资料语义、事务、迁移序号、文件所有权及验收命令均已固定；命中 proposal 的重新决策条件时停止实现并交回主调度 Agent，不由执行者临时选型。
