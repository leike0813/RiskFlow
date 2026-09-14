## 1. 基线与缺陷确认

- [x] 1.1 按 IP-02 确认实施基线的目标文件已包含具名 `C25 assessment-preparation freeze` 子套件及三个既有测试；在未修复代码上运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts -t "C25 assessment-preparation freeze"`，以三个 C25 测试被选中且 setup 因 `AUTHENTICATION_REJECTED` 退出 1 记录缺陷基线。若目标符号、数量或失败原因不同，停止实施并回报规划漂移。
  - 证据：实施基线含具名子套件与三个既有 `it`；过滤运行报告 1 failed suite / 28 skipped、`AccessServiceError: AUTHENTICATION_REJECTED`（`postgres-local-identity-access.ts:2514`，调用点在测试文件原 3494 行 `c11-admin` 登录），退出码 1。合并 main 后 `packages/core/dist` 缺少 `risk-assessment/engine` 产物，先执行 `pnpm exec tsc -b`（退出 0）重建后才得到上述缺陷基线。

## 2. 隔离 C25 测试状态

- [x] 2.1 按 IP-01 仅修改 `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`：在 C25 子套件内通过现有 `startEngineeringContextSourceFixture` 创建并在 `afterAll` 关闭专用 fixture；在该 fixture 中 bootstrap `c25-admin`、登录并首次改密，再沿用现有流程创建 `c25-manager` 和 `project-c25-freeze` 授权。不得修改生产代码、公共 fixture、三个测试的名称/断言/超时或其它子套件；以 `git diff --name-only` 仅列出该测试文件和本 change 工件验证范围。
  - 证据：`git diff --name-only` 仅列出该测试文件（24 insertions / 6 deletions）。C25 作用域新增内层 `fixture`（`startEngineeringContextSourceFixture({ now: () => new Date(now) })`）与 `afterAll` 关闭；`c25-admin` 经 `bootstrapInitialSystemAdministrator` 建立后登录并改密，`c25-manager`、`project-c25-freeze` 流程保持原样；生产代码、公共 `fixture.ts`、三个测试的名称/断言/超时与其它子套件未改。
- [x] 2.2 按 IP-02 运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts -t "C25 assessment-preparation freeze"`，以目标文件通过且实际报告 3 passed 验证 C25 子套件可独立运行，不接受 0 tests、全部 skipped、sleep、重试或认证回退。
  - 证据：3 passed | 25 skipped (28)，退出码 0；无 sleep、重试、skip 或认证回退。

## 3. 组合与合规验证

- [x] 3.1 按 IP-02 运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`，以目标文件全部 28 个既有测试通过验证外层 C11 与内层 C25 fixture 生命周期兼容。
  - 证据：28 passed (28)，退出码 0。
- [x] 3.2 按 IP-02 运行 `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts -t "persists context, snapshot, source delivery, access closure, and segments|denies historical read resolutions once current authorization is revoked|C25 assessment-preparation freeze"`，以前序 C11 状态建立用例、紧邻 C25 的授权撤销用例及三个 C25 测试共 5 passed 验证相邻行为未被破坏。
  - 证据：5 passed | 23 skipped (28)，退出码 0。
- [x] 3.3 按 IP-02 运行 `pnpm exec prettier --check packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts openspec/changes/fix-c11-context-source-suite-isolation/.openspec.yaml openspec/changes/fix-c11-context-source-suite-isolation/proposal.md openspec/changes/fix-c11-context-source-suite-isolation/design.md openspec/changes/fix-c11-context-source-suite-isolation/tasks.md`、`openspec validate fix-c11-context-source-suite-isolation --strict --no-interactive` 与 `git diff --check`，以命令均退出 0 验证格式、change 结构及补丁完整性；不得提交或归档。
  - 证据：prettier `All matched files use Prettier code style!`（退出 0）、`openspec validate` 报告 change 有效（退出 0，`skip_specs` 信息符合本 change 声明）、`git diff --check` 退出 0。附加：目标文件 `pnpm exec eslint` 退出 0；`pnpm exec tsc -b` 退出 0，并以临时 tsconfig 对目标文件做等价类型检查——改动前后错误多重集完全一致（53 个既有错误均为测试文件历史 drift，无新增，且无一落在改动区间）。
  - 范围外观察（未处理）：测试目录不参与 `tsc -b` 项目，目标文件存在 53 个既有类型错误（如 `sourceVersionRef` 判别收窄、artifact `kind` 收窄、`exactOptionalPropertyTypes` 相关 TS2379），与本 change 非目标一致，留待独立 drift 处理。
