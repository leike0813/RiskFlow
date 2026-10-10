import { z } from "zod";

import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";

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
  policyCatalogRef: IdentifierSchema,
});

export const DeploymentConfigV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
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
