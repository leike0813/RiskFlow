# 缺口台账（GAP LEDGER）

> 单一维护点：`src/review/gap-ledger.data.json`。本文件与 `docs/gaps/` 由
> `node tools/build-gap-docs.mjs` 生成，禁止手工编辑；`npm run check` 校验同步。

共 54 条。每条五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。

| ID | 类别 | 缺口 | 相关页面 |
|---|---|---|---|
| [GAP-001](gaps/GAP-001.md) | G1 外壳契约 | C10 五类骨架缺 15 处结构 slot | 全局 |
| [GAP-002](gaps/GAP-002.md) | G1 外壳契约 | 复合骨架 A+C / A+B 无法由单值枚举表达 | P-PJ-08、P-RV-05、P-OP-02 |
| [GAP-003](gaps/GAP-003.md) | G1 外壳契约 | Agent 专用骨架无枚举值 | P-AG-01、P-AG-02 |
| [GAP-004](gaps/GAP-004.md) | G1 外壳契约 | 主从复合页 / KPI 横条网格 / 图谱画布三种形态无骨架承载 | P-OV-01、P-PJ-08、P-RI-07、P-RA-06 |
| [GAP-005](gaps/GAP-005.md) | G4 归属待定 | P-OV-01 风险态势总览归属 C34/C35 待定 | P-OV-01 |
| [GAP-006](gaps/GAP-006.md) | G4 归属待定 | P-RV-01 待复核队列 / P-RV-02 复核详情归属待定 | P-RV-01、P-RV-02 |
| [GAP-007](gaps/GAP-007.md) | G4 归属待定 | P-AU-01 报告导出归属 C34/C35 待定 | P-AU-01 |
| [GAP-008](gaps/GAP-008.md) | G5 依赖决策 | 图表库选型属 C34 dependency checkpoint，v2 不预设库 | 全局 |
| [GAP-009](gaps/GAP-009.md) | G5 依赖决策 | 路由库是否需要 | 全局 |
| [GAP-010](gaps/GAP-010.md) | G5 依赖决策 | Electron 路由模式预设 | 全局 |
| [GAP-011](gaps/GAP-011.md) | G6 规格空白 | 可访问性无规格依据，只能对齐生产 C10 实现 | 全局 |
| [GAP-012](gaps/GAP-012.md) | G2 契约字段 | 部分页面的 branch / 能力位标注为常识贴近，待逐页核对 | P-PJ-02、P-PJ-03、P-PJ-04、P-AG-01、P-AG-02 |
| [GAP-013](gaps/GAP-013.md) | G3 未建能力 | 三个 .read 能力位无 branch 授予通路，导航可达性与导航所需能力不一致 | 全局 |
| [GAP-014](gaps/GAP-014.md) | G2 契约字段 | 资料段标识的三段式正则与「资料ID-章节ID-段ID」可读形态冲突 | P-PJ-05、P-PJ-07 |
| [GAP-015](gaps/GAP-015.md) | G2 契约字段 | 项目管理四动作在 29 个能力位中无专属位 | P-PJ-03、P-PJ-04 |
| [GAP-016](gaps/GAP-016.md) | G3 未建能力 | 接入任务运行阶段无契约阶段词汇 | P-PJ-08 |
| [GAP-017](gaps/GAP-017.md) | G2 契约字段 | P-PJ-03 的 branch 标注与页面语义不符 | P-PJ-03 |
| [GAP-018](gaps/GAP-018.md) | G2 契约字段 | 规范标准库/案例库/措施库的 branch 是运行期检索语义而非治理读 | P-KM-03、P-KM-04、P-KM-08 |
| [GAP-019](gaps/GAP-019.md) | G2 契约字段 | 量化标准无 KnowledgeDefinitionType 枚举值 | P-KM-05 |
| [GAP-020](gaps/GAP-020.md) | G6 规格空白 | 治理生命周期状态词汇无契约枚举 | P-KM-01、P-KM-02、P-KM-03、P-KM-04、P-KM-05、P-KM-06、P-KM-07、P-KM-08 |
| [GAP-021](gaps/GAP-021.md) | G2 契约字段 | 风险矩阵版本化定义（刻度/等级/cellLevels/acceptable）无 Schema | P-KM-07、P-RA-06 |
| [GAP-022](gaps/GAP-022.md) | G2 契约字段 | 评估记录入口类别与 contracts kind 字段语义冲突 | P-RA-04、P-RA-05、P-RA-07 |
| [GAP-023](gaps/GAP-023.md) | G2 契约字段 | 逐指标 P/C 归属无契约字段 | P-RA-05、P-KM-05 |
| [GAP-024](gaps/GAP-024.md) | G2 契约字段 | 数值得分到矩阵刻度落点的分带规则无契约载体 | P-RA-06 |
| [GAP-025](gaps/GAP-025.md) | G2 契约字段 | PAGE-GUIDE §3 曾把 triggerType 写成数组语义（文档漂移，已修正） | P-WR-02 |
| [GAP-026](gaps/GAP-026.md) | G2 契约字段 | 触发指标无阈值快照与越限方向字段 | P-WR-02 |
| [GAP-027](gaps/GAP-027.md) | G6 规格空白 | 预警处置任务无记录 schema 与状态机枚举 | P-WR-03、P-WR-04 |
| [GAP-028](gaps/GAP-028.md) | G2 契约字段 | 通知意图（notification-intent）无渠道/接收角色/投递状态字段 | P-WR-02 |
| [GAP-029](gaps/GAP-029.md) | G2 契约字段 | 关系三元组字段命名：PAGE-GUIDE 与 contracts 不一致（文档漂移，已修正） | P-RI-06 |
| [GAP-030](gaps/GAP-030.md) | G2 契约字段 | 标准化风险记录封套无 evidenceReferences 字段 | P-RI-05、P-RI-06 |
| [GAP-031](gaps/GAP-031.md) | G2 契约字段 | RISK-2026-003/004 的机理条目归属与事件语义不匹配 | P-RI-05、P-RI-06、P-RI-07 |
| [GAP-032](gaps/GAP-032.md) | G2 契约字段 | 跨域 fixture 漂移：RISK-2026-002～004 事件文本与 DOC2026001 版本号（已收敛） | P-RI-05、P-RI-06、P-WR-01、P-WR-02、P-RA-01、P-PJ-05、P-PJ-07 |
| [GAP-033](gaps/GAP-033.md) | G6 规格空白 | 处置效果预测（effect-forecast）无记录 Schema | P-RS-03 |
| [GAP-034](gaps/GAP-034.md) | G6 规格空白 | 执行记录与反馈记录无契约记录 Schema | P-RS-02、P-RS-04 |
| [GAP-035](gaps/GAP-035.md) | G6 规格空白 | 校准建议（calibration-suggestion）无记录 Schema | P-RS-05 |
| [GAP-036](gaps/GAP-036.md) | G2 契约字段 | 处置建议 implementationOrder 无排序依据字段 | P-RS-01 |
| [GAP-037](gaps/GAP-037.md) | G2 契约字段 | 预警域与处置域 fixture 叙事漂移：WRT-2026-001 采纳后状态（已收敛） | P-WR-04、P-RS-01、P-RS-02、P-RS-04 |
| [GAP-038](gaps/GAP-038.md) | G6 规格空白 | 批量确认无契约批量决定命令 | P-RV-01 |
| [GAP-039](gaps/GAP-039.md) | G2 契约字段 | 业务审计条目的活动码词汇无契约枚举 | P-RV-06 |
| [GAP-040](gaps/GAP-040.md) | G2 契约字段 | 跨类型运行列表无投影查询载体 | P-RV-05 |
| [GAP-041](gaps/GAP-041.md) | G2 契约字段 | 系统管理六动作无能力位映射，动作级门控缺身份信号 | P-OP-01 |
| [GAP-042](gaps/GAP-042.md) | G6 规格空白 | 数据源适配器与连接定义无契约记录与命令 | P-OP-02 |
| [GAP-043](gaps/GAP-043.md) | G6 规格空白 | 模型部署与提示模板版本登记无契约 schema | P-OP-03 |
| [GAP-044](gaps/GAP-044.md) | G6 规格空白 | 备份策略、恢复点与恢复操作无契约 schema 与命令 | P-OP-04 |
| [GAP-045](gaps/GAP-045.md) | G6 规格空白 | Agent 任务的工具行动（含白名单外拦截）无记录 Schema | P-AG-03 |
| [GAP-046](gaps/GAP-046.md) | G6 规格空白 | Agent 增量逐项确定性校验决定无记录 Schema | P-AG-03 |
| [GAP-047](gaps/GAP-047.md) | G6 规格空白 | Agent 任务资源消耗计数与硬预算对比无契约字段 | P-AG-01、P-AG-02、P-AG-03 |
| [GAP-048](gaps/GAP-048.md) | G2 契约字段 | 校准建议 Agent 任务标识跨域漂移（已收敛） | P-AG-03、P-RS-05 |
| [GAP-049](gaps/GAP-049.md) | G6 规格空白 | 交互 Agent 会话消息流无契约 Schema | P-AG-01、P-AG-02 |
| [GAP-050](gaps/GAP-050.md) | G6 规格空白 | risk-overview 投影内容形状未入契约 | P-OV-01 |
| [GAP-051](gaps/GAP-051.md) | G6 规格空白 | 总览趋势序列选取规则未规格化 | P-OV-01 |
| [GAP-052](gaps/GAP-052.md) | G2 契约字段 | ProjectionExportRequestV1 无报告范围字段 | P-AU-01 |
| [GAP-053](gaps/GAP-053.md) | G2 契约字段 | 导出产物描述与导出历史状态机无契约 schema | P-AU-01 |
| [GAP-054](gaps/GAP-054.md) | G6 规格空白 | 报告「审计摘要」章节收录范围未规格化 | P-AU-01 |
