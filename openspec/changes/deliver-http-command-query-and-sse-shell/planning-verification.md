# C09 OpenSpec 规划验证报告

## 检查点身份

- Change：`deliver-http-command-query-and-sse-shell`
- Task：`task_28cb84a9e5b3`
- Dispatch：`ctx_8b8552a43864`
- Worktree ID：`d4349f30-1c7e-4777-b16d-f259481b0121::/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c09-http-shell`
- Worktree：`/home/joshua/Workspace/Code/JavaScript/.orca/RiskFlow/c09-http-shell`
- Branch：`leike0813/c09-http-shell`
- Base / current HEAD：`800acf000e462d35c50b0347e993fc0b6e247921`

## 已读事实源

- 项目 `AGENTS.md`、`IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md`。
- `config/orchestration/execution-graph.json` 与路线 `openspec-delivery-roadmap.md` 的 C09/C10、执行门和目录所有权。
- C02、C03、C06 已归档主 specs 及对应归档 design；同时核对 C07 复核/审计和 C08 bounded Agent 主 specs/design 的公共边界。
- `openspec-new-change`、`openspec-continue-change` 与 Orca orchestration 本地技能说明；OpenSpec 的 proposal/specs/design/tasks 动态指令。

源码探索按要求先调用 `codegraph_explore`。工具返回“项目未建立索引/未发现 `.codegraph`”，并明确要求本 session 不再调用；工作区的 `.codegraph/` 实际仅有 `.gitignore`，没有图数据库，因此之后只对其 Additional relevant files 和 C02/C03/C06/C07/C08 公共接缝做了定向读取，没有以自由全库搜索替代语义探索。主调度后续应修复或重建 CodeGraph 索引，但该环境漂移不阻塞本次只写 OpenSpec 工件。

## 规划结论

本 change 新增单一 capability：`platform/http-command-query-sse-shell`。方案把 C09 限定为 `apps/api` 的薄传输层：闭合 Fastify command/query catalog、C06 Cookie 会话和逐请求授权、C02/C03 幂等/错误结果映射、只经 `ProjectionPortV1.subscribe` 的可恢复 SSE、同源与工程隔离、OpenAPI 同源派生、C07/C08 禁止旁路、上传早拒绝以及版本/证据/审计引用透传。

关键收口如下：

- 不直接读取 C03 Outbox 或任意数据库，不建立 C09 projection、游标表、内存序号或第二套幂等收据。
- 不引入任何包或版本；只声明锁文件中已有的 contracts/core/Zod，依赖清单和 lock importer 由主调度在 planning checkpoint 后单独处理。
- 不实现 C10 Web UI、客户端缓存、EventSource 生命周期、WebSocket、真实上传、监听进程或后台 Worker。
- C07/C08 只通过 C02 已冻结的 `ReviewAuditPortV1` / `AgentTaskPortV1` DTO 和方法暴露；缺少所属 port 时不注册空 route，也不降级旁路。
- Open Questions 已清零；实施若无法从 C02 Schema 无损派生 transport、需要直读数据库或增加依赖，必须退回更新设计。

## 文件清单

本 worker 只新增以下 C09 change 文件：

- `.openspec.yaml`
- `proposal.md`
- `design.md`
- `specs/platform/http-command-query-sse-shell/spec.md`
- `tasks.md`
- `planning-verification.md`

没有修改生产代码、package manifest、lockfile、主 specs、其它 change、路线图或 Git 历史。

## 自检结果

| 检查 | 结果 |
|---|---|
| `openspec status --change deliver-http-command-query-and-sse-shell` | 通过；4/4 artifacts complete |
| `openspec validate deliver-http-command-query-and-sse-shell --strict --no-interactive` | 通过；change valid |
| `git diff --check` | 通过；无空白错误 |
| C09 工件 `pnpm exec prettier --check ...` | 通过；全部符合 Prettier |
| 自定义结构检查 | 通过；5 个标准工件、11 requirements、39 scenarios、17 个合法未完成 task、Open Questions 已解决 |
| 路径范围检查 | 通过；`git status --short` 仅显示 C09 change 目录 |
| HEAD / branch / path 核对 | 通过；与上方检查点身份一致 |

报告加入后应再次运行相同 OpenSpec、空白、Prettier 和路径范围检查；最终结果以 worker_done 所报为准。

## 剩余主调度动作

1. 审阅本规划并提交 `docs(openspec): ...` planning checkpoint。
2. 如 API 实际 import 需要，在同一 feature branch 串行修改 `apps/api/package.json` 与 `pnpm-lock.yaml` importer，仅加入已锁定 workspace/Zod，并执行 frozen install、dependency policy 后提交 dependency checkpoint。
3. 按 handbook 派发 Luna max 实施；要求其仅改 `apps/api/src/**`、`apps/api/test/**`，完成最小验证和 `openspec-verify-change` 后请求主调度审阅。
4. 实现和独立验证通过后，再由主调度负责 checkpoint、合并、归档与 C10 解锁；本 worker 未执行这些动作。
