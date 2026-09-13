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
  type SourceVersionRefV1,
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
  readonly monitoringSnapshotRefs: readonly {
    readonly kind: "monitoring-snapshot";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[];
  readonly basisRef: { readonly kind: "assessment-basis-release-set"; readonly reference: unknown };
  setFacts(value: unknown | undefined): void;
  setPolicies(value: unknown | undefined): void;
  /** 篡改 basis 成员摘要，用于产物漂移用例；`restoreBasis` 复原。 */
  driftWeightSetDigest(): void;
  restoreBasis(): void;
  /** 首次读取后开始篡改 basis 成员摘要，用于提交前复验失效用例。 */
  driftBasisAfterFirstRead(): void;
  /** 预置审计主键冲突，用于事务成员失败整体回滚用例。 */
  preinsertAuditConflict(commandId: string): Promise<void>;
  /** 恢复风险输入事实（事实不可用用例之后）。 */
  resetFacts(): void;
  /** 同一序列的第二个冻结快照（不同截止点），用于替换/新增监测集合用例。 */
  extraMonitoringSnapshotRef(): Promise<{
    readonly kind: "monitoring-snapshot";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;
  /** 评分策略版本不同的第二套 basis（重评策略单独变化用例）。 */
  variantBasisRef(): Promise<{
    readonly kind: "assessment-basis-release-set";
    readonly reference: unknown;
  }>;
  /** 最近一次 basis 读取请求的业务时点与策略提供者的 requiredAt。 */
  lastReadTimes(): {
    readonly basisRequestedAt: string | undefined;
    readonly policyRequiredAt: string | undefined;
  };
  /** 之前冻结的准备快照引用（A 含 3 个监测快照，B 只含 1 个）。 */
  preparationRef(kind: "a" | "b"): AssessmentPreparationSnapshotRefV1;
  /** 首次验证后吊销管理器会话，用于提交前授权失效用例；`restoreSession` 复原。 */
  revokeAfterFirstRead(): Promise<void>;
  restoreSession(): Promise<void>;
  /** 追加一份准备快照变体（入口模式/监测引用/前次记录由调用方给定）。 */
  freezePreparation(input: {
    readonly suffix: string;
    readonly entryMode: "assess" | "reassess" | "historical-backfill";
    readonly triggerReasonCode: string;
    readonly monitoringSnapshotRefs?: readonly {
      readonly kind: "monitoring-snapshot";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
    readonly previousAssessmentRecordRef?: unknown;
    readonly effectiveAt?: string;
  }): Promise<AssessmentPreparationSnapshotRefV1>;
  prepareCommand(input: {
    readonly commandId: string;
    readonly kind?: "initial" | "reassessment" | "historical-backfill";
    readonly preparation?: AssessmentPreparationSnapshotRefV1;
    readonly basisRef?: {
      readonly kind: "assessment-basis-release-set";
      readonly reference: unknown;
    };
    readonly previousAssessmentRecordRef?: unknown;
    readonly reason?:
      | "monitoring-snapshot"
      | "applicability-metadata"
      | "applicable-rule-set"
      | "weight-or-strategy"
      | "risk-matrix";
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
    let sessionToken = managerChanged.sessionToken;
    let managerPassword = "c25-engine-manager-password-changed";

    const authorize = async (input: {
      readonly invocationId: string;
      readonly branch: string;
      readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
    }) =>
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId: input.invocationId,
          projectId: PROJECT_ID,
          branch: input.branch as "engineering-data.register-source-delivery",
          requestedSpatialScopeRefs: [...(input.spatialScopeRefs ?? [accessRootScopeRef])],
          requestedSourceVersionRefs: [...(input.sourceVersionRefs ?? [])],
        })
      ).context;
    const authorizeDownstream: AssessmentDownstreamAuthorizerV1 = async (
      request: AssessmentDownstreamAuthorizationRequestV1,
    ) =>
      authorize({
        invocationId: request.invocationId,
        branch: request.branch,
        ...(request.requestedSpatialScopeRefs === undefined
          ? {}
          : { spatialScopeRefs: request.requestedSpatialScopeRefs }),
        ...(request.requestedSourceVersionRefs === undefined
          ? {}
          : { sourceVersionRefs: request.requestedSourceVersionRefs }),
      });

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

    // ---------------------------------------------------------------- 真实来源资料
    const putRaw = async (input: {
      readonly artifactId: string;
      readonly purposeCode: string;
      readonly mediaType: string;
      readonly body: string;
      readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
      readonly evidenceReferences?: readonly {
        readonly locator: { readonly sourceSegmentId: string };
        readonly sourceVersion: { readonly entityId: string; readonly versionId: string };
      }[];
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
            sourceVersionRefs: [...(input.sourceVersionRefs ?? [])],
          }),
          requiredCapability: "engineering-data.write",
          artifactId: `c25-${input.artifactId}`,
          artifactKind: "content",
          purposeCode: input.purposeCode,
          mediaType: input.mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [...(input.evidenceReferences ?? [])],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        one(new TextEncoder().encode(input.body)),
      );
      return result.artifactRef;
    };

    const sourceArtifactRef = await putRaw({
      artifactId: "source-body",
      purposeCode: "engineering-data.register-source-delivery",
      mediaType: "text/plain",
      body: "C25 监测与风险来源正文",
    });
    const sourceMetadataArtifactRef = await putRaw({
      artifactId: "source-metadata",
      purposeCode: "engineering-data.register-source-delivery",
      mediaType: "application/json",
      body: JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef,
        spatialScopeRefs: [businessSpatialScopeRef],
        registeredByAccountId: managerId,
        sourceItemId: "c25-source-item",
        sourceItemName: "C25 监测方案",
        sourceCategory: "engineering-document",
        sourceMetadata: { documentType: "监测方案", formedAt: T0, sourceOrganization: "甲方" },
        descriptor: { kind: "file-upload", contentFingerprint: "C25 监测与风险来源正文" },
        applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
      }),
    });
    const delivery = await postgres.registry.apply({
      commandId: "c25-source-delivery",
      idempotencyKey: "c25-source-delivery",
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: "c25-source-delivery",
        branch: "engineering-data.register-source-delivery",
      }),
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c25-source-delivery",
        sourceArtifactRef,
        metadataArtifactRef: sourceMetadataArtifactRef,
        occurredAt: T0,
      },
    });
    if (delivery.kind !== "succeeded") {
      throw new Error(`C25 source delivery failed: ${JSON.stringify(delivery).slice(0, 400)}`);
    }
    const sourceVersionRef = delivery.result.sourceVersionRef;
    const sourceSegmentId = `${sourceVersionRef.reference.entityId}-chapter_1-segment_1`;
    const segmentsAuthorization = await authorize({
      invocationId: "c25-source-segments",
      branch: "engineering-data.register-source-delivery",
      sourceVersionRefs: [sourceVersionRef],
    });
    const segments = await postgres.registry.registerSegments({
      commandId: "c25-source-segments",
      idempotencyKey: "c25-source-segments",
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: segmentsAuthorization,
      sourceVersionRef,
      sourceId: sourceVersionRef.reference.entityId,
      segments: [
        {
          sourceSegmentId: sourceSegmentId as never,
          chapterId: "chapter_1",
          segmentId: "segment_1",
          kind: "chapter",
          spatialScopeRefs: [businessSpatialScopeRef],
          locator: { kind: "document", pageNumber: 1, headingPath: ["监测"] },
        },
      ],
    });
    if (segments.kind !== "succeeded") {
      throw new Error(`C25 source segments failed: ${JSON.stringify(segments).slice(0, 400)}`);
    }
    const evidenceReference = {
      locator: { sourceSegmentId },
      sourceVersion: sourceVersionRef.reference,
    };

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
    const basisSets = new Map<string, AssessmentBasisReleaseSetReadResultV1>();
    basisSets.set(basisKey, basisResult);
    const basisReader: AssessmentBasisReleaseSetReaderV1 = {
      readAssessmentBasisReleaseSet: async (input) => {
        lastBasisRequestedAt = input.requestedAt;
        const key = `${input.assessmentBasisReleaseSetRef.reference.entityId}@${input.assessmentBasisReleaseSetRef.reference.versionId}`;
        if (key !== basisKey) {
          const variant = basisSets.get(key);
          return variant ?? { kind: "unavailable", error: unauthorizedBasisError(input.requestId) };
        }
        basisReadCount += 1;
        if (driftAfterFirstBasisRead && basisReadCount > 1) {
          basisResult = basisReadResult(
            configurationMembers.map((member) =>
              member.definitionType === "weight-set"
                ? { ...member, contentDigest: "0".repeat(64) }
                : member,
            ),
          );
          basisSets.set(basisKey, basisResult);
          return basisResult;
        }
        return basisResult;
      },
    };

    // ---------------------------------------------------------------- 监测序列与快照
    const registerMonitoringSeries = async (input: {
      readonly seriesId: string;
      readonly monitoringObject: string;
      readonly monitoringIndicator: string;
      readonly parameterCode: string;
      readonly canonicalUnit: string;
      readonly values: readonly number[];
    }): Promise<{
      readonly kind: "monitoring-snapshot";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }> => {
      const seriesRef = {
        kind: "monitoring-series" as const,
        reference: { entityId: input.seriesId, versionId: "1" },
      };
      const series = await postgres.monitoringStore.reviseSeries({
        commandId: `c25-series-${input.seriesId}`,
        idempotencyKey: `c25-series-${input.seriesId}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: await authorize({
          invocationId: `c25-series-${input.seriesId}`,
          branch: "engineering-data.register-monitoring-batch",
          sourceVersionRefs: [sourceVersionRef],
        }),
        monitoringSeriesRef: seriesRef,
        expectedVersion: "none",
        projectRevisionRef,
        spatialScopeRef: businessSpatialScopeRef,
        monitoringObject: input.monitoringObject,
        monitoringIndicator: input.monitoringIndicator as never,
        parameterCode: input.parameterCode,
        canonicalUnit: input.canonicalUnit,
        unitConversions: [],
        effectivePeriod: { validFrom: T0 },
      });
      if (series.kind !== "succeeded") {
        throw new Error(`C25 series failed: ${JSON.stringify(series).slice(0, 400)}`);
      }
      const policy = await postgres.monitoringStore.registerAvailabilityPolicy({
        commandId: `c25-policy-${input.seriesId}`,
        idempotencyKey: `c25-policy-${input.seriesId}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: await authorize({
          invocationId: `c25-policy-${input.seriesId}`,
          branch: "engineering-data.register-monitoring-batch",
          sourceVersionRefs: [sourceVersionRef],
        }),
        policy: {
          availabilityPolicyRef: { entityId: `c25-policy-${input.seriesId}`, versionId: "1" },
          projectId: PROJECT_ID,
          monitoringSeriesRef: seriesRef,
          windowDurationMs: 10_000,
          intervalMs: 1_000,
          maxInterpolationGapMs: 2_000,
          slopeWindowSize: 5,
          accelerationWindowSize: 5,
          frequencyWindowSize: 5,
          anomalyBaselineSize: 2,
          anomalyScaleFloor: 0.1,
          frequencyPowerFloor: 0,
          minimumCoverageRatio: 0.5,
          maxFrequencySamples: 32,
          algorithmVersions: {
            alignment: "a1",
            slope: "s1",
            acceleration: "g1",
            frequency: "f1",
            anomaly: "n1",
          },
          recordedAt: T0,
          audit: { actorId: managerId, action: "policy", recordedAt: T0 },
        },
      });
      if (policy.kind !== "succeeded") {
        throw new Error(`C25 policy failed: ${JSON.stringify(policy).slice(0, 400)}`);
      }
      const lines = [
        JSON.stringify({
          schemaVersion: "1",
          mediaType: "application/x-ndjson",
          monitoringSeriesRef: seriesRef,
          projectRevisionRef,
          spatialScopeRef: businessSpatialScopeRef,
          sourceVersionRef,
          sourceSegmentSetRef: segments.result.segmentSet.sourceSegmentSetRef,
          productionStrategyRef: { entityId: "c25-monitoring-production", versionId: "1" },
          sampleCount: input.values.length,
        }),
        ...input.values.map((value, index) =>
          JSON.stringify({
            sourceSampleKey: `c25-${input.seriesId}-${index}`,
            sampledAt: `2030-01-01T00:00:${String(6 + index).padStart(2, "0")}.000Z`,
            value,
            unit: input.canonicalUnit,
            evidenceReferences: [evidenceReference],
          }),
        ),
      ].join("\n");
      const sampleArtifactRef = await putRaw({
        artifactId: `samples-${input.seriesId}`,
        purposeCode: "engineering-data.register-monitoring-batch",
        mediaType: "application/x-ndjson",
        body: lines,
        sourceVersionRefs: [sourceVersionRef],
        evidenceReferences: [evidenceReference],
      });
      const batch = await postgres.monitoringStore.registerBatch({
        commandId: `c25-batch-${input.seriesId}`,
        idempotencyKey: `c25-batch-${input.seriesId}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: await authorize({
          invocationId: `c25-batch-${input.seriesId}`,
          branch: "engineering-data.register-monitoring-batch",
          sourceVersionRefs: [sourceVersionRef],
        }),
        kind: "register-monitoring-batch",
        payload: {
          monitoringSeriesRef: seriesRef,
          deliveryKey: `c25-batch-${input.seriesId}`,
          sampleArtifactRef,
          window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
          relation: { kind: "original" },
        },
      });
      if (batch.kind !== "succeeded") {
        throw new Error(`C25 batch failed: ${JSON.stringify(batch).slice(0, 400)}`);
      }
      const frozen = await postgres.registry.freeze({
        commandId: `c25-snapshot-${input.seriesId}`,
        idempotencyKey: `c25-snapshot-${input.seriesId}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: await authorize({
          invocationId: `c25-snapshot-${input.seriesId}`,
          branch: "engineering-data.monitoring-snapshot",
          sourceVersionRefs: [sourceVersionRef],
        }),
        kind: "monitoring-snapshot",
        payload: {
          monitoringSeriesRef: seriesRef,
          cutoff: "2030-01-01T00:00:10.000Z",
          availabilityPolicyRef: { entityId: `c25-policy-${input.seriesId}`, versionId: "1" },
        },
      });
      if (frozen.kind !== "succeeded" || frozen.result.kind !== "monitoring-snapshot") {
        throw new Error(`C25 snapshot failed: ${JSON.stringify(frozen).slice(0, 400)}`);
      }
      return frozen.result.monitoringSnapshotRef;
    };

    const monitoringSnapshotRefs = [
      await registerMonitoringSeries({
        seriesId: "c25-series-settlement",
        monitoringObject: "地表沉降监测点",
        monitoringIndicator: "地表沉降",
        parameterCode: "ground-settlement",
        canonicalUnit: "mm",
        values: [5, 5.5, 6, 6.5, 7],
      }),
      await registerMonitoringSeries({
        seriesId: "c25-series-water-level",
        monitoringObject: "地下水位观测井",
        monitoringIndicator: "地下水位",
        parameterCode: "water-level",
        canonicalUnit: "m",
        values: [10, 10.4, 10.2, 10.8, 11],
      }),
      await registerMonitoringSeries({
        seriesId: "c25-series-cutter-frequency",
        monitoringObject: "盾构姿态监测",
        monitoringIndicator: "盾构姿态参数",
        parameterCode: "cutter-frequency",
        canonicalUnit: "Hz",
        values: [0.2, 0.25, 0.3, 0.35, 0.4],
      }),
    ];

    const factsFor = () => {
      const base = c25Facts({ projectId: PROJECT_ID });
      return {
        ...base,
        fields: base.fields.map((field) => ({ ...field, evidenceReferences: [evidenceReference] })),
        evidenceReferences: [evidenceReference],
      };
    };
    // 第二套 basis：仅评分策略成员不同（发布引用与正文都变化）。
    const variantBasisRefValue = {
      kind: "assessment-basis-release-set" as const,
      reference: c25Version("assessment-basis-c25-variant"),
    };
    const variantDocuments = (() => {
      const documents = c25ConfigurationDocuments();
      const base = documents["scoring-strategy"];
      return {
        ...documents,
        "scoring-strategy": {
          ...base,
          content: {
            ...base.content,
            possibility: {
              ...base.content.possibility,
              rounding: { mode: "half-away-from-zero", decimalScale: 3 },
            },
          },
        },
      };
    })();
    const registerVariantBasis = async () => {
      const members = [];
      for (const definitionType of Object.keys(
        variantDocuments,
      ) as (keyof typeof variantDocuments)[]) {
        const document: AssessmentConfigurationDocumentV1 =
          AssessmentConfigurationDocumentV1Schema.parse({
            ...variantDocuments[definitionType],
            projectRevisionRef,
            configurationSetRef: CONFIGURATION_SET_REF,
          });
        members.push({
          definitionType: document.definitionType,
          releaseRef:
            document.definitionType === "scoring-strategy"
              ? c25ReleaseRef("scoring-strategy-variant")
              : c25ReleaseRef(document.definitionType),
          revisionRef:
            document.definitionType === "scoring-strategy"
              ? c25RevisionRef("scoring-strategy-variant")
              : c25RevisionRef(document.definitionType),
          artifactRef: await putJson({
            artifactId: `variant-configuration-${document.definitionType}`,
            purposeCode: CONFIGURATION_PURPOSE,
            mediaType: CONFIGURATION_MEDIA_TYPE,
            value: document,
          }),
          contentDigest: c25Digest(document),
        });
      }
      members.sort((left, right) => (left.definitionType < right.definitionType ? -1 : 1));
      basisSets.set(
        `${variantBasisRefValue.reference.entityId}@${variantBasisRefValue.reference.versionId}`,
        AssessmentBasisReleaseSetReadResultV1Schema.parse({
          kind: "succeeded",
          schemaVersion: "1",
          assessmentBasisReleaseSetRef: variantBasisRefValue,
          memberDigest: sha256CanonicalJson(members),
          applicableRuleSetMember,
          scoringRuleMembers,
          configurationMembers: members,
        }),
      );
      return variantBasisRefValue;
    };

    let facts: unknown | undefined = factsFor();
    let policySet: unknown | undefined = c25RuntimePolicySet({ projectId: PROJECT_ID });
    let driftAfterFirstBasisRead = false;
    let basisReadCount = 0;
    let lastBasisRequestedAt: string | undefined;
    let lastPolicyRequiredAt: string | undefined;
    const riskInputFacts: RiskInputFactsReaderV1 = {
      readRiskInputFacts: async () =>
        facts === undefined
          ? { kind: "failed", error: precondition("c25-fixture-facts") }
          : { kind: "succeeded", facts: facts as never },
    };
    const runtimePolicies: AssessmentRuntimePolicySetProviderV1 = {
      readRuntimePolicySet: async (input) => {
        lastPolicyRequiredAt = input.requiredAt;
        return policySet === undefined
          ? { kind: "failed", error: precondition("c25-fixture-policies") }
          : { kind: "succeeded", policySet: policySet as never };
      },
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

    // 组合根为 C11 冻结的监测读取接缝注入资料版本（风险输入证据同源）。
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

    const freezePreparation = async (input: {
      readonly suffix: string;
      readonly entryMode: "assess" | "reassess" | "historical-backfill";
      readonly triggerReasonCode: string;
      readonly monitoringSnapshotRefs?: readonly {
        readonly kind: "monitoring-snapshot";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[];
      readonly previousAssessmentRecordRef?: unknown;
      readonly effectiveAt?: string;
      readonly withCausalRun?: boolean;
    }) => {
      const frozen = await registry.freeze({
        commandId: `c25-engine-preparation-${input.suffix}`,
        idempotencyKey: `c25-engine-preparation-${input.suffix}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: (
          await access.authorize({
            invocation: { kind: "human-session", sessionToken },
            invocationId: `c25-engine-preparation-${input.suffix}`,
            projectId: PROJECT_ID,
            branch: "engineering-data.assessment-preparation",
            requestedSpatialScopeRefs: [accessRootScopeRef],
            requestedSourceVersionRefs: [sourceVersionRef],
          })
        ).context,
        kind: "assessment-preparation",
        payload: {
          riskInput: c25Facts().riskInput,
          projectRevisionRef,
          spatialScopeRef: businessSpatialScopeRef,
          applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
          entryMode: input.entryMode,
          triggerReasonCode: input.triggerReasonCode,
          ...(input.monitoringSnapshotRefs === undefined
            ? {}
            : { monitoringSnapshotRefs: input.monitoringSnapshotRefs }),
          ...(input.previousAssessmentRecordRef === undefined
            ? {}
            : { previousAssessmentRecordRef: input.previousAssessmentRecordRef }),
          ...(input.withCausalRun === false
            ? {}
            : {
                causalRunRef: {
                  kind: "workflow-run",
                  reference: { entityId: "c25-engine-run", versionId: "1" },
                },
              }),
        },
      });
      if (frozen.kind !== "succeeded" || frozen.result.kind !== "assessment-preparation") {
        throw new Error(`C25 preparation freeze failed: ${JSON.stringify(frozen).slice(0, 600)}`);
      }
      return frozen.result.assessmentPreparationSnapshotRef;
    };
    const preparations = {
      a: await freezePreparation({
        suffix: "a",
        entryMode: "assess",
        triggerReasonCode: "manual-assessment",
        monitoringSnapshotRefs,
      }),
      b: await freezePreparation({
        suffix: "b",
        entryMode: "assess",
        triggerReasonCode: "monitoring-triggered",
        monitoringSnapshotRefs: monitoringSnapshotRefs.slice(0, 1),
      }),
    };

    return {
      postgres,
      engine,
      projectId: PROJECT_ID,
      managerId,
      projectRevisionRef,
      businessSpatialScopeRef,
      preparationSnapshotRef: preparations.a,
      monitoringSnapshotRefs,
      basisRef,
      setFacts(value) {
        facts = value;
      },
      setPolicies(value) {
        policySet = value;
      },
      resetFacts() {
        facts = factsFor();
      },
      driftWeightSetDigest() {
        basisResult = basisReadResult(
          configurationMembers.map((member) =>
            member.definitionType === "weight-set"
              ? { ...member, contentDigest: "0".repeat(64) }
              : member,
          ),
        );
        basisSets.set(basisKey, basisResult);
      },
      restoreBasis() {
        basisResult = basisReadResult(configurationMembers);
        basisSets.set(basisKey, basisResult);
        driftAfterFirstBasisRead = false;
        basisReadCount = 0;
      },
      driftBasisAfterFirstRead() {
        driftAfterFirstBasisRead = true;
        basisReadCount = 0;
      },
      async revokeAfterFirstRead() {
        managerPassword = "c25-engine-manager-password-revoked";
        await access.changePassword({
          kind: "change-password",
          sessionToken,
          newPassword: managerPassword,
        });
      },
      async restoreSession() {
        managerPassword = "c25-engine-manager-password-restored";
        const changed = await access.changePassword({
          kind: "change-password",
          sessionToken: (
            await access.login({
              kind: "login",
              loginAttemptId: `c25-engine-manager-restore-${Date.now()}`,
              loginName: "c25-engine-manager",
              password: managerPassword.replace("restored", "revoked"),
            })
          ).sessionToken,
          newPassword: managerPassword,
        });
        sessionToken = changed.sessionToken;
      },
      freezePreparation,
      async preinsertAuditConflict(commandId) {
        await postgres.postgres.adminPool.query(
          `INSERT INTO audit.entries (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref, version_ref, occurred_at, recorded_at, command_id, idempotency_key)
           VALUES ($1, $2, 'fixture.conflict', '{"kind":"project-revision","reference":{"entityId":"fixture","versionId":"1"}}', $3, '{"kind":"authorization-context","reference":{"entityId":"fixture","versionId":"1"}}', '{"entityId":"fixture","versionId":"1"}', NOW(), NOW(), $4, $4)
           ON CONFLICT (audit_entry_id) DO NOTHING`,
          [`audit-${commandId}:assessment-record`, PROJECT_ID, managerId, commandId],
        );
      },
      preparationRef(kind) {
        return preparations[kind];
      },
      async extraMonitoringSnapshotRef() {
        return registerMonitoringSeries({
          seriesId: "c25-series-settlement-alt",
          monitoringObject: "地表沉降备用监测点",
          monitoringIndicator: "地表沉降",
          parameterCode: "ground-settlement",
          canonicalUnit: "mm",
          values: [6, 6.5, 7, 7.5, 8],
        });
      },
      async variantBasisRef() {
        return registerVariantBasis();
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
          sourceVersionRefs: [sourceVersionRef],
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
            preparationSnapshotRef: input.preparation ?? preparations.a,
            assessmentBasisReleaseSetRef: input.basisRef ?? basisRef,
            ...(input.previousAssessmentRecordRef === undefined
              ? {}
              : { previousAssessmentRecordRef: input.previousAssessmentRecordRef }),
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            ...(input.effectiveAt === undefined ? {} : { effectiveAt: input.effectiveAt }),
          },
        };
      },
      async evaluateCommand(input) {
        const authorization = await authorize({
          invocationId: input.commandId,
          branch: "risk-assessment.evaluate",
          sourceVersionRefs: [sourceVersionRef],
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
      lastReadTimes: () => ({
        basisRequestedAt: lastBasisRequestedAt,
        policyRequiredAt: lastPolicyRequiredAt,
      }),
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
