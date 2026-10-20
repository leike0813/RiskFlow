import { describe, expect, it } from "vitest";

import {
  AccessCommandResultV1Schema,
  EngineeringWorkspaceCommandPayloadV1Schema,
  EngineeringWorkspaceCommandRequestV1Schema,
  EngineeringWorkspaceReadPayloadV1Schema,
  EngineeringWorkspaceReadRequestV1Schema,
  EngineeringWorkspaceReadSuccessV1Schema,
  ProjectWorkspaceAccessCommandPayloadV1Schema,
  ProjectWorkspaceAccessCommandRequestV1Schema,
  ProjectWorkspaceAccessReadPayloadV1Schema,
  ProjectWorkspaceAccessReadSuccessV1Schema,
  RoleSetV1Schema,
} from "../src/engineering-workspace/index.js";
import { PresetRoleV1Schema, SourceVisibilityV1Schema } from "../src/vocabulary/index.js";

const projectRevisionRef = {
  kind: "project-revision" as const,
  reference: { entityId: "project-1", versionId: "2" },
};
const spatialScopeRef = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-1", versionId: "1" },
};
const sourceVersionRef = {
  kind: "source-version" as const,
  reference: { entityId: "source-1", versionId: "1" },
};
const monitoringSeriesRef = {
  kind: "monitoring-series" as const,
  reference: { entityId: "series-1", versionId: "1" },
};
const applicabilityMetadata = {
  constructionMethod: "method-1",
  stratumCondition: "stratum-1",
  engineeringStage: "stage-1",
};

describe("工程工作区修订载荷", () => {
  it("接受工程与空间两种业务载荷", () => {
    expect(
      EngineeringWorkspaceCommandPayloadV1Schema.safeParse({
        kind: "project",
        expectedVersion: { entityId: "project-1", versionId: "2" },
        name: "一号工程",
        lifecycle: "preparing",
        applicabilityMetadata,
        effectivePeriod: { validFrom: "2026-10-01T00:00:00.000Z" },
      }).success,
    ).toBe(true);
    expect(
      EngineeringWorkspaceCommandPayloadV1Schema.safeParse({
        kind: "spatial",
        spatialScopeRef,
        projectRevisionRef,
        expectedVersion: "none",
        parentScopeRef: spatialScopeRef,
        name: "一号区段",
        worksiteLocation: "合成站",
        applicabilityOverrides: {},
        status: "active",
        effectivePeriod: { validFrom: "2026-10-01T00:00:00.000Z" },
      }).success,
    ).toBe(true);
  });

  it("拒绝命令信封字段混入业务载荷", () => {
    for (const extra of [
      { commandId: "command-1" },
      { idempotencyKey: "idem-1" },
      { actorId: "actor-1" },
      { authorization: { actorId: "actor-1" } },
      { projectId: "project-1" },
      { issuedAt: "2026-10-01T00:00:00.000Z" },
    ]) {
      expect(
        EngineeringWorkspaceCommandPayloadV1Schema.safeParse({
          kind: "project",
          expectedVersion: "none",
          name: "一号工程",
          lifecycle: "preparing",
          applicabilityMetadata,
          effectivePeriod: { validFrom: "2026-10-01T00:00:00.000Z" },
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("信封只接受身份与幂等字段", () => {
    expect(
      EngineeringWorkspaceCommandRequestV1Schema.safeParse({
        commandId: "command-1",
        idempotencyKey: "idem-1",
        issuedAt: "2026-10-01T00:00:00.000Z",
        payload: {
          kind: "project",
          expectedVersion: "none",
          name: "一号工程",
          lifecycle: "preparing",
          applicabilityMetadata,
          effectivePeriod: { validFrom: "2026-10-01T00:00:00.000Z" },
        },
      }).success,
    ).toBe(true);
    expect(
      EngineeringWorkspaceCommandRequestV1Schema.safeParse({
        commandId: "command-1",
        idempotencyKey: "idem-1",
        issuedAt: "2026-10-01T00:00:00.000Z",
        payload: { kind: "unknown" },
      }).success,
    ).toBe(false);
  });
});

describe("工程工作区读取载荷", () => {
  it("接受六种严格读取形态", () => {
    const payloads = [
      { kind: "context" },
      { kind: "context", projectRevisionRef },
      { kind: "context", scopeId: "scope-1" },
      { kind: "ingestion", subject: sourceVersionRef },
      { kind: "ingestion", subject: monitoringSeriesRef, pageSize: 25 },
      { kind: "resolve-monitoring", seriesId: "series-1" },
      { kind: "monitoring-snapshots", monitoringSeriesRef },
      {
        kind: "cleaning-exclusions",
        resultRef: { kind: "route-decision", reference: { entityId: "r1", versionId: "1" } },
        subject: sourceVersionRef,
      },
      {
        kind: "conversion-failure",
        conversionRef: {
          kind: "structured-document-conversion",
          reference: { entityId: "c1", versionId: "1" },
        },
      },
    ] as const;
    for (const payload of payloads) {
      expect(EngineeringWorkspaceReadPayloadV1Schema.safeParse(payload).success).toBe(true);
    }
  });

  it("空间身份与精确空间修订互斥", () => {
    expect(
      EngineeringWorkspaceReadPayloadV1Schema.safeParse({
        kind: "context",
        scopeId: "scope-1",
        spatialScopeRef,
      }).success,
    ).toBe(false);
  });

  it("页大小有界且不开放游标以外的自由字段", () => {
    expect(
      EngineeringWorkspaceReadPayloadV1Schema.safeParse({
        kind: "ingestion",
        subject: sourceVersionRef,
        pageSize: 51,
      }).success,
    ).toBe(false);
    expect(
      EngineeringWorkspaceReadPayloadV1Schema.safeParse({
        kind: "ingestion",
        subject: sourceVersionRef,
        pageSize: 50,
        cursor: "cursor-1",
      }).success,
    ).toBe(true);
    expect(
      EngineeringWorkspaceReadPayloadV1Schema.safeParse({
        kind: "ingestion",
        subject: sourceVersionRef,
        actorId: "actor-1",
      }).success,
    ).toBe(false);
  });

  it("读请求信封不接受授权字段", () => {
    expect(
      EngineeringWorkspaceReadRequestV1Schema.safeParse({
        queryId: "query-1",
        requestedAt: "2026-10-01T00:00:00.000Z",
        payload: { kind: "context" },
      }).success,
    ).toBe(true);
    expect(
      EngineeringWorkspaceReadRequestV1Schema.safeParse({
        queryId: "query-1",
        requestedAt: "2026-10-01T00:00:00.000Z",
        payload: { kind: "context" },
        sessionToken: "token",
      }).success,
    ).toBe(false);
  });
});

describe("工程工作区成功投影", () => {
  it("上下文投影允许尚无业务修订", () => {
    expect(
      EngineeringWorkspaceReadSuccessV1Schema.safeParse({
        kind: "context",
        projectId: "project-1",
        project: null,
        spatial: null,
      }).success,
    ).toBe(true);
  });

  it("接入投影每页至多五十项", () => {
    const item = {
      stage: "conversion" as const,
      recordRef: {
        kind: "structured-document-conversion" as const,
        reference: { entityId: "c1", versionId: "1" },
      },
      recordedAt: "2026-10-01T00:00:00.000Z",
      conversionRef: {
        kind: "structured-document-conversion" as const,
        reference: { entityId: "c1", versionId: "1" },
      },
      status: "succeeded" as const,
      statistics: {
        inputBytes: 100,
        outputBytes: 200,
        textBlockCount: 1,
        sourceSegmentCount: 1,
        pageCount: 1,
        tableCount: 0,
        cellCount: 0,
        durationMs: 10,
      },
      completedAt: "2026-10-01T00:00:00.000Z",
    };
    const projection = (count: number) => ({
      kind: "ingestion" as const,
      projectId: "project-1",
      subject: sourceVersionRef,
      items: Array.from({ length: count }, () => item),
    });
    expect(EngineeringWorkspaceReadSuccessV1Schema.safeParse(projection(50)).success).toBe(true);
    expect(EngineeringWorkspaceReadSuccessV1Schema.safeParse(projection(51)).success).toBe(false);
  });
});

describe("工程访问维护载荷", () => {
  it("读取联合只接受四种目录形态", () => {
    const base = {
      queryId: "query-1",
      requestedAt: "2026-10-01T00:00:00.000Z",
      projectId: "project-1",
    };
    expect(
      ProjectWorkspaceAccessReadPayloadV1Schema.safeParse({ ...base, kind: "memberships" }).success,
    ).toBe(true);
    expect(
      ProjectWorkspaceAccessReadPayloadV1Schema.safeParse({ ...base, kind: "spatial-scopes" })
        .success,
    ).toBe(true);
    expect(
      ProjectWorkspaceAccessReadPayloadV1Schema.safeParse({ ...base, kind: "member-options" })
        .success,
    ).toBe(true);
    expect(
      ProjectWorkspaceAccessReadPayloadV1Schema.safeParse({
        ...base,
        kind: "source-access",
        sourceVersionRef,
      }).success,
    ).toBe(true);
    expect(
      ProjectWorkspaceAccessReadPayloadV1Schema.safeParse({
        ...base,
        kind: "source-access",
        sourceVersionRef,
        cursor: "cursor-1",
      }).success,
    ).toBe(false);
    expect(
      ProjectWorkspaceAccessReadPayloadV1Schema.safeParse({ ...base, kind: "accounts" }).success,
    ).toBe(false);
  });

  it("写联合只接受四类原管理命令并剥离所有者字段", () => {
    expect(
      ProjectWorkspaceAccessCommandPayloadV1Schema.safeParse({
        kind: "revise-membership",
        expectedVersion: { entityId: "membership-1", versionId: "1" },
        membershipId: "membership-1",
        accountId: "account-1",
        roles: ["reviewer"],
        spatialScopeRefs: [spatialScopeRef],
        status: "active",
      }).success,
    ).toBe(true);
    expect(
      ProjectWorkspaceAccessCommandPayloadV1Schema.safeParse({
        kind: "create-spatial-scope",
        expectedVersion: "none",
        scopeId: "scope-2",
        parentScopeRef: spatialScopeRef,
      }).success,
    ).toBe(true);
    expect(
      ProjectWorkspaceAccessCommandPayloadV1Schema.safeParse({
        kind: "create-spatial-scope",
        expectedVersion: { entityId: "scope-1", versionId: "1" },
        scopeId: "scope-2",
        parentScopeRef: spatialScopeRef,
      }).success,
    ).toBe(false);
    expect(
      ProjectWorkspaceAccessCommandPayloadV1Schema.safeParse({
        kind: "revise-source-access",
        expectedVersion: { entityId: "grant-1", versionId: "1" },
        sourceVersionRef,
        visibility: "project-shared",
        allowedAccountIds: ["account-1"],
        spatialScopeRefs: [spatialScopeRef],
        registeredByAccountId: "account-1",
      }).success,
    ).toBe(false);
    expect(
      ProjectWorkspaceAccessCommandRequestV1Schema.safeParse({
        commandId: "command-1",
        idempotencyKey: "idem-1",
        issuedAt: "2026-10-01T00:00:00.000Z",
        payload: {
          kind: "revise-spatial-scope",
          expectedVersion: { entityId: "scope-1", versionId: "1" },
          scopeId: "scope-1",
          status: "inactive",
        },
      }).success,
    ).toBe(true);
  });

  it("目录投影不披露全局账号目录", () => {
    const projection = ProjectWorkspaceAccessReadSuccessV1Schema.safeParse({
      kind: "member-options",
      items: [
        {
          accountRef: { entityId: "account-1", versionId: "1" },
          displayName: "一号账号",
        },
      ],
    });
    expect(projection.success).toBe(true);
    expect(
      ProjectWorkspaceAccessReadSuccessV1Schema.safeParse({
        kind: "member-options",
        items: [
          {
            accountRef: { entityId: "account-1", versionId: "1" },
            displayName: "一号账号",
            loginName: "account-one",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("访问域词汇单一来源", () => {
  it("预设角色与资料可见范围只在此定义", () => {
    expect(PresetRoleV1Schema.options).toEqual([
      "system-administrator",
      "project-risk-manager",
      "reviewer",
      "field-responder",
      "business-viewer",
    ]);
    expect(SourceVisibilityV1Schema.options).toEqual(["project-shared", "restricted"]);
    expect(RoleSetV1Schema.safeParse(["reviewer", "reviewer"]).success).toBe(false);
    expect(RoleSetV1Schema.safeParse(["reviewer"]).success).toBe(true);
  });

  it("管理回执形状保持稳定", () => {
    expect(
      AccessCommandResultV1Schema.safeParse({
        kind: "membership",
        resultRef: { entityId: "membership-1", versionId: "1" },
        references: [{ entityId: "membership-1", versionId: "1" }],
      }).success,
    ).toBe(true);
  });
});
