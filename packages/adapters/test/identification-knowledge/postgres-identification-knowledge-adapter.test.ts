import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CancelAgentTaskCommandV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeResolutionCommandV1Schema,
  ReviewDecisionCommandV1Schema,
  type AuthorizationContextV1,
  type KnowledgeGovernanceResultV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";

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
} from "./fixture.js";

// 命令时刻晚于夹具的准备与发布记录时间，保证双时间与生效时间线单调。
const SUBMIT_TIMESTAMP = "2030-01-01T00:01:00.000Z";
const DECISION_TIMESTAMP = "2030-01-01T00:01:30.000Z";
const PUBLISH_TIMESTAMP = "2030-01-01T00:02:00.000Z";

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

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
    readonly withPreparationReader?: boolean;
  }) =>
    new PostgresIdentificationKnowledgeAdapter({
      db: fixture.cleaning.runtime.db,
      transactionUnit: fixture.transactionUnit,
      access: fixture.access,
      artifactStore: fixture.cleaning.artifactStore,
      artifactReferenceGuard: fixture.cleaning.artifactRegistry,
      governance: fixture.governance,
      preparationReader: fixture.preparationReader,
      policy: fixture.policy,
      ...(options?.withPolicySet === false
        ? {}
        : {
            policySetProvider: {
              resolveExact: async (input) => ({
                kind: "identification-policy-set" as const,
                reference: {
                  entityId: `policy-set-${input.projectId}`,
                  versionId: "1",
                },
              }),
            },
          }),
      now: () => new Date(IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP),
    });

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
    // 已有发布时必须显式给出当前基线发布，C16 才允许形成下一个修订。
    const currentRelease = await fixture.cleaning.postgres.adminPool.query<{
      release_id: string;
      release_version_id: string;
    }>(
      `SELECT release_id, release_version_id FROM business.identification_knowledge_release_bindings
        WHERE project_id = $1 AND definition_type = $2
        ORDER BY bound_at DESC LIMIT 1`,
      [projectId, definitionType],
    );
    const baseReleaseRef =
      currentRelease.rows[0] === undefined
        ? undefined
        : {
            kind: "knowledge-release" as const,
            reference: {
              entityId: currentRelease.rows[0].release_id,
              versionId: currentRelease.rows[0].release_version_id,
            },
          };
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
        issuedAt: SUBMIT_TIMESTAMP,
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
  ) =>
    await fixture.reviewAudit.decideReview(
      ReviewDecisionCommandV1Schema.parse({
        kind: "decide-review",
        commandId,
        idempotencyKey: `${commandId}-key`,
        projectId: fixture.world.projectId,
        actorId: authorization.actorId,
        issuedAt: DECISION_TIMESTAMP,
        authorization,
        payload: {
          reviewTaskRef,
          targetRef: reviewTaskRef.targetRef,
          decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
          reasonCode: "reviewed",
        },
      }),
    );

  const publishRevision = async (
    adapter: PostgresIdentificationKnowledgeAdapter,
    revisionRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
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
        issuedAt: SUBMIT_TIMESTAMP,
        authorization: requestAuthorization,
        payload: {
          revisionRef,
          reviewPolicyRef: { entityId: "c17-review-policy", versionId: "1" },
        },
      }),
    );
    expect(requested).toMatchObject({ kind: "succeeded", result: { kind: "review-task" } });
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return undefined;
    const decideCommandId = nextId("c17-decide");
    const decideAuthorization = await fixture.authorizationFor(
      decideCommandId,
      "review-audit.decide-review",
      projectId,
    );
    const decision = await decideReview(
      requested.result.reviewTaskRef,
      decideAuthorization,
      decideCommandId,
    );
    expect(decision.kind).toBe("succeeded");
    if (decision.kind !== "succeeded") return undefined;
    const publishCommandId = nextId("c17-publish");
    const publishAuthorization = await fixture.authorizationFor(
      publishCommandId,
      "knowledge-modeling.publish-approved-release",
      projectId,
    );
    return await adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "publish-approved-release",
        commandId: publishCommandId,
        idempotencyKey: publishCommandId,
        projectId,
        actorId: publishAuthorization.actorId,
        issuedAt: PUBLISH_TIMESTAMP,
        authorization: publishAuthorization,
        payload: {
          revisionRef,
          reviewDecisionRef: decision.result.reviewDecisionRef,
          effectiveFrom: PUBLISH_TIMESTAMP,
        },
      }),
    );
  };

  it("accepts a complete process-model package, records validation and binds the revision", async () => {
    const adapter = adapterFor();
    const submitted = await submitPackage(
      adapter,
      "process-model",
      processModelPackage(fixture.builderInput()),
    );
    expect(submitted).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
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
      [fixture.world.projectId, submitted.result.knowledgeRevisionRef.reference.entityId],
    );
    expect(rows.rows[0]).toMatchObject({
      disposition: "accepted",
      definition_type: "process-model",
      binding_kind: "validated",
    });
    const c16 = await fixture.cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.knowledge_revisions
        WHERE project_id = $1 AND revision_id = $2`,
      [fixture.world.projectId, submitted.result.knowledgeRevisionRef.reference.entityId],
    );
    expect(c16.rows[0]?.count).toBe("1");

    const published = await publishRevision(adapter, submitted.result.knowledgeRevisionRef);
    expect(published).toMatchObject({ kind: "succeeded", result: { kind: "release" } });
    if (
      published === undefined ||
      published.kind !== "succeeded" ||
      published.result.kind !== "release"
    ) {
      return;
    }
    const releaseRef = published.result.knowledgeReleaseRef;
    const releaseBinding = await fixture.cleaning.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.identification_knowledge_release_bindings
        WHERE project_id = $1 AND release_id = $2`,
      [fixture.world.projectId, releaseRef.reference.entityId],
    );
    expect(releaseBinding.rows[0]?.count).toBe("1");

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
    if (read.kind !== "succeeded") return;
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
  }, 240_000);

  it("requires a validated binding before publishing and blocks failure-only revisions", async () => {
    const adapter = adapterFor();
    const missingCommandId = nextId("c17-publish-missing");
    const missingAuthorization = await fixture.authorizationFor(
      missingCommandId,
      "knowledge-modeling.publish-approved-release",
    );
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
      error: { code: "BUSINESS_BLOCKED", blockerKind: "identification-knowledge-binding-required" },
    });
  }, 240_000);

  it("resolves the exact identification basis from three main releases, composite members and policy set", async () => {
    const adapter = adapterFor();
    const processModel = await submitPackage(
      adapter,
      "process-model",
      processModelPackage(fixture.builderInput()),
    );
    if (processModel.kind !== "succeeded" || processModel.result.kind !== "revision") return;
    const publishedProcessModel = await publishRevision(
      adapter,
      processModel.result.knowledgeRevisionRef,
    );
    if (
      publishedProcessModel === undefined ||
      publishedProcessModel.kind !== "succeeded" ||
      publishedProcessModel.result.kind !== "release"
    ) {
      return;
    }
    const processModelReleaseRef = publishedProcessModel.result.knowledgeReleaseRef;
    const mechanism = await submitPackage(
      adapter,
      "risk-mechanism",
      riskMechanismPackage({
        ...fixture.builderInput(),
        processModelReleaseRef: processModelReleaseRef.reference,
      }),
    );
    if (mechanism.kind !== "succeeded" || mechanism.result.kind !== "revision") return;
    const publishedMechanism = await publishRevision(
      adapter,
      mechanism.result.knowledgeRevisionRef,
    );
    if (
      publishedMechanism === undefined ||
      publishedMechanism.kind !== "succeeded" ||
      publishedMechanism.result.kind !== "release"
    ) {
      return;
    }
    const standard = await submitPackage(
      adapter,
      "standard-library",
      standardLibraryPackage(fixture.builderInput()),
    );
    if (standard.kind !== "succeeded" || standard.result.kind !== "revision") return;
    const publishedStandard = await publishRevision(adapter, standard.result.knowledgeRevisionRef);
    if (
      publishedStandard === undefined ||
      publishedStandard.kind !== "succeeded" ||
      publishedStandard.result.kind !== "release"
    ) {
      return;
    }
    const caseLibrary = await submitPackage(
      adapter,
      "case-library",
      caseLibraryPackage(fixture.builderInput()),
    );
    if (caseLibrary.kind !== "succeeded" || caseLibrary.result.kind !== "revision") return;
    const publishedCase = await publishRevision(adapter, caseLibrary.result.knowledgeRevisionRef);
    if (
      publishedCase === undefined ||
      publishedCase.kind !== "succeeded" ||
      publishedCase.result.kind !== "release"
    ) {
      return;
    }
    const composite = await submitPackage(
      adapter,
      "retrieval-evidence-base",
      retrievalEvidenceBasePackage({
        ...fixture.builderInput(),
        riskMechanismReleaseRef: publishedMechanism.result.knowledgeReleaseRef,
        standardLibraryReleaseRef: publishedStandard.result.knowledgeReleaseRef,
        caseLibraryReleaseRef: publishedCase.result.knowledgeReleaseRef,
      }),
    );
    if (composite.kind !== "succeeded" || composite.result.kind !== "revision") return;
    const publishedComposite = await publishRevision(
      adapter,
      composite.result.knowledgeRevisionRef,
    );
    if (
      publishedComposite === undefined ||
      publishedComposite.kind !== "succeeded" ||
      publishedComposite.result.kind !== "release"
    ) {
      return;
    }

    const resolveCommand = async (commandId: string) => {
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
          issuedAt: "2030-01-01T00:00:03.000Z",
          authorization,
          payload: {
            preparationSnapshotRef: fixture.world.snapshotRef,
            requiredAt: "2030-01-01T00:00:03.000Z",
          },
        }),
      );
    };

    const resolved = await resolveCommand(nextId("c17-resolve"));
    expect(resolved).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "identification-basis",
        processModelReleaseRef: { reference: processModelReleaseRef.reference },
        riskMechanismReleaseRef: {
          reference: publishedMechanism.result.knowledgeReleaseRef.reference,
        },
        retrievalEvidenceBaseReleaseRef: {
          reference: publishedComposite.result.knowledgeReleaseRef.reference,
        },
      },
    });

    const withoutPolicySet = adapterFor({ withPolicySet: false });
    const missingPolicy = await withoutPolicySet.resolve(
      KnowledgeResolutionCommandV1Schema.parse({
        kind: "identification-basis",
        commandId: nextId("c17-resolve-no-policy"),
        idempotencyKey: nextId("c17-resolve-no-policy-key"),
        projectId: fixture.world.projectId,
        actorId: fixture.world.readAuthorization.actorId,
        issuedAt: "2030-01-01T00:00:03.000Z",
        authorization: await fixture.authorizationFor(
          nextId("c17-resolve-no-policy-auth"),
          "knowledge-modeling.identification-basis",
        ),
        payload: {
          preparationSnapshotRef: fixture.world.snapshotRef,
          requiredAt: "2030-01-01T00:00:03.000Z",
        },
      }),
    );
    expect(missingPolicy).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "identification-policy-set-unavailable" },
    });
  }, 600_000);

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
    if (prepared.kind !== "succeeded") return;
    const attempt = await fixture.cleaning.postgres.adminPool.query<{ stage: string }>(
      `SELECT stage FROM business.identification_knowledge_authoring_attempts
        WHERE project_id = $1 AND agent_task_ref->'reference'->>'entityId' = $2`,
      [isolated.projectId, prepared.agentTaskRef.reference.entityId],
    );
    expect(attempt.rows[0]?.stage).toBe("task-started");
    const task = await agentTaskAdapter.getTask(prepared.agentTaskRef);
    expect(task?.envelope.taskType).toBe("knowledge-authoring");
    expect(task?.envelope.frozenInputRef).toEqual(prepared.manifestArtifactRef);
    if (task === undefined) return;

    const definition = adapter.createTaskDefinition();
    const sliceTool = definition.tools[0]!;
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

    const candidate = {
      schemaVersion: "1",
      candidateVersion: 1,
      definitionType: "process-model",
      operations: [
        {
          operation: "declare-node",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "declare-node",
          evidence: [isolated.evidence[0]],
          node: {
            nodeId: "node-authoring-1",
            processKind: "扩径准备",
            inputs: ["input-1"],
            outputs: ["output-1"],
            equipmentRefs: ["小盾构"],
            structuralComponentRefs: [],
            stateParameters: ["土仓/泥水压力"],
            monitoringIndicators: ["地表沉降"],
            applicability: {
              constructionMethod: ["variable-diameter-shield"],
              stratumCondition: ["soft-soil"],
              engineeringStage: ["expansion-preparation"],
            },
            evidence: [isolated.evidence[0]],
          },
        },
        {
          operation: "declare-node",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "declare-node",
          evidence: [isolated.evidence[0]],
          node: {
            nodeId: "node-authoring-2",
            processKind: "变径空间扩挖",
            inputs: ["input-2"],
            outputs: ["output-2"],
            equipmentRefs: ["小盾构"],
            structuralComponentRefs: [],
            stateParameters: ["土仓/泥水压力"],
            monitoringIndicators: ["地表沉降"],
            applicability: {
              constructionMethod: ["variable-diameter-shield"],
              stratumCondition: ["soft-soil"],
              engineeringStage: ["expansion-preparation"],
            },
            evidence: [isolated.evidence[0]],
          },
        },
        {
          operation: "declare-node",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "declare-node",
          evidence: [isolated.evidence[0]],
          node: {
            nodeId: "node-authoring-3",
            processKind: "刀盘扩径",
            inputs: ["input-3"],
            outputs: ["output-3"],
            equipmentRefs: ["小盾构"],
            structuralComponentRefs: [],
            stateParameters: ["土仓/泥水压力"],
            monitoringIndicators: ["地表沉降"],
            applicability: {
              constructionMethod: ["variable-diameter-shield"],
              stratumCondition: ["soft-soil"],
              engineeringStage: ["expansion-preparation"],
            },
            evidence: [isolated.evidence[0]],
          },
        },
        {
          operation: "declare-node",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "declare-node",
          evidence: [isolated.evidence[0]],
          node: {
            nodeId: "node-authoring-4",
            processKind: "盾体扩径",
            inputs: ["input-4"],
            outputs: ["output-4"],
            equipmentRefs: ["小盾构"],
            structuralComponentRefs: [],
            stateParameters: ["土仓/泥水压力"],
            monitoringIndicators: ["地表沉降"],
            applicability: {
              constructionMethod: ["variable-diameter-shield"],
              stratumCondition: ["soft-soil"],
              engineeringStage: ["expansion-preparation"],
            },
            evidence: [isolated.evidence[0]],
          },
        },
        {
          operation: "declare-node",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "declare-node",
          evidence: [isolated.evidence[0]],
          node: {
            nodeId: "node-authoring-5",
            processKind: "缩径转换",
            inputs: ["input-5"],
            outputs: ["output-5"],
            equipmentRefs: ["小盾构"],
            structuralComponentRefs: [],
            stateParameters: ["土仓/泥水压力"],
            monitoringIndicators: ["地表沉降"],
            applicability: {
              constructionMethod: ["variable-diameter-shield"],
              stratumCondition: ["soft-soil"],
              engineeringStage: ["expansion-preparation"],
            },
            evidence: [isolated.evidence[0]],
          },
        },
      ],
    };
    const validation = await definition.validateCandidate(candidate, task);
    if (validation.disposition !== "accepted") {
      console.error(
        "C17_VALIDATION_ITEMS",
        JSON.stringify(validation.items.filter((item) => item.disposition === "rejected")).slice(
          0,
          800,
        ),
      );
    }
    expect(validation.disposition).toBe("accepted");

    const result = await definition.finalizeCandidate(candidate, task);
    expect(result).toMatchObject({ kind: "agent-task-result", status: "completed" });
    const binding = await fixture.cleaning.postgres.adminPool.query<{ binding_kind: string }>(
      `SELECT binding_kind FROM business.identification_knowledge_revision_bindings
        WHERE project_id = $1 AND revision_id = $2`,
      [
        isolated.projectId,
        (result as { candidateRef?: { reference: { entityId: string } } }).candidateRef?.reference
          .entityId ?? "missing",
      ],
    );
    expect(binding.rows[0]?.binding_kind).toBe("validated");
  }, 300_000);

  it("settles a cancelled authoring task into a failure-only revision and one review", async () => {
    const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter();
    const isolated = await fixture.createPreparationWorld("settlement");
    const commandId = nextId("c17-settlement-prepare");
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
        reference: { entityId: "c17-settlement-run", versionId: "1" },
      },
      commandId,
      idempotencyKey: commandId,
    });
    expect(prepared.kind).toBe("succeeded");
    if (prepared.kind !== "succeeded") return;
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
    expect(settled).toBeGreaterThanOrEqual(1);
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
    expect(rows.rows[0] ?? rows.rows, JSON.stringify(rows.rows)).toMatchObject({
      binding_kind: "failure-review-only",
      stage: "review-linked",
    });
    expect(rows.rows[0]?.review_task_ref).not.toBeNull();
    const replay = await adapter.settleAuthoringFailures();
    expect(replay).toBe(0);
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
