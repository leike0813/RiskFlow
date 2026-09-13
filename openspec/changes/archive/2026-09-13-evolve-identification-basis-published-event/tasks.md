## 1. DomainEventV1 契约

- [x] 1.1 按 design D-01/D-03 在 `packages/contracts/src/events/index.ts` 复用 `KnowledgeReleaseRefV1Schema`、`RetrievalEvidenceBaseReleaseRefV1Schema` 和既有 `eventSchema()`，新增私有 `IdentificationBasisPublishedReleasesV1Schema`、`IdentificationBasisPublishedPayloadV1Schema`、generic/typed composite 引用一致性校验及 `knowledge.identification-basis-published.v1` 分支；不得修改其它事件、ports 或 workflows。运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，通过条件为退出码 0 且 `DomainEventV1` 新成员由 Zod Schema 推导、无并行手写 DTO。

## 2. 契约行为测试

- [x] 2.1 按 delta spec 和 design D-07 修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts`：将事件表驱动夹具扩为十一类，加入合法识别基础发布事件，并用代表性用例拒绝发布集合缺项或错位/重复类型、generic/typed 检索证据库引用不一致、正文与未知字段；不精确断言错误文案或序列化字段顺序。运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'domain events'`，通过条件为目标测试全部通过且既有十个事件夹具保持合法。

## 3. 集成与范围门禁

- [x] 3.1 运行 `pnpm typecheck`，通过条件为 workspace TypeScript 构建退出码 0；若发现 contracts 外存在对 `DomainEventV1` 的穷举消费者而新增成员导致失败，停止并升级范围，不在本 change 修改该消费者。
- [x] 3.2 运行 `pnpm exec prettier --check packages/contracts/src/events/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-identification-basis-published-event/proposal.md openspec/changes/evolve-identification-basis-published-event/specs/domain/module-interfaces-events-workflows/spec.md openspec/changes/evolve-identification-basis-published-event/design.md openspec/changes/evolve-identification-basis-published-event/tasks.md` 与 `openspec validate evolve-identification-basis-published-event --strict --no-interactive`，通过条件为格式检查和 strict change 校验均退出码 0。
- [x] 3.3 运行 `git diff --check`、`git diff --name-only 8fe4c1f07dd469ed15b7b6da6c4c98292dd476f5 --` 与 `git status --short` 核对范围；通过条件为无空白错误，计划生产代码只有 `packages/contracts/src/events/index.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`，其余变化只位于 `openspec/changes/evolve-identification-basis-published-event/`，且没有 apps、core、adapters、ports、workflows、迁移、根 workspace、锁文件、依赖政策、主 specs、其它 change、提交或归档变化。
