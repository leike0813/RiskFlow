/**
 * C33 Finalizer 一次性最小复现（非交付物）：在真实 HTTP/授权接缝上验证
 * projection.query 复验派生身份（c30-query:<projectId>:<queryId>）与 HTTP 签发身份
 *（客户端 queryId 原值）不一致导致的稳定失败闭合。
 * 用法：node .scratch/c33-finalizer-projection-repro.mjs
 * 前置：pnpm build && pnpm --dir demo build（harness 需要 dist）。
 */
import { startDemoBrowserServer } from "../demo/test/browser/server.mjs";

const server = await startDemoBrowserServer();
try {
  // 真实登录拿会话 Cookie。
  const originHeaders = { "content-type": "application/json", origin: server.origin };
  const loginResponse = await fetch(`${server.origin}/api/v1/session/login`, {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({
      schemaVersion: "1",
      loginAttemptId: `repro-login-${Date.now().toString(36)}`,
      loginName: server.operatorLogin,
      password: server.accountPassword,
    }),
  });
  const setCookie = loginResponse.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  console.log("login status:", loginResponse.status, JSON.stringify(await loginResponse.json()));

  // 播种夹具里 recordAuto 已有可证明链边（record → assessment → warning → ...）。
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

  const queryId = `repro-projection-${Date.now().toString(36)}`;
  const registered = await post(
    "projection.query",
    { queryType: "trace-chain", subjectRef },
    queryId,
  );
  console.log("projection.query status:", registered.status);
  console.log("projection.query body:", JSON.stringify(registered.body));
  // 结论判读：链边已播种且 operator 具 projection.query 能力——
  // 200 表示接缝一致；404 NOT_FOUND 证明 verify.binding 拒绝（invocation 身份不一致）。
} finally {
  await server.close();
}
