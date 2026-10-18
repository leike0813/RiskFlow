# D-45 实施与 v38 标准原件重转

结论：已按批准范围完成 chart/eq 解析支持、来源专用空白页策略及正式新资料版本重转。STD-001、STD-003 转换并经来源页及关键字段核验合格；STD-002 已越过 chart 结构检查，在表格中的图片载荷处被原安全检查拒绝。三份尚未全部合格，不启动新的 19 资料清洗准备，不将原检索失败或 RI/RA 记为通过。tasks 保持 5/19。

## 实现与工程证据

生产代码仅改 `packages/adapters/src/engineering-data/document-conversion/mineru/official-normalization.ts` 和 `normalization.ts`：chart 及其 caption/footnote 沿原共享语义映射，图像载荷不作为文本；无属性 eq 保留字面公式文本，属性、危险或未知标签仍拒绝。测试使用对应两个既有测试文件，扩展原单元格测试并增加图表结构和公式标签安全边界。

先运行两套件取得 3 failed/25 passed：图表、eq 正文及 eq 属性错误分类复现，日志 `logs/d45-engineering/red.log`。修复后首轮三套件只剩测试对浮点坐标尾差的精确比较失败；将断言改为精度比较后，三文件 59 项全部通过，日志 `regression-final.log`。不是放宽生产坐标范围或原质量要求。

`NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck`、全仓 `pnpm lint`、`pnpm format:check`、全仓 OpenSpec strict 44/0、`git diff --check` 均通过。日志在实例 `logs/d45-engineering/`，保留 red、首轮 regression 和最终结果；最后格式调整仅改变 eq 标签集合排版。构建报告含原有大 chunk 提示，不影响构建成功。

## 冻结发布与新资料版本

实例根 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。API 通过 SIGTERM 正常关闭 v37 后启动 `functional-workspace-20261015-d45-v38`，HTTPS 仍为 localhost:19443，Worker 停止；配置 `deployment-d45-v38.json`，清单 `release-d45-v38.json`，制品 `workspace-runtime-d45-v38.tgz`：SHA256 `8c9530f7989f8edf0ac6752d9da593f9d0f37caf512ddecb49de852d710a7f46`，5991210 字节。该制品是本工作区验收快照，HEAD `31ad1a2c47a377f20179e0008241034c14a3bec5` 不包含累计 dirty，不能当作完整实现检查点。

转换部署引用为 `mineru-official-functional@2026-10-15-d45`，官网协议/模型、端点和资源预算不变。STD-001 新质量引用为 `physical-standard-original-v38-source-quality-STD-001@1`，非空页比例 97/99、关键字段覆盖 1；其余两份沿原质量引用，非空页与关键字段均为 1。清洗策略新引用 `physical-cleaning-policy@physical-20261015-d45-v1` 仅补允许的质量引用，Agent 预算和保留率保持原值。

沿原 C11 source-delivery 入口、同 sourceItemId 及原件/元数据工件登记新资料版本，保留原版本和失败；新 deliveryKey 生成同资料项下一序列，不直接 SQL 写业务事实。各项登记、转换配置和回执位于 `standard-originals-v38/STD-00N/`。

| 来源 | 新 source-version 实体（均 @1） | 转换终态 | 额外核验 |
| --- | --- | --- | --- |
| STD-001 | s_0b9bd233b248a06a6cd6d7bf494fd882 | COMPLETED/succeeded | 完整 99 页映射，97 页非空，空白页恰为 9、51，关键字段覆盖 1 |
| STD-002 | s_2d2d8387381b8e05ee38ade945a35c1f | BLOCKED/TERMINAL_FAILURE | table-html-rejected，pages[74].blocks[7] |
| STD-003 | s_2439a3741bc0bd916b8a40ec331efd97 | COMPLETED/succeeded | 完整 142 页且 142 页非空，无空白页，关键字段覆盖 1 |

成功转换实体为 `physical-standard-original-v38-convert-STD-001/003-convert@1`。STD-001 输出 1626 文本块、963 资料段；STD-003 输出 2069 文本块、1514 资料段。STD-001 的 conversion.statistics.pageCount 为 97（有内容页统计），完整物理页映射由 JSON-LD pageExtents 的 99 项核验，不把两者混为一谈。

验收脚本 `qualify-standard-conversion-v38.mjs` 通过当前用户、工程、资料及空间授权查询正式转换，受权读取 JSON-LD 和规范化诊断，完整消费并等待 verified；核对原件摘要、source-version、转换部署/质量策略、连续全部页映射、非空页集合及关键字段。结果是各目录 `qualified-conversion.json`，日志 `logs/standard-qualified-v38-STD-001-confirmed.log` 和 `logs/standard-qualified-v38-STD-003.log`。

核验脚本的早期版本曾使用写分支授权调用只读接口、误以为 foundation.artifactStore 暴露 readManifest，以及少读一层规范化诊断封装，均已修正；相关失败日志保留。这些是核验脚本错误，不作为新的产品权限、C04 或规范化缺陷。

## STD-002 新阻断

MinerU 批次 `14c83612-9970-4a88-acd3-2c77f7fb8f06` 到达 done；正式诊断工件 `conversion-diagnostic-physical-standard-original-v38-convert-STD-002-convert`，版本 `sha256:54c785f2e4514f8b19c96d24427565b0a2a38885d5a725d3f7fc6adaf3eb1631`，失败为 `MINERU_MIDDLE_INVALID` / normalize / `table-html-rejected`。

受权原始 ZIP 工件 `document-service-raw-response-physical-standard-original-v38-convert-STD-002-convert-attempt-65`，版本 `sha256:57a6161dbe076c89e10780bd5d66c8aedb700280f4b7e89be054c35484749fc1`。HTML 中除已支持 table/tr/td/eq 外还有 img；22 次出现包含 preproc/para 重复表示，不能当成 22 张独立图片。已检查的 img 仅含 src、使用本包 JPG 文件名、自闭合，无外链或 data URL。父 Agent 已查看从本次耐久 ZIP 提取的一张样本，是无文字的图形符号，不能推断为数值、文字或空值。

完整结构复核确认 22 次表示对应 11 张唯一图片，共 18500 字节，均在已验证包中唯一解析；全部 img 自闭合且仅含 src 属性。实例结构证据：`logs/standard-service-summary-v38-STD-002.log`、`logs/standard-table-tags-v38.log`、`logs/standard-image-fields-v38.log`、`logs/standard-image-resolutions-v38.log`，受限图片样本 `standard-table-image-sample-v38.jpg`。原响应和原件保持，未允许任意 HTML/图片网络访问、未跳过单元格或把未识别图形当作成功文本。

本次 D-45 明确保留 img 拒绝。处理表格非文本载荷需补充数据表达与下游可用性语义，另以具体方案升级；当前不修改该安全边界。新准备脚本 `prepare-standard-cleaning-v38.mjs` 要求三项正式 COMPLETED 且各自 QUALIFIED，当前条件未满足，尚未执行。不提交、归档或创建 verification。
