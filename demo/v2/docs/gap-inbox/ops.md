# gap-inbox · ops（P-OP，C35）

> 本批实现中发现的新缺口提案。五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。
> 临时 ID 待主代理收尾时统一编号合并。

## GAP-OP-01（G2 契约字段）

- 缺口：系统管理六动作（create-account / disable-account / reset-password / open-project / suspend-project / revise-membership）在 29 个业务能力位与 53 个 branch 中无专属映射，且 system-administrator 的能力并集为空集，动作级三态门控没有可用的能力位信号。
- 依据：`demo/v2/src/app/contract-mirror.data.json`（systemAccessActions 与 branchCapability 无交集、roles["system-administrator"] 为空数组）；`packages/core/src/access/policy.ts:42-49`（SYSTEM_ACCESS_ACTIONS_V1）；`packages/core/src/access/schema.ts:120-143`（IdentityAdministrationCommandV1）与 :154-172（OpenProject / SuspendProject / ReviseMembership 命令）；页面实现 `demo/v2/src/pages/ops/widgets.tsx`（systemActionState）。
- 预设：P-OP-01 动作名严格取 SYSTEM_ACCESS_ACTIONS 六项；动作三态按「系统管理员身份」判定——capabilities 为 null 时 unknown（权限检查中），能力并集为空集（五预设角色中仅 system-administrator）时 allowed，其余角色 denied 并附视觉隐藏原因「需系统管理员身份」。GAP-015 的同类问题（项目管理四动作）用 engineering-data.write 近似，系统动作无任何可近似的能力位，故不用能力位近似。
- 待确认：系统管理动作的身份信号是否应由会话 / 角色显式传入页面（而非以空能力集代理），以及是否需要在契约中登记系统管理面（system administration）的授权通道。
- 风险：以「能力并集为空」代理系统管理员身份是原型期启发式；若将来出现其他空能力角色，门控语义会漂移。

## GAP-OP-02（G6 规格空白）

- 缺口：数据源适配器与连接定义（连接健康状态、检查记录、停用/检查动作）无契约记录与命令；contracts 仅在资料 descriptor 上引用 connectionDefinitionRef（entityId + versionId），连接自身的生命周期与健康投影无事实源。
- 依据：`demo/v2/src/content/project.ts`（SourceRecordFixture.descriptor 的 connectionDefinitionRef 用法）；`packages/contracts/src/ports/index.ts`（无 adapter / connection 管理命令）；页面实现 `demo/v2/src/pages/ops/DataSourcesPage.tsx`。
- 预设：fixture 自定义 DataSourceAdapterView（adapterId / pathway / deliveryKind / connectionDefinitionRef / status / checks / referencedBy），deliveryKind 严格取契约 SourceDeliveryKind 三值（file-upload / database-snapshot / api-snapshot）；连接运维动作（检查连接 / 停用连接）按 GAP-OP-01 的系统管理员三态门控。
- 待确认：连接定义与健康状态是否入契约记录，接入通路「实时多源监测数据 → 指标实际取值」的连接对象与资料交付通道是否分属不同 schema。
- 风险：连接状态口径（已连接 / 连接退化 / 未连接）若无契约约束，与监测接入的实际可用性判断可能不一致。

## GAP-OP-03（G6 规格空白）

- 缺口：模型部署与提示模板的版本登记（基础模型 / 微调权重关系、权重加载与回退语义、模板适用任务范围）无契约 schema；contracts 只规定调用侧引用 modelDeploymentRef / promptTemplateRef（VersionReference）。
- 依据：`packages/contracts/src/ports/index.ts:319-325`（AgentTaskRefV1.modelDeploymentRef / promptTemplateRef）；`demo/v2/src/content/ops.ts`（ModelDeploymentObject / PromptTemplateObject）；页面实现 `demo/v2/src/pages/ops/ModelVersionsPage.tsx`。
- 预设：fixture 自定义 ModelDeploymentObject（baseModelRef 指向原始权重部署，weightLoading 文案显式表达「微调权重与原始权重同时可加载、可回退」）与 PromptTemplateObject（taskScope 限定任务范围）；治理生命周期沿用知识域 GAP-020 的 draft / in-review / published / deactivated 预设；治理动作按 GAP-OP-01 门控。
- 待确认：模型与提示模板版本是否纳入知识治理生命周期（复用 knowledge-modeling 分支），还是设施域独立登记；微调权重与原始权重的并存/回退是否需要契约级引用结构。
- 风险：版本登记无契约约束时，运行记录中的 modelDeploymentRef / promptTemplateRef 无法回查版本元数据，影响重放与审计。

## GAP-OP-04（G6 规格空白）

- 缺口：备份策略、恢复点与恢复操作无契约 schema 与命令；恢复为危险操作，其确认交互与审计要求无规格依据。
- 依据：`packages/contracts/src`（无 backup / restore 相关 schema 与事件）；`demo/v2/src/content/ops.ts`（BackupPolicyView / RestorePointView）；页面实现 `demo/v2/src/pages/ops/BackupPage.tsx`（RestoreConfirm 两步确认）。
- 预设：fixture 自定义备份策略（versionedRef 呈现）与恢复点（建立时间 / 覆盖范围 / 校验状态）；恢复操作先经 GAP-OP-01 三态门控，再经页内确认交互（确认范围与后果勾选 + 确认 / 取消）才进入提交语义；恢复操作进入版本与操作审计（深链 P-RV-06）。
- 待确认：恢复点校验状态枚举、恢复命令的幂等与审计字段是否入契约；恢复确认交互是否固化为外壳级危险操作原语。
- 风险：恢复操作无契约命令与幂等约束时，重复提交与审计断链风险由实现侧自行承担。
