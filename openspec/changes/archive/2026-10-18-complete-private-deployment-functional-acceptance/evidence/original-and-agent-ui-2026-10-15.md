# 原件浏览与 Agent 界面修正实跑

用户批准原件、Agent、C17证据身份及复核动作修正方案后实施。当前验收服务为 `functional-workspace-20261014-original-agent-v14`，HTTPS入口仍为 `https://localhost:19443/`；系统443保持释放。此记录证明本轮修正，不表示整个功能change或C38交付通过。

## 实现

资料目录显示真实名称，详情默认打开精确版本的原件。原件信息与二进制分别经当前会话、C11历史来源读取和C04完整核验；临时根为0700、文件0600，原件上限100MiB、并发2、暂存200MiB、读取传输120秒。失败或断连清理暂存，拒绝Range与任意工件/路径；当前授权收窄后拒绝新读取。

PDF.js及worker、CMap、标准字体和解码资源随发布本地提供。实跑发现缺CMap会令中文PDF空白，补齐后已实际绘制页面。PNG/JPEG显示原图，CSV按UTF-8严格解码显示原文本；DOCX/XLSX下载原字节供用户自行使用本机软件打开。旧资料没有上传文件名时如实标出；新增登记支持独立originalFileName。

RightDock接入唯一AgentTaskProvider。正常业务页可打开Agent标签、选择真实任务，进入工作台和详情；无证据时不再自动关闭。展示安全行动、输入/结果引用、逐次Token用量、累计预算、候选校验和正式结果引用。候选投影改取实际validation.validationArtifactRef；不以任务结果引用替代校验工件，不展示思维链或原响应。

Electron保留系统保存框，仅放行批准同源原件路径和登记报告用途。实机另发现certificateVerifyProc固定回调-2导致所有证书均被拒，已删除该覆盖，恢复Chromium默认信任链；主框架不再误走子框架一律拒绝分支，同源主框架和子框架分别按既有策略判断。

## 物理证据

实例根：`/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`。以下文件均在此根下，受限原件及秘密不进入仓库。

- `original-agent-v13/chrome-original-result-v13.json`：物理Chrome逐一读取已登记文本PDF、扫描PDF、PNG、JPEG、DOCX，下载字节与原上传文件完全相同。相邻`chrome-*-rendered.png`留实际绘制/原件入口。PDF检查实际非空画布后截图；Office只计原件下载，不计网页排版。
- `original-agent-v14/original-csv-xlsx.json`：新增两份纯浏览合成资料，CSV196字节、XLSX5971字节，均只登记、未转换；下载逐字节一致，CSV预览与原UTF-8文本一致，新上传文件名保留。这两份不加入此前v9清洗或准备快照。
- `original-agent-v13/history-and-agent.json`：清洗任务a968bf3d…按25+2续页显示27条真实行动；候选1可打开校验。旧转换失败DOCX `s_419b945c8eec5b35a77404c1969901f6@1`仍显示解析失败，但原件GET200、2784字节，不重做转换。
- `native-save-v13c.log`及`original-agent-v12/native-save-result.json`：Electron在物理显示器`:0`弹出真实保存框。第一次取消返回cancelled、保存路径为空；第二次手动选择验收专用路径，返回completed，DOCX37446字节与原上传文件完全一致。通过现有xdotool操作原生窗口；orca computer因缺python3-gi/AT-SPI不可用，未安装系统依赖。
- `original-agent-v13/electron-boundaries.json`及相邻截图：真实Electron绘制中文PDF并缩放、打开共享Agent任务及详情；非登记同源下载在will-download被拒，外域主框架导航被拒。桌面测试宿主改用Electron原生下载事件，检查产品策略取消后才决定是否为测试选保存路径。
- `governance-publication-v13/process-model/`：原16份准备来源必须全部显式声明。正式修订`knowledge-revision-cc321b65-a5d9-4603-9ac2-75adbeec9680@1`，物理Chrome确认后决定`review-decision-8ea93946-5b62-41b2-860a-9419cdcaa5ab@1`，独立发布`knowledge-release-cd18006c-59f5-46be-bb94-737544bcf472@1`。
- `governance-publication-v14/configuration-publication-completed.json`：11类C18配置逐份在物理Chrome打开pending详情、自然点击批准及确认，取得正式决定和独立发布回执。合成批准不代表甲方业务批准。此前空的summary及失败尝试保留，只有outcomes为11的completed文件作为证据。

补验新资料时，最初临时provision输入少一层payload，失败记录保留。正式HTTP资料登记已成功；修正格式后以新命令再次登记同一delivery被BUSINESS_BLOCKED，不计CLI通过。没有因此修改生产provision代码或重写已有资料。

## 工程验证

- 完整build通过，使用8GiB Node堆；已有大chunk提示保留。
- HTTP壳46项、C11真实数据库43项、C08真实数据库14项、C17真实数据库21项、Worker C17组合14项通过。C11最后一项扩展了真实C06挂起工程后旧原件授权失败的断言，原件信息与内容不继续披露。
- Web单元/SSR共50项、Desktop安全与打包13项通过；最终HTTP+Desktop定向55项通过。桌面14场景可编译列出，完整运行仍依赖同次functional正式报告。
- 部署脚本14套件334项通过；C17组合与API装配定向20项通过。
- 浏览器Agent套件12项和只读套件除本轮新增资料用例外16项通过。新增资料用例先后暴露测试相对URL及HTTP Secure Cookie传输错误，改由页面自身同会话fetch后单独复跑通过；失败及重试trace保留，不称该29项命令全绿。
- ESLint、相关Prettier检查、依赖边界及依赖策略、git diff --check通过；全仓OpenSpec strict为44通过、0失败。未重复运行全仓verify和完整browser/desktop功能验收。

## 发布与后续

v14运行制品SHA256为`57c2718ed8394bfe05db70493e81649e4e1378fb9c9b89114828fa5026650269`，5728395字节。源码HEAD仍为`31ad1a2c47a377f20179e0008241034c14a3bec5`加未提交改动，不是新的固定实现检查点。发布身份见`original-agent-v14-workspace-identity.json`；没有提交、归档、生成verification或修改旧任务预算。

本轮原件/Agent/治理接缝已实施。后续继续其余知识发布、C19评分配置/适用规则集、正式检索及RI/RA与剩余必经Agent终态，然后生成同次functional、完整Electron/Chrome以及重启恢复报告。完整change原14项义务保留；C38的跨VM、禁网、4090/辅助GPU及签名多平台取证未执行。
