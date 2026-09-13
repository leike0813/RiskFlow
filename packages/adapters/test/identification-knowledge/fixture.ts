import {
  ContentArtifactRefV1Schema,
  type ModuleBranchV1,
  ProcessModelReleaseRefV1Schema,
  RiskMechanismReleaseRefV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type EvidenceReference,
  type IdentificationPreparationSnapshotRefV1,
  type KnowledgeReleaseRefV1,
  type SourceSegmentSetRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { IdentificationPreparationSnapshotV1 } from "@riskflow/contracts/workflows";
import { KnowledgeLifecycleError } from "@riskflow/core/knowledge-governance";
import {
  IdentificationKnowledgeValidationPolicyV1Schema,
  type IdentificationKnowledgeValidationPolicyV1,
  type IdentificationPreparationKnowledgeReaderV1,
} from "@riskflow/core/identification-knowledge";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";

import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import type { AgentTaskFailureEvidenceReaderV1 } from "@riskflow/core/agent-runtime";
import type { AgentTaskPortV1 } from "@riskflow/contracts/ports";

import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import {
  PostgresIdentificationKnowledgeAdapter,
  PostgresIdentificationKnowledgeReleasePolicy,
  PostgresIdentificationPreparationKnowledgeReader,
  type IdentificationKnowledgeAuthorizationRequestV1,
  type PostgresIdentificationKnowledgeAdapterOptionsV1,
} from "../../src/identification-knowledge/index.js";
import { PostgresKnowledgeGovernanceAdapter } from "../../src/knowledge-governance/index.js";
import type { KnowledgeGovernanceReviewAuthorizationProviderV1 } from "../../src/knowledge-governance/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import {
  completeCleaningTask,
  freezeIdentificationPreparation,
  startDataCleaningFixture,
  type CleaningWorldOptionsV1,
  type DataCleaningPostgresFixture,
} from "../engineering-data/cleaning/fixture.js";

export const IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";
const PREPARATION_READ_BRANCH = "engineering-data.evidence-access" as const;

const POLICY_REF = { entityId: "c17-identification-knowledge-policy", versionId: "1" };

/**
 * C17 校验策略：关键工序覆盖门槛、允许规范层级/案例方法、条目上限和 C08 编制引用
 * 都由组合根注入，测试夹具提供一份确定性的审核策略。
 */
export const identificationKnowledgePolicy = (
  overrides: Partial<IdentificationKnowledgeValidationPolicyV1> = {},
): IdentificationKnowledgeValidationPolicyV1 =>
  IdentificationKnowledgeValidationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: POLICY_REF,
    criticalProcessKinds: ["扩径准备", "缩径转换"],
    coverage: [
      { processKind: "扩径准备", minimumMechanisms: 1, minimumEvidence: 1 },
      { processKind: "缩径转换", minimumMechanisms: 1, minimumEvidence: 1 },
    ],
    allowedStandardLevels: ["national", "industry"],
    allowedCaseConstructionMethods: ["variable-diameter-shield"],
    maxEntriesPerPackage: 64,
    tools: {
      segmentSliceToolRef: { entityId: "c17-segment-slice-tool", versionId: "1" },
      baselineKnowledgeToolRef: { entityId: "c17-baseline-knowledge-tool", versionId: "1" },
    },
    agent: {
      definitionRef: { entityId: "c17-knowledge-authoring-definition", versionId: "1" },
      modelDeploymentRef: { entityId: "c17-model-deployment", versionId: "1" },
      promptTemplateRef: { entityId: "c17-prompt-template", versionId: "1" },
      toolPolicyRef: { entityId: "c17-tool-policy", versionId: "1" },
      budgetPolicyRef: { entityId: "c17-budget-policy", versionId: "1" },
      incrementSchemaRef: { entityId: "c17-increment-schema", versionId: "1" },
      validationPolicyRef: { entityId: "c17-validation-policy", versionId: "1" },
      budgetPolicy: {
        schemaVersion: "1",
        policyRef: { entityId: "c17-budget-policy", versionId: "1" },
        modelDeploymentRef: { entityId: "c17-model-deployment", versionId: "1" },
        promptTemplateRef: { entityId: "c17-prompt-template", versionId: "1" },
        toolPolicyRef: { entityId: "c17-tool-policy", versionId: "1" },
        maxModelInvocations: 4,
        maxToolInvocations: 4,
        maxContextTokens: 4096,
        maxOutputTokens: 1024,
        maxInputBytes: 65_536,
        maxOutputBytes: 65_536,
        maxCandidates: 2,
        maxObjects: 64,
        maxSupplementarySearches: 0,
        maxCorrections: 1,
        maxTransientRetries: 0,
        maxConcurrentActions: 1,
        maxWallClockMs: 60_000,
      },
    },
    ...overrides,
  });

export interface IdentificationKnowledgeBuilderInputV1 {
  readonly projectId: string;
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly validationPolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly generatedAt: string;
  readonly evidence: readonly EvidenceReference[];
}

const NODE_KINDS = ["扩径准备", "变径空间扩挖", "刀盘扩径", "盾体扩径", "缩径转换"] as const;

const MECHANISM_TYPES = [
  "掌子面稳定性失效",
  "支护结构失效",
  "渗流突涌",
  "过挖与地表沉降",
  "施工装备故障",
  "装配连接失效",
] as const;

const APPLICABILITY = {
  constructionMethod: ["variable-diameter-shield"],
  stratumCondition: ["soft-soil"],
  engineeringStage: ["expansion-preparation"],
};

export const processModelPackage = (input: IdentificationKnowledgeBuilderInputV1) => ({
  schemaVersion: "1",
  projectId: input.projectId,
  definitionType: "process-model",
  validationPolicyRef: input.validationPolicyRef,
  preparationSnapshotRef: input.preparationSnapshotRef,
  generatedAt: input.generatedAt,
  nodes: NODE_KINDS.map((kind, index) => ({
    nodeId: `node-${index + 1}`,
    processKind: kind,
    inputs: [`input-${index + 1}`],
    outputs: [`output-${index + 1}`],
    equipmentRefs: ["小盾构"],
    structuralComponentRefs: [],
    stateParameters: ["土仓/泥水压力"],
    monitoringIndicators: ["地表沉降"],
    applicability: APPLICABILITY,
    evidence: [...input.evidence],
  })),
  dependencyEdges: [
    {
      edgeId: "edge-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      relationType: "时间先后关系",
      evidence: [...input.evidence],
    },
  ],
});

export const riskMechanismPackage = (
  input: IdentificationKnowledgeBuilderInputV1 & {
    readonly processModelReleaseRef: { readonly entityId: string; readonly versionId: string };
  },
) => ({
  schemaVersion: "1",
  projectId: input.projectId,
  definitionType: "risk-mechanism",
  validationPolicyRef: input.validationPolicyRef,
  preparationSnapshotRef: input.preparationSnapshotRef,
  generatedAt: input.generatedAt,
  processModelReleaseRef: ProcessModelReleaseRefV1Schema.parse({
    kind: "process-model-release",
    reference: input.processModelReleaseRef,
  }),
  mechanisms: MECHANISM_TYPES.map((mechanismType, index) => ({
    mechanismId: `mechanism-${index + 1}`,
    mechanismType,
    nodeIds: [index % 2 === 0 ? "node-1" : "node-5"],
    stateParameters: ["土仓/泥水压力"],
    monitoringIndicators: ["地表沉降"],
    applicability: APPLICABILITY,
    preconditions: ["precondition-1"],
    triggeringFactors: ["trigger-1"],
    evolutionPath: ["path-1"],
    consequences: ["consequence-1"],
    evidence: [...input.evidence],
  })),
});

export const standardLibraryPackage = (input: IdentificationKnowledgeBuilderInputV1) => ({
  schemaVersion: "1",
  projectId: input.projectId,
  definitionType: "standard-library",
  validationPolicyRef: input.validationPolicyRef,
  preparationSnapshotRef: input.preparationSnapshotRef,
  generatedAt: input.generatedAt,
  entries: [
    {
      entryId: "standard-1",
      level: "national",
      standardIdentity: "GB-50446",
      standardVersion: "2025",
      clauseRefs: ["clause-3.2"],
      applicability: APPLICABILITY,
      evidence: [...input.evidence],
    },
  ],
});

export const caseLibraryPackage = (input: IdentificationKnowledgeBuilderInputV1) => ({
  schemaVersion: "1",
  projectId: input.projectId,
  definitionType: "case-library",
  validationPolicyRef: input.validationPolicyRef,
  preparationSnapshotRef: input.preparationSnapshotRef,
  generatedAt: input.generatedAt,
  entries: [
    {
      entryId: "case-1",
      constructionMethod: "variable-diameter-shield",
      engineeringConditions: ["condition-1"],
      process: ["process-1"],
      events: ["event-1"],
      outcomes: ["outcome-1"],
      treatments: ["treatment-1"],
      applicability: APPLICABILITY,
      evidence: [...input.evidence],
    },
  ],
});

export const retrievalEvidenceBasePackage = (
  input: IdentificationKnowledgeBuilderInputV1 & {
    readonly riskMechanismReleaseRef: KnowledgeReleaseRefV1;
    readonly standardLibraryReleaseRef: KnowledgeReleaseRefV1;
    readonly caseLibraryReleaseRef: KnowledgeReleaseRefV1;
  },
) => ({
  schemaVersion: "1",
  projectId: input.projectId,
  definitionType: "retrieval-evidence-base",
  validationPolicyRef: input.validationPolicyRef,
  preparationSnapshotRef: input.preparationSnapshotRef,
  generatedAt: input.generatedAt,
  // 组合槽位使用 contracts 的类型化引用，成员发布本身仍是 C16 generic 发布引用。
  riskMechanismReleaseRef: RiskMechanismReleaseRefV1Schema.parse({
    kind: "risk-mechanism-release",
    reference: input.riskMechanismReleaseRef.reference,
  }),
  standardLibraryReleaseRef: input.standardLibraryReleaseRef,
  caseLibraryReleaseRef: input.caseLibraryReleaseRef,
});

export interface IdentificationKnowledgeWorldContextV1 {
  readonly projectId: string;
  readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
}

export interface IdentificationPreparationWorldV1 extends IdentificationKnowledgeWorldContextV1 {
  readonly snapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly snapshot: IdentificationPreparationSnapshotV1;
  readonly cleaningResultArtifactRef: ContentArtifactRefV1;
  readonly sourceSegmentSetRef: SourceSegmentSetRefV1;
  readonly evidence: readonly EvidenceReference[];
  readonly segmentIds: readonly string[];
  readonly excludedSegmentIds: readonly string[];
  /** D-04 的资料读取授权：C11 read/resolve 必须使用 engineering-data branch 的精确上下文。 */
  readonly readAuthorization: AuthorizationContextV1;
}

export interface IdentificationKnowledgeFixtureV1 {
  readonly cleaning: DataCleaningPostgresFixture;
  readonly world: IdentificationPreparationWorldV1;
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
  readonly governance: PostgresKnowledgeGovernanceAdapter;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly preparationReader: IdentificationPreparationKnowledgeReaderV1;
  readonly reviewAudit: PostgresReviewAuditAdapter;
  /** C17 façade + 其绑定到同一 C08 adapter 的启动/读取接缝，用于编制与失败收口场景。 */
  createIdentificationKnowledgeAdapter(options?: {
    readonly withPolicySet?: boolean;
    /** 发布事务故障注入：在 C16 发布事务内、写 C17 绑定之前/之后关闭失败。 */
    readonly releasePolicyFault?: "before-binding" | "after-binding";
    /** 失败证据窄读替身：用于断言收口只按精确任务引用和新鲜授权调用 C08 公共接缝。 */
    readonly failureEvidenceReader?: AgentTaskFailureEvidenceReaderV1;
    /** 授权故障注入：命中请求时按 C06 语义在副作用前关闭失败。 */
    readonly authorizeDenial?: (input: IdentificationKnowledgeAuthorizationRequestV1) => boolean;
  }): {
    readonly adapter: PostgresIdentificationKnowledgeAdapter;
    readonly agentTaskAdapter: PostgresAgentTaskAdapter;
  };
  /** 把审核包正文写入 C04（甲方已审核配置包导入路径）。 */
  putArtifact(
    value: unknown,
    purposeCode: string,
    projectId?: string,
  ): Promise<ContentArtifactRefV1>;
  readonly authorizationFor: (
    invocationId: string,
    branch: ModuleBranchV1,
    projectId?: string,
  ) => Promise<AuthorizationContextV1>;
  builderInput(): IdentificationKnowledgeBuilderInputV1;
  /** Opens an independent project with its own frozen identification preparation. */
  createPreparationWorld(suffix: string): Promise<IdentificationPreparationWorldV1>;
  close(): Promise<void>;
}

export type KnowledgeBranchV1 = ModuleBranchV1;

interface SessionCredentialV1 {
  readonly sessionToken: string;
}

const authorizeBranch = async (
  cleaning: DataCleaningPostgresFixture,
  credential: SessionCredentialV1,
  projectId: string,
  invocationId: string,
  branch: ModuleBranchV1,
  requests: {
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  } = { spatialScopeRefs: [], sourceVersionRefs: [] },
): Promise<AuthorizationContextV1> =>
  (
    await cleaning.access.authorize({
      invocation: { kind: "human-session", sessionToken: credential.sessionToken },
      invocationId,
      projectId,
      branch,
      requestedSpatialScopeRefs: [...requests.spatialScopeRefs],
      requestedSourceVersionRefs: [...requests.sourceVersionRefs],
    })
  ).context;

/** C15 夹具把 uploader 建成工程初始风险经理；C17 复用它作为唯一受权身份。 */
const loginAsUploader = async (
  cleaning: DataCleaningPostgresFixture,
): Promise<SessionCredentialV1> => {
  const login = await cleaning.access.login({
    kind: "login",
    loginAttemptId: "c17-uploader-login",
    loginName: "c15-uploader",
    password: "c15-uploader-password-changed",
  });
  return { sessionToken: login.sessionToken };
};

const readPreparationWorld = async (
  cleaning: DataCleaningPostgresFixture,
  world: CleaningWorldV1,
  snapshotRef: IdentificationPreparationSnapshotRefV1,
): Promise<IdentificationPreparationWorldV1> => {
  // 只经 C15 公开精确窄读：strict 准备聚合、绑定任务与正式清洗结果，绝不读取准备表。
  const authorization = await world.authorizeEvidenceAccess(`c17-read-${world.projectId}`);
  const read = await cleaning.store.readExactPreparation({
    projectId: world.projectId,
    actorId: authorization.actorId,
    requestId: `c17-read-${world.projectId}`,
    requestedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
    authorization,
    preparationSnapshotRef: snapshotRef,
  });
  if (read.kind !== "ok") {
    throw new Error(
      `C17 preparation read failed for ${world.projectId}: ${JSON.stringify(read.error)}`,
    );
  }
  const snapshot = read.snapshot;
  const sourceSegmentSetRef = snapshot.includedSourceSegmentSetRefs[0];
  if (sourceSegmentSetRef === undefined) {
    throw new Error(`preparation ${world.projectId} has no included source segment set`);
  }
  const excludedSegmentIds = [
    ...new Set(read.result.inputs.flatMap((status) => status.excludedSegmentIds)),
  ];
  const excluded = new Set(excludedSegmentIds);
  const segmentIds = [
    ...new Set(read.result.inputs.flatMap((status) => status.retainedSegmentIds)),
  ];
  const evidenceSource = snapshot.sourceVersionRefs[0]!;
  const context: IdentificationKnowledgeWorldContextV1 = {
    projectId: world.projectId,
    spatialScopeRefs: [...snapshot.spatialScopeRefs],
    sourceVersionRefs: [...snapshot.sourceVersionRefs],
  };
  return {
    ...context,
    snapshotRef,
    snapshot,
    cleaningResultArtifactRef: read.resultArtifactRef,
    sourceSegmentSetRef,
    segmentIds,
    excludedSegmentIds,
    readAuthorization: authorization,
    evidence: segmentIds
      .filter((segmentId) => !excluded.has(segmentId))
      .slice(0, 4)
      .map((segmentId) => ({
        locator: { sourceSegmentId: segmentId },
        sourceVersion: evidenceSource.reference,
      })),
  };
};

const prepareWorld = async (
  cleaning: DataCleaningPostgresFixture,
  options: CleaningWorldOptionsV1,
): Promise<IdentificationPreparationWorldV1> => {
  const world = await cleaning.createWorld({ documentKinds: ["csv"], ...options });
  // 第一次冻结启动清洗任务并以 data-cleaning-task-incomplete 阻断；完成任务后用同一命令身份重放。
  const starting = await freezeIdentificationPreparation(world.pipeline.store, world, {
    commandId: `c17-freeze-${options.suffix}`,
    actor: "uploader",
  });
  if (
    starting.result.kind !== "failed" ||
    starting.result.error.blockerKind !== "data-cleaning-task-incomplete"
  ) {
    throw new Error(`C17 cleaning task was not started for ${options.suffix}`);
  }
  await completeCleaningTask(world.pipeline, cleaning, {
    workerId: `c17-cleaning-worker-${options.suffix}`,
    projectId: world.projectId,
  });
  const frozen = await freezeIdentificationPreparation(world.pipeline.store, world, {
    commandId: `c17-freeze-${options.suffix}`,
    actor: "uploader",
  });
  if (
    frozen.result.kind !== "succeeded" ||
    frozen.result.result.kind !== "identification-preparation"
  ) {
    throw new Error(
      `C17 preparation failed for ${options.suffix}: ${JSON.stringify(frozen.result)}`,
    );
  }
  return await readPreparationWorld(
    cleaning,
    world,
    frozen.result.result.identificationPreparationSnapshotRef,
  );
};

/**
 * C17 夹具：真实 C03/C04/C06/C07/C08/C15/C02 read 组合，准备世界只经 C15 公开精确窄读。
 */
export const startIdentificationKnowledgeFixture =
  async (): Promise<IdentificationKnowledgeFixtureV1> => {
    const cleaning = await startDataCleaningFixture();
    const credential = await loginAsUploader(cleaning);
    const world = await prepareWorld(cleaning, {
      suffix: "c17",
      documentKinds: ["csv"],
    });
    const policy = identificationKnowledgePolicy();
    const reviewAudit = new PostgresReviewAuditAdapter({
      db: cleaning.runtime.db,
      transactionUnit: cleaning.transactionUnit,
      access: cleaning.access,
      now: () => new Date(IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP),
    });
    const holder: {
      governance?: PostgresKnowledgeGovernanceAdapter;
      port?: AgentTaskPortV1;
      reader?: AgentTaskFailureEvidenceReaderV1;
    } = {};
    let artifactSequence = 0;
    const readingCache = new Map<string, IdentificationPreparationWorldV1>([
      [world.projectId, world],
    ]);
    /**
     * 组合根的 C06 授权来源：按请求工程自己的准备范围签发 exact branch 上下文，并复验
     * actor/project 绑定；不返回调用方自造的上下文。
     */
    const authorize: PostgresIdentificationKnowledgeAdapterOptionsV1["authorize"] = async (
      input,
    ) => {
      const known = readingCache.get(input.projectId);
      const context = await authorizeBranch(
        cleaning,
        credential,
        input.projectId,
        input.invocationId,
        input.branch,
        {
          spatialScopeRefs: input.requestedSpatialScopeRefs ?? known?.spatialScopeRefs ?? [],
          sourceVersionRefs: input.requestedSourceVersionRefs ?? known?.sourceVersionRefs ?? [],
        },
      );
      if (context.actorId !== input.actorId || context.projectId !== input.projectId) {
        throw new Error(`C06 context binding mismatch for ${input.invocationId}`);
      }
      return context;
    };
    const preparationReader = new PostgresIdentificationPreparationKnowledgeReader({
      narrowRead: {
        preparationRead: cleaning.store,
        engineeringData: cleaning.registry,
      },
      authorize,
    });
    const releasePolicy = new PostgresIdentificationKnowledgeReleasePolicy({
      db: cleaning.runtime.db,
      artifactStore: cleaning.artifactStore,
      governance: () => {
        if (holder.governance === undefined) {
          throw new Error("the C16 governance adapter is not constructed yet");
        }
        return holder.governance;
      },
      authorize,
    });
    /**
     * D-11：C16→C07 的结构化授权 provider。C16 给出精确调用身份与分支，这里只按该身份
     * 请求 C06；返回上下文必须携带该分支的唯一能力。
     */
    const reviewAuthorizationProvider: KnowledgeGovernanceReviewAuthorizationProviderV1 = {
      authorize: async (input) =>
        await authorizeBranch(
          cleaning,
          credential,
          input.projectId,
          input.invocationId,
          input.branch,
        ),
    };
    const governance = new PostgresKnowledgeGovernanceAdapter({
      db: cleaning.runtime.db,
      transactionUnit: cleaning.transactionUnit,
      access: cleaning.access,
      reviewAudit,
      identificationKnowledgePolicy: releasePolicy,
      now: () => new Date(IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP),
      reviewAuthorizationProvider,
    });
    holder.governance = governance;
    return {
      cleaning,
      world,
      policy,
      governance,
      transactionUnit: cleaning.transactionUnit,
      access: cleaning.access,
      preparationReader,
      reviewAudit,
      createIdentificationKnowledgeAdapter: (options) => {
        const fault = options?.releasePolicyFault;
        const adapterGovernance =
          fault === undefined
            ? governance
            : new PostgresKnowledgeGovernanceAdapter({
                db: cleaning.runtime.db,
                transactionUnit: cleaning.transactionUnit,
                access: cleaning.access,
                reviewAudit,
                identificationKnowledgePolicy: {
                  appendRelease: async (context, appendInput) => {
                    if (fault === "before-binding") {
                      throw new KnowledgeLifecycleError({
                        code: "BUSINESS_BLOCKED",
                        reasonCode: "c17-injected-binding-fault",
                        targetRef: appendInput.releaseRef,
                      });
                    }
                    const events = await releasePolicy.appendRelease(context, appendInput);
                    if (fault === "after-binding") {
                      throw new KnowledgeLifecycleError({
                        code: "BUSINESS_BLOCKED",
                        reasonCode: "c17-injected-event-fault",
                        targetRef: appendInput.releaseRef,
                      });
                    }
                    return events;
                  },
                },
                now: () => new Date(IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP),
                reviewAuthorizationProvider,
              });
        const adapterOptions: PostgresIdentificationKnowledgeAdapterOptionsV1 = {
          db: cleaning.runtime.db,
          transactionUnit: cleaning.transactionUnit,
          access: cleaning.access,
          artifactStore: cleaning.artifactStore,
          artifactReferenceGuard: cleaning.artifactRegistry,
          governance: adapterGovernance,
          narrowRead: {
            preparationRead: cleaning.store,
            engineeringData: cleaning.registry,
          },
          policy,
          ...(options?.withPolicySet === false
            ? {}
            : {
                policySetProvider: {
                  resolveExact: async (input: { projectId: string }) => ({
                    kind: "identification-policy-set" as const,
                    reference: { entityId: `policy-set-${input.projectId}`, versionId: "1" },
                  }),
                },
              }),
          agentTaskPort: {
            startTask: async (command) => await holder.port!.startTask(command),
          } as AgentTaskPortV1,
          agentTaskFailureEvidenceReader: options?.failureEvidenceReader ?? {
            readTerminalFailure: async (request) => {
              if (holder.reader === undefined) {
                throw new Error("the C08 task adapter is not constructed yet");
              }
              return await holder.reader.readTerminalFailure(request);
            },
          },
          authorize: async (input) => {
            if (options?.authorizeDenial?.(input) === true) {
              throw new Error(`C06 denied the ${input.branch} invocation`);
            }
            return await authorize(input);
          },
          // 收口动作的时钟晚于夹具准备与测试发布时刻，保证发布集合对收口命令已生效。
          now: () => new Date("2030-01-02T00:00:00.000Z"),
        };
        const adapter = new PostgresIdentificationKnowledgeAdapter(adapterOptions);
        const agentTaskAdapter = new PostgresAgentTaskAdapter({
          db: cleaning.runtime.db,
          registry: new AgentTaskDefinitionRegistry([adapter.createTaskDefinition()]),
          transactionUnit: cleaning.transactionUnit,
          referenceGuard: cleaning.artifactRegistry,
          artifactStore: cleaning.artifactStore,
          authorization: cleaning.access,
          now: () => IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        });
        holder.port = agentTaskAdapter as unknown as AgentTaskPortV1;
        holder.reader = agentTaskAdapter;
        return { adapter, agentTaskAdapter };
      },
      putArtifact: async (value, purposeCode, projectId) => {
        artifactSequence += 1;
        const targetProject = projectId ?? world.projectId;
        const targetContext = readingCache.get(targetProject) ?? world;
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const authorization = await authorizeBranch(
          cleaning,
          credential,
          targetProject,
          `c17-put-${purposeCode}-${artifactSequence}`,
          PREPARATION_READ_BRANCH,
          {
            spatialScopeRefs: targetContext.spatialScopeRefs,
            sourceVersionRefs: targetContext.sourceVersionRefs,
          },
        );
        const result = await cleaning.artifactStore.put(
          ArtifactPutCommandV1Schema.parse({
            schemaVersion: "1",
            commandId: `c17-put-${purposeCode}-${artifactSequence}:put`,
            idempotencyKey: `c17-put-${purposeCode}-${artifactSequence}:put`,
            projectId: targetProject,
            actorId: authorization.actorId,
            issuedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
            authorization,
            requiredCapability: authorization.grantedCapabilities[0],
            artifactId: `c17-package-${purposeCode}-${artifactSequence}`,
            artifactKind: "content",
            purposeCode,
            mediaType: "application/json",
            parentArtifactRefs: [],
            evidenceReferences: [],
            additionalSpatialScopeRefs: [],
            additionalSourceAccessGrantRefs: [],
          }),
          (async function* () {
            yield bytes;
          })(),
        );
        return ContentArtifactRefV1Schema.parse(result.artifactRef);
      },
      // 调用方按精确准备的范围与资料版本授权，使下游 C04/C11 读取继承同一组授权引用。
      authorizationFor: async (invocationId, branch, projectId) => {
        const target = projectId ?? world.projectId;
        const known = target === world.projectId ? world : readingCache.get(target);
        const context = await authorizeBranch(
          cleaning,
          credential,
          target,
          invocationId,
          branch,
          known === undefined
            ? undefined
            : {
                spatialScopeRefs: known.spatialScopeRefs,
                sourceVersionRefs: known.sourceVersionRefs,
              },
        );
        if (known !== undefined) readingCache.set(target, known);
        return context;
      },
      builderInput: () => ({
        projectId: world.projectId,
        preparationSnapshotRef: world.snapshotRef,
        validationPolicyRef: policy.policyRef,
        generatedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        evidence: world.evidence,
      }),
      async createPreparationWorld(suffix) {
        const extra = await prepareWorld(cleaning, {
          suffix,
          documentKinds: ["csv"],
        });
        readingCache.set(extra.projectId, extra);
        return extra;
      },
      async close() {
        await cleaning.close();
      },
    };
  };
