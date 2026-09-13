import {
  ContentArtifactRefV1Schema,
  type ModuleBranchV1,
  IdentificationPreparationSnapshotRefV1Schema,
  ProcessModelReleaseRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type EvidenceReference,
  type IdentificationPreparationSnapshotRefV1,
  type KnowledgeReleaseRefV1,
  type SourceSegmentSetRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationKnowledgeValidationPolicyV1Schema,
  type IdentificationEvidenceDecisionV1,
  type IdentificationKnowledgeValidationPolicyV1,
  type IdentificationPreparationKnowledgeReaderV1,
} from "@riskflow/core/identification-knowledge";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";

import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import type { AgentTaskPortV1, AgentTaskRefV1 } from "@riskflow/contracts/ports";

import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import {
  PostgresIdentificationKnowledgeAdapter,
  type PostgresIdentificationKnowledgeAdapterOptionsV1,
} from "../../src/identification-knowledge/index.js";
import { PostgresKnowledgeGovernanceAdapter } from "../../src/knowledge-governance/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import {
  completeCleaningTask,
  freezeIdentificationPreparation,
  startDataCleaningFixture,
  type CleaningWorldOptionsV1,
  type DataCleaningPostgresFixture,
} from "../engineering-data/cleaning/fixture.js";

export const IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";
const EXCLUSION_PURPOSE = "engineering-data.data-cleaning-decision";
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
  riskMechanismReleaseRef: input.riskMechanismReleaseRef,
  standardLibraryReleaseRef: input.standardLibraryReleaseRef,
  caseLibraryReleaseRef: input.caseLibraryReleaseRef,
});

/**
 * C15 写入 `snapshot_payload` 时把覆盖/排除决定保存为 `content-artifact` 引用，
 * 而 contracts 的 `IdentificationPreparationSnapshotV1Schema` 要求 `route-decision`。
 * 夹具只消费 C17 需要的三个字段，不掩盖该上游差异（见实施报告）。
 */
const preparationPayloadView = (payload: unknown): IdentificationPreparationPayloadViewV1 => {
  const record = (payload ?? {}) as {
    readonly sourceVersionRefs?: unknown;
    readonly includedSourceSegmentSetRefs?: unknown;
    readonly excludedSegmentDecisionRefs?: unknown;
  };
  return {
    sourceVersionRefs: SourceVersionRefV1Schema.array().min(1).parse(record.sourceVersionRefs),
    includedSourceSegmentSetRefs: SourceSegmentSetRefV1Schema.array()
      .min(1)
      .parse(record.includedSourceSegmentSetRefs),
    excludedSegmentDecisionRefs: Array.isArray(record.excludedSegmentDecisionRefs)
      ? record.excludedSegmentDecisionRefs
      : [],
  };
};

export interface IdentificationPreparationPayloadViewV1 {
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  readonly includedSourceSegmentSetRefs: readonly SourceSegmentSetRefV1[];
  readonly excludedSegmentDecisionRefs: readonly unknown[];
}

export interface IdentificationKnowledgeWorldContextV1 {
  readonly projectId: string;
  readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
}

export interface IdentificationPreparationWorldV1 extends IdentificationKnowledgeWorldContextV1 {
  readonly snapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly snapshot: IdentificationPreparationPayloadViewV1;
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
  createIdentificationKnowledgeAdapter(options?: { readonly withPolicySet?: boolean }): {
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
  credential: SessionCredentialV1,
  projectId: string,
): Promise<IdentificationPreparationWorldV1> => {
  const rows = await cleaning.postgres.adminPool.query<{
    snapshot_ref: unknown;
    snapshot_payload: unknown;
    cleaning_result_artifact_ref: unknown;
  }>(
    `SELECT snapshot_ref, snapshot_payload, cleaning_result_artifact_ref
       FROM business.identification_preparation_snapshots
      WHERE project_id = $1`,
    [projectId],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error(`no preparation snapshot for ${projectId}`);
  const snapshotRef = IdentificationPreparationSnapshotRefV1Schema.parse(row.snapshot_ref);
  const snapshot = preparationPayloadView(row.snapshot_payload);
  const cleaningResultArtifactRef = ContentArtifactRefV1Schema.parse(
    row.cleaning_result_artifact_ref,
  );
  const sourceSegmentSetRef = snapshot.includedSourceSegmentSetRefs[0];
  if (sourceSegmentSetRef === undefined) {
    throw new Error(`preparation ${projectId} has no included source segment set`);
  }
  const scopes = await cleaning.postgres.adminPool.query<{
    scope_id: string;
    revision_id: string;
  }>(
    `SELECT scope_id, current_revision_id AS revision_id
       FROM business.access_spatial_scopes WHERE project_id = $1`,
    [projectId],
  );
  const context: IdentificationKnowledgeWorldContextV1 = {
    projectId,
    spatialScopeRefs: scopes.rows.map((scope) => ({
      kind: "spatial-scope" as const,
      reference: { entityId: scope.scope_id, versionId: scope.revision_id },
    })),
    sourceVersionRefs: snapshot.sourceVersionRefs,
  };
  const authorization = await authorizeBranch(
    cleaning,
    credential,
    projectId,
    `c17-read-${projectId}`,
    PREPARATION_READ_BRANCH,
    context,
  );
  const segments = await cleaning.postgres.adminPool.query<{ source_segment_id: string }>(
    `SELECT source_segment_id FROM business.source_segments
      WHERE project_id = $1 AND source_segment_set_id = $2 ORDER BY source_segment_id`,
    [projectId, sourceSegmentSetRef.reference.entityId],
  );
  const exclusions = await readExcludedSegmentIds(
    cleaning,
    authorization,
    snapshot.excludedSegmentDecisionRefs,
  );
  const segmentIds = segments.rows.map((segment) => segment.source_segment_id);
  const evidenceSource = snapshot.sourceVersionRefs[0]!;
  return {
    ...context,
    projectId,
    snapshotRef,
    snapshot,
    cleaningResultArtifactRef,
    sourceSegmentSetRef,
    segmentIds,
    excludedSegmentIds: [...exclusions],
    readAuthorization: authorization,
    evidence: segmentIds
      .filter((segmentId) => !exclusions.has(segmentId))
      .slice(0, 4)
      .map((segmentId) => ({
        locator: { sourceSegmentId: segmentId },
        sourceVersion: evidenceSource.reference,
      })),
  };
};

const readExcludedSegmentIds = async (
  cleaning: DataCleaningPostgresFixture,
  authorization: AuthorizationContextV1,
  decisionRefs: readonly unknown[],
): Promise<ReadonlySet<string>> => {
  const excluded = new Set<string>();
  for (const decisionRef of decisionRefs) {
    const ref = ContentArtifactRefV1Schema.safeParse(decisionRef);
    if (!ref.success) continue;
    const payload = (await cleaning.readArtifact(ref.data, authorization, EXCLUSION_PURPOSE)) as
      { decisions?: readonly { sourceSegmentId?: string }[] } | undefined;
    for (const decision of payload?.decisions ?? []) {
      if (typeof decision.sourceSegmentId === "string") excluded.add(decision.sourceSegmentId);
    }
  }
  return excluded;
};

const prepareWorld = async (
  cleaning: DataCleaningPostgresFixture,
  credential: SessionCredentialV1,
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
  return await readPreparationWorld(cleaning, credential, world.projectId);
};

/**
 * C17 夹具：真实 C03/C04/C06/C07/C08/C15/C02 read 组合。`readExactPreparation` 目前由本夹具
 * 以快照行 + C04 复读绑定，等待 C15 提供正式公开窄读（见实施报告的建议签名）后替换。
 */
export const startIdentificationKnowledgeFixture =
  async (): Promise<IdentificationKnowledgeFixtureV1> => {
    const cleaning = await startDataCleaningFixture();
    const credential = await loginAsUploader(cleaning);
    const world = await prepareWorld(cleaning, credential, {
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
    const governance = new PostgresKnowledgeGovernanceAdapter({
      db: cleaning.runtime.db,
      transactionUnit: cleaning.transactionUnit,
      access: cleaning.access,
      reviewAudit,
      now: () => new Date(IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP),
      // C16/C07 的 verify 绑定在各自调用身份上：评审请求用评审尝试 id，批准证明用命令派生 queryId。
      reviewAuthorization: (command, link) =>
        authorizeBranch(
          cleaning,
          credential,
          command.projectId,
          `${link.reviewAttemptId}:review`,
          "review-audit.request-review",
        ),
      approvalAuthorization: (command) =>
        authorizeBranch(
          cleaning,
          credential,
          command.projectId,
          `${command.commandId}:approval`,
          "review-audit.verify-knowledge-revision-approval",
        ),
    });
    let artifactSequence = 0;
    const readingCache = new Map<string, IdentificationPreparationWorldV1>([
      [world.projectId, world],
    ]);
    const parseScopeRefs = (value: unknown): readonly SpatialScopeRefV1[] =>
      Array.isArray(value)
        ? value.flatMap((entry) => {
            const parsed = SpatialScopeRefV1Schema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
    const dedupeScopes = (refs: readonly SpatialScopeRefV1[]): readonly SpatialScopeRefV1[] => {
      const seen = new Map<string, SpatialScopeRefV1>();
      for (const ref of refs) {
        seen.set(`${ref.reference.entityId}:${ref.reference.versionId}`, ref);
      }
      return [...seen.values()];
    };
    const engineeringContexts = new Map<string, AuthorizationContextV1>();
    // C11 每次读取使用新的查询身份：C03 回执按命令身份唯一，不能跨工程/跨调用复用。
    let readSequence = 0;
    const engineeringContextFor = async (
      projectId: string,
      invocationId: string,
      branch: ModuleBranchV1 = PREPARATION_READ_BRANCH,
      requestedScopes?: readonly SpatialScopeRefV1[],
    ): Promise<AuthorizationContextV1> => {
      const cacheKey = `${projectId}:${branch}:${invocationId}:${requestedScopes?.length ?? 0}`;
      const cached = engineeringContexts.get(cacheKey);
      if (cached !== undefined) return cached;
      // 每个工程的授权必须携带该工程自己的空间范围与资料版本，不能沿用主工程的引用。
      const world = readingCache.get(projectId);
      const context = await authorizeBranch(cleaning, credential, projectId, invocationId, branch, {
        spatialScopeRefs: requestedScopes ?? world?.spatialScopeRefs ?? [],
        sourceVersionRefs: world?.sourceVersionRefs ?? [],
      });
      engineeringContexts.set(cacheKey, context);
      return context;
    };
    const preparationReader: IdentificationPreparationKnowledgeReaderV1 = {
      readExactPreparation: async (input) => {
        const candidate =
          readingCache.get(input.projectId) ??
          (await readPreparationWorld(cleaning, credential, input.projectId));
        readingCache.set(input.projectId, candidate);
        if (
          candidate.snapshotRef.reference.entityId !==
            input.preparationSnapshotRef.reference.entityId ||
          candidate.snapshotRef.reference.versionId !==
            input.preparationSnapshotRef.reference.versionId
        ) {
          return {
            kind: "failed",
            error: {
              code: "AUTHORIZATION_DENIED",
              category: "authorization",
              retryable: false,
              causalRunId: `c17-preparation-${input.projectId}`,
            },
          };
        }
        return {
          kind: "succeeded",
          view: {
            sourceVersionRefs: candidate.snapshot.sourceVersionRefs,
            includedSourceSegmentSetRefs: candidate.snapshot.includedSourceSegmentSetRefs,
            cleaningResultArtifactRef: candidate.cleaningResultArtifactRef,
            excludedSegmentDecisionRefs: candidate.snapshot.excludedSegmentDecisionRefs,
          },
        };
      },
      readSegmentSlice: async (input) => {
        // C11 `source-segments` 以「来源版本 + 集合内全部资料段」的空间范围复验授权，
        // 因此这里按同一范围签发 engineering-data 分支上下文。
        const scopeRows = await cleaning.postgres.adminPool.query<{ spatial_scope_refs: unknown }>(
          `SELECT spatial_scope_refs FROM business.source_segments
            WHERE project_id = $1 AND source_segment_set_id = $2`,
          [input.projectId, input.sourceSegmentSetRef.reference.entityId],
        );
        const versionRows = await cleaning.postgres.adminPool.query<{
          spatial_scope_refs: unknown;
        }>(`SELECT spatial_scope_refs FROM business.source_versions WHERE project_id = $1`, [
          input.projectId,
        ]);
        const requestedScopes = dedupeScopes([
          ...scopeRows.rows.flatMap((row) => parseScopeRefs(row.spatial_scope_refs)),
          ...versionRows.rows.flatMap((row) => parseScopeRefs(row.spatial_scope_refs)),
        ]);
        readSequence += 1;
        const sliceQueryId = `c17-slice-${readSequence}`;
        const readContext = await engineeringContextFor(
          input.projectId,
          sliceQueryId,
          "engineering-data.source-segments",
          requestedScopes,
        );
        const read = await cleaning.registry.read({
          kind: "source-segments",
          queryId: sliceQueryId,
          projectId: input.projectId,
          actorId: readContext.actorId,
          requestedAt: input.requestedAt,
          authorization: readContext,
          payload: { sourceSegmentSetRef: input.sourceSegmentSetRef },
        });
        if (read.kind !== "succeeded") {
          return { kind: "failed", error: read.error };
        }
        // resolve 使用自己的调用身份（C06 verify 按 invocationId 绑定）。
        const resolveInvocationId = `c17-slice-resolve-${readSequence}`;
        const resolveContext = await engineeringContextFor(
          input.projectId,
          resolveInvocationId,
          "engineering-data.source-segments",
          requestedScopes,
        );
        const resolved = await cleaning.registry.resolveReadQuery({
          queryResultRef: read.result.queryResultRef,
          invocationId: resolveInvocationId,
          projectId: input.projectId,
          actorId: resolveContext.actorId,
          requestedAt: input.requestedAt,
          authorization: resolveContext,
        });
        if (resolved.kind !== "succeeded" || resolved.result.kind !== "source-segments") {
          return {
            kind: "failed",
            error:
              resolved.kind === "failed"
                ? resolved.error
                : {
                    code: "TERMINAL_FAILURE",
                    category: "terminal-failure",
                    retryable: false,
                    causalRunId: `c17-slice-${input.projectId}`,
                  },
          };
        }
        const requested = new Set(input.segmentIds);
        const excluded = readingCache.get(input.projectId)?.excludedSegmentIds ?? [];
        return {
          kind: "succeeded",
          observation: {
            queryResultRef: resolved.result.queryResultRef,
            sourceSegmentSetRef: resolved.result.segmentSet.sourceSegmentSetRef,
            segments: resolved.result.segmentSet.segments
              .filter((segment) => requested.has(segment.sourceSegmentId))
              .slice(0, input.limit)
              .map((segment) => ({
                sourceSegmentId: segment.sourceSegmentId,
                kind: segment.kind,
                locator: segment.locator,
                excluded: excluded.includes(segment.sourceSegmentId),
              })),
          },
        };
      },
      checkEvidence: async (input) => {
        const excluded = new Set(readingCache.get(input.projectId)?.excludedSegmentIds ?? []);
        readSequence += 1;
        const readInvocationId = `c17-evidence-${input.purposeCode}-${readSequence}`;
        const readContext = await engineeringContextFor(
          input.projectId,
          readInvocationId,
          "engineering-data.evidence-access",
        );
        const read = await cleaning.registry.read({
          kind: "evidence-access",
          queryId: readInvocationId,
          projectId: input.projectId,
          actorId: readContext.actorId,
          requestedAt: input.requestedAt,
          authorization: readContext,
          payload: {
            evidenceReferences: [...input.evidenceReferences],
            purposeCode: input.purposeCode,
          },
        });
        const readable = new Set<string>();
        if (read.kind === "succeeded") {
          const resolveInvocationId = `c17-evidence-resolve-${input.purposeCode}-${readSequence}`;
          const resolveContext = await engineeringContextFor(
            input.projectId,
            resolveInvocationId,
            "engineering-data.evidence-access",
          );
          const resolved = await cleaning.registry.resolveReadQuery({
            queryResultRef: read.result.queryResultRef,
            invocationId: resolveInvocationId,
            projectId: input.projectId,
            actorId: resolveContext.actorId,
            requestedAt: input.requestedAt,
            authorization: resolveContext,
          });
          if (resolved.kind === "succeeded" && resolved.result.kind === "evidence-access") {
            for (const item of resolved.result.items) {
              readable.add(item.segment.sourceSegmentId);
            }
          }
        }
        const items: IdentificationEvidenceDecisionV1[] = input.evidenceReferences.map(
          (reference) => {
            const segmentId = reference.locator.sourceSegmentId;
            if (excluded.has(segmentId)) {
              return {
                evidenceReference: reference,
                disposition: "rejected",
                reasonCode: "segment-excluded-by-cleaning",
              };
            }
            return readable.has(segmentId)
              ? { evidenceReference: reference, disposition: "eligible", reasonCode: "eligible" }
              : {
                  evidenceReference: reference,
                  disposition: "rejected",
                  reasonCode: "segment-not-readable",
                };
          },
        );
        return { kind: "succeeded", items };
      },
    };
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
        const holder: {
          port?: AgentTaskPortV1;
          store?: {
            getTask(ref: AgentTaskRefV1): Promise<unknown>;
            cancelTask(input: { taskRef: AgentTaskRefV1; reasonCode: string }): Promise<unknown>;
          };
        } = {};
        const adapterOptions: PostgresIdentificationKnowledgeAdapterOptionsV1 = {
          db: cleaning.runtime.db,
          transactionUnit: cleaning.transactionUnit,
          access: cleaning.access,
          artifactStore: cleaning.artifactStore,
          artifactReferenceGuard: cleaning.artifactRegistry,
          governance,
          preparationReader,
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
          agentTaskStore: {
            createTask: async () => {
              throw new Error("not used by C17");
            },
            getTask: async (ref) => (await holder.store!.getTask(ref)) as never,
            resumeTask: async () => {
              throw new Error("not used by C17");
            },
            cancelTask: async () => {
              throw new Error("not used by C17");
            },
            confirmCommand: async () => {
              throw new Error("not used by C17");
            },
          },
          authoringAuthorization: async (input) => {
            // 收口授权同样必须使用目标工程自己的空间范围与资料版本。
            const known = readingCache.get(input.projectId) ?? world;
            return await authorizeBranch(
              cleaning,
              credential,
              input.projectId,
              input.invocationId,
              input.branch,
              {
                spatialScopeRefs: known.spatialScopeRefs,
                sourceVersionRefs: known.sourceVersionRefs,
              },
            );
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
        holder.store = agentTaskAdapter as unknown as typeof holder.store;
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
        return await authorizeBranch(
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
      },
      builderInput: () => ({
        projectId: world.projectId,
        preparationSnapshotRef: world.snapshotRef,
        validationPolicyRef: policy.policyRef,
        generatedAt: IDENTIFICATION_KNOWLEDGE_TEST_TIMESTAMP,
        evidence: world.evidence,
      }),
      async createPreparationWorld(suffix) {
        const extra = await prepareWorld(cleaning, credential, {
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
