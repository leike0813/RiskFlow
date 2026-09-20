# Spec Delta

## ADDED Requirements

### Requirement: 辅助 change 的合并证据必须与路线 change 同口径

没有固定路线节点、以 `AUX:<change>` 合成的工作项 MUST 与路线 change 使用同一合并判据：以该工作项所属非主工作树的 HEAD 是否为 main HEAD 的祖先作为「产物已进主线」的证据。路线图之外不得成为跳过该采集的理由。

#### Scenario: 辅助 change 合入 main 后进入 merged
- **WHEN** 一个辅助 change 的非主工作树 HEAD 已成为 main HEAD 的祖先，且其信封尚未记录主线复验通过
- **THEN** 状态 MUST 把该工作项报告为 `merged`，而不是停留在 `finalized`
- **AND** MUST 返回「在 main 上完成冻结安装、pnpm verify 和主线验证」作为下一动作

#### Scenario: 辅助 change 未合入时保持 finalized
- **WHEN** 辅助 change 的非主工作树 HEAD 仍不是 main HEAD 的祖先
- **THEN** 状态 MUST 保持整合前的阶段判定
- **AND** MUST NOT 仅因信封存在合并摘要而报告 `merged`

#### Scenario: 路线 change 沿用原映射
- **WHEN** 某个活动 change 名称映射到路线图中的 change 节点
- **THEN** 该节点的合并证据 MUST 继续按其自身工作项 id 采集
- **AND** MUST NOT 因辅助分支的加入而改变其判定
