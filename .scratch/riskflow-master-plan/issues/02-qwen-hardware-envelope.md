Type: research
Status: resolved
Blocked by: none

# 确定目标硬件下的 Qwen 模型部署包络

## Question

在单张 RTX 4090（24GB）与 128GB 主机内存的最低配置上，经 `llama.cpp` 私有部署 `Qwen3.8-27B` 时，哪些 GGUF 量化级别、上下文长度、并发和多模态/工具调用能力可作为现实基线？`Qwen3.8-Flash-Next` 需要什么升级条件，哪些结论必须留待实机基准验证？

## Answer

最低配置的现实基线候选是 `Qwen3.8-27B Q4_K_M`、文本、单并发槽、32K 总上下文、F16 KV Cache、关闭 MTP。Q8/BF16 不能全 GPU 驻留；64K、双槽、视觉、KV 量化和 MTP 均应作为独立实机验收项，当前没有依据承诺吞吐。`Qwen3.8-Flash-Next` 的理想 4-bit 权重下界约 90GB，且 llama.cpp 支持仍在未合并 PR 中，只能列为升级候选；生产评估需先跨过软件成熟度、显存/主机卸载容量与完整 SLO 验收门槛。

完整推导、来源和验收矩阵见 [目标硬件下的 Qwen 模型部署包络](../research/02-qwen-hardware-envelope.md)。
