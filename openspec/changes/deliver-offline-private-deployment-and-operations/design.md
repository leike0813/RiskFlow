## Context

**状态：规划已闭合，实施进度以 tasks 为准。** D-16–D-22 冻结部署、桌面、策略与生产接线；implementation-plan/tasks 覆盖 apply 前置。实现和工程检查完成后交接 Finalizer；verification 区分工程检查结果与实机交付证据。

固定代码基线：`6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`。change 自身使用 `orchestrated-delivery`。现有代码仍为三应用三共享包，`openspec/config.yaml` 当前描述与代码一致；四应用目标在本 change 的工程基线 delta 中声明，实施时同步实际工程配置。

产品设计入口：`.scratch/riskflow-master-plan/prototypes/desktop-client-architecture.md`。三 VM 与恢复责任来源于 `issues/08-private-deployment-governance.md`；迁移范围由本轮用户确认，模块行为以主规格与当前代码为准。

| 接缝 | 当前实现 | 本 change 需完成的部分 |
| --- | --- | --- |
| API | `apps/api/src/app.ts#buildApi` 与 `BuildApiOptionsV1`，工厂不监听 | 真实 ports 装配、进程入口、应用 VM HTTPS 接入 |
| Worker | `apps/worker/src/index.ts` 和 C20/C24/C30 等组合根 | 耐久消费循环、全部必需 options 与既有 handler 映射 |
| PostgreSQL | bootstrap、migrations、pool、checkpointer；四个 NOLOGIN 组 | 部署 LOGIN、独立初始化、受限运行连接 |
| 工件 | C04 `createContentAddressedArtifactStore`、`createHashManifest`、`reconcile` | 同机逻辑副本、全工程核对、人工恢复切换 |
| 模型/OCR | 既有 strict 配置与真实服务 smoke | 制品冻结、三 VM 接线、预算与资源实测 |
| 运维读 | C35 四组件健康/模型查询与当前管理员授权 | 注入真实且可取消、有截止时间的 provider |
| UI | `demo/src` 真实业务接线，`demo/v2` 设计参考；`apps/web` 壳与 C36 | C32–C35 全部页面归 Web，唯一会话/HTTP/导航/确认 |
| Desktop | 当前不存在 | 薄 Electron HTTPS 入口、离线安装包与真实平台验收 |

浏览器 harness 只作接线参考，其中固定口令、合成结果、模型替身、直接 SQL 夹具和固定 HMAC 不能进入生产。将静态站点放进 Electron 安装包会增加跨来源会话和版本协调，本次选择服务器提供 Web。

## Goals / Non-Goals

**Goals**：一套完整 Web UI 同时服务桌面与浏览器；三 VM 可真实启动、停止并离线交付；权限、版本与审计贯穿；同机逻辑恢复可核验；真实平台和硬件证据可供 C38 引用。

**Non-Goals**：本机独立后端/模型、移动端或 PWA 交付、离线业务同步、独立冷备、HA/PITR/灾备、持续备份、周期演练、生产级 RPO/RTO、长期代运维、自动换模型/扩预算、通用运维 Shell/SQL/文件 API、LoRA 训练与 C38 合同总验收。

## Decisions

### D-01. 服务器沿既定三 VM 拓扑

同一物理服务器内：推理 VM 直通 GPU 并运行 llama.cpp/模型；应用 VM 承载 Web、API、Worker、HTTPS 入口与必要解析；数据 VM 承载 PostgreSQL、Qdrant 与不可变工件。普通客户端只访问应用 HTTPS，内部服务和管理网络分别受限。API 与 Worker 分进程，继续直接复用领域模块，不通过内部 REST/MCP 互调。

systemd、Caddy 与数据 VM 本地 C04 流服务分别按 D-16/D-18 装配，客户端仅连接集中 HTTPS；Docker 只承载数据服务的固定 OCI 制品。

### D-02. 发布与配置保持唯一且类型化

`ReleaseManifestV1` 固定 release/codeHead、平台、工具链、服务端与桌面制品、精确版本、相对介质位置、字节数、摘要、官方来源、许可证与 SBOM；OCI 项另含 digest，不使用 latest。

`DeploymentConfigV1` 固定三 VM 的网络、数据与秘密定位、精确业务策略和生命周期预算，组合既有模型/OCR/工件等 Schema，不复制阈值。部署配置位于 adapter/宿主边界，不进入领域 DTO 或图状态。桌面配置只含批准 HTTPS origin 和桌面所需公开发布信息，不持有服务器秘密。

独立秘密文件按各 VM 运行主体最小权限加载，密码/TLS 私钥/HMAC 不进入源码、镜像、日志、argv、发布 JSON 或恢复描述。部署 strict Schema 的完整字段和公开导出按 D-19 冻结。

### D-03. 制品与新增依赖在施工图前冻结

复用 Node `>=24.12.0 <25`、`pnpm@11.10.0` 与 React 19.2.8。已有真实基础设施参考为 PostgreSQL 18.6-bookworm、Qdrant v1.19.0 的仓库固定 digest，以及 C13 PaddleOCR/PaddleX 3.7.0 和 PP-StructureV3；实际发布清单必须核验真实制品，不能复制测试标签冒充发布。

llama.cpp 构建、模型/Embedding 权重、窗口、维度、OCR 全部模型和许可证由真实介质提供。RTX 4090 24GB/128GB 为最低实测基线；原聊天候选包络为 Qwen3.8-27B Q4_K_M、单槽、32K 总上下文、F16 KV、MTP 关闭，不据此承诺更大窗口或吞吐。

Electron、打包工具和迁移需要的 Router/图表依赖逐项记录精确版本、用途、官方来源、许可证、离线方式和退出条件。Router 6.30.6/ECharts 5.6.0 作为 D-16 的精确迁移依赖，当前根锁文件尚无这些依赖，安装属于后续实施。Electron 内置 Node/Chromium 与服务端 Node 分别记录；各平台二进制和第三方许可纳入 SBOM/许可全集。

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

GPU 归推理 VM；OCR 优先在应用 VM 以 CPU 和独立并发/内存/时间预算运行。实际资源影响由目标环境测量，不用容器内存限制声称显存隔离。

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

### D-12. 验收使用真实发布与目标环境

迁移 C32–C35 浏览器行为验收到 `apps/web` 并保留 C36；真实 HTTP/会话/数据库/投影与正式命令仍是测试面。合成样本明确待甲方复核，不把随机模型响应设为期望。重复覆盖按稳定可观察行为合并，不测试 CSS、完整文案或内部调用顺序。

C37 实际发布验收覆盖无公网安装、三 VM 端口隔离、完整页面与桌面、真实模型/OCR、重启幂等、权限拒绝、逻辑副本破坏检测、双索引重建、升级回退和目标资源基准。局部 harness 不替代实际部署；启用的 smoke 缺环境或关键 skip 不能通过。

报告记录代码/配置/模型/平台、数据规模、并发、延迟/吞吐、峰值资源、磁盘、停写与恢复分阶段耗时；不要求生产级 RPO/RTO 或 SLA。真实硬件/模型/平台缺失则阻塞对应验收。

实施分为代码与工程检查、Finalizer 审查、目标环境交付验收。代码阶段包括部署/打包/验收程序、配置与手册，并使用真实本地 PostgreSQL、Qdrant、HTTP 和 Chromium 验证适用接缝；模型协议与配置校验可使用明确标注的测试输入，不将其当作真实模型或生产策略。生产证书、签名材料、真实模型/OCR 介质、三平台和目标硬件不是代码开发及工程审查的前置条件。相关程序须在输入缺失时正确拒绝，剩余独立实现继续推进。

实现任务与交付取证任务分别勾选；全部实现任务及工程检查完成并形成固定检查点后即可交接 Finalizer，未完成的交付取证任务保持未勾选。Finalizer 先核验、修复并回归代码，verification 保持一个 C37 总体 PASS/FAIL/BLOCKED 结论，同时逐项记录工程检查结果和目标环境证据。实现缺陷记 FAIL；仅缺交付输入时对应验收及总体结论记 BLOCKED，不阻止已批准范围内的工程审查。环境齐备后补跑交付验收并更新同一工件；总体 PASS、成功集成和归档仍要求全部交付证据及必要审计通过。

### D-13. 文件所有权与当前修改边界

| 区域 | C37 目标变化 |
| --- | --- |
| `apps/web/` | 完整页面、真实客户端接线、导航/主题/图表复用、C36 合并与浏览器验收 |
| `apps/desktop/` | Electron 主进程、受控 HTTPS 入口、本地连接状态、平台打包及真实验收 |
| `deployment/`、`scripts/deployment/` | 三 VM 配置/服务说明、离线发布、生产组合、生命周期、逻辑副本/核对/切换/基准 |
| `packages/adapters/src/deployment/` 与公开 exports | 已闭合的部署 Schema；所需 PostgreSQL runtime/事务公开导出 |
| 根 workspace、package、tsconfig、依赖政策与检查器、dependency-cruiser | 七成员、Desktop 构建/依赖/边界与独立平台打包命令 |
| `openspec/config.yaml` | 实施时同步四应用三共享包的当前工程描述 |
| Playwright/相关 Vitest 配置和测试 | Web 生产验收归属迁移；桌面与部署真实行为验证 |
| 项目设计文档与 C37 artifacts | 本轮已经授权的设计同步，不修改生产代码、锁文件或运行配置 |

主规格通过当前完整 delta 在归档时同步，保持 Requirement 名与原场景；C32/C33 Purpose 中的 demo 归属也须在正式同步核查中修正，不能留旧目录描述。归档历史不重写。原执行图、Orca 状态、历史迁移、业务规则与用户改动属于保护边界。

### D-14. Electron 仅提供 HTTPS 桌面入口

新增 `apps/desktop`，使用系统原生标题栏，主进程加载批准 HTTPS origin。不本地打包 React UI，不导入 Web 源码，不改变 Web 既有路由/base 或同源 Cookie/SSE。业务 renderer 禁用 Node、启用 context isolation/sandbox/CSP，导航按 URL 的协议/origin/用途校验，禁止任意新窗口和外部目标。

首期使用原生浏览器文件选择与经授权下载，不提供特权 preload/业务 IPC。连接失败由本地无特权状态页与主进程重试入口处理。后续确需桌面增强须通过具体有界接口，不暴露通用能力。私有 CA 经系统信任链部署，不忽略证书错误。

独立客户端会话不与普通浏览器共享，Cookie 不经 preload/日志暴露；不持有数据库/模型凭据。关闭窗口只断开 UI，原服务器任务继续；重新打开先认证并读取同一任务。断线不自动提交未知结果命令，订阅继续沿原游标和预算恢复。

### D-15. 服务端、桌面与后续移动发布独立

服务端发布提供完整 Web UI；桌面安装包固定 Electron/Chromium/内置 Node 和批准平台的身份，两者分别记录兼容范围。桌面升级通过已核验离线安装包人工进行，不引入公网自动更新。每个声明的平台必须有真实安装与安全验收，不以一平台构建证明全平台。

Web 保持浏览器独立，后续手机/平板可复用页面与 API，但触摸、小屏、宽表格和复核操作需要单独适配。Electron 不提供移动运行时；当前不扩入 PWA、移动原生封装、本地业务缓存或同步冲突协议。

### D-16. 部署工具、平台与依赖冻结

服务端 VM 基线为 Ubuntu 24.04 LTS x64；systemd 管理 Node API/Worker、工件服务、Caddy、llama.cpp 与 OCR 进程。PostgreSQL、Qdrant 使用离线导入 OCI 镜像，由 systemd 调用 Docker Engine 的固定容器启动/停止，不使用 Compose 或容器内业务编排。Docker Engine、GPU 驱动、llama.cpp/Paddle 的实际二进制与系统包须由 ReleaseManifest 精确记录版本、架构、摘要和许可；这是发布介质输入，服务布局及启动方式不再交给实现阶段选择。

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

桌面交付矩阵固定为 Windows 11 x64 / NSIS、Ubuntu 24.04 x64 / AppImage、macOS 14+ arm64 / DMG；各自原生构建机与真实目标机验收。Windows 使用组织代码签名；macOS 使用 Developer ID 签名及公证票据预附；Ubuntu 验证批准介质签名与摘要。签名材料属于秘密输入，缺失阻止对应正式包。打包准备阶段允许联网制备；离线构建与安装阶段禁网，electronDist 指向本地 Electron 包，并预置 NSIS/app-builder 等完整缓存，缺项直接失败。显式携带 Electron、Chromium、Node 和打包依赖的 LICENSE/NOTICE，不假设工具自动收齐。外部二进制的第三方许可报告独立于生产 npm 的 MIT/Apache 白名单，不扩大业务依赖政策。

打包程序、平台配置、签名接线、缓存预检和许可证/SBOM 收集的工程完成以本地行为检查为证据；正式签名包的生成与安装取证归交付验收。测试输入仅用于验证程序契约和缺项拒绝，不生成可冒充正式包的回退产物。

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
| DeploymentConfigV1 | schemaVersion/ref/releaseId/instanceId、三 VM host 与端口、publicOrigin、local roots、database secretFileRefs/LOGIN roleNames、modelGateway/OCR/artifact/outbox/Agent 原 Schema、policyCatalogRef、projectBindings、workerPollMs/并发/停止期限、health/log/资源预算；strict、无隐式默认 |
| DesktopConfigV1 | schemaVersion=1、deploymentId、publicOrigin（纯 HTTPS origin、无用户信息/query/hash）、serverCompatibilityRange；配置由安装者受控写入，不让网页或自由 CLI URL 覆盖 |
| DeploymentOperationV1 | schemaVersion=1、operationId、idempotencyKey、action（verify/init/status/maintenance/backup/restore-verify/activate/rollback/benchmark）、releaseId/configRef/instanceId、actorId、currentAuthorizationRefs、issuedAt、expectedRevision、backupId/targetInstanceId（按 action 必需）、confirmation（精确目标/版本/修订；仅 activate/rollback）、payloadDigest |
| LogicalBackupDescriptorV1 | backupId、operationId、sourceInstanceId、release/config/model/OCR/policy refs、projectIds 与逐工程授权/manifestRef、dbSnapshotRef/fileSnapshotRef、dump/file 清单/摘要、迁移版本、停写证据、创建阶段与核验审计引用；秘密与连接串不进入描述 |
| DeploymentOperationResultV1 | operationId、revision、stage、status、safeReasonCode、release/instance/backup refs、perProjectAuditRefs、operationAuditIds、阶段计数/耗时；不返回正文、秘密或原始宿主路径 |

预算数值是经资源测量/批准配置，不在宿主里创造业务阈值。配置只引用 secrets 逻辑 ID，由每 VM 私有文件映射；校验运行用户/owner/权限及绝对路径无 symlink，秘密不进入参数、清单或日志。首次 admin 密码只经独立秘密文件传给 C06 bootstrap。配置拒绝任意程序、SQL、远程 URL 或命令片段。

新增迁移 000056_deployment_operations.ts：business.deployment_operations（instanceId/operationId 主键、instanceId/idempotencyKey 唯一、payloadDigest、revision、action、stage/status、安全 inputRefs/resultRefs、leaseOwner/until）；business.deployment_causal_authorizations（rootContextRef/projectId/actorId/branch 主键、真实 childContextRef、invocationId、policyRef、recordedAt；只追加，由 C06 adapter 读取/复验）；business.deployment_operation_audit（eventId 主键、operationId/revision/action/stage/outcome/actor/contextRefs/releaseRefs/backupRef/reasonCode/timestamps，追加写，禁止 UPDATE/DELETE）。单实例活动写运维动作通过 PostgreSQL advisory lock + 操作行租约串行；expectedRevision CAS，每次阶段转换与其审计在同一事务。阶段为 validated→quiescing→quiesced→copying/restoring→verifying→awaiting-confirmation→activating→completed，失败落 failed 或 audit-pending；各 action 只使用相关阶段。租约过期只允许同身份复验外部效果后接续，不推断上次副作用未执行。

部署操作由宿主运维账号执行，专用 LOGIN 仅继承新 NOLOGIN riskflow_deployment_operator（运维表写/审计 append、必要读取）；业务 API/Worker 无宿主控制权限，也无运维状态/运维审计表写权限。因果授权关联表仅授 riskflow_app SELECT/INSERT（由 C06 签发适配使用），Worker 仅 SELECT，双方无 UPDATE/DELETE；后台每次仍复验关联的原 C06 上下文，关联行本身不能产生新权限。备份/恢复正文读取另用独立数据导出连接；宿主权限与 C06 全工程、资料、空间授权两者皆必需。新增 C06 受控 server-side 运维授权适配：读取真实持久授权并复验当前 actor/工程，复用 authorize/verify；不得构造假 context、伪工程或把 system admin 当正文授权。全工程集合经工程注册表窄读枚举，与配置实例 projectBindings 比较；漏项/无权均拒绝。此窄读在 registry 所属 adapter 实现，宿主不跨模块查表。

每工程 C04 hashManifest/reconcile 仍写原 C03 领域审计；部署审计表记录跨工程动作及其回执，不挤入封闭 ContractReference 联合。维护与复制期间宿主 journal 只记安全 operationId/stage/副作用回执，fsync+rename，用于崩溃诊断；无数据库审计回执不得声明 completed。先完成 manifest 登记再 dump/复制，复制结束后记录 live 数据库的 operation audit，描述精确标识 snapshot 与后续 audit 时间。恢复库在原副本集合核对完成之前不创建新诊断工件；后续审计只追加到完成基线核对后的库。

运维 CLI 不自动修改远程 VM：在三 VM 由授权操作者按固定 service 清单分别运行 local 维护动作，协调命令消费带 instanceId/releaseId/operationId 的阶段回执并核验固定内网探针，未经核验不进入 quiesced。systemctl/pg_dump/pg_restore/docker 仅执行固定程序与结构化参数、禁止 shell=true 和任意脚本。切换使用预登记 instanceId→受控本地数据根/连接秘密的映射，激活前复验 descriptor/revision/授权、确认精确目标，再切换服务配置并核对；失败保留两根，按记录人工回退。

### D-20. 策略、窄读与授权真实来源

缺失的 provider 统一来自只读、不可变 DeploymentPolicyCatalogV1。catalog 的每项以 projectId/type/ref 为键，正文由原 core Schema 验证；发布元数据绑定批准者、批准时间与介质身份，缺项/冲突/错版本失败，不引用 demo/test 常量。catalog 不替代 C16/C18/C19 的已发布业务定义：指标、权重、矩阵、阈值、预测/偏差等按正式依据集合成员经其所属 adapter 读取原 C04 正文。新增窄公开 reader 只做精确版本解析和原 Schema 校验，无第二套规则表或默认值。

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
| C30 riskSpatialPairing | PostgresStandardizedRiskInputFactsReader→该精确 riskRecord 的空间→请求 pairings 精确匹配；无/多匹配/无权 undefined，不借其它空间 |
| C30 retryPolicy | catalog 按原 retryPolicyRef 精确读 maxAttempts/backoffMs，保持父任务冻结预算 |
| C15/C17 start authorization，C24/C25/C30 runtimeAuthorization，C20 build/recovery/downstream | 同一 C06 invocation 适配；HTTP 受理阶段用真实会话分别签发固定下游 branch 上下文并耐久关联原 root；后台按目标 branch 查该已签发 context，再经原 system invocation 收窄/复验；禁止从仅有 workflow 能力的 parent 增加能力，原会话/权限失效不得扩权 |
| C35 systemOperationsRead | C05 真实 model observation、API/Worker/模型/数据库四组件探针与原 collector；传递 AbortSignal 与总截止时间，不用 unknown/test 常量假成功 |

C15/C17 现有工厂各自创建 registry；为两者增加可选 registry 注入（缺省维持原工厂行为），C37 始终注入同一个 registry，再注册 C21/C27/C29。各原任务 adapter 可复用同一数据库/事务/registry，统一 runner 和 API 读写指向同一持久任务集合，不新增第二任务表。

跨能力调用在 HTTP 受理、任何业务副作用之前，由 C06 所属适配读取版本化的 rootBranch→下游 branch 闭合清单，用本次真实 sessionToken 分别调用原 authorize，并把 rootContextRef 与各目标 contextRef 写入 deployment_causal_authorizations。只签发固定流程所需分支，actor/project/空间/来源不扩大；一次拒绝阻止受理，已签发但未关联的上下文不能用于执行。令牌仅存本次调用内存、不持久化。后台 resolver 以原 root、目标 branch 与原因果运行身份读取关联、逐项 verify 当前权限，再用该目标分支 parentContext 调原 system authorize；保留原 isAuthorizationSubset。没有关联时失败，不能重构令牌或借别的用户/context。清单归批准 catalog 的 strict ModuleBranch 集合，不接受业务请求新增 branch。运维操作仍按独立宿主权限及逐工程原 freeze/read 授权执行，不增加通用系统管理业务能力。

C20↔C21 和 C17↔C20 是构造引用环、不是业务流程环。宿主建立只绑定一次的窄委派（C17 retrieve、C20 inputReader），先建立 C15/共享 registry/C17，再 C20、C21、C22/C23/C24，最后一次绑定真实委派。绑定前任何调用均抛未就绪错误；全部绑定核验后才监听/claim。不得导入 core/adapters 私文件，只有宿主可组合 apps/api 与 apps/worker 的公开入口。

### D-21. 生产端口与事件闭包

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

施工图的命令分为现有与本 change 必须新增的命令；新增入口及其参数是固定交付内容，不允许实现者临时换成未登记脚本。

- 现有：pnpm build/typecheck/lint/test/deps:check/deps:policy/openspec:validate；pnpm test:browser 是迁移后 apps/web 的真实浏览器项目。
- 新增：pnpm test:deployment（宿主/流协议/权限/恢复集成）、pnpm test:desktop（独立 Playwright Electron 配置）、pnpm desktop:package（原生宿主打包）、pnpm deployment:verify、pnpm deployment:smoke、pnpm deployment:benchmark。
- 环境文件通过 RISKFLOW_DEPLOYMENT_CONFIG、RISKFLOW_DEPLOYMENT_SECRETS、RISKFLOW_RELEASE_MANIFEST 和 RISKFLOW_ACCEPTANCE_CONFIG 读取路径；文件内容按 D-19 校验，命令行不带秘密。桌面 package/test 从 RISKFLOW_DESKTOP_BUILD_CONFIG/ACCEPTANCE_CONFIG 读取受控路径。
- test:deployment 使用真实 PostgreSQL、C04 与 Qdrant，合成 fixture 只在 test/fixtures，必要模型 protocol 测试与真实部署 smoke 分开。smoke 启用项缺输入/服务/目标硬件/平台就非零失败，不能 skip。
- pnpm verify、test:browser 与 test:deployment 用于工程检查；desktop:package、test:desktop、deployment:verify、deployment:smoke 与 deployment:benchmark 的正式运行取证归交付验收。工程阶段以既有 Vitest 测试验证这些程序的输入、结构化调用、结果汇总和缺项拒绝，不要求生产输入齐备，也不把测试替身结果记为实机通过。
- benchmark 记录真实介质/配置与 4090 24GB/128GB 主机、GPU/OCR 分配、并发/延迟/吞吐/CPU/RAM/显存/磁盘及分阶段停写恢复耗时；阈值来自批准输入，不预设吞吐、RPO/RTO 或 SLA。

## Risks / Trade-offs

- 服务器不可达时基础业务不可用；薄桌面客户端不会消除网络与证书部署要求。
- 三 VM 和逻辑副本均处于同一物理故障域，宿主故障可能同时丢失系统与副本。
- UI 迁移须合并已有会话、错误、导航与确认机制，避免 demo 与 Web 形成第二事实源；当前 v2 页面不等于真实接线。
- 真实生产接线远超过容器文件，harness 通过不能证明必需 ports/handler 已装配。
- 跨 VM 工件访问、停写边界与全工程授权直接影响恢复安全，不能以共享目录假设略过。
- 桌面打包与真实三 VM 装配仍需实施验证；规划完整不代表运行已通过。

## Migration Plan

1. 项目设计与 C37 proposal/specs/design 已同步，implementation-plan/tasks 按固定基线实施。
2. 先核对固定基线及 IP-ID 文件边界，再执行施工图；真实输入缺失阻止相应发布验收。
3. 经授权实施时串行处理根配置/依赖锁定、完整 Web 迁移和 Desktop、三 VM 装配与维护恢复；不改写历史领域事实。
4. 全部实现任务及工程检查完成并形成检查点后，由 Finalizer 审查、修复、回归并生成 verification；目标环境缺项单列 BLOCKED，限定审计按项目契约执行。
5. 交付输入齐备后执行正式包制备、三平台安装、真实三 VM 部署/恢复和资源基准，按最终代码与制品身份更新同一 verification；全部必需证据及审计通过后方可成功集成和归档。

## Open Questions

仅可延期到目标交付的真实输入：甲方脱敏样本、实际 OS/驱动/磁盘与内网证书、冻结硬件分配和性能阈值、llama.cpp/模型与 OCR 全部真实介质及许可、平台签名材料。缺项阻止对应正式发布/交付验收，独立实现和工程审查继续；不能靠代码默认值伪造。页面归属、Electron HTTPS 形态与三 VM 产品边界已确认，不再列为待用户确认项。
