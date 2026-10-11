## Why

C37 先闭合完整业务界面、服务运行接线与功能验收，使识别、评估、预警、处置和审计链能够在现有环境中实际运行。签名、多平台正式包、禁网三 VM 部署与 RTX 4090 实测属于最终交付，移交 C38；当前可使用网络 API 推理后端。

## What Changes

- 将 C32–C35 完整界面及 C36 质量页统一归入 `apps/web`，复用唯一会话、HTTP/SSE、路由和确认机制；保留七成员生产 workspace 与薄 Electron HTTPS 客户端。
- 以真实 PostgreSQL、Qdrant、工件、API、Worker 和版本化业务配置完成当前功能验收，覆盖正式命令、后台终态、人工复核、权限拒绝、幂等重试、审计和端到端追溯。合成样本须标明“合成样本，待甲方复核”，不能用测试模型候选冒充真实推理结果。
- 本轮评分规则新增真实 C04 配置包来源分支，通过正式提交、复核、发布及依据解析入口验收；包工件及逐条证据替代该分支的 Agent/清洗引用。C17 知识编制继续使用现有 `knowledge-authoring` 定义。C19 Agent 评分规则编制的共享任务定义另行闭合，不注册第二个同类型定义，不计本轮 PASS。
- 扩展既有协议无关模型 port，在服务端以 `openai-chat` 与 `ollama-embed` 两种受控协议分别承载 MiniMax 结构化生成/会话流和指定 Ollama Embedding；保留 llama.cpp adapter。端点、模型身份、能力、尺寸、预算与适用的 API 凭据由受控配置冻结，业务及客户端不能指定或读取这些输入。当前验收不要求本地 GPU、权重文件或 llama.cpp 专用探针。
- 保留已实现的部署初始化、最小权限、耐久事件、维护窗口、逻辑副本、隔离恢复与人工回退能力，按现有环境验证适用契约；实际拓扑可在功能环境中合置服务，最终三 VM 隔离与硬件基准另行取证。
- C37 的 PASS 只表示已批准功能范围通过。全部当前任务、真实功能证据和必要审计完成后，可按项目流程集成及归档；缺少未来正式签名、原生构建机、4090 或离线介质不阻塞 C37。
- 将 Windows 11 x64、Ubuntu 24.04 x64、macOS 14+ arm64 正式安装包及签名/公证，三 VM 禁网安装，本地模型/OCR/系统介质和许可核验，RTX 4090 24GB/128GB 性能与资源隔离实测移交 `deliver-mvp-acceptance-and-delivery-evidence`（C38）规划。最终交付仍须真实证据，C37 功能报告不能替代。
- 纠正验收命令与实现的漂移：当前 `deployment:smoke` / `deployment:benchmark` 仅执行配置校验，`test:desktop` 仅执行单元测试；施工图分别标出当前功能证据与 C38 待实现的正式交付入口。

## Capabilities

### New Capabilities

- `platform/offline-private-deployment-and-operations`：服务初始化、生命周期与受控恢复；区分当前联网功能验收和最终离线部署交付。
- `platform/electron-https-client`：共享 Web 的安全桌面入口；多平台正式包与安装取证适用于最终交付阶段。

### Modified Capabilities

- `platform/llamacpp-model-gateway`：在同一三能力 port 下由 OpenAI 兼容聊天与 Ollama 原生 Embedding 协议合并提供网络能力，分开验证 llama.cpp 构建身份和网络服务协议/模型身份，保持确定性复验与审计。
- `platform/engineering-baseline`：四应用三共享包的 workspace、构建与依赖边界。
- `web/engineering-and-knowledge-ui`、`web/identification-and-review-ui`、`web/assessment-warning-and-response-ui`、`web/agent-audit-and-operations-ui`：生产界面和真实浏览器验收归 `apps/web`，保留既有业务权限与版本契约。
- `platform/web-shell-interaction-primitives`：统一工程与系统管理确认，冻结命令身份及输入。

## Impact

- **基线与依赖**：保留 IP-01–IP-14 原施工基线 `6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`；本次增量 IP-15/IP-16 固定于当前 HEAD 的完整 commit 身份（见施工图）。既有 C03–C36 直接依赖不变，C38 仍依赖 C37；不改执行图或活动调度状态。
- **所有权**：本次根据已批准的兼容性结论同步 proposal、delta specs、design、implementation-plan 与 tasks。模型 adapter、宿主配置/组合、测试及功能验收仍由 IP-15/IP-16 按施工图实施；相关任务保持未完成，verification 由 Finalizer 在固定实现检查点后创建。
- **复用与依赖治理**：继续复用 C03 持久化、C04 工件、C05 core model port、C06 授权、C08 Agent、C13 OCR、C20 检索及 C24/C30 图；网络 HTTP 使用 Node 原生 fetch 与现有 Zod，不新增 SDK 或依赖。C19 唯一正文 Schema 增加已批准的配置包来源互斥分支，公共模块命令及事件不变。已有 Electron/Router/ECharts/Caddy 精确版本及许可治理继续有效。
- **功能输入**：批准的网络模型服务、受限秘密文件、模型/协议版本与尺寸、业务策略和样本。外部服务只接收有资格的验收资料；服务不可用或缺少必需能力时对应功能验收 BLOCKED，不自动换模型或跳过 Agent。
- **追踪**：横切 RI-S1–RI-S6、RA-S1–RA-S7；模型候选仍进入确定性校验，P/C、矩阵、阈值及人工决定不因后端变化而改变。
- **最终交付移交**：移交清单在本 change 的 tasks 与施工图中供 C38 规划消费，当前不创建第二个活跃 change。C38 必须先闭合对应规格和任务，再执行正式制包、离线部署、恢复与硬件取证；原命令校验配置成功不构成交付通过。
- **范围外**：当前正式应用分发及硬件交付；HA/PITR、独立冷备、灾备、生产级 RPO/RTO、长期代运维、自动换模型/扩预算、LoRA、移动/PWA、本机业务后端和离线业务同步。
