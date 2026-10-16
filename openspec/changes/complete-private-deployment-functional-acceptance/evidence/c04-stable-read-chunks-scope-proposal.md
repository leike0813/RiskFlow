# C04多块读取字节稳定性修复提案

状态：已批准/已完成——生产修复与实机多块复验完成，纳入IP-19；D-43原文导入本身仍未完成，本提案不改变来源、质量、权限或预算。验证证据与日志索引见下文。

## 已复现问题（v36历史）

三份原件均以正确PDF头开头，磁盘摘要与C04登记摘要一致。正式转换却在调用MinerU前报MINERU_PDF_INVALID/header。经当前权限、完整消费及verified的正式C04读取验证：逐块即时复制的结果与登记摘要一致，保留原块并在EOF后拼接的结果不同，三份均复现。

根因是`packages/adapters/src/artifacts/filesystem-artifact-store.ts`的consume复用1MiB buffer，yield的是buffer.subarray视图；下一次file.read会改写上一块。转换器、模型原响应和部分其他读取方合法保留块后拼接，因此verified虽然校验了即时读取字节，调用方最后拿到的字节仍错误。已登记工件及磁盘原件未损坏。不能在每个调用方分别打补丁或让转换器忽略PDF头。

实例`reproduce-c04-multichunk-v36.mjs STD-001 STD-002 STD-003`记录三份同类结果；`assert-c04-multichunk-v36.mjs STD-001`实际exit 1，形成可复验红灯。安全证据见[standard-originals-ingestion-2026-10-15.md](standard-originals-ingestion-2026-10-15.md)。未输出原文、秘密或Cookie。v36记录保留为历史。

## 具体修复（已实施）

1. 仅在C04文件流输出边界将`yield chunk`改为`yield Uint8Array.from(chunk)`，每块交付独立字节。保留1MiB分块、有界读取、EOF长度/摘要、当前授权、审计、取消和verified时机；不添加第二摘要、额外缓存整个文件或新Schema。
2. 扩展既有`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`中的“read only resolves verified after complete streaming reads”，将输入改成超过2MiB且各区域内容不同的样本，继续用原collect保留块再拼接。核对首次读取、重放、完整性及取消；复用既有大文件性能/资源测试。拟应用的具体补丁见[c04-stable-read-chunks.patch](c04-stable-read-chunks.patch)。
3. 同步当前change的design/implementation-plan/handoff与C04局部delta及安全证据，将两个上述文件纳入IP-19。不开新change、不改主规格，不加依赖、迁移、权限或事务。

## 完成结果与日志索引（2026-10-15 D-44）

- 红灯：`/tmp/riskflow-d44-red.log`——扩展后的既有C04用例在修复前失败（1 failed，保留块拼接与原件不一致）。
- 回归：`/tmp/riskflow-d44-regression.log`——C04四套件含大文件资源基准195项全部通过。
- 工程门：build/typecheck/lint/format与strict 44/0、`git diff --check`全部通过，日志`/tmp/riskflow-d44-{build,typecheck,lint,format,strict}.log`。
- 实机复验：实例根`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`，新发布`functional-workspace-20261015-d44-v37`，配置`deployment-d44-v37.json`、清单`release-d44-v37.json`；制品SHA256`03759fb26c7632e30d5195dfc18ea58c9d5406dba3bb711a5095f498dfd2a240`、5742296字节；API运行中、Worker停止；HTTPS 19443、系统443未占用。
- 多块复验：`logs/c04-multichunk-final-green-v37.log`的STD-001/002/003（5/10/9块）保留块拼接摘要与原件一致（retainedMatches均true）；更早的`logs/c04-multichunk-green-v37.log`名为green但retainedMatches均false，不是成功记录，不得引用。v36失败保留，未重写。
- 安全结果：未改动权限、审计、取消、verified、1MiB分块、预算与事务；未输出原文、秘密或Cookie；无提交、归档、tasks勾选或verification。

## 验证与续验

生产修复已完成；D-43续验仍在进行：v37三份远端MinerU均done，本地转换均BLOCKED/TERMINAL_FAILURE（STD-001 MINERU_QUALITY_REJECTED，非空页97/99、原门1；STD-002 MINERU_PROTOCOL_INVALID layout-schema，官方3.4.4 chart类型不支持；STD-003 MINERU_MIDDLE_INVALID table-html-tag-unsupported，tag eq）。后两项及空白页策略尚未批准/实施，父Agent正在核实，本提案不代下最终方案结论。新19文档清洗准备/发布未开始，旧检索召回FAIL与tasks5/19保持。

## 授权原因（历史）

D-43已批准范围明确保持D-42生产代码，范围外文件须升级；`filesystem-artifact-store.ts`不在现有文件清单。项目AGENTS.md §3及施工图§7要求计划外文件先升级，所以当时仅保存具体补丁与失败证据，尚未修改生产文件或该测试。该升级随后获批为D-44，已按上述最小范围完成生产修复与实机多块复验并继续验收。
