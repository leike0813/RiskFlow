# Agent任务列表实机读取故障

物理Chrome串行进入v87新任务深链，正式detail查询200/completed，但页面没有工具行动分区，持续显示读取任务列表。第一次截图等待期间主Agent提前启动续接，存在页面操作重叠；第二次完全串行仍复现，故不能只归因于该操作失误。两次失败均保留，不计UI通过。

第三任务的独立观察（实例logs/task-detail-d81-v87-3-observed.log及business-chain-v87/ui-read-observation-*.json）记录：engineering-data.context-read为200/succeeded，agent-task.read的list连续404/NOT_FOUND。因此工程读取已成功，故障在任务列表。

有界C09诊断logs/agent-list-scope-v87-origin.log：同一当前主体分别声明空范围、原空间、原25来源及两者组合，pageSize=25均404；同空间/来源下pageSize=1为200且hasNext=true。初次未带Origin的app.inject返回400，属于诊断输入不完整，不作生产故障证据。

logs/agent-list-cursor-v87.log继续以真实排序键验证生产编码和唯一Schema：第一页末任务标识103字符，游标370字符，Schema通过；第25项任务标识376字符，游标744字符，Schema报too_big，路径nextCursor。packages/core/src/agent-runtime/ui-read.ts的readCursor限制512，而PostgresAgentTaskAdapter将完整taskId编码进keyB；有后续页时列表结果解析失败，未知异常被安全收敛为授权拒绝，C09呈现404。未改变权限、历史任务或页大小来冒充修复。

AgentTaskDetailPage在list缺失分支没有呈现Provider已经保存的error，继续显示读取中，是独立的错误状态缺口。另有深链仅在当前列表页寻找完整引用的已知边界；本次列表尚未成功，不把分页未命中作为此次404根因。

当前先推进正式业务链，列表游标边界、详情页错误状态及深链定位尚未修正或验收。后续沿用户持续授权在当前change补充设计/施工图和既有回归，不增加列表全库扫描、不放宽权限或忽略失败。
