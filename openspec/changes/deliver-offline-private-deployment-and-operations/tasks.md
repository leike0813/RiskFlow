当前剩余实施顺序为 15（网络模型）→16.1/16.2（真实宿主与验收程序）→13.1（当前平台桌面行为）→14.1（验收文档/证据口径）→16.3（真实功能取证）→14.2（工程交接）。Finalizer 随后完成当前范围 verification 与必要审计。最终签名、三平台、禁网三 VM 和 4090 取证移交 C38，不计入 C37 checkbox 或收口门禁。

## 1. 工程成员与冻结工具链

- [x] 1.1（IP-01）先建立 Desktop manifest/tsconfig（IP-09 文件），添加 workspace/TypeScript/依赖边界与精确依赖政策，按授权实施范围锁定依赖；验证：`pnpm deps:check && pnpm deps:policy`，完整构建在 9.1/14.2 核验。
- [x] 1.2（IP-01）登记施工图 §6 的新增命令、离线 Electron 构建路径与测试归属，保留统一工程验证；验证：`pnpm exec vitest run scripts/check-dependency-policy.test.ts`。

## 2. 部署契约、初始化与耐久审计

- [ ] 2.1（IP-02）补齐 D-19 strict 部署配置契约、秘密加载及失败闭合的生产覆盖，完成安全配置示例；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`。已有秘密加载/失败闭合工程能力与测试通过记录保留；因 D-19 部署代码缺少配置契约覆盖而重开，不能将原测试记录当作该义务完成证据。
- [x] 2.2（IP-02）完成 000056 运维状态/审计/租约/权限迁移与公开 PostgreSQL 接缝；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`，断言业务主体不能写运维表或改审计。
- [x] 2.3（IP-02）补齐显式初始化的受限秘密 LOGIN 密码与真实 checkpointer setup；首次管理员重放保留正确账号事实，业务启动不执行 DDL。验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`（14 项通过）；隔离实例初始化/重放与四运行角色登录报告见 `deployment/ACCEPTANCE.md`。运行组仅读迁移版本表，不可写迁移表或访问迁移锁。

## 3. 工件跨 VM 流访问

- [x] 3.1（IP-03）实现原 DTO 的有限流协议、mTLS、C06 复验与单独事务 referenceGuard 导出；验证：`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts`。
- [x] 3.2（IP-03）补齐背压/取消/截断/超额/超时/verified 和 data-VM service 生命周期；验证：`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`。

## 4. 真实策略、授权与窄读

- [ ] 4.1（IP-04）按 D-20 补齐全类型不可变策略目录，修正 hybrid runtime 原 Schema，按类型推导读取结果并校验精确正文引用；合成验收目录只用于隔离实例。验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts`，覆盖版本漂移、多个精确版本、正文不可修改；已有检索 dataset/门禁工程证据保留。
- [x] 4.2（IP-04）实现 C06 原调用来源/当前授权适配和工程枚举窄读，保持宿主授权与正文权限独立；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts`。
- [ ] 4.3（IP-04）补齐 C19 正式配置成员、C24 路线集与 C30 精确空间配对的 catalog/reader 生产证据；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts`，错版本/异空间/无权均拒绝。已有精确 reader 工程能力及测试通过记录保留；因 catalog 来源覆盖及必要生产证据不足而重开。

## 5. 全能力生产组合

- [ ] 5.1（IP-05）完成 C15/C17/C20–C24 的真实生产组合接线、五类共享 Agent registry 与一次绑定环；验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs`。保留已验证基础 adapter/registry 能力与既有测试记录；IP-05 composition 当前只有骨架，生产接线义务重开。
- [ ] 5.2（IP-05）完成 C25/C27–C30 的真实生产组合接线及冻结现场/偏差上下文，禁止 unwired seam；验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs`。保留已验证领域 adapter 能力与既有测试记录；IP-05 composition 当前只有骨架，生产接线义务重开。
- [ ] 5.3（IP-05）完成真实 API 全 ports/公开 adapter 接线，并保持完整 projection 与 C36 两阶段授权；验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs apps/api/test/quality.test.ts`。保留已验证 API projection/授权能力与既有测试记录；IP-05 composition 当前只有骨架，生产接线义务重开。

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

  证据：`pnpm build` 通过；`pnpm exec playwright test --project=chromium --retries=0` 为 **88 passed / 0 failed**（88 条真实用例，无 skip、无零用例）。harness 是真实 PostgreSQL + 真实领域端口装配，六份 spec 全部迁到 `apps/web` 宿主。

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

- [ ] 13.1（IP-13 / IP-16）补齐当前可用平台上真实 Electron 的共享对象、登录/上传下载、撤权、证书拒绝、导航、SSE 重连及窗口关闭后服务端任务继续场景；使用已构建主进程和功能 HTTPS，不要求正式安装包/签名/三平台。验证：`pnpm build && pnpm exec playwright test -c playwright.desktop.config.ts`。已有预检和无 Node 权限启动测试保留，当前仅两条用例不足以证明完整行为，故重新打开；多平台正式安装归 C38 F-02。

## 14. 当前验收文档与工程交接

- [ ] 14.1（IP-14 / IP-16）同步当前功能验收手册、配置示例及证据索引，明确配置校验、单元测试、真实网络/业务终态和 C38 最终取证各自用途；验证：`pnpm exec vitest run scripts/deployment/acceptance.test.mjs scripts/acceptance/functional.test.mjs`，并核对实际报告引用。本项重新打开：旧 smoke/benchmark 入口只校验配置，不能记为实际验收程序已完成。
- [ ] 14.2（IP-01–IP-16；依赖全部当前任务）核对九份 delta 的逐场景当前证据、网络后端及真实业务终态，完成工程验证并形成经主调度审阅的固定实现检查点交给 Finalizer；验证：`pnpm verify && pnpm test:browser && pnpm test:deployment`，以及 13.1/15.3/16.3 的真实报告。Finalizer 按当前功能范围生成 verification、完成必要审计；当前任务与审计通过后可集成/归档，不以未来 F-01–F-05 材料缺项阻塞。

已有工程记录保留作为增量实施的参考，不代表本轮已重跑或新增功能已通过：

- 旧记录：`pnpm test` 2035 passed（129 文件），`pnpm test:deployment` 136 passed（13 文件），`pnpm test:browser` 88 passed / 0 failed、无 skip。
- 旧记录：build/typecheck/lint/format/deps 与本 change strict 校验通过。
- 原 14.2 未完成还涉及仓库级 `openspec validate --all --strict --no-interactive` 的 11 份已归档规格超长正文告警。详见 `.scratch/strict-validate-remediation.md`；这是独立工程门禁问题，不能因延后硬件验收而忽略，也不能在本 change 中放宽门禁或顺手改写他人规格。
- 旧“HEAD 之上未提交实现即检查点”描述不构成交接依据；未来交接必须由主调度按实时 Git 和项目授权形成固定检查点。本轮只修改规划，不提交。

## 15. 网络 API 模型后端

- [x] 15.1（IP-15）按 D-23 完成同名 strict NetworkApiDeploymentConfigV1Schema 的 `openai-chat` / `ollama-embed` 判别配置、受限凭据、精确 registry 与服务/模型身份复验；保留 `ModelGatewayDeploymentConfigV1` 的 `llamacpp` / `network-api` 包装、原 llama.cpp 配置及 core port；验证：`pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/deployment/config-operations.test.ts`。
- [x] 15.2（IP-15）复用 C05 调用校验/持久化/预算逻辑：MiniMax OpenAI Chat Completions 仅提供结构化生成/会话流，Ollama 原生 `/api/embed` 仅提供 Embedding；实现显式结构化模式与 reasoningEffort、严格 Zod 收口、usage/预算、C04 去除 reasoning_content、闭合错误、取消/断流及不自动重试；验证：`pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts`。
- [x] 15.3（IP-15；依赖 15.1/15.2）以批准的真实 MiniMax 聊天与 Ollama Embedding 服务完成三能力 smoke，记录协议/模型身份、C04 响应引用和预算证据；验证：`RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`，配置/秘密路径见 D-22；缺真实服务、关键 skip 或协议替身不能计通过。

## 16. 真实宿主接线与功能验收（当前新增，尚未实现）

本轮评分规则验收补齐配置包来源互斥 Schema、正式 C04 来源与 C06/C18 校验，并使用原提交、复核、发布和依据解析；C19 Agent 编制另行闭合共享任务定义，不计本轮通过。C17 保持知识编制，生产装配使用同一 C16 的 C18/C19 策略与精确预测、校准、现场和报告绑定（D-20）。配置包验证纳入 16.1：`pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts`，真实导入/发布另以 16.3 证明。

- [ ] 16.1（IP-16 / IP-05 / IP-06；依赖 15.1/15.2）完成 start.mjs 的真实 provider 装配、显式 API/Worker 生命周期、网络部署选取及就绪观测，以及 provision.mjs 的受控资料预置与原身份续接；工程策略/图版本按 projectBindings 精确核验。三个逻辑角色可合置，禁止测试 harness/假策略补位。验证：`pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/composition.test.mjs scripts/deployment/lifecycle.test.mjs scripts/deployment/provision.test.mjs`。
- [ ] 16.2（IP-16）复用合成材料 check/run，增加正式只读终态观察与安全证据报告；submitted、awaiting-human、超时、缺引用或关键 skip 不能 PASS，人工决定经正式确认。验证：`pnpm exec vitest run scripts/acceptance/synthetic.test.mjs scripts/acceptance/functional.test.mjs`。
- [ ] 16.3（IP-16；依赖 16.1/16.2、13.1、14.1、15.3）由完整生产宿主与真实服务/批准版本及样本执行识别→复核→评估→预警→处置/人工决定→执行反馈，核对审计、工件、权限拒绝和原身份重试；同时在用户可见的外部 Chrome 窗口访问生产宿主完成浏览器验收，可由 CDP 驱动该可见窗口，headless 运行不能替代观看验收。当前 DISPLAY=:0 的 Chrome/CDP 9337 窗口为空白，未启动生产服务且没有业务 PASS。验证：`node scripts/acceptance/functional.mjs --pack <packDir> --config <runConfig.json> --output <dir>`、`pnpm test:browser` 及可见外部 Chrome 的真实业务证据。等待人审时只记录未完成并按原身份续接；报告明确合成样本适用边界及联网后端，不要求 4090 或签名包。

## 最终交付移交 C38（范围登记，不计 C37 checkbox）

C38 `deliver-mvp-acceptance-and-delivery-evidence` 规划必须消费下表，先闭合自己的规格/施工图/任务，再按最终代码、配置和制品身份取证。当前不新建活跃 change，不修改执行图；C37 归档后移交表仍随归档工件保留。全部项目均为未来未完成事项，C37 功能 PASS 不证明它们通过。

| 移交 ID | 原任务 / IP | C38 必须完成的工作与证据 |
| --- | --- | --- |
| F-01 | 原 15.1 / IP-09、IP-13 | 原生构建机、正式离线缓存与批准签名；Windows NSIS、Linux AppImage、macOS DMG，核验真实 Electron/Chromium/Node、签名/公证、许可/SBOM；`pnpm desktop:package -- <target>` 的实际调用及产物须先独立核验。 |
| F-02 | 原 15.2 / IP-13 | 三平台真实安装与全部桌面行为取证。先把正式安装包身份校验及完整 Electron Playwright 场景接到交付命令；当前 `test:desktop` 单测不构成平台验收。 |
| F-03 | 原 15.3 / IP-10–IP-12、IP-14 | 正式证书、真实禁网三 VM、系统/驱动/llama.cpp/模型/OCR 全部介质；完整安装、后台任务、重启、损坏检测、索引重建、恢复与回退。先补齐真正执行场景的部署 smoke，核验既有发布/导入程序，不能用配置校验或环境标签通过。 |
| F-04 | 原 15.4 / IP-14 | 主 RTX 4090 24GB/128GB RAM 运行 Qwen3.8-27B，辅助 NVIDIA GPU 运行 MinerU 专用模型；按服务冻结设备 UUID、backend、量化/上下文与并发，embedding 默认保持独立 Ollama 主机。以相同标注样例核验云端/本地转换与模型质量，实测并行峰值显存/RAM、延迟/吞吐/排队、取消、容量和恢复耗时；先实现真实 benchmark，不虚报 RPO/RTO 或 SLA。辅助卡采购与制品许可依实测冻结；官网功能 PASS 不代替此项。 |
| F-05 | 原 15.5 / IP-14 | C38 Finalizer 按最终版本核对 F-01–F-04、合同交付材料及必要审计，生成 C38 最终 verification；任一正式证据缺失不得声明最终交付 PASS。 |

签名秘密、正式制包及 C38 现场验收不属于当前授权范围；C37 网络服务、生产宿主与可见浏览器功能验收由对应任务实施。未来取证以当时真实输入为准，不沿用旧开发机硬件/环境缺件快照。
