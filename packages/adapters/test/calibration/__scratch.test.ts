import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";

import { startCalibrationFixture, type CalibrationPostgresFixtureV1 } from "./fixture.js";

const log = (...values: unknown[]) =>
  appendFileSync("/tmp/c29-debug.log", values.map(String).join(" ") + "\n");

describe.sequential("scratch", () => {
  let fixture: CalibrationPostgresFixtureV1 | undefined;
  beforeAll(async () => {
    fixture = await startCalibrationFixture();
  }, 180_000);
  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("captures reject and draft-retry failures", async () => {
    const pool = fixture!.runtime.pool as never as {
      connect: (...args: never[]) => Promise<{ query: (...args: never[]) => Promise<unknown> }>;
    };
    const originalConnect = pool.connect.bind(pool);
    pool.connect = async (...args: never[]) => {
      const client = await originalConnect(...args);
      const originalQuery = client.query.bind(client);
      client.query = async (...queryArgs: never[]) => {
        try {
          return await originalQuery(...queryArgs);
        } catch (error) {
          const typed = error as { code?: string; message?: string; detail?: string };
          log(`PG FAIL code=${typed.code} message=${typed.message} detail=${typed.detail}`);
          throw error;
        }
      };
      return client;
    };

    const seed = async (suffix: string, threshold: string) => {
      const fact = fixture!.deviationFacts.seed({ suffix, thresholdExceeded: true });
      const prepared = await fixture!.prepareInput({
        requestId: `c29-prepare-${suffix}`,
        deviationFactRef: fact.deviationFactRef,
      });
      if (prepared.kind !== "succeeded") throw new Error("prepare failed");
      const task = await fixture!.runCalibrationTask({
        suffix,
        frozenInputRef: prepared.result.frozenInputRef,
        inputSnapshotRef: prepared.result.inputSnapshotRef,
        operations: fixture!.operations(threshold),
      });
      const result = await fixture!.createSuggestion(
        await fixture!.suggestionCommand({
          commandId: `c29-suggest-${suffix}`,
          deviationRecordRef: prepared.result.deviationRecordRef,
          agentTaskResultRef: task.resultRef,
        }),
      );
      if (result.kind !== "succeeded" || result.result.kind !== "calibration") {
        throw new Error(`seed failed ${suffix}: ${JSON.stringify(result)}`);
      }
      return result.result;
    };

    /* 拒绝路径 */
    const rejected = await seed("scratch-reject", "11");
    const rejectDecision = await fixture!.decideReview({
      suffix: "scratch-reject",
      projectId: fixture!.projectId,
      targetRef: rejected.calibrationSuggestionRef,
      reviewTaskRef: rejected.reviewTaskRef,
      kind: "reject",
    });
    const rejectedOutcome = await fixture!.recordReviewOutcome(
      await fixture!.reviewOutcomeCommand({
        commandId: "c29-outcome-scratch-reject",
        outcome: "reject",
        suggestionRef: rejected.calibrationSuggestionRef,
        reviewDecisionRef: rejectDecision,
      }),
    );
    log("REJECT RESULT", JSON.stringify(rejectedOutcome));
    log(
      "REJECT RECEIPTS",
      JSON.stringify(
        await fixture!.rows(
          "SELECT command_kind, command_id, completed_at FROM business.command_receipts WHERE project_id = $1 AND command_id = $2",
          [fixture!.projectId, "c29-outcome-scratch-reject"],
        ),
      ),
    );
    const rejectSuggestion = (
      await fixture!.rows<{ deviation_id: string; status: string }>(
        "SELECT deviation_id, status FROM business.calibration_suggestions WHERE project_id = $1 AND suggestion_id = $2",
        [fixture!.projectId, rejected.calibrationSuggestionRef.reference.entityId],
      )
    )[0]!;
    log("REJECT SUGGESTION", JSON.stringify(rejectSuggestion));
    log(
      "REJECT ROWS",
      JSON.stringify(
        await fixture!.rows(
          `SELECT version_number, review_status, review_decision_ref, audit_entry_id, command_id
           FROM business.calibration_deviation_records WHERE project_id = $1 AND deviation_record_id = $2`,
          [fixture!.projectId, rejectSuggestion.deviation_id],
        ),
      ),
    );

    /* 草案重试路径 */
    const approved = await seed("scratch-draft", "12");
    const approveDecision = await fixture!.decideReview({
      suffix: "scratch-draft",
      projectId: fixture!.projectId,
      targetRef: approved.calibrationSuggestionRef,
      reviewTaskRef: approved.reviewTaskRef,
      kind: "approve-draft-creation",
    });
    const draftCommand = await fixture!.reviewOutcomeCommand({
      commandId: "c29-draft-scratch",
      outcome: "approve-draft-creation",
      suggestionRef: approved.calibrationSuggestionRef,
      reviewDecisionRef: approveDecision,
    });
    await fixture!.preinsertAuditConflict("audit-c29-draft-scratch:calibration-governance-draft");
    log("DRAFT FIRST", JSON.stringify(await fixture!.createGovernanceDraft(draftCommand)));
    log(
      "DRAFT RECEIPTS AFTER FIRST",
      JSON.stringify(
        await fixture!.rows(
          "SELECT command_kind, command_id, idempotency_key, completed_at FROM business.command_receipts WHERE project_id = $1 AND command_id = $2",
          [fixture!.projectId, "c29-draft-scratch"],
        ),
      ),
    );
    await fixture!.clearAuditConflict("audit-c29-draft-scratch:calibration-governance-draft");
    log("DRAFT RETRY", JSON.stringify(await fixture!.createGovernanceDraft(draftCommand)));
    log(
      "DRAFT ROWS",
      JSON.stringify(
        await fixture!.rows(
          "SELECT draft_id, version_id, knowledge_revision_id FROM business.calibration_governance_drafts WHERE project_id = $1",
          [fixture!.projectId],
        ),
      ),
    );
    log("GOVERN", JSON.stringify(fixture!.governance.submitRevisions.length));
  }, 180_000);
});
