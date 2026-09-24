# Verification

## 验收对象与结论

- Change：`deliver-quality-evaluation-module`（C36；实际 schema `orchestrated-delivery`）。
- 本次复核输入及已核验产品 HEAD：`e43c77e689bc51ae05c177d66180aa43e5ebdc5e`；相对前次限定审计的代码 HEAD `7925e5bb4f745d14c75142b652e3008cfa07842f`，仅本 verification 文档变化。本次只更新本工件，后续检查点由协调端形成。
- 首轮 Finalizer 输入 HEAD：`0eda631c01a5d5d168b07cf9cfda10e593d8a499`；合并主线检查点：`a8893d7`。
- Finalizer：`task_ba559d063211` / `ctx_97fddf591af2`；限定审计：`task_a361561568b9` / `ctx_55a94f27ea3c`。样例均为合成样本，待甲方复核；没有真实工程准确率结论。
- 本次复核：`task_a540da5debc4` / `ctx_de5b578a6f43`；范围内代码修复：无。

**PASS：C36 已批准语义及本轮唯一一次限定审计均通过。** IP-01～IP-10 的实现、关键接缝、回归与规格校验完成；结论仅适用于上述固定代码 HEAD 和合成样本验证。

本次在 `e43c77e689bc51ae05c177d66180aa43e5ebdc5e` 复核全部 OpenSpec 上下文、产品差异和关键调用链；产品代码未变，前次限定审计结论仍适用。下表保留前次验收证据，本次重跑结果见“当前检查点回归”。

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

## 限定审计

- 输入与最终代码 HEAD：`7925e5bb4f745d14c75142b652e3008cfa07842f`；相对前次已核验实现 HEAD `963a9755ec379d4919e91b18566afb1b29b6eb33`，仅 verification 文档发生变化。
- 审计范围：D-11 的当前工程/空间/资料权限与并发行重选；D-09 的 C22 读前/读后当前授权及 C39/C22 事实合取；C36 只追加迁移 51 与 C03 原子路径受合并影响的部分。
- 审计 Agent / Task / Dispatch：本任务 / `task_a361561568b9` / `ctx_55a94f27ea3c`。
- 代码核对：C09 按精确来源版本两轮签发，末轮复验工程/空间后由 C36 重选报告引用与摘要 digest；C39 已完成终态、冻结计划与 C22 逐工作项零结果合取，C22 返回前复验当前授权；迁移 51 只给应用角色 SELECT/INSERT，C36 索引、冻结摘要、回执与审计由 C03 单事务提交。同形拒权、撤权、并发新行、同键重放、迁移逆序回滚均有实际分支断言。未发现范围内缺陷，代码修复：无。
- 实际回归：`pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/core/test/quality/quality.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts apps/api/test/quality.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts` → 6 文件、124/124 通过；`pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/web/test/quality.test.tsx` → 3 文件、41/41 通过；`pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium` → 真实 Chromium 2/2 通过；`pnpm typecheck`、`pnpm deps:check`、`pnpm deps:policy`、`openspec validate deliver-quality-evaluation-module --strict --no-interactive`、`git diff --check` → 均退出码 0。
- 最终结论：PASS；本收尾轮次的限定审计已闭合。

## 当前检查点回归

- `git diff 7925e5bb4f745d14c75142b652e3008cfa07842f e43c77e689bc51ae05c177d66180aa43e5ebdc5e --stat`：仅本 verification 文档变化；IP-01～IP-10 产品代码、测试和迁移与已审计版本相同。
- `pnpm exec vitest run packages/core/test/identification/candidate-finalization.test.ts packages/core/test/quality/quality.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts packages/adapters/test/quality/postgres-quality-evaluation.test.ts apps/api/test/quality.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts`：6 文件、124/124 通过；覆盖正式空结果、必审资料段、来源授权、幂等事务和迁移。
- `pnpm exec vitest run packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/web/test/quality.test.tsx`：3 文件、41/41 通过；覆盖 C22 持久化公开读、公共查询 Schema 与页面状态。
- `pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium`：生产构建通过，真实 Chromium 2/2 通过；覆盖登录、导航、质量查询、刷新、工程切换、键盘与拒权。
- `pnpm typecheck && pnpm deps:check && pnpm deps:policy && openspec validate deliver-quality-evaluation-module --strict --no-interactive`：全部退出码 0；`pnpm deps:check` 检查 441 模块、1296 依赖。
- 本次只改文档，未触发新的限定审计；已完成的唯一一次限定审计结果见上节。

## 剩余边界

- 甲方脱敏样例和目标环境尚未提供；报告仅证明合成样本的测量与授权链路。
- 既有 C04 对缺失和拒权采用同形安全失败，C36 在样例级保留未核验证据诊断，不以缺失推断通过；若未来要区分原因，需单独批准拥有方契约与报告处置规则。
- 本轮不归档、不合并到主线。
