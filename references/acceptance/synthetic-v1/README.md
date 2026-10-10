# RiskFlow 合成材料包 synthetic-v1

本目录是一套可重复生成、可导入的同形合成工程材料，用于功能开发与内部功能预验收。

- 标记：**合成样本，待甲方复核**（manifest.json 中 labelStatus = candidate）。
- 工程：合成·岚江站站隧一体化工程（synthetic-station-tunnel-project），全部编号、工点、
  量测值与阈值均为虚构，不对应任何真实工程、真实监测数据或甲方既有项目。
- 用例内容事实源：scenarios.json。documents/ 下的资料都是它的投影。
  配置与规则另有事实源（configurations/、rules/、knowledge/），按生产 Schema 独立成立，
  不由 scenarios.json 派生。

## 目录结构

| 文件 | 作用 |
|---|---|
| manifest.json | 材料包清单：版本、标记、文件指针、资料与配置索引 |
| scenarios.json | 72 个用例的输入描述（开发 12 + 试运行 60），不含任何答案字段 |
| expected.json | 候选预期，独立文件，候选标签未经人工复核 |
| sources.json | 来源登记：只写已有 Artifact 的标识、定位与短摘录 |
| acceptance-cases.json | 静态包异常用例（8 条，登记 mutation 与预期失败码）与业务/边界验收候选表（23 条），均标记未执行 |
| monitoring.json | 监测序列修订、样本、样本工件与批次（生产公共 Schema） |
| feedback.json | 处置反馈冻结输入行（生产公共 Schema） |
| configurations/ | 11 类评估配置，逐个通过 AssessmentConfigurationDocumentV1Schema |
| rules/ | 结构化评分规则，通过 StructuredScoringRuleDocumentV1Schema |
| knowledge/ | 工序模型、风险机理库、标准库、案例库，通过 core 知识包 Schema |
| documents/ | 七种文件形态与 Markdown 综合工程资料 |
| 资料分析.md、验收用例.md、追踪矩阵.md、待甲方输入与开发缺口.md | 中文说明与追踪 |

reports/ 保存材料自检与试运行的真实结果（报告与运行记录）；run-plan.example.json 与
run-config.example.json 是试运行的操作计划与本地配置示例。

## 两个集合的隔离

开发集合 development-family-v1 与试运行集合 trial-run-family-v1 使用互不相交的资料家族、
模板家族与文件命名空间。两者不共用任何文件，也不共用工点、日期、班次、参数表与叙述模板：
开发为施工日志口径，试运行为巡检单、交班记录、异常调查初判三种口径。检查命令会同时核对家族、
文件与引用三者的隔离，任一交叉即非零退出。

## 资料形态与生成方式

documents/ 下每个集合 17 个文件：5 个工序施工日志（DOCX）、1 个专项方案（文本 PDF）、
1 个地质勘察报告（扫描 PDF，无文本层，供 OCR 通路）、1 个监测断面布置图（PNG）、
1 个现场记录示意卡（JPEG）、1 个监测台账（XLSX）、6 个监测序列（CSV）、1 份综合工程资料（Markdown）。

其中 JPEG 是**合成现场记录示意卡**（带日期、工点、班次的文字卡片），不是写实照片，
只用于资料接入与图像解析通路的联调，不得作为现场影像证据使用。
PNG 是合成的监测断面布置示意图，几何由程序绘制，不含真实工程测量成果。

重新生成与自检：

    uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.py --write-sources
    uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.py
    uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.py --check

check 读回文件内容而不是扩展名：DOCX 表格行数与资料段集合、XLSX/CSV 行数与首列、
文本 PDF 正文尾部完整性、扫描 PDF 的无文本层与逐页像素比对、位图的墨迹比例，
最后用 Node 导入 packages/core/dist 的生产 Schema 校验 11 类配置、评分规则、知识包与监测/反馈载荷。

check 只校验材料包自身的契约，不会执行 acceptance-cases.json 里的 mutation；
那 8 条注入用例需要验收工具在临时副本上执行，本包只登记输入与预期失败码。

## 使用边界

本包只提供输入材料与候选预期。它不写入业务数据库、不生成正式评估结论，也不代表甲方验收结论。
把候选标签当作质量结论使用属于误用。

## 验收入口

材料静态检查与试运行工具位于 scripts/acceptance/synthetic.mjs，入口如下：

    pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1

    pnpm acceptance:synthetic run --pack references/acceptance/synthetic-v1 \
      --config references/acceptance/synthetic-v1/run-config.example.json \
      --output test-results/synthetic-preacceptance

check 输出材料自身的结果；run 将运行状态、安全回执和报告写入 --output 指定目录。
逐例业务证据另按 reports/evidence-record-template.md 核查；工具不会自动将回执转换为验收结论。
缺少目标服务、凭据或工程绑定时 run 会非零退出并记录阻塞原因，不补造成功。

同一配置下的网络中断可使用 --resume 继续，命令和幂等键保持一致。
补充人工前置引用会改变配置，须使用新的输出目录；工具不自动批准、发布或采纳任何对象。
运行依赖已有 apps/api 与 packages/core/contracts 的构建产物。替换源码或包内容后，须先按项目流程
更新构建，再创建新运行。

本次结果见 [内部预验收报告](reports/internal-preacceptance-report.md)，逐例证据表见
[RI/RA 双向追踪](reports/case-traceability.md)。
