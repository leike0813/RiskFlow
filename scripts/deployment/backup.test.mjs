import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_ERROR_V1,
  BACKUP_STAGES_V1,
  BackupError,
  LogicalBackupV1,
  verifyReconcileV1,
} from "./backup.mjs";

const projectId = "project-rail-01";
const payload = { projectIds: [projectId], configRef: "config-primary" };

const backup = () => new LogicalBackupV1({ operationId: "op-1", payload, instanceId: "app-vm-01" });

const authorized = {
  projectIds: [projectId],
  capacityRequiredBytes: 100,
  capacityAvailableBytes: 1000,
  projects: [{ projectId, authorizationRefs: ["auth-1"] }],
};

const quiesced = { unknownWriters: [], inFlightWrites: 0, stoppedServices: ["api", "worker"] };

/**
 * @param yielded findings 实际产出的条数
 * @param declared summary 声称的条数；与 yielded 不一致即模拟"清单未被完整消费"
 */
const manifestHandle = (id, yielded = 2, declared = yielded, consistent = true) => ({
  findings: (async function* () {
    for (let i = 0; i < yielded; i += 1) yield { kind: "consistent", ref: `${id}-f${i}` };
  })(),
  summary: Promise.resolve({
    projectId: id,
    findingCount: declared,
    consistent,
    ref: `${id}-summary`,
  }),
});

describe("同机逻辑副本编排", () => {
  it("按固定顺序推进并只在全部阶段耐久后发布 descriptor", async () => {
    const b = backup();
    const copyAll = vi.fn(async () => ({ complete: true, rootRef: "artifact-root", count: 9 }));
    const appendAudit = vi.fn(async () => ["audit-1"]);

    await b.assertCapacityAndAuthorization(authorized);
    await b.assertQuiesced(quiesced);
    await b.createManifests({
      projectIds: [projectId],
      createHashManifest: async () => manifestHandle(projectId),
    });
    await b.dumpDatabase({
      dump: async () => ({ ref: "dump-1", migrationVersion: "000056" }),
    });
    await b.copyArtifacts({ copyAll });
    const published = await b.publishDescriptor({ backupId: "backup-1", appendAudit });

    expect(published.stages).toEqual([...BACKUP_STAGES_V1]);
    expect(published.auditRefs).toEqual(["audit-1"]);
    // 清单阶段早于导出与复制：顺序颠倒会生成不自洽的恢复点。
    expect(b.completedStages()).toEqual([...BACKUP_STAGES_V1]);
    expect(copyAll).toHaveBeenCalledWith({ includeBatchManifests: true, excludeNone: true });
  });

  it("容量不足或授权缺失时整批失败，不产生部分成功", async () => {
    await expect(
      backup().assertCapacityAndAuthorization({
        ...authorized,
        capacityRequiredBytes: 2000,
      }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.capacityInsufficient });

    await expect(
      backup().assertCapacityAndAuthorization({
        ...authorized,
        projects: [{ projectId, authorizationRefs: [] }],
      }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.authorizationIncomplete });
  });

  it("存在未知写者或在途写入时拒绝继续", async () => {
    await expect(
      backup().assertQuiesced({ ...quiesced, unknownWriters: ["unknown-writer"] }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.writerUnknown });
    await expect(backup().assertQuiesced({ ...quiesced, inFlightWrites: 2 })).rejects.toMatchObject(
      { code: BACKUP_ERROR_V1.notQuiesced },
    );
  });

  it("清单未完整消费即失败，不先导出数据库", async () => {
    const b = backup();
    await b.assertCapacityAndAuthorization(authorized);
    await b.assertQuiesced(quiesced);
    await expect(
      b.createManifests({
        projectIds: [projectId],
        // summary 声称 3 条，实际只消费 2 条：清单未被完整消费。
        createHashManifest: async () => manifestHandle(projectId, 2, 3),
      }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.manifestNotConsumed });
    expect(b.completedStages()).not.toContain("manifests");
  });

  it("复制不完整时失败，未复制完不发布", async () => {
    const b = backup();
    await b.assertCapacityAndAuthorization(authorized);
    await b.assertQuiesced(quiesced);
    await expect(
      b.copyArtifacts({
        copyAll: async () => ({
          complete: false,
          missing: ["artifact-9"],
          rootRef: "root",
          count: 8,
        }),
      }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.copyFailed });
    await expect(
      b.publishDescriptor({ backupId: "b", appendAudit: async () => ["a"] }),
    ).rejects.toThrow(BackupError);
  });

  it("阶段不全或无耐久审计时拒绝发布 descriptor", async () => {
    const b = backup();
    await b.assertCapacityAndAuthorization(authorized);
    await expect(
      b.publishDescriptor({ backupId: "b", appendAudit: async () => ["a"] }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.descriptorNotDurable });

    const full = backup();
    await full.assertCapacityAndAuthorization(authorized);
    await full.assertQuiesced(quiesced);
    await full.createManifests({
      projectIds: [projectId],
      createHashManifest: async () => manifestHandle(projectId),
    });
    await full.dumpDatabase({ dump: async () => ({ ref: "d", migrationVersion: "000056" }) });
    await full.copyArtifacts({ copyAll: async () => ({ complete: true, rootRef: "r", count: 1 }) });
    await expect(
      full.publishDescriptor({ backupId: "b", appendAudit: async () => [] }),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.descriptorNotDurable });
  });

  it("同一身份同载荷复用阶段；异载荷在任何新副作用前失败", async () => {
    const b = backup();
    await b.assertCapacityAndAuthorization(authorized);
    await expect(b.resumeWith({ payload })).resolves.toBe(b);
    await expect(b.resumeWith({ payload: { projectIds: ["other"] } })).rejects.toMatchObject({
      code: BACKUP_ERROR_V1.idempotencyConflict,
    });
    expect(b.completedStages()).toEqual(["authorized"]);
  });
});

describe("隔离恢复核验", () => {
  const reconcileHandle = (entries, summary) => ({
    findings: (async function* () {
      for (const entry of entries) yield entry;
    })(),
    summary: Promise.resolve(summary),
  });

  it("完整消费 findings 并 await summary 后才判定通过", async () => {
    const ok = await verifyReconcileV1(
      reconcileHandle(
        [
          { kind: "consistent", ref: "f0" },
          { kind: "consistent", ref: "f1" },
        ],
        { findingCount: 2, consistent: true },
      ),
    );
    expect(ok).toEqual({ consumed: 2, passed: true });
  });

  it("缺失、损坏或未消费完都阻止通过", async () => {
    await expect(
      verifyReconcileV1(
        reconcileHandle([{ kind: "missing", ref: "f0" }], { findingCount: 1, consistent: true }),
      ),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.copyFailed });

    await expect(
      verifyReconcileV1(
        reconcileHandle([{ kind: "consistent", ref: "f0" }], { findingCount: 3, consistent: true }),
      ),
    ).rejects.toMatchObject({ code: BACKUP_ERROR_V1.manifestNotConsumed });
  });
});
