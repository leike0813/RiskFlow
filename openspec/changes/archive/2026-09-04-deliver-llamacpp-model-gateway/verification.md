# C05 独立验证报告

## 结论

**PASS（本地门禁与确定性协议验证）**。验证基于实现检查点 `2c5c50e`，并包含协调者同步的清单修复；实际验证工作树 HEAD 为 `91d3a7ca56aeecfbe7752420397c698aaf9d46c3`。真实 llama.cpp smoke 未执行：环境未显式提供 `RISKFLOW_LLAMACPP_SMOKE=1` 与预置服务，符合本次“不得启动或安装外部服务”的限制。

## 规格核对

| 核对项 | 结论与证据 |
| --- | --- |
| strict Zod DTO 与三方法 port | `packages/core/src/model/schema.ts` 使用 strict schema；`ModelGatewayPortV1` 仅含 `completeStructured`、`embed`、`streamConversation`。补强了部署 capability/embedding dimension、向量维度和错误 code/category 的一致性约束。 |
| C02 错误映射 | 授权、幂等、可重试与终态错误继续映射到既有 `ModuleErrorV1`；未复制 contracts。 |
| 配置、能力、版本与授权边界 | 配置验证 deployment/build/model refs、origin、alias、能力和上限；探测绑定 build/model/capability。父工件存在时必须通过注入式 preflight，缺失或拒绝均在 fetch/put 前 fail closed。 |
| AbortSignal、deadline 与 timeout | 调用方取消、请求超时和流空闲超时保持不同错误码；流消费者提前停止会取消生产并拒绝终态。 |
| token/context preflight | 输入字节、批量、输出 token、context 与 deadline 均在模型请求前检查，请求不能扩大部署上限。 |
| C04 artifact-before-reference | 非流式响应先 `put`、再 `open` 到 EOF 并等待 `verified`，之后才解析/返回；重读同样受响应字节上限约束。流式响应使用单槽背压，终态等待原始 SSE 工件持久化完成。 |
| embedding batch validation | 校验批量大小、返回数量、索引顺序、有限数值和每条向量的配置维度。 |
| bounded UTF-8 SSE | 使用 fatal UTF-8 增量解码、总字节/事件/行上限、单槽背压、受控文本 delta；拒绝非法字段、断流、finish/DONE 不一致。 |
| failure diagnostics | HTTP/协议/结构/流/持久化失败均返回闭合错误，模型原始字节或同权限诊断工件先耐久；授权与 preflight 失败不越权写诊断。 |
| smoke opt-in | 未设置环境变量时 smoke 文件为 1 skipped；显式 smoke 增加 structured/embed/stream 三类 raw artifact 的 EOF 与 `verified` 校验，测试本身不启动、下载或停止服务。 |

## 验证命令与结果

- `pnpm exec vitest run packages/core/test/model.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts --testTimeout=240000`：2 files passed，26 tests passed。
- `pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false`：通过。
- `pnpm lint`、`pnpm format:check`：通过。
- `pnpm deps:check`、`pnpm deps:policy`：通过，94 modules / 214 dependencies，无违规。
- `openspec validate deliver-llamacpp-model-gateway --strict --no-interactive`、`git diff --check`：通过。
- 端点/alias 泄漏扫描：`apps` 与 `packages/core` 无命中。
- `env -u RISKFLOW_LLAMACPP_SMOKE pnpm exec vitest run packages/adapters/test/model/llamacpp-model-gateway.smoke.test.ts --testTimeout=240000`：1 file / 1 test skipped，确认默认关闭。
- `pnpm verify`：构建、类型、lint、格式、全量测试、依赖边界与全部 OpenSpec 严格校验通过；13 files / 161 tests passed，1 file / 1 test skipped，OpenSpec 10/10 passed。

## 本地修复

- 增加父工件授权 preflight seam，并覆盖拒绝时 fetch/put 均未发生。
- 限制 C04 持久化后重读字节数；补充越界回归用例。
- 修正 SSE 空闲/请求 timeout 的错误分类，并让消费者提前停止可靠取消终态。
- 补强 embedding 与闭合错误 DTO 的跨字段一致性。
- smoke 增加三类原始工件可读、EOF 和完整性完成验证。

## 尚待外部证据

真实 llama.cpp build、模型制品和 C04 PostgreSQL fixture 由部署/验证环境提供后，仍需显式执行任务 5.1 的 smoke 命令；本次没有修改系统或以协议替身冒充该证据。
