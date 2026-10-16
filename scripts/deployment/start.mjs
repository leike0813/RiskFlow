#!/usr/bin/env node
import {
  readFile,
  lstat,
  realpath,
  open,
  mkdir,
  rename,
  unlink,
  access as accessFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, TextDecoder, TextEncoder, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { setInterval, clearInterval } from "node:timers";
import { AsyncLocalStorage } from "node:async_hooks";
import { SourceOriginalReaderV1 } from "../../packages/adapters/dist/engineering-data/context-source/index.js";
import { DomainEventV1Schema } from "../../packages/contracts/dist/events/index.js";
import {
  AuthorizationContextV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  WorkflowRunRefV1Schema,
  CommandCausalRefV1Schema,
} from "../../packages/contracts/dist/ports/index.js";
import {
  IdentificationGraphStateV1Schema,
  AssessmentGraphStateV1Schema,
  RiskFlowGraphStateV1Schema,
} from "../../packages/contracts/dist/workflows/index.js";
import {
  CheckpointRuntimeContextV1Schema,
  ConsumerResultV1Schema,
} from "../../packages/core/dist/persistence/index.js";
import { withDataCleaningModelStep } from "../../apps/worker/dist/index.js";
import {
  createAgentRuntimeRunner,
  KnowledgeAuthoringRunner,
  consumeWarningRecordedForInAppNotification,
} from "../../apps/worker/dist/index.js";
import {
  AgentTaskDefinitionRegistry,
  AgentRuntimeError,
} from "../../packages/core/dist/agent-runtime/index.js";
import { PostgresAgentTaskAdapter } from "../../packages/adapters/dist/agent-runtime/index.js";
import { createPostgresReviewAuditAdapter } from "../../packages/adapters/dist/review-audit/index.js";
import { createPostgresWorkflowAdapter } from "../../packages/adapters/dist/workflow/index.js";
import {
  createDeploymentIdentificationV1,
  createDeploymentAcceptanceRoutesV1,
} from "./composition/identification.mjs";
import {
  createDeploymentAssessmentV1,
  createDeploymentAssessmentGraphPoliciesV1,
  createDeploymentRecommendationAgentV1,
  createDeploymentCalibrationAgentV1,
} from "./composition/assessment.mjs";
import { createDeploymentCalibrationTaskPortV1 } from "./composition/calibration-task.mjs";
import {
  createDeploymentRiskFlowV1,
  createDeploymentHumanDecisionFeedbackV1,
  createDeploymentRiskSpatialPairingV1,
  createDeploymentRiskFlowEventConsumerV1,
} from "./composition/risk-flow.mjs";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  makeArtifactError,
} from "../../packages/core/dist/artifacts/index.js";
import {
  StructuredCompletionRequestV1Schema,
  EmbeddingRequestV1Schema,
  ConversationRequestV1Schema,
  ModelGatewayError,
  modelGatewayError,
} from "../../packages/core/dist/model/index.js";
import {
  createNetworkApiModelGateway,
  createLlamaCppModelGateway,
} from "../../packages/adapters/dist/model/index.js";

import {
  createPostgresRuntime,
  createPostgresTransactionUnit,
  createPostgresCheckpointer,
  createPostgresIdempotentConsumer,
  createPostgresOutbox,
} from "../../packages/adapters/dist/postgres/index.js";
import { AccessServiceError } from "../../packages/core/dist/access/index.js";
import {
  createPostgresLocalIdentityAccess,
  createDeploymentAuthorizationAdapterV1,
  DeploymentAuthorizationError,
} from "../../packages/adapters/dist/auth/index.js";
import {
  createContentAddressedArtifactStore,
  assertArtifactAccess,
} from "../../packages/adapters/dist/artifacts/index.js";
import { createPostgresAssessmentConfigurationAdapter } from "../../packages/adapters/dist/assessment-config/index.js";
import { createPostgresScoringRulesAdapter } from "../../packages/adapters/dist/scoring-rules/index.js";
import { governedReleaseResolutionInvocationId } from "../../packages/adapters/dist/knowledge-governance/index.js";
import { SingleBindingV1 } from "./runtime.mjs";
import { buildApi } from "../../apps/api/dist/index.js";
import { createDeploymentApiPortsV1 } from "./composition/api-ports.mjs";
import {
  ApiLifecycleV1,
  WorkerLifecycleV1,
  LifecycleStateV1,
  safeLogRecordV1,
} from "./lifecycle.mjs";
import { OutboxDispatchRegistryV1, UnknownOutboxEventError } from "./events.mjs";
import { createPostgresRiskRecordTraceReader } from "../../packages/adapters/dist/identification/candidate-finalization/index.js";
import { createPostgresOfficialHybridResultReader } from "../../packages/adapters/dist/identification/context/index.js";
import {
  DeploymentConfigV1Schema,
  ReleaseManifestV1Schema,
  assertCompatibleMigrationVersion,
  createDeploymentSecretFileLoaderV1,
  DeploymentPolicyCatalogV1Schema,
  createDeploymentPolicyCatalogReaderV1,
  DeploymentRetrievalDatasetV1Schema,
} from "../../packages/adapters/dist/deployment/index.js";
import { HybridRetrievalAcceptanceReportV1Schema } from "../../packages/core/dist/retrieval/index.js";
import {
  PostgresRetrievalAdapter,
  QdrantRetrievalProjection,
} from "../../packages/adapters/dist/retrieval/index.js";
import { createDeploymentBuildQualityGateV1 } from "./composition/quality-gate.mjs";
import { createDeploymentMeasureReleaseReaderV1 } from "./composition/assessment.mjs";
import {
  createPostgresEngineeringContextSourceRegistry,
  createPostgresExternalRiskInputFactsReader,
} from "../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createPostgresStandardizedRiskInputFactsReader } from "../../packages/adapters/dist/identification/read/index.js";
import { createPostgresMonitoringStore } from "../../packages/adapters/dist/engineering-data/monitoring/index.js";
import { createPostgresRunEventReaderV1 } from "../../packages/adapters/dist/workflow/index.js";
import {
  createStructuredDocumentConversionAdapter,
  createMineruDocumentParser,
} from "../../packages/adapters/dist/engineering-data/document-conversion/index.js";

const sameRef = (left, right) =>
  left?.entityId === right?.entityId && left?.versionId === right?.versionId;
const requireSameRef = (left, right) => {
  if (!sameRef(left, right)) throw new TypeError("DEPLOYMENT_POLICY_MEMBER_MISMATCH");
};

/** 只解析批准目录和精确工程绑定，全部核验后才能交给业务组合。 */
export const resolveDeploymentPoliciesV1 = ({ config: input, catalog: rawCatalog }) => {
  const config = DeploymentConfigV1Schema.parse(input);
  const catalog = DeploymentPolicyCatalogV1Schema.parse(rawCatalog);
  if (
    !sameRef(config.policyCatalog.catalogRef, catalog.catalogRef) ||
    config.purpose !== catalog.purpose
  ) {
    throw new TypeError("DEPLOYMENT_POLICY_CATALOG_IDENTITY_MISMATCH");
  }
  const reader = createDeploymentPolicyCatalogReaderV1(catalog);
  const projects = new Map();
  for (const binding of config.projectBindings) {
    requireSameRef(binding.policyCatalogRef, catalog.catalogRef);
    const policies = Object.fromEntries(
      Object.entries(binding.policyRefs).map(([policyType, policyRef]) => [
        policyType,
        reader.resolve({
          projectId: binding.projectId,
          policyType,
          policyRef,
        }),
      ]),
    );
    const graph = policies["identification-graph"];
    const bundle = policies["risk-candidate"];
    requireSameRef(graph.retrievalPolicyRef, binding.policyRefs["hybrid-retrieval"]);
    requireSameRef(graph.retrievalReviewAgentPolicyRef, binding.policyRefs["retrieval-review"]);
    requireSameRef(graph.retryPolicyRef, binding.policyRefs.retry);
    if (!isDeepStrictEqual(graph.retryPolicy, policies.retry))
      throw new TypeError("DEPLOYMENT_POLICY_MEMBER_MISMATCH");
    requireSameRef(
      policies["hybrid-retrieval"].acceptancePolicyRef,
      binding.policyRefs["retrieval-acceptance"],
    );
    for (const [field, expected] of [
      [graph.repairPolicyRef, bundle.validation.policyRef],
      [graph.confidencePolicyRef, bundle.confidence.policyRef],
      [graph.forcedReviewPolicyRef, bundle.forcedReview.policyRef],
      [graph.mergePolicyRef, bundle.merge.policyRef],
      [graph.ruleValidationPolicyRef, bundle.validation.ruleValidationPolicyRef],
    ])
      requireSameRef(field, expected);
    if (
      !isDeepStrictEqual(
        graph.simulationConstraintPolicyRef,
        bundle.validation.simulationConstraint?.policyRef,
      )
    ) {
      throw new TypeError("DEPLOYMENT_POLICY_MEMBER_MISMATCH");
    }
    const assessment = policies["assessment-runtime"];
    const requireModel = (ref, capability, dimensions) => {
      const matches = config.models.filter(({ config: deployment }) =>
        sameRef(deployment.deploymentRef, ref),
      );
      if (
        matches.length !== 1 ||
        !matches[0].config.capabilities.includes(capability) ||
        (dimensions !== undefined && matches[0].config.embeddingDimensions !== dimensions)
      ) {
        throw new TypeError("DEPLOYMENT_POLICY_MODEL_MISMATCH");
      }
    };
    requireModel(graph.modelDeploymentRef, "completeStructured");
    requireModel(assessment.modelDeploymentRef, "completeStructured");
    requireModel(
      policies["hybrid-retrieval"].modelDeploymentRef,
      "embed",
      policies["hybrid-retrieval"].dense.dimensions,
    );
    requireModel(bundle.merge.embeddingDeploymentRef, "embed");
    for (const agent of [
      policies.cleaning.agent,
      policies["knowledge-validation"].agent,
      policies["retrieval-review"],
      policies["response-agent"]?.budgetPolicy,
      policies.calibration?.budgetPolicy,
    ]) {
      if (agent !== undefined) requireModel(agent.modelDeploymentRef, "completeStructured");
    }
    projects.set(binding.projectId, Object.freeze({ binding, policies: Object.freeze(policies) }));
  }
  const sharedKinds = [
    "cleaning",
    "knowledge-validation",
    "retrieval-review",
    "response-agent",
    "calibration",
  ];
  for (const policyType of sharedKinds) {
    const bodies = [...projects.values()].map(({ policies }) => {
      if (policies[policyType] === undefined) return undefined;
      const definitionPolicy = { ...policies[policyType] };
      delete definitionPolicy.projectId;
      return definitionPolicy;
    });
    const available = bodies.filter((body) => body !== undefined);
    if (available.some((body) => !isDeepStrictEqual(body, available[0]))) {
      throw new TypeError("DEPLOYMENT_SHARED_AGENT_POLICY_MISMATCH");
    }
  }
  return {
    reader,
    downstreamAuthorization: Object.freeze({
      policyRef: Object.freeze(catalog.downstreamAuthorization.policyRef),
      bindings: Object.freeze(
        catalog.downstreamAuthorization.bindings.map((binding) =>
          Object.freeze({
            rootBranch: binding.rootBranch,
            downstreamBranches: Object.freeze(binding.downstreamBranches),
          }),
        ),
      ),
    }),
    resolveProject(projectId) {
      const result = projects.get(projectId);
      if (!result) throw new TypeError("DEPLOYMENT_PROJECT_BINDING_MISSING");
      return result;
    },
  };
};

export const loadDeploymentPoliciesV1 = async (config) => {
  const bytes = await readControlledFileV1(
    config.localRoots.dataRoot,
    config.policyCatalog.filePath,
    1_048_576,
    "DEPLOYMENT_POLICY_CATALOG_FILE_INVALID",
  );
  return resolveDeploymentPoliciesV1({
    config,
    catalog: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  });
};

const assertControlledPathV1 = async (root, path) => {
  const inside = relative(resolve(root), resolve(path));
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`))
    throw new TypeError("DEPLOYMENT_CONTROLLED_PATH_INVALID");
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new TypeError("DEPLOYMENT_CONTROLLED_PATH_SYMLINK");
    if (current === dirname(current)) break;
  }
  if ((await realpath(path)) !== resolve(path))
    throw new TypeError("DEPLOYMENT_CONTROLLED_PATH_SYMLINK");
};

const readControlledFileV1 = async (root, path, maxBytes, errorCode) => {
  await assertControlledPathV1(root, path);
  if (!(await lstat(path)).isFile()) throw new TypeError(errorCode);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new TypeError(errorCode);
    const chunks = [];
    let total = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new TypeError(errorCode);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await file.close();
  }
};

/** 只加载批准的精确数据集；正文和评分标注不进入模型宿主配置。 */
export const loadDeploymentRetrievalDatasetsV1 = async (input, policies) => {
  const config = DeploymentConfigV1Schema.parse(input);
  const datasets = [];
  for (const binding of config.retrievalQuality.datasets) {
    const bytes = await readControlledFileV1(
      config.localRoots.dataRoot,
      binding.filePath,
      64 * 1024 * 1024,
      "DEPLOYMENT_RETRIEVAL_DATASET_FILE_INVALID",
    );
    const dataset = DeploymentRetrievalDatasetV1Schema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (
      dataset.projectId !== binding.projectId ||
      !sameRef(dataset.datasetRef, binding.datasetRef) ||
      (config.purpose === "production" && dataset.syntheticSample)
    ) {
      throw new TypeError("DEPLOYMENT_RETRIEVAL_DATASET_IDENTITY_INVALID");
    }
    datasets.push(dataset);
  }
  for (const binding of config.projectBindings) {
    const policy = policies.resolveProject(binding.projectId).policies["retrieval-acceptance"];
    if (
      !datasets.some(
        (dataset) =>
          dataset.projectId === binding.projectId && sameRef(dataset.datasetRef, policy.datasetRef),
      )
    )
      throw new TypeError("DEPLOYMENT_RETRIEVAL_DATASET_BINDING_MISSING");
  }
  return datasets;
};

/** 报告保存成功才可返回门禁结果；正文只使用原报告 Schema。 */
export const createDeploymentRetrievalReportWriterV1 = (config) => async (input) => {
  const report = HybridRetrievalAcceptanceReportV1Schema.parse(input);
  const directory = join(config.localRoots.logRoot, "retrieval-quality");
  await assertControlledPathV1(dirname(config.localRoots.logRoot), config.localRoots.logRoot);
  try {
    await mkdir(directory, { mode: 0o700 });
    const root = await open(config.localRoots.logRoot, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await root.sync();
    } finally {
      await root.close();
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await assertControlledPathV1(config.localRoots.logRoot, directory);
  const id = randomUUID();
  const temporary = join(directory, `.${id}.tmp`);
  const target = join(directory, `${id}.json`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(
        `${JSON.stringify({
          schemaVersion: 1,
          instanceId: config.instanceId,
          releaseId: config.releaseId,
          configRef: config.configRef,
          report,
        })}\n`,
        "utf8",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

export const createDeploymentRetrievalQualityGateV1 = ({
  foundation,
  policies,
  datasets,
  modelGateway,
}) => {
  const { config } = foundation;
  const budgetPolicyRef = config.projectBindings[0].retrievalBudgetPolicyRef;
  if (
    config.projectBindings.some(
      (binding) => !sameRef(binding.retrievalBudgetPolicyRef, budgetPolicyRef),
    )
  )
    throw new TypeError("DEPLOYMENT_IDENTIFICATION_RETRIEVAL_BUDGET_POLICY_MISMATCH");
  return createDeploymentBuildQualityGateV1({
    datasets,
    acceptancePolicies: config.projectBindings.map(({ projectId }) => ({
      projectId,
      policy: policies.resolveProject(projectId).policies["retrieval-acceptance"],
    })),
    generationStore: new PostgresRetrievalAdapter({
      db: foundation.runtime.db,
      transactionUnit: foundation.transactionUnit,
    }),
    projection: new QdrantRetrievalProjection(config.qdrant),
    modelGateway,
    access: foundation.access,
    budgetPolicyRef,
    timeoutMs: config.retrievalQuality.timeoutMs,
    containerRuntime: config.retrievalQuality.containerRuntime,
    onReport: createDeploymentRetrievalReportWriterV1(config),
  });
};

/** C18/C19 共用 C17 的 C16；每个工程只使用其批准的评分策略。 */
export const createDeploymentScoringGovernanceV1 = ({
  foundation,
  resolveDeploymentPolicies,
  authorizeDownstream,
  review,
}) => {
  const identification = new SingleBindingV1("C18/C19→C17");
  const common = {
    db: foundation.runtime.db,
    transactionUnit: foundation.transactionUnit,
    artifactStore: foundation.artifactStore,
  };
  const governedReleases = {
    async resolveGovernedReleases(input) {
      const authorization = await authorizeDownstream({
        projectId: input.projectId,
        actorId: input.authorization.actorId,
        branch: "knowledge-modeling.assessment-basis",
        invocationId: governedReleaseResolutionInvocationId(input),
      });
      return identification.useMethod("resolveGovernedReleases", { ...input, authorization });
    },
  };
  const configuration = createPostgresAssessmentConfigurationAdapter({
    ...common,
    governedReleases,
  });
  const adapters = new Map();
  for (const binding of foundation.config.projectBindings) {
    if (adapters.has(binding.projectId))
      throw new TypeError("DEPLOYMENT_SCORING_PROJECT_DUPLICATE");
    const policy = resolveDeploymentPolicies.resolveProject(binding.projectId).policies[
      "scoring-rules"
    ];
    const adapter = createPostgresScoringRulesAdapter({
      ...common,
      access: foundation.access,
      artifactReferenceGuard: foundation.referenceGuard,
      policy,
      configuration,
      governedReleases,
      taskStore: { getTask: (...args) => identification.useMethod("getTask", ...args) },
      dataCleaning: {
        readBoundResult: (...args) => identification.useMethod("readBoundResult", ...args),
        loadFrozenInput: (...args) => identification.useMethod("loadFrozenInput", ...args),
      },
      preparationSnapshot: foundation.contextSource,
      authorizeConfigurationRead: (request) =>
        foundation.authorizationScope.authorizeCurrent(request),
      conflictDecisions: review,
      startAgentTask: async () => {
        throw new TypeError("DEPLOYMENT_SCORING_AGENT_AUTHORING_UNAVAILABLE");
      },
      submitRevision: {
        submitRevision: async (input) => {
          if (input.definitionType !== "applicable-rule-set" || input.authorization === undefined)
            throw new TypeError("DEPLOYMENT_SCORING_AGENT_AUTHORING_UNAVAILABLE");
          const authorization = await foundation.authorizationScope.authorizeCurrent({
            projectId: input.projectId,
            actorId: input.authorization.actorId,
            branch: "knowledge-modeling.submit-revision",
            invocationId: input.commandId,
            requestedAt: input.issuedAt,
          });
          const result = await identification.useMethod("govern", {
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
              ...(input.baseReleaseRef === undefined
                ? {}
                : { baseReleaseRef: input.baseReleaseRef }),
              evidenceReferences: input.evidenceReferences ?? [],
            },
          });
          if (result.kind !== "succeeded") return result;
          if (result.result.kind !== "revision")
            throw new TypeError("DEPLOYMENT_SCORING_REVISION_RESULT_INVALID");
          return { kind: "succeeded", revisionRef: result.result.knowledgeRevisionRef };
        },
      },
      derivedPublisher: {
        publishDerivedRelease: (input) => identification.useMethod("publishDerivedRelease", input),
      },
    });
    adapters.set(binding.projectId, adapter);
  }
  const adapterFor = (projectId) => {
    const adapter = adapters.get(projectId);
    if (adapter === undefined) throw new TypeError("DEPLOYMENT_SCORING_PROJECT_BINDING_MISSING");
    return adapter;
  };
  const policy = {
    prepareRevision: (command) => adapterFor(command.projectId).prepareRevision(command),
    appendPreparedRevision: (context, input) =>
      adapterFor(input.projectId).appendPreparedRevision(context, input),
    assertRevisionMetadata: (input) => adapterFor(input.projectId).assertRevisionMetadata(input),
    appendRelease: (context, input) =>
      adapterFor(input.command.projectId).appendRelease(context, input),
  };
  const basis = {
    resolve: (input) => adapterFor(input.projectId).resolve(input),
    readAssessmentBasisReleaseSet: (input) =>
      adapterFor(input.authorization.projectId).readAssessmentBasisReleaseSet(input),
    readPublishedConfigurationMember: (input) =>
      adapterFor(input.projectId).readPublishedConfigurationMember(input),
  };
  return {
    configuration,
    policy,
    basis,
    assembly: { assemble: (command) => adapterFor(command.projectId).assemble(command) },
    measureReleaseReader: createDeploymentMeasureReleaseReaderV1({ basis, authorizeDownstream }),
    bind(composition) {
      const knowledge = composition.compositions.knowledge;
      const cleaning = composition.compositions.cleaning;
      identification.bind({
        resolveGovernedReleases: knowledge.governedReleases.resolveGovernedReleases,
        getTask: cleaning.agentTaskAdapter.getTask.bind(cleaning.agentTaskAdapter),
        readBoundResult: cleaning.store.readBoundResult.bind(cleaning.store),
        loadFrozenInput: cleaning.store.loadFrozenInput.bind(cleaning.store),
        govern: knowledge.adapter.govern.bind(knowledge.adapter),
        publishDerivedRelease: knowledge.governedReleases.publishDerivedRelease.bind(
          knowledge.governedReleases,
        ),
      });
    },
    assertReady() {
      if (!identification.isBound) throw new TypeError("DEPLOYMENT_SCORING_NOT_BOUND");
    },
  };
};

/** 运行主体来自登记事实，实际领域动作由 C06 检查当前权限。 */
export const createDeploymentRuntimeAuthorizationV1 = ({ access, authorizationScope }) => ({
  async verifyCurrent(input) {
    const parsed = AuthorizationContextV1Schema.safeParse(input.authorization);
    if (!parsed.success) return undefined;
    const authorization = parsed.data;
    if (
      (input.projectId !== undefined && input.projectId !== authorization.projectId) ||
      (input.actorId !== undefined && input.actorId !== authorization.actorId)
    )
      return undefined;
    const source = await access.readDeploymentAuthorizationSource({
      authorizationContextRef: authorization.authorizationContextRef,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
    });
    if (source === undefined) return undefined;
    const requestedSpatialScopeRefs =
      input.requestedSpatialScopeRefs ?? authorization.spatialScopeRefs;
    const requestedSourceVersionRefs = input.requestedSourceVersionRefs ?? source.sourceVersionRefs;
    try {
      const original = await access.verify({
        authorizationContextRef: authorization.authorizationContextRef,
        projectId: authorization.projectId,
        invocationId: source.invocationId,
        branch: source.branch,
        requestedSpatialScopeRefs,
        requestedSourceVersionRefs,
      });
      if (source.branch === input.branch) return original.context;
      return await authorizationScope.authorizeDownstream({
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        invocationId: input.invocationId,
        branch: input.branch,
        requestedSpatialScopeRefs,
        requestedSourceVersionRefs,
      });
    } catch (error) {
      if (
        error instanceof DeploymentAuthorizationError ||
        (error instanceof AccessServiceError &&
          [
            "AUTHENTICATION_REJECTED",
            "PASSWORD_CHANGE_REQUIRED",
            "SESSION_EXPIRED",
            "SESSION_REVOKED",
            "AUTHORIZATION_DENIED",
            "STALE_ACCESS_VERSION",
          ].includes(error.details.code))
      )
        return undefined;
      throw error;
    }
  },
});

/** 检查点只核对运行、线程和当前部署的图版本。 */
export const createDeploymentCheckpointValidatorV1 =
  ({ policies }) =>
  async (validation) => {
    const runtime = CheckpointRuntimeContextV1Schema.safeParse(validation?.runtimeContext);
    if (!runtime.success) return false;
    const schemas = [
      ["identification", IdentificationGraphStateV1Schema],
      ["assessment", AssessmentGraphStateV1Schema],
      ["riskFlow", RiskFlowGraphStateV1Schema],
    ];
    const graph = schemas
      .map(([kind, schema]) => ({ kind, state: schema.safeParse(validation.state) }))
      .find(({ state }) => state.success);
    if (graph === undefined) return false;
    const state = graph.state.data;
    const binding = policies.resolveProject(runtime.data.projectId).binding;
    return (
      state.threadId === runtime.data.threadId &&
      isDeepStrictEqual(state.runRef, runtime.data.runRef) &&
      sameRef(state.graphVersion, binding.graphVersions[graph.kind])
    );
  };

/** 各识别接缝复用业务动作入口。 */
export const createDeploymentIdentificationAuthorizationV1 = ({ access, authorizationScope }) => {
  const runtime = createDeploymentRuntimeAuthorizationV1({ access, authorizationScope });
  const verifySource = async (input) => {
    const source = await access.readDeploymentAuthorizationSource({
      authorizationContextRef: input.authorization.authorizationContextRef,
      projectId: input.projectId,
      actorId: input.actorId,
    });
    if (source === undefined) throw new TypeError("DEPLOYMENT_IDENTIFICATION_SOURCE_INVALID");
    return source;
  };
  const verifyIssuedContext = async (input) => {
    try {
      const source = await verifySource({
        ...input,
        projectId: input.authorization.projectId,
        actorId: input.authorization.actorId,
      });
      const decision = await access.verify({
        authorizationContextRef: source.context.authorizationContextRef,
        projectId: source.context.projectId,
        invocationId: input.invocationId,
        branch: input.branch,
        requestedSpatialScopeRefs:
          input.requestedSpatialScopeRefs ?? source.context.spatialScopeRefs,
        requestedSourceVersionRefs: input.requestedSourceVersionRefs ?? source.sourceVersionRefs,
      });
      return decision.redacted ? undefined : decision.context;
    } catch (error) {
      if (
        error instanceof DeploymentAuthorizationError ||
        (error instanceof AccessServiceError &&
          !["ACCESS_TRANSIENT_FAILURE", "ACCESS_TERMINAL_FAILURE"].includes(error.details.code)) ||
        [
          "DEPLOYMENT_IDENTIFICATION_SOURCE_INVALID",
          "DEPLOYMENT_IDENTIFICATION_SOURCE_DENIED",
        ].includes(error?.message)
      )
        return undefined;
      throw error;
    }
  };
  return Object.freeze({
    resolveCleaningStartAuthorizationInvocation: (request) =>
      authorizationScope.resolveInvocationSource({
        projectId: request.command.projectId,
        actorId: request.command.actorId,
        invocationId: request.command.commandId,
        branch: "agent-task.start-task",
        requestedSpatialScopeRefs: request.requestedSpatialScopeRefs,
        requestedSourceVersionRefs: request.requestedSourceVersionRefs,
      }),
    resolveKnowledgeAuthorizationSource: (request) =>
      authorizationScope.resolveKnowledgeInvocationSource(request),
    authorizeHybridRetrievalProjection: (request) =>
      authorizationScope.authorizeCurrent({
        projectId: request.projectId,
        invocationId: request.eventId,
        branch: "knowledge-modeling.hybrid-evidence",
      }),
    authorizeIdentificationReleaseRead: (request) =>
      authorizationScope.authorizeCurrent({
        projectId: request.projectId,
        actorId: request.actorId,
        invocationId: request.invocationId,
        branch: "knowledge-modeling.identification-basis",
      }),
    identificationContext: {
      async issueReadContext(request) {
        const source = await verifySource(request);
        if (
          source.context.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[request.branch])
        )
          return source.context;
        return authorizationScope.authorizeCurrent({
          ...request,
          requestedSpatialScopeRefs: source.context.spatialScopeRefs,
          requestedSourceVersionRefs: source.sourceVersionRefs,
        });
      },
      verifyCurrent: verifyIssuedContext,
    },
    riskCandidateFinalization: {
      issueBranchContext: (request) => authorizationScope.authorizeDownstream(request),
      verifyCurrent: async (input) =>
        (await verifyIssuedContext(input)) ?? runtime.verifyCurrent(input),
    },
    identificationGraph: {
      request: access,
      runtime: {
        async verifyCurrent(input) {
          const source = await access.readDeploymentAuthorizationSource({
            authorizationContextRef: input.authorization.authorizationContextRef,
            projectId: input.projectId,
            actorId: input.actorId,
          });
          if (
            source === undefined ||
            !source.context.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[input.branch])
          )
            return undefined;
          return runtime.verifyCurrent(input);
        },
      },
      authorizeDownstream: (request) => authorizationScope.authorizeCurrent(request),
      async issueReadContext(request) {
        const source = await verifySource(request);
        const invocationId = request.invocationId;
        return {
          authorization: source.context.grantedCapabilities.includes(
            MODULE_BRANCH_CAPABILITY_V1[request.branch],
          )
            ? source.context
            : await authorizationScope.authorizeCurrent(request),
          invocationId,
        };
      },
      async resolveRecoveryAuthorization({ event }) {
        const authorization = await authorizationScope.authorizeCurrent({
          projectId: event.projectId,
          invocationId: event.eventId,
          branch: "risk-identification.plan",
        });
        return {
          authorization,
          issuedInvocationId: event.eventId,
          authorizationBranch: "risk-identification.plan",
        };
      },
    },
  });
};

export const createDeploymentAuthorizationScopeV1 = ({
  access,
  readPreparationCompletionOrigin,
}) => {
  const scope = new AsyncLocalStorage();
  const sourceOf = async (authorization) => {
    const parsed = AuthorizationContextV1Schema.parse(authorization);
    const source = await access.readDeploymentAuthorizationSource({
      authorizationContextRef: parsed.authorizationContextRef,
      projectId: parsed.projectId,
      actorId: parsed.actorId,
    });
    if (source === undefined) throw new TypeError("DEPLOYMENT_AUTHORIZATION_SOURCE_INVALID");
    return source;
  };
  const run = async ({ authorization, causalRunRef, causalCommandRef }, operation) => {
    const source = await sourceOf(authorization);
    if ((causalRunRef === undefined) === (causalCommandRef === undefined))
      throw new TypeError("DEPLOYMENT_AUTHORIZATION_CAUSE_INVALID");
    const cause =
      causalRunRef === undefined
        ? { causalCommandRef: CommandCausalRefV1Schema.parse(causalCommandRef) }
        : { causalRunRef: WorkflowRunRefV1Schema.parse(causalRunRef) };
    return scope.run({ source, ...cause }, operation);
  };
  const actionDecision = async (request, reuseSnapshot = false) => {
    const current = scope.getStore();
    const source = current?.source;
    if (
      source === undefined ||
      request.projectId !== source.context.projectId ||
      (request.actorId !== undefined && request.actorId !== source.context.actorId)
    )
      throw new TypeError("DEPLOYMENT_AUTHORIZATION_SCOPE_MISSING");
    const input = {
      actorId: source.context.actorId,
      projectId: source.context.projectId,
      branch: request.branch,
      capability: request.requiredCapability ?? MODULE_BRANCH_CAPABILITY_V1[request.branch],
      invocationId: current.actionId ?? request.invocationId ?? randomUUID(),
      requestedSpatialScopeRefs:
        request.requestedSpatialScopeRefs ??
        request.spatialScopeRefs ??
        source.context.spatialScopeRefs,
      requestedSourceVersionRefs: request.requestedSourceVersionRefs ?? source.sourceVersionRefs,
      ...(current.execution === undefined ? {} : { taskRef: current.execution.taskRef }),
      ...(reuseSnapshot ? { authorizationContextRef: request.authorizationContextRef } : {}),
      ...((request.causalRunRef ?? current.causalRunRef) === undefined
        ? {}
        : { causalRunRef: request.causalRunRef ?? current.causalRunRef }),
    };
    const key = JSON.stringify([
      input.invocationId,
      input.branch,
      input.capability,
      input.requestedSpatialScopeRefs,
      input.requestedSourceVersionRefs,
      input.taskRef,
      input.authorizationContextRef,
    ]);
    current.decisions ??= new Map();
    let decision = current.decisions.get(key);
    if (decision === undefined) {
      decision = access.authorizeBusinessAction(input);
      current.decisions.set(key, decision);
      decision.catch(() => current.decisions.delete(key));
    }
    return decision;
  };
  const authorizeDownstream = async (request) => (await actionDecision(request)).context;
  return Object.freeze({
    run,
    setTaskAction(actionId) {
      const current = scope.getStore();
      if (current?.execution === undefined) throw new TypeError("DEPLOYMENT_TASK_SCOPE_MISSING");
      current.actionId = actionId;
      current.decisions = new Map();
    },
    runRequest: (operation) => scope.run({}, operation),
    authorizeDownstream,
    authorizeReadContext: authorizeDownstream,
    authorizeCurrent: authorizeDownstream,
    async resolveInvocationSource(request) {
      const current = scope.getStore();
      if (
        current?.source === undefined ||
        request.projectId !== current.source.context.projectId ||
        request.actorId !== current.source.context.actorId
      )
        throw new TypeError("DEPLOYMENT_AUTHORIZATION_SCOPE_MISSING");
      if (current.sessionToken !== undefined) {
        return { kind: "human-session", sessionToken: current.sessionToken };
      }
      const parentContext = await authorizeDownstream(request);
      return {
        kind: "system",
        systemActorId: parentContext.actorId,
        reasonCode: "deployment-downstream-action",
        parentContext,
        ...(current.causalRunRef === undefined
          ? { causalCommandRef: current.causalCommandRef }
          : { causalRunRef: current.causalRunRef }),
      };
    },
    async resolveKnowledgeInvocationSource(request) {
      const invocation = await this.resolveInvocationSource(request);
      const current = scope.getStore();
      return {
        ...invocation,
        declaredScope: {
          spatialScopeRefs: current.source.context.spatialScopeRefs,
          sourceVersionRefs: current.source.sourceVersionRefs,
        },
      };
    },
    async readReviewDecisionAvailability(request) {
      const current = scope.getStore();
      if (
        current?.sessionToken === undefined ||
        current.source?.context.projectId !== request.projectId ||
        current.source.context.actorId !== request.actorId
      )
        return false;
      try {
        const decision = await access.authorize({
          invocationId: `${request.queryId}:decide-availability`,
          projectId: request.projectId,
          branch: "review-audit.decide-review",
          invocation: { kind: "human-session", sessionToken: current.sessionToken },
          requestedSpatialScopeRefs: current.source.context.spatialScopeRefs,
          requestedSourceVersionRefs: current.source.sourceVersionRefs,
        });
        return decision.context.grantedCapabilities.includes("review-audit.decide");
      } catch {
        return false;
      }
    },
    async runTask(task, operation, execution) {
      const current = scope.getStore();
      if (current?.execution !== undefined) {
        if (!isDeepStrictEqual(current.execution.taskRef, task.envelope.agentTaskRef))
          throw new TypeError("DEPLOYMENT_TASK_SCOPE_MISMATCH");
        return operation();
      }
      if (execution === undefined) throw new TypeError("DEPLOYMENT_TASK_LEASE_REQUIRED");
      const source = await sourceOf(task.envelope.authorization);
      return scope.run(
        {
          source,
          causalRunRef: task.envelope.parentRunRef,
          execution: { taskRef: task.envelope.agentTaskRef, ...execution },
        },
        operation,
      );
    },
    async runEvent(rawEvent, operation) {
      const event = DomainEventV1Schema.parse(rawEvent);
      const source = await access.readDeploymentAuthorizationSource({
        authorizationContextRef: event.authorizationContextRef,
        projectId: event.projectId,
      });
      if (source === undefined)
        throw new TypeError("DEPLOYMENT_EVENT_AUTHORIZATION_SOURCE_MISSING");
      const decision = await access.verify({
        authorizationContextRef: source.context.authorizationContextRef,
        projectId: source.context.projectId,
        invocationId: source.invocationId,
        branch: source.branch,
        requestedSpatialScopeRefs: source.context.spatialScopeRefs,
        requestedSourceVersionRefs: source.sourceVersionRefs,
      });
      if (decision.redacted) throw new TypeError("DEPLOYMENT_EVENT_AUTHORIZATION_DENIED");
      let causalRunRef =
        source.causalRunRef ??
        (event.aggregateRef.kind === "workflow-run" ? event.aggregateRef : undefined) ??
        (event.eventType === "identification.risk-record-accepted.v1"
          ? event.payload.identificationRunRef
          : undefined) ??
        (event.eventType === "assessment.recorded.v1"
          ? event.payload.assessmentRunRef
          : undefined) ??
        (event.eventType === "review.review-resolved.v1"
          ? event.payload.resumeRunRef
          : undefined) ??
        (event.eventType === "review.review-requested.v1"
          ? event.payload.waitingRunRef
          : undefined);
      if (
        event.eventType === "engineering.inputs-ready.v1" &&
        event.payload.preparation.kind === "identification" &&
        source.branch === "engineering-data.complete-identification-preparation"
      ) {
        const origin = await readPreparationCompletionOrigin({
          projectId: event.projectId,
          actorId: source.context.actorId,
          requestId: event.producerCommandId,
          requestedAt: new Date().toISOString(),
          authorization: decision.context,
          preparationSnapshotRef: event.payload.preparation.identificationPreparationSnapshotRef,
        });
        const original = await sourceOf(origin.preparationAuthorization);
        causalRunRef = original.causalRunRef;
      }
      const independent =
        event.eventType === "engineering.inputs-ready.v1" && causalRunRef === undefined;
      const causalCommandRef =
        causalRunRef === undefined
          ? {
              kind: "command",
              commandId: event.producerCommandId,
              authorizationContextRef: source.context.authorizationContextRef,
            }
          : undefined;
      return scope.run(
        { source: { ...source, context: decision.context }, causalRunRef, causalCommandRef },
        () =>
          operation({
            source: { ...source, context: decision.context, causalRunRef },
            independent,
          }),
      );
    },
    access: Object.freeze({
      ...access,
      async verify(request) {
        const current = scope.getStore();
        if (current?.source === undefined) return access.verify(request);
        return actionDecision(request, true);
      },
      async verifyDeploymentContext(request) {
        const current = scope.getStore();
        if (current?.source === undefined) return access.verifyDeploymentContext(request);
        return actionDecision(request, true);
      },
      async authorize(request) {
        if (scope.getStore()?.source !== undefined) return actionDecision(request);
        const decision = await access.authorize(request);
        const current = scope.getStore();
        if (current !== undefined) {
          current.source = await sourceOf(decision.context);
          if (request.invocation.kind === "human-session")
            current.sessionToken = request.invocation.sessionToken;
        }
        return decision;
      },
    }),
  });
};

export const createDeploymentAuthorizedArtifactStoreV1 = ({ store, access }) => {
  const verify = async (request) => {
    const manifests = await Promise.all(
      ("artifactRef" in request ? [request.artifactRef] : request.parentArtifactRefs).map(
        async (artifactRef) => {
          const manifest = await store.readManifest(request.projectId, artifactRef);
          if (manifest === undefined)
            throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "deployment-artifact");
          return manifest;
        },
      ),
    );
    const evidence = [
      ...(request.evidenceReferences ?? []),
      ...manifests.flatMap((manifest) => manifest.evidenceReferences),
    ];
    let decision;
    try {
      decision = await access.verifyDeploymentContext({
        authorizationContextRef: request.authorization.authorizationContextRef,
        projectId: request.projectId,
        actorId: request.actorId,
        requiredCapability: request.requiredCapability,
        requestedSpatialScopeRefs:
          manifests.length === 0
            ? request.authorization.spatialScopeRefs
            : manifests.flatMap((manifest) => manifest.access.spatialScopeRefs),
        requestedSourceVersionRefs: [
          ...new Map(
            evidence.map(({ sourceVersion }) => [
              JSON.stringify([sourceVersion.entityId, sourceVersion.versionId]),
              { kind: "source-version", reference: sourceVersion },
            ]),
          ).values(),
        ],
        requestedAt: request.requestedAt ?? request.issuedAt,
      });
      if (decision.redacted)
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "deployment-artifact");
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      const code = error?.details?.code;
      if (code === "ACCESS_TRANSIENT_FAILURE") {
        throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "deployment-context", [], true);
      }
      if (typeof code === "string") {
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "deployment-context");
      }
      throw error;
    }
    for (const manifest of manifests)
      assertArtifactAccess(
        manifest,
        request.projectId,
        manifest.purposeCode,
        request.requiredCapability,
        decision.context,
      );
    return { ...request, authorization: decision.context };
  };
  return Object.freeze({
    async put(command, content) {
      return store.put(await verify(ArtifactPutCommandV1Schema.parse(command)), content);
    },
    async open(request) {
      return store.open(await verify(ArtifactReadRequestV1Schema.parse(request)));
    },
    ...(typeof store.verifyContent !== "function"
      ? {}
      : {
          async verifyContent(request, maxBytes, validate) {
            return store.verifyContent(
              await verify(ArtifactReadRequestV1Schema.parse(request)),
              maxBytes,
              validate,
            );
          },
        }),
  });
};

export const createDeploymentAuthorizedModelGatewayV1 = ({ gateway, access }) => {
  const verify = async (request) => {
    try {
      const decision = await access.verifyDeploymentContext({
        authorizationContextRef: request.authorization.authorizationContextRef,
        projectId: request.projectId,
        actorId: request.actorId,
        requiredCapability: request.requiredCapability,
        requestedSpatialScopeRefs: request.authorization.spatialScopeRefs,
        requestedSourceVersionRefs: [
          ...new Map(
            request.evidenceReferences.map(({ sourceVersion }) => [
              JSON.stringify([sourceVersion.entityId, sourceVersion.versionId]),
              {
                kind: "source-version",
                reference: sourceVersion,
              },
            ]),
          ).values(),
        ],
        requestedAt: request.issuedAt,
      });
      return { ...request, authorization: decision.context };
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      const code = error?.details?.code;
      if (typeof code !== "string") throw error;
      throw new ModelGatewayError(
        modelGatewayError({
          code:
            code === "ACCESS_TRANSIENT_FAILURE"
              ? "MODEL_SERVICE_UNAVAILABLE"
              : "MODEL_AUTHORIZATION_DENIED",
          retryable: code === "ACCESS_TRANSIENT_FAILURE",
          stage: "deployment-context",
          occurredAt: new Date().toISOString(),
          invocationId: request.invocationId,
          modelDeploymentRef: request.modelDeploymentRef,
        }),
      );
    }
  };
  return Object.freeze({
    async completeStructured(request, schema, signal) {
      return gateway.completeStructured(
        await verify(StructuredCompletionRequestV1Schema.parse(request)),
        schema,
        signal,
      );
    },
    async embed(request, signal) {
      return gateway.embed(await verify(EmbeddingRequestV1Schema.parse(request)), signal);
    },
    streamConversation(request, signal) {
      const ready = verify(ConversationRequestV1Schema.parse(request)).then((verified) =>
        gateway.streamConversation(verified, signal),
      );
      const completed = ready.then((handle) => handle.completed);
      // 终态可能先于消费者读取增量失败，保留 completed 的拒绝并避免未处理事件。
      void completed.catch(() => undefined);
      return {
        deltas: (async function* () {
          const handle = await ready;
          yield* handle.deltas;
        })(),
        completed,
      };
    },
  });
};

export const createDeploymentModelGatewayV1 = ({
  config: input,
  secrets,
  access,
  artifactStore,
  readArtifactManifest,
  observe,
}) => {
  const config = DeploymentConfigV1Schema.parse(input);
  const registry = new Map();
  const parentArtifactPreflight = async (request) => {
    for (const artifactRef of request.parentArtifactRefs) {
      const manifest = await readArtifactManifest(request.projectId, artifactRef);
      if (manifest === undefined)
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "model-parent.preflight");
      assertArtifactAccess(
        manifest,
        request.projectId,
        manifest.purposeCode,
        request.requiredCapability,
        request.authorization,
      );
    }
  };
  for (const entry of config.models) {
    const key = JSON.stringify([
      entry.config.deploymentRef.entityId,
      entry.config.deploymentRef.versionId,
    ]);
    if (registry.has(key)) throw new TypeError("DEPLOYMENT_MODEL_DUPLICATE");
    if (
      entry.backend === "network-api" &&
      entry.config.protocol === "openai-chat" &&
      (typeof secrets[entry.config.credentialRef] !== "string" ||
        secrets[entry.config.credentialRef].length === 0)
    )
      throw new TypeError("DEPLOYMENT_MODEL_SECRET_MISSING");
    const options = {
      deployments: [entry.config],
      artifactStore,
      parentArtifactPreflight,
      observe,
    };
    const gateway =
      entry.backend === "network-api"
        ? createNetworkApiModelGateway({ ...options, credentials: secrets })
        : createLlamaCppModelGateway(options);
    registry.set(key, gateway);
  }
  const resolve = (request) => {
    const gateway = registry.get(
      JSON.stringify([request.modelDeploymentRef.entityId, request.modelDeploymentRef.versionId]),
    );
    if (!gateway)
      throw new ModelGatewayError(
        modelGatewayError({
          code: "MODEL_DEPLOYMENT_NOT_FOUND",
          retryable: false,
          stage: "deployment-registry",
          occurredAt: new Date().toISOString(),
          invocationId: request.invocationId,
          modelDeploymentRef: request.modelDeploymentRef,
        }),
      );
    return gateway;
  };
  return createDeploymentAuthorizedModelGatewayV1({
    access,
    gateway: {
      completeStructured: (request, schema, signal) =>
        resolve(request).completeStructured(request, schema, signal),
      embed: (request, signal) => resolve(request).embed(request, signal),
      streamConversation: (request, signal) => resolve(request).streamConversation(request, signal),
    },
  });
};

const databaseRoleKey = (role) => {
  if (role === "checkpointer") return "checkpointerRoleName";
  if (role === "worker") return "workerRoleName";
  if (role === "api" || role === "provision") return "appRoleName";
  throw new TypeError("DEPLOYMENT_ROLE_INVALID");
};

export const deploymentConnectionV1 = (config, secrets, role) => {
  const key = databaseRoleKey(role);
  const password = secrets[config.database.rolePasswordSecretIds[key]];
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("DEPLOYMENT_DATABASE_SECRET_MISSING");
  }
  return {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database[key],
    password,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    applicationName: `riskflow-${role}`,
  };
};

export const loadDeploymentFoundationInputV1 = async ({
  configFile,
  manifestFile = process.env.RISKFLOW_RELEASE_MANIFEST,
  role,
}) => {
  const bytes = await readFile(configFile);
  if (bytes.byteLength > 1_048_576) throw new RangeError("DEPLOYMENT_CONFIG_TOO_LARGE");
  const config = DeploymentConfigV1Schema.parse(JSON.parse(bytes.toString("utf8")));
  if (!manifestFile) throw new TypeError("DEPLOYMENT_RELEASE_MANIFEST_REQUIRED");
  const manifestBytes = await readFile(manifestFile);
  if (manifestBytes.byteLength > 1_048_576) throw new RangeError("DEPLOYMENT_MANIFEST_TOO_LARGE");
  const manifest = ReleaseManifestV1Schema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.releaseId !== config.releaseId) throw new TypeError("DEPLOYMENT_RELEASE_MISMATCH");
  const policies = role === "provision" ? undefined : await loadDeploymentPoliciesV1(config);
  const retrievalDatasets =
    policies === undefined ? undefined : await loadDeploymentRetrievalDatasetsV1(config, policies);
  const ids = new Set([
    config.database.rolePasswordSecretIds[databaseRoleKey(role)],
    config.auth.hmacSecretId,
  ]);
  if (role === "api" || role === "worker") {
    const credentialRef = config.documentConversion.mineru?.credentialRef;
    if (credentialRef !== null && credentialRef !== undefined) ids.add(credentialRef);
    ids.add(config.database.rolePasswordSecretIds.checkpointerRoleName);
    for (const model of config.models) {
      if (model.backend === "network-api" && model.config.protocol === "openai-chat") {
        ids.add(model.config.credentialRef);
      }
    }
  }
  const refs = config.database.secretFileRefs.filter((ref) => ids.has(ref.secretId));
  if (refs.length !== ids.size) throw new TypeError("DEPLOYMENT_SECRET_BINDING_INVALID");
  const secrets = createDeploymentSecretFileLoaderV1({
    expectedUid: process.getuid?.(),
  })(refs);
  return {
    config,
    secrets,
    role,
    policies,
    retrievalDatasets,
    finalMigrationVersion: manifest.finalMigrationVersion,
  };
};

export const createDeploymentFoundationV1 = async ({
  config: input,
  secrets,
  role,
  finalMigrationVersion,
  downstreamAuthorizationPolicy,
  dataCleaningStore,
  validateCheckpointState,
  registeredTaskReader,
  readPreparationCompletionOrigin,
}) => {
  const config = DeploymentConfigV1Schema.parse(input);
  // shortcut: 合置验收只使用本地 C04；跨 VM 生产启动在完整 mTLS 装配后开放。
  if (config.purpose !== "synthetic-acceptance") {
    throw new TypeError("DEPLOYMENT_REMOTE_ARTIFACT_CONFIGURATION_REQUIRED");
  }
  const needsCheckpointer = role === "api" || role === "worker";
  if (needsCheckpointer && typeof validateCheckpointState !== "function") {
    throw new TypeError("DEPLOYMENT_CHECKPOINT_VALIDATOR_REQUIRED");
  }
  const checkpointConnection = needsCheckpointer
    ? deploymentConnectionV1(config, secrets, "checkpointer")
    : undefined;
  const connection = deploymentConnectionV1(config, secrets, role);
  if (!/^\d{6}$/.test(finalMigrationVersion ?? "")) {
    throw new TypeError("DEPLOYMENT_MIGRATION_VERSION_REQUIRED");
  }
  const closers = [];
  const close = async () => {
    const failures = [];
    for (const closer of closers.splice(0).reverse()) {
      try {
        await closer();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new Error("DEPLOYMENT_RESOURCE_CLOSE_FAILED");
  };
  try {
    const checkpointer =
      checkpointConnection === undefined
        ? undefined
        : createPostgresCheckpointer({
            ...checkpointConnection,
            validateState: validateCheckpointState,
          });
    if (checkpointer !== undefined) closers.push(() => checkpointer.end());
    const runtime = createPostgresRuntime(connection, "riskflow_app");
    closers.push(() => runtime.close());
    await assertCompatibleMigrationVersion(runtime.db, finalMigrationVersion);
    const transactionUnit = createPostgresTransactionUnit(runtime);
    const hmac = secrets[config.auth.hmacSecretId];
    if (typeof hmac !== "string") throw new TypeError("DEPLOYMENT_AUTH_SECRET_MISSING");
    const localAccess = createPostgresLocalIdentityAccess({
      ...connection,
      hmacKey: Buffer.from(hmac.trim(), "base64"),
      keyVersion: config.auth.keyVersion,
      registeredTaskReader,
    });
    closers.push(() => localAccess.close());
    const deploymentAuthorization =
      downstreamAuthorizationPolicy === undefined
        ? undefined
        : createDeploymentAuthorizationAdapterV1({
            db: runtime.db,
            access: localAccess,
            policy: downstreamAuthorizationPolicy,
          });
    const authorizationScope =
      deploymentAuthorization === undefined
        ? undefined
        : createDeploymentAuthorizationScopeV1({
            access: localAccess,
            deploymentAuthorization,
            policy: downstreamAuthorizationPolicy,
            readPreparationCompletionOrigin,
          });
    const access = authorizationScope?.access ?? localAccess;
    const localArtifactStore = await createContentAddressedArtifactStore({
      ...connection,
      rootDirectory: config.localRoots.artifactRoot,
      policy: config.artifacts,
    });
    closers.push(() => localArtifactStore.close());
    const artifactStore = createDeploymentAuthorizedArtifactStoreV1({
      store: localArtifactStore,
      access,
    });
    const shared = {
      db: runtime.db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: localArtifactStore.referenceGuard,
    };
    const monitoringStore = createPostgresMonitoringStore(shared);
    const standardizedRiskFacts = createPostgresStandardizedRiskInputFactsReader({
      db: runtime.db,
      authorization: access,
    });
    const externalRiskFacts = createPostgresExternalRiskInputFactsReader({
      db: runtime.db,
      authorization: access,
      artifactStore,
    });
    const riskInputFacts = {
      readRiskInputFacts: (request) =>
        (request.riskInput.kind === "external-risk-event"
          ? externalRiskFacts
          : standardizedRiskFacts
        ).readRiskInputFacts(request),
      readDeploymentRiskScopes: (request) =>
        standardizedRiskFacts.readDeploymentRiskScopes(request),
    };
    const contextSource = createPostgresEngineeringContextSourceRegistry({
      ...shared,
      monitoringStore,
      riskInputFacts,
      ...(dataCleaningStore === undefined ? {} : { dataCleaningStore }),
      ...(authorizationScope === undefined
        ? {}
        : { authorizeDownstream: authorizationScope.authorizeDownstream }),
    });
    const conversion = config.documentConversion;
    const documentConverter = createStructuredDocumentConversionAdapter({
      ...shared,
      contextSource,
      resourcePolicy: conversion.resourcePolicy,
      qualityPolicyRef: conversion.qualityPolicyRef,
      converterDeploymentRef: conversion.converterDeploymentRef,
      ...(conversion.mineru === null
        ? {}
        : {
            documentServiceParser: createMineruDocumentParser({
              config: conversion.mineru,
              credentials: secrets,
            }),
          }),
    });
    return {
      config,
      runtime,
      checkpointer,
      transactionUnit,
      access,
      deploymentAuthorization,
      authorizationScope,
      runEvents: createPostgresRunEventReaderV1({ db: runtime.db, access }),
      riskInputFacts,
      artifactStore,
      readArtifactManifest: localArtifactStore.readManifest,
      referenceGuard: localArtifactStore.referenceGuard,
      monitoringStore,
      contextSource,
      documentConverter,
      assertMigration: (finalVersion) => assertCompatibleMigrationVersion(runtime.db, finalVersion),
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
};

/** 真实三图共享同一基础、任务注册表和检查点证明；监听由完整宿主负责。 */
export const createDeploymentGraphsV1 = async (input) => {
  if (!["api", "worker"].includes(input.role)) throw new TypeError("DEPLOYMENT_GRAPH_ROLE_INVALID");
  const policies = input.policies ?? (await loadDeploymentPoliciesV1(input.config));
  const checkpoint = new SingleBindingV1("checkpoint.reference");
  const cleaning = new SingleBindingV1("C11→C15 cleaning");
  const acceptance = new SingleBindingV1("C24→C22 acceptance");
  const routeDecisions = new SingleBindingV1("C26→C41 decisions");
  const taskAuthority = new SingleBindingV1("C06→C08 task authority");
  const foundation = await createDeploymentFoundationV1({
    ...input,
    downstreamAuthorizationPolicy: policies.downstreamAuthorization,
    registeredTaskReader: (...args) => taskAuthority.useMethod("getTask", ...args),
    validateCheckpointState: (...args) => checkpoint.use(...args),
    dataCleaningStore: {
      freezeIdentificationPreparation: (...args) =>
        cleaning.useMethod("freezeIdentificationPreparation", ...args),
      completeIdentificationPreparation: (command) =>
        cleaning.useMethod("completeIdentificationPreparation", command, {
          getTask: (...args) => taskAuthority.useMethod("getTask", ...args),
        }),
    },
    readPreparationCompletionOrigin: async (request) => {
      const origin = await cleaning.useMethod("readPreparationCompletionOrigin", request, {
        getTask: (...args) => taskAuthority.useMethod("getTask", ...args),
      });
      const manifest = await foundation.readArtifactManifest(
        request.projectId,
        origin.manifestArtifactRef,
      );
      if (manifest === undefined) throw new TypeError("DEPLOYMENT_PREPARATION_MANIFEST_MISSING");
      const original = await foundation.access.readDeploymentAuthorizationSource({
        authorizationContextRef: manifest.authorizationContextRef,
        projectId: request.projectId,
        actorId: request.actorId,
      });
      if (original === undefined) throw new TypeError("DEPLOYMENT_PREPARATION_SOURCE_MISSING");
      return { ...origin, preparationAuthorization: original.context };
    },
  });
  let consumer;
  try {
    const { config, access, artifactStore, transactionUnit, authorizationScope } = foundation;
    const db = foundation.runtime.db;
    const registry = new AgentTaskDefinitionRegistry();
    consumer = createPostgresIdempotentConsumer(
      deploymentConnectionV1(config, input.secrets, input.role),
    );
    const tasks = new PostgresAgentTaskAdapter({
      db,
      registry,
      transactionUnit,
      authorization: access,
      artifactStore,
      referenceGuard: foundation.referenceGuard,
    });
    const review = createPostgresReviewAuditAdapter({ db, transactionUnit, access });
    taskAuthority.bind(tasks);
    const workflowAdapter = createPostgresWorkflowAdapter({
      db,
      transactionUnit,
      runBindingProof: transactionUnit,
      artifactStore,
      authorization: access,
    });
    const authorizeDownstream = authorizationScope.authorizeDownstream;
    const runtimeAuthorization = createDeploymentRuntimeAuthorizationV1({
      access,
      authorizationScope,
    });
    const modelGateway = createDeploymentModelGatewayV1({
      config,
      secrets: input.secrets,
      access,
      artifactStore,
      readArtifactManifest: foundation.readArtifactManifest,
      observe: input.observe,
    });
    const datasets =
      input.retrievalDatasets ?? (await loadDeploymentRetrievalDatasetsV1(config, policies));
    const qualityGate = createDeploymentRetrievalQualityGateV1({
      foundation,
      policies,
      datasets,
      modelGateway,
    });
    const scoring = createDeploymentScoringGovernanceV1({
      foundation,
      resolveDeploymentPolicies: policies,
      authorizeDownstream,
      review,
    });
    const identification = createDeploymentIdentificationV1({
      foundation,
      registry,
      modelGateway,
      checkpointer: foundation.checkpointer,
      idempotentConsumer: consumer,
      resolveDeploymentPolicies: policies,
      deploymentAuthorization: foundation.deploymentAuthorization,
      authorization: createDeploymentIdentificationAuthorizationV1({ access, authorizationScope }),
      review: { port: review, pendingReviewReader: review, decisionReader: review },
      scoringBasisResolver: scoring.basis,
      assessmentConfigurationPolicy: scoring.configuration,
      scoringRulesPolicy: scoring.policy,
      agentTaskFailureEvidenceReader: tasks,
      qualityGate,
      acceptanceRoutes: { readRoutes: (...args) => acceptance.useMethod("readRoutes", ...args) },
    });
    cleaning.bind(identification.compositions.cleaning.store);
    scoring.bind(identification);
    acceptance.bind(
      createDeploymentAcceptanceRoutesV1({
        resultStore: identification.compositions.candidate.adapter,
        artifactStore,
        authorizeDownstream,
      }),
    );
    const persistArtifact = ({ task, actionId, purposeCode, value, signal }) =>
      authorizationScope.runTask(task, async () => {
        signal?.throwIfAborted();
        const result = await artifactStore.put(
          ArtifactPutCommandV1Schema.parse({
            schemaVersion: "1",
            commandId: `${actionId}:${purposeCode}`,
            idempotencyKey: `${actionId}:${purposeCode}`,
            projectId: task.envelope.projectId,
            actorId: task.envelope.actorId,
            issuedAt: task.envelope.createdAt,
            authorization: task.envelope.authorization,
            requiredCapability: "agent-task.start",
            artifactId: `${actionId}:${purposeCode}`,
            artifactKind: "content",
            purposeCode,
            mediaType: "application/json",
            parentArtifactRefs: [],
            evidenceReferences: [],
            additionalSpatialScopeRefs: [],
            additionalSourceAccessGrantRefs: [],
          }),
          (async function* () {
            yield new TextEncoder().encode(JSON.stringify(value));
          })(),
        );
        signal?.throwIfAborted();
        return result.artifactRef;
      });
    const projects = new Map(
      config.projectBindings.map(({ projectId }) => [
        projectId,
        policies.resolveProject(projectId),
      ]),
    );
    const siteBindings = config.projectBindings.flatMap(({ projectId, siteContextBindings }) =>
      siteContextBindings.map((binding) => ({ projectId, ...binding })),
    );
    const siteReader = new SingleBindingV1("recommendation.site-context");
    const commonAgent = { tasks, resolveProject: policies.resolveProject, authorizeDownstream };
    const cleaningModelStep = withDataCleaningModelStep({
      policy: projects.values().next().value.policies.cleaning,
      persistArtifact,
      loadFrozenInput: identification.compositions.cleaning.store.loadFrozenInput.bind(
        identification.compositions.cleaning.store,
      ),
      readObservation: (task, artifactRef) =>
        identification.compositions.cleaning.store.readModelObservation(task, artifactRef),
    });
    const innerSteps = {
      "data-cleaning": cleaningModelStep,
      "knowledge-authoring": identification.compositions.knowledge.modelStep,
      "retrieval-review": identification.compositions.context.modelStep,
    };
    const innerModelStep = Object.fromEntries(
      ["renderModelStep", "interpretModelStep"].map((method) => [
        method,
        (...args) => {
          const task = method === "renderModelStep" ? args[0] : args[1];
          const step = innerSteps[task.envelope.agentTaskRef.taskType];
          if (step === undefined) throw new TypeError("DEPLOYMENT_MODEL_STEP_TASK_UNSUPPORTED");
          return authorizationScope.runTask(task, () => step[method](...args));
        },
      ]),
    );
    const assessment = createDeploymentAssessmentV1({
      foundation,
      registry,
      checkpointer: foundation.checkpointer,
      resolveDeploymentPolicies: policies,
      basis: scoring.basis,
      configuration: scoring.configuration,
      review,
      workflowAdapter,
      riskInputFacts: foundation.riskInputFacts,
      identificationRead: identification.api.riskIdentificationRead,
      governance: identification.api.knowledgeModeling,
      routeDecisions: {
        readRouteDecision: (...args) => routeDecisions.useMethod("readRouteDecision", ...args),
      },
      taskAuthorization: { authorize: authorizeDownstream },
      reviewAuthorization: { authorize: authorizeDownstream },
      measureReleaseReader: scoring.measureReleaseReader,
      recommendationAgent: createDeploymentRecommendationAgentV1({
        ...commonAgent,
        policyCatalog: policies.reader,
        readCandidateSet: (input) => siteReader.useMethod("readCandidateSet", input),
        siteBindings,
        siteContextReader: { read: (...args) => siteReader.useMethod("read", ...args) },
      }),
      calibrationAgent: createDeploymentCalibrationAgentV1(commonAgent),
      calibrationTaskPort: createDeploymentCalibrationTaskPortV1({ artifactStore, access }),
      policies: createDeploymentAssessmentGraphPoliciesV1({
        projects,
        basis: scoring.basis,
        configuration: scoring.configuration,
        authorizeDownstream,
      }),
      authorizeDownstream,
      runtimeAuthorization,
      siteBindings,
      persistArtifact,
      innerModelStep,
    });
    siteReader.bind({
      ...assessment.readers.siteContext,
      read: assessment.readers.siteContext.read.bind(assessment.readers.siteContext),
      readCandidateSet: assessment.compositions.recommendation.readMeasureCandidateSet.bind(
        assessment.compositions.recommendation,
      ),
    });
    const humans = new Map();
    for (const binding of config.projectBindings) {
      const projectRoute = new SingleBindingV1(`C41:${binding.projectId}`);
      humans.set(
        binding.projectId,
        createDeploymentHumanDecisionFeedbackV1({
          foundation,
          authorizeDownstream,
          routeDecisionsBinding: projectRoute,
          assessmentProof: assessment.compositions.riskAssessment,
          responseLifecycle: assessment.compositions.responseLifecycle,
          responseContext: assessment.readers.responseContext,
          resolveFeedbackPolicies: async (input) => {
            const authorization = await authorizeDownstream({
              projectId: input.projectId,
              actorId: input.authorization.actorId,
              branch: "knowledge-modeling.assessment-basis",
              invocationId: `${input.requestId}:feedback-policy`,
            });
            const result = await scoring.configuration.resolveConfigurationSet({
              requestId: `${input.requestId}:feedback-policy`,
              idempotencyKey: `${input.requestId}:feedback-policy`,
              projectId: input.projectId,
              actorId: authorization.actorId,
              requestedAt: input.requestedAt,
              authorization,
              requiredAt: input.requestedAt,
              asOfRecordedAt: input.requestedAt,
              purpose: "deviation",
            });
            if (result.kind !== "succeeded") return undefined;
            const member = result.configurationSet.members.find(
              (member) => member.definitionType === "deviation-policy",
            );
            const calibrationAgentPolicyRef = policies.resolveProject(input.projectId).policies
              .calibration?.policyRef;
            return member === undefined || calibrationAgentPolicyRef === undefined
              ? undefined
              : { deviationPolicyRef: member.releaseRef.reference, calibrationAgentPolicyRef };
          },
          workflowStartControl: {
            graphVersion: binding.graphVersions.riskFlow,
            retryPolicyRef: binding.policyRefs.retry,
          },
        }),
      );
    }
    const humanFor = (projectId) => {
      const value = humans.get(projectId);
      if (value === undefined) throw new TypeError("DEPLOYMENT_HUMAN_PROJECT_BINDING_MISSING");
      return value;
    };
    const humanDecisionFeedback = {
      record: (command) => humanFor(command.projectId).humanDecisionFeedback.record(command),
      verifyHumanDecisionCommitted: (query) =>
        humanFor(query.projectId).humanDecisionProof.verifyHumanDecisionCommitted(query),
      readRouteDecision: (query) =>
        humanFor(query.projectId).routeDecisions.readRouteDecision(query),
    };
    routeDecisions.bind(humanDecisionFeedback);
    const riskFlow = createDeploymentRiskFlowV1({
      foundation,
      checkpointer: foundation.checkpointer,
      resolveDeploymentPolicies: policies,
      identificationRuntime: identification.compositions.graph.runtime,
      assessmentRuntime: assessment.compositions.graph.runtime,
      riskSpatialPairing: createDeploymentRiskSpatialPairingV1({
        riskInputFacts: foundation.riskInputFacts,
        authorizeDownstream,
      }),
      runtimeAuthorization,
      humanDecisionProof: humanDecisionFeedback,
      identificationPreparation: {
        async read({ spatialScopeRefs, sourceVersionRefs, ...request }) {
          const authorization = await authorizeDownstream({
            projectId: request.projectId,
            actorId: request.actorId,
            invocationId: request.requestId,
            branch: "engineering-data.evidence-access",
            requestedSpatialScopeRefs: spatialScopeRefs,
            requestedSourceVersionRefs: sourceVersionRefs,
          });
          const result = await identification.compositions.cleaning.store.readExactPreparation({
            ...request,
            authorization,
          });
          return result.kind === "ok"
            ? { kind: "ok", snapshot: result.snapshot }
            : { kind: "error", retryable: result.error.retryable === true };
        },
      },
    });
    for (const human of humans.values())
      human.bindC30({
        workflow: riskFlow.api.workflow,
        bindingProof: workflowAdapter.bindingProof,
        runCompletionProof: workflowAdapter.runCompletionProof,
      });
    checkpoint.bind(createDeploymentCheckpointValidatorV1({ policies }));
    identification.assertReady();
    scoring.assertReady();
    assessment.assertReady();
    return {
      foundation,
      policies,
      registry,
      tasks,
      review,
      workflowAdapter,
      consumer,
      modelGateway,
      identification,
      assessment,
      scoring,
      riskFlow,
      humanDecisionFeedback,
      persistArtifact,
      async close() {
        try {
          await consumer.close();
        } finally {
          await foundation.close();
        }
      },
    };
  } catch (error) {
    await consumer?.close().catch(() => undefined);
    await foundation.close().catch(() => undefined);
    throw error;
  }
};

/** 五类任务共用原 runner，完整执行作用域及知识编制失败收口由所属模块承接。 */
export const createDeploymentAgentRunnerV1 = (host) => {
  const { foundation, registry, tasks, modelGateway, assessment, identification, persistArtifact } =
    host;
  const runner = createAgentRuntimeRunner({
    store: tasks,
    registry,
    workerId: foundation.config.instanceId,
    leaseDurationMs: foundation.config.worker.leaseTimeoutMs,
    maxConcurrentTasks: foundation.config.worker.maxConcurrency,
    modelGateway,
    artifactStore: foundation.artifactStore,
    ...assessment.modelStep,
    persistArtifact,
    runTask: foundation.authorizationScope.runTask,
    onAction: foundation.authorizationScope.setTaskAction,
  });
  return new KnowledgeAuthoringRunner({
    runner,
    settleAuthoringFailures: async (signal) => {
      signal?.throwIfAborted();
      const result = await identification.compositions.knowledge.adapter.settleAuthoringFailures();
      signal?.throwIfAborted();
      return result;
    },
  });
};

export const createDeploymentOutboxDispatchV1 = (host) => {
  const { foundation, identification, assessment, riskFlow, workflowAdapter, consumer } = host;
  const riskFlowConsumer = createDeploymentRiskFlowEventConsumerV1({
    consumer,
    adapter: workflowAdapter,
    eventRuntime: riskFlow.eventRuntime,
    authorizationScope: foundation.authorizationScope,
    access: foundation.access,
  });
  const registry = new OutboxDispatchRegistryV1();
  const bind = (eventType, name, operation) =>
    registry.register(eventType, name, (event, context) =>
      foundation.authorizationScope.runEvent(event, async (source) => {
        context.signal?.throwIfAborted();
        return ConsumerResultV1Schema.parse(await operation(event, source, context));
      }),
    );
  bind("knowledge.identification-basis-published.v1", "projection", async (event) => {
    const outcome = await identification.worker.handlers[event.eventType](event);
    if (outcome.kind !== "projected") throw new TypeError("DEPLOYMENT_PROJECTION_NOT_CONSUMED");
    return outcome.consumer;
  });
  bind("review.review-resolved.v1", "identification-recovery", (event) =>
    identification.worker.handlers[event.eventType](event),
  );
  bind("warning.warning-recorded.v1", "warning-notification", (event) =>
    consumeWarningRecordedForInAppNotification(
      { consumer, writer: assessment.compositions.warning },
      event,
    ),
  );
  for (const eventType of ["engineering.inputs-ready.v1", "identification.risk-record-accepted.v1"])
    bind(eventType, "risk-flow", riskFlowConsumer);
  return registry.assertReady();
};

/** Agent 与事件独立有限轮询；长模型调用不占用待投递事件租约。 */
export const createDeploymentWorkerV1 = async (input) => {
  const host = await createDeploymentGraphsV1({ ...input, role: "worker" });
  let outbox;
  try {
    const { config } = host.foundation;
    const registry = createDeploymentOutboxDispatchV1(host);
    outbox = createPostgresOutbox(deploymentConnectionV1(config, input.secrets, "worker"));
    const runner = createDeploymentAgentRunnerV1(host);
    return createDeploymentWorkerRuntimeV1({ host, outbox, runner, registry });
  } catch (error) {
    await outbox?.close().catch(() => undefined);
    await host.close().catch(() => undefined);
    throw error;
  }
};

export const createDeploymentWorkerRuntimeV1 = ({ host, outbox, runner, registry }) => {
  const { config } = host.foundation;
  registry.assertReady();
  const lifecycleOptions = {
    pollMs: config.worker.pollMs,
    drainTimeoutMs: config.worker.drainTimeoutMs,
    leaseTimeoutMs: config.worker.leaseTimeoutMs,
  };
  const agents = new WorkerLifecycleV1({
    ...lifecycleOptions,
    poll: async () => true,
    dispatch: (_, { signal }) => runner.runOnce(signal),
  });
  const events = new WorkerLifecycleV1({
    ...lifecycleOptions,
    poll: async ({ signal }) => {
      signal.throwIfAborted();
      return (await outbox.claimBatch({ policy: config.outbox, leaseOwner: config.instanceId }))
        .events;
    },
    dispatch: async (batch, { signal }) => {
      let next = 0;
      let processed = 0;
      const worker = async () => {
        while (next < batch.length && !signal.aborted) {
          const claimed = batch[next++];
          const lease = {
            eventId: claimed.eventId,
            leaseOwner: claimed.leaseOwner,
            leaseToken: claimed.leaseToken,
          };
          if (Date.parse(claimed.leaseUntil) <= Date.now()) continue;
          try {
            const result = await registry.dispatch(claimed.event, { signal });
            signal.throwIfAborted();
            if (result.status !== "acknowledged")
              throw new TypeError("DEPLOYMENT_CONSUMER_RECEIPT_MISSING");
            await outbox.acknowledge(lease);
            processed += 1;
          } catch (error) {
            if (signal.aborted || error?.code === "OUTBOX_LEASE_LOST") continue;
            const errorCode =
              error instanceof UnknownOutboxEventError
                ? "UNKNOWN_OUTBOX_EVENT"
                : (error?.code ?? "DEPLOYMENT_EVENT_FAILED");
            try {
              await outbox.recordFailure({
                ...lease,
                policy: config.outbox,
                errorCode,
                diagnosticRef: error?.diagnosticRef ?? {
                  kind: "diagnostic-artifact",
                  reference: {
                    entityId: `deployment-event:${claimed.eventId}`,
                    versionId: claimed.leaseToken,
                  },
                },
              });
            } catch (failure) {
              if (failure?.code !== "OUTBOX_LEASE_LOST") throw failure;
            }
            if (error instanceof UnknownOutboxEventError) throw error;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(config.worker.maxConcurrency, batch.length) }, worker),
      );
      return processed;
    },
  });
  let closed = false;
  return {
    host,
    registry,
    runner,
    agents,
    events,
    start() {
      if (closed) throw new TypeError("DEPLOYMENT_WORKER_CLOSED");
      registry.assertReady();
      agents.start();
      events.start();
    },
    async runOnce() {
      if (closed) throw new TypeError("DEPLOYMENT_WORKER_CLOSED");
      return Promise.all([agents.runOnce(), events.runOnce()]);
    },
    async close() {
      if (closed) return { settled: true, remaining: 0 };
      const outcomes = await Promise.all([agents.stop(), events.stop()]);
      if (outcomes.some(({ settled }) => !settled))
        return {
          settled: false,
          remaining: outcomes.reduce((count, result) => count + result.remaining, 0),
        };
      await outbox.close();
      await host.close();
      closed = true;
      return { settled: true, remaining: 0 };
    },
  };
};

/** 系统查询只观察实际服务及登记版本；端点探针不执行推理。 */
export const createDeploymentSystemOperationsV1 = (options) => {
  const { foundation, registry, secrets } = options;
  return {
    async probe(componentId, signal) {
      signal.throwIfAborted();
      if (componentId === "api")
        return { status: options.app.server.listening ? "available" : "unavailable" };
      if (componentId === "postgresql") {
        await foundation.runtime.pool.query({ text: "SELECT 1", query_timeout: 1_500 });
      } else if (componentId === "artifact-store") {
        const root = foundation.config.localRoots.artifactRoot;
        await assertControlledPathV1(dirname(root), root);
        if (!(await lstat(root)).isDirectory()) return { status: "unavailable" };
        await accessFile(root, constants.R_OK | constants.W_OK);
      } else if (componentId === "model-gateway") {
        for (const { backend, config } of foundation.config.models) {
          const path =
            backend === "llamacpp"
              ? "/health"
              : config.protocol === "ollama-embed"
                ? "/api/version"
                : "/models";
          const endpoint =
            backend === "network-api" && config.protocol === "openai-chat"
              ? `${config.baseUrl.replace(/\/$/, "")}${path}`
              : new globalThis.URL(path, config.baseUrl);
          const response = await globalThis.fetch(endpoint, {
            signal,
            redirect: "error",
            ...(config.protocol === "openai-chat"
              ? { headers: { Authorization: `Bearer ${secrets[config.credentialRef]}` } }
              : {}),
          });
          await response.body?.cancel();
          if (!response.ok)
            return { status: "unavailable", reasonCode: "MODEL_ENDPOINT_UNAVAILABLE" };
        }
      } else {
        throw new TypeError("DEPLOYMENT_HEALTH_COMPONENT_UNSUPPORTED");
      }
      signal.throwIfAborted();
      return { status: "available" };
    },
    async readModelVersions({ signal }) {
      signal.throwIfAborted();
      return registry.values().map(({ metadata, budgetPolicy }) => {
        const model = foundation.config.models.find(({ config }) =>
          sameRef(config.deploymentRef, budgetPolicy.modelDeploymentRef),
        )?.config;
        if (model === undefined) throw new TypeError("DEPLOYMENT_MODEL_VERSION_BINDING_MISSING");
        return {
          taskType: metadata.taskType,
          deploymentRef: model.deploymentRef,
          modelVersionRef: model.modelVersionRef,
          ...(model.serverBuildRef === undefined ? {} : { serverBuildRef: model.serverBuildRef }),
          promptTemplateRef: budgetPolicy.promptTemplateRef,
          toolPolicyRef: budgetPolicy.toolPolicyRef,
          budgetPolicyRef: budgetPolicy.policyRef,
          supportedTriggerModes: [...metadata.supportedTriggerModes],
        };
      });
    },
  };
};

/** 构造与监听分开；完整真实端口及请求来源作用域就绪后才能显式 listen。 */
export const createDeploymentApiV1 = async (input) => {
  const host = await createDeploymentGraphsV1({ ...input, role: "api" });
  const { foundation, identification, assessment, scoring, workflowAdapter } = host;
  const { access, artifactStore, authorizationScope, transactionUnit, config } = foundation;
  let app;
  try {
    const ports = createDeploymentApiPortsV1({
      ...(config.sourceOriginal === undefined
        ? {}
        : {
            sourceOriginal: new SourceOriginalReaderV1({
              access,
              source: foundation.contextSource,
              artifactStore,
              readManifest: foundation.readArtifactManifest,
              temporaryRoot: config.sourceOriginal.temporaryRoot,
              policy: config.sourceOriginal,
            }),
          }),
      reviewDecisionAvailability: authorizationScope.readReviewDecisionAvailability,
      db: foundation.runtime.db,
      access,
      artifactStore,
      contextSource: foundation.contextSource,
      monitoringStore: foundation.monitoringStore,
      ...identification.api,
      applicableRuleSetAssembly: scoring.assembly,
      riskAssessment: assessment.api.riskAssessment,
      riskAssessmentRead: assessment.readers.riskAssessment,
      workflow: host.riskFlow.api.workflow,
      humanDecisionFeedback: host.humanDecisionFeedback,
      reviewAudit: host.review,
      agentTask: host.tasks,
      agentTaskRead: host.tasks,
      warningLifecycle: assessment.compositions.warning,
      recommendation: assessment.compositions.recommendation,
      responseLifecycle: assessment.compositions.responseLifecycle,
      calibration: assessment.compositions.calibration,
      transactionUnit,
      workflowRegistrationStore: workflowAdapter.registrationStore,
      workflowBodies: workflowAdapter.bodies,
      riskRecordTrace: createPostgresRiskRecordTraceReader({
        db: foundation.runtime.db,
        authorization: access,
      }),
      resultReadAuthorization: {
        issueResultReadAuthorization: (query) =>
          authorizationScope.authorizeDownstream({
            projectId: query.projectId,
            actorId: query.actorId,
            branch: "projection.result-read",
            invocationId: query.invocationId,
            requestedSpatialScopeRefs: query.spatialScopeRefs,
          }),
      },
      runEvents: foundation.runEvents,
      projectPolicies: host.policies,
      retrievalRelationshipResults: identification.compositions.context.adapter,
      hybridResultReader: createPostgresOfficialHybridResultReader({
        retrievalStore: new PostgresRetrievalAdapter({
          db: foundation.runtime.db,
          transactionUnit,
        }),
        artifactStore,
      }),
      knowledgeGovernanceReadAuthorizer: authorizationScope.authorizeDownstream,
      systemOperations: createDeploymentSystemOperationsV1({
        foundation,
        registry: host.registry,
        secrets: input.secrets,
        get app() {
          return app;
        },
      }),
    });
    app = buildApi({
      access,
      ports,
      publicOrigin: config.publicOrigin,
      runRequest: authorizationScope.runRequest,
      sourceOriginalTimeoutMs: config.sourceOriginal?.timeoutMs,
    });
    await app.ready();
    let lifecycle;
    let closed = false;
    return {
      ...host,
      app,
      ports,
      listen(listenOptions = config.api) {
        if (closed || lifecycle !== undefined)
          throw new TypeError("DEPLOYMENT_API_LISTEN_STATE_INVALID");
        lifecycle = new ApiLifecycleV1({ app, listenOptions });
        return lifecycle.listen(() => {
          identification.assertReady();
          assessment.assertReady();
        });
      },
      async close() {
        if (closed) return { settled: true, remaining: 0 };
        if (lifecycle !== undefined && lifecycle.state !== LifecycleStateV1.STOPPED) {
          const outcome = await lifecycle.close(config.transport.shutdownTimeoutMs);
          if (!outcome.settled) return outcome;
        } else {
          await app.close();
        }
        await host.close();
        closed = true;
        return { settled: true, remaining: 0 };
      },
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await host.close().catch(() => undefined);
    throw error;
  }
};

export const mainDeploymentV1 = async (args = process.argv.slice(2)) => {
  const { values } = parseArgs({
    args,
    options: {
      role: { type: "string" },
      config: { type: "string" },
      manifest: { type: "string" },
    },
  });
  if (!["api", "worker"].includes(values.role) || !values.config)
    throw new TypeError("DEPLOYMENT_START_ARGUMENTS_INVALID");
  const input = await loadDeploymentFoundationInputV1({
    role: values.role,
    configFile: values.config,
    manifestFile: values.manifest,
  });
  const runtime = await (values.role === "api"
    ? createDeploymentApiV1(input)
    : createDeploymentWorkerV1(input));
  let stop;
  const stopped = new Promise((resolve) => {
    stop = resolve;
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  let monitor;
  try {
    if (values.role === "api") await runtime.listen();
    else {
      runtime.start();
      monitor = setInterval(() => {
        if (
          runtime.agents.backgroundFailure !== null ||
          runtime.events.backgroundFailure !== null
        ) {
          process.exitCode = 1;
          stop();
        }
      }, input.config.worker.pollMs);
    }
    process.stdout.write(
      `${JSON.stringify(safeLogRecordV1({ stage: values.role, status: "running", instanceId: input.config.instanceId }))}\n`,
    );
    await stopped;
  } finally {
    clearInterval(monitor);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    const outcome = await runtime.close();
    process.stdout.write(
      `${JSON.stringify(safeLogRecordV1({ stage: values.role, status: outcome.settled ? "stopped" : "draining", count: outcome.remaining }))}\n`,
    );
    if (!outcome.settled) process.exitCode = 1;
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  mainDeploymentV1().catch(() => {
    process.stderr.write("DEPLOYMENT_START_FAILED\n");
    process.exitCode = 1;
  });
}
