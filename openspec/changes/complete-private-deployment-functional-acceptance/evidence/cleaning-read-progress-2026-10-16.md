# 清洗读取进度诊断（D-95）

v99任务agent-task:synthetic-station-tunnel-project:data-cleaning-task-26e5b7e9a7176f9682e0f5ceaa3dee3cd0fda2f9@1在26次模型/26次工具后终态AGENT_INPUT_INVALID，stage=worker.cleaning.document-slice.segment；输入88,224、输出3,851tokens，候选0、修正0、重试0，未超预算。原资料和边界校验保持，旧终态不复活。

read-cleaning-actions-d95.mjs在当前授权下完整读取原agent-action-result，证据为logs/cleaning-action-history-d95.log与d91-monitoring-inputs/cleaning-v99/action-history-proof.json；26个模型工具请求只有9种不同载荷。目录与正文重复，第51行动用baseline来源请求三来源的段ID，第52工具行动拒绝。只提取工具事实，没有读取或导出思考内容，无模型/领域补写。

runner的AgentModelStepContextV1仅传previousObservationArtifactRef，恢复与正常继续均缺累计读取事实。按design D-95用同任务原行动账本重建有界completedToolCalls，C15按冻结输入确定性投影completedReads；不另建状态，不强制跳过模型或放宽工具边界。尚未实施或取得新任务正式结果。
