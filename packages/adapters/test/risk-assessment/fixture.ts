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
  summarizeAssessmentConfigurationDocument,
  isAssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationDocumentV1,
} from "@riskflow/core/assessment-config";
import {
  canonicalJson,
  sha256CanonicalJson,
  type AtomicCommitV1,
} from "@riskflow/core/persistence";
import type {
  AssessmentDownstreamAuthorizationRequestV1,
  AssessmentDownstreamAuthorizerV1,
  RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  ModuleErrorV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ContentArtifactRefV1,
  type ModuleErrorV1,
  type ProjectRevisionRefV1,
  type RiskIdentificationReadPortV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { AssessmentPreparationSnapshotRefV1 } from "@riskflow/contracts/ports";
import {
  WorkflowGraphRunStateV1Schema,
  workflowGraphInvocationIdV1,
  type WorkflowGraphResultRowV1,
} from "@riskflow/core/workflow";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import { type StandardizedRiskRecordWriteV1 } from "@riskflow/core/identification/candidate-finalization";
import type { CompositeConfidence, StandardizedRiskRecord } from "@riskflow/contracts/records";

import { bootstrapInitialSystemAdministrator } from "../../src/auth/index.js";
import { createPostgresRiskCandidateFinalizationAdapter } from "../../src/identification/candidate-finalization/index.js";
import {
  createAssessmentEntryContextReadPort,
  PostgresEngineeringContextSourceRegistry,
} from "../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";
import { createPostgresRiskAssessmentEngine } from "../../src/risk-assessment/engine/index.js";
import type { PostgresRiskAssessmentEngine } from "../../src/risk-assessment/engine/index.js";
import { createPostgresWorkflowAdapter } from "../../src/workflow/index.js";
import {
  startEngineeringContextSourceFixture,
  type EngineeringContextSourcePostgresFixture,
} from "../engineering-data/context-source/fixture.js";
import {
  C25_FIXTURE_APPLICABILITY,
  C25_FIXTURE_RISK_RECORD_REF,
  C25_FIXTURE_RULES,
  c25ApplicableRuleSet,
  c25ConfigurationDocuments,
  c25Digest,
  c25Facts,
  c25ReleaseRef,
  c25RevisionRef,
  c25RuleDocument,
  c25Version,
} from "../../../core/test/risk-assessment/fixture.js";
import type { AssessmentConfigurationDocumentsV1 } from "../../../core/test/assessment-config/fixture.js";

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
  setScoringConfigurationReady(ready: boolean): void;
  readAuthorization(requestId: string): Promise<AuthorizationContextV1>;
  /** C34 风险评估只读分支授权：`risk-assessment.read` 与入口候选 seam 用例使用。 */
  entryReadAuthorization(
    requestId: string,
    options?: {
      readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
    },
  ): Promise<AuthorizationContextV1>;
  readonly projectId: string;
  readonly managerId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  /** C06 授权侧入口空间引用：候选读取按 entityId 匹配此当前授权范围。 */
  readonly accessRootScopeRef: SpatialScopeRefV1;
  /** 已登记来源精确引用：入口候选读的当前已验证来源范围。 */
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly businessSpatialScopeRef: SpatialScopeRefV1;
  readonly preparationSnapshotRef: AssessmentPreparationSnapshotRefV1;
  readonly monitoringSnapshotRefs: readonly {
    readonly kind: "monitoring-snapshot";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[];
  readonly basisRef: { readonly kind: "assessment-basis-release-set"; readonly reference: unknown };
  setFacts(value: unknown | undefined): void;
  /** 篡改 basis 成员摘要，用于产物漂移用例；`restoreBasis` 复原。 */
  driftWeightSetDigest(): void;
  restoreBasis(): void;
  /** 首次读取后开始篡改 basis 成员摘要，用于提交前复验失效用例。 */
  driftBasisAfterFirstRead(): void;
  /** 预置审计主键冲突，用于事务成员失败整体回滚用例。 */
  preinsertAuditConflict(commandId: string): Promise<void>;
  /** 恢复风险输入事实（事实不可用用例之后）。 */
  resetFacts(): void;
  /** 正式登记外部风险事件（C11 外部分支），返回可用于风险输入的精确引用。 */
  registerExternalRiskEvent(suffix: string): Promise<{
    readonly kind: "external-risk-event";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;
  /**
   * 以指定正文正式登记外部风险事件（C11 外部分支）。IP-04 用它同时覆盖「结构化正文可评估」
   * 与「登记成功不等于可评估」两种稳定行为，正文形状完全由调用方给出。
   */
  registerExternalRiskEventWithBody(input: {
    readonly suffix: string;
    readonly body: unknown;
    readonly evidenceSegmentIds?: readonly string[];
  }): Promise<{
    readonly kind: "external-risk-event";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;
  /**
   * 用真实 C22 适配器在 C03 事务单元内登记一个已验收的标准化风险记录，返回可用于风险输入的
   * 精确引用。IP-04 用它证明识别登记是接缝的另一端真实写入，而不是手工造行。
   */
  registerAcceptedStandardizedRiskRecord(input: {
    readonly suffix: string;
    readonly record?: StandardizedRiskRecord;
    readonly compositeConfidence?: CompositeConfidence;
  }): Promise<{
    readonly kind: "standardized-risk-record";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;
  /**
   * 签发 `engineering-data.evidence-access` 分支的当前授权上下文，供两个 owning reader 的
   * C06 两阶段复验使用；scope/source 由调用方按待复验目标给出。
   */
  authorizeEvidenceAccess(
    requestId: string,
    options?: {
      readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
    },
  ): Promise<AuthorizationContextV1>;
  /**
   * 把 C11 与 C25 共同消费的事实接缝整体切换为给定 reader。IP-04 起生产接缝用例用真实
   * owning reader 组合；故障 stub 仍可通过 `restoreStubFactsReader` 复原。
   */
  useFactsReader(reader: RiskInputFactsReaderV1): void;
  restoreStubFactsReader(): void;
  /** 追加一份适用性快照（同一工程修订/业务空间、不同命令），用于入口目录分页。 */
  registerApplicabilitySnapshot(suffix: string): Promise<{
    readonly kind: "applicability-metadata-snapshot";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;
  /** 同一监测序列的后续修订：单位或样本数不同的快照，用于单位/缺值用例。 */
  seriesVariant(input: {
    readonly seriesId: string;
    readonly seriesVersion: string;
    readonly canonicalUnit: string;
    readonly values: readonly number[];
  }): Promise<{
    readonly kind: "monitoring-snapshot";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }>;
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
  };
  /** 之前冻结的准备快照引用（A 含 3 个监测快照，B 只含 1 个）。 */
  preparationRef(kind: "a" | "b"): AssessmentPreparationSnapshotRefV1;
  /**
   * 用真实 C30 适配器登记一个产出指定评估记录的运行（入口行 + run-state 工件 + 正式链边）。
   * 记录解释与重评历史只解释这些已登记事实，缺失时 C25 必须失败闭合。
   */
  registerAssessmentRun(input: {
    readonly suffix: string;
    readonly runId: string;
    readonly recordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly entryMode: "assess" | "reassess";
    readonly reassessmentEntry?: {
      readonly previousAssessmentRecordRef: {
        readonly kind: "risk-assessment-record";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
      readonly reason: "monitoring-snapshot" | "applicability-metadata";
      readonly changedInputRefs: readonly ContractReferenceV1[];
    };
  }): Promise<{
    readonly runRef: {
      readonly kind: "workflow-run";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
  }>;
  /** 首次验证后吊销管理器会话，用于提交前授权失效用例；`restoreSession` 复原。 */
  revokeAfterFirstRead(): Promise<void>;
  /** 在风险事实读取返回后吊销管理器会话：读取已完成、提交尚未开始。 */
  revokeOnFactsRead(): Promise<void>;
  restoreSession(): Promise<void>;
  /** 签发接缝不再转交调用方声明的来源版本：来源复验必须因此关闭失败。 */
  denyDeclaredSources(): void;
  restoreDeclaredSources(): void;
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
    /** 缺省使用既有合成风险输入；IP-04 用已登记的真实记录引用冻结正式准备。 */
    readonly riskInput?: unknown;
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
    readonly idempotencyKey?: string;
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

export const startRiskAssessmentEngineFixture = async (
  options: {
    /** 覆盖 11 类配置正文；缺省保持既有合成内容，既有调用方行为不变。 */
    readonly configurationDocuments?: AssessmentConfigurationDocumentsV1;
  } = {},
): Promise<RiskAssessmentEngineFixtureV1> => {
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
      ...(denySources || request.requestedSourceVersionRefs === undefined
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
    throw new Error(`C25 project revision failed: ${JSON.stringify(projectResult).slice(0, 500)}`);
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
  // 调用方可注入自有内容（C27 需要覆盖触发指标可解析的映射）；缺省为既有合成内容。
  const configurationDocuments = options.configurationDocuments ?? c25ConfigurationDocuments();
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
    if (["measure-library", "forecast-policy", "deviation-policy"].includes(definitionType))
      continue;
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
  configurationMembers.sort((left, right) => (left.definitionType < right.definitionType ? -1 : 1));

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
  const monitoringSeriesDefinitions = [
    {
      seriesId: "c25-series-settlement",
      monitoringObject: "地表沉降监测点",
      monitoringIndicator: "地表沉降",
      parameterCode: "ground-settlement",
      canonicalUnit: "mm",
      values: [5, 5.5, 6, 6.5, 7],
    },
    {
      seriesId: "c25-series-water-level",
      monitoringObject: "地下水位观测井",
      monitoringIndicator: "地下水位",
      parameterCode: "water-level",
      canonicalUnit: "m",
      values: [10, 10.4, 10.2, 10.8, 11],
    },
    {
      seriesId: "c25-series-cutter-frequency",
      monitoringObject: "盾构姿态监测",
      monitoringIndicator: "盾构姿态参数",
      parameterCode: "cutter-frequency",
      canonicalUnit: "Hz",
      values: [0.2, 0.25, 0.3, 0.35, 0.4],
    },
  ] as const;

  const registerMonitoringSeries = async (input: {
    readonly seriesId: string;
    readonly monitoringObject: string;
    readonly monitoringIndicator: string;
    readonly parameterCode: string;
    readonly canonicalUnit: string;
    readonly values: readonly number[];
    /** 序列修订号：同一序列修订出单位/样本数不同的新版本用于单位与缺值用例。 */
    readonly seriesVersion?: string;
  }): Promise<{
    readonly kind: "monitoring-snapshot";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }> => {
    const seriesVersion = input.seriesVersion ?? "1";
    const commandSuffix = `${input.seriesId}@${seriesVersion}`;
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: input.seriesId, versionId: seriesVersion },
    };
    const series = await postgres.monitoringStore.reviseSeries({
      commandId: `c25-series-${commandSuffix}`,
      idempotencyKey: `c25-series-${commandSuffix}`,
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: `c25-series-${commandSuffix}`,
        branch: "engineering-data.register-monitoring-batch",
        sourceVersionRefs: [sourceVersionRef],
      }),
      monitoringSeriesRef: seriesRef,
      expectedVersion:
        seriesVersion === "1"
          ? "none"
          : {
              entityId: input.seriesId,
              versionId: String(Number(seriesVersion) - 1),
            },
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
      commandId: `c25-policy-${commandSuffix}`,
      idempotencyKey: `c25-policy-${commandSuffix}`,
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: `c25-policy-${commandSuffix}`,
        branch: "engineering-data.register-monitoring-batch",
        sourceVersionRefs: [sourceVersionRef],
      }),
      policy: {
        availabilityPolicyRef: { entityId: `c25-policy-${commandSuffix}`, versionId: "1" },
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
          sourceSampleKey: `c25-${commandSuffix}-${index}`,
          sampledAt: `2030-01-01T00:00:${String(6 + index).padStart(2, "0")}.000Z`,
          value,
          unit: input.canonicalUnit,
          evidenceReferences: [evidenceReference],
        }),
      ),
    ].join("\n");
    const sampleArtifactRef = await putRaw({
      artifactId: `samples-${commandSuffix}`,
      purposeCode: "engineering-data.register-monitoring-batch",
      mediaType: "application/x-ndjson",
      body: lines,
      sourceVersionRefs: [sourceVersionRef],
      evidenceReferences: [evidenceReference],
    });
    const batch = await postgres.monitoringStore.registerBatch({
      commandId: `c25-batch-${commandSuffix}`,
      idempotencyKey: `c25-batch-${commandSuffix}`,
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: `c25-batch-${commandSuffix}`,
        branch: "engineering-data.register-monitoring-batch",
        sourceVersionRefs: [sourceVersionRef],
      }),
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: seriesRef,
        deliveryKey: `c25-batch-${commandSuffix}`,
        sampleArtifactRef,
        window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
        relation: { kind: "original" },
      },
    });
    if (batch.kind !== "succeeded") {
      throw new Error(`C25 batch failed: ${JSON.stringify(batch).slice(0, 400)}`);
    }
    const frozen = await postgres.registry.freeze({
      commandId: `c25-snapshot-${commandSuffix}`,
      idempotencyKey: `c25-snapshot-${commandSuffix}`,
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: `c25-snapshot-${commandSuffix}`,
        branch: "engineering-data.monitoring-snapshot",
        sourceVersionRefs: [sourceVersionRef],
      }),
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: seriesRef,
        cutoff: "2030-01-01T00:00:10.000Z",
        availabilityPolicyRef: { entityId: `c25-policy-${commandSuffix}`, versionId: "1" },
      },
    });
    if (frozen.kind !== "succeeded" || frozen.result.kind !== "monitoring-snapshot") {
      throw new Error(`C25 snapshot failed: ${JSON.stringify(frozen).slice(0, 400)}`);
    }
    return frozen.result.monitoringSnapshotRef;
  };

  const monitoringSnapshotRefs = [
    await registerMonitoringSeries(monitoringSeriesDefinitions[0]!),
    await registerMonitoringSeries(monitoringSeriesDefinitions[1]!),
    await registerMonitoringSeries(monitoringSeriesDefinitions[2]!),
  ];

  const registerExternalRiskEventWithBody = async (input: {
    readonly suffix: string;
    readonly body: unknown;
    readonly evidenceSegmentIds?: readonly string[];
  }): Promise<{
    readonly kind: "external-risk-event";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }> => {
    const segmentIds = input.evidenceSegmentIds ?? [sourceSegmentId];
    const eventEvidence = segmentIds.map((segment) => ({
      locator: { sourceSegmentId: segment },
      sourceVersion: sourceVersionRef.reference,
    }));
    const eventArtifactRef = await putRaw({
      artifactId: `external-event-${input.suffix}`,
      purposeCode: "engineering-data.register-external-risk-event",
      mediaType: "application/json",
      body: JSON.stringify(input.body),
      sourceVersionRefs: [sourceVersionRef],
      evidenceReferences: eventEvidence,
    });
    const external = await postgres.registry.apply({
      commandId: `c25-external-${input.suffix}`,
      idempotencyKey: `c25-external-${input.suffix}`,
      projectId: PROJECT_ID,
      actorId: managerId,
      issuedAt: T0,
      authorization: await authorize({
        invocationId: `c25-external-${input.suffix}`,
        branch: "engineering-data.register-external-risk-event",
        sourceVersionRefs: [sourceVersionRef],
      }),
      kind: "register-external-risk-event",
      payload: {
        externalSourceRef: { entityId: "external-risk-platform", versionId: "1" },
        externalEventKey: `external-event-${input.suffix}`,
        eventArtifactRef,
        evidenceReferences: eventEvidence,
        occurredAt: T0,
      },
    } as never);
    if (external.kind !== "succeeded") {
      throw new Error(`C25 external event failed: ${JSON.stringify(external).slice(0, 400)}`);
    }
    const ref = external.result.externalRiskEventRef;
    registeredExternalRiskEvents.add(`${ref.reference.entityId}@${ref.reference.versionId}`);
    return ref;
  };

  const factsFor = (riskInput?: unknown) => {
    const base = c25Facts({
      projectId: PROJECT_ID,
      ...(riskInput === undefined ? {} : { riskInput: riskInput as never }),
    });
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

  const registeredExternalRiskEvents = new Set<string>();
  let facts: unknown | undefined = factsFor();
  let driftAfterFirstBasisRead = false;
  let basisReadCount = 0;
  let revokeOnFacts = false;
  let denySources = false;
  let lastBasisRequestedAt: string | undefined;
  const stubRiskInputFacts: RiskInputFactsReaderV1 = {
    readRiskInputFacts: async (input) => {
      // 外部风险事件必须已正式登记，否则事实读取不可用（与 C24 窄读同语义）。
      const riskInput = (input as { readonly riskInput?: Record<string, unknown> }).riskInput;
      const unavailableExternal =
        riskInput?.kind === "external-risk-event" &&
        !registeredExternalRiskEvents.has(
          `${(riskInput.reference as { entityId: string }).entityId}@${(riskInput.reference as { versionId: string }).versionId}`,
        );
      const result =
        facts === undefined || unavailableExternal
          ? { kind: "failed" as const, error: precondition("c25-fixture-facts") }
          : {
              kind: "succeeded" as const,
              facts: (riskInput === undefined ? facts : factsFor(riskInput as never)) as never,
            };
      if (revokeOnFacts) {
        // 读取已返回、提交尚未开始：此刻失效必须在提交前复验被拒绝。
        revokeOnFacts = false;
        await postgres.postgres.adminPool.query(
          "UPDATE business.local_accounts SET status = 'disabled' WHERE account_id = $1",
          [managerId],
        );
      }
      return result;
    },
  };
  // 故障 stub 与正式 owning reader 走同一个接缝：IP-04 起生产用例可整体替换为真实 reader，
  // C11 与 C25 两端始终消费同一组合，两 owning factories 都不依赖对方实例。
  let activeFactsReader: RiskInputFactsReaderV1 = stubRiskInputFacts;
  const riskInputFacts: RiskInputFactsReaderV1 = {
    readRiskInputFacts: (input) => activeFactsReader.readRiskInputFacts(input),
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
  // 记录解释与重评历史依赖 C30 已登记的运行事实（design D-12），因此这里注入真实 C30 适配器的
  // 两个窄读端口；C33 风险记录目录仍保持显式未接线，一旦被误调用立即失败，
  // 绝不用成功空结果冒充已实现读取。
  const unwiredReadDependency = (label: string): never => {
    throw new Error(`C25 fixture seam 之外的读依赖未接线：${label}`);
  };
  const workflow = createPostgresWorkflowAdapter({
    db: postgres.runtime.db,
    transactionUnit: postgres.transactionUnit,
    artifactStore: postgres.artifactStore,
    authorization: access,
    now: () => new Date(T0),
  });
  const unusedRecordCatalog: RiskIdentificationReadPortV1 = {
    read: async () => unwiredReadDependency("recordCatalog.read"),
  };
  let scoringConfigurationReady = true;
  const engine = createPostgresRiskAssessmentEngine({
    db: postgres.runtime.db,
    transactionUnit: postgres.transactionUnit,
    access,
    artifactStore: postgres.artifactStore,
    preparationContext: registry,
    riskInputFacts,
    basisReader,
    configuration: {
      readConfigurationMembers: async () =>
        scoringConfigurationReady
          ? {
              kind: "succeeded",
              members: configurationMembers.map((member) => {
                if (!isAssessmentConfigurationDefinitionTypeV1(member.definitionType))
                  throw new Error("unknown fixture configuration type");
                return {
                  ...member,
                  definitionType: member.definitionType,
                  releaseRef: KnowledgeReleaseRefV1Schema.parse(member.releaseRef),
                  revisionRef: KnowledgeRevisionRefV1Schema.parse(member.revisionRef),
                  projectRevisionRef,
                  configurationSetRef: CONFIGURATION_SET_REF,
                  summary: summarizeAssessmentConfigurationDocument(
                    configurationDocuments[member.definitionType],
                  ),
                };
              }),
            }
          : {
              kind: "failed",
              error: ModuleErrorV1Schema.parse({
                ...precondition("configuration-readiness"),
                blockerKind: "required-release-unavailable",
              }),
            },
    },
    monitoring: postgres.monitoringStore,
    authorizeDownstream,
    entryContext: createAssessmentEntryContextReadPort(registry),
    runRead: workflow.runRead,
    entriesRead: workflow.entriesRead,
    recordCatalog: unusedRecordCatalog,
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
    /** 覆盖默认适用性快照，用于重评的「适用性元数据变化」用例。 */
    readonly applicabilityMetadataSnapshotRef?: unknown;
    readonly effectiveAt?: string;
    readonly withCausalRun?: boolean;
    /** 风险输入覆盖：外部风险事件分支用正式登记的外部事件引用。 */
    readonly riskInput?: unknown;
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
        riskInput: input.riskInput ?? c25Facts().riskInput,
        projectRevisionRef,
        spatialScopeRef: businessSpatialScopeRef,
        applicabilityMetadataSnapshotRef:
          input.applicabilityMetadataSnapshotRef ?? applicabilitySnapshotRef,
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

  // 记录解释与重评历史只能解释 C30 已登记的运行事实：这里用 C30 自身适配器登记真实入口行、
  // 真实 run-state 工件与产出该记录的正式链边，不向 C25 塞入测试替身。
  const entriesAuthorization = await authorize({
    invocationId: "c25-engine-entries-registration",
    branch: "projection.query",
  });
  const entriesScopeDigest = authorizationScopeDigest(entriesAuthorization);

  const registerWithinTransaction = async (input: {
    readonly row: WorkflowGraphResultRowV1;
    readonly commandKind?: string;
  }) => {
    const commandKind = input.commandKind ?? "workflow.register-row";
    await postgres.transactionUnit.execute(
      {
        projectId: PROJECT_ID,
        commandKind,
        commandId: input.row.commandId,
        idempotencyKey: input.row.idempotencyKey,
        payload: { resultId: input.row.resultId, kind: input.row.resultKind },
        actorRef: input.row.actorRef,
        authorizationContextRef: input.row.authorizationContextRef,
        issuedAt: input.row.recordedAt,
        runId: input.row.runId,
      },
      async (context) => {
        await workflow.registrationStore.registerRow(
          { row: input.row, occurredAt: input.row.recordedAt },
          context,
        );
        return {
          resultRef: {
            kind: "workflow-run" as const,
            reference: { entityId: input.row.runId, versionId: input.row.runVersionId },
          },
          audit: {
            auditEntryId: input.row.auditEntryId,
            projectId: PROJECT_ID,
            action: commandKind,
            targetRef: {
              kind: "workflow-run" as const,
              reference: { entityId: input.row.runId, versionId: input.row.runVersionId },
            },
            actorRef: input.row.actorRef,
            authorizationContextRef: input.row.authorizationContextRef,
            occurredAt: input.row.recordedAt,
            recordedAt: input.row.recordedAt,
            version: { entityId: input.row.runId, versionId: input.row.runVersionId },
            commandId: input.row.commandId,
            idempotencyKey: input.row.idempotencyKey,
            runId: input.row.runId,
          },
          events: [],
        };
      },
    );
  };

  /** 登记一个产出指定评估记录的真实 C30 运行（入口行 + run-state 工件 + 正式链边）。 */
  const registerAssessmentRun = async (input: {
    readonly suffix: string;
    readonly runId: string;
    readonly recordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly entryMode: "assess" | "reassess";
    readonly reassessmentEntry?: {
      readonly previousAssessmentRecordRef: {
        readonly kind: "risk-assessment-record";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
      readonly reason: "monitoring-snapshot" | "applicability-metadata";
      readonly changedInputRefs: readonly ContractReferenceV1[];
    };
  }) => {
    const runVersionId = c25Digest({ run: "run-version", suffix: input.suffix });
    const entryIdentity = {
      entityId: `workflow-entry:${PROJECT_ID}:${input.suffix}`,
      versionId: c25Digest({ run: "entry-identity", suffix: input.suffix }),
    };
    const rowBase = {
      schemaVersion: "1" as const,
      projectId: PROJECT_ID,
      runId: input.runId,
      runVersionId,
      entryMode: input.entryMode,
      requestDigest: c25Digest({ run: "request", suffix: input.suffix }),
      actorRef: managerId,
      authorizationContextRef: entriesAuthorization.authorizationContextRef,
      authorizationScopeDigest: entriesScopeDigest,
      validAt: T0,
      recordedAt: T0,
      persistedAt: T0,
      frozenRefs: [C25_FIXTURE_RISK_RECORD_REF],
    };
    // 每个登记行一个命令身份：C03 对同键异载荷直接判幂等冲突。
    const rowIdentity = (resultKind: string) => ({
      commandId: `c25-engine-entries-${input.suffix}:${resultKind}`,
      idempotencyKey: `c25-engine-entries-${input.suffix}:${resultKind}`,
      auditEntryId: `c25-engine-entries-${input.suffix}:${resultKind}:audit`,
    });
    await registerWithinTransaction({
      row: {
        ...rowBase,
        ...rowIdentity("entry-snapshot"),
        resultKind: "entry-snapshot",
        resultId: `entry-snapshot:${input.runId}:1`,
        resultVersionId: "1",
        stage: "preparing",
        entryIdentity,
      },
    });
    const artifactId = `c25-run-state:${input.runId}:${runVersionId}`;
    const artifactRef = await workflow.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: managerId,
      commandId: `c25-engine-entries-body-${input.suffix}`,
      issuedAt: T0,
      artifactId,
      // C30 按 C06 要求用签发身份复验：写入必须用同一 invocationId 换取授权。
      authorization: await authorize({
        invocationId: workflowGraphInvocationIdV1({
          operation: "body-write",
          projectId: PROJECT_ID,
          targetId: artifactId,
        }),
        branch: "projection.query",
      }),
      invocationId: workflowGraphInvocationIdV1({
        operation: "body-write",
        projectId: PROJECT_ID,
        targetId: artifactId,
      }),
      body: {
        bodyKind: "run-state",
        runState: WorkflowGraphRunStateV1Schema.parse({
          schemaVersion: "1",
          projectId: PROJECT_ID,
          runId: input.runId,
          runVersionId,
          entryMode: input.entryMode,
          entryIdentity,
          stage: "A5",
          status: "completed",
          assessmentRunRefs: [],
          acceptedRiskRecordRefs: [C25_FIXTURE_RISK_RECORD_REF],
          assessmentRecordRefs: [input.recordRef],
          warningRecordRefs: [],
          responseRecommendationRefs: [],
          deviationRecordRefs: [],
          calibrationSuggestionRefs: [],
          ...(input.reassessmentEntry === undefined
            ? {}
            : { reassessmentEntry: input.reassessmentEntry }),
          recordedAt: T0,
        }),
      },
    });
    await registerWithinTransaction({
      row: {
        ...rowBase,
        ...rowIdentity("run-state"),
        resultKind: "run-state",
        resultId: artifactRef.reference.entityId,
        resultVersionId: runVersionId,
        stage: "A5",
        artifactRef,
      },
    });
    const linkId = c25Digest({ run: "entries-link", suffix: input.suffix });
    await postgres.transactionUnit.execute(
      {
        projectId: PROJECT_ID,
        commandKind: "workflow.register-link",
        commandId: `c25-engine-entries-link-${input.suffix}`,
        idempotencyKey: `c25-engine-entries-link-${input.suffix}`,
        payload: { linkId },
        actorRef: managerId,
        authorizationContextRef: entriesAuthorization.authorizationContextRef,
        issuedAt: T0,
        runId: input.runId,
      },
      async (context) => {
        await workflow.registrationStore.registerLink(
          {
            link: {
              schemaVersion: "1",
              projectId: PROJECT_ID,
              linkId,
              runId: input.runId,
              fromRef: C25_FIXTURE_RISK_RECORD_REF,
              toRef: input.recordRef,
              relation: "risk-assessment",
              sourceStage: "A5",
              stageResultRef: {
                kind: "stage-result",
                reference: { entityId: `c25-stage-result:${input.suffix}`, versionId: "1" },
              },
              authorizationContextRef: entriesAuthorization.authorizationContextRef,
              authorizationScopeDigest: entriesScopeDigest,
              actorRef: managerId,
              recordedAt: T0,
              auditEntryId: `c25-engine-entries-link-${input.suffix}:audit`,
            },
          },
          context,
        );
        return {
          resultRef: {
            kind: "workflow-run" as const,
            reference: { entityId: input.runId, versionId: runVersionId },
          },
          audit: {
            auditEntryId: `c25-engine-entries-link-${input.suffix}:audit`,
            projectId: PROJECT_ID,
            action: "workflow.register-link",
            targetRef: {
              kind: "workflow-run" as const,
              reference: { entityId: input.runId, versionId: runVersionId },
            },
            actorRef: managerId,
            authorizationContextRef: entriesAuthorization.authorizationContextRef,
            occurredAt: T0,
            recordedAt: T0,
            version: { entityId: input.runId, versionId: runVersionId },
            commandId: `c25-engine-entries-link-${input.suffix}`,
            idempotencyKey: `c25-engine-entries-link-${input.suffix}`,
            runId: input.runId,
          },
          events: [],
        };
      },
    );
    return {
      runRef: {
        kind: "workflow-run" as const,
        reference: { entityId: input.runId, versionId: runVersionId },
      },
    };
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
    setScoringConfigurationReady: (ready) => {
      scoringConfigurationReady = ready;
    },
    readAuthorization: (requestId) =>
      authorize({
        invocationId: requestId,
        branch: "risk-assessment.read-input-snapshot",
        sourceVersionRefs: [sourceVersionRef],
      }),
    entryReadAuthorization: (requestId, options) =>
      authorize({
        invocationId: requestId,
        branch: "risk-assessment.read",
        spatialScopeRefs: options?.spatialScopeRefs ?? [accessRootScopeRef],
        sourceVersionRefs: options?.sourceVersionRefs ?? [],
      }),
    projectId: PROJECT_ID,
    managerId,
    projectRevisionRef,
    accessRootScopeRef,
    sourceVersionRef,
    businessSpatialScopeRef,
    preparationSnapshotRef: preparations.a,
    monitoringSnapshotRefs,
    basisRef,
    setFacts(value) {
      facts = value;
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
    async revokeOnFactsRead() {
      revokeOnFacts = true;
    },
    denyDeclaredSources() {
      denySources = true;
    },
    restoreDeclaredSources() {
      denySources = false;
    },
    async revokeAfterFirstRead() {
      await postgres.postgres.adminPool.query(
        "UPDATE business.local_accounts SET status = 'disabled' WHERE account_id = $1",
        [managerId],
      );
    },
    async restoreSession() {
      await postgres.postgres.adminPool.query(
        "UPDATE business.local_accounts SET status = 'active' WHERE account_id = $1",
        [managerId],
      );
      const relogin = await access.login({
        kind: "login",
        loginAttemptId: `c25-engine-manager-restore-${Date.now()}`,
        loginName: "c25-engine-manager",
        password: "c25-engine-manager-password-changed",
      });
      sessionToken = relogin.sessionToken;
    },
    freezePreparation,
    registerAssessmentRun,
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
    async registerExternalRiskEvent(suffix) {
      return registerExternalRiskEventWithBody({
        suffix,
        body: { eventType: "external-risk-event", suffix },
      });
    },
    async registerExternalRiskEventWithBody(input) {
      return registerExternalRiskEventWithBody(input);
    },
    async registerAcceptedStandardizedRiskRecord(input) {
      const riskRecordId = `c25-record-${input.suffix}`;
      const riskRecordRef = {
        kind: "standardized-risk-record" as const,
        reference: { entityId: riskRecordId, versionId: "1" },
      };
      const record: StandardizedRiskRecord = input.record ?? {
        processNodeId: "c25-process-node",
        riskSource: "c25-risk-source",
        riskFactor: "c25-risk-factor",
        riskEvent: "c25-risk-event",
        riskElementRelations: [
          { sourceElement: "c25-element", relation: "affects", targetElement: "c25-worksite" },
        ],
        evidenceLocator: { sourceSegmentId },
        modelConfidence: 0.82,
      };
      const compositeConfidence: CompositeConfidence = input.compositeConfidence ?? {
        value: 0.78,
        basis: ["c25-confidence-basis"],
      };
      const recordEvidence = [
        { locator: { sourceSegmentId }, sourceVersion: sourceVersionRef.reference },
      ];
      const commandId = `c25-accept-${input.suffix}`;
      const row: StandardizedRiskRecordWriteV1 = {
        riskRecordId,
        versionId: "1",
        riskRecordRef,
        rowId: `c25-accept-row-${input.suffix}`,
        idempotencyKey: commandId,
        requestDigest: c25Digest(record),
        projectId: PROJECT_ID,
        workPlanRef: {
          kind: "identification-work-plan",
          reference: { entityId: `c25-work-plan-${input.suffix}`, versionId: "1" },
        },
        identificationRunRef: {
          kind: "workflow-run",
          reference: { entityId: `c25-identification-run-${input.suffix}`, versionId: "1" },
        },
        inputSnapshotRef: {
          kind: "identification-input-snapshot",
          reference: { entityId: `c25-identification-snapshot-${input.suffix}`, versionId: "1" },
        },
        mergePlanRef: {
          kind: "merge-plan",
          reference: { entityId: `c25-merge-plan-${input.suffix}`, versionId: "1" },
        },
        reviewDecisionRef: {
          kind: "review-decision",
          reference: { entityId: `c25-review-decision-${input.suffix}`, versionId: "1" },
        },
        groupId: `c25-group-${input.suffix}`,
        groupVersionId: "1",
        groupRef: {
          kind: "identification-group",
          reference: { entityId: `c25-group-${input.suffix}`, versionId: "1" },
        },
        representativeCandidateRefs: [
          {
            kind: "content-artifact",
            reference: {
              entityId: `c25-candidate-${input.suffix}`,
              versionId: "1",
            },
          },
        ],
        sourceSegmentIds: [sourceSegmentId],
        mechanismEntryIds: [`c25-mechanism-${input.suffix}`],
        spatialScopeRefs: [businessSpatialScopeRef],
        sourceVersionRefs: [sourceVersionRef],
        evidenceReferences: recordEvidence,
        authorizationScopeDigest: c25Digest({
          spatialScopeRefs: [businessSpatialScopeRef],
          sourceVersionRefs: [sourceVersionRef],
        }),
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: `c25-accept-auth-${input.suffix}`, versionId: "1" },
        },
        actorRef: managerId,
        commandId,
        occurredAt: T0,
      };
      const finalization = createPostgresRiskCandidateFinalizationAdapter({
        db: postgres.runtime.db,
        transactionUnit: postgres.transactionUnit,
        now: () => new Date(T0),
      });
      await postgres.transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "identification.accept-groups",
          commandId,
          idempotencyKey: commandId,
          payload: { fixture: "合成样本、待甲方复核", recordIds: [riskRecordId] },
          actorRef: managerId,
          authorizationContextRef: row.authorizationContextRef,
          issuedAt: T0,
        },
        async (context) => {
          const outcome = await finalization.insertRecords(
            {
              rows: [row],
              records: [
                {
                  riskRecordId,
                  record,
                  riskMechanismEntryIds: row.mechanismEntryIds,
                  sourceIds: [sourceVersionRef.reference.entityId],
                  compositeConfidence,
                  version: {
                    reference: { entityId: riskRecordId, versionId: "1" },
                    effectivePeriod: { validFrom: T0 },
                    systemTime: { recordedAt: T0 },
                  },
                  audit: {
                    actorId: managerId,
                    action: "identification.accept-groups",
                    recordedAt: T0,
                  },
                },
              ],
              occurredAt: T0,
            },
            context,
          );
          if (outcome.kind !== "inserted" && outcome.kind !== "replayed") {
            throw new Error(`C25 accepted record insert failed: ${outcome.detailCode}`);
          }
          return {
            resultRef: riskRecordRef,
            audit: {
              auditEntryId: `${commandId}:audit`,
              projectId: PROJECT_ID,
              action: "identification.accept-groups",
              targetRef: riskRecordRef,
              actorRef: managerId,
              authorizationContextRef: row.authorizationContextRef,
              occurredAt: T0,
              recordedAt: T0,
              version: { entityId: riskRecordId, versionId: "1" },
              commandId,
              idempotencyKey: commandId,
            },
            events: [],
          } satisfies AtomicCommitV1;
        },
      );
      return riskRecordRef;
    },
    async authorizeEvidenceAccess(requestId, options) {
      return authorize({
        invocationId: requestId,
        branch: "engineering-data.evidence-access",
        ...(options?.spatialScopeRefs === undefined
          ? {}
          : { spatialScopeRefs: options.spatialScopeRefs }),
        sourceVersionRefs: options?.sourceVersionRefs ?? [sourceVersionRef],
      });
    },
    useFactsReader(reader) {
      activeFactsReader = reader;
    },
    restoreStubFactsReader() {
      activeFactsReader = stubRiskInputFacts;
    },
    async registerApplicabilitySnapshot(suffix) {
      const result = await postgres.registry.createApplicabilitySnapshot({
        commandId: `c25-applicability-${suffix}`,
        idempotencyKey: `c25-applicability-${suffix}`,
        projectId: PROJECT_ID,
        actorId: managerId,
        issuedAt: T0,
        authorization: await authorize({
          invocationId: `c25-applicability-${suffix}`,
          branch: "engineering-data.register-source-delivery",
        }),
        projectRevisionRef,
        spatialScopeRef: businessSpatialScopeRef,
        formedAt: T0,
      });
      if (result.kind !== "succeeded" || result.result.kind !== "applicability-snapshot") {
        throw new Error(
          `C25 applicability snapshot failed: ${JSON.stringify(result).slice(0, 400)}`,
        );
      }
      return result.result.snapshot.snapshotRef;
    },
    async seriesVariant(input) {
      const definition = monitoringSeriesDefinitions.find(
        (entry) => entry.seriesId === input.seriesId,
      );
      if (definition === undefined) throw new Error(`unknown series ${input.seriesId}`);
      return registerMonitoringSeries({
        ...definition,
        seriesVersion: input.seriesVersion,
        canonicalUnit: input.canonicalUnit,
        values: input.values,
      });
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
        idempotencyKey: input.idempotencyKey ?? input.commandId,
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
        idempotencyKey: input.idempotencyKey ?? input.commandId,
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
