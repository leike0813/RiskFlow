import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import { ArtifactStorePolicyV1Schema } from "@riskflow/core/artifacts";
import { OutboxDeliveryPolicyV1Schema } from "@riskflow/core/persistence";
import { ModelGatewayDeploymentConfigV1Schema } from "../model/config.js";
import { DocumentConversionResourcePolicyV1Schema } from "../engineering-data/document-conversion/schema.js";
import { MineruConfigV1Schema } from "../engineering-data/document-conversion/mineru/schema.js";
import { DeploymentPolicyTypeV1Schema } from "./policies.js";
import {
  HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1,
  RetrievalSourceKindV1Schema,
} from "@riskflow/core/retrieval";
import {
  KnowledgeReleaseRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
} from "@riskflow/contracts/ports";
import { RecommendationSiteContextV1Schema } from "@riskflow/core/recommendation";

/**
 * C37 D-19 宿主契约：离线发布、部署配置、桌面入口、运维操作与逻辑副本描述。
 * 这些 Schema 只描述部署与运维边界，不复制业务 HTTP DTO 或业务配置版本；
 * 复用的业务 policy 一律由调用方直接 import 原 core Schema。
 */

const safeInteger = z.number().int().refine(Number.isSafeInteger, "must be a safe integer");
const positiveSafeInteger = safeInteger.positive();
const nonNegativeSafeInteger = safeInteger.nonnegative();
/** 与 core artifacts 的 hashValue 同形；宿主契约不新增跨包第二套摘要字段。 */
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

const releaseId = IdentifierSchema;
const absolutePath = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("/"), "must be an absolute POSIX path")
  .refine((value) => !value.includes(".."), "must not contain parent traversal")
  .refine((value) => !value.includes("\0"), "must not contain NUL");

const secretFileRef = z.strictObject({
  secretId: IdentifierSchema,
  filePath: absolutePath,
});
export type DeploymentSecretFileRefV1 = z.infer<typeof secretFileRef>;

export const DEPLOYMENT_RELEASE_ARTIFACT_KIND_V1_VALUES = [
  "server-bundle",
  "web-bundle",
  "desktop-installer",
  "container-image",
  "node-runtime",
  "model-weights",
  "embedding-weights",
  "ocr-build",
  "ocr-model",
  "https-proxy",
  "system-package",
  "manual-package",
] as const;
export const DeploymentReleaseArtifactKindV1Schema = z.enum(
  DEPLOYMENT_RELEASE_ARTIFACT_KIND_V1_VALUES,
);
export type DeploymentReleaseArtifactKindV1 = z.infer<typeof DeploymentReleaseArtifactKindV1Schema>;

export const DEPLOYMENT_RELEASE_ARTIFACT_OS_V1_VALUES = [
  "linux-x64",
  "windows-x64",
  "macos-arm64",
] as const;
export const DeploymentReleaseArtifactOsV1Schema = z.enum(DEPLOYMENT_RELEASE_ARTIFACT_OS_V1_VALUES);
export type DeploymentReleaseArtifactOsV1 = z.infer<typeof DeploymentReleaseArtifactOsV1Schema>;

/** 容器镜像另含 digest；其余制品不得携带 digest。相对介质路径不得越界或含链接。 */
const releaseArtifactBase = z
  .strictObject({
    artifactId: IdentifierSchema,
    kind: DeploymentReleaseArtifactKindV1Schema,
    version: z.string().min(1),
    os: DeploymentReleaseArtifactOsV1Schema,
    arch: z.enum(["x64", "arm64"]),
    sha256: Sha256HexSchema,
    byteLength: nonNegativeSafeInteger,
    relativePath: z
      .string()
      .min(1)
      .refine((value) => !value.startsWith("/"), "must be relative to the release root")
      .refine((value) => !value.includes(".."), "must not contain parent traversal")
      .refine((value) => !value.includes("\\"), "must not contain a path separator escape"),
    officialSource: z.string().min(1),
    licenseRef: IdentifierSchema,
    sbomRef: IdentifierSchema,
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
  })
  .superRefine((value, context) => {
    const isImage = value.kind === "container-image";
    if (isImage && value.digest === undefined) {
      context.addIssue({ code: "custom", message: "container images require a digest" });
    }
    if (!isImage && value.digest !== undefined) {
      context.addIssue({ code: "custom", message: "digest is only valid for container images" });
    }
  });
export const DeploymentReleaseArtifactV1Schema = releaseArtifactBase;
export type DeploymentReleaseArtifactV1 = z.infer<typeof DeploymentReleaseArtifactV1Schema>;

const serverCompatibility = z.strictObject({
  releaseId,
  minDesktopReleaseId: releaseId,
});

export const ReleaseManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId,
  codeCommit: z.string().regex(/^[0-9a-f]{40}$/),
  createdAt: IsoDateTimeSchema,
  serverCompatibility: serverCompatibility,
  desktopCompatibility: z.strictObject({
    desktopReleaseId: releaseId,
    supportedServerReleaseIds: z.array(releaseId).min(1),
    supportedElectronVersions: z.array(z.string().min(1)).min(1),
    supportedChromiumVersions: z.array(z.string().min(1)).min(1),
    supportedBundledNodeVersions: z.array(z.string().min(1)).min(1),
  }),
  artifacts: z.array(DeploymentReleaseArtifactV1Schema).min(1),
  configTemplateRefs: z.array(IdentifierSchema).min(1),
  finalMigrationVersion: z.string().regex(/^\d{6}$/),
  operationsManualRef: IdentifierSchema,
});
export type ReleaseManifestV1 = z.infer<typeof ReleaseManifestV1Schema>;

const deploymentHost = z.strictObject({
  role: z.enum(["inference", "application", "data"]),
  host: z.string().min(1),
  ports: z.array(positiveSafeInteger).min(1),
});

const databaseIdentity = z.strictObject({
  secretFileRefs: z.array(secretFileRef).min(1),
  host: z.string().min(1),
  port: positiveSafeInteger.max(65_535),
  name: z.string().min(1),
  maxConnections: positiveSafeInteger,
  connectionTimeoutMs: positiveSafeInteger,
  idleTimeoutMs: positiveSafeInteger,
  rolePasswordSecretIds: z.strictObject({
    migratorRoleName: IdentifierSchema,
    appRoleName: IdentifierSchema,
    workerRoleName: IdentifierSchema,
    checkpointerRoleName: IdentifierSchema,
    deploymentOperatorRoleName: IdentifierSchema,
  }),
  migratorRoleName: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  appRoleName: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  workerRoleName: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  checkpointerRoleName: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  deploymentOperatorRoleName: z.string().regex(/^[a-z_][a-z0-9_]*$/),
});

const workerLifecycle = z.strictObject({
  pollMs: positiveSafeInteger,
  maxConcurrency: positiveSafeInteger,
  claimBatchSize: positiveSafeInteger,
  drainTimeoutMs: positiveSafeInteger,
  leaseTimeoutMs: positiveSafeInteger,
});

const healthBudget = z.strictObject({
  probeTimeoutMs: positiveSafeInteger,
  livenessIntervalMs: positiveSafeInteger,
  readinessIntervalMs: positiveSafeInteger,
});

const logBudget = z.strictObject({
  level: z.enum(["debug", "info", "warn", "error"]),
  retentionDays: positiveSafeInteger,
  maxFileMb: positiveSafeInteger,
});

/**
 * 业务策略只引用原 Schema 的已发布 ref 与批准配置；这里不复制任何阈值、
 * 权重或矩阵字段，具体 policy 正文由 IP-04 的 catalog 按 ref 解析。
 */
const businessPolicyBinding = z.strictObject({
  projectId: IdentifierSchema,
  policyCatalogRef: VersionReferenceSchema,
  policyRefs: z.record(DeploymentPolicyTypeV1Schema, VersionReferenceSchema),
  graphVersions: z.strictObject({
    riskFlow: VersionReferenceSchema,
    identification: VersionReferenceSchema,
    assessment: VersionReferenceSchema,
  }),
  retrievalBudgetPolicyRef: VersionReferenceSchema,
  forecastPolicyReleaseRef: KnowledgeReleaseRefV1Schema,
  calibrationTargetReleaseRef: KnowledgeReleaseRefV1Schema,
  siteContextBindings: z
    .array(
      z.strictObject({
        siteContextRef: VersionReferenceSchema,
        artifactRef: VersionReferenceSchema,
      }),
    )
    .min(1)
    .max(256)
    .superRefine((bindings, context) => {
      const seen = new Set<string>();
      for (const [index, binding] of bindings.entries()) {
        const key = JSON.stringify(binding.siteContextRef);
        if (seen.has(key))
          context.addIssue({
            code: "custom",
            path: [index],
            message: "duplicate site context version",
          });
        seen.add(key);
      }
    }),
});

/** D-19 检索质量输入：只登记受控数据集身份与 dataRoot 内文件路径，正文与符号链接检查由加载器完成。 */
const retrievalQualityDataset = z.strictObject({
  projectId: IdentifierSchema,
  datasetRef: VersionReferenceSchema,
  filePath: absolutePath,
});

export const DeploymentConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    purpose: z.enum(["production", "synthetic-acceptance"]),
    configRef: IdentifierSchema,
    releaseId,
    instanceId: IdentifierSchema,
    hosts: z.array(deploymentHost).length(3),
    publicOrigin: z
      .string()
      .regex(/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/, "must be an https origin without path"),
    localRoots: z.strictObject({
      applicationRoot: absolutePath,
      dataRoot: absolutePath,
      artifactRoot: absolutePath,
      logRoot: absolutePath,
    }),
    database: databaseIdentity,
    auth: z.strictObject({ hmacSecretId: IdentifierSchema, keyVersion: IdentifierSchema }),
    api: z.strictObject({ host: z.string().min(1), port: positiveSafeInteger.max(65_535) }),
    models: z.array(ModelGatewayDeploymentConfigV1Schema).min(1),
    artifacts: ArtifactStorePolicyV1Schema,
    outbox: OutboxDeliveryPolicyV1Schema,
    qdrant: z.strictObject({
      baseUrl: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.username === "" &&
            url.password === "" &&
            url.search === "" &&
            url.hash === "" &&
            (url.pathname === "" || url.pathname === "/")
          );
        }),
      requestTimeoutMs: positiveSafeInteger,
    }),
    policyCatalog: z.strictObject({ filePath: absolutePath, catalogRef: VersionReferenceSchema }),
    documentConversion: z.strictObject({
      resourcePolicy: DocumentConversionResourcePolicyV1Schema,
      qualityPolicyRef: VersionReferenceSchema,
      converterDeploymentRef: VersionReferenceSchema,
      mineru: MineruConfigV1Schema.nullable(),
    }),
    transport: z.strictObject({
      artifactEndpointRef: IdentifierSchema,
      connectTimeoutMs: positiveSafeInteger,
      idleTimeoutMs: positiveSafeInteger,
      totalTimeoutMs: positiveSafeInteger,
      metadataMaxBytes: positiveSafeInteger.max(1_048_576),
      maxConcurrentRequests: positiveSafeInteger,
      shutdownTimeoutMs: positiveSafeInteger,
    }),
    worker: workerLifecycle,
    health: healthBudget,
    log: logBudget,
    projectBindings: z.array(businessPolicyBinding).min(1),
    retrievalQuality: z.strictObject({
      datasets: z.array(retrievalQualityDataset).min(1).max(256),
      containerRuntime: z.string().min(1).max(256),
      timeoutMs: positiveSafeInteger,
    }),
  })
  .superRefine((config, context) => {
    if (
      new Set(config.projectBindings.map(({ projectId }) => projectId)).size !==
      config.projectBindings.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["projectBindings"],
        message: "project bindings must be unique",
      });
    }
    const hostRoles = config.hosts.map(({ role }) => role);
    if (new Set(hostRoles).size !== 3) {
      context.addIssue({ code: "custom", path: ["hosts"], message: "host roles must be unique" });
    }
    const roleNames = [
      config.database.migratorRoleName,
      config.database.appRoleName,
      config.database.workerRoleName,
      config.database.checkpointerRoleName,
      config.database.deploymentOperatorRoleName,
    ];
    if (new Set(roleNames).size !== roleNames.length) {
      context.addIssue({
        code: "custom",
        path: ["database"],
        message: "login roles must be unique",
      });
    }
    const secretIds = new Set(config.database.secretFileRefs.map(({ secretId }) => secretId));
    const mineru = config.documentConversion.mineru;
    if (mineru !== null) {
      for (const [inner, outer] of [
        [mineru.deploymentRef, config.documentConversion.converterDeploymentRef],
        [mineru.qualityPolicyRef, config.documentConversion.qualityPolicyRef],
      ]) {
        if (inner!.entityId !== outer!.entityId || inner!.versionId !== outer!.versionId) {
          context.addIssue({
            code: "custom",
            path: ["documentConversion"],
            message: "MinerU references must match document conversion configuration",
          });
        }
      }
    }
    const requiredSecretIds = [
      config.auth.hmacSecretId,
      ...Object.values(config.database.rolePasswordSecretIds),
      ...config.models.flatMap((model) =>
        model.backend === "network-api" && model.config.protocol === "openai-chat"
          ? [model.config.credentialRef]
          : [],
      ),
      ...(mineru?.credentialRef ? [mineru.credentialRef] : []),
    ];
    if (secretIds.size !== config.database.secretFileRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["database", "secretFileRefs"],
        message: "deployment secret ids must be unique",
      });
    }
    for (const secretId of requiredSecretIds) {
      if (!secretIds.has(secretId)) {
        context.addIssue({
          code: "custom",
          path: ["database", "secretFileRefs"],
          message: "deployment secret references must include every required secret id",
        });
        break;
      }
    }
    if (new Set(requiredSecretIds).size !== requiredSecretIds.length) {
      context.addIssue({
        code: "custom",
        path: ["database", "rolePasswordSecretIds"],
        message: "each login role and HMAC key requires a distinct secret id",
      });
    }
    const boundProjectIds = new Set(config.projectBindings.map(({ projectId }) => projectId));
    const dataRoot = config.localRoots.dataRoot.replace(/\/$/, "");
    const datasetKeys = new Set<string>();
    for (const [index, dataset] of config.retrievalQuality.datasets.entries()) {
      if (!boundProjectIds.has(dataset.projectId)) {
        context.addIssue({
          code: "custom",
          path: ["retrievalQuality", "datasets", index, "projectId"],
          message: "retrieval dataset must reference a bound project",
        });
      }
      const key = JSON.stringify([
        dataset.projectId,
        dataset.datasetRef.entityId,
        dataset.datasetRef.versionId,
      ]);
      if (datasetKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["retrievalQuality", "datasets", index, "datasetRef"],
          message: "retrieval dataset project and exact version must be unique",
        });
      }
      datasetKeys.add(key);
      if (!dataset.filePath.startsWith(`${dataRoot}/`)) {
        context.addIssue({
          code: "custom",
          path: ["retrievalQuality", "datasets", index, "filePath"],
          message: "retrieval dataset file must be located inside the data root",
        });
      }
    }
  });
export type DeploymentConfigV1 = z.infer<typeof DeploymentConfigV1Schema>;

export const DesktopConfigV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  deploymentId: IdentifierSchema,
  publicOrigin: z
    .string()
    .regex(
      /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/,
      "must be an https origin without path, userinfo, query or fragment",
    ),
  serverCompatibilityRange: z.strictObject({
    minServerReleaseId: releaseId,
    maxServerReleaseId: releaseId,
  }),
});
export type DesktopConfigV1 = z.infer<typeof DesktopConfigV1Schema>;

export const DEPLOYMENT_OPERATION_ACTION_V1_VALUES = [
  "verify",
  "init",
  "status",
  "maintenance",
  "backup",
  "restore-verify",
  "activate",
  "rollback",
  "benchmark",
] as const;
export const DeploymentOperationActionV1Schema = z.enum(DEPLOYMENT_OPERATION_ACTION_V1_VALUES);
export type DeploymentOperationActionV1 = z.infer<typeof DeploymentOperationActionV1Schema>;

/** activate/rollback 必须确认精确目标；其余动作不得携带确认。 */
const operationConfirmation = z.strictObject({
  targetInstanceId: IdentifierSchema,
  releaseId,
  configRef: IdentifierSchema,
  expectedRevision: nonNegativeSafeInteger,
});

export const DeploymentOperationV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    operationId: IdentifierSchema,
    idempotencyKey: z.string().min(1).max(200),
    action: DeploymentOperationActionV1Schema,
    releaseId,
    configRef: IdentifierSchema,
    instanceId: IdentifierSchema,
    actorId: IdentifierSchema,
    currentAuthorizationRefs: z.array(IdentifierSchema).min(1),
    issuedAt: IsoDateTimeSchema,
    expectedRevision: nonNegativeSafeInteger,
    backupId: IdentifierSchema.optional(),
    targetInstanceId: IdentifierSchema.optional(),
    confirmation: operationConfirmation.optional(),
    payloadDigest: Sha256HexSchema,
  })
  .superRefine((value, context) => {
    const requiresConfirmation = value.action === "activate" || value.action === "rollback";
    if (requiresConfirmation && value.confirmation === undefined) {
      context.addIssue({ code: "custom", message: "activate and rollback require a confirmation" });
    }
    if (!requiresConfirmation && value.confirmation !== undefined) {
      context.addIssue({
        code: "custom",
        message: "confirmation is only valid for activate and rollback",
      });
    }
    if (
      (value.action === "restore-verify" || value.action === "backup") &&
      value.backupId === undefined
    ) {
      context.addIssue({ code: "custom", message: "backup operations require a backupId" });
    }
    if (
      value.action !== "backup" &&
      value.action !== "restore-verify" &&
      value.backupId !== undefined
    ) {
      context.addIssue({ code: "custom", message: "backupId is only valid for backup operations" });
    }
  });
export type DeploymentOperationV1 = z.infer<typeof DeploymentOperationV1Schema>;

export const projectBackupAuthorization = z.strictObject({
  projectId: IdentifierSchema,
  authorizationRefs: z.array(IdentifierSchema).min(1),
  hashManifestRef: IdentifierSchema,
});

export const LogicalBackupDescriptorV1Schema = z.strictObject({
  backupId: IdentifierSchema,
  operationId: IdentifierSchema,
  sourceInstanceId: IdentifierSchema,
  releaseId,
  configRef: IdentifierSchema,
  modelGatewayRef: IdentifierSchema,
  ocrRef: IdentifierSchema,
  policyCatalogRef: IdentifierSchema,
  projectIds: z.array(IdentifierSchema).min(1),
  projectAuthorizations: z.array(projectBackupAuthorization).min(1),
  dbSnapshotRef: IdentifierSchema,
  fileSnapshotRef: IdentifierSchema,
  dumpManifestRef: IdentifierSchema,
  fileManifestRef: IdentifierSchema,
  finalMigrationVersion: z.string().regex(/^\d{6}$/),
  quiesceEvidenceRef: IdentifierSchema,
  createdStage: z.enum(["manifests", "dump", "artifacts", "descriptor-published", "verified"]),
  operationAuditRefs: z.array(IdentifierSchema).min(1),
});
export type LogicalBackupDescriptorV1 = z.infer<typeof LogicalBackupDescriptorV1Schema>;

export const DEPLOYMENT_OPERATION_STATUS_V1_VALUES = [
  "accepted",
  "running",
  "awaiting-confirmation",
  "completed",
  "failed",
  "pending-audit",
] as const;
export const DeploymentOperationStatusV1Schema = z.enum(DEPLOYMENT_OPERATION_STATUS_V1_VALUES);
export type DeploymentOperationStatusV1 = z.infer<typeof DeploymentOperationStatusV1Schema>;

export const DeploymentOperationResultV1Schema = z.strictObject({
  operationId: IdentifierSchema,
  revision: nonNegativeSafeInteger,
  stage: z.string().min(1),
  status: DeploymentOperationStatusV1Schema,
  safeReasonCode: z.string().min(1),
  releaseId,
  instanceId: IdentifierSchema,
  backupId: IdentifierSchema.optional(),
  perProjectAuditRefs: z.array(IdentifierSchema),
  operationAuditIds: z.array(IdentifierSchema),
  stageCounters: z.record(z.string(), nonNegativeSafeInteger),
  elapsedMs: nonNegativeSafeInteger,
});
export type DeploymentOperationResultV1 = z.infer<typeof DeploymentOperationResultV1Schema>;

// ------------------------------------------------------- 功能验收合成输入（D-20）
const DEPLOYMENT_ACCEPTANCE_SCHEMA_VERSION_V1 = "1" as const;

/**
 * 功能验收现场材料包（D-20）：只声明哪些精确 siteContextRef 正文存在且归本工程。
 * 正文本身由原 C04 put 登记并在运行时按受权精确 ref 读取；这里不复制正文、
 * 不预填建议结果或校验结论，也不构成第二套现场规则。
 */
export const DeploymentSyntheticSiteContextPackV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DEPLOYMENT_ACCEPTANCE_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    packRef: VersionReferenceSchema,
    sampleNotice: z.literal(HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1),
    contexts: z.array(RecommendationSiteContextV1Schema).min(1).max(256),
  })
  .superRefine((pack, context) => {
    const seen = new Set<string>();
    pack.contexts.forEach((entry, index) => {
      const key = entry.siteContextRef.entityId + "@" + entry.siteContextRef.versionId;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["contexts", index, "siteContextRef"],
          message: "siteContextRef must be unique within the pack",
        });
      }
      seen.add(key);
      if (entry.projectId !== pack.projectId) {
        context.addIssue({
          code: "custom",
          path: ["contexts", index, "projectId"],
          message: "site context projectId does not match the pack project",
        });
      }
    });
  });
export type DeploymentSyntheticSiteContextPackV1 = z.infer<
  typeof DeploymentSyntheticSiteContextPackV1Schema
>;

/**
 * 功能验收检索数据集（D-20）：只声明精确查询文本与确定性验收所需的 grade。
 * 仅 queryText 送 Embedding；relevance 留在确定性验收计算，不进入模型输入。
 * 三类来源分类与知识发布引用直接复用 core/contracts 原 Schema，不另建来源表。
 */
export const DEPLOYMENT_RETRIEVAL_QUERY_TEXT_MAX_BYTES_V1 = 16 * 1024;

const relevanceEntrySchema = z.strictObject({
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  grade: z.number().int().min(1).max(3),
});

const retrievalQuerySchema = z
  .strictObject({
    queryId: IdentifierSchema,
    queryText: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= DEPLOYMENT_RETRIEVAL_QUERY_TEXT_MAX_BYTES_V1,
        { message: "queryText must stay within the 16 KiB UTF-8 bound" },
      ),
    relevance: z.array(relevanceEntrySchema).min(1).max(256),
  })
  .superRefine((query, context) => {
    const seen = new Set<string>();
    query.relevance.forEach((entry, index) => {
      const key =
        entry.sourceKind +
        "|" +
        entry.sourceReleaseRef.reference.entityId +
        "@" +
        entry.sourceReleaseRef.reference.versionId +
        "|" +
        entry.sourceEntryId;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["relevance", index],
          message: "relevance identity must be unique within a query",
        });
      }
      seen.add(key);
    });
  });

export const DeploymentRetrievalDatasetV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DEPLOYMENT_ACCEPTANCE_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    datasetRef: VersionReferenceSchema,
    evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
    syntheticSample: z.boolean(),
    sampleNotice: z.literal(HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1).optional(),
    queries: z.array(retrievalQuerySchema).min(1).max(256),
  })
  .superRefine((dataset, context) => {
    if (dataset.syntheticSample && dataset.sampleNotice === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sampleNotice"],
        message: "synthetic datasets must carry the pending-review notice",
      });
    }
    const seen = new Set<string>();
    dataset.queries.forEach((query, index) => {
      if (seen.has(query.queryId)) {
        context.addIssue({
          code: "custom",
          path: ["queries", index, "queryId"],
          message: "queryId must be unique within the dataset",
        });
      }
      seen.add(query.queryId);
    });
  });
export type DeploymentRetrievalDatasetV1 = z.infer<typeof DeploymentRetrievalDatasetV1Schema>;
