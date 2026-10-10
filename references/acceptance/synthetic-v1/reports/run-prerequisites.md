# 正式入口试运行前置

材料已经生成不等于业务已经执行。运行工具不提供工件上传替代实现，也不将包内模拟引用当成目标环境引用。操作人在单独的本地配置中填写凭据和真实绑定，配置不得提交或作为报告附件。

准备顺序如下：

1. 在已有正式环境建立独立测试工程，固定工程版本、空间范围和适用性三维数据，授予测试账号所需权限。记录回执，确保不指向生产工程。
2. 通过该环境的受权材料通道导入原始输入文件、资料元信息、知识候选和监测原始数据。绑定真正的工件引用、来源连接和监测序列。当前 HTTP catalog 没有上传操作，这一步缺失时保持阻塞。
3. 先用开发集调试。试运行集原始资料在开发冻结后单独导入；禁止导入 `expected.json`、验收表、场景索引和报告作为模型上下文。文件格式的不同投影属于同一资料家族，不能算独立样本。
4. 通过知识治理入口提交并申请审核。模拟配置和候选知识须经实际人工决定后发布，保存决策引用和不可变版本。准备 Agent、检索双索引、流程图和重试策略的正式版本。
5. 逐场景运行，绑定真实 sourceVersion 和 spatialScope；有监测依赖时绑定监测快照及适用性快照。调用 `workflow.start-run` 只说明运行已创建，不能据此证明风险识别或评估完成。
6. 从当前授权的精确业务读取入口核实终态。识别结果为零时，需要完整运行终态和候选收口证据；仅空页、超时或缺引用不算负例正确。再核实评分、预警、人工采纳、执行反馈和版本重放。

本次核对的公共入口均来自 `apps/api/src/http.ts` 的 `HTTP_ROUTE_CATALOG_V1`，构建导出为 `apps/api/dist/index.js`。工程操作格式为 POST `/api/v1/projects/:projectId/{commands|queries}/<branch>`。操作 ID 按 `riskflow_<mode>_<branch 中的点替换为下划线>` 生成。载荷仍以公共 requestSchema 为准，不能自行增添材料字段。

| 用途 | 已有 branch | 回执边界 |
| --- | --- | --- |
| 注册资料 | engineering-data.register-source-delivery | sourceDeliveryRef、sourceVersionRef，不表示转换完成 |
| 注册监测 | engineering-data.register-monitoring-batch | monitoringBatchRef，不表示预警完成 |
| 知识候选/审核 | knowledge-modeling.submit-revision / request-review | knowledgeRevisionRef / reviewTaskRef，不表示批准 |
| 发布已批准知识 | knowledge-modeling.publish-approved-release | 须使用实际 reviewDecisionRef |
| 识别与评估流程 | workflow.start-run | workflowRunRef，不表示流程成功终态 |
| 查询运行视图 | projection.query，payload.queryType=run-view | queryResultRef，需再读取结果 |
| 精确投影读取 | projection.result-read | 授权投影；完整页和业务终态仍需逐项核实 |
| 识别、评估、处置详情 | risk-identification.run-read / record-read、risk-assessment.read、warning-response.read | 具体结果与上下文版本，依公共 Schema 读取 |

报告只保存安全引用和状态。接口失败立即停止；超时可能发生在命令已被服务端接受后，继续时必须使用同一命令和幂等键。输入包、目标、账号、绑定或计划有变化时另建输出目录，不覆盖旧记录。凭据更新需要重新登录，但不得将密码写入 checkpoint。

内部探索性比较只在真实结果、完整分母和候选预期均可核验时进行。当前未执行的 72 个语义场景及额外边界用例保持“未执行”，准确率、重放率等保持“不可计算”。正式质量发布还需要甲方审核后的数据和标签。
