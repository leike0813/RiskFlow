import {
  AgentTaskDefinitionMetadataV1Schema,
  type AgentDomainToolExecutionContextV1,
  type AgentDomainToolResultV1,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentValidationResultV1,
} from "../agent-runtime/index.js";
import { sha256CanonicalJson } from "../persistence/canonical-json.js";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import type {
  AgentTaskResultRefV1,
  IdentificationPreparationSnapshotRefV1,
  KnowledgeReleaseRefV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference } from "@riskflow/contracts/common";
import {
  PROCESS_NODE_VALUES,
  RISK_MECHANISM_TYPE_VALUES,
  type ProcessDependencyRelationType,
  type ProcessNode,
} from "@riskflow/contracts/vocabulary";

import {
  IdentificationKnowledgePackageV1Schema,
  KnowledgeAuthoringActionV1Schema,
  KnowledgeAuthoringCandidateV1Schema,
  KnowledgeAuthoringIncrementV1Schema,
  type IdentificationEvidenceDecisionV1,
  type IdentificationKnowledgeDefinitionTypeV1,
  type IdentificationKnowledgePackageV1,
  type IdentificationKnowledgeValidationItemV1,
  type IdentificationKnowledgeValidationPolicyV1,
  type IdentificationKnowledgeReleaseAppendV1,
  type KnowledgeAuthoringIncrementV1,
  type ProcessModelPackageV1,
  type RiskMechanismPackageV1,
  type StandardLibraryEntryV1,
} from "./schema.js";

/** 逐项校验使用的稳定检查身份；同一检查在包与增量两侧保持一致。 */
export const IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1 = {
  packageSchema: "package.strict-schema",
  packageProject: "package.project",
  packageDefinitionType: "package.definition-type",
  packagePolicyRef: "package.validation-policy",
  packageEntriesLimit: "package.entries-limit",
  processRequiredKinds: "process.required-kinds",
  processNode: "process.node",
  processEdge: "process.dependency-edge",
  processTimeCycle: "process.time-cycle",
  mechanismRequiredTypes: "mechanism.required-types",
  mechanismEntry: "mechanism.entry",
  mechanismCoverage: "mechanism.critical-coverage",
  standardEntry: "standard-library.entry",
  caseEntry: "case-library.entry",
  compositeMembers: "retrieval-evidence-base.members",
  incrementTargetType: "increment.target-type",
  incrementOperation: "increment.operation",
} as const;

/** 稳定原因码；调用方与测试只断言这些标识，不断言文案。 */
export const IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1 = {
  schemaInvalid: "schema-invalid",
  projectMismatch: "project-mismatch",
  definitionTypeMismatch: "definition-type-mismatch",
  validationPolicyMismatch: "validation-policy-mismatch",
  entryLimitExceeded: "entry-limit-exceeded",
  missingRequiredProcessKind: "missing-required-process-kind",
  duplicateNodeId: "duplicate-node-id",
  unknownEdgeEndpoint: "unknown-edge-endpoint",
  selfReferencingEdge: "self-referencing-edge",
  duplicateEdge: "duplicate-edge",
  timeDependencyCycle: "time-dependency-cycle",
  nodeEvidenceIneligible: "node-evidence-ineligible",
  edgeEvidenceIneligible: "edge-evidence-ineligible",
  missingRequiredMechanismType: "missing-required-mechanism-type",
  unknownProcessModel: "unknown-process-model",
  unknownProcessNode: "unknown-process-node",
  duplicateMechanismId: "duplicate-mechanism-id",
  mechanismEvidenceIneligible: "mechanism-evidence-ineligible",
  criticalCoverageShortfall: "critical-coverage-shortfall",
  duplicateEntryId: "duplicate-entry-id",
  standardLevelNotAllowed: "standard-level-not-allowed",
  caseMethodNotAllowed: "case-method-not-allowed",
  entryEvidenceIneligible: "entry-evidence-ineligible",
  standardRetrievalTextInvalid: "standard-retrieval-text-invalid",
  compositeMemberInvalid: "composite-member-invalid",
  compositeMemberDuplicate: "composite-member-duplicate",
  incrementTargetMismatch: "increment-target-mismatch",
  incrementBaselineMismatch: "increment-baseline-mismatch",
  incrementTargetExists: "increment-target-exists",
  incrementTargetMissing: "increment-target-missing",
  incrementBaselineMissing: "increment-baseline-missing",
} as const;

export type IdentificationKnowledgeReasonCodeV1 =
  (typeof IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1)[keyof typeof IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1];

/**
 * 只有结构、引用、覆盖缺口的修正属于可修复错误；权限、来源资格、跨工程、
 * 版本不兼容、策略不一致和组合冲突属于终止拒绝。
 */
const TERMINAL_REASON_CODE_TABLE: Readonly<Record<string, true>> = {
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.schemaInvalid]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.projectMismatch]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.definitionTypeMismatch]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.validationPolicyMismatch]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.nodeEvidenceIneligible]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.edgeEvidenceIneligible]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.mechanismEvidenceIneligible]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.entryEvidenceIneligible]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.standardRetrievalTextInvalid]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownProcessModel]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.standardLevelNotAllowed]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.caseMethodNotAllowed]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.compositeMemberInvalid]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.compositeMemberDuplicate]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMismatch]: true,
  [IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementBaselineMissing]: true,
};

const isTerminalReasonCode = (reasonCode: string): boolean =>
  TERMINAL_REASON_CODE_TABLE[reasonCode] === true;

export interface IdentificationKnowledgeValidationOutcomeV1 {
  readonly items: readonly IdentificationKnowledgeValidationItemV1[];
  readonly disposition: "accepted" | "rejected";
  readonly rejectionClass?: "repairable" | "terminal";
}

export interface IdentificationProcessModelNodeV1 {
  readonly nodeId: string;
  readonly processKind: ProcessNode;
}

/** D-04 窄读在 core 校验侧的注入点：证据资格与精确工序模型解析。 */
export interface IdentificationKnowledgeValidationDependenciesV1 {
  readonly projectId: string;
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
  readonly checkStandardRetrievalText?: (input: {
    readonly entry: StandardLibraryEntryV1;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  }) => Promise<boolean>;
  readonly checkEvidence: (input: {
    readonly evidenceReferences: readonly EvidenceReference[];
    readonly purposeCode: string;
  }) => Promise<readonly IdentificationEvidenceDecisionV1[]>;
  readonly resolveProcessModel?: (releaseRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }) => Promise<
    | {
        readonly projectId: string;
        readonly nodes: readonly IdentificationProcessModelNodeV1[];
      }
    | undefined
  >;
  readonly resolveCompositeMembers?: (input: {
    readonly riskMechanismReleaseRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly standardLibraryReleaseRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly caseLibraryReleaseRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
  }) => Promise<boolean>;
}

const accepted = (
  checkId: string,
  targetKind: IdentificationKnowledgeValidationItemV1["targetKind"],
  targetId: string,
): IdentificationKnowledgeValidationItemV1 => ({
  checkId,
  targetKind,
  targetId,
  disposition: "accepted",
  reasonCode: "accepted",
  evidenceReferences: [],
});

const rejected = (
  checkId: string,
  targetKind: IdentificationKnowledgeValidationItemV1["targetKind"],
  targetId: string,
  reasonCode: string,
  evidenceReferences: readonly EvidenceReference[] = [],
): IdentificationKnowledgeValidationItemV1 => ({
  checkId,
  targetKind,
  targetId,
  disposition: "rejected",
  rejectionClass: isTerminalReasonCode(reasonCode) ? "terminal" : "repairable",
  reasonCode,
  evidenceReferences: [...evidenceReferences],
});

const outcomeFrom = (
  items: readonly IdentificationKnowledgeValidationItemV1[],
): IdentificationKnowledgeValidationOutcomeV1 => {
  const failures = items.filter((item) => item.disposition === "rejected");
  if (failures.length === 0) {
    return { items: [...items], disposition: "accepted" };
  }
  return {
    items: [...items],
    disposition: "rejected",
    rejectionClass: failures.some((item) => item.rejectionClass === "terminal")
      ? "terminal"
      : "repairable",
  };
};

const evidenceCheck = async (
  dependencies: IdentificationKnowledgeValidationDependenciesV1,
  evidenceReferences: readonly EvidenceReference[],
): Promise<{ readonly eligible: boolean; readonly reasonCode: string }> => {
  const decisions = await dependencies.checkEvidence({
    evidenceReferences,
    purposeCode: "identification-knowledge-package",
  });
  for (const reference of evidenceReferences) {
    const decision = decisions.find(
      (candidate) =>
        candidate.evidenceReference.locator.sourceSegmentId === reference.locator.sourceSegmentId &&
        candidate.evidenceReference.sourceVersion.entityId === reference.sourceVersion.entityId &&
        candidate.evidenceReference.sourceVersion.versionId === reference.sourceVersion.versionId,
    );
    if (decision === undefined) return { eligible: false, reasonCode: "evidence-not-checked" };
    if (decision.disposition === "rejected") {
      return { eligible: false, reasonCode: decision.reasonCode };
    }
  }
  return { eligible: true, reasonCode: "accepted" };
};

const validateProcessModelPackage = async (
  packageValue: ProcessModelPackageV1,
  dependencies: IdentificationKnowledgeValidationDependenciesV1,
): Promise<IdentificationKnowledgeValidationItemV1[]> => {
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  const nodeIds = new Set<string>();
  for (const node of packageValue.nodes) {
    if (nodeIds.has(node.nodeId)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processNode,
          "node",
          node.nodeId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateNodeId,
          node.evidence,
        ),
      );
      continue;
    }
    nodeIds.add(node.nodeId);
    const evidence = await evidenceCheck(dependencies, node.evidence);
    items.push(
      evidence.eligible
        ? accepted(IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processNode, "node", node.nodeId)
        : rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processNode,
            "node",
            node.nodeId,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.nodeEvidenceIneligible,
            node.evidence,
          ),
    );
  }
  const coveredKinds = new Set(packageValue.nodes.map((node) => node.processKind));
  const missingKinds = PROCESS_NODE_VALUES.filter((kind) => !coveredKinds.has(kind));
  items.push(
    missingKinds.length === 0
      ? accepted(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processRequiredKinds,
          "package",
          packageValue.projectId,
        )
      : rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processRequiredKinds,
          "package",
          packageValue.projectId,
          `${IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.missingRequiredProcessKind}:${missingKinds.join(",")}`,
        ),
  );
  const edgeKeys = new Set<string>();
  for (const edge of packageValue.dependencyEdges) {
    const key = `${edge.fromNodeId}|${edge.relationType}|${edge.toNodeId}`;
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processEdge,
          "edge",
          edge.edgeId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownEdgeEndpoint,
          edge.evidence,
        ),
      );
      continue;
    }
    if (edge.fromNodeId === edge.toNodeId) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processEdge,
          "edge",
          edge.edgeId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.selfReferencingEdge,
          edge.evidence,
        ),
      );
      continue;
    }
    if (edgeKeys.has(key)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processEdge,
          "edge",
          edge.edgeId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateEdge,
          edge.evidence,
        ),
      );
      continue;
    }
    edgeKeys.add(key);
    const evidence = await evidenceCheck(dependencies, edge.evidence);
    items.push(
      evidence.eligible
        ? accepted(IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processEdge, "edge", edge.edgeId)
        : rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processEdge,
            "edge",
            edge.edgeId,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.edgeEvidenceIneligible,
            edge.evidence,
          ),
    );
  }
  items.push(
    processModelHasTimeCycle(packageValue)
      ? rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processTimeCycle,
          "package",
          packageValue.projectId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.timeDependencyCycle,
        )
      : accepted(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.processTimeCycle,
          "package",
          packageValue.projectId,
        ),
  );
  return items;
};

/** 只对 `时间先后关系` 边做一次 O(V+E) 拓扑遍历；其它关系不构成时间环。 */
const processModelHasTimeCycle = (packageValue: ProcessModelPackageV1): boolean => {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of packageValue.nodes) {
    adjacency.set(node.nodeId, []);
    inDegree.set(node.nodeId, 0);
  }
  for (const edge of packageValue.dependencyEdges) {
    if ((edge.relationType as ProcessDependencyRelationType) !== "时间先后关系") continue;
    if (!adjacency.has(edge.fromNodeId) || !adjacency.has(edge.toNodeId)) continue;
    adjacency.get(edge.fromNodeId)!.push(edge.toNodeId);
    inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
  }
  const queue = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  let visited = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    visited += 1;
    for (const next of adjacency.get(nodeId) ?? []) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  return visited !== packageValue.nodes.length;
};

const validateRiskMechanismPackage = async (
  packageValue: RiskMechanismPackageV1,
  dependencies: IdentificationKnowledgeValidationDependenciesV1,
): Promise<IdentificationKnowledgeValidationItemV1[]> => {
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  const processModel =
    dependencies.resolveProcessModel === undefined
      ? undefined
      : await dependencies.resolveProcessModel(packageValue.processModelReleaseRef);
  if (processModel === undefined || processModel.projectId !== dependencies.projectId) {
    items.push(
      rejected(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismEntry,
        "mechanism",
        `${packageValue.processModelReleaseRef.reference.entityId}:${packageValue.processModelReleaseRef.reference.versionId}`,
        IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownProcessModel,
      ),
    );
  }
  const nodeKindById = new Map(
    (processModel?.nodes ?? []).map((node) => [node.nodeId, node.processKind] as const),
  );
  const mechanismIds = new Set<string>();
  for (const mechanism of packageValue.mechanisms) {
    if (mechanismIds.has(mechanism.mechanismId)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismEntry,
          "mechanism",
          mechanism.mechanismId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateMechanismId,
          mechanism.evidence,
        ),
      );
      continue;
    }
    mechanismIds.add(mechanism.mechanismId);
    const unknownNode = mechanism.nodeIds.find((nodeId) => !nodeKindById.has(nodeId));
    if (unknownNode !== undefined) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismEntry,
          "mechanism",
          mechanism.mechanismId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownProcessNode,
          mechanism.evidence,
        ),
      );
      continue;
    }
    const evidence = await evidenceCheck(dependencies, mechanism.evidence);
    items.push(
      evidence.eligible
        ? accepted(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismEntry,
            "mechanism",
            mechanism.mechanismId,
          )
        : rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismEntry,
            "mechanism",
            mechanism.mechanismId,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.mechanismEvidenceIneligible,
            mechanism.evidence,
          ),
    );
  }
  const missingTypes = RISK_MECHANISM_TYPE_VALUES.filter(
    (type) => !packageValue.mechanisms.some((mechanism) => mechanism.mechanismType === type),
  );
  items.push(
    missingTypes.length === 0
      ? accepted(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismRequiredTypes,
          "package",
          packageValue.projectId,
        )
      : rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismRequiredTypes,
          "package",
          packageValue.projectId,
          `${IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.missingRequiredMechanismType}:${missingTypes.join(",")}`,
        ),
  );
  for (const rule of dependencies.policy.coverage) {
    const covering = packageValue.mechanisms.filter((mechanism) =>
      mechanism.nodeIds.some((nodeId) => nodeKindById.get(nodeId) === rule.processKind),
    );
    const evidenceCount = new Set(
      covering.flatMap((mechanism) =>
        mechanism.evidence.map(
          (evidence) =>
            `${evidence.sourceVersion.entityId}/${evidence.sourceVersion.versionId}/${evidence.locator.sourceSegmentId}`,
        ),
      ),
    ).size;
    items.push(
      covering.length >= rule.minimumMechanisms && evidenceCount >= rule.minimumEvidence
        ? accepted(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismCoverage,
            "package",
            `${packageValue.projectId}:${rule.processKind}`,
          )
        : rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.mechanismCoverage,
            "package",
            `${packageValue.projectId}:${rule.processKind}`,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.criticalCoverageShortfall,
          ),
    );
  }
  return items;
};

const validateStandardLibraryPackage = async (
  packageValue: Extract<IdentificationKnowledgePackageV1, { definitionType: "standard-library" }>,
  dependencies: IdentificationKnowledgeValidationDependenciesV1,
): Promise<IdentificationKnowledgeValidationItemV1[]> => {
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  const entryIds = new Set<string>();
  for (const entry of packageValue.entries) {
    if (entryIds.has(entry.entryId)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.standardEntry,
          "standard-entry",
          entry.entryId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateEntryId,
          entry.evidence,
        ),
      );
      continue;
    }
    entryIds.add(entry.entryId);
    if (!dependencies.policy.allowedStandardLevels.includes(entry.level)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.standardEntry,
          "standard-entry",
          entry.entryId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.standardLevelNotAllowed,
          entry.evidence,
        ),
      );
      continue;
    }
    const evidence = await evidenceCheck(dependencies, entry.evidence);
    if (evidence.eligible && entry.retrievalText !== undefined) {
      const verified = await dependencies.checkStandardRetrievalText?.({
        entry,
        preparationSnapshotRef: packageValue.preparationSnapshotRef,
      });
      if (verified !== true) {
        items.push(
          rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.standardEntry,
            "standard-entry",
            entry.entryId,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.standardRetrievalTextInvalid,
            entry.evidence,
          ),
        );
        continue;
      }
    }
    items.push(
      evidence.eligible
        ? accepted(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.standardEntry,
            "standard-entry",
            entry.entryId,
          )
        : rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.standardEntry,
            "standard-entry",
            entry.entryId,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.entryEvidenceIneligible,
            entry.evidence,
          ),
    );
  }
  return items;
};

const validateCaseLibraryPackage = async (
  packageValue: Extract<IdentificationKnowledgePackageV1, { definitionType: "case-library" }>,
  dependencies: IdentificationKnowledgeValidationDependenciesV1,
): Promise<IdentificationKnowledgeValidationItemV1[]> => {
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  const entryIds = new Set<string>();
  for (const entry of packageValue.entries) {
    if (entryIds.has(entry.entryId)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.caseEntry,
          "case-entry",
          entry.entryId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateEntryId,
          entry.evidence,
        ),
      );
      continue;
    }
    entryIds.add(entry.entryId);
    if (!dependencies.policy.allowedCaseConstructionMethods.includes(entry.constructionMethod)) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.caseEntry,
          "case-entry",
          entry.entryId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.caseMethodNotAllowed,
          entry.evidence,
        ),
      );
      continue;
    }
    const evidence = await evidenceCheck(dependencies, entry.evidence);
    items.push(
      evidence.eligible
        ? accepted(IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.caseEntry, "case-entry", entry.entryId)
        : rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.caseEntry,
            "case-entry",
            entry.entryId,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.entryEvidenceIneligible,
            entry.evidence,
          ),
    );
  }
  return items;
};

const validateCompositePackage = async (
  packageValue: Extract<
    IdentificationKnowledgePackageV1,
    { definitionType: "retrieval-evidence-base" }
  >,
  dependencies: IdentificationKnowledgeValidationDependenciesV1,
): Promise<IdentificationKnowledgeValidationItemV1[]> => {
  const members = [
    packageValue.riskMechanismReleaseRef,
    packageValue.standardLibraryReleaseRef,
    packageValue.caseLibraryReleaseRef,
  ];
  const distinct = new Set(
    members.map((member) => `${member.reference.entityId}/${member.reference.versionId}`),
  );
  if (distinct.size !== members.length) {
    return [
      rejected(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.compositeMembers,
        "composite-member",
        packageValue.projectId,
        IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.compositeMemberDuplicate,
      ),
    ];
  }
  const resolved =
    dependencies.resolveCompositeMembers === undefined
      ? false
      : await dependencies.resolveCompositeMembers({
          riskMechanismReleaseRef: packageValue.riskMechanismReleaseRef,
          standardLibraryReleaseRef: packageValue.standardLibraryReleaseRef,
          caseLibraryReleaseRef: packageValue.caseLibraryReleaseRef,
        });
  return [
    resolved
      ? accepted(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.compositeMembers,
          "composite-member",
          packageValue.projectId,
        )
      : rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.compositeMembers,
          "composite-member",
          packageValue.projectId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.compositeMemberInvalid,
        ),
  ];
};

/**
 * D-03 逐项确定性校验：strict/工程/类型 → 唯一与引用 → 最小集 → 关系与时间环 →
 * 适用性 → 证据资格 → 关键工序覆盖 → 组合成员。任何拒绝使整包不可送审。
 */
export const validateIdentificationKnowledgePackage = async (input: {
  readonly value: unknown;
  readonly expectedDefinitionType?: IdentificationKnowledgeDefinitionTypeV1;
  readonly dependencies: IdentificationKnowledgeValidationDependenciesV1;
}): Promise<IdentificationKnowledgeValidationOutcomeV1> => {
  const parsed = IdentificationKnowledgePackageV1Schema.safeParse(input.value);
  if (!parsed.success) {
    return {
      items: [
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageSchema,
          "package",
          input.expectedDefinitionType ?? "package",
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.schemaInvalid,
        ),
      ],
      disposition: "rejected",
      rejectionClass: "terminal",
    };
  }
  const packageValue = parsed.data;
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  if (packageValue.projectId !== input.dependencies.projectId) {
    items.push(
      rejected(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageProject,
        "package",
        packageValue.projectId,
        IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.projectMismatch,
      ),
    );
  } else {
    items.push(
      accepted(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageProject,
        "package",
        packageValue.projectId,
      ),
    );
  }
  if (
    input.expectedDefinitionType !== undefined &&
    packageValue.definitionType !== input.expectedDefinitionType
  ) {
    items.push(
      rejected(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageDefinitionType,
        "package",
        packageValue.definitionType,
        IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.definitionTypeMismatch,
      ),
    );
  } else {
    items.push(
      accepted(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageDefinitionType,
        "package",
        packageValue.definitionType,
      ),
    );
  }
  const policyRef = input.dependencies.policy.policyRef;
  items.push(
    packageValue.validationPolicyRef.entityId === policyRef.entityId &&
      packageValue.validationPolicyRef.versionId === policyRef.versionId
      ? accepted(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packagePolicyRef,
          "package",
          packageValue.validationPolicyRef.entityId,
        )
      : rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packagePolicyRef,
          "package",
          packageValue.validationPolicyRef.entityId,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.validationPolicyMismatch,
        ),
  );
  const entryCount = packageEntryCount(packageValue);
  if (entryCount > input.dependencies.policy.maxEntriesPerPackage) {
    items.push(
      rejected(
        IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageEntriesLimit,
        "package",
        packageValue.projectId,
        IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.entryLimitExceeded,
      ),
    );
  }
  switch (packageValue.definitionType) {
    case "process-model":
      items.push(...(await validateProcessModelPackage(packageValue, input.dependencies)));
      break;
    case "risk-mechanism":
      items.push(...(await validateRiskMechanismPackage(packageValue, input.dependencies)));
      break;
    case "standard-library":
      items.push(...(await validateStandardLibraryPackage(packageValue, input.dependencies)));
      break;
    case "case-library":
      items.push(...(await validateCaseLibraryPackage(packageValue, input.dependencies)));
      break;
    case "retrieval-evidence-base":
      items.push(...(await validateCompositePackage(packageValue, input.dependencies)));
      break;
  }
  return outcomeFrom(items);
};

const packageEntryCount = (packageValue: IdentificationKnowledgePackageV1): number => {
  switch (packageValue.definitionType) {
    case "process-model":
      return packageValue.nodes.length + packageValue.dependencyEdges.length;
    case "risk-mechanism":
      return packageValue.mechanisms.length;
    case "standard-library":
    case "case-library":
      return packageValue.entries.length;
    case "retrieval-evidence-base":
      return 3;
  }
};

export const identificationKnowledgePackageDigest = (packageValue: unknown): string =>
  sha256CanonicalJson(packageValue);

export type KnowledgeAuthoringApplyResultV1 =
  | {
      readonly kind: "applied";
      readonly package: IdentificationKnowledgePackageV1;
      readonly packageDigest: string;
    }
  | { readonly kind: "rejected"; readonly outcome: IdentificationKnowledgeValidationOutcomeV1 };

/**
 * 按目标类型应用封闭领域操作：只允许声明/退役与组合成员选择，禁止路径补丁、
 * 整对象覆盖、发布动作，且每项操作都必须命中冻结基线的精确摘要。
 */
export const applyKnowledgeAuthoringIncrement = (input: {
  readonly projectId: string;
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly baseline: IdentificationKnowledgePackageV1 | undefined;
  readonly baselineDigest: string | undefined;
  readonly increment: KnowledgeAuthoringIncrementV1;
  readonly generatedAt: string;
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
}): KnowledgeAuthoringApplyResultV1 => {
  const increment = KnowledgeAuthoringIncrementV1Schema.parse(input.increment);
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  const baseline = input.baseline;
  for (const operation of increment.operations) {
    if (
      input.baselineDigest !== undefined &&
      operation.expectedBaselineDigest !== input.baselineDigest
    ) {
      items.push(
        rejected(
          IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
          "package",
          operation.reasonCode,
          IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementBaselineMismatch,
          operation.evidence,
        ),
      );
    }
  }
  if (items.length > 0) return { kind: "rejected", outcome: outcomeFrom(items) };
  if (baseline !== undefined && baseline.definitionType !== increment.definitionType) {
    return {
      kind: "rejected",
      outcome: {
        items: [
          rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementTargetType,
            "package",
            increment.definitionType,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMismatch,
          ),
        ],
        disposition: "rejected",
        rejectionClass: "terminal",
      },
    };
  }
  if (baseline === undefined && increment.definitionType === "risk-mechanism") {
    return {
      kind: "rejected",
      outcome: {
        items: [
          rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
            "package",
            increment.definitionType,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementBaselineMissing,
          ),
        ],
        disposition: "rejected",
        rejectionClass: "terminal",
      },
    };
  }
  const draft = applyOperationsToDraft(increment, baseline, input.projectId);
  if (draft.kind === "rejected") return { kind: "rejected", outcome: draft.outcome };
  const merged = {
    ...draft.value,
    schemaVersion: "1",
    projectId: input.projectId,
    validationPolicyRef: input.policy.policyRef,
    preparationSnapshotRef: input.preparationSnapshotRef,
    generatedAt: input.generatedAt,
  };
  const parsed = IdentificationKnowledgePackageV1Schema.safeParse(merged);
  if (!parsed.success) {
    return {
      kind: "rejected",
      outcome: {
        items: [
          rejected(
            IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.packageSchema,
            "package",
            increment.definitionType,
            IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.schemaInvalid,
          ),
        ],
        disposition: "rejected",
        rejectionClass: "terminal",
      },
    };
  }
  return {
    kind: "applied",
    package: parsed.data,
    packageDigest: identificationKnowledgePackageDigest(parsed.data),
  };
};

const applyOperationsToDraft = (
  increment: KnowledgeAuthoringIncrementV1,
  baseline: IdentificationKnowledgePackageV1 | undefined,
  projectId: string,
):
  | { readonly kind: "applied"; readonly value: Record<string, unknown> }
  | { readonly kind: "rejected"; readonly outcome: IdentificationKnowledgeValidationOutcomeV1 } => {
  const items: IdentificationKnowledgeValidationItemV1[] = [];
  const value: Record<string, unknown> =
    baseline === undefined
      ? { projectId, definitionType: increment.definitionType }
      : structuredClone(baseline as Record<string, unknown>);
  switch (increment.definitionType) {
    case "process-model": {
      const nodes = new Map<string, Record<string, unknown>>(
        ((value.nodes as readonly { readonly nodeId: string }[] | undefined) ?? []).map((node) => [
          node.nodeId,
          node as Record<string, unknown>,
        ]),
      );
      const edges = new Map<string, Record<string, unknown>>(
        ((value.dependencyEdges as readonly { readonly edgeId: string }[] | undefined) ?? []).map(
          (edge) => [edge.edgeId, edge as Record<string, unknown>],
        ),
      );
      for (const operation of increment.operations) {
        if (operation.operation === "declare-node") {
          if (nodes.has(operation.node.nodeId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                "node",
                operation.node.nodeId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetExists,
                operation.evidence,
              ),
            );
            continue;
          }
          nodes.set(operation.node.nodeId, operation.node as Record<string, unknown>);
        } else if (operation.operation === "retire-node") {
          if (!nodes.has(operation.nodeId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                "node",
                operation.nodeId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMissing,
                operation.evidence,
              ),
            );
            continue;
          }
          nodes.delete(operation.nodeId);
          for (const [edgeId, edge] of edges) {
            if (edge.fromNodeId === operation.nodeId || edge.toNodeId === operation.nodeId) {
              edges.delete(edgeId);
            }
          }
        } else if (operation.operation === "declare-edge") {
          if (edges.has(operation.edge.edgeId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                "edge",
                operation.edge.edgeId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetExists,
                operation.evidence,
              ),
            );
            continue;
          }
          edges.set(operation.edge.edgeId, operation.edge as Record<string, unknown>);
        } else {
          if (!edges.has(operation.edgeId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                "edge",
                operation.edgeId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMissing,
                operation.evidence,
              ),
            );
            continue;
          }
          edges.delete(operation.edgeId);
        }
      }
      value.nodes = [...nodes.values()];
      value.dependencyEdges = [...edges.values()];
      break;
    }
    case "risk-mechanism": {
      const mechanisms = new Map<string, Record<string, unknown>>(
        ((value.mechanisms as readonly { readonly mechanismId: string }[] | undefined) ?? []).map(
          (mechanism) => [mechanism.mechanismId, mechanism as Record<string, unknown>],
        ),
      );
      for (const operation of increment.operations) {
        if (operation.operation === "declare-mechanism") {
          if (mechanisms.has(operation.mechanism.mechanismId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                "mechanism",
                operation.mechanism.mechanismId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetExists,
                operation.evidence,
              ),
            );
            continue;
          }
          mechanisms.set(
            operation.mechanism.mechanismId,
            operation.mechanism as Record<string, unknown>,
          );
        } else {
          if (!mechanisms.has(operation.mechanismId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                "mechanism",
                operation.mechanismId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMissing,
                operation.evidence,
              ),
            );
            continue;
          }
          mechanisms.delete(operation.mechanismId);
        }
      }
      value.mechanisms = [...mechanisms.values()];
      break;
    }
    case "standard-library":
    case "case-library": {
      const entries = new Map<string, Record<string, unknown>>(
        ((value.entries as readonly { readonly entryId: string }[] | undefined) ?? []).map(
          (entry) => [entry.entryId, entry as Record<string, unknown>],
        ),
      );
      for (const operation of increment.operations) {
        if (operation.operation === "cite-clause" || operation.operation === "cite-case") {
          if (entries.has(operation.entry.entryId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                increment.definitionType === "standard-library" ? "standard-entry" : "case-entry",
                operation.entry.entryId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetExists,
                operation.evidence,
              ),
            );
            continue;
          }
          entries.set(operation.entry.entryId, operation.entry as Record<string, unknown>);
        } else if (
          operation.operation === "retire-clause" ||
          operation.operation === "retire-case"
        ) {
          if (!entries.has(operation.entryId)) {
            items.push(
              rejected(
                IDENTIFICATION_KNOWLEDGE_CHECK_IDS_V1.incrementOperation,
                increment.definitionType === "standard-library" ? "standard-entry" : "case-entry",
                operation.entryId,
                IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMissing,
                operation.evidence,
              ),
            );
            continue;
          }
          entries.delete(operation.entryId);
        }
      }
      value.entries = [...entries.values()];
      break;
    }
    case "retrieval-evidence-base": {
      for (const operation of increment.operations) {
        if (operation.memberDefinitionType === "risk-mechanism") {
          value.riskMechanismReleaseRef = operation.memberReleaseRef;
        } else if (operation.memberDefinitionType === "standard-library") {
          value.standardLibraryReleaseRef = operation.memberReleaseRef;
        } else {
          value.caseLibraryReleaseRef = operation.memberReleaseRef;
        }
      }
      break;
    }
  }
  return items.length === 0
    ? { kind: "applied", value }
    : { kind: "rejected", outcome: outcomeFrom(items) };
};

// ------------------------------------------------------------------ C08 定义

/** C17 编制领域端口：由 IP-05～IP-07 的 adapter 实现，core 只声明动作与收口裁缝。 */
export interface KnowledgeAuthoringTaskPortV1 {
  readSegmentSlice(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  readExactKnowledge(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  validateAuthoringCandidate(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: unknown;
  }): Promise<AgentValidationResultV1>;
  finalizeAuthoringCandidate(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: unknown;
  }): Promise<AgentTaskResultRefV1>;
}

export interface KnowledgeAuthoringTaskDefinitionOptionsV1 {
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
  readonly port: KnowledgeAuthoringTaskPortV1;
}

export const KNOWLEDGE_AUTHORING_TASK_TYPE = "knowledge-authoring" as const;

/**
 * 组装 `knowledge-authoring` 的 C08 任务定义：白名单只有两个有界只读工具，
 * 候选只能是目标类型限定的封闭操作，正式结果由注入端口经 C17 façade 收口。
 */
export const createKnowledgeAuthoringTaskDefinition = (
  options: KnowledgeAuthoringTaskDefinitionOptionsV1,
): AgentTaskDefinitionV1 => {
  const policy = options.policy;
  const port = options.port;
  return {
    metadata: AgentTaskDefinitionMetadataV1Schema.parse({
      schemaVersion: "1",
      definitionRef: policy.agent.definitionRef,
      taskType: KNOWLEDGE_AUTHORING_TASK_TYPE,
      toolPolicyRef: policy.agent.toolPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
      supportedTriggerModes: ["embedded", "interactive"],
      allowedToolRefs: [policy.tools.segmentSliceToolRef, policy.tools.baselineKnowledgeToolRef],
      resultFamilies: ["knowledge-revision"],
    }),
    budgetPolicy: policy.agent.budgetPolicy,
    actionSchema: KnowledgeAuthoringActionV1Schema,
    incrementSchema: KnowledgeAuthoringIncrementV1Schema,
    candidateSchema: KnowledgeAuthoringCandidateV1Schema,
    tools: [
      {
        toolRef: policy.tools.segmentSliceToolRef,
        budgetUsage: {},
        execute: (input, context) => port.readSegmentSlice(input, context),
      },
      {
        toolRef: policy.tools.baselineKnowledgeToolRef,
        budgetUsage: {},
        execute: (input, context) => port.readExactKnowledge(input, context),
      },
    ],
    measureCandidateUsage: (candidate) => {
      const typed = KnowledgeAuthoringCandidateV1Schema.parse(candidate);
      return { candidates: 1, objects: typed.operations.length };
    },
    validateCandidate: async (candidate, context) =>
      port.validateAuthoringCandidate({ task: context, candidate }),
    finalizeCandidate: async (candidate, context) =>
      port.finalizeAuthoringCandidate({ task: context, candidate }),
  };
};

/**
 * 识别基础发布事件：只在检索证据库组合发布时发出，载荷仅含精确引用，聚合引用必须是
 * 组合发布本身（与 `knowledge.identification-basis-published.v1` 契约一致）。
 */
export const identificationBasisPublishedEvent = (input: {
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly compositeMemberReleaseRefs: readonly KnowledgeReleaseRefV1[];
  readonly command: IdentificationKnowledgeReleaseAppendV1["command"];
  readonly recordedAt: string;
  readonly auditEntryId: string;
}): DomainEventV1 => {
  const [processModel, riskMechanism, standardLibrary, caseLibrary] =
    input.compositeMemberReleaseRefs;
  if (
    processModel === undefined ||
    riskMechanism === undefined ||
    standardLibrary === undefined ||
    caseLibrary === undefined ||
    input.compositeMemberReleaseRefs.length !== 4
  ) {
    throw new TypeError("identification basis publication requires four member releases");
  }
  return DomainEventV1Schema.parse({
    schemaVersion: "1",
    eventId: `identification-basis-published-${input.releaseRef.reference.entityId}`,
    eventVersion: 1,
    eventType: "knowledge.identification-basis-published.v1",
    projectId: input.command.projectId,
    aggregateRef: input.releaseRef,
    occurredAt: input.command.issuedAt,
    recordedAt: input.recordedAt,
    causationId: input.command.commandId,
    correlationId: input.command.idempotencyKey,
    producerCommandId: input.command.commandId,
    idempotencyKey: input.command.idempotencyKey,
    authorizationContextRef: input.command.authorizationContextRef,
    auditTrailRef: {
      kind: "audit-trail",
      reference: { entityId: input.auditEntryId, versionId: "1" },
    },
    payload: {
      basisKind: "identification-basis",
      publishedReleases: [
        { definitionType: "process-model", releaseRef: processModel },
        { definitionType: "risk-mechanism", releaseRef: riskMechanism },
        { definitionType: "standard-library", releaseRef: standardLibrary },
        { definitionType: "case-library", releaseRef: caseLibrary },
        { definitionType: "retrieval-evidence-base", releaseRef: input.releaseRef },
      ],
      retrievalEvidenceBaseReleaseRef: {
        kind: "retrieval-evidence-base-release",
        reference: input.releaseRef.reference,
      },
    },
  });
};
