## 1. 契约门与验收夹具

- [x] 1.1 [IP-01] 在实现前确认独立 C15 drift change（公开 `PostgresDataCleaningStore.readExactPreparation()` + strict `route-decision` 快照）及 D-01 其它既有依赖均已归档集成，运行当时的 implementation-plan V-01；任一门不满足立即升级，不在 C17 修改 C15/C11/contracts。
- [x] 1.2 [IP-01] 把 C17 fixture 改为只消费 C15 public reader，删除准备表私有 SQL/宽松 payload view，并把关键路径早退改为会失败的 narrowing helper；运行 `pnpm exec vitest run --reporter=verbose packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts` 证明失败前置不能得到绿色结果。

## 2. Core 契约与确定性逻辑

- [x] 2.1 [IP-02] 收口五类包、binding、authoring manifest/increment/failure Schema，使 manifest 冻结正式准备/清洗/工具成员，并把 release policy 改为接收 `TransactionContextV1` 的 `IdentificationKnowledgeGovernancePolicyV1`；运行 `pnpm exec tsc -b packages/core --pretty false` 验证类型。
- [x] 2.2 [IP-02] 实现五工序、六机理、引用/关系/时间环、证据、关键工序覆盖和三成员组合的逐项确定性校验，运行 `pnpm exec vitest run packages/core/test/identification-knowledge.test.ts` 验证代表性接受/拒绝边界。
- [x] 2.3 [IP-02] 实现目标类型化增量应用和 `createKnowledgeAuthoringTaskDefinition`，确认没有 JSON Patch/整对象/发布操作并再次运行 `pnpm exec vitest run packages/core/test/identification-knowledge.test.ts`。

## 3. Adapter、迁移与治理组合

- [x] 3.1 [IP-03] 收口 C16 `#knowledgeResolutionBranch()` 及发布/回滚 transaction policy：同一 context 调 C17 policy，C17 policy 缺失关闭失败；运行当时的 implementation-plan V-04 证明真实 C06 识别授权、既有评估逐字段行为及事务接缝。
- [x] 3.2 [IP-04] 新增自动发现的 `000020_identification_knowledge_governance` 四表迁移、约束和最小角色权限，并更新迁移发现期望；运行 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` 验证 up/down、顺序和权限，保持 `000021`～`000023` 未使用。
- [x] 3.3 [IP-05] 实现正式准备 reader 和 `PostgresIdentificationKnowledgeReleasePolicy`，把 C17 release binding/组合事件移入 C16 publish/rollback 同一事务，删除内存 recorder 与 façade 发布后绑定；运行 implementation-plan V-03 验证人类发布、四成员零事件、组合唯一事件、失败全回滚、Agent 拒绝和下游窄读。
- [x] 3.4 [IP-06] 实现精确准备→C16 双时间三发布→组合三成员→C21/C24 policy provider 的 `identification-basis` 解析，运行 `pnpm exec vitest run packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` 验证成功四引用、成员停用/错工程/错类型、策略缺失和机理不一致均 fail-closed。
- [x] 3.5 [IP-07] 实现 manifest 成员冻结、tool-ref + 对象成员双层校验，以及既有 C06 start/read/submit/request-review 下的失败阶段 CAS；运行当时的 implementation-plan V-03/V-05 验证越界零读取、授权拒绝停在精确状态、重放一次复核及失败不可发布。第二轮规划新增的 C08/C16 公共接缝收口见 7.1。

## 4. API / Worker 接入

- [x] 4.1 [IP-08] 新增 `createPostgresIdentificationKnowledgeComposition`，显式组装 C03/C04/C06/C07/C08/C15/C16/C17、策略/provider、shared runner/model callbacks 和受信 human/system 授权来源并导出；运行 implementation-plan V-05 验证缺失依赖关闭失败、exact branch、工具→候选→修订、终态失败→C07 review 及其它任务不漂移。
- [x] 4.2 [IP-05、IP-09] 以 C17 façade 作为 generic knowledge port 验证既有 API 路由，无新增 URL/DTO；运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts`，不得修改 `apps/api/src/http.ts` 或用路由特例绕过 façade。

## 5. Web 边界

- [x] 5.1 [IP-09] 确认本 change 不实现界面且 `git diff --quiet -- apps/web` 返回成功；不得启动开发服务器或加入开发说明、占位 UI。

## 6. 最小必要验证

- [x] 6.1 [IP-02～IP-09] 运行 implementation-plan V-01～V-06；verbose 结果中关键发布、工具成员和失败复核场景均执行并完成最终状态/计数断言，不得以条件 `return` 或缺失依赖造成的未达路径作为绿色证据。
- [x] 6.2 [IP-09、IP-10] 运行 `pnpm build && pnpm typecheck && pnpm deps:check && pnpm deps:policy`，确认包导出、类型、依赖方向和依赖策略通过且锁文件无变化。
- [x] 6.3 [IP-02～IP-10] 运行 `pnpm exec eslint packages/core/src/identification-knowledge packages/core/test/identification-knowledge.test.ts packages/adapters/src/identification-knowledge packages/adapters/test/identification-knowledge apps/worker/src/identification-knowledge apps/worker/test/identification-knowledge` 及 implementation-plan V-08 的完整 `prettier --check` 命令，修正本 change 文件的静态与格式问题。

## 7. OpenSpec verify

- [x] 7.1 [IP-01、IP-03、IP-07、IP-08、IP-10] 协调端先归档 C08 `AgentTaskFailureEvidenceReaderV1.readTerminalFailure()` 前置 change，实施端再以该 reader 替换 C17 的 `AgentTaskStoreV1.getTask()`，并以 `KnowledgeGovernanceReviewAuthorizationProviderV1` 替换 C16 的 `reviewAuthorization/approvalAuthorization` 内联回调；随后运行 V-01、V-03～V-05 及 `openspec validate deliver-process-model-mechanism-and-evidence-governance --strict --no-interactive && openspec instructions apply --change deliver-process-model-mechanism-and-evidence-governance --json`，完整读取全部 `contextFiles`，逐项核对每个 Requirement/Scenario、允许文件和验证义务均可反向定位到 IP-01～IP-10。
- [ ] 7.2 [IP-10] 在全部实现任务、命令证据和 checkbox 完成后使用项目 `openspec-verify-change` 流程独立验收；未验证通过不得归档，本任务本身不提交或归档。
