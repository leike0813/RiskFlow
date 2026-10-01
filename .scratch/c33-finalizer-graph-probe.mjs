/**
 * fix-projection-reverification-identity-seam 一次性探针（非交付物）：在真实 HTTP/授权接缝上
 * 验证 association-graph 正向闭合（query + result-read），覆盖链边登记时点截断谓词与
 * C22 证据补齐。用法：node .scratch/c33-finalizer-graph-probe.mjs
 * 前置：pnpm build && pnpm --dir demo build（harness 需要 dist）。
 */
import { startDemoBrowserServer } from "../demo/test/browser/server.mjs";

const server = await startDemoBrowserServer();
try {
  const originHeaders = { "content-type": "application/json", origin: server.origin };
  const loginResponse = await fetch(`${server.origin}/api/v1/session/login`, {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({
      schemaVersion: "1",
      loginAttemptId: `probe-login-${Date.now().toString(36)}`,
      loginName: server.operatorLogin,
      password: server.accountPassword,
    }),
  });
  const cookie = (loginResponse.headers.get("set-cookie") ?? "").split(";")[0];
  console.log("login status:", loginResponse.status);

  const subjectRef = {
    kind: "standardized-risk-record",
    reference: { entityId: server.identification.recordAutoId, versionId: "1" },
  };
  const post = async (branch, payload, queryId) => {
    const response = await fetch(
      `${server.origin}/api/v1/projects/${encodeURIComponent(server.projectId)}/queries/${branch}`,
      {
        method: "POST",
        headers: { ...originHeaders, cookie },
        body: JSON.stringify({
          schemaVersion: "1",
          queryId,
          requestedAt: new Date().toISOString(),
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          payload,
        }),
      },
    );
    return { status: response.status, body: await response.json() };
  };

  const suffix = Date.now().toString(36);
  const registered = await post(
    "projection.query",
    { queryType: "association-graph", subjectRef },
    `probe-graph-${suffix}`,
  );
  console.log("graph query status:", registered.status);
  if (registered.status === 200) {
    const page = await post(
      "projection.result-read",
      { queryResultRef: registered.body.result.queryResultRef, limit: 50 },
      `probe-graph-page-${suffix}`,
    );
    console.log("graph readPage status:", page.status);
    console.log("graph readPage body:", JSON.stringify(page.body));
    console.log(
      "RESULT:",
      page.status === 200 ? "association-graph 已正向闭合" : "association-graph 仍失败闭合",
    );
  }
} finally {
  await server.close();
}
