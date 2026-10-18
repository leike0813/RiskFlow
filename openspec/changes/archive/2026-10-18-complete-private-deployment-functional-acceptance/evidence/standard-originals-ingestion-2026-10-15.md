# D-43标准原文登记与转换预检（v37复验，D-43未完成）

结论：用户已批准标准原文补充。三份真实PDF已保存C04并正式登记C11；C04读取块覆盖缺陷已按D-44完成生产修复与实机多块复验，三份保留块拼接摘要与原件一致。v37新转换身份三份远端MinerU均done，但本地转换仍全部BLOCKED/TERMINAL_FAILURE，D-43未完成；后两项拒绝与空白页策略尚未批准/实施，父Agent正在核实，本文件不代下最终方案结论。新19文档清洗准备/发布未开始，原D-42检索代际仍failed，tasks保持5/19。

## 原件与来源

原件位于项目资料库standards目录，仅作用户授权的隔离验收输入，不据公开可访问推断再分发许可。来源URL、条款定位与历史/适用性限制取项目已有`standards/_index_part1_core.md`及仓库`sources.json`，正文不复制到本报告。文件只做元数据/摘要核对与正式受权导入；未使用既有parse镜像冒充本次转换。

| 来源                 | 页数 |   字节数 | SHA256                                                           | C11 source-version实体（均@1）     |
| -------------------- | ---: | -------: | ---------------------------------------------------------------- | ---------------------------------- |
| STD-001 GB50652-2011 |   99 |  5191182 | 5fe30dfae8d3cc5cb658980220c4e9fcd98163e8e067cfa4542cbe80f531df6f | s_0042162a3888997719ee7a82ab45a1ac |
| STD-002 GB50911-2013 |  189 | 10052478 | 1328780ab4d16871187a791262b6e6e31777bfb1cc34a22d3972c228449e4795 | s_96fa618451ed2b906c751425da66adc5 |
| STD-003 GB50446-2017 |  142 |  8965971 | 02d580f7e98de06e386f06d30c4d2d1ef042ef018fecc3f7c7713edc5a2e4858 | s_7ad7ac35ebb7c089a2ab5ca3f9d80058 |

输入身份位于实例根`standard-originals-v36/input-manifest.json`。三项C04 source/metadata put及C11 register均为COMPLETED。独立质量引用`physical-standard-original-v36-source-quality-STD-001/002/003@1`保留非空页比率1、关键字段覆盖1，资源政策及模型未扩大。

## v36实际拒绝与根因（历史）

转换身份分别`physical-standard-original-v36-convert-STD-001/002/003-convert`。对应`convert-report.json`均BLOCKED/TERMINAL_FAILURE，当前权限读取C04诊断工件确认serviceDiagnostic.failure.issue=header；没有远端raw-response，未把登记成功当转换成功。诊断工件实体为`conversion-diagnostic-`加上述转换身份，精确引用保存在实例inspection文件。

逐块立即复制的正式C04读取，与登记摘要及原件头完全一致；直接保留流块、EOF后拼接，与登记摘要不同：

| 来源    | 块数 | 保留块拼接SHA256                                                 | 即时复制拼接匹配登记 |
| ------- | ---: | ---------------------------------------------------------------- | -------------------- |
| STD-001 |    5 | c3783a11407c970045f2977007e56790dbace48bf423f74153bd6b88ad7c47bf | 是                   |
| STD-002 |   10 | 49c5ca20a43aec09c209859807ea703a22b85935c591f08f9c5972db60bed8dd | 是                   |
| STD-003 |    9 | 6d630251ba0abb418ea160a3501f4ae199f9b8e50f8468380a9df2ce5639b7c0 | 是                   |

`filesystem-artifact-store.ts`复用1MiB缓冲并yield视图，后续读覆盖前块；verified计算即时摘要，因此可成功，而保留块的调用方拿到错误内容。现有`collect`和生产转换器都会保留块。不是PDF原件头损坏，也没有证据表明存储对象损坏，禁止改原件或关闭完整性。

复现命令（实例根下）：`node assert-c04-multichunk-v36.mjs STD-001`，实际exit 1；`logs/c04-multichunk-assert-red-v36.log`。三份对照见`logs/c04-multichunk-v36.log`；正式诊断见`logs/standard-reasons-v36.log`。

首次实例脚本误加了SourceMetadata不支持的字段，被strict Schema正确拒绝；去除多余字段，来源及适用性完整保留在受限实例输入清单后，三份登记通过。未改生产Schema。诊断性converter.read误用evidence-access分支授权返回AUTHORIZATION_DENIED，不计作读取成功；拒绝原因以上述当前有权C04诊断读取为证。

## v37复验（D-44修复后）

三份以新转换身份重试，远端MinerU均done，本地转换均BLOCKED/TERMINAL_FAILURE（`logs/standard-conversion-v37.log`，priorFailureRetained与qualityAndBudgetUnchanged均true）：

- STD-001（`s_004216a3888997719ee7a82ab45a1ac@1`）：MINERU_QUALITY_REJECTED，serviceStage quality；非空页97/99（比例0.979798）、原门1、关键字段覆盖1、无缺失关键字段。诊断见`logs/standard-service-complete-v37.log`，空白页清单见`logs/standard-empty-pages-v37.log`。
- STD-002（`s_96fa618451ed2b906c751425da66adc5@1`）：MINERU_PROTOCOL_INVALID，format official-layout-3.4.4、detail layout-schema；官方3.4.4输出含不受支持的chart/chart_body/chart_caption（134处）。见`logs/standard-service-latest-v37.log`、`logs/standard-layout-shapes-v37.log`、`logs/standard-chart-fields-v37.log`。
- STD-003（`s_7ad7ac35ebb7c089a2ab5ca3f9d80058@1`）：MINERU_MIDDLE_INVALID，serviceStage normalize；issue table-html-tag-unsupported、location pages[20].blocks[7]、tag eq。见`logs/standard-service-summary3-v37.log`。

C04多块保留拼接复验：`logs/c04-multichunk-final-green-v37.log`的STD-001/002/003（5/10/9块）retainedMatches均true，与原件摘要一致；更早的`logs/c04-multichunk-green-v37.log`名为green但retainedMatches均false，不得作为成功证据。v36失败保留。修复提案及完成结果见[c04-stable-read-chunks-scope-proposal.md](c04-stable-read-chunks-scope-proposal.md)。

新宿主：`functional-workspace-20261015-d44-v37`，配置`deployment-d44-v37.json`、清单`release-d44-v37.json`；制品SHA256`03759fb26c7632e30d5195dfc18ea58c9d5406dba3bb711a5095f498dfd2a240`、5742296字节；API运行中、Worker停止；HTTPS 19443、系统443未占用。

## D-44安全结果与日志索引

修复仅让C04文件流每块交付独立字节，保留1MiB分块、有界读取、EOF完整消费、摘要、当前授权、审计、取消与verified时机，不新增API、依赖、迁移或HTTP；实机复验延续同原件、同质量/资源/模型预算的新转换身份；未输出原文、秘密或Cookie；旧失败、旧发布与failed代际保留；无提交、归档、tasks勾选或verification。日志索引：本机`/tmp/riskflow-d44-red.log`、`/tmp/riskflow-d44-regression.log`、`/tmp/riskflow-d44-{build,typecheck,lint,format,strict}.log`；实例`logs/c04-multichunk-final-green-v37.log`、`logs/standard-conversion-v37.log`、`logs/standard-service-{complete,latest,summary3}-v37.log`、`logs/standard-{empty-pages,layout-shapes,chart-fields}-v37.log`、`logs/api-d44-v37.log`；v36历史`logs/standard-reasons-v36.log`、`logs/c04-multichunk-v36.log`、`logs/c04-multichunk-assert-red-v36.log`。

## 下一步

D-43仍未完成：三份转换在本地阶段被质量门或官方layout解析拒绝（STD-001空白页质量门；STD-002官方3.4.4新chart类型；STD-003表内eq标签）；后两项处理与空白页策略尚未批准/实施，由父Agent核实后决定，本文件不预设方案。新的19文档清洗准备/发布未开始；原检索召回FAIL保留。当前API为d44-v37运行中，Worker停止；不提交、不归档、不创建verification。
