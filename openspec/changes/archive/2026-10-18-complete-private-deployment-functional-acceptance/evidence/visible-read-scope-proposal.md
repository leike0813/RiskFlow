# 实机只读界面修复提案

状态：用户已于2026-10-14授权按本提案修复，现已通过真实集成及物理Chrome复验，见 [取证记录](visible-read-and-docx-2026-10-14.md)。C04 / D-31 已独立修复且新清洗任务与准备快照成功；本提案补充 IP-21 的可见读取证据。

## 已复现的边界

- 物理 Chrome 的 Agent 列表 HTTP 200 返回实际任务，任务详情持续显示读取中。`AgentTaskProvider` 在切工程时递增 `generationRef`，但 snapshot 重置为 generation 0，后续更新均因代际不匹配被丢弃。
- 实际清洗结果 `engineering-data.data-cleaning-result` 经当前权限完整读取、verified及 Schema验证，5个输入均 available；目录读取该工件时却请求 `engineering-data.source-catalog` 用途，拒绝后被省略为“未清洗”。
- 按5个实际资料版本声明范围时，正式 C06 返回当前源授予修订身份；C11 source_versions 保存的授予引用使用命令结果的数值身份1。C32直接比较两者的完整引用，导致明确有权的目录为空。只读诊断已确认当前授予与登记引用的 entityId相同、versionId属于不同身份。早期诊断的空数组断言不作为修复通过证据，随后已加条目数量断言并明确失败。

## 拟补充范围

| 文件 | 动作 |
| --- | --- |
| `apps/web/src/agent/AgentTaskProvider.tsx` | 清空旧内容时同步新代际，保留单在途、切工程/注销取消和旧响应丢弃。 |
| `apps/web/test/browser/agent-audit-operations.spec.ts` | 在既有真实浏览器用例核对已登记任务能显示状态/预算，并保留慢读、切工程和取消覆盖。 |
| `packages/adapters/src/engineering-data/catalog/postgres-engineering-data-catalog-adapter.ts` | 以当前C06验证的源授予关联精确资料身份，区分登记的授予指针与当前授予修订；清洗状态按真实工件用途读取，缺权/缺证据明确缺席，不伪造 available。仍保留C06当前版本复验、工程/资料边界及C04完整性。 |
| `packages/adapters/test/engineering-data/postgres-engineering-data-catalog.test.ts` | 复用真实C06/C11/C04夹具，验证明确声明的合法资料目录及真实清洗结果；错工程、撤权、缺失和损坏不泄露结果。 |
| `apps/web/src/api/operations.ts`（必要时） | 用既有HTTP声明按当前页的精确资料引用完成有界二阶段资格读取，取消信号及分页保持原契约，不增加HTTP字段或扩大授权。 |
| 当前change设计、施工图、delta与证据索引 | 记录IP-21来源映射及工程/物理复验。 |

不改变C06权限策略、已发布授予、资料、清洗结果、预算或数据库，不通过改写既有实例事实消除身份差异。若实施中需超出上述读取接缝的权限/公共字段/迁移设计，再升级。先真实回归，再在原物理Chrome验证，完整验收仍按原任务取证。

施工图§7要求计划外文件升级；本提案已获授权，实际回归及物理窗口证据另行记录。
