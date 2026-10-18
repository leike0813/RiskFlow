# MiniMax单函数结构化输出核查（D-90）

官方OpenAI兼容OpenAPI声明tools、function.parameters JSON Schema及tool_calls响应，未声明tool_choice或function.strict。M3.1的reasoning_effort允许low。工具调用仅为结果承载，不派发执行器；本地完整JSON/原Zod/领域校验仍必需。官方未承诺所有JSON Schema关键字或生成参数必然有效。

来源（2026-10-16核查）：

- https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json
- https://platform.minimax.io/docs/api-reference/text-openai-api
- https://platform.minimax.io/docs/guides/text-m3-function-call
- https://github.com/MiniMax-AI/MiniMax-Provider-Verifier/blob/main/m3_format_check/m3_text_tests.py

响应规范的finish_reason包含tool_calls，tool_calls[].function.arguments为字符串；官方M3测试部分容许stop，与规范描述不完全一致。本次接受这两种正常结束，但均须唯一正确函数结果及完整参数；没有调用的stop文本回答仍拒绝，length等非正常结束拒绝。官方测试对象为M3，并非M3.1独立实测。强制命名工具的测试另记录已知错误处理缺陷，因此不使用tool_choice。

选定：单emit_result工具声明及固定system要求，content空/null/缺省可接受；恰一次调用、正确名字/类型、完整arguments经原Schema，错误零自动重试。模型、low、预算及严格字段保持。官方核查未发送真实推理；工程实现及真实诊断待完成，不计业务PASS。

## 实施与真实诊断

实现新增显式function-call，保留旧模式和会话流语义；原网关测试新模式31/31通过。v96预检发现重复模型凭据引用被误当作主体秘密冲突，已仅去重模型credentialRef集合，DB/HMAC/OCR/模型类别隔离和secretFileRefs唯一/齐全保持；回归先红后绿。最终4套194/194通过，build/typecheck/lint/format/deps及全仓strict44/0/diff通过，见/tmp/riskflow-d90-complete-*与spec-final.log。

v97暂存已strict装配及tar比较通过：functional-workspace-20261016-d90-v97，制品83124d34ccccb712c7e05af6b0bd5d686bc6f5e5db540871f671999333df58b7、5,772,045字节。保留原模型部署，新建minimax-candidate-function-acceptance@physical-20261016-d90-v1；模型/low/上下文/数值预算、原检索及图版本保持，仅协议和相关精确策略引用升版。v96失败保留、未部署。

实际小Schema诊断logs/function-carrier-d90-v97.log：唯一emit_result、wire finish_reason=tool_calls，accepted=true通过本地Schema；输入485/输出43/合计528tokens，原响应b44cf7e3a1b8b06deffbaea688200b922a6d199fb63ef4b01f333f58808c3501。仅一次调用，无自动重试或领域写入。

实际原第三工序冻结五项上下文诊断logs/frozen-candidate-function-d90-v97.log：精确原modelContext版本a4361e1cbc4d01a0c4e3333161867c787ade7280711fc446776eb903fce6fd95，payload摘要9821c6e33914608e767765276093c559db65742939f6249d70633fc1c15c980f。一次调用得到4候选，原Zod及4条上限通过；input6674/output1521/total8195，输出3618字节。原响应d76512354343c16f714de620b0ff59d0e5c16cfea9690b1a8660c246e5cac85b。旧C08任务预算不变，不写候选或图状态，不复活v95终态。

两次诊断只证明协议与候选结构，尚未执行正式I5/I6或全链，不计业务PASS；后续须新正式批次取证。
