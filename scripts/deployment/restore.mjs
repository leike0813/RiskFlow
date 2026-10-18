#!/usr/bin/env node
/**
 * C37 D-10/D-11：隔离恢复、人工切换与回退。
 *
 * 不变量：
 * - 恢复写入**新的**隔离数据库与工件根，原实例保持不动，绝不在线覆盖；
 * - 先核对原副本集合，再产生新诊断工件——诊断件不得改变被核对的集合；
 * - 索引只从正式事实与原配置重建，并必须通过原就绪门；空索引不是成功；
 * - 切换需人工确认精确目标；输入变化令确认失效，不默认确认；
 * - 切换失败保留两个数据根，按记录显式回退，不自动删除。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL, URL } from "node:url";
import { createRequire } from "node:module";
import { IdentifierSchema } from "../../packages/contracts/dist/index.js";
import {
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
} from "../../packages/contracts/dist/ports/index.js";
import { DomainEventV1Schema } from "../../packages/contracts/dist/events/index.js";
import { RetrievalGenerationRefV1Schema } from "../../packages/core/dist/retrieval/index.js";
import { createPostgresRuntime } from "../../packages/adapters/dist/postgres/index.js";
import {
  createDeploymentSecretFileLoaderV1,
  createPostgresDeploymentOperationStoreV1,
  DeploymentConfigV1Schema,
} from "../../packages/adapters/dist/deployment/index.js";
import { PostgresRetrievalAdapter } from "../../packages/adapters/dist/retrieval/index.js";
import {
  createDeploymentGraphsV1,
  loadDeploymentFoundationInputV1,
  deploymentConnectionV1,
} from "./start.mjs";

const { z } = createRequire(new URL("../../packages/contracts/dist/index.js", import.meta.url))(
  "zod",
);
export const RestoredGenerationJobV1Schema = z.strictObject({
  operationId: IdentifierSchema,
  sourceConfigFile: z.string().min(1),
  configFile: z.string().min(1),
  manifestFile: z.string().min(1),
  projectId: IdentifierSchema,
  generationRef: RetrievalGenerationRefV1Schema,
  loginName: z.string().min(1),
  passwordSecretFile: z.string().min(1),
  requestedSpatialScopeRefs: z.array(SpatialScopeRefV1Schema),
  requestedSourceVersionRefs: z.array(SourceVersionRefV1Schema),
});

export const RESTORE_ERROR_V1 = {
  identityMismatch: "RESTORE_IDENTITY_MISMATCH",
  reconcileFailed: "RESTORE_RECONCILE_FAILED",
  indexNotRebuilt: "RESTORE_INDEX_NOT_REBUILT",
  confirmationMissing: "RESTORE_CONFIRMATION_MISSING",
  confirmationStale: "RESTORE_CONFIRMATION_STALE",
  targetUnknown: "RESTORE_TARGET_UNKNOWN",
};

export class RestoreError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.name = "RestoreError";
    this.code = code;
    this.detail = detail;
  }
}

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 待人工确认的精确目标；确认与目标一一绑定，输入变化即失效。 */
export const createActivationPlanV1 = ({ backup, target }) => {
  const targetDigest = digestOf(target);
  return Object.freeze({
    planId: `activate-${backup.backupId}`,
    backupId: backup.backupId,
    backupRevision: backup.revision,
    targetDigest,
    target: Object.freeze({ ...target }),
  });
};

/**
 * 确认精确目标。
 *
 * `observedTarget` 必须与计划时的目标逐字节一致：任何漂移都要求重新确认，
 * 不允许沿用旧确认切换到别的实例或修订。
 */
export const confirmActivationV1 = (plan, observedTarget) => {
  if (digestOf(observedTarget) !== plan.targetDigest) {
    throw new RestoreError(RESTORE_ERROR_V1.confirmationStale, plan.planId);
  }
  return Object.freeze({
    planId: plan.planId,
    backupId: plan.backupId,
    target: plan.target,
    confirmed: true,
  });
};

/**
 * 隔离恢复核验。
 *
 * 只读核对，不产生新诊断工件；核对通过后才允许进入索引重建与人工确认。
 */
export const verifyIsolatedRestoreV1 = async ({ reconcile, expectedProjects }) => {
  const results = [];
  for (const projectId of expectedProjects) {
    const handle = await reconcile({ projectId });
    let consumed = 0;
    const bad = [];
    for await (const finding of handle.findings) {
      consumed += 1;
      if (finding.kind !== "consistent") bad.push(finding.ref);
    }
    const summary = await handle.summary;
    if (summary.findingCount !== consumed) {
      throw new RestoreError(RESTORE_ERROR_V1.reconcileFailed, `${projectId}:incomplete`);
    }
    if (bad.length > 0 || summary.consistent !== true) {
      throw new RestoreError(RESTORE_ERROR_V1.reconcileFailed, `${projectId}:${bad.join(",")}`);
    }
    results.push(Object.freeze({ projectId, consumed, passed: true }));
  }
  return Object.freeze({ projects: Object.freeze(results), passed: true });
};

/**
 * 索引重建。
 *
 * 必须由正式事实重建并通过原就绪门；记录数为零时按失败处理，
 * 不能把「空索引」当作恢复成功。
 */
export const rebuildIndexesV1 = async ({ rebuild, readinessGate }) => {
  const rebuilt = await rebuild({ fromFormalFacts: true, policy: "original" });
  const gate = await readinessGate();
  if (rebuilt.memberCount === 0) {
    throw new RestoreError(RESTORE_ERROR_V1.indexNotRebuilt, "empty-index");
  }
  if (gate.ready !== true) {
    throw new RestoreError(RESTORE_ERROR_V1.indexNotRebuilt, gate.reasonCode ?? "gate");
  }
  return Object.freeze({ memberCount: rebuilt.memberCount, generation: rebuilt.generation });
};

/**
 * 人工切换。
 *
 * 失败时保留两个数据根并返回可回退目标；不自动删除任何一个。
 */
export const activateTargetV1 = async ({ plan, confirmation, switchTo }) => {
  if (confirmation === undefined || confirmation.confirmed !== true) {
    throw new RestoreError(RESTORE_ERROR_V1.confirmationMissing, plan.planId);
  }
  if (confirmation.planId !== plan.planId || digestOf(plan.target) !== plan.targetDigest) {
    throw new RestoreError(RESTORE_ERROR_V1.confirmationStale, plan.planId);
  }
  const outcome = await switchTo(plan.target);
  if (outcome.ok !== true) {
    // 双根保留：原实例与隔离实例都还在，由操作者按记录显式回退。
    return Object.freeze({
      activated: false,
      rollbackTarget: outcome.rollbackTarget ?? plan.target.previousInstanceId,
      bothRootsRetained: true,
    });
  }
  return Object.freeze({
    activated: true,
    instanceId: outcome.instanceId,
    bothRootsRetained: false,
  });
};

/**
 * 发布回退。
 *
 * 软件回退与数据恢复是两件事：旧发布若无法解析当前数据库或工件，
 * 必须先构造匹配副本的隔离实例，不能只换旧镜像继续服务。
 */
export const planRollbackV1 = ({ fromRelease, toRelease, currentArtifactsCompatible }) => {
  const compatible = currentArtifactsCompatible === true;
  return Object.freeze({
    fromRelease,
    toRelease,
    requiresIsolatedInstance: !compatible,
    reasonCode: compatible ? "ROLLBACK_COMPATIBLE" : "ROLLBACK_REQUIRES_MATCHED_COPY",
  });
};

export const assertIsolatedRestoreTargetV1 = async ({ source, target }) => {
  const sameDatabase =
    source.database.host === target.database.host &&
    source.database.port === target.database.port &&
    source.database.name === target.database.name;
  if (
    target.purpose !== "synthetic-acceptance" ||
    source.instanceId === target.instanceId ||
    sameDatabase ||
    (await realpath(source.localRoots.artifactRoot)) ===
      (await realpath(target.localRoots.artifactRoot)) ||
    new URL(source.qdrant.baseUrl).origin === new URL(target.qdrant.baseUrl).origin
  ) {
    throw new RestoreError(RESTORE_ERROR_V1.identityMismatch, "restore-target-not-isolated");
  }
};

/** 显式维护原代际；不启动worker、不重投已完成事件。 */
export const rebuildRestoredGenerationV1 = async (rawJob) => {
  const job = RestoredGenerationJobV1Schema.parse(rawJob);
  const input = await loadDeploymentFoundationInputV1({
    configFile: job.configFile,
    manifestFile: job.manifestFile,
    role: "worker",
  });
  const source = DeploymentConfigV1Schema.parse(
    JSON.parse(await readFile(job.sourceConfigFile, "utf8")),
  );
  await assertIsolatedRestoreTargetV1({ source, target: input.config });
  const generationRef = RetrievalGenerationRefV1Schema.parse(job.generationRef);
  const password = createDeploymentSecretFileLoaderV1({ expectedUid: process.getuid() })([
    { secretId: "restore-login", filePath: job.passwordSecretFile },
  ])["restore-login"];
  const host = await createDeploymentGraphsV1({ ...input, role: "worker" });
  let session;
  let operator;
  let eventReader;
  let operation;
  let operations;
  let operationStartedHere = false;
  try {
    const { foundation } = host;
    const access = foundation.access;
    const store = new PostgresRetrievalAdapter({
      db: foundation.runtime.db,
      transactionUnit: foundation.transactionUnit,
    });
    const generation = await store.readGeneration(generationRef);
    if (generation === undefined || generation.identity.projectId !== job.projectId)
      throw new RestoreError(RESTORE_ERROR_V1.identityMismatch, "generation-not-found");
    const operatorSecretId = input.config.database.rolePasswordSecretIds.deploymentOperatorRoleName;
    const operatorSecrets = createDeploymentSecretFileLoaderV1({ expectedUid: process.getuid() })(
      input.config.database.secretFileRefs.filter((ref) => ref.secretId === operatorSecretId),
    );
    operator = createPostgresRuntime({
      ...deploymentConnectionV1(input.config, input.secrets, "worker"),
      user: input.config.database.deploymentOperatorRoleName,
      password: operatorSecrets[operatorSecretId],
    });
    eventReader = createPostgresRuntime(
      deploymentConnectionV1(input.config, input.secrets, "worker"),
    );
    // 由既有worker身份读取原事件，运维身份仅操作运维台账。
    const eventRow = await eventReader.db
      .selectFrom("outbox.events")
      .select("event_json")
      .where("event_id", "=", generation.identity.sourceEventId)
      .executeTakeFirst();
    if (eventRow === undefined)
      throw new RestoreError(RESTORE_ERROR_V1.identityMismatch, "source-event-missing");
    const event = DomainEventV1Schema.parse(eventRow.event_json);
    const invocationId = `restore-invocation-${randomUUID()}`;
    session = await access.login({
      kind: "login",
      loginAttemptId: invocationId,
      loginName: job.loginName,
      password,
    });
    const authorization = await access.authorize({
      invocationId,
      projectId: job.projectId,
      branch: "knowledge-modeling.hybrid-evidence",
      requestedSpatialScopeRefs: job.requestedSpatialScopeRefs,
      requestedSourceVersionRefs: job.requestedSourceVersionRefs,
      invocation: { kind: "human-session", sessionToken: session.sessionToken },
    });
    operations = createPostgresDeploymentOperationStoreV1({
      db: operator.db,
      instanceId: input.config.instanceId,
      idGenerator: () => `deployment-audit-${randomUUID()}`,
    });
    operation = await operations.accept({
      operationId: job.operationId,
      instanceId: input.config.instanceId,
      idempotencyKey: job.operationId,
      payloadDigest: digestOf(job),
      action: "restore-verify",
      actorId: authorization.context.actorId,
      inputRefs: [generationRef.reference.entityId],
    });
    if (operation.status !== "accepted")
      throw new RestoreError(RESTORE_ERROR_V1.identityMismatch, "operation-already-started");
    const resultRefs = {
      releaseId: input.config.releaseId,
      perProjectAuditRefs: [],
      stageCounters: {},
    };
    operation = await operations.advance({
      operationId: job.operationId,
      instanceId: input.config.instanceId,
      expectedRevision: operation.revision,
      stage: "running",
      status: "running",
      resultRefs,
      reasonCode: "RESTORED_GENERATION_REBUILD",
    });
    operationStartedHere = true;
    const outcome = await foundation.authorizationScope.run(
      {
        authorization: authorization.context,
        causalCommandRef: {
          kind: "command",
          commandId: job.operationId,
          authorizationContextRef: authorization.context.authorizationContextRef,
        },
      },
      () =>
        host.identification.compositions.retrieval.projectionHandler.rebuildGeneration({
          event,
          generationRef,
          authorization: authorization.context,
          operationId: job.operationId,
        }),
    );
    if (outcome.kind !== "rebuilt")
      throw new RestoreError(RESTORE_ERROR_V1.indexNotRebuilt, outcome.failure.detailCode);
    operation = await operations.advance({
      operationId: job.operationId,
      instanceId: input.config.instanceId,
      expectedRevision: operation.revision,
      stage: "completed",
      status: "completed",
      resultRefs: { ...resultRefs, stageCounters: { members: outcome.memberCount } },
      reasonCode: "RESTORED_GENERATION_READY",
    });
    return {
      schemaVersion: "1",
      status: "REBUILT",
      operationId: job.operationId,
      instanceId: input.config.instanceId,
      releaseId: input.config.releaseId,
      generationRef,
      memberCount: outcome.memberCount,
      auditRefs: await operations.readAuditRefs({
        operationId: job.operationId,
        instanceId: input.config.instanceId,
      }),
      consumerReceiptsReset: false,
      activationChanged: false,
    };
  } catch (error) {
    if (operationStartedHere && operation?.status === "running")
      await operations.advance({
        operationId: job.operationId,
        instanceId: input.config.instanceId,
        expectedRevision: operation.revision,
        stage: "failed",
        status: "failed",
        resultRefs: operation.resultRefs,
        reasonCode: "RESTORED_GENERATION_REBUILD_FAILED",
      });
    throw error;
  } finally {
    let cleanupFailures = 0;
    if (session) {
      try {
        await host.foundation.access.logout({ kind: "logout", sessionToken: session.sessionToken });
      } catch {
        cleanupFailures += 1;
      }
    }
    const closed = await Promise.allSettled(
      [() => operator?.close(), () => eventReader?.close(), () => host.close()].map((close) =>
        Promise.resolve().then(close),
      ),
    );
    cleanupFailures += closed.filter((result) => result.status === "rejected").length;
    if (cleanupFailures > 0)
      process.stderr.write(
        JSON.stringify({ stage: "restore-cleanup", status: "warning", count: cleanupFailures }) +
          "\n",
      );
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: { job: { type: "string" }, output: { type: "string" } },
  });
  const output = await open(values.output, "wx", 0o600);
  try {
    const job = JSON.parse(await readFile(values.job, "utf8"));
    const result = await rebuildRestoredGenerationV1(job);
    await output.writeFile(JSON.stringify(result, null, 2) + "\n");
    await output.sync();
    process.stdout.write(
      JSON.stringify({ status: result.status, memberCount: result.memberCount }) + "\n",
    );
  } catch (error) {
    await output.writeFile(
      JSON.stringify({
        status: "FAILED",
        code: error.code ?? "RESTORE_REBUILD_FAILED",
        detail: error instanceof RestoreError ? error.detail : "restore-rebuild-failed",
      }) + "\n",
    );
    await output.sync();
    process.exitCode = 1;
  } finally {
    await output.close();
  }
}
