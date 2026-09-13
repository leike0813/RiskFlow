import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  RuleConflictRefV1Schema,
  ReviewTaskRefV1Schema,
  type AssessmentBasisReleaseSetRefV1,
  type KnowledgeRevisionRefV1,
} from "@riskflow/contracts/ports";
import type { StructuredScoringRule } from "@riskflow/contracts/records";
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
import { freezeIdentificationPreparation } from "../engineering-data/cleaning/fixture.js";

const authoringActor = "manager-1";
const CHAIN_APPLICABILITY = {
  constructionMethod: "盾构法",
  stratumCondition: "软土地层",
  engineeringStage: "盾构掘进",
} as const;

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

  it("真实规范：GB 50911-2013 条文段经 C15→C19→C16/C07 形成 RA-S3/S4 适用规则集与公共 assessment-basis（basis 成员读取）", async () => {
    const cleaning = fixture!.cleaning;
    const afterPublish = "2030-01-01T00:00:03.000Z";
    const world = await cleaning.createWorld({
      suffix: "c19-real-standard",
      documentKinds: ["docx"],
      documents: [realStandardCleaningDocument()],
    });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `c19-real-standard-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: "c19-real-standard-worker",
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

    // C19 只经注入的 C15 公共 reader 消费 result/artifact：其返回的 result artifact
    // 必须与 manifest 绑定的一致（读取接缝的调用次数与入参由下一用例断言）。
    const prepared = await fixture!.scoringRules.prepareAuthoring({
      requestId: `c19-real-standard-authoring-${world.projectId}`,
      idempotencyKey: `c19-real-standard-authoring-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-real-standard-authoring-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await fixture!.evidenceAccessAuthorization(
        world,
        `c19-real-standard-authoring-${world.projectId}`,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: completion.taskRef,
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
      scoringPolicyRef: fixture!.policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });
    if (prepared.kind !== "succeeded") {
      throw new Error(`prepareAuthoring failed: ${JSON.stringify(prepared)}`);
    }
    const task = await fixture!.agentTasks.getTask(prepared.agentTaskRef);
    const loaded = await fixture!.scoringRules.loadAuthoringManifest(task!);
    expect(loaded.manifest.sourceStandardKinds).toEqual(["国家规范"]);
    expect(loaded.manifest.retainedSourceSegments).toHaveLength(1);
    expect(loaded.manifest.dataCleaningTaskRef.reference).toEqual(completion.taskRef.reference);
    const retained = loaded.manifest.retainedSourceSegments[0]!;

    // 真实条文段定位：C15 冻结文档的段落定位带 GB 50911-2013 章节号标题。
    const frozen = await cleaning.store.loadFrozenInput(
      (await cleaning.agentTaskAdapter.getTask(completion.taskRef))!,
    );
    const document = frozen.documents.find(
      (entry) =>
        entry.sourceVersionRef.reference.entityId === retained.sourceVersionRef.reference.entityId,
    )!;
    // 每个条文在 DOCX 中是「标题段 + 正文段」两个块：按夹具的标题文本定位条文标题段，
    // 其后的同标题段即条文正文段（规则证据指向条文正文）。
    const clauseSegment = (clauseNumber: string) => {
      const clause = GB50911_CLAUSES.find((entry) => entry.clauseNumber === clauseNumber)!;
      const heading = `${clause.clauseNumber} ${clause.kind}（PDF 第 ${clause.pdfPage} 页）`;
      const index = document.segments.findIndex(
        (segment) =>
          segment.locator.kind === "document" && segment.locator.headingPath.includes(heading),
      );
      expect(index).toBeGreaterThanOrEqual(0);
      return document.segments[index + 1]!;
    };
    const settlementSegment = clauseSegment("9.2.2");
    const applicabilitySegment = clauseSegment("3.1.1");
    const warningSegment = clauseSegment("9.1.5");
    const controlValueTable = document.segments.find((segment) => segment.kind === "table")!;
    expect(retained.sourceSegmentIds).toContain(settlementSegment.sourceSegmentId);
    expect(retained.sourceSegmentIds).toContain(applicabilitySegment.sourceSegmentId);
    expect(retained.sourceSegmentIds).toContain(warningSegment.sourceSegmentId);
    expect(retained.sourceSegmentIds).toContain(controlValueTable.sourceSegmentId);
    expect(settlementSegment.textBlockIds.length).toBeGreaterThan(0);

    const observation = await fixture!.scoringRules.readStandardSegmentSlice(
      {
        kind: "read-standard-segment-slice",
        sourceVersionRef: retained.sourceVersionRef,
        sourceSegmentIds: [
          settlementSegment.sourceSegmentId,
          applicabilitySegment.sourceSegmentId,
          warningSegment.sourceSegmentId,
        ],
      },
      {
        task: task!,
        taskRef: task!.envelope.agentTaskRef,
        actionId: `${task!.envelope.agentTaskRef.reference.entityId}:segments`,
      },
    );
    expect(observation.effect).toBe("none");
    const observationBody = (await cleaning.readArtifact(
      observation.observationArtifactRef,
      task!.envelope.authorization,
      "knowledge-modeling.standard-segment-observation",
    )) as {
      readonly segments: readonly {
        readonly sourceSegmentId: string;
        readonly locator: {
          readonly kind: string;
          readonly headingPath?: readonly string[];
        };
      }[];
    };
    const observedSettlement = observationBody.segments.find(
      (segment) => segment.sourceSegmentId === settlementSegment.sourceSegmentId,
    )!;
    expect(observedSettlement.locator.kind).toBe("document");
    expect(observedSettlement.locator.headingPath?.join(" ")).toContain("9.2.2");

    const indicators = (
      configurationSet.documents["indicator-system"] as unknown as {
        readonly content: { readonly indicators: readonly { readonly indicatorId: string }[] };
      }
    ).content.indicators;
    // 表 9.2.2-2：中软~软弱土 15~25/25~35/35~45mm（3/4/5mm·d⁻¹）；坚硬~中硬土行留给三维筛除。
    const ruleFor = (ruleId: string, bands: typeof GB50911_SOFT_SOIL_BANDS) => ({
      ruleId,
      applicabilityConditions: {
        constructionMethod: [CHAIN_APPLICABILITY.constructionMethod],
        stratumCondition: [
          bands === GB50911_SOFT_SOIL_BANDS ? CHAIN_APPLICABILITY.stratumCondition : "坚硬~中硬土",
        ],
        engineeringStage: [CHAIN_APPLICABILITY.engineeringStage],
      },
      indicatorItem: indicators[0]!.indicatorId,
      scoringThresholds: gb50911ScoringThresholds(bands),
      gradeIntervals: gb50911GradeIntervals(bands),
      exceptionClauses: [],
      evidenceLocator: { sourceSegmentId: settlementSegment.sourceSegmentId },
      ruleVersion: { entityId: ruleId, versionId: "pending" },
      reviewStatus: "pending" as const,
    });
    const softSoilRuleId = "rule-gb50911-2013-table-9.2.2-2-soft-soil";
    const stiffSoilRuleId = "rule-gb50911-2013-table-9.2.2-2-stiff-soil";
    const candidate = {
      schemaVersion: "1" as const,
      candidateVersion: 1,
      operations: [
        ruleFor(softSoilRuleId, GB50911_SOFT_SOIL_BANDS),
        ruleFor(stiffSoilRuleId, GB50911_STIFF_SOIL_BANDS),
      ].map((rule) => ({
        kind: "add-rule" as const,
        ruleId: rule.ruleId,
        rule,
        sourceVersionRef: retained.sourceVersionRef,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: settlementSegment.sourceSegmentId },
            sourceVersion: retained.sourceVersionRef.reference,
          },
        ],
      })),
    };
    const validation = await fixture!.scoringRules.validateAuthoringCandidate({
      task: task!,
      candidate,
    });
    expect(validation.validationArtifactRef).toBeDefined();
    const finalized = await fixture!.scoringRules.finalizeAuthoringCandidate({
      task: task!,
      candidate,
    });
    expect(finalized.status).toBe("completed");
    if (finalized.status !== "completed") return;
    const revisions = await cleaning.postgres.adminPool.query<{ revision_id: string }>(
      "SELECT revision_id FROM business.scoring_rule_revision_metadata WHERE project_id = $1",
      [world.projectId],
    );
    expect(revisions.rows).toHaveLength(1);

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
      applicability: { ...CHAIN_APPLICABILITY },
      cleaningResultArtifactRef: loaded.manifest.cleaningResultArtifactRef,
      dataCleaningTaskRef: completion.taskRef,
      configurationSetRef: configurationSet.configurationSetRef,
      compatibilityRef: fixture!.policy.compatibilityRef,
      requiredAt: afterPublish,
      asOfRecordedAt: afterPublish,
    });

    const assemblyRequest = {
      requestId: `c19-real-standard-assembly-${world.projectId}`,
      idempotencyKey: `c19-real-standard-assembly-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-real-standard-assembly-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      projectRevisionRef: world.projectRevisionRef,
      preparationSnapshotRef,
      applicabilitySnapshotRef: world.applicabilitySnapshotRef,
      applicability: { ...CHAIN_APPLICABILITY },
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
    const setReleaseRef = await fixture!.approveAndPublishRevision({
      projectId: world.projectId,
      revisionRef: setRevisionRef,
    });
    expect(setReleaseRef.kind).toBe("knowledge-release");

    const resolution = await fixture!.scoringRules.resolve({
      kind: "assessment-basis",
      commandId: `c19-real-standard-resolve-${world.projectId}`,
      idempotencyKey: `c19-real-standard-resolve-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      issuedAt: afterPublish,
      authorization: await world.authorizeBranch(
        `c19-real-standard-resolve-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      branch: "knowledge-modeling.assessment-basis",
      payload: { preparationSnapshotRef, requiredAt: afterPublish },
    } as never);
    if (resolution.kind !== "succeeded") {
      throw new Error(`resolve failed: ${JSON.stringify(resolution)}`);
    }
    const basisReleaseSetRef = (
      resolution as unknown as {
        result: { assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1 };
      }
    ).result.assessmentBasisReleaseSetRef;

    const basisRead = await fixture!.scoringRules.readAssessmentBasisReleaseSet({
      requestId: `c19-real-standard-basis-read-${world.projectId}`,
      idempotencyKey: `c19-real-standard-basis-read-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: afterPublish,
      authorization: fixture!.authorize({
        projectId: world.projectId,
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: `c19-real-standard-basis-read-${world.projectId}`,
      }),
      assessmentBasisReleaseSetRef: basisReleaseSetRef,
    });
    if (basisRead.kind !== "succeeded") {
      throw new Error(`basis member read failed: ${JSON.stringify(basisRead)}`);
    }
    expect(basisRead.releaseSet.members.configurationMembers).toHaveLength(11);
    expect(basisRead.releaseSet.members.scoringRuleMembers).toHaveLength(1);
    expect(basisRead.releaseSet.members.applicableRuleSetMember.releaseRef).toEqual(setReleaseRef);
    expect(basisRead.releaseSet.memberDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(basisRead)).not.toContain("盾构法隧道地表沉降控制值");

    // 已发布的规则正文按真实控制值复算：等级边界与强制性条文档位一致。
    const ruleMember = basisRead.releaseSet.members.scoringRuleMembers[0]!;
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
    const cleaning = fixture!.cleaning;
    const world = await cleaning.createWorld({
      suffix: "c19-reader-seam",
      documentKinds: ["docx"],
      documents: [realStandardCleaningDocument()],
    });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: `c19-reader-seam-freeze-${world.projectId}`,
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, cleaning, {
      workerId: "c19-reader-seam-worker",
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
    const prepared = await fixture!.scoringRules.prepareAuthoring({
      requestId: `c19-reader-seam-authoring-${world.projectId}`,
      idempotencyKey: `c19-reader-seam-authoring-${world.projectId}`,
      projectId: world.projectId,
      actorId: authoringActor,
      requestedAt: "2030-01-01T00:00:03.000Z",
      authorization: await world.authorizeBranch(
        `c19-reader-seam-authoring-${world.projectId}`,
        "knowledge-modeling.assessment-basis",
      ),
      dataCleaningAuthorization: await fixture!.evidenceAccessAuthorization(
        world,
        `c19-reader-seam-authoring-${world.projectId}`,
      ),
      projectRevisionRef: world.projectRevisionRef,
      dataCleaningTaskRef: completion.taskRef,
      requiredAt: "2030-01-01T00:00:03.000Z",
      asOfRecordedAt: "2030-01-01T00:00:03.000Z",
      scoringPolicyRef: fixture!.policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });
    if (prepared.kind !== "succeeded") {
      throw new Error(`reader seam prepareAuthoring failed: ${JSON.stringify(prepared)}`);
    }
    expect(reader).toHaveBeenCalledTimes(1);
    const readerInput = reader.mock.calls[0]![0] as unknown as {
      readonly projectId: string;
      readonly actorId: string;
      readonly taskRef: { readonly reference: { readonly entityId: string } };
    };
    expect(readerInput.projectId).toBe(world.projectId);
    expect(readerInput.taskRef.reference.entityId).toBe(completion.taskRef.reference.entityId);
    if (prepared.kind === "succeeded") {
      const task = await fixture!.agentTasks.getTask(prepared.agentTaskRef);
      const loaded = await fixture!.scoringRules.loadAuthoringManifest(task!);
      expect(loaded.manifest.dataCleaningTaskRef.reference).toEqual(completion.taskRef.reference);
      expect(loaded.manifest.cleaningResultArtifactRef).toEqual(captured.value?.resultArtifactRef);
      expect(loaded.manifest.cleaningResultDigest).toMatch(/^[0-9a-f]{64}$/u);
    }
    reader.mockRestore();
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

  it("权限：跨工程与撤权后的 basis 读取统一不可枚举拒绝，actor 只取 C06 权威上下文", async () => {
    expect(chain).toBeDefined();
    const readWith = async (input: {
      readonly projectId: string;
      readonly requestActorId: string;
      readonly authorizationActorId: string;
      readonly entityId: string;
    }) =>
      fixture!.scoringRules.readAssessmentBasisReleaseSet({
        requestId: `c19-basis-denied-${input.entityId}`,
        idempotencyKey: `c19-basis-denied-${input.entityId}`,
        projectId: input.projectId,
        actorId: input.requestActorId,
        requestedAt: SCORING_RULES_TEST_ISSUED_AT,
        authorization: fixture!.authorize({
          projectId: input.projectId,
          actorId: input.authorizationActorId,
          branch: "knowledge-modeling.assessment-basis",
          entityId: input.entityId,
        }),
        assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
      });
    const crossProject = await readWith({
      projectId: "project-c19-foreign",
      requestActorId: authoringActor,
      authorizationActorId: authoringActor,
      entityId: "foreign-project",
    });
    // 请求声明的 actor 不参与授权：读取只能用 C06 复验后的权威上下文，且撤权后立即失效。
    const forgedActor = await readWith({
      projectId: chain!.projectId,
      requestActorId: "manager-forged",
      authorizationActorId: authoringActor,
      entityId: "forged-actor",
    });
    expect(forgedActor.kind).toBe("succeeded");
    const forgedAuthorizationRef = fixture!.authorize({
      projectId: chain!.projectId,
      actorId: authoringActor,
      branch: "knowledge-modeling.assessment-basis",
      entityId: "revoked-after-success",
    });
    const beforeRevocation = await fixture!.scoringRules.readAssessmentBasisReleaseSet({
      requestId: "c19-basis-revoked-before",
      idempotencyKey: "c19-basis-revoked-before",
      projectId: chain!.projectId,
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: forgedAuthorizationRef,
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    });
    expect(beforeRevocation.kind).toBe("succeeded");
    fixture!.revokeAuthorization(forgedAuthorizationRef.authorizationContextRef);
    const afterRevocation = await fixture!.scoringRules.readAssessmentBasisReleaseSet({
      requestId: "c19-basis-revoked-after",
      idempotencyKey: "c19-basis-revoked-after",
      projectId: chain!.projectId,
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: forgedAuthorizationRef,
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    });
    fixture!.restoreAuthorizations();
    expect(afterRevocation.kind).toBe("unavailable");
    if (afterRevocation.kind === "unavailable") {
      expect(afterRevocation.error.code).toBe("AUTHORIZATION_DENIED");
      expect(JSON.stringify(afterRevocation)).not.toContain("members");
    }
    for (const denied of [crossProject]) {
      expect(denied.kind).toBe("unavailable");
      if (denied.kind !== "unavailable") return;
      expect(denied.error.code).toBe("AUTHORIZATION_DENIED");
      expect(denied.error.retryable).toBe(false);
      expect(JSON.stringify(denied)).not.toContain("members");
    }
  }, 180_000);

  it("幂等与并发：同一组装请求重放返回同一修订且不新增事实", async () => {
    expect(chain).toBeDefined();
    const cleaning = fixture!.cleaning;
    const request = chain!.prepareRequest as never;
    const before = await cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
      [chain!.projectId],
    );
    const [replayed, concurrent] = await Promise.all([
      fixture!.scoringRules.assembleApplicableRuleSetRevision(request),
      fixture!.scoringRules.assembleApplicableRuleSetRevision(request),
    ]);
    if (replayed.kind !== "succeeded" || concurrent.kind !== "succeeded") {
      throw new Error(
        `assembly replay failed: ${JSON.stringify({ replayed, concurrent }).slice(0, 900)}`,
      );
    }
    if (replayed.kind !== "succeeded" || concurrent.kind !== "succeeded") return;
    expect(replayed.applicableRuleSetRevisionRef).toEqual(chain!.setRevisionRef);
    expect(concurrent.applicableRuleSetRevisionRef).toEqual(chain!.setRevisionRef);
    const after = await cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
      [chain!.projectId],
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  }, 300_000);

  it("事务失败回滚：注入组装事务故障后不产生部分规则集修订", async () => {
    expect(chain).toBeDefined();
    const cleaning = fixture!.cleaning;
    const before = await cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
      [chain!.projectId],
    );
    const request = {
      ...(chain!.prepareRequest as Record<string, unknown>),
      requestId: `c19-real-standard-assembly-rollback`,
      idempotencyKey: `c19-real-standard-assembly-rollback`,
    };
    fixture!.injectTransactionFailure("c19-real-standard-assembly-rollback");
    try {
      const failed = await fixture!.scoringRules.assembleApplicableRuleSetRevision(
        request as never,
      );
      expect(failed.kind).toBe("failed");
      if (failed.kind === "failed") {
        expect(["TRANSIENT_FAILURE", "TERMINAL_FAILURE"]).toContain(failed.error.code);
        expect(JSON.stringify(failed.error)).not.toContain(
          "injected scoring-rules transaction failure",
        );
      }
    } finally {
      fixture!.injectTransactionFailure(undefined);
    }
    const after = await cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND definition_type = 'applicable-rule-set'`,
      [chain!.projectId],
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  }, 300_000);

  it("basis 无正文：成员读取结果只含引用与摘要", async () => {
    const columns = await fixture!.cleaning.postgres.adminPool.query<{
      column_name: string;
      data_type: string;
    }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'business' AND table_name = 'assessment_basis_release_sets'
          AND column_name = 'member_snapshot'`,
    );
    expect(columns.rows[0]?.data_type).toBe("jsonb");

    expect(chain).toBeDefined();
    const read = await fixture!.scoringRules.readAssessmentBasisReleaseSet({
      requestId: `c19-basis-nobody-${chain!.projectId}`,
      idempotencyKey: `c19-basis-nobody-${chain!.projectId}`,
      projectId: chain!.projectId,
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: fixture!.authorize({
        projectId: chain!.projectId,
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: `c19-basis-nobody-${chain!.projectId}`,
      }),
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    });
    if (read.kind !== "succeeded") {
      throw new Error(`basis read failed: ${JSON.stringify(read)}`);
    }
    const memberKeys = Object.keys(read.releaseSet.members).sort();
    expect(memberKeys).toEqual([
      "applicableRuleSetMember",
      "configurationMembers",
      "scoringRuleMembers",
    ]);
    for (const member of [
      read.releaseSet.members.applicableRuleSetMember,
      ...read.releaseSet.members.scoringRuleMembers,
    ]) {
      expect(Object.keys(member).sort()).toEqual([
        "artifactRef",
        "contentDigest",
        "releaseRef",
        "revisionRef",
      ]);
    }
    for (const member of read.releaseSet.members.configurationMembers) {
      expect(Object.keys(member).sort()).toEqual([
        "artifactRef",
        "contentDigest",
        "definitionType",
        "releaseRef",
        "revisionRef",
      ]);
    }
    expect(JSON.stringify(read)).not.toContain("exceptionClauses");
    expect(JSON.stringify(read)).not.toContain("scoringThresholds");
  }, 180_000);

  it("basis 读取幂等：成功结果按同一摘要重放且不重复审计", async () => {
    expect(chain).toBeDefined();
    const cleaning = fixture!.cleaning;
    const request = {
      requestId: `c19-basis-replay-${chain!.projectId}`,
      idempotencyKey: `c19-basis-replay-${chain!.projectId}`,
      projectId: chain!.projectId,
      actorId: authoringActor,
      requestedAt: SCORING_RULES_TEST_ISSUED_AT,
      authorization: fixture!.authorize({
        projectId: chain!.projectId,
        actorId: authoringActor,
        branch: "knowledge-modeling.assessment-basis",
        entityId: `c19-basis-replay-${chain!.projectId}`,
      }),
      assessmentBasisReleaseSetRef: chain!.basisReleaseSetRef,
    };
    const first = await fixture!.scoringRules.readAssessmentBasisReleaseSet(request);
    const auditBefore = await cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit.entries
        WHERE project_id = $1 AND action LIKE 'knowledge.read-assessment-basis-release-set%'`,
      [chain!.projectId],
    );
    const second = await fixture!.scoringRules.readAssessmentBasisReleaseSet(request);
    const auditAfter = await cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit.entries
        WHERE project_id = $1 AND action LIKE 'knowledge.read-assessment-basis-release-set%'`,
      [chain!.projectId],
    );
    expect(first.kind).toBe("succeeded");
    expect(second.kind).toBe("succeeded");
    if (first.kind !== "succeeded" || second.kind !== "succeeded") return;
    expect(second.releaseSet.memberDigest).toBe(first.releaseSet.memberDigest);
    expect(second.releaseSet.members).toEqual(first.releaseSet.members);
    expect(auditAfter.rows[0]!.count).toBe(auditBefore.rows[0]!.count);
  }, 180_000);

  it("冲突规则被拦截：组装失败且只追加记录未决冲突与 C07 审阅链接", async () => {
    const cleaning = fixture!.cleaning;
    const afterPublish = "2030-01-01T00:00:03.000Z";
    const world = await cleaning.createWorld({
      suffix: "c19-conflict",
      documentKinds: ["docx"],
      documents: [realStandardCleaningDocument()],
    });
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
        constructionMethod: [CHAIN_APPLICABILITY.constructionMethod],
        stratumCondition: [CHAIN_APPLICABILITY.stratumCondition],
        engineeringStage: [CHAIN_APPLICABILITY.engineeringStage],
      },
      indicatorItem: indicators[0]!.indicatorId,
      scoringThresholds: [
        { thresholdId: `${ruleId}-t`, score, operator: "between", value: 15, upperValue: 25 },
      ],
      gradeIntervals: [{ grade: `grade-${ruleId}`, lowerBound: 15 }],
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
      applicability: { ...CHAIN_APPLICABILITY },
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
      applicability: { ...CHAIN_APPLICABILITY },
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

    const relations = await cleaning.postgres.adminPool.query<{
      relation_id: string;
      relation_kind: string;
    }>("SELECT relation_id, relation_kind FROM business.rule_relations WHERE project_id = $1", [
      world.projectId,
    ]);
    expect(relations.rows.map((row) => row.relation_kind)).toEqual(["conflict"]);
    const relation = relations.rows[0]!;

    // 未决冲突已由 C07 精确受理：链接恰好一条，仍为 pending，且只保存规则冲突引用。
    const conflictCommandId = `c19-conflict-assembly-${world.projectId}:conflict:${relation.relation_id}`;
    const links = await cleaning.postgres.adminPool.query<{
      relation_id: string;
      attempt: number;
      review_attempt_id: string;
      decision_ref: unknown;
      status: string;
      review_task_ref: unknown;
    }>(
      `SELECT relation_id, attempt, review_attempt_id, decision_ref, status, review_task_ref
         FROM business.rule_conflict_review_links
        WHERE project_id = $1 ORDER BY link_id`,
      [world.projectId],
    );
    expect(links.rows.map((row) => row.status)).toEqual(["pending"]);
    const link = links.rows[0]!;
    expect(link.relation_id).toBe(relation.relation_id);
    expect(link.attempt).toBe(1);
    expect(link.review_attempt_id).toBe(conflictCommandId);
    expect(link.decision_ref).toBeNull();
    const reviewTaskRef = ReviewTaskRefV1Schema.parse(link.review_task_ref);
    expect(reviewTaskRef.reviewType).toBe("rule-conflict");
    expect(RuleConflictRefV1Schema.parse(reviewTaskRef.targetRef)).toEqual({
      kind: "rule-conflict",
      reference: { entityId: `rule-relation:${relation.relation_id}`, versionId: "1" },
    });
    expect(reviewTaskRef.waitingRunRef.reference).toEqual({
      entityId: `${conflictCommandId}:run`,
      versionId: "1",
    });
    expect(Object.keys(reviewTaskRef).sort()).toEqual([
      "kind",
      "reference",
      "reviewType",
      "targetRef",
      "waitingRunRef",
    ]);

    const reviewTasks = await cleaning.postgres.adminPool.query<{
      target_kind: string;
      target_entity_id: string;
      target_version_id: string;
      target_ref: unknown;
      status: string;
    }>(
      `SELECT target_kind, target_entity_id, target_version_id, target_ref, status
         FROM business.review_tasks
        WHERE project_id = $1 AND review_type = 'rule-conflict' ORDER BY review_task_id`,
      [world.projectId],
    );
    expect(reviewTasks.rows.map((row) => row.status)).toEqual(["pending"]);
    expect(reviewTasks.rows[0]?.target_kind).toBe("rule-conflict");
    expect(reviewTasks.rows[0]?.target_entity_id).toBe(`rule-relation:${relation.relation_id}`);
    expect(reviewTasks.rows[0]?.target_version_id).toBe("1");
    expect(RuleConflictRefV1Schema.parse(reviewTasks.rows[0]?.target_ref)).toEqual({
      kind: "rule-conflict",
      reference: { entityId: `rule-relation:${relation.relation_id}`, versionId: "1" },
    });

    const sets = await cleaning.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.applicable_rule_set_revision_metadata WHERE project_id = $1",
      [world.projectId],
    );
    expect(sets.rows[0]?.count).toBe("0");
  }, 300_000);

  it("配置或冲突不完整时整体失败：不启动编制任务、不落 manifest 与修订", async () => {
    const cleaning = fixture!.cleaning;
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
