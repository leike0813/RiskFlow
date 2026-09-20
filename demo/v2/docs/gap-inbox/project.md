# gap-inbox · project 域（P-PJ-01～P-PJ-10）

M4 第一批 project 域实现中新发现的缺口提案。每条五字段：缺口 / 依据 / 预设 / 待确认 / 风险。临时 ID 待主代理统一编号合并。

## GAP-PJ-01 典范追溯链资料段标识与 SourceSegmentIdV1 正则不一致

- 缺口：跨域共用资料段标识 `DOC-2026-001-S3.2-SEG-007` 无法通过契约校验——SourceSegmentIdV1Schema 要求恰好三段 `[A-Za-z0-9_]` 组件以连字符连接（`DOC-2026-001-S3.2-SEG-007` 拆分后超过三段，且 `S3.2`、`SEG-007` 含非法字符）。
- 依据：`packages/core/src/engineering-data/context-source/schema.ts:332-336`（SourceSegmentIdV1Schema 正则）、`:382-390`（段标识 sourceId 一致性校验）、`:624-633`（parseSourceSegmentId 三段拆分）；`demo/v2/src/content/project.ts`（DOC-2026-001 段集）。
- 预设：本批次 fixture 沿用链上标识保证跨域引用一致；P-PJ-05/07 按「资料ID-章节ID-段ID」语义呈现。
- 待确认：契约正则放宽（允许点号与多段连字符，或改为结构化三段字段 + 显示用拼接标识），或追溯链标识改为契约合法形态（如 `DOC2026001-S32-SEG007`）。
- 风险：若契约不放宽，接入实现时链上标识需要一次性迁移映射，影响全部域的 fixture 与深链。

## GAP-PJ-02 项目管理四动作在 29 能力位中无专属位

- 缺口：PROJECT_MANAGER_ACCESS_ACTIONS 四项（revise-membership / create-spatial-scope / revise-spatial-scope / revise-source-access）属于 access 模块命令，不走 ModuleBranch，29 个能力位中没有对应动作级能力位；PAGE-GUIDE §4 的「动作所需能力位从 branch 映射取」对这四项无映射可取。
- 依据：`demo/v2/src/app/contract-mirror.data.json`（projectManagerAccessActions 与 branchCapability 无交集）；`packages/core/src/access/schema.ts:164-204`（四项命令定义）；`packages/contracts/src/ports/index.ts:482-536`（53 branch 中无 access 命令通路）。
- 预设：P-PJ-03/04 的动作级门控暂用 `engineering-data.write`（最接近的工程管理写能力位）；页面可见动作名严格取四项清单。
- 待确认：是否新增 access 域能力位（如 `access.manage`），或将四动作显式归入既有能力位并写入契约镜像。
- 风险：门控粒度偏粗——拥有 engineering-data.write 的角色即显示可点，与真实 access 策略（expectedVersion + 授权上下文）不一致。

## GAP-PJ-03 接入任务运行阶段无契约阶段词汇

- 缺口：C 骨架要求运行页呈现阶段条与子任务表，但契约的阶段词汇只有识别 I0–I9 与评估 A0–A9，资料交付 / 监测批次接入流水线没有契约化的阶段编码。
- 依据：`packages/contracts/src/workflows/index.ts:220-246`（IdentificationStageV1 / AssessmentStageV1 仅两类）；`packages/contracts/src/ports/index.ts:918-935`（EngineeringDataCommandV1 为单命令，无阶段模型）。
- 预设：P-PJ-08 用接入流水线阶段码 ING-01～ING-05（接收交付 / 指纹校验 / 结构化转换 / 数据清洗与部分可用判断 / 段集登记入库；监测批次流水线后两段为样本版本化 / 快照候选登记），命名取自既有模块职责（数据清洗对齐 packages/core/src/engineering-data/cleaning/schema.ts）。
- 待确认：接入任务是否纳入工作流运行契约（WorkflowRun 化），或维持模块内任务并为阶段码建契约词汇。
- 风险：若将来接入任务 WorkflowRun 化，阶段码需重新映射；审阅 Harness 中 P-PJ-08 与 P-RI-03/P-RA-03 的阶段条语义不同源。

## GAP-PJ-04 P-PJ-03 manifest branch 与页面实际语义不符（GAP-012 细化）

- 缺口：P-PJ-03（空间区段与上下文修订）的 manifest branch 标注为 `engineering-data.identification-preparation`，但页面语义是工程上下文修订命令（EngineeringContextRevisionCommandV1，kind: project/spatial），不是识别准备冻结命令；后者是 identification-preparation 快照冻结，与修订表单无关。
- 依据：`demo/v2/docs/page-manifest.json`（P-PJ-03 条目）；`packages/core/src/engineering-data/context-source/schema.ts:436-463`（修订命令）；`packages/contracts/src/ports/index.ts:974-991`（EngineeringFreezeCommandV1 为冻结命令）。
- 预设：本批次按页面语义实现修订表单与版本列表，branch 标注暂不动（manifest 为主代理所有）；动作级门控用 engineering-data.write。
- 待确认：P-PJ-03 的 branch 改为何值——53 个 branch 中没有「上下文修订」项，可能需新增 branch 或归入既有 engineering-data 写通路；与 GAP-012 合并裁决。
- 风险：仅单页标注调整，无结构影响；若新增 branch 需同步契约镜像校验。
