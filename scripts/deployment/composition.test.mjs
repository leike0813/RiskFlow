import { TextEncoder } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  createDeploymentAcceptanceRoutesV1,
  createRiskCandidatePolicyProviderV1,
} from "./composition/identification.mjs";
import { DeploymentAuthorizationError } from "../../packages/adapters/dist/auth/index.js";
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

const reference = (entityId, versionId) => ({ entityId, versionId });
const policySetRef = (projectId) => ({
  kind: "identification-policy-set",
  reference: reference(`policy-set:${projectId}`, "v1"),
});
const frozenProjectPolicies = (projectId) => {
  const setRef = Object.freeze({
    kind: "identification-policy-set",
    reference: Object.freeze(reference(`policy-set:${projectId}`, "v1")),
  });
  const member = (name) =>
    Object.freeze({
      policyRef: Object.freeze(reference(`${name}:${projectId}`, "v1")),
      policySetRef: setRef,
    });
  const graph = Object.freeze({
    policySetRef: setRef,
    modelDeploymentRef: Object.freeze(reference(`model:${projectId}`, "v1")),
    promptTemplateRef: Object.freeze(reference(`prompt:${projectId}`, "v1")),
    repairPolicyRef: member("validation").policyRef,
    mergePolicyRef: member("merge").policyRef,
    confidencePolicyRef: member("confidence").policyRef,
    forcedReviewPolicyRef: member("forced-review").policyRef,
  });
  const generation = Object.freeze({
    policyRef: Object.freeze(reference(`generation:${projectId}`, "v1")),
    policySetRef: setRef,
  });
  const riskCandidate = Object.freeze({
    generation,
    validation: member("validation"),
    merge: member("merge"),
    confidence: member("confidence"),
    forcedReview: member("forced-review"),
  });
  return {
    generation,
    policies: Object.freeze({
      "identification-graph": graph,
      "risk-candidate": riskCandidate,
    }),
  };
};

const acceptanceRouteSet = (projectId) => ({
  schemaVersion: "1",
  projectId,
  workPlanRef: { kind: "identification-work-plan", reference: reference("plan", "v1") },
  identificationRunRef: { kind: "workflow-run", reference: reference("run", "v1") },
  inputSnapshotRef: { kind: "identification-input-snapshot", reference: reference("input", "v1") },
  policySetRef: policySetRef(projectId),
  mergePlanRef: { kind: "merge-plan", reference: reference("merge", "v1") },
  confidencePolicyRef: reference("confidence", "v1"),
  forcedReviewPolicyRef: reference("forced-review", "v1"),
  routes: [
    {
      groupId: "group",
      groupVersionId: "group-v1",
      groupRef: { kind: "identification-group", reference: reference("group", "v1") },
      compositeConfidence: {
        value: 0.9,
        basis: [
          "model-confidence",
          "rule-consistency",
          "simulation-constraint",
          "multi-source-merge",
        ].map((source) => ({
          source,
          available: true,
          value: 0.9,
          weight: 0.25,
          contribution: 0.225,
        })),
        policyRef: reference("confidence", "v1"),
        missingBasisBehavior: "block",
        roundingDecimals: 2,
      },
      routeKind: "automatic",
      routeDecisionRef: { kind: "route-decision", reference: reference("decision", "v1") },
    },
  ],
  authorizationScopeDigest: "a".repeat(64),
  authorizationContextRef: { kind: "authorization-context", reference: reference("auth", "v1") },
  routedAt: "2026-01-01T00:00:00.000Z",
});

const acceptanceReadInput = (overrides = {}) => ({
  projectId: "project-a",
  actorId: "actor-a",
  requestedAt: "2026-01-01T00:00:00.000Z",
  acceptanceRouteSetRef: {
    kind: "acceptance-route-set",
    reference: reference("acceptance-route-set:project-a:plan", "route-version-1"),
  },
  authorization: {
    projectId: "project-a",
    actorId: "actor-a",
    grantedCapabilities: ["risk-identification.read"],
    spatialScopeRefs: [],
  },
  ...overrides,
});

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
  it("downstream 授权拒绝时不查询结果登记", async () => {
    const readResult = vi.fn();
    const provider = createDeploymentAcceptanceRoutesV1({
      resultStore: { readResult },
      artifactStore: { open: vi.fn() },
      authorizeDownstream: async () => {
        throw new DeploymentAuthorizationError(
          "DEPLOYMENT_AUTHORIZATION_NOT_ASSOCIATED",
          "risk-identification.run-read",
        );
      },
    });

    await expect(provider.readRoutes(acceptanceReadInput())).resolves.toBeUndefined();
    expect(readResult).not.toHaveBeenCalled();
  });

  it("缺少精确 acceptance-route-set 登记时不打开任何工件", async () => {
    const calls = [];
    const provider = createDeploymentAcceptanceRoutesV1({
      resultStore: { readResult: async (input) => (calls.push(input), undefined) },
      artifactStore: {
        open: async () => {
          throw new Error("must not open");
        },
      },
      authorizeDownstream: async () => acceptanceReadInput().authorization,
    });

    await expect(provider.readRoutes(acceptanceReadInput())).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        projectId: "project-a",
        resultKind: "acceptance-route-set",
        resultId: "acceptance-route-set:project-a:plan",
        resultVersionId: "route-version-1",
      },
    ]);
  });

  it("精确版本未登记时不回退到其它 acceptance-route-set 版本", async () => {
    const requested = acceptanceReadInput();
    const readVersions = [];
    const provider = createDeploymentAcceptanceRoutesV1({
      resultStore: {
        readResult: async (input) => {
          readVersions.push(input.resultVersionId);
          return undefined;
        },
      },
      artifactStore: {
        open: async () => {
          throw new Error("must not open");
        },
      },
      authorizeDownstream: async () => requested.authorization,
    });

    await expect(provider.readRoutes(requested)).resolves.toBeUndefined();
    expect(readVersions).toEqual(["route-version-1"]);
  });

  it("以登记行中的 C04 artifactRef 打开并返回通过原 Schema 的 routes", async () => {
    const requested = acceptanceReadInput();
    const routeSet = acceptanceRouteSet("project-a");
    const artifactRef = reference("c04-route-artifact", "artifact-v7");
    const opened = [];
    const calls = [];
    const provider = createDeploymentAcceptanceRoutesV1({
      resultStore: {
        readResult: async (input) => {
          calls.push(["result", input]);
          return {
            projectId: "project-a",
            resultKind: "acceptance-route-set",
            resultId: requested.acceptanceRouteSetRef.reference.entityId,
            resultVersionId: requested.acceptanceRouteSetRef.reference.versionId,
            requestDigest: "route-version-1",
            workPlanRef: routeSet.workPlanRef,
            mergePlanRef: routeSet.mergePlanRef,
            acceptanceRouteSetRef: requested.acceptanceRouteSetRef,
            artifactRef: { kind: "content-artifact", reference: artifactRef },
          };
        },
      },
      artifactStore: {
        open: async (input) => {
          opened.push(input);
          return {
            content: (async function* () {
              yield new TextEncoder().encode(JSON.stringify(routeSet));
            })(),
            completed: Promise.resolve(),
          };
        },
      },
      authorizeDownstream: async (input) => {
        calls.push(["authorize", input]);
        return requested.authorization;
      },
    });

    await expect(provider.readRoutes(requested)).resolves.toEqual(routeSet.routes);
    expect(calls.map(([kind]) => kind)).toEqual(["authorize", "result"]);
    expect(opened[0].artifactRef).toEqual({ kind: "content-artifact", reference: artifactRef });
    expect(opened[0].purposeCode).toBe("identification-acceptance-route-set");
    expect(opened[0].requiredCapability).toBe("risk-identification.read");
  });

  it("按工程冻结的策略集、模型和提示引用解析 C22 生成策略", async () => {
    const projects = new Map([
      ["project-a", frozenProjectPolicies("project-a")],
      ["project-b", frozenProjectPolicies("project-b")],
    ]);
    const provider = createRiskCandidatePolicyProviderV1(projects);

    for (const projectId of projects.keys()) {
      const policies = projects.get(projectId).policies;
      await expect(
        provider.resolveGeneration({
          projectId,
          inputSnapshotRef: {},
          policySetRef: policies["identification-graph"].policySetRef,
          modelDeploymentRef: policies["identification-graph"].modelDeploymentRef,
          promptTemplateRef: policies["identification-graph"].promptTemplateRef,
        }),
      ).resolves.toBe(policies["risk-candidate"].generation);
    }
  });

  it("拒绝跨工程或与冻结图策略不符的 C22 引用", async () => {
    const projects = new Map([["project-a", frozenProjectPolicies("project-a")]]);
    const provider = createRiskCandidatePolicyProviderV1(projects);
    const graph = projects.get("project-a").policies["identification-graph"];
    const input = {
      projectId: "project-a",
      inputSnapshotRef: {},
      policySetRef: graph.policySetRef,
      modelDeploymentRef: graph.modelDeploymentRef,
      promptTemplateRef: graph.promptTemplateRef,
    };

    await expect(
      provider.resolveGeneration({ ...input, projectId: "project-b" }),
    ).resolves.toBeUndefined();
    await expect(
      provider.resolveGeneration({
        ...input,
        modelDeploymentRef: reference("model:project-a", "v2"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.resolveGeneration({
        ...input,
        promptTemplateRef: reference("prompt:project-a", "v2"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.resolveGeneration({ ...input, policySetRef: policySetRef("project-b") }),
    ).resolves.toBeUndefined();
  });

  it("四类 C22 成员策略只按图策略集中的精确引用返回", async () => {
    const project = frozenProjectPolicies("project-a");
    const provider = createRiskCandidatePolicyProviderV1(new Map([["project-a", project]]));
    const graph = project.policies["identification-graph"];
    const cases = [
      ["resolveValidation", "repairPolicyRef", "validation"],
      ["resolveMerge", "mergePolicyRef", "merge"],
      ["resolveConfidence", "confidencePolicyRef", "confidence"],
      ["resolveForcedReview", "forcedReviewPolicyRef", "forcedReview"],
    ];

    for (const [method, refName, policyName] of cases) {
      const input = {
        projectId: "project-a",
        inputSnapshotRef: {},
        policySetRef: graph.policySetRef,
        [refName]: graph[refName],
      };
      await expect(provider[method](input)).resolves.toBe(
        project.policies["risk-candidate"][policyName],
      );
      await expect(
        provider[method]({ ...input, [refName]: reference("wrong-policy", "v2") }),
      ).resolves.toBeUndefined();
    }
  });

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
      "data-cleaning",
      "knowledge-authoring",
      "retrieval-review",
      "response-recommendation",
      "calibration-suggestion",
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

  it("一个资源关闭失败仍释放其余资源，并报告失败", async () => {
    const closed = [];
    const resources = new CompositionResourcesV1();
    resources.register(() => closed.push("database"));
    resources.register(() => {
      throw new Error("close failed");
    });
    await expect(resources.releaseAll()).rejects.toBeInstanceOf(AggregateError);
    expect(closed).toEqual(["database"]);
    expect(resources.size).toBe(0);
  });
});

// -------------------------------- C37 候选检查点引用证明（合成样本、待甲方复核）
