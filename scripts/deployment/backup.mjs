#!/usr/bin/env node
/**
 * C37 D-08/D-09：维护窗口内的同机逻辑副本编排。
 *
 * 顺序不可颠倒（D-09 固定）：
 *   授权与容量 → 停写回执 → 逐工程 C04 哈希清单 → 完整数据库逻辑导出
 *   → 复制全部耐久工件（含本批清单）→ 耐久发布 descriptor。
 *
 * 先 dump 再登记清单会产生不自洽的恢复点；只复制可见文件会漏掉不可见引用。
 * 本模块只编排与判定，绝不代替所属模块执行 SQL 或文件操作。
 */
import { createHash } from "node:crypto";

export const BACKUP_ERROR_V1 = {
  notQuiesced: "BACKUP_NOT_QUIESCED",
  writerUnknown: "BACKUP_WRITER_UNKNOWN",
  authorizationIncomplete: "BACKUP_AUTHORIZATION_INCOMPLETE",
  capacityInsufficient: "BACKUP_CAPACITY_INSUFFICIENT",
  manifestNotConsumed: "BACKUP_MANIFEST_NOT_CONSUMED",
  copyFailed: "BACKUP_COPY_FAILED",
  descriptorNotDurable: "BACKUP_DESCRIPTOR_NOT_DURABLE",
  idempotencyConflict: "BACKUP_IDEMPOTENCY_CONFLICT",
};

export class BackupError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.name = "BackupError";
    this.code = code;
    this.detail = detail;
  }
}

/** 副本必须覆盖的阶段；descriptor 只在全部阶段耐久后才可发布。 */
export const BACKUP_STAGES_V1 = Object.freeze([
  "authorized",
  "quiesced",
  "manifests",
  "dumped",
  "artifacts-copied",
  "descriptor-published",
]);

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * 同机逻辑副本编排器。
 *
 * 依赖以窄接口注入，真实实现在运行时绑定；本类只保证顺序、失败闭合与身份稳定。
 */
export class LogicalBackupV1 {
  #operationId;
  #payloadDigest;
  #instanceId;
  #stages = new Map();

  constructor({ operationId, payload, instanceId }) {
    this.#operationId = operationId;
    this.#payloadDigest = digestOf(payload);
    this.#instanceId = instanceId;
  }

  get operationId() {
    return this.#operationId;
  }

  get payloadDigest() {
    return this.#payloadDigest;
  }

  completedStages() {
    return BACKUP_STAGES_V1.filter((stage) => this.#stages.has(stage));
  }

  /**
   * 受理同一身份的重复请求：载荷一致则复用已成立阶段。
   * 载荷不同必须在任何新副作用之前失败，不能替换已成立的副本。
   */
  async resumeWith(input) {
    if (digestOf(input.payload) !== this.#payloadDigest) {
      throw new BackupError(BACKUP_ERROR_V1.idempotencyConflict, this.#operationId);
    }
    return this;
  }

  /** 容量与授权先于任何数据动作；缺任一项即整批失败，不产生部分成功。 */
  async assertCapacityAndAuthorization(input) {
    if (input.capacityRequiredBytes > input.capacityAvailableBytes) {
      throw new BackupError(BACKUP_ERROR_V1.capacityInsufficient);
    }
    if (input.projectIds.length === 0) {
      throw new BackupError(BACKUP_ERROR_V1.authorizationIncomplete, "no authorized project");
    }
    for (const project of input.projects) {
      if (project.projectId !== undefined && project.authorizationRefs.length === 0) {
        throw new BackupError(BACKUP_ERROR_V1.authorizationIncomplete, project.projectId);
      }
    }
    this.#stages.set("authorized", {
      projectIds: Object.freeze([...input.projectIds]),
    });
    return this;
  }

  /**
   * 停写确认。
   *
   * 必须证明全部写者已停止且在途写已收口；出现未知写者或未收口时拒绝继续，
   * 因为此时生成的副本无法作为恢复点。
   */
  async assertQuiesced(input) {
    if (input.unknownWriters.length > 0) {
      throw new BackupError(BACKUP_ERROR_V1.writerUnknown, input.unknownWriters.join(","));
    }
    if (input.inFlightWrites > 0) {
      throw new BackupError(BACKUP_ERROR_V1.notQuiesced, String(input.inFlightWrites));
    }
    this.#stages.set("quiesced", Object.freeze({ ...input }));
    return this;
  }

  /**
   * 逐工程生成并**完整消费** C04 哈希清单。
   *
   * 未消费完的清单等于没有登记：此时导出的数据库会引用尚未登记的工件。
   */
  async createManifests(input) {
    const manifests = [];
    for (const projectId of input.projectIds) {
      const handle = await input.createHashManifest({ projectId });
      let consumed = 0;
      for await (const finding of handle.findings) {
        consumed += 1;
        manifests.push({ projectId, findingRef: finding.ref });
      }
      // findings 是异步可迭代：必须读到 summary 才算完成。
      const summary = await handle.summary;
      if (summary.projectId !== projectId || summary.findingCount !== consumed) {
        throw new BackupError(BACKUP_ERROR_V1.manifestNotConsumed, projectId);
      }
      manifests.push({ projectId, summaryRef: summary.ref });
    }
    this.#stages.set("manifests", Object.freeze({ manifests }));
    return this;
  }

  /** 完整逻辑导出：业务、身份、审计、Outbox、checkpoint 与迁移版本一并包含。 */
  async dumpDatabase(input) {
    const dump = await input.dump({
      includeAudit: true,
      includeOutbox: true,
      includeCheckpoints: true,
    });
    if (dump.ref === undefined || dump.migrationVersion === undefined) {
      throw new BackupError(BACKUP_ERROR_V1.copyFailed, "dump");
    }
    this.#stages.set(
      "dumped",
      Object.freeze({ dumpRef: dump.ref, migrationVersion: dump.migrationVersion }),
    );
    return this;
  }

  /** 复制全部耐久工件，含本批清单本身。 */
  async copyArtifacts(input) {
    const copied = await input.copyAll({
      includeBatchManifests: true,
      excludeNone: true,
    });
    if (!copied.complete) {
      throw new BackupError(BACKUP_ERROR_V1.copyFailed, copied.missing.join(","));
    }
    this.#stages.set(
      "artifacts-copied",
      Object.freeze({ rootRef: copied.rootRef, count: copied.count }),
    );
    return this;
  }

  /**
   * 耐久发布 descriptor。
   *
   * 阶段不完整或审计未落库时拒绝发布——没有耐久审计就没有可追责的恢复点声明。
   */
  async publishDescriptor(input) {
    // `descriptor-published` 由本方法自身写入，检查时必须排除，
    // 否则这里会永远在自己的前置条件上失败。
    for (const stage of BACKUP_STAGES_V1) {
      if (stage === "descriptor-published") continue;
      if (!this.#stages.has(stage)) {
        throw new BackupError(BACKUP_ERROR_V1.descriptorNotDurable, stage);
      }
    }
    const auditRefs = await input.appendAudit({
      operationId: this.#operationId,
      instanceId: this.#instanceId,
    });
    if (auditRefs.length === 0) {
      throw new BackupError(BACKUP_ERROR_V1.descriptorNotDurable, "audit");
    }
    this.#stages.set("descriptor-published", Object.freeze({ auditRefs }));
    return Object.freeze({
      backupId: input.backupId,
      operationId: this.#operationId,
      payloadDigest: this.#payloadDigest,
      stages: this.completedStages(),
      auditRefs,
    });
  }
}

/** 隔离恢复核验：必须完整消费 findings 并 await summary 才可判定通过。 */
export const verifyReconcileV1 = async (handle) => {
  let consumed = 0;
  const corrupt = [];
  for await (const finding of handle.findings) {
    consumed += 1;
    if (finding.kind !== "consistent") corrupt.push(finding.ref);
  }
  const summary = await handle.summary;
  if (summary.findingCount !== consumed) {
    throw new BackupError(BACKUP_ERROR_V1.manifestNotConsumed, "reconcile");
  }
  if (corrupt.length > 0) {
    throw new BackupError(BACKUP_ERROR_V1.copyFailed, corrupt.join(","));
  }
  return Object.freeze({ consumed, passed: summary.consistent === true });
};
