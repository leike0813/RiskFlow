# 已提交I6阶段恢复（D-87）

用户持续授权必要修正，范围归IP-19/IP-21。v90b五项I5和I6已提交，公共恢复后父子均终态，子错误为I7的merge-plan-missing；保留原事实、模型消耗和失败，不恢复该终态。对应实例日志为logs/recover-merge-d86-v90b-2.log及logs/validation-progress-v90b-d86-recovery.log。

## 根因与修正

advance把阶段正文和游标同事务登记，但游标缺省lastStageResultRef，rebuildCommittedState因此不读取I6的mergePlanRef。恢复改从同工程、同运行、同游标runVersionId的唯一stage-result登记取精确正文，核对原阶段和完整运行身份，再走现有C04及检查点引用证明。缺失必需登记、多义或错配拒绝，不重跑已提交合并。正常等待/终态重放忽略缺省指针；运行中断仍对账续接，保留已有pendingWrites可读场景。无候选I6直达I9保持原行为。

源码限apps/worker/src/identification/graph/runtime.ts；扩现有runtime.test.ts与fixture.ts。无公共DTO、迁移、依赖、权限、模型预算及历史定义变化。

## 复现与验证

原failCheckpointPutAt只能模拟检查点正文失败，pendingWrites仍可读，不能单独复现本次故障。既有夹具新增按业务动作提交注入：I6事务提交后，首次put及putWrites均失败，其余仍走真实PostgreSQL与LangGraph实现。未修恢复构造时，`pnpm exec vitest run apps/worker/test/identification/graph/runtime.test.ts -t I6`在/tmp/riskflow-d87-red-exact.log精确得到terminal-failure，目标后续状态未达到。此前按次数9/10的尝试尚未形成I6登记，不作有效复现。

原批次只读证明见实例logs/registered-i6-d87-proof.log：旧I7游标版本1ec1351038164d4d19a7dd64fa58fce2691104844616664e1d15fc8974cddafd精确匹配一份I6登记，原mergePlanRef版本仍为7810dfee842f9f429ec7eb0235d546c1a07e60fb52ca41b85be7c0fbfbe3726f。当前仍I7/terminal-failure，无模型、业务或检查点补写，不计业务PASS。

## 回归发现与D-88

首轮完整C24回归39/44通过，四项拒绝场景因恢复构造把自身CHECKPOINT_INCONSISTENT当作上游错误交给分类器而落为CONTRACT_INVALID；改用既有TERMINAL_FAILURE与checkpoint-inconsistent映射，四项缺失/多义/错运行/正文错配随后通过。原控制/嵌套/父图3套53/53通过。

另一次恢复/取消竞争出现两个终态效果。扩既有竞争用例，在恢复通过入口检查后暂停其下一效果、先完成取消、再释放恢复；/tmp/riskflow-d88-red.log稳定复现cancelled后又completed。D-88在graph.ts的共享readStageCursor拒绝已登记终态，I0–I9与错误收口共用；VERSION_CONFLICT直接向上返回，不追加失败覆盖。保留C03锁/版本核验及原终态回执。

修后/tmp/riskflow-d88-boundaries-green.log为8/8关键边界通过：I5/I6恢复、四类无法证明的阶段结果拒绝，以及自然/确定性恢复取消竞争。I6到人工复核waiting并保留原mergePlanRef，合并仅一次；正常重放不新恢复。正式新批次尚未执行。

最终/tmp/riskflow-d88-final-regression.log为4套98/98通过；另11项边界/tmp/riskflow-d88-final-boundaries.log通过。build/typecheck/lint/格式及OpenSpec strict44/0通过，依赖695模块/2340条无违规，diff检查通过。回归期间发现普通VERSION_CONFLICT不应统一穿透，已仅对run-already-terminal穿透，其余保留既有错误收口；三个原有失败用例已在最终全量内通过。

API/Worker已正常SIGTERM从v91切至functional-workspace-20261016-d89-v95，配置deployment-d89-v95.json/release-d89-v95.json，日志logs/api-d89-v95.log及worker-d89-v95.log。制品sha256为146e0b6820ce4b0c93f062d2c026a3a4f5b55c4b196d2ef9af170c53acbab840，6,021,298字节，tar完整比较通过；模型、策略正文/预算、检索与图版本不变。未部署v92/v93/v94保留不覆盖。

新v95通过公共workflow.start-run返回202/knowledge-preparation；正在绑定原正式识别准备，后续结果以正式回执为准，不据启动计PASS。工程或诊断通过不能替代正式功能验收。任务仍5/19，不创建verification、不提交或归档。
