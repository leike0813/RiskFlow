## 1. 公共契约与所属事实读面

- [x] 1.1 实施 IP-01：固定 D-02 的唯一 read Schema、三条分支映射、明确角色读权限及安全摘要；复用原预算、校验、决定和信封。验证：`pnpm typecheck`；`pnpm exec vitest run packages/core/test/agent-runtime/agent-runtime.test.ts packages/core/test/review-audit/review-audit.test.ts packages/core/test/access.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/contracts/test/c33-identification-review-read.test.ts`。
- [x] 1.2 实施 IP-02：完成 Agent 目录、详情、行动/候选/校验分页、提案摘要和合法启动上下文，保持原状态、预算与操作语义。验证：`pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts`。
- [x] 1.3 实施 IP-03：完成复核详情、活动多源分页与所属识别/来源安全摘要。验证：`pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-audit-adapter.test.ts packages/adapters/test/review-audit/postgres-review-queue-read.test.ts packages/adapters/test/identification/postgres-risk-identification-read.test.ts packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`。
- [x] 1.4 实施 IP-04：完成当前 Cookie 会话的独立系统管理证明、目录和原六项命令 façade。验证：`pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`，核对纯管理员无业务特权、预期版本、审计回滚与密码边界。

## 2. 报告与闭合 HTTP 接线

- [x] 2.1 实施 IP-05：完成 C31 精确预览、部署策略、JSON 工件、幂等绑定与尾事务、历史及授权再读取。验证：`pnpm exec vitest run packages/adapters/test/workflow/postgres-report-export.test.ts packages/adapters/test/workflow/postgres-workflow-projection.test.ts`，覆盖工件/审计失败、预算上限、并发重放和撤权。
- [x] 2.2 实施 IP-06：登记三条业务窄读与四条系统路由，接入有界健康/部署元数据提供者并保持 OpenAPI 同源和未注入关闭。验证：`pnpm exec vitest run apps/api/test/http-shell.test.ts`；`pnpm typecheck && pnpm deps:check`。

## 3. 复用 v2 页面与共享交互

- [x] 3.1 实施 IP-07：完成唯一客户端接线、类型化决定 builder、专用管理密码信封、共享任务 Provider 及单在途刷新/竞态保护。验证：`pnpm --dir demo build`；请求/重放/焦点/迟到响应行为由 4.2 的真实浏览器证据核对。
- [x] 3.2 实施 IP-08：将 v2 Agent 停靠、工作台和任务详情分区接到真实共享任务，接通支持范围内的启动/恢复/取消/提案确认。验证：`pnpm --dir demo build`；4.2 核对原任务/预算、版本及零绕过。
- [x] 3.3 实施 IP-09：复用 v2 复核详情、修正候选选择、审计和报告布局，保留既有追溯/运行分源分页并完成真实 JSON 下载。验证：`pnpm --dir demo build`；4.2 核对五类决定、历史版本、证据脱敏、报告重放及 Blob 清理。
- [x] 3.4 实施 IP-10：复用 v2 五个系统管理页面，接通六项 C06 动作，呈现真实来源/健康/模型引用与备份未接入态。验证：`pnpm --dir demo build`；4.2 核对无工程管理、七项导航、密码清理及缺席能力零副作用。

## 4. 真实装配与回归证据

- [x] 4.1 实施 IP-11：扩展同一 PostgreSQL 的 browser composition，注入所有所属正式端口、JSON 策略和安全健康/模型元数据；构造版本化合成任务/复核/审计/报告/账号输入，标明待甲方复核。验证：`pnpm build && pnpm --dir demo build`；4.2 必须通过正式登录与实际入库结果证明装配完整。
- [x] 4.2 验收 IP-01～IP-11：运行 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/agent-audit-operations.spec.ts`，覆盖施工图 §6 全部 Web Scenario、v2 分区对照、真实操作/下载、撤权、上下文竞态、键盘焦点、慢读单在途和性能读取边界。
- [x] 4.3 回归 IP-07～IP-11：运行 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/read-only.spec.ts demo/test/browser/identification-review.spec.ts demo/test/browser/assessment-warning-response.spec.ts`；`pnpm typecheck && pnpm lint && pnpm deps:check`；`openspec validate deliver-agent-audit-and-operations-ui --strict --no-interactive`。普通失败在当前责任阶段修复，未运行或关键跳过不得勾选。

任务勾选表示实现行为及对应证据完成。`verification.md` 由实现后的 Finalizer 创建；限定审计、主线集成、归档和 Git 检查点按项目流程与用户授权处理，不预填成功。
