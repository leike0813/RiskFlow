# Implementation Plan

## 1. 实施基线与权威来源

base=6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a。按本change proposal/spec/design D-01–D-06与已归档资料、监测、知识、HTTP、质量规格实施。当前C37 dirty内容只读兼容，所有实现角色完整读取apply contextFiles。

## 2. 复用与接缝

| IP-ID | 现有文件与符号 | 复用方式 | 禁止复制的事实 |
|---|---|---|---|
| IP-01 | core assessment-config AssessmentConfigurationDocumentV1Schema、scoring-rules StructuredScoringRuleDocumentV1Schema；C18 fixture | 配置静态文件只以schema校验，参考现有数值与矩阵 | 不以测试fixture充当生产事实，不改规范阈值 |
| IP-02 | apps/api/src/http.ts HTTP_ROUTE_CATALOG_V1（apps/api/dist/index.js公开导出）、Http* schemas；core领域schema | CLI仅调用公开HTTP注册操作、严格载荷检查、真实ref绑定 | 不复制业务算法/权限、不SQL播种 |
| IP-03 | quality/evaluation-and-browser-acceptance | 报告沿用合成资格、分母和证据边界 | 不发布未经审核正式指标 |

## 3. 代码变更映射

| IP-ID | Task | Requirement/Scenario | 文件与符号 | 精确变化 | 不得改变 |
|---|---|---|---|---|---|
| IP-01 | 材料 | 合成材料两场景 | references/acceptance/synthetic-v1/**；scripts/acceptance/generate-materials.py | manifest/scenarios/expected/sources/configurations/rules/knowledge/monitoring/feedback/acceptance-cases；12+60覆盖，真实文件投影，来源分析/手册/追踪/缺口 | 资料库原件/现有fixture/领域代码 |
| IP-02 | 工具 | 正式入口运行两场景 | scripts/acceptance/synthetic.mjs；synthetic.test.mjs；package.json | checkPack/runPack/main，共享schema检查、正式注册操作、引用模板、稳定幂等、失败/人工等待及恢复 | 生产接口、迁移、C37文件 |
| IP-03 | 证据 | 报告两场景 | references/acceptance/synthetic-v1/reports/**；本change verification | 静态真实检查、实际run阻塞/回执、缺口与RI/RA状态；未执行不通过 | 甲方资格/技术就绪声明 |

## 4. 调用与副作用顺序

check全包后才可run；读本地去秘密配置→冻结包/计划/源码状态→login→显式operation逐项授权服务端校验→真实安全ref checkpoint→人工等待或下一步骤→生成报告。HTTP/业务失败即停止；同run继续保留命令身份，由服务端幂等保证，不以本地成功记录绕过目标变更。无服务器配置仍生成可审阅阻塞报告。不自行启动开发服务器。

## 5. Schema、状态与持久化落实

本地manifest contract按D-01，只引用相对目录内文件。配置和规则引用公共schema，不扩展domain wire。每step pending/submitted/completed/blocked/failed，异步提交不算完成。安全run.json不保存cookie、凭据或完整响应。无数据库迁移/新权限/依赖。

## 6. 验收证据矩阵

| Requirement/Scenario | IP-ID | 测试文件 | Fixture/前置条件 | 关键断言 | 可运行命令 |
|---|---|---|---|---|---|
| 完整模拟包用于开发 | IP-01 | generate-materials.py 自检、synthetic.test.mjs | 本包+构建core | 12+60、六机理、五工序、六监测、文件读回、11配置/规则schema | pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1 |
| 来源与集合不合格 | IP-01/02 | synthetic.test.mjs | 临时非法包 | 缺文件/非法配置/泄漏被拒绝 | pnpm exec vitest run scripts/acceptance/synthetic.test.mjs |
| 真实操作结果形成引用 | IP-02 | synthetic.test.mjs | 有界HTTP响应替身仅检验工具；正式服务另列 | ref替换、载荷schema、submitted区分 | 同上 |
| 等待人工或运行环境缺失 | IP-02 | synthetic.test.mjs | 不可达loopback/人工等待 | 非零、checkpoint、幂等恢复、同键不换输入 | 同上；pnpm acceptance:synthetic run --pack references/acceptance/synthetic-v1 --config references/acceptance/synthetic-v1/run-config.example.json --output test-results/synthetic-preacceptance |
| 候选标签比较 | IP-03 | 报告与工具测试 | 候选预期+真实输出（若具备） | 未审核标记，不正式发布、不反填期望 | pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1 |
| 未运行或证据不足 | IP-03 | synthetic.test.mjs | 缺模型/服务/证明 | 未执行/阻塞保持不可计算 | pnpm exec vitest run scripts/acceptance/synthetic.test.mjs |

补充：uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.py --check；pnpm exec prettier --check scripts/acceptance/*.mjs references/acceptance/synthetic-v1/*.json openspec/changes/prepare-synthetic-functional-preacceptance/**/*.md；pnpm exec eslint scripts/acceptance/*.mjs；openspec validate prepare-synthetic-functional-preacceptance --strict --no-interactive。

## 7. 文件清单与升级条件

新增IP-01目录内文件和generate-materials.py；新增IP-02两mjs；仅修改package.json追加script；新增本change工件，验收后同步新的quality/synthetic-functional-preacceptance主spec。无删除。原资料库、用户dirty paths、历史fixture、业务源代码受保护。发现需要生产API/权限/迁移或领域算法改动时列缺口并升级，不在工具中补造。

## 8. 验收 Agent 授权与限定审计

父Agent验收包/工具/报告，允许范围内修复及回归。检查输入可信边界、幂等/恢复、秘密泄露、标签隔离和通过语义。没有独立受控Orca任务，本次不改路线调度状态；Git权限仍未授予。
