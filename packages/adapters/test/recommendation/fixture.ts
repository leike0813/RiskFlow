/**
 * C27 PostgreSQL 组合夹具：真实 C03/C04/C06/C07/C08 + 正式 C25/C26 评估与预警链 + 本 change 的 recommendation adapter。
 * 措施库正文、C19 basis 成员与部署策略由夹具按精确引用提供；上游事实一律经正式 adapter 持久化。
 */
import type { Kysely } from "kysely";

import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  AgentCandidateVersionV1Schema,
  AgentTaskDefinitionRegistry,
  AgentValidationResultV1Schema,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskRefV1,
  type AgentTaskResultRefV1,
  type AgentTaskSnapshotV1,
  type AgentValidationResultV1,
} from "@riskflow/core/agent-runtime";
import { ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1 } from "@riskflow/core/assessment-config";
import {
  canonicalJson,
  sha256CanonicalJson,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import {
  RecommendationCandidateV1Schema,
  ResponseAgentPolicyV1Schema,
  ResponseGenerationPolicyV1Schema,
  ResponseRecommendationIncrementV1Schema,
  ResponseValidationPolicyV1Schema,
  RecommendationSiteContextV1Schema,
  createResponseRecommendationTaskDefinition,
  type RecommendationCandidateV1,
  type RecommendationPolicyProviderV1,
  type ResponseAgentPolicyV1,
  type ResponseRecommendationIncrementV1,
} from "@riskflow/core/recommendation";
import {
  AuthorizationContextV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  KnowledgeRetrievalResultV1Schema,
  ModuleErrorV1Schema,
  RecommendationCommandV1Schema,
  RecommendationResultV1Schema,
  ReviewDecisionCommandV1Schema,
  StartAgentTaskCommandV1Schema,
  type AuthorizationContextV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeRetrievalResultV1,
  type MeasureLibraryReleaseRefV1,
  type RecommendationCandidateRefV1,
  type RecommendationCommandV1,
  type RecommendationResultV1,
  type WarningResponseTaskRefV1,
} from "@riskflow/contracts/ports";

import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import { PostgresAssessmentConfigurationAdapter } from "../../src/assessment-config/index.js";
import {
  governedReleaseResolutionInvocationId,
  PostgresKnowledgeGovernanceAdapter,
} from "../../src/knowledge-governance/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import {
  createPostgresRecommendationAdapter,
  PostgresRecommendationContextReader,
  type PostgresRecommendationAdapter,
  type RecommendationReviewAuthorizationProviderV1,
} from "../../src/recommendation/index.js";
import type { PostgresDatabase } from "../../src/postgres/types.js";
import {
  c25ConfigurationDocument,
  c25ConfigurationDocuments,
  c25Digest,
  c25Evidence,
  c25ReleaseRef,
  c25RevisionRef,
  c25Version,
} from "../../../core/test/risk-assessment/fixture.js";
import {
  ASSESSMENT_CONFIGURATION_TYPES_BY_PURPOSE,
  AssessmentConfigurationDocumentV1Schema,
  IndicatorFieldMappingDocumentV1Schema,
  MeasureLibraryDocumentV1Schema,
  MonitoringWarningThresholdDocumentV1Schema,
  RiskAcceptanceThresholdDocumentV1Schema,
} from "@riskflow/core/assessment-config";
import {
  startWarningLifecycleFixture,
  type WarningLifecyclePostgresFixtureV1,
} from "../warning/fixture.js";

export const C27_FIXTURE_TIME = "2033-04-05T06:07:08.000Z";
export const C27_MEASURE_CATEGORY = "渗流突涌";
export const C27_WORKER_ID = "c27-recommendation-worker";
const FOREIGN_PROJECT_ID = "project-c27-recommendation-foreign";
const AGENT_RUN_REF = {
  kind: "workflow-run",
  reference: { entityId: "c27-agent-run", versionId: "1" },
} as const;
/** 与 C26 组合夹具一致的成员身份：同一 C25 管理员会话口令。 */
const C25_MANAGER_LOGIN_NAME = "c25-engine-manager";
const C25_MANAGER_PASSWORD = "c25-engine-manager-password-changed";
const INTENT_PURPOSE_CODE = "agent-action-intent";
const INTENT_MEDIA_TYPE = "application/vnd.riskflow.agent-action-intent+json";
const CONFIGURATION_MEDIA_TYPE = "application/vnd.riskflow.assessment-configuration+json";

type ContentArtifactRef = {
  readonly kind: "content-artifact";
  readonly reference: { readonly entityId: string; readonly versionId: string };
};

export interface RecommendationValidationOverridesV1 {
  readonly targetIndicators?: readonly {
    readonly indicatorItem: string;
    readonly targetValue: string | number | boolean;
  }[];
  readonly reviewedStandardEvidence?: readonly {
    readonly measureId: string;
    readonly evidenceItem: string;
  }[];
  readonly contraindicationRules?: readonly {
    readonly contraindicationId: string;
    readonly triggerTypes: readonly string[];
  }[];
  readonly executableProcessStatuses?: readonly string[];
}

export interface RecommendationSiteContextOverridesV1 {
  readonly availableResources?: readonly string[];
  readonly constraints?: readonly string[];
  readonly processStatus?: string;
}

export interface RecommendationPostgresFixtureV1 {
  readonly c26: WarningLifecyclePostgresFixtureV1;
  readonly db: Kysely<PostgresDatabase>;
  readonly adapter: PostgresRecommendationAdapter;
  readonly agentTasks: PostgresAgentTaskAdapter;
  readonly projectId: string;
  readonly managerId: string;
  readonly agentPolicy: ResponseAgentPolicyV1;
  readonly measureArtifactRef: ContentArtifactRef;
  readonly measureLibraryReleaseRef: MeasureLibraryReleaseRefV1;
  readonly generationPolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly validationPolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly siteContextRef: { readonly entityId: string; readonly versionId: string };
  /** 冻结并打开预警：每次评估产生一批预警，同一风险输入聚合到同一任务版本。 */
  openWarnings(input: {
    readonly commandPrefix: string;
    readonly assessments: number;
    /** 缺省按 commandPrefix 隔离风险输入；同一任务追加预警时传入相同键。 */
    readonly riskInputKey?: string;
  }): Promise<{
    readonly taskRef: WarningResponseTaskRefV1;
    readonly warningRefs: readonly string[];
    readonly assessmentRecordRefs: readonly {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
  }>;
  setCategory(value: string | undefined): void;
  setMeasureAvailability(value: "available" | "missing"): void;
  setValidationOverrides(value: RecommendationValidationOverridesV1 | null): void;
  setSiteContextOverrides(value: RecommendationSiteContextOverridesV1 | null): void;
  setReviewEnabled(value: boolean): void;
  measureCandidates(input: {
    readonly queryId: string;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    readonly assessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly measureLibraryReleaseRef?: MeasureLibraryReleaseRefV1;
    readonly spatialScope?: "root" | "restricted";
  }): Promise<KnowledgeRetrievalResultV1>;
  /** 未获准工程的身份声明查询：服务端必须在读取目标前失败闭合。 */
  foreignMeasureCandidates(input: {
    readonly queryId: string;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    readonly assessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly measureLibraryReleaseRef: MeasureLibraryReleaseRefV1;
  }): Promise<KnowledgeRetrievalResultV1>;
  runAgent(input: {
    readonly suffix: string;
    readonly queryResultRef: KnowledgeQueryResultRefV1;
    readonly selections: ResponseRecommendationIncrementV1["selections"];
  }): Promise<{
    readonly taskRef: AgentTaskRefV1;
    readonly validation: AgentValidationResultV1;
    readonly agentResultRef?: AgentTaskResultRefV1;
    readonly candidateRef?: RecommendationCandidateRefV1;
  }>;
  failAgent(input: {
    readonly suffix: string;
    readonly queryResultRef: KnowledgeQueryResultRefV1;
  }): Promise<AgentTaskRefV1>;
  createCandidate(input: {
    readonly commandId: string;
    readonly spatialScope?: "root" | "restricted";
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    readonly measureCandidateQueryResultRef: KnowledgeQueryResultRefV1;
    readonly agentTaskResultRef: AgentTaskResultRefV1;
    readonly responseGenerationPolicyRef?:
      { readonly entityId: string; readonly versionId: string } | undefined;
  }): Promise<RecommendationResultV1>;
  validateAndRecord(input: {
    readonly commandId: string;
    readonly spatialScope?: "root" | "restricted";
    readonly recommendationCandidateRef: RecommendationCandidateRefV1;
    readonly responseValidationPolicyRef?:
      { readonly entityId: string; readonly versionId: string } | undefined;
    readonly siteContextRef: { readonly entityId: string; readonly versionId: string };
  }): Promise<RecommendationResultV1>;
  candidatePayload(candidateRef: RecommendationCandidateRefV1): Promise<RecommendationCandidateV1>;
  taskSnapshot(taskRef: AgentTaskRefV1): Promise<AgentTaskSnapshotV1 | undefined>;
  countRows(
    table:
      | "measure_candidate_queries"
      | "recommendation_candidates"
      | "recommendation_validations"
      | "response_recommendations",
  ): Promise<number>;
  countReceipts(commandKind: string): Promise<number>;
  countAudit(action: string): Promise<number>;
  openReceiptCount(): Promise<number>;
  countCandidatesForTask(taskId: string): Promise<number>;
  countReviewTasks(candidateId: string): Promise<number>;
  countCommandRows(
    table:
      | "measure_candidate_queries"
      | "recommendation_candidates"
      | "recommendation_validations"
      | "response_recommendations",
    commandId: string,
  ): Promise<number>;
  countReceiptsForCommand(commandId: string): Promise<number>;
  countAuditForCommand(action: string, commandId: string): Promise<number>;
  preinsertAuditConflict(auditEntryId: string): Promise<void>;
  clearAuditConflict(auditEntryId: string): Promise<void>;
  close(): Promise<void>;
}

export const startRecommendationFixture = async (
  variant: "covered" | "missing-mapping" | "uncovered-target" = "covered",
): Promise<RecommendationPostgresFixtureV1> => {
  // 合成样本、待甲方复核：只让 value 阈值命中，并以同版唯一字段映射指向措施目标指标。
  const baseDocuments = c25ConfigurationDocuments();
  const configurationDocuments = {
    ...baseDocuments,
    "indicator-field-mapping": IndicatorFieldMappingDocumentV1Schema.parse({
      ...baseDocuments["indicator-field-mapping"],
      content: {
        mappings: baseDocuments["indicator-field-mapping"].content.mappings.map((mapping) =>
          variant !== "missing-mapping" && mapping.mappingId === "mapping-consequence-slope"
            ? {
                ...mapping,
                mappingId: "mapping-consequence-value",
                origin: {
                  kind: "monitoring-value",
                  monitoringIndicator: "地表沉降",
                  parameterCode: "ground-settlement",
                  metric: "value",
                },
                sourceUnit: "mm",
                conversion: { kind: "identity" },
              }
            : mapping,
        ),
      },
    }),
    "monitoring-warning-threshold": MonitoringWarningThresholdDocumentV1Schema.parse({
      ...baseDocuments["monitoring-warning-threshold"],
      content: {
        ...baseDocuments["monitoring-warning-threshold"].content,
        thresholds: baseDocuments["monitoring-warning-threshold"].content.thresholds.map(
          (threshold) =>
            threshold.thresholdId === "threshold-settlement-value"
              ? threshold
              : {
                  ...threshold,
                  comparison:
                    threshold.thresholdId === "threshold-frequency"
                      ? { operator: "outside", lower: "0", upper: "1000" }
                      : { operator: "gte", boundary: "999" },
                },
        ),
      },
    }),
    "risk-acceptance-threshold": RiskAcceptanceThresholdDocumentV1Schema.parse({
      ...baseDocuments["risk-acceptance-threshold"],
      content: {
        ...baseDocuments["risk-acceptance-threshold"].content,
        thresholds: baseDocuments["risk-acceptance-threshold"].content.thresholds.map(
          (threshold) => ({ ...threshold, maximumAcceptedLevelId: "level-4" }),
        ),
      },
    }),
    "measure-library": MeasureLibraryDocumentV1Schema.parse({
      ...baseDocuments["measure-library"],
      content: {
        measures: baseDocuments["measure-library"].content.measures.map((measure) =>
          variant === "uncovered-target" && measure.measureId === "measure-grouting"
            ? { ...measure, targetIndicatorIds: ["indicator-possibility-2"] }
            : measure,
        ),
      },
    }),
  };
  const c26 = await startWarningLifecycleFixture({ configurationDocuments });
  const postgres = c26.c25.postgres;
  const db = postgres.runtime.db as unknown as Kysely<PostgresDatabase>;
  const access: LocalIdentityAccessV1 = postgres.access;
  const adminPool = postgres.postgres.adminPool;
  const projectId = c26.projectId;
  const managerId = c26.managerId;
  const transactionUnit: TransactionUnitV1 = postgres.transactionUnit;
  const artifactStore: ArtifactStoreV1 = postgres.artifactStore;
  const rootRow = (
    await adminPool.query<{ scope_id: string; current_revision_id: string }>(
      "SELECT scope_id, current_revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [projectId],
    )
  ).rows[0];
  if (rootRow === undefined) throw new Error("C27 fixture requires the C25 root spatial scope");
  const rootSpatialScopeRef = {
    kind: "spatial-scope" as const,
    reference: { entityId: rootRow.scope_id, versionId: rootRow.current_revision_id },
  };
  const restrictedSpatialScopeRef = {
    kind: "spatial-scope" as const,
    reference: { entityId: "scope-c27-restricted", versionId: "scope-c27-restricted-r1" },
  };
  await adminPool.query(
    `INSERT INTO business.access_spatial_scopes (scope_id, project_id, current_revision_id)
     VALUES ($1, $2, $3) ON CONFLICT (scope_id) DO NOTHING`,
    [
      restrictedSpatialScopeRef.reference.entityId,
      projectId,
      restrictedSpatialScopeRef.reference.versionId,
    ],
  );
  await adminPool.query(
    `INSERT INTO business.access_spatial_scope_revisions
       (revision_id, scope_id, project_id, revision_no, parent_scope_id, status, recorded_by)
     VALUES ($1, $2, $3, 1, $4, 'active', $5) ON CONFLICT (revision_id) DO NOTHING`,
    [
      restrictedSpatialScopeRef.reference.versionId,
      restrictedSpatialScopeRef.reference.entityId,
      projectId,
      rootSpatialScopeRef.reference.entityId,
      managerId,
    ],
  );

  const login = await access
    .login({
      kind: "login",
      loginAttemptId: "c27-recommendation-fixture-login",
      loginName: C25_MANAGER_LOGIN_NAME,
      password: C25_MANAGER_PASSWORD,
    })
    .catch((error: unknown) => {
      throw new Error(`C27 fixture requires the C25 manager session: ${String(error)}`);
    });
  const sessionToken = login.sessionToken;
  const authorizeFor = async (input: {
    readonly branch: string;
    readonly invocationId: string;
    readonly requestedAt?: string;
    readonly spatialScope?: "root" | "restricted";
  }): Promise<AuthorizationContextV1> =>
    AuthorizationContextV1Schema.parse(
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId: input.invocationId,
          projectId,
          branch: input.branch as "engineering-data.register-source-delivery",
          requestedSpatialScopeRefs: [
            input.spatialScope === "restricted" ? restrictedSpatialScopeRef : rootSpatialScopeRef,
          ],
          requestedSourceVersionRefs: [],
          ...(input.requestedAt === undefined ? {} : { requestedAt: input.requestedAt }),
        })
      ).context,
    );

  const publishArtifact = async (input: {
    readonly commandId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly artifactId: string;
    readonly value: unknown;
  }): Promise<ContentArtifactRef> => {
    const authorization = await authorizeFor({
      branch: "engineering-data.register-source-delivery",
      invocationId: `${input.commandId}:put`,
    });
    const result = await artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C27_FIXTURE_TIME,
        authorization,
        requiredCapability: "engineering-data.write",
        artifactId: input.artifactId,
        artifactKind: "content",
        purposeCode: input.purposeCode,
        mediaType: input.mediaType,
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(canonicalJson(input.value));
      })(),
    );
    return { kind: "content-artifact", reference: result.artifactRef.reference };
  };

  // C18 处置用途九类配置正文：含措施库，按公共文档形态发布，C27 adapter 经 C04 授权读取并 strict 解析。
  const configurationMembers: {
    definitionType: string;
    releaseRef: unknown;
    revisionRef: unknown;
    artifactRef: ContentArtifactRef;
    contentDigest: string;
  }[] = [];
  let measureArtifactRef: ContentArtifactRef | undefined;
  const responseDefinitionTypes = ASSESSMENT_CONFIGURATION_TYPES_BY_PURPOSE.response;
  for (const definitionType of responseDefinitionTypes) {
    const document = AssessmentConfigurationDocumentV1Schema.parse(
      c25ConfigurationDocument(
        definitionType,
        (configurationDocuments[definitionType] as { readonly content: unknown }).content,
      ),
    );
    const artifactRef = await publishArtifact({
      commandId: `c27-configuration-${definitionType}`,
      purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
      mediaType: CONFIGURATION_MEDIA_TYPE,
      artifactId: `c27-configuration-${definitionType}`,
      value: document,
    });
    if (definitionType === "measure-library") measureArtifactRef = artifactRef;
    configurationMembers.push({
      definitionType,
      releaseRef: c25ReleaseRef(definitionType),
      revisionRef: c25RevisionRef(definitionType),
      artifactRef,
      contentDigest: c25Digest(document),
    });
  }
  configurationMembers.sort((left, right) => (left.definitionType < right.definitionType ? -1 : 1));
  if (measureArtifactRef === undefined) throw new Error("C27 fixture requires the measure library");

  let measureAvailability: "available" | "missing" = "available";
  let category: string | undefined = C27_MEASURE_CATEGORY;
  /** 夹具为每个测试前缀冻结的精确风险输入：生成策略按精确引用绑定类别。 */
  const boundRiskInputs: {
    readonly kind: "standardized-risk-record";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[] = [];
  const basisReader: AssessmentBasisReleaseSetReaderV1 = {
    readAssessmentBasisReleaseSet: async (input) =>
      measureAvailability === "missing" ||
      input.assessmentBasisReleaseSetRef.reference.entityId !== "assessment-basis-c25" ||
      input.assessmentBasisReleaseSetRef.reference.versionId !== "1"
        ? AssessmentBasisReleaseSetReadResultV1Schema.parse({
            kind: "unavailable",
            error: ModuleErrorV1Schema.parse({
              code: "AUTHORIZATION_DENIED",
              category: "authorization",
              retryable: false,
              requiredCapability: "knowledge-modeling.retrieve",
              authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
              stageCode: "c27.basis-read",
              occurredAt: C27_FIXTURE_TIME,
              causalRunId: input.requestId,
            }),
          })
        : AssessmentBasisReleaseSetReadResultV1Schema.parse({
            kind: "succeeded",
            schemaVersion: "1",
            assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
            memberDigest: sha256CanonicalJson({ members: configurationMembers }),
            applicableRuleSetMember: {
              releaseRef: c25ReleaseRef("set-applicable-rule-set"),
              revisionRef: c25RevisionRef("set-applicable-rule-set"),
              artifactRef: {
                kind: "content-artifact",
                reference: { entityId: "c27-applicable-rule-set", versionId: "1" },
              },
              contentDigest: c25Digest({ applicableRuleSet: "c27-double" }),
            },
            scoringRuleMembers: [
              {
                releaseRef: c25ReleaseRef("rule-c27-double"),
                revisionRef: c25RevisionRef("rule-c27-double"),
                artifactRef: {
                  kind: "content-artifact",
                  reference: { entityId: "c27-scoring-rule", versionId: "1" },
                },
                contentDigest: c25Digest({ scoringRule: "c27-double" }),
              },
            ],
            configurationMembers,
          }),
  };

  const defaultValidation: Required<RecommendationValidationOverridesV1> = {
    targetIndicators: [
      { indicatorItem: "indicator-consequence-1", targetValue: 5 },
      { indicatorItem: "indicator-possibility-2", targetValue: 5 },
      { indicatorItem: "threshold-settlement-value", targetValue: 7 },
      { indicatorItem: "threshold-frequency", targetValue: 0.2 },
      { indicatorItem: "threshold-settlement-slope", targetValue: 0.5 },
      { indicatorItem: "joint-trend", targetValue: 2 },
    ],
    reviewedStandardEvidence: [{ measureId: "measure-grouting", evidenceItem: "grouting-record" }],
    contraindicationRules: [
      { contraindicationId: "rapid-water-inflow", triggerTypes: ["风险等级超过风险可接受阈值"] },
    ],
    executableProcessStatuses: ["掘进"],
  };
  const defaultSite: Required<RecommendationSiteContextOverridesV1> = {
    availableResources: ["grouting-materials"],
    constraints: [],
    processStatus: "掘进",
  };
  let validationOverrides: RecommendationValidationOverridesV1 | null = null;
  let siteOverrides: RecommendationSiteContextOverridesV1 | null = null;

  const agentPolicy = ResponseAgentPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: c25Version("response-agent-policy"),
    projectId,
    definitionRef: c25Version("response-recommendation-definition"),
    toolPolicyRef: c25Version("response-recommendation-tools"),
    incrementSchemaRef: c25Version("response-recommendation-increment"),
    validationPolicyRef: c25Version("response-recommendation-validation"),
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: c25Version("response-agent-budget"),
      modelDeploymentRef: c25Version("model-deployment"),
      promptTemplateRef: c25Version("prompt-template"),
      toolPolicyRef: c25Version("response-recommendation-tools"),
      maxModelInvocations: 4,
      maxToolInvocations: 4,
      maxContextTokens: 16_384,
      maxInputBytes: 262_144,
      maxOutputBytes: 65_536,
      maxCandidates: 8,
      maxObjects: 64,
      maxSupplementarySearches: 0,
      maxCorrections: 2,
      maxTransientRetries: 1,
      maxConcurrentActions: 1,
      maxWallClockMs: 600_000,
    },
  });

  const policies: RecommendationPolicyProviderV1 = {
    readGenerationPolicy: async (input) =>
      ResponseGenerationPolicyV1Schema.parse({
        schemaVersion: "1",
        policyRef: input.generationPolicyRef,
        projectId,
        bindings:
          category === undefined
            ? []
            : [...boundRiskInputs]
                .sort((left, right) =>
                  left.reference.entityId < right.reference.entityId ? -1 : 1,
                )
                .map((riskInputRef) => ({ riskInputRef, riskEventCategory: category })),
      }),
    readValidationContext: async (input) => ({
      validationPolicy: ResponseValidationPolicyV1Schema.parse({
        schemaVersion: "1",
        policyRef: input.validationPolicyRef,
        projectId,
        targetIndicators:
          validationOverrides?.targetIndicators ?? defaultValidation.targetIndicators,
        reviewedStandardEvidence:
          validationOverrides?.reviewedStandardEvidence ??
          defaultValidation.reviewedStandardEvidence,
        contraindicationRules:
          validationOverrides?.contraindicationRules ?? defaultValidation.contraindicationRules,
        executableProcessStatuses:
          validationOverrides?.executableProcessStatuses ??
          defaultValidation.executableProcessStatuses,
      }),
      siteContext: RecommendationSiteContextV1Schema.parse({
        schemaVersion: "1",
        projectId,
        siteContextRef: input.siteContextRef,
        spatialScopeRef: rootSpatialScopeRef,
        processNodeRef: c25Version("process-node-c27"),
        processStatus: siteOverrides?.processStatus ?? defaultSite.processStatus,
        availableResources: siteOverrides?.availableResources ?? defaultSite.availableResources,
        constraints: siteOverrides?.constraints ?? defaultSite.constraints,
        evidenceReferences: [c25Evidence("c27-site-context")],
        observedAt: C27_FIXTURE_TIME,
      }),
    }),
    readAgentPolicy: async (input) =>
      ResponseAgentPolicyV1Schema.parse({ ...agentPolicy, policyRef: input.agentPolicyRef }),
  };

  const reviewAudit = new PostgresReviewAuditAdapter({
    db,
    transactionUnit,
    access,
    now: () => new Date(C27_FIXTURE_TIME),
  });
  let reviewEnabled = true;
  const reviewAuthorization: RecommendationReviewAuthorizationProviderV1 = {
    authorize: async (input) =>
      reviewEnabled
        ? authorizeFor({
            branch: "review-audit.request-review",
            invocationId: input.invocationId,
            requestedAt: input.requestedAt,
          })
        : Promise.reject(new Error("c27-review-disabled")),
  };

  // C18 治理链：夹具用 C27 自己的真实会话把处置用途的九类配置经 C16 提交 → C07 人工批准 →
  // C16 发布，再由 C18 按 purpose=response 解析已发布成员，不使用内存投影或兜底。
  const configuration = new PostgresAssessmentConfigurationAdapter({
    db,
    transactionUnit,
    artifactStore,
    now: () => new Date(C27_FIXTURE_TIME),
    governedReleases: {
      resolveGovernedReleases: async (request) => {
        const authorization = await authorizeFor({
          branch: "knowledge-modeling.assessment-basis",
          invocationId: governedReleaseResolutionInvocationId({
            requiredDefinitionTypes: request.requiredDefinitionTypes,
            requiredAt: request.requiredAt,
            asOfRecordedAt: request.asOfRecordedAt,
          }),
          requestedAt: C27_FIXTURE_TIME,
        });
        return governance.resolveGovernedReleases({ ...request, authorization });
      },
    },
  });
  const governance = new PostgresKnowledgeGovernanceAdapter({
    db,
    transactionUnit,
    access,
    reviewAudit,
    now: () => new Date(C27_FIXTURE_TIME),
    assessmentConfigurationPolicy: configuration,
    reviewAuthorizationProvider: {
      authorize: async (input) =>
        authorizeFor({
          branch: input.branch,
          invocationId: input.invocationId,
          requestedAt: input.requestedAt,
        }),
    },
  });
  for (const member of configurationMembers) {
    const govern = async (
      kind: "submit-revision" | "request-review" | "publish-approved-release",
      payload: unknown,
    ) => {
      const commandId = `c27-govern:${member.definitionType}:${kind}`;
      const result = await governance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind,
          commandId,
          idempotencyKey: commandId,
          projectId,
          actorId: managerId,
          issuedAt: C27_FIXTURE_TIME,
          authorization: await authorizeFor({
            branch: `knowledge-modeling.${kind}`,
            invocationId: commandId,
          }),
          payload,
        }),
      );
      if (result.kind !== "succeeded")
        throw new Error(`C27 configuration ${kind}: ${JSON.stringify(result)}`);
      return result.result;
    };
    const revision = await govern("submit-revision", {
      definitionType: member.definitionType,
      candidateArtifactRef: member.artifactRef,
      evidenceReferences: [c25Evidence(`c27-${member.definitionType}`)],
    });
    if (revision.kind !== "revision") throw new Error("C27 configuration revision missing");
    const review = await govern("request-review", {
      revisionRef: revision.knowledgeRevisionRef,
      reviewPolicyRef: c25Version("review-policy"),
    });
    if (review.kind !== "review-task") throw new Error("C27 configuration review missing");
    const commandId = `c27-govern:${member.definitionType}:decide`;
    const decision = await reviewAudit.decideReview(
      ReviewDecisionCommandV1Schema.parse({
        kind: "decide-review",
        commandId,
        idempotencyKey: commandId,
        projectId,
        actorId: managerId,
        issuedAt: C27_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "review-audit.decide-review",
          invocationId: commandId,
        }),
        payload: {
          reviewTaskRef: review.reviewTaskRef,
          targetRef: review.reviewTaskRef.targetRef,
          decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
          reasonCode: "synthetic-client-reviewed",
        },
      }),
    );
    if (decision.kind !== "succeeded")
      throw new Error(`C27 configuration approval: ${JSON.stringify(decision)}`);
    const published = await govern("publish-approved-release", {
      revisionRef: revision.knowledgeRevisionRef,
      reviewDecisionRef: decision.result.reviewDecisionRef,
      effectiveFrom: C27_FIXTURE_TIME,
    });
    if (published.kind !== "release") throw new Error("C27 configuration release missing");
    member.releaseRef = published.knowledgeReleaseRef;
    member.revisionRef = revision.knowledgeRevisionRef;
  }
  const publishedMeasure = configurationMembers.find(
    (member) => member.definitionType === "measure-library",
  )!;
  const measureLibraryReleaseRef = {
    kind: "measure-library-release" as const,
    reference: KnowledgeReleaseRefV1Schema.parse(publishedMeasure.releaseRef).reference,
  };
  configurationMembers.splice(configurationMembers.indexOf(publishedMeasure), 1);
  // 读者直接构造：接缝需要 configuration 与 runtimePolicies，二者不得被丢弃。
  const contextReader = new PostgresRecommendationContextReader({
    db,
    artifactStore,
    basis: basisReader,
    configuration,
    runtimePolicies: () => ({
      generationPolicyRef: c25Version("response-generation-policy"),
      validationPolicyRef: c25Version("response-validation-policy"),
      agentPolicyRef: c25Version("response-agent-policy"),
      reviewPolicyRef: c25Version("review-policy"),
    }),
    authorizeDownstream: async (request) =>
      authorizeFor({
        branch: request.branch,
        invocationId: request.invocationId,
        requestedAt: request.requestedAt,
      }),
  });
  const adapterRef: { current?: PostgresRecommendationAdapter } = {};
  const definition = createResponseRecommendationTaskDefinition({
    policy: agentPolicy,
    port: {
      validateIncrement: (input) => adapterRef.current!.validateIncrement(input),
      finalizeIncrement: (input) => adapterRef.current!.finalizeIncrement(input),
    },
  });
  const registry = new AgentTaskDefinitionRegistry([definition]);
  const agentTasks = new PostgresAgentTaskAdapter({
    db,
    registry,
    transactionUnit,
    artifactStore,
    referenceGuard: postgres.artifactRegistry,
    authorization: access,
    now: () => C27_FIXTURE_TIME,
  });
  const adapter = createPostgresRecommendationAdapter({
    db,
    transactionUnit,
    access,
    artifactStore,
    reader: contextReader,
    policies,
    agentTasks,
    reviewAudit,
    reviewAuthorization,
    taskAuthorization: {
      authorize: async (input) =>
        authorizeFor({
          branch: "warning-response.create-candidate",
          invocationId: `${input.task.envelope.agentTaskRef.reference.entityId}:${input.purpose}`,
          requestedAt: C27_FIXTURE_TIME,
        }),
    },
    now: () => new Date(C27_FIXTURE_TIME),
  });
  adapterRef.current = adapter;

  const intentArtifactRef = await publishArtifact({
    commandId: "c27-agent-intent",
    purposeCode: INTENT_PURPOSE_CODE,
    mediaType: INTENT_MEDIA_TYPE,
    artifactId: "c27-agent-intent",
    value: { schemaVersion: "1", prompt: "select and order frozen measures" },
  });
  const candidateArtifactRef = await publishArtifact({
    commandId: "c27-agent-candidate",
    purposeCode: "agent-candidate",
    mediaType: "application/vnd.riskflow.agent-candidate+json",
    artifactId: "c27-agent-candidate",
    value: { schemaVersion: "1", role: "agent-candidate" },
  });
  const incrementArtifactRef = await publishArtifact({
    commandId: "c27-agent-increment",
    purposeCode: "agent-increment",
    mediaType: "application/vnd.riskflow.agent-increment+json",
    artifactId: "c27-agent-increment",
    value: { schemaVersion: "1", role: "agent-increment" },
  });
  const actionResultArtifactRef = await publishArtifact({
    commandId: "c27-agent-action-result",
    purposeCode: "agent-action-result",
    mediaType: "application/vnd.riskflow.agent-action-result+json",
    artifactId: "c27-agent-action-result",
    value: { schemaVersion: "1", role: "agent-action-result" },
  });

  const agentStartCommand = async (input: {
    readonly suffix: string;
    readonly queryResultRef: KnowledgeQueryResultRefV1;
  }) =>
    StartAgentTaskCommandV1Schema.parse({
      kind: "start-task",
      commandId: `c27-agent-${input.suffix}`,
      idempotencyKey: `c27-agent-${input.suffix}`,
      projectId,
      actorId: managerId,
      issuedAt: C27_FIXTURE_TIME,
      authorization: await authorizeFor({
        branch: "agent-task.start-task",
        invocationId: `c27-agent-${input.suffix}`,
        requestedAt: C27_FIXTURE_TIME,
      }),
      payload: {
        taskType: "response-recommendation",
        triggerMode: "embedded",
        parentRunRef: AGENT_RUN_REF,
        frozenInputRef: input.queryResultRef,
        modelDeploymentRef: agentPolicy.budgetPolicy.modelDeploymentRef,
        promptTemplateRef: agentPolicy.budgetPolicy.promptTemplateRef,
        toolPolicyRef: agentPolicy.toolPolicyRef,
        budgetPolicyRef: agentPolicy.budgetPolicy.policyRef,
        incrementSchemaRef: agentPolicy.incrementSchemaRef,
        validationPolicyRef: agentPolicy.validationPolicyRef,
      },
    });

  /** 夹具按各自任务推进：租约轮询时取消其它测试遗留的活动任务，避免 claim 串任务。 */
  const claimOwnTask = async (taskRef: AgentTaskRefV1) => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const claim = await agentTasks.claim({
        workerId: C27_WORKER_ID,
        leaseDurationMs: 600_000,
        now: C27_FIXTURE_TIME,
      });
      if (claim === undefined) return undefined;
      if (claim.task.envelope.agentTaskRef.reference.entityId === taskRef.reference.entityId) {
        return claim;
      }
      await agentTasks.releaseLease({
        taskRef: claim.task.envelope.agentTaskRef,
        workerId: C27_WORKER_ID,
        leaseToken: claim.leaseToken,
        status: "cancelled",
        now: C27_FIXTURE_TIME,
      });
    }
    return undefined;
  };

  const countRowsValue = async (
    table:
      | "measure_candidate_queries"
      | "recommendation_candidates"
      | "recommendation_validations"
      | "response_recommendations",
  ): Promise<number> => {
    const result = await adminPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM business.${table} WHERE project_id = $1`,
      [projectId],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  return {
    c26,
    db,
    adapter,
    agentTasks,
    projectId,
    managerId,
    agentPolicy,
    measureArtifactRef,
    measureLibraryReleaseRef,
    generationPolicyRef: c25Version("response-generation-policy"),
    validationPolicyRef: c25Version("response-validation-policy"),
    siteContextRef: c25Version("site-context-c27"),
    async openWarnings(input) {
      let taskRef: WarningResponseTaskRefV1 | undefined;
      const warningRefs = new Set<string>();
      const assessmentRecordRefs: {
        readonly kind: "risk-assessment-record";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[] = [];
      for (let index = 0; index < input.assessments; index += 1) {
        const suffix = `${input.commandPrefix}-${index}`;
        // 每个测试前缀使用独立风险输入：C26 按风险输入聚合任务，隔离用例事实。
        const riskInputKey = input.riskInputKey ?? input.commandPrefix;
        const riskInput = {
          kind: "standardized-risk-record" as const,
          reference: { entityId: `risk-record-${riskInputKey}`, versionId: "1" },
        };
        if (
          !boundRiskInputs.some(
            (entry) => entry.reference.entityId === riskInput.reference.entityId,
          )
        ) {
          boundRiskInputs.push(riskInput);
        }
        const preparation = await c26.c25.freezePreparation({
          suffix,
          entryMode: "assess",
          triggerReasonCode: "manual-assessment",
          monitoringSnapshotRefs: c26.c25.monitoringSnapshotRefs,
          riskInput,
        });
        const prepared = await c26.c25.engine.prepare(
          await c26.c25.prepareCommand({ commandId: `c27-prepare-${suffix}`, preparation }),
        );
        if (prepared.kind !== "succeeded") {
          throw new Error(`C27 fixture prepare failed: ${JSON.stringify(prepared).slice(0, 400)}`);
        }
        const evaluated = await c26.c25.engine.evaluate(
          await c26.c25.evaluateCommand({
            commandId: `c27-evaluate-${suffix}`,
            inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
          }),
        );
        if (evaluated.kind !== "succeeded") {
          throw new Error(
            `C27 fixture evaluate failed: ${JSON.stringify(evaluated).slice(0, 400)}`,
          );
        }
        const assessmentRecordRef = evaluated.result.assessmentRecordRef;
        const opened = await c26.adapter.open(
          await c26.openCommand({
            commandId: `${input.commandPrefix}-open-${index}`,
            assessmentRecordRef,
          }),
        );
        if (opened.kind !== "succeeded") {
          throw new Error(`C27 fixture open failed: ${JSON.stringify(opened).slice(0, 400)}`);
        }
        taskRef = opened.result.warningResponseTaskRefs[0];
        for (const ref of opened.result.warningRecordRefs) warningRefs.add(ref.reference.entityId);
        assessmentRecordRefs.push({
          kind: "risk-assessment-record",
          reference: assessmentRecordRef.reference,
        });
      }
      if (taskRef === undefined) throw new Error("C27 fixture requires at least one assessment");
      return { taskRef, warningRefs: [...warningRefs].sort(), assessmentRecordRefs };
    },
    setCategory(value) {
      category = value;
    },
    setMeasureAvailability(value) {
      measureAvailability = value;
    },
    setValidationOverrides(value) {
      validationOverrides = value;
    },
    setSiteContextOverrides(value) {
      siteOverrides = value;
    },
    setReviewEnabled(value) {
      reviewEnabled = value;
    },
    async measureCandidates(input) {
      const authorization = await authorizeFor({
        branch: "knowledge-modeling.measure-candidates",
        invocationId: input.queryId,
        requestedAt: C27_FIXTURE_TIME,
        spatialScope: input.spatialScope,
      });
      const query = KnowledgeRetrievalQueryV1Schema.parse({
        queryId: input.queryId,
        projectId,
        actorId: managerId,
        requestedAt: C27_FIXTURE_TIME,
        authorization,
        kind: "measure-candidates",
        payload: {
          assessmentRecordRef: input.assessmentRecordRef,
          warningResponseTaskRef: input.warningResponseTaskRef,
          ...(input.measureLibraryReleaseRef === undefined
            ? {}
            : { measureLibraryReleaseRef: input.measureLibraryReleaseRef }),
        },
      });
      return KnowledgeRetrievalResultV1Schema.parse(await adapter.measureCandidates(query));
    },
    async foreignMeasureCandidates(input) {
      const query = KnowledgeRetrievalQueryV1Schema.parse({
        queryId: input.queryId,
        projectId: FOREIGN_PROJECT_ID,
        actorId: managerId,
        requestedAt: C27_FIXTURE_TIME,
        authorization: AuthorizationContextV1Schema.parse({
          schemaVersion: "1",
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: `authorization-${FOREIGN_PROJECT_ID}`, versionId: "1" },
          },
          actorId: managerId,
          projectId: FOREIGN_PROJECT_ID,
          grantedCapabilities: ["knowledge-modeling.retrieve"],
          spatialScopeRefs: [rootSpatialScopeRef],
          sourceAccessGrantRefs: [],
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          decidedAt: C27_FIXTURE_TIME,
          invocation: { kind: "human" },
        }),
        kind: "measure-candidates",
        payload: {
          assessmentRecordRef: input.assessmentRecordRef,
          warningResponseTaskRef: input.warningResponseTaskRef,
          measureLibraryReleaseRef: input.measureLibraryReleaseRef,
        },
      });
      return KnowledgeRetrievalResultV1Schema.parse(await adapter.measureCandidates(query));
    },
    async runAgent(input) {
      const started = await agentTasks.startTask(
        await agentStartCommand({ suffix: input.suffix, queryResultRef: input.queryResultRef }),
      );
      if (started.kind !== "succeeded") {
        throw new Error(`C27 fixture start-task failed: ${JSON.stringify(started).slice(0, 400)}`);
      }
      const taskRef = started.result.agentTaskRef;
      const claim = await claimOwnTask(taskRef);
      if (claim === undefined) throw new Error("C27 fixture claim failed");
      const actionId = `${input.suffix}:model-invocation`;
      const reservation = await agentTasks.reserveAction({
        taskRef,
        workerId: C27_WORKER_ID,
        leaseToken: claim.leaseToken,
        actionId,
        reservationId: `${actionId}:reservation`,
        actionType: "model-invocation",
        sequence: 0,
        idempotencyKey: actionId,
        intentArtifactRef,
        amount: { modelInvocations: 1 },
        now: C27_FIXTURE_TIME,
      });
      const increment = ResponseRecommendationIncrementV1Schema.parse({
        schemaVersion: "1",
        selections: [...input.selections],
      });
      const task: AgentTaskSnapshotV1 = reservation.task;
      const validation = AgentValidationResultV1Schema.parse(
        await definition.validateCandidate(increment, task),
      );
      const rejected = validation.items.some((item) => item.disposition === "rejected");
      const candidateVersion = AgentCandidateVersionV1Schema.parse({
        schemaVersion: "1",
        taskRef,
        candidateVersion: 1,
        parentCandidateVersion: 0,
        candidateArtifactRef,
        incrementArtifactRef,
        validation,
        disposition: rejected ? "rejected" : "pending",
        ...(rejected ? { rejectionClass: "repairable" } : {}),
        createdAt: C27_FIXTURE_TIME,
      });
      await agentTasks.recordCandidate({
        candidate: candidateVersion,
        workerId: C27_WORKER_ID,
        leaseToken: claim.leaseToken,
      });
      if (rejected) {
        await agentTasks.failAction({
          taskRef,
          workerId: C27_WORKER_ID,
          leaseToken: claim.leaseToken,
          actionId,
          error: makeAgentError({
            code: "AGENT_VALIDATION_REJECTED",
            category: "validation",
            stage: "c27.fixture.validation",
            taskRef,
            reasonCode: "measure-outside-frozen-candidates",
          }),
          resultArtifactRef: actionResultArtifactRef,
          usage: emptyAgentBudgetUsage(),
          now: C27_FIXTURE_TIME,
        });
        await agentTasks.releaseLease({
          taskRef,
          workerId: C27_WORKER_ID,
          leaseToken: claim.leaseToken,
          status: "released",
          now: C27_FIXTURE_TIME,
        });
        return { taskRef, validation };
      }
      const finalized = await definition.finalizeCandidate(increment, task);
      await agentTasks.completeAction({
        taskRef,
        workerId: C27_WORKER_ID,
        leaseToken: claim.leaseToken,
        actionId,
        resultArtifactRef: actionResultArtifactRef,
        usage: emptyAgentBudgetUsage(),
        activeWallClockMs: 1_000,
        now: C27_FIXTURE_TIME,
      });
      await agentTasks.completeTask({
        taskRef,
        workerId: C27_WORKER_ID,
        leaseToken: claim.leaseToken,
        resultRef: finalized,
        now: C27_FIXTURE_TIME,
      });
      if (!("candidateRef" in finalized) || finalized.candidateRef === undefined) {
        throw new Error("C27 fixture finalize did not return a candidate reference");
      }
      return {
        taskRef,
        validation,
        agentResultRef: finalized,
        candidateRef: finalized.candidateRef,
      };
    },
    async failAgent(input) {
      const started = await agentTasks.startTask(
        await agentStartCommand({
          suffix: `failed-${input.suffix}`,
          queryResultRef: input.queryResultRef,
        }),
      );
      if (started.kind !== "succeeded") {
        throw new Error(`C27 fixture start-task failed: ${JSON.stringify(started).slice(0, 400)}`);
      }
      const taskRef = started.result.agentTaskRef;
      const claim = await claimOwnTask(taskRef);
      if (claim === undefined) throw new Error("C27 fixture claim failed");
      await agentTasks.failTask({
        taskRef,
        workerId: C27_WORKER_ID,
        leaseToken: claim.leaseToken,
        error: makeAgentError({
          code: "AGENT_BUDGET_EXHAUSTED",
          category: "budget",
          retryable: false,
          stage: "c27.fixture.budget",
          taskRef,
        }),
        now: C27_FIXTURE_TIME,
      });
      return taskRef;
    },
    async createCandidate(input) {
      const command = RecommendationCommandV1Schema.parse({
        kind: "create-candidate",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C27_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "warning-response.create-candidate",
          invocationId: input.commandId,
          requestedAt: C27_FIXTURE_TIME,
          spatialScope: input.spatialScope,
        }),
        payload: {
          warningResponseTaskRef: input.warningResponseTaskRef,
          measureCandidateQueryResultRef: input.measureCandidateQueryResultRef,
          agentTaskResultRef: input.agentTaskResultRef,
          responseGenerationPolicyRef: input.responseGenerationPolicyRef,
        },
      }) as Extract<RecommendationCommandV1, { kind: "create-candidate" }>;
      return RecommendationResultV1Schema.parse(await adapter.createCandidate(command));
    },
    async validateAndRecord(input) {
      const command = RecommendationCommandV1Schema.parse({
        kind: "validate-and-record",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId,
        actorId: managerId,
        issuedAt: C27_FIXTURE_TIME,
        authorization: await authorizeFor({
          branch: "warning-response.validate-and-record",
          invocationId: input.commandId,
          requestedAt: C27_FIXTURE_TIME,
          spatialScope: input.spatialScope,
        }),
        payload: {
          recommendationCandidateRef: input.recommendationCandidateRef,
          responseValidationPolicyRef: input.responseValidationPolicyRef,
          siteContextRef: input.siteContextRef,
        },
      }) as Extract<RecommendationCommandV1, { kind: "validate-and-record" }>;
      return RecommendationResultV1Schema.parse(await adapter.validateAndRecord(command));
    },
    async candidatePayload(candidateRef) {
      const row = await adminPool.query<{ candidate_payload: unknown }>(
        "SELECT candidate_payload FROM business.recommendation_candidates WHERE project_id = $1 AND candidate_id = $2 AND version_id = $3",
        [projectId, candidateRef.reference.entityId, candidateRef.reference.versionId],
      );
      const payload = row.rows[0]?.candidate_payload;
      if (payload === undefined) throw new Error("C27 fixture candidate row is missing");
      return RecommendationCandidateV1Schema.parse(payload);
    },
    async taskSnapshot(taskRef) {
      return agentTasks.getTask(taskRef);
    },
    countRows: countRowsValue,
    async countReceipts(commandKind) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2",
        [projectId, commandKind],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countAudit(action) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2",
        [projectId, action],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async openReceiptCount() {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND completed_at IS NULL",
        [projectId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countCandidatesForTask(taskId) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.recommendation_candidates WHERE project_id = $1 AND warning_response_task_id = $2",
        [projectId, taskId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countReviewTasks(candidateId) {
      const result = await adminPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM business.review_tasks
           WHERE project_id = $1 AND target_ref -> 'reference' ->> 'entityId' = $2`,
        [projectId, candidateId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countCommandRows(table, commandId) {
      const result = await adminPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM business.${table} WHERE project_id = $1 AND command_id = $2`,
        [projectId, commandId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countReceiptsForCommand(commandId) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_id = $2",
        [projectId, commandId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async countAuditForCommand(action, commandId) {
      const result = await adminPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2 AND command_id = $3",
        [projectId, action, commandId],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async preinsertAuditConflict(auditEntryId) {
      await adminPool.query(
        `INSERT INTO audit.entries (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref, version_ref, occurred_at, recorded_at, command_id, idempotency_key)
         VALUES ($1, $2, 'c27.fixture.conflict', '{"kind":"warning-response-task","reference":{"entityId":"c27-fixture","versionId":"1"}}', $3, '{"kind":"authorization-context","reference":{"entityId":"c27-fixture","versionId":"1"}}', '{"entityId":"c27-fixture","versionId":"1"}', NOW(), NOW(), $1, $1)
         ON CONFLICT (audit_entry_id) DO NOTHING`,
        [auditEntryId, projectId, managerId],
      );
    },
    async clearAuditConflict(auditEntryId) {
      await adminPool.query("DELETE FROM audit.entries WHERE audit_entry_id = $1", [auditEntryId]);
    },
    async close() {
      await c26.close();
    },
  };
};
