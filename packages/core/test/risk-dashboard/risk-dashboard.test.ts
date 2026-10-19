/**
 * 合成样本、待甲方复核：本文件所有工程、主体、引用与登记事实均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * 覆盖组合层的可观察契约：六来源独立成败、拒权不外溢、变化页全序与续页位置、
 * 失败来源不推进成功来源、游标绑定工程／空间／上界。
 */
import { describe, expect, it } from "vitest";

import {
  AuthorizationContextV1Schema,
  RiskDashboardReadQueryV1Schema,
  type AuthorizationContextV1,
  type ModuleErrorV1,
  type RiskDashboardAssessmentsSourceResultV1,
  type RiskDashboardDocumentsSourceResultV1,
  type RiskDashboardMonitoringSourceResultV1,
  type RiskDashboardReadQueryV1,
  type RiskDashboardReviewsSourceResultV1,
  type RiskDashboardRiskRecordsSourceResultV1,
  type RiskDashboardSourcesV1,
  type RiskDashboardTimelineEventV1,
  type RiskDashboardWarningsSourceResultV1,
} from "@riskflow/contracts/ports";

import { AccessServiceError } from "../../src/access/index.js";
import { createRiskDashboardReadService } from "../../src/risk-dashboard/index.js";

const TIMESTAMP = "2030-01-01T00:00:00.000Z";

const authorizationFor = (
  projectId: string,
  actorId = "actor-1",
  capabilities: readonly string[] = [
    // 入口资格：仪表盘分支复用既有投影读能力（design D-03）。
    "projection.query",
    "risk-identification.read",
    "risk-assessment.read",
    "warning-response.read",
    "review-audit.read",
    "engineering-data.read",
  ],
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: `auth-${projectId}`, versionId: "1" },
    },
    actorId,
    projectId,
    grantedCapabilities: capabilities,
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const queryFor = (
  projectId: string,
  payload: RiskDashboardReadQueryV1["payload"] = {},
  actorId = "actor-1",
): RiskDashboardReadQueryV1 =>
  RiskDashboardReadQueryV1Schema.parse({
    queryId: `dashboard-${projectId}`,
    projectId,
    actorId,
    requestedAt: TIMESTAMP,
    authorization: authorizationFor(projectId, actorId),
    kind: "read",
    payload,
  });

const deniedError = (capability: string): ModuleErrorV1 =>
  ({
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: capability,
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
    stageCode: "risk-dashboard.source-authorization",
    occurredAt: TIMESTAMP,
    causalRunId: "source-denied",
  }) as unknown as ModuleErrorV1;

const event = (
  source: "riskRecords" | "assessments" | "warnings",
  entityId: string,
  versionId: string,
  recordedAt: string,
): RiskDashboardTimelineEventV1 => {
  if (source === "riskRecords") {
    return {
      source,
      changeType: "risk-record-recorded",
      recordedAt,
      subjectRef: {
        kind: "standardized-risk-record",
        reference: { entityId, versionId },
      },
    };
  }
  if (source === "assessments") {
    return {
      source,
      changeType: "assessment-recorded",
      recordedAt,
      subjectRef: {
        kind: "risk-assessment-record",
        reference: { entityId, versionId },
      },
    };
  }
  return {
    source,
    changeType: "warning-recorded",
    recordedAt,
    subjectRef: { kind: "warning-record", reference: { entityId, versionId } },
  };
};

interface SourceStubV1 {
  readonly riskRecords?: RiskDashboardRiskRecordsSourceResultV1;
  readonly assessments?: RiskDashboardAssessmentsSourceResultV1;
  readonly warnings?: RiskDashboardWarningsSourceResultV1;
  readonly reviews?: RiskDashboardReviewsSourceResultV1;
  readonly documents?: RiskDashboardDocumentsSourceResultV1;
  readonly monitoring?: RiskDashboardMonitoringSourceResultV1;
  /** 记录每次调用，用于断言来源独立读取。 */
  readonly calls?: string[];
}

const sourcesFor = (stub: SourceStubV1): RiskDashboardSourcesV1 => {
  const calls = stub.calls ?? [];
  return {
    riskRecords: {
      readDashboard: async () => {
        calls.push("riskRecords");
        return (
          stub.riskRecords ?? {
            kind: "failed",
            error: deniedError("risk-identification.read"),
          }
        );
      },
    },
    assessments: {
      readDashboard: async () => {
        calls.push("assessments");
        return (
          stub.assessments ?? {
            kind: "failed",
            error: deniedError("risk-assessment.read"),
          }
        );
      },
    },
    warnings: {
      readDashboard: async () => {
        calls.push("warnings");
        return (
          stub.warnings ?? {
            kind: "failed",
            error: deniedError("warning-response.read"),
          }
        );
      },
    },
    reviews: {
      readDashboard: async () => {
        calls.push("reviews");
        return (
          stub.reviews ?? {
            kind: "failed",
            error: deniedError("review-audit.read"),
          }
        );
      },
    },
    documents: {
      readSourceDashboard: async () => {
        calls.push("documents");
        return (
          stub.documents ?? {
            kind: "failed",
            error: deniedError("engineering-data.read"),
          }
        );
      },
    },
    monitoring: {
      readMonitoringDashboard: async () => {
        calls.push("monitoring");
        return (
          stub.monitoring ?? {
            kind: "failed",
            error: deniedError("engineering-data.read"),
          }
        );
      },
    },
  };
};

/** 授权决策：只授予请求里列出的能力位；未列出的来源按拒权收口。 */
const authorizerFor = (
  projectId: string,
  capabilities: readonly string[],
): ((input: {
  readonly capability: string;
  readonly branch: string;
}) => Promise<{ readonly context: AuthorizationContextV1 }>) => {
  return async (input) => {
    if (!capabilities.includes(input.capability)) {
      // 无权按 C06 的授权失败形状抛出；技术故障是另一种异常，不得混成拒权。
      throw new AccessServiceError({
        code: "AUTHORIZATION_DENIED",
        stage: "authorize",
        occurredAt: TIMESTAMP,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "diagnostic-dashboard", versionId: "1" },
        },
        contextRefs: [],
        retryable: false,
        requiredCapability: "projection.query",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
      });
    }
    return { context: authorizationFor(projectId, "actor-1", capabilities) };
  };
};

const ALL_CAPABILITIES = [
  "projection.query",
  "risk-identification.read",
  "risk-assessment.read",
  "warning-response.read",
  "review-audit.read",
  "engineering-data.read",
] as const;

const serviceFor = (stub: SourceStubV1, capabilities: readonly string[] = ALL_CAPABILITIES) =>
  createRiskDashboardReadService({
    sources: sourcesFor(stub),
    authorizeBusinessAction: authorizerFor("project-1", capabilities) as never,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });

describe("risk dashboard aggregation service (CH-3)", () => {
  it("六来源各自返回成功摘要，组合层不重新计数也不相加", async () => {
    const service = serviceFor({
      riskRecords: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          recordedVersionCount: 3,
          processCounts: [{ processNodeId: "node-a", count: 2 }],
        },
        events: [],
      },
      assessments: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          recordedAssessmentCount: 2,
          matrixLevelCounts: [
            {
              riskMatrixRef: { entityId: "matrix-1", versionId: "1" },
              riskLevelId: "high",
              count: 2,
            },
          ],
        },
        events: [],
      },
      warnings: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          openTaskCount: 1,
          openTaskWarningCount: 4,
          warningLevelCounts: [{ warningLevel: "high", count: 9 }],
          unacknowledgedWarningCount: 5,
          unacknowledgedLevelCounts: [{ warningLevel: "high", count: 5 }],
        },
        events: [],
      },
      reviews: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          pendingCount: 2,
          reviewTypeCounts: [{ reviewType: "knowledge-revision", count: 2 }],
        },
      },
      documents: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          sourceVersionCount: 7,
          parseStatusCounts: [{ parseStatus: "parsed", count: 7 }],
          cleaningStatusCounts: [{ status: { kind: "not-registered" }, count: 7 }],
        },
      },
      monitoring: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: { seriesCount: 3, seriesWithBatchCount: 2, seriesWithSnapshotCount: 1 },
      },
    });

    const result = await service.read(queryFor("project-1"));
    if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
    expect(result.result.summaries.riskRecords).toMatchObject({
      kind: "ready",
      asOf: TIMESTAMP,
      scope: { kind: "authorized-spaces" },
    });
    if (result.result.summaries.riskRecords.kind !== "ready") {
      throw new TypeError("risk records summary missing");
    }
    expect(result.result.summaries.riskRecords.data.recordedVersionCount).toBe(3);
    // 复核是工程级口径，不受总览空间筛选影响。
    if (result.result.summaries.reviews.kind !== "ready") {
      throw new TypeError("reviews summary missing");
    }
    expect(result.result.summaries.reviews.scope).toEqual({ kind: "project" });
    // 不同口径的计数不合并成单一总量。
    if (result.result.summaries.warnings.kind !== "ready") {
      throw new TypeError("warnings summary missing");
    }
    expect(result.result.summaries.warnings.data.openTaskCount).toBe(1);
    expect(result.result.summaries.warnings.data.openTaskWarningCount).toBe(4);
    expect(result.result.summaries.warnings.data.unacknowledgedWarningCount).toBe(5);
  });

  it("单来源失败不伪造零值，也不影响其它来源的成功结果", async () => {
    const service = serviceFor({
      assessments: {
        kind: "failed",
        error: {
          code: "BUSINESS_BLOCKED",
          category: "business-blocked",
          retryable: false,
          blockerKind: "dashboard-group-limit",
          blockerRef: { kind: "query-result", reference: { entityId: "q", versionId: "1" } },
          stageCode: "risk-assessment.read.dashboard",
          occurredAt: TIMESTAMP,
          causalRunId: "q",
        } as unknown as ModuleErrorV1,
      },
      warnings: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          openTaskCount: 0,
          openTaskWarningCount: 0,
          warningLevelCounts: [],
          unacknowledgedWarningCount: 0,
          unacknowledgedLevelCounts: [],
        },
        events: [],
      },
    });

    const result = await service.read(queryFor("project-1"));
    if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
    expect(result.result.summaries.assessments.kind).toBe("failed");
    if (result.result.summaries.assessments.kind !== "failed") {
      throw new TypeError("assessments summary missing");
    }
    expect(result.result.summaries.assessments.error.code).toBe("BUSINESS_BLOCKED");
    // 其它来源保留自己的成功结果，零值来自真实空集合而不是失败折算。
    if (result.result.summaries.warnings.kind !== "ready") {
      throw new TypeError("warnings summary missing");
    }
    expect(result.result.summaries.warnings.data.openTaskCount).toBe(0);
    expect(result.result.summaries.riskRecords.kind).toBe("failed");
  });

  it("入口能力不含来源能力时，来源各自拒权而不是整页失败", async () => {
    const service = serviceFor({}, ["engineering-data.read"]);
    const result = await service.read(queryFor("project-1"));
    if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
    expect(result.result.summaries.riskRecords.kind).toBe("failed");
    if (result.result.summaries.riskRecords.kind !== "failed") {
      throw new TypeError("risk records summary missing");
    }
    expect(result.result.summaries.riskRecords.error.code).toBe("AUTHORIZATION_DENIED");
    // 拒权来源不参与合并，也不阻断续页。
    expect(result.result.timeline.nextCursor).toBeUndefined();
    expect(result.result.timeline.retryCursor).toBeUndefined();
  });

  it("授权判定的技术故障不折算成拒权，按可重试失败收口", async () => {
    const service = createRiskDashboardReadService({
      sources: sourcesFor({}),
      authorizeBusinessAction: (() => {
        throw new Error("access backend unavailable");
      }) as never,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const result = await service.read(queryFor("project-1"));
    if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
    if (result.result.summaries.riskRecords.kind !== "failed") {
      throw new TypeError("risk records summary missing");
    }
    expect(result.result.summaries.riskRecords.error.code).toBe("TRANSIENT_FAILURE");
    expect(result.result.summaries.riskRecords.error.retryable).toBe(true);
  });

  it("变化页按登记时刻降序合并三来源事件，续页位置完整", async () => {
    const service = serviceFor({
      riskRecords: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: { recordedVersionCount: 1, processCounts: [] },
        events: [event("riskRecords", "record-1", "1", "2030-01-01T00:00:00.000000Z")],
      },
      assessments: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: { recordedAssessmentCount: 1, matrixLevelCounts: [] },
        events: [event("assessments", "assessment-1", "1", "2030-01-01T00:00:00.500000Z")],
      },
      warnings: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          openTaskCount: 0,
          openTaskWarningCount: 0,
          warningLevelCounts: [],
          unacknowledgedWarningCount: 0,
          unacknowledgedLevelCounts: [],
        },
        events: [event("warnings", "warning-1", "1", "2030-01-01T00:00:00.250000Z")],
      },
    });

    const result = await service.read(queryFor("project-1", { timelinePageSize: 2 }));
    if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
    expect(result.result.timeline.items.map((item) => item.subjectRef.reference.entityId)).toEqual([
      "assessment-1",
      "warning-1",
    ]);
    expect(result.result.timeline.nextCursor).toBeDefined();
    expect(result.result.timeline.retryCursor).toBeUndefined();
  });

  it("参与来源故障时不推进成功来源，只给出原位重试游标", async () => {
    const service = serviceFor({
      riskRecords: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: { recordedVersionCount: 1, processCounts: [] },
        events: [event("riskRecords", "record-1", "1", "2030-01-01T00:00:00.000000Z")],
      },
      assessments: {
        kind: "failed",
        error: {
          code: "BUSINESS_BLOCKED",
          category: "business-blocked",
          retryable: false,
          blockerKind: "dashboard-group-limit",
          blockerRef: { kind: "query-result", reference: { entityId: "q", versionId: "1" } },
          stageCode: "risk-assessment.read.dashboard",
          occurredAt: TIMESTAMP,
          causalRunId: "q",
        } as unknown as ModuleErrorV1,
      },
      warnings: {
        kind: "ready",
        asOf: TIMESTAMP,
        data: {
          openTaskCount: 0,
          openTaskWarningCount: 0,
          warningLevelCounts: [],
          unacknowledgedWarningCount: 0,
          unacknowledgedLevelCounts: [],
        },
        events: [],
      },
    });

    const result = await service.read(queryFor("project-1"));
    if (result.kind !== "succeeded") throw new TypeError("dashboard read failed");
    expect(result.result.timeline.nextCursor).toBeUndefined();
    expect(result.result.timeline.retryCursor).toBeDefined();
    expect(result.result.timeline.sources.assessments.kind).toBe("failed");
  });

  it("非法游标与错工程游标一律拒绝，不返回空页冒充成功", async () => {
    const service = serviceFor({});
    const invalid = await service.read(queryFor("project-1", { timelineCursor: "not-a-cursor" }));
    expect(invalid.kind).toBe("failed");
    if (invalid.kind !== "failed") throw new TypeError("invalid cursor accepted");
    expect(invalid.error.code).toBe("UNSUPPORTED_CONTRACT");

    const foreign = await service.read(queryFor("project-2", { timelineCursor: "eyJ2IjoxfQ" }));
    expect(foreign.kind).toBe("failed");
  });
});
