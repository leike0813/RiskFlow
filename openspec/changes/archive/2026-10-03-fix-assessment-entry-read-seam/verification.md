# Verification: fix-assessment-entry-read-seam

## 核验对象与结论

核验日期：2026-10-03。基线 HEAD 为 `21f7ccc471c0c6d72c32aaf570b51afdf6dc71ec`；对象是保留原未提交实现的最终工作区差异，未创建 Git 提交。采用官方 openspec-verify-change 流程核验本修复的 proposal、全部 delta specs、design、implementation-plan 与 tasks。

原汇报中“缺少 C11 目录适配器”的判断已经过时，现有 registry 已有读取实现。实际问题是外部事件被要求提供不存在的工程修订事实、C25 派生读取身份未与签发配对、来源授权没有精确版本定位接缝，以及 offset 分页与长标识游标违背有界契约。本次复用原实现闭合这些问题，不新增页面必填项。

| 维度 | 结果 |
| --- | --- |
| Completeness | 5/5 任务；5 个 Requirement、17 个 Scenario 均映射到实现与验证证据 |
| Correctness | 契约与真实 PostgreSQL/C06/C11/C25 接缝通过；相关目标共 185 个测试通过 |
| Coherence | D01–D04、领域所有权和当前授权范围一致；无新依赖或权限角色 |

CRITICAL：0。WARNING：0。本修复可以同步主规格并归档。

## Requirement / Scenario 证据

生产证据文件：`packages/contracts/src/ports/index.ts`；`packages/adapters/src/engineering-data/context-source/postgres-engineering-context-source-registry.ts` 的来源定位、目录读取、游标编解码及两个 keyset 目录；`packages/adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts` 的 `#readEntryDirectory`、`#readEntryContext`、`#pendingExternalEventCandidates`；迁移 `000055_assessment_entry_catalog_cursor_keys.ts`。

下表简称：契约为 `packages/contracts/test/c34-assessment-response-read.test.ts`；C11 为 `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`；C25 为 `packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts`。

| Requirement / Scenario | 实现与验证 |
| --- | --- |
| 登记、修订与查询遵守授权幂等和原子审计边界 / 重放相同来源交付 | 保留原写入逻辑；C11 来源交付、重放和无重复事实用例 |
| 同键不同载荷冲突 | C11 既有 source delivery conflict 用例 |
| 未授权与不存在不可区分 | C11 不存在、未就绪、无权事件与读取目标同形失败用例 |
| 审计或 Outbox 失败整体回滚 | C11 事件与上下文审计失败回滚、原身份重试用例 |
| 来源授权定位只复用原当前读取身份 | 新来源查询 strict Schema；C11 使用原 queryId/risk-assessment.read 复验；C25 真实调用、撤销 session 和来源错配用例 |
| 评估候选目录必须按登记事实区分输入作用域 / 两类目录采用各自事实范围 | 操作判别输入及 C11 分别按精确工程修订/空间筛选；契约与两目录真实读取用例；外部事件拒绝伪造工程修订 |
| 候选预览保持零业务写入 | C11/C25 首页、续页及拒绝读取前后比较业务目录、读取结果、业务审计与 Outbox 数量 |
| 评估候选目录分页必须稳定有界且绑定当前授权 / 深页与同时间条目稳定推进 | C11 51 条登记分 50/1 页且并集等于登记集；采集执行查询 LIMIT：首页 51、续页 1 与 51；微秒时间、同时间稳定排序及插入更靠前行用例 |
| 长标识与新运行时恢复 | 700 字符空间与 600 字符修订/实体输入；512 字符内游标；新连接池与 registry 从同一数据库续页 |
| 错目录错筛选与撤权拒绝 | 绑定操作、工程、精确筛选及当前授权摘要；C11 错目录/空间/修订/摘要、伪锚点与无效编码用例；C25 错空间、撤权与跨目录游标用例；跨工程保护保留既有 C11 回归 |
| 登记事实损坏失败关闭 | C11 损坏适用性摘要与事件引用均返回 TERMINAL_FAILURE；未隐藏为成功空页 |
| 评估候选公共输入与授权调用身份必须闭合 / strict 输入拒绝缺失与伪造范围 | 契约表驱动测试覆盖适用性修订必填、外部事件空间必填、拒绝工程修订及风险记录可选空间 |
| 两类入口目录各自获得配对授权 | C25 为每次实际 queryId 分别签发 engineering-data.context-read；真实 C06→C11 两目录成功及独立游标用例；同一空间 entityId 映射到当前已验证精确授权引用 |
| 下游拒绝保持公共失败语义 | RiskAssessmentReadFailure 收口；C25 错空间、撤权、错游标、缺少来源授权均返回不可重试 AUTHORIZATION_DENIED，无成功空目录 |
| 评估候选来源授权必须通过所属事实有界继承 / 真实来源范围继承 | C11 只在自身 source_versions 按当前 C06 grant identity 定位就绪来源；最多 256 个授权、257 行哨兵；C25 仅将结果用于配对签发；真实来源目录成功，公开候选载荷不增加来源字段 |
| 缺失错配或越界来源不得继承 | C25/C11 来源引用错配及非就绪登记（匹配行数不符）安全失败、session 撤销失败；静态核验下游签发的精确空间/来源授权必须是原当前授权子集，否则在调用目录前拒绝 |
| 无来源授权保持空范围 | C25 真实来源定位返回空集合；已有外部事件仍经逐来源验证拒绝，不扫描资料自动增权 |

## 设计一致性与迁移

- D01：复用 C11 registry，通过薄工厂导出双方法端口；外部事件不拼造工程修订，C25 只组合所属模块的公开读取。
- D02：000055 为两张表回填耐久 UUID，并为新行设置默认值和唯一索引。真实 PostgreSQL 验证历史回填、新行默认、唯一约束、up/down 及既有最小权限。锚点时间保留 PostgreSQL 微秒精度，LIMIT 与页码无关。
- D03：候选读取不创建业务事实；来源定位复验原调用身份，目录各自签发配对身份，签发结果不扩大原当前空间或来源授权。空授权保持空范围，缺失或坏登记失败关闭。
- D04：修改仅覆盖施工图列出的文件及原 change 的接缝设计/施工图/两份 delta。原 `deliver-assessment-warning-and-response-ui/tasks.md` 的任务 2.3 保持未勾选。

部署先应用 000055，再启用依赖定位列的读取实现；回退先撤下读取实现，再回退迁移。未运行部署或开发服务器。合成工程/空间/来源验收样本待甲方复核。

## 执行证据

| 命令 | 最终结果 |
| --- | --- |
| `pnpm exec vitest run packages/contracts/test` | 5 文件，87 passed；包含新候选/来源契约 14 个用例 |
| `pnpm exec vitest run packages/adapters/test/postgres/postgres-foundation.test.ts` | 18 passed |
| `pnpm exec vitest run packages/adapters/test/auth/local-identity-project-authorization.test.ts` | 13 passed |
| `pnpm exec vitest run packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` | 36 passed；最终修正分页采集用例后完整文件复跑通过 |
| `pnpm exec vitest run packages/adapters/test/risk-assessment/` | 2 文件，31 passed；包含新增 4 个真实候选接缝用例 |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` | passed；默认堆容量曾耗尽，仅调整本次运行环境，不修改配置或依赖 |
| `pnpm exec eslint`，参数为本次全部生产与测试 TypeScript 文件 | passed |
| `pnpm exec prettier --check`，参数为上述文件及修复/原 change 受影响工件 | passed；既有文件的格式修正使用临时 diff 与 apply_patch |
| `pnpm deps:check` | passed；470 modules / 1386 dependencies，无边界违反 |
| `openspec validate fix-assessment-entry-read-seam --strict --no-interactive` | passed |
| `openspec validate deliver-assessment-warning-and-response-ui --strict --no-interactive` | passed |
| `openspec validate --specs` | 37 passed / 0 failed；本修复 5 个 delta Requirement 与主规格逐块一致，无待同步内容 |
| `git diff --check` | passed |

执行中曾单独按测试名筛选分页用例，因既有共享夹具尚未初始化而失败，随后按完整文件验证。收口还发现分页 SQL 采集调用沿用旧工程修订、读空页后提前返回的测试假阳性；已固定到本用例登记修订，并让缺少实际续页游标明确失败。最终通过结果包含真实两页 SQL 上界验证。

## 证据边界与后续

SUGGESTION：C25 当前夹具的业务空间与授权空间版本一致，只覆盖身份映射；不同业务修订映射到同一精确 C06 引用由 C11 既有真实用例覆盖。下游签发越界的防护完成静态核验，未额外注入扩大授权的签发器模拟。原 change 的完整应用接线验收可进一步覆盖这些组合。

本修复不验收原 C25 其它六类读取、完整应用接线或 UI，也未重跑原汇报的全部 1670 个测试。保留原未提交代码，不将本次 185 个相关测试通过等同原 IP-04 完工。主规格同步只包含本 change 的四个 ADDED Requirement 和一个完整 MODIFIED Requirement；同步后只归档本修复。
