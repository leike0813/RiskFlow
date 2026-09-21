# 验收记录：fix-orchestration-close-and-trust

> 当前 change 的实际 schema 为 `spec-driven`，OpenSpec 仅声明 proposal、specs、design、tasks；本文件是收尾与限定审计共用的补充记录，不是 OpenSpec CLI 工件。

## 产物与结论

- 输入及当前 Git HEAD：`2bce8f77946ddad2d0e7db5b05d3a54fbff6b598`。本次收尾修改尚未提交；主调度形成检查点后以新 HEAD 为准。
- Finalizer 结论：已批准范围内的实现与回归通过。若协调端将命令构造修复归为关键状态机变更，整体结论在限定审计完成前为待审计，不能据此集成。
- 限定审计结论：待协调端按风险标签决定；如触发，由本轮唯一 Targeted Auditor 在此处记录最终结论、检查点 HEAD、任务内修复及回归证据。

## 规格核对与收尾修复

- `spec-driven` 的 8/8 项任务已完成；两项 delta requirement 的关键场景分别由终态 terminal 关闭/重读回收路径、Codex 信任等待/`worker-start` 归类路径覆盖。
- 发现 `orcaJson` 在拼接 `withOrcaSender(args)` 后，又把 `withRetryRequest(args)` 返回的整组 `args` 拼入，导致所有 Orca 命令参数重复；这是关闭命令仍不可用的根因。现只返回可选 `--retry-request` 后缀，且仅用于 `orchestration` 命令族。
- 收紧现有 cleanup 回归用例，断言两个关闭命令的完整参数；已消失的 handle 后继续处理其余 handle，并以重读后的 `reclaimable` 状态决定回收。信任提示的等待阶段、`worker-start` 阶段及恢复路径沿用现有测试。
- 设计 D-01 至 D-03 与实现一致；没有新增依赖、迁移、公共契约或权限变化。未在真实 Orca 上执行破坏性回收，相关证据来自命令层测试。

## 实际验证命令

- `pnpm exec vitest run scripts/orchestration`：2 个文件、95 项测试通过。
- `pnpm exec tsc -b`：通过。
- `pnpm exec eslint scripts/orchestration`：通过。
- `pnpm exec prettier --check scripts/orchestration openspec/changes/fix-orchestration-close-and-trust`：通过。
- `openspec validate fix-orchestration-close-and-trust --strict --no-interactive`：valid。
- `git diff --check`：通过。
- `openspec instructions verification --change fix-orchestration-close-and-trust --json`：返回 `verification` 不在 `spec-driven` schema 中；因此没有 CLI 可完成的 verification 工件。

## 后续事项

- 主调度审阅全部 dirty paths 并形成检查点；如风险分流要求限定审计，审计者将最终 HEAD 与结论补入本文件后才进入集成。
