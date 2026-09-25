import { describe, expect, it } from "vitest";

import {
  HTTP_COOKIE_NAME_V1,
  HTTP_ROUTE_CATALOG_V1,
  HTTP_SYSTEM_ROUTE_CATALOG_V1,
  buildApi,
  decodeWorkflowRunIdV1,
  encodeWorkflowRunIdV1,
  mapModuleResult,
  type ApiPortsV1,
  type HttpAccessLogEntryV1,
} from "../src/index.js";
import { MODULE_BRANCH_CAPABILITY_V1 } from "@riskflow/contracts/ports";
import type {
  EngineeringDataPortV1,
  HumanDecisionFeedbackCommandV1,
  HumanDecisionFeedbackPortV1,
  ProjectionPortV1,
  WarningResponsePortV1,
  WarningResponseRecordSuccessV1,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";

const NOW = "2026-01-01T00:00:00.000Z";
const ORIGIN = "https://ui.example";
const scope = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope", versionId: "1" },
};

const session = (token: string) => ({
  sessionRef: { entityId: "session", versionId: "1" },
  accountRef: { entityId: "account", versionId: "1" },
  sessionToken: token,
  passwordChangeRequired: false,
  restricted: false,
  expiresAt: NOW,
});

const accessStub = (onAuthorize?: (branch: string) => void): LocalIdentityAccessV1 => ({
  administerIdentity: async () => {
    throw new Error("unused");
  },
  administerProject: async () => {
    throw new Error("unused");
  },
  login: async () => session("opaque-token"),
  changePassword: async () => session("rotated-token"),
  logout: async () => ({
    kind: "session",
    resultRef: { entityId: "session", versionId: "1" },
    references: [],
  }),
  authorize: async (request) => {
    onAuthorize?.(request.branch);
    return {
      context: {
        schemaVersion: "1",
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: "context", versionId: "1" },
        },
        actorId: "actor",
        projectId: request.projectId,
        grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[request.branch]],
        spatialScopeRefs: [scope],
        sourceAccessGrantRefs: [],
        authorizationPolicyRef: { entityId: "policy", versionId: "1" },
        decidedAt: NOW,
        invocation: { kind: "human" },
      },
      contextRef: {
        kind: "authorization-context",
        reference: { entityId: "context", versionId: "1" },
      },
      redacted: false,
    };
  },
  verify: async () => {
    throw new Error("unused");
  },
});

const sourceBody = () => ({
  schemaVersion: "1",
  commandId: "command-1",
  idempotencyKey: "idempotency-1",
  issuedAt: NOW,
  requestedSpatialScopeRefs: [scope],
  requestedSourceVersionRefs: [],
  payload: {
    sourceConnectionRef: { entityId: "connection", versionId: "1" },
    deliveryKey: "delivery-1",
    sourceArtifactRef: {
      kind: "content-artifact" as const,
      reference: { entityId: "artifact", versionId: "1" },
    },
    metadataArtifactRef: {
      kind: "content-artifact" as const,
      reference: { entityId: "metadata", versionId: "1" },
    },
    occurredAt: NOW,
  },
});

const engineeringPort = (onApply: (command: unknown) => void): EngineeringDataPortV1 => ({
  apply: async (command) => {
    onApply(command);
    return {
      kind: "succeeded",
      result: {
        kind: "register-source-delivery",
        sourceDeliveryRef: {
          kind: "source-delivery",
          reference: { entityId: "delivery", versionId: "1" },
        },
        sourceVersionRef: {
          kind: "source-version",
          reference: { entityId: "source", versionId: "1" },
        },
      },
    };
  },
  freeze: async () => {
    throw new Error("unused");
  },
  read: async () => {
    throw new Error("unused");
  },
});

const warningResponsePort = (onRecord: (command: unknown) => void): WarningResponsePortV1 => ({
  open: async () => {
    throw new Error("unused");
  },
  recommend: async () => {
    throw new Error("unused");
  },
  record: async (command) => {
    onRecord(command);
    return {
      kind: "succeeded",
      result: {
        kind: "acknowledgement",
        status: "acknowledged",
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: "warning", versionId: "1" },
        },
        warningResponseTaskRef: {
          kind: "warning-response-task",
          reference: { entityId: "task", versionId: "1" },
        },
      },
    };
  },
});

const humanDecisionFeedbackPort = (
  onRecord: (command: HumanDecisionFeedbackCommandV1) => void,
): HumanDecisionFeedbackPortV1 => ({
  record: async (command) => {
    onRecord(command);
    return { kind: "succeeded", result: humanDecisionFeedbackResult(command) };
  },
});

const humanDecisionFeedbackResult = (
  command: HumanDecisionFeedbackCommandV1,
): WarningResponseRecordSuccessV1 => {
  switch (command.kind) {
    case "adopt-recommendation":
      return command.payload.decision === "declined"
        ? { kind: "decline", routeDecisionRef }
        : { kind: "adoption", routeDecisionRef, forecastRunRef };
    case "record-execution":
      return { kind: "execution", executionRecordRef };
    case "record-feedback":
      return { kind: "feedback", feedbackRef };
  }
};

const recommendationRef = {
  kind: "response-recommendation" as const,
  reference: { entityId: "recommendation", versionId: "1" },
};
const routeDecisionRef = {
  kind: "route-decision" as const,
  reference: { entityId: "decision", versionId: "1" },
};
const forecastRunRef = {
  kind: "workflow-run" as const,
  reference: { entityId: "run", versionId: "1" },
};
const executionRecordRef = {
  kind: "execution-record" as const,
  reference: { entityId: "execution", versionId: "1" },
};
const feedbackRef = {
  kind: "feedback" as const,
  reference: { entityId: "feedback", versionId: "1" },
};
const monitoringSnapshotRef = {
  kind: "monitoring-snapshot" as const,
  reference: { entityId: "monitoring", versionId: "1" },
};
const contentArtifactRef = {
  kind: "content-artifact" as const,
  reference: { entityId: "artifact", versionId: "1" },
};
const assessmentRecordRef = {
  kind: "risk-assessment-record" as const,
  reference: { entityId: "assessment", versionId: "1" },
};

const adoptPayload = {
  responseRecommendationRef: recommendationRef,
  decision: "adopted" as const,
  reasonCode: "reason-adopt",
  preActionMonitoringSnapshotRef: monitoringSnapshotRef,
};
const declinePayload = {
  responseRecommendationRef: recommendationRef,
  decision: "declined" as const,
  reasonCode: "reason-decline",
};
const executionPayload = {
  actionSource: {
    kind: "adopted-recommendation" as const,
    responseRecommendationRef: recommendationRef,
  },
  executedByActorId: "actor",
  recordedByActorId: "actor",
  occurredAt: NOW,
  evidenceReferences: [
    {
      locator: { sourceSegmentId: "segment" },
      sourceVersion: { entityId: "source", versionId: "1" },
    },
  ],
};
const feedbackPayload = {
  executionRecordRef,
  postActionMonitoringSnapshotRef: monitoringSnapshotRef,
  feedbackArtifactRef: contentArtifactRef,
  occurredAt: NOW,
  actualAssessmentRecordRef: assessmentRecordRef,
};

const humanDecisionBody = (commandId: string, payload: Record<string, unknown>) => ({
  schemaVersion: "1",
  commandId,
  idempotencyKey: `idempotency-${commandId}`,
  issuedAt: NOW,
  requestedSpatialScopeRefs: [scope],
  requestedSourceVersionRefs: [],
  payload,
});

const projectionPort = (onSubscribe: (request: unknown) => void): ProjectionPortV1 => ({
  query: async () => {
    throw new Error("unused");
  },
  subscribe: async (request) => {
    onSubscribe(request);
    return { kind: "succeeded", result: { eventRefs: [] } };
  },
  export: async () => {
    throw new Error("unused");
  },
});

const appFor = (ports: ApiPortsV1 = {}) =>
  buildApi({
    access: accessStub(),
    ports,
    publicOrigin: ORIGIN,
    now: () => new Date(NOW),
    idGenerator: () => "request-id",
  });

const jsonHeaders = { origin: ORIGIN, "content-type": "application/json" };

describe("C09 HTTP shell", () => {
  it("creates a secure opaque-cookie session without returning its token", async () => {
    const app = appFor();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/session/login",
      headers: jsonHeaders,
      payload: {
        schemaVersion: "1",
        loginAttemptId: "attempt-1",
        loginName: "operator",
        password: "secret",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("opaque-token");
    const cookie = response.headers["set-cookie"] as string;
    expect(cookie).toContain(`${HTTP_COOKIE_NAME_V1}=opaque-token`);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    await app.close();
  });

  it("emits only safe access fields and ignores logger failures", async () => {
    const entries: HttpAccessLogEntryV1[] = [];
    const app = buildApi({
      access: accessStub(),
      ports: { engineeringData: engineeringPort(() => undefined) },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
      accessLog: (entry) => {
        entries.push(entry);
        throw new Error("logger-secret");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery",
      headers: {
        ...jsonHeaders,
        "x-request-id": "access-request",
        cookie: `${HTTP_COOKIE_NAME_V1}=session-secret`,
      },
      payload: {
        ...sourceBody(),
        payload: { ...sourceBody().payload, deliveryKey: "payload-secret" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      route: "/api/v1/projects/:projectId/commands/engineering-data.register-source-delivery",
      requestId: "access-request",
      commandId: "command-1",
      projectId: "project",
      resultCategory: "succeeded",
      status: 200,
    });
    expect(entries[0]?.durationMs).toEqual(expect.any(Number));
    expect(entries[0]).not.toHaveProperty("payload");
    expect(entries[0]).not.toHaveProperty("stack");
    expect(JSON.stringify(entries[0])).not.toContain("session-secret");
    expect(JSON.stringify(entries[0])).not.toContain("payload-secret");
    await app.close();
  });

  it("rejects duplicate session cookies before authorization or port calls", async () => {
    let authorizeCalls = 0;
    let applyCalls = 0;
    const app = buildApi({
      access: accessStub(() => authorizeCalls++),
      ports: { engineeringData: engineeringPort(() => applyCalls++) },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery",
      headers: {
        ...jsonHeaders,
        cookie: `${HTTP_COOKIE_NAME_V1}=token-a; ${HTTP_COOKIE_NAME_V1}=token-b`,
      },
      payload: sourceBody(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CONTRACT_INVALID");
    expect(authorizeCalls).toBe(0);
    expect(applyCalls).toBe(0);
    await app.close();
  });

  it("rejects cross-origin and spoofed strict command input before authorize or port calls", async () => {
    let authorizeCalls = 0;
    let applyCalls = 0;
    const ports = { engineeringData: engineeringPort(() => applyCalls++) } satisfies ApiPortsV1;
    const app = buildApi({
      access: accessStub(() => authorizeCalls++),
      ports,
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const spoofed = { ...sourceBody(), actorId: "attacker" };

    const originRejected = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery",
      headers: {
        ...jsonHeaders,
        origin: "https://attacker.example",
        cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token`,
      },
      payload: sourceBody(),
    });
    const fieldRejected = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery",
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: spoofed,
    });
    const queryRejected = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery?sessionToken=attacker",
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: sourceBody(),
    });

    expect(originRejected.statusCode).toBe(400);
    expect(fieldRejected.statusCode).toBe(400);
    expect(queryRejected.statusCode).toBe(400);
    expect(authorizeCalls).toBe(0);
    expect(applyCalls).toBe(0);
    await app.close();
  });

  it("assembles server-owned command identity and calls the single public port", async () => {
    let seen: Record<string, unknown> | undefined;
    const app = appFor({
      engineeringData: engineeringPort((command) => {
        seen = command as Record<string, unknown>;
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery",
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: { ...sourceBody(), requestedSpatialScopeRefs: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(seen?.projectId).toBe("project");
    expect(seen?.actorId).toBe("actor");
    expect((seen?.authorization as { grantedCapabilities: string[] }).grantedCapabilities).toEqual([
      "engineering-data.write",
    ]);
    expect(response.json().kind).toBe("succeeded");
    await app.close();
  });

  it("keeps runtime and generated OpenAPI route sets aligned", async () => {
    const app = appFor({ engineeringData: engineeringPort(() => undefined) });
    const response = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const document = response.json() as { paths: Record<string, unknown> };
    const expected = new Set(
      [
        ...HTTP_SYSTEM_ROUTE_CATALOG_V1.filter((entry) => entry.kind !== "sse"),
        ...HTTP_ROUTE_CATALOG_V1.filter((entry) => entry.portKey === "engineeringData"),
      ].map((entry) => entry.path.replaceAll(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}")),
    );
    expect(new Set(Object.keys(document.paths))).toEqual(expected);
    const logout = document.paths["/api/v1/session/logout"] as {
      post: { responses: Record<string, unknown> };
    };
    expect(Object.keys(logout.post.responses)).toContain("204");
    expect(Object.keys(logout.post.responses)).not.toContain("200");
    await app.close();
  });

  it("documents the standard SSE resume header", async () => {
    const app = appFor({ projection: projectionPort(() => undefined) });
    const response = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const document = response.json() as {
      paths: Record<string, { get: { parameters: Array<{ name: string; in: string }> } }>;
    };
    const parameters =
      document.paths["/api/v1/projects/{projectId}/runs/{runId}/events"]?.get.parameters ?? [];
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "Last-Event-ID", in: "header" }),
    );
    await app.close();
  });

  it("round-trips only canonical URL-safe workflow run references", () => {
    const reference = {
      kind: "workflow-run" as const,
      reference: { entityId: "run:变径@一", versionId: "version:2" },
    };
    const encoded = encodeWorkflowRunIdV1(reference);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeWorkflowRunIdV1(encoded)).toEqual(reference);
    expect(() => decodeWorkflowRunIdV1(`${encoded}=`)).toThrow();
    expect(() =>
      decodeWorkflowRunIdV1(
        Buffer.from(JSON.stringify({ versionId: "version:2", entityId: "run:变径@一" })).toString(
          "base64url",
        ),
      ),
    ).toThrow();
  });

  it("passes the exact workflow run reference and durable cursor to ProjectionPortV1", async () => {
    const workflowRunRef = {
      kind: "workflow-run" as const,
      reference: { entityId: "run:变径@一", versionId: "version:2" },
    };
    let seen: Record<string, unknown> | undefined;
    const app = buildApi({
      access: accessStub(),
      ports: {
        projection: projectionPort((request) => {
          seen = request as Record<string, unknown>;
        }),
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
      ssePolicy: {
        pollIntervalMs: 1,
        heartbeatIntervalMs: 50,
        batchSize: 1,
        maxConnectionMs: 5,
        maxBufferedBytes: 1_024,
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/project/runs/${encodeWorkflowRunIdV1(workflowRunRef)}/events`,
      headers: {
        cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token`,
        "last-event-id": "event:0",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toMatchObject({
      projectId: "project",
      kind: "subscribe",
      payload: { workflowRunRef, afterEventId: "event:0" },
    });
    await app.close();
  });

  it("rejects an invalid SSE resume header before authorization or subscription", async () => {
    let authorizeCalls = 0;
    let subscribeCalls = 0;
    const app = buildApi({
      access: accessStub(() => authorizeCalls++),
      ports: { projection: projectionPort(() => subscribeCalls++) },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const invalidRun = await app.inject({
      method: "GET",
      url: "/api/v1/projects/project/runs/run@1/events",
      headers: { cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/project/runs/${encodeWorkflowRunIdV1({
        kind: "workflow-run",
        reference: { entityId: "run", versionId: "1" },
      })}/events`,
      headers: {
        cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token`,
        "last-event-id": "   ",
      },
    });

    expect(invalidRun.statusCode).toBe(400);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CONTRACT_INVALID");
    expect(authorizeCalls).toBe(0);
    expect(subscribeCalls).toBe(0);
    await app.close();
  });

  it("normalizes an unusable request id before building the safe error envelope", async () => {
    const app = appFor();
    const response = await app.inject({
      method: "GET",
      url: "/missing",
      headers: { "x-request-id": "   " },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NOT_FOUND", requestId: "request-id" });
    expect(response.json()).not.toHaveProperty("message");
    await app.close();
  });

  it("maps an invalid downstream result to a safe terminal error", () => {
    const result = mapModuleResult({
      result: { kind: "succeeded", result: { leaked: "secret" } },
      resultSchema: HTTP_ROUTE_CATALOG_V1[0]!.resultSchema,
      requestId: "request-id",
      now: new Date(NOW),
    });
    expect("status" in result && result.status).toBe(500);
    expect("status" in result && result.error.code).toBe("TERMINAL_FAILURE");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects malformed JSON before invoking access", async () => {
    let authorizeCalls = 0;
    const app = buildApi({
      access: accessStub(() => authorizeCalls++),
      ports: { engineeringData: engineeringPort(() => undefined) },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/engineering-data.register-source-delivery",
      headers: jsonHeaders,
      payload: '{"schemaVersion":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CONTRACT_INVALID");
    expect(authorizeCalls).toBe(0);
    await app.close();
  });

  it("routes warning acknowledgement through the single public port and closed catalog", async () => {
    const authorizedBranches: string[] = [];
    const recorded: Record<string, unknown>[] = [];
    const app = buildApi({
      access: accessStub((branch) => authorizedBranches.push(branch)),
      ports: {
        warningResponse: warningResponsePort((command) => {
          recorded.push(command as Record<string, unknown>);
        }),
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const body = {
      schemaVersion: "1",
      commandId: "command-ack",
      idempotencyKey: "idempotency-ack",
      issuedAt: NOW,
      requestedSpatialScopeRefs: [scope],
      requestedSourceVersionRefs: [],
      payload: {
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: "warning", versionId: "1" },
        },
        warningResponseTaskRef: {
          kind: "warning-response-task",
          reference: { entityId: "task", versionId: "1" },
        },
      },
    };
    const url = "/api/v1/projects/project/commands/warning-response.acknowledge";

    const response = await app.inject({
      method: "POST",
      url,
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(authorizedBranches).toEqual(["warning-response.acknowledge"]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      kind: "acknowledge",
      commandId: "command-ack",
      idempotencyKey: "idempotency-ack",
      projectId: "project",
      actorId: "actor",
      payload: body.payload,
    });
    expect(recorded[0]?.authorization).toMatchObject({
      projectId: "project",
      actorId: "actor",
      grantedCapabilities: ["warning-response.record"],
    });
    expect(response.json()).toEqual({
      kind: "succeeded",
      result: {
        kind: "acknowledgement",
        status: "acknowledged",
        warningRecordRef: body.payload.warningRecordRef,
        warningResponseTaskRef: body.payload.warningResponseTaskRef,
      },
    });

    const retried = await app.inject({
      method: "POST",
      url,
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: body,
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toEqual(response.json());
    expect(recorded).toHaveLength(2);

    for (const invalid of [
      { ...body, actorId: "attacker" },
      { ...body, authorization: {} },
      { ...body, payload: { ...body.payload, riskResolved: true } },
      { ...body, payload: { ...body.payload, taskClosed: true } },
      { ...body, payload: { warningRecordRef: body.payload.warningRecordRef } },
    ]) {
      const rejected = await app.inject({
        method: "POST",
        url,
        headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
        payload: invalid,
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().code).toBe("CONTRACT_INVALID");
    }
    expect(authorizedBranches).toEqual([
      "warning-response.acknowledge",
      "warning-response.acknowledge",
    ]);
    expect(recorded).toHaveLength(2);

    const catalogEntries = HTTP_ROUTE_CATALOG_V1.filter(
      (entry) => entry.branch === "warning-response.acknowledge",
    );
    expect(catalogEntries).toHaveLength(1);
    expect(catalogEntries[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/projects/:projectId/commands/warning-response.acknowledge",
      domainKind: "acknowledge",
      portKey: "warningResponse",
      requiredCapability: "warning-response.record",
    });
    const openapi = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const document = openapi.json() as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain(
      "/api/v1/projects/{projectId}/commands/warning-response.acknowledge",
    );
    await app.close();
  });

  it("forwards the human decision and feedback branches to the injected C41 port", async () => {
    const authorizedBranches: string[] = [];
    const humanCommands: HumanDecisionFeedbackCommandV1[] = [];
    const legacyCommands: unknown[] = [];
    const app = buildApi({
      access: accessStub((branch) => authorizedBranches.push(branch)),
      ports: {
        humanDecisionFeedback: humanDecisionFeedbackPort((command) => humanCommands.push(command)),
        warningResponse: warningResponsePort((command) => legacyCommands.push(command)),
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const send = (branch: string, commandId: string, payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/v1/projects/project/commands/${branch}`,
        headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
        payload: humanDecisionBody(commandId, payload),
      });

    const adopted = await send(
      "warning-response.adopt-recommendation",
      "command-adopt",
      adoptPayload,
    );
    expect(adopted.statusCode).toBe(200);
    expect(adopted.json()).toEqual({
      kind: "succeeded",
      result: { kind: "adoption", routeDecisionRef, forecastRunRef },
    });

    const declined = await send(
      "warning-response.adopt-recommendation",
      "command-decline",
      declinePayload,
    );
    expect(declined.statusCode).toBe(200);
    expect(declined.json()).toEqual({
      kind: "succeeded",
      result: { kind: "decline", routeDecisionRef },
    });

    const executed = await send(
      "warning-response.record-execution",
      "command-execution",
      executionPayload,
    );
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toEqual({
      kind: "succeeded",
      result: { kind: "execution", executionRecordRef },
    });

    const fedBack = await send(
      "warning-response.record-feedback",
      "command-feedback",
      feedbackPayload,
    );
    expect(fedBack.statusCode).toBe(200);
    expect(fedBack.json()).toEqual({
      kind: "succeeded",
      result: { kind: "feedback", feedbackRef },
    });

    // HTTP 层不缓存也不改写命令身份：同键同载荷重试转发完全相同的命令。
    const retried = await send(
      "warning-response.record-execution",
      "command-execution",
      executionPayload,
    );
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toEqual(executed.json());

    expect(humanCommands.map((command) => [command.kind, command.commandId])).toEqual([
      ["adopt-recommendation", "command-adopt"],
      ["adopt-recommendation", "command-decline"],
      ["record-execution", "command-execution"],
      ["record-feedback", "command-feedback"],
      ["record-execution", "command-execution"],
    ]);
    expect(humanCommands[4]).toEqual(humanCommands[2]);
    // 可选精确选择器原样经 strict 传输层到达 C41 端口，既未被丢弃也未被服务端补齐。
    expect(humanCommands[0]?.payload).toEqual(adoptPayload);
    expect(humanCommands[3]?.payload).toEqual(feedbackPayload);
    expect(humanCommands[0]).toMatchObject({ projectId: "project", actorId: "actor" });
    expect(humanCommands[0]?.authorization).toMatchObject({
      grantedCapabilities: ["warning-response.record"],
    });
    expect(legacyCommands).toHaveLength(0);
    expect(authorizedBranches).toEqual([
      "warning-response.adopt-recommendation",
      "warning-response.adopt-recommendation",
      "warning-response.record-execution",
      "warning-response.record-feedback",
      "warning-response.record-execution",
    ]);
    await app.close();
  });

  it("keeps the other record branches on the original port and each set unavailable without its port", async () => {
    const legacyAuthorized: string[] = [];
    const legacyRecorded: unknown[] = [];
    const legacyOnly = buildApi({
      access: accessStub((branch) => legacyAuthorized.push(branch)),
      ports: { warningResponse: warningResponsePort((command) => legacyRecorded.push(command)) },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const acknowledgement = await legacyOnly.inject({
      method: "POST",
      url: "/api/v1/projects/project/commands/warning-response.acknowledge",
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: humanDecisionBody("command-ack", {
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: "warning", versionId: "1" },
        },
        warningResponseTaskRef: {
          kind: "warning-response-task",
          reference: { entityId: "task", versionId: "1" },
        },
      }),
    });
    expect(acknowledgement.statusCode).toBe(200);
    expect(legacyRecorded).toHaveLength(1);

    for (const [branch, commandId, payload] of [
      ["warning-response.adopt-recommendation", "command-adopt", adoptPayload],
      ["warning-response.record-execution", "command-execution", executionPayload],
      ["warning-response.record-feedback", "command-feedback", feedbackPayload],
    ] as const) {
      const unavailable = await legacyOnly.inject({
        method: "POST",
        url: `/api/v1/projects/project/commands/${branch}`,
        headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
        payload: humanDecisionBody(commandId, payload),
      });
      expect(unavailable.statusCode).toBe(404);
      expect(unavailable.json().code).toBe("NOT_FOUND");
    }
    expect(legacyAuthorized).toEqual(["warning-response.acknowledge"]);
    expect(legacyRecorded).toHaveLength(1);
    await legacyOnly.close();

    const humanAuthorized: string[] = [];
    const humanRecorded: HumanDecisionFeedbackCommandV1[] = [];
    const humanOnly = buildApi({
      access: accessStub((branch) => humanAuthorized.push(branch)),
      ports: {
        humanDecisionFeedback: humanDecisionFeedbackPort((command) => humanRecorded.push(command)),
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    // 未注入端口时这些路由根本未注册：请求不进入 strict 解析、也不发生授权，故载荷内容与结果无关。
    for (const [branch, commandId, payload] of [
      ["warning-response.acknowledge", "command-ack", { warningRecordRef: {} }],
      ["warning-response.calculate-deviation", "command-deviation", {}],
      ["warning-response.create-calibration-suggestion", "command-calibration", {}],
    ] as const) {
      const unavailable = await humanOnly.inject({
        method: "POST",
        url: `/api/v1/projects/project/commands/${branch}`,
        headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
        payload: humanDecisionBody(commandId, payload),
      });
      expect(unavailable.statusCode).toBe(404);
      expect(unavailable.json().code).toBe("NOT_FOUND");
    }
    expect(humanAuthorized).toEqual([]);
    expect(humanRecorded).toHaveLength(0);
    // 路由拆分不改变路径、分支、能力值，只改变承载端口。
    const recordBranches = [
      "warning-response.acknowledge",
      "warning-response.calculate-deviation",
      "warning-response.create-calibration-suggestion",
      "warning-response.adopt-recommendation",
      "warning-response.record-execution",
      "warning-response.record-feedback",
    ];
    const catalog = HTTP_ROUTE_CATALOG_V1.filter((entry) => recordBranches.includes(entry.branch));
    expect(catalog).toHaveLength(6);
    expect(
      catalog.map((entry) => [
        entry.branch,
        entry.domainKind,
        entry.portKey,
        entry.requiredCapability,
      ]),
    ).toEqual([
      ["warning-response.acknowledge", "acknowledge", "warningResponse", "warning-response.record"],
      [
        "warning-response.calculate-deviation",
        "calculate-deviation",
        "warningResponse",
        "warning-response.record",
      ],
      [
        "warning-response.create-calibration-suggestion",
        "create-calibration-suggestion",
        "warningResponse",
        "warning-response.record",
      ],
      [
        "warning-response.adopt-recommendation",
        "adopt-recommendation",
        "humanDecisionFeedback",
        "warning-response.record",
      ],
      [
        "warning-response.record-execution",
        "record-execution",
        "humanDecisionFeedback",
        "warning-response.record",
      ],
      [
        "warning-response.record-feedback",
        "record-feedback",
        "humanDecisionFeedback",
        "warning-response.record",
      ],
    ]);
    await humanOnly.close();
  });

  it("keeps server-side capability and strict payload checks on the human decision routes", async () => {
    const baseAccess = accessStub();
    const restrictedAccess: LocalIdentityAccessV1 = {
      ...baseAccess,
      authorize: async (request) => {
        const decision = await baseAccess.authorize(request);
        return {
          ...decision,
          context: { ...decision.context, grantedCapabilities: ["projection.query"] },
        };
      },
    };
    const humanCommands: HumanDecisionFeedbackCommandV1[] = [];
    const app = buildApi({
      access: restrictedAccess,
      ports: {
        humanDecisionFeedback: humanDecisionFeedbackPort((command) => humanCommands.push(command)),
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const invoke = (branch: string, commandId: string, payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/v1/projects/project/commands/${branch}`,
        headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
        payload: humanDecisionBody(commandId, payload),
      });

    const unauthorized = await invoke(
      "warning-response.adopt-recommendation",
      "command-adopt",
      adoptPayload,
    );
    expect(unauthorized.statusCode).toBe(404);
    expect(unauthorized.json().code).toBe("NOT_FOUND");

    const binding = await invoke("warning-response.record-feedback", "command-feedback", {
      ...feedbackPayload,
      binding: { forecastRunRef },
    });
    expect(binding.statusCode).toBe(400);
    expect(binding.json().code).toBe("CONTRACT_INVALID");

    const forgedRun = await invoke("warning-response.adopt-recommendation", "command-adopt", {
      ...adoptPayload,
      forecastRunRef,
    });
    expect(forgedRun.statusCode).toBe(400);
    expect(forgedRun.json().code).toBe("CONTRACT_INVALID");

    expect(humanCommands).toHaveLength(0);
    await app.close();
  });
});

describe("C32 read surface routes", () => {
  const queryBody = (payload: Record<string, unknown>) => ({
    schemaVersion: "1",
    queryId: "query-1",
    requestedAt: NOW,
    requestedSpatialScopeRefs: [scope],
    requestedSourceVersionRefs: [],
    payload,
  });
  const postQuery = (
    app: ReturnType<typeof buildApi>,
    branch: string,
    payload: Record<string, unknown>,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/projects/project/queries/${branch}`,
      headers: { ...jsonHeaders, cookie: `${HTTP_COOKIE_NAME_V1}=opaque-token` },
      payload: queryBody(payload),
    });

  it("routes the four engineering-data catalog branches to the catalog port", async () => {
    const seen: { kind?: string; projectId?: string; actorId?: string }[] = [];
    const authorizedBranches: string[] = [];
    const app = buildApi({
      access: accessStub((branch) => authorizedBranches.push(branch)),
      ports: {
        engineeringDataCatalog: {
          read: async (query) => {
            seen.push(query);
            return {
              kind: "succeeded",
              result: {
                kind: "context-read",
                projectId: query.projectId,
                contextStatus: "active",
                missingApplicabilityDimensions: [],
                spatialScopes: [],
              },
            };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });

    const response = await postQuery(app, "engineering-data.context-read", {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: "succeeded",
      result: { kind: "context-read", contextStatus: "active" },
    });
    expect(authorizedBranches).toEqual(["engineering-data.context-read"]);
    expect(seen[0]).toMatchObject({
      kind: "context-read",
      projectId: "project",
      actorId: "actor",
      queryId: "query-1",
    });
    await app.close();
  });

  it("routes governance-read, retrieval-result and result-read to their ports", async () => {
    const seen: Record<string, unknown>[] = [];
    const app = buildApi({
      access: accessStub(),
      ports: {
        knowledgeGovernanceRead: {
          read: async (query) => {
            seen.push({ port: "governance", kind: query.kind, payload: query.payload });
            return {
              kind: "succeeded",
              result: { kind: "list-definitions", items: [], totalCount: 0 },
            };
          },
        },
        knowledgeRetrievalRead: {
          read: async (query) => {
            seen.push({ port: "retrieval", kind: query.kind });
            return {
              kind: "succeeded",
              result: {
                kind: "hybrid-evidence",
                knowledgeQueryResultRef: query.payload.knowledgeQueryResultRef,
                policyRef: { entityId: "policy", versionId: "1" },
                generationRef: {
                  kind: "retrieval-generation",
                  reference: { entityId: "generation", versionId: "1" },
                },
                topK: 4,
                hits: [],
              },
            };
          },
        },
        projectionResultRead: {
          readPage: async (request) => {
            seen.push({ port: "projection", limit: request.limit });
            return { kind: "page", queryType: "run-view", items: [] };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const knowledgeQueryResultRef = {
      kind: "knowledge-query-result",
      reference: {
        entityId: "retrieval-query-result:project:q-1",
        versionId: "a".repeat(64),
      },
    };

    const governance = await postQuery(app, "knowledge-modeling.governance-read", {
      operation: "list-definitions",
      definitionType: "risk-mechanism",
    });
    expect(governance.statusCode).toBe(200);
    expect(governance.json()).toMatchObject({
      kind: "succeeded",
      result: { kind: "list-definitions", totalCount: 0 },
    });

    const retrieval = await postQuery(app, "knowledge-modeling.retrieval-result", {
      knowledgeQueryResultRef,
    });
    expect(retrieval.statusCode).toBe(200);
    expect(retrieval.json()).toMatchObject({
      kind: "succeeded",
      result: { kind: "hybrid-evidence", topK: 4 },
    });

    const projection = await postQuery(app, "projection.result-read", {
      queryResultRef: {
        kind: "query-result",
        reference: { entityId: "query-result-1", versionId: "1" },
      },
    });
    expect(projection.statusCode).toBe(200);
    expect(projection.json()).toMatchObject({
      kind: "succeeded",
      result: { kind: "page", queryType: "run-view" },
    });
    // readPage 的 limit 缺省由传输层补齐，游标未提供时不落到端口请求。
    expect(seen[2]).toMatchObject({ port: "projection", limit: 50 });
    expect(seen.map((entry) => entry.port)).toEqual(["governance", "retrieval", "projection"]);
    await app.close();
  });

  it("maps a failed projection readPage outcome to the failure envelope", async () => {
    const app = buildApi({
      access: accessStub(),
      ports: {
        projectionResultRead: {
          readPage: async () => ({
            kind: "failed",
            error: {
              code: "AUTHORIZATION_DENIED",
              category: "authorization",
              retryable: false,
              requiredCapability: "projection.query",
              authorizationPolicyRef: { entityId: "policy", versionId: "1" },
              stageCode: "projection.result-read",
              occurredAt: NOW,
              causalRunId: "query-1",
            },
          }),
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await postQuery(app, "projection.result-read", {
      queryResultRef: {
        kind: "query-result",
        reference: { entityId: "query-result-1", versionId: "1" },
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("keeps the read-surface branches inactive and strict when the ports are absent", async () => {
    const app = appFor();
    for (const branch of [
      "engineering-data.context-read",
      "engineering-data.source-catalog",
      "engineering-data.monitoring-catalog",
      "engineering-data.read-result",
      "knowledge-modeling.governance-read",
      "knowledge-modeling.retrieval-result",
      "projection.result-read",
    ]) {
      const response = await postQuery(app, branch, {});
      expect(response.statusCode).toBe(404);
    }

    const active = buildApi({
      access: accessStub(),
      ports: {
        engineeringDataCatalog: {
          read: async () => {
            throw new Error("should not be reached");
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    // 契约外字段在 transport 严格信封处即被拒绝，不进入端口。
    const invalid = await postQuery(active, "engineering-data.context-read", { leaked: true });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("CONTRACT_INVALID");
    await app.close();
    await active.close();
  });
});
