## MODIFIED Requirements

### Requirement: 空、加载、异常、权限四类骨架行为必须逐页一致

各页面 MUST 引用 `platform/web-shell-interaction-primitives` 的区域组合与七态契约，列表 A、详情 B、治理 D 作为单区域特例，不再限制为单值骨架。加载时占位不得闪烁为空态；空态只给已登记真实下一步；异常显示结构化安全摘要与可用重试；无权限不得泄露对象数量或名称。`NOT_FOUND` 与 `AUTHENTICATION_REQUIRED` MUST 保留原目标可见性及会话语义，不映射为普通错误。（RI-S61～RI-S65）

#### Scenario: 无权访问知识页面
- **WHEN** 不具备知识读能力的角色打开机理库页
- **THEN** 呈现权限骨架与所需能力提示，页面不显示任何条目数量或名称线索

#### Scenario: 查询失败可重试
- **WHEN** 只读查询因瞬时故障失败
- **THEN** 页面显示结构化错误摘要与重试入口，重试重新发起同一查询，不显示堆栈或内部标识

### Requirement: 浏览器验收必须使用真实浏览器与正式接缝

系统 MUST 在 `apps/web` 生产构建与真实 HTTP、授权、投影、PostgreSQL 迁移和会话上提供真实 Chromium 验收。导航及骨架引用 `platform/web-shell-interaction-primitives` 当前发布阶段，不重复固定导航数量；仍须验证本能力页面可达、工程切换、权限降级、证据脱敏与精确深链。记录 MUST 包含浏览器版本、命令和失败 trace，关键环境不可用不得以 Mock 或 skip 计作通过。（RI-S61～RI-S65）

#### Scenario: 真实浏览器完成只读链路
- **WHEN** 固定测试环境具备真实 Chromium、PostgreSQL 与已登记夹具事实
- **THEN** 验收从登录走到工程概览、资料详情、监测详情与知识治理页，核对真实事实渲染、无权脱敏与深链跳转

#### Scenario: 环境不可用明确失败
- **WHEN** 浏览器二进制、数据库容器或 API 服务不可用
- **THEN** 命令以非零状态退出并保留失败证据，不把跳过场景计作通过
