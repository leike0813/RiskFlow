# Verification

## 验收对象与结论

- Change：`deliver-quality-evaluation-module`（C36；实际 schema `orchestrated-delivery`）。
- 本轮输入 HEAD：`0eda631c01a5d5d168b07cf9cfda10e593d8a499`；合并主线检查点：`a8893d7`；已核验实现 HEAD：`963a9755ec379d4919e91b18566afb1b29b6eb33`。
- Finalizer：`task_ba559d063211` / `ctx_97fddf591af2`。样例均为合成样本，待甲方复核；没有真实工程准确率结论。

**BLOCKED：等待本轮唯一一次限定审计结论。** IP-08～IP-10 的实现、回归与规格校验已完成；本轮修改了当前授权读取和投影权限边界，按收尾协议由协调端安排限定审计。审计完成后须在下节补入结论与任务内修复/回归证据，再判定 PASS 或 FAIL；不得仅凭本节预先通过。

## 已核验行为

| 范围 | 实现与观察结果 |
|---|---|
| IP-08 正式空结果 | C39 已完成运行终态与工作计划、C22 每工作项正式零结果由公开精确读接口合取；C22 独立只读组合入口与原服务共用校验。C36 对运行/输入/计划引用、零记录/零事件/零失败/零跳过/零待审、非空工作项全集、逐项零结果及样例工序/空间/来源版本作有界核对。只有经核验的负样例计 TN 与覆盖；缺失、错版或无权保持未判定。测试还修正了已证明 TN 同时携带“结果缺失”原因码的矛盾。 |
| IP-09 必审资料段 | 每项经 C13 当前授权解析并取得收据，C04 完整性与正式审计仍独立成立；缺项、错版、撤权及跨范围失败闭合，不复制资料正文。 |
| IP-10 来源授权映射 | C09 有界选行后逐来源版本向 C06 签发，返回前以新的 invocation 再签当前工程/空间及来源版本；C36 复选行引用和摘要，变化时同形失败，定位引用仅按精确版本的当前 grant 披露。 |
| 合并与迁移 | 主线 C39 迁移 49、C30 迁移 50 与 C36 自有只追加迁移 51 依序共存；相关迁移清单和设计已同步。报告索引、冻结登记、回执与审计仍在既有 C03 原子路径，未新增生产依赖或权限值。 |

## 实际回归命令

| 证据 | 实际命令与结果 |
|---|---|
| Q1、Q2、IP-08 核心及 C36 PostgreSQL | `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts` → 3 文件、85/85 通过；含 C22 独立只读入口与原服务同结果、正式 TN/覆盖及缺证明边界；C36 组合端以公开端口夹具验证全集、范围、撤权与重放。 |
| Q3、Q4、Q8 与 C39/C22 拥有方真实 PostgreSQL | `pnpm exec vitest run packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts apps/api/test/quality.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/web/test/quality.test.tsx packages/adapters/test/postgres/postgres-foundation.test.ts` → 6 文件、80/80 通过。API 与 C36 PostgreSQL 测试覆盖撤权和并发新行失败闭合；C39/C22 测试核对已完成终态及正式零结果拥有方读契约。另一次 `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/core/test/quality/quality.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts apps/api/test/quality.test.ts` → 4 文件、93/93 通过。 |
| Q5 生产构建与真实浏览器 | `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium` → 构建通过、真实 Chromium 2/2 通过，登录、导航、刷新、工程切换、授权定位与键盘焦点均在正式 HTTP/投影接缝上执行。首次两次 Playwright 运行因本地增量构建目录残留旧 C36 `000049` 迁移产物而失败；以内置编辑工具移除这两个被忽略的过期产物后，独立重跑及最终联合命令均为 2/2。失败 trace 位于 `test-results/quality-browser/`，并未计为通过。 |
| Q6、Q7 类型、依赖、格式、规格 | `pnpm typecheck`、`pnpm lint`、`pnpm deps:check`（441 模块、1296 依赖）、`pnpm deps:policy`、`pnpm exec prettier --check`（本轮变更文件）、`openspec validate deliver-quality-evaluation-module --strict --no-interactive`、`git diff --cached --check` → 均退出码 0。格式修改均经内置 `apply_patch`。 |
| OpenSpec 状态 | `openspec status --change deliver-quality-evaluation-module --json` → `schemaName=orchestrated-delivery`、`isPlanningComplete=true`、`isComplete=true`；任务 5.1 与 5.4 已按行为和证据勾选。状态只说明工件/任务齐备，不代替本页的审计结论。 |

## 限定审计（协调端补入）

- 输入实现 HEAD：`963a9755ec379d4919e91b18566afb1b29b6eb33`。
- 审计范围：D-11 的当前工程/空间/资料权限与并发行重选；D-09 的 C22 读前/读后当前授权及 C39/C22 事实合取；C36 只追加迁移 51 与 C03 原子路径受合并影响的部分。
- 审计 Agent / Task / Dispatch：待协调端填写。
- 发现、当前审计 Task 内修复与实际回归：待审计 Agent 填写。
- 最终结论：待审计 Agent 填写；同一收尾轮次不再派第二次审计。

## 剩余边界

- 甲方脱敏样例和目标环境尚未提供；报告仅证明合成样本的测量与授权链路。
- 既有 C04 对缺失和拒权采用同形安全失败，C36 在样例级保留未核验证据诊断，不以缺失推断通过；若未来要区分原因，需单独批准拥有方契约与报告处置规则。
- 本轮不归档、不合并到主线。
