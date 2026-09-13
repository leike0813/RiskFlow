## 1. Core 演进基线规则

- [x] 1.1 [D-01、D-02] 修改 `packages/core/src/knowledge-governance/lifecycle.ts` 的 `validateRevisionBase()`，以命令时刻最近一次已生效的历史发布校验父链，保留无历史、跨工程/类型、引用错配和陈旧基线的既有失败门禁；运行 `pnpm exec vitest run packages/core/test/knowledge-governance/knowledge-governance.test.ts` 验证正常 active 基线、已停用历史基线、无发布历史和更新发布后的陈旧基线。
- [x] 1.2 [D-05] 仅扩展 `packages/core/test/knowledge-governance/knowledge-governance.test.ts` 的现有表格化用例，不新增测试文件或锁定完整错误文案；以任务 1.1 的命令通过作为完成证据。

## 2. PostgreSQL adapter 生命周期修复

- [x] 2.1 [D-01～D-04] 在 `packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts` 基于 `#releaseFacts()` 增加私有 `#latestRelease()` 投影，让 `#submit()` 和 `#publish()` 用其调用 `validateRevisionBase()`；`#publish()` 仅在 active current 存在时向 `validatePublicationTimeline()` 传 `expectedBaseReleaseRef`，保持 `#currentRelease()`、`#deactivate()`、`#rollback()`、人工批准、未来时间线、重复修订与定义级锁行为不变。
- [x] 2.2 [D-04、D-05] 扩展 `packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts` 的现有 PostgreSQL 场景，覆盖“唯一发布 → 停用 → 同历史基线并发提交 → 审批 → 并发发布”，并验证同命令重放返回原发布、不同命令不重复发布、停用期间运行解析仍失败；运行 `pnpm exec vitest run packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts --testTimeout=240000`。

## 3. 回归与范围门

- [x] 3.1 [D-02～D-05] 运行 `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false` 以及任务 1.1、2.2 的完整测试命令，确认首次发布、正常后续发布、停用、回滚、C18/C19 发布接缝和错误映射无回归。
- [x] 3.2 对四个计划代码/测试文件和本 change 文档运行 `pnpm exec prettier --check packages/core/src/knowledge-governance/lifecycle.ts packages/core/test/knowledge-governance/knowledge-governance.test.ts packages/adapters/src/knowledge-governance/postgres-knowledge-governance-adapter.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts openspec/changes/evolve-knowledge-definition-post-disable-revision/proposal.md openspec/changes/evolve-knowledge-definition-post-disable-revision/design.md openspec/changes/evolve-knowledge-definition-post-disable-revision/tasks.md openspec/changes/evolve-knowledge-definition-post-disable-revision/specs/knowledge/governed-definition-lifecycle/spec.md`，再运行 `openspec validate evolve-knowledge-definition-post-disable-revision --strict --no-interactive && git diff --check && git status --short`；确认没有迁移、依赖、contracts/Schema、C17/C25/C08 或其它范围外改动。
