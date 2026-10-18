# D-42 实现与真实质量复验

结论：D-42生产实现已完成并实跑，真实检索质量仍FAIL。tasks保持5/19，3.1、3.2、8.1未完成。

## 实现与验证

C17标准库条目增加可选retrievalText；验证依赖和生产精确准备reader增加checkStandardRetrievalText。经当前C06授权、正式C15准备及清洗结果核对证据资格，按准备清单中的精确JSON-LD读取真实段正文，完整消费C04并等待verified。正文按evidence顺序、每段textBlockIds顺序以换行拼接；读取受原4MiB单次及累计上限约束，不截断。错工程、准备、版本、保留段、正文、读取失败和撤权均拒绝。缺字段的旧条目保持原语义。

C20共享retrievalMemberText纳入已验证正文，用于投影、摘要及事实回查。策略可选queryInstruction只作用查询Embedding，正式检索和部署质量门共用渲染；文档Embedding和BM25仍使用原成员文本及原查询。两条C17校验路径（提交与Agent候选）均已接线。

实跑还发现质量门的查询工件幂等键只有工程和queryId。新策略文本与旧测量发生MODEL_IDEMPOTENCY_CONFLICT（artifact.idempotency）。在已批准的quality-gate文件范围修复：每次真实模型调用使用独立invocationId，并让idempotencyKey与其一致；不重用旧调用或改C04幂等契约。既有测试补两次测量不能复用工件身份；v34旧失败保留。

实际检查：

- C17 core/真实PG：57/57通过。
- C17、core/adapter retrieval、worker projection、quality gate、entrypoints七套件355/355通过；日志`/tmp/riskflow-d42-regression.log`。
- 质量门调用身份修复后handler/quality/entrypoints三套件156/156通过；`/tmp/riskflow-d42-idempotency-tests.log`。各批次重叠，不累加。
- 最终补充确认读取失败测试实际到达工件读取分支；C17真实PG与质量门两套件39/39通过，`/tmp/riskflow-d42-final-tests.log`。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck`、全仓lint、format通过；OpenSpec strict为44/0，diff检查通过。日志`/tmp/riskflow-d42-build.log`、`riskflow-d42-typecheck.log`、`riskflow-d42-lint.log`、`riskflow-d42-format-final3.log`、`riskflow-d42-strict-final.log`。
- format首次发现既有原件reader导出格式及临时Playwright YAML格式，均仅以apply_patch按Prettier修复；随后一次遇到CodeGraph临时锁消失，重跑通过。构建保留既有chunk体积提示。

## 实机身份与正式结果

实例根仍为`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`，物理Chrome通过原CDP会话在`https://localhost:19443`点击批准及确认框，之后独立提交发布。未绕过人工决定入口。

- 新标准发布：`knowledge-release-f2d5e92d-8dfe-4421-87c2-dfb1dcedc171@1`，3条成员，实例证据目录`governance-publication-v33/standard-library`。
- v34组合发布：`knowledge-release-96d8f3b1-aa7c-4b06-a68f-fb3e70232d18@1`；代际`sha256:89cb9deb64e8a30c1034f334f26bccf3b159079df8af92c965a2ca03cad98a4c`因查询Embedding幂等冲突failed，无活动切换。
- 修复后v35新组合：`knowledge-release-9f27b513-9919-4f5a-8e10-93a761cc3277@1`，实例`governance-publication-v35/retrieval-evidence-base`。
- 当前宿主：`functional-workspace-20261015-d42-v35`；配置`deployment-d42-v35.json`，清单`release-d42-v35.json`；制品SHA256`8fa5b775718da6ebb60bd334ae1bf902fee9947f64efac11fb45375fbbeb31c6`，5991070字节。
- v35代际：`retrieval-generation:synthetic-station-tunnel-project:knowledge-release-9f27b513-9919-4f5a-8e10-93a761cc3277`，版本`sha256:357578036d60a015b59c8a428aee5af95b4089189cb5a311240948cbe03b045c`，正式读取为failed，无activation。API运行，Worker单次消费后已正常关闭。

实例`d42-v35-input-invariants.json`实际深比较确认：query/grade、全部质量阈值、模型配置及retrievalBudgetPolicyRef与v32相同。新策略v9仅承载本轮指令/精确引用变化，不修改旧策略。旧事件有SESSION_EXPIRED/事务失败，均未算作本轮成功。

## 正式质量报告

原始安全报告`logs/retrieval-quality/f34b849a-1053-4485-8d9d-e9703681bad5.json`，仓库安全副本见[retrieval-quality-v35.json](retrieval-quality-v35.json)。合成样本、待甲方复核。

| 门禁           |     v35实测 |   原阈值 | 结果 |
| -------------- | ----------: | -------: | ---- |
| dense Recall@5 |    0.638889 |    >=0.8 | FAIL |
| BM25 Recall@5  |    0.763889 |    >=0.8 | FAIL |
| RRF Recall@5   |    0.666667 |    >=0.9 | FAIL |
| RRF nDCG@5     |    0.890574 |    >=0.8 | PASS |
| 双索引对账     | 1（15成员） |        1 | PASS |
| 授权泄漏       |           0 |        0 | PASS |
| 查询p95        |    51.347ms | <=2000ms | PASS |

## 剩余输入问题

[standard-retrieval-provenance-v35.json](standard-retrieval-provenance-v35.json)只记录引用、条目ID和字节数。经受权C04读取核对：现有3条标准各引用8个段，正文分别758/751/855字节，是standard-library.json转成DOCX后的字段序列化，只有条目ID、名称、条号、适用性和本地证据键；没有完整条款正文。D-42精确校验已经正确读取这些真实内容，不能凭空补写更丰富条款。

`sources.json`虽然列出STD-001/002/003的标准来源、定位和适用性摘要，它们尚未作为本次16份准备内的独立原文来源正式登记。原条款中已废止及仅适用标准断面的限制必须继续保留。新的原文输入、转换、准备、清洗和知识发布需要显式扩展验收输入范围；不能拿查询、标签、模型摘要补齐，或将无关来源绑定进原准备。

下一步提案见[standard-source-ingestion-scope-proposal.md](standard-source-ingestion-scope-proposal.md)。C11父运行绑定、RI/RA和完整功能验收继续未完成，不提交、不归档、不创建verification。
