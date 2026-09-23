/**
 * C30 自有运行事实适配器切片入口（design D-05/D-06）：只导出工厂与类型，
 * 不暴露内部查询与 SQL 细节。
 */
export {
  WORKFLOW_GRAPH_BODY_PURPOSE_CODE_V1,
  WorkflowGraphDeniedErrorV1,
  createPostgresWorkflowAdapter,
  workflowGraphReadInvocationIdV1,
  type PostgresWorkflowAdapterOptionsV1,
  type PostgresWorkflowAdapterV1,
  type WorkflowGraphBodyKindV1,
} from "./postgres-workflow-adapter.js";
export {
  createPostgresWorkflowProjection,
  type PostgresWorkflowProjectionOptionsV1,
  type PostgresWorkflowProjectionV1,
} from "./postgres-workflow-projection.js";
