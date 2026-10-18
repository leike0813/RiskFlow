# 停靠区待办与「助手工作」数据契约

本表是「停靠区待办的承载与「助手工作」数据契约」票（`.scratch/ui-redesign-spec/issues/10-dock-todo-and-agent-contract.md`）的产出资产，属 UI 重做规格的一部分。承接票 05（原型形态）与票 06（后端变更 B-2 / B-6）。

## 待办来源与生产取数

四类来源在服务端按当前工程聚合，两个语义分组不改变原领域权限与命令：

| 分组 | 来源 | 生产取数判定 |
|---|---|---|
| 待你复核 | 五类复核任务 | 沿 `ReviewQueueRead` 的 pending任务；点击用精确 `review-audit` task-detail，不以队列查找替代详情 |
| 待你复核 | 预警确认 | 沿 warning-response 目录及详情的真实确认状态；已确认不收录 |
| 待你执行 | Agent命令确认 | 沿真实Agent命令提案/确认记录，必须返回 `commandProposalRef`、真实状态及当前可确认动作；只纳入仍待用户确认且未终结提案 |
| 待你执行 | 正式处置建议 | 沿 recommendation读面，读取成功且 decision 缺省才视为未决；已有采纳/拒绝决定不收录 |

`PENDING_COMMANDS`、`AGENT_TASKS`、`adoptionDecision` 等fixture名不是生产契约依据。CH-9须明确生产查询接线及字段映射；服务故障、超时或拒绝不得以空decision伪装未决事项。

## 排序与返回字段

按来源分组，组内风险等级降序→提交时间升序→精确主体引用（kind/entityId/versionId）稳定排序。非风险对象风险等级允许缺省，排有等级条目后；不为命令或知识复核伪造等级。不设逾期或优先级。

返回类型、精确主体引用、摘要、可用原因、真实状态与提交时间；风险等级可选并沿风险原事实，Agent关联可选且须独立授权。已有 `triggerReason?` 等先逐字段复用，确缺字段才扩原Schema。命令来源必须保留 `commandProposalRef`，不能仅靠Agent任务引用发起确认。

## 权限与两页签

`review-todo.read` 只授权聚合入口，绝不授予领域读写。每项来源沿既有复核、预警、建议、Agent命令各自权限先裁剪再计数/排序/分页；写动作再次复验本域命令权，不要求四域读取权限交集。

reviewer在 `core/access/policy.ts:22-44` 刻意无Agent读权，仍可读取/决定其获准复核。返回「由助手产出」、Agent引用或关联存在性前单独验证 `agent-task.read`；拒绝时整段关联不披露，不影响复核正文。助手工作页签独立沿 `agent-task.read`。

`forbidden` 只隐藏受限页签，有权的另一个页签继续显示；两页签均无权才收起停靠区。`unavailable` 保留位置与原因码，不解释为零条待办。

## 全屏复核与精确URL

保留 `/review-audit/tasks/:taskId?version=:reviewTaskVersion`；`version` 是复核任务身份版本，不是业务目标版本。页内打开为全屏覆盖层，刷新/直达为同视图全屏。用 `readReviewTaskDetail(projectId,{kind:'review-task',reference:{entityId:taskId,versionId}},signal)` 精确窄读；已决定/已替代历史任务不依赖pending队列，沿返回状态与actions只读或决定。

识别保留原六类类型化决定。校准逐项查看确定性校验结果，人工整体作 `approve-draft-creation` / `reject` / `return-for-revision`（`ports/index.ts:2329-2338`）；逐项人工部分接受不是现有能力。

左导航152px/48px，右停靠区22rem。全屏用于复杂复核而非声称右栏仅152px。窄宽/缩放可手动收起两侧，内容局部滚动；不按64rem改13rem导航或右栏下沉。

覆盖层内完整呈现票04定义的七态，沿其既有枚举，不新增状态；失败保留视图、URL与原因，不自动关闭。关闭/取消/浏览器返回恢复合法短生命周期背景URL与焦点，否则回 `/overview`；刷新不依赖背景状态。切工程/注销清理背景URL及当前请求状态，不缓存业务正文。

## B-2 / B-4 / CH-2交付边界

- **B-2（CH-9）**：服务端四来源聚合，按原域逐项裁剪；生产状态、稳定排序、可选风险等级、独立授权Agent关联及上述精确URL一起验收。
- **B-4（CH-7）**：复用四类正文及正式记录，核对处置子记录到预警处置任务的精确关联，已有公开引用则复用，实际缺口才补窄读。待办到 Agent 的可选关联仍属 B-2／CH-9，二者不是同一种任务。
- **CH-2**：落实新 `review-todo.read` 的branch→capability→角色授予及会话能力传递，复用 `agent-task.read`；只交付公共接缝，不提前取消旧队列/详情。各业务CH新承载、权限与历史深链验收通过后原子切换。既有四web及platform shell用delta，新design-system/dashboard/search-and-dock仅承载新行为。
- 精确source resolve能由现端口满足就复用；不另建通用转换器或重复接口。助手任务list/detail/actions/candidates/validation继续复用；工具身份与工件正文不足不编造。

## 验收场景

1. 只有入口权、本域缺权：该域条目、计数及存在性均不披露；有权其他来源正常，不失败为全域交集。
2. reviewer无Agent读权：复核可读可决定，无助手产出标记或引用；Agent关联读取拒绝不能阻塞复核。
3. 待办forbidden但助手有权：只保留助手页签；助手forbidden不隐藏有权待办；查询故障显示不可用而非待办或零条。
4. 同组同风险同时间条目按精确主体引用稳定翻页；无风险等级排后且不渲染伪风险徽标。
5. 命令缺 `commandProposalRef` 或已确认/取消不得成为可提交待办；建议读取失败不得被当作decision缺省。
6. 已决定复核精确URL直达/刷新可读，不扫描pending；覆盖层报错保持打开，关闭恢复背景URL/焦点，切工程/注销清理。
7. 校准逐项校验可看但无部分接受按钮；只提交整体三类决定。
8. 桌面1280×720、1440×900、1920×1080在100%/200%缩放下正文可折行、关键控件不裁切，可收起左右区且局部滚动。

## 保留风险

聚合接线与生产状态映射尚待CH-9实现；本次只定契约，不宣称聚合已存在。工具身份/工件正文的展示边界仍须沿实际读面确认，不展示模型思维链。合成报告与验收材料继续标注合成。
