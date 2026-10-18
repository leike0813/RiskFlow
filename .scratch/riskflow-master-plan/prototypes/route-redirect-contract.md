# 路由重定向与深链兼容契约

本表对应 `.scratch/ui-redesign-spec/issues/09-route-redirect-contract.md`，与 `business-object-page-mapping.md` 共同约束页面承载和精确 URL。只定可观察行为与逐条映射，不规定通用转换器、新后端框架或固定表名。

## 现状与证据边界

- `routes.ts:241-255` 的 3 条前缀别名按段边界替换，保留 search；不能自行完成子记录→任务授权反查或双版本搬移。
- `resolveWebRoute` 当前按参数个数升序再逐段精确匹配。`/warnings/:warningId/actions` 与 `/warnings/tasks/:taskId` 都是 1 参数、2 静态段；前者匹配 `/warnings/abc/actions`，后者不匹配它。撤销“abc 会被判成 taskId”的依据。
- 真正交集是 `/warnings/tasks/actions`：它可被解释为 warningId=tasks 或 taskId=actions。参数数目、静态段数、路径字典序的三键排序不能表达正确的静态前缀优先级。
- `WarningTaskPage.tsx:93-107` 以路径 taskId + 查询 `version` 定位任务；旧子记录各以路径 ID + `version` 定位自身。`ExecutionRegisterPage.tsx:91-94` 则用 `task/taskVersion` 与 `execution/version` 分别定位任务和执行。
- `ReviewDetailPage.tsx:447-474` 已直接按 taskId/version 调用 `readReviewTaskDetail`，不是扫描 pending 队列。`EvidenceTracePage.tsx:58-72` 的旧 `subject` 只是风险记录 ID，目前扫描风险目录首页；这不是可复用的精确窄读。

## 决定 1：旧地址永久作为精确解析入口

这是已批准纠错采用最小维护成本的稳定地址策略：**不与 C38 或其他验收节点绑定自动移除**，保全历史文档、书签及已导出报告的链接。保留的是地址解析，不是第二套旧页面、第二套权限或第二套业务正文实现。

简单同义前缀沿用现有别名接缝；涉及对象身份的转换在所属域授权窄读闭合后，替换浏览器当前位置为规范 URL，避免返回落进重定向循环。不硬性要求 HTTP 301（当前是应用路由），也不固定解析表的名称或算法。

别名只落已知模板和段边界，不使未知旧路径意外命中另一个对象；旧 `project/review` 前缀逐条规范化到下文目标，不靠不受约束的字符串替换绕过门禁。

## 决定 2：任务与子记录双身份、双版本

新规范子记录 URL：

```
/warnings/tasks/:taskId?version=:taskVersion&tab=:tab&recordKind=:kind&recordId=:id&recordVersion=:recordVersion
```

| 字段 | 唯一语义 |
|---|---|
| 路径 `taskId` + 查询 `version` | `warning-response-task` 精确引用；沿用现有任务详情参数 |
| `recordKind/recordId/recordVersion` | 所选子记录独立的 kind/entityId/versionId；三者成套，不借用任务版本 |
| `tab` | `warning/recommendation/decision/execution/prediction/feedback/calibration`；只是呈现位置 |
| `project/revision/assessmentSources` | 保留既有工程、修订、评估来源选择器；沿用 `api/context.ts:51-62` 的拼接语义 |

表中示例省略工程选择器时不表示可以丢弃它们。任务 ID 相同也不能跨工程沿用旧授权；页面和解析请求均经原工程/范围与对象授权，URL 不是授权凭据。

`recordKind` 使用 `packages/contracts/src/ports/index.ts` 现有精确引用的 `kind`，不另设近义枚举；尤其反馈是 `FeedbackRefV1Schema` 的 `feedback`，不是 `feedback-record`。

页签直接精确读取 `record*` 所选对象；任务关系列表只供关联浏览，不以其首页或有限分页是否含该引用判断对象存在。已给子记录或任务精确版本不得替换成“最新”。无版本旧书签可由所属域解析自身可见版本，明确写回完整 URL；不能拿子记录的 `version` 当任务版本。

合法 `tab` 与 recordKind 必须一致。只有不带所选对象的导航型非法 `tab` 可回落默认页签；精确深链缺项、矛盾、非法页签或缺版本均呈现不可定位/拒绝，不静默改读另一对象。纯登记只有任务引用时，不带 `record*`，不伪造执行。

重定向保留与当前动作有关的其他查询串，例如 `preActionSnapshot/preActionSnapshotVersion`；`result` 等定位引用仍由原所属读取验证，不把透传当授权。对转换所占用的 `version/tab/record*` 做语义映射，不能盲保留 search 使旧 `version` 覆盖目标任务版本。来源同时给出两套相互矛盾的引用则拒绝，不任选其一。

### 已有窄读证据与仍需闭合之处

| 现有读取 | 已返回的可用事实 | 能否证明完整子记录→任务反查 |
|---|---|---|
| `readResponseRecommendation` / `RecommendationView` | 建议精确引用、`taskRef` | 证明建议链路；仍需目标任务授权和关系核验 |
| `readEffectForecast` / `ForecastView` | 预测与 `recommendationRef` | 仅有上游引用，不能宣称通用反查已存在 |
| `readExecutionRecord` / `ExecutionView` | 执行及 adopted-recommendation 或 independent-action 来源 | 独立执行尤其不能假设存在建议→任务链 |
| `readFeedbackRecord` / `FeedbackView` | 反馈与 `executionRef` | 未提供完整任务引用 |
| `readCalibrationSuggestion` / `CalibrationView` | 校准与 `deviationRecordRef` | 未提供完整任务引用 |
| `readWarningResponseResolve` | 请求对象自身的可见版本 `refs` | 不是跨 kind 的所属任务反查 |

CH7 复用原所属域精确读，只有需要进入任务页签的记录才要求闭合任务关联；不足处补所需授权窄读，不造通用转换框架、不扫描首页。**独立行动不得被强制绑定或新建处置任务**：所属域证明记录可独立读取且没有任务关联时，旧精确 URL 直接呈现同一子记录详情／登记组件的独立形态，保全执行、反馈和校准操作，不复制第二套正文或业务逻辑。不能证明关系、无权或不存在则同形拒绝，不通过“找不到任务”把合法独立记录降为不存在。

## 决定 3：精确复核 URL 与全屏覆盖层

```
/review-audit/tasks/:taskId?version=:reviewTaskVersion&project=:projectId
```

同时保留原 `revision/assessmentSources`（如有）。从待办页内打开时是全屏覆盖层，地址栏就是该精确 URL；刷新或复制直达时呈现同一详情视图的全屏形态，不依赖背景页面或待办项仍在队列。

返回/取消：有同会话、同工程且仍合法的短生命周期背景 URL 时恢复该 URL，否则去当前会话合法默认入口 `/overview`（工程缺失仍走既有上下文门禁）。只存背景 URL/必要呈现状态，不持久缓存任务、证据或其他业务正文；注销、工程切换、权限失效时丢弃背景。

历史已决定/已取代任务仍按完整引用读详情；决定动作取详情的权限与当前状态，不依赖 pending 查询，不用 URL 合成完整写命令。识别候选六分支与其他类型决定全部保留，七态、拒权及失败恢复沿既有契约。

## 决定 4：逐段精确匹配与交集优先级

仅匹配完整路径的逐段形状，不能忽略中段静态文本、不能把查询串页签当路径参数。对确有交集且同时匹配的模板，首个静态/参数不同段以静态段优先：

| 模板及输入 | 必须观察到的结果 |
|---|---|
| `/warnings/:warningId/actions` 与 `/warnings/tasks/:taskId`；输入 `/warnings/abc/actions` | warning 动作，warningId=abc；后一个模板根本不匹配 |
| 同上；输入 `/warnings/tasks/actions` | tasks 静态前缀，taskId=actions |
| 静态形状相同、仅参数名不同且有交集的模板 | 注册时明确拒绝冲突，不靠注册顺序/字典序任选对象 |

本决议不强制排序、树遍历或其他算法，只定可观察优先级与相同具体度交集的注册错误；不固化参数数目→静态段数→字典序三键。

## 决定 5：逐条旧地址映射

下表 T/TV 是任务精确引用，R/RV 是子记录精确引用；任务精确引用必须来自原参数或授权反查，不能由 R/RV 改名生成。工程选择器与动作上下文按决定 2 保留。

| 旧地址 | 规范承载 | 负责切换 |
|---|---|---|
| `/assessment/start` | `/assessment` 内就地发起；保留已有输入选择上下文但不自动提交 | CH6 |
| `/assessment/reassessments` | `/assessment/records`，保留风险输入/重评估历史筛选与精确引用 | CH6 |
| `/response/recommendations/:recommendationId?version=RV` | `/warnings/tasks/T?version=TV&tab=recommendation&recordKind=response-recommendation&recordId=R&recordVersion=RV` | CH7 |
| `/response/executions/register?task=T&taskVersion=TV` | `/warnings/tasks/T?version=TV&tab=execution`（纯登记） | CH7 |
| `/response/executions/register?task=T&taskVersion=TV&execution=R&version=RV` | `/warnings/tasks/T?version=TV&tab=execution&recordKind=execution-record&recordId=R&recordVersion=RV` | CH7 |
| `/response/executions/register?execution=R&version=RV` | 同上，T/TV 必须授权反查，不能把 RV 当 TV | CH7 |
| `/response/predictions/:predictionId?version=RV` | `/warnings/tasks/T?version=TV&tab=prediction&recordKind=effect-forecast&recordId=R&recordVersion=RV` | CH7 |
| `/response/feedback/:feedbackId?version=RV` | `/warnings/tasks/T?version=TV&tab=feedback&recordKind=feedback&recordId=R&recordVersion=RV` | CH7 |
| `/response/calibrations/:suggestionId?version=RV` | `/warnings/tasks/T?version=TV&tab=calibration&recordKind=calibration-suggestion&recordId=R&recordVersion=RV` | CH7 |
| `/review-audit` | `/overview?tab=todo`；CH9 前保留旧队列入口 | CH9 |
| `/review-audit/identification/:taskId?version=RV` | `/review-audit/tasks/:taskId?version=RV`，同一复核视图 | CH9 |
| `/review-audit/trace?subject=:recordId` | 授权窄解析风险记录版本后到 `/identification/records/:recordId?version=RV&tab=trace`；不扫描首页 | CH5 |
| `/review-audit/runs` | `/overview?tab=runs` 的有界运行摘要，保全原查询能力 | CH3 |

这些是 11 个现有模板的地址解析规则（执行模板按三种参数形态展开），不是要删除的 URL；表中任务页签落点以有可验证任务关联为前提，独立行动按决定 2 保留原精确地址及共享独立形态。trace 无 subject 时只到同工程风险列表，不擅自选择记录；给了无法授权解析的 subject 则同形拒绝/不存在。旧实现只有风险 subject，不能按未知类型猜测并分流。

### 原有别名逐条落点

| 已知别名模板 | 规范落点 | 切换依赖 |
|---|---|---|
| `/project` | `/projects` | CH4；现有简单别名可沿用 |
| `/project/documents` | `/projects/documents` | CH4 |
| `/project/documents/:docId` | `/projects/documents/:docId` | CH4 |
| `/project/monitoring` | `/projects/monitoring` | CH4 |
| `/project/monitoring/:seriesId` | `/projects/monitoring/:seriesId` | CH4 |
| `/review` | `/overview?tab=todo` | CH9 前仍到原复核队列 |
| `/review/tasks/:taskId` | `/review-audit/tasks/:taskId`，原 `version` 不变 | CH9 统一呈现前保留原详情 |
| `/review/identification/:taskId` | `/review-audit/tasks/:taskId`，原 `version` 不变 | CH9 |
| `/review/audit` | `/review-audit/audit`（治理归属不改地址） | CH8 |
| `/review/trace` | 与上表 trace 同规则 | CH5 |
| `/review/runs` | `/overview?tab=runs` | CH3 |
| `/assessment/quality-evaluation` | `/assessment/quality` | CH6 |

`/` 继续进入 `/overview`；会话门禁不改。其余 40 个规范承载逐条见映射附件（含 2 个会话门禁、`/knowledge` 根和质量注入），不得用广义“其余都删除”替代清单。`/assessment/matrix` 特别保留无导航共享只读矩阵：有精确评估记录上下文时定位详情矩阵区；只有冻结矩阵/输入引用时直接读取所给版本，无引用时保留原有合法空网格能力，不跳任意当前评估、不新造列表矩阵浏览器、不保留第二套图表实现。

## 决定 6：切换门槛与规格归属

保留九个 CH 工作包；公共路由/导航契约落既有 `platform/web-shell-interaction-primitives` delta，各业务仍修改原四个 web capability，新设计系统/总览/搜索停靠区规格仅收新行为。不能为六导航按路径强行 supersede 或拆掉原能力。

CH2 只准备公共接缝与能力授权，不提前发布删旧入口的六导航、不启用无承载的重定向。CH3–8 各自把目标视图、精确读、授权和历史深链验收闭合后，**原子启用对应重定向并移除旧页面实现**；相应硬编码旧链接同时迁移，不靠永久入口掩盖内部旧调用。CH9 可并行研究/开发，但最终六导航、搜索与停靠区组合启用须依赖 CH3–8 目标就绪；复核队列/详情切换由 CH9 自己闭合前，不切断旧队列。构建顺序不等于发布顺序。

## 后续验收锚点与仍真实的风险

- 逐条核对 51 个现有模板：40 规范承载 + 11 永久解析入口，8 个规划页不混入现有清单。减少导航入口不是删掉 URL 身份；约数只作工作量估计，不作可达性验收断言。
- 精确子记录跨关系分页仍能直接读；双版本、工程选择器、动作引用不丢；无版本旧入口只经授权自身版本解析，不盲取任务版本。
- 覆盖所属域关联缺口与合法独立行动：有任务则保全双引用，无任务但合法独立可读则保全原地址和原操作；无权／不存在同形，不泄露关系或工程原因，不自动替换目标。
- 覆盖已决定/已取代复核直达、刷新、返回/取消、七态与合法决定分支；不得只测 pending 队列里的任务。
- 覆盖真实模板交集、注册顺序互换后同结果、相同具体度交集拒绝、非法导航页签与精确对象页签区分。主代理已实跑的 `/warnings/abc/actions` 两种注册顺序结果无需再次确认；本次未运行测试。
- 覆盖冻结矩阵/输入引用及旧运行查询承接，旧投影下线须以真实调用者为据，不以菜单入口消失为据。

