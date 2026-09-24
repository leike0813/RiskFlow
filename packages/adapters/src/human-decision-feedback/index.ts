/**
 * C41 人工决定与反馈命令适配器切片入口（design D7）：只导出工厂、证明端口实现与类型，
 * 不暴露内部查询与 SQL 细节。
 */
export {
  PostgresHumanDecisionFeedbackAdapter,
  createPostgresHumanDecisionFeedbackAdapter,
  type PostgresHumanDecisionFeedbackAdapterOptionsV1,
} from "./postgres-human-decision-feedback-adapter.js";
