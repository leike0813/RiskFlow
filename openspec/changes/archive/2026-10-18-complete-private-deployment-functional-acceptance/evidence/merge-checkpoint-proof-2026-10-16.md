# 已登记I6的检查点证明（D-86）

v90b五工序I5完成，失败项为空。I6合并计划正式引用`merge-plan:synthetic-station-tunnel-project:identification-work-plan:synthetic-station-tunnel-project:identification-input-snapshot:synthetic-station-tunnel-project:identification-preparation-50efff5ad17336023281c241aba94e153465e03a@7810dfee842f9f429ec7eb0235d546c1a07e60fb52ca41b85be7c0fbfbe3726f`已经C03登记。子游标I7/running，父retryable-failure；实际图检查点仍I6。正式读取见`logs/validation-progress-v90b-after-5.log`。

只读诊断分别证明两处错误：`logs/merge-checkpoint-v90b-3.log`原候选证明沿同一调用读取不同工件时产生ARTIFACT_IDEMPOTENCY_CONFLICT；`logs/merge-checkpoint-v90b-4.log`仅为诊断隔离读身份后，正文严格Schema通过，却因C22工作计划汇总身份被与C24实际子运行混比而返回false。前两版诊断误以为失败检查点已有mergePlanRef、随后又误用阶段动作的冒号后缀筛选，分别断言失败，保留-1/-2日志，不作业务根因。全部诊断无模型、合并、检查点或领域补写。

修正仅涉及部署候选证明及其既有组合测试：读取身份从当前调用加精确工件身份/版本派生；MergePlan正文身份复用生产者唯一identificationRunRefFor按已核验工作计划重算。C24运行、输入与计划归属仍由上层原证明负责，原主体/权限/范围/完整性及所有精确引用继续核对。C22正文及历史记录不变。

原组合夹具改用真实C22身份构造，新增同调用跨工件和同工件重读用例；先红2失败/37通过（`/tmp/riskflow-d86-red.log`），修后39/39通过（`/tmp/riskflow-d86-composition.log`），保留错计划、错身份、撤权和正文损坏拒绝。

`logs/merge-checkpoint-d86-v90b.log`对同一正式I6引用执行原生产put引用验证，accepted=true，无人工修改检查点、模型或业务写入。后续关联回归与新发布后，通过公共恢复同一未终态批次；现有C24业务领先检查点恢复负责重建，不重跑已登记合并。正式I7及后续结果仍待取证。

继续核对下游发现同一身份问题还进入route-set、复核waitingRunRef和标准化记录，而正式run-read/record-read要求实际C24运行。范围内补齐C22合并与路由：复用已核验工作计划的inputSnapshot.identificationRunRef，缺省沿原构造；路由先精确读取并核对原输入，统一新路由、复核等待和后续记录，摘要纳入实际运行。现有v90b合并正文不改写，宿主仍在上层C24归属证明下读取其原汇总身份，新路由以冻结快照中的实际运行收口。没有新DTO/迁移/权限变化。

原恢复边界关联3套211/211通过（`/tmp/riskflow-d86-regression.log`）。核心既有路由用例参数化有/无冻结实际运行：真实红态为1失败/61通过（`/tmp/riskflow-d86-run-binding-red-2.log`），初版未定义fixture常量的技术失败另存原日志，不作产品故障。补齐后核心/组合102/102通过（`/tmp/riskflow-d86-core-composition-final.log`）。最终构建、宿主回归及同批公共恢复继续取证。

正式I6模型原响应和向量工件已存在，见`logs/merge-artifacts-v90b-after-5.log`：原响应sha256:911fd09e55866170fd688dca3b13270238b1dca64279e4a1b800bb60f6377e00、516861字节；向量工件sha256:bed2016f70c80fbaacaa9b513c1f1940b548581ba88efd9b0e7d2435d43d6361、517090字节。恢复不得重新调用此模型步骤或改写这些工件。

最终core/composition/entrypoints235/235通过（`/tmp/riskflow-d86-final-regression.log`），build/typecheck/lint/format/deps/strict44/0/diff通过。新发布`functional-workspace-20261016-d86-v91`制品5,770,561字节、SHA256 `9a6dfe032ea19a3e133ffba726be819aed2aee49cd799182779c5ea7e572b75a`，tar完整比较通过；模型/所有策略正文/预算/检索/图版本保持。已正常切换API/Worker并提交原父的公共transient-recovered恢复，回执及后续结果见`logs/recover-merge-d86-v90b.log`和原`business-chain-v90b/`新增文件，不计作整体验收通过。
