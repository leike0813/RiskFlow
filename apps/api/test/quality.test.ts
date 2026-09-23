/** 合成夹具：本文件所有工程、身份与查询结果均为测试用合成数据。 */
import { describe, expect, it } from "vitest";

import {
  MODULE_BRANCH_CAPABILITY_V1,
  type ProjectionQuerySuccessV1,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";

import {
  HTTP_COOKIE_NAME_V1,
  buildApi,
  type ApiPortsV1,
  type HttpAccessLogEntryV1,
} from "../src/index.js";

const NOW = "2026-01-01T00:00:00.000Z";
const ORIGIN = "https://ui.example";
const PROJECT_ID = "quality-project";

const session = (token: string) => ({
  sessionRef: { entityId: "session", versionId: "1" },
  accountRef: { entityId: "account", versionId: "1" },
  sessionToken: token,
  passwordChangeRequired: false,
  restricted: false,
  expiresAt: NOW,
});

const accessStub = (grantedCapabilities: readonly string[] = ["projection.query"]) =>
  ({
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
    authorize: async () => ({
      context: {
        schemaVersion: "1",
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: "context", versionId: "1" },
        },
        actorId: "operator",
        projectId: PROJECT_ID,
        grantedCapabilities: [...grantedCapabilities],
        spatialScopeRefs: [],
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
    }),
    verify: async () => {
      throw new Error("unused");
    },
  }) as unknown as LocalIdentityAccessV1;

const qualitySuccess: ProjectionQuerySuccessV1 = {
  queryResultRef: {
    kind: "query-result",
    reference: { entityId: "quality-evaluation-query-1", versionId: "1" },
  },
  qualitySummaries: [],
};

const appFor = (ports: ApiPortsV1 = {}, accessLog?: (entry: HttpAccessLogEntryV1) => void) =>
  buildApi({
    access: accessStub(),
    ports,
    publicOrigin: ORIGIN,
    now: () => new Date(NOW),
    idGenerator: () => "request-id",
    ...(accessLog === undefined ? {} : { accessLog }),
  });

const queryBody = (payload: unknown) => ({
  schemaVersion: "1",
  queryId: "query-1",
  requestedSpatialScopeRefs: [],
  requestedSourceVersionRefs: [],
  requestedAt: NOW,
  payload,
});

const qualityPayload = {
  queryType: "quality-evaluation",
  selector: {
    mode: "exact",
    reportArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "quality-report", versionId: `sha256:${"a".repeat(64)}` },
    },
  },
};

const headers = {
  origin: ORIGIN,
  "content-type": "application/json",
  cookie: `${HTTP_COOKIE_NAME_V1}=session-token`,
};

describe("C36 质量查询接线", () => {
  it("仅在未提供完整 projection port 时由窄端口激活原 projection.query 路由", async () => {
    const received: unknown[] = [];
    const app = appFor({
      qualityProjectionQuery: {
        query: async (request) => {
          received.push(request);
          return { kind: "succeeded", result: qualitySuccess };
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      result: { queryResultRef: { reference: { entityId: string } } };
    };
    expect(body.result.queryResultRef.reference.entityId).toBe("quality-evaluation-query-1");
    expect(received).toHaveLength(1);
    const projectionRequest = received[0] as { payload: { queryType: string } };
    expect(projectionRequest.payload.queryType).toBe("quality-evaluation");

    const unavailable = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.subscribe`,
      headers,
      payload: {
        schemaVersion: "1",
        workflowRunRef: { kind: "workflow-run", reference: { entityId: "run", versionId: "1" } },
        payload: {},
      },
    });
    expect(unavailable.statusCode).toBe(404);
    await app.close();
  });

  it("既有查询类型不被窄端口接管，仍按其自身结果形状处理", async () => {
    const received: unknown[] = [];
    const app = appFor({
      qualityProjectionQuery: {
        query: async (request) => {
          received.push(request);
          return {
            kind: "failed",
            error: {
              code: "UNSUPPORTED_CONTRACT",
              category: "technical",
              retryable: false,
              stageCode: "quality-evaluation.query",
              occurredAt: NOW,
              causalRunId: "query-2",
              schemaVersion: "quality-evaluation-query/unsupported",
            },
          };
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody({
        queryType: "review-queue",
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "revision", versionId: "1" },
        },
      }),
    });
    expect(received).toHaveLength(1);
    expect(response.statusCode).toBe(426);
    expect(response.body).toContain("UNSUPPORTED_CONTRACT");
    await app.close();
  });

  it("完整 projection port 存在时窄端口不被使用", async () => {
    const narrowCalls: unknown[] = [];
    const fullCalls: unknown[] = [];
    const app = appFor({
      projection: {
        query: async (request) => {
          fullCalls.push(request);
          return { kind: "succeeded", result: { queryResultRef: qualitySuccess.queryResultRef } };
        },
        subscribe: async () => {
          throw new Error("unused");
        },
        export: async () => {
          throw new Error("unused");
        },
      },
      qualityProjectionQuery: {
        query: async (request) => {
          narrowCalls.push(request);
          return { kind: "succeeded", result: qualitySuccess };
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(200);
    expect(fullCalls).toHaveLength(1);
    expect(narrowCalls).toHaveLength(0);
    await app.close();
  });

  it("未授权会话得到 NOT_FOUND 且不触达窄端口", async () => {
    const received: unknown[] = [];
    const entries: HttpAccessLogEntryV1[] = [];
    const app = buildApi({
      access: accessStub(["projection.export"]),
      ports: {
        qualityProjectionQuery: {
          query: async (request) => {
            received.push(request);
            return { kind: "succeeded", result: qualitySuccess };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
      accessLog: (entry) => {
        entries.push(entry);
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(received).toHaveLength(0);
    expect(response.statusCode).toBe(404);
    expect(entries.map((entry) => entry.route)).toEqual([
      "/api/v1/projects/:projectId/queries/projection.query",
    ]);
    expect(MODULE_BRANCH_CAPABILITY_V1["projection.query"]).toBe("projection.query");
    await app.close();
  });
});
