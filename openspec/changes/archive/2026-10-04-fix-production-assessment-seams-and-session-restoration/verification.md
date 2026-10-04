# 独立验收：fix-production-assessment-seams-and-session-restoration

## 验收对象与结论

- 输入实现 HEAD：`07c9ef3f71518b9549176d8233c4bb6996f471ed`；规划基线：`e26ca45db5d124793b1c323ac83687f629913a3f`。
- 验收日期：2026-10-04；主验收 Agent：Codex。三个有界并行子任务均使用 `gpt-6-luna`，主 Agent 完成未闭合部分的检查、修复集成和最终验证。
- 验收对象为输入 HEAD 加本轮未提交修改；没有创建新的 Git 检查点、切换分支或归档。
- **结论：PASS（本 change 的代码行为及文件范围）。** 原实现报告未作为独立事实。授权读取、预测失败语义／结果契约、会话恢复及正式输入单位缺陷均已修复并复验；用户明确要求继续直接修复后，D-05 请求和 IP-07 施工图已补齐，§7 表外范围逐项完成审阅。
- 15 项任务仅在本轮行为及证据义务完成后勾选。CLI 的工件 ready 或 all_done 不作为行为证据；本结论不表示已提交、已归档或完成 C34 交付。

范围为本 change 的 D-01～D-12、IP-01～IP-12。模型、规则、措施与工程数据为**合成样本、待甲方复核**，不构成甲方精度验收。C34 的依赖／基线更新、业务装配及 17 页验收仍归原 change。

## 1. 独立发现与处理

| 问题                                                                                 | 规格／IP              | 处理与证据                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标准记录 reader 没有核对证据来源版本属于原记录登记范围                               | D-02/04；IP-02        | 两 owning reader 均核对证据来源集合；真实 PostgreSQL 回归通过                                                                                        |
| null/undefined 请求或非法 requestId/requestedAt 在失败信封构造中抛异常               | D-01/04；IP-01～03    | 使用已有 Identifier／IsoDateTime Schema 安全构造类型化失败，表驱动回归通过                                                                           |
| 来源及证据身份用分隔符拼接，可产生碰撞                                               | D-02/03；IP-02/03     | 用 JSON tuple 比较身份，reader 及真实依据装配回归通过                                                                                                |
| 模型读取把权限、完整性、契约、预算和技术错误全部吞成不可用                           | D-05/06；IP-07        | 只有精确引用不存在返回不可用；其它错误保留失败类别。校验 MIME、预算、工程与 UTF-8，失败关闭读取并观察 verified promise                               |
| 非法计算和 C25 失败被降级为业务不可用                                                | D-05/07/08；IP-05～07 | 合法输入不足使用固定原因码；非法计算失败，C25 ModuleError 传播至 C28，不保存成功预测                                                                 |
| 执行器改动原成功 result，并修改了受保护结果校验器                                    | D-05；IP-06/07        | 恢复原 result 和 verifyForecastExecutorResult，新增规定的 available/unavailable outcome，由 C28 解包后复验；service.ts 相对规划基线无 diff           |
| 请求改为 caller，缺少设计规定的 issuedAt、idempotencyKey、authorization，措施仅传 ID | D-05；IP-07           | 恢复 projectId，传入已验证授权、命令时间／幂等键及原 MeasureItem[]；C25 投影继续使用受控上下文                                                       |
| 模型读取走 measure-candidates／retrieve，偏离设计规定的 assessment-basis／read       | D-08；IP-07           | 修正分支与 capability，投影 invocation 对齐 commandId:forecast-risk-state；真实 C06/C04/C25 执行器 7/7 通过                                          |
| 模型输入指标未与策略集合核对；历史模型禁止重复系数及目标指标作为输入                 | D-06/07；IP-06/07     | 核对集合，移除无设计依据的模型限制；真实非法输入不写事实，合法模型纯算法回归通过                                                                     |
| 两套前端深链回跳丢失 hash，demo 返回目标校验不足                                     | D-11；IP-10/11        | 保留 pathname/search/hash，共用站内返回目标校验；真实浏览器回归通过                                                                                  |
| 自省响应解码接受非法引用、布尔、日期或额外 token                                     | D-11；IP-09/10        | 严格解码，畸形 200 保持可重试失败；apps/web 复用正式 Schema，demo 不新增依赖；真实浏览器重试成功                                                     |
| demo 已过期注销 401 保留旧会话，重复注销可能忽略有效响应                             | D-11；IP-10           | 401 确认失效；在途注销去重／禁用，技术失败保持会话供重试；真实注销及丢响应回归通过                                                                   |
| demo 旧登录／改密请求虽被代次丢弃，表单仍执行回跳                                    | D-11；IP-10           | 请求取消及代次校验，操作返回是否被接受，表单只为被接受的操作回跳                                                                                     |
| **模型声明的输入单位与正式指标单位不符，仍保存 available 预测**                      | D-06/07；IP-07        | C28 从冻结 indicator-system 补入 baseline.indicatorValues.unit，执行器求值前精确匹配；真实错误单位回归已通过，且无预测／实际事实、成功审计或回执残留 |

单位缺陷的根因是正式单位没有传递到执行器。D-05 现已定义 baseline.indicatorValues.unit 来自同次冻结指标体系，非数值或缺少定义不带单位；执行器核对每个模型输入，缺失或不符沿既有契约失败。模型与指标体系都是原精确版本，不读取最新配置或转换单位。用户在本轮明确要求直接修复，已同步 design、IP-07 施工图及 delta spec。

修复没有新增依赖、数据库迁移或实际评估写入路径。测试扩展覆盖可观察的授权、值、失败、事务和路由行为。

## 2. 场景核对

| 范围               | 本轮独立证据                                                                                                                                                             | 结论                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| IP-01～04          | XOR、六标量、精确范围与证据、当前授权、来源映射、两种输入真实冻结／评估、C15 清洗与 C19 审核发布／resolve；reader/basis 最终 22/22，所属回归通过                         | PASS                                  |
| IP-05～07          | 冻结依据只读投影、三算法、缺槽／边界、诚实不可用与失败、原结果联合、C28 原子／幂等；E-P 未变的四文件 123 条已通过，本轮相关两文件 38/38 通过，含输入单位拒绝及零事实残留 | PASS                                  |
| IP-08～09          | 无 token 自省、受限会话、期限／撤销／密码版本、Cookie 与状态码／no-store、OpenAPI；所属回归及严格 Web 解码 7/7                                                           | PASS                                  |
| IP-10～12 会话行为 | 恢复前无业务请求、完整深链、受限改密刷新、失败重试、认证代次、注销失败／确认失效；真实浏览器 8/8 与 17/17                                                                | PASS                                  |
| IP-12 完整移交     | D-05／IP-07 单位契约已闭合，§7 精确代码／测试清单与实际 67 个源文件一致；验收对象明确为 HEAD 加未提交修复                                                                | PASS（后续 Git 检查点及归档另行处理） |

PASS 适用于列明行为、证据及已闭合的文件范围；不表示已提交、已归档或完成 C34 交付。

## 3. 本轮实际运行证据

E-R/E-P/E-S/E-H/E-W 的精确命令索引见 implementation-plan.md §1。以下不继承原 Agent 的次数、时长或结论。

| 检查                                                              | 实际结果                                                                                                                                                                                            | 日志                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 独立初轮 E-R/E-P/E-S/E-H 去重，加真实依据及清洗 store，共 20 文件 | 17 文件通过，3 文件／13 条失败，393 条通过；508.76s。失败已定位并逐项复验                                                                                                                           | `/tmp/riskflow-independent-vitest.log`                                                           |
| 最终 reader 与真实依据合跑                                        | 2 文件／22 条通过；65.95s                                                                                                                                                                           | `/tmp/riskflow-final-reader-basis.log`                                                           |
| 所属其余回归，加 API quality 与清洗 store                         | 13 文件／234 条通过；161.51s                                                                                                                                                                        | `/tmp/riskflow-final-unchanged-regressions.log`                                                  |
| E-P 修复后合跑                                                    | 5 文件通过，1 文件中本轮新增故障夹具的摘要引用不合法；160/161，306.11s。将该夹具改为真实发布工件引用后复验                                                                                          | `/tmp/riskflow-final-forecast-repaired.log`                                                      |
| 最终执行器真实授权回归                                            | 1 文件／7 条通过；84.14s。覆盖三方法、模型非法、输入集合／库版本、权限／完整性／技术失败、零实际事实写入；早于新增单位复现用例                                                                      | `/tmp/riskflow-final-executors-authorization.log`                                                |
| 输入单位缺陷修复前复现                                            | `pnpm exec vitest run packages/adapters/test/response-lifecycle/forecast-executors.test.ts -t '模型措施库' --reporter=verbose`；1 条失败，6 条按筛选未运行；51.95s。expected failed，实际 succeeded | `/tmp/riskflow-input-unit-reproduction.log`                                                      |
| Web 严格解码追加复验                                              | 7/7；713ms                                                                                                                                                                                          | `/tmp/riskflow-final-api-client.log`                                                             |
| apps/web 真实 Chromium                                            | 指定 quality.spec.ts；8/8，43.8s                                                                                                                                                                    | `/tmp/riskflow-final-web-browser.log`                                                            |
| demo 真实 Chromium                                                | 指定 read-only.spec.ts，--retries=0；17/17，59.1s                                                                                                                                                   | `/tmp/riskflow-final-demo-browser.log`                                                           |
| 生产构建                                                          | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm --dir demo build` 均通过                                                                                                                 | `/tmp/riskflow-final-build.log`、`/tmp/riskflow-final-demo-build.log`                            |
| 类型检查                                                          | 默认堆首次 OOM exit 134；以 8 GiB 重跑 `pnpm typecheck` 通过，最终修改后再次通过                                                                                                                    | `/tmp/riskflow-final-typecheck-8gb.log`                                                          |
| lint、依赖边界、依赖策略                                          | `pnpm lint`、`pnpm deps:check`、`pnpm deps:policy` 均通过；482 modules／1440 dependencies                                                                                                           | `/tmp/riskflow-final-lint.log`、`/tmp/riskflow-final-deps.log`、`/tmp/riskflow-final-policy.log` |
| 格式、规格、差异                                                  | pnpm format:check、openspec validate --strict --no-interactive、git diff --check 均通过                                                                                                             | /tmp/riskflow-final-format.log、/tmp/riskflow-final-openspec.log                                 |

用户授权继续修复后的证据：

| 检查                         | 实际结果                                                                                                                                                                                                                                                                               | 日志                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输入单位及 C28 最终回归      | `pnpm exec vitest run packages/adapters/test/response-lifecycle/forecast-executors.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts --reporter=verbose`；2 文件／38 条通过，293.10s；含错误单位、三方法、原子／幂等、旧版本及实际事实隔离 | `/tmp/riskflow-unit-regression.log`                                                                                                                                                                |
| 移除全局异常吞捕后真实浏览器 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/quality.spec.ts --retries=0`；8/8，52.5s                                                                                                                                                   | `/tmp/riskflow-unit-web-browser.log`                                                                                                                                                               |
| 本轮生产构建与静态检查       | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` 与 `pnpm typecheck`、lint、format:check、deps:check、deps:policy 全通过；OpenSpec 严格校验与 diff 检查亦通过                                                                                                                       | `/tmp/riskflow-unit-build.log`、`/tmp/riskflow-unit-typecheck.log`、`/tmp/riskflow-unit-lint.log`、`/tmp/riskflow-unit-format.log`、`/tmp/riskflow-unit-deps.log`、`/tmp/riskflow-unit-policy.log` |

reader/basis 命令为：
`pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts packages/adapters/test/risk-assessment/production-assessment-basis.test.ts --reporter=dot`。

所属其余回归的 13 个文件为 contracts/module-interfaces-events-workflows、core engineering-data/context-source、core scoring-rules、adapter context-source registry、adapter scoring-rules、core access、adapter auth、worker cleaning composition、API http-shell、Web api-client-openapi／ssr-shells、API quality、adapter cleaning store；完整原始执行输出保留在对应日志。

生产接缝使用真实 PostgreSQL、C04、C06 与 HTTP；畸形响应和错误注入仅用于失败路径。浏览器成功恢复、登录与改密均由真实服务端处理。另一次范围外全 demo 套件在 C34 assessment-warning-response 的 afterAll 容器收尾超时，不计作本 change 行为证据；所属 read-only.spec.ts 独立完成，不宣称全部 demo 套件通过。

## 4. 文件范围

相对规划基线，原报告的“6 个表外文件”实际为 6 个条目、7 个文件。受保护的 packages/core/src/response-lifecycle/service.ts 已恢复到规划基线原实现，相对基线无 diff。

用户明确要求继续直接修复后，以下六文件的职责逐项核对并纳入 design D-12 与施工图 §7：

| 文件                                                                                                   | 范围决定                                                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| packages/adapters/src/postgres/pool.ts                                                                 | 所属连接池监听空闲连接 error；在途查询仍按原错误映射处理，不使用浏览器全局异常吞捕 |
| packages/adapters/src/response-lifecycle/forecast-model-reader.ts                                      | D-05～08 的所属有界受权读取 helper；模型验证、verified 消费和错误分类集中在此      |
| packages/adapters/test/risk-assessment/production-assessment-basis.test.ts                             | IP-04 的真实依据及两种 XOR 正式评估证据                                            |
| apps/api/test/quality.test.ts                                                                          | IP-08/09 的完整 access stub 机械适配                                               |
| demo/test/browser/assessment-warning-response.spec.ts、demo/test/browser/identification-review.spec.ts | IP-10/12，仅登录助手适配已有 Cookie 的启动恢复，业务装配及 C34 工件不扩展          |

apps/web/test/browser/server.mjs 的既有风险种子字段补齐也已明确纳入 §7，遵守原正式记录的空间／来源／证据契约。本轮删除其全局 uncaughtException 处理及 teardown 标志，错误只由所属连接池处理；真实 Chromium 8/8 通过。

以规划基线对比当前代码／测试清单，共 67 个实际变更源文件，均在 §7；没有新依赖、迁移、C34 工件或保护模块的额外变更。用户的修复授权没有用于 Git 提交、分支切换或归档。

## 5. 限定审计结论

| 标签                    | 结论                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-SCOPE              | PASS：owning reader、真实依据与所属授权回归通过；模型读取使用规定的 assessment-basis/read 分支，权限失败不再降级                   |
| FORECAST-FACT-ISOLATION | PASS：三类方法消费正式输入，输入单位不符安全失败；合法及非法预测均不新增实际评估／值集合／预警，非法预测不留下成功事实／审计／回执 |
| SESSION-RESTORATION     | PASS：严格解码、完整深链、受限刷新／改密、重试及注销行为经真实浏览器复验                                                           |

本轮主 Agent 使用三个有界原生子任务，未使用 Orca 或跨项目线程。授权任务完成独立结论；预测与会话未闭合部分由主 Agent 接管，在本轮集成及复验，没有再创建新的限定审计轮次。

## 6. 后续边界

本轮发现的代码缺陷与文件范围均已闭合，无待用户决定的实现问题。验收对象仍为输入 HEAD 加当前未提交修复；获授权提交后可固定新的 Git 验收检查点，再按既有同步／归档流程处理。

甲方输入到位后另做真实精度验证。C34 的依赖／基线与 17 页验收继续其自身工作，本结论不替代该交付。
