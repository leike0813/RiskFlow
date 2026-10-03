## Why

C11 已有评估入口目录读取实现，但 C25 候选读取与它的输入和授权身份没有闭合：外部事件登记没有工程修订事实，却被要求提交工程修订；入口预览的下游 queryId 与签发身份不同。C11 分页还随页码增加读取量，且合法长标识会生成超过 512 字符契约上限的游标。这些问题阻塞 RA-S1 的受权候选选择。

## What Changes

- 按目录操作区分 strict 输入：适用性目录要求工程修订和空间；外部事件目录只要求空间。外部事件 pending-catalog 必须选择精确空间。
- 使用 C11 自有登记表的耐久 UUID 定位键及有界 keyset 查询，保持 512 字符游标契约、当前授权复验与不可枚举失败。
- 复用已有 C11 实现提供薄端口工厂，修正 C25 两个候选读取分支的下游签发身份、范围与失败结果。
- 增加 C11 有界来源授权定位接缝，将当前已验证的来源授权引用解析为来源版本，供 C25 按原范围重签目录授权，页面不增加必填项。
- 以真实 PostgreSQL/C06/C11 验证分页、权限、预览无写入与迁移，更新原 change 的接缝设计和依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `domain/engineering-context-source-registry`：目录按所属登记事实筛选，耐久定位、有界分页和当前授权校验。
- `domain/module-interfaces-events-workflows`：候选输入的操作判别与跨模块授权调用身份闭合。

## Impact

涉及 contracts 公共输入、C11 登记读取与导出、C25 候选调用，以及 PostgreSQL 000055 加法迁移和相关测试。迁移只增加内部定位列及唯一索引，不增加工程修订登记、不改变领域引用或权限角色；无新依赖。领域所有权保持 C11 拥有工程/外部事件事实、C25 组合只读候选（RA-S1，RI-S14）。原 `deliver-assessment-warning-and-response-ui` 的 IP-04 其余读操作及最终接线验收继续由原 change 承接，不在本修复中标记完成。
