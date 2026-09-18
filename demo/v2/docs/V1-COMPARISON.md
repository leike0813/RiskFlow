# v1 ↔ v2 页面对照（演进审阅用深链）

> v1 预览：`cd demo && npm run preview -- --port 5319 --strictPort` → `http://<本机IP>:5319`
> v2 审阅：`cd demo/v2 && npm run review` → `http://<本机IP>:5320`（hash 路由）
>
> v1 的 4 处自定合并页在 v2 已按拆页规则拆为独立页面与独立 URL（指导性方案 §8.2），
> 表中「v2 页面」列出现多个链接时即拆分结果。v2 新增（v1 无对应）的页面不在本表。

| v1 页面 | v1 深链（5319） | v2 页面（5320） |
|---|---|---|
| 风险态势总览 | `/` | `#/overview`（P-OV-01） |
| Agent 工作台 | `/agent` | `#/agent`（P-AG-02）、`#/agent/dock`（P-AG-01 停靠栏）、`#/agent/tasks/AGT-001`（P-AG-03 任务详情） |
| 识别任务列表 | `/identification` | `#/identification`（P-RI-01） |
| 识别运行详情 | `/identification/runs/RUN-20260827-001` | `#/identification/runs/RUN-20260827-001`（P-RI-03） |
| 风险记录列表 | `/identification/records` | `#/identification/records`（P-RI-05） |
| 关联图谱 | `/identification/graph` | `#/identification/graph`（P-RI-07） |
| 工序模型 | `/identification/process-model` | `#/identification/process-model`（P-RI-04） |
| 工程概览 | `/project` | `#/projects`（P-PJ-01） |
| 资料目录 | `/project/documents` | `#/projects/sources`（P-PJ-05） |
| 资料详情 | `/project/documents/DOC2026001` | `#/projects/sources/SRC-001`（P-PJ-07） |
| 监测详情 | `/project/monitoring/MON-001` | `#/projects/monitoring/MON-001`（P-PJ-10） |
| 待评估风险 | `/assessment` | `#/assessment`（P-RA-01） |
| 评估记录列表（合并页） | `/assessment/records` | `#/assessment/records`（P-RA-04）+ `#/assessment/reassessments`（P-RA-07 重新评估历史） |
| 评估记录详情（合并页） | `/assessment/records/ASSESS-2026-001` | `#/assessment/records/ASSESS-2026-001`（P-RA-05）+ `#/assessment/matrix`（P-RA-06 矩阵视图） |
| 预警中心 | `/warnings` | `#/warnings`（P-WR-01） |
| 预警详情 | `/warnings/WARN-2026-001` | `#/warnings/WARN-2026-001`（P-WR-02） |
| 处置任务列表 | `/warnings/tasks` | `#/warnings/tasks`（P-WR-03） |
| 风险详情（合并页） | `/risks/RISK-2026-001` | `#/identification/records/RISK-2026-001`（P-RI-06）+ `#/warnings/tasks/WRT-2026-001`（P-WR-04）+ `#/response/recommendations/RESP-2026-001`（P-RS-01） |
| 机理库 | `/knowledge/mechanisms` | `#/knowledge/mechanisms`（P-KM-01） |
| 规则集（合并页） | `/knowledge/rules` | `#/knowledge/indicator-systems`（P-KM-05）+ `#/knowledge/rule-sets`（P-KM-06） |
| 风险矩阵 | `/knowledge/matrix` | `#/knowledge/risk-matrices`（P-KM-07） |
| 措施库 | `/knowledge/measures` | `#/knowledge/measures`（P-KM-08） |
| 复核队列 | `/review` | `#/review-audit`（P-RV-01） |
| 证据追溯 | `/review/trace` | `#/review-audit/trace`（P-RV-04） |
| 运行记录 | `/review/runs` | `#/review-audit/runs`（P-RV-05） |

## v2 新增（v1 无对应）

- 工程：P-PJ-02/03/04/06/08/09（开通向导、空间区段、成员、资料登记、接入任务、监测概览）
- 识别：P-RI-02 启动识别向导
- 评估：P-RA-02 启动评估向导、P-RA-03 评估运行详情
- 处置：P-RS-02～05（执行登记、效果预测、反馈与偏差、校准建议）
- 复核：P-RV-02/03/06（复核详情、识别复核、版本与操作审计）
- 报告与设施：P-AU-01 报告导出、P-OP-01～05 系统管理区
