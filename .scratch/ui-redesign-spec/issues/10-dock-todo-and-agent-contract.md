# 停靠区待办的承载与「助手工作」数据契约

Type: grilling
Status: resolved
Blocked by: 05

## Question

票 02 已定复核队列与两种复核详情合并进停靠区待办；票 05 的原型把停靠区做成「待办 / 助手工作」双页签，**助手工作页签已有确定形态**（五类必经 Agent 任务全覆盖，展示工具行动 → 确定性校验逐项决定 → 资源预算 → 正式结果，只展示结构化过程不展示思维链）。但**待办页签与助手工作的数据契约仍未定**——原型里是写死的三条。

具体要回答：

1. **待办的数据来源**：待办要跨哪些业务对象汇总？原型里出现了复核候选、预警确认、校准建议确认三类，但票 02 的新导航里治理域还有「知识条目送审」「规则冲突复核」「系统管理动作确认」等也属复核决定（`openspec/specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md:416-421` 规定配置包冲突自动形成人工复核任务）。待办是全部 `复核任务` 的一览，还是按类型分组？
2. **排序规则**：按什么排？截止时间、风险等级、还是来源活动的时间顺序？有没有逾期的概念？排队中的复核等久了要不要升级提醒？
3. **点开后的形态**：在侧栏展开，还是弹全屏，还是跳到独立路由？票 02 定了复核详情合并成一个视图，但没说它从待办点开是什么形态。原型里识别候选复核有六个分支决定（`IdentificationReviewPage.tsx:43-46`），塞进 208px 的侧栏放不下。
4. **「助手工作」的跨域范围**：原型按 `projectId` 过滤（`AGENT_TASKS` 里有 `projectId: 'PRJ-001'`）。是只看当前工程，还是当前用户发起的跨工程任务？内嵌任务与交互任务是否都列？
5. **两页签的联动**：某个待办项若由某个 Agent 任务产出（例如「校准建议待确认」← AGT-001 校准建议候选），点待办时是否要同时定位到「助手工作」里那条任务？这正是 Agent 可追溯链条在界面上的闭环点。
6. **停靠区不可用时怎么办**：`forbidden` 与 `unavailable` 两个状态（票 04 的七态）下，停靠区显示什么？能力位不足（票 03 的 GAP-013）时会不会整块消失，还是显示无权占位？
7. **后端变更**：待办与助手工作的数据是否需要新的查询投影？现有 `PENDING_COMMANDS`、`AGENT_TASKS` 相关接口能否支撑跨类型聚合？属票 06 的范围，需要时回流。

## 票 06 已查明的前提（本票直接建立在其上）

来源：`.scratch/riskflow-master-plan/prototypes/backend-change-request-list.md`。

- **B-2 跨类型待办聚合查询（已确认必需）**：现有无任何跨类型待办查询——`ReviewQueuePageV1`（`packages/contracts/src/ports/index.ts:4479`）只覆盖复核任务，`warning-response overview`（`:5330`）只给计数。本票第 1 问的数据面已确定为新增投影，**排序与点开形态由本票定**。
- **助手工作任务查询面复用**：list/detail/actions/candidates/validation已存在，不再新增平行查询；但实体→关联任务反查仍按票09纳入B-4。工具身份与增量工件正文的实际展示字段须按现有读面确认，不以fixture假定齐全。
- **全部查询单工程**：查询信封强制 `projectId` 且与授权上下文一致性校验（`ports/index.ts:1013-1022`）。**本票第 4 问的"跨工程"选项在现架构下不可行**，除非新增能力位。
- **B-6导航授权核对**：按生产branch→capability→角色→会话逐项核对，不照搬v2全角色denied。两页签独立授权。

## Answer

产出资产：[停靠区待办与「助手工作」数据契约](../../riskflow-master-plan/prototypes/dock-todo-and-agent-contract.md)。

**待办收四类，分两个语义分组**：待你复核＝五类 pending 复核任务与未确认预警；待你执行＝真实待确认的 Agent 命令与未作决定的正式处置建议。生产取数依据、授权与验收以附件为准，`PENDING_COMMANDS` 等 fixture 不构成接口事实。

**排序**：按来源分组，组内风险等级降序（非风险对象允许缺省，排有等级条目后）→提交时间升序→精确主体引用稳定排序；无等级对象不得伪造等级，不新增逾期或优先级概念。

**点开形态**：保留 `/review-audit/tasks/:taskId?version=:reviewTaskVersion` 的同一全屏视图。页内为覆盖层，刷新/直达全屏；task-detail精确窄读历史，不扫描pending。右停靠22rem，左导航152px/48px。校准逐项查看校验，人工整体作 `approve-draft-creation` / `reject` / `return-for-revision`，不支持部分接受。

**权限与联动**：`review-todo.read` 仅控制入口，不授予任何域读写权。服务端对每个来源逐项沿原权限裁剪，并独立复验决定命令权限；不要求四域权限交集。reviewer 无 `agent-task.read` 仍能处理其有权复核。Agent 关联可选，返回引用、标记或存在性前独立验证 `agent-task.read`；无权时整个关联不返回。

**不可用态**：`forbidden` 只隐藏受限页签，不连带隐藏有权助手页签；`unavailable` 保留原因码。覆盖层内部完整呈现七态，失败不自动关闭；关闭恢复背景URL与焦点，切工程/注销清理。只允许短生命周期背景URL，不缓存业务正文。

**对票06的补充**：B-2 在成功读取真实状态后收录四类待办，命令必须有 `commandProposalRef` 及真实可确认状态；处置建议 decision 缺省只在读取成功时表示未决，服务故障不得变待办。风险等级与授权后的 Agent 关联均可选，原因摘要沿已有字段映射，不伪造。

**CH-2授权落点**：声明 `review-todo.read` 的 branch→capability→角色授予与会话能力传递；助手工作仍沿 `agent-task.read`。只交付公共接缝与授权，不提前取消旧承载；CH-9 新承载、权限、历史深链验收通过后原子切换。既有四web能力及platform shell用delta，仅新增design-system/dashboard/search-and-dock规格，不按九个工作包重划能力。

**助手工作查询面复用**：已有 list/detail/actions/candidates/validation；缺工具身份或工件正文时明确展示边界，不编造字段。待办到 Agent 的可选关联由 B-2／CH-9 随来源取数并独立授权；B-4 负责处置子记录到预警处置任务的精确关联，二者不混淆。
