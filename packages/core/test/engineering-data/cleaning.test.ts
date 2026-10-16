import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  type AgentDomainToolResultV1,
  type AgentTaskSnapshotV1,
} from "../../src/agent-runtime/index.js";
import type { ArtifactRefV1 } from "../../src/artifacts/schema.js";
import {
  DATA_CLEANING_REASON_CODES,
  DATA_CLEANING_TASK_TYPE,
  DataCleaningCandidateV1Schema,
  DataCleaningFrozenInputV1Schema,
  DataCleaningPolicyV1Schema,
  DataCleaningPolicyV2Schema,
  createDataCleaningTaskDefinition,
  settleDataCleaningCandidate,
  validateDataCleaningCandidate,
  type DataCleaningAvailabilityV1,
  type DataCleaningCandidateV1,
  type DataCleaningDispositionV1,
  type DataCleaningExclusionDecisionV1,
  type DataCleaningFrozenInputV1,
  type DataCleaningPolicyV1,
  type DataCleaningRejectionClassV1,
  type DataCleaningTaskPortV1,
} from "../../src/engineering-data/cleaning/index.js";
import type { AgentTaskRefV1 } from "@riskflow/contracts/ports";

const sha256 = (seed: string): string =>
  `sha256:${createHash("sha256").update(seed, "utf8").digest("hex")}`;

/** 冻结输入中的指纹字段只要求 64 位十六进制，不参与本文件的行为断言。 */
const FINGERPRINT = "a".repeat(64);
const ISO = "2030-01-01T00:00:00.000Z";

interface VersionedRef<K extends string = string> {
  readonly kind: K;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

const versioned = <K extends string>(
  kind: K,
  entityId: string,
  versionId = "1",
): VersionedRef<K> => ({ kind, reference: { entityId, versionId } });

const sourceVersion1 = versioned("source-version", "source-1");
const sourceVersion2 = versioned("source-version", "source-2");
const snapshotRef = versioned("monitoring-snapshot", "snapshot-1");
const seriesRef = versioned("monitoring-series", "series-1");
const sampleRef = (index: number) => versioned("monitoring-sample-version", `sample-${index}`);

interface EvidenceFixture {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: { readonly entityId: string; readonly versionId: string };
}

const evidence = (
  segmentId: string,
  sourceVersion = sourceVersion1.reference,
): EvidenceFixture => ({
  locator: { sourceSegmentId: segmentId },
  sourceVersion,
});

// --- 策略、任务引用与冻结输入 fixture ---------------------------------------

const budgetPolicy = {
  schemaVersion: "1" as const,
  policyRef: { entityId: "budget-policy", versionId: "1" },
  modelDeploymentRef: { entityId: "model-deployment", versionId: "1" },
  promptTemplateRef: { entityId: "prompt-template", versionId: "1" },
  toolPolicyRef: { entityId: "tool-policy", versionId: "1" },
  maxModelInvocations: 4,
  maxToolInvocations: 8,
  maxContextTokens: 4_000,
  maxInputBytes: 4_000,
  maxOutputBytes: 4_000,
  maxCandidates: 2,
  maxObjects: 64,
  maxSupplementarySearches: 0,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 60_000,
};

const policyInput = {
  schemaVersion: "1" as const,
  policyRef: { entityId: "data-processing-policy", versionId: "1" },
  allowedConversionPolicyRefs: [{ entityId: "conversion-policy", versionId: "1" }],
  allowedQualityPolicyRefs: [{ entityId: "quality-policy", versionId: "1" }],
  allowedConverterDeploymentRefs: [{ entityId: "converter-deployment", versionId: "1" }],
  allowedExclusionReasonCodes: ["duplicate-content", "sensor-drift", "unreadable-layout"],
  protectedSegmentKinds: ["monitoring-window"],
  requiredSegmentKinds: ["chapter"],
  protectedMonitoringSelectionReasons: ["latest-valid"],
  minimumRetainedSegmentRatio: 0.5,
  minimumRetainedSampleRatio: 0.5,
  minimumDocumentCoverageRatio: 0.5,
  monitoring: {
    monitoringSeriesRef: seriesRef,
    availabilityPolicyRef: { entityId: "availability-policy", versionId: "1" },
  },
  tools: {
    documentSegmentToolRef: { entityId: "document-segment-tool", versionId: "1" },
    monitoringSnapshotToolRef: { entityId: "monitoring-snapshot-tool", versionId: "1" },
    maxSegmentsPerRead: 10,
    maxMonitoringItemsPerRead: 10,
  },
  agent: {
    definitionRef: { entityId: "data-cleaning-definition", versionId: "1" },
    modelDeploymentRef: budgetPolicy.modelDeploymentRef,
    promptTemplateRef: budgetPolicy.promptTemplateRef,
    toolPolicyRef: budgetPolicy.toolPolicyRef,
    budgetPolicyRef: budgetPolicy.policyRef,
    incrementSchemaRef: { entityId: "cleaning-increment", versionId: "1" },
    validationPolicyRef: { entityId: "cleaning-validation", versionId: "1" },
    budgetPolicy,
  },
};

const policy = (overrides: Record<string, unknown> = {}): DataCleaningPolicyV1 =>
  DataCleaningPolicyV1Schema.parse({ ...policyInput, ...overrides });

const taskRef: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: { entityId: "agent-task:project-1:task-1", versionId: "1" },
  taskType: "data-cleaning",
  triggerMode: "embedded",
  modelDeploymentRef: budgetPolicy.modelDeploymentRef,
  promptTemplateRef: budgetPolicy.promptTemplateRef,
  toolPolicyRef: budgetPolicy.toolPolicyRef,
  budgetPolicyRef: budgetPolicy.policyRef,
  incrementSchemaRef: policyInput.agent.incrementSchemaRef,
  validationPolicyRef: policyInput.agent.validationPolicyRef,
};

const task = {
  envelope: { schemaVersion: "1", agentTaskRef: taskRef },
  state: {
    schemaVersion: "1",
    agentTaskRef: taskRef,
    status: "running",
    taskVersion: 2,
    cancelRequested: false,
    latestCandidateVersion: 0,
    updatedAt: ISO,
  },
  budgetPolicy,
  budgetLedger: {
    schemaVersion: "1",
    reserved: emptyAgentBudgetUsage(),
    used: emptyAgentBudgetUsage(),
    activeWallClockMs: 0,
    currentConcurrency: 0,
    ledgerVersion: 1,
    changedAt: ISO,
  },
} as unknown as AgentTaskSnapshotV1;

type SegmentKindFixture = "chapter" | "table" | "monitoring-window";

interface SegmentFixture {
  readonly sourceSegmentId: string;
  readonly kind: SegmentKindFixture;
  readonly locator: {
    readonly kind: "document";
    readonly pageNumber: number;
    readonly headingPath: string[];
  };
  readonly textBlockIds: string[];
  readonly parsedFingerprint: string;
}

const segment = (segmentId: string, kind: SegmentKindFixture): SegmentFixture => ({
  sourceSegmentId: segmentId,
  kind,
  locator: { kind: "document", pageNumber: 1, headingPath: ["body"] },
  textBlockIds: [`block-${segmentId}`],
  parsedFingerprint: FINGERPRINT,
});

const frozenDocument = (entityId: string, segments: SegmentFixture[]) => ({
  sourceVersionRef: versioned("source-version", entityId),
  conversionRef: versioned("structured-document-conversion", `conversion-${entityId}`),
  jsonLdArtifactRef: versioned("content-artifact", `jsonld-${entityId}`, sha256(entityId)),
  sourceSegmentSetRef: versioned("source-segment-set", `segments-${entityId}`),
  inputKind: "docx" as const,
  jsonLdFingerprint: FINGERPRINT,
  segments,
});

const chapterTableDocument = (entityId: string) =>
  frozenDocument(entityId, [
    segment(`${entityId}-1`, "chapter"),
    segment(`${entityId}-2`, "table"),
  ]);

const frozenMonitoring = (overrides: Record<string, unknown> = {}) => ({
  monitoringSnapshotRef: snapshotRef,
  monitoringSeriesRef: seriesRef,
  availability: "available" as const,
  coverageRatio: 1,
  availabilityReasons: [],
  members: [
    { memberIndex: 0, sampleVersionRef: sampleRef(1), selectionReason: "latest-valid" as const },
    { memberIndex: 1, sampleVersionRef: sampleRef(2), selectionReason: "original" as const },
    { memberIndex: 2, sampleVersionRef: sampleRef(3), selectionReason: "correction" as const },
  ],
  pointStatuses: [
    { sampledAt: ISO, status: "available" as const, sampleVersionRefs: [sampleRef(1)] },
    { sampledAt: ISO, status: "available" as const, sampleVersionRefs: [sampleRef(2)] },
    { sampledAt: ISO, status: "available" as const, sampleVersionRefs: [sampleRef(3)] },
  ],
  snapshotFingerprint: FINGERPRINT,
  ...overrides,
});

const frozenInput = (overrides: Record<string, unknown> = {}): DataCleaningFrozenInputV1 =>
  DataCleaningFrozenInputV1Schema.parse({
    schemaVersion: "1",
    manifestArtifactRef: versioned("content-artifact", "manifest-1", sha256("manifest-1")),
    manifestDigest: FINGERPRINT,
    agentTaskRef: taskRef,
    policyRef: policyInput.policyRef,
    documents: [
      frozenDocument("source-1", [
        segment("source-1-1", "chapter"),
        segment("source-1-2", "table"),
        segment("source-1-3", "table"),
        segment("source-1-4", "chapter"),
        segment("source-1-5", "monitoring-window"),
      ]),
      frozenDocument("source-2", [
        segment("source-2-1", "chapter"),
        segment("source-2-2", "table"),
      ]),
    ],
    monitoring: frozenMonitoring(),
    ...overrides,
  });

// --- 候选项 fixture ---------------------------------------------------------

const documentExclusion = (
  segmentId: string,
  overrides: {
    sourceVersionRef?: VersionedRef<"source-version">;
    reasonCode?: string;
    evidenceReferences?: EvidenceFixture[];
  } = {},
) => {
  const sourceVersionRef = overrides.sourceVersionRef ?? sourceVersion1;
  return {
    targetKind: "document-segment" as const,
    sourceVersionRef,
    sourceSegmentId: segmentId,
    reasonCode: overrides.reasonCode ?? "duplicate-content",
    evidenceReferences: overrides.evidenceReferences ?? [
      evidence(segmentId, sourceVersionRef.reference),
    ],
  };
};

const monitoringExclusion = (
  sampleIndex: number,
  overrides: {
    monitoringSnapshotRef?: VersionedRef<"monitoring-snapshot">;
    sampleVersionRef?: VersionedRef<"monitoring-sample-version">;
    reasonCode?: string;
  } = {},
) => ({
  targetKind: "monitoring-sample" as const,
  monitoringSnapshotRef: overrides.monitoringSnapshotRef ?? snapshotRef,
  sampleVersionRef: overrides.sampleVersionRef ?? sampleRef(sampleIndex),
  reasonCode: overrides.reasonCode ?? "sensor-drift",
  evidenceReferences: [evidence("source-1-1")],
});

const candidate = (
  exclusions: unknown[],
  overrides: Record<string, unknown> = {},
): DataCleaningCandidateV1 =>
  DataCleaningCandidateV1Schema.parse({
    schemaVersion: "1",
    candidateVersion: 1,
    observations: [],
    exclusions,
    ...overrides,
  });

const cleanCandidate = candidate([]);

// --- 校验视图 ---------------------------------------------------------------

interface ItemExpectation {
  readonly checkId: string;
  readonly disposition: DataCleaningDispositionV1;
  readonly reasonCode: string;
  readonly rejectionClass?: DataCleaningRejectionClassV1;
}

const accepted = (reasonCode: string, index = 0): ItemExpectation => ({
  checkId: `exclusion:${index}`,
  disposition: "accepted",
  reasonCode,
});

const rejected = (
  reasonCode: string,
  rejectionClass: DataCleaningRejectionClassV1,
  index = 0,
): ItemExpectation => ({
  checkId: `exclusion:${index}`,
  disposition: "rejected",
  reasonCode,
  rejectionClass,
});

const normalizeItem = (item: ItemExpectation) => ({
  checkId: item.checkId,
  disposition: item.disposition,
  reasonCode: item.reasonCode,
  ...(item.rejectionClass === undefined ? {} : { rejectionClass: item.rejectionClass }),
});

const validationCases: ReadonlyArray<{
  readonly name: string;
  readonly candidate: DataCleaningCandidateV1;
  readonly expectItems: readonly ItemExpectation[];
}> = [
  {
    name: "接受合法的文档段排除",
    candidate: candidate([documentExclusion("source-1-2")]),
    expectItems: [accepted("duplicate-content")],
  },
  {
    name: "接受合法的监测样本排除",
    candidate: candidate([monitoringExclusion(2)]),
    expectItems: [accepted("sensor-drift")],
  },
  {
    name: "拒绝白名单之外的原因码（可修复）",
    candidate: candidate([documentExclusion("source-1-2", { reasonCode: "not-allowlisted" })]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.reasonCodeNotAllowed, "repairable")],
  },
  {
    name: "拒绝未知来源版本（可修复）",
    candidate: candidate([
      documentExclusion("source-1-2", {
        sourceVersionRef: versioned("source-version", "source-9"),
        evidenceReferences: [evidence("source-1-1")],
      }),
    ]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.unknownSourceVersion, "repairable")],
  },
  {
    name: "拒绝未知段（可修复）",
    candidate: candidate([
      documentExclusion("source-1-9", { evidenceReferences: [evidence("source-1-1")] }),
    ]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.unknownSegment, "repairable")],
  },
  {
    name: "拒绝未知监测样本（可修复）",
    candidate: candidate([monitoringExclusion(9)]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.unknownSample, "repairable")],
  },
  {
    name: "拒绝与冻结快照不一致的快照引用（可修复）",
    candidate: candidate([
      monitoringExclusion(2, {
        monitoringSnapshotRef: versioned("monitoring-snapshot", "snapshot-9"),
      }),
    ]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.snapshotMismatch, "repairable")],
  },
  {
    name: "拒绝不属于冻结输入的证据（不可修复）",
    candidate: candidate([
      documentExclusion("source-1-2", { evidenceReferences: [evidence("source-1-9")] }),
    ]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.evidenceNotFrozen, "terminal")],
  },
  {
    name: "拒绝重复目标（可修复）",
    candidate: candidate([documentExclusion("source-1-2"), documentExclusion("source-1-2")]),
    expectItems: [
      accepted("duplicate-content", 0),
      rejected(DATA_CLEANING_REASON_CODES.duplicateExclusion, "repairable", 1),
    ],
  },
  {
    name: "重写原因码不能绕过重复目标检查",
    candidate: candidate([
      documentExclusion("source-1-2"),
      documentExclusion("source-1-2", { reasonCode: "unreadable-layout" }),
    ]),
    expectItems: [
      accepted("duplicate-content", 0),
      rejected(DATA_CLEANING_REASON_CODES.duplicateExclusion, "repairable", 1),
    ],
  },
  {
    name: "拒绝受保护的段类型（不可修复）",
    candidate: candidate([documentExclusion("source-1-5")]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.protectedSegment, "terminal")],
  },
  {
    name: "重写原因码不能绕过受保护段类型",
    candidate: candidate([documentExclusion("source-1-5", { reasonCode: "unreadable-layout" })]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.protectedSegment, "terminal")],
  },
  {
    name: "拒绝受保护的监测选取原因（不可修复）",
    candidate: candidate([monitoringExclusion(1)]),
    expectItems: [rejected(DATA_CLEANING_REASON_CODES.protectedMonitoringSample, "terminal")],
  },
];

describe("C25 validateDataCleaningCandidate", () => {
  it.each(validationCases)("$name", ({ candidate: subject, expectItems }) => {
    const view = validateDataCleaningCandidate({
      candidate: subject,
      frozen: frozenInput(),
      policy: policy(),
    });
    expect(view.items.map(normalizeItem)).toEqual(expectItems.map(normalizeItem));

    const rejectedItems = expectItems.filter((item) => item.disposition === "rejected");
    expect(view.disposition).toBe(rejectedItems.length === 0 ? "accepted" : "rejected");
    if (rejectedItems.length === 0) {
      expect(view.rejectionClass).toBeUndefined();
    } else {
      expect(view.rejectionClass).toBe(
        rejectedItems.some((item) => item.rejectionClass === "terminal")
          ? "terminal"
          : "repairable",
      );
    }
  });
});

describe("C25 candidate 严格解析", () => {
  const referenceOnlyCandidate = {
    schemaVersion: "1",
    candidateVersion: 1,
    observations: [],
    exclusions: [documentExclusion("source-1-2")],
  };

  it("接受仅含引用级排除的候选", () => {
    expect(DataCleaningCandidateV1Schema.safeParse(referenceOnlyCandidate).success).toBe(true);
  });

  it.each(["text", "value", "replacement", "path", "patch", "unit", "coordinates", "unexpected"])(
    "拒绝携带 %s 的候选且不将其转换为排除项",
    (field) => {
      const payload = { ...referenceOnlyCandidate, [field]: "agent-supplied" };
      expect(DataCleaningCandidateV1Schema.safeParse(payload).success).toBe(false);
      expect(() =>
        validateDataCleaningCandidate({
          candidate: payload as unknown as DataCleaningCandidateV1,
          frozen: frozenInput(),
          policy: policy(),
        }),
      ).toThrow();
    },
  );
});

// --- 确定性收口 -------------------------------------------------------------

const settlementCases: ReadonlyArray<{
  readonly name: string;
  readonly candidate: DataCleaningCandidateV1;
  readonly frozen?: DataCleaningFrozenInputV1;
  readonly overall: DataCleaningAvailabilityV1;
  readonly coverageRatio: number;
  readonly reasonCodes: readonly string[];
  readonly inputAvailability: readonly DataCleaningAvailabilityV1[];
}> = [
  {
    name: "无排除且全部门槛通过时每个输入与整体都可用",
    candidate: cleanCandidate,
    overall: "available",
    coverageRatio: 1,
    reasonCodes: [],
    inputAvailability: ["available", "available", "available"],
  },
  {
    name: "保留比例仍高于门槛时该输入与整体为部分可用",
    candidate: candidate([documentExclusion("source-1-2")]),
    overall: "partial",
    coverageRatio: 1,
    reasonCodes: ["availability-degraded", DATA_CLEANING_REASON_CODES.partialRetention],
    inputAvailability: ["partial", "available", "available"],
  },
  {
    name: "保留比例低于最小比例时该文档不可用",
    candidate: candidate([
      documentExclusion("source-1-2"),
      documentExclusion("source-1-3"),
      documentExclusion("source-1-4"),
    ]),
    overall: "partial",
    coverageRatio: 0.5,
    reasonCodes: ["availability-degraded", DATA_CLEANING_REASON_CODES.retainedRatioBelowThreshold],
    inputAvailability: ["unavailable", "available", "available"],
  },
  {
    name: "必需段类型被完全排除时该文档不可用",
    candidate: candidate([documentExclusion("source-1-1"), documentExclusion("source-1-4")]),
    overall: "partial",
    coverageRatio: 0.5,
    reasonCodes: ["availability-degraded", DATA_CLEANING_REASON_CODES.requiredSegmentKindMissing],
    inputAvailability: ["unavailable", "available", "available"],
  },
  {
    name: "C14 基线不可用时监测输入保持不可用且不被提升",
    candidate: cleanCandidate,
    frozen: frozenInput({
      monitoring: frozenMonitoring({ availability: "unavailable", coverageRatio: 0 }),
    }),
    overall: "partial",
    coverageRatio: 1,
    reasonCodes: [
      "availability-degraded",
      DATA_CLEANING_REASON_CODES.monitoringBaselineUnavailable,
    ],
    inputAvailability: ["available", "available", "unavailable"],
  },
  {
    name: "排除样本也无法提升 C14 的不可用基线",
    candidate: candidate([monitoringExclusion(2)]),
    frozen: frozenInput({
      monitoring: frozenMonitoring({ availability: "unavailable", coverageRatio: 0 }),
    }),
    overall: "partial",
    coverageRatio: 1,
    reasonCodes: [
      "availability-degraded",
      DATA_CLEANING_REASON_CODES.monitoringBaselineUnavailable,
    ],
    inputAvailability: ["available", "available", "unavailable"],
  },
  {
    name: "全部文档不可用时整体不可用",
    candidate: candidate([
      documentExclusion("source-1-1"),
      documentExclusion("source-1-2"),
      documentExclusion("source-2-1", { sourceVersionRef: sourceVersion2 }),
      documentExclusion("source-2-2", { sourceVersionRef: sourceVersion2 }),
    ]),
    frozen: frozenInput({
      documents: [chapterTableDocument("source-1"), chapterTableDocument("source-2")],
    }),
    overall: "unavailable",
    coverageRatio: 0,
    reasonCodes: [
      DATA_CLEANING_REASON_CODES.coverageBelowThreshold,
      DATA_CLEANING_REASON_CODES.requiredSegmentKindMissing,
    ],
    inputAvailability: ["unavailable", "unavailable", "available"],
  },
  {
    name: "文档覆盖率低于门槛时整体不可用",
    candidate: candidate([
      documentExclusion("source-1-1"),
      documentExclusion("source-1-2"),
      documentExclusion("source-2-1", { sourceVersionRef: sourceVersion2 }),
      documentExclusion("source-2-2", { sourceVersionRef: sourceVersion2 }),
    ]),
    frozen: frozenInput({
      documents: [
        chapterTableDocument("source-1"),
        chapterTableDocument("source-2"),
        chapterTableDocument("source-3"),
      ],
    }),
    overall: "unavailable",
    coverageRatio: 1 / 3,
    reasonCodes: [
      DATA_CLEANING_REASON_CODES.coverageBelowThreshold,
      DATA_CLEANING_REASON_CODES.requiredSegmentKindMissing,
    ],
    inputAvailability: ["unavailable", "unavailable", "available", "available"],
  },
];

const decisionSummary = (decision: DataCleaningExclusionDecisionV1) =>
  Object.fromEntries(
    Object.entries(decision).filter(
      ([key, value]) => value !== undefined && key !== "evidenceReferences",
    ),
  );

describe("C25 settleDataCleaningCandidate", () => {
  const policyV2 = () =>
    DataCleaningPolicyV2Schema.parse({
      schemaVersion: "2",
      policyRef: { entityId: "cleaning-by-input-kind", versionId: "1" },
      allowedExclusionReasonCodes: policyInput.allowedExclusionReasonCodes,
      protectedSegmentKinds: policyInput.protectedSegmentKinds,
      protectedMonitoringSelectionReasons: policyInput.protectedMonitoringSelectionReasons,
      minimumRetainedSampleRatio: policyInput.minimumRetainedSampleRatio,
      minimumDocumentCoverageRatio: policyInput.minimumDocumentCoverageRatio,
      monitoring: policyInput.monitoring,
      tools: policyInput.tools,
      agent: policyInput.agent,
      documentRules: [
        { inputKind: "csv", requiredSegmentKinds: ["table"] },
        { inputKind: "xlsx", requiredSegmentKinds: ["table"] },
        { inputKind: "text-pdf", requiredSegmentKinds: ["chapter", "table"] },
        { inputKind: "ocr-layout", requiredSegmentKinds: ["chapter", "table"] },
        { inputKind: "docx", requiredSegmentKinds: ["chapter", "table"] },
      ],
    });

  it.each(["csv", "xlsx", "text-pdf", "ocr-layout", "docx"] as const)(
    "V2按%s实际表格判定可用，不要求空白页或章节",
    (inputKind) => {
      const frozen = frozenInput({
        documents: [{ ...frozenDocument("source-1", [segment("source-1-1", "table")]), inputKind }],
        monitoring: undefined,
      });
      const result = settleDataCleaningCandidate({
        candidate: candidate([]),
        frozen,
        policy: policyV2(),
      });
      expect(result.overallAvailability).toBe("available");
    },
  );

  it("V2允许排除非关键正文，仍保护指定资料段和全部排空边界", () => {
    const frozen = frozenInput({
      documents: [chapterTableDocument("source-1")],
      monitoring: undefined,
    });
    const partial = settleDataCleaningCandidate({
      candidate: candidate([documentExclusion("source-1-1")]),
      frozen,
      policy: policyV2(),
    });
    expect(partial.overallAvailability).toBe("partial");
    expect(partial.inputs[0]?.retainedSegmentIds).toEqual(["source-1-2"]);
    const empty = settleDataCleaningCandidate({
      candidate: candidate([documentExclusion("source-1-1"), documentExclusion("source-1-2")]),
      frozen,
      policy: policyV2(),
    });
    expect(empty.overallAvailability).toBe("unavailable");
    const protectedResult = validateDataCleaningCandidate({
      candidate: candidate([documentExclusion("source-1-5")]),
      frozen: frozenInput(),
      policy: policyV2(),
    });
    expect(protectedResult.disposition).toBe("rejected");
  });

  it("V2拒绝重复输入类型及不适用的结构", () => {
    const active = policyV2();
    expect(
      DataCleaningPolicyV2Schema.safeParse({
        ...active,
        documentRules: [active.documentRules[0], active.documentRules[0]],
      }).success,
    ).toBe(false);
    const frozen = frozenInput({
      documents: [
        { ...frozenDocument("source-1", [segment("source-1-1", "chapter")]), inputKind: "csv" },
      ],
      monitoring: undefined,
    });
    expect(
      settleDataCleaningCandidate({ candidate: candidate([]), frozen, policy: active })
        .overallAvailability,
    ).toBe("unavailable");
  });

  it.each(settlementCases)(
    "$name",
    ({ candidate: subject, frozen, overall, coverageRatio, reasonCodes, inputAvailability }) => {
      const settlement = settleDataCleaningCandidate({
        candidate: subject,
        frozen: frozen ?? frozenInput(),
        policy: policy(),
      });
      expect(settlement.inputs.map((input) => input.availability)).toEqual(inputAvailability);
      expect(settlement.overallAvailability).toBe(overall);
      expect(settlement.overallCoverageRatio).toBe(coverageRatio);
      expect(settlement.reasonCodes).toEqual([...reasonCodes]);
      expect(settlement.requiredDocumentRetentionSatisfied).toBe(overall !== "unavailable");
    },
  );

  it("给出精确的保留/排除清单与计数，且不回显候选携带的字段", () => {
    const subject = candidate(
      [
        documentExclusion("source-1-3", { reasonCode: "sensor-drift" }),
        monitoringExclusion(3),
        // 被拒绝的排除项不得影响保留范围。
        documentExclusion("source-1-9", { evidenceReferences: [evidence("source-1-1")] }),
      ],
      { observations: [{ observationCode: "note-1", summaryText: "agent-supplied-note" }] },
    );
    const settlement = settleDataCleaningCandidate({
      candidate: subject,
      frozen: frozenInput(),
      policy: policy(),
    });
    const [document1, document2, monitoringInput] = settlement.inputs;

    expect(document1).toMatchObject({
      inputKey: "document:source-1@1",
      inputKind: "docx",
      availability: "partial",
      baselineAvailability: "available",
      totalCount: 5,
      retainedCount: 4,
      retainedRatio: 0.8,
      retainedSegmentIds: ["source-1-1", "source-1-2", "source-1-4", "source-1-5"],
      excludedSegmentIds: ["source-1-3"],
      retainedSampleVersionRefs: [],
      excludedSampleVersionRefs: [],
      missingRequiredSegmentKinds: [],
      protectedRetained: true,
      reasonCodes: [DATA_CLEANING_REASON_CODES.partialRetention],
    });
    expect(document2).toMatchObject({
      inputKey: "document:source-2@1",
      availability: "available",
      totalCount: 2,
      retainedCount: 2,
      retainedRatio: 1,
      retainedSegmentIds: ["source-2-1", "source-2-2"],
      excludedSegmentIds: [],
      reasonCodes: [],
    });
    expect(monitoringInput).toMatchObject({
      inputKey: "monitoring-snapshot",
      inputKind: "monitoring-snapshot",
      availability: "partial",
      baselineAvailability: "available",
      totalCount: 3,
      retainedCount: 2,
      retainedRatio: 2 / 3,
      retainedSegmentIds: [],
      excludedSegmentIds: [],
      retainedSampleVersionRefs: [sampleRef(1), sampleRef(2)],
      excludedSampleVersionRefs: [sampleRef(3)],
      reasonCodes: [DATA_CLEANING_REASON_CODES.partialRetention],
    });

    expect(settlement.overallAvailability).toBe("partial");
    expect(settlement.overallCoverageRatio).toBe(1);
    expect(settlement.reasonCodes).toEqual([
      "availability-degraded",
      DATA_CLEANING_REASON_CODES.partialRetention,
    ]);

    expect(settlement.exclusions).toHaveLength(3);
    expect(decisionSummary(settlement.exclusions[0])).toEqual({
      decisionId: `${FINGERPRINT}:exclusion:0`,
      targetKind: "document-segment",
      reasonCode: "sensor-drift",
      disposition: "accepted",
      sourceVersionRef: sourceVersion1,
      sourceSegmentId: "source-1-3",
    });
    expect(decisionSummary(settlement.exclusions[1])).toEqual({
      decisionId: `${FINGERPRINT}:exclusion:1`,
      targetKind: "monitoring-sample",
      reasonCode: "sensor-drift",
      disposition: "accepted",
      monitoringSnapshotRef: snapshotRef,
      sampleVersionRef: sampleRef(3),
    });
    expect(decisionSummary(settlement.exclusions[2])).toEqual({
      decisionId: `${FINGERPRINT}:exclusion:2`,
      targetKind: "document-segment",
      reasonCode: DATA_CLEANING_REASON_CODES.unknownSegment,
      disposition: "rejected",
      rejectionClass: "repairable",
      sourceVersionRef: sourceVersion1,
      sourceSegmentId: "source-1-9",
    });

    expect(Object.keys(settlement).sort()).toEqual([
      "exclusions",
      "inputs",
      "overallAvailability",
      "overallCoverageRatio",
      "reasonCodes",
      "requiredDocumentRetentionSatisfied",
    ]);
    expect(Object.keys(document1).sort()).toEqual([
      "availability",
      "baselineAvailability",
      "excludedSampleVersionRefs",
      "excludedSegmentIds",
      "inputKey",
      "inputKind",
      "missingRequiredSegmentKinds",
      "protectedRetained",
      "reasonCodes",
      "retainedCount",
      "retainedRatio",
      "retainedSampleVersionRefs",
      "retainedSegmentIds",
      "sourceVersionRef",
      "totalCount",
    ]);
    expect(Object.keys(monitoringInput).sort()).toEqual([
      "availability",
      "baselineAvailability",
      "excludedSampleVersionRefs",
      "excludedSegmentIds",
      "inputKey",
      "inputKind",
      "missingRequiredSegmentKinds",
      "monitoringSnapshotRef",
      "protectedRetained",
      "reasonCodes",
      "retainedCount",
      "retainedRatio",
      "retainedSampleVersionRefs",
      "retainedSegmentIds",
      "totalCount",
    ]);
    expect(Object.keys(settlement.exclusions[0]).sort()).toEqual([
      "decisionId",
      "disposition",
      "evidenceReferences",
      "reasonCode",
      "sourceSegmentId",
      "sourceVersionRef",
      "targetKind",
    ]);
    expect(Object.keys(settlement.exclusions[1]).sort()).toEqual([
      "decisionId",
      "disposition",
      "evidenceReferences",
      "monitoringSnapshotRef",
      "reasonCode",
      "sampleVersionRef",
      "targetKind",
    ]);
    expect(Object.keys(settlement.exclusions[2]).sort()).toEqual([
      "decisionId",
      "disposition",
      "evidenceReferences",
      "reasonCode",
      "rejectionClass",
      "sourceSegmentId",
      "sourceVersionRef",
      "targetKind",
    ]);
    expect(settlement).not.toHaveProperty("observations");
    expect(JSON.stringify(settlement)).not.toContain("agent-supplied-note");
  });
});

// --- C08 任务定义 -----------------------------------------------------------

const toolResult: AgentDomainToolResultV1 = {
  observationArtifactRef: {
    kind: "content-artifact",
    reference: { entityId: "slice-observation", versionId: sha256("slice-observation") },
  },
  effect: "none",
};

const setup = (
  frozen: DataCleaningFrozenInputV1 = frozenInput(),
  activePolicy: DataCleaningPolicyV1 = policy(),
) => {
  const resultRef = buildCompletedAgentTaskResult(taskRef, {
    kind: "content-artifact",
    reference: { entityId: "cleaned-result", versionId: sha256("cleaned-result") },
  });
  const port = {
    loadFrozenInput: vi.fn(async () => frozen),
    persistValidationArtifact: vi.fn(
      async (input: { candidate: DataCleaningCandidateV1 }): Promise<ArtifactRefV1> => ({
        kind: "diagnostic-artifact",
        reference: {
          entityId: `validation:${input.candidate.candidateVersion}`,
          versionId: sha256(JSON.stringify(input.candidate)),
        },
      }),
    ),
    persistCleaningResult: vi.fn(async () => resultRef),
    readDocumentSlice: vi.fn(async () => toolResult),
    readMonitoringSlice: vi.fn(async () => toolResult),
    readPreparationCatalogSlice: vi.fn(async () => toolResult),
  } satisfies DataCleaningTaskPortV1;
  const definition = createDataCleaningTaskDefinition({
    policy: activePolicy,
    port,
    now: () => new Date(ISO),
  });
  return { definition, port, resultRef };
};

describe("C25 createDataCleaningTaskDefinition", () => {
  it("暴露 data-cleaning 元数据、白名单工具与结果族", () => {
    const { definition } = setup();
    expect(DATA_CLEANING_TASK_TYPE).toBe("data-cleaning");
    expect(definition.metadata.taskType).toBe(DATA_CLEANING_TASK_TYPE);
    expect(definition.metadata.supportedTriggerModes).toEqual(["embedded"]);
    expect(definition.metadata.allowedToolRefs).toEqual([
      policyInput.tools.documentSegmentToolRef,
      policyInput.tools.monitoringSnapshotToolRef,
    ]);
    expect(definition.metadata.resultFamilies).toEqual(["content-artifact"]);
  });

  it("动作协议接受四种动作并拒绝携带替换内容的候选", () => {
    const { definition } = setup();
    const actions = [
      {
        kind: "read-document-segment-slice",
        sourceVersionRef: sourceVersion1,
        sourceSegmentIds: ["source-1-1"],
      },
      {
        kind: "read-monitoring-snapshot-slice",
        monitoringSnapshotRef: snapshotRef,
        sampleVersionRefs: [sampleRef(1)],
      },
      {
        kind: "read-cleaning-preparation-catalog-slice",
        sourceVersionRef: sourceVersion1,
        offset: 0,
      },
      { kind: "submit-cleaning-candidate", candidate: cleanCandidate },
    ];
    for (const action of actions) {
      expect(definition.actionSchema.safeParse(action).success).toBe(true);
    }
    expect(
      definition.actionSchema.safeParse({
        kind: "submit-cleaning-candidate",
        candidate: {
          ...DataCleaningCandidateV1Schema.parse(cleanCandidate),
          replacement: "rewritten text",
        },
      }).success,
    ).toBe(false);
  });

  it("只在策略声明定位工具引用时注册分页定位工具并转发请求", async () => {
    const catalogToolRef = { entityId: "preparation-catalog-tool", versionId: "1" };
    const plain = setup();
    expect(plain.definition.tools.map((tool) => tool.toolRef)).toEqual([
      policyInput.tools.documentSegmentToolRef,
      policyInput.tools.monitoringSnapshotToolRef,
    ]);

    const paged = setup(
      frozenInput(),
      policy({ tools: { ...policyInput.tools, preparationCatalogToolRef: catalogToolRef } }),
    );
    expect(paged.definition.metadata.allowedToolRefs).toEqual([
      policyInput.tools.documentSegmentToolRef,
      policyInput.tools.monitoringSnapshotToolRef,
      catalogToolRef,
    ]);
    expect(paged.definition.tools.map((tool) => tool.toolRef)).toEqual([
      policyInput.tools.documentSegmentToolRef,
      policyInput.tools.monitoringSnapshotToolRef,
      catalogToolRef,
    ]);
    // 已声明的三个工具引用必须互不相同，重名在 Schema 阶段就拒绝而不是留给 registry。
    expect(() =>
      policy({
        tools: {
          ...policyInput.tools,
          preparationCatalogToolRef: policyInput.tools.documentSegmentToolRef,
        },
      }),
    ).toThrow();

    const request = {
      kind: "read-cleaning-preparation-catalog-slice",
      sourceVersionRef: sourceVersion1,
      offset: 1,
    };
    const context = { task, taskRef, actionId: "action-catalog" };
    expect(paged.definition.actionSchema.safeParse({ ...request, offset: -1 }).success).toBe(false);
    expect(paged.definition.actionSchema.safeParse(request).success).toBe(true);
    await paged.definition.tools[2]!.execute(request, context);
    expect(paged.port.readPreparationCatalogSlice).toHaveBeenCalledWith(request, context);
    // 只读分页可安全恢复：同身份重放复用同一观察工件路径。
    expect(paged.definition.tools[2]!.recover).toBeTypeOf("function");
  });

  it("接受干净候选并持久化校验记录", async () => {
    const { definition, port } = setup();
    const result = await definition.validateCandidate(cleanCandidate, task);

    expect(result.disposition).toBe("accepted");
    expect(result.items).toEqual([]);
    expect(result.rejectionClass).toBeUndefined();
    expect(result.validationArtifactRef).toEqual(
      await port.persistValidationArtifact.mock.results[0].value,
    );
    expect(port.loadFrozenInput).toHaveBeenCalledWith(task);
    expect(port.persistValidationArtifact).toHaveBeenCalledTimes(1);
    expect(port.persistValidationArtifact.mock.calls[0][0].candidate).toEqual(cleanCandidate);
    expect(port.persistCleaningResult).not.toHaveBeenCalled();
  });

  it("拒绝候选时给出顶层 rejectionClass 且不产出最终结果", async () => {
    const { definition, port } = setup();
    const rejectedCandidate = candidate([
      documentExclusion("source-1-9", { evidenceReferences: [evidence("source-1-1")] }),
    ]);

    const result = await definition.validateCandidate(rejectedCandidate, task);

    expect(result.disposition).toBe("rejected");
    expect(result.rejectionClass).toBe("repairable");
    expect(result.items.map(normalizeItem)).toEqual([
      {
        checkId: "exclusion:0",
        disposition: "rejected",
        reasonCode: DATA_CLEANING_REASON_CODES.unknownSegment,
        rejectionClass: "repairable",
      },
    ]);
    expect(port.persistValidationArtifact).toHaveBeenCalledTimes(1);
    expect(port.persistCleaningResult).not.toHaveBeenCalled();
  });

  it("finalize 返回端口结果，且同一输入重复调用是确定性的", async () => {
    const { definition, port, resultRef } = setup();
    const other = candidate([documentExclusion("source-1-2")], { candidateVersion: 2 });

    expect(await definition.finalizeCandidate(cleanCandidate, task)).toBe(resultRef);
    await definition.finalizeCandidate(other, task);
    expect(await definition.finalizeCandidate(cleanCandidate, task)).toBe(resultRef);

    expect(port.loadFrozenInput).toHaveBeenCalledWith(task);
    expect(port.persistCleaningResult).toHaveBeenCalledTimes(3);
    const calls = port.persistCleaningResult.mock.calls;
    expect(calls[1][0].candidate).toEqual(other);
    expect(calls[2][0].candidate).toEqual(cleanCandidate);
    expect(calls[2][0].frozen).toEqual(frozenInput());
    // 无跨调用可变状态：同一候选重新推导出逐字段相同的校验产物引用与收口结果。
    expect(calls[2][0].validationArtifactRef).toEqual(calls[0][0].validationArtifactRef);
    expect(calls[2][0].settlement).toEqual(calls[0][0].settlement);
    expect(calls[0][0].validationArtifactRef).toEqual(
      await port.persistValidationArtifact.mock.results[0].value,
    );
    expect(calls[1][0].settlement).not.toEqual(calls[0][0].settlement);
  });
});
