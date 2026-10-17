import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CancelAgentTaskCommandV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeResolutionCommandV1Schema,
  KnowledgeResolutionResultV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  KnowledgeRetrievalResultV1Schema,
  ModuleErrorV1Schema,
  ReviewDecisionCommandV1Schema,
  type AuthorizationContextV1,
  type KnowledgeDefinitionTypeV1,
  type KnowledgeGovernanceResultV1,
  type KnowledgeModelingPortV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  type KnowledgeRevisionRefV1,
  type ModuleErrorV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import type {
  AgentTaskFailureEvidenceReadRequestV1,
  AgentTaskFailureEvidenceReaderV1,
} from "@riskflow/core/agent-runtime";
import { ArtifactReadRequestV1Schema } from "@riskflow/core/artifacts";
import { CleaningPreparationManifestV1Schema } from "@riskflow/core/engineering-data/cleaning";
import {
  STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1,
  StructuredDocumentJsonLdV1Schema,
} from "@riskflow/core/engineering-data/document-conversion";

import { governedReleaseResolutionInvocationId } from "../../src/knowledge-governance/index.js";
import {
  IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1,
  PostgresIdentificationKnowledgeAdapter,
  PostgresIdentificationPreparationKnowledgeReader,
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

  it("accepts only exact authorized standard evidence text and refuses unreadable content", async () => {
    const world = await fixture.createPreparationWorld("standard-text");
    const actorId = world.readAuthorization.actorId;
    const requestedAt = IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP;
    const preparation = await fixture.preparationReader.readExactPreparation({
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      actorId,
      requestedAt,
      requestId: nextId("text-preparation"),
    });
    if (preparation.kind !== "ok") throw new Error("exact preparation unavailable");
    const read = async (artifactRef: unknown, purposeCode: string) => {
      const requestId = nextId("text-fixture-read");
      const handle = await fixture.cleaning.artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId,
          idempotencyKey: requestId,
          artifactRef,
          projectId: world.projectId,
          actorId,
          requestedAt,
          purposeCode,
          authorization: world.readAuthorization,
          requiredCapability: "engineering-data.read",
        }),
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of handle.content) chunks.push(chunk);
      await handle.completed;
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    };
    const manifest = CleaningPreparationManifestV1Schema.parse(
      await read(
        preparation.result.manifestArtifactRef,
        "engineering-data.data-cleaning-preparation-manifest",
      ),
    );
    const document = StructuredDocumentJsonLdV1Schema.parse(
      await read(
        manifest.documents[0]!.jsonLdArtifactRef,
        "engineering-data.structured-document-conversion",
      ),
    );
    const evidence = [world.evidence[0]!];
    const fragment = document.evidenceFragments.find(
      (item) => item.sourceSegmentId === evidence[0]!.locator.sourceSegmentId,
    )!;
    const text = fragment.textBlockIds
      .map((id) => document.textBlocks.find((block) => block.blockId === id)!.text)
      .join("\n");
    const packageValue = standardLibraryPackage({
      ...fixture.builderInput(),
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      evidence,
    });
    const entry = { ...packageValue.entries[0]!, retrievalText: text };
    const check = (overrides: Record<string, unknown> = {}) =>
      fixture.preparationReader.checkStandardRetrievalText({
        projectId: world.projectId,
        preparationSnapshotRef: world.snapshotRef,
        actorId,
        requestedAt,
        requestId: nextId("check-standard-text"),
        entry: entry as never,
        ...overrides,
      });
    expect(await check()).toBe(true);
    const slice = await fixture.preparationReader.readSegmentSlice({
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      sourceSegmentSetRef: world.sourceSegmentSetRef,
      segmentIds: [evidence[0]!.locator.sourceSegmentId],
      limit: 1,
      actorId,
      requestedAt,
      requestId: nextId("real-segment-text"),
    });
    if (slice.kind !== "succeeded") throw new Error("the retained segment was not readable");
    expect(slice.observation).toMatchObject({
      sourceVersionRef: manifest.documents[0]!.sourceVersionRef,
      segments: [
        {
          sourceSegmentId: evidence[0]!.locator.sourceSegmentId,
          textBlocks: fragment.textBlockIds.map((id) =>
            document.textBlocks.find((block) => block.blockId === id)!,
          ),
        },
      ],
    });
    for (const [targetBytes, accepted] of [
      [5 * 1024 * 1024, true],
      [STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1, false],
      [STRUCTURED_DOCUMENT_JSON_LD_MAX_BYTES_V1 + 1, false],
    ] as const) {
      const padded = StructuredDocumentJsonLdV1Schema.parse({
        ...document,
        tableFields: [
          ...(document.tableFields ?? []),
          {
            fieldId: "padding",
            tableId: "padding",
            sheet: "padding",
            row: 1,
            column: 1,
            value: "",
          },
        ],
      });
      padded.tableFields!.at(-1)!.value = "x".repeat(
        targetBytes - Buffer.byteLength(JSON.stringify(padded)),
      );
      const bytes = Buffer.from(JSON.stringify(StructuredDocumentJsonLdV1Schema.parse(padded)));
      expect(bytes.byteLength).toBe(targetBytes);
      const reader = new PostgresIdentificationPreparationKnowledgeReader({
        narrowRead: {
          preparationRead: fixture.cleaning.store,
          engineeringData: fixture.cleaning.registry,
        },
        authorize: async (input) =>
          fixture.authorizationFor(input.invocationId, input.branch, input.projectId),
        artifactStore: {
          put: fixture.cleaning.artifactStore.put.bind(fixture.cleaning.artifactStore),
          open: async (request) => {
            const handle = await fixture.cleaning.artifactStore.open(request);
            if (
              request.artifactRef.reference.entityId !==
              manifest.documents[0]!.jsonLdArtifactRef.reference.entityId
            )
              return handle;
            for await (const chunk of handle.content) void chunk;
            await handle.completed;
            return {
              ...handle,
              content: (async function* () {
                yield bytes;
              })(),
            };
          },
        },
      });
      // 文档恰为16MiB时，清单加正文的累计读取已经越界。
      expect(
        await reader.checkStandardRetrievalText({
          projectId: world.projectId,
          preparationSnapshotRef: world.snapshotRef,
          actorId,
          requestedAt,
          requestId: nextId("bounded-standard-text"),
          entry,
        }),
      ).toBe(accepted);
    }
    expect(await check({ entry: { ...entry, retrievalText: `${text}\nextra` } })).toBe(false);
    expect(await check({ preparationSnapshotRef: fixture.world.snapshotRef })).toBe(false);
    expect(
      await check({
        entry: {
          ...entry,
          evidence: [
            {
              ...evidence[0],
              sourceVersion: { ...evidence[0]!.sourceVersion, versionId: "wrong" },
            },
          ],
        },
      }),
    ).toBe(false);
    const submitted = await submitPackage(
      adapterFor(),
      "standard-library",
      { ...packageValue, entries: [entry] },
      { projectId: world.projectId, evidence },
    );
    revisionOf(submitted, "verified standard text");
    expect(
      await submitPackage(
        adapterFor(),
        "standard-library",
        {
          ...packageValue,
          entries: [{ ...packageValue.entries[0]!, standardIdentity: "x".repeat(4 * 1024 * 1024) }],
        },
        { projectId: world.projectId, evidence },
      ),
    ).toMatchObject({ kind: "failed" });
    const denied = fixture.createIdentificationKnowledgeAdapter({
      authorizeDenial: (input) => input.branch === "engineering-data.source-segments",
    }).adapter;
    expect(
      await submitPackage(
        denied,
        "standard-library",
        { ...packageValue, entries: [entry] },
        { projectId: world.projectId, evidence },
      ),
    ).toMatchObject({ kind: "failed" });
    let corruptReadReached = false;
    const corrupted = new PostgresIdentificationPreparationKnowledgeReader({
      narrowRead: {
        preparationRead: fixture.cleaning.store,
        engineeringData: fixture.cleaning.registry,
      },
      authorize: async (input) =>
        fixture.authorizationFor(input.invocationId, input.branch, input.projectId),
      artifactStore: {
        ...fixture.cleaning.artifactStore,
        open: async () => {
          corruptReadReached = true;
          throw new Error("corrupt content");
        },
      },
    });
    expect(
      await corrupted.checkStandardRetrievalText({
        projectId: world.projectId,
        preparationSnapshotRef: world.snapshotRef,
        actorId,
        requestedAt,
        requestId: nextId("corrupt-standard-text"),
        entry: entry as never,
      }),
    ).toBe(false);
    expect(corruptReadReached).toBe(true);
  }, 300_000);

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
    options?: {
      readonly evidence?: readonly unknown[];
      readonly projectId?: string;
      readonly replay?: boolean;
      /** 身份隔离场景需要同一包正文：保持调用方内容不变，使 C04 摘要与首次提交一致。 */
      readonly samePackage?: boolean;
    },
  ): Promise<KnowledgeGovernanceResultV1> => {
    const projectId = options?.projectId ?? fixture.world.projectId;
    const commandId = nextId(`c17-submit-${definitionType}`);
    const authorization = await fixture.authorizationFor(
      commandId,
      "knowledge-modeling.submit-revision",
      projectId,
    );
    // 每个提交必须是新的内容工件，否则 C16 会正确拒绝同一工件形成第二个修订。
    const unique =
      options?.samePackage === true
        ? value
        : {
            ...(value as Record<string, unknown>),
            generatedAt: new Date(
              Date.parse("2030-01-01T00:00:00.000Z") + sequence * 1000,
            ).toISOString(),
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
    const command = KnowledgeGovernanceCommandV1Schema.parse({
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
    });
    const submitted = (await adapter.govern(command)) as KnowledgeGovernanceResultV1;
    return options?.replay
      ? ((await adapter.govern(command)) as KnowledgeGovernanceResultV1)
      : submitted;
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
    const readAuthorization = await fixture.authorizationFor(
      readCommandId,
      "knowledge-modeling.identification-basis",
    );
    const read = await adapter.readExact({
      projectId: fixture.world.projectId,
      releaseRef,
      actorId: readAuthorization.actorId,
      requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
      invocationId: readCommandId,
      authorization: readAuthorization,
    });
    expect(read.kind).toBe("succeeded");
    if (read.kind === "failed") throw new Error(JSON.stringify(read.error));
    expect(read.read.package.definitionType).toBe("process-model");
    expect(read.read.validation.disposition).toBe("accepted");
    expect(read.read.releaseBinding.releaseRef).toEqual(releaseRef);

    const actorMismatchCommandId = nextId("c17-read-actor-mismatch");
    const actorMismatchAuthorization = await fixture.authorizationFor(
      actorMismatchCommandId,
      "knowledge-modeling.identification-basis",
    );
    const actorMismatch = await adapter.readExact({
      projectId: fixture.world.projectId,
      releaseRef,
      actorId: `${actorMismatchAuthorization.actorId}-other`,
      requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
      invocationId: actorMismatchCommandId,
      authorization: actorMismatchAuthorization,
    });
    expect(actorMismatch).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });

    const verifiedActorMismatchCommandId = nextId("c17-read-verified-actor-mismatch");
    const verifiedActorMismatchAuthorization = await fixture.authorizationFor(
      verifiedActorMismatchCommandId,
      "knowledge-modeling.identification-basis",
    );
    const originalVerify = fixture.access.verify;
    fixture.access.verify = async (request) => {
      const decision = await originalVerify.call(fixture.access, request);
      return request.invocationId === verifiedActorMismatchCommandId
        ? {
            ...decision,
            context: { ...decision.context, actorId: `${decision.context.actorId}-other` },
          }
        : decision;
    };
    try {
      const verifiedActorMismatch = await adapter.readExact({
        projectId: fixture.world.projectId,
        releaseRef,
        actorId: verifiedActorMismatchAuthorization.actorId,
        requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        invocationId: verifiedActorMismatchCommandId,
        authorization: verifiedActorMismatchAuthorization,
      });
      expect(verifiedActorMismatch).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    } finally {
      fixture.access.verify = originalVerify;
    }

    const unknownCommandId = nextId("c17-read-unknown");
    const unknownAuthorization = await fixture.authorizationFor(
      unknownCommandId,
      "knowledge-modeling.identification-basis",
    );
    const otherProject = await adapter.readExact({
      projectId: "project-unknown",
      releaseRef,
      actorId: unknownAuthorization.actorId,
      requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
      invocationId: unknownCommandId,
      authorization: unknownAuthorization,
    });
    expect(otherProject).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 300_000);

  it("resumes a submit after validation succeeded but C16 failed", async () => {
    const governance = fixture.governance;
    const originalGovern = governance.govern;
    const isolated = await fixture.createPreparationWorld("submit-resume");
    let failOnce = true;
    governance.govern = (async (...args: Parameters<typeof originalGovern>) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("injected C16 submit failure");
      }
      return await originalGovern.apply(governance, args);
    }) as typeof originalGovern;
    try {
      const submitted = await submitPackage(
        adapterFor(),
        "process-model",
        processModelPackage({
          ...fixture.builderInput(),
          projectId: isolated.projectId,
          preparationSnapshotRef: isolated.snapshotRef,
          evidence: isolated.evidence,
        }),
        {
          projectId: isolated.projectId,
          evidence: isolated.evidence.slice(0, 1),
          replay: true,
        },
      );
      revisionOf(submitted, "resumed process-model submit");
    } finally {
      governance.govern = originalGovern;
    }
  }, 300_000);

  it("reads distinct evidence groups of one package under their own identity", async () => {
    const adapter = adapterFor();
    const world = await fixture.createPreparationWorld("evidence-group-identity");
    const evidence = world.evidence[0];
    if (evidence === undefined) {
      throw new Error("the preparation world has no readable evidence segment");
    }
    const base = processModelPackage({
      ...fixture.builderInput(),
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      evidence: [evidence],
    });
    // 同一包内的不同证据组必须各自持有可重放读取身份：第二组沿用第一组身份时，C11 会把它
    // 当作同键改载荷整组拒绝；重复出现的组仍按原身份幂等重放。夹具世界只保留一个可读段，
    // 第二组由同一段的重复引用构成不同的读取载荷。
    const grouped = {
      ...base,
      nodes: base.nodes.map((node, index) => ({
        ...node,
        evidence: index === 1 ? [evidence, evidence] : [evidence],
      })),
    };
    const submitted = await submitPackage(adapter, "process-model", grouped, {
      projectId: world.projectId,
      evidence: [evidence],
    });
    const revisionRef = revisionOf(submitted, "grouped process-model submit");
    const validations = await fixture.cleaning.postgres.adminPool.query<{ disposition: string }>(
      `SELECT disposition FROM business.identification_knowledge_validations
        WHERE project_id = $1 AND definition_type = 'process-model'`,
      [world.projectId],
    );
    expect(validations.rows).toHaveLength(1);
    expect(validations.rows[0]).toMatchObject({ disposition: "accepted" });
    expect(
      await countBinding(
        "business.identification_knowledge_revision_bindings",
        `project_id = $1 AND revision_id = $2 AND binding_kind = 'validated'`,
        [world.projectId, revisionRef.reference.entityId],
      ),
    ).toBe("1");
  }, 300_000);

  it("isolates the validation artifact per submit command on a repeated package", async () => {
    const adapter = adapterFor();
    const world = await fixture.createPreparationWorld("validation-artifact-identity");
    const sourceVersionRef = world.snapshot.sourceVersionRefs[0];
    if (sourceVersionRef === undefined) {
      throw new Error("the preparation world has no frozen source version");
    }
    const unreachable = {
      locator: { sourceSegmentId: "source-unknown-chapter-1-segment-1" },
      sourceVersion: sourceVersionRef.reference,
    };
    const value = processModelPackage({
      ...fixture.builderInput(),
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      evidence: [unreachable],
    });
    const submission = {
      projectId: world.projectId,
      evidence: [unreachable],
      samePackage: true,
    };
    // 第一次提交因证据不可达被判 repairable 拒绝，但已经按该命令写下验证工件与验证行。
    const rejected = await submitPackage(adapter, "process-model", value, {
      ...submission,
      replay: true,
    });
    expect(rejected).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    // 新命令提交同一包（相同内容摘要、不同 issuedAt/授权）：验证工件的 put 身份按提交命令
    // 隔离，第二次提交不能被第一次提交的 C04 幂等身份挡住，必须照旧得到 C17 领域结论。
    const resubmitted = await submitPackage(adapter, "process-model", value, submission);
    expect(resubmitted).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const validations = await fixture.cleaning.postgres.adminPool.query<{
      validation_artifact_ref: { reference: { entityId: string } };
      package_digest: string;
    }>(
      `SELECT validation_artifact_ref, package_digest
         FROM business.identification_knowledge_validations
        WHERE project_id = $1
        ORDER BY occurred_at, validation_id`,
      [world.projectId],
    );
    expect(validations.rows).toHaveLength(2);
    // 逐命令隔离验证工件身份，同时保留包摘要。
    expect(
      new Set(validations.rows.map((row) => row.validation_artifact_ref.reference.entityId)).size,
    ).toBe(2);
    expect(new Set(validations.rows.map((row) => row.package_digest)).size).toBe(1);
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

  it("assembles approved retrieval members without a second review and reuses the release", async () => {
    const world = await fixture.createPreparationWorld("derived-composite");
    const adapter = adapterFor();
    const input = {
      ...fixture.builderInput(),
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      evidence: world.evidence,
    };
    const publish = async (definitionType: Parameters<typeof submitPackage>[1], value: unknown) => {
      const revision = revisionOf(
        await submitPackage(adapter, definitionType, value, {
          projectId: world.projectId,
          evidence: world.evidence,
        }),
        definitionType,
      );
      return (await publishRevision(adapter, revision, world.projectId)).releaseRef;
    };
    const processModel = await publish("process-model", processModelPackage(input));
    const parents = [
      await publish(
        "risk-mechanism",
        riskMechanismPackage({ ...input, processModelReleaseRef: processModel.reference }),
      ),
      await publish("standard-library", standardLibraryPackage(input)),
      await publish("case-library", caseLibraryPackage(input)),
    ];
    const resolve = async () => {
      const commandId = nextId("derive-composite");
      const authorization = await fixture.authorizationFor(
        commandId,
        "knowledge-modeling.identification-basis",
        world.projectId,
      );
      return adapter.resolve(
        KnowledgeResolutionCommandV1Schema.parse({
          kind: "identification-basis",
          commandId,
          idempotencyKey: commandId,
          projectId: world.projectId,
          actorId: authorization.actorId,
          issuedAt: tick(),
          authorization,
          payload: { preparationSnapshotRef: world.snapshotRef, requiredAt: tick() },
        }),
      );
    };
    const first = await resolve();
    expect(first).toMatchObject({ kind: "succeeded", result: { kind: "identification-basis" } });
    const replay = await resolve();
    expect(replay).toEqual(first);
    const rows = await fixture.cleaning.postgres.adminPool.query<{
      publication_origin: { kind: string; parentReleaseRefs: unknown[] };
      review_task_ref: unknown;
      review_decision_ref: unknown;
    }>(
      `SELECT publication_origin, review_task_ref, review_decision_ref
        FROM business.knowledge_releases WHERE project_id = $1 AND definition_type = 'retrieval-evidence-base'`,
      [world.projectId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      publication_origin: {
        kind: "derived-approved",
        parentReleaseRefs: parents,
      },
      review_task_ref: null,
      review_decision_ref: null,
    });
    expect(
      await countBinding(
        "outbox.events",
        "project_id = $1 AND event_type = 'knowledge.identification-basis-published.v1'",
        [world.projectId],
      ),
    ).toBe("1");
  }, 240_000);

  it("reads the approved entries of an exact release and the legal empty set", async () => {
    const world = await fixture.createPreparationWorld("visible-entries");
    const adapter = adapterFor();
    const base = standardLibraryPackage({
      ...fixture.builderInput(),
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      evidence: world.evidence,
    });
    // 同一发布内的多条登记条目必须逐条返回；只返回首条会让后续按成员检索悄悄丢事实。
    const value = {
      ...base,
      entries: [
        ...base.entries,
        { ...base.entries[0]!, entryId: "standard-2", clauseRefs: ["clause-4.1"] },
      ],
    };
    const revisionRef = revisionOf(
      await submitPackage(adapter, "standard-library", value, {
        projectId: world.projectId,
        evidence: world.evidence,
      }),
      "standard-library submit",
    );
    const { releaseRef } = await publishRevision(adapter, revisionRef, world.projectId);
    const authorization = await fixture.authorizationFor(
      nextId("c17-visible-entries"),
      "knowledge-modeling.hybrid-evidence",
      world.projectId,
    );
    const entries = await adapter.readVisibleEntries({
      projectId: world.projectId,
      releaseRefs: [releaseRef],
      authorization,
    });
    const byEntryId = new Map(entries.map((entry) => [entry.sourceEntryId, entry]));
    expect([...byEntryId.keys()].sort()).toEqual(["standard-1", "standard-2"]);
    // 条目正文就是发布时登记的批准正文：不重读候选工件，也不回落到 Qdrant 载荷。
    expect(byEntryId.get("standard-1")).toEqual({
      sourceKind: "standard-library",
      sourceReleaseRef: releaseRef,
      sourceEntryId: "standard-1",
      entry: value.entries[0],
    });
    expect(byEntryId.get("standard-2")).toEqual({
      sourceKind: "standard-library",
      sourceReleaseRef: releaseRef,
      sourceEntryId: "standard-2",
      entry: value.entries[1],
    });
    // 模拟000059之前发布的原包：条目投影尚未登记，读取仍须取得所属能力。
    await fixture.cleaning.postgres.adminPool.query(
      "DELETE FROM business.identification_knowledge_entries WHERE project_id = $1 AND release_id = $2 AND release_version_id = $3",
      [world.projectId, releaseRef.reference.entityId, releaseRef.reference.versionId],
    );
    const deniedAdapter = fixture.createIdentificationKnowledgeAdapter({
      authorizeDenial: (input) => input.branch === "knowledge-modeling.identification-basis",
    }).adapter;
    await expect(
      deniedAdapter.readVisibleEntries({
        projectId: world.projectId,
        releaseRefs: [releaseRef],
        authorization,
      }),
    ).rejects.toThrow();
    expect(
      await countBinding("business.identification_knowledge_entries", "project_id = $1", [
        world.projectId,
      ]),
    ).toBe("0");
    const backfilled = await adapter.readVisibleEntries({
      projectId: world.projectId,
      releaseRefs: [releaseRef],
      authorization,
    });
    expect(new Map(backfilled.map((entry) => [entry.sourceEntryId, entry]))).toEqual(byEntryId);
    const unregistered = {
      kind: "knowledge-release" as const,
      reference: { entityId: "c17-unknown-release", versionId: "1" },
    };
    // 未登记的发布引用是合法空集：不扩读其他发布，也不抛错。
    expect(
      await adapter.readVisibleEntries({
        projectId: world.projectId,
        releaseRefs: [unregistered],
        authorization,
      }),
    ).toEqual([]);
    // 同一调用里混入未登记的发布引用不会连坐吞掉合法条目。
    expect(
      [
        ...new Set(
          (
            await adapter.readVisibleEntries({
              projectId: world.projectId,
              releaseRefs: [unregistered, releaseRef],
              authorization,
            })
          ).map((entry) => entry.sourceEntryId),
        ),
      ].sort(),
    ).toEqual(["standard-1", "standard-2"]);
  }, 300_000);

  it("stops returning entries once their source visibility is withdrawn", async () => {
    const world = await fixture.createPreparationWorld("visible-withdrawn", ["csv", "xlsx"]);
    const adapter = adapterFor();
    const base = standardLibraryPackage({
      ...fixture.builderInput(),
      projectId: world.projectId,
      preparationSnapshotRef: world.snapshotRef,
      evidence: world.evidence,
    });
    expect(world.sourceVersionRefs).toHaveLength(2);
    const value = {
      ...base,
      entries: world.sourceVersionRefs.map((source, index) => ({
        ...base.entries[0]!,
        entryId: `standard-${index + 1}`,
        evidence: world.evidence.filter(
          (evidence) =>
            evidence.sourceVersion.entityId === source.reference.entityId &&
            evidence.sourceVersion.versionId === source.reference.versionId,
        ),
      })),
    };
    const revisionRef = revisionOf(
      await submitPackage(adapter, "standard-library", value, {
        projectId: world.projectId,
        evidence: world.evidence,
      }),
      "standard-library submit",
    );
    const { releaseRef } = await publishRevision(adapter, revisionRef, world.projectId);
    const authorization = await fixture.authorizationFor(
      nextId("c17-visible-withdrawn"),
      "knowledge-modeling.hybrid-evidence",
      world.projectId,
    );
    const visible = async () =>
      await adapter.readVisibleEntries({
        projectId: world.projectId,
        releaseRefs: [releaseRef],
        authorization,
      });
    expect((await visible()).map((entry) => entry.sourceEntryId).sort()).toEqual([
      "standard-1",
      "standard-2",
    ]);

    const sourceVersionRef = world.sourceVersionRefs[0]!;
    // 可见范围变更仍由真实 C02 命令执行；这里只读取当前授权版本号与另一个在册成员身份。
    const policies = await fixture.cleaning.postgres.adminPool.query<{
      source_access_grant_id: string;
      revision_no: number;
    }>(
      `SELECT policy.source_access_grant_id, revision.revision_no
         FROM business.source_access_policies AS policy
         JOIN business.source_access_policy_revisions AS revision
           ON revision.revision_id = policy.current_revision_id
        WHERE policy.project_id = $1
          AND policy.source_entity_id = $2
          AND policy.source_version_id = $3`,
      [world.projectId, sourceVersionRef.reference.entityId, sourceVersionRef.reference.versionId],
    );
    const otherMembers = await fixture.cleaning.postgres.adminPool.query<{ account_id: string }>(
      `SELECT account_id FROM business.project_memberships
        WHERE project_id = $1 AND account_id <> $2 ORDER BY account_id LIMIT 1`,
      [world.projectId, authorization.actorId],
    );
    expect(policies.rows).toHaveLength(1);
    expect(otherMembers.rows).toHaveLength(1);
    const commandId = nextId("c17-withdraw-source-access");
    const withdrawn = await fixture.cleaning.access.administerProject({
      kind: "revise-source-access",
      projectId: world.projectId,
      commandId,
      idempotencyKey: commandId,
      expectedVersion: {
        entityId: policies.rows[0]!.source_access_grant_id,
        versionId: String(policies.rows[0]!.revision_no),
      },
      authorizationContextRef: (
        await fixture.authorizationFor(
          commandId,
          "engineering-data.register-source-delivery",
          world.projectId,
        )
      ).authorizationContextRef,
      sourceVersionRef,
      visibility: "restricted",
      allowedAccountIds: [otherMembers.rows[0]!.account_id],
      spatialScopeRefs: [],
      registeredByAccountId: otherMembers.rows[0]!.account_id,
    });
    expect(withdrawn).toMatchObject({ kind: "source-access" });
    // 登记条目仍在原表里：读面只是按当前来源权限过滤，没有删除或改写已批准内容。
    expect(
      await countBinding(
        "business.identification_knowledge_entries",
        "project_id = $1 AND release_id = $2",
        [world.projectId, releaseRef.reference.entityId],
      ),
    ).toBe("2");
    expect((await visible()).map((entry) => entry.sourceEntryId)).toEqual(["standard-2"]);
  }, 300_000);

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

  const hybridEvidenceQuery = async (): Promise<KnowledgeRetrievalQueryV1> => {
    const queryId = nextId("c17-retrieve");
    return KnowledgeRetrievalQueryV1Schema.parse({
      kind: "hybrid-evidence",
      queryId,
      projectId: fixture.world.projectId,
      actorId: fixture.world.readAuthorization.actorId,
      requestedAt: tick(),
      authorization: await fixture.authorizationFor(queryId, "knowledge-modeling.hybrid-evidence"),
      payload: {
        inputSnapshotRef: {
          kind: "identification-input-snapshot",
          reference: { entityId: "c20-input-snapshot", versionId: "4" },
        },
        workItemRef: {
          kind: "identification-work-item",
          reference: { entityId: "c20-work-item", versionId: "2" },
        },
        retrievalPolicyRef: { entityId: "c20-hybrid-retrieval-policy", versionId: "1" },
      },
    });
  };

  /**
   * C20 D13 的最小组合：本用例只走 `retrieve()`，其余分支不可达，故必需依赖一律显式失败，
   * 不伪造成功；检索结果只来自注入的 delegate。
   */
  const adapterWithRetrievalDelegate = (
    retrievalDelegate: Pick<KnowledgeModelingPortV1, "retrieve">,
  ): PostgresIdentificationKnowledgeAdapter =>
    new PostgresIdentificationKnowledgeAdapter({
      db: fixture.cleaning.runtime.db,
      transactionUnit: fixture.cleaning.transactionUnit,
      access: fixture.cleaning.access,
      artifactStore: fixture.cleaning.artifactStore,
      artifactReferenceGuard: fixture.cleaning.artifactRegistry,
      governance: fixture.governance,
      assessmentBasisResolver: {
        resolve: async () => {
          throw new Error("the retrieval delegation case never resolves an assessment basis");
        },
      },
      retrievalDelegate,
      narrowRead: {
        preparationRead: fixture.cleaning.store,
        engineeringData: fixture.cleaning.registry,
      },
      policy: fixture.policy,
      agentTaskFailureEvidenceReader: {
        readTerminalFailure: async () => {
          throw new Error("the retrieval delegation case never reads failure evidence");
        },
      },
      authorize: async () => {
        throw new Error("the retrieval delegation case never authorizes");
      },
    });

  it("keeps the unsupported-contract close-out for hybrid-evidence without a retrieval delegate", async () => {
    const adapter = adapterFor();
    const query = await hybridEvidenceQuery();
    expect(await adapter.retrieve(query)).toEqual({
      kind: "failed",
      error: {
        stageCode: "identification-knowledge.unsupported_contract",
        occurredAt: expect.any(String),
        causalRunId: query.queryId,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
      },
    });
  }, 600_000);

  it("forwards one hybrid-evidence query to an injected retrieval delegate and returns its result unchanged", async () => {
    const delegatedSuccess = KnowledgeRetrievalResultV1Schema.parse({
      kind: "succeeded",
      result: {
        knowledgeQueryResultRef: {
          kind: "knowledge-query-result",
          reference: { entityId: "c20-hybrid-query-result", versionId: "3" },
        },
      },
    });
    const delegatedFailure = KnowledgeRetrievalResultV1Schema.parse({
      kind: "failed",
      error: {
        stageCode: "retrieval.query",
        occurredAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        causalRunId: "c20-hybrid-query-denied",
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "knowledge-modeling.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      },
    });
    const queries: KnowledgeRetrievalQueryV1[] = [];
    let delegated: KnowledgeRetrievalResultV1 = delegatedSuccess;
    const adapter = adapterWithRetrievalDelegate({
      retrieve: async (query) => {
        queries.push(query);
        return delegated;
      },
    });

    const successQuery = await hybridEvidenceQuery();
    expect(await adapter.retrieve(successQuery)).toBe(delegatedSuccess);
    delegated = delegatedFailure;
    const failureQuery = await hybridEvidenceQuery();
    expect(await adapter.retrieve(failureQuery)).toBe(delegatedFailure);
    // 同一查询对象按引用各转发一次：C17 不解析、不复制对象，也不重试或映射结果。
    expect(queries).toHaveLength(2);
    expect(queries[0]).toBe(successQuery);
    expect(queries[1]).toBe(failureQuery);
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
    expect(await adapter.readModelManifest(task)).toEqual(prepared.manifest);
    expect(
      await adapter.readModelObservation(task, observation.observationArtifactRef),
    ).toHaveProperty("segments");
    await expect(
      adapter.readModelObservation(
        {
          ...task,
          envelope: {
            ...task.envelope,
            agentTaskRef: {
              ...task.envelope.agentTaskRef,
              reference: { ...task.envelope.agentTaskRef.reference, entityId: "foreign-task" },
            },
          },
        },
        observation.observationArtifactRef,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    await expect(
      adapter.readModelManifest({
        ...task,
        envelope: {
          ...task.envelope,
          parentRunRef: {
            kind: "workflow-run",
            reference: { entityId: "foreign-run", versionId: "1" },
          },
        },
      }),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });

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
    expect(
      (
        await fixture.cleaning.artifactRegistry.readManifest(
          isolated.projectId,
          validation.validationArtifactRef,
        )
      )?.purposeCode,
    ).toBe("agent-validation");
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
    const { releaseRef } = await publishRevision(adapter, revisionRef, isolated.projectId);
    const readId = nextId("authoring-baseline");
    const baseline = await adapter.readExact({
      projectId: isolated.projectId,
      actorId: isolated.readAuthorization.actorId,
      requestedAt: tick(),
      invocationId: readId,
      releaseRef,
      authorization: await fixture.authorizationFor(
        readId,
        "knowledge-modeling.identification-basis",
        isolated.projectId,
      ),
    });
    if (baseline.kind !== "succeeded")
      throw new Error("the published authoring baseline is missing");
    const updateId = nextId("authoring-update");
    const { adapter: updateAdapter } = fixture.createIdentificationKnowledgeAdapter({
      now: () => new Date("2030-01-03T00:00:00.000Z"),
    });
    const update = await updateAdapter.prepareOrReplayAuthoringTask({
      projectId: isolated.projectId,
      actorId: isolated.readAuthorization.actorId,
      issuedAt: tick(),
      authorization: await fixture.authorizationFor(
        updateId,
        "knowledge-modeling.submit-revision",
        isolated.projectId,
      ),
      definitionType: "process-model",
      preparationSnapshotRef: isolated.snapshotRef,
      parentRunRef: workflowRunRef,
      baseReleaseRef: releaseRef,
      commandId: updateId,
      idempotencyKey: updateId,
    });
    if (update.kind !== "succeeded") throw new Error("authoring update was not prepared");
    const updateTask = await agentTaskAdapter.getTask(update.agentTaskRef);
    if (updateTask === undefined) throw new Error("authoring update task is missing");
    const operation = declareNodeOperations(isolated)[0]!;
    const updatedResult = await updateAdapter.createTaskDefinition().finalizeCandidate(
      {
        ...candidate,
        operations: [
          {
            ...operation,
            expectedBaselineDigest: baseline.read.validation.packageDigest,
            node: { ...operation.node, nodeId: "additional-authoring-node" },
          },
        ],
      },
      updateTask,
    );
    expect(updatedResult).toMatchObject({ status: "completed" });
    const rejectedValidation = await updateAdapter.createTaskDefinition().validateCandidate(
      {
        ...candidate,
        operations: [
          { ...operation, expectedBaselineDigest: baseline.read.validation.packageDigest },
        ],
      },
      updateTask,
    );
    expect(rejectedValidation).toMatchObject({
      disposition: "rejected",
      rejectionClass: "repairable",
    });
    expect(
      (
        await fixture.cleaning.artifactRegistry.readManifest(
          isolated.projectId,
          rejectedValidation.validationArtifactRef,
        )
      )?.purposeCode,
    ).toBe("agent-validation");
  }, 300_000);

  it.each([false, true])(
    "settles a cancelled authoring task with published baseline=%s into a failure-only revision and one review",
    async (published) => {
      const reads: AgentTaskFailureEvidenceReadRequestV1[] = [];
      const readerHolder: { reader?: AgentTaskFailureEvidenceReaderV1 } = {};
      // 收口只允许经注入的 C08 公共窄读：转发的仍是同一 adapter 的真实实现。
      const { adapter, agentTaskAdapter } = fixture.createIdentificationKnowledgeAdapter({
        now: () => new Date("2030-01-03T00:00:00.000Z"),
        failureEvidenceReader: {
          readTerminalFailure: async (request) => {
            reads.push(request);
            if (readerHolder.reader === undefined) throw new Error("the reader is not wired");
            return await readerHolder.reader.readTerminalFailure(request);
          },
        },
      });
      readerHolder.reader = agentTaskAdapter;
      const { isolated, prepared } = await prepareAuthoring(adapter, `settlement-${published}`);
      let currentReleaseRef: KnowledgeReleaseRefV1 | undefined;
      if (published) {
        const revision = revisionOf(
          await submitPackage(
            adapter,
            "standard-library",
            standardLibraryPackage({
              ...fixture.builderInput(),
              projectId: isolated.projectId,
              preparationSnapshotRef: isolated.snapshotRef,
              evidence: isolated.evidence,
            }),
            { projectId: isolated.projectId, evidence: isolated.evidence },
          ),
          "settlement baseline",
        );
        ({ releaseRef: currentReleaseRef } = await publishRevision(
          adapter,
          revision,
          isolated.projectId,
        ));
      }
      const taskEntityId = prepared.agentTaskRef.reference.entityId;
      // 任务仍在运行时 C08 窄读按「非终态」同形拒绝：不收口、不写任何失败事实，但原因必须可查。
      const pendingOutcome = await adapter.settleAuthoringFailures();
      expect(pendingOutcome.settled).toBe(0);
      expect(
        pendingOutcome.failures.find(
          (failure) => failure.taskRef.reference.entityId === taskEntityId,
        )?.error,
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
      const cancelledTask = await agentTaskAdapter.getTask(prepared.agentTaskRef);
      const runAttempt = vi.fn(async (input, operation) => {
        expect(input).toEqual({
          projectId: isolated.projectId,
          actorId: isolated.readAuthorization.actorId,
          taskRef: prepared.agentTaskRef,
        });
        await operation();
      });
      const settled = await adapter.settleAuthoringFailures(runAttempt);
      expect(settled).toMatchObject({ settled: 1, failures: [] });
      expect(runAttempt).toHaveBeenCalledOnce();
      expect(await agentTaskAdapter.getTask(prepared.agentTaskRef)).toEqual(cancelledTask);
      if (published) {
        const submitted = await fixture.cleaning.postgres.adminPool.query<{
          base_release_ref: unknown;
        }>(
          `SELECT r.base_release_ref FROM business.knowledge_revisions r
          JOIN business.identification_knowledge_revision_bindings b ON b.revision_id = r.revision_id
          WHERE b.project_id = $1 AND b.agent_task_ref->'reference'->>'entityId' = $2`,
          [isolated.projectId, prepared.agentTaskRef.reference.entityId],
        );
        expect(submitted.rows[0]?.base_release_ref).toEqual(currentReleaseRef);
      }
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
      const failureReleaseCommandId = nextId("c17-publish-failure");
      const failureReleaseAuthorization = await fixture.authorizationFor(
        failureReleaseCommandId,
        "knowledge-modeling.publish-approved-release",
        isolated.projectId,
      );
      const failureRelease = await adapter.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "publish-approved-release",
          commandId: failureReleaseCommandId,
          idempotencyKey: failureReleaseCommandId,
          projectId: isolated.projectId,
          actorId: failureReleaseAuthorization.actorId,
          issuedAt: "2030-01-02T00:01:00.000Z",
          authorization: failureReleaseAuthorization,
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
    },
    300_000,
  );

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
    // 模拟失败绑定事务已提交、attempt CAS 尚未执行时进程退出。
    const recordFailureCommandId = `${taskEntityId}:record-failure-attempt`;
    await fixture.cleaning.postgres.adminPool.query(
      `DELETE FROM business.command_receipts
        WHERE project_id = $1
          AND command_kind = 'knowledge.identification-knowledge.record-authoring-failure.v1'
          AND idempotency_key = $2`,
      [isolated.projectId, recordFailureCommandId],
    );
    await fixture.cleaning.postgres.adminPool.query(
      `DELETE FROM audit.entries WHERE project_id = $1 AND command_id = $2`,
      [isolated.projectId, recordFailureCommandId],
    );
    await fixture.cleaning.postgres.adminPool.query(
      `UPDATE business.identification_knowledge_authoring_attempts
          SET stage = 'task-started', failure_artifact_ref = NULL
        WHERE project_id = $1
          AND agent_task_ref->'reference'->>'entityId' = $2`,
      [isolated.projectId, taskEntityId],
    );
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
