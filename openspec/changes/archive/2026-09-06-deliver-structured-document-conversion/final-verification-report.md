# C12 最终审核报告

## 身份与结论

- Change：`deliver-structured-document-conversion`。
- Task / Dispatch：`task_f64709394b72` / `ctx_1a2e818813b4`。
- 审核基线：`72374bf5c170d30c4ba068a38ddb27545975358a`；包含实现 `856ae2b` 与五项 CRITICAL 修复。
- 本次结论适用于该基线加本报告列出的未提交修复；协调者需审阅、提交、合并、主线复验后归档。
- **最终通过：无剩余已确认 CRITICAL，具备交回协调者收口的条件。** 最终代码冻结后完整 `pnpm verify` 通过。
- 旧 `implementation-verification.md` 是针对 `856ae2b` 的历史证据，不代表本轮修复后的状态。

## 完整性、正确性与一致性

| 维度 | 审核结果 |
| --- | --- |
| 完整性 | 17/17 tasks；8 条新增 requirement、1 条修改 requirement，共 23 个 scenario。C13 OCR 实现属于明确后续范围，本轮只验证共享输入分支与拒绝空成功。 |
| 正确性 | 四格式解析、闭合引用、JSON-LD、分块、权限、版本、失败与幂等具有实现和行为证据；本轮补齐数据库故障恢复、失败终态、冲突和不可见查询验证。 |
| 一致性 | 独立转换端口与 C11 窄查询保持模块边界；`EngineeringDataPortV1` 既有分支未改，未引入 OCR、CAD、清洗 Agent、UI 或提前发布输入就绪事件。 |

## 原五项 CRITICAL 核查

| 原问题 | 当前证据与判断 |
| --- | --- |
| 策略未绑定 | `structured-document-converter.ts` 在内容读取前比较 conversion、quality、deployment 精确引用；适配器测试证明错误策略在读取前拒绝。运行环境仍须按版本管理注入配置，不得复用同一版本标签指代不同配置。 |
| 资源与容器边界 | `parsers.ts` ZIP filter 在解压前累计声明大小并检查条目、比例；DOCX 验证内容类型和根关系；XLSX/CSV 在库解析前预检规模，输出上限受统一常量及策略约束。本轮另补合并单元格展开预算。 |
| 历史与失败审计 | C11 提供独立历史读取接缝；命令、转换表和原子命令保留 run/thread；诊断含原因、retryable、已知输入量与 limitCode。本轮修复失败入库中断后的诊断重放。 |
| 表格与 DOCX 保真 | 源标量值与公式缓存保持区分；资料段采用整表范围；读取 styles.xml 的名称和 outline 等源信息。本轮修复稀疏 XLSX 行列遗漏。 |
| 交付证据 | 四类落盘合成 fixtures 和生成说明已存在；C11/C12 PostgreSQL 接缝、迁移 000009 映射、许可证及安全脚本存在。本轮在现有 PostgreSQL 用例内补恢复、失败、冲突和拒绝访问，不增加重复测试框架。 |

## 本轮局部修复

1. **失败记录入库中断无法可靠恢复**：诊断正文原含每次变化的时间戳，却使用固定工件幂等键；入库失败还返回不可重试错误。去掉诊断正文中的尝试时间，真实时间保留在转换记录及审计；数据库写入失败返回可重试错误并保留实际诊断引用。真实 PostgreSQL 回归验证第二次调用可落库并重放同一诊断。
2. **查询泄露记录是否存在**：无权查询存在记录与不存在记录曾分别返回授权拒绝和不存在。转换查询现在统一授权拒绝，并以存在/不存在两个输入验证稳定错误码。
3. **XLSX 空行/空列之后的值丢失**：`actualRowCount` / `actualColumnCount` 是非空数量，不能作为最后坐标。改用工作表末行/末列范围；`D5=false` 回归在修复前失败、修复后通过。
4. **工件读取流可能遗留**：内容类型或引用不一致时，原逻辑在消费读取流前退出。现在在资源上限内完成读取和完整性校验后检查清单一致性，确保已打开流完成释放；已有服务测试补充类型不匹配路径。
5. **XLSX 合并范围未纳入加载前预算**：伪造小 dimension 与巨大 mergeCell 可绕过原预检，导致库展开过大合并区。预检把合并区域面积纳入同一单元格/输出预算；修复后以巨大合并区样例验证加载前拒绝。

修改文件：

- `packages/adapters/src/engineering-data/document-conversion/parsers.ts`。
- `packages/adapters/src/engineering-data/document-conversion/structured-document-converter.ts`。
- `packages/adapters/test/engineering-data/document-conversion.test.ts`。
- `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts`。
- 本报告。

## 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm verify`（原 checkpoint） | 通过：31 files / 280 tests；1 个 llama.cpp 实服务 smoke 因未启用而跳过；build、typecheck、lint、format、依赖边界、依赖政策与 15 项 OpenSpec strict 均通过。 |
| `pnpm verify`（全部局部修复后，代码冻结） | 通过：31 files / 280 tests，1 file / 1 test 跳过；181 modules / 458 dependencies 无边界违规，15 项 OpenSpec strict 通过。 |
| `pnpm exec vitest run packages/adapters/test/engineering-data/document-conversion.test.ts packages/core/test/engineering-data/document-conversion.test.ts packages/contracts/test/module-interfaces-events-workflows.test.ts` | 3 files / 22 tests 通过。 |
| PostgreSQL 接缝与转换 adapter 定向测试（恢复及查询修复后） | 2 files / 19 tests 通过，含真实数据库成功/失败记录与故障恢复。 |
| 转换 adapter 测试（最终解析器与流释放修复后） | 1 file / 6 tests 通过。 |
| `pnpm licenses:check` | 通过，dependency policy OK。 |
| `pnpm security:check` | 退出码 0；0 high/critical，1 moderate，例外说明见下。 |
| `git diff --check` | 通过。 |

验证期间曾出现两类失败：新增回归先复现失败入库被错误标为终态、稀疏 XLSX 值缺失，随后修复通过；另一次全量运行与解析器及恶意样例修改重叠，worker 内存耗尽，因此该轮不作为最终证据。停止修改后重新运行完整门禁已通过，未提高内存预算、关闭安全用例或跳过失败检查。

## 依赖例外与验证边界

协调者通过本 Dispatch 的问题回复明确接受 `exceljs@4.4.0 → uuid` 间接依赖的 1 个 moderate 告警。采用 `pnpm audit --prod --audit-level high` 门禁；接受理由为当前无 high/critical、退出码为 0，且 exceljs 用于所需文档解析；若升级为 high 则触发退出条件。本轮没有安装、更换依赖或改写 lockfile。

测试资料为可再生成的合成样本，不能据此声称甲方全部复杂文档已完成验收。DOCX 只保留源文件可证明的分页；扫描 OCR、CAD、C15 数据准备与实模型验证不在本 change 内。本轮未提交 Git、归档、启动开发服务器或修改其它 change。
