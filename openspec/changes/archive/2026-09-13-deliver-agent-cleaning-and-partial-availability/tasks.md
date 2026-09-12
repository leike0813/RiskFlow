## 1. 契约门与夹具

- [x] 1.1 [IP-01] 在实现前确认 `evolve-identification-preparation-segment-set-refs` 与 C13 均已归档并集成、复数 `includedSourceSegmentSetRefs` 可由 contracts strict parse，且 C13 仍输出 C12 `ocr-layout` 契约；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts` 验证，任一门不满足立即升级。
- [x] 1.2 [IP-01] 新增四类文档、OCR 兼容结构和地表沉降快照的复用型 cleaning fixture；运行 `pnpm exec prettier --check packages/adapters/test/engineering-data/cleaning/fixture.ts` 验证文件格式。

## 2. Core

- [x] 2.1 [IP-02] 实现 C15 strict 策略、冻结清单、引用级候选和结果 Schema，并增加 core 子路径导出；运行 `pnpm exec prettier --check packages/core/src/engineering-data/cleaning packages/core/package.json` 验证格式。
- [x] 2.2 [IP-02] 实现逐项排除校验、关键数值保护、三级可用性收口和 `data-cleaning` C08 definition，并以表格驱动测试覆盖 IP-02 场景；运行 `pnpm exec vitest run packages/core/test/engineering-data/cleaning.test.ts` 验证。

## 3. Adapter

- [x] 3.1 [IP-04] 使用协调端预留号段新增 `000016` 两张只追加表及约束，更新迁移自动发现回归期望；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` 验证迁移发现与顺序。
- [x] 3.2 [IP-03] 实现精确转换/快照准备、C04 manifest、C08 task 重放及两个有界只读工具，并增加 adapter 子路径导出；运行 `pnpm exec prettier --check packages/adapters/src/engineering-data/cleaning packages/adapters/package.json` 验证格式。
- [x] 3.3 [IP-03、IP-04] 实现确定性 finalizer、正式结果工件/索引、任务结果双向绑定、权限复验和幂等恢复；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts` 验证清洗适配器场景。
- [x] 3.4 [IP-05] 在 C11 `freeze()` 中只增加 `identification-preparation` 分派，并原子提交复数 segment-set 准备快照、审计、收据和单条 inputs-ready Outbox；运行 `pnpm exec vitest run packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 验证成功、阻断、回滚和既有 monitoring 分支。

## 4. API / Worker

- [x] 4.1 [IP-07] 保持 API 通用 freeze 传输不变；运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts` 验证无需新增路由且错误/成功联合仍透传。
- [x] 4.2 [IP-06] 为现有 C08 runner 增加 data-cleaning 渲染/解释组合函数和协议测试，覆盖工具、候选、预算/模型/授权失败及自动收口；运行 `pnpm exec vitest run apps/worker/test/engineering-data/cleaning/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` 验证仍使用同一 runner。
- [x] 4.3 [IP-09] 在 Worker 唯一生产组合根实现 `createPostgresDataCleaningComposition()`：让 store 提交无授权启动草案与精确 scope/source refs，经真实 C06 exact branch 签发唯一 `agent-task.start` 上下文后 strict 调用同一 C08 adapter，并给 adapter 注入同一个 C06 verifier；删除 adapter fixture 手工追加 capability，运行 `pnpm exec vitest run apps/worker/test/engineering-data/cleaning/composition.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`，断言授权请求、任务信封、C06/C03 审计成立且授权拒绝时 C08 task 数为 0。

## 5. Web

- [x] 5.1 [IP-07] 保持 Web 无 C15 代码或文案变更；运行 `git diff --name-only 5c49f20e615c6507be40b5cc74f734fba4b4fb80 -- apps/web` 并确认输出为空。

## 6. 最小验证

- [x] 6.1 [IP-02、IP-03、IP-04、IP-05、IP-06] 运行 `pnpm exec vitest run packages/core/test/engineering-data/cleaning.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts apps/worker/test/engineering-data/cleaning/runtime.test.ts`，验证 C15 core→adapter→worker 主链。
- [x] 6.2 [IP-07] 运行 implementation-plan §6 的 contracts/C08/C11/C12/C14/PostgreSQL/API 回归命令，确认公共解析、任务状态机、迁移、文档转换、监测值/特征和通用 freeze 无漂移。
- [x] 6.3 [IP-08] 依次运行 `pnpm typecheck`、`pnpm lint`、implementation-plan §7.3 的 scoped Prettier 命令、`pnpm deps:check`、`pnpm deps:policy`、`pnpm test` 与 `git diff --check`；全部通过后核对实际改动仍在 allowlist 内。
- [x] 6.4 [IP-09] 运行 `pnpm typecheck`、`pnpm lint`、`pnpm exec prettier --check apps/worker/src/engineering-data/cleaning apps/worker/test/engineering-data/cleaning packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts packages/adapters/test/engineering-data/cleaning`、`pnpm deps:check` 与 `git diff --check`，确认新组合保持 worker→adapters→core/contracts 单向依赖且无新增依赖。

## 7. OpenSpec verify

- [x] 7.1 [IP-08] 运行 `openspec validate deliver-agent-cleaning-and-partial-availability --type change --strict --no-interactive` 和 `openspec instructions apply --change deliver-agent-cleaning-and-partial-availability --json`，确认 change 严格通过、全部 `contextFiles` 可读且每项实现证据已回填后，再交由 `openspec-verify-change` 独立验收；本任务不归档、不提交。
- [x] 7.2 [IP-09] 运行 `openspec validate deliver-agent-cleaning-and-partial-availability --type change --strict --no-interactive`、`openspec instructions apply --change deliver-agent-cleaning-and-partial-availability --json` 及 implementation-plan §7.3 的两个 `86ad03b...` 范围命令，确认新增 Scenario/IP/task 可追溯、生产/测试改动仅在 IP-09 allowlist、保护区命令无输出；本任务不归档、不提交。
