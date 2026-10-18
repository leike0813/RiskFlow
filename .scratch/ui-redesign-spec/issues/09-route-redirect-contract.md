# 路由重定向与深链兼容契约

Type: grilling
Status: resolved
Blocked by: 02

## Question

票 02 重组导航与页面承载，但不删除历史 URL 身份：现有 51 条模板逐条映射为 40 个规范承载与 11 个永久旧解析入口。既有 3 条前缀别名不能独自表达子记录到任务的授权解析；工程、版本与原对象权限必须保全。

**一套完整的重定向契约**需要定下来，否则外部文档、演示书签、已导出报告中的链接会静默失效。

具体要回答：

1. **哪些旧页面要迁移承载**：逐条列出旧路径 → 新路径/新页签；地址保留不等于旧页面保留，所选对象身份与版本如何不丢？
2. **重定向与保留共享视图如何区分**：哪些旧地址只作永久解析入口，哪些仍承载唯一共享只读视图，如何避免第二套旧页面与权限旁路？
3. **查询串与参数的传递**：`SectionTabs.tsx` 用 `NavLink` 并保留查询串。重定向时 `?subject=`、`?task=`&`?taskVersion=`、`?result=`、`?tab=` 这类参数如何透传？`?tab=` 是新增的一档（处置任务深链到页签），需定义其合法取值。
4. **兼容路由的维护期限**：旧路径要保留多久？由谁在何时评估是否移除？
5. **路由模板交集如何处理**：沿用逐段精确匹配；确有交集时，是否规定首个不同段的静态段优先于参数段，以及相同具体度冲突在注册时明确拒绝？
6. 落地形式：重定向契约是写进 OpenSpec spec（作为路由契约条款），还是只作为施工期实现细节？`business-routes.test.ts:7-23` 已断言可解析路由数与七项导航，新结构下这些断言怎么改？

## Answer

产出资产：[路由重定向与深链兼容契约](../../riskflow-master-plan/prototypes/route-redirect-contract.md)。

**现状事实**：`applyWebPathAliasV1` 按段边界替换前缀并保留 search；`resolveWebRoute` 当前按参数个数排序再逐段精确匹配。`/warnings/:warningId/actions` 与 `/warnings/tasks/:taskId` 都是 1 参数、2 静态段；`/warnings/abc/actions` 与后者不相交，不存在所述误匹配。真正交集是 `/warnings/tasks/actions`，三键排序也不能正确表达它的静态前缀优先级。

**长期契约**：

1. **永久精确解析入口，不保留第二套旧页面**。这是已批准纠错采用最小维护成本的稳定地址策略；不与 C38 绑定自动移除，不再接受历史报告/书签链接因该节点到期而失效。现有前缀别名保留段边界与权限语义，已知旧路径逐条落至规范承载；不要求新通用转换器或固定表名/数据结构。
2. **双身份、双版本**。新处置子记录地址为 `/warnings/tasks/:taskId?version=:taskVersion&tab=:tab&recordKind=:kind&recordId=:id&recordVersion=:recordVersion`，保留 `project/revision/assessmentSources`。现有任务详情的 `version` 始终是任务版本；旧建议/预测/反馈/校准详情的 `version` 转成 `recordVersion`，绝不透传覆盖任务版本。执行旧链接的 `task/taskVersion` 与 `execution/version` 分别映射任务和执行引用。已给精确版本不得替换成最新值；旧无版本链接只允许所属域授权解析自身版本后规范化 URL。
3. **直接精确读取所选子记录**。不在关系首页定位，不拿子记录版本冒充任务版本。进入任务页签时复用已有精确关联，缺口由 CH7 所属域补窄读；合法独立行动无任务关联时保留原精确 URL，以同一子记录组件独立呈现并保全原操作，不强制绑定或新建任务。无权、关系不可验证或不存在则同形拒绝，不泄露工程或解绑原因。
4. **保留精确复核 URL**：`/review-audit/tasks/:taskId?version=:reviewTaskVersion`，加工程选择器。待办内打开为全屏覆盖层；刷新/直达为同视图全屏；返回/取消恢复合法短生命周期背景 URL，否则合法默认 `/overview`，不持久缓存业务正文。生产 `useLocatedReviewTask` 已按精确引用直接读详情；历史已决定/已取代任务不依赖 pending 队列。识别复核旧地址仅解析至同一视图，原分支完整保留。
5. **可观察匹配优先级，不强制算法**。逐段精确匹配；两个模板都有匹配且确有交集时，在首个静态/参数不同段以静态段优先，故 `/warnings/tasks/actions` 归 tasks 静态前缀，`/warnings/abc/actions` 仍归 warning 动作。相同具体度且有交集的模板注册时拒绝；不靠字典序、注册顺序或参数/静态段总数选择对象。
6. **精确选择不能静默回落**。`tab` 合法值为 `warning/recommendation/decision/execution/prediction/feedback/calibration`。仅无所选对象的导航型非法页签可回落默认页签；带 `recordKind/recordId/recordVersion` 的精确深链缺项、矛盾或非法页签必须显示不可定位，不改读其他记录。详情 `version` 与 `recordVersion` 互不兜底。
7. **旧地址逐条映射见附件**。`/assessment/matrix` 保留无导航共享只读承载（有精确记录上下文可进入详情矩阵区），不为旧链接新造列表矩阵浏览器。旧 trace 只有风险记录 `subject`，需授权窄解析版本后至风险详情 `tab=trace`，不发明通用类型分流。旧 runs 到 `/overview?tab=runs`，旧队列根到 `/overview?tab=todo`；仍保留精确复核详情 URL。
8. **发布次序**：CH2 仅准备公共接缝与授权，不提前删除旧入口。CH3/5/6/7 各承接运行摘要、追溯、评估和处置路由；CH8 治理改归属不改审计/报告地址；CH9 承接复核待办与最终导航。业务 CH 在目标承载、权限、历史深链通过后原子启用重定向并移除旧页面；CH9 可并行开发，但最终六导航与停靠区组合启用依赖 CH3–8 就绪，CH9 前不切断旧队列。
9. **规格与验收**：长期路由契约落既有 `platform/web-shell-interaction-primitives` 与四个 web capability 的 delta；新增规格只收新行为，不按导航重划能力。本次只改决议文档，不创建/操作 change。后续更新硬编码旧链接和相应路由/权限/历史深链测试；按附件逐条清单断言，不以“约 24 条”或单一路由总数代替覆盖。

**仍真实的风险**：全覆盖子记录到任务授权窄读尚未有证据；旧 trace 的无版本 `subject` 当前扫描目录首页，CH5 必须闭合；复核分支、冻结版本矩阵、运行查询不能因入口合并丢失。未来验收应覆盖交集优先级与注册冲突、拒权同形、双版本、非首关系页记录、历史复核直达和返回行为。本票未重跑主代理已实跑的匹配检查。

