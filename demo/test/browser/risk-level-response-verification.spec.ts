/**
 * 合成样本、待甲方复核：独立发布配置，只关闭监测触发、保留默认风险接受阈值。
 *
 * 本场景只开单条风险等级预警，真实链路为：三项校验通过 → 人工采纳（含真实预测运行）
 * → UI 登记执行 → UI 登记反馈 → 回读精确偏差与校准建议 → C07 真实批准 → UI 创建未发布草案。
 */
import { expect, test } from "@playwright/test";
import { startDemoBrowserServer } from "./server.mjs";

let server;
test.beforeAll(async () => {
  server = await startDemoBrowserServer({ riskLevelOnly: true });
}, 600_000);
test.afterAll(async () => { await server?.close(); });

/** 工程参数放首位：页面按 URL 自省工程上下文，深链的精确 version 只能跟在后面。 */
const withProject = (path, extraParams = {}) => {
  const [base, existing = ""] = path.split("?");
  const params = new URLSearchParams({ project: server.projectId });
  for (const [key, value] of new URLSearchParams(existing)) params.set(key, value);
  for (const [key, value] of Object.entries(extraParams)) params.set(key, value);
  params.set("assessmentSources", JSON.stringify({ projectId: server.projectId,
    revisionId: params.get("revision")?.split("@").at(-1) ?? null,
    refs: server.assessmentSourceVersionRefs }));
  return `${base}?${params.toString()}`;
};

/** 会话仍有效时直接落在目标页，只有 401 才出现登录表单。 */
const openWithLogin = async (page, path) => {
  const target = `${server.origin}${path}`;
  await page.goto(target);
  const needsLogin = await page
    .getByLabel("登录名")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  if (needsLogin) {
    await page.getByLabel("登录名").fill(server.operatorLogin);
    await page.getByLabel("密码").fill(server.accountPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await page.waitForURL(target);
};

const localDateTimeNow = (page) => page.evaluate(() => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
});

test("单独风险等级预警经三项约束采纳后，经 UI 完成执行/反馈并批准出未发布校准草案", async ({ page }) => {
  test.setTimeout(600_000);
  await openWithLogin(page, withProject("/warnings"));
  await expect(page.locator("h1.page-title")).toHaveText("预警中心");
  const call = async (branch, payload, command = false) => {
    const id = `level-only:${crypto.randomUUID()}`;
    return await page.evaluate(async ({ projectId, branch, payload, command, id }) => {
      const response = await fetch(`/api/v1/projects/${projectId}/${command ? "commands" : "queries"}/${branch}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "1", payload,
          requestedSpatialScopeRefs: [], requestedSourceVersionRefs: [],
          ...(command ? { commandId: id, idempotencyKey: id, issuedAt: new Date().toISOString() }
            : { queryId: id, requestedAt: new Date().toISOString() }),
        }),
      });
      return { status: response.status, body: await response.json() };
    }, { projectId: server.projectId, branch, payload, command, id });
  };
  const started = await call("workflow.start-run", { ...server.assessStartInput, entryMode: "assess" }, true);
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const catalog = await call("warning-response.read", { operation: "warning-catalog", pageSize: 50 });
  expect(catalog.status).toBe(200);
  let warning;
  for (const item of catalog.body.result.items) {
    const read = await call("warning-response.read", { operation: "warning-read", warningRecordRef: item.warningRecordRef });
    if (read.body.kind === "succeeded") { warning = read.body.result; break; }
  }
  expect(warning).toBeTruthy();
  const task = await call("warning-response.read", { operation: "task-read", warningResponseTaskRef: warning.taskRef });
  expect(task.body.kind, JSON.stringify(task.body)).toBe("succeeded");
  const triggers = [];
  for (const warningRecordRef of task.body.result.relations.warningRefs) {
    const read = await call("warning-response.read", { operation: "warning-read", warningRecordRef });
    expect(read.body.kind).toBe("succeeded");
    triggers.push(read.body.result.warningRecord.triggerType);
  }
  expect(triggers).toEqual(["风险等级超过风险可接受阈值"]);
  const recommendationRef = task.body.result.relations.recommendationRefs[0];
  expect(recommendationRef).toBeTruthy();
  const recommendation = await call("warning-response.read", { operation: "recommendation-read", responseRecommendationRef: recommendationRef });
  expect(recommendation.body.result.validationResults).toHaveLength(3);
  expect(recommendation.body.result.validationResults.every((check) => check.pass)).toBe(true);
  const adopted = await call("warning-response.adopt-recommendation", {
    responseRecommendationRef: recommendationRef, decision: "adopted", reasonCode: "level-only-verification",
    preActionMonitoringSnapshotRef: server.settlementMonitoringSnapshotRef,
  }, true);
  expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
  expect(adopted.body.result.kind).toBe("adoption");
  expect(adopted.body.result.forecastRunRef).toBeTruthy();
  const after = await call("warning-response.read", { operation: "task-read", warningResponseTaskRef: warning.taskRef });
  expect(after.body.result.relations.forecastRefs.length).toBeGreaterThan(0);
  expect(after.body.result.relations.executionRefs).toEqual([]);

  // ---- 经真实 UI 登记执行：建议引用取页面按任务读回的权威关系，证据取真实资料段 ----
  await openWithLogin(page, withProject("/response/executions/register", {
    task: warning.taskRef.reference.entityId,
    taskVersion: warning.taskRef.reference.versionId,
  }));
  await expect(page.locator("h1.page-title")).toHaveText("执行登记");
  await expect(page.getByLabel("建议标识", { exact: true })).toHaveValue(recommendationRef.reference.entityId);
  await page.getByLabel("执行发生时间").fill(await localDateTimeNow(page));
  await page.getByLabel("证据来源段标识").fill(server.sourceA.segmentIds[0]);
  await page.getByLabel("证据来源版本标识").fill(server.sourceA.sourceVersionRef.reference.entityId);
  await expect(page.getByRole("button", { name: "登记执行", exact: true })).toBeDisabled();
  await page.getByLabel("证据来源版本号").fill(server.sourceA.sourceVersionRef.reference.versionId);
  await page.getByRole("button", { name: "登记执行", exact: true }).click();
  const executionResponse = page.waitForResponse((response) => response.url().endsWith("/commands/warning-response.record-execution"));
  await page.getByRole("button", { name: "确认登记执行", exact: true }).click();
  const executionHttp = await executionResponse;
  const execution = { status: executionHttp.status(), body: await executionHttp.json() };
  expect(execution.status, JSON.stringify(execution.body)).toBe(200);
  const executionRef = execution.body.result.executionRecordRef;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("version")).toBe(executionRef.reference.versionId);

  // ---- 经真实 UI 登记反馈：执行/工件/快照/实际评估记录全部是精确引用 ----
  await page.getByLabel("反馈工件标识").fill(server.feedbackArtifactRef.reference.entityId);
  await page.getByLabel("反馈工件版本").fill(server.feedbackArtifactRef.reference.versionId);
  await page.getByLabel("处置后监测快照标识").fill(server.settlementMonitoringSnapshotRef.reference.entityId);
  await page.getByLabel("处置后监测快照版本").fill(server.settlementMonitoringSnapshotRef.reference.versionId);
  await page.getByLabel("实际评估记录标识").fill(warning.assessmentRecordRef.reference.entityId);
  await page.getByLabel("实际评估记录版本").fill(warning.assessmentRecordRef.reference.versionId);
  await expect(page.getByRole("button", { name: "登记反馈", exact: true })).toBeDisabled();
  await page.getByLabel("反馈发生时间").fill(await localDateTimeNow(page));
  await page.getByRole("button", { name: "登记反馈", exact: true }).click();
  const feedbackResponse = page.waitForResponse((response) => response.url().endsWith("/commands/warning-response.record-feedback"));
  await page.getByRole("button", { name: "确认登记反馈", exact: true }).click();
  const feedbackHttp = await feedbackResponse;
  const feedback = { status: feedbackHttp.status(), body: await feedbackHttp.json() };
  expect(feedback.status, JSON.stringify(feedback.body)).toBe(200);
  const feedbackRef = feedback.body.result.feedbackRef;
  await expect(page.locator("h1.page-title")).toHaveText("处置反馈");

  // UI 登记的执行与反馈落在同一条处置任务上：关系读回真实成立，不靠页面文案判断。
  const closed = await call("warning-response.read", { operation: "task-read", warningResponseTaskRef: warning.taskRef });
  expect(closed.body.result.relations.executionRefs.map((ref) => ref.reference.entityId)).toContain(executionRef.reference.entityId);
  expect(closed.body.result.relations.feedbackRefs.map((ref) => ref.reference.entityId)).toContain(feedbackRef.reference.entityId);

  // ---- 回读精确偏差：越限由同一偏差事实驱动出校准建议 ----
  const feedbackRead = await call("warning-response.read", { operation: "feedback-read", feedbackRef });
  expect(feedbackRead.status, JSON.stringify(feedbackRead.body)).toBe(200);
  const feedbackResult = feedbackRead.body.result;
  const deviation = feedbackResult.deviation;
  expect(deviation, JSON.stringify(feedbackRead.body)).toBeTruthy();
  expect(deviation.thresholdExceeded, JSON.stringify(deviation)).toBe(true);
  expect(Number.isFinite(Number(deviation.deviationValue))).toBe(true);
  expect(deviation.direction).toBeTruthy();
  expect(feedbackResult.deviationRecordRef, JSON.stringify(feedbackRead.body)).toBeTruthy();
  const calibrationSuggestionRef = feedbackResult.calibrationRefs[0];
  expect(calibrationSuggestionRef, JSON.stringify(feedbackRead.body)).toBeTruthy();

  // ---- 校准页读到同一偏差、逐项校验通过，且未发布为知识 ----
  await openWithLogin(page, withProject(`/response/calibrations/${encodeURIComponent(calibrationSuggestionRef.reference.entityId)}`, {
    version: calibrationSuggestionRef.reference.versionId,
  }));
  await expect(page.locator("h1.page-title")).toHaveText("校准建议");
  const calibrationRead = await call("warning-response.read", { operation: "calibration-read", calibrationSuggestionRef });
  expect(calibrationRead.status, JSON.stringify(calibrationRead.body)).toBe(200);
  const calibrationView = calibrationRead.body.result;
  expect(calibrationView.deviationRecordRef.reference.entityId).toBe(feedbackResult.deviationRecordRef.reference.entityId);
  expect(calibrationView.operations.some((entry) => entry.operation?.kind === "replace-risk-acceptance-threshold" && entry.valid)).toBe(true);
  expect(calibrationView.knowledgeRevisionRef, "未批准前不得存在已发布知识修订").toBeUndefined();

  // ---- 真实 C07 批准后用 UI 以精确决定创建未发布草案 ----
  const queue = await call("review-audit.queue-read", { reviewType: "calibration-suggestion", status: "pending", pageSize: 50 });
  expect(queue.status, JSON.stringify(queue.body)).toBe(200);
  const reviewTask = queue.body.result.items.find((item) => item.reviewTaskRef.targetRef.reference.entityId === calibrationSuggestionRef.reference.entityId);
  expect(reviewTask).toBeTruthy();
  const approved = await call("review-audit.decide-review", {
    reviewTaskRef: reviewTask.reviewTaskRef, targetRef: reviewTask.reviewTaskRef.targetRef,
    decision: { reviewType: "calibration-suggestion", kind: "approve-draft-creation" }, reasonCode: "level-only-calibration",
  }, true);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const reviewDecisionRef = approved.body.result.reviewDecisionRef;
  await page.reload();
  await page.getByLabel("复核决定标识").fill(reviewDecisionRef.reference.entityId);
  await page.getByLabel("复核决定版本").fill(reviewDecisionRef.reference.versionId);
  await page.getByRole("button", { name: "创建治理草案", exact: true }).click();
  const draftResponse = page.waitForResponse((response) => response.url().includes("/commands/warning-response.calibration-governance-draft"));
  await page.getByRole("button", { name: "确认创建治理草案", exact: true }).click();
  const draftHttp = await draftResponse;
  const draftBody = await draftHttp.json();
  expect(draftHttp.status(), JSON.stringify(draftBody)).toBe(200);
  expect(draftBody.result.knowledgeRevisionRef).toBeTruthy();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(draftBody.result.knowledgeRevisionRef.reference.entityId, { exact: false })).toBeVisible();
  const reread = await call("warning-response.read", { operation: "calibration-read", calibrationSuggestionRef });
  expect(reread.body.result.status).toBe("approved-for-draft");
  expect(reread.body.result.knowledgeRevisionRef).toEqual(draftBody.result.knowledgeRevisionRef);
});
