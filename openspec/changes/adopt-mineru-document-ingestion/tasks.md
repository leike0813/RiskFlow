## 1. 共享接缝与源结构

- [x] 1.1（IP-01）泛化服务解析接缝、格式路由与点/像素坐标Schema；验证：`pnpm exec vitest run packages/core/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion.test.ts`。
- [x] 1.2（IP-02）源预检、DOCX补元信息与XLSX包内绝对关系修复；验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion.test.ts packages/adapters/test/engineering-data/document-conversion/mineru/normalization.test.ts`。
- [x] 1.3（IP-08）修正PDF分页和扫描投影，以新版本保留旧样例并生成五格式源字段清单；验证：`uv run --project="$HOME/.ar" --locked -- python scripts/acceptance/generate-materials.test.py`及新投影内容自检。

## 2. MinerU 协议与规范化

- [x] 2.1（IP-03）官网/自托管显式协议、网络边界、预算、取消与C04耐久；验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/protocol.test.ts`。
- [x] 2.2（IP-04）已确认Middle2.0规范化、表格跨度、无伪造置信度、质量门；验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/normalization.test.ts`。
- [x] 2.4（IP-04/IP-07）官网原页块、跨页标记和公式映射及逐记录字段验收；验证：`pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/official-normalization.test.ts packages/adapters/test/engineering-data/document-conversion/mineru/acceptance.test.ts`。
- [x] 2.3（IP-03/IP-04/IP-07）取得真实官网ZIP、冻结实际消费字段并验PDF/扫描PDF/PNG/JPEG/DOCX样例；验证：`MINERU_REAL_SMOKE=1 MINERU_SMOKE_SUITE=references/acceptance/mineru-v2/manifest.json pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts`。五格式源字段、记录关联、页数和共享JSON-LD合规均通过；隔离parser证据不替代C37生产入库验收。

## 3. 装配与交付边界

- [x] 3.1（IP-05）替换部署配置/装配与预置入口，保持正式新资料版本与历史输入；验证：`pnpm test:deployment`及`pnpm exec vitest run packages/adapters/test/deployment/config-operations.test.ts`。
- [x] 3.2（IP-06）配置样例、AGENTS/运维验收手册、C37引用与C38双GPU/质量/介质移交；验证：`pnpm test:deployment`、`openspec validate adopt-mineru-document-ingestion --strict --no-interactive`及文档对照。

## 4. 回归与收口证据

- [x] 4.4（IP-09）按用户授权修复现有16项lint错误，保持行为并运行受影响回归；验证：`pnpm lint`及模型/部署目标测试（88项通过，真实模型smoke默认2项跳过不计外部验收）。

- [x] 4.1（IP-07）删除无调用Paddle实现/导出/协议测试，保留有用扫描样本与权限证据测试；验证：`rg -n 'Paddle|createPaddle|PaddleOcr' packages/adapters/src scripts/deployment`应无生产调用，目标vitest通过。
- [x] 4.2（IP-01–IP-09）转换器目标与受影响部署回归、合成包检查、build/typecheck/lint、受影响文件格式和本change strict；验证：转换器/基准71项、部署258项、模型及接线47项通过，合成包、build/typecheck（8GiB堆）、全仓lint、受影响文件prettier、依赖边界/策略、diff检查及本change strict均通过。默认真实smoke跳过不计外部验收；外部通过来自5.2/5.3的显式实测。全仓其它change的格式/规格漂移分开报告，不冒充全仓verify通过。
- [x] 4.3（IP-07）固定最终implementation checkpoint后完成转换器范围的独立verify/必要限定审计与verification；验证：首次检查点 `1d29de9c6c6a8302f790cab252147d602b812809` 的独立限定审计发现 V-01，2026-10-12 已修复并固定新实现检查点 `c457940bf025bb54bf9604b8464c427c342d9beb`（IP-01/IP-03/IP-07）。核对提交内容与已通过的受影响回归，并在新检查点重跑协议测试 22 项全部通过；verification 更新为 PASS，随后仅提交本任务状态与验收报告，不改实现或测试。C37完整业务和C38目标双卡交付不是本change产品验收条件。

## 5. 本机可复用服务与补充基准

- [x] 5.1（IP-10）闭合并验证独立容器、持久化模型/配置/数据、回环固定端点和启停/健康操作；验证：Compose、固定镜像及模型制品、实际健康、重启和重启后PNG转换均通过；GPU服务保留运行，CPU实例停止。
- [x] 5.2（IP-11）本地服务使用同一生产parser及V2五格式真值清单验内容/定位/JSON-LD；验证：CPU及P4 Vulkan的预热和各3次五格式真实smoke全部通过，源字段覆盖、记录关联、页码及JSON-LD均满足既有真值清单，不以官网结果替代本地结果。
- [x] 5.3（IP-11）同镜像同模型顺序执行纯CPU与VLM Vulkan GPU性能基准；验证：本地模型预加载启动、每样例至少3次暖请求、原生Vulkan0/P4与服务进程归属、质量/延迟/吞吐/资源均已记录。五页扫描件CPU/GPU暖中位数180.99/72.85秒，报告见references/acceptance/mineru-v2/local-benchmark-report.md；GPU服务验后保持可复用。

用户已授权镜像构建、独立容器依赖、模型下载与两轮实测，D-12及本机服务已实施；模型文件只读、锁目录独立可写，补齐EGL运行库后Vulkan实际运行通过。完整证据见本机报告及其中受限原始证据路径。

## 首轮证据（2026-10-11）

目标测试75项、部署回归258项、构建/类型检查、受影响文件lint、依赖边界/策略、合成包检查与本change/C37 strict通过。真实官网五类ZIP字段已冻结；文本PDF、PNG、JPEG与DOCX的parser smoke通过，四类真实响应均以最终代码回读，经共享JSON-LD/资料段生成与合规校验（22/4/5/3段）。扫描PDF仅10/13页有正文，被原质量门拒绝，2.3保持未完成。示例smoke策略未配置关键字段清单，不能计完整内容质量验收。

同日按原策略重试扫描 PDF，结果仍为10/13非空页，布局内容与首次完全一致；第3、9页存在跨页合并，第2页单独请求仍无Markdown。第2页内嵌原图独立转换只识别标题，漏掉可见资料行；该图片的非空检查通过不计内容质量验收。逐项诊断和原始证据路径见 `deployment/ACCEPTANCE.md`，2.3仍未完成。

4.2的pnpm verify在build/typecheck通过后停于既有C37文件16个lint问题；全仓format另有原有问题，全仓strict因11项主规格的超长Requirement警告失败（本change和C37通过）。独立执行pnpm test：137个文件、2189项通过，3项外部smoke默认跳过；跳过不计外部验收通过。4.3尚无最终implementation checkpoint及独立验收，不创建verification或归档。完整业务与可见浏览器验收仍由C37完成，本地GPU/质量/介质由C38取证。

## 分页与原页映射修复后的证据（2026-10-11）

D-10/D-11完成：生成器4项unittest、V1材料自检（72场景/34文件）、63项目标vitest（真实smoke默认另行跳过）、build/typecheck、受影响文件lint通过。五格式真实清单5/5通过，非空页和字段门均为1；扫描PDF的12条地质记录和DOCX的2条表格记录逐条关联检查通过，五类共享JSON-LD全部合规。补充5页试运行扫描件127个关键字段、60条地质记录的原页定位检查亦通过。旧扫描响应按最终映射重放仍因12/13非空页及缺SEG-002-GEO被质量门拒绝，不以修正样本覆盖旧输入。详情见deployment/ACCEPTANCE.md及references/acceptance/mineru-v2/acceptance-report.json。

本轮再次运行全仓lint仍为既有C37的16项错误，4.2未完成；没有提交授权及最终独立验收检查点，4.3未完成。没有新增依赖、重生成V1、提交、归档或启动开发服务器。

## 本机实测与最终回归证据（2026-10-11）

IP-09–IP-11完成：16项lint及同文件格式修正、独立MinerU镜像与模型、固定GPU服务、CPU/P4 Vulkan五格式各3次暖请求和五页扫描件各3次暖请求均通过。48个不同远端任务保存完整转换证据；长件127字段/60记录/原页及JSON-LD全部正确，CPU/GPU暖中位数180.99/72.85秒。GPU服务进程峰值显存1886 MiB，容器长件采样峰值CPU/GPU为2.67/1.82 GiB；重启到就绪7.00秒，重启后真实PNG转换通过。服务健康运行于127.0.0.1:18000，CPU实例已停止；模型、结果及资源证据持久化保留。详细计量与限制见references/acceptance/mineru-v2/local-benchmark-report.{md,json}。

最终转换器/基准71项、部署258项、模型及接线47项回归均通过；build/typecheck、全仓lint、受影响文件格式、合成包、依赖边界/策略、本change strict及diff检查通过。没有运行或宣称全仓pnpm verify通过。4.3保持未完成：按项目AGENTS.md §3及本change施工图，需要获准固定最终Git检查点后开展独立verification；本轮未提交、归档或提前创建verification.md。C37完整浏览器业务与C38目标4090/Qwen共驻仍按各自范围取证。
