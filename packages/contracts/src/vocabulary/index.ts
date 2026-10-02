import { z } from "zod";

export const PROCESS_NODE_VALUES = [
  "扩径准备",
  "变径空间扩挖",
  "刀盘扩径",
  "盾体扩径",
  "缩径转换",
] as const;

export const EQUIPMENT_COMPONENT_VALUES = [
  "小盾构",
  "扩径模块",
  "扩挖机构",
  "拼装机械臂",
  "伸缩帽檐",
  "反力系统",
  "推进系统",
  "焊接装配单元",
] as const;

export const STRUCTURAL_COMPONENT_VALUES = ["钢管片", "锚杆", "尾盾"] as const;

export const STATE_PARAMETER_DESCRIPTION_VALUES = [
  "盾体直径",
  "刀盘直径",
  "主驱动伸出量",
  "土仓/泥水压力",
  "注浆参数",
  "支护状态",
  "反力体系状态",
  "焊接/拼装状态",
] as const;

export const MONITORING_INDICATOR_VALUES = [
  "地表沉降",
  "支护结构变形",
  "地下水位",
  "泥水压力",
  "注浆压力",
  "盾构姿态参数",
] as const;

export const RISK_MECHANISM_TYPE_VALUES = [
  "掌子面稳定性失效",
  "支护结构失效",
  "渗流突涌",
  "过挖与地表沉降",
  "施工装备故障",
  "装配连接失效",
] as const;

export const PROCESS_DEPENDENCY_RELATION_TYPE_VALUES = [
  "时间先后关系",
  "资源依赖关系",
  "受力依赖关系",
  "作用关系",
] as const;

export const APPLICABILITY_METADATA_DIMENSION_VALUES = [
  "施工工法数据",
  "地层条件数据",
  "工程阶段数据",
] as const;

export const RISK_ASSESSMENT_INDICATOR_TYPE_VALUES = [
  "发生可能性评估指标",
  "后果严重性评估指标",
] as const;

export const QUANTITATIVE_INDICATOR_GROUP_VALUES = [
  "地质与围岩条件",
  "地下水与渗透条件",
  "开挖与支护参数",
  "施工工艺与设备参数",
  "监测量测与周边环境",
] as const;

export const WARNING_TRIGGER_TYPE_VALUES = [
  "风险等级超过风险可接受阈值",
  "监测指标越限",
  "趋势/加速度/异常评分越限",
  "多指标联合规则命中",
] as const;

export const ProcessNodeSchema = z.enum(PROCESS_NODE_VALUES);
export type ProcessNode = z.infer<typeof ProcessNodeSchema>;

export const EquipmentComponentSchema = z.enum(EQUIPMENT_COMPONENT_VALUES);
export type EquipmentComponent = z.infer<typeof EquipmentComponentSchema>;

export const StructuralComponentSchema = z.enum(STRUCTURAL_COMPONENT_VALUES);
export type StructuralComponent = z.infer<typeof StructuralComponentSchema>;

export const StateParameterDescriptionSchema = z.enum(STATE_PARAMETER_DESCRIPTION_VALUES);
export type StateParameterDescription = z.infer<typeof StateParameterDescriptionSchema>;

export const MonitoringIndicatorSchema = z.enum(MONITORING_INDICATOR_VALUES);
export type MonitoringIndicator = z.infer<typeof MonitoringIndicatorSchema>;

export const RiskMechanismTypeSchema = z.enum(RISK_MECHANISM_TYPE_VALUES);
export type RiskMechanismType = z.infer<typeof RiskMechanismTypeSchema>;

export const ProcessDependencyRelationTypeSchema = z.enum(PROCESS_DEPENDENCY_RELATION_TYPE_VALUES);
export type ProcessDependencyRelationType = z.infer<typeof ProcessDependencyRelationTypeSchema>;

export const ApplicabilityMetadataDimensionSchema = z.enum(APPLICABILITY_METADATA_DIMENSION_VALUES);
export type ApplicabilityMetadataDimension = z.infer<typeof ApplicabilityMetadataDimensionSchema>;

export const RiskAssessmentIndicatorTypeSchema = z.enum(RISK_ASSESSMENT_INDICATOR_TYPE_VALUES);
export type RiskAssessmentIndicatorType = z.infer<typeof RiskAssessmentIndicatorTypeSchema>;

export const QuantitativeIndicatorGroupSchema = z.enum(QUANTITATIVE_INDICATOR_GROUP_VALUES);
export type QuantitativeIndicatorGroup = z.infer<typeof QuantitativeIndicatorGroupSchema>;

export const WarningTriggerTypeSchema = z.enum(WARNING_TRIGGER_TYPE_VALUES);
export type WarningTriggerType = z.infer<typeof WarningTriggerTypeSchema>;

/* -------------------------------------------------------------------------- */
/* C34 处置域枚举（design D-03）                                               */
/*                                                                            */
/* 只读界面暴露的任务状态、校准状态、类型化操作 kind 及其校验枚举在此定义一次； */
/* core 消费并 re-export，同一领域枚举不得在 core 与 contracts 重复定义。       */
/* -------------------------------------------------------------------------- */

export const WARNING_RESPONSE_TASK_STATUS_VALUES = ["open", "closed"] as const;
export const WarningResponseTaskStatusV1Schema = z.enum(WARNING_RESPONSE_TASK_STATUS_VALUES);
export type WarningResponseTaskStatusV1 = z.infer<typeof WarningResponseTaskStatusV1Schema>;

export const CALIBRATION_SUGGESTION_STATUS_VALUES = [
  "pending-review",
  "returned",
  "rejected",
  "approved-for-draft",
] as const;
export const CalibrationSuggestionStatusV1Schema = z.enum(
  CALIBRATION_SUGGESTION_STATUS_VALUES,
);
export type CalibrationSuggestionStatusV1 = z.infer<
  typeof CalibrationSuggestionStatusV1Schema
>;

/** 六个分支与目标定义类型一一对应；只暴露 kind，不上移完整配置 Schema。 */
export const CALIBRATION_OPERATION_KIND_VALUES = [
  "replace-weight-entry",
  "replace-risk-matrix-band",
  "replace-risk-acceptance-threshold",
  "replace-monitoring-warning-threshold",
  "replace-deviation-policy",
  "replace-scoring-rule-interval",
] as const;
export const CalibrationOperationKindV1Schema = z.enum(CALIBRATION_OPERATION_KIND_VALUES);
export type CalibrationOperationKindV1 = z.infer<typeof CalibrationOperationKindV1Schema>;

/** 已存比较形状：单边 gt/gte/lt/lte 携带 boundary，outside 携带 lower/upper；无新比较逻辑。 */
export const COMPARISON_OPERATOR_VALUES = ["gt", "gte", "lt", "lte", "outside"] as const;
export const ComparisonOperatorV1Schema = z.enum(COMPARISON_OPERATOR_VALUES);
export type ComparisonOperatorV1 = z.infer<typeof ComparisonOperatorV1Schema>;

/** 校准公开治理入口的闭合决定取值（design D-03/D-08）。 */
export const CALIBRATION_REVIEW_OUTCOMES_V1 = ["reject", "return-for-revision"] as const;
export const CalibrationReviewOutcomeV1Schema = z.enum(CALIBRATION_REVIEW_OUTCOMES_V1);
export type CalibrationReviewOutcomeV1 = z.infer<typeof CalibrationReviewOutcomeV1Schema>;

export const CALIBRATION_GOVERNANCE_DRAFT_OUTCOME_V1 = "approve-draft-creation" as const;
export const CalibrationGovernanceDraftOutcomeV1Schema = z.literal(
  CALIBRATION_GOVERNANCE_DRAFT_OUTCOME_V1,
);
export type CalibrationGovernanceDraftOutcomeV1 = z.infer<
  typeof CalibrationGovernanceDraftOutcomeV1Schema
>;
