本 change 只登记已实现工程成果，IP-01–IP-16 保留原身份；工程回归、既有浏览器 harness 和网络 adapter smoke 不等于完整功能验收。剩余义务逐项移入 `complete-private-deployment-functional-acceptance/handoff.md`。完整跨 VM host 和最终实机取证仍交 C38。verification 按当前工作区编写，正式归档须再形成包含全部实现的固定检查点并完成所需审计，本轮不提交或归档。

## 1. 工程成员与冻结工具链

- [x] 1.1（IP-01）先建立 Desktop manifest/tsconfig（IP-09 文件），添加 workspace/TypeScript/依赖边界与精确依赖政策，按授权实施范围锁定依赖；验证：`pnpm deps:check && pnpm deps:policy`，完整构建在 9.1/14.2 核验。
- [x] 1.2（IP-01）登记施工图 §6 的新增命令、离线 Electron 构建路径与测试归属，保留统一工程验证；验证：`pnpm exec vitest run scripts/check-dependency-policy.test.ts`。

## 2. 部署契约、初始化与耐久审计

- [x] 2.1（IP-02）补齐 D-19 strict 部署配置契约、秘密加载及失败闭合的生产覆盖，完成安全配置示例；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts scripts/deployment/release.test.mjs`（33 项通过）；`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs`（51 项通过，含真实文件配置/清单/策略/数据集及按职责加载秘密的组合覆盖）。此项只证明配置入口，不代表完整宿主或业务验收。
- [x] 2.2（IP-02）完成 000056 运维状态/审计/租约/权限迁移与公开 PostgreSQL 接缝；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`，断言业务主体不能写运维表或改审计。
- [x] 2.3（IP-02）补齐显式初始化的受限秘密 LOGIN 密码与真实 checkpointer setup；首次管理员重放保留正确账号事实，业务启动不执行 DDL。验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`（14 项通过）；隔离实例初始化/重放与四运行角色登录报告见 `deployment/ACCEPTANCE.md`。运行组仅读迁移版本表，不可写迁移表或访问迁移锁。

## 3. 工件跨 VM 流访问

- [x] 3.1（IP-03）实现原 DTO 的有限流协议、mTLS、C06 复验与单独事务 referenceGuard 导出；验证：`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts`。
- [x] 3.2（IP-03）补齐背压/取消/截断/超额/超时/verified 和 data-VM service 生命周期；验证：`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`。

## 4. 真实策略、授权与窄读

- [x] 4.1（IP-04）按 D-20 补齐十六类不可变策略目录，修正 hybrid runtime 原 Schema，按类型推导读取结果并校验精确正文引用；受控根内目录复用有界文件读取，拒绝越界、链接及超额；合成验收目录只用于隔离实例。验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/entrypoints.test.mjs`（81 项通过），覆盖版本漂移、多个精确版本、正文不可修改及真实文件入口；已有检索 dataset/门禁工程证据保留。
- [x] 4.2（IP-04）实现 C06 原调用来源/当前授权适配和工程枚举窄读，保持宿主授权与正文权限独立；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts`。
- [x] 4.3（IP-04）完成 C19 所属模块精确成员读取、C24 正式路线 reader 及 C30 原 riskInputFacts 的精确空间配对接线；泛化 reader 的测试与实际通路分别登记，不增加第二套来源。验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts scripts/deployment/assessment-composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs`。真实 catalog/来源补证移交 IP-17/IP-19。

## 5. 全能力生产组合

- [x] 5.1（IP-05）完成 C15/C17/C20–C24 组合、共享五类 registry、一次绑定环、请求/任务/事件作用域及正式初始化库构造。验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs scripts/deployment/entrypoints.test.mjs apps/worker/test/agent-runtime/runner.test.ts`。真实模型业务终态移交 IP-19。
- [x] 5.2（IP-05）完成 C25/C27–C30 组合、所属检查点引用证明、冻结现场/校准上下文与 A3/A4 公共偏差登记时序。验证：`pnpm exec vitest run scripts/deployment/assessment-composition.test.mjs apps/worker/test/assessment/runtime.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts`。完整业务证据移交 IP-19/IP-20。
- [x] 5.3（IP-05）完成 API 全 ports、公开 adapter、完整 projection、C36 两阶段授权及请求 ALS scope；原“只有骨架”描述已按实际装配修正。验证：`pnpm exec vitest run scripts/deployment/api-ports.test.mjs scripts/deployment/entrypoints.test.mjs apps/api/test/quality.test.ts`。真实 HTTP 终态移交 IP-19。

## 6. API/Worker 生命周期与观测

- [x] 6.1（IP-06）完成显式监听、Agent 有界轮询与 12 类事件耐久 dispatch/ack/失败，重投复用原身份；验证：`pnpm exec vitest run scripts/deployment/lifecycle.test.mjs`。
- [x] 6.2（IP-06）接入真实四组件/模型观察、探针 AbortSignal 与整体截止，验证 drain 超时和安全日志；验证：`pnpm exec vitest run scripts/deployment/lifecycle.test.mjs packages/adapters/test/deployment/observability.test.ts`。

## 7. Web 唯一路由、通信与确认

- [x] 7.1（IP-07）合并 BrowserRouter/registry/深链别名/真实工程上下文，迁移 C36 到 /assessment/quality；验证：`pnpm exec vitest run apps/web/test/routing-context-actions.test.ts apps/web/test/quality.test.tsx`。
- [x] 7.2（IP-07）迁入业务 operation 编解码并扩展闭合 system operation，复用唯一 session/error/http；验证：`pnpm exec vitest run apps/web/test/api-client-openapi.test.ts`。
- [x] 7.3（IP-07）合并 project/system 确认、原管理回执和深冻结请求，维护重试身份/上下文取消/焦点；验证：`pnpm exec vitest run apps/web/test/confirmation.test.ts apps/web/test/focus.test.ts`。

## 8. 完整业务界面迁入 apps/web

- [x] 8.1（IP-08）按闭包迁入 C32 工程/资料/知识页面与图表，删除静态证据回退；验证：`pnpm exec playwright test -c playwright.config.ts --project=chromium read-only.spec.ts`。
- [x] 8.2（IP-08）迁入 C33 识别、结果、证据与复核页面，统一确认和来源权限；验证：`pnpm exec playwright test -c playwright.config.ts --project=chromium identification-review.spec.ts`。
- [x] 8.3（IP-08）迁入 C34 评估、预警、处置、预测/偏差/校准页面，统一冻结信封；验证：`pnpm exec playwright test -c playwright.config.ts --project=chromium assessment-warning-response.spec.ts risk-level-response-verification.spec.ts`。
- [x] 8.4（IP-08）迁入 C35 Agent/审计/报告/系统管理与停靠，保证慢读单请求和上下文清理；验证：`pnpm exec playwright test -c playwright.config.ts --project=chromium agent-audit-operations.spec.ts`。
- [x] 8.5（IP-08 / IP-07）统一真实测试 harness 与六份浏览器 spec，核对所有迁移深链及七导航，合并主题和重复组件；验证：`pnpm build && pnpm test:browser`，不得以零用例或 skip 通过。

  历史证据：`pnpm build` 通过；`pnpm exec playwright test --project=chromium --retries=0` 为 **88 passed / 0 failed**（88 条真实用例，无 skip、无零用例）。harness 是真实 PostgreSQL + 真实领域端口装配，六份 spec 全部迁到 `apps/web` 宿主。本次复验的慢读/切工程取消断言失败，最新结果见 verification G6，缺口移交后续 IP-21；此勾选只登记迁移与 harness 实现。

  收敛过程中修掉的宿主与夹具缺陷（都是真实缺陷，不是放宽断言）：
  - 宿主自解析路由但从不渲染 `<Route>`，迁入页面的 `useParams()` 恒为空，详情页在发请求前就失败。
  - 登录闸门用 `getByLabel("登录名")` 定位，账号与权限页有同名字段，登录后闸门永不消失。
  - 登录提交偶发落在控件接管之前，看着像登录失败；改为提交最多两次。
  - 健康探针幂等键固定但载荷逐次不同（`requestedAt` 取当前时间），C04 按幂等冲突关闭，工件存储被误报为不可用。
  - `AssessmentSourcePicker` 渲染期读 `window`，宿主外壳 SSR 直接崩溃。
  - 表单录入的发生时间向下截到分钟会落在采纳决定之前，C28 按 `response-execution-source-invalid` 关闭；改为向上取整到下一个整分钟。

## 9. Electron 薄桌面客户端

- [x] 9.1（IP-09）实现受控 HTTPS origin、独立会话、原生窗口与无特权本地连接状态，显式重试仅加载批准入口；验证：`pnpm build && pnpm exec vitest run apps/desktop/test/security.test.ts`。
- [x] 9.2（IP-09）完成 permissions/check、frame navigation/new window、证书与授权下载边界；验证：`pnpm exec vitest run apps/desktop/test/security.test.ts`。
- [x] 9.3（IP-09）实现三平台 electron-builder 离线打包程序、签名接线、缓存/介质预检、Chromium/Node 许可与 SBOM 收集，保持服务端发布独立；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`，检查平台配置、结构化调用和缺项拒绝。正式签名包制备归 C38 移交 F-01。

## 10. 三 VM HTTPS 与离线发布

- [x] 10.1（IP-10）实现发布制备/核验/离线导入与固定 systemd/data OCI 服务，固定网络和运行用户；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`。正式介质的 `pnpm deployment:verify` 归 C38 移交 F-03。
- [x] 10.2（IP-10）配置 Caddy 手工证书/无 ACME、同源 Web/API/SSE 与深链，API 无 SPA fallback；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`，核对配置生成、网络/路由边界与缺项拒绝；真实 HTTPS/端口隔离/深链取证归 C38 移交 F-03。
- [x] 10.3（IP-10）实现模型/OCR/驱动/系统介质身份、独立预算与资源分配的配置/清单核验，补齐发布说明；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`。实际介质身份冻结、真实协议和资源证据由 C38 移交 F-03/F-04 收口。

## 11. 维护窗口与同机逻辑副本

- [x] 11.1（IP-11）实现三 VM 本地停写回执、写者证明、全工程授权和互斥；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs`。
- [x] 11.2（IP-11）实现 manifest→dump→全部工件副本→耐久 descriptor，保留全部版本/审计/Outbox/checkpoint；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs`。
- [x] 11.3（IP-11 / IP-02）闭合容量/复制/审计失败、原操作续接与异载荷冲突；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs packages/adapters/test/deployment/config-operations.test.ts`。

## 12. 隔离恢复、人工切换与回退

- [x] 12.1（IP-12）构建隔离 DB/工件根，完整消费全部工程 reconcile，坏字节/缺失/快照漂移拒绝；验证：`pnpm exec vitest run scripts/deployment/restore.test.mjs`。
- [x] 12.2（IP-12）核对业务/审计/checkpoint/任务，真实重建双索引并通过原门禁后再待确认；验证：`pnpm test:deployment`。
- [x] 12.3（IP-12）实现精确目标人工激活、旧会话失效与兼容/不兼容回退，失败保留双根；验证：`pnpm exec vitest run scripts/deployment/restore.test.mjs`。

## 13. 桌面验收程序

- [x] 13.1（IP-13）实现桌面验收预检、已构建主进程启动和无 Node 权限的两条基础 e2e 定义。验证：`pnpm exec vitest run scripts/deployment/acceptance.test.mjs apps/desktop/test/security.test.ts apps/desktop/test/packaging.test.ts`；这里只完成程序基础，不记完整 Electron 实跑通过。完整场景实现及实跑移交 IP-18。

## 14. 当前验收文档与工程交接

- [x] 14.1（IP-14 / IP-16）完成验收手册、配置示例与工程证据索引，区分配置校验、单测、网络 smoke、正式终态与 C38 取证。验证：`pnpm exec vitest run scripts/deployment/acceptance.test.mjs scripts/acceptance/functional.test.mjs`。本次完整功能报告及索引移交 IP-20/IP-22。
- [x] 14.2（IP-01–IP-16）完成已实现/待实现范围拆分、保留场景工程证据映射、全勾工程任务和当前 verification 的归档准备记录。验证：两个 change 的 `openspec validate --strict --no-interactive` 与 `git diff --check`。该 checkbox 不代表固定实现检查点、独立限定审计、全仓门禁或正式归档已通过；后续功能收口移交 IP-22，原 change 的正式归档条件见 verification。

已有工程记录保留作为增量实施的参考，不代表本轮已重跑或新增功能已通过：

- 旧记录：`pnpm test` 2035 passed（129 文件），`pnpm test:deployment` 136 passed（13 文件），`pnpm test:browser` 88 passed / 0 failed、无 skip。
- 旧记录：build/typecheck/lint/format/deps 与本 change strict 校验通过。
- 后续 IP-22 的全仓门禁仍涉及仓库级 `openspec validate --all --strict --no-interactive` 的 11 份已归档规格超长正文告警。详见 `.scratch/strict-validate-remediation.md`；这是独立工程门禁问题，不能因延后硬件验收而忽略，也不能在本 change 中放宽门禁或顺手改写他人规格。
- 旧“HEAD 之上未提交实现即检查点”描述不构成交接依据；未来交接必须由主调度按实时 Git 和项目授权形成固定检查点。本轮只修改规划，不提交。

## 15. 网络 API 模型后端

- [x] 15.1（IP-15）按 D-23 完成同名 strict NetworkApiDeploymentConfigV1Schema 的 `openai-chat` / `ollama-embed` 判别配置、受限凭据、精确 registry 与服务/模型身份复验；保留 `ModelGatewayDeploymentConfigV1` 的 `llamacpp` / `network-api` 包装、原 llama.cpp 配置及 core port；验证：`pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/deployment/config-operations.test.ts`。
- [x] 15.2（IP-15）复用 C05 调用校验/持久化/预算逻辑：MiniMax OpenAI Chat Completions 仅提供结构化生成/会话流，Ollama 原生 `/api/embed` 仅提供 Embedding；实现显式结构化模式与 reasoningEffort、严格 Zod 收口、usage/预算、C04 去除 reasoning_content、闭合错误、取消/断流及不自动重试；验证：`pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts`。
- [x] 15.3（IP-15；依赖 15.1/15.2）以批准的真实 MiniMax 聊天与 Ollama Embedding 服务完成三能力 smoke，记录协议/模型身份、C04 响应引用和预算证据；验证：`RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`，配置/秘密路径见 D-22；缺真实服务、关键 skip 或协议替身不能计通过。

## 16. 已实现宿主与验收程序

已实现评分规则接缝补齐配置包来源互斥 Schema、正式 C04 来源与 C06/C18 校验，并使用原提交、复核、发布和依据解析；C19 Agent 编制另行闭合共享任务定义，不计本轮通过。C17 保持知识编制，生产装配使用同一 C16 的 C18/C19 策略与精确预测、校准、现场和报告绑定（D-20）。配置包验证纳入 16.1：`pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`，真实导入/发布由后续 IP-19 证明。

- [x] 16.1（IP-16 / IP-05 / IP-06）完成 synthetic-acceptance 合置本地 C04 宿主、显式 API/Worker 生命周期、网络模型选取、有界探针与正式 provision/身份续接。完整跨 VM 启动仍拒绝，交 C38 F-03。验证：`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/composition.test.mjs scripts/deployment/lifecycle.test.mjs scripts/deployment/provision.test.mjs`。真实 HTTPS/完整业务环境取证移交 IP-17/IP-19。
- [x] 16.2（IP-16）实现正式只读终态观察、安全 functional.json/functional.md 报告、同次引用匹配、查询硬预算及人审等待/超时/缺引用非 PASS。验证：`pnpm exec vitest run scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs`。完整运行输入及报告实跑移交 IP-19/IP-20。

## 最终交付移交 C38（范围登记，不计 C37 checkbox）

C38 `deliver-mvp-acceptance-and-delivery-evidence` 规划必须消费下表，先闭合自己的规格/施工图/任务，再按最终代码、配置和制品身份取证。后续功能 change 同步保留此表，不修改执行图；原工程 change 归档后移交表仍随归档工件保留。全部项目均为未来未完成事项，C37 功能 PASS 不证明它们通过。

| 移交 ID | 原任务 / IP | C38 必须完成的工作与证据 |
| --- | --- | --- |
| F-01 | 原 15.1 / IP-09、IP-13 | 原生构建机、正式离线缓存与批准签名；Windows NSIS、Linux AppImage、macOS DMG，核验真实 Electron/Chromium/Node、签名/公证、许可/SBOM；`pnpm desktop:package -- <target>` 的实际调用及产物须先独立核验。 |
| F-02 | 原 15.2 / IP-13 | 三平台真实安装与全部桌面行为取证。先把正式安装包身份校验及完整 Electron Playwright 场景接到交付命令；当前 `test:desktop` 单测不构成平台验收。 |
| F-03 | 原 15.3 / IP-10–IP-12、IP-14 | 正式证书、真实禁网三 VM、系统/驱动/llama.cpp/模型/OCR 全部介质；完整安装、后台任务、重启、损坏检测、索引重建、恢复与回退。先补齐真正执行场景的部署 smoke，核验既有发布/导入程序，不能用配置校验或环境标签通过。 |
| F-04 | 原 15.4 / IP-14 | 主 RTX 4090 24GB/128GB RAM 运行 Qwen3.8-27B，辅助 NVIDIA GPU 运行 MinerU 专用模型；按服务冻结设备 UUID、backend、量化/上下文与并发，embedding 默认保持独立 Ollama 主机。以相同标注样例核验云端/本地转换与模型质量，实测并行峰值显存/RAM、延迟/吞吐/排队、取消、容量和恢复耗时；先实现真实 benchmark，不虚报 RPO/RTO 或 SLA。辅助卡采购与制品许可依实测冻结；官网功能 PASS 不代替此项。 |
| F-05 | 原 15.5 / IP-14 | C38 Finalizer 按最终版本核对 F-01–F-04、合同交付材料及必要审计，生成 C38 最终 verification；任一正式证据缺失不得声明最终交付 PASS。 |

签名秘密、正式制包及 C38 现场验收不属于当前授权范围；网络服务、合置宿主与可见浏览器的完整功能验收由后续 IP-17–IP-22 实施。未来取证以当时真实输入为准，不沿用旧开发机硬件/环境缺件快照。
