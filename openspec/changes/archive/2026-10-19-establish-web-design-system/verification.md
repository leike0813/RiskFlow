# Verification Report

- Change：`establish-web-design-system`
- 日期：2026-10-19
- 基线 HEAD：`4ee7e31920fa58dff56ce25295367899534edcba`
- 实现对象：该 HEAD 上本轮验收的未提交工作树，不把 HEAD 本身冒充已包含修复的提交。
- 结论：独立核验发现的呈现缺陷与验收假阳性已修复；下列运行验证通过。未执行提交、主规格同步或归档，本报告不是已提交实现检查点的归档 PASS。
- 来源资格：合成样本，待甲方复核。仅验证 CH-1 呈现与交互，不证明甲方业务配置、模型效果或真实工程性能。

## 1. 本轮修复

| IP | 文件 | 修复 |
|---|---|---|
| IP-02 | `src/shell/AppShell.css` | 导航普通和选中强调改用工程蓝令牌，不改变布局或七导航。 |
| IP-02 | `src/components/ConfirmButton.tsx/.css` | 提交失败使用独立错误色与底色、`role="alert"` 和对话框 `aria-describedby`；按钮字号/行高、圆角、间距及动效使用令牌。提交、取消、冻结载荷、权限和上下文失效逻辑不变。 |
| IP-04 | `src/theme/riskPresentation.ts`、`src/charts/RiskMatrixChart.tsx` | 未知级同时保留原始 ID 和不同显示名；徽章、格子、图例均保留中性配色和安全说明，删除图例只取背景色的旁路。 |
| IP-04 | `src/charts/useChart.ts` | 在原 effect 生命周期订阅减少动态效果偏好，关闭 ECharts 动画及 graph 的 force 布局动画；偏好切换重建原数据图表，清理监听与旧实例。 |
| IP-05 | 本 change 的 design、implementation-plan、tasks | 更正 GraphLegend 无消费者的错误前提。它继续服务 AssociationGraphPage，复用 GraphView 分类样式，不按旧清单删除。 |
| IP-06 | `test/design-system.test.tsx`、三份既有浏览器规格 | 覆盖未知级显示名/原 ID、未落格的未知图例、稀疏轴落点与重复计数、历史图形不变性、真实控件主题、CSS/Canvas 动效、HTTP 当前页身份、实际滚动与键盘导航、错误可访问性及拒权正文缺席。 |

上表源码和测试相对路径以 `apps/web/` 为根。未新增依赖，未改后端、DTO、领域配置、P/C、HTTP/SSE、权限、证据或业务确认状态机。delta spec 和 proposal 无需变更：本轮修复的是原有契约。

## 2. Requirement / Scenario 证据

| Scenario | 本轮证据 | 结果 |
|---|---|---|
| DS-S01 | 浏览器核对真实选中导航、二级页签、AntD 表格文字和表面、键盘焦点与根令牌；不再以测试自建探针冒充生产控件。 | 通过 |
| DS-S02 | SSR 七导航基线、正式登录与深链回归保持；导航 CSS 未改网格列宽或入口。 | 通过 |
| DS-S03 | 组件表驱动覆盖非约定 ID、ordinal 与有/无显示名；正式预警列表只掌握 ID 时仍中性显示，不猜级。 | 通过 |
| DS-S04 | 真实确认写请求在服务端成立但响应被丢弃时，弹窗显示独立错误色的 alert，说明关联正确；原身份重试仍成功。原生六组合另验证传输失败的可见错误和取消。 | 通过 |
| DS-S05 | 未知、越界、非整数或缺失顺序保留 ID/已有显示名；未被任何格子引用的未知等级在图例仍有安全说明。 | 通过 |
| DS-S06 | 3×2/5×5 稀疏 bandId 决定格子和落点；重复落点累计为 4，外配置标识不混入。 | 通过 |
| DS-S07 | 正式发布前保存历史轴、单元格等级/计算配色和落点；新发布后旧分组逐项保持一致，两版引用分别可见。夹具新版本保留原网格，测试不编造格子变化。 | 通过 |
| DS-S08 | 组件空/不可用安全分支、矩阵来源失败、真实拒权和旧内容清理回归通过；不补示例点或扩大读取。 | 通过 |
| DS-S09 | 12 条独立对象组件边界；正式 HTTP 当前页与行顺序/身份/字段逐项对应，Enter/Space 导航保留精确对象与版本，无第二套分页。 | 通过 |
| DS-S10 | 取消零写命令、原信封逐字节重试、受限证据返回安全拒绝且无 result 正文；抽屉只保留定位字段，无资料链接。 | 通过 |
| DS-S11 | 三种真实外窗口的 100%/200% 六组合检查列表键盘操作、局部滚动、聚焦可见、错误可见和 Escape 焦点恢复，保留截图及测量。 | 通过 |
| DS-S12 | 真实确认按钮在正常偏好下有过渡、reduce 下归零；趋势图实际加载/读失败/键盘重试后画面稳定；关联图实际主题像素、24 RAF 帧稳定及双向偏好切换通过。额外原生趋势图烟测稳定 30 RAF 帧。 | 通过 |
| DS-S13 | 正式构建和真实 HTTP/PostgreSQL 回归；资源检查无外部 origin。冻结依赖在干净副本离线安装、构建及两套完整浏览器验收成功。 | 通过 |
| DS-S14 | 保留材料缺失、默认堆 OOM、测试错误假设与格式检查的中间失败及实际修正；未将失败/跳过包装成通过。 | 通过 |

## 3. 执行命令与结果

工具版本：Node.js 24.12.0，pnpm 11.10.0，Playwright 1.63.0，Chrome for Testing 153.0.8010.12，AntD 6.6.6。

| 环境 | 命令 | 结果 |
|---|---|---|
| 工作区 | `pnpm exec vitest run apps/web/test/design-system.test.tsx apps/web/test/ssr-shells.test.tsx` | 2 文件、38 项通过。 |
| 工作区 | `pnpm typecheck && pnpm lint && pnpm deps:check && pnpm deps:policy` | 最终通过；700 模块、2387 依赖边无违规，`dependency policy: OK`。 |
| 工作区 | `pnpm format:check` | 最终通过。 |
| 工作区 | `openspec validate establish-web-design-system --strict --no-interactive`；`openspec instructions apply --change establish-web-design-system --json` | 严格校验通过；15/15 任务完成，remaining=0，state=all_done。 |
| 工作区 | `pnpm build` | 通过，使用修复后的生产资源完成原生浏览器烟测。 |
| 工作区 | 三份浏览器规格全量首轮 | 73 通过、3 失败；评估处置 40 项通过。失败均在新增测试的错误定位/匹配假设，见第 6 节，不记为全量通过。 |
| 工作区 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/identification-review.spec.ts --output=/tmp/riskflow-ds-final-browser` | 最终 36 项通过，包含修正后的三个失败场景。 |
| 工作区 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/assessment-warning-response.spec.ts --grep '响应丢失后重试逐字节'` | 扩展 CSS 动效/错误可访问性后的用例通过，重试复用原信封。 |
| 干净暂存副本 | `pnpm fetch --frozen-lockfile --force` | 768 包：下载 680、复用 88。 |
| 另一个全新隔离副本 | `pnpm install --offline --frozen-lockfile` | 成功；729 个当前平台包复用、下载 0。 |
| 隔离副本 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | 完整冷构建通过。 |
| 隔离副本 | `pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/read-only.spec.ts apps/web/test/browser/assessment-warning-response.spec.ts --output=/tmp/riskflow-ds-offline-final-browser` | 最终 62 项通过，9.9 分钟，真实 PostgreSQL/正式 HTTP/生产 dist。 |

工作区是分段回归，不将中途失败的 76 项命令改写为一次性全绿。最终只读、识别与评估处置场景均有通过证据，离线副本另取得两套完整验收结果。未重跑全量业务单元测试，也不沿用旧报告的全量测试数量。

构建主要分包：ConfigProvider 282.79 kB（gzip 96.21），DataTable 475.42 kB（146.31），useChart 535.00 kB（176.73）。Vite 的大于 500 kB 警告仍保留，未放宽阈值或新增性能框架。

## 4. 原生缩放证据

证据：[native-zoom.json](evidence/native-zoom.json)，截图见 [native-zoom/](evidence/native-zoom/)。共六组合、12 张截图，均使用专用 Xvfb，不操作用户浏览器。

真实外窗口为 1280×720、1440×900、1920×1080，100% 的 CSS 视口分别为 1280×576、1440×756、1920×936；浏览器工具栏占用剩余高度。通过原生窗口快捷键 Ctrl+0 重置、五次 Ctrl+plus 进入 200%，对应 CSS 视口减半、DPR 从 1 变为 2。未设置模拟 viewport、CSS zoom、deviceScaleFactor 或 pageScaleFactor。

每组通过 Tab 到列表行、Enter/Space 打开原对象；二维区域有溢出时实际改变 scrollLeft。确认内经 Tab/Enter 提交一次，网络拦截产生传输失败而不向服务端写入，错误为 `rgb(180,35,24)`、具有 alert/说明关联且可见；Escape 关闭后焦点回到合法触发点。1920×1080 的 100% 列表无需横向滚动，未将其伪记为发生滚动。

## 5. 离线材料

干净暂存目录：`/tmp/riskflow-ds-offline-xNBM3O`；新安装及冷构建目录：`/tmp/riskflow-ds-offline-install-miaarH`。两者都没有从工作区复制 node_modules 或 dist。共享 pnpm store 为 `/home/joshua/.local/share/pnpm/store/v11`。

以干净暂存副本的 fetch 补齐材料后，再从新副本进行严格离线安装；不是在已经链接好的工作区以“已是最新”代替缺失 tarball 的证明。锁文件、Web manifest、workspace 政策和依赖政策与工作区一致。锁文件 SHA-256 为 `4eeb909755dd3de638b740dd894f1f68b6d7e9cefa5dd681fe115c2cd5f0653c`，仅用于本次证据标识，不新增生产校验门禁。

此证据覆盖当前 Linux 平台的冻结依赖安装和本地运行；未进行 C38 跨 VM、物理禁网、多平台或签名安装验收。

## 6. 中途失败、修正与边界

- 旧的工作区 fetch 未补齐材料；本轮改用无 node_modules 的干净暂存副本，实际下载缺失包，新副本离线安装成功。没有修改依赖版本、registry 配置、锁文件或安装政策。
- 新副本首次 `pnpm build` 在 Node 默认约 4GB 堆上限 OOM、退出 134。主机可用内存足够后，仅为该次冷构建设置 8GB 堆，命令通过；未修改生产脚本。冷构建内存需求仍需交付方准备。
- 浏览器首轮的三处失败：会话恢复页没有测试假设的骨架；资料 ID 在详情中带版本说明而非独立文本；关联图 ID 在 URL 中被编码。修复为真实业务加载/错误/Canvas 行为、保留对象 ID 的语义匹配和解码后的精确路径。CSS 动效改在确实存在过渡的 ConfirmButton 上验证，不为测试给页签添加动画。
- 格式检查中途发现三份测试文件排版问题，已通过内置编辑工具修正；不改变检查器，也不删除失败分支。
- 原生工具的 AT-SPI 能力不可用时，改用专用 Xvfb、Chromium CDP 读取和 xdotool 原生快捷键取证；未安装桌面依赖。
- 本轮不调整六导航/新停靠区、不统一确认状态机、不新增业务接口。未做真实读屏器或甲方真实数据验收，未提交、未归档。

原生烟测服务、Chromium 和 Xvfb 均已正常退出；临时启动脚本已移除。保留冻结安装副本与测试失败 trace 供本机复核，项目内只保存列明的验收证据。
