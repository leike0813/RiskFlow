## Context

参见 [proposal.md](./proposal.md) 的动机。当前 PostgreSQL adapter 已在定义级事务锁内读取全部发布与停用事实，但 `#submit` 和 `#publish` 都把 `#currentRelease()` 的 active 投影传给 `validateRevisionBase()`。唯一发布停用后该投影为空：提交先被 `base-release-not-current` 拒绝；即便已有修订，发布又会因 `expectedBaseReleaseRef` 无法匹配空 active current 而失败。

现有发布事实足以推导历史基线，不需要新增状态列、可变 current 指针或迁移。`validateRevisionBase()` 的生产调用方只有 C16 PostgreSQL adapter，`validatePublicationTimeline()` 的回滚调用必须保持原样。

## Goals / Non-Goals

**Goals:**

- 从同一组只追加发布事实分别推导“最近历史发布”和“当前 active 发布”。
- 在不放宽工程、类型、精确引用、人工批准、时间线、重复发布和并发门禁的前提下恢复停用后的演进链。
- 复用现有定义级事务锁与命令幂等，不增加持久化或依赖。

**Non-Goals:**

- 不改变运行解析、停用或 `rollback-by-new-release` 的行为。
- 不修正历史发布回退、未来发布建模或其它未在本缺陷中确认的生命周期问题。
- 不修改 C02 公共命令、`packages/contracts/**`、业务内容策略、迁移或 C17/C25/C08 文件。

## Decisions

### D-01：演进基线与 active current 使用两个投影

adapter 在已有 `#releaseFacts()` 返回值上增加最小的最近历史发布投影：只考虑 `effectiveFrom <= command.issuedAt` 的同定义发布，按 `effectiveFrom` 取最近一条，不读取停用决定。现有 `#currentRelease()` 继续结合停用决定，只服务 active 发布冲突与运行相关语义。

两个投影明确区分三种状态：没有发布历史时二者均为空；唯一历史发布停用后，历史基线存在而 active current 为空；正常发布状态下二者指向同一最近发布。选择既有只追加事实计算，而不是新增 current/base 状态列，避免迁移和第二事实源。

### D-02：基线校验只认最近历史发布

`packages/core/src/knowledge-governance/lifecycle.ts` 的 `validateRevisionBase()` 将输入字段 `currentRelease` 重命名为 `latestRelease`，并继续校验工程、定义类型、发布引用和发布所含修订引用。已有定义但历史投影为空时仍拒绝后续提交；请求基线不是最近历史发布时仍返回 `STALE_VERSION`，不按停用决定放宽。既有失败代码与原因代码保持不变，避免改变正常路径的结构化错误输出。

这是 core helper 的源码级参数语义调整，已知生产调用方仅为 C16 adapter；不改变 C02 命令或错误 Schema。保留既有闭合错误代码，测试断言代码和关键原因语义，不绑定完整文案。

### D-03：发布分别校验演进基线和 active 冲突

`#publish()` 在同一定义级事务锁内完成两项独立校验：先用新增私有投影 `#latestRelease()` 验证修订父链；再用现有 `validatePublicationTimeline()` 校验 active current、未来时间线和重复修订。调用后者时，仅在 active current 存在时传入修订的 `baseReleaseRef` 作为 `expectedBaseReleaseRef`；active current 为空时省略该预期。这样已停用的历史基线不必匹配空 active current，而 active current 存在时仍须与修订基线一致。

`#rollback()` 继续以调用前后的 active current 做乐观并发检查，并保留 `allowPreviouslyPublishedRevision`，不改用历史基线。把演进与 active 冲突拆开，比给发布时间线增加“允许停用”开关更小，也不会让普通发布绕过既有门禁。

### D-04：现有锁与幂等规则收口并发和重复发布

`#submit()` 与 `#publish()` 已使用同一 `(projectId, definitionType)` advisory lock。停用决定不会改变历史基线，因此停用期间多个提交可依次基于同一最近历史发布形成独立候选；若新发布先成立，后续提交读取到新的历史基线并拒绝旧引用。两个发布并发时，获胜者追加发布后，后一个在锁内看到更新历史并失败。

相同命令身份与载荷仍由 C03 回执幂等返回原结果；不同命令再次发布同一修订仍由基线或 `revision-already-published` 门禁拒绝。无需新增唯一约束或锁。

### D-05：只扩展现有两层行为测试

core 测试以表格化输入覆盖最近历史基线存在、缺失和陈旧三种边界。PostgreSQL 测试复用现有 fixture，完成“发布 → 停用 → 并发提交 → 人工批准 → 并发发布/重放”的真实事务链，并确认运行解析在停用期间仍不可用。测试只断言结果类型、错误代码、引用与事实计数，不锁定 SQL、内部调用次数或完整错误文案。

## Risks / Trade-offs

- **发布历史较长时继续在 adapter 内排序** → `#releaseFacts()` 已按工程和稳定定义有界读取，本 change 只复用该结果；出现可测性能问题后再改为有界 SQL 投影。
- **active 与历史投影可能不同** → 仅基线校验读取历史投影，运行解析和回滚仍使用原 active 语义；定向回归防止混用。
- **停用与发布未共享发布引用锁** → 本 change 不改变既有停用/发布竞态结果；演进基线忽略停用决定，使提交结果不依赖两者提交顺序。

## Migration Plan

1. 先落 core 基线语义与测试，再调整 adapter 投影和发布调用。
2. 运行 C16 core 与 PostgreSQL 定向测试、类型检查和现有 C16/C18/C19 代表性回归。
3. 无数据迁移或回填；代码回滚即可恢复旧行为，已有只追加事实无需处理。

不存在会改变规格、实现边界或任务拆分的 Open Questions。
