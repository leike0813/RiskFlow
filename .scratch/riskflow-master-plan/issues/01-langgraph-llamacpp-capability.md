Type: research
Status: resolved
Blocked by: none

# 核实 TypeScript LangGraph 与 llama.cpp 的能力边界

## Question

基于当前官方文档与一手源码，TypeScript `@langchain/langgraph` 和 `llama.cpp` 是否完整覆盖 RiskFlow 所需的子图组合、持久化检查点、暂停/恢复、人工复核、流式事件、结构化输出、工具调用和 OpenAI 兼容服务？哪些限制必须进入宏观架构与验收标准？

## Answer

TypeScript LangGraph 完整覆盖 RiskFlow 所需的编排能力，可锁定为唯一编排核心；生产实现必须使用数据库型 checkpointer、稳定 `thread_id` 和幂等节点，并把检查点与业务入库分开。`interrupt` 恢复时会从节点开头重跑，前端事件也应转换为 RiskFlow 自有协议。

llama.cpp 覆盖同步/流式 Chat Completions、JSON 约束和工具调用的基本能力，但官方不承诺完整 OpenAI 兼容；默认 JSON Schema 仅支持子集，工具调用依赖 Jinja 模板/解析器，因此所有结构化结果与工具参数仍须通过共享 Zod Schema 复验。

Qwen3.8-27B 沿用 `qwen3_5` 架构，当前 llama.cpp 源码存在转换与执行路径，可作为默认实机验收目标，但 Qwen 官方尚无该组合的 llama.cpp/GGUF 生产配方。Qwen3.8-Flash-Next 使用当前 llama.cpp 未实现的 `qwen4_exp` 新架构，暂不进入首发基线。

完整逐项依据、架构约束和验收清单见：[TypeScript LangGraph 与 llama.cpp 能力边界核查](../research/01-langgraph-llamacpp-capabilities.md)。
