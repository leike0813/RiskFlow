import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1,
  RiskInputFactsReadRequestV1Schema,
} from "../../../packages/core/dist/risk-assessment/engine/index.js";
import { createRiskFlowGraphComposition } from "../../../apps/worker/dist/risk-flow/index.js";
import { DeploymentAuthorizationError } from "../../../packages/adapters/dist/auth/index.js";
import { createPostgresHumanDecisionFeedbackAdapter } from "../../../packages/adapters/dist/human-decision-feedback/index.js";
import { SingleBindingV1 } from "../runtime.mjs";

const required = (value, name) => {
  if (value === undefined || value === null) {
    throw new TypeError(`DEPLOYMENT_RISK_FLOW_DEPENDENCY_MISSING:${name}`);
  }
  return value;
};

const requiredMethod = (value, name, method) => {
  required(value, name);
  if (typeof value[method] !== "function") {
    throw new TypeError(`DEPLOYMENT_RISK_FLOW_PORT_INVALID:${name}.${method}`);
  }
  return value;
};

const sameRef = (left, right) =>
  left?.entityId === right?.entityId && left?.versionId === right?.versionId;

const sameTypedRef = (left, right) =>
  left?.kind === right?.kind && sameRef(left?.reference, right?.reference);

/** 长图先在回执事务外推进；回执提交失败后按已提交事实补回执。 */
export const createDeploymentRiskFlowEventConsumerV1 = ({
  consumer,
  adapter,
  eventRuntime,
  authorizationScope,
  access,
}) => {
  requiredMethod(consumer, "consumer", "consume");
  requiredMethod(adapter, "adapter", "readEventParentRun");
  requiredMethod(adapter, "adapter", "verifyEventConsumption");
  return async (event, { source, independent = false }, { signal } = {}) => {
    signal?.throwIfAborted();
    const prepared = event.eventType === "engineering.inputs-ready.v1";
    if (!prepared && event.eventType !== "identification.risk-record-accepted.v1")
      throw new TypeError("DEPLOYMENT_RISK_FLOW_EVENT_INVALID");
    const verifySource = async () => {
      const decision = await access.verify({
        authorizationContextRef: source.context.authorizationContextRef,
        invocationId: source.invocationId,
        projectId: event.projectId,
        branch: source.branch,
        requestedSpatialScopeRefs: source.context.spatialScopeRefs,
        requestedSourceVersionRefs: source.sourceVersionRefs,
      });
      if (
        decision.redacted ||
        !sameTypedRef(
          decision.context.authorizationContextRef,
          source.context.authorizationContextRef,
        ) ||
        !isDeepStrictEqual(decision.context, source.context)
      )
        throw new TypeError("DEPLOYMENT_EVENT_AUTHORIZATION_DENIED");
    };
    await verifySource();
    if ((prepared && event.payload.preparation.kind === "assessment") || independent) {
      return consumer.consume("risk-flow", event, async () => {
        await verifySource();
        return { resultRef: event.aggregateRef };
      });
    }
    const commandId = `risk-flow-event:${event.eventId}`;
    const authorization = await authorizationScope.authorizeCurrent({
      projectId: event.projectId,
      actorId: source.context.actorId,
      invocationId: commandId,
      branch: "workflow.resume-run",
    });
    const issued = await access.readDeploymentAuthorizationSource({
      authorizationContextRef: authorization.authorizationContextRef,
      projectId: event.projectId,
      actorId: source.context.actorId,
    });
    if (issued === undefined) throw new TypeError("DEPLOYMENT_EVENT_RESUME_SOURCE_MISSING");
    const input = {
      projectId: event.projectId,
      actorId: source.context.actorId,
      invocationId: issued.invocationId,
      requestedAt: new Date().toISOString(),
      authorization,
    };
    const runRef = await adapter.readEventParentRun({
      ...input,
      ...(prepared
        ? { runRef: required(source.causalRunRef, "event causalRunRef") }
        : { identificationRunRef: event.payload.identificationRunRef }),
    });
    if (runRef === undefined) throw new TypeError("DEPLOYMENT_EVENT_PARENT_PENDING");
    const cause = prepared
      ? {
          kind: "inputs-ready",
          identificationPreparationSnapshotRef:
            event.payload.preparation.identificationPreparationSnapshotRef,
        }
      : {
          kind: "risk-record-accepted",
          identificationRunRef: event.payload.identificationRunRef,
          riskRecordRef: event.payload.standardizedRiskRecordRef,
        };
    const proof = { ...input, runRef, cause };
    if (!(await adapter.verifyEventConsumption(proof))) {
      signal?.throwIfAborted();
      const command = {
        ...input,
        commandId,
        idempotencyKey: commandId,
        issuedAt: event.occurredAt,
        runRef,
        authorizationBranch: "workflow.resume-run",
      };
      await (prepared
        ? eventRuntime.applyIdentificationPreparation({
            ...command,
            identificationPreparationSnapshotRef: cause.identificationPreparationSnapshotRef,
          })
        : eventRuntime.applyAcceptedRisk({
            ...command,
            identificationRunRef: cause.identificationRunRef,
            riskRecordRef: cause.riskRecordRef,
          }));
    }
    signal?.throwIfAborted();
    // 即使原 consumer 已有回执，也先复验当前权限和消费事实。
    if (!(await adapter.verifyEventConsumption(proof)))
      throw new TypeError("DEPLOYMENT_EVENT_CONSUMPTION_UNPROVEN");
    return consumer.consume("risk-flow", event, async () => {
      await verifySource();
      if (!(await adapter.verifyEventConsumption(proof)))
        throw new TypeError("DEPLOYMENT_EVENT_CONSUMPTION_UNPROVEN");
      return { resultRef: runRef };
    });
  };
};

/** C41 与 C30/C26 共用一个 PostgreSQL adapter；C30 workflow 在图创建后单次绑定。 */
export const createDeploymentHumanDecisionFeedbackV1 = (options) => {
  required(options, "options");
  const foundation = required(options.foundation, "foundation");
  const workflowBinding = new SingleBindingV1("C41→C30 workflow");
  const bindingProofBinding = new SingleBindingV1("C41→C30 binding proof");
  const runCompletionProofBinding = new SingleBindingV1("C41→C30 completion proof");
  const routeDecisionsBinding = requiredMethod(
    options.routeDecisionsBinding,
    "routeDecisionsBinding",
    "bind",
  );
  if (routeDecisionsBinding.isBound !== false) {
    throw new TypeError("DEPLOYMENT_HUMAN_DECISION_FEEDBACK_BINDING_ALREADY_CLOSED");
  }
  const authorizeDownstream = required(options.authorizeDownstream, "authorizeDownstream");
  if (typeof authorizeDownstream !== "function") {
    throw new TypeError("DEPLOYMENT_RISK_FLOW_PORT_INVALID:authorizeDownstream");
  }
  const adapter = createPostgresHumanDecisionFeedbackAdapter({
    db: required(foundation.runtime?.db, "foundation.runtime.db"),
    transactionUnit: requiredMethod(
      foundation.transactionUnit,
      "foundation.transactionUnit",
      "execute",
    ),
    access: requiredMethod(foundation.access, "foundation.access", "verify"),
    authorizeDownstream,
    workflow: {
      startRun: async (...args) => workflowBinding.useMethod("startRun", ...args),
      resumeRun: async (...args) => workflowBinding.useMethod("resumeRun", ...args),
      cancelRun: async (...args) => workflowBinding.useMethod("cancelRun", ...args),
    },
    bindingProof: {
      verifyResponseWorkflowBinding: async (...args) =>
        bindingProofBinding.useMethod("verifyResponseWorkflowBinding", ...args),
    },
    assessmentProof: requiredMethod(
      options.assessmentProof,
      "assessmentProof",
      "verifyActualAssessment",
    ),
    runCompletionProof: {
      verifyWorkflowRunCompletion: async (...args) =>
        runCompletionProofBinding.useMethod("verifyWorkflowRunCompletion", ...args),
    },
    responseLifecycle: [
      "recordDecision",
      "forecastResponse",
      "recordExecution",
      "recordFeedback",
      "calculateDeviation",
    ].reduce(
      (service, method) => requiredMethod(service, "responseLifecycle", method),
      required(options.responseLifecycle, "responseLifecycle"),
    ),
    responseContext: requiredMethod(
      options.responseContext,
      "responseContext",
      "readRecommendationContext",
    ),
    ...(options.resolveFeedbackPolicies === undefined
      ? {}
      : { resolveFeedbackPolicies: options.resolveFeedbackPolicies }),
    workflowStartControl: {
      graphVersion: required(
        options.workflowStartControl?.graphVersion,
        "workflowStartControl.graphVersion",
      ),
      retryPolicyRef: required(
        options.workflowStartControl?.retryPolicyRef,
        "workflowStartControl.retryPolicyRef",
      ),
    },
  });
  requiredMethod(adapter, "humanDecisionFeedbackAdapter", "record");
  requiredMethod(adapter, "humanDecisionFeedbackAdapter", "verifyHumanDecisionCommitted");
  requiredMethod(adapter, "humanDecisionFeedbackAdapter", "readRouteDecision");

  routeDecisionsBinding.bind(adapter);

  return {
    humanDecisionFeedback: adapter,
    humanDecisionProof: adapter,
    routeDecisions: adapter,
    bindC30: ({ workflow, bindingProof, runCompletionProof }) => {
      requiredMethod(workflow, "workflow", "startRun");
      requiredMethod(workflow, "workflow", "resumeRun");
      requiredMethod(workflow, "workflow", "cancelRun");
      requiredMethod(bindingProof, "bindingProof", "verifyResponseWorkflowBinding");
      requiredMethod(runCompletionProof, "runCompletionProof", "verifyWorkflowRunCompletion");
      workflowBinding.bind(workflow);
      bindingProofBinding.bind(bindingProof);
      return runCompletionProofBinding.bind(runCompletionProof);
    },
  };
};

/** C30 只把已验收记录登记的精确空间映射到入口配对；读与授权仍归所属模块。 */
export const createDeploymentRiskSpatialPairingV1 = ({ riskInputFacts, authorizeDownstream }) => {
  requiredMethod(riskInputFacts, "riskInputFacts", "readDeploymentRiskScopes");
  requiredMethod({ authorizeDownstream }, "authorizeDownstream", "authorizeDownstream");

  return {
    async resolve(input) {
      if (
        input.riskRecordRef?.kind !== "standardized-risk-record" ||
        input.identificationRunRef?.kind !== "workflow-run" ||
        input.projectId !== input.authorization?.projectId ||
        input.actorId !== input.authorization?.actorId
      ) {
        return undefined;
      }

      const requestId = randomUUID();
      let authorization;
      try {
        authorization = await authorizeDownstream({
          projectId: input.projectId,
          actorId: input.actorId,
          branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.riskInputFacts,
          invocationId: requestId,
          requestedSpatialScopeRefs: input.authorization.spatialScopeRefs,
        });
      } catch (error) {
        if (error instanceof DeploymentAuthorizationError) return undefined;
        throw error;
      }
      if (
        authorization === undefined ||
        authorization.projectId !== input.projectId ||
        authorization.actorId !== input.actorId
      ) {
        return undefined;
      }

      const request = RiskInputFactsReadRequestV1Schema.parse({
        requestId,
        idempotencyKey: requestId,
        requestedAt: input.requestedAt,
        authorization,
        riskInput: input.riskRecordRef,
      });
      const facts = await riskInputFacts.readDeploymentRiskScopes(request);
      if (
        facts === undefined ||
        !sameTypedRef(facts.identificationRunRef, input.identificationRunRef)
      ) {
        return undefined;
      }

      const matches = input.pairings.filter((pairing) =>
        facts.spatialScopeRefs.some((scope) => sameTypedRef(pairing.spatialScopeRef, scope)),
      );
      return matches.length === 1 ? matches[0].spatialScopeRef : undefined;
    },
  };
};

/** C30 父图按工程冻结版本装配；入口 DTO 由原 WorkflowPortV1 完整解析。 */
export const createDeploymentRiskFlowV1 = (options) => {
  required(options, "options");
  const foundation = required(options.foundation, "foundation");
  const db = required(foundation.runtime?.db, "foundation.runtime.db");
  const transactionUnit = requiredMethod(
    foundation.transactionUnit,
    "foundation.transactionUnit",
    "execute",
  );
  const artifactStore = requiredMethod(foundation.artifactStore, "foundation.artifactStore", "put");
  requiredMethod(artifactStore, "foundation.artifactStore", "open");
  const authorization = requiredMethod(foundation.access, "foundation.access", "verify");
  const checkpointer = requiredMethod(options.checkpointer, "checkpointer", "getTuple");
  const resolveProject = requiredMethod(
    options.resolveDeploymentPolicies,
    "resolveDeploymentPolicies",
    "resolveProject",
  );
  const identificationRuntime = required(options.identificationRuntime, "identificationRuntime");
  const assessmentRuntime = required(options.assessmentRuntime, "assessmentRuntime");
  const riskSpatialPairing = requiredMethod(
    options.riskSpatialPairing,
    "riskSpatialPairing",
    "resolve",
  );
  const runtimeAuthorization = requiredMethod(
    options.runtimeAuthorization,
    "runtimeAuthorization",
    "verifyCurrent",
  );
  const humanDecisionProof = requiredMethod(
    options.humanDecisionProof,
    "humanDecisionProof",
    "verifyHumanDecisionCommitted",
  );
  const identificationPreparation = requiredMethod(
    options.identificationPreparation,
    "identificationPreparation",
    "read",
  );
  const bindings = required(
    foundation.config?.projectBindings,
    "foundation.config.projectBindings",
  );
  if (bindings.length === 0) throw new TypeError("DEPLOYMENT_RISK_FLOW_PROJECT_BINDINGS_REQUIRED");

  const compositions = new Map();
  for (const binding of bindings) {
    if (compositions.has(binding.projectId)) {
      throw new TypeError("DEPLOYMENT_RISK_FLOW_PROJECT_DUPLICATE");
    }
    const project = resolveProject.resolveProject(binding.projectId);
    if (project.binding?.projectId !== binding.projectId) {
      throw new TypeError("DEPLOYMENT_RISK_FLOW_POLICY_PROJECT_MISMATCH");
    }
    const retryPolicyRef = binding.policyRefs?.retry;
    const retryPolicy = project.policies?.retry;
    if (
      retryPolicyRef === undefined ||
      !sameRef(project.binding.policyRefs?.retry, retryPolicyRef) ||
      !sameRef(retryPolicy?.policyRef, retryPolicyRef)
    ) {
      throw new TypeError("DEPLOYMENT_RISK_FLOW_RETRY_POLICY_REF_MISMATCH");
    }
    const graphVersions = required(binding.graphVersions, "binding.graphVersions");
    required(graphVersions.riskFlow, "graphVersions.riskFlow");
    const subGraphVersions = {
      identification: required(graphVersions.identification, "graphVersions.identification"),
      assessment: required(graphVersions.assessment, "graphVersions.assessment"),
    };
    const composition = createRiskFlowGraphComposition({
      db,
      transactionUnit,
      artifactStore,
      authorization,
      runtimeAuthorization,
      humanDecisionProof,
      identificationPreparation,
      checkpointer,
      identificationRuntime,
      assessmentRuntime,
      riskSpatialPairing,
      retryPolicy: {
        read: async (input) =>
          input.projectId === binding.projectId && sameRef(input.retryPolicyRef, retryPolicyRef)
            ? { maxAttempts: retryPolicy.maxAttempts, backoffMs: retryPolicy.backoffMs }
            : undefined,
      },
      subGraphVersions,
      retryPolicyRef,
    });
    compositions.set(binding.projectId, composition);
  }

  const compositionFor = (projectId) => {
    const composition = compositions.get(projectId);
    if (composition === undefined)
      throw new TypeError("DEPLOYMENT_RISK_FLOW_PROJECT_BINDING_MISSING");
    return composition;
  };
  const workflow = {
    async startRun(command) {
      const binding = bindings.find(({ projectId }) => projectId === command.projectId);
      if (
        binding === undefined ||
        !sameRef(command.payload?.graphVersion, binding.graphVersions.riskFlow) ||
        !sameRef(command.payload?.retryPolicyRef, binding.policyRefs.retry)
      ) {
        throw new TypeError("DEPLOYMENT_RISK_FLOW_START_BINDING_MISMATCH");
      }
      return compositionFor(command.projectId).runtime.workflowPort.startRun(command);
    },
    resumeRun(command) {
      return compositionFor(command.projectId).runtime.workflowPort.resumeRun(command);
    },
    cancelRun(command) {
      return compositionFor(command.projectId).runtime.workflowPort.cancelRun(command);
    },
  };
  const eventRuntime = {
    applyIdentificationPreparation(input) {
      return compositionFor(input.projectId).runtime.applyIdentificationPreparation(input);
    },
    applyAcceptedRisk(input) {
      return compositionFor(input.projectId).runtime.applyAcceptedRisk(input);
    },
  };

  return {
    compositions,
    api: { workflow },
    eventRuntime,
    adapter: new Map([...compositions].map(([projectId, value]) => [projectId, value.adapter])),
    readers: new Map(
      [...compositions].map(([projectId, value]) => [
        projectId,
        { entriesRead: value.adapter.entriesRead, runRead: value.adapter.runRead },
      ]),
    ),
  };
};
