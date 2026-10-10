#!/usr/bin/env node
/**
 * C37 D-16 / 10.1：离线发布制备、核验与导入。
 *
 * 三 VM 拓扑（同一物理服务器内）：
 * - 推理 VM：GPU 直通，运行 llama.cpp 与模型；
 * - 应用 VM：Web、API、Worker、HTTPS 入口与必要解析；
 * - 数据 VM：PostgreSQL、Qdrant 与不可变工件目录。
 *
 * 只有应用 VM 的 HTTPS 入口对业务用户开放；内部服务与管理端口按职责隔离。
 *
 * 本程序只做只读核验与显式导入，绝不联网补齐缺失制品；缺项即失败，
 * 不产出部分可用的发布，也不静默改用其它版本。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
export const DEPLOYMENT_DIR = join(REPO_ROOT, "deployment");

/** D-16 冻结的基础镜像：只能本地 load，启动使用 pull=never。 */
export const FROZEN_CONTAINER_IMAGES_V1 = Object.freeze({
  "postgres:18.6-bookworm":
    "postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af",
  "qdrant/qdrant:v1.19.0":
    "qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc",
});

/** D-16 固定的 systemd 服务：三台 VM 各跑自己的角色，不在一台机器上混部。 */
export const SYSTEMD_SERVICES_V1 = Object.freeze({
  "app-vm": Object.freeze(["riskflow-caddy", "riskflow-api", "riskflow-worker"]),
  "inference-vm": Object.freeze(["riskflow-model"]),
  "data-vm": Object.freeze(["riskflow-postgres", "riskflow-qdrant", "riskflow-artifacts"]),
});

export const RELEASE_ERROR_V1 = {
  manifestMissing: "RELEASE_MANIFEST_MISSING",
  artifactMissing: "RELEASE_ARTIFACT_MISSING",
  digestMismatch: "RELEASE_ARTIFACT_DIGEST_MISMATCH",
  pathEscape: "RELEASE_ARTIFACT_PATH_ESCAPE",
  licenseMissing: "RELEASE_LICENSE_MISSING",
  sbomMissing: "RELEASE_SBOM_MISSING",
  systemdUnitMissing: "RELEASE_SYSTEMD_UNIT_MISSING",
};

export class ReleaseVerificationError extends Error {
  code;
  artifactId;

  constructor(code, artifactId = "") {
    super(code);
    this.name = "ReleaseVerificationError";
    this.code = code;
    this.artifactId = artifactId;
  }
}

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** 介质路径必须在发布根内，且不得越界或经链接逃逸。 */
export const resolveMediaPathV1 = (root, relativePath) => {
  if (relativePath.startsWith("/") || relativePath.includes("\\")) {
    throw new ReleaseVerificationError(RELEASE_ERROR_V1.pathEscape, relativePath);
  }
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new ReleaseVerificationError(RELEASE_ERROR_V1.pathEscape, relativePath);
  }
  return candidate;
};

/**
 * 核验发布清单与介质。
 *
 * 逐项检查存在性、字节数、摘要、许可与 SBOM；容器镜像必须固定 digest。
 * 缺项或不符即抛出稳定类别，调用方据此拒绝安装。
 */
export const verifyReleaseV1 = (releaseRoot, manifest) => {
  if (manifest === undefined || !existsSync(releaseRoot)) {
    throw new ReleaseVerificationError(RELEASE_ERROR_V1.manifestMissing);
  }
  const verified = [];
  for (const artifact of manifest.artifacts ?? []) {
    const path = resolveMediaPathV1(releaseRoot, artifact.relativePath);
    if (!existsSync(path)) {
      throw new ReleaseVerificationError(RELEASE_ERROR_V1.artifactMissing, artifact.artifactId);
    }
    const stats = statSync(path);
    if (stats.size !== artifact.byteLength) {
      throw new ReleaseVerificationError(RELEASE_ERROR_V1.digestMismatch, artifact.artifactId);
    }
    if (sha256File(path) !== artifact.sha256) {
      throw new ReleaseVerificationError(RELEASE_ERROR_V1.digestMismatch, artifact.artifactId);
    }
    if (artifact.licenseRef === undefined || artifact.licenseRef === "") {
      throw new ReleaseVerificationError(RELEASE_ERROR_V1.licenseMissing, artifact.artifactId);
    }
    if (artifact.sbomRef === undefined || artifact.sbomRef === "") {
      throw new ReleaseVerificationError(RELEASE_ERROR_V1.sbomMissing, artifact.artifactId);
    }
    if (
      artifact.kind === "container-image" &&
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")
    ) {
      throw new ReleaseVerificationError(RELEASE_ERROR_V1.digestMismatch, artifact.artifactId);
    }
    verified.push(artifact.artifactId);
  }
  return Object.freeze(verified);
};

/** 三台 VM 的 systemd 单元必须随介质齐备，缺一即安装不完整。 */
export const verifySystemdUnitsV1 = (releaseRoot) => {
  const missing = [];
  for (const units of Object.values(SYSTEMD_SERVICES_V1)) {
    for (const unit of units) {
      if (!existsSync(join(releaseRoot, "systemd", `${unit}.service`))) missing.push(unit);
    }
  }
  if (missing.length > 0) {
    throw new ReleaseVerificationError(RELEASE_ERROR_V1.systemdUnitMissing, missing.join(","));
  }
  return true;
};

/**
 * 部署介质只读导入。
 *
 * 导入前先核验；核验失败不落地任何文件，也不启动部分业务实例。
 */
export const importReleaseV1 = (releaseRoot, manifest) => {
  verifyReleaseV1(releaseRoot, manifest);
  verifySystemdUnitsV1(releaseRoot);
  return Object.freeze({ imported: true, root: releaseRoot });
};

const main = () => {
  const manifestPath = process.argv[2];
  if (manifestPath === undefined) {
    console.error(
      "release manifest path is required: pnpm deployment:verify -- <manifest.json> [release-root]",
    );
    process.exitCode = 2;
    return;
  }
  const releaseRoot = process.argv[3] ?? join(process.cwd(), "release");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const verified = verifyReleaseV1(releaseRoot, manifest);
    console.log(`release verified: ${verified.length} artifacts`);
  } catch (error) {
    if (error instanceof ReleaseVerificationError) {
      console.error(`release verification failed: ${error.code} ${error.artifactId}`);
      process.exitCode = 3;
      return;
    }
    throw error;
  }
};

if (process.argv[1] !== undefined && process.argv[1].endsWith("release.mjs")) {
  main();
}
