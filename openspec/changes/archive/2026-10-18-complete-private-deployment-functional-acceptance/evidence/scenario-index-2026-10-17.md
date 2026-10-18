# 逐场景证据索引（2026-10-17）

24份delta，共112个Requirement、213个Scenario。各行保留规格原名，链接设计/IP及已有安全证据；索引用于定位，行为结论以所链实际报告和测试结果为准。历史失败不改判。

本轮实机与工程结果见[批量收口](batch-closeout-d189-d190-2026-10-17.md)，包括v173完整Electron13项、D190同运行SSE定向闭合、可见Chrome、functional PASS和统一回归。新增SSE样例仅改变测试输入，不替代本轮活动任务关窗证明。C38移交及混合范围沿各行说明与handoff F-01–F-05，未作目标硬件或多平台PASS。

11项文档定位疑点已由父级对照既有测试闭合，出处列在对应行；本次统一补证命令及结果保存于`d190-closeout/scenario-closure.log`。不为文案或覆盖率新增测试。

## 已完成清洗任务支持当前授权下独立完成准备

规格：[specs/data/agent-cleaning-and-partial-availability/spec.md](../specs/data/agent-cleaning-and-partial-availability/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 启动授权到期后完成准备 | IP-19 / IP-21；D-49 / D-100 | [cleaning-preparation-completion-2026-10-15](cleaning-preparation-completion-2026-10-15.md) |
| 完成资格不足或并发重投 | IP-19 / IP-21；D-49 / D-100 | [cleaning-preparation-completion-2026-10-15](cleaning-preparation-completion-2026-10-15.md)。原任务完成准备：并发两命令、幂等重放、单快照/事件、错任务/未完成/撤权拒绝。 既有测试：`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts:2394`。 |

## 清洗必须观察未识别表格图片及其冻结变化

规格：[specs/data/agent-cleaning-and-partial-availability/spec.md](../specs/data/agent-cleaning-and-partial-availability/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 读取带纯图单元格的表格 | IP-19；D-46 | [table-image-payload-2026-10-15](table-image-payload-2026-10-15.md) |
| 图片变化或资源不足 | IP-19；D-46 | [table-image-payload-2026-10-15](table-image-payload-2026-10-15.md)。同表图片改变指纹，纯图单元格可见；同文件1772行覆盖切片越界及超限。 既有测试：`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts:1617`。 |

## 清洗定位按冻结资料有界分页

规格：[specs/data/agent-cleaning-and-partial-availability/spec.md](../specs/data/agent-cleaning-and-partial-availability/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 读取冻结资料定位下一页 | IP-19 / IP-21；D-35 | [cleaning-paged-budget-2026-10-15](cleaning-paged-budget-2026-10-15.md) |
| 定位超范围或工具未登记 | IP-19 / IP-21；D-35 | [cleaning-paged-budget-2026-10-15](cleaning-paged-budget-2026-10-15.md) |

## 清洗模型获得真实有界定位与观察

规格：[specs/data/agent-cleaning-and-partial-availability/spec.md](../specs/data/agent-cleaning-and-partial-availability/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 模型选择真实资料段 | IP-19 / IP-21；D-34 / D-35 / D-95 / D-96 | [cleaning-context-and-recovery-2026-10-14](cleaning-context-and-recovery-2026-10-14.md) |
| 观察越界或消息超预算 | IP-19 / IP-21；D-34 / D-35 / D-95 / D-96 | [cleaning-context-and-recovery-2026-10-14](cleaning-context-and-recovery-2026-10-14.md) |
| 多次读取后仍保留已完成定位 | IP-19 / IP-21；D-95 | [cleaning-read-progress-2026-10-16](cleaning-read-progress-2026-10-16.md) |
| 生成工具行动时只允许冻结资料身份 | IP-19 / IP-21；D-96 | [visible-read-and-docx-2026-10-14](visible-read-and-docx-2026-10-14.md) |

## 准备完成入口保留原冻结来源

规格：[specs/domain/engineering-context-source-registry/spec.md](../specs/domain/engineering-context-source-registry/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前授权消费原完成任务 | IP-19 / IP-21；D-49 | [cleaning-preparation-completion-2026-10-15](cleaning-preparation-completion-2026-10-15.md) |
| 伪造父运行或替换输入 | IP-19 / IP-21；D-49 | [cleaning-preparation-completion-2026-10-15](cleaning-preparation-completion-2026-10-15.md)。strict完成载荷只接受原任务，附加准备/结果拒绝；cleaning store2394行核对任务/主体/工程。 既有测试：`packages/contracts/test/module-interfaces-events-workflows.test.ts:816`。 |

## 登记原件必须可按精确版本受权读取

规格：[specs/domain/engineering-context-source-registry/spec.md](../specs/domain/engineering-context-source-registry/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前及历史原件 | IP-17 / IP-19；D-32 / D-36 | [physical-documents-2026-10-14](physical-documents-2026-10-14.md) |
| 原件拒权或损坏 | IP-17 / IP-19；D-36 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 校准检查点使用当前权限及稳定结果身份

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前决定及收口元数据合法变化 | IP-19 / IP-21；D-149 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 任务结果或归属不符 | IP-19 / IP-21；D-149 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md)。检查点结果身份、任务模型、主体、工程、父版本及当前撤权逐项拒绝且计数保持。 既有测试：`packages/adapters/test/calibration/postgres-calibration-adapter.test.ts:1449`。 |

## 校准模型生成固定可信候选绑定

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 模型生成完整绑定候选 | IP-19 / IP-21；D-148 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 缺少主输出或绑定越界 | IP-19 / IP-21；D-148 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md)。真实生成Schema接受原绑定，拒绝缺candidateRef、错任务/输入/候选和空专业增量。 既有测试：`scripts/deployment/response-model-step.test.mjs:552`。 |

## 校准任务在启动前冻结实际输入来源

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 输入工件包含基准和偏差来源 | IP-19 / IP-21；D-146 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 清单错绑或当前撤权 | IP-19 / IP-21；D-146 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 校准整体策略与Agent校验身份按同一精确版本对应

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 外层与内层身份不同且合法对应 | IP-19 / IP-21；D-144 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 工程或任一策略身份错配 | IP-19 / IP-21；D-144 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 反馈后续分段使用原正式预测冻结基线

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 实际评估与预测基线为不同输入 | IP-19 / IP-21；D-142 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 反馈已提交而分段启动失败 | IP-19 / IP-21；D-142 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 执行后评估依据按冻结评分成员判断相容

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 新准备沿用原评分成员 | IP-19 / IP-21；D-139 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 成员变化或无法受权读取 | IP-19 / IP-21；D-139 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 参数预测精度符合规范十进制输出

规格：[specs/domain/execution-forecast-feedback-and-deviation/spec.md](../specs/domain/execution-forecast-feedback-and-deviation/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 模型声明超过实际支持的精度 | IP-19；D-138 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 工作流显式冻结现场工件

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 公开入口携带精确现场工件 | IP-18 / IP-19 / IP-21；D-185 / D-186 / D-187 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 冻结引用不匹配现场 | IP-18 / IP-19 / IP-21；D-185 / D-186 / D-187 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 多空间交换现场工件 | IP-18 / IP-19 / IP-21；D-185 / D-186 / D-187 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 报告预览保留所属分页游标契约

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 真实长引用生成续页游标 | IP-20；D-159 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 部署复验按原上下文范围计算当前权限

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 精确小范围上下文在较宽环境中复验 | IP-19 / IP-20；D-157 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 明确资源请求、未知上下文及撤权 | IP-19 / IP-20；D-157 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 部署人员入口按当前会话和当前业务权限处理重放

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 原命令授权历史记录已过期 | IP-19 / IP-21；D-143 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 当前会话或业务权限失效 | IP-19 / IP-21；D-143 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 当前有权运行读取保留跨恢复历史阶段

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同一运行恢复时授权上下文发生合法变化 | IP-19 / IP-21；D-141 / D-178 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 缺失关系或当前拒权 | IP-19 / IP-21；D-141 / D-178 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 人工采纳门禁使用当前等待

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 已采纳运行继续配置等待 | IP-19 / IP-21；D-136 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 内嵌任务恢复观察原正式任务

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 完成通知携带当前授权 | IP-19 / IP-21；D-133 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 独立子运行使用自己的检查点边界

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 父节点内等待后独立回读和恢复 | IP-19 / IP-21；D-74 / D-132 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |
| 原检查点落在父任务命名空间 | IP-19 / IP-21；D-74 / D-132 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 公开Agent完成通知转交原评估等待

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 原评估Agent已完成 | IP-19 / IP-21；D-131 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 其它任务或终态子运行 | IP-19 / IP-21；D-131 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 评估入口恢复按当前权限读取原A0引用

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 已完成Agent后的等待恢复 | IP-19 / IP-21；D-129 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 评估追溯分别核对运行入口与冻结准备

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 原运行引用独立准备并在A0冻结因果准备 | IP-19 / IP-21；D-119 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 运行入口或准备身份错配 | IP-19 / IP-21；D-119 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 评估入口绑定精确独立准备

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前有权主体使用匹配准备 | IP-19 / IP-21；D-112 / D-113 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 错绑定拒绝且无下游效果 | IP-19 / IP-21；D-112 / D-113 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 确定性评估按真实输入权限执行

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 身份检查与准备范围增量不同 | IP-19 / IP-21；D-110 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 实际消费范围被撤权 | IP-19 / IP-21；D-110 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 父事件证明使用当前权限及正式运行事实

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 合法业务事件未携带整批历史资料授权 | IP-19 / IP-21；D-107 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 当前空间不能覆盖原运行 | IP-19 / IP-21；D-107 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 原识别等待支持精确Agent失败通知

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 公开通知原等待任务失败 | IP-17 / IP-19；D-105 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 通知载荷越界 | IP-17 / IP-19；D-105 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 父图按子运行稳定错误分类

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 子运行稳定异常进入父恢复 | IP-21；D-79 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 显式识别执行批次

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同输入启动独立批次 | IP-19 / IP-21；D-54 / D-55 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |
| 批次重投与同键冲突 | IP-19 / IP-21；D-54 / D-55 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 父运行通过显式命令绑定匹配识别准备

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前有权用户绑定匹配独立准备 | IP-19 / IP-21；D-51 / D-52 / D-53 | [workflow-identification-preparation-binding-2026-10-15](workflow-identification-preparation-binding-2026-10-15.md) |
| 错范围或无效等待拒绝 | IP-19 / IP-21；D-51 / D-52 / D-53 | [workflow-identification-preparation-binding-2026-10-15](workflow-identification-preparation-binding-2026-10-15.md) |
| 并发及回执重投保持唯一绑定 | IP-19 / IP-21；D-51 / D-52 / D-53 | [workflow-identification-preparation-binding-2026-10-15](workflow-identification-preparation-binding-2026-10-15.md) |
| 父恢复控制写引用具有正式证明 | IP-19 / IP-21；D-51 / D-52 / D-53 | [workflow-identification-preparation-binding-2026-10-15](workflow-identification-preparation-binding-2026-10-15.md) |

## 父图检查点保持同运行冻结图版本

规格：[specs/domain/module-interfaces-events-workflows/spec.md](../specs/domain/module-interfaces-events-workflows/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 节点推进及恢复保持图版本 | IP-19 / IP-21；D-40 / D-86 | [projection-and-graph-version-2026-10-15](projection-and-graph-version-2026-10-15.md) |
| 已提交事实领先检查点后按原身份恢复 | IP-19 / IP-21；D-40 / D-86 | [projection-and-graph-version-2026-10-15](projection-and-graph-version-2026-10-15.md) |

## 恒值监测窗口没有非直流主峰

规格：[specs/domain/monitoring-batches-snapshots-features/spec.md](../specs/domain/monitoring-batches-snapshots-features/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 小数恒值且零功率下限 | IP-19；D-145 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |
| 非恒值与历史冻结结果 | IP-19；D-145 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 正式JSON-LD按共享文档字节边界读取

规格：[specs/engineering-data/structured-document-conversion/spec.md](../specs/engineering-data/structured-document-conversion/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 合法大文档读取 | IP-19；D-47 | [jsonld-read-bound-2026-10-15](jsonld-read-bound-2026-10-15.md) |
| 单次或累计文档额度不足 | IP-19；D-47 | [jsonld-read-bound-2026-10-15](jsonld-read-bound-2026-10-15.md) |

## 未识别表格图片必须保留来源与单元格位置

规格：[specs/engineering-data/structured-document-conversion/spec.md](../specs/engineering-data/structured-document-conversion/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 图文及纯图单元格进入JSON-LD | IP-19；D-46 | [table-image-payload-2026-10-15](table-image-payload-2026-10-15.md) |
| 错来源或不安全路径 | IP-19；D-46 | [mineru-standard-conversion-v37-2026-10-15](mineru-standard-conversion-v37-2026-10-15.md)。真实ZIP协议测试拒绝缺失、外链、包外、歧义和坏图片；official-normalization163行拒绝无包证明/活动属性。 既有测试：`packages/adapters/test/engineering-data/document-conversion/mineru/protocol.test.ts:147`。 |

## 标准XML字符引用按正文语义解析

规格：[specs/engineering-data/structured-document-conversion/spec.md](../specs/engineering-data/structured-document-conversion/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 合法字符引用与官网正文一致 | IP-17 / IP-19；D-33 | [visible-read-and-docx-2026-10-14](visible-read-and-docx-2026-10-14.md) |
| 危险实体或真实正文不一致 | IP-17 / IP-19；D-33 | [visible-read-and-docx-2026-10-14](visible-read-and-docx-2026-10-14.md) |

## 无属性eq公式文本按惰性纯文本保留

规格：[specs/engineering-data/structured-document-conversion/spec.md](../specs/engineering-data/structured-document-conversion/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 无属性eq公式文本原样保留 | IP-19；D-45 | [mineru-standard-conversion-v37-2026-10-15](mineru-standard-conversion-v37-2026-10-15.md) |
| 带属性eq或危险内容继续拒绝 | IP-19；D-45 | [mineru-standard-conversion-v37-2026-10-15](mineru-standard-conversion-v37-2026-10-15.md) |

## 识别恢复仅作用于识别复核决定

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 非识别决定不误恢复识别 | IP-19 / IP-21；D-127 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 识别决定仍校验恢复资格 | IP-19 / IP-21；D-127 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 终态检索审阅由所属任务事实收口

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 等待任务终态失败后继续剩余项 | IP-19 / IP-21；D-105 / D-106 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 错绑定或未终止任务通知 | IP-19 / IP-21；D-105 / D-106 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 已成立失败收口命令重放 | IP-19 / IP-21；D-105 / D-106 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 已提交阶段增量由同版本登记恢复

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| I6提交后检查点失败 | IP-19 / IP-21；D-87 / D-88 | [committed-stage-recovery-2026-10-16](committed-stage-recovery-2026-10-16.md) |
| 必需阶段结果无法证明 | IP-19 / IP-21；D-87 / D-88 | [committed-stage-recovery-2026-10-16](committed-stage-recovery-2026-10-16.md) |
| 恢复入口检查后取消先提交 | IP-19 / IP-21；D-87 / D-88 | [committed-stage-recovery-2026-10-16](committed-stage-recovery-2026-10-16.md) |

## 独立识别子运行隔离父节点临时调度状态

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 父中断后恢复同一识别任务 | IP-21；D-74 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 父技术失败与叶任务等待分别按真实状态恢复

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 子恢复效果前父调用出现技术异常 | IP-19 / IP-21；D-69 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 检索审阅校验工件使用统一Agent用途

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 校验通过后记录正式候选 | IP-19 / IP-21；D-65 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 检索审阅任务预算由版本化策略正文提供

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 新预算配置与任务冻结 | IP-19 / IP-21；D-63 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 检索审阅模型获得受权候选及前轮观察

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 补搜或校验后的模型续步 | IP-19 / IP-21；D-62 / D-104 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 正文预写按实际输入区分存储命令

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 正文已存但阶段登记事务回滚 | IP-19 / IP-21；D-60 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 嵌套识别恢复使用自身检查点标识

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 父节点内恢复可重试子运行 | IP-19 / IP-21；D-59 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 识别阶段登记幂等键按精确运行分区

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同准备的两个父运行 | IP-19 / IP-21；D-57 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 检索审阅冻结引用采用正式Agent任务身份

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 冻结候选与正式启动配对 | IP-19 / IP-21；D-56 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 公共父恢复保留完成结果并恢复精确识别等待

规格：[specs/identification/graph/spec.md](../specs/identification/graph/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 完成结果恢复原任务等待 | IP-19 / IP-21；D-54 / D-66 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |
| 错误结果或父运行版本拒绝 | IP-19 / IP-21；D-54 / D-66 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 编制模型定位保持完整且不重复长前缀

规格：[specs/identification/process-model-mechanism-and-evidence-governance/spec.md](../specs/identification/process-model-mechanism-and-evidence-governance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 大清单在原预算下完整定位 | IP-19；D-156 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |

## 编制候选校验工件遵循统一运行时用途

规格：[specs/identification/process-model-mechanism-and-evidence-governance/spec.md](../specs/identification/process-model-mechanism-and-evidence-governance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 正常或可修复候选的校验工件可登记 | IP-19；D-155 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |

## 编制提交保留当前来源范围和真实基线

规格：[specs/identification/process-model-mechanism-and-evidence-governance/spec.md](../specs/identification/process-model-mechanism-and-evidence-governance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前允许的来源通过事务引用守卫 | IP-19；D-101 / D-153 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |
| 已有定义的编制修订携带冻结基线 | IP-19；D-101 / D-153 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |

## 编制模型消费真实冻结定位与所属工具观察

规格：[specs/identification/process-model-mechanism-and-evidence-governance/spec.md](../specs/identification/process-model-mechanism-and-evidence-governance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 冻结成员和工具内容进入模型 | IP-19；D-152 / D-161 / D-163 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |
| 切片工具读取真实资料正文 | IP-19；D-152 / D-161 / D-163 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |
| 观察或清单不属于当前任务 | IP-19；D-152 / D-161 / D-163 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |

## 失败复核独立恢复控制来源与治理基线

规格：[specs/identification/process-model-mechanism-and-evidence-governance/spec.md](../specs/identification/process-model-mechanism-and-evidence-governance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 既有发布定义的失败送审 | IP-19；D-160 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |
| 控制来源不匹配或当前拒权 | IP-19；D-160 | [knowledge-authoring-2026-10-17](knowledge-authoring-2026-10-17.md) |

## 失败通知不替代正式检索上下文

规格：[specs/identification/relationship-context-and-retrieval-agent-review/spec.md](../specs/identification/relationship-context-and-retrieval-agent-review/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 原任务失败而其它项合格 | IP-19；D-103 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 上下文结果登记与实际工件使用同一审计身份

规格：[specs/identification/relationship-context-and-retrieval-agent-review/spec.md](../specs/identification/relationship-context-and-retrieval-agent-review/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 模型上下文工件包含工作项与任务身份 | IP-19 / IP-21；D-75 / D-76 / D-77 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 机理适用集合覆盖当前工序的全部条件

规格：[specs/identification/relationship-context-and-retrieval-agent-review/spec.md](../specs/identification/relationship-context-and-retrieval-agent-review/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 宽范围机理覆盖单阶段节点 | IP-19 / IP-21；D-73 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |
| 机理只覆盖节点部分条件 | IP-19 / IP-21；D-73 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 正式风险追溯按实际来源当前可见性读取

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前允许读取旧摘要记录 | IP-19 / IP-20；D-162 | [defensive-design-ledger](defensive-design-ledger.md) |
| 真实范围不可读 | IP-19 / IP-20；D-162 | [defensive-design-ledger](defensive-design-ledger.md) |

## 风险来源覆盖已登记的工程输入与知识证据

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 已发布知识证据不属于工程输入子集 | IP-17 / IP-19 / IP-21；D-109 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 证据来源无权或并集超限 | IP-17 / IP-19 / IP-21；D-109 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 分批复核增量保留已成立记录和事件

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 新人工决定加入已有验收集合 | IP-19 / IP-21；D-108 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 混合批次包含异载荷旧身份 | IP-19 / IP-21；D-108 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 有界修正输入对应待替换候选与精确数量

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 只替换一个失败候选 | IP-19 / IP-21；D-84 | [repair-cardinality-2026-10-16](repair-cardinality-2026-10-16.md) |

## 合并嵌入使用正式收口能力

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 合并授权可进入嵌入而生成授权不能替代 | IP-19 / IP-21；D-83 / D-85 | [i6-embedding-capability-2026-10-16](i6-embedding-capability-2026-10-16.md) |

## 模型输入和输出约束绑定同一冻结候选数量预算

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 模型遵守本次候选数量上限 | IP-19 / IP-21；D-82 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 校验复用已生成候选精确内容

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 生成后校验不重复写候选 | IP-19 / IP-21；D-81 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 候选生成工件在生产构造时遵守严格Schema

规格：[specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md](../specs/identification/risk-candidate-validation-merge-and-acceptance/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 生成和修正工件可按相同Schema重读 | IP-19 / IP-21；D-80 | [identification-batch-and-read-context-2026-10-15](identification-batch-and-read-context-2026-10-15.md) |

## 检索成员文本与稠密查询指令使用共享确定性表示

规格：[specs/identification/versioned-dual-index-hybrid-retrieval/spec.md](../specs/identification/versioned-dual-index-hybrid-retrieval/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 投影和事实回查表示一致 | IP-19；D-42 | [retrieval-semantic-content-2026-10-15](retrieval-semantic-content-2026-10-15.md) |
| 指令只包装稠密查询 | IP-19；D-42 | [retrieval-semantic-content-2026-10-15](retrieval-semantic-content-2026-10-15.md) |

## 构建质量门沿原事务读取正式代际

规格：[specs/identification/versioned-dual-index-hybrid-retrieval/spec.md](../specs/identification/versioned-dual-index-hybrid-retrieval/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同事务代际通过正式质量读取 | IP-19 / IP-21；D-41 | [retrieval-quality-2026-10-15](retrieval-quality-2026-10-15.md) |
| 质量失败保持非活动 | IP-19 / IP-21；D-41 | [retrieval-quality-2026-10-15](retrieval-quality-2026-10-15.md) |

## 配置包修订冲突复核可达且基线替换身份明确

规格：[specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md](../specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 配置包替换同一规则基线 | IP-19 / IP-21；D-116 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 重复审核准备保留唯一任务 | IP-19 / IP-21；D-116 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 正式组装入口复用准备与治理事实

规格：[specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md](../specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 准备与版本不一致 | IP-17 / IP-19；D-39 / D-177 | [knowledge-publication-and-c19-2026-10-15](knowledge-publication-and-c19-2026-10-15.md) |
| 隔离合成来源经新策略明确批准 | IP-17 / IP-19；D-39 / D-177 | [knowledge-publication-and-c19-2026-10-15](knowledge-publication-and-c19-2026-10-15.md) |

## 配置包的配置读取按当前调用幂等

规格：[specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md](../specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同包在另一当前调用继续准备 | IP-19 / IP-21；D-117 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 全域等级与离散等值规则可正式求值

规格：[specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md](../specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 离散地层规则通过正式Schema和统一求值 | IP-19 / IP-21；D-114 / D-115 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 未声明值或全域重叠拒绝 | IP-19 / IP-21；D-114 / D-115 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 哈希清单分页与恢复采用同一排序

规格：[specs/platform/content-addressed-artifact-store/spec.md](../specs/platform/content-addressed-artifact-store/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 数据库使用语言相关排序 | IP-21；D-179 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 多父工件当前授权使用精确空间并集

规格：[specs/platform/content-addressed-artifact-store/spec.md](../specs/platform/content-addressed-artifact-store/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 两个父工件共享同一空间 | IP-19；D-128 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 工件来源限制独立于逐段证据

规格：[specs/platform/content-addressed-artifact-store/spec.md](../specs/platform/content-addressed-artifact-store/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 无逐段证据的冻结清单 | IP-19；D-97 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 读取块字节在消费者保留后保持稳定

规格：[specs/platform/content-addressed-artifact-store/spec.md](../specs/platform/content-addressed-artifact-store/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 多块不同内容完整保留后拼接 | IP-19；D-44 | [c04-stable-read-chunks-scope-proposal](c04-stable-read-chunks-scope-proposal.md) |
| 保留块后的取消保持原契约 | IP-19；D-44 | [c04-stable-read-chunks-scope-proposal](c04-stable-read-chunks-scope-proposal.md) |

## 孤儿维护dry-run保留已有物理对象

规格：[specs/platform/content-addressed-artifact-store/spec.md](../specs/platform/content-addressed-artifact-store/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 审计失败后的隔离对象在dry-run中保留 | IP-21；D-181 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 桌面验收独立绑定同次运行与导出查询

规格：[specs/platform/electron-https-client/spec.md](../specs/platform/electron-https-client/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 正式观察和报告导出均绑定同次运行材料 | IP-18 / IP-20；D-154 | [resume-v163-2026-10-17](resume-v163-2026-10-17.md) |
| 非导出查询或异查询下载 | IP-18 / IP-20；D-154 | [resume-v163-2026-10-17](resume-v163-2026-10-17.md)。v173完整轮及D190定向均通过原预检，异查询/非risk-overview、错发布/身份/报告不计通过。 既有测试：`apps/desktop/test/e2e/client.spec.ts:620`。 |
| 活动运行事件不足时显式绑定SSE样例 | IP-18 / IP-21；D-190 | [batch-closeout-d189-d190-2026-10-17](batch-closeout-d189-d190-2026-10-17.md)。D190当前快照与事件流分别固定，同实体；原活动关窗与SSE分别取证，不重开模型。 |

## 桌面关窗继续使用同次活动任务证明

规格：[specs/platform/electron-https-client/spec.md](../specs/platform/electron-https-client/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| LangGraph等待正在执行的内嵌Agent | IP-18 / IP-20；D-151 / D-171 | [resume-v163-2026-10-17](resume-v163-2026-10-17.md) |

## 桌面验收沿当前正式清单核验兼容

规格：[specs/platform/electron-https-client/spec.md](../specs/platform/electron-https-client/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 当前后端具有已批准新迁移 | IP-18；D-150 | [resume-v163-2026-10-17](resume-v163-2026-10-17.md) |

## 当前桌面原件与Agent行为必须和Web一致

规格：[specs/platform/electron-https-client/spec.md](../specs/platform/electron-https-client/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 保存原件并查看任务 | IP-18 / IP-19；D-36 / D-37 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 桌面功能验收与正式离线发布分阶段

规格：[specs/platform/electron-https-client/spec.md](../specs/platform/electron-https-client/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| C38 无公网环境安装正式客户端 | IP-18 / IP-22；D-28 / D-30 | [readiness](readiness.md)。C38移交:F-01/F-02（§6矩阵标 IP-22 → C38 F-01/F-02），当前未执行，不计本change通过 |
| 当前功能验收与 C38 平台证据缺失 | IP-18 / IP-22；D-28 / D-30 | [readiness](readiness.md)。§6矩阵：V7当前平台Electron + V6移交核对；不得以C38缺项掩盖当前功能缺陷 |
| 兼容界面更新与正式平台证据 | IP-18 / IP-22；D-28 / D-30 | [readiness](readiness.md)。C38移交:F-01/F-02；§6矩阵V7/V6 |

## 恢复命令支持显式识别准备引用

规格：[specs/platform/http-command-query-sse-shell/spec.md](../specs/platform/http-command-query-sse-shell/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 恢复原因进入原工作流端口 | IP-19 / IP-21；D-51 | [workflow-identification-preparation-binding-2026-10-15](workflow-identification-preparation-binding-2026-10-15.md) |
| 非法恢复字段或无当前权限 | IP-19 / IP-21；D-51 | [workflow-identification-preparation-binding-2026-10-15](workflow-identification-preparation-binding-2026-10-15.md) |

## 完成准备命令只接收精确任务引用

规格：[specs/platform/http-command-query-sse-shell/spec.md](../specs/platform/http-command-query-sse-shell/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 合法完成命令路由 | IP-19；D-49 | [cleaning-preparation-completion-2026-10-15](cleaning-preparation-completion-2026-10-15.md) |
| 非法字段或无当前会话 | IP-19；D-49 | [cleaning-preparation-completion-2026-10-15](cleaning-preparation-completion-2026-10-15.md) |

## 适用规则集正式HTTP组装

规格：[specs/platform/http-command-query-sse-shell/spec.md](../specs/platform/http-command-query-sse-shell/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| HTTP请求分派与当前权限 | IP-17 / IP-19；D-39 | [knowledge-publication-and-c19-2026-10-15](knowledge-publication-and-c19-2026-10-15.md) |

## 资料原件HTTP必须具有独立受权二进制通路

规格：[specs/platform/http-command-query-sse-shell/spec.md](../specs/platform/http-command-query-sse-shell/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 原件预览与保存 | IP-17 / IP-19；D-36 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |
| 内容读取中断 | IP-17 / IP-19；D-36 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 结构化生成可显式使用单函数参数承载

规格：[specs/platform/llamacpp-model-gateway/spec.md](../specs/platform/llamacpp-model-gateway/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 单输出函数完成 | IP-17 / IP-19 / IP-21；D-90 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 函数输出不满足边界 | IP-17 / IP-19 / IP-21；D-90 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |

## Embedding正文预算与完整请求上限分别校验

规格：[specs/platform/llamacpp-model-gateway/spec.md](../specs/platform/llamacpp-model-gateway/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 正文恰好预算而封装仍有界 | IP-17 / IP-19 / IP-21；D-85 | [merge-embedding-budget-2026-10-16](merge-embedding-budget-2026-10-16.md) |

## 结构化模型请求受本行动token额度约束

规格：[specs/platform/llamacpp-model-gateway/spec.md](../specs/platform/llamacpp-model-gateway/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 行动额度小于部署窗口 | IP-19 / IP-21；D-96 / D-148 | [visible-read-and-docx-2026-10-14](visible-read-and-docx-2026-10-14.md)。输入/上下文额度小于部署窗口时，在推理前拒绝。 既有测试：`packages/adapters/test/model/network-api-model-gateway.test.ts:494`。 |
| 服务返回超额usage | IP-19 / IP-21；D-96 / D-148 | [visible-read-and-docx-2026-10-14](visible-read-and-docx-2026-10-14.md)。超额实际usage返回预算错误，保留真实用量和耐久原响应引用。 既有测试：`packages/adapters/test/model/network-api-model-gateway.test.ts:514`。 |

## 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验

规格：[specs/platform/llamacpp-model-gateway/spec.md](../specs/platform/llamacpp-model-gateway/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 双重约束后的结构化结果成功 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| Schema 提示与本地严格复验 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 非法 JSON 结构失败 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| Zod 复验失败 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 服务端 Schema 约束缺少证据 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 输出 Schema 无法安全转换 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| reasoning 内容不进入持久化或展示 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 格式错误可被上层反馈 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 合规输出保留业务校验 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |
| 不保存思维链 | IP-19 / IP-21；D-90 / D-98 / D-99 | [minimax-function-call-2026-10-16](minimax-function-call-2026-10-16.md) |

## 官网表格图片仅解析耐久包内受控载荷

规格：[specs/platform/mineru-service-integration/spec.md](../specs/platform/mineru-service-integration/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 包内图片可追溯 | IP-19；D-46 | [table-image-payload-2026-10-15](table-image-payload-2026-10-15.md) |
| 外部或无法证明的图片 | IP-19；D-46 | [table-image-payload-2026-10-15](table-image-payload-2026-10-15.md)。同一表格图片参数化协议用例核对外链、包外、缺失、歧义及坏图片拒绝。 既有测试：`packages/adapters/test/engineering-data/document-conversion/mineru/protocol.test.ts:147`。 |

## 官网图表结构按共享惰性语义映射并保留历史版本

规格：[specs/platform/mineru-service-integration/spec.md](../specs/platform/mineru-service-integration/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 官网图表结构映射为可追溯惰性载荷 | IP-19；D-45 | [mineru-standard-conversion-v37-2026-10-15](mineru-standard-conversion-v37-2026-10-15.md) |
| 未知结构与历史版本不被覆写 | IP-19；D-45 | [mineru-standard-conversion-v37-2026-10-15](mineru-standard-conversion-v37-2026-10-15.md) |

## 评估功能终态使用所属正式运行详情

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 状态推进后观察同次评估 | IP-20；D-168 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |
| 辅助引用不能证明完成 | IP-20；D-168 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |

## 功能运行器保存合法异步等待回执

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 工作流返回等待Agent的202回执 | IP-18 / IP-20；D-151 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |

## 受控预置登记监测前置配置

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 从正式上下文初始化合成监测 | IP-17 / IP-19 / IP-21；D-89 / D-91 / D-93 / D-94 / D-111 | [monitoring-registration-entry-gap-2026-10-16](monitoring-registration-entry-gap-2026-10-16.md) |
| 监测前置步骤拒绝 | IP-17 / IP-19 / IP-21；D-89 / D-91 / D-93 / D-94 / D-111 | [monitoring-registration-entry-gap-2026-10-16](monitoring-registration-entry-gap-2026-10-16.md) |

## 当前功能验收与最终部署交付必须分开收口

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 无目标硬件完成当前功能验收 | IP-22；D-26 / D-30 | [readiness](readiness.md) |
| 网络 API 或真实业务证据缺失 | IP-19 / IP-20；D-26 / D-30 | [readiness](readiness.md) |
| 正式清洗终态在当前有权页面显示 | IP-19 / IP-20 / IP-22；D-29 / D-32 / D-37 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 模型与 OCR 必须离线预置并隔离资源

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 联网推理完成业务链路 | IP-19；D-26 / D-27 / D-31 | [readiness](readiness.md) |
| 预置服务身份与真实协议匹配 | IP-22；D-26 / D-27 / D-31 | [readiness](readiness.md)。C38移交:F-03/F-04（§6矩阵标 IP-22 → C38 F-03/F-04，原 IP-10/IP-14）；未执行 |
| OCR 饱和或崩溃 | IP-19 / IP-21；D-26 / D-27 / D-31 | [readiness](readiness.md)。§6矩阵：本地GPU影响交C38 F-04；V4 |
| 模型制品或资源证明缺失 | IP-22；D-26 / D-27 / D-31 | [readiness](readiness.md)。C38移交:F-03/F-04；V6 |

## 隔离恢复重建已登记双索引代际

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 消费者回执已完成而恢复投影为空 | IP-21；D-182 | [task-closeout-2026-10-17](task-closeout-2026-10-17.md) |

## 发布回退与目标环境验收必须有真实证据

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 兼容版本回退 | IP-21；D-30 / D-184 | [readiness](readiness.md) |
| 不兼容回退或缺少真实证据 | IP-20 / IP-21；D-30 / D-184 | [readiness](readiness.md) |
| 在批准目标硬件形成基准 | IP-22；D-30 / D-184 | [readiness](readiness.md)。C38移交:F-04（4090/128GB与辅助GPU）；实测benchmark先由C38实现；§6矩阵V6 |
| 目标环境未齐时完成工程检查 | IP-22；D-30 / D-184 | [readiness](readiness.md) |

## 功能验收必须证明正式来源与完整宿主

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 三类正式来源贯通原业务链 | IP-17 / IP-19；D-25 / D-166 | [readiness](readiness.md) |
| 错来源或关键服务缺失 | IP-17 / IP-19；D-25 / D-166 | [readiness](readiness.md) |

## 功能报告必须对应同次正式终态与可见交互

规格：[specs/platform/offline-private-deployment-and-operations/spec.md](../specs/platform/offline-private-deployment-and-operations/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同次业务与可见浏览器具有完整证据 | IP-19 / IP-20 / IP-21；D-29 / D-167 / D-174 / D-183 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |
| 人审等待或观察证据不完整 | IP-20；D-29 / D-167 / D-174 / D-183 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |
| 重启与回执故障重投 | IP-21；D-29 / D-167 / D-174 / D-183 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |
| 只读观察已有正式业务引用 | IP-20；D-183 | [model-stream-and-functional-2026-10-17](model-stream-and-functional-2026-10-17.md) |

## 复核任务详情接受精确身份引用

规格：[specs/platform/review-and-audit-runtime/spec.md](../specs/platform/review-and-audit-runtime/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 只持有任务深链身份 | IP-21；D-106 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 错版或无权读取 | IP-21；D-106 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 可修复模型候选纠错使用独立行动

规格：[specs/platform/unified-bounded-agent-runtime/spec.md](../specs/platform/unified-bounded-agent-runtime/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 非法模型输出后在原任务内纠错 | IP-19 / IP-21；D-147 / D-158 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |
| 纠错预算不足或无关后续行动 | IP-19 / IP-21；D-147 / D-158 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md)。原失败行动纠错以0/1剩余额度参数化核验；295行覆盖跨工具反馈及错任务/行动绑定。 既有测试：`apps/worker/test/agent-runtime/runner.test.ts:492`。 |

## Worker统一携带可信任务执行依据

规格：[specs/platform/unified-bounded-agent-runtime/spec.md](../specs/platform/unified-bounded-agent-runtime/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 同一任务各执行接缝共享当前授权检查 | IP-19 / IP-21；D-48 / D-72 | [agent-task-current-authorization-2026-10-15](agent-task-current-authorization-2026-10-15.md) |
| 租约或任务状态失效 | IP-19 / IP-21；D-48 / D-72 | [agent-task-current-authorization-2026-10-15](agent-task-current-authorization-2026-10-15.md) |

## 行动按剩余额度执行并如实记录失败消耗

规格：[specs/platform/unified-bounded-agent-runtime/spec.md](../specs/platform/unified-bounded-agent-runtime/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 剩余额度不足 | IP-19 / IP-21；D-35 | [cleaning-paged-budget-2026-10-15](cleaning-paged-budget-2026-10-15.md) |
| 已发生超额或解释失败 | IP-19 / IP-21；D-35 | [cleaning-paged-budget-2026-10-15](cleaning-paged-budget-2026-10-15.md) |

## 失败行动恢复必须有界收口

规格：[specs/platform/unified-bounded-agent-runtime/spec.md](../specs/platform/unified-bounded-agent-runtime/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 重复领取已失败行动 | IP-19 / IP-21；D-95 / D-147 / D-158 | [cleaning-read-progress-2026-10-16](cleaning-read-progress-2026-10-16.md) |
| 恢复证据不可读 | IP-19 / IP-21；D-95 / D-147 / D-158 | [cleaning-read-progress-2026-10-16](cleaning-read-progress-2026-10-16.md) |
| 恢复已完成工具读取进度 | IP-19 / IP-21；D-95 / D-147 / D-158 | [cleaning-read-progress-2026-10-16](cleaning-read-progress-2026-10-16.md) |
| 领域拒绝候选后有界纠错 | IP-19 / IP-21；D-95 / D-147 / D-158 | [cleaning-read-progress-2026-10-16](cleaning-read-progress-2026-10-16.md) |

## 停靠开合不得因没有证据误关闭

规格：[specs/platform/web-shell-interaction-primitives/spec.md](../specs/platform/web-shell-interaction-primitives/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 空证据下打开Agent | IP-18 / IP-19；D-37 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 评估读取按实际记录来源检查当前权限

规格：[specs/risk-assessment/engine/spec.md](../specs/risk-assessment/engine/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 空授权增量读取原正式评估 | IP-19 / IP-21；D-110 / D-118 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 当前来源撤权或空间不符 | IP-19 / IP-21；D-110 / D-118 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 评估消费准备中显式冻结的工程字段事实

规格：[specs/risk-assessment/engine/spec.md](../specs/risk-assessment/engine/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 已识别风险使用施工及地质资料值 | IP-17 / IP-19 / IP-21；D-112 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |
| 字段无权重复或覆盖风险事实 | IP-17 / IP-19 / IP-21；D-112 | [incremental-acceptance-and-provenance-2026-10-17](incremental-acceptance-and-provenance-2026-10-17.md) |

## 复核详情深链不依赖队列页

规格：[specs/web/agent-audit-and-operations-ui/spec.md](../specs/web/agent-audit-and-operations-ui/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 待审任务位于队列第一页之外 | IP-21；D-106 | [resume-after-reduction-2026-10-16](resume-after-reduction-2026-10-16.md) |

## 生产Agent三视图必须可自然到达

规格：[specs/web/agent-audit-and-operations-ui/spec.md](../specs/web/agent-audit-and-operations-ui/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 由业务页查看已完成清洗 | IP-18 / IP-19；D-37 / D-38 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |
| 待复核动作 | IP-18 / IP-19；D-37 / D-38 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 资料详情必须以原件为默认内容

规格：[specs/web/engineering-and-knowledge-ui/spec.md](../specs/web/engineering-and-knowledge-ui/spec.md)

| Scenario | IP / 设计 | 证据与核对 |
| --- | --- | --- |
| 五格式原件可核对 | IP-17 / IP-19；D-36 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |
| 版本及权限变化 | IP-17 / IP-19；D-36 | [original-and-agent-ui-2026-10-15](original-and-agent-ui-2026-10-15.md) |

## 原任务与移交

IP-17→1.1/1.2；IP-18→2.1/2.2及7.4；IP-19→3.1/3.2、7.1/7.3和8.1；IP-20→4.1/4.2；IP-21→5.1–5.3及7.2；IP-22→6.1–6.3。原任务编号/施工图对应关系保持[handoff](../handoff.md)的原任务拆分表；F-01/F-02为签名与多平台，F-03为跨VM/禁网/介质，F-04为4090及辅助GPU基准，F-05为最终合同收口，均未执行或计入本次功能通过。
