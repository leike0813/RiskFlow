# Verification：deliver-agent-audit-and-operations-ui

## 结论

**PASS**。

- 输入基线：`cfb87bf`（main，含编排控制器 `--retry-request` 兼容性修复 `cfb87bf`，与施工图 base `08a3fed` 的差异仅限编排脚本）。
- 最终 HEAD：`105445d`（feat(web) C35 交付提交）。
- 验收执行：主协调会话直接承担 Finalizer 职责。用户在本轮明确指示不走 Orca/OMP 编排委派框架，施工图 §8 的独立 Finalizer/Targeted Auditor 派发未执行；限定审计范围（权限、事务、尾事务）由本验收直接核验，证据如下。
- 边界：备份/恢复执行、PDF/时间窗导出、自由聊天等 Non-Goals 未实现且按设计呈现 unavailable/404；浏览器验收使用的策略、账号、任务定义为版本化合成输入，已标明待甲方复核。

## 逐 Requirement 证据

| Requirement | 证据 |
|---|---|
| W 页面复用 v2 并保持既有接线 | B1「三条业务窄读」「确认对话框焦点」等 12 场景全绿；B2 旧页回归 66 通过 |
| W Agent 三视图共享任务与有界刷新 | B1「慢读单在途」（8 秒慢读、峰值在途=1、切工程中止并停节拍）；T2 agent adapter 26 项 |
| W Agent 操作真实类型化入口与提案确认 | T1/T2 launch-context、提案确认/拒绝/陈旧用例；B1 任务详情精确引用 |
| W 统一复核五类决定原语义 | T1/T3 复核详情与候选引用用例；B1「识别分组复核」决定落库回显 |
| W 运行审计与证据分源分页 | T3 活动多源有界归并；B1 审计/运行页 |
| W 报告可审计完整有界工件 | T5 报告导出 9 项（重放同源、并发、撤权、上限、尾事务失败）；B1 真实 JSON 下载与 URL 释放 |
| W 最小系统管理使用当前服务端身份 | T4 管理 façade 目录/拒绝/改密；B1「六项系统管理动作」逐项真实执行并回读目录 |
| W 真实接缝与可访问性 | B1 全量（真实 PostgreSQL、正式登录、键盘焦点、慢读、缺环境非零） |
| A Agent 只读投影有界冻结契约 | T1 core + T2 adapter 边界/游标/跨工程用例 |
| A 交互提案摘要不扩工具权 | T1/T2 launch-context supported=false、提案版本校验 |
| R 复核详情与活动读取有界 | T1/T3 全部通过 |
| I 系统管理独立授权 | T4 非管理员目录/写入拒绝、旧授权不通过；B1「非系统管理员同形收口」404 |
| I 管理目录与六项写入版本/敏感边界 | T4 14 处 execute 用例（含 STALE_ACCESS_VERSION 强制）；B1 版本引用逐项携带 |
| H 业务窄读唯一闭合目录 | T6 40 项（注入同源、未注入不激活、strict 拒绝） |
| H 管理与健康路由授权分离 | T6 + B1 运维面（健康真实探针/缺席原因码、模型版本只列登记引用） |
| M 只读端口复用 Schema 事实源 | T1 contracts 31 项 SSOT 编译与 strict 拒绝 |
| M 报告导出沿 C31/C04 可重放 | T5 postgres-report-export 全 9 项 |

## 实际运行的命令与结果

- `pnpm typecheck`：通过（`tsc -b` 无错误）。
- T1 `vitest run packages/core/... packages/contracts/...`：5 文件 76 通过。
- T2～T6 `vitest run packages/adapters/... apps/api/test/http-shell.test.ts`：9 文件 137 通过（真实 testcontainers PostgreSQL）。app.ts 调整后 T6 单独复跑：40 通过。
- `pnpm build && pnpm --dir demo build`：通过。
- B1 `playwright test --project=demo-chromium demo/test/browser/agent-audit-operations.spec.ts`：12/12 通过（1.8m），无跳过、无过滤。
- B2 `playwright test --project=demo-chromium read-only / identification-review / assessment-warning-response`：66 通过 + 1 flaky。
- S1 `pnpm lint`：通过；`pnpm deps:check`：490 模块无违规。
- P1 `openspec validate deliver-agent-audit-and-operations-ui --strict --no-interactive`：valid。

## 验收期间修复（均已回归）

1. `apps/api/src/app.ts`：管理查询/命令端口的 `failed` 信封原本一律以 HTTP 200 返回；改为沿 `mapHttpError` 映射（无权 → 404 NOT_FOUND 同形），对齐 D-10/D-12 与 specs「越权在查询任何状态前拒绝」。B1 非管理员场景因此从 200 修正为 404 通过。
2. `demo/src/api/agentAuditOperations.ts` + `demo/src/pages/ops/AccessPage.tsx`：disable-account/reset-password/suspend-project/revise-membership 原先硬编码 `expectedVersion:'none'`，对既有实体必然 STALE_ACCESS_VERSION；改为由确认意图携带目录项当前版本引用（accountRef/accessRevisionRef/membershipRef）。
3. `demo/src/App.tsx`：AgentTaskProvider 原先拿 URL 原始 projectId，工程上下文不存在时仍轮询；改为仅在 EngineeringGate `ready` 后供数，切到无上下文工程时在途中止且不再发起读取（D-05）。
4. 验收 spec 修正（对齐已批准契约，不改产品语义）：identity 对普通会话按 D-10 断言 200+`isSystemAdministrator:false`；三处 `getByText` 严格模式冲突改精确/分区定位；备份零副作用监听排除测试自身探针；报告正文字段名按 D-08 用 `queryResultRef`；对象 URL 释放断言改为 SPA 切换后观测（整页跳转会重建 JS realm）；六项管理动作改用目录版本引用，且修订成员改为加法式角色修订（移除唯一风险负责人违反 C06 领域不变量，ACCESS_TERMINAL_FAILURE 为正确行为）。

## 限定审计核验（权限 / 事务 / 尾事务）

- Cookie 当前管理证明：T4 与 B1 验证 token 只来自 Cookie、普通会话 identity=false、目录/写入先拒绝后查目标；密码不出现在目录、回执与日志（T4 断言目录无派生口令，B1 断言响应体不含口令明文）。
- 版本与幂等：T4 强制 STALE_ACCESS_VERSION；B1 验证同 commandId 重放不重复产生事实。
- 报告尾事务：T5 验证绑定不冒充 generated、尾失败不发布成功、C04 失败无孤儿引用、撤权后读取关闭。D-09 尾事务身份按本 change design 修订后的（派生 commandId + 同 idempotencyKey）方案核验，重放解析为同一逻辑报告。
- 结论：上述范围无遗留发现。

## 漂移修正记录（本 change 工件内）

- design D-09：`command_id` 全局唯一使"尾事务复用绑定 commandId"不可行，修订为派生 commandId + (commandKind, idempotencyKey) 关联。
- implementation-plan §7 与 tasks 1.3/T3：source-catalog 实际归属 `engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts`（原计划误写 context-source registry）。
- implementation-plan §1 增补续接基线说明；§7 白名单补 `access/schema.ts`（仅导出既有六命令 Schema）与 `agent-runtime/state.ts`（仅新增公共→内部状态映射）。

## 后续注意（不影响 PASS）

- B2 的 `assessment-warning-response.spec.ts`「独立行动…」用例首次运行因 datetime-local 填充值含秒报 malformed，重试通过；该文件与页面（ExecutionRegisterPage）不属于 C35 改动范围，属既有间歇问题，建议后续单独处理。
- `demo/test/browser/server.mjs` 存在 5 个基线遗留的 eslint 错误（demo/** 被仓库 lint 忽略；基线版本为 6 个，本轮未新增并顺带消除 1 个）。demo 门禁为 `tsc + vite build`，均绿。
- 浏览器验收的策略、账号、合成任务定义均为版本化合成输入，待甲方复核；备份/恢复执行归 C37，本轮按设计整项 unavailable 且零恢复请求（B1 已验证）。
- 会话侧残留：编排台账中 C35 有一个失败的规划尝试信封与 `c35`、`c35-2` 两个受管 worktree（均为本轮接管过程中的空残留，无产出）；如恢复使用编排框架，需先清理这些残留。
