/**
 * IP-04 生产评估依据装配夹具（design D-12）：在 C25 已经跑起来的同一个真实数据库上，
 * 把「C15 真实清洗收口 → C19 规则编制 → C16/C07 人工审核发布 → C18 配置发布 →
 * C19 适用规则集组装与审核发布 → C19 公共依据解析」串成一条真实链路，
 * 并把真实 C11 生产准备读取接缝交给 C19。
 *
 * 与 `scoring-rules/fixture.ts` 的关键差别：这里没有 `vi.fn()` 授权替身。所有 C06 复验
 * 走 C25 自己的真实会话与 C02 分支矩阵，能力面由角色裁决，不由测试登记。C19 的
 * `preparationSnapshot` 直接指向 C11 已实现的 `readAssessmentPreparationSnapshot`，
 * 因此「准备投影由所属域提供」是生产行为，不是注入的假投影。
 *
 * 合成样本标注：本文档链路上出现的规范条文摘录、指标体系与量化标准均为
 * **合成样本、待甲方复核**；控制值与阈值不是甲方审核结论。
 */
import { strToU8 } from "fflate";

import {
  KnowledgeGovernanceCommandV1Schema,
  StartAgentTaskCommandV1Schema,
  type AgentTaskRefV1,
  type AssessmentBasisReleaseSetRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ModuleBranchV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { AssessmentConfigurationGovernancePolicyV1 } from "@riskflow/core/assessment-config";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import {
  createScoringRuleAuthoringTaskDefinition,
  type ScoringRulesPolicyV1,
} from "@riskflow/core/scoring-rules";
import {
  createRiskInputFactsReader,
  type RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import { createPostgresExternalRiskInputFactsReader } from "../../src/engineering-data/context-source/postgres-external-risk-input-facts-reader.js";
import { createPostgresStandardizedRiskInputFactsReader } from "../../src/identification/read/postgres-standardized-risk-input-facts-reader.js";
import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import { PostgresAssessmentConfigurationAdapter } from "../../src/assessment-config/index.js";
import {
  governedReleaseResolutionInvocationId,
  PostgresKnowledgeGovernanceAdapter,
} from "../../src/knowledge-governance/index.js";
import type { KnowledgeGovernanceReviewAuthorizationProviderV1 } from "../../src/knowledge-governance/index.js";
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
import { PostgresScoringRulesAdapter } from "../../src/scoring-rules/index.js";
import { makeAssessmentConfigurationFixtureSet } from "../../../core/test/assessment-config/fixture.js";
import { realStandardCleaningDocument } from "../scoring-rules/fixture.js";
import {
  completeCleaningTask,
  freezeIdentificationPreparation,
  startDataCleaningFixture,
  type CleaningPipelineV1,
  type CleaningWorldV1,
  type DataCleaningPostgresFixture,
} from "../engineering-data/cleaning/fixture.js";

/** C19 知识链路的固定业务时刻：签发在先、审核在后、发布生效不晚于编制与解析。 */
export const PRODUCTION_BASIS_ISSUED_AT = "2030-01-01T00:00:01.000Z";
export const PRODUCTION_BASIS_PUBLISH_AT = "2030-01-01T00:00:02.000Z";
export const PRODUCTION_BASIS_AUTHORING_AT = "2030-01-01T00:00:03.000Z";
/** C06 上下文按真实时钟签发；准备读取的业务时刻必须落在上下文有效期之内。 */
export const PRODUCTION_BASIS_REQUESTED_AT = new Date().toISOString();

/** 合成适用性三元组：与 C19 规则编制的三维域一致（合成样本、待甲方复核）。 */
export const PRODUCTION_BASIS_APPLICABILITY = {
  constructionMethod: "variable-diameter-shield",
  stratumCondition: "soft-soil",
  engineeringStage: "expansion-preparation",
} as const;

export const PRODUCTION_BASIS_POLICY: ScoringRulesPolicyV1 = {
  schemaVersion: "1",
  policyRef: { entityId: "production-basis-policy", versionId: "1" },
  compatibilityRef: { entityId: "production-basis-compatibility", versionId: "1" },
  assemblyPolicyRef: { entityId: "production-basis-assembly-policy", versionId: "1" },
  conflictPriorityPolicyRef: { entityId: "production-basis-conflict-priority", versionId: "1" },
  allowedSourceStandardKinds: ["国家规范"],
  tools: {
    standardSegmentToolRef: { entityId: "production-basis-standard-tool", versionId: "1" },
    indicatorCatalogToolRef: { entityId: "production-basis-indicator-tool", versionId: "1" },
    maxSegmentsPerRead: 8,
    maxIndicatorsPerRead: 16,
  },
  agent: {
    definitionRef: { entityId: "production-basis-authoring-definition", versionId: "1" },
    modelDeploymentRef: { entityId: "production-basis-model", versionId: "1" },
    promptTemplateRef: { entityId: "production-basis-prompt", versionId: "1" },
    toolPolicyRef: { entityId: "production-basis-tool-policy", versionId: "1" },
    budgetPolicyRef: { entityId: "production-basis-budget-policy", versionId: "1" },
    incrementSchemaRef: { entityId: "production-basis-increment-schema", versionId: "1" },
    validationPolicyRef: { entityId: "production-basis-validation-policy", versionId: "1" },
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: { entityId: "production-basis-budget-policy", versionId: "1" },
      modelDeploymentRef: { entityId: "production-basis-model", versionId: "1" },
      promptTemplateRef: { entityId: "production-basis-prompt", versionId: "1" },
      toolPolicyRef: { entityId: "production-basis-tool-policy", versionId: "1" },
      maxModelInvocations: 8,
      maxToolInvocations: 16,
      maxContextTokens: 32_768,
      maxInputBytes: 262_144,
      maxOutputBytes: 262_144,
      maxCandidates: 4,
      maxObjects: 128,
      maxSupplementarySearches: 0,
      maxCorrections: 2,
      maxTransientRetries: 1,
      maxConcurrentActions: 1,
      maxWallClockMs: 600_000,
    },
  },
};

export interface ProductionBasisWorldV1 {
  readonly cleaning: DataCleaningPostgresFixture;
  readonly world: CleaningWorldV1;
  /** C15 已收口的清洗任务：规则编制的唯一合格来源。 */
  readonly dataCleaningTaskRef: AgentTaskRefV1;
  /** 该 world 内真实登记的结构化外部风险事件：C11 冻结评估准备时的风险输入。 */
  readonly riskInput: {
    readonly kind: "external-risk-event";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  /** 该 world 自己的 C08 适配器：清洗任务在其上完成，读回必须走同一实例。 */
  readonly cleaningTaskAdapter: CleaningPipelineV1["agentTaskAdapter"];
  readonly configurationSetRef: VersionReference;
  /** 已发布 C18 指标体系中的指标标识：规则编制的 `indicatorItem` 取自这里。 */
  readonly indicatorIds: readonly string[];
  readonly actorId: string;
  /** 真实 C06 会话授权：分支由 C02 矩阵裁决，调用方不得自报能力。 */
  authorize(branch: ModuleBranchV1, invocationId: string): Promise<AuthorizationContextV1>;
  /**
   * C15 已收口结果的读取上下文（`engineering-data.evidence-access`）。C19 编制入口用
   * 自己的 `requestId` 作为 C15 结果读取的 C06 `invocationId`，因此签发时必须传入
   * **同一个**标识：上下文、调用标识与分支三者绑定，错位会在 C06 复验处被拒。
   */
  authorizeDataCleaningRead(invocationId: string): Promise<AuthorizationContextV1>;
  /** C04 正文写入：走同一真实 C06 会话，不用测试登记的授权上下文。 */
  putJson(input: {
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly value: unknown;
  }): Promise<ContentArtifactRefV1>;
  close(): Promise<void>;
}

export interface ProductionBasisFixtureV1 {
  readonly cleaning: DataCleaningPostgresFixture;
  readonly reviewAudit: PostgresReviewAuditAdapter;
  readonly governance: PostgresKnowledgeGovernanceAdapter;
  readonly configuration: PostgresAssessmentConfigurationAdapter;
  readonly scoringRules: PostgresScoringRulesAdapter;
  readonly agentTasks: PostgresAgentTaskAdapter;
  readonly policy: ScoringRulesPolicyV1;
  /** 真实 C11 生产准备读取接缝（由 C19 直接消费）。 */
  readonly readAssessmentPreparationSnapshot: DataCleaningPostgresFixture["registry"]["readAssessmentPreparationSnapshot"];
  /** 在既有 C15 world 上完成冻结与清洗收口，并发布 C18 配置集合。 */
  prepareWorld(suffix: string): Promise<ProductionBasisWorldV1>;
  /** 对既有 C16 修订执行请求审阅 → 人工批准 → 发布（全部真实 C07/C16 + 真实 C06）。 */
  approveAndPublish(input: {
    readonly world: ProductionBasisWorldV1;
    readonly revisionRef: KnowledgeRevisionRefV1;
  }): Promise<KnowledgeReleaseRefV1>;
  /**
   * D-12 完整顺序：已发布配置与规则 → C11 冻结准备 → C19 组装 → C16/C07 审核发布
   * 适用规则集 → C19 解析出公共依据。返回 `resolve` 的实际输出，不预造引用。
   */
  publishAssessmentBasis(input: {
    readonly world: ProductionBasisWorldV1;
    readonly ruleOperations: readonly unknown[];
  }): Promise<{
    readonly ruleRevisionRef: KnowledgeRevisionRefV1;
    readonly preparationSnapshotRef: {
      readonly kind: "assessment-preparation-snapshot";
      readonly reference: VersionReference;
    };
    readonly applicableRuleSetReleaseRef: KnowledgeReleaseRefV1;
    readonly assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
  }>;
  close(): Promise<void>;
}

/**
 * 在 C25 的同一个数据库上装配真实 C07/C16/C18/C19。组合根只做接缝接线：
 * 每个适配器都收到 C25 已有的 db/事务/C06/工件库，不新建容器、不复制 Schema，
 * 也不注册任何模拟 C06 复验的实现。
 */
export const startProductionAssessmentBasisFixture =
  async (): Promise<ProductionBasisFixtureV1> => {
    // C11 registry 在构造时固定这两个接缝，而 world 要到 `prepareWorld` 才存在。故传入
    // 稳定的转发实现：它们在调用时才解析当前 world，registry 本身不感知装配顺序。
    const riskInputFactsRef: { current?: RiskInputFactsReaderV1 } = {};
    // 下游授权签发同样要等 world 就绪，故按调用时才解析的当前 world 转发。
    const downstreamWorldRef: { current?: CleaningWorldV1 } = {};
    const cleaning = await startDataCleaningFixture({
      registryOptions: {
        riskInputFacts: {
          readRiskInputFacts: (request) => {
            const reader = riskInputFactsRef.current;
            if (reader === undefined) {
              throw new Error("C11 read risk input facts before a world is prepared");
            }
            return reader.readRiskInputFacts(request);
          },
        } as never,
        authorizeDownstream: (request) => {
          const world = downstreamWorldRef.current;
          if (world === undefined) {
            throw new Error("C11 authorized downstream before a world is prepared");
          }
          return world.authorizeBranch(request.invocationId, request.branch);
        },
      },
    });
    const db = cleaning.runtime.db;
    const transactionUnit: TransactionUnitV1 = cleaning.transactionUnit;
    const artifactStore: ArtifactStoreV1 = cleaning.artifactStore;
    /** 真实 C06：所有 verify 走 C25 自己的会话与 C02 矩阵，没有测试登记的上下文。 */
    const access = cleaning.access;
    // C07/C16/C18 与两个 owning reader 用 `Date` 时钟；C08 任务适配器用 ISO 字符串时钟。
    // 两者都取同一真实时刻，C06 上下文有效期与 C04 访问记录因此保持一致。
    const now = () => new Date();
    const nowIso = () => now().toISOString();

    const reviewAudit = new PostgresReviewAuditAdapter({ db, transactionUnit, access, now });
    const scoringRulesRef: { current?: PostgresScoringRulesAdapter } = {};
    const agentTasksRef: { current?: PostgresAgentTaskAdapter } = {};
    const governanceRef: { current?: PostgresKnowledgeGovernanceAdapter } = {};

    /** 当前工程：用于把 C06 授权绑定到对应 world 的会话与资料范围。 */
    const activeWorlds = new Map<string, CleaningWorldV1>();

    /**
     * 真实 C06 授权：会话、分支能力与资料范围都由 C25 world 自己签发。分支能否签发由
     * C02 角色矩阵裁决，夹具不登记上下文、不放宽能力面；actor 必须属于该工程成员。
     */
    const authorizeByWorld = async (
      projectId: string,
      branch: ModuleBranchV1,
      invocationId: string,
      actorId?: string,
    ): Promise<AuthorizationContextV1> => {
      const world = activeWorlds.get(projectId);
      if (world === undefined) {
        throw new Error(`no C15 world is active for ${projectId}; call prepareWorld first`);
      }
      if (actorId !== undefined && actorId !== world.uploaderId && actorId !== world.freezerId) {
        throw new Error(`actor ${actorId} is not a member of ${projectId}`);
      }
      return world.authorizeBranch(invocationId, branch);
    };

    /**
     * C16→C07 的结构化授权来源：真实会话按 C16 派生的精确 `invocationId` 与分支签发，
     * C16 随后用同一 invocationId、同一分支、同一 actor 亲自向 C06 复验。用别的
     * invocationId 签发会在 C06 的绑定复验处被拒，因此这里不做任何改写。
     */
    const reviewAuthorizationProvider: KnowledgeGovernanceReviewAuthorizationProviderV1 = {
      authorize: (input) =>
        authorizeByWorld(input.projectId, input.branch, input.invocationId, input.actorId),
    };

    const configuration = new PostgresAssessmentConfigurationAdapter({
      db,
      transactionUnit,
      artifactStore,
      governedReleases: {
        // C16 解析用自己派生的哈希 invocationId 复验 `knowledge-modeling.assessment-basis`。
        // 组合根按同一标识与分支重新签发真实 C06 上下文——不改写调用身份，也不放宽能力。
        resolveGovernedReleases: async (input) => {
          const authorization = await authorizeByWorld(
            input.projectId,
            "knowledge-modeling.assessment-basis",
            governedReleaseResolutionInvocationId({
              requiredDefinitionTypes: input.requiredDefinitionTypes,
              requiredAt: input.requiredAt,
              asOfRecordedAt: input.asOfRecordedAt,
            }),
            input.authorization.actorId,
          );
          return governanceRef.current!.resolveGovernedReleases({ ...input, authorization });
        },
      },
      now,
    });

    const scoringRules = new PostgresScoringRulesAdapter({
      db,
      transactionUnit,
      artifactStore,
      artifactReferenceGuard: cleaning.artifactRegistry,
      access,
      taskStore: cleaning.agentTaskAdapter,
      // C15 结果读取与冻结输入按工程路由到该 world 自己的管线 store：清洗任务在哪个
      // 管线收口，就由同一个 store 读回，不跨管线取事实。
      dataCleaning: {
        readBoundResult: (request) => {
          const store = activeWorlds.get(request.projectId)?.pipeline.store;
          if (store === undefined) throw new Error(`no C15 pipeline for ${request.projectId}`);
          return store.readBoundResult(request);
        },
        loadFrozenInput: (task) => {
          const taskId = task.envelope.agentTaskRef.reference.entityId;
          const matched = [...activeWorlds.values()].find((candidate) =>
            taskId.startsWith(`agent-task:${candidate.projectId}:`),
          );
          if (matched === undefined) throw new Error(`no C15 pipeline owns task ${taskId}`);
          return matched.pipeline.store.loadFrozenInput(task);
        },
      },
      configuration: {
        readPublishedConfigurationMember: (input) =>
          configuration.readPublishedConfigurationMember(input),
        resolveConfigurationSet: (request) => configuration.resolveConfigurationSet(request),
      },
      derivedPublisher: {
        publishDerivedRelease: (input) => governanceRef.current!.publishDerivedRelease(input),
      },
      governedReleases: {
        // C16 解析用自己派生的哈希 invocationId 复验 `knowledge-modeling.assessment-basis`。
        // 组合根按同一标识与分支重新签发真实 C06 上下文——不改写调用身份，也不放宽能力。
        resolveGovernedReleases: async (input) => {
          const authorization = await authorizeByWorld(
            input.projectId,
            "knowledge-modeling.assessment-basis",
            governedReleaseResolutionInvocationId({
              requiredDefinitionTypes: input.requiredDefinitionTypes,
              requiredAt: input.requiredAt,
              asOfRecordedAt: input.asOfRecordedAt,
            }),
            input.authorization.actorId,
          );
          return governanceRef.current!.resolveGovernedReleases({ ...input, authorization });
        },
      },
      // 生产准备读取：直接指向 C11 已实现的受权读取，而不是注入的固定投影。
      preparationSnapshot: cleaning.registry,
      submitRevision: {
        submitRevision: async (input) => {
          const authorization = await authorizeByWorld(
            input.projectId,
            "knowledge-modeling.submit-revision",
            input.commandId,
            input.task?.envelope.actorId,
          );
          const baseReleaseRef =
            input.task === undefined || input.definitionType !== "structured-scoring-rule"
              ? undefined
              : (await scoringRules.loadAuthoringManifest(input.task)).manifest.baseRuleReleaseRef;
          const submitted = await governance.govern(
            KnowledgeGovernanceCommandV1Schema.parse({
              kind: "submit-revision",
              commandId: input.commandId,
              idempotencyKey: input.idempotencyKey,
              projectId: input.projectId,
              actorId: authorization.actorId,
              issuedAt: input.issuedAt,
              authorization,
              payload: {
                definitionType: input.definitionType,
                candidateArtifactRef: input.candidateArtifactRef,
                ...(baseReleaseRef === undefined ? {} : { baseReleaseRef }),
                evidenceReferences: [
                  {
                    locator: { sourceSegmentId: "production-basis-evidence" },
                    sourceVersion: { entityId: "production-basis-source", versionId: "1" },
                  },
                ],
              },
            }),
          );
          if (submitted.kind !== "failed" && submitted.result.kind === "revision") {
            return { kind: "succeeded", revisionRef: submitted.result.knowledgeRevisionRef };
          }
          throw new Error(`C19 submit-revision failed: ${JSON.stringify(submitted).slice(0, 600)}`);
        },
      },
      startAgentTask: async (request) => {
        // C08 startTask 用命令自身的 commandId 作 C06 invocationId 复验，签发必须同标识。
        const authorization = await authorizeByWorld(
          request.command.projectId,
          "agent-task.start-task",
          request.command.commandId,
          request.command.actorId,
        );
        // C19 只提交命令内容；C08 契约入口在此补上唯一的授权上下文并完成 strict 校验。
        return agentTasksRef.current!.startTask(
          StartAgentTaskCommandV1Schema.parse({ ...request.command, authorization }),
        );
      },
      policy: PRODUCTION_BASIS_POLICY,
      now,
    } as never);
    scoringRulesRef.current = scoringRules;

    const agentTasks = new PostgresAgentTaskAdapter({
      db,
      registry: new AgentTaskDefinitionRegistry([
        createScoringRuleAuthoringTaskDefinition({
          policy: PRODUCTION_BASIS_POLICY,
          port: scoringRules,
        }),
      ]),
      transactionUnit,
      referenceGuard: cleaning.artifactRegistry,
      artifactStore,
      authorization: access,
      now: nowIso,
    } as never);
    agentTasksRef.current = agentTasks;

    const governance = new PostgresKnowledgeGovernanceAdapter({
      db,
      transactionUnit,
      access,
      reviewAudit,
      now,
      reviewAuthorizationProvider,
      assessmentConfigurationPolicy:
        configuration as unknown as AssessmentConfigurationGovernancePolicyV1,
      scoringRulesPolicy: scoringRules,
    } as never);
    governanceRef.current = governance;

    const putJsonFor = async (
      world: CleaningWorldV1,
      input: {
        readonly artifactId: string;
        readonly purposeCode: string;
        readonly mediaType: string;
        readonly value: unknown;
      },
    ): Promise<ContentArtifactRefV1> => {
      const authorization = await world.authorizeBranch(
        `${input.artifactId}:put`,
        "knowledge-modeling.assessment-basis",
      );
      const result = await artifactStore.put(
        {
          schemaVersion: "1",
          commandId: `${input.artifactId}:put`,
          idempotencyKey: `${input.artifactId}:put`,
          projectId: world.projectId,
          actorId: world.uploaderId,
          issuedAt: new Date().toISOString(),
          authorization,
          requiredCapability: authorization.grantedCapabilities[0]!,
          artifactId: input.artifactId,
          artifactKind: "content",
          purposeCode: input.purposeCode,
          mediaType: input.mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        } as never,
        (async function* () {
          yield strToU8(JSON.stringify(input.value));
        })(),
      );
      return result.artifactRef as ContentArtifactRefV1;
    };

    /** 人工审核与发布：C16 提交审阅 → C07 记录决定 → C16 在同一事务发布正式发布集。 */
    const approveAndPublish = async (input: {
      readonly world: ProductionBasisWorldV1;
      readonly revisionRef: KnowledgeRevisionRefV1;
    }): Promise<KnowledgeReleaseRefV1> => {
      const { world, revisionRef } = input;
      const revisionKey = revisionRef.reference.entityId;
      const requested = await governance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "request-review",
          commandId: `${revisionKey}:review`,
          idempotencyKey: `${revisionKey}:review`,
          projectId: world.world.projectId,
          actorId: world.actorId,
          issuedAt: PRODUCTION_BASIS_ISSUED_AT,
          authorization: await world.authorize(
            "knowledge-modeling.request-review",
            `${revisionKey}:review`,
          ),
          payload: {
            revisionRef,
            reviewPolicyRef: { entityId: "production-basis-review-policy", versionId: "1" },
          },
        }),
      );
      if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
        throw new Error(`C16 request-review failed: ${JSON.stringify(requested).slice(0, 600)}`);
      }
      const reviewTaskRef = requested.result.reviewTaskRef;
      const decided = await reviewAudit.decideReview({
        kind: "decide-review",
        commandId: `${revisionKey}:decision`,
        idempotencyKey: `${revisionKey}:decision`,
        projectId: world.world.projectId,
        actorId: world.actorId,
        issuedAt: PRODUCTION_BASIS_ISSUED_AT,
        authorization: await world.authorize(
          "review-audit.decide-review",
          `${revisionKey}:decision`,
        ),
        payload: {
          reviewTaskRef,
          targetRef: reviewTaskRef.targetRef,
          decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
          reasonCode: "production-basis-approved",
        },
      } as never);
      if (decided.kind !== "succeeded") {
        throw new Error(`C07 decide failed: ${JSON.stringify(decided).slice(0, 600)}`);
      }
      const published = await governance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "publish-approved-release",
          commandId: `${revisionKey}:publish`,
          idempotencyKey: `${revisionKey}:publish`,
          projectId: world.world.projectId,
          actorId: world.actorId,
          issuedAt: PRODUCTION_BASIS_PUBLISH_AT,
          authorization: await world.authorize(
            "knowledge-modeling.publish-approved-release",
            `${revisionKey}:publish`,
          ),
          payload: {
            revisionRef,
            reviewDecisionRef: decided.result.reviewDecisionRef,
            effectiveFrom: PRODUCTION_BASIS_PUBLISH_AT,
          },
        }),
      );
      if (published.kind !== "succeeded" || published.result.kind !== "release") {
        throw new Error(`C16 publish failed: ${JSON.stringify(published).slice(0, 600)}`);
      }
      return published.result.knowledgeReleaseRef;
    };

    /** C18 配置集合：逐类走 C16 提交 → C07 决定 → C16 发布，不存在独立发布入口。 */
    const publishConfigurationSet = async (
      world: ProductionBasisWorldV1,
      documents: Readonly<Record<string, unknown>>,
    ): Promise<void> => {
      for (const definitionType of Object.keys(documents).sort()) {
        const artifactRef = await world.putJson({
          artifactId: `production-basis-config-${world.world.projectId}-${definitionType}`,
          purposeCode: "assessment-configuration",
          mediaType: "application/vnd.riskflow.assessment-configuration+json",
          value: documents[definitionType],
        });
        const submitted = await governance.govern(
          KnowledgeGovernanceCommandV1Schema.parse({
            kind: "submit-revision",
            commandId: `${world.world.projectId}:${definitionType}:submit`,
            idempotencyKey: `${world.world.projectId}:${definitionType}:submit`,
            projectId: world.world.projectId,
            actorId: world.actorId,
            issuedAt: PRODUCTION_BASIS_ISSUED_AT,
            authorization: await world.authorize(
              "knowledge-modeling.submit-revision",
              `${world.world.projectId}:${definitionType}:submit`,
            ),
            payload: {
              definitionType,
              candidateArtifactRef: artifactRef,
              evidenceReferences: [
                {
                  locator: { sourceSegmentId: `${definitionType}:production-basis-evidence` },
                  sourceVersion: { entityId: "production-basis-source", versionId: "1" },
                },
              ],
            },
          }),
        );
        if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
          throw new Error(
            `C18 submit failed for ${definitionType}: ${JSON.stringify(submitted).slice(0, 600)}`,
          );
        }
        await approveAndPublish({ world, revisionRef: submitted.result.knowledgeRevisionRef });
      }
    };

    let baselineWorld: CleaningWorldV1 | undefined;

    const prepareWorld = async (suffix: string): Promise<ProductionBasisWorldV1> => {
      // 基准 world：C15 的任务定义注册、文档登记与转换策略都在首个 world 上落库一次，
      // 后续 world 才能读取已收口结果。缺了它，C15 结果读取会以权限拒绝收口。
      if (baselineWorld === undefined) {
        baselineWorld = await cleaning.createWorld({ suffix: "main" });
      }
      const world = await cleaning.createWorld({
        suffix,
        documentKinds: ["docx"],
        documents: [realStandardCleaningDocument()],
      });
      await freezeIdentificationPreparation(world.pipeline.store, world, {
        commandId: `${suffix}-freeze-${world.projectId}`,
        actor: "uploader",
      });
      // C15 真实收口：任务经原任务、原增量校验与原收口完成，不手工写已完成任务。
      const completion = await completeCleaningTask(world.pipeline, cleaning, {
        workerId: `${suffix}-worker`,
        projectId: world.projectId,
      });
      // C11 冻结评估准备时的生产事实读取：两个 owning reader 组合成一个 XOR reader，
      // 分支实现仍各归其所有者（design D-01），此处只做组合。
      riskInputFactsRef.current = createRiskInputFactsReader({
        standardizedRiskRecord: createPostgresStandardizedRiskInputFactsReader({
          db,
          authorization: access,
          now,
        }),
        externalRiskEvent: createPostgresExternalRiskInputFactsReader({
          db,
          authorization: access,
          artifactStore,
          now,
        }),
      });
      downstreamWorldRef.current = world;

      // 真实结构化外部风险事件：走 C11 公开登记命令与 C04 正文契约，让 C11 冻结评估准备
      // 时能由生产 reader 读出事实。合成样本、待甲方复核。
      const externalEventKey = `production-basis-external-event`;
      const sourceVersionRef = world.sourceVersionRefs()[0]!;
      // 证据定位取该 world 实际登记的资料段：外部事件正文按 C11 自身来源事实复核，
      // 编造的段标识会被按来源不可验拒绝。
      const segmentRows = await cleaning.postgres.adminPool.query<{ source_segment_id: string }>(
        `SELECT source_segment_id FROM business.source_segments
        WHERE project_id = $1 AND source_version_id = $2
        ORDER BY source_segment_id LIMIT 1`,
        [world.projectId, sourceVersionRef.reference.entityId],
      );
      const firstSegmentId = segmentRows.rows[0]?.source_segment_id;
      if (firstSegmentId === undefined) {
        throw new Error(`no registered source segment for ${sourceVersionRef.reference.entityId}`);
      }
      const eventAuthorization = await world.authorizeBranch(
        `${externalEventKey}:put`,
        "engineering-data.register-external-risk-event",
      );
      const eventArtifact = await artifactStore.put(
        {
          schemaVersion: "1",
          commandId: `${externalEventKey}:put`,
          idempotencyKey: `${externalEventKey}:put`,
          projectId: world.projectId,
          actorId: world.uploaderId,
          issuedAt: PRODUCTION_BASIS_ISSUED_AT,
          authorization: eventAuthorization,
          requiredCapability: eventAuthorization.grantedCapabilities[0]!,
          artifactId: externalEventKey,
          artifactKind: "content",
          purposeCode: "engineering-data.register-external-risk-event",
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        } as never,
        (async function* () {
          yield strToU8(
            JSON.stringify({
              schemaVersion: "1",
              projectId: world.projectId,
              externalSourceRef: { entityId: externalEventKey, versionId: "1" },
              externalEventKey,
              fields: [
                {
                  documentType: "external-risk-event",
                  fieldPath: ["riskEvent"],
                  value: "盾构工作面涌水涌砂",
                  evidenceReferences: [
                    {
                      locator: { sourceSegmentId: firstSegmentId },
                      sourceVersion: sourceVersionRef.reference,
                    },
                  ],
                },
              ],
              // 字段级 evidenceReferences 已在每个 field 内声明；正文契约不再接受顶层重复声明。
            }),
          );
        })(),
      );
      const registered = await cleaning.registry.apply({
        commandId: externalEventKey,
        idempotencyKey: externalEventKey,
        projectId: world.projectId,
        actorId: world.uploaderId,
        issuedAt: PRODUCTION_BASIS_ISSUED_AT,
        // C11 按 commandId 复验，且命令声明的来源版本必须在授权来源范围内：
        // 工件写入与命令注册是两个不同调用身份，各自签发。
        authorization: await world.authorizeBranch(
          externalEventKey,
          "engineering-data.register-external-risk-event",
          [sourceVersionRef],
        ),
        kind: "register-external-risk-event",
        payload: {
          externalSourceRef: { entityId: externalEventKey, versionId: "1" },
          externalEventKey,
          eventArtifactRef: eventArtifact.artifactRef,
          evidenceReferences: [
            {
              locator: { sourceSegmentId: firstSegmentId },
              sourceVersion: sourceVersionRef.reference,
            },
          ],
          occurredAt: PRODUCTION_BASIS_ISSUED_AT,
        },
      } as never);
      if (
        registered.kind !== "succeeded" ||
        registered.result.kind !== "register-external-risk-event"
      ) {
        throw new Error(`external risk event registration failed: ${JSON.stringify(registered)}`);
      }
      // 风险输入引用 C11 实际落库的事件引用，不复用外部事件键。
      const riskInput = registered.result.externalRiskEventRef as {
        readonly kind: "external-risk-event";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };

      const basis: ProductionBasisWorldV1 = {
        cleaning,
        world,
        dataCleaningTaskRef: completion.taskRef,
        cleaningTaskAdapter: world.pipeline.agentTaskAdapter,
        riskInput,
        configurationSetRef: {
          entityId: `production-basis-config-set-${world.projectId}`,
          versionId: "1",
        },
        actorId: world.uploaderId,
        authorize: (branch, invocationId) => world.authorizeBranch(invocationId, branch),
        authorizeDataCleaningRead: (invocationId) =>
          world.authorizeBranch(invocationId, "engineering-data.evidence-access"),
        putJson: (input) => putJsonFor(world, input),
        close: cleaning.close,
      };
      activeWorlds.set(world.projectId, world);
      const configurationSet = makeAssessmentConfigurationFixtureSet({
        projectId: world.projectId,
        projectRevisionRef: world.projectRevisionRef,
        configurationSetRef: basis.configurationSetRef,
      });
      await publishConfigurationSet(basis, configurationSet.documents);
      return {
        ...basis,
        indicatorIds: (
          configurationSet.documents["indicator-system"] as unknown as {
            readonly content: {
              readonly indicators: readonly { readonly indicatorId: string }[];
            };
          }
        ).content.indicators.map((indicator) => indicator.indicatorId),
      };
    };

    /**
     * D-12 完整顺序：已发布配置与规则 → C11 冻结准备 → C19 组装 → C16/C07 审核发布
     * 适用规则集 → C19 解析出公共依据。返回的是 `resolve` 的实际输出，不预造引用。
     */
    const publishAssessmentBasis = async (input: {
      readonly world: ProductionBasisWorldV1;
      readonly ruleOperations: readonly unknown[];
    }): Promise<{
      readonly ruleRevisionRef: KnowledgeRevisionRefV1;
      readonly preparationSnapshotRef: {
        readonly kind: "assessment-preparation-snapshot";
        readonly reference: VersionReference;
      };
      readonly applicableRuleSetReleaseRef: KnowledgeReleaseRefV1;
      readonly assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
    }> => {
      const { world } = input;
      const projectId = world.world.projectId;
      const key = (suffix: string) => `${suffix}-${projectId}`;

      // 1. C19 规则编制：来源必须是已收口的 C15 清洗任务。
      const prepared = await scoringRules.prepareAuthoring({
        requestId: key("production-basis-authoring"),
        idempotencyKey: key("production-basis-authoring"),
        projectId,
        actorId: world.actorId,
        requestedAt: PRODUCTION_BASIS_AUTHORING_AT,
        authorization: await world.authorize(
          "knowledge-modeling.assessment-basis",
          key("production-basis-authoring"),
        ),
        // C19 按 (工程, 清洗任务) 缓存首次的 C15 读取查询：同一清洗任务的第二次编制复用首个
        // 读取身份。因此这里按同一个标识签发，授权的 actor/分支/资料范围与首次完全一致。
        dataCleaningAuthorization: await world.authorizeDataCleaningRead(
          key("production-basis-authoring"),
        ),
        projectRevisionRef: world.world.projectRevisionRef,
        dataCleaningTaskRef: world.dataCleaningTaskRef,
        requiredAt: PRODUCTION_BASIS_AUTHORING_AT,
        asOfRecordedAt: PRODUCTION_BASIS_AUTHORING_AT,
        scoringPolicyRef: PRODUCTION_BASIS_POLICY.policyRef,
        sourceStandardKinds: ["国家规范"],
      });
      if (prepared.kind !== "succeeded") {
        throw new Error(`C19 prepareAuthoring failed: ${JSON.stringify(prepared).slice(0, 800)}`);
      }
      const authoringTask = await agentTasks.getTask(prepared.agentTaskRef);
      if (authoringTask === undefined) throw new Error("C19 authoring task was not persisted");
      const finalized = await scoringRules.finalizeAuthoringCandidate({
        task: authoringTask,
        candidate: {
          schemaVersion: "1" as const,
          candidateVersion: 1,
          operations: input.ruleOperations,
        } as never,
      });
      if (finalized.status !== "completed" || !("candidateRef" in finalized)) {
        throw new Error(
          `C19 candidate finalize failed: ${JSON.stringify(finalized).slice(0, 800)}`,
        );
      }
      const ruleRevisionRef = finalized.candidateRef as unknown as KnowledgeRevisionRefV1;
      await approveAndPublish({ world, revisionRef: ruleRevisionRef });

      // 2. C11 冻结评估准备：真实写入准备快照，风险事实由生产 reader 读出该 world 登记的
      //    外部风险事件。准备投影随后由 C19 通过 C11 生产读取取得，不注入固定投影。
      const preparationCommandId = key("production-basis-preparation");
      const preparationAuthorization = await world.authorize(
        "engineering-data.assessment-preparation",
        preparationCommandId,
      );
      const frozen = await cleaning.registry.freeze({
        commandId: preparationCommandId,
        idempotencyKey: preparationCommandId,
        projectId,
        actorId: world.actorId,
        issuedAt: PRODUCTION_BASIS_AUTHORING_AT,
        authorization: preparationAuthorization,
        kind: "assessment-preparation",
        payload: {
          riskInput: world.riskInput,
          projectRevisionRef: world.world.projectRevisionRef,
          spatialScopeRef: world.world.spatialScopeRef,
          applicabilityMetadataSnapshotRef: world.world.applicabilitySnapshotRef,
          entryMode: "assess",
          triggerReasonCode: "production-basis-preparation",
        },
      } as never);
      if (frozen.kind !== "succeeded" || frozen.result.kind !== "assessment-preparation") {
        throw new Error(`C11 preparation freeze failed: ${JSON.stringify(frozen).slice(0, 800)}`);
      }
      const preparationSnapshotRef = frozen.result.assessmentPreparationSnapshotRef as never;

      // 3. C19 组装适用规则集：消费 C11 生产准备投影与已发布配置。
      const assembled = await scoringRules.assembleApplicableRuleSetRevision({
        requestId: key("production-basis-assembly"),
        idempotencyKey: key("production-basis-assembly"),
        projectId,
        actorId: world.actorId,
        requestedAt: PRODUCTION_BASIS_AUTHORING_AT,
        authorization: await world.authorize(
          "knowledge-modeling.assessment-basis",
          key("production-basis-assembly"),
        ),
        projectRevisionRef: world.world.projectRevisionRef,
        preparationSnapshotRef,
        applicabilitySnapshotRef: world.world.applicabilitySnapshotRef,
        applicability: { ...PRODUCTION_BASIS_APPLICABILITY },
        requiredAt: PRODUCTION_BASIS_AUTHORING_AT,
        asOfRecordedAt: PRODUCTION_BASIS_AUTHORING_AT,
        scoringPolicyRef: PRODUCTION_BASIS_POLICY.policyRef,
        assemblyPolicyRef: PRODUCTION_BASIS_POLICY.assemblyPolicyRef,
        compatibilityRef: PRODUCTION_BASIS_POLICY.compatibilityRef,
        configurationSetRef: world.configurationSetRef,
      } as never);
      if (assembled.kind !== "succeeded") {
        throw new Error(
          `C19 assembleApplicableRuleSetRevision failed: ${JSON.stringify(assembled).slice(0, 800)}`,
        );
      }
      const applicableRuleSetReleaseRef = assembled.applicableRuleSetReleaseRef;

      // 4. C19 公共解析：返回实际依据引用，供 C25 冻结与正式评估消费。
      const resolved = (await scoringRules.resolve({
        kind: "assessment-basis",
        commandId: key("production-basis-resolve"),
        idempotencyKey: key("production-basis-resolve"),
        projectId,
        actorId: world.actorId,
        issuedAt: PRODUCTION_BASIS_AUTHORING_AT,
        authorization: await world.authorize(
          "knowledge-modeling.assessment-basis",
          key("production-basis-resolve"),
        ),
        branch: "knowledge-modeling.assessment-basis",
        payload: { preparationSnapshotRef, requiredAt: PRODUCTION_BASIS_AUTHORING_AT },
      } as never)) as { kind: string; result?: { assessmentBasisReleaseSetRef?: unknown } };
      const assessmentBasisReleaseSetRef = resolved.result?.assessmentBasisReleaseSetRef;
      if (resolved.kind !== "succeeded" || assessmentBasisReleaseSetRef === undefined) {
        throw new Error(`C19 resolve failed: ${JSON.stringify(resolved).slice(0, 800)}`);
      }

      return {
        ruleRevisionRef,
        preparationSnapshotRef,
        applicableRuleSetReleaseRef,
        assessmentBasisReleaseSetRef:
          assessmentBasisReleaseSetRef as AssessmentBasisReleaseSetRefV1,
      };
    };

    return {
      cleaning,
      reviewAudit,
      governance,
      configuration,
      scoringRules,
      agentTasks,
      policy: PRODUCTION_BASIS_POLICY,
      readAssessmentPreparationSnapshot: cleaning.registry.readAssessmentPreparationSnapshot.bind(
        cleaning.registry,
      ),
      prepareWorld,
      publishAssessmentBasis,
      approveAndPublish,
      close: cleaning.close,
    };
  };
