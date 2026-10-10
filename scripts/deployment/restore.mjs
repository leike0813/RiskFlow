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
import { createHash } from "node:crypto";

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
