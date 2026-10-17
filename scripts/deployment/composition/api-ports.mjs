#!/usr/bin/env node
/**
 * C37 D-21：生产 API 的全端口装配。
 *
 * 本模块只做一件事：把已经真实装配好的领域能力（基础宿主、识别、评估、risk-flow、
 * 复核、Agent 任务）与真实 projection/report/systemOperationsRead/qualityProjectionQuery
 * provider，收敛成一个完整的 `ApiPortsV1`。路由可用性由这里返回的端口决定；缺任何
 * 一个必需 provider 或任一公开方法都必须拒绝装配，绝不用永真、空仓储或假策略补位。
 *
 * warningResponse 按 D-21「原 warning.open、recommendation、responseLifecycle/calibration
 * 三分支的类型化分派」组装：open→预警生命周期，recommend→处置建议，record 按 kind
 * 分派到 acknowledge/calculate-deviation/create-calibration-suggestion 三个真实领域适配器；
 * C41 的三个分支不属于本端口，经独立 humanDecisionFeedback 注入位承接。
 *
 * 只组合 apps/api 与 packages/adapters 的公开 dist 入口，不导入 core/adapters 私文件、
 * 不引入 fake SQL/结果/默认策略，不做服务器、模型调用或依赖变更。
 */

import { clearTimeout, setTimeout } from "node:timers";
import { createPostgresEngineeringDataCatalogAdapter } from "../../../packages/adapters/dist/engineering-data/catalog/index.js";
import { createPostgresKnowledgeGovernanceReadAdapter } from "../../../packages/adapters/dist/knowledge-governance/index.js";
import { createPostgresKnowledgeRetrievalReadAdapter } from "../../../packages/adapters/dist/identification/context/index.js";
import {
  createPostgresReviewAuditRead,
  createPostgresReviewQueueReadAdapter,
} from "../../../packages/adapters/dist/review-audit/index.js";
import {
  createPostgresReportExport,
  createPostgresWorkflowProjection,
} from "../../../packages/adapters/dist/workflow/index.js";
import { createPostgresQualityProjectionAdapter } from "../../../packages/adapters/dist/quality/index.js";
import { ReportExportPolicyV1Schema } from "../../../packages/core/dist/workflow/index.js";
import {
  SYSTEM_OPERATIONS_REASON_CODES_V1,
  SYSTEM_OPERATIONS_COMPONENT_IDS_V1,
  SYSTEM_OPERATIONS_TIMEOUT_MS_V1,
  SystemOperationsQueryRequestV1Schema,
  SystemOperationsQueryResultEnvelopeV1Schema,
  SystemOperationsQueryResultV1Schema,
  collectSystemOperationsHealth,
} from "../../../apps/api/dist/operations.js";

/**
 * 返回对象每个 API 端口必须暴露的公开方法。
 *
 * 事实源是 apps/api/src/http.ts 的分派表（每条路由的 invoke 表达式），这里只把它转成
 * 「装配期必须逐个存在」的契约，便于缺项在启动时就失败而不是运行期才暴露。
 */
export const REQUIRED_API_PORT_METHODS_V1 = Object.freeze({
  engineeringData: ["apply", "freeze", "read"],
  engineeringDataCatalog: ["read"],
  knowledgeModeling: ["govern", "resolve", "retrieve"],
  applicableRuleSetAssembly: ["assemble"],
  knowledgeGovernanceRead: ["read"],
  knowledgeRetrievalRead: ["read"],
  riskIdentification: ["plan", "analyze", "finalize"],
  riskIdentificationRead: ["read"],
  riskAssessment: ["prepare", "evaluate"],
  riskAssessmentRead: ["read"],
  warningResponse: ["open", "recommend", "record"],
  warningResponseRead: ["read"],
  humanDecisionFeedback: ["record"],
  calibrationGovernance: ["createGovernanceDraft", "recordReviewOutcome"],
  reviewAudit: ["requestReview", "decideReview", "trace"],
  reviewQueueRead: ["read"],
  reviewAuditRead: ["read"],
  agentTask: ["startTask", "resumeTask", "cancelTask", "confirmCommand"],
  agentTaskRead: ["read"],
  workflow: ["startRun", "resumeRun", "cancelRun"],
  projection: ["query", "subscribe", "export"],
  runEventSubscription: ["subscribeWithSourceAuthorization"],
  projectionResultRead: ["readPage"],
  projectionReportRead: ["read"],
  qualityProjectionQuery: ["query", "candidateSourceVersionRefs", "queryWithSourceGrants"],
  systemAdministration: ["read", "execute"],
  systemOperationsRead: ["read"],
});

/**
 * 装配期必需的注入 provider。`null` 表示只要求存在（供真实 adapter 构造使用），
 * 数组表示该 provider 必须逐个实现这些公开方法。
 */
export const REQUIRED_API_PROVIDERS_V1 = Object.freeze({
  db: null,
  access: ["verify", "authorize"],
  artifactStore: ["put", "open"],
  // engineeringData 端口与 catalog resolvers 都取自同一真实 context-source registry。
  contextSource: ["apply", "freeze", "read", "resolveReadQuery"],
  monitoringStore: ["resolveSnapshotQuery"],
  knowledgeModeling: ["govern", "resolve", "retrieve"],
  applicableRuleSetAssembly: ["assemble"],
  riskIdentification: ["plan", "analyze", "finalize"],
  riskIdentificationRead: ["read"],
  riskAssessment: ["prepare", "evaluate"],
  riskAssessmentRead: ["read"],
  workflow: ["startRun", "resumeRun", "cancelRun"],
  humanDecisionFeedback: ["record"],
  reviewAudit: ["requestReview", "decideReview", "trace"],
  agentTask: ["startTask", "resumeTask", "cancelTask", "confirmCommand"],
  agentTaskRead: ["read"],
  warningLifecycle: ["open", "acknowledge", "read"],
  recommendation: ["measureCandidates", "createCandidate", "validateAndRecord"],
  responseLifecycle: ["calculateDeviation"],
  calibration: ["createSuggestion", "createGovernanceDraft", "recordReviewOutcome"],
  transactionUnit: ["execute"],
  workflowRegistrationStore: [
    "assertCurrentRunVersion",
    "registerRow",
    "readRow",
    "listRunRows",
    "readLatestRunState",
    "registerLink",
    "listRunLinks",
    "registerQuery",
    "readQuery",
  ],
  workflowBodies: ["readBody"],
  riskRecordTrace: ["readBatch"],
  resultReadAuthorization: ["issueResultReadAuthorization"],
  runEvents: ["subscribe", "subscribeWithSourceAuthorization"],
  projectPolicies: ["resolveProject"],
  systemOperations: ["probe", "readModelVersions"],
  // C32 检索结果再读取的两条既有窄读：关系上下文结果与正式混合结果读取。
  retrievalRelationshipResults: ["readRelationshipResult"],
  hybridResultReader: ["readOfficial"],
});

const missingProviders = (options) => {
  const missing = [];
  for (const [name, methods] of Object.entries(REQUIRED_API_PROVIDERS_V1)) {
    const value = options[name];
    if (value === undefined || value === null) {
      missing.push(name);
      continue;
    }
    for (const method of methods ?? []) {
      if (typeof value[method] !== "function") missing.push(`${name}.${method}`);
    }
    if (name === "projectPolicies" && typeof value.reader?.listProjectIds !== "function") {
      missing.push("projectPolicies.reader.listProjectIds");
    }
  }
  return missing;
};

const missingPorts = (ports) => {
  const missing = [];
  for (const [portKey, methods] of Object.entries(REQUIRED_API_PORT_METHODS_V1)) {
    const port = ports[portKey];
    if (port === undefined || port === null) {
      missing.push(portKey);
      continue;
    }
    for (const method of methods) {
      if (typeof port[method] !== "function") missing.push(`${portKey}.${method}`);
    }
  }
  return missing;
};

/** D-21：warning.open、recommendation、responseLifecycle/calibration 三分支的类型化分派。 */
const warningResponseFor = ({
  warningLifecycle,
  recommendation,
  responseLifecycle,
  calibration,
}) => ({
  open: (command) => warningLifecycle.open(command),
  recommend: (command) => {
    if (command?.kind === "create-candidate") return recommendation.createCandidate(command);
    if (command?.kind === "validate-and-record") return recommendation.validateAndRecord(command);
    throw new TypeError(`DEPLOYMENT_API_WARNING_RECOMMEND_BRANCH_UNSUPPORTED:${command?.kind}`);
  },
  record: (command) => {
    if (command?.kind === "acknowledge") return warningLifecycle.acknowledge(command);
    if (command?.kind === "calculate-deviation")
      return responseLifecycle.calculateDeviation(command);
    if (command?.kind === "create-calibration-suggestion")
      return calibration.createSuggestion(command);
    throw new TypeError(`DEPLOYMENT_API_WARNING_RECORD_BRANCH_UNSUPPORTED:${command?.kind}`);
  },
});

/** 生产 C30/C35/C36 只读 provider；所有正文、策略与授权均来自实际宿主接缝。 */
export const createDeploymentApiReadProvidersV1 = (options) => {
  const projectIds = options.projectPolicies.reader.listProjectIds();
  if (
    !Array.isArray(projectIds) ||
    projectIds.length === 0 ||
    projectIds.length > 64 ||
    new Set(projectIds).size !== projectIds.length
  ) {
    throw new TypeError("DEPLOYMENT_API_PROJECT_POLICY_SET_INVALID");
  }
  const exportPolicies = projectIds.map((projectId) => {
    const project = options.projectPolicies.resolveProject(projectId);
    const policy = ReportExportPolicyV1Schema.parse(project?.policies?.["report-export"]);
    const configuredRef = project.binding?.policyRefs?.["report-export"];
    if (
      project.binding?.projectId !== projectId ||
      configuredRef?.entityId !== policy.policyRef.entityId ||
      configuredRef?.versionId !== policy.policyRef.versionId
    ) {
      throw new TypeError("DEPLOYMENT_API_REPORT_POLICY_BINDING_MISMATCH");
    }
    return policy;
  });
  const projectionStores = {
    db: options.db,
    registrationStore: options.workflowRegistrationStore,
    bodies: options.workflowBodies,
    authorization: options.access,
    riskRecordTrace: options.riskRecordTrace,
  };
  const projectionRead = createPostgresWorkflowProjection(projectionStores);
  const reportExport = createPostgresReportExport({
    db: options.db,
    transactionUnit: options.transactionUnit,
    artifactStore: options.artifactStore,
    registrationStore: options.workflowRegistrationStore,
    resultRead: projectionRead.resultRead,
    authorization: options.access,
    resultReadAuthorization: options.resultReadAuthorization,
    exportPolicies,
  });
  const projection = createPostgresWorkflowProjection({
    ...projectionStores,
    reportExport,
  });
  const projectionPort = Object.freeze({
    ...projection.queryProjection,
    subscribe: (request) => options.runEvents.subscribe(request),
  });
  const qualityProjection = createPostgresQualityProjectionAdapter({ db: options.db });

  const systemOperationsRead = Object.freeze({
    async read(request) {
      const query = SystemOperationsQueryRequestV1Schema.parse(request);
      const now = options.now ?? (() => new Date());
      const capturedAt = now().toISOString();
      let result;
      if (query.payload.kind === "health") {
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), SYSTEM_OPERATIONS_TIMEOUT_MS_V1);
        try {
          const health = await Promise.race([
            collectSystemOperationsHealth({
              capturedAt,
              now,
              probe: (componentId, signal) =>
                options.systemOperations.probe(
                  componentId,
                  AbortSignal.any([signal, deadline.signal]),
                ),
            }),
            new Promise((resolve) =>
              deadline.signal.addEventListener(
                "abort",
                () =>
                  resolve({
                    kind: "health",
                    capturedAt,
                    components: SYSTEM_OPERATIONS_COMPONENT_IDS_V1.map((componentId) => ({
                      componentId,
                      status: "unknown",
                      reasonCode: SYSTEM_OPERATIONS_REASON_CODES_V1.probeTimedOut,
                    })),
                  }),
                { once: true },
              ),
            ),
          ]);
          result = SystemOperationsQueryResultV1Schema.parse(health);
        } finally {
          clearTimeout(timer);
        }
      } else {
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), SYSTEM_OPERATIONS_TIMEOUT_MS_V1);
        try {
          const items = await Promise.race([
            options.systemOperations.readModelVersions({
              queryId: query.queryId,
              requestedAt: query.requestedAt,
              signal: deadline.signal,
            }),
            new Promise((_, reject) =>
              deadline.signal.addEventListener(
                "abort",
                () => reject(new Error("SYSTEM_OPERATIONS_READ_TIMED_OUT")),
                { once: true },
              ),
            ),
          ]);
          result = SystemOperationsQueryResultV1Schema.parse({
            kind: "model-versions",
            capturedAt,
            items,
          });
          if (result.kind !== "model-versions" || result.items.length === 0) {
            throw new TypeError("SYSTEM_OPERATIONS_MODEL_VERSIONS_UNAVAILABLE");
          }
        } finally {
          clearTimeout(timer);
        }
      }
      return SystemOperationsQueryResultEnvelopeV1Schema.parse({ kind: "succeeded", result });
    },
  });

  return Object.freeze({
    projection: projectionPort,
    projectionResultRead: projection.resultRead,
    projectionReportRead: reportExport.reportRead,
    qualityProjectionQuery: qualityProjection,
    systemOperationsRead,
  });
};

/**
 * 组装生产 API 的完整 `ApiPortsV1`。
 *
 * 任一必需 provider 缺失、任一必需公开方法不存在或缺任一端口方法即抛错拒绝装配。
 * 返回对象冻结；路由可用性由这里返回的实际端口决定。
 */
export const createDeploymentApiPortsV1 = (options) => {
  const missing = missingProviders(options ?? {});
  if (missing.length > 0) {
    throw new TypeError(`DEPLOYMENT_API_PROVIDER_MISSING:${missing.join(",")}`);
  }

  const engineeringDataCatalog = createPostgresEngineeringDataCatalogAdapter({
    db: options.db,
    access: options.access,
    artifactStore: options.artifactStore,
    // catalog 的两条原解析器：来源读取走 context-source registry，监测快照走 monitoring store。
    resolvers: {
      resolveReadQuery: options.contextSource.resolveReadQuery.bind(options.contextSource),
      resolveSnapshotQuery: options.monitoringStore.resolveSnapshotQuery.bind(
        options.monitoringStore,
      ),
    },
  });
  const knowledgeGovernanceRead = createPostgresKnowledgeGovernanceReadAdapter({
    db: options.db,
    access: options.access,
    artifactStore: options.artifactStore,
    ...(options.knowledgeGovernanceReadAuthorizer === undefined
      ? {}
      : { authorizeDownstream: options.knowledgeGovernanceReadAuthorizer }),
  });
  const knowledgeRetrievalRead = createPostgresKnowledgeRetrievalReadAdapter({
    relationshipResults: options.retrievalRelationshipResults,
    hybridReader: options.hybridResultReader,
    artifactStore: options.artifactStore,
    access: options.access,
  });
  const reviewQueueRead = createPostgresReviewQueueReadAdapter({
    db: options.db,
    authorization: options.access,
  });
  const reviewAuditRead = createPostgresReviewAuditRead({
    db: options.db,
    authorization: options.access,
  });

  const ports = {
    ...(options.sourceOriginal === undefined ? {} : { sourceOriginal: options.sourceOriginal }),
    // engineeringData 端口就是同一真实 context-source registry 的原端口。
    engineeringData: options.contextSource,
    engineeringDataCatalog,
    knowledgeModeling: {
      govern: (command) => options.knowledgeModeling.govern(command),
      resolve: (command) => options.knowledgeModeling.resolve(command),
      retrieve: (query) =>
        query.kind === "measure-candidates"
          ? options.recommendation.measureCandidates(query)
          : options.knowledgeModeling.retrieve(query),
    },
    applicableRuleSetAssembly: options.applicableRuleSetAssembly,
    knowledgeGovernanceRead,
    knowledgeRetrievalRead,
    riskIdentification: options.riskIdentification,
    riskIdentificationRead: options.riskIdentificationRead,
    riskAssessment: options.riskAssessment,
    riskAssessmentRead: options.riskAssessmentRead,
    warningResponse: warningResponseFor(options),
    warningResponseRead: options.warningLifecycle,
    humanDecisionFeedback: options.humanDecisionFeedback,
    calibrationGovernance: options.calibration,
    reviewAudit: options.reviewAudit,
    reviewQueueRead,
    reviewAuditRead:
      options.reviewDecisionAvailability === undefined
        ? reviewAuditRead
        : {
            async read(query) {
              const result = await reviewAuditRead.read(query);
              if (
                result.kind !== "succeeded" ||
                result.result.kind !== "task-detail" ||
                result.result.status !== "pending"
              )
                return result;
              const allowed = await options.reviewDecisionAvailability(query);
              return {
                ...result,
                result: {
                  ...result.result,
                  actions: [
                    {
                      branch: "review-audit.decide-review",
                      availability: allowed ? "allowed" : "denied",
                    },
                  ],
                },
              };
            },
          },
    agentTask: options.agentTask,
    agentTaskRead: options.agentTaskRead,
    workflow: options.workflow,
    runEventSubscription: options.runEvents,
    ...createDeploymentApiReadProvidersV1(options),
    systemAdministration: options.access.systemAdministration,
  };

  const incomplete = missingPorts(ports);
  if (incomplete.length > 0) {
    throw new TypeError(`DEPLOYMENT_API_PORT_INCOMPLETE:${incomplete.join(",")}`);
  }
  return Object.freeze(ports);
};
