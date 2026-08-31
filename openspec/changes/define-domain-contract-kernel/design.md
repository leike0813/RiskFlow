## Context

见 [proposal.md](./proposal.md) 的动机。C00 已建立 `@riskflow/contracts` 空包、NodeNext/TypeScript project references、根级 Vitest 与依赖治理；目前没有生产领域 DTO、Schema 或可复用枚举。`demo/` 中的接口是展示原型，包含未审定扩展字段且不属于生产 workspace，不能迁入事实源。

C01 是 G0 契约闸门的第二步。它只固定跨模块都会使用的内容契约，C02 再基于这些契约定义 module interface、事件和工作流。设计依据为项目 `AGENTS.md` 的当前字段契约、两份专利、详细技术方案和甲方阶段材料；评估专利批注不作为已定字段。

## Goals / Non-Goals

**Goals:**

- 让调用方从三个稳定子路径获得完整领域词汇、通用信封与业务记录 Schema。
- 让运行时校验与 TypeScript 类型共享同一个 Zod 定义，严格拒绝未知字段和不完整对象。
- 固定身份、精确版本、双时间、证据与审计的最小组合，使后续记录可引用、可重放、可追溯。
- 把标准化风险记录的七项内容与管理信封分开，防止后续模块扩张专利字段。
- 用一个参数化测试文件覆盖稳定高风险边界，不复制测试同一字段的所有排列。

**Non-Goals:**

- 不定义六领域模块、应用模块、LangGraph 或 Agent 的 interface；不定义命令载荷和错误码全集。
- 不定义审核、通知或业务记录的状态转换；只定义记录当前状态所需字段和值域。
- 不实现评分、矩阵、阈值、合并、综合置信度计算、Schema 失败路由或任何领域写入。
- 不定义数据库表、迁移、Outbox、Qdrant、文件工件或 API 传输格式。
- 不从 Demo 复制接口，不为未来扩展预留任意字段袋；明确允许结构化详情的错误信封除外。

## Decisions

### 1. 以三个深层模块提供稳定 interface

`@riskflow/contracts` 提供以下 interface：

| 公开入口 | 拥有内容 | 隐藏内容 |
| --- | --- | --- |
| `@riskflow/contracts/vocabulary` | 固定只读值、对应枚举 Schema、派生类型 | Zod 枚举构造方式 |
| `@riskflow/contracts/common` | 标识、版本、双时间、证据、审计、命令/错误信封及小型共享值对象 | 字符串/时间校验细节 |
| `@riskflow/contracts/records` | §2.6/§2.7 业务记录 Schema 与派生类型 | Schema 组合和交叉字段校验 |
| `@riskflow/contracts` | 上述三个入口的便利性重导出 | 无额外定义 |

每个子模块只用一个 `index.ts` 实现。当前规模不值得按每个 DTO 拆文件；三处聚合既保持目录所有权，又避免十几个浅层 barrel。C02 只新增自己的子路径，不应修改这三个模块的内部事实。

备选方案：只保留根入口。否决原因是所有后续 change 都会修改同一 barrel，增加工作树冲突并让调用方获得不相关契约。备选方案：每个 Schema 一个文件。否决原因是没有独立变化轴，文件数和导入层级大于实现。

### 2. Zod Schema 是值与类型的单一事实源

每个公共 DTO 先定义 `...Schema`，类型一律以 `z.infer<typeof ...Schema>` 导出。固定枚举先定义 `as const` 只读值，再由同一值创建 `z.enum`；不手写并行 string union。所有业务对象使用 strict object，未知字段直接校验失败。

`zod@4.5.4` 作为 `packages/contracts` 唯一直接依赖：

| 项目 | 决定 |
| --- | --- |
| 用途 | 运行时边界校验、组合 Schema、静态类型派生 |
| 许可证 | MIT，已在 C00 允许清单内 |
| 官方来源 | `https://www.npmjs.com/package/zod` |
| 离线来源 | 内网 npm 镜像或 `pnpm fetch` 制备的 store |
| 退出条件 | 停止维护；Node 24/TS 5.9 兼容失败；或标准平台机制能提供等价的运行时/静态 SSOT |

备选方案：只用 TypeScript 类型。否决原因是 API、模型和文件输入都需要运行时校验。备选方案：自写解析器。否决原因是要重复组合、错误收集和类型推导能力，代码更多且更难审计。

### 3. 固定词汇按专利原中文值导出

`vocabulary/index.ts` 精确导出下表集合，不提供别名或自动归一化：

| 导出名 | 值 |
| --- | --- |
| `PROCESS_NODE_VALUES` | 扩径准备、变径空间扩挖、刀盘扩径、盾体扩径、缩径转换 |
| `EQUIPMENT_COMPONENT_VALUES` | 小盾构、扩径模块、扩挖机构、拼装机械臂、伸缩帽檐、反力系统、推进系统、焊接装配单元 |
| `STRUCTURAL_COMPONENT_VALUES` | 钢管片、锚杆、尾盾 |
| `STATE_PARAMETER_DESCRIPTION_VALUES` | 盾体直径、刀盘直径、主驱动伸出量、土仓/泥水压力、注浆参数、支护状态、反力体系状态、焊接/拼装状态 |
| `MONITORING_INDICATOR_VALUES` | 地表沉降、支护结构变形、地下水位、泥水压力、注浆压力、盾构姿态参数 |
| `RISK_MECHANISM_TYPE_VALUES` | 掌子面稳定性失效、支护结构失效、渗流突涌、过挖与地表沉降、施工装备故障、装配连接失效 |
| `PROCESS_DEPENDENCY_RELATION_TYPE_VALUES` | 时间先后关系、资源依赖关系、受力依赖关系、作用关系 |
| `APPLICABILITY_METADATA_DIMENSION_VALUES` | 施工工法数据、地层条件数据、工程阶段数据 |
| `RISK_ASSESSMENT_INDICATOR_TYPE_VALUES` | 发生可能性评估指标、后果严重性评估指标 |
| `QUANTITATIVE_INDICATOR_GROUP_VALUES` | 地质与围岩条件、地下水与渗透条件、开挖与支护参数、施工工艺与设备参数、监测量测与周边环境 |
| `WARNING_TRIGGER_TYPE_VALUES` | 风险等级超过风险可接受阈值、监测指标越限、趋势/加速度/异常评分越限、多指标联合规则命中 |

命名使用“构件”对应 `StructuralComponent`，避免与 React Component 混淆；对外中文值不改写。

### 4. 通用值对象只承载跨模块不变量

`common/index.ts` 导出以下 strict Schema 和派生类型：

| Schema | 字段与不变量 |
| --- | --- |
| `IdentifierSchema` | trim 后非空字符串；不强行规定 UUID，避免锁死甲方已有标识 |
| `IsoDateTimeSchema` | 带时区的 ISO 8601 时间 |
| `VersionReferenceSchema` | `{ entityId, versionId }`，两者均非空；禁止“latest”语义由调用方约定 |
| `EffectivePeriodSchema` | `{ validFrom, validTo? }`；有结束时间时必须晚于开始时间 |
| `SystemRecordTimeSchema` | `{ recordedAt, supersededAt? }`；有替代时间时必须晚于记录时间 |
| `VersionedRecordInfoSchema` | `{ reference, effectivePeriod, systemTime }`，组合精确版本与双时间 |
| `EvidenceLocatorSchema` | `{ sourceSegmentId }`；只校验非空，不用正则拆分，以免资料/章节/段标识自身含连字符时误判 |
| `EvidenceReferenceSchema` | `{ locator, sourceVersion }`，证据同时固定资料段与资料版本 |
| `AuditInfoSchema` | `{ actorId, action, recordedAt, reason? }`；只追加/授权由实现模块保证 |
| `ReviewStatusSchema` | `pending`、`approved`、`rejected` 三值；实际迁移留给 C02 |
| `ValidationResultSchema` | `{ passed, issues }`；`issues` 是结构化短码数组，不锁定展示文案 |
| `CommandEnvelopeSchema` | `{ commandId, idempotencyKey, projectId, actorId, issuedAt, payload }`；载荷为 `unknown`，C02 用具体 Schema 收窄 |
| `ErrorEnvelopeSchema` | `{ code, retryable, message?, details? }`；分支只依赖稳定码和可重试性 |

`VersionReferenceSchema` 不把发布时间放入引用，因为发布时间属于被引用版本的事实；调用方需要历史重放时通过版本实体读取。`sourceSegmentId` 的展示格式仍为 `资料ID-章节ID-资料段ID`，但 C01 不通过连字符数量推断其组成。

备选方案：为每种实体创建 branded ID。否决原因是当前没有跨信任边界混用的真实故障，而且会产生大量浅层类型；实体语义由字段名和后续 module interface 表达。

### 5. 识别内容记录与管理信封分离

`records/index.ts` 定义：

| Schema | 字段 |
| --- | --- |
| `RiskElementRelationSchema` | `{ sourceElement, relation, targetElement }`，三项非空 |
| `ModelOutputResultSchema` | `riskSource`、`riskFactor`、`riskEvent`、`riskElementRelations`、`evidenceLocator`、`modelConfidence` |
| `StandardizedRiskRecordSchema` | `processNodeId` + 模型输出六项；strict 后恰好七项 |
| `CompositeConfidenceSchema` | `{ value, basis }`；value 为 `[0,1]`，basis 至少一项非空依据码 |
| `StandardizedRiskRecordEnvelopeSchema` | `{ riskRecordId, record, riskMechanismEntryIds, sourceIds, compositeConfidence, version, audit }` |

风险要素使用字符串内容而不在 C01 建立风险源/因素/事件实体引用，因为专利模型输出就是内容结果；C22 决定验收入库时如何生成图谱实体。`riskElementRelations` 至少一项，以免“风险要素关系”字段名存在但无可解释关系。

`StandardizedRiskRecordSchema` 不复用 `.passthrough()`，也不接受 envelope 字段。C22 若收到模型自创字段，strict 校验失败后显式转人工复核。

### 6. 评估知识与风险输入使用结构化、可辨识组合

评估相关 Schema：

| Schema | 字段与约束 |
| --- | --- |
| `ApplicabilityMetadataSchema` | `{ constructionMethod, stratumCondition, engineeringStage }`，三项均非空且形成快照值 |
| `ApplicabilityConditionsSchema` | 同三维字段，但每维为至少一项的非空值数组 |
| `ScalarValueSchema` | `string \| number \| boolean`，用于尚未固定单位的指标实际值；对象/数组不接受 |
| `ScoringThresholdSchema` | `{ thresholdId, operator, value, upperValue?, score }`；operator 为 `lt/lte/eq/gte/gt/between`，`between` 必须有 `upperValue`，其它 operator 禁止 `upperValue` |
| `GradeIntervalSchema` | `{ grade, lowerBound?, upperBound? }`；至少一端存在，同时存在时上界必须大于下界 |
| `StructuredScoringRuleSchema` | §2.7 九项最小字段；阈值和分级区间至少一项，例外条款可以为空数组 |
| `RiskInputReferenceSchema` | 两个 strict object 的 union：仅 `{ riskRecordId }` 或仅 `{ externalRiskEventId }` |
| `IndicatorResultSchema` | `{ indicatorItem, actualValue, baseScore, weightedScore, ruleVersion, evidenceReferences }` |
| `TriggerIndicatorSchema` | `{ indicatorItem, triggerType, actualValue? }` |
| `RiskAssessmentRecordSchema` | §2.7 十二项最小字段 + `weightVersion`；通过 `RiskInputReferenceSchema` 与其余公共字段交叉组合 |

`RiskAssessmentRecordSchema` 字段清单为：`assessmentRecordId`、风险输入 XOR 的一个标识、`applicabilityMetadataSnapshot`、`likelihoodScore`、`consequenceScore`、`riskLevel`、`indicatorResults`、`triggerIndicators`、`evidenceReferences`、`applicableRuleSetVersion`、`weightVersion`、`riskMatrixVersion`、`audit`。分值只要求有限数值；范围、聚合与矩阵定义由甲方版本化配置和 C25 确定性模块决定，C01 不假设 1～5 或百分制。

备选方案：增加 `sourceType` 判别字段。否决原因是字段名本身已能辨识来源，新增第三字段会扩张 §2.7。备选方案：两个 optional 字段再 `refine`。否决原因是静态类型仍允许含糊对象；两个 strict 分支可同时约束运行时和类型层。

### 7. 预警、处置与偏差以引用贯通，不复制上游记录

| Schema | 字段 |
| --- | --- |
| `WarningRecordSchema` | `warningRecordId`、`assessmentRecordId`、`warningLevel`、`triggerType`、`triggerIndicators`、`evidenceReferences`、`recommendedResponseDirection`、`notificationStatus`、`audit` |
| `MeasureItemSchema` | `{ measureId, content }` |
| `TargetIndicatorSchema` | `{ indicatorItem, targetValue }` |
| `ResponseRecommendationSchema` | `responseRecommendationId`、`warningRecordId`、`measureItems`、`implementationOrder`、`resourceRequirements`、`targetIndicators`、`triggerConsistencyValidation`、`standardsComplianceValidation`、`siteFeasibilityValidation`、`reviewStatus`、`version`、`audit` |
| `RiskStateSchema` | `{ likelihoodScore, consequenceScore, riskLevel }`，用于表达预测和实际结果，不复制评估记录 |
| `DeviationRecordSchema` | `deviationRecordId`、`responseRecommendationId`、`predictedRiskChange`、`actualRiskChange`、`deviationValue`、`deviationThresholdVersion`、`evidenceReferences`、`calibrationRecommendation`、`reviewStatus`、`version`、`audit` |

`implementationOrder` 是非空 measureId 数组；Schema 保证字段形状，C27 的确定性校验再保证它与 `measureItems` 一一对应且无重复。三项处置校验使用同一 `ValidationResultSchema`，不创建三个重复 DTO。

校准建议只是非空候选说明和审核状态。strict `DeviationRecordSchema` 不提供 `publishedRuleVersion`、`replaceWeight` 或“自动生效”字段，发布必须走后续人工审核 interface。

### 8. C01 没有持久化、外部 Adapter 或运行状态机

本 change 的 module 是纯契约模块：输入对象，返回 Zod 解析结果或抛出/返回 Zod 校验问题，取决于调用方使用 `parse` 或 `safeParse`。没有事务边界、Outbox、检查点、业务幂等写入、数据库表、迁移、Qdrant 投影、文件删除或外部写入。

命令信封只让 C02 及后续模块获得显式幂等身份，不承诺 C01 自己去重。审核状态只表达当前事实，不允许在 C01 实现状态迁移。业务取消、暂停、恢复与重试同样留给 C02/C07/C08/C09。

### 9. 权限、错误、可观测性和性能边界

- **权限**：Schema 不判断权限。`actorId`、`projectId` 和审计字段由已授权调用方提供；C06/C07 在 module interface 前校验权限。证据正文不进入 EvidenceLocator，因此本 change 不扩大可见性。
- **错误**：Schema 失败由 `safeParse` 提供结构化 issue；测试只断言成功/失败及必要字段路径。业务模块对外转换为 `ErrorEnvelopeSchema`，完整错误码表在 C02 固定。
- **可观测性**：C01 无日志、指标、链路或秘密。后续运行记录只保存 DTO 名称/版本与校验结果，不记录敏感正文的责任在调用方。
- **性能**：Schema 只遍历当前对象和数组，目标为输入大小线性复杂度；不访问网络、文件或数据库。C01 不设未经真实样例测量的毫秒门槛。

### 10. 验证策略

新增一个 `packages/contracts/test/contract-kernel.test.ts`：

1. 参数化遍历 11 组固定词汇，验证所有值接受、代表性未知值拒绝且导出集合无重复。
2. 用最小正例验证通用版本/双时间/证据/命令/错误对象；用代表性反例覆盖倒置时间和空资料段标识。
3. 验证模型结果六项、标准化记录七项、未知字段拒绝、缺少 RI-S61 字段和置信度越界。
4. 验证适用性三维、结构化评分规则、评估输入两个合法分支以及“同时提供/全部缺失”两个非法分支。
5. 验证预警—处置—偏差最小闭环和缺少三项校验的处置反例。

测试不逐字段复制同类缺失用例，不断言完整 Zod 文案、issue 顺序、字段顺序或内部 Schema 类型。`packages/contracts/test` 位于 `src` 外，不进入声明产物。

最小验证命令：

```bash
pnpm exec tsc -b packages/contracts/tsconfig.json --pretty false
pnpm exec vitest run packages/contracts/test/contract-kernel.test.ts
pnpm exec eslint packages/contracts/src packages/contracts/test
pnpm exec prettier --check packages/contracts/src packages/contracts/test packages/contracts/package.json config/dependency-policy.json
pnpm deps:check
pnpm deps:policy
openspec validate define-domain-contract-kernel --strict --no-interactive
```

主 Agent 合并前再执行根 `pnpm verify`，避免在 Luna 的最小验证中重复全仓构建。

### 11. 文件所有权与禁止修改区域

新增：

- `packages/contracts/src/vocabulary/index.ts`：固定词汇。
- `packages/contracts/src/common/index.ts`：通用值对象与信封。
- `packages/contracts/src/records/index.ts`：识别、评估、预警、处置、偏差记录。
- `packages/contracts/test/contract-kernel.test.ts`：单一高价值契约测试。
- `openspec/changes/define-domain-contract-kernel/**`：本 change 工件。

修改：

- `packages/contracts/src/index.ts`：只重导出三个 C01 子模块。
- `packages/contracts/package.json`：增加三个子路径 exports 与精确 `zod` 依赖。
- `config/dependency-policy.json`：登记 Zod 元数据。
- `pnpm-lock.yaml`：由精确清单生成。

删除：无。

禁止修改：`packages/core/**`、`packages/adapters/**`、`apps/**`、`demo/**`、其它主 specs、根工具链、依赖检查实现、C02 预留的 ports/events/workflows，以及任何数据库或部署文件。依赖清单、治理记录和锁文件由主 Agent 先提交检查点，Luna 不自行增删依赖。

### 12. 追踪表

| 追踪 | C01 interface / DTO | 后续持久化所有者 | C01 验收证据 |
| --- | --- | --- | --- |
| RI-S31～S34 | 工序/装备/构件/状态/依赖词汇 | C17 | 词汇参数化测试 |
| RI-S41、RI-S43 | 风险机理与监测词汇 | C16/C17 | 词汇参数化测试 |
| RI-S57 | `ModelOutputResultSchema` | C21/C22 工件与候选存储 | 六项正例、未知字段/置信度反例 |
| RI-S58、RI-S61 | `StandardizedRiskRecordSchema` | C22 | 七项正例、必填缺失反例 |
| RI-S62～S65 | `StandardizedRiskRecordEnvelopeSchema`、证据/版本/审计 | C22/C23 | 内容与信封隔离测试 |
| RA-S1 | `ApplicabilityMetadataSchema`、评估风险输入 XOR | C11/C25 | 三维与 XOR 测试 |
| RA-S2～S4 | 指标词汇、`StructuredScoringRuleSchema` | C18/C19 | 完整规则/缺项反例 |
| RA-S5 | `RiskAssessmentRecordSchema` | C25 | 两类输入、版本快照测试 |
| RA-S6 | 触发词汇、`WarningRecordSchema` | C26 | 未知触发拒绝测试 |
| RA-S7 | `ResponseRecommendationSchema`、`DeviationRecordSchema` | C27～C29 | 三项校验与闭环引用测试 |

## Risks / Trade-offs

- [C01 一次冻结较多记录，后续真实甲方样例可能暴露字段不足] → 只冻结专利/项目规则已明确的最小内容；任何共享字段变化另开契约演进 change，不在业务 change 顺手修改。
- [strict object 会拒绝上游模型的附加解释字段] → 这是 RI-S58 的预期门禁；原始模型响应由 C08/C21 工件存储保留，附加字段进入人工复核，不塞入正式记录。
- [`ScalarValueSchema` 暂不携带单位] → 单位属于指标定义和实际取值映射，由 C18/C25 的版本化指标契约持有；C01 不复制指标元数据。
- [字符串标识不能在类型层阻止实体种类混用] → 当前字段名和 strict DTO 已提供最小安全性；只有真实误用出现且多个实体共享调用位置时再评估 branded ID。
- [根便利入口仍可能成为串行冲突点] → G0 的 C01/C02 本就串行；后续调用方优先使用稳定子路径，业务 changes 不修改 C01 子模块。

## Migration Plan

1. 主 Agent 在 C01 分支登记 `zod@4.5.4`、更新 `packages/contracts/package.json`、依赖政策与锁文件并提交依赖检查点。
2. Luna 只在批准文件清单内实现三模块、公开入口和单一测试，执行最小验证与 OpenSpec verify。
3. 主 Agent 审阅导出面、Schema 字段、正反例与 Git diff；通过后合并到 `main` 并执行根 `pnpm verify`。
4. 经批准后归档 change，把 delta 同步为 `openspec/specs/domain/contract-kernel/spec.md`；C02 只基于归档主 spec 开始。

回滚时整体回退 C01 合并提交即可；C01 尚无持久化数据或外部消费者，不需要数据迁移。若只发生实现缺陷，在同一 change 内修复并重新 verify，不发布半套导出。
