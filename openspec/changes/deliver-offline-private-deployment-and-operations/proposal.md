## Why

C03–C36 已提供领域运行时与业务页面，但完整 UI 仍未归入生产 Web，仓库也缺少真实服务启动和离线交付入口。C37 将完整 UI 统一迁入 `apps/web`，交付加载内网 HTTPS 的薄 Electron 客户端，并把既有能力接到三 VM 私有部署与同机逻辑恢复流程，为 C38 提供真实交付依据。

## What Changes

- 沿已确认产品决议交付一台物理服务器内的推理、应用、数据三台虚拟机部署，推理 VM 使用 GPU 直通；只有应用 VM 的 HTTPS 入口向业务用户开放。制备带精确版本、容器镜像 digest、模型/OCR 制品、许可证和 SBOM 的离线包，安装和运行不得隐式联网下载。Docker Compose 并非已确认决议，不将其写成部署前提。
- 增加部署配置与秘密文件入口，复用现有 strict Schema 冻结模型、OCR、工件、检索、Agent 和运行策略；建立 C03 LOGIN 主体、迁移和 C06 首次管理员初始化流程。
- 增加真实 API、Worker 和已归档事件消费者的启动/停止接线。API 工厂继续不监听、不迁移；业务代码不复制领域规则，后台任务不替代 LangGraph。
- 注入既有 C35 安全健康与模型版本查询，提供宿主就绪检查、脱敏日志、容量和资源监测；明确 OCR 与 llama.cpp 的独立资源分配。
- 提供维护窗口内的同机逻辑副本、隔离完整性核验和人工升级回退流程。复用 C04 `createHashManifest` / `reconcile`，保持数据库、审计、Outbox、checkpoint、工件和部署版本一致；同机副本只用于逻辑回退，不宣称独立备份、灾备或生产级 RPO/RTO，不增加持续备份或定期演练。独立冷备仅为后续单独采购选项。
- 在最低目标 RTX 4090（24GB）与 128GB 主机内存环境实测离线安装、真实模型/OCR、双索引重建、重启、同机逻辑恢复与资源隔离，记录耗时、资源和质量边界。模型部署包络沿已确认候选，但实际构建、权重身份与许可仍由发布介质核验；不承诺未经测量的吞吐和更高配置能力。
- 按用户本轮确认，将 C32–C35 完整业务界面迁入 `apps/web` 并合并 C36 质量页面，统一 React 19、根 pnpm 锁文件、生产构建和浏览器验收。迁移真实页面与可复用视觉，原型 fixture、状态注入和审阅设施保留在生产依赖之外。
- 增加 `apps/desktop` 薄 Electron 客户端，加载应用 VM 的同一 HTTPS 页面，复用 Web 的 Cookie、HTTP 与 SSE，不复制 UI、业务命令或本机后端。冻结桌面平台与安装包身份，验证证书、导航限制、连接失败、重连及关闭窗口后服务端任务继续。
- 先完成代码、部署与打包配置、验收程序及工程检查，再交接 Finalizer 审查；正式包制备、三平台安装、三 VM 与目标硬件取证作为后续交付验收。缺少真实介质、生产证书、签名材料或目标环境只阻塞对应交付验收，不阻塞无关实现和工程审查；全部必需证据齐全前不宣告 C37 交付通过或归档。
- 将生产 workspace 目标调整为四应用三共享包；保持单向依赖、精确根锁文件与统一治理。Web 保持独立于 Electron，后续移动浏览器可复用；本次不交付移动适配、PWA 或脱离服务器的离线业务。

## Capabilities

### New Capabilities

- `platform/offline-private-deployment-and-operations`：离线发布包、部署初始化、真实服务生命周期、受控运维、维护窗口备份、隔离恢复核验、版本切换和目标环境验收。
- `platform/electron-https-client`：内网 HTTPS 桌面入口、Web 复用、受限本机能力、连接与会话恢复、离线安装包和桌面真实验收。

### Modified Capabilities

- `platform/engineering-baseline`：六成员调整为七成员，构建、冻结依赖和应用边界检查覆盖 Desktop；不允许跨应用源码依赖。
- `web/engineering-and-knowledge-ui`、`web/identification-and-review-ui`：API 接入与生产浏览器验收归属从 demo 改为 `apps/web`，保留原业务与权限语义。
- `web/assessment-warning-and-response-ui`、`web/agent-audit-and-operations-ui`：明确页面和真实浏览器验收归 `apps/web`，保留原版本、命令与确认契约。
- `platform/web-shell-interaction-primitives`：统一确认原语覆盖工程与系统管理作用域，保留原命令冻结与权限语义。

## Impact

- **路线与基线**：C37 `deliver-offline-private-deployment-and-operations`；base commit 为 `6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`。直接依赖 C03、C04、C05、C06、C07、C08、C09、C10、C13、C20、C24、C30、C32、C33、C34、C35、C36 均已归档；实时 `resumeQueue` 以 C37 为队首，`violations` 为空。
- **实现所有权**：部署配置、宿主组合与 CLI、三 VM 服务/端口清单、操作手册、部署行为测试、`apps/web` 的完整页面迁移及 `apps/desktop` 的主进程、安装包和真实验收。根 workspace、TypeScript references、依赖政策、跨应用检查与 `openspec/config.yaml` 的成员描述在 C37 实施时同步。业务事实仍由原模块拥有，恢复不得按工件文件补造事实。
- **复用**：C03 bootstrap/migrations/Outbox/checkpointer，C04 内容寻址存储及维护接口，C05 llama.cpp 网关，C06 身份与授权，C08 runner，C13 OCR parser，C20 投影与检索，以及 C24/C30 现有组合根。浏览器验收 harness 仅供了解真实接线，账号、固定口令、模型替身和合成结果不得进入生产。
- **依赖治理**：复用 React 19、Vite 和测试基线，Router 6.30.6、ECharts 5.6.0、Electron 44.7.0、electron-builder 26.15.3 与 Caddy 2.11.7 按 design 冻结精确版本、官方来源、许可证、离线介质和退出条件。服务端 Node 与 Electron 内置运行时分别记录。外部 PostgreSQL/Qdrant/llama.cpp/Paddle 制品由清单锁定身份，缺项阻止打包；不补装原始规划提及但现有实现未使用的整套框架。本轮不安装依赖或更新锁文件。
- **追踪**：横切 RI-S1–RI-S6、RA-S1–RA-S7；重点保持资料/知识/风险/评估/预警/处置/偏差链、版本、审计与 checkpoint 的共同恢复，不增加领域判断或业务阈值。
- **产品决议依据**：`.scratch/riskflow-master-plan/issues/08-private-deployment-governance.md`（三 VM 与冷备/恢复责任），`issues/21-mvp-toolchain-dependencies.md`（正式前端与单一工具链），`prototypes/openspec-delivery-roadmap.md` Wave F 与 §11（三 VM、4090/128GB、同机逻辑恢复和早期 RPO/RTO 规划修正）。这些是已确认产品范围记录；具体模块行为仍以已归档主规格和当前代码为准。
- **范围外**：高可用集群、热备/PITR、跨站灾备、独立冷备、持续备份、周期演练、生产级 RPO/RTO、长期代运维、自动扩容、自动换模型、LoRA 微调、业务规则默认值、通用 Shell/SQL/文件管理 API，以及 C38 的合同总验收。逻辑恢复先作为受控运维 CLI 交付，浏览器不新增破坏性恢复按钮。
- **设计依据**：`.scratch/riskflow-master-plan/prototypes/desktop-client-architecture.md` 及同步后的宏观架构、界面规格、工具链与 C37 路线。客户端入口已获用户确认，原型的本地资源/hash 路由假设不约束 HTTPS 方案。
- **规划与实施状态**：proposal、delta specs、design、固定基线 implementation-plan 与 tasks 已齐备；实施进度以 tasks 勾选及可运行证据为准。工件校验不代表实现完成，工程检查通过也不代表实机交付验收通过。
