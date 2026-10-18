# 正式 JSON-LD 读取边界补充提案

状态：用户已批准（2026-10-15），作为 D-47/IP-19 实施；不扩大模型、工具输出、候选包或检索质量预算。

## 已证实的边界冲突

STD-002 已正式转换并合格，JSON-LD 为 6046815 字节、189 页、3057 文本块，11 张未识别图片完整保留。19 资料准备已创建清洗任务 `data-cleaning-task-81ad506f528c74ac09d5697fcdbd5ced4941ca61`，但任务在首次模型调用前失败，用量为零。实际受权冻结读取复现 `RangeError: frozen artifact exceeds the bounded read limit`，日志在实例 `logs/standard-cleaning-frozen-v39-red.log`。

C15 的 JSON-LD 专用读取上限本已为 16MiB，内部通用 reader 却额外套用 4MiB 观察上限。这一读取接缝缺陷属于已批准 D-46 文件范围，按各调用方已经传入的界限修复；观察仍传 4MiB，文档仍传 16MiB，不改业务或 Agent 预算。

后续 C17 的 `checkStandardRetrievalText` 还把 4MiB 候选包上限用于读取整份 JSON-LD，单次及累计读取均限 4MiB。6046815 字节的同一正式文档无法通过该复核。此处 D-42 明确保留了 4MiB 边界，变更需要本提案批准，不能在清洗恢复时顺手放宽。

## 拟批准的最小修正

1. 在现有文档转换 SSOT `packages/core/src/engineering-data/document-conversion/schema.ts` 导出 `STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1=16*1024*1024`，将 C15 现有 16MiB 取值作为同类文档读取的共享事实源，不新增可任意调节的配置。
2. `packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts` 复用该值；通用读取仅执行调用者给定上限，观察、清单和文档分别沿其既有边界。C15 的工具观察仍受原输出字节、对象及累计资源预算限制。
3. 在 `packages/adapters/src/identification-knowledge/postgres-identification-knowledge-adapter.ts` 的既有 readContentArtifact 增加内部可选读取上限，缺省继续 4MiB。仅 `checkStandardRetrievalText` 的真实转换 JSON-LD 读取使用共享 16MiB；候选包、清洗清单及其它读取保持 4MiB。该标准条目校验中累计工件读取上限改为 16MiB，超过即失败，不截断。文档 Map 仍只缓存本条目精确证据涉及的资料，不读取其它来源。
4. C17 的准备绑定、当前 C06 授权、资料保留资格、C04 完整消费及 verified、证据顺序/正文精确匹配均不变。条目正文、模型上下文/调用额度、工具输出、候选包大小、检索 query/grade/TopK 与七项质量阈值均不变；16MiB 是确定性资料读取上限，不是发给模型的输入额度。

## 验证及续验

扩展既有 C15 `keeps image-only cells...` 行为测试以使用大于 4MiB、小于 16MiB 的合法合成 JSON-LD；当前红灯复现后按正确边界变绿，保留观察/对象限额拒绝。扩展 `packages/adapters/test/identification-knowledge/postgres-identification-knowledge-adapter.test.ts` 的真实正文复核用例：同类大文档可核验、超过 16MiB/累计额度拒绝，错版/撤权/损坏仍失败；候选包 4MiB 拒绝用例保持。

不增加文件模块、依赖、HTTP、迁移或权限。只同步当前 change 的 design/proposal/implementation-plan/handoff、相关局部 delta 与本提案/结果证据，不改主规格。源码及测试清单限上述三源码文件、既有 C15/C17 两个测试文件，复用已有 C04 及 JSON-LD 模块。

回归、build/typecheck/lint/format/strict/diff通过后冻结新发布。三份标准转换不重跑，继续使用已合格精确版本。保留 v39 清洗失败，按新清洗策略版本与新命令启动新任务，不复活原失败或重置台账；经原 C15 准备、C17 人审发布和检索门继续验收。不提交、归档或提前创建 verification。

项目 AGENTS.md §3、施工图 §7 及 D-42 的原 4MiB 约束要求对 C17 的这项读取上限变更先批准。C15 已声明的 16MiB 边界修复可以在 D-46 内继续，本提案不会把该普通修复冒充新的预算授权需求。
