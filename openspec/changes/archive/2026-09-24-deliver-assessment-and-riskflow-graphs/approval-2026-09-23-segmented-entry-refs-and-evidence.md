# C30 收尾轮第二次批准记录（2026-09-23：两个分段入口的精确输入、真实 C24 证据与 C28 接线）

- 批准引用：`approval://riskflow/C30/finalization-2026-09-23-segmented-entry-refs-and-evidence`
- 批准来源：项目方在目标模式下的持续调度授权 + 本记录据 Finalizer 三次 escalation（`msg_3d2cacde84a5`、`msg_5be5cfbaa34e`、`msg_5208006e8231`）与问题 `msg_abc99a78ce17` 作出裁决。
- 前置事实：`approval-2026-09-23-finalization-assessment-basis-residual.md` 批准的依据字段、入口前门禁与冻结回归已按该记录完成并验证（契约/核心 34、评估/父图 45、真实 PostgreSQL 全链 9、适配器 44；typecheck/lint/deps:check/deps:policy/build/format:check/openspec:validate 全通过）。

## 一、两个分段入口的精确输入（有条件批准）

- **允许**在 `packages/contracts/src/ports/index.ts`（IP-01 已允许文件）为 `forecast-response` 与 `record-response-feedback` 载荷增加**可选**的精确引用字段，字段名与种类必须取自评估图实际要求的 frozen-ref 种类（例如预测路径所需的 route-decision、assessment-input-snapshot、spatial-scope；反馈路径所需的 assessment-input-snapshot），不得自造新种类。
- **可达性前置条件（逐字段）**：每个新增引用都必须在同一次收尾内给出「合法调用者能通过既有已授权公开路径取得该引用，或该引用由评估图自身在副作用前产出」的可运行证据。取证失败者，该入口的成功场景在本轮明确记为 **BLOCKED** 并在 `verification.md` 写明原因，不得为了凑绿而放宽门禁。
- **门禁语义**：缺任一必填冻结引用时，两入口必须在产生任何副作用之前以既有 `ENTRY_REFERENCES_INCOMPLETE` 稳定失败；不得推断、不得运行时解析「当前发布集/当前最新值」。
- **同步修订（同一 change 内）**：delta spec 的字段清单与相关 Scenario、`design.md` D-01 载荷表格、`implementation-plan.md` §3 允许文件与对应 IP-ID 行；只记录本轮加法与门禁，不重写其它结论。
- **禁止**：新增 `EngineeringDataQueryV1` 查询分支；新增 capability/角色/权限值；改动 C22/C24 写路径、migration、已归档规格；改动权重/矩阵/阈值/措施库；引入生产运行时依赖。若唯一可行路径落在上述禁止项内，按 BLOCKED 收口并另开 change。

## 二、IP-09 的真实 C24 同容器全链证据（必须补齐或如实受限）

- R2/S1 与 R6/S1 要求证明 `identify-and-assess` 多风险父图扇出与「资料段 → 评估」的同容器全链。现有 `apps/worker/test/risk-flow/acceptance.test.ts` 使用会抛错的 C24 `identificationRuntime` 替身，**不得**据此记 PASS。
- 本轮须在本轮证据内装配真实 C24 识别运行时（与 C30 评估图同容器）并跑通该场景；确实不可运行（缺少必要外部设施等）时，必须在 `verification.md` 以「不可运行 + 具体原因 + 已尝试的命令」记录为受限项，不得以绿色替身测试替代。

## 三、C28 `recordDecision` / `recordFeedback` 接线（仅限既有公开端口）

- D-04/IP-06 要求：人工采纳决定登记后交 C28 `recordDecision`，执行后经 C25 实际评估再交 C28 `recordFeedback`。当前 `apps/worker/src/assessment/graph.ts` 只调用 C28 `forecastResponse`/`calculateDeviation`。
- **允许**通过 C28 的**既有公开端口**接线上述两次调用，并保持人工作为采纳/执行决定的主体（图只负责登记与回读，不代替人决定）。
- **禁止**修改 C28 的契约、写路径、migration 或已归档规格。若既有端口不足以表达该语义，该部分按 BLOCKED 收口、写入 `verification.md` 未闭合项，并由另开的 change 承接；不得就地扩权。

## 四、收尾纪律

- 本轮为同一收尾轮次的**修复与补齐**延续，不是新增收尾轮次：普通缺陷在本 Task 内修复并回归；同一收尾轮次最多一次限定审计。
- 未闭合项一律写到 `verification.md`（含原因与已尝试命令），已完成项必须有本轮实际运行的命令与结果；不得把他人的自述或绿色替身测试当作证据。
