import { isDeepStrictEqual } from "node:util";

import {
  createHybridRetrievalProjectionComposition,
  createIdentificationContextComposition,
  createIdentificationGraphComposition,
  createIdentificationHumanReviewComposition,
  createPostgresDataCleaningComposition,
  createPostgresIdentificationKnowledgeComposition,
  createRiskCandidateFinalizationComposition,
} from "../../../apps/worker/dist/index.js";
import { PostgresRetrievalAdapter } from "../../../packages/adapters/dist/retrieval/index.js";
import { DeploymentAuthorizationError } from "../../../packages/adapters/dist/auth/index.js";
import { createDeploymentAcceptanceRouteReaderV1 } from "../../../packages/adapters/dist/deployment/index.js";
import { createPostgresRiskIdentificationReadAdapter } from "../../../packages/adapters/dist/identification/read/index.js";
import { ArtifactStoreError } from "../../../packages/core/dist/artifacts/index.js";
import {
  acceptanceRouteSetRefFor,
  AcceptanceRouteSetV1Schema,
} from "../../../packages/core/dist/identification/candidate-finalization/index.js";
import { SingleBindingV1 } from "../runtime.mjs";

const required = (value, name) => {
  if (value === undefined || value === null) {
    throw new TypeError(`DEPLOYMENT_IDENTIFICATION_DEPENDENCY_MISSING:${name}`);
  }
  return value;
};

const requiredMethod = (value, name, method) => {
  required(value, name);
  if (typeof value[method] !== "function") {
    throw new TypeError(`DEPLOYMENT_IDENTIFICATION_PORT_INVALID:${name}.${method}`);
  }
  return value;
};

const versionOf = (value) => value?.reference ?? value;
const sameRef = (left, right) => {
  const a = versionOf(left);
  const b = versionOf(right);
  return a?.entityId === b?.entityId && a?.versionId === b?.versionId;
};

const policyResolverFor = (projects, policyType) => ({
  resolveExact: async (input) => {
    const project = projects.get(input.projectId);
    if (project === undefined || input.authorization?.projectId !== input.projectId)
      return undefined;
    return project.policies[policyType];
  },
});

const policyReaderFor = (projects, policyType) => ({
  resolveExact: async (input) => {
    const project = projects.get(input.projectId);
    return project !== undefined && sameRef(input.policyRef, project.binding.policyRefs[policyType])
      ? project.policies[policyType]
      : undefined;
  },
});

const identificationPolicySetProvider = (projects) => ({
  resolveExact: async (input) => {
    const project = projects.get(input.projectId);
    if (project === undefined || input.authorization?.projectId !== input.projectId)
      return undefined;
    return project.policies["identification-graph"].policySetRef;
  },
});

const graphPolicyProvider = (projects) => ({
  resolveExact: async (input) => {
    const project = projects.get(input.projectId);
    if (project === undefined || input.authorization?.projectId !== input.projectId)
      return undefined;
    return project.policies["identification-graph"];
  },
});

export const createRiskCandidatePolicyProviderV1 = (projects) => {
  const member = (input, policyRef, expectedRef, policy) => {
    const project = projects.get(input.projectId);
    if (
      project === undefined ||
      !sameRef(input.policySetRef, project.policies["identification-graph"].policySetRef) ||
      !sameRef(policyRef, expectedRef) ||
      !sameRef(policyRef, policy.policyRef) ||
      !sameRef(policy.policySetRef, input.policySetRef)
    ) {
      return undefined;
    }
    return policy;
  };
  return {
    resolveGeneration: async (input) => {
      const project = projects.get(input.projectId);
      if (
        project === undefined ||
        !sameRef(input.policySetRef, project.policies["identification-graph"].policySetRef) ||
        !sameRef(input.policySetRef, project.policies["risk-candidate"].generation.policySetRef) ||
        !sameRef(
          input.modelDeploymentRef,
          project.policies["identification-graph"].modelDeploymentRef,
        ) ||
        !sameRef(
          input.promptTemplateRef,
          project.policies["identification-graph"].promptTemplateRef,
        )
      ) {
        return undefined;
      }
      return project.policies["risk-candidate"].generation;
    },
    resolveValidation: async (input) => {
      const project = projects.get(input.projectId);
      return project === undefined
        ? undefined
        : member(
            input,
            input.repairPolicyRef,
            project.policies["identification-graph"].repairPolicyRef,
            project.policies["risk-candidate"].validation,
          );
    },
    resolveMerge: async (input) => {
      const project = projects.get(input.projectId);
      return project === undefined
        ? undefined
        : member(
            input,
            input.mergePolicyRef,
            project.policies["identification-graph"].mergePolicyRef,
            project.policies["risk-candidate"].merge,
          );
    },
    resolveConfidence: async (input) => {
      const project = projects.get(input.projectId);
      return project === undefined
        ? undefined
        : member(
            input,
            input.confidencePolicyRef,
            project.policies["identification-graph"].confidencePolicyRef,
            project.policies["risk-candidate"].confidence,
          );
    },
    resolveForcedReview: async (input) => {
      const project = projects.get(input.projectId);
      return project === undefined
        ? undefined
        : member(
            input,
            input.forcedReviewPolicyRef,
            project.policies["identification-graph"].forcedReviewPolicyRef,
            project.policies["risk-candidate"].forcedReview,
          );
    },
  };
};

const deferredPort = (name, methods) => {
  const binding = new SingleBindingV1(name);
  const port = Object.fromEntries(
    methods.map((method) => [method, (...args) => binding.useMethod(method, ...args)]),
  );
  return {
    port,
    get isBound() {
      return binding.isBound;
    },
    bind(value) {
      required(value, name);
      for (const method of methods) requiredMethod(value, name, method);
      binding.bind(value);
    },
  };
};

/** C24 route-set 窄读：先签原 run-read 分支，再按精确登记取得 C04 artifactRef。 */
export const createDeploymentAcceptanceRoutesV1 = ({
  resultStore,
  artifactStore,
  authorizeDownstream,
}) => {
  requiredMethod(resultStore, "resultStore", "readResult");
  requiredMethod(artifactStore, "artifactStore", "open");
  requiredMethod({ authorizeDownstream }, "authorizeDownstream", "authorizeDownstream");
  const reader = createDeploymentAcceptanceRouteReaderV1({
    artifactStore,
    parseRoutes: (raw) => {
      const parsed = AcceptanceRouteSetV1Schema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    },
  });

  return {
    async readRoutes(input) {
      const ref = input.acceptanceRouteSetRef;
      if (
        input.projectId !== input.authorization?.projectId ||
        input.actorId !== input.authorization?.actorId ||
        ref?.kind !== "acceptance-route-set" ||
        typeof ref.reference?.entityId !== "string" ||
        typeof ref.reference?.versionId !== "string"
      ) {
        return undefined;
      }

      let authorization;
      try {
        authorization = await authorizeDownstream({
          projectId: input.projectId,
          actorId: input.actorId,
          branch: "risk-identification.run-read",
          invocationId: `c24-result-row:${input.projectId}:acceptance-route-set:${ref.reference.entityId}:${ref.reference.versionId}`,
          requestedSpatialScopeRefs: input.authorization.spatialScopeRefs,
          requestedSourceVersionRefs: [],
        });
      } catch (error) {
        if (error instanceof DeploymentAuthorizationError) return undefined;
        throw error;
      }
      if (
        authorization === undefined ||
        authorization.projectId !== input.projectId ||
        authorization.actorId !== input.actorId ||
        !authorization.grantedCapabilities.includes("risk-identification.read")
      ) {
        return undefined;
      }

      const row = await resultStore.readResult({
        projectId: input.projectId,
        resultKind: "acceptance-route-set",
        resultId: ref.reference.entityId,
        resultVersionId: ref.reference.versionId,
      });
      if (
        row === undefined ||
        row.projectId !== input.projectId ||
        row.resultKind !== "acceptance-route-set" ||
        row.resultId !== ref.reference.entityId ||
        row.resultVersionId !== ref.reference.versionId ||
        row.acceptanceRouteSetRef?.kind !== "acceptance-route-set" ||
        row.acceptanceRouteSetRef.reference.entityId !== ref.reference.entityId ||
        row.acceptanceRouteSetRef.reference.versionId !== ref.reference.versionId ||
        row.artifactRef?.kind !== "content-artifact"
      ) {
        return undefined;
      }
      const expectedRef = acceptanceRouteSetRefFor({
        projectId: row.projectId,
        workPlanEntityId: row.workPlanRef.reference.entityId,
        requestDigest: row.requestDigest,
      });
      if (
        expectedRef.reference.entityId !== ref.reference.entityId ||
        expectedRef.reference.versionId !== ref.reference.versionId
      ) {
        return undefined;
      }

      let routeSet;
      try {
        routeSet = await reader.readRoutes({
          projectId: input.projectId,
          artifactRef: row.artifactRef.reference,
          authorization,
        });
      } catch (error) {
        if (
          error instanceof ArtifactStoreError &&
          (error.code === "ARTIFACT_ACCESS_DENIED" || error.code === "ARTIFACT_REFERENCE_NOT_FOUND")
        ) {
          return undefined;
        }
        throw error;
      }
      return routeSet?.projectId === input.projectId &&
        routeSet.workPlanRef.reference.entityId === row.workPlanRef.reference.entityId &&
        routeSet.workPlanRef.reference.versionId === row.workPlanRef.reference.versionId &&
        routeSet.mergePlanRef.reference.entityId === row.mergePlanRef.reference.entityId &&
        routeSet.mergePlanRef.reference.versionId === row.mergePlanRef.reference.versionId
        ? routeSet.routes
        : undefined;
    },
  };
};

/**
 * C37 IP-05 的识别生产组合：只装配已发布工厂和宿主 capability ports。
 * 构造引用环在所有工厂完成后一次绑定；调用方须在 API 监听或 Worker claim 前调用 assertReady。
 */
export const createDeploymentIdentificationV1 = (options) => {
  required(options, "options");
  const foundation = required(options.foundation, "foundation");
  const config = required(foundation.config, "foundation.config");
  const db = required(foundation.runtime?.db, "foundation.runtime.db");
  const transactionUnit = required(foundation.transactionUnit, "foundation.transactionUnit");
  const access = requiredMethod(foundation.access, "foundation.access", "authorize");
  requiredMethod(foundation.access, "foundation.access", "verify");
  const artifactStore = requiredMethod(foundation.artifactStore, "foundation.artifactStore", "put");
  requiredMethod(foundation.artifactStore, "foundation.artifactStore", "open");
  const referenceGuard = required(foundation.referenceGuard, "foundation.referenceGuard");
  const monitoringStore = required(foundation.monitoringStore, "foundation.monitoringStore");
  const contextSource = required(foundation.contextSource, "foundation.contextSource");
  const registry = requiredMethod(options.registry, "registry", "register");
  const modelGateway = required(options.modelGateway, "modelGateway");
  const checkpointer = required(options.checkpointer, "checkpointer");
  const idempotentConsumer = required(options.idempotentConsumer, "idempotentConsumer");
  const resolveDeploymentPolicies = requiredMethod(
    options.resolveDeploymentPolicies,
    "resolveDeploymentPolicies",
    "resolveProject",
  );
  const deploymentAuthorization = requiredMethod(
    options.deploymentAuthorization,
    "deploymentAuthorization",
    "issueDownstreamContexts",
  );
  requiredMethod(deploymentAuthorization, "deploymentAuthorization", "resolveDownstreamContext");

  const authorization = required(options.authorization, "authorization");
  const resolveCleaningStartAuthorizationInvocation = requiredMethod(
    authorization,
    "authorization",
    "resolveCleaningStartAuthorizationInvocation",
  ).resolveCleaningStartAuthorizationInvocation;
  const resolveKnowledgeAuthorizationSource = requiredMethod(
    authorization,
    "authorization",
    "resolveKnowledgeAuthorizationSource",
  ).resolveKnowledgeAuthorizationSource;
  const authorizeHybridRetrievalProjection = requiredMethod(
    authorization,
    "authorization",
    "authorizeHybridRetrievalProjection",
  ).authorizeHybridRetrievalProjection;
  const identificationContextAuthorization = requiredMethod(
    authorization.identificationContext,
    "authorization.identificationContext",
    "issueReadContext",
  );
  requiredMethod(
    identificationContextAuthorization,
    "authorization.identificationContext",
    "verifyCurrent",
  );
  const riskCandidateAuthorization = required(
    authorization.riskCandidateFinalization,
    "authorization.riskCandidateFinalization",
  );
  const graphAuthorization = required(
    authorization.identificationGraph,
    "authorization.identificationGraph",
  );
  requiredMethod(graphAuthorization.request, "authorization.identificationGraph.request", "verify");
  requiredMethod(
    graphAuthorization.runtime,
    "authorization.identificationGraph.runtime",
    "verifyCurrent",
  );
  const recoveryAuthorization = requiredMethod(
    authorization.identificationGraph,
    "authorization.identificationGraph",
    "resolveRecoveryAuthorization",
  ).resolveRecoveryAuthorization;

  const review = required(options.review, "review");
  requiredMethod(review.port, "review.port", "requestReview");
  requiredMethod(review.port, "review.port", "decideReview");
  requiredMethod(
    review.pendingReviewReader,
    "review.pendingReviewReader",
    "readPendingIdentificationReview",
  );
  requiredMethod(review.decisionReader, "review.decisionReader", "readIdentificationGroupDecision");
  const scoringBasisResolver = requiredMethod(
    options.scoringBasisResolver,
    "scoringBasisResolver",
    "resolve",
  );
  const agentTaskFailureEvidenceReader = requiredMethod(
    options.agentTaskFailureEvidenceReader,
    "agentTaskFailureEvidenceReader",
    "readTerminalFailure",
  );
  const qualityGate = requiredMethod(options.qualityGate, "qualityGate", "evaluate");
  const acceptanceRoutes = required(options.acceptanceRoutes, "acceptanceRoutes");

  const projectBindings = required(config.projectBindings, "config.projectBindings");
  if (projectBindings.length === 0)
    throw new TypeError("DEPLOYMENT_IDENTIFICATION_PROJECT_BINDINGS_REQUIRED");
  const projects = new Map();
  for (const binding of projectBindings) {
    if (projects.has(binding.projectId))
      throw new TypeError("DEPLOYMENT_IDENTIFICATION_PROJECT_DUPLICATE");
    const project = resolveDeploymentPolicies.resolveProject(binding.projectId);
    if (project.binding.projectId !== binding.projectId) {
      throw new TypeError("DEPLOYMENT_IDENTIFICATION_POLICY_PROJECT_MISMATCH");
    }
    projects.set(binding.projectId, project);
  }

  for (const policyType of ["cleaning", "knowledge-validation", "retrieval-review"]) {
    const bodies = [...projects.values()].map((project) => {
      const body = { ...project.policies[policyType] };
      delete body.projectId;
      return body;
    });
    if (bodies.some((body) => !isDeepStrictEqual(body, bodies[0]))) {
      throw new TypeError(`DEPLOYMENT_SHARED_AGENT_POLICY_MISMATCH:${policyType}`);
    }
  }

  const retrievalBudgetPolicyRefs = projectBindings.map(
    (binding) => binding.retrievalBudgetPolicyRef,
  );
  if (retrievalBudgetPolicyRefs.some((ref) => !sameRef(ref, retrievalBudgetPolicyRefs[0]))) {
    throw new TypeError("DEPLOYMENT_IDENTIFICATION_RETRIEVAL_BUDGET_POLICY_MISMATCH");
  }

  const commonPolicies = [...projects.values()][0].policies;
  const cleaningRetrieval = deferredPort("C15→C20 retrieve", ["retrieve"]);
  const retrievalInput = deferredPort("C20→C21 queryInputReader", ["readQueryInput"]);
  const contextInput = deferredPort("C21←C24 contextInputReader", ["readExact"]);
  const workPlan = deferredPort("C22←C24 workPlanReader", ["readExact"]);

  const riskIdentificationRead = createPostgresRiskIdentificationReadAdapter({
    db,
    artifactStore,
    authorization: access,
  });

  const cleaning = createPostgresDataCleaningComposition({
    store: {
      db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: referenceGuard,
      monitoringStore,
      policy: commonPolicies.cleaning,
    },
    resolveStartAuthorizationInvocation: resolveCleaningStartAuthorizationInvocation,
    registry,
  });

  const knowledge = createPostgresIdentificationKnowledgeComposition({
    db,
    transactionUnit,
    access,
    artifactStore,
    artifactReferenceGuard: referenceGuard,
    preparationRead: cleaning.store,
    engineeringData: contextSource,
    reviewAudit: review.port,
    validationPolicy: commonPolicies["knowledge-validation"],
    assessmentConfigurationPolicy: required(
      options.assessmentConfigurationPolicy,
      "assessmentConfigurationPolicy",
    ),
    scoringRulesPolicy: required(options.scoringRulesPolicy, "scoringRulesPolicy"),
    assessmentBasisResolver: scoringBasisResolver,
    retrievalDelegate: cleaningRetrieval.port,
    policySetProvider: identificationPolicySetProvider(projects),
    agentTaskFailureEvidenceReader,
    resolveAuthorizationSource: resolveKnowledgeAuthorizationSource,
    registry,
  });

  const retrievalStoreOptions = { db, transactionUnit };
  const retrievalStoreReader = new PostgresRetrievalAdapter(retrievalStoreOptions);
  const retrieval = createHybridRetrievalProjectionComposition({
    generationStore: retrievalStoreOptions,
    qdrant: {
      baseUrl: config.qdrant.baseUrl,
      requestTimeoutMs: config.qdrant.requestTimeoutMs,
    },
    transactionUnit,
    idempotentConsumer,
    sourceFacts: knowledge.adapter,
    modelGateway,
    artifactStore,
    policyProvider: policyResolverFor(projects, "hybrid-retrieval"),
    qualityGate,
    queryInputReader: retrievalInput.port,
    authorize: authorizeHybridRetrievalProjection,
    budgetPolicyRef: retrievalBudgetPolicyRefs[0],
  });

  const context = createIdentificationContextComposition({
    db,
    transactionUnit,
    artifactStore,
    inputReader: contextInput.port,
    authorization: identificationContextAuthorization,
    knowledgeReader: knowledge.adapter,
    hybridPolicy: policyReaderFor(projects, "hybrid-retrieval"),
    hybridStore: retrievalStoreReader,
    retrievalService: retrieval.retrievalDelegate,
    taskReader: cleaning.agentTaskAdapter,
    reviewPolicy: commonPolicies["retrieval-review"],
    registry,
  });

  const candidate = createRiskCandidateFinalizationComposition({
    db,
    transactionUnit,
    artifactStore,
    modelGateway,
    review: { requestReview: review.port.requestReview.bind(review.port) },
    modelContextReader: context.service,
    workPlanReader: workPlan.port,
    policyProvider: createRiskCandidatePolicyProviderV1(projects),
    reviewDecisionReader: review.decisionReader,
    authorization: riskCandidateAuthorization,
  });

  const humanReview = createIdentificationHumanReviewComposition({
    pendingReviewReader: review.pendingReviewReader,
    reviewRevision: candidate.service,
    review: { decideReview: review.port.decideReview.bind(review.port) },
  });

  const graph = createIdentificationGraphComposition({
    db,
    transactionUnit,
    artifactStore,
    authorization: graphAuthorization.request,
    runtimeAuthorization: graphAuthorization.runtime,
    checkpointer,
    policyProvider: graphPolicyProvider(projects),
    reviewPolicy: async () => commonPolicies["retrieval-review"],
    basisResolver: knowledge.adapter,
    preparationReader: cleaning.store,
    knowledgeReleaseReader: knowledge.adapter,
    contextService: context.service,
    agentTasks: cleaning.agentTaskAdapter,
    agentTaskReader: cleaning.agentTaskAdapter,
    finalizationService: candidate.service,
    reviewDecisionReader: review.decisionReader,
    acceptanceRoutes,
    recoveryConsumer: idempotentConsumer,
    recoveryAuthorization,
  });

  const delegateBindings = [
    [cleaningRetrieval, retrieval.retrievalDelegate],
    [retrievalInput, context.queryInputReader],
    [contextInput, graph.adapter.contextInputReader],
    [workPlan, graph.adapter.workPlanReader],
  ];
  for (const [slot, target] of delegateBindings) {
    if (slot.isBound) throw new TypeError("DEPLOYMENT_IDENTIFICATION_DELEGATE_ALREADY_BOUND");
    required(target, "identification delegate target");
  }
  for (const [slot, target] of delegateBindings) slot.bind(target);

  const assertReady = () => {
    if (delegateBindings.some(([slot]) => !slot.isBound)) {
      throw new TypeError("DEPLOYMENT_IDENTIFICATION_DELEGATES_NOT_READY");
    }
    return result;
  };

  const result = {
    compositions: { cleaning, knowledge, retrieval, context, candidate, humanReview, graph },
    api: {
      riskIdentification: graph.runtime,
      riskIdentificationRead,
      knowledgeModeling: knowledge.adapter,
    },
    capabilities: { deploymentAuthorization },
    worker: {
      agentTasks: cleaning.agentTaskAdapter,
      handlers: {
        "knowledge.identification-basis-published.v1": (event) =>
          retrieval.projectionHandler.handle(event),
        "review.review-resolved.v1": graph.consumeRecoveryEvent,
      },
    },
    readers: {
      preparation: cleaning.store,
      knowledgeRelease: knowledge.adapter,
      identificationContext: context.adapter,
      identificationContextService: context.service,
      workPlan: graph.adapter.workPlanReader,
      riskIdentification: riskIdentificationRead,
    },
    assertReady,
  };
  return assertReady();
};
