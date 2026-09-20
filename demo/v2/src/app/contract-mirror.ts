// 冻结契约与角色策略的镜像。数据在 contract-mirror.data.json，
// 由 tools/check-contract-mirror.check.mjs 与 packages/contracts、packages/core
// 的构建产物逐项比对，禁止脱离校验手工改动。
// 事实源：packages/contracts/src/ports/index.ts:448-536、
// packages/contracts/src/workflows/index.ts:220-245、
// packages/core/src/access/policy.ts:19-79。

import data from './contract-mirror.data.json';

export type ModuleCapability = (typeof data.capabilities)[number];
export type ModuleBranch = keyof typeof data.branchCapability;
export type PresetRole = keyof typeof data.roles;

export const MODULE_CAPABILITIES: readonly ModuleCapability[] = data.capabilities;
export const BRANCH_CAPABILITY: Readonly<Record<ModuleBranch, ModuleCapability>> =
  data.branchCapability;
export const ALL_BRANCHES: readonly ModuleBranch[] = Object.keys(
  data.branchCapability,
) as ModuleBranch[];

export const IDENTIFICATION_STAGES = data.identificationStages;
export const ASSESSMENT_STAGES = data.assessmentStages;

export const PRESET_ROLES = Object.keys(data.roles) as PresetRole[];
export const ROLE_LABELS: Readonly<Record<PresetRole, string>> = data.roleLabels;

const ROLE_BRANCHES = data.roles as Readonly<Record<PresetRole, readonly ModuleBranch[]>>;

/** 并集语义对齐 branchesForBranches（policy.ts:62-69）：按 allBranches 顺序去重合并。 */
export function branchesForRoles(roles: readonly PresetRole[]): readonly ModuleBranch[] {
  const selected = new Set(roles.flatMap((role) => ROLE_BRANCHES[role]));
  return ALL_BRANCHES.filter((branch) => selected.has(branch));
}

/** 对齐 capabilitiesForBranches（policy.ts:71-76）：branch 映射能力位后去重排序。 */
export function capabilitiesForBranches(
  branches: readonly ModuleBranch[],
): readonly ModuleCapability[] {
  const capabilities = new Set(branches.map((branch) => BRANCH_CAPABILITY[branch]));
  return [...capabilities].sort();
}

export function capabilitiesForRoles(
  roles: readonly PresetRole[],
): ReadonlySet<ModuleCapability> {
  return new Set(capabilitiesForBranches(branchesForRoles(roles)));
}

export const SYSTEM_ACCESS_ACTIONS = data.systemAccessActions;
export const PROJECT_MANAGER_ACCESS_ACTIONS = data.projectManagerAccessActions;

export interface VersionedRef {
  readonly kind: string;
  readonly reference: {
    readonly entityId: string;
    readonly versionId: string;
  };
}

export function versionedRef(kind: string, entityId: string, versionId: string): VersionedRef {
  return { kind, reference: { entityId, versionId } };
}
