# 工作流显式绑定识别准备提案（D-51，已批准）

状态：用户已批准，纳入IP-19/IP-21，契约/核验/正式绑定及生产检查点接续已取证。完整业务终态仍受C24启动授权接缝阻断，见[实施报告](workflow-identification-preparation-binding-2026-10-15.md)及待批准[D-52](identification-start-authorization-scope-proposal.md)。

## 已复现的缺口

v55检索质量已7/7通过且代际active，详见[D-50报告](retrieval-relevance-review-2026-10-15.md)。继续原五资料父运行时，当前游标仍为`identification/waiting`，没有准备快照绑定或识别子运行。等待项由父图`identificationPreparationWaitingFor`生成，并非已受理的C08清洗任务；`stagePrepare`没有调用C11冻结准备。

独立准备`identification-preparation-50efff5ad17336023281c241aba94e153465e03a@1`已经完成。本轮用当前真实授权经C15/C04精确读取成功，其工程修订、空间集合及五份source-version与父运行冻结事实完全一致。工程仍有10个历史任务；没有新增清洗或模型调用。它原来属于独立清洗运行，不能据此宣称来自该父运行。现场证据见[契约缺口](workflow-preparation-binding-gap-v55.json)和[精确匹配](workflow-preparation-parent-match-v55.json)。

公共`ResumeCauseV1Schema`的`knowledge-ready`只接收`knowledgePreparationTaskRef`，映射内部`inputs-ready`后没有准备快照。向它额外提供快照或使用新的准备就绪原因，当前strict Schema均拒绝。D-49完成命令也不允许调用者替换父运行；其19资料准备不能代替本次五资料准备。直接调用内部resume或伪造inputs-ready会绕过公共契约与真实因果，不用于验收。

## 建议批准的契约与行为

1. 在现有`workflow.resume-run`的strict `resumeCause`联合中增加`{ kind: "identification-preparation-ready", identificationPreparationSnapshotRef }`。引用复用现有类型，命令仍必带`workflowRunRef`和`expectedStateVersion`；保留现有HTTP路由、WorkflowPort、结果DTO和`workflow.resume`能力。不新增端点、自由输入正文或客户端指定任务/来源/父运行字段。
2. C30先按原流程核验当前会话、工程、原运行主体及恢复权限；仅接受当前识别阶段的准备等待，检查预期状态版本和原冻结图版本。通过注入的C15精确读取接缝，在当前权限下核验正式准备及绑定的完成结果，C04完整读取并等待verified。准备的工程修订、完整空间集合与完整资料版本集合必须与父运行冻结事实相同，不能仅验证子集或名称。原运行冻结的监测输入继续沿原引用，不从本次准备替换或补造。
3. 该操作建立的是本次命令明确授权的新绑定；原清洗任务、独立父运行、准备快照、事件及审计全部保留。核验通过后复用已有内部`inputs-ready`、C03入口快照、审计和LangGraph检查点恢复路径，记录本次命令/当前操作者/精确准备引用。不把等待占位引用伪装成真实清洗任务，不伪造旧事件或重写原受理因果。
4. 缺少精确读取依赖、准备不存在、错工程/主体/空间/来源/版本、结果不成立、损坏、超限、当前撤权、游标过期、运行取消或终态均拒绝，不能推进或创建识别子任务。已绑定引用不可被另一准备覆盖；同命令重投沿原幂等回执与状态版本规则收口，并发只成立一次绑定及同一识别子运行。当前权限在重投时仍须复验。
5. 部署组合复用C15 `readExactPreparation`，由当前正式恢复命令派生既有`engineering-data.evidence-access`授权，源于真实会话及原运行绑定。不得放宽C06权限/期限或让客户端构造授权。绑定本身不创建清洗或模型任务、不改变原任务预算；后续识别按原正式策略与预算独立执行。

## 文件范围

| 文件 | 修改内容 |
| --- | --- |
| `packages/contracts/src/ports/index.ts`、既有`packages/contracts/test/module-interfaces-events-workflows.test.ts` | 增加恢复原因的strict分支，复用准备引用Schema，验证现有原因保持及额外字段拒绝。 |
| `apps/worker/src/risk-flow/runtime.ts`、`composition.ts` | 注入窄准备读取依赖，验证等待/冻结输入和当前权限，复用现有恢复、审计及入口快照路径。 |
| `apps/worker/test/risk-flow/runtime.test.ts`、`composition.test.ts`及同目录既有fixture（如需） | 复用现有运行测试，覆盖成功、错范围/状态/准备、缺reader、撤权、重投及并发边界。 |
| `scripts/deployment/composition/risk-flow.mjs`、`scripts/deployment/start.mjs` | 从现有C15组合注入精确读取，沿原受权包装器派生读取上下文。 |
| `scripts/deployment/risk-flow-composition.test.mjs`、`entrypoints.test.mjs`、`apps/api/test/http-shell.test.ts` | 验证宿主真实接线、公共HTTP strict分支和错误传播。HTTP生产路由已复用共享Schema，预期无需修改。 |
| 当前change的`design.md`、`implementation-plan.md`、`proposal.md`、`handoff.md`及`specs/domain/module-interfaces-events-workflows/spec.md`、`specs/platform/http-command-query-sse-shell/spec.md` | 批准后同步D-51、文件范围及恢复/拒绝场景；记录安全实机证据。 |

无新依赖、迁移、权限映射、C15收口改造、Web/UI或第二套工作流状态机。不修改主规格、旧结果或旧失败；不提交、归档、提前创建verification。若实施需扩大上述契约或文件范围，按实际缺口另行升级。

## 验证与续验

先扩展既有contract/runtime/HTTP/部署测试：匹配的独立准备经明确命令可绑定；16/19资料准备、缺少来源、异空间/修订、无权、错误等待或过期游标均拒绝。核验原图版本、准备引用和审计可重建，重投/并发无重复绑定或识别子任务，绑定前后清洗任务数与用量不变。拒绝路径不写业务推进事实，不能只以HTTP 200断言成功。

运行所属定向测试、8GiB build/typecheck、lint、相关format、全仓OpenSpec strict及diff检查。冻结新制品后，在现有物理Chrome当前会话通过正式恢复命令绑定上述原五资料准备；保存同次命令、游标、准备核验、审计及识别子运行引用。再继续RI/RA、规则集人工审核发布及后续业务取证，实际失败如实保留，不预判全链路通过。tasks仍5/19，按各任务全部行为与证据完成后再勾选。

## 批准依据

项目[AGENTS.md](../../../../AGENTS.md) §3要求“公共接口、Schema、事务、依赖或范围决定仍归design”，且“计划外公共契约/依赖/迁移/文件……必须升级”；[施工图](../implementation-plan.md) §7要求“新公共字段……范围外文件……须升级并补design”。本提案新增公共恢复原因并补充文件范围，用户已明确批准；D-50数据集正式使用的既有批准继续有效。
