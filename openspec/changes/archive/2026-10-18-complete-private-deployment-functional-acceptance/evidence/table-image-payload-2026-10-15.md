# D-46 表格图片载荷实施与实机接续

状态：图片载荷实现与工程回归完成，三份标准均已合格。C15读取边界缺陷修复和D-47共享边界已通过回归及v40新任务实际冻结读取，11张图片可见；新清洗在20次模型/工具后因5分钟授权上下文到期失败，详见[D-47续验](jsonld-read-bound-2026-10-15.md)。尚无新准备终态、知识发布或检索通过。tasks保持5/19。

## 实现

文档转换 SSOT 导出 strict `UnrecognizedTableImageRefV1Schema`，包含 kind=unrecognized-image、既有 ArtifactRefV1Schema 的 rawResponseArtifactRef 与安全包内 packageEntryPath。仅 cell/对应 TableField 可带非空、有界的 unrecognizedImages。图文单元格保留真实文字，纯图 value=null 并保留行列和合并关系；路径不进入 textBlocks、非空页或关键字段覆盖。

官网 ZIP 响应在 C04 耐久及复验后才解析，图片 src 必须在本包唯一解析，复用原 JPG/PNG 预检及资源边界；自闭合 img 只能带 src。外链、data URL、路径越界、缺失/歧义条目、危险属性及活动内容继续拒绝。原协议、模型及资源限制不变，不新增图片请求或通用文件工具。生产原响应为 diagnostic-artifact，整合时已将辅助实现误用的 ContentArtifactRef 收窄修正为批准的 ArtifactRef，测试覆盖真实诊断工件身份。

C15 冻结来源显示实际未识别图片数，切片按受选表格索引返回同表纯图单元格及行列/合并信息；图片引用计入对象用量，观察输入/输出字节计入原预算。相关 parsedFingerprint 包含同表图片，完整 jsonLdFingerprint 保持原逻辑；没有图片的输入沿原指纹。读取保持当前授权、C04 完整消费及 verified，不截断或扩大预算。

源码限提案规定的八个文件；测试扩展既有 core 文档转换、官网规范化/协议、C15 adapter 和 Worker 测试。未改 UI、HTTP、依赖、迁移、权限或主规格；不提交、归档、勾未完成任务或创建 verification。

## 工程验证

core 先取得 4 failed/6 passed，官网规范化先取得 1 failed/15 passed；应用实现后，最终七套件 148 项全部通过。新增场景涵盖图文/纯图/空单元格区分、JSON-LD 往返、诊断工件引用、安全路径、包内唯一解析、缺失/外部/歧义/伪装图片拒绝，清洗两种定位模式的源计数、同表纯图观察、图片变化指纹及对象超限。默认协议替身仍不能替代下面的真实转换证据。

`NODE_OPTIONS=--max-old-space-size=8192 pnpm build` 及同额度 `pnpm typecheck` 成功；全仓 lint、format、OpenSpec strict 44/0、diff 检查成功；`pnpm deps:check` 无依赖违规（695 模块/2332 依赖）。构建仍有原有大 chunk 提示。一次默认约 4GiB 堆的类型检查 OOM 已记录，按既有施工图的 8GiB 重跑通过，不据此修改业务预算。

辅助委派曾触发 Agent 数量上限，按项目要求以 gpt-6-luna 重试同样失败；core 辅助任务完成后已关闭，其余工作由父 Agent 实施。辅助实现的错误工件收窄、测试导入路径及格式补丁问题均已修正；最终结果以上述七套件和工程日志为准，不累计不同批次测试数。

日志保存在实例根 `logs/d46-engineering/`：core-red、core-green、parser-red、regression-complete、build-final、typecheck-complete、lint-complete、format-complete、strict-complete、deps。实例根为 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。

## 发布与运行

隔离发布 `functional-workspace-20261015-d46-v39`，配置 `deployment-d46-v39.json`，清单 `release-d46-v39.json`；制品 SHA256 `b8b1d8b1ef1a6b0f0b3624dffc395f1705d97cff750dec9b4592d875258fb2bb`，5993206 字节。此为工作区运行制品，HEAD 仍未包含累计 dirty，不是固定实现提交。

API 以 SIGTERM 正常关闭旧进程后启动新发布，仍通过 localhost:19443，同一实例/账号/数据保留；Worker 曾启动执行新清洗任务，失败后已SIGTERM正常关闭。新解析部署为 `mineru-official-functional@2026-10-15-d46`。清洗策略新版本 `physical-cleaning-policy@physical-20261015-d46-v1` 只把 D-45/D-46 正式转换部署列入兼容引用，原 Agent、覆盖率、保留率和预算深比较保持。

STD-002 已经同一 sourceItemId 的正式 C11 source-delivery 新登记为 `s_e262258290e088bf32d3faac957b3a6b@1`，原件摘要、元数据和原质量策略保留，非空页与关键字段仍要求 1。新转换身份 `physical-standard-original-v39-convert-STD-002-convert`；v36–v38 失败及历史版本保持。登记/转换配置和回执在 `standard-originals-v39/STD-002/`；执行日志 `logs/standard-conversion-v39.log`，API 日志 `logs/api-d46-v39.log`。

STD-002转换COMPLETED，189页全部非空、关键字段覆盖1，输出6046815字节、3057文本块、1721资料段、63表格/1809单元格。11张唯一图片对应11个纯图单元格，均保留本次ZIP原响应工件`document-service-raw-response-physical-standard-original-v39-convert-STD-002-convert-attempt-82@sha256:813ef70e4ce52d147910c50bb33504af6eb458aff88fe0dc037f9638a238d2e3`及包内路径，与本次layout所选原页块的img数量一致。正式核验结果为`standard-originals-v39/STD-002/qualified-conversion.json`和`qualified-table-images.json`，日志`logs/standard-qualified-v39-STD-002.log`。

物理Chrome经原件入口打开新source-version的PDF第75页，完整Canvas稳定后留图`chrome-standard-002-page-75-stable-v39.png`；父Agent已查看，确认原件表格及图形仍可见，未以解析文本替代。观察回执`standard-originals-v39/STD-002/original-page-75-observation.json`。

STD-001/003沿已合格v38引用，不重复重转。三项COMPLETED/QUALIFIED后，`prepare-standard-cleaning-v39.mjs`通过原HTTP命令创建19资料新任务`agent-task:synthetic-station-tunnel-project:data-cleaning-task-81ad506f528c74ac09d5697fcdbd5ced4941ca61@1`。首次422/BUSINESS_BLOCKED包含该真实任务引用，属于等待清洗。Worker启动后任务正式failed，safeError=AGENT_TOOL_FAILURE/worker.step，模型与工具用量均0，未生成准备成功。旧检索failed和原五资料父运行因果边界保持。

实际受权`loadFrozenInput`复现RangeError，原因是C15已有16MiB文档读取调用又被共享reader套用4MiB观察上限。原文件范围内移除错误的额外钳制，仍按各调用传入的文档16MiB/观察4MiB/清单上限执行，不改变模型或工具输出额度。扩展既有图片观察测试为大于4MiB、小于16MiB合法合成JSON-LD：完整文件33项中1失败/32通过，复现同一读取错误；早期仅按单例筛选因依赖前序fixture未建而失败，不作为有效红灯。回归通过后须冻结新制品及新清洗策略/命令，不复活原失败任务。

后续C17真实正文复核把4MiB候选包上限用于同一6MiB文档，已另经用户批准D-47修复；候选包/清单仍4MiB，文档/条目累计读取共享16MiB。具体范围及结果见[D-47提案](jsonld-read-bound-scope-proposal.md)与[续验结果](jsonld-read-bound-2026-10-15.md)，不是D-46内静默放宽。
