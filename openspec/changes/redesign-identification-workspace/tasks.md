## 1. 原分支公共契约

- [x] 1.1 [IP-01] 按 D-02 在原运行/风险详情分支定义互斥身份 payload 与所选运行头部，复用共享 Schema，不新增 branch/能力；验证 `pnpm exec vitest run packages/contracts/test/c33-identification-review-read.test.ts`。

## 2. 所属读取与 HTTP 贯通

- [x] 2.1 [IP-02] 按 D-03 实现实体定向定位、精确版本及当前完整来源/空间授权、运行头部与技术错误区分；验证 `pnpm exec vitest run packages/adapters/test/identification/postgres-risk-identification-read.test.ts`，页外目标不依赖目录且无业务写入。
- [x] 2.2 [IP-02] 验证原 C33 HTTP 路由与 OpenAPI 自动消费新 payload/结果，保持 API 和部署生产代码不改；验证 `pnpm exec vitest run apps/api/test/http-shell.test.ts`，真实浏览器沿原所属 port 证明端到端输入/结果。

## 3. 四入口与精确识别正文

- [x] 3.1 [IP-03] 收敛本域标题/四入口，完成任务和风险真实续页/筛选重置、业务首列与精确版本链接；验证 `pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts`，并在正式浏览器实际进入后续页对象。
- [x] 3.2 [IP-03] 去除运行/风险详情首页定位；风险无版本写回精确版本，运行有版本固定快照、无版本单在途跟踪最新状态，补结果引用集合；执行 `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts`，证明历史快照不变、实时状态能推进、I0～I9及七字段/置信度保真。

## 4. 详情追溯与永久旧地址

- [x] 4.1 [IP-04] 将原链正文/活样式移为风险详情共享 trace 区域，复用原完整有界读取、脱敏、独立七态与重试；执行 `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts`，证明 trace 失败不清空合法正文及同主体多页链边。
- [x] 4.2 [IP-04] 同版接通两旧 trace 的授权解析/replace，迁移所有生产内部链接并移除旧独立正文；无 subject 只去风险列表，错版/无权同形拒绝；执行 `pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts` 与上述浏览器命令，原复核队列及决定不回归。

## 5. 图谱与工序业务模型

- [x] 5.1 [IP-05] 删除重复风险分组列表，保留真实有界主体选择、完整正式图与可访问边浏览，失败给规范风险列表入口；执行 `pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-projection.test.ts` 与识别浏览器命令，后页失败不冒充完整图。
- [x] 5.2 [IP-05] 工序模型支持成套发布版本/节点定位，补齐实际节点字段、监测指标及依赖，复用领域最小覆盖常量；执行 `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/read-only.spec.ts`，显式历史发布不被当前集合替换，无假关系/历史/治理操作。

## 6. 回归、取证与实施交付

- [x] 6.1 [IP-06] 按施工图证据矩阵完成 contracts/adapter/API/Web/deployment 最小回归及生产 Chromium/HTTPS Cookie/真实 PostgreSQL 场景，覆盖页外目标、版本、来源撤权、技术故障、慢读/上下文切换、证据脱敏和原复核；执行 `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/read-only.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts`，保留实际证据，不把关键 skip 计通过。
- [x] 6.2 [IP-06] 将既有 native-zoom 场景与证据根改为本包，运行 `node apps/web/test/browser/native-zoom.mjs`；实际核验三窗口×100%/200%原生缩放、键盘、页签、分页、错误和局部滚动，质量/验收材料标明合成样本待甲方复核。
- [x] 6.3 [IP-06] 更新 UI 地图的实际 CH-5 交付/剩余边界，运行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`openspec validate redesign-identification-workspace --strict --no-interactive`；行为及证据均完成才勾选任务。实现检查点后由 Finalizer 按第8节核验修复回归，最多一次限定权限审计并生成 verification；不在 Planning/Implementation 提前写结论，不启用 CH-9 六导航。
