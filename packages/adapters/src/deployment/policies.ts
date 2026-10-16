import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import { ModuleBranchV1Schema } from "@riskflow/contracts/ports";
import {
  AgentTaskBudgetPolicyV1Schema,
  type AgentTaskBudgetPolicyV1,
} from "@riskflow/core/agent-runtime";
import {
  DataCleaningPolicySchema,
  DataCleaningPolicyV2Schema,
  type DataCleaningPolicy,
} from "@riskflow/core/engineering-data/cleaning";
import {
  IdentificationKnowledgeValidationPolicyV1Schema,
  type IdentificationKnowledgeValidationPolicyV1,
} from "@riskflow/core/identification-knowledge";
import {
  HybridRetrievalPolicyV1Schema,
  type HybridRetrievalPolicyV1,
  HybridRetrievalAcceptancePolicyV1Schema,
  type HybridRetrievalAcceptancePolicyV1,
} from "@riskflow/core/retrieval";
import {
  RetrievalReviewPolicyV1Schema,
  RetrievalReviewPolicyV2Schema,
  type RetrievalReviewPolicyV1,
} from "@riskflow/core/identification/context";
import {
  IdentificationGraphPolicySetV1Schema,
  IdentificationGraphRetryPolicyV1Schema,
  type IdentificationGraphPolicySetV1,
  type IdentificationGraphRetryPolicyV1,
} from "@riskflow/core/identification/graph";
import {
  RiskCandidatePolicyBundleV1Schema,
  RiskCandidateGenerationPolicyV1Schema,
  RiskCandidateGenerationBudgetV1Schema,
  type RiskCandidatePolicyBundleV1,
} from "@riskflow/core/identification/candidate-finalization";
import {
  AssessmentRuntimePolicySetV1Schema,
  type AssessmentRuntimePolicySetV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  WarningRuntimePolicySetV1Schema,
  type WarningRuntimePolicySetV1,
} from "@riskflow/core/warning";
import {
  ResponseAgentPolicyV1Schema,
  ResponseGenerationPolicyV1Schema,
  ResponseValidationPolicyV1Schema,
  type ResponseAgentPolicyV1,
  type ResponseGenerationPolicyV1,
  type ResponseValidationPolicyV1,
} from "@riskflow/core/recommendation";
import {
  CalibrationValidationPolicyV1Schema,
  type CalibrationValidationPolicyV1,
} from "@riskflow/core/calibration";
import {
  ScoringRulesPolicyV1Schema,
  type ScoringRulesPolicyV1,
} from "@riskflow/core/scoring-rules";
import { ReportExportPolicyV1Schema, type ReportExportPolicyV1 } from "@riskflow/core/workflow";

/**
 * C37 D-20：只读、不可变的 DeploymentPolicyCatalogV1。
 *
 * catalog 只按 (projectId, type, ref) 提供**已发布正文的解析入口**：
 * 正文一律由所属 core Schema 校验，catalog 不复制业务阈值、不内建默认值，
 * 也不替代 C16/C18/C19 的已发布业务定义。合成或 demo 常量不得进入生产 catalog。
 *
 * D-08：V2/V3 持久策略只引用 `budgetPolicies` 中的唯一预算成员，解析入口补回
 * 模型、提示、工具引用与数值预算，调用方收到的仍是原运行接口对象。
 *
 * 缺项、冲突、错版本与未批准条目一律失败，不回退到“最近版本”。
 */

/** catalog 支持的策略类型；每一类都绑定原 core Schema，不另设字段。 */
export const DEPLOYMENT_POLICY_TYPE_V1_VALUES = [
  "cleaning",
  "knowledge-validation",
  "hybrid-retrieval",
  "retrieval-acceptance",
  "retrieval-review",
  "risk-candidate",
  "identification-graph",
  "retry",
  "assessment-runtime",
  "warning-runtime",
  "response-generation",
  "response-validation",
  "response-agent",
  "calibration",
  "scoring-rules",
  "report-export",
] as const;
export const DeploymentPolicyTypeV1Schema = z.enum(DEPLOYMENT_POLICY_TYPE_V1_VALUES);
export type DeploymentPolicyTypeV1 = z.infer<typeof DeploymentPolicyTypeV1Schema>;
export const DEPLOYMENT_POLICY_PURPOSE_V1_VALUES = ["production", "synthetic-acceptance"] as const;
export const DeploymentPolicyPurposeV1Schema = z.enum(DEPLOYMENT_POLICY_PURPOSE_V1_VALUES);
export type DeploymentPolicyPurposeV1 = z.infer<typeof DeploymentPolicyPurposeV1Schema>;

/** 解析入口返回的运行接口正文；预算引用版持久正文在解析时归一为这里的类型。 */
export interface DeploymentPolicyBodyByTypeV1 {
  readonly cleaning: DataCleaningPolicy;
  readonly "knowledge-validation": IdentificationKnowledgeValidationPolicyV1;
  readonly "hybrid-retrieval": HybridRetrievalPolicyV1;
  readonly "retrieval-acceptance": HybridRetrievalAcceptancePolicyV1;
  readonly "retrieval-review": RetrievalReviewPolicyV1;
  readonly "risk-candidate": RiskCandidatePolicyBundleV1;
  readonly "identification-graph": IdentificationGraphPolicySetV1;
  readonly retry: IdentificationGraphRetryPolicyV1;
  readonly "assessment-runtime": AssessmentRuntimePolicySetV1;
  readonly "warning-runtime": WarningRuntimePolicySetV1;
  readonly "response-generation": ResponseGenerationPolicyV1;
  readonly "response-validation": ResponseValidationPolicyV1;
  readonly "response-agent": ResponseAgentPolicyV1;
  readonly calibration: CalibrationValidationPolicyV1;
  readonly "scoring-rules": ScoringRulesPolicyV1;
  readonly "report-export": ReportExportPolicyV1;
}

/**
 * 批准元数据：批准者与批准时间缺一不可（D-08）。
 * 旧配置的 approval.releaseId 继续可读，加载时归一丢弃：策略批准不与软件 release 绑定。
 */
const approvalMetadata = z
  .strictObject({
    approvedBy: IdentifierSchema,
    approvedAt: IsoDateTimeSchema,
    releaseId: IdentifierSchema.optional(),
  })
  .transform(({ approvedBy, approvedAt }) => ({ approvedBy, approvedAt }));

const catalogEntryBase = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: IdentifierSchema,
  policyType: DeploymentPolicyTypeV1Schema,
  policyRef: VersionReferenceSchema,
  approval: approvalMetadata,
});

/** 组合策略没有自身 ref，由已批准 catalog 分配组合身份。 */
const readDeclaredRef = (
  policyType: DeploymentPolicyTypeV1,
  body: unknown,
): VersionReference | undefined => {
  const record = body as Record<string, unknown>;
  switch (policyType) {
    case "risk-candidate":
    case "assessment-runtime":
    case "warning-runtime":
      return undefined;
    case "identification-graph":
      return VersionReferenceSchema.parse(
        (record.policySetRef as { reference?: unknown } | undefined)?.reference,
      );
    case "retrieval-acceptance":
      return VersionReferenceSchema.parse(record.acceptancePolicyRef);
    default:
      return VersionReferenceSchema.parse(record.policyRef);
  }
};

const validateProjectIds = (
  value: unknown,
  projectId: string,
  context: z.RefinementCtx,
  path: PropertyKey[] = ["body"],
): void => {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateProjectIds(item, projectId, context, [...path, index]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "projectId" && child !== projectId) {
      context.addIssue({
        code: "custom",
        path: [...path, key],
        message: "policy body projectId does not match the catalog project",
      });
    } else if (typeof child === "object" && child !== null) {
      validateProjectIds(child, projectId, context, [...path, key]);
    }
  }
};

/** 目录正文允许历史内联版本与该类型的唯一预算引用版本；运行接口类型由归一函数收口。 */
const catalogEntrySchema = <T extends DeploymentPolicyTypeV1, B>(
  policyType: T,
  bodySchema: z.ZodType<B>,
) =>
  catalogEntryBase
    .extend({ policyType: z.literal(policyType), body: bodySchema })
    .superRefine((entry, context) => {
      const declaredRef = readDeclaredRef(policyType, entry.body);
      if (declaredRef !== undefined && !sameRef(declaredRef, entry.policyRef)) {
        context.addIssue({
          code: "custom",
          path: ["body"],
          message: `${policyType} policy body reference does not match the catalog reference`,
        });
      }
      validateProjectIds(entry.body, entry.projectId, context);
    });

const sameRef = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

/** D-08：预算正文按身份唯一登记，供各阶段 V2/V3 策略引用，不再随策略内联复制。 */
export const DEPLOYMENT_POLICY_BUDGET_TYPE_V1 = "agent-task-budget" as const;

export const DeploymentPolicyBudgetEntryV1Schema = catalogEntryBase
  .extend({
    policyType: z.literal(DEPLOYMENT_POLICY_BUDGET_TYPE_V1),
    body: AgentTaskBudgetPolicyV1Schema,
  })
  .superRefine((entry, context) => {
    if (!sameRef(entry.body.policyRef, entry.policyRef))
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "agent-task-budget body reference does not match the catalog reference",
      });
  });
export type DeploymentPolicyBudgetEntryV1 = z.infer<typeof DeploymentPolicyBudgetEntryV1Schema>;
const candidateBudgetEntrySchema = catalogEntryBase.extend({
  policyType: z.literal("risk-candidate-budget"),
  body: RiskCandidateGenerationBudgetV1Schema,
});
const riskCandidatePolicyBundleV2Schema = RiskCandidatePolicyBundleV1Schema.extend({
  generation: RiskCandidateGenerationPolicyV1Schema.omit({ budget: true }).extend({
    schemaVersion: z.literal("2"),
  }),
});

/**
 * D-08 单份运行清单：V2/V3 持久正文只保留业务参数与唯一预算引用，
 * 模型、提示、工具引用与数值预算一律由被引用的预算成员解析，不在策略中重复抄写。
 */
const agentBudgetRefSchema = z.strictObject({
  definitionRef: VersionReferenceSchema,
  incrementSchemaRef: VersionReferenceSchema,
  validationPolicyRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
});
const scoringRulesPolicyV2Schema = z.strictObject({
  ...ScoringRulesPolicyV1Schema.shape,
  schemaVersion: z.literal("2"),
  agent: agentBudgetRefSchema,
});

/** 清洗策略 V3 = 现行 V2 业务规则 + 唯一预算引用；V2 版本号已由 documentRules 正文占用。 */
export const DataCleaningPolicyV3Schema = z.strictObject({
  ...DataCleaningPolicyV2Schema.shape,
  schemaVersion: z.literal("3"),
  agent: agentBudgetRefSchema,
});
export type DataCleaningPolicyV3 = z.infer<typeof DataCleaningPolicyV3Schema>;

/** 知识校验策略 V2 保留覆盖、层级与方法业务规则，Agent 引用只留唯一预算。 */
export const IdentificationKnowledgeValidationPolicyV2Schema = z.strictObject({
  ...IdentificationKnowledgeValidationPolicyV1Schema.shape,
  schemaVersion: z.literal("2"),
  agent: agentBudgetRefSchema,
});
export type IdentificationKnowledgeValidationPolicyV2 = z.infer<
  typeof IdentificationKnowledgeValidationPolicyV2Schema
>;

/** 处置 Agent 策略 V2 去掉内联预算与重复工具引用，只留业务定义与唯一预算引用。 */
export const ResponseAgentPolicyV2Schema = z
  .strictObject(ResponseAgentPolicyV1Schema.shape)
  .omit({ schemaVersion: true, toolPolicyRef: true, budgetPolicy: true })
  .extend({ schemaVersion: z.literal("2"), budgetPolicyRef: VersionReferenceSchema });
export type ResponseAgentPolicyV2 = z.infer<typeof ResponseAgentPolicyV2Schema>;

/** 校准策略 V2 保留证据与操作上限业务规则，预算正文同样只从目录引用解析。 */
export const CalibrationValidationPolicyV2Schema = z
  .strictObject(CalibrationValidationPolicyV1Schema.shape)
  .omit({ schemaVersion: true, toolPolicyRef: true, budgetPolicy: true })
  .extend({ schemaVersion: z.literal("2"), budgetPolicyRef: VersionReferenceSchema });
export type CalibrationValidationPolicyV2 = z.infer<typeof CalibrationValidationPolicyV2Schema>;

const entrySchemas = [
  catalogEntrySchema("cleaning", z.union([DataCleaningPolicySchema, DataCleaningPolicyV3Schema])),
  catalogEntrySchema(
    "knowledge-validation",
    z.union([
      IdentificationKnowledgeValidationPolicyV1Schema,
      IdentificationKnowledgeValidationPolicyV2Schema,
    ]),
  ),
  catalogEntrySchema("hybrid-retrieval", HybridRetrievalPolicyV1Schema),
  catalogEntrySchema("retrieval-acceptance", HybridRetrievalAcceptancePolicyV1Schema),
  catalogEntrySchema(
    "retrieval-review",
    z.union([RetrievalReviewPolicyV1Schema, RetrievalReviewPolicyV2Schema]),
  ),
  catalogEntrySchema(
    "risk-candidate",
    z.union([RiskCandidatePolicyBundleV1Schema, riskCandidatePolicyBundleV2Schema]),
  ),
  catalogEntrySchema("identification-graph", IdentificationGraphPolicySetV1Schema),
  catalogEntrySchema("retry", IdentificationGraphRetryPolicyV1Schema),
  catalogEntrySchema("assessment-runtime", AssessmentRuntimePolicySetV1Schema),
  catalogEntrySchema("warning-runtime", WarningRuntimePolicySetV1Schema),
  catalogEntrySchema("response-generation", ResponseGenerationPolicyV1Schema),
  catalogEntrySchema("response-validation", ResponseValidationPolicyV1Schema),
  catalogEntrySchema(
    "response-agent",
    z.union([ResponseAgentPolicyV1Schema, ResponseAgentPolicyV2Schema]),
  ),
  catalogEntrySchema(
    "calibration",
    z.union([CalibrationValidationPolicyV1Schema, CalibrationValidationPolicyV2Schema]),
  ),
  catalogEntrySchema(
    "scoring-rules",
    z.union([ScoringRulesPolicyV1Schema, scoringRulesPolicyV2Schema]),
  ),
  catalogEntrySchema("report-export", ReportExportPolicyV1Schema),
] as const;

export const DeploymentPolicyCatalogEntryV1 = z.union(entrySchemas);
export type DeploymentPolicyCatalogEntryV1 = z.infer<typeof DeploymentPolicyCatalogEntryV1>;

export const DeploymentDownstreamAuthorizationPolicyV1Schema = z
  .strictObject({
    policyRef: VersionReferenceSchema,
    bindings: z
      .array(
        z.strictObject({
          rootBranch: ModuleBranchV1Schema,
          downstreamBranches: z.array(ModuleBranchV1Schema).min(1).max(128),
        }),
      )
      .min(1)
      .max(128),
  })
  .superRefine((policy, context) => {
    const roots = new Set<string>();
    for (const [index, binding] of policy.bindings.entries()) {
      if (roots.has(binding.rootBranch)) {
        context.addIssue({
          code: "custom",
          path: ["bindings", index],
          message: "duplicate root branch",
        });
      }
      roots.add(binding.rootBranch);
      if (new Set(binding.downstreamBranches).size !== binding.downstreamBranches.length) {
        context.addIssue({
          code: "custom",
          path: ["bindings", index],
          message: "duplicate downstream branch",
        });
      }
    }
  });
export type DeploymentDownstreamAuthorizationPolicyV1 = z.infer<
  typeof DeploymentDownstreamAuthorizationPolicyV1Schema
>;

export const DeploymentPolicyCatalogV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogRef: VersionReferenceSchema,
  purpose: DeploymentPolicyPurposeV1Schema,
  downstreamAuthorization: DeploymentDownstreamAuthorizationPolicyV1Schema,
  /** D-08：各阶段复用预算正文的唯一集合，按 (projectId, policyRef) 身份登记。 */
  budgetPolicies: z
    .array(z.union([DeploymentPolicyBudgetEntryV1Schema, candidateBudgetEntrySchema]))
    .optional(),
  /** 同一工程与类型可保留多个精确版本。 */
  entries: z.array(DeploymentPolicyCatalogEntryV1).min(1),
});
export type DeploymentPolicyCatalogV1 = z.infer<typeof DeploymentPolicyCatalogV1Schema>;

export const DEPLOYMENT_POLICY_ERROR_V1 = {
  malformed: "DEPLOYMENT_POLICY_CATALOG_MALFORMED",
  missing: "DEPLOYMENT_POLICY_NOT_FOUND",
  duplicate: "DEPLOYMENT_POLICY_DUPLICATE_ENTRY",
  refMismatch: "DEPLOYMENT_POLICY_REF_MISMATCH",
  unapproved: "DEPLOYMENT_POLICY_NOT_APPROVED",
} as const;
export type DeploymentPolicyErrorCodeV1 =
  (typeof DEPLOYMENT_POLICY_ERROR_V1)[keyof typeof DEPLOYMENT_POLICY_ERROR_V1];

export class DeploymentPolicyError extends Error {
  readonly code: DeploymentPolicyErrorCodeV1;
  /** 仅类型与安全标识，不含正文。 */
  readonly policyType: string;
  readonly policyRef: string;

  constructor(code: DeploymentPolicyErrorCodeV1, policyType: string, policyRef: string) {
    super(code);
    this.name = "DeploymentPolicyError";
    this.code = code;
    this.policyType = policyType;
    this.policyRef = policyRef;
  }
}

/** 精确策略定位键：projectId + 类型 + 版本引用三者缺一不可。 */
export type DeploymentPolicySelectorV1 = {
  [T in DeploymentPolicyTypeV1]: {
    readonly projectId: string;
    readonly policyType: T;
    readonly policyRef: VersionReference;
  };
}[DeploymentPolicyTypeV1];

export interface DeploymentPolicyCatalogReaderV1 {
  /** 按精确 (projectId, policyType, ref) 解析；缺失或漂移一律失败，不取最近版本。 */
  resolve<T extends DeploymentPolicySelectorV1>(
    selector: T,
  ): DeploymentPolicyBodyByTypeV1[T["policyType"]];
  tryResolve<T extends DeploymentPolicySelectorV1>(
    selector: T,
  ): DeploymentPolicyBodyByTypeV1[T["policyType"]] | undefined;
  listProjectIds(): readonly string[];
}

const refKey = (reference: VersionReference): string =>
  `${reference.entityId}/${reference.versionId}`;

/** 目录身份键：projectId + 成员类型 + 精确版本引用三者缺一不可。 */
const policyKey = (projectId: string, policyType: string, reference: VersionReference): string =>
  JSON.stringify([projectId, policyType, reference.entityId, reference.versionId]);

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

export const createDeploymentPolicyCatalogReaderV1 = (
  catalog: DeploymentPolicyCatalogV1,
): DeploymentPolicyCatalogReaderV1 => {
  const parsed = deepFreeze(DeploymentPolicyCatalogV1Schema.parse(catalog));
  const budgets = new Map<
    string,
    NonNullable<DeploymentPolicyCatalogV1["budgetPolicies"]>[number]
  >();
  for (const entry of parsed.budgetPolicies ?? []) {
    const key = policyKey(entry.projectId, entry.policyType, entry.policyRef);
    if (budgets.has(key)) {
      throw new DeploymentPolicyError(
        DEPLOYMENT_POLICY_ERROR_V1.duplicate,
        entry.policyType,
        refKey(entry.policyRef),
      );
    }
    budgets.set(key, entry);
  }

  /** D-08：预算正文按 (projectId, 预算引用) 精确解析；缺失即配置错误，不取其它版本。 */
  const requireBudget = (
    projectId: string,
    budgetPolicyRef: VersionReference,
  ): AgentTaskBudgetPolicyV1 => {
    const budget = budgets.get(
      policyKey(projectId, DEPLOYMENT_POLICY_BUDGET_TYPE_V1, budgetPolicyRef),
    );
    if (budget === undefined || budget.policyType !== DEPLOYMENT_POLICY_BUDGET_TYPE_V1) {
      throw new DeploymentPolicyError(
        DEPLOYMENT_POLICY_ERROR_V1.missing,
        DEPLOYMENT_POLICY_BUDGET_TYPE_V1,
        refKey(budgetPolicyRef),
      );
    }
    return budget.body;
  };

  /** 复用原 V1 约束复核：归一正文超出被引用预算或违反原契约即引用漂移，不静默截断。 */
  const normalizeOrThrow = <T>(
    entry: DeploymentPolicyCatalogEntryV1,
    schema: z.ZodType<T>,
    candidate: unknown,
  ): T => {
    const normalized = schema.safeParse(candidate);
    if (!normalized.success) {
      throw new DeploymentPolicyError(
        DEPLOYMENT_POLICY_ERROR_V1.refMismatch,
        entry.policyType,
        refKey(entry.policyRef),
      );
    }
    return normalized.data;
  };

  /** 归一后的 Agent 引用：模型、提示、工具引用与完整预算正文都取自被引用预算成员。 */
  const agentWithBudget = (
    agent: z.infer<typeof agentBudgetRefSchema>,
    budget: AgentTaskBudgetPolicyV1,
  ) => ({
    definitionRef: agent.definitionRef,
    incrementSchemaRef: agent.incrementSchemaRef,
    validationPolicyRef: agent.validationPolicyRef,
    budgetPolicyRef: agent.budgetPolicyRef,
    modelDeploymentRef: budget.modelDeploymentRef,
    promptTemplateRef: budget.promptTemplateRef,
    toolPolicyRef: budget.toolPolicyRef,
    budgetPolicy: budget,
  });

  /** V2/V3 归一：补回被引用预算的模型、提示、工具引用与数值预算，返回原运行接口对象。 */
  const normalizeBody = (
    entry: DeploymentPolicyCatalogEntryV1,
  ): DeploymentPolicyCatalogEntryV1["body"] => {
    switch (entry.policyType) {
      case "risk-candidate": {
        if (entry.body.generation.schemaVersion === "1") return entry.body;
        const budgetRef = entry.body.generation.budgetPolicyRef;
        const budget = budgets.get(policyKey(entry.projectId, "risk-candidate-budget", budgetRef));
        if (budget === undefined || budget.policyType !== "risk-candidate-budget")
          throw new DeploymentPolicyError(
            DEPLOYMENT_POLICY_ERROR_V1.missing,
            "risk-candidate-budget",
            refKey(budgetRef),
          );
        return normalizeOrThrow(entry, RiskCandidatePolicyBundleV1Schema, {
          ...entry.body,
          generation: { ...entry.body.generation, schemaVersion: "1", budget: budget.body },
        });
      }
      case "retrieval-review": {
        if (entry.body.schemaVersion === "1") return entry.body;
        const budget = requireBudget(entry.projectId, entry.body.budgetPolicyRef);
        return normalizeOrThrow(entry, RetrievalReviewPolicyV1Schema, {
          ...entry.body,
          schemaVersion: "1",
          budgetPolicy: budget,
          modelDeploymentRef: budget.modelDeploymentRef,
          promptTemplateRef: budget.promptTemplateRef,
          toolPolicyRef: budget.toolPolicyRef,
        });
      }
      case "cleaning": {
        if (entry.body.schemaVersion !== "3") return entry.body;
        return normalizeOrThrow(entry, DataCleaningPolicyV2Schema, {
          ...entry.body,
          schemaVersion: "2",
          agent: agentWithBudget(
            entry.body.agent,
            requireBudget(entry.projectId, entry.body.agent.budgetPolicyRef),
          ),
        });
      }
      case "knowledge-validation": {
        if (entry.body.schemaVersion === "1") return entry.body;
        return normalizeOrThrow(entry, IdentificationKnowledgeValidationPolicyV1Schema, {
          ...entry.body,
          schemaVersion: "1",
          agent: agentWithBudget(
            entry.body.agent,
            requireBudget(entry.projectId, entry.body.agent.budgetPolicyRef),
          ),
        });
      }
      case "scoring-rules": {
        if (entry.body.schemaVersion === "1") return entry.body;
        return normalizeOrThrow(entry, ScoringRulesPolicyV1Schema, {
          ...entry.body,
          schemaVersion: "1",
          agent: agentWithBudget(
            entry.body.agent,
            requireBudget(entry.projectId, entry.body.agent.budgetPolicyRef),
          ),
        });
      }
      case "response-agent": {
        if (entry.body.schemaVersion === "1") return entry.body;
        const budget = requireBudget(entry.projectId, entry.body.budgetPolicyRef);
        return normalizeOrThrow(entry, ResponseAgentPolicyV1Schema, {
          schemaVersion: "1",
          policyRef: entry.body.policyRef,
          projectId: entry.body.projectId,
          definitionRef: entry.body.definitionRef,
          incrementSchemaRef: entry.body.incrementSchemaRef,
          validationPolicyRef: entry.body.validationPolicyRef,
          toolPolicyRef: budget.toolPolicyRef,
          budgetPolicy: budget,
        });
      }
      case "calibration": {
        if (entry.body.schemaVersion === "1") return entry.body;
        const budget = requireBudget(entry.projectId, entry.body.budgetPolicyRef);
        return normalizeOrThrow(entry, CalibrationValidationPolicyV1Schema, {
          schemaVersion: "1",
          policyRef: entry.body.policyRef,
          projectId: entry.body.projectId,
          definitionRef: entry.body.definitionRef,
          incrementSchemaRef: entry.body.incrementSchemaRef,
          validationPolicyRef: entry.body.validationPolicyRef,
          evidenceRequirementCount: entry.body.evidenceRequirementCount,
          maxOperations: entry.body.maxOperations,
          toolPolicyRef: budget.toolPolicyRef,
          budgetPolicy: budget,
        });
      }
      default:
        return entry.body;
    }
  };
  const index = new Map<string, DeploymentPolicyCatalogEntryV1>();
  for (const entry of parsed.entries) {
    const key = policyKey(entry.projectId, entry.policyType, entry.policyRef);
    if (index.has(key)) {
      throw new DeploymentPolicyError(
        DEPLOYMENT_POLICY_ERROR_V1.duplicate,
        entry.policyType,
        refKey(entry.policyRef),
      );
    }
    const body = normalizeBody(entry);
    // 归一后的正文仍以原条目身份登记；历史内联与其他类型正文原样复用。
    index.set(
      key,
      body === entry.body
        ? entry
        : deepFreeze({ ...entry, body } as DeploymentPolicyCatalogEntryV1),
    );
  }

  const lookup = (
    selector: DeploymentPolicySelectorV1,
  ): DeploymentPolicyCatalogEntryV1 | undefined => {
    return index.get(policyKey(selector.projectId, selector.policyType, selector.policyRef));
  };

  return {
    resolve<T extends DeploymentPolicySelectorV1>(
      selector: T,
    ): DeploymentPolicyBodyByTypeV1[T["policyType"]] {
      const entry = lookup(selector);
      if (entry === undefined) {
        throw new DeploymentPolicyError(
          DEPLOYMENT_POLICY_ERROR_V1.missing,
          selector.policyType,
          refKey(selector.policyRef),
        );
      }
      return entry.body as DeploymentPolicyBodyByTypeV1[T["policyType"]];
    },
    tryResolve<T extends DeploymentPolicySelectorV1>(
      selector: T,
    ): DeploymentPolicyBodyByTypeV1[T["policyType"]] | undefined {
      const entry = lookup(selector);
      return entry === undefined
        ? undefined
        : (entry.body as DeploymentPolicyBodyByTypeV1[T["policyType"]]);
    },
    listProjectIds(): readonly string[] {
      return Object.freeze([...new Set(parsed.entries.map((entry) => entry.projectId))].sort());
    },
  };
};

export interface DeploymentPolicyRefInputV1 {
  readonly projectId: string;
  readonly policyRef: VersionReference;
}

/** 每个入口的返回类型由固定 policyType 决定。 */
export interface DeploymentPolicyResolversV1 {
  cleaningPolicy(input: DeploymentPolicyRefInputV1): DataCleaningPolicy;
  knowledgeValidationPolicy(
    input: DeploymentPolicyRefInputV1,
  ): IdentificationKnowledgeValidationPolicyV1;
  hybridRetrievalPolicy(input: DeploymentPolicyRefInputV1): HybridRetrievalPolicyV1;
  hybridRetrievalAcceptance(input: DeploymentPolicyRefInputV1): HybridRetrievalAcceptancePolicyV1;
  retrievalReview(input: DeploymentPolicyRefInputV1): RetrievalReviewPolicyV1;
  riskCandidateBundle(input: DeploymentPolicyRefInputV1): RiskCandidatePolicyBundleV1;
  identificationGraphPolicySet(input: DeploymentPolicyRefInputV1): IdentificationGraphPolicySetV1;
  retryPolicy(input: DeploymentPolicyRefInputV1): IdentificationGraphRetryPolicyV1;
  assessmentRuntimePolicySet(input: DeploymentPolicyRefInputV1): AssessmentRuntimePolicySetV1;
  warningRuntimePolicySet(input: DeploymentPolicyRefInputV1): WarningRuntimePolicySetV1;
  responseGenerationPolicy(input: DeploymentPolicyRefInputV1): ResponseGenerationPolicyV1;
  responseValidationPolicy(input: DeploymentPolicyRefInputV1): ResponseValidationPolicyV1;
  responseAgentPolicy(input: DeploymentPolicyRefInputV1): ResponseAgentPolicyV1;
  calibrationValidationPolicy(input: DeploymentPolicyRefInputV1): CalibrationValidationPolicyV1;
  scoringRulesPolicy(input: DeploymentPolicyRefInputV1): ScoringRulesPolicyV1;
  reportExportPolicy(input: DeploymentPolicyRefInputV1): ReportExportPolicyV1;
}

export const createDeploymentPolicyResolversV1 = (
  reader: DeploymentPolicyCatalogReaderV1,
): DeploymentPolicyResolversV1 => ({
  cleaningPolicy: (input) => reader.resolve({ ...input, policyType: "cleaning" }),
  knowledgeValidationPolicy: (input) =>
    reader.resolve({ ...input, policyType: "knowledge-validation" }),
  hybridRetrievalPolicy: (input) => reader.resolve({ ...input, policyType: "hybrid-retrieval" }),
  hybridRetrievalAcceptance: (input) =>
    reader.resolve({ ...input, policyType: "retrieval-acceptance" }),
  retrievalReview: (input) => reader.resolve({ ...input, policyType: "retrieval-review" }),
  riskCandidateBundle: (input) => reader.resolve({ ...input, policyType: "risk-candidate" }),
  identificationGraphPolicySet: (input) =>
    reader.resolve({ ...input, policyType: "identification-graph" }),
  retryPolicy: (input) => reader.resolve({ ...input, policyType: "retry" }),
  assessmentRuntimePolicySet: (input) =>
    reader.resolve({ ...input, policyType: "assessment-runtime" }),
  warningRuntimePolicySet: (input) => reader.resolve({ ...input, policyType: "warning-runtime" }),
  responseGenerationPolicy: (input) =>
    reader.resolve({ ...input, policyType: "response-generation" }),
  responseValidationPolicy: (input) =>
    reader.resolve({ ...input, policyType: "response-validation" }),
  responseAgentPolicy: (input) => reader.resolve({ ...input, policyType: "response-agent" }),
  calibrationValidationPolicy: (input) => reader.resolve({ ...input, policyType: "calibration" }),
  scoringRulesPolicy: (input) => reader.resolve({ ...input, policyType: "scoring-rules" }),
  reportExportPolicy: (input) => reader.resolve({ ...input, policyType: "report-export" }),
});
