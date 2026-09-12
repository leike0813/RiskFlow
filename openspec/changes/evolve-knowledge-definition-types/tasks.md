## 1. 扩展共享契约

- [ ] 1.1 按 D-01、D-02、D-04 修改 `packages/contracts/src/ports/index.ts` 的 `KnowledgeDefinitionTypeValues`，在 `risk-mechanism` 与 `retrieval-evidence-base` 之间加入 `standard-library`、`case-library`，不改其它成员、Schema、port 或 DTO；运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，以命令退出码为 0 验证 contracts 编译通过。
- [ ] 1.2 按 D-05 修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts`，复用现有“闭合词汇与能力”测试并参数化验证 `KnowledgeDefinitionTypeV1Schema` 接受两个新增字面量，不复制完整枚举列表；运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`，以目标文件测试全部通过验证运行时契约。

## 2. 消费兼容与范围门禁

- [ ] 2.1 按 D-03 运行 `pnpm typecheck`，以 workspace 类型检查退出码为 0 验证 core 生命周期、adapters 及其它消费方无需同步分支或镜像列表改动。
- [ ] 2.2 运行 `pnpm exec prettier --check packages/contracts/src/ports/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-knowledge-definition-types/.openspec.yaml openspec/changes/evolve-knowledge-definition-types/proposal.md openspec/changes/evolve-knowledge-definition-types/design.md openspec/changes/evolve-knowledge-definition-types/tasks.md`，以全部目标文件通过验证格式；不得用格式化命令改动范围外文件。
- [ ] 2.3 运行 `openspec validate evolve-knowledge-definition-types --strict --no-interactive` 与 `git diff --check`，并用 `git status --short` 核对生产代码只改 `packages/contracts/src/ports/index.ts` 和 `packages/contracts/test/module-interfaces-events-workflows.test.ts`；不得修改 core、adapters、migration、主 specs、UI、依赖、锁文件、根配置、其它 change，且不实现 C17、不提交、不归档。
