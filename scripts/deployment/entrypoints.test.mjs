/**
 * C37 D-22：交付取证的 CLI 入口必须指向真实存在的脚本。
 *
 * 入口脚本名曾指向不存在的文件（`smoke.mjs`/`benchmark.mjs`）或把子命令当作清单路径
 * （`release.mjs verify`），结果是取证命令在任何机器上都以 ENOENT 失败，无法区分
 * 「命令坏了」与「交付输入缺件」。这里锁住「package.json 里每个交付 CLI 都解析到真实文件」。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import deploymentConfig from "../../deployment/config.example.json" with { type: "json" };
import {
  createDeploymentAuthorizedArtifactStoreV1,
  createDeploymentAuthorizedModelGatewayV1,
  createDeploymentAuthorizationScopeV1,
  createDeploymentRuntimeAuthorizationV1,
  createDeploymentScoringGovernanceV1,
  resolveDeploymentPoliciesV1,
} from "./start.mjs";
import { AccessServiceError } from "../../packages/core/dist/access/index.js";
import { structuredRequest, testRequestBase } from "../../packages/adapters/test/model/fixture.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

describe("评分治理生产装配", () => {
  it("共享治理尚未绑定和重复绑定均拒绝启动", () => {
    const scoring = createDeploymentScoringGovernanceV1({
      foundation: {
        runtime: { db: {} },
        transactionUnit: {},
        artifactStore: {},
        access: {},
        referenceGuard: {},
        contextSource: {},
        config: { projectBindings: [{ projectId: "p-1" }] },
      },
      resolveDeploymentPolicies: {
        resolveProject: () => ({ policies: { "scoring-rules": {} } }),
      },
      authorizeDownstream: async () => {
        throw new Error("must not authorize on construction");
      },
      review: {},
    });
    expect(() => scoring.assertReady()).toThrow(TypeError);
    const composition = {
      compositions: {
        knowledge: { governedReleases: { resolveGovernedReleases: async () => undefined } },
        cleaning: {
          agentTaskAdapter: { getTask: async () => undefined },
          store: { readBoundResult: async () => undefined, loadFrozenInput: async () => undefined },
        },
      },
    };
    scoring.bind(composition);
    expect(() => scoring.assertReady()).not.toThrow();
    expect(() => scoring.bind(composition)).toThrow(TypeError);
    expect(() => scoring.basis.resolve({ projectId: "other-project" })).toThrow(TypeError);
  });
});

describe("本地工件的当前权限复验", () => {
  const authorization = testRequestBase.authorization;
  const common = {
    schemaVersion: "1",
    projectId: authorization.projectId,
    actorId: authorization.actorId,
    requiredCapability: authorization.grantedCapabilities[0],
    authorization,
    idempotencyKey: "artifact-boundary",
    purposeCode: "model-raw-response",
  };
  const put = {
    ...common,
    commandId: "artifact-put-boundary",
    issuedAt: authorization.decidedAt,
    artifactId: "artifact-boundary",
    artifactKind: "content",
    mediaType: "application/json",
    parentArtifactRefs: [],
    evidenceReferences: [],
    additionalSpatialScopeRefs: [],
    additionalSourceAccessGrantRefs: [],
  };
  const open = {
    ...common,
    requestId: "artifact-open-boundary",
    requestedAt: authorization.decidedAt,
    artifactRef: {
      kind: "content-artifact",
      reference: {
        entityId: "artifact-boundary",
        versionId: `sha256:${"a".repeat(64)}`,
      },
    },
  };
  it.each(["put", "open"])("%s 复验失败时不产生工件副作用", async (method) => {
    let called = false;
    const store = createDeploymentAuthorizedArtifactStoreV1({
      store: {
        [method]: async () => {
          called = true;
        },
      },
      access: {
        verifyDeploymentContext: async () => {
          throw { details: { code: "AUTHORIZATION_DENIED" } };
        },
      },
    });
    await expect(store[method](method === "put" ? put : open, [])).rejects.toMatchObject({
      code: "ARTIFACT_ACCESS_DENIED",
    });
    expect(called).toBe(false);
  });
  it("put/open 使用复验的持久上下文，保留命令身份与流句柄", async () => {
    const verified = structuredClone(authorization);
    const seen = [];
    const handle = { content: [], verified: Promise.resolve({}) };
    const store = createDeploymentAuthorizedArtifactStoreV1({
      access: {
        verifyDeploymentContext: async (input) => {
          expect(input.authorizationContextRef).toEqual(authorization.authorizationContextRef);
          return { context: verified };
        },
      },
      store: {
        put: async (command, content) => {
          seen.push(command);
          return content;
        },
        open: async (request) => {
          seen.push(request);
          return handle;
        },
      },
    });
    const content = [];
    expect(await store.put(put, content)).toBe(content);
    expect(await store.open(open)).toBe(handle);
    expect(seen[0].authorization).toBe(verified);
    expect(seen[0].commandId).toBe(put.commandId);
    expect(seen[1].authorization).toBe(verified);
    expect(seen[1].requestId).toBe(open.requestId);
  });
});

describe("模型宿主的当前权限复验", () => {
  const requests = {
    completeStructured: structuredRequest(),
    embed: {
      ...testRequestBase,
      texts: ["工程文本"],
      maxInputBytes: 1024,
      maxBatchItems: 1,
    },
    streamConversation: {
      ...testRequestBase,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "工程文本" }],
      maxOutputTokens: 128,
    },
  };
  it.each(Object.keys(requests))("%s 无父工件也必须复验，拒权不调用模型", async (method) => {
    let called = false;
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: {
        verifyDeploymentContext: async () => {
          throw { details: { code: "AUTHORIZATION_DENIED" } };
        },
      },
      gateway: {
        [method]: () => {
          called = true;
        },
      },
    });
    if (method === "streamConversation") {
      const handle = gateway[method](requests[method]);
      await expect(handle.deltas.next()).rejects.toMatchObject({
        code: "MODEL_AUTHORIZATION_DENIED",
      });
      await expect(handle.completed).rejects.toMatchObject({
        code: "MODEL_AUTHORIZATION_DENIED",
      });
    } else {
      await expect(gateway[method](requests[method])).rejects.toMatchObject({
        code: "MODEL_AUTHORIZATION_DENIED",
      });
    }
    expect(called).toBe(false);
  });
  it("权限服务故障保持可重试技术错误", async () => {
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: {
        verifyDeploymentContext: async () => {
          throw { details: { code: "ACCESS_TRANSIENT_FAILURE" } };
        },
      },
      gateway: {},
    });
    await expect(gateway.completeStructured(requests.completeStructured)).rejects.toMatchObject({
      code: "MODEL_SERVICE_UNAVAILABLE",
      retryable: true,
    });
  });
  it("流在复验后创建并保留增量与终态", async () => {
    const verified = structuredClone(testRequestBase.authorization);
    const receipt = { invocationId: testRequestBase.invocationId };
    const delta = { text: "工程文本" };
    let seen;
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: { verifyDeploymentContext: async () => ({ context: verified }) },
      gateway: {
        streamConversation: (request) => {
          seen = request;
          return {
            deltas: (async function* () {
              yield delta;
            })(),
            completed: Promise.resolve(receipt),
          };
        },
      },
    });
    const handle = gateway.streamConversation(requests.streamConversation);
    expect(seen).toBeUndefined();
    expect((await handle.deltas.next()).value).toBe(delta);
    expect(await handle.completed).toBe(receipt);
    expect(seen.authorization).toBe(verified);
  });
});

const DELIVERY_CLI_PREFIXES = ["deployment:", "desktop:", "acceptance:"];

const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts ?? {};

const deliveryCliEntries = Object.entries(scripts).filter(([name]) =>
  DELIVERY_CLI_PREFIXES.some((prefix) => name.startsWith(prefix)),
);

const ref = (entityId) => ({ entityId, versionId: "v1" });
const policyTypes = [
  "cleaning",
  "knowledge-validation",
  "hybrid-retrieval",
  "retrieval-acceptance",
  "retrieval-review",
  "risk-candidate",
  "identification-graph",
  "retry",
  "assessment-runtime",
  "warning-runtime",
  "response-generation",
  "response-validation",
  "response-agent",
  "calibration",
  "scoring-rules",
  "report-export",
];
const policyRefs = Object.fromEntries(
  policyTypes.map((type) => [
    type,
    type === "identification-graph" ? ref("identification-policy-set") : ref(`${type}-policy`),
  ]),
);
const chatModelRef = deploymentConfig.models[0].config.deploymentRef;
const embeddingModelRef = ref("embedding-model");
const policySetRef = policyRefs["identification-graph"];
const approval = {
  approvedBy: "operator-01",
  approvedAt: "2030-01-01T00:00:00.000Z",
  releaseId: deploymentConfig.releaseId,
};

const agentBudget = (name, modelDeploymentRef = chatModelRef) => ({
  schemaVersion: "1",
  policyRef: ref(`${name}-budget`),
  modelDeploymentRef,
  promptTemplateRef: ref(`${name}-prompt`),
  toolPolicyRef: ref(`${name}-tools`),
  maxModelInvocations: 2,
  maxToolInvocations: 4,
  maxContextTokens: 4096,
  maxInputBytes: 4096,
  maxOutputBytes: 4096,
  maxCandidates: 2,
  maxObjects: 16,
  maxSupplementarySearches: 0,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 60_000,
});

const agentFields = (name, budget = agentBudget(name)) => ({
  definitionRef: ref(`${name}-definition`),
  modelDeploymentRef: budget.modelDeploymentRef,
  promptTemplateRef: budget.promptTemplateRef,
  toolPolicyRef: budget.toolPolicyRef,
  budgetPolicyRef: budget.policyRef,
  incrementSchemaRef: ref(`${name}-increment`),
  validationPolicyRef: ref(`${name}-validation`),
  budgetPolicy: budget,
});

const sharedAgentFields = (name) => {
  const budgetPolicy = agentBudget(name);
  return {
    definitionRef: ref(`${name}-definition`),
    toolPolicyRef: budgetPolicy.toolPolicyRef,
    incrementSchemaRef: ref(`${name}-increment`),
    validationPolicyRef: ref(`${name}-validation`),
    budgetPolicy,
  };
};

const retry = {
  schemaVersion: "1",
  policyRef: policyRefs.retry,
  maxAttempts: 3,
  backoffMs: 250,
};
const riskCandidate = {
  generation: {
    schemaVersion: "1",
    policyRef: ref("candidate-generation"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    outputSchemaRef: ref("candidate-output-schema"),
    budgetPolicyRef: ref("candidate-generation-budget"),
    budget: {
      maxCandidates: 4,
      maxOutputBytes: 4096,
      maxTotalTokens: 1000,
      maxWallClockMs: 5000,
      maxRepairRounds: 1,
    },
  },
  validation: {
    schemaVersion: "1",
    policyRef: ref("candidate-validation"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    ruleValidationPolicyRef: ref("candidate-rule-validation"),
    allowedMechanismTypes: [],
    requiredMechanismTypes: [],
    requiredRelationTypes: [],
    repairableReasonCodes: [
      "candidate-schema-invalid",
      "candidate-node-mismatch",
      "candidate-relation-endpoint-missing",
      "candidate-evidence-not-frozen",
      "candidate-mechanism-not-applicable",
    ],
  },
  merge: {
    schemaVersion: "1",
    policyRef: ref("candidate-merge"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    embeddingDeploymentRef: embeddingModelRef,
    embeddingBudgetPolicyRef: ref("candidate-embedding-budget"),
    relatedNodeIds: [],
    riskEventCosineThreshold: 0.9,
    evidenceSetSimilarityThreshold: 0.8,
    weights: { processNode: 0.4, riskEvent: 0.35, evidence: 0.25 },
    groupThreshold: 0.8,
    maxGroupMembers: 4,
    memberOrder: "candidate-ref-ascending",
    tieBreak: "lexicographically-smallest-candidate-ref",
  },
  confidence: {
    schemaVersion: "1",
    policyRef: ref("candidate-confidence"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    weights: {
      modelConfidence: 0.4,
      ruleConsistency: 0.3,
      simulationConstraint: 0.1,
      multiSourceMerge: 0.2,
    },
    requiredBasis: ["model-confidence"],
    missingBasisBehavior: "block",
    roundingDecimals: 2,
  },
  forcedReview: {
    schemaVersion: "1",
    policyRef: ref("candidate-forced-review"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    autoAcceptanceThreshold: 0.9,
    forcedReviewReasonCodes: [],
    reviewPolicyRef: ref("candidate-review"),
  },
};

const bodiesForProject = (projectId) => {
  const cleaningAgent = agentFields("cleaning");
  const knowledgeAgent = agentFields("knowledge-validation");
  const retryPolicyRef = policyRefs.retry;
  const warningAggregationPolicy = {
    schemaVersion: "1",
    policyRef: ref("warning-aggregation"),
    projectId,
    responseDirectionByTriggerType: {
      风险等级超过风险可接受阈值: "direction-risk",
      监测指标越限: "direction-monitoring",
      "趋势/加速度/异常评分越限": "direction-trend",
      多指标联合规则命中: "direction-joint",
    },
  };
  const notificationPolicy = {
    schemaVersion: "1",
    policyRef: ref("notification"),
    projectId,
    channel: "in-app",
    recipientActorIds: ["operator-01"],
  };
  const hybridRetrieval = {
    schemaVersion: "1",
    policyRef: policyRefs["hybrid-retrieval"],
    evidenceBaseDefinitionType: "retrieval-evidence-base",
    modelDeploymentRef: embeddingModelRef,
    dense: { vectorName: "dense", dimensions: 8, distance: "cosine" },
    bm25: {
      vectorName: "bm25",
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "zh-CN",
      stemmer: "none",
      stopwords: [],
    },
    densePrefetchLimit: 5,
    bm25PrefetchLimit: 5,
    topK: 5,
    rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
    memberBatchLimit: 10,
    memberByteLimit: 1024,
    memberLimit: 10,
    embeddingTimeoutMs: 1000,
    projectionTimeoutMs: 1000,
    acceptancePolicyRef: policyRefs["retrieval-acceptance"],
    projectionCompatibilityRef: ref("projection-compatibility"),
  };
  const assessmentRuntime = {
    schemaVersion: "1",
    projectId,
    warningAggregationPolicyRef: warningAggregationPolicy.policyRef,
    notificationPolicyRef: notificationPolicy.policyRef,
    responseGenerationPolicyRef: policyRefs["response-generation"],
    responseValidationPolicyRef: policyRefs["response-validation"],
    responseAgentPolicyRef: policyRefs["response-agent"],
    calibrationAgentPolicyRef: policyRefs.calibration,
    retryPolicyRef,
    reviewPolicyRef: ref("assessment-review"),
    modelDeploymentRef: chatModelRef,
    promptTemplateRef: ref("assessment-prompt"),
  };
  return {
    cleaning: {
      schemaVersion: "1",
      policyRef: policyRefs.cleaning,
      allowedConversionPolicyRefs: [ref("conversion-policy")],
      allowedQualityPolicyRefs: [ref("quality-policy")],
      allowedConverterDeploymentRefs: [ref("converter-deployment")],
      allowedExclusionReasonCodes: ["duplicate-content"],
      protectedSegmentKinds: ["monitoring-window"],
      requiredSegmentKinds: ["chapter"],
      protectedMonitoringSelectionReasons: ["latest-valid"],
      minimumRetainedSegmentRatio: 0.5,
      minimumRetainedSampleRatio: 0.5,
      minimumDocumentCoverageRatio: 0.5,
      tools: {
        documentSegmentToolRef: ref("document-segment-tool"),
        monitoringSnapshotToolRef: ref("monitoring-snapshot-tool"),
        maxSegmentsPerRead: 10,
        maxMonitoringItemsPerRead: 10,
      },
      agent: cleaningAgent,
    },
    "knowledge-validation": {
      schemaVersion: "1",
      policyRef: policyRefs["knowledge-validation"],
      criticalProcessKinds: ["扩径准备"],
      coverage: [{ processKind: "扩径准备", minimumMechanisms: 1, minimumEvidence: 1 }],
      allowedStandardLevels: ["national"],
      allowedCaseConstructionMethods: ["盾构"],
      maxEntriesPerPackage: 128,
      tools: {
        segmentSliceToolRef: ref("knowledge-segment-slice"),
        baselineKnowledgeToolRef: ref("knowledge-baseline-read"),
      },
      agent: {
        ...agentFields("knowledge-validation", knowledgeAgent.budgetPolicy),
        budgetPolicyRef: knowledgeAgent.budgetPolicyRef,
      },
    },
    "hybrid-retrieval": hybridRetrieval,
    "retrieval-acceptance": {
      schemaVersion: "1",
      acceptancePolicyRef: policyRefs["retrieval-acceptance"],
      datasetRef: ref("retrieval-dataset"),
      syntheticSample: true,
      topK: 5,
      denseRecallAt5Min: 0.8,
      bm25RecallAt5Min: 0.8,
      rrfRecallAt5Min: 0.85,
      rrfNdcgAt5Min: 0.75,
      reconciliationRatioMin: 1,
      authorizationLeakageMax: 0,
      qdrantQueryP95MsMax: 120,
      warmupRuns: 1,
      measuredRuns: 3,
    },
    "retrieval-review": {
      schemaVersion: "1",
      policyRef: policyRefs["retrieval-review"],
      definitionRef: ref("retrieval-review-definition"),
      toolPolicyRef: ref("retrieval-review-tools"),
      incrementSchemaRef: ref("retrieval-review-increment"),
      validationPolicyRef: ref("retrieval-review-validation"),
      readFrozenResultToolRef: ref("read-frozen-result"),
      resupplementToolRef: ref("resupplement"),
      budgetPolicyRef: ref("retrieval-review-budget"),
      modelDeploymentRef: chatModelRef,
      promptTemplateRef: ref("retrieval-review-prompt"),
      maxCandidateMembers: 8,
      maxResupplements: 2,
      allowedSupplementIntentCodes: ["settlement"],
      modelMaxOutputTokens: 1024,
    },
    "risk-candidate": riskCandidate,
    "identification-graph": {
      schemaVersion: "1",
      policySetRef: {
        kind: "identification-policy-set",
        reference: policySetRef,
      },
      retrievalPolicyRef: hybridRetrieval.policyRef,
      retrievalReviewAgentPolicyRef: policyRefs["retrieval-review"],
      repairPolicyRef: riskCandidate.validation.policyRef,
      confidencePolicyRef: riskCandidate.confidence.policyRef,
      forcedReviewPolicyRef: riskCandidate.forcedReview.policyRef,
      mergePolicyRef: riskCandidate.merge.policyRef,
      ruleValidationPolicyRef: riskCandidate.validation.ruleValidationPolicyRef,
      retryPolicyRef,
      modelDeploymentRef: chatModelRef,
      promptTemplateRef: ref("identification-graph-prompt"),
      retryPolicy: retry,
    },
    retry,
    "assessment-runtime": assessmentRuntime,
    "warning-runtime": {
      schemaVersion: "1",
      projectId,
      warningAggregationPolicy,
      notificationPolicy,
    },
    "response-generation": {
      schemaVersion: "1",
      policyRef: policyRefs["response-generation"],
      projectId,
      bindings: [],
    },
    "response-validation": {
      schemaVersion: "1",
      policyRef: policyRefs["response-validation"],
      projectId,
      targetIndicators: [{ indicatorItem: "indicator-1", targetValue: 5 }],
      reviewedStandardEvidence: [],
      contraindicationRules: [],
      executableProcessStatuses: ["掘进"],
    },
    "response-agent": {
      schemaVersion: "1",
      policyRef: policyRefs["response-agent"],
      projectId,
      ...sharedAgentFields("response-agent"),
    },
    calibration: {
      schemaVersion: "1",
      policyRef: policyRefs.calibration,
      projectId,
      ...sharedAgentFields("calibration"),
      evidenceRequirementCount: 1,
      maxOperations: 1,
    },
    "scoring-rules": {
      schemaVersion: "1",
      policyRef: policyRefs["scoring-rules"],
      compatibilityRef: ref("scoring-compatibility"),
      assemblyPolicyRef: ref("scoring-assembly"),
      conflictPriorityPolicyRef: ref("scoring-conflict-priority"),
      allowedSourceStandardKinds: ["national"],
      tools: {
        standardSegmentToolRef: ref("scoring-standard-segment"),
        indicatorCatalogToolRef: ref("scoring-indicator-catalog"),
        maxSegmentsPerRead: 16,
        maxIndicatorsPerRead: 16,
      },
      agent: agentFields("scoring"),
    },
    "report-export": {
      schemaVersion: "1",
      policyRef: policyRefs["report-export"],
      format: "json",
      queryTypes: ["risk-overview"],
      sections: ["run-summary", "report-fact", "report-absence"],
      maxPages: 2,
      maxItems: 20,
      maxBytes: 65_536,
    },
  };
};

const bindingFor = (projectId) => ({
  ...structuredClone(deploymentConfig.projectBindings[0]),
  projectId,
  policyCatalogRef: structuredClone(deploymentConfig.policyCatalog.catalogRef),
  policyRefs: structuredClone(policyRefs),
});

const deploymentPolicies = (projectIds = ["project-rail-01", "project-rail-02"]) => {
  const config = structuredClone(deploymentConfig);
  config.projectBindings = projectIds.map(bindingFor);
  config.models.push({
    backend: "network-api",
    config: {
      schemaVersion: "1",
      protocol: "ollama-embed",
      deploymentRef: embeddingModelRef,
      serviceContractRef: ref("embedding-service"),
      modelVersionRef: ref("embedding-model-version"),
      baseUrl: "http://192.168.13.11:11434",
      modelId: "embedding-model",
      capabilities: ["embed"],
      embeddingDimensions: 8,
      contextWindowTokens: 4096,
      requestTimeoutMs: 30_000,
      streamIdleTimeoutMs: 10_000,
      maxResponseBytes: 1_048_576,
      maxInputBytes: 65_536,
      maxBatchItems: 1,
      inputTokenUpperBoundPolicy: {
        maxTokensPerInputByte: 1,
        requestOverheadTokens: 64,
      },
      expectedServerVersion: "0.5.0",
      expectedModelDigest: "a".repeat(64),
    },
  });
  const entries = projectIds.flatMap((projectId) =>
    Object.entries(bodiesForProject(projectId)).map(([policyType, body]) => ({
      schemaVersion: 1,
      projectId,
      policyType,
      policyRef: policyRefs[policyType],
      approval: structuredClone(approval),
      body: structuredClone(body),
    })),
  );
  return {
    config,
    catalog: {
      schemaVersion: 1,
      catalogRef: structuredClone(config.policyCatalog.catalogRef),
      downstreamAuthorization: {
        policyRef: ref("downstream-authorization"),
        bindings: [
          { rootBranch: "workflow.start-run", downstreamBranches: ["agent-task.start-task"] },
        ],
      },
      purpose: config.purpose,
      entries,
    },
  };
};

const expectPolicyCode = (run, code) => {
  let error;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error?.code ?? error?.message).toBe(code);
};

describe("部署策略绑定解析", () => {
  it("解析完整的 14 类目录，并允许不同工程仅在 Agent 正文 projectId 上不同", () => {
    const { config, catalog } = deploymentPolicies();
    const resolved = resolveDeploymentPoliciesV1({ config, catalog });

    for (const projectId of ["project-rail-01", "project-rail-02"]) {
      const project = resolved.resolveProject(projectId);
      expect(Object.keys(project.policies)).toHaveLength(16);
      expect(project.policies["response-agent"].projectId).toBe(projectId);
      expect(project.policies.calibration.projectId).toBe(projectId);
    }
  });

  it("catalog 完整版本引用不一致时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    config.policyCatalog.catalogRef.versionId = "2";

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_CATALOG_IDENTITY_MISMATCH",
    );
  });

  it("目录中任一策略的批准 release 与部署 release 不一致时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    catalog.entries[0].approval.releaseId = "release-other";

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_RELEASE_MISMATCH",
    );
  });

  it("工程绑定引用缺失策略版本时不回退到目录中的其他版本", () => {
    const { config, catalog } = deploymentPolicies();
    config.projectBindings[0].policyRefs.calibration = ref("calibration-other");

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_NOT_FOUND",
    );
  });

  it("graph 与候选策略的 retry 成员引用漂移时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    const retryEntry = catalog.entries.find(
      (entry) => entry.projectId === "project-rail-01" && entry.policyType === "retry",
    );
    const changedRetryRef = ref("retry-v2");
    config.projectBindings[0].policyRefs.retry = changedRetryRef;
    retryEntry.policyRef = changedRetryRef;
    retryEntry.body.policyRef = changedRetryRef;

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_MEMBER_MISMATCH",
    );
  });

  it("多工程共享 Agent 策略的预算不同则拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    const policy = catalog.entries.find(
      (entry) => entry.projectId === "project-rail-02" && entry.policyType === "response-agent",
    );
    policy.body.budgetPolicy.maxModelInvocations = 3;

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_SHARED_AGENT_POLICY_MISMATCH",
    );
  });

  it("embedding 模型维度与 hybrid 策略不符时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    config.models.find(
      ({ config: model }) => model.deploymentRef.entityId === embeddingModelRef.entityId,
    ).config.embeddingDimensions = 16;

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_MODEL_MISMATCH",
    );
  });
});

describe("运行授权精确复验", () => {
  const authorization = testRequestBase.authorization;
  const setup = () => {
    const calls = [];
    const source = {
      context: authorization,
      branch: "workflow.start-run",
      invocationId: "original-command",
      sourceVersionRefs: [],
    };
    const access = {
      readDeploymentAuthorizationSource: async () => source,
      verify: async (input) => {
        calls.push(input);
        return { context: authorization };
      },
    };
    const downstream = [];
    const derivedContext = { ...authorization, grantedCapabilities: ["risk-identification.read"] };
    const port = createDeploymentRuntimeAuthorizationV1({
      access,
      authorizationScope: {
        authorizeDownstream: async (input) => {
          downstream.push(input);
          return derivedContext;
        },
      },
    });
    return { port, source, calls, downstream, derivedContext, access };
  };
  it("原身份复验使用登记调用；派生身份签发批准的精确分支", async () => {
    const { port, calls, downstream, derivedContext } = setup();
    const request = {
      authorization,
      invocationId: "original-command",
      branch: "workflow.start-run",
    };
    await expect(port.verifyCurrent(request)).resolves.toEqual(authorization);
    expect(downstream).toHaveLength(0);
    await expect(
      port.verifyCurrent({
        ...request,
        invocationId: "derived-action",
        branch: "risk-identification.run-read",
        requestedSourceVersionRefs: [],
      }),
    ).resolves.toEqual(derivedContext);
    expect(calls[1]).toMatchObject({
      invocationId: "original-command",
      branch: "workflow.start-run",
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
    });
    expect(downstream[0]).toMatchObject({
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      invocationId: "derived-action",
      branch: "risk-identification.run-read",
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
    });
  });
  it("错主体、未登记正文与过期授权不签发，数据库故障继续抛出", async () => {
    const { port, source, calls, downstream, access } = setup();
    const request = {
      authorization,
      invocationId: "derived-action",
      branch: "risk-identification.run-read",
    };
    await expect(port.verifyCurrent({ ...request, actorId: "other" })).resolves.toBeUndefined();
    source.context = { ...authorization, decidedAt: "2030-01-02T00:00:00.000Z" };
    await expect(port.verifyCurrent(request)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    source.context = authorization;
    access.verify = async () => {
      throw new AccessServiceError({
        code: "SESSION_EXPIRED",
        retryable: false,
        stage: "runtime-verify",
        occurredAt: authorization.decidedAt,
        diagnosticRef: { kind: "diagnostic-artifact", reference: ref("authorization-diagnostic") },
        contextRefs: [],
      });
    };
    await expect(port.verifyCurrent(request)).resolves.toBeUndefined();
    expect(downstream).toHaveLength(0);
    const databaseError = new Error("database-unavailable");
    access.verify = async () => {
      throw databaseError;
    };
    await expect(port.verifyCurrent(request)).rejects.toBe(databaseError);
  });
});

describe("生产调用的授权作用域", () => {
  const authorization = testRequestBase.authorization;
  const runRef = (entityId) => ({ kind: "workflow-run", reference: { entityId, versionId: "1" } });
  const setup = (sourceOverrides = {}) => {
    const calls = [];
    const access = {
      readDeploymentAuthorizationSource: async () => ({
        context: authorization,
        branch: "workflow.start-run",
        ...sourceOverrides,
      }),
      authorize: async () => ({ context: authorization }),
    };
    const boundary = createDeploymentAuthorizationScopeV1({
      access,
      deploymentAuthorization: {
        issueDownstreamContexts: async (input) => calls.push(input),
        resolveDownstreamContext: async (input) => {
          calls.push(input);
          return input.root;
        },
      },
      policy: {
        bindings: [
          { rootBranch: "workflow.start-run", downstreamBranches: ["agent-task.start-task"] },
        ],
      },
    });
    return { boundary, calls };
  };
  it("独立知识发布事件使用原发布命令因果，错命令拒绝", async () => {
    const { identificationBasisPublishedEvent } =
      await import("../../packages/core/dist/identification-knowledge/index.js");
    const source = {
      branch: "knowledge-modeling.publish-approved-release",
      invocationId: "publish-command",
    };
    const { boundary, calls } = setup(source);
    const knowledgeRef = (id) => ({ kind: "knowledge-release", reference: ref(id) });
    const event = identificationBasisPublishedEvent({
      releaseRef: knowledgeRef("evidence-base"),
      compositeMemberReleaseRefs: ["process", "mechanism", "standard", "case"].map(knowledgeRef),
      command: {
        projectId: authorization.projectId,
        commandId: source.invocationId,
        idempotencyKey: "publish-idem",
        issuedAt: "2030-01-01T00:00:00.000Z",
        authorizationContextRef: authorization.authorizationContextRef,
      },
      recordedAt: "2030-01-01T00:00:00.000Z",
      auditEntryId: "publish-audit",
    });
    await boundary.runEvent(event, () =>
      boundary.authorizeDownstream({
        ...request,
        branch: "knowledge-modeling.identification-basis",
      }),
    );
    expect(calls[0].causalRunRef).toBeUndefined();
    expect(calls[0].causalCommandRef).toEqual({
      kind: "command",
      commandId: source.invocationId,
      authorizationContextRef: authorization.authorizationContextRef,
    });
    await expect(
      boundary.runEvent({ ...event, producerCommandId: "other" }, () =>
        boundary.authorizeDownstream(request),
      ),
    ).rejects.toThrow(TypeError);
  });
  const request = {
    projectId: authorization.projectId,
    actorId: authorization.actorId,
    branch: "agent-task.start-task",
    invocationId: "downstream-action",
  };
  it("并发调用分别保留原运行身份，作用域结束后拒绝下游签发", async () => {
    const { boundary, calls } = setup();
    await Promise.all(
      ["run-a", "run-b"].map((id) =>
        boundary.run({ authorization, causalRunRef: runRef(id) }, async () => {
          await Promise.resolve();
          await boundary.authorizeDownstream(request);
        }),
      ),
    );
    expect(calls.map((call) => call.causalRunRef.reference.entityId).sort()).toEqual([
      "run-a",
      "run-b",
    ]);
    await expect(boundary.authorizeDownstream(request)).rejects.toThrow(TypeError);
    await expect(
      boundary.run({ authorization, causalRunRef: runRef("run-a") }, () =>
        boundary.authorizeDownstream({ ...request, actorId: "other-actor" }),
      ),
    ).rejects.toThrow(TypeError);
  });
  it("即时下游使用当前请求会话签发精确身份，不创建后台因果", async () => {
    const calls = [];
    const source = {
      context: authorization,
      branch: "knowledge-modeling.submit-revision",
      invocationId: "package-submit",
    };
    const boundary = createDeploymentAuthorizationScopeV1({
      access: {
        readDeploymentAuthorizationSource: async () => source,
        verify: async (input) => calls.push({ verify: input }),
        authorize: async (input) => {
          calls.push({ authorize: input });
          return { context: authorization };
        },
      },
      deploymentAuthorization: {
        issueDownstreamContexts: async () => [],
        resolveDownstreamContext: async () => {
          throw new Error("background not allowed");
        },
      },
      policy: {
        bindings: [
          {
            rootBranch: source.branch,
            downstreamBranches: ["knowledge-modeling.assessment-basis"],
          },
        ],
      },
    });
    await boundary.runRequest(async () => {
      await boundary.access.authorize({
        projectId: authorization.projectId,
        branch: source.branch,
        invocationId: source.invocationId,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        invocation: { kind: "human-session", sessionToken: "request-only-token" },
      });
      const input = { ...request, branch: "knowledge-modeling.assessment-basis" };
      await expect(boundary.authorizeDownstream(input)).resolves.toEqual(authorization);
      await expect(
        boundary.authorizeDownstream({ ...input, branch: "workflow.start-run" }),
      ).rejects.toThrow(TypeError);
    });
    expect(calls[2].authorize).toMatchObject({
      invocationId: request.invocationId,
      invocation: { kind: "human-session", sessionToken: "request-only-token" },
    });
    expect(calls[2].authorize.causalRunRef).toBeUndefined();
    expect(calls[2].authorize.causalCommandRef).toBeUndefined();
    await expect(boundary.authorizeDownstream(request)).rejects.toThrow(TypeError);
  });
  it("人类入口返回前签发批准的完整下游集合，普通同能力调用沿原授权口", async () => {
    const { boundary, calls } = setup();
    await boundary.access.authorize({
      ...request,
      branch: "workflow.start-run",
      invocation: { kind: "human-session", sessionToken: "test-session" },
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].branches).toEqual(["agent-task.start-task"]);
    await boundary.access.authorize({ ...request, invocation: { kind: "system" } });
    expect(calls).toHaveLength(1);
  });
  it("内部再次签发保留请求根，后台来源使用批准的真实父上下文", async () => {
    const root = { context: authorization, branch: "workflow.start-run", invocationId: "root" };
    const nestedAuthorization = {
      ...authorization,
      authorizationContextRef: {
        kind: "authorization-context",
        reference: ref("nested-authorization"),
      },
    };
    const calls = [];
    const boundary = createDeploymentAuthorizationScopeV1({
      access: {
        readDeploymentAuthorizationSource: async ({ authorizationContextRef }) =>
          authorizationContextRef.reference.entityId === "nested-authorization"
            ? { ...root, context: nestedAuthorization, branch: "agent-task.start-task" }
            : root,
        authorize: async ({ invocationId }) => ({
          context: invocationId === "nested" ? nestedAuthorization : authorization,
        }),
        verify: async () => ({ context: authorization }),
      },
      deploymentAuthorization: {
        issueDownstreamContexts: async () => [],
        resolveDownstreamContext: async (input) => {
          calls.push(input);
          return nestedAuthorization;
        },
      },
      policy: {
        bindings: [{ rootBranch: root.branch, downstreamBranches: ["agent-task.start-task"] }],
      },
    });
    const human = {
      ...request,
      invocationId: root.invocationId,
      branch: root.branch,
      invocation: { kind: "human-session", sessionToken: "request-token" },
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    };
    await boundary.runRequest(async () => {
      await boundary.access.authorize(human);
      await boundary.access.authorize({
        ...human,
        invocationId: "nested",
        branch: "agent-task.start-task",
      });
      await expect(boundary.resolveInvocationSource(request)).resolves.toEqual({
        kind: "human-session",
        sessionToken: "request-token",
      });
      await expect(boundary.authorizeDownstream(request)).resolves.toEqual(authorization);
    });
    await boundary.run({ authorization, causalRunRef: runRef("actual-run") }, async () => {
      await expect(boundary.resolveInvocationSource(request)).resolves.toMatchObject({
        kind: "system",
        parentContext: nestedAuthorization,
        causalRunRef: runRef("actual-run"),
      });
    });
    expect(calls[0]).toMatchObject({ root: authorization, invocationId: request.invocationId });
    await expect(boundary.resolveInvocationSource(request)).rejects.toThrow(TypeError);
  });
});

describe("交付取证 CLI 入口", () => {
  it("package.json 至少登记了验证、smoke 与基准三类交付命令", () => {
    expect(deliveryCliEntries.length).toBeGreaterThanOrEqual(3);
  });

  it.each(deliveryCliEntries)("%s 指向真实存在的脚本", (_name, command) => {
    const scriptPath = /node\s+(\S+)/.exec(command)?.[1];
    expect(scriptPath, `${_name} 未按 node <脚本> 形式登记`).toBeDefined();
    expect(existsSync(join(REPO_ROOT, scriptPath)), `${_name} 指向不存在的 ${scriptPath}`).toBe(
      true,
    );
  });

  it.each(deliveryCliEntries)("%s 不把子命令塞进脚本路径参数", (_name, command) => {
    // `release.mjs verify` 会让 verify 变成清单文件路径；子命令必须走脚本自己的契约。
    const afterScript = command.split(/\.mjs/)[1]?.trim() ?? "";
    expect(afterScript).toBe("");
  });
});
