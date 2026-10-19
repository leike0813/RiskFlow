## MODIFIED Requirements

### Requirement: C35 页面必须复用 v2 设计并保持既有应用接线

系统 MUST 在 `apps/web` 生产应用保留 Agent、复核审计、报告及系统管理真实能力，视觉使用 `web/design-system`，导航、区域组合、七态、辅助入口与分阶段切换使用 `platform/web-shell-interaction-primitives`，不重复固定七导航。Agent 和系统管理仅为辅助入口；管理入口由当前服务端系统管理员身份决定，不能由空业务能力集合推断。待办入口权与 Agent 权相互独立，不得为 reviewer 增授 Agent 权限或令其原复核受阻。原型 fixture、角色/状态注入、契约镜像、假回答或假操作 MUST NOT 成为交付能力。（横切 RI-S1～RI-S6；RA-S1～RA-S7）

#### Scenario: 已接通页面与 v2 分区一致
- **WHEN** 用户打开 Agent、复核详情、审计、报告或系统管理页面
- **THEN** 页面保留原业务分区与真实操作，以生产公共设计和壳层组织，事实来自正式 HTTP 接缝，既有深链仍可达

#### Scenario: 刷新切换与服务异常
- **WHEN** 用户刷新精确版本深链、切换工程，或读取失败/无权/端口未接入
- **THEN** 页面先恢复真实会话和工程上下文，再显示该引用或对应七态，迟到响应不覆盖新上下文，不用静态事实填充

#### Scenario: UI-S03 无 Agent 权仍可处理本域复核
- **WHEN** reviewer 有本工程复核权但无 Agent 读取权
- **THEN** 原精确复核详情及允许的决定保持可用，不要求先打开助手；不披露无权 Agent 标记、引用或关联存在性
