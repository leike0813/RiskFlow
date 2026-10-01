# Verification

## 验收对象

- Change：`deliver-identification-and-review-ui`
- 输入实现 HEAD：`71465787d50e669ad7317fbb0b7e474130ad7b2c`（implementation-plan §1 固定基线）
- 最终验收 HEAD：`71465787d50e669ad7317fbb0b7e474130ad7b2c`
- 验收 Agent：Kimi Code（C33 Finalizer，本收尾会话）

说明：沿用既有裁决，本 change 全程不提交 Git；实现以未提交工作区形式存在（30 个已跟踪文件修改/删除，另含 `packages/adapters/src/identification/read/`、`packages/adapters/src/review-audit/postgres-review-queue-read.ts`、`demo/src/pages/identificationShared.tsx`、`demo/test/browser/identification-review.spec.ts`、三处新测试文件等未跟踪新增），输入与最终 HEAD 为同一基点。验收期未改动任何产品代码（见"验收期修复与裁决"）。

**更新记录（2026-10-01，Finalizer）**：结论原为有界 BLOCKED，阻塞三条正向投影 Scenario；用户裁决开 drift 修正 change `fix-projection-reverification-identity-seam` 修复投影复验身份接缝缺陷。该 change 已交付并通过验收（其 verification 结论 PASS），本 change 三条阻塞 Scenario 已在最终产物上取得正向证据并完成受影响范围回归（typecheck / vitest 234 / playwright 25/25 / openspec 全量与双 strict 校验，命令真实结果见下表末行）。按 Finalizer 规则「最终产物发生实质变化须核验受影响范围并更新 verification」，结论更新为 **PASS**；原 BLOCKED 记录保留于本文件「历史段落」节。

## 结论

**PASS**。本 change 批准范围内的全部实现义务（IP-01～IP-11）、三条 domain/platform delta 与 web spec 的全部 Requirement 均已闭合并有新鲜证据。原三条正向投影 Scenario（「可证明关联正常呈现」「沿链穿透到详情」、运行记录页「两类运行分源聚合」的链运行组）随 drift change `fix-projection-reverification-identity-seam` 闭合取得正向证据：投影三路径（trace-chain/association-graph/risk-overview）在真实 HTTP 接缝全部正向 200，`demo-chromium` 25/25 全绿（含翻正后的关联图正向、证据追溯 1–5 号节点正向 + 6–8 号缺席形态、运行记录链运行组正向）。逐条证据见下表已更新行；阻塞历史见「历史段落」。

## 历史段落：原 BLOCKED（有界）结论（已被 fix-projection-reverification-identity-seam 闭合）

> 以下为 2026-10-01 首次验收时的原始结论记录，仅作历史保留，不再代表当前结论。
>
> **BLOCKED（有界）**。本 change 批准范围内的全部实现义务（IP-01～IP-11）、三条 domain/platform delta 与 web spec 的其余 Requirement 均已闭合并有新鲜证据；但 web spec 三条**正向投影 Scenario**（「可证明关联正常呈现」「沿链穿透到详情」、运行记录页「两类运行分源聚合」的链运行组）无法在真实 HTTP 接缝上取得正向证据，阻塞点是一个**上游已归档语义缺陷**，修复超出本 change 批准范围：

> - **缺陷**：`apps/api/src/app.ts:330-333` 按 C32 已归档规则以客户端 `queryId` 原值签发 HTTP 授权的 `invocationId`；而 `packages/adapters/src/workflow/postgres-workflow-projection.ts:320/510`（C30/C31 已归档）在 `query()`/`readPage()` 复验时使用派生身份 `c30-query:<projectId>:<queryId>` / `c30-read-page:<projectId>:<queryResultId>`。C06 verify 绑定校验（`packages/adapters/src/auth/postgres-local-identity-access.ts:2922`，`invocation_id` 不一致即 `AUTHORIZATION_DENIED`）使二者恒不匹配，投影端口在**任何数据可见性判断之前**失败闭合为 `NOT_FOUND`（HTTP 404）。
> - **裁决**：这是 (b) 系统性接缝缺陷，不是夹具预期空态。证据：① 无任何进程内生产调用方使用 `c30-query:`/`c30-read-page:` 身份（仅适配器单测 stub verify），C32 归档 verification 只断言过 viewer 投影降权（失败闭合），从未在真实接缝断言过投影成功读；② 最小复现 `.scratch/c33-finalizer-projection-repro.mjs`（一次性脚本，非交付物）在真实 harness（testcontainers PostgreSQL + 生产迁移 + 真实登录 + 已播种可证明链边 `recordAuto → 评估 → 预警 → …`）上对 operator 会话发 `projection.query` trace-chain，稳定返回 `404 NOT_FOUND`，references 含 `c30-projection-unavailable`（2026-10-01 复跑结果同上）。
> - **为何不在本 change 修复**：修复须改动 C30/C31 派生复验身份或 C09/C32 HTTP 签发规则——两者均为已归档语义，且属本 plan §7 保护清单（既有端口形状、授权与同形失败语义）；HTTP 侧改法还需按 branch 感知 payload 派生身份，属设计级决策。建议另开 drift 修正 change（方向候选：统一投影端口复验身份为签发时纯 `queryId`/登记身份，或 C09 按 branch 派生签发身份），闭合后对本三条 Scenario 补验。
> - **边界**：阻塞仅限上述三条 Scenario 的正向证据。浏览器验收对这三处当前按失败闭合断言（投影越界/不可用 → 结构化失败、不编造边与链），该行为本身符合 spec 的「不可证明时失败闭合」分支并全部通过；本 change 交付的只读页面、复核决定接线、授权授予与同形失败语义均已验证可用。

**闭合说明**：上述缺陷已由 drift change `fix-projection-reverification-identity-seam` 按候选方向一修复（投影端口复验身份改为当前调用的领域 `queryId`，配套契约加法字段与 HTTP 透传；同法修复 C22 窄读的无配对派生身份）；其 design D6/D7 两项用户裁决（readBody 进程内重签发、trace-chain 相邻边语义维持）界定了补验范围。复现脚本同环境复跑返回 200 succeeded，三条 Scenario 正向证据见下表已更新行。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| domain「识别运行与风险记录只读必须有界且复验当前授权」3 Scenario | `packages/adapters/src/identification/read/postgres-risk-identification-read.ts`（run-list/run-read 精确版本重放、record-catalog/record-read、有界分页、越权/跨工程同形失败）+ `packages/adapters/test/identification/postgres-risk-identification-read.test.ts` | 通过（`pnpm vitest run packages/adapters/test/identification packages/adapters/test/review-audit`：8 文件 87 passed） |
| domain「复核队列只读必须携带可决定的精确任务引用」3 Scenario | `packages/adapters/src/review-audit/postgres-review-queue-read.ts`（条目携完整任务引用、stale 拥有方计算、过期标记、筛选/游标、同形失败）+ `postgres-review-queue-read.test.ts` | 通过（同上一套件 87 passed） |
| platform「只读查询分支必须登记在闭合路由清单」2 Scenario | `apps/api/src/http.ts` 仅加 5 条 queryRoutes 条目；目录-能力-OpenAPI 同源派生；未注入端口 branch 不激活；`apps/api/test/http-shell.test.ts` | 通过（`pnpm vitest run apps/api packages/contracts packages/core/test/access.test.ts`：8 文件 117 passed，含 http-shell 25） |
| platform「只读分支必须复用既有传输信封与失败形态」2 Scenario | 越权字段 400、无权/不存在同形 404 由既有信封承载；contracts 触发原因 optional 不伪造 | 通过（同上 117 passed） |
| IP-01 契约加法（5 branch→capability 映射、端口契约） | `packages/contracts/src/ports/index.ts` + `packages/contracts/test/c33-identification-review-read.test.ts`（15 tests：strict 拒契约外字段、判别联合闭合） | 通过 |
| IP-02 角色授予（D5 精确清单） | `packages/core/src/access/policy.ts`：reviewer +5 / field-responder +4 / business-viewer +6；`packages/core/test/access.test.ts`（6 tests） | 通过 |
| IP-03/04 适配器 | 见上两行 domain 证据 | 通过 |
| IP-05 HTTP 接线 | 见上 platform 两行 | 通过 |
| IP-06 demo api 层 | `demo/src/api/client.ts`（+postCommand）、`operations.ts`（5 查询 + decide 命令 + 关联图两段读，白名单解码） | 通过（demo build 与浏览器验收覆盖） |
| web「页面只经既有 HTTP 面取得业务事实」+「假写入口不存在」 | demo 8 页全部经 api 层；"启动识别""审计重放"假写入口已移除；`demo/src/content/review.ts` 删除 | 通过（playwright 25/25） |
| web「四类骨架逐页一致」 | 8 页全部 `PageStateView` 四态；用例「四态骨架：loading 与 error（重试恢复）在真实接缝下可观察」「responder 无复核队列读取权限…」 | 通过 |
| web「识别运行列表与详情」3 Scenario | 用例「识别运行列表呈现真实运行事实…」「完成态运行详情呈现阶段、覆盖、合并组与结果汇总…」「等待与失败运行详情如实呈现暂停与可重试失败」（Agent 失败无跳过入口） | 通过 |
| web「风险记录列表与详情」2 Scenario | 用例「风险记录列表支持工序节点与验收方式筛选…」「风险记录详情呈现契约字段与信封…」；RiskDetailPage 无 P/C/风险等级等评估域内容 | 通过 |
| web「关联图页」Scenario「可证明关联正常呈现」 | **（2026-10-01 补验，正向）** 翻正后用例「关联图无主体时呈现引导与按工序分组降级视图；带主体时呈现可证明关联边」：带主体时呈现主体提示与真实链边节点（`risk-assessment-record:…:1`、`calibration-suggestion:…:1`）；探针 `.scratch/c33-finalizer-graph-probe.mjs`：association-graph query 200 + readPage 200 返回 5 条真实 trace-link | 通过（原 BLOCKED，已由 fix-projection-reverification-identity-seam 闭合） |
| web「关联图页」Scenario「不可证明时失败闭合」 | 关联图用例前半段（无主体引导 + 按工序分组降级视图基于目录真实读取）+ viewer 投影降权（`read-only.spec.ts:164-169` 双态容忍：暂无关联对象/无权限提示）+ 适配器层「rejects an unprovable graph subject and forged cursors on the new branches」 | 通过 |
| web「证据追溯页」Scenario「沿链穿透到详情」 | **（2026-10-01 补验，正向）** 翻正后用例「证据追溯页：无主体引导；带主体时呈现端到端固定追溯链」：1–5 号节点（资料段→工序→机理→记录→评估记录）呈现真实引用（`chapter_1-segment_1`、`PN-EXPAND-02`、`MEC-VDS-017`、`risk-assessment-record:…:1`），6–8 号节点按 drift design D7 裁决以缺席形态如实呈现（trace-chain 归档语义只返回主体相邻边）；探针 `.scratch/c33-finalizer-projection-repro.mjs`：trace-chain query 200 succeeded | 通过（原 BLOCKED，已由 fix-projection-reverification-identity-seam 闭合） |
| web「证据追溯页」Scenario「无权限节点只显定位摘要」 | 追溯页用例前半段（无主体引导）+ 6–8 号节点缺席形态如实呈现（「投影暂无该环节事实」×3，D7 裁决范围）+ viewer 投影降权断言（read-only 用例 25） | 通过 |
| web「复核队列」3 Scenario | 用例「复核队列呈现真实任务、过期禁决定与筛选空态」「复核决定：通过、拒绝、批量通过与重复提交幂等」「viewer 可读复核队列但决定失败闭合」（陈旧版本决定被拒由 D8 幂等键与服务端闭合覆盖） | 通过 |
| web「运行记录页」Scenario「两类运行分源聚合」 | **（2026-10-01 补验，正向）** 翻正后用例「运行记录页：识别运行组与评估处置链运行组均呈现真实运行」：识别运行组呈现真实运行（completed/waiting），链运行组呈现所播种链运行的 run-summary 行（已完成态）；探针 `.scratch/c33-finalizer-risk-overview-probe.mjs`：risk-overview query 200 + readPage 200 返回 run-summary + 8 条 report-fact | 通过（原部分 BLOCKED，已由 fix-projection-reverification-identity-seam 闭合） |
| web「运行记录页」Scenario「单一来源失败不冒充完整」 | 适配器层同形失败与越界闭合（投影适配器 14/14：伪造游标 `cursor-invalid`、不可证明主体失败闭合、越界显式失败）+ viewer 投影降权（read-only.spec.ts:164-169）+ 四态骨架 error/重试用例覆盖分组级失败形态 | 通过 |
| web「证据抽屉脱敏两态」 | 用例「风险记录详情…证据抽屉呈现真实定位与受限脱敏两态」；EvidenceDrawer 走真实 evidence-access 路径（sourceVersionRef 缺省才走 C34/C35 遗留静态路径） | 通过 |
| web「跨页深链使用领域标识」 | 路由参数化 `/identification/runs/:runId`、`/identification/records/:recordId`（原 `/risks/RISK-2026-001` 静态路由已删）；运行详情 → 记录深链、记录列表行点击直达 | 通过 |
| web「浏览器验收」Scenario「真实浏览器完成识别与复核链路」 | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`：25/25 passed（1.7m；identification-review 14 + read-only 回归 11），真实 Chromium + 正式 HTTP 接缝 + testcontainers PG + 生产迁移；**（2026-10-01 复跑）投影两页与运行记录链运行组已翻正为正向断言并全部通过** | 通过 |
| web「浏览器验收」Scenario「环境不可用明确失败」 | 手动故障注入一次：临时移走 `demo/dist` 后运行单条 spec → 退出码 1，明确报 `demo production build is missing: …/demo/dist`（server.mjs:150），error-context 与 trace 证据保留于 `test-results/demo-browser/`；事后 dist 已还原，日志存 `.scratch/c33-fault-injection.log` | 通过 |
| IP-10 harness 夹具 | `demo/test/browser/server.mjs` 扩展：识别/复核夹具（含过期任务、待决定任务、投影链边播种 `registerProjectionLink`）与新端口注入 | 通过 |
| IP-11 静态内容清理 | `demo/src/content/`：本 change 已替换的静态业务数据已删（含 review.ts 整文件）；残留导出逐一核对均归 C34/C35 域；8 页无 content/ 业务数据导入 | 通过 |
| 全部：类型/lint/格式/构建/规格 | `pnpm typecheck`=0、`pnpm lint`=0、`pnpm format:check`=0、`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`=0、`pnpm --dir demo build`=0、`pnpm openspec:validate`=0、`openspec validate deliver-identification-and-review-ui --strict --no-interactive` → "Change 'deliver-identification-and-review-ui' is valid"（2026-10-01 全部复跑） | 通过 |
| 受影响范围回归（2026-10-01，drift 闭合后复跑） | `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck`=0；`pnpm vitest run packages/contracts packages/core/test/access.test.ts packages/adapters/test/identification packages/adapters/test/review-audit packages/adapters/test/workflow apps/api` → 18 文件 234 passed；`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium` → 25 passed（1.7m）；`pnpm openspec:validate` → 38 passed, 0 failed；`openspec validate deliver-identification-and-review-ui --strict --no-interactive` → valid | 通过 |
| readPage 回读绑定与每页重验授权 | 代码核验：`readPage` 有界分页回读并每页重验授权；**（2026-10-01 更新）** 复验身份已由 drift change 修为本次读取调用的领域 `queryId`（契约加法字段 + HTTP 透传），正向路径经探针与浏览器用例覆盖，越权/撤销/游标篡改仍同形失败（投影适配器测试 14/14） | 通过 |

### 验收期修复与裁决

- **验收期产品代码修复：无。** 验收阶段未改动任何产品/测试代码；唯一新建物为一次性最小复现脚本 `.scratch/c33-finalizer-projection-repro.mjs`（非交付物，供后续 drift change 复用）。
- **实现自报偏差的裁决**：`vitest.config.ts` 在计划外将 `demo/test/browser/**` 加入 vitest exclude（修复 C32 起浏览器 spec 被 vitest 误收编）。属机械收口且注释准确，判为 plan §8 授权内的夹具级修复，予以接受；未涉及公共契约/权限/迁移。
- **实现自报数字的两处出入（不影响结论）**：playwright 自报 24/24，实测 25/25（14 条本 change + 11 条 C32 read-only 回归）；C33 契约测试文件自报 382 行，实测 384 行。

## 限定审计

**经主调度裁决豁免**（2026-10-01，用户决策）。本 change 的 implementation-plan §8 标注 auditRequired（触及权限：D2/D5 新 branch 授予与同形失败；写命令接线：D8 decide-review 幂等/陈旧闭合）。Finalizer 已对三点做代码级核验且均通过（见证据表），并有行为级覆盖：角色授予精确性（`packages/core/test/access.test.ts`）、越权/不存在同形 404（`apps/api/test/http-shell.test.ts`）、浏览器权限降级与 decide-review 逐字节幂等重放、stale 禁决定（`demo/test/browser/identification-review.spec.ts`）。主调度据此判定不再派 Targeted Auditor；本收尾轮次审计以 Finalizer 自查与上述证据闭合。

## 后续注意事项

- **首要后续（已完成）**：投影复验身份接缝 drift 修正 change 已开为 `fix-projection-reverification-identity-seam`，按候选方向一修复（投影端口复验身份统一为当前调用的领域 `queryId`，未改 C09/C32 签发规则），2026-10-01 验收 PASS；本 change 三条正向投影 Scenario 已补验通过（证据见上表已更新行）。C32 归档界面排查结论：其 viewer 追溯用例为双态容忍正则，修复后走「暂无关联对象」分支，read-only 回归 11 条全绿，无需改写。
- **harness 次要缺口（已闭合）**：`demo/test/browser/server.mjs` 构造 `createPostgresWorkflowProjection` 时已注入真实 `riskRecordTrace: createPostgresRiskRecordTraceReader({ db, authorization })` 并补齐授权摘要匹配的播种（属 drift change IP-06 范围）。
- **深链边界**：IdentificationRunPage 深链经运行列表首页解析 runRef，超出首页（50 条）的运行深链会 NOT_FOUND；MVP 可接受，留作后续 follow-up。
- **角色感知呈现边界**：demo 客户端无角色/能力信息，D8「决定按钮仅对有决定能力角色呈现」在客户端不可实现；当前依赖服务端失败闭合（viewer 决定 → NOT_FOUND），已被浏览器断言覆盖。
- **演示数据**：识别/复核夹具事实为合成样本，待甲方复核。
- 本 change 全部改动尚未提交 Git（沿用既有裁决）；归档与提交动作待用户另行指示。
