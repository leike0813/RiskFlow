## 0. Execution Preconditions

主调度 Agent必须先完成并归档 C04 `deliver-content-addressed-artifact-store`，确认主 spec 与当前 `ArtifactStoreV1.put/open`、诊断工件、权限继承和 EOF `verified` 语义一致；随后审阅并提交本 change 的 planning checkpoint。主调度 Agent再只为 `packages/core/package.json` 与 `packages/adapters/package.json` 增加 `./model` export 并形成独立 checkpoint；C05 无新依赖，不修改依赖字段、根清单、依赖政策或锁文件。

实现允许新增 `packages/core/src/model/**`、`packages/core/test/model.test.ts`、`packages/adapters/src/model/**` 与 `packages/adapters/test/model/**`。实现 worker禁止修改 package manifests、`packages/contracts/**`、C03/C04 生产文件和 migrations、`apps/**`、`demo/**`、根配置/清单、`config/dependency-policy.json`、`pnpm-lock.yaml`、`openspec/config.yaml`、`openspec/specs/**`、归档 change 与其它活动 change；禁止安装依赖、提交、归档或启动 llama.cpp/开发服务。

## 1. Core Model Contract

- [x] 1.1 以前置 C02 的 `AuthorizationContextV1Schema`、`ModuleCapabilityV1Schema`、版本/工件/证据引用和 design §2～§3 为输入，在 `packages/core/src/model/schema.ts` 定义 strict V1 调用基座、三项请求/结果、对话 delta/receipt、部署快照和闭合错误 Schema；泛型结构化结果使用 Zod Schema 工厂，所有可序列化类型从 Schema 推导。运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`；不得复制 C02 字段、加入模型名/URL/任意参数袋、序列化 `AbortSignal`/Zod 对象或定义第二套业务记录。
- [x] 1.2 以任务 1.1 和 design §2/§11 为输入，在 `packages/core/src/model/gateway.ts` 定义只含 `completeStructured`、`embed`、`streamConversation` 的 `ModelGatewayPortV1`、双完成流 handle 与 `mapModelGatewayErrorToModuleError`，在 `packages/core/src/model/index.ts` 只导出稳定 port/Schema/类型。运行 `pnpm exec tsc -b packages/core/tsconfig.json --pretty false`；不得新增通用 invoke、health、模型管理、缓存、重试或 adapters 依赖。
- [x] 1.3 以任务 1.1～1.2 为输入，在 `packages/core/test/model.test.ts` 增加表驱动正反例，覆盖 strict 未知字段、project/actor/能力、预算收窄、结构化 Schema 工厂、Embedding 维度元数据、流终态、闭合错误与 C02 映射。运行 `pnpm exec vitest run packages/core/test/model.test.ts && pnpm exec tsc -b packages/core/tsconfig.json --pretty false`；测试只断言稳定代码/结构/语义，不锁完整错误或提示文案。

## 2. Frozen llama.cpp Deployment Adapter

- [x] 2.1 以 core model Schema、design §4 和 llama.cpp 官方 server 协议为输入，在 `packages/adapters/src/model/config.ts` 定义并深冻结部署配置：精确 deployment/server/model refs、expected build、非路径 alias、能力、context、Embedding dimension、timeouts、响应/输入/批量/输出上限与闭合采样策略；验证 URL origin、重复 ref、能力/维度关系和所有正整数边界。运行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false`；不得读取环境变量、暴露模型路径、引入通用 provider 配置或新增依赖。
- [x] 2.2 以任务 2.1、Node 24 原生 fetch 和 design §4～§6 为输入，在 `packages/adapters/src/model/llamacpp-model-gateway.ts` 实现 factory、配置 ref 解析、`/health`/`/props`/`/v1/models` 首用探测缓存、缓存失效和 chat/Embedding token 预检；关闭重定向，组合 caller/deadline/总超时 signal。运行 adapter 类型检查；不得自动重试、切换 deployment、记录 `/props`/model path，或以字符估算替代不支持的 token 预检。
- [x] 2.3 以任务 1、2.1～2.2、C04 `ArtifactStoreV1` 和 design §7～§8/§10 为输入，在同一 adapter 实现 `completeStructured` 与 `embed`：Zod→JSON Schema、固定请求映射、原始 HTTP diagnostic artifact 先 `put`、再 `open`+EOF `verified`、外部协议校验、单 JSON 值+原 Zod 复验、向量索引/数量/有限数/维度整批校验。运行 adapter 类型检查；不得先解析后选择性保存、返回部分向量、修补 JSON、归一化向量或把原始正文写日志。

## 3. Controlled Streaming and Failure Closure

- [x] 3.1 以任务 2 和 design §9 为输入，在 `llamacpp-model-gateway.ts` 实现有界单槽背压扇出、增量 UTF-8 SSE parser、event/总字节上限、单 choice、content-only delta、finish/usage/`[DONE]` 终态与 `completed` Promise；显式隔离 reasoning/tool/未知字段。运行 adapter 类型检查；不得无界缓冲、透传原始 SSE/思维链、在 C04 `put` 前 resolve 终态，或用合成完成掩盖断流。
- [x] 3.2 以任务 3.1、design §5/§9～§11 为输入，闭合 caller abort、deadline、请求总超时、stream idle timeout、网络异常、HTTP/协议/断流/上下文/结构/Schema/维度/C04 失败；收到部分流时先尝试保存 partial diagnostic artifact，再拒绝终态，服务不可达返回 `MODEL_SERVICE_UNAVAILABLE`。运行 adapter 类型检查；不得返回空成功、Mock 结果、其它部署结果、上游 message、URL/路径或未登记引用。
- [x] 3.3 以任务 2～3 和 design §10/§13 为输入，在 `packages/adapters/src/model/index.ts` 导出稳定 factory/config，加入只记录 capability/stage/result/计数/受保护 ref 的可观测回调 seam；默认不记录正文。运行 `pnpm exec tsc -b packages/adapters/tsconfig.json --pretty false && pnpm deps:check`；不得导出测试替身、内部 HTTP Schema、通用 logger、模型名或任意 metadata。

## 4. Deterministic Protocol Tests

- [x] 4.1 在 `packages/adapters/test/model/fixture.ts` 建立 test-only scripted fetch/SSE 与 ArtifactStore latch 替身，在 `llamacpp-model-gateway.test.ts` 覆盖部署探测、配置 model alias、token 预检、原始字节、同步 `put/open/verified` 顺序、Zod 复验和 Embedding 整批维度。运行 `pnpm exec vitest run packages/adapters/test/model/llamacpp-model-gateway.test.ts --testTimeout=240000`；替身不得进入 `src`/exports，也不得用协议替身冒充真实 smoke。
- [x] 4.2 扩展同一表驱动测试覆盖 caller abort、过期 deadline、总超时、idle timeout、connection refused、429/503、非法 error envelope、上下文超限、非法/截断 JSON、额外 Schema 字段、UTF-8/SSE 任意 chunk 边界、reasoning/tool 隔离、缺 finish/`[DONE]` 断流、partial raw ref、C04 失败和零自动重试。运行同一定向测试；断言稳定 code/ref/顺序，不锁完整正文、日志文本或内部函数调用顺序。
- [x] 4.3 增加授权、幂等和预算代表性用例：未授权在 fetch 前拒绝；请求不能扩大 deployment 上限；工件命令沿用 invocation/idempotency/父证据；同键不同响应暴露 C04 冲突；既有成功 ref 由调用方 fixture 证明恢复路径不再次调用 port。运行 core+adapter model tests；不得为每个错误文案复制低价值用例或实现生产缓存 registry。

## 5. Real llama.cpp Smoke and Gates

- [x] 5.1 在 `packages/adapters/test/model/llamacpp-model-gateway.smoke.test.ts` 增加显式 `RISKFLOW_LLAMACPP_SMOKE=1` 的真实服务测试：读取仅测试使用的精确 build/chat/embed/deployment 配置，复用 C04 真实 PostgreSQL+临时目录 fixture，实际完成 strict Zod object、双输入配置维度 Embedding、含多个 delta 的会话流和每项 raw artifact EOF 验证；另用明确不可达 origin 断言 `MODEL_SERVICE_UNAVAILABLE`。在操作者预先启动服务后运行 `RISKFLOW_LLAMACPP_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/llamacpp-model-gateway.smoke.test.ts --testTimeout=600000`，启用后缺配置/服务必须非零失败；测试不得启动/停止服务、下载模型、记录模型名/提示/正文或回退替身。
- [x] 5.2 运行 `pnpm exec vitest run packages/core/test/model.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts --testTimeout=240000 && pnpm exec tsc -b packages/core/tsconfig.json packages/adapters/tsconfig.json --pretty false && pnpm lint && pnpm format:check && pnpm deps:check && pnpm deps:policy`；随后检查 `rg -n "modelAlias|baseUrl|/v1/chat/completions|/v1/embeddings" apps packages/core -g '*.ts' -g '*.tsx'` 只出现允许的 core Schema/测试说明且业务无模型名/端点，`git diff --check` 为零。禁止为了通过门禁修改禁止区或增加依赖。
- [x] 5.3 由 Sol high 在固定 implementation checkpoint 上执行 `openspec validate deliver-llamacpp-model-gateway --strict --no-interactive` 和 `pnpm verify`，逐条核对三项 port、C02/C04 复用、先耐久、Zod 复验、controlled delta、无服务、错误、权限/幂等/预算/审计、真实 smoke 证据及 RI-S51/RI-S53/RI-S57～RI-S59 追踪，并把结论写入 `openspec/changes/deliver-llamacpp-model-gateway/verification.md`。首轮只读；批准范围内局部实现缺陷由当前仍活动的 Sol 任务直接修复并局部验证，规划/架构/权限/依赖/工具问题立即升级；不得提交、归档、启动服务或修改既定范围。
