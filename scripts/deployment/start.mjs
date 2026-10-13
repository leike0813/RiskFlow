#!/usr/bin/env node
import { readFile, lstat, realpath, open, mkdir, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { DomainEventV1Schema } from "../../packages/contracts/dist/events/index.js";
import {
  AuthorizationContextV1Schema,
  WorkflowRunRefV1Schema,
  CommandCausalRefV1Schema,
  ContractReferenceV1Schema,
} from "../../packages/contracts/dist/ports/index.js";
import {
  IdentificationGraphStateV1Schema,
  AssessmentGraphStateV1Schema,
  RiskFlowGraphStateV1Schema,
} from "../../packages/contracts/dist/workflows/index.js";
import { CheckpointRuntimeContextV1Schema } from "../../packages/core/dist/persistence/index.js";
import { identificationRunIdentityFor } from "../../apps/worker/dist/index.js";
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
} from "../../packages/adapters/dist/postgres/index.js";
import { AccessServiceError } from "../../packages/core/dist/access/index.js";
import {
  createPostgresLocalIdentityAccess,
  createDeploymentAuthorizationAdapterV1,
  DeploymentAuthorizationError,
} from "../../packages/adapters/dist/auth/index.js";
import { createContentAddressedArtifactStore } from "../../packages/adapters/dist/artifacts/index.js";
import { createPostgresAssessmentConfigurationAdapter } from "../../packages/adapters/dist/assessment-config/index.js";
import { createPostgresScoringRulesAdapter } from "../../packages/adapters/dist/scoring-rules/index.js";
import { governedReleaseResolutionInvocationId } from "../../packages/adapters/dist/knowledge-governance/index.js";
import { SingleBindingV1 } from "./runtime.mjs";
import {
  DeploymentConfigV1Schema,
  ReleaseManifestV1Schema,
  assertCompatibleMigrationVersion,
  createDeploymentSecretFileLoaderV1,
  DeploymentPolicyCatalogV1Schema,
  createDeploymentPolicyCatalogReaderV1,
  DEPLOYMENT_POLICY_TYPE_V1_VALUES,
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
  if (catalog.entries.some((entry) => entry.approval.releaseId !== config.releaseId)) {
    throw new TypeError("DEPLOYMENT_POLICY_RELEASE_MISMATCH");
  }
  const reader = createDeploymentPolicyCatalogReaderV1(catalog);
  const projects = new Map();
  for (const binding of config.projectBindings) {
    requireSameRef(binding.policyCatalogRef, catalog.catalogRef);
    const policies = Object.fromEntries(
      DEPLOYMENT_POLICY_TYPE_V1_VALUES.map((policyType) => [
        policyType,
        reader.resolve({
          projectId: binding.projectId,
          policyType,
          policyRef: binding.policyRefs[policyType],
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
    for (const member of Object.values(bundle))
      requireSameRef(member.policySetRef.reference, graph.policySetRef.reference);
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
    const warning = policies["warning-runtime"];
    for (const [field, expected] of [
      [assessment.warningAggregationPolicyRef, warning.warningAggregationPolicy.policyRef],
      [assessment.notificationPolicyRef, warning.notificationPolicy.policyRef],
      [assessment.responseGenerationPolicyRef, binding.policyRefs["response-generation"]],
      [assessment.responseValidationPolicyRef, binding.policyRefs["response-validation"]],
      [assessment.responseAgentPolicyRef, binding.policyRefs["response-agent"]],
      [assessment.calibrationAgentPolicyRef, binding.policyRefs.calibration],
      [assessment.retryPolicyRef, binding.policyRefs.retry],
    ])
      requireSameRef(field, expected);
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
      policies["response-agent"].budgetPolicy,
      policies.calibration.budgetPolicy,
    ]) {
      requireModel(agent.modelDeploymentRef, "completeStructured");
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
      const definitionPolicy = { ...policies[policyType] };
      delete definitionPolicy.projectId;
      return definitionPolicy;
    });
    if (bodies.some((body) => !isDeepStrictEqual(body, bodies[0]))) {
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
      authorizeConfigurationRead: authorizeDownstream,
      conflictDecisions: review,
      startAgentTask: async () => {
        throw new TypeError("DEPLOYMENT_SCORING_AGENT_AUTHORING_UNAVAILABLE");
      },
      submitRevision: {
        submitRevision: async () => {
          throw new TypeError("DEPLOYMENT_SCORING_AGENT_AUTHORING_UNAVAILABLE");
        },
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
      adapterFor(input.command.projectId).appendPreparedRevision(context, input),
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
    measureReleaseReader: createDeploymentMeasureReleaseReaderV1({ basis, authorizeDownstream }),
    bind(composition) {
      const knowledge = composition.compositions.knowledge;
      const cleaning = composition.compositions.cleaning;
      identification.bind({
        resolveGovernedReleases: knowledge.governedReleases.resolveGovernedReleases,
        getTask: cleaning.agentTaskAdapter.getTask.bind(cleaning.agentTaskAdapter),
        readBoundResult: cleaning.store.readBoundResult.bind(cleaning.store),
        loadFrozenInput: cleaning.store.loadFrozenInput.bind(cleaning.store),
      });
    },
    assertReady() {
      if (!identification.isBound) throw new TypeError("DEPLOYMENT_SCORING_NOT_BOUND");
    },
  };
};

/** 原运行与派生调用共用 C06 复验；派生身份必须取得批准分支的真实签发。 */
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
    if (source === undefined || !isDeepStrictEqual(source.context, authorization)) return undefined;
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
      if (source.invocationId === input.invocationId && source.branch === input.branch)
        return original.context;
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

/** 只消费原授权、启动收据和所属模块证明；任何缺口均由 C03 按不一致收口。 */
export const createDeploymentCheckpointValidatorV1 =
  ({
    access,
    deploymentAuthorization,
    transactionUnit,
    policies,
    identificationGraph,
    dataCleaningStore,
    workflow,
    recommendation,
    agentTasks,
    reviewTasks,
    candidateProof,
    riskIdentificationRead,
    now = () => new Date(),
  }) =>
  async (rawReference, validation) => {
    try {
      const reference = ContractReferenceV1Schema.parse(rawReference);
      const runtime = CheckpointRuntimeContextV1Schema.parse(validation?.runtimeContext);
      if (!["put", "put-writes", "get", "list"].includes(validation.operation)) return false;
      const stateSchemas = [
        ["identification", IdentificationGraphStateV1Schema],
        ["assessment", AssessmentGraphStateV1Schema],
        ["riskFlow", RiskFlowGraphStateV1Schema],
      ];
      const parsed = stateSchemas
        .map(([kind, schema]) => ({ kind, parsed: schema.safeParse(validation.state) }))
        .find(({ parsed }) => parsed.success);
      if (parsed === undefined) return false;
      const state = parsed.parsed.data;
      const binding = policies.resolveProject(runtime.projectId).binding;
      if (
        state.threadId !== runtime.threadId ||
        !isDeepStrictEqual(state.runRef, runtime.runRef) ||
        !sameRef(state.graphVersion, binding.graphVersions[parsed.kind])
      )
        return false;

      const source = await access.readDeploymentAuthorizationSource({
        authorizationContextRef: runtime.authorization.authorizationContextRef,
        projectId: runtime.projectId,
        actorId: runtime.actorId,
      });
      if (
        source === undefined ||
        source.invocationId !== runtime.invocationId ||
        !isDeepStrictEqual(source.context, runtime.authorization)
      )
        return false;
      const requestedAt = now().toISOString();
      const decision = await access.verify({
        authorizationContextRef: source.context.authorizationContextRef,
        projectId: runtime.projectId,
        invocationId: source.invocationId,
        branch: source.branch,
        requestedSpatialScopeRefs: source.context.spatialScopeRefs,
        requestedSourceVersionRefs: source.sourceVersionRefs,
        requestedAt,
      });
      const authorization = AuthorizationContextV1Schema.parse(decision.context);
      if (decision.redacted || !isDeepStrictEqual(authorization, source.context)) return false;
      const original = await access.readDeploymentAuthorizationSource({
        authorizationContextRef: state.authorizationContextRef,
        projectId: runtime.projectId,
        actorId: runtime.actorId,
      });
      if (
        original === undefined ||
        !isDeepStrictEqual(original.context.authorizationContextRef, state.authorizationContextRef)
      )
        return false;
      if (
        !(await transactionUnit.readWorkflowRunBinding({
          projectId: runtime.projectId,
          actorId: runtime.actorId,
          authorizationContextRef: state.authorizationContextRef,
          runRef: runtime.runRef,
          threadId: runtime.threadId,
          ...(parsed.kind === "riskFlow" ? {} : { parentRunRef: state.parentRiskFlowRunRef }),
        }))
      )
        return false;
      if (parsed.kind === "identification") {
        const identity = identificationRunIdentityFor({
          projectId: runtime.projectId,
          parentRiskFlowRunRef: state.parentRiskFlowRunRef,
          preparationSnapshotRef: state.preparationSnapshotRef,
          graphVersion: state.graphVersion,
        });
        if (
          identity.threadId !== runtime.threadId ||
          !isDeepStrictEqual(identity.runRef, runtime.runRef)
        )
          return false;
      }
      const input = {
        projectId: runtime.projectId,
        actorId: runtime.actorId,
        invocationId: source.invocationId,
        requestedAt,
        authorization,
        runRef: runtime.runRef,
        reference,
      };
      const downstream = (branch) =>
        deploymentAuthorization.readDownstreamContext({
          root: authorization,
          branch,
          requestedSpatialScopeRefs: authorization.spatialScopeRefs,
          requestedSourceVersionRefs: source.sourceVersionRefs,
        });
      switch (reference.kind) {
        case "workflow-run":
          if (isDeepStrictEqual(reference, runtime.runRef)) return true;
          if (parsed.kind !== "riskFlow")
            return isDeepStrictEqual(reference, state.parentRiskFlowRunRef);
          return await transactionUnit.readWorkflowRunBinding({
            projectId: runtime.projectId,
            actorId: runtime.actorId,
            runRef: reference,
            parentRunRef: runtime.runRef,
          });
        case "authorization-context":
          return (
            isDeepStrictEqual(reference, state.authorizationContextRef) ||
            isDeepStrictEqual(reference, authorization.authorizationContextRef)
          );
        case "spatial-scope":
          return authorization.spatialScopeRefs.some((scope) =>
            isDeepStrictEqual(scope, reference),
          );
        case "identification-preparation-snapshot": {
          if (
            parsed.kind !== "identification" ||
            !isDeepStrictEqual(reference, state.preparationSnapshotRef)
          )
            return false;
          const issued = await downstream("engineering-data.evidence-access");
          return await dataCleaningStore.verifyPreparationReference({
            projectId: runtime.projectId,
            actorId: runtime.actorId,
            requestedAt,
            requestId: issued.invocationId,
            authorization: issued.context,
            preparationSnapshotRef: reference,
          });
        }
        case "identification-input-snapshot":
        case "identification-work-plan":
        case "identification-run-result":
          return (
            parsed.kind === "identification" &&
            (await identificationGraph.verifyCheckpointReference(input))
          );
        case "identification-work-item":
          return (
            parsed.kind === "identification" &&
            state.workPlanRef !== undefined &&
            (await identificationGraph.verifyCheckpointReference({
              ...input,
              workPlanRef: state.workPlanRef,
            }))
          );
        case "stage-result":
        case "workflow-error":
        case "route-decision":
        case "assessment-run-result":
        case "risk-flow-run-result":
          return parsed.kind === "identification"
            ? await identificationGraph.verifyCheckpointReference(input)
            : await workflow.verifyCheckpointReference(input);
        case "assessment-preparation-snapshot":
        case "response-forecast-input-snapshot":
        case "response-feedback-input-snapshot": {
          if (parsed.kind !== "assessment") return false;
          const entry = await workflow.registrationStore.readAssessmentEntrySnapshot({
            ...input,
            runId: runtime.runRef.reference.entityId,
          });
          const entryRef =
            entry?.kind === "assessment-preparation"
              ? entry.assessmentPreparationSnapshotRef
              : entry?.kind === "forecast-input"
                ? entry.responseForecastInputSnapshotRef
                : entry?.kind === "feedback-input"
                  ? entry.responseFeedbackInputSnapshotRef
                  : undefined;
          return isDeepStrictEqual(reference, entryRef);
        }
        case "recommendation-candidate": {
          if (parsed.kind !== "assessment") return false;
          const issued = await downstream("warning-response.read");
          return await recommendation.verifyRecommendationCandidateReference({
            ...input,
            invocationId: issued.invocationId,
            authorization: issued.context,
            parentRunRef: runtime.runRef,
            recommendationCandidateRef: reference,
          });
        }
        case "standardized-risk-record": {
          if (parsed.kind !== "identification") return false;
          const issued = await downstream("risk-identification.record-read");
          const current = await access.verify({
            authorizationContextRef: issued.context.authorizationContextRef,
            projectId: runtime.projectId,
            invocationId: issued.invocationId,
            branch: issued.branch,
            requestedSpatialScopeRefs: issued.context.spatialScopeRefs,
            requestedSourceVersionRefs: source.sourceVersionRefs,
            requestedAt,
          });
          if (current.redacted || !isDeepStrictEqual(current.context, issued.context)) return false;
          const outcome = await riskIdentificationRead.read({
            queryId: issued.invocationId,
            projectId: runtime.projectId,
            actorId: runtime.actorId,
            requestedAt,
            authorization: issued.context,
            kind: "record-read",
            payload: { riskRecordRef: reference },
          });
          return (
            outcome.kind === "succeeded" &&
            outcome.result.kind === "record-read" &&
            isDeepStrictEqual(outcome.result.riskRecordRef, reference) &&
            isDeepStrictEqual(outcome.result.identificationRunRef, runtime.runRef)
          );
        }
        case "identification-candidate-set":
        case "merge-plan":
        case "identification-group": {
          if (parsed.kind !== "identification" || state.inputSnapshotRef === undefined)
            return false;
          if (
            !(await identificationGraph.verifyCheckpointReference({
              ...input,
              reference: state.inputSnapshotRef,
            }))
          )
            return false;
          if (
            reference.kind !== "identification-candidate-set" &&
            (state.workPlanRef === undefined ||
              !(await identificationGraph.verifyCheckpointReference({
                ...input,
                reference: state.workPlanRef,
              })))
          )
            return false;
          const issued = await downstream("risk-identification.run-read");
          return await candidateProof.verifyCheckpointReference({
            ...input,
            authorization: issued.context,
            invocationId: issued.invocationId,
            inputSnapshotRef: state.inputSnapshotRef,
            workPlanRef: state.workPlanRef,
          });
        }
        case "knowledge-preparation-task":
        case "user-confirmation": {
          const waitingRefs =
            parsed.kind === "riskFlow"
              ? state.waitingRefs
              : state.waitingRef === undefined
                ? []
                : [state.waitingRef];
          const waitingRef = waitingRefs.find((waiting) =>
            isDeepStrictEqual(
              reference.kind === "knowledge-preparation-task"
                ? waiting.knowledgePreparationTaskRef
                : waiting.userConfirmationRef,
              reference,
            ),
          );
          if (waitingRef === undefined) return false;
          const owner = parsed.kind === "identification" ? identificationGraph : workflow;
          return await owner.verifyCheckpointWaitingReference({ ...input, waitingRef });
        }
        case "review-task":
        case "agent-task": {
          const issued = await downstream(
            reference.kind === "agent-task" ? "agent-task.read" : "review-audit.read",
          );
          const owner = reference.kind === "agent-task" ? agentTasks : reviewTasks;
          const parents = [
            runtime.runRef,
            ...(parsed.kind === "riskFlow"
              ? [
                  ...(state.identificationRunRef === undefined ? [] : [state.identificationRunRef]),
                  ...state.assessmentRunRefs,
                ]
              : []),
          ];
          for (const parentRunRef of parents) {
            if (
              !isDeepStrictEqual(parentRunRef, runtime.runRef) &&
              !(await transactionUnit.readWorkflowRunBinding({
                projectId: runtime.projectId,
                actorId: runtime.actorId,
                runRef: parentRunRef,
                parentRunRef: runtime.runRef,
              }))
            )
              continue;
            if (
              await owner.verifyCheckpointReference({
                ...input,
                invocationId: issued.invocationId,
                authorization: issued.context,
                taskRef: reference,
                parentRunRef,
              })
            )
              return true;
          }
          return false;
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  };

/** 各识别接缝只适配原 C06 签名，所有派生签发仍走同一作用域。 */
export const createDeploymentIdentificationAuthorizationV1 = ({ access, authorizationScope }) => {
  const runtime = createDeploymentRuntimeAuthorizationV1({ access, authorizationScope });
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
      authorizationScope.resolveInvocationSource(request),
    authorizeHybridRetrievalProjection: (request) =>
      authorizationScope.authorizeCurrent({
        projectId: request.projectId,
        invocationId: request.eventId,
        branch: "knowledge-modeling.identification-basis",
      }),
    identificationContext: {
      issueReadContext: (request) =>
        authorizationScope.authorizeDownstream({
          ...request,
          branch: "knowledge-modeling.identification-basis",
        }),
      verifyCurrent: runtime.verifyCurrent,
    },
    riskCandidateFinalization: {
      issueBranchContext: (request) => authorizationScope.authorizeDownstream(request),
      verifyCurrent: runtime.verifyCurrent,
    },
    identificationGraph: {
      request: access,
      runtime,
      resolveRecoveryAuthorization: ({ event }) =>
        authorizationScope.authorizeCurrent({
          projectId: event.projectId,
          invocationId: event.eventId,
          branch: "risk-identification.plan",
        }),
    },
  });
};

export const createDeploymentAuthorizationScopeV1 = ({
  access,
  deploymentAuthorization,
  policy,
}) => {
  const scope = new AsyncLocalStorage();
  const bindings = new Map(
    policy.bindings.map((binding) => [binding.rootBranch, binding.downstreamBranches]),
  );
  const sourceOf = async (authorization) => {
    const parsed = AuthorizationContextV1Schema.parse(authorization);
    const source = await access.readDeploymentAuthorizationSource({
      authorizationContextRef: parsed.authorizationContextRef,
      projectId: parsed.projectId,
      actorId: parsed.actorId,
    });
    if (source === undefined || !isDeepStrictEqual(source.context, parsed))
      throw new TypeError("DEPLOYMENT_AUTHORIZATION_SOURCE_INVALID");
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
  const authorizeDownstream = async (request) => {
    const current = scope.getStore();
    if (
      current?.source === undefined ||
      request.projectId !== current.source.context.projectId ||
      request.actorId !== current.source.context.actorId
    )
      throw new TypeError("DEPLOYMENT_AUTHORIZATION_SCOPE_MISSING");
    if (current.sessionToken !== undefined) {
      const source = current.source;
      if (!bindings.get(source.branch)?.includes(request.branch))
        throw new TypeError("DEPLOYMENT_AUTHORIZATION_BRANCH_REJECTED");
      const requestedSpatialScopeRefs =
        request.requestedSpatialScopeRefs ?? request.spatialScopeRefs ?? [];
      const requestedSourceVersionRefs = request.requestedSourceVersionRefs ?? [];
      await access.verify({
        authorizationContextRef: source.context.authorizationContextRef,
        projectId: source.context.projectId,
        invocationId: source.invocationId,
        branch: source.branch,
        requestedSpatialScopeRefs,
        requestedSourceVersionRefs,
      });
      const decision = await access.authorize({
        invocationId: request.invocationId,
        projectId: request.projectId,
        branch: request.branch,
        requestedSpatialScopeRefs,
        requestedSourceVersionRefs,
        invocation: { kind: "human-session", sessionToken: current.sessionToken },
      });
      if (decision.context.actorId !== request.actorId)
        throw new TypeError("DEPLOYMENT_AUTHORIZATION_SUBJECT_MISMATCH");
      return decision.context;
    }
    return deploymentAuthorization.resolveDownstreamContext({
      root: current.source.context,
      branch: request.branch,
      invocationId: request.invocationId,
      requestedSpatialScopeRefs:
        request.requestedSpatialScopeRefs ?? request.spatialScopeRefs ?? [],
      requestedSourceVersionRefs: request.requestedSourceVersionRefs ?? [],
      causalRunRef: current.causalRunRef,
      causalCommandRef: current.causalCommandRef,
    });
  };
  return Object.freeze({
    run,
    runRequest: (operation) => scope.run({}, operation),
    authorizeDownstream,
    authorizeCurrent(request) {
      const current = scope.getStore();
      if (current?.source === undefined)
        throw new TypeError("DEPLOYMENT_AUTHORIZATION_SCOPE_MISSING");
      return authorizeDownstream({
        actorId: current.source.context.actorId,
        requestedSpatialScopeRefs: current.source.context.spatialScopeRefs,
        requestedSourceVersionRefs: current.source.sourceVersionRefs,
        ...request,
      });
    },
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
    async runTask(task, operation) {
      return run(
        { authorization: task.envelope.authorization, causalRunRef: task.envelope.parentRunRef },
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
      const causalRunRef =
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
      let causalCommandRef = source.causalCommandRef;
      if (
        causalRunRef === undefined &&
        causalCommandRef === undefined &&
        event.eventType === "knowledge.identification-basis-published.v1" &&
        source.branch === "knowledge-modeling.publish-approved-release" &&
        event.producerCommandId === source.invocationId &&
        event.causationId === source.invocationId
      ) {
        causalCommandRef = {
          kind: "command",
          commandId: source.invocationId,
          authorizationContextRef: source.context.authorizationContextRef,
        };
      }
      return run({ authorization: source.context, causalRunRef, causalCommandRef }, operation);
    },
    access: Object.freeze({
      ...access,
      async authorize(request) {
        const decision = await access.authorize(request);
        if (request.invocation.kind === "human-session") {
          const branches = bindings.get(request.branch);
          if (branches !== undefined)
            await deploymentAuthorization.issueDownstreamContexts({
              root: decision.context,
              sessionToken: request.invocation.sessionToken,
              invocationId: request.invocationId,
              branches,
              requestedSpatialScopeRefs: request.requestedSpatialScopeRefs,
              requestedSourceVersionRefs: request.requestedSourceVersionRefs,
            });
          const current = scope.getStore();
          if (current !== undefined && current.source === undefined) {
            current.source = await sourceOf(decision.context);
            current.sessionToken = request.invocation.sessionToken;
          }
        }
        return decision;
      },
    }),
  });
};

export const createDeploymentAuthorizedArtifactStoreV1 = ({ store, access }) => {
  const verify = async (request) => {
    let decision;
    try {
      decision = await access.verifyDeploymentContext({
        authorizationContextRef: request.authorization.authorizationContextRef,
        projectId: request.projectId,
        actorId: request.actorId,
        requiredCapability: request.requiredCapability,
        requestedSpatialScopeRefs: request.authorization.spatialScopeRefs,
        requestedSourceVersionRefs: [],
        requestedAt: request.requestedAt ?? request.issuedAt,
      });
    } catch (error) {
      const code = error?.details?.code;
      if (code === "ACCESS_TRANSIENT_FAILURE") {
        throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "deployment-context", [], true);
      }
      if (typeof code === "string") {
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "deployment-context");
      }
      throw error;
    }
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
  observe,
}) => {
  const config = DeploymentConfigV1Schema.parse(input);
  const registry = new Map();
  const parentArtifactPreflight = async (request) => {
    for (const artifactRef of request.parentArtifactRefs) {
      const readId = `model-parent-${randomUUID()}`;
      const handle = await artifactStore.open({
        schemaVersion: "1",
        requestId: readId,
        idempotencyKey: readId,
        artifactRef,
        projectId: request.projectId,
        actorId: request.authorization.actorId,
        requestedAt: new Date().toISOString(),
        purposeCode: request.purposeCode,
        requiredCapability: request.requiredCapability,
        authorization: request.authorization,
      });
      for await (const chunk of handle.content) void chunk;
      await handle.verified;
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
  validateCheckpointReference,
}) => {
  const config = DeploymentConfigV1Schema.parse(input);
  // shortcut: 合置验收只使用本地 C04；跨 VM 生产启动在完整 mTLS 装配后开放。
  if (config.purpose !== "synthetic-acceptance") {
    throw new TypeError("DEPLOYMENT_REMOTE_ARTIFACT_CONFIGURATION_REQUIRED");
  }
  const needsCheckpointer = role === "api" || role === "worker";
  if (needsCheckpointer && typeof validateCheckpointReference !== "function") {
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
            validateReference: validateCheckpointReference,
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
