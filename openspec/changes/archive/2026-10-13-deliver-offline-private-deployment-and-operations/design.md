## Context

本 change 保留已实现工程成果，完整功能和剩余实现移交 `complete-private-deployment-functional-acceptance`。IP-01–IP-14 原基线为 `6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`，IP-15/IP-16 增量基线为 `0a25b6a469ade4bcc6a21c4514195d1f7c19ff31`；当前 HEAD 为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`，工作区还有累计实现，不能视为固定检查点。

已实现 Web 迁移、Electron 薄壳、网络 adapter、真实 API/Worker 工厂、三图/共享任务/Outbox、初始化和运维程序、provision 与终态观察。可启动宿主仅为 synthetic-acceptance 合置本地 C04；remote verifyContent 与完整跨 VM host 尚未开放，交 C38 F-03。完整 Electron e2e 与正式业务证据归后续 change，不把代码存在或空轮询作为业务 PASS。

产品设计入口为 `.scratch/riskflow-master-plan/prototypes/desktop-client-architecture.md`，恢复责任来源为 `issues/08-private-deployment-governance.md`。D-01–D-24 保留工程设计身份；其中 C38 平台/介质/实机条款仅说明阶段边界与移交，不属于本次 checkbox。

## Goals / Non-Goals

**Goals**：核验并保留完整 UI、共享 HTTPS 壳、部署/运维程序、模型 adapter、真实组合和有界验收工具的已实现成果，保持权限、预算、版本、人工确认与审计边界。

**Non-Goals**：后续完整业务/Electron 功能取证、跨 VM 完整 host、最终签名/安装/离线介质/硬件交付，以及 HA/PITR、灾备、RPO/RTO/SLA、长期运维、自动换模型/扩预算、LoRA、移动端和本机业务后端。

## Decisions

### D-01. 服务器沿既定三 VM 拓扑

C37 当前功能环境只要求三种职责及其接口边界，不要求三台实际 VM；各逻辑角色可以登记同一宿主，使用真实 PostgreSQL/Qdrant/工件及网络 API 模型服务。只有应用 HTTPS 面向用户。以下三 VM/GPU 布局是 C38 最终部署目标，不是当前功能验收前置。

同一物理服务器内：推理 VM 直通 GPU 并运行 llama.cpp/模型；应用 VM 承载 Web、API、Worker、HTTPS 入口与必要解析；数据 VM 承载 PostgreSQL、Qdrant 与不可变工件。普通客户端只访问应用 HTTPS，内部服务和管理网络分别受限。API 与 Worker 分进程，继续直接复用领域模块，不通过内部 REST/MCP 互调。

systemd、Caddy 与数据 VM 本地 C04 流服务分别按 D-16/D-18 装配，客户端仅连接集中 HTTPS；Docker 只承载数据服务的固定 OCI 制品。

### D-02. 发布与配置保持唯一且类型化

`ReleaseManifestV1` 固定 release/codeHead、平台、工具链、服务端与桌面制品、精确版本、相对介质位置、字节数、摘要、官方来源、许可证与 SBOM；OCI 项另含 digest，不使用 latest。

`DeploymentConfigV1` 固定推理/应用/数据三个逻辑角色、数据与秘密定位、精确策略及生命周期预算；功能环境允许角色共用宿主，不把 hosts 数量当作三台实际 VM 的证据。模型按 D-23 显式选择后端，MinerU 按 `adopt-mineru-document-ingestion` 显式选择官网精准 API 或自托管 V1，工件继续原 Schema。配置归宿主边界，不进入业务 DTO 或图状态；桌面配置只含批准 HTTPS origin 和公开身份。

独立秘密文件按各 VM 运行主体最小权限加载，密码/TLS 私钥/HMAC 不进入源码、镜像、日志、argv、发布 JSON 或恢复描述。部署 strict Schema 的完整字段和公开导出按 D-19 冻结。

### D-03. 制品与新增依赖在施工图前冻结

复用 Node `>=24.12.0 <25`、`pnpm@11.10.0` 与 React 19.2.8。已有真实基础设施参考为 PostgreSQL 18.6-bookworm、Qdrant v1.19.0 的仓库固定 digest，以及 独立 change `adopt-mineru-document-ingestion` 固定的 MinerU 4.0.12 与专用模型；实际发布清单必须核验真实制品，不能复制测试标签冒充发布。

C37 网络 API 的模型/协议身份、上下文、维度、能力与预算按 D-23 冻结，不要求本地权重或推理 GPU；OCR 仍须有真实解析能力。llama.cpp 权重、完整离线 OCR/驱动介质与许可核验、RTX 4090 24GB/128GB 基准归 C38。原聊天候选包络不作为当前 API 型号，也不构成未测吞吐承诺。

已有 Electron、打包工具、Router 6.30.6/ECharts 5.6.0 沿 D-16 的精确锁定与许可治理；本次增量使用 Node fetch 和已有 Zod，不新增依赖。Electron 内置 Node/Chromium 与服务端 Node 身份分别记录；正式平台介质与 SBOM 由 C38 核验。

### D-04. 宿主组合消费公开模块

`scripts/deployment/` 消费已构建的 API、Worker 和 adapters 公开入口，沿既有质量 CLI 的宿主形态，不使应用互导源码。领域记录、事务、人工决定、矩阵和业务策略仍归所属模块。

装配覆盖数据库/C04/C06、工程数据/知识、模型/OCR、检索/Agent/复核、识别/评估/处置、C31 投影/C36 和 API ports。C20 的 policyProvider/qualityGate/queryInputReader/authorize 与 C30 的下游授权、空间配对、重试和人工决定证明必须接真实所属能力；不能使用永真、任意 execute、空仓储或 harness SQL。

每个必需 option、授权上下文与事件 handler 在施工图中逐项映射。缺少公开 reader 时先补设计，生产接线不完整则启动失败并释放资源。全部 provider 与事件处理按 D-20/D-21 及施工图映射接入。

### D-05. 初始化与运行连接分开

显式初始化调用 C03 bootstrap/migrations/checkpointer 与 C06 首次管理员引导。保留四个 NOLOGIN 组，创建职责化 LOGIN：migrator、API app、Worker app+outbox、独立 checkpointer。运行进程不持超级用户/迁移/宿主控制凭据；账号库非空不重新引导管理员，重放保留已有事实。启动只检查兼容迁移版本，不自动 DDL。

### D-06. Worker 驱动耐久任务与事件

宿主驱动 C08 `runOnce` 与 C03 Outbox 的 claim/acknowledge/recordFailure，固定并发、租约、批量、轮询和关闭期限。按闭合事件清单调用所属幂等 handler，必要消费者耐久完成后才确认投递；未登记 handler 不能自动吞掉事件。

SIGTERM 停止新请求和 claim，取消允许取消的读取，在原预算内收口、关闭 SSE/图/工件/连接。超时不是停写证明；未知执行保持原任务恢复语义，不重开任务、扩预算或自动采纳人工决定。

### D-07. 应用 VM 提供同源 HTTPS 与有界观测

Web 静态资源、API、SSE 共用同一 origin，生产深链刷新可用，`/api/` 不作 SPA fallback，客户端不依赖开发服务器或公网资源。HTTPS 终止/静态托管使用 D-16 冻结的 Caddy；保留 API 工厂无监听、迁移和后台副作用，不再预设必须为 Fastify 增加 TLS。

存活与就绪区分，维护或必需依赖/接线缺失使就绪失败。C35 仍使用当前管理员、四组件、32 项及既有时间边界。探针响应 AbortSignal 并有整体截止时间，不能只依赖当前 collector 的定时器。结构化日志/指标/链路仅含安全引用、原因码、计数和耗时，配置容量与保留，不代替 PostgreSQL 审计或自由读取业务正文。

最终 GPU 归推理 VM；MinerU 使用辅助 NVIDIA GPU 与独立并发/显存/内存/时间预算，主 4090 运行 Qwen3.8-27B，embedding 保持独立 Ollama 主机。C37 如实报告网络 API 与 OCR 实际可观测状态，不伪造远端 GPU 指标；目标环境资源隔离效果由 C38 测量。

### D-08. 逻辑恢复经受控运维 CLI

运维 CLI 提供发布核验、初始化、服务状态/维护、逻辑副本、隔离恢复核对、激活、回退与基准的闭合动作，不接收自由 Shell/SQL/任意路径。Web/桌面不提供破坏性恢复执行或宿主运维凭据；C35 备份页保持能力缺席的真实呈现。

副本/恢复要求宿主运维授权与 C06/C04 全工程、资料及空间的有效授权；系统管理员不默认拥有工程正文权限。C04 原 `engineering-data.freeze` 与 `artifact-hash-manifest` 用途保持。长动作在关键副作用前复验权限，工程集合与真实实例登记一致，不能静默跳过无权工程。

激活需确认已核验的精确副本和目标；输入变化令确认失效，不默认确认。相同 operationId/输入复用原阶段，异载荷失败闭合。操作字段与互斥/租约按 D-19 的完整 Schema 执行。

### D-09. 停写后建立同机逻辑副本

采用 PostgreSQL 完整逻辑导出与不可变工件副本，在三 VM 协调的同一维护窗口操作。停止全部业务/Worker/维护写入并确认在途收口，未知外部写入者或关闭超时即失败。

顺序：核验全部工程授权与容量 → 分配批次/数据库/文件快照业务引用 → 逐工程生成并完整消费 C04 哈希清单，使清单字节与登记成立 → 导出完整数据库 → 复制全部耐久工件（含本批次清单）→ 耐久发布待核验描述 → 隔离核对通过后登记可用逻辑恢复点。不能先 dump 再登记清单；不能只复制可见文件。

C04 快照引用是业务追踪，不能当 PostgreSQL 导出快照令牌。清单采用 registry 原专用只读事务，跨工程一致性依赖已停止写入的窗口；清单生成后不得插入改变原核对集合的诊断工件。staging/quarantine 只保留并报告，不自动清理。

恢复、回退和相关运维动作可靠写入 PostgreSQL 只追加审计。宿主阶段记录只用于崩溃恢复与未完成动作诊断，不替代数据库审计，也不作为业务事实源。审计失败阻止成功结论；数据库不可用时保留待补审计阶段并报告未完成。实际 dump/复制与最终审计的时点按 D-09 与 D-19 执行，避免核对期间改变工件集合。

### D-10. 隔离核对与人工切换

恢复写入新的隔离数据库和工件根，原实例保持。复用 C04 recovery reconcile：完整消费 findings，再 await summary，核验 passed 与正式审计引用；损坏、缺失、快照冲突、未消费完或审计失败均阻止通过。

先核对全部工程原副本集合，再产生新诊断工件。验证权限、迁移、审计、Outbox/checkpoint 与正式结果；Qdrant/BM25 从正式事实、原模型和策略重建，通过 C20 就绪门。空索引不是成功，不能补造领域登记。

隔离阶段不消费未决业务任务或对外开放。切换需人工确认精确目标，旧会话失效并重新认证，人工等待与冻结预算保持。安全恢复条件不足时失败，不以换模型或重开任务解决。切换失败保留两个数据根，按记录回到旧目标，不自动删除。

### D-11. 系统回退与数据恢复分别核验

软件、模型、Embedding 与业务定义发布分别管理。兼容旧发布可在维护窗口人工切换并复验；不兼容数据库/工件版本需先构造匹配副本的隔离实例，不能只换旧镜像。此流程服务于升级和逻辑故障恢复，不提供宿主故障下的数据保护承诺。

### D-12. 工程成果与后续功能取证分别收口

Web 迁移及既有真实 Chromium/HTTP/PostgreSQL harness 属已实现工程证据；模型 adapter 三能力 smoke 只证明模型接缝。当前 change 的 verification 记录工程范围、实际命令和固定检查点/审计条件，不将完整业务、Electron 场景或未来平台证据记为通过。

完整业务、可见 Chrome、当前平台 Electron、正式来源补证与对应报告移交后续 IP-17–IP-22，逐项范围映射见其 handoff.md。缺证据仍 FAIL/BLOCKED，不因拆分消除义务。后续 functional PASS 不等于离线/合同交付；C38 F-01–F-05 仍独立取证。

### D-13. 文件所有权与当前修改边界

| 区域 | C37 目标变化 |
| --- | --- |
| `apps/web/` | 完整页面、真实客户端接线、导航/主题/图表复用、C36 合并与浏览器验收 |
| `apps/desktop/` | Electron 主进程、受控 HTTPS 入口、本地连接状态与平台打包程序；完整真实验收移交后续 |
| `deployment/`、`scripts/deployment/` | 三 VM 服务模板、发布/导入程序、合置组合与生命周期、逻辑副本/核对/切换；真实基准交 C38 |
| `packages/adapters/src/deployment/`、`packages/adapters/src/model/` 与公开 exports | 部署/后端配置、模型 adapter 与共用调用校验，保持原 core model port |
| `scripts/acceptance/` | 复用合成材料 check/run，增加真实异步终态和功能证据核验 |
| 根 workspace、package、tsconfig、依赖政策与检查器、dependency-cruiser | 七成员、Desktop 构建/依赖/边界与独立平台打包命令 |
| `openspec/config.yaml` | 实施时同步四应用三共享包的当前工程描述 |
| Playwright/相关 Vitest 配置和测试 | Web 生产验收归属迁移；桌面与部署真实行为验证 |
| 项目设计文档与 C37 artifacts | 本轮拆分范围与验收材料；保留已有全部实现 |

主规格通过当前完整 delta 在归档时同步，保持 Requirement 名与原场景；C32/C33 Purpose 中的 demo 归属也须在正式同步核查中修正，不能留旧目录描述。归档历史不重写。原执行图、Orca 状态、历史迁移、业务规则与用户改动属于保护边界。

### D-14. Electron 仅提供 HTTPS 桌面入口

新增 `apps/desktop`，使用系统原生标题栏，主进程加载批准 HTTPS origin。不本地打包 React UI，不导入 Web 源码，不改变 Web 既有路由/base 或同源 Cookie/SSE。业务 renderer 禁用 Node、启用 context isolation/sandbox/CSP，导航按 URL 的协议/origin/用途校验，禁止任意新窗口和外部目标。

首期使用原生浏览器文件选择与经授权下载，不提供特权 preload/业务 IPC。连接失败由本地无特权状态页与主进程重试入口处理。后续确需桌面增强须通过具体有界接口，不暴露通用能力。私有 CA 经系统信任链部署，不忽略证书错误。

独立客户端会话不与普通浏览器共享，Cookie 不经 preload/日志暴露；不持有数据库/模型凭据。关闭窗口只断开 UI，原服务器任务继续；重新打开先认证并读取同一任务。断线不自动提交未知结果命令，订阅继续沿原游标和预算恢复。

### D-15. 服务端、桌面与后续移动发布独立

服务端提供完整 Web UI，C37 以独立浏览器为功能主入口并检查现有 Electron 安全边界。C38 正式桌面包固定 Electron/Chromium/内置 Node 和批准平台身份，与服务端分别记录兼容范围；人工升级不引入公网自动更新。每个最终声明平台须有真实安装与安全验收。

Web 保持浏览器独立，后续手机/平板可复用页面与 API，但触摸、小屏、宽表格和复核操作需要单独适配。Electron 不提供移动运行时；当前不扩入 PWA、移动原生封装、本地业务缓存或同步冲突协议。

### D-16. 部署工具、平台与依赖冻结

服务端 VM 基线为 Ubuntu 24.04 LTS x64；systemd 管理 Node API/Worker、工件服务、Caddy、llama.cpp 与 MinerU 进程。PostgreSQL、Qdrant 使用离线导入 OCI 镜像，由 systemd 调用 Docker Engine 的固定容器启动/停止，不使用 Compose 或容器内业务编排。Docker Engine、GPU 驱动、llama.cpp/MinerU 的实际二进制与系统包须由 ReleaseManifest 精确记录版本、架构、摘要和许可；这是发布介质输入。

| 依赖 | 冻结身份 | 用途 / 退出条件 |
| --- | --- | --- |
| React / Node / pnpm / Vite / Playwright | 沿当前根锁文件与工程基线，不升级 | Web 与服务构建；另开 change 才改变版本 |
| react-router-dom | 6.30.6，MIT | 迁入页面已有参数路由；迁移到其它路由时移除 |
| echarts | 5.6.0，Apache-2.0 | 复用已完成的知识图/矩阵/趋势；图表实现替换时移除 |
| Electron | 44.7.0，MIT；Chromium 152.0.7977.130 / Node 24.21.0 | HTTPS 桌面壳；取消桌面形态时移除 |
| electron-builder | 26.15.3，MIT，精确锁定、不跟随 dist-tag | NSIS/AppImage/DMG；更换打包工具时移除 |
| Caddy | 2.11.7，Apache-2.0，官方 Linux x64 二进制 | 同源 TLS 与静态资源；替换 HTTPS 入口时移除 |
| PostgreSQL | 18.6-bookworm，镜像 digest 见下 | 已有 C03 数据库，不迁移版本 |
| Qdrant | v1.19.0，镜像 digest 见下 | 已有 C20 投影，不迁移版本 |

镜像分别为 `postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af` 与 `qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`。镜像只能本地 load，启动使用 pull=never。数据目录是数据 VM 本地持久卷。

Caddy 显式配置证书/私钥并关闭 automatic HTTPS/ACME；`/api/*` 反代本机 API、SSE 不缓冲，保留原 Origin；其它合法 Web 路由走静态资源/SPA fallback，API 404 不能返回 HTML。生产 CSP 禁止任意外域、unsafe-eval 和 Node 能力，ECharts 用 Canvas/SVG、不依赖内联执行脚本。证书维护通过宿主流程完成，客户端不接受证书豁免。

C38 最终桌面交付矩阵为 Windows 11 x64 / NSIS、Ubuntu 24.04 x64 / AppImage、macOS 14+ arm64 / DMG，各自在原生环境制包/验收。Windows 组织签名、macOS Developer ID 与预附公证、Ubuntu 介质签名/摘要继续为正式包要求；缺项拒绝正式制包。准备可联网，正式离线构建与安装须有本地 electronDist 和完整缓存，携带 LICENSE/NOTICE/SBOM。本轮不增加未签名分发模式，不把正式包材料作为 C37 功能验收前置。

已有打包程序的本地测试仅证明输入与拒绝契约。正式签名、许可/SBOM 收齐和平台安装效果由 C38 验证或补实现，不由已勾选的工程任务推定完成。

来源：Electron [44.7.0 发布](https://github.com/electron/electron/releases/tag/v44.7.0)、[DEPS](https://github.com/electron/electron/blob/v44.7.0/DEPS)、[安全说明](https://github.com/electron/electron/blob/v44.7.0/docs/tutorial/security.md)；[electron-builder 26.15.3](https://registry.npmjs.org/electron-builder/26.15.3)；[Router 6.30.6](https://registry.npmjs.org/react-router-dom/6.30.6)、[ECharts 5.6.0](https://registry.npmjs.org/echarts/5.6.0)；[Caddy 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)。版本证据截至 2026-10-08，实际构建与离线缓存仍由测试证明。

### D-17. Web 迁移与唯一通信、路由、确认机制

React 19 和现有 Web AppShell/主题是唯一应用宿主，迁入 demo/src 已接真实 API 的页面、Agent 停靠与所需组件/图表，不复制 demo App/main、AppShell、静态 content、会话与通用 client。迁移闭包见施工图附表。demo/v2 只作既有视觉来源，不将未接线页面覆盖真实页面。

引入 React Router 6 BrowserRouter，统一拥有 history；WebRouteContribution 继续拥有导航顺序、路由 path、能力和 renderer 元数据，App 用 Router hooks 驱动上下文/导航/焦点。七项业务导航顺序保持，Agent 与系统管理仅辅助入口。/projects 对应原 /project，/review-audit 对应原 /review；旧前缀使用保留参数和 search 的重定向。参数详情深链由已迁入页面的 Routes 注册；/assessment 根为待评估页，C36 quality contribution 改为 /assessment/quality，质量入口和现有测试同步，不改质量查询契约。登录回跳只接受本站业务路径，工程/revision 从 URL 与真实会话恢复，禁止从 content/context 补数据。

唯一 HTTP 客户端是 apps/web/src/api/http.ts#createC09Client，页面模块迁移 demo 的业务编码/解码，DTO 引用 contracts 的 Schema；保留固定分支 registry，不提供任意 URL 方法。增加闭合 system operation：administration.read (GET /api/v1/administration)、administration.query (POST /api/v1/administration/queries)、administration.command (POST /api/v1/administration/commands)、operations.query (POST /api/v1/operations/queries)。这些操作分别使用既有 SystemAdministration/SystemOperations 输入输出 Schema，session/Cookie/error 仍由同一客户端拥有；report/artifact 下载保留既有 HTTP 工件接口，不将宿主文件路径暴露给页面。

扩展唯一确认控制器的类型以覆盖 project 与 system：plan 的 scope 判别为 project（projectId/context revision）或 system（真实管理 context ref/session revision），operationId 是上述闭合 registry 的联合。成功结果类型为 ContractReferenceV1 | AccessCommandResultV1，允许既有领域引用或管理命令回执，不伪造领域 resultRef；界面据回执刷新。调用方在打开确认前冻结完整请求的 commandId/idempotencyKey/issuedAt/版本/目标/范围/载荷，深冻结 request；重试复用原请求，不重新生成 issuedAt。上下文切换、撤权、过期版本清除计划；提交中的迟到响应不能覆盖新上下文。demo ConfirmButton 改为对现有 CommandConfirmationDialog 的适配，不能保留第二套确认状态机。

EvidenceDrawer 迁入真实 readEvidenceAccess 分支，删除 content/evidence 静态回退；缺来源/无权/损坏用真实七态。Agent 自动刷新沿既有固定限额和单请求语义，卸载/隐藏/工程切换清理 AbortController、订阅和候选，服务器继续拥有任务事实。

### D-18. 数据 VM 工件流接缝

C04 的本地 hardlink/rename、文件与目录 fsync 留在数据 VM；不采用跨 VM 挂载作为生产工件根。应用 VM 注入 ArtifactStoreV1 的 HTTPS 流适配，referenceGuard 仍在应用 VM 以同一 PostgreSQL transaction 检查登记，maintenance 只在数据 VM 运维 CLI 运行。C04 DTO、用途码、权限与事务语义不变。

新增内部服务只提供 POST /internal/v1/artifacts/put 和 POST /internal/v1/artifacts/open，分别消费原 ArtifactPutCommandV1 与 ArtifactReadRequestV1；没有通用路径、列表、删除或远程 maintenance。mTLS 验证应用服务身份和私有 CA，端口仅应用 VM/管理网可达；请求内 C06 context 必须从真实数据库复验当前主体、工程、capability、资料和空间，再交给 C04，传输凭据不等于业务授权。

put 请求为 application/vnd.riskflow.artifact-stream-v1：每帧一字节类型 + 四字节大端长度 + payload，类型 1 为唯一 JSON command，2 为 bytes，3 为结束帧（零长度）；未知/重复/缺帧拒绝，JSON 不超 metadataMaxBytes、数据帧不超 1MiB、累计不超 C04 maxArtifactBytes。成功响应 JSON 为原 ArtifactPutResultV1，C04 耐久登记后才发；中断后的重试沿原身份读回，不能生成新工件身份。open 请求为原 JSON，响应使用同一 framing：1 为 ArtifactManifestV1、2 为 bytes、3 为 ArtifactReadReceiptV1，4 为既有 ModuleErrorV1；只有完整消费且 receipt/hash/长度与 manifest 一致才 resolve verified，否则 reject。未消费、截断、超额、权限拒绝都不能视为成功。正文采用背压流，禁止全量缓冲。

TransportPolicyV1（部署 Schema）固定 ref、connectTimeoutMs、idleTimeoutMs、totalTimeoutMs、metadataMaxBytes（<=1MiB）、maxConcurrentRequests 和 shutdownTimeoutMs，皆为显式正整数；total >= connect/idle，不能扩大领域预算。客户端持有 transport AbortController，取消/断流销毁流和 socket；服务端在有限期限停止新 put/open，systemd 超时终止则运维报告未完成，不能证明停写成功。维护开始先停止 API/Worker，再停工件服务并确认所有写者停止；本地 maintenance 是唯一允许的新写者。参考登记 factory 与 C04 模块同目录公开导出，不能把 getPostgresTransaction 暴露给宿主。

### D-19. 部署输入、运维状态与审计 Schema

这些是宿主契约，唯一导出位于 @riskflow/adapters/deployment；不放进业务 HTTP DTO 或业务配置版本。

| Schema | 固定字段与约束 |
| --- | --- |
| ReleaseManifestV1 | schemaVersion=1、releaseId、codeCommit、createdAt、server/desktop 兼容身份、artifacts（id/kind/version/os/arch/sha256/byteLength/relativePath/officialSource/licenseRef/sbomRef，OCI 另含 digest）、配置模板引用、迁移最终版本、手册引用；相对路径无越界/链接，唯一身份，所有必需依赖可解析 |
| DeploymentConfigV1 | schemaVersion/ref/releaseId/instanceId、三个逻辑角色 host 与端口（功能环境可同宿主）、publicOrigin、local roots、database secretFileRefs/LOGIN roleNames、OCR/artifact/outbox/Agent 原 Schema、policyCatalogRef、projectBindings、workerPollMs/并发/停止期限、health/log/资源预算；模型另按 D-23 后端 registry 解析，strict、无隐式默认 |
| DesktopConfigV1 | schemaVersion=1、deploymentId、publicOrigin（纯 HTTPS origin、无用户信息/query/hash）、serverCompatibilityRange；配置由安装者受控写入，不让网页或自由 CLI URL 覆盖 |
| DeploymentOperationV1 | schemaVersion=1、operationId、idempotencyKey、action（verify/init/status/maintenance/backup/restore-verify/activate/rollback/benchmark）、releaseId/configRef/instanceId、actorId、currentAuthorizationRefs、issuedAt、expectedRevision、backupId/targetInstanceId（按 action 必需）、confirmation（精确目标/版本/修订；仅 activate/rollback）、payloadDigest |
| LogicalBackupDescriptorV1 | backupId、operationId、sourceInstanceId、release/config/model/OCR/policy refs、projectIds 与逐工程授权/manifestRef、dbSnapshotRef/fileSnapshotRef、dump/file 清单/摘要、迁移版本、停写证据、创建阶段与核验审计引用；秘密与连接串不进入描述 |
| DeploymentOperationResultV1 | operationId、revision、stage、status、safeReasonCode、release/instance/backup refs、perProjectAuditRefs、operationAuditIds、阶段计数/耗时；不返回正文、秘密或原始宿主路径 |

预算数值是经资源测量/批准配置，不在宿主里创造业务阈值。配置只引用 secrets 逻辑 ID，由每 VM 私有文件映射；校验运行用户/owner/权限及绝对路径无 symlink，秘密不进入参数、清单或日志。首次 admin 密码只经独立秘密文件传给 C06 bootstrap。配置拒绝任意程序、SQL、远程 URL 或命令片段。

DeploymentConfigV1 补齐必填 purpose（production / synthetic-acceptance）；database 的 host/port/name/maxConnections/connectionTimeoutMs/idleTimeoutMs 与 rolePasswordSecretIds（五个职责角色逐一对应秘密逻辑 ID），auth 的 hmacSecretId/keyVersion，api 的 host/port，models 的原 ModelGatewayDeploymentConfigV1 非空数组，artifacts 的原 ArtifactStorePolicyV1，outbox 的原 OutboxDeliveryPolicyV1，qdrant 的固定 baseUrl/requestTimeoutMs，policyCatalog 的绝对 filePath 与精确 catalogRef，documentConversion 的 resourcePolicy（原 DocumentConversionResourcePolicyV1）、qualityPolicyRef/converterDeploymentRef 及 mineru（独立 change adopt-mineru-document-ingestion 固定的 MineruConfigV1 或显式 null）。Agent 预算来自上述领域 catalog 的原策略，不重复定义。逻辑角色必须各出现一次；catalog purpose 与实例 purpose 必须一致，模型部署/ref 与策略引用须可解析。SSE policy 使用 API 公开原 Schema 在宿主加载时核验，adapters 不反向依赖 apps。配置不接受自由程序、SQL或业务请求修改服务地址。

初始化输入补齐 loginPasswords（按五个角色键逐项解析，值仅来自受限秘密加载器）和 checkpointerConnection（独立职责连接）。仅新建 LOGIN 时设置密码；重放不重置现有密码。迁移完成后用公开 setupPostgresCheckpointer 完成 checkpoint DDL 并关闭初始化连接；初始化不写 checkpoint，引用校验关闭失败。迁移兼容性使用当前发布清单声明的精确序号；更新数据库版本须先更新批准清单，不能将更高版本推断为兼容。运行进程只核验，不调用 setup 或持 migrator/operator 密码。

每项 projectBindings 补充 policyRefs（D-20 十六类的逐项 VersionReference）及 graphVersions（riskFlow、identification、assessment 三个 VersionReference）、retrievalBudgetPolicyRef。部署 policyCatalog.catalogRef 与绑定 policyCatalogRef 均使用完整 VersionReference；加载时同时核对 entityId/versionId、purpose 与条目的批准 releaseId，全部 policyRefs 精确可解析。projectId 不得重复。基础预置仅解析配置；API/Worker 装配前须完成引用及策略成员一致性校验，不按条目顺序或“最近版本”选择。

策略目录 filePath 必须位于既有 localRoots.dataRoot 内，复用数据集的受控文件读取：拒绝路径越界、任一父目录或文件符号链接及非普通文件，以 O_NOFOLLOW 打开，读取前和流式读取时均限制 1 MiB，并严格解码 UTF-8。目录的批准 releaseId 绑定同一发布清单，不新增介质 hash 或另一个批准字段。

DeploymentConfigV1 必填 retrievalQuality={datasets,containerRuntime,timeoutMs}。datasets 为 1–256 个 strict {projectId,datasetRef,filePath}，projectId 必须存在于 projectBindings，datasetRef 使用原 VersionReference，工程/数据集精确版本键唯一；filePath 为 localRoots.dataRoot 内无符号链接的绝对普通文件路径。每份 JSON 最多 64 MiB，正文使用原 DeploymentRetrievalDatasetV1Schema；加载时核对登记工程/数据集身份，production 不接受 syntheticSample。每工程 retrieval-acceptance 策略指定的数据集必须精确存在，不取首个或最近版本。containerRuntime 是安装者提供的实际容器运行时及版本身份（1–256 字符），timeoutMs 是批准的正整数总截止；不内置环境默认值。API/Worker 在连接、监听和 claim 前完成加载核验，provision 只解析配置，不要求资料预置之前数据集文件已存在。报告保存到既有 logRoot/retrieval-quality，每份报告使用新身份、临时文件 fsync 后原子 rename，内容绑定实例/发布/配置及原验收报告；保存失败不能通过门禁，不保存资料正文或秘密。

新增迁移 000056_deployment_operations.ts：business.deployment_operations（instanceId/operationId 主键、instanceId/idempotencyKey 唯一、payloadDigest、revision、action、stage/status、安全 inputRefs/resultRefs、leaseOwner/until）；business.deployment_causal_authorizations（rootContextRef/projectId/actorId/branch 主键、真实 childContextRef、invocationId、policyRef、recordedAt；只追加，由 C06 adapter 读取/复验）；business.deployment_operation_audit（eventId 主键、operationId/revision/action/stage/outcome/actor/contextRefs/releaseRefs/backupRef/reasonCode/timestamps，追加写，禁止 UPDATE/DELETE）。单实例活动写运维动作通过 PostgreSQL advisory lock + 操作行租约串行；expectedRevision CAS，每次阶段转换与其审计在同一事务。阶段为 validated→quiescing→quiesced→copying/restoring→verifying→awaiting-confirmation→activating→completed，失败落 failed 或 audit-pending；各 action 只使用相关阶段。租约过期只允许同身份复验外部效果后接续，不推断上次副作用未执行。

部署操作由宿主运维账号执行，专用 LOGIN 仅继承新 NOLOGIN riskflow_deployment_operator（运维表写/审计 append、必要读取）；业务 API/Worker 无宿主控制权限，也无运维状态/运维审计表写权限。因果授权关联表仅授 riskflow_app SELECT/INSERT（由 C06 签发适配使用），Worker 仅 SELECT，双方无 UPDATE/DELETE；后台每次仍复验关联的原 C06 上下文，关联行本身不能产生新权限。备份/恢复正文读取另用独立数据导出连接；宿主权限与 C06 全工程、资料、空间授权两者皆必需。新增 C06 受控 server-side 运维授权适配：读取真实持久授权并复验当前 actor/工程，复用 authorize/verify；不得构造假 context、伪工程或把 system admin 当正文授权。全工程集合经工程注册表窄读枚举，与配置实例 projectBindings 比较；漏项/无权均拒绝。此窄读在 registry 所属 adapter 实现，宿主不跨模块查表。

每工程 C04 hashManifest/reconcile 仍写原 C03 领域审计；部署审计表记录跨工程动作及其回执，不挤入封闭 ContractReference 联合。维护与复制期间宿主 journal 只记安全 operationId/stage/副作用回执，fsync+rename，用于崩溃诊断；无数据库审计回执不得声明 completed。先完成 manifest 登记再 dump/复制，复制结束后记录 live 数据库的 operation audit，描述精确标识 snapshot 与后续 audit 时间。恢复库在原副本集合核对完成之前不创建新诊断工件；后续审计只追加到完成基线核对后的库。

运维 CLI 不自动修改远程 VM：在三 VM 由授权操作者按固定 service 清单分别运行 local 维护动作，协调命令消费带 instanceId/releaseId/operationId 的阶段回执并核验固定内网探针，未经核验不进入 quiesced。systemctl/pg_dump/pg_restore/docker 仅执行固定程序与结构化参数、禁止 shell=true 和任意脚本。切换使用预登记 instanceId→受控本地数据根/连接秘密的映射，激活前复验 descriptor/revision/授权、确认精确目标，再切换服务配置并核对；失败保留两根，按记录人工回退。

### D-20. 策略、窄读与授权真实来源

独立知识发布后的检索构建使用受限命令因果授权。contracts 唯一导出 CommandCausalRefV1Schema={kind:"command",commandId,authorizationContextRef}；system 请求和上下文严格二选一 causalRunRef 或 causalCommandRef，Agent 任务仍必须携带真实 workflow-run。命令分支只接受原 knowledge-modeling.publish-approved-release 的 human 签发，commandId 必须等于该登记 invocationId，工程/主体必须相同，目标 branch 必须为 knowledge-modeling.identification-basis。C06 在同一签发事务内核对 deployment_causal_authorizations 中该原根与目标 parent 的唯一精确关联，随后继续当前权限及原 isAuthorizationSubset 校验。部署 resolver 另按冻结 catalog 核对批准 branch；请求不能新增能力。后台子上下文保留同一 causalCommandRef，正文和 revision_snapshot 同时登记与复验，原 causal_run_ref 保持 null；不新增迁移、不将命令包装成工作流。签发重放比较完整因果引用；错命令、错根、错父、错分支、权限撤销或原期限到期均失败。宿主只在正式 identification-basis-published 事件使用 producerCommandId 和 metadata.authorizationContextRef 恢复这个引用，且 causationId 必须一致；其它无运行的事件拒绝。该命令引用不提供新 HTTP 操作或通用系统授权能力。

缺失的 provider 统一来自只读、不可变 DeploymentPolicyCatalogV1。catalog 的每项以 projectId/type/ref 为键，正文由原 core Schema 验证；发布元数据绑定批准者、批准时间与介质身份，缺项/冲突/错版本失败，不引用 demo/test 常量。catalog 增加必填 purpose=production 或 synthetic-acceptance；合成验收目录只用于隔离验收实例，标明合成样本、待甲方复核，不能用于正式工程。catalog 不替代 C16/C18/C19 的已发布业务定义：指标、权重、矩阵、阈值、预测/偏差等按正式依据集合成员经其所属 adapter 读取原 C04 正文。新增窄公开 reader 只做精确版本解析和原 Schema 校验，无第二套规则表或默认值。

目录闭合类型为 cleaning、knowledge-validation、hybrid-retrieval、retrieval-acceptance、retrieval-review、risk-candidate、identification-graph、retry、assessment-runtime、warning-runtime、response-generation、response-validation、response-agent、calibration、scoring-rules、report-export。分别复用 DataCleaningPolicyV1、IdentificationKnowledgeValidationPolicyV1、HybridRetrievalPolicyV1、HybridRetrievalAcceptancePolicyV1、RetrievalReviewPolicyV1、RiskCandidatePolicyBundleV1、IdentificationGraphPolicySetV1、IdentificationGraphRetryPolicyV1、AssessmentRuntimePolicySetV1、WarningRuntimePolicySetV1、ResponseGenerationPolicyV1、ResponseValidationPolicyV1、ResponseAgentPolicyV1、CalibrationValidationPolicyV1、ScoringRulesPolicyV1、ReportExportPolicyV1 的原 Schema。正文有自身 ref 的类型逐项匹配；assessment-runtime、warning-runtime、risk-candidate 没有组合 ref，其 policyRef 是批准目录分配的不可变组合身份，正文全部成员引用保持原 Schema，禁止挑一个成员冒充组合身份。正文自带 projectId 时也须与登记工程一致。reader 的返回类型由 policyType 推导，不允许调用方指定任意 T 伪造类型。同工程同类型可以保留多个不同版本，精确重复键拒绝；解析后深冻结，读取不能修改批准正文。五类 Agent 定义由各领域已有工厂和策略组装，不在 JSON 中序列化函数或 Zod 实例。

| 缺口 | 来源与固定处理 |
| --- | --- |
| C15 cleaning/C17 knowledge validation 与五类 Agent 定义 | catalog 的原类型化 policy；一个共享 AgentTaskDefinitionRegistry 注册 cleaning、knowledge、retrieval-review、response-recommendation、calibration 五类任务 |
| C20 policyProvider / C21 hybridPolicy | 同一 catalog hybrid-policy，绑定 evidenceBaseReleaseRef、policyRef；不取最近版本 |
| C20 qualityGate | 原 HybridRetrievalAcceptancePolicyV1 + 精确 datasetRef；复用 core retrieval 验收计算，真实 Qdrant/dense/BM25/RRF测量与 reconciliation；任一门槛缺证据/失败都不能 ready |
| C21 reviewPolicy | catalog 的 RetrievalReviewPolicyV1，与冻结模型/工具/预算一致 |
| C22 policyProvider | catalog 的 RiskCandidatePolicyBundleV1，generation/validation/merge/confidence/forcedReview 引用全部与 C24 policySet 匹配 |
| C24 policyProvider/reviewPolicy | catalog 的 IdentificationGraphPolicySetV1 与原 review schema，禁止读取 synthetic fixture |
| C24 acceptanceRoutes | PostgresRiskCandidateAdapter.readResult 精确 acceptance-route-set 登记→C04.open→完整消费 verified→原 AcceptanceRouteSet Schema；返回 routes，缺失/漂移 undefined |
| C25 riskAssessment/warning runtimePolicies、response policies、C29 calibration policy | catalog 返回原运行策略；正式依据配置仍来自 C19 releaseSet members，经所属 adapter 的精确 reader 解析并校验，禁止只取第一成员 |
| C25 forecast/calibration catalog | C19 依据集合成员中指定的原配置 ref→C04 artifact；通过 EffectForecastModelReader/现有 deterministic executor，适用性与兼容性仍由 core 判断 |
| C30 riskSpatialPairing | PostgresStandardizedRiskInputFactsReader.readDeploymentRiskScopes→该精确已验收 riskRecord 的空间→请求 pairings 精确匹配；无/多匹配/无权 undefined，不借其它空间 |
| C30 retryPolicy | catalog 按原 retryPolicyRef 精确读 maxAttempts/backoffMs，保持父任务冻结预算 |
| C15/C17 start authorization，C24/C25/C30 runtimeAuthorization，C20 build/recovery/downstream | 同一 C06 invocation 适配；HTTP 受理阶段用真实会话分别签发固定下游 branch 上下文并耐久关联原 root；后台按目标 branch 查该已签发 context，再经原 system invocation 收窄/复验；禁止从仅有 workflow 能力的 parent 增加能力，原会话/权限失效不得扩权 |
| C35 systemOperationsRead | C05 真实 model observation、API/Worker/模型/数据库四组件探针与原 collector；传递 AbortSignal 与总截止时间，不用 unknown/test 常量假成功 |

C15/C17 现有工厂各自创建 registry；为两者增加可选 registry 注入（缺省维持原工厂行为），C37 始终注入同一个 registry，再注册 C21/C27/C29。各原任务 adapter 可复用同一数据库/事务/registry，统一 runner 和 API 读写指向同一持久任务集合，不新增第二任务表。

C37 评分规则采用已审核配置包原样导入路径，正式治理、发布和 C19 依据解析照常校验；C19 Agent 编制不在本轮验收范围。共享 knowledge-authoring 只注册 C17 的原定义；C19 编制启动在宿主明确拒绝，不复用 C17 定义解释评分候选。后续统一任务定义须单独闭合，不以该范围外能力缺项阻塞当前验收，也不将其记为通过。

配置包路径以 C19 的 ScoringRuleConfigurationPackageV1Schema 为唯一输入：schemaVersion、projectId、projectRevisionRef、configurationSetRef、compatibilityRef、scoringPolicyRef、可选 baseRuleReleaseRef、sources 与 members。sources 最多 256 条，每条固定 sourceVersionRef、standardKind 和 1–256 个 sourceSegmentId/text 证据段（每段 UTF-8 最多 16 KiB）；来源版本与同来源段身份唯一。members 使用原规则字段和 sourceVersionRef/evidenceReferences，最多 512 条、按 ruleId 唯一排序。包正文登记为真实 C04 content 工件，purpose 为 knowledge-modeling.scoring-rule-configuration-package，整包最多 1 MiB。

StructuredScoringRuleDocumentV1 和来源 binding 使用严格互斥分支：Agent 分支保留原真实 agentTaskRef/cleaningResultArtifactRef；配置包分支使用 configurationPackageArtifactRef，顶层固定同一包，成员绑定只保留 sourceVersionRef/evidenceReferences。包分支不接受 Agent/清洗字段，不混用两种来源。C19 提交完整消费 verified 的包工件，核对包与候选所有公共字段、成员及命令 baseReleaseRef；同工程当前 C06 来源授权覆盖全部包来源。C19 通过可选 authorizeConfigurationRead 窄口取得原 assessment-basis 分支上下文，解析真实 C18 发布集合并核对工程修订、配置集合、策略和兼容版本、指标正文摘要。包内证据段限定引用资格，复用原规则适用性、阈值、区间、例外校验和冲突检测；声明了比较基线就按真实 C16/C19 读回精确基线，缺项拒绝。authorizeConfigurationRead 缺失时包导入明确失败，不使用治理 capability 冒充读取权限。

配置包内容中的审核状态固定 pending，甲方审核标记不能替代本实例的 C07 决定；候选仍进入原 C16/C19 原子修订/关系事务，冲突审核和知识发布门禁保持原路径。配置包不创建 Agent 任务，不增加迁移或任务类型；旧 Agent 编制可以读取包来源的已发布规则作为基线。合成输入标记“合成样本、待甲方复核”，实际预置以正式回执绑定源版本和工件，静态样例引用不当作登记事实。

C17 组合接受可选 assessmentConfigurationPolicy、scoringRulesPolicy，类型直接引用 C16 现有 options；二者与 identificationKnowledgePolicy 注入同一 C16 实例。组合返回 governedReleases 窄口，只暴露该实例的 resolveGovernedReleases，供 C18/C19 解析正式版本，不暴露裸治理 adapter。宿主先用一次绑定窄委派注入 C18/C19 策略和 C19 resolver，创建 C17 后用 governedReleases 构造真实 C18/C19，再一次绑定；就绪前禁止调用。C19 按工程精确评分策略装配和分派，不能挑第一个工程策略。

projectBindings 每工程必填 forecastPolicyReleaseRef、calibrationTargetReleaseRef，均为原 KnowledgeReleaseRefV1；siteContextBindings 为 1–256 个严格 siteContextRef/artifactRef 版本对，工程来自外层 binding，精确现场键重复拒绝。预测正文只从指定 forecast-policy 正式成员经 C19 精确 reader 读取，复用原 ForecastPolicyDocumentV1Schema；全部 policies 交原执行器，图返回该发布引用作为 forecastPolicyRef。每次图解析继续核对冻结依据集合确实包含指定预测发布和校准目标，缺项或版本漂移不可用，不选择最近发布。现场工件沿原 reader 完整核验；报告策略从 report-export 精确 catalog 成员注入。构造时缺策略/部署绑定拒绝，运行时缺正式发布仍按原领域端口返回不可用；宿主不伪造发布事实。

C28 预测执行器增加运行时窄 resolver：PostgresResponseLifecycleAdapterOptionsV1.forecastExecutors 接受原 readonly EffectForecastExecutorV1[] 或 {resolve(policy): EffectForecastExecutorV1 | undefined}。只能在原受权依据正文、冻结发布引用及唯一指标策略核验完成后调用 resolver，返回的 method/requiredRef 必须与该策略完全一致，否则沿原 executor-unavailable 结果收口。新增 createProductionEffectForecastExecutorResolverV1 复用原 createExecutor、模型读取、下游授权和计算预算；每次以原 ForecastPolicyV1Schema 校验已读正文，不在启动时读取业务正文、保存第二份预测策略或缓存最近版本。原数组调用行为及重复键检查保持。C37 assessment 组合使用 resolver，不再要求启动期 forecastPolicies；发布文档中同 method/requiredRef 的策略仍按原目标指标唯一选择，计算以本次完整策略为准。

C27 PostgresRecommendationContextReader 的公开工厂补齐类已支持的可选 authorizeDownstream 参数，由宿主传入同一受控授权口，不另写知识读取路径。C33 识别读取 adapter 通过 packages/adapters 的 `./identification/read` 公开出口供宿主复用。

宿主 createDeploymentRuntimeAuthorizationV1 复用 C24/C25/C30 与 C21/C22 的原 verifyCurrent 接缝。先按精确 authorizationContextRef 读回签发来源、核对完整正文和工程/主体，再用登记 invocationId/branch 复验当前空间与来源权限。请求身份与登记一致时返回原 C06 context；派生身份仅经当前调用作用域的批准下游关联签发，不能把派生 invocationId 用来复验原签名。没有登记、错主体、正文漂移、已撤销或过期返回 undefined；数据库、契约或幂等冲突继续抛出。未传入来源版本集合时使用该签发来源登记的集合，不用空集合略过来源复验。

C29 的 CalibrationSuggestionTaskPortV1 由 composition/calibration-task.mjs 实现，消费真实受权 ArtifactStoreV1 和 C06 窄口，不查询领域私表。validateIncrement/finalizeIncrement 都从任务冻结的 frozenInputRef 完整读取原校准快照及其中的精确基准工件，限制每份正文 1 MiB、等待 verified、校验原 Schema、工程、任务、模型/提示/工具/预算/校验策略、派生 inputSnapshotRef 与原基准摘要，再调用原 validateCalibrationCandidate。校验结果通过真实 C04 put 保存 agent-validation 工件，不能用未登记的摘要引用；原 AgentValidationResultV1 承载接受/拒绝及可修复类别。finalize 再校验同一冻结候选，只有接受时按原 deriveCalibrationSuggestionRef 与 buildCompletedAgentTaskResult 返回稳定结果身份，不写正式建议。C29 createSuggestion 继续读取完成任务并复算，正式登记与复核仍归原 adapter。校验与最终收口的工件身份分别绑定任务、候选摘要及阶段；不保存模型思维内容。

宿主 composition/response-model-step.mjs 提供 C27/C29 的共享 runner 模型步。assessment 组合要求同一 foundation.authorizationScope 和 C04 persistArtifact，返回绑定实际领域实例的 modelStep；render/interpret 及任务定义 validate/finalize 均在原 runTask 授权作用域中执行。模型步精确读取持久签发来源并核对完整授权正文，以原完整来源版本集合复验当前权限；C27 通过所属 readMeasureCandidateSet 读取冻结查询正文，校验工程、精确空间版本和冻结主体；C29 通过 calibration-task 的宿主只读 readModelInput 复用全部冻结快照、当前授权和基准摘要校验，再通过 C28 readDeviationFact 读取同一偏差、冻结依据和精确空间，阈值未超限时拒绝。当前签发或复验脱敏均拒绝。领域正文以不可信数据消息传入，模型无新增工具，输出仍为原 ResponseRecommendationIncrementV1 / CalibrationCandidateV1，原确定性校验与正式入库负责收口。候选和增量各保存真实 C04 工件，绑定原模型 invocationId 和递增候选版本；其它任务类型只交给显式 inner，缺失则失败。输入消息受原 maxInputBytes 限制，模型输出使用原冻结 token 预算，不保存思维内容。C29 的 readModelInput 只返回真实 snapshot、派生 inputSnapshotRef 和基准 document，不生成候选或完成结果。

C18 精确成员窄读只取两条不同成员投影以判断冲突；重复引用同一发布的依据集合不增加结果规模。C19 需复算完整成员快照摘要，其精确发布成员查找最多检查 200 个已登记依据集合，超过则拒绝解析，不能读取全库或截断后宣称一致。

C33 所属 standardized risk input facts reader 增加 readDeploymentRiskScopes，接受原 RiskInputFactsReadRequestV1，复用原精确行、验收证明、历史作用域、证据与两阶段授权校验，成功只返回该行的 spatialScopeRefs/sourceVersionRefs。与 readRiskInputFacts 共用一次读取和校验实现，任一失败返回 undefined，数据库故障继续抛错；不分页读取目录，不扩展评估事实 Schema。C30 宿主先签发原 riskInputFacts 分支上下文，再按返回的精确空间选择唯一 pairings；版本与 identificationRun 来源须由原记录登记核对，不能只靠 caller 指定。

C20 构建门禁由 scripts/deployment/composition/quality-gate.mjs 适配原 evaluate 输入。宿主注入精确数据集/验收策略目录、原 generationStore、真实 Qdrant projection、ModelGateway 和 C06 access；门禁按 generationRef 取正式代际，核对 manifest/policy/dataset/evidenceBase 身份与授权摘要。每次 Embedding 以代际登记的授权引用、创建者和 knowledge-modeling.read 能力复验，原预算引用及任务截止时间固定；不需要父工件时也不略过当前权限。读取和查询传递总截止时间，测量超时失败，不后台继续发新请求。query/relevance 原样分离，成员只映射本 manifest 的 pointId。报告环境来自 Node/os 及实际 Qdrant serviceVersion，容器标识由运行时配置提供，不内置 test/unknown。结果交原 evaluateRetrievalAcceptance；门禁返回该 report.overall 与安全 detailCode，并由宿主保存实际报告。

工程注册表提供 listDeploymentProjects({afterProjectId,limit}) 的宿主维护窄读，不是业务 HTTP 读面。limit 为 1–200，按工程 ID keyset 返回已登记工程当前 revision、现有空间引用与 sourceDelivery 引用；每工程空间最多 128、来源最多 256，超限明确失败，由维护者缩小批次或另行闭合更大工程枚举，不截断后宣称覆盖完整。查询归 registry 所属 adapter，宿主不跨模块直接查表；列表不返回资料正文或账号，后续逐工程正文操作仍须原 C06 权限。

功能验收补充两类不可变输入，均标记“合成样本、待甲方复核”，并沿用 synthetic-acceptance 实例隔离。现场材料包使用 DeploymentSyntheticSiteContextPackV1：schemaVersion="1"、projectId、packRef、固定 sampleNotice、contexts（1–256 条原 RecommendationSiteContextV1）。每条正文按原 siteContextRef 固定版本，覆盖五工序，以及资源齐备、资源不足、禁忌约束三种现场条件；不含建议结果或预填校验结论。预置通过原 C04 put 登记实际正文，运行配置只绑定 siteContextRef→正式 C04 artifactRef。可信 provider 每次按命令指定的精确 ref 读取受权 C04，限制正文 1 MiB、完整消费 verified、复用原 Schema，并核对工程/版本/空间/时间；候选与现场空间匹配仍由 C27 确定性校验。未经正式预置的本地键不能用于运行。

检索材料使用 DeploymentRetrievalDatasetV1：schemaVersion="1"、projectId、datasetRef、evidenceBaseReleaseRef、syntheticSample、sampleNotice（合成时必填）、queries（1–256 条）。每条为 queryId、queryText（UTF-8 最多 16 KiB）、relevance（1–256 条 sourceKind/sourceReleaseRef/sourceEntryId/grade，其中 grade 为 1–3）；三种来源分类和知识发布引用直接复用 core/contracts Schema。queryId、单条 relevance 身份不可重复。正式测量前将本地发布键绑定真实 C17 回执，并核对本代 evidenceBaseReleaseRef 和 manifest 中的精确成员身份；缺成员拒绝，不用最近版本补齐。仅 queryText 送 Embedding，relevance 留在确定性验收计算。使用真实 Qdrant queryHybrid 的 denseRoute、bm25Route、fused 和 fusedQueryDurationMs 分别计算 Recall@5、NDCG@5、p95，复用本次 reconciliation 并检查命中工程/代际/授权摘要；报告适用范围为该小型合成数据集，不代表真实工程准确率。全部查询与次数受固定数据集、原 measuredRuns/warmupRuns 及宿主总截止时间约束，不得用已给定分数替代测量。

现有 registry 按 taskType 唯一注册，任务定义冻结策略而非按工程动态选择。C37 同实例内固定注入的 cleaning、knowledge-validation、retrieval-review、response-agent、calibration 必须在全部工程具有相同策略定义正文（包括策略引用、定义、预算和工具身份）；宿主只排除按原 Schema 绑定本工程的 projectId，再逐项比较其余全部字段，不同则在监听前拒绝。其余策略仍按工程与精确 ref 解析。需要同实例容纳不同 Agent 定义时再闭合 registry 的工程维度契约；当前不挑第一工程绕过冲突。

跨能力调用在 HTTP 受理、任何业务副作用之前，由 C06 所属适配读取版本化的 rootBranch→下游 branch 闭合清单，用本次真实 sessionToken 分别调用原 authorize，并把 rootContextRef 与各目标 contextRef 写入 deployment_causal_authorizations。只签发固定流程所需分支，actor/project/空间/来源不扩大；一次拒绝阻止受理，已签发但未关联的上下文不能用于执行。令牌仅存本次调用内存、不持久化。后台 resolver 以原 root、目标 branch 与原因果运行身份读取关联、逐项 verify 当前权限，再用该目标分支 parentContext 调原 system authorize；保留原 isAuthorizationSubset。没有关联时失败，不能重构令牌或借别的用户/context。清单归批准 catalog 的 strict ModuleBranch 集合，不接受业务请求新增 branch。运维操作仍按独立宿主权限及逐工程原 freeze/read 授权执行，不增加通用系统管理业务能力。

该清单为 catalog 必填 downstreamAuthorization={policyRef,bindings}；bindings 每项为 rootBranch 与 downstreamBranches，原 ModuleBranch Schema 校验，根和单项下游不得重复，各集合最多 128。与 catalog 本身的不可变身份及批准发布一同冻结，装配将其传给受控授权口，不使用请求提供的清单。

授权适配装配必须传入该清单。签发前从 C06 精确窄口确认 root 正文与原 branch，复验原授权，并要求请求分支集合与批准绑定完整相同；少项、多项或重复都拒绝。关联 policyRef 保存该清单的版本身份，后台读取同时核对当前冻结清单及目标 branch，版本漂移失败。

内部调用携带后代上下文时，resolveDownstreamContext 沿 C06 窄口读取的真实 parentContextRef 寻找该目标分支的原关联根；无父的预签 child 通过关联表按精确 childContextRef/工程/主体查找唯一根（至多两行以检测冲突）。最多 32 层，重复引用或越界立即失败。逐层保持主体、工程及精确正文绑定；找到关联后仍核对该根的批准清单及精确 child。不会选择其它运行、最近上下文或同用户的任意授权。宿主使用 AsyncLocalStorage 传递当前调用的根来源及原因果身份，入口从正式 HTTP 命令、持久事件 metadata 或冻结 Agent task 重建；这个内存范围只承载调用上下文，不替代持久关联。并发调用不共享可变全局授权。C15 原任务清单的 parentRunRef 由其所属模块派生，宿主按原冻结任务身份使用，不另造 C30 登记或变更其因果身份。

C06 adapter 公开 readIssuedContext({invocationId,branch,projectId,actorId})，只返回唯一已持久化、通过原 AuthorizationContextV1Schema 且身份逐项相同的上下文；缺失返回 undefined，管理授权空正文不能转换为业务上下文。部署适配默认消费同一 access 的此窄口；显式 reader 用于测试注入。所有下游签发与范围校验完成后，在单一事务内追加整组关联，冲突须与原 child/ref/主体/策略一致；不得在循环中提交部分关联。resolveDownstreamContext 必须提供本次实际 invocationId，system authorize 使用该身份；上下文引用必须与关联的精确 childContextRef 一致，复验沿原签发身份完成。不同后台动作不得共用固定 `:resolve` 身份。

C06 另提供 readDeploymentAuthorizationSource({authorizationContextRef,projectId,actorId?})，按精确引用读取唯一 C02 业务上下文、原 invocationId/branch、parentContextRef、causalRunRef 与签发快照的 sourceVersionRefs；逐项核对持久身份及原 Schema。actorId 在命令/任务入口必填核对，事件入口因原 metadata 只有授权引用而可省略，从精确登记正文恢复原主体；不开放业务 HTTP 读取。来源读取不签发或续期，也不替代当前 verify；不存在、管理上下文或绑定不符返回 undefined，数据库故障保持错误。父引用从同工程同主体的实际父行取得 versionId，不补默认版本。上下文正文与关联因果引用不一致时拒绝。宿主以该窄口重建原来源，不读私表、不按动作字符串反推原因果身份。

后台继续沿原 C06 五分钟上下文期限及账号、安全版本、工程成员、空间和资料权限复验；到期必须拒绝，不能自动延长或借当前其它会话续期。原签发未持久化会话令牌或会话引用，原 verify 不证明该浏览器会话仍存活，功能报告须区分会话验证与后台授权验证。长时间人工等待后的恢复须通过重新认证的正式恢复命令受理，新的下游授权仍绑定此次命令，已有任务/运行版本与幂等事实保持。

合置环境的本地 C04 不承担 C06 当前权限复验。C06 adapter 增加 verifyDeploymentContext({authorizationContextRef,projectId,actorId,requiredCapability,requestedSpatialScopeRefs,requestedSourceVersionRefs,requestedAt}) 窄口：按精确上下文引用读取唯一业务签发登记，严格解析原 branch 与上下文，核对主体、工程和 branch capability 后，使用登记的原 invocationId 调用既有 verify。管理上下文、假引用、错能力、已失效或撤权均拒绝，不猜 branch、不按能力选任意授权。该窄口不签发新权限、不增加 HTTP 操作或持久字段。基础宿主给同实例业务模块注入的 ArtifactStoreV1 在每次 put/open 前调用此窄口，并使用复验返回的真实上下文；原工件动作身份与流式 verified 契约保持。C18 成员窄读的权限依赖这个受权 C04 组合，不把原本地 store 的结构校验当作当前权限证明。

宿主模型组合也在三能力的每次网络副作用前调用同一 verifyDeploymentContext；空 parentArtifactRefs 仍复验，不能只靠 C05 上下文 Schema。模型调用保留原 invocationId 与幂等键，复验沿上下文原签发身份。DeploymentConfigV1.models 的完整部署引用决定唯一 adapter，未知/重复部署与缺凭据在启动边界拒绝。父工件预检经同一受权 C04 完整消费并等待 verified，流式读取保持背压；会话流用延迟建立的原 handle 转发 deltas/completed，拒权时不调用 adapter、不产生空成功收据。

start.mjs 的 createDeploymentAuthorizationScopeV1({access,deploymentAuthorization,policy}) 为宿主提供 run({authorization,causalRunRef},operation)、runEvent(event,operation)、runTask(task,operation) 与 authorizeDownstream(request)。runEvent 按精确 metadata.authorizationContextRef 恢复原主体并使用已登记 aggregate/workflow 引用或原上下文因果引用；runTask 使用冻结 parentRunRef。缺原因果身份必须失败，不能把 eventId 或调用字符串包装成运行引用。run 内先核对持久来源，authorizeDownstream 核对当前作用域工程/主体，复用部署 adapter 的有界关联解析与原权限复验。HTTP 用包装 access.authorize 在 human-session 成功后先按清单签发下游；缺 rootBranch 绑定表示该入口无跨能力动作，不自动扩清单。已有领域 adapter 发起的同能力 system/agent authorize 继续复用原 C06 收窄规则。

合成资料预置的空间与来源授权复用原 ProjectAccessCommandV1，不扩大系统管理 HTTP 操作目录。C06 adapter 增加 executeDeploymentProjectAccess({sessionToken,command})；command 为原命令去掉 authorizationContextRef 的判别联合。每次调用先验证当前会话、账号管理员资格与首次改密状态，再按该 commandId 签发或复用原服务端管理引用，严格解析原命令并转发既有 projectCommand。调用者不能传入管理引用，业务 context 不能代替管理授权；原版本冲突、幂等、权限复验和同步审计保持。provision 的此类步骤同样要求显式 --bootstrap，并使用这个窄口；不依赖登录首次回执是否含管理引用。

C20↔C21 和 C17↔C20 是构造引用环、不是业务流程环。宿主建立只绑定一次的窄委派（C17 retrieve、C20 inputReader），先建立 C15/共享 registry/C17，再 C20、C21、C22/C23/C24，最后一次绑定真实委派。绑定前任何调用均抛未就绪错误；全部绑定核验后才监听/claim。不得导入 core/adapters 私文件，只有宿主可组合 apps/api 与 apps/worker 的公开入口。

### D-21. 生产端口与事件闭包

Worker 事件语义已批准：识别准备仅沿 C06 持久因果运行及 C30 精确启动登记定位，风险验收仅沿精确 parent-child 链边定位；assessment 准备及 C06 正式来源证明的独立事件写 risk-flow 消费回执。关联暂缺、不唯一、权限不足、版本冲突或技术失败保持失败与原重投，不以查无关联证明独立。C30 adapter 增加 readEventParentRun（当前受权身份、runRef 或 identificationRunRef，返回精确父引用或 undefined）与 verifyEventConsumption（同一身份、父引用、准备引用或子运行/风险引用，返回 boolean）；定位最多两条候选，核对主体、完整范围摘要及原启动收据。消费证明只 SELECT 与 C04 verifyContent，核对精确输入登记及已提交运行正文；running、cancelled 或只有输入/路由登记未推进的状态不成立。长图在 consumer 短事务外推进，短事务内重新证明已提交消费事实再写原回执；重投先证明，避免业务完成而回执失败导致重复推进。applyAcceptedRisk 在写路由前核对精确子运行版本、恢复引用与取消态，拒绝事件不新增路由事实。无新 DTO、表、迁移或依赖。

C30 新窄口使用可选 runBindingProof（复用 C03 PostgresTransactionUnit.readWorkflowRunBinding）；宿主必须注入，缺失即无法证明事件运行，不影响原读取接口。准备消费须有精确单一识别入口、对应子链边及后续已提交阶段结果；验收消费须有精确子链边、正式状态中的风险版本及已提交阶段结果，已有派生验收路由另核对其原主体、范围和类型。子图返回时父图已经纳入的正式风险同样属于已消费，不要求额外生成验收路由。每次回执前重新检查父定位唯一性、当前权限及状态，不能沿第一次定位缓存忽略新增冲突。

独立识别准备只在 C06 精确 human 来源无父上下文、无运行/命令因果，且原 branch、producerCommandId、causationId 和 invocationId 逐项一致时成立；assessment 准备明确不进入识别 apply。两者都先复验原来源的完整空间及资料权限，再以事件 aggregateRef 保存 risk-flow 回执。其它后台事件同样在 runEvent 中按原签发身份复验，撤权、脱敏或来源漂移失败。start.mjs 的 createDeploymentOutboxDispatchV1 绑定五个原消费者并验证 ConsumerResultV1；投影 ignored/rejected 不确认。createDeploymentWorkerV1 组合真实三图、原 Outbox 与共享 Agent runner；createDeploymentWorkerRuntimeV1 接收同一 host/outbox/runner/registry 驱动两个独立 WorkerLifecycleV1，事件按原冻结 batchSize claim、以 worker.maxConcurrency 并行，过期/失效租约保持原恢复，未知事件记录失败并进入非就绪。限时 drain 未收口保留基础资源，关闭后的 runOnce 拒绝。CLI 为 node scripts/deployment/start.mjs --role api|worker --config <file> [--manifest <file>]；只加载已初始化库，不自动迁移或引导。SIGTERM/SIGINT 按原截止关闭，日志只含原安全状态字段，Worker 后台故障触发同一关闭路径。

API 的 riskIdentification.plan 只返回 C24 I2 已登记的精确工作计划引用。C24 adapter 的 readRegisteredWorkPlan(command: IdentificationPlanCommandV1): Promise<IdentificationPlanResultV1> 使用本次 commandId、risk-identification.plan 和当前完整授权复验；按原 identificationWorkPlanRefFor 派生查询目标，核对工程、输入快照、登记及 C04 正文，缺失或正文不成立返回 BUSINESS_BLOCKED，拒权返回 AUTHORIZATION_DENIED。不得启动整图、创建第二计划或返回未登记引用。analyze/finalize 委派同一 C22 service，公共 DTO 保持原形状。

buildApi 增加可选 runRequest<T>(operation: () => T): T 宿主作用域回调，在每条路由 handler 外运行一次；宿主注入现有 authorizationScope.runRequest，使 access.authorize 捕获的真实来源和下游签发留在同一请求内，并发请求相互隔离。该回调不改变 HTTP DTO、授权或错误处理；未注入的原调用方保持原行为。

start.mjs 的 createDeploymentApiV1 以 api 角色创建三图，复用 createDeploymentApiPortsV1；C34 read 绑定同一实现 RiskAssessmentReadPortV1 的 C25 engine，C30 bodies/registrationStore、C33 trace、C20 正式结果 reader 和 C36 原适配器均使用公开工厂。工厂只装配并 ready，显式 listen(listenOptions) 才由 ApiLifecycleV1 开放监听；关闭限时 drain，未 settled 不释放仍在用的基础资源。未监听实例仍关闭 Fastify 和基础资源。系统面探针读取实际 app/server 状态、有限 SELECT 1、受控工件目录权限以及已配置模型端点（llama.cpp /health、Ollama /api/version、OpenAI /models；凭据仅用于原批准端点且禁止重定向），取消响应正文，不推理；端点可达仅说明服务可达，模型版本固定取 registry 定义与 config，不伪造已加载模型证明。单次系统查询沿原 2 秒预算收口，不显示地址、路径或秘密。

assessment 宿主组合在 readers.responseContext 返回传入同一 C28 实例的原 PostgresResponseLifecycleContextReader，C41 复用该公开 reader，不从 C27 或 C28 私字段取上下文、不重复构造知识读路径。

宿主 createDeploymentGraphsV1 在 start.mjs 内组合原公开工厂：先建共享 registry 与检查点校验一次绑定槽，再创建基础宿主；C11 的 dataCleaningStore 只延迟绑定 freezeIdentificationPreparation，C24 acceptanceRoutes 延迟绑定 C22 精确读，C18/C19 经现有 scoring governance 与 C17 一次绑定，C26 routeDecisions 经 C41 一次绑定。所有槽绑定及五类任务注册完成才返回可用组合。C41 按工程创建，workflowStartControl 使用本工程的图/重试版本，公开 facade 仅按命令工程委派。校准、知识、清洗和检索审阅模型步按原 taskType 分派并在同一 runTask 作用域执行；候选工件用真实 C04 put。构造失败逆序释放 consumer 和 foundation，尚无完整 API/listener 时不声称宿主 ready。

反馈校准引用登记时序：A3 的 C29 prepareInput 只保存冻结输入，不写公共 deviationRecordRef、游标或 feedback-deviation。A4 在 createSuggestion 原子成功后调用 CalibrationServiceV1.readCreatedDeviationRecordRef({projectId,actorId,requestedAt,invocationId,authorization,calibrationSuggestionRef,parentRunRef})，返回 DeviationRecordRefV1 或 undefined。该受保护窄读复用 warning-response.read 与 C29 检查点证明，按精确建议查询创建时 pending 偏差行（version_number 升序、limit 1），再核验原 Schema、摘要、身份、精确父运行和完整当前空间授权；不读最新版本，不签发下游，不写事实。后继预留只有在对应建议正式提交后才可返回。A4 同时写精确偏差/建议状态与游标、feedback-deviation 和 deviation-calibration；等待或失败不登记未成立引用。公共 HTTP 建议结果形状保持原契约。

生产检查点使用 core/persistence 唯一导出的 `CheckpointRuntimeContextV1Schema` 与 configurable 键 `riskflowCheckpointContextV1`：strict 字段为 schemaVersion、projectId、actorId、threadId、runRef、authorization、invocationId。三图的调用与 getState 均传本次受权运行上下文；读取旧检查点使用本次权限而非历史授权替代当前身份。C03 的 ContractReferenceValidator 保留引用首参数，第二参数包含 operation（put/put-writes/get/list）、解析后的 state 及可选 runtimeContext；既有只接收引用的调用方保持可用。上下文存在时须逐项核对工程/主体与授权、thread/run 精确引用和当前图状态，生产 validator 缺上下文即拒绝。putWrites 仍按原 tuple 状态验证待写引用，不能把 pending writes 当已提交业务事实。

宿主引用校验由引用所属模块的公开窄读组合：当前 C06 来源/授权复验先于存在性读取；仅核对精确工程与版本、运行归属、已提交登记和必要完整性，不返回正文、不写审计或业务事实、不维护第二引用登记表。C03 checkpoint 连接不获得业务表权限，窄读使用原应用连接。未支持引用、缺失、已回滚、版本不符、跨工程/运行或技术错误均按 CHECKPOINT_INCONSISTENT 失败；初始运行身份须由已受理原命令或父运行已登记的子入口证明，不接受裸 caller 引用。已有精确公开证明优先复用，缺口仅在所属 adapter 增加存在性窄口。

put-writes 使用旧 tuple 状态，不要求新产出引用已出现在旧状态中：首次 assessment-input-snapshot 仍由本运行 A0 准备与 C25 已提交正文证明；知识准备/用户确认从待写的完整目标引用重建其唯一 strict WaitingRefV1，并由 C24/C30 精确等待登记证明。其它操作继续要求状态中的相同引用。待写数据只提供查询目标，不能替代所属模块已提交事实或改变授权/运行上下文。

C30 verifyCheckpointDomainReference 只证明评估领域引用与运行的关联，不替代所属模块的正文证明。当前完整权限复验且拒绝脱敏后，冻结输入按同工程/运行/原主体/范围的唯一 A0 entry-snapshot 行中 frozenRefs 的完整对象等值定位；产出按既有 risk-assessment、assessment-warning、warning-recommendation、recommendation-forecast、feedback-deviation、deviation-calibration 的精确 toRef 定位。warning-response-task 可按 warning-recommendation 的精确 fromRef 定位；反馈可按 feedback-deviation 的 fromRef 定位。链边查询最多一行；冻结入口最多两行检测冲突。运行身份版本由 C03 启动收据另证。执行/反馈在分段入口中以已登记 frozenRefs 证明输入归属，不新增 forecast-execution/execution-feedback 写入，也不把预测独立运行当作评估运行。

C25 verifyCheckpointReference 只支持 assessment-input-snapshot 与 risk-assessment-record，先复验 risk-assessment.read 的完整当前空间/来源且拒绝脱敏，再复用本模块精确登记与原 Schema。输入快照正文、准备引用身份列与 reference_digest 必须一致；宿主传入 C30 已证明的准备引用，正文必须与之精确相等。A2 产生的输入快照以所属 C25 正式事实和本运行 A0 准备证明，不用 A0 input_snapshot_ref 冒充输入快照。评估记录核对正文身份、工程、精确空间和 content_digest；运行归属由 C30 原链边另证。窄口不加载发布正文、不签发下游、不写读回执；技术失败上抛至 checkpoint 边界。

C27 的 PostgresRecommendationAdapter.verifyRecommendationCandidateReference 接受精确候选引用、parentRunRef 与原受权读取身份（工程、主体、invocationId、requestedAt、authorization），复用 warning-response.read 的当前授权及原候选行/正文校验；核对工程、精确空间版本和冻结父运行版本后仅返回 boolean，不写事实。技术错误交由 checkpoint 边界失败闭合。宿主验证器在 start.mjs 组合当前 C06 来源复验与各模块精确证明；引用证明不能把当前运行或同工程其它运行的存在性作为父子关系证明。

C06 部署授权 adapter 的 readDownstreamContext 使用与 resolveDownstreamContext 相同的有界关联查找、批准分支和精确正文核验，只返回已签发上下文及原 invocationId/branch。先复验本次 root 的当前权限，再复验关联目标；授权范围不得超过本次 root。只读路径不签发、补登记或写审计，关联缺失、撤权、redacted、越界或冲突都拒绝。所属模块使用原目标调用身份复验，不把新检查点操作字符串当签发身份。

C24 verifyCheckpointReference 为原图所属引用提供 boolean 证明：接受已签发的调用身份、当前授权、精确 runRef 和图引用，复用当前权限、作用域摘要与私有登记/C04 读取；输入快照、工作计划、阶段结果、错误及运行结果均按精确引用定位，核对 runId 与必要正文引用。宿主另以启动收据证明 runRef 身份版本和父子关系；此窄口不把 run-state 的内容版本当运行身份，也不自行签发固定读操作身份。未支持类型、缺失、其它运行或正文不兼容拒绝。

C15 verifyPreparationReference 接受原 IdentificationPreparationReadRequestV1，复用 readExactPreparation 的当前 evidence-access 授权、精确准备登记、快照范围与任务—清洗结果/C04 核验，只返回 boolean，不执行原读取回执和审计事务。两入口共用私有准备解析；正文、任务或版本缺失均失败，技术故障上抛。该证明只证明准备事实，宿主须另核对它与本次识别入口的绑定，不能据此推断运行归属。

C30 adapter 的 verifyCheckpointReference 接受工程、主体、原 invocationId、requestedAt、authorization、精确 runRef 与 reference，复用原当前授权和精确登记窄读，只返回 boolean。支持 stage-result、route-decision、workflow-error、assessment-run-result、risk-flow-run-result；逐项核对登记引用及精确授权范围，结果正文通过 C04 verifyContent 按原 run-result 用途和原 16 MiB 上限核对工程/runRef。缺正文证明能力失败，不触发普通读取审计。三类 A0 入口继续通过 readAssessmentEntrySnapshot 的唯一登记与原引用证明；运行身份均另由 C03 启动收据证明，不能以可变 runVersionId 代替。

C28 verifyCheckpointReference 接受工程、主体、原 invocationId、requestedAt、authorization 与 reference，仅支持 effect-forecast、execution-record、feedback。复用 warning-response.read 当前授权、精确单行 loader 与原正文 Schema/摘要/身份列核验，完整授权及空间版本必须一致；只返回 boolean，不读关联列表、不触发访问事实。预测正文的独立 forecastRunRef 同原身份列核对，但本评估运行归属仍由 C30 链边或 A0 frozenRefs 证明。宿主只对 assessment 或 C03 已证明的 riskFlow 子运行组合两种证明，无新表、迁移或权限。

C27 verifyCheckpointReference 同形接受领域 reference，只支持 response-recommendation。复验 warning-response.read 完整当前权限与精确空间版本；读取唯一建议及其精确 validation 行，使用原记录/校验 Schema 与已有摘要算法，核对建议身份、主预警、候选与校验策略及三项校验登记一致且通过。不得签发下游、读取措施正文或创建回执；运行归属由宿主 C30 证明。已有公开读面可共用精确解析，保留其结果契约。

C26 verifyCheckpointReference 同形支持 warning-record 与 warning-response-task。预警精确单行按原 Schema、摘要、身份、评估标识及等级复验；任务按不可变 task_versions 的精确工程/任务/版本与原任务身份配对，允许历史版本，核对 strict 空间引用与原 aggregationKey，不读取任务最新版本的关联列表。完整当前 warning-response.read 权限复验且脱敏拒绝。任务可接受可选 assessmentRecordRef：按原 task_warnings 与 warning_records 的精确工程/任务/评估版本及 firstIncludedVersion 不晚于任务版本查询一行，核对预警正文及摘要。宿主在 A6 尚无 warning-recommendation 链边时，先由 C30/C25 证明状态中的评估记录属于本运行且正文成立，再由 C26 证明任务版本关系；不以 caller 状态本身或最新任务版本推断归属。

C29 verifyCheckpointReference 同形支持已落库 deviation-record 与 calibration-suggestion，并接受精确 parentRunRef。偏差按精确版本正文、原摘要、身份与复核状态证明，空间和父运行通过其原 suggestion 关系证明；不读取最新偏差版本。建议按精确工程/版本/空间和原父运行列读取，复验原候选/校验 Schema、Agent 任务及结果、校验策略与候选目标文档摘要一致、accepted 校验及真实复核引用。candidateDigest 仍是完整候选目标文档的摘要，不把它当增量 JSON 摘要重新计算，不读基准正文或签发下游。无公共偏差行时返回 false，不以派生身份冒充正文。

C24 verifyCheckpointReference 的可选 workPlanRef 仅供 identification-work-item 证明：宿主必须传图状态已冻结的工作计划引用；按同工程、本运行的精确 work-plan 登记及当前授权范围定位原正文，经 C04 verifyContent 完整核验后检查精确工作项属于该计划。缺计划、错版本、其它运行的计划或正文不含该工作项均拒绝，不用工作项标识前缀或普通 readExact/open 推断归属。

C08 PostgresAgentTaskAdapter.verifyCheckpointReference 只读证明原完整 AgentTaskRefV1，接受工程、主体、原 invocationId、requestedAt、authorization 和精确 parentRunRef。先复验 agent-task.read 当前能力和完整授权范围，脱敏拒绝，再按同工程/精确任务版本读取唯一任务行；任务信封、状态和已登记完整任务引用须一致，原主体、父运行及冻结空间/来源许可都须匹配，仅返回 boolean。允许等待或终态任务，不把状态更新当任务引用版本。宿主对三个图直接传当前运行；父图转发的任务按已登记精确子运行逐项证明 C03 父子关系后才能使用该子运行作为 parentRunRef，不能以裸候选父运行替代。该证明不读取模型正文，不写事实或复验回执。

C24/C30 的 verifyCheckpointWaitingReference 接受工程、主体、原 invocationId、requestedAt、authorization、精确 runRef 与完整 WaitingRefV1，只返回 boolean。当前权限完整复验且拒绝脱敏后，按所属表的工程、运行、waiting 种类、原主体、授权范围摘要及完整 waiting_ref 等值查询，最多读取一行，证明已登记的等待事实；不猜等待 resultId，不枚举运行历史，不读正文或产生访问审计。运行身份版本另由 C03 原启动收据证明。knowledge-preparation-task 与 user-confirmation 没有独立领域任务读口，宿主仅在严格图状态的完整 waitingRef/waitingRefs 含该精确引用时调用所属图证明；其它等待类型继续使用自己的所属模块身份证明，不以等待登记替代领域事实。

C07 PostgresReviewAuditRead.verifyCheckpointReference 接受工程、主体、原 invocationId、requestedAt、authorization、完整 ReviewTaskRefV1 与精确 parentRunRef。仅 review-audit.read 能力可用，复验当前完整授权且拒绝脱敏；复用原 task-detail 的精确单行任务状态解析，核对原 requestedBy、完整任务及 target/等待运行的 JSON 与身份列。仅返回 boolean，不读取复核决定或快照正文，不写事实。等待、已决定及被替代状态均可证明历史身份。三图直接使用自身运行；父图只在 C03 已证明精确子运行归属后转发其任务。普通 UI task-detail 继续共用状态解析和原决定读取。

C22 识别中间结果证明由宿主 createDeploymentCandidateCheckpointProofV1 组合既有 resultStore.readResult、当前 risk-identification.run-read 权限及 C04 verifyContent，仅支持 identification-candidate-set、merge-plan、identification-group。宿主先以 C24 证明严格状态冻结的输入快照；合并计划和组还须证明冻结工作计划。精确结果登记须匹配工程、原主体、完整引用、输入/计划及授权范围；正文复用 RiskCandidateSetV1Schema、MergePlanV1Schema、IdentificationGroupV1Schema 与原用途码，使用 C22 原 8 MiB 上限。正文与登记的输入、计划、范围和原授权引用一致，候选的工作项/模型上下文及候选身份、组的身份版本、合并计划的精确运行/身份均须相符。无普通 open、事实写入、标识前缀猜测或跨运行回退。原正文上限作为单一公开常量复用，不新增配置或领域 Schema。

标准化风险记录继续复用 C33 的纯 SELECT record-read，不新增领域读接口：宿主仅在识别图内使用已登记下游 risk-identification.record-read，先按本次完整空间/来源版本复验且拒绝脱敏或上下文漂移，再提交原精确查询。结果须 succeeded/record-read，完整风险记录引用及 identificationRunRef 与当前已证明运行一致；返回内容不进入 checkpoint 或普通日志。不存在、错版本、其它运行及受限正文均拒绝。

API/Worker 基础装配必须接收 validateCheckpointReference 函数，再以配置的独立 checkpointer 角色及其密码创建原 PostgreSQL saver；缺函数或独立密码在任何数据库连接前拒绝。checkpointer.end 进入基础资源的统一逆序关闭流程，业务启动不运行 setup/DDL。引用校验函数可以通过既有一次绑定槽连接后续领域组合，但监听/claim 前必须已完成绑定；provision 不建立 saver。

C04 ArtifactStoreV1 增加可选 verifyContent(request,maxBytes,validate) 服务端窄口，普通 put/open 行为不变。request 沿原 ArtifactReadRequestV1；maxBytes 为调用所属 Schema 的正整数上界且不得超过原工件预算，validate 为所属模块的同步正文校验，完整摘要/长度核验后执行，仅返回 boolean。复用原登记、用途、权限、路径、并发、关闭与流式摘要检查；该路径不产生访问记录、诊断工件或审计。部署包装在调用前复验当前 C06。缺窄口的 store 不可用于生产 checkpoint 正文证明，不以普通 open 替代；本轮合置本地实现，跨 VM 校验缺能力失败闭合，未经设计不扩展远程协议。

初始运行证明复用 C03 已完成 command_receipts：PostgresTransactionUnit.readWorkflowRunBinding 只读指定工程、精确 runRef 与 threadId 的正式启动收据，命令种类固定为 workflow.start-run、identification-graph.start、assessment-graph.start；未完成或缺审计的收据拒绝。父图启动绑定补存既有 thread_id，评估子运行在当前授权/入口检查后、首个 checkpoint 前追加同形启动收据与审计，授权正文不进入载荷摘要。该窄口只返回 boolean，宿主先完成当前授权再调用；恢复不把新命令身份当原运行版本。既有未绑定线程的历史运行不能猜测身份，须从已登记运行事实核验。

子图启动先于父图收口链边，两个子图在原启动审计的 reasonRef 记录精确 parentRiskFlowRunRef。readWorkflowRunBinding 可同时核对 parentRunRef，或在核验父图所引用子运行时以 parentRunRef 代替未知线程；threadId 与 parentRunRef 至少提供一项。该证明连接同工程原 audit_entry_id、启动 action、targetRef 和 run/thread，父引用必须完整 JSON 精确相等；其它命令或任意审计不能替代。历史缺因果绑定收据不被推测成有效父子证明。

readWorkflowRunBinding 的可选 actorId 与 authorizationContextRef 进一步核对原启动收据及其审计的主体和授权引用，生产校验必须提供图状态的原授权引用及本次主体；新的恢复授权只承担当前权限复验，不覆盖原启动身份。识别入口的准备引用与图版本通过既有 identificationRunIdentityFor 重新派生后核对精确启动 runRef/threadId，不维护另一份身份算法。宿主按工程绑定核对三图的 graphVersion，再组合各所属模块证明；历史授权正文按 C06 精确持久来源读取，主体和工程必须与本次运行一致。

AssessmentGraphStateV1 的 entrySnapshotRef 在 A0 可缺省；仅 A0 的启动、失败或取消状态允许无入口快照，A1 及后续阶段必须具备原三种精确入口快照之一。删除未登记的 assessment-preparation seed，A0 通过原所属模块冻结/读取真实入口，业务登记提交后才把该引用写入图状态。恢复不从 seed、前缀或 checkpoint 内容补造快照。已有真实快照状态继续可解析。

A0 entry-snapshot 登记行使用既有 inputSnapshotRef 保存上述三种入口的原精确引用。WorkflowGraphRegistrationStoreV1 增加 readAssessmentEntrySnapshot：按工程/runId 与 resultKind=entry-snapshot 读取最多两行检测冲突，当前 C06 验证后返回唯一有效的 AssessmentEntrySnapshotRefV1；无登记、缺引用、多个登记或不兼容类型失败闭合。评估运行时 stateOfCursor 通过该窄口恢复入口引用，不重算或重新冻结。forecast/feedback 分段入口的派生引用由 C30 A0 正式登记，C28 后续再按原协议保存正文；其生命周期证明首先核对 C30 精确入口登记，不要求尚未执行的 C28 提前写事实。

增量迁移 000058 仅调整 workflow_graph_results_kind_ck，允许 entry-snapshot 携带可选 input_snapshot_ref；其它六类引用配对、审计和追加权限保持原约束。历史空引用行保留，窄读不会为其补造引用；回退若已有新入口引用则由原 CHECK 拒绝，不删除或改写历史事实。发布清单最终迁移为 000058。checkpointer.put 返回配置保留本次 runtimeContext，后续调用继续使用该身份；新请求仍须显式提供当前上下文。

SSE 的 runEvents provider 使用 workflow 公开 createPostgresRunEventReaderV1，保持原 RunSubscriptionRequestV1/ProjectionSubscriptionResultV1。新增 000057_workflow_run_events 迁移及只追加 business.workflow_run_events：projectId、runId、runVersionId、eventId/eventVersion、eventOrder、原 authorizationContextRef。每个事件只按原事件显式 identificationRunRef/assessmentRunRef/waitingRunRef/resumeRunRef、aggregateRef 的 workflow-run 或原 C06 持久签发的 causalRunRef 登记；不同精确引用可各自关联，去重，不从 correlationId、裸 runId、时间或字符串猜版本，也不自动扩展运行家族。登记由原 outbox.events INSERT 的数据库触发器完成，与原命令/审计/事件同事务，失败回滚原事务；没有可证明运行归属的事件保留原 Outbox，不创造关联。既有事件只按相同归属规则一次性回填，次序为 persistedAt/eventId；新事件按工程内事务锁串行分配 eventOrder，锁持有至提交，避免较小游标迟提交造成漏读。序号空洞合法；一个事件多个运行关联共用序号。重放不新增事件，Outbox ack/失败不修改关联。API/Worker 对关联表仅 SELECT，触发器经受限固定 search_path 的 definer 写入，运行主体不得直接 INSERT/UPDATE/DELETE/TRUNCATE；不授 API 读取原 Outbox 正文/租约的权限。

读取先按原 queryId/branch=projection.subscribe 复验当前工程、主体及单能力，核对返回上下文；单批固定最多 64 条，按 eventOrder 升序 keyset。afterEventId 必须精确定位同工程、同 runId/runVersionId 的已登记事件，且当前调用方可读取；未知、跨运行/工程/版本或当前不可读游标失败，不重置。每条返回前以原 authorizationContextRef 经 C06 readDeploymentAuthorizationSource 取真实来源范围，来源工程或引用不一致失败。原 subscribe 用原 queryId 复验该事件范围，继续支持已持有足够授权的调用方。真实 HTTP SSE 使用新增窄接缝 subscribeWithSourceAuthorization：API 保持基础订阅授权，以当前 Cookie 的 human-session 为每条事件及游标签发 projection.subscribe 的精确空间与来源范围，每次采用新的调用身份；reader 核对返回主体、工程、单能力和授权引用，并按该签发身份通过 C06 再次复验。来源读取不替代订阅者权限，reader 不自行签发或扩大原授权。ApiPortsV1 增加可选 runEventSubscription 注入位，生产组合必须提供该方法；原 HTTP 与 core DTO 不变。任一批内事件不可读时整批拒绝，不返回部分或越权引用，也不在内存推进游标；技术失败保留原失败类别。只返回 DomainEventRefV1，不返回事件正文、内部序号或原授权记录；事件读取不写业务事实，授权签发与复验保留 C06 安全审计。无事件且无游标返回空批等待，不能用空批证明业务完成。宿主注入真实 reader；SSE 时间/背压继续使用 API 原有有界策略及 Schema，不新增部署默认预算。

API 必须显式装配全部 ApiPortsV1，路由可用性由实际接线决定：

| API port | 唯一 provider |
| --- | --- |
| access / systemAdministration | 同一 createPostgresLocalIdentityAccess 及其 systemAdministration |
| engineeringData / engineeringDataCatalog | engineering context/source registry / catalog adapter 的原解析器 |
| knowledgeModeling | C17 façade，retrieve 委派 C20 |
| riskIdentification / riskIdentificationRead | C24 runtime / PostgresRiskIdentificationReadAdapter |
| riskAssessment / riskAssessmentRead | 同一 PostgresRiskAssessmentEngine |
| warningResponse | 原 warning.open、recommendation、responseLifecycle/calibration 三分支的类型化分派 |
| warningResponseRead / calibrationGovernance | warning lifecycle / calibration adapter |
| reviewAudit / reviewQueueRead / reviewAuditRead | 同一 review adapter / queue adapter / audit read |
| agentTask / agentTaskRead | 同一共享 registry 与持久 Agent adapter；不另建只读任务库 |
| humanDecisionFeedback | PostgresHumanDecisionFeedbackAdapter |
| workflow | C30 workflowPort，identificationRuntime=C24，assessmentRuntime=C25 |
| projection / projectionResultRead | workflow projection.queryProjection / resultRead |
| knowledgeGovernanceRead / knowledgeRetrievalRead | 原 knowledge governance / retrieval read adapters |
| projectionReportRead | report export.reportRead |
| systemOperationsRead | D-20 有界真实探针 |
| qualityProjectionQuery | 原 PostgresQualityProjectionAdapter，两阶段 source grants 保持 |

修正 API qualityProjectionWithGrants 的“完整 projection 存在就不接管”判断：只按 queryType=quality-evaluation 选择 C36 窄口并完成两阶段来源授权，其它 queryType 委派原 projection。两个 provider 并存时不能丢掉 C36 权限过滤；缺任一声明的 port 就绪失败。

Worker 用同一 policy/registry/runtime 装配 C15、C17、C20–C25、C27/C29、C30，runner.runOnce 的有限轮询由宿主驱动，不修改任务预算。Outbox 的 12 个已知事件逐项登记：

AgentRuntimeRunnerOptionsV1 增加可选 runTask(task, operation) 回调：claim 后原 #runClaim 的完整执行（模型、工具 execute/recover、候选校验/收口和原租约预算处理）都在宿主 authorizationScope.runTask 中运行，默认直接执行保持原调用方。作用域构造失败保留未确认租约的原过期恢复语义，不伪造完成或另开任务。宿主共享 runner 复用同一 store/registry/modelStep，知识编制终态失败继续经原 settleAuthoringFailures 收口。

| eventType | handler / 投递处理 |
| --- | --- |
| knowledge.identification-basis-published.v1 | C20 projectionHandler.handle |
| warning.warning-recorded.v1 | consumeWarningRecordedForInAppNotification |
| review.review-resolved.v1 | C24 consumeRecoveryEvent |
| engineering.inputs-ready.v1 | C30 applyIdentificationPreparation |
| identification.risk-record-accepted.v1 | C30 applyAcceptedRisk |
| engineering.assessment-input-changed.v1、knowledge.assessment-basis-published.v1、assessment.recorded.v1、warning.warning-acknowledged.v1、warning.feedback-recorded.v1、warning.calibration-suggestion-created.v1、review.review-requested.v1 | 现有规格无后台 consumer，显式 no-background-consumer 登记；事件仍在耐久日志/SSE 中，ack 不删除 |

执行消费者完成耐久幂等回执后才 acknowledge；无 handler 的已知事件只按显式登记 ack，未知事件记录失败、非就绪，不静默吞掉。重投沿 eventId/consumerName 原身份，不再次生成人工决定。SIGTERM 取消轮询/新 claim、drain 限时，lease 未确认就交给原恢复语义。

### D-22. 测试与运行命令契约

命令按当前实际作用与待实现作用登记，配置校验成功不表示真实场景已执行。

- 现有：pnpm build/typecheck/lint/test/deps:check/deps:policy/openspec:validate；pnpm test:browser 是迁移后 apps/web 的真实浏览器项目。
- 已有：pnpm test:deployment 是工程测试；pnpm test:desktop 目前只跑 desktop security/packaging 单元测试。pnpm desktop:package / deployment:verify 是正式介质入口；deployment:smoke 与 deployment:benchmark 目前同指 acceptance.mjs 的配置校验，不计真实取证。
- IP-15 新增网络 API 协议测试和显式真实 smoke。IP-16 新增 node scripts/deployment/start.mjs（功能宿主启动）及 node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir> [--resume]（真实功能验收）；无需增加 pnpm 别名。
- 环境文件通过 RISKFLOW_DEPLOYMENT_CONFIG、RISKFLOW_RELEASE_MANIFEST 和 RISKFLOW_ACCEPTANCE_CONFIG 读取路径；文件内容按 D-19 校验，秘密路径仅由部署配置的 database.secretFileRefs 逐职责绑定，命令行不带秘密。桌面 package/test 从 RISKFLOW_DESKTOP_BUILD_CONFIG/ACCEPTANCE_CONFIG 读取受控路径。
- 当前网络 smoke 通过 RISKFLOW_NETWORK_API_SMOKE=1、RISKFLOW_MODEL_GATEWAY_CONFIG、RISKFLOW_MODEL_GATEWAY_SECRETS 显式启用；node 功能验收与浏览器命令连接真实服务。当前必需输入/能力缺失或关键 skip 非零失败；未来平台/GPU 材料不在其预检范围。
- pnpm verify、test:browser、test:deployment 和 network API 协议测试提供工程证据，真实 network smoke 与 functional.mjs 提供当前功能证据。C38 先补齐正式 Electron Playwright、部署 smoke/benchmark 的真实执行和报告链，再运行签名制包、平台和实机取证；不从现有命令名称推定实现完成。
- benchmark 记录真实介质/配置与 4090 24GB/128GB 主机、GPU/OCR 分配、并发/延迟/吞吐/CPU/RAM/显存/磁盘及分阶段停写恢复耗时；阈值来自批准输入，不预设吞吐、RPO/RTO 或 SLA。

### D-23. 网络 API 后端复用唯一模型调用契约

选择原生 fetch 实现协议 adapter，不加入供应商 SDK、多供应商路由或自动回退。core ModelGatewayPortV1、请求/结果 Schema 与调用方不变。ModelGatewayDeploymentConfigV1Schema 仍为 strict 判别联合：backend="llamacpp" / "network-api"，config 分别使用原 LlamaCppDeploymentConfigV1Schema 或 NetworkApiDeploymentConfigV1Schema；网络配置自身以 protocol="openai-chat" / "ollama-embed" 判别。保留原部署身份、能力、上下文、尺寸和硬预算字段及唯一部署 registry；每项任务固定精确部署，不运行中切换。协议专属字段只存在于对应分支。

`@riskflow/adapters/model` 继续唯一导出同名 NetworkApiDeploymentConfigV1Schema。两种协议共用 schemaVersion="1"、deploymentRef、serviceContractRef、modelVersionRef、baseUrl、modelId、capabilities、contextWindowTokens、requestTimeoutMs、streamIdleTimeoutMs、maxResponseBytes、maxInputBytes、maxBatchItems 与 inputTokenUpperBoundPolicy（maxTokensPerInputByte、requestOverheadTokens）；原 C05 请求/结果预算与身份语义保持。embeddingDimensions 仅在 embedding 部署中必填；maxOutputTokens 及 credentialRef 仅适用于聊天协议，后者由受限秘密文件解析为 Bearer token。所有预算显式有限；空闲时限不超过总时限，输出上限不超过窗口。禁止凭据、query、fragment 和重定向。

`openai-chat` 使用 HTTPS 与固定 OpenAI Chat Completions 路径，只声明 completeStructured、streamConversation；其 credentialRef 必填，业务不能覆盖端点、模型或参数。结构化配置新增必填 structuredOutputMode（server-json-schema 或 schema-prompt）和 reasoningEffort（low、medium、high、xhigh、max）。server-json-schema 只有在真实证据证明目标服务执行所声明 JSON Schema 约束时才可配置。schema-prompt 从调用方同一 Zod Schema 生成 JSON Schema，并放入固定 system 消息；正常终止后只解析一个 JSON 值，再由原 Zod Schema 严格复验，拒绝额外字段、非法或截断输出，不修补、不重试、不静默切换模式。确定性业务校验仍在网关之后执行。

MiniMax 当前冻结项为 `https://api.minimax.cn/v1`、`MiniMax-M3.1-Flash-Preview`、1,000,000 token 上下文、供应商 `max_tokens` 上限 524288（包含 reasoning token）、schema-prompt 与 reasoningEffort=low。实际请求使用远小于供应商上限的显式任务预算，并以真实 usage 核对硬预算；不以 524288 作为 RiskFlow 的预算。MiniMax 的 server-json-schema 支持未证实，不得声明该模式。reasoning_content 不得持久化或展示；C04 可保留剔除 reasoning_content 后的协议证据，原始响应正文仍按 C04 既有受保护权限范围管理，日志、界面和普通验收报告不显示思维内容。

`ollama-embed` 只声明 embed，使用原生 `/api/embed`，显式设置 `truncate=false`，不配置 credentialRef。明文 HTTP 仅允许用户指定的固定 origin `http://192.168.13.11:11434`，模型与 origin 均由受控配置冻结，业务不可覆盖。当前预期身份为 `qwen3-embedding:4b`、Ollama 0.40.0、model digest `df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907`、context 40960、embeddingDimensions 2560；expectedModelDigest 与 expectedServerVersion 必填，并由 `/api/version`、`/api/tags`、`/api/show` 启动/就绪复验。任一不匹配均拒绝就绪，不请求业务 embedding。

serviceContractRef 绑定经批准的 adapter 协议/能力证明并映射原结果 serverBuildRef，不伪造供应商内部构建。modelVersionRef 绑定批准服务/模型身份；无法证明精确权重时明确其可观测边界。聊天输入 token 按批准协议的保守上界 ceil(序列化请求 UTF-8 字节数 × maxTokensPerInputByte) + requestOverheadTokens 计算，加输出预算后不得超窗口或上层 token 预算；证明不足时不就绪，不伪称精确 tokenizer 计数。MiniMax 的 max_tokens 与响应 usage 均纳入原硬预算；缺少必需 usage 时失败，不把 unknown 当零。

网络副作用前复用 C06/父工件校验。HTTP/JSON/SSE、取消、C04 先耐久后返回、幂等与遥测复用 C05 调用逻辑；必要公共逻辑从 llama.cpp 文件抽到同目录 model-gateway-runtime.ts，由两个 adapter 消费，禁止复制整套网关。C04 证据须剔除模型内部思考字段并保留受保护正文的访问边界。401/403 映射不可重试 MODEL_HTTP_ERROR，429/5xx 沿原 HTTP 可重试标记，断流/尺寸/结构错误沿原闭合代码；adapter 不自行重发生成。无新业务表、迁移、领域字段或依赖。Embedding 身份改变须走 C20 新代际构建及质量门，不能混用旧空间。

### D-24. 功能证据必须从正式结果收口

资料预置采用受控 `scripts/deployment/provision.mjs` CLI，复用同一部署加载及公开 access、ArtifactStoreV1、EngineeringContextSourceRegistryV1、StructuredDocumentConverterV1。预置配置为 strict schemaVersion="1"、runId、loginName、passwordSecretId、projectId、steps（有界、固定 stepId 与操作判别联合）。操作闭合为原 context revision、artifact put（绝对输入路径与原有界 ArtifactPutCommandV1 草案）、source delivery、document conversion、source segments 与原 systemAdministration command；载荷复用原公共 Schema，authorization/actorId 从真实 session 按固定 branch 签发，配置不能传假上下文。后续 step 仅能引用前序成功结果，副作用固定 commandId/idempotencyKey/issuedAt；同身份续接复用回执，异载荷由原幂等契约拒绝。首次工程、成员与来源授权通过原 systemAdministration 正式命令预置，不直接 SQL 插行。输出安全引用与终态，无秘密或资料正文；不将 reports/expected/scenarios 送入模型。CLI 不新增通用上传 API 或第二数据库，扫描件在 OCR 配置为 null 时明确 BLOCKED，文本和已支持结构化格式继续验证；报告列出未验扫描链路。

共同基础宿主由 `scripts/deployment/start.mjs` 公开 createDeploymentFoundationV1({config,secrets,role,finalMigrationVersion})，返回 access、artifactStore/referenceGuard、runtime.db、transactionUnit、contextSource、documentConverter、close；role 仅 api/worker/provision，finalMigrationVersion 来自已批准发布清单。provision 不创建模型/业务工作线程，所有读取与副作用仍由真实模块及权限执行。API/Worker 在基础上装配 D-20/D-21 全部能力；provision 基础可用于验收准备，不能作为生产就绪或业务 PASS 证据。Postgres 公开 index 补导出已有 createPostgresRuntime 与类型、允许 transactionUnit 复用显式 runtime（原连接入口继续可用）；artifacts 公开本地 referenceGuard factory，不暴露 getPostgresTransaction。共享宿主不能导入这些包的私有源码或测试文件。

基础加载器读取 RISKFLOW_RELEASE_MANIFEST 指定的 strict 发布清单，核对 releaseId 后传递 finalMigrationVersion 给基础工厂。工厂必须在模块创建与资料副作用前核验迁移账本；缺清单、错发布、错迁移序号均拒绝。资源按创建的逆序串行关闭，单项失败继续关闭其余资源后报告失败。

synthetic-acceptance 合置环境使用既有本地 C04 公开工厂与同库 referenceGuard；createDeploymentFoundationV1 对 production 当前明确拒绝。D-18 mTLS put/open adapter 不提供生产 checkpoint 所需 verifyContent；完整远程宿主交 C38 F-03 先闭合协议和装配设计再开放。OCR=null 仅允许合成预验收配置，并且 REQUIRED_PRODUCTION_DEPENDENCIES 的 OCR 要求保持；当前文本链路可以建立转换器，完整就绪与扫描功能 PASS 仍须真实 OCR。

复用 scripts/acceptance/synthetic.mjs 的材料检查、正式 HTTP 操作目录、真实登录、固定命令身份和安全 checkpoint。新增 functional.mjs 组合 check/run 与显式终态核验，不放宽原 run 的 submitted 语义。FunctionalAcceptanceConfigV1 为独立 strict 宿主配置：schemaVersion="1"、runConfigFile（原 synthetic 配置文件路径）、observations（非空有界数组，最多 128 项）、pollIntervalMs、timeoutMs、maxQueries。每项 observation 固定 stepId、operationId（正式 query 操作目录成员）、payload（原查询 Schema 和模板）、expectedTerminalStatus、requiredReferences（非空字段路径选择器）；引用只取同次 run 回执，预算为显式正整数并受总截止限制。人工决定仍须用户执行正式确认，等待时输出 awaiting-human，不自动代为采纳。

功能宿主 start.mjs 读取部署及 D-23 模型配置/秘密，核验已完成的显式初始化和迁移兼容性后，按 D-20/D-21 装配全部真实 provider、API listener 和独立 Worker；启动不自动迁移或引导管理员，不复制测试 harness、固定口令、空仓储或假策略。必需依赖缺失时明确拒绝启动/就绪。IP-16 保留已实现启动与工具程序，后续 IP-17–IP-22 在实际服务和批准输入上取证；工程装配不证明业务终态。

终态观察程序保持正式 query 模式、同次运行引用、硬查询预算、等待人审/超时/缺引用非 PASS 及安全报告边界。完整资料→识别→评估→预警→处置/人工决定→执行反馈、会话流/拒权/重试与可见浏览器证据交后续 D-29/IP-19–IP-21；本 change 不声称该链已实跑通过。

## Risks / Trade-offs

- 服务器不可达时基础业务不可用；薄桌面客户端不会消除网络与证书部署要求。
- 三 VM 和逻辑副本均处于同一物理故障域，宿主故障可能同时丢失系统与副本。
- UI 迁移须合并已有会话、错误、导航与确认机制，避免 demo 与 Web 形成第二事实源；当前 v2 页面不等于真实接线。
- 真实生产接线远超过容器文件，harness 通过不能证明必需 ports/handler 已装配。
- 跨 VM 工件访问、停写边界与全工程授权直接影响恢复安全，不能以共享目录假设略过。
- 桌面打包与真实三 VM 装配仍需实施验证；规划完整不代表运行已通过。
- 网络 API 可用性、模型版本可观测性与计费属于外部依赖；当前证据仅适用于批准后端与样本，不能证明最终本地模型质量或吞吐。

## Migration Plan

1. 已实现成果按本 change 的保留任务和逐场景工程证据核验，编写 verification。
2. 经授权审阅 dirty 实现并形成固定 Git 检查点、必要审计与集成门禁后，按正式流程同步/归档本 change。本轮仅准备，不提交或归档。
3. 后续 change 完成 IP-17–IP-22 的剩余实现与真实功能取证，形成自己的 verification。
4. C38 消费 F-01–F-05、前置 D-23/D-24 和后续交接，按最终版本完成正式交付，不继承工程或功能报告为实机 PASS。

## Open Questions

工程范围无开放技术决策。真实功能输入和现场缺口由后续 handoff.md 登记；C38 才要求签名、原生平台、禁网三 VM、4090/128GB 和模型/OCR 介质。合成样本适用边界保留，不能宣称真实工程准确率。
