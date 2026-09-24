# C36 规划范围批准记录（2026-09-23）

- 批准引用：`approval://riskflow/C36/scope-2026-09-23-quality-evaluation-and-browser-acceptance`
- 批准来源：协调端在本次受控调度会话中的裁决，依据已归档 C10/C13/C14 对本 change 的既有分配。
- 触发证据：`run_2c2660cf9d7b` 的 `msg_4ff81050a4e3`（escalation）、`msg_c478f9125ca3`（worker_done，未改文件，HEAD 保持 `0224c0f0`）。

## 触发事实

- 路线图只给出本 change 名称 `deliver-quality-evaluation-module`（wave F、lane `quality`、依赖 C15/C17/C20/C21/C22/C25/C27/C29）与依赖节点；change 目录初始为空，`orchestrated-delivery` 的 applyRequires 五项均缺失。
- 已归档 C10 `deliver-web-shell-and-interaction-primitives` design：「C10 无现成 DOM/browser 测试依赖，故不在本 change 增加 jsdom/Testing Library/Playwright；**C36 的跨能力验收再引入已批准的真实浏览器设施**」「**C36 负责跨页面自动化**，避免 C10 为一次测试引入三项依赖」。
- 已归档 C14 `deliver-monitoring-batches-snapshots-and-features` design：「C30/C36 需要页面查询时**使用其 own projection change 消费领域事实**」。
- 已归档 C13 `deliver-scanned-document-ocr` design：「**C36/C37/C38 使用真实脱敏样例与目标硬件证据**」。

## 本次规划必须闭合的范围

1. **质量评估模块**。以真实脱敏样例评估识别（C15/C17/C20/C21/C22）与评估（C25/C27/C29）链条的质量：至少覆盖准确率/精确率、覆盖度、跨来源一致性、可重放与可审计性等可测指标，并明确数据集构成、适用性元数据与规则/配置版本。结论必须由证据工件（C04 引用）与可重现命令支撑。无甲方真实样例时使用合成样本，并 MUST 在 change 中标注「合成样本，待甲方复核」。禁止复制领域算法、伪造或外推结论、把 LLM 输出当作硬期望。
2. **C36 自有页面查询投影**。按 C14 的边界消费领域公开接口与事实，不直读其它模块私表，不复制领域事实正文；公共契约、持久化与迁移决定由本 change 的 proposal/design 作出并写入相应工件（含最小授权与只追加语义）。
3. **跨能力真实浏览器验收设施**。引入真实浏览器测试设施用于跨页面/跨能力验收（C10 已明确把该设施留给本 change）。**新依赖 MUST 在 proposal 中写明名称、版本、引入原因与移除条件**；design MUST 决定其形态（默认作为测试期 devDependency，不进入生产运行时依赖），并给出可运行的验收命令。不得用 Mock 代替真实浏览器证据。
4. **边界**。不改 C10/C13/C14 既有语义与公共契约；不实现 C37/C38 的范围；新增 capability、角色或权限值，引入生产运行时依赖，或修改跨 change 公共契约语义，MUST 先 escalation。`packages/contracts` 的既有 Schema 只在必要且最小加法时改动，并在 design 中说明理由与兼容边界。

## 处置要求

规划者 MUST 先读取本记录，并以它作为批准输入；按 `orchestrated-delivery` 的 applyRequires 依次创建 proposal、specs、design、implementation-plan、tasks，把上述范围逐项映射为场景、IP-ID、允许文件清单与可运行验证命令。若认定其中任一项无法在本 change 已批准语义内闭合，或需要收窄范围（例如不引入真实浏览器设施、缩小评估数据集范围），MUST 在规划工件中显式说明取舍与后果并升级，不得静默缩小范围。本记录是批准凭据，不是设计结论；设计结论仍写入 `design.md`。
