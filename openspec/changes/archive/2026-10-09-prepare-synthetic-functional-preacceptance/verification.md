# Verification

## 验收对象

- Change：prepare-synthetic-functional-preacceptance（orchestrated-delivery）。
- 输入实现 HEAD / 最终验收 HEAD：6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a。
- 验收 Agent：主会话 Codex，负责范围内核验、修正、报告及最终接受。
- 本次用户未授权 Git 提交；HEAD 保持不变。固定实现检查点使用工作区文件和实际运行摘要，保留现有 C37 dirty 内容。最终包输入摘要 `1cb555bb227aa118527986a4b254bb90aec3f0cf471c2e187e8c29680020d1b3`，工具/相关构建摘要 `18fa02c127260c5a193574a7e6dd965a315b0ad58918dabed96ebf53af9af685`，记录在 final-environment-check-2026-10-09/run.json。

## 结论

**PASS**：边界为已批准的合成材料、生成/检查/正式 HTTP 驱动工具及真实阻塞报告交付。3/3 任务、3 个 Requirement / 6 个 Scenario 已核验。没有业务源代码、公共契约、数据库迁移、依赖或正式质量发布变化。

正式业务运行记录的状态是 BLOCKED：没有目标服务、账号和真实工程/工件绑定，10 个操作均 pending，72 个语义场景和 23 个业务边界场景未执行。该状态是设计明确要求保存的外部前置结果，不构成软件功能预验收通过或甲方验收结论。语义匹配、等级匹配、重放率等无正式分母，报告保持不可计算。

## 核验与修复证据

| Requirement / Scenario / IP-ID | 证据或命令 | 结果 |
| --- | --- | --- |
| 合成材料 / 完整模拟包 / IP-01 | generate-materials.py --check（uv共享锁定环境）；manifest/scenarios/expected/configurations/rules/knowledge/monitoring/feedback | 通过；12开发+60试运行、34文件、六机理/五工序/六监测、11配置/1规则/4知识、12序列/12批次/132样本/6反馈；全部公共Schema通过 |
| 合成材料 / 来源与集合不合格 / IP-01、02 | sources.json；source-audit.md；synthetic.test.mjs；checkPack | 来源定位/适用边界、文件引用、集合隔离、候选泄漏及跨配置一致性拒绝检查通过。8注入表为登记，未宣称完整表已自动执行 |
| 正式入口 / 真实操作结果形成引用 / IP-02 | synthetic.mjs 的 catalog/requestSchema/resultSchema、resolveTemplates、collectCaptures；26项Vitest；6示例载荷Schema核对 | 通过工具行为检查；回执只保存契约引用，未知路由拒绝；HTTP替身不计业务证据。现无真实服务，实际业务引用尚未取得 |
| 正式入口 / 等待人工或环境缺失 / IP-02、03 | 实际 pnpm acceptance:synthetic run + example config → reports/final-environment-check-2026-10-09 | 退出1、BLOCKED、10pending，保存安全run.json/report.md；幂等键/issuedAt恢复、异步仅submitted及旧结果不覆盖由测试验证 |
| 试运行结论 / 候选标签比较 / IP-03 | expected.json 的candidate；internal-preacceptance-report.md；case-traceability.md | 候选标签与模型输入隔离；无可核验正式业务结果时比较不可计算，不反填预期、不发布C36质量结论 |
| 试运行结论 / 未运行或证据不足 / IP-03 | 逐例RI/RA追踪、运行前置与development-gaps | 全部业务用例保持未执行；C36快照/重放上下文、装配及正式上传前置如实登记 |
| 静态检查 | pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1 | 退出0、ok=true、problems=[] |
| 工具测试 | pnpm exec vitest run scripts/acceptance/synthetic.test.mjs | 26项通过；当前最终工具检查点 |
| 代码风格 | pnpm exec eslint scripts/acceptance/*.mjs；pnpm exec prettier --check scripts/acceptance/*.mjs package.json | 通过；references/OpenSpec/Markdown被仓库ignore排除，未宣称由格式器覆盖 |
| OpenSpec | openspec validate prepare-synthetic-functional-preacceptance --strict --no-interactive | 通过；主spec同步后另运行specs验证 |
| 同步后的主规格 | openspec validate quality/synthetic-functional-preacceptance --type spec --strict --no-interactive；openspec validate --specs --no-interactive | 本次主spec严格检查通过；全库普通检查40通过、0失败 |

核验修正：材料家族/正文重复、正例工序适用不匹配、监测单位和负例预警矛盾、PDF截断及扫描件压缩；工具的同键重试时间漂移、旧输出覆盖、回执丢失、响应无界读取、会话资格、业务失败和异步提交状态。最小相关检查已回归。报告中“已有服务未核实”与“服务不存在”的过度断言已校正。

## 限定审计

无独立限定审计任务。本次不属于受控39-change编排任务，不修改调度状态；没有触发其限定审计条件。主会话完成输入可信边界、凭据持久化、Schema复用、幂等恢复和状态语义检查，无待执行的范围内审计。

## 后续注意事项

真实业务功能验证须提供正式环境与当前授权绑定；工件上传/工程空间/文档转换HTTP前置及质量重放证据见development-gaps。补充绑定后创建新运行，人工批准/发布/采纳/校准须通过正式工作台。甲方输入和标签审核到位后建立新包版本。

未启动服务器，未作真实LLM/OCR、部署性能或整个C37工作区的构建回归。CLI消费已有构建产物，源码更新后须按项目流程构建再运行。已保留dirty状态，没有Git提交。

额外全库严格检查 `openspec validate --specs --strict --no-interactive` 为29通过、11失败，原因均为其它既有规格的Requirement超过500字符的WARNING在strict模式升级为失败。本次新主spec无该问题；没有改写这些范围外规格。主spec同步采用现有CLI规则快照，仅添加本capability的三个Requirement与六个Scenario，保留其它主spec。
