# 实机读取与 DOCX 续接证据（2026-10-14）

状态：D-32/D-33 已按授权完成，资料目录及 Agent 页面通过物理 Chrome 复验，16 份治理来源转换成功。治理清洗在工具失败后反复领取，Worker 已停止，完整功能验收 BLOCKED。tasks 仍 1/14，仅 2.1 完成；没有提交、归档或 verification。

## 修复与工程验证

- AgentTaskProvider 清空快照时同步当前代际；保留单在途、取消和迟到响应丢弃。浏览器用例先验证真实任务显示，再验证慢读和切工程取消。
- C32 经 C06 当前复验后，以稳定 grant 身份关联 C11 精确资料，校验行身份和一对一关联。清洗摘要按 engineering-data.data-cleaning-result 完整消费并 await verified，限返回页及 4MiB。Web 仅对当前页至多 50 个精确资料声明资格，第二次读取只补清洗状态，保留第一次总数及游标。
- DOCX 文本边界只还原 XML 预定义和合法数字字符引用；通过既有库保留 CDATA 身份并按字面读取。DOCTYPE/ENTITY 拒绝、包与文本预算、源正文一致性及质量门槛保留，不增加依赖。
- C32 真实数据库/C06/C11/C04及正式清洗夹具：12/12 通过，覆盖成功、缺父资料资格、工件拒绝/缺失/完整性失败、行身份不匹配和撤权。日志 catalog-read-regression-v4.log。
- DOCX/MinerU 回归 41/41 通过，日志 docx-final-regression.log。辅助 Agent 另执行共享工程数据回归：174 通过、1 跳过；跳过不计作成功。
- Agent/审计/运维浏览器 12/12 通过，日志 agent-visible-browser-regression-v3.log。旧 Web 构建的首轮 11 通过/1 失败保留；重建后单项和整文件复验通过。
- NODE_OPTIONS=--max-old-space-size=8192 pnpm build、相关 ESLint/Prettier、change strict 和 diff 检查通过。最终构建日志 read-docx-final-build.log。默认 4GiB 类型构建 OOM、写入期间构建失败及前三轮夹具/测试错误保留，不作为业务预算变更或通过证据。

## 运行与物理窗口

实例根 /home/joshua/.local/state/riskflow/acceptance/run-20261014-physical，仅属主访问。最终工作区发布 functional-workspace-20261014-read-docx-final-v5，configRef physical-20261014-read-docx-final-v5；运行包 3173522 字节、SHA256 5d050ff4a6dc80637d7f5c5956d4aaf14929176ecb06f12a5281af319638248e。codeCommit 是实际 HEAD 31ad1a2c47a377f20179e0008241034c14a3bec5，实现仍为 dirty 工作区，准备时的 diff 摘要另存 identity；不是提交检查点或 C38 完整离线介质。

API 使用 deployment-read-docx-final-v5.json / release-read-docx-final-v5.json，独立 HTTPS 为 https://localhost:19443/，私有 CA 真实验证。系统 Caddy 仍关闭。Worker 在 v4 治理清洗故障后停止，数据库、索引、原卷和失败工件保留。

原 DISPLAY=:0 的物理 Chrome 复验：5 个 DEV 资料均显示清洗可用；任务列表含正式 data-cleaning-task-50efff5a…@1 的已完成状态。随后自然点击该行进入其精确详情，核对预算台账，截图 chrome-agent-cleaning-completed-detail-v5.png；早期工作台截图默认选中旧失败任务，不作为该成功任务预算的证据。当前页第二次声明 22 个精确资料引用，没有全库游标。其它证据为 physical-read-v{4,5}-*.json、chrome-documents-cleaned-v{4,5}.png、chrome-agent-cleaning-completed-v{4,5}.png。临时脚本的错误路由、错误状态定位超时不作为产品失败或通过；纠正定位后正式复验成功。

## 治理来源与当前阻塞

成功任务详情的预算台账已自然滚动到物理窗口并另存 chrome-agent-cleaning-budget-v5.png，沿同一精确任务URL取证。

16 份合成 DOCX 复制合成知识/配置事实，待甲方复核。原工序资料漏 5 条 dependencyEdges，已生成独立 process-model-v2.docx 补齐，原登记与失败保留；新 manifest 合计 62 个资料项，不读取 expected/scenarios/relevance 或研究原件。

16 个正式 C04/C11 来源及官网转换均成功。风险机理沿原来源以新转换 physical-governance-convert-risk-mechanism-docx-fixed-v2-convert@1 成功，旧失败不改。只读证据 governance-sources/verified-conversions-*.json 含 16 个转换、JSON-LD、段集和审计引用；129 个原响应/诊断/JSON-LD 工件完整消费并 verified，两项质量均 1，无缺失关键字段。官网实际 producer 为 MinerU 3.4.4，不计作 4.0.12 离线或 C38 硬件通过。

清洗策略追加为 physical-cleaning-policy@physical-20261014-v3，纳入新 16 份精确质量引用，原五格式质量引用保留。模型、工具、候选和预算未变，v5 策略正文与 v4 相同。旧风险机理登记重放的 AccessServiceError 保留；接续使用原登记和新成功转换回执完成剩余 14 份，不覆盖失败 checkpoint。

新命令 physical-governance-documents-cleaning-20261014-v4 创建任务 data-cleaning-task-8f153fbb8f2c132fe5f1af0ed57658f345b4c368@1：模型 1、工具 1、输入 1521/输出 300 token、活动墙钟 5303ms；没有候选及清洗结果，不能冻结准备或发布治理定义。

C04 verified 意图证明 action2 把清单工件误作 source-version，请求不存在的 manifest-preparation-slice，不属于冻结集合。工具正确拒绝后 Worker 反复领取；安全快照记录 644 次 attempt，预算没有推进、任务仍 running。14:12 停止该 Worker，未改任务、预算或数据库。当前恢复读被 C06 拒绝不能替代最初空转路径的隔离复现。

D-34已获授权并完成定向验证，后续三次实际结果与新累计预算阻塞见[清洗上下文/恢复证据](cleaning-context-and-recovery-2026-10-14.md)。本文件上述v5/644次领取状态为该阶段留证，不作为最新运行状态。Electron、RI/RA 完整终态、五类 Agent、恢复和正式 functional 报告尚未完成，全部保持未通过。
