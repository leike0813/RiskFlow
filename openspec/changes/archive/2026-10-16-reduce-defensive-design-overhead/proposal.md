## Why

封闭业务系统在正常资料增加、重复读取和任务续办时，仍要满足逐层授权、身份配对、文件验真和配置全等，已经多次阻断验收。需要围绕交付界面的真实操作删除重复职责，让完整业务链更容易使用、实现和维护。

## What Changes

- **BREAKING**：统一用户请求及后台业务动作的权限入口，保留现有账号差异权限与派生资料限制；删除内部逐层签发和调用编号配对。撤权在下一次读取或提交检查，后台任务独立于网页登录期限。
- 读取访问记录直接追加，不参与业务写命令去重；文件写入计算内容摘要，日常读取不再重算全文或携带完整性收据证明。
- **BREAKING**：检索索引与知识内容绑定，查询按当前可见成员过滤，取消调用者全部授权摘要必须等于建库摘要的要求。
- 检查点只管理图进度，续办从已提交阶段结果恢复；缺资料、规则或人工审核显示等待，第三方元数据由官方库处理。
- **BREAKING**：单份运行配置清单维护成员关系，业务批准独立于软件发布号；评分快照只冻结本阶段依据，预警、处置、预测和校准到对应阶段准备配置。
- 模型使用任务内短选项，宿主管理机械分页；可修正输出错误由现有运行时在剩余预算内反馈。资料质量按文档类型处理，保留数值、来源和专业规则。
- 修复长编号、正常分页、任务详情依赖第一页和异常被隐藏的问题，保留旧对象可读。
- **BREAKING**：已批准成员在既定条件内的确定性适用规则集和知识组合自动形成不可变发布；新内容、冲突决定及措施采纳仍须人工确认，发布来源明确区分人工与派生。

## Capabilities

### New Capabilities

无。复用已有业务模块和基础设施。

### Modified Capabilities

- `platform/local-identity-project-authorization`：业务入口一次检查，后台任务生命周期与会话分离。
- `domain/module-interfaces-events-workflows`：精简内部上下文、只读记录和各阶段配置契约。
- `platform/content-addressed-artifact-store`：访问记录与普通流式读取取消命令去重和重复验真。
- `platform/postgresql-outbox-checkpoint-foundation`：检查点职责与业务续办分离。
- `platform/offline-private-deployment-and-operations`：生产装配、配置、检查点与分阶段验收接续。
- `identification/versioned-dual-index-hybrid-retrieval`：内容代际与当前查询权限分离。
- `identification/relationship-context-and-retrieval-agent-review`：可信上下文读取不复核历史授权摘要。
- `identification/graph`：阶段续办、业务等待与权限入口统一。
- `platform/unified-bounded-agent-runtime`：受限工具选项、可修正输出和业务动作权限检查。
- `platform/llamacpp-model-gateway`：结构化错误分类、直接消费已保存响应及补丁兼容。
- `data/agent-cleaning-and-partial-availability`：工具定位、类型适用质量策略与只读访问语义。
- `engineering-data/structured-document-conversion`：直接读取登记原件，保留完整转换与清洗部分可用的分工。
- `risk-assessment/engine`：评分仅依赖本阶段输入，后续策略在对应阶段准备。
- `knowledge/assessment-configuration-and-measure-governance`：按阶段解析所需配置成员，保留完整配置集合能力。
- `domain/warning-tasks-and-in-app-notification`：预警阶段取得归集和通知策略。
- `domain/execution-forecast-feedback-and-deviation`：预测与偏差在各自阶段冻结策略。
- `domain/calibration-suggestion-and-governance-loop`：校准阶段准备 Agent 策略与原评估依据。
- `domain/response-recommendation`：处置阶段冻结自己的策略，后续读取正式结果。
- `knowledge/governed-definition-lifecycle`：人工内容发布与确定性派生发布共用事实模型。
- `knowledge/structured-scoring-rules-and-applicable-rule-sets`：已批准规则确定性组装自动生效。
- `identification/process-model-mechanism-and-evidence-governance`：已批准知识组合自动生效。
- `web/agent-audit-and-operations-ui`：精确详情、合法分页及明确错误。

## Impact

本 change 承担审计14项的设计、代码和相关回归；当前一轮先完成五项规划工件。应用范围为 API、Worker、Web、contracts/core/adapters、部署配置与文档；Electron 继续使用同一 Web/API。无新依赖，不改变 P/C、矩阵、单位、三项处置约束、专业复核和人工采纳。

直接技术基础为已归档主规格；与在途 `complete-private-deployment-functional-acceptance` 共用当前工作区成果，实行串行实施，不把其未归档契约伪写为已归档依赖。新 change 接管冲突的逐层授权、检索全等、检查点举证及重复审核要求；旧 change 保留现场证据和完整业务验收责任，接续说明见 `handoff.md`。不修改执行图或 Orca 状态。

保存原资料、规则和已完成阶段；旧终态失败通过关联新尝试接续。新增派生发布来源需要一项只增迁移，旧人工发布按旧结构读取。施工图固定 HEAD 与未提交叠加层，全部计划文件、接口、迁移、场景和验证映射到 IP-01～IP-08；不提交、不部署、不预建 verification。

RI-S1～RI-S6、RA-S1～RA-S7 的业务步骤和资料段至反馈的追溯链保留。依据为 `artifacts/业务链路约束与防御性设计审计.md` 及本会话已确认的五项产品决定：全部14项、现有差异权限、保留成果接续、确定性组合自动生效、下一业务动作撤权检查。
