# 知识发布续验与C19批准点（2026-10-15）

## 当前状态（续验至v22）

用户已批准[适用规则集入口及合成来源策略提案](applicable-rule-set-entry-scope-proposal.md)，D-39的contracts/HTTP、组装适配和部署接线已实施，已使用隔离合成来源新策略继续评分治理。C19评分规则submit接线中的`input.command.projectId`已修为`input.projectId`；C20独立retrieve与identification-basis读取授权已修。本轮已有生产实现变更，原文“未修改生产代码”“待批准”“尚未实施”仅属于下方v14–v16历史阶段。tasks仍为5/19，8.1未完成，尚缺真实适用规则集组装、人工审核、独立发布及assessment-basis。

三条评分规则已正式提交，在物理Chrome完成复核并独立发布。第二、第三个检索组合也已正式发布；发布事实如下，版本均为1：

| 发布对象 | release | 实例根下证据目录 |
| --- | --- | --- |
| 三条评分规则 | knowledge-release-69769351-165e-4439-81c9-ab8b31450835@1 | governance-publication-v17/scoring-rules/、governance-publication-v18/scoring-rules/ |
| 第二个检索组合 | knowledge-release-73655ae6-e721-41ae-9902-1873ae9bbc40@1 | governance-publication-v19/retrieval-evidence-base/ |
| 第三个检索组合（物理Chrome批准发布） | knowledge-release-f3951652-22eb-4b5d-918d-a0e729526c4d@1 | governance-publication-v21/ |

已核对v18与v19的`release-result.json`及`decision-ui-response.json`；三条规则、第二个组合的正式发布与人工决定回执均保留。v17保存登记、提交及诊断历史，v18保存修订、复核、决定与独立发布。第三个组合及以下最新运行、检查状态以父Agent本次补充为事实来源。上述发布不等于适用规则集发布、检索质量或RI/RA通过。

当前API已切`functional-workspace-20261015-c20-v22`，tgz SHA256为`63f968a5deb5e610b498aa1617254200c1816e467963127eb02a0dcea23ad873`，5738759字节。worker22因诊断探针已正常停止，父Agent继续恢复，以实时状态为准，不记为常驻。此前v20冻结配置为`functional-workspace-20261015-c20-v20`；其`release-c20-v20.json`、`c20-v20-workspace-identity.json`与实物tgz核对一致：SHA256 `6fadff238ba17fe81d398a61240ce9e36b901312cbd58eac11994c5a0187497e`、5738838字节。实例根仍为`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。

v20数据集只重绑第二个精确新发布与风险机理、规范、案例三个真实成员，不改标签或阈值，见`retrieval-bindings-c20-v20.json`；最新数据集v3也只重绑引用。`retrieval-generation-v20-1792036348977.json`仅记录generation引用，尚未取得正式generation结果或质量报告，不计通过；检索审计200但活动为空也不证明检索成功。旧v19事件已因原授权过期耗尽，失败为`SESSION_EXPIRED`，不改写旧事件。新v21事件在worker22仍失败，原异常`DeploymentAuthorizationError / DEPLOYMENT_AUTHORIZATION_DOWNSTREAM_REJECTED`由父Agent诊断，未见真实检索终态。

C30正式`workflow.start-run`曾多次返回HTTP 503、`PostgresPersistenceError / CHECKPOINT_INCONSISTENT`，见`business-chain-v19/graph-repro-1792035975599.json`、`graph-repro-1792036231431.json`与`graph-repro-1792036254393.json`。已定位C03 `readWorkflowRunBinding`要求`action=command_kind`，与真实workflow启动审计动作`workflow.start-run-bound`不符。用户已批准[启动绑定修正提案](checkpoint-start-binding-scope-proposal.md)扩文件清单，父Agent已修并回归；基础22项、C30/部署157项及8GiB全build通过。基础测试先红后绿记录为`/tmp/riskflow-start-binding-red-20261015.log`与`/tmp/riskflow-start-binding-green-20261015.log`，相关回归和构建日志为`/tmp/riskflow-c03-regression-20261015.log`、`/tmp/riskflow-c03-build-20261015.log`。

修后新命令v21先503、重放返回`existing`，实际登记行仅完成`preparing`，run-state到`identification`；尚未取得等待或业务终态，不能称实机复验通过。正式`projection.query`与`result-read`均200，但`items`为空，不计成功业务证据。原context过期不是HTTP时间错误，试改已撤回，不记录为时间修复。

既有269项定向tests、81项C19/API和146项deployment tests为分批重叠结果，不累加；新增基础22项和C30/部署157项同样不与这些批次相加。8GiB全build最新已通过，其余checks只按实际完成回执记录，不预写成功。原HEAD仍为`31ad1a2c47a377f20179e0008241034c14a3bec5`加dirty，无提交、归档或verification。

新投影原事件探针进一步定位：C06 `assertCommandCause`硬限identification-basis，拒绝hybrid-evidence；不是数据库写权限不足。父图`graphStateOf`另把入口摘要写入图版本，因而准备阶段提交后仍被精确检查点校验拒绝。[两项修正提案](projection-authorization-and-graph-version-scope-proposal.md)已提交用户批准；不放宽检查点或绕过C06，API运行、Worker暂时停止以保留重试机会。既有C30 runtime测试夹具补入真实的启动图版本检查后，原“命令身份绑定先于图调用”用例从waiting变failed，已形成同根因红循环，见`/tmp/riskflow-graph-version-red-20261015.log`；修正前保留该失败，不沿用前批157项绿灯作为最新全通过结论。

仍未闭合：8.1的正式规则集与assessment-basis、新检索事件授权失败、generation与质量报告、C30等待/业务终态、RI/RA、其余Agent、同次functional、完整Electron及恢复证据。任务完成数保持5/19。

## v14–v16历史记录（原段保留）

以下保留当时运行与失败事实；其中待批准、未实施、5/18及v14宿主等表述不代表当前状态。

本轮按用户要求优先业务链路，未打磨UI、修改生产代码、提交或归档。API/Worker沿用`functional-workspace-20261014-original-agent-v14`，物理Chrome仍使用`https://localhost:19443`。实例根为`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。

## 新成立的业务事实

复用v9正式清洗准备及v10的`evidence-map-by-heading.json`，将批准合成包的证据替换为同项真实保留段；工序模型使用上轮正式发布。三份知识经既有provision/C04登记、C17提交、C07复核，在物理Chrome自然点击批准和确认，再通过C16独立发布。未使用模型替身或数据库播种结果。

| 类型 | 正式knowledge-release实体，版本均为1 |
| --- | --- |
| risk-mechanism | knowledge-release-0a6b0606-31f6-4001-98f2-6f5c727f9886 |
| standard-library | knowledge-release-9f5ba464-59af-4747-bc73-f6df4f0b5237 |
| case-library | knowledge-release-dbf33d14-919f-4f06-a18f-3e650a541504 |
| retrieval-evidence-base | knowledge-release-3f45fe07-9d01-4e84-8b59-738a7c603b2e |

三成员完整回执在`governance-publication-v15/knowledge-members-completed.json`及各类型子目录；组合在`governance-publication-v16/retrieval-evidence-base/`。组合精确引用上述三个发布，仍复用全部16来源声明。`decision-ui-response.json`保存真实确认结果，`release-result.json`保存独立发布回执；组合页面截图为`visible-publication.png`。

正式`knowledge-modeling.governance-read/current-release-set`返回200及五类真实发布，见v16的`current-release-set.json`。既有`knowledge-modeling.identification-basis`正式命令成功返回原工序发布、上述风险机理发布、上述检索组合及`physical-identification-graph-policy@physical-20261014-v1`，见`identification-basis-result.json`及同目录冻结请求/回执。这证明发布事实可进入识别基础解析，尚不证明双索引质量、识别或评估终态。

## C19真实预检与待批准范围

评分配置包已从实际登记资料重建3条规则、33个真实来源段，固定当前工程修订、C18配置集合、现评分策略和兼容版本；阈值、等级和业务含义保持原包。只排序适用性集合并替换本地占位引用，不修改仓库原始合成包。

当前评分策略只接受`national/industry/enterprise`，对材料真实标记`synthetic-scoring-rule-values`返回`scoring-rule-source-kind-invalid`。`governance-publication-v15/scoring-configuration-package/policy-preflight.json`记录该拒绝；`package-prepared.json`是受控实例中的待用包，尚未登记或发布评分规则。内存预览新策略允许该明确合成类别后内容校验accepted，`proposed-policy-preview.json`明确`PREVIEW_ONLY/approved=false/applied=false`，不是运行策略批准或业务PASS。

代码核查确认：评分包可沿既有provision与治理HTTP继续；适用规则集`assembleApplicableRuleSetRevision`没有正式contracts/HTTP/CLI入口，部署回调仍抛不可用错误。待批准的精确范围见[组装入口提案](applicable-rule-set-entry-scope-proposal.md)。未实施新公共契约或更改来源类别策略。

## 保留的失败与实际限制

- 组合首次provision因临时输入的父工件/证据集合未规范排序，在工件put前被strict Schema拒绝。v15原失败报告保留；修正输入后以v16新身份成功，不修改provision生产实现。
- 自写查询首轮遗漏HTTP信封的两类范围数组，返回400；补齐后正文查询仍404。v16的`release-read-probe.json`记录后者，不计正文查询通过。
- 读面目前只定义部分类型正文DTO；规范、案例、检索组合不在正文DTO联合中，不为此次验收临时扩展。风险机理属于已有DTO，但读面使用`identification-knowledge-package`，C17正式候选用途为`identification-knowledge-candidate-package`，C04用途严格匹配使该读取关闭失败。此已定位读面缺陷尚未修复，不能通过扩大C04用途或伪装无权绕过。独立current-release-set和C17业务基础解析已实际通过，不用404否定已提交发布，也不用发布回执掩盖读面失败。
- C19组装入口和合成来源策略等待本轮用户批准；RI/RA、检索代际/质量、其余Agent、同次functional、完整Electron及恢复证据仍未完成，任务保持5/18，不勾选3.1或3.2。

执行入口为实例中的`publish-knowledge-members-v15.mjs`、`publish-retrieval-composite-v15.mjs`（组合成功输出到v16）、`prepare-scoring-package-v15.mjs`；各脚本采用真实权限和所属模块，秘密仅从受限文件读取。诊断脚本不替代正式业务入口。新生产代码为零，不重复运行上轮build/全仓verify；本轮只对更新文档执行格式、change strict和diff检查。
