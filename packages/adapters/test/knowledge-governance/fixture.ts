import { vi } from "vitest";

import {
  PostgresKnowledgeGovernanceAdapter,
  type KnowledgeGovernanceReviewAuthorizationProviderV1,
  type PostgresKnowledgeGovernanceAdapterOptionsV1,
} from "../../src/knowledge-governance/index.js";
import {
  PostgresReviewAuditAdapter,
  type PostgresReviewAuditAdapterOptions,
} from "../../src/review-audit/index.js";
import {
  startReviewAuditFixture,
  type ReviewAuditPostgresFixture,
} from "../review-audit/fixture.js";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  type AuthorizationContextV1,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { AssessmentConfigurationGovernancePolicyV1 } from "@riskflow/core/assessment-config";
import type { ScoringRulesGovernancePolicyV1 } from "@riskflow/core/scoring-rules";
import type { IdentificationKnowledgeGovernancePolicyV1 } from "@riskflow/core/identification-knowledge";

export const GOVERNANCE_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";

const contextFor = (
  projectId: string,
  actorId: string,
  grantedCapabilities: AuthorizationContextV1["grantedCapabilities"],
  invocation: AuthorizationContextV1["invocation"] = { kind: "human" },
): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: `authorization-${projectId}-${actorId}`, versionId: "1" },
  },
  actorId,
  projectId,
  grantedCapabilities,
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: GOVERNANCE_TEST_TIMESTAMP,
  invocation,
});

export const governanceAuthorizationFor = (projectId: string, actorId = "manager-1") =>
  contextFor(projectId, actorId, ["knowledge-modeling.govern"]);

export const reviewAuthorizationFor = (projectId: string, actorId = "manager-1") =>
  contextFor(projectId, actorId, [
    "review-audit.request",
    "review-audit.read",
    "review-audit.decide",
  ]);

/**
 * D-11：C16→C07 结构化授权 provider。它只按请求中的精确分支签发唯一能力，不改写
 * invocationId、工程或 actor；provider 缺失时 C16 在 C07 读取前关闭失败。
 */
export const reviewAuthorizationProviderFor =
  (): KnowledgeGovernanceReviewAuthorizationProviderV1 => ({
    authorize: async (input) =>
      contextFor(input.projectId, input.actorId, [MODULE_BRANCH_CAPABILITY_V1[input.branch]]),
  });

export interface KnowledgeGovernancePostgresFixture {
  readonly postgres: ReviewAuditPostgresFixture["postgres"];
  readonly runtime: ReviewAuditPostgresFixture["runtime"];
  readonly transactionUnit: ReviewAuditPostgresFixture["transactionUnit"];
  readonly access: LocalIdentityAccessV1;
  readonly reviewAudit: PostgresReviewAuditAdapter;
  readonly adapter: PostgresKnowledgeGovernanceAdapter;
  setVerifiedContext(context: AuthorizationContextV1): void;
  close(): Promise<void>;
}

export const startKnowledgeGovernanceFixture = async (options?: {
  readonly assessmentConfigurationPolicy?: AssessmentConfigurationGovernancePolicyV1;
  readonly scoringRulesPolicy?: ScoringRulesGovernancePolicyV1;
  readonly identificationKnowledgePolicy?: IdentificationKnowledgeGovernancePolicyV1;
}): Promise<KnowledgeGovernancePostgresFixture> => {
  const base = await startReviewAuditFixture();
  const verifiedContexts = new Map<string, AuthorizationContextV1>();
  const contextKey = (context: AuthorizationContextV1["authorizationContextRef"]) =>
    `${context.reference.entityId}:${context.reference.versionId}`;
  const verify = vi.fn(
    async (request: {
      authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
      projectId: string;
    }) => {
      const configured = verifiedContexts.get(contextKey(request.authorizationContextRef));
      const context =
        configured ??
        Object.freeze({
          ...governanceAuthorizationFor(request.projectId),
          authorizationContextRef: request.authorizationContextRef,
        });
      return { context, contextRef: request.authorizationContextRef, redacted: false };
    },
  );
  const access = { verify } as unknown as LocalIdentityAccessV1;
  const reviewAuditOptions: PostgresReviewAuditAdapterOptions = {
    db: base.runtime.db,
    transactionUnit: base.transactionUnit,
    access,
    now: () => new Date("2030-01-01T00:00:01.000Z"),
  };
  const reviewAudit = new PostgresReviewAuditAdapter(reviewAuditOptions);
  const adapterOptions: PostgresKnowledgeGovernanceAdapterOptionsV1 = {
    db: base.runtime.db,
    transactionUnit: base.transactionUnit,
    access,
    reviewAudit,
    now: () => new Date("2030-01-01T00:00:01.000Z"),
    reviewAuthorizationProvider: reviewAuthorizationProviderFor(),
    ...(options?.assessmentConfigurationPolicy === undefined
      ? {}
      : { assessmentConfigurationPolicy: options.assessmentConfigurationPolicy }),
    ...(options?.scoringRulesPolicy === undefined
      ? {}
      : { scoringRulesPolicy: options.scoringRulesPolicy }),
    ...(options?.identificationKnowledgePolicy === undefined
      ? {}
      : { identificationKnowledgePolicy: options.identificationKnowledgePolicy }),
  };
  const adapter = new PostgresKnowledgeGovernanceAdapter(adapterOptions);
  return {
    postgres: base.postgres,
    runtime: base.runtime,
    transactionUnit: base.transactionUnit,
    access,
    reviewAudit,
    adapter,
    setVerifiedContext(context) {
      verifiedContexts.set(contextKey(context.authorizationContextRef), context);
    },
    async close() {
      await base.close();
    },
  };
};
