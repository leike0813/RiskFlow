## 1. 公共契约与权限

- [ ] 1.1 实施 IP-01/IP-12：补正基础契约并闭合两条领域读、C11 候选窄读、两条校准命令及 SSOT；补 resolve actions、预览策略同形引用、重评共用输入、窄成功结果及稳定边界用例。验证：`pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts`、`pnpm typecheck`。
- [x] 1.2 实施 IP-02/IP-12：按 D-06 授予只读角色与两个经理治理分支，验证真实单分支授权及未授予写权。验证：`pnpm exec vitest run packages/core/test/access.test.ts`。

## 2. 所属读取与公共接线

- [ ] 2.9 实施 IP-05/IP-12：按 D-12 定义重评元数据和唯一原因映射、修复无监测入口门禁、将显式前驱/原因/变化集合纳入入口身份。验证：`pnpm exec vitest run packages/core/test/workflow/service.test.ts packages/contracts/test/c34-assessment-response-read.test.ts`。
- [x] 2.10 实施 IP-05/IP-12：贯通父子启动、run-state 工件/入口登记与恢复，移除原因启发式，保证原命令重试和同键异载荷失败。验证：`pnpm exec vitest run apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts apps/worker/test/risk-flow/composition.test.ts apps/worker/test/assessment/composition.test.ts`。
- [x] 2.11 实施 IP-05/IP-12：验证 C04 已写但入口登记失败、响应丢失和新 runtime 恢复的持久边界；历史重评缺元数据时 runtime 拒绝继续评估。验证：`pnpm exec vitest run packages/adapters/test/workflow apps/worker/test/risk-flow/composition.test.ts apps/worker/test/assessment/composition.test.ts`。
- [x] 2.1 实施 IP-03/IP-12：提供 C11 两类独立分页候选，修正 C33 record-catalog 的 SQL 分页并复用原公开结果；验证精确修订、作用域与空目录。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/context-source packages/adapters/test/identification/postgres-risk-identification-read.test.ts`。
- [x] 2.2 实施 IP-05/IP-12：提供 C30 运行、父子引用与 D-12 原入口工件窄读，保持登记事实、阶段及已成立结果；精确前驱/原因/变化引用不能从 frozenRefs 反推，补缺失元数据失败用例。验证：`pnpm exec vitest run packages/adapters/test/workflow`。
- [x] 2.3 实施 IP-04/IP-12：组合评估候选/启动上下文及精确记录、历史、矩阵落点和所属摘要；验证缺失解释失败闭合与历史版本不变。验证：`pnpm exec vitest run packages/adapters/test/risk-assessment`。
- [x] 2.4 实施 IP-06/IP-12：补齐 C26 预警、任务、确认/站内通知与 C27 正式建议的所属有界读取。验证：`pnpm exec vitest run packages/adapters/test/warning packages/adapters/test/recommendation`。
  - 用户决定：`recommendation-read` 的 `generationPolicyRef`/`validationPolicyRef` 改为 `VersionReference`（联合里没有能诚实表达"策略"的 kind，不套 `ContractReferenceV1`）；`measureReleaseRefs` 按已登记的单条措施库发布引用投影为 1 元素数组。
  - 本任务交付 `warning-catalog`、`task-catalog`、`overview`、`warning-read`、`recommendation-read`；`task-read` 关系页与 `resolve` 随 task 2.7 一并落地。
- [x] 2.5 实施 IP-06/IP-12：补齐 C28 预测/执行/反馈偏差与 C41 人工决定的精确读取，保持 available/unavailable 和独立事实。验证：`pnpm exec vitest run packages/adapters/test/response-lifecycle packages/adapters/test/human-decision-feedback`。
- [x] 2.6 实施 IP-07/IP-12：提供 C29 校准只读与窄治理包装，按实际 branch 与 verified context 分用途授权；验证真实 C06/C07/C16、拒绝/退回、未发布草案与尾事务重试。验证：`pnpm exec vitest run packages/adapters/test/calibration`。
- [x] 2.7 实施 IP-06/IP-07/IP-12：在 C26 factory 组合所属窄读和关系页，输出获准 actions 与独立摘要，避免跨域私表访问。验证：`pnpm exec vitest run packages/adapters/test/warning packages/adapters/test/calibration`、`pnpm deps:check`。
- [x] 2.8 实施 IP-08/IP-12：复验四个新分支和三个注入位，补两治理分支各自结果校验与按 Schema 构造的 read stub，验证 runtime/OpenAPI、未注入关闭、strict outcome 与授权安全失败。验证：`pnpm exec vitest run apps/api/test/http-shell.test.ts packages/contracts/test/c34-assessment-response-read.test.ts`。

## 3. 复用 v2 页面并接通真实操作

- [ ] 3.1 实施 IP-09：完善 typed operations、C31 单页读取、冻结完整命令信封、七态、精确深链与确认焦点；验证既有调用保持可构建。验证：`pnpm --dir demo build`；取消零提交、迟到响应与原载荷重试由 4.2 验收。
- [ ] 3.2 实施 IP-10：复用 v2 七个评估页面的分区和交互，接通初评/重评、父子运行、历史记录与冻结评分解释。验证：`pnpm --dir demo build`；对应深链、单轮询和历史解释由 4.2 验收。
- [ ] 3.3 实施 IP-10：提取 v2 版本化 SVG 矩阵并复用于知识/评估页，接通风险态势双摘要及 C31 分页追溯区，保留根路径入口。验证：`pnpm --dir demo build`；非 5×5、多版本、来源独立失败与用户续页由 4.2 验收。
- [ ] 3.4 实施 IP-11：复用 v2 四个预警/任务页面，接通精确事实、冻结阈值解释、确认与独立关系时间线。验证：`pnpm --dir demo build`；确认幂等且任务状态不变由 4.2 验收。
- [ ] 3.5 实施 IP-11：复用 v2 五个处置页面，接通采纳/拒绝、两类执行及反馈区、预测/偏差/校准与精确决定治理。验证：`pnpm --dir demo build`；各写入独立、不可用不造值、草案不发布由 4.2 验收。

## 4. 真实装配、浏览器验收与收口证据

- [ ] 4.1 实施 IP-12：按 D-11 扩展 startDemoBrowserServer，在同一真实数据库装配领域 adapters、C07/C16、真实 C06 下游授权、Worker 两组合根、PostgreSQL checkpointer 与 runtime.workflowPort；登记版本化合成输入和策略，保留 C32/C33 端口。验证：`pnpm build`、`pnpm --dir demo build`；新 browser spec 的 setup 必须成功，缺必需依赖非零退出。
- [ ] 4.2 实施 IP-12：完成 implementation-plan §6 的全部真实 Chromium 场景，包括 17 页、原信封重试、撤权/陈旧引用、取消、父子运行、历史矩阵、C31 分页、校准真实证明及尾事务；保留失败 trace。验证：`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`，同时回归既有 read-only/identification-review 两套场景。
- [ ] 4.3 实施 IP-12：汇总逐 Scenario 证据与有界读取/矩阵性能测量，核对精确文件清单与所有任务行为；运行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm build`、`pnpm --dir demo build` 和 `openspec validate deliver-assessment-warning-and-response-ui --strict --no-interactive`。内存不足按 implementation-plan 使用显式 Node heap 参数。在实现检查点后移交 Finalizer 填 verification，并安排一次权限/事务/关键状态限定审计；Implementation 不提前生成 verification 或归档。
