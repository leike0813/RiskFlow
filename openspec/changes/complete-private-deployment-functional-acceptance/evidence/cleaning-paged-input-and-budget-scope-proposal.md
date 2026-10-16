# 清洗定位分页与累计预算补充提案

状态：用户已批准提案，并明确授权提高新任务预算、按实际工作量定额。D-35 已实现，16份治理资料在 v9 正式清洗完成，结果与准备快照经 C04 核验。新预算在启动前冻结为新策略版本，旧任务及其上限不变；实跑证据见 [D-35取证](cleaning-paged-budget-2026-10-15.md)。

## 已核实事实

- 原任务 `data-cleaning-task-8f153fbb8f2c132fe5f1af0ed57658f345b4c368@1` 经原Worker接口收口为授权过期失败，原预算和644次历史保留。
- v6任务 `data-cleaning-task-b3c021bf76f27f00f5a5ff7c8637dd345be053e7@1` 在模型调用前触及64KiB消息上限，以预算失败终止；模型/工具均0，没有空转。
- 无损前缀及种类分组保留16份资料的全部595个段定位，定位正文由64,471降到22,959字节，逐项还原检查通过。v7任务 `data-cleaning-task-9d54501390138950ca726f4e26f62a8986bf5af5@1` 完成模型→真实资料段工具→受权观察读取→第二次模型调用。
- 两次官网回执实际输入7,793+8,635=16,428 token，超过原累计12,288；上下文合计17,267超过16,384。第二次行动申请的剩余输入额度为4,495。原core结算以 `AGENT_BUDGET_EXHAUSTED / budget.settle.inputTokens` 拒绝，已使用真实C04回执和原reservation只读复现。
- 原C03将该领域异常包装为持久化异常，Worker再泛化为工具错误；D-34已在C08所属事务接缝保留已知Agent错误，事务回滚不变，真实数据库回归通过。Worker失败路径也已保留行动回执引用。
- 原失败结算只记录第二次模型调用次数，台账仍显示输入7,793。真实原响应的完整用量仍保存在C04，不能把这个台账数字当作总消耗。继续重投整份清单不能解决累计预算问题。

## 提议的最小补充

1. 清洗初始消息提供全部冻结资料的精确身份、种类及规模；通过新增的受限 `read-cleaning-preparation-catalog-slice` 领域动作按指定冻结资料及offset列举段定位，返回nextOffset。每页继续使用原 `maxSegmentsPerRead`，不新增预算数值；toolPolicyRef与提示模板冻结新版本。资料正文继续只走原切片工具。清单和全部来源保持在原冻结输入中，不截断清单、不拆任务绕过预算，也不给模型通用工件或数据库工具。定位工具只读、可幂等恢复。
2. 结构化模型请求补充本次行动的输入和上下文token额度。可信Worker从冻结的新版本累计台账计算剩余额度；网关采用请求额度与部署上限的较小值，沿已有保守token上界及真实usage核验，在联网前拒绝超限。输出继续使用已有maxOutputTokens，模型身份不变；新任务预算按用户补充授权提高。
3. core预算结算仅在预算失败终态允许记入实际已发生的超额usage。C08 `failAction` 保存真实用量和回执，仍转为不可重试终态；正常完成和后续reserve继续严格拒绝超限。Worker即使解释候选或结算失败，也保存已获得的模型usage。此举是如实记账，不是增加可用预算。

## 拟升级的文件范围

| 接缝 | 文件 |
| --- | --- |
| 清洗动作、受限工具和消息 | `packages/core/src/engineering-data/cleaning/schema.ts`、`service.ts`、既有 `packages/core/test/engineering-data/cleaning.test.ts`；D-34的cleaning runtime/store及其既有测试；必要的同目录fixture |
| 行动额度与失败结算 | `packages/core/src/model/schema.ts`、`packages/core/src/agent-runtime/runtime.ts`、既有 `packages/core/test/model.test.ts`、`test/agent-runtime/agent-runtime.test.ts`；D-34的runner/C08 adapter及既有测试 |
| 网关预算 | `packages/adapters/src/model/model-gateway-runtime.ts`、`network-api-model-gateway.ts`、`llamacpp-model-gateway.ts`及对应既有网关测试 |
| 合置装配和取证 | `scripts/deployment/start.mjs`、既有entrypoints测试；本change design/implementation-plan、清洗/共享Agent及模型网关delta、证据；实例中新版本策略/发布配置 |

不增加依赖、迁移或业务HTTP字段，不修改权限策略、业务来源或原质量比例。按用户补充授权提高新版本预算，数值与测算记录在D-35及实例策略中；运行中不自动扩容。新增内部领域动作和模型port字段，先补施工图与delta，再实施。既有过预算失败及其台账保留，不回填修改旧事实；新运行使用明确的新版本。

验收边界：定位分页仅返回冻结集合内的精确身份；集合外、错误cursor、撤权、超页及损坏拒绝；工具计入冻结的新版本次数/对象/字节预算；联网前剩余额度不足时零外部调用；正常超限不能完成；失败超额实际用量只记账并终止；重复领取不继续。随后用原16份来源、原质量与已批准的新版本预算正式清洗，取得同次清洗结果及准备快照后继续治理和RI/RA取证。局部清洗成功不勾选包含完整业务义务的task、不计完整功能PASS。

升级依据：[implementation-plan.md §7](../implementation-plan.md)规定“新公共字段、迁移、权限、事务、依赖、范围外文件、前置语义漂移或 CLI 不存在须升级并补 design”。D-34批准边界另明确“不改公开DTO/HTTP、迁移、权限、依赖、白名单或预算”；新增领域动作、模型port字段与core结算文件超出该边界，因此等待本次具体授权。

本轮使用的[openspec-apply-change技能](/home/joshua/Workspace/Code/JavaScript/RiskFlow/.agents/skills/openspec-apply-change/SKILL.md)也明确要求：“When a task needs work beyond what the spec describes, surface the added scope and pause”。此次暂停依据上述明确范围要求，不是将范围内普通缺陷另行请示。
