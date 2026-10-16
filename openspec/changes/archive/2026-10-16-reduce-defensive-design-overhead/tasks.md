## 1. 业务动作入口权限

- [x] 1.1（IP-01；D-01/D-02）核对baseline及共享调用方，完成统一入口、后台任务主体与内部授权消费；验证 `pnpm typecheck` 和施工图IP-01列出的C06及宿主测试，确认长任务跨旧TTL继续、当前撤权在下一动作生效、差异可见性保持。
- [x] 1.2（IP-01）删除逐层签发、逻辑/实际ID配对与其专用断言，完成API/Worker接线；验证 `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/api-ports.test.mjs`，检查业务角色不因控制命令获得额外权限。

## 2. 读取与文件消费

- [x] 2.1（IP-02；依赖1；D-03）将普通访问与已有对象查询改为独立访问记账；验证 `pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`，覆盖同任务跨文件、同资料重复读取和新登录授权。
- [x] 2.2（IP-02；D-04）取消日常全文验真，统一completed消费终态并更新本地/远程/原件/模型所有调用点；验证 `pnpm exec vitest run packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts packages/adapters/test/artifacts/remote-artifact-store.test.ts apps/api/test/http-shell.test.ts`，确认多块内容、取消及独立维护核验。

## 3. 知识检索

- [x] 3.1（IP-03；依赖2；D-05）解除索引与全部授权摘要耦合，双路召回前按可见成员过滤，直接读取原上下文；运行施工图IP-03五项既有测试，确认新增无关资料后原代际继续检索、可见范围和原质量门槛保持。

## 4. 阶段续办与正常等待

- [x] 4.1（IP-04；依赖2；D-06）删除检查点递归举证和库内部metadata白名单，按已提交阶段结果续办；验证 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts apps/worker/test/identification/graph/runtime.test.ts apps/worker/test/identification/graph/nested-boundary.test.ts`，覆盖I6先提交、重复恢复与取消。
- [x] 4.2（IP-04；D-07）闭合business-preparation等待/恢复及缺项展示；验证 `pnpm exec vitest run apps/worker/test/assessment/runtime.test.ts apps/worker/test/risk-flow/runtime.test.ts`，确认补齐后续办、旧终态和预算保留。

## 5. 配置与阶段输入

- [x] 5.1（IP-05；依赖2；D-08）单向运行清单、唯一预算引用及批准与软件release解耦；验证 `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs packages/adapters/test/deployment/config-operations.test.ts`，复用旧配置reader并更新示例。
- [x] 5.2（IP-05；D-09）新增V2评分快照，C18按purpose解析，预警/处置/预测/偏差/校准分别冻结自身策略；运行施工图IP-05对应数据库与组合测试，另以 `pnpm typecheck` 确认所有下游消费方已迁移，旧评估可重放。
- [x] 5.3（IP-05）允许协议/模型能力一致的Ollama同主次补丁版本，记录实测值；验证 `pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts`，实际模型摘要与维度不符仍明确拒绝。

## 6. 模型工具及资料质量

- [x] 6.1（IP-06；依赖3/4/5；D-10）接sourceOption、宿主分页及既有候选纠错循环，真实结算结构错误消耗；验证 `pnpm exec vitest run apps/worker/test/agent-runtime/runner.test.ts apps/worker/test/engineering-data/cleaning/runtime.test.ts packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts`，无第二套重试循环。
- [x] 6.2（IP-06；D-11）按inputKind执行质量规则，移除通用全段留存和版本允许清单；验证 `pnpm exec vitest run packages/core/test/engineering-data/cleaning.test.ts packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts packages/core/test/identification/candidate-finalization.test.ts`，覆盖CSV、正常空白页、部分可用与关键数值保持。

## 7. 查看与错误反馈

- [x] 7.1（IP-07；依赖3/4/5；D-12）短上下文ID、旧引用读取、共享合法游标和精确详情；验证 `pnpm exec vitest run packages/adapters/test/agent-runtime/postgres-agent-task-adapter.test.ts apps/web/test/ssr-shells.test.tsx`。
- [x] 7.2（IP-07）技术异常显示真实错误并结束加载，保持单在途刷新和键盘交互；验证 `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/agent-audit-operations.spec.ts`，覆盖旧任务深链、正常续页和重试。

## 8. 确定性组合与交接

- [x] 8.1（IP-08；依赖全部前组；D-13/D-14）完成发布来源V2、唯一000059迁移及旧人工记录reader；验证 `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-adapter.test.ts packages/adapters/test/knowledge-governance/postgres-knowledge-governance-read.test.ts`，覆盖旧库升级和两种发布来源。
- [x] 8.2（IP-08）接C17/C19确定性派生事务与正式assemble结果，保留内容审核和人工采纳；运行施工图IP-08治理、评分规则、知识、HTTP及父图测试，确认不同适用性并存、重复提交无重复发布、无虚假人工批准。
- [x] 8.3（IP-01～IP-08；D-15/D-16）更新部署说明与原验收交接，完成 `NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`、`pnpm test:browser`、`pnpm test:deployment`；复查全部Requirement/Scenario和文件映射，保留实际失败而非预填完成。
- [x] 8.4（IP-08）由Finalizer核验、范围内修复及一次权限/事务/恢复限定审计后形成verification；完成条件为最终实际检查点、全部本change证据及审计一致。原5/19的剩余物理业务验收按handoff接续，单独留证。
