# MinerU 跨页段落字段与对照记录

核查范围：官方 `opendatalab/MinerU` 固定 tag `mineru-3.4.4-released`，commit [`0dfc9460cd9ab693b9af60ae3fbffd7bc111b062`](https://github.com/opendatalab/MinerU/commit/0dfc9460cd9ab693b9af60ae3fbffd7bc111b062)。源码链接均固定在该 tag。本文区分源码事实与主 Agent 执行的本地对照；没有据此推断官网线上服务的私有部署必然使用相同实现或配置。

## 源码结论

MinerU 会把跨页文本并入前一页的段落块，但不会把 PDF 物理页合成一页。3.4.4 的输出文档将 `pdf_info` 定义为逐页解析结果，`page_idx` 从 0 开始；每页包含 `preproc_blocks`（预处理、未分段块）、`para_blocks`（分段后块）和 `discarded_blocks`（丢弃块）。见官方 [Middle JSON 字段说明](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/docs/zh/reference/output_files.md#L109-L140)。

合并过程进一步证实这一点：[`build_para_blocks_from_preproc`](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/utils/para_block_utils.py#L42-L45) 将每页 `preproc_blocks` 深拷贝为该页 `para_blocks`；[`merge_para_text_blocks`](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/utils/para_block_utils.py#L47-L80) 把各页块按 `page_idx` 汇总后寻找可拼接块。Hybrid 的 finalize 明确调用这两步，并可另行执行跨页表格合并：[Hybrid finalize](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/hybrid/hybrid_model_output_to_middle_json.py#L257-L272)。输出仍按页建立 `page_info` 并逐页追加到 `pdf_info`：[逐页输出构造](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/hybrid/hybrid_model_output_to_middle_json.py#L52-L62)、[逐页追加](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/hybrid/hybrid_model_output_to_middle_json.py#L192-L220)。

跨页合并发生时，后页文本行追加到前页块；被并入的块自身 `lines` 清空，并设置 `lines_deleted=true`。跨页行中的 span 设置 `cross_page=true`。字段名由 [`SplitFlag`](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/utils/enum_class.py#L110-L112) 定义；具体移动和标记逻辑见 [`_merge_text_block`](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/utils/para_block_utils.py#L319-L344)。因此：

- `cross_page: true` 表示该 span 是从另一页追加进当前段落块的跨页内容。
- `lines_deleted: true` 标记该块的行内容已被移出/合并；并不表示该物理页从文档删除。
- `para_blocks` 是分段及合并后的表示；`preproc_blocks` 保留合并前的逐页块，可用于对照原始页归属。
- `cross_page` 本身不携带源页编号。仅凭该布尔字段不能恢复具体源页；必须结合逐页 `preproc_blocks`、`page_idx` 和相应 span 内容追溯。源码的 `cleanup_internal_para_block_metadata` 清理内部辅助元数据，但没有清掉这两个分段标记：[清理入口](https://github.com/opendatalab/MinerU/blob/mineru-3.4.4-released/mineru/backend/utils/para_block_utils.py#L228-L232)。

这与“页 3、9 的 text block 有 `lines=[]`、`lines_deleted=true`，而 `preproc_blocks` 同页仍有文字，前页段落 span 带 `cross_page=true`”这一观察吻合。它描述的是跨页段落拼接留下的页内痕迹，不能单独解释为漏识别或物理页合并。某页 `preproc_blocks`、`para_blocks`、`discarded_blocks` 全空则仅能说明这些输出集合在该页为空；源码字段说明没有把它定义为页被并走或页内容成功识别的信号。

## 本地对照事实

以下是本轮提供的父侧实验事实，未由本报告重新运行；它们是临时样例诊断证据，不代表生产验收通过：

- 原生成器 `scripts/acceptance/generate-materials.py` 的 `_text_page` 将 `PyMuPDF insert_textbox` 返回值 `> 0` 当作 overflow，实际方向写反。父侧记录：同一短行返回 `28.98046875` 且文本已经写入。正常分页修正仅作用于临时副本，内容、字体、DPI 和端点参数保持不变；原样本未覆盖。
- 正常分页临时 PDF：`/tmp/riskflow-mineru-pagination-probe-i1d0l8tb/geology-report-correct-pagination.pdf`。父侧记录其原始 layout 为 1 页、13 个 `interline_equation`（表头加 12 行），仅去空白后的公式 content 含全部 12/12 个精确 GEO ID，assert 通过。父侧原始 ZIP 路径为 `/tmp/riskflow-mineru-smoke-fX6tjI`。
- 父侧另行记录：当前 official-normalization 枚举未覆盖 `interline_equation`，因此 layout-schema 拒绝该输出。关闭 formula 的 CLI 对照仍输出 LaTeX，而非 literal text；不构成解决建议，也不应据此降低质量门。
- 先前异常分页样例中，第 2 页的预处理、段落和丢弃块集合全部为空，第 3、9 页预处理有文字但段落文字被跨页追加；该现象与修正分页后的单页结果构成输入差异对照。正常分页对照恢复全部 12 个 ID，但尚不足以证明旧样本的每一处漏识别都由异常分页引起。

## 最小建议

修正合成样例生成器对 `insert_textbox` 返回值的判断，并以新版本保留修正后的样例及历史样例；保留源页标识/页索引到规范化输出的追溯；补齐实际返回块类型及内容的映射和关键字段验收，明确当前管线对 `interline_equation` 的覆盖缺口。不要把关闭公式当修复，也不要因样例生成错误而降低生产质量门。本轮仅诊断及记录证据，尚未修改生成器、生产代码或规格。

## 未证实事项

本轮没有取得官方 3.4.4 一手资料证明稀疏文本或字距较大时必然漏识别，也没有查实针对这种情况的专用诊断选项或关闭跨页段落拼接的公开开关；对此不作结论。官网精准 API 的私有部署细节与公开源码是否一致亦未证实。
