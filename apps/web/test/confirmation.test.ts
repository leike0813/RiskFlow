import { describe, expect, it } from "vitest";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import { makeSafeHttpError } from "../src/api/http.js";
import {
  createConfirmationController,
  invalidateConfirmation,
  openConfirmation,
  type CommandConfirmationScopeV1,
} from "../src/shared/confirmation.js";

const target: ContractReferenceV1 = {
  kind: "project-revision",
  reference: { entityId: "project-1", versionId: "v1" },
};

const plan = (impact: "standard" | "high" = "standard") => ({
  confirmationId: "confirmation-1",
  operationId: "engineering-data.register-source-delivery",
  scope: {
    kind: "project",
    projectId: "project-1",
    contextRevision: 3,
    sessionRef: { entityId: "session-1", versionId: "1" },
  } as const satisfies CommandConfirmationScopeV1,
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
    // 计划在打开确认时已拍快照：重试消费的是那份快照，而不是调用方的源对象。
    if (failed.kind === "retryable-failure") expect(failed.plan).toMatchObject(firstPlan);
    expect(
      await retryController.retry(async (submitted) => {
        expect(submitted).toBe(failed.kind === "retryable-failure" ? failed.plan : undefined);
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
        expect(submitted).toMatchObject(highPlan);
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
      accountRef: { entityId: "account-admin", versionId: "3" },
      sessionRef: { entityId: "session-1", versionId: "4" },
    },
    request: { targetAccountId: "account-2" },
  });

  const systemScope = (sessionVersionId = "4"): CommandConfirmationScopeV1 => ({
    kind: "system",
    accountRef: { entityId: "account-admin", versionId: "3" },
    sessionRef: { entityId: "session-1", versionId: sessionVersionId },
  });

  const projectScope = (
    projectId: string,
    contextRevision: number,
  ): CommandConfirmationScopeV1 => ({
    kind: "project",
    projectId,
    contextRevision,
    sessionRef: { entityId: "session-1", versionId: "1" },
  });

  it("系统作用域不因工程切换而失效，会话变化才失效", () => {
    const opened = openConfirmation(systemPlan(), { kind: "allowed" });
    expect(opened.kind).toBe("reviewing");

    // 未选择工程、换工程都不影响系统管理确认：作用域没有工程字段可比。
    expect(invalidateConfirmation(opened, systemScope()).kind).toBe("reviewing");
    expect(invalidateConfirmation(opened, undefined).kind).toBe("closed");

    // 会话代次变化必须失效。
    expect(invalidateConfirmation(opened, systemScope("5")).kind).toBe("closed");
  });

  it("工程作用域在工程或修订变化时失效", () => {
    const opened = openConfirmation(plan(), { kind: "allowed" });
    expect(invalidateConfirmation(opened, projectScope("project-1", 3)).kind).toBe("reviewing");
    expect(invalidateConfirmation(opened, projectScope("project-1", 4)).kind).toBe("closed");
    expect(invalidateConfirmation(opened, projectScope("project-2", 3)).kind).toBe("closed");
    // 作用域判别不同即失效：工程确认不会因为出现了 system 作用域而续命。
    expect(invalidateConfirmation(opened, systemScope()).kind).toBe("closed");
  });

  it("会话标识和账号安全修订变化使确认失效，即使其它修订相同", () => {
    const project = plan();
    const opened = openConfirmation(project, { kind: "allowed" });
    expect(
      invalidateConfirmation(opened, {
        ...project.scope,
        sessionRef: { entityId: "session-2", versionId: "1" },
      }).kind,
    ).toBe("closed");
    const system = systemPlan();
    const systemOpened = openConfirmation(system, { kind: "allowed" });
    expect(
      invalidateConfirmation(systemOpened, {
        ...system.scope,
        sessionRef: { entityId: "session-2", versionId: "4" },
      }).kind,
    ).toBe("closed");
    expect(
      invalidateConfirmation(systemOpened, {
        ...system.scope,
        accountRef: { entityId: "account-admin", versionId: "4" },
      }).kind,
    ).toBe("closed");
  });

  it("批量部分失败保留原计划，重试完成前不宣称整批成功", async () => {
    const current = plan();
    const controller = createConfirmationController();
    controller.open(current, { kind: "allowed" });
    const error = makeSafeHttpError({ code: "TRANSIENT_FAILURE", retryable: true });
    expect(
      await controller.confirm(async () => ({
        kind: "batch-result",
        items: [
          { commandId: "done", outcome: { kind: "succeeded", result: success() } },
          { commandId: "retry", outcome: { kind: "failed", error } },
        ],
      })),
    ).toBe(false);
    expect(controller.getState().kind).toBe("retryable-failure");
    expect(
      await controller.retry(async (retried) => {
        expect(retried.commandId).toBe(current.commandId);
        return {
          kind: "batch-result",
          items: [
            { commandId: "done", outcome: { kind: "succeeded", result: success() } },
            { commandId: "retry", outcome: { kind: "succeeded", result: success("second") } },
          ],
        };
      }),
    ).toBe(true);
  });

  it.each(["STALE_VERSION", "IDEMPOTENCY_CONFLICT"] as const)(
    "批量中的 %s 优先于暂时失败并终止原计划",
    async (code) => {
      const controller = createConfirmationController();
      controller.open(plan(), { kind: "allowed" });
      await controller.confirm(async () => ({
        kind: "batch-result",
        items: [
          {
            commandId: "transient",
            outcome: {
              kind: "failed",
              error: makeSafeHttpError({ code: "TRANSIENT_FAILURE", retryable: true }),
            },
          },
          { commandId: "stale", outcome: { kind: "failed", error: makeSafeHttpError({ code }) } },
        ],
      }));
      expect(controller.getState()).toMatchObject({ kind: "terminal-failure", error: { code } });
    },
  );

  it("retryable-failure 同样参加失效，旧计划不得在上下文已变后重试", () => {
    const planValue = plan();
    const controller = createConfirmationController<typeof planValue>();
    expect(controller.open(planValue, { kind: "allowed" })).toBe(true);
    return controller
      .confirm(async () =>
        Promise.reject(makeSafeHttpError({ code: "TRANSIENT_FAILURE", retryable: true })),
      )
      .then(async () => {
        expect(controller.getState().kind).toBe("retryable-failure");
        controller.invalidate(projectScope("project-2", 3));
        expect(controller.getState().kind).toBe("closed");
        let calls = 0;
        expect(
          await controller.retry(async () => {
            calls += 1;
            return success();
          }),
        ).toBe(false);
        expect(calls).toBe(0);
      });
  });

  it("取消或失效后到达的迟到成功不得覆盖后来状态", async () => {
    const planValue = plan();
    const controller = createConfirmationController<typeof planValue>();
    expect(controller.open(planValue, { kind: "allowed" })).toBe(true);
    let release: ((value: ReturnType<typeof success>) => void) | undefined;
    const pending = controller.confirm(
      () => new Promise<ReturnType<typeof success>>((resolve) => (release = resolve)),
    );
    expect(controller.getState().kind).toBe("submitting");
    controller.invalidate(undefined);
    release?.(success("late"));
    expect(await pending).toBe(false);
    expect(controller.getState().kind).toBe("closed");
  });

  it("打开确认时拍快照并递归冻结：改源对象不改已确认载荷", () => {
    const mutable = systemPlan();
    const opened = openConfirmation(mutable, { kind: "allowed" });
    if (opened.kind !== "reviewing") throw new Error("expected reviewing");
    expect(Object.isFrozen(opened.plan.request)).toBe(true);
    expect(Object.isFrozen(opened.plan.scope)).toBe(true);
    // 嵌套载荷同样冻结：浅冻结会让已确认的嵌套请求保持可变。
    expect(Object.isFrozen(opened.plan.targets)).toBe(true);
  });

  it("快照与源对象解耦：打开后修改源对象不影响已确认的计划", () => {
    const mutable = { ...plan(), request: { projectId: "project-1", nested: { value: "a" } } };
    const opened = openConfirmation(mutable, { kind: "allowed" });
    if (opened.kind !== "reviewing") throw new Error("expected reviewing");
    (mutable.request.nested as { value: string }).value = "b";
    expect(opened.plan.request).toEqual({
      projectId: "project-1",
      nested: { value: "a" },
    });
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
