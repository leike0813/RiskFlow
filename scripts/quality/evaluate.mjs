#!/usr/bin/env node
/**
 * C36 数据集计算 CLI（D-07）：冻结数据集为 C04 内容工件，按显式引用计算确定性质量指标，
 * 先写 C04 报告工件，再在 C03 单个原子命令中追加索引、回执与审计。
 *
 * 用法：pnpm quality:evaluate -- --dataset <dataset.json> --output <result-ref.json>
 * 连接与身份来自 `QUALITY_EVALUATION_CONFIG` 指向的 JSON 配置；只输出安全报告引用与实际命令。
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextEncoder } from "node:util";

// CLI 以生产形态运行：只依赖已构建的包产物，不经过源码入口。
import { createPostgresLocalIdentityAccess } from "../../packages/adapters/dist/auth/index.js";
import { createContentAddressedArtifactStore } from "../../packages/adapters/dist/artifacts/index.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../packages/adapters/dist/identification/candidate-finalization/index.js";
import { createPostgresQualityEvaluationAdapter } from "../../packages/adapters/dist/quality/index.js";
import { createPostgresRuntime } from "../../packages/adapters/dist/postgres/pool.js";
import { PostgresTransactionUnit } from "../../packages/adapters/dist/postgres/transaction-unit.js";
import { ArtifactPutCommandV1Schema } from "../../packages/core/dist/artifacts/index.js";
import { createQualityEvaluationService } from "../../packages/core/dist/quality/index.js";

const USAGE = "usage: pnpm quality:evaluate -- --dataset <dataset.json> --output <result-ref.json>";

const argumentValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for --${name}\n${USAGE}`);
  }
  return value;
};

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const config = JSON.parse(readFileSync(process.env.QUALITY_EVALUATION_CONFIG ?? "", "utf8"));
const datasetPath = argumentValue("dataset");
const outputPath = argumentValue("output");
if (datasetPath === undefined || outputPath === undefined) throw new Error(USAGE);

const dataset = JSON.parse(readFileSync(resolve(datasetPath), "utf8"));
const command = process.argv.join(" ");
const datasetArtifactId = `quality-dataset-${dataset.datasetId}@${dataset.datasetVersion}`;
const commandId = `quality-evaluation-${sha256(`${config.projectId}|${datasetArtifactId}|${config.codeHead}`)}`;

const runtime = createPostgresRuntime(config.connection, "riskflow_app");
const artifactStore = await createContentAddressedArtifactStore({
  ...config.connection,
  rootDirectory: config.artifactRootDirectory,
  policy: config.artifactPolicy,
});
const transactionUnit = new PostgresTransactionUnit(runtime.db);
const access = createPostgresLocalIdentityAccess({
  ...config.connection,
  hmacKey: Buffer.from(config.hmacKeyBase64, "base64"),
  keyVersion: config.keyVersion,
});

try {
  const session = await access.login({
    kind: "login",
    loginAttemptId: `${commandId}:login`,
    loginName: config.loginName,
    password: config.password,
  });
  const decision = await access.authorize({
    invocation: { kind: "human-session", sessionToken: session.sessionToken },
    invocationId: `${commandId}:authorize`,
    projectId: config.projectId,
    branch: "projection.export",
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [],
  });
  const authorization = decision.context;

  const datasetPayload = new TextEncoder().encode(JSON.stringify(dataset, null, 2));
  const datasetPut = await artifactStore.put(
    ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `${commandId}:artifact-put:quality-evaluation.dataset`,
      idempotencyKey: `${commandId}:artifact-put:quality-evaluation.dataset`,
      projectId: config.projectId,
      actorId: authorization.actorId,
      issuedAt: new Date().toISOString(),
      authorization,
      requiredCapability: "projection.export",
      artifactId: datasetArtifactId,
      artifactKind: "content",
      purposeCode: "quality-evaluation.dataset",
      mediaType: "application/vnd.riskflow.quality-evaluation-dataset+json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    }),
    (async function* () {
      yield datasetPayload;
    })(),
  );

  const adapter = createPostgresQualityEvaluationAdapter({
    db: runtime.db,
    transactionUnit,
    artifactStore,
    artifactReferenceGuard: artifactStore.referenceGuard,
    recordStore: new PostgresRiskCandidateFinalizationAdapter({
      db: runtime.db,
      transactionUnit,
    }),
  });
  const service = createQualityEvaluationService(adapter.serviceOptions());
  const result = await service.evaluateDataset({
    projectId: config.projectId,
    actorId: authorization.actorId,
    commandId,
    idempotencyKey: commandId,
    requestedAt: new Date().toISOString(),
    datasetArtifactRef: datasetPut.artifactRef,
    runRefs: config.runRefs ?? [],
    authorization,
    runEvidence: {
      commands: [command],
      codeHead: config.codeHead,
      environment: {
        nodeVersion: process.version,
        platform: `${process.platform}/${process.arch}`,
        ...(config.browserVersion === undefined ? {} : { browserVersion: config.browserVersion }),
      },
    },
  });

  const output =
    result.kind === "succeeded"
      ? {
          schemaVersion: "1",
          datasetArtifactRef: result.datasetArtifactRef,
          reportArtifactRef: result.reportArtifactRef,
          command,
          metrics: result.summary.metrics,
        }
      : { schemaVersion: "1", command, failure: result.failure };
  writeFileSync(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = result.kind === "succeeded" ? 0 : 1;
} finally {
  await access.close().catch(() => undefined);
  await artifactStore.close().catch(() => undefined);
  await runtime.close().catch(() => undefined);
}
