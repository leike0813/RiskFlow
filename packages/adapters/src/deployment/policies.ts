import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import {
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
  "response",
  "calibration",
] as const;
export const DeploymentPolicyTypeV1Schema = z.enum(DEPLOYMENT_POLICY_TYPE_V1_VALUES);
export type DeploymentPolicyTypeV1 = z.infer<typeof DeploymentPolicyTypeV1Schema>;

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

/** 正文自带引用必须与 catalog 登记 ref 一致，防止以旧 ref 取到新正文。 */
const refConsistency =
  (policyType: DeploymentPolicyTypeV1) =>
  (entry: { body: unknown; policyRef: VersionReference }, context: z.RefinementCtx): void => {
    const declaredRef = readDeclaredRef(entry.body);
    if (declaredRef !== undefined && !sameRef(declaredRef, entry.policyRef)) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: `${policyType} policy body reference does not match the catalog reference`,
      });
    }
  };

/** 从各类型正文中提取其自带引用；无自带引用的类型不做此项校验。 */
const readDeclaredRef = (body: unknown): VersionReference | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const candidate = record.policyRef ?? record.policySetRef ?? record.acceptancePolicyRef;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "entityId" in candidate &&
    "versionId" in candidate
  ) {
    return VersionReferenceSchema.parse(candidate);
  }
  return undefined;
};

const sameRef = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const entrySchemas = [
  catalogEntryBase
    .extend({
      policyType: z.literal("hybrid-retrieval"),
      body: HybridRetrievalAcceptancePolicyV1Schema,
    })
    .superRefine(refConsistency("hybrid-retrieval")),
  catalogEntryBase
    .extend({
      policyType: z.literal("retrieval-acceptance"),
      body: HybridRetrievalAcceptancePolicyV1Schema,
    })
    .superRefine(refConsistency("retrieval-acceptance")),
  catalogEntryBase
    .extend({ policyType: z.literal("retrieval-review"), body: RetrievalReviewPolicyV1Schema })
    .superRefine(refConsistency("retrieval-review")),
  catalogEntryBase
    .extend({ policyType: z.literal("risk-candidate"), body: RiskCandidatePolicyBundleV1Schema })
    .superRefine(refConsistency("risk-candidate")),
  catalogEntryBase
    .extend({
      policyType: z.literal("identification-graph"),
      body: IdentificationGraphPolicySetV1Schema,
    })
    .superRefine(refConsistency("identification-graph")),
  catalogEntryBase
    .extend({ policyType: z.literal("retry"), body: IdentificationGraphRetryPolicyV1Schema })
    .superRefine(refConsistency("retry")),
] as const;

export const DeploymentPolicyCatalogEntryV1 = z.union([
  entrySchemas[0],
  entrySchemas[1],
  entrySchemas[2],
  entrySchemas[3],
  entrySchemas[4],
  entrySchemas[5],
]);
export type DeploymentPolicyCatalogEntryV1 = z.infer<typeof DeploymentPolicyCatalogEntryV1>;

export const DeploymentPolicyCatalogV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogRef: VersionReferenceSchema,
  /** 同一 (projectId, policyType) 只允许一个当前条目；历史版本另由发布决定切换。 */
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
export interface DeploymentPolicySelectorV1 {
  readonly projectId: string;
  readonly policyType: DeploymentPolicyTypeV1;
  readonly policyRef: VersionReference;
}

export interface DeploymentPolicyCatalogReaderV1 {
  /** 按精确 (projectId, policyType, ref) 解析；缺失或漂移一律失败，不取最近版本。 */
  resolve<T>(selector: DeploymentPolicySelectorV1): T;
  tryResolve<T>(selector: DeploymentPolicySelectorV1): T | undefined;
  listProjectIds(): readonly string[];
}

const refKey = (reference: VersionReference): string =>
  `${reference.entityId}/${reference.versionId}`;

const entryKey = (entry: DeploymentPolicyCatalogEntryV1): string =>
  `${entry.projectId}/${entry.policyType}`;

export const createDeploymentPolicyCatalogReaderV1 = (
  catalog: DeploymentPolicyCatalogV1,
): DeploymentPolicyCatalogReaderV1 => {
  const parsed = DeploymentPolicyCatalogV1Schema.parse(catalog);
  const index = new Map<string, DeploymentPolicyCatalogEntryV1>();
  for (const entry of parsed.entries) {
    const key = entryKey(entry);
    const existing = index.get(key);
    if (existing !== undefined) {
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
    const entry = index.get(`${selector.projectId}/${selector.policyType}`);
    if (entry === undefined) return undefined;
    if (!sameRef(entry.policyRef, selector.policyRef)) return undefined;
    if (entry.approval.releaseId.length === 0) return undefined;
    return entry;
  };

  return {
    resolve<T>(selector: DeploymentPolicySelectorV1): T {
      const entry = lookup(selector);
      if (entry === undefined) {
        throw new DeploymentPolicyError(
          DEPLOYMENT_POLICY_ERROR_V1.missing,
          selector.policyType,
          refKey(selector.policyRef),
        );
      }
      return entry.body as T;
    },
    tryResolve<T>(selector: DeploymentPolicySelectorV1): T | undefined {
      const entry = lookup(selector);
      return entry === undefined ? undefined : (entry.body as T);
    },
    listProjectIds(): readonly string[] {
      return Object.freeze([...new Set(parsed.entries.map((entry) => entry.projectId))].sort());
    },
  };
};

/** 强类型读取入口：调用方必须给出原 core 的返回类型，避免退化成 any。 */
export interface DeploymentPolicyResolversV1 {
  hybridRetrievalAcceptance(input: {
    readonly projectId: string;
    readonly policyRef: VersionReference;
  }): HybridRetrievalAcceptancePolicyV1;
  retrievalReview(input: {
    readonly projectId: string;
    readonly policyRef: VersionReference;
  }): RetrievalReviewPolicyV1;
  riskCandidateBundle(input: {
    readonly projectId: string;
    readonly policyRef: VersionReference;
  }): RiskCandidatePolicyBundleV1;
  identificationGraphPolicySet(input: {
    readonly projectId: string;
    readonly policyRef: VersionReference;
  }): IdentificationGraphPolicySetV1;
  retryPolicy(input: {
    readonly projectId: string;
    readonly policyRef: VersionReference;
  }): IdentificationGraphRetryPolicyV1;
}

export const createDeploymentPolicyResolversV1 = (
  reader: DeploymentPolicyCatalogReaderV1,
): DeploymentPolicyResolversV1 => ({
  hybridRetrievalAcceptance: (input) =>
    reader.resolve<HybridRetrievalAcceptancePolicyV1>({
      ...input,
      policyType: "retrieval-acceptance",
    }),
  retrievalReview: (input) =>
    reader.resolve<RetrievalReviewPolicyV1>({ ...input, policyType: "retrieval-review" }),
  riskCandidateBundle: (input) =>
    reader.resolve<RiskCandidatePolicyBundleV1>({ ...input, policyType: "risk-candidate" }),
  identificationGraphPolicySet: (input) =>
    reader.resolve<IdentificationGraphPolicySetV1>({
      ...input,
      policyType: "identification-graph",
    }),
  retryPolicy: (input) =>
    reader.resolve<IdentificationGraphRetryPolicyV1>({ ...input, policyType: "retry" }),
});
