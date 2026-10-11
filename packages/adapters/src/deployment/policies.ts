import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import { ModuleBranchV1Schema } from "@riskflow/contracts/ports";
import {
  DataCleaningPolicyV1Schema,
  type DataCleaningPolicyV1,
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

export interface DeploymentPolicyBodyByTypeV1 {
  readonly cleaning: DataCleaningPolicyV1;
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

/** 批准元数据：绑定批准者、批准时间与介质身份，缺一不可。 */
const approvalMetadata = z.strictObject({
  approvedBy: IdentifierSchema,
  approvedAt: IsoDateTimeSchema,
  releaseId: IdentifierSchema,
});

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

const catalogEntrySchema = <T extends DeploymentPolicyTypeV1>(
  policyType: T,
  bodySchema: z.ZodType<DeploymentPolicyBodyByTypeV1[T]>,
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

const entrySchemas = [
  catalogEntrySchema("cleaning", DataCleaningPolicyV1Schema),
  catalogEntrySchema("knowledge-validation", IdentificationKnowledgeValidationPolicyV1Schema),
  catalogEntrySchema("hybrid-retrieval", HybridRetrievalPolicyV1Schema),
  catalogEntrySchema("retrieval-acceptance", HybridRetrievalAcceptancePolicyV1Schema),
  catalogEntrySchema("retrieval-review", RetrievalReviewPolicyV1Schema),
  catalogEntrySchema("risk-candidate", RiskCandidatePolicyBundleV1Schema),
  catalogEntrySchema("identification-graph", IdentificationGraphPolicySetV1Schema),
  catalogEntrySchema("retry", IdentificationGraphRetryPolicyV1Schema),
  catalogEntrySchema("assessment-runtime", AssessmentRuntimePolicySetV1Schema),
  catalogEntrySchema("warning-runtime", WarningRuntimePolicySetV1Schema),
  catalogEntrySchema("response-generation", ResponseGenerationPolicyV1Schema),
  catalogEntrySchema("response-validation", ResponseValidationPolicyV1Schema),
  catalogEntrySchema("response-agent", ResponseAgentPolicyV1Schema),
  catalogEntrySchema("calibration", CalibrationValidationPolicyV1Schema),
  catalogEntrySchema("scoring-rules", ScoringRulesPolicyV1Schema),
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

const entryKey = (entry: DeploymentPolicyCatalogEntryV1): string =>
  JSON.stringify([
    entry.projectId,
    entry.policyType,
    entry.policyRef.entityId,
    entry.policyRef.versionId,
  ]);

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
  const index = new Map<string, DeploymentPolicyCatalogEntryV1>();
  for (const entry of parsed.entries) {
    const key = entryKey(entry);
    if (index.has(key)) {
      throw new DeploymentPolicyError(
        DEPLOYMENT_POLICY_ERROR_V1.duplicate,
        entry.policyType,
        refKey(entry.policyRef),
      );
    }
    index.set(key, entry);
  }

  const lookup = (
    selector: DeploymentPolicySelectorV1,
  ): DeploymentPolicyCatalogEntryV1 | undefined => {
    const entry = index.get(
      JSON.stringify([
        selector.projectId,
        selector.policyType,
        selector.policyRef.entityId,
        selector.policyRef.versionId,
      ]),
    );
    if (entry === undefined) return undefined;
    if (entry.approval.releaseId.length === 0) return undefined;
    return entry;
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
  cleaningPolicy(input: DeploymentPolicyRefInputV1): DataCleaningPolicyV1;
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
