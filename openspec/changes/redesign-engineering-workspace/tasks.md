## 1. 公共契约

- [ ] 1.1 实施 IP-01：固定唯一公共值/payload/端口Schema并迁移实际消费者导入；运行 `pnpm exec vitest run packages/contracts/test/engineering-workspace.test.ts packages/contracts/test/c32-read-surface.test.ts`，确认额外字段、引用及版本边界。

## 2. 工程与接入所有者

- [ ] 2.1 实施 IP-02 的工程/空间修订与当前/历史精确读取；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source packages/adapters/test/engineering-data/engineering-workspace.test.ts`，核对首修订、陈旧并发、越界和审计回滚。
- [ ] 2.2 实施 IP-02 的接入关系窄读与监测精确目标解析；运行 `pnpm exec vitest run packages/adapters/test/engineering-data`，核对有界分页、历史页外对象、部分可用、无Agent权及真实撤权。

## 3. 访问所有者

- [ ] 3.1 实施 IP-03：新增C06经理作用域目录并复用原四类访问命令，保持系统管理与工程业务分离；运行 `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`，验证幂等、并发、撤权和安全审计失败。

## 4. 传输和正式装配

- [ ] 4.1 实施 IP-04 的四个严格HTTP操作及OpenAPI/正式部署组合；运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs`，验证Cookie、非法输入、端口缺席和同版真实装配。
- [ ] 4.2 实施 IP-04 的Web有限请求构造/解码与浏览器server接线；运行 `pnpm exec vitest run apps/web/test/api-client-openapi.test.ts` 和 `pnpm typecheck`，不在页面拼HTTP或新增branch。

## 5. 工程导航与维护承载

- [ ] 5.1 实施 IP-05 的共享工程标题/二级导航、新路由及无工程开通入口；运行 `pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts`，验证旧五别名、未知后缀和精确查询保留。
- [ ] 5.2 实施 IP-05 的上下文/空间、成员/资料访问表单以及共享开通/成员表单；运行 `pnpm exec vitest run apps/web/test/confirmation.test.ts`；真实浏览器确认取消零写、输入或工程变化失效，以及原系统六动作仍可落库。

## 6. 工程事实与接入视图

- [ ] 6.1 实施 IP-06 的工程概览和资料目录/详情：独立来源状态、原件默认、分页口径、共享接入事实区域；运行 `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/engineering-workspace.spec.ts apps/web/test/browser/read-only.spec.ts`。
- [ ] 6.2 实施 IP-06 的监测目录/精确详情、快照选择及接入列表/详情；运行同一工程浏览器命令，验证目录页外历史版本、非最新快照、当前阈值变更、无快照与无Agent权不误挡领域结果。

## 7. 组合回归与取证

- [ ] 7.1 实施 IP-07 的全部已知内部/project调用方迁移及角色/历史/失败组合回归；运行 `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/engineering-workspace.spec.ts apps/web/test/browser/read-only.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts`，关键分支不得skip。
- [ ] 7.2 实施 IP-07 的真实桌面键盘/缩放证据并更新已实施文档；按本change场景和证据根更新后运行 `node apps/web/test/browser/native-zoom.mjs`，覆盖三种外窗口×两档原生缩放的操作、错误、确认、取消和焦点。
- [ ] 7.3 完成 IP-07 工程集成核对：运行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check` 和 `openspec validate redesign-engineering-workspace --strict --no-interactive`；按implementation-plan证据矩阵逐项记录，交Finalizer完成最终核验、范围内修复与一次必要限定审计，再由其生成verification。
