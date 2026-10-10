import { describe, expect, it } from "vitest";

import type {
  AtomicCommandV1,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  ACCESS_POLICY_REF_V1,
  AccessErrorV1Schema,
  AccessServiceError,
  branchCapability,
  type AuthorizationRequestV1,
  type AuthorizationVerificationRequestV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  AgentTaskDefinitionRegistry,
  AgentTaskEnvelopeV1Schema,
} from "@riskflow/core/agent-runtime";
import {
  DataCleaningPolicyV1Schema,
  type DataCleaningPolicyV1,
} from "@riskflow/core/engineering-data/cleaning";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type {
  DataCleaningAgentTaskStartRequestV1,
  PostgresDataCleaningStoreOptions,
} from "@riskflow/adapters/engineering-data/cleaning";

import {
  createPostgresDataCleaningComposition,
  type DataCleaningStartAuthorizationSourceV1,
  type PostgresDataCleaningCompositionV1,
} from "../../../src/engineering-data/cleaning/index.js";

const NOW = "2030-01-01T00:00:01.000Z";
const PROJECT_ID = "project-c15-composition";
const FREEZER_ID = "account-c15-freezer";
const SYSTEM_ACTOR_ID = "account-c15-system";
const START_SESSION_TOKEN = "c15-start-session-token";
const START_BRANCH = "agent-task.start-task";
const START_CAPABILITY = "agent-task.start" as const;

const ref = (entityId: string, versionId = "1"): VersionReference => ({ entityId, versionId });

const policy: DataCleaningPolicyV1 = DataCleaningPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: ref("policy:data-cleaning"),
  allowedConversionPolicyRefs: [ref("conversion-policy")],
  allowedQualityPolicyRefs: [ref("quality-policy")],
  allowedConverterDeploymentRefs: [ref("converter-deployment")],
  allowedExclusionReasonCodes: ["not-applicable"],
  protectedSegmentKinds: ["chapter"],
  requiredSegmentKinds: ["chapter"],
  protectedMonitoringSelectionReasons: ["latest-valid"],
  minimumRetainedSegmentRatio: 0.5,
  minimumRetainedSampleRatio: 0.5,
  minimumDocumentCoverageRatio: 0.5,
  tools: {
    documentSegmentToolRef: ref("tool:document-segment-slice"),
    monitoringSnapshotToolRef: ref("tool:monitoring-snapshot-slice"),
    maxSegmentsPerRead: 8,
    maxMonitoringItemsPerRead: 8,
  },
  agent: {
    definitionRef: ref("agent-definition:data-cleaning"),
    modelDeploymentRef: ref("model-deployment:data-cleaning"),
    promptTemplateRef: ref("prompt-template:data-cleaning"),
    toolPolicyRef: ref("tool-policy:data-cleaning"),
    budgetPolicyRef: ref("budget-policy:data-cleaning"),
    incrementSchemaRef: ref("increment-schema:data-cleaning"),
    validationPolicyRef: ref("validation-policy:data-cleaning"),
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: ref("budget-policy:data-cleaning"),
      modelDeploymentRef: ref("model-deployment:data-cleaning"),
      promptTemplateRef: ref("prompt-template:data-cleaning"),
      toolPolicyRef: ref("tool-policy:data-cleaning"),
      maxModelInvocations: 4,
      maxToolInvocations: 2,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      maxInputBytes: 65_536,
      maxOutputBytes: 65_536,
      maxCandidates: 2,
      maxObjects: 8,
      maxSupplementarySearches: 0,
      maxCorrections: 0,
      maxTransientRetries: 0,
      maxConcurrentActions: 1,
      maxWallClockMs: 60_000,
    },
  },
});

const spatialScopeRef: SpatialScopeRefV1 = {
  kind: "spatial-scope",
  reference: ref("c15-scope"),
};
const sourceVersionRefs: readonly SourceVersionRefV1[] = [
  { kind: "source-version", reference: ref("source-version:docx") },
  { kind: "source-version", reference: ref("source-version:csv") },
];

/** C15 store 只提交缺少授权的草案与命令的精确范围，因此这里没有 authorization 字段。 */
const draftRequest: DataCleaningAgentTaskStartRequestV1 = {
  command: {
    commandId: "data-cleaning-start-digest",
    idempotencyKey: "data-cleaning-task-digest",
    projectId: PROJECT_ID,
    actorId: FREEZER_ID,
    issuedAt: NOW,
    kind: "start-task",
    payload: {
      taskType: "data-cleaning",
      triggerMode: "embedded",
      parentRunRef: { kind: "workflow-run", reference: ref("data-cleaning-run-digest") },
      frozenInputRef: { kind: "content-artifact", reference: ref("data-cleaning-manifest-digest") },
      modelDeploymentRef: policy.agent.modelDeploymentRef,
      promptTemplateRef: policy.agent.promptTemplateRef,
      toolPolicyRef: policy.agent.toolPolicyRef,
      budgetPolicyRef: policy.agent.budgetPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
    },
  },
  requestedSpatialScopeRefs: [spatialScopeRef],
  requestedSourceVersionRefs: [...sourceVersionRefs],
};

type StoreOptionsV1 = Omit<PostgresDataCleaningStoreOptions, "startAgentTask">;

const unusedEntryPoint = async (): Promise<never> => {
  throw new Error("the C15 composition test does not use this C06 entry point");
};

const startedContextRef = (invocationId: string) => ({
  kind: "authorization-context" as const,
  reference: ref(`c15-start-context-${invocationId}`),
});

/** C06 `authorize` 在 exact branch 上签发的上下文形状；overrides 用于构造拒绝用例。 */
const issuedContext = (
  request: AuthorizationRequestV1,
  overrides: Record<string, unknown> = {},
): AuthorizationContextV1 => {
  const invocation = request.invocation;
  // C06 对 system 调用取父上下文的 actor，human-session 取会话账号；这里按同一规则扮演。
  const parent = "parentContext" in request ? request.parentContext : undefined;
  const causalRunRef = "causalRunRef" in request ? request.causalRunRef : undefined;
  return AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: startedContextRef(request.invocationId),
    actorId: parent?.actorId ?? FREEZER_ID,
    projectId: request.projectId,
    grantedCapabilities: [branchCapability(request.branch)],
    spatialScopeRefs: [...request.requestedSpatialScopeRefs],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    decidedAt: NOW,
    invocation: invocation.kind === "system" ? invocation : { kind: "human" },
    ...(causalRunRef === undefined ? {} : { causalRunRef }),
    ...overrides,
  });
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
      requiredCapability: START_CAPABILITY,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    }),
  );

interface StartHarnessV1 {
  readonly composition: PostgresDataCleaningCompositionV1;
  readonly authorizeRequests: readonly AuthorizationRequestV1[];
  readonly verifyRequests: readonly AuthorizationVerificationRequestV1[];
  /** C03 事务里被提交的原子命令；C08 启动事实与审计都从它派生。 */
  readonly transactionCommands: readonly AtomicCommandV1[];
}

/**
 * 用最小替身组合 C15 生产工厂：C06 会话授权由本地 fake 扮演，C03 事务边界记录 C08 命令后
 * 以真实失败收口，因此断言只落在授权请求、C08 任务信封和 adapter 的 verifier 调用上。
 */
const startHarness = (
  behavior: {
    readonly resolve: (
      request: DataCleaningAgentTaskStartRequestV1,
    ) => DataCleaningStartAuthorizationSourceV1 | Promise<DataCleaningStartAuthorizationSourceV1>;
    readonly authorize: (request: AuthorizationRequestV1) => AuthorizationContextV1;
  },
  registry?: AgentTaskDefinitionRegistry,
): StartHarnessV1 => {
  const authorizeRequests: AuthorizationRequestV1[] = [];
  const verifyRequests: AuthorizationVerificationRequestV1[] = [];
  const transactionCommands: AtomicCommandV1[] = [];
  let issued: AuthorizationContextV1 | undefined;
  const access: LocalIdentityAccessV1 = {
    administerIdentity: unusedEntryPoint,
    administerProject: unusedEntryPoint,
    login: unusedEntryPoint,
    changePassword: unusedEntryPoint,
    logout: unusedEntryPoint,
    readSession: unusedEntryPoint,
    async authorize(request) {
      authorizeRequests.push(request);
      const context = behavior.authorize(request);
      issued = context;
      return { context, contextRef: context.authorizationContextRef, redacted: false };
    },
    async verify(request) {
      verifyRequests.push(request);
      if (issued === undefined) throw new Error("C15 issued no start context to verify");
      return { context: issued, contextRef: issued.authorizationContextRef, redacted: false };
    },
  };
  const transactionUnit: TransactionUnitV1 = {
    async execute(command, handler) {
      transactionCommands.push(command);
      await handler({} as TransactionContextV1);
      throw new Error("the C03 test double cannot commit a transaction");
    },
  };
  // C08 在写事务前先按 id 读一次任务；替身只需要回答“没有既有任务”。
  const emptyTaskQuery = {
    selectAll: () => emptyTaskQuery,
    where: () => emptyTaskQuery,
    forUpdate: () => emptyTaskQuery,
    executeTakeFirst: async () => undefined,
  };
  const composition = createPostgresDataCleaningComposition({
    store: {
      db: { selectFrom: () => emptyTaskQuery } as unknown as StoreOptionsV1["db"],
      transactionUnit,
      access,
      artifactStore: {} as StoreOptionsV1["artifactStore"],
      artifactReferenceGuard: {} as StoreOptionsV1["artifactReferenceGuard"],
      monitoringStore: {} as StoreOptionsV1["monitoringStore"],
      policy,
      now: () => new Date(NOW),
    },
    agentTask: { now: () => NOW },
    resolveStartAuthorizationInvocation: behavior.resolve,
    ...(registry === undefined ? {} : { registry }),
  });
  return { composition, authorizeRequests, verifyRequests, transactionCommands };
};

describe("C15 共享任务定义注册表（C37 D-20）", () => {
  it("缺省注入时保持原工厂行为：自建 registry 且不共享", () => {
    const harness = startHarness({
      resolve: () => ({ kind: "human-session", sessionToken: START_SESSION_TOKEN }),
    });
    expect(harness.composition.registry).toBeDefined();
    const other = startHarness({
      resolve: () => ({ kind: "human-session", sessionToken: START_SESSION_TOKEN }),
    });
    // 未注入时两个工厂各持一个 registry，不应意外共享。
    expect(other.composition.registry).not.toBe(harness.composition.registry);
  });

  it("注入共享 registry 时两处组合指向同一实例", () => {
    const shared = new AgentTaskDefinitionRegistry();
    const harness = startHarness(
      { resolve: () => ({ kind: "human-session", sessionToken: START_SESSION_TOKEN }) },
      shared,
    );
    expect(harness.composition.registry).toBe(shared);
  });
});

describe("C15 worker cleaning composition root", () => {
  it("issues the C06 exact branch and hands C08 only the C06 agent-task.start context", async () => {
    const harness = startHarness({
      resolve: () => ({ kind: "human-session", sessionToken: START_SESSION_TOKEN }),
      authorize: (request) => issuedContext(request),
    });

    const result = await harness.composition.startCleaningTask(draftRequest);

    expect(harness.authorizeRequests).toEqual([
      {
        invocation: { kind: "human-session", sessionToken: START_SESSION_TOKEN },
        invocationId: draftRequest.command.commandId,
        projectId: PROJECT_ID,
        branch: START_BRANCH,
        requestedSpatialScopeRefs: [spatialScopeRef],
        requestedSourceVersionRefs: [...sourceVersionRefs],
        requestedAt: NOW,
      },
    ]);

    // C08 在创建任务时用注入的同一个 C06 verifier 复验同一 commandId 与 exact branch。
    expect(harness.verifyRequests).toEqual([
      {
        authorizationContextRef: startedContextRef(draftRequest.command.commandId),
        invocationId: draftRequest.command.commandId,
        projectId: PROJECT_ID,
        branch: START_BRANCH,
        requestedSpatialScopeRefs: [spatialScopeRef],
        requestedSourceVersionRefs: [],
      },
    ]);

    expect(harness.transactionCommands).toHaveLength(1);
    const startCommand = harness.transactionCommands[0]!;
    expect(startCommand.commandKind).toBe("agent-task.start-task");
    expect(startCommand.authorizationContextRef).toEqual(
      startedContextRef(draftRequest.command.commandId),
    );
    const envelope = AgentTaskEnvelopeV1Schema.parse(startCommand.payload);
    expect(envelope.authorization.grantedCapabilities).toEqual([START_CAPABILITY]);
    expect(envelope.authorization.authorizationContextRef).toEqual(
      startedContextRef(draftRequest.command.commandId),
    );
    expect(envelope.authorization.actorId).toBe(FREEZER_ID);
    expect(envelope.frozenAuthorization.spatialScopeRefs).toEqual([spatialScopeRef]);
    expect(envelope.frozenAuthorization.grantedCapabilities).toEqual([START_CAPABILITY]);
    // C03 事务由替身收口，因此这里只证明 C08 启动已走到事务边界，且只带 C06 上下文。
    expect(result).toMatchObject({ kind: "failed" });
  });

  it("forwards a C06-issued system parent context and causal run without inventing one", async () => {
    const parentContext = issuedContext({
      invocation: { kind: "human-session", sessionToken: START_SESSION_TOKEN },
      invocationId: "c15-freeze-command",
      projectId: PROJECT_ID,
      branch: START_BRANCH,
      requestedSpatialScopeRefs: [spatialScopeRef],
      requestedSourceVersionRefs: [...sourceVersionRefs],
    });
    const causalRunRef = {
      kind: "workflow-run" as const,
      reference: ref("data-cleaning-run-digest"),
    };
    const harness = startHarness({
      resolve: () => ({
        kind: "system",
        systemActorId: SYSTEM_ACTOR_ID,
        reasonCode: "c15-cleaning-start",
        parentContext,
        causalRunRef,
      }),
      authorize: (request) => issuedContext(request),
    });

    await harness.composition.startCleaningTask(draftRequest);

    expect(harness.authorizeRequests[0]).toMatchObject({
      invocation: {
        kind: "system",
        systemActorId: SYSTEM_ACTOR_ID,
        reasonCode: "c15-cleaning-start",
      },
      parentContext,
      causalRunRef,
      branch: START_BRANCH,
    });
    expect(harness.transactionCommands).toHaveLength(1);
  });

  it("refuses a decision for another actor, project or capability without touching C08", async () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly behavior: (request: AuthorizationRequestV1) => AuthorizationContextV1;
    }> = [
      {
        name: "another actor",
        behavior: (request) => issuedContext(request, { actorId: "account-c15-other" }),
      },
      {
        name: "another project",
        behavior: (request) => issuedContext(request, { projectId: "project-c15-other" }),
      },
      {
        name: "the freeze capability",
        behavior: (request) =>
          issuedContext(request, { grantedCapabilities: ["engineering-data.freeze"] }),
      },
      {
        name: "an extra capability",
        behavior: (request) =>
          issuedContext(request, {
            grantedCapabilities: [START_CAPABILITY, "engineering-data.freeze"],
          }),
      },
    ];
    for (const testCase of cases) {
      const harness = startHarness({
        resolve: () => ({ kind: "human-session", sessionToken: START_SESSION_TOKEN }),
        authorize: testCase.behavior,
      });
      await expect(harness.composition.startCleaningTask(draftRequest)).rejects.toMatchObject({
        details: { code: "AUTHORIZATION_DENIED" },
      });
      expect(harness.verifyRequests, testCase.name).toEqual([]);
      expect(harness.transactionCommands, testCase.name).toEqual([]);
    }
  });

  it("propagates the C06 rejection and creates no C08 task", async () => {
    const harness = startHarness({
      resolve: () => ({ kind: "human-session", sessionToken: START_SESSION_TOKEN }),
      authorize: () => {
        throw accessDenial();
      },
    });

    await expect(harness.composition.startCleaningTask(draftRequest)).rejects.toBeInstanceOf(
      AccessServiceError,
    );
    expect(harness.verifyRequests).toEqual([]);
    expect(harness.transactionCommands).toEqual([]);
  });

  it("fails closed when the deployment has no trusted invocation source", async () => {
    const harness = startHarness({
      resolve: () => {
        throw new Error("no request-scoped C06 session for the cleaning start");
      },
      authorize: (request) => issuedContext(request),
    });

    await expect(harness.composition.startCleaningTask(draftRequest)).rejects.toThrow(
      "no request-scoped C06 session",
    );
    expect(harness.authorizeRequests).toEqual([]);
    expect(harness.transactionCommands).toEqual([]);
  });
});
