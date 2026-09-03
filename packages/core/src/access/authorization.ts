import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type SpatialScopeRefV1,
  type SourceAccessGrantRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";

import { isBranchAllowed } from "./policy.js";
import type { PresetRoleV1, SourceVisibilityV1 } from "./schema.js";

export interface SpatialScopeNodeV1 {
  readonly projectId: string;
  readonly scopeId: string;
  readonly revisionId: string;
  readonly parentScopeId?: string;
  readonly status: "active" | "inactive";
}

export interface SourceAccessPolicyV1 {
  readonly projectId: string;
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly revisionRef: SourceAccessGrantRefV1;
  readonly visibility: SourceVisibilityV1;
  readonly allowedAccountIds: readonly string[];
  readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
}

export interface SourceAccessEvaluationV1 {
  readonly allowed: boolean;
  readonly bodyAllowed: boolean;
  readonly redacted: boolean;
  readonly grantRefs: readonly SourceAccessGrantRefV1[];
  readonly requiredScopeRefs: readonly SpatialScopeRefV1[];
}

const scopeKey = (scope: Pick<SpatialScopeRefV1, "reference">): string =>
  `${scope.reference.entityId}\u0000${scope.reference.versionId}`;

const nodeKey = (node: Pick<SpatialScopeNodeV1, "scopeId" | "revisionId">): string =>
  `${node.scopeId}\u0000${node.revisionId}`;

const asScopeRef = (node: SpatialScopeNodeV1): SpatialScopeRefV1 => ({
  kind: "spatial-scope",
  reference: { entityId: node.scopeId, versionId: node.revisionId },
});

const scopeIndex = (nodes: readonly SpatialScopeNodeV1[]): Map<string, SpatialScopeNodeV1> => {
  const index = new Map<string, SpatialScopeNodeV1>();
  for (const node of nodes) {
    const key = nodeKey(node);
    if (index.has(key)) throw new Error("duplicate spatial scope revision");
    index.set(key, node);
  }
  return index;
};

// ponytail: the scope set is bounded at 128 refs; use a parent index before adding a larger-tree cache.
const activeParentIndex = (
  nodes: readonly SpatialScopeNodeV1[],
): Map<string, SpatialScopeNodeV1> => {
  const index = new Map<string, SpatialScopeNodeV1>();
  for (const node of nodes) {
    if (node.status === "active") index.set(`${node.projectId}\u0000${node.scopeId}`, node);
  }
  return index;
};

/** Validates the active scope graph without consulting a store. */
export const assertSpatialScopeTree = (
  nodes: readonly SpatialScopeNodeV1[],
  projectId?: string,
): void => {
  const parents = activeParentIndex(nodes);
  const activeScopeIds = new Set<string>();
  for (const node of nodes) {
    if (projectId !== undefined && node.projectId !== projectId) {
      throw new Error("spatial scope belongs to another project");
    }
    if (node.status === "active") {
      const identity = `${node.projectId}\u0000${node.scopeId}`;
      if (activeScopeIds.has(identity)) throw new Error("duplicate active spatial scope");
      activeScopeIds.add(identity);
    }
    if (node.parentScopeId === node.scopeId) throw new Error("spatial scope cycle");
    if (node.parentScopeId === undefined) continue;
    const parent = parents.get(`${node.projectId}\u0000${node.parentScopeId}`);
    if (parent === undefined || parent.projectId !== node.projectId) {
      throw new Error("spatial scope parent is invalid");
    }
  }

  for (const node of nodes) {
    const visited = new Set<string>();
    let current: SpatialScopeNodeV1 | undefined = node;
    while (current?.parentScopeId !== undefined) {
      const currentKey = nodeKey(current);
      if (visited.has(currentKey)) throw new Error("spatial scope cycle");
      visited.add(currentKey);
      current = parents.get(`${node.projectId}\u0000${current?.parentScopeId ?? ""}`);
      if (current === undefined) throw new Error("spatial scope parent is invalid");
    }
  }
};

/** A granted parent scope covers itself and all active descendants, never siblings or parents. */
export const isSpatialScopeCovered = (
  granted: SpatialScopeRefV1,
  target: SpatialScopeRefV1,
  nodes: readonly SpatialScopeNodeV1[],
): boolean => {
  if (granted.kind !== "spatial-scope" || target.kind !== "spatial-scope") return false;
  const index = scopeIndex(nodes);
  const parents = activeParentIndex(nodes);
  const grantedNode = index.get(scopeKey(granted));
  let current = index.get(scopeKey(target));
  if (grantedNode === undefined || current === undefined) return false;
  if (
    grantedNode.projectId !== current.projectId ||
    grantedNode.status !== "active" ||
    current.status !== "active"
  )
    return false;
  const visited = new Set<string>();
  while (current !== undefined) {
    const currentKey = nodeKey(current);
    if (visited.has(currentKey)) return false;
    visited.add(currentKey);
    if (currentKey === nodeKey(grantedNode)) return true;
    if (current.parentScopeId === undefined) return false;
    current = parents.get(`${grantedNode.projectId}\u0000${current?.parentScopeId ?? ""}`);
  }
  return false;
};

export const allSpatialScopesCovered = (
  granted: readonly SpatialScopeRefV1[],
  targets: readonly SpatialScopeRefV1[],
  nodes: readonly SpatialScopeNodeV1[],
): boolean =>
  targets.every((target) => granted.some((item) => isSpatialScopeCovered(item, target, nodes)));

export const spatialScopeClosure = (
  granted: readonly SpatialScopeRefV1[],
  nodes: readonly SpatialScopeNodeV1[],
): readonly SpatialScopeRefV1[] => {
  assertSpatialScopeTree(nodes);
  return Object.freeze(
    nodes
      .filter(
        (node) =>
          node.status === "active" &&
          granted.some((scope) => isSpatialScopeCovered(scope, asScopeRef(node), nodes)),
      )
      .map(asScopeRef),
  );
};

export interface EvaluateSourceAccessInputV1 {
  readonly accountId: string;
  readonly projectId: string;
  readonly roles: readonly PresetRoleV1[];
  readonly branch: ModuleBranchV1;
  readonly membershipActive: boolean;
  readonly grantedScopeRefs: readonly SpatialScopeRefV1[];
  readonly policy: SourceAccessPolicyV1;
  readonly scopeNodes: readonly SpatialScopeNodeV1[];
  readonly requireBody: boolean;
}

export const evaluateSourceAccess = (
  input: EvaluateSourceAccessInputV1,
): SourceAccessEvaluationV1 => {
  const requiredScopeRefs = input.policy.spatialScopeRefs;
  const branchAllowed = isBranchAllowed(input.roles, input.branch);
  const scopeAllowed = allSpatialScopesCovered(
    input.grantedScopeRefs,
    requiredScopeRefs,
    input.scopeNodes,
  );
  const accountAllowed =
    input.policy.visibility === "project-shared" ||
    input.policy.allowedAccountIds.includes(input.accountId);
  const common =
    input.membershipActive &&
    input.projectId === input.policy.projectId &&
    branchAllowed &&
    scopeAllowed;
  const bodyAllowed = common && accountAllowed;
  return {
    allowed: input.requireBody ? bodyAllowed : common,
    bodyAllowed,
    redacted: common && !bodyAllowed,
    grantRefs: bodyAllowed ? [input.policy.revisionRef] : [],
    requiredScopeRefs,
  };
};

const sameRef = (
  left: { reference: { entityId: string; versionId: string } },
  right: typeof left,
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

export interface AuthorizationSubsetOptionsV1 {
  readonly scopeNodes?: readonly SpatialScopeNodeV1[];
}

/** Checks the only legal direction for a child context: same project and no wider grants. */
export const isAuthorizationSubset = (
  parent: AuthorizationContextV1,
  child: AuthorizationContextV1,
  options: AuthorizationSubsetOptionsV1 = {},
): boolean => {
  if (parent.projectId !== child.projectId || parent.actorId !== child.actorId) return false;
  if (
    parent.authorizationPolicyRef.entityId !== child.authorizationPolicyRef.entityId ||
    parent.authorizationPolicyRef.versionId !== child.authorizationPolicyRef.versionId
  )
    return false;
  if (
    !child.grantedCapabilities.every((capability) =>
      parent.grantedCapabilities.includes(capability),
    )
  )
    return false;
  if (options.scopeNodes === undefined) {
    if (
      !child.spatialScopeRefs.every((scope) =>
        parent.spatialScopeRefs.some((item) => sameRef(item, scope)),
      )
    )
      return false;
  } else if (
    !allSpatialScopesCovered(parent.spatialScopeRefs, child.spatialScopeRefs, options.scopeNodes)
  ) {
    return false;
  }
  return child.sourceAccessGrantRefs.every((grant) =>
    parent.sourceAccessGrantRefs.some((item) => sameRef(item, grant)),
  );
};

export const validateAuthorizationContext = (
  context: AuthorizationContextV1,
): AuthorizationContextV1 => AuthorizationContextV1Schema.parse(context);

export interface ProjectionAccessV1 {
  readonly allowed: boolean;
  readonly redacted: boolean;
  readonly sourceAccessGrantRefs: readonly SourceAccessGrantRefV1[];
}

export const projectionAccess = (
  sourceAccess: readonly SourceAccessEvaluationV1[],
): ProjectionAccessV1 => {
  if (sourceAccess.length === 0 || sourceAccess.some((item) => !item.allowed && !item.redacted)) {
    return { allowed: false, redacted: false, sourceAccessGrantRefs: [] };
  }
  const bodyGranted = sourceAccess.every((item) => item.bodyAllowed);
  return {
    allowed: true,
    redacted: !bodyGranted,
    sourceAccessGrantRefs: bodyGranted ? sourceAccess.flatMap((item) => item.grantRefs) : [],
  };
};
