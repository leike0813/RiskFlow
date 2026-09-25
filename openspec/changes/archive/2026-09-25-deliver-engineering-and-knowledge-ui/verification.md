# Verification

## 验收对象

- Change：`deliver-engineering-and-knowledge-ui`
- 输入实现 HEAD：`6cd2e0adadc4469f30b5cc6d2b64541c27edf19d`
- 最终验收 HEAD：`6cd2e0adadc4469f30b5cc6d2b64541c27edf19d`
- 验收 Agent：Kimi Code（本收尾会话）

说明：按用户裁决，本 change 全程不提交 Git；实现以未提交工作区形式存在（38 个已跟踪文件修改、另含 `demo/src/api/`、`demo/test/`、`openspec/changes/deliver-engineering-and-knowledge-ui/` 等未跟踪新增），输入实现 HEAD 与最终验收 HEAD 为同一基点，验收期修复均落在该工作区内。

## 结论

**PASS**。全部 19 条 Requirement、IP-01～IP-11 的实施与证据闭合：Playwright 浏览器验收 11/11 全绿（真实 Chromium + 正式 HTTP 接缝 + testcontainers PostgreSQL + 生产迁移 + 真实种子），受影响契约/适配器/应用测试全绿（contracts 11、apps/api + contracts 92、adapters 五套件 247 passed / 1 skipped），全量验证（typecheck、lint、format:check、build、demo build、openspec:validate 36 passed、本 change `openspec validate --strict`）全部通过。范围内缺陷已在验收期修复并回归（见下），无待执行的限定审计。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
|---|---|---|
| 页面必须只经既有 HTTP 只读面取得业务事实（web） | `demo/src/api/` 全部经 HTTP client；`packages/contracts/src/ports/index.ts`、`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts`、`postgres-monitoring-store.ts`、`knowledge-governance/index.ts`、`identification/context/index.ts` 及对应测试；adapters 五套件 | 通过（247 passed / 1 skipped） |
| 会话与工程上下文必须显式且可切换（web） | 用例「未登录跳转登录页，登录后回到原目标页」；`demo/src/api/context.ts` 的 `useProjectPath` 保留 `?project=` | 通过 |
| 空、加载、异常、权限四类骨架行为必须逐页一致（web） | 用例「viewer 无检索读取权限时呈现权限骨架」「无知识读能力角色打开机理库页呈现权限骨架」；`PageStateView.tsx` | 通过 |
| 证据抽屉必须经 evidence-access 呈现脱敏两态（web） | 用例「资料目录与详情呈现登记事实，证据抽屉呈现定位」「无资料授权时证据抽屉呈现固定脱敏提示」（段正文不呈现，D10） | 通过 |
| 工程概览页必须呈现当前上下文与发布集合（web） | 用例「工程概览呈现真实上下文、适用性三维与发布集合」 | 通过 |
| 资料目录与资料详情必须呈现登记、解析与清洗事实（web） | 用例「资料目录与详情呈现登记事实，证据抽屉呈现定位」 | 通过 |
| 监测序列详情必须呈现快照与越限事实（web） | 用例「监测序列详情呈现冻结快照统计与批次事实」；`MonitoringSnapshotCatalogItemV1Schema` 契约测试（contracts 11 通过） | 通过 |
| 工序模型页必须呈现已发布模型与证据定位（web） | 用例「工序模型页呈现已发布模型与必含五节点覆盖」（必含 5 节点逐一点名） | 通过 |
| 知识治理四页必须呈现列表、详情与版本事实（web） | 用例「知识治理四页呈现真实发布事实且无写入口」；治理六型 release 读取均 200 | 通过 |
| 检索结果查看页必须只呈现已登记检索事实（web） | 用例「检索结果深链呈现关系上下文；viewer 无检索读取权限」 | 通过 |
| 跨页深链与版本追溯必须使用领域标识（web） | 用例「检索结果深链呈现关系上下文」「viewer 可查看知识治理页但不具备追溯投影权限」；`AssociatedObjects.tsx` | 通过 |
| 浏览器验收必须使用真实浏览器与正式接缝（web） | `pnpm exec playwright test -c playwright.config.ts --project=demo-chromium`（`demo/test/browser/server.mjs` + `read-only.spec.ts`） | 通过（11/11，42.6s） |
| C32 查询结果再读取必须有界且复验当前授权（domain） | `packages/core/src/access/policy.ts` + `packages/core/test/access.test.ts`；adapters read-result 测试 | 通过 |
| C32 工程上下文与资料监测目录只读必须有界（domain） | adapters engineering-data 套件（context-source、monitoring） | 通过 |
| C32 知识治理只读必须覆盖列表、精确读取与当前发布集合（domain） | adapters knowledge-governance 套件 | 通过 |
| C32 检索结果再读取必须限于已登记检索事实（domain） | adapters identification 套件 | 通过 |
| C32 投影结果读取必须沿既有端口语义公开（domain） | `packages/adapters/test/workflow/postgres-workflow-projection.test.ts` 等 workflow 套件 | 通过 |
| C32 只读查询分支必须登记在闭合路由清单（platform） | `apps/api/test/http-shell.test.ts`；apps/api + contracts 共 92 通过 | 通过 |
| C32 只读分支必须复用既有传输信封与失败形态（platform） | 同上；demo client `sourceVersionRefs` 信封声明 | 通过 |
| IP-01～IP-11 全量验证 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` / `lint` / `format:check` / `build` / `--dir demo build` / `openspec:validate`（36 passed）/ `openspec validate deliver-engineering-and-knowledge-ui --strict --no-interactive` | 全部通过 |

### 验收期修复

1. `apps/api/src/app.ts` / `http.ts`：HTTP authorize 的 invocationId 由 requestId 改为领域 commandId/queryId——C06 verify 绑定同一调用身份，否则下游 port 复验必拒；apps/api 既有测试用 stub access，从未暴露该缺陷。
2. demo client：`postQuery`/`submitQuery` 增加 `sourceVersionRefs` 信封声明；触达资料正文的查询（source-segments、evidence-access、monitoring-snapshot 登记与 read-result）必须声明来源版本，否则父上下文无 grant、verify.narrowing 失败。C06 对 requireBody=false 分支在声明含不可读来源时返回零 grant 的脱敏上下文（全有或全无），客户端只声明真实触达的来源。
3. 契约加法：`MonitoringSnapshotCatalogItemV1Schema` 新增 `evidenceSourceVersionRefs`（本 change 自有契约，apply 期内调整）；catalog 适配器从快照证据引用填充；`MonitoringDetailPage` 据此精确声明（弃用"声明全目录"方案）。
4. demo `readMonitoringSnapshot` 分支名修正为 `engineering-data.monitoring-snapshot-query`（原误用 command 分支名）。
5. demo 工程内跳转保留 `?project=`：新增 `useProjectPath` hook，DocumentList/MonitoringDetail/EvidenceDrawer/AssociatedObjects/SectionTabs 全部改带查询串（原跳转丢工程上下文显示"未选择工程"）。
6. operations 视图修正：规则集 applicability 为单值（新增 ApplicabilityMetadataView）、ruleVersion 取 `.versionId`、`asScoringRuleMember` 的 `binding.sourceVersionRef` 为 kinded ref 需取 `.reference`。
7. harness 种子修正：revise-membership 的 spatialScopeRefs 需 min(1) 且移到 baseAuth 之后；registry 构造注入 monitoringStore；新增 createApplicabilitySnapshot（交付硬依赖）；资料元数据补 applicabilityMetadataSnapshotRef；评分规则 binding.sourceVersionRef 补 kind 包装；措施库 applicabilityConditions 按维度码点排序；治理六型种子正文全部经适配器解析验证。
8. harness 稳定性：PG 池 teardown 57P01 噪声——`server.mjs` 模块级 uncaughtException 守卫（仅 tearingDown 时吞）+ 经共享原型给 pg.Pool 挂空 error 监听（Playwright 自身监听会把 uncaught 计为失败，仅吞不够）；closeable 关闭失败改为 console.error 不静默。
9. 清理：`demo/src/content/context.ts` 删 notificationCount/mechanismTypes/MechanismType；`content/knowledge.ts` 删 measureEntries/MeasureEntry（均无引用）；删适配器两个未使用的 `now` 选项与 `#readResult` 的未用 decision 参数（含两个测试调用点同步）；`prettier --write` 收口 9 个文件。
10. 排障副产品：`packages/adapters/dist` 曾有陈旧迁移文件 000007（src 仅 000008，tsc 不清旧产物）导致 MIGRATION_SEQUENCE_CONFLICT，已删；`tsc -b` 增量曾因 tsbuildinfo 失准跳过重编，必要时使用 `--force`。

## 限定审计

无。本收尾轮次未触发限定审计，亦无第二次审计需要。

## 后续注意事项

- demo 会话保存在内存中，整页刷新会回到登录页；spec 用例因此全部采用应用内导航。
- C33–C35 域页面仍使用静态 content（documentCatalog、evidenceSegments 等保留），`legacySegment` 静态 fallback 留给 C33–C35 移除。
- 治理与检索事实为合成样本，待甲方复核。
- 本 change 的全部改动尚未提交 Git（用户裁决不提交）；归档与提交动作待用户另行指示。
