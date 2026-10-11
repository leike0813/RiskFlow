import type { VersionReference } from "@riskflow/contracts/common";
import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  RecommendationSiteContextV1Schema,
  type RecommendationSiteContextV1,
} from "@riskflow/core/recommendation";

/**
 * C37 D-20：生产装配所需的窄公开读面。
 *
 * 每个 reader 只做「精确版本解析 + 原 Schema 校验」，不建立第二套规则表、不提供默认值。
 * 缺项、错版本、异空间或无权一律返回 undefined，由调用方按所属模块语义失败；
 * 不得先查存在性再拒绝，也不得借用其它工程或最近版本的正文。
 */

/** 工程枚举：有界分页，避免宿主一次性拉全量工程。 */
export const DEPLOYMENT_PROJECT_PAGE_MAX_V1 = 200;

export interface DeploymentProjectSummaryV1 {
  readonly projectId: string;
  readonly revision: number;
  readonly spatialScopeRefs: readonly { entityId: string; versionId: string }[];
  readonly sourceRegistrationRefs: readonly { entityId: string; versionId: string }[];
}

export interface DeploymentProjectListerV1 {
  list(input: {
    readonly cursor?: { readonly projectId: string };
    readonly limit: number;
  }): Promise<{
    readonly projects: readonly DeploymentProjectSummaryV1[];
    readonly nextCursor: { readonly projectId: string } | undefined;
  }>;
}

export interface DeploymentProjectListingSourceV1 {
  /** 所属 adapter 的分页查询；宿主不直接读库。 */
  listProjects(input: {
    readonly afterProjectId: string | undefined;
    readonly limit: number;
  }): Promise<readonly DeploymentProjectSummaryV1[]>;
}

export const createDeploymentProjectListerV1 = (
  source: DeploymentProjectListingSourceV1,
): DeploymentProjectListerV1 => ({
  async list(input) {
    const limit = Math.min(Math.max(1, input.limit), DEPLOYMENT_PROJECT_PAGE_MAX_V1);
    // 多取一行判断是否还有后续，但查询本身仍受固定上限约束。
    const fetchLimit = Math.min(limit + 1, DEPLOYMENT_PROJECT_PAGE_MAX_V1);
    const rows = await source.listProjects({
      afterProjectId: input.cursor?.projectId,
      limit: fetchLimit,
    });
    const projects = rows.slice(0, limit);
    const last = projects.at(-1);
    const hasNext =
      rows.length > limit ||
      (limit === DEPLOYMENT_PROJECT_PAGE_MAX_V1 &&
        projects.length === limit &&
        last !== undefined &&
        (await source.listProjects({ afterProjectId: last.projectId, limit: 1 })).length > 0);
    return {
      projects,
      nextCursor: hasNext && last !== undefined ? { projectId: last.projectId } : undefined,
    };
  },
});

/**
 * 精确配置成员读取：按 (projectId, member releaseRef/versionId) 返回原 C04 正文与摘要。
 * 缺失返回 undefined；不解析 releaseSet 的第一个成员，也不回退到其它版本。
 */
export interface DeploymentConfigurationMemberReaderV1 {
  readMember(input: { readonly projectId: string; readonly releaseRef: VersionReference }): Promise<
    | {
        readonly kind: "resolved";
        readonly body: unknown;
        readonly sha256: string;
      }
    | { readonly kind: "missing" }
  >;
}

export interface DeploymentConfigurationMemberSourceV1 {
  /** 精确成员查询；必须按 projectId + releaseRef 命中唯一行。 */
  findMember(input: {
    readonly projectId: string;
    readonly releaseRef: VersionReference;
  }): Promise<{ readonly body: unknown; readonly sha256: string } | undefined>;
  /** 通过 C04 读取成员正文并完整消费 verified。 */
  openArtifact(input: {
    readonly artifactRef: { readonly entityId: string; readonly versionId: string };
    readonly authorization: AuthorizationContextV1;
  }): Promise<{ readonly body: unknown; readonly sha256: string } | undefined>;
}

export const createDeploymentConfigurationMemberReaderV1 = (
  source: DeploymentConfigurationMemberSourceV1,
): DeploymentConfigurationMemberReaderV1 => ({
  async readMember(input) {
    const found = await source.findMember(input);
    if (found === undefined) return { kind: "missing" };
    return { kind: "resolved", body: found.body, sha256: found.sha256 };
  },
});

/**
 * C24 acceptanceRoutes：精确 acceptance-route-set 登记 → C04.open → 完整消费 verified
 * → 原 AcceptanceRouteSet Schema。缺失、漂移或未完整消费一律 undefined。
 */
export interface DeploymentAcceptanceRouteReaderV1 {
  readRoutes(input: {
    readonly projectId: string;
    readonly artifactRef: { readonly entityId: string; readonly versionId: string };
    readonly authorization: AuthorizationContextV1;
  }): Promise<unknown | undefined>;
}

const readBoundedArtifactJson = async (
  handle: Awaited<ReturnType<ArtifactStoreV1["open"]>>,
): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for await (const chunk of handle.content) {
      byteLength += chunk.byteLength;
      if (byteLength > 1_048_576) throw new RangeError("DEPLOYMENT_ARTIFACT_TOO_LARGE");
      chunks.push(chunk);
    }
    await handle.verified;
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    // 拒绝超限时流关闭可能使 verified 拒绝；保留主错误，不产生未处理事件。
    void handle.verified.catch(() => undefined);
  }
};

export interface DeploymentSiteContextBindingV1 {
  readonly projectId: string;
  readonly siteContextRef: VersionReference;
  readonly artifactRef: { readonly entityId: string; readonly versionId: string };
}

export const createDeploymentSiteContextReaderV1 = (input: {
  readonly artifactStore: ArtifactStoreV1;
  readonly bindings: readonly DeploymentSiteContextBindingV1[];
}): {
  read(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly siteContextRef: VersionReference;
  }): Promise<RecommendationSiteContextV1 | undefined>;
} => {
  const key = (projectId: string, ref: VersionReference): string =>
    JSON.stringify([projectId, ref.entityId, ref.versionId]);
  const bindings = new Map<string, DeploymentSiteContextBindingV1>();
  if (input.bindings.length > 256) throw new RangeError("DEPLOYMENT_SITE_BINDINGS_TOO_LARGE");
  for (const binding of input.bindings) {
    const identity = key(binding.projectId, binding.siteContextRef);
    if (bindings.has(identity)) throw new TypeError("DEPLOYMENT_SITE_BINDING_DUPLICATE");
    bindings.set(identity, structuredClone(binding));
  }
  return {
    async read(request) {
      const binding = bindings.get(key(request.authorization.projectId, request.siteContextRef));
      if (binding === undefined) return undefined;
      const handle = await input.artifactStore.open({
        schemaVersion: "1",
        requestId: request.requestId,
        idempotencyKey: request.requestId,
        artifactRef: { kind: "content-artifact", reference: binding.artifactRef },
        projectId: binding.projectId,
        actorId: request.authorization.actorId,
        requestedAt: request.requestedAt,
        purposeCode: "recommendation-site-context",
        requiredCapability: "warning-response.recommend",
        authorization: request.authorization,
      });
      const parsed = RecommendationSiteContextV1Schema.safeParse(
        await readBoundedArtifactJson(handle),
      );
      if (!parsed.success) return undefined;
      const context = parsed.data;
      if (
        context.projectId !== binding.projectId ||
        context.siteContextRef.entityId !== request.siteContextRef.entityId ||
        context.siteContextRef.versionId !== request.siteContextRef.versionId ||
        Date.parse(context.observedAt) > Date.parse(request.requestedAt) ||
        !request.authorization.spatialScopeRefs.some(
          (scope) =>
            scope.reference.entityId === context.spatialScopeRef.reference.entityId &&
            scope.reference.versionId === context.spatialScopeRef.reference.versionId,
        )
      )
        return undefined;
      return context;
    },
  };
};

export const createDeploymentAcceptanceRouteReaderV1 = (input: {
  readonly artifactStore: ArtifactStoreV1;
  readonly parseRoutes: (raw: unknown) => unknown;
}): DeploymentAcceptanceRouteReaderV1 => ({
  async readRoutes(request) {
    const handle = await input.artifactStore.open({
      schemaVersion: "1",
      requestId: `acceptance-routes-${request.projectId}-${request.artifactRef.versionId}`,
      idempotencyKey: `acceptance-routes-${request.artifactRef.entityId}`,
      artifactRef: { kind: "content-artifact", reference: request.artifactRef },
      projectId: request.projectId,
      actorId: request.authorization.actorId,
      requestedAt: new Date().toISOString(),
      purposeCode: "identification-acceptance-route-set",
      requiredCapability: "risk-identification.read",
      authorization: request.authorization,
    });
    return input.parseRoutes(await readBoundedArtifactJson(handle));
  },
});

/**
 * C30 riskSpatialPairing：按该精确 riskRecord 登记的空间与请求 pairings 做精确匹配。
 * 无匹配、多匹配或无权一律 undefined；绝不借用其它空间或其它工程的登记。
 */
export interface DeploymentSpatialPairingReaderV1 {
  readPairing(input: {
    readonly projectId: string;
    readonly riskRecordId: string;
    readonly requestedPairingRef: VersionReference;
    readonly authorization: AuthorizationContextV1;
  }): Promise<{ entityId: string; versionId: string } | undefined>;
}

export interface DeploymentSpatialPairingSourceV1 {
  /** 该精确 riskRecord 已登记的空间引用；无权时返回 undefined。 */
  listRecordScopes(input: {
    readonly projectId: string;
    readonly riskRecordId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<readonly { readonly entityId: string; readonly versionId: string }[] | undefined>;
}

export const createDeploymentSpatialPairingReaderV1 = (
  source: DeploymentSpatialPairingSourceV1,
): DeploymentSpatialPairingReaderV1 => ({
  async readPairing(input) {
    const scopes = await source.listRecordScopes({
      projectId: input.projectId,
      riskRecordId: input.riskRecordId,
      authorization: input.authorization,
    });
    if (scopes === undefined) return undefined;
    const matches = scopes.filter(
      (scope) =>
        scope.entityId === input.requestedPairingRef.entityId &&
        scope.versionId === input.requestedPairingRef.versionId,
    );
    // 多重匹配说明登记异常，宁可失败也不猜测。
    return matches.length === 1 ? matches[0] : undefined;
  },
});
