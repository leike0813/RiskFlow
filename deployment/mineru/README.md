# 本机 MinerU 固定服务

服务已于2026-10-11部署并通过CPU/P4 Vulkan实测，当前GPU实例健康运行，CPU对照实例已停止。模型、原始响应和性能证据持久化保留。五格式及五页扫描件的质量检查均通过；报告见[本机验收与性能结果](../../references/acceptance/mineru-v2/local-benchmark-report.md)。

本机双路 Xeon E5-2697A v4、128GB 内存与 Tesla P4 8GB 使用 MinerU 4.0.12 Standard，ONNX 小模型运行于 CPU，专用 VLM 使用 llama.cpp。日常 GPU 服务使用 Vulkan，CPU 对照实例使用同一模型和镜像，完整流程在 CPU 上运行。默认每次仅转换一份资料。

固定接口为 `http://127.0.0.1:18000`，CPU 实例为 `http://127.0.0.1:18001`；提供 `/v1/health`、`/v1/tasks` 与 `/v1/tasks/{id}/result?response_format=json`。本机客户端可直接复用该 V1 服务；配置发布到内网时须另行配置鉴权和监听范围。

模型约 2GiB，分别为 `opendatalab/MinerU-4_models_onnx` 和 `jinzhenj/MinerU2.5-Pro-2605-1.2B-GGUF` 的 Q8_0 主模型及 mmproj。安装制品记录在镜像的 `/opt/mineru/install-report.json`、`installed.txt`。模型来源与文件证据在下载后记录；后续服务以 `local` 源读取，不在请求中下载模型。

持久化默认目录为 `/home/joshua/.local/share/riskflow-mineru`，可通过 `MINERU_DATA_DIR` 指定其它独立目录；包含共享模型、分别独立的 GPU/CPU 上传数据与准备环境。模型文件以只读方式提供给推理实例，`.locks` 子目录单独可写，供 MinerU 本地模型管理器加锁。镜像提供 Vulkan、GL 和 EGL 运行库，NVIDIA 驱动由容器运行时注入。日志通过 Docker 保留并有大小限制，停止或重建容器不会删除模型与资料目录。

在项目根目录运行：

```bash
docker compose -f deployment/mineru/compose.yaml config --quiet
docker compose -f deployment/mineru/compose.yaml build gpu
docker compose -f deployment/mineru/compose.yaml --profile prepare run --rm prepare
docker compose -f deployment/mineru/compose.yaml --profile prepare run --rm prepare models verify --tier standard --small-backend onnx --vlm-engine llama-cpp
docker compose -f deployment/mineru/compose.yaml up -d gpu
docker compose -f deployment/mineru/compose.yaml exec gpu vulkaninfo --summary
docker compose -f deployment/mineru/compose.yaml exec gpu mineru-kit models show
docker compose -f deployment/mineru/compose.yaml ps
docker compose -f deployment/mineru/compose.yaml logs --tail 100 gpu
docker compose -f deployment/mineru/compose.yaml restart gpu
docker compose -f deployment/mineru/compose.yaml stop gpu
```

下载使用官方模型管理命令，不手工制造完成标记。离线重启前先保存镜像ID、安装报告、模型来源与文件清单，并验证实际本地模型。服务健康和实际 backend 验证成功前，不应计为就绪。显式 Vulkan 初始化失败不会回退成 CPU 成功。P4 的 Vulkan 执行与显存占用须实测；本方案不使用不支持 Pascal 的官方 vLLM 镜像或共享 PyTorch。

服务就绪后，用同一生产 parser 验证本地五格式；每项采用源清单字段、非空页和关键字段覆盖率1，配置样例中的空字段清单被源清单逐项替代：

```bash
MINERU_REAL_SMOKE=1 MINERU_SMOKE_CONFIG=deployment/mineru/local-config.example.json MINERU_SMOKE_SUITE=references/acceptance/mineru-v2/manifest.json pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts
```

仅本机匿名服务无需token；配置声明凭据时仍必须提供专属 `MINERU_TOKEN`。CPU配置从同一配置生成，显式更新端点/allowlist为18001及部署/资源引用；不改质量清单。报告保存实际协议、部署/资源引用、受限原始响应和逐项验收耗时，默认目标测试继续跳过真实调用。

本机已保存的配置为 `/home/joshua/.local/share/riskflow-mineru/evidence/gpu-config.json` 和 `cpu-config.json`。服务启动并健康后，用新输出目录执行五格式预热及三次暖请求：

```bash
node scripts/acceptance/mineru-benchmark.mjs /home/joshua/.local/share/riskflow-mineru/evidence/gpu-config.json /home/joshua/.local/share/riskflow-mineru/evidence/gpu-next-run 3
```

输出目录必须不存在；runner只调用既有服务，启停仍由上面的Compose命令控制。五页扫描件的同源真值清单保存在 `evidence/long-suite.json`，可通过 `MINERU_SMOKE_SUITE` 和 Vitest `-t TRIAL-scan-pdf` 定向复验。

顺序执行对照，保持输入、模型、并发、CPU配额一致；CPU 测试期间停止日常 GPU 服务，测试结束后恢复：

```bash
docker compose -f deployment/mineru/compose.yaml stop gpu
docker compose -f deployment/mineru/compose.yaml --profile cpu up -d cpu
docker compose -f deployment/mineru/compose.yaml --profile cpu stop cpu
docker compose -f deployment/mineru/compose.yaml up -d gpu
```

基准复用 V2 五格式清单和同源5页扫描件，先校验源字段、记录关联、页码与JSON-LD，再记录冷启动/首请求和每样例至少3次暖请求。保存每次耗时、中位数、页/分钟、峰值RAM/显存、实际Vulkan offload及ONNX CPU providers。API任务缓存命中必须单独记录，不能用缓存时间代表推理时间；若不能可靠绕过缓存，应通过重启实例完成独立测量，并单列模型预热成本。

任务和文件索引在服务进程内；容器重启后旧任务ID不保证可用。RiskFlow须先耐久保存原始响应与转换结果；持久化上传目录不能代替客户端工件存储。本机测试不证明4090/Qwen共驻或最终离线商业交付许可。
