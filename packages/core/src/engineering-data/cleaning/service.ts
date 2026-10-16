import {
  AgentTaskDefinitionMetadataV1Schema,
  AgentValidationResultV1Schema,
  type AgentTaskDefinitionV1,
  type AgentDomainToolExecutionContextV1,
  type AgentDomainToolResultV1,
  type AgentTaskSnapshotV1,
} from "../../agent-runtime/index.js";
import type { AgentTaskResultRefV1 } from "@riskflow/contracts/ports";
import type { ArtifactRefV1 } from "../../artifacts/schema.js";
import {
  DataCleaningActionV1Schema,
  DataCleaningCandidateV1Schema,
  DataCleaningDocumentSliceRequestV1Schema,
  DataCleaningIncrementV1Schema,
  DataCleaningMonitoringSliceRequestV1Schema,
  DataCleaningPolicySchema,
  DataCleaningPreparationCatalogSliceRequestV1Schema,
  DataCleaningSettlementV1Schema,
  DataCleaningValidationViewV1Schema,
  type DataCleaningAvailabilityV1,
  type DataCleaningCandidateV1,
  type DataCleaningDocumentSliceRequestV1,
  type DataCleaningExclusionDecisionV1,
  type DataCleaningFrozenDocumentV1,
  type DataCleaningFrozenInputV1,
  type DataCleaningFrozenMonitoringV1,
  type DataCleaningInputStatusV1,
  type DataCleaningMonitoringSliceRequestV1,
  type DataCleaningMonitoringSelectionReasonV1,
  type DataCleaningPolicy,
  type DataCleaningPreparationCatalogSliceRequestV1,
  type DataCleaningSettlementV1,
  type DataCleaningValidationViewV1,
} from "./schema.js";
import type { SourceSegmentKindV1 } from "../context-source/schema.js";

/** 校验与收口阶段使用的稳定原因码。 */
export const DATA_CLEANING_REASON_CODES = {
  reasonCodeNotAllowed: "reason-code-not-allowed",
  duplicateExclusion: "duplicate-exclusion",
  unknownSourceVersion: "unknown-source-version",
  unknownSegment: "unknown-segment",
  snapshotMismatch: "snapshot-mismatch",
  unknownSample: "unknown-sample",
  evidenceNotFrozen: "evidence-not-frozen",
  protectedSegment: "protected-segment",
  protectedMonitoringSample: "protected-monitoring-sample",
  coverageBelowThreshold: "coverage-below-threshold",
  requiredSegmentKindMissing: "required-segment-kind-missing",
  retainedRatioBelowThreshold: "retained-ratio-below-threshold",
  monitoringBaselineUnavailable: "monitoring-baseline-unavailable",
  partialRetention: "partial-retention",
  monitoringPartialBaseline: "monitoring-partial-baseline",
  availabilityDegraded: "availability-degraded",
} as const;

export type DataCleaningReasonCodeV1 =
  (typeof DATA_CLEANING_REASON_CODES)[keyof typeof DATA_CLEANING_REASON_CODES];

/**
 * 只有“目标引用写错、原因码越界、重复项”属于可修复错误；来源资格、关键数值保护
 * 和必需结构冲突一律不可修复，禁止通过改写原因码或拆分为多项绕过。
 */
const REPAIRABLE_REASON_CODES: ReadonlySet<string> = new Set([
  DATA_CLEANING_REASON_CODES.reasonCodeNotAllowed,
  DATA_CLEANING_REASON_CODES.duplicateExclusion,
  DATA_CLEANING_REASON_CODES.unknownSourceVersion,
  DATA_CLEANING_REASON_CODES.unknownSegment,
  DATA_CLEANING_REASON_CODES.snapshotMismatch,
  DATA_CLEANING_REASON_CODES.unknownSample,
]);

const rejectionClassFor = (reasonCode: string): "repairable" | "terminal" =>
  REPAIRABLE_REASON_CODES.has(reasonCode) ? "repairable" : "terminal";

interface VersionedReference {
  readonly entityId: string;
  readonly versionId: string;
}

const refKey = (value: VersionedReference): string => `${value.entityId}@${value.versionId}`;

/**
 * 逐项校验 Agent 候选：只允许对冻结输入内既有引用提出排除。
 * 返回稳定的 `accepted | rejected` 项、可修复/不可修复分类；不修改任何原始事实。
 */
export const validateDataCleaningCandidate = (input: {
  readonly candidate: DataCleaningCandidateV1;
  readonly frozen: DataCleaningFrozenInputV1;
  readonly policy: DataCleaningPolicy;
}): DataCleaningValidationViewV1 => {
  const candidate = DataCleaningCandidateV1Schema.parse(input.candidate);
  const frozen = input.frozen;
  const policy = DataCleaningPolicySchema.parse(input.policy);

  const allowedReasonCodes = new Set(policy.allowedExclusionReasonCodes);
  const protectedKinds = new Set(policy.protectedSegmentKinds);
  const protectedSelectionReasons = new Set(policy.protectedMonitoringSelectionReasons);

  const documentByVersion = new Map<string, DataCleaningFrozenDocumentV1>();
  const segmentKindsByKey = new Map<string, SourceSegmentKindV1>();
  const documentSegmentKey = (sourceVersionKey: string, sourceSegmentId: string) =>
    `document-segment:${sourceVersionKey}:${sourceSegmentId}`;
  for (const document of frozen.documents) {
    const sourceVersionKey = refKey(document.sourceVersionRef.reference);
    documentByVersion.set(sourceVersionKey, document);
    for (const segment of document.segments) {
      segmentKindsByKey.set(
        documentSegmentKey(sourceVersionKey, segment.sourceSegmentId),
        segment.kind,
      );
    }
  }

  const monitoringMembers = new Map<
    string,
    { readonly selectionReason: DataCleaningMonitoringSelectionReasonV1 }
  >();
  if (frozen.monitoring !== undefined) {
    for (const member of frozen.monitoring.members) {
      monitoringMembers.set(refKey(member.sampleVersionRef.reference), {
        selectionReason: member.selectionReason,
      });
    }
  }

  const frozenEvidence = new Set<string>();
  for (const document of frozen.documents) {
    for (const segment of document.segments) {
      frozenEvidence.add(
        `${refKey(document.sourceVersionRef.reference)}:${segment.sourceSegmentId}`,
      );
    }
  }

  const seenTargets = new Set<string>();
  const items: Array<{
    checkId: string;
    disposition: "accepted" | "rejected";
    rejectionClass?: "repairable" | "terminal";
    reasonCode: string;
    evidenceReferences: DataCleaningExclusionDecisionV1["evidenceReferences"];
  }> = [];

  for (const [index, exclusion] of candidate.exclusions.entries()) {
    const checkId = `exclusion:${index}`;
    const evidenceReferences = exclusion.evidenceReferences;
    const reject = (reasonCode: string) => {
      items.push({
        checkId,
        disposition: "rejected",
        rejectionClass: rejectionClassFor(reasonCode),
        reasonCode,
        evidenceReferences,
      });
    };

    if (!allowedReasonCodes.has(exclusion.reasonCode)) {
      reject(DATA_CLEANING_REASON_CODES.reasonCodeNotAllowed);
      continue;
    }
    if (
      !evidenceReferences.every((evidence) =>
        frozenEvidence.has(`${refKey(evidence.sourceVersion)}:${evidence.locator.sourceSegmentId}`),
      )
    ) {
      reject(DATA_CLEANING_REASON_CODES.evidenceNotFrozen);
      continue;
    }

    if (exclusion.targetKind === "document-segment") {
      const sourceVersionKey = refKey(exclusion.sourceVersionRef.reference);
      if (documentByVersion.get(sourceVersionKey) === undefined) {
        reject(DATA_CLEANING_REASON_CODES.unknownSourceVersion);
        continue;
      }
      const targetKey = documentSegmentKey(sourceVersionKey, exclusion.sourceSegmentId);
      const kind = segmentKindsByKey.get(targetKey);
      if (kind === undefined) {
        reject(DATA_CLEANING_REASON_CODES.unknownSegment);
        continue;
      }
      if (protectedKinds.has(kind)) {
        reject(DATA_CLEANING_REASON_CODES.protectedSegment);
        continue;
      }
      if (seenTargets.has(targetKey)) {
        reject(DATA_CLEANING_REASON_CODES.duplicateExclusion);
        continue;
      }
      seenTargets.add(targetKey);
      items.push({
        checkId,
        disposition: "accepted",
        reasonCode: exclusion.reasonCode,
        evidenceReferences,
      });
      continue;
    }

    if (
      frozen.monitoring === undefined ||
      refKey(exclusion.monitoringSnapshotRef.reference) !==
        refKey(frozen.monitoring.monitoringSnapshotRef.reference)
    ) {
      reject(DATA_CLEANING_REASON_CODES.snapshotMismatch);
      continue;
    }
    const sampleVersionKey = refKey(exclusion.sampleVersionRef.reference);
    const member = monitoringMembers.get(sampleVersionKey);
    if (member === undefined) {
      reject(DATA_CLEANING_REASON_CODES.unknownSample);
      continue;
    }
    if (protectedSelectionReasons.has(member.selectionReason)) {
      reject(DATA_CLEANING_REASON_CODES.protectedMonitoringSample);
      continue;
    }
    const targetKey = `monitoring-sample:${sampleVersionKey}`;
    if (seenTargets.has(targetKey)) {
      reject(DATA_CLEANING_REASON_CODES.duplicateExclusion);
      continue;
    }
    seenTargets.add(targetKey);
    items.push({
      checkId,
      disposition: "accepted",
      reasonCode: exclusion.reasonCode,
      evidenceReferences,
    });
  }

  const rejected = items.filter((item) => item.disposition === "rejected");
  const rejectionClass =
    rejected.length === 0
      ? undefined
      : rejected.some((item) => item.rejectionClass === "terminal")
        ? ("terminal" as const)
        : ("repairable" as const);

  return DataCleaningValidationViewV1Schema.parse({
    disposition: rejected.length === 0 ? "accepted" : "rejected",
    ...(rejectionClass === undefined ? {} : { rejectionClass }),
    items,
  });
};

interface InputAssessment {
  readonly status: DataCleaningInputStatusV1;
  readonly reasonCodes: readonly string[];
}

const assessDocument = (input: {
  readonly document: DataCleaningFrozenDocumentV1;
  readonly policy: DataCleaningPolicy;
  readonly excludedSegmentIds: ReadonlySet<string>;
}): InputAssessment => {
  const { document, policy } = input;
  const retained = document.segments.filter(
    (segment) => !input.excludedSegmentIds.has(segment.sourceSegmentId),
  );
  const excluded = document.segments.filter((segment) =>
    input.excludedSegmentIds.has(segment.sourceSegmentId),
  );
  const totalCount = document.segments.length;
  const retainedCount = retained.length;
  const retainedRatio = totalCount === 0 ? 0 : retainedCount / totalCount;

  const presentKinds = new Set(retained.map((segment) => segment.kind));
  const requiredKinds =
    policy.schemaVersion === "1"
      ? policy.requiredSegmentKinds
      : policy.documentRules.find((rule) => rule.inputKind === document.inputKind)
          ?.requiredSegmentKinds;
  const missingRequiredSegmentKinds =
    policy.schemaVersion === "1"
      ? policy.requiredSegmentKinds.filter((kind) => !presentKinds.has(kind)).sort()
      : requiredKinds?.some((kind) => presentKinds.has(kind))
        ? []
        : [...(requiredKinds ?? [])];
  const reasonCodes: string[] = [];
  let availability: DataCleaningAvailabilityV1;

  if (
    requiredKinds === undefined ||
    retainedCount === 0 ||
    missingRequiredSegmentKinds.length > 0
  ) {
    availability = "unavailable";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.requiredSegmentKindMissing);
  } else if (policy.schemaVersion === "1" && retainedRatio < policy.minimumRetainedSegmentRatio) {
    availability = "unavailable";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.retainedRatioBelowThreshold);
  } else if (excluded.length > 0) {
    availability = "partial";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.partialRetention);
  } else {
    availability = "available";
  }

  return {
    reasonCodes,
    status: {
      inputKey: `document:${refKey(document.sourceVersionRef.reference)}`,
      inputKind: document.inputKind,
      availability,
      baselineAvailability: "available",
      totalCount,
      retainedCount,
      retainedRatio,
      retainedSegmentIds: retained.map((segment) => segment.sourceSegmentId).sort(),
      excludedSegmentIds: excluded.map((segment) => segment.sourceSegmentId).sort(),
      retainedSampleVersionRefs: [],
      excludedSampleVersionRefs: [],
      missingRequiredSegmentKinds,
      protectedRetained: true,
      reasonCodes,
      sourceVersionRef: document.sourceVersionRef,
    },
  };
};

const assessMonitoring = (input: {
  readonly monitoring: DataCleaningFrozenMonitoringV1;
  readonly policy: DataCleaningPolicy;
  readonly excludedSampleKeys: ReadonlySet<string>;
}): InputAssessment => {
  const { monitoring, policy } = input;
  const retained = monitoring.members.filter(
    (member) => !input.excludedSampleKeys.has(refKey(member.sampleVersionRef.reference)),
  );
  const excluded = monitoring.members.filter((member) =>
    input.excludedSampleKeys.has(refKey(member.sampleVersionRef.reference)),
  );
  const totalCount = monitoring.members.length;
  const retainedCount = retained.length;
  const retainedRatio = totalCount === 0 ? 0 : retainedCount / totalCount;
  const reasonCodes: string[] = [];
  let availability: DataCleaningAvailabilityV1;

  if (monitoring.availability === "unavailable") {
    availability = "unavailable";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.monitoringBaselineUnavailable);
  } else if (retainedRatio < policy.minimumRetainedSampleRatio) {
    availability = "unavailable";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.retainedRatioBelowThreshold);
  } else if (excluded.length > 0) {
    availability = "partial";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.partialRetention);
  } else if (monitoring.availability === "partial") {
    availability = "partial";
    reasonCodes.push(DATA_CLEANING_REASON_CODES.monitoringPartialBaseline);
  } else {
    availability = "available";
  }

  const byReference = (left: VersionedReference, right: VersionedReference) =>
    refKey(left).localeCompare(refKey(right));
  return {
    reasonCodes,
    status: {
      inputKey: "monitoring-snapshot",
      inputKind: "monitoring-snapshot",
      availability,
      baselineAvailability: monitoring.availability,
      totalCount,
      retainedCount,
      retainedRatio,
      retainedSegmentIds: [],
      excludedSegmentIds: [],
      retainedSampleVersionRefs: retained
        .map((member) => member.sampleVersionRef)
        .sort((left, right) => byReference(left.reference, right.reference)),
      excludedSampleVersionRefs: excluded
        .map((member) => member.sampleVersionRef)
        .sort((left, right) => byReference(left.reference, right.reference)),
      missingRequiredSegmentKinds: [],
      protectedRetained: true,
      reasonCodes,
      monitoringSnapshotRef: monitoring.monitoringSnapshotRef,
    },
  };
};

/**
 * 确定性收口：从冻结输入、策略与已接受排除计算保留范围、逐输入可用性和整体可用性。
 * C14 的 `unavailable` 是不可提升下界；Agent 无权指定、提升或覆盖最终可用性。
 */
export const settleDataCleaningCandidate = (input: {
  readonly candidate: DataCleaningCandidateV1;
  readonly frozen: DataCleaningFrozenInputV1;
  readonly policy: DataCleaningPolicy;
}): DataCleaningSettlementV1 => {
  const validation = validateDataCleaningCandidate(input);

  const excludedSegmentsByVersion = new Map<string, Set<string>>();
  const excludedSampleKeys = new Set<string>();
  const decisions: DataCleaningExclusionDecisionV1[] = [];

  for (const [index, exclusion] of input.candidate.exclusions.entries()) {
    const item = validation.items[index];
    const decisionId = `${input.frozen.manifestDigest}:exclusion:${index}`;
    const target =
      exclusion.targetKind === "document-segment"
        ? {
            sourceVersionRef: exclusion.sourceVersionRef,
            sourceSegmentId: exclusion.sourceSegmentId,
          }
        : {
            monitoringSnapshotRef: exclusion.monitoringSnapshotRef,
            sampleVersionRef: exclusion.sampleVersionRef,
          };
    if (item === undefined || item.disposition !== "accepted") {
      decisions.push({
        decisionId,
        targetKind: exclusion.targetKind,
        reasonCode: item?.reasonCode ?? DATA_CLEANING_REASON_CODES.evidenceNotFrozen,
        disposition: "rejected",
        rejectionClass: item?.rejectionClass ?? "terminal",
        evidenceReferences: exclusion.evidenceReferences,
        ...target,
      });
      continue;
    }
    if (exclusion.targetKind === "document-segment") {
      const key = refKey(exclusion.sourceVersionRef.reference);
      const bucket = excludedSegmentsByVersion.get(key) ?? new Set<string>();
      bucket.add(exclusion.sourceSegmentId);
      excludedSegmentsByVersion.set(key, bucket);
    } else {
      excludedSampleKeys.add(refKey(exclusion.sampleVersionRef.reference));
    }
    decisions.push({
      decisionId,
      targetKind: exclusion.targetKind,
      reasonCode: exclusion.reasonCode,
      disposition: "accepted",
      evidenceReferences: exclusion.evidenceReferences,
      ...target,
    });
  }

  const documentAssessments = input.frozen.documents.map((document) =>
    assessDocument({
      document,
      policy: input.policy,
      excludedSegmentIds:
        excludedSegmentsByVersion.get(refKey(document.sourceVersionRef.reference)) ??
        new Set<string>(),
    }),
  );
  const monitoringAssessment =
    input.frozen.monitoring === undefined
      ? undefined
      : assessMonitoring({
          monitoring: input.frozen.monitoring,
          policy: input.policy,
          excludedSampleKeys,
        });

  const documentsNonUnavailable = documentAssessments.filter(
    (assessment) => assessment.status.availability !== "unavailable",
  ).length;
  const overallCoverageRatio = documentsNonUnavailable / documentAssessments.length;
  const everyDocumentAvailable = documentAssessments.every(
    (assessment) => assessment.status.availability === "available",
  );
  const monitoringAllowsAvailable =
    monitoringAssessment === undefined || monitoringAssessment.status.availability === "available";

  const reasonCodes = new Set<string>();
  let overallAvailability: DataCleaningAvailabilityV1;
  if (
    documentsNonUnavailable === 0 ||
    overallCoverageRatio < input.policy.minimumDocumentCoverageRatio
  ) {
    overallAvailability = "unavailable";
    reasonCodes.add(DATA_CLEANING_REASON_CODES.coverageBelowThreshold);
  } else if (everyDocumentAvailable && monitoringAllowsAvailable) {
    overallAvailability = "available";
  } else {
    overallAvailability = "partial";
    reasonCodes.add(DATA_CLEANING_REASON_CODES.availabilityDegraded);
  }
  for (const assessment of documentAssessments) {
    for (const reason of assessment.reasonCodes) reasonCodes.add(reason);
  }
  if (monitoringAssessment !== undefined) {
    for (const reason of monitoringAssessment.reasonCodes) reasonCodes.add(reason);
  }

  const statuses: DataCleaningInputStatusV1[] = [
    ...documentAssessments.map((assessment) => assessment.status),
    ...(monitoringAssessment === undefined ? [] : [monitoringAssessment.status]),
  ];

  return DataCleaningSettlementV1Schema.parse({
    exclusions: decisions,
    inputs: statuses,
    overallAvailability,
    overallCoverageRatio,
    reasonCodes: [...reasonCodes].sort(),
    requiredDocumentRetentionSatisfied: overallAvailability !== "unavailable",
  });
};

/** 清洗任务执行期由适配器提供的持久化与只读切片端口。 */
export interface DataCleaningTaskPortV1 {
  loadFrozenInput(task: AgentTaskSnapshotV1): Promise<DataCleaningFrozenInputV1>;
  persistValidationArtifact(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: DataCleaningCandidateV1;
    readonly validation: DataCleaningValidationViewV1;
    readonly settlement: DataCleaningSettlementV1;
  }): Promise<ArtifactRefV1>;
  persistCleaningResult(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: DataCleaningCandidateV1;
    readonly frozen: DataCleaningFrozenInputV1;
    readonly settlement: DataCleaningSettlementV1;
    readonly validationArtifactRef: ArtifactRefV1;
  }): Promise<AgentTaskResultRefV1>;
  readDocumentSlice(
    input: DataCleaningDocumentSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  readMonitoringSlice(
    input: DataCleaningMonitoringSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  readPreparationCatalogSlice(
    input: DataCleaningPreparationCatalogSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
}

export interface CreateDataCleaningTaskDefinitionOptionsV1 {
  readonly policy: DataCleaningPolicy;
  readonly port: DataCleaningTaskPortV1;
  readonly now?: () => Date;
}

export const DATA_CLEANING_TASK_TYPE = "data-cleaning" as const;

/**
 * 组装 `embedded / data-cleaning` 的 C08 任务定义：白名单只含有界只读领域工具，声明定位
 * 工具引用的策略额外注册分页定位；候选只允许引用级排除，正式结果与校验记录由注入端口持久化。
 */
export const createDataCleaningTaskDefinition = (
  options: CreateDataCleaningTaskDefinitionOptionsV1,
): AgentTaskDefinitionV1 => {
  const policy = DataCleaningPolicySchema.parse(options.policy);
  const port = options.port;
  const now = options.now ?? (() => new Date());
  const preparationCatalogToolRef = policy.tools.preparationCatalogToolRef;

  const settle = async (task: AgentTaskSnapshotV1, candidate: DataCleaningCandidateV1) => {
    const frozen = await port.loadFrozenInput(task);
    return {
      frozen,
      validation: validateDataCleaningCandidate({ candidate, frozen, policy }),
      settlement: settleDataCleaningCandidate({ candidate, frozen, policy }),
    };
  };

  return {
    metadata: AgentTaskDefinitionMetadataV1Schema.parse({
      schemaVersion: "1",
      definitionRef: policy.agent.definitionRef,
      taskType: DATA_CLEANING_TASK_TYPE,
      toolPolicyRef: policy.agent.toolPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
      supportedTriggerModes: ["embedded"],
      allowedToolRefs: [
        policy.tools.documentSegmentToolRef,
        policy.tools.monitoringSnapshotToolRef,
        ...(preparationCatalogToolRef === undefined ? [] : [preparationCatalogToolRef]),
      ],
      resultFamilies: ["content-artifact"],
    }),
    budgetPolicy: policy.agent.budgetPolicy,
    actionSchema: DataCleaningActionV1Schema,
    incrementSchema: DataCleaningIncrementV1Schema,
    candidateSchema: DataCleaningCandidateV1Schema,
    tools: [
      {
        toolRef: policy.tools.documentSegmentToolRef,
        budgetUsage: {},
        execute: (input, context) =>
          port.readDocumentSlice(DataCleaningDocumentSliceRequestV1Schema.parse(input), context),
      },
      {
        toolRef: policy.tools.monitoringSnapshotToolRef,
        budgetUsage: {},
        execute: (input, context) =>
          port.readMonitoringSlice(
            DataCleaningMonitoringSliceRequestV1Schema.parse(input),
            context,
          ),
      },
      ...(preparationCatalogToolRef === undefined
        ? []
        : [
            {
              toolRef: preparationCatalogToolRef,
              budgetUsage: {},
              execute: (input: unknown, context: AgentDomainToolExecutionContextV1) =>
                port.readPreparationCatalogSlice(
                  DataCleaningPreparationCatalogSliceRequestV1Schema.parse(input),
                  context,
                ),
              // 只读分页可安全重做：同动作重放返回同一页与同一观察引用。
              recover: (input: unknown, context: AgentDomainToolExecutionContextV1) =>
                port.readPreparationCatalogSlice(
                  DataCleaningPreparationCatalogSliceRequestV1Schema.parse(input),
                  context,
                ),
            },
          ]),
    ],
    measureCandidateUsage: (candidate) => ({
      candidates: 1,
      objects: DataCleaningCandidateV1Schema.parse(candidate).exclusions.length,
    }),
    validateCandidate: async (candidate, context) => {
      const typed = DataCleaningCandidateV1Schema.parse(candidate);
      const { validation, settlement } = await settle(context, typed);
      const validationArtifactRef = await port.persistValidationArtifact({
        task: context,
        candidate: typed,
        validation,
        settlement,
      });
      return AgentValidationResultV1Schema.parse({
        schemaVersion: "1",
        items: validation.items,
        disposition: validation.disposition,
        ...(validation.rejectionClass === undefined
          ? {}
          : { rejectionClass: validation.rejectionClass }),
        validationArtifactRef,
        validatedAt: now().toISOString(),
      });
    },
    finalizeCandidate: async (candidate, context) => {
      const typed = DataCleaningCandidateV1Schema.parse(candidate);
      const { frozen, validation, settlement } = await settle(context, typed);
      const validationArtifactRef = await port.persistValidationArtifact({
        task: context,
        candidate: typed,
        validation,
        settlement,
      });
      return port.persistCleaningResult({
        task: context,
        candidate: typed,
        frozen,
        settlement,
        validationArtifactRef,
      });
    },
  };
};
