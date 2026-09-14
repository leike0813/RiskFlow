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
  type ModuleBranchV1,
} from "@riskflow/contracts/ports";
import {
  AccessErrorV1Schema,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
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
 * invocationId、工程或 actor；每个 invocation 使用独立上下文引用，模拟 C06「一调用一绑定」。
 */
export const reviewAuthorizationProviderFor = (options?: {
  readonly register?: (
    context: AuthorizationContextV1,
    input: KnowledgeGovernanceReviewAuthorizationRequestV1,
  ) => void;
}): KnowledgeGovernanceReviewAuthorizationProviderV1 => ({
  authorize: async (input) => {
    const context = contextFor(input.projectId, input.actorId, [
      MODULE_BRANCH_CAPABILITY_V1[input.branch],
    ]);
    const bound = {
      ...context,
      authorizationContextRef: {
        kind: "authorization-context" as const,
        reference: { entityId: `${input.projectId}:${input.invocationId}`, versionId: "1" },
      },
    };
    options?.register?.(bound, input);
    return bound;
  },
});

export interface KnowledgeGovernancePostgresFixture {
  readonly postgres: ReviewAuditPostgresFixture["postgres"];
  readonly runtime: ReviewAuditPostgresFixture["runtime"];
  readonly transactionUnit: ReviewAuditPostgresFixture["transactionUnit"];
  readonly access: LocalIdentityAccessV1;
  readonly reviewAudit: PostgresReviewAuditAdapter;
  readonly adapter: PostgresKnowledgeGovernanceAdapter;
  setVerifiedContext(context: AuthorizationContextV1): void;
  /** 与夹具 C06 替身共享绑定表的复核授权 provider：复验按精确 invocation 生效。 */
  reviewAuthorizationProvider(): KnowledgeGovernanceReviewAuthorizationProviderV1;
  close(): Promise<void>;
}

export const startKnowledgeGovernanceFixture = async (options?: {
  readonly assessmentConfigurationPolicy?: AssessmentConfigurationGovernancePolicyV1;
  readonly scoringRulesPolicy?: ScoringRulesGovernancePolicyV1;
  readonly identificationKnowledgePolicy?: IdentificationKnowledgeGovernancePolicyV1;
}): Promise<KnowledgeGovernancePostgresFixture> => {
  const base = await startReviewAuditFixture();
  const verifiedContexts = new Map<string, AuthorizationContextV1>();
  /** 一份上下文引用只绑定一个 invocation：与 C06 的精确复验语义一致。 */
  const boundInvocations = new Map<string, string>();
  const contextKey = (context: AuthorizationContextV1["authorizationContextRef"]) =>
    `${context.reference.entityId}:${context.reference.versionId}`;
  const verify = vi.fn(
    async (request: {
      authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
      projectId: string;
      invocationId?: string;
      branch?: ModuleBranchV1;
    }) => {
      const key = contextKey(request.authorizationContextRef);
      const bound = boundInvocations.get(key);
      if (bound !== undefined && bound !== request.invocationId) {
        throw new AccessServiceError(
          AccessErrorV1Schema.parse({
            code: "AUTHORIZATION_DENIED",
            retryable: false,
            stage: "access.verify",
            occurredAt: GOVERNANCE_TEST_TIMESTAMP,
            diagnosticRef: {
              kind: "diagnostic-artifact",
              reference: { entityId: "c16-invocation-binding", versionId: "1" },
            },
            contextRefs: [],
            requiredCapability:
              request.branch === undefined
                ? "review-audit.request"
                : MODULE_BRANCH_CAPABILITY_V1[request.branch],
            authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          }),
        );
      }
      const configured = verifiedContexts.get(key);
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
  /** provider 签发的上下文同时进入 C06 替身的结果表与 invocation 绑定表。 */
  const registerReviewContext = (
    context: AuthorizationContextV1,
    input: KnowledgeGovernanceReviewAuthorizationRequestV1,
  ): void => {
    verifiedContexts.set(contextKey(context.authorizationContextRef), context);
    boundInvocations.set(contextKey(context.authorizationContextRef), input.invocationId);
  };
  const reviewAuthorizationProvider = reviewAuthorizationProviderFor({
    register: registerReviewContext,
  });
  const adapterOptions: PostgresKnowledgeGovernanceAdapterOptionsV1 = {
    db: base.runtime.db,
    transactionUnit: base.transactionUnit,
    access,
    reviewAudit,
    now: () => new Date("2030-01-01T00:00:01.000Z"),
    reviewAuthorizationProvider,
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
    reviewAuthorizationProvider() {
      return reviewAuthorizationProviderFor({ register: registerReviewContext });
    },
    async close() {
      await base.close();
    },
  };
};
