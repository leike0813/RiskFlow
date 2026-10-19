## 1. 公共契约与策略历史

- [x] 1.1 [IP-01] 定义唯一仪表盘请求、六来源结果、精确事件及有界游标 Schema，保持 C31 协议；验证：`pnpm exec vitest run packages/contracts/test/c34-assessment-response-read.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts`，覆盖未知字段、非法分页／引用及不安全数量拒绝。
- [x] 1.2 [IP-01] 登记 projection.dashboard-read 与既有 projection.query 映射，工程角色显式授予分支、纯系统管理员无工程资格；验证：`pnpm exec vitest run packages/core/test/access.test.ts`。
- [x] 1.3 [IP-01] 发布策略 v3，保留 v1/v2 历史识别及当前撤权语义，不重写旧授权行；验证：`pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`。

## 2. 所属事实聚合与变化窄读

- [x] 2.1 [IP-02] 提取识别目录与聚合共用的 accepted／登记／当前可见候选，实现风险版本与工序计数及微秒变化页；验证：`pnpm exec vitest run packages/adapters/test/identification/postgres-risk-identification-read.test.ts`，覆盖超页与不可见来源交集。
- [x] 2.2 [IP-02] 复用评估授权候选，实现冻结矩阵精确版本×等级聚合及登记变化页；验证：`pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`，覆盖重评、多矩阵同等级及超界。
- [x] 2.3 [IP-02] 实现预警窄读，区分开放任务、关联预警、全部等级与未确认预警，输出精确登记变化页；验证：`pnpm exec vitest run packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts`，覆盖重叠与确认后的变化。
- [x] 2.4 [IP-02] 用所属 SQL 返回工程级 pending 复核及类型分组，保留 stale pending，不调用全量队列实现；验证：`pnpm exec vitest run packages/adapters/test/review-audit/postgres-review-queue-read.test.ts`，与原队列可见口径一致。
- [x] 2.5 [IP-02] 资料／监测共用所属可见候选，返回真实版本状态和有批次／快照的序列数，不遍历目录页；验证：`pnpm exec vitest run packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts`。

## 3. 只读组合、HTTP 与生产装配

- [x] 3.1 [IP-03] 实现纯组合 service：六来源独立当前授权、错误隔离、有界合并、固定上界及原位置重试；验证：`pnpm exec vitest run packages/adapters/test/workflow/postgres-risk-dashboard.test.ts`，真实持久事实证明无重漏、无领域写／回执／模型调用。
  - 计划文件清单外的补充：`packages/core/test/risk-dashboard/risk-dashboard.test.ts`（组合层纯单元测试）。它覆盖真实数据库集成测试不便构造的边界——非法游标与错工程游标拒绝、授权判定的技术故障按 transient 收口而非折成拒权、失败来源不推进成功来源的 retryCursor 语义。属 IP-03 组合 service 自身的可观察契约，未新增产品行为。
- [x] 3.2 [IP-03] 注册可选注入的 dashboard HTTP 读面与唯一 Schema，保持 Cookie、no-store 和安全错误边界；验证：`pnpm exec vitest run apps/api/test/http-shell.test.ts`，覆盖未注入、非法结果与审计失败。
- [x] 3.3 [IP-03] 接入正式部署与两个活跃浏览器组合根，装配要求真实来源方法，不增加生产故障开关；验证：`pnpm exec vitest run scripts/deployment/api-ports.test.mjs`，并在第 6 组通过正式 HTTP 读取真实统计。

## 4. 总览仪表盘

- [x] 4.1 [IP-04] 增加同 Schema 解码的 readRiskDashboard，交付公共区域、六来源状态及上下文失效处理；验证：`pnpm exec vitest run apps/web/test/api-client-openapi.test.ts apps/web/test/ssr-shells.test.tsx`，并在第 6 组观察单来源故障与跨工程迟到响应。
- [x] 4.2 [IP-04] 复用主题／ChartSurface／Timeline，实现按冻结矩阵切换的 donut、工序条形图及精确事实链接；验证：正式 `/overview` 显示与服务端同值的文字替代，多矩阵不混算，键盘可达；第 6 组保存浏览器与缩放证据。
- [x] 4.3 [IP-04] 展示不求总和的三类待办及真实资料／监测概况，入口保留工程且不触发业务命令；验证：第 6 组真实浏览器从总览到两现有承载，无资料权角色不见受限数量，读权不生成写权。

## 5. 历史运行原子迁移

- [x] 5.1 [IP-05] 两组运行迁入唯一 OverviewRunsSection，各自查询、游标、续页与精确详情，删除旧页面及无调用 helper；验证：第 6 组在 `/overview?tab=runs` 分别翻两组超过一页的真实运行，dashboard 来源失败不阻断合法运行。
- [x] 5.2 [IP-05] 保全 URL 历史 revision，拒绝矛盾／错工程值，仅在未给修订时消费既有当前上下文；验证：`pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/api-client-openapi.test.ts`，并在第 6 组用不同于当前的修订刷新／返回，观察精确原目标。
- [x] 5.3 [IP-05] 两个完整旧运行路径优先永久 replace 到 runs；共享 SectionTabs 合并目标 query，生产链接直接生成规范地址，旧未知后缀不重定向；验证：`pnpm exec vitest run apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/ssr-shells.test.tsx`，以及第 6 组旧深链／内部页签／浏览器历史实测。

## 6. 真实行为、性能与最终核验

- [x] 6.1 [IP-06；IP-01～IP-03] 补齐施工图证据矩阵的真实 PostgreSQL／HTTP 行为与 100/1000 条规模证据，执行 implementation-plan V-01、V-02、V-03；记录微秒全序、故障原位重试、当前撤权、越界与原 C31／报告重放结果，缺关键环境不得 skip 通过。
- [x] 6.2 [IP-06；IP-04～IP-05] 执行 implementation-plan V-04：正式构建后运行四份既有浏览器套件，实际操作总览、真实来源失败、资料／监测入口、两组运行分页、历史旧地址及上下文竞态；证据标明合成样本、待甲方复核，不以测试接线代替生产面 smoke。
- [x] 6.3 [IP-06] 将 native-zoom.mjs 证据根改为本 change 并覆盖总览操作；执行 `DISPLAY=:109 node apps/web/test/browser/native-zoom.mjs`，记录三窗口×100%／200% 原生缩放及键盘可达，缺显示或工具非零失败，不覆盖 CH-2 归档证据。
- [x] 6.4 [IP-06] 执行 implementation-plan V-06 的类型、lint、格式、依赖及严格规格门禁；按实际交付更新既有 UI 主文档的 CH-3 引用，证据与最终实现检查点一致，不变更后续工作包责任。
- [ ] 6.5 [IP-06] 由 Finalizer 核对全部 Requirement/Scenario/IP-ID 和最终运行证据，完成范围内修复／回归及 verification；本轮一次限定审计闭合 DASHBOARD-SOURCE-AUTHZ、POLICY-HISTORY、CURSOR-COMPLETENESS，结论补入同一 verification。完成检查：无未处理范围内缺陷、关键未运行或待审计项，记录实际 HEAD、命令结果及证据路径；规划阶段不创建该工件、不勾选本任务。
