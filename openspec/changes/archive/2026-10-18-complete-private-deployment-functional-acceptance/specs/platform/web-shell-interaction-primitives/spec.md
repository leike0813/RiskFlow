## ADDED Requirements

### Requirement: 停靠开合不得因没有证据误关闭

Web shell MUST 在无证据时仍允许打开上下文与Agent面板，已过期证据只能清空其自身事实。真实Agent贡献来自所属Provider，普通路由切换保留当前面板与任务，切工程或注销按原规则清空事实。

#### Scenario: 空证据下打开Agent

- **WHEN** 用户在没有当前证据的合法业务页开启停靠区并切到Agent
- **THEN** 面板保持可操作并显示真实任务或空态，不立即自动收起
