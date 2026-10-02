import { describe, expect, it } from "vitest";

import { MODULE_BRANCH_CAPABILITY_V1 } from "@riskflow/contracts/ports";
import {
  PRESET_ROLE_BRANCHES_V1,
  AccessErrorV1Schema,
  AuthorizationRequestV1Schema,
  DisplayNameV1Schema,
  LoginCommandV1Schema,
  PasswordV1Schema,
  PresetRoleV1Schema,
  RoleSetV1Schema,
  SpatialScopeRefSetV1Schema,
  assertSpatialScopeTree,
  allSpatialScopesCovered,
  branchCapability,
  capabilitiesForBranches,
  evaluateSourceAccess,
  isAuthorizationSubset,
  isBranchAllowed,
  isSpatialScopeCovered,
  projectionAccess,
  type SpatialScopeNodeV1,
} from "../src/access/index.js";

const scope = (scopeId: string, revisionId: string, parentScopeId?: string) => ({
  kind: "spatial-scope" as const,
  reference: { entityId: scopeId, versionId: revisionId },
  ...(parentScopeId === undefined ? {} : { parentScopeId }),
});

describe("access domain", () => {
  it("preset role policy", () => {
    const allBranches = Object.keys(MODULE_BRANCH_CAPABILITY_V1) as Array<
      keyof typeof MODULE_BRANCH_CAPABILITY_V1
    >;
    expect(PresetRoleV1Schema.safeParse("unapproved-role").success).toBe(false);
    expect(PRESET_ROLE_BRANCHES_V1["system-administrator"]).toEqual([]);
    expect(PRESET_ROLE_BRANCHES_V1["project-risk-manager"]).toHaveLength(allBranches.length);
    expect(isBranchAllowed(["reviewer"], "review-audit.decide-review")).toBe(true);
    expect(isBranchAllowed(["reviewer"], "warning-response.record-execution")).toBe(false);
    expect(isBranchAllowed(["business-viewer"], "projection.export")).toBe(true);
    expect(isBranchAllowed(["business-viewer"], "projection.query")).toBe(true);
    expect(branchCapability("projection.query")).toBe("projection.query");
    expect(branchCapability("agent-task.read-failure-evidence")).toBe("agent-task.read");
    expect(capabilitiesForBranches(["agent-task.read-failure-evidence"])).toEqual([
      "agent-task.read",
    ]);
    expect(PRESET_ROLE_BRANCHES_V1["project-risk-manager"]).toContain(
      "agent-task.read-failure-evidence",
    );
    for (const role of ["reviewer", "field-responder", "business-viewer"] as const) {
      expect(isBranchAllowed([role], "agent-task.read-failure-evidence")).toBe(false);
    }
    // C32 只读 branch 授予：reviewer 全量七条；field-responder 仅监测相关。
    const c32Branches = [
      "engineering-data.context-read",
      "engineering-data.source-catalog",
      "engineering-data.monitoring-catalog",
      "engineering-data.read-result",
      "knowledge-modeling.governance-read",
      "knowledge-modeling.retrieval-result",
      "projection.result-read",
    ] as const;
    for (const branch of c32Branches) {
      expect(isBranchAllowed(["reviewer"], branch)).toBe(true);
      expect(isBranchAllowed(["project-risk-manager"], branch)).toBe(true);
      expect(isBranchAllowed(["system-administrator"], branch)).toBe(false);
    }
    for (const branch of [
      "engineering-data.context-read",
      "engineering-data.monitoring-catalog",
      "engineering-data.read-result",
    ] as const) {
      expect(isBranchAllowed(["field-responder"], branch)).toBe(true);
    }
    // C34 起 field-responder 另获 `projection.result-read` 与
    // `knowledge-modeling.governance-read`（design D-06），此处只断言仍未授予的分支。
    for (const branch of [
      "engineering-data.source-catalog",
      "knowledge-modeling.retrieval-result",
    ] as const) {
      expect(isBranchAllowed(["field-responder"], branch)).toBe(false);
    }
    expect(isBranchAllowed(["business-viewer"], "knowledge-modeling.governance-read")).toBe(true);
    expect(isBranchAllowed(["business-viewer"], "projection.result-read")).toBe(true);
  });

  it("C33 识别与复核队列只读 branch 授予恰为 D5 清单", () => {
    const identificationReadBranches = [
      "risk-identification.run-list",
      "risk-identification.run-read",
      "risk-identification.record-catalog",
      "risk-identification.record-read",
    ] as const;
    const c33Branches = [...identificationReadBranches, "review-audit.queue-read"] as const;
    const c33Grantable = [...c33Branches, "knowledge-modeling.retrieval-result"] as const;
    const grantedC33 = (role: keyof typeof PRESET_ROLE_BRANCHES_V1) =>
      PRESET_ROLE_BRANCHES_V1[role]
        .filter((branch) => (c33Grantable as readonly string[]).includes(branch))
        .sort();

    expect(grantedC33("reviewer")).toEqual([...c33Grantable].sort());
    expect(grantedC33("field-responder")).toEqual([...identificationReadBranches].sort());
    expect(grantedC33("business-viewer")).toEqual(
      [...c33Branches, "knowledge-modeling.retrieval-result"].sort(),
    );
    expect(grantedC33("system-administrator")).toEqual([]);
    expect(grantedC33("project-risk-manager")).toEqual([...c33Grantable].sort());

    for (const branch of c33Branches) {
      expect(isBranchAllowed(["reviewer"], branch)).toBe(true);
      expect(isBranchAllowed(["project-risk-manager"], branch)).toBe(true);
      expect(isBranchAllowed(["system-administrator"], branch)).toBe(false);
    }
    expect(isBranchAllowed(["field-responder"], "review-audit.queue-read")).toBe(false);
    expect(isBranchAllowed(["business-viewer"], "knowledge-modeling.retrieval-result")).toBe(true);
    expect(isBranchAllowed(["field-responder"], "knowledge-modeling.retrieval-result")).toBe(false);
  });

  it("C34 评估与处置只读 branch 及校准治理写权按 D6 固定角色授予", () => {
    const c34ReadBranches = ["risk-assessment.read", "warning-response.read"] as const;
    const c34GovernanceBranches = [
      "warning-response.calibration-review-outcome",
      "warning-response.calibration-governance-draft",
    ] as const;
    const grantedRead = (role: keyof typeof PRESET_ROLE_BRANCHES_V1) =>
      PRESET_ROLE_BRANCHES_V1[role]
        .filter((branch) => (c34ReadBranches as readonly string[]).includes(branch))
        .sort();

    // 两个新 read branch 授予 reviewer、field-responder、business-viewer。
    for (const role of ["reviewer", "field-responder", "business-viewer"] as const) {
      expect(grantedRead(role)).toEqual([...c34ReadBranches].sort());
    }
    expect(grantedRead("system-administrator")).toEqual([]);
    expect(grantedRead("project-risk-manager")).toEqual([...c34ReadBranches].sort());

    // 校准两个治理写 branch 仅经理：预设角色集合里不得出现。
    for (const role of ["reviewer", "field-responder", "business-viewer", "system-administrator"] as const) {
      for (const branch of c34GovernanceBranches) {
        expect(isBranchAllowed([role], branch)).toBe(false);
      }
    }
    for (const branch of c34GovernanceBranches) {
      expect(isBranchAllowed(["project-risk-manager"], branch)).toBe(true);
    }

    // field-responder 补投影结果与措施治理读取面。
    expect(isBranchAllowed(["field-responder"], "projection.result-read")).toBe(true);
    expect(isBranchAllowed(["field-responder"], "knowledge-modeling.governance-read")).toBe(
      true,
    );

    // 不授予 field-responder 经理的启动/采纳/确认写权。
    for (const branch of [
      "risk-assessment.initial",
      "risk-assessment.reassessment",
      "warning-response.acknowledge",
      "warning-response.adopt-recommendation",
    ] as const) {
      expect(isBranchAllowed(["field-responder"], branch)).toBe(false);
    }
  });

  it("authorization scope closure", () => {
    const nodes: SpatialScopeNodeV1[] = [
      { projectId: "project-a", scopeId: "root", revisionId: "1", status: "active" },
      {
        projectId: "project-a",
        scopeId: "child",
        revisionId: "1",
        parentScopeId: "root",
        status: "active",
      },
      {
        projectId: "project-a",
        scopeId: "sibling",
        revisionId: "1",
        parentScopeId: "root",
        status: "active",
      },
    ];
    expect(() => assertSpatialScopeTree(nodes, "project-a")).not.toThrow();
    expect(isSpatialScopeCovered(scope("root", "1"), scope("child", "1"), nodes)).toBe(true);
    expect(isSpatialScopeCovered(scope("child", "1"), scope("root", "1"), nodes)).toBe(false);
    expect(isSpatialScopeCovered(scope("child", "1"), scope("sibling", "1"), nodes)).toBe(false);
    expect(allSpatialScopesCovered([scope("root", "1")], [scope("child", "1")], nodes)).toBe(true);
    expect(
      isSpatialScopeCovered(scope("root", "1"), scope("inactive", "1"), [
        ...nodes,
        { projectId: "project-a", scopeId: "inactive", revisionId: "1", status: "inactive" },
      ]),
    ).toBe(false);
    expect(() =>
      assertSpatialScopeTree([
        {
          projectId: "project-a",
          scopeId: "root",
          revisionId: "1",
          parentScopeId: "child",
          status: "active",
        },
        {
          projectId: "project-a",
          scopeId: "child",
          revisionId: "1",
          parentScopeId: "root",
          status: "active",
        },
      ]),
    ).toThrow();
    expect(() =>
      assertSpatialScopeTree(
        [
          { projectId: "project-a", scopeId: "root", revisionId: "1", status: "active" },
          { projectId: "project-b", scopeId: "other", revisionId: "1", status: "active" },
        ],
        "project-a",
      ),
    ).toThrow();
  });

  it("authorization source intersection and redacted projection", () => {
    const policy = (
      sourceId: string,
      visibility: "project-shared" | "restricted",
      allowedAccountIds: string[],
    ) => ({
      projectId: "project-a",
      sourceVersionRef: {
        kind: "source-version" as const,
        reference: { entityId: sourceId, versionId: "1" },
      },
      revisionRef: {
        kind: "source-access-grant" as const,
        reference: { entityId: `grant-${sourceId}`, versionId: "1" },
      },
      visibility,
      allowedAccountIds,
      spatialScopeRefs: [scope("root", "1")],
    });
    const scopeNodes: SpatialScopeNodeV1[] = [
      { projectId: "project-a", scopeId: "root", revisionId: "1", status: "active" },
    ];
    const evaluate = (sourcePolicy: ReturnType<typeof policy>) =>
      evaluateSourceAccess({
        accountId: "account-a",
        projectId: "project-a",
        roles: ["business-viewer"],
        branch: "projection.query",
        membershipActive: true,
        grantedScopeRefs: [scope("root", "1")],
        policy: sourcePolicy,
        scopeNodes,
        requireBody: false,
      });
    const projection = projectionAccess([
      evaluate(policy("source-shared", "project-shared", [])),
      evaluate(policy("source-restricted", "restricted", ["account-b"])),
    ]);
    expect(projection.allowed).toBe(true);
    expect(projection.redacted).toBe(true);
    expect(projection.sourceAccessGrantRefs).toHaveLength(0);
  });

  it("strict DTOs and bounded input", () => {
    expect(DisplayNameV1Schema.safeParse("😀".repeat(100)).success).toBe(true);
    expect(DisplayNameV1Schema.safeParse("😀".repeat(101)).success).toBe(false);
    expect(
      LoginCommandV1Schema.safeParse({
        kind: "login",
        loginAttemptId: "attempt-1",
        loginName: "user001",
        password: "password-password",
        extra: true,
      }).success,
    ).toBe(false);
    expect(PasswordV1Schema.safeParse("short").success).toBe(false);
    expect(PasswordV1Schema.safeParse("密码".repeat(8)).success).toBe(true);
    expect(PasswordV1Schema.safeParse("p".repeat(15)).success).toBe(true);
    expect(PasswordV1Schema.safeParse("p".repeat(513)).success).toBe(false);
    expect(
      RoleSetV1Schema.safeParse([
        "system-administrator",
        "project-risk-manager",
        "reviewer",
        "field-responder",
        "business-viewer",
      ]).success,
    ).toBe(false);
    expect(
      SpatialScopeRefSetV1Schema.safeParse(
        Array.from({ length: 129 }, (_, index) => ({
          kind: "spatial-scope" as const,
          reference: { entityId: `scope-${index}`, versionId: "1" },
        })),
      ).success,
    ).toBe(false);
    expect(
      AuthorizationRequestV1Schema.safeParse({
        invocation: { kind: "human-session", sessionToken: "opaque-token" },
        invocationId: "query-1",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        grantedCapabilities: ["risk-assessment.evaluate"],
      }).success,
    ).toBe(false);
    expect(
      AccessErrorV1Schema.safeParse({
        code: "AUTHORIZATION_DENIED",
        retryable: false,
        stage: "authorize",
        occurredAt: "2030-01-01T00:00:00.000Z",
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "diagnostic", versionId: "1" },
        },
        contextRefs: [],
        requiredCapability: "projection.query",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
        leakedTarget: "secret",
      }).success,
    ).toBe(false);
  });

  it("child context cannot widen a parent", () => {
    const base = {
      schemaVersion: "1" as const,
      authorizationContextRef: {
        kind: "authorization-context" as const,
        reference: { entityId: "ctx", versionId: "1" },
      },
      actorId: "account-a",
      projectId: "project-a",
      grantedCapabilities: ["projection.query" as const],
      spatialScopeRefs: [scope("root", "1")],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: "2030-01-01T00:00:00.000Z",
      invocation: { kind: "human" as const },
    };
    const child = {
      ...base,
      authorizationContextRef: {
        ...base.authorizationContextRef,
        reference: { entityId: "child", versionId: "1" },
      },
      spatialScopeRefs: [scope("child", "1")],
    };
    const nodes: SpatialScopeNodeV1[] = [
      { projectId: "project-a", scopeId: "root", revisionId: "1", status: "active" },
      {
        projectId: "project-a",
        scopeId: "child",
        revisionId: "1",
        parentScopeId: "root",
        status: "active",
      },
    ];
    expect(isAuthorizationSubset(base, child, { scopeNodes: nodes })).toBe(true);
    expect(isAuthorizationSubset(child, base, { scopeNodes: nodes })).toBe(false);
  });
});
