# Verification

## 验收对象

- Change：`deliver-quality-evaluation-module`（C36，实际 schema `orchestrated-delivery`）
- 输入实现 HEAD：`6f2f211e03d097458b375f70f117bdf5e0adf402`
- 最终验收 HEAD：`bc3c81974ff1f394a0ebf96dfda02a87376a9beb`；本轮限定审计修复在该 HEAD 上的未提交工作树中，协调端形成检查点后须以新 HEAD 更新本项并核对受影响证据。
- 验收 Agent：C36 Finalizer，`task_b5fb83e0f65a` / `ctx_71899b62e525`；限定审计 Agent，`task_0adcfaec9c72` / `ctx_0b709fe5e1d3`
- 样例边界：合成样本，待甲方复核；本轮没有甲方脱敏真实样例或真实准确率结论。

## 结论

**BLOCKED。** C36 已批准范围内的空间授权缺口、指标高估路径、验证设施接线、数据集规范工件身份及同版本不同摘要的并发竞争已修复，列出的最终回归命令通过；但现有公开引用无法证明正式空识别结果、必审资料段的可授权解析，也无法将 C06 的资料 grant 身份映射到 `evidenceRefs.sourceVersion`。因此准确率/覆盖度中的真实 TN、审计链完整率的通过项，以及浏览器验收中的授权证据定位可见性尚不能成立，不可记为 PASS。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或实际命令 | 结果 |
|---|---|---|
| 冻结数据集：完整样例、缺项、合成标记 / IP-01 | `packages/core/src/quality/schema.ts`；Q1（见下） | strict Schema、版本/标签与合成标记通过；真实样例未提供。 |
| 七项确定性指标：标签对齐、缺失结果、零分母 / IP-02 | `packages/core/src/quality/evaluate.ts`；Q1 | 无正式输出的负样例为 `undetermined`，不再计 TN/覆盖；零分母为 `null`；准确率/覆盖分母保留缺口。正式空结果的正面证明待规划。 |
| 可重放与可审计：精确版本、证据或审计缺失 / IP-02、IP-03 | C29 引擎重算、C04 `verified` 读回、C03 集成断言；Q1、Q2 | 决策重放、C04 摘要与 C03 原子回执/审计路径通过。必审资料段缺少可授权解析收据时，样例标记 `quality-evidence-artifact-unverified`，审计完整率为 `0/N`，不声称通过。C04 对缺失与拒权的同形安全拒绝仍需规划区分报告处置。 |
| C36 查询投影：授权 exact/list、工程切换/撤权、同形拒绝、旧类型兼容 / IP-04、IP-05、IP-06 | `000049_quality_evaluation_report_index.ts`、`postgres-quality-projection.ts`；Q2、Q3、Q4、Q8 | 自有表只追加、`SELECT/INSERT` 最小 GRANT、重复 up/down；精确空间引用入索引，当前工程/空间/单一 `projection.query` 授权过滤，无权/跨空间/跨工程/不存在同形拒绝；游标按完整报告身份稳定排序并拒绝非法时间；旧类型不由窄端口接管。资料 grant 无法映射时 `evidenceRefs` 关闭披露。 |
| 追加与重放 / IP-03、IP-04、IP-05 | Q2、Q8：同键同摘要、异摘要、不同版本、migration 反复 up/down | 通过；同键不重复索引，冲突不产第二条，历史版本保留。 |
| 数据集规范工件身份及并发冻结 / IP-01、IP-03、IP-04 | `QualityEvaluationService` 核对 C04 引用 ID；C36 冻结表在 C03 事务内登记/核对；Q2 并发回归见下 | 别名工件报 `STALE_VERSION`，不追加索引；同摘要并发只冻结一次、不同运行报告各自成立，异摘要并发仅一个报告成立。 |
| 页面与真实浏览器：登录、导航、质量查询、刷新、工程切换、拒权、键盘焦点 / IP-06、IP-07 | Q4、Q5；`pnpm exec playwright test -c playwright.config.ts --project=chromium --reporter=json > /tmp/c36-playwright-final.json` | Chromium `153.0.8010.12`，2/2 浏览器场景通过；工程摘要可见、旧工程内容清除。缺 Chromium 的负向命令明确非零并生成 trace。授权证据定位可见性因 grant 映射缺口**未满足**，测试通过不代表该子场景闭合。 |
| 依赖、类型、边界与规格 / IP-01～IP-07 | Q6、Q7、`git diff --check` | 全部退出码 0；`@playwright/test@1.63.0` 为既有登记的测试期 devDependency，无新增生产依赖。 |

实际 Q 命令与结果：

- Q1/Q2/Q3/Q4/Q8 合并运行：`pnpm exec vitest run packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/test/quality.test.ts apps/web/test/quality.test.tsx packages/adapters/test/postgres/postgres-foundation.test.ts` → 6 文件、60 测试通过。
- Q5：`pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium` → 构建通过，真实 Chromium 2/2 通过；JSON reporter 复跑也为 2/2。`PLAYWRIGHT_BROWSERS_PATH=/tmp/c36-browser-missing pnpm exec playwright test -c playwright.config.ts --project=chromium --retries=0` → 退出码 1，明确报 `Chromium executable is missing`，失败 trace 位于 `test-results/quality-browser/.../trace.zip`；最终通过运行没有失败 trace。
- Q6/Q7：`pnpm typecheck && pnpm deps:check && pnpm deps:policy && openspec validate deliver-quality-evaluation-module --strict --no-interactive` → 类型、1134 条依赖边界、策略及严格规格校验均通过。
- C04 浏览器验收数据集引用：`quality-dataset-c36-browser-dataset@2030-06-02.1@sha256:6c13da7da0f0f9a6e2ca0e0816f661fadeddb263bb4e16da71a54dbbc99f0144`；报告引用：`quality-evaluation-report-c36-browser-dataset@2030-06-02.1-72382267a940f507d284f1c180a9045e3a3230ce98c273cac683093cd9f8ab92@sha256:f27d7e7482d4fb46ea64398f39b76880365ea18ae84010bed7d204ff313cf8a6`。这两项来自限定审计最终 JSON reporter 的测试注记；`apps/web/test/browser/server.mjs` 以真实 C04/C03/C06/C36 服务创建并由浏览器页面核对报告身份，样本属于合成数据。

验收期修复：

- `packages/core/src/quality/{evaluate,service}.ts`：负样例缺正式结果时不计 TN/覆盖；必审资料段未获证明时审计失败闭合；从冻结样例收集精确空间引用并在写入前核对授权。
- `packages/adapters/src/quality/*` 与自有 migration `000049`：只追加保存精确空间引用，列表和 exact 在索引读取时按当前授权过滤；游标使用规范编码和完整 keyset；资料 grant 与来源版本身份无法对应时不披露定位引用。集成测试覆盖工程/空间拒权同形、授权通过、非法游标、迁移及幂等。
- `scripts/quality/evaluate.mjs`、CLI/浏览器夹具与测试：CLI 向 C06 请求数据集精确空间范围，浏览器夹具使用签发的实际范围和实际 Chromium 版本/Git HEAD，报告/数据集引用写入验收注记；测试期断言跟随失败闭合语义。
- `implementation-plan.md` 将首轮 `vitest.config.ts` 变更登记到 IP-07 文件清单和 §9：只排除 Playwright 规格文件的 Vitest 发现，不扩大能力范围；`design.md` 记录经协调端批准的自有空间索引列。
- 限定审计在 `packages/core/src/quality/service.ts` 核对传入 C04 数据集引用与 `qualityDatasetArtifactId` 生成的规范 ID；在 `packages/adapters/test/quality/postgres-quality-evaluation.test.ts` 增加别名工件回归。两处均属于已批准 D-01 身份规则，未修改公共契约或持久化模型。
- 限定审计经协调端 `msg_a6f76dcf49a6` 及后续 ask 裁决，在 C36 自有 `000049` 增加只追加数据集冻结登记表；`postgres-quality-evaluation.ts` 于同一 C03 事务中核对摘要并追加报告索引/回执/审计。报告索引继续允许同数据集的不同运行报告。`design.md`、`implementation-plan.md` 与 `tasks.md` 只同步这一已批准施工事实；真实 PostgreSQL 测试覆盖并发同/异摘要、同数据集多报告、两表 GRANT 与 up/down。
- `apps/web/test/browser/server.mjs` 的合成数据集工件 ID 原与正文 `datasetId` 不一致，规范身份校验使夹具启动报 `STALE_VERSION`；现按相同数据集身份修正 ID，真实 Chromium 重跑 2/2 通过。首次失败时夹具清理 PostgreSQL 引发的连接终止掩盖了该错误；独立启动诊断确认原始 `STALE_VERSION`，修复后未再发生。

## 限定审计

- **本轮唯一一次限定审计已完成；结论 BLOCKED 仅因下述既有证据缺口。** 输入 HEAD `bc3c81974ff1f394a0ebf96dfda02a87376a9beb`。核对 `apps/api/src/app.ts:314-352` 的当前会话 C06 授权、`postgres-quality-projection.ts` 的工程/空间过滤及同形拒绝、`000049_quality_evaluation_report_index.ts` 的两张只追加表与最小 GRANT/up/down、`postgres-quality-evaluation.ts` 与 C03 `transaction-unit.ts` 的索引/回执/审计原子提交及同键重放。上述已批准路径没有发现新的越权读或部分成功提交；Q2 的真实 PostgreSQL 集成测试覆盖并通过相应分支。
- **已修复的数据集身份与并发缺陷：** 非规范 artifact ID 现报 `STALE_VERSION` 且不追加索引。原事务外版本查询存在并发窗口，已通过 `msg_bec1d182bd2f` 升级并获协调端 `msg_a6f76dcf49a6` 批准；C36 冻结表以 `(project_id,dataset_id,dataset_version)` 为唯一身份，只保存内容摘要；C03 同一事务内登记/核对后才追加报告索引、回执与审计。异摘要返回不可重试 `STALE_VERSION`，同摘要冻结只登记一次，报告按各自运行身份追加。无新能力、角色、权限值或跨 change 外键。
- **实际回归：** `pnpm typecheck` → 退出码 0；随后 `pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts` → 1 文件、12/12 通过（含真实 PostgreSQL 并发同/异摘要、同数据集多报告、事务/权限/迁移）；`pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` → 1 文件、17/17 通过。初次并行运行 typecheck 与测试读到旧 `packages/core/dist`，顺序重跑后 10/10 通过；增加并发回归后，旧列表测试因误设只有一个报告而失败，改为核对精确目标报告及全部返回项脱敏，最终 12/12 通过。
- **浏览器与规格回归：** `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium` → 生产构建和真实 Chromium 2/2 通过；`pnpm exec playwright test -c playwright.config.ts --project=chromium --reporter=json > /tmp/c36-audit-playwright.json` → 2/2、无 skip/flaky，Chromium `153.0.8010.12`，注记给出上列精确 C04 引用；`pnpm deps:check && pnpm deps:policy` → 1134 条依赖边界与策略通过；`openspec validate deliver-quality-evaluation-module --strict --no-interactive` 与 `git diff --check` → 退出码 0。浏览器此前因夹具非规范工件 ID 失败，已在当前 Task 内修复并重跑。

## 待规划处置的开放项

1. **正式空识别结果。** `packages/core/src/quality/schema.ts:166-177` 的样例只有输入快照、可选 `riskRecordRef`，没有正式运行的“已执行且无命中”引用；`packages/core/src/quality/evaluate.ts:178` 只能把无记录的负样例列为 `undetermined`。需要能与冻结输入/运行版本绑定并可验证的正式空结果证据，才能将其计入 TN 与覆盖；不能由可选引用缺席推导。
2. **必审资料段可授权解析。** `QualitySampleV1.requiredEvidenceRefs` 是资料段定位（`schema.ts:177`），而 `QualitySampleEvidenceV1.verifiedEvidenceRefs` 与 `service.ts:366-448` 只有 C04 内容工件校验收据；没有资料段当前授权解析与完整性收据。`evaluate.ts:121` 因此失败闭合审计链完整率。需规划拥有方公开窄读证据及其与样例的精确绑定，才能给出通过项；现有 C04 工件收据不能证明资料段正文可达。
3. **资料 grant 与来源版本映射。** C06 `postgres-local-identity-access.ts:150,496` 签发的是 `source_access_grant_id/revision_id`，质量摘要 `evidenceRefs` 携带的是 `sourceVersion.entityId/versionId`，两者不是同一标识；`apps/web/src/quality/QualityPage.tsx:193` 的质量查询又以空 `requestedSourceVersionRefs` 调用 C09。`postgres-quality-projection.ts:178` 现为安全起见返回空定位引用。需规划公开授权映射/查询时请求契约，才能恢复获授权证据可见性；浏览器“证据可见性”子场景因此未满足。
4. **C04 缺失与拒权的同形失败。** `packages/adapters/src/quality/postgres-quality-evaluation.ts:130-190` 把 C04 拒权映射为 `AUTHORIZATION_DENIED`；未登记的样例工件也可能走同一安全拒绝。`service.ts` 当前按样例缺口保留逐项诊断；若直接把此码全部提升为命令失败，会误阻断规格要求的缺失结果分母。需规划可安全区分两种情形的公开读契约或报告处置规则，不改变 C04 不可枚举语义。

## 后续注意事项

- 本轮没有提交、合并或归档。协调端检查点产生新 HEAD 后，更新本工件的最终 HEAD 与所需证据；既有开放项解决前不可改为 PASS。
