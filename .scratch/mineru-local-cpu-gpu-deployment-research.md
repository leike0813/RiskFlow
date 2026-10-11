# MinerU 本机服务部署：标准档 + ONNX/CPU + llama.cpp CPU/Vulkan 可行性核查

核查日期：2026-10-11。范围为官方一手资料（GitHub tag 源码、PyPI 制品元数据、Hugging Face / ModelScope 仓库 API）；未安装依赖、未下载模型、未启动任何服务。

## 结论

固定 MinerU 4.0.12、标准档、ONNX 小模型固定 CPU、llama.cpp VLM 在 CPU / Vulkan 间切换，是本机 Tesla P4 的可行部署候选。版本与制品已核对，P4 上实际执行和性能仍须实测。

- 官方 `mineru-llama-cpp` 的 Linux wheel **不含 CUDA 后端**，只有 CPU 与 Vulkan（Vulkan 是唯一 GPU 路径），因此 P4 用 Vulkan 而不是 CUDA 不是降级选择，而是官方制品的唯一 GPU 选项。
- Torch 小模型路径在本机不可用：共享环境 torch 2.12.0+cu130 的 arch 列表无 sm_60/sm_61，而 PyTorch 自 2.8 起在 CUDA 12.8/12.9 构建中删除了 Pascal；官方 4.0.12 Docker 镜像基于 vLLM 0.21（CUDA 13.0，compute capability ≥ 7.0），明确排除 Pascal。
- ONNX 与 Torch 使用同名同规格小模型的不同格式权重（`MinerU-4_models_onnx` 与 `MinerU-4_models_torch` 表格文件逐字节一致），因此 CPU 基准不需要 Torch 参与，也不会因换后端而换质量口径。

## 已验证事实

### 1. 制品固定（PyPI 官方元数据 + 本地下载校验）

| 组件 | 版本约束来源 | 制品 | sha256 | 上传时间 |
| --- | --- | --- | --- | --- |
| MinerU | tag `mineru-4.0.12-released` 的 `pyproject.toml` | `mineru==4.0.12` | 由 pip 解析并锁定 | — |
| docvortex | 同上，`docvortex>=0.5.16,<1` | 需显式钉 `==0.5.16` | 由 pip 解析并锁定 | — |
| mineru-llama-cpp | 同上，`mineru-llama-cpp>=0.1.2,<1` | `mineru_llama_cpp-0.1.3-cp310-abi3-manylinux_2_28_x86_64.whl`（20.62 MiB） | `d354bff0c32f6fc6a95d0a47819fc601daf0ddbe407cc9b3041a10f5789c950c` | 2026-10-10T19:57:49Z |

wheel URL：`https://files.pythonhosted.org/packages/4b/18/c35543b0dde84235fa6b29c3f517147880c77c5224b1f78ee1ba3c92165b/mineru_llama_cpp-0.1.3-cp310-abi3-manylinux_2_28_x86_64.whl`

wheel 内容实测（解压列举）：`bin/libggml-cpu.so`、`bin/libggml-vulkan.so`（42.03 MiB，未压缩）、`lib/libllama*.so*`、`lib/libmtmd.so.0`。**没有 `libggml-cuda.so`**，wheel 为 abi3，`requires-python >=3.10`，`manylinux_2_28`（glibc ≥ 2.28）。

后端开关来自 wheel 内部二进制字符串，可识别值有限定：

```
MINERU_LLAMA_CPP_BACKEND must be auto, cpu, vulkan or metal
Requested backend is unavailable; check GPU drivers and runtime libraries
```

即 `MINERU_LLAMA_CPP_BACKEND` 取 `auto|cpu|vulkan|metal`，显式指定不可用后端时抛出上述错误而非静默回退。wheel 内还带 `GGML_VK_VISIBLE_DEVICES`、`GGML_VK_DEVICE_ID` 等 llama.cpp 标准 Vulkan 环境变量。

### 2. 模型 registry 与体积（4.0.12 `mineru/model/registry.py` 指定）

| 用途 | Hugging Face | ModelScope | revision（main HEAD） | 体积 |
| --- | --- | --- | --- | ---: |
| ONNX 小模型 | `opendatalab/MinerU-4_models_onnx` | `OpenDataLab/MinerU-4_models_onnx` | `358310b4f64b95f9fefc372ad899356e4111f376`（2026-09-10） | 818.5 MiB |
| Torch 小模型（本次不用） | `opendatalab/MinerU-4_models_torch` | `OpenDataLab/MinerU-4_models_torch` | `2b3afb86f4d23fa623f6b2f4b2279ed4ef93a89d`（2026-09-10） | 853.4 MiB |
| VLM GGUF | `jinzhenj/MinerU2.5-Pro-2605-1.2B-GGUF` | `jinzhenj/MinerU2.5-Pro-2605-1.2B-GGUF` | `9185688a0495e1577d521a757c7c0b62dd38ca48`（2026-08-13） | 1183.0 MiB（主模型 506.5 + mmproj 676.5 MiB） |
| VLM 原始权重（vLLM/lmdeploy 用） | `opendatalab/MinerU2.5-Pro-2605-1.2B` | `OpenDataLab/MinerU2.5-Pro-2605-1.2B` | — | 2312826640 B = 2.17 GiB |

ONNX + GGUF 合计约 2.0 GiB，可只读共享挂载给 CPU 与 GPU 两个实例。GGUF 仓库是 `jinzhenj` 个人命名空间，不是 opendatalab，部署冻结时必须按上表记录 revision。

### 3. 精确配置字段

配置文件位于 `$MINERU_HOME/config.yaml`（`MINERU_HOME` 默认 `~/.mineru`），`MINERU_CONFIG` 可改路径；3.x 的 `mineru.json` 在 4.0 不再读取。

```yaml
model:
  source: local            # local | huggingface | modelscope | auto
  base_dir: /models        # 只读共享模型根目录
  small_backend: onnx      # auto | onnx | torch
  vlm:
    engine: llama-cpp      # auto | llama-cpp | vllm | lmdeploy
```

等价环境变量（官方 docker 文档即用此法固定后端）：`MINERU_MODEL_SOURCE`、`MINERU_MODEL_SMALL_BACKEND`、`MINERU_MODEL_VLM_ENGINE`。

服务启动参数（`mineru-kit api-server --help` 源码确认）：

```bash
mineru-kit api-server --host 127.0.0.1 --port 18000 \
  --tier standard --concurrency 1 --preload-models \
  --upload-dir /var/lib/mineru/uploads --log-level info
```

其他相关项：`--api-key`（仅在绑定非回环时配合反代使用）、`--vlm-server-url`（指向外部 VLM 时使用，本次留空走本地引擎）、`--vlm-max-concurrency`（默认 100）、`--retention-seconds`（默认 86400）、`--no-flash` / `--no-advanced`。小模型后端与 VLM 引擎**不是** api-server 的 CLI 选项，只能靠 config/env 固定。

接口：`/v1/health`（`features.sources`、`features.output_formats`）、`/v1/tiers`、`/v1/file_parse`（同步）、`/v1/tasks` + `GET /v1/tasks/{id}`（异步）、`/v1/uploads`、`/v1/files/{id}/content`、`/v1/usage`。3.x 的 `/file_parse`（根路径）与 `/tasks` 已删除。

模型管理命令：

```bash
mineru-kit models download --tier standard --small-backend onnx --vlm-engine llama-cpp --source modelscope
mineru-kit models verify   --tier standard --small-backend onnx --vlm-engine llama-cpp
mineru-kit models show      # 报告 Effective small backend / Effective VLM engine 及其配置来源
```

设备与线程相关环境变量：

| 变量 | 作用 |
| --- | --- |
| `MINERU_LLAMA_CPP_BACKEND` | `auto`/`cpu`/`vulkan`，VLM 推理后端（wheel 内实现） |
| `MINERU_TABLE_DEVICE` | `auto`/`cpu`/`cuda`，仅影响表格分类/SLANet/UNet；`cuda` 需 `onnxruntime-gpu` |
| `MINERU_INTRA_OP_NUM_THREADS` / `MINERU_INTER_OP_NUM_THREADS` | ONNX 会话算子内/算子间线程，默认 `4` / `1` |
| `MINERU_PROCESSING_WINDOW_SIZE` | 单次处理窗口，默认 `64` |
| `MINERU_PDF_RENDER_THREADS` | PDF 渲染 worker，默认 `4` |

VLM 是**进程内** `mineru_llama_cpp.Engine`，MinerU 侧可透传的构造参数只有 `n_ctx_seq`（默认 0 = 模型训练上下文）、`n_gpu_layers`（默认 99）、`n_parallel`（默认 4）、`n_threads`（默认 -1 自动）、`verbosity`。`mineru-kit api-server` 未暴露这些开关，实际运行取 Engine 默认值；本轮基准不要试图改动它们，否则基准口径不再是官方默认。

### 4. P4（Pascal sm_61）的硬约束

| 路径 | 结论 | 依据 |
| --- | --- | --- |
| vLLM / LMDeploy / 官方 Docker 镜像 | 不可用 | 官方 Dockerfile 注释：vLLM 基础镜像支持 `7.0 <= Compute Capability <= 12.1`（Volta 起）；P4 为 6.1 |
| Torch 小模型 | 官方可用但本机不可用 | PyTorch #157517（2025-07-03 关闭）：2.8/2.9 的 CUDA 12.8/12.9 构建删除 Maxwell/Pascal/Volta；#190385（2026-07-17，开放）：CUDA 13.x 不再覆盖 sm_75 以下，2.15 拟移除 CUDA 12.6 构建 |
| llama.cpp CUDA | 官方 wheel 不提供 | wheel 内只有 `libggml-cpu.so` 与 `libggml-vulkan.so` |
| llama.cpp Vulkan | 唯一官方 GPU 路径 | wheel 内 `libggml-vulkan.so` + `MINERU_LLAMA_CPP_BACKEND=vulkan` |

结论含义：本机 GPU 加速只可能来自 Vulkan（compute shader），性能与 CUDA 不能直接对比；任何“GPU 慢”的结论必须先排除 Vulkan 后端选错设备、驱动能力缺失或 CPU 线程抢占。

### 5. 协议：4.0 与 3.4.4 不可混用

- 4.0.12 中间结果协议是 `docvortex.middle` / `schema_version` `2.0`，携带 `metadata`、`extensions.mineru.tier`、`pages[].blocks[]`，并有 `is_full_document`；这是项目“middle 2.0”的来源。
- 3.4.4（tag `mineru-3.4.4-released`）返回的是 `*_middle.json`（`pdf_info` / `para_blocks` 体系），服务为根路径 `/file_parse`、`/tasks`、`/health`，`/health` 返回 `protocol_version: 2`（`mineru/cli/api_protocol.py` 的 `API_PROTOCOL_VERSION = 2`，与 4.0 的 V1 路径不是同一契约）。
- 4.0 迁移文档明确：带当前 `schema` 身份的数据不会回退尝试旧协议；旧 JSON 不承诺可被 `ParseResult.from_dict()` 读取。
- 附带发现：tag `mineru-3.4.4-released` 的 `mineru/version.py` 仍是 `__version__ = "3.4.3"`，若日后回退到 3.x 做对照，必须以 tag 为准而非 `__version__`。

结论：本轮基准与自托管服务都应使用 4.0.12 V1 协议；为测性能另起一套 3.4.4 协议没有收益，反而污染质量口径。

## 推荐部署形态（供规格闭合）

同一个镜像、同一个只读模型卷，两个 compose 服务，唯一差异是 GPU 挂载与 `MINERU_LLAMA_CPP_BACKEND`：

```yaml
services:
  mineru-gpu:
    build: .
    ports: ["127.0.0.1:18000:8000"]
    environment:
      MINERU_HOME: /home/mineru
      MINERU_MODEL_SOURCE: local
      MINERU_MODEL_SMALL_BACKEND: onnx
      MINERU_MODEL_VLM_ENGINE: llama-cpp
      MINERU_TABLE_DEVICE: cpu
      MINERU_LLAMA_CPP_BACKEND: vulkan
    volumes: ["/srv/riskflow-mineru/models:/home/mineru/models:ro", "/srv/riskflow-mineru/uploads:/var/lib/mineru/uploads"]
    deploy: {resources: {reservations: {devices: [{driver: nvidia, count: 1, capabilities: [gpu]}]}}}
  mineru-cpu:
    build: .
    ports: ["127.0.0.1:18001:8000"]
    environment: { ...同上, MINERU_LLAMA_CPP_BACKEND: cpu }
    volumes: [同 GPU 实例]
```

镜像基线：`python:3.12-slim`（glibc 2.36 ≥ wheel 要求的 2.28）+ `libvulkan1`（Vulkan loader）+ `libgl1`（opencv-python 依赖）+ `fonts-noto-cjk`（中文渲染）；运行时 `NVIDIA_DRIVER_CAPABILITIES=graphics,compute,utility`（Vulkan ICD 需要 `graphics`，缺 `compute` 会导致无计算队列）。pip 安装需钉死四项：`mineru==4.0.12 docvortex==0.5.16 mineru-llama-cpp==0.1.3`，并额外钉住 `onnxruntime`（保持 CPU 版，官方基础包默认即 `onnxruntime>=1.20.1`）。镜像层内容属工程推断，官方 4.0.12 Dockerfile 只提供 vLLM 基础镜像版本（不适用于 P4）。

## 公平基准方法

1. 同版本、同 backend、同权重：同一镜像 digest、同一模型卷 revision、`small_backend=onnx`、`MINERU_TABLE_DEVICE=cpu`、`--tier standard`、同一 `--concurrency 1`；两实例仅 `MINERU_LLAMA_CPP_BACKEND` 与 GPU 挂载不同。
2. 冷启动与暖请求分开记录：冷 = 进程启动到 `/v1/health` 就绪（含 ONNX 会话与 GGUF 加载）+ `/v1/file_parse` 首次完成；暖 = 预热 2 次后连续 N 次（建议 N ≥ 10）取 p50/p95 与每页秒数。两者不可混为一谈。
3. 固定输入集：同一批甲方脱敏 PDF + 合成样本，记录页数、是否扫描件、公式/表格密度；报告“秒/页”和“秒/文档”两个口径。
4. 质量报告分开：Vulkan 与 CPU 输出只比较结构化产物（页数、非空页比例、关键字段覆盖、表格单元格数、公式数量、阅读顺序），不要用整篇 Markdown 字符串相等当判据；两轮输出应逐字节一致的项（ONNX 确定性路径）单独列出，作为“性能差异不是质量差异”的证据。
5. 记录环境：`nvidia-smi` 驱动与 Vulkan ICD 可见性、`vulkaninfo`（设备名与 API 版本）、`models show` 的 Effective 后端、CPU 线程数（`MINERU_INTRA_OP_NUM_THREADS`）与是否与其他负载同机竞争。
6. 交叉检查：CPU 实例应在无 GPU 挂载的环境运行；GPU 实例启动前确认 `MINERU_LLAMA_CPP_BACKEND` 未被静默改成 `auto`（看启动日志与 wheel 的“backend is unavailable”报错）。

## 未知项与风险

- P4 上的 Vulkan 实际可用性与性能未实测：需要 `vulkaninfo` 看到 Tesla P4 设备、`NVIDIA_DRIVER_CAPABILITIES` 含 `graphics`，否则 wheel 会报“backend is unavailable”。Pascal 的 Vulkan compute 路径可能显著慢于 CUDA，结论只能表述为“同配置下 Vulkan 与 CPU 的差异”。
- 8 GiB 显存的 Vulkan 实际占用未实测；mmproj（676.5 MiB Q8）是否与主模型同驻留需看运行日志。
- `mineru-llama-cpp` 0.1.3 wheel 与 MinerU 4.0.12 的实际组合未在本机验证（4.0.12 只约束 `>=0.1.2,<1`，行为以该 wheel 为准）。
- `docvortex==0.5.16` 为显式钉版；4.0.12 声明 `>=0.5.16,<1`，其他 4.0.12 环境可能已装更高版本，跨环境复现前需对齐。
- 官方 Docker 镜像（vLLM 基础）在 P4 上不可用；若将来迁到 4090，需重新评估 vLLM 路径并与 Vulkan 基线做跨设备比较。
- 未知项：两个实例共享只读模型卷时的并发下载锁行为；建议下载完成后再启动服务，并在 CI 中用 `models verify` 断言。

## 来源

- MinerU 4.0.12 tag 源码：`https://github.com/opendatalab/MinerU/tree/mineru-4.0.12-released`
  - `pyproject.toml`（版本与 extras 约束）
  - `mineru/model/registry.py`（模型仓库与路径映射）
  - `mineru/model/vlm/runtime.py`（进程内 llama-cpp 引擎与可透传参数）
  - `mineru/kit/commands/api_server.py`（服务启动参数）
  - `docs/zh/usage/tiers.md`、`docs/zh/usage/model_source.md`、`docs/zh/usage/http_api.md`、`docs/zh/reference/output_files.md`、`docs/zh/reference/migration_4.md`、`docs/zh/quick_start/docker_deployment.md`
- MinerU 3.4.4 tag 源码：`https://github.com/opendatalab/MinerU/tree/mineru-3.4.4-released`（`mineru/cli/fast_api.py`、`mineru/cli/api_protocol.py`、`mineru/version.py`）
- PyPI：`https://pypi.org/pypi/mineru-llama-cpp/0.1.3/json`
- PyTorch 架构支持：[pytorch#157517](https://github.com/pytorch/pytorch/issues/157517)、[pytorch#190385](https://github.com/pytorch/pytorch/issues/190385)
- Hugging Face 模型仓库 API：`opendatalab/MinerU-4_models_onnx`、`opendatalab/MinerU-4_models_torch`、`jinzhenj/MinerU2.5-Pro-2605-1.2B-GGUF`、`opendatalab/MinerU2.5-Pro-2605-1.2B`
- 父侧已核：`mineru-llama-cpp` commit `5189a170ff30abcf534de42ac3579c5be2b84c35` 的 README 与 `src/cpp/backend_policy.h`、`src/cpp/engine_core.cpp`

## 含义

规格可以按“标准档 + ONNX 小模型固定 CPU + VLM 由 `MINERU_LLAMA_CPP_BACKEND` 在 cpu / vulkan 间选择”这一条闭合；GPU 表述应写“Vulkan compute（唯一官方 GPU 后端）”，不得写成 CUDA 或 vLLM。部署与验收需要额外建立的一条脚本/校验是镜像内 `--gpus all` 下 `vulkaninfo` 可见设备与 `models show` 后端一致性检查。
