import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  KnowledgeGovernanceCommandV1Schema,
  ReviewTaskRefV1Schema,
  RuleConflictRefV1Schema,
  type AgentTaskRefV1,
  type AssessmentBasisReleaseSetRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ReviewTaskRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import type { StructuredScoringRule } from "@riskflow/contracts/records";
import type { AgentTaskSnapshotV1 } from "@riskflow/core/agent-runtime";
import { AccessServiceError } from "@riskflow/core/access";
import {
  evaluateScoringRule,
  type AssembleApplicableRuleSetV1,
} from "@riskflow/core/scoring-rules";
import {
  GB50911_CLAUSES,
  GB50911_SOFT_SOIL_BANDS,
  GB50911_STIFF_SOIL_BANDS,
  gb50911GradeIntervals,
  gb50911ScoringThresholds,
} from "../../../core/test/scoring-rules/standard-fixture.js";
import {
  completeCleaningTask,
  makeAssessmentConfigurationFixtureSet,
  realStandardCleaningDocument,
  SCORING_RULES_TEST_ISSUED_AT,
  startScoringRulesFixture,
  type ScoringRulesPostgresFixtureV1,
} from "./fixture.js";
import {
  freezeIdentificationPreparation,
  type CleaningWorldV1,
  type DataCleaningPostgresFixture,
} from "../engineering-data/cleaning/fixture.js";

const authoringActor = "manager-1";
const CHAIN_APPLICABILITY = {
  constructionMethod: "盾构法",
  stratumCondition: "软土地层",
  engineeringStage: "盾构掘进",
} as const;
const RULE_AUTHORING_AT = "2030-01-01T00:00:03.000Z";
/** 规则发布生效时刻必须不晚于后续编制/解析时刻，使下一次修订能解析到该精确基线。 */
const RULE_PUBLISH_AT = SCORING_RULES_TEST_ISSUED_AT;

/** 一个工程世界的 C19 前置事实：真实规范清洗结果 + 已发布 C18 配置集合。 */
interface ProjectWorldV1 {
  readonly projectId: string;
  readonly world: CleaningWorldV1;
  readonly cleaning: DataCleaningPostgresFixture;
  readonly taskRef: AgentTaskRefV1;
  readonly configurationSetRef: VersionReference;
  readonly indicatorIds: readonly string[];
}

/** C19 编制交接：C15 reader 与 manifest 冻结的精确引用。 */
interface RuleAuthoringHandoffV1 {
  readonly task: AgentTaskSnapshotV1;
  readonly retainedSourceVersionRef: SourceVersionRefV1;
  readonly sourceSegmentIds: readonly string[];
  readonly cleaningResultArtifactRef: ContentArtifactRefV1;
  readonly dataCleaningTaskRef: AgentTaskRefV1;
}

interface RuleCandidateRuleV1 {
  readonly ruleId: string;
  readonly indicatorItem: string;
  readonly scoringThresholds: readonly unknown[];
  readonly gradeIntervals: readonly unknown[];
  readonly stratumCondition?: string;
  readonly evidenceSegmentId?: string;
}

describe.sequential("C19 PostgreSQL 结构化评分规则与适用规则集", () => {
  let fixture: ScoringRulesPostgresFixtureV1 | undefined;
  /** 真实规范主链产物：后续 basis 读取、权限与幂等用例复用同一次发布事实。 */
  let chain:
    | {
        readonly projectId: string;
        readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
        readonly setRevisionRef: KnowledgeRevisionRefV1;
        readonly prepareRequest: AssembleApplicableRuleSetV1;
      }
    | undefined;
  /** 冲突生命周期世界：未决 → 批准 → 发布 → 新修订（过期决定）。 */
  let conflict:
    | (ProjectWorldV1 & {
        readonly ruleRevisionRef: KnowledgeRevisionRefV1;
        readonly relationId: string;
      })
    | undefined;

  const requireFixture = (): ScoringRulesPostgresFixtureV1 => {
    if (fixture === undefined) throw new Error("scoring rules fixture is not started");
    return fixture;
  };

  const adminPool = () => requireFixture().cleaning.postgres.adminPool;

  const countRows = async (sql: string, values: readonly unknown[]): Promise<number> => {
    const result = await adminPool().query<{ count: string }>(sql, values as never);
    return Number(result.rows[0]!.count);
  };

  const relationRows = async (projectId: string) =>
    (
      await adminPool().query<{
        relation_id: string;
        relation_kind: string;
        revision_id: string;
        left_rule_id: string;
        right_rule_id: string;
        overlap_digest: string;
        retained_rule_id: string | null;
        excluded_rule_id: string | null;
      }>(
        `SELECT relation_id, relation_kind, revision_id, left_rule_id, right_rule_id, overlap_digest,
                retained_rule_id, excluded_rule_id
           FROM business.rule_relations WHERE project_id = $1 ORDER BY relation_id`,
        [projectId],
      )
    ).rows;

  const reviewLinkRows = async (projectId: string) =>
    (
      await adminPool().query<{
        relation_id: string;
        review_task_ref: unknown;
        review_attempt_id: string;
      }>(
        `SELECT relation_id, review_task_ref, review_attempt_id
           FROM business.rule_conflict_review_links WHERE project_id = $1 ORDER BY link_id`,
        [projectId],
      )
    ).rows;

  /** C15 真实清洗链路 + C18 配置发布：每个工程一套前置事实。 */
  const startProjectWorld = async (suffix: string): Promise<ProjectWorldV1> => {
    const { cleaning } = requireFixture();
    const world = await cleaning.createWorld({
      suffix,
      documentKinds: ["docx"],
      documents: [realStandardCleaningDocument()],
    });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `${suffix}-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: `${suffix}-worker`,
      projectId: world.projectId,
    });
    requireFixture().setActiveWorld(world);
    const configurationSet = makeAssessmentConfigurationFixtureSet({
      projectId: world.projectId,
      projectRevisionRef: world.projectRevisionRef,
      configurationSetRef: { entityId: `configuration-set-${world.projectId}`, versionId: "1" },
    });
    await requireFixture().publishConfigurationSet({
      projectId: world.projectId,
      documents: configurationSet.documents,
    });
    const indicators = (
      configurationSet.documents["indicator-system"] as unknown as {
        readonly content: { readonly indicators: readonly { readonly indicatorId: string }[] };
      }
    ).content.indicators;
    return {
      projectId: world.projectId,
      world,
      cleaning,
      taskRef: completion.taskRef,
      configurationSetRef: configurationSet.configurationSetRef,
      indicatorIds: indicators.map((indicator) => indicator.indicatorId),
    };
  };

  /** 走真实 C19 编制入口：C15 reader → manifest → C08 task。 */
  const startRuleAuthoring = async (input: {
    readonly project: ProjectWorldV1;
    readonly requestId: string;
    readonly baseRuleReleaseRef?: KnowledgeReleaseRefV1;
  }): Promise<RuleAuthoringHandoffV1> => {
    const { world } = input.project;
    const prepared = await requireFixture().scoringRules.prepareAuthoring({
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: RULE_AUTHORING_AT,
      authorization: await world.authorizeBranch(
        input.requestId,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await requireFixture().evidenceAccessAuthorization(
        world,
        input.requestId,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: input.project.taskRef,
      requiredAt: RULE_AUTHORING_AT,
      asOfRecordedAt: RULE_AUTHORING_AT,
      scoringPolicyRef: requireFixture().policy.policyRef,
      sourceStandardKinds: ["国家规范"],
      ...(input.baseRuleReleaseRef === undefined
        ? {}
        : { baseRuleReleaseRef: input.baseRuleReleaseRef }),
    });
    if (prepared.kind !== "succeeded") {
      throw new Error(`prepareAuthoring failed: ${JSON.stringify(prepared).slice(0, 600)}`);
    }
    const task = await requireFixture().agentTasks.getTask(prepared.agentTaskRef);
    if (task === undefined) throw new Error("authoring task was not persisted");
    const { manifest } = await requireFixture().scoringRules.loadAuthoringManifest(task);
    return {
      task,
      retainedSourceVersionRef: manifest.retainedSourceSegments[0]!.sourceVersionRef,
      sourceSegmentIds: manifest.retainedSourceSegments[0]!.sourceSegmentIds,
      cleaningResultArtifactRef: manifest.cleaningResultArtifactRef,
      dataCleaningTaskRef: manifest.dataCleaningTaskRef,
    };
  };

  const ruleOperation = (handoff: RuleAuthoringHandoffV1, rule: RuleCandidateRuleV1) => {
    const segmentId = rule.evidenceSegmentId ?? handoff.sourceSegmentIds[0]!;
    return {
      kind: "add-rule" as const,
      ruleId: rule.ruleId,
      rule: {
        ruleId: rule.ruleId,
        applicabilityConditions: {
          constructionMethod: [CHAIN_APPLICABILITY.constructionMethod],
          stratumCondition: [rule.stratumCondition ?? CHAIN_APPLICABILITY.stratumCondition],
          engineeringStage: [CHAIN_APPLICABILITY.engineeringStage],
        },
        indicatorItem: rule.indicatorItem,
        scoringThresholds: rule.scoringThresholds,
        gradeIntervals: rule.gradeIntervals,
        exceptionClauses: [],
        evidenceLocator: { sourceSegmentId: segmentId },
        ruleVersion: { entityId: rule.ruleId, versionId: "pending" },
        reviewStatus: "pending" as const,
      },
      sourceVersionRef: handoff.retainedSourceVersionRef,
      evidenceReferences: [
        {
          locator: { sourceSegmentId: segmentId },
          sourceVersion: handoff.retainedSourceVersionRef.reference,
        },
      ],
    };
  };

  /** 候选内冲突规则：同一指标、同一三维域、同一取值域但结论不同。 */
  const conflictingRule = (
    handoff: RuleAuthoringHandoffV1,
    input: {
      readonly ruleId: string;
      readonly indicatorItem: string;
      readonly score: number;
    },
  ) =>
    ruleOperation(handoff, {
      ruleId: input.ruleId,
      indicatorItem: input.indicatorItem,
      scoringThresholds: [
        {
          thresholdId: `${input.ruleId}-t`,
          score: input.score,
          operator: "between",
          value: 15,
          upperValue: 25,
        },
      ],
      gradeIntervals: [{ grade: `grade-${input.ruleId}`, lowerBound: 15 }],
    });

  const finalizeRuleCandidate = async (input: {
    readonly handoff: RuleAuthoringHandoffV1;
    readonly operations: readonly unknown[];
  }): Promise<KnowledgeRevisionRefV1> => {
    const finalized = await requireFixture().scoringRules.finalizeAuthoringCandidate({
      task: input.handoff.task,
      candidate: {
        schemaVersion: "1" as const,
        candidateVersion: 1,
        operations: input.operations,
      } as never,
    });
    expect(finalized.status).toBe("completed");
    if (
      finalized.status !== "completed" ||
      !("candidateRef" in finalized) ||
      finalized.candidateRef === undefined
    ) {
      throw new Error("finalize did not return a candidate revision");
    }
    return finalized.candidateRef;
  };

  const requestRuleReview = (input: {
    readonly projectId: string;
    readonly revisionRef: KnowledgeRevisionRefV1;
  }) =>
    requireFixture().governance.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "request-review",
        commandId: `${input.revisionRef.reference.entityId}:review`,
        idempotencyKey: `${input.revisionRef.reference.entityId}:review`,
        projectId: input.projectId,
        actorId: authoringActor,
        issuedAt: SCORING_RULES_TEST_ISSUED_AT,
        authorization: requireFixture().authorize({
          projectId: input.projectId,
          actorId: authoringActor,
          branch: "knowledge-modeling.request-review",
          entityId: `${input.revisionRef.reference.entityId}:review`,
        }),
        payload: {
          revisionRef: input.revisionRef,
          reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
        },
      }),
    );

  const decideRuleRevision = (input: {
    readonly projectId: string;
    readonly reviewTaskRef: ReviewTaskRefV1;
  }) =>
    requireFixture().reviewAudit.decideReview({
      kind: "decide-review",
      commandId: `${input.reviewTaskRef.reference.entityId}:decision`,
      idempotencyKey: `${input.reviewTaskRef.reference.entityId}:decision`,
      projectId: input.projectId,
      actorId: authoringActor,
      issuedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: requireFixture().authorize({
        projectId: input.projectId,
        actorId: authoringActor,
        branch: "review-audit.decide-review",
        entityId: `${input.reviewTaskRef.reference.entityId}:decision`,
      }),
      payload: {
        reviewTaskRef: input.reviewTaskRef,
        targetRef: input.reviewTaskRef.targetRef,
        decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
        reasonCode: "client-reviewed",
      },
    } as never);

  const publishRuleRevision = (input: {
    readonly projectId: string;
    readonly revisionRef: KnowledgeRevisionRefV1;
    readonly reviewDecisionRef: unknown;
  }) =>
    requireFixture().governance.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "publish-approved-release",
        commandId: `${input.revisionRef.reference.entityId}:publish`,
        idempotencyKey: `${input.revisionRef.reference.entityId}:publish`,
        projectId: input.projectId,
        actorId: authoringActor,
        issuedAt: RULE_PUBLISH_AT,
        authorization: requireFixture().authorize({
          projectId: input.projectId,
          actorId: authoringActor,
          branch: "knowledge-modeling.publish-approved-release",
          entityId: `${input.revisionRef.reference.entityId}:publish`,
        }),
        payload: {
          revisionRef: input.revisionRef,
          reviewDecisionRef: input.reviewDecisionRef,
          effectiveFrom: RULE_PUBLISH_AT,
        },
      }),
    );

  /** 请求审阅 → 人工批准知识修订（冲突门禁必须先放行）。 */
  const approveRuleRevision = async (input: {
    readonly projectId: string;
    readonly revisionRef: KnowledgeRevisionRefV1;
  }): Promise<unknown> => {
    const requested = await requestRuleReview(input);
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      throw new Error(`review request failed: ${JSON.stringify(requested).slice(0, 600)}`);
    }
    const decided = await decideRuleRevision({
      projectId: input.projectId,
      reviewTaskRef: requested.result.reviewTaskRef,
    });
    if (decided.kind !== "succeeded") {
      throw new Error(`review decision failed: ${JSON.stringify(decided).slice(0, 600)}`);
    }
    return decided.result.reviewDecisionRef;
  };

  const approvedRuleReleaseRef = async (projectId: string): Promise<KnowledgeReleaseRefV1> => {
    const rows = await adminPool().query<{
      release_id: string;
      version_id: string;
      revision_id: string;
    }>(
      `SELECT release_id, version_id, revision_id FROM business.knowledge_releases
        WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'
        ORDER BY recorded_at DESC LIMIT 1`,
      [projectId],
    );
    const row = rows.rows[0];
    if (row === undefined) throw new Error("no structured scoring rule release was published");
    return {
      kind: "knowledge-release",
      reference: { entityId: row.release_id, versionId: row.version_id },
    };
  };

  const basisReadInput = (input: {
    readonly requestId: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
  }) => ({
    requestId: input.requestId,
    idempotencyKey: input.requestId,
    requestedAt: SCORING_RULES_TEST_ISSUED_AT,
    authorization: input.authorization,
    assessmentBasisReleaseSetRef: input.assessmentBasisReleaseSetRef,
  });

  const basisAuthorization = (projectId: string, entityId: string): AuthorizationContextV1 =>
    requireFixture().authorize({
      projectId,
      actorId: authoringActor,
      branch: "knowledge-modeling.assessment-basis",
      entityId,
    });

  /** 真实条文段定位：按标题段找到紧随其后的正文段。 */
  const clauseSegmentOf = (
    document: { readonly segments: readonly unknown[] },
    clauseNumber: string,
  ) => {
    const clause = GB50911_CLAUSES.find((entry) => entry.clauseNumber === clauseNumber)!;
    const heading = `${clause.clauseNumber} ${clause.kind}（PDF 第 ${clause.pdfPage} 页）`;
    const segments = document.segments as readonly {
      readonly sourceSegmentId: string;
      readonly textBlockIds: readonly string[];
      readonly locator: { readonly kind: string; readonly headingPath?: readonly string[] };
    }[];
    const index = segments.findIndex((segment) => segment.locator.headingPath?.includes(heading));
    expect(index).toBeGreaterThanOrEqual(0);
    return segments[index + 1]!;
  };

  beforeAll(async () => {
    fixture = await startScoringRulesFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 180_000);

  it("创建 C19 五张只追加表并限制应用角色写权限", async () => {
    const tables = await adminPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'business' AND table_name IN (
          'scoring_rule_revision_metadata', 'rule_relations', 'rule_conflict_review_links',
          'applicable_rule_set_revision_metadata', 'assessment_basis_release_sets')
        ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "applicable_rule_set_revision_metadata",
      "assessment_basis_release_sets",
      "rule_conflict_review_links",
      "rule_relations",
      "scoring_rule_revision_metadata",
    ]);

    // 决定状态不再复制到 C19 表：只能从 C07 决定事实推导。
    const columns = await adminPool().query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'business'
          AND table_name IN ('rule_relations', 'rule_conflict_review_links')
        ORDER BY table_name, column_name`,
    );
    const columnNames = columns.rows.map((row) => row.column_name);
    expect(columnNames).not.toContain("status");
    expect(columnNames).not.toContain("decision_ref");

    const appPool = new Pool(requireFixture().cleaning.postgres.app);
    try {
      await expect(
        appPool.query("SELECT count(*) FROM business.scoring_rule_revision_metadata"),
      ).resolves.toBeDefined();
      await expect(
        appPool.query("UPDATE business.rule_relations SET relation_kind = relation_kind"),
      ).rejects.toBeDefined();
      await expect(appPool.query("DELETE FROM business.rule_relations")).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
  }, 180_000);

  it("来源门禁：C15 未完成或未授权时在模型调用前拒绝且不产生候选", async () => {
    const before = requireFixture().cleaning.recordedStartCommands.length;
    const denied = await requireFixture().scoringRules.prepareAuthoring({
      requestId: "c19-source-gate",
      idempotencyKey: "c19-source-gate",
      projectId: "project-c19-missing",
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: requireFixture().authorize({
        projectId: "project-c19-missing",
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: "c19-source-gate",
      }),
      dataCleaningAuthorization: requireFixture().authorize({
        projectId: "project-c19-missing",
        actorId: authoringActor,
        branch: "engineering-data.evidence-access",
        entityId: "c19-source-gate-c15",
      }),
      projectRevisionRef: {
        kind: "project-revision",
        reference: { entityId: "missing", versionId: "1" },
      },
      dataCleaningTaskRef: {
        kind: "agent-task",
        reference: { entityId: "missing-cleaning-task", versionId: "1" },
        taskType: "data-cleaning",
        triggerMode: "embedded",
        modelDeploymentRef: { entityId: "model", versionId: "1" },
        promptTemplateRef: { entityId: "prompt", versionId: "1" },
        toolPolicyRef: { entityId: "tool", versionId: "1" },
        budgetPolicyRef: { entityId: "budget", versionId: "1" },
        incrementSchemaRef: { entityId: "increment", versionId: "1" },
        validationPolicyRef: { entityId: "validation", versionId: "1" },
      },
      requiredAt: SCORING_RULES_TEST_ISSUED_AT,
      asOfRecordedAt: SCORING_RULES_TEST_ISSUED_AT,
      scoringPolicyRef: requireFixture().policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });
    expect(denied.kind).toBe("failed");
    expect(requireFixture().cleaning.recordedStartCommands.length).toBe(before);
    if (denied.kind === "failed") {
      expect(denied.error.code).toBe("AUTHORIZATION_DENIED");
    }
  }, 180_000);

  it("真实规范：GB 50911-2013 条文段经 C15→C19→C16/C07 形成 RA-S3/S4 适用规则集与公共 assessment-basis（basis 成员读取、basis 运行时边界、basis 历史成功完整性、basis 冻结集合、basis 瞬时失败）", async () => {
    const project = await startProjectWorld("c19-real-standard");
    const { cleaning, world } = project;
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-real-standard-authoring-${world.projectId}`,
    });
    expect(handoff.sourceSegmentIds.length).toBeGreaterThan(0);

    const frozen = await cleaning.store.loadFrozenInput(
      (await cleaning.agentTaskAdapter.getTask(project.taskRef))!,
    );
    const document = frozen.documents.find(
      (entry) =>
        entry.sourceVersionRef.reference.entityId ===
        handoff.retainedSourceVersionRef.reference.entityId,
    )!;
    const settlementSegment = clauseSegmentOf(document, "9.2.2");
    const controlValueTable = (document.segments as readonly { kind: string }[]).find(
      (segment) => segment.kind === "table",
    )!;
    expect(handoff.sourceSegmentIds).toContain(settlementSegment.sourceSegmentId);
    expect(handoff.sourceSegmentIds).toContain(controlValueTable.sourceSegmentId);

    const observation = await requireFixture().scoringRules.readStandardSegmentSlice(
      {
        kind: "read-standard-segment-slice",
        sourceVersionRef: handoff.retainedSourceVersionRef,
        sourceSegmentIds: [settlementSegment.sourceSegmentId],
      },
      {
        task: handoff.task,
        taskRef: handoff.task.envelope.agentTaskRef,
        actionId: `${handoff.task.envelope.agentTaskRef.reference.entityId}:segments`,
      },
    );
    expect(observation.effect).toBe("none");
    const observationBody = (await cleaning.readArtifact(
      observation.observationArtifactRef,
      handoff.task.envelope.authorization,
      "knowledge-modeling.standard-segment-observation",
    )) as {
      readonly segments: readonly {
        readonly sourceSegmentId: string;
        readonly locator: { readonly kind: string; readonly headingPath?: readonly string[] };
      }[];
    };
    expect(
      observationBody.segments
        .find((segment) => segment.sourceSegmentId === settlementSegment.sourceSegmentId)!
        .locator.headingPath?.join(" "),
    ).toContain("9.2.2");

    // 表 9.2.2-2：中软~软弱土 15~25/25~35/35~45mm（3/4/5mm·d⁻¹）；坚硬~中硬土行留给三维筛除。
    const softSoilRuleId = "rule-gb50911-2013-table-9.2.2-2-soft-soil";
    const stiffSoilRuleId = "rule-gb50911-2013-table-9.2.2-2-stiff-soil";
    const operations = [
      ruleOperation(handoff, {
        ruleId: softSoilRuleId,
        indicatorItem: project.indicatorIds[0]!,
        scoringThresholds: gb50911ScoringThresholds(GB50911_SOFT_SOIL_BANDS),
        gradeIntervals: gb50911GradeIntervals(GB50911_SOFT_SOIL_BANDS),
        evidenceSegmentId: settlementSegment.sourceSegmentId,
      }),
      ruleOperation(handoff, {
        ruleId: stiffSoilRuleId,
        indicatorItem: project.indicatorIds[0]!,
        scoringThresholds: gb50911ScoringThresholds(GB50911_STIFF_SOIL_BANDS),
        gradeIntervals: gb50911GradeIntervals(GB50911_STIFF_SOIL_BANDS),
        stratumCondition: "坚硬~中硬土",
        evidenceSegmentId: settlementSegment.sourceSegmentId,
      }),
    ];
    const validation = await requireFixture().scoringRules.validateAuthoringCandidate({
      task: handoff.task,
      candidate: { schemaVersion: "1", candidateVersion: 1, operations } as never,
    });
    expect(validation.validationArtifactRef).toBeDefined();

    const ruleRevisionRef = await finalizeRuleCandidate({ handoff, operations });
    // 无相交三维域：真实规范主链不产生关系事实，也不创建 C07 冲突任务。
    expect(await relationRows(world.projectId)).toHaveLength(0);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.review_tasks
          WHERE project_id = $1 AND review_type = 'rule-conflict'`,
        [world.projectId],
      ),
    ).toBe(0);

    const ruleReleaseRef = await requireFixture().approveAndPublishRevision({
      projectId: world.projectId,
      revisionRef: ruleRevisionRef,
    });
    expect(ruleReleaseRef.kind).toBe("knowledge-release");

    const preparationSnapshotRef = {
      kind: "assessment-preparation-snapshot" as const,
      reference: { entityId: `preparation-${world.projectId}`, versionId: "1" },
    };
    requireFixture().setPreparationProjection({
      schemaVersion: "1",
      preparationSnapshotRef,
      projectId: world.projectId,
      projectRevisionRef: world.projectRevisionRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: { ...CHAIN_APPLICABILITY },
      cleaningResultArtifactRef: handoff.cleaningResultArtifactRef,
      dataCleaningTaskRef: project.taskRef,
      configurationSetRef: project.configurationSetRef,
      compatibilityRef: requireFixture().policy.compatibilityRef,
      requiredAt: RULE_AUTHORING_AT,
      asOfRecordedAt: RULE_AUTHORING_AT,
    });

    const assemblyRequest = {
      requestId: `c19-real-standard-assembly-${world.projectId}`,
      idempotencyKey: `c19-real-standard-assembly-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: RULE_AUTHORING_AT,
      authorization: await world.authorizeBranch(
        `c19-real-standard-assembly-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      projectRevisionRef: world.projectRevisionRef,
      preparationSnapshotRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: { ...CHAIN_APPLICABILITY },
      requiredAt: RULE_AUTHORING_AT,
      asOfRecordedAt: RULE_AUTHORING_AT,
      scoringPolicyRef: requireFixture().policy.policyRef,
      assemblyPolicyRef: requireFixture().policy.assemblyPolicyRef,
      compatibilityRef: requireFixture().policy.compatibilityRef,
      configurationSetRef: project.configurationSetRef,
    };
    const assembled =
      await requireFixture().scoringRules.assembleApplicableRuleSetRevision(assemblyRequest);
    if (assembled.kind !== "succeeded") {
      throw new Error(
        `assembleApplicableRuleSetRevision failed: ${JSON.stringify(assembled).slice(0, 600)}`,
      );
    }
    // 组装只消费已闭合事实：不新增关系事实、不创建 C07 任务。
    expect(await relationRows(world.projectId)).toHaveLength(0);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.review_tasks
          WHERE project_id = $1 AND review_type = 'rule-conflict'`,
        [world.projectId],
      ),
    ).toBe(0);

    const setDocument = (await cleaning.readArtifact(
      assembled.applicableRuleSetArtifactRef,
      assemblyRequest.authorization,
      "knowledge-modeling.applicable-rule-set",
    )) as {
      readonly decisions: readonly { readonly ruleId: string; readonly reasonCode: string }[];
      readonly includedMembers: readonly { readonly ruleId: string }[];
    };
    expect(
      setDocument.decisions.find((decision) => decision.ruleId === softSoilRuleId)?.reasonCode,
    ).toBe("three-dimensional-match");
    expect(
      setDocument.decisions.find((decision) => decision.ruleId === stiffSoilRuleId)?.reasonCode,
    ).toBe("stratum-condition-mismatch");
    expect(setDocument.includedMembers.map((member) => member.ruleId)).toEqual([softSoilRuleId]);

    const setRevisionRef = assembled.applicableRuleSetRevisionRef;
    const setReleaseRef = await requireFixture().approveAndPublishRevision({
      projectId: world.projectId,
      revisionRef: setRevisionRef,
    });
    expect(setReleaseRef.kind).toBe("knowledge-release");

    const resolution = await requireFixture().scoringRules.resolve({
      kind: "assessment-basis",
      commandId: `c19-real-standard-resolve-${world.projectId}`,
      idempotencyKey: `c19-real-standard-resolve-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      issuedAt: RULE_AUTHORING_AT,
      authorization: await world.authorizeBranch(
        `c19-real-standard-resolve-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      branch: "knowledge-modeling.assessment-basis",
      payload: { preparationSnapshotRef, requiredAt: RULE_AUTHORING_AT },
    } as never);
    if (resolution.kind !== "succeeded") {
      throw new Error(`resolve failed: ${JSON.stringify(resolution).slice(0, 600)}`);
    }
    const basisReleaseSetRef = (
      resolution as unknown as {
        result: { assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1 };
      }
    ).result.assessmentBasisReleaseSetRef;

    const basisRead = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: `c19-real-standard-basis-read-${world.projectId}`,
        authorization: basisAuthorization(
          world.projectId,
          `c19-real-standard-basis-read-${world.projectId}`,
        ),
        assessmentBasisReleaseSetRef: basisReleaseSetRef,
      }),
    );
    if (basisRead.kind !== "succeeded") {
      throw new Error(`basis member read failed: ${JSON.stringify(basisRead).slice(0, 600)}`);
    }
    expect(basisRead.configurationMembers).toHaveLength(11);
    expect(basisRead.scoringRuleMembers).toHaveLength(1);
    expect(basisRead.applicableRuleSetMember.releaseRef).toEqual(setReleaseRef);
    expect(basisRead.memberDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(basisRead)).not.toContain("盾构法隧道地表沉降控制值");

    // 已发布规则正文按真实控制值复算：等级边界与强制性条文档位一致。
    const ruleMember = basisRead.scoringRuleMembers[0]!;
    const ruleDocument = (await cleaning.readArtifact(
      ruleMember.artifactRef,
      assemblyRequest.authorization,
      "knowledge-modeling.structured-scoring-rule",
    )) as {
      readonly members: readonly { readonly rule: StructuredScoringRule }[];
    };
    const publishedRule = ruleDocument.members.find(
      (member) => member.rule.ruleId === softSoilRuleId,
    )!.rule;
    expect(publishedRule.evidenceLocator.sourceSegmentId).toBe(settlementSegment.sourceSegmentId);
    expect(
      [15, 25, 35, 45].map((value) => {
        const result = evaluateScoringRule(publishedRule, value);
        return result.kind === "evaluated" ? [result.score, result.grade] : result.kind;
      }),
    ).toEqual([
      [1, "gb50911-monitoring-grade-1"],
      [2, "gb50911-monitoring-grade-2"],
      [3, "gb50911-monitoring-grade-3"],
      [5, "gb50911-control-limit-exceeded"],
    ]);
    expect(evaluateScoringRule(publishedRule, 14.9)).toEqual({
      kind: "rejected",
      reasonCode: "scoring-value-out-of-range",
    });
    chain = {
      projectId: world.projectId,
      basisReleaseSetRef,
      setRevisionRef,
      prepareRequest: assemblyRequest,
    };
  }, 300_000);

  it("C15 结果读取接缝：C19 只经注入 reader 消费同一 result/artifact", async () => {
    const project = await startProjectWorld("c19-reader-seam");
    const { cleaning } = project;
    // 透传 spy：既统计 C19 的读取次数，也捕获注入 reader 返回的 result/artifact。
    const captured: { value?: { readonly resultArtifactRef: unknown } } = {};
    const realRead = cleaning.store.readBoundResult.bind(cleaning.store);
    const reader = vi
      .spyOn(cleaning.store, "readBoundResult")
      .mockImplementation(async (input: never) => {
        const value = await realRead(input);
        captured.value = value as never;
        return value as never;
      });
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-reader-seam-authoring-${project.world.projectId}`,
    });
    expect(reader).toHaveBeenCalledTimes(1);
    const readerInput = reader.mock.calls[0]![0] as unknown as {
      readonly projectId: string;
      readonly taskRef: { readonly reference: { readonly entityId: string } };
    };
    expect(readerInput.projectId).toBe(project.world.projectId);
    expect(readerInput.taskRef.reference.entityId).toBe(project.taskRef.reference.entityId);
    expect(handoff.dataCleaningTaskRef.reference).toEqual(project.taskRef.reference);
    expect(handoff.cleaningResultArtifactRef).toEqual(captured.value?.resultArtifactRef);
    reader.mockRestore();
  }, 300_000);

  it("重叠事实去重：同一规则对只持久化一个带闭合处置的关系事实", async () => {
    const project = await startProjectWorld("c19-overlap-dedup");
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-overlap-dedup-authoring-${project.projectId}`,
    });
    const sameConclusionRule = (ruleId: string) =>
      ruleOperation(handoff, {
        ruleId,
        indicatorItem: project.indicatorIds[0]!,
        scoringThresholds: [
          { thresholdId: `${ruleId}-t`, score: 3, operator: "between", value: 15, upperValue: 25 },
        ],
        gradeIntervals: [{ grade: "grade-shared", lowerBound: 15 }],
      });
    const revisionRef = await finalizeRuleCandidate({
      handoff,
      operations: [
        sameConclusionRule("rule-c19-overlap-a"),
        sameConclusionRule("rule-c19-overlap-b"),
      ],
    });

    const relations = await relationRows(project.projectId);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      relation_kind: "overlap",
      revision_id: revisionRef.reference.entityId,
      retained_rule_id: "rule-c19-overlap-a",
      excluded_rule_id: "rule-c19-overlap-b",
    });
    expect(await reviewLinkRows(project.projectId)).toHaveLength(0);
  }, 300_000);

  it("关系碰撞回滚：关系唯一性失败不留下修订、元数据、关系、审计或回执", async () => {
    const project = await startProjectWorld("c19-relation-collision");
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-relation-collision-authoring-${project.projectId}`,
    });
    const counts = () =>
      Promise.all([
        countRows(
          `SELECT count(*)::text AS count FROM business.knowledge_revisions
            WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
          [project.projectId],
        ),
        countRows(
          `SELECT count(*)::text AS count FROM business.scoring_rule_revision_metadata
            WHERE project_id = $1`,
          [project.projectId],
        ),
        countRows(
          `SELECT count(*)::text AS count FROM business.rule_relations WHERE project_id = $1`,
          [project.projectId],
        ),
        countRows(
          `SELECT count(*)::text AS count FROM audit.entries
            WHERE project_id = $1 AND action = 'knowledge.submit-revision'`,
          [project.projectId],
        ),
        countRows(
          `SELECT count(*)::text AS count FROM business.command_receipts
            WHERE project_id = $1 AND command_kind = 'knowledge.submit-revision.v1'`,
          [project.projectId],
        ),
      ]);
    const before = await counts();
    await adminPool().query(`
      CREATE OR REPLACE FUNCTION business.c19_test_relation_collision() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE unique_violation USING MESSAGE = 'c19 relation collision'; END; $$;
      CREATE TRIGGER c19_test_relation_collision
      BEFORE INSERT ON business.rule_relations
      FOR EACH ROW EXECUTE FUNCTION business.c19_test_relation_collision();
    `);
    try {
      await expect(
        finalizeRuleCandidate({
          handoff,
          operations: [
            conflictingRule(handoff, {
              ruleId: "rule-c19-collision-a",
              indicatorItem: project.indicatorIds[0]!,
              score: 1,
            }),
            conflictingRule(handoff, {
              ruleId: "rule-c19-collision-b",
              indicatorItem: project.indicatorIds[0]!,
              score: 5,
            }),
          ],
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    } finally {
      await adminPool().query(
        `DROP TRIGGER IF EXISTS c19_test_relation_collision ON business.rule_relations`,
      );
      await adminPool().query(`DROP FUNCTION IF EXISTS business.c19_test_relation_collision()`);
    }
  }, 300_000);

  it("发布前冲突（修订归属、审计顺序准备）：关系事实与 C07 补链先于规则发布", async () => {
    const project = await startProjectWorld("c19-conflict");
    const { world } = project;
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-conflict-authoring-${world.projectId}`,
    });
    const revisionRef = await finalizeRuleCandidate({
      handoff,
      operations: [
        conflictingRule(handoff, {
          ruleId: "rule-c19-conflict-a",
          indicatorItem: project.indicatorIds[0]!,
          score: 1,
        }),
        conflictingRule(handoff, {
          ruleId: "rule-c19-conflict-b",
          indicatorItem: project.indicatorIds[0]!,
          score: 5,
        }),
      ],
    });

    // 关系事实绑定候选 C16 修订且随提交耐久；C07 任务与链接在提交成功后按稳定身份补齐。
    const relations = await relationRows(world.projectId);
    expect(relations.map((row) => row.relation_kind)).toEqual(["conflict"]);
    const relation = relations[0]!;
    expect(relation.revision_id).toBe(revisionRef.reference.entityId);
    const links = await reviewLinkRows(world.projectId);
    expect(links).toHaveLength(1);
    expect(links[0]!.relation_id).toBe(relation.relation_id);
    const reviewTaskRef = ReviewTaskRefV1Schema.parse(links[0]!.review_task_ref);
    expect(reviewTaskRef.reviewType).toBe("rule-conflict");
    expect(RuleConflictRefV1Schema.parse(reviewTaskRef.targetRef).kind).toBe("rule-conflict");
    expect(
      (
        await adminPool().query<{ status: string }>(
          `SELECT status FROM business.review_tasks
            WHERE project_id = $1 AND review_type = 'rule-conflict'`,
          [world.projectId],
        )
      ).rows.map((row) => row.status),
    ).toEqual(["pending"]);

    // 未决冲突：C16 审核被门禁阻断，规则发布数为 0。
    const blocked = await requestRuleReview({ projectId: world.projectId, revisionRef });
    expect(blocked.kind).toBe("failed");
    if (blocked.kind === "failed") {
      expect(blocked.error.code).toBe("BUSINESS_BLOCKED");
      expect(JSON.stringify(blocked.error)).not.toContain(relation.relation_id);
    }
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.knowledge_releases
          WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
        [world.projectId],
      ),
    ).toBe(0);
    conflict = { ...project, ruleRevisionRef: revisionRef, relationId: relation.relation_id };
  }, 300_000);

  it("冲突补链补偿：C07 创建失败只留未发布修订，原身份重试补齐链接且不重复事实", async () => {
    const project = await startProjectWorld("c19-conflict-retry");
    const { world } = project;
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-conflict-retry-authoring-${world.projectId}`,
    });
    const operations = [
      conflictingRule(handoff, {
        ruleId: "rule-c19-retry-a",
        indicatorItem: project.indicatorIds[0]!,
        score: 1,
      }),
      conflictingRule(handoff, {
        ruleId: "rule-c19-retry-b",
        indicatorItem: project.indicatorIds[0]!,
        score: 5,
      }),
    ];
    requireFixture().failNextConflictReview();
    await expect(
      requireFixture().scoringRules.finalizeAuthoringCandidate({
        task: handoff.task,
        candidate: { schemaVersion: "1", candidateVersion: 1, operations } as never,
      }),
    ).rejects.toThrowError(/BUSINESS_BLOCKED/u);

    // 修订与关系事实已耐久、链接缺失：候选仍被门禁，不能进入 C16 审核。
    const relationsAfterFailure = await relationRows(world.projectId);
    expect(relationsAfterFailure).toHaveLength(1);
    expect(await reviewLinkRows(world.projectId)).toHaveLength(0);
    const blocked = await requestRuleReview({
      projectId: world.projectId,
      revisionRef: {
        kind: "knowledge-revision",
        reference: { entityId: relationsAfterFailure[0]!.revision_id, versionId: "1" },
      },
    });
    expect(blocked.kind).toBe("failed");

    // 原身份重试：只补缺失 task/link，不重复 relation、task 或审计。
    const retriedRevisionRef = await finalizeRuleCandidate({ handoff, operations });
    expect(retriedRevisionRef.reference.entityId).toBe(relationsAfterFailure[0]!.revision_id);
    expect(await relationRows(world.projectId)).toHaveLength(1);
    expect(await reviewLinkRows(world.projectId)).toHaveLength(1);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.review_tasks
          WHERE project_id = $1 AND review_type = 'rule-conflict'`,
        [world.projectId],
      ),
    ).toBe(1);
  }, 300_000);

  it("冲突审阅、修订归属与审计顺序：精确两级决定解除门禁并形成不可变规则发布", async () => {
    expect(conflict).toBeDefined();
    const { projectId } = conflict!;
    const conflictDecisionRef = await requireFixture().decideConflictReview({
      projectId,
      relationId: conflict!.relationId,
      kind: "approve-publication",
    });
    const reviewDecisionRef = await approveRuleRevision({
      projectId,
      revisionRef: conflict!.ruleRevisionRef,
    });
    const published = await publishRuleRevision({
      projectId,
      revisionRef: conflict!.ruleRevisionRef,
      reviewDecisionRef,
    });
    expect(published.kind).toBe("succeeded");
    if (published.kind !== "succeeded" || published.result.kind !== "release") return;
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.knowledge_releases
          WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
        [projectId],
      ),
    ).toBe(1);
    // 决定链可重建：冲突事实与链接仍在，未被决定改写。
    expect(await relationRows(projectId)).toHaveLength(1);
    expect(await reviewLinkRows(projectId)).toHaveLength(1);
    const release = await adminPool().query<{
      revision_ref: unknown;
      review_decision_ref: unknown;
    }>(
      `SELECT revision_ref, review_decision_ref FROM business.knowledge_releases
        WHERE project_id = $1 AND release_id = $2`,
      [projectId, published.result.knowledgeReleaseRef.reference.entityId],
    );
    expect(release.rows[0]).toMatchObject({
      revision_ref: conflict!.ruleRevisionRef,
      review_decision_ref: reviewDecisionRef,
    });
    const audits = await adminPool().query<{ action: string; target_ref: unknown }>(
      `SELECT action, target_ref FROM audit.entries
        WHERE project_id = $1 AND action IN ('knowledge.submit-revision', 'knowledge.publish-approved-release')`,
      [projectId],
    );
    expect(audits.rows).toEqual(
      expect.arrayContaining([
        { action: "knowledge.submit-revision", target_ref: conflict!.ruleRevisionRef },
        {
          action: "knowledge.publish-approved-release",
          target_ref: published.result.knowledgeReleaseRef,
        },
      ]),
    );
    expect(conflictDecisionRef.kind).toBe("review-decision");
  }, 300_000);

  it("修订归属与过期决定：新规则修订必须有自己的精确冲突决定", async () => {
    expect(conflict).toBeDefined();
    const { projectId } = conflict!;
    const originalRelation = (await relationRows(projectId)).find(
      (row) => row.relation_id === conflict!.relationId,
    )!;
    const baseReleaseRef = await approvedRuleReleaseRef(projectId);
    expect(baseReleaseRef.kind).toBe("knowledge-release");
    const handoff = await startRuleAuthoring({
      project: conflict!,
      requestId: `c19-conflict-v2-authoring-${projectId}`,
      baseRuleReleaseRef: baseReleaseRef,
    });
    // 新修订与已发布规则相交且结论不同：产生全新 relation identity。
    const revisionRef = await finalizeRuleCandidate({
      handoff,
      operations: [
        conflictingRule(handoff, {
          ruleId: "rule-c19-conflict-c",
          indicatorItem: conflict!.indicatorIds[0]!,
          score: 3,
        }),
      ],
    });
    const newRelations = (await relationRows(projectId)).filter(
      (row) => row.revision_id === revisionRef.reference.entityId,
    );
    expect(newRelations.length).toBeGreaterThan(0);
    expect(newRelations.every((row) => row.relation_kind === "conflict")).toBe(true);
    const repeatedSemanticRelation = newRelations.find(
      (row) =>
        row.left_rule_id === originalRelation.left_rule_id &&
        row.right_rule_id === originalRelation.right_rule_id &&
        row.overlap_digest === originalRelation.overlap_digest,
    );
    expect(repeatedSemanticRelation).toBeDefined();
    expect(repeatedSemanticRelation!.relation_id).not.toBe(originalRelation.relation_id);
    expect(repeatedSemanticRelation!.revision_id).toBe(revisionRef.reference.entityId);
    expect(originalRelation.revision_id).toBe(conflict!.ruleRevisionRef.reference.entityId);

    // 旧冲突决定只批准旧 relation：新修订仍被门禁阻断，规则发布数不变。
    const blockedBeforeDecision = await requestRuleReview({ projectId, revisionRef });
    expect(blockedBeforeDecision.kind).toBe("failed");

    // 退回决定也不得放行：新修订必须重新形成候选。
    await requireFixture().decideConflictReview({
      projectId,
      relationId: newRelations[0]!.relation_id,
      kind: "return-for-revision",
    });
    const blockedAfterReturn = await requestRuleReview({ projectId, revisionRef });
    expect(blockedAfterReturn.kind).toBe("failed");
    if (blockedAfterReturn.kind === "failed") {
      expect(blockedAfterReturn.error.code).toBe("BUSINESS_BLOCKED");
    }
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.knowledge_releases
          WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
        [projectId],
      ),
    ).toBe(1);
  }, 300_000);

  it("发布最终门禁：关系摘要被改写时发布回滚且不留 release/audit/回执/outbox", async () => {
    const project = await startProjectWorld("c19-conflict-gate");
    const { world } = project;
    const handoff = await startRuleAuthoring({
      project,
      requestId: `c19-conflict-gate-authoring-${world.projectId}`,
    });
    const revisionRef = await finalizeRuleCandidate({
      handoff,
      operations: [
        conflictingRule(handoff, {
          ruleId: "rule-c19-gate-a",
          indicatorItem: project.indicatorIds[0]!,
          score: 1,
        }),
        conflictingRule(handoff, {
          ruleId: "rule-c19-gate-b",
          indicatorItem: project.indicatorIds[0]!,
          score: 5,
        }),
      ],
    });
    const relationIds = (await reviewLinkRows(world.projectId)).map((row) => row.relation_id);
    expect(relationIds).toHaveLength(1);
    for (const relationId of relationIds) {
      await requireFixture().decideConflictReview({
        projectId: world.projectId,
        relationId,
        kind: "approve-publication",
      });
    }
    const reviewDecisionRef = await approveRuleRevision({
      projectId: world.projectId,
      revisionRef,
    });

    const commandId = `${revisionRef.reference.entityId}:publish`;
    const releaseCountBefore = await countRows(
      `SELECT count(*)::text AS count FROM business.knowledge_releases
        WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
      [world.projectId],
    );
    const auditBefore = await countRows(
      `SELECT count(*)::text AS count FROM audit.entries
        WHERE project_id = $1 AND action = 'knowledge.publish-approved-release'`,
      [world.projectId],
    );
    const original = await adminPool().query<{ relation_id: string; overlap_digest: string }>(
      `SELECT relation_id, overlap_digest FROM business.rule_relations
        WHERE project_id = $1 AND revision_id = $2 ORDER BY relation_id`,
      [world.projectId, revisionRef.reference.entityId],
    );

    // 关系事实在审核后发生不可解释的变化：发布门禁必须整体回滚本次发布。
    await adminPool().query(
      `UPDATE business.rule_relations SET overlap_digest = $3
        WHERE project_id = $1 AND revision_id = $2`,
      [world.projectId, revisionRef.reference.entityId, "f".repeat(64)],
    );
    try {
      const failed = await publishRuleRevision({
        projectId: world.projectId,
        revisionRef,
        reviewDecisionRef,
      });
      expect(failed.kind).toBe("failed");
      if (failed.kind === "failed") {
        expect(JSON.stringify(failed.error)).not.toContain("f".repeat(64));
      }
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM business.knowledge_releases
            WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
          [world.projectId],
        ),
      ).toBe(releaseCountBefore);
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM audit.entries
            WHERE project_id = $1 AND action = 'knowledge.publish-approved-release'`,
          [world.projectId],
        ),
      ).toBe(auditBefore);
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM business.command_receipts WHERE command_id = $1`,
          [commandId],
        ),
      ).toBe(0);
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1`,
          [commandId],
        ),
      ).toBe(0);
    } finally {
      for (const row of original.rows) {
        await adminPool().query(
          `UPDATE business.rule_relations SET overlap_digest = $3
            WHERE project_id = $1 AND relation_id = $2`,
          [world.projectId, row.relation_id, row.overlap_digest],
        );
      }
    }

    // 事实恢复后同一修订原身份重试即可发布。
    const published = await publishRuleRevision({
      projectId: world.projectId,
      revisionRef,
      reviewDecisionRef,
    });
    expect(published.kind).toBe("succeeded");
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.knowledge_releases
          WHERE project_id = $1 AND definition_type = 'structured-scoring-rule'`,
        [world.projectId],
      ),
    ).toBe(releaseCountBefore + 1);
  }, 300_000);

  it("basis 不可枚举：缺失集合与跨工程引用返回同一不可重试拒绝", async () => {
    const request = (input: { readonly requestId: string; readonly projectId: string }) =>
      basisReadInput({
        requestId: input.requestId,
        authorization: basisAuthorization(input.projectId, input.requestId),
        assessmentBasisReleaseSetRef: {
          kind: "assessment-basis-release-set",
          reference: { entityId: "missing-basis", versionId: "1" },
        },
      });
    const first = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      request({ requestId: "c19-read-missing", projectId: "project-c19-missing" }),
    );
    const second = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      request({ requestId: "c19-read-missing-2", projectId: "project-c19-missing" }),
    );
    expect(first.kind).toBe("unavailable");
    expect(second.kind).toBe("unavailable");
    if (first.kind === "unavailable" && second.kind === "unavailable") {
      expect(first.error.code).toBe("AUTHORIZATION_DENIED");
      expect(second.error.code).toBe("AUTHORIZATION_DENIED");
      expect(first.error.retryable).toBe(false);
      expect(first.error.requiredCapability).toBe(second.error.requiredCapability);
      expect(JSON.stringify(first)).not.toContain("scoringRuleMembers");
      expect(JSON.stringify(first)).not.toContain("releaseRef");
    }
  }, 180_000);

  it("权限：跨工程与撤权后的 basis 读取统一不可枚举拒绝，工程与 actor 只取 C06 权威上下文", async () => {
    expect(chain).toBeDefined();
    const projectId = chain!.projectId;
    const crossProject = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: "c19-basis-cross-project",
        authorization: basisAuthorization("project-c19-foreign", "c19-basis-cross-project"),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    expect(crossProject.kind).toBe("unavailable");
    if (crossProject.kind === "unavailable") {
      expect(crossProject.error.code).toBe("AUTHORIZATION_DENIED");
      expect(JSON.stringify(crossProject)).not.toContain("scoringRuleMembers");
    }

    // 撤权：授权复验先于 C03 回执查询，旧成功回执不得绕过撤权。
    const revokedAuthorization = basisAuthorization(projectId, "c19-basis-revoked");
    const beforeRevocation = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: "c19-basis-revoked-before",
        authorization: revokedAuthorization,
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    expect(beforeRevocation.kind).toBe("succeeded");
    const [auditBeforeRevocation, receiptBeforeRevocation] = await Promise.all([
      countRows(
        `SELECT count(*)::text AS count FROM audit.entries
          WHERE project_id = $1 AND action LIKE 'knowledge.read-assessment-basis-release-set%'`,
        [projectId],
      ),
      countRows(
        `SELECT count(*)::text AS count FROM business.command_receipts
          WHERE project_id = $1 AND command_kind = 'knowledge.read-assessment-basis-release-set.v1'`,
        [projectId],
      ),
    ]);
    requireFixture().revokeAuthorization(revokedAuthorization.authorizationContextRef);
    const replayAfterRevocation = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: "c19-basis-revoked-before",
        authorization: revokedAuthorization,
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    requireFixture().restoreAuthorizations();
    expect(replayAfterRevocation.kind).toBe("unavailable");
    if (replayAfterRevocation.kind === "unavailable") {
      expect(replayAfterRevocation.error.code).toBe("AUTHORIZATION_DENIED");
      expect(JSON.stringify(replayAfterRevocation)).not.toContain("scoringRuleMembers");
    }
    expect(
      await Promise.all([
        countRows(
          `SELECT count(*)::text AS count FROM audit.entries
            WHERE project_id = $1 AND action LIKE 'knowledge.read-assessment-basis-release-set%'`,
          [projectId],
        ),
        countRows(
          `SELECT count(*)::text AS count FROM business.command_receipts
            WHERE project_id = $1 AND command_kind = 'knowledge.read-assessment-basis-release-set.v1'`,
          [projectId],
        ),
      ]),
    ).toEqual([auditBeforeRevocation, receiptBeforeRevocation]);
  }, 180_000);

  it("basis 运行时边界：strict 输入与 C06 瞬时失败均不查询目标或完成回执", async () => {
    expect(chain).toBeDefined();
    const verify = vi.mocked(requireFixture().access.verify);
    const callsBefore = verify.mock.calls.length;
    const malformed = await requireFixture().scoringRules.readAssessmentBasisReleaseSet({
      requestId: "c19-basis-malformed",
    } as never);
    expect(malformed).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT", retryable: false },
    });
    expect(verify.mock.calls).toHaveLength(callsBefore);

    const deniedRequestId = `c19-basis-capability-denied-${chain!.projectId}`;
    verify.mockRejectedValueOnce(
      new AccessServiceError({
        stage: "access.verify",
        occurredAt: SCORING_RULES_TEST_ISSUED_AT,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "c19-access-denied", versionId: "1" },
        },
        contextRefs: [],
        code: "AUTHORIZATION_DENIED",
        retryable: false,
        requiredCapability: "knowledge-modeling.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      }),
    );
    const denied = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: deniedRequestId,
        authorization: requireFixture().authorize({
          projectId: chain!.projectId,
          actorId: authoringActor,
          branch: "knowledge-modeling.deactivate-release",
          entityId: deniedRequestId,
        }),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    expect(denied).toMatchObject({
      kind: "unavailable",
      error: { code: "AUTHORIZATION_DENIED", retryable: false },
    });
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.command_receipts WHERE command_id = $1`,
        [deniedRequestId],
      ),
    ).toBe(0);

    const reorderedRequestId = `c19-basis-capability-order-${chain!.projectId}`;
    const reorderedAuthorization = basisAuthorization(chain!.projectId, reorderedRequestId);
    const reordered = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: reorderedRequestId,
        authorization: {
          ...reorderedAuthorization,
          grantedCapabilities: [
            "engineering-data.read",
            ...reorderedAuthorization.grantedCapabilities,
          ],
        },
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    expect(reordered.kind).toBe("succeeded");

    const requestId = `c19-basis-access-transient-${chain!.projectId}`;
    verify.mockRejectedValueOnce(
      new AccessServiceError({
        stage: "access.verify",
        occurredAt: SCORING_RULES_TEST_ISSUED_AT,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "c19-access-transient", versionId: "1" },
        },
        contextRefs: [],
        code: "ACCESS_TRANSIENT_FAILURE",
        retryable: true,
        attempt: 1,
      }),
    );
    const transient = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId,
        authorization: basisAuthorization(chain!.projectId, requestId),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    expect(transient).toMatchObject({
      kind: "failed",
      error: { code: "TRANSIENT_FAILURE", retryable: true },
    });
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.command_receipts WHERE command_id = $1`,
        [requestId],
      ),
    ).toBe(0);
  }, 180_000);

  it("幂等与并发：同一组装请求重放返回同一修订且不新增事实", async () => {
    expect(chain).toBeDefined();
    const request = chain!.prepareRequest as never;
    const before = await countRows(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
      [chain!.projectId],
    );
    const [replayed, concurrent] = await Promise.all([
      requireFixture().scoringRules.assembleApplicableRuleSetRevision(request),
      requireFixture().scoringRules.assembleApplicableRuleSetRevision(request),
    ]);
    expect(replayed.kind).toBe("succeeded");
    expect(concurrent.kind).toBe("succeeded");
    if (replayed.kind !== "succeeded" || concurrent.kind !== "succeeded") return;
    expect(replayed.applicableRuleSetRevisionRef).toEqual(chain!.setRevisionRef);
    expect(concurrent.applicableRuleSetRevisionRef).toEqual(chain!.setRevisionRef);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.knowledge_revisions
          WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
        [chain!.projectId],
      ),
    ).toBe(before);
  }, 300_000);

  it("事务失败回滚：注入组装事务故障后不产生部分规则集修订", async () => {
    expect(chain).toBeDefined();
    const request = {
      ...(chain!.prepareRequest as Record<string, unknown>),
      requestId: "c19-real-standard-assembly-rollback",
      idempotencyKey: "c19-real-standard-assembly-rollback",
    };
    const before = await countRows(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
      [chain!.projectId],
    );
    requireFixture().injectTransactionFailure("c19-real-standard-assembly-rollback");
    try {
      const failed = await requireFixture().scoringRules.assembleApplicableRuleSetRevision(
        request as never,
      );
      expect(failed.kind).toBe("failed");
      if (failed.kind === "failed") {
        expect(["TRANSIENT_FAILURE", "TERMINAL_FAILURE"]).toContain(failed.error.code);
        expect(JSON.stringify(failed.error)).not.toContain("injected");
      }
    } finally {
      requireFixture().injectTransactionFailure(undefined);
    }
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.knowledge_revisions
          WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
        [chain!.projectId],
      ),
    ).toBe(before);
  }, 300_000);

  it("basis 无正文：成功结果只含顶层借用字段与精确引用", async () => {
    expect(chain).toBeDefined();
    const read = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: `c19-basis-nobody-${chain!.projectId}`,
        authorization: basisAuthorization(chain!.projectId, `c19-basis-nobody-${chain!.projectId}`),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    if (read.kind !== "succeeded") {
      throw new Error(`basis read failed: ${JSON.stringify(read).slice(0, 600)}`);
    }
    expect(Object.keys(read).sort()).toEqual([
      "applicableRuleSetMember",
      "assessmentBasisReleaseSetRef",
      "configurationMembers",
      "kind",
      "memberDigest",
      "schemaVersion",
      "scoringRuleMembers",
    ]);
    expect(read.schemaVersion).toBe("1");
    for (const member of [read.applicableRuleSetMember, ...read.scoringRuleMembers]) {
      expect(Object.keys(member).sort()).toEqual([
        "artifactRef",
        "contentDigest",
        "releaseRef",
        "revisionRef",
      ]);
    }
    for (const member of read.configurationMembers) {
      expect(Object.keys(member).sort()).toEqual([
        "artifactRef",
        "contentDigest",
        "definitionType",
        "releaseRef",
        "revisionRef",
      ]);
    }
    expect(read.configurationMembers).toHaveLength(11);
    expect(JSON.stringify(read)).not.toContain("exceptionClauses");
    expect(JSON.stringify(read)).not.toContain("scoringThresholds");
    expect(JSON.stringify(read)).not.toContain("preparationSnapshotRef");
  }, 180_000);

  it("basis 读取幂等：成功结果按同一规范载荷重放且同键异载荷冲突", async () => {
    expect(chain).toBeDefined();
    const request = basisReadInput({
      requestId: `c19-basis-replay-${chain!.projectId}`,
      authorization: basisAuthorization(chain!.projectId, `c19-basis-replay-${chain!.projectId}`),
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    });
    const first = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
    const auditBefore = await countRows(
      `SELECT count(*)::text AS count FROM audit.entries
        WHERE project_id = $1 AND action LIKE 'knowledge.read-assessment-basis-release-set%'`,
      [chain!.projectId],
    );
    const second = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
    expect(first.kind).toBe("succeeded");
    expect(second.kind).toBe("succeeded");
    if (first.kind !== "succeeded" || second.kind !== "succeeded") return;
    expect(second.memberDigest).toBe(first.memberDigest);
    expect(second.scoringRuleMembers).toEqual(first.scoringRuleMembers);
    expect(second.configurationMembers).toEqual(first.configurationMembers);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM audit.entries
          WHERE project_id = $1 AND action LIKE 'knowledge.read-assessment-basis-release-set%'`,
        [chain!.projectId],
      ),
    ).toBe(auditBefore);

    const conflicted = await requireFixture().scoringRules.readAssessmentBasisReleaseSet({
      ...request,
      assessmentBasisReleaseSetRef: {
        kind: "assessment-basis-release-set",
        reference: { entityId: "another-basis", versionId: "1" },
      },
    });
    expect(conflicted.kind).toBe("failed");
    if (conflicted.kind === "failed") {
      expect(conflicted.error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
  }, 180_000);

  it("basis 不可用幂等：授权有效但集合缺失时只写一条 unavailable 审计并原样重放", async () => {
    expect(chain).toBeDefined();
    const request = basisReadInput({
      requestId: `c19-basis-unavailable-${chain!.projectId}`,
      authorization: basisAuthorization(
        chain!.projectId,
        `c19-basis-unavailable-${chain!.projectId}`,
      ),
      assessmentBasisReleaseSetRef: {
        kind: "assessment-basis-release-set",
        reference: { entityId: "missing-basis-set", versionId: "1" },
      },
    });
    const unavailableAction = "knowledge.read-assessment-basis-release-set.unavailable";
    const auditBefore = await countRows(
      `SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2`,
      [chain!.projectId, unavailableAction],
    );
    const first = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
    const second = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
    expect(first.kind).toBe("unavailable");
    expect(second.error.code).toBe(first.error.code);
    expect(second.error.occurredAt).toBe(first.error.occurredAt);
    if (first.kind !== "unavailable" || second.kind !== "unavailable") return;
    expect(first.error.code).toBe("AUTHORIZATION_DENIED");
    expect(first.error.retryable).toBe(false);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2`,
        [chain!.projectId, unavailableAction],
      ),
    ).toBe(auditBefore + 1);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.command_receipts
          WHERE project_id = $1 AND command_kind = 'knowledge.read-assessment-basis-release-set.v1'
            AND idempotency_key = $2 AND completed_at IS NOT NULL`,
        [chain!.projectId, request.idempotencyKey],
      ),
    ).toBe(1);
    // 同键异载荷：即使首次结果是不可用，也必须返回幂等冲突。
    const conflicted = await requireFixture().scoringRules.readAssessmentBasisReleaseSet({
      ...request,
      assessmentBasisReleaseSetRef: {
        kind: "assessment-basis-release-set",
        reference: { entityId: "missing-basis-other", versionId: "1" },
      },
    });
    expect(conflicted.kind).toBe("failed");
    if (conflicted.kind === "failed") {
      expect(conflicted.error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
  }, 180_000);

  it("basis 瞬时失败不伪装成不可用：读取事务故障返回 failed 且不完成回执", async () => {
    expect(chain).toBeDefined();
    const requestId = `c19-basis-transient-${chain!.projectId}`;
    const request = basisReadInput({
      requestId,
      authorization: basisAuthorization(chain!.projectId, requestId),
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    });
    requireFixture().injectTransactionFailure(requestId);
    try {
      const failed = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
      expect(failed.kind).toBe("failed");
      if (failed.kind === "failed") {
        expect(failed.error.code).toBe("TRANSIENT_FAILURE");
      }
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM business.command_receipts
            WHERE project_id = $1 AND command_kind = 'knowledge.read-assessment-basis-release-set.v1'
              AND idempotency_key = $2 AND completed_at IS NOT NULL`,
          [chain!.projectId, request.idempotencyKey],
        ),
      ).toBe(0);
    } finally {
      requireFixture().injectTransactionFailure(undefined);
    }
    // 原键可重试并成功。
    const retried = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
    expect(retried.kind).toBe("succeeded");
  }, 180_000);

  it("basis 历史成功完整性：success 回执对应快照损坏时失败关闭", async () => {
    expect(chain).toBeDefined();
    const requestId = `c19-basis-integrity-${chain!.projectId}`;
    const request = basisReadInput({
      requestId,
      authorization: basisAuthorization(chain!.projectId, requestId),
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    });
    const first = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
    expect(first.kind).toBe("succeeded");
    const original = await adminPool().query<{ member_snapshot: unknown }>(
      `SELECT member_snapshot FROM business.assessment_basis_release_sets
        WHERE project_id = $1 AND set_id = $2 AND version_id = $3`,
      [
        chain!.projectId,
        chain!.basisReleaseSetRef.reference.entityId,
        chain!.basisReleaseSetRef.reference.versionId,
      ],
    );
    const unavailableBefore = await countRows(
      `SELECT count(*)::text AS count FROM audit.entries
        WHERE project_id = $1 AND action = 'knowledge.read-assessment-basis-release-set.unavailable'`,
      [chain!.projectId],
    );
    await adminPool().query(
      `UPDATE business.assessment_basis_release_sets SET member_snapshot = $4::jsonb
        WHERE project_id = $1 AND set_id = $2 AND version_id = $3`,
      [
        chain!.projectId,
        chain!.basisReleaseSetRef.reference.entityId,
        chain!.basisReleaseSetRef.reference.versionId,
        JSON.stringify({ damaged: true }),
      ],
    );
    try {
      const replay = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
      expect(replay).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE", retryable: false },
      });
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM audit.entries
            WHERE project_id = $1 AND action = 'knowledge.read-assessment-basis-release-set.unavailable'`,
          [chain!.projectId],
        ),
      ).toBe(unavailableBefore);
    } finally {
      await adminPool().query(
        `UPDATE business.assessment_basis_release_sets SET member_snapshot = $4::jsonb
          WHERE project_id = $1 AND set_id = $2 AND version_id = $3`,
        [
          chain!.projectId,
          chain!.basisReleaseSetRef.reference.entityId,
          chain!.basisReleaseSetRef.reference.versionId,
          JSON.stringify(original.rows[0]!.member_snapshot),
        ],
      );
    }

    const hiddenSetId = `${chain!.basisReleaseSetRef.reference.entityId}-hidden`;
    await adminPool().query(
      `UPDATE business.assessment_basis_release_sets SET set_id = $4
        WHERE project_id = $1 AND set_id = $2 AND version_id = $3`,
      [
        chain!.projectId,
        chain!.basisReleaseSetRef.reference.entityId,
        chain!.basisReleaseSetRef.reference.versionId,
        hiddenSetId,
      ],
    );
    try {
      const missingReplay =
        await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
      expect(missingReplay).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE", retryable: false },
      });
    } finally {
      await adminPool().query(
        `UPDATE business.assessment_basis_release_sets SET set_id = $4
          WHERE project_id = $1 AND set_id = $2 AND version_id = $3`,
        [
          chain!.projectId,
          hiddenSetId,
          chain!.basisReleaseSetRef.reference.versionId,
          chain!.basisReleaseSetRef.reference.entityId,
        ],
      );
    }

    const receipt = await adminPool().query<{ audit_entry_id: string }>(
      `SELECT audit_entry_id FROM business.command_receipts WHERE command_id = $1`,
      [requestId],
    );
    await adminPool().query(`UPDATE audit.entries SET action = $2 WHERE audit_entry_id = $1`, [
      receipt.rows[0]!.audit_entry_id,
      "knowledge.read-assessment-basis-release-set.unknown",
    ]);
    try {
      const unknownAuditReplay =
        await requireFixture().scoringRules.readAssessmentBasisReleaseSet(request);
      expect(unknownAuditReplay).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE", retryable: false },
      });
      expect(
        await countRows(
          `SELECT count(*)::text AS count FROM audit.entries
            WHERE project_id = $1 AND action = 'knowledge.read-assessment-basis-release-set.unavailable'`,
          [chain!.projectId],
        ),
      ).toBe(unavailableBefore);
    } finally {
      await adminPool().query(`UPDATE audit.entries SET action = $2 WHERE audit_entry_id = $1`, [
        receipt.rows[0]!.audit_entry_id,
        "knowledge.read-assessment-basis-release-set.succeeded",
      ]);
    }
  }, 180_000);

  it("basis 冻结集合：成员停用后仍返回原精确快照", async () => {
    expect(chain).toBeDefined();
    const firstRequestId = `c19-basis-frozen-before-${chain!.projectId}`;
    const before = await requireFixture().scoringRules.readAssessmentBasisReleaseSet(
      basisReadInput({
        requestId: firstRequestId,
        authorization: basisAuthorization(chain!.projectId, firstRequestId),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
    );
    if (before.kind !== "succeeded") throw new Error("frozen basis setup failed");
    const memberReleaseRef = before.scoringRuleMembers[0]!.releaseRef;
    const deactivated = await requireFixture().governance.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "deactivate-release",
        commandId: `c19-basis-deactivate-${chain!.projectId}`,
        idempotencyKey: `c19-basis-deactivate-${chain!.projectId}`,
        projectId: chain!.projectId,
        actorId: authoringActor,
        issuedAt: "2030-01-01T00:00:04.000Z",
        authorization: requireFixture().authorize({
          projectId: chain!.projectId,
          actorId: authoringActor,
          branch: "knowledge-modeling.deactivate-release",
          entityId: `c19-basis-deactivate-${chain!.projectId}`,
        }),
        payload: { releaseRef: memberReleaseRef, reasonCode: "superseded" },
      }),
    );
    expect(deactivated.kind).toBe("succeeded");
    const nextRequestId = `c19-basis-frozen-after-${chain!.projectId}`;
    const after = await requireFixture().scoringRules.readAssessmentBasisReleaseSet({
      ...basisReadInput({
        requestId: nextRequestId,
        authorization: basisAuthorization(chain!.projectId, nextRequestId),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      }),
      requestedAt: "2030-01-01T00:00:05.000Z",
    });
    expect(after.kind).toBe("succeeded");
    if (after.kind === "succeeded") {
      expect(after.memberDigest).toBe(before.memberDigest);
      expect(after.scoringRuleMembers).toEqual(before.scoringRuleMembers);
    }
  }, 180_000);

  it("规则集门禁：配置或冲突不完整时整体失败，不启动编制任务、不落 manifest 与修订", async () => {
    const { cleaning } = requireFixture();
    const world = await cleaning.createWorld({
      suffix: "c19-noconfig",
      documentKinds: ["docx"],
      documents: [realStandardCleaningDocument()],
    });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `c19-noconfig-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: "c19-noconfig-worker",
      projectId: world.projectId,
    });
    requireFixture().setActiveWorld(world);
    const startsBefore = cleaning.recordedStartCommands.length;

    const prepared = await requireFixture().scoringRules.prepareAuthoring({
      requestId: `c19-noconfig-authoring-${world.projectId}`,
      idempotencyKey: `c19-noconfig-authoring-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: RULE_AUTHORING_AT,
      authorization: await world.authorizeBranch(
        `c19-noconfig-authoring-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await requireFixture().evidenceAccessAuthorization(
        world,
        `c19-noconfig-authoring-${world.projectId}`,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: completion.taskRef,
      requiredAt: RULE_AUTHORING_AT,
      asOfRecordedAt: RULE_AUTHORING_AT,
      scoringPolicyRef: requireFixture().policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });

    expect(prepared.kind).toBe("failed");
    expect(cleaning.recordedStartCommands.length).toBe(startsBefore);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.scoring_rule_revision_metadata WHERE project_id = $1`,
        [world.projectId],
      ),
    ).toBe(0);
    expect(
      await countRows(
        `SELECT count(*)::text AS count FROM business.agent_tasks
          WHERE project_id = $1 AND task_type = 'knowledge-authoring'`,
        [world.projectId],
      ),
    ).toBe(0);
  }, 300_000);
});
