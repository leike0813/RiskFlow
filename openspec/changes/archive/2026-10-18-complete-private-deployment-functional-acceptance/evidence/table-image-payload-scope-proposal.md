# 表格图片载荷保留与清洗观察补充提案

状态：用户已批准（2026-10-15），作为 D-46 纳入 IP-19 实施；新转换和下游功能证据仍需实际运行，不预填通过。

## 问题与决定

[v38 实机报告](mineru-standard-conversion-v38-2026-10-15.md)已证明 STD-001/003 合格，STD-002 的 chart 映射已通过，但官方表格含 `<img src="包内文件名.jpg"/>`，在第 75 页触发原 table-html-rejected。完整结构复核确认 11 张唯一图片在本次 ZIP 内均能唯一解析，共 18500 字节，所有 img 均自闭合且仅含 src。受权查看其中一张真实图片，内容是图形符号，没有可原样提取的文字。

当前 NormalizedBlockV1 和 TableFieldV1 只表达文字或标量，C15 Agent 也只获得 textBlocks。仅从拒绝正则移除 img，会造成图片被丢弃、空值歧义或图片路径混入正文，不能作为合格修复。

拟保留图片为明确的“未识别图像”结构引用，并让清洗观察知道资料含此类内容。原件预览已有完整页面，本提案不新增预览界面、图片 OCR、模型视觉调用或自动识别图形含义。

## 数据契约与解析

1. 在现有文档转换 schema 唯一事实源中导出 `UnrecognizedTableImageRefV1Schema`，strict 字段为 `kind="unrecognized-image"`、`rawResponseArtifactRef`（既有 ArtifactRefV1）和 `packageEntryPath`（有界、规范化的包内路径）。它指向已耐久并复验的本次 MinerU ZIP 原响应中的图片，不指向服务器文件系统、外部 URL 或猜测位置。
2. `NormalizedBlockV1` 的 cell 和 `TableFieldV1` 增加可选 `unrecognizedImages` 引用数组，使用上述同一 Schema；其数量受原 maxCells/maxOutputBlocks 和输出字节预算共同限制，不引入单独扩大预算的配置。字段只表达尚未解读的视觉载荷，不表达可计算的业务值。
3. core 的 buildTableFields/JSON-LD 保留原表格身份、行列、合并关系及该字段。有文字和图片的单元格保留真实文字，另列图片；只有图片的单元格保留逻辑位置、`value=null` 和非空图片引用，不能与没有图片的空单元格混同。图形、文件名及说明标记不注入 textBlocks，不计作非空正文、关键字段或新的可检索文字。
4. 官网解析在已批准 ZIP 的精确条目集合内解析 src，确认唯一存在的 JPG/PNG 图片后才建立引用；引用固定该 ZIP 原响应工件。沿用既有安全包解析、字节/解压/条目上限和图片头校验，不打开文件路径或访问网络。只接受已实测的自闭合 img 和唯一 src 属性；外链、data URL、绝对路径、包外路径、缺失/歧义条目、额外属性、嵌套活动内容继续整体拒绝。自托管没有同等可验证包上下文时继续拒绝，不猜测跨协议映射。
5. shared parseHtmlTable 对图片产生类型化单元格载荷，expandTable 传到既有 cell；不把 img 加到通用安全行内文字标签集合。DOCTYPE/ENTITY、script/style/iframe/object 和其它未知结构继续拒绝，eq 字面公式处理保持 D-45 行为。

## 下游可见性

C15 的冻结文档增加可选 `unrecognizedTableImageCount`，由受权、完整性通过的 JSON-LD 实际图片引用计算，初始模型消息必须显示这个数量，避免模型把资料理解为纯文本已完整识别。沿原冻结输入引用和字节/token/对象预算传递，不截断、不新增通用工件或图像读取工具。

既有 read-document-segment-slice 观察对被选择的表格提供相关单元格的 `unrecognizedImages` 和逻辑行列；同表中的纯图片单元格也明确列出，不能因没有 textBlock 而消失。只读取当前选择关联的表格，按原工具和观察资源限额收口，超限失败，不全库读取。源级计数不伪造资料段；纯图形的完整表达保留在 JSON-LD tableFields 与原 ZIP。

既有 jsonLdFingerprint 固定全部结构；受影响段的 parsedFingerprint 纳入同表未识别图片引用，避免文字相同掩盖非文本内容变化。没有该载荷的旧输入保持既有含义。清洗仍按原部分可用规则和人工/确定性边界处理，不能把未识别图片改写成文字、数值、阈值或公式结论。C17 retrievalText 继续只拼接实际证据文字，图片引用不参加正文拼接；不改检索标签、查询或阈值。

## 文件范围

生产源码拟限于：

- `packages/core/src/engineering-data/document-conversion/schema.ts`、`service.ts`：共享图片引用、cell/tableField 传递和 JSON-LD 合规约束。
- `packages/adapters/src/engineering-data/document-conversion/mineru/mineru-document-parser.ts`、`official-normalization.ts`、`normalization.ts`：已耐久 ZIP 上下文、精确包内图片映射及类型化单元格载荷。
- `packages/core/src/engineering-data/cleaning/schema.ts`、`packages/adapters/src/engineering-data/cleaning/postgres-data-cleaning-store.ts`、`apps/worker/src/engineering-data/cleaning/runtime.ts`：冻结来源计数、有界表格观察及既有指纹语义。

测试复用并扩展：`packages/core/test/engineering-data/document-conversion.test.ts`、`packages/core/test/engineering-data/cleaning.test.ts`；adapters 既有 MinerU `normalization.test.ts`、`official-normalization.test.ts`、`protocol.test.ts` 及必要共享 `fixture.ts`；`packages/adapters/test/engineering-data/cleaning/postgres-data-cleaning-store.test.ts`、`apps/worker/test/engineering-data/cleaning/runtime.test.ts`。测试使用合成图片和符号，不把原标准正文复制进 fixtures。

只同步本 change 的 proposal/design/implementation-plan/handoff、文档转换/MinerU/清洗局部 delta 和安全证据，不改主规格。无新依赖、HTTP、迁移、权限、通用工具或预算；不改用户原件或 v36–v38 事实。

## 验证与续验

先用包含合法包内图片的表格取得红灯，再验证：图文混排与纯图单元格不丢失、不混入正文；行列与合并关系保持；错误包引用/外链/危险属性整体拒绝；清洗能观察未识别载荷，跨版本/撤权/损坏/超预算继续失败。使用上述既有 core、adapter、worker 测试，随后 build/typecheck/lint/format、全仓 strict 与 diff 检查。

工程通过后冻结新的解析部署与本地发布，只为 STD-002 经原 C11 入口建立正式新资料版本并重转，保持其原非空页和关键字段门槛均为 1；STD-001/003 继续引用已经合格的 v38 精确版本，不重复改写或消耗转换。新 STD-002 必须额外核对完整 189 页、原质量、全部包内图片引用及表格位置。三项都合格后，才继续 19 资料清洗准备、真实条款证据和物理 Chrome 审核发布及七项检索质量门。

项目 AGENTS.md §3 和施工图 §7 要求公共 Schema、计划外文件或范围先升级；用户已批准本提案，将该数据语义及下游接缝纳入本 change。实施不提交、归档或提前创建 verification。
