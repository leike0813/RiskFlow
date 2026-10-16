# I6嵌入能力绑定修正（D-83）

用户持续授权验收必要修正，无需逐项确认。范围属于IP-19/IP-21，源码与既有测试各一份，不改变公共契约或权限策略。

实机v88的五个工序均已完成I5，failedWorkItemRefs为空，随后I6与父运行均终态；驱动停止，不复活旧运行。精确结果见实例`logs/validation-progress-v88-during-5.log`。

模型及业务写入前屏障复现见`logs/i6-embedding-entry-v88.log`：C22已解析原五份校验集和18条候选，当前合并授权只含`risk-identification.finalize`，Worker嵌入请求却要求`risk-identification.run`。唯一请求Schema在requiredCapability拒绝；裸ZodError被现有图分类为unrecognized-port-failure。这解释了原运行没有I6模型原响应或向量工件。诊断没有调用模型、保存向量或提交领域结果。

修正使嵌入请求、向量C04保存及错误映射固定使用finalize；生成及其错误映射保持run。没有从授权列表择取能力，也不绕过当前C06复验。既有运行时成功用例改用仅finalize授权并执行真实EmbeddingRequestV1Schema，附仅run拒绝；错误映射用例参数化模型错误与权限拒绝。

先红：`pnpm exec vitest run apps/worker/test/identification/candidate-finalization/runtime.test.ts`，1失败/8通过，与实机相同的requiredCapability Schema错误，见`/tmp/riskflow-d83-red.log`。修复后运行时10/10通过，见`/tmp/riskflow-d83-runtime.log`。

修后沿原五份候选再次入口屏障预检，`logs/i6-embedding-entry-d83.log`确认18条候选请求Schema及当前授权均通过，止于DIAGNOSTIC_EMBEDDING_BLOCKED；仍没有模型或业务写入，不能计正式I6通过。工程回归、制品与新批次后续结果另记，不以此诊断替代正式业务验收。

关联回归11套346/346通过，涵盖核心候选、Worker候选/识别父子图及完整链测试、部署宿主，见`/tmp/riskflow-d83-regression.log`。build/typecheck/lint/全仓format/deps（695模块、2340依赖无违规）/strict（44/44）/diff通过，日志`/tmp/riskflow-d83-*`；新增证据稿另经Prettier检查通过。

v89新发布`functional-workspace-20261016-d83-v89`，制品6,015,973字节、SHA256 `64d3426d30cdcdb72df82879f20c5429696121f65681bef7efb6c667877f33fc`。模型、所有策略正文、预算、检索输入及图版本与v88深比较保持。正式新批次不得复活旧v88；独立新命令与证据保存在`business-chain-v89/`。
