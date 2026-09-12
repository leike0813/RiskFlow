import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
  type AssessmentConfigurationDocumentV1,
} from "@riskflow/core/assessment-config";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { AuthorizationContextV1, ContentArtifactRefV1 } from "@riskflow/contracts/ports";

import { ArtifactMaintenance } from "../../src/artifacts/maintenance.js";
import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import {
  PostgresAssessmentConfigurationAdapter,
  type AssessmentConfigurationGovernedReleaseResolverV1,
} from "../../src/assessment-config/index.js";
import { PostgresKnowledgeGovernanceAdapter } from "../../src/knowledge-governance/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import {
  startReviewAuditFixture,
  type ReviewAuditPostgresFixture,
} from "../review-audit/fixture.js";
import {
  GOVERNANCE_TEST_TIMESTAMP,
  governanceAuthorizationFor,
  reviewAuthorizationFor,
} from "../knowledge-governance/fixture.js";

export const ASSESSMENT_CONFIGURATION_TEST_TIMESTAMP = GOVERNANCE_TEST_TIMESTAMP;

export const contextFor = (
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
  decidedAt: ASSESSMENT_CONFIGURATION_TEST_TIMESTAMP,
  invocation,
});

export const readAuthorizationFor = (projectId: string, actorId = "reader-1") =>
  contextFor(projectId, actorId, ["knowledge-modeling.read"]);

export interface PutAssessmentConfigurationDocumentOptionsV1 {
  readonly projectId?: string;
  readonly actorId?: string;
  readonly mediaType?: string;
  readonly payload?: Uint8Array;
  readonly artifactId?: string;
}

export interface AssessmentConfigurationPostgresFixtureV1 {
  readonly postgres: ReviewAuditPostgresFixture["postgres"];
  readonly runtime: ReviewAuditPostgresFixture["runtime"];
  readonly transactionUnit: ReviewAuditPostgresFixture["transactionUnit"];
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly maintenance: ArtifactMaintenance;
  readonly reviewAudit: PostgresReviewAuditAdapter;
  readonly governance: PostgresKnowledgeGovernanceAdapter;
  readonly configuration: PostgresAssessmentConfigurationAdapter;
  setVerifiedContext(context: AuthorizationContextV1): void;
  /** Upload one configuration document and return its exact C04 reference. */
  putDocument(
    document: AssessmentConfigurationDocumentV1,
    options?: PutAssessmentConfigurationDocumentOptionsV1,
  ): Promise<ContentArtifactRefV1>;
  close(): Promise<void>;
}

export const startAssessmentConfigurationFixture =
  async (): Promise<AssessmentConfigurationPostgresFixtureV1> => {
    const base = await startReviewAuditFixture();
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c18-configuration-"));
    const policy = artifactPolicy();
    let counter = 0;
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
    const now = () => new Date("2030-01-01T00:00:01.000Z");
    const registry = new PostgresArtifactRegistry({
      db: base.runtime.db,
      transactionUnit: base.transactionUnit,
      pool: base.runtime.pool,
    });
    try {
      const store = await createFilesystemArtifactStore({
        rootDirectory,
        policy,
        registry,
        transactionUnit: base.transactionUnit,
        now,
      });
      const maintenance = new ArtifactMaintenance({ rootDirectory, policy, store, registry, now });
      const reviewAudit = new PostgresReviewAuditAdapter({
        db: base.runtime.db,
        transactionUnit: base.transactionUnit,
        access,
        now,
      });
      const governanceRef: { current?: PostgresKnowledgeGovernanceAdapter } = {};
      const governedReleases: AssessmentConfigurationGovernedReleaseResolverV1 = {
        resolveGovernedReleases: (input) => {
          const governance = governanceRef.current;
          if (governance === undefined) throw new Error("governance adapter is not assembled");
          return governance.resolveGovernedReleases(input);
        },
      };
      const configuration = new PostgresAssessmentConfigurationAdapter({
        db: base.runtime.db,
        transactionUnit: base.transactionUnit,
        artifactStore: store,
        governedReleases,
        now,
      });
      const reviewAuthorization = (command: { projectId: string; actorId: string }) =>
        reviewAuthorizationFor(command.projectId, command.actorId);
      const governance = new PostgresKnowledgeGovernanceAdapter({
        db: base.runtime.db,
        transactionUnit: base.transactionUnit,
        access,
        reviewAudit,
        now,
        reviewAuthorization,
        approvalAuthorization: reviewAuthorization,
        assessmentConfigurationPolicy: configuration,
      });
      governanceRef.current = governance;
      return {
        postgres: base.postgres,
        runtime: base.runtime,
        transactionUnit: base.transactionUnit,
        access,
        artifactStore: store,
        maintenance,
        reviewAudit,
        governance,
        configuration,
        setVerifiedContext(context) {
          verifiedContexts.set(contextKey(context.authorizationContextRef), context);
        },
        async putDocument(document, options) {
          counter += 1;
          const projectId = options?.projectId ?? "assessment-configuration-project";
          const actorId = options?.actorId ?? "manager-1";
          const bytes = options?.payload ?? new TextEncoder().encode(JSON.stringify(document));
          const result = await store.put(
            ArtifactPutCommandV1Schema.parse({
              schemaVersion: "1",
              commandId: `put-${counter}-${document.definitionType}`,
              idempotencyKey: `put-${counter}-${document.definitionType}`,
              projectId,
              actorId,
              issuedAt: ASSESSMENT_CONFIGURATION_TEST_TIMESTAMP,
              authorization: contextFor(projectId, actorId, ["knowledge-modeling.govern"]),
              requiredCapability: "knowledge-modeling.govern",
              artifactId: options?.artifactId ?? `assessment-configuration-${counter}`,
              artifactKind: "content",
              purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
              mediaType: options?.mediaType ?? ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
              parentArtifactRefs: [],
              evidenceReferences: [],
              additionalSpatialScopeRefs: [],
              additionalSourceAccessGrantRefs: [],
            }),
            (async function* () {
              yield bytes;
            })(),
          );
          return result.artifactRef;
        },
        async close() {
          await store.close();
          await rm(rootDirectory, { recursive: true, force: true });
          await base.close();
        },
      };
    } catch (error) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
      await base.close().catch(() => undefined);
      throw error;
    }
  };
