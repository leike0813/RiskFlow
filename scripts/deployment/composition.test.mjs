import { describe, expect, it } from "vitest";

import {
  CompositionResourcesV1,
  DeploymentCompositionIncompleteError,
  DeploymentCompositionNotReadyError,
  ProductionCompositionRootV1,
  REQUIRED_PRODUCTION_DEPENDENCIES_V1,
  SHARED_AGENT_TASK_KINDS_V1,
  SingleBindingV1,
  missingProductionDependenciesV1,
} from "./runtime.mjs";

/** 真实 provider 的占位：这里只验证装配契约，不接数据库。 */
const providers = (overrides = {}) => ({
  database: { name: "runtime" },
  transactionUnit: { execute: () => undefined },
  checkpointer: { getTuple: () => undefined },
  access: { authorize: () => undefined, verify: () => undefined },
  artifactStore: { put: () => undefined, open: () => undefined },
  referenceGuard: { assertUsable: () => undefined },
  modelGateway: { completeStructured: () => undefined },
  ocr: { parse: () => undefined },
  review: { decideReview: () => undefined },
  idempotentConsumer: { claim: () => undefined },
  agentTaskRegistry: { register: () => undefined },
  policyCatalog: { resolve: () => undefined },
  qualityGate: { evaluate: () => undefined },
  ...overrides,
});

describe("生产组合根装配契约", () => {
  it("缺任一必需依赖即构造失败，不允许以占位实现补位", () => {
    expect(missingProductionDependenciesV1(providers())).toEqual([]);
    for (const name of REQUIRED_PRODUCTION_DEPENDENCIES_V1) {
      const incomplete = providers({ [name]: undefined });
      expect(missingProductionDependenciesV1(incomplete), `缺少 ${name} 时应报缺`).toContain(name);
      expect(() => new ProductionCompositionRootV1(incomplete)).toThrow(
        DeploymentCompositionIncompleteError,
      );
    }
  });

  it("缺依赖时错误只列缺失名称，不泄露其它 provider 内容", () => {
    const incomplete = providers({ modelGateway: undefined, policyCatalog: undefined });
    let captured;
    try {
      new ProductionCompositionRootV1(incomplete);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(DeploymentCompositionIncompleteError);
    expect([...captured.missing].sort()).toEqual(["modelGateway", "policyCatalog"]);
    expect(captured.message).not.toContain("qdrant");
  });

  it("委派绑定前调用一律抛未就绪，不返回静默成功", () => {
    const slot = new SingleBindingV1("knowledge.retrieval");
    expect(() => slot.use()).toThrow(DeploymentCompositionNotReadyError);
    expect(() => slot.useMethod("retrieve")).toThrow(DeploymentCompositionNotReadyError);

    slot.bind((request) => `resolved:${request}`);
    expect(slot.use("x")).toBe("resolved:x");
    expect(slot.isBound).toBe(true);
  });

  it("委派只能绑定一次，重复绑定失败关闭", () => {
    const slot = new SingleBindingV1("identification.queryInput");
    slot.bind(() => undefined);
    expect(() => slot.bind(() => undefined)).toThrow(TypeError);
  });

  it("绑定后的委派缺失方法时同样失败关闭，不返回 undefined", () => {
    const slot = new SingleBindingV1("knowledge.retrieval");
    slot.bind({});
    expect(() => slot.useMethod("retrieve")).toThrow(DeploymentCompositionNotReadyError);
  });

  it("存在构造引用环时必须先建组合根、最后绑定委派，未绑定不得监听", () => {
    const composition = new ProductionCompositionRootV1(providers());
    expect(() => composition.assertReady()).toThrow(DeploymentCompositionNotReadyError);

    composition.bindDelegates({
      knowledgeRetrieval: { retrieve: async () => ({ kind: "succeeded" }) },
      identificationQueryInput: { readQueryInput: async () => ({ kind: "succeeded" }) },
    });
    expect(composition.assertReady()).toBe(composition);
    expect(composition.knowledgeRetrievalDelegate.isBound).toBe(true);
    expect(composition.identificationQueryInputDelegate.isBound).toBe(true);
  });

  it("五类 Agent 任务在同一 registry 上注册，顺序固定", () => {
    const registered = [];
    const registry = { register: (kind) => registered.push(kind) };
    const composition = new ProductionCompositionRootV1(providers({ agentTaskRegistry: registry }));
    for (const kind of SHARED_AGENT_TASK_KINDS_V1) registry.register(kind);
    expect(registered).toEqual([
      "cleaning",
      "knowledge",
      "retrieval-review",
      "response-recommendation",
      "calibration",
    ]);
    // 组合根持有注入的同一 registry，五类任务因此共用同一持久任务集合。
    expect(composition.providers.agentTaskRegistry).toBe(registry);
  });

  it("装配失败释放已创建资源，逆序关闭", async () => {
    const closed = [];
    const resources = new CompositionResourcesV1();
    resources.register(() => closed.push("first"));
    resources.register(() => closed.push("second"));
    expect(resources.size).toBe(2);
    await resources.releaseAll();
    expect(closed).toEqual(["second", "first"]);
    expect(resources.size).toBe(0);
  });

  it("组合根关闭时释放已登记资源", async () => {
    const closed = [];
    const composition = new ProductionCompositionRootV1(providers());
    composition.resources.register(() => closed.push("artifact"));
    await composition.close();
    expect(closed).toEqual(["artifact"]);
  });
});
