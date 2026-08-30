Type: research
Status: resolved
Blocked by: 14

# 核实 TypeScript 私有化数据与检索组件

## Question

基于官方文档、源代码与许可证，哪些可私有部署组件能够在 TypeScript/Node.js 栈中承担业务关系数据、LangGraph checkpointer、事务事件、对象文件、监测时序、向量检索、BM25 与图查询；它们在单机 4090/128GB 基线上的能力、运维成本和组合限制是什么？

## Answer

MVP 的事实基线采用 PostgreSQL 作为唯一业务事实源，复用独立 schema 的官方 LangGraph Postgres checkpointer，并以同事务 Outbox 驱动 Qdrant 检索投影；Qdrant 同时承担相互独立的稠密向量与真正 BM25 索引，所有证据正文、版本和审计仍回查 PostgreSQL。原始资料先使用本地不可变内容寻址目录，批量监测先用 PostgreSQL 原生分区，工序风险图先用关系边表与递归 CTE。

`pgvector + pg_textsearch + 中文 parser` 保留为单数据库备选，不与 Qdrant 默认双写。TimescaleDB、OpenSearch、ParadeDB、Apache AGE、Neo4j、MinIO 和独立对象存储均已有明确的延后、升级或移除条件。正式选型仍须以中文工程语料检索质量、Outbox 新鲜度与重建 RTO、128GB 主机资源竞争以及 PostgreSQL PITR 与文件备份组合恢复的实机结果为准。

完整事实、许可证、候选比较、恢复边界和验收门槛见：[TypeScript 私有化数据与检索组件核查](../research/19-typescript-data-retrieval-research.md)。
