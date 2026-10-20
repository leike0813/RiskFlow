# Verification

## 验收对象

- Change：`deliver-risk-overview-dashboard`（用户请求中的 `dashoboard` 为拼写差异，以 CLI 返回的实际目录为准）。
- 输入实现 HEAD：`e3230c9c4950bf87b64b239e39b475913b13859c`，开始验收时工作区 clean。
- 最终验收 HEAD：同上；本次生产修复、回归和验收工件均为未提交改动，没有形成新的 Git 检查点。本结论针对本次已运行的最终工作区，不表示原提交单独通过。
- 验收 Agent：主会话承担 Finalizer；`DashboardBackendAudit` 新会话完成本轮唯一限定审计及范围内修复，`DashboardUiReview` 只读核对前端。最终执行与验收由主会话完成，没有重复派发审计。
- 方法：完整读取 apply contextFiles、相关主规格、生产调用链及已有测试；使用正式 Web dist、真实 PostgreSQL／正式迁移、C06 Cookie 会话与公开 HTTP，不启动开发服务器。
- 数据资格：**合成样本，待甲方复核**。验收夹具显式使用合成时钟；不是现场监测数据或模型准确率结论。

## 结论

**PASS（本 change 范围内）**。22 项任务完成，11 项 Requirement／27 个 Scenario 均有下列实现或运行证据；完整性、正确性、一致性无未闭合阻断项。无待执行限定审计，关键路径没有 skip。

最终四套浏览器回归显式使用 `--retries=0`：**97 passed**。契约、策略、HTTP、所属事实与历史投影回归合并执行：**24 files / 457 tests passed**。原生缩放六组合全部完成，均实际用键盘触发变化续页并观察返回的真实下一页。

## 核验与修复证据

### Requirement / Scenario / IP-ID 映射

| Requirement / Scenario | IP-ID | 实现及已运行证据 | 结果 |
|---|---|---|---|
| OV-R1：OV-S01、OV-S02 | IP-03/04/06 | `core/src/risk-dashboard/service.ts` 独立来源错误；`assessment-warning-response.spec.ts` 三来源故障、真实旧响应延迟后切工程；原注销与会话恢复回归 | PASS |
| OV-R2：OV-S03、OV-S04、OV-S05 | IP-01/02/04/06 | identification／assessment PG 测试核对完整目录、来源交集、矩阵精确版本与分组超界；浏览器实际翻过50条风险记录，两个冻结矩阵分别选择并核对表格同值 | PASS |
| OV-R3：OV-S06、OV-S07、OV-S08 | IP-02/03/04/06 | dashboard PG 测试覆盖三路微秒全序、Unicode keyset、固定上界、新事实、撤权、伪游标和恢复；浏览器首屏失败后新增事实，消费原 retryCursor 且维持 asOf；拒权不阻断合法续页 | PASS |
| OV-R4：OV-S09、OV-S10 | IP-02/04/06 | warning／review PG 测试区分 pending（含 stale）、未确认预警、开放任务与关联预警；浏览器保留原确认／只读角色边界，三个摘要导航零命令，全部预警等级与未确认分组分别展示 | PASS |
| OV-R5：OV-S11、OV-S12 | IP-02/04/06 | engineering-data PG 测试与原目录候选同口径；257个监测序列仍完整统计；浏览器资料／监测导航保留工程、零命令，field-responder 无资料目录入口但可查看处置任务 | PASS |
| OV-R6：OV-S13、OV-S14 | IP-05/06 | 两个旧地址均规范化到 runs；先生成不同当前修订，再阻断当前 context-read 并指定原历史修订；两组独立续页、链运行精确详情、刷新／返回与投影实际请求中的原修订全部核对 | PASS |
| OV-R7：OV-S15、OV-S16 | IP-06 | 正式构建、真实 PG／HTTP／Cookie、97项浏览器、六个原生缩放组合；脚本缺工具／断言失败非零，不把缺席分页按钮记作成功；规模与响应字节见 `evidence/aggregate-scale.json` | PASS |
| OV-D1：OV-D1-S01、OV-D1-S02、OV-D1-S03 | IP-01/02/03/06 | 聚合前裁剪全部来源交集；六来源独立当前授权、无领域写／收据／模型调用；workflow 全目录包括旧 C31／报告重放回归；HTTP／部署真实装配验证 | PASS |
| OV-D2：OV-D2-S01、OV-D2-S02 | IP-01/03/06 | strict 请求／来源结果／游标、真实日期、双游标互斥、安全计数、来源抛错隔离、审计技术失败、无越权续页；contracts、HTTP、真实 PG 行为测试 | PASS |
| 风险态势必须按有界所属摘要呈现：摘要失败与范围切换、原投影引用按页追溯、OV-A-S01 | IP-02/04/05/06 | 独立失败、同一 C31 queryResultRef 续页、多冻结矩阵与原 P/C 解释；新仪表盘不改历史投影或报告输入 | PASS |
| 运行审计与证据必须按所属事实分别分页：独立来源与续页、历史与无正文权限、OV-O-S01 | IP-05/06 | 两组运行独立分页，原复核／审计／报告与受限证据回归，永久旧地址、精确历史选择、当前上下文故障隔离 | PASS |

### 验收期修复

1. **来源权限与错误收口**：风险聚合遗漏证据中的额外来源，可能比目录多披露记录；现按登记来源与证据来源并集批量裁剪。六来源抛错／非法输出／缺来源方法独立失败；技术审计异常不再冒充拒权。工程级 review 不声明总览空间；来源复验补齐主体、工程、redacted 与能力检查。
2. **所属统计完整性与边界**：评估缺冻结矩阵、单矩阵等级超界整来源失败；review 改为 SQL group/count，monitoring 以可见关系和 EXISTS 聚合，移除错误的256序列限制；资料状态按有界候选 SQL 聚合。预警计数保留 bigint 到安全整数校验，当前摘要不再借旧时间线上界冒充统计时点。
3. **游标完整性**：strict 游标／真实六位 UTC 日期／完整排序位置／双游标互斥；SQL 明确 `COLLATE "C"`，中央按 Unicode code point 比较，避免数据库与 JS 排序差异漏项；故障恢复回归实际恢复来源而非反复读取失败分支。
4. **前端读取与导航**：时间线按 retryCursor 判断不完整并重试原位置，拒权不挡其它来源续页；风险事件带 version，风险详情直接读取该精确引用；恢复链运行精确详情、三个待办目录入口和全部预警等级分布；资料／监测未就绪或无权时禁用入口。
5. **工程切换**：唯一 URL 写入点清除旧 revision，同工程历史导航仍保留。`RiskDetailPage.tsx` 与 `app/App.tsx` 两个原施工图外调用方均经用户明确批准后纳入 implementation-plan，不改变权限或领域端口。
6. **验收材料**：修正夹具2030年记录与当前仪表盘时钟不一致导致的空时间线；增加55条真实风险记录及51条真实识别运行以跨页取证。原生脚本不再缺按钮也记录可聚焦，修正 change 归属并记录合成资格／来源版本。历史测试不再假定固定夹具始终在第一页，消除前序真实评估新增运行造成的用例顺序依赖。

### 实际命令与结果

- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`：通过，正式 dist 已用于浏览器及手动 smoke。中间一次构建暴露来源结果泛型断言错误并达到默认4GiB堆上限；移除不安全断言，按施工图8GiB命令重建通过。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`：通过。
- 以下命令合并覆盖施工图 V-01、V-02、V-03 及既有组合 service 单元测试，最终 **24 files / 457 tests passed**：

```sh
pnpm exec vitest run packages/contracts/test packages/core/test/access.test.ts packages/core/test/risk-dashboard/risk-dashboard.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs apps/web/test/routing-context-actions.test.ts apps/web/test/business-routes.test.ts apps/web/test/api-client-openapi.test.ts apps/web/test/ssr-shells.test.tsx packages/adapters/test/identification/postgres-risk-identification-read.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts packages/adapters/test/review-audit/postgres-review-queue-read.test.ts packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts packages/adapters/test/workflow
```

- 最终完整生产浏览器回归 **97 passed / 0 retry / 0 skip**：

```sh
pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/assessment-warning-response.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts --retries=0
```

- `DISPLAY=:109 node apps/web/test/browser/native-zoom.mjs`：通过；1280×720、1440×900、1920×1080，各100%／200%。专用 Xvfb 屏幕2560×1440容纳真实最大外窗口；较小显示首次导致1920窗口被裁为1919，保持尺寸断言、扩大专用显示后重新取证，没有放宽验收。结果及18张截图见 `evidence/native-zoom.json`、`evidence/native-zoom/`。
- `pnpm exec vitest run packages/adapters/test/workflow/postgres-risk-dashboard.test.ts --reporter verbose --silent=false`：**11 passed**，实际耗时、候选与字节记录在 `evidence/aggregate-scale.json`；不是静态估计或生产 SLA。
- `pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy`：通过；dependency-cruiser 检查706个模块、2449条依赖，无违规。
- `openspec validate deliver-risk-overview-dashboard --strict --no-interactive`：通过；最终工件完成后再次执行确认。
- 手动浏览器 smoke：正式登录后观察56条风险版本的真实统计及20条首屏变化；实际续页20／16条，点击末页 `risk-record:dashboard-00`，详情显示 `v2`；切工程后 URL 不再含旧 revision。浏览器无捕获到的运行异常。临时服务器、专用显示、浏览器标签与脚手架均已关闭／清理。

中间旧 dist 上的新增回归失败不作最终证据；正式重建后重新执行上述457项。完整浏览器首次出现1项因固定首页夹具假设造成的 flaky；修正断言的真实数据边界后，以 `--retries=0` 完整重跑97项通过，不以自动重试通过代替验收。

## 限定审计

本轮一次限定审计，发现的普通缺陷已在审计活动任务中修复，再由主会话执行最终回归；无待审计项。

- **DASHBOARD-SOURCE-AUTHZ：PASS**。识别／评估按当前空间及全部必需来源交集过滤后聚合；review 保持工程级 pending；监测／资料共用所属候选，不加载全量业务正文拼计数。来源错误独立、无 Agent 扩权、无领域写入。证据：五来源 PG 测试、workflow dashboard 与 HTTP／部署测试、只读角色和零命令浏览器场景。
- **POLICY-HISTORY：PASS**。策略 v3 下仍识别 v1/v2；真实 v2 历史上下文可恢复，当前撤权立即拒绝，旧行保持原策略身份。warning 当前拒权使用当前策略引用，不改历史授权。证据：`local-identity-project-authorization.test.ts`、`access.test.ts` 及浏览器同账号撤权回归。
- **CURSOR-COMPLETENESS：PASS**。微秒时间、Unicode／SQL 同序、跨来源完整排序键、原上界、新事实刷新边界、partial 原位重试、错工程／错空间和当前撤权均已覆盖。证据：dashboard／identification／assessment／warning PG 场景及真实浏览器首屏恢复／拒权续页。

## 后续注意事项

- 未提交、未归档；后续集成必须固定本次修复检查点。没有执行集成专用全仓 `pnpm verify`，本报告不冒充 main 门禁。
- Vite 仍报告既有大于500kB的 chunk 警告；本包未扩大到通用拆包工作。没有新增依赖、迁移、物化表、模型调用、生产故障开关或 CH-9 能力。
- 合成数据及本机耗时不能代替甲方真实工程样本、现场性能或部署验收。
