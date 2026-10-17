# Verification

## 验收对象

- Change：`simplify-trusted-business-flows`，任务6/6。
- 输入实现 HEAD 与当前 HEAD：`3a88273781a1f9473cbf2d813786799a0e7d7633`；实施结果在该基线之上的未提交工作区，不声称 HEAD 已包含改动。
- 验收：主会话整合核验；辅助实现会话分别负责 IP-02/IP-03 与 IP-04；Euler 执行本轮唯一一次权限/事务限定审查并完成范围内修复。

## 结论

**PASS：限当前工作区工程实现与隔离测试。** 无新增依赖、迁移或数据重写。未部署、未提交 Git、未同步归档主规格；正式 Git 交接及现场验收不是本结论。当前没有活动写入 Agent。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 命令与关键结果 | 结果 |
|---|---|---|
| IP-01：登记范围、深链、额外授权、当前撤权、冻结查询及稳定分页 | `pnpm exec vitest run packages/adapters/test/workflow`：70项；当前范围与正文读取、报告事务及撤权回归 | PASS |
| IP-01：历史范围只定位资源，当前账号决定访问 | `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts`：25项；真实C06从无来源声明恢复登记来源，账号停用仍拒绝 | PASS |
| IP-02/IP-03：重复/乱序、不同证据、父限制、串并发去重、事务、独立维护 | `pnpm exec vitest run packages/core/test/artifacts.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`：50项，含既有256MiB/并发与万条清单性能用例 | PASS |
| IP-01/IP-04：长游标输入/输出与实际quality续页，错查询及候选边界 | `pnpm exec vitest run packages/adapters/test/quality packages/contracts/test packages/adapters/test/identification/candidate-finalization/postgres-risk-candidate-adapter.test.ts`：132项 | PASS |
| IP-01/IP-04：HTTP/SSE及部署API接线 | `pnpm exec vitest run apps/api/test/http-shell.test.ts apps/api/test/sse.test.ts scripts/deployment/api-ports.test.mjs`：61项 | PASS |
| IP-01/IP-03：部署入口、远程工件与工作流服务兼容 | `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/core/test/workflow/service.test.ts`：123项 | PASS |
| IP-02：校准去掉工件边界重复整理 | `pnpm exec vitest run packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`：22项 | PASS |
| IP-01：真实浏览器深链、预览、下载及新报告生成不携来源声明 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/agent-audit-operations.spec.ts --grep '报告导出' --retries=0`：最终2项/38.1秒通过；新生成报告条目与原冻结查询相同 | PASS |
| IP-05：构建与类型 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`、审查修复后 `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsc -b packages/adapters --pretty false` | PASS |
| IP-05：代码质量与规格 | `pnpm lint`；最终报告源/浏览器定向eslint；`pnpm format:check`；`pnpm deps:check`；`openspec validate --all --strict --no-interactive`：45项；`git diff --check` | PASS |

上述单元/集成测试合计483项，不重复计入审查期定向复跑。浏览器2项单独计数。既有性能用例实际执行通过，没有同条件减负前测量，不声称加速比例。

实施中首次写入的 ENOENT 被错误包装，已恢复到原落位分支；初次quality CLI和browser因此失败，重建后完整相关命令通过。原测试中锁定正文重签发的断言已删除，重复读取、范围、撤权与结果行为保留。格式检查一次遇到 `.codegraph` 临时锁消失的ENOENT，未改格式规则，后续同命令通过。

## 限定审查

范围为登记范围与当前权限分离、C31冻结范围、C35内部授权复用、C04用途/来源及父引用事务。Euler发现导出循环仍收到原始请求上下文，已在同一任务内修正为当前按登记资源检查后的上下文。授权/投影40项及报告9项通过；主会话随后增加无来源声明的新导出浏览器验证，最终2项通过。未增加权限开关、配对凭据或证明收据。

审查期间候选并发插入用例在组合运行中失败一次，定向复跑通过；主会话完整相关132项也通过，未据此改变业务并发策略或增加低概率重试逻辑。

## 后续注意事项

本轮不发现系统外同长度文件替换；独立维护/备份恢复仍核验完整性。DD-04引用语义、DD-06错误诊断及D176现场C31 500未宣称解决。原功能验收 change 继续承担现场、完整业务链及Electron证据。本轮未运行全仓verify或完整浏览器/Electron套件，不能替代它们。
