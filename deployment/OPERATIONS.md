# RiskFlow 运维手册（C37 D-01/D-08/D-09/D-10）

当前 C37 按 [功能验收手册](ACCEPTANCE.md) 使用合置服务及批准网络模型；实际三 VM、正式客户端和本地 GPU 取证归 C38。下文保留最终拓扑及已实现运维契约，配置检查和工程测试不等于现场部署已通过。

本手册覆盖三 VM 私有部署的日常运维。**系统不提供独立备份、高可用、
生产级 RPO/RTO 或长期代运维**；同机副本只用于逻辑回退。

## 1. 拓扑与入口

| VM      | 运行内容                                                                               | 业务用户可达       |
| ------- | -------------------------------------------------------------------------------------- | ------------------ |
| 推理 VM | 主 4090 上的 Qwen3.8-27B；辅助 NVIDIA GPU 上的 MinerU 专用模型（GPU 直通、按服务隔离） | 否                 |
| 应用 VM | Web、API、Worker、Caddy HTTPS                                                          | **是（唯一入口）** |
| 数据 VM | PostgreSQL、Qdrant、不可变工件                                                         | 否                 |

## 2. 日常启停

启用原件读取时按配置示例提供`sourceOriginal`：专用绝对暂存根、maxBytes=104857600、maxConcurrentReads=2、maxTemporaryBytes=209715200、timeoutMs=120000。暂存不是第二份永久原件或备份；API完整核验C04后才传输，取消/失败清理，请勿让其他服务共用该根。PDF所需worker/CMap/字体资源须随Web构建提供；不依赖CDN。Electron使用系统证书信任链，勿以忽略证书错误替代CA配置。

当前功能实例的准备及取证顺序见 [实机准备记录](../openspec/changes/complete-private-deployment-functional-acceptance/evidence/readiness.md)。部署前按发布清单执行到000059迁移，再核对purpose、配置、模型和受限秘密文件。000059保存派生发布来源及批准知识条目，原人工发布与业务结果继续可读。已有派生发布的实例回退时使用匹配版本的恢复点。工程回归使用隔离容器，现场部署另留记录。

MinerU 使用自托管 4.0.12 V1 tasks；PDF/图片为 Standard，DOCX 为 Flash。通用 Qwen 不能替代专用布局 VLM。设备 UUID、推理 backend、模型制品、显存/内存配额和并发必须在 C38 实测冻结；CUDA 的设备变量不能证明 Vulkan 的隔离。Embedding 当前由独立 Ollama 主机提供，移到辅助卡前须另核验资源预算。

文档配置见 [MinerU 配置示例](mineru-config.example.json)。将明确选定的配置放入 `documentConversion.mineru`，替换示例引用并通过部署 Schema 校验；`null` 仅表示未配置，PDF/图片/DOCX 转换会阻塞。服务 token 仅经受限秘密文件注入，XLSX/CSV 不依赖 MinerU。

更换转换部署或策略时，先通过正式 C11 入口登记资料新版本，再转换并完成本代清洗、知识审核/发布和检索构建。已登记资料段的旧版本不原地重跑；只更换 conversionId 不能建立新代际。保留全部历史工件、段集合和评估引用。

新清洗策略使用 `schemaVersion: "2"`，通过 `documentRules` 配置每类资料的可用结构。例如 CSV/XLSX 使用 `{ "inputKind": "csv", "requiredSegmentKinds": ["table"] }`（XLSX 将类型改为 `xlsx`）；DOCX、`text-pdf` 和 `ocr-layout` 可配置 `["chapter", "table"]`，保留内容具备其中一种即可。空白页沿转换记录追溯，不要求每页都有正文。受保护段与监测样本、文档覆盖要求仍按策略执行；普通内容被排除后可以形成部分可用结果。旧 V1 策略继续按原规则重放。

运行清单在`projectBindings[].policyRefs`列出各阶段已有策略。评分准备只解析八类评分配置，预警、处置、预测和校准分别在开始时选择并固定自己的策略。后续配置缺项显示待准备，补齐后继续原等待；已开始任务使用原预算与版本。策略批准保留批准人和日期，可随兼容的软件版本继续使用。

Agent预算在策略目录`budgetPolicies`唯一登记。清洗V3、知识编制/检索审阅/评分编制/处置Agent/校准V2只保存`budgetPolicyRef`，由目录补出原运行对象。候选生成V2引用同目录的`risk-candidate-budget`，其余Agent引用`agent-task-budget`。例如：

```json
{
  "schemaVersion": 1,
  "projectId": "project-rail-01",
  "policyType": "risk-candidate-budget",
  "policyRef": { "entityId": "candidate-generation-budget", "versionId": "v2" },
  "approval": { "approvedBy": "risk-manager", "approvedAt": "2030-01-01T00:00:00.000Z" },
  "body": {
    "maxCandidates": 64,
    "maxOutputBytes": 1048576,
    "maxTotalTokens": 65536,
    "maxWallClockMs": 1800000,
    "maxRepairRounds": 2
  }
}
```

数值为编写目录的示例，实际任务使用本工程批准的预算。候选生成成员保留`policyRef/outputSchemaRef/budgetPolicyRef`并设`schemaVersion: "2"`，预算正文只写在上述目录项。其他Agent的目录正文复用`AgentTaskBudgetPolicyV1`，包括模型、提示、工具及数值上限，子策略保留业务参数和预算引用。

官网 hybrid 的原页定位使用 `preproc_blocks`，段落合并后的 `para_blocks` 不作为第二份正文。没有原页块却带跨页标记时明确拒绝；公式原始 LaTeX 保留于规范化正文，不执行或计算。合成验收使用 `references/acceptance/mineru-v2/manifest.json` 的新投影及源字段清单，历史 V1 文件保留；新投影路径不表示已登记生产资料版本。

按顺序启停，不要颠倒：

**启动**：数据 VM（postgres → qdrant → artifacts）→ 推理 VM（model）→
应用 VM（api/worker → caddy）。caddy 最后启动，确保入口在依赖就绪后才对外。

**停止**：应用 VM 先停 api 与 worker（停止接收、停止 claim、限时 drain），
再停 caddy 与 artifacts。**停止顺序颠倒会在仍有写者时生成副本。**

关机期限必须大于配置的 `worker.drainTimeoutMs`；到期被强杀会留下未确认租约，
必须按原恢复语义接管，不得重开任务或扩预算。

## 3. 维护窗口与同机逻辑副本

固定顺序，不可颠倒：

1. 确认全部目标工程的恢复级授权与磁盘容量；
2. 取得三 VM 的停写回执，确认无未知写者、无在途写入；
3. 逐工程生成并**完整消费** C04 哈希清单；
4. 完整逻辑导出数据库（含业务、身份、审计、Outbox、checkpoint）；
5. 复制全部耐久工件，**含本批清单本身**；
6. 耐久发布 descriptor 与运维审计。

任一步失败只产生失败或待核验状态，不产生可用恢复点，也不自动清理 staging。

## 4. 隔离恢复与切换

1. 恢复到**新的**隔离数据库与工件根，原实例保持不动；
2. 完整核对全部工程，再产生新诊断工件；
3. 从正式事实重建 Qdrant/BM25，并通过原就绪门（空索引不算成功）；
4. 人工确认精确目标后切换；输入变化必须重新确认；
5. 切换失败保留双根，按记录显式回退，不自动删除任何一端。

完成副本核验后，使用独立 Qdrant 为原 active 代际重建双索引。运维任务 JSON
包含 `operationId`、`sourceConfigFile`、`configFile`、`manifestFile`、`projectId`、
`generationRef`、`loginName`、`passwordSecretFile`、`requestedSpatialScopeRefs` 和
`requestedSourceVersionRefs`。配置、发布清单及原代际引用均使用精确版本；口令只放在
受限秘密文件中。目标实例、数据库、工件根和 Qdrant 必须分别独立于源实例。

```bash
node scripts/deployment/restore.mjs --job /secure/restore-generation-job.json --output /secure/restore-generation-result.json
```

该命令使用当前用户权限读取原发布事实，重新生成向量并通过原双索引对账及质量门，
仅写独立投影与运维审计，不启动 Worker 消费循环，不重投已完成事件，也不改变原
消费回执或激活序号。输出文件必须不存在；失败保留诊断与双根，不能据此进行切换。

## 5. 升级与回退

软件、模型、Embedding 与业务定义分别发布。兼容的旧发布可在维护窗口人工切换；
**不兼容的数据库或工件版本必须先构造匹配副本的隔离实例，不能只换旧镜像**。

当前合置功能宿主使用已构建的发布目录及正式启动入口。先在受限操作记录中固定
源/目标发布、清单摘要、配置摘要、数据库名、工件根、Qdrant、API 端口和旧进程 PID。
目标配置的 `api.port` 必须与源不同，配置和清单的 `releaseId` 必须一致。保留原配置，
不原地改写。以下路径均须替换为本次记录中的精确绝对路径：

```bash
cd /opt/riskflow/releases/selected-release
node scripts/deployment/start.mjs --role api --config /secure/target-config.json --manifest /secure/target-release.json
```

在独立终端以前台方式启动目标 API；正式启动会检查实际迁移兼容性。若拒绝，保留
失败日志和原入口，不启动该目标的 Worker、不切换 Caddy，也不修改清单迁移号绕过。
目标可读后，使用当前会话经其临时受信 HTTPS 入口核对原业务精确引用、权限拒绝及
同一命令重放。准备目标 Caddy 配置，仅将反代端口和静态发布根指向目标，证书和同源
路径保持；先验证配置：

```bash
caddy validate --config /secure/Caddyfile-target --adapter caddyfile
```

在停写窗口向记录中的源 API/Worker PID 发送 `kill -TERM <pid>`，等待两端正式
`stopped` 回执且 `count=0`。未排空则不切换。按 `createActivationPlanV1` 固定目标，
由操作者核对同一目标并调用 `confirmActivationV1`；通过 `activateTargetV1` 的
`switchTo` 执行下列入口动作。目标或发布变化须重新确认，不能沿用旧确认。

开启本机受限管理端口的 Caddy 可加载已验证配置：

```bash
caddy reload --config /secure/Caddyfile-target --adapter caddyfile --address 127.0.0.1:2019
```

使用本仓库 `admin off` 配置时，reload 不可用：向精确 Caddy PID 发送 SIGTERM，
确认退出，再以前台 `caddy run --config /secure/Caddyfile-target --adapter caddyfile`
启动。按现场服务管理器保持前台进程，不使用通配符杀进程。源 Worker 排空后才在
目标发布目录启动目标 Worker：

```bash
node scripts/deployment/start.mjs --role worker --config /secure/target-config.json --manifest /secure/target-release.json
```

切换后经原 HTTPS 地址重新登录，检查业务读、权限拒绝、原命令重放和 Worker 就绪，
保存实际进程/发布及回执。任一步失败，停止目标写者并按同样顺序用保留的源配置、
源发布及源 Caddy 配置显式恢复；保留双根和失败记录。不兼容回退只允许启动与旧发布
匹配的隔离副本，当前数据库不能接给旧发布；没有匹配副本时记录拒绝及未完成恢复，
不能将兼容探针或配置验证写成实际回退成功。

## 6. 故障排查

任务completed与等待它的父运行completed分别取证。当前Worker完成内嵌任务后，不自动发送父运行完成通知；有权运维/验收驱动须读取C08正式agentTaskResultRef及C34父运行当前stateVersion.versionId，再沿既有workflow.resume-run提交agent-task-completed原因，保存原命令及回执。不得用任务completed代替父运行终态，也不重开旧失败任务。实机命令/回执及同发布SIGTERM/count0边界见[本轮收口](../openspec/changes/complete-private-deployment-functional-acceptance/evidence/batch-closeout-d189-d190-2026-10-17.md)。客户端关窗后重开时，先确保API就绪；会话自省失败沿产品恢复按钮重试，不能把无登录框当成已登录。

| 现象                     | 首先检查                                             |
| ------------------------ | ---------------------------------------------------- |
| 入口 404 / 白屏          | caddy 是否在运行；`/api/*` 未匹配时是否仍是 404 JSON |
| 业务页停在「权限检查中」 | 会话自省是否成功；证书是否被本机信任                 |
| 就绪检查失败             | 四组件探针：API、Worker、模型、数据库                |
| 副本不可用               | 是否完成了清单消费与 descriptor 耐久发布             |
| 桌面客户端无法连接       | 私有 CA 是否进入系统信任链；不得关闭证书校验         |

日志只含稳定状态、原因码、引用与计数；不记录正文、秘密、URL、宿主路径或思维链。
业务审计以 PostgreSQL 只追加记录为准，普通日志不能替代。

# 本机 MinerU 固定服务

本机可复用服务已部署，见 [MinerU 服务操作说明](mineru/README.md)。独立Docker镜像和持久化目录保留模型及结果，GPU实例健康运行于回环18000，CPU对照实例18001已停止；小模型固定ONNX/CPU，专用VLM显式使用Vulkan或CPU。五格式与五页扫描件的CPU/P4 Vulkan质量和性能实测、重启及重启后转换已通过，证据见[本机报告](../references/acceptance/mineru-v2/local-benchmark-report.md)。启停通过Compose，镜像/模型准备与真实smoke分开执行；停止或重建服务不删除模型和历史结果。
