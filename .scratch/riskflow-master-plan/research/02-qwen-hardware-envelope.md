# 目标硬件下的 Qwen 模型部署包络

研究日期：2026-08-27

## 结论

在“单张 RTX 4090（24GB 显存）+ 128GB 主机内存 + llama.cpp”这一最低配置上，现实基线应锁定为：

- 主模型采用 `Qwen3.8-27B` 的 `Q4_K_M` GGUF。ggml-org 官方转换的主模型文件为 19GB；同仓库的 `Q8_0` 为 28.6GB、BF16 为 53.8GB，后二者无法全部驻留 24GB 显存。[ggml-org 官方 GGUF 仓库](https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF/tree/main)
- 首轮部署验收以**文本、单并发槽、32K 总上下文、默认 F16 KV Cache、不启用 MTP**作为候选配置。这里的“候选”只表示容量上合理，仍需在目标主机上确认峰值显存、吞吐和稳定性。
- 64K 可以作为第二档实验配置，优先测试量化 KV Cache；128K 及 262K 不进入最低配置的交付承诺。模型原生支持 262,144 tokens，不等于单卡 llama.cpp 能以可接受延迟稳定服务该长度。[Qwen3.8-27B 官方模型卡](https://huggingface.co/Qwen/Qwen3.8-27B)
- 并发默认排队，`--parallel 1`。`--parallel 2` 只作为“每槽 16K、总上下文 32K”的验收候选；不能在未测量前承诺并发吞吐。
- 图像理解、工具调用和 MTP 均有实现入口，但不与文本基线捆绑验收。应分别做显存、正确性和端到端稳定性测试。
- `Qwen3.8-Flash-Next` 暂时不具备成为该最低配置正式基线的条件。它是 125B 主模型、51B N-gram Embedding、4B MTP 的实验性架构预览；llama.cpp 的支持截至研究日仍在未合并的开发 PR 中。[Qwen 官方模型卡](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)；[llama.cpp 支持 PR](https://github.com/ggml-org/llama.cpp/pull/27742)

本报告不提供 tokens/s 数字。官方资料没有给出这两款模型在单张 RTX 4090、指定 llama.cpp 版本与上述配置下的可复现数据，填入估算吞吐会制造错误的交付预期。

## 一手事实

### Qwen3.8-27B

Qwen3.8-27B 是 27B 稠密多模态模型，共 64 层；其布局为 16 组“3 层 Gated DeltaNet + 1 层 Gated Attention”，因此共有 16 个全局注意力层。每个全局注意力层有 4 个 KV heads，head dimension 为 256；原生上下文为 262,144，可扩展到 1,000,000。模型原生支持图像和视频理解。[Qwen3.8-27B 官方模型卡的 Model Overview](https://huggingface.co/Qwen/Qwen3.8-27B#model-overview)

ggml-org 发布的官方自动转换包含以下文件：[文件清单](https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF/tree/main)

| 文件 | 官方文件大小 | 对最低配置的意义 |
|---|---:|---|
| `Qwen3.8-27B-Q4_K_M.gguf` | 19GB | 唯一能在 24GB 显存内为 Cache 和计算缓冲留出明显空间的官方主模型量化 |
| `Qwen3.8-27B-Q8_0.gguf` | 28.6GB | 必须部分 CPU offload，不能作为全 GPU 驻留基线 |
| `Qwen3.8-27B-BF16.gguf` | 53.8GB | 必须大量 CPU offload，只适合质量对照或专项实验 |
| `mmproj-Qwen3.8-27B-Q8_0.gguf` | 629MB | 图像输入需要的额外模型文件与显存/内存预算 |
| `mmproj-Qwen3.8-27B-BF16.gguf` | 931MB | 更大的视觉 projector，不适合作为最低配置默认值 |
| `mtp-Qwen3.8-27B-Q4_0.gguf` | 1.68GB | 启用 MTP 需额外模型、Cache 和计算预算 |

llama.cpp 的官方多模态文档说明，`llama-server` 可通过 OpenAI-compatible `/chat/completions` 接收图像、音频和视频，并通过 `--mmproj` 加载 projector；projector 默认卸载到 GPU。[llama.cpp 多模态文档](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)

llama.cpp 也已提供 `draft-mtp` 推测解码入口，但推测解码是否提速取决于 draft acceptance、请求形态、Cache 和服务端实现，不能从“存在 MTP 文件”推出吞吐增益。[llama.cpp 推测解码文档](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)

### Qwen3.8-Flash-Next

Qwen3.8-Flash-Next 的官方定义是：125B 主模型，每 token 激活 6B；另有 51B N-gram Embedding 和 4B MTP；原生上下文同为 262,144。Qwen 将它描述为 Qwen4 架构的提前预览，N-gram Embedding 可放在主机内存并异步预取。[Qwen 官方模型卡](https://huggingface.co/Qwen/Qwen3.8-Flash-Next#model-overview)；[Qwen 官方发布说明](https://qwen.ai/blog?id=qwen3.8-flash-next)

截至 2026-08-27，llama.cpp 主仓库中为该模型增加 `qwen4exp` 架构的 PR 仍为 Open。PR 涉及转换器、QSA、Gated Residual、N-gram Embedding、视觉与内存实现，并明确仍在推进 MTP；这说明 Qwen 发布页所称的“llama.cpp supports”尚不能等同于稳定主线版本支持。[llama.cpp PR「model: add Qwen3.8-Flash-Next」](https://github.com/ggml-org/llama.cpp/pull/27742)

该 PR 记录了一个与本项目硬件直接相关的实现事实：IQ4_NL 下，主机侧 `per_layer_token_embd` 表本身为 26.8GiB，访问模式是跨页随机 gather，因而增加了专门的 mmap random advice 与批量预取逻辑。[PR 全文（搜索 `26.8 GiB`）](https://github.com/ggml-org/llama.cpp/pull/27742)

## 容量推导

以下推导用于划定“物理上可能”和“明显越界”，并非实测显存数字。

### Qwen3.8-27B 的 KV Cache 下界

根据官方结构，只有 16 个 Gated Attention 层维护常规 KV Cache。F16 下每 token 的常规 KV 数据量下界为：

```text
16 层 × (K + V) × 4 KV heads × 256 head dimension × 2 bytes
= 65,536 bytes/token
= 64 KiB/token
```

由此得到：

| 总上下文 | F16 常规 KV Cache 下界 |
|---:|---:|
| 8K | 0.5GiB |
| 16K | 1GiB |
| 32K | 2GiB |
| 64K | 4GiB |
| 128K | 8GiB |
| 262,144 | 16GiB |

这张表**没有**包含 Gated DeltaNet 的循环状态、CUDA 计算图缓冲、allocator 对齐、输出缓冲、视觉 token/projector、MTP draft 模型及其 Cache。GGUF 文件大小也不等于最终 VRAM 占用。因此：

- 19GB Q4 主模型 + 32K F16 常规 KV 在容量上有合理余量，可作为首轮验收起点。
- 64K F16 已进入紧张区间；是否能全 GPU offload，要看实际构建、缓冲区和是否加载视觉/MTP。
- 128K 以上即使能够通过 KV 量化或 CPU offload 启动，也不能据此承诺交互延迟。

llama.cpp 允许将 K/V Cache 配置为 F16、BF16、Q8、Q4 等类型，但量化 Cache 对显存、速度和输出质量的实际影响必须测量。[llama-server 参数文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

### Qwen3.8-Flash-Next 的权重下界

官方参数总量为 `125B + 51B + 4B = 180B`。若所有参数理想化地按 4 bits 存储，仅权重 payload 就需要约 90GB（十进制）；实际 GGUF 还包含 mixed-precision tensors、量化块元数据、视觉模块和运行时状态。这一算术结果足以推出：

- 单张 24GB GPU 不可能让完整 4-bit 权重驻留显存。
- 128GB 主机内存只可能用于激进量化 + mmap/CPU offload 的可行性试验；“能加载”不能推出“能满足 Agent 交互延迟”。
- 6B activated parameters 只说明每 token 的主要矩阵计算量较小，不会把 125B 专家权重和 51B 查表参数的存储需求变成 6B。[Qwen 官方发布说明](https://qwen.ai/blog?id=qwen3.8-flash-next)

## 最低配置的建议部署档位

| 档位 | 主模型 | 上下文/并发 | 模态与 MTP | 定位 |
|---|---|---|---|---|
| A：正式基线候选 | Q4_K_M | `32K / parallel=1`，F16 KV | 文本；关闭 MTP | 首个必须通过的部署档位 |
| B：低并发候选 | Q4_K_M | 总上下文 32K，`parallel=2`，每槽 16K | 文本；关闭 MTP | 测 p95 延迟、排队与显存后再决定是否启用 |
| C：长上下文实验 | Q4_K_M | `64K / parallel=1` | 先文本；比较 F16 与 Q8 KV | 不进入首版承诺 |
| D：视觉实验 | Q4_K_M | 从 `16K / parallel=1` 起测 | Q8 projector；关闭 MTP | 单独验收图片/工程图表，不与文本基线合并推断 |
| E：MTP 实验 | Q4_K_M + MTP Q4_0 | 从 `16K / parallel=1` 起测 | 文本；启用 draft-mtp | 只有端到端延迟下降且稳定时才进入配置 |

llama.cpp 的总上下文会在并发槽之间分配；官方 README 用 `-c 16384 -np 4` 表示最多 4 个并发请求、每个 4096 上下文。[llama.cpp README 的 parallel decoding 示例](https://github.com/ggml-org/llama.cpp#llama-server)

`Q5`、`Q6`、`IQ4` 或 `UD` 变体目前没有可用于本结论的 Qwen/ggml-org 官方 Qwen3.8-27B 文件与目标硬件数据。即使第三方转换在磁盘大小上可装入，也应先完成文件来源、转换参数、模型质量和 llama.cpp commit 的内部验收，不能直接提升为部署基线。

## 工具调用与多模态边界

llama.cpp 的 `llama-server` 提供 OpenAI-compatible API；开启 `--jinja` 后支持 OpenAI-style function calling。官方文档同时说明，未被原生 handler 识别的模板会走 Generic handler，可能更耗 token，且并行工具调用只在部分模型上支持。[llama.cpp Function Calling 文档](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)

Qwen 官方评测表明 Qwen3.8-27B 与 Flash-Next 本身具备工具使用和多模态能力，但这些分数来自 Qwen 的评测框架，不能证明 llama.cpp 的模板渲染、流式解析、工具结果回填和长会话状态已经满足 RiskFlow。[Qwen3.8-27B 官方模型卡](https://huggingface.co/Qwen/Qwen3.8-27B#benchmark-results)；[Qwen3.8-Flash-Next 官方模型卡](https://huggingface.co/Qwen/Qwen3.8-Flash-Next#benchmark-results)

当前 llama.cpp 上游已有 Qwen3.8 长上下文和工具负载的未确认问题报告，包括 80K 之后 decode 性能骤降、大量工具定义下长输出性能下降，以及带尾部 `<think>` 的工具流解析失败。这些报告不能当作普遍性能结论，但足以要求本项目把长上下文与工具链回归列为发布门槛。[长上下文报告](https://github.com/ggml-org/llama.cpp/issues/27623)；[大量工具负载报告](https://github.com/ggml-org/llama.cpp/issues/27615)；[工具流解析报告](https://github.com/ggml-org/llama.cpp/issues/27733)

因此首版应采用以下边界：

- 工具调用：支持单工具和串行多轮；并行工具调用、超大工具清单另行验收。
- 结构化输出：验证完整 Schema 成功率、字段缺失率、重试后成功率，不只检查“模型能输出 JSON”。
- 多模态：先验收单图与工程表格截图；多图、长视频、图像 + 工具调用组合不进入基线。
- 思考模式：分别测试 thinking on/off、`reasoning_content` 流式响应、工具调用前后历史保留；不得假定 QwenCloud 的 `reasoning_effort` 与 llama.cpp 行为一致。

## Qwen3.8-Flash-Next 的升级门槛

Flash-Next 只有同时满足以下条件，才应从“候选”升级为可选生产模型：

1. **软件成熟度**：支持代码进入 llama.cpp 主线或固定的可维护发行版本；转换、文本、视觉、QSA、N-gram Embedding、MTP 均有可复现的正确性结果，不依赖临时开发分支。
2. **容量档位**：若要求完整 4-bit 权重驻留加速器，aggregate usable VRAM 必须明显高于约 90GB 的理想权重下界，并额外容纳 Cache 与计算缓冲。工程采购评估可从 128GB aggregate VRAM 档位起算，最终以实际 GGUF 和上下文配置复核；这是规划余量，不是 Qwen 官方硬件要求。
3. **主机卸载档位**：若保留单卡并依赖 CPU/RAM/NVMe，当前 128GB 只能算可行性实验环境。生产评估建议从 256GB RAM、足够的内存带宽和本地 NVMe 起测，并以服务 SLO 决定是否接受；容量建议来源于 90GB 权重下界及 PR 中 26.8GiB 随机访问表的实现事实，仍需实测。
4. **服务验收**：在 RiskFlow 的中文工程文本、结构化风险记录、规范抽取、工具调用、图像材料和长会话数据集上同时通过正确性、峰值内存、TTFT、p50/p95 延迟、错误率和恢复测试。
5. **可回退性**：模型服务接口不绑定具体 Qwen 型号；Flash-Next 不通过任一门槛时，可无业务代码改动地回退 Qwen3.8-27B。

Qwen 官方的 Flash-Next 部署示例以 `--tensor-parallel-size 4` 和 262,144 上下文展示 SGLang/vLLM，这也说明官方长上下文服务示例面向多卡部署，不能映射成单张 4090 的能力承诺。[Qwen3.8-Flash-Next 官方仓库 Deployment](https://github.com/QwenLM/Qwen3.8-Flash-Next#deployment)

## 必须实机验证的项目

以下内容无法从模型结构或文件大小可靠推出：

- Q4_K_M 相对 BF16 的中文工程抽取、机理推理、规则结构化与工具选择质量损失。
- 8K/16K/32K/64K 下的 prompt processing、decode、TTFT、峰值 VRAM/RAM 与热稳定性。
- F16、Q8、Q4 KV Cache 对速度、显存和长上下文正确性的影响。
- `parallel=1/2` 下的总吞吐、单请求 p95、排队行为与 Cache 复用收益。
- Q8 projector 的图像 token 数量、工程图表/扫描件质量、显存峰值及图像 + 工具组合稳定性。
- MTP 的 acceptance、额外显存和端到端延迟是否真正改善。
- 5、20、100 个工具定义下，单次/连续/并行工具调用的格式正确率、流式解析与长输出稳定性。
- llama.cpp 版本升级后的性能或模板回归。

每次基准至少固定并记录：llama.cpp commit/镜像摘要、CUDA 与驱动版本、GGUF 与 projector/MTP 文件哈希、所有启动参数、请求数据集版本、上下文 token 分布、并发槽数，以及模型和 Cache 的实际 offload 分布。官方 `llama-server` 响应包含 prompt/decode timings，可作为同机重复测量的原始数据；并发压测可沿用官方 server benchmark 的请求与指标方法。[llama-server timings 文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)；[llama.cpp server benchmark](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/bench/README.md)

## 决策分类

### 可直接采用的一手事实

- 两款模型的参数、层结构、原生上下文和多模态定位。
- ggml-org 官方 Qwen3.8-27B GGUF、projector、MTP 文件及其大小。
- llama.cpp 的并发槽、KV Cache 类型、多模态、MTP 和 function-calling 接口能力。
- Flash-Next 的 llama.cpp 支持仍处于 Open PR。

### 由结构与文件大小推导

- Qwen3.8-27B F16 常规 KV Cache 的 64KiB/token 下界。
- Q4_K_M 是 24GB 显存上唯一有合理余量的官方主模型量化。
- Flash-Next 完整 4-bit 权重的理想下界约 90GB，无法驻留单张 24GB GPU。

### 必须留待实机决定

- 32K 是否可作为最终默认上下文，64K 是否可接受。
- 并发数、吞吐、延迟和 SLO。
- KV 量化、MTP、视觉与工具调用的质量/性能取舍。
- Flash-Next 在任何升级硬件上的生产可用性。
