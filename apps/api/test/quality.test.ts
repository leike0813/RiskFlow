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

/** 自省只回报无 token 元数据：与登录结果共用同一组字段，只是没有凭证。 */
const sessionMetadata = () => ({
  sessionRef: { entityId: "session", versionId: "1" },
  accountRef: { entityId: "account", versionId: "1" },
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
    readSession: async () => sessionMetadata(),
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

/** 可配置的两阶段签发桩：基底上下文沿用会话桩形状，只替换 `authorize` 行为。 */
const versionedAccessStub = (input: {
  readonly authorize: (request: {
    readonly invocationId: string;
    readonly requestedSourceVersionRefs: readonly {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
  }) => Promise<
    | readonly {
        readonly kind: "source-access-grant";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[]
    | undefined
  >;
}) =>
  ({
    ...(accessStub() as unknown as Record<string, unknown>),
    authorize: async (request: {
      readonly invocationId: string;
      readonly requestedSourceVersionRefs: readonly {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[];
    }) => ({
      context: {
        schemaVersion: "1",
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: "context", versionId: "1" },
        },
        actorId: "operator",
        projectId: PROJECT_ID,
        grantedCapabilities: ["projection.query"],
        spatialScopeRefs: [],
        sourceAccessGrantRefs: [...((await input.authorize(request)) ?? [])],
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

  it("按候选来源版本逐项签发，只把请求内 grant 映射交给第二段查询", async () => {
    const authorizeCalls: {
      readonly invocationId: string;
      readonly sourceVersions: readonly string[];
    }[] = [];
    const granted: { readonly grantKeys: readonly string[] }[] = [];
    const sourceVersions = ["source-a", "source-b"].map((entityId) => ({
      versionKey: `${entityId}\u00001`,
      sourceVersionRef: {
        kind: "source-version" as const,
        reference: { entityId, versionId: "1" },
      },
    }));
    const access = {
      ...(accessStub() as unknown as Record<string, unknown>),
      authorize: async (request: {
        readonly invocationId: string;
        readonly requestedSourceVersionRefs: readonly {
          readonly reference: { readonly entityId: string };
        }[];
      }) => {
        authorizeCalls.push({
          invocationId: request.invocationId,
          sourceVersions: request.requestedSourceVersionRefs.map(
            (version) => version.reference.entityId,
          ),
        });
        return {
          context: {
            schemaVersion: "1",
            authorizationContextRef: {
              kind: "authorization-context",
              reference: { entityId: "context", versionId: "1" },
            },
            actorId: "operator",
            projectId: PROJECT_ID,
            grantedCapabilities: ["projection.query"],
            spatialScopeRefs: [],
            sourceAccessGrantRefs:
              request.requestedSourceVersionRefs.length === 0
                ? []
                : request.requestedSourceVersionRefs.map((version) => ({
                    kind: "source-access-grant",
                    reference: { entityId: `grant-${version.reference.entityId}`, versionId: "1" },
                  })),
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
    } as unknown as LocalIdentityAccessV1;
    const app = buildApi({
      access,
      ports: {
        qualityProjectionQuery: {
          query: async () => {
            throw new Error("two-phase flow must not fall back to the single-phase query");
          },
          candidateSourceVersionRefs: async () => ({
            kind: "candidates",
            rowRefs: [{ reportArtifactId: "quality-report", reportArtifactVersionId: "1" }],
            summaryDigests: ["digest-1"],
            versions: sourceVersions,
          }),
          queryWithSourceGrants: async (_request, grantsBySourceVersion) => {
            granted.push({ grantKeys: [...grantsBySourceVersion.keys()] });
            return { kind: "succeeded", result: qualitySuccess };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(200);
    expect(authorizeCalls[0]?.sourceVersions).toEqual([]);
    expect(authorizeCalls.slice(1).map((call) => call.sourceVersions)).toEqual([
      ["source-a"],
      ["source-b"],
      [],
      ["source-a"],
      ["source-b"],
    ]);
    expect(granted).toHaveLength(1);
    expect(granted[0]?.grantKeys).toEqual(["source-a\u00001", "source-b\u00001"]);
    await app.close();
  });

  it("某个来源版本拒权时只删除该版本映射，其余版本照常返回", async () => {
    const granted: { readonly grantKeys: readonly string[] }[] = [];
    const app = buildApi({
      access: versionedAccessStub({
        authorize: async (request) => {
          if (request.requestedSourceVersionRefs[0]?.reference.entityId === "source-b") {
            throw { details: { code: "AUTHORIZATION_DENIED" } };
          }
          return request.requestedSourceVersionRefs.length === 0
            ? undefined
            : request.requestedSourceVersionRefs.map((version) => ({
                kind: "source-access-grant" as const,
                reference: { entityId: `grant-${version.reference.entityId}`, versionId: "1" },
              }));
        },
      }),
      ports: {
        qualityProjectionQuery: {
          query: async () => {
            throw new Error("unused");
          },
          candidateSourceVersionRefs: async () => ({
            kind: "candidates",
            rowRefs: [{ reportArtifactId: "quality-report", reportArtifactVersionId: "1" }],
            summaryDigests: ["digest-1"],
            versions: ["source-a", "source-b"].map((entityId) => ({
              versionKey: `${entityId}\u00001`,
              sourceVersionRef: {
                kind: "source-version" as const,
                reference: { entityId, versionId: "1" },
              },
            })),
          }),
          queryWithSourceGrants: async (_request, grantsBySourceVersion) => {
            granted.push({ grantKeys: [...grantsBySourceVersion.keys()] });
            return { kind: "succeeded", result: qualitySuccess };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(200);
    expect(granted[0]?.grantKeys).toEqual(["source-a\u00001"]);
    await app.close();
  });

  it("返回前重新签发；预选后撤权不得沿用旧 grant", async () => {
    let sourceChecks = 0;
    const disclosed: string[][] = [];
    const app = buildApi({
      access: versionedAccessStub({
        authorize: async (request) => {
          if (request.requestedSourceVersionRefs.length === 0) return [];
          sourceChecks += 1;
          return sourceChecks === 1
            ? [{ kind: "source-access-grant", reference: { entityId: "grant-a", versionId: "1" } }]
            : [];
        },
      }),
      ports: {
        qualityProjectionQuery: {
          query: async () => {
            throw new Error("unused");
          },
          candidateSourceVersionRefs: async () => ({
            kind: "candidates",
            rowRefs: [{ reportArtifactId: "quality-report", reportArtifactVersionId: "1" }],
            summaryDigests: ["digest-1"],
            versions: [
              {
                versionKey: "source-a\u00001",
                sourceVersionRef: {
                  kind: "source-version",
                  reference: { entityId: "source-a", versionId: "1" },
                },
              },
            ],
          }),
          queryWithSourceGrants: async (_request, grants) => {
            disclosed.push([...grants.keys()]);
            return { kind: "succeeded", result: qualitySuccess };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(200);
    expect(sourceChecks).toBe(2);
    expect(disclosed).toEqual([[]]);
    await app.close();
  });

  it("签发暂时性失败使整个查询失败，不伪装成空证据成功", async () => {
    const granted: unknown[] = [];
    const app = buildApi({
      access: versionedAccessStub({
        authorize: async () => {
          throw new Error("source version signing is unavailable");
        },
      }),
      ports: {
        qualityProjectionQuery: {
          query: async () => {
            throw new Error("unused");
          },
          candidateSourceVersionRefs: async () => ({
            kind: "candidates",
            rowRefs: [{ reportArtifactId: "quality-report", reportArtifactVersionId: "1" }],
            summaryDigests: ["digest-1"],
            versions: [
              {
                versionKey: "source-a\u00001",
                sourceVersionRef: {
                  kind: "source-version" as const,
                  reference: { entityId: "source-a", versionId: "1" },
                },
              },
            ],
          }),
          queryWithSourceGrants: async (_request, grantsBySourceVersion) => {
            granted.push(grantsBySourceVersion);
            return { kind: "succeeded", result: qualitySuccess };
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain("TERMINAL_FAILURE");
    expect(granted).toHaveLength(0);
    await app.close();
  });

  it("预选被同形拒绝时不进入签发阶段", async () => {
    const authorizeCalls: unknown[] = [];
    const rejection = {
      kind: "failed" as const,
      error: {
        code: "ENTITY_NOT_FOUND" as const,
        category: "not-found" as const,
        retryable: false as const,
        stageCode: "quality-evaluation.query",
        occurredAt: NOW,
        causalRunId: "query-1",
        targetRef: {
          kind: "query-result" as const,
          reference: { entityId: "query-1", versionId: "1" },
        },
      },
    };
    const app = buildApi({
      access: versionedAccessStub({
        authorize: async () => {
          authorizeCalls.push("authorize");
          return undefined;
        },
      }),
      ports: {
        qualityProjectionQuery: {
          query: async () => {
            throw new Error("unused");
          },
          candidateSourceVersionRefs: async () => ({ kind: "rejected", result: rejection }),
          queryWithSourceGrants: async () => {
            throw new Error("unused");
          },
        },
      },
      publicOrigin: ORIGIN,
      now: () => new Date(NOW),
      idGenerator: () => "request-id",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/queries/projection.query`,
      headers,
      payload: queryBody(qualityPayload),
    });
    expect(response.statusCode).toBe(404);
    expect(authorizeCalls).toEqual(["authorize"]);
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
