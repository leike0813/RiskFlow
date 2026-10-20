import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialSystemAdministrator } from "../../src/auth/index.js";
import { createPostgresEngineeringWorkspaceAdapter } from "../../src/engineering-data/workspace/postgres-engineering-workspace-adapter.js";
import {
  startEngineeringContextSourceFixture,
  type EngineeringContextSourcePostgresFixture,
} from "./context-source/fixture.js";

const now = "2030-01-01T00:00:00.000Z";
const projectId = "project-workspace-01";
const adminPassword = "workspace-admin-password";
const managerPassword = "workspace-manager-password";

describe("C11/C12 工程工作区窄读适配器", () => {
  let fixture: EngineeringContextSourcePostgresFixture;
  let managerSessionToken = "";
  let workspace: ReturnType<typeof createPostgresEngineeringWorkspaceAdapter>;

  beforeAll(async () => {
    fixture = await startEngineeringContextSourceFixture({ now: () => new Date(now) });
    const admin = await bootstrapInitialSystemAdministrator({
      connection: fixture.postgres.migrator,
      loginName: "workspace-admin",
      displayName: "Workspace Administrator",
      password: adminPassword,
      accountId: "workspace-admin-account",
      now: () => new Date(now),
    });
    if (admin.kind !== "account") throw new Error("workspace admin bootstrap failed");
    const adminLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "workspace-admin-login",
      loginName: "workspace-admin",
      password: adminPassword,
    });
    const adminChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: `${adminPassword}-changed`,
    });
    const manager = await fixture.access.administerIdentity({
      kind: "create-account",
      commandId: "workspace-create-manager",
      idempotencyKey: "workspace-create-manager",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      loginName: "workspace-manager",
      displayName: "Workspace Manager",
      password: managerPassword,
    });
    if (manager.kind !== "account") throw new Error("workspace manager creation failed");
    const managerLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "workspace-manager-login",
      loginName: "workspace-manager",
      password: managerPassword,
    });
    const managerChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: `${managerPassword}-changed`,
    });
    managerSessionToken = managerChanged.sessionToken;
    await fixture.access.administerProject({
      kind: "open-project",
      projectId,
      commandId: "workspace-open-project",
      idempotencyKey: "workspace-open-project",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      initialRiskManagerAccountId: manager.resultRef.entityId,
    });
    workspace = createPostgresEngineeringWorkspaceAdapter({
      access: fixture.access,
      contextSource: fixture.registry,
      conversions: {
        listBySourceVersion: async () => [],
        readRecordByRef: async () => undefined,
        readFailureSummary: async () => undefined,
      },
      cleaning: {
        listResultsForSource: async () => [],
        listResultsForMonitoringSnapshots: async () => [],
        readResultExclusions: async () => [],
      },
      monitoring: fixture.monitoringStore,
    });
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  const readContext = async (payload: Record<string, unknown>) => {
    const result = await workspace.read({
      queryId: `workspace-read-${Math.random().toString(36).slice(2)}`,
      requestedAt: now,
      sessionToken: managerSessionToken,
      projectId,
      payload: { kind: "context", ...payload } as never,
    });
    return result;
  };

  it("工程尚无业务修订时上下文读返回空投影而不是工程不存在", async () => {
    const result = await readContext({});
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.result.kind).toBe("context");
    if (result.result.kind !== "context") return;
    expect(result.result.project).toBeNull();
    expect(result.result.spatial).toBeNull();
  });

  it("修订后当前修订可读，历史修订按精确版本保留且不改写当前", async () => {
    const first = await workspace.revise({
      commandId: "workspace-revise-project-1",
      idempotencyKey: "workspace-revise-project-1",
      issuedAt: now,
      sessionToken: managerSessionToken,
      projectId,
      payload: {
        kind: "project",
        expectedVersion: "none",
        name: "一号工程",
        lifecycle: "preparing",
        applicabilityMetadata: {
          constructionMethod: "method-1",
          stratumCondition: "stratum-1",
          engineeringStage: "stage-1",
        },
        effectivePeriod: { validFrom: now },
      },
    });
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded" || first.result.kind !== "project-revision") return;
    const firstRevisionRef = first.result.revision.projectRevisionRef;

    const current = await readContext({});
    expect(current.kind).toBe("succeeded");
    if (current.kind !== "succeeded" || current.result.kind !== "context") return;
    expect(current.result.project?.projectRevisionRef).toEqual(firstRevisionRef);

    const second = await workspace.revise({
      commandId: "workspace-revise-project-2",
      idempotencyKey: "workspace-revise-project-2",
      issuedAt: now,
      sessionToken: managerSessionToken,
      projectId,
      payload: {
        kind: "project",
        expectedVersion: {
          entityId: firstRevisionRef.reference.entityId,
          versionId: firstRevisionRef.reference.versionId,
        },
        name: "一号工程（更新）",
        lifecycle: "active",
        applicabilityMetadata: {
          constructionMethod: "method-1",
          stratumCondition: "stratum-1",
          engineeringStage: "stage-1",
        },
        effectivePeriod: { validFrom: now },
      },
    });
    expect(second.kind).toBe("succeeded");
    if (second.kind !== "succeeded" || second.result.kind !== "project-revision") return;
    expect(second.result.revision.projectRevisionRef.reference.versionId).not.toBe(
      firstRevisionRef.reference.versionId,
    );

    const historical = await readContext({ projectRevisionRef: firstRevisionRef });
    expect(historical.kind).toBe("succeeded");
    if (historical.kind !== "succeeded" || historical.result.kind !== "context") return;
    expect(historical.result.project?.projectRevisionRef).toEqual(firstRevisionRef);
    expect(historical.result.project?.name).toBe("一号工程");

    const stillCurrent = await readContext({});
    expect(stillCurrent.kind).toBe("succeeded");
    if (stillCurrent.kind !== "succeeded" || stillCurrent.result.kind !== "context") return;
    expect(stillCurrent.result.project?.name).toBe("一号工程（更新）");
  });

  it("陈旧预期版本不追加新事实", async () => {
    const before = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_project_revisions WHERE project_id = $1",
      [projectId],
    );
    const stale = await workspace.revise({
      commandId: "workspace-revise-project-stale",
      idempotencyKey: "workspace-revise-project-stale",
      issuedAt: now,
      sessionToken: managerSessionToken,
      projectId,
      payload: {
        kind: "project",
        expectedVersion: { entityId: projectId, versionId: "1" },
        name: "陈旧提交",
        lifecycle: "active",
        applicabilityMetadata: {
          constructionMethod: "method-1",
          stratumCondition: "stratum-1",
          engineeringStage: "stage-1",
        },
        effectivePeriod: { validFrom: now },
      },
    });
    expect(stale.kind).toBe("failed");
    if (stale.kind !== "failed") return;
    expect(stale.error.code).toBe("STALE_VERSION");
    const after = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_project_revisions WHERE project_id = $1",
      [projectId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("无权主体按安全边界拒绝，不泄露目标是否存在", async () => {
    const admin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "workspace-admin-login-2",
      loginName: "workspace-admin",
      password: `${adminPassword}-changed`,
    });
    const outsider = await fixture.access.administerIdentity({
      kind: "create-account",
      commandId: "workspace-create-outsider",
      idempotencyKey: "workspace-create-outsider",
      expectedVersion: "none",
      authorizationContextRef: admin.systemAdministrationContextRef!,
      loginName: "workspace-outsider",
      displayName: "Workspace Outsider",
      password: "workspace-outsider-password",
    });
    if (outsider.kind !== "account") throw new Error("workspace outsider creation failed");
    const outsiderLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "workspace-outsider-login",
      loginName: "workspace-outsider",
      password: "workspace-outsider-password",
    });
    const denied = await workspace.read({
      queryId: "workspace-read-outsider",
      requestedAt: now,
      sessionToken: outsiderLogin.sessionToken,
      projectId,
      payload: { kind: "context" } as never,
    });
    expect(denied.kind).toBe("failed");
    if (denied.kind !== "failed") return;
    expect(denied.error.code).toBe("AUTHORIZATION_DENIED");
  });
});
