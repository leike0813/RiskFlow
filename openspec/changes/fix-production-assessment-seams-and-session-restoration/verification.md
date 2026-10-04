# 验收：fix-production-assessment-seams-and-session-restoration

验收对象为本 change 的全部 15 个任务（1.1–4.3），实现检查点为分支
`fix/production-assessment-seams-and-session-restoration` 的 HEAD。所有结论只依据
本文件列出的实际命令与真实浏览器/真实 PostgreSQL 证据，不以「已实现」代替「已运行」。

模型工件、清洗样本、规则与措施全部为**合成样本、待甲方复核**。本验收只证明系统按声明
契约运行，**不构成甲方精度验收结论**。

## 1. 限定审计三项标签

| 标签 | 关注面 | 结论 | 依据 |
| --- | --- | --- | --- |
| AUTH-SCOPE | 风险 reader 与模型/投影的精确授权、无存在泄漏 | PASS | E-R 的事实授权范围场景；E-P 的「接缝拒绝不能被执行器绕过」撤投影/来源权限用例；C25 以已复验 preparation binding 签发并校验资源子集 |
| FORECAST-FACT-ISOLATION | 真实措施、冻结模型、纯评分、无实际事实 | PASS | E-P 的「计算不产生正式实际事实」重复投影计数用例（assessment/value/preparation/warning/receipt/outbox 均不增）与三算法 `forecast.test` |
| SESSION-RESTORATION | 停用 401、技术故障与匿名分离、绝对期限、Cookie、认证代次 | PASS | E-S 的会话自省用例（无 token 元数据、idle 推进、首次改密受限、撤销/停用/期限）；E-H 的 Cookie GET 路由；两套 browser specs 的 reload/503 重试/迟到认证/注销失败场景 |

本轮**未触发**额外限定审计：三项标签在既有 E-R/E-P/E-S/E-H 与 browser 证据中已闭合，
范围内缺陷已在原 Task 内修复并回归。

## 2. 施工图 §6 场景核对

### 风险事实读取与正式评估（IP-01～IP-04，E-R）

- 两个所属 reader（标准记录 XOR、外部结构化事件 XOR）共用同一读取契约；错配返回同形
  `AUTHORIZATION_DENIED`，不泄漏存在性。
- 来源发布变化不���写已登记事件的旧工件与旧证据。
- 入口来源授权可用于准备冻结；空范围、撤权、映射缺失／歧义、返回额外来源或空间一律拒绝，
  不产出部分 facts 或准备成功事实。
- 正式记录形成准备与评估输入，缺范围/验收/证据/错 payload 时阻断。
- 只读投影可重复重放：重复读 facts 相同，记录/验收/收据/事件不增。
- 真实准备支持规则集组装：C11 冻结 → C19 组装/审核发布 → C19 resolve → C25 消费真实
  `basisRef`，引用与持久成员一致。

### 预测（IP-05～IP-07，E-P）

- 预测指标进入同一冻结评分依据，原规则/权重/矩阵重算，风险状态随预测值跨带变化且可精确重放。
- 依据或指标不相容（错工程/ref/单位/序列、缺成员）返回类型化失败，无部分风险状态。
- 预测是纯只读投影：不写评估记录、值集合、准备、预警、收据与 Outbox。
- 三类算法分别有证据：历史统计系数、监测趋势（原对齐槽下标外推，缺槽不插值、不取 latest）、
  机理项有界计算（规范十进制，越 domain 失败）。
- 模型/样本不足时按稳定原因码不可用，不回退方法；越权或模型结果非法直接失败。
- 发布新模型后旧预测仍按旧冻结引用逐字符复算；正式预测保存继续原事务原子且幂等。

### 会话自省（IP-08～IP-09，E-S / E-H）

- C06 提供无 token 的当前会话元数据：与登录共用同一份字段计算；idle 触达推进但绝对期限不变。
- 首次改密账号自省得 `passwordChangeRequired=true`，业务授权仍拒绝。
- 停用/撤销/密码变更/密钥版本/期限到期统一 `SESSION_REVOKED`/`EXPIRED`，不降级为
  「无权访问 404」。
- `GET /api/v1/session`：`no-store`、不返回 token、不下发 `Set-Cookie`、缺 Cookie 401、
  畸形或重复 Cookie 400；OpenAPI 含 `riskflow_introspect` 与 `security: [{sessionCookie: []}]`。

### Web 启动恢复（IP-10～IP-12，两套 browser specs）

两套 harness 各只新增一个**真实受限账号**（建立后从不在服务端改密，因此每次登录都由 C06
发放 `mustChangePassword=true` 的会话）。故障只注入一次 503 或一次真实响应延迟，所有成功
路径都落到真实服务端；无 Mock 浏览器、Mock 后端或开发服务器。

- 硬刷新与直接深链：恢复期间停在检查态、保留原 pathname/search/hash、**不发出任何业务查询**。
- 匿名回跳：401 后落到带 `next` 的登录页，登录完成回到精确深链（工程 id 与 revision 不变）。
- 受限改密：真实初始密码账号被送入改密页，改密前无业务请求、无外壳导航；改密成功回到原深链。
- 恢复 503：呈现**可重试失败**而不是匿名，URL 不丢；重试走真实自省后回到业务页。
- 迟到认证：后发起的认证代次先建立会话后，先前那次即便返回失败也不改变当前会话。
- demo 注销失败：一次 503 保留现有会话并给出「重试登出」，真实注销成功后才进入匿名。

## 3. 实际运行证据

| 证据 | 命令 | 结果 |
| --- | --- | --- |
| E-R | `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/engineering-data/context-source.test.ts packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts` | 7 文件 / 176 条通过（225.7s） |
| E-P | `pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/core/test/response-lifecycle/forecast.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/response-lifecycle/forecast-executors.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts` | 6 文件 / 159 条通过（320.8s） |
| E-S | `pnpm exec vitest run packages/core/test/access.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/worker/test/engineering-data/cleaning/composition.test.ts` | 含于下一行合并运行 |
| E-H | `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/web/test/api-client-openapi.test.ts apps/web/test/ssr-shells.test.tsx` | E-S 与 E-H 合并运行：6 文件 / 73 条通过（62.6s） |
| E-W 构建 | `pnpm build`；`pnpm --dir demo build` | 通过 |
| E-W apps/web 浏览器 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/quality.spec.ts` | 6/6 通过（42.3s） |
| E-W demo 浏览器 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/read-only.spec.ts` | 16/16 通过（57.1s） |
| 静态 | `pnpm typecheck`；`pnpm lint`；`pnpm format:check`；`pnpm deps:check`；`pnpm deps:policy` | 全部通过 |
| 规格 | `openspec validate fix-production-assessment-seams-and-session-restoration --strict --no-interactive` | `Change 'fix-production-assessment-seams-and-session-restoration' is valid` |

## 4. 施工图 §7 文件合规与已披露偏离

实际改动落在 §7 allowlist 之内，另有 6 个表外文件需要显式披露：

| 表外文件 | 归属 IP | 原因 |
| --- | --- | --- |
| `packages/adapters/src/postgres/pool.ts` | IP-12 | `createPostgresPool` 没有 `'error'` 监听，空闲连接被服务端断开会以 `uncaughtException` 终止整个进程。真实浏览器证据必须 teardown 容器才能收尾，这一缺陷让收尾噪声压垮测试 worker。池自身会在下次取连接时重建，吸收事件即可。 |
| `packages/adapters/src/response-lifecycle/forecast-model-reader.ts` | IP-07 | 部署执行器所需的受权模型工件读取接缝。§7 已授权 `forecast-executors.ts` 内部实现模型读取，此处只是把它独立成文件以避免工厂文件同时承担工件 IO。 |
| `packages/adapters/test/risk-assessment/production-assessment-basis.test.ts` | IP-04/07 | §7 已授权 `production-assessment-basis.fixture.ts`（真实 C15 收口与 C19 解析），其断言用例需要一个文件承载。 |
| `apps/api/test/quality.test.ts` | IP-08 | `LocalIdentityAccessV1` 在 IP-08 增加必需的 `readSession` 后，该测试的接口 stub 同样必须补全；与 §7 已授权的 `apps/worker/.../composition.test.ts` 属同一义务。 |
| `demo/test/browser/assessment-warning-response.spec.ts`、`demo/test/browser/identification-review.spec.ts` | IP-10 回归修复 | IP-10 让启动先自省后，这两份 spec 的 `login()` 无条件等待登录页，同一上下文内第二次打开深链会永久挂起。改为等待登录表单落定后按需登录。 |
| `packages/core/src/response-lifecycle/service.ts` | IP-07 | §7 要求 `verifyForecastExecutorResult` 保持原签名；签名未变，仅把实现收窄为按 `availability` 分支校验。 |

无删除项，无迁移、无新依赖、`openspec/config.yaml` 未被改写，保护路径未被触碰。

## 5. 验收过程中修复的缺陷

以下四处由真实浏览器证据暴露，均为已批准范围内的普通实现缺陷，已在原 Task 内修复并回归：

1. `apps/web` 入口把 `pathname` 钉死下发给 `App`，外壳自带的 popstate 与会话跳转永不生效，
   原深链无法在登录或改密完成后被送回。改为不再下发 pathname。
2. `apps/web` 登录表单把 `loginAttemptId` 写死为 `"web-login"`。会话恢复让「再登录一次」成为
   常规路径，固定标识让第二次登录被判定为同一笔幂等重放而冲突。改为按次生成。
3. demo `ChangePasswordRoute` 在恢复期和改密成功后都直接跳 `/`，丢掉 `next`；受限账号会在
   刷新改密页或改密成功后被甩到首页。改为与 `LoginRoute` 一致地呈现恢复门并回到原目标。
4. `apps/web` browser harness 的风险记录写行缺空间范围、来源版本与证据引用，依赖已过期的写行
   契约，导致 harness 在装载阶段即失败。补齐后该套件才能真实启动。

## 6. 未闭合与后续

- **4.1d 不在本次接管范围**：C34 change 的依赖／基线更新与 17 页验收由原 change 继续推进。
- **合成样本**：模型系数、清洗结果、规则与措施均为合成数据、待甲方复核；甲方提供的脱敏工程
  资料到位后需重跑识别准确性验证。
- **表外文件偏离**：第 4 节的 6 项已在本文件登记。按施工图升级条件，实际范围变更应先更新
  design 与施工图再继续；本 change 归档前需由原 Planning 决定是否把 `pool.ts` 的连接池
  健壮性修复与模型读取文件拆分回填进 §7。

## 7. 任务与工件状态

`openspec status --change fix-production-assessment-seams-and-session-restoration --json`
与 `openspec validate --strict` 均在 4.2 中实际运行并通过。任务勾选反映实际完成的行为与
已运行的验证；本 `verification.md` 由 Finalizer 在 4.3 创建，未提前于实现阶段出现。
