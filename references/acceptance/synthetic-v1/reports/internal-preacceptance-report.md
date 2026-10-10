# RiskFlow 模拟材料内部预验收报告

日期：2026-10-09。材料包：riskflow-synthetic-v1@1。标识：**合成样本，待甲方复核**；标签资格：candidate。

本次完成了模拟材料包和运行工具的交付验证。正式软件业务试运行处于**阻塞**状态：没有目标服务、测试账号和实际工程/工件引用，因此没有发送业务请求。此报告不能作为甲方验收通过、工程安全判断或系统整体技术就绪证明。

## 已交付材料

虚构工程为“合成·岚江站站隧一体化工程”。开发集 12 例、试运行集 60 例，六类机理分别一正一负和五正五负，工序按机理适用节点轮换，合计覆盖五工序、六监测与三项适用性维度。两个集合使用不同工点、日期、参数和叙述模板；候选事件、机理归类和评分与模型输入分开保存。

包内有 34 个 DOCX、文本 PDF、扫描 PDF、XLSX、CSV、PNG、JPEG、Markdown 文件；其中 JPEG 是合成现场记录示意卡。另含 11 类评估配置、1 份评分规则、4 类知识包、12 条监测序列修订、12 批次、132 个样本和 6 条反馈输入，均通过现有公共 Schema。所有引用仍是本地合成键，正式导入时必须绑定真实回执。

8 条材料异常注入和 23 条业务边界用例已登记。矩阵覆盖全部六格及内部/末端边界，含 P=5 的末带上界闭合与 P=5.001 的越界拒绝。业务边界用例保持未执行；工具单测中的非法副本用于检查拒绝行为，不能代替这些用例的正式业务执行。

## 实际验证

| 验证对象 | 执行命令或证据 | 结果与边界 |
| --- | --- | --- |
| 材料文件读回、覆盖与隔离 | uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.py --check | 通过；72例、34文件、11配置、8来源、132样本、6反馈；内层生产Schema检查通过 |
| 静态材料检查 | pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1 | 通过；ok=true、problems=[] |
| 工具行为 | pnpm exec vitest run scripts/acceptance/synthetic.test.mjs | 26项通过；含引用绑定、业务失败、提交边界、凭据隔离、人工前置、同键恢复及非法材料拒绝；HTTP替身仅检验工具 |
| 工具 lint | pnpm exec eslint scripts/acceptance/synthetic.mjs scripts/acceptance/synthetic.test.mjs | 通过 |
| 格式 | pnpm exec prettier --check scripts/acceptance/*.mjs package.json | 通过；项目 .prettierignore 排除 references、openspec 与 Markdown，因此没有将其记作格式器检查通过；材料 JSON 由 Schema 检查，中文文稿另作复核 |
| 运行计划 | 6个示例HTTP操作由真实catalog查得；本地替换模板后逐个以requestSchema检查 | 通过；这是请求结构检查，没有向服务发送模拟回执 |
| 图像与PDF抽查 | 目视监测断面PNG及扫描PDF；文本PDF读回条款末尾 | 通过；文字可读，合成标记与适用边界完整；没有验证真实OCR服务 |
| 实际运行工具调用 | pnpm acceptance:synthetic run --pack references/acceptance/synthetic-v1 --config references/acceptance/synthetic-v1/run-config.example.json --output references/acceptance/synthetic-v1/reports/final-environment-check-2026-10-09 | 阻塞；退出1；10步骤均pending；缺服务URL、工程ID、登录名和密码 |

最后一次运行 ID 为 `synthetic-851e7fb58ac5b6fb032d54cd`。原始安全记录见 [run.json](final-environment-check-2026-10-09/run.json)，自动报告见 [report.md](final-environment-check-2026-10-09/report.md)。记录固定源码 HEAD、dirty 路径、包/构建/配置摘要，没有密码、Cookie或完整响应。更早的 environment-check 目录保留为工具修正期间的检查记录，当前结论使用 final-environment-check。

## 软件业务结果

| 范围 | 计划数 | 正式执行数 | 通过数 | 当前状态 |
| --- | --- | --- | --- | --- |
| 开发集语义场景 | 12 | 0 | 0 | 未执行 |
| 试运行集语义场景 | 60 | 0 | 0 | 未执行 |
| 业务边界与链路用例 | 23 | 0 | 0 | 未执行 |
| RI-S1～RI-S6、RA-S1～RA-S7全链路 | 13步骤 | 0 | 0 | 阻塞：正式环境与证据未取得 |

识别匹配、评分等级匹配、预警匹配、重放率及审计完整性均**不可计算**，正式已验证分母为零。未执行用例没有从计划量中删除。候选标签尚未复核，本次没有向 C36 质量索引发布报告。逐例输入与专利步骤对照见 [双向追踪](case-traceability.md)。

## 核验中的修正与后续

修正了资料家族正文重复、工序/机理适用关系不匹配、跨指标非物理折算、负例含预警触发、PDF正文截断和扫描件体量问题。工具修正了旧输出覆盖、结果引用丢失、恢复时 issuedAt 改变、无界响应读取，以及异步回执被认作完成等问题。上述结果通过最终检查核实。

已存在识别、评估、预警和读取服务；本次未证明干净输入的完整装配和正式重放证据。工件上传、工程空间修订及转换的 HTTP 前置，以及 C36 快照/重放上下文的生产证据，记录在 [开发缺口](development-gaps.md)。获取环境后按 [运行前置](run-prerequisites.md) 准备真实绑定；填入引用会改变配置，应使用新输出目录。人工批准、发布、采纳和校准仍由正式工作台完成。

本次未启动服务器、未执行部署/性能/真实模型推理验收，未重跑整个 C37 工作区的构建与回归。源码 HEAD 保持 `6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a`，用户已有未提交改动保留，没有 Git 提交。

本次 OpenSpec change 与新主规格的严格检查通过；全库普通规格检查40通过。额外全库严格检查因其它11份既有规格的长Requirement警告退出1，本次没有扩大范围改写这些规格。
