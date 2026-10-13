## Why

完整业务界面、网络模型适配、部署程序和 API/Worker 接线已实现，需要独立核验并保留为可归档的工程成果。将未完成的实现和真实功能取证交给后续 change，避免代码实现与现场验收相互混淆。

## What Changes

- C32–C35 完整界面与 C36 质量页统一归入 `apps/web`，复用唯一会话、HTTP/SSE、路由与确认；保留七成员 workspace 和薄 Electron HTTPS 客户端。
- 实现部署配置、受限秘密、显式初始化、最小权限、不可变策略目录、精确来源窄读、mTLS 工件流、发布校验、维护窗口、逻辑副本、隔离恢复和人工回退程序。
- 完成三图、五类共享 Agent 定义、完整 API ports、独立 Agent/Outbox Worker 和显式启动/关闭。可启动宿主限定为 `synthetic-acceptance` 合置本地 C04；完整跨 VM 宿主尚未开放。
- 同一模型 port 支持 `openai-chat` 结构化生成/会话流和 `ollama-embed` Embedding，保留 llama.cpp；当前授权、硬预算、身份、响应工件和失败边界沿原契约。
- 实现评分配置包互斥来源与正式治理、所属模块检查点只读证明、真实 A0 入口、正式工作计划读取、A3/A4 偏差登记时序和精确因果事件消费。
- 实现受控资料预置、正式只读终态观察与安全报告程序。程序回归及已执行网络 adapter smoke 属本 change；完整真实业务运行报告由后续 change 取证。
- 剩余来源补证、Electron 场景、真实业务/可见浏览器验收和最终功能收口移入 `complete-private-deployment-functional-acceptance`。C38 F-01–F-05 保留为未来移交，未计通过。

## Capabilities

### New Capabilities

- `platform/offline-private-deployment-and-operations`：已实现的配置、初始化、组合、工件流与运维程序。
- `platform/electron-https-client`：共享 Web 的安全桌面入口与连接行为。

### Modified Capabilities

- `platform/llamacpp-model-gateway`：冻结协议的网络后端及分层 smoke。
- `platform/engineering-baseline`：七成员 workspace、构建与依赖边界。
- `platform/web-shell-interaction-primitives`：工程/系统管理统一确认和冻结命令身份。
- `web/engineering-and-knowledge-ui`、`web/identification-and-review-ui`、`web/assessment-warning-and-response-ui`、`web/agent-audit-and-operations-ui`：页面及既有真实 HTTP/PostgreSQL 浏览器 harness 迁入 Web。
- `knowledge/structured-scoring-rules-and-applicable-rule-sets`：配置包来源互斥、确定性校验与人工发布。
- `domain/module-interfaces-events-workflows`：正式计划窄读、校准引用时序与耐久消费。

## Impact

- **基线**：保留 IP-01–IP-16 及原施工基线。当前 HEAD 为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`，累计实现仍未全部提交；verification 不把此 HEAD 当作含工作区实现的检查点。
- **本轮所有权**：只拆分工件及同步验收说明；保留全部源代码与已有 dirty 改动，不提交、归档、修改执行图或启动服务。保留任务只承载已实现工程工作。
- **依赖与复用**：C03–C36 公共模块、原 Node fetch/Zod 与已有精确锁定依赖；本次拆分不新增依赖。模型候选继续确定性收口，P/C、矩阵、阈值与人工决定不变。
- **后续**：新 change 依赖本工程成果及有资格的 MinerU 新转换版本。固定实现检查点、必要审计和主仓库门禁仍是正式归档/集成要求。
- **范围外**：完整真实业务及 Electron 功能取证、正式跨 VM host、签名/三平台安装、禁网/本地介质/4090 实测、HA/PITR、灾备、RPO/RTO/SLA、LoRA、移动端与本机业务后端。
