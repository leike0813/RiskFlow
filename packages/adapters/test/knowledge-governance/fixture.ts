import { vi } from "vitest";

import {
  PostgresKnowledgeGovernanceAdapter,
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
  type AuthorizationContextV1,
  type KnowledgeGovernanceCommandV1,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";

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

export const startKnowledgeGovernanceFixture =
  async (): Promise<KnowledgeGovernancePostgresFixture> => {
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
    const reviewAuthorization = (command: KnowledgeGovernanceCommandV1) =>
      reviewAuthorizationFor(command.projectId, command.actorId);
    const adapterOptions: PostgresKnowledgeGovernanceAdapterOptionsV1 = {
      db: base.runtime.db,
      transactionUnit: base.transactionUnit,
      access,
      reviewAudit,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
      reviewAuthorization,
      approvalAuthorization: reviewAuthorization,
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
