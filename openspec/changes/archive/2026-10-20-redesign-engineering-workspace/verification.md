# Verification

## 验收对象与当前结论

- Change：`redesign-engineering-workspace`；schema：`orchestrated-delivery`。
- 输入实现 HEAD：`92b19272dc6dc90b86d59c7c56f7275227d481fb`。修复保留在当前工作区，未提交、未归档，未修改 Git 或编排状态。
- 首轮只读核验为 **FAIL**，发现 F-01～F-10 与 W-01～W-04；用户随后授权在同一 change 内直接修复。下表保留原发现及修复证据，不将首轮失败改写为通过。
- **PASS（本 change 范围）。F-01～F-10 与 W-01～W-04 已闭合。** 浏览器采用完整运行加修复相关文件复核，两批覆盖全部 124 个不同用例；不声称一次完整运行 124/124 全绿。归档技术核验通过，本轮不执行归档。
- 数据资格：**合成样本，待甲方复核**。本轮修复验收使用真实 PostgreSQL、生产 Web 构建与真实 loopback HTTPS；自签证书只豁免信任检查，不豁免 Cookie 语义。
- 适用边界：工程工作区及既有消费者回归。不代替现场设备、正式跨主机部署、真实模型服务或合同最终验收。

| 维度   | 修复后状态                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------- |
| 完整性 | 13/13 tasks；12 个 Requirement、32 个 Scenario、IP-01～IP-07 已映射；124 个不同浏览器用例跨批次覆盖通过 |
| 正确性 | 跨层回归 526 passed / 1 optional skipped；HTTPS 实际业务 smoke 和六组原生缩放通过                       |
| 一致性 | 复用原权限、命令、事务、精确引用及所有者窄读；未新增依赖、迁移、任务状态机或上传执行能力                |

### 未闭合问题

- **CRITICAL：无。**
- **WARNING：生产构建仍有大于 500 kB 的 chunk 告警。** 非本 change 新功能缺陷，保留原阈值，不以调整告警配置隐藏。
- **SUGGESTION：无。**

## 原发现与修复闭环

以下“原问题”均指修复前；运行边界按证据列说明。最终组合运行结果见下一节。

| ID   | 原问题                                                        | 修复与证据                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | 来源被裁剪后仍披露处理关系；多来源清洗只检查所选来源          | workspace 消费当前可见性决定，清洗/准备/排除读取检查全部冻结来源与空间交集。`postgres-data-cleaning-store.test.ts` 的“多来源结果在任一来源收窄后不披露清洗、准备或排除关系”使用真实 PostgreSQL 完成双来源清洗，再收窄其中一个来源，验证三条读取均停止披露。 |
| F-02 | 假监测版本、错工程引用及目标空间未完整校验                    | 按真实登记目标解析并校验精确工程/空间/序列版本，不以空范围或稳定 ID 替代。HTTPS smoke 的 wrongProject、wrongSeries 均为 404；监测精确读取与错配快照已有行为回归。                                                                                           |
| F-03 | 访问目录的 revision UUID 不能用于原命令预期版本               | 新经理接缝解析调用方给出的精确修订 UUID，转换为该修订的序号交给原命令；不换成当前版本，原陈旧判断继续生效。授权 adapter 回归证明目录原样读改成功，旧版本再提交被拒绝。                                                                                      |
| F-04 | 经理接缝可以用 expectedVersion=none 新增非成员                | 经理路径限定已存在且与账号绑定的成员；新增成员仍归原系统管理路径。回归先证明经理新增被拒，再由原系统路径创建，并经目录读改闭环更新。                                                                                                                        |
| F-05 | limit 被当作不可续读的截断，阶段及历史快照丢项                | 所属 reader 使用固定排序和 subject 绑定游标，组合投影及 Web 传递 nextCursor。HTTPS smoke 逐页取得 segments/preparation/cleaning/conversion 四阶段及两个真实快照；非法游标 404。浏览器页外空间用例使用 51 条真实新增空间验证显式续页。                       |
| F-06 | 历史工程/空间 URL 仍读当前并允许写入                          | 页面消费 revision/scope/scopeVersion，按精确历史引用读取，历史选择只读。HTTPS smoke 历史空间版本保留且修订按钮数为 0；浏览器历史 URL 回归保留。                                                                                                             |
| F-07 | 初选空间未触发真实业务读取，读失败被当首修订                  | 统一稳定空间选择，读取 C11 当前业务修订后才能构造原预期版本；C06 授权空间版本不冒充 C11 业务版本。实机曾复现连续两次命令 200/404，修复后为 200/200；unit 与浏览器均覆盖连续追加及历史保留。                                                                 |
| F-08 | 缺来源授权修改与授权空间新建/修订界面                         | `ProjectMembersPage` 复用既有确认及原四类命令，选择真实有效成员、来源登记人和授权空间。浏览器覆盖成员修改、来源收窄并保留服务端登记人、空间创建/停用和目录页外空间。                                                                                        |
| F-09 | 当前知识阈值读取失败抹掉监测正文                              | 阈值独立查询/状态/重试，冻结快照统计与批次事实不依赖治理读取成功。HTTPS smoke 与截图证明阈值失败时快照和批次仍可见；浏览器注入真实传输失败并验证解除后重试恢复。                                                                                            |
| F-10 | 接入深链不恢复，排除项误用来源引用，准备/安全失败缺接线       | URL 保存并恢复精确 subject；正式排除范围只消费实际 cleaning resultRef；组合所属准备与转换安全失败窄读。HTTPS smoke 正式排除请求 200；转换 adapter 回归覆盖精确来源和安全摘要；浏览器覆盖刷新与来源类型切换。                                                |
| W-01 | 精确监测元数据为空，错配快照被当作未选，阈值/特征原因不明确   | 精确详情依赖与 URL 校验修正，明确区分历史快照和当前知识阈值，显示已登记的特征不可用原因。浏览器覆盖直达、非最新快照、参数不成套和跨序列真实错配。                                                                                                           |
| W-02 | 原工程用例只看状态，没有证明写入/撤权/分页                    | 扩展原测试，新增双来源收窄、版本读改/陈旧、连续空间修订及真实 UI 命令读回。断言正式 HTTP 结果、精确业务引用与持久化读回，不以成功文案或确认框是否卸载作为写入证明。                                                                                         |
| W-03 | 页面导航后才取响应正文，Chromium Network.getResponseBody 失败 | 导航前挂接响应并立即解析正文；确认框允许按组件刷新卸载或保留成功态，不要求瞬态成功文案。风险等级响应还修正了旧反馈页将 `feedback` 误写成 `feedback-record` 的引用构造，既有 Schema/API 不变；该完整闭环已单独通过。                                         |
| W-04 | 原 harness 只有 HTTP，不能证明 HTTPS Cookie                   | 两个正式浏览器 harness 使用真实 TLS 与 Secure Cookie。HTTPS smoke 记录 `__Host-riskflow_session` 的 HttpOnly、Secure、SameSite=Strict、path=/；质量页保留 JS 不可读及会话 200 的浏览器断言。                                                                |

主要生产修复位于：

- `packages/adapters/src/engineering-data/workspace/postgres-engineering-workspace-adapter.ts`，以及 context-source、catalog、document-conversion、cleaning、monitoring 的所属窄读。
- `packages/adapters/src/auth/postgres-local-identity-access.ts`：当前经理边界、原预期版本桥接和登记人解析；保留原系统管理职责。
- `packages/contracts/src/engineering-workspace/index.ts` 与相应 core 端口：严格载荷及既有领域引用，不新增自由 JSON 接缝。
- `apps/web/src/api/engineeringWorkspace.ts`、`apps/web/src/pages/project/`、`MonitoringDetailPage.tsx`：完整续页、历史只读、访问维护、精确深链及独立故障。
- `apps/web/src/pages/FeedbackDetailPage.tsx`：恢复既有反馈引用种类，防止完整响应回归中的详情读回在发请求前被 Schema 拒绝。

## 实际验证

### 1. 生产构建

`pnpm build`：通过，包含 `tsc -b` 与生产 Vite 构建。仍有压缩后 chunk 大于 500 kB 的构建警告；未为隐藏警告修改阈值或拆包。

### 2. 跨层行为回归

```sh
pnpm exec vitest run packages/contracts/test/engineering-workspace.test.ts packages/contracts/test/c32-read-surface.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts packages/core/test/access.test.ts packages/core/test/engineering-data/context-source.test.ts packages/core/test/engineering-data/cleaning.test.ts packages/adapters/test/engineering-data packages/adapters/test/auth/local-identity-project-authorization.test.ts apps/api/test/http-shell.test.ts scripts/deployment/api-ports.test.mjs scripts/deployment/provision.test.mjs apps/web/test/api-client-openapi.test.ts apps/web/test/business-routes.test.ts apps/web/test/routing-context-actions.test.ts apps/web/test/confirmation.test.ts apps/web/test/ssr-shells.test.tsx
```

结果：**25 files passed / 1 skipped；526 tests passed / 1 skipped**，112.64 秒。唯一跳过项为 `document-conversion/mineru/smoke.test.ts` 中依赖 `MINERU_REAL_SMOKE` 的可选真实 MinerU 服务 smoke；未把跳过项计为通过。

### 3. 真实浏览器

```sh
pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/risk-level-response-verification.spec.ts --retries=0 --output=test-results/quality-browser-feedback-repair
```

结果：**1 passed**，1.9 分钟。完整经历单独风险等级预警、三项约束、人工采纳、UI 执行与反馈登记、反馈正文读取、偏差与校准建议、批准和未发布草案创建。

完整组合命令：

```sh
pnpm exec playwright test -c playwright.config.ts --project=chromium --retries=0 --output=test-results/quality-browser-repair-final
```

该命令覆盖工程、只读、身份/Agent/审计/管理、识别复核、评估预警响应、质量及风险等级响应七个文件，结果 **114 passed / 10 failed**，20.1 分钟，无自动重试。10 个失败归于三处测试辅助错误：空间选项 evaluate 回调未显式传入 createId；质量夹具返回普通版本引用而非 KindRef；datetime-local 的零秒值会被浏览器规范化后触发 Playwright Malformed value。已分别修正参数传递、引用消费和分钟精度，并用真实 Chromium 自检证明旧零秒格式失败、规范分钟格式成功；未更改生产控件或削弱业务断言。

修正后三个相关文件完整复核：

```sh
pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/engineering-workspace.spec.ts apps/web/test/browser/quality.spec.ts apps/web/test/browser/risk-level-response-verification.spec.ts --retries=0 --output=test-results/quality-browser-repair-targeted
```

结果 **19 passed**，3.3 分钟，无 skip/retry；包括工程 10 项、质量 8 项、风险等级响应 1 项。完整运行中其余四文件的 **105 项通过**；最后仅修改这三个测试文件，生产代码、构建及其余四文件不变。两批合并覆盖 **124 个不同用例**，不重复累计相关文件的早先通过项或单独风险等级响应那一次通过，也不将跨批次覆盖写成一次完整命令全绿。完整批次的失败 trace 保留在原输出根，修复复核使用独立输出根。

修复前的失败包括：瞬态确认成功文案/取消按钮等待、批次和 Agent 区域的全页重复文本定位、质量页使用非规范修订参数，以及反馈详情引用种类错误。已依据真实响应与 trace 区分测试等待错误和生产缺陷；未删真实批次、未隐藏合法 Agent 区域、未削弱原登记人保留或历史只读契约。

### 4. HTTPS 业务 smoke 与原生缩放

- `evidence/repair/https-business-smoke.json`：真实 HTTPS Cookie、四阶段跨页、正式排除范围、错目标/非法游标、两个快照续页、监测故障隔离、连续空间修订及历史只读。
- `evidence/repair/spatial-two-revisions.png`、`monitoring-threshold-failure.png`：实际生产页面截图。
- `evidence/repair/native-zoom.json` 与 `native-zoom/`：1280×720、1440×900、1920×1080，各 100%/200%，**六组通过，18 张截图**。真实外窗口由 CDP 设置，缩放由 xdotool 发送 Chromium 原生快捷键，不使用 CSS zoom/deviceScaleFactor 冒充。
- 六组均执行导航/停靠区、工程表单、确认、传输失败、取消和焦点恢复；存在局部二维溢出时实际滚动。观察了双倍缩放错误画面及连续空间修订画面。
- 原生缩放脚本在写请求到达服务端前注入一次传输失败，不冒充业务命令落库证据；实际写入由 HTTPS smoke 和真实 UI 回归承担。
- smoke 服务与临时 wrapper 已清理，保留脱敏 JSON 和截图；未保存会话令牌/密码。原始浏览器 trace 可能包含认证材料，不作为可提交交付物。

### 5. 静态与工件检查

- `openspec validate redesign-engineering-workspace --strict --no-interactive`：通过。
- `pnpm typecheck && pnpm lint && pnpm deps:check`：全部通过；723 modules、2557 dependencies，无依赖边界违规。
- `pnpm format:check`：首次发现两份辅助修改测试的格式问题，经内置写入规范化后全仓复核通过；未修改测试行为以满足格式检查。

## Requirement / Scenario / IP-ID 映射

“证据”指上述实际回归与 smoke，不代表每个场景都有独立测试，也不把纯 Schema 检查当作真实权限或 UI 命令验收。

| Requirement                                | Scenario                           | IP-ID       | 修复/证据归属                                                 |
| ------------------------------------------ | ---------------------------------- | ----------- | ------------------------------------------------------------- |
| 页面必须只经既有 HTTP 只读面取得业务事实   | 真实事实、PJ-S01、写操作入口不存在 | 01/04/05/07 | F-03/F-08；正式 HTTP、访问域和原系统管理回归                  |
| 工程概览页必须呈现当前上下文与发布集合     | 完整上下文、缺维度、PJ-S02         | 05/06/07    | 独立来源状态、工程概览与原只读回归                            |
| 资料目录与详情必须呈现登记、解析与清洗事实 | 分页/详情、正式清洗可用性          | 02/06/07    | F-01/F-05/F-10；清洗所属窄读、原件与浏览器详情                |
| 监测序列详情必须呈现快照与越限事实         | 快照/阈值、无快照、PJ-S03          | 02/06/07    | F-02/F-05/F-09/W-01；精确/历史快照、故障隔离                  |
| PJ-R1 工程上下文维护                       | PJ-S04、S05、S06                   | 01/02/05/07 | F-06/F-07；连续修订、历史保留、取消零请求与原确认回归         |
| PJ-R2 工程开通及成员资料访问               | PJ-S07、S08、S09                   | 03/05/06/07 | F-01/F-03/F-04/F-08；成员/来源/空间真实命令及原系统六动作     |
| PJ-R3 接入任务                             | PJ-S10、S11                        | 02/06/07    | F-05/F-10；四阶段续页、正式排除、准备与安全失败摘要           |
| PJ-R4 正式深链和可访问性                   | PJ-S12、S13                        | 05/06/07    | F-06/F-10；URL 恢复、旧别名、键盘/原生缩放                    |
| PJ-D-R1 类型化修订和精确读取               | PJ-D-S01、S02                      | 01/02/04/07 | F-02/F-07；原 Schema、陈旧并发、历史与连续空间修订            |
| PJ-D-R2 登记处理关系                       | PJ-D-S03、S04、S05                 | 01/02/06/07 | F-01/F-02/F-05/F-10；全部冻结输入交集与所属读面               |
| PJ-A-R1 原访问权限和版本                   | PJ-A-S01、S02、S03                 | 01/03/05/07 | F-03/F-04；目录读改、经理新增拒绝、原授权/审计回归            |
| PJ-H-R1 正式 HTTP 接缝及装配               | PJ-H-S01、S02、S03                 | 01/04/07    | F-02/F-04/W-04；严格载荷、Cookie 主体、缺 provider 与部署组合 |

## 审阅与交付边界

首轮后端限定只读审阅覆盖 Cookie 主体、系统/经理隔离、来源与空间、多来源交集、读改版本、精确监测、分页、幂等/审计和正式装配，其结论为 FAIL。修复和最终接受由当前主会话承担，以跨层回归、真实 HTTP/UI 与缩放证据闭合；未重复派发第二轮审计或新 Finalizer 代替修复，也未修改编排状态冒充 settle/集成批准。

辅助实现只承担明确文件内的浏览器等待/断言修复，未运行检查；主会话独立运行组合验收。所有测试继续使用真实服务；故障注入不等于替换业务成功结果。

交付文档同步到 `.scratch/riskflow-master-plan/prototypes/ui-redesign-spec.md` 与 `.scratch/ui-redesign-spec/issues/07-change-slicing-and-spec-landing.md`。本轮不更改主规格、不归档、不提交；六导航及其它后续 UI 工作包未提前启用。

未执行全仓 `pnpm verify`、真实 MinerU/LLM/Embedding 服务、现场 GPU/禁网/跨 VM 与多平台安装验收。自签 loopback HTTPS 证明浏览器 TLS 与 Cookie 行为，不证明正式证书签发或现场部署。构建大 chunk 警告保留，未作为本 change 功能阻断项。
