import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GB50911_SOFT_SOIL_BANDS,
  gb50911GradeIntervals,
  gb50911ScoringThresholds,
} from "../../../core/test/scoring-rules/standard-fixture.js";
import {
  PRODUCTION_BASIS_APPLICABILITY,
  startProductionAssessmentBasisFixture,
  type ProductionBasisFixtureV1,
  type ProductionBasisWorldV1,
} from "./production-assessment-basis.fixture.js";

/**
 * IP-04 / D-12 生产评估依据链路的完整顺序证据：真实 C15 收口 → C18 配置发布 → C19 规则编制
 * → C16/C07 审核规则 → C11 冻结准备 → C19 组装并派生发布适用规则集 → C19 公共解析。
 * 全部走真实 C06 会话与真实治理事务，没有授权替身，也没有预造的引用。
 *
 * 合成样本、待甲方复核：条文摘录、指标体系与量化标准均非甲方审核结论。
 */
describe.sequential("IP-04 生产评估依据装配（真实 C06/C15/C16/C18/C19）", () => {
  let fixture: ProductionBasisFixtureV1 | undefined;
  /** 真实准备世界：后续两个用例复用同一次收口与配置发布，不重复搭建。 */
  let world: ProductionBasisWorldV1 | undefined;
  /** 真实 C19 编制交接：manifest 冻结的精确清洗任务与资料段。 */
  let sourceSegmentIds: readonly string[] = [];

  const requireFixture = (): ProductionBasisFixtureV1 => {
    if (fixture === undefined) throw new Error("production basis fixture is not started");
    return fixture;
  };
  const requireWorld = (): ProductionBasisWorldV1 => {
    if (world === undefined) throw new Error("production basis world is not prepared");
    return world;
  };

  /**
   * 一条真实三维域命中的规则：以已发布 C18 指标体系中的指标项为 `indicatorItem`，
   * 适用性三维与本 world 的合成适用性一致，因此组装阶段按三维命中纳入。
   */
  const ruleOperationsFor = (basis: ProductionBasisWorldV1) => {
    const segmentId = sourceSegmentIds[0]!;
    return [
      {
        kind: "add-rule" as const,
        ruleId: "rule-production-basis-soft-soil",
        rule: {
          ruleId: "rule-production-basis-soft-soil",
          applicabilityConditions: {
            constructionMethod: [PRODUCTION_BASIS_APPLICABILITY.constructionMethod],
            stratumCondition: [PRODUCTION_BASIS_APPLICABILITY.stratumCondition],
            engineeringStage: [PRODUCTION_BASIS_APPLICABILITY.engineeringStage],
          },
          indicatorItem: basis.indicatorIds[0]!,
          scoringThresholds: gb50911ScoringThresholds(GB50911_SOFT_SOIL_BANDS),
          gradeIntervals: gb50911GradeIntervals(GB50911_SOFT_SOIL_BANDS),
          exceptionClauses: [],
          evidenceLocator: { sourceSegmentId: segmentId },
          ruleVersion: { entityId: "rule-production-basis-soft-soil", versionId: "pending" },
          reviewStatus: "pending" as const,
        },
        sourceVersionRef: basis.world.sourceVersionRefs()[0]!,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: segmentId },
            sourceVersion: basis.world.sourceVersionRefs()[0]!.reference,
          },
        ],
      },
    ];
  };

  beforeAll(async () => {
    fixture = await startProductionAssessmentBasisFixture();
    world = await requireFixture().prepareWorld("production-basis");
    // 编制来源必须是本次 C15 已收口的清洗结果：资料段取自该任务冻结的输入。
    const authoring = await requireFixture().scoringRules.prepareAuthoring({
      requestId: `production-basis-source-${world.world.projectId}`,
      idempotencyKey: `production-basis-source-${world.world.projectId}`,
      projectId: world.world.projectId,
      actorId: world.actorId,
      requestedAt: "2030-01-01T00:00:03.000Z",
      authorization: await world.authorize(
        "knowledge-modeling.assessment-basis",
        `production-basis-source-${world.world.projectId}`,
      ),
      // C19 用 requestId 作为 C15 结果读取的 C06 调用标识，签发必须同标识。
      dataCleaningAuthorization: await world.authorizeDataCleaningRead(
        `production-basis-source-${world.world.projectId}`,
      ),
      projectRevisionRef: world.world.projectRevisionRef,
      dataCleaningTaskRef: world.dataCleaningTaskRef,
      requiredAt: "2030-01-01T00:00:03.000Z",
      asOfRecordedAt: "2030-01-01T00:00:03.000Z",
      scoringPolicyRef: requireFixture().policy.policyRef,
      sourceStandardKinds: ["国家规范"],
    });
    if (authoring.kind !== "succeeded") {
      throw new Error(`prepareAuthoring failed: ${JSON.stringify(authoring).slice(0, 800)}`);
    }
    const task = await requireFixture().agentTasks.getTask(authoring.agentTaskRef);
    if (task === undefined) throw new Error("authoring task was not persisted");
    const { manifest } = await requireFixture().scoringRules.loadAuthoringManifest(task);
    // manifest 记录的清洗任务必须与 C15 实际收口的任务一致：编制来源不能是别的任务。
    expect(manifest.dataCleaningTaskRef.reference.entityId).toBe(
      world.dataCleaningTaskRef.reference.entityId,
    );
    sourceSegmentIds = manifest.retainedSourceSegments[0]!.sourceSegmentIds;
  }, 240_000);

  afterAll(async () => {
    await requireFixture().close();
  });

  it("C15 真实收口产出清洗任务，C18 十一类配置经 C16/C07 审核发布", async () => {
    const basis = requireWorld();
    const task = await basis.cleaningTaskAdapter.getTask(basis.dataCleaningTaskRef);
    expect(task?.state.status).toBe("completed");

    // C18 十一类配置各自形成一个已发布配置发布集：发布是审核决定的产物，不存在独立入口。
    const releases = await requireFixture().cleaning.postgres.adminPool.query<{
      definition_type: string;
      count: string;
    }>(
      `SELECT definition_type, count(*)::text AS count
         FROM business.knowledge_releases
        WHERE project_id = $1 AND review_decision_ref IS NOT NULL
        GROUP BY definition_type ORDER BY definition_type`,
      [basis.world.projectId],
    );
    expect(releases.rows.length).toBe(11);
    expect(releases.rows.every((row) => Number(row.count) === 1)).toBe(true);
  });

  it("C19 编制来源绑定真实已收口清洗任务", async () => {
    // 资料段来自本次清洗收口，而不是预置清单。
    expect(sourceSegmentIds.length).toBeGreaterThan(0);
    const persisted = await requireFixture().cleaning.postgres.adminPool.query<{
      count: string;
    }>(
      `SELECT count(*)::text AS count
         FROM business.source_segments
        WHERE project_id = $1 AND source_segment_id = ANY($2::text[])`,
      [requireWorld().world.projectId, sourceSegmentIds as never],
    );
    expect(Number(persisted.rows[0]!.count)).toBe(sourceSegmentIds.length);
  });

  it("已发布配置与规则经 C11 准备、C19 组装与公共解析形成实际评估依据", async () => {
    const basis = requireWorld();
    const published = await requireFixture().publishAssessmentBasis({
      world: basis,
      ruleOperations: ruleOperationsFor(basis),
    });

    // resolve 返回的是真实引用：C25 消费它，不需要夹具预造固定 basis ref。
    expect(published.assessmentBasisReleaseSetRef.kind).toBe("assessment-basis-release-set");
    expect(published.assessmentBasisReleaseSetRef.reference.entityId).toBeTruthy();
    expect(published.applicableRuleSetReleaseRef.kind).toBe("knowledge-release");

    // 准备投影由所属域提供：C11 生产读取返回的六字段与冻结准备同源。
    const read = await requireFixture().readAssessmentPreparationSnapshot({
      projectId: basis.world.projectId,
      actorId: basis.actorId,
      requestId: `production-basis-preparation-read-${basis.world.projectId}`,
      idempotencyKey: `production-basis-preparation-read-${basis.world.projectId}`,
      requestedAt: new Date().toISOString(),
      authorization: await basis.authorize(
        "knowledge-modeling.assessment-basis",
        `production-basis-preparation-read-${basis.world.projectId}`,
      ),
      preparationSnapshotRef: published.preparationSnapshotRef as never,
    });
    if (read.kind !== "succeeded") {
      throw new Error(`preparation read failed: ${JSON.stringify(read).slice(0, 800)}`);
    }
    expect(Object.keys(read.projection).sort()).toEqual([
      "applicability",
      "applicabilitySnapshotRef",
      "preparationSnapshotRef",
      "projectId",
      "projectRevisionRef",
      "schemaVersion",
    ]);
    expect(read.projection.preparationSnapshotRef).toEqual(published.preparationSnapshotRef);
    expect(read.projection.projectRevisionRef).toEqual(basis.world.projectRevisionRef);

    // 依据集合真实持久：按 resolve 的实际引用回读数据库行，而非夹具内构造的结果。
    const basisSets = await requireFixture().cleaning.postgres.adminPool.query<{
      set_id: string;
      applicable_rule_set_release_id: string;
      configuration_set_ref: { entityId: string; versionId: string };
    }>(
      `SELECT set_id, applicable_rule_set_release_id, configuration_set_ref
         FROM business.assessment_basis_release_sets
        WHERE project_id = $1`,
      [basis.world.projectId],
    );
    const persisted = basisSets.rows.find(
      (row) => row.set_id === published.assessmentBasisReleaseSetRef.reference.entityId,
    );
    expect(persisted).toBeDefined();
    // 依据集合指向已审核发布的适用规则集发布集，不指向候选修订。
    expect(persisted?.applicable_rule_set_release_id).toBe(
      published.applicableRuleSetReleaseRef.reference.entityId,
    );
    expect(persisted?.configuration_set_ref).toEqual(basis.configurationSetRef);
  }, 240_000);
});
