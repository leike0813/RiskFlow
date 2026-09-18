# 缺口收件箱：identification（P-RI，C33）

> M4 第二波 identification 域实现期间新发现的缺口提案。每条五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。临时 ID `GAP-RI-NN`，待主代理统一编号合并。

## GAP-RI-01 关系三元组字段命名：PAGE-GUIDE 与 contracts 不一致

- 类别：G2 契约字段
- 相关页面：P-RI-06
- 缺口：PAGE-GUIDE §3 把关系三元组写作「subject / predicate / object 引用齐备」，但 contracts 的 `RiskElementRelationSchema` 固定字段为 `sourceElement / relation / targetElement`；两个命名体系不能直接互换，fixture 字段形状必须二选一。
- 依据：`demo/v2/docs/PAGE-GUIDE.md:35`；`packages/contracts/src/records/index.ts:17-24`（RiskElementRelationSchema）。
- 预设：fixture 与页面以契约为准（sourceElement / relation / targetElement，页面列头「源要素 / 关系 / 目标要素」）；PAGE-GUIDE 的 subject/predicate/object 视为三元组概念描述而非字段名。
- 待确认：PAGE-GUIDE §3 该行是否改写为契约字段名，避免后续批次照文档命名。
- 风险：低；若后续批次按 subject/predicate/object 落地，将与契约校验冲突。

## GAP-RI-02 标准化风险记录封套无 evidenceReferences 字段

- 类别：G2 契约字段
- 相关页面：P-RI-05、P-RI-06
- 缺口：批次要点要求记录「含 evidenceReferences 与 audit」，但 `StandardizedRiskRecordEnvelopeSchema` 只有 `record.evidenceLocator`（单值定位）与 `sourceIds`，没有封套级证据引用数组；多来源证据（资料段 + 地质段 + 监测段）无契约载体。
- 依据：`packages/contracts/src/records/index.ts:38-59`（记录与封套字段集）；`demo/v2/src/content/identification.ts`（RISK_RECORDS 的 evidenceReferences 投影）。
- 预设：v2 在记录视图层提供 `evidenceReferences` 投影（evidenceLocator 定位 + sourceIds 对应资料版本展开），页面证据卡从投影渲染；封套本身不新增字段。
- 待确认：封套是否应固化多证据引用（如 I8 入库时把验收时刻的证据集快照写入），还是维持 record.evidenceLocator 单值 + 投影派生。
- 风险：若生产端封套扩展，投影层需一次性切换到封套字段，无运行时影响。

## GAP-RI-03 RISK-2026-003/004 的机理条目归属与事件语义不匹配

- 类别：G2 契约字段
- 相关页面：P-RI-05、P-RI-06、P-RI-07
- 缺口：第一波 `content/assessment.ts` 的 PENDING_RISKS 把 RISK-2026-003（围护结构变形超限）与 RISK-2026-004（涌水涌砂）的机理条目都标为 MEC-VDS-017（过挖与地表沉降）；按 `content/knowledge.ts` 的机理条目语义，二者更贴近 MEC-VDS-012（支护结构失效）与 MEC-VDS-013（渗流突涌）。
- 依据：`demo/v2/src/content/assessment.ts:787-843`（PENDING_RISKS mechanismEntryId 全为 MEC-VDS-017）；`demo/v2/src/content/knowledge.ts:173-274`（MEC-VDS-012/013 的适用工序与风险事件表达）。
- 预设：本批 fixture 为保持与第一波跨域一致，沿用 MEC-VDS-017 不改；图谱页的「机理命中」边同样全部指向 MEC-VDS-017。
- 待确认：RISK-2026-003/004 的机理归属是否修正为 MEC-VDS-012/013；若修正，assessment.ts PENDING_RISKS 与本域 fixture 需同步。
- 风险：语义层面图谱关联偏弱（涌水涌砂挂在过挖沉降机理下），不影响链路结构。

## GAP-RI-04 跨域 fixture 漂移：RISK-2026-002～004 事件文本与 DOC2026001 版本号

- 类别：G2 契约字段
- 相关页面：P-RI-05、P-RI-06（关联 P-WR-01/02、P-RA-01、P-PJ-05/07）
- 缺口：两处跨域不一致——① RISK-2026-002/003/004 的风险事件文本在 `content/assessment.ts`（扩挖段同步注浆不密实 / 围护结构变形 / 涌水涌砂）与 `content/warning.ts`（掌子面失稳 / 主驱动负荷异常 / 装配连接异常）之间不一致，且 warning.ts 的 WARN-2026-002→ASSESS-2026-002 关联与 assessment.ts 中 ASSESS-2026-002 归属 RISK-2026-001 的重评估冲突；② 资料 DOC2026001 的 sourceVersion 在 project.ts（v2026.06）、knowledge.ts（v1.0）、assessment.ts（v2026.08.27）三处不一致。
- 依据：`demo/v2/src/content/warning.ts:149-352`；`demo/v2/src/content/assessment.ts:214-216、787-843`；`demo/v2/src/content/project.ts:437`（DOC2026001 · v2026.06 登记）；`demo/v2/src/content/knowledge.ts:71`（v1.0）。
- 预设：本域以 assessment.ts 的 PENDING_RISKS 为识别记录事实源（识别域直接下游），资料版本以 project.ts 资料登记为准（v2026.06）；不在本域内消化 warning 域的关联口径。
- 待确认：主代理裁决统一口径并收敛三个域的 fixture；典范追溯链是否只锚定 RISK-2026-001 主线。
- 风险：跨页跳转后同一记录标识呈现不同事件文本，评审时易被误读为数据错误；fixture 收敛前不影响路由与结构。
