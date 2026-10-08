import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpatialScopeRefV1 } from "@riskflow/contracts/ports";

import {
  activePasswordDerivations,
  bootstrapInitialSystemAdministrator,
  createSessionToken,
  createPostgresLocalIdentityAccess,
  decodeAndVerifySessionToken,
  derivePassword,
  makeDummyCredential,
  PASSWORD_POLICY_V1,
  SESSION_TOKEN_POLICY_V1,
  verifyPassword,
} from "../../src/auth/index.js";
import type { PostgresLocalIdentityAccess } from "../../src/auth/index.js";
import { startAuthPostgresFixture, type AuthPostgresFixture } from "./fixture.js";

const ADMIN_PASSWORD = "admin-password-v1";
const USER_PASSWORD = "user-password-v1";
const USER_PASSWORD_CHANGED = "user-password-changed-v1";
const REVIEWER_PASSWORD = "reviewer-password-v1";
const RESPONDER_PASSWORD = "responder-password-v1";
const VIEWER_PASSWORD = "viewer-password-v1";
const CHILD_PASSWORD = "child-password-v1";
const THROTTLE_PASSWORD = "throttle-password-v1";
const ADMIN_CHANGED_PASSWORD = "admin-password-changed-v1";
const OPERATIONS_PASSWORD = "operations-password-v1";
const OPERATIONS_PASSWORD_CHANGED = "operations-password-changed-v1";
const HMAC_KEY = new Uint8Array(32).fill(7);

const mutableClock = () => {
  let current = new Date("2030-01-01T00:00:00.000Z");
  return {
    now: () => new Date(current),
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
};

describe.sequential("local identity and project authorization", () => {
  let fixture: AuthPostgresFixture | undefined;
  let access: PostgresLocalIdentityAccess | undefined;
  let adminContext:
    | NonNullable<
        Awaited<ReturnType<PostgresLocalIdentityAccess["login"]>>["systemAdministrationContextRef"]
      >
    | undefined;
  let adminSessionToken: string | undefined;
  // 系统管理面使用的当前管理员会话；测试不缓存登录时的旧管理引用。
  let administrationSessionToken: string | undefined;
  let userAccountId: string | undefined;
  let managerSessionToken: string | undefined;
  let managerRegistrationContext:
    | NonNullable<Awaited<ReturnType<PostgresLocalIdentityAccess["authorize"]>>>["context"]
    | undefined;
  const roleAccountIds: Partial<
    Record<"reviewer" | "field-responder" | "business-viewer" | "child" | "throttle", string>
  > = {};
  const roleSessionTokens: Partial<
    Record<"reviewer" | "field-responder" | "business-viewer" | "child", string>
  > = {};
  let rootScopeRef: SpatialScopeRefV1 | undefined;
  let childScopeRef: SpatialScopeRefV1 | undefined;
  let sourceGrantId: string | undefined;
  let sourceTwoGrantId: string | undefined;
  let projectBRootScopeId: string | undefined;
  let viewerProjectionDecision:
    Awaited<ReturnType<PostgresLocalIdentityAccess["authorize"]>> | undefined;
  const clock = mutableClock();
  const connection = () => ({
    ...fixture!.app,
    hmacKey: HMAC_KEY,
    keyVersion: "key-v1",
    now: clock.now,
  });
  const currentSecurityVersion = async (accountId: string): Promise<string> => {
    const row = await fixture!.adminPool.query<{ security_version: number }>(
      "SELECT security_version FROM business.local_accounts WHERE account_id = $1",
      [accountId],
    );
    return String(row.rows[0]!.security_version);
  };

  beforeAll(async () => {
    fixture = await startAuthPostgresFixture();
    await bootstrapInitialSystemAdministrator({
      connection: fixture.migrator,
      loginName: "admin001",
      displayName: "Initial administrator",
      password: ADMIN_PASSWORD,
      accountId: "account-admin",
      now: clock.now,
    });
    access = createPostgresLocalIdentityAccess(connection());
  }, 180_000);

  afterAll(async () => {
    await access?.close().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
  });

  it("migration and database privileges", async () => {
    expect(fixture).toBeDefined();
    const tables = await fixture!.adminPool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'business' AND table_name LIKE 'local_%' ORDER BY table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "local_accounts",
        "local_credentials",
        "local_login_attempts",
        "local_sessions",
      ]),
    );
    const grants = await fixture!.adminPool.query<{ privilege_type: string }>(
      "SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'riskflow_app' AND table_schema = 'business' AND table_name = 'security_audit_events'",
    );
    expect(grants.rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    const appPool = new Pool(fixture!.app);
    try {
      await expect(
        appPool.query("DELETE FROM business.security_audit_events"),
      ).rejects.toBeDefined();
      await expect(
        appPool.query("ALTER TABLE business.local_accounts ADD COLUMN should_not_exist text"),
      ).rejects.toBeDefined();
      await expect(
        appPool.query("UPDATE business.local_login_attempts SET attempt_count = attempt_count"),
      ).rejects.toBeDefined();
      await expect(
        appPool.query("UPDATE business.authorization_contexts SET branch = branch"),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
  });

  it("password and token primitives", async () => {
    expect(PASSWORD_POLICY_V1).toMatchObject({
      algorithm: "scrypt",
      cost: 131072,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32,
      saltLength: 16,
      maxmem: 268435456,
      maxConcurrent: 4,
    });
    expect(SESSION_TOKEN_POLICY_V1).toMatchObject({
      sessionIdBytes: 16,
      nonceBytes: 16,
      macBytes: 32,
    });
    const first = await derivePassword("primitive-password-v1");
    const second = await derivePassword("primitive-password-v1");
    expect(first.salt).not.toEqual(second.salt);
    expect(await verifyPassword("riskflow-dummy-password-v1", await makeDummyCredential())).toBe(
      true,
    );
    const tokenKey = { keyVersion: "key-v1", hmacKey: HMAC_KEY };
    const generated = createSessionToken(tokenKey);
    expect(generated.sessionId).toHaveLength(SESSION_TOKEN_POLICY_V1.sessionIdBytes);
    expect(generated.nonce).toHaveLength(SESSION_TOKEN_POLICY_V1.nonceBytes);
    expect(decodeAndVerifySessionToken(generated.token, tokenKey)).toMatchObject({
      sessionId: generated.sessionId,
      nonce: generated.nonce,
    });
    expect(
      decodeAndVerifySessionToken(generated.token.replace(/^v1/, "v2"), tokenKey),
    ).toBeUndefined();
    const tamperedToken = `${generated.token.slice(0, -1)}${generated.token.endsWith("A") ? "B" : "A"}`;
    expect(decodeAndVerifySessionToken(tamperedToken, tokenKey)).toBeUndefined();
    const concurrent = Array.from({ length: 5 }, () => derivePassword("concurrent-password-v1"));
    expect(activePasswordDerivations()).toBe(PASSWORD_POLICY_V1.maxConcurrent);
    await Promise.all(concurrent);
    expect(activePasswordDerivations()).toBe(0);
  });

  it("bootstrap|account administration", async () => {
    const login = await access!.login({
      kind: "login",
      loginAttemptId: "login-admin-1",
      loginName: " admin001 ",
      password: ADMIN_PASSWORD,
    });
    expect(login.passwordChangeRequired).toBe(true);
    expect(login.systemAdministrationContextRef).toBeDefined();
    await expect(
      access!.administerIdentity({
        kind: "create-account",
        commandId: "command-create-before-admin-password-change",
        idempotencyKey: "idem-create-before-admin-password-change",
        expectedVersion: "none",
        authorizationContextRef: login.systemAdministrationContextRef!,
        loginName: "blocked001",
        displayName: "Blocked account",
        password: USER_PASSWORD,
      }),
    ).rejects.toMatchObject({ details: { code: "PASSWORD_CHANGE_REQUIRED" } });
    const changed = await access!.changePassword({
      kind: "change-password",
      sessionToken: login.sessionToken,
      newPassword: "admin-password-changed-v1",
    });
    expect(changed.passwordChangeRequired).toBe(false);
    adminContext = changed.systemAdministrationContextRef;
    adminSessionToken = changed.sessionToken;
    const created = await access!.administerIdentity({
      kind: "create-account",
      commandId: "command-create-user",
      idempotencyKey: "idem-create-user",
      expectedVersion: "none",
      authorizationContextRef: changed.systemAdministrationContextRef!,
      loginName: "user001",
      displayName: "User One",
      password: USER_PASSWORD,
    });
    expect(created.kind).toBe("account");
    userAccountId = created.resultRef.entityId;
    const duplicate = await access!.administerIdentity({
      kind: "create-account",
      commandId: "command-create-user",
      idempotencyKey: "idem-create-user",
      expectedVersion: "none",
      authorizationContextRef: changed.systemAdministrationContextRef!,
      loginName: " USER001 ",
      displayName: "User One",
      password: USER_PASSWORD,
    });
    expect(duplicate).toEqual(created);

    const additionalAccounts = [
      ["review001", "Reviewer One", REVIEWER_PASSWORD, "reviewer"],
      ["respond001", "Responder One", RESPONDER_PASSWORD, "field-responder"],
      ["viewer001", "Viewer One", VIEWER_PASSWORD, "business-viewer"],
      ["child001", "Child Viewer", CHILD_PASSWORD, "child"],
      ["throttle001", "Throttle User", THROTTLE_PASSWORD, "throttle"],
    ] as const;
    for (const [loginName, displayName, password, role] of additionalAccounts) {
      const result = await access!.administerIdentity({
        kind: "create-account",
        commandId: `command-create-${role}`,
        idempotencyKey: `idem-create-${role}`,
        expectedVersion: "none",
        authorizationContextRef: changed.systemAdministrationContextRef!,
        loginName,
        displayName,
        password,
      });
      roleAccountIds[role] = result.resultRef.entityId;
    }
  });

  it("project|membership|spatial|authorize|verify", async () => {
    expect(adminContext).toBeDefined();
    expect(userAccountId).toBeDefined();
    const opened = await access!.administerProject({
      kind: "open-project",
      projectId: "project-a",
      commandId: "command-open-project",
      idempotencyKey: "idem-open-project",
      expectedVersion: "none",
      authorizationContextRef: adminContext!,
      initialRiskManagerAccountId: userAccountId!,
    });
    expect(opened.kind).toBe("project");
    const root = await fixture!.adminPool.query<{ scope_id: string; revision_id: string }>(
      "SELECT scope.scope_id, scope.current_revision_id AS revision_id FROM business.access_spatial_scopes scope WHERE scope.project_id = $1",
      ["project-a"],
    );
    rootScopeRef = {
      kind: "spatial-scope",
      reference: { entityId: root.rows[0]!.scope_id, versionId: root.rows[0]!.revision_id },
    };
    const userLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-user-project",
      loginName: "user001",
      password: USER_PASSWORD,
    });
    expect(userLogin.restricted).toBe(true);
    const userChanged = await access!.changePassword({
      kind: "change-password",
      sessionToken: userLogin.sessionToken,
      newPassword: USER_PASSWORD_CHANGED,
    });
    managerSessionToken = userChanged.sessionToken;
    const managerRegistration = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: userChanged.sessionToken },
      invocationId: "authorize-manager-registration",
      projectId: "project-a",
      branch: "engineering-data.register-source-delivery",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    managerRegistrationContext = managerRegistration.context;
    const decision = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: userChanged.sessionToken },
      invocationId: "authorize-project-query",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    expect(decision.context.grantedCapabilities).toEqual(["projection.query"]);
    const verified = await access!.verify({
      authorizationContextRef: decision.contextRef,
      invocationId: "authorize-project-query",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: decision.context.spatialScopeRefs,
      requestedSourceVersionRefs: [],
    });
    expect(verified.contextRef).toEqual(decision.contextRef);
  });

  it("preset roles, project isolation, spatial closure, and causal narrowing", async () => {
    expect(managerRegistrationContext).toBeDefined();
    expect(rootScopeRef).toBeDefined();
    const roleCases = [
      ["reviewer", "review-audit.decide-review", "warning-response.record-execution"],
      ["field-responder", "warning-response.record-execution", "review-audit.decide-review"],
      ["business-viewer", "projection.export", "warning-response.record-execution"],
    ] as const;
    for (const [role, allowedBranch, deniedBranch] of roleCases) {
      await access!.administerProject({
        kind: "revise-membership",
        projectId: "project-a",
        commandId: `command-membership-${role}`,
        idempotencyKey: `idem-membership-${role}`,
        expectedVersion: "none",
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        membershipId: `membership-${role}`,
        accountId: roleAccountIds[role]!,
        roles: [role],
        spatialScopeRefs: [rootScopeRef!],
        status: "active",
      });
      const login = await access!.login({
        kind: "login",
        loginAttemptId: `login-${role}`,
        loginName:
          role === "reviewer"
            ? "review001"
            : role === "field-responder"
              ? "respond001"
              : "viewer001",
        password:
          role === "reviewer"
            ? REVIEWER_PASSWORD
            : role === "field-responder"
              ? RESPONDER_PASSWORD
              : VIEWER_PASSWORD,
      });
      const changed = await access!.changePassword({
        kind: "change-password",
        sessionToken: login.sessionToken,
        newPassword:
          role === "reviewer"
            ? REVIEWER_PASSWORD
            : role === "field-responder"
              ? RESPONDER_PASSWORD
              : VIEWER_PASSWORD,
      });
      roleSessionTokens[role] = changed.sessionToken;
      const allowed = await access!.authorize({
        invocation: { kind: "human-session", sessionToken: changed.sessionToken },
        invocationId: `authorize-${role}-allowed`,
        projectId: "project-a",
        branch: allowedBranch,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      expect(allowed.context.grantedCapabilities).toHaveLength(1);
      await expect(
        access!.authorize({
          invocation: { kind: "human-session", sessionToken: changed.sessionToken },
          invocationId: `authorize-${role}-denied`,
          projectId: "project-a",
          branch: deniedBranch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        }),
      ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    }

    const childScope = await access!.administerProject({
      kind: "create-spatial-scope",
      projectId: "project-a",
      commandId: "command-create-child-scope",
      idempotencyKey: "idem-create-child-scope",
      expectedVersion: "none",
      authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
      scopeId: "scope-child",
      parentScopeRef: rootScopeRef,
    });
    childScopeRef = {
      kind: "spatial-scope",
      reference: { entityId: childScope.resultRef.entityId, versionId: "scope-child" },
    };
    const childRevision = await fixture!.adminPool.query<{ revision_id: string }>(
      "SELECT current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE scope_id = $1",
      ["scope-child"],
    );
    childScopeRef = {
      kind: "spatial-scope",
      reference: { entityId: "scope-child", versionId: childRevision.rows[0]!.revision_id },
    };
    await access!.administerProject({
      kind: "revise-membership",
      projectId: "project-a",
      commandId: "command-membership-child",
      idempotencyKey: "idem-membership-child",
      expectedVersion: "none",
      authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
      membershipId: "membership-child",
      accountId: roleAccountIds.child!,
      roles: ["business-viewer"],
      spatialScopeRefs: [childScopeRef],
      status: "active",
    });
    const childLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-child",
      loginName: "child001",
      password: CHILD_PASSWORD,
    });
    const childChanged = await access!.changePassword({
      kind: "change-password",
      sessionToken: childLogin.sessionToken,
      newPassword: CHILD_PASSWORD,
    });
    roleSessionTokens.child = childChanged.sessionToken;
    await access!.authorize({
      invocation: { kind: "human-session", sessionToken: childChanged.sessionToken },
      invocationId: "authorize-child-scope",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [childScopeRef],
      requestedSourceVersionRefs: [],
    });
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: childChanged.sessionToken },
        invocationId: "authorize-child-parent",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [rootScopeRef!],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });

    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: adminSessionToken! },
        invocationId: "authorize-admin-no-membership",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: roleSessionTokens["business-viewer"]! },
        invocationId: "authorize-cross-project",
        projectId: "project-missing",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });

    const parent = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens.reviewer! },
      invocationId: "authorize-reviewer-parent",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    const workflowRunRef = {
      kind: "workflow-run" as const,
      reference: { entityId: "run-causal", versionId: "1" },
    };
    const agentTaskRef = {
      kind: "agent-task" as const,
      reference: { entityId: "task-causal", versionId: "1" },
      taskType: "retrieval-review" as const,
      triggerMode: "embedded" as const,
      modelDeploymentRef: { entityId: "model", versionId: "1" },
      promptTemplateRef: { entityId: "prompt", versionId: "1" },
      toolPolicyRef: { entityId: "tool-policy", versionId: "1" },
      budgetPolicyRef: { entityId: "budget", versionId: "1" },
      incrementSchemaRef: { entityId: "increment", versionId: "1" },
      validationPolicyRef: { entityId: "validation", versionId: "1" },
    };
    const agentChild = await access!.authorize({
      invocation: { kind: "agent-task", agentTaskRef },
      invocationId: "authorize-agent-child",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [parent.context.spatialScopeRefs[0]!],
      requestedSourceVersionRefs: [],
      parentContext: parent.context,
      causalRunRef: workflowRunRef,
    });
    expect(agentChild.context.invocation.kind).toBe("agent-task");
    await expect(
      access!.authorize({
        invocation: {
          kind: "agent-task",
          agentTaskRef: {
            ...agentTaskRef,
            reference: { entityId: "task-causal-other", versionId: "1" },
          },
        },
        invocationId: "authorize-agent-child",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [parent.context.spatialScopeRefs[0]!],
        requestedSourceVersionRefs: [],
        parentContext: parent.context,
        causalRunRef: workflowRunRef,
      }),
    ).rejects.toMatchObject({ details: { code: "IDEMPOTENCY_CONFLICT" } });
    await expect(
      access!.authorize({
        invocation: { kind: "agent-task", agentTaskRef },
        invocationId: "authorize-agent-widen",
        projectId: "project-a",
        branch: "warning-response.record-execution",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        parentContext: parent.context,
        causalRunRef: workflowRunRef,
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    const systemChild = await access!.authorize({
      invocation: {
        kind: "system",
        systemActorId: parent.context.actorId,
        reasonCode: "scheduled-query",
      },
      invocationId: "authorize-system-child",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      parentContext: parent.context,
      causalRunRef: workflowRunRef,
    });
    expect(systemChild.context.invocation.kind).toBe("system");
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: roleSessionTokens.reviewer! },
        invocationId: "authorize-fake-client-capability",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        grantedCapabilities: ["risk-assessment.evaluate"],
      } as never),
    ).rejects.toMatchObject({ details: { code: "ACCESS_CONTRACT_INVALID" } });
  });

  it("issues and verifies the exact terminal failure evidence read capability", async () => {
    expect(managerSessionToken).toBeDefined();
    const readBranch = "agent-task.read-failure-evidence" as const;
    const issued = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: managerSessionToken! },
      invocationId: "authorize-agent-task-read",
      projectId: "project-a",
      branch: readBranch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    expect(issued.context.grantedCapabilities).toEqual(["agent-task.read"]);
    const verified = await access!.verify({
      authorizationContextRef: issued.contextRef,
      invocationId: "authorize-agent-task-read",
      projectId: "project-a",
      branch: readBranch,
      requestedSpatialScopeRefs: issued.context.spatialScopeRefs,
      requestedSourceVersionRefs: [],
    });
    expect(verified.context.grantedCapabilities).toEqual(["agent-task.read"]);
    expect(verified.contextRef).toEqual(issued.contextRef);
    await expect(
      access!.verify({
        authorizationContextRef: issued.contextRef,
        invocationId: "authorize-agent-task-read",
        projectId: "project-a",
        branch: "agent-task.start-task",
        requestedSpatialScopeRefs: issued.context.spatialScopeRefs,
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    for (const role of ["reviewer", "field-responder", "business-viewer"] as const) {
      await expect(
        access!.authorize({
          invocation: { kind: "human-session", sessionToken: roleSessionTokens[role]! },
          invocationId: `authorize-agent-task-read-${role}`,
          projectId: "project-a",
          branch: readBranch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        }),
      ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    }
  });

  it("cross-project, invalid scope graph, and concurrent revision boundaries", async () => {
    await access!.administerProject({
      kind: "open-project",
      projectId: "project-b",
      commandId: "command-open-project-b",
      idempotencyKey: "idem-open-project-b",
      expectedVersion: "none",
      authorizationContextRef: adminContext!,
      initialRiskManagerAccountId: userAccountId!,
    });
    const otherRoot = await fixture!.adminPool.query<{ scope_id: string; revision_id: string }>(
      "SELECT scope.scope_id, scope.current_revision_id AS revision_id FROM business.access_spatial_scopes scope WHERE scope.project_id = $1",
      ["project-b"],
    );
    projectBRootScopeId = otherRoot.rows[0]!.scope_id;
    await expect(
      access!.administerProject({
        kind: "create-spatial-scope",
        projectId: "project-a",
        commandId: "command-cross-project-scope",
        idempotencyKey: "idem-cross-project-scope",
        expectedVersion: "none",
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        scopeId: "scope-cross-project",
        parentScopeRef: {
          kind: "spatial-scope",
          reference: {
            entityId: otherRoot.rows[0]!.scope_id,
            versionId: otherRoot.rows[0]!.revision_id,
          },
        },
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    await expect(
      access!.administerProject({
        kind: "revise-spatial-scope",
        projectId: "project-a",
        commandId: "command-cycle-scope",
        idempotencyKey: "idem-cycle-scope",
        expectedVersion: { entityId: "scope-child", versionId: "1" },
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        scopeId: "scope-child",
        status: "active",
        parentScopeRef: childScopeRef,
      }),
    ).rejects.toMatchObject({ details: { code: "ACCESS_CONTRACT_INVALID" } });

    const reviewerRevision = await fixture!.adminPool.query<{ current_revision_id: string }>(
      "SELECT current_revision_id FROM business.project_memberships WHERE membership_id = 'membership-reviewer'",
    );
    const appPool = new Pool(fixture!.app);
    try {
      await expect(
        appPool.query(
          "INSERT INTO business.project_membership_revision_scopes (revision_id, project_id, scope_id) VALUES ($1, $2, $3)",
          [reviewerRevision.rows[0]!.current_revision_id, "project-b", projectBRootScopeId],
        ),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }

    const concurrentResults = await Promise.allSettled([
      access!.administerProject({
        kind: "revise-membership",
        projectId: "project-a",
        commandId: "command-concurrent-membership-a",
        idempotencyKey: "idem-concurrent-membership-a",
        expectedVersion: { entityId: "membership-reviewer", versionId: "1" },
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        membershipId: "membership-reviewer",
        accountId: roleAccountIds.reviewer!,
        roles: ["reviewer"],
        spatialScopeRefs: [rootScopeRef!],
        status: "active",
      }),
      access!.administerProject({
        kind: "revise-membership",
        projectId: "project-a",
        commandId: "command-concurrent-membership-b",
        idempotencyKey: "idem-concurrent-membership-b",
        expectedVersion: { entityId: "membership-reviewer", versionId: "1" },
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        membershipId: "membership-reviewer",
        accountId: roleAccountIds.reviewer!,
        roles: ["field-responder"],
        spatialScopeRefs: [rootScopeRef!],
        status: "active",
      }),
    ]);
    expect(concurrentResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrentResults.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({
      details: { code: "STALE_ACCESS_VERSION" },
    });

    await access!.administerProject({
      kind: "revise-membership",
      projectId: "project-a",
      commandId: "command-promote-reviewer-manager",
      idempotencyKey: "idem-promote-reviewer-manager",
      expectedVersion: { entityId: "membership-reviewer", versionId: "2" },
      authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
      membershipId: "membership-reviewer",
      accountId: roleAccountIds.reviewer!,
      roles: ["project-risk-manager"],
      spatialScopeRefs: [rootScopeRef!],
      status: "active",
    });
    const originalManager = await fixture!.adminPool.query<{
      membership_id: string;
      revision_no: number;
    }>(
      "SELECT membership.membership_id, revision.revision_no FROM business.project_memberships membership JOIN business.project_membership_revisions revision ON revision.revision_id = membership.current_revision_id WHERE membership.project_id = 'project-a' AND membership.account_id = $1",
      [userAccountId],
    );
    const lastManagerRace = await Promise.allSettled([
      access!.administerProject({
        kind: "revise-membership",
        projectId: "project-a",
        commandId: "command-remove-original-manager",
        idempotencyKey: "idem-remove-original-manager",
        expectedVersion: {
          entityId: originalManager.rows[0]!.membership_id,
          versionId: String(originalManager.rows[0]!.revision_no),
        },
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        membershipId: originalManager.rows[0]!.membership_id,
        accountId: userAccountId!,
        roles: ["project-risk-manager"],
        spatialScopeRefs: [rootScopeRef!],
        status: "removed",
      }),
      access!.administerProject({
        kind: "revise-membership",
        projectId: "project-a",
        commandId: "command-remove-promoted-manager",
        idempotencyKey: "idem-remove-promoted-manager",
        expectedVersion: { entityId: "membership-reviewer", versionId: "3" },
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        membershipId: "membership-reviewer",
        accountId: roleAccountIds.reviewer!,
        roles: ["project-risk-manager"],
        spatialScopeRefs: [rootScopeRef!],
        status: "removed",
      }),
    ]);
    expect(lastManagerRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const membershipState = await fixture!.adminPool.query<{
      membership_id: string;
      account_id: string;
      revision_no: number;
      status: "active" | "removed";
    }>(
      "SELECT membership.membership_id, revision.account_id, revision.revision_no, revision.status FROM business.project_memberships membership JOIN business.project_membership_revisions revision ON revision.revision_id = membership.current_revision_id WHERE membership.project_id = 'project-a' AND membership.membership_id = ANY($1::text[])",
      [[originalManager.rows[0]!.membership_id, "membership-reviewer"]],
    );
    const originalState = membershipState.rows.find((row) => row.account_id === userAccountId)!;
    if (originalState.status === "removed") {
      await access!.administerProject({
        kind: "revise-membership",
        projectId: "project-a",
        commandId: "command-restore-original-manager",
        idempotencyKey: "idem-restore-original-manager",
        expectedVersion: {
          entityId: originalState.membership_id,
          versionId: String(originalState.revision_no),
        },
        authorizationContextRef: adminContext!,
        membershipId: originalState.membership_id,
        accountId: userAccountId!,
        roles: ["project-risk-manager"],
        spatialScopeRefs: [rootScopeRef!],
        status: "active",
      });
    }
    const reviewerState = membershipState.rows.find(
      (row) => row.account_id === roleAccountIds.reviewer,
    )!;
    await access!.administerProject({
      kind: "revise-membership",
      projectId: "project-a",
      commandId: "command-restore-reviewer-role",
      idempotencyKey: "idem-restore-reviewer-role",
      expectedVersion: {
        entityId: reviewerState.membership_id,
        versionId: String(reviewerState.revision_no),
      },
      authorizationContextRef: adminContext!,
      membershipId: reviewerState.membership_id,
      accountId: roleAccountIds.reviewer!,
      roles: ["reviewer"],
      spatialScopeRefs: [rootScopeRef!],
      status: "active",
    });
  });

  it("source access, default restriction, derived intersection, and redacted projection", async () => {
    expect(managerRegistrationContext).toBeDefined();
    expect(rootScopeRef).toBeDefined();
    const sourceOne = {
      kind: "source-version" as const,
      reference: { entityId: "source-a", versionId: "1" },
    };
    const sourceTwo = {
      kind: "source-version" as const,
      reference: { entityId: "source-b", versionId: "1" },
    };
    const sourceDefault = {
      kind: "source-version" as const,
      reference: { entityId: "source-default", versionId: "1" },
    };
    const sourceCreated = await access!.administerProject({
      kind: "revise-source-access",
      projectId: "project-a",
      commandId: "command-source-one",
      idempotencyKey: "idem-source-one",
      expectedVersion: "none",
      authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
      sourceVersionRef: sourceOne,
      visibility: "restricted",
      allowedAccountIds: [roleAccountIds["business-viewer"]!],
      spatialScopeRefs: [rootScopeRef!],
      registeredByAccountId: roleAccountIds["business-viewer"]!,
    });
    sourceGrantId = sourceCreated.resultRef.entityId;
    const viewerEvidence = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens["business-viewer"]! },
      invocationId: "authorize-viewer-source-one",
      projectId: "project-a",
      branch: "engineering-data.evidence-access",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [sourceOne],
    });
    expect(viewerEvidence.context.sourceAccessGrantRefs).toHaveLength(1);
    const responderProjection = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens["field-responder"]! },
      invocationId: "authorize-responder-source-one-projection",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [sourceOne],
    });
    expect(responderProjection.redacted).toBe(true);
    expect(responderProjection.context.sourceAccessGrantRefs).toHaveLength(0);
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: roleSessionTokens["field-responder"]! },
        invocationId: "authorize-responder-source-one-body",
        projectId: "project-a",
        branch: "engineering-data.evidence-access",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [sourceOne],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });

    await access!
      .administerProject({
        kind: "revise-source-access",
        projectId: "project-a",
        commandId: "command-source-two",
        idempotencyKey: "idem-source-two",
        expectedVersion: "none",
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        sourceVersionRef: sourceTwo,
        visibility: "restricted",
        allowedAccountIds: [userAccountId!],
        spatialScopeRefs: [rootScopeRef!],
        registeredByAccountId: userAccountId!,
      })
      .then((result) => {
        sourceTwoGrantId = result.resultRef.entityId;
      });
    const derivedProjection = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens["business-viewer"]! },
      invocationId: "authorize-viewer-derived-projection",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [sourceOne, sourceTwo],
    });
    expect(derivedProjection.redacted).toBe(true);
    expect(derivedProjection.context.sourceAccessGrantRefs).toHaveLength(0);
    const redactedExport = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens["business-viewer"]! },
      invocationId: "authorize-viewer-redacted-export",
      projectId: "project-a",
      branch: "projection.export",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [sourceTwo],
    });
    expect(redactedExport.redacted).toBe(true);
    expect(redactedExport.context.sourceAccessGrantRefs).toHaveLength(0);
    const sourceTwoRevision = await fixture!.adminPool.query<{ current_revision_id: string }>(
      "SELECT current_revision_id FROM business.source_access_policies WHERE source_access_grant_id = $1",
      [sourceTwoGrantId],
    );
    const appPool = new Pool(fixture!.app);
    try {
      await expect(
        appPool.query(
          "INSERT INTO business.source_access_policy_revision_scopes (revision_id, project_id, scope_id) VALUES ($1, $2, $3)",
          [sourceTwoRevision.rows[0]!.current_revision_id, "project-b", projectBRootScopeId],
        ),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
    await access!.administerProject({
      kind: "revise-source-access",
      projectId: "project-a",
      commandId: "command-source-default",
      idempotencyKey: "idem-source-default",
      expectedVersion: "none",
      authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
      sourceVersionRef: sourceDefault,
      visibility: "restricted",
      allowedAccountIds: [],
      spatialScopeRefs: [],
      registeredByAccountId: roleAccountIds["business-viewer"]!,
    });
    const defaultSource = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens["business-viewer"]! },
      invocationId: "authorize-viewer-default-source",
      projectId: "project-a",
      branch: "engineering-data.evidence-access",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [sourceDefault],
    });
    expect(defaultSource.context.sourceAccessGrantRefs).toHaveLength(1);
    await expect(
      access!.administerProject({
        kind: "revise-source-access",
        projectId: "project-a",
        commandId: "command-source-shared-accounts",
        idempotencyKey: "idem-source-shared-accounts",
        expectedVersion: "none",
        authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
        sourceVersionRef: {
          kind: "source-version",
          reference: { entityId: "source-invalid", versionId: "1" },
        },
        visibility: "project-shared",
        allowedAccountIds: [roleAccountIds["business-viewer"]!],
        spatialScopeRefs: [rootScopeRef!],
        registeredByAccountId: userAccountId!,
      }),
    ).rejects.toMatchObject({ details: { code: "ACCESS_CONTRACT_INVALID" } });

    viewerProjectionDecision = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: roleSessionTokens["business-viewer"]! },
      invocationId: "authorize-viewer-source-one-projection-before-shrink",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [sourceOne],
    });
    expect(viewerProjectionDecision.redacted).toBe(false);
    await access!.administerProject({
      kind: "revise-source-access",
      projectId: "project-a",
      commandId: "command-source-one-shrink",
      idempotencyKey: "idem-source-one-shrink",
      expectedVersion: { entityId: sourceGrantId!, versionId: "1" },
      authorizationContextRef: managerRegistrationContext!.authorizationContextRef,
      sourceVersionRef: sourceOne,
      visibility: "restricted",
      allowedAccountIds: [userAccountId!],
      spatialScopeRefs: [rootScopeRef!],
      registeredByAccountId: userAccountId!,
    });
    const narrowed = await access!.verify({
      authorizationContextRef: viewerProjectionDecision.contextRef,
      invocationId: "authorize-viewer-source-one-projection-before-shrink",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    expect(narrowed.redacted).toBe(true);
    expect(narrowed.context.sourceAccessGrantRefs).toHaveLength(0);
    await expect(
      access!.verify({
        authorizationContextRef: viewerEvidence.contextRef,
        invocationId: "authorize-viewer-source-one",
        projectId: "project-a",
        branch: "engineering-data.evidence-access",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    expect(sourceTwoGrantId).toBeDefined();
  });

  it("throttle, reset clearing, tamper rejection, and non-enumeration", async () => {
    const unknown = access!.login({
      kind: "login",
      loginAttemptId: "login-unknown-account",
      loginName: "unknown001",
      password: "wrong-password-v1",
    });
    const unknownError = await unknown.catch((error: unknown) => error);
    const wrong = await access!
      .login({
        kind: "login",
        loginAttemptId: "login-user-wrong-password",
        loginName: "user001",
        password: "wrong-password-v1",
      })
      .catch((error: unknown) => error);
    expect(unknownError).toMatchObject({ details: { code: "AUTHENTICATION_REJECTED" } });
    expect(wrong).toMatchObject({ details: { code: "AUTHENTICATION_REJECTED" } });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        access!.login({
          kind: "login",
          loginAttemptId: `login-throttle-${attempt}`,
          loginName: "throttle001",
          password: "wrong-password-v1",
        }),
      ).rejects.toMatchObject({ details: { code: "AUTHENTICATION_REJECTED" } });
    }
    await expect(
      access!.login({
        kind: "login",
        loginAttemptId: "login-throttle-locked",
        loginName: "throttle001",
        password: THROTTLE_PASSWORD,
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHENTICATION_REJECTED" } });
    await access!.administerIdentity({
      kind: "reset-password",
      commandId: "command-reset-throttle",
      idempotencyKey: "idem-reset-throttle",
      expectedVersion: { entityId: roleAccountIds.throttle!, versionId: "1" },
      authorizationContextRef: adminContext!,
      accountId: roleAccountIds.throttle!,
      password: THROTTLE_PASSWORD,
    });
    const unlocked = await access!.login({
      kind: "login",
      loginAttemptId: "login-throttle-unlocked",
      loginName: "throttle001",
      password: THROTTLE_PASSWORD,
    });
    expect(unlocked.restricted).toBe(true);
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: unlocked.sessionToken },
        invocationId: "authorize-restricted-before-change",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "PASSWORD_CHANGE_REQUIRED" } });

    const tampered =
      roleSessionTokens.reviewer!.slice(0, -1) +
      (roleSessionTokens.reviewer!.endsWith("A") ? "B" : "A");
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: tampered },
        invocationId: "authorize-tampered-token",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_REVOKED" } });
    const managerRefresh = await access!.login({
      kind: "login",
      loginAttemptId: "login-manager-refresh",
      loginName: "user001",
      password: USER_PASSWORD_CHANGED,
    });
    managerSessionToken = managerRefresh.sessionToken;
  }, 30_000);

  it("login|session|password change|throttle", async () => {
    const userLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-user-1",
      loginName: "USER001",
      password: USER_PASSWORD_CHANGED,
    });
    expect(userLogin.restricted).toBe(false);
    const replay = await access!.login({
      kind: "login",
      loginAttemptId: "login-user-1",
      loginName: "user001",
      password: USER_PASSWORD_CHANGED,
    });
    expect(replay.sessionToken).toBe(userLogin.sessionToken);
    await expect(
      access!.login({
        kind: "login",
        loginAttemptId: "login-user-1",
        loginName: "user001",
        password: "incorrect-password-v1",
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHENTICATION_REJECTED" } });
    const userChanged = await access!.changePassword({
      kind: "change-password",
      sessionToken: userLogin.sessionToken,
      newPassword: USER_PASSWORD_CHANGED,
    });
    managerSessionToken = userChanged.sessionToken;
    expect(userChanged.restricted).toBe(false);
    await access!.logout({ kind: "logout", sessionToken: userChanged.sessionToken });
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: userChanged.sessionToken },
        invocationId: "auth-after-logout",
        projectId: "project-missing",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_REVOKED" } });
    const managerRefresh = await access!.login({
      kind: "login",
      loginAttemptId: "login-manager-refresh-after-logout",
      loginName: "user001",
      password: USER_PASSWORD_CHANGED,
    });
    managerSessionToken = managerRefresh.sessionToken;
  });

  it("audit closure, sensitive-field filtering, and transactional rollback", async () => {
    await expect(
      bootstrapInitialSystemAdministrator({
        connection: fixture!.migrator,
        loginName: "second-admin",
        displayName: "Second administrator",
        password: "second-admin-password-v1",
        accountId: "account-second-admin",
        now: clock.now,
      }),
    ).rejects.toMatchObject({ details: { code: "ACCESS_TERMINAL_FAILURE" } });

    const auditText = await fixture!.adminPool.query<{ value: string }>(
      "SELECT coalesce(string_agg(concat_ws('|', event_kind, outcome, reason_code, subject_ref, project_ref, request_ref, context_ref::text, diagnostic_ref::text), E'\\n'), '') AS value FROM business.security_audit_events",
    );
    const receiptText = await fixture!.adminPool.query<{ value: string }>(
      "SELECT coalesce(string_agg(payload_sha256 || ':' || coalesce(result_ref::text, ''), E'\\n'), '') AS value FROM business.command_receipts",
    );
    expect(auditText.rows[0]!.value).not.toContain(ADMIN_PASSWORD);
    expect(auditText.rows[0]!.value).not.toContain(USER_PASSWORD);
    expect(auditText.rows[0]!.value).not.toContain(USER_PASSWORD_CHANGED);
    expect(auditText.rows[0]!.value).not.toContain("v1.");
    expect(receiptText.rows[0]!.value).not.toContain(USER_PASSWORD);

    await fixture!.adminPool.query("REVOKE INSERT ON TABLE audit.entries FROM riskflow_app");
    await expect(
      access!.administerIdentity({
        kind: "create-account",
        commandId: "command-audit-rollback-account",
        idempotencyKey: "idem-audit-rollback-account",
        expectedVersion: "none",
        authorizationContextRef: adminContext!,
        loginName: "rollback001",
        displayName: "Rollback account",
        password: "rollback-password-v1",
      }),
    ).rejects.toMatchObject({ details: { code: "ACCESS_TERMINAL_FAILURE" } });
    await fixture!.adminPool.query("GRANT INSERT ON TABLE audit.entries TO riskflow_app");
    const rolledBackAccount = await fixture!.adminPool.query<{ account_id: string }>(
      "SELECT account_id FROM business.local_accounts WHERE login_name = 'rollback001'",
    );
    expect(rolledBackAccount.rows).toHaveLength(0);
    await expect(
      access!.administerIdentity({
        kind: "create-account",
        commandId: "command-audit-rollback-account",
        idempotencyKey: "idem-audit-rollback-account",
        expectedVersion: "none",
        authorizationContextRef: adminContext!,
        loginName: "rollback001",
        displayName: "Rollback account",
        password: "rollback-password-v1",
      }),
    ).resolves.toMatchObject({ kind: "account" });

    const beforeContexts = await fixture!.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.authorization_contexts",
    );
    await fixture!.adminPool.query(
      "REVOKE INSERT ON TABLE business.security_audit_events FROM riskflow_app",
    );
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: managerSessionToken! },
        invocationId: "authorize-audit-write-failure",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "ACCESS_TERMINAL_FAILURE" } });
    await fixture!.adminPool.query(
      "GRANT INSERT ON TABLE business.security_audit_events TO riskflow_app",
    );
    const afterContexts = await fixture!.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.authorization_contexts",
    );
    expect(afterContexts.rows[0]!.count).toBe(beforeContexts.rows[0]!.count);
  });

  it("authorization performance", async () => {
    let sessionToken = managerSessionToken;
    let projectId = "project-a";
    if (sessionToken === undefined) {
      projectId = "project-performance";
      const adminLogin = await access!.login({
        kind: "login",
        loginAttemptId: "login-performance-admin",
        loginName: "admin001",
        password: ADMIN_PASSWORD,
      });
      const adminChanged = await access!.changePassword({
        kind: "change-password",
        sessionToken: adminLogin.sessionToken,
        newPassword: "admin-performance-password-v1",
      });
      const performanceManager = await access!.administerIdentity({
        kind: "create-account",
        commandId: "command-create-performance-manager",
        idempotencyKey: "idem-create-performance-manager",
        expectedVersion: "none",
        authorizationContextRef: adminChanged.systemAdministrationContextRef!,
        loginName: "perform001",
        displayName: "Performance manager",
        password: "performance-manager-password-v1",
      });
      await access!.administerProject({
        kind: "open-project",
        projectId,
        commandId: "command-open-performance-project",
        idempotencyKey: "idem-open-performance-project",
        expectedVersion: "none",
        authorizationContextRef: adminChanged.systemAdministrationContextRef!,
        initialRiskManagerAccountId: performanceManager.resultRef.entityId,
      });
      const managerLogin = await access!.login({
        kind: "login",
        loginAttemptId: "login-performance-manager",
        loginName: "perform001",
        password: "performance-manager-password-v1",
      });
      sessionToken = (
        await access!.changePassword({
          kind: "change-password",
          sessionToken: managerLogin.sessionToken,
          newPassword: "performance-manager-changed-v1",
        })
      ).sessionToken;
    }
    for (let warmup = 0; warmup < 5; warmup += 1) {
      await access!.authorize({
        invocation: { kind: "human-session", sessionToken },
        invocationId: `authorize-performance-warmup-${warmup}`,
        projectId,
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
    }
    const durations: number[] = [];
    const decisions: string[] = [];
    for (let sample = 0; sample < 200; sample += 1) {
      const started = performance.now();
      const decision = await access!.authorize({
        invocation: { kind: "human-session", sessionToken },
        invocationId: `authorize-performance-${sample}`,
        projectId,
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      durations.push(performance.now() - started);
      decisions.push(
        JSON.stringify({
          capabilities: decision.context.grantedCapabilities,
          scopes: decision.context.spatialScopeRefs,
          sources: decision.context.sourceAccessGrantRefs,
        }),
      );
    }
    const sorted = [...durations].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    expect(durations).toHaveLength(200);
    expect(new Set(decisions).size).toBe(1);
    expect(p95).toBeLessThanOrEqual(100);
  }, 180_000);

  it("session introspection reports token-free metadata and honours both deadlines", async () => {
    const managerMetadata = await access!.readSession({
      kind: "introspect-session",
      sessionToken: managerSessionToken!,
    });
    // 自省只回报元数据：没有 token，也没有工程或系统管理授权上下文。
    expect(managerMetadata).not.toHaveProperty("sessionToken");
    expect(managerMetadata).not.toHaveProperty("systemAdministrationContextRef");
    expect(managerMetadata.sessionRef.entityId).toBeTruthy();
    expect(managerMetadata.accountRef.entityId).toBeTruthy();
    expect(managerMetadata.passwordChangeRequired).toBe(false);
    expect(managerMetadata.restricted).toBe(false);

    const liveSession = async () =>
      (
        await fixture!.adminPool.query<{ idle_expires_at: Date; absolute_expires_at: Date }>(
          `SELECT session.idle_expires_at, session.absolute_expires_at
             FROM business.local_sessions session
             JOIN business.local_accounts account ON account.account_id = session.account_id
            WHERE account.login_name = $1 AND session.revoked_at IS NULL
            ORDER BY session.created_at DESC LIMIT 1`,
          ["user001"],
        )
      ).rows[0]!;
    const beforeRead = await liveSession();
    clock.advance(60 * 1000);
    await access!.readSession({ kind: "introspect-session", sessionToken: managerSessionToken! });
    const afterRead = await liveSession();
    // 有效读取按既有会话使用规则推进空闲期限。
    expect(new Date(afterRead.idle_expires_at).getTime()).toBeGreaterThan(
      new Date(beforeRead.idle_expires_at).getTime(),
    );
    // 绝对期限不因反复自省而延后。
    expect(new Date(afterRead.absolute_expires_at).getTime()).toBe(
      new Date(beforeRead.absolute_expires_at).getTime(),
    );
  }, 180_000);

  it("session introspection keeps restricted sessions introspectable", async () => {
    const metadata = await access!.readSession({
      kind: "introspect-session",
      sessionToken: roleSessionTokens.child!,
    });
    // 自省不返回 token，标志来自同一账号事实。
    expect(metadata).not.toHaveProperty("sessionToken");
    expect(metadata).not.toHaveProperty("systemAdministrationContextRef");
    // 同一账号重新登录后的标志与自省完全一致，两条路径不各判一套受限状态。
    const fresh = await access!.login({
      kind: "login",
      loginAttemptId: "login-introspect-restricted",
      loginName: "child001",
      password: CHILD_PASSWORD,
    });
    expect(metadata.restricted).toBe(fresh.restricted);
    expect(metadata.passwordChangeRequired).toBe(fresh.passwordChangeRequired);
    // 受限会话下业务授权限制仍生效：自省通过不等于放行。
    const denial = access!.authorize({
      invocation: { kind: "human-session", sessionToken: fresh.sessionToken },
      invocationId: "authorize-restricted-after-introspect",
      projectId: "project-a",
      branch: "projection.query",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    await (fresh.restricted
      ? expect(denial).rejects.toMatchObject({
          details: { code: "PASSWORD_CHANGE_REQUIRED" },
        })
      : expect(denial).resolves.toBeDefined());
    await access!.logout({ kind: "logout", sessionToken: fresh.sessionToken });
  }, 180_000);

  it("session introspection rejects revoked, disabled, and version-mismatched sessions", async () => {
    await expect(
      access!.readSession({ kind: "introspect-session", sessionToken: "not-a-session-token" }),
    ).rejects.toMatchObject({ details: { code: "SESSION_REVOKED" } });
    const revoked = await access!.login({
      kind: "login",
      loginAttemptId: "login-introspect-revoked",
      loginName: "user001",
      password: USER_PASSWORD_CHANGED,
    });
    await access!.logout({ kind: "logout", sessionToken: revoked.sessionToken });
    await expect(
      access!.readSession({
        kind: "introspect-session",
        sessionToken: revoked.sessionToken,
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_REVOKED" } });
    const keyAccess = createPostgresLocalIdentityAccess({
      ...fixture!.app,
      hmacKey: new Uint8Array(32).fill(9),
      keyVersion: "key-v-introspect",
      now: clock.now,
    });
    await expect(
      keyAccess.readSession({
        kind: "introspect-session",
        sessionToken: roleSessionTokens.reviewer!,
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_REVOKED" } });
    await keyAccess.close();
  }, 180_000);

  it("system administration identity and directory come from the current session", async () => {
    // 管理面只用服务端会话证明身份，不复用登录时签发的旧管理引用。
    // 重新登录取得当前会话；不改动管理员密码，因此不影响其它用例持有的安全修订。
    const adminLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-administration-admin",
      loginName: "admin001",
      password: ADMIN_CHANGED_PASSWORD,
    });
    expect(adminLogin.passwordChangeRequired).toBe(false);
    administrationSessionToken = adminLogin.sessionToken;
    const adminIdentity = await access!.systemAdministration.read({
      kind: "identity",
      schemaVersion: "1",
      queryId: "query-admin-identity",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
    });
    expect(adminIdentity).toMatchObject({
      kind: "succeeded",
      result: { kind: "identity", isSystemAdministrator: true },
    });
    expect(adminIdentity.kind === "succeeded" && adminIdentity.result.kind === "identity"
      ? adminIdentity.result.allowedActions
      : []).toEqual([
      "create-account",
      "disable-account",
      "reset-password",
      "open-project",
      "suspend-project",
      "revise-membership",
    ]);

    // 页大小是硬上界；游标是上一页最后一个账号标识，遍历整本目录必须恰好覆盖全部账号一次。
    const seenAccountRefs: string[] = [];
    const loginNames: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await access!.systemAdministration.read({
        kind: "accounts",
        schemaVersion: "1",
        queryId: `query-accounts-page-${pages}`,
        requestedAt: "2030-01-01T00:00:00.000Z",
        sessionToken: administrationSessionToken!,
        pageSize: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.kind).toBe("succeeded");
      if (page.kind !== "succeeded" || page.result.kind !== "accounts")
        throw new Error("expected account directory");
      expect(page.result.items.length).toBeLessThanOrEqual(2);
      seenAccountRefs.push(...page.result.items.map((item) => item.accountRef.entityId));
      loginNames.push(...page.result.items.map((item) => item.loginName));
      // 目录只投影显示身份、状态与当前版本，不含凭据派生值或会话 token。
      expect(JSON.stringify(page.result)).not.toContain(ADMIN_PASSWORD);
      expect(JSON.stringify(page.result)).not.toContain(administrationSessionToken!);
      cursor = page.result.nextCursor;
      pages += 1;
    } while (cursor !== undefined && pages < 50);
    expect(new Set(seenAccountRefs).size).toBe(seenAccountRefs.length);
    const allAccounts = await fixture!.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.local_accounts",
    );
    expect(seenAccountRefs).toHaveLength(Number(allAccounts.rows[0]!.count));
    expect(loginNames).toContain("admin001");
    expect(loginNames).toContain("user001");
    expect(seenAccountRefs).toContain(userAccountId!);
    const adminItem = (
      await access!.systemAdministration.read({
        kind: "accounts",
        schemaVersion: "1",
        queryId: "query-accounts-admin-item",
        requestedAt: "2030-01-01T00:00:00.000Z",
        sessionToken: administrationSessionToken!,
      })
    );
    if (adminItem.kind !== "succeeded" || adminItem.result.kind !== "accounts")
      throw new Error("expected account directory");
    expect(
      adminItem.result.items.find((item) => item.loginName === "admin001"),
    ).toMatchObject({
      displayName: "Initial administrator",
      status: "active",
      passwordChangeRequired: false,
    });

    const projects = await access!.systemAdministration.read({
      kind: "projects",
      schemaVersion: "1",
      queryId: "query-projects",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
    });
    if (projects.kind !== "succeeded" || projects.result.kind !== "projects")
      throw new Error("expected project directory");
    expect(projects.result.items.map((item) => item.projectId)).toContain("project-a");
    const projectA = projects.result.items.find((item) => item.projectId === "project-a")!;
    expect(projectA.status).toBe("active");
    expect(projectA.rootScopeRef?.reference.entityId).toBe(rootScopeRef?.reference.entityId);

    const memberships = await access!.systemAdministration.read({
      kind: "memberships",
      schemaVersion: "1",
      queryId: "query-memberships",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
      projectId: "project-a",
    });
    if (memberships.kind !== "succeeded" || memberships.result.kind !== "memberships")
      throw new Error("expected membership directory");
    // 管理员自己的工程成员身份不在此出现：管理面不授予工程业务角色。
    expect(
      memberships.result.items.map((item) => ({
        account: item.accountRef.entityId,
        roles: item.roles,
      })),
    ).toEqual(
      expect.arrayContaining([{ account: userAccountId, roles: ["project-risk-manager"] }]),
    );

    const scopes = await access!.systemAdministration.read({
      kind: "spatial-scopes",
      schemaVersion: "1",
      queryId: "query-scopes",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
      projectId: "project-a",
    });
    if (scopes.kind !== "succeeded" || scopes.result.kind !== "spatial-scopes")
      throw new Error("expected scope directory");
    expect(
      scopes.result.items.map((item) => item.scopeRef.reference.entityId),
    ).toContain(rootScopeRef?.reference.entityId);
  }, 180_000);

  it("system administration refuses directory and writes for non-administrator sessions", async () => {
    const userLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-user-administration",
      loginName: "user001",
      password: USER_PASSWORD_CHANGED,
    });
    const ordinarySessionToken = userLogin.sessionToken;
    const identity = await access!.systemAdministration.read({
      kind: "identity",
      schemaVersion: "1",
      queryId: "query-user-identity",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: ordinarySessionToken,
    });
    // 普通有效会话唯一能成功返回的读是 identity，且不披露管理员身份。
    expect(identity).toMatchObject({
      kind: "succeeded",
      result: { kind: "identity", isSystemAdministrator: false, allowedActions: [] },
    });
    // 目录与写入在读取目标之前就拒绝，因此无法用差异响应探测工程是否存在。
    for (const kind of ["accounts", "projects"] as const) {
      const denied = await access!.systemAdministration.read({
        kind,
        schemaVersion: "1",
        queryId: `query-user-${kind}`,
        requestedAt: "2030-01-01T00:00:00.000Z",
        sessionToken: ordinarySessionToken,
      });
      expect(denied).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    }
    const unknownProject = await access!.systemAdministration.read({
      kind: "memberships",
      schemaVersion: "1",
      queryId: "query-user-memberships-unknown",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: ordinarySessionToken,
      projectId: "project-does-not-exist",
    });
    const knownProject = await access!.systemAdministration.read({
      kind: "memberships",
      schemaVersion: "1",
      queryId: "query-user-memberships-known",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: ordinarySessionToken,
      projectId: "project-a",
    });
    expect(unknownProject).toEqual(knownProject);
    expect(unknownProject).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

    const deniedWrite = await access!.systemAdministration.execute({
      schemaVersion: "1",
      commandId: "command-user-disable",
      idempotencyKey: "idem-user-disable",
      issuedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: ordinarySessionToken,
      payload: {
        kind: "disable-account",
        expectedVersion: "none",
        accountId: userAccountId!,
      },
    });
    expect(deniedWrite).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

    // 客户端无法提交、覆盖或重放管理授权引用：载荷联合里根本没有这个字段。
    const forged = await access!.systemAdministration.execute({
      schemaVersion: "1",
      commandId: "command-user-forge-context",
      idempotencyKey: "idem-user-forge-context",
      issuedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: ordinarySessionToken,
      payload: {
        kind: "disable-account",
        expectedVersion: "none",
        accountId: userAccountId!,
        authorizationContextRef: adminContext!,
      },
    } as never);
    expect(forged).toMatchObject({ kind: "failed", error: { code: "ACCESS_CONTRACT_INVALID" } });
    const stillActive = await fixture!.adminPool.query<{ status: string }>(
      "SELECT status FROM business.local_accounts WHERE account_id = $1",
      [userAccountId!],
    );
    expect(stillActive.rows[0]!.status).toBe("active");
    await access!.logout({ kind: "logout", sessionToken: ordinarySessionToken });
  }, 180_000);

  it("system administration executes the six original commands with version and audit boundaries", async () => {
    const envelope = (commandId: string) => ({
      schemaVersion: "1" as const,
      commandId,
      idempotencyKey: `idem-${commandId}`,
      issuedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
    });

    // 1) create-account：预期版本仍被强制，密码只存在于本次请求对象中。
    const created = await access!.systemAdministration.execute({
      ...envelope("command-administration-create"),
      payload: {
        kind: "create-account",
        expectedVersion: "none",
        loginName: "ops001",
        displayName: "Operations account",
        password: OPERATIONS_PASSWORD,
      },
    });
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") throw new Error("expected account creation");
    expect(created.result.kind).toBe("account");
    const operationsAccountId = created.result.resultRef.entityId;
    const replayed = await access!.systemAdministration.execute({
      ...envelope("command-administration-create"),
      payload: {
        kind: "create-account",
        expectedVersion: "none",
        loginName: "ops001",
        displayName: "Operations account",
        password: OPERATIONS_PASSWORD,
      },
    });
    // 幂等身份沿用原收据：重放返回同一引用，不产生第二个账号。
    expect(replayed).toEqual(created);
    const duplicateLogin = await fixture!.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.local_accounts WHERE login_name = 'ops001'",
    );
    expect(duplicateLogin.rows[0]!.count).toBe("1");

    // 2) reset-password：预期版本仍被强制。
    const staleReset = await access!.systemAdministration.execute({
      ...envelope("command-administration-reset-stale"),
      payload: {
        kind: "reset-password",
        expectedVersion: { entityId: operationsAccountId, versionId: "999" },
        accountId: operationsAccountId,
        password: OPERATIONS_PASSWORD_CHANGED,
      },
    });
    expect(staleReset).toMatchObject({ kind: "failed", error: { code: "STALE_ACCESS_VERSION" } });
    const accountDirectory = await access!.systemAdministration.read({
      kind: "accounts",
      schemaVersion: "1",
      queryId: "query-accounts-operations",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
    });
    if (accountDirectory.kind !== "succeeded" || accountDirectory.result.kind !== "accounts")
      throw new Error("expected account directory");
    const operationsItem = accountDirectory.result.items.find(
      (item) => item.accountRef.entityId === operationsAccountId,
    )!;
    expect(operationsItem.passwordChangeRequired).toBe(true);
    const reset = await access!.systemAdministration.execute({
      ...envelope("command-administration-reset"),
      payload: {
        kind: "reset-password",
        expectedVersion: {
          entityId: operationsAccountId,
          versionId: operationsItem.accountRef.versionId,
        },
        accountId: operationsAccountId,
        password: OPERATIONS_PASSWORD_CHANGED,
      },
    });
    expect(reset).toMatchObject({ kind: "succeeded", result: { kind: "account" } });

    // 3) open-project / 4) revise-membership：纯管理员无需工程身份即可完成访问登记。
    const opened = await access!.systemAdministration.execute({
      ...envelope("command-administration-open-project"),
      payload: {
        kind: "open-project",
        projectId: "project-ops",
        expectedVersion: "none",
        initialRiskManagerAccountId: operationsAccountId,
      },
    });
    expect(opened).toMatchObject({ kind: "succeeded", result: { kind: "project" } });
    const projectScopes = await access!.systemAdministration.read({
      kind: "spatial-scopes",
      schemaVersion: "1",
      queryId: "query-scopes-ops",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
      projectId: "project-ops",
    });
    if (projectScopes.kind !== "succeeded" || projectScopes.result.kind !== "spatial-scopes")
      throw new Error("expected scope directory");
    const opsRootScopeRef = projectScopes.result.items[0]!.scopeRef;
    const membership = await access!.systemAdministration.execute({
      ...envelope("command-administration-membership"),
      payload: {
        kind: "revise-membership",
        projectId: "project-ops",
        expectedVersion: "none",
        membershipId: "membership-ops",
        // 工程经理身份已由 open-project 登记，同一账号不能有第二条成员记录。
        accountId: roleAccountIds.reviewer!,
        roles: ["business-viewer"],
        spatialScopeRefs: [opsRootScopeRef],
        status: "active",
      },
    });
    expect(membership).toMatchObject({ kind: "succeeded", result: { kind: "membership" } });
    const membershipDirectory = await access!.systemAdministration.read({
      kind: "memberships",
      schemaVersion: "1",
      queryId: "query-memberships-ops",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
      projectId: "project-ops",
    });
    if (membershipDirectory.kind !== "succeeded" || membershipDirectory.result.kind !== "memberships")
      throw new Error("expected membership directory");
    expect(
      membershipDirectory.result.items.find(
        (item) => item.membershipRef.entityId === "membership-ops",
      ),
    ).toMatchObject({
      accountRef: { entityId: roleAccountIds.reviewer! },
      roles: ["business-viewer"],
      status: "active",
      spatialScopeRefs: [opsRootScopeRef],
    });

    // 5) suspend-project：预期版本仍被强制。
    const staleSuspend = await access!.systemAdministration.execute({
      ...envelope("command-administration-suspend-stale"),
      payload: {
        kind: "suspend-project",
        projectId: "project-ops",
        expectedVersion: { entityId: "project-ops", versionId: "999" },
      },
    });
    expect(staleSuspend).toMatchObject({
      kind: "failed",
      error: { code: "STALE_ACCESS_VERSION" },
    });
    const suspended = await access!.systemAdministration.execute({
      ...envelope("command-administration-suspend"),
      payload: {
        kind: "suspend-project",
        projectId: "project-ops",
        expectedVersion: { entityId: "project-ops", versionId: "1" },
      },
    });
    expect(suspended).toMatchObject({ kind: "succeeded", result: { kind: "project" } });

    // 6) disable-account：预期版本仍被强制，凭据撤销沿原会话语义。
    const staleDisable = await access!.systemAdministration.execute({
      ...envelope("command-administration-disable-stale"),
      payload: {
        kind: "disable-account",
        expectedVersion: { entityId: operationsAccountId, versionId: "1" },
        accountId: operationsAccountId,
      },
    });
    expect(staleDisable).toMatchObject({ kind: "failed", error: { code: "STALE_ACCESS_VERSION" } });
    const disabled = await access!.systemAdministration.execute({
      ...envelope("command-administration-disable"),
      payload: {
        kind: "disable-account",
        expectedVersion: {
          entityId: operationsAccountId,
          versionId: await currentSecurityVersion(operationsAccountId),
        },
        accountId: operationsAccountId,
      },
    });
    expect(disabled).toMatchObject({ kind: "succeeded", result: { kind: "account" } });

    // 审计与收据都不含密码：管理面复用原命令的密码边界。
    const auditText = await fixture!.adminPool.query<{ value: string }>(
      "SELECT coalesce(string_agg(concat_ws('|', event_kind, outcome, reason_code, subject_ref, project_ref, request_ref, context_ref::text), E'\\n'), '') AS value FROM business.security_audit_events",
    );
    const receiptText = await fixture!.adminPool.query<{ value: string }>(
      "SELECT coalesce(string_agg(payload_sha256 || ':' || coalesce(result_ref::text, ''), E'\\n'), '') AS value FROM business.command_receipts",
    );
    expect(auditText.rows[0]!.value).not.toContain(OPERATIONS_PASSWORD);
    expect(auditText.rows[0]!.value).not.toContain(OPERATIONS_PASSWORD_CHANGED);
    expect(receiptText.rows[0]!.value).not.toContain(OPERATIONS_PASSWORD);
    // 管理动作确实落到了原安全审计上。
    expect(auditText.rows[0]!.value).toContain("command-administration-disable");
  }, 180_000);

  it("system administration forwards audit failures with rollback and honours revocation immediately", async () => {
    // 安全审计写入失败时管理写入整体回滚，账号不留下半条事实。
    await fixture!.adminPool.query("REVOKE INSERT ON TABLE audit.entries FROM riskflow_app");
    try {
      const failed = await access!.systemAdministration.execute({
        schemaVersion: "1",
        commandId: "command-administration-audit-rollback",
        idempotencyKey: "idem-administration-audit-rollback",
        issuedAt: "2030-01-01T00:00:00.000Z",
        sessionToken: administrationSessionToken!,
        payload: {
          kind: "create-account",
          expectedVersion: "none",
          loginName: "rollbackops",
          displayName: "Rollback operations",
          password: OPERATIONS_PASSWORD,
        },
      });
      expect(failed).toMatchObject({ kind: "failed", error: { code: "ACCESS_TERMINAL_FAILURE" } });
    } finally {
      await fixture!.adminPool.query("GRANT INSERT ON TABLE audit.entries TO riskflow_app");
    }
    const rolledBack = await fixture!.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.local_accounts WHERE login_name = 'rollbackops'",
    );
    expect(rolledBack.rows[0]!.count).toBe("0");

    // 撤权立即生效：管理身份不是缓存，每次调用都重新验证当前授予与安全修订。
    const temporaryAdmin = await access!.systemAdministration.execute({
      schemaVersion: "1",
      commandId: "command-administration-create-admin",
      idempotencyKey: "idem-administration-create-admin",
      issuedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: administrationSessionToken!,
      payload: {
        kind: "create-account",
        expectedVersion: "none",
        loginName: "opsadmin",
        displayName: "Operations administrator",
        password: OPERATIONS_PASSWORD,
      },
    });
    if (temporaryAdmin.kind !== "succeeded") throw new Error("expected account creation");
    const temporaryAdminId = temporaryAdmin.result.resultRef.entityId;
    await fixture!.adminPool.query(
      "UPDATE business.local_accounts SET system_administrator = TRUE WHERE account_id = $1",
      [temporaryAdminId],
    );
    const temporaryLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-operations-admin",
      loginName: "opsadmin",
      password: OPERATIONS_PASSWORD,
    });
    const temporarySession = (
      await access!.changePassword({
        kind: "change-password",
        sessionToken: temporaryLogin.sessionToken,
        newPassword: OPERATIONS_PASSWORD_CHANGED,
      })
    ).sessionToken;
    const temporaryIdentity = await access!.systemAdministration.read({
      kind: "identity",
      schemaVersion: "1",
      queryId: "query-operations-admin-identity",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: temporarySession,
    });
    expect(temporaryIdentity).toMatchObject({
      kind: "succeeded",
      result: { kind: "identity", isSystemAdministrator: true },
    });

    await fixture!.adminPool.query(
      "UPDATE business.local_accounts SET system_administrator = FALSE, security_version = security_version + 1 WHERE account_id = $1",
      [temporaryAdminId],
    );
    const afterRevocation = await access!.systemAdministration.read({
      kind: "accounts",
      schemaVersion: "1",
      queryId: "query-operations-admin-revoked",
      requestedAt: "2030-01-01T00:00:00.000Z",
      sessionToken: temporarySession,
    });
    expect(afterRevocation).toMatchObject({
      kind: "failed",
      error: { code: "SESSION_REVOKED" },
    });
  }, 180_000);

  it("system administration never grants project business capability", async () => {
    // 纯管理员账号没有任何工程成员身份，因此管理面成功不等于拿到业务能力。
    const identities = [
      administrationSessionToken!,
      (
        await access!.login({
          kind: "login",
          loginAttemptId: "login-opsadmin-business",
          loginName: "opsadmin",
          password: OPERATIONS_PASSWORD_CHANGED,
        })
      ).sessionToken,
    ];
    for (const sessionToken of identities) {
      for (const branch of [
        "projection.query",
        "engineering-data.context-read",
        "review-audit.decide-review",
      ] as const) {
        await expect(
          access!.authorize({
            invocation: { kind: "human-session", sessionToken },
            invocationId: `authorize-administrator-business-${branch}`,
            projectId: "project-a",
            branch,
            requestedSpatialScopeRefs: [],
            requestedSourceVersionRefs: [],
          }),
        ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
      }
    }
  }, 180_000);

  it("credential revocation, key-version invalidation, and session timeouts", async () => {
    const resetAccount = await fixture!.adminPool.query<{ security_version: number }>(
      "SELECT security_version FROM business.local_accounts WHERE account_id = $1",
      [roleAccountIds.child!],
    );
    await access!.administerIdentity({
      kind: "disable-account",
      commandId: "command-disable-child",
      idempotencyKey: "idem-disable-child",
      expectedVersion: {
        entityId: roleAccountIds.child!,
        versionId: String(resetAccount.rows[0]!.security_version),
      },
      authorizationContextRef: adminContext!,
      accountId: roleAccountIds.child!,
    });
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: roleSessionTokens.child! },
        invocationId: "authorize-disabled-child",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    const disabled = await fixture!.adminPool.query<{ status: string; revoked: string }>(
      "SELECT account.status, count(session.session_id)::text AS revoked FROM business.local_accounts account LEFT JOIN business.local_sessions session ON session.account_id = account.account_id AND session.revoked_at IS NOT NULL WHERE account.account_id = $1 GROUP BY account.status",
      [roleAccountIds.child!],
    );
    expect(disabled.rows[0]!.status).toBe("disabled");
    expect(Number(disabled.rows[0]!.revoked)).toBeGreaterThan(0);

    const keyAccess = createPostgresLocalIdentityAccess({
      ...fixture!.app,
      hmacKey: new Uint8Array(32).fill(8),
      keyVersion: "key-v2",
      now: clock.now,
    });
    await expect(
      keyAccess.authorize({
        invocation: { kind: "human-session", sessionToken: roleSessionTokens.reviewer! },
        invocationId: "authorize-key-version-invalidated",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_REVOKED" } });
    await keyAccess.close();

    const throttleLogin = await access!.login({
      kind: "login",
      loginAttemptId: "login-throttle-timeout",
      loginName: "throttle001",
      password: THROTTLE_PASSWORD,
    });
    const timeoutSession = await access!.changePassword({
      kind: "change-password",
      sessionToken: throttleLogin.sessionToken,
      newPassword: THROTTLE_PASSWORD,
    });
    clock.advance(30 * 60 * 1000 + 1);
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: timeoutSession.sessionToken },
        invocationId: "authorize-idle-timeout",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_EXPIRED" } });
    clock.advance(11 * 60 * 60 * 1000 + 30 * 60 * 1000 + 1);
    await expect(
      access!.authorize({
        invocation: { kind: "human-session", sessionToken: managerSessionToken! },
        invocationId: "authorize-absolute-timeout",
        projectId: "project-a",
        branch: "projection.query",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      }),
    ).rejects.toMatchObject({ details: { code: "SESSION_EXPIRED" } });
  }, 180_000);

});
