/**
 * fix-projection-reverification-identity-seam 一次性探针（非交付物）：在真实 HTTP/授权接缝上
 * 验证 risk-overview 正向闭合（query + result-read），覆盖 entry-snapshot/run-state 行播种、
 * runState 正文回读与 C22 证据补齐。若 body-read 绑定拒绝则整页失败，可据此定位接缝。
 * 用法：node .scratch/c33-finalizer-risk-overview-probe.mjs
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

  // 取当前工程修订：与 RunRecordsPage 一致，先读工程上下文。
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
  const context = await post("engineering-data.context-read", {}, `probe-context-${suffix}`);
  console.log("context-read status:", context.status);
  const revisionRef = context.body?.result?.currentProjectRevisionRef;
  console.log("currentProjectRevisionRef:", JSON.stringify(revisionRef));

  const registered = await post(
    "projection.query",
    { queryType: "risk-overview", projectRevisionRef: revisionRef },
    `probe-overview-${suffix}`,
  );
  console.log("overview query status:", registered.status, JSON.stringify(registered.body));
  if (registered.status === 200) {
    const page = await post(
      "projection.result-read",
      { queryResultRef: registered.body.result.queryResultRef, limit: 50 },
      `probe-overview-page-${suffix}`,
    );
    console.log("overview readPage status:", page.status);
    console.log("overview readPage body:", JSON.stringify(page.body));
    console.log(
      "RESULT:",
      page.status === 200 ? "risk-overview 已正向闭合" : "risk-overview 仍失败闭合",
    );
  }
} finally {
  await server.close();
}
