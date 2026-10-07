## 0. 前置裁决

- [x] 0.1 本 change 触及 `deliver-assessment-warning-and-response-ui` §7 明列的「授权需扩大」升级条件：**须用户明确裁决后**才可进入第 1 节实施。裁决范围见 proposal「升级与授权边界」：只允许「同工程内，调用方已授权范围覆盖运行已登记事实范围」这一条放宽方向；不允许跨工程读取、范围不足降级、以运行引用代替授权判定或提高摘要容忍度。

## 1. 覆盖判定

- [x] 1.1 实施 IP-01：复用 C04 工件读取的授权覆盖判定（空间范围与来源授权逐项集合包含 + 同工程），移除 retrieval 中只比较空间的重复判定；`authorizationScopeDigest` 及其写入侧用途不变。验证：`pnpm exec vitest run packages/adapters/test/workflow`、`pnpm typecheck`。

## 2. 读取准入

- [x] 2.1 实施 IP-02：`#latestRunStateWith` 与完成证明中 `run-result` 行的准入从上下文摘要等值改为覆盖判定（两处共用同一判定），被覆盖集合取该运行已登记事实声明的范围引用；覆盖不足与事实缺失同型失败，且以「证明未成立」而非「事实不一致」返回。验证：`pnpm exec vitest run packages/adapters/test/workflow`。

## 3. 写入侧保持

- [x] 3.1 实施 IP-03：确认登记行写入路径不变、仍保存当时的授权范围摘要，审计与追溯不受影响。验证：`pnpm exec vitest run packages/adapters/test/workflow`。

## 4. 调用方范围

- [x] 4.1 实施 IP-04：确认 C41 反馈段读取上下文仍按单空间收窄签发，不因本 change 扩大调用方自身范围。验证：`pnpm exec vitest run packages/adapters/test/human-decision-feedback`。

## 5. 行为回归

- [x] 5.1 实施 IP-05：覆盖成功、范围不足拒绝、跨工程拒绝、写入摘要保留、既有绑定证明与完成证明核对项不减。验证：`pnpm exec vitest run packages/adapters/test/workflow packages/adapters/test/human-decision-feedback`。

## 6. 真实闭环

- [x] 6.1 闭环场景「采纳、执行与反馈成立真实事实后，偏差驱动出校准建议，批准只生成未发布草案」跑通：反馈、偏差记录与校准建议在真实浏览器链路中成立。验证：`pnpm exec playwright test -c playwright.config.ts --project=demo-chromium demo/test/browser/assessment-warning-response.spec.ts -g "偏差驱动出校准建议" --retries=0`。

## 7. 收口

- [x] 7.1 运行全部静态门禁与构建；在实现检查点后移交 Finalizer 填 `verification.md`，实现阶段不提前生成。
- [ ] 7.2 本 change 归档后回到 C34：重新评估并勾选 4.1/4.2/4.4；不得在本 change 内提前勾选 C34 任务。
