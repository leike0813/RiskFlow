import {
  MODULE_BRANCH_CAPABILITY_V1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";

import { ModuleBranchV1Schema, PresetRoleV1Schema, type PresetRoleV1 } from "./schema.js";

export const ACCESS_POLICY_VERSION = "access-policy/v1" as const;
export const ACCESS_POLICY_REF_V1 = Object.freeze({
  entityId: "access-policy",
  versionId: "v1",
});

const allBranches = Object.freeze(Object.keys(MODULE_BRANCH_CAPABILITY_V1) as ModuleBranchV1[]);
const branchSet = (...branches: ModuleBranchV1[]): readonly ModuleBranchV1[] =>
  Object.freeze(branches);

const roleBranches: Readonly<Record<PresetRoleV1, readonly ModuleBranchV1[]>> = Object.freeze({
  "system-administrator": branchSet(),
  "project-risk-manager": allBranches,
  reviewer: branchSet(
    "review-audit.decide-review",
    "review-audit.trace",
    "projection.query",
    "projection.subscribe",
    "projection.result-read",
    "engineering-data.evidence-access",
    "engineering-data.context-read",
    "engineering-data.source-catalog",
    "engineering-data.monitoring-catalog",
    "engineering-data.read-result",
    "knowledge-modeling.governance-read",
    "knowledge-modeling.retrieval-result",
    "risk-identification.run-list",
    "risk-identification.run-read",
    "risk-identification.record-catalog",
    "risk-identification.record-read",
    "review-audit.queue-read",
    "risk-assessment.read",
    "warning-response.read",
    // C35：复核人加入统一复核/活动窄读（design D-02），沿原 review-audit.read 能力
    // 读取获准主题；不因此获得 Agent 读面或任何写权。
    "review-audit.read",
  ),
  "field-responder": branchSet(
    "warning-response.record-execution",
    "warning-response.record-feedback",
    "projection.query",
    "projection.subscribe",
    // C34：补齐已公开矩阵/措施与投影的读取面，使处置角色能读风险解释与终局结果；
    // 不授予经理的启动/采纳/确认/校准治理写权（design D-06）。
    "projection.result-read",
    "knowledge-modeling.governance-read",
    "engineering-data.evidence-access",
    "engineering-data.context-read",
    "engineering-data.monitoring-catalog",
    "engineering-data.read-result",
    "risk-identification.run-list",
    "risk-identification.run-read",
    "risk-identification.record-catalog",
    "risk-identification.record-read",
    "risk-assessment.read",
    "warning-response.read",
  ),
  "business-viewer": branchSet(
    "projection.query",
    "projection.subscribe",
    "projection.export",
    "projection.result-read",
    "engineering-data.evidence-access",
    "engineering-data.context-read",
    "engineering-data.source-catalog",
    "engineering-data.monitoring-catalog",
    "engineering-data.read-result",
    "knowledge-modeling.governance-read",
    "risk-identification.run-list",
    "risk-identification.run-read",
    "risk-identification.record-catalog",
    "risk-identification.record-read",
    "review-audit.queue-read",
    "knowledge-modeling.retrieval-result",
    "risk-assessment.read",
    "warning-response.read",
    // C35：业务观察者加入统一复核/活动窄读与报告窄读（design D-02），
    // 分别沿原 review-audit.read 与 projection.export 能力；不新增任何写权。
    "review-audit.read",
    "projection.report-read",
  ),
});

export const PRESET_ROLE_BRANCHES_V1 = roleBranches;

export const SYSTEM_ACCESS_ACTIONS_V1 = Object.freeze([
  "create-account",
  "disable-account",
  "reset-password",
  "open-project",
  "suspend-project",
  "revise-membership",
] as const);

export const PROJECT_MANAGER_ACCESS_ACTIONS_V1 = Object.freeze([
  "revise-membership",
  "create-spatial-scope",
  "revise-spatial-scope",
  "revise-source-access",
] as const);

export const branchCapability = (branch: ModuleBranchV1): ModuleCapabilityV1 => {
  ModuleBranchV1Schema.parse(branch);
  return MODULE_BRANCH_CAPABILITY_V1[branch];
};

export const branchesForRoles = (roles: readonly PresetRoleV1[]): readonly ModuleBranchV1[] => {
  const result = new Set<ModuleBranchV1>();
  for (const role of roles) {
    PresetRoleV1Schema.parse(role);
    for (const branch of roleBranches[role]) result.add(branch);
  }
  return Object.freeze(allBranches.filter((branch) => result.has(branch)));
};

export const capabilitiesForBranches = (
  branches: readonly ModuleBranchV1[],
): readonly ModuleCapabilityV1[] =>
  Object.freeze(Array.from(new Set(branches.map((branch) => branchCapability(branch)))).sort());

export const isBranchAllowed = (roles: readonly PresetRoleV1[], branch: ModuleBranchV1): boolean =>
  branchesForRoles(roles).includes(branch);

export const isSystemAccessAction = (action: string): boolean =>
  (SYSTEM_ACCESS_ACTIONS_V1 as readonly string[]).includes(action);
