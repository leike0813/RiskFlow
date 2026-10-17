# Implementation Plan

## 1. 实施基线与权威来源

Base commit：`3a88273781a1f9473cbf2d813786799a0e7d7633`，无原有 dirty。权威输入为本 change proposal、四份 delta specs、design D-01～D-06 及已归档减负设计。研究原件、现场服务、数据库、编排状态、依赖与 Git 历史不在修改范围。

## 2. 复用与接缝

| IP-ID | 现有符号                                                                                            | 复用方式                                       |
| ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| IP-01 | readDeploymentAuthorizationSource、authorizeBusinessAction、readPage、readBody、ReportExportService | 登记范围解析、当前判权、同一次内部读取         |
| IP-02 | ArtifactPutCommandV1Schema、normalizeEvidenceReferences、normalizeArtifactReferences                | 边界集合规范化                                 |
| IP-03 | preparePutMetadata、register、assertUsable、#publishObject、verifyObjectForMaintenance              | 新内容一次摘要，登记事实直接复用，独立维护核验 |
| IP-04 | c32ReadCursor、quality decodeCursor、现有分页测试                                                   | 取消任意长度门槛，不改变编码                   |

## 3. 代码变更映射与文件所有权

| IP-ID | 设计/要求                                                             | 修改文件与动作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IP-01 | D-01/D-02；对象范围、深链、额外授权、撤权、历史查询及报告分页全部场景 | `packages/adapters/src/auth/deployment-authorization.ts` 及原导出：共享登记资源当前授权接缝；`packages/adapters/src/workflow/{postgres-workflow-projection,postgres-report-export,postgres-workflow-adapter,index}.ts`：读取登记范围、删除历史摘要全等及正文/分页重签；`packages/core/src/workflow/service.ts`：更新正文读取契约说明；`scripts/deployment/{start.mjs,composition/api-ports.mjs}`：组合接线；`packages/adapters/test/workflow/{postgres-workflow-projection,postgres-report-export,postgres-workflow-adapter}.test.ts`：复用现有 fixture 与行为测试；`apps/web/test/browser/{business-server.mjs,server.mjs,agent-audit-operations.spec.ts}`：接线和报告深链；`apps/web/src/api/client.ts`：移除报告读取对本地来源选择的依赖；以上接口改动需要的既有调用方/fixture 同步，按同一语义仅更新接线 |
| IP-02 | D-03；集合规范化全部场景                                              | `packages/core/src/artifacts/schema.ts` 字段验证后规范化四类输入集合；`packages/core/test/artifacts.test.ts` 复用集合用例；`packages/adapters/src/calibration/postgres-calibration-adapter.ts` 删除仅适配工件的重复整理；相关原校准测试仅按新边界同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| IP-03 | D-04；写入去重及登记事实全部场景                                      | `packages/adapters/src/artifacts/{filesystem-artifact-store,postgres-artifact-registry}.ts` 删除普通路径重复摘要与查询，保留维护；`packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts` 更新去重、父引用、重放与维护行为；原性能基准同文件复用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| IP-04 | D-05；合法长游标及非法输入场景                                        | `packages/contracts/src/ports/index.ts` 删除所有读取游标512上限；`packages/adapters/src/quality/postgres-quality-projection.ts` 同步 decoder；`packages/adapters/test/quality/postgres-quality-evaluation.test.ts` 与 `packages/contracts/test/{c32-read-surface,c34-assessment-response-read,module-interfaces-events-workflows}.test.ts`扩展合法长游标往返；C31分页测试由 IP-01 整合                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| IP-05 | D-06；文档/整体验证                                                   | 本 change 全部工件；根 `AGENTS.md`；原验收 `handoff.md`、`evidence/defensive-design-ledger.md`。记录已实施与未运行实机边界，不改旧失败记录                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 4. 调用与副作用顺序

HTTP 会话/工程入口 → 拥有方精确登记查找 → C06 解析冻结资源并检查当前权限 → 内部分页/正文消费同一决定 → 原响应。C35生成仍按原绑定事务、工件落位、提交前当前复验、尾事务完成；失败保留原幂等身份。工件输入验证与规范化 → 父限制解析 → 新内容流式摘要/耐久落位 → 原事务登记、审计、回读。业务提交时的父存在、来源和事务检查不删。

## 5. Schema、状态与持久化

请求/响应形状和游标编码保持；只放宽合法输入顺序、重复和长度。包内已授权分页不是 HTTP 路由。无状态迁移、表变更、依赖或历史重写；存储摘要继续供内容身份、幂等与独立维护使用。正文引用、审计与来源的业务事实保持。

## 6. 验收证据矩阵

| 场景                                 | IP-ID | 既有测试与断言                                                                     | 命令                                                                                                                                                                                        |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 深链、额外授权、撤权、冻结范围、分页 | IP-01 | workflow投影/报告/adapter测试；同一对象多次读取、范围不扩大、当前拒权；报告browser | `pnpm exec vitest run packages/adapters/test/workflow`；`pnpm exec playwright test -c playwright.config.ts --project=chromium apps/web/test/browser/agent-audit-operations.spec.ts`         |
| 重复/乱序、不同版本证据              | IP-02 | core artifacts与原C04父继承测试；原数组不变、结果集合等价                          | `pnpm exec vitest run packages/core/test/artifacts.test.ts packages/adapters/test/artifacts/content-addressed-artifact-store.test.ts`                                                       |
| 去重、重放、失败原子性与独立维护     | IP-03 | C04同文件已有串并发、父限制、故障注入、维护及性能用例                              | 同上C04命令                                                                                                                                                                                 |
| 长游标结果与输入可往返，错查询拒绝   | IP-04 | contracts/quality及workflow分页测试                                                | `pnpm exec vitest run packages/contracts/test packages/adapters/test/quality`                                                                                                               |
| 工程集成                             | IP-05 | 类型、lint、格式、strict、依赖边界                                                 | `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`；`pnpm lint`；`pnpm format:check`；`pnpm deps:check`；`openspec validate simplify-trusted-business-flows --strict --no-interactive` |

## 7. 调用方同步与升级条件

已定位的同语义接线同步包括 `scripts/deployment/api-ports.test.mjs`、`demo/test/browser/server.mjs`、C22 `postgres-risk-record-trace-reader.ts` 与既有 candidate adapter 测试、C06 `local-identity-project-authorization.test.ts`。C22 为报告调用消费现有 projection.export 能力，不为内部读取额外要求 projection.query。IP-05 同步原验收的工件 delta 中父工件登记/用途/权限措辞，避免归档时重新引入日常摘要验真。

普通测试/fixture失败在本轮修复；接口接线按已批准语义同步。新依赖、迁移、权限扩大、领域规则变化、无法从现有登记解析资源或需要重写历史时升级，不添加假回退。所有既有文件使用内置编辑工具。无授权不提交或切分支。

## 8. 验收与限定审查

实现后读取 verification 指令，按最终工作区核验全部场景。一次独立限定审查覆盖登记范围不被当授权、当前撤权、内部可信读取与工件事务。普通范围内缺陷由活动责任方修复。工程测试不作为实机证据；未授权 Git 提交时明确工作区基线与未提交变更边界，不声称已形成交接提交。
