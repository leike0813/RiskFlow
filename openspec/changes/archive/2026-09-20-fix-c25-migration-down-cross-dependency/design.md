# Design

## Context

- 迁移在真实回滚时按逆序执行（先 `000044.down` 再 `000032.down`），此时不会出现依赖冲突；冲突来自**孤立回滚**：全量迁移已应用，却单独调用某个较早迁移的 `down()`。
- 项目把"up 与 down 可重复执行"作为契约，由 `migration-idempotency.test.ts` 断言，因此孤立 down 必须成立。
- 跨 change 的外键依赖是合法设计（C26 的告警记录确实引用 C25 的评估记录、输入快照与准备快照），不能为了测试而回退完整性。实测 C26 在 `business.warning_records` 上共建了三个指向 C25 表的外键（assessment / input snapshot / preparation snapshot），必须一并解除。

## Goals / Non-Goals

**Goals:**

- 让较早迁移的 `down()` 对后续 change 引入的、指向本表的外键鲁棒。
- 保持既有 up/down 契约与审计外键计数断言不变。

**Non-Goals:**

- 不实现"自动发现并删除所有指向本表的外键"的通用机制（会静默改写其它 change 的所有权，且难以复核）。
- 不改 C26 的外键、不改迁移顺序、不改测试强度。

## Decisions

**D1：在 `down()` 里显式解除已知依赖，而不是改测试为逆序 down。**
逆序 down 会让"孤立 down 可重复执行"这条既有契约失效，等于用降低契约强度换取绿灯。显式解除依赖把成本放在真正产生依赖的那一侧的收尾流程里，测试强度不变。

**D2：只解除当前已知的那一个约束，并保持可重复执行。**
`DROP CONSTRAINT IF EXISTS` 幂等；不做全库扫描，避免把"谁拥有哪个约束"的语义模糊掉。若后续再有 change 引入新的跨 change 外键，沿用同一处补一行即可——这是 RUNBOOK §8 所说的机械接缝。

## Risks / Trade-offs

- 该处是硬编码的约束名：若 C26 的约束被重命名，这里会静默失效（`IF EXISTS` 不报错）并被同一用例重新暴露。可接受，因为约束名改动本身会先触发其它断言。
- 通用方案（扫描 catalog 删除所有引用外键）更强但会静默改写其它 change 的所有权，故不采用。
