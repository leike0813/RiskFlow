> 本 change 使用内置 `spec-driven`，没有 `implementation-plan` artifact；以下本地 IP-ID 直接映射 design 的 D-ID，供实现与验证逐项引用。

## 1. 扩展预警确认公共契约

- [ ] 1.1 **IP-01（D-01～D-04）**：修改 `packages/contracts/src/ports/index.ts`，在 `MODULE_BRANCH_CAPABILITY_V1` 增加 `warning-response.acknowledge → warning-response.record`，在 `WarningResponseRecordCommandV1Schema` 增加 payload 仅含 `warningRecordRef`、`warningResponseTaskRef` 的 `acknowledge` 分支，在 `WarningResponseRecordSuccessV1Schema` 增加只含 `kind=acknowledgement`、`status=acknowledged` 与同一双引用的结果分支；不得修改 `OpenWarningCommandV1Schema`、`OpenWarningSuccessV1Schema`、既有 record 分支或 `WarningResponsePortV1` 方法集合。完成后运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，通过条件为零 TypeScript 错误。
- [ ] 1.2 **IP-02（D-05）**：修改 `packages/contracts/src/events/index.ts`，在 `DomainEventV1Schema` 增加 payload 仅含预警/任务精确引用的 `warning.warning-acknowledged.v1`，用分支本地 `.superRefine(...)` 保证 `aggregateRef` 与任务引用 kind/entityId/versionId 一致；不得增加 acknowledgement 实体引用、通知意图或业务正文。完成后运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false`，通过条件为零 TypeScript 错误。
- [ ] 1.3 **IP-03（D-01～D-05、D-07）**：修改 `packages/contracts/test/module-interfaces-events-workflows.test.ts` 的现有表驱动用例，覆盖新 branch/capability、合法命令、结果和事件，以及缺失/错误引用、契约外风险解除/任务关闭/通知/正文、越权能力和事件 aggregate 不一致的 strict 拒绝；保留既有 open、建议采纳、执行、反馈、偏差、不可用、校准及事件用例。完成后运行 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`，通过条件为该文件全部测试通过且断言不锁定完整文案、字段顺序或内部调用顺序。

## 2. 同步 C09 单一路由登记

- [ ] 2.1 **IP-04（D-06）**：修改 `apps/api/src/http.ts`，只在 `HTTP_ROUTE_CATALOG_V1` 中绑定 `WarningResponseRecordCommandV1Schema`、`WarningResponseRecordResultV1Schema`、`warningResponse`、`invokeWarningRecord` 的既有 `commandRoutes(...)` 数组增加 `["warning-response.acknowledge", "acknowledge"]`；不得新增 invoker、handler、route catalog、OpenAPI 清单或修改 `apps/api/src/app.ts`。完成后运行 `pnpm exec tsc -b --pretty false`，通过条件为全仓 TypeScript project references 零错误。
- [ ] 2.2 **IP-05（D-03、D-06、D-07、D-09）**：修改 `apps/api/test/http-shell.test.ts`，复用现有 `appFor`/access stub 并增加最小 `WarningResponsePortV1` 替身；用 Fastify inject 验证确认 route 只调用 `record()` 一次、授权 branch 为 `warning-response.acknowledge`、服务端组装 project/actor/authorization、命令身份和双引用无损传递、成功响应只含状态与精确引用、伪造/契约外字段在授权及 port 前失败，以及活动 route 与 OpenAPI 同源。完成后运行 `pnpm exec vitest run apps/api/test/http-shell.test.ts`，通过条件为该文件全部测试通过且不使用完整 OpenAPI snapshot 或文案断言。

## 3. 验证兼容性、质量与范围

- [ ] 3.1 **IP-06（D-07、D-08）**：依次运行 `pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false` 与 `pnpm exec vitest run packages/contracts/test/module-interfaces-events-workflows.test.ts`；通过条件为 contracts 编译和定向契约测试全部成功，既有预警/处置分支没有回归。
- [ ] 3.2 **IP-07（D-07、D-08）**：依次运行 `pnpm typecheck`、`pnpm exec vitest run apps/api/test/http-shell.test.ts` 与 `pnpm lint`；全仓 typecheck 必须先完成，使 workspace package 的 project-reference 产物可供 HTTP 测试解析。通过条件为全仓类型检查、HTTP 壳层定向测试和 ESLint 全部通过，特别是 `DomainEventV1` 新联合分支未造成未处理的穷举消费者。若失败指向计划外消费者，不得顺手修改，停止并升级主调度 Agent。
- [ ] 3.3 **IP-08（D-08）**：运行 `pnpm exec prettier --check packages/contracts/src/ports/index.ts packages/contracts/src/events/index.ts packages/contracts/test/module-interfaces-events-workflows.test.ts apps/api/src/http.ts apps/api/test/http-shell.test.ts`、`pnpm deps:check` 与 `pnpm deps:policy`；通过条件为五个改动代码文件格式合规、依赖方向无违规、依赖政策通过且 manifest/锁文件没有变化。
- [ ] 3.4 **IP-09（D-08、D-10）**：运行 `openspec validate evolve-warning-acknowledgement-command --strict --no-interactive` 与 `git diff --check`；再运行 `git diff --name-only -- packages/contracts apps/api openspec/changes/evolve-warning-acknowledgement-command` 和 `git status --short`。通过条件为 OpenSpec strict 校验及 diff 检查通过，代码范围只含 `packages/contracts/src/{ports,events}/index.ts`、`packages/contracts/test/module-interfaces-events-workflows.test.ts`、`apps/api/src/http.ts`、`apps/api/test/http-shell.test.ts` 和本 change 工件；`apps/web`、迁移、migration provider/runner、中央迁移注册与测试清单、根 workspace、锁文件、依赖政策、`openspec/config.yaml`、主 specs 及其它 change 均无修改。

## 4. C26/C34 接口交接

- [ ] 4.1 **IP-10（D-02～D-05、D-09）**：按 `design.md` D-09 核对 C26 恢复规划可用接口：`WarningResponseRecordCommandV1` 的 `kind=acknowledge` + 双精确引用 payload、`WarningResponseRecordResultV1` 的 `kind=acknowledgement/status=acknowledged` + 双精确引用结果、`warning.warning-acknowledged.v1` 双引用事件，以及 `POST /api/v1/projects/{projectId}/commands/warning-response.acknowledge`；通过条件为 contracts 导出与 C09 catalog 可直接被 C26/C34 消费，且没有通知意图前提、风险解除、任务关闭、处置结论或第二套入口。
- [ ] 4.2 **IP-11（D-08、D-10）**：最终确认未实现 C26 归集/通知、C34 页面、真实 adapter、评估/矩阵/触发逻辑、其它命令、依赖或迁移；通过条件为 `git diff --name-only` 与 3.4 的允许清单完全一致。若实现需要迁移，停止并向主调度 Agent escalation 申请从 `000048` 起的号段，不自行修改迁移区域。
