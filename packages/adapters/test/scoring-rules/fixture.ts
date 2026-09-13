/**
 * C19 PostgreSQL 集成夹具：在 C15 真实清洗链路之上叠加 C16 治理、C07 审阅、C18 配置与
 * C19 规则适配器，全部跑在同一个真实 PostgreSQL 容器与同一套生产迁移上。
 *
 * 知识侧（C16/C18/C19/C08 authoring）使用确定性的 C06 桩复验接口；C15 链路保留真实
 * C06 会话与冻结流程，因此“规范资料段 → C15 保留 → C19 编制”的出口是真实链路。
 * 合成样本、待甲方复核：来源文档为夹具合成内容，仅标准身份与资料段定位语义按真实
 * 规范建模；不保存、不伪造甲方规范正文。
 */
import { vi } from "vitest";

import {
  KnowledgeGovernanceCommandV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  StartAgentTaskCommandV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeGovernanceCommandV1,
  type ModuleBranchV1,
  type ReviewTaskRefV1,
  type StartAgentTaskResultV1,
} from "@riskflow/contracts/ports";
import { makeAssessmentConfigurationFixtureSet } from "../../../core/test/assessment-config/fixture.js";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  AgentTaskDefinitionRegistry,
  buildCompletedAgentTaskResult,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import {
  AssessmentConfigurationDocumentV1Schema,
  type AssessmentConfigurationDocumentV1,
} from "@riskflow/core/assessment-config";
import type { AssessmentConfigurationGovernancePolicyV1 } from "@riskflow/core/assessment-config";
import {
  PostgresScoringRulesAdapter,
  type PostgresScoringRulesAdapterOptionsV1,
  type ScoringRulesConflictReviewLinkerV1,
} from "../../src/scoring-rules/index.js";
import { PostgresAssessmentConfigurationAdapter } from "../../src/assessment-config/index.js";
import { PostgresKnowledgeGovernanceAdapter } from "../../src/knowledge-governance/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import {
  startDataCleaningFixture,
  type CleaningWorldV1 as DataCleaningWorldLikeV1,
  type DataCleaningPostgresFixture,
  completeCleaningTask,
} from "../engineering-data/cleaning/fixture.js";
import {
  AssessmentPreparationProjectionV1Schema,
  createScoringRuleAuthoringTaskDefinition,
  type AssessmentPreparationProjectionV1,
  type AssessmentPreparationSnapshotReaderV1,
  type ScoringRulesPolicyV1,
} from "@riskflow/core/scoring-rules";

export const SCORING_RULES_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";
export const SCORING_RULES_TEST_ISSUED_AT = "2030-01-01T00:00:01.000Z";
export const SCORING_RULES_TEST_PUBLISH_AT = "2030-01-01T00:00:02.000Z";

const stubContext = (
  projectId: string,
  actorId: string,
  branch: ModuleBranchV1 | readonly ModuleBranchV1[],
  authorizationContextRef: AuthorizationContextV1["authorizationContextRef"],
  decidedAt = SCORING_RULES_TEST_TIMESTAMP,
): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef,
  actorId,
  projectId,
  grantedCapabilities: (Array.isArray(branch) ? branch : [branch]).map(
    (value) => MODULE_BRANCH_CAPABILITY_V1[value],
  ),
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt,
  invocation: { kind: "human" },
});

export interface ScoringRulesPostgresFixtureV1 {
  readonly cleaning: DataCleaningPostgresFixture;
  readonly access: LocalIdentityAccessV1;
  readonly reviewAudit: PostgresReviewAuditAdapter;
  readonly governance: PostgresKnowledgeGovernanceAdapter;
  readonly configuration: PostgresAssessmentConfigurationAdapter;
  readonly scoringRules: PostgresScoringRulesAdapter;
  readonly agentTasks: PostgresAgentTaskAdapter;
  readonly policy: ScoringRulesPolicyV1;
  setPreparationProjection(projection: AssessmentPreparationProjectionV1): void;
  putJson(input: {
    readonly projectId: string;
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly value: unknown;
    readonly branch?: ModuleBranchV1;
  }): Promise<ContentArtifactRefV1>;
  authorize(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly branch: ModuleBranchV1;
    readonly entityId: string;
  }): AuthorizationContextV1;
  /** 绑定当前测试工程：后续 C16 提交按真实 C06 会话签发治理上下文。 */
  setActiveWorld(world: DataCleaningWorldLikeV1): void;
  /** C15 真实 C06 会话签发的 evidence-access 上下文（C15 公共读取接缝要求真实上下文）。 */
  evidenceAccessAuthorization(
    world: DataCleaningWorldLikeV1,
    invocationId: string,
  ): Promise<AuthorizationContextV1>;
  /** 对既有 C16 修订执行请求审阅 → 人工批准 → 发布。 */
  approveAndPublishRevision(input: {
    readonly projectId: string;
    readonly revisionRef: KnowledgeRevisionRefV1;
  }): Promise<KnowledgeReleaseRefV1>;
  /** 通过 C16 治理提交并人工批准一份 C18 配置文档（十一类集合的逐类调用）。 */
  publishConfigurationSet(input: {
    readonly projectId: string;
    readonly documents: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  close(): Promise<void>;
}

export const startScoringRulesFixture = async (): Promise<ScoringRulesPostgresFixtureV1> => {
  const cleaning = await startDataCleaningFixture();
  const db = cleaning.runtime.db;
  const transactionUnit = cleaning.transactionUnit;
  const artifactStore: ArtifactStoreV1 = cleaning.artifactStore;
  const verifiedContexts = new Map<string, AuthorizationContextV1>();
  const contextKey = (ref: AuthorizationContextV1["authorizationContextRef"]) =>
    `${ref.reference.entityId}@${ref.reference.versionId}`;
  const access = {
    verify: vi.fn(
      async (request: {
        authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
        projectId: string;
        branch: ModuleBranchV1;
        invocationId: string;
        requestedAt?: string;
      }) => {
        const configured = verifiedContexts.get(contextKey(request.authorizationContextRef));
        const context =
          configured ??
          stubContext(
            request.projectId,
            "manager-1",
            request.branch,
            request.authorizationContextRef,
            request.requestedAt ?? SCORING_RULES_TEST_TIMESTAMP,
          );
        return { context, contextRef: request.authorizationContextRef, redacted: false };
      },
    ),
  } as unknown as LocalIdentityAccessV1;

  const now = () => new Date(SCORING_RULES_TEST_ISSUED_AT);
  const reviewAudit = new PostgresReviewAuditAdapter({
    db,
    transactionUnit,
    access,
    now,
  });
  const governanceRef: { current?: PostgresKnowledgeGovernanceAdapter } = {};
  const configurationRef: { current?: PostgresAssessmentConfigurationAdapter } = {};
  const scoringRef: { current?: PostgresScoringRulesAdapter } = {};
  const projectionRef: { current?: AssessmentPreparationProjectionV1 } = {};
  let activeWorld: DataCleaningWorldLikeV1 | undefined;

  const preparationSnapshot: AssessmentPreparationSnapshotReaderV1 = {
    readAssessmentPreparationSnapshot: async () => {
      const projection = projectionRef.current;
      if (projection === undefined) {
        throw new Error("no assessment preparation projection was configured");
      }
      return { kind: "succeeded", projection };
    },
  };

  const conflictReview: ScoringRulesConflictReviewLinkerV1 = {
    ensureConflictReviewTask: async (input) => {
      const governance = governanceRef.current;
      if (governance === undefined) throw new Error("governance adapter is not assembled");
      const relationRef = {
        kind: "rule-conflict" as const,
        reference: { entityId: `rule-relation:${input.relation.relationId}`, versionId: "1" },
      };
      const requested = await reviewAudit.requestReview({
        kind: "request-review",
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey,
        projectId: input.projectId,
        actorId: input.authorization.actorId,
        issuedAt: input.issuedAt,
        authorization: stubContext(
          input.projectId,
          input.authorization.actorId,
          ["review-audit.request-review", "review-audit.trace", "review-audit.decide-review"],
          {
            kind: "authorization-context",
            reference: { entityId: `${input.commandId}:review`, versionId: "1" },
          },
          input.issuedAt,
        ),
        payload: {
          reviewType: "rule-conflict",
          targetRef: relationRef,
          waitingRunRef: {
            kind: "workflow-run",
            reference: { entityId: `${input.commandId}:run`, versionId: "1" },
          },
          validationSnapshotRef: {
            kind: "validation-snapshot",
            reference: { entityId: `${input.relation.relationId}:validation`, versionId: "1" },
          },
          evidenceSnapshotRef: {
            kind: "evidence-snapshot",
            reference: { entityId: `${input.relation.relationId}:evidence`, versionId: "1" },
          },
          reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
        },
      } as never);
      if (requested.kind !== "succeeded") return { kind: "failed", error: requested.error };
      return {
        kind: "succeeded",
        reviewTaskRef: requested.result.reviewTaskRef,
        reviewAttemptId: input.commandId,
      };
    },
  };

  const putJson: ScoringRulesPostgresFixtureV1["putJson"] = async (input) => {
    const branch = input.branch ?? "knowledge-modeling.assessment-basis";
    const authorization = stubContext(
      input.projectId,
      "manager-1",
      branch,
      {
        kind: "authorization-context",
        reference: { entityId: `${input.artifactId}:authorization`, versionId: "1" },
      },
      SCORING_RULES_TEST_ISSUED_AT,
    );
    verifiedContexts.set(contextKey(authorization.authorizationContextRef), authorization);
    const result = await artifactStore.put(
      {
        schemaVersion: "1",
        commandId: `${input.artifactId}:put`,
        idempotencyKey: `${input.artifactId}:put`,
        projectId: input.projectId,
        actorId: "manager-1",
        issuedAt: SCORING_RULES_TEST_ISSUED_AT,
        authorization,
        requiredCapability: authorization.grantedCapabilities[0]!,
        artifactId: input.artifactId,
        artifactKind: "content",
        purposeCode: input.purposeCode,
        mediaType: input.mediaType,
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      } as never,
      (async function* () {
        yield new TextEncoder().encode(JSON.stringify(input.value));
      })(),
    );
    return result.artifactRef as ContentArtifactRefV1;
  };

  const authorize: ScoringRulesPostgresFixtureV1["authorize"] = (input) => {
    const context = stubContext(
      input.projectId,
      input.actorId,
      input.branch,
      {
        kind: "authorization-context",
        reference: { entityId: input.entityId, versionId: "1" },
      },
      SCORING_RULES_TEST_ISSUED_AT,
    );
    verifiedContexts.set(contextKey(context.authorizationContextRef), context);
    return context;
  };

  const policy: ScoringRulesPolicyV1 = {
    schemaVersion: "1",
    policyRef: { entityId: "scoring-rules-policy", versionId: "1" },
    compatibilityRef: { entityId: "compatibility-c19", versionId: "1" },
    assemblyPolicyRef: { entityId: "scoring-rule-assembly-policy", versionId: "1" },
    conflictPriorityPolicyRef: { entityId: "rule-conflict-priority", versionId: "1" },
    allowedSourceStandardKinds: ["国家规范", "行业标准", "企业规程"],
    tools: {
      standardSegmentToolRef: { entityId: "tool-standard-segment-slice", versionId: "1" },
      indicatorCatalogToolRef: { entityId: "tool-indicator-catalog-slice", versionId: "1" },
      maxSegmentsPerRead: 8,
      maxIndicatorsPerRead: 16,
    },
    agent: {
      definitionRef: { entityId: "scoring-rule-authoring-definition", versionId: "1" },
      modelDeploymentRef: { entityId: "model-deployment-c19", versionId: "1" },
      promptTemplateRef: { entityId: "prompt-template-c19", versionId: "1" },
      toolPolicyRef: { entityId: "tool-policy-c19", versionId: "1" },
      budgetPolicyRef: { entityId: "budget-policy-c19", versionId: "1" },
      incrementSchemaRef: { entityId: "increment-schema-c19", versionId: "1" },
      validationPolicyRef: { entityId: "validation-policy-c19", versionId: "1" },
      budgetPolicy: {
        schemaVersion: "1",
        policyRef: { entityId: "budget-policy-c19", versionId: "1" },
        modelDeploymentRef: { entityId: "model-deployment-c19", versionId: "1" },
        promptTemplateRef: { entityId: "prompt-template-c19", versionId: "1" },
        toolPolicyRef: { entityId: "tool-policy-c19", versionId: "1" },
        maxModelInvocations: 8,
        maxToolInvocations: 16,
        maxContextTokens: 32_768,
        maxInputBytes: 262_144,
        maxOutputBytes: 262_144,
        maxCandidates: 4,
        maxObjects: 128,
        maxSupplementarySearches: 0,
        maxCorrections: 2,
        maxTransientRetries: 1,
        maxConcurrentActions: 1,
        maxWallClockMs: 600_000,
      },
    },
  };

  const scoringRules = new PostgresScoringRulesAdapter({
    db,
    transactionUnit,
    artifactStore,
    artifactReferenceGuard: cleaning.artifactRegistry,
    access,
    taskStore: cleaning.agentTaskAdapter,
    dataCleaning: cleaning.store,
    configuration: {
      resolveConfigurationSet: (request) =>
        configurationRef.current!.resolveConfigurationSet(request),
    },
    governedReleases: {
      resolveGovernedReleases: (input) => governanceRef.current!.resolveGovernedReleases(input),
    },
    preparationSnapshot,
    submitRevision: {
      submitRevision: async (input) => {
        const governance = governanceRef.current;
        if (governance === undefined) throw new Error("governance adapter is not assembled");
        const authorization =
          activeWorld === undefined
            ? stubContext(
                input.projectId,
                input.task?.envelope.actorId ?? "manager-1",
                "knowledge-modeling.submit-revision",
                {
                  kind: "authorization-context",
                  reference: { entityId: `${input.commandId}:govern`, versionId: "1" },
                },
                input.issuedAt,
              )
            : await activeWorld.authorizeBranch(
                input.commandId,
                "knowledge-modeling.submit-revision",
              );
        verifiedContexts.set(contextKey(authorization.authorizationContextRef), authorization);
        const submitted = await governance.govern(
          KnowledgeGovernanceCommandV1Schema.parse({
            kind: "submit-revision",
            commandId: input.commandId,
            idempotencyKey: input.idempotencyKey,
            projectId: input.projectId,
            actorId: authorization.actorId,
            issuedAt: input.issuedAt,
            authorization,
            payload: {
              definitionType: input.definitionType,
              candidateArtifactRef: input.candidateArtifactRef,
              evidenceReferences: [
                {
                  locator: { sourceSegmentId: "c19-submit-evidence" },
                  sourceVersion: { entityId: "c19-source", versionId: "1" },
                },
              ],
            },
          }),
        );
        if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
          return {
            kind: "failed",
            error:
              submitted.kind === "failed"
                ? submitted.error
                : {
                    code: "TERMINAL_FAILURE" as const,
                    category: "technical" as const,
                    retryable: false as const,
                    stageCode: "c19.submit",
                    occurredAt: SCORING_RULES_TEST_ISSUED_AT,
                    causalRunId: input.commandId,
                    diagnosticRef: {
                      kind: "diagnostic-artifact" as const,
                      reference: { entityId: "c19-submit", versionId: "1" },
                    },
                  },
          };
        }
        return { kind: "succeeded", revisionRef: submitted.result.knowledgeRevisionRef };
      },
    },
    conflictReview,
    startAgentTask: async (request): Promise<StartAgentTaskResultV1> => {
      const authorization = stubContext(
        request.command.projectId,
        request.command.actorId,
        "agent-task.start-task",
        {
          kind: "authorization-context",
          reference: { entityId: `${request.command.commandId}:start`, versionId: "1" },
        },
        request.command.issuedAt,
      );
      verifiedContexts.set(contextKey(authorization.authorizationContextRef), authorization);
      const started = await scoringAgentTasksHolder.current!.startTask(
        StartAgentTaskCommandV1Schema.parse({ ...request.command, authorization }),
      );
      return started;
    },
    policy,
    now,
  } as PostgresScoringRulesAdapterOptionsV1);
  scoringRef.current = scoringRules;

  const scoringAgentTasksHolder: { current?: PostgresAgentTaskAdapter } = {};
  const agentTasks = new PostgresAgentTaskAdapter({
    db,
    registry: new AgentTaskDefinitionRegistry([
      createScoringRuleAuthoringTaskDefinition({ policy, port: scoringRules }),
    ]),
    transactionUnit,
    referenceGuard: cleaning.artifactRegistry,
    artifactStore,
    authorization: access,
    now: () => SCORING_RULES_TEST_ISSUED_AT,
  } as never);
  scoringAgentTasksHolder.current = agentTasks;

  const configuration = new PostgresAssessmentConfigurationAdapter({
    db,
    transactionUnit,
    artifactStore,
    governedReleases: {
      resolveGovernedReleases: (input) => governanceRef.current!.resolveGovernedReleases(input),
    },
    now,
  });
  configurationRef.current = configuration;

  const reviewAuthorization = (command: { projectId: string; actorId: string }) =>
    stubContext(
      command.projectId,
      command.actorId,
      ["review-audit.request-review", "review-audit.trace", "review-audit.decide-review"],
      {
        kind: "authorization-context",
        reference: { entityId: `${command.projectId}:review-authorization`, versionId: "1" },
      },
      SCORING_RULES_TEST_ISSUED_AT,
    );
  const governance = new PostgresKnowledgeGovernanceAdapter({
    db,
    transactionUnit,
    access,
    reviewAudit,
    now,
    reviewAuthorization,
    approvalAuthorization: reviewAuthorization,
    assessmentConfigurationPolicy:
      configuration as unknown as AssessmentConfigurationGovernancePolicyV1,
    scoringRulesPolicy: scoringRules,
  } as never);
  governanceRef.current = governance;

  const fixture: ScoringRulesPostgresFixtureV1 = {
    cleaning,
    access,
    reviewAudit,
    governance,
    configuration,
    scoringRules,
    agentTasks,
    policy,
    setPreparationProjection(projection) {
      projectionRef.current = AssessmentPreparationProjectionV1Schema.parse(projection);
    },
    putJson,
    authorize,
    setActiveWorld(world) {
      activeWorld = world;
    },
    evidenceAccessAuthorization: async (world, invocationId) => {
      const authorization = await world.authorizeEvidenceAccess(
        invocationId,
        world.sourceVersionRefs(),
      );
      verifiedContexts.set(contextKey(authorization.authorizationContextRef), authorization);
      return authorization;
    },
    async approveAndPublishRevision(input) {
      const revisionRef = input.revisionRef;
      const requested = await governance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "request-review",
          commandId: `${revisionRef.reference.entityId}:review`,
          idempotencyKey: `${revisionRef.reference.entityId}:review`,
          projectId: input.projectId,
          actorId: "manager-1",
          issuedAt: SCORING_RULES_TEST_ISSUED_AT,
          authorization: fixture.authorize({
            projectId: input.projectId,
            actorId: "manager-1",
            branch: "knowledge-modeling.request-review",
            entityId: `${revisionRef.reference.entityId}:review`,
          }),
          payload: { revisionRef, reviewPolicyRef: { entityId: "review-policy", versionId: "1" } },
        }),
      );
      if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
        throw new Error(`review request failed: ${JSON.stringify(requested)}`);
      }
      const decided = await reviewAudit.decideReview({
        kind: "decide-review",
        commandId: `${revisionRef.reference.entityId}:decision`,
        idempotencyKey: `${revisionRef.reference.entityId}:decision`,
        projectId: input.projectId,
        actorId: "manager-1",
        issuedAt: SCORING_RULES_TEST_ISSUED_AT,
        authorization: stubContext(
          input.projectId,
          "manager-1",
          ["review-audit.request-review", "review-audit.trace", "review-audit.decide-review"],
          {
            kind: "authorization-context",
            reference: { entityId: `${revisionRef.reference.entityId}:decide`, versionId: "1" },
          },
          SCORING_RULES_TEST_ISSUED_AT,
        ),
        payload: {
          reviewTaskRef: requested.result.reviewTaskRef,
          targetRef: requested.result.reviewTaskRef.targetRef,
          decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
          reasonCode: "client-reviewed",
        },
      } as never);
      if (decided.kind !== "succeeded") {
        throw new Error(`review decision failed: ${JSON.stringify(decided)}`);
      }
      const published = await governance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "publish-approved-release",
          commandId: `${revisionRef.reference.entityId}:publish`,
          idempotencyKey: `${revisionRef.reference.entityId}:publish`,
          projectId: input.projectId,
          actorId: "manager-1",
          issuedAt: SCORING_RULES_TEST_PUBLISH_AT,
          authorization: fixture.authorize({
            projectId: input.projectId,
            actorId: "manager-1",
            branch: "knowledge-modeling.publish-approved-release",
            entityId: `${revisionRef.reference.entityId}:publish`,
          }),
          payload: {
            revisionRef,
            reviewDecisionRef: decided.result.reviewDecisionRef,
            effectiveFrom: SCORING_RULES_TEST_PUBLISH_AT,
          },
        }),
      );
      if (published.kind !== "succeeded" || published.result.kind !== "release") {
        throw new Error(`publish failed: ${JSON.stringify(published)}`);
      }
      return published.result.knowledgeReleaseRef;
    },
    async publishConfigurationSet(input) {
      for (const definitionType of Object.keys(input.documents).sort()) {
        const artifactRef = await putJson({
          projectId: input.projectId,
          artifactId: `c19-config-${input.projectId}-${definitionType}`,
          purposeCode: "assessment-configuration",
          mediaType: "application/vnd.riskflow.assessment-configuration+json",
          value: input.documents[definitionType],
          branch: "knowledge-modeling.submit-revision",
        });
        const submitted = await governance.govern(
          KnowledgeGovernanceCommandV1Schema.parse({
            kind: "submit-revision",
            commandId: `${input.projectId}:${definitionType}:submit`,
            idempotencyKey: `${input.projectId}:${definitionType}:submit`,
            projectId: input.projectId,
            actorId: "manager-1",
            issuedAt: SCORING_RULES_TEST_ISSUED_AT,
            authorization: fixture.authorize({
              projectId: input.projectId,
              actorId: "manager-1",
              branch: "knowledge-modeling.submit-revision",
              entityId: `${input.projectId}:${definitionType}:submit`,
            }),
            payload: {
              definitionType,
              candidateArtifactRef: artifactRef,
              evidenceReferences: [
                {
                  locator: { sourceSegmentId: `${definitionType}:evidence` },
                  sourceVersion: { entityId: "c19-config-source", versionId: "1" },
                },
              ],
            },
          }),
        );
        if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
          throw new Error(`C18 submit failed for ${definitionType}: ${JSON.stringify(submitted)}`);
        }
        const revisionRef = submitted.result.knowledgeRevisionRef;
        const requested = await governance.govern(
          KnowledgeGovernanceCommandV1Schema.parse({
            kind: "request-review",
            commandId: `${revisionRef.reference.entityId}:review`,
            idempotencyKey: `${revisionRef.reference.entityId}:review`,
            projectId: input.projectId,
            actorId: "manager-1",
            issuedAt: SCORING_RULES_TEST_ISSUED_AT,
            authorization: fixture.authorize({
              projectId: input.projectId,
              actorId: "manager-1",
              branch: "knowledge-modeling.request-review",
              entityId: `${revisionRef.reference.entityId}:review`,
            }),
            payload: {
              revisionRef,
              reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
            },
          }),
        );
        if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
          throw new Error(`C18 request-review failed for ${definitionType}`);
        }
        const decided = await reviewAudit.decideReview({
          kind: "decide-review",
          commandId: `${revisionRef.reference.entityId}:decision`,
          idempotencyKey: `${revisionRef.reference.entityId}:decision`,
          projectId: input.projectId,
          actorId: "manager-1",
          issuedAt: SCORING_RULES_TEST_ISSUED_AT,
          authorization: stubContext(
            input.projectId,
            "manager-1",
            "review-audit.decide-review",
            {
              kind: "authorization-context",
              reference: { entityId: `${revisionRef.reference.entityId}:decide`, versionId: "1" },
            },
            SCORING_RULES_TEST_ISSUED_AT,
          ),
          payload: {
            reviewTaskRef: requested.result.reviewTaskRef,
            targetRef: requested.result.reviewTaskRef.targetRef,
            decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
            reasonCode: "client-reviewed",
          },
        } as never);
        if (decided.kind !== "succeeded") {
          throw new Error(`C18 decision failed for ${definitionType}: ${JSON.stringify(decided)}`);
        }
        const published = await governance.govern(
          KnowledgeGovernanceCommandV1Schema.parse({
            kind: "publish-approved-release",
            commandId: `${revisionRef.reference.entityId}:publish`,
            idempotencyKey: `${revisionRef.reference.entityId}:publish`,
            projectId: input.projectId,
            actorId: "manager-1",
            issuedAt: SCORING_RULES_TEST_PUBLISH_AT,
            authorization: fixture.authorize({
              projectId: input.projectId,
              actorId: "manager-1",
              branch: "knowledge-modeling.publish-approved-release",
              entityId: `${revisionRef.reference.entityId}:publish`,
            }),
            payload: {
              revisionRef,
              reviewDecisionRef: decided.result.reviewDecisionRef,
              effectiveFrom: SCORING_RULES_TEST_PUBLISH_AT,
            },
          }),
        );
        if (published.kind !== "succeeded" || published.result.kind !== "release") {
          throw new Error(`C18 publish failed for ${definitionType}: ${JSON.stringify(published)}`);
        }
      }
    },
    async close() {
      await cleaning.close();
    },
  };
  return fixture;
};

export {
  completeCleaningTask,
  buildCompletedAgentTaskResult,
  makeAssessmentConfigurationFixtureSet,
};
export type { AgentTaskSnapshotV1, AssessmentConfigurationDocumentV1, ReviewTaskRefV1 };
export { AssessmentConfigurationDocumentV1Schema };
export type { KnowledgeGovernanceCommandV1 };
