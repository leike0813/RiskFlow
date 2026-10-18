# 检索投影授权与父图版本修正提案

状态：用户已批准并要求继续验收。归属当前 change 的 IP-19/IP-21，记为 D-40；批准不代表验收通过。

## 两个已定位的阻塞

1. 新检索组合 `knowledge-release-f3951652-22eb-4b5d-918d-a0e729526c4d@1` 已经物理 Chrome 审核并正式独立发布。v22 Worker 使用新数据集后，投影实际抛 `DEPLOYMENT_AUTHORIZATION_DOWNSTREAM_REJECTED`；消费层将其映射为 `TRANSACTION_FAILED`。原事件探针进一步捕获 C06 `AUTHORIZATION_DENIED`，位于 `assertCommandCause`：代码只允许 `knowledge-modeling.identification-basis`，拒绝检索投影真实需要的 `knowledge-modeling.hybrid-evidence`。原 v19 事件的授权过期/耗尽另行保留，不与这个新拒绝混为一谈。
2. C03 启动绑定配对修复后，C30 已提交准备阶段、阶段结果、路由与 identification 运行状态，但随后检查点仍拒绝。`graphStateOf` 把 `cursor.entryIdentity.versionId` 写进图版本，和运行已冻结的真实 `cursor.graphVersion` 不同。部署校验器按精确图版本拒绝是正确行为。重放返回 existing、总览查询 200 且空列表均不代表业务成功。

实例探针、原事件及回执保存在 `run-20261014-physical` 的 `projection-repro-v22-*`、`business-chain-v21/`。不修改原失败、收据、授权或审计。

## 拟批准的修正

### C06 发布命令因果授权

只将既有发布命令因果授权的目标分支，从单个识别依据读取补充为两个明确分支：`knowledge-modeling.identification-basis` 与 `knowledge-modeling.hybrid-evidence`。后者仍映射已有 `knowledge-modeling.retrieve` 能力，不新增角色、能力枚举或通用授权入口。

两条分支均须核对真实人工 `publish-approved-release` 命令、原主体/工程、原发布权限、原上下文有效期、当前空间/资料权限以及目标分支已登记的精确派生关联；未声明关联、其它分支、错命令、错主体、越权或过期一律拒绝。不得拿 read 能力冒充 retrieve，也不得重绑已过期上下文或重置 Outbox 尝试。

补入文件：`packages/adapters/src/auth/postgres-local-identity-access.ts`、既有 `packages/adapters/test/auth/local-identity-project-authorization.test.ts`；必要装配回归仍在已有 `scripts/deployment/start.mjs`、`entrypoints.test.mjs` 范围内。新增当前 change 的 `specs/platform/local-identity-project-authorization/spec.md`，明确这项窄授权补充。

### C30 冻结图版本

将 `apps/worker/src/risk-flow/graph.ts` 补入 IP-21；`graphStateOf` 使用已登记 `cursor.graphVersion`，无该可选值时使用同运行的 `run.graphVersion`。不以入口摘要、当前最新图或部署的新图代替原运行版本，不改变状态 Schema 或恢复语义。

复用已在范围内的 `apps/worker/test/risk-flow/runtime.test.ts`，让检查点测试实际要求启动图版本，覆盖节点推进和恢复时精确版本保持；不再只用无条件通过的引用校验替身证明此边界。

## 验证与继续验收

同步 design/implementation-plan 与局部 delta。先复现两项拒绝，再运行 C06 真实数据库/部署授权及 C30 检查点回归，build、lint、format、strict/diff；冻结新制品后显式切换。原未完成工作流按所属正式恢复能力处理，不伪造恢复凭据；原检索事件仍处于允许重试范围时正常重投，已耗尽或过期则保留失败并走新发布。

继续取得双索引质量、识别风险输入、C11 准备、已批准 C19 组装/人工审核/独立发布及评估依据解析；这些业务结果均须单独留证，不能用工程检查替代。不增加依赖、迁移、表、HTTP 字段或 UI 改造。

批准点来自项目 `AGENTS.md` §3 的计划外授权契约/文件升级要求及施工图 §7；此前 C03 两文件授权不覆盖 C06 和 `graph.ts`。
