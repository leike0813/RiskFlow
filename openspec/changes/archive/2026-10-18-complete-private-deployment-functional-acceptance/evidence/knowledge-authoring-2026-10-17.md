# 知识编制实机取证

最终结果：正常编制任务`physical-d165-case-authoring-v157:start-task@1`已真实completed/version7，5真实模型响应、3工具、2候选、1纠错，78442输入/9725输出，attempt已完成且result_revision_ref绑定同一正式修订；第二候选通过确定性校验（retire-case×2、cite-case×2），形成`knowledge-revision-31467344-19ab-40ba-98b3-c871b43c3177@1`，随后经可见Chrome人工批准，正式发布为`knowledge-release-51754e5d-c577-4d60-a374-e917517d3aeb@1`，review-task为`review-task-e44d43c1-5558-486c-b606-821b9d1cb0f6@1`。送审前快照[formal-authoring-v157.json](/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical/d152-knowledge-authoring/formal-authoring-v157.json)的releaseCount=0只记录送审时点；发布后当前证据[normal-release-and-old-failures-proof-v157.json](/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical/d152-knowledge-authoring/normal-release-and-old-failures-proof-v157.json)核验C16正式发布与C17绑定均指向该正常修订，七旧失败任务state/budget不变、均已review-linked且正常result仍为空。决定UI回执[normal-authoring-decision-ui-v157.json](/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical/d152-knowledge-authoring/normal-authoring-decision-ui-v157.json)、发布回执[normal-authoring-release-v157.json](/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical/d152-knowledge-authoring/normal-authoring-release-v157.json)及审核前/批准后可见截图`normal-authoring-review-visible-v157.png`、`normal-authoring-approved-visible-v157.png`存于同一受限目录。

当前正式宿主以[handoff.md](../handoff.md)为准，本文件不再固定宿主。v155完整报告preview/export/download已200、21241字节且摘要匹配，见[report-export-v155.json](/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical/d155-report-export/report-export-v155.json)。本文件以下按轮次保留历史记录。

## v157轮记录

该轮宿主为`functional-workspace-20261017-d165-v157`（6052826字节，SHA-256 `1c68361b43898005b6d710f2c32080edd98ebff1eb0cfea5f72950a56a392581`）。D165仅在新不可变策略中将输入/输出额度分配为229376/32768，总和/context仍262144，模型/工具/纠错/重试等预算保持；旧任务不改策略。D161–D163正文读取、当前权限追溯和模型无损投影均已部署。浏览器完整回归在该轮尚有初评500，整体tasks仍6/19。

## 历史各轮记录

该轮宿主为`functional-workspace-20261017-d161-v154`，制品6050558字节、SHA-256 `6b4b9d6f9a289242ce605bf116fbf35405da9d0a43368c90b41f40da52432fac`，tracked diff `a04005497370ab7daea6ae7f431c0695ba633b0542ffd0b63262f321ad880f46`，tar比较通过。D161经同一真实C15清洗manifest及JSON-LD/证据片段返回原textBlocks，保留正文、版本、定位及已有置信度，规范正文核验共用原读取。C17全部26项、Worker23项及build/typecheck/lint/format/deps/strict/diff通过。

v152独立任务version6/input-quota终态，7次账本模型行动含一次调用前拒绝，6真实响应106166输入/7227输出，5工具/1候选/154对象/1纠错。`correction-input-proof-v152.json`证明下一输入含完整候选v1与increment-target-exists校验，但剩余额度不足。v154新独立任务同父/16资料/正式基线，version3/input-quota终态；4次账本模型行动含一次调用前拒绝，3真实响应84049输入/4670输出，3工具/149对象，无候选及纠错。五旧任务和这一新失败均未重开。

D160已在v153实机把v148/v149/v150/v151/v152五旧失败全部推进`review-linked`，详见`failure-settlement-v153-*.json`。复核分别为700dfef5…、36791ef5…、1cc75455…、14560d2b…、b85179af…；targetRef关联各自真实失败诊断修订。五旧失败任务的正常`result_revision_ref`仍为空，不把失败诊断当正常知识编制，也不发布。控制来源仅从精确任务信封恢复，失败仍经C08公共窄读取证；C16使用处理时点真实当前基线。

D162修C22追溯因完整旧授权摘要全等而误拒已登记来源的读；D163对模型观察去除重复请求段ID与文本块内部版本/相邻链，完整正文/块标识/段/来源/坐标/置信度及基线保持，并提供真实剩余额度，硬预算不变。两项工程回归通过，离线原v154输入投影证明及下一制品当时在途，该轮尚无正常知识编制终态。

该轮整体任务仍为6/19；知识编制启动或工程检查通过不代表业务终态通过。受限证据位于原隔离实例的`d152-knowledge-authoring/`，本索引只记录身份和结果，不复制凭据、Cookie、资料正文或模型内部思考。

D152修复前，生产模型只收到不透明工件引用。修复后从真实C15准备读取冻结定位、经原领域工具读取所属观察，再提交类型化候选。C17/Worker定向47项、Worker/宿主92项及build/typecheck/lint/format/deps/strict/diff通过。v148制品SHA-256为`883604990e661933b39171391491e86d1663b730f96aeeec664b3fc01d8caeea`，6052849字节，tar比较通过。

真实父运行`risk-flow-run:synthetic-station-tunnel-project:identify-and-assess:e1c7393215d8e8afda5708972145b322`已返回202/knowledge-preparation等待，完整版本见`parent-started-v148.json`。任务`agent-task:synthetic-station-tunnel-project:physical-d152-case-authoring-v148:start-task@1`消费原五资料准备，实际8模型/7工具、81635输入/3361输出，候选通过领域校验，最终提交在validation事务前失败。任务version3/terminal-failure、原消耗、候选包及校验工件保持；无正式修订，不复活失败任务。详见`task-read-v148-*.json`和`submit-artifact-diagnosis-v148.json`。

`reference-scope-proof-v148-corrected.json`证明该轮25项来源授权可读候选，空来源verify结果的0项grant被事务引用守卫正确拒绝；早期错误能力常量的proof不作为通过证据。D153保留原入口及复验结果的主体/工程/能力绑定，拒绝redacted，再由可信来源签发该轮完整范围；finalizer透传manifest固定基线。先红复现后C17全部25项通过，含该轮拒权和已有发布基线更新。旧缺基线诊断仅证明C16既有门禁，不是v148首个失败点。

新任务固定正式案例基线`knowledge-release-dbf33d14-919f-4f06-a18f-3e650a541504@1`及其原16资料准备`identification-preparation-a968bf3d16c9fcddbecbce46a46ee456e2e5cdae@1`，6个基线条目的来源为`s_d2261a936ce020e7b101e6d3ecd3d764@1`，均经当前C17窄读核验，见`baseline-read-v148.json`。新任务`agent-task:synthetic-station-tunnel-project:physical-d153-case-authoring-v149:start-task@1`在同一仍活动父下启动，见`task-started-v149.json`；随后version3/terminal-failure，3模型/2工具、85449输入/2566输出、零纠错/重试。`candidate-diagnosis-v149.json`证明模型直接cite已有案例标识、真实基线摘要匹配，领域正确返回repairable；C17 Agent校验工件误用包校验用途，被C08的agent-validation用途守卫拒绝，候选未登记、无正式修订。D155原生产manifest测试先红复现该差异，该轮修复及回归在途；两旧失败和预算保持。

历史v149制品SHA-256为`4749af2bc6256ad82b54e13343ba04a0ea133831369d9c72b2549259eb448fb0`，6052429字节，tracked源码/测试diff为`7ba2ac18d4196750dd2f5681924b41ac4b8759713c55d6ddac1486a4fcda74d9`。最终build/typecheck/lint/format/deps/strict/diff通过；D154桌面正式overview导出/运行观察分离的预检先红后绿，该轮真实Electron全部场景尚未完成。

D155用途修复已部署v150，候选v1终于登记为repairable拒绝，任务最终version6/terminal-failure：4真实模型响应116672输入/2849输出，第5次模型尝试在request.input-quota调用前拒绝，失败及消耗保留。D156将595个定位按公共前缀/全部后缀无损投影，定位JSON45049→24720字节、Schema21995→5349字节，仅限定当前目标/下一版本，不改正式Schema、工具或预算。107项及组合根14项、build/typecheck/lint/format/deps/strict/diff通过，发布v151。

该轮宿主`functional-workspace-20261017-d156-v151`制品6052487字节，SHA-256 `16ff540f1b2f5fdd938ddf52a74a896d234110a9c9f6ae420fcd527e5e1a0c58`，tracked diff `bfcb9947c54a5871706fd30556019c6050e713163bb3ec900dc065c80e5c28ad`。其独立任务`physical-d156-case-authoring-v151:start-task@1`仍使用同一真实父/16资料/正式基线，前三响应输入33975，最终version10/terminal-failure，7真实响应123239输入/8545输出，4工具，3候选/122对象，纠错3超过max2，budget.settle.corrections终止。最后行动实际25542输入/700输出，已发生消耗如实记录，不能描述为模型前拒绝。三版均有increment-target-exists，`tool-selection-proof-v151.json`证明已读正确基线和真实资料。

D157共享宿主授权复验修复已通过根/C17共111项及C35数据库9项，该轮尚未部署；D158补通用Runner最新被拒候选/完整校验反馈，32项回归通过，该轮工程检查在途。四旧失败任务不复活；该轮失败人工复核还存在控制来源与当前基线缺口。原五类任务的知识编制完成项、失败人工复核、会话、完整功能报告及恢复/运维证据在该轮不能据此提前勾选。
