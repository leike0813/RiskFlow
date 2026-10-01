## ADDED Requirements

### Requirement: 受保护读端口必须以当前调用的领域标识复验签发身份

投影查询与结果再读取端口（`ProjectionPortV1.query`、`ProjectionResultReadPortV1.readPage`）与风险记录窄读端口（`RiskRecordTraceReadPortV1.readBatch`）在复验授权上下文时，MUST 使用当前这次领域调用的调用标识（查询的 `queryId`）与当前调用入口的路由 branch 作为复验身份对——与 C06 归档语义（`invocationId` 即该次调用的 commandId/queryId/toolCallId，verify 精确绑定 branch）和 HTTP 外壳按路由 branch 以领域 `queryId` 签发的规则配对。端口 MUST NOT 由 capability 反推 branch（能力位与 branch 一对多），也 MUST NOT 使用没有配对签发方的派生身份字符串；确需派生身份的进程内配对（签发方与复验方使用同一导出函数）不受本条限制。复验失败 MUST 维持既有同形失败闭合语义，不因此条改变任何数据可见性判断。（RI-S6；RA-S5～RA-S7）

#### Scenario: HTTP 签发的授权可通过投影复验

- **WHEN** 调用方经 HTTP 提交投影查询，服务端以该查询的领域 `queryId` 签发授权上下文
- **THEN** 投影端口复验该上下文成功，查询进入既有的可见性判断与登记流程，不在数据判断之前失败闭合

#### Scenario: 结果再读取以本次调用身份复验

- **WHEN** 调用方经 `projection.result-read` 分页读取已登记查询结果
- **THEN** `readPage` 以这次读取调用的 `queryId` 复验授权，授权一致则返回登记范围内条目，授权漂移或越权仍同形失败

#### Scenario: 无配对签发方的派生身份不得复现

- **WHEN** 审查投影与窄读端口的复验实现
- **THEN** 不存在仅由复验方自造、无任何生产签发方配对的 `invocationId` 派生字符串
