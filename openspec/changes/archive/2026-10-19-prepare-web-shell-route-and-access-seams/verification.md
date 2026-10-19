# Verification

## 验收对象

- Change：`prepare-web-shell-route-and-access-seams`（`orchestrated-delivery`）。
- 规划基线：`f2561cdcc0a5f9b6bfa5fec4302382e9421575ae`。
- 输入实现 HEAD：`11aad44d9dcadee03ad11a5e18d5250a3d80026f`；接管时工作区干净。
- 最终验收 HEAD：仍为 `11aad44d9dcadee03ad11a5e18d5250a3d80026f`，叠加本轮未提交修复与工件。结论针对当前工作树，不把未提交内容冒充已形成的 Git 交接检查点。
- 验收 Agent：主会话 Finalizer；`TargetedAudit` 执行本轮唯一 AUTHZ／POLICY-HISTORY／CONFIRMATION-STATE 独立限定审计；`RouteRegionScout` 只读核对 IP-03。
- 已完整读取 apply 返回的 proposal、七份 delta、design、implementation-plan、tasks，核对相关主规格与生产实现、调用方及既有测试。
- 环境：Node.js 24.12.0、pnpm 11.10.0、真实 PostgreSQL 容器、正式 Web 构建、HTTP／安全 Cookie、Chromium 153.0.8010.12。业务输入为隔离合成样本，待甲方复核；未连接现场数据库或模型。

## 结论

**PASS**。

本 change 的当前交付范围与 IP-01～IP-07 已闭合；最终单元／集成回归 294/294、五份正式浏览器规格 100/100、原生六组合交互均通过，无关键跳过、待执行审计或未解决缺陷。构建、类型、lint、格式、依赖边界与依赖政策通过，OpenSpec strict 通过。

SH-S02 的最终六导航组合与 SH-S10 的后续业务地址转换，按 D-01／D-04 只核验本次没有提前启用；其未来正向交付仍归 CH-7／CH-9，不计作本 change 已实现的功能。待办聚合没有伪端口、空成功或假计数。

## 核验与修复证据

### 实际执行命令

| 编号 | 命令／范围 | 最终结果 |
|---|---|---|
| C-01～C-04 | 下列 Vitest 合并命令 | 17 个文件，294 项通过，无跳过 |
| C-05 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | 退出 0，正式 Web 构建成功 |
| C-06 | 下列 Playwright 五规格命令 | 100 项通过，无失败、重试或跳过；read-only 23、identification-review 14、assessment-warning-response 40、agent-audit-operations 15、quality 8 |
| C-07 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy` | 全部退出 0；702 个模块，无依赖违规 |
| C-08 | `openspec validate prepare-web-shell-route-and-access-seams --strict --no-interactive` | 通过 |
| 原生操作 | `DISPLAY=:109 node apps/web/test/browser/native-zoom.mjs` | 6/6 通过；见 `evidence/native-zoom.json` 与 12 张完整截图 |
| 最后测试工件检查 | `pnpm exec prettier --check apps/web/test/browser/native-zoom.mjs apps/web/test/browser/business-server.mjs apps/web/test/browser/agent-audit-operations.spec.ts` 及同三文件 `pnpm exec eslint` | 全部退出 0 |

```sh
pnpm exec vitest run packages/contracts/test packages/core/test/access.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs apps/web/test/routing-context-actions.test.ts apps/web/test/business-routes.test.ts apps/web/test/ssr-shells.test.tsx apps/web/test/quality.test.tsx apps/web/test/confirmation.test.ts apps/web/test/design-system.test.tsx apps/web/test/api-client-openapi.test.ts apps/web/test/focus.test.ts

pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/identification-review.spec.ts apps/web/test/browser/assessment-warning-response.spec.ts apps/web/test/browser/agent-audit-operations.spec.ts apps/web/test/browser/quality.spec.ts
```

### Requirement／Scenario／IP 映射

表内测试路径省略的前缀分别为 `apps/web/test/` 与 `apps/web/test/browser/`；C 编号对应上表的真实执行结果。代码核对与运行证据分开说明，不将只读调查计作执行场景。

| Requirement／全部所属 Scenario | IP-ID | 实现与证据 | 结果 |
|---|---|---|---|
| 按承载就绪分阶段启用六导航：SH-S01、SH-S02、七项导航与路由一一对应、未交付根页面不伪装业务能力、未登记路径安全失败 | IP-03／04／07 | `shell/navigation.ts`、`app/routes.ts`、`app/business-routes.ts`；business-routes／routing-context-actions／SSR 与 C-06 原入口和历史深链。六导航和新业务转换未提前启用 | PASS |
| 工程空间工序上下文原子切换：切换工程清旧内容、切换空间或工序保持页面、无工程不发业务读取 | IP-02／04／07 | `main.tsx`、`app/App.tsx`、原 context reducer；routing-context-actions；C-06 工程切换、迟到响应、空工程与系统管理员无工程管理 | PASS |
| 页面区域组合共享有限状态：SH-S03、加载不闪为空态、空态只有真实下一步、技术异常仅安全摘要 | IP-03／07 | route 与 PageFrame 共用唯一 `PageRegionDescriptorV1`；`RiskOverviewPage` 实际多区域；SSR／quality；C-06 三来源分别失败、精确投影及用户续页 | PASS |
| 独立权限停靠贡献：SH-S04、跨页保持停靠、来源正文脱敏、未接入 Agent、Agent 仅展示获准可审计内容 | IP-02／04／07 | `RightDock`、唯一 `AgentTaskProvider`、服务端能力投影；SSR 独立能力输入；C-06 共享任务、撤权、脱敏、真实 reviewer 零 Agent 读取仍可复核 | PASS |
| 统一确认：普通确认一次、高影响额外确认、无权不可提交、陈旧版本失败、无工程系统管理、SH-S05 | IP-05／06／07 | `confirmation.ts`、ConfirmButton／唯一 Dialog、业务／管理／Agent 调用方；嵌套冻结、scope 与输入失效、迟到响应、双击单在途、批量部分失败及终止错误优先回归；C-06 原正文重试、取消零写、六项管理、密码释放 | PASS |
| 键盘与焦点：键盘导航、停靠键盘、确认焦点收口、SH-S06 | IP-04／05／07 | focus／SSR、C-06 真模态与 Tab 环绕；原生三窗口×两缩放逐项操作及完整截图；导航 152／48px、停靠 352px，取消首焦点与关闭后恢复均断言 | PASS |
| SH-R1 精确路由与别名：SH-S07、SH-S08、SH-S09、SH-S10 | IP-03／07 | 注册形状拒绝、首差异段静态优先、base 精确替换、别名目标存在、编码身份／完整查询串；新增根 `/` 查询保全和已注入质量别名回归。SH-S10 本次只核验原独立行动与旧历史地址未被提前转换 | PASS |
| AC-R1 独立聚合入口：AC-S01、AC-S02、AC-S03、AC-S07、AC-S08 | IP-01／02／07 | contracts／core access／真实 auth adapter 回归：角色精确增量、reviewer 无 Agent、来源与工程隔离、v1 历史解析、当前撤权与不重写旧行；C-06 真实原件、角色降级与精确历史读取 | PASS |
| AC-R2 当前服务端能力呈现：AC-S04、AC-S05、AC-S06 | IP-02／04／07 | adapter／HTTP／client 回归；`main.tsx` 按会话精确身份、工程、revision 隔离，路由／前台刷新同代合并；C-06 故障重试、切工程、迟到响应及真实 reviewer | PASS |
| HT-R1 Cookie 能力出口：HT-S01、HT-S02 | IP-01／02／07 | HTTP shell／api-client-openapi／deployment api-ports；独立注入、严格 DTO、Cookie、伪造 query、未知工程、no-store、缺实现不激活；原 session 响应不扩形 | PASS |
| engineering-and-knowledge 的七态：无权知识页、查询失败重试 | IP-03／04／07 | SSR／quality 与 C-06 read-only 的真实来源权限、技术故障、重试和脱敏；没有新增导航授权交集 | PASS |
| engineering-and-knowledge 的正式浏览器验收：真实只读链路、环境不可用明确失败 | IP-07 | C-06 正式 dist＋真实 HTTP／PostgreSQL／Cookie，无 skip；启动异常向 CLI 外抛的边界已核对，本轮未人为破坏可用数据库。实际验收失败均非零退出并保存 trace，不冒充通过 | PASS |
| identification-and-review 的七态及旧复核：无权识别页、查询失败重试、UI-S01 | IP-03／04／06／07 | C-06 identification-review 14 项；原队列、类型化决定、精确版本、证据及批量失败项原载荷重试保留 | PASS |
| assessment-warning-response：真实数据与页面可达、工程切换与失败、UI-S02 | IP-03／04／06／07 | C-06 assessment-warning-response 40 项；真实历史矩阵冻结版本、预警确认、建议采纳、独立执行、反馈、偏差与未发布校准草案，原权限及来源约束不变 | PASS |
| agent-audit-operations：原分区接线、刷新切换与异常、UI-S03 | IP-02／04／05／06／07 | C-06 agent-audit-operations 15 项；真实 reviewer 无 Agent 仍可开精确复核与原决定确认，六项管理、撤权、共享任务及报告只读下载均通过 | PASS |

### 本轮直接修复

1. **能力读取生命周期（IP-02／04）**：`main.tsx` 原先没有路由／前台刷新，正式页面实测焦点和路由变化后的 access 请求数均为 0。现消费 Router location，按完整会话／账号引用与工程 revision 隔离快照；同代在途合并、换 scope 立即隐藏旧呈现并 abort，失败显式重试。浏览器新增回归覆盖路由、重复 focus 合并和故障恢复；修复后独立 smoke 的前台读取为 1。
2. **路由查询与区域 SSOT（IP-03）**：根 `/` 丢 search 的新增回归先失败，实际得到裸 `/overview`，修复后通过；同时保留完整查询串而非按多个问号截断。删除重复 `WebRegionKindV1`／`WebRegionDescriptorV1`，全部 route、business、quality 贡献与测试夹具改用带稳定 key 的 `PageRegionDescriptorV1`，补齐 PageRegions barrel 导出。删除 `hasExactlySevenBusinessNavigation` 与旧 shellKind／固定数量／类名断言，不改用另一组计数锁定实现。
3. **布局与授权收起（IP-04）**：网格显式定位页头和第二行，限制区域高度、各自滚动；关闭停靠不另占第三行或保留空栏。RightDock 因权限拒绝关闭时同步父壳层状态。页头与停靠开启按钮使用现有前景／卡片令牌，避免深底黑字。验收期间一版网格调整引入了隐式行覆盖，造成三条注销交互失败；明确 grid-row／column 后三条单独及最终全组均通过，未用 force click 绕开。
4. **确认失效与秘密释放（IP-05／06）**：输入／pathname 变化不再仅比较相同 scope；scope 比较包含 session entityId／versionId 和系统账号 versionId。管理页用当前真实管理身份限制 system scope，通过最小可选 `onClosed` 通知释放取消／失效的口令及意图；成功仍走所属回调。口令不进入摘要或 fingerprint。相关设计和施工图仅补充落实既定密码释放要求的内部接缝。
5. **原信封与批量部分失败（IP-05／06）**：管理 `issuedAt` 从 send 移到 prepare 固定，完整重试信封一致。批量只在打开确认时构造逐项请求，保留成功结果，仅重发失败项原信封，不把部分失败当整批成功。混合暂时失败与 `STALE_VERSION`／`IDEMPOTENCY_CONFLICT` 的两项新增回归先失败、修复后通过，终止错误优先销毁旧计划。
6. **Agent Hook 顺序（IP-06）**：`AgentLaunchPanel` 的确认 scope Hook 移到条件 return 之前，避免上下文从未就绪到就绪时改变 Hook 顺序。
7. **原生证据（IP-07）**：既有取证脚本限定唯一窗口 class，断言真实外窗口、CSS viewport 与 DPR；缺少确认入口不再以 false 值写成功工件，取消零写与失败请求计数直接观测。在滚动已位于末端时改为向反方向实际滚动，避免饱和误报。原生 200% 下普通自动截图的旧 DPR clip 会裁掉半屏，现用无 CSS clip 的 CDP 截图保存完整可视区域，并断言错误位于视口内。

首轮 C-06 的三份注销失败 trace 及截图保存在 `evidence/browser-failures/`（仅含合成验收账号与样本）。最终 C-06 无失败，也未以旧截图作为本轮原生证据。原生证据中 1920×1080／100% 的横向 `overflow=false, scrolled=false` 为真实无溢出；其余五组合均实际发生局部横向滚动；全部组合无文档级横向溢出。

## 限定审计

本轮独立限定审计仅一次，由 `TargetedAudit` 在固定输入检查点执行并直接修复范围内问题，未另起第二轮 Auditor 或把普通缺陷退回首轮实现角色。

| 标签 | 审计结论与最终收口证据 |
|---|---|
| AUTHZ | PASS：入口能力不替代工程／空间／来源授权；reviewer 没有 Agent 分支；纯系统管理员不因空业务能力获得业务权。真实当前授权、跨工程、撤权、原件与 reviewer 浏览器场景通过。 |
| POLICY-HISTORY | PASS：只识别登记 v1／v2 策略恢复历史范围，当前业务／管理权限仍从当前事实判断；新决定 v2，旧授权／审计行不改。真实 adapter 回归增加移除成员后拒绝、历史范围仍可解析且旧行保持 v1。 |
| CONFIRMATION-STATE | PASS：审计发现并修复输入失效、scope 精确比较、批量部分失败、管理时间重造、密码释放与 Hook 顺序；Finalizer 补修混合错误的终止优先级，完成受影响回归、100 项真实浏览器与原生六组合取证。冻结、generation、单在途、取消、原载荷重试及 system 无伪工程均有证据。 |

## 后续注意事项

- 未提交 Git、未同步主规格、未归档；后续角色应审阅本轮未提交修复与证据后形成真实交接检查点，再按项目流程集成和归档。
- 本次执行的是施工图列明的范围内回归与门禁，未运行主线全仓 `pnpm verify`；该集成门禁仍归后续集成阶段。
- 未进行现场部署、跨 VM／GPU 或模型功能取证；这些不属于本 change。当前六导航最终组合、待办聚合与新业务地址转换仍属于后续 owning change。
- 临时 smoke 服务、独立显示环境、浏览器页签与探针已关闭／移除，保留的只有本 change 证据和永久回归。
