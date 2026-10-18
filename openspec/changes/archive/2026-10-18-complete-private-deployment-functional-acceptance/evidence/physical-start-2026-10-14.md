# 物理桌面验收启动记录（2026-10-14）

状态：实例与策略准备已完成，物理 Chrome 已登录真实 HTTPS；完整业务验收仍未通过。最新配置、参数与实际入口见 [runtime-policies.md](runtime-policies.md)。此记录不产生功能 PASS，也不勾选包含完整运行义务的 task。

续接已完成五格式资料的正式登记、转换及质量复验，首个必经清洗 Agent 暴露模型父工件预检的用途缺陷；详见 [实机资料取证](physical-documents-2026-10-14.md)。实际当前 API/Worker 配置为 `deployment-document-quality-v2.json`，下面启动记录的未登记/待启动描述只对应原启动时点。

用户已关闭原系统 Caddy，并授权在现有物理显示器开始实机验收。本次保留旧 C37 容器与数据，未启动系统 Caddy、安装依赖、提交代码或修改编排。

## 已取得的证据

- `:0` 为 Xorg/Xfce 的物理桌面，`VGA-1 connected`，1920×1080、60 Hz；当前工具默认的 `:99` 是 Xvfb，未用于可见验收。
- 已在 `:0` 启动 Google Chrome 155.0.8059.39，使用新的独立验收 profile。CDP 仅监听回环 19222；X11 `WM_NAME`/`WM_CLASS` 和实际窗口截图确认目标窗口在该显示器。页面目前为 `about:blank`，只证明物理窗口前置，不证明业务功能。
- Orca computer-use 接口返回 `unsupported_capability`，提示缺少 python3-gi/AT-SPI；系统包已安装，系统解释器导入成功，但 Orca 使用的环境解析到 Anaconda Python。未修改 Orca 或系统 Python，后续页面自动化可使用本次可见 Chrome 的 CDP。
- `pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1`：通过，无材料包问题。
- 新隔离 PostgreSQL 容器 `riskflow-physical-pg-20261014` 使用已冻结的本地镜像摘要，`--pull=never`，仅映射 `127.0.0.1:19432`，使用独立持久卷。
- 通过既有公开 `initializeDeploymentV1` 显式初始化，迁移账本达到 `000058`；五个职责 LOGIN、检查点表及首次管理员已创建。未直接 SQL 播种业务。
- 首次管理员受限会话被预置程序正确拒绝（`PROVISION_SESSION_RESTRICTED`）；随后通过正式 `changePassword` 接口完成首次改密。
- 通过既有 `runProvisionV1` 的 `system-administration/open-project` 创建 `synthetic-station-tunnel-project`，报告 COMPLETED。正式工程目录读取得到 active 状态、工程访问版本和新根空间精确引用。尚未登记完整业务上下文、资料、配置发布或运行结果。
- 当前运行制品快照已归档并计算真实字节数/摘要；HEAD 与工作区 diff 摘要分别记录。该快照不是 C38 离线介质验收，不将旧 HEAD 当作包含本轮未提交实现。

## 首轮发现与当前状态

1. 首次模型 smoke 因 Ollama 0.40.3 与原冻结 0.40.0 不符，返回 `MODEL_DEPLOYMENT_MISMATCH`。用户随后明确授权接受微小版本不符，本次按实测 0.40.3 固定新服务/部署引用，权重摘要、维度和网关预算保持不变。重跑三能力 smoke 已通过，旧失败记录保留。
2. 用户随后要求生成策略。十六类策略目录现已生成并通过原 Schema、交叉引用及数据集绑定校验；实际 API 工厂成功装配五类任务，独立 API/Worker 已启动。技术配置授权不替代正式业务发布，草案的实际风险/规范/预测/校准来源仍须补齐。
3. 本次 Qdrant 与受信任 HTTPS 已启动；物理 Chrome 的真实登录接口返回 200，选择工程后读取到工程修订和实际投影结果。使用独立短期 CA，未复用 OpenClaw 证书，也未重启系统 Caddy。正式资料/业务配置发布、检索质量、Electron 全部场景及后台终态仍未完成。

## 受控证据及续接

本次实例与原始证据目录为 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`，目录限属主访问；秘密为同 uid 的 0600 普通文件。秘密、Cookie 和会话 token 不写入此记录。该目录内包含：

- `workspace-identity.json`、`display-evidence.json`、`chrome-physical-window.png`；
- `initialization.json`、`provision-project-report.json`、`project-directory.json`；
- `network-model-smoke.log`、`model-preflight.json`；
- `model-change-proposal.json` 和 `model-gateway-0.40.3-proposed.json`：仅待审，未作为获批准运行输入；
- `deployment-preparation.json`、`deployment-bootstrap.json`、`release-preparation.json`：实例准备输入；其中业务策略/来源绑定尚未解析，不可直接启动完整 API/Worker。

续接时保留新旧数据库与身份，先解决版本批准和实际运行策略；再按 readiness.md 执行正式资料登记、发布、检索、业务终态与桌面场景。当前 14 项 task 仍为 1/14；初始化或开窗不替代任何完整功能义务。

本次隔离 PostgreSQL 保留运行；可用 `docker stop riskflow-physical-pg-20261014` 停止，重启保留原卷与身份。Chrome 仅作为此次可见验收窗口保留。
