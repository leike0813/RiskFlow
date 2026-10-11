import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";

import { describe, expect, it } from "vitest";

import {
  AgentTaskEnvelopeV1Schema,
  buildCompletedAgentTaskResult,
} from "../../packages/core/dist/agent-runtime/index.js";
import { ArtifactReadReceiptV1Schema } from "../../packages/core/dist/artifacts/index.js";
import {
  RiskMatrixDocumentV1Schema,
  assessmentConfigurationDocumentDigest,
} from "../../packages/core/dist/assessment-config/index.js";
import {
  CalibrationCandidateV1Schema,
  deriveCalibrationInputSnapshotRef,
} from "../../packages/core/dist/calibration/index.js";
import { canonicalJson } from "../../packages/core/dist/persistence/index.js";
import { createDeploymentCalibrationTaskPortV1 } from "./composition/calibration-task.mjs";

const ref = (entityId, versionId = "1") => ({ entityId, versionId });
const taskRef = {
  kind: "agent-task",
  reference: ref("calibration-task"),
  taskType: "calibration-suggestion",
  triggerMode: "embedded",
  modelDeploymentRef: ref("model"),
  promptTemplateRef: ref("prompt"),
  toolPolicyRef: ref("tools"),
  budgetPolicyRef: ref("budget"),
  incrementSchemaRef: ref("increment"),
  validationPolicyRef: ref("validation"),
};
const authorization = {
  schemaVersion: "1",
  authorizationContextRef: { kind: "authorization-context", reference: ref("auth") },
  actorId: "operator",
  projectId: "project",
  grantedCapabilities: ["agent-task.start"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: ref("auth-policy"),
  decidedAt: "2026-01-01T00:00:00.000Z",
  invocation: { kind: "human" },
};
const frozenAuthorization = {
  schemaVersion: "1",
  authorizationContextRef: authorization.authorizationContextRef,
  projectId: authorization.projectId,
  actorId: authorization.actorId,
  grantedCapabilities: authorization.grantedCapabilities,
  spatialScopeRefs: authorization.spatialScopeRefs,
  sourceAccessGrantRefs: authorization.sourceAccessGrantRefs,
  authorizationPolicyRef: authorization.authorizationPolicyRef,
  capturedAt: "2026-01-01T00:00:00.000Z",
};
const budgetPolicy = {
  schemaVersion: "1",
  policyRef: ref("budget"),
  modelDeploymentRef: ref("model"),
  promptTemplateRef: ref("prompt"),
  toolPolicyRef: ref("tools"),
  maxModelInvocations: 4,
  maxToolInvocations: 2,
  maxContextTokens: 4096,
  maxInputBytes: 65536,
  maxOutputBytes: 65536,
  maxCandidates: 4,
  maxObjects: 8,
  maxSupplementarySearches: 1,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 60000,
};
const baseDocument = () =>
  RiskMatrixDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType: "risk-matrix",
    projectRevisionRef: { kind: "project-revision", reference: ref("project-revision") },
    configurationSetRef: ref("configuration-set"),
    content: {
      matrixId: "matrix",
      matrixVersion: "1",
      possibilityAxis: { bands: [{ bandId: "p1", lower: "0", upper: "1" }] },
      consequenceAxis: { bands: [{ bandId: "c1", lower: "0", upper: "1" }] },
      riskLevels: [{ levelId: "low", ordinal: 1 }],
      cells: [{ possibilityBandId: "p1", consequenceBandId: "c1", riskLevelId: "low" }],
    },
  });
const snapshotRef = deriveCalibrationInputSnapshotRef({
  projectId: "project",
  deviationFactRef: ref("deviation-fact"),
  targetReleaseRef: ref("target-release"),
  calibrationValidationPolicyRef: ref("validation"),
});
const inputSnapshot = (overrides = {}) => ({
  schemaVersion: "1",
  projectId: "project",
  deviationFactRef: { kind: "response-deviation-fact", reference: ref("deviation-fact") },
  deviationRecordRef: { kind: "deviation-record", reference: ref("deviation-record") },
  frozenAssessmentBasisRef: {
    kind: "assessment-input-snapshot",
    reference: ref("assessment-input"),
  },
  basisReleaseSetRef: { kind: "assessment-basis-release-set", reference: ref("basis-set") },
  targetDefinitionType: "risk-matrix",
  targetReleaseRef: { kind: "knowledge-release", reference: ref("target-release") },
  baseArtifactRef: {
    kind: "content-artifact",
    reference: ref("base-artifact", `sha256:${"a".repeat(64)}`),
  },
  baseContentDigest: assessmentConfigurationDocumentDigest(baseDocument()),
  calibrationValidationPolicyRef: ref("validation"),
  modelDeploymentRef: ref("model"),
  promptTemplateRef: ref("prompt"),
  toolPolicyRef: ref("tools"),
  budgetPolicyRef: ref("budget"),
  preparedBy: "operator",
  preparedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const task = (frozenInputRef) => {
  const envelope = AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: "start-task",
    idempotencyKey: "start-task",
    taskType: "calibration-suggestion",
    triggerMode: "embedded",
    projectId: "project",
    actorId: "operator",
    parentRunRef: { kind: "workflow-run", reference: ref("run") },
    frozenInputRef,
    modelDeploymentRef: ref("model"),
    promptTemplateRef: ref("prompt"),
    toolPolicyRef: ref("tools"),
    budgetPolicyRef: ref("budget"),
    incrementSchemaRef: ref("increment"),
    validationPolicyRef: ref("validation"),
    authorization,
    frozenAuthorization,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  return {
    envelope,
    state: {
      schemaVersion: "1",
      agentTaskRef: taskRef,
      status: "running",
      taskVersion: 2,
      cancelRequested: false,
      updatedAt: envelope.createdAt,
    },
    budgetPolicy,
    budgetLedger: {
      schemaVersion: "1",
      reserved: {
        modelInvocations: 0,
        toolInvocations: 0,
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: 0,
        inputBytes: 0,
        outputBytes: 0,
        candidates: 0,
        objects: 0,
        supplementarySearches: 0,
        corrections: 0,
        transientRetries: 0,
      },
      used: {
        modelInvocations: 0,
        toolInvocations: 0,
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: 0,
        inputBytes: 0,
        outputBytes: 0,
        candidates: 0,
        objects: 0,
        supplementarySearches: 0,
        corrections: 0,
        transientRetries: 0,
      },
      activeWallClockMs: 0,
      currentConcurrency: 0,
      ledgerVersion: 1,
      changedAt: envelope.createdAt,
    },
  };
};
const candidate = (
  operations = [
    {
      kind: "replace-risk-matrix-band",
      definitionType: "risk-matrix",
      axis: "possibility",
      band: { bandId: "p1", lower: "0", upper: "2" },
    },
  ],
) =>
  CalibrationCandidateV1Schema.parse({
    schemaVersion: "1",
    taskRef,
    resultRef: buildCompletedAgentTaskResult(taskRef, {
      kind: "calibration-suggestion",
      reference: ref("proposed-candidate"),
    }),
    inputSnapshotRef: { kind: "calibration-input-snapshot", reference: snapshotRef.reference },
    rationale: "调整阈值以适配新监测结果",
    evidenceReferences: [
      { locator: { sourceSegmentId: "segment-1" }, sourceVersion: ref("source-version") },
    ],
    operations,
  });

const setup = ({
  input = inputSnapshot(),
  base = baseDocument(),
  verified = true,
  streamedInputBytes,
} = {}) => {
  const content = new Map();
  const putCalls = [];
  const add = (artifactRef, value, purposeCode, mediaType) => {
    const bytes = new TextEncoder().encode(canonicalJson(value));
    content.set(`${artifactRef.reference.entityId}/${artifactRef.reference.versionId}`, {
      bytes,
      purposeCode,
      mediaType,
      artifactRef,
    });
  };
  const frozenInputRef = {
    kind: "content-artifact",
    reference: ref("calibration-input-artifact", `sha256:${"b".repeat(64)}`),
  };
  add(
    frozenInputRef,
    input,
    "warning-response.calibration-input-snapshot",
    "application/vnd.riskflow.calibration-input+json",
  );
  add(
    input.baseArtifactRef,
    base,
    "assessment-configuration",
    "application/vnd.riskflow.assessment-configuration+json",
  );
  const artifactStore = {
    async open(request) {
      const stored = content.get(
        `${request.artifactRef.reference.entityId}/${request.artifactRef.reference.versionId}`,
      );
      const length = stored?.bytes.byteLength ?? 0;
      return {
        manifest: {
          artifactRef: request.artifactRef,
          purposeCode: stored?.purposeCode,
          mediaType: stored?.mediaType,
          content: {
            hash: {
              algorithm: "sha256",
              value: createHash("sha256")
                .update(stored?.bytes ?? new Uint8Array())
                .digest("hex"),
            },
            byteLength: length,
          },
        },
        content: (async function* () {
          if (stored)
            yield request.artifactRef.reference.entityId === frozenInputRef.reference.entityId &&
            streamedInputBytes
              ? streamedInputBytes
              : stored.bytes;
        })(),
        verified: verified
          ? Promise.resolve(
              ArtifactReadReceiptV1Schema.parse({
                schemaVersion: "1",
                requestId: request.requestId,
                artifactRef: request.artifactRef,
                content: {
                  hash: {
                    algorithm: "sha256",
                    value: createHash("sha256")
                      .update(stored?.bytes ?? new Uint8Array())
                      .digest("hex"),
                  },
                  byteLength: length,
                },
                authorizationContextRef: authorization.authorizationContextRef,
                verifiedAt: "2026-01-01T00:00:00.000Z",
              }),
            )
          : Promise.reject(new Error("unverified")),
      };
    },
    async put(command, stream) {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      putCalls.push({ command, bytes });
      const artifactRef = {
        kind: "content-artifact",
        reference: {
          entityId: command.artifactId,
          versionId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        },
      };
      return { artifactRef };
    },
  };
  const accessCalls = [];
  const access = {
    async verifyDeploymentContext(input) {
      accessCalls.push(input);
      return { context: authorization };
    },
  };
  return {
    port: createDeploymentCalibrationTaskPortV1({ artifactStore, access }),
    task: task(frozenInputRef),
    putCalls,
    accessCalls,
    content,
  };
};

describe("deployment calibration task port", () => {
  it("校验接受的候选并将 AgentValidationResult 写入 C04", async () => {
    const fixture = setup();
    const result = await fixture.port.validateIncrement({
      task: fixture.task,
      candidate: candidate(),
    });
    expect(result.disposition).toBe("accepted");
    expect(result.validationArtifactRef).toMatchObject({
      kind: "content-artifact",
      reference: {
        entityId: expect.stringMatching(/^calibration-validation-validate-calibration-task-/),
        versionId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(fixture.putCalls).toHaveLength(1);
    expect(fixture.putCalls[0].command.purposeCode).toBe("agent-validation");
    expect(fixture.putCalls[0].command.mediaType).toBe(
      "application/vnd.riskflow.agent-validation+json",
    );
    expect(fixture.accessCalls[0].requiredCapability).toBe("agent-task.start");
  });

  it("拒绝候选任务绑定错误或快照摘要漂移", async () => {
    const bound = setup();
    await expect(
      bound.port.validateIncrement({
        task: bound.task,
        candidate: { ...candidate(), taskRef: { ...taskRef, reference: ref("other-task") } },
      }),
    ).rejects.toThrow("CALIBRATION_TASK_BINDING_INVALID");

    const wrongDigest = setup({ input: inputSnapshot({ baseContentDigest: "0".repeat(64) }) });
    await expect(
      wrongDigest.port.validateIncrement({ task: wrongDigest.task, candidate: candidate() }),
    ).rejects.toThrow("CALIBRATION_TASK_BASE_DIGEST_MISMATCH");
    expect(wrongDigest.putCalls).toHaveLength(0);
  });

  it("领域候选越界时返回原校验器的拒绝结果", async () => {
    const fixture = setup();
    const invalid = candidate([
      {
        kind: "replace-weight-entry",
        definitionType: "weight-set",
        axis: "possibility",
        entry: { indicatorId: "indicator-1", basisPoints: 1000 },
      },
    ]);
    const result = await fixture.port.validateIncrement({ task: fixture.task, candidate: invalid });
    expect(result.disposition).toBe("rejected");
    expect(result.rejectionClass).toBe("terminal");
    expect(fixture.putCalls).toHaveLength(1);
  });

  it("拒绝超限或未完成 verified 的 C04 正文", async () => {
    const tooLarge = setup({
      streamedInputBytes: new Uint8Array(1024 * 1024 + 1),
      verified: false,
    });
    await expect(
      tooLarge.port.validateIncrement({ task: tooLarge.task, candidate: candidate() }),
    ).rejects.toThrow("CALIBRATION_TASK_ARTIFACT_TOO_LARGE");

    const unverified = setup({ verified: false });
    await expect(
      unverified.port.validateIncrement({ task: unverified.task, candidate: candidate() }),
    ).rejects.toThrow();
  });

  it("finalize 再验证后生成固定 Agent 结果身份并引用校验工件", async () => {
    const fixture = setup();
    const result = await fixture.port.finalizeIncrement({
      task: fixture.task,
      candidate: candidate(),
    });
    const repeated = await fixture.port.finalizeIncrement({
      task: fixture.task,
      candidate: candidate(),
    });
    expect(result).toMatchObject({
      reference: { entityId: "agent-result:calibration-task", versionId: "1" },
      status: "completed",
      agentTaskRef: taskRef,
      candidateRef: { kind: "calibration-suggestion" },
      validationRef: {
        kind: "validation-snapshot",
        reference: {
          entityId: expect.any(String),
          versionId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      },
    });
    expect(repeated).toEqual(result);
    expect(fixture.putCalls).toHaveLength(2);
  });
});
