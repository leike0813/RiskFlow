import type { Kysely } from "kysely";
import type {
  AuthorizationContextV1,
  AuthorizationContextRefV1,
  ModuleBranchV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import { ModuleBranchV1Schema } from "@riskflow/contracts/ports";
import {
  branchCapability,
  type AuthorizationDecisionV1,
  type BusinessActionAuthorizationInputV1,
} from "@riskflow/core/access";
import type { PostgresLocalIdentityAccess } from "./postgres-local-identity-access.js";
import type { DeploymentDownstreamAuthorizationPolicyV1 } from "../deployment/policies.js";

export const DEPLOYMENT_AUTHORIZATION_ERROR_V1 = {
  rootNotGranted: "DEPLOYMENT_AUTHORIZATION_ROOT_NOT_GRANTED",
  downstreamRejected: "DEPLOYMENT_AUTHORIZATION_DOWNSTREAM_REJECTED",
  notAssociated: "DEPLOYMENT_AUTHORIZATION_NOT_ASSOCIATED",
  currentVerificationFailed: "DEPLOYMENT_AUTHORIZATION_CURRENT_VERIFICATION_FAILED",
  notSubset: "DEPLOYMENT_AUTHORIZATION_NOT_SUBSET",
  policyRejected: "DEPLOYMENT_AUTHORIZATION_POLICY_REJECTED",
} as const;
export type DeploymentAuthorizationErrorCodeV1 =
  (typeof DEPLOYMENT_AUTHORIZATION_ERROR_V1)[keyof typeof DEPLOYMENT_AUTHORIZATION_ERROR_V1];

export class DeploymentAuthorizationError extends Error {
  readonly code: DeploymentAuthorizationErrorCodeV1;
  readonly branch: string;
  constructor(code: DeploymentAuthorizationErrorCodeV1, branch: string) {
    super(code);
    this.name = "DeploymentAuthorizationError";
    this.code = code;
    this.branch = branch;
  }
}

export interface DeploymentDownstreamReadInputV1 {
  readonly root: AuthorizationContextV1;
  readonly branch: string;
  readonly requestedSpatialScopeRefs: BusinessActionAuthorizationInputV1["requestedSpatialScopeRefs"];
  readonly requestedSourceVersionRefs: BusinessActionAuthorizationInputV1["requestedSourceVersionRefs"];
}

export interface DeploymentAuthorizationAdapterV1 {
  authorizeBusinessAction(
    input: BusinessActionAuthorizationInputV1,
  ): Promise<AuthorizationDecisionV1>;
  readDownstreamContext(input: DeploymentDownstreamReadInputV1): Promise<{
    readonly context: AuthorizationContextV1;
    readonly invocationId: string;
    readonly branch: string;
  }>;
}

export interface DeploymentAuthorizationAdapterOptionsV1 {
  readonly db: Kysely<unknown>;
  readonly access: PostgresLocalIdentityAccess;
  readonly policy: DeploymentDownstreamAuthorizationPolicyV1;
  readonly now?: () => Date;
}

/** 服务端已登记主体进入新业务动作；不维护内部调用授权链。 */
export const createDeploymentAuthorizationAdapterV1 = (
  options: DeploymentAuthorizationAdapterOptionsV1,
): DeploymentAuthorizationAdapterV1 => ({
  authorizeBusinessAction: (input) => options.access.authorizeBusinessAction(input),
  async readDownstreamContext(input) {
    const branch = ModuleBranchV1Schema.parse(input.branch);
    const decision = await options.access.authorizeBusinessAction({
      actorId: input.root.actorId,
      projectId: input.root.projectId,
      capability: branchCapability(branch),
      branch,
      invocationId: input.root.authorizationContextRef.reference.entityId,
      requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
      requestedSourceVersionRefs: input.requestedSourceVersionRefs,
      ...("causalRunRef" in input.root && input.root.causalRunRef !== undefined
        ? { causalRunRef: input.root.causalRunRef }
        : {}),
    });
    if (decision.redacted)
      throw new DeploymentAuthorizationError(
        DEPLOYMENT_AUTHORIZATION_ERROR_V1.currentVerificationFailed,
        branch,
      );
    return {
      context: decision.context,
      invocationId: input.root.authorizationContextRef.reference.entityId,
      branch,
    };
  },
});

export type DeploymentAuthorizationDecisionV1 = AuthorizationDecisionV1;

export type RegisteredResourceAuthorizerV1 = (input: {
  readonly authorization: AuthorizationContextV1;
  readonly resourceAuthorizationContextRef: AuthorizationContextRefV1;
  readonly branch: ModuleBranchV1;
  readonly invocationId: string;
  readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
}) => Promise<AuthorizationContextV1 | undefined>;

/** 历史快照只定位对象范围；访问资格取当前账号与授权事实。 */
export const createRegisteredResourceAuthorizerV1 =
  (
    access: Pick<
      PostgresLocalIdentityAccess,
      "readDeploymentAuthorizationSource" | "authorizeBusinessAction"
    >,
  ): RegisteredResourceAuthorizerV1 =>
  async (input) => {
    const source = await access.readDeploymentAuthorizationSource({
      projectId: input.authorization.projectId,
      authorizationContextRef: input.resourceAuthorizationContextRef,
    });
    if (source === undefined) return undefined;
    const decision = await access.authorizeBusinessAction({
      projectId: input.authorization.projectId,
      actorId: input.authorization.actorId,
      capability: branchCapability(input.branch),
      branch: input.branch,
      invocationId: input.invocationId,
      requestedSpatialScopeRefs: input.spatialScopeRefs ?? source.context.spatialScopeRefs,
      requestedSourceVersionRefs: source.sourceVersionRefs,
      authorizationContextRef: input.authorization.authorizationContextRef,
    });
    return decision.redacted ? undefined : decision.context;
  };
