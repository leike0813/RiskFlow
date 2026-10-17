## 1. 业务读取

- [x] 1.1 IP-01：按登记范围执行当前权限，报告分页和正文复用入口决定；运行 workflow adapter/projection/report 测试及报告 browser。

## 2. 工件与游标

- [x] 2.1 IP-02：工件入口规范化集合，删除 C29 重复整理；运行 core artifacts 及 C04 父继承回归。
- [x] 2.2 IP-03：删除日常去重及登记事实重复验真，保留独立维护；运行 C04 全文件行为与现有基准。
- [x] 2.3 IP-04：取消读取游标512门槛；运行 contracts、quality和投影分页测试。

## 3. 整合

- [x] 3.1 IP-05：同步台账、handoff及AGENTS；执行typecheck、lint、format、deps和OpenSpec strict。
- [x] 3.2 IP-05：完成一次权限/事务限定审查和必要回归，记录实际验证与实机边界。
