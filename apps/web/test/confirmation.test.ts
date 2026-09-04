import { describe, expect, it } from "vitest";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import { makeSafeHttpError } from "../src/api/http.js";
import { createConfirmationController, openConfirmation } from "../src/shared/confirmation.js";

const target: ContractReferenceV1 = {
  kind: "project-revision",
  reference: { entityId: "project-1", versionId: "v1" },
};

const plan = (impact: "standard" | "high" = "standard") => ({
  confirmationId: "confirmation-1",
  operationId: "engineering-data.register-source-delivery",
  projectId: "project-1",
  targets: [target],
  inputVersions: [{ entityId: "source-1", versionId: "v1" }],
  expectedFacts: ["source-delivery"],
  externalEffects: ["写入工程资料索引"],
  impact,
  commandId: "command-1",
  idempotencyKey: "idempotency-1",
  request: { projectId: "project-1" },
});

const success = (entityId = "result-1"): ContractReferenceV1 => ({
  kind: "source-delivery",
  reference: { entityId, versionId: "v1" },
});

describe("C10 命令确认原语", () => {
  it("does not open for a non-allowed action and requires high-impact acknowledgement", () => {
    expect(
      openConfirmation(plan(), { kind: "forbidden", requiredCapability: "projection.query" }),
    ).toEqual({
      kind: "closed",
    });
    const state = openConfirmation(plan("high"), { kind: "allowed" });
    expect(state.kind).toBe("reviewing");
    if (state.kind === "reviewing") expect(state.acknowledged).toBe(false);
  });

  it("submits once, preserves identity on retry, and closes stale failures", async () => {
    const firstPlan = plan();
    const controller = createConfirmationController<typeof firstPlan>();
    expect(controller.open(firstPlan, { kind: "allowed" })).toBe(true);
    let submitCalls = 0;
    expect(
      await controller.confirm(async (submitted) => {
        submitCalls += 1;
        expect(submitted.commandId).toBe(firstPlan.commandId);
        expect(submitted.idempotencyKey).toBe(firstPlan.idempotencyKey);
        return success();
      }),
    ).toBe(true);
    expect(submitCalls).toBe(1);
    expect(controller.getState().kind).toBe("succeeded");

    const retryController = createConfirmationController<typeof firstPlan>();
    expect(retryController.open(firstPlan, { kind: "allowed" })).toBe(true);
    const retryError = makeSafeHttpError({ code: "TRANSIENT_FAILURE", retryable: true });
    expect(await retryController.confirm(async () => Promise.reject(retryError))).toBe(false);
    const failed = retryController.getState();
    expect(failed.kind).toBe("retryable-failure");
    if (failed.kind === "retryable-failure") expect(failed.plan).toBe(firstPlan);
    expect(
      await retryController.retry(async (submitted) => {
        expect(submitted).toBe(firstPlan);
        return success("result-2");
      }),
    ).toBe(true);
    expect(retryController.getState().kind).toBe("succeeded");

    const staleController = createConfirmationController<typeof firstPlan>();
    expect(staleController.open(firstPlan, { kind: "allowed" })).toBe(true);
    const stale = makeSafeHttpError({ code: "STALE_VERSION" });
    expect(await staleController.confirm(async () => Promise.reject(stale))).toBe(false);
    expect(staleController.getState().kind).toBe("closed");
  });

  it("blocks duplicate submission while a high-impact command is pending", async () => {
    const highPlan = plan("high");
    const controller = createConfirmationController<typeof highPlan>();
    expect(controller.open(highPlan, { kind: "allowed" })).toBe(true);
    expect(await controller.confirm(async () => success())).toBe(false);
    expect(controller.acknowledge()).toBe(true);
    let resolveSubmit: ((value: ContractReferenceV1) => void) | undefined;
    const pending = controller.confirm(
      () => new Promise<ContractReferenceV1>((resolve) => (resolveSubmit = resolve)),
    );
    expect(controller.getState().kind).toBe("submitting");
    expect(await controller.confirm(async () => success("duplicate"))).toBe(false);
    resolveSubmit?.(success("result-3"));
    expect(await pending).toBe(true);
  });
});
