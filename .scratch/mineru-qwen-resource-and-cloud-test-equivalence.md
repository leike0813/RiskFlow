# MinerU / Qwen 同机资源与云端测试的迁移边界

核查日期：2026-10-11。只读研究及本报告落稿；未修改 OpenSpec、业务代码或依赖，未安装、下载模型、运行服务或推理。用户目标：交付使用本机 MinerU 与 Qwen3.8-27B，当前功能验收使用云端服务。

## 结论

预设单 RTX 4090（24 GiB）与 128 GB 主机内存下，两套推理默认共享 GPU 会竞争显存、计算与带宽。文件容量计算不足以判断必然 OOM，也不足以承诺稳定共驻。建议以 Qwen 独占 GPU、MinerU 小模型与专用 VLM 显式使用 CPU 为第一部署候选；CPU 型号、线程和解析速度仍待实测。

云端验收能推进界面、权限、审核、版本、确定性计算及追溯等功能，但不能替代本地模型质量、目标上下文、故障边界和同机性能验收。当前云业务模型为 MiniMax-M3.1-Flash-Preview，交付为量化 Qwen，模型差异确实存在；没有同输入 A/B 数据，不能给出可信差异百分比。

## 容量依据

项目预设见 [现有硬件规划](riskflow-master-plan/research/02-qwen-hardware-envelope.md)：Qwen Q4_K_M、文本、单并发槽、32K 总上下文、F16 KV、关闭 MTP。以下统一使用 GiB（2^30 字节），文件大小不等同于运行显存。

| 项目 | 核查量 | 性质 |
| --- | ---: | --- |
| Qwen3.8-27B Q4_K_M | 18,973,870,528 B = 17.67 GiB | GGUF 文件体积 |
| Qwen 32K 常规 F16 KV | 2.00 GiB | 按模型结构推导；一槽假设 |
| MinerU 专用 Q8 GGUF | 531,066,496 B = 0.49 GiB | 文件体积 |
| MinerU Q8 视觉投影 mmproj | 709,409,600 B = 0.66 GiB | 文件体积 |
| 上述合计 | 约 20.83 GiB | 假设全部 GPU 驻留的粗略算术；不是峰值显存 |

Qwen config 有 16 个 full_attention 层、4 KV heads、head_dim=256。常规 F16 KV 为 `16 × 2(K,V) × 4 × 256 × 2 bytes × 32768 = 2 GiB`。48 个线性注意力层还有循环状态，不在此数值中；CUDA/Vulkan 缓冲、图执行、各进程分配、MinerU 的 KV/视觉激活和小模型也未计入。名义剩余约 3.17 GiB，不能全部当作可用余量。Qwen 业务图片输入需另计自己的 projector；文本基线不加载它。64K 常规 KV 增至约 4 GiB，进一步压缩余量。

来源：[Qwen config](https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/config.json)、[Qwen GGUF 文件字节](https://huggingface.co/api/models/ggml-org/Qwen3.8-27B-GGUF?blobs=true)、[MinerU GGUF 文件字节](https://huggingface.co/api/models/jinzhenj/MinerU2.5-Pro-2605-1.2B-GGUF?blobs=true)。MinerU GGUF 来源由 [4.0.12 官方 registry](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/mineru/model/registry.py) 指定，不是以模型名称臆算体积；实际模型及 revision 仍须部署冻结。

## 资源安排建议

1. Qwen 保持现有单槽 32K 文本候选，以 4090 为主要计算资源。
2. MinerU Standard 保留专用 VLM；小模型显式 ONNX/CPU，表格设备固定 CPU，llama.cpp VLM 也固定 CPU。不能只设置 ONNX 后就宣布整套解析不使用 GPU，不能以 Basic 替代 Standard 后沿用相同质量结论。
3. 文档作为后台入库任务运行，限制同时解析的文档与 CPU 线程，为 API、数据库及检索保留资源。128 GB RAM 无法单独证明 CPU 路径速度可接受；CPU 型号和内存带宽未明确。
4. 当前 embedding 使用 192.168.13.11 的独立 Ollama，不计入本机 4090。若交付搬回同机，须另计第三个模型的驻留、缓冲和计算。

MinerU 基础 ONNX 路径对 layout/OCR/formula 使用 CPU，但表格模型和 VLM 独立选择设备，见 [4.0.12 档位文档](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/tiers.md)。

CPU VLM 有明确上游路径：`mineru-llama-cpp` commit `5189a170ff30abcf534de42ac3579c5be2b84c35` 的 pyproject 标注 0.1.3；其 [README](https://github.com/opendatalab/mineru-llama-cpp/blob/5189a170ff30abcf534de42ac3579c5be2b84c35/README.md) 记录 `MINERU_LLAMA_CPP_BACKEND=cpu`。其 [backend_policy.h](https://github.com/opendatalab/mineru-llama-cpp/blob/5189a170ff30abcf534de42ac3579c5be2b84c35/src/cpp/backend_policy.h) 对 cpu 返回空 GPU 设备集；[engine_core.cpp](https://github.com/opendatalab/mineru-llama-cpp/blob/5189a170ff30abcf534de42ac3579c5be2b84c35/src/cpp/engine_core.cpp) 随之将 n_gpu_layers 置 0、mmproj_use_gpu 置 false，并禁止再次自动挑 GPU。MinerU 4.0.12 的 [VLM runtime](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/mineru/model/vlm/runtime.py) 使用该 Engine。

这是核查到的源码能力，不代表当前机器已安装此版本，也不保证任意符合 MinerU 依赖范围的旧 wheel 都支持该开关。应冻结具有上述行为的制品，验实际 providers、GPU offload 日志及进程显存。本次没有执行这些验证。研究子 Agent 未读引擎源码时得出的“没有 CPU 强制开关”仅成立于 MinerU 顶层配置表，不能作为整个运行栈的结论。

CPU 路径能避开 GPU 竞争，仍共享 CPU、RAM 带宽和磁盘。若速度不足，再实测受限 GPU 共驻：从一文档、低并发、8K/16K/32K Qwen 请求测起，观察热驻留与峰值；不可直接采用独立 vLLM 默认显存预留。串行请求不会自动卸载两套权重。若需卸载轮换或部分 CPU offload，要单独验加载延迟和业务吞吐。

## 云端与本地的行为差异

这里区分两个切换：文档转换器切换，以及业务 LLM 切换。若云 MinerU 指官网精准 API，其协议和内部配置不等于本地服务；若是远程自托管同版本 MinerU，差异范围会缩小。

| 验收内容 | 可迁移程度与复验要求 |
| --- | --- |
| 界面、权限、人审、发布/回滚、审计和追溯 | 云端可验业务契约；本地适配器仍须接入回归 |
| P/C、矩阵、阈值、版本重放 | 固定完全相同的风险事件、指标及规则输入时应相同；不保证不同模型生成的整条链输入相同 |
| PDF 字、关键数值单位、表格、阅读顺序、页定位 | 必须用目标 MinerU 重新验；云端成功不能证明本地提取相同 |
| 清洗、知识编制、检索审阅、风险候选、建议排序与校准候选 | MiniMax 与 Qwen 的语义和成功率待对照；Schema 合法不证明内容正确或召回一致 |
| 长上下文与工具循环 | 必须按本地目标限额验；云端 1M 能力不能映射成单卡 32K 能力 |
| SSE、usage、结构化输出、超时、取消、错误与队列 | 必须验目标适配器与真实服务，网络/限流失败和本地 OOM/进程失败不同 |
| 吞吐、p95、峰值显存、同机争抢 | 云端验收不覆盖 |

### 文档转换器

官网 [公开 API](https://mineru.net/apiManage/docs) 使用 v4 的 pipeline/vlm 等请求、ZIP Markdown 与 JSON 工件；本地 [4.0.12 API](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/http_api.md) 为 V1 任务协议，其 [Middle 输出](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/reference/output_files.md) 为 DocVortex schema 2.0。不能假设只换 baseURL 即兼容，也不能凭云端“vlm”标签认定权重、量化与本地 Standard 完全相同。

解析差异会影响正文和表格，继而影响资料段、索引和 Agent 输入，可能放大成候选差异。保持共同规范化结果契约，保存原始解析证据、版本和配置，再比较关键语义及定位；不用整篇 Markdown 字符串相等作为质量标准。既有来源版本不能原地改写，具体身份与历史处理参见 [转换影响报告](mineru-document-ingestion-impact-research.md)。

### 业务 LLM

当前 MiniMax 使用网络 adapter 的 schema-prompt 分支，向消息添加 JSON Schema 指令，再做确定性验证；本地 llama.cpp 请求 response_format/json_schema，由服务约束输出格式。两者不保证结构化成功率或语义相同。见 `packages/adapters/src/model/network-api-model-gateway.ts:231` 与 `packages/adapters/src/model/llamacpp-model-gateway.ts:386`。

本地 adapter 使用 tokenize 与目标 contextWindowTokens 预检；网络 adapter 使用保守字节上界，并校验服务 usage。相同文本在不同 tokenizer 下 token 数不同，reasoning、工具与 Schema 开销也不同。目标 32K 是输入、模板、工具及输出共享的限额；4K 输出预留后，输入理论上最多约 28K，仍须计模板等开销。不能仅把云请求的 max_tokens 设成 4096 就宣布覆盖本地限制。

量化 Qwen 与当前 MiniMax 更换了模型、量化、模板和运行后端，差异不限于速度。确定性校验能拒绝违规候选，但不能保证两模型具有相同召回、取舍、排序、工具选择或预算内完成率。

## 最小对照验收建议

继续用 references/acceptance 合成样例推进当前云端浏览器功能验收，并标明“合成样本、待甲方复核”。补一次较早的小规模本地兼容/质量回归，完整实机性能仍留到部署阶段。

使用关键样例做四个组合，不必每组重跑全部 UI：云解析＋云 LLM；本地解析＋云 LLM；云解析＋本地 LLM；本地解析＋本地 LLM。先在相同源工件上单独比较转换结果；再冻结完全相同的规范化文档、检索材料及规则，对照业务模型；最后本地端到端验证追溯和运行边界。这样能区分解析与模型造成的差异。

对照至少覆盖中文文本 PDF、扫描 PDF/图片、复杂表格和关键工程数值；五类必经 Agent 任务及风险候选节点；长输入、失败和取消边界。记录页覆盖、关键数字/单位准确性、表格结构/定位、风险候选召回与误报、Schema 通过率、任务成功率与预算消耗。本地另测文档解析耗时、TTFT、p95、VRAM/RAM 峰值，及持续解析时业务交互延迟。不要求 LLM 正文逐字一致。

若能在云机器部署完全相同 Qwen GGUF、量化、模板、llama.cpp 版本和预算，以及相同 MinerU 版本/模型/档位，功能测试对本地的代表性更强；硬件性能和设备配置仍不可迁移。当前 MiniMax 可继续用于功能联调，不能计作目标 Qwen 质量已验。

本报告不给出差异百分比、CPU 每页耗时或单卡 tokens/s：尚无目标机及配对样例测量证据。最主要剩余风险是 CPU Standard 入库速度，以及目标 Qwen 在本地上下文与预算内完成真实任务的质量和稳定性。

## 辅助 GPU 与通用 Qwen VLM 的可行性补充

用户确认当前云端 API 验收主要覆盖功能与流程，本地部署另做硬件验收；希望交付 MinerU 也使用 GPU，可增加辅助卡，并询问能否直接复用 Qwen VLM。本节为设计调查，不修改已批准规格，也不代表已选定辅助卡。

### 双 GPU 候选

推荐 4090 专门承载业务 Qwen，辅助 NVIDIA GPU 承载 MinerU 专用文档 VLM。小模型可留 CPU/ONNX，也可采用 Torch GPU 与专用 VLM 共用辅助卡；这两条都是本地 GPU MinerU 的部署形态，后者把更多解析计算移到辅助卡。

MinerU 官方 [4.0.12 README 硬件表](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/README.md) 给出 Torch＋llama.cpp/vLLM/LMDeploy 的 8 GB+ VRAM 起点；[档位文档](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/tiers.md) 明确 8 GB 是规划起点，不保证全部任务。8 GB 可作为低并发样例验证候选；若要采购预留余量，可评估 12/16 GB。这是工程余量建议，不是测出的最低要求，具体型号须看并发、长页/复杂表格及是否同卡承载 embedding。

独立进程不自动实现独立 GPU。按服务显式固定可见设备：业务只见主卡，MinerU 只见辅助卡。尤其 [mineru-llama-cpp 后端策略](https://github.com/opendatalab/mineru-llama-cpp/blob/5189a170ff30abcf534de42ac3579c5be2b84c35/src/cpp/backend_policy.h) 在相同后端和设备类别下可返回多个 GPU；仅设置 Vulkan 后端不足以绑定辅助卡。CUDA_VISIBLE_DEVICES 的 CUDA 语义不能推定约束 Vulkan。具体设备隔离需冻结容器/运行时后验证；不在本报告给出未经目标机验证的选卡命令。

CUDA 路径有官方 [按 GPU 启动服务示例](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/en/usage/advanced_cli_parameters.md)。Vulkan 上游 [设备选择讨论](https://github.com/ggml-org/llama.cpp/discussions/12443) 提供 GGML_VK_VISIBLE_DEVICES 线索，但设备索引不应假定等于 CUDA ordinal，且需验证具体 MinerU 原生制品。采用 full/vLLM 时，其 [gpu_memory_utilization](https://docs.vllm.ai/en/stable/api/vllm/config/cache/) 是单实例预算比例，不会自动协调同卡其它实例。

新增辅助卡还需核对主板插槽/PCIe 分配、4090 体积与机箱空间、电源及散热。两个服务仍共享 CPU/RAM/磁盘；硬件验收须同时跑文档入库与业务推理，确认实际进程显存分布和交互延迟。

### 通用 Qwen 不能作为直接兼容替换的依据

MinerU 允许配置 OpenAI 兼容 VLM 服务地址与 model 名；[HTTP 客户端](https://github.com/opendatalab/mineru-vl-utils/blob/2843b62a1c68feafce42fa52f6e21080eb094fc2/mineru_vl_utils/vlm_client/http_client.py) 仅核对服务存在该名称，并发送图像与任务 prompt。这证明传输接入可能，不证明模型具备 MinerU 的输出协议和解析质量。

[MinerUClient](https://github.com/opendatalab/mineru-vl-utils/blob/2843b62a1c68feafce42fa52f6e21080eb094fc2/mineru_vl_utils/mineru_client.py) 使用 Layout Detection/Text Recognition/Table Recognition 等专用任务提示；布局解析匹配 `<|box_start|>x1 y1 x2 y2<|box_end|><|ref_start|>块类型<|ref_end|>` 等标记，再按坐标裁剪块进行识别。普通 Markdown 或一般图像问答不能直接提供这些版面结果。输出没有匹配时该 parser 记录格式警告，并可能返回空块集合；业务端必须质量校验，HTTP 200 不构成解析成功证据。

当前 [专用模型示例](https://huggingface.co/opendatalab/MinerU2.5-Pro-2605-1.2B) 使用 Qwen2VLForConditionalGeneration 架构加载器，但加载的是 `opendatalab/MinerU2.5-Pro-2605-1.2B` 专门训练的权重。使用 Qwen 架构和复用通用 Qwen3.8-27B 权重是不同事项，不能由架构相近推出互换。当前核查未发现上游承诺 Qwen3.8-27B 可直接替代专用模型的文档或配对质量证据。

如果坚持通用 Qwen 路径，需原型验证完整的布局、表格、公式、阅读顺序和定位协议，必要时修改提示/映射或训练；应视为新的解析方案，不能作为简单 model 配置切换。测试必须基于标注源文档，不以模型自己生成的结果作为真值。

复用主卡现有 Qwen 服务还会把页面/裁剪图推理加入同一业务队列；辅助卡无法替主卡执行这些请求。原业务 Qwen 文本基线也须开启视觉 projector 并重新验显存和多模态接入。若辅助卡另起完整 Qwen3.8-27B，则重复加载大模型，辅助卡容量应按该模型及视觉缓存重新预算，不能沿用 MinerU 1.2B 的 8 GB 起点。

Qwen 有较自然的复用位置：[MinerU 模型源文档](https://github.com/opendatalab/MinerU/blob/mineru-4.0.12-released/docs/zh/usage/model_source.md) 将标题分级、跨页表格单元格续接列为独立的 LLM 辅助后处理，默认关闭。可将其作为后续研究候选，不能未经设计自动开启；它不能替代专用版面/OCR VLM，也会增加业务模型调用与资源预算。

本轮推荐形态：主卡业务 Qwen，辅助卡 MinerU 专用模型；当前继续云端功能流程验收，本地阶段补目标解析/模型质量、双卡资源分配、并发稳定性与性能。未跑 Qwen 替代原型、双卡或目标样例，不作质量或吞吐保证。
