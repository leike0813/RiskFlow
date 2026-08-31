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
