# 合成材料功能预验收内部试运行报告

材料标签：合成样本，待甲方复核（labelStatus=candidate，未经人工复核）
运行状态：BLOCKED
材料包：riskflow-synthetic-v1@1；运行标识：synthetic-851e7fb58ac5b6fb032d54cd
代码基线：6fd462e9fc61e92b39903a3087e2e2a8a21c1b5a；工作区摘要：18fa02c127260c5a193574a7e6dd965a315b0ad58918dabed96ebf53af9af685

本报告是内部探索性记录，不代表甲方验收通过，也不构成整体技术就绪声明。

| 步骤 | 类型 | 操作 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| environment-preparation | manual | - | pending | - |
| register-source | http | riskflow_command_engineering-data_register-source-delivery | pending | - |
| knowledge-preparation | manual | - | pending | - |
| submit-process-model | http | riskflow_command_knowledge-modeling_submit-revision | pending | - |
| request-review | http | riskflow_command_knowledge-modeling_request-review | pending | - |
| human-approval | manual | - | pending | - |
| start-identify-assess | http | riskflow_command_workflow_start-run | pending | - |
| query-run-view | http | riskflow_query_projection_query | pending | - |
| read-run-view | http | riskflow_query_projection_result-read | pending | - |
| business-evidence | manual | - | pending | - |

## 阻塞与缺口

- 运行配置不合格：config.baseUrl 不合格：BASE_URL_INVALID；config.projectId 缺失；config.loginName 缺失；config.password 缺失
