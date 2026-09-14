import { describe, expect, it } from "vitest";

import {
  ACCESS_POLICY_REF_V1,
  AccessErrorV1Schema,
  AccessServiceError,
  type AuthorizationRequestV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import type { TransactionContextV1 } from "@riskflow/core/persistence";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import {
  KnowledgeAuthoringManifestV1Schema,
  IdentificationKnowledgeValidationPolicyV1Schema,
  type IdentificationKnowledgeValidationPolicyV1,
} from "@riskflow/core/identification-knowledge";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  type AuthorizationContextV1,
  type EngineeringDataQueryV1,
} from "@riskflow/contracts/ports";
import { IdentificationPreparationSnapshotV1Schema } from "@riskflow/contracts/workflows";
import type { VersionReference } from "@riskflow/contracts/common";

import {
  createPostgresIdentificationKnowledgeComposition,
  type IdentificationKnowledgeAuthorizationSourceV1,
  type PostgresIdentificationKnowledgeCompositionOptionsV1,
  type PostgresIdentificationKnowledgeCompositionV1,
} from "../../src/identification-knowledge/index.js";

const NOW = "2030-01-01T00:00:01.000Z";
const PROJECT_ID = "project-c17-composition";
const ACTOR_ID = "account-c17-author";
const SESSION_TOKEN = "c17-author-session-token";
const EVIDENCE_ACCESS_BRANCH = "engineering-data.evidence-access";
const EVIDENCE_ACCESS_CAPABILITY = "engineering-data.read" as const;

const ref = (entityId: string, versionId = "1"): VersionReference => ({ entityId, versionId });

const policy: IdentificationKnowledgeValidationPolicyV1 =
  IdentificationKnowledgeValidationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: ref("policy:identification-knowledge"),
    criticalProcessKinds: ["扩径准备"],
    coverage: [{ processKind: "扩径准备", minimumMechanisms: 1, minimumEvidence: 1 }],
    allowedStandardLevels: ["national"],
    allowedCaseConstructionMethods: ["variable-diameter-shield"],
    maxEntriesPerPackage: 64,
    tools: {
      segmentSliceToolRef: ref("tool:knowledge-segment-slice"),
      baselineKnowledgeToolRef: ref("tool:baseline-knowledge"),
    },
    agent: {
      definitionRef: ref("agent-definition:knowledge-authoring"),
      modelDeploymentRef: ref("model-deployment:knowledge-authoring"),
      promptTemplateRef: ref("prompt-template:knowledge-authoring"),
      toolPolicyRef: ref("tool-policy:knowledge-authoring"),
      budgetPolicyRef: ref("budget-policy:knowledge-authoring"),
      incrementSchemaRef: ref("increment-schema:knowledge-authoring"),
      validationPolicyRef: ref("validation-policy:knowledge-authoring"),
      budgetPolicy: {
        schemaVersion: "1",
        policyRef: ref("budget-policy:knowledge-authoring"),
        modelDeploymentRef: ref("model-deployment:knowledge-authoring"),
        promptTemplateRef: ref("prompt-template:knowledge-authoring"),
        toolPolicyRef: ref("tool-policy:knowledge-authoring"),
        maxModelInvocations: 4,
        maxToolInvocations: 4,
        maxContextTokens: 4096,
        maxOutputTokens: 1024,
        maxInputBytes: 65_536,
        maxOutputBytes: 65_536,
        maxCandidates: 2,
        maxObjects: 16,
        maxSupplementarySearches: 0,
        maxCorrections: 1,
        maxTransientRetries: 0,
        maxConcurrentActions: 1,
        maxWallClockMs: 60_000,
      },
    },
  });

const snapshot = IdentificationPreparationSnapshotV1Schema.parse({
  schemaVersion: "1",
  projectRevisionRef: { kind: "project-revision", reference: ref("project-revision") },
  spatialScopeRefs: [{ kind: "spatial-scope", reference: ref("scope:project") }],
  sourceVersionRefs: [{ kind: "source-version", reference: ref("source-version:manual") }],
  includedSourceSegmentSetRefs: [
    { kind: "source-segment-set", reference: ref("segment-set:manual") },
  ],
  excludedSegmentDecisionRefs: [],
  dataProcessingPolicyRef: ref("policy:cleaning"),
  dataProcessingToolRef: ref("tool:cleaning"),
  dataProcessingModelRef: ref("model:cleaning"),
  coverageDecisionRef: { kind: "route-decision", reference: ref("decision:coverage") },
  authorizationContextRef: {
    kind: "authorization-context",
    reference: ref("authorization:freeze"),
  },
  auditTrailRef: { kind: "audit-trail", reference: ref("audit:freeze") },
  createdBy: ACTOR_ID,
  createdAt: NOW,
});

const preparationSnapshotRef = {
  kind: "identification-preparation-snapshot" as const,
  reference: ref("preparation-snapshot:c17"),
};

const manifest = KnowledgeAuthoringManifestV1Schema.parse({
  schemaVersion: "1",
  manifestId: "manifest-c17",
  projectId: PROJECT_ID,
  targetDefinitionType: "process-model",
  preparationSnapshotRef,
  preparation: snapshot,
  cleaningResultArtifactRef: { kind: "content-artifact", reference: ref("result:cleaning") },
  members: [
    {
      sourceVersionRef: snapshot.sourceVersionRefs[0],
      sourceSegmentSetRef: snapshot.includedSourceSegmentSetRefs[0],
      retainedSegmentIds: ["manual-chapter-1"],
      excludedSegmentIds: [],
    },
  ],
  validationPolicyRef: policy.policyRef,
  parentRunRef: { kind: "workflow-run", reference: ref("run:c17") },
  authorizationContextRef: {
    kind: "authorization-context",
    reference: ref("authorization:submit"),
  },
  agent: {
    definitionRef: policy.agent.definitionRef,
    modelDeploymentRef: policy.agent.modelDeploymentRef,
    promptTemplateRef: policy.agent.promptTemplateRef,
    toolPolicyRef: policy.agent.toolPolicyRef,
    budgetPolicyRef: policy.agent.budgetPolicyRef,
    incrementSchemaRef: policy.agent.incrementSchemaRef,
    validationPolicyRef: policy.agent.validationPolicyRef,
  },
  createdBy: ACTOR_ID,
  createdAt: NOW,
});

const unusedEntryPoint = async (): Promise<never> => {
  throw new Error("the C17 composition test does not use this C06 entry point");
};

const issuedContext = (request: AuthorizationRequestV1): AuthorizationContextV1 => {
  const parent = "parentContext" in request ? request.parentContext : undefined;
  return {
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: ref(`context:${request.invocationId}`),
    },
    actorId: parent?.actorId ?? ACTOR_ID,
    projectId: request.projectId,
    grantedCapabilities: [EVIDENCE_ACCESS_CAPABILITY],
    spatialScopeRefs: [...(request.requestedSpatialScopeRefs ?? [])],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    decidedAt: NOW,
    invocation: parent === undefined ? { kind: "human" } : { kind: "human" },
  };
};

const accessDenial = (): AccessServiceError =>
  new AccessServiceError(
    AccessErrorV1Schema.parse({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
      stage: "authorize.current",
      occurredAt: NOW,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: ref("access-authorization_denied", "v1"),
      },
      contextRefs: [],
      requiredCapability: EVIDENCE_ACCESS_CAPABILITY,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    }),
  );

interface CompositionHarnessV1 {
  readonly composition: PostgresIdentificationKnowledgeCompositionV1;
  readonly authorizeRequests: readonly AuthorizationRequestV1[];
  readonly narrowReadCalls: readonly string[];
  readonly engineeringDataCalls: readonly string[];
  readonly artifactReads: readonly string[];
}

const startHarness = (behavior: {
  readonly resolve: (
    request: Parameters<
      NonNullable<PostgresIdentificationKnowledgeCompositionOptionsV1["resolveAuthorizationSource"]>
    >[0],
  ) =>
    | IdentificationKnowledgeAuthorizationSourceV1
    | Promise<IdentificationKnowledgeAuthorizationSourceV1>;
  readonly authorize: (request: AuthorizationRequestV1) => AuthorizationContextV1;
  readonly preparationReadResult?: { readonly kind: "error"; readonly error: unknown } | undefined;
  readonly manifest?: typeof manifest;
}): CompositionHarnessV1 => {
  const authorizeRequests: AuthorizationRequestV1[] = [];
  const narrowReadCalls: string[] = [];
  const engineeringDataCalls: string[] = [];
  const artifactReads: string[] = [];
  let issued: AuthorizationContextV1 | undefined;
  const access = {
    ...(Object.fromEntries(
      ["administerIdentity", "administerProject", "login", "changePassword", "logout"].map(
        (method) => [method, unusedEntryPoint],
      ),
    ) as Record<string, typeof unusedEntryPoint>),
    async authorize(request: AuthorizationRequestV1) {
      authorizeRequests.push(request);
      const context = behavior.authorize(request);
      issued = context;
      return { context, contextRef: context.authorizationContextRef, redacted: false };
    },
    async verify(request: { projectId: string }) {
      const context = issued ?? {
        ...issuedContext({} as AuthorizationRequestV1),
        projectId: request.projectId,
      };
      return { context, contextRef: context.authorizationContextRef, redacted: false };
    },
  } as unknown as LocalIdentityAccessV1;
  const transactionUnit: TransactionUnitV1 = {
    async execute(_command, handler) {
      await handler({} as TransactionContextV1);
      throw new Error("the C03 test double cannot commit a transaction");
    },
  };
  const artifactStore = {
    async open(input: { artifactRef: { reference: { entityId: string } } }) {
      artifactReads.push(input.artifactRef.reference.entityId);
      return {
        content: (async function* () {
          yield new TextEncoder().encode(JSON.stringify(behavior.manifest ?? manifest));
        })(),
        verified: Promise.resolve(),
      };
    },
    put: unusedEntryPoint,
  } as unknown as PostgresIdentificationKnowledgeCompositionOptionsV1["artifactStore"];
  const composition = createPostgresIdentificationKnowledgeComposition({
    db: {} as PostgresIdentificationKnowledgeCompositionOptionsV1["db"],
    transactionUnit,
    access,
    artifactStore,
    artifactReferenceGuard:
      {} as PostgresIdentificationKnowledgeCompositionOptionsV1["artifactReferenceGuard"],
    preparationRead: {
      async readExactPreparation() {
        narrowReadCalls.push("readExactPreparation");
        return (behavior.preparationReadResult ?? {
          kind: "error",
          error: {
            code: "AUTHORIZATION_DENIED",
            category: "authorization",
            retryable: false,
            causalRunId: "c17-composition-test",
          },
        }) as never;
      },
    },
    engineeringData: {
      async read(query: EngineeringDataQueryV1) {
        engineeringDataCalls.push(`read:${query.kind}`);
        return {
          kind: "failed",
          error: {
            code: "AUTHORIZATION_DENIED",
            category: "authorization",
            retryable: false,
            causalRunId: "c17-composition-test",
          },
        } as never;
      },
      async resolveReadQuery() {
        engineeringDataCalls.push("resolveReadQuery");
        return {
          kind: "failed",
          error: {
            code: "AUTHORIZATION_DENIED",
            category: "authorization",
            retryable: false,
            causalRunId: "c17-composition-test",
          },
        } as never;
      },
    },
    reviewAudit: {
      requestReview: unusedEntryPoint,
      decideReview: unusedEntryPoint,
      verifyKnowledgeRevisionApproval: unusedEntryPoint,
      trace: unusedEntryPoint,
    },
    validationPolicy: policy,
    // D-09 公共失败证据窄读：组合根只接受注入的 reader，不再用调用期转发。
    agentTaskFailureEvidenceReader: {
      async readTerminalFailure() {
        throw new Error("the composition test never settles an authoring failure");
      },
    },
    resolveAuthorizationSource: behavior.resolve,
    now: () => new Date(NOW),
  });
  return { composition, authorizeRequests, narrowReadCalls, engineeringDataCalls, artifactReads };
};

const humanSource = (): IdentificationKnowledgeAuthorizationSourceV1 => ({
  kind: "human-session",
  sessionToken: SESSION_TOKEN,
});

/** 调用方提交解析命令时自带的 C06 上下文；能力必须匹配 identification-basis 分支。 */
const commandAuthorization = (commandId: string): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: ref(`context:${commandId}`),
  },
  actorId: ACTOR_ID,
  projectId: PROJECT_ID,
  grantedCapabilities: ["knowledge-modeling.read"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: ACCESS_POLICY_REF_V1,
  decidedAt: NOW,
  invocation: { kind: "human" },
});

const identificationTask = {
  envelope: {
    schemaVersion: "1",
    agentTaskRef: {
      kind: "agent-task",
      reference: ref("agent-task:c17"),
      taskType: "knowledge-authoring",
      triggerMode: "embedded",
      modelDeploymentRef: policy.agent.modelDeploymentRef,
      promptTemplateRef: policy.agent.promptTemplateRef,
      toolPolicyRef: policy.agent.toolPolicyRef,
      budgetPolicyRef: policy.agent.budgetPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
    },
    commandId: "command:c17",
    idempotencyKey: "command:c17",
    taskType: "knowledge-authoring",
    triggerMode: "embedded",
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    parentRunRef: { kind: "workflow-run", reference: ref("run:c17") },
    frozenInputRef: {
      kind: "content-artifact",
      reference: ref("manifest-c17", `sha256:${"0".repeat(64)}`),
    },
    modelDeploymentRef: policy.agent.modelDeploymentRef,
    promptTemplateRef: policy.agent.promptTemplateRef,
    toolPolicyRef: policy.agent.toolPolicyRef,
    budgetPolicyRef: policy.agent.budgetPolicyRef,
    incrementSchemaRef: policy.agent.incrementSchemaRef,
    validationPolicyRef: policy.agent.validationPolicyRef,
    authorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: ref("context:start-task"),
      },
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: ref("access-policy", "v1"),
      decidedAt: NOW,
      invocation: { kind: "human" },
    },
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: ref("context:start-task"),
      },
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: ref("access-policy", "v1"),
      capturedAt: NOW,
    },
    createdAt: NOW,
  },
  state: {
    schemaVersion: "1",
    agentTaskRef: {
      kind: "agent-task",
      reference: ref("agent-task:c17"),
      taskType: "knowledge-authoring",
      triggerMode: "embedded",
      modelDeploymentRef: policy.agent.modelDeploymentRef,
      promptTemplateRef: policy.agent.promptTemplateRef,
      toolPolicyRef: policy.agent.toolPolicyRef,
      budgetPolicyRef: policy.agent.budgetPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
    },
    status: "running",
    taskVersion: 2,
    cancelRequested: false,
    latestCandidateVersion: 0,
    updatedAt: NOW,
  },
  budgetPolicy: policy.agent.budgetPolicy,
  budgetLedger: {
    schemaVersion: "1",
    reserved: {},
    used: {},
    activeWallClockMs: 0,
    currentConcurrency: 0,
    ledgerVersion: 1,
    changedAt: NOW,
  },
} as never;

describe("C17 worker identification knowledge composition root", () => {
  const requiredOptions = (
    overrides: Partial<PostgresIdentificationKnowledgeCompositionOptionsV1> = {},
  ): PostgresIdentificationKnowledgeCompositionOptionsV1 =>
    ({
      db: {},
      transactionUnit: { execute: unusedEntryPoint },
      access: { authorize: unusedEntryPoint, verify: unusedEntryPoint },
      artifactStore: { open: unusedEntryPoint, put: unusedEntryPoint },
      artifactReferenceGuard: { assertUsable: unusedEntryPoint },
      preparationRead: { readExactPreparation: unusedEntryPoint },
      engineeringData: { read: unusedEntryPoint, resolveReadQuery: unusedEntryPoint },
      reviewAudit: {
        requestReview: unusedEntryPoint,
        decideReview: unusedEntryPoint,
        verifyKnowledgeRevisionApproval: unusedEntryPoint,
        trace: unusedEntryPoint,
      },
      validationPolicy: policy,
      agentTaskFailureEvidenceReader: {
        readTerminalFailure: unusedEntryPoint,
      },
      resolveAuthorizationSource: humanSource,
      ...overrides,
    }) as unknown as PostgresIdentificationKnowledgeCompositionOptionsV1;

  it("refuses to construct without every C03–C17 dependency", () => {
    const dependencies = [
      "db",
      "transactionUnit",
      "access",
      "artifactStore",
      "artifactReferenceGuard",
      "preparationRead",
      "engineeringData",
      "reviewAudit",
      "validationPolicy",
      "agentTaskFailureEvidenceReader",
      "resolveAuthorizationSource",
    ] as const;
    for (const dependency of dependencies) {
      const options = requiredOptions();
      Reflect.deleteProperty(options as Record<string, unknown>, dependency);
      expect(
        () => createPostgresIdentificationKnowledgeComposition(options),
        `missing dependency ${dependency}`,
      ).toThrowError(TypeError);
    }
    expect(() => createPostgresIdentificationKnowledgeComposition(requiredOptions())).not.toThrow();
  });

  it("refuses to construct when the C08 failure evidence reader is not injected", () => {
    const options = requiredOptions();
    Reflect.deleteProperty(options as Record<string, unknown>, "agentTaskFailureEvidenceReader");
    // 缺失依赖必须在构造期关闭失败，不得留到调用期才抛 TypeError。
    expect(() => createPostgresIdentificationKnowledgeComposition(options)).toThrowError(
      "identification knowledge composition requires every C03–C17 dependency",
    );
  });

  it("signs the exact engineering-data branch for the preparation narrow read", async () => {
    const harness = startHarness({
      resolve: humanSource,
      authorize: (request) => issuedContext(request),
    });
    const commandId = "c17-resolve-read";
    const result = await harness.composition.adapter.resolve({
      kind: "identification-basis",
      commandId,
      idempotencyKey: commandId,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: NOW,
      authorization: commandAuthorization(commandId),
      payload: { preparationSnapshotRef, requiredAt: NOW },
    } as never);
    // 精确窄读失败即封闭失败，不回退到调用方能力或任何缓存正文。
    expect(result).toMatchObject({ kind: "failed" });
    expect(harness.authorizeRequests).toEqual([
      {
        invocation: { kind: "human-session", sessionToken: SESSION_TOKEN },
        invocationId: `${commandId}:preparation`,
        projectId: PROJECT_ID,
        branch: EVIDENCE_ACCESS_BRANCH,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: NOW,
      },
    ]);
    expect(harness.narrowReadCalls).toEqual(["readExactPreparation"]);
    expect(harness.engineeringDataCalls).toEqual([]);
  });

  it("stops before any target read when the trusted source denies the exact branch", async () => {
    const harness = startHarness({
      resolve: humanSource,
      authorize: (request) => {
        if (request.branch !== EVIDENCE_ACCESS_BRANCH) throw accessDenial();
        throw accessDenial();
      },
    });
    const commandId = "c17-resolve-denied";
    const result = await harness.composition.adapter.resolve({
      kind: "identification-basis",
      commandId,
      idempotencyKey: commandId,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: NOW,
      authorization: commandAuthorization(commandId),
      payload: { preparationSnapshotRef, requiredAt: NOW },
    } as never);
    expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    // 授权拒绝发生在目标读取之前：C15 窄读与 C02 读取都没有被触达。
    expect(harness.narrowReadCalls).toEqual([]);
    expect(harness.engineeringDataCalls).toEqual([]);
    expect(harness.artifactReads).toEqual([]);
  });

  it("refuses a trusted source whose context does not bind actor and project", async () => {
    const harness = startHarness({
      resolve: humanSource,
      authorize: (request) => ({ ...issuedContext(request), actorId: "account-someone-else" }),
    });
    const commandId = "c17-resolve-mismatch";
    const result = await harness.composition.adapter.resolve({
      kind: "identification-basis",
      commandId,
      idempotencyKey: commandId,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: NOW,
      authorization: commandAuthorization(commandId),
      payload: { preparationSnapshotRef, requiredAt: NOW },
    } as never);
    expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(harness.narrowReadCalls).toEqual([]);
    expect(harness.engineeringDataCalls).toEqual([]);
  });

  it("rejects out-of-manifest tool objects before any target read", async () => {
    const harness = startHarness({
      resolve: humanSource,
      authorize: (request) => issuedContext(request),
    });
    const definition = harness.composition.adapter.createTaskDefinition();
    const sliceTool = definition.tools[0]!;
    const foreignRequest = {
      kind: "read-knowledge-segment-slice",
      sourceSegmentSetRef: {
        kind: "source-segment-set",
        reference: ref("segment-set-not-frozen"),
      },
      sourceSegmentIds: ["manual-chapter-1"],
      limit: 2,
    };
    await expect(
      sliceTool.execute(foreignRequest, {
        task: identificationTask,
        taskRef: (identificationTask as { envelope: { agentTaskRef: unknown } }).envelope
          .agentTaskRef as never,
        actionId: "action:c17",
      }),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID" } });
    // 清单读取发生了，但越界请求没有触发任何 C15/C02 目标读取。
    expect(harness.artifactReads).toEqual(["manifest-c17"]);
    expect(harness.narrowReadCalls).toEqual([]);
    expect(harness.engineeringDataCalls).toEqual([]);
  });

  it("binds an in-manifest tool authorization to the trusted system parent task", async () => {
    const baseReleaseRef = {
      kind: "knowledge-release" as const,
      reference: ref("release:process-model"),
    };
    const parentContext: AuthorizationContextV1 = {
      ...commandAuthorization("agent-parent"),
      grantedCapabilities: ["knowledge-modeling.read"],
      invocation: {
        kind: "agent-task",
        agentTaskRef: identificationTask.envelope.agentTaskRef,
        actionId: "action:parent",
      },
    };
    const harness = startHarness({
      manifest: KnowledgeAuthoringManifestV1Schema.parse({
        ...manifest,
        baseReleaseRef,
        baseArtifactRef: { kind: "content-artifact", reference: ref("artifact:base") },
      }),
      resolve: () => ({
        kind: "system",
        systemActorId: "system:c17-worker",
        reasonCode: "knowledge-authoring-tool",
        parentContext,
        causalRunRef: identificationTask.envelope.parentRunRef,
      }),
      authorize: (request) => ({
        ...issuedContext(request),
        grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[request.branch]],
      }),
    });
    const [sliceTool, baselineTool] = harness.composition.adapter.createTaskDefinition().tools;
    if (sliceTool === undefined || baselineTool === undefined) throw new Error("tools are missing");
    await expect(
      baselineTool.execute(
        {
          kind: "read-exact-knowledge",
          definitionType: "process-model",
          releaseRef: baseReleaseRef,
        },
        {
          task: identificationTask,
          taskRef: identificationTask.envelope.agentTaskRef,
          actionId: "action:baseline",
        },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_TOOL_FAILURE" } });
    await expect(
      sliceTool.execute(
        {
          kind: "read-knowledge-segment-slice",
          sourceSegmentSetRef: manifest.members[0]!.sourceSegmentSetRef,
          sourceSegmentIds: [manifest.members[0]!.retainedSegmentIds[0]!],
          limit: 1,
        },
        {
          task: identificationTask,
          taskRef: identificationTask.envelope.agentTaskRef,
          actionId: "action:slice",
        },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_TOOL_FAILURE" } });
    expect(harness.authorizeRequests).toEqual([
      expect.objectContaining({
        invocationId: "action:baseline:baseline-read",
        branch: "knowledge-modeling.identification-basis",
        parentContext: expect.objectContaining({
          invocation: expect.objectContaining({
            kind: "agent-task",
            agentTaskRef: identificationTask.envelope.agentTaskRef,
          }),
        }),
      }),
      expect.objectContaining({
        invocationId: "action:slice:segment-slice:preparation",
        branch: "engineering-data.evidence-access",
        parentContext: expect.objectContaining({
          invocation: expect.objectContaining({
            kind: "agent-task",
            agentTaskRef: identificationTask.envelope.agentTaskRef,
          }),
        }),
      }),
    ]);
    expect(harness.narrowReadCalls).toEqual(["readExactPreparation"]);
    expect(harness.engineeringDataCalls).toEqual([]);
  });
});
