/** 合成样本、待甲方复核：本文件所有工程、身份、摘要与工件正文均为合成夹具。 */
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommitV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";
import {
  StandardizedRiskRecordEnvelopeSchema,
  type StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";
import type { StandardizedRiskRecordWriteV1 } from "@riskflow/core/identification/candidate-finalization";

import { PostgresRiskCandidateFinalizationAdapter } from "../../src/identification/candidate-finalization/postgres-risk-candidate-adapter.js";

export const QUALITY_FIXTURE_PROJECT_ID = "quality-fixture-project";
export const QUALITY_FIXTURE_TIME = "2030-06-01T00:00:00.000Z";

/**
 * C06 签发形状的等价夹具：C04 与 C03 仍在本测试中做真实的工程、capability、空间与资料校验，
 * 只是不重复建设 C06 的账号事实；真实 C06 路径由 CLI 与浏览器验收覆盖。
 */
export const AUTHORIZATION_FIXTURE: AuthorizationContextV1 = {
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: "quality-authorization-context", versionId: "v1" },
  },
  actorId: "quality-actor",
  projectId: QUALITY_FIXTURE_PROJECT_ID,
  grantedCapabilities: ["projection.export"],
  spatialScopeRefs: [
    { kind: "spatial-scope", reference: { entityId: "quality-scope", versionId: "v1" } },
  ],
  sourceAccessGrantRefs: [
    { kind: "source-access-grant", reference: { entityId: "quality-source", versionId: "v1" } },
  ],
  authorizationPolicyRef: { entityId: "quality-authorization-policy", versionId: "v1" },
  decidedAt: QUALITY_FIXTURE_TIME,
  invocation: { kind: "human" },
};

const versionRef = (entityId: string) => ({ entityId, versionId: "1" });

const SEED_COMMAND_ID = "quality-fixture-seed";

interface SampleBlueprintV1 {
  readonly sampleId: string;
  readonly expectedPositive: boolean;
  readonly processNodeId: string;
  readonly sourceSegmentId: string;
  readonly expectedEventKey: string;
  readonly snapshotEventKey: string;
  readonly recordInCatalog: boolean;
  readonly snapshotArtifactExists: boolean;
  readonly assessmentDeclared: boolean;
  readonly expectedClassification: string;
}

const BLUEPRINTS: readonly SampleBlueprintV1[] = [
  {
    sampleId: "q-a1",
    expectedPositive: true,
    processNodeId: "process-node-a",
    sourceSegmentId: "segment-a1",
    expectedEventKey: "risk-event-a",
    snapshotEventKey: "risk-event-a",
    recordInCatalog: true,
    snapshotArtifactExists: true,
    assessmentDeclared: false,
    expectedClassification: "true-positive",
  },
  {
    sampleId: "q-a2",
    expectedPositive: false,
    processNodeId: "process-node-a",
    sourceSegmentId: "segment-a2",
    expectedEventKey: "risk-event-absent",
    snapshotEventKey: "risk-event-absent",
    recordInCatalog: false,
    snapshotArtifactExists: false,
    assessmentDeclared: false,
    expectedClassification: "undetermined",
  },
  {
    sampleId: "q-b1",
    expectedPositive: true,
    processNodeId: "process-node-b",
    sourceSegmentId: "segment-b1",
    expectedEventKey: "risk-event-b",
    snapshotEventKey: "risk-event-b",
    recordInCatalog: false,
    snapshotArtifactExists: true,
    assessmentDeclared: false,
    expectedClassification: "false-negative",
  },
  {
    sampleId: "q-c1",
    expectedPositive: true,
    processNodeId: "process-node-c",
    sourceSegmentId: "segment-c1",
    expectedEventKey: "risk-event-c",
    snapshotEventKey: "risk-event-c",
    recordInCatalog: true,
    snapshotArtifactExists: false,
    assessmentDeclared: false,
    expectedClassification: "false-negative",
  },
  {
    sampleId: "q-d1",
    expectedPositive: true,
    processNodeId: "process-node-d",
    sourceSegmentId: "segment-d1",
    expectedEventKey: "risk-event-d",
    snapshotEventKey: "risk-event-d",
    recordInCatalog: true,
    snapshotArtifactExists: true,
    assessmentDeclared: true,
    expectedClassification: "true-positive",
  },
  {
    sampleId: "q-e1",
    expectedPositive: true,
    processNodeId: "process-node-e",
    sourceSegmentId: "segment-e1",
    expectedEventKey: "risk-event-e",
    snapshotEventKey: "risk-event-other",
    recordInCatalog: true,
    snapshotArtifactExists: true,
    assessmentDeclared: false,
    expectedClassification: "false-negative",
  },
];

const versionRefs = {
  identificationKnowledgeReleaseRef: versionRef("identification-knowledge"),
  identificationPolicySetRef: versionRef("identification-policy-set"),
  indicatorSystemRef: versionRef("indicator-system"),
  indicatorFieldMappingRef: versionRef("indicator-field-mapping"),
  applicableRuleSetRef: versionRef("applicable-rule-set"),
  weightSetRef: versionRef("weight-set"),
  riskMatrixRef: versionRef("risk-matrix"),
  modelDeploymentRef: versionRef("model-deployment"),
  promptTemplateRef: versionRef("prompt-template"),
  reviewPolicyRef: versionRef("review-policy"),
};

const sourceSegmentRef = (blueprint: SampleBlueprintV1) => ({
  locator: { sourceSegmentId: blueprint.sourceSegmentId },
  sourceVersion: { entityId: "quality-source", versionId: "v1" },
});

const envelopeFor = (
  blueprint: SampleBlueprintV1,
  riskRecordId: string,
  recordDigest: string,
): StandardizedRiskRecordEnvelope =>
  StandardizedRiskRecordEnvelopeSchema.parse({
    riskRecordId,
    record: {
      processNodeId: blueprint.processNodeId,
      riskSource: "quality-risk-source",
      riskFactor: "quality-risk-factor",
      riskEvent: blueprint.snapshotEventKey,
      riskElementRelations: [
        { sourceElement: "element-a", relation: "affects", targetElement: "element-b" },
      ],
      evidenceLocator: { sourceSegmentId: blueprint.sourceSegmentId },
      modelConfidence: 0.5,
    },
    riskMechanismEntryIds: ["quality-mechanism"],
    sourceIds: ["quality-source"],
    compositeConfidence: { value: 0.5, basis: ["quality:0.5"] },
    version: {
      reference: { entityId: riskRecordId, versionId: recordDigest },
      effectivePeriod: { validFrom: QUALITY_FIXTURE_TIME },
      systemTime: { recordedAt: QUALITY_FIXTURE_TIME },
    },
    audit: {
      actorId: "quality-actor",
      action: "identification.risk-record-accepted",
      recordedAt: QUALITY_FIXTURE_TIME,
    },
  });

const recordWriteRow = (
  blueprint: SampleBlueprintV1,
  riskRecordId: string,
  recordDigest: string,
  authorization: AuthorizationContextV1,
): StandardizedRiskRecordWriteV1 => ({
  riskRecordId,
  versionId: recordDigest,
  riskRecordRef: {
    kind: "standardized-risk-record",
    reference: { entityId: riskRecordId, versionId: recordDigest },
  },
  rowId: `${riskRecordId}:row`,
  idempotencyKey: `${riskRecordId}:idempotency`,
  requestDigest: recordDigest,
  projectId: authorization.projectId,
  workPlanRef: { kind: "identification-work-plan", reference: versionRef("quality-work-plan") },
  identificationRunRef: { kind: "workflow-run", reference: versionRef("quality-run") },
  inputSnapshotRef: {
    kind: "identification-input-snapshot",
    reference: versionRef(`quality-input-${blueprint.sampleId}`),
  },
  mergePlanRef: { kind: "merge-plan", reference: versionRef("quality-merge-plan") },
  routeDecisionRef: { kind: "route-decision", reference: versionRef("quality-route-decision") },
  groupId: `quality-group-${blueprint.sampleId}`,
  groupVersionId: "1",
  groupRef: {
    kind: "identification-group",
    reference: versionRef(`quality-group-${blueprint.sampleId}`),
  },
  representativeCandidateRefs: [
    {
      kind: "content-artifact",
      reference: { entityId: `quality-candidate-${blueprint.sampleId}`, versionId: "1" },
    },
  ],
  sourceSegmentIds: [blueprint.sourceSegmentId],
  mechanismEntryIds: ["quality-mechanism"],
  authorizationScopeDigest: sha256CanonicalJson({
    sampleId: blueprint.sampleId,
    scope: "quality-scope",
  }),
  authorizationContextRef: authorization.authorizationContextRef,
  actorRef: authorization.actorId,
  commandId: SEED_COMMAND_ID,
  occurredAt: QUALITY_FIXTURE_TIME,
});

export interface QualityEvaluationSeededSampleV1 {
  readonly datasetSample: Record<string, unknown>;
  readonly expectedClassification: string;
}

export interface QualityEvaluationSeedingPortsV1 {
  readonly recordStore: PostgresRiskCandidateFinalizationAdapter;
  readonly transactionUnit: TransactionUnitV1;
  readonly authorization: AuthorizationContextV1;
  putJson(input: {
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly value: unknown;
  }): Promise<{ readonly entityId: string; readonly versionId: string }>;
}

/**
 * 冻结合成数据集的运行输出侧：在真实 C03 事务中写入 C22 正式记录，并把 C22 记录快照
 * 冻结为 C04 内容工件；返回的样例声明绑定本次真实产生的精确引用。
 */
export const seedQualityEvaluationFixture = async (
  ports: QualityEvaluationSeedingPortsV1,
): Promise<{ readonly samples: readonly QualityEvaluationSeededSampleV1[] }> => {
  const rows: StandardizedRiskRecordWriteV1[] = [];
  const envelopes: StandardizedRiskRecordEnvelope[] = [];
  const recordIds = new Map<string, string>();
  for (const blueprint of BLUEPRINTS) {
    if (!blueprint.recordInCatalog) continue;
    const riskRecordId = `identification-risk-record-${blueprint.sampleId}`;
    const recordDigest = sha256CanonicalJson({
      sampleId: blueprint.sampleId,
      riskRecordId,
      projectId: ports.authorization.projectId,
    });
    recordIds.set(blueprint.sampleId, riskRecordId);
    rows.push(recordWriteRow(blueprint, riskRecordId, recordDigest, ports.authorization));
    envelopes.push(envelopeFor(blueprint, riskRecordId, recordDigest));
  }
  if (rows.length > 0) {
    await ports.transactionUnit.execute(
      AtomicCommandV1Schema.parse({
        projectId: ports.authorization.projectId,
        commandKind: "identification.risk-record-accepted",
        commandId: SEED_COMMAND_ID,
        idempotencyKey: SEED_COMMAND_ID,
        payload: { sampleIds: [...recordIds.keys()] },
        actorRef: ports.authorization.actorId,
        authorizationContextRef: ports.authorization.authorizationContextRef,
        issuedAt: QUALITY_FIXTURE_TIME,
      }),
      async (context): Promise<AtomicCommitV1> => {
        const insertion = await ports.recordStore.insertRecords(
          { rows, records: envelopes, occurredAt: QUALITY_FIXTURE_TIME },
          context,
        );
        if (insertion.kind === "conflict") throw new Error("fixture record seed conflicted");
        return {
          resultRef: { kind: "standardized-risk-record", reference: versionRef("quality-seed") },
          audit: {
            auditEntryId: `${SEED_COMMAND_ID}:audit`,
            projectId: ports.authorization.projectId,
            action: "identification.risk-record-accepted",
            targetRef: {
              kind: "standardized-risk-record",
              reference: versionRef("quality-seed"),
            },
            actorRef: ports.authorization.actorId,
            authorizationContextRef: ports.authorization.authorizationContextRef,
            occurredAt: QUALITY_FIXTURE_TIME,
            recordedAt: QUALITY_FIXTURE_TIME,
            version: { entityId: `${SEED_COMMAND_ID}:audit`, versionId: "1" },
            commandId: SEED_COMMAND_ID,
            idempotencyKey: SEED_COMMAND_ID,
          },
          events: [],
        };
      },
    );
  }

  const samples: QualityEvaluationSeededSampleV1[] = [];
  for (const blueprint of BLUEPRINTS) {
    const declared: Record<string, unknown> = {};
    if (blueprint.recordInCatalog) {
      const riskRecordId = recordIds.get(blueprint.sampleId)!;
      const envelope = envelopes.find((entry) => entry.riskRecordId === riskRecordId)!;
      declared["riskRecordRef"] = {
        kind: "standardized-risk-record",
        reference: {
          entityId: riskRecordId,
          versionId: envelope.version.reference.versionId,
        },
      };
      if (blueprint.snapshotArtifactExists) {
        const snapshot = await ports.putJson({
          artifactId: `quality-sample-snapshot-${blueprint.sampleId}`,
          purposeCode: "quality-evaluation.sample-snapshot",
          mediaType: "application/json",
          value: envelope,
        });
        declared["standardizedRiskRecordSnapshotArtifactRef"] = {
          kind: "content-artifact",
          reference: snapshot,
        };
      } else {
        declared["standardizedRiskRecordSnapshotArtifactRef"] = {
          kind: "content-artifact",
          reference: {
            entityId: `quality-sample-snapshot-${blueprint.sampleId}`,
            versionId: `sha256:${"0".repeat(64)}`,
          },
        };
      }
      if (blueprint.assessmentDeclared) {
        declared["assessmentRecordRef"] = {
          kind: "risk-assessment-record",
          reference: versionRef(`risk-assessment-record-${blueprint.sampleId}`),
        };
        declared["assessmentDecisionArtifactRef"] = {
          kind: "content-artifact",
          reference: {
            entityId: `assessment-decision-${blueprint.sampleId}`,
            versionId: `sha256:${"1".repeat(64)}`,
          },
        };
        declared["assessmentReplayContextArtifactRef"] = {
          kind: "content-artifact",
          reference: {
            entityId: `quality-replay-context-${blueprint.sampleId}`,
            versionId: `sha256:${"2".repeat(64)}`,
          },
        };
      }
    }
    samples.push({
      datasetSample: {
        sampleId: blueprint.sampleId,
        spatialScopeRef: {
          kind: "spatial-scope",
          reference: { entityId: "quality-scope", versionId: "v1" },
        },
        processNodeId: blueprint.processNodeId,
        sourceSegmentRefs: [sourceSegmentRef(blueprint)],
        applicabilitySnapshotRef: {
          kind: "applicability-metadata-snapshot",
          reference: versionRef(`quality-applicability-${blueprint.sampleId}`),
        },
        identificationInputSnapshotRef: {
          kind: "identification-input-snapshot",
          reference: versionRef(`quality-input-${blueprint.sampleId}`),
        },
        assessmentInputSnapshotRef: {
          kind: "assessment-input-snapshot",
          reference: versionRef(`quality-assessment-input-${blueprint.sampleId}`),
        },
        ...declared,
        expectedEventKey: blueprint.expectedEventKey,
        expectedPositive: blueprint.expectedPositive,
        requiredEvidenceRefs: [sourceSegmentRef(blueprint)],
        versionRefs,
      },
      expectedClassification: blueprint.expectedClassification,
    });
  }
  return { samples };
};
