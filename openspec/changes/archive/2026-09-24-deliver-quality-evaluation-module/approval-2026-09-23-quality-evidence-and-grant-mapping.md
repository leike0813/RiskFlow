# C36 规划范围变更批准记录（2026-09-23，收尾轮次开放项处置）

- 批准引用：`approval://riskflow/C36/scope-2026-09-23-quality-evidence-and-grant-mapping`
- 批准来源：协调端在本次受控调度会话中的裁决（依据本轮限定审计与 Finalizer 的 BLOCKED 结论）。
- 被取代的尝试组：`C36:audit`
- 触发证据：`run_99…`（C36 收尾轮次）的 `msg_e772d7529540`（Finalizer worker_done，结论 BLOCKED）、`msg_bec1d182bd2f`、`msg_02ae69e06c4a`、`msg_d51e28ce6c0c`、`msg_032f8428cc6d`（限定审计结论）；产物 HEAD `bc3c81974ff1` 加未提交审计修复。

## 触发事实（本轮 verification 的三项待规划开放项）

1. **正式空结果证明**：现有公开引用无法证明「某运行在其冻结范围内确实没有正式识别结果」，因此准确率/覆盖度中的真实 TN 不能成立（当前实现已改为失败闭合，不虚计）。
2. **必审资料段可授权解析证明**：无法由既有引用证明 `requiredEvidenceRefs` 所列资料段在冻结范围内可被授权解析，故审计链完整率的通过项不成立。
3. **C06 `grant → sourceVersion` 授权映射**：`AuthorizationContextV1.sourceAccessGrantRefs` 为 `source_access_grant_id/revision_id`，而摘要 `evidenceRefs` 为 `sourceVersion.entityId/versionId`；当前投影按 `entityId` 直接比较，真实签发语义下不成立，真实路径通常得到空 grant，导致授权证据定位可见性无法成立。

本轮已在批准范围内修复并通过证据：空间授权复验与同形失败闭合、指标失败闭合（不虚计 TN/覆盖）、单请求别名工件绕过规范 ID、数据集规范身份与同版本并发冻结（新增 C36 自有数据集冻结登记表 + 同事务核对）、浏览器夹具 ID；真实 Chromium 与目标测试均通过。

## 本次重开规划必须闭合的范围

1. **可证明的空结果与资料段解析（本 change 自有加法）**：在 C36 自有只读接缝内设计能证明「正式空结果」与「必审资料段可授权解析」的最小加法（例如按精确运行/冻结范围返回有界的存在性与可解析性证明），使准确率/覆盖度 TN 与审计链完整率只依赖确定性证据；不得复制上游领域事实正文、不得直读私表、不得把缺失证明当作通过。
2. **`grant → sourceVersion` 授权映射**：优先在**本 change 与 C36/C09 请求侧**解决——查询时按精确 `sourceVersionRefs` 请求授权，使 C06 签发的 `sourceAccessGrantRefs` 与摘要 `evidenceRefs` 可同形比对；若仍必须改动 C06 侧，只能做**加法**（新增精确映射/签发路径，不改既有签发语义、不新增 capability/角色/权限值），并在 design 中写明兼容边界。
3. **落地与证据**：`implementation-plan.md`/`tasks.md` 以新 IP-ID、允许文件清单与可运行验证命令展开上述两项；specs 补充对应场景（含缺失证明、跨空间/跨工程拒绝、并发与重放）。
4. **不做**：不改变已通过的权限模型与失败闭合语义、不改其它 change 的既有语义、不引入生产运行时依赖、不实现 C37/C38 范围。
5. 超出上述范围的公共契约、持久化、迁移或依赖变化必须先 escalation。

## 处置要求

规划者 MUST 先读取本记录并以其为批准输入，按 `orchestrated-delivery` 的 applyRequires 更新/补齐 proposal、specs、design、implementation-plan、tasks（保留既有已批准结论与审计记录，不改写本轮已通过的修复结论）；若认定任一项无法在批准范围内闭合，MUST 在规划工件中显式说明并升级。本记录是批准凭据，不是设计结论。
