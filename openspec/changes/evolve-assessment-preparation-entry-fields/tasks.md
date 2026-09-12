## 1. Ports 评估准备命令契约

- [x] 1.1 按 D-04 只在 `packages/contracts/src/ports/index.ts` 将 `WorkflowEntryModeV1_VALUES`、`WorkflowEntryModeV1Schema` 与派生类型整体前移到 `AssessmentPreparationCommandPayloadV1Schema` 之前并删除原位置定义；执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 必须通过，且公开枚举名称和值不变、定义只保留一份。
- [x] 1.2 按 D-01/D-02 修改同文件的 `AssessmentPreparationCommandPayloadV1Schema`：新增必填 `entryMode`、`triggerReasonCode`，新增可选 `previousAssessmentRecordRef`、`causalRunRef`，以可选非空 `monitoringSnapshotRefs` 替换 `monitoringCutoff`；再次执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 必须通过，且不修改 `RiskInputVersionRefV1Schema`、其它 command payload 或 port 方法。

## 2. Workflow 准备快照契约

- [x] 2.1 按 D-02 只修改 `packages/contracts/src/workflows/index.ts` 的 `AssessmentPreparationSnapshotV1Schema`，以 `monitoringSnapshotRefs: z.array(MonitoringSnapshotRefV1Schema).min(1).optional()` 替换单数 `monitoringSnapshotRef`；执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 必须通过，且 `AssessmentInputSnapshotV1Schema`、其它快照与图状态保持不变。

## 3. Events 评估输入变化契约

- [x] 3.1 按 D-03 只修改 `packages/contracts/src/events/index.ts` 的 `AssessmentInputChangedPayloadV1Schema` monitoring-snapshot 分支，将单数前后字段替换为允许空数组的 `previousMonitoringSnapshotRefs` 与 `newMonitoringSnapshotRefs`；执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 必须通过，且 applicability-metadata 分支、事件元数据和其它事件分支保持不变。

## 4. 现有契约夹具

- [x] 4.1 按 D-06 修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的 domain ports 用例：补齐命令必填字段，覆盖两个可选引用、多监测快照、缺少任一必填字段、空数组和旧 `monitoringCutoff`；执行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'domain ports'` 必须通过，且断言只关注 Schema 接受/拒绝结果。
- [x] 4.2 按 D-06 继续修改同一测试文件的 strict snapshots 用例：覆盖省略监测输入、多个 `monitoringSnapshotRefs`、空数组和旧单数 `monitoringSnapshotRef`；执行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'strict snapshots'` 必须通过。
- [x] 4.3 按 D-06 继续修改同一测试文件的 domain events 用例：把既有事件夹具改为复数前后引用，并覆盖新增、删除、多序列变化、旧单数字段和监测正文拒绝；执行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts -t 'domain events'` 必须通过，且不新增测试文件或第二套事件变更结构。

## 5. 集成验证与范围核对

- [x] 5.1 执行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false && pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`；通过条件为 contracts 编译成功、该文件全部测试通过，公开 union 的所有现有 TypeScript 消费点无错误。
- [x] 5.2 执行 `pnpm typecheck` 和 `pnpm exec eslint packages/contracts/src/ports/index.ts packages/contracts/src/events/index.ts packages/contracts/src/workflows/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts`；通过条件为根 workspace 类型检查与四个改动文件 lint 均无错误。
- [x] 5.3 执行 `pnpm exec prettier --check packages/contracts/src/ports/index.ts packages/contracts/src/events/index.ts packages/contracts/src/workflows/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts openspec/changes/evolve-assessment-preparation-entry-fields`、`openspec validate evolve-assessment-preparation-entry-fields --strict --no-interactive` 与 `git diff --check`；通过条件为格式、change 严格校验和 diff 空白检查全部通过。
- [x] 5.4 执行 `git status --short`、`git diff --name-only -- packages/contracts openspec/changes/evolve-assessment-preparation-entry-fields` 以及 `git diff --exit-code -- apps packages/core packages/adapters package.json pnpm-workspace.yaml pnpm-lock.yaml openspec/config.yaml openspec/specs`；通过条件为生产代码改动仅限 D-07 的三个 contracts 源文件与一个既有测试文件，另只有本 change 工件发生变化，所有禁止范围 diff 为空。
