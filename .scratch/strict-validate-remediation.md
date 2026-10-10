# `openspec validate --all --strict` 修复清单

`pnpm verify` 末段执行 `openspec validate --all --strict --no-interactive`。

同一批 41 项规格：**非 strict 下 41 passed / 0 failed**；加 `--strict` 后 30 passed / 11 failed。
失败全部来自同一条告警：`Requirement text is very long (>500 characters)`。
即 11 份规格**语义有效**，`--strict` 只是把样式告警提升成失败。

## 成因

`--strict` 由 `c5dea99`（2026-08-31）引入 `package.json`。此后共有 129 个 `spec.md` 进仓库，
下列规格归档于 2026-09-13、2026-10-07 等，即门禁之后。**归档流程未执行 CI 那条校验**，
规格从归档与 CI 之间的缺口通过。

## 性质（已实际读取正文确认）

违规正文不是可搬移的示例与边界，而是**连续的规范条款链**。例如
`content-addressed-artifact-store` 的「哈希清单和恢复核对以数据库引用完整为硬门槛」，
正文是一串 MUST（专用 client、`REPEATABLE READ READ ONLY` 事务、同一 client 跑完主键游标批次、
异常回滚释放、扫描后提交再普通 `put` 登记、`databaseSnapshotRef` 不得当作 snapshot token…），
且该 Requirement 已有 7 个配套 Scenario 覆盖其列出的边界。

因此校验器建议的「移进 Scenario / 拆成多条 Requirement」在此需要判断 MUST 链的拆分边界，
属于改写他人已归档契约的语义，不是机械搬移。

## 两个互斥口径

| | 做法 | 代价 |
| --- | --- | --- |
| **A'** | 逐条拆分正文，每条 Requirement 只陈述一个行为 | 动 8 个以上其他 change 的已归档契约；需另开 drift change；拆分边界需原责任方判定 |
| **B** | `package.json` 的 `openspec:validate` 去掉 `--strict` | 一行；样式红线不再阻断 CI；语义校验 41/41 不变 |

两者都改动 C37 之外、且不由 C37 拥有的东西，因此 C37 不代选、不代做。

## 清单

| # | 规格 | Requirement | 正文字数 | 配套 Scenario |
| --- | --- | --- | --- | --- |
| 1 | `data/agent-cleaning-and-partial-availability/spec.md` | 识别准备只冻结已收口的可用输入 | 590 | 1 |
| 2 | `data/agent-cleaning-and-partial-availability/spec.md` | 版本、幂等与权限支持精确重放 | 688 | 1 |
| 3 | `domain/module-interfaces-events-workflows/spec.md` | 六个领域模块只暴露用例级 interface | 632 | 1 |
| 4 | `domain/module-interfaces-events-workflows/spec.md` | 识别工作流具有 I0 至 I9 的版本化阶段契约 | 658 | 2 |
| 5 | `domain/module-interfaces-events-workflows/spec.md` | 评估准备入口显式冻结入口语义与多序列监测引用 | 769 | 2 |
| 6 | `domain/module-interfaces-events-workflows/spec.md` | 预警确认必须以独立的已读接管命令表达 | 871 | 2 |
| 7 | `domain/module-interfaces-events-workflows/spec.md` | 评估启动输入显式覆盖冻结所需引用 | 601 | 2 |
| 8 | `domain/module-interfaces-events-workflows/spec.md` | 工作流生命周期以耐久业务事实和冻结身份收口 | 585 | 2 |
| 9 | `domain/module-interfaces-events-workflows/spec.md` | C33 识别运行与风险记录只读必须有界且复验当前授权 | 528 | 1 |
| 10 | `domain/module-interfaces-events-workflows/spec.md` | 受保护读端口必须以当前调用的领域标识复验签发身份 | 534 | 1 |
| 11 | `domain/monitoring-batches-snapshots-features/spec.md` | 精确监测序列修订可按当前授权狭窄读取 | 612 | 1 |
| 12 | `domain/response-recommendation/spec.md` | 三项处置约束由确定性模块逐项校验 | 881 | 2 |
| 13 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 结构化评分规则唯一内容契约 | 1185 | 1 |
| 14 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 冲突与重叠确定性检测 | 1081 | 1 |
| 15 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 结构化规则复用统一定义生命周期 | 563 | 2 |
| 16 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 公共评估依据解析 | 802 | 1 |
| 17 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 评估依据发布集合成员的有界读取 | 2371 | 4 |
| 18 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 授权、事务、幂等与可重放审计 | 552 | 1 |
| 19 | `knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 评估依据准备投影由所属域提供 | 1110 | 1 |
| 20 | `operations/orchestration-controlled-actions/spec.md` | Codex worker 只在工作区信任完成后启动 | 658 | 2 |
| 21 | `platform/content-addressed-artifact-store/spec.md` | 哈希清单和恢复核对以数据库引用完整为硬门槛 | 564 | 7 |
| 22 | `platform/http-command-query-sse-shell/spec.md` | SSE 必须从耐久订阅游标恢复 | 512 | 1 |
| 23 | `platform/http-command-query-sse-shell/spec.md` | HTTP 壳层必须登记唯一的预警确认入口 | 669 | 2 |
| 24 | `platform/http-command-query-sse-shell/spec.md` | C32 只读查询分支必须登记在闭合路由清单 | 637 | 1 |
| 25 | `platform/unified-bounded-agent-runtime/spec.md` | 终态失败证据只通过公共窄读披露 | 954 | 2 |
| 26 | `quality/evaluation-and-browser-acceptance/spec.md` | C36 页面查询投影必须有界且只追加 | 562 | 1 |
| 27 | `risk-assessment/engine/spec.md` | 指标实际取值使用唯一映射和精确单位 | 598 | 1 |