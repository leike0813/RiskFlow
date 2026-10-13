import { TextEncoder } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  createDeploymentAcceptanceRoutesV1,
  createDeploymentCandidateCheckpointProofV1,
  createRiskCandidatePolicyProviderV1,
} from "./composition/identification.mjs";
import { DeploymentAuthorizationError } from "../../packages/adapters/dist/auth/index.js";
import {
  candidateSetRefFor,
  identificationGroupRefFor,
  mergePlanRefFor,
} from "../../packages/core/dist/identification/candidate-finalization/index.js";
import { authorizationScopeDigest } from "../../packages/core/dist/retrieval/index.js";
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
            verified: Promise.resolve(),
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

const PROOF_PROJECT = "project-c37";
const PROOF_ACTOR = "actor-c37";
const PROOF_TIME = "2026-02-01T00:00:00.000Z";
const PROOF_MAX_BYTES = 8 * 1024 * 1024;
const proofReference = (entityId, versionId = "v1") => ({
  entityId,
  versionId,
});

const proofAuthorization = (overrides = {}) => ({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: proofReference("auth-context-c37"),
  },
  actorId: PROOF_ACTOR,
  projectId: PROOF_PROJECT,
  grantedCapabilities: ["risk-identification.read"],
  spatialScopeRefs: [{ kind: "spatial-scope", reference: proofReference("scope-c37") }],
  sourceAccessGrantRefs: [{ kind: "source-access-grant", reference: proofReference("grant-c37") }],
  authorizationPolicyRef: proofReference("access-policy"),
  decidedAt: PROOF_TIME,
  invocation: { kind: "human" },
  causalRunRef: { kind: "workflow-run", reference: proofReference("run-c37") },
  ...overrides,
});

const proofContentRef = (entityId) => ({
  kind: "content-artifact",
  reference: proofReference(entityId),
});

/**
 * 三类检查点的合成登记行与正文。字段形状沿用 C22 严格 Schema 的公开结构，
 * 其中的工程、版本、摘要与业务取值都是手工构造的合成值，不代表任何真实工程资料。
 */
const checkpointFixture = (kind) => {
  const authorization = proofAuthorization();
  const scopeDigest = authorizationScopeDigest(authorization);
  const requestDigest = "b".repeat(64);
  const inputSnapshotRef = {
    kind: "identification-input-snapshot",
    reference: proofReference("input-snapshot-c37"),
  };
  const workPlanRef = {
    kind: "identification-work-plan",
    reference: proofReference("work-plan-c37"),
  };
  const workItemRef = {
    kind: "identification-work-item",
    reference: proofReference("work-item-c37"),
  };
  const modelContextArtifactSetRef = {
    kind: "model-context-artifact-set",
    reference: proofReference("model-context-c37"),
  };
  const policySetRef = {
    kind: "identification-policy-set",
    reference: proofReference("policy-set-c37"),
  };
  const runRef = { kind: "workflow-run", reference: proofReference("identification-run-c37") };
  const common = {
    projectId: PROOF_PROJECT,
    inputSnapshotRef,
    authorizationScopeDigest: scopeDigest,
    authorizationContextRef: authorization.authorizationContextRef,
  };
  const commonRow = {
    ...common,
    resultId: "",
    resultVersionId: requestDigest,
    actorRef: PROOF_ACTOR,
    requestDigest,
  };
  const commonInput = {
    projectId: PROOF_PROJECT,
    actorId: PROOF_ACTOR,
    invocationId: "invocation-c37",
    requestedAt: PROOF_TIME,
    authorization,
    inputSnapshotRef,
  };

  if (kind === "candidate-set") {
    const checkpointRef = candidateSetRefFor({
      projectId: PROOF_PROJECT,
      workItemEntityId: workItemRef.reference.entityId,
      requestDigest,
    });
    return {
      checkpointRef,
      input: { ...commonInput, reference: checkpointRef },
      row: {
        ...commonRow,
        resultKind: "candidate-set",
        resultId: checkpointRef.reference.entityId,
        candidateSetRef: checkpointRef,
        workItemRef,
        modelContextArtifactSetRef,
        artifactRef: proofContentRef("candidate-set-artifact"),
      },
      body: {
        schemaVersion: "1",
        ...common,
        workItemRef,
        nodeId: "node-变径空间扩挖",
        modelContextArtifactSetRef,
        retrievalArtifactSetRef: {
          kind: "retrieval-artifact-set",
          reference: proofReference("retrieval-review-c37"),
        },
        modelContextPayloadDigest: "c".repeat(64),
        policySetRef,
        generationPolicyRef: proofReference("generation-policy"),
        modelDeploymentRef: proofReference("model-deployment"),
        promptTemplateRef: proofReference("prompt-template"),
        outputSchemaRef: proofReference("output-schema"),
        budgetPolicyRef: proofReference("budget-policy"),
        candidateSetVersion: 1,
        candidates: [
          {
            candidateId: "candidate-c37",
            candidateVersion: 1,
            projectId: PROOF_PROJECT,
            inputSnapshotRef,
            workItemRef,
            modelContextArtifactSetRef,
            nodeId: "node-变径空间扩挖",
            output: {
              riskSource: "扩径切削扰动",
              riskFactor: "掌子面支护不足",
              riskEvent: "掌子面失稳涌水",
              riskElementRelations: [
                { sourceElement: "扩挖机构", relation: "作用关系", targetElement: "掌子面" },
              ],
              evidenceLocator: { sourceSegmentId: "segment-mechanism" },
              modelConfidence: 0.31,
            },
            modelDeploymentRef: proofReference("model-deployment"),
            promptTemplateRef: proofReference("prompt-template"),
            outputSchemaRef: proofReference("output-schema"),
            budgetPolicyRef: proofReference("budget-policy"),
            rawResponseRef: {
              kind: "diagnostic-artifact",
              reference: proofReference("raw-response-c37"),
            },
            invocationId: "invocation-candidate",
            generatedAt: PROOF_TIME,
          },
        ],
        rawResponseRefs: [
          { kind: "diagnostic-artifact", reference: proofReference("raw-response-c37") },
        ],
        usage: {
          modelInvocations: 1,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          outputBytes: 100,
          elapsedMs: 5,
          repairRounds: 0,
        },
        generatedAt: PROOF_TIME,
      },
    };
  }

  if (kind === "merge-plan") {
    const checkpointRef = mergePlanRefFor({
      projectId: PROOF_PROJECT,
      workPlanEntityId: workPlanRef.reference.entityId,
      requestDigest,
    });
    return {
      checkpointRef,
      input: { ...commonInput, reference: checkpointRef, workPlanRef, runRef },
      row: {
        ...commonRow,
        resultKind: "merge-plan",
        resultId: checkpointRef.reference.entityId,
        mergePlanRef: checkpointRef,
        workPlanRef,
        artifactRef: proofContentRef("merge-plan-artifact"),
      },
      body: {
        schemaVersion: "1",
        ...common,
        workPlanRef,
        identificationRunRef: runRef,
        policySetRef,
        validatedCandidateSetRefs: [
          { kind: "validated-candidate-set", reference: proofReference("validated-set-a") },
        ],
        mergePolicyRef: proofReference("merge-policy"),
        embeddingDeploymentRef: proofReference("embedding-deployment"),
        embeddingArtifactRef: proofContentRef("embedding-artifact"),
        groups: [
          {
            groupId: "group-c37",
            groupVersionId: requestDigest,
            groupRef: {
              kind: "identification-group",
              reference: proofReference(
                `identification-group:${PROOF_PROJECT}:work-plan-c37:group-c37`,
                requestDigest,
              ),
            },
            disposition: "no-duplicate",
            memberCount: 1,
          },
        ],
        evaluatedCandidateRefs: [proofContentRef("candidate-artifact-candidate-c37")],
        plannedAt: PROOF_TIME,
      },
    };
  }

  const checkpointRef = identificationGroupRefFor({
    projectId: PROOF_PROJECT,
    workPlanEntityId: workPlanRef.reference.entityId,
    groupId: "group-c37",
    requestDigest,
  });
  return {
    checkpointRef,
    input: { ...commonInput, reference: checkpointRef, workPlanRef },
    row: {
      ...commonRow,
      resultKind: "identification-group",
      resultId: checkpointRef.reference.entityId,
      groupRef: checkpointRef,
      workPlanRef,
      artifactRef: proofContentRef("group-artifact"),
    },
    body: {
      schemaVersion: "1",
      ...common,
      workPlanRef,
      policySetRef,
      groupId: "group-c37",
      groupVersionId: requestDigest,
      nodeIds: ["node-变径空间扩挖"],
      members: [
        {
          candidateId: "candidate-c37",
          candidateVersion: 1,
          candidateRef: proofContentRef("candidate-artifact-candidate-c37"),
          workItemRef,
          nodeId: "node-变径空间扩挖",
          sourceSegmentIds: ["segment-mechanism"],
          mechanismEntryIds: ["mechanism-c37"],
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "segment-mechanism" },
              sourceVersion: proofReference("source-c37"),
            },
          ],
          modelConfidence: 0.8,
        },
      ],
      mergeEvidence: {
        processNode: {
          signal: "process-node",
          satisfied: true,
          nodeIds: ["node-变径空间扩挖"],
          allowedNodeIds: ["node-变径空间扩挖"],
        },
        riskEvent: { signal: "risk-event", value: 1, threshold: 0.9, satisfied: true },
        evidence: { signal: "evidence-locator", value: 1, threshold: 0.8, satisfied: true },
        aggregate: { value: 1, threshold: 0.8, satisfied: true },
      },
      disposition: "no-duplicate",
      skipReasonCode: "c37-synthetic-no-duplicate",
      mergePolicyRef: proofReference("merge-policy"),
      embeddingDeploymentRef: proofReference("embedding-deployment"),
      embeddingArtifactRef: proofContentRef("embedding-artifact"),
      groupedAt: PROOF_TIME,
    },
  };
};

const CHECKPOINT_KINDS = ["candidate-set", "merge-plan", "group"];

/** 组合根只提供 verifyContent：这里记录调用，并把正文交给生产侧传入的 validate。 */
const proveCheckpoint = async (kind, overrides = {}) => {
  const base = checkpointFixture(kind);
  const fixture = {
    ...base,
    ...overrides,
    input: { ...base.input, ...overrides.input },
    row: { ...base.row, ...overrides.row },
    body: { ...base.body, ...overrides.body },
  };
  const calls = [];
  const authorization = fixture.input.authorization;
  const proof = createDeploymentCandidateCheckpointProofV1({
    resultStore: {
      readResult: async (query) => (calls.push(["result", query]), fixture.row),
    },
    access: {
      verify: async (query) => (
        calls.push(["access", query]),
        overrides.decision ?? { redacted: false, context: authorization }
      ),
    },
    artifactStore: overrides.artifactStore ?? {
      verifyContent: async (request, maxBytes, validate) => {
        calls.push(["content", { request, maxBytes }]);
        return validate(new TextEncoder().encode(JSON.stringify(fixture.body)));
      },
    },
  });
  const outcome = await proof.verifyCheckpointReference(fixture.input).then(
    (value) => value,
    (error) => error,
  );
  return { outcome, calls };
};

describe("C37 候选检查点引用证明", () => {
  it.each(CHECKPOINT_KINDS)(
    "%s：精确登记行与合法正文给出证明，并按原权限与原用途读取正文",
    async (kind) => {
      const { outcome, calls } = await proveCheckpoint(kind);
      const base = checkpointFixture(kind);

      expect(outcome).toBe(true);
      expect(calls.find(([kind]) => kind === "access")?.[1]).toMatchObject({
        projectId: PROOF_PROJECT,
        branch: "risk-identification.run-read",
        authorizationContextRef: base.input.authorization.authorizationContextRef,
        requestedSpatialScopeRefs: base.input.authorization.spatialScopeRefs,
      });
      expect(calls.find(([kind]) => kind === "result")?.[1]).toEqual({
        projectId: PROOF_PROJECT,
        resultKind: base.row.resultKind,
        resultId: base.checkpointRef.reference.entityId,
        resultVersionId: base.checkpointRef.reference.versionId,
      });
      const contentRead = calls.find(([kind]) => kind === "content")?.[1];
      expect(contentRead.maxBytes).toBe(PROOF_MAX_BYTES);
      expect(contentRead.request).toMatchObject({
        projectId: PROOF_PROJECT,
        actorId: PROOF_ACTOR,
        artifactRef: base.row.artifactRef,
        authorization: base.input.authorization,
        requiredCapability: "risk-identification.read",
      });
      expect(typeof contentRead.request.purposeCode).toBe("string");
      expect(contentRead.request.purposeCode).not.toBe("");
    },
  );

  /** 每行一个风险根因；contentRead 表示拒绝前是否已读取正文。 */
  const rejected = [
    [
      "原权限已撤回",
      "candidate-set",
      {
        decision: {
          redacted: false,
          context: proofAuthorization({
            grantedCapabilities: [],
            decidedAt: "2026-01-01T00:00:00.000Z",
          }),
        },
      },
      false,
    ],
    ["授权已脱敏", "merge-plan", { decision: { redacted: true } }, false],
    [
      "当前上下文被收窄",
      "group",
      { decision: { redacted: false, context: proofAuthorization({ spatialScopeRefs: [] }) } },
      false,
    ],
    ["跨工程请求", "candidate-set", { input: { projectId: "project-other" } }, false],
    ["登记行属于其它 actor", "candidate-set", { row: { actorRef: "actor-other" } }, false],
    [
      "登记行引用不是请求引用",
      "merge-plan",
      { row: { resultId: "merge-plan:project-other" } },
      false,
    ],
    [
      "登记行输入快照不是原输入",
      "candidate-set",
      {
        row: {
          inputSnapshotRef: {
            kind: "identification-input-snapshot",
            reference: proofReference("input-snapshot-other"),
          },
        },
      },
      false,
    ],
    [
      "登记行工作计划不是原工作计划",
      "merge-plan",
      {
        row: {
          workPlanRef: {
            kind: "identification-work-plan",
            reference: proofReference("work-plan-other"),
          },
        },
      },
      false,
    ],
    [
      "登记行授权范围摘要不同",
      "group",
      { row: { authorizationScopeDigest: "c".repeat(64) } },
      false,
    ],
    [
      "正文授权上下文不是原授权",
      "group",
      {
        body: {
          authorizationContextRef: {
            kind: "authorization-context",
            reference: proofReference("auth-context-other"),
          },
        },
      },
      true,
    ],
    [
      "正文输入快照不是原输入",
      "candidate-set",
      {
        body: {
          inputSnapshotRef: {
            kind: "identification-input-snapshot",
            reference: proofReference("input-snapshot-other"),
          },
        },
      },
      true,
    ],
    [
      "正文工作计划不是原工作计划",
      "merge-plan",
      {
        body: {
          workPlanRef: {
            kind: "identification-work-plan",
            reference: proofReference("work-plan-other"),
          },
        },
      },
      true,
    ],
    [
      "正文候选工作项不是原工作项",
      "candidate-set",
      {
        body: {
          workItemRef: {
            kind: "identification-work-item",
            reference: proofReference("work-item-other"),
          },
        },
      },
      true,
    ],
    [
      "正文模型上下文集不是原上下文",
      "candidate-set",
      {
        body: {
          modelContextArtifactSetRef: {
            kind: "model-context-artifact-set",
            reference: proofReference("model-context-other"),
          },
        },
      },
      true,
    ],
    ["正文组身份不是登记行组", "group", { body: { groupId: "group-other" } }, true],
    [
      "正文 merge 运行不是原运行",
      "merge-plan",
      {
        body: {
          identificationRunRef: {
            kind: "workflow-run",
            reference: proofReference("identification-run-other"),
          },
        },
      },
      true,
    ],
    // 严格 Schema 解析失败时 validate 抛错，同样不给证明。
    ["正文含契约外字段", "candidate-set", { body: { contractOutsideField: "x" } }, true],
    ["工件存储不提供 verifyContent", "group", { artifactStore: {} }, false],
  ];

  it.each(rejected)("%s（%s）不给出证明", async (_label, kind, overrides, contentRead) => {
    const { outcome, calls } = await proveCheckpoint(kind, overrides);

    expect(outcome).not.toBe(true);
    expect(calls.some(([name]) => name === "content")).toBe(contentRead);
  });
});
