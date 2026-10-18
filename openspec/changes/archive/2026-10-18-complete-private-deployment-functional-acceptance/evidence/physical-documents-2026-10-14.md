# 五格式资料实机取证（2026-10-14）

状态：五格式登记、正式转换、质量复验和新正式清洗通过。物理Chrome现已显示5份清洗可用及任务完成；最新v5运行、16份治理资料转换和清洗阻塞见 [续接证据](visible-read-and-docx-2026-10-14.md)。下文保留五格式阶段原身份与失败历史，完整功能未通过，tasks仍1/14。

## 来源和真实转换

使用 `references/acceptance/mineru-v2/manifest.json` 中的五个开发样本，标识为“合成样本，待甲方复核”。未向模型提供 expected、scenarios、报告或检索相关性标签。

先通过正式 C06/C11 接口登记根空间修订和适用性快照，再用既有 `runProvisionV1` 完成原文/元信息 C04 put、C11 source-delivery 和文档转换。所有引用来自本次实例的实际回执；没有直接 SQL 播种业务。

每个样本使用独立的 `physical-mineru-source-checklist-<样本>@2` 质量引用，非空页比例和关键字段覆盖率均要求 1。解析由官网精准 API v4 完成，实际输出 producer 为 MinerU 3.4.4；不把它记作 C38 的 MinerU 4.0.12 离线交付。

| 样本 | 成功转换运行 | 关键字段 | 同块/同行及页码检查 | 正式资料段 |
| --- | --- | ---: | ---: | ---: |
| DEV-text-pdf | physical-convert-DEV-text-pdf-v4 | 12 | 6 | 8 |
| DEV-scan-pdf | physical-convert-DEV-scan-pdf-v3 | 31 | 12 | 15 |
| DEV-png | physical-convert-DEV-png-v3 | 3 | 2 | 4 |
| DEV-jpeg | physical-convert-DEV-jpeg-v3 | 3 | 3 | 5 |
| DEV-docx | physical-convert-DEV-docx-v3 | 8 | 2 | 3 |

五份转换均为 `succeeded`，共 57 个关键字段、25 项同块/同行及定位检查、35 个资料段。PDF/图片各核对 1 页；DOCX 按既有契约核对无页码身份，未虚构物理页。每份正式转换具有 JSON-LD、资料段集合和审计引用。

以当前受权 C04 `open` 完整消费并等待 `verified`，复验五次成功转换的 70 份原始 HTTP 响应工件、5 份 normalization 诊断和5 份 JSON-LD。复用生产规范化器重放已保存 layout ZIP，运行既有 `verifyMineruAcceptanceSample`，核对所有样本字段、记录关联和页码；没有用不同运行的临时响应替代正式工件。

## 保留的失败与复验

首轮脚本把原文和元信息用途写成 `synthetic-source-*`，正式 C11 登记要求 `engineering-data.register-source-delivery`，因此被 C04 拒绝。旧工件/配置/失败回执保留；修正输入用途后以新工件身份登记，未改变 C04 ACL。

文本 PDF 首次正式转换 v3 的 120 次轮询均返回 HTTP 200、API code 0、`waiting-file`，最终 `MINERU_POLL_BUDGET_EXHAUSTED`。121 份原始响应及失败诊断已持久化并复验。对同一签名地址再次上传同一字节返回 HTTP 200 和 ETag，诊断查询仍为 `waiting-file`。该轮始终记为失败。

其它四类格式通过后，文本 PDF 使用相同来源、策略、模型协议和预算独立复验为 v4，约13秒完成。旧失败未改写。当前不能断言首轮官网异常的服务端根因；[官方上传文档](https://mineru.net/apiManage/docs)支持当前无额外 Content-Type 的 PUT 方式，未据此修改协议或增加预算。

## 物理 Chrome

`DISPLAY=:0` 上原可见 Chrome，受信任入口仍为 `https://localhost:19443/`。实际资料目录显示五份“解析通过、未清洗”，正式 source-catalog/context-read 为 HTTP 200。点击文本 PDF 的真实来源进入资料详情，显示8个正式资料段；source-segments 窄读由页面执行。

实例保留 `chrome-documents-five-parsed.png`、`physical-documents-five-parsed.json`、`chrome-document-text-pdf-segments.png`、`physical-document-text-pdf-segments.json`。本次资料目录刷新后保留原深链，正式会话和两个工程查询为 HTTP 200；不把早先自动化标题等待错误记作产品缺陷。

## 清洗与运行配置

清洗策略 v1 只允许准备阶段的旧质量引用。本次新建策略目录 `physical-policy-catalog-20261014@physical-20261014-v2` 与清洗策略 `physical-cleaning-policy@physical-20261014-v2`，仅允许上述5个实际质量引用，预算、模型、文档/段保留比例不变；v1 文件保留。

当前 API/Worker 已切换到实例 `deployment-c04-v3.json`（release `functional-workspace-20261014-c04-v3`）；`deployment-document-quality-v2.json` 保留为上一版身份。旧 API/Worker 接到 SIGTERM 后均正常结束、未结算计数为0；新进程日志为 running。此配置加载只证明受控实例续接，不替代 task 5.2 的业务提交/重投/检查点恢复义务。

以物理 Chrome 原会话经正式 HTTP 提交五资料 `identification-preparation`，返回等待中的必经清洗任务。首次任务终态为 failed / `AGENT_MODEL_FAILURE`，模型调用1次、输入输出 token 为0、活动墙钟274 ms；该失败回执与预算保留。IP-19 修复后新任务 `data-cleaning-task-50efff5a…` 完成：5个输入 available、0 排除，结果 `data-cleaning-result-50efff5a…`（sha256:e3f9e23d…），原命令重放得到 `identification-preparation` 准备快照；实施与验证见 [C04 预检与清洗取证](c04-preflight-and-cleaning-2026-10-14.md)。

模型父工件预检的错误用途已用真实输入工件、禁止网络的宿主复现定位并已修复；范围补充见 [范围补充提案](model-parent-preflight-scope-proposal.md)。物理任务详情仍持续显示列表读取中，正式同会话详情查询能读实际终态；该UI观察仍未闭合。

追加只读取证：任务详情页面发起的 `agent-task.read` 列表查询返回 HTTP 200、1个真实任务，包含上述精确身份；页面仍显示列表读取中。相关截图和 `cleaning/physical-list-response-*.json` 保留。当前源码的 `AgentTaskProvider` 在切工程时递增 `generationRef`，却将 snapshot 重置为 generation 0；`load` 只有 snapshot generation 匹配当前代际才更新。这与现象一致，不把它混作模型预检缺陷；修复已获授权（见 [可见读取范围补充](visible-read-scope-proposal.md)）。

## 受控证据索引

实例根为 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`，不提交秘密、Cookie、签名上传地址、业务正文或模型思考内容。

- `documents/<样本>-purpose-corrected/`：实际质量配置、put/register/convert 输入与回执、inspection 安全索引；文本 PDF另有 recheck 配置/回执及上传状态观察。
- `documents/<原样本>/`：原用途错误导致的失败记录。
- `document-quality-binding-v2.json`、`data/policies/catalog-document-quality-v2.json`、`deployment-document-quality-v2.json`：实际新版本和Schema/绑定校验。
- `api-document-quality-v2.log`、`worker-document-quality-v2.log`：当前进程日志；旧日志保留正常停机记录。
- `cleaning/`、`cleaning-c04-v3/`：原命令、原失败终态/预算、窄范围复现与修复后复现，以及新清洗命令、终态、验证结果与准备快照回执；没有重新激活原失败任务。

未运行完整 Electron、RI/RA业务终态、完整功能报告或故障恢复；治理来源转换已启动，前2份治理 docx 转换 BLOCKED、其余未跑（见 [C04 预检与清洗取证](c04-preflight-and-cleaning-2026-10-14.md)）；未提交、归档或创建verification。
