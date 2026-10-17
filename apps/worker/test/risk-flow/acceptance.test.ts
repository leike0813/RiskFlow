/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 全链验收（IP-09，implementation-plan §6：R3/S2、R3/S4、R6/S1、R6/S2 关键链路）。
 *
 * 真实面：Testcontainers PostgreSQL + 完整生产迁移链（含夹具迁移）+ 真实 C03 事务单元/审计/Outbox +
 * 真实 C04 工件存储 + 真实 LangGraph PostgreSQL checkpointer + 真实 C30 运行登记/正文适配器 +
 * 真实 C30 父图（`assess`/`record-response-feedback` 入口）与评估子图 + 真实 C22 标准化风险记录
 * 写入与只读追溯适配器（IP-07，`RiskRecordTraceReadPortV1`）。
 *
 * 替身面（只返回闭合结果，不读任何私表、不复制领域算法）：C11/C17/C19 领域端口、C25～C29 领域端口、
 * C08 组合 Agent 接缝、C30 自有 `basisResolver`/`recommendationAgent`/`calibrationAgent`/`policies`/
 * `riskSpatialPairing`/`retryPolicy`。原因：这些真实适配器各自需要独占容器的上游真实栈
 * （C11 冻结、C14 监测序列、C16/C17 发布与 C04 正文摘要），本单容器装配内无法复用；
 * 关键断言全部落在真实持久化事实上：登记行、运行状态与版本、阶段结果、链边、审计引用、
 * 运行汇总正文、C22 记录行、幂等与重放。
 *
 * 规划残差（如实记录，不伪造成功）：
 * 1. `identify-and-assess` 的父图识别阶段需要真实 C24 识别子图；本文件所在测试树必须以
 *    `packages/adapters/test/**` 相对路径复用夹具，相对路径把 adapters 解析到 `src`，而
 *    `@riskflow/adapters/*` 解析到 `dist`，两层的 C03 事务绑定是模块级 WeakMap，混层时
 *    `getPostgresTransaction` 取不到事务（`TRANSACTION_FAILED`）。因此本文件改用同一容器上的
 *    真实 C30 父图 `assess`/`record-response-feedback` 入口驱动真实评估子运行，未覆盖 R2/S1 的
 *    “多已验收风险分别评估”父图扇出。
 * 2. 公共预测/反馈入口可显式冻结评估依据；其它必需的预测/反馈引用仍需独立核验，
 *    本文件只把已成立的内部冻结输入链作为尾链证据，不把缺席的公共成功路径冒充通过。
 *
 * 断言只针对调用方可见契约，不断言私有实现、提示词或文案全文。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentEvaluationSuccessV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AuthorizationContextV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  type HumanDecisionProofPortV1,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  ContentArtifactRefV1Schema,
  DeviationRecordRefV1Schema,
  ReviewTaskRefV1Schema,
  RiskRecordTraceReadResultV1Schema,
  WarningResponseRecordResultV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  type AssessmentEvaluationCommandV1,
  type AssessmentPreparationCommandV1,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type EngineeringDataPortV1,
  type EngineeringFreezeCommandV1,
  type KnowledgeModelingPortV1,
  type KnowledgeResolutionCommandV1,
  type AgentTaskTypeV1,
  type ModuleBranchV1,
  type OpenWarningCommandV1,
  type ReadAssessmentBasisReleaseSetV1,
  type RiskAssessmentPortV1,
  type RiskRecordTraceReadResultV1,
  type StandardizedRiskRecordRefV1,
  type StartWorkflowRunCommandV1,
  type WorkflowEntryModeV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  StandardizedRiskRecordEnvelopeSchema,
  type StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";
import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { PostgresLocalIdentityAccess } from "@riskflow/adapters/auth";
import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import { ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1 } from "@riskflow/core/assessment-config";
import {
  CALIBRATION_AGENT_TASK_TYPE_V1,
  CalibrationValidationPolicyV1Schema,
  type CalibrationValidationPolicyV1,
  type CalibrationServiceV1,
} from "@riskflow/core/calibration";
import { StandardizedRiskRecordWriteV1Schema } from "@riskflow/core/identification/candidate-finalization";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import {
  RECOMMENDATION_TASK_TYPE_V1,
  type RecommendationServiceV1,
} from "@riskflow/core/recommendation";
import type { ResponseLifecycleServiceV1 } from "@riskflow/core/response-lifecycle";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import type { AssessmentRuntimePolicySetProviderV1 } from "@riskflow/core/risk-assessment/engine";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import type { WarningLifecycleServiceV1 } from "@riskflow/core/warning";
import {
  WorkflowGraphRunResultV1Schema,
  segmentedAssessmentSubRunIdentityFor,
  workflowEntryIdentityFor,
  workflowRunIdentityFor,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunCommandV1,
  type WorkflowGraphRunResultV1,
  type WorkflowGraphRunStateV1,
} from "@riskflow/core/workflow";

import { createArtifactStore } from "@riskflow/adapters/artifacts";
import {
  createPostgresRiskCandidateFinalizationAdapter,
  createPostgresRiskRecordTraceReader,
} from "@riskflow/adapters/identification/candidate-finalization";
import {
  createPostgresTransactionUnit,
  runPostgresMigrations,
  setupPostgresCheckpointer,
} from "@riskflow/adapters/postgres";

import {
  createPostgresRuntime,
  type PostgresRuntime,
} from "../../../../packages/adapters/test/identification/graph/wiring.js";
import {
  startPostgresFixture,
  type PostgresTestFixture,
} from "../../../../packages/adapters/test/postgres/fixture.js";

import {
  createAssessmentGraphComposition,
  type AssessmentGraphCalibrationAgentPortV1,
  type AssessmentGraphCompositionV1,
  type AssessmentGraphPolicyCatalogV1,
  type AssessmentGraphRecommendationAgentPortV1,
  type AssessmentGraphRuntimeV1,
} from "../../src/assessment/index.js";
import {
  createRiskFlowGraphComposition,
  type RiskFlowGraphCompositionV1,
} from "../../src/risk-flow/index.js";

const PROJECT_ID = "project-c30-acceptance";
const ACTOR_ID = "actor-c30-acceptance";
const TIMESTAMP = "2030-05-01T00:00:00.000Z";

const digest = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});

const refOf = <const K extends string>(kind: K, entityId: string, versionId = "v1") =>
  ({ kind, reference: { entityId, versionId } }) as const;

/** 严格 Schema 解析的精确引用：与公共契约同名，不另造引用形状。 */
const parseRef = <T>(
  schema: { parse: (value: unknown) => T },
  kind: ContractReferenceV1["kind"],
  entityId: string,
  versionId = "v1",
): T => schema.parse({ kind, reference: versionRef(entityId, versionId) });

const SPATIAL_SCOPE_REF = parseRef(
  SpatialScopeRefV1Schema,
  "spatial-scope",
  `spatial-scope:${PROJECT_ID}`,
);
const SOURCE_ACCESS_GRANT_REF = refOf("source-access-grant", `source-access-grant:${PROJECT_ID}`);
const APPLICABILITY_REF = parseRef(
  ApplicabilityMetadataSnapshotRefV1Schema,
  "applicability-metadata-snapshot",
  `applicability-metadata:${PROJECT_ID}`,
);
const AUTHORIZATION_CONTEXT_REF = refOf(
  "authorization-context",
  `authorization-context:${PROJECT_ID}`,
  digest("authorization-context-v1"),
);
const RETRY_POLICY_REF = versionRef("retry-policy", "1");
const ASSESSMENT_GRAPH_VERSION = versionRef("assessment-graph", "c30-acceptance");
const RISK_FLOW_GRAPH_VERSION = versionRef("risk-flow-graph", "c30-acceptance");
/** 工序节点与资料段/机理条目：逐跳可回指同一合成工序模型成员（合成样本、待甲方复核）。 */
const PROCESS_NODE_ID = "node-current";
const SOURCE_SEGMENT_ID = `segment-${PROCESS_NODE_ID}`;
const MECHANISM_ENTRY_ID = `mechanism-${PROCESS_NODE_ID}`;

const AUTHORIZATION = AuthorizationContextV1Schema.parse({
  schemaVersion: "1",
  authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
  actorId: ACTOR_ID,
  projectId: PROJECT_ID,
  grantedCapabilities: ["workflow.start"],
  spatialScopeRefs: [SPATIAL_SCOPE_REF],
  sourceAccessGrantRefs: [SOURCE_ACCESS_GRANT_REF],
  authorizationPolicyRef: versionRef("authorization-policy"),
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});

/** 追溯读授权：C22 只读追溯接缝只复用 `projection.query` 分支（design D-06）。 */
const TRACE_AUTHORIZATION = AuthorizationContextV1Schema.parse({
  ...AUTHORIZATION,
  authorizationContextRef: refOf(
    "authorization-context",
    `authorization-context:${PROJECT_ID}:trace`,
    digest("trace-authorization"),
  ),
  grantedCapabilities: ["projection.query"],
});

/**
 * C05 复验替身：`verify` 只按实际复验分支返回该分支能力（适配器要求复验上下文能力与调用方一致），
 * `verifyCurrent` 只按签发身份放行；撤销后一律拒绝，并记录每次复验请求。
 */
const createAccess = () => {
  const calls: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  let revoked = false;
  const contextFor = (
    capability: AuthorizationContextV1["grantedCapabilities"][number],
    authorizationContextRef: AuthorizationContextV1["authorizationContextRef"],
  ): AuthorizationContextV1 =>
    AuthorizationContextV1Schema.parse({
      ...AUTHORIZATION,
      authorizationContextRef,
      grantedCapabilities: [capability],
    });
  return {
    port: {
      async authorizeBusinessAction(input) {
        if (revoked) throw new Error("access revoked");
        const context = contextFor(
          input.capability,
          input.authorizationContextRef ?? AUTHORIZATION.authorizationContextRef,
        );
        return { context, contextRef: context.authorizationContextRef, redacted: false };
      },
      async verify(requestInput: Parameters<LocalIdentityAccessV1["verify"]>[0]) {
        calls.push({ invocationId: requestInput.invocationId, branch: requestInput.branch });
        if (revoked) {
          throw new AccessServiceError({
            code: "AUTHORIZATION_DENIED",
            retryable: false,
            stage: "c30-acceptance.verify",
            occurredAt: TIMESTAMP,
            diagnosticRef: refOf("diagnostic-artifact", "c30-access-diagnostic"),
            contextRefs: [],
            requiredCapability: MODULE_BRANCH_CAPABILITY_V1[requestInput.branch],
            authorizationPolicyRef: versionRef("authorization-policy"),
          });
        }
        return {
          context: contextFor(
            MODULE_BRANCH_CAPABILITY_V1[requestInput.branch],
            requestInput.authorizationContextRef,
          ),
          contextRef: requestInput.authorizationContextRef,
          redacted: false,
        };
      },
    } satisfies Pick<PostgresLocalIdentityAccess, "verify" | "authorizeBusinessAction">,
    runtimeAuthorization: {
      async verifyCurrent(input: {
        readonly authorization: AuthorizationContextV1;
        readonly projectId: string;
        readonly actorId: string;
        readonly invocationId: string;
        readonly branch: ModuleBranchV1;
        readonly requestedAt: string;
      }): Promise<AuthorizationContextV1 | undefined> {
        calls.push({ invocationId: input.invocationId, branch: input.branch });
        if (revoked) return undefined;
        const parsed = AuthorizationContextV1Schema.safeParse(input.authorization);
        return parsed.success ? parsed.data : undefined;
      },
    },
    calls,
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
  };
};

/* -------------------------------------------------------------------------- */
/* C30 评估子图领域端口替身（只返回闭合结果）                                     */
/* -------------------------------------------------------------------------- */

interface AcceptanceWorldV1 {
  readonly clock: { current: Date };
  warning: "triggers" | "none";
  recommendation: "recorded" | "validation-rejected";
  deviation: "exceeded" | "within-threshold" | "unavailable";
  calibrationAgent: "completed" | "failed";
  basisResolution: "succeeded" | "unavailable";
  readonly calls: {
    readonly freeze: EngineeringFreezeCommandV1[];
    readonly basisResolve: KnowledgeResolutionCommandV1[];
    readonly basisRead: ReadAssessmentBasisReleaseSetV1[];
    readonly prepare: AssessmentPreparationCommandV1[];
    readonly evaluate: AssessmentEvaluationCommandV1[];
    readonly warningOpen: OpenWarningCommandV1[];
    readonly authorizeDownstream: { readonly invocationId: string; readonly branch: string }[];
  };
}

const createWorld = (): AcceptanceWorldV1 => ({
  clock: { current: new Date(TIMESTAMP) },
  warning: "triggers",
  recommendation: "recorded",
  deviation: "exceeded",
  calibrationAgent: "completed",
  basisResolution: "succeeded",
  calls: {
    freeze: [],
    basisResolve: [],
    basisRead: [],
    prepare: [],
    evaluate: [],
    warningOpen: [],
    authorizeDownstream: [],
  },
});

/** C08 Agent 任务身份：`AgentTaskRefV1Schema` 十项字段全必填，经 Schema 严格构造。 */
const agentTaskRefFor = (
  taskType: AgentTaskTypeV1,
  actionId: string,
): ReturnType<typeof AgentTaskRefV1Schema.parse> => {
  const parsed = AgentTaskRefV1Schema.safeParse({
    kind: "agent-task",
    reference: versionRef(`agent-task:${taskType}:${actionId}`, digest(`agent-task:${actionId}`)),
    taskType,
    triggerMode: "embedded",
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
    toolPolicyRef: versionRef("tool-policy"),
    budgetPolicyRef: versionRef("budget-policy"),
    incrementSchemaRef: versionRef("increment-schema"),
    validationPolicyRef: versionRef("validation-policy"),
  });
  if (!parsed.success) {
    console.error("DIAGNOSTIC agentTaskRef issues", JSON.stringify(parsed.error.issues));
    throw new TypeError("c30-acceptance agent task ref shape incomplete");
  }
  return parsed.data;
};

/**
 * C08 完成态任务结果：恰好一个主输出族（`incrementRef`/`candidateRef`/`formalResultRef` 三者取一），
 * 形状不符时抛出带 Zod issues 的 TypeError（不猜测字段、不静默回退）。
 */
const agentTaskResultRefFor = (input: {
  readonly agentTaskRef: ReturnType<typeof AgentTaskRefV1Schema.parse>;
  readonly actionId: string;
  readonly candidateRef: ContractReferenceV1;
}) => {
  const parsed = AgentTaskResultRefV1Schema.safeParse({
    kind: "agent-task-result",
    reference: versionRef(
      `agent-task-result:${input.actionId}`,
      digest(`agent-task-result:${input.actionId}`),
    ),
    status: "completed",
    agentTaskRef: input.agentTaskRef,
    candidateRef: input.candidateRef,
  });
  if (!parsed.success) {
    console.error("DIAGNOSTIC agentTaskResultRef issues", JSON.stringify(parsed.error.issues));
    throw new TypeError("c30-acceptance agent task result shape incomplete");
  }
  return parsed.data;
};

const diagnosticRef = (name: string) =>
  refOf("diagnostic-artifact", `${name}-diagnostic`, digest(`${name}-diagnostic`));

const transientFailure = (stageCode: string) =>
  ModuleErrorV1Schema.parse({
    code: "TRANSIENT_FAILURE",
    category: "technical",
    retryable: true,
    stageCode,
    occurredAt: TIMESTAMP,
    causalRunId: "c30-acceptance",
    attempt: 1,
    retryPolicyRef: RETRY_POLICY_REF,
    diagnosticRef: diagnosticRef(stageCode),
  });

const basisMembersV1 = () => {
  const member = (name: string) => ({
    releaseRef: { kind: "knowledge-release" as const, reference: versionRef(`release-${name}`) },
    revisionRef: { kind: "knowledge-revision" as const, reference: versionRef(`revision-${name}`) },
    artifactRef: { kind: "content-artifact" as const, reference: versionRef(`artifact-${name}`) },
    contentDigest: digest(`content-${name}`),
  });
  return {
    applicableRuleSetMember: member("applicable-rule-set"),
    scoringRuleMembers: [member("rule-a")],
    // 规范序覆盖全部十一类配置成员（含 C27 `measure-candidates` 需要的 `measure-library` 释放）。
    configurationMembers: [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1]
      .sort()
      .map((definitionType) => ({ definitionType, ...member(definitionType) })),
  };
};

/** C29 校准 Agent 策略：形状由 C29 单一 schema 决定，装配期校验失败即报错，不猜默认值。 */
const calibrationAgentPolicy = (): CalibrationValidationPolicyV1 =>
  CalibrationValidationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: versionRef("calibration-agent-policy"),
    projectId: PROJECT_ID,
    definitionRef: versionRef("calibration-definition"),
    toolPolicyRef: versionRef("calibration-tool-policy"),
    incrementSchemaRef: versionRef("calibration-increment-schema"),
    validationPolicyRef: versionRef("calibration-validation-policy-ref"),
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: versionRef("calibration-budget-policy"),
      modelDeploymentRef: versionRef("model-deployment"),
      promptTemplateRef: versionRef("prompt-template"),
      toolPolicyRef: versionRef("calibration-tool-policy"),
      maxModelInvocations: 1,
      maxToolInvocations: 1,
      maxContextTokens: 4096,
      maxInputBytes: 4096,
      maxOutputBytes: 4096,
      maxCandidates: 1,
      maxObjects: 2,
      maxSupplementarySearches: 0,
      maxCorrections: 0,
      maxTransientRetries: 0,
      maxConcurrentActions: 1,
      maxWallClockMs: 1000,
    },
    evidenceRequirementCount: 1,
    maxOperations: 2,
  });

interface AssessmentPortDoublesV1 {
  readonly engineeringData: Pick<EngineeringDataPortV1, "freeze">;
  readonly basis: AssessmentBasisReleaseSetReaderV1;
  readonly basisResolver: Pick<KnowledgeModelingPortV1, "resolve">;
  readonly runtimePolicies: AssessmentRuntimePolicySetProviderV1;
  readonly riskAssessment: RiskAssessmentPortV1;
  readonly warning: Pick<WarningLifecycleServiceV1, "open">;
  readonly recommendation: Pick<
    RecommendationServiceV1,
    "measureCandidates" | "createCandidate" | "validateAndRecord"
  >;
  readonly recommendationAgent: AssessmentGraphRecommendationAgentPortV1;
  readonly responseLifecycle: Pick<
    ResponseLifecycleServiceV1,
    "forecastResponse" | "calculateDeviation"
  >;
  readonly calibration: Pick<
    CalibrationServiceV1,
    "prepareInput" | "createSuggestion" | "readCreatedDeviationRecordRef"
  >;
  readonly calibrationAgent: AssessmentGraphCalibrationAgentPortV1;
  readonly policies: AssessmentGraphPolicyCatalogV1;
  readonly authorizeDownstream: AssessmentGraphPortsV1["authorizeDownstream"];
}

const createPortDoubles = (world: AcceptanceWorldV1): AssessmentPortDoublesV1 => ({
  // C11 冻结等下游动作按 branch 另签上下文；本替身只回传装配登记的授权身份，
  // 并记录签发请求，使验收能断言「下游动作用的是另签上下文而不是运行上下文」。
  authorizeDownstream: async (request) => {
    world.calls.authorizeDownstream.push(request);
    return AuthorizationContextV1Schema.parse({
      ...AUTHORIZATION,
      grantedCapabilities: ["engineering-data.freeze"],
    });
  },
  engineeringData: {
    freeze: async (command) => {
      world.calls.freeze.push(command);
      if (command.kind !== "assessment-preparation") {
        throw new TypeError("the assessment graph only freezes an assessment preparation");
      }
      const payload = command.payload;
      return {
        kind: "succeeded",
        result: {
          kind: "assessment-preparation",
          assessmentPreparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema.parse({
            kind: "assessment-preparation-snapshot",
            reference: versionRef(
              `assessment-preparation:${payload.riskInput.reference.entityId}`,
              sha256CanonicalJson(payload),
            ),
          }),
        },
      };
    },
  },
  basis: {
    readAssessmentBasisReleaseSet: async (read) =>
      AssessmentBasisReleaseSetReadResultV1Schema.parse({
        kind: "succeeded",
        schemaVersion: "1",
        assessmentBasisReleaseSetRef: read.assessmentBasisReleaseSetRef,
        memberDigest: digest("basis-members"),
        ...basisMembersV1(),
      }),
  },
  basisResolver: {
    resolve: async (command) => {
      world.calls.basisResolve.push(command);
      if (command.kind !== "assessment-basis") {
        throw new TypeError("the assessment graph only resolves the assessment basis");
      }
      if (world.basisResolution === "unavailable") {
        return { kind: "failed", error: transientFailure("c17-resolve") };
      }
      const payload = command.payload;
      return {
        kind: "succeeded",
        result: {
          kind: "assessment-basis",
          assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema.parse({
            kind: "assessment-basis-release-set",
            reference: versionRef(
              `assessment-basis:${payload.preparationSnapshotRef.reference.entityId}`,
              digest(
                sha256CanonicalJson({
                  preparationSnapshotRef: payload.preparationSnapshotRef,
                  requiredAt: payload.requiredAt,
                }),
              ),
            ),
          }),
        },
      };
    },
  },
  runtimePolicies: {
    readRuntimePolicySet: async () => ({
      kind: "succeeded",
      policySet: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        warningAggregationPolicyRef: versionRef("warning-aggregation-policy"),
        notificationPolicyRef: versionRef("notification-policy"),
        responseGenerationPolicyRef: versionRef("response-generation-policy"),
        responseValidationPolicyRef: versionRef("response-validation-policy"),
        responseAgentPolicyRef: versionRef("response-agent-policy"),
        calibrationAgentPolicyRef: versionRef("calibration-agent-policy"),
        retryPolicyRef: RETRY_POLICY_REF,
        reviewPolicyRef: versionRef("review-policy"),
        modelDeploymentRef: versionRef("model-deployment"),
        promptTemplateRef: versionRef("prompt-template"),
      },
    }),
  },
  riskAssessment: {
    prepare: async (command) => {
      world.calls.prepare.push(command);
      const { preparationSnapshotRef } = command.payload;
      return {
        kind: "succeeded",
        result: {
          assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema.parse({
            kind: "assessment-input-snapshot",
            reference: versionRef(
              `assessment-input:${sha256CanonicalJson(command.payload).slice(0, 32)}`,
              digest(`assessment-input:${preparationSnapshotRef.reference.versionId}`),
            ),
          }),
        },
      };
    },
    evaluate: async (command) => {
      world.calls.evaluate.push(command);
      const versionId = digest(sha256CanonicalJson(command.payload));
      return {
        kind: "succeeded",
        result: AssessmentEvaluationSuccessV1Schema.parse({
          indicatorActualValueSetRef: refOf(
            "indicator-actual-value-set",
            `values:${versionId.slice(0, 16)}`,
          ),
          assessmentDecisionArtifactRef: refOf(
            "assessment-decision-artifact",
            `decision:${versionId.slice(0, 16)}`,
          ),
          assessmentRecordRef: RiskAssessmentRecordRefV1Schema.parse({
            kind: "risk-assessment-record",
            reference: versionRef(`assessment-record:${versionId.slice(0, 16)}`, versionId),
          }),
        }),
      };
    },
  },
  warning: {
    open: async (command) => {
      world.calls.warningOpen.push(command);
      if (world.warning === "none") {
        return {
          kind: "succeeded",
          result: {
            warningRecordRefs: [],
            warningResponseTaskRefs: [],
            notificationIntentRefs: [],
          },
        };
      }
      const recordRef = refOf(
        "warning-record",
        `warning-record:${command.payload.assessmentRecordRef.reference.entityId}`,
        digest("warning-record-v1"),
      );
      return {
        kind: "succeeded",
        result: {
          warningRecordRefs: [recordRef],
          warningResponseTaskRefs: [
            refOf(
              "warning-response-task",
              `warning-response-task:${command.payload.assessmentRecordRef.reference.entityId}`,
              digest("warning-response-task-v1"),
            ),
          ],
          notificationIntentRefs: [],
        },
      };
    },
  },
  recommendation: {
    measureCandidates: async (command) => ({
      kind: "succeeded",
      result: {
        knowledgeQueryResultRef: refOf(
          "knowledge-query-result",
          `measure-candidates:${command.queryId}`,
          digest(command.queryId),
        ),
      },
    }),
    createCandidate: async (command) => ({
      kind: "succeeded",
      result: {
        kind: "candidate",
        recommendationCandidateRef: refOf(
          "recommendation-candidate",
          `recommendation-candidate:${command.payload.warningResponseTaskRef.reference.entityId}`,
          digest(sha256CanonicalJson(command.payload)),
        ),
      },
    }),
    validateAndRecord: async (command) => {
      if (world.recommendation === "validation-rejected") {
        return {
          kind: "failed",
          error: ModuleErrorV1Schema.parse({
            code: "BUSINESS_BLOCKED",
            category: "business-blocked",
            retryable: false,
            stageCode: "warning-response.validate-and-record",
            occurredAt: TIMESTAMP,
            causalRunId: "c30-acceptance",
            blockerKind: "three-constraints-rejected",
            blockerRef: command.payload.recommendationCandidateRef,
          }),
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "recorded",
          responseRecommendationRef: refOf(
            "response-recommendation",
            `response-recommendation:${command.payload.recommendationCandidateRef.reference.entityId}`,
            digest(sha256CanonicalJson(command.payload)),
          ),
        },
      };
    },
  },
  recommendationAgent: {
    resolveSiteContextRef: async () =>
      refOf("site-context", `site-context:${PROJECT_ID}`, digest("site-context-v1")),
    ensureTask: async (task) => {
      const agentTaskRef = agentTaskRefFor(RECOMMENDATION_TASK_TYPE_V1, task.actionId);
      return {
        kind: "completed",
        agentTaskRef,
        agentTaskResultRef: agentTaskResultRefFor({
          agentTaskRef,
          actionId: task.actionId,
          candidateRef: refOf(
            "recommendation-candidate",
            `recommendation-candidate:${agentTaskRef.reference.entityId}`,
            digest(`recommendation-candidate:${task.actionId}`),
          ),
        }),
      };
    },
  },
  responseLifecycle: {
    forecastResponse: async (command) => ({
      kind: "succeeded",
      result: {
        kind: "forecast",
        responseRecommendationRef: command.payload.binding.responseRecommendationRef,
        outcome: {
          availability: {
            kind: "available",
            effectForecastRef: refOf(
              "effect-forecast",
              `effect-forecast:${command.payload.binding.responseRecommendationRef.reference.entityId}`,
              digest("effect-forecast-v1"),
            ),
          },
        },
      },
    }),
    calculateDeviation: async (command) => {
      if (world.deviation === "unavailable") {
        return { kind: "unavailable", reasonCode: "insufficient-execution-evidence" };
      }
      const feedbackRef = command.payload.feedbackRef;
      return {
        kind: "succeeded",
        result: {
          fact: {
            schemaVersion: "1",
            projectId: PROJECT_ID,
            effectForecastRef: command.payload.effectForecastRef,
            feedbackRef,
            deviationValue: world.deviation === "exceeded" ? 0.42 : 0.05,
            thresholdValue: 0.2,
            thresholdExceeded: world.deviation === "exceeded",
            recordedAt: TIMESTAMP,
          },
          deviationFactRef: refOf(
            "response-deviation-fact",
            `response-deviation-fact:${feedbackRef.reference.entityId}`,
            digest(sha256CanonicalJson(command.payload)),
          ),
        },
      };
    },
  },
  calibration: {
    readCreatedDeviationRecordRef: async () =>
      DeviationRecordRefV1Schema.parse(
        refOf("deviation-record", `deviation-record:${PROJECT_ID}`, digest("deviation-record-v1")),
      ),
    prepareInput: async () => ({
      kind: "succeeded",
      result: {
        frozenInputRef: ContentArtifactRefV1Schema.parse(
          refOf(
            "content-artifact",
            `calibration-frozen-input:${PROJECT_ID}`,
            `sha256:${digest("calibration-frozen-input")}`,
          ),
        ),
        inputSnapshotRef: refOf(
          "calibration-input-snapshot",
          `calibration-input-snapshot:${PROJECT_ID}`,
          digest("calibration-input-snapshot-v1"),
        ),
        deviationRecordRef: DeviationRecordRefV1Schema.parse(
          refOf(
            "deviation-record",
            `deviation-record:${PROJECT_ID}`,
            digest("deviation-record-v1"),
          ),
        ),
        targetDefinitionType: "structured-scoring-rule",
      },
    }),
    createSuggestion: async (command) => {
      const suggestionRef = CalibrationSuggestionRefV1Schema.parse(
        refOf(
          "calibration-suggestion",
          `calibration-suggestion:${command.payload.agentTaskResultRef.agentTaskRef.reference.entityId}`,
          digest(sha256CanonicalJson(command.payload)),
        ),
      );
      return WarningResponseRecordResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "calibration",
          calibrationSuggestionRef: suggestionRef,
          reviewTaskRef: ReviewTaskRefV1Schema.parse({
            kind: "review-task",
            reference: versionRef(
              `calibration-review-task:${suggestionRef.reference.entityId}`,
              digest("calibration-review-task-v1"),
            ),
            reviewType: "calibration-suggestion",
            targetRef: suggestionRef,
            waitingRunRef: refOf(
              "workflow-run",
              `calibration-review-run:${PROJECT_ID}`,
              digest("review-run"),
            ),
          }),
        },
      });
    },
  },
  calibrationAgent: {
    ensureTask: async (task) => {
      if (world.calibrationAgent === "failed") {
        return { kind: "failed", reasonCode: "calibration-agent-terminal-failure" };
      }
      const agentTaskRef = agentTaskRefFor(CALIBRATION_AGENT_TASK_TYPE_V1, task.actionId);
      return {
        kind: "completed",
        agentTaskRef,
        agentTaskResultRef: agentTaskResultRefFor({
          agentTaskRef,
          actionId: task.actionId,
          candidateRef: refOf(
            "calibration-suggestion",
            `calibration-suggestion:${agentTaskRef.reference.entityId}`,
            digest(`calibration-suggestion:${task.actionId}`),
          ),
        }),
      };
    },
  },
  policies: {
    resolveForecastPolicy: async () => ({
      kind: "resolved",
      forecastPolicyRef: versionRef("forecast-policy"),
    }),
    resolveCalibrationPolicy: async () => ({
      kind: "resolved",
      targetReleaseRef: {
        kind: "knowledge-release",
        reference: versionRef("release-scoring-rule"),
      },
      calibrationValidationPolicyRef: versionRef("calibration-validation-policy"),
      agentPolicy: calibrationAgentPolicy(),
    }),
  },
});

/* -------------------------------------------------------------------------- */
/* 单容器装配                                                                    */
/* -------------------------------------------------------------------------- */

const artifactPolicy = (): ArtifactStorePolicyV1 => ({
  schemaVersion: "1",
  policyRef: versionRef("artifact-policy"),
  maxArtifactBytes: 512 * 1024 * 1024,
  maxConcurrentWrites: 4,
  maxConcurrentReads: 4,
  stagingMaxBytes: 768 * 1024 * 1024,
  orphanGracePeriodMs: 10_000,
  registrationTimeoutMs: 1_000,
  maintenanceBatchSize: 250,
});

interface AcceptanceHarnessV1 {
  readonly postgres: PostgresTestFixture;
  readonly app: PostgresRuntime;
  readonly access: ReturnType<typeof createAccess>;
  readonly world: AcceptanceWorldV1;
  readonly assessment: AssessmentGraphCompositionV1;
  readonly riskFlow: RiskFlowGraphCompositionV1;
  readonly assessmentRuntime: AssessmentGraphRuntimeV1;
  now(): Date;
  rows(runRef: WorkflowRunRefV1): Promise<readonly WorkflowGraphResultRowV1[]>;
  links(runRef: WorkflowRunRefV1): Promise<readonly { readonly relation: string }[]>;
  latestState(
    runRef: WorkflowRunRefV1,
  ): Promise<
    { readonly row: WorkflowGraphResultRowV1; readonly state: WorkflowGraphRunStateV1 } | undefined
  >;
  runResultBody(runRef: WorkflowRunRefV1): Promise<WorkflowGraphRunResultV1>;
  checkpointState(threadId: string): Promise<{
    readonly threadId: string | undefined;
    readonly next: unknown;
  }>;
  traceRead(
    riskRecordRefs: readonly StandardizedRiskRecordRefV1[],
  ): Promise<RiskRecordTraceReadResultV1>;
  /** 经真实 C22 适配器在 C03 事务内写入一条标准化风险记录（审计外键按 `commandId:audit` 对齐）。 */
  persistRecord(input: { readonly groupId: string }): Promise<StandardizedRiskRecordRefV1>;
  close(): Promise<void>;
}

const startHarness = async (): Promise<AcceptanceHarnessV1> => {
  const postgres = await startPostgresFixture();
  let rootDirectory: string | undefined;
  let artifactStore: Awaited<ReturnType<typeof createArtifactStore>> | undefined;
  let transactionUnit: ReturnType<typeof createPostgresTransactionUnit> | undefined;
  let app: PostgresRuntime | undefined;
  let checkpointer: Awaited<ReturnType<typeof setupPostgresCheckpointer>> | undefined;
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-acceptance-"));
    app = createPostgresRuntime(postgres.app, "riskflow_app");
    transactionUnit = createPostgresTransactionUnit(postgres.app);
    artifactStore = await createArtifactStore({
      ...postgres.app,
      rootDirectory,
      policy: artifactPolicy(),
    });
    checkpointer = await setupPostgresCheckpointer({
      ...postgres.checkpointer,
    });
    const world = createWorld();
    const access = createAccess();
    const clock = { current: new Date(TIMESTAMP) };
    const recordStore = createPostgresRiskCandidateFinalizationAdapter({
      db: app.db,
      transactionUnit,
      now: () => clock.current,
    });

    const persistRecord: AcceptanceHarnessV1["persistRecord"] = async (recordInput) => {
      const riskRecordRef = parseRef(
        StandardizedRiskRecordRefV1Schema,
        "standardized-risk-record",
        `standardized-risk-record:${PROJECT_ID}:${recordInput.groupId}`,
        digest(`risk-record:${recordInput.groupId}`),
      );
      const commandId = `c30-acceptance-record:${recordInput.groupId}`;
      const envelope: StandardizedRiskRecordEnvelope = StandardizedRiskRecordEnvelopeSchema.parse({
        riskRecordId: riskRecordRef.reference.entityId,
        record: {
          // 工序节点：与合成工序模型成员同一标识（逐跳可回指）。
          processNodeId: recordInput.groupId,
          riskSource: "source-synthetic-c30",
          riskFactor: "factor-synthetic-c30",
          riskEvent: "event-synthetic-c30",
          riskElementRelations: [
            {
              sourceElement: "source-synthetic-c30",
              relation: "causes",
              targetElement: "event-synthetic-c30",
            },
          ],
          evidenceLocator: { sourceSegmentId: `segment-${recordInput.groupId}` },
          modelConfidence: 0.82,
        },
        riskMechanismEntryIds: [`mechanism-${recordInput.groupId}`],
        sourceIds: [`segment-${recordInput.groupId}`],
        compositeConfidence: { value: 0.82, basis: ["model-confidence"] },
        version: {
          reference: riskRecordRef.reference,
          effectivePeriod: { validFrom: TIMESTAMP },
          systemTime: { recordedAt: TIMESTAMP },
        },
        audit: { actorId: ACTOR_ID, action: "identification.accept-groups", recordedAt: TIMESTAMP },
      });
      const writeRow = StandardizedRiskRecordWriteV1Schema.parse({
        riskRecordId: riskRecordRef.reference.entityId,
        versionId: riskRecordRef.reference.versionId,
        riskRecordRef,
        rowId: `${commandId}:row`,
        idempotencyKey: commandId,
        requestDigest: digest(sha256CanonicalJson(envelope)),
        projectId: PROJECT_ID,
        workPlanRef: refOf(
          "identification-work-plan",
          `identification-work-plan:${PROJECT_ID}:${recordInput.groupId}`,
          digest("work-plan-v1"),
        ),
        identificationRunRef: refOf(
          "workflow-run",
          `identification-run:${PROJECT_ID}:${recordInput.groupId}`,
          digest("identification-run-v1"),
        ),
        inputSnapshotRef: refOf(
          "identification-input-snapshot",
          `identification-input-snapshot:${PROJECT_ID}`,
          digest("input-snapshot-v1"),
        ),
        mergePlanRef: refOf(
          "merge-plan",
          `merge-plan:${PROJECT_ID}:${recordInput.groupId}`,
          digest("merge-plan-v1"),
        ),
        routeDecisionRef: refOf(
          "route-decision",
          `route-decision:${PROJECT_ID}:${recordInput.groupId}`,
          digest("route-decision-v1"),
        ),
        groupId: recordInput.groupId,
        groupVersionId: digest(`group-version:${recordInput.groupId}`),
        groupRef: refOf(
          "identification-group",
          `identification-group:${PROJECT_ID}:${recordInput.groupId}`,
          digest(`group:${recordInput.groupId}`),
        ),
        representativeCandidateRefs: [
          refOf(
            "content-artifact",
            `candidate-set:${PROJECT_ID}:${recordInput.groupId}`,
            `sha256:${digest(`candidate-set:${recordInput.groupId}`)}`,
          ),
        ],
        sourceSegmentIds: [`segment-${recordInput.groupId}`],
        mechanismEntryIds: [`mechanism-${recordInput.groupId}`],
        spatialScopeRefs: [refOf("spatial-scope", `spatial-scope-${recordInput.groupId}`)],
        sourceVersionRefs: [refOf("source-version", `source-version-${recordInput.groupId}`)],
        evidenceReferences: [
          {
            locator: { sourceSegmentId: `segment-${recordInput.groupId}` },
            sourceVersion: {
              entityId: `source-version-${recordInput.groupId}`,
              versionId: "v1",
            },
          },
        ],
        // 追溯读只按范围摘要对账：写侧与读侧使用同一工程空间/资料范围。
        authorizationScopeDigest: authorizationScopeDigest(TRACE_AUTHORIZATION),
        authorizationContextRef: TRACE_AUTHORIZATION.authorizationContextRef,
        actorRef: ACTOR_ID,
        commandId,
        occurredAt: TIMESTAMP,
      });
      await transactionUnit!.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "identification-candidate-finalization.accept-groups",
          commandId,
          idempotencyKey: commandId,
          payload: { groupId: recordInput.groupId },
          actorRef: ACTOR_ID,
          authorizationContextRef: TRACE_AUTHORIZATION.authorizationContextRef,
          issuedAt: TIMESTAMP,
        },
        async (context) => {
          const outcome = await recordStore.insertRecords(
            { rows: [writeRow], records: [envelope], occurredAt: TIMESTAMP },
            context,
          );
          if (outcome.kind === "conflict") {
            throw new TypeError(`standardized risk record conflict: ${outcome.detailCode}`);
          }
          return {
            resultRef: riskRecordRef,
            audit: {
              auditEntryId: `${commandId}:audit`,
              projectId: PROJECT_ID,
              action: "identification-candidate-finalization.accept-groups",
              targetRef: riskRecordRef,
              actorRef: ACTOR_ID,
              authorizationContextRef: TRACE_AUTHORIZATION.authorizationContextRef,
              occurredAt: TIMESTAMP,
              recordedAt: TIMESTAMP,
              version: riskRecordRef.reference,
              commandId,
              idempotencyKey: commandId,
              threadId: `identification-run-thread:${recordInput.groupId}`,
            },
            events: [],
          };
        },
      );
      return riskRecordRef;
    };

    const assessment = createAssessmentGraphComposition({
      db: app.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      runtimeAuthorization: access.runtimeAuthorization,
      checkpointer,
      ...createPortDoubles(world),
      now: () => clock.current,
    });

    /** C24 识别子图未在本单容器内装配：`assess`/`record-response-feedback` 入口不经过识别阶段。 */
    const identificationRuntimeUnavailable = {
      async start(): Promise<never> {
        throw new TypeError("C30 acceptance: the C24 identification runtime is not assembled here");
      },
      async resume(): Promise<never> {
        throw new TypeError("C30 acceptance: the C24 identification runtime is not assembled here");
      },
      async cancel(): Promise<never> {
        throw new TypeError("C30 acceptance: the C24 identification runtime is not assembled here");
      },
    };

    /** C41 人工采纳证明：本验收文件不演练等待/恢复门，注入缺失即失败关闭（不返回成功绑定）。 */
    const humanDecisionProofUnavailable = {
      async verifyHumanDecisionCommitted(
        query: Parameters<HumanDecisionProofPortV1["verifyHumanDecisionCommitted"]>[0],
      ): Promise<Awaited<ReturnType<HumanDecisionProofPortV1["verifyHumanDecisionCommitted"]>>> {
        return {
          kind: "failed",
          error: ModuleErrorV1Schema.parse({
            code: "TERMINAL_FAILURE",
            category: "technical",
            retryable: false,
            stageCode: "c30-acceptance-proof",
            occurredAt: query.requestedAt,
            causalRunId: query.projectId,
            diagnosticRef: {
              kind: "diagnostic-artifact",
              reference: { entityId: "human-decision-proof", versionId: "1" },
            },
          }),
        };
      },
    };

    const riskFlow = createRiskFlowGraphComposition({
      db: app.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      runtimeAuthorization: access.runtimeAuthorization,
      humanDecisionProof: humanDecisionProofUnavailable,
      checkpointer,
      identificationRuntime: identificationRuntimeUnavailable,
      assessmentRuntime: assessment.runtime,
      riskSpatialPairing: {
        async resolve(pairingInput) {
          return pairingInput.pairings[0]?.spatialScopeRef;
        },
      },
      retryPolicy: {
        async read(policyInput) {
          return policyInput.retryPolicyRef.reference.entityId === RETRY_POLICY_REF.entityId
            ? { maxAttempts: 3, backoffMs: 0 }
            : undefined;
        },
      },
      subGraphVersions: {
        identification: versionRef("identification-graph", "c30-acceptance"),
        assessment: ASSESSMENT_GRAPH_VERSION,
      },
      retryPolicyRef: RETRY_POLICY_REF,
      now: () => clock.current,
    });

    const traceReader = createPostgresRiskRecordTraceReader({
      db: app.db,
      authorization: access.port,
      now: () => clock.current,
    });
    const registrationStore = riskFlow.registrationStore;

    return {
      postgres,
      app,
      access,
      world,
      assessment,
      riskFlow,
      assessmentRuntime: assessment.runtime,
      now: () => clock.current,
      async rows(runRef) {
        return await registrationStore.listRunRows({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
          limit: 1_000,
        });
      },
      async links(runRef) {
        return await registrationStore.listRunLinks({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
          limit: 1_000,
        });
      },
      async latestState(runRef) {
        return await registrationStore.readLatestRunState({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
          actorId: ACTOR_ID,
          requestedAt: clock.current.toISOString(),
          invocationId: "risk-flow-cursor-read",
          authorization: AUTHORIZATION,
        });
      },
      async runResultBody(runRef) {
        const row = (
          await registrationStore.listRunRows({
            projectId: PROJECT_ID,
            runId: runRef.reference.entityId,
            limit: 1_000,
          })
        ).find((candidate) => candidate.resultKind === "run-result");
        if (row?.artifactRef === undefined) {
          throw new TypeError(`run-result body is missing for ${runRef.reference.entityId}`);
        }
        const body = await riskFlow.adapter.bodies.readBody({
          projectId: PROJECT_ID,
          artifactRef: row.artifactRef,
          actorId: ACTOR_ID,
          requestedAt: clock.current.toISOString(),
          invocationId: `c30-body-read:${PROJECT_ID}:${row.artifactRef.reference.entityId}`,
          requestedAt: clock.current.toISOString(),
          authorization: AUTHORIZATION,
        });
        if (body === undefined || body.bodyKind !== "run-result") {
          throw new TypeError("run-result body is unreadable");
        }
        return WorkflowGraphRunResultV1Schema.parse(body.runResult);
      },
      async checkpointState(threadId) {
        const snapshot = await assessment.graph.getState({ configurable: { thread_id: threadId } });
        const values = (snapshot as { readonly values?: unknown }).values;
        if (typeof values !== "object" || values === null) {
          throw new TypeError("checkpoint state is missing");
        }
        // 只取调用方可见事实：该线程的检查点身份与是否还有待执行节点。
        const config = (snapshot as { readonly config?: { readonly configurable?: unknown } })
          .config;
        const configurable = (config?.configurable ?? {}) as Record<string, unknown>;
        return {
          threadId: configurable.thread_id as string | undefined,
          next: (snapshot as { readonly next?: unknown }).next,
        };
      },
      async traceRead(riskRecordRefs) {
        return RiskRecordTraceReadResultV1Schema.parse(
          await traceReader.readBatch({
            projectId: PROJECT_ID,
            riskRecordRefs: [...riskRecordRefs],
            requestedAt: clock.current.toISOString(),
            invocationId: `trace-read:${PROJECT_ID}:acceptance`,
            branch: "projection.query",
            authorization: TRACE_AUTHORIZATION,
          }),
        );
      },
      persistRecord,
      async close() {
        await checkpointer?.end().catch(() => undefined);
        await artifactStore?.close().catch(() => undefined);
        await transactionUnit?.close().catch(() => undefined);
        await app?.close().catch(() => undefined);
        if (rootDirectory !== undefined) {
          await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await checkpointer?.end().catch(() => undefined);
    await artifactStore?.close().catch(() => undefined);
    await transactionUnit?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    if (rootDirectory !== undefined) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

let harness: AcceptanceHarnessV1;

beforeAll(async () => {
  harness = await startHarness();
}, 300_000);

afterAll(async () => {
  await harness?.close();
});

/* -------------------------------------------------------------------------- */
/* 用例脚手架                                                                    */
/* -------------------------------------------------------------------------- */

/** 每轮用例重置端口行为开关与调用记录：本轮替身返回哪种闭合结果由用例自己声明。 */
const resetWorld = (input: Partial<Omit<AcceptanceWorldV1, "calls" | "clock">> = {}) => {
  harness.world.warning = input.warning ?? "triggers";
  harness.world.recommendation = input.recommendation ?? "recorded";
  harness.world.deviation = input.deviation ?? "exceeded";
  harness.world.calibrationAgent = input.calibrationAgent ?? "completed";
  harness.world.basisResolution = input.basisResolution ?? "succeeded";
  for (const calls of Object.values(harness.world.calls)) calls.length = 0;
};

interface ParentCaseV1 {
  readonly seed: string;
  readonly entryMode: WorkflowEntryModeV1;
  readonly runRef: WorkflowRunRefV1;
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly riskRecordRef: StandardizedRiskRecordRefV1;
  readonly command: StartWorkflowRunCommandV1;
}

/** 父运行入口身份：与 C30 运行时公开入口同一算式（用例据此断言父子引用）。 */
const parentCaseFor = (seed: string, entryMode: "assess"): ParentCaseV1 => {
  const projectRevisionRef = parseRef(
    ProjectRevisionRefV1Schema,
    "project-revision",
    `project-revision:${PROJECT_ID}`,
    digest(seed),
  );
  const monitoringSnapshotRef = parseRef(
    MonitoringSnapshotRefV1Schema,
    "monitoring-snapshot",
    `monitoring:${PROJECT_ID}:${seed}`,
    digest(`monitoring:${seed}`),
  );
  const riskRecordRef = parseRef(
    StandardizedRiskRecordRefV1Schema,
    "standardized-risk-record",
    `standardized-risk-record:${PROJECT_ID}:${PROCESS_NODE_ID}`,
    digest(`risk-record:${PROCESS_NODE_ID}`),
  );
  const payload = {
    entryMode,
    graphVersion: RISK_FLOW_GRAPH_VERSION,
    retryPolicyRef: RETRY_POLICY_REF,
    riskInput: riskRecordRef,
    applicabilityMetadataSnapshotRef: APPLICABILITY_REF,
    monitoringSnapshotRef,
    spatialScopeRef: SPATIAL_SCOPE_REF,
    projectRevisionRef,
  };
  const frozenRefs: ContractReferenceV1[] = [
    projectRevisionRef,
    SPATIAL_SCOPE_REF,
    APPLICABILITY_REF,
    riskRecordRef,
    monitoringSnapshotRef,
  ];
  const entryIdentity = workflowEntryIdentityFor({
    entryMode,
    projectId: PROJECT_ID,
    frozenRefs,
  });
  const runRef = workflowRunIdentityFor({
    projectId: PROJECT_ID,
    entryMode,
    entryIdentity,
    graphVersion: RISK_FLOW_GRAPH_VERSION,
  }).runRef;
  return {
    seed,
    entryMode,
    runRef,
    entryIdentity,
    frozenRefs,
    riskRecordRef,
    command: {
      kind: "start-run",
      commandId: `c30-acceptance-start:${seed}`,
      idempotencyKey: `c30-acceptance-start:${seed}`,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      payload,
    },
  };
};

/** 父图内派生的评估子运行身份（用例据此定位子运行并断言逐跳引用）。 */
const childRunRefOf = (parentCase: ParentCaseV1): WorkflowRunRefV1 =>
  segmentedAssessmentSubRunIdentityFor({
    projectId: PROJECT_ID,
    parentRunRef: parentCase.runRef,
    entryMode: parentCase.entryMode,
    entryIdentity: parentCase.entryIdentity,
  }).runRef;

describe("C30 全链验收（真实 PostgreSQL + 真实 C03/C04/checkpointer + 真实 C30 父/评估图 + 真实 C22）", () => {
  it("R6/S1 完整链路耐久证据：资料段→工序→机理→标准化记录→评估→预警→建议逐跳可核验，重放不增正式事实", async () => {
    resetWorld();
    const riskRecordRef = await harness.persistRecord({ groupId: PROCESS_NODE_ID });
    const parentCase = parentCaseFor("r6s1", "assess");

    const started = await harness.riskFlow.runtime.workflowPort.startRun(parentCase.command);
    expect(started.kind).toBe("succeeded");
    if (started.kind !== "succeeded") throw new TypeError("the parent run must start");
    expect(started.result.workflowRunRef).toEqual(parentCase.runRef);
    const parentState = await harness.latestState(parentCase.runRef);
    expect(parentState?.state.status).toBe("completed");
    expect(parentState?.state.stage).toBe("result-summary");
    const childRunRef = childRunRefOf(parentCase);
    expect(parentState?.state.assessmentRunRefs).toEqual([childRunRef]);

    // ① 资料段/工序/机理/标准化记录：真实 C22 行 + IP-07 追溯读，逐跳回指同一标识。
    const trace = await harness.traceRead([riskRecordRef]);
    expect(trace).toEqual({
      kind: "succeeded",
      items: [
        {
          kind: "found",
          riskRecordRef,
          processNodeId: PROCESS_NODE_ID,
          sourceSegmentIds: [SOURCE_SEGMENT_ID],
          riskMechanismEntryIds: [MECHANISM_ENTRY_ID],
          evidenceLocator: { sourceSegmentId: SOURCE_SEGMENT_ID },
          auditTrailRef: {
            kind: "audit-trail",
            reference: {
              entityId: `c30-acceptance-record:${PROCESS_NODE_ID}:audit`,
              versionId: "v1",
            },
          },
        },
      ],
    });

    // ② 评估/预警/建议：父运行汇总正文逐跳引用子运行已登记的精确事实。
    const parentResult = await harness.runResultBody(parentCase.runRef);
    expect(parentResult.assessmentRunRefs).toEqual([childRunRef]);
    expect(parentResult.assessmentRecordRefs).toHaveLength(1);
    expect(parentResult.warningRecordRefs).toHaveLength(1);
    expect(parentResult.responseRecommendationRefs).toHaveLength(1);
    expect(parentResult.skippedTails).toEqual([]);

    const childState = await harness.latestState(childRunRef);
    expect(childState?.state.status).toBe("completed");
    expect(childState?.state.stage).toBe("A9");
    expect(childState?.state.assessmentRecordRefs).toEqual(parentResult.assessmentRecordRefs);
    expect(childState?.state.warningRecordRefs).toEqual(parentResult.warningRecordRefs);
    expect(childState?.state.responseRecommendationRefs).toEqual(
      parentResult.responseRecommendationRefs,
    );

    // ③ 链边：父→子、风险输入→评估记录、评估记录→预警、预警任务→正式建议，逐边带阶段与审计身份。
    const childLinks = await harness.links(childRunRef);
    expect([...new Set(childLinks.map((link) => link.relation))].sort()).toEqual([
      "assessment-warning",
      "risk-assessment",
      "run-stage",
      "warning-recommendation",
    ]);
    const riskAssessmentLink = childLinks.find((link) => link.relation === "risk-assessment");
    expect(riskAssessmentLink?.fromRef).toEqual(parentCase.riskRecordRef);
    expect(childLinks.find((link) => link.relation === "warning-recommendation")?.toRef).toEqual(
      parentResult.responseRecommendationRefs[0],
    );
    expect(new Set((await harness.links(parentCase.runRef)).map((link) => link.relation))).toEqual(
      new Set(["parent-child", "run-stage"]),
    );

    // ④ 阶段结果与审计：A0～A9 全序列登记在同一事务面上，每一步都带审计身份。
    const childRows = await harness.rows(childRunRef);
    expect(
      childRows.filter((row) => row.resultKind === "stage-result").map((row) => row.stage),
    ).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]);
    expect(childRows.filter((row) => row.auditEntryId.length === 0)).toEqual([]);
    expect(childRows.filter((row) => row.resultKind === "workflow-error")).toEqual([]);
    const entryRow = childRows.find((row) => row.resultKind === "entry-snapshot");
    expect(entryRow?.entryIdentity?.versionId).toBeDefined();
    expect(entryRow?.frozenRefs.length).toBeGreaterThan(0);

    // ⑤ 重放：重复公开入口不增加正式事实，也不改变已登记评估记录与汇总正文。
    const rowsBeforeReplay = await harness.rows(parentCase.runRef);
    const childRowsBeforeReplay = await harness.rows(childRunRef);
    const replayed = await harness.riskFlow.runtime.workflowPort.startRun(parentCase.command);
    expect(replayed.kind).toBe("succeeded");
    if (replayed.kind !== "succeeded") throw new TypeError("replayed start must succeed");
    expect(replayed.result.disposition).toBe("existing");
    expect(await harness.rows(parentCase.runRef)).toEqual(rowsBeforeReplay);
    expect(await harness.rows(childRunRef)).toEqual(childRowsBeforeReplay);
    expect(await harness.runResultBody(parentCase.runRef)).toEqual(parentResult);

    // ⑥ 检查点与业务事实对账：checkpoint 只承载小型公共状态，业务状态以登记行为准。
    const checkpoint = await harness.checkpointState(
      segmentedAssessmentSubRunIdentityFor({
        projectId: PROJECT_ID,
        parentRunRef: parentCase.runRef,
        entryMode: parentCase.entryMode,
        entryIdentity: parentCase.entryIdentity,
      }).threadId,
    );
    const childThreadId = segmentedAssessmentSubRunIdentityFor({
      projectId: PROJECT_ID,
      parentRunRef: parentCase.runRef,
      entryMode: parentCase.entryMode,
      entryIdentity: parentCase.entryIdentity,
    }).threadId;
    expect(checkpoint.threadId).toBe(childThreadId);
    // 已无待执行节点：图已收口（业务终态与阶段以登记行为准）。
    expect(checkpoint.next).toEqual([]);
  }, 300_000);

  it("R3/S2 有预警时依次形成处置链：先持久化预警与任务引用，三项校验通过后才有正式建议", async () => {
    resetWorld({ warning: "triggers", recommendation: "recorded" });
    await harness.persistRecord({ groupId: PROCESS_NODE_ID });
    const parentCase = parentCaseFor("r3s2", "assess");
    await harness.riskFlow.runtime.workflowPort.startRun(parentCase.command);

    const childRunRef = childRunRefOf(parentCase);
    expect(childRunRef.reference.entityId).toContain("assessment-run:");
    const childState = await harness.latestState(childRunRef);
    expect(childState?.state.status).toBe("completed");
    expect(childState?.state.warningRecordRefs).toHaveLength(1);
    expect(childState?.state.responseRecommendationRefs).toHaveLength(1);

    // 预警先成立于评估记录之上（A6 的输入就是已提交的评估记录）。
    const warningOpen = harness.world.calls.warningOpen[0] as OpenWarningCommandV1;
    expect(warningOpen.payload.assessmentRecordRef).toEqual(
      childState?.state.assessmentRecordRefs[0],
    );
    const childRows = await harness.rows(childRunRef);
    expect(childRows.some((row) => row.resultKind === "stage-result" && row.stage === "A6")).toBe(
      true,
    );
    // 候选（A7）与正式建议（A8）是两个不同阶段的精确事实。
    const a7 = childRows.find((row) => row.resultKind === "stage-result" && row.stage === "A7");
    const a8 = childRows.find((row) => row.resultKind === "stage-result" && row.stage === "A8");
    expect(a7?.stageResultRef).not.toEqual(a8?.stageResultRef);
    expect((await harness.runResultBody(parentCase.runRef)).responseRecommendationRefs).toEqual(
      childState?.state.responseRecommendationRefs,
    );
  }, 300_000);

  it("R3/S2+R6/S2 三项约束失败：只留候选与类型化失败原因，不伪造正式建议链尾", async () => {
    resetWorld({ warning: "triggers", recommendation: "validation-rejected" });
    await harness.persistRecord({ groupId: PROCESS_NODE_ID });
    const parentCase = parentCaseFor("r3s2-rejected", "assess");
    await harness.riskFlow.runtime.workflowPort.startRun(parentCase.command);

    const childRunRef = childRunRefOf(parentCase);
    expect(childRunRef.reference.entityId).toContain("assessment-run:");
    const childState = await harness.latestState(childRunRef);
    expect(childState?.state.status).toBe("completed");
    expect(childState?.state.warningRecordRefs).toHaveLength(1);
    expect(childState?.state.responseRecommendationRefs).toEqual([]);

    const parentResult = await harness.runResultBody(parentCase.runRef);
    expect(parentResult.responseRecommendationRefs).toEqual([]);
    // 父运行汇总镜像子运行登记的缺席链尾（不补造占位事实）。
    const childResult = await harness.runResultBody(childRunRef);
    expect(
      parentResult.skippedTails.map(({ tailKind, reasonCode }) => ({ tailKind, reasonCode })),
    ).toEqual(
      childResult.skippedTails.map(({ tailKind, reasonCode }) => ({ tailKind, reasonCode })),
    );
    expect(
      childResult.skippedTails.map(({ tailKind, reasonCode }) => ({ tailKind, reasonCode })),
    ).toEqual([{ tailKind: "recommendation", reasonCode: "recommendation-validation-rejected" }]);
    const childRows = await harness.rows(childRunRef);
    const skipRow = childRows.find((row) => row.resultKind === "workflow-error");
    expect(skipRow?.workflowErrorRef?.reference.entityId).toBe(
      "assessment-graph-skip:recommendation:recommendation-validation-rejected",
    );
    expect((await harness.links(childRunRef)).map((link) => link.relation)).not.toContain(
      "warning-recommendation",
    );
  }, 300_000);

  it("R6/S2 无触发：评估记录成立但零预警/建议链边，缺席原因进入运行汇总", async () => {
    resetWorld({ warning: "none" });
    await harness.persistRecord({ groupId: PROCESS_NODE_ID });
    const parentCase = parentCaseFor("r6s2-no-trigger", "assess");
    await harness.riskFlow.runtime.workflowPort.startRun(parentCase.command);

    const childRunRef = childRunRefOf(parentCase);
    const childState = await harness.latestState(childRunRef);
    expect(childState?.state.assessmentRecordRefs).toHaveLength(1);
    expect(childState?.state.warningRecordRefs).toEqual([]);
    expect(childState?.state.responseRecommendationRefs).toEqual([]);

    const parentResult = await harness.runResultBody(parentCase.runRef);
    // 父运行汇总镜像子运行登记的缺席链尾（不补造占位事实）。
    const childResult = await harness.runResultBody(childRunRef);
    expect(
      parentResult.skippedTails.map(({ tailKind, reasonCode }) => ({ tailKind, reasonCode })),
    ).toEqual(
      childResult.skippedTails.map(({ tailKind, reasonCode }) => ({ tailKind, reasonCode })),
    );
    expect(
      childResult.skippedTails.map(({ tailKind, reasonCode }) => ({ tailKind, reasonCode })),
    ).toEqual([
      { tailKind: "warning", reasonCode: "no-trigger-indicators" },
      { tailKind: "recommendation", reasonCode: "recommendation-not-established" },
    ]);
    const relations = (await harness.links(childRunRef)).map((link) => link.relation);
    expect(relations).not.toContain("assessment-warning");
    expect(relations).not.toContain("warning-recommendation");
    expect(harness.world.calls.warningOpen).toHaveLength(1);
  }, 300_000);

  it("R3/S4 反馈越限：正式反馈后偏差越限只形成待人工审核的校准建议，链边逐跳可查", async () => {
    resetWorld({ deviation: "exceeded", calibrationAgent: "completed" });
    const basisReleaseSetRef = parseRef(
      AssessmentBasisReleaseSetRefV1Schema,
      "assessment-basis-release-set",
      `assessment-basis:${PROJECT_ID}`,
      digest("basis-feedback-exceeded"),
    );
    const assessmentInputSnapshotRef = refOf(
      "assessment-input-snapshot",
      `assessment-input:${PROJECT_ID}`,
      digest("input-snapshot-feedback-exceeded"),
    );
    const effectForecastRef = refOf(
      "effect-forecast",
      `effect-forecast:${PROJECT_ID}`,
      digest("effect-forecast-feedback-exceeded"),
    );
    const feedbackRef = refOf("feedback", `feedback:${PROJECT_ID}`, digest("feedback-exceeded"));
    const executionRecordRef = refOf(
      "execution-record",
      `execution-record:${PROJECT_ID}`,
      digest("execution-record-exceeded"),
    );
    const frozenRefs: ContractReferenceV1[] = [
      basisReleaseSetRef,
      assessmentInputSnapshotRef,
      effectForecastRef,
      feedbackRef,
      executionRecordRef,
    ];
    const outcome = await harness.assessmentRuntime.start(
      segmentedAssessmentCommand({
        parentRunRef: refOf(
          "workflow-run",
          `risk-flow-run:${PROJECT_ID}:assess`,
          digest("parent-feedback"),
        ),
        entryMode: "record-response-feedback",
        frozenRefs,
      }),
    );
    expect(outcome.disposition).toBe("created");
    expect(outcome.status).toBe("completed");
    const rows = await harness.rows(outcome.runRef);
    // 校准路径只在 A1 与 A9 写阶段结果（A2/A3/A4 只推进游标），阶段推进可从游标行读到。
    expect(rows.filter((row) => row.resultKind === "stage-result").map((row) => row.stage)).toEqual(
      ["A1", "A9"],
    );
    expect(rows.filter((row) => row.resultKind === "run-state").map((row) => row.stage)).toEqual(
      expect.arrayContaining(["A2", "A3", "A4"]),
    );
    const ownedRunRef = outcome.runRef as WorkflowRunRefV1;
    const latest = await harness.latestState(ownedRunRef);
    expect(latest?.state.deviationRecordRefs).toHaveLength(1);
    expect(latest?.state.calibrationSuggestionRefs).toHaveLength(1);
    // 只形成待人工审核的建议（游标里只有建议引用，无自动发布）：复核任务引用属于图状态通道，
    // 由运行状态的可观察事实（建议引用存在且阶段停在 A9）与本用例的 review Task 链边共同证明。

    const links = await harness.links(outcome.runRef);
    expect([...new Set(links.map((link) => link.relation))].sort()).toEqual([
      "deviation-calibration",
      "feedback-deviation",
      "run-stage",
    ]);
    expect(links.find((link) => link.relation === "feedback-deviation")?.fromRef).toEqual(
      feedbackRef,
    );
    expect(links.find((link) => link.relation === "deviation-calibration")?.toRef).toEqual(
      latest?.state.calibrationSuggestionRefs[0],
    );
    const runResult = await harness.runResultBody(outcome.runRef);
    expect(runResult.calibrationSuggestionRefs).toEqual(latest?.state.calibrationSuggestionRefs);
    expect(runResult.skippedTails).toEqual([]);
  }, 300_000);

  it("R1/S5 公共预测与反馈入口缺冻结依据时在父运行副作用前拒绝", async () => {
    resetWorld();
    const recommendationRef = refOf(
      "response-recommendation",
      `response-recommendation:${PROJECT_ID}`,
      digest("recommendation-public"),
    );
    const preActionMonitoringSnapshotRef = refOf(
      "monitoring-snapshot",
      `monitoring:${PROJECT_ID}`,
      digest("monitoring-public"),
    );
    const executionRecordRef = refOf(
      "execution-record",
      `execution-record:${PROJECT_ID}`,
      digest("execution-record-public"),
    );
    const feedbackRef = refOf("feedback", `feedback:${PROJECT_ID}`, digest("feedback-public"));
    const forecastRef = refOf(
      "effect-forecast",
      `effect-forecast:${PROJECT_ID}`,
      digest("effect-forecast-public"),
    );
    for (const [entryMode, refs] of [
      ["forecast-response", [recommendationRef, preActionMonitoringSnapshotRef]],
      ["record-response-feedback", [executionRecordRef, feedbackRef, forecastRef]],
    ] as const) {
      const payload =
        entryMode === "forecast-response"
          ? {
              entryMode,
              graphVersion: RISK_FLOW_GRAPH_VERSION,
              retryPolicyRef: RETRY_POLICY_REF,
              adoptedRecommendationRef: recommendationRef,
              preActionMonitoringSnapshotRef,
            }
          : {
              entryMode,
              graphVersion: RISK_FLOW_GRAPH_VERSION,
              retryPolicyRef: RETRY_POLICY_REF,
              executionRecordRef,
              feedbackRef,
              forecastRef,
            };
      const started = await harness.riskFlow.runtime.workflowPort.startRun({
        kind: "start-run",
        commandId: `c30-acceptance-${entryMode}-missing-basis`,
        idempotencyKey: `c30-acceptance-${entryMode}-missing-basis`,
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        issuedAt: TIMESTAMP,
        authorization: AUTHORIZATION,
        payload,
      });
      expect(started.kind).toBe("failed");
      if (started.kind !== "failed") throw new TypeError("public segmented entry must fail");
      expect(started.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "assessment-basis-missing",
        stageCode: "entry-gate",
      });
      const entryIdentity = workflowEntryIdentityFor({
        entryMode,
        projectId: PROJECT_ID,
        frozenRefs: refs,
      });
      const runRef = workflowRunIdentityFor({
        projectId: PROJECT_ID,
        entryMode,
        entryIdentity,
        graphVersion: RISK_FLOW_GRAPH_VERSION,
      }).runRef;
      expect(await harness.rows(runRef)).toEqual([]);
    }
  }, 300_000);

  it("R6/S2 偏差不可计算：保留最后成立事实与类型化原因，不生成校准链尾", async () => {
    resetWorld({ deviation: "unavailable" });
    const frozenRefs: ContractReferenceV1[] = [
      parseRef(
        AssessmentBasisReleaseSetRefV1Schema,
        "assessment-basis-release-set",
        `assessment-basis:${PROJECT_ID}`,
        digest("basis-feedback"),
      ),
      refOf(
        "assessment-input-snapshot",
        `assessment-input:${PROJECT_ID}`,
        digest("input-snapshot-feedback"),
      ),
      refOf("effect-forecast", `effect-forecast:${PROJECT_ID}`, digest("effect-forecast-feedback")),
      refOf("feedback", `feedback:${PROJECT_ID}`, digest("feedback-v1")),
      refOf("execution-record", `execution-record:${PROJECT_ID}`, digest("execution-record-v1")),
    ];
    const outcome = await harness.assessmentRuntime.start(
      segmentedAssessmentCommand({
        parentRunRef: refOf(
          "workflow-run",
          `risk-flow-run:${PROJECT_ID}:assess`,
          digest("parent-deviation-unavailable"),
        ),
        entryMode: "record-response-feedback",
        frozenRefs,
      }),
    );

    expect(outcome.status).toBe("completed");
    expect(outcome.stage).toBe("A9");
    const latest = await harness.latestState(outcome.runRef);
    expect(latest?.state.deviationRecordRefs).toEqual([]);
    expect(latest?.state.calibrationSuggestionRefs).toEqual([]);
    const rows = await harness.rows(outcome.runRef);
    // 分段入口不产生 A0 阶段结果（无对应公共变体），偏差不可计算时 A2 直接收口到 A9。
    expect(rows.filter((row) => row.resultKind === "stage-result").map((row) => row.stage)).toEqual(
      ["A1", "A9"],
    );
    expect(
      rows.find((row) => row.resultKind === "workflow-error")?.workflowErrorRef?.reference.entityId,
    ).toBe("assessment-graph-skip:deviation:insufficient-execution-evidence");
    const relations = (await harness.links(outcome.runRef)).map((link) => link.relation);
    expect(relations).not.toContain("feedback-deviation");
    expect(relations).not.toContain("deviation-calibration");
  }, 300_000);

  it("R6/S2 校准 Agent 失败：保留偏差事实与类型化原因，不生成公共偏差与校准建议", async () => {
    resetWorld({ deviation: "exceeded", calibrationAgent: "failed" });
    const frozenRefs: ContractReferenceV1[] = [
      parseRef(
        AssessmentBasisReleaseSetRefV1Schema,
        "assessment-basis-release-set",
        `assessment-basis:${PROJECT_ID}`,
        digest("basis-agent-failed"),
      ),
      refOf(
        "assessment-input-snapshot",
        `assessment-input:${PROJECT_ID}`,
        digest("input-snapshot-agent-failed"),
      ),
      refOf(
        "effect-forecast",
        `effect-forecast:${PROJECT_ID}`,
        digest("effect-forecast-agent-failed"),
      ),
      refOf("feedback", `feedback:${PROJECT_ID}`, digest("feedback-agent-failed")),
      refOf(
        "execution-record",
        `execution-record:${PROJECT_ID}`,
        digest("execution-record-agent-failed"),
      ),
    ];
    const outcome = await harness.assessmentRuntime.start(
      segmentedAssessmentCommand({
        parentRunRef: refOf(
          "workflow-run",
          `risk-flow-run:${PROJECT_ID}:assess`,
          digest("parent-agent-failed"),
        ),
        entryMode: "record-response-feedback",
        frozenRefs,
      }),
    );

    expect(outcome.status).toBe("completed");
    const latest = await harness.latestState(outcome.runRef);
    expect(latest?.state.deviationRecordRefs).toEqual([]);
    expect(latest?.state.calibrationSuggestionRefs).toEqual([]);
    const rows = await harness.rows(outcome.runRef);
    expect(
      rows.find(
        (row) =>
          row.resultKind === "workflow-error" &&
          row.workflowErrorRef?.reference.entityId.startsWith(
            "assessment-graph-skip:calibration:",
          ) === true,
      )?.workflowErrorRef?.reference.entityId,
    ).toBe("assessment-graph-skip:calibration:calibration-agent-terminal-failure");
    const relations = (await harness.links(outcome.runRef)).map((link) => link.relation);
    expect(relations).not.toContain("feedback-deviation");
    expect(relations).not.toContain("deviation-calibration");
  }, 300_000);

  it("R6/S2 依据解析不可用：评估子运行以类型化失败收口，父运行零评估事实", async () => {
    resetWorld({ basisResolution: "unavailable" });
    await harness.persistRecord({ groupId: PROCESS_NODE_ID });
    const parentCase = parentCaseFor("r6s2-basis-unavailable", "assess");
    await harness.riskFlow.runtime.workflowPort.startRun(parentCase.command);

    const childRunRef = childRunRefOf(parentCase);
    const childState = await harness.latestState(childRunRef);
    // C17 依据解析是技术端口：C19 缺规则集已由解析侧自动组装，这里保住的是上游自身
    // 可重试的瞬时失败语义，既不当作「缺项等待」也不冒充终态失败。
    expect(childState?.state.status).toBe("retryable-failure");
    const childRows = await harness.rows(childRunRef);
    expect(
      childRows.find((row) => row.resultKind === "workflow-error")?.workflowErrorRef?.reference
        .entityId,
    ).toBe("assessment-graph-workflow-error:A1:TRANSIENT_FAILURE");
    const parentState = await harness.latestState(parentCase.runRef);
    expect(parentState?.state.status).toBe("retryable-failure");
    expect(parentState?.state.lastErrorRef).toEqual(childState?.state.lastErrorRef);
    expect(parentState?.state.assessmentRunRefs).toEqual([childRunRef]);
    expect(parentState?.state.assessmentRecordRefs).toEqual([]);
    expect(parentState?.state.warningRecordRefs).toEqual([]);
    expect(parentState?.state.responseRecommendationRefs).toEqual([]);
    const parentRows = await harness.rows(parentCase.runRef);
    expect(parentRows.filter((row) => row.resultKind === "workflow-error")).toEqual([]);
    expect(parentRows.filter((row) => row.resultKind === "run-result")).toEqual([]);
  }, 300_000);
});

/**
 * 评估子运行启动命令（与父图内的同一算式）：供分段入口用例直接驱动真实评估运行面。
 */
function segmentedAssessmentCommand(input: {
  readonly parentRunRef: WorkflowRunRefV1;
  readonly entryMode: Extract<WorkflowEntryModeV1, "assess" | "record-response-feedback">;
  readonly frozenRefs: readonly ContractReferenceV1[];
}): WorkflowGraphRunCommandV1 {
  const entryIdentity = workflowEntryIdentityFor({
    entryMode: input.entryMode,
    projectId: PROJECT_ID,
    frozenRefs: input.frozenRefs,
  });
  const identity = segmentedAssessmentSubRunIdentityFor({
    projectId: PROJECT_ID,
    parentRunRef: input.parentRunRef,
    entryMode: input.entryMode,
    entryIdentity,
  });
  const commandId = `c30-acceptance-assessment:${identity.runRef.reference.versionId}`;
  return {
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    authorization: AUTHORIZATION,
    commandId,
    issuedInvocationId: commandId,
    authorizationBranch: "workflow.start-run",
    idempotencyKey: commandId,
    issuedAt: TIMESTAMP,
    validAt: TIMESTAMP,
    graphVersion: ASSESSMENT_GRAPH_VERSION,
    retryPolicyRef: RETRY_POLICY_REF,
    runRef: identity.runRef,
    threadId: identity.threadId,
    entryMode: input.entryMode,
    entryIdentity,
    frozenRefs: input.frozenRefs,
    parentRunRef: input.parentRunRef,
  };
}
