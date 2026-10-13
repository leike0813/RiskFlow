## Why

前置 change 已实现大部分部署、业务宿主与验收程序，但正式来源补证、完整 Electron 场景和真实业务报告尚未完成。将这些剩余义务独立规划，以完整终态证据判断功能是否可交付。

## What Changes

- 承接原 4.3、5.1–5.3、13.1、14.1–14.2、16.1–16.3 的剩余义务，逐项映射见 handoff.md；复用已有宿主、reader、模型 adapter 和报告程序。
- 补证正式 C19 发布成员、C24 路线、C30 精确空间来源；范围内缺陷使用既有所属模块接缝修复，不接入第二套来源。
- 在隔离 synthetic-acceptance 合置实例准备真实配置、同发布清单、权限和资料，运行显式 API/Worker 与同源 HTTPS。资料转换依赖 MinerU 独立 change 的合格新版本。
- 补齐当前平台 Electron 的共享对象、登录、上传下载、撤权、证书拒绝、导航、SSE 重连及关闭窗口后任务继续场景。
- 运行识别、复核、评估、预警、处置/人工决定、执行反馈，以及会话流、拒权、重投、重启和适用恢复核验；由正式只读终态和可见外部 Chrome 留证。
- 形成安全报告、双向追踪、工程验证、固定实现检查点与限定审计，由 Finalizer 生成 verification。C38 F-01–F-05 保持未来移交。

## Capabilities

### New Capabilities

无新增能力目录，复用前置 change 的平台能力。

### Modified Capabilities

- `platform/offline-private-deployment-and-operations`：添加从原 change 移入的阶段收口、真实功能取证、生产来源与报告覆盖义务。
- `platform/electron-https-client`：添加从原 change 移入的完整桌面功能取证与正式多平台分阶段要求。

两目录由 `deliver-offline-private-deployment-and-operations` 创建，尚未同步主规格。本 delta 使用 ADDED Requirements；先归档/同步前置成果再同步本 change，不替换不存在的主规格 Requirement。

## Impact

- **依赖**：前置 change 工件及实现、C03–C36 已归档规格、adopt-mineru-document-ingestion 的真实转换。评分规则走配置包分支，不创建 C19 第二个 knowledge-authoring 定义。
- **所有权**：仅补当前功能验收及已批准范围内缺陷，按 IP-17–IP-22 施工图。完整跨 VM host、签名/原生平台安装、禁网和硬件证据移交 C38；不开放远程正文证明协议。
- **公共契约**：复用 strict Schema、C06/C04、HTTP/SSE、Outbox、检查点、预算及人工确认，不新增业务字段、迁移、依赖或 pnpm 别名。
- **RI/RA**：覆盖 RI-S1–RI-S6、RA-S1–RA-S7 和完整追溯；合成样本明确待甲方复核，不宣称甲方验收或真实工程准确率。
- **当前操作**：只完成 apply-ready 规划和交接，不修改执行图/Orca、不启动服务、不实施、提交或归档。规划基线固定为 `b6e39eb41e9cc8b0c9840f6f58057155eb37de54`；已有 dirty 实现作为显式前置叠加层登记，角色交接前须形成真实 Git 检查点。
