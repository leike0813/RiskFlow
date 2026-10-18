# D-53 实施与 v59 预检

用户已批准 D-53 全部范围。已实现控制授权与领域执行分离、C24 逐操作授权、I1–I9 主动跨模块调用签发、恢复/取消来源元数据，以及正式准备读取器接线。执行授权通过既有因果关联签发，实际身份固定到运行上下文；回执和检查点继续引用真实 C06 上下文。没有把 workflow.resume 加入领域能力表。

## 已通过的验证

- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`、`pnpm typecheck`、`pnpm lint`、相关文件 Prettier、`git diff --check` 通过。
- C24 五套既有测试共 86 项：首轮 85 通过，撤权恢复用例仍期待旧的游标读取错误；按 D-53 统一先验控制来源后，嵌套图全套 7 项复跑通过。没有放松拒权断言。
- 最终 `vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/composition.test.mjs apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/identification/graph/runtime.test.ts` 四套 237 项通过，与上项有重叠，不累加。
- 真实初始化 PostgreSQL/C06/C04 用例覆盖：真实控制到领域签发；错 invocation/branch 在回执前拒绝；执行上下文沿既有关联读取下游；未注入逐操作签发仍拒绝身份错配；注入后真实 C04 写入成功；错主体/工程/范围/能力及撤权拒绝。
- `openspec validate --all --strict --no-interactive`：44 passed / 0 failed。

没有运行完整 verify、完整可见浏览器或 Electron 套件；工程证据不代表 RI/RA 终态通过。构建保留既有前端大 chunk 提示。

## 冻结与现场状态

API/Worker 已正常 SIGTERM 切换到 `functional-workspace-20261015-d53-v59`，继续 HTTPS 19443。制品 SHA-256 为 `0e28f42c5eaa9de95d92927346b6f696459d8b8920cadcd9646140a87b95b548`，5,757,960 字节。模型、策略正文、下游白名单、预算、检索输入及图版本与 v58 深比较一致。

冻结脚本已生成 bundle/config/catalog/manifest 后，收集 dirty diff 摘要触发 Node 默认输出缓冲上限。保留已有文件，以更大的临时输出缓冲完成摘要和只创建缺失的 identity，重新核对制品摘要与输入；未重打包或覆盖已有制品。

现场预检用物理 Chrome 当前真实会话，诊断宿主在 `identification-graph.start` 业务提交前拦截。它证实执行分支为 risk-identification.plan、单能力为 risk-identification.run，调用身份对应本次控制及稳定子命令，原五份资料经正式 reader/C15/C04 可读。未执行原父恢复、创建识别子运行或模型/Agent 任务。

工作区候选预检在原输入时刻 `2026-10-15T03:59:30.584Z` 成功解析旧检索发布 `knowledge-release-73655ae6-e721-41ae-9902-1873ae9bbc40@1`；该发布在 v13 策略与当前精确授权摘要下无活动代际。随后 v59 再次预检时，依据解析返回 TERMINAL_FAILURE；该失败原样留证，不能把较早成功当作 v59 依据通过。当前时刻、仍只持原 21 来源的独立依据预检则为 AUTHORIZATION_DENIED。D-53 接线预检通过的范围仅为控制/执行、正式准备读取和无子运行回读，I0–I3 正式业务仍未通过。

父状态保持 identification/retryable-failure，游标 `905945e60558ae62537c573790ca049b3d0de69f94958d891ca8ce8258fcee92`，Agent 任务 10，五资料准备绑定审计 1；重试预算未消耗。tasks 仍 5/19。

## 接续所需的新范围

1. 现有工作流下游策略缺少 C24 候选生成/修复校验/合并/路线/入库/复核读取分支；C21 基线和 C22 复核请求还需要各自既有用途分支。
2. 新检索发布使用的 19 份知识来源比原父的 21 来源多 3 份治理来源。原父 21 = 五份现场 + 原 16 治理；知识发布 19 = 原 16 治理 + 三份新增来源；两者并集为 24。不能在原父中悄悄追加来源或换发布时刻。
3. C21 内部知识读取先签一个身份、再向 C17 提交另一个逐发布身份；同时把工作项五份现场来源用作知识读取范围。仅增加外层 C24 授权不能修正这两处。当前全局按目标/业务时刻派生的读取身份还需验证跨控制调用的隔离与过期重读，禁止延长旧授权 TTL。

建议新建显式验收批次，闭合整批冻结权限与精确发布/检索代际，并修复所属读取接缝；旧父和旧检索报告均保留。具体可审阅范围见 [D-54 提案](identification-batch-scope-and-read-context-proposal.md)。D-53 明确不改白名单、冻结来源与时刻，因此这些内容须另行批准后实施。

安全原始事实汇总见 [v59 证据](identification-domain-authorization-v59.json)，不含秘密、原件正文或模型内部思考。无提交、归档或 verification。
