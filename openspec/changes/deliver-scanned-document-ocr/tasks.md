## 1. 接口前置与验收资料

- [ ] 1.1 在任何生产代码修改前，确认 C12 `deliver-structured-document-conversion` 已归档，并对账其统一转换 interface、规范化页/块/表格 DTO、闭合错误、质量策略、幂等收口和 adapter 出口。只从 C12 的已归档公开出口导入；若字段语义、所有权或出口与本设计冲突，停止 C13 实现并升级主调度，禁止修改 `packages/contracts/**`、`packages/core/**` 或复制临时 Schema。验证：`openspec list --specs`、`pnpm typecheck`。
- [ ] 1.2 在 `packages/adapters/test/engineering-data/document-conversion/ocr/fixtures/` 增加最小中文扫描 PDF、PNG、JPEG 与 `acceptance-manifest.v1.json`，清单固定媒体类型、页数、关键字段 identity、规范化期望值和页/区域定位；无甲方脱敏资料时明确标注合成样例、待甲方复核。不要把 OCR 输出快照当输入事实，也不要精确断言整页文案。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr --passWithNoTests=false`。

## 2. OCR 私有协议与配置

- [ ] 2.1 新增 `packages/adapters/src/engineering-data/document-conversion/ocr/schema.ts`，仅定义 PaddleX 请求/响应的 adapter 私有 Zod Schema、闭合错误码、版本/资源追踪与坐标/表格无损映射；业务输出必须复用 C12 DTO，不导出 PaddleX 响应。未知版面类别只按 C12 闭合类别处理，不做字符串猜测或内容修复。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts`。
- [ ] 2.2 新增 `packages/adapters/src/engineering-data/document-conversion/ocr/config.ts`，解析并深冻结部署、服务、管线、模型集合、资源、端点、协议和输入/响应/页数/并发/超时上限；拒绝业务输入 URL、路径、设备或模型参数，端点只允许无用户信息、query、fragment 的内网 origin。复用仓库现有配置与 URL 校验模式，不新增依赖。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t config`。

## 3. 扫描转换 adapter

- [ ] 3.1 新增 `packages/adapters/src/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.ts` 实现 C12 扫描分支：在网络前复验 C06 工程/空间/正文授权，经 C04 受权读取并校验原始内容工件，只接受扫描 PDF、PNG、JPEG，在冻结字节上限内编码 Base64，以 Node.js 原生 `fetch` 调用固定 `POST /layout-parsing`，组合业务取消、deadline 和实例超时。禁止安装客户端依赖、启动服务、跟随重定向或自动切换模型/端点。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t request`。
- [ ] 3.2 对有界响应先写入 C04 `diagnostic` 工件，再从该受权工件重读、解析并规范化页码、页面尺寸、版面类别、阅读顺序、坐标和表格单元格；通过 C12 唯一收口逻辑生成规范化结果并保存 `content` 工件，两个工件耐久成立后才返回成功。禁止在 C13 组装第二套 JSON-LD、语义分块、相邻指针或调用 C11 私有实现。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t 'artifact|page|table'`。
- [ ] 3.3 输出 OCR 专属结构/置信度指标供 C12 版本化质量策略确定性判定，覆盖页面完整性、非空页、有效坐标、阅读顺序、表格单元格和验收清单关键字段；失败保留原始响应与候选诊断引用，但不发布结果或登记资料段。重试和同键重放完全服从 C12 已有幂等/预算语义，不在 adapter 新建存储或调度层。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t 'quality|idempotency|retry'`。
- [ ] 3.4 新增 `packages/adapters/src/engineering-data/document-conversion/ocr/index.ts`，并只在 C12 既有 `packages/adapters/src/engineering-data/document-conversion/index.ts` 汇总生产实现；现有 package export 已覆盖时不改 manifest。验证：`pnpm typecheck`、`pnpm deps:check`、`pnpm deps:policy`。

## 4. 确定性契约与隔离测试

- [ ] 4.1 新增测试目录内的本地 HTTP 协议替身和 `paddle-ocr-document-converter.test.ts`，用表格驱动的代表性用例覆盖请求映射、不可枚举授权拒绝、媒体/预算边界、页/坐标/阅读顺序/表格校验、质量阻断、服务错误、超时、取消、断流、限流、工件失败和同键异载荷冲突。只断言稳定结构、错误码和关键语义，不锁定完整错误文案或服务私有字段顺序；替身不得由生产包导出。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts`。
- [ ] 4.2 在同一测试进程分别实例化 OCR 与 C05 llama.cpp 协议替身，令 OCR 达到并发上限、取消、超时和崩溃，验证 llama.cpp 只受自身部署、并发、取消与预算状态影响；不得创建跨服务全局 semaphore 或共享 AbortController。验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t isolation`。

## 5. 真实服务 smoke 与质量门

- [ ] 5.1 新增 `paddle-ocr-document-converter.smoke.test.ts`，仅在 `RISKFLOW_OCR_SMOKE=1` 时读取操作者提供的冻结 smoke 配置并通过同一生产 adapter 处理三类样例；不下载模型、不启动/停止服务、不回退替身。显式启用但缺少配置、样例、服务或版本/资源证据时必须失败；报告只保存版本/资源引用、质量指标和工件引用，不输出正文与宿主路径。验证：`RISKFLOW_OCR_SMOKE=1 RISKFLOW_OCR_SMOKE_CONFIG=<受控配置路径> pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.smoke.test.ts`。
- [ ] 5.2 运行 C13 最小交付门并修复本 change 引入的问题：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy`、`pnpm openspec:validate`。真实 smoke 结果单独记录，未具备预置服务时不得以默认测试替代。
- [ ] 5.3 以 `git diff --name-only 0f5b886...HEAD` 和工作区 diff 核对文件所有权：生产修改只允许 C12 既有 adapter 边界下的 OCR 目录与单一出口，测试只允许对应 OCR 目录；不得修改 contracts/core/apps、数据库、根 manifest、lockfile、主 specs、归档或其它活动 change。随后使用 `openspec-verify-change` 核验 proposal、design、delta spec、tasks 与实现/证据一致；发现 C12 接缝或 C37 资源证据缺口时如实阻断，不扩大 C13 范围。
