本 change 为剩余实现与真实功能取证，当前进度以以下任务勾选及 handoff.md 最新证据为准。任务 checkbox 只在行为与本次证据均成立后勾选。C38 F-01–F-05 是范围移交，不计当前 task；固定检查点和验收不由 CLI 工件存在性替代。

接续依赖：先完成 `reduce-defensive-design-overhead` 的实现及回归，再按新语义继续本清单。当前5/19保持；已完成输入和阶段复用，旧终态失败保留。下文历史“精确授权/完整性”按新入口检查和普通消费语义执行，专业质量与事务要求保持。

## 1. 来源与环境

- [ ] 1.1（IP-17）核对前置实现检查点、当前配置/发布/迁移/秘密与隔离实例，补齐实际输入身份清单；验证：`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs packages/adapters/test/deployment/config-operations.test.ts`，并记录真实配置、release、000058 与 synthetic-acceptance purpose；缺项不填默认值。
- [ ] 1.2（IP-17）用正式 C19 成员、C24 路线及 C30 空间补证现有通路，修已批准范围内来源缺陷；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/assessment-composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs`，另记录错版/异空间/无权的实际拒绝及正式来源引用。

## 2. 完整 Electron 场景

- [x] 2.1（IP-18）按 D-28 在既有 acceptance.mjs 补 strict 测试输入与预检，扩展 client.spec.ts 的共享对象、登录、上传下载、撤权、证书拒绝、导航、SSE 重连及任务继续；验证：`pnpm exec playwright test -c playwright.desktop.config.ts --list` 核对全部场景定义，不能仅保留两条基础用例。2026-10-14 已定义 12 项场景/自检，预检边界自检通过；功能实跑留在 2.2，输入及工程证据见 evidence/readiness.md。
- [ ] 2.2（IP-18；依赖 1.1/2.1，业务对象来自 3.1/3.2）在当前平台真实 Electron 和功能 HTTPS 实跑全部场景；验证：`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm exec playwright test -c playwright.desktop.config.ts`，保存版本和失败 trace，无关键 skip。

## 3. 正式业务运行

- [ ] 3.1（IP-19；依赖 1.1/1.2）以 MinerU V2 合格材料及真实 C04/C11 新版本完成资料、策略/配置审核发布、检索构建和质量门禁，按同次回执绑定现场/来源；验证：`pnpm acceptance:synthetic check --pack <批准包>`、`node scripts/deployment/provision.mjs --config <实际预置配置> --output <新报告>` 及正式模块引用；旧临时响应不能充作生产登记。
- [ ] 3.2（IP-19；依赖 3.1）从完整合置宿主执行识别/复核、评估/预警、处置建议/人工决定、执行反馈、五类任务及会话流，记录预算、权限、错误和正式结果；验证：`RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts` 与施工图 V4；真实业务不能用 adapter smoke 替代。

## 4. 终态与安全报告

- [ ] 4.1（IP-20；依赖 3.2）补完整同次 functional 观察配置和正式查询引用索引，仅在出现可复现缺陷时修既有观察器；验证：`pnpm exec vitest run scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs`，核对等待、超时、缺引用、异运行及不支持 DTO 均非 PASS。
- [ ] 4.2（IP-20；依赖 4.1）运行 `node scripts/acceptance/functional.mjs --pack <批准包> --config <实际functional配置> --output <新证据目录> [--resume]`，逐项核对正式终态、精确来源/模型/配置/审计/C04 引用和 RI/RA 双向追踪，报告不含秘密、Cookie、正文或思考内容。

## 5. 可见交互与故障边界

- [ ] 5.1（IP-21；依赖 2.2/4.2）先闭合本次慢读/切工程 aborted=0 和重评确认按钮不可点击的 browser 回归缺口，再在可见外部 Chrome 完成真实登录、正式确认、拒权、跨页追溯与桌面对齐；验证：`pnpm test:browser` 全部通过，另保存实际可见窗口的操作/版本/结果引用，headless 不替代此证据。
- [ ] 5.2（IP-21；依赖 4.2）在隔离实例取证事实提交后回执失败重投、SIGTERM/同发布重启、原身份续接及取消零写；验证：`pnpm exec vitest run packages/adapters/test/workflow/postgres-workflow-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts scripts/deployment/risk-flow-composition.test.mjs scripts/deployment/lifecycle.test.mjs` 及实际重启/重投报告。
- [ ] 5.3（IP-21；依赖 4.2）以原运维权限完成适用维护、逻辑副本、新根恢复、双索引重建和人工兼容/不兼容回退核验；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs scripts/deployment/restore.test.mjs` 和 OPERATIONS.md 原命令的隔离实跑，保留旧实例/双根。人为损坏注入属于独立运维核验，不作为本轮正常业务链通过条件。

## 6. 收口

- [ ] 6.1（IP-22；依赖全部功能场景）同步 ACCEPTANCE/OPERATIONS 与本 change 安全证据索引，核对每个 Requirement/Scenario/IP、原任务与 F-ID，无遗漏或把未完成列成通过；验证：`pnpm exec openspec validate complete-private-deployment-functional-acceptance --strict --no-interactive`、`git diff --check` 和逐场景实际报告。
- [ ] 6.2（IP-22；依赖 6.1）运行 `NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`、`pnpm test:browser`、`pnpm test:deployment`，记录实际结果并闭合门禁；原已归档规格 strict 失败按责任范围解决，不删 strict 或静默忽略；按授权形成固定实现检查点。
- [ ] 6.3（IP-22；依赖 6.2）由 Finalizer/必要一次限定审计完成核验、范围内修复与回归，再创建 verification.md；验证：最终 HEAD 与实际证据一致，security/persistence/integration 及必要 performance 审计完成，无当前缺陷、缺证据或待审计的 PASS。

## 7. 已批准原件与Agent修正

- [x] 7.1（IP-19/D-36）完成原件JSON/二进制窄读、真实名称/可选上传文件名、历史/失败转换/当前权限和C04完整性；通过所属adapter、HTTP及宿主定向测试。
- [x] 7.2（IP-21/D-36/D-37）完成默认原件视图、PDF/位图/文本预览与Office原件下载，接唯一Agent侧栏/工作台/详情及候选校验；通过相关Web回归并在物理Chrome使用原实例资料取证。
- [x] 7.3（IP-19/D-38）修C17准备范围/逐组身份/验证工件隔离及pending复核动作，既有数据库与宿主回归通过并取得正式送审/决定/发布回执。
- [x] 7.4（IP-18/D-36/D-37）接Electron批准同源原件保存与PDF/Agent共享查看，真实当前平台操作、撤权/越界拒绝和字节一致性留证；不以headless替代。

## C38 最终交付移交

## 8. 已批准C19正式入口

- [ ] 8.1（IP-17/IP-19/D-39；接续减负D-13）沿正式组装入口和新派生发布语义复验C19/C11/C18/C16，验证当前权限、准备/配置、重复提交及冲突处理；基础合成评分内容保留人工审核，物理Chrome经确定性组装自动形成发布及评估依据留证。

F-01–F-05 的完整条目见 handoff.md；签名/三平台安装、完整远程 host、禁网三 VM、模型/OCR/系统介质、4090 与辅助 GPU、合同材料均未因本 change apply-ready 而执行或通过。
