# 逐例证据与 RI/RA 双向追踪

合成样本，待甲方复核。72 个语义场景和 23 个业务边界场景均未进行正式软件运行；静态材料检查通过不改变这里的状态。候选预期只在 expected.json，禁止作为模型上下文。

本包提供资料段、工序和机理输入。后续风险记录、评估、预警、处置反馈和重放审计引用须由正式业务产生，当前未取得。

| 用例 | 集合 / 候选资格 | 资料段输入 | 工序 / 机理键 | 计划步骤及判定边界 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SYN-DEV-001 | development / positive | SYN-DEV-SEG-001-LOG、SYN-DEV-SEG-001-GEO、SYN-DEV-SEG-001-LEDGER | 变径空间扩挖 / mechanism-01 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-DEV-002 | development / negative | SYN-DEV-SEG-002-LOG、SYN-DEV-SEG-002-GEO、SYN-DEV-SEG-002-LEDGER | 刀盘扩径 / mechanism-01 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-DEV-003 | development / positive | SYN-DEV-SEG-003-LOG、SYN-DEV-SEG-003-GEO、SYN-DEV-SEG-003-LEDGER | 盾体扩径 / mechanism-02 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-DEV-004 | development / negative | SYN-DEV-SEG-004-LOG、SYN-DEV-SEG-004-GEO、SYN-DEV-SEG-004-LEDGER | 缩径转换 / mechanism-02 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-DEV-005 | development / positive | SYN-DEV-SEG-005-LOG、SYN-DEV-SEG-005-GEO、SYN-DEV-SEG-005-LEDGER | 扩径准备 / mechanism-03 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-DEV-006 | development / negative | SYN-DEV-SEG-006-LOG、SYN-DEV-SEG-006-GEO、SYN-DEV-SEG-006-LEDGER | 刀盘扩径 / mechanism-03 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-DEV-007 | development / positive | SYN-DEV-SEG-007-LOG、SYN-DEV-SEG-007-GEO、SYN-DEV-SEG-007-LEDGER | 刀盘扩径 / mechanism-04 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-DEV-008 | development / negative | SYN-DEV-SEG-008-LOG、SYN-DEV-SEG-008-GEO、SYN-DEV-SEG-008-LEDGER | 盾体扩径 / mechanism-04 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-DEV-009 | development / positive | SYN-DEV-SEG-009-LOG、SYN-DEV-SEG-009-GEO、SYN-DEV-SEG-009-LEDGER | 盾体扩径 / mechanism-05 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-DEV-010 | development / negative | SYN-DEV-SEG-010-LOG、SYN-DEV-SEG-010-GEO、SYN-DEV-SEG-010-LEDGER | 缩径转换 / mechanism-05 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-DEV-011 | development / positive | SYN-DEV-SEG-011-LOG、SYN-DEV-SEG-011-GEO、SYN-DEV-SEG-011-LEDGER | 扩径准备 / mechanism-06 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-DEV-012 | development / negative | SYN-DEV-SEG-012-LOG、SYN-DEV-SEG-012-GEO、SYN-DEV-SEG-012-LEDGER | 盾体扩径 / mechanism-06 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-013 | trial-run / positive | SYN-TRIAL-SEG-013-LOG、SYN-TRIAL-SEG-013-GEO、SYN-TRIAL-SEG-013-LEDGER | 变径空间扩挖 / mechanism-01 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-014 | trial-run / negative | SYN-TRIAL-SEG-014-LOG、SYN-TRIAL-SEG-014-GEO、SYN-TRIAL-SEG-014-LEDGER | 缩径转换 / mechanism-01 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-015 | trial-run / positive | SYN-TRIAL-SEG-015-LOG、SYN-TRIAL-SEG-015-GEO、SYN-TRIAL-SEG-015-LEDGER | 刀盘扩径 / mechanism-01 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-016 | trial-run / negative | SYN-TRIAL-SEG-016-LOG、SYN-TRIAL-SEG-016-GEO、SYN-TRIAL-SEG-016-LEDGER | 变径空间扩挖 / mechanism-01 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-017 | trial-run / positive | SYN-TRIAL-SEG-017-LOG、SYN-TRIAL-SEG-017-GEO、SYN-TRIAL-SEG-017-LEDGER | 缩径转换 / mechanism-01 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-018 | trial-run / negative | SYN-TRIAL-SEG-018-LOG、SYN-TRIAL-SEG-018-GEO、SYN-TRIAL-SEG-018-LEDGER | 刀盘扩径 / mechanism-01 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-019 | trial-run / positive | SYN-TRIAL-SEG-019-LOG、SYN-TRIAL-SEG-019-GEO、SYN-TRIAL-SEG-019-LEDGER | 变径空间扩挖 / mechanism-01 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-020 | trial-run / negative | SYN-TRIAL-SEG-020-LOG、SYN-TRIAL-SEG-020-GEO、SYN-TRIAL-SEG-020-LEDGER | 缩径转换 / mechanism-01 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-021 | trial-run / positive | SYN-TRIAL-SEG-021-LOG、SYN-TRIAL-SEG-021-GEO、SYN-TRIAL-SEG-021-LEDGER | 刀盘扩径 / mechanism-01 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-022 | trial-run / negative | SYN-TRIAL-SEG-022-LOG、SYN-TRIAL-SEG-022-GEO、SYN-TRIAL-SEG-022-LEDGER | 变径空间扩挖 / mechanism-01 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-023 | trial-run / positive | SYN-TRIAL-SEG-023-LOG、SYN-TRIAL-SEG-023-GEO、SYN-TRIAL-SEG-023-LEDGER | 盾体扩径 / mechanism-02 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-024 | trial-run / negative | SYN-TRIAL-SEG-024-LOG、SYN-TRIAL-SEG-024-GEO、SYN-TRIAL-SEG-024-LEDGER | 变径空间扩挖 / mechanism-02 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-025 | trial-run / positive | SYN-TRIAL-SEG-025-LOG、SYN-TRIAL-SEG-025-GEO、SYN-TRIAL-SEG-025-LEDGER | 缩径转换 / mechanism-02 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-026 | trial-run / negative | SYN-TRIAL-SEG-026-LOG、SYN-TRIAL-SEG-026-GEO、SYN-TRIAL-SEG-026-LEDGER | 盾体扩径 / mechanism-02 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-027 | trial-run / positive | SYN-TRIAL-SEG-027-LOG、SYN-TRIAL-SEG-027-GEO、SYN-TRIAL-SEG-027-LEDGER | 变径空间扩挖 / mechanism-02 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-028 | trial-run / negative | SYN-TRIAL-SEG-028-LOG、SYN-TRIAL-SEG-028-GEO、SYN-TRIAL-SEG-028-LEDGER | 缩径转换 / mechanism-02 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-029 | trial-run / positive | SYN-TRIAL-SEG-029-LOG、SYN-TRIAL-SEG-029-GEO、SYN-TRIAL-SEG-029-LEDGER | 盾体扩径 / mechanism-02 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-030 | trial-run / negative | SYN-TRIAL-SEG-030-LOG、SYN-TRIAL-SEG-030-GEO、SYN-TRIAL-SEG-030-LEDGER | 变径空间扩挖 / mechanism-02 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-031 | trial-run / positive | SYN-TRIAL-SEG-031-LOG、SYN-TRIAL-SEG-031-GEO、SYN-TRIAL-SEG-031-LEDGER | 缩径转换 / mechanism-02 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-032 | trial-run / negative | SYN-TRIAL-SEG-032-LOG、SYN-TRIAL-SEG-032-GEO、SYN-TRIAL-SEG-032-LEDGER | 盾体扩径 / mechanism-02 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-033 | trial-run / positive | SYN-TRIAL-SEG-033-LOG、SYN-TRIAL-SEG-033-GEO、SYN-TRIAL-SEG-033-LEDGER | 扩径准备 / mechanism-03 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-034 | trial-run / negative | SYN-TRIAL-SEG-034-LOG、SYN-TRIAL-SEG-034-GEO、SYN-TRIAL-SEG-034-LEDGER | 盾体扩径 / mechanism-03 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-035 | trial-run / positive | SYN-TRIAL-SEG-035-LOG、SYN-TRIAL-SEG-035-GEO、SYN-TRIAL-SEG-035-LEDGER | 刀盘扩径 / mechanism-03 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-036 | trial-run / negative | SYN-TRIAL-SEG-036-LOG、SYN-TRIAL-SEG-036-GEO、SYN-TRIAL-SEG-036-LEDGER | 扩径准备 / mechanism-03 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-037 | trial-run / positive | SYN-TRIAL-SEG-037-LOG、SYN-TRIAL-SEG-037-GEO、SYN-TRIAL-SEG-037-LEDGER | 盾体扩径 / mechanism-03 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-038 | trial-run / negative | SYN-TRIAL-SEG-038-LOG、SYN-TRIAL-SEG-038-GEO、SYN-TRIAL-SEG-038-LEDGER | 刀盘扩径 / mechanism-03 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-039 | trial-run / positive | SYN-TRIAL-SEG-039-LOG、SYN-TRIAL-SEG-039-GEO、SYN-TRIAL-SEG-039-LEDGER | 扩径准备 / mechanism-03 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-040 | trial-run / negative | SYN-TRIAL-SEG-040-LOG、SYN-TRIAL-SEG-040-GEO、SYN-TRIAL-SEG-040-LEDGER | 盾体扩径 / mechanism-03 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-041 | trial-run / positive | SYN-TRIAL-SEG-041-LOG、SYN-TRIAL-SEG-041-GEO、SYN-TRIAL-SEG-041-LEDGER | 刀盘扩径 / mechanism-03 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-042 | trial-run / negative | SYN-TRIAL-SEG-042-LOG、SYN-TRIAL-SEG-042-GEO、SYN-TRIAL-SEG-042-LEDGER | 扩径准备 / mechanism-03 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-043 | trial-run / positive | SYN-TRIAL-SEG-043-LOG、SYN-TRIAL-SEG-043-GEO、SYN-TRIAL-SEG-043-LEDGER | 刀盘扩径 / mechanism-04 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-044 | trial-run / negative | SYN-TRIAL-SEG-044-LOG、SYN-TRIAL-SEG-044-GEO、SYN-TRIAL-SEG-044-LEDGER | 缩径转换 / mechanism-04 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-045 | trial-run / positive | SYN-TRIAL-SEG-045-LOG、SYN-TRIAL-SEG-045-GEO、SYN-TRIAL-SEG-045-LEDGER | 盾体扩径 / mechanism-04 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-046 | trial-run / negative | SYN-TRIAL-SEG-046-LOG、SYN-TRIAL-SEG-046-GEO、SYN-TRIAL-SEG-046-LEDGER | 刀盘扩径 / mechanism-04 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-047 | trial-run / positive | SYN-TRIAL-SEG-047-LOG、SYN-TRIAL-SEG-047-GEO、SYN-TRIAL-SEG-047-LEDGER | 缩径转换 / mechanism-04 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-048 | trial-run / negative | SYN-TRIAL-SEG-048-LOG、SYN-TRIAL-SEG-048-GEO、SYN-TRIAL-SEG-048-LEDGER | 盾体扩径 / mechanism-04 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-049 | trial-run / positive | SYN-TRIAL-SEG-049-LOG、SYN-TRIAL-SEG-049-GEO、SYN-TRIAL-SEG-049-LEDGER | 刀盘扩径 / mechanism-04 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-050 | trial-run / negative | SYN-TRIAL-SEG-050-LOG、SYN-TRIAL-SEG-050-GEO、SYN-TRIAL-SEG-050-LEDGER | 缩径转换 / mechanism-04 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-051 | trial-run / positive | SYN-TRIAL-SEG-051-LOG、SYN-TRIAL-SEG-051-GEO、SYN-TRIAL-SEG-051-LEDGER | 盾体扩径 / mechanism-04 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-052 | trial-run / negative | SYN-TRIAL-SEG-052-LOG、SYN-TRIAL-SEG-052-GEO、SYN-TRIAL-SEG-052-LEDGER | 刀盘扩径 / mechanism-04 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-053 | trial-run / positive | SYN-TRIAL-SEG-053-LOG、SYN-TRIAL-SEG-053-GEO、SYN-TRIAL-SEG-053-LEDGER | 盾体扩径 / mechanism-05 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-054 | trial-run / negative | SYN-TRIAL-SEG-054-LOG、SYN-TRIAL-SEG-054-GEO、SYN-TRIAL-SEG-054-LEDGER | 扩径准备 / mechanism-05 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-055 | trial-run / positive | SYN-TRIAL-SEG-055-LOG、SYN-TRIAL-SEG-055-GEO、SYN-TRIAL-SEG-055-LEDGER | 缩径转换 / mechanism-05 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-056 | trial-run / negative | SYN-TRIAL-SEG-056-LOG、SYN-TRIAL-SEG-056-GEO、SYN-TRIAL-SEG-056-LEDGER | 盾体扩径 / mechanism-05 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-057 | trial-run / positive | SYN-TRIAL-SEG-057-LOG、SYN-TRIAL-SEG-057-GEO、SYN-TRIAL-SEG-057-LEDGER | 扩径准备 / mechanism-05 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-058 | trial-run / negative | SYN-TRIAL-SEG-058-LOG、SYN-TRIAL-SEG-058-GEO、SYN-TRIAL-SEG-058-LEDGER | 缩径转换 / mechanism-05 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-059 | trial-run / positive | SYN-TRIAL-SEG-059-LOG、SYN-TRIAL-SEG-059-GEO、SYN-TRIAL-SEG-059-LEDGER | 盾体扩径 / mechanism-05 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-060 | trial-run / negative | SYN-TRIAL-SEG-060-LOG、SYN-TRIAL-SEG-060-GEO、SYN-TRIAL-SEG-060-LEDGER | 扩径准备 / mechanism-05 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-061 | trial-run / positive | SYN-TRIAL-SEG-061-LOG、SYN-TRIAL-SEG-061-GEO、SYN-TRIAL-SEG-061-LEDGER | 缩径转换 / mechanism-05 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-062 | trial-run / negative | SYN-TRIAL-SEG-062-LOG、SYN-TRIAL-SEG-062-GEO、SYN-TRIAL-SEG-062-LEDGER | 盾体扩径 / mechanism-05 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-063 | trial-run / positive | SYN-TRIAL-SEG-063-LOG、SYN-TRIAL-SEG-063-GEO、SYN-TRIAL-SEG-063-LEDGER | 扩径准备 / mechanism-06 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-064 | trial-run / negative | SYN-TRIAL-SEG-064-LOG、SYN-TRIAL-SEG-064-GEO、SYN-TRIAL-SEG-064-LEDGER | 缩径转换 / mechanism-06 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-065 | trial-run / positive | SYN-TRIAL-SEG-065-LOG、SYN-TRIAL-SEG-065-GEO、SYN-TRIAL-SEG-065-LEDGER | 盾体扩径 / mechanism-06 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-066 | trial-run / negative | SYN-TRIAL-SEG-066-LOG、SYN-TRIAL-SEG-066-GEO、SYN-TRIAL-SEG-066-LEDGER | 扩径准备 / mechanism-06 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-067 | trial-run / positive | SYN-TRIAL-SEG-067-LOG、SYN-TRIAL-SEG-067-GEO、SYN-TRIAL-SEG-067-LEDGER | 缩径转换 / mechanism-06 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-068 | trial-run / negative | SYN-TRIAL-SEG-068-LOG、SYN-TRIAL-SEG-068-GEO、SYN-TRIAL-SEG-068-LEDGER | 盾体扩径 / mechanism-06 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-069 | trial-run / positive | SYN-TRIAL-SEG-069-LOG、SYN-TRIAL-SEG-069-GEO、SYN-TRIAL-SEG-069-LEDGER | 扩径准备 / mechanism-06 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-070 | trial-run / negative | SYN-TRIAL-SEG-070-LOG、SYN-TRIAL-SEG-070-GEO、SYN-TRIAL-SEG-070-LEDGER | 缩径转换 / mechanism-06 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |
| SYN-TRIAL-071 | trial-run / positive | SYN-TRIAL-SEG-071-LOG、SYN-TRIAL-SEG-071-GEO、SYN-TRIAL-SEG-071-LEDGER | 盾体扩径 / mechanism-06 | RI-S1～S6；RA-S1～S6 待真实风险记录；RA-S7 按同机理反馈另测 | 未执行 |
| SYN-TRIAL-072 | trial-run / negative | SYN-TRIAL-SEG-072-LOG、SYN-TRIAL-SEG-072-GEO、SYN-TRIAL-SEG-072-LEDGER | 扩径准备 / mechanism-06 | RI-S1～S6；目标机理零记录需完整终态；RA 对照分值另用外部风险事件测试 | 未执行 |

| 边界用例 | 计划步骤 | 状态 |
| --- | --- | --- |
| SYN-BIZ-MATRIX-01 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-02 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-03 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-04 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-05 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-06 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-07 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-08 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-09 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-10 | RA-S5 | 未执行 |
| SYN-BIZ-MATRIX-11 | RA-S5 | 未执行 |
| SYN-BIZ-PC-01 | RA-S1、RA-S2、RA-S5 | 未执行 |
| SYN-BIZ-UNIT-CONVERSION-IDENTITY | RA-S1、RA-S2 | 未执行 |
| SYN-BIZ-MISSING-INDICATOR-VALUE | RA-S1、RA-S2、RA-S5 | 未执行 |
| SYN-BIZ-APPLICABILITY-FILTER-CONFLICT | RA-S3、RA-S4 | 未执行 |
| SYN-BIZ-MONITORING-METRIC-COVERAGE | RA-S6 | 未执行 |
| SYN-BIZ-MONITORING-SAMPLE-DEDUP | RA-S6 | 未执行 |
| SYN-BIZ-MONITORING-CORRECTION-BATCH | RA-S6 | 未执行 |
| SYN-BIZ-AGENT-TASK-FAILURE-HUMAN-REVIEW | RI-S1、RI-S4、RI-S5、RA-S7（按必经任务分别执行） | 未执行 |
| SYN-BIZ-PERMISSION-DENIED | 全链路权限 | 未执行 |
| SYN-BIZ-HISTORICAL-REPLAY | RI-S6、RA-S1～S7 | 未执行 |
| SYN-BIZ-CALIBRATION-ROLLBACK | RA-S7 | 未执行 |
| SYN-BIZ-RISK-RECORD-DEDUP | RI-S6 | 未执行 |

## 步骤 → 用例和正式证据

| 步骤 | 对应用例 / 材料 | 正式业务所需证据 | 当前状态 |
| --- | --- | --- | --- |
| RI-S1、RI-S2 | 全部72例、34文件 | 原始工件、转换/清洗、资料段；Agent增量和校验、部分可用与失败终态 | 未执行 |
| RI-S3、RI-S4 | 5工序、6机理、72例工序/机理键 | 发布版本、适用关系、原始证据引用 | 未执行 |
| RI-S5 | 36正例、36目标机理负例 | 向量/BM25检索、受限补搜、候选校验；完整零结果收口 | 未执行 |
| RI-S6 | 全部72例及风险记录合并用例 | 人工复核、规范化风险记录或零结果终态、入库和审计 | 未执行 |
| RA-S1、RA-S2 | 正例链路及独立外部事件对照、映射/缺指标用例 | 实際指标值、单位、映射、适用性快照及规则版本 | 未执行 |
| RA-S3、RA-S4 | 标准库、评分规则、适用性用例 | 规则来源、一致性冲突和筛除原因、人工发布 | 未执行 |
| RA-S5 | P/C手算和11矩阵边界行、正例评分 | 指标分值、权重、P/C、矩阵分段/版本、越界拒绝 | 未执行 |
| RA-S6 | 六监测、三特征/联合/去重/修正用例 | 监测窗口、触发依据、阈值版本、预警和修正证据 | 未执行 |
| RA-S7 | 六反馈、Agent失败、校准回滚 | 处置三项校验、人工采纳执行、反馈偏差、校准批准与回滚 | 未执行 |
| 横切 | 授权不足、历史重放 | 权限校验、审计、完整输入快照和第三方重放 | 未执行 |

接口路径和阻塞见 [运行前置](run-prerequisites.md) 与 [开发缺口](development-gaps.md)。实际运行后在独立目录填写每行安全回执、差异与状态，保留本表作为初始记录。
