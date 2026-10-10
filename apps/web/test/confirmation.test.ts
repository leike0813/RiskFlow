import { describe, expect, it } from "vitest";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import { makeSafeHttpError } from "../src/api/http.js";
import {
  createConfirmationController,
  invalidateConfirmation,
  openConfirmation,
} from "../src/shared/confirmation.js";
import { INITIAL_WEB_CONTEXT_V1, type WebContextV1 } from "../src/app/state.js";

const target: ContractReferenceV1 = {
  kind: "project-revision",
  reference: { entityId: "project-1", versionId: "v1" },
};

const plan = (impact: "standard" | "high" = "standard") => ({
  confirmationId: "confirmation-1",
  operationId: "engineering-data.register-source-delivery",
  scope: { kind: "project", projectId: "project-1", contextRevision: 3 } as const,
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

const success = (entityId = "result-1") =>
  ({
    kind: "reference",
    resultRef: {
      kind: "source-delivery",
      reference: { entityId, versionId: "v1" },
    },
  }) as const;

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
    expect(staleController.getState()).toMatchObject({
      kind: "terminal-failure",
      error: { code: "STALE_VERSION" },
    });
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

  it("retries an already acknowledged high-impact plan with the same identity", async () => {
    const highPlan = plan("high");
    const controller = createConfirmationController<typeof highPlan>();
    expect(controller.open(highPlan, { kind: "allowed" })).toBe(true);
    expect(controller.acknowledge()).toBe(true);
    expect(
      await controller.confirm(async () =>
        Promise.reject(makeSafeHttpError({ code: "TRANSIENT_FAILURE", retryable: true })),
      ),
    ).toBe(false);
    expect(
      await controller.retry(async (submitted) => {
        expect(submitted).toBe(highPlan);
        expect(submitted.commandId).toBe("command-1");
        expect(submitted.idempotencyKey).toBe("idempotency-1");
        return success("high-retry");
      }),
    ).toBe(true);
  });
});

describe("C37 project/system 确认作用域", () => {
  const systemPlan = () => ({
    ...plan(),
    confirmationId: "confirmation-system",
    operationId: "administration.command" as const,
    scope: {
      kind: "system" as const,
      administrationContextRef: { entityId: "admin-context-1", versionId: "v4" },
      sessionRevision: 7,
    },
    projectId: "",
    request: { targetAccountId: "account-2" },
  });

  const context = (revision: number, projectId: string) =>
    ({
      ...INITIAL_WEB_CONTEXT_V1,
      revision,
      projectId,
    }) as WebContextV1;

  it("系统作用域不因工程切换而失效，管理修订变化才失效", () => {
    const opened = openConfirmation(systemPlan(), { kind: "allowed" });
    expect(opened.kind).toBe("reviewing");

    // 换工程不影响系统命令确认。
    const afterProjectSwitch = invalidateConfirmation(opened, context(3, "project-2"), {
      project: { revision: 3, projectId: "project-2" },
      system: {
        administrationContextRef: { entityId: "admin-context-1", versionId: "v4" },
        sessionRevision: 7,
      },
    });
    expect(afterProjectSwitch.kind).toBe("reviewing");

    // 管理上下文修订变化必须失效。
    const afterAdminChange = invalidateConfirmation(opened, context(3, "project-1"), {
      project: { revision: 3, projectId: "project-1" },
      system: {
        administrationContextRef: { entityId: "admin-context-1", versionId: "v5" },
        sessionRevision: 7,
      },
    });
    expect(afterAdminChange.kind).toBe("closed");
  });

  it("工程作用域在工程或修订变化时失效", () => {
    const opened = openConfirmation(plan(), { kind: "allowed" });
    expect(
      invalidateConfirmation(opened, context(3, "project-1"), {
        project: { revision: 3, projectId: "project-1" },
        system: undefined,
      }).kind,
    ).toBe("reviewing");
    expect(
      invalidateConfirmation(opened, context(4, "project-1"), {
        project: { revision: 4, projectId: "project-1" },
        system: undefined,
      }).kind,
    ).toBe("closed");
    expect(
      invalidateConfirmation(opened, context(3, "project-2"), {
        project: { revision: 3, projectId: "project-2" },
        system: undefined,
      }).kind,
    ).toBe("closed");
  });

  it("打开确认时深冻结请求，重试复用同一份载荷", () => {
    const mutable = systemPlan();
    const opened = openConfirmation(mutable, { kind: "allowed" });
    if (opened.kind !== "reviewing") throw new Error("expected reviewing");
    expect(Object.isFrozen(opened.plan.request)).toBe(true);
    expect(Object.isFrozen(opened.plan.scope)).toBe(true);
  });

  it("管理命令回执按 command-result 收口，不伪造领域 resultRef", async () => {
    const planValue = systemPlan();
    const controller = createConfirmationController<typeof planValue>();
    expect(controller.open(planValue, { kind: "allowed" })).toBe(true);
    expect(
      await controller.confirm(async () => ({
        kind: "command-result",
        result: { kind: "account", previousVersionId: "3" },
      })),
    ).toBe(true);
    const state = controller.getState();
    expect(state.kind).toBe("succeeded");
    if (state.kind === "succeeded") expect(state.result.kind).toBe("command-result");
  });
});
