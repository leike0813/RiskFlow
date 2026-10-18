# D-35 实现与实机清洗取证

用户批准定位分页、行动额度与失败实际结算，并明确要求按现代 Agent 的实际工作量提高新任务预算。技术预算不是甲方业务批准；运行中没有自动扩容，旧失败、预算和来源均保留。

## 正式结果

实例根 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。v9 任务为 `agent-task:synthetic-station-tunnel-project:data-cleaning-task-a968bf3d16c9fcddbecbce46a46ee456e2e5cdae@1`，模型仍 MiniMax-M3.1-Flash-Preview/schema-prompt/low，清洗提示、工具和预算版本均为 `physical-20261015-d35-v1`。

任务正式 completed；14次模型调用、13次工具调用、输入59445 token、输出3126 token、累计上下文62571 token、输入135802字节、输出39184字节、候选1、对象326，修正/瞬态重试0，活动墙钟72400ms；全部预留清零。输入占冻结131072上限约45.4%，没有在运行中提高上限。

原命令 `physical-governance-documents-cleaning-20261015-v9` 重放返回准备快照 `identification-preparation-a968bf3d16c9fcddbecbce46a46ee456e2e5cdae@1`。正式结果工件 `data-cleaning-result-a968bf3d16c9fcddbecbce46a46ee456e2e5cdae@sha256:1a660429366e6d2a7916007d61a4625a896efc8b79bfba0b5e52905574adc877` 经当前账号 C06 授权、真实用途 open、完整消费及 verified，并通过原 DataCleaningResultV1Schema。16输入全部 available、595段全部保留、整体覆盖1、排除0；sourceVersion集合与原命令相同。

另经受权 C04 核验冻结清单及16份 JSON-LD，62个合成治理材料项均能匹配到本次保留的段定位；最终按转换结果的headingPath定位整项正文，避免把其他项中的交叉引用误当本项来源。映射只使用合成业务 JSON 与登记资料，不使用 expected/scenarios。证据分别在 `governance-cleaning-v9/`、`governance-publication-v10/evidence-map-by-heading.json`；最初文本匹配版保留。物理 Chrome `DISPLAY=:0` 自然点击本次任务行、刷新后显示“已完成”，截图 `chrome-cleaning-v9-success-confirmed.png`；首次加载瞬时失败截图保留，未伪装为成功。资料目录显示21份清洗可用（原五格式加治理16份），另1份早期转换失败来源保留；截图 `chrome-documents-21-cleaned-v10.png`。

## 新预算

| 任务 | 累计输入 / 输出 / 上下文 token | 模型 / 工具调用 | 墙钟 |
| --- | --- | --- | --- |
| 清洗 | 131072 / 32768 / 196608 | 40 / 64 | 30分钟 |
| 知识编制 | 196608 / 65536 / 262144 | 24 / 48 | 30分钟 |
| 处置建议 | 65536 / 32768 / 131072 | 16 / 24 | 20分钟 |
| 校准建议 | 65536 / 16384 / 98304 | 12 / 16 | 20分钟 |

字节、对象、候选、修正与重试上限固定在 `data/policies/catalog-d35-paged-budget-v9.json`；同任务并发仍1。清洗一次生成最多8192输出token，网关结构化单次上限32768；累计预算与单次输出分开约束。五格式与16治理资料的原质量引用、保留比例1及模型权重不变。

## 工程验证与制品

core/model、共享Agent、runner、真实C08数据库、清洗core/Worker与真实C15数据库、network/llamacpp网关及部署入口的定向回归通过；不把重叠批次累加成全仓测试数。最终清洗两套件47项、C15数据库32项通过，日志 `cleaning-d35-post-final.log`、`cleaning-store-d35-post-final.log`。最终全仓build通过，日志 `build-d35-post-worker-final.log`；早期build之后的辅助改动已重新构建。相关ESLint/Prettier通过；全仓OpenSpec strict44/0，日志strict-d35-post-evidence.log。完整deployment20套件413项通过，日志deployment-d35-full.log；完整browser仍在运行，日志browser-d35-full.log，最终结果另行记录。

v9制品 SHA256 `21f4df26edf0e61ec8309fa24f4a5e382ccee4b90b5f4179dcf2b437f34df7cc`，3182792字节。辅助Agent最后的边界/计量/去重改动晚于v9打包，因此后续使用新发布 `functional-workspace-20261014-d35-final-v10`，制品 SHA256 `d0e2b2df0e7eabd079789fffa711d4ac7a256c45ebb43d8f63dab2d279f29ed8`，3181937字节。v9完成回执保持其原身份，不被v10覆盖。API/Worker已经SIGTERM正常关闭v9并启动v10；HTTPS仍19443，系统443 Caddy保持关闭。

codeCommit仅实际HEAD `31ad1a2c47a377f20179e0008241034c14a3bec5`，dirty与包摘要在各workspace-identity文件记录；尚未形成Git检查点、提交、归档或创建verification。清洗成功不证明治理发布、检索、RI/RA、其余Agent、Electron、恢复及完整functional报告通过；tasks仍1/14。
