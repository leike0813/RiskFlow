# 实机验收准备记录（2026-10-14）

本轮目标为完成验收程序与工程准备，尚未取得真实业务功能 PASS。样本为合成样本，待甲方复核。正式签名、多平台安装、禁网三 VM、远程宿主和 4090/MinerU 双卡取证继续归 C38 F-01–F-05。

输入代码基线：`31ad1a2c47a377f20179e0008241034c14a3bec5`；前置工程检查点 `9432a3f` 已归档。本轮修改尚未提交；执行真实业务前应按授权固定检查点或记录实际工作区身份，不能把旧 HEAD 当成本轮制品身份。

## 代码准备

| IP | 本轮变化 | 仍须实跑的义务 |
| --- | --- | --- |
| IP-17 | 复验真实配置、正式来源及装配的现有工程回归 | 实例配置/发布/迁移身份，正式 C19/C24/C30 来源及拒绝证据 |
| IP-18 | 桌面 strict 输入、正式回执绑定和 12 个场景/自检定义 | 当前平台 Electron、受信任 HTTPS、真实独立登录/下载/撤权/TLS/导航/SSE/关窗任务继续 |
| IP-19 | 静态材料包检查；复用已有 provision/API/Worker | MinerU 新 C04/C11 资料版本、配置审核发布、检索质量、五类任务和完整业务链 |
| IP-20 | 五类任务与运行观察配置示例；复用原摘要核验同次报告 | 本次完整 functional 配置、正式终态及 RI/RA 双向追溯 |
| IP-21 | 慢读切工程回归确定性、确认弹窗有限视口可操作性 | 可见 Chrome、原身份重投/重启、恢复损坏拒绝与双索引重建 |
| IP-22 | 获批准的 12 份主规格文本精简、5 个既有文件格式修复、当前准备索引 | 实机证据、固定实现检查点、Finalizer/必要一次限定审计及 verification |

## 工程证据

- 定向：entrypoints/config-operations/policies-readers/assessment-composition/risk-flow-composition/synthetic/functional，7 套件、262 项通过。
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`：通过。
- `pnpm test:deployment`：20 套件、408 项通过。
- Web 原失败用例修改前 2 项失败；修改后 `--retries=0` 两项通过。
- `pnpm test:browser`：88/88 通过，13.8 分钟，无失败或 flaky。
- 桌面 `--list`：12 个用例；预检边界自检通过，包含错运行、改配置、错查询版本、缺字段、错工程/发布、同源拒绝目标与秘密权限边界。自检不启动业务 Electron，不计任务 2.2。
- 全仓 `openspec validate --all --strict --no-interactive`：主规格精简后 44/44 通过。Requirement 名称与既有 Scenario 保留，未改变业务行为。
- 全仓 `NODE_OPTIONS=--max-old-space-size=8192 pnpm verify`：build/typecheck/lint/format 和单元/集成测试通过（141 文件、2434 项通过，3 文件/3 项显式跳过，测试用时 885.35 秒）。随后因桌面测试跨应用导入 Web 源码而在依赖检查处 exit 2；已移除两处导入，单独重跑 `pnpm deps:check`、`pnpm deps:policy`、`pnpm openspec:validate` 均通过（688 模块、2299 依赖、44/44 strict）。修复只涉及不在 Vitest 范围内的桌面测试，未重复全量测试；不把前次 verify 的退出码改记为 0。
- 最终桌面 ESLint、预检边界自检、12 项 `--list`、相关格式检查及 `git diff --check` 通过；functional/synthetic 定向回归 2 套件、59 项通过。

任务进度为 1/14：仅 2.1 的场景定义与预检完成。其它 checkbox 包含真实运行或最终检查点义务，仍保留未完成。准备程序和现有工程门禁分项已核验，实机实例输入仍须补齐；本 change 不具备归档或功能 PASS 条件。

以上是工程证据。真实模型 smoke、功能 HTTPS、正式终态、可见交互和故障/恢复未在本轮执行，不继承旧临时目录为当前业务证据。

## 实机输入

目前四个部署/发布/桌面配置环境变量均未设置；旧功能 PostgreSQL/Qdrant 容器处于停止状态。本轮未启动或覆盖原实例。MinerU GPU 容器运行只证明该服务存在，不证明本次资料登记或完整业务就绪。

实际执行方须准备：

1. 新隔离 synthetic-acceptance 实例，实际部署配置、同发布清单和 000058 迁移账本；同库 C04/referenceGuard、PostgreSQL、Qdrant 与当前批准模型/OCR/Embedding 身份。
2. 受控根、同 uid 的 0600 普通秘密文件；登录密码文件使用准确密码字节。公开配置和命令行只给文件引用。synthetic run-config 含登录密码，须作为受限文件保存，不能提交或复制进报告。
3. MinerU V2 合格材料经本次正式 C04/C11 登记的真实新资料版本；现场/策略、C19 发布成员、C24 路线、C30 精确空间及当前授权，按正式回执绑定。
4. 同次运行计划、functional 配置/报告及其 `synthetic/run.json`；sharedObjectUrl 对应的精确查询回执和正式导出回执。导出业务引用为 `export-artifact`，D-28 的下载输入为具有相同实体/sha256 版本的 C04 `content-artifact`，沿现有报告模块映射核对。
5. 受信任的同源 HTTPS、真实不可信证书 HTTPS origin、另一未批准 HTTPS origin；两个独立登录主体。administrator 既能管理隔离成员，又被正式授予目标报告的工程/来源读取权。
6. 本次已受理的未完成运行和足够的正式 SSE 事件。先运行关窗场景；已完成任务无法证明关窗后继续，重连空流无法证明游标恢复。

桌面验收 JSON 的完整字段如下，值全部来自实际实例：

| 字段 | 来源/约束 |
| --- | --- |
| schemaVersion | 字符串 `1` |
| releaseId / projectId | 本次发布/工程，与部署、发布清单及正式报告一致 |
| loginName / passwordSecretFile | 工程业务测试主体及其受限密码文件 |
| administratorLoginName / administratorPasswordSecretFile | 上述兼具所需两类授权的测试主体及受限文件 |
| functionalConfigFile | 本次 functional 观察配置 |
| functionalReportFile | 本次 functional.json；同目录须有 synthetic/run.json |
| sharedObjectUrl | 同源 /report/export，带 project、sourceKind=query-result、sourceId、sourceVersion，与同次 projection.query 回执一致 |
| downloadArtifactRef | 原 ArtifactRefV1Schema；正式导出内容的 C04 content-artifact 精确引用 |
| invalidCertificateOrigin | 与批准 origin 不同、实际可达、证书不可信的纯 HTTPS origin |
| unapprovedOrigin | 与批准 origin 不同的纯 HTTPS origin |

## 取证顺序和命令

先填入本次受控文件路径，不使用仓库示例的虚构发布或工件引用：

```sh
export RISKFLOW_DEPLOYMENT_CONFIG=/absolute/path/to/deployment.json
export RISKFLOW_RELEASE_MANIFEST=/absolute/path/to/release.json
export RISKFLOW_DESKTOP_BUILD_CONFIG=/absolute/path/to/desktop-config.json
export RISKFLOW_DESKTOP_ACCEPTANCE_CONFIG=/absolute/path/to/desktop-acceptance.json
```

按既有运维契约显式初始化和预置：

```sh
pnpm acceptance:synthetic check --pack references/acceptance/synthetic-v1
node scripts/deployment/provision.mjs --config /absolute/path/to/provision.json --output /absolute/path/to/new-provision-report.json
```

预置不代替正式配置审核发布。取得真实来源及批准回执后，分别启动同发布 API/Worker 与同源生产 HTTPS，随后开始本次功能观察：

```sh
node scripts/deployment/start.mjs --role api --config "$RISKFLOW_DEPLOYMENT_CONFIG" --manifest "$RISKFLOW_RELEASE_MANIFEST"
node scripts/deployment/start.mjs --role worker --config "$RISKFLOW_DEPLOYMENT_CONFIG" --manifest "$RISKFLOW_RELEASE_MANIFEST"
node scripts/acceptance/functional.mjs --pack references/acceptance/synthetic-v1 --config /absolute/path/to/functional-config.json --output /absolute/path/to/new-evidence
pnpm exec playwright test -c playwright.desktop.config.ts
```

API/Worker 是独立长驻进程，分别在受控终端运行。桌面先取证未完成任务，再验证其它场景；人审须经正式页面确认，失败/等待按原身份续接。`--resume` 只用于同配置、同工作区和同次报告，不更换身份或扩预算。

之后在可见外部 Chrome 留下真实业务确认、拒权与跨页追溯证据；在隔离实例按 OPERATIONS.md 做回执失败重投、SIGTERM/同发布重启、新根恢复、损坏拒绝、索引重建及兼容/不兼容回退。保留原实例与双根。

失败 trace 可能含认证请求和资料画面，保存在受限证据目录，不作为公开报告分发。普通报告只保留安全引用、版本、命令、状态与计数，原始响应仍由 C04 权限保护。真实功能与必要审计完成后才创建 verification 并请求相应 Git/归档授权。
