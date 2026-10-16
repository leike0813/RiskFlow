# 独立合成纵向监测输入（D-91）

用户已持续授权验收必要修正。原72个case的单时刻记录及CSV/派生JSON差异保持，事实见monitoring-registration-entry-gap-2026-10-16.md；新增输入不冒充原测点历史。设计和具体数值以design D-91为准。

实例目录d91-monitoring-inputs/已保存同一独立合成情景的初始15点、补录1点、更正1点CSV和input-manifest.json生成规则。只绑定现有正式工程/空间，不推断物理测点。资料登记、转换、清洗、监测预置、批次和快照均须取得正式精确引用；输入自检不计业务PASS。

生成器generate-monitoring-inputs-d91.mjs按新建文件方式写入并自检成员、时间、数值及更正范围；baseline为3,851字节/9d770e9dbd4ed622b85e839d4d0346c9b2bf9174706590c6f9779bd51a4887c3，supplement为387字节/0b5f62c6c36912c648e15f5473fcf323b54ae7d8568d244d7a80499412def1b3，correction为447字节/cf30a83ef4c48924c0c42b8227191423f6191eca4bc56b5bbe504e96e457a735。现有Schema通过monitoring-prerequisites.json策略；复用原确定性计算的feature-self-check.json确认16格、初始覆盖率15/16且partial、补录后available、更正后available，完整原序列斜率0.4。以上均为输入自检，不是已登记快照。

provision-monitoring-inputs-d91.mjs的prepare已通过，三份metadata和put-config就绪。首次prepare误用fileName被strict Schema在任何业务写入前拒绝，已改用现有originalFileName；不修改产品Schema，也不把该脚本预检失败计作产品缺陷。

三来源及原生CSV转换已正式完成（logs/monitoring-source-provision-d91.log）：baseline=s_d634f87f4cae056358ca56e2a5aaf7ab@1，supplement=s_9b6b99a444a858cbf5215fae9842c42d@1，correction=s_0121fb220f2d26e031f977ca304a2039@1。C04完整读取与C11精确登记核对每份一个table段，分别192/24/24个tableFields；段和JSON-LD引用保存在converted-evidence.json，诊断前两次误读不存在字段的日志保留，不改产品工件。

原清洗允许质量列表未纳入本次原生转换引用，首次准备在任务前422拒绝；D-93新版本明确允许该质量引用、requiredSegmentKinds=table，保护类型及100%留存/覆盖不变。v99任务已创建，但26轮后因跨来源段请求终态失败，详见cleaning-read-progress-2026-10-16.md，不能计清洗PASS或静默重开任务。

D-94修复provision监测两步骤使用登记监测批次所属授权分支，既有参数化断言两项先红，修后20/20（/tmp/riskflow-d94-green.log）及lint/format通过。v100正式prerequisites-provision-report-d94.json两步COMPLETED：physical-d91-longitudinal-ground-settlement@1与physical-d91-longitudinal-availability@1。原AUTHORIZATION_DENIED报告保留；第一次CLI误用不支持的deployment-config导致参数缺失，在业务写入前拒绝，后按既有环境变量调用，无产品接口扩展。

sample-artifacts-prepared.json记录17个样本的NDJSON准备：每格与正式转换tableFields及原CSV逐项一致、原件摘要一致、真实资料段绑定，strict envelope/sample通过。仅写实例文件，尚未登记样本批次或冻结快照；清洗失败未绕过，评估/预测仍未取证。原模型/工具预算、质量、指标映射、预警阈值、评分/矩阵和历史结果保持。
