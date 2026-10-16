/**
 * C37 D-20 / IP-04 / IP-05：把原 C20 `HybridRetrievalBuildQualityGateV1.evaluate` 输入
 * 接到真实测量上——正式代际、真实 Embedding、真实 Qdrant 三路查询。
 *
 * 硬边界：身份漂移、缺证据、拒权、超时与任一硬门失败都不能 ready；分数只由原
 * `evaluateRetrievalAcceptance` 判定，实际报告必须由宿主 `onReport` 耐久保存。
 * 门禁不含模拟分数、SQL 或自由联网路径。
 */
import { cpus } from "node:os";
import { randomUUID } from "node:crypto";
import { clearTimeout, setTimeout } from "node:timers";

import { DeploymentRetrievalDatasetV1Schema } from "../../../packages/adapters/dist/deployment/index.js";
import { VersionReferenceSchema } from "../../../packages/contracts/dist/index.js";
import { EmbeddingRequestV1Schema } from "../../../packages/core/dist/model/index.js";
import {
  authorizationScopeDigest,
  evaluateRetrievalAcceptance,
  HybridRetrievalAcceptancePolicyV1Schema,
  HybridRetrievalPolicyV1Schema,
  RetrievalGenerationV1Schema,
  RetrievalHybridQueryV1Schema,
  RetrievalIndexManifestV1Schema,
  RetrievalReconciliationV1Schema,
  retrievalQueryEmbeddingText,
} from "../../../packages/core/dist/retrieval/index.js";

const REQUIRED_CAPABILITY_V1 = "knowledge-modeling.retrieve";
const PASSED_DETAIL_CODE_V1 = "acceptance-gates-passed";

/** 代际成员发布槽位与成员 sourceKind 的精确对应（与 C16 组合发布槽位同源）。 */
const MEMBER_RELEASE_SLOTS_V1 = Object.freeze({
  "risk-mechanism": "riskMechanismRef",
  "standard-library": "standardLibraryRef",
  "case-library": "caseLibraryRef",
});

// 门禁自身的资源上限：策略要求的预热+测量轮次超过上限即拒绝装配，绝不静默少测后放行。
const MAX_MEASURED_RUNS_V1 = 100;

class GateFailure extends Error {
  constructor(detailCode) {
    super(detailCode);
    this.name = "GateFailure";
    this.detailCode = detailCode;
  }
}

const fail = (detailCode) => {
  throw new GateFailure(detailCode);
};

const required = (value, name) => {
  if (value === undefined || value === null) {
    throw new TypeError(`DEPLOYMENT_QUALITY_GATE_DEPENDENCY_MISSING:${name}`);
  }
  return value;
};

const requiredMethod = (value, name, method) => {
  required(value, name);
  if (typeof value[method] !== "function") {
    throw new TypeError(`DEPLOYMENT_QUALITY_GATE_PORT_INVALID:${name}.${method}`);
  }
  return value;
};

const requiredFunction = (value, name) => {
  required(value, name);
  if (typeof value !== "function") {
    throw new TypeError(`DEPLOYMENT_QUALITY_GATE_PORT_INVALID:${name}`);
  }
  return value;
};

const requiredText = (value, name) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`DEPLOYMENT_QUALITY_GATE_INPUT_INVALID:${name}`);
  }
  return value;
};

const sameVersionedRef = (left, right) =>
  left?.reference?.entityId === right?.reference?.entityId &&
  left?.reference?.versionId === right?.reference?.versionId;

const sameReference = (left, right) =>
  left?.entityId === right?.entityId && left?.versionId === right?.versionId;

const memberKey = (sourceKind, sourceReleaseRef, sourceEntryId) =>
  [
    sourceKind,
    sourceReleaseRef.reference.entityId,
    sourceReleaseRef.reference.versionId,
    sourceEntryId,
  ].join("\u0000");

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

/** 最近秩 p95：样本数与实际采样一致，不做插值美化。 */
const nearestRankP95 = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
};

const recallAtK = (retrieved, relevant, k) => {
  const top = new Set(retrieved.slice(0, k));
  return relevant.filter((pointId) => top.has(pointId)).length / relevant.length;
};

/**
 * 分级 NDCG：增益 `2^grade - 1`，理想序为本查询 grade 降序前 k 项。
 * 同一 pointId 在结果里重复出现只计一次，重复命中不得把增益累加到 1 以上。
 */
const ndcgAtK = (retrieved, gradeByPointId, k) => {
  const dcg = [...new Set(retrieved)].slice(0, k).reduce((total, pointId, index) => {
    const grade = gradeByPointId.get(pointId);
    return total + (grade === undefined ? 0 : (2 ** grade - 1) / Math.log2(index + 2));
  }, 0);
  const ideal = [...gradeByPointId.values()]
    .sort((left, right) => right - left)
    .slice(0, k)
    .reduce((total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
};

/** 报告只暴露安全 detailCode：首个失败硬门标识，绝不回传异常文案或分数明细。 */
const detailCodeOf = (report) =>
  report.gates.find((gate) => !gate.passed)?.gateId ?? PASSED_DETAIL_CODE_V1;

/** 门禁失败一律是不通过：已知失败用其安全 detailCode，未知异常统一收口，不外泄内部信息。 */
const errorVerdict = (error) =>
  error instanceof GateFailure
    ? { passed: false, detailCode: error.detailCode }
    : { passed: false, detailCode: "quality-gate-measurement-failed" };

/**
 * C37 D-20：C20 构建门禁的部署组合。宿主注入精确数据集/验收策略目录与全部真实端口；
 * 测量超时即失败、报告必须经 `onReport` 耐久保存后才返回判定。
 */
export const createDeploymentBuildQualityGateV1 = (options) => {
  const datasets = required(options?.datasets, "datasets");
  if (!Array.isArray(datasets) || datasets.length === 0) {
    throw new TypeError("DEPLOYMENT_QUALITY_GATE_INPUT_INVALID:datasets");
  }
  const acceptancePolicies = required(options?.acceptancePolicies, "acceptancePolicies");
  if (!Array.isArray(acceptancePolicies) || acceptancePolicies.length === 0) {
    throw new TypeError("DEPLOYMENT_QUALITY_GATE_INPUT_INVALID:acceptancePolicies");
  }
  const generationStore = requiredMethod(
    options?.generationStore,
    "generationStore",
    "readGeneration",
  );
  const projection = requiredMethod(options?.projection, "projection", "queryHybrid");
  requiredMethod(options?.projection, "projection", "serviceVersion");
  const modelGateway = requiredMethod(options?.modelGateway, "modelGateway", "embed");
  const access = requiredMethod(options?.access, "access", "verifyDeploymentContext");
  const budgetPolicyRef = VersionReferenceSchema.parse(
    required(options?.budgetPolicyRef, "budgetPolicyRef"),
  );
  const timeoutMs = required(options?.timeoutMs, "timeoutMs");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("DEPLOYMENT_QUALITY_GATE_INPUT_INVALID:timeoutMs");
  }
  const containerRuntime = requiredText(options?.containerRuntime, "containerRuntime");
  const onReport = requiredFunction(options?.onReport, "onReport");

  const parsedDatasets = datasets.map((dataset) =>
    DeploymentRetrievalDatasetV1Schema.parse(dataset),
  );
  const parsedAcceptancePolicies = acceptancePolicies.map((entry) => ({
    projectId: requiredText(entry?.projectId, "acceptancePolicies[].projectId"),
    policy: HybridRetrievalAcceptancePolicyV1Schema.parse(entry?.policy),
  }));

  // 目录按精确键唯一：重复键说明宿主装配歧义，必须拒装而不是取首个命中。
  const uniqueByKey = (entries, keyOf, name) => {
    const seen = new Set();
    for (const entry of entries) {
      const key = keyOf(entry);
      if (seen.has(key)) throw new TypeError(`DEPLOYMENT_QUALITY_GATE_DUPLICATE_KEY:${name}`);
      seen.add(key);
    }
  };
  uniqueByKey(
    parsedDatasets,
    (dataset) =>
      `${dataset.projectId}|${dataset.datasetRef.entityId}@${dataset.datasetRef.versionId}`,
    "datasets",
  );
  uniqueByKey(parsedAcceptancePolicies, (entry) => entry.projectId, "acceptancePolicies");
  for (const entry of parsedAcceptancePolicies) {
    if (entry.policy.warmupRuns + entry.policy.measuredRuns > MAX_MEASURED_RUNS_V1) {
      throw new TypeError("DEPLOYMENT_QUALITY_GATE_MEASURED_RUNS_EXCEEDED");
    }
  }

  /** 按代际读正式事实并逐项精确核对身份；任一漂移都不是本代证据。 */
  const verifyFormalIdentity = async (input, transactionContext) => {
    const projectId = requiredText(input?.projectId, "projectId");
    const generationRef = required(input?.generationRef, "generationRef");
    let policy;
    let manifest;
    let reconciliation;
    try {
      policy = HybridRetrievalPolicyV1Schema.parse(required(input?.policy, "policy"));
      manifest = RetrievalIndexManifestV1Schema.parse(required(input?.manifest, "manifest"));
      reconciliation = RetrievalReconciliationV1Schema.parse(
        required(input?.reconciliation, "reconciliation"),
      );
    } catch {
      fail("gate-input-schema-invalid");
    }

    const acceptance = parsedAcceptancePolicies.find((entry) => entry.projectId === projectId);
    if (acceptance === undefined) fail("acceptance-policy-not-found");
    if (!sameReference(policy.acceptancePolicyRef, acceptance.policy.acceptancePolicyRef)) {
      fail("acceptance-policy-ref-mismatch");
    }
    const dataset = parsedDatasets.find(
      (candidate) =>
        candidate.projectId === projectId &&
        sameReference(candidate.datasetRef, acceptance.policy.datasetRef),
    );
    if (dataset === undefined) fail("retrieval-dataset-not-found");

    let read;
    try {
      read = await generationStore.readGeneration(generationRef, transactionContext);
    } catch {
      fail("generation-read-failed");
    }
    if (read === undefined || read === null) fail("generation-not-found");
    let generation;
    try {
      generation = RetrievalGenerationV1Schema.parse(read);
    } catch {
      fail("generation-schema-invalid");
    }

    if (!sameVersionedRef(generation.generationRef, generationRef)) fail("generation-ref-mismatch");
    if (generation.identity.projectId !== projectId) fail("generation-project-mismatch");
    if (!sameReference(generation.identity.policyRef, policy.policyRef)) {
      fail("generation-policy-mismatch");
    }
    if (!sameReference(generation.identity.modelDeploymentRef, policy.modelDeploymentRef)) {
      fail("generation-model-mismatch");
    }
    if (
      !sameVersionedRef(dataset.evidenceBaseReleaseRef, generation.identity.evidenceBaseReleaseRef)
    ) {
      fail("evidence-base-mismatch");
    }
    if (manifest.projectId !== projectId) fail("manifest-project-mismatch");
    if (!sameVersionedRef(manifest.generationRef, generationRef))
      fail("manifest-generation-mismatch");
    if (!sameReference(manifest.policyRef, policy.policyRef)) fail("manifest-policy-mismatch");
    if (!sameReference(manifest.modelDeploymentRef, policy.modelDeploymentRef)) {
      fail("manifest-model-mismatch");
    }
    if (
      !sameReference(
        manifest.projectionCompatibilityRef,
        generation.identity.projectionCompatibilityRef,
      )
    ) {
      fail("manifest-projection-compatibility-mismatch");
    }
    if (manifest.membersSha256 !== generation.manifestSha256) fail("manifest-digest-mismatch");
    if (generation.expectedMemberCount !== manifest.members.length) {
      fail("manifest-member-count-mismatch");
    }
    if (
      manifest.members.some(
        (member) => member.authorizationScopeDigest !== generation.authorizationScopeDigest,
      )
    ) {
      fail("member-scope-digest-mismatch");
    }

    const pointIdByMemberKey = new Map();
    const memberByPointId = new Map();
    for (const member of manifest.members) {
      const key = memberKey(member.sourceKind, member.sourceReleaseRef, member.sourceEntryId);
      if (pointIdByMemberKey.has(key)) fail("duplicate-member-identity");
      // 成员发布引用必须与代际按 sourceKind 登记的槽位精确一致，否则不是本代成员事实。
      const slotRef =
        generation.identity.memberReleaseRefs[MEMBER_RELEASE_SLOTS_V1[member.sourceKind]];
      if (!sameVersionedRef(slotRef, member.sourceReleaseRef)) fail("member-release-mismatch");
      if (memberByPointId.has(member.pointId)) fail("duplicate-member-point-id");
      pointIdByMemberKey.set(key, member.pointId);
      memberByPointId.set(member.pointId, member);
    }

    return {
      projectId,
      generationRef,
      policy,
      acceptancePolicy: acceptance.policy,
      dataset,
      manifest,
      reconciliation,
      generation,
      pointIdByMemberKey,
      memberByPointId,
      /** 双路召回前按同一份已批准本代清单收窄可见范围（D-05）；探针与指标查询共用该范围。 */
      visiblePointIds: [...memberByPointId.keys()],
    };
  };

  /** 真实三路测量：查询文本真实 Embedding，逐查询真实查询Hybrid，另有预热后 p95 采样。 */
  const measure = async (context, signal) => {
    const {
      projectId,
      generationRef,
      policy,
      acceptancePolicy,
      dataset,
      reconciliation,
      generation,
      pointIdByMemberKey,
      memberByPointId,
      visiblePointIds,
    } = context;
    const queries = dataset.queries;
    const { warmupRuns, measuredRuns } = acceptancePolicy;
    // 全部查询的相关性先按本清单核对：映射不到的成员必须在任何 Embedding 之前失败。
    const gradeByQuery = queries.map((query) => {
      const gradeByPointId = new Map();
      for (const entry of query.relevance) {
        const pointId = pointIdByMemberKey.get(
          memberKey(entry.sourceKind, entry.sourceReleaseRef, entry.sourceEntryId),
        );
        if (pointId === undefined) fail("relevance-member-unmapped");
        // 同一 pointId 只保留最高 grade，重复标注不得把增益累加。
        gradeByPointId.set(pointId, Math.max(gradeByPointId.get(pointId) ?? 0, entry.grade));
      }
      return gradeByPointId;
    });

    /** 任一命中必须与本清单成员完全对应：融合载荷逐项核对，两条单路的未知 pointId 同样算泄漏。 */
    const leakageOf = (result) => {
      let leaked = 0;
      for (const hit of result.fused) {
        const member = memberByPointId.get(hit.pointId);
        const payload = hit.payload;
        if (
          member === undefined ||
          payload === undefined ||
          payload.projectId !== projectId ||
          !sameVersionedRef(payload.generationRef, generationRef) ||
          payload.authorizationScopeDigest !== generation.authorizationScopeDigest ||
          payload.sourceKind !== member.sourceKind ||
          !sameVersionedRef(payload.sourceReleaseRef, member.sourceReleaseRef) ||
          payload.sourceEntryId !== member.sourceEntryId ||
          payload.contentDigest !== member.contentDigest
        ) {
          leaked += 1;
        }
      }
      for (const route of [result.denseRoute, result.bm25Route]) {
        leaked += route.filter((hit) => !memberByPointId.has(hit.pointId)).length;
      }
      return leaked;
    };
    const deadlineEpoch = Date.now() + timeoutMs;
    const stopIfAborted = () => {
      if (signal.aborted) fail("quality-gate-deadline-exceeded");
    };

    /** 每次 Embedding 都按代际登记的授权引用、创建者与 retrieve 能力复验当前权限。 */
    const verifiedAuthorization = async () => {
      let decision;
      try {
        decision = await access.verifyDeploymentContext({
          authorizationContextRef: generation.authorizationContextRef,
          projectId,
          actorId: generation.createdBy,
          requiredCapability: REQUIRED_CAPABILITY_V1,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          requestedAt: new Date().toISOString(),
        });
      } catch {
        fail("authorization-rejected");
      }
      const authorization = decision?.context;
      if (authorization === undefined) fail("authorization-context-missing");
      if (!authorization.grantedCapabilities.includes(REQUIRED_CAPABILITY_V1)) {
        fail("authorization-capability-missing");
      }
      if (authorizationScopeDigest(authorization) !== generation.authorizationScopeDigest) {
        fail("authorization-scope-digest-mismatch");
      }
      return authorization;
    };

    const embedQueryText = async (query) => {
      stopIfAborted();
      const authorization = await verifiedAuthorization();
      stopIfAborted();
      const issuedAt = new Date().toISOString();
      const invocationId = `deployment-quality-gate-embed:${projectId}:${query.queryId}:${randomUUID()}`;
      const request = EmbeddingRequestV1Schema.parse({
        schemaVersion: "1",
        invocationId,
        idempotencyKey: invocationId,
        issuedAt,
        projectId,
        actorId: generation.createdBy,
        authorization,
        requiredCapability: REQUIRED_CAPABILITY_V1,
        modelDeploymentRef: policy.modelDeploymentRef,
        budgetPolicyRef,
        deadlineAt: new Date(
          Math.min(deadlineEpoch, Date.parse(issuedAt) + policy.embeddingTimeoutMs),
        ).toISOString(),
        parentArtifactRefs: [],
        evidenceReferences: [],
        // 与正式检索共用同一渲染：指令只作用于查询 Embedding，BM25 查询仍用原文本。
        texts: [retrievalQueryEmbeddingText(query.queryText, policy)],
        maxInputBytes: policy.memberByteLimit,
        maxBatchItems: 1,
      });
      let embedding;
      try {
        embedding = await modelGateway.embed(request, signal);
      } catch {
        fail(signal.aborted ? "quality-gate-deadline-exceeded" : "query-embedding-failed");
      }
      stopIfAborted();
      const vector = embedding.vectors[0];
      if (
        !sameReference(embedding.modelDeploymentRef, policy.modelDeploymentRef) ||
        embedding.dimensions !== policy.dense.dimensions ||
        vector === undefined ||
        vector.length !== policy.dense.dimensions
      ) {
        fail("embedding-identity-mismatch");
      }
      return [...vector];
    };

    // Qdrant 端口当前无 signal 参数：已开始的请求在原请求超时内自行 settle，
    // 总截止后的结果一律丢弃，不进计数器也不得当成成功。
    const runQuery = async (queryText, vector) => {
      stopIfAborted();
      let result;
      try {
        result = await projection.queryHybrid(
          RetrievalHybridQueryV1Schema.parse({
            collectionName: generation.collectionName,
            generationRef,
            queryDenseVector: vector,
            queryText,
            policy,
            filter: {
              projectId,
              generationRef,
              authorizationScopeDigest: generation.authorizationScopeDigest,
              visiblePointIds: [...visiblePointIds],
            },
          }),
        );
      } catch {
        fail(signal.aborted ? "quality-gate-deadline-exceeded" : "projection-query-failed");
      }
      stopIfAborted();
      if (
        !sameVersionedRef(result.generationRef, generationRef) ||
        result.collectionName !== generation.collectionName
      ) {
        fail("query-result-identity-mismatch");
      }
      if (
        result.denseRoute.length === 0 ||
        result.bm25Route.length === 0 ||
        result.fused.length === 0
      ) {
        fail("query-route-empty");
      }
      return result;
    };

    let authorizationLeakage = 0;
    const denseRecalls = [];
    const bm25Recalls = [];
    const rrfRecalls = [];
    const rrfNdcgs = [];
    const latencies = [];

    for (const [index, query] of queries.entries()) {
      const gradeByPointId = gradeByQuery[index];
      const relevantPointIds = [...gradeByPointId.keys()];
      const vector = await embedQueryText(query);
      const result = await runQuery(query.queryText, vector);
      authorizationLeakage += leakageOf(result);
      const densePointIds = result.denseRoute.map((hit) => hit.pointId);
      const bm25PointIds = result.bm25Route.map((hit) => hit.pointId);
      const fusedPointIds = result.fused.map((hit) => hit.pointId);
      denseRecalls.push(recallAtK(densePointIds, relevantPointIds, acceptancePolicy.topK));
      bm25Recalls.push(recallAtK(bm25PointIds, relevantPointIds, acceptancePolicy.topK));
      rrfRecalls.push(recallAtK(fusedPointIds, relevantPointIds, acceptancePolicy.topK));
      rrfNdcgs.push(ndcgAtK(fusedPointIds, gradeByPointId, acceptancePolicy.topK));
      if (index !== 0) continue;
      // p95 门固定在同一探针查询：预热不计入样本，测量轮次按策略固定。
      for (let run = 0; run < warmupRuns + measuredRuns; run += 1) {
        const probe = await runQuery(query.queryText, vector);
        authorizationLeakage += leakageOf(probe);
        if (run >= warmupRuns) latencies.push(probe.fusedQueryDurationMs);
      }
    }

    const service = await projection.serviceVersion();
    const cpuModel = cpus()[0]?.model;
    if (
      typeof service?.version !== "string" ||
      service.version.length === 0 ||
      cpuModel === undefined
    ) {
      fail("environment-unavailable");
    }

    return {
      policy: acceptancePolicy,
      measurements: {
        denseRecallAt5: mean(denseRecalls),
        bm25RecallAt5: mean(bm25Recalls),
        rrfRecallAt5: mean(rrfRecalls),
        rrfNdcgAt5: mean(rrfNdcgs),
        reconciliationRatio: reconciliation.consistent ? 1 : 0,
        authorizationLeakage,
        qdrantQueryP95Ms: nearestRankP95(latencies),
        queryCount: queries.length,
        memberCount: reconciliation.checkedMemberCount,
        p95SampleCount: latencies.length,
        environment: {
          nodeVersion: process.version,
          containerRuntime,
          qdrantServiceRef: service.version,
          cpuModel,
          platform: `${process.platform}/${process.arch}`,
        },
        measuredAt: new Date().toISOString(),
      },
    };
  };

  return {
    async evaluate(input, transactionContext) {
      const controller = new AbortController();
      // 总界覆盖整个 evaluate：读取代际、身份核对、真实测量与报告保存都在同一个截止内，
      // 迟到的成功不成立——已开始的动作自行 settle，但绝不能把超时判成通过。
      const run = (async () => {
        const context = await verifyFormalIdentity(input, transactionContext);
        const measured = await measure(context, controller.signal);
        const report = evaluateRetrievalAcceptance({
          policy: measured.policy,
          measurements: measured.measurements,
        });
        try {
          await onReport(report);
        } catch {
          fail("quality-gate-report-not-saved");
        }
        return { passed: report.overall === "passed", detailCode: detailCodeOf(report) };
      })().then(
        (value) => ({ kind: "done", value }),
        (error) => ({ kind: "failed", error }),
      );
      let timer;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: "deadline" }), timeoutMs);
      });
      const outcome = await Promise.race([run, deadline]);
      clearTimeout(timer);
      if (outcome.kind === "deadline") {
        controller.abort();
        return { passed: false, detailCode: "quality-gate-deadline-exceeded" };
      }
      if (outcome.kind === "failed") {
        return errorVerdict(outcome.error);
      }
      return outcome.value;
    },
  };
};
