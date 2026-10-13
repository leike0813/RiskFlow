# Verification

## 验收对象

- Change：`deliver-offline-private-deployment-and-operations`，schema `orchestrated-delivery`。
- 输入实现 HEAD：`b6e39eb41e9cc8b0c9840f6f58057155eb37de54`。
- 固定验收检查点：`9432a3f`（覆盖全部已核验工作区实现与两个 change 的规划/验收工件）。
- 主规格同步提交：`4fb9b09`（11 份 delta 合并进 `openspec/specs/`，逐项复验一致）。
- 最终验收 HEAD：`4fb9b09`，其父提交为 `9432a3f`；实现与规格均已冻结在同一检查点链上。
- 验收 Agent：主 Agent 负责核验、范围内修复与工件更新；独立限定审计由单独会话的 Targeted Auditor 执行，结论为 PASS 且无阻塞项，不以工程测试或主 Agent 代码核对代替。
- 日期：2026-10-13（检查点与审计收口同日）。

## 结论

**PASS（归档门）**。已实现工程任务整理为 43/43，11 份保留 delta 含 42 个 Requirement、117 个 Scenario，全部映射到现有实现与工程证据；独立限定审计在固定检查点之上完成，结论 PASS、无阻塞项。后续真实功能、完整 Electron 和现场义务按用户批准的拆分进入 `complete-private-deployment-functional-acceptance`，未被本结论标为通过。

归档门的两项条件已闭合：

1. **固定 Git 检查点**：`9432a3f` 已把全部已核验工作区实现纳入版本控制，原「当前 HEAD 与已核验工作区不等价」缺口消除。
2. **独立限定审计**：Targeted Auditor 抽查 IP-01–IP-16 全部引用文件与 12 个宿主符号、抽查 17 条 Requirement/Scenario 证据映射，未发现勾选但不存在、占位交付、硬编码业务规则、Schema 多源定义、跨层后门或审计静默丢弃。`pnpm deps:check` / `pnpm deps:policy` / 恒真断言与 `.skip|.only` 扫描均为干净。

以下四项为已登记的后续义务，**不构成归档门**，由本 change 结转：

1. **IP-21（browser）**：本轮实跑 `pnpm test:browser` 为 87 passed / 1 flaky（14.6m，exit 0）。唯一 flaky 项为 `apps/web/test/browser/agent-audit-operations.spec.ts:461`「切工程必须中止在途读取」，首次尝试 `aborted = 0`、重试通过；先前记录的重评启动确认按钮失败本轮未复现。慢读测试的固定等待未先证明切换时确有在途请求，产品是否违约仍待按该前置复核，不用强制点击或放宽超时掩盖。
2. **IP-21（产品缺陷，审计新增定性）**：审计确认重评启动的确认按钮失败属于产品缺陷而非测试缺陷——`apps/web/src/components/ConfirmButton.css:51-66` 中 `.confirm-overlay` 为 `position:fixed; inset:0; display:flex; align-items:center`，但 `.confirm-dialog` 无 `max-height`、无 `overflow`，对话框在内容超出视口时顶部溢出，真实用户同样点不到主确认按钮。须按取消/单在途和真实确认契约修复，不得靠强制点击掩盖。
3. **IP-22（全仓 strict）**：`openspec validate --all --strict --no-interactive` 为 33 passed / 12 failed（45 项），全部为 >500 字长正文警告。**第 12 项由本 change 自己引入**：`platform/llamacpp-model-gateway` 的 `结构化生成必须按冻结 Schema 提交并经本地 Zod 复验` 正文在 `b6e39eb` 为 309 字符，经 `4fb9b09` 同步后为 625 字符。IP-22 范围必须显式纳入本 change 自己的 Requirement 正文，否则门禁无法闭合。未去掉 strict，也未自行改写已批准的需求措辞。
4. **审计记录项**：①`packages/core/src/identification/candidate-finalization/service.ts:322` 存在 2 个原始 NUL 字节，使该文件被判为 binary、diff 审查失真（早于本 change，仓库其余位置用 `\u0000` 转义写法）；②`tasks.md:10,12,21` 引用的测试项数为旧快照，实测 `entrypoints.test.mjs` 118 passed、`config-operations.test.ts + policies-readers.test.ts` 45 passed，勾选项内数字不可复现。两项均不阻塞归档。

## 核验与修复证据

### 范围、完整性与一致性

| 维度 | 当前事实 |
| --- | --- |
| Completeness | 43/43 已实现工程任务；42 Requirement/117 Scenario 有明确映射；原 10 项未勾义务按 handoff 表逐项拆分 |
| Correctness | 核对实际模块、公开接缝、当前权限/精确引用、事件重投和校准提交时序；工程回归与真实运行证据分别登记 |
| Coherence | D-01–D-24 和 IP-01–IP-16 保留工程设计身份；后续 D-25–D-30/IP-17–IP-22 承接剩余工作；无第二规则/来源/任务/报告事实源 |
| 当前归档门 | 固定检查点（`9432a3f`）与独立限定审计（PASS，无阻塞项）已闭合，结论 PASS；browser 与全仓 strict 分别结转 IP-21/IP-22 |

本轮没有产品代码修复。修改范围是两个 change 的规格/规划/任务、此 verification、后续 handoff，以及 AGENTS 阶段指针和部署验收说明；既有源码经 `9432a3f` 冻结入库，原任务 8.5 的测试迁移/harness 实现成立，旧 88/0 记录仍是历史证据；后续失败不能以旧记录覆盖。

### Requirement / Scenario / IP-ID 映射

下表列出所有保留 Requirement 及其全部 Scenario 名称；施工图 §6 对每个 Scenario 单独映射证据组、测试文件和可运行命令。源文件详情/公共符号和实施文件清单在施工图 §2/§7，不以关键词存在性单独认定行为通过。

| Requirement / Scenario | IP-ID | 代码与工程证据 | 核验状态 |
| --- | --- | --- | --- |
| domain/module-interfaces-events-workflows / Worker 按精确因果事实耐久消费父图事件；场景：子事件先于父关联提交；图已消费但回执提交失败；验收子运行版本不符 | IP-05/IP-06/IP-16 | workflow adapter#readEventParentRun/verifyEventConsumption；identification adapter#readRegisteredWorkPlan；assessment graph A3/A4；施工图 §6 E18 | 工程实现已定位；实际证据分层见下文 |
| domain/module-interfaces-events-workflows / 识别规划接口返回正式已登记计划；场景：正式计划按精确输入返回；缺计划或拒权保持失败边界 | IP-05/IP-06/IP-16 | workflow adapter#readEventParentRun/verifyEventConsumption；identification adapter#readRegisteredWorkPlan；assessment graph A3/A4；施工图 §6 E18 | 工程实现已定位；实际证据分层见下文 |
| domain/module-interfaces-events-workflows / 反馈校准检查点只登记已提交公共偏差；场景：输入冻结与 Agent 等待不冒充公共记录；正式建议成功后登记精确版本；缺失或越权的创建记录拒绝推进 | IP-05/IP-06/IP-16 | workflow adapter#readEventParentRun/verifyEventConsumption；identification adapter#readRegisteredWorkPlan；assessment graph A3/A4；施工图 §6 E18 | 工程实现已定位；实际证据分层见下文 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包评分规则使用真实来源与正式治理；场景：配置包无需评分 Agent 即进入人工治理 | IP-04/IP-16 | packages/core/src/scoring-rules 与 packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts；施工图 §6 E17 | 工程实现已定位；实际证据分层见下文 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包来源及版本确定性校验；场景：包或来源漂移时拒绝提交；两种来源不能混用 | IP-04/IP-16 | packages/core/src/scoring-rules 与 packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts；施工图 §6 E17 | 工程实现已定位；实际证据分层见下文 |
| knowledge/structured-scoring-rules-and-applicable-rule-sets / 配置包沿用人工审核及原子发布门禁；场景：配置包保留原发布门禁 | IP-04/IP-16 | packages/core/src/scoring-rules 与 packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts；施工图 §6 E17 | 工程实现已定位；实际证据分层见下文 |
| platform/electron-https-client / 桌面与浏览器必须共用完整 Web 业务界面；场景：两种入口访问同一业务对象；原型数据或页面遗漏 | IP-09/IP-13 | apps/desktop/src/{main,security}.ts；安全 HTTPS 入口；施工图 §6 E09 | 工程实现已定位；实际证据分层见下文 |
| platform/electron-https-client / 桌面运行必须限制导航与本机能力；场景：越界导航或本机调用；基础上传与下载 | IP-09/IP-13 | apps/desktop/src/{main,security}.ts；安全 HTTPS 入口；施工图 §6 E09 | 工程实现已定位；实际证据分层见下文 |
| platform/electron-https-client / 证书与会话必须沿用安全 HTTPS 边界；场景：有效证书与真实登录；证书失败或权限撤销 | IP-09/IP-13 | apps/desktop/src/{main,security}.ts；安全 HTTPS 入口；施工图 §6 E09 | 工程实现已定位；实际证据分层见下文 |
| platform/electron-https-client / 连接恢复不得重启任务或自动提交写命令；场景：首次连接失败与恢复；窗口关闭后任务继续；命令响应丢失与订阅重连 | IP-09/IP-13 | apps/desktop/src/{main,security}.ts；安全 HTTPS 入口；施工图 §6 E09 | 工程实现已定位；实际证据分层见下文 |
| platform/engineering-baseline / 单一生产 workspace；场景：发现全部生产成员；Demo 不进入生产依赖图 | IP-01 | 根 workspace/package/tsconfig 与依赖边界；施工图 §6 E01 | 工程实现已定位；实际证据分层见下文 |
| platform/engineering-baseline / 冻结且可重放的工具链；场景：冻结安装成功；清单与锁文件不一致；不受支持的 Node 主版本 | IP-01 | 根 workspace/package/tsconfig 与依赖边界；施工图 §6 E01 | 工程实现已定位；实际证据分层见下文 |
| platform/engineering-baseline / 可构建的应用与深层共享包；场景：全 workspace 构建；公开入口可解析；深层导入被拒绝 | IP-01 | 根 workspace/package/tsconfig 与依赖边界；施工图 §6 E01 | 工程实现已定位；实际证据分层见下文 |
| platform/engineering-baseline / 强制单向依赖边界；场景：合法依赖图；反向或跨应用依赖 | IP-01 | 根 workspace/package/tsconfig 与依赖边界；施工图 §6 E01 | 工程实现已定位；实际证据分层见下文 |
| platform/llamacpp-model-gateway / 模型部署能力和尺寸由配置冻结；场景：配置化部署调用成功；业务不能选择模型名；部署能力或版本不匹配 | IP-15 | packages/adapters/src/model/{config,model-gateway-runtime,network-api-model-gateway,llamacpp-model-gateway}.ts；施工图 §6 E15 | 工程实现已定位；实际证据分层见下文 |
| platform/llamacpp-model-gateway / 结构化生成必须按冻结 Schema 提交并经本地 Zod 复验；场景：双重约束后的结构化结果成功；Schema 提示与本地严格复验；非法 JSON 结构失败；Zod 复验失败；服务端 Schema 约束缺少证据；输出 Schema 无法安全转换；reasoning 内容不进入持久化或展示 | IP-15 | packages/adapters/src/model/{config,model-gateway-runtime,network-api-model-gateway,llamacpp-model-gateway}.ts；施工图 §6 E15 | 工程实现已定位；实际证据分层见下文 |
| platform/llamacpp-model-gateway / 测试替身和真实 llama.cpp smoke 分层验收；场景：测试替身不进入生产导出；真实服务走通三项能力；真实服务不可用不会被跳过为成功；当前网络 API 形成三能力证据 | IP-15 | packages/adapters/src/model/{config,model-gateway-runtime,network-api-model-gateway,llamacpp-model-gateway}.ts；施工图 §6 E15 | 工程实现已定位；实际证据分层见下文 |
| platform/llamacpp-model-gateway / 网络 API 必须保持原网关的授权预算与证据契约；场景：合法联网后端被业务复用；无权资料或秘密进入客户端；网络协议失败保持原错误边界；后端切换不得复用旧向量空间 | IP-15 | packages/adapters/src/model/{config,model-gateway-runtime,network-api-model-gateway,llamacpp-model-gateway}.ts；施工图 §6 E15 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 生产检查点按当前运行验证真实引用；场景：当前上下文与检查点引用一致；引用或运行归属无法证明 | IP-05/IP-16 | start.mjs#createDeploymentCheckpointValidatorV1；三图 runtime 和所属模块精确证明；施工图 §6 E05 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 评估启动状态不得引用未登记快照；场景：首次评估经过真实 A0；后续阶段缺少入口快照 | IP-05/IP-16 | start.mjs#createDeploymentCheckpointValidatorV1；三图 runtime 和所属模块精确证明；施工图 §6 E05 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 跨虚拟机工件访问必须保持 C04 原契约；场景：真实跨 VM 写入与读取；断流或传输身份越权 | IP-03 | packages/adapters/src/artifacts/remote-*；原 C04/ref guard；施工图 §6 E03 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 生产策略与窄读必须解析精确真实来源；场景：完整来源装配并保留质量查询授权；策略漂移或质量门禁失败；独立知识发布后的受限命令因果授权；评分配置包使用同一正式治理实例；预测、校准、现场和报告按精确部署绑定解析；预测执行器使用运行时已核验策略 | IP-04/IP-05 | start.mjs#resolveDeploymentPoliciesV1/createDeploymentScoringGovernanceV1；identification/risk-flow composition；施工图 §6 E04 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 合成验收资料预置必须使用正式权限与模块入口；场景：文本资料按正式身份预置并重试；预置缺少授权、版本或 OCR；合成现场配置绑定正式工件；合成检索样例用于真实测量 | IP-16 | scripts/deployment/provision.mjs；scripts/acceptance/{synthetic,functional}.mjs；施工图 §6 E16 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 部署运维状态与审计必须耐久且独立授权；场景：阶段重放与权限隔离；审计失败与授权缺项 | IP-02 | packages/adapters/src/deployment/{schema,secrets,initialization,operations}.ts；施工图 §6 E02 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 部署必须遵循三台虚拟机的集中式边界；场景：客户端只访问应用入口；同机副本与宿主故障边界 | IP-10/IP-09 | scripts/deployment/release.mjs、package-desktop.mjs；deployment 服务/网络模板；施工图 §6 E10 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 离线发布包必须完整且版本可核验；场景：受控导入核验完整介质；制品不完整或不匹配；已验收界面尚未进入生产构建 | IP-10/IP-09 | scripts/deployment/release.mjs、package-desktop.mjs；deployment 服务/网络模板；施工图 §6 E10 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 部署配置与秘密必须分离并保持原契约；场景：同一配置可重放；配置非法或秘密不可用；秘密轮换保持历史可追溯；检索质量输入按精确配置加载 | IP-02 | packages/adapters/src/deployment/{schema,secrets,initialization,operations}.ts；施工图 §6 E02 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 初始化必须幂等且运行主体使用最小权限；场景：空实例初始化成功；初始化重放或部分失败；运行主体试图越权 | IP-02 | packages/adapters/src/deployment/{schema,secrets,initialization,operations}.ts；施工图 §6 E02 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 服务生命周期必须使用真实公共接缝；场景：真实实例完成请求和后台消费；缺少必需接线；进程重启与事件重投；有界停止未能完成；真实运行事件从耐久游标恢复 | IP-06/IP-16 | start.mjs#createDeploymentApiV1/createDeploymentWorkerV1/createDeploymentOutboxDispatchV1；lifecycle.mjs；施工图 §6 E06 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 内网访问与观测必须有界且最小披露；场景：安全同源访问和重连；依赖失败或正在维护；慢探针或无权查询 | IP-06/IP-16 | start.mjs#createDeploymentApiV1/createDeploymentWorkerV1/createDeploymentOutboxDispatchV1；lifecycle.mjs；施工图 §6 E06 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 同机逻辑副本必须绑定同一停写边界及全部耐久事实；场景：完整停写备份成立；停写失败或工程授权不完整；复制、空间或耐久记录失败；同键重试与异载荷冲突 | IP-11 | scripts/deployment/backup.mjs；原维护回执及 C04 manifest；施工图 §6 E11 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 恢复必须先隔离核验再人工切换；场景：隔离恢复与原实例并存；缺失、损坏或快照不匹配；索引重建与正式空结果；人工切换、拒绝与重复操作 | IP-12 | scripts/deployment/restore.mjs；原隔离核验/人工激活/回退；施工图 §6 E12 | 工程实现已定位；实际证据分层见下文 |
| platform/offline-private-deployment-and-operations / 发布回退程序保持精确兼容性与人工确认；场景：兼容版本按精确确认回退；不兼容版本缺少匹配恢复点 | IP-12 | scripts/deployment/restore.mjs；原隔离核验/人工激活/回退；施工图 §6 E12 | 工程实现已定位；实际证据分层见下文 |
| platform/web-shell-interaction-primitives / 写命令必须经过统一确认原语；场景：普通命令确认后提交一次；高影响命令要求显式二次确认；无权限确认卡不可提交；陈旧版本确认失败；无工程的系统管理确认 | IP-07 | apps/web/src/api/client.ts 与统一确认/路由；施工图 §6 E07 | 工程实现已定位；实际证据分层见下文 |
| web/agent-audit-and-operations-ui / C35 页面必须复用 v2 设计并保持既有应用接线；场景：已接通页面与 v2 分区一致；刷新切换与服务异常 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/agent-audit-and-operations-ui / C35 验收必须覆盖真实接缝和可访问性；场景：真实浏览器完成 C35 链路；慢读和环境缺失 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/assessment-warning-and-response-ui / C34 页面必须复用 v2 设计并只展示真实事实；场景：真实数据与页面可达；工程切换与失败 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/assessment-warning-and-response-ui / C34 必须以真实浏览器验收业务接缝；场景：真实闭环与失败边界验收 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/engineering-and-knowledge-ui / 页面必须只经既有 HTTP 只读面取得业务事实；场景：页面渲染当前工程的真实事实；写操作入口不存在 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/engineering-and-knowledge-ui / 浏览器验收必须使用真实浏览器与正式接缝；场景：真实浏览器完成只读链路；环境不可用明确失败 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/identification-and-review-ui / 识别与复核页面必须只经既有 HTTP 面取得业务事实；场景：页面渲染当前工程的真实事实；假写入口不存在 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |
| web/identification-and-review-ui / 浏览器验收必须使用真实浏览器与正式接缝；场景：真实浏览器完成识别与复核链路；环境不可用明确失败 | IP-08/IP-07 | apps/web/src/{pages,api,agent,components}；路由/迁移附表；施工图 §6 E08 | 工程实现已定位；实际证据分层见下文 |

IP-13 的预检/基础 e2e 定义、IP-14 的手册/证据口径与拆分记录分别由 deployment/acceptance 与 desktop security/packaging 测试及两个 change 的严格校验核对。完整 Electron 特有场景仍是后续 IP-18 未执行义务；跨 VM 工件流工程测试不证明 production host 已开放。

### 本次可运行命令及结果

| 证据 ID | 命令 | 结果与边界 |
| --- | --- | --- |
| G1 | `pnpm exec vitest run scripts/deployment/entrypoints.test.mjs scripts/deployment/composition.test.mjs scripts/deployment/risk-flow-composition.test.mjs scripts/deployment/assessment-composition.test.mjs scripts/deployment/lifecycle.test.mjs scripts/deployment/provision.test.mjs scripts/deployment/acceptance.test.mjs scripts/deployment/api-ports.test.mjs scripts/acceptance/functional.test.mjs packages/adapters/test/deployment/policies-readers.test.ts packages/adapters/test/workflow/postgres-workflow-adapter.test.ts apps/worker/test/risk-flow/runtime.test.ts apps/worker/test/assessment/runtime.test.ts apps/worker/test/agent-runtime/runner.test.ts` | 14 文件、383 项通过；含正式初始化库/API/Worker/权限/空轮询及精确消费回归，无真实模型业务 PASS |
| G2 | `pnpm test:deployment` | 20 文件、408 项通过；含发布/秘密/策略/初始化、mTLS、逻辑副本/恢复与安全壳工程测试，非实机三 VM 或安装取证 |
| G3 | 模型/评分包/所属 adapter/API quality/Web 确认定向回归（命令另列） | 14 文件、245 项通过；评分来源、模型协议及领域持久化/权限与 Web 确认的工程回归，不替代真实业务终态 |
| G4 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | 全 workspace TypeScript 与 Web 生产构建通过；Vite 图表 chunk 体积提示不计实测性能 |
| G5 | `pnpm deps:check`、`pnpm deps:policy` | 通过，685 modules/2294 dependencies 无违规，依赖政策 OK；未安装或改锁文件 |
| G6 | `pnpm test:browser` | 两轮如实登记。**收口轮**：exit 0，87 passed / 1 flaky，耗时 14.6 分钟；唯一 flaky 为 agent-audit-operations.spec.ts:421「切工程必须中止在途读取」，首次 `aborted = 0`、重试通过。**前一轮**：非零（exit 1），86 passed / 2 failed，17.5 分钟，失败为 agent-audit-operations.spec.ts:421 慢读/切工程取消与 assessment-warning-response.spec.ts:1515 重评确认按钮不可点击，两项首次与重试均失败；日志 /tmp/riskflow-c37-split-browser-2026-10-13.log 与 test-results/quality-browser 的原失败及 retry1 trace 保留。缺口移交 IP-21，不能计旧 88/0 |
| G7 | 两个 change 的 `openspec validate <change> --strict --no-interactive` | 均通过；仅证明本次工件符合 schema，不代表业务验收或全仓门禁通过 |
| G8 | `pnpm exec openspec validate --all --strict --no-interactive` | 非零；收口轮为 33 passed / 12 failed（45 项），全部为 >500 字长正文警告。第 12 项由本 change 自己引入：`platform/llamacpp-model-gateway` 的 `结构化生成必须按冻结 Schema 提交并经本地 Zod 复验` 在 `b6e39eb` 为 309 字符、同步后 625 字符（`git show b6e39eb:openspec/specs/platform/llamacpp-model-gateway/spec.md` 对照）。IP-22 范围须显式纳入本 change 自身正文；未去掉 strict，未改写已批准措辞。历史日志 /tmp/riskflow-c37-split-openspec-all-2026-10-13.log 仍保留前一轮 32/11（43 项）记录 |
| G9 | 修改 Markdown 的 `pnpm exec prettier --check <files>`、`git diff --check` | 均通过 |

G3 精确命令：

```sh
pnpm exec vitest run packages/core/test/scoring-rules/scoring-rules.test.ts packages/adapters/test/scoring-rules/postgres-scoring-rules-adapter.test.ts packages/adapters/test/model/network-api-model-gateway.test.ts packages/adapters/test/model/llamacpp-model-gateway.test.ts packages/adapters/test/calibration/postgres-calibration-adapter.test.ts packages/adapters/test/recommendation/postgres-recommendation-adapter.test.ts packages/adapters/test/response-lifecycle/postgres-response-lifecycle-adapter.test.ts packages/adapters/test/risk-assessment/postgres-risk-assessment-engine.test.ts packages/adapters/test/warning/postgres-warning-lifecycle-adapter.test.ts packages/adapters/test/identification/graph/postgres-identification-graph-adapter.test.ts apps/api/test/quality.test.ts apps/web/test/confirmation.test.ts apps/web/test/focus.test.ts apps/web/test/routing-context-actions.test.ts
```

测试批次有重叠，不累加为全仓覆盖或重复加权。所有使用测试候选/工具替身的结果只证明工程契约。

### 历史证据及实际边界

- 2026-10-11 网络三能力 smoke：结构化 303 token、Embedding 29 输入 token/2560 维、会话流 26 增量/288 token。该次使用隔离 PostgreSQL/C04 测试存储，未验证 production 授权，不作为正式业务链结果；本次未再次调用真实服务。命令为 `RISKFLOW_NETWORK_API_SMOKE=1 pnpm exec vitest run packages/adapters/test/model/network-api-model-gateway.smoke.test.ts`，配置/秘密只传文件路径。
- 先前全仓 2035 项/129 文件、browser 88/0、八套件 261、另三套件 53、定向 245 及 8 GiB API/Worker 构建/lint/format，来源为 deployment/ACCEPTANCE.md 和上一轮交接。它们明确是历史，不替代本次命令结果。
- 旧运行临时目录已消失；其中 000056 初始化与 DOCX/CSV 转换只是历史记录。当前正式 migration 为 000058，不能重用旧转换版本或临时工件身份证明本次宿主。
- MinerU V2 五格式/试运行扫描与本机 CPU/Vulkan 报告为独立能力证据，不等于 production C04/C11 登记、完整业务或目标 4090 交付；V1 缺字段失败不改标签。

## 限定审计

审计范围按 security（受限秘密/联网资料资格/Electron/mTLS）、persistence（响应/追加审计/检查点/备份恢复）、integration（当前授权/完整 provider/精确消费与原身份恢复）及流/轮询硬预算的必要 performance 执行。独立 Targeted Auditor 会话在固定检查点 `9432a3f` 与同步提交 `4fb9b09` 之上完成，**结论 PASS，无阻塞项**。

审计实际执行的取证：

- IP-01–IP-16 引用的 26 个源文件与 59 个测试/配置文件全部存在；`scripts/deployment/start.mjs` 中 13 个宿主组合符号及 D-21 窄读符号 `readEventParentRun`/`verifyEventConsumption`/`readRegisteredWorkPlan`/`verifyCheckpointDomainReference`/`verifyCheckpointWaitingReference`/`readCreatedDeviationRecordRef` 均在所属 adapter 源与测试中命中。
- 抽查 17 条 Requirement/Scenario 证据映射全部成立，未发现「声称存在但不存在」或语义不符。
- `pnpm deps:check`（685 modules / 2294 dependencies 无违规）、`pnpm deps:policy` OK。
- 生产源码 `TODO|FIXME|XXX|HACK` 命中 0；`InMemory|FakeAdapter|MockAdapter|createStub` 未进入生产导出；恒真断言与 `.skip|.only` 命中 0；审计写入无 fire-and-forget 或静默丢弃。
- 业务 Schema 定义点唯一（`packages/contracts/src/records/index.ts`），风险矩阵以纯 Schema + 配置引用注入，无硬编码等级值。

审计提出的 4 项发现均不阻塞归档，已按上文结转：IP-21 产品缺陷（`ConfirmButton.css` 缺 `max-height`/`overflow`）、IP-22 纳入本 change 自身长正文、以及 NUL 字节与 tasks.md 测试项数旧快照两条记录项。

## 后续注意事项

- 剩余功能任务/交接见 `../complete-private-deployment-functional-acceptance/handoff.md`。原 change 的 specs、design、施工图和 tasks 已同步收窄，未来同步先处理本工程 change，再处理后续 delta。
- 当前只能启动 synthetic-acceptance 本地 C04 宿主；remote verifyContent/完整 production host 与 F-01–F-05 交 C38，不能只去掉 purpose 拒绝来开放。
- 当前没有完整真实业务、可见外部 Chrome、完整 Electron 或最终平台/硬件 PASS。本工件不证明甲方验收、真实工程准确率、离线交付、RPO/RTO 或 SLA。
- 本轮经用户授权提交两次（`9432a3f` 固定检查点、`4fb9b09` 主规格同步），未安装依赖、覆盖数据或修改执行图；完整生产来源和样本仍按真实实例重新取证。
