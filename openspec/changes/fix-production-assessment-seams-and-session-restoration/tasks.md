## 1. 统一风险事实生产读取

- [x] 1.1 实施 IP-01：共享字段 Schema、strict 读取请求及 XOR 组合工厂；验证 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` 与 `pnpm typecheck`。
- [x] 1.2 实施 IP-02：正式标准记录 owning reader，覆盖精确版本、六标量、验收及作用域拒绝；创建所属 reader 测试后验证 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts`。
- [x] 1.3 实施 IP-03：外部结构化工件和 owning reader，保持原登记能力并验证证据、权限、预算；验证 `pnpm exec vitest run packages/core/test/engineering-data/context-source.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts`。
- [x] 1.4 实施 IP-04：C11 复用有界来源映射，将当前复验 grant refs 解析为精确 source-version refs 并传入事实授权；C25 按已复验 preparation binding 传入空间／来源，两端校验下游资源范围。复用共享评估 fixture 的最小 reader／basis reader 注入，完成真实 C19 装配、两种 XOR 的准备冻结／输入冻结／正式评估及持久回读；覆盖入口缺来源、撤权、映射歧义与范围扩张的 AUTHORIZATION_DENIED 和无成功业务写入。先运行 `pnpm build`，再验证 `pnpm exec vitest run packages/adapters/test/risk-assessment/postgres-risk-input-facts-reader.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`，回读正式记录及真实回执/审计。1.2/1.3 按各自完整行为及指定验证通过后勾选，局部通过不替代本项完成。

1.4 先修复 C19 准备投影：收窄为 design D-12 六字段、去除 reader 的 requiredAt，并在 C11 实现原 C19 身份下的生产读取；共用 C25 准备读取的所属解析及保存范围复验。C19 assemble/resolve 使用真实准备值与 C18 解析结果核对身份／配置／兼容绑定；不得补清洗字段、改读 identification 准备或注入投影闭包。补齐施工图 §6 的准备读取及配置错配证据，并在 build 后运行 `pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`。已提取的 `createCleaningPipelineFor` 保留，仍只用于规则编制来源链；共享 helper 回归遵循 §7。

## 2. 冻结依据投影与三类参数预测

先完成 1.4 的真实 C15/C19 依据装配及两种 XOR 集成验收，再推进 2.1 和 2.3/2.4；2.2 的纯算法可独立实现。1.4 使用合成资料经真实清洗收口、C19 编制、C16/C07 审核发布和 resolve 返回实际 basisRef；不能以 startTask 播种或直接调用 appendRelease 替代清洗／发布事实。共享 cleaning/scoring helper 修改时补其施工图 §7 指定的受影响回归。

- [x] 2.1 实施 IP-05：收窄评分上下文并实现 C25 预测风险状态端口，覆盖跨评分边界、精确基线、监测身份与零实际写入；验证 `pnpm exec vitest run packages/core/test/risk-assessment/engine.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`。
- [x] 2.2 实施 IP-06：模型与 outcome Schema、十进制除法和三类纯参数算法，覆盖缺槽、退化、边界及有界窗口测量；验证 `pnpm exec vitest run packages/core/test/response-lifecycle/response-lifecycle.test.ts packages/core/test/response-lifecycle/forecast.test.ts`。
- [x] 2.3 实施 IP-07：部署执行器工厂使用真实 C04 模型和 C25 投影，三类方法分别得到预测值及变化的风险状态；验证 `pnpm exec vitest run packages/adapters/test/response-lifecycle/forecast-executors.test.ts` 与 `pnpm deps:check`。
- [x] 2.4 收口 IP-07：C28 组装正式措施和受权身份、解包 outcome，迁移既有 executor 工厂，验证不可用、原子失败、幂等和旧模型重算；验证 `pnpm exec vitest run packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts packages/adapters/test/response-lifecycle/forecast-executors.test.ts` 与 `pnpm typecheck`。

## 3. 服务端会话自省与两套客户端恢复

- [x] 3.1 实施 IP-08：C06 无 token 会话 view/readSession，受限会话、idle/absolute、停用和版本失效，补完整接口 stub；验证 `pnpm exec vitest run packages/core/test/access.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/worker/test/engineering-data/cleaning/composition.test.ts`。
- [ ] 3.2 实施 IP-09：Cookie GET 自省、系统目录/OpenAPI 和生产 Web GET 客户端，验证所有响应 no-store 及 200/400/401/503/500 分离；验证 `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/web/test/api-client-openapi.test.ts`。
- [ ] 3.3 实施 IP-10：demo 启动恢复、受限改密、技术失败重试、认证代次与注销失败收口；验证 `pnpm --dir demo build`，浏览器行为证据在 4.1 完成前不得宣称该路径验收通过。
- [ ] 3.4 实施 IP-11：apps/web 保持 checking 初态、复用 revision guard 并提供恢复失败重试；验证 `pnpm exec vitest run apps/web/test/ssr-shells.test.tsx apps/web/test/api-client-openapi.test.ts` 与 `pnpm build`，浏览器行为证据在 4.1 收口。

## 4. 真实浏览器与收尾证据

- [ ] 4.1 实施 IP-12：两套现有 harness 仅增加真实受限账号，完成 reload、精确深链、匿名回跳、受限改密、恢复503重试、迟到认证和 demo 注销失败；先运行 `pnpm build`、`pnpm --dir demo build`，再验证 `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/quality.spec.ts` 与 `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/read-only.spec.ts`。
- [ ] 4.2 完成 IP-12 相关回归：按施工图 E-R/E-P/E-S/E-H 运行所属单测与 PostgreSQL 集成测试；验证 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy` 与 `openspec validate fix-production-assessment-seams-and-session-restoration --strict --no-interactive`。记录无法执行或失败的具体证据，不 skip 关键场景。
- [ ] 4.3 完成 IP-12 验收移交：Finalizer 按最终实现检查点核对施工图 §6 每个场景、§7 文件及三项限定审计标签，修复已批准范围内缺陷并创建 verification；用 `openspec status --change fix-production-assessment-seams-and-session-restoration --json` 核对工件与任务状态。确认真实评估链和三算法证据成立、无实际事实污染，再由原 C34 change 更新依赖／基线继续 4.1d；本任务不授权 Git 提交或接管 C34 装配。
