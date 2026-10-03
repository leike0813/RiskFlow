# Design

## Context

见 proposal.md。固定分析基线 `21f7ccc471c0c6d72c32aaf570b51afdf6dc71ec`，保留 C25 和 contracts 的已有未提交实现。C11 两个目录由同一 registry 拥有；外部事件表无工程修订。IdentifierSchema 不限制长度，但公开游标上限为 512。C06 授权空间精确版本与 C11 业务空间修订属于不同事实。

## Goals / Non-Goals

闭合两个候选分支及目录分页接缝，不接管原 IP-04 的其它六类读取、完整应用接线或运行 UI。无新依赖、角色或能力。合成验收数据明确为待甲方复核，不参与业务评分规则。

## Decisions

### D01 — Schema 与所有权

contracts 以 operation / riskInputKind 判别 strict 载荷。适用性目录保留工程修订，外部事件目录与 pending 分支去掉该字段；external pending 必填空间，risk-record 空间可选。C11 通过现有 registry 的薄工厂导出 AssessmentEntryContextReadPortV1，无第二套目录实现。C25 仅经该公开端口组合目录（RA-S1、RI-S14）。

### D02 — 耐久分页与迁移

000055 在两张 C11 登记表增加 `catalog_cursor_key uuid NOT NULL DEFAULT gen_random_uuid()` 及唯一索引，为历史和新行生成稳定定位键。游标是严格的版本、规范筛选/授权摘要 SHA-256 绑定值及 UUID 锚点，base64url 编码；不嵌入任意长度领域标识。相比放宽游标上限，该方案保持公开约束；相比临时服务端缓存，重启后仍能恢复。

验证授权及游标后，在所属表按 UUID 与同一工程/精确过滤条件查找最多一个锚点；登记时间以 PostgreSQL 文本保留微秒精度。下一页按 `(recorded_at DESC, entity_id ASC, version_id ASC)` keyset 条件查询，LIMIT 始终 pageSize+1，剥离哨兵；游标锚定最后消费行。首次页仅一个有界查询，续页多一个唯一锚点查询，无累计 offset。损坏登记返回 TERMINAL_FAILURE；伪游标/锚点失配维持 AUTHORIZATION_DENIED。

### D03 — 授权与错误

C25 每次目录读取独立调用 authorizeDownstream，invocationId 等于实际 queryId，branch 固定 engineering-data.context-read。requestedSpatialScopeRefs 从当前 C06 验证上下文按业务空间 entityId 取得授权精确引用；找不到即拒绝。C11 payload 保留业务精确引用用于事实筛选。所有失败进入现有 RiskAssessmentReadFailure 闭合结果，不拓宽资料范围、不吞成空页。预览不产生业务写入；每页仍验证事件的来源资料权限。

AssessmentEntryContextReadPortV1 增加 readAuthorizedSourceVersions 的 strict 窄查询/结果。它使用当前 C25 读取的原 queryId、risk-assessment.read 分支和已验证授权，不派生未配对身份；payload 只含所选业务空间。C11 复验当前 C06 主体/范围，再以返回上下文中的稳定来源授权身份在自有 source_versions 定位精确来源版本，最多 256 个授权引用及 257 行哨兵，非就绪、缺失、重复或保存引用错配安全失败，不读跨域表、不开放任意查询。C11 保存创建时授权修订，定位使用稳定 grant identity；当前修订与可见性仍由 C06 复验及下游签发检查决定。没有来源授权时返回真实空范围。C25 以这些版本请求每次目录授权，并核对签发空间与来源授权均在原当前验证范围内。该接缝保持现有页面输入，来源资格仍由 C06 当前授权决定。

### D04 — 文件与验证责任

- contracts/src/ports/index.ts 与新增 contracts/test/c34-assessment-response-read.test.ts：判别输入和稳定契约边界。
- adapters/src/engineering-data/context-source/{postgres-engineering-context-source-registry.ts,index.ts}：薄端口、类型化读取与分页。
- adapters/src/postgres/migrations/engineering-data/fix-assessment-entry-read-seam/000055_assessment_entry_catalog_cursor_keys.ts：定位列及索引；postgres-foundation.test.ts、auth/fixture.ts 更新迁移清单。
- adapters/src/risk-assessment/engine/postgres-risk-assessment-engine.ts：仅 pending external 与 entry-context 下游身份/范围/失败。
- adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts：分页、长标识、重启、权限、损坏、迁移回退依赖。
- adapters/test/risk-assessment/{fixture.ts,postgres-risk-assessment-engine.test.ts}：真实 C06/C11→C25 接缝和预览零写入。
- 原 change 的 design.md、implementation-plan.md、相关两份 delta specs：更新当前接缝事实并引用本修复依赖；原任务 2.3 保持未完成。

验证以真实 PostgreSQL 的 50/51 边界、同时间排序、插入新行、长标识、跨运行时、错目录/空间/修订/授权摘要、撤权、零业务写入和迁移 up/down 为依据；查询资源上界通过采集实际执行的 LIMIT 和返回行数验证，避免锁定完整 SQL 文本。运行相关 Vitest、typecheck、目标 ESLint/Prettier 检查、依赖边界及两份 change strict validate。

## Risks / Trade-offs

- 定位列迁移需更新历史行并建唯一索引 → 部署先迁移再启用新读取，遵循现有迁移事务与权限模式。
- 每个续页增加一次索引锚点读取 → 返回规模常数有界，保留精确排序且避免任意长度标识进入游标。
- 原 C25 文件仍含未验收读实现 → 限定差异与测试结论，不将本接缝通过等同 IP-04 完工。

## Migration Plan

先应用 000055，再部署读取实现。回退时先撤下依赖定位列的读取实现，再 down 000055；只移除索引和内部定位列，不删除登记事实。历史及新增默认键、唯一性和既有最小权限通过真实数据库验证。原 000036 down/up 测试先 down 000055，再重建 000036 并 up 000055。
