import { TextDecoder, TextEncoder } from "node:util";

import {
  AgentBudgetLedgerV1Schema,
  AgentTaskEnvelopeV1Schema,
  AgentTaskBudgetPolicyV1Schema,
  AgentTaskStateV1Schema,
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
} from "../../../packages/core/dist/agent-runtime/index.js";
import {
  ArtifactReadReceiptV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactRefV1Schema,
} from "../../../packages/core/dist/artifacts/index.js";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
} from "../../../packages/core/dist/assessment-config/index.js";
import {
  CalibrationCandidateV1Schema,
  CalibrationInputSnapshotV1Schema,
  CALIBRATION_AGENT_TASK_TYPE_V1,
  calibrationCandidateDigest,
  deriveCalibrationInputSnapshotRef,
  deriveCalibrationSuggestionRef,
  digestDocument,
  validateCalibrationCandidate,
} from "../../../packages/core/dist/calibration/index.js";
import { canonicalJson } from "../../../packages/core/dist/persistence/index.js";
import {
  STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
  STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1,
} from "../../../packages/core/dist/scoring-rules/index.js";

const MAX_ARTIFACT_BYTES = 1024 * 1024;
const RUNNER_CAPABILITY = "agent-task.start";
// C29 的输入与 C08 校验用途码是私有常量；沿用其既有 C04 协议值。
const INPUT_PURPOSE = "warning-response.calibration-input-snapshot";
const INPUT_MEDIA_TYPE = "application/vnd.riskflow.calibration-input+json";
const VALIDATION_PURPOSE = "agent-validation";
const VALIDATION_MEDIA_TYPE = "application/vnd.riskflow.agent-validation+json";

const sameRef = (left, right) =>
  left?.entityId === right?.entityId && left?.versionId === right?.versionId;
const sameTypedRef = (left, right) =>
  left?.kind === right?.kind && sameRef(left?.reference, right?.reference);
const required = (value, name) => {
  if (value === undefined || value === null)
    throw new TypeError(`CALIBRATION_TASK_DEPENDENCY_MISSING:${name}`);
  return value;
};

const readJson = async ({
  artifactStore,
  artifactRef,
  projectId,
  actorId,
  requestedAt,
  authorization,
  purposeCode,
  mediaType,
  requestId,
}) => {
  const handle = await artifactStore.open({
    schemaVersion: "1",
    requestId,
    idempotencyKey: requestId,
    artifactRef,
    projectId,
    actorId,
    requestedAt,
    purposeCode,
    requiredCapability: RUNNER_CAPABILITY,
    authorization,
  });
  const verified = handle.verified.then(
    (receipt) => ({ receipt }),
    (error) => ({ error }),
  );
  let failure;
  if (
    !sameTypedRef(handle.manifest.artifactRef, artifactRef) ||
    handle.manifest.purposeCode !== purposeCode ||
    handle.manifest.mediaType !== mediaType ||
    handle.manifest.content.byteLength > MAX_ARTIFACT_BYTES
  )
    failure = new TypeError("CALIBRATION_TASK_ARTIFACT_BINDING_INVALID");
  const chunks = [];
  let byteLength = 0;
  try {
    for await (const chunk of handle.content) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_ARTIFACT_BYTES) {
        failure ??= new RangeError("CALIBRATION_TASK_ARTIFACT_TOO_LARGE");
      } else {
        chunks.push(chunk);
      }
    }
  } catch (error) {
    failure ??= error;
  }
  const verification = await verified;
  if (failure !== undefined) throw failure;
  if ("error" in verification) throw verification.error;
  const receipt = ArtifactReadReceiptV1Schema.parse(verification.receipt);
  if (
    !sameTypedRef(receipt.artifactRef, artifactRef) ||
    receipt.content.byteLength !== byteLength ||
    handle.manifest.content.byteLength !== byteLength ||
    receipt.content.hash.algorithm !== handle.manifest.content.hash.algorithm ||
    receipt.content.hash.value !== handle.manifest.content.hash.value
  )
    throw new TypeError("CALIBRATION_TASK_ARTIFACT_UNVERIFIED");
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};

/** C29 的 C08 任务接缝：只读取冻结 C04 正文并保存真实确定性校验工件。 */
export const createDeploymentCalibrationTaskPortV1 = ({ artifactStore, access }) => {
  required(artifactStore, "artifactStore");
  required(access, "access");
  if (typeof artifactStore.open !== "function" || typeof artifactStore.put !== "function") {
    throw new TypeError("CALIBRATION_TASK_ARTIFACT_STORE_INVALID");
  }
  if (typeof access.verifyDeploymentContext !== "function") {
    throw new TypeError("CALIBRATION_TASK_ACCESS_INVALID");
  }

  const resolve = async ({ task: inputTask, candidate: inputCandidate, stage }) => {
    const task = {
      ...inputTask,
      envelope: AgentTaskEnvelopeV1Schema.parse(inputTask.envelope),
      state: AgentTaskStateV1Schema.parse(inputTask.state),
      budgetPolicy: AgentTaskBudgetPolicyV1Schema.parse(inputTask.budgetPolicy),
      budgetLedger: AgentBudgetLedgerV1Schema.parse(inputTask.budgetLedger),
    };
    const envelope = task.envelope;
    const candidate = CalibrationCandidateV1Schema.parse(inputCandidate);
    if (
      envelope.taskType !== CALIBRATION_AGENT_TASK_TYPE_V1 ||
      envelope.triggerMode !== "embedded" ||
      task.state.status !== "running" ||
      !sameTypedRef(task.state.agentTaskRef, envelope.agentTaskRef) ||
      envelope.projectId !== envelope.authorization.projectId ||
      envelope.actorId !== envelope.authorization.actorId ||
      !envelope.authorization.grantedCapabilities.includes(RUNNER_CAPABILITY) ||
      !sameRef(task.budgetPolicy.policyRef, envelope.budgetPolicyRef) ||
      !sameRef(task.budgetPolicy.modelDeploymentRef, envelope.modelDeploymentRef) ||
      !sameRef(task.budgetPolicy.promptTemplateRef, envelope.promptTemplateRef) ||
      !sameRef(task.budgetPolicy.toolPolicyRef, envelope.toolPolicyRef) ||
      !sameTypedRef(candidate.taskRef, envelope.agentTaskRef) ||
      candidate.resultRef.status !== "completed" ||
      !sameTypedRef(candidate.resultRef.agentTaskRef, envelope.agentTaskRef) ||
      candidate.resultRef.candidateRef?.kind !== "calibration-suggestion" ||
      canonicalJson(candidate.resultRef) !==
        canonicalJson(
          buildCompletedAgentTaskResult(envelope.agentTaskRef, candidate.resultRef.candidateRef),
        )
    )
      throw new TypeError("CALIBRATION_TASK_BINDING_INVALID");

    const requestedAt = new Date().toISOString();
    const authorizationDecision = await access.verifyDeploymentContext({
      authorizationContextRef: envelope.authorization.authorizationContextRef,
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      requiredCapability: RUNNER_CAPABILITY,
      requestedSpatialScopeRefs: envelope.authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
      requestedAt,
    });
    const authorization = authorizationDecision.context;
    if (
      authorization.projectId !== envelope.projectId ||
      authorization.actorId !== envelope.actorId ||
      authorization.grantedCapabilities.length !== 1 ||
      !authorization.grantedCapabilities.includes(RUNNER_CAPABILITY) ||
      canonicalJson(authorization.spatialScopeRefs) !==
        canonicalJson(envelope.authorization.spatialScopeRefs)
    )
      throw new TypeError("CALIBRATION_TASK_RUNNER_UNAUTHORIZED");

    const snapshot = CalibrationInputSnapshotV1Schema.parse(
      await readJson({
        artifactStore,
        artifactRef: envelope.frozenInputRef,
        projectId: envelope.projectId,
        actorId: envelope.actorId,
        requestedAt,
        authorization,
        purposeCode: INPUT_PURPOSE,
        mediaType: INPUT_MEDIA_TYPE,
        requestId: `${envelope.agentTaskRef.reference.entityId}:calibration-input`,
      }),
    );
    const derived = deriveCalibrationInputSnapshotRef({
      projectId: snapshot.projectId,
      deviationFactRef: snapshot.deviationFactRef.reference,
      targetReleaseRef: snapshot.targetReleaseRef.reference,
      calibrationValidationPolicyRef: snapshot.calibrationValidationPolicyRef,
    });
    if (
      snapshot.projectId !== envelope.projectId ||
      !sameRef(snapshot.modelDeploymentRef, envelope.modelDeploymentRef) ||
      !sameRef(snapshot.promptTemplateRef, envelope.promptTemplateRef) ||
      !sameRef(snapshot.toolPolicyRef, envelope.toolPolicyRef) ||
      !sameRef(snapshot.budgetPolicyRef, envelope.budgetPolicyRef) ||
      !sameRef(snapshot.calibrationValidationPolicyRef, envelope.validationPolicyRef) ||
      !sameRef(candidate.inputSnapshotRef.reference, derived.reference)
    )
      throw new TypeError("CALIBRATION_TASK_SNAPSHOT_BINDING_INVALID");

    const targetIsRule = snapshot.targetDefinitionType === "structured-scoring-rule";
    const document = await readJson({
      artifactStore,
      artifactRef: snapshot.baseArtifactRef,
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      requestedAt,
      authorization,
      purposeCode: targetIsRule
        ? STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1
        : ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
      mediaType: targetIsRule
        ? STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1
        : ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
      requestId: `${envelope.agentTaskRef.reference.entityId}:calibration-base`,
    });
    if (digestDocument(snapshot.targetDefinitionType, document) !== snapshot.baseContentDigest) {
      throw new TypeError("CALIBRATION_TASK_BASE_DIGEST_MISMATCH");
    }
    const outcome = validateCalibrationCandidate({
      definitionType: snapshot.targetDefinitionType,
      document,
      candidate,
    });
    const items = outcome.validation.items.map((item) => {
      const check = {
        checkId: `calibration-operation-${item.operationIndex}`,
        disposition: item.disposition,
        reasonCode: item.reasonCode ?? "calibration-operation-valid",
        evidenceReferences: [],
      };
      return item.disposition === "rejected"
        ? { ...check, rejectionClass: outcome.validation.rejectionClass }
        : check;
    });
    const candidateDigest = calibrationCandidateDigest(candidate);
    const artifactId = `calibration-validation-${stage}-${envelope.agentTaskRef.reference.entityId}-${candidateDigest.slice(0, 24)}`;
    const validationPayload = {
      schemaVersion: "1",
      taskRef: envelope.agentTaskRef,
      candidateDigest,
      validation: outcome.validation,
    };
    const bytes = new TextEncoder().encode(canonicalJson(validationPayload));
    const validationArtifactRef = ArtifactRefV1Schema.parse(
      (
        await artifactStore.put(
          ArtifactPutCommandV1Schema.parse({
            schemaVersion: "1",
            commandId: artifactId,
            idempotencyKey: artifactId,
            projectId: envelope.projectId,
            actorId: envelope.actorId,
            issuedAt: envelope.createdAt,
            authorization,
            requiredCapability: RUNNER_CAPABILITY,
            artifactId,
            artifactKind: "content",
            purposeCode: VALIDATION_PURPOSE,
            mediaType: VALIDATION_MEDIA_TYPE,
            parentArtifactRefs: [envelope.frozenInputRef, snapshot.baseArtifactRef].sort((a, b) =>
              `${a.kind}:${a.reference.entityId}:${a.reference.versionId}`.localeCompare(
                `${b.kind}:${b.reference.entityId}:${b.reference.versionId}`,
              ),
            ),
            evidenceReferences: [],
            additionalSpatialScopeRefs: [],
            additionalSourceAccessGrantRefs: [],
          }),
          (async function* () {
            yield bytes;
          })(),
        )
      ).artifactRef,
    );
    const validation = AgentValidationResultV1Schema.parse({
      schemaVersion: "1",
      items,
      disposition: outcome.validation.disposition,
      ...(outcome.validation.disposition === "rejected"
        ? { rejectionClass: outcome.validation.rejectionClass }
        : {}),
      validationArtifactRef,
      validatedAt: envelope.createdAt,
    });
    return { outcome, validation, snapshot };
  };

  return Object.freeze({
    async validateIncrement(input) {
      return (await resolve({ ...input, stage: "validate" })).validation;
    },
    async finalizeIncrement(input) {
      const { task, candidate } = input;
      const { outcome, validation, snapshot } = await resolve({ ...input, stage: "finalize" });
      if (outcome.validation.disposition !== "accepted" || outcome.contentDigest === undefined) {
        throw new TypeError("CALIBRATION_TASK_CANDIDATE_REJECTED");
      }
      const envelope = AgentTaskEnvelopeV1Schema.parse(task.envelope);
      const suggestionRef = deriveCalibrationSuggestionRef({
        deviationRecordRef: snapshot.deviationRecordRef.reference,
        agentTaskResultRef: candidate.resultRef.reference,
        calibrationValidationPolicyRef: snapshot.calibrationValidationPolicyRef,
        candidateDigest: outcome.contentDigest,
      });
      return buildCompletedAgentTaskResult(
        envelope.agentTaskRef,
        suggestionRef,
        { kind: "validation-snapshot", reference: validation.validationArtifactRef.reference },
        ["calibration-suggestion"],
      );
    },
  });
};
