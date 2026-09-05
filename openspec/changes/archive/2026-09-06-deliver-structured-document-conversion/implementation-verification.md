# C12 独立实现验证报告

## 验证身份

- Change：`deliver-structured-document-conversion`（C12）
- Task / Dispatch：`task_0689ac4bb7c7` / `ctx_66c8ef375db0`
- Worktree：`d4349f30-1c7e-4777-b16d-f259481b0121::/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c12-structured-doc-conversion`
- 固定 implementation checkpoint：`856ae2bb4ba343c28e916e06e80cf98fde1e7000`
- 基线：`4358dcb`（C12 实现提交的父提交；派发信封中的 `baseHead` 与 implementation checkpoint 相同）
- 结论：**5 个 CRITICAL，当前不应归档。**

## 总览

| 维度 | 结论 |
| --- | --- |
| 完整性 | OpenSpec 17/17 已勾选；但依赖检查命令、真实 fixtures、C11 PostgreSQL 接缝测试和 C12 PostgreSQL adapter 行为测试缺失，勾选状态高于实际证据。 |
| 正确性 | 8 条 requirement 中 3 条具备完整实现证据，5 条存在下述契约差异；20 个 scenario 中，闭合契约、基本四格式解析、512 码点分块、双向指针、空 PDF、UTF-8 与内存幂等有直接测试，其余仅部分覆盖或无行为证据。 |
| 一致性 | 四层依赖方向和独立端口基本遵循 design；版本化策略、资源边界、审计重放与测试交付未遵循 design 的明确决定。 |
| 自动门禁 | 局部修复后 `pnpm verify` 通过；OpenSpec strict 通过。计划中的 `pnpm licenses:check` / `pnpm security:check` 不存在。 |

## CRITICAL 1：版本化策略引用没有约束实际执行策略，无法重放

命令固定了 `conversionPolicyRef`、`qualityPolicyRef` 与 `converterDeploymentRef`，但 adapter 实际使用构造函数传入的 `resourcePolicy`，没有校验它的 `policyRef` 是否等于命令引用；`qualityPolicyRef` 只被抄入记录，从未参与任何校验或转换。相同的冻结引用可在不同进程配置下产生不同资源边界和结果，不满足“相同输入与冻结版本重放”。

- 契约引用：`packages/contracts/src/ports/index.ts:1023`
- 实际策略来源：`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:364`
- 转换调用只使用隐藏的 `#policy`：`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:468`
- 现有测试以 `conversion-policy@v1` 调用默认 `document-conversion-policy@1` 仍成功，直接证明未绑定：`packages/adapters/test/engineering-data/document-conversion.test.ts:294`

建议：明确 conversion / quality / parser 三类版本的唯一映射，由命令引用解析出实际不可变配置，或至少在 adapter 边界严格校验注入配置与命令引用一致；保存实际资源策略版本并增加“同引用不同配置拒绝”的行为测试。

## CRITICAL 2：不可信文档没有在版本化资源边界内处理，且格式伪装会成功

DOCX/XLSX 使用 `unzipSync` 先解压，再汇总检查总解压量；filter 只检查单个条目，多个条目的累计上限在内容已全部物化后才生效。XLSX 在 `Workbook.load` 完整物化后才检查工作表和单元格数；CSV 由同步解析器完整物化后才检查记录/字段数，并在创建全部 block 后才检查输出数。默认策略还允许 100,000 个输出块，而 core Schema 把解析块硬限制为 10,000、文本块硬限制为 50,000，配置值并非唯一事实源。

DOCX 只检查 ZIP 头和 `word/document.xml`，没有验证 `[Content_Types].xml` 或根 officeDocument 关系。现有测试构造的 ZIP 只有一个 `word/document.xml`，并非完整 DOCX，却被当作成功样例，违反“格式伪装必须失败”。

- ZIP 先整体解压、后检查累计量：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:197`、`packages/adapters/src/engineering-data/document-conversion/parsers.ts:233`
- DOCX 容器身份校验不足：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:312`
- XLSX 先加载、后检查：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:621`
- CSV 先整体解析、后检查：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:729`
- 输出 block 在全部创建后才检查：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:768`
- 隐藏的 core 硬上限：`packages/core/src/engineering-data/document-conversion/schema.ts:20`、`packages/core/src/engineering-data/document-conversion/schema.ts:138`
- 被接受的伪 DOCX 测试：`packages/adapters/test/engineering-data/document-conversion.test.ts:107`

建议：在解压 filter 中累计声明解压量并在 inflate 前终止；验证 OOXML 内容类型和根关系；为 CSV 使用可中止的流式解析，为 XLSX 在 `Workbook.load` 前做受限包/工作表预检或采用受控流式路径；让所有输出上限来自同一版本化策略，并用超限样例证明不会先物化越界对象。

## CRITICAL 3：历史查询、因果运行与失败诊断不满足可重放审计

`read` 为历史转换重新调用 `resolveSourceProcessingInput`，而该 C11 接缝要求资料所属的项目修订仍是当前修订；项目修订推进后，即使调用方仍持有旧资料授权，历史转换查询也会返回 `STALE_VERSION`。这与“查询历史记录不依赖可变的当前资料解释结果”冲突。

转换命令、转换记录、迁移和 `AtomicCommandV1` 构造都没有传递因果运行标识；C03 已支持 `runId` / `threadId`，C12 没有使用。失败诊断只写 `stage`、`reasonCode` 和时间，不写要求中的 `retryable` 与失败原因；失败统计恒为零，也不记录命中的 `limitCode`。

- 历史 read 复用处理输入接缝：`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:628`
- C11 当前项目修订门禁：`packages/core/src/engineering-data/context-source/service.ts:591`、`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts:746`
- C12 原子命令未传 `runId` / `threadId`：`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:268`
- 诊断缺少可重试性和失败原因：`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:716`
- 失败统计丢失实际输入和 limit：`packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts:768`

建议：为历史 read 使用只验证授权、但不要求“当前可处理版本”的窄接缝；在命令/记录/迁移/AtomicCommand 中明确保存因果运行；诊断保存稳定 code、stage、retryable、安全失败原因和可确定的资料段，统计保存已知输入量与 `limitCode`。

## CRITICAL 4：表格值与资料段定位会失真

XLSX 非公式数值和布尔值先被转换成字符串，随后 `TableField.value` 直接取 `block.text`，丢失源标量类型；日期等常见 Excel 值会被转换为空字符串。公式缓存值单独保留，不能补偿普通单元格失真。

CSV/XLSX/DOCX 表格的所有单元格共用一个资料段，但 `buildSegments` 使用第一个含文本单元格的 locator 作为整个表格资料段定位。四格表会登记为同一资料段，却只声明第一格的行列范围，后续证据无法从资料段定位回溯到其余单元格。运行时复现：一个多单元格 CSV 的 `source_1-csv_1-csv_1` 包含多个 `textBlockIds`，locator 仍为 row 1..1、column 1..1。

DOCX 标题/图注只按 `pStyle` 字符串是否包含英文 `heading` / `caption` 判断，不读取 `styles.xml`；常见中文样式 ID 不能稳定保留章节层级。

- XLSX 标量转字符串/未知对象转空：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:570`
- TableField 总是取文本：`packages/core/src/engineering-data/document-conversion/service.ts:252`
- 表格块共用 segment：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:647`、`packages/adapters/src/engineering-data/document-conversion/parsers.ts:757`
- 资料段取分组第一个文本块 locator：`packages/core/src/engineering-data/document-conversion/service.ts:217`
- DOCX 样式名启发式：`packages/adapters/src/engineering-data/document-conversion/parsers.ts:338`

建议：在规范化单元格模型中保留源标量值；表格资料段使用 table block 的完整范围，或让每个可独立定位单元格拥有独立资料段；从受控 `styles.xml` 解析样式 ID 到标题层级/图注语义，并以真实中文 DOCX 验证。

## CRITICAL 5：任务和测试证据不足，依赖退出条件未收口

仓库没有 C12 的落盘真实 DOCX/PDF/XLSX/CSV fixture，也没有 fixture 来源/再生成说明。唯一 adapter 测试动态构造最小 ZIP、PDF 字符串和工作簿，且转换服务仅使用内存 mock；没有 `StructuredDocumentConversionAdapter` 的 PostgreSQL 集成测试，未验证数据库成功/失败终态、同键异载荷、第五步成功第六步失败后的恢复、跨工程 read、无权 read、只追加约束或不存正文/完整 JSON-LD。C11 PostgreSQL 窄查询也没有随 C12 增加对应的授权顺序测试。

计划和 tasks 要求的 `pnpm licenses:check` 与 `pnpm security:check` 在根 scripts 中不存在。替代执行 `pnpm audit --prod --json` 得到 1 个 moderate：`exceljs > uuid@8.3.2`，无 high / critical；但 design 的依赖退出条件写的是“出现安全问题即退出或更换”，需要主调度明确处置，不能以不存在的命令视为已通过。

- 当前 C12 adapter 测试范围：`packages/adapters/test/engineering-data/document-conversion.test.ts:106`
- 仅内存 mock 的服务测试：`packages/adapters/test/engineering-data/document-conversion.test.ts:204`
- tasks 的真实 fixture / PostgreSQL / 依赖检查要求：`openspec/changes/deliver-structured-document-conversion/tasks.md:3`、`openspec/changes/deliver-structured-document-conversion/tasks.md:28`、`openspec/changes/deliver-structured-document-conversion/tasks.md:32`

建议：补最小落盘真实 fixtures 及来源说明；在现有 PostgreSQL fixture 上增加一个表格驱动 adapter 集成测试覆盖任务 5.3 的稳定外部行为；补齐或改正依赖检查脚本，并由主调度记录 moderate 告警的接受、缓解或替换决定。

## 验证中完成的局部修复

1. `packages/adapters/test/postgres/postgres-foundation.test.ts`：把新增 `000009` 加入既有测试迁移清单；修复前 foundation suite 因 `MIGRATION_INVALID` 全部跳过。
2. `packages/adapters/test/auth/fixture.ts`：把 `000009` 加入 auth fixture 的显式迁移映射；修复前 auth suite 同样在迁移加载阶段失败。
3. `config/dependency-policy.json`：修正一处 Prettier 格式，使根格式门恢复通过；无依赖或策略语义变化。

这些修复只恢复既有门禁，不改变 C12 契约、生产逻辑、依赖版本或锁文件。

## 验证命令

| 命令 | 结果 |
| --- | --- |
| `openspec status --change deliver-structured-document-conversion --json` | 通过；spec-driven，17/17 tasks 已勾选。 |
| `openspec instructions apply --change deliver-structured-document-conversion --json` | 成功读取 proposal、两份 delta、design、tasks。 |
| `openspec validate deliver-structured-document-conversion --strict --no-interactive` | 通过。 |
| `pnpm exec vitest run packages/core/test/engineering-data/document-conversion.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts` | 通过：2 files，15 tests。 |
| `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts` | 修复迁移测试映射后通过：2 files，26 tests。 |
| `pnpm verify` | 修复后通过：build、typecheck、lint、format、31 files passed / 1 skipped、276 tests passed / 1 skipped、deps 与 15 项 OpenSpec strict 均通过。 |
| `pnpm licenses:check` | 无法运行：script 不存在。 |
| `pnpm security:check` | 无法运行：script 不存在。 |
| `pnpm audit --prod --json` | 完成：0 critical / 0 high / 1 moderate（`exceljs > uuid@8.3.2`）。 |
| `git diff --check` | 通过。 |

## 最终判断

自动门禁通过说明当前 happy path 可以编译和运行，但不可信输入安全、冻结版本重放、历史审计、结构保真与交付测试仍未满足 change 的明确 requirement。**5 个 CRITICAL 必须在归档前处理；主调度应先决定策略/质量版本绑定、历史授权查询和依赖告警三个契约问题，再安排当前 change 内修复及补测。**
