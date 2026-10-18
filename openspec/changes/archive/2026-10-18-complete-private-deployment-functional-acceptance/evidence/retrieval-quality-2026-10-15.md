# D-41 实现与真实检索质量结果

结论：D-41事务接缝已修复并实跑，真实质量报告为FAIL，完整功能验收仍未通过，tasks维持5/19。

## 实现与工程验证

- projection-handler的evaluate增加可选既有TransactionContextV1，构建时传入原消费者事务；部署质量门将同一上下文传至readGeneration。
- 质量门沿D-40的hybrid-evidence/retrieve上下文复验并请求Embedding，修正误用read的接线；C06策略、因果校验及范围不变，read-only仍拒绝。
- 复用既有真实PG夹具，验证未提交building在事务外不可见、无上下文质量读取失败、同事务读取通过、提交后可读；沿用质量失败不激活、拒权/漂移/超时/报告保存失败回归。
- D-36文件名校验增加单行eslint说明，保留ASCII控制字符和路径字符拒绝的原行为。

实际命令及日志：

- `pnpm exec vitest run apps/worker/test/retrieval/projection-handler.test.ts scripts/deployment/quality-gate.test.mjs packages/adapters/test/retrieval/postgres-retrieval-adapter.test.ts`：39/39；`/tmp/riskflow-d41-green-b.log`。
- 补retrieve接线后，前述三文件中加入`scripts/deployment/entrypoints.test.mjs`：4套件164/164；`/tmp/riskflow-d41-final-tests.log`。
- `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/composition.test.mjs apps/worker/test/retrieval/composition.test.ts`：166/166；`/tmp/riskflow-d41-composition.log`。各批次重叠，不累加。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`及`pnpm typecheck`通过；最终build日志`/tmp/riskflow-d41-final-build.log`，保留既有chunk体积提示。
- 全仓lint修正D-36说明后通过；最终质量门改动的定向eslint、Prettier通过。strict为44/0；最终工件补充后再校验。`git diff --check`通过。
- 红循环：`/tmp/riskflow-d41-red.log`。首个PG测试漏传既有必填transitionRef，补齐夹具后通过；能力回归红循环`/tmp/riskflow-d41-capability-red.log`，确认read不能代替retrieve。

## 实机发布与失败演进

实例根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。同源HTTPS仍为`https://localhost:19443`，物理Chrome沿原CDP会话。

三次新检索组合均通过正式提交、物理Chrome批准按钮及确认框，再独立发布：

| 发布证据目录 | 正式knowledge-release实体（均@1） | 构建结果 |
| --- | --- | --- |
| governance-publication-v28/retrieval-evidence-base | knowledge-release-b64edee1-ab8f-4b81-a07f-4ad8af9f88de | 事务读取已通过；manifest-projection-compatibility-mismatch，failed |
| governance-publication-v30/retrieval-evidence-base | knowledge-release-ee3bdce6-5aae-4ecd-94a7-e27c94aa9807 | 新策略冻结真实Qdrant兼容引用；authorization-rejected，failed |
| governance-publication-v32/retrieval-evidence-base | knowledge-release-25300233-5e03-4fa1-9795-70606523aa6a | 真实双路测量并耐久保存报告；召回门失败，failed |

隔离策略中原projectionCompatibilityRef是手工标签，与既有projectionCompatibilityRefFor基于Qdrant1.19.0/原向量配置所得身份不符。新v6/v7策略使用真实计算身份；未改算法、旧策略、标签、门槛或预算。

最新宿主身份：`functional-workspace-20261015-d41-v32`，配置`deployment-d41-v32.json`、清单`release-d41-v32.json`；制品SHA256 `b1d4d596a7097849cdf041057c9ede32fea1b6c7371da5548c8430931426aa28`、5740782字节，详见实例`d41-v32-workspace-identity.json`。API已切换，Worker单次消费后正常关闭，未常驻。

最新代际版本：`sha256:4a081157b4a218ce05d653364860d51d092d6279d361a4a33c2d9e0d86d25bdd`，实体为`retrieval-generation:synthetic-station-tunnel-project:knowledge-release-25300233-5e03-4fa1-9795-70606523aa6a`。实际读取状态failed，无活动切换。旧失败和投递次数未重置；日志中旧失败收据重放的projected字样不能当作ready/active证据。

## 正式质量报告

实例`logs/retrieval-quality/cf79aed1-4174-4c6b-a9d4-702dbfd58656.json`，安全副本见[retrieval-quality-v32.json](retrieval-quality-v32.json)，绑定dataset及acceptance策略`physical-20261015-v7`，合成样本、待甲方复核。

| 门禁 | 实测 | 原阈值 | 结果 |
| --- | ---: | ---: | --- |
| dense Recall@5 | 0.583333 | >=0.8 | FAIL |
| BM25 Recall@5 | 0.680556 | >=0.8 | FAIL |
| RRF Recall@5 | 0.583333 | >=0.9 | FAIL |
| RRF nDCG@5 | 0.869610 | >=0.8 | PASS |
| 双索引对账 | 1（15成员） | 1 | PASS |
| 授权泄漏 | 0 | 0 | PASS |
| Qdrant查询p95 | 50.670ms | <=2000ms | PASS |

6条查询、1次预热/3次计时；p95不含Embedding耗时。失败不激活，不能用排序较好掩盖召回失败。

实例`d41-v32-input-invariants.json`通过真实深比较确认：相较v27，固定query及grade完全相同，全部质量阈值、模型配置及retrievalBudgetPolicyRef相同。最终工件Prettier、全仓strict44/0及diff检查均通过。443仍无监听，HTTPS19443正常。

## 有界诊断与下一步

实例`quality-ranking-diagnostic-v32.json`只记录queryId、成员ID、名次和grade，不含资料正文或向量。风险机理和对应案例通常占据前两名；漏召回均为标准库条目。C17标准库Schema仅含名称、版本、clauseRefs、适用性和证据；当前投影没有条款证据正文，三项标准投影文本仅127–167字符。此为观测依据，不宣称正文补足必然通过。

Qwen官方示例对query使用英文任务指令与Instruct/Query格式，document保持原文本：<https://huggingface.co/Qwen/Qwen3-Embedding-4B>、<https://github.com/QwenLM/Qwen3-Embedding/blob/main/README.md>。诊断性前缀对比仍在同一failed集合、同模型/标签/阈值下执行，结果dense0.638889、BM250.680556、RRF0.625；不是正式报告，不激活且不替代原FAIL。不能据官方建议推断已满足本数据集质量。

后续涉及规范知识正文及查询指令的公共Schema/文件，需按新提案批准后实施。C11准备与原父运行绑定、RI/RA、C19适用规则集正式组装审核发布、同次functional、完整Electron及重启恢复均未完成。未提交、归档或创建verification。
