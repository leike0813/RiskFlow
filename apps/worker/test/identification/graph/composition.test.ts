import { describe, expect, it } from "vitest";

import {
  createIdentificationGraphComposition,
  type IdentificationGraphCompositionOptionsV1,
} from "../../../src/identification/graph/index.js";

/**
 * 组合根只做接线：全部必需依赖用最小替身注入，缺失任一项必须构造期失败（端口传递与真实
 * 运行行为由 `runtime.test.ts` 用真实 PostgreSQL、真实 checkpointer 与可控公开端口覆盖）。
 */
const requiredOptions = (): IdentificationGraphCompositionOptionsV1 =>
  ({
    db: {},
    transactionUnit: {},
    artifactStore: {},
    authorization: {},
    runtimeAuthorization: {},
    authorizeDownstream: async () => undefined,
    issueReadContext: async () => undefined,
    checkpointer: {},
    policyProvider: {},
    reviewPolicy: async () => ({}),
    basisResolver: {},
    preparationReader: {},
    knowledgeReleaseReader: {},
    contextService: {},
    agentTasks: {},
    agentTaskReader: {},
    finalizationService: {},
    reviewDecisionReader: {},
    acceptanceRoutes: {},
    recoveryConsumer: {},
    recoveryAuthorization: async () => undefined,
  }) as unknown as IdentificationGraphCompositionOptionsV1;

/** 与组合根 `REQUIRED_DEPENDENCIES_V1` 逐项对照的必需依赖表（缺任一项即拒绝构造）。 */
const REQUIRED_DEPENDENCIES = [
  "db",
  "transactionUnit",
  "artifactStore",
  "authorization",
  "runtimeAuthorization",
  "authorizeDownstream",
  "issueReadContext",
  "checkpointer",
  "policyProvider",
  "reviewPolicy",
  "basisResolver",
  "preparationReader",
  "knowledgeReleaseReader",
  "contextService",
  "agentTasks",
  "agentTaskReader",
  "finalizationService",
  "reviewDecisionReader",
  "acceptanceRoutes",
  "recoveryConsumer",
  "recoveryAuthorization",
] as const;

describe("C24 识别子图组合根", () => {
  it.each(REQUIRED_DEPENDENCIES)("缺少必需依赖 %s 时构造期失败闭合", (dependency) => {
    const options = { ...requiredOptions(), [dependency]: undefined } as never;
    expect(() => createIdentificationGraphComposition(options)).toThrow(
      new TypeError("identification graph composition requires every C03-C24 dependency"),
    );
  });

  it("只暴露登记面、端口、图、运行时与恢复消费者入口", () => {
    const options = requiredOptions();
    const composition = createIdentificationGraphComposition(options);
    expect(typeof composition.adapter.registerResults).toBe("function");
    expect(typeof composition.adapter.readWorkPlanBody).toBe("function");
    expect(typeof composition.registrationStore.readLatestRunState).toBe("function");
    expect(typeof composition.graph.invoke).toBe("function");
    expect(typeof composition.graph.resume).toBe("function");
    expect(typeof composition.runtime.start).toBe("function");
    expect(typeof composition.runtime.resume).toBe("function");
    expect(typeof composition.runtime.cancel).toBe("function");
    expect(typeof composition.consumeRecoveryEvent).toBe("function");
    // 端口逐项就是注入的公开端口：组合根不复制、不内建策略默认值，登记面同一实例。
    expect(composition.ports.transactionUnit).toBe(options.transactionUnit);
    expect(composition.ports.policyProvider).toBe(options.policyProvider);
    expect(composition.ports.finalizationService).toBe(options.finalizationService);
    expect(composition.ports.acceptanceRoutes).toBe(options.acceptanceRoutes);
    expect(composition.registrationStore).toBe(composition.adapter.registrationStore);
  });
});
