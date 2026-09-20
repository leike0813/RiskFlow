import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CancelAgentTaskCommandV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeResolutionCommandV1Schema,
  KnowledgeResolutionResultV1Schema,
  ModuleErrorV1Schema,
  ReviewDecisionCommandV1Schema,
  type AuthorizationContextV1,
  type KnowledgeDefinitionTypeV1,
  type KnowledgeGovernanceResultV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ModuleErrorV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import type {
  AgentTaskFailureEvidenceReadRequestV1,
  AgentTaskFailureEvidenceReaderV1,
} from "@riskflow/core/agent-runtime";

import { governedReleaseResolutionInvocationId } from "../../src/knowledge-governance/index.js";
import {
  IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1,
  PostgresIdentificationKnowledgeAdapter,
} from "../../src/identification-knowledge/index.js";
import {
  IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
  caseLibraryPackage,
  processModelPackage,
  retrievalEvidenceBasePackage,
  riskMechanismPackage,
  standardLibraryPackage,
  startIdentificationKnowledgeFixture,
  type IdentificationKnowledgeFixtureV1,
  type IdentificationPreparationWorldV1,
} from "./fixture.js";

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

// 双时间必须单调：每次提交、复核与发布都晚于前一步的记录时刻，否则 C16 会正确拒绝过期基线。
let clockMs = Date.parse("2030-01-02T01:00:00.000Z");
const tick = (): string => new Date((clockMs += 60_000)).toISOString();

/**
 * 关键路径不允许条件早退：任何未达期望的中间结果都必须让测试失败，而不是静默跳过断言。
 */
const revisionOf = (result: KnowledgeGovernanceResultV1, label: string): KnowledgeRevisionRefV1 => {
  if (result.kind !== "succeeded" || result.result.kind !== "revision") {
    throw new Error(`${label} did not produce a revision: ${JSON.stringify(result)}`);
  }
  return result.result.knowledgeRevisionRef;
};

const releaseOf = (result: KnowledgeGovernanceResultV1, label: string): KnowledgeReleaseRefV1 => {
  if (result.kind !== "succeeded" || result.result.kind !== "release") {
    throw new Error(`${label} did not produce a release: ${JSON.stringify(result)}`);
  }
  return result.result.knowledgeReleaseRef;
};

/** C08 不可枚举拒绝形状：与前置 change 的 `readTerminalFailure()` 完全一致。 */
const evidenceDenied = (requestId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: "agent-task.read-failure-evidence",
    occurredAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
    causalRunId: requestId,
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: "agent-task.read",
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  });

/** 窄读的同形拒绝之外的失败：收口必须可验上抛，不得当作已收口。 */
const evidenceTransient = (requestId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: "agent-task.read-failure-evidence",
    occurredAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
    causalRunId: requestId,
    code: "TRANSIENT_FAILURE",
    category: "technical",
    retryable: true,
    attempt: 1,
    retryPolicyRef: { entityId: "agent-task-read-retry", versionId: "1" },
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "agent-task-read-failure", versionId: "v1" },
    },
  });

const reviewTaskOf = (result: KnowledgeGovernanceResultV1, label: string): ReviewTaskRefV1 => {
  if (result.kind !== "succeeded" || result.result.kind !== "review-task") {
    throw new Error(`${label} did not produce a review task: ${JSON.stringify(result)}`);
  }
  return result.result.reviewTaskRef;
};

describe.sequential("PostgreSQL identification-knowledge adapter", () => {
  let fixture: IdentificationKnowledgeFixtureV1;

  beforeAll(async () => {
    fixture = await startIdentificationKnowledgeFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 60_000);

  const adapterFor = (options?: {
    readonly withPolicySet?: boolean;
    readonly releasePolicyFault?: "before-binding" | "after-binding";
  }): PostgresIdentificationKnowledgeAdapter =>
    fixture.createIdentificationKnowledgeAdapter(options).adapter;

  /** 编制入口的成功前置：任何未达成功的准备都必须让测试失败，而不是让后续断言静默跳过。 */
  const prepareAuthoring = async (
    adapter: PostgresIdentificationKnowledgeAdapter,
    suffix: string,
    world?: IdentificationPreparationWorldV1,
  ) => {
    const isolated = world ?? (await fixture.createPreparationWorld(suffix));
    const commandId = nextId(`c17-${suffix}-prepare`);
    const prepared = await adapter.prepareOrReplayAuthoringTask({
      projectId: isolated.projectId,
      actorId: isolated.readAuthorization.actorId,
      issuedAt: "2030-01-02T00:00:00.000Z",
      authorization: await fixture.authorizationFor(
        commandId,
        "knowledge-modeling.submit-revision",
        isolated.projectId,
      ),
      definitionType: "standard-library",
      preparationSnapshotRef: isolated.snapshotRef,
      parentRunRef: {
        kind: "workflow-run",
        reference: { entityId: `c17-${suffix}-run`, versionId: "1" },
      },
      commandId,
      idempotencyKey: commandId,
    });
    if (prepared.kind !== "succeeded") {
      throw new Error(
        `authoring preparation failed for ${suffix}: ${JSON.stringify(prepared.error)}`,
      );
    }
    return { isolated, prepared };
  };

  const countBinding = async (table: string, where: string, params: readonly unknown[]) => {
    const rows = await fixture.cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE ${where}`,
      [...params],
    );
    return rows.rows[0]?.count;
  };

  const identificationBasisEvents = async (): Promise<
    readonly {
      aggregate_ref: { reference: { entityId: string; versionId: string } };
      event_json: {
        payload: {
          publishedReleases: readonly { definitionType: string; releaseRef: unknown }[];
          retrievalEvidenceBaseReleaseRef: { reference: { entityId: string; versionId: string } };
        };
      };
    }[]
  > => {
    const rows = await fixture.cleaning.postgres.adminPool.query<{
      aggregate_ref: { reference: { entityId: string; versionId: string } };
      event_json: {
        payload: {
          publishedReleases: readonly { definitionType: string; releaseRef: unknown }[];
          retrievalEvidenceBaseReleaseRef: { reference: { entityId: string; versionId: string } };
        };
      };
    }>(
      `SELECT aggregate_ref, event_json FROM outbox.events
        WHERE project_id = $1 AND event_type = 'knowledge.identification-basis-published.v1'
        ORDER BY persisted_at, event_id`,
      [fixture.world.projectId],
    );
    return rows.rows;
  };

  /**
   * C16 当前生效发布：只经公共解析取得（停用/未生效的发布不作为修订基线）。
   */
  const resolveCurrentRelease = async (
    definitionType: KnowledgeDefinitionTypeV1,
  ): Promise<KnowledgeReleaseRefV1 | undefined> => {
    const requiredDefinitionTypes = [definitionType];
    const requiredAt = tick();
    const asOfRecordedAt = requiredAt;
    const resolution = await fixture.governance.resolveGovernedReleases({
      projectId: fixture.world.projectId,
      requiredDefinitionTypes,
      requiredAt,
      asOfRecordedAt,
      authorization: await fixture.authorizationFor(
        governedReleaseResolutionInvocationId({
          requiredDefinitionTypes,
          requiredAt,
          asOfRecordedAt,
        }),
        "knowledge-modeling.identification-basis",
      ),
    });
    return resolution.kind === "succeeded" ? resolution.result.releaseRefs[0] : undefined;
  };

  const submitPackage = async (
    adapter: PostgresIdentificationKnowledgeAdapter,
    definitionType:
      | "process-model"
      | "risk-mechanism"
      | "standard-library"
      | "case-library"
      | "retrieval-evidence-base",
    value: unknown,
    options?: { readonly evidence?: readonly unknown[]; readonly projectId?: string },
  ): Promise<KnowledgeGovernanceResultV1> => {
    const projectId = options?.projectId ?? fixture.world.projectId;
    const commandId = nextId(`c17-submit-${definitionType}`);
    const authorization = await fixture.authorizationFor(
      commandId,
      "knowledge-modeling.submit-revision",
      projectId,
    );
    // 每个提交必须是新的内容工件，否则 C16 会正确拒绝同一工件形成第二个修订。
    const unique = {
      ...(value as Record<string, unknown>),
      generatedAt: new Date(Date.parse("2030-01-01T00:00:00.000Z") + sequence * 1000).toISOString(),
    };
    // 已有发布时必须显式给出当前生效基线发布，C16 才允许形成下一个修订。
    const baseReleaseRef =
      options?.projectId === undefined || projectId === fixture.world.projectId
        ? await resolveCurrentRelease(definitionType)
        : undefined;
    const candidateArtifactRef = await fixture.putArtifact(
      unique,
      IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1,
      projectId,
    );
    return (await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "submit-revision",
        commandId,
        idempotencyKey: commandId,
        projectId,
        actorId: authorization.actorId,
        issuedAt: tick(),
        authorization,
        payload: {
          definitionType,
          ...(baseReleaseRef === undefined ? {} : { baseReleaseRef }),
          candidateArtifactRef,
          evidenceReferences: [...(options?.evidence ?? fixture.world.evidence.slice(0, 1))],
        },
      }),
    )) as KnowledgeGovernanceResultV1;
  };

  const decideReview = async (
    reviewTaskRef: ReviewTaskRefV1,
    authorization: AuthorizationContextV1,
    commandId: string,
    projectId: string,
  ) =>
    await fixture.reviewAudit.decideReview(
      ReviewDecisionCommandV1Schema.parse({
        kind: "decide-review",
        commandId,
        idempotencyKey: `${commandId}-key`,
        projectId,
        actorId: authorization.actorId,
        issuedAt: tick(),
        authorization,
        payload: {
          reviewTaskRef,
          targetRef: reviewTaskRef.targetRef,
          decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
          reasonCode: "reviewed",
        },
      }),
    );

  const requestAndApprove = async (
    adapter: PostgresIdentificationKnowledgeAdapter,
    revisionRef: KnowledgeRevisionRefV1,
    projectId: string = fixture.world.projectId,
  ) => {
    const requestCommandId = nextId("c17-request");
    const requestAuthorization = await fixture.authorizationFor(
      requestCommandId,
      "knowledge-modeling.request-review",
      projectId,
    );
    const requested = await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "request-review",
        commandId: requestCommandId,
        idempotencyKey: requestCommandId,
        projectId,
        actorId: requestAuthorization.actorId,
        issuedAt: tick(),
        authorization: requestAuthorization,
        payload: {
          revisionRef,
          reviewPolicyRef: { entityId: "c17-review-policy", versionId: "1" },
        },
      }),
    );
    const taskRef = reviewTaskOf(requested, "request-review");
    const decideCommandId = nextId("c17-decide");
    const decideAuthorization = await fixture.authorizationFor(
      decideCommandId,
      "review-audit.decide-review",
      projectId,
    );
    const decision = await decideReview(taskRef, decideAuthorization, decideCommandId, projectId);
    if (decision.kind !== "succeeded") {
      throw new Error(`review decision failed: ${JSON.stringify(decision)}`);
    }
    return decision.result.reviewDecisionRef;
  };

  const publishRevision = async (
    adapter: PostgresIdentificationKnowledgeAdapter,
    revisionRef: KnowledgeRevisionRefV1,
    projectId: string = fixture.world.projectId,
  ): Promise<{
    readonly releaseRef: KnowledgeReleaseRefV1;
    readonly reviewDecisionRef: ReviewDecisionRefV1;
  }> => {
    const reviewDecisionRef = await requestAndApprove(adapter, revisionRef, projectId);
    const publishCommandId = nextId("c17-publish");
    const publishAuthorization = await fixture.authorizationFor(
      publishCommandId,
      "knowledge-modeling.publish-approved-release",
      projectId,
    );
    const published = (await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "publish-approved-release",
        commandId: publishCommandId,
        idempotencyKey: publishCommandId,
        projectId,
        actorId: publishAuthorization.actorId,
        issuedAt: tick(),
        authorization: publishAuthorization,
        payload: {
          revisionRef,
          reviewDecisionRef,
          effectiveFrom: tick(),
        },
      }),
    )) as KnowledgeGovernanceResultV1;
    return { releaseRef: releaseOf(published, "publish"), reviewDecisionRef };
  };

  /** 提交并发布一个新包，返回其精确发布引用。 */
  const submitAndPublish = async (
    adapter: PostgresIdentificationKnowledgeAdapter,
    definitionType: Parameters<typeof submitPackage>[1],
    value: unknown,
  ): Promise<KnowledgeReleaseRefV1> => {
    const revisionRef = revisionOf(
      await submitPackage(adapter, definitionType, value),
      `${definitionType} submit`,
    );
    return (await publishRevision(adapter, revisionRef)).releaseRef;
  };

  it("accepts a complete process-model package, records validation and binds the revision", async () => {
    const adapter = adapterFor();
    const submitted = await submitPackage(
      adapter,
      "process-model",
      processModelPackage(fixture.builderInput()),
    );
    const revisionRef = revisionOf(submitted, "process-model submit");

    const rows = await fixture.cleaning.postgres.adminPool.query<{
      disposition: string;
      definition_type: string;
      binding_kind: string;
    }>(
      `SELECT v.disposition, v.definition_type, b.binding_kind
         FROM business.identification_knowledge_validations v
         JOIN business.identification_knowledge_revision_bindings b
           ON b.validation_id = v.validation_id AND b.validation_version_id = v.version_id
        WHERE v.project_id = $1 AND b.revision_id = $2`,
      [fixture.world.projectId, revisionRef.reference.entityId],
    );
    expect(rows.rows[0]).toMatchObject({
      disposition: "accepted",
      definition_type: "process-model",
      binding_kind: "validated",
    });
    expect(
      await countBinding("business.knowledge_revisions", "project_id = $1 AND revision_id = $2", [
        fixture.world.projectId,
        revisionRef.reference.entityId,
      ]),
    ).toBe("1");

    const releaseRef = (await publishRevision(adapter, revisionRef)).releaseRef;
    expect(
      await countBinding(
        "business.identification_knowledge_release_bindings",
        "project_id = $1 AND release_id = $2",
        [fixture.world.projectId, releaseRef.reference.entityId],
      ),
    ).toBe("1");
    // 四类成员发布不产生识别基础事件。
    expect(await identificationBasisEvents()).toHaveLength(0);

    const readCommandId = nextId("c17-read-exact");
    const read = await adapter.readExact({
      projectId: fixture.world.projectId,
      releaseRef,
      actorId: "c20-indexer",
      requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
      invocationId: readCommandId,
      authorization: await fixture.authorizationFor(
        readCommandId,
        "knowledge-modeling.identification-basis",
      ),
    });
    expect(read.kind).toBe("succeeded");
    if (read.kind === "failed") throw new Error(JSON.stringify(read.error));
    expect(read.read.package.definitionType).toBe("process-model");
    expect(read.read.validation.disposition).toBe("accepted");
    expect(read.read.releaseBinding.releaseRef).toEqual(releaseRef);

    const unknownCommandId = nextId("c17-read-unknown");
    const otherProject = await adapter.readExact({
      projectId: "project-unknown",
      releaseRef,
      actorId: "c20-indexer",
      requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
      invocationId: unknownCommandId,
      authorization: await fixture.authorizationFor(
        unknownCommandId,
        "knowledge-modeling.identification-basis",
      ),
    });
    expect(otherProject).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 300_000);

  it("rejects unknown fields, wrong project and unreachable evidence before any revision", async () => {
    const adapter = adapterFor();
    const input = fixture.builderInput();
    const unknownField = await submitPackage(adapter, "process-model", {
      ...processModelPackage(input),
      undeclaredField: true,
    });
    expect(unknownField).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "identification-knowledge-terminal" },
    });

    const wrongProject = await submitPackage(adapter, "process-model", {
      ...processModelPackage(input),
      projectId: "project-unknown",
    });
    expect(wrongProject).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const unreachableEvidence = await submitPackage(
      adapter,
      "process-model",
      processModelPackage({
        ...input,
        evidence: [
          {
            locator: { sourceSegmentId: "source-unknown-chapter-1-segment-1" },
            sourceVersion: fixture.world.snapshot.sourceVersionRefs[0]!.reference,
          },
        ],
      }),
    );
    expect(unreachableEvidence).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
    const rejected = await countBinding(
      "business.identification_knowledge_revision_bindings",
      "project_id = $1 AND binding_kind = 'validated' AND definition_type = 'process-model'",
      [fixture.world.projectId],
    );
    // 只有本文件首个用例的 process-model 修订被绑定，其余拒绝项没有形成修订。
    expect(rejected).toBe("1");
  }, 240_000);

  it("requires a validated binding before publishing and blocks failure-only revisions", async () => {
    const adapter = adapterFor();
    const missingCommandId = nextId("c17-publish-missing");
    const missingAuthorization = await fixture.authorizationFor(
      missingCommandId,
      "knowledge-modeling.publish-approved-release",
    );
    const eventsBefore = await identificationBasisEvents();
    const missing = await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "publish-approved-release",
        commandId: missingCommandId,
        idempotencyKey: `${missingCommandId}-key`,
        projectId: fixture.world.projectId,
        actorId: missingAuthorization.actorId,
        issuedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        authorization: missingAuthorization,
        payload: {
          revisionRef: {
            kind: "knowledge-revision",
            reference: { entityId: "unknown-revision", versionId: "1" },
          },
          reviewDecisionRef: {
            kind: "review-decision",
            reference: { entityId: "unknown-decision", versionId: "1" },
          },
          effectiveFrom: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        },
      }),
    );
    expect(missing).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
    if (missing.kind !== "failed")
      throw new Error("unknown revision publication unexpectedly passed");
    expect((missing.error as { blockerKind?: string }).blockerKind).not.toBe(
      "identification-knowledge-binding-required",
    );
    // 发布失败：事实、绑定与 Outbox 均不落地。
    expect(
      await countBinding(
        "business.knowledge_releases",
        "project_id = $1 AND revision_id = 'unknown-revision'",
        [fixture.world.projectId],
      ),
    ).toBe("0");
    expect(
      await countBinding(
        "business.identification_knowledge_release_bindings",
        "project_id = $1 AND revision_id = 'unknown-revision'",
        [fixture.world.projectId],
      ),
    ).toBe("0");
    expect(await identificationBasisEvents()).toHaveLength(eventsBefore.length);
  }, 240_000);

  it("publishes, rolls back and keeps the composite release binding and event atomic", async () => {
    const adapter = adapterFor();
    const world = fixture.world;
    const processModelRelease = await submitAndPublish(
      adapter,
      "process-model",
      processModelPackage(fixture.builderInput()),
    );
    const mechanismRelease = await submitAndPublish(
      adapter,
      "risk-mechanism",
      riskMechanismPackage({
        ...fixture.builderInput(),
        processModelReleaseRef: processModelRelease.reference,
      }),
    );
    const standardRelease = await submitAndPublish(
      adapter,
      "standard-library",
      standardLibraryPackage(fixture.builderInput()),
    );
    const caseRelease = await submitAndPublish(
      adapter,
      "case-library",
      caseLibraryPackage(fixture.builderInput()),
    );
    const compositeRevision = revisionOf(
      await submitPackage(
        adapter,
        "retrieval-evidence-base",
        retrievalEvidenceBasePackage({
          ...fixture.builderInput(),
          riskMechanismReleaseRef: mechanismRelease,
          standardLibraryReleaseRef: standardRelease,
          caseLibraryReleaseRef: caseRelease,
        }),
      ),
      "retrieval-evidence-base",
    );
    const compositePublished = await publishRevision(adapter, compositeRevision);
    const compositeRelease = compositePublished.releaseRef;

    const events = await identificationBasisEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.aggregate_ref.reference).toEqual(compositeRelease.reference);
    expect(
      events[0]?.event_json.payload.publishedReleases.map((entry) => entry.definitionType),
    ).toEqual([
      "process-model",
      "risk-mechanism",
      "standard-library",
      "case-library",
      "retrieval-evidence-base",
    ]);
    expect(events[0]?.event_json.payload.publishedReleases[0]?.releaseRef).toEqual(
      processModelRelease,
    );
    expect(events[0]?.event_json.payload.publishedReleases[1]?.releaseRef).toEqual(
      mechanismRelease,
    );
    expect(events[0]?.event_json.payload.publishedReleases[2]?.releaseRef).toEqual(standardRelease);
    expect(events[0]?.event_json.payload.publishedReleases[3]?.releaseRef).toEqual(caseRelease);
    expect(events[0]?.event_json.payload.retrievalEvidenceBaseReleaseRef.reference).toEqual(
      compositeRelease.reference,
    );
    const bindingAudit = await fixture.cleaning.postgres.adminPool.query<{
      audit_entry_id: string;
      release_audit: string;
    }>(
      `SELECT b.audit_entry_id,
              (SELECT release.audit_entry_id FROM business.knowledge_releases release
                WHERE release.release_id = b.release_id
                  AND release.version_id = b.release_version_id) AS release_audit
         FROM business.identification_knowledge_release_bindings b
        WHERE b.project_id = $1 AND b.release_id = $2`,
      [world.projectId, compositeRelease.reference.entityId],
    );
    expect(bindingAudit.rows).toHaveLength(1);
    // 同一发布事务里 C16 与 C17 事实共用一个审计条目，且该条目真实落库。
    expect(bindingAudit.rows[0]?.audit_entry_id).toBe(bindingAudit.rows[0]?.release_audit);
    expect(
      await countBinding("audit.entries", "audit_entry_id = $1", [
        bindingAudit.rows[0]?.audit_entry_id ?? "missing",
      ]),
    ).toBe("1");

    // 回滚到组合修订：新 release 在同一回滚事务内绑定到历史 revision 并重新发出事件。
    const rollbackCommandId = nextId("c17-rollback");
    const rollbackAuthorization = await fixture.authorizationFor(
      rollbackCommandId,
      "knowledge-modeling.rollback-by-new-release",
      world.projectId,
    );
    const rolledBack = releaseOf(
      await adapter.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "rollback-by-new-release",
          commandId: rollbackCommandId,
          idempotencyKey: rollbackCommandId,
          projectId: world.projectId,
          actorId: rollbackAuthorization.actorId,
          issuedAt: tick(),
          authorization: rollbackAuthorization,
          payload: {
            historicalReleaseRef: compositeRelease,
            reviewDecisionRef: compositePublished.reviewDecisionRef,
            reasonCode: "restore-composite",
          },
        }),
      ),
      "composite rollback",
    );
    expect(
      await countBinding(
        "business.identification_knowledge_release_bindings",
        "project_id = $1 AND release_id = $2 AND revision_id = $3",
        [world.projectId, rolledBack.reference.entityId, compositeRevision.reference.entityId],
      ),
    ).toBe("1");
    expect(await identificationBasisEvents()).toHaveLength(2);
  }, 600_000);

  it("rolls back binding and event faults inside the C16 publish transaction", async () => {
    const world = fixture.world;
    for (const fault of ["before-binding", "after-binding"] as const) {
      const adapter = adapterFor({ releasePolicyFault: fault });
      const eventsBefore = (await identificationBasisEvents()).length;
      const revisionRef = revisionOf(
        await submitPackage(adapter, "process-model", processModelPackage(fixture.builderInput())),
        `process-model for ${fault}`,
      );
      const reviewDecisionRef = await requestAndApprove(adapter, revisionRef, world.projectId);
      const publishCommandId = nextId(`c17-publish-${fault}`);
      const publishAuthorization = await fixture.authorizationFor(
        publishCommandId,
        "knowledge-modeling.publish-approved-release",
        world.projectId,
      );
      const published = await adapter.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "publish-approved-release",
          commandId: publishCommandId,
          idempotencyKey: publishCommandId,
          projectId: world.projectId,
          actorId: publishAuthorization.actorId,
          issuedAt: tick(),
          authorization: publishAuthorization,
          payload: {
            revisionRef,
            reviewDecisionRef,
            effectiveFrom: tick(),
          },
        }),
      );
      // 发布事务整体回滚：C16 release、C17 绑定、审计、回执与 Outbox 均不落地。
      expect(published).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
      expect(
        await countBinding("business.knowledge_releases", "project_id = $1 AND revision_id = $2", [
          world.projectId,
          revisionRef.reference.entityId,
        ]),
      ).toBe("0");
      expect(
        await countBinding(
          "business.identification_knowledge_release_bindings",
          "project_id = $1 AND revision_id = $2",
          [world.projectId, revisionRef.reference.entityId],
        ),
      ).toBe("0");
      expect(
        await countBinding(
          "business.command_receipts",
          "project_id = $1 AND command_id = $2 AND completed_at IS NOT NULL",
          [world.projectId, publishCommandId],
        ),
      ).toBe("0");
      expect(
        await countBinding("audit.entries", "project_id = $1 AND command_id = $2", [
          world.projectId,
          publishCommandId,
        ]),
      ).toBe("0");
      expect(await identificationBasisEvents()).toHaveLength(eventsBefore);
    }
  }, 600_000);

  it("resolves the exact identification basis from three main releases, composite members and policy set", async () => {
    const { adapter, assessmentBasisCommands } = fixture.createIdentificationKnowledgeAdapter();
    const currentReleaseRef = async (
      definitionType: KnowledgeDefinitionTypeV1,
    ): Promise<KnowledgeReleaseRefV1> => {
      const ref = await resolveCurrentRelease(definitionType);
      if (ref === undefined) throw new Error(`no effective ${definitionType} release`);
      return ref;
    };
    const processModelRef = await currentReleaseRef("process-model");
    const mechanismRef = await currentReleaseRef("risk-mechanism");
    const compositeRef = await currentReleaseRef("retrieval-evidence-base");

    const resolveCommand = async () => {
      const commandId = nextId("c17-resolve");
      const authorization = await fixture.authorizationFor(
        commandId,
        "knowledge-modeling.identification-basis",
      );
      return await adapter.resolve(
        KnowledgeResolutionCommandV1Schema.parse({
          kind: "identification-basis",
          commandId,
          idempotencyKey: commandId,
          projectId: fixture.world.projectId,
          actorId: authorization.actorId,
          issuedAt: tick(),
          authorization,
          payload: {
            preparationSnapshotRef: fixture.world.snapshotRef,
            requiredAt: tick(),
          },
        }),
      );
    };

    const resolved = await resolveCommand();
    if (resolved.kind === "failed") throw new Error(JSON.stringify(resolved.error));
    if (resolved.result.kind !== "identification-basis") {
      throw new Error(`unexpected resolution kind ${resolved.result.kind}`);
    }
    expect(resolved.result.processModelReleaseRef.reference).toEqual(processModelRef.reference);
    expect(resolved.result.riskMechanismReleaseRef.reference).toEqual(mechanismRef.reference);
    expect(resolved.result.retrievalEvidenceBaseReleaseRef.reference).toEqual(
      compositeRef.reference,
    );
    expect(resolved.result.identificationPolicySetRef.reference.entityId).toBe(
      `policy-set-${fixture.world.projectId}`,
    );
    // 相同请求重放返回同一四个精确引用。
    const replayed = await resolveCommand();
    expect(replayed).toMatchObject({
      kind: "succeeded",
      result: {
        processModelReleaseRef: { reference: processModelRef.reference },
        riskMechanismReleaseRef: { reference: mechanismRef.reference },
        retrievalEvidenceBaseReleaseRef: { reference: compositeRef.reference },
      },
    });
    // IP-11：identification 分支绝不触达 C19 assessment-basis delegate。
    expect(assessmentBasisCommands).toEqual([]);

    const withoutPolicySet = adapterFor({ withPolicySet: false });
    const noPolicyCommandId = nextId("c17-resolve-no-policy");
    const missingPolicy = await withoutPolicySet.resolve(
      KnowledgeResolutionCommandV1Schema.parse({
        kind: "identification-basis",
        commandId: noPolicyCommandId,
        idempotencyKey: noPolicyCommandId,
        projectId: fixture.world.projectId,
        actorId: fixture.world.readAuthorization.actorId,
        issuedAt: tick(),
        authorization: await fixture.authorizationFor(
          noPolicyCommandId,
          "knowledge-modeling.identification-basis",
        ),
        payload: {
          preparationSnapshotRef: fixture.world.snapshotRef,
          requiredAt: tick(),
        },
      }),
    );
    expect(missingPolicy).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "identification-policy-set-unavailable" },
    });
  }, 600_000);

  it("delegates the assessment basis to the injected C19 resolver without translation", async () => {
    const delegatedSuccess = KnowledgeResolutionResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "assessment-basis",
        assessmentBasisReleaseSetRef: {
          kind: "assessment-basis-release-set",
          reference: { entityId: "c19-assessment-basis", versionId: "7" },
        },
      },
    });
    const delegatedFailure = KnowledgeResolutionResultV1Schema.parse({
      kind: "failed",
      error: {
        stageCode: "scoring-rules.resolve-assessment-basis",
        occurredAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        causalRunId: "c19-assessment-basis-denied",
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "knowledge-modeling.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      },
    });
    let delegated: typeof delegatedSuccess | typeof delegatedFailure = delegatedSuccess;
    const { adapter, assessmentBasisCommands } = fixture.createIdentificationKnowledgeAdapter({
      assessmentBasisResolver: { resolve: async () => delegated },
    });
    const assessmentCommand = async () => {
      const commandId = nextId("c17-resolve-assessment");
      return KnowledgeResolutionCommandV1Schema.parse({
        kind: "assessment-basis",
        commandId,
        idempotencyKey: commandId,
        projectId: fixture.world.projectId,
        actorId: fixture.world.readAuthorization.actorId,
        issuedAt: tick(),
        authorization: await fixture.authorizationFor(
          commandId,
          "knowledge-modeling.assessment-basis",
        ),
        payload: {
          preparationSnapshotRef: {
            kind: "assessment-preparation-snapshot",
            reference: { entityId: "c19-preparation-snapshot", versionId: "5" },
          },
          requiredAt: tick(),
        },
      });
    };

    const successCommand = await assessmentCommand();
    expect(await adapter.resolve(successCommand)).toEqual(delegatedSuccess);
    delegated = delegatedFailure;
    const failureCommand = await assessmentCommand();
    expect(await adapter.resolve(failureCommand)).toEqual(delegatedFailure);
    // 逐字段透传：同一 strict 命令各一次原样到达 C19 delegate，无包装、无重试、无翻译。
    expect(assessmentBasisCommands).toEqual([successCommand, failureCommand]);

    // strict parse 失败仍在 C17 收口为 UNSUPPORTED_CONTRACT，且不调用 delegate。
    const unparseable = await assessmentCommand();
    const rejected = await adapter.resolve({
      ...unparseable,
      payload: { ...unparseable.payload, requiredAt: "not-a-timestamp" },
    } as never);
    expect(rejected).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
    expect(assessmentBasisCommands).toHaveLength(2);
  }, 600_000);

  it("rejects a composite release whose member is no longer effective", async () => {
    const adapter = adapterFor();
    const currentReleaseRef = async (
      definitionType: KnowledgeDefinitionTypeV1,
    ): Promise<KnowledgeReleaseRefV1> => {
      const ref = await resolveCurrentRelease(definitionType);
      if (ref === undefined) throw new Error(`no effective ${definitionType} release`);
      return ref;
    };
    const mechanismRef = await currentReleaseRef("risk-mechanism");
    const standardRef = await currentReleaseRef("standard-library");
    const caseRef = await currentReleaseRef("case-library");
    // 成员缺失或类型不匹配在读取正文前由确定性成员解析拒绝，不替换、不补齐。
    const swappedTypes = await submitPackage(
      adapter,
      "retrieval-evidence-base",
      retrievalEvidenceBasePackage({
        ...fixture.builderInput(),
        riskMechanismReleaseRef: mechanismRef,
        standardLibraryReleaseRef: caseRef,
        caseLibraryReleaseRef: standardRef,
      }),
    );
    expect(swappedTypes).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "identification-knowledge-terminal" },
    });
    const missingMember = await submitPackage(
      adapter,
      "retrieval-evidence-base",
      retrievalEvidenceBasePackage({
        ...fixture.builderInput(),
        riskMechanismReleaseRef: mechanismRef,
        standardLibraryReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "knowledge-release-missing", versionId: "1" },
        },
        caseLibraryReleaseRef: caseRef,
      }),
    );
    expect(missingMember).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "identification-knowledge-terminal" },
    });
    const deactivateCommandId = nextId("c17-deactivate");
    const deactivateAuthorization = await fixture.authorizationFor(
      deactivateCommandId,
      "knowledge-modeling.deactivate-release",
      fixture.world.projectId,
    );
    const deactivated = await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "deactivate-release",
        commandId: deactivateCommandId,
        idempotencyKey: deactivateCommandId,
        projectId: fixture.world.projectId,
        actorId: deactivateAuthorization.actorId,
        issuedAt: tick(),
        authorization: deactivateAuthorization,
        payload: { releaseRef: mechanismRef, reasonCode: "superseded" },
      }),
    );
    expect(deactivated).toMatchObject({ kind: "succeeded", result: { kind: "release" } });
    const eventsBefore = (await identificationBasisEvents()).length;
    const supersededRevision = revisionOf(
      await submitPackage(
        adapter,
        "retrieval-evidence-base",
        retrievalEvidenceBasePackage({
          ...fixture.builderInput(),
          riskMechanismReleaseRef: mechanismRef,
          standardLibraryReleaseRef: standardRef,
          caseLibraryReleaseRef: caseRef,
        }),
      ),
      "retrieval-evidence-base after deactivation",
    );
    // 提交阶段的成员解析只要求绑定存在，因此修订已成立；发布阶段再复验双时间有效性。
    const reviewDecisionRef = await requestAndApprove(
      adapter,
      supersededRevision,
      fixture.world.projectId,
    );
    const failedPublishCommandId = nextId("c17-publish-inactive-member");
    const failedPublishAuthorization = await fixture.authorizationFor(
      failedPublishCommandId,
      "knowledge-modeling.publish-approved-release",
      fixture.world.projectId,
    );
    const failedPublish = await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "publish-approved-release",
        commandId: failedPublishCommandId,
        idempotencyKey: failedPublishCommandId,
        projectId: fixture.world.projectId,
        actorId: failedPublishAuthorization.actorId,
        issuedAt: tick(),
        authorization: failedPublishAuthorization,
        payload: {
          revisionRef: supersededRevision,
          reviewDecisionRef,
          effectiveFrom: tick(),
        },
      }),
    );
    expect(failedPublish).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    // 失败发布整体回滚：没有新的 C16 release、没有 C17 绑定、没有新事件。
    expect(
      await countBinding("business.knowledge_releases", "project_id = $1 AND revision_id = $2", [
        fixture.world.projectId,
        supersededRevision.reference.entityId,
      ]),
    ).toBe("0");
    expect(
      await countBinding(
        "business.identification_knowledge_release_bindings",
        "project_id = $1 AND revision_id = $2",
        [fixture.world.projectId, supersededRevision.reference.entityId],
      ),
    ).toBe("0");
    expect(await identificationBasisEvents()).toHaveLength(eventsBefore);
  }, 600_000);

  const declareNodeOperations = (world: IdentificationPreparationWorldV1) =>
    (
      [
        ["node-authoring-1", "扩径准备"],
        ["node-authoring-2", "变径空间扩挖"],
        ["node-authoring-3", "刀盘扩径"],
        ["node-authoring-4", "盾体扩径"],
        ["node-authoring-5", "缩径转换"],
      ] as const
    ).map(([nodeId, processKind], index) => ({
      operation: "declare-node" as const,
      expectedBaselineDigest: "0".repeat(64),
      reasonCode: "declare-node",
      evidence: [world.evidence[0]],
      node: {
        nodeId,
        processKind,
        inputs: [`input-${index + 1}`],
        outputs: [`output-${index + 1}`],
        equipmentRefs: ["小盾构"],
        structuralComponentRefs: [],
        stateParameters: ["土仓/泥水压力"],
        monitoringIndicators: ["地表沉降"],
        applicability: {
          constructionMethod: ["variable-diameter-shield"],
          stratumCondition: ["soft-soil"],
          engineeringStage: ["expansion-preparation"],
        },
        evidence: [world.evidence[0]],
      },
    }));

  it("prepares a bounded authoring task, reads observations and finalizes a revision", async () => {
    const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter();
    const isolated = await fixture.createPreparationWorld("authoring");
    const workflowRunRef = {
      kind: "workflow-run" as const,
      reference: { entityId: "c17-authoring-run", versionId: "1" },
    };
    const commandId = nextId("c17-authoring-prepare");
    const prepared = await adapter.prepareOrReplayAuthoringTask({
      projectId: isolated.projectId,
      actorId: isolated.readAuthorization.actorId,
      issuedAt: "2030-01-02T00:00:00.000Z",
      authorization: await fixture.authorizationFor(
        commandId,
        "knowledge-modeling.submit-revision",
        isolated.projectId,
      ),
      definitionType: "process-model",
      preparationSnapshotRef: isolated.snapshotRef,
      parentRunRef: workflowRunRef,
      commandId,
      idempotencyKey: commandId,
    });
    expect(prepared.kind).toBe("succeeded");
    if (prepared.kind !== "succeeded") throw new Error(JSON.stringify(prepared.error));
    const attempt = await fixture.cleaning.postgres.adminPool.query<{ stage: string }>(
      `SELECT stage FROM business.identification_knowledge_authoring_attempts
        WHERE project_id = $1 AND agent_task_ref->'reference'->>'entityId' = $2`,
      [isolated.projectId, prepared.agentTaskRef.reference.entityId],
    );
    expect(attempt.rows[0]?.stage).toBe("task-started");
    const task = await agentTaskAdapter.getTask(prepared.agentTaskRef);
    expect(task?.envelope.taskType).toBe("knowledge-authoring");
    expect(task?.envelope.frozenInputRef).toEqual(prepared.manifestArtifactRef);
    if (task === undefined) throw new Error("the prepared authoring task is missing");
    // 清单冻结 strict 准备、正式清洗结果与逐来源保留/排除资料段。
    expect(prepared.manifest.members.length).toBeGreaterThanOrEqual(1);
    expect(prepared.manifest.members[0]?.retainedSegmentIds.length).toBeGreaterThanOrEqual(1);
    expect(prepared.manifest.preparation.includedSourceSegmentSetRefs.length).toBe(
      prepared.manifest.preparation.sourceVersionRefs.length,
    );

    const definition = adapter.createTaskDefinition();
    const [sliceTool, baselineTool] = definition.tools;
    if (sliceTool === undefined || baselineTool === undefined) {
      throw new Error("the authoring definition does not expose both read-only tools");
    }
    const observation = await sliceTool.execute(
      {
        kind: "read-knowledge-segment-slice",
        sourceSegmentSetRef: isolated.sourceSegmentSetRef,
        sourceSegmentIds: [isolated.evidence[0]!.locator.sourceSegmentId],
        limit: 2,
      },
      { task, taskRef: prepared.agentTaskRef, actionId: "c17-authoring-action-1" },
    );
    expect(observation.effect).toBe("none");
    expect(observation.observationArtifactRef).toMatchObject({ kind: "content-artifact" });

    // 越界成员必须在目标读取前拒绝：清单外集合、清单外资料段与清单外基线。
    const foreignSetRef = {
      kind: "source-segment-set" as const,
      reference: { entityId: "segment-set-not-frozen", versionId: "1" },
    };
    const foreignSetObservations = await countBinding(
      "business.engineering_data_read_query_results",
      "project_id = $1",
      [isolated.projectId],
    );
    await expect(
      sliceTool.execute(
        {
          kind: "read-knowledge-segment-slice",
          sourceSegmentSetRef: foreignSetRef,
          sourceSegmentIds: [isolated.evidence[0]!.locator.sourceSegmentId],
          limit: 2,
        },
        { task, taskRef: prepared.agentTaskRef, actionId: "c17-authoring-action-2" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    await expect(
      sliceTool.execute(
        {
          kind: "read-knowledge-segment-slice",
          sourceSegmentSetRef: isolated.sourceSegmentSetRef,
          sourceSegmentIds: ["segment-not-retained"],
          limit: 2,
        },
        { task, taskRef: prepared.agentTaskRef, actionId: "c17-authoring-action-3" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    await expect(
      sliceTool.execute(
        {
          kind: "read-knowledge-segment-slice",
          sourceSegmentSetRef: isolated.sourceSegmentSetRef,
          sourceSegmentIds: [isolated.evidence[0]!.locator.sourceSegmentId],
          limit: 4096,
        },
        { task, taskRef: prepared.agentTaskRef, actionId: "c17-authoring-action-4" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    await expect(
      baselineTool.execute(
        {
          kind: "read-exact-knowledge",
          definitionType: "process-model",
          releaseRef: {
            kind: "knowledge-release",
            reference: { entityId: "release-not-frozen", versionId: "1" },
          },
        },
        { task, taskRef: prepared.agentTaskRef, actionId: "c17-authoring-action-5" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    // 越界请求没有产生任何新的目标读取（C02 查询结果计数不变）。
    expect(
      await countBinding("business.engineering_data_read_query_results", "project_id = $1", [
        isolated.projectId,
      ]),
    ).toBe(foreignSetObservations);

    const candidate = {
      schemaVersion: "1",
      candidateVersion: 1,
      definitionType: "process-model",
      operations: declareNodeOperations(isolated),
    };
    const validation = await definition.validateCandidate(candidate, task);
    expect(validation.disposition).toBe("accepted");
    const result = await definition.finalizeCandidate(candidate, task);
    expect(result).toMatchObject({ kind: "agent-task-result", status: "completed" });
    const revisionRef = (result as { candidateRef?: { reference: KnowledgeRevisionRefV1 } })
      .candidateRef;
    if (revisionRef === undefined) throw new Error("the finalizer did not return a revision ref");
    expect(
      await countBinding(
        "business.identification_knowledge_revision_bindings",
        "project_id = $1 AND revision_id = $2 AND binding_kind = 'validated'",
        [isolated.projectId, revisionRef.reference.entityId],
      ),
    ).toBe("1");
    const completedAttempt = await fixture.cleaning.postgres.adminPool.query<{
      stage: string;
      result_revision_ref: { reference: { entityId: string } };
      receipts: string;
      audits: string;
    }>(
      `SELECT a.stage, a.result_revision_ref,
         (SELECT count(*)::text FROM business.command_receipts
           WHERE project_id = a.project_id AND command_id = $3 AND completed_at IS NOT NULL) AS receipts,
         (SELECT count(*)::text FROM audit.entries
           WHERE project_id = a.project_id AND command_id = $3) AS audits
       FROM business.identification_knowledge_authoring_attempts a
       WHERE a.project_id = $1 AND a.agent_task_ref->'reference'->>'entityId' = $2`,
      [
        isolated.projectId,
        prepared.agentTaskRef.reference.entityId,
        `${prepared.agentTaskRef.reference.entityId}:complete-attempt`,
      ],
    );
    expect(completedAttempt.rows[0]).toEqual({
      stage: "completed",
      result_revision_ref: revisionRef,
      receipts: "1",
      audits: "1",
    });
  }, 300_000);

  it("settles a cancelled authoring task into a failure-only revision and one review", async () => {
    const reads: AgentTaskFailureEvidenceReadRequestV1[] = [];
    const readerHolder: { reader?: AgentTaskFailureEvidenceReaderV1 } = {};
    // 收口只允许经注入的 C08 公共窄读：转发的仍是同一 adapter 的真实实现。
    const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: {
        readTerminalFailure: async (request) => {
          reads.push(request);
          if (readerHolder.reader === undefined) throw new Error("the reader is not wired");
          return await readerHolder.reader.readTerminalFailure(request);
        },
      },
    });
    readerHolder.reader = agentTaskAdapter;
    const { isolated, prepared } = await prepareAuthoring(adapter, "settlement");
    const taskEntityId = prepared.agentTaskRef.reference.entityId;
    // 任务仍在运行时 C08 窄读按「非终态」同形拒绝：不收口、不写任何失败事实，但原因必须可查。
    const pendingOutcome = await adapter.settleAuthoringFailures();
    expect(pendingOutcome.settled).toBe(0);
    expect(
      pendingOutcome.failures.find((failure) => failure.taskRef.reference.entityId === taskEntityId)
        ?.error,
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      projectId: isolated.projectId,
      taskRef: prepared.agentTaskRef,
      expectedTaskType: "knowledge-authoring",
      requestId: `${taskEntityId}:failure-evidence`,
      actorId: reads[0]?.authorization.actorId,
    });
    // 失败证据读取必须使用新鲜签发的唯一 `agent-task.read` 能力，不回退任务信封授权。
    expect(reads[0]?.authorization.grantedCapabilities).toEqual(["agent-task.read"]);
    const pending = await fixture.cleaning.postgres.adminPool.query<{
      stage: string;
      bindings: string;
      receipts: string;
    }>(
      `SELECT
         (SELECT stage FROM business.identification_knowledge_authoring_attempts
           WHERE project_id = $1 AND agent_task_ref->'reference'->>'entityId' = $2) AS stage,
         (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings
           WHERE project_id = $1 AND binding_kind = 'failure-review-only') AS bindings,
         (SELECT count(*)::text FROM business.command_receipts
           WHERE project_id = $1 AND command_id = $3) AS receipts`,
      [isolated.projectId, taskEntityId, `${taskEntityId}:failure-revision`],
    );
    expect(pending.rows[0]).toEqual({ stage: "task-started", bindings: "0", receipts: "0" });
    const cancelCommandId = nextId("c17-authoring-cancel");
    await agentTaskAdapter.cancelTask(
      CancelAgentTaskCommandV1Schema.parse({
        kind: "cancel-task",
        commandId: cancelCommandId,
        idempotencyKey: cancelCommandId,
        projectId: isolated.projectId,
        actorId: isolated.readAuthorization.actorId,
        issuedAt: "2030-01-02T00:00:00.000Z",
        authorization: await fixture.authorizationFor(
          cancelCommandId,
          "agent-task.cancel-task",
          isolated.projectId,
        ),
        payload: { agentTaskRef: prepared.agentTaskRef, reasonCode: "operator-cancelled" },
      }),
    );
    const settled = await adapter.settleAuthoringFailures();
    expect(settled).toMatchObject({ settled: 1, failures: [] });
    expect(reads).toHaveLength(2);
    expect(reads[1]?.taskRef).toEqual(prepared.agentTaskRef);
    const rows = await fixture.cleaning.postgres.adminPool.query<{
      binding_kind: string;
      stage: string;
      review_task_ref: unknown;
    }>(
      `SELECT b.binding_kind, a.stage, a.review_task_ref
         FROM business.identification_knowledge_authoring_attempts a
         JOIN business.identification_knowledge_revision_bindings b
           ON b.agent_task_ref->'reference'->>'entityId' = a.agent_task_ref->'reference'->>'entityId'
        WHERE a.project_id = $1 AND a.agent_task_ref->'reference'->>'entityId' = $2`,
      [isolated.projectId, prepared.agentTaskRef.reference.entityId],
    );
    expect(rows.rows[0]).toMatchObject({
      binding_kind: "failure-review-only",
      stage: "review-linked",
    });
    expect(rows.rows[0]?.review_task_ref).not.toBeNull();
    // 失败修订永不通过发布门：按失败绑定的精确 revision 重新发布也被拒。
    const failureBinding = await fixture.cleaning.postgres.adminPool.query<{
      revision_id: string;
      revision_version_id: string;
    }>(
      `SELECT revision_id, revision_version_id
         FROM business.identification_knowledge_revision_bindings
        WHERE project_id = $1 AND binding_kind = 'failure-review-only'`,
      [isolated.projectId],
    );
    const failureRevision = failureBinding.rows[0];
    if (failureRevision === undefined) throw new Error("the failure binding is missing");
    const failureRelease = await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "publish-approved-release",
        commandId: nextId("c17-publish-failure"),
        idempotencyKey: nextId("c17-publish-failure"),
        projectId: isolated.projectId,
        actorId: isolated.readAuthorization.actorId,
        issuedAt: "2030-01-02T00:01:00.000Z",
        authorization: await fixture.authorizationFor(
          nextId("c17-publish-failure-auth"),
          "knowledge-modeling.publish-approved-release",
          isolated.projectId,
        ),
        payload: {
          revisionRef: {
            kind: "knowledge-revision",
            reference: {
              entityId: failureRevision.revision_id,
              versionId: failureRevision.revision_version_id,
            },
          },
          reviewDecisionRef: {
            kind: "review-decision",
            reference: { entityId: "failure-decision-unknown", versionId: "1" },
          },
          effectiveFrom: "2030-01-02T00:01:00.000Z",
        },
      }),
    );
    expect(failureRelease).toMatchObject({
      kind: "failed",
      error: {
        code: "BUSINESS_BLOCKED",
        blockerKind: "identification-knowledge-binding-required",
      },
    });
    await expect(adapter.settleAuthoringFailures()).resolves.toMatchObject({
      settled: 0,
      failures: [],
    });
    // D-09 幂等：重放不创建第二个失败修订，也不重复挂复核任务。
    const replayRows = await fixture.cleaning.postgres.adminPool.query<{
      bindings: string;
      reviews: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings
           WHERE project_id = $1 AND binding_kind = 'failure-review-only') AS bindings,
         (SELECT count(*)::text FROM business.identification_knowledge_authoring_attempts
           WHERE project_id = $1 AND stage = 'review-linked' AND review_task_ref IS NOT NULL) AS reviews`,
      [isolated.projectId],
    );
    expect(replayRows.rows[0]).toEqual({ bindings: "1", reviews: "1" });
    const stageFacts = await fixture.cleaning.postgres.adminPool.query<{
      receipts: string;
      audits: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM business.command_receipts
           WHERE project_id = $1 AND completed_at IS NOT NULL AND command_id IN ($2, $3)) AS receipts,
         (SELECT count(*)::text FROM audit.entries
           WHERE project_id = $1 AND command_id IN ($2, $3)) AS audits`,
      [
        isolated.projectId,
        `${prepared.agentTaskRef.reference.entityId}:record-failure-attempt`,
        `${prepared.agentTaskRef.reference.entityId}:link-failure-review`,
      ],
    );
    expect(stageFacts.rows[0]).toEqual({ receipts: "2", audits: "2" });
  }, 300_000);

  it("keeps the attempt pending and writes nothing when the failure evidence read is denied", async () => {
    const reads: AgentTaskFailureEvidenceReadRequestV1[] = [];
    const { adapter } = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: {
        readTerminalFailure: async (request) => {
          reads.push(request);
          return { kind: "failed", error: evidenceDenied(request.requestId) };
        },
      },
    });
    const { isolated, prepared } = await prepareAuthoring(adapter, "settlement-denied");
    const taskEntityId = prepared.agentTaskRef.reference.entityId;
    // 同形拒绝不阻断收口循环，但原因必须进入可观察结果，不得静默丢弃。
    const outcome = await adapter.settleAuthoringFailures();
    expect(outcome.settled).toBe(0);
    const denialIds = outcome.failures.map((failure) => failure.taskRef.reference.entityId);
    expect(denialIds).toContain(taskEntityId);
    expect(
      outcome.failures.find((failure) => failure.taskRef.reference.entityId === taskEntityId)
        ?.error,
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    // 窄读确实按该 attempt 的精确任务引用发生过。
    expect(reads.some((request) => request.taskRef.reference.entityId === taskEntityId)).toBe(true);
    // 拒绝只停在最后成立阶段：没有诊断工件、失败修订、绑定、复核或命令回执。
    const state = await fixture.cleaning.postgres.adminPool.query<{
      stage: string;
      diagnostics: string;
      revisions: string;
      bindings: string;
      reviews: string;
      receipts: string;
    }>(
      `SELECT
         (SELECT stage FROM business.identification_knowledge_authoring_attempts
           WHERE project_id = $1 AND agent_task_ref->'reference'->>'entityId' = $2) AS stage,
         (SELECT count(*)::text FROM business.artifact_manifests
           WHERE project_id = $1 AND purpose_code = $3) AS diagnostics,
         (SELECT count(*)::text FROM business.knowledge_revisions
           WHERE project_id = $1) AS revisions,
         (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings
           WHERE project_id = $1) AS bindings,
         (SELECT count(*)::text FROM business.identification_knowledge_authoring_attempts
           WHERE project_id = $1 AND review_task_ref IS NOT NULL) AS reviews,
         (SELECT count(*)::text FROM business.command_receipts
           WHERE project_id = $1 AND command_id IN ($4, $5)) AS receipts`,
      [
        isolated.projectId,
        taskEntityId,
        "identification-knowledge-authoring-failure",
        `${taskEntityId}:failure-revision`,
        `${taskEntityId}:failure-review`,
      ],
    );
    expect(state.rows[0]).toEqual({
      stage: "task-started",
      diagnostics: "0",
      revisions: "0",
      bindings: "0",
      reviews: "0",
      receipts: "0",
    });
  }, 300_000);

  it("keeps one project's reader denial observable while another project settles", async () => {
    const denied = await fixture.createPreparationWorld("settlement-reader-denied");
    const healthy = await fixture.createPreparationWorld("settlement-reader-healthy");
    const holder: { reader?: AgentTaskFailureEvidenceReaderV1 } = {};
    const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: {
        readTerminalFailure: async (request) => {
          // 只让 A 工程的窄读返回同形拒绝，B 工程走真实 C08 读取。
          if (request.projectId === denied.projectId) {
            return { kind: "failed", error: evidenceDenied(request.requestId) };
          }
          if (holder.reader === undefined) throw new Error("the reader is not wired");
          return await holder.reader.readTerminalFailure(request);
        },
      },
    });
    holder.reader = agentTaskAdapter;
    const cancelFor = async (projectId: string, actorId: string, agentTaskRef: unknown) => {
      const commandId = nextId("c17-reader-denied-cancel");
      await agentTaskAdapter.cancelTask(
        CancelAgentTaskCommandV1Schema.parse({
          kind: "cancel-task",
          commandId,
          idempotencyKey: commandId,
          projectId,
          actorId,
          issuedAt: "2030-01-02T00:00:00.000Z",
          authorization: await fixture.authorizationFor(
            commandId,
            "agent-task.cancel-task",
            projectId,
          ),
          payload: { agentTaskRef, reasonCode: "operator-cancelled" },
        }),
      );
    };
    const preparedA = (await prepareAuthoring(adapter, "settlement-reader-denied", denied))
      .prepared;
    const preparedB = (await prepareAuthoring(adapter, "settlement-reader-healthy", healthy))
      .prepared;
    await cancelFor(denied.projectId, denied.readAuthorization.actorId, preparedA.agentTaskRef);
    await cancelFor(healthy.projectId, healthy.readAuthorization.actorId, preparedB.agentTaskRef);
    const outcome = await adapter.settleAuthoringFailures();
    // A 工程的拒绝原因可查，且不阻断 B 工程收口。
    const deniedFailure = outcome.failures.find(
      (failure) => failure.taskRef.reference.entityId === preparedA.agentTaskRef.reference.entityId,
    );
    expect(deniedFailure?.error).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(
      outcome.failures.some(
        (failure) =>
          failure.taskRef.reference.entityId === preparedB.agentTaskRef.reference.entityId,
      ),
    ).toBe(false);
    expect(outcome.settled).toBeGreaterThanOrEqual(1);
    const state = await fixture.cleaning.postgres.adminPool.query<{
      project_id: string;
      stage: string;
      bindings: string;
      reviews: string;
      diagnostics: string;
    }>(
      `SELECT a.project_id,
              a.stage,
              (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings b
                WHERE b.project_id = a.project_id
                  AND b.binding_kind = 'failure-review-only') AS bindings,
              (SELECT count(*)::text FROM business.identification_knowledge_authoring_attempts r
                WHERE r.project_id = a.project_id AND r.review_task_ref IS NOT NULL) AS reviews,
              (SELECT count(*)::text FROM business.artifact_manifests m
                WHERE m.project_id = a.project_id AND m.purpose_code = 'identification-knowledge-authoring-failure') AS diagnostics
         FROM business.identification_knowledge_authoring_attempts a
        WHERE a.project_id IN ($1, $2)
        ORDER BY a.project_id`,
      [denied.projectId, healthy.projectId],
    );
    expect(state.rows).toEqual([
      {
        project_id: denied.projectId,
        stage: "task-started",
        bindings: "0",
        reviews: "0",
        diagnostics: "0",
      },
      {
        project_id: healthy.projectId,
        stage: "review-linked",
        bindings: "1",
        reviews: "1",
        diagnostics: "1",
      },
    ]);
  }, 300_000);

  it("records a non-denial failure evidence read instead of settling the failure", async () => {
    const { adapter } = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: {
        readTerminalFailure: async (request) => ({
          kind: "failed",
          error: evidenceTransient(request.requestId),
        }),
      },
    });
    const { isolated, prepared } = await prepareAuthoring(adapter, "settlement-transient");
    const taskEntityId = prepared.agentTaskRef.reference.entityId;
    // 非同形失败必须作为可验原因记录，而不是被静默跳过或当作已收口。
    const outcome = await adapter.settleAuthoringFailures();
    expect(outcome.settled).toBe(0);
    const failureIds = outcome.failures.map((failure) => failure.taskRef.reference.entityId);
    expect(failureIds).toContain(prepared.agentTaskRef.reference.entityId);
    expect(
      outcome.failures.find(
        (failure) =>
          failure.taskRef.reference.entityId === prepared.agentTaskRef.reference.entityId,
      )?.error,
    ).toMatchObject({ code: "TRANSIENT_FAILURE" });
    const state = await fixture.cleaning.postgres.adminPool.query<{
      stage: string;
      diagnostics: string;
      bindings: string;
    }>(
      `SELECT
         (SELECT stage FROM business.identification_knowledge_authoring_attempts
           WHERE project_id = $1 AND agent_task_ref->'reference'->>'entityId' = $2) AS stage,
         (SELECT count(*)::text FROM business.artifact_manifests
           WHERE project_id = $1 AND purpose_code = $3) AS diagnostics,
         (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings
           WHERE project_id = $1) AS bindings`,
      [isolated.projectId, taskEntityId, "identification-knowledge-authoring-failure"],
    );
    expect(state.rows[0]).toEqual({ stage: "task-started", diagnostics: "0", bindings: "0" });
  }, 300_000);

  it("completes only the missing failure review stage on replay", async () => {
    const isolated = await fixture.createPreparationWorld("settlement-recovery");
    const reads: AgentTaskFailureEvidenceReadRequestV1[] = [];
    const readerHolder: { reader?: AgentTaskFailureEvidenceReaderV1 } = {};
    const spyingReader: AgentTaskFailureEvidenceReaderV1 = {
      readTerminalFailure: async (request) => {
        reads.push(request);
        if (readerHolder.reader === undefined) throw new Error("the reader is not wired");
        return await readerHolder.reader.readTerminalFailure(request);
      },
    };
    // 只拒绝本工程自己的复核授权：失败修订绑定必须保留，复核留到下一次重放补做。
    const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: spyingReader,
      authorizeDenial: (input) =>
        input.branch === "knowledge-modeling.request-review" &&
        input.projectId === isolated.projectId,
    });
    readerHolder.reader = agentTaskAdapter;
    const { prepared } = await prepareAuthoring(adapter, "settlement-recovery", isolated);
    const taskEntityId = prepared.agentTaskRef.reference.entityId;
    const cancelCommandId = nextId("c17-recovery-cancel");
    await agentTaskAdapter.cancelTask(
      CancelAgentTaskCommandV1Schema.parse({
        kind: "cancel-task",
        commandId: cancelCommandId,
        idempotencyKey: cancelCommandId,
        projectId: isolated.projectId,
        actorId: isolated.readAuthorization.actorId,
        issuedAt: "2030-01-02T00:00:00.000Z",
        authorization: await fixture.authorizationFor(
          cancelCommandId,
          "agent-task.cancel-task",
          isolated.projectId,
        ),
        payload: { agentTaskRef: prepared.agentTaskRef, reasonCode: "operator-cancelled" },
      }),
    );
    const countState = async () =>
      (
        await fixture.cleaning.postgres.adminPool.query<{
          revisions: string;
          bindings: string;
          reviews: string;
          stage: string;
        }>(
          `SELECT
             (SELECT count(*)::text FROM business.knowledge_revisions
               WHERE project_id = $1 AND definition_type = 'standard-library') AS revisions,
             (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings
               WHERE project_id = $1 AND binding_kind = 'failure-review-only') AS bindings,
             (SELECT count(*)::text FROM business.identification_knowledge_authoring_attempts
               WHERE project_id = $1 AND review_task_ref IS NOT NULL) AS reviews,
             (SELECT stage FROM business.identification_knowledge_authoring_attempts
               WHERE project_id = $1 AND agent_task_ref->'reference'->>'entityId' = $2) AS stage`,
          [isolated.projectId, taskEntityId],
        )
      ).rows[0];
    const evidenceReads = () =>
      reads.filter((request) => request.taskRef.reference.entityId === taskEntityId).length;
    const interrupted = await adapter.settleAuthoringFailures();
    // 授权失败作为可验原因记录，停在最后已成立阶段：诊断与失败修订绑定已耐久，复核未创建。
    expect(interrupted.failures).toMatchObject([
      { taskRef: prepared.agentTaskRef, error: { code: "AUTHORIZATION_DENIED" } },
    ]);
    expect(await countState()).toEqual({
      revisions: "1",
      bindings: "1",
      reviews: "0",
      stage: "failure-revision-bound",
    });
    const readsBeforeReplay = evidenceReads();
    // 下一次只补未完成阶段：不重复读取本任务的 C08 证据、不创建第二个修订或复核。
    const recovering = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: spyingReader,
    });
    const recovered = await recovering.adapter.settleAuthoringFailures();
    expect(recovered.failures).toEqual([]);
    expect(recovered.settled).toBeGreaterThanOrEqual(1);
    expect(evidenceReads()).toBe(readsBeforeReplay);
    expect(await countState()).toEqual({
      revisions: "1",
      bindings: "1",
      reviews: "1",
      stage: "review-linked",
    });
  }, 300_000);

  it("settles another project when one project's authorization fails", async () => {
    const failing = await fixture.createPreparationWorld("settlement-isolated-a");
    const healthy = await fixture.createPreparationWorld("settlement-isolated-b");
    const reads: AgentTaskFailureEvidenceReadRequestV1[] = [];
    const readerHolder: { reader?: AgentTaskFailureEvidenceReaderV1 } = {};
    const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter({
      failureEvidenceReader: {
        readTerminalFailure: async (request) => {
          reads.push(request);
          if (readerHolder.reader === undefined) throw new Error("the reader is not wired");
          return await readerHolder.reader.readTerminalFailure(request);
        },
      },
      // A 工程的失败证据读取授权被拒：只影响该工程，不得阻断 B 工程。
      authorizeDenial: (input) =>
        input.projectId === failing.projectId &&
        input.branch === "agent-task.read-failure-evidence",
    });
    readerHolder.reader = agentTaskAdapter;
    const cancelFor = async (projectId: string, actorId: string, agentTaskRef: unknown) => {
      const commandId = nextId("c17-isolated-cancel");
      await agentTaskAdapter.cancelTask(
        CancelAgentTaskCommandV1Schema.parse({
          kind: "cancel-task",
          commandId,
          idempotencyKey: commandId,
          projectId,
          actorId,
          issuedAt: "2030-01-02T00:00:00.000Z",
          authorization: await fixture.authorizationFor(
            commandId,
            "agent-task.cancel-task",
            projectId,
          ),
          payload: { agentTaskRef, reasonCode: "operator-cancelled" },
        }),
      );
    };
    const preparedA = (await prepareAuthoring(adapter, "settlement-isolated-a", failing)).prepared;
    const preparedB = (await prepareAuthoring(adapter, "settlement-isolated-b", healthy)).prepared;
    await cancelFor(failing.projectId, failing.readAuthorization.actorId, preparedA.agentTaskRef);
    await cancelFor(healthy.projectId, healthy.readAuthorization.actorId, preparedB.agentTaskRef);
    const outcome = await adapter.settleAuthoringFailures();
    // A 工程授权失败被记录为可验原因，B 工程仍被完整收口。
    expect(outcome.failures).toMatchObject([
      { taskRef: preparedA.agentTaskRef, error: { code: "AUTHORIZATION_DENIED" } },
    ]);
    expect(outcome.settled).toBeGreaterThanOrEqual(1);
    const state = await fixture.cleaning.postgres.adminPool.query<{
      project_id: string;
      stage: string;
      bindings: string;
      reviews: string;
    }>(
      `SELECT a.project_id,
              a.stage,
              (SELECT count(*)::text FROM business.identification_knowledge_revision_bindings b
                WHERE b.project_id = a.project_id
                  AND b.binding_kind = 'failure-review-only') AS bindings,
              (SELECT count(*)::text FROM business.identification_knowledge_authoring_attempts r
                WHERE r.project_id = a.project_id AND r.review_task_ref IS NOT NULL) AS reviews
         FROM business.identification_knowledge_authoring_attempts a
        WHERE a.project_id IN ($1, $2)
        ORDER BY a.project_id`,
      [failing.projectId, healthy.projectId],
    );
    expect(state.rows).toEqual([
      { project_id: failing.projectId, stage: "task-started", bindings: "0", reviews: "0" },
      { project_id: healthy.projectId, stage: "review-linked", bindings: "1", reviews: "1" },
    ]);
  }, 300_000);

  it("keeps non C17 governance definitions on the delegated C16 path", async () => {
    const adapter = adapterFor();
    const commandId = nextId("c17-delegate");
    const authorization = await fixture.authorizationFor(
      commandId,
      "knowledge-modeling.submit-revision",
    );
    const result = await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "submit-revision",
        commandId,
        idempotencyKey: commandId,
        projectId: fixture.world.projectId,
        actorId: authorization.actorId,
        issuedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        authorization,
        payload: {
          definitionType: "risk-matrix",
          candidateArtifactRef: await fixture.putArtifact(
            { schemaVersion: "1" },
            IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1,
          ),
          evidenceReferences: [...fixture.world.evidence.slice(0, 1)],
        },
      }),
    );
    expect(result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "assessment-configuration-policy-required" },
    });
  }, 240_000);
});
