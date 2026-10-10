实现任务按 IP 依赖推进。完成 1–13 和 14.1 的代码与工程检查后执行 14.2，交接 Finalizer；第 15 组是后续交付取证与总体收口。交付输入缺项只使对应取证任务保持未勾选并记录 BLOCKED，独立实现与工程审查继续；总体通过及归档仍要求全部任务和必要审计完成。

## 1. 工程成员与冻结工具链

- [x] 1.1（IP-01）先建立 Desktop manifest/tsconfig（IP-09 文件），添加 workspace/TypeScript/依赖边界与精确依赖政策，按授权实施范围锁定依赖；验证：`pnpm deps:check && pnpm deps:policy`，完整构建在 9.1/14.2 核验。
- [x] 1.2（IP-01）登记施工图 §6 的新增命令、离线 Electron 构建路径与测试归属，保留统一工程验证；验证：`pnpm exec vitest run scripts/check-dependency-policy.test.ts`。

## 2. 部署契约、初始化与耐久审计

- [x] 2.1（IP-02）实现 D-19 strict Schema/秘密加载及失败闭合，完成安全配置示例；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`。
- [x] 2.2（IP-02）完成 000056 运维状态/审计/租约/权限迁移与公开 PostgreSQL 接缝；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`，断言业务主体不能写运维表或改审计。
- [x] 2.3（IP-02）实现显式初始化/LOGIN/checkpointer/首次管理员与 CLI 骨架；验证：`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`，空库与重放均保留正确账号事实。

## 3. 工件跨 VM 流访问

- [x] 3.1（IP-03）实现原 DTO 的有限流协议、mTLS、C06 复验与单独事务 referenceGuard 导出；验证：`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts`。
- [x] 3.2（IP-03）补齐背压/取消/截断/超额/超时/verified 和 data-VM service 生命周期；验证：`pnpm exec vitest run packages/adapters/test/artifacts/remote-artifact-store.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`。

## 4. 真实策略、授权与窄读

- [x] 4.1（IP-04）实现原 Schema 的不可变策略 catalog 与真实检索 dataset/门禁，禁止合成策略进入生产；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts`。
- [x] 4.2（IP-04）实现 C06 原调用来源/当前授权适配和工程枚举窄读，保持宿主授权与正文权限独立；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts packages/adapters/test/auth/local-identity-project-authorization.test.ts`。
- [x] 4.3（IP-04）完成 C19 正式配置成员、C24 路线集与 C30 精确空间配对 reader；验证：`pnpm exec vitest run packages/adapters/test/deployment/policies-readers.test.ts`，错版本/异空间/无权均拒绝。

## 5. 全能力生产组合

- [x] 5.1（IP-05）完成 C15/C17/C20–C24 真实装配、五类共享 Agent registry 与一次绑定环；验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs`。
- [x] 5.2（IP-05）完成 C25/C27–C30 真实装配及冻结现场/偏差上下文，禁止 unwired seam；验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs`。
- [x] 5.3（IP-05）接齐 API 全 ports/公开 adapter 子路径，修正完整 projection 与 C36 两阶段授权并存；验证：`pnpm exec vitest run scripts/deployment/composition.test.mjs apps/api/test/quality.test.ts`。

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
- [x] 9.3（IP-09）实现三平台 electron-builder 离线打包程序、签名接线、缓存/介质预检、Chromium/Node 许可与 SBOM 收集，保持服务端发布独立；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`，检查平台配置、结构化调用和缺项拒绝。正式签名包制备归 15.1。

## 10. 三 VM HTTPS 与离线发布

- [x] 10.1（IP-10）实现发布制备/核验/离线导入与固定 systemd/data OCI 服务，固定网络和运行用户；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`。正式介质的 `pnpm deployment:verify` 归 15.3。
- [x] 10.2（IP-10）配置 Caddy 手工证书/无 ACME、同源 Web/API/SSE 与深链，API 无 SPA fallback；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`，核对配置生成、网络/路由边界与缺项拒绝；真实 HTTPS/端口隔离/深链取证归 15.3。
- [x] 10.3（IP-10）实现模型/OCR/驱动/系统介质身份、独立预算与资源分配的配置/清单核验，补齐发布说明；验证：`pnpm exec vitest run scripts/deployment/release.test.mjs`。实际介质身份冻结、真实协议和资源证据在 15.3/15.4 收口。

## 11. 维护窗口与同机逻辑副本

- [x] 11.1（IP-11）实现三 VM 本地停写回执、写者证明、全工程授权和互斥；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs`。
- [x] 11.2（IP-11）实现 manifest→dump→全部工件副本→耐久 descriptor，保留全部版本/审计/Outbox/checkpoint；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs`。
- [x] 11.3（IP-11 / IP-02）闭合容量/复制/审计失败、原操作续接与异载荷冲突；验证：`pnpm exec vitest run scripts/deployment/backup.test.mjs packages/adapters/test/deployment/config-operations.test.ts`。

## 12. 隔离恢复、人工切换与回退

- [x] 12.1（IP-12）构建隔离 DB/工件根，完整消费全部工程 reconcile，坏字节/缺失/快照漂移拒绝；验证：`pnpm exec vitest run scripts/deployment/restore.test.mjs`。
- [x] 12.2（IP-12）核对业务/审计/checkpoint/任务，真实重建双索引并通过原门禁后再待确认；验证：`pnpm test:deployment`。
- [x] 12.3（IP-12）实现精确目标人工激活、旧会话失效与兼容/不兼容回退，失败保留双根；验证：`pnpm exec vitest run scripts/deployment/restore.test.mjs`。

## 13. 桌面验收程序

- [x] 13.1（IP-13）完成独立 Electron Playwright 配置、真实安装包环境校验和完整场景程序，移除 Vitest 混收；验证：`pnpm typecheck && pnpm exec vitest run scripts/deployment/acceptance.test.mjs`，检查平台/包/配置预检及缺项非零，不要求已具备三平台环境。

## 14. 部署验收程序与工程交接

- [x] 14.1（IP-14）完成 smoke/benchmark 与证据汇总程序、受控 acceptance 配置示例、操作/验收手册，复用既有模型/OCR smoke 入口；验证：`pnpm exec vitest run scripts/deployment/acceptance.test.mjs`，检查输入校验、关键场景缺失/skip 拒绝、身份与结果汇总，不要求目标硬件和真实模型介质齐备。
- [ ] 14.2（IP-14 / IP-01–13，工程交接；依赖全部实现任务）核对八份 delta 的实现/逐场景工程证据、完整迁移与同步设计，单列未完成的交付取证任务，完成工程验证并交接固定实现检查点给 Finalizer；验证：`pnpm verify && pnpm test:browser && pnpm test:deployment`。第 15 组的实机证据不作为本项前置；verification 由 Finalizer 工程审查后生成，总体缺交付证据时保持 BLOCKED。

  工程证据（本 change 范围内全部通过）：
  - `pnpm test`：2035 passed / 0 failed（129 文件）。
  - `pnpm test:deployment`：136 passed（13 文件）。
  - `pnpm test:browser`：**88 passed / 0 failed**（88 条真实用例，无 skip）。
  - `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm deps:check`、`pnpm deps:policy` 全部通过。
  - `openspec validate deliver-offline-private-deployment-and-operations --strict`：valid。

  **未勾选原因**：`pnpm verify` 内的 `openspec validate --all --strict --no-interactive` 在本仓库有 11 份**已归档**规格因「Requirement 正文超过 500 字」告警被判失败：`spec/data/agent-cleaning-and-partial-availability`、`spec/domain/module-interfaces-events-workflows`、`spec/domain/monitoring-batches-snapshots-features`、`spec/domain/response-recommendation`、`spec/knowledge/structured-scoring-rules-and-applicable-rule-sets`、`spec/operations/orchestration-controlled-actions`、`spec/platform/content-addressed-artifact-store`、`spec/platform/http-command-query-sse-shell`、`spec/platform/unified-bounded-agent-runtime`、`spec/quality/evaluation-and-browser-acceptance`、`spec/risk-assessment/engine`。

  已核对该失败与本 change 无关：在干净 HEAD（`6fd462e`）上同样失败（28 passed / 11 failed）。这些是更早归档 change 的规格正文形态问题，改写已归档规格属于规划漂移，按项目契约要另开 drift change，不能在本 change 内顺手改。本 change 自身的八份 delta 以 `--strict` 校验通过。


  **本 change 各任务验证命令的逐条核对**：已把 tasks.md 中全部 `验证：` 命令抽出（34 条去重），逐条确认它引用的测试文件存在，且每条都被已执行的聚合运行覆盖——`pnpm exec vitest run …` 类由 `pnpm test`（2035 passed）覆盖，部署类由 `pnpm test:deployment`（136 passed，覆盖 `scripts/deployment`、`packages/adapters/test/deployment` 三个文件、`remote-artifact-store`、desktop security/packaging）覆盖，四份浏览器 spec 由 `pnpm test:browser`（88/88）覆盖，工程门禁由 `pnpm verify`（build/typecheck/lint/format/deps 全过）覆盖。唯一未通过项是 `pnpm verify` 末段的仓库级 spec strict 校验，见下。

  **八份 delta 逐场景工程证据索引**（81 个 Scenario 全部归入下列证据来源；标注 BLOCKED 的 Scenario 属第 15 组实机取证，本机无输入）。浏览器侧逐文件条数不在此断言——spec 内含参数化循环，静态计数会少算；以整轮实测总量 **88 passed / 0 failed** 为准：

| delta | Requirement / Scenario | 工程证据 |
| --- | --- | --- |
| `platform/engineering-baseline` | 10 Scenario（成员发现、依赖图、Node 主版本、构建、公开入口、深层导入、锁文件一致性） | `scripts/check-dependency-policy.test.ts` + `pnpm deps:check` / `deps:policy` / `install --frozen-lockfile`，均在 `pnpm verify` 中通过。 |
| `platform/electron-https-client` | 工程可判部分：受控 origin 与会话、导航与本机调用限制、证书校验与显式重试、命令与订阅契约（`apps/desktop/test/security.test.ts`、`packaging.test.ts`，13 passed，纳入 `pnpm test:deployment`）。真实启动链路（双入口一致性、上传下载、证书失败与撤权、断线重连、窗口关闭后任务继续）由 `apps/desktop/test/e2e/client.spec.ts` 承担，它是 `test:desktop` 的证据，按设计在目标环境缺失时非零失败，本机无 Windows/macOS 平台故未执行、记 BLOCKED（15.2）。 |
| `platform/web-shell-interaction-primitives` | 5 Scenario（确认后单次提交、高影响二次确认、无权限不可提交、陈旧版本失败、无工程系统管理确认） | `apps/web/src/shared/confirmation.ts` 与六份浏览器 spec 中的确认对话框/零写用例，`pnpm test:browser` 88/88。 |
| `web/engineering-and-knowledge-ui` | 4 Scenario | `apps/web/test/browser/read-only.spec.ts`。 |
| `web/identification-and-review-ui` | 4 Scenario | `apps/web/test/browser/identification-review.spec.ts`。 |
| `web/assessment-warning-and-response-ui` | 3 Scenario | `apps/web/test/browser/assessment-warning-response.spec.ts`+ `risk-level-response-verification.spec.ts`。 |
| `web/agent-audit-and-operations-ui` | 4 Scenario | `apps/web/test/browser/agent-audit-operations.spec.ts`+ `quality.spec.ts`（C36 质量面）。 |
| `platform/offline-private-deployment-and-operations` | 33 个工程可判 Scenario（部署配置、秘密轮换、初始化、运行主体越权、进程重启与事件重投、有界停止、SSE 恢复与重连、慢探针、备份、恢复、回退、索引重建等） | `scripts/deployment/*.test.mjs`（7 份，含新增 `entrypoints.test.mjs`）、`packages/adapters/test/deployment/*`、`packages/adapters/test/artifacts/remote-artifact-store.test.ts`，`pnpm test:deployment` 136 passed。另有 6 个 Scenario（三 VM 禁网、模型/OCR 制品、4090 基准等）依赖实机与真实介质，记 BLOCKED。 |

  **unblock 清单**：共 27 条超长 Requirement，分布在 11 份已归档规格。

  校验口径已核清：同一批 41 项规格在**非 strict 下 41 passed / 0 failed**，加 `--strict` 才变成 30 passed / 11 failed。也就是说 11 份规格**语义全部有效**，`--strict` 只是把「Requirement 正文超 500 字」这条**样式告警**提升成了失败。因此这件事有两个互斥的处置口径，都需要项目决定，不由本 change 代选：

  1. 改写 27 条已归档 Requirement 的正文分组（把 MUST 条款链拆成「一条 Requirement 只陈述一个行为」）。这会动到 8 个以上其他 change 的已归档契约，需要原责任方判定拆分边界。
  2. 调整仓库的 spec 校验口径（`package.json` 的 `openspec:validate` 当前带 `--strict`），接受样式告警不阻断 CI，语义校验（41/41）保持不变。

  两条路都会改动本 change 之外、且不由本 change 拥有的东西，因此本 change 不代选、不代做。

  **完整清单已备好**：`.scratch/strict-validate-remediation.md` 逐条列出 27 条 Requirement 的规格路径、标题、正文字数与配套 Scenario 数，并已按校验器输出核对（27 条、无遗漏）。无论选 A' 还是 B，那份清单都能直接作为执行输入。

  已实际读取违规正文确认性质：这些 Requirement 正文**不是可搬移的示例与边界，而是连续的规范条款链**——例如 `content-addressed-artifact-store` 的「哈希清单和恢复核对以数据库引用完整为硬门槛」，正文是一串 MUST 事务/引用/字段要求，且该 Requirement 已有 7 个配套 Scenario 覆盖了它列出的各种边界。校验器建议的「移进 Scenario / 拆成多条 Requirement」在这里需要判断一条 MUST 链在哪里结束、另一条从哪里开始，属于**改写他人已归档契约的语义**，不是机械搬移。

  因此这 27 条不能在本 change 内顺手处理：需要原 change 的责任方（或另开的 drift change）逐条判定拆分边界。按契约，这类公共契约改写必须升级，不能由实现 Agent 自行决定。

  | 归档规格 | 超长条数 | 最长正文 |
  | --- | --- | --- |
  | `openspec/specs/data/agent-cleaning-and-partial-availability/spec.md` | 2 | 688 字 |
  | `openspec/specs/domain/module-interfaces-events-workflows/spec.md` | 8 | 871 字 |
  | `openspec/specs/domain/monitoring-batches-snapshots-features/spec.md` | 1 | 612 字 |
  | `openspec/specs/domain/response-recommendation/spec.md` | 1 | 881 字 |
  | `openspec/specs/knowledge/structured-scoring-rules-and-applicable-rule-sets/spec.md` | 7 | 2371 字 |
  | `openspec/specs/operations/orchestration-controlled-actions/spec.md` | 1 | 658 字 |
  | `openspec/specs/platform/content-addressed-artifact-store/spec.md` | 1 | 564 字 |
  | `openspec/specs/platform/http-command-query-sse-shell/spec.md` | 3 | 669 字 |
  | `openspec/specs/platform/unified-bounded-agent-runtime/spec.md` | 1 | 954 字 |
  | `openspec/specs/quality/evaluation-and-browser-acceptance/spec.md` | 1 | 562 字 |
  | `openspec/specs/risk-assessment/engine/spec.md` | 1 | 598 字 |

  交接给 Finalizer 的固定实现检查点：当前工作区（HEAD `6fd462e` 之上的未提交实现）。Finalizer 需在其上做工程审查并在限定的收尾轮次内修复范围内普通缺陷、回归，然后生成 verification；总体仍缺第 15 组实机证据，保持 BLOCKED。

## 15. 目标环境交付取证与总体收口

本组五项在本工程环境全部 BLOCKED：缺件均为交付输入，不是可由代码补齐的实现缺口。按 design 的 Open Questions，仅可延期到目标交付的真实输入是甲方脱敏样本、实际 OS/驱动/磁盘与内网证书、冻结硬件分配与性能阈值、llama.cpp/模型与 OCR 全部真实介质及许可、平台签名材料。

本机实测缺件（取证时读取，不靠推断）：

| 交付输入 | 实测 | 影响 |
| --- | --- | --- |
| 原生构建平台 | `Linux 6.8.0-142-generic x86_64`，只有 Linux | 15.1/15.2 缺 Windows 11 x64 与 macOS 14 arm64 |
| 签名材料 | 无 `electron-builder` 签名配置，签名环境变量 0 个 | 15.1 无法产出带真实签名的安装包 |
| 目标 GPU | `Tesla P4, 8192 MiB` | 15.4 要求 RTX 4090 24GB，硬件不符，且不得以本机数字冒充 |
| 主机内存 | 125 GB | 接近 128GB 基线，但 GPU 一项已足以阻塞 15.4 |
| 三台虚拟机 | `virsh`/libvirt 不可用 | 15.3 无禁网三 VM 环境 |
| 离线介质 | 无模型/OCR/离线介质目录 | 15.3 无冻结介质身份可核验 |

缺件不授权用默认值、合成数字或假证据补位，因此这五项保持未勾选。逐项缺件：


- [ ] 15.1（IP-09 / IP-13，交付取证）在各原生构建机使用真实离线介质、缓存、批准签名材料制备正式安装包，记录精确平台/运行时/签名/许可/SBOM 身份；验证：各平台 `pnpm desktop:package -- <win-x64|linux-x64|mac-arm64>`。缺材料仅阻塞对应正式包，9.3 的程序实现可先完成。**BLOCKED（缺件）**：本机无 Windows/macOS 原生构建机、无批准签名材料与真实离线介质/缓存，`pnpm desktop:package` 无法产出带真实签名的安装包。程序实现（IP-09）已由 9.3 完成并通过工程验证。
- [ ] 15.2（IP-13，交付取证；依赖 15.1）分别在 Windows 11 x64、Ubuntu 24.04 x64、macOS 14+ arm64 验证登录/上传下载/撤权/证书/越界/断线/任务继续，并记录平台与发布证据；验证：各平台 `pnpm test:desktop`。缺平台仅阻塞该平台取证，不阻塞 14.2 工程审查。**BLOCKED（缺件）**：只有 Linux x64 本机，Windows 11 与 macOS 14 arm64 平台不存在，无法产生平台发布证据。
- [ ] 15.3（IP-14 / IP-10–12，交付取证）冻结实际模型/OCR/驱动/系统介质身份，在真实禁网三 VM 运行完整发布、模型/OCR、业务后台链路、重启幂等、损坏检测/恢复/回退；验证：`pnpm deployment:verify -- <release-manifest.json> <release-root>` 与 `RISKFLOW_ACCEPTANCE_CONFIG=<验收配置> pnpm deployment:smoke`。缺介质/证书/目标环境只阻塞对应取证。**BLOCKED（缺件）**：无三台虚拟机的真实禁网内网、无甲方内网证书、无冻结的模型/OCR/驱动/系统介质身份，`pnpm deployment:verify` 与 `pnpm deployment:smoke` 无目标可跑。部署契约、Schema 与 CLI 的实现（IP-10–12）已由第 10–12 组完成并通过工程验证。
- [ ] 15.4（IP-14，交付取证）在 RTX 4090 24GB/128GB 最低目标按批准配置测量延迟/吞吐/资源和分阶段恢复耗时，将真实测量补入操作/验收手册；验证：`RISKFLOW_ACCEPTANCE_CONFIG=<验收配置> pnpm deployment:benchmark`，不虚报 RPO/RTO 或 SLA。**BLOCKED（缺件）**：本机无 RTX 4090 24GB/128GB 目标硬件，冻结硬件分配与性能阈值也未由甲方给出，无真实测量值可记录。
- [ ] 15.5（IP-14，交付收口；依赖 15.1–15.4 及 Finalizer 工程审查）按最终代码/配置/制品身份核对全部实机证据，交由 Finalizer 更新同一 verification；验证：`pnpm verify`、全部交付命令的真实报告及必要限定审计。全部必需证据通过后方可形成总体 PASS、成功集成和归档。**BLOCKED（依赖 15.1–15.4）**：上游取证全部缺件，收口无从核对，总体不得判 PASS、不得归档。
