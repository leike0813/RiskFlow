# 规范检索正文与Qwen查询指令补充提案

状态：用户已批准，纳入IP-19 / D-42；生产实现、真实发布与复验已完成，质量仍FAIL，见[实跑报告](retrieval-semantic-content-2026-10-15.md)。

## 已确定的问题与边界

[D-41实际报告](retrieval-quality-2026-10-15.md)已取得真实质量FAIL：dense/BM25/RRF召回分别0.583/0.681/0.583，阈值0.8/0.8/0.9。逐查询缺失均为规范条目，原投影只有规范名称和clauseRefs等索引信息，没有已引用资料段正文。只加官方query instruction的独立诊断仍失败。

需要补规范正文参与检索的正式契约，不把期望答案、相关性标签、查询词或模型杜撰说明塞入文档。保持固定query、grade、TopK、原阈值、模型权重/维度、预算、权限、人工审核与旧发布；不增加reranker、依赖或迁移。规范历史失效状态与适用性继续保存，不把历史条款改为现行。

## 最小契约和实施方案

1. C17的StandardLibraryEntryV1Schema增加可选retrievalText。其值只允许由该条目现有evidence所引用、且在精确preparationSnapshotRef内的C11真实资料段正文确定性拼接；使用同一证据顺序与统一换行规则。没有正文时不制造摘要。正文来自现有受权readSegmentSlice/C04读取，原有单次/累计读取与成员字节预算仍生效，超限拒绝且不截断。
2. C17验证依赖增加窄checkStandardRetrievalText接缝，只核对该条目retrievalText与同一准备、当前权限、精确evidence对应的正文；缺读能力、错准备、越界、撤权、损坏或正文不符拒绝送审。复用PostgresIdentificationPreparationKnowledgeReader，不增加数据库/文件/网络通用工具。新正文随候选工件及原C16审核/独立发布固定；已发布对象不覆盖。
3. retrievalMemberText对标准库追加已验证retrievalText。构建、内容摘要与查询事实回查共用该函数；通过新规范发布、新检索组合及新策略产生新代际，不能改旧代际或Qdrant载荷来补正文。成员仍使用原standard entryId，测试标签只按新正式发布引用重绑。
4. HybridRetrievalPolicyV1增加可选queryInstruction（非空任务描述，实例固定英文单句，受原请求字节/token上限）。同一core函数渲染`Instruct: {queryInstruction}\nQuery:{queryText}`，正式检索与部署质量门共同调用；不传指令时使用原queryText。文档Embedding和BM25查询继续使用原文本，指令不得写入固定相关性数据集。新策略版本显式声明指令，禁止运行中切换。

## 文件所有权

- `packages/core/src/identification-knowledge/schema.ts`、`service.ts`及既有`packages/core/test/identification-knowledge.test.ts`：上述字段、验证依赖及行为。
- `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`、既有`test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`和同目录`fixture.ts`：复用精确准备/资料段读取装配，覆盖无正文、真实正文、撤权/错版/不符拒绝。
- `packages/core/src/retrieval/schema.ts`、`service.ts`及既有`packages/core/test/retrieval/retrieval.test.ts`；`packages/adapters/test/retrieval/hybrid-retrieval-service.test.ts`、既有`fixture.ts`：策略字段、共享渲染、规范投影与事实摘要一致，保留原不匹配拒绝。
- `apps/worker/src/retrieval/projection-handler.ts`、既有`test/retrieval/projection-handler.test.ts`与`scripts/deployment/composition/quality-gate.mjs`、`quality-gate.test.mjs`：只有确需联动时接共享逻辑，保留同事务读取及retrieve授权。
- 本change的proposal/design/implementation-plan、`specs/identification/process-model-mechanism-and-evidence-governance/spec.md`（C17）、`specs/identification/versioned-dual-index-hybrid-retrieval/spec.md`（C20）、handoff和证据；实例内新增候选、策略/发布配置与安全回执。无Web/Electron改造、contracts HTTP入口或业务决定变更。

## 验证与实机验收

复用上述既有core/adapter/worker/quality测试，验证正文具有真实来源且构建/回查一致、输入指令仅作用query、两处query渲染一致、预算/撤权/错版本/完整性失败不产生正式结果。build/typecheck/lint/format/strict/diff通过后冻结制品；使用原16资料准备及有权读取形成新规范候选，经物理Chrome人工批准、独立发布，再发布新检索组合并冻结同标签/同阈值的新引用数据集。

真实质量门仍独立判定全部7项；任何召回或其它门失败继续failed且不激活，不承诺补正文后必然达标。通过后才继续C11父运行准备绑定及RI/RA。C11因果绑定若需要新的契约/权限范围，再以实际证据升级，不能复用无关运行或伪造inputs-ready。

## 本次批准的含义

批准以上新增C17/C20公共Schema、验证窄口和文件范围，并继续实机验收；不批准降低质量门、改标签、扩预算、改写旧发布/失败或直接提交代码。

项目AGENTS.md §3和implementation-plan §7要求新增公共契约与计划外文件先升级，故在本提案批准前保留真实质量FAIL，不自行修改上述公共Schema。
