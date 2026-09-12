## 1. 契约门与验收夹具

- [ ] 1.1 [IP-01] 在实现前确认两个知识定义类型、复数识别准备、C15 正式 `readBoundResult` 及 `implement-engineering-data-read-branches` 均已归档集成，并运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`；任一 D-01 门不满足立即升级，不修改上游所有权文件。
- [ ] 1.2 [IP-01] 新增真实 PostgreSQL/C03/C04/C06/C07/C08/C16/C15 组合 fixture 和五类严格知识包 builders，运行 `pnpm exec prettier --check packages/adapters/test/identification-knowledge/fixture.ts` 验证格式与文件可读。

## 2. Core 契约与确定性逻辑

- [ ] 2.1 [IP-02] 实现五类识别知识包、validation/revision/release binding、authoring manifest/increment/failure 和注入策略/provider 的 strict Schema，并增加 core subpath export；运行 `pnpm exec tsc -b packages/core --pretty false` 验证类型。
- [ ] 2.2 [IP-02] 实现五工序、六机理、引用/关系/时间环、证据、关键工序覆盖和三成员组合的逐项确定性校验，运行 `pnpm exec vitest run packages/core/test/identification-knowledge.test.ts` 验证代表性接受/拒绝边界。
- [ ] 2.3 [IP-02] 实现目标类型化增量应用和 `createKnowledgeAuthoringTaskDefinition`，确认没有 JSON Patch/整对象/发布操作并再次运行 `pnpm exec vitest run packages/core/test/identification-knowledge.test.ts`。

## 3. Adapter、迁移与治理组合

- [ ] 3.1 [IP-03] 将 C16 `resolveGovernedReleases()` 的固定评估分支改为纯识别族/纯评估族显式映射并拒绝混合族，运行 `pnpm exec vitest run packages/core/test/knowledge-governance/knowledge-governance.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` 证明真实 C06 识别授权和既有评估逐字段行为。
- [ ] 3.2 [IP-04] 新增自动发现的 `000020_identification_knowledge_governance` 四表迁移、约束和最小角色权限，并更新迁移发现期望；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` 验证 up/down、顺序和权限，保持 `000021`～`000023` 未使用。
- [ ] 3.3 [IP-05] 实现 `PostgresIdentificationKnowledgeAdapter` 的审核包 validation→C16 revision→binding、送审/发布/停用/回滚门和精确 release reader，并增加 adapters subpath export；运行 `pnpm exec vitest run packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts` 验证人类发布、Agent 拒绝、分阶段恢复和下游有界读取。
- [ ] 3.4 [IP-06] 实现精确准备→C16 双时间三发布→组合三成员→C21/C24 policy provider 的 `identification-basis` 解析，运行 `pnpm exec vitest run packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` 验证成功四引用、成员停用/错工程/错类型、策略缺失和机理不一致均 fail-closed。
- [ ] 3.5 [IP-07] 实现 authoring manifest/task 准备、两个只读工具、成功 finalizer 和 terminal/cancel failure→diagnostic→failure-only revision→C07 review 的阶段收口，运行 `pnpm exec vitest run packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts` 验证当前授权、幂等恢复、一次复核及失败不可发布。

## 4. API / Worker 接入

- [ ] 4.1 [IP-08] 新增 knowledge-authoring model callback/解释器和包装 shared runner 的 `KnowledgeAuthoringRunner`，只在目标 task type 接管并导出组合入口；运行 `pnpm exec vitest run apps/worker/test/identification-knowledge/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` 验证工具→候选→修订、预算/模型/工具/租约/取消失败复核及其它任务不漂移。
- [ ] 4.2 [IP-05、IP-09] 以 C17 façade 作为 generic knowledge port 验证既有 API 路由，无新增 URL/DTO；运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts`，不得修改 `apps/api/src/http.ts` 或用路由特例绕过 façade。

## 5. Web 边界

- [ ] 5.1 [IP-09] 确认本 change 不实现界面且 `git diff --quiet -- apps/web` 返回成功；不得启动开发服务器或加入开发说明、占位 UI。

## 6. 最小必要验证

- [ ] 6.1 [IP-02～IP-09] 运行定向行为组 `pnpm exec vitest run packages/core/test/identification-knowledge.test.ts packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/postgres/postgres-foundation.test.ts apps/worker/test/identification-knowledge/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts apps/api/test/http-shell.test.ts`，所有稳定契约场景通过。
- [ ] 6.2 [IP-09、IP-10] 运行 `pnpm build && pnpm typecheck && pnpm deps:check && pnpm deps:policy`，确认包导出、类型、依赖方向和依赖策略通过且锁文件无变化。
- [ ] 6.3 [IP-02～IP-10] 运行 `pnpm exec eslint packages/core/src/identification-knowledge packages/core/test/identification-knowledge.test.ts packages/adapters/src/identification-knowledge packages/adapters/test/identification-knowledge apps/worker/src/identification-knowledge apps/worker/test/identification-knowledge` 及 implementation-plan V-08 的完整 `prettier --check` 命令，修正本 change 文件的静态与格式问题。

## 7. OpenSpec verify

- [ ] 7.1 [IP-10] 运行 `openspec validate deliver-process-model-mechanism-and-evidence-governance --type change --strict --no-interactive && openspec instructions apply --change deliver-process-model-mechanism-and-evidence-governance --json`，完整读取返回的全部 `contextFiles`，逐项核对每个 Requirement/Scenario、允许文件和验证义务均可反向定位到 IP-01～IP-10。
- [ ] 7.2 [IP-10] 在全部实现任务、命令证据和 checkbox 完成后使用项目 `openspec-verify-change` 流程独立验收；未验证通过不得归档，本任务本身不提交或归档。
