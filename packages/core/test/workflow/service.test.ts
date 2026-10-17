import { describe, expect, it } from "vitest";

import type { StartWorkflowRunCommandV1 } from "@riskflow/contracts/ports";

import {
  WorkflowGraphResultRowV1Schema,
  WorkflowGraphRunStateV1Schema,
} from "../../src/workflow/schema.js";
import {
  assessmentReasonForWorkflowReassessmentV1,
  assessmentSubRunIdentityFor,
  classifyWorkflowGraphFailure,
  evaluateWorkflowEntryGate,
  initialRunVersionId,
  nextRunVersionId,
  normalizeMonitoringInputs,
  reassessmentEntryFromStartPayloadV1,
  reconcileCheckpointReference,
  workflowEntryIdentityFor,
  workflowRunIdentityFor,
  workflowRequestDigest,
  type WorkflowStartPayloadV1,
} from "../../src/workflow/service.js";

type Payload = WorkflowStartPayloadV1 & { readonly entryMode: string };

const version = (kind: string, entityId = kind, versionId = "v1") => ({
  kind,
  reference: { entityId, versionId },
});

const projectRevisionRef = version("project-revision");
const spatialA = version("spatial-scope", "space-a");
const spatialB = version("spatial-scope", "space-b");
const monitoringA = version("monitoring-snapshot", "monitor-a");
const monitoringB = version("monitoring-snapshot", "monitor-b");
const applicabilityA = version("applicability-metadata-snapshot", "applicability-a");
const applicabilityB = version("applicability-metadata-snapshot", "applicability-b");
const riskInput = version("risk-input-version", "risk-input");
const basisReleaseSet = version("assessment-basis-release-set", "basis");
const sourceVersion = version("source-version", "source");
const graphVersion = { entityId: "graph", versionId: "v1" };
const retryPolicyRef = { entityId: "retry", versionId: "v1" };

const identifyAndAssess = (overrides: Record<string, unknown> = {}): Payload =>
  ({
    graphVersion,
    retryPolicyRef,
    entryMode: "identify-and-assess",
    projectRevisionRef,
    spatialScopeRefs: [spatialA],
    sourceVersionRefs: [sourceVersion],
    ...overrides,
  }) as unknown as Payload;

const assess = (overrides: Record<string, unknown> = {}): Payload =>
  ({
    graphVersion,
    retryPolicyRef,
    entryMode: "assess",
    riskInput,
    applicabilityMetadataSnapshotRef: applicabilityA,
    spatialScopeRef: spatialA,
    projectRevisionRef,
    ...overrides,
  }) as unknown as Payload;

const historicalBackfill = (overrides: Record<string, unknown> = {}): Payload =>
  ({
    graphVersion,
    retryPolicyRef,
    entryMode: "historical-backfill",
    riskInput,
    applicabilityMetadataSnapshotRef: applicabilityA,
    effectiveAt: "2026-08-01T00:00:00Z",
    assessmentBasisReleaseSetRef: basisReleaseSet,
    ...overrides,
  }) as unknown as Payload;

const reassess = (overrides: Record<string, unknown> = {}): Payload =>
  ({
    graphVersion,
    retryPolicyRef,
    entryMode: "reassess",
    previousAssessmentRecordRef: version("risk-assessment-record", "record"),
    reason: "monitoring-snapshot",
    changedInputRefs: [monitoringA],
    ...overrides,
  }) as unknown as Payload;

describe("C30 entry gate", () => {
  it("pins an explicit assessment preparation into the entry identity", () => {
    const preparation = version("assessment-preparation-snapshot", "preparation");
    const original = evaluateWorkflowEntryGate(assess());
    const supplied = evaluateWorkflowEntryGate(
      assess({ assessmentPreparationSnapshotRef: preparation }),
    );
    expect(original.kind).toBe("ready");
    expect(supplied.kind).toBe("ready");
    if (original.kind !== "ready" || supplied.kind !== "ready") return;
    expect(supplied.frozenRefs).toContainEqual(preparation);
    const identity = (frozenRefs: typeof original.frozenRefs) =>
      workflowEntryIdentityFor({ entryMode: "assess", projectId: "project", frozenRefs });
    expect(identity(supplied.frozenRefs)).not.toEqual(identity(original.frozenRefs));
  });
  it("accepts paired multi-space contexts and freezes each space exactly once", () => {
    const gate = evaluateWorkflowEntryGate(
      identifyAndAssess({
        spatialScopeRefs: [spatialA, spatialB],
        assessmentContexts: [
          {
            spatialScopeRef: spatialA,
            applicabilityMetadataSnapshotRef: applicabilityA,
            monitoringSnapshotRefs: [monitoringA],
          },
          { spatialScopeRef: spatialB, applicabilityMetadataSnapshotRef: applicabilityB },
        ],
      }),
    );
    expect(gate.kind).toBe("ready");
    if (gate.kind !== "ready") return;
    expect(gate.assessmentContexts).toHaveLength(2);
    expect(gate.monitoringSnapshotRefs).toEqual([monitoringA]);
    expect(gate.frozenRefs).toContainEqual(applicabilityB);
    const singularGate = evaluateWorkflowEntryGate(
      identifyAndAssess({
        monitoringSnapshotRef: monitoringA,
        assessmentContexts: [
          {
            spatialScopeRef: spatialA,
            applicabilityMetadataSnapshotRef: applicabilityA,
            monitoringSnapshotRefs: [monitoringA],
          },
        ],
      }),
    );
    expect(singularGate.kind).toBe("ready");
    if (singularGate.kind === "ready") {
      expect(singularGate.frozenRefs).toContainEqual(monitoringA);
    }
  });

  it("blocks a risk whose space has no paired context and rejects duplicate pairing", () => {
    expect(
      evaluateWorkflowEntryGate(
        identifyAndAssess({
          spatialScopeRefs: [spatialA, spatialB],
          assessmentContexts: [
            { spatialScopeRef: spatialA, applicabilityMetadataSnapshotRef: applicabilityA },
          ],
        }),
      ),
    ).toMatchObject({ kind: "incomplete", detailCode: "assessment-context-missing" });
    expect(
      evaluateWorkflowEntryGate(
        identifyAndAssess({
          assessmentContexts: [
            { spatialScopeRef: spatialA, applicabilityMetadataSnapshotRef: applicabilityA },
            { spatialScopeRef: spatialA, applicabilityMetadataSnapshotRef: applicabilityB },
          ],
        }),
      ),
    ).toMatchObject({ kind: "conflict", detailCode: "assessment-context-duplicate" });
    expect(
      evaluateWorkflowEntryGate(
        identifyAndAssess({
          spatialScopeRefs: [spatialA],
          assessmentContexts: [
            { spatialScopeRef: spatialA, applicabilityMetadataSnapshotRef: applicabilityA },
            { spatialScopeRef: spatialB, applicabilityMetadataSnapshotRef: applicabilityB },
          ],
        }),
      ),
    ).toMatchObject({ kind: "conflict", detailCode: "assessment-context-unpaired" });
    expect(
      evaluateWorkflowEntryGate(
        identifyAndAssess({
          assessmentContexts: [
            {
              spatialScopeRef: spatialA,
              applicabilityMetadataSnapshotRef: applicabilityA,
              monitoringSnapshotRefs: [monitoringA, monitoringA],
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: "conflict", detailCode: "monitoring-input" });
    expect(
      evaluateWorkflowEntryGate(
        identifyAndAssess({
          monitoringSnapshotRef: monitoringA,
          assessmentContexts: [
            { spatialScopeRef: spatialA, applicabilityMetadataSnapshotRef: applicabilityA },
          ],
        }),
      ),
    ).toMatchObject({ kind: "conflict", detailCode: "monitoring-input" });
  });

  it("treats a legacy singular monitoring snapshot as the equivalent single-item set only", () => {
    expect(evaluateWorkflowEntryGate(assess({ monitoringSnapshotRef: monitoringA })).kind).toBe(
      "ready",
    );
    expect(evaluateWorkflowEntryGate(assess({ monitoringSnapshotRefs: [monitoringA] })).kind).toBe(
      "ready",
    );
    expect(
      evaluateWorkflowEntryGate(
        assess({ monitoringSnapshotRef: monitoringA, monitoringSnapshotRefs: [monitoringA] }),
      ).kind,
    ).toBe("ready");
    expect(
      evaluateWorkflowEntryGate(
        assess({ monitoringSnapshotRef: monitoringA, monitoringSnapshotRefs: [monitoringB] }),
      ),
    ).toMatchObject({ kind: "conflict" });
    expect(
      evaluateWorkflowEntryGate(assess({ monitoringSnapshotRefs: [monitoringA, monitoringA] })),
    ).toMatchObject({ kind: "conflict" });
  });

  it("refuses entries that omit the frozen references a formal run requires", () => {
    // 显式空集合与字段缺席是两种事实：前者拒绝，后者按无监测输入继续（design D-12）。
    expect(evaluateWorkflowEntryGate(assess({ monitoringSnapshotRefs: [] }))).toMatchObject({
      kind: "missing",
    });
    expect(evaluateWorkflowEntryGate(assess({ monitoringSnapshotRefs: undefined }))).toMatchObject({
      kind: "ready",
      monitoringSnapshotRefs: [],
    });
    expect(evaluateWorkflowEntryGate(assess({ projectRevisionRef: undefined }))).toMatchObject({
      kind: "incomplete",
      detailCode: "project-revision-missing",
    });
    expect(
      evaluateWorkflowEntryGate(
        historicalBackfill({ projectRevisionRef, spatialScopeRef: undefined }),
      ),
    ).toMatchObject({ kind: "incomplete", detailCode: "spatial-scope-missing" });
    expect(
      evaluateWorkflowEntryGate(
        historicalBackfill({
          projectRevisionRef,
          spatialScopeRef: spatialA,
          monitoringSnapshotRefs: [monitoringA],
          riskInput: undefined,
        }),
      ),
    ).toMatchObject({ kind: "incomplete", detailCode: "risk-input-missing" });
    expect(
      evaluateWorkflowEntryGate(reassess({ monitoringSnapshotRefs: [monitoringA] })),
    ).toMatchObject({ kind: "incomplete", detailCode: "project-revision-missing" });
  });

  it("keeps a historical backfill run on its own frozen basis and effective revision", () => {
    const gate = evaluateWorkflowEntryGate(
      historicalBackfill({
        spatialScopeRef: spatialA,
        projectRevisionRef,
        monitoringSnapshotRefs: [monitoringA, monitoringB],
      }),
    );
    expect(gate.kind).toBe("ready");
    if (gate.kind !== "ready") return;
    expect(gate.frozenRefs).toContainEqual(basisReleaseSet);
    expect(gate.frozenRefs).toContainEqual(projectRevisionRef);
    expect(gate.frozenRefs).toContainEqual(monitoringB);
  });

  it.each([
    [
      "forecast-response",
      {
        adoptedRecommendationRef: version("response-recommendation"),
        preActionMonitoringSnapshotRef: monitoringA,
      },
    ],
    [
      "record-response-feedback",
      { executionRecordRef: version("execution-record"), feedbackRef: version("feedback") },
    ],
  ] as const)("requires and freezes the explicit basis for %s", (entryMode, refs) => {
    const payload = { graphVersion, retryPolicyRef, entryMode, ...refs } as Payload;
    expect(evaluateWorkflowEntryGate(payload)).toMatchObject({
      kind: "incomplete",
      detailCode: "assessment-basis-missing",
    });
    const gate = evaluateWorkflowEntryGate({
      ...payload,
      assessmentBasisReleaseSetRef: basisReleaseSet,
    } as Payload);
    expect(gate.kind).toBe("ready");
    if (gate.kind !== "ready") return;
    expect(gate.frozenRefs).toContainEqual(basisReleaseSet);
  });

  it("freezes the explicit assessment input snapshot only when the segmented entry names it", () => {
    const assessmentInput = version("assessment-input-snapshot", "assessment-input");
    const segmented = [
      [
        "forecast-response",
        {
          adoptedRecommendationRef: version("response-recommendation"),
          preActionMonitoringSnapshotRef: monitoringA,
        },
      ],
      [
        "record-response-feedback",
        { executionRecordRef: version("execution-record"), feedbackRef: version("feedback") },
      ],
    ] as const;
    for (const [entryMode, refs] of segmented) {
      const base = {
        graphVersion,
        retryPolicyRef,
        entryMode,
        assessmentBasisReleaseSetRef: basisReleaseSet,
        ...refs,
      } as Payload;
      // 缺省保持原语义：不新增任何引用。
      const withoutExplicitBasis = evaluateWorkflowEntryGate(base);
      expect(withoutExplicitBasis.kind).toBe("ready");
      if (withoutExplicitBasis.kind !== "ready") continue;
      expect(withoutExplicitBasis.frozenRefs).not.toContainEqual(assessmentInput);
      // 显式给出时原样进入冻结输入，评估子图据此取精确评估依据。
      const withExplicitBasis = evaluateWorkflowEntryGate({
        ...base,
        frozenAssessmentBasisRef: assessmentInput,
      } as Payload);
      expect(withExplicitBasis.kind).toBe("ready");
      if (withExplicitBasis.kind !== "ready") continue;
      expect(withExplicitBasis.frozenRefs).toContainEqual(assessmentInput);
    }
  });
});

describe("C30 run identity and state version", () => {
  it("derives one parent run and one thread per entry identity", () => {
    const first = workflowRunIdentityFor({
      projectId: "project-1",
      entryMode: "identify-and-assess",
      entryIdentity: workflowEntryIdentityFor({
        entryMode: "identify-and-assess",
        projectId: "project-1",
        frozenRefs: [projectRevisionRef, spatialA],
      }),
      graphVersion,
    });
    const replay = workflowRunIdentityFor({
      projectId: "project-1",
      entryMode: "identify-and-assess",
      entryIdentity: workflowEntryIdentityFor({
        entryMode: "identify-and-assess",
        projectId: "project-1",
        frozenRefs: [spatialA, projectRevisionRef],
      }),
      graphVersion,
    });
    const differentInput = workflowRunIdentityFor({
      projectId: "project-1",
      entryMode: "identify-and-assess",
      entryIdentity: workflowEntryIdentityFor({
        entryMode: "identify-and-assess",
        projectId: "project-1",
        frozenRefs: [projectRevisionRef, spatialB],
      }),
      graphVersion,
    });
    expect(replay).toEqual(first);
    expect(differentInput.runRef).not.toEqual(first.runRef);
  });

  it("gives each accepted risk version its own assessment sub-run identity", () => {
    const parent = workflowRunIdentityFor({
      projectId: "project-1",
      entryMode: "identify-and-assess",
      entryIdentity: workflowEntryIdentityFor({
        entryMode: "identify-and-assess",
        projectId: "project-1",
        frozenRefs: [projectRevisionRef],
      }),
      graphVersion,
    }).runRef;
    const riskA = version("standardized-risk-record", "risk-a");
    const riskB = version("standardized-risk-record", "risk-b");
    const subA = assessmentSubRunIdentityFor({
      projectId: "project-1",
      parentRunRef: parent,
      riskRecordRef: riskA,
    });
    const subAReplay = assessmentSubRunIdentityFor({
      projectId: "project-1",
      parentRunRef: parent,
      riskRecordRef: riskA,
    });
    const subB = assessmentSubRunIdentityFor({
      projectId: "project-1",
      parentRunRef: parent,
      riskRecordRef: riskB,
    });
    expect(subAReplay).toEqual(subA);
    expect(subB.runRef).not.toEqual(subA.runRef);
    expect(workflowRequestDigest({ a: 1 })).toBe(workflowRequestDigest({ a: 1 }));
  });

  it("advances the run state version per stage and status without reuse", () => {
    const base = {
      runId: "run-1",
      entryMode: "assess" as const,
      recordedAt: "2026-08-31T00:00:00Z",
    };
    const first = initialRunVersionId(base);
    expect(first).toBe(initialRunVersionId(base));
    const second = nextRunVersionId({
      runId: "run-1",
      previousRunVersionId: first,
      stage: "A0",
      status: "running",
      recordedAt: "2026-08-31T00:01:00Z",
    });
    const third = nextRunVersionId({
      runId: "run-1",
      previousRunVersionId: second,
      stage: "A5",
      status: "running",
      recordedAt: "2026-08-31T00:02:00Z",
    });
    expect(new Set([first, second, third]).size).toBe(3);
  });
});

describe("C30 checkpoint reconciliation and failure classification", () => {
  it("only lets business facts lead the checkpoint by one provable step", () => {
    expect(reconcileCheckpointReference({ checkpointStage: "A4", registeredStage: "A4" })).toBe(
      "consistent",
    );
    expect(reconcileCheckpointReference({ checkpointStage: "A4", registeredStage: "A5" })).toBe(
      "business-ahead",
    );
    expect(reconcileCheckpointReference({ checkpointStage: "A5", registeredStage: "A4" })).toBe(
      "checkpoint-ahead",
    );
    expect(reconcileCheckpointReference({ checkpointStage: "A1", registeredStage: "A6" })).toBe(
      "inconsistent",
    );
    expect(
      reconcileCheckpointReference({ checkpointStage: "assessment", registeredStage: "A6" }),
    ).toBe("inconsistent");
  });

  it("classifies upstream failures without retrying permission or rule conflicts", () => {
    expect(
      classifyWorkflowGraphFailure({
        stage: "A5",
        upstream: { code: "AUTHORIZATION_DENIED", retryable: false },
        detailCode: "denied",
        occurredAt: "2026-08-31T00:00:00Z",
      }),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED", retryable: false });
    expect(
      classifyWorkflowGraphFailure({
        stage: "A5",
        upstream: { code: "TRANSIENT_FAILURE", retryable: true },
        detailCode: "transient",
        occurredAt: "2026-08-31T00:00:00Z",
      }),
    ).toMatchObject({ code: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryable: true });
    expect(
      classifyWorkflowGraphFailure({
        stage: "A5",
        upstream: { code: "BUSINESS_BLOCKED", retryable: false },
        detailCode: "rule-conflict",
        occurredAt: "2026-08-31T00:00:00Z",
      }),
    ).toMatchObject({ code: "CONTRACT_INVALID", retryable: false });
  });
});

describe("C30 registration rows", () => {
  it("requires the kind-specific references and pins the run-state version", () => {
    const row = {
      schemaVersion: "1",
      projectId: "project-1",
      resultId: "run-1:A0",
      resultVersionId: "version-1",
      runId: "run-1",
      runVersionId: "version-1",
      entryMode: "assess",
      commandId: "command-1",
      idempotencyKey: "idempotency-1",
      requestDigest: "a".repeat(64),
      actorRef: "actor-1",
      authorizationContextRef: version("authorization-context"),
      authorizationScopeDigest: "b".repeat(64),
      validAt: "2026-08-31T00:00:00Z",
      recordedAt: "2026-08-31T00:00:00Z",
      persistedAt: "2026-08-31T00:00:00Z",
      auditEntryId: "audit-1",
      resultKind: "run-state",
      stage: "A0",
      frozenRefs: [],
    };
    expect(WorkflowGraphResultRowV1Schema.safeParse(row).success).toBe(true);
    expect(
      WorkflowGraphResultRowV1Schema.safeParse({ ...row, runVersionId: "other" }).success,
    ).toBe(false);
    expect(
      WorkflowGraphResultRowV1Schema.safeParse({ ...row, resultKind: "entry-snapshot" }).success,
    ).toBe(false);
    expect(
      WorkflowGraphResultRowV1Schema.safeParse({ ...row, resultKind: "waiting", stage: "A6" })
        .success,
    ).toBe(false);
  });

  it("keeps run state bodies to references and terminal facts", () => {
    const state = {
      schemaVersion: "1",
      projectId: "project-1",
      runId: "run-1",
      runVersionId: "version-1",
      entryMode: "assess",
      entryIdentity: { entityId: "workflow-entry:project-1:assess", versionId: "entry-v1" },
      stage: "A5",
      status: "waiting",
      assessmentRunRefs: [],
      acceptedRiskRecordRefs: [],
      assessmentRecordRefs: [],
      warningRecordRefs: [],
      responseRecommendationRefs: [],
      deviationRecordRefs: [],
      calibrationSuggestionRefs: [],
      recordedAt: "2026-08-31T00:00:00Z",
    };
    expect(WorkflowGraphRunStateV1Schema.safeParse(state).success).toBe(true);
    expect(WorkflowGraphRunStateV1Schema.safeParse({ ...state, status: "completed" }).success).toBe(
      true,
    );
    expect(WorkflowGraphRunStateV1Schema.safeParse({ ...state, stage: "segment" }).success).toBe(
      false,
    );
  });

  it("keeps monitoring normalization total over singular, plural and conflicting inputs", () => {
    // design D-12：两字段缺席是 absent，显式空集合才是 missing。
    expect(normalizeMonitoringInputs({})).toEqual({ kind: "absent" });
    expect(normalizeMonitoringInputs({ monitoringSnapshotRef: monitoringA })).toEqual({
      kind: "ok",
      refs: [monitoringA],
    });
    expect(normalizeMonitoringInputs({ monitoringSnapshotRefs: [] })).toEqual({ kind: "missing" });
    expect(
      normalizeMonitoringInputs({
        monitoringSnapshotRef: monitoringA,
        monitoringSnapshotRefs: [monitoringB],
      }),
    ).toEqual({ kind: "conflict" });
  });

  it("maps the workflow reassessment reason to the C25 reason exactly once", () => {
    // 只有 weight-strategy 需要改名，其余四码原样透传（design D-12）。
    expect(assessmentReasonForWorkflowReassessmentV1("weight-strategy")).toBe("weight-or-strategy");
    for (const reason of [
      "monitoring-snapshot",
      "applicability-metadata",
      "applicable-rule-set",
      "risk-matrix",
    ] as const) {
      expect(assessmentReasonForWorkflowReassessmentV1(reason)).toBe(reason);
    }
  });

  it("folds the explicit reassessment entry into the parent entry identity", () => {
    const projectId = "project-c34";
    const assessmentRecordRef = version("risk-assessment-record", "record");
    const base = {
      entryMode: "reassess" as const,
      projectId,
      frozenRefs: [projectRevisionRef, spatialA, monitoringA],
    };
    const entry = {
      previousAssessmentRecordRef: assessmentRecordRef,
      reason: "weight-strategy" as const,
      changedInputRefs: [monitoringB],
    };
    const withEntry = workflowEntryIdentityFor({ ...base, reassessmentEntry: entry });
    // 携带该字段后是新的独立分区；同一输入稳定重放同一身份。
    expect(workflowEntryIdentityFor(base)).not.toEqual(withEntry);
    expect(workflowEntryIdentityFor({ ...base, reassessmentEntry: entry })).toEqual(withEntry);

    // 不同前驱、原因或变化引用都不得共享同一个运行分区。
    for (const different of [
      { ...entry, previousAssessmentRecordRef: version("risk-assessment-record", "record", "v2") },
      { ...entry, reason: "risk-matrix" as const },
      { ...entry, changedInputRefs: [projectRevisionRef] },
    ]) {
      expect(workflowEntryIdentityFor({ ...base, reassessmentEntry: different })).not.toEqual(
        withEntry,
      );
    }

    // 非重评入口不带该字段时身份与旧算法一致（保持原身份）。
    const assessBase = { entryMode: "assess" as const, projectId, frozenRefs: [spatialA] };
    expect(workflowEntryIdentityFor(assessBase)).toEqual(
      workflowEntryIdentityFor({ ...assessBase, reassessmentEntry: undefined }),
    );
  });

  it("keeps explicit identification batches distinct and preserves the default identity", () => {
    const base = {
      projectId: "batch-project",
      entryMode: "identify-and-assess" as const,
      frozenRefs: [projectRevisionRef, spatialA],
    };
    const original = workflowEntryIdentityFor(base);
    expect(workflowEntryIdentityFor({ ...base, executionBatchId: undefined })).toEqual(original);
    const batch = workflowEntryIdentityFor({ ...base, executionBatchId: "batch-a" });
    expect(batch).not.toEqual(original);
    expect(workflowEntryIdentityFor({ ...base, executionBatchId: "batch-a" })).toEqual(batch);
    expect(workflowEntryIdentityFor({ ...base, executionBatchId: "batch-b" })).not.toEqual(batch);
  });

  it("extracts the reassessment entry only from a reassess start payload", () => {
    const payload = reassess({ reason: "weight-strategy", changedInputRefs: [monitoringB] });
    expect(reassessmentEntryFromStartPayloadV1(payload)).toEqual({
      previousAssessmentRecordRef: version("risk-assessment-record", "record"),
      reason: "weight-strategy",
      changedInputRefs: [monitoringB],
    });
    expect(reassessmentEntryFromStartPayloadV1(assess())).toBeUndefined();
  });
});

export type { StartWorkflowRunCommandV1 };
