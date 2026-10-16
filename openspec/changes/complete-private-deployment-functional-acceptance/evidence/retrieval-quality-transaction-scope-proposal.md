# 检索质量读取事务接缝补充提案

状态：用户已批准，纳入 IP-19 / D-41；实现与实跑结果另行记录。

## 实跑依据与根因

D-40修复后，新组合 `knowledge-release-4f7ec838-549a-4d35-bdac-f415616a06aa@1` 已经物理Chrome批准并独立发布。v25正式Worker消费走过授权、知识精确读取、真实embedding、Qdrant写入及双索引对账；质量门返回 `QUALITY_GATE_FAILED/generation-not-found`，本代未激活，不计通过。原事件、投递及失败仍保留。

C20投影在C03消费者事务内创建building代际，并在同一事务内调用质量门。生产质量门通过另一个PostgresRetrievalAdapter、默认连接读取代际，看不到尚未提交的同事务记录。测试替身总能返回代际，未覆盖这一真实隔离边界。

## 最小修正

为现有 `HybridRetrievalBuildQualityGateV1.evaluate(input, context?)` 增加可选的既有 `TransactionContextV1` 参数；投影handler将当前C03消费者上下文传入。生产quality-gate把同一个上下文传给 `generationStore.readGeneration`。无上下文的独立已提交代际测量保持原调用方式。

这只是同一事务的类型化窄读传递，不增加事务、不拆分提交、不让检查点或客户端提供代际、不暴露数据库句柄。质量门继续精确核对工程/发布/策略/成员/模型/清单/权限，实际测dense、BM25、RRF及对账、泄漏与p95，报告耐久保存成功后才可ready/激活。不得改成只信输入manifest或跳过代际读取，也不改阈值、标签、预算或原失败。

补入文件：

- `apps/worker/src/retrieval/projection-handler.ts`及既有`apps/worker/test/retrieval/projection-handler.test.ts`：传递原事务上下文，回归同事务building代际可读、事务外不可见及失败不激活。
- `scripts/deployment/composition/quality-gate.mjs`及既有`scripts/deployment/quality-gate.test.mjs`：质量读取沿原上下文，保留身份漂移和质量拒绝边界。
- 当前change的design/implementation-plan、检索能力局部delta及执行证据；不改归档主规格。

不增加HTTP/业务DTO、依赖、数据库表或迁移，不修改C03事务语义。验证上述真实PG/质量门回归、build/lint/format/strict/diff后冻结新制品；已失败代际不重写为成功，后续走新正式发布并按真实引用冻结同阈值数据集，再取真实报告。

## 批准点

项目AGENTS.md §3及施工图§7要求计划外接口/文件先升级。D-40的授权与图版本批准不包含此质量门接口和文件范围，故单独提请批准。父图恢复节点名缺陷位于已批准graph.ts范围，按原恢复契约继续修复，无须重复授权。
