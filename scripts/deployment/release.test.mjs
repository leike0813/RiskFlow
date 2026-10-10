import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  FROZEN_CONTAINER_IMAGES_V1,
  RELEASE_ERROR_V1,
  ReleaseVerificationError,
  SYSTEMD_SERVICES_V1,
  importReleaseV1,
  resolveMediaPathV1,
  verifyReleaseV1,
  verifySystemdUnitsV1,
} from "./release.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DEPLOYMENT_DIR = join(REPO_ROOT, "deployment");

const roots = [];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** 建一份最小介质：含一个制品与三台 VM 的全部 systemd 单元。 */
const makeReleaseRoot = (overrides = {}) => {
  const root = mkdtempSync(join(tmpdir(), "riskflow-release-"));
  roots.push(root);
  const payload = Buffer.from("riskflow-server-bundle");
  mkdirSync(join(root, "artifacts"), { recursive: true });
  writeFileSync(join(root, "artifacts", "api.tgz"), payload);

  const manifest = {
    artifacts: overrides.artifacts ?? [
      {
        artifactId: "api-bundle",
        kind: "server-bundle",
        version: "2030.01",
        os: "linux-x64",
        arch: "x64",
        sha256: sha256(payload),
        byteLength: payload.byteLength,
        relativePath: "artifacts/api.tgz",
        officialSource: "internal://riskflow/build/2030.01",
        licenseRef: "license-riskflow",
        sbomRef: "sbom-riskflow",
      },
    ],
  };

  for (const units of Object.values(SYSTEMD_SERVICES_V1)) {
    mkdirSync(join(root, "systemd"), { recursive: true });
    for (const unit of units) {
      writeFileSync(join(root, "systemd", `${unit}.service`), `[Service]\nExecStart=/bin/true\n`);
    }
  }
  return { root, manifest };
};

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("离线发布核验", () => {
  it("核验通过后返回制品身份", () => {
    const { root, manifest } = makeReleaseRoot();
    expect(verifyReleaseV1(root, manifest)).toEqual(["api-bundle"]);
  });

  it("制品缺失、长度或摘要不符一律失败", () => {
    const missing = makeReleaseRoot();
    rmSync(join(missing.root, "artifacts", "api.tgz"));
    expect(() => verifyReleaseV1(missing.root, missing.manifest)).toThrow(
      expect.objectContaining({ code: RELEASE_ERROR_V1.artifactMissing }),
    );

    const tampered = makeReleaseRoot();
    writeFileSync(join(tampered.root, "artifacts", "api.tgz"), "other-bytes");
    expect(() => verifyReleaseV1(tampered.root, tampered.manifest)).toThrow(
      expect.objectContaining({ code: RELEASE_ERROR_V1.digestMismatch }),
    );
  });

  it("缺许可或 SBOM 引用视为发布不完整", () => {
    const noLicense = makeReleaseRoot({
      artifacts: [
        {
          artifactId: "api-bundle",
          kind: "server-bundle",
          version: "2030.01",
          os: "linux-x64",
          arch: "x64",
          sha256: sha256("riskflow-server-bundle"),
          byteLength: Buffer.byteLength("riskflow-server-bundle"),
          relativePath: "artifacts/api.tgz",
          officialSource: "internal://riskflow/build/2030.01",
          sbomRef: "sbom-riskflow",
        },
      ],
    });
    expect(() => verifyReleaseV1(noLicense.root, noLicense.manifest)).toThrow(
      expect.objectContaining({ code: RELEASE_ERROR_V1.licenseMissing }),
    );
  });

  it("容器镜像必须固定 digest", () => {
    const image = makeReleaseRoot({
      artifacts: [
        {
          artifactId: "postgres-image",
          kind: "container-image",
          version: "18.6-bookworm",
          os: "linux-x64",
          arch: "x64",
          sha256: sha256("image-bytes"),
          byteLength: Buffer.byteLength("image-bytes"),
          relativePath: "artifacts/api.tgz",
          officialSource: "https://registry.internal/postgres",
          licenseRef: "license-postgres",
          sbomRef: "sbom-postgres",
        },
      ],
    });
    expect(() => verifyReleaseV1(image.root, image.manifest)).toThrow(
      expect.objectContaining({ code: RELEASE_ERROR_V1.digestMismatch }),
    );
  });

  it("介质路径不得越界或经反斜杠逃逸", () => {
    const root = mkdtempSync(join(tmpdir(), "riskflow-release-"));
    roots.push(root);
    expect(() => resolveMediaPathV1(root, "../etc/passwd")).toThrow(ReleaseVerificationError);
    expect(() => resolveMediaPathV1(root, "/etc/passwd")).toThrow(ReleaseVerificationError);
    expect(() => resolveMediaPathV1(root, "artifacts\\..\\..\\secret")).toThrow(
      ReleaseVerificationError,
    );
  });

  it("三台 VM 的 systemd 单元缺一即安装不完整", () => {
    const { root } = makeReleaseRoot();
    rmSync(join(root, "systemd", "riskflow-model.service"));
    expect(() => verifySystemdUnitsV1(root)).toThrow(
      expect.objectContaining({ code: RELEASE_ERROR_V1.systemdUnitMissing }),
    );
  });

  it("导入前先核验；核验失败不落地任何文件", () => {
    const ok = makeReleaseRoot();
    expect(importReleaseV1(ok.root, ok.manifest)).toEqual({ imported: true, root: ok.root });

    const broken = makeReleaseRoot();
    rmSync(join(broken.root, "artifacts", "api.tgz"));
    expect(() => importReleaseV1(broken.root, broken.manifest)).toThrow(ReleaseVerificationError);
  });
});

describe("三 VM 服务布局", () => {
  it("服务按 VM 角色固定，容器镜像按 digest 固定", () => {
    expect(Object.keys(SYSTEMD_SERVICES_V1).sort()).toEqual(["app-vm", "data-vm", "inference-vm"]);
    expect(SYSTEMD_SERVICES_V1["app-vm"]).toContain("riskflow-caddy");
    expect(SYSTEMD_SERVICES_V1["data-vm"]).toEqual([
      "riskflow-postgres",
      "riskflow-qdrant",
      "riskflow-artifacts",
    ]);
    for (const reference of Object.values(FROZEN_CONTAINER_IMAGES_V1)) {
      expect(reference).toMatch(/@sha256:[a-f0-9]{64}$/);
    }
  });

  it("仓库内的 systemd 单元与冻结清单一致", () => {
    expect(verifySystemdUnitsV1(DEPLOYMENT_DIR)).toBe(true);
  });
});

describe("HTTPS 入口配置", () => {
  const caddyfile = readFileSync(join(DEPLOYMENT_DIR, "Caddyfile"), "utf8");

  it("关闭自动签发并显式使用预置证书", () => {
    expect(caddyfile).toContain("auto_https off");
    expect(caddyfile).not.toContain("tls internal");
    expect(caddyfile).toMatch(/tls \/etc\/riskflow\/tls\/fullchain\.pem/);
  });

  it("API 与 SSE 同源且不缓冲，API 不回落 SPA", () => {
    expect(caddyfile).toMatch(/@api path \/api\/\*/);
    expect(caddyfile).toContain("flush_interval -1");
    // /api/* 由 handle @api 独占，其后才是 SPA fallback。
    expect(caddyfile.indexOf("handle @api")).toBeLessThan(caddyfile.indexOf("try_files"));
  });

  it("深链刷新走 SPA fallback，且禁用内联脚本", () => {
    expect(caddyfile).toContain("try_files {path} /index.html");
    expect(caddyfile).toContain("script-src 'self'");
    expect(caddyfile).not.toContain("unsafe-eval");
  });
});
describe("部署配置与发布清单示例", () => {
  const readJson = (name) => JSON.parse(readFileSync(join(DEPLOYMENT_DIR, name), "utf8"));

  it("发布清单覆盖服务端、模型/OCR、镜像与 HTTPS 代理，且镜像固定 digest", () => {
    const manifest = readJson("release-manifest.example.json");
    const kinds = new Set(manifest.artifacts.map((a) => a.kind));
    for (const required of [
      "server-bundle",
      "web-bundle",
      "container-image",
      "model-weights",
      "embedding-weights",
      "ocr-build",
      "https-proxy",
    ]) {
      expect(kinds.has(required), `缺少 ${required}`).toBe(true);
    }
    for (const image of manifest.artifacts.filter((a) => a.kind === "container-image")) {
      expect(image.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    // 桌面与服务端发布分别记录兼容性。
    expect(manifest.desktopCompatibility.supportedElectronVersions).toEqual(["44.7.0"]);
    expect(manifest.desktopCompatibility.supportedChromiumVersions).toEqual(["152.0.7977.130"]);
    expect(manifest.desktopCompatibility.supportedBundledNodeVersions).toEqual(["24.21.0"]);
    for (const artifact of manifest.artifacts) {
      expect(artifact.licenseRef).toBeTruthy();
      expect(artifact.sbomRef).toBeTruthy();
      expect(artifact.relativePath.startsWith("/")).toBe(false);
    }
  });

  it("部署配置示例通过 D-19 strict Schema", async () => {
    const { DeploymentConfigV1Schema } =
      await import("../../packages/adapters/dist/deployment/index.js");
    const parsed = DeploymentConfigV1Schema.safeParse(readJson("config.example.json"));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("部署配置示例的工程绑定与预算齐备，秘密只以 secretId 引用", () => {
    const config = readJson("config.example.json");
    expect(config.hosts.map((h) => h.role).sort()).toEqual(["application", "data", "inference"]);
    expect(config.publicOrigin).toMatch(/^https:\/\//);
    expect(config.projectBindings.length).toBeGreaterThan(0);
    expect(config.worker.drainTimeoutMs).toBeGreaterThan(0);
    expect(config.transport.totalTimeoutMs).toBeGreaterThanOrEqual(config.transport.idleTimeoutMs);
    // 秘密值不得出现在配置里，只允许逻辑 secretId 与文件路径。
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("PASSWORD_VALUE");
    for (const ref of config.database.secretFileRefs) {
      expect(typeof ref.secretId).toBe("string");
      expect(ref.filePath.startsWith("/")).toBe(true);
    }
  });
});
