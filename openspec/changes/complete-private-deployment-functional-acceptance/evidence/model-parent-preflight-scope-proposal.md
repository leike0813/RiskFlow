# 模型父工件预检范围补充提案

状态：用户已于2026-10-14授权并已按 D-31 / IP-19 实施；回归与真实清洗实跑通过。原失败任务保留，新清洗任务见 [C04 预检与清洗取证](c04-preflight-and-cleaning-2026-10-14.md)。

## 实际触发和复现

2026-10-14，五格式资料在隔离实例完成 C04/C11 登记、MinerU 官网转换与质量复验后，正式 `engineering-data.identification-preparation` 创建必经清洗任务。任务于首个模型行动失败，公开详情为 `AGENT_MODEL_FAILURE` / `model.complete`，1 次模型调用、输入输出 token 为 0、活动墙钟 274 ms。

该任务的真实模型输入工件用途为 `agent-model-input`。`model-gateway-runtime.ts` 的 `preflightParentArtifacts` 向预检提供 `model-raw-response`；`start.mjs` 直接把它作为所有父工件的读取用途。C04 严格检查清单用途，故在网络推理之前返回拒绝，模型网关映射为 `MODEL_AUTHORIZATION_DENIED` / `artifact.authorization`。

受控实例目录的 `reproduce-model-parent-preflight.mjs` 从同一任务已登记的输入工件读取消息，执行当前正式宿主的模型预检；网络 fetch 被显式禁止，输出只含引用、用途、错误码和是否尝试联网。该脚本预期退出 1，已确认父工件预检错误用途与零网络请求。原失败任务、预算和工件均未回滚或改写。

## 已实施的 IP-19 文件和行为

| 文件 | 拟变更 |
| --- | --- |
| `packages/adapters/src/artifacts/index.ts` | 在本地 C04 handle 暴露既有 `ArtifactManifestReaderV1` 形状的精确 `readManifest(projectId, artifactRef)`，绑定既有 registry 方法；只读取一个工程下一个精确工件身份。 |
| `packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` | 扩展既有集成覆盖，确认精确清单读保留用途与版本，错工程和缺失身份不返回清单；复用现有 PostgreSQL 夹具。 |
| `scripts/deployment/start.mjs` | 从基础宿主传入清单读取器。模型请求仍先复验当前 C06；每个父工件读取精确清单，按其真实用途调用原受权 `open`，完整消费并等待 `verified`；缺失、撤权或摘要错误均拒绝。 |
| `scripts/deployment/entrypoints.test.mjs` | 增加父工件用途不同于模型响应用途的回归，以及缺失/拒权/校验失败阻断网络调用的边界。 |
| 当前 change 的 `design.md`、`implementation-plan.md`、安全证据索引 | 记录 C04 handle 接缝、调用方与 IP-19 验证映射，保持原任务完成标准。 |

这不是 HTTP/model DTO 新字段，不引入依赖或迁移。仍保留 C04 用途约束、空间/资料授权、父工件继承、精确版本、摘要验证和访问审计；不按工件名称猜用途，不枚举全库，不删除父引用。

## 验证与验收续接

已完成：既有 entrypoints 与 C04 集成回归通过，并在同一隔离实例运行了新的正式清洗调用（c04-v3）；正式终态、结果 C04、预算与准备快照齐全，见新取证文件。原失败任务未续接，不扩预算、不换模型。知识治理来源续接时前2份转换 BLOCKED（诊断与修复授权见 [DOCX 标准字符引用修复提案](docx-entities-scope-proposal.md)）、其余未跑；当前任务完成度仍为 1/14。

另一个独立观察是物理 Chrome 的任务详情持续显示列表读取中，而同会话正式详情查询能读实际终态；尚未定位原因，本提案不把该观察混作上述模型预检根因，现由 [可见读取范围补充](visible-read-scope-proposal.md) 接续。

施工图 §7 的范围升级已由本次用户授权、D-31 和 IP-19 补充闭合；生产实现与实跑结果已按上述回归和 c04-v3 任务验证。
