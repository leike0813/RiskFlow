/**
 * fix-projection-reverification-identity-seam 一次性探针（非交付物）：在真实 HTTP/授权接缝上
 * 分别验证 invocationId 修复后的 projection.query（预期 200）与 projection.result-read。
 * readPage 若仍 404，则证明 C06 verify 的 branch 精确绑定与 C09 按路由 branch 签发之间存在
 * 第二处已归档语义缺陷（签发 branch=projection.result-read，适配器复验 branch=projection.query）。
 * 用法：node .scratch/c33-finalizer-readpage-branch-probe.mjs
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
    { queryType: "trace-chain", subjectRef },
    `probe-projection-${suffix}`,
  );
  console.log("projection.query status:", registered.status);
  console.log("projection.query body:", JSON.stringify(registered.body));
  if (registered.status !== 200) {
    console.log("RESULT: query 仍未闭合，invocationId 修复未生效");
    process.exitCode = 1;
  } else {
    const queryResultRef = registered.body.result.queryResultRef;
    const page = await post(
      "projection.result-read",
      { queryResultRef, limit: 50 },
      `probe-read-page-${suffix}`,
    );
    console.log("projection.result-read status:", page.status);
    console.log("projection.result-read body:", JSON.stringify(page.body));
    // 判读：200 = readPage 正向闭合；404 NOT_FOUND = verify.binding 因 branch
    // （projection.result-read 签发 vs projection.query 复验）不匹配而拒绝。
    console.log(
      "RESULT:",
      page.status === 200
        ? "readPage 已正向闭合"
        : "readPage 仍失败闭合（branch 绑定缺陷证据）",
    );
  }
} finally {
  await server.close();
}
