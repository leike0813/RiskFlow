## Context

- UI 重做 CH-5，固定 base commit `603a192a4ac0aabeeefe5f03a62032a0f5c53819`，起始工作区 clean；前置 CH-1/CH-2 已归档，CH-3 总览及 CH-4 工程承载继续有效。OpenSpec 1.14.3 创建结果为 `orchestrated-delivery`，仅闭合五个 apply 前置，不提前生成 verification。
- 当前 `IdentificationRunsPage` 只取首页，`IdentificationRunPage` 通过首页 `find(runId)` 定位；记录与旧 trace 的裸 ID 同样不能等价为精确读取。规范 URL 必须表达身份和版本，目录续页不是详情授权手段。
- `ProcessModelPage` 自有四项 tabs 和五工序常量，当前只读当前发布；图谱重复展示风险列表。页面沿已有生产组件改造，不从原型迁数据、按钮或私有状态。
- 依据三份 delta、票07与 UI 主文档/用语/页面映射/路由/设计系统/后端清单/演示叙事。沿两项已归档减负设计：入口检查当前权限，内部消费登记范围；不引入逐层签发、全权限摘要全等或文件哈希复验。LSP 状态为 `No language servers configured for this project`，代码依据 CodeGraph 和只读源码调查。

## Goals / Non-Goals

**Goals:**
- 六条规范识别路由形成四入口工作区，真实有界分页、精确详情、独立七态及统一业务用语。
- 风险详情内追溯与两个永久旧入口同版切换，目录首页之外与历史精确版本可读，不产生第二套事实或页面正文。
- 在原所属读面闭合缺失身份选择，固定权限、Schema、失败、正式装配与证据，Implementation 不再选公共接口。

**Non-Goals:**
- 不新增识别启动、重试、取消、模型调用、人工决定或治理发布能力；本包识别侧保持只读，原复核能力不删。
- 不实现 CH-6～CH-9、全局搜索、待办、覆盖层或六导航；不重设领域/评分/预算/状态机，不迁移或改写历史。
- 不增依赖、锁文件、角色、能力、分支、迁移、索引、缓存、模型或现场部署；不修改 Electron 宿主、移动端或一次性原型。

## Decisions

### D-01 所有权与最小切换单元

界面仍归 `web/identification-and-review-ui`；识别读选择/结果归 `domain/module-interfaces-events-workflows`；传输归 C09。shell 的阶段发布和永久地址契约已足够，不重复为本包导航新增 capability 或全站就绪注册表。三份 delta 在同一 change 修正既有“八页”范围、图内降级记录列表和独立追溯正文要求；未修改的复核/证据脱敏要求继续有效。

CH-5 发布原子包含：所属读面 → C09/正式组合 → Web 新详情/解析 → 全部内部链接迁移 → 旧 trace 正文删除。保留旧 URL，不保留旧页面或第二套 API。CH-9 未组合前维持原导航及复核队列，业务四个入口只影响识别域。

### D-02 原详情分支接受两种互斥身份，不增 resolver 框架

`packages/contracts/src/ports/index.ts` 是请求/结果 SSOT：

| 原 branch/kind | strict payload | 成功结果 |
|---|---|---|
| `risk-identification.run-read` / `run-read` | `{runRef: WorkflowRunRefV1}` 或 `{runId: Identifier}`，strict union，恰一个 | 原 `RiskIdentificationRunReadSuccessV1` 加 `startedBy: Identifier`、`startedAt: IsoDateTime`，从原列表条目 Schema pick 派生；其余字段不变，不新增无登记来源的 triggerReason |
| `risk-identification.record-read` / `record-read` | `{riskRecordRef: StandardizedRiskRecordRefV1}` 或 `{riskRecordId: Identifier}`，strict union，恰一个 | 原 `RiskRecordReadSuccessV1` 不变 |

分别导出 `RiskIdentificationRunReadPayloadV1Schema`、`RiskIdentificationRecordReadPayloadV1Schema`，供原 `RiskIdentificationReadQueryV1Schema` 引用。HTTP 已通过 `payloadSchemaFor/queryTransportSchemaFor` 自动取得公共 payload，OpenAPI 自动派生，故不改 `apps/api/src/http.ts`，只扩现有行为用例。空对象、双选择、未知字段或引用缺版本均失败。`querySchema` 已接受 `ZodType`，union 不要求改共享信封。列表/筛选 Schema、`RiskIdentificationReadPortV1.read`、branch-capability 映射和角色策略不变；Web 的读 helper 消费该公开 union，迁移实际调用方，不保留旧辅助签名/shim。

选择此方案而非新增 resolver branch/端口：成功需要的正文和精确引用本就由原 read 返回；两种选择留在同一所属读取中，可减少一次 HTTP 与新 DTO。已有精确 ref 形式继续是合法的主路径，不是过渡兼容层。

### D-03 定向解析、当前权限与错误

- 裸 `runId` 复用 `#latestRunStateRow`：本工程+该运行+run-state，`persisted_at DESC, run_version_id DESC LIMIT 1`，与列表最新状态口径相同。裸 `riskRecordId` 按 `(project_id,risk_record_id)` 主键取唯一不可变记录行；一记录只有一个登记版本，不增 ORDER BY、历史版本表或“最新风险”概念。两者都不扫目录、不全库枚举、不从 ID 猜版本；选定运行最新状态无权时不回退更早状态。
- 运行复用原 `#runRead` 的登记授权范围、状态正文和阶段读取；记录复用 `#recordRead/#recordVisibility` 的全部空间/来源交集。无版本只做引用定位，不能通过客户端 `assessmentSources` 缩小本记录的冻结来源。原登记引用只恢复范围，不当当前凭据。
- 有精确引用时按原实体+状态/记录版本查找，错版或缺失不能跳最新。`runRef.versionId` 是状态正文哈希，`#stateBound` 限定其历史阶段；显式 `version` 地址只读该快照、不轮询。无 `version` 的运行地址才按裸 `{runId}` 每次重新读取最新获权状态，保留无版本 URL；可从结果复制带版本快照链接。风险裸ID成功后 replace 写回唯一登记版本。除运行“查看最新进展”链接显式离开快照外，不自动解除版本固定。
- 运行头部的启动者/时间取同一条最早 run-state 登记（`valid_at ASC,persisted_at ASC,run_version_id ASC`）的 actor_ref/valid_at。列表与详情复用同一SQL头部选择口径；删除原 `min(actor_ref)`，防止后续由字典序更小账号恢复时冒充发起人。列表以单次有界页SQL组合头部，不新增逐条头部查询；详情只按本运行定向读取。精确详情的头部选择不越过其 `#stateBound`。triggerReason 无登记继续缺席，不补造幂等键或取代/作废关系。
- 不存在、跨工程、无可读候选按原 `AUTHORIZATION_DENIED` 同形；SQL/I/O/解码/审计失败保留 `TRANSIENT_FAILURE/TERMINAL_FAILURE`。复用已有 `#dashboardError` 分类逻辑并改为本读模块通用私有名字，同时更新原dashboard调用；`read` 顶层catch、`#runList`逐项catch与`#recordVisibility`均只将真正权限拒绝转为同形拒绝/不可见，其余故障向原技术映射传播。`#resourceAuthorization` 的无授权结果也必须保留可辨识的拒权类别，不用普通Error与I/O混淆。不新增错误码或无限重试，响应不含未授权事实及原始诊断。
- 只读不新增事务、业务收据、Outbox、持久授权配对或表。实际工件访问与安全审计仍沿原所有者路径，审计失败如实失败。无新增权限授予，不因移到识别域而获得 `projection.query`、知识或 Agent 权限。

### D-04 HTTP、OpenAPI 与正式组合

保留原五条 C33 路由及原 `ApiPortsV1.riskIdentificationRead`。C09 自动继承 D-02 公共 payload/结果，完整查询由 Cookie/路径工程/branch 组装，客户端不得注入主体或授权。OpenAPI 与激活路由同源，无 port 仍不激活。正式 `composition/identification.mjs`、`composition/api-ports.mjs` 和 browser server 已注入同一实现，端口方法未变，均保持代码不改；浏览器夹具只扩事实数据，不增加 resolver/no-op provider。

Web 的 `api/operations.ts` 继续集中查询、错误与 DTO 解码；精确详情及 trace 不要求客户端从首页凑 `requestedSourceVersionRefs`。原目录与新业务筛选照常表达范围。旧五条 branch、禁止缓存、Cookie、同源、1MiB 请求上限和错误形态不变。

### D-05 页面、标题、URL 与合法背景

在 `pages/identificationShared.tsx` 收敛识别域标题、四入口与原状态/阶段标签，供 route seeds 与页面共同消费；不建全站页面配置引擎。保持 routeId，只有本域 title/regions 更新；唯一 h1，详情辅助区显示可复制编号及版本，表格首列用风险事件或中文阶段+启动时间，不发明任务名。

| 地址 | 主标题与承载 | 精确选择 |
|---|---|---|
| `/identification` | 识别任务 | 原有界任务目录，服务端 status 筛选 |
| `/identification/runs/:runId` | 识别任务详情 | 有 `version` 固定状态快照；无 `version` 沿裸 ID 跟踪最新状态，不把状态版本当稳定运行身份 |
| `/identification/records` | 风险记录 | 原工序/验收筛选与有界分页 |
| `/identification/records/:recordId` | 风险记录详情 | `version` 风险记录版本；`tab=details|trace`，缺省 details；导航型未知 tab 回 details，不修改精确对象 |
| `/identification/graph` | 关联图谱 | `subject`为风险ID、可选`version`为其精确版本；缺主体展示真实有界选择器，不默认首条；已给主体直接read，不依赖选择器页 |
| `/identification/process-model` | 工序模型 | `release/releaseVersion` 成套选择知识发布，`node` 定位；无发布选择才读当前集合 |

沿 `useProjectPath/projectPathWithSelector` 保留 `project/revision/assessmentSources`；只对当前对象相关的查询键做显式搬移。切工程/注销/上下文修订先清旧内容并 abort，迟到结果沿原 revision guard 丢弃；业务事实不写 localStorage/sessionStorage 或全站缓存。

### D-06 列表、运行监控和只读正文

- 两个目录保留原 pageSize 50 与服务端 cursor；提供下一页和返回首屏，不实现虚构总页数。筛选/工程改变重置 cursor，页内计数仅称本页。风险工序筛选使用已有有界目录中的节点选项及明确的未筛选状态，不要求手输技术ID；选项不冒充完整工序全集。引用只能来自读结果，普通编号复制不改变对象。
- 任务详情不再调用 run-list：列表/历史引用带精确状态版本打开只读快照；快照保留该版本并停止轮询，提供同runId无版本“查看最新进展”链接。无版本才沿五秒节奏用裸ID单在途刷新最新状态，URL不写回快照版本；终态、隐藏、离开及上下文变化停止，前台恢复仅在当前非终态继续。头部来自读结果。I0～I9、工作项/合并组、等待/错误全部保留，补渲染已返回的验收记录/待复核组/拒收组引用集合；不能跳转的组只作为辅助精确引用，不猜复核任务。失败不新增跳过/换模型/扩预算。
- 风险正文保留七字段与信封、模型和综合置信度区别、人工修正标记、证据定位及真实关系。取代/作废只显示服务端事实；不新造当前效力查询、重算置信度或复制评估正文。`tab=trace` 懒读，默认正文不发投影请求，记录详情读取失败时不先发追溯。
- 复用生产 `PageStateView`、DataTable、SectionTabs、StageBar、EvidenceLink/Drawer、GraphView、PageRegions 与令牌；低强调表面、对齐/分隔组织，二维区域局部滚动、正文折行。只用已装组件，不新增 UI 依赖、装饰图表或样例 KPI。

### D-07 详情内追溯与旧入口解析

从 `EvidenceTracePage` 提取实际追溯正文到一份 `pages/RiskTraceSection.tsx`，由 `RiskDetailPage` 在已读到精确 `riskRecordRef` 后使用。保留 `readTraceChainLinks/readAssociationGraphLinks` 及其现有 `readProjectionItems`：同一已登记 queryResultRef 每页 50、最多 1000 条，按游标读取完整有界结果，超限明确失败，不另造分页 DTO 或外部 queryResultRef 参数。正文与追溯分别用七态并独立重试；固定链、缺席原因、证据脱敏和节点深链继续沿实际结果，不混合不同 query 的页面。

旧路径用无正文的 `pages/TraceRedirectPage.tsx`：
1. shell 先将已知 `/review/trace` 简单别名归 `/review-audit/trace`，未知后缀仍拒绝。
2. subject 缺省到同工程 `/identification/records`；空值/重复冲突/非法身份输入不能猜对象。
3. subject+version 构造原精确风险 ref；只有 subject 用 D-02 `record-read` 裸身份形式，当前授权后取得完整 ref。
4. replace 到风险详情 `version=返回版本&tab=trace`，保留原工程选择器；追溯查询只由已读到的当前风险精确引用登记，旧页从未消费的 `result/resultVersion` 参数不在本包扩成历史查询 API，不开放任意外部 queryResultRef。
5. 无权、错版、不存在同形拒绝；技术错误保留安全重试。新目标就绪后删除旧 `EvidenceTracePage.tsx/.css` 的重复页面实现，仅新区域保留活的样式。

生产 `RiskDetailPage`、关联/追溯深链及 review 相关 tabs/链接同版迁移；`ReviewDetailPage` 无主体的旧“证据追溯”页签改为“风险记录”并直接指向规范列表，不猜测记录。旧 URL 仍供外部书签。业务页不新增 CH-9 背景 URL/覆盖层状态；`AssociatedObjects` 的所属 trace 查询与证据读面保留，不因独立追溯页删除而误删。

### D-08 图谱与工序模型

图谱移除重复记录卡及“图加载失败就嵌记录列表”的实现，但保留真实主体选择和可访问节点/边表（它是同一图数据的文字形式，不是风险目录）。新选择替换原图查询，复用原每页50/总计1000的完整有界读取；全部页成功后才呈现完整图，后续页失败不得把前页称作完整图。失败/越界/无权显示原结构化状态与“风险记录”规范链接，不画裁切图、不写链边，不用图中关系代替评估等级。

工序模型消费原 `readCurrentReleaseSet/readKnowledgeRelease`。`release/releaseVersion` 成套构造现有 `KnowledgeReleaseRefV1`，直接读 process-model 正文；缺项/重复/错误类型/错版拒绝，不回当前集合。无选择才读当前集合。节点来自 `node`，不存在说明无法定位，不自动改首节点。当前页面与公共工程上下文并未提供原型的“本工程使用关系”或模型历史目录，本包不伪造这些区块、不新建关系读面；风险详情只有节点事实时保持节点入口，不声称该当前模型就是识别冻结版本。覆盖核对导入 `PROCESS_NODE_VALUES`，不维护硬编码五项；节点显示其 inputs/outputs、equipmentRefs、structuralComponentRefs、stateParameters、monitoringIndicators 和证据，依赖直接来自 dependencyEdges，不用数组顺序伪造关系连线。只读业务模型与 CH-8 治理分开，不新增发布/审核/版本历史写操作。

### D-09 证据、文件与发布责任

精确文件白名单、调用方和 Requirement/Scenario → IP-ID → 命令见 implementation-plan，同一共享 contracts/HTTP/route seeds 由单一 owner 串行整合。继承证据脱敏、当前授权、原复核与确认；不为样式/完整文案/内部调用数/路由数量建测试，扩展已有可观察边界用例。

实施后沿现有生产 dist + HTTPS Cookie + PostgreSQL/迁移 browser harness 核验六路由、页外目标、两个旧 trace、来源权限、真实图/链、独立失败与复核不回归；三种窗口×两种原生缩放实际操作，不能用 CSS zoom、deviceScaleFactor 或缩小 viewport 替代。合成材料显式标注待甲方复核，关键环境未跑不得 PASS。权限/精确来源与投影主体绑定进入本轮最多一次限定审计；Finalizer 在同轮范围内修复回归后填 verification，不回派首轮实现。

## Risks / Trade-offs

- 无版本风险书签解析唯一登记版本后固定URL；无版本运行地址有意跟踪最新状态，不自动变成快照。显式运行版本一律保留，用户才可进入最新进展。当前目标无权则拒绝，不退到其它状态、记录或模型。
- 工序正文和图/链/Agent 仍沿原权限；没有其它域权限会看到对应独立失败，不为界面方便扩权。识别正文不会因这些可选来源失败而消失。
- 删除图内重复风险列表后，图失败多一次去列表的导航；这是已批准映射，胜于维护两套列表与过滤状态。
- 本轮只证明规划就绪，不能把 strict 校验或静态工件当作生产行为、现场模型、甲方或最终六导航验收通过。

## Migration Plan

1. IP-01 固定原分支 payload union 与运行头部；IP-02 识别所属读取、HTTP 与正式组合贯通，无 DDL/历史回填。
2. IP-03 统一本域页面元数据/列表和精确详情；IP-04 移入追溯、原子切换所有内部链接并删除旧页面；IP-05 完成图谱与只读模型。
3. IP-06 完成真实回归、原生缩放、来源限定审计与 UI 地图更新，由 Finalizer 按最终实现检查点生成 verification。
4. API/Web 同版发布，回退上一兼容构建，不删除用户数据或永久 URL；外部书签继续从同一解析入口到规范详情。六导航/待办启用仍由 CH-9 承担。

## Open Questions

无需要 Implementation 决定的产品、公共接口、权限、依赖、事务或范围问题。现场硬件、CH-6～CH-9 和最终合同验收不计入本包结论。
