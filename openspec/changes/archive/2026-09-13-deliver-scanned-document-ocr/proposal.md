## Why

RiskFlow 已能登记受权限保护的原始资料版本与资料段身份，但扫描 PDF、PNG、JPEG 尚不能形成保留页码、版面和表格坐标的可追溯转换结果。C13 补齐 RI-S21 的 OCR 通路，使中文扫描资料能够经独立内网服务转换、校验并按 C11 身份与权限边界落位，而不会占用或耦合 llama.cpp 推理服务。

## What Changes

- 新增扫描文档 OCR adapter：只接受已登记且可访问的扫描 PDF、PNG、JPEG 内容工件，通过固定协议调用独立内网 OCR/版面服务，并把原始响应和规范化结果先保存为 C04 不可变工件。
- 以已归档 C12 唯一拥有的统一文档转换 interface 为消费契约，在其 adapter 内增加最小的 OCR parser→既有 finalizer 私有接缝；OCR 只产出 C12 结构化块和额外工件血缘，授权、原始资料读取、JSON-LD/≤512 字符分块、工件写入、资料段登记、审计、事务和幂等仍由 C12 单一路径收口。
- 为满足扫描结果保留页面尺寸与文本置信度的既有 Scenario，仅在 C12 core DTO 增加向后兼容的可选 `pageExtents` 与 `confidence` 并由既有转换函数透传；不修改 `packages/contracts/**` 公共端口、记录联合或持久化 Schema，也不以伪造正文承载页面信息。
- 固定 OCR 部署、服务构建、管线/模型版本与资源配置引用；调用时核对冻结部署引用与受控协议，C13 提供 fail-closed 的真实 smoke 入口，C37 在预置环境形成服务身份、三媒体实测与资源隔离证据；调用结果保存精确版本、资源分配和处理计数，业务代码不硬编码 URL 或模型名。
- 增加确定性质量门：中文扫描样例必须达到版本化的关键字段命中门槛，页码、版面、阅读顺序和表格单元格定位必须可核对；低质量结果、缺页、非法坐标、协议错误、超时和资源不可用均结构化失败，不返回空成功。
- 增加资源隔离验证：OCR 服务与 llama.cpp 使用不同部署引用、端点和显式资源配额；并发压力下任一服务故障或配额耗尽不得改变另一服务的部署状态或请求预算。
- 增加测试专用协议替身和显式启用的真实 OCR smoke；测试不下载模型、不启动服务，也不把替身当作真实 OCR 验收。

## Capabilities

### New Capabilities

- `data/scanned-document-ocr`: 规定扫描 PDF/PNG/JPEG 的受权读取、独立 OCR/版面服务调用、版本与资源追溯、统一转换接口接缝、结构质量门、失败语义和资源隔离验收。

### Modified Capabilities

无。

## Impact

- **依赖**：路线图直接依赖已归档 C02、C11、C12，并复用其已归档上游 C04、C05、C06 的内容工件、模型部署与授权能力；固定实现范围基线 `e0c928105de371668f7619145eb87a2272854b12` 已包含 C12 的 `ocr-layout` 公共输入、规范化 DTO、JSON-LD/分块、C11 登记、审计与幂等实现。
- **代码所有权**：新增 `packages/adapters/src/engineering-data/document-conversion/ocr/**` 与对应 adapter 测试/真实 smoke；允许对 `structured-document-converter.ts` 及其既有 adapter 测试做最小内部接缝重构，并按协调裁决对 core 文档转换 Schema、转换函数及其既有测试增加可选页面范围/置信度透传。`packages/contracts/**`、C11 实现、`apps/**`、数据库 migration、manifest、依赖政策和 lockfile 继续保护。
- **外部系统**：目标服务基线为预置内网 PaddleOCR/PaddleX 3.7.0 `PP-StructureV3` 管线（Apache-2.0）；服务构建、模型制品、容器与设备配额由部署配置以精确引用提供，C37 冻结离线制品、SBOM、许可证和目标硬件参数。
- **依赖治理**：生产 TypeScript 侧复用 Node.js 24 原生 `fetch`、流和 `AbortSignal`，不新增 npm 依赖、不修改 lockfile。C13 不安装或管理 Python/Paddle 运行时；服务版本或许可证不满足部署政策时停止实现并交回依赖门处理。
- **专利追踪**：本 change 覆盖 RI-S21 的 OCR 扫描与结构保留，并为 RI-S22/RI-S23 提供可追溯转换输入和失败证据；JSON-LD 组装、≤512 字符语义分块及最终合规收口继续复用 C12 单一实现，C13 不复制。
