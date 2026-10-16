# MinerU 图表、公式文本与来源空白页处理提案

状态：已批准（2026-10-15），D-45 代码、策略及三份正式新版本重转已实施；STD-001/003 合格，STD-002 在原 img 安全边界新增拒绝，后续清洗和检索尚未通过。结果见 [v38 实施证据](mineru-standard-conversion-v38-2026-10-15.md)。

## 实机依据

D-44 已修复 C04 读取块被覆盖的问题，三份原件的保留块拼接摘要均与登记摘要一致。v37 三次远端 MinerU 任务均到达 done，但正式转换仍为 BLOCKED/TERMINAL_FAILURE；失败记录及原响应保留。详见 [v37 转换证据](mineru-standard-conversion-v37-2026-10-15.md)。

批准复核：已通过画布完整核实 STD-001 第 9、51 页无正文，以及 STD-003 耐久 ZIP 中所有 `eq` 均无属性。

| 来源 | 实际阻断 | 已核实的边界 |
| --- | --- | --- |
| STD-001 | MINERU_QUALITY_REJECTED，非空页 97/99，要求 1 | 物理 Chrome 原件整页复核确认第 9、51 页无正文；关键字段覆盖为 1 |
| STD-002 | MINERU_PROTOCOL_INVALID，layout-schema | 官方 3.4.4/hybrid 返回 chart、chart_body、chart_caption 及 chart span；共享规范化已有 chart 语义，官网映射未接通 |
| STD-003 | MINERU_MIDDLE_INVALID，table-html-tag-unsupported/eq | 已耐久 ZIP 中的表格使用无属性 eq 标签保存公式文本；现有受限行内标签集合未包括它 |

## 拟实施范围

1. 在 `packages/adapters/src/engineering-data/document-conversion/mineru/official-normalization.ts` 中，仅扩展已观察到的官网图表结构：span 增加 chart；block 增加 chart、chart_body、chart_caption、chart_footnote；chart 容器沿既有递归映射，chart_body 验证 chart span 后映射为共享结构要求的惰性字符串。图注与脚注保留真实文本及源坐标。图表图像内容不推断成文本、指标值或公式值，原图路径及完整响应仍可从原始工件追溯。未知类型、版本、越界坐标和资源超限继续拒绝。
2. 在 `packages/adapters/src/engineering-data/document-conversion/mineru/normalization.ts` 的既有 INLINE_TAGS 中增加 eq。沿现有递归读取单元格文本，保留字面公式，不执行或求值；eq 属性仍被拒绝，DOCTYPE/ENTITY、危险标签、未知标签、表格结构及资源限制保持原检查。不新增 HTML 渲染或公式引擎。
3. 仅在当前隔离实例，为精确 STD-001 原件摘要 `5fe30dfae8d3cc5cb658980220c4e9fcd98163e8e067cfa4542cbe80f531df6f` 创建新的来源专用质量策略引用，`minNonEmptyPageRatio` 从 1 调整为 `97/99`，`minKeyFieldCoverage=1` 及原 keyFields 不变。该调整只允许已核实的两张无正文页，不作为其它文件的默认门槛。正式转换后、下游清洗前，验收程序必须核对：完整 99 页映射、非空 97 页、无正文页恰为 `{9,51}`、原件摘要和策略精确匹配；任一不符停止后续验收并保留结果，不能仅凭比例判合格。此精确页集合是本次来源验收断言，不增加公共 Schema 或运行时字符串门禁。
4. STD-002/003 及既有 16 份资料保持原质量策略。模型、服务通道、权限、资源预算、检索 query/grade/TopK 和七项检索质量阈值保持原值。新版本不承诺必然通过，发现其它空白页或质量问题时如实记录，不追加例外。
5. 冻结新的本地发布制品及 converterDeploymentRef；按既有 C11 正式版本入口为重转资料建立新 source-version，并固定原件、来源限制和新转换身份。新策略或解析部署不能只换 conversionId 重写原资料版本。沿原 C04/C11/MinerU 路径重转，保留 v36/v37 失败、原始响应、历史资料版本及旧下游引用；不直接 SQL 写入业务事实。

## 文件与验证

生产代码限上述两个文件；测试限既有 `packages/adapters/test/engineering-data/document-conversion/mineru/official-normalization.test.ts` 和 `packages/adapters/test/engineering-data/document-conversion/mineru/normalization.test.ts`。复用既有 fixture 和用例组织，验证 chart 图注/坐标可追溯且图像路径不进入正文，eq 公式文本原样保留且属性/危险内容继续拒绝。保留原空页、关键字段与未知结构拒绝用例；不新增测试框架、依赖、迁移或公共 DTO。

批准后同步本 change 的 proposal、design、implementation-plan、handoff、现有 structured-document-conversion 局部 delta，新增 platform/mineru-service-integration 局部 delta 说明已核实的官网结构映射与版本证据；不改主规格。实例根新增策略、部署配置、C11 版本/转换/精确页核验及下游回执，不把资料正文或秘密复制进普通报告。

先用合成的同结构输入取得红灯，再修复并运行：

```sh
pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/official-normalization.test.ts packages/adapters/test/engineering-data/document-conversion/mineru/normalization.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts
NODE_OPTIONS=--max-old-space-size=8192 pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm exec openspec validate --all --strict --no-interactive
git diff --check
```

工程通过后才部署新制品并执行正式重转。三份来源都满足结构、关键字段及明确的来源页核验后，才继续原 16 份加三份标准的新清洗/准备、C17 真实条款证据、物理 Chrome 审核/独立发布和七项检索质量门。原五资料父运行仍须使用其自身正式准备及因果入口，不能绑定这份知识编制准备冒充就绪。

## 本次为何需要授权

项目 AGENTS.md §3 和 implementation-plan.md §7 要求计划外文件或范围先升级。D-43/D-44 同时明确保持原质量策略；本提案涉及两个解析器和 STD-001 的来源专用质量调整，先形成具体方案并经用户批准纳入本轮文件范围。实施不降低门槛，不提交、归档或提前创建 verification。
