import { lstatSync, readFileSync, realpathSync } from "node:fs";

import { z } from "zod";

import type { DeploymentSecretFileRefV1 } from "./schema.js";

/**
 * C37 D-19：秘密只经各 VM 私有文件按运行主体最小权限加载。
 * 本模块不解释秘密内容，只核验路径所有权、权限位与无链接；
 * 秘密值不进入发布清单、日志、argv 或运维回执。
 */

export const DEPLOYMENT_SECRET_ERROR_V1 = {
  missing: "SECRET_FILE_MISSING",
  notAbsolute: "SECRET_PATH_NOT_ABSOLUTE",
  symlink: "SECRET_PATH_SYMLINK",
  unreadable: "SECRET_FILE_UNREADABLE",
  tooPermissive: "SECRET_FILE_TOO_PERMISSIVE",
  ownerMismatch: "SECRET_FILE_OWNER_MISMATCH",
  notRegular: "SECRET_FILE_NOT_REGULAR",
} as const;
export type DeploymentSecretErrorCodeV1 =
  (typeof DEPLOYMENT_SECRET_ERROR_V1)[keyof typeof DEPLOYMENT_SECRET_ERROR_V1];

export interface DeploymentSecretErrorV1 {
  readonly code: DeploymentSecretErrorCodeV1;
  /** 仅 secretId 与逻辑位置；绝不返回宿主绝对路径或秘密内容。 */
  readonly secretId: string;
}

export interface DeploymentSecretFileLoaderV1Options {
  /** 期望的文件属主 uid；缺省跳过属主校验（Windows 目标无此语义）。 */
  readonly expectedUid?: number;
  /** 允许的最大权限位，缺省 0o600（仅属主可读写）。 */
  readonly maxMode?: number;
  readonly readFile?: (filePath: string) => string;
}

export type DeploymentSecretFileLoaderV1 = (
  refs: readonly DeploymentSecretFileRefV1[],
) => Readonly<Record<string, string>>;

const fail = (code: DeploymentSecretErrorCodeV1, secretId: string): DeploymentSecretErrorV1 => ({
  code,
  secretId,
});

export const createDeploymentSecretFileLoaderV1 = (
  options: DeploymentSecretFileLoaderV1Options = {},
): DeploymentSecretFileLoaderV1 => {
  const maxMode = options.maxMode ?? 0o600;
  const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
  return (refs) => {
    const values: Record<string, string> = {};
    const errors: DeploymentSecretErrorV1[] = [];
    for (const ref of refs) {
      if (!ref.filePath.startsWith("/")) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.notAbsolute, ref.secretId));
        continue;
      }
      let stats;
      try {
        stats = lstatSync(ref.filePath);
      } catch {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.missing, ref.secretId));
        continue;
      }
      if (stats.isSymbolicLink()) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.symlink, ref.secretId));
        continue;
      }
      if (!stats.isFile()) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.notRegular, ref.secretId));
        continue;
      }
      // 真实路径与声明一致，确保中间目录没有被替换成链接。
      if (realpathSync(ref.filePath) !== ref.filePath) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.symlink, ref.secretId));
        continue;
      }
      const mode = stats.mode & 0o777;
      if ((mode & ~maxMode) !== 0) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.tooPermissive, ref.secretId));
        continue;
      }
      if (options.expectedUid !== undefined && stats.uid !== options.expectedUid) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.ownerMismatch, ref.secretId));
        continue;
      }
      let content: string;
      try {
        content = readFile(ref.filePath);
      } catch {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.unreadable, ref.secretId));
        continue;
      }
      if (content.trim().length === 0) {
        errors.push(fail(DEPLOYMENT_SECRET_ERROR_V1.unreadable, ref.secretId));
        continue;
      }
      values[ref.secretId] = content;
    }
    if (errors.length > 0) {
      throw new z.ZodError(
        errors.map((error) => ({
          code: "custom",
          path: [error.secretId],
          message: error.code,
        })),
      );
    }
    return Object.freeze(values);
  };
};
