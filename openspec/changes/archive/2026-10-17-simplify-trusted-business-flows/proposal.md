## Why

封闭系统中的已有对象仍要求调用方重建历史来源范围，工件写入反复验真并要求上游预先整理集合，合法分页还可能被任意长度门槛挡住。这些机制增加正常业务摩擦，本 change 按已批准方案在业务入口保留必要检查，内部直接消费已登记事实。

## What Changes

- C31/C35 从登记对象解析读取范围，检查当前权限；内部报告分页复用同一决定，不比较当前完整授权与历史摘要。
- 工件入口统一规范化引用集合，取消正常写入、重放和父引用消费的重复摘要验真；内容去重不重读旧对象全文。
- 取消读取游标残留的 512 字符门槛，保留请求大小、分页和查询绑定。
- 同步现有规格、调用方、测试及验收 handoff；不增加依赖、迁移、审批或证明体系。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform/content-addressed-artifact-store`：集合由入口规范化；日常去重复用已登记对象，独立维护核验完整性。
- `platform/local-identity-project-authorization`：精确对象的资源范围由服务端解析，可信内部调用复用业务决定。
- `domain/module-interfaces-events-workflows`：已有查询和报告按冻结业务范围及当前权限读取，不按历史授权摘要全等判权。
- `platform/http-command-query-sse-shell`：精确对象读取不要求客户端重建来源集合，合法游标不受额外任意长度门槛阻断。

## Impact

基线为 `3a88273781a1f9473cbf2d813786799a0e7d7633`。直接沿用已归档 `reduce-defensive-design-overhead` 的设计；当前功能验收 change 仅提供现状及接续责任，不重新解释研究原件。修改范围为工件、C31/C35、授权组合接缝、contracts 游标及对应客户端和测试。覆盖 RI-S14、RI-S6、RA-S5～RA-S7 的读取与交付路径，不改变评分、知识内容、预算或人工业务决定。新旧应用同批发布，不改既有数据库与已导出报告正文。无新增第三方依赖。
