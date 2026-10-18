# 合并嵌入批量和输入预算（D-85）

D-83能力绑定与D-84修正数量已修。新批次前沿v88原18条已校验风险事件进行独立诊断，正式网关在任何上游HTTP前拒绝：MODEL_INPUT_INVALID / request.input-budget。原部署maxBatchItems=2，请求18条；没有实际模型调用或向量、领域写入。日志`logs/i6-real-embedding-d83-2.log`保存稳定错误；第一次日志`i6-real-embedding-d83.log`保留映射缺少耐久诊断引用的外层错误，不据此称上游失败。

当前隔离配置原检索部署保持；为短风险事件合并增加独立部署别名，maxBatchItems=32，覆盖5项×4条=20条。原16KiB输入、40960上下文、模型版本/摘要、2560维、服务身份、超时及响应限额保持。新版本candidate/graph策略仅联动引用，旧运行、检索部署、检索代际与质量门不变。

同时发现网关把Embedding序列化请求总字节当作正文预算。扩既有成功用例，正文恰好12字节时原代码报MODEL_CONTEXT_EXCEEDED，先红1失败/8通过（`/tmp/riskflow-d85-red.log`）。修正使用共享正文UTF-8计数；完整序列化请求独立受原部署字节上限限制，保守token估算仍用完整请求。参数化正文、完整请求及批量超限均拒绝，零HTTP/零工件；网关12/12通过（`/tmp/riskflow-d85-gateway.log`）。

D-84关联6套296/296通过（`/tmp/riskflow-d84-regression.log`），其build/typecheck/lint/format/deps/strict通过。D-85新增源码和新部署尚需最终门禁、18条实际嵌入诊断及新业务批次；不能计I6或整体验收通过。

D-85最终关联4套177/177通过（`/tmp/riskflow-d85-regression.log`），build/typecheck/lint/format/deps（695模块、2340依赖无违规）/strict44/0/diff通过。v90准备预检因projectBindings.policyRefs未同步而拒绝，保留`logs/stage-d85-v90.log`及对应失败输入；补齐绑定后另建v90b，装配通过，没有覆盖失败输入或运行旧配置。

发布`functional-workspace-20261016-d85-v90b`，制品6,016,134字节、SHA256 `e8a5b92f7aa8912639aee08bb26ef37b089248e455b85f059a39f391d0c0d17a`，tar完整比较当前运行文件通过。原模型与检索配置保持，合并专用32条及策略引用差异经自检，其他数值预算和图版本保持。

`logs/i6-real-embedding-d85-v90b.log`记录独立诊断：使用当前C06合并授权及新专用部署，真实18条短风险事件返回18个2560维向量，实际inputTokens=123；原响应耐久引用`model-diagnostic-merge-8e1fc391-7e12-44f5-b1c6-cb5ecd2f7b20:embed-model-raw-response@sha256:1c1cdc9a98a907dfe41effd61cfe2a42ce69ef7dcc7ecb1d47369bee088bbbed`。止于DIAGNOSTIC_VECTOR_WRITE_BLOCKED，没有向量工件或领域写入；这是一次明确独立的实际模型消耗，不能充作正式合并结果。正式新批次仍须另行完成I6及之后阶段。
