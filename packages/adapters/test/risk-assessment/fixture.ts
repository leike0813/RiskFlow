/**
 * C25 PostgreSQL 组合夹具：真实 C03/C04/C06/C11/C14 + 测试专用风险事实、C19 reader 与
 * 运行时策略提供者。夹具只存在于测试，不进入生产导出，也不建立生产 seed。
 */
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import {
  ApplicableRuleSetDocumentV1Schema,
  AssessmentBasisReleaseSetReadResultV1Schema,
  StructuredScoringRuleDocumentV1Schema,
  type AssessmentBasisReleaseSetReadResultV1,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import {
  AssessmentConfigurationDocumentV1Schema,
  type AssessmentConfigurationDocumentV1,
} from "@riskflow/core/assessment-config";
import { canonicalJson, sha256CanonicalJson } from "@riskflow/core/persistence";
import type {
  AssessmentDownstreamAuthorizationRequestV1,
  AssessmentDownstreamAuthorizerV1,
  AssessmentRuntimePolicySetProviderV1,
  RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  ModuleErrorV1Schema,
  type ContentArtifactRefV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import type { AssessmentPreparationSnapshotRefV1 } from "@riskflow/contracts/ports";

import { bootstrapInitialSystemAdministrator } from "../../src/auth/index.js";
import { PostgresEngineeringContextSourceRegistry } from "../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";
import { createPostgresRiskAssessmentEngine } from "../../src/risk-assessment/engine/index.js";
import type { PostgresRiskAssessmentEngine } from "../../src/risk-assessment/engine/index.js";
import {
  startEngineeringContextSourceFixture,
  type EngineeringContextSourcePostgresFixture,
} from "../engineering-data/context-source/fixture.js";
import {
  C25_FIXTURE_APPLICABILITY,
  C25_FIXTURE_RULES,
  c25ApplicableRuleSet,
  c25ConfigurationDocuments,
  c25Digest,
  c25Facts,
  c25ReleaseRef,
  c25RevisionRef,
  c25RuleDocument,
  c25RuntimePolicySet,
  c25Version,
} from "../../../core/test/risk-assessment/fixture.js";

const PROJECT_ID = "project-c25-engine";
const T0 = "2030-01-01T00:00:00.000Z";
const CONFIGURATION_SET_REF = c25Version("configuration-set-c25");
const COMPATIBILITY_REF = c25Version("compatibility-c25");

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

const CONFIGURATION_PURPOSE = "assessment-configuration";
const CONFIGURATION_MEDIA_TYPE = "application/vnd.riskflow.assessment-configuration+json";
const APPLICABLE_RULE_SET_PURPOSE = "knowledge-modeling.applicable-rule-set";
const APPLICABLE_RULE_SET_MEDIA_TYPE = "application/vnd.riskflow.applicable-rule-set+json";
const SCORING_RULE_PURPOSE = "knowledge-modeling.structured-scoring-rule";
const SCORING_RULE_MEDIA_TYPE = "application/vnd.riskflow.structured-scoring-rule+json";

export interface RiskAssessmentEngineFixtureV1 {
  readonly postgres: EngineeringContextSourcePostgresFixture;
  readonly engine: PostgresRiskAssessmentEngine;
  readonly projectId: string;
  readonly managerId: string;
  readonly projectRevisionRef: { readonly kind: "project-revision"; readonly reference: unknown };
  readonly businessSpatialScopeRef: unknown;
  readonly preparationSnapshotRef: AssessmentPreparationSnapshotRefV1;
  readonly basisRef: { readonly kind: "assessment-basis-release-set"; readonly reference: unknown };
  setFacts(value: unknown | undefined): void;
  setPolicies(value: unknown | undefined): void;
  /** 篡改 basis 成员摘要，用于产物漂移用例；`restoreBasis` 复原。 */
  driftWeightSetDigest(): void;
  restoreBasis(): void;
  prepareCommand(input: {
    readonly commandId: string;
    readonly kind?: "initial" | "reassessment" | "historical-backfill";
    readonly preparation?: "a" | "b";
    readonly previousAssessmentRecordRef?: unknown;
    readonly effectiveAt?: string;
  }): Promise<Record<string, unknown>>;
  evaluateCommand(input: {
    readonly commandId: string;
    readonly inputSnapshotRef: unknown;
  }): Promise<Record<string, unknown>>;
  /** 不存在的工程身份，用于越权用例。 */
  foreignProjectId(): string;
}

const precondition = (causalRunId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    stageCode: "fixture.risk-assessment",
    occurredAt: T0,
    causalRunId,
    blockerKind: "risk-assessment-fixture",
    blockerRef: { kind: "project-revision", reference: { entityId: "fixture", versionId: "1" } },
  });

export const startRiskAssessmentEngineFixture =
  async (): Promise<RiskAssessmentEngineFixtureV1> => {
    const postgres = await startEngineeringContextSourceFixture({ now: () => new Date(T0) });
    const access = postgres.access;
    const admin = await bootstrapInitialSystemAdministrator({
      connection: postgres.postgres.migrator,
      loginName: "c25-engine-admin",
      displayName: "C25 Engine Administrator",
      password: "c25-engine-admin-password",
      accountId: "c25-engine-admin-account",
      now: () => new Date(T0),
    });
    if (admin.kind !== "account") throw new Error("C25 admin bootstrap failed");
    const adminLogin = await access.login({
      kind: "login",
      loginAttemptId: "c25-engine-admin-login",
      loginName: "c25-engine-admin",
      password: "c25-engine-admin-password",
    });
    const adminChanged = await access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: "c25-engine-admin-password-changed",
    });
    const manager = await access.administerIdentity({
      kind: "create-account",
      commandId: "c25-engine-manager",
      idempotencyKey: "c25-engine-manager",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      loginName: "c25-engine-manager",
      displayName: "C25 Engine Manager",
      password: "c25-engine-manager-password",
    });
    const managerLogin = await access.login({
      kind: "login",
      loginAttemptId: "c25-engine-manager-login",
      loginName: "c25-engine-manager",
      password: "c25-engine-manager-password",
    });
    const managerChanged = await access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: "c25-engine-manager-password-changed",
    });
    await access.administerProject({
      kind: "open-project",
      projectId: PROJECT_ID,
      commandId: "c25-engine-open-project",
      idempotencyKey: "c25-engine-open-project",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      initialRiskManagerAccountId: manager.resultRef.entityId,
    });
    const rootRow = await postgres.postgres.adminPool.query<{
      scope_id: string;
      revision_id: string;
    }>(
      "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [PROJECT_ID],
    );
    const accessRootScopeRef = {
      kind: "spatial-scope" as const,
      reference: { entityId: rootRow.rows[0]!.scope_id, versionId: rootRow.rows[0]!.revision_id },
    };
    const managerId = manager.resultRef.entityId;
    const sessionToken = managerChanged.sessionToken;

    const authorize = async (input: { readonly invocationId: string; readonly branch: string }) =>
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId: input.invocationId,
          projectId: PROJECT_ID,
          branch: input.branch as "engineering-data.register-source-delivery",
          requestedSpatialScopeRefs: [accessRootScopeRef],
          requestedSourceVersionRefs: [],
        })
      ).context;
    const authorizeDownstream: AssessmentDownstreamAuthorizerV1 = async (
      request: AssessmentDownstreamAuthorizationRequestV1,
    ) => authorize({ invocationId: request.invocationId, branch: request.branch });

    const projectResult = await postgres.registry.reviseContext({
      commandId: "c25-engine-project",
      idempotencyKey: "c25-engine-project",
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: "c25-engine-project",
        branch: "engineering-data.register-source-delivery",
      }),
      kind: "project",
      expectedVersion: "none",
      name: "C25 评估工程",
      lifecycle: "active",
      applicabilityMetadata: C25_FIXTURE_APPLICABILITY,
      effectivePeriod: { validFrom: T0 },
    });
    if (projectResult.kind !== "succeeded" || projectResult.result.kind !== "project-revision") {
      throw new Error(
        `C25 project revision failed: ${JSON.stringify(projectResult).slice(0, 500)}`,
      );
    }
    const projectRevisionRef = projectResult.result.revision.projectRevisionRef;
    const spatialResult = await postgres.registry.reviseContext({
      commandId: "c25-engine-spatial",
      idempotencyKey: "c25-engine-spatial",
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: "c25-engine-spatial",
        branch: "engineering-data.register-source-delivery",
      }),
      kind: "spatial",
      spatialScopeRef: accessRootScopeRef,
      projectRevisionRef,
      expectedVersion: "none",
      name: "C25 区间",
      worksiteLocation: "C25 工地",
      applicabilityOverrides: {},
      status: "active",
      effectivePeriod: { validFrom: T0 },
    });
    if (spatialResult.kind !== "succeeded" || spatialResult.result.kind !== "spatial-revision") {
      throw new Error("C25 spatial revision failed");
    }
    const businessSpatialScopeRef = spatialResult.result.revision.spatialScopeRef;
    const applicability = await postgres.registry.createApplicabilitySnapshot({
      commandId: "c25-engine-applicability",
      idempotencyKey: "c25-engine-applicability",
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: "c25-engine-applicability",
        branch: "engineering-data.register-source-delivery",
      }),
      projectRevisionRef,
      spatialScopeRef: businessSpatialScopeRef,
      formedAt: T0,
    });
    if (
      applicability.kind !== "succeeded" ||
      applicability.result.kind !== "applicability-snapshot"
    ) {
      throw new Error("C25 applicability snapshot failed");
    }
    const applicabilitySnapshotRef = applicability.result.snapshot.snapshotRef;

    const putJson = async (input: {
      readonly artifactId: string;
      readonly purposeCode: string;
      readonly mediaType: string;
      readonly value: unknown;
    }): Promise<ContentArtifactRefV1> => {
      const result = await postgres.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c25-put-${input.artifactId}`,
          idempotencyKey: `c25-put-${input.artifactId}`,
          projectId: PROJECT_ID,
          actorId: managerId,
          issuedAt: T0,
          authorization: await authorize({
            invocationId: `c25-put-${input.artifactId}`,
            branch: "engineering-data.register-source-delivery",
          }),
          requiredCapability: "engineering-data.write",
          artifactId: `c25-${input.artifactId}`,
          artifactKind: "content",
          purposeCode: input.purposeCode,
          mediaType: input.mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        one(new TextEncoder().encode(canonicalJson(input.value))),
      );
      return result.artifactRef;
    };

    // 11 类配置正文：公共 strict Schema 重新解析到本工程修订与配置集合身份。
    const configurationDocuments = c25ConfigurationDocuments();
    const configurationMembers: {
      definitionType: string;
      releaseRef: unknown;
      revisionRef: unknown;
      artifactRef: ContentArtifactRefV1;
      contentDigest: string;
    }[] = [];
    for (const definitionType of Object.keys(
      configurationDocuments,
    ) as (keyof typeof configurationDocuments)[]) {
      const document: AssessmentConfigurationDocumentV1 =
        AssessmentConfigurationDocumentV1Schema.parse({
          ...configurationDocuments[definitionType],
          projectRevisionRef,
          configurationSetRef: CONFIGURATION_SET_REF,
        });
      configurationMembers.push({
        definitionType: document.definitionType,
        releaseRef: c25ReleaseRef(document.definitionType),
        revisionRef: c25RevisionRef(document.definitionType),
        artifactRef: await putJson({
          artifactId: `configuration-${document.definitionType}`,
          purposeCode: CONFIGURATION_PURPOSE,
          mediaType: CONFIGURATION_MEDIA_TYPE,
          value: document,
        }),
        contentDigest: c25Digest(document),
      });
    }
    configurationMembers.sort((left, right) =>
      left.definitionType < right.definitionType ? -1 : 1,
    );

    const scoringRuleMembers: {
      releaseRef: unknown;
      revisionRef: unknown;
      artifactRef: ContentArtifactRefV1;
      contentDigest: string;
    }[] = [];
    const includedMembers: {
      ruleId: string;
      ruleVersion: unknown;
      releaseRef: unknown;
      revisionRef: unknown;
      artifactRef: ContentArtifactRefV1;
      contentDigest: string;
    }[] = [];
    for (const rule of C25_FIXTURE_RULES) {
      const document = StructuredScoringRuleDocumentV1Schema.parse({
        ...c25RuleDocument(rule),
        projectRevisionRef,
        configurationSetRef: CONFIGURATION_SET_REF,
        compatibilityRef: COMPATIBILITY_REF,
      });
      const artifactRef = await putJson({
        artifactId: `rule-${rule.ruleId}`,
        purposeCode: SCORING_RULE_PURPOSE,
        mediaType: SCORING_RULE_MEDIA_TYPE,
        value: document,
      });
      scoringRuleMembers.push({
        releaseRef: c25ReleaseRef(rule.ruleId),
        revisionRef: c25RevisionRef(rule.ruleId),
        artifactRef,
        contentDigest: c25Digest(document),
      });
      includedMembers.push({
        ruleId: rule.ruleId,
        ruleVersion: c25Version(rule.ruleId),
        releaseRef: c25ReleaseRef(rule.ruleId),
        revisionRef: c25RevisionRef(rule.ruleId),
        artifactRef,
        contentDigest: c25Digest(document),
      });
    }
    scoringRuleMembers.sort((left, right) =>
      String((left.releaseRef as { reference: { entityId: string } }).reference.entityId) <
      String((right.releaseRef as { reference: { entityId: string } }).reference.entityId)
        ? -1
        : 1,
    );
    includedMembers.sort((left, right) => (left.ruleId < right.ruleId ? -1 : 1));

    const applicableRuleSetDocument = ApplicableRuleSetDocumentV1Schema.parse({
      ...c25ApplicableRuleSet(C25_FIXTURE_RULES),
      projectRevisionRef,
      applicabilitySnapshotRef,
      applicability: C25_FIXTURE_APPLICABILITY,
      configurationSetRef: CONFIGURATION_SET_REF,
      compatibilityRef: COMPATIBILITY_REF,
      includedMembers,
    });
    const applicableRuleSetMember = {
      releaseRef: c25ReleaseRef("set-applicable-rule-set"),
      revisionRef: c25RevisionRef("set-applicable-rule-set"),
      artifactRef: await putJson({
        artifactId: "applicable-rule-set",
        purposeCode: APPLICABLE_RULE_SET_PURPOSE,
        mediaType: APPLICABLE_RULE_SET_MEDIA_TYPE,
        value: applicableRuleSetDocument,
      }),
      contentDigest: c25Digest(applicableRuleSetDocument),
    };

    const basisRef = {
      kind: "assessment-basis-release-set" as const,
      reference: c25Version("assessment-basis-c25"),
    };
    const basisKey = `${basisRef.reference.entityId}@${basisRef.reference.versionId}`;
    const basisReadResult = (
      members: typeof configurationMembers,
    ): AssessmentBasisReleaseSetReadResultV1 =>
      AssessmentBasisReleaseSetReadResultV1Schema.parse({
        kind: "succeeded",
        schemaVersion: "1",
        assessmentBasisReleaseSetRef: basisRef,
        memberDigest: sha256CanonicalJson(members),
        applicableRuleSetMember,
        scoringRuleMembers,
        configurationMembers: members,
      });
    let basisResult = basisReadResult(configurationMembers);
    const basisReader: AssessmentBasisReleaseSetReaderV1 = {
      readAssessmentBasisReleaseSet: async (input) => {
        const key = `${input.assessmentBasisReleaseSetRef.reference.entityId}@${input.assessmentBasisReleaseSetRef.reference.versionId}`;
        return key === basisKey
          ? basisResult
          : { kind: "unavailable", error: unauthorizedBasisError(input.requestId) };
      },
    };

    let facts: unknown | undefined = c25Facts({ projectId: PROJECT_ID });
    let policySet: unknown | undefined = c25RuntimePolicySet({ projectId: PROJECT_ID });
    const riskInputFacts: RiskInputFactsReaderV1 = {
      readRiskInputFacts: async () =>
        facts === undefined
          ? { kind: "failed", error: precondition("c25-fixture-facts") }
          : { kind: "succeeded", facts: facts as never },
    };
    const runtimePolicies: AssessmentRuntimePolicySetProviderV1 = {
      readRuntimePolicySet: async () =>
        policySet === undefined
          ? { kind: "failed", error: precondition("c25-fixture-policies") }
          : { kind: "succeeded", policySet: policySet as never },
    };

    // C11 组合：同一 store 之上补齐 C25 事实 reader 与下游授权签发接缝。
    const registry = new PostgresEngineeringContextSourceRegistry({
      db: postgres.runtime.db,
      transactionUnit: postgres.transactionUnit,
      access,
      artifactStore: postgres.artifactStore,
      artifactReferenceGuard: postgres.artifactRegistry,
      monitoringStore: postgres.monitoringStore,
      riskInputFacts,
      authorizeDownstream,
      now: () => new Date(T0),
    });

    const engine = createPostgresRiskAssessmentEngine({
      db: postgres.runtime.db,
      transactionUnit: postgres.transactionUnit,
      access,
      artifactStore: postgres.artifactStore,
      preparationContext: registry,
      riskInputFacts,
      basisReader,
      runtimePolicies,
      monitoring: postgres.monitoringStore,
      authorizeDownstream,
      now: () => new Date(T0),
    });

    const freezePreparation = async (suffix: string, triggerReasonCode: string) => {
      const frozen = await registry.freeze({
        commandId: `c25-engine-preparation-${suffix}`,
        idempotencyKey: `c25-engine-preparation-${suffix}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: (
          await access.authorize({
            invocation: { kind: "human-session", sessionToken },
            invocationId: `c25-engine-preparation-${suffix}`,
            projectId: PROJECT_ID,
            branch: "engineering-data.assessment-preparation",
            requestedSpatialScopeRefs: [accessRootScopeRef],
            requestedSourceVersionRefs: [],
          })
        ).context,
        kind: "assessment-preparation",
        payload: {
          riskInput: c25Facts().riskInput,
          projectRevisionRef,
          spatialScopeRef: businessSpatialScopeRef,
          applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
          entryMode: "assess",
          triggerReasonCode,
          causalRunRef: {
            kind: "workflow-run",
            reference: { entityId: "c25-engine-run", versionId: "1" },
          },
        },
      });
      if (frozen.kind !== "succeeded" || frozen.result.kind !== "assessment-preparation") {
        throw new Error(`C25 preparation freeze failed: ${JSON.stringify(frozen).slice(0, 600)}`);
      }
      return frozen.result.assessmentPreparationSnapshotRef;
    };
    const preparations = {
      a: await freezePreparation("a", "manual-assessment"),
      b: await freezePreparation("b", "monitoring-triggered"),
    };

    return {
      postgres,
      engine,
      projectId: PROJECT_ID,
      managerId,
      projectRevisionRef,
      businessSpatialScopeRef,
      preparationSnapshotRef: preparations.a,
      basisRef,
      setFacts(value) {
        facts = value;
      },
      setPolicies(value) {
        policySet = value;
      },
      driftWeightSetDigest() {
        basisResult = basisReadResult(
          configurationMembers.map((member) =>
            member.definitionType === "weight-set"
              ? { ...member, contentDigest: "0".repeat(64) }
              : member,
          ),
        );
      },
      restoreBasis() {
        basisResult = basisReadResult(configurationMembers);
      },
      async prepareCommand(input) {
        const authorization = await authorize({
          invocationId: input.commandId,
          branch:
            input.kind === "reassessment"
              ? "risk-assessment.reassessment"
              : input.kind === "historical-backfill"
                ? "risk-assessment.historical-backfill"
                : "risk-assessment.initial",
        });
        return {
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId: PROJECT_ID,
          actorId: managerId,
          issuedAt: T0,
          authorization,
          kind: input.kind ?? "initial",
          payload: {
            preparationSnapshotRef: preparations[input.preparation ?? "a"],
            assessmentBasisReleaseSetRef: basisRef,
            ...(input.previousAssessmentRecordRef === undefined
              ? {}
              : { previousAssessmentRecordRef: input.previousAssessmentRecordRef }),
            ...(input.effectiveAt === undefined ? {} : { effectiveAt: input.effectiveAt }),
          },
        };
      },
      async evaluateCommand(input) {
        const authorization = await authorize({
          invocationId: input.commandId,
          branch: "risk-assessment.evaluate",
        });
        return {
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId: PROJECT_ID,
          actorId: managerId,
          issuedAt: T0,
          authorization,
          kind: "evaluate",
          payload: { assessmentInputSnapshotRef: input.inputSnapshotRef },
        };
      },
      foreignProjectId: () => "project-c25-engine-foreign",
    };
  };

const unauthorizedBasisError = (causalRunId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    stageCode: "fixture.basis",
    occurredAt: T0,
    causalRunId,
    requiredCapability: "knowledge-modeling.read",
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  });
