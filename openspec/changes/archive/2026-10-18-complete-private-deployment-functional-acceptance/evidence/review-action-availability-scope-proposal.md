# 复核详情动作判定装配补充提案

状态：用户已随原件与Agent界面方案批准实施，归D-38。11类C18配置已正式登记候选、提交修订并请求复核；尚未批准或发布。

实机指标体系复核任务 `review-task-b5fc4020-6d4b-4709-9896-ca1c18a48eae@1` 正式pending，物理Chrome详情查询成功但 `actions: []`，批准/拒绝/退回按钮均关闭。同一实际管理员经原C06查询 `review-audit.decide-review` 得到 `review-audit.decide`、空间1、资料授权16、redacted=false，未提交决定。缺口不是授予权限：C07生产只读adapter的 `#taskActions` 仅对decided/superseded返回业务不可用原因，pending返回空集合；合置API未补当前主体的动作权限判断。页面按缺项拒绝是正确的失败关闭行为，不能在前端强行启用。

最小方案：在既有合置只读装配处，对pending任务通过受信当前会话、工程与精确任务读取事实，调用原C06决定分支取得实际允许/拒绝判定，补入既有actions字段。终态业务不可用原因保留；无权/撤权/非当前会话保持关闭。只读动作判定不提交决定、不授予能力，人工批准仍经原确认对话框和决定命令，发布仍需单独治理命令。

拟纳入IP-19/IP-21：`scripts/deployment/composition/api-ports.mjs`、`scripts/deployment/start.mjs`及既有api-ports/entrypoints测试；如需接入原C07读取适配器，限 `packages/adapters/src/review-audit/postgres-review-audit-read.ts`与其既有读面测试。同步当前change的design、implementation-plan、相关delta与证据。无依赖、迁移、产品DTO字段、权限策略或前端强制点击。

验收：同主体有决定权的pending任务按钮可用；无权/撤权/终态不可用；判定过程零决定写入。然后在物理Chrome自然点击确认，为11份合成配置形成真实决定及单独发布回执。合成批准不代表甲方批准。

项目implementation-plan §7要求计划外文件升级，[openspec-apply-change SKILL.md](/home/joshua/Workspace/Code/JavaScript/RiskFlow/.agents/skills/openspec-apply-change/SKILL.md)要求“When a task needs work beyond what the spec describes, surface the added scope and pause”。本提案只暂停新增范围源码编辑；原验收与定向/全量验证继续。
