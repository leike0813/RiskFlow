# C20 规划范围变更批准记录（2026-09-21）

- 批准引用：`approval://riskflow/C20/scope-2026-09-21-c17-retrieval-delegate`
- 批准来源：项目方在本会话明确批准「C20 规划范围变更：检索委派接缝由 C20 自己落地，允许 C20 修改 C17 侧该接缝所需的最小文件」。
- 被取代的尝试组：`C20:planning`
- 触发证据：`run_05043cdcd282` 的 planning worker 报告 `msg_f6b5c663f896`（escalation）、`msg_b6862180835a`（worker_done，outcome failed），产物 HEAD `cafdecfb78d1ebebf4fccd4260422f6cb4eb7556`。

## 触发事实

- C17 已归档 `design.md`（2026-09-20-deliver-process-model-mechanism-and-evidence-governance）第 79 行已批准：`retrieve()` 原样委派后续注入的检索实现，未注入时返回 C02 既有 `UNSUPPORTED_CONTRACT`；C17 不生成检索结果。
- 当前代码中 `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts` 的 `retrieve()` 仍是 `UNSUPPORTED_CONTRACT` 桩，`PostgresIdentificationKnowledgeAdapterOptionsV1` 没有检索 delegate；`apps/worker/src/identification-knowledge/composition.ts` 也没有对应注入。
- 本 change `design.md` D2 与 `implementation-plan.md` IP-06 假设该接缝已作为已批准注入点存在，而 Non-Goals 又禁止修改 C17 生产文件，规划因此无法确认可实施；worker 按升级条件停止，未修改任何文件。
- 另有环境前置：tasks 1.1 的 adapter suite 因本 worktree 缺少构建输出（`@riskflow/contracts/ports` 解析失败）而无法执行。该构建前置由主调度补齐，不属于规划范围，也不需要写入 allowlist。

## 本次重开规划必须闭合的范围

1. 在 C20 内落地 C17 检索委派接缝。允许新增修改的 C17 侧文件仅限：
   - `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts`（仅新增一个可选检索 delegate 选项并在 `retrieve()` 内原样转发）；
   - `apps/worker/src/identification-knowledge/composition.ts`（仅把该 delegate 注入组合根）；
   - `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts`（仅补充已注入原样转发与未注入保持 `UNSUPPORTED_CONTRACT` 两条边界）。
2. 语义边界：delegate 缺省时行为与现状完全一致；注入后把查询原样交给 delegate 并把结果原样返回。公共 `KnowledgeModelingPortV1`、`KnowledgeRetrievalQueryV1`、分支集合、授权、幂等与错误映射一律不变；C17 不实现双索引、检索排序或识别图。
3. 选项名与类型按 design 的 D-ID 决定（沿用 C17 `assessmentBasisResolver` 的 delegate 范式），但 design 必须写明确切选项名、类型、注入位置，以及「未注入 / 已注入」两条可观察行为。
4. `implementation-plan.md` 的 IP-00、IP-06 归属行与允许文件清单，以及 `tasks.md` 1.1、4.3（含可运行验证命令）必须同步更新；删除「主调度修改 C17 生产文件」的表述——主调度只提供公共事件、package exports、依赖与锁文件一类的机械前置。
5. 超出上述文件与语义的改动不在本次批准范围内，必须重新 escalation。

## 处置要求

规划者 MUST 把上述范围展开为可施工的 IP-ID、允许文件清单和验证命令；若认定其中任一项无法在 C20 已批准语义内闭合，MUST 在规划工件中显式说明并升级，而不是仅补齐模板章节。

本记录是重开规划的输入与批准凭据，不是设计结论；设计结论仍写入 `design.md`。
