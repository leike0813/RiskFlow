import { describe, expect, it, vi } from "vitest";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import {
  C37_SYSTEM_OPERATION_IDS_V1,
  createC09SystemOperation,
  isC37SystemOperationIdV1,
  C09HttpError,
  createC09Client,
  createCommandOperation,
  decodeSessionMetadata,
  makeSafeHttpError,
  type C09Fetch,
} from "../src/api/http.js";
import {
  deriveOpenApiAvailability,
  intersectOperationAvailability,
  normalizeOpenApiPath,
} from "../src/api/openapi.js";
import {
  prepareCreateSystemAccount,
  sendAdministrationCommand,
} from "../src/api/agentAuditOperations.js";

const NOW = "2026-01-01T00:00:00.000Z";
const resultRef: ContractReferenceV1 = {
  kind: "source-delivery",
  reference: { entityId: "delivery-1", versionId: "v1" },
};

const command = createCommandOperation<
  {
    projectId: string;
    requestedSpatialScopeRefs: readonly [];
    requestedSourceVersionRefs: readonly [];
    commandId: string;
    idempotencyKey: string;
    issuedAt: string;
    payload: { value: number };
  },
  ContractReferenceV1
>({
  operationId: "test.register-source",
  branch: "engineering-data.register-source-delivery",
  encode: (request) => ({ schemaVersion: "1", ...request }),
  decode: (response) => response as ContractReferenceV1,
});

const sessionMetadata = {
  schemaVersion: "1",
  sessionRef: { entityId: "session-1", versionId: "v1" },
  accountRef: { entityId: "account-1", versionId: "v1" },
  passwordChangeRequired: false,
  restricted: false,
  expiresAt: NOW,
};

describe("C10 C09 HTTP 与 OpenAPI 边界", () => {
  it("管理命令重试发送完全相同的冻结信封，包括 issuedAt", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      bodies.push(init?.body);
      return new Response(
        JSON.stringify({
          kind: "succeeded",
          result: { resultRef: { entityId: "account-new", versionId: "1" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const request = prepareCreateSystemAccount({
        loginName: "new-account",
        displayName: "新账号",
        password: "Riskflow-Test-2030!",
      });
      await sendAdministrationCommand(request);
      await sendAdministrationCommand(request);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(JSON.parse(String(bodies[0])).issuedAt).toBe(request.issuedAt);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("derives only safe method/path availability and intersects registered operations", () => {
    const availability = deriveOpenApiAvailability({
      openapi: "3.1.0",
      paths: {
        "/api/v1/projects/{projectId}/commands/engineering-data.register-source-delivery": {
          post: {},
        },
        "/api/v1/projects/{projectId}/commands/other": { post: {} },
        "/api/v1/projects/{projectId}/commands/{branch}": { post: {} },
        "/api/v1/projects/{projectId}/commands/unsafe?url=1": { post: {} },
        "https://outside.example/anything": { post: {} },
      },
    });
    expect(normalizeOpenApiPath("/api/v1/projects/{projectId}/commands/x")).toBe(
      "/api/v1/projects/:projectId/commands/x",
    );
    expect(normalizeOpenApiPath("https://outside.example/x")).toBeUndefined();
    expect(availability.routes).toEqual([
      {
        method: "POST",
        normalizedPath:
          "/api/v1/projects/:projectId/commands/engineering-data.register-source-delivery",
      },
      { method: "POST", normalizedPath: "/api/v1/projects/:projectId/commands/other" },
      { method: "POST", normalizedPath: "/api/v1/projects/:projectId/commands/:branch" },
    ]);
    expect(intersectOperationAvailability([command], availability)).toEqual([command]);
    expect(
      intersectOperationAvailability(
        [
          {
            ...command,
            path: "/api/v1/projects/:projectId/commands/missing",
          },
        ],
        availability,
      ),
    ).toEqual([]);
  });

  it("uses same-origin JSON requests and never exposes a token or arbitrary URL", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetcher: C09Fetch = async (input, init) => {
      calls.push({ input, init });
      const path = String(input);
      if (path === "/api/v1/session/login")
        return new Response(JSON.stringify(sessionMetadata), { status: 200 });
      return new Response(JSON.stringify(resultRef), { status: 202 });
    };
    const client = createC09Client({ fetcher, operations: [command] });
    const signal = new AbortController().signal;
    await client.login(
      { loginAttemptId: "attempt-1", loginName: "operator", password: "secret" },
      signal,
    );
    const response = await client.submit(
      command,
      {
        projectId: "project-1",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        commandId: "command-1",
        idempotencyKey: "idempotency-1",
        issuedAt: NOW,
        payload: { value: 1 },
      },
      signal,
    );
    expect(response.kind).toBe("waiting");
    expect(calls.map((call) => String(call.input))).toEqual([
      "/api/v1/session/login",
      "/api/v1/projects/project-1/commands/engineering-data.register-source-delivery",
    ]);
    const loginBody = JSON.parse(String(calls[0]?.init?.body));
    expect(loginBody).toMatchObject({ loginAttemptId: "attempt-1", loginName: "operator" });
    expect(loginBody).not.toHaveProperty("authorization");
    expect(loginBody).not.toHaveProperty("token");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.signal).toBe(signal);
    const requestHeaders = new Headers(calls[1]?.init?.headers);
    expect(requestHeaders.get("content-type")).toBe("application/json");
    expect(requestHeaders.get("authorization")).toBeNull();
    const projectBody = JSON.parse(String(calls[1]?.init?.body));
    expect(projectBody).not.toHaveProperty("projectId");
    expect(projectBody).toMatchObject({
      schemaVersion: "1",
      commandId: "command-1",
      idempotencyKey: "idempotency-1",
    });

    const beforeUnknown = calls.length;
    const unknown = createCommandOperation<{ projectId: string }, ContractReferenceV1>({
      operationId: "test.unknown",
      branch: "engineering-data.register-monitoring-batch",
      encode: (request) => request,
      decode: (response) => response as ContractReferenceV1,
    });
    await expect(client.submit(unknown, { projectId: "project-1" }, signal)).rejects.toBeInstanceOf(
      C09HttpError,
    );
    expect(calls).toHaveLength(beforeUnknown);
    await expect(
      client.submit(
        command,
        {
          projectId: "project/unsafe",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          commandId: "command-1",
          idempotencyKey: "idempotency-1",
          issuedAt: NOW,
          payload: { value: 1 },
        },
        signal,
      ),
    ).rejects.toBeInstanceOf(C09HttpError);
    expect(calls).toHaveLength(beforeUnknown);
  });

  it("introspects the current session over GET without a body or client-held identity", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const client = createC09Client({
      fetcher: async (input, init) => {
        calls.push({ input, init });
        if (String(input) === "/api/v1/session")
          return new Response(JSON.stringify(sessionMetadata), { status: 200 });
        return new Response(JSON.stringify({}), { status: 401 });
      },
    });
    const signal = new AbortController().signal;
    const metadata = await client.introspectSession(signal);

    expect(metadata).toEqual(sessionMetadata);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(String(call.input)).toBe("/api/v1/session");
    expect(call.init?.method).toBe("GET");
    // 自省没有请求体：身份只来自同源安全 Cookie，客户端不持也不发任何会话凭证。
    expect(call.init?.body).toBeUndefined();
    expect(call.init?.credentials).toBe("same-origin");
    expect(call.init?.cache).toBe("no-store");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBeNull();

    const anonymous = createC09Client({ fetcher: async () => new Response("", { status: 401 }) });
    await expect(anonymous.introspectSession(signal)).rejects.toBeInstanceOf(C09HttpError);
  });

  it.each([
    ["Date.parse shorthand", { expiresAt: "1" }],
    ["out-of-range calendar date", { expiresAt: "2030-02-30T00:00:00.000Z" }],
    ["unexpected token field", { sessionToken: "must-not-be-accepted" }],
  ])("rejects malformed session metadata: %s", (_case, patch) => {
    expect(() => decodeSessionMetadata({ ...sessionMetadata, ...patch })).toThrow();
  });

  it("reads the current project access presentation over GET without client-declared identity", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const client = createC09Client({
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(
          JSON.stringify({
            schemaVersion: "1",
            projectId: "project-1",
            capabilities: ["projection.query", "review-todo.read"],
            authorizationPolicyRef: { entityId: "access-policy", versionId: "v2" },
          }),
          { status: 200 },
        );
      },
    });
    const signal = new AbortController().signal;
    const presentation = await client.readProjectAccessPresentation("project-1", signal);

    expect(presentation.projectId).toBe("project-1");
    expect(presentation.capabilities).toEqual(["projection.query", "review-todo.read"]);
    const call = calls[0]!;
    expect(String(call.input)).toBe("/api/v1/projects/project-1/access");
    expect(call.init?.method).toBe("GET");
    // 无请求体、无 Authorization：客户端不能借这条读面声明 actor、角色或能力。
    expect(call.init?.body).toBeUndefined();
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(call.init?.credentials).toBe("same-origin");
  });

  it("入口能力读面：路径不可注入、响应形状漂移与不可用都不伪造成空能力", async () => {
    const signal = new AbortController().signal;
    const client = createC09Client({
      fetcher: async () => new Response("", { status: 404 }),
    });
    // 服务端未注入该接缝时按统一未找到失败，而不是返回空集合。
    await expect(client.readProjectAccessPresentation("project-1", signal)).rejects.toBeInstanceOf(
      C09HttpError,
    );

    // 工程标识不能带路径分隔符：专用方法不是通用 URL 查询器。
    await expect(
      client.readProjectAccessPresentation("project-1/../../admin", signal),
    ).rejects.toBeInstanceOf(C09HttpError);

    const drifted = createC09Client({
      fetcher: async () =>
        new Response(
          JSON.stringify({
            schemaVersion: "1",
            projectId: "project-1",
            capabilities: ["review-todo.read"],
            authorizationPolicyRef: { entityId: "access-policy", versionId: "v2" },
            roles: ["reviewer"],
          }),
          { status: 200 },
        ),
    });
    await expect(drifted.readProjectAccessPresentation("project-1", signal)).rejects.toBeInstanceOf(
      C09HttpError,
    );
  });

  it("reduces malformed and public C09 errors to safe stable fields", async () => {
    const safe = makeSafeHttpError({
      requestId: "request-1",
      code: "TRANSIENT_FAILURE",
      retryable: true,
      occurredAt: NOW,
      references: [resultRef],
    });
    const client = createC09Client({
      fetcher: async () =>
        new Response(JSON.stringify({ ...safe, message: "database password", stack: "secret" }), {
          status: 503,
          headers: { "x-request-id": "header-request" },
        }),
      operations: [command],
    });
    let error: C09HttpError | undefined;
    try {
      await client.submit(
        command,
        {
          projectId: "project-1",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          commandId: "command-1",
          idempotencyKey: "idempotency-1",
          issuedAt: NOW,
          payload: { value: 1 },
        },
        new AbortController().signal,
      );
    } catch (caught) {
      if (caught instanceof C09HttpError) error = caught;
    }
    expect(error?.error).toMatchObject({
      code: "TRANSIENT_FAILURE",
      retryable: true,
      requestId: "request-1",
    });
    expect(error?.error).not.toHaveProperty("message");
    expect(error?.error).not.toHaveProperty("stack");
    expect(error?.message).toBe("TRANSIENT_FAILURE");
  });
});

describe("C37 闭合 system operation", () => {
  it("四条系统操作固定路径，不经过工程模板", () => {
    expect([...C37_SYSTEM_OPERATION_IDS_V1]).toEqual([
      "administration.read",
      "administration.query",
      "administration.command",
      "operations.query",
    ]);
    expect(
      createC09SystemOperation({
        operationId: "administration.read",
        mode: "query",
        method: "GET",
        encode: (input) => input,
        decode: (response) => response,
      }).path,
    ).toBe("/api/v1/administration");
    expect(
      createC09SystemOperation({
        operationId: "operations.query",
        mode: "query",
        method: "POST",
        encode: (input) => input,
        decode: (response) => response,
      }).path,
    ).toBe("/api/v1/operations/queries");
  });

  it("目录外的 id 一律拒绝，不提供任意 URL 方法", () => {
    expect(isC37SystemOperationIdV1("administration.read")).toBe(true);
    expect(isC37SystemOperationIdV1("administration.delete")).toBe(false);
    expect(isC37SystemOperationIdV1("https://evil.example/steal")).toBe(false);
  });

  it("系统操作一律要求会话", () => {
    expect(
      createC09SystemOperation({
        operationId: "administration.command",
        mode: "command",
        method: "POST",
        encode: (input) => input,
        decode: (response) => response,
      }).requiresSession,
    ).toBe(true);
  });
});
