# Implementation Plan

基线：`21f7ccc471c0c6d72c32aaf570b51afdf6dc71ec`。接口、迁移及权限决定以 design.md 的 D01–D04 为准。

| IP-ID | Requirement / Scenario | 文件及现有符号 | 动作 | 验证 |
| --- | --- | --- | --- | --- |
| IP-01 | 公共输入闭合；两类事实范围 | contracts/src/ports/index.ts 的 AssessmentEntryContextReadQueryV1Schema、pending payload；contracts/test/c34-assessment-response-read.test.ts | 操作判别 strict 输入，外部事件必填空间且拒绝工程修订；测试必填、未知字段与风险记录可选空间 | 契约 Vitest |
| IP-02 | 长标识、恢复、稳定分页 | 000055 新迁移；postgres-foundation.test.ts、auth/fixture.ts | 两表耐久 UUID 列与唯一索引；迁移清单和历史/default/权限验收 | PostgreSQL foundation 与授权 Vitest |
| IP-03 | 有界分页、当前授权、损坏失败 | C11 registry 的 readAssessmentEntryContext、两个 catalog；context-source/index.ts；C11 现有测试 | 薄端口工厂、摘要绑定 UUID 游标、微秒精确锚点及 keyset；限定查询上界；更新迁移回退测试并覆盖两类目录 | C11 真实 PostgreSQL Vitest |
| IP-04 | 每次调用身份配对、范围与失败；来源授权有界继承 | contracts 新来源定位 Schema；C11 registry/薄端口的 readAuthorizedSourceVersions；C25 engine 的 pendingExternalEventCandidates、readEntryContext；risk-assessment fixture/test；原 change 的设计、施工图及两个 delta | 当前已验证 grant identity 在 C11 source_versions 有界定位，C25 按原空间/来源范围逐次签发；两个候选分支输入/错误修复；真实 C06/C11 接线验证；保留原 IP-04 未完成 | 契约与 C25 真实 PostgreSQL Vitest、原 change strict validate |
| IP-05 | 跨模块一致性 | 本 change 工件及上述文件 | 最小相关验证、verification、同步主规格并仅归档修复 | typecheck、ESLint、Prettier check、依赖边界、strict validate |
