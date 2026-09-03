import { describe, expect, it } from "vitest";

import { MODULE_BRANCH_CAPABILITY_V1 } from "@riskflow/contracts/ports";
import {
  PRESET_ROLE_BRANCHES_V1,
  AccessErrorV1Schema,
  AuthorizationRequestV1Schema,
  LoginCommandV1Schema,
  PasswordV1Schema,
  PresetRoleV1Schema,
  RoleSetV1Schema,
  SpatialScopeRefSetV1Schema,
  assertSpatialScopeTree,
  allSpatialScopesCovered,
  branchCapability,
  isAuthorizationSubset,
  isBranchAllowed,
  isSpatialScopeCovered,
  intersectSourcePolicies,
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
    const policy = (visibility: "project-shared" | "restricted", allowedAccountIds: string[]) => ({
      projectId: "project-a",
      sourceVersionRef: {
        kind: "source-version" as const,
        reference: { entityId: "source", versionId: "1" },
      },
      revisionRef: {
        kind: "source-access-grant" as const,
        reference: { entityId: `grant-${visibility}`, versionId: "1" },
      },
      visibility,
      allowedAccountIds,
      spatialScopeRefs: [scope("root", "1")],
    });
    const intersection = intersectSourcePolicies([
      policy("project-shared", []),
      policy("restricted", ["account-a", "account-b"]),
    ]);
    expect(intersection?.visibility).toBe("restricted");
    expect(intersection?.allowedAccountIds).toEqual(["account-a", "account-b"]);
    expect(
      projectionAccess([
        { allowed: true, bodyAllowed: false, redacted: true, grantRefs: [], requiredScopeRefs: [] },
      ]),
    ).toEqual({ allowed: true, redacted: true, sourceAccessGrantRefs: [] });
    const restrictedIntersection = intersectSourcePolicies([
      policy("restricted", ["account-a", "account-b"]),
      {
        ...policy("restricted", ["account-a"]),
        revisionRef: {
          kind: "source-access-grant" as const,
          reference: { entityId: "grant-second", versionId: "1" },
        },
      },
    ]);
    expect(restrictedIntersection?.allowedAccountIds).toEqual(["account-a"]);
  });

  it("strict DTOs and bounded input", () => {
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
