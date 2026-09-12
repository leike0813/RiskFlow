# Implementation Plan

## 1. 实施基线与权威来源

- **固定 base commit**：`290bc39616d5f6021cd1585305c815b14e866297`。开始实现和最终核验都以该提交到实现 HEAD 的 diff 为准；不得把其它 change 或工作区改动并入 C13。
- **行为事实源**：本 change 的 `specs/data/scanned-document-ocr/spec.md`，行为不增不减；proposal 说明范围，design 的 D-01～D-12 固定实现决定。
- **上游事实源**：C02 公共命令/闭合结果与授权边界、C04 `ArtifactStoreV1` 和不可变工件、C05 llama.cpp 独立实例模式、C11 `EngineeringContextSourceRegistryV1`、C12 `StructuredDocumentConversionPortV1` 与当前实现。
- **代码事实源**：`packages/contracts/src/ports/index.ts` 已声明 `ocr-layout`；`StructuredDocumentConversionAdapter.convert` 已拥有授权、原始内容读取、幂等、最终工件、资料段、事务和审计收口；`parseStructuredDocument` 的 `OCR_DELEGATED_TO_C13` 是唯一待替换的 OCR 分派点。
- **协调裁决**：C13 可在同一 change 内最小重构 C12 adapter 私有接缝；诊断链不能替代页面尺寸/文本置信度，伪造正文也不可接受，故允许 core DTO 增加向后兼容的可选 `pageExtents`/`confidence` 并透传。不修改 `packages/contracts/**` 或 migration。

保护范围：`packages/contracts/**`、`apps/**`、C11 实现、数据库 migrations、根/包 manifest、依赖政策、`pnpm-lock.yaml`、`openspec/config.yaml`、主 specs、归档 change 和其它活动 change。若实现需要修改任一保护项，或需要给成功记录增加 raw diagnostic 字段，立即停止并升级；不得用字符串字段、`unknown` metadata 或数据库旁路规避。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
| --- | --- | --- | --- |
| IP-01 | `packages/contracts/src/ports/index.ts` 的 `StructuredDocumentConversionCommandV1Schema`、`StructuredDocumentConversionPortV1`、`StructuredDocumentConversionRecordV1Schema` | 实现前对账 `ocr-layout`、版本引用、授权、成功/失败和成功记录不可带 diagnostic 的闭合约束；只读，不修改 | 不建第二个 port、命令、结果联合或成功记录字段 |
| IP-02 | `packages/core/src/engineering-data/document-conversion/schema.ts` 的 `ParsedDocumentV1Schema`、`NormalizedBlockV1Schema`、`TextBlockV1Schema`、`NormalizedDocumentV1Schema`、`StructuredDocumentJsonLdV1Schema`；`service.ts` 的 `chunkNormalizedBlocks`、`convertParsedDocument` | 增加可选 `DocumentPageExtentV1/pageExtents` 及 `[0,1]` `confidence`；页面范围原样进入 normalized/JSON-LD，置信度从来源 block 透传到每个文本片段 | 不增加 OCR engine/质量策略、伪造 page-break 正文或新转换算法 |
| IP-03 | 现有 adapter fixture 组织方式与 C13 delta 验收清单 | 增加最小合成 PDF/PNG/JPEG 和机器可读清单；只固定页数、字段 identity、规范化值和定位 | 不提交 OCR 输出快照、甲方敏感正文或整页精确文案断言 |
| IP-04 | `packages/adapters/src/model/config.ts` 的 `URL` origin 校验、strict Zod、deep-freeze 模式 | 在 OCR 私有 `config.ts`/`schema.ts` 复用模式，冻结部署/服务/管线/模型/资源/质量/重试/容量引用 | 不导入 C05 deployment map、probe cache、模型预算或 Paddle 类型到 core/contracts |
| IP-05 | `StructuredDocumentConversionAdapter.convert`、`#readInput`；Node 24 `fetch`、`AbortSignal.any`、`AbortController`、`Buffer` | 具体类增加可选 `control` 参数但继续满足公共单参数 port；C12 完成授权、幂等和原始读取后，仅对 `ocr-layout` 调用注入 parser，parser 负责独立 semaphore、受控请求、有界响应和取消原因 | 不在 OCR 模块再次读取原始资料、复验 C11 私有存储、启动服务或引入客户端依赖 |
| IP-06 | `artifactCommand`、`ArtifactStoreV1.put/open`、`convertParsedDocument`、`toEvidenceReferences`、`toSourceSegments`、`#persist`、`#finishFailure` | C12 提供绑定当前 command/source 的 raw diagnostic 写入并校验重读闭包；`artifactCommand` parent 最小放宽为既有 `ArtifactRefV1` 并接受不同工件槽位；抽出唯一 `#finalizeParsedDocument`，合并额外 parents/evidence/failure context | 不在 C13 复制 JSON-LD、≤512 分块、前后指针、C11 `registerSegments`、记录/审计/事务/幂等 |
| IP-07 | C12 `ParsedDocumentV1`、page/table/cell coordinate、`DocumentParserError` 失败收口 | Paddle 私有响应确定性映射为已有 block；在返回 finalizer 前执行结构、置信度、页面和关键字段质量门，错误只穿透闭合安全字段 | 不猜测未知标签、补造页/单元格、模糊修复文本或返回空成功 |
| IP-08 | `packages/adapters/src/engineering-data/document-conversion/index.ts` 与现有 package subpath export | 只从既有文档转换 subpath 汇总 OCR composition/factory；package manifest 已覆盖，不修改 | 不新增顶层包、manifest subpath 或应用装配 |
| IP-09 | `packages/adapters/test/engineering-data/document-conversion.test.ts`、C12 PostgreSQL 测试、C04 测试替身 | 扩展既有 adapter 测试固定 parser→finalizer、parents/evidence/failure 穿透；新 OCR 测试用本地 HTTP 替身覆盖私有协议 | 不复制一套 C12 PostgreSQL/事务测试，不把实现顺序或全文案写死 |
| IP-10 | `LlamaCppModelGateway` 的实例状态和现有测试 fixture | 同一进程独立实例化 OCR parser 与 llama.cpp gateway，观察互不共享并发、控制器、部署和预算 | 不创建跨服务全局 semaphore、共享 signal 或假冒物理 GPU 隔离证据 |
| IP-11 | Vitest 环境门控 smoke 模式 | `RISKFLOW_OCR_SMOKE=1` 时读取操作者冻结配置并调用同一生产 parser/adapter；缺证据显式失败 | 不下载模型、启停服务、回退替身或记录正文/宿主路径 |
| IP-12 | 根 scripts、OpenSpec CLI、git diff | 运行最小测试、全仓静态门、严格 OpenSpec 和文件范围核验 | 不提交、归档、安装依赖或修改规划外文件 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
| --- | --- | --- | --- | --- | --- |
| IP-01 | 1.1 | 统一入口：全部 Scenario；幂等重放/冲突 | 只读 `packages/contracts/src/ports/index.ts`、C02/C11/C12 specs/归档工件；当前调用方 | 在 base 上确认契约与调用路径；记录不存在第二个生产调用方/装配旁路 | 公共 Schema、端口、数据库 |
| IP-02 | 3.2 | OCR 结构：中文扫描 PDF 保留页面与版面；质量门：中文样例通过 | `packages/core/src/engineering-data/document-conversion/schema.ts::{DocumentPageExtentV1Schema,ParsedDocumentV1Schema,NormalizedBlockV1Schema,TextBlockV1Schema,NormalizedDocumentV1Schema,StructuredDocumentJsonLdV1Schema}`；`service.ts::{chunkNormalizedBlocks,convertParsedDocument}`；对应 core test | 增加可选、按页升序唯一的 `pageExtents` 和可选 `confidence`；测试 JSON-LD 透传、分块保留、重复/乱序页及越界置信度拒绝 | 既有必填字段、未提供新字段的结果、分块 identity/顺序 |
| IP-03 | 1.2 | OCR 结构：PDF/表格；质量门：两 Scenario；真实服务：两 Scenario | 新增 `packages/adapters/test/engineering-data/document-conversion/ocr/fixture.ts` 与 `fixtures/*` | 生成最小合成三媒体样例和版本化验收清单，标记待甲方复核 | 生产代码、外部下载、敏感资料 |
| IP-04 | 2.1、2.2 | 版本追溯：两 Scenario；失败一致性：可重试失败；资源隔离：两 Scenario | 新增 `ocr/schema.ts`、`ocr/config.ts` | strict 私有请求/响应/trace/error/quality Schema；冻结 URL、版本、资源、输入响应页数、并发队列、超时、重试次数与延迟 | 业务命令来源的 URL/模型/设备，npm 依赖 |
| IP-05 | 3.1 | 统一入口：三 Scenario；资源隔离：单个取消；失败一致性：可重试服务失败 | 新增 `ocr/paddle-ocr-document-converter.ts::{createPaddleOcrLayoutParser,requestLayout}`；修改 `structured-document-converter.ts::{StructuredDocumentConversionAdapterOptionsV1,convert}` | 增加仅 `ocr-layout` 可用的 parser 注入和具体类可选 `control`；使用已验证 bytes、固定 endpoint、Base64、独立 semaphore 和 caller/deadline/timeout 组合信号；内部耗尽冻结重试预算后才交 finalizer 失败 | C12 前置顺序、其它 parser、公共单参数 port 契约 |
| IP-06 | 3.2 | 工件耐久：两 Scenario；OCR 结构：非法结构拒绝；统一入口：获授权；幂等：成功重放/冲突 | 修改 `structured-document-converter.ts::{artifactCommand,convert,#finishFailure}`，新增私有 raw persist/read 与 finalizer 方法；扩展既有 adapter test | raw 响应由 C12 闭包先 put/open/verified；finalizer 合并 raw parent 与额外 evidence，继续唯一 JSON-LD/segments/persist；失败穿透已成立 parents/evidence 与安全细节 | C11 方法、记录表、成功结果联合、事务/审计/idempotency key 语义 |
| IP-07 | 3.2、3.3 | OCR 结构：全部；版本追溯：全部；质量门：全部；失败一致性：可重试失败 | `ocr/schema.ts`、`ocr/paddle-ocr-document-converter.ts::{parsePaddleLayoutResponse,normalizeLayout,evaluateOcrQuality}` | 从 raw 重读字节解析；建立 page-break/page block、稳定顺序、table/cell、confidence；输出版本/计数/质量 trace；非法协议/结构/质量抛闭合错误 | 原文、数值、未知标签、低质候选不得修复或发布 |
| IP-08 | 3.4 | 统一入口：非扫描输入；默认测试无外服 | 新增 `ocr/index.ts`；修改文档转换 `index.ts` | 汇总 config/schema/parser factory，由现有 package subpath 导出 | package.json、第二个公共服务入口 |
| IP-09 | 4.1 | 除资源隔离与真实 smoke 外的全部确定性 Scenario | 新增 `ocr/paddle-ocr-document-converter.test.ts`；修改既有 `document-conversion.test.ts` | 本地 HTTP 替身和表格驱动边界；断言服务调用次数、稳定错误码、工件血缘、未登记部分 segments、同键行为和非 OCR 回归 | 全错误文案、响应字段顺序、实现私有调用顺序 |
| IP-10 | 4.2 | 资源隔离：两 Scenario | 新 OCR adapter test；复用 C05 test fixture/生产 gateway | 并发饱和、取消、超时、断连时并行 llama.cpp 请求仍按自身状态完成/失败，并核对 deployment/resource refs 不同 | C05 生产代码、物理配额结论 |
| IP-11 | 5.1 | 协议替身与真实服务：显式 smoke；版本追溯：部署身份拒绝 | 新增 `ocr/paddle-ocr-document-converter.smoke.test.ts` | 显式门控、冻结配置、三样例、同一生产 adapter；缺服务/版本/资源证据即失败，报告仅引用与指标 | 默认测试联网、服务生命周期、正文/路径输出 |
| IP-12 | 5.2、5.3 | 全部 Requirement/Scenario | 所有列明文件与仓库验证入口 | 运行定向/全仓验证，按 base 和工作区核对范围，使用 verify skill 复核实现证据 | 提交、归档、扩大范围、用默认测试代替真实 smoke |

## 4. 调用与副作用顺序

1. **契约与配置前检（IP-01/IP-04）**：构造时 strict 解析并深冻结 OCR deployment、quality、retry 和 resource 配置；`convert` 先校验 command、转换/质量/部署精确引用。失败无网络、工件或数据库副作用。
2. **授权与幂等（IP-05/IP-06）**：保持 C12 顺序调用 C11 `resolveSourceProcessingInput`、核对 source refs、执行 `#readExisting`。未授权/不存在统一闭合且不接触 OCR；同键同载荷成功或失败记录直接重放，同键异载荷冲突。
3. **原始输入读取（IP-05）**：C12 `#readInput` 以当前授权打开原始 content 工件，有界读取并等待 `verified`；media/ref 不符或超限均在网络前失败。
4. **OCR 调用（IP-05）**：仅 `ocr-layout` 获取当前 parser 实例的 semaphore；达到冻结队列/并发上限即闭合拒绝。组合 caller signal、command deadline 与实例 timeout，固定 `POST /layout-parsing`、`redirect: "error"`、Base64 参数；只对配置列明的可重试服务原因，在同一输入/部署/策略/资源/deadline 内执行至多 `maxAttempts`。
5. **raw 工件先耐久（IP-06）**：每个收到的 HTTP 响应（含可重试服务错误）在 `maxResponseBytes` 内读完，立刻调用 C12 `persistRawResponse`；C12 按 attempt 写 diagnostic envelope，parent 为原始 content，继承授权，再 open/有界读/`verified`。只有重读后才检查协议/服务错误并决定是否重试；put/open/hash/权限失败阻断后续解析，已成立 raw 工件不回滚。
6. **协议、规范化与质量（IP-07）**：只解析重读 bytes；校验服务错误、页面完整性、有限坐标、顺序、table/cell、confidence 和版本化质量门。失败附 raw parent、可成立的 segment evidence 与白名单 trace 进入 C12 `#finishFailure`，不调用 finalizer、不登记 segments。
7. **唯一 finalizer（IP-02/IP-06）**：C12 用 `convertParsedDocument` 完成页面范围/置信度透传、≤512 分块/指针/JSON-LD/合规；写 content 工件时 parents=`[source content, ...本次调用已成立 raw diagnostics]`，evidence=派生 segments 与 parser extras 的排序去重并集。然后且仅然后调用 C11 `registerSegments`。
8. **记录、审计与返回（IP-06）**：segments 成功后用既有 `#persist`/C03 transaction 原子写 conversion record、command receipt 和 audit；提交成功才返回公共成功联合。中途失败由 `#finishFailure` 写最终 diagnostic 并按既有事务收口；成功记录仍只引用 JSON-LD/segment set，raw ref 从 JSON-LD parent 链到达。
9. **重放与孤儿（IP-06/IP-09）**：成功重放不 fetch、不 put、不 register；内部重试预算耗尽后失败记录固定，后续同键重放不换版本或放宽质量门。任何“工件已成立、后续步骤失败”仅留下 C04 可回收孤儿，不删除、不覆盖。

## 5. Schema、状态与持久化落实

- **输入与输出**：公共 command/result/record 零变化。`ocrLayoutParser` 是具体 adapter option 的同包内部 seam；具体类 `convert(request, control?)` 的额外参数不进入公共 port，`AbortSignal` 只存在于调用栈且不序列化。
- **页面范围与置信度**：`DocumentPageExtentV1` 固定一基页码、有限正 `width/height`、`pixel-top-left`，`pageExtents` 可选但一旦提供必须按页升序且唯一；OCR 必须覆盖全部输入页。core `confidence?: number` 为有限 `[0,1]`，OCR 文本区域设置，无服务文本置信度时省略。两者进入 JSON-LD；旧结果没有这些字段仍有效。
- **OCR 配置**：deployment/service/pipeline/model/resource/quality/retry refs 与预算均 strict、不可变；command 的 deployment/quality refs 必须精确匹配。配置 URL 只能是 origin，业务输入不能覆盖。
- **raw diagnostic**：identity=`ocr-raw-response-<conversionId>-attempt-<n>`，command/idempotency 后缀=`:ocr-raw:<n>`，与最终 `:diagnostic` 分离；body envelope 保存固定请求身份、版本 refs、资源 ref、字节/HTTP/计数和原始响应，不记录宿主路径。manifest parent 指向原始 content，权限继承当前 command。
- **parser outcome**：只含 `ParsedDocumentV1`、额外 `ArtifactRefV1[]` parents、`EvidenceReference[]` 和闭合安全 diagnostic trace；所有集合进入 C04 现有规范化/去重函数。
- **失败**：parser error 仅输出 D-09 code/retryable/stage、可选 locator、版本/计数/quality；C12 最终 diagnostic 是公共错误唯一直接引用，raw 通过 parent 穿透。响应正文/服务消息/堆栈不进日志或公共结果。
- **事务**：不新增表/列。raw/JSON-LD 是 C04 独立耐久副作用；segment set 由 C11；conversion record、receipt、audit 继续由 C12 `#persist` 的 C03 transaction 完成。checkpoint 不参与本 adapter。
- **幂等与版本**：C12 command hash 与 key 继续唯一；raw/content/segments 使用由同一 conversion/idempotency 派生的稳定 key。内部 retry 不改变输入或版本引用；不同 OCR 版本必须是不同 command payload/转换身份。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
| --- | --- | --- | --- | --- | --- |
| 扫描资料只经受权的统一转换入口处理 / 获授权扫描资料进入 OCR | IP-01、IP-05、IP-06 | `paddle-ocr-document-converter.test.ts`、既有 `document-conversion.test.ts` | 已登记 source、匹配授权与 OCR parser | C11/C04 前置后才 fetch；结果 refs 保持一致 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts` |
| 同 Requirement / 未授权与不存在不可枚举 | IP-05、IP-09 | OCR adapter test | 缺 grant、错 project、缺 source/artifact 表驱动 | 同一授权拒绝；fetch=0；无正文/页数泄露 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t authorization` |
| 同 Requirement / 非扫描输入不被错误接管 | IP-05、IP-08、IP-09 | 既有/新 adapter test | DOCX、text-pdf、XLSX、CSV、非法 media | OCR parser 调用=0；既有 parser 行为不变 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion.test.ts` |
| OCR 结果保留页码版面阅读顺序与表格坐标 / 中文扫描 PDF 保留页面与版面 | IP-02、IP-03、IP-07、IP-09 | core test、OCR adapter test | 多页中文 fixture/响应 | `pageExtents`、类别、sequence、confidence、coordinate 稳定；无伪造正文；重放相同 | `pnpm exec vitest run packages/core/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t 'page|confidence'` |
| 同 Requirement / 表格单元格可以回到原页 | IP-03、IP-07、IP-09 | OCR adapter test | 跨行/列 table fixture | page/table/row/column/span/text 与 C11 segment locator 可追溯 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t table` |
| 同 Requirement / 非法结构整体拒绝 | IP-06、IP-07、IP-09 | OCR adapter test | 缺页、重复页/顺序、NaN/越界、cell 越界 | 闭合输出失败；raw/final diagnostic 成立；registerSegments=0、无空成功 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t structure` |
| 服务模型管线与资源版本完整可追溯 / 精确部署生成可重放结果 | IP-04、IP-06、IP-07、IP-09 | OCR adapter test | 冻结 config + 成功响应 | raw envelope/final lineage 含精确 refs 与计数；不同版本可区分 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t trace` |
| 同 Requirement / 部署身份无法由冻结证据证明时拒绝调用结果 | IP-04、IP-07、IP-11 | OCR adapter/smoke test | command/config ref mismatch 或 smoke 缺证据 | 网络前或结果发布前 `OCR_DEPLOYMENT_MISMATCH`；无回退 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t deployment` |
| 原始响应和规范化结果先耐久后成立 / 成功结果具有完整工件链 | IP-06、IP-09 | 既有/新 adapter test | 记录 put/open/verified/register/persist 的 C04/C11 fake | 成功仅在两工件、segments、record/audit 后；JSON-LD parents 含 source+raw | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t artifact` |
| 同 Requirement / 工件持久化失败不返回成功 | IP-06、IP-09 | OCR adapter test | raw put/open/hash 与 JSON-LD put 分别失败 | 结构化失败；对应阶段后续副作用=0；已成立工件不回滚 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t artifact` |
| 版本化质量门拒绝空成功和有害结构 / 中文样例达到全部质量门 | IP-02、IP-03、IP-04、IP-07、IP-09 | core/OCR adapter test | acceptance manifest + 通过响应 | 每项值/阈值/版本/locator；confidence 进入 JSON-LD；允许 finalizer | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t quality` |
| 同 Requirement / 关键字段或页面覆盖不足 | IP-03、IP-06、IP-07、IP-09 | OCR adapter test | 缺页/字段、空页、坏坐标/table | `OCR_QUALITY_BLOCKED`；raw+失败诊断保留；无 JSON-LD 发布/segments | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t quality` |
| 幂等重试与结构化失败保持一致 / 成功请求幂等重放 | IP-05、IP-06、IP-09 | 既有/新 adapter test | 同 key/payload 两次 | 第二次相同 refs；fetch/put/register 不增加 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t idempotency` |
| 同 Requirement / 可重试服务失败保持冻结输入 | IP-04、IP-05、IP-07、IP-09 | OCR adapter test | unavailable/timeout/rate-limit 后成功及预算耗尽 | attempts≤配置；refs/bytes/策略/资源/deadline 不变；耗尽闭合失败 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t retry` |
| 同 Requirement / 同键载荷冲突 | IP-01、IP-06、IP-09 | 既有/新 adapter test | 同 key 改 source/deployment/policy/auth | `IDEMPOTENCY_CONFLICT`；无 fetch/put/register；旧链不变 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t idempotency` |
| OCR 与 llama.cpp 的运行资源相互隔离 / OCR 饱和不阻断模型调用 | IP-04、IP-10 | OCR adapter test | OCR/C05 两个协议替身并行，OCR 饱和 | llama 请求只受自己的 deployment/budget；refs 不同 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t isolation` |
| 同 Requirement / 单个 OCR 取消保持故障域 | IP-05、IP-10 | OCR adapter test | 一个 OCR caller abort/timeout/disconnect，另有 OCR+llama | 仅目标调用终止；其它调用与耐久工件不回滚 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts -t isolation` |
| 协议替身与真实内网服务分层验收 / 默认测试无需外部 OCR 服务 | IP-03、IP-09、IP-11 | OCR adapter/smoke test | 未设置 smoke env | deterministic suite 不联网；smoke 明确未运行；生产无替身 | `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr` |
| 同 Requirement / 显式 smoke 验证真实服务 | IP-03、IP-11 | OCR smoke test | `RISKFLOW_OCR_SMOKE=1` + 受控配置 + 预置服务 | 三媒体走生产 adapter；缺任何证据失败；报告无正文/路径 | `RISKFLOW_OCR_SMOKE=1 RISKFLOW_OCR_SMOKE_CONFIG=<受控配置路径> pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.smoke.test.ts` |

补充回归门：`pnpm exec vitest run packages/core/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`，证明 D-02/D-03 没有改变 C12 非 OCR、PostgreSQL 事务、审计和重放。

## 7. 文件清单与升级条件

计划新增：

```text
packages/adapters/src/engineering-data/document-conversion/ocr/config.ts
packages/adapters/src/engineering-data/document-conversion/ocr/schema.ts
packages/adapters/src/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.ts
packages/adapters/src/engineering-data/document-conversion/ocr/index.ts
packages/adapters/test/engineering-data/document-conversion/ocr/fixture.ts
packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.test.ts
packages/adapters/test/engineering-data/document-conversion/ocr/paddle-ocr-document-converter.smoke.test.ts
packages/adapters/test/engineering-data/document-conversion/ocr/fixtures/synthetic-scanned.pdf
packages/adapters/test/engineering-data/document-conversion/ocr/fixtures/synthetic-scanned.png
packages/adapters/test/engineering-data/document-conversion/ocr/fixtures/synthetic-scanned.jpeg
packages/adapters/test/engineering-data/document-conversion/ocr/fixtures/acceptance-manifest.v1.json
```

计划修改：

```text
packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts
packages/adapters/src/engineering-data/document-conversion/index.ts
packages/adapters/test/engineering-data/document-conversion.test.ts
packages/core/src/engineering-data/document-conversion/schema.ts
packages/core/src/engineering-data/document-conversion/service.ts
packages/core/test/engineering-data/document-conversion.test.ts
```

不计划删除文件。以下任一情况立即升级：需要改变 delta 行为；需要修改 contracts、C11、数据库/migration、apps、manifest、dependency policy 或 lockfile；PaddleX 3.7.0 冻结协议不能提供页/表格定位；可选 `pageExtents/confidence` 不能在列明 core 文件内闭合；C04 parent/evidence 联合不能接纳 raw diagnostic；C12 finalizer 无法在单文件内部抽取且必须复制；列明验证命令不存在；base 后出现重叠漂移或用户未提交改动。

实施完成后依次运行：定向 core/adapter/PostgreSQL 测试，`pnpm typecheck`、`pnpm lint`、对改动文件的 Prettier check、`pnpm deps:check`、`pnpm deps:policy`、`openspec validate deliver-scanned-document-ocr --strict --no-interactive`、`openspec instructions apply --change deliver-scanned-document-ocr --json`、`git diff --check`，最后用 `git diff --name-only 290bc39616d5f6021cd1585305c815b14e866297...HEAD` 加工作区 diff 核对文件范围。真实 smoke 单独记录；无预置服务时不得以替身结果替代。
