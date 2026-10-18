# 独立合成纵向监测输入（D-91）

用户已持续授权验收必要修正。原72个case的单时刻记录及CSV/派生JSON差异保持，事实见monitoring-registration-entry-gap-2026-10-16.md；新增输入不冒充原测点历史。设计和具体数值以design D-91为准。

实例目录d91-monitoring-inputs/已保存同一独立合成情景的初始15点、补录1点、更正1点CSV和input-manifest.json生成规则。只绑定现有正式工程/空间，不推断物理测点。资料登记、转换、清洗、监测预置、批次和快照均须取得正式精确引用；输入自检不计业务PASS。

生成器generate-monitoring-inputs-d91.mjs按新建文件方式写入并自检成员、时间、数值及更正范围；baseline为3,851字节/9d770e9dbd4ed622b85e839d4d0346c9b2bf9174706590c6f9779bd51a4887c3，supplement为387字节/0b5f62c6c36912c648e15f5473fcf323b54ae7d8568d244d7a80499412def1b3，correction为447字节/cf30a83ef4c48924c0c42b8227191423f6191eca4bc56b5bbe504e96e457a735。现有Schema通过monitoring-prerequisites.json策略；复用原确定性计算的feature-self-check.json确认16格、初始覆盖率15/16且partial、补录后available、更正后available，完整原序列斜率0.4。以上均为输入自检，不是已登记快照。

provision-monitoring-inputs-d91.mjs的prepare已通过，三份metadata和put-config就绪。首次prepare误用fileName被strict Schema在任何业务写入前拒绝，已改用现有originalFileName；不修改产品Schema，也不把该脚本预检失败计作产品缺陷。

三来源及原生CSV转换已正式完成（logs/monitoring-source-provision-d91.log）：baseline=s_d634f87f4cae056358ca56e2a5aaf7ab@1，supplement=s_9b6b99a444a858cbf5215fae9842c42d@1，correction=s_0121fb220f2d26e031f977ca304a2039@1。C04完整读取与C11精确登记核对每份一个table段，分别192/24/24个tableFields；段和JSON-LD引用保存在converted-evidence.json，诊断前两次误读不存在字段的日志保留，不改产品工件。

原清洗允许质量列表未纳入本次原生转换引用，首次准备在任务前422拒绝；D-93新版本明确允许该质量引用、requiredSegmentKinds=table，保护类型及100%留存/覆盖不变。v99任务已创建，但26轮后因跨来源段请求终态失败，详见cleaning-read-progress-2026-10-16.md，不能计清洗PASS或静默重开任务。

D-94修复provision监测两步骤使用登记监测批次所属授权分支，既有参数化断言两项先红，修后20/20（/tmp/riskflow-d94-green.log）及lint/format通过。v100正式prerequisites-provision-report-d94.json两步COMPLETED：physical-d91-longitudinal-ground-settlement@1与physical-d91-longitudinal-availability@1。原AUTHORIZATION_DENIED报告保留；第一次CLI误用不支持的deployment-config导致参数缺失，在业务写入前拒绝，后按既有环境变量调用，无产品接口扩展。

sample-artifacts-prepared.json记录17个样本的NDJSON准备：每格与正式转换tableFields及原CSV逐项一致、原件摘要一致、真实资料段绑定，strict envelope/sample通过。仅写实例文件，尚未登记样本批次或冻结快照；清洗失败未绕过，评估/预测仍未取证。原模型/工具预算、质量、指标映射、预警阈值、评分/矩阵和历史结果保持。

## v106 正式登记与冻结

D-99新清洗任务与D-100准备收口已完成，精确身份及预算见[续办证据](resume-after-reduction-2026-10-16.md)。v106通过既有provision artifact-put登记三份样本，严格用途为engineering-data.register-monitoring-batch，工件版本分别等于sample-artifacts-prepared.json内的SHA-256；evidence绑定各自正式来源/段。未扩展provision或产品接口。

随后在物理Chrome当前会话通过正式HTTP依次登记original、supplement、correction，后两者priorBatchRef串接前一批；每批立即同身份重放，引用不变。每次登记后冻结cutoff=2026-10-16T00:00:15.000Z、原16秒策略，分别取得：

| 阶段 | 批次ID后缀 | 快照ID后缀 | 正式可用性/覆盖率 |
| --- | --- | --- | --- |
| 初始 | 2e141849fdc46bcb58840b0039a9359d | 74707c6d6c0ccbf4dbd69e7c0e575e75a9498818 | partial，15/16 |
| 补录 | d1897cd584490f0c4faa6996147df373 | 7addd5ec89f5ea0fff7b657ebd26d4cf0255dee8 | available，16/16 |
| 更正 | 038e2ead70992b1d5af4c7bbee4819aa | 5fee2da0d0dc5dd8d095e5519a834f736b72f647 | available，16/16 |

批次完整前缀为monitoring-batch:physical-d91-longitudinal-ground-settlement:，快照前缀为monitoring-snapshot:，版本均1。查询使用engineering-data.monitoring-snapshot-query取得queryResultRef，再经engineering-data.read-result读取正式快照正文；首次脚本误用无此查询路由的monitoring-snapshot得到404，已修正脚本，未改产品。

三份正式快照均16格，初始缺点不插值、频谱因连续点不足而unavailable；补录后频谱available。更正后末点7.0→6.8、斜率约0.40→0.36 mm/s、加速度约0→−0.06 mm/s²。最后逐一复读三份旧快照，与各自首次正文全等；catalog亦已正式读取。原工件、批次与快照未覆盖。

现场脚本put-monitoring-samples-d91-v106.mjs、register-monitoring-d91-v106.mjs均通过自检；samples-put-report-v106.json、registered-{baseline,supplement,correction}-v106.json、registered-monitoring-summary-v106.json及逐命令/查询回执保存在受限目录d91-monitoring-inputs/。这是监测局部实机证据，评估/预警/预测及完整业务仍未取证，不能据此勾选完整任务3.2。

物理Chrome已显示更正后末点6.8、覆盖率100%、三批次及证据定位，七个页面查询均200；截图physical-monitoring-v106.png及请求元数据physical-monitoring-v106.json已保存。视觉复核另观察到统计值直接显示浮点尾数，部分指标卡片向右溢出；业务数值与正式快照一致，显示精度/布局问题留待IP-21界面收口，不把该截图视为完整UI通过。
