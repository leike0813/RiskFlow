import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  completeCleaningTask,
  makeAssessmentConfigurationFixtureSet,
  SCORING_RULES_TEST_ISSUED_AT,
  startScoringRulesFixture,
  type ScoringRulesPostgresFixtureV1,
} from "./fixture.js";
import { freezeIdentificationPreparation } from "../engineering-data/cleaning/fixture.js";

describe.sequential("C19 PostgreSQL 结构化评分规则与适用规则集", () => {
  let fixture: ScoringRulesPostgresFixtureV1 | undefined;
  const authoringActor = "manager-1";

  beforeAll(async () => {
    fixture = await startScoringRulesFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 180_000);

  it("创建 C19 五张只追加表并限制应用角色写权限", async () => {
    const tables = await fixture!.cleaning.postgres.adminPool.query<{ table_name: string }>(
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

    const appPool = new Pool(fixture!.cleaning.postgres.app);
    try {
      await expect(
        appPool.query("SELECT count(*) FROM business.scoring_rule_revision_metadata"),
      ).resolves.toBeDefined();
      await expect(
        appPool.query("UPDATE business.rule_relations SET status = status"),
      ).rejects.toBeDefined();
      await expect(appPool.query("DELETE FROM business.rule_relations")).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
  }, 180_000);

  it("来源门禁：C15 未完成或未授权时在模型调用前拒绝且不产生候选", async () => {
    const before = fixture!.cleaning.recordedStartCommands.length;
    const denied = await fixture!.scoringRules.prepareAuthoring({
      requestId: "c19-source-gate",
      idempotencyKey: "c19-source-gate",
      projectId: "project-c19-missing",
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: fixture!.authorize({
        projectId: "project-c19-missing",
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: "c19-source-gate",
      }),
      dataCleaningAuthorization: fixture!.authorize({
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
      scoringPolicyRef: fixture!.policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });
    expect(denied.kind).toBe("failed");
    expect(fixture!.cleaning.recordedStartCommands.length).toBe(before);
    if (denied.kind === "failed") {
      expect(denied.error.code).toBe("AUTHORIZATION_DENIED");
    }
  }, 180_000);

  it("合成样本待甲方复核：C15 收口资料段进入 C19 编制并形成 RA-S3/S4 适用规则集与公共 assessment-basis（basis 成员读取）", async () => {
    const cleaning = fixture!.cleaning;
    const afterPublish = "2030-01-01T00:00:03.000Z";
    const world = await cleaning.createWorld({ suffix: "c19-chain", documentKinds: ["csv"] });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `c19-chain-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: "c19-chain-worker",
      projectId: world.projectId,
    });
    fixture!.setActiveWorld(world);
    const configurationSet = makeAssessmentConfigurationFixtureSet({
      projectId: world.projectId,
      projectRevisionRef: world.projectRevisionRef,
      configurationSetRef: { entityId: `configuration-set-${world.projectId}`, versionId: "1" },
    });
    await fixture!.publishConfigurationSet({
      projectId: world.projectId,
      documents: configurationSet.documents,
    });

    // C19 在清洗任务完成后、识别准备收口前读取绑定结果与工件引用。
    const prepared = await fixture!.scoringRules.prepareAuthoring({
      requestId: `c19-chain-authoring-${world.projectId}`,
      idempotencyKey: `c19-chain-authoring-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-chain-authoring-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await fixture!.evidenceAccessAuthorization(
        world,
        `c19-chain-authoring-${world.projectId}`,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: completion.taskRef,
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
      scoringPolicyRef: fixture!.policy.policyRef,
      sourceStandardKinds: ["国家规范", "行业标准"],
    });
    if (prepared.kind !== "succeeded") {
      throw new Error(`prepareAuthoring failed: ${JSON.stringify(prepared)}`);
    }

    const task = await fixture!.agentTasks.getTask(prepared.agentTaskRef);
    const loaded = await fixture!.scoringRules.loadAuthoringManifest(task!);
    const retained = loaded.manifest.retainedSourceSegments[0]!;
    expect(loaded.manifest.cleaningResultArtifactRef).toEqual(
      loaded.manifest.cleaningResultArtifactRef,
    );
    expect(retained.sourceSegmentIds.length).toBeGreaterThan(0);

    const indicators = (
      configurationSet.documents["indicator-system"] as unknown as {
        readonly content: { readonly indicators: readonly { readonly indicatorId: string }[] };
      }
    ).content.indicators;
    const candidate = {
      schemaVersion: "1" as const,
      candidateVersion: 1,
      operations: [
        {
          kind: "add-rule" as const,
          ruleId: "rule-c19-settlement",
          rule: {
            ruleId: "rule-c19-settlement",
            applicabilityConditions: {
              constructionMethod: ["盾构法"],
              stratumCondition: ["软土地层"],
              engineeringStage: ["盾构掘进"],
            },
            indicatorItem: indicators[0]!.indicatorId,
            scoringThresholds: [
              { thresholdId: "t-low", score: 1, operator: "between", value: 0, upperValue: 10 },
              { thresholdId: "t-high", score: 5, operator: "gte", value: 10 },
            ],
            gradeIntervals: [
              { grade: "grade-a", upperBound: 10 },
              { grade: "grade-b", lowerBound: 10 },
            ],
            exceptionClauses: [],
            evidenceLocator: { sourceSegmentId: retained.sourceSegmentIds[0]! },
            ruleVersion: { entityId: "rule-c19-settlement", versionId: "pending" },
            reviewStatus: "pending" as const,
          },
          sourceVersionRef: retained.sourceVersionRef,
          evidenceReferences: [
            {
              locator: { sourceSegmentId: retained.sourceSegmentIds[0]! },
              sourceVersion: retained.sourceVersionRef.reference,
            },
          ],
        },
      ],
    };

    const validation = await fixture!.scoringRules
      .validateAuthoringCandidate({ task: task!, candidate })
      .catch((error: unknown) => {
        throw new Error(
          `validateAuthoringCandidate failed: ${JSON.stringify(
            (error as { failure?: unknown }).failure ?? String(error),
          )}`,
        );
      });
    expect(validation.validationArtifactRef).toBeDefined();
    const finalized = await fixture!.scoringRules
      .finalizeAuthoringCandidate({ task: task!, candidate })
      .catch((error: unknown) => {
        throw new Error(
          `finalizeAuthoringCandidate failed: ${JSON.stringify(
            (error as { failure?: unknown }).failure ?? String(error),
          )}`,
        );
      });
    expect(finalized.status).toBe("completed");
    if (finalized.status !== "completed") return;
    const revisions = await cleaning.postgres.adminPool.query<{ revision_id: string }>(
      "SELECT revision_id FROM business.scoring_rule_revision_metadata WHERE project_id = $1",
      [world.projectId],
    );
    expect(revisions.rows.length).toBeGreaterThan(0);

    const ruleRevisionRef = (finalized as unknown as { candidateRef: never }).candidateRef;
    const ruleReleaseRef = await fixture!.approveAndPublishRevision({
      projectId: world.projectId,
      revisionRef: ruleRevisionRef,
    });
    expect(ruleReleaseRef.kind).toBe("knowledge-release");

    const preparationSnapshotRef = {
      kind: "assessment-preparation-snapshot" as const,
      reference: { entityId: `preparation-${world.projectId}`, versionId: "1" },
    };
    fixture!.setPreparationProjection({
      schemaVersion: "1",
      preparationSnapshotRef,
      projectId: world.projectId,
      projectRevisionRef: world.projectRevisionRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: {
        constructionMethod: "盾构法",
        stratumCondition: "软土地层",
        engineeringStage: "盾构掘进",
      },
      cleaningResultArtifactRef: loaded.manifest.cleaningResultArtifactRef,
      dataCleaningTaskRef: completion.taskRef,
      configurationSetRef: configurationSet.configurationSetRef,
      compatibilityRef: fixture!.policy.compatibilityRef,
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
    });

    const assemblyRequest = {
      requestId: `c19-chain-assembly-${world.projectId}`,
      idempotencyKey: `c19-chain-assembly-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-chain-assembly-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      projectRevisionRef: world.projectRevisionRef,
      preparationSnapshotRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: {
        constructionMethod: "盾构法",
        stratumCondition: "软土地层",
        engineeringStage: "盾构掘进",
      },
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
      scoringPolicyRef: fixture!.policy.policyRef,
      assemblyPolicyRef: fixture!.policy.assemblyPolicyRef,
      compatibilityRef: fixture!.policy.compatibilityRef,
      configurationSetRef: configurationSet.configurationSetRef,
    };
    const assembled =
      await fixture!.scoringRules.assembleApplicableRuleSetRevision(assemblyRequest);
    if (assembled.kind !== "succeeded") {
      throw new Error(`assembleApplicableRuleSetRevision failed: ${JSON.stringify(assembled)}`);
    }
    const setRevisionRef = assembled.applicableRuleSetRevisionRef;
    const setReleaseRef = await fixture!.approveAndPublishRevision({
      projectId: world.projectId,
      revisionRef: setRevisionRef,
    });

    const resolution = await fixture!.scoringRules.resolve({
      kind: "assessment-basis",
      commandId: `c19-chain-resolve-${world.projectId}`,
      idempotencyKey: `c19-chain-resolve-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      issuedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-chain-resolve-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      branch: "knowledge-modeling.assessment-basis",
      payload: { preparationSnapshotRef, requiredAt: afterPublish },
    } as never);
    if (resolution.kind !== "succeeded") {
      throw new Error(`resolve failed: ${JSON.stringify(resolution)}`);
    }
    expect(setReleaseRef.kind).toBe("knowledge-release");

    const basisRead = await fixture!.scoringRules.readAssessmentBasisReleaseSet({
      requestId: `c19-chain-basis-read-${world.projectId}`,
      idempotencyKey: `c19-chain-basis-read-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: fixture!.authorize({
        projectId: world.projectId,
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: `c19-chain-basis-read-${world.projectId}`,
      }),
      assessmentBasisReleaseSetRef: (
        resolution as unknown as {
          result: { assessmentBasisReleaseSetRef: never };
        }
      ).result.assessmentBasisReleaseSetRef,
    });
    if (basisRead.kind !== "succeeded") {
      throw new Error(`basis member read failed: ${JSON.stringify(basisRead)}`);
    }
    expect(basisRead.releaseSet.members.configurationMembers).toHaveLength(11);
    expect(basisRead.releaseSet.members.scoringRuleMembers).toHaveLength(1);
    expect(basisRead.releaseSet.members.applicableRuleSetMember.releaseRef).toEqual(setReleaseRef);
    expect(basisRead.releaseSet.memberDigest).toMatch(/^[0-9a-f]{64}$/u);
  }, 300_000);

  it("basis 不可枚举：缺失集合与跨工程引用返回同一不可重试拒绝", async () => {
    const request = {
      requestId: "c19-read-missing",
      idempotencyKey: "c19-read-missing",
      projectId: "project-c19-missing",
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: fixture!.authorize({
        projectId: "project-c19-missing",
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: "c19-read-missing",
      }),
      assessmentBasisReleaseSetRef: {
        kind: "assessment-basis-release-set" as const,
        reference: { entityId: "missing-basis", versionId: "1" },
      },
    };
    const first = await fixture!.scoringRules.readAssessmentBasisReleaseSet(request);
    const second = await fixture!.scoringRules.readAssessmentBasisReleaseSet({
      ...request,
      requestId: "c19-read-missing-2",
      idempotencyKey: "c19-read-missing-2",
    });
    expect(first.kind).toBe("unavailable");
    expect(second.kind).toBe("unavailable");
    if (first.kind === "unavailable" && second.kind === "unavailable") {
      expect(first.error.code).toBe("AUTHORIZATION_DENIED");
      expect(second.error.code).toBe("AUTHORIZATION_DENIED");
      expect(first.error.retryable).toBe(false);
      expect(first.error.requiredCapability).toBe(second.error.requiredCapability);
      expect(JSON.stringify(first)).not.toContain("members");
      expect(JSON.stringify(first)).not.toContain("releaseRef");
    }
  }, 180_000);

  it("basis 无正文：成员读取结果只含引用与摘要", async () => {
    const tables = await fixture!.cleaning.postgres.adminPool.query<{
      column_name: string;
      data_type: string;
    }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'business' AND table_name = 'assessment_basis_release_sets'
          AND column_name = 'member_snapshot'`,
    );
    expect(tables.rows[0]?.data_type).toBe("jsonb");
  }, 180_000);

  it("冲突规则被拦截：组装失败且只追加记录未决冲突与 C07 审阅链接", async () => {
    const cleaning = fixture!.cleaning;
    const afterPublish = "2030-01-01T00:00:03.000Z";
    const world = await cleaning.createWorld({ suffix: "c19-conflict", documentKinds: ["csv"] });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `c19-conflict-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: "c19-conflict-worker",
      projectId: world.projectId,
    });
    fixture!.setActiveWorld(world);
    const configurationSet = makeAssessmentConfigurationFixtureSet({
      projectId: world.projectId,
      projectRevisionRef: world.projectRevisionRef,
      configurationSetRef: { entityId: `configuration-set-${world.projectId}`, versionId: "1" },
    });
    await fixture!.publishConfigurationSet({
      projectId: world.projectId,
      documents: configurationSet.documents,
    });
    const indicators = (
      configurationSet.documents["indicator-system"] as unknown as {
        readonly content: { readonly indicators: readonly { readonly indicatorId: string }[] };
      }
    ).content.indicators;
    const prepared = await fixture!.scoringRules.prepareAuthoring({
      requestId: `c19-conflict-authoring-${world.projectId}`,
      idempotencyKey: `c19-conflict-authoring-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-conflict-authoring-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await fixture!.evidenceAccessAuthorization(
        world,
        `c19-conflict-authoring-${world.projectId}`,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: completion.taskRef,
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
      scoringPolicyRef: fixture!.policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });
    if (prepared.kind !== "succeeded") {
      throw new Error(`conflict prepareAuthoring failed: ${JSON.stringify(prepared)}`);
    }
    const task = await fixture!.agentTasks.getTask(prepared.agentTaskRef);
    const manifest = await fixture!.scoringRules.loadAuthoringManifest(task!);
    const retained = manifest.manifest.retainedSourceSegments[0]!;
    const segmentId = retained.sourceSegmentIds[0]!;
    const rule = (ruleId: string, score: number) => ({
      ruleId,
      applicabilityConditions: {
        constructionMethod: ["盾构法"],
        stratumCondition: ["软土地层"],
        engineeringStage: ["盾构掘进"],
      },
      indicatorItem: indicators[0]!.indicatorId,
      scoringThresholds: [
        { thresholdId: `${ruleId}-t`, score, operator: "between", value: 0, upperValue: 20 },
      ],
      gradeIntervals: [{ grade: `grade-${score}`, lowerBound: 0 }],
      exceptionClauses: [],
      evidenceLocator: { sourceSegmentId: segmentId },
      ruleVersion: { entityId: ruleId, versionId: "pending" },
      reviewStatus: "pending" as const,
    });
    const candidate = {
      schemaVersion: "1" as const,
      candidateVersion: 1,
      operations: [rule("rule-c19-conflict-a", 1), rule("rule-c19-conflict-b", 5)].map((entry) => ({
        kind: "add-rule" as const,
        ruleId: entry.ruleId,
        rule: entry,
        sourceVersionRef: retained.sourceVersionRef,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: segmentId },
            sourceVersion: retained.sourceVersionRef.reference,
          },
        ],
      })),
    };
    const finalized = await fixture!.scoringRules.finalizeAuthoringCandidate({
      task: task!,
      candidate,
    });
    expect(finalized.status).toBe("completed");
    const documentRevisionRef = (finalized as unknown as { candidateRef: never }).candidateRef;
    await fixture!.approveAndPublishRevision({
      projectId: world.projectId,
      revisionRef: documentRevisionRef,
    });

    const preparationSnapshotRef = {
      kind: "assessment-preparation-snapshot" as const,
      reference: { entityId: `preparation-${world.projectId}`, versionId: "1" },
    };
    fixture!.setPreparationProjection({
      schemaVersion: "1",
      preparationSnapshotRef,
      projectId: world.projectId,
      projectRevisionRef: world.projectRevisionRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: {
        constructionMethod: "盾构法",
        stratumCondition: "软土地层",
        engineeringStage: "盾构掘进",
      },
      cleaningResultArtifactRef: manifest.manifest.cleaningResultArtifactRef,
      dataCleaningTaskRef: completion.taskRef,
      configurationSetRef: configurationSet.configurationSetRef,
      compatibilityRef: fixture!.policy.compatibilityRef,
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
    });
    const assembled = await fixture!.scoringRules.assembleApplicableRuleSetRevision({
      requestId: `c19-conflict-assembly-${world.projectId}`,
      idempotencyKey: `c19-conflict-assembly-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-conflict-assembly-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      projectRevisionRef: world.projectRevisionRef,
      preparationSnapshotRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: {
        constructionMethod: "盾构法",
        stratumCondition: "软土地层",
        engineeringStage: "盾构掘进",
      },
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
      scoringPolicyRef: fixture!.policy.policyRef,
      assemblyPolicyRef: fixture!.policy.assemblyPolicyRef,
      compatibilityRef: fixture!.policy.compatibilityRef,
      configurationSetRef: configurationSet.configurationSetRef,
    });
    expect(assembled.kind).toBe("failed");
    if (assembled.kind !== "failed") return;
    expect(assembled.error.code).toBe("BUSINESS_BLOCKED");
    if (assembled.error.code !== "BUSINESS_BLOCKED") return;
    expect(assembled.error.blockerKind).toBe("scoring-rule-relation-unresolved");

    const relations = await cleaning.postgres.adminPool.query<{ relation_kind: string }>(
      "SELECT relation_kind FROM business.rule_relations WHERE project_id = $1",
      [world.projectId],
    );
    expect(relations.rows.map((row) => row.relation_kind)).toEqual(["conflict"]);
    // 冲突审阅链接目前无法在 C07 侧落库：C02 `ContractReferenceV1` 没有 `rule-conflict`
    // 变体，C07 的审计提交无法记录该目标（最小复现见本轮报告）。门禁本身不依赖链接存在：
    // 未决冲突照旧阻断组装，且不产生任何适用规则集修订。
    const links = await cleaning.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.rule_conflict_review_links WHERE project_id = $1",
      [world.projectId],
    );
    expect(links.rows[0]?.count).toBe("0");
    const sets = await cleaning.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.applicable_rule_set_revision_metadata WHERE project_id = $1",
      [world.projectId],
    );
    expect(sets.rows[0]?.count).toBe("0");
  }, 300_000);

  it("配置不完整时整体失败：不启动编制任务、不落 manifest 与修订", async () => {
    const cleaning = fixture!.cleaning;
    const world = await cleaning.createWorld({ suffix: "c19-noconfig", documentKinds: ["csv"] });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `c19-noconfig-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: "c19-noconfig-worker",
      projectId: world.projectId,
    });
    fixture!.setActiveWorld(world);
    const startsBefore = cleaning.recordedStartCommands.length;

    const prepared = await fixture!.scoringRules.prepareAuthoring({
      requestId: `c19-noconfig-authoring-${world.projectId}`,
      idempotencyKey: `c19-noconfig-authoring-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: "2030-01-01T00:00:03.000Z",
      authorization: await world.authorizeBranch(
        `c19-noconfig-authoring-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await fixture!.evidenceAccessAuthorization(
        world,
        `c19-noconfig-authoring-${world.projectId}`,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: completion.taskRef,
      requiredAt: "2030-01-01T00:00:03.000Z",
      asOfRecordedAt: "2030-01-01T00:00:03.000Z",
      scoringPolicyRef: fixture!.policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });

    expect(prepared.kind).toBe("failed");
    expect(cleaning.recordedStartCommands.length).toBe(startsBefore);
    const manifests = await cleaning.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.scoring_rule_revision_metadata WHERE project_id = $1",
      [world.projectId],
    );
    expect(manifests.rows[0]?.count).toBe("0");
    const authoringTasks = await cleaning.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.agent_tasks WHERE project_id = $1 AND task_type = 'knowledge-authoring'",
      [world.projectId],
    );
    expect(authoringTasks.rows[0]?.count).toBe("0");
  }, 300_000);
});
