# C19正式组装入口与合成来源策略补充提案

状态：用户已批准提案并要求继续验收。归属当前change的IP-17/IP-19，落实为D-39；批准不代表功能已通过验收。

## 已核实的边界

现有`provision.mjs artifact-put`与`knowledge-modeling.submit-revision`、`request-review`、`publish-approved-release`足以登记并治理评分配置包。继续使用既有配置包正文分支，不增加HTTP上传，也不伪造评分Agent任务。候选文档从同一包确定性生成，沿原校验核对包、成员及来源。

`PostgresScoringRulesAdapter.assembleApplicableRuleSetRevision`已有筛选和候选收口逻辑，但没有contracts端口、HTTP路由或正式CLI调用者。部署`createDeploymentScoringGovernanceV1`只暴露policy/basis，内部`submitRevision`仍直接抛`DEPLOYMENT_SCORING_AGENT_AUTHORING_UNAVAILABLE`。测试宿主可以组装，当前正式宿主不能完成此步骤。`governance-read`已能读取发布后的适用规则集，无需再造读取接口。

当前实例评分策略`physical-scoring-rules-policy@physical-20261014-v1`只接受`national/industry/enterprise`。真实评分材料是技术验收合成输入，来源类别为`synthetic-scoring-rule-values`；正式准备的3条规则、33个真实来源段在现策略下被`scoring-rule-source-kind-invalid`拒绝。本轮只在内存预览拟议策略，内容校验通过，未改运行策略、提交候选或发布规则。证据位于实例`governance-publication-v15/scoring-configuration-package/`。

## 申请批准的公共契约

增加类型化命令分支`knowledge-modeling.assemble-applicable-rule-set`，HTTP为`POST /api/v1/projects/:projectId/commands/knowledge-modeling.assemble-applicable-rule-set`，命令kind为`assemble-applicable-rule-set`，通过独立窄端口`ApplicableRuleSetAssemblyPortV1.assemble`接既有C19算法。属于创建待审候选的治理操作，映射现有`knowledge-modeling.govern`能力，不增加角色或授予任何新权限。

沿用现有HTTP命令信封、命令/幂等身份与当前会话；strict payload只含：

| 字段 | 含义 |
| --- | --- |
| preparationSnapshotRef | 精确评估准备快照，复用已有引用Schema |
| requiredAt | 本次规则及配置解析的业务时刻 |
| scoringPolicyRef | 当前工程批准评分策略的精确版本 |
| assemblyPolicyRef | 同一评分策略中组装策略的精确版本 |
| compatibilityRef | 同一评分策略的精确兼容身份 |
| configurationSetRef | 本次解析所要求的精确C18配置集合 |

工程、actor和授权取服务端信封；工程修订、适用性引用和值只取C11生产准备投影；记录时间边界取命令`issuedAt`。调用方不能自报适用性、规则成员、来源正文或人工决定。结果沿标准ModuleResult表达成功、waiting或failed；成功仅含`applicableRuleSetRevisionRef`与`applicableRuleSetArtifactRef`，不等于已发布或可评分。

服务端先复验当前治理权限，再为同一真实调用来源签发有界的`knowledge-modeling.assessment-basis`授权读取C11/C18/C19；回调提交修订时独立取得`knowledge-modeling.submit-revision`授权。两种能力均须当前真实可授予，不能把读取上下文当作治理权限，也不能用系统身份补位。原空间、来源、actor、调用身份和受信请求作用域贯穿整个流程。

复用现有C19确定性组装、C04工件、C03回执与C16修订。按主规格现有要求补齐组装入口对准备/工程修订/适用性值、评分/组装/兼容版本及真实C18集合的一致性核验，任何不符在候选成功写入前拒绝。规则集只消费原规则关系与精确冲突决定，不另写筛选算法。内部提交命令由父命令确定性派生；同键同载荷返回原引用，同键异载荷冲突，重放先复验当前权限。工件和修订分阶段失败沿原身份恢复，不声称跨阶段单事务，保留原审计。

之后仍通过既有C07人工确认和C16独立发布；不增加发布捷径，不启动评分规则Agent编制。

## 申请批准的验收配置

只在当前隔离`synthetic-station-tunnel-project`的新评分策略版本`physical-scoring-rules-policy@physical-20261015-v2`中，把`synthetic-scoring-rule-values`加入原来源类别集合；沿用原兼容、组装、优先级、模型、预算与其它确定性质量约束。冻结新目录与部署/发布身份后显式切换API/Worker；旧策略、旧运行和拒绝证据保留。

本次规则包明确引用该新策略、真实工程修订、已发布C18集合及33个真实来源段。它始终是合成技术验收数据，待甲方复核，不被归类为国家/行业/企业真实标准，不写回原合成包或既有业务事实。

## 文件清单与实施验证

批准后在当前change同步proposal/design D-39、implementation-plan IP-17/IP-19及tasks，新增`domain/module-interfaces-events-workflows`、`knowledge/structured-scoring-rules-and-applicable-rule-sets` delta，并扩展已有HTTP平台delta；不直接改归档主规格。

| 文件 | 变化 |
| --- | --- |
| packages/contracts/src/ports/index.ts及既有ports测试 | 新窄命令、结果、端口和分支能力映射；公共引用复用SSOT |
| packages/core/src/scoring-rules/schema.ts、service.ts及既有scoring-rules测试 | 复用内部请求/结果及入口映射；不重复公开字段定义或组装规则 |
| packages/adapters/src/scoring-rules/postgres-scoring-rules-adapter.ts及既有对应测试 | 接新窄端口，按真实准备/配置/策略复验，回执与失败恢复 |
| apps/api/src/http.ts、app.ts及既有http-shell测试 | strict命令路由与端口分派，拒权及不支持契约保持原错误结构 |
| scripts/deployment/start.mjs、composition/api-ports.mjs及既有entrypoints/api-ports测试 | 原C19实例暴露组装，SingleBinding连接真实C16提交，宿主完整性检查 |
| 当前change工件、evidence及必要deployment/ACCEPTANCE.md、OPERATIONS.md | 记录新增调用与精确实跑引用；不改UI布局 |
| 受控实例目录的新策略、部署/清单、评分包及验收脚本/回执 | 生成新版本，旧文件不覆盖，不包含公开秘密 |

不增加依赖、数据库表或迁移，不安装软件，不提交或归档。若实施发现上述范围外公共契约再升级。

最小验证：相关contracts/core/adapter/HTTP/entrypoints/api-ports既有测试，覆盖成功组装只产生待审修订、准备/适用性/配置/策略错配、未决冲突、撤权与跨工程拒绝、原身份重放及异载荷冲突。执行build、lint、相关format、strict和diff检查；随后在当前物理Chrome经正式入口组装、自然确认、独立发布，并从正式governance-read与assessment-basis核对原链引用。真实RI/RA和完整功能报告仍需后续实跑。

## 请求决定

是否批准以上组装命令/部署接线及当前隔离实例的合成来源新策略版本？批准后先补OpenSpec工件再实施，继续评分发布和识别评估验收。
