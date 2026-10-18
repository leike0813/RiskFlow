# 三份标准原件 v37 正式转换证据

结论：C04 多块读取修复及实机原件完整性复验通过；三份 MinerU 远端任务均完成，但正式转换均失败，尚不具备进入新清洗准备的资格。当前 tasks 为 5/19，RI/RA 未贯通，原检索召回失败仍保留。

实例根为 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。API 使用 `functional-workspace-20261015-d44-v37`；Worker 未运行，HTTPS 为 localhost:19443，系统 443 未被本次占用。原件来源、摘要与登记引用见 [原件登记证据](standard-originals-ingestion-2026-10-15.md)。本报告不包含原文、秘密、Cookie 或模型内部思考。

## 当前真实终态

三项 `standard-originals-v37/STD-00N/convert-report.json` 均为 BLOCKED/TERMINAL_FAILURE，转换身份为 `physical-standard-original-v37-convert-STD-00N-convert`。以当前用户、工程及精确资料范围受权打开 C04 诊断和原始 ZIP，完整消费后等待 verified，再检查结构。

| 来源 | MinerU 批次 | 正式失败 |
| --- | --- | --- |
| STD-001 | 05b1648c-1d73-4685-a443-eb83db5ab024 | MINERU_QUALITY_REJECTED / quality-threshold：nonEmptyPages=97、totalPages=99、minNonEmptyPageRatio=1；keyFieldCoverage=1，missingKeyFields=[] |
| STD-002 | ddd67f8a-83a9-4aa9-9621-e12f9ff0f31b | MINERU_PROTOCOL_INVALID / layout-schema；3.4.4/hybrid 中的 chart 结构超出现有官网 mapper 支持集合 |
| STD-003 | 55f5969c-4899-41e7-9bad-9be69842dda9 | MINERU_MIDDLE_INVALID / normalize：table-html-tag-unsupported，pages[20].blocks[7]，tag=eq |

诊断工件实体分别为 `conversion-diagnostic-physical-standard-original-v37-convert-STD-00N-convert`，版本如下：

| 来源 | 诊断 versionId |
| --- | --- |
| STD-001 | sha256:7ca8c42403f95191694a8087f12be06834e4b5825a2635e213cb68caa49ff908 |
| STD-002 | sha256:fd3c6ce396fef15742a9ec6fe38b59e98d70ded3aa5dc856e52fc180cf63ac2b |
| STD-003 | sha256:9d411ce7c3fde6b0736ebcaedcbcc59b081b0510d6485c1d6cb89e3ec61ee20c |

正式 ZIP 原响应工件仍保存于 C04；仅列精确身份，不复制正文：

| 来源 | 工件实体后缀（前缀 document-service-raw-response-） | versionId |
| --- | --- | --- |
| STD-001 | physical-standard-original-v37-convert-STD-001-convert-attempt-34 | sha256:26cbaafa899360dfbc44356b9621f3ea4ba839be15f5a443191495872b0d65ec |
| STD-002 | physical-standard-original-v37-convert-STD-002-convert-attempt-67 | sha256:530b3e3c598200e629aac60f804a7aa65f1d78f3d53352bf25df0555bbae9e45 |
| STD-003 | physical-standard-original-v37-convert-STD-003-convert-attempt-40 | sha256:384fcd36c5ff304589a3610c8797e4525cadc2c06481e80b2d03f9c58bff3dfb |

## 原件页与响应结构核对

STD-001 的 layout 中，第 9、51 页在 preproc/para 均无正文，discarded 仅有单字符；其它 para 空页仍有 preproc 正文，不应误分类为空白。通过物理 Chrome 的原件视图直接定位 page=9/51，等待非透明画布及连续三个 500ms 采样稳定后保存完整 Canvas。父 Agent 已查看两张完整页图，确认无正文，仅见扫描痕迹。来源仍为 C11 原件入口，未以转换文本冒充原件。

实例证据：`check-standard-blank-stable-v37.mjs`、`logs/standard-blank-stable-v37.log`、`standard-originals-v37/original-blank-stable-observations.json`，整页图为 `chrome-standard-001-page-9-stable-v37.png` 和 `chrome-standard-001-page-51-stable-v37.png`。早前快速翻页的截图仅作历史观察，不作为本次完整页分类依据。

STD-002 的 chart_body 使用 chart span，含 image_path/bbox、无文本 content；caption 使用真实 text span。共享 normalizeMineruMiddle 已区分图注文本和惰性图像载荷，缺口位于官网结构映射。STD-003 的表格标签统计为 table=52、tr=314、td=1176、eq=32，包含 preproc/para 的重复表示；所有 eq 开标签均无属性，不把该计数当成唯一公式数量。未打印正文或公式内容。

结构证据：`logs/standard-empty-pages-v37.log`、`logs/standard-layout-shapes-v37.log`、`logs/standard-chart-fields-v37.log`、`logs/standard-eq-fields-summary-v37.log`；相应脚本及受限 inspection JSON 保存于实例。

## 接续限制

已准备 [D-45 修复与来源质量提案](mineru-layout-and-source-quality-scope-proposal.md)，尚未修改这两个解析器或原质量策略。新清洗、19 份知识准备和发布未开始；`prepare-standard-cleaning-v37.mjs` 的三份转换完成断言当前不能通过，不执行它来绕过失败。后续必须保留旧失败并使用正式新资料/部署/策略版本，不能只换命令身份覆盖历史。
