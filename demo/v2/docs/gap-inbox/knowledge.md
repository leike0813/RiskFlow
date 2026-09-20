# gap-inbox · knowledge（P-KM-01～P-KM-08）

> 临时 ID 规则：`GAP-KM-NN`，主代理收尾时统一编号合并进 `src/review/gap-ledger.data.json`。

## GAP-KM-01 规范标准库 / 案例库页面的 branch 语义是检索而非治理读

- 类别：G2 契约字段
- 相关页面：P-KM-03、P-KM-04（P-KM-08 同理）
- 缺口：manifest 将规范标准库、类比工程案例库、措施库标为 `knowledge-modeling.hybrid-evidence` / `knowledge-modeling.measure-candidates`，但这些 branch 在契约中是识别/评估运行期的**检索查询**（hybrid-evidence 需要 inputSnapshotRef 与 workItemRef，measure-candidates 需要 assessmentRecordRef 与 taskRef），而页面语义是知识对象的**治理读**。
- 依据：demo/v2/docs/page-manifest.json（P-KM-03/04/08 条目）；packages/contracts/src/ports/index.ts:1337-1366（KnowledgeRetrievalQueryV1Schema 三个 query 的 payload 形状）
- 预设：v2 页面按治理读呈现（D 骨架 + 版本列表），能力位沿用 manifest 标注（knowledge-modeling.retrieve）；branch 归属待裁决是否新增治理读 branch 或复用 identification-basis / assessment-basis。
- 待确认：standard-library / case-library / measure-library 的治理读走哪个 branch；GAP-012 的逐页核对是否覆盖本域。
- 风险：仅 manifest 标注调整，无结构影响。

## GAP-KM-02 量化标准无 KnowledgeDefinitionType 枚举值

- 类别：G2 契约字段
- 相关页面：P-KM-05
- 缺口：`KnowledgeDefinitionTypeV1Schema` 有 indicator-system、indicator-field-mapping，但没有「量化标准」对应的 definition type；任务与项目 AGENTS.md 均要求量化标准作为独立不可变版本引用。v2 页面以独立 versionedRef（量化标准 QSTD-001 · v1.0）呈现。
- 依据：packages/contracts/src/ports/index.ts:1244-1264（KnowledgeDefinitionTypeValues 枚举）；demo/v2/src/content/knowledge.ts（QUANTIZATION_STANDARD_REF）
- 预设：量化标准暂作为 indicator-system 定义内的关联版本引用呈现；待裁决是否新增 definition type（如 quantization-standard）。
- 待确认：量化标准是独立治理对象还是指标体系的组成部分。
- 风险：若独立成定义类型，P-KM-05 的对象拆分与治理粒度需调整。

## GAP-KM-03 治理生命周期状态词汇无契约枚举

- 类别：G6 规格空白
- 相关页面：P-KM-01～P-KM-08
- 缺口：八页统一呈现「草稿 / 审核中 / 已发布 / 已停用 / 回滚即新版本」五态，但 contracts 只有治理命令（submit-revision / request-review / publish-approved-release / deactivate-release / rollback-by-new-release），没有 revision/release 的生命周期状态枚举与状态机定义，页面状态目前从命令序列推导。
- 依据：packages/contracts/src/ports/index.ts:1272-1312（KnowledgeGovernanceCommandV1Schema）；demo/v2/src/content/knowledge.ts（KnowledgeLifecycle）
- 预设：v2 按命令序列推导生命周期（草稿=submit-revision 后、审核中=request-review 后、已发布=publish 后、已停用=deactivate 后、回滚=rollback-by-new-release 生成的新版本）。
- 待确认：是否在契约中显式定义 KnowledgeRevision / KnowledgeRelease 的状态枚举与转换约束。
- 风险：状态推导规则若与生产实现不一致，筛选 chips 与版本列表的计数语义需重做。

## GAP-KM-04 风险矩阵版本化定义（刻度/等级/cellLevels/acceptable）无 Schema

- 类别：G2 契约字段
- 相关页面：P-KM-07
- 缺口：risk-matrix 只是 KnowledgeDefinitionType 的一个枚举值，矩阵定义内容（行列刻度、等级文案、cellLevels、acceptable 掩码、thresholdVersion）在 contracts 中无对应 Schema（仅 ContentArtifactRef 引用），但它是 P/C 映射的事实源且须可重放。
- 依据：packages/contracts/src/ports/index.ts:1255-1258（KnowledgeDefinitionTypeValues 中 risk-matrix / risk-acceptance-threshold）；demo/v2/src/content/knowledge.ts（RISK_MATRIX_CONFIG）
- 预设：v2 以 fixture 承载矩阵定义并全部数据驱动渲染（RiskMatrixVersionChart）；形状待契约补 RiskMatrixDefinition Schema 后对齐。
- 待确认：矩阵定义 Schema 的字段命名与 acceptable 掩码语义归属 C32 还是后续 change。
- 风险：Schema 落地后 fixture 字段需一次性重命名，无运行时影响。
