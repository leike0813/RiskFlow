# D-52 实施与生产授权预检（2026-10-15）

用户已批准[真实父调用身份提案](identification-start-authorization-scope-proposal.md)。内部启动命令增加issuedInvocationId/authorizationBranch，C30传真实父命令，C24先按真实来源复验，不再硬请求workflow.start-run。子运行稳定commandId、幂等载荷、输入时刻、准备、图版本和预算保持。

改动文件：core identification/graph/ports，worker risk-flow/graph及identification/graph/runtime，既有C24 fixture/runtime、C30 runtime和deployment entrypoints测试，当前change设计/施工图/局部规格与状态文档。C06/权限策略/依赖/迁移/UI未改。

## 验证

- 先在C24既有真实PG运行测试复现父恢复身份被错误改作启动分支，原失败保留。
- C24 runtime、nested-boundary、C30 runtime、deployment entrypoints四套202项通过。
- 新增D-52定向6项通过：真实父恢复身份与重投、错签发身份/分支/主体/工程零效果，以及部署原身份复验不请求另一分支。与上批有重叠，不累加。
- 8GiB build、typecheck、全仓lint、相关Prettier、strict44/0及diff通过。未重跑完整verify/browser/desktop。

## 真实预检与当前限制

在当前物理Chrome会话取得新鲜恢复授权后，以v58生产宿主和真实C06调用C24启动入口，在识别启动C03事务前安装定向拦截，捕获实际来源而不提交子运行业务事实。D-52真实父调用核验成功；捕获的来源分支为workflow.resume-run、invocationId与实际预检命令相同，能力只有workflow.resume。该拦截仅属于诊断宿主，不是生产源码或正式验收替代。

C24生产adapter只接受三个既有领域能力，原控制上下文不能继续领域读写。为保留原父预算，本轮没有执行已准备的正式父恢复脚本，没有消耗原父重试次数、登记子运行或创建模型/Agent任务。当前父游标仍`905945e60558ae62537c573790ca049b3d0de69f94958d891ca8ce8258fcee92`、identification/retryable-failure，任务数仍10，唯一五资料绑定仍1；同v57深比较保持。见[预检证据](identification-execution-authorization-preflight-v58.json)及[当前安全状态](identification-start-result-v58.json)。

后续完整接线范围见[D-53提案](identification-domain-authorization-scope-proposal.md)，待批准，未实施D-53源码。D-52调用身份修复已经完成，真实识别/评估终态尚未完成，整体tasks仍5/19。

当前API/Worker运行`functional-workspace-20261015-d52-v58`，HTTPS19443。制品SHA256 `20f3ddd694fa3da8edb62c711729f6aa711655e199cda5741bdd083dd9dfe2e5`、5756077字节。模型、策略正文、预算、检索输入及图版本同v57深比较不变，v55活动检索代际保持。实例business-chain-v58及logs保存预检、当前状态、制品身份；未提交、归档、创建verification或修改执行图/Orca。
