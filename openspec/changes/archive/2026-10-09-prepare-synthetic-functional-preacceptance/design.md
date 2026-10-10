## Context

基线6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a，C37工作区未提交。C36质量CLI只消费既有正式结果；现有浏览器/worker验收带替身，未证明干净输入的完整识别评估闭环。sample-snapshot/replay-context生产证据缺口保留为阻塞。

## Goals / Non-Goals

**Goals:** 可编辑材料包、可复现生成、静态契约检查、正式入口驱动、真实状态/中文报告与开发缺口。
**Non-Goals:** 修改领域规则/API、SQL播种、接管C37、正式质量发布、部署性能验收、Git提交。

## Decisions

### D-01 单一材料包与候选预期

目录 references/acceptance/synthetic-v1。manifest.json固定schemaVersion='1', packId, packVersion, label='合成样本，待甲方复核', labelStatus='candidate', project, sources, documents, configurations, rules, cases, acceptanceCases。引用使用相对文件路径和稳定本地键，导入前不冒充真实工件引用。scenario文件包含输入和过程描述；expected.json独立保存候选预期。scenarios.json是内容唯一事实源，生成DOCX/PDF/扫描/XLSX/CSV与Markdown投影；不将答案投喂被测模型。

### D-02 覆盖与来源

开发12例、试运行60例，六机理各开发一正一负、试运行五正五负；轮换覆盖五工序、三适用维度、六监测。额外异常和边界验收用例用表格驱动，不伪装成语义负例。两个集合独立虚构工程资料家族，研究参照来源仅登记不进入语义评测上下文。同一测试配置可共用，运行需要真实工程/空间/来源权限绑定。公开规范、机理和类比案例提供有ID/条款的独立短摘录；不复制整库。STD-001矩阵解析不确定格仅记录，运行采用明确合成3×2矩阵。

### D-03 复用契约和独立候选计算

11类配置引用 AssessmentConfigurationDocumentV1Schema，评分规则引用 StructuredScoringRuleDocumentV1Schema。初始数值参考既有C18/C25夹具，但单一有效字段映射取消同指标双来源，单位保持物理语义；P按4000/6000基点weighted-average两位half-away-from-zero，C用maximum，沿用既有3×2矩阵。候选评分按显式模拟量化区间手工算式编制，不调用被测评估函数生成答案。阈值全部模拟且表明单位/边界。monitoring原始输入按真实序列/批次公共schema，文件CSV作为有界投影。工序、机理等契约引用core公开schema，Schema不加合成说明字段，说明保存manifest侧。

### D-04 CLI与正式操作计划

scripts/acceptance/synthetic.mjs导出checkPack/runPack/main，根脚本acceptance:synthetic。check --pack；run --pack --config --output。本地配置包括baseUrl、loginName、password、bindings及显式commands操作计划；凭据不输出。操作计划按生产HTTP注册表限定operationId，载荷按原schema校验，使用{$binding:key}、{$file:relativePath}、{$result:stepId,path:[...]}替换真实输入/返回引用；这些是本地工具模板，不改变wire契约。run-plan.example.json提供导入与业务流程的已核对示例，接口未暴露的前置操作明确人工完成，不发送猜测路由。

只使用HTTPS（本机测试允许loopback HTTP）；fetch有限超时、响应大小上界、禁止redirect；登录Cookie在内存不写盘。命令幂等键由run身份+step身份固定；输出run.json、report.md，checkpoint只保存安全状态、digest和引用，不保存密码/响应正文。审批步骤显式manual，缺绑定时阻塞；继续时读取状态且检查pack/config（去秘密）及目标一致，服务端同键重试。输出已有文件时仅恢复同一运行，不覆盖别的结果。实际返回kind='failed'属于失败，HTTP200不自动通过；异步回执仅为提交，不代表业务完成，后续须精确query/人工核验。

### D-05 报告与接口缺口

当前候选标签不得写入C36正式质量索引；本地内部报告给静态检查、正式操作状态与RI/RA测试状态，所有未执行用例保持未执行。探索性语义比较须同时提供当前授权精确结果读及完整零结果证明；没有可读接缝时不可计算，不扩展production API。保存源码HEAD及dirty路径、包版本与运行计划摘要。已知装配、重放工件与版本解析缺口形成待开发表，不在本任务悄悄修production。

### D-06 文件、依赖与验证

新增 scripts/acceptance/{synthetic.mjs,synthetic.test.mjs,generate-materials.py}；新增材料包内JSON/Markdown/二进制工件；仅改根package.json单一script。不安装依赖，生成用uv共享环境fitz/docx/openpyxl/PIL和内置中文字体，不引入字体下载。测试静态非法/隔离、真实回执绑定、失败关闭与幂等恢复，替身只验证工具行为，不算软件验收。执行pnpm脚本check、最小Vitest、生成物读回自检、局部Prettier/ESLint、OpenSpec strict。真实服务不可用时run保存BLOCKED报告；不启动开发服务器。

## Risks / Trade-offs

60例为功能覆盖不是工程分布统计。候选标签未人工审核；配置为模拟。现有生产宿主未准备好会阻塞闭环，工具不能替代接缝实现。来源已知漂移只在本包记录，不改原资料库。

## Migration Plan

无迁移。先检查/导入独立测试工程，正式资料到位创建新包版本和新运行。用户未提交文件保留；无提交或切分支。

## Open Questions

无实施决策待定。甲方规则、领域复核和目标环境为报告中的外部前置。
