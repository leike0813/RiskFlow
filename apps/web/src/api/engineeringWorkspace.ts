import { clientError, postRaw, unwrapQueryResult } from "./client.js";

/**
 * 工程工作区的浏览器接缝（design D-05）。
 *
 * 四条固定路径只在这里拼装；页面不构造 HTTP，也不进入任何 branch 对应的强制操作注册表。
 * 请求体只有业务载荷与调用标识：会话 token 由同源安全 Cookie 承担，工程标识来自路径。
 * 解码只提取契约内页面所需字段，形状漂移统一收敛为 TERMINAL_FAILURE。
 */

const drift = () => clientError("TERMINAL_FAILURE");
const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw drift();
  return value as Record<string, unknown>;
};
const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw drift();
  return value;
};
const asString = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) throw drift();
  return value;
};
const asOptionalString = (value: unknown): string | undefined =>
  value === undefined ? undefined : asString(value);
const asNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw drift();
  return value;
};
const asKindRef = (
  value: unknown,
): {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
} => {
  const record = asRecord(value);
  return {
    kind: asString(record.kind),
    reference: {
      entityId: asString(asRecord(record.reference).entityId),
      versionId: asString(asRecord(record.reference).versionId),
    },
  };
};
const asVersionRef = (
  value: unknown,
): { readonly entityId: string; readonly versionId: string } => {
  const record = asRecord(value);
  return {
    entityId: asString(record.entityId),
    versionId: asString(record.versionId),
  };
};

export interface KindRefView {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

export interface VersionRefView {
  readonly entityId: string;
  readonly versionId: string;
}

export interface ProjectBusinessRevisionView {
  readonly projectRevisionRef: KindRefView;
  readonly name: string;
  readonly lifecycle: string;
  readonly applicabilityMetadata: {
    readonly constructionMethod: string;
    readonly stratumCondition: string;
    readonly engineeringStage: string;
  };
  readonly effectivePeriod: { readonly validFrom: string; readonly validTo?: string };
  readonly recordedAt: string;
}

export interface SpatialBusinessRevisionView {
  readonly spatialScopeRef: KindRefView;
  readonly name: string;
  readonly worksiteLocation: string;
  readonly status: string;
  readonly parentScopeRef?: KindRefView;
  readonly chainage?: { readonly start: number; readonly end: number };
}

export interface EngineeringWorkspaceContextView {
  readonly projectId: string;
  readonly project: ProjectBusinessRevisionView | null;
  readonly spatial: SpatialBusinessRevisionView | null;
}

export interface EngineeringWorkspaceIngestionItemView {
  readonly stage: string;
  readonly recordRef: KindRefView;
  readonly recordedAt: string;
  readonly detail: string;
}

export interface EngineeringWorkspaceIngestionView {
  readonly projectId: string;
  readonly subject: KindRefView;
  readonly items: readonly EngineeringWorkspaceIngestionItemView[];
}

export interface EngineeringWorkspaceSnapshotView {
  readonly monitoringSnapshotRef: KindRefView;
  readonly cutoff: string;
  readonly availability: string;
  readonly coverageRatio: number;
}

export interface EngineeringWorkspaceCleaningExclusionView {
  readonly decisionId: string;
  readonly targetKind: string;
  readonly reasonCode: string;
  readonly disposition: string;
  readonly rejectionClass?: string;
  readonly sourceSegmentId?: string;
}

export interface WorkspaceMembershipView {
  readonly membershipRef: VersionRefView;
  readonly accountRef: VersionRefView;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly status: string;
}

export interface WorkspaceSpatialScopeView {
  readonly scopeRef: VersionRefView;
  readonly parentScopeRef?: VersionRefView;
  readonly status: string;
}

export interface WorkspaceMemberOptionView {
  readonly accountRef: VersionRefView;
  readonly displayName: string;
}

export interface WorkspaceSourceAccessView {
  readonly sourceGrantRef: VersionRefView;
  readonly visibility: string;
  readonly allowedAccountIds: readonly string[];
  readonly registeredByAccountId: string;
}

const workspacePath = (projectId: string, suffix: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}`;

const succeededResult = (body: unknown): Record<string, unknown> => {
  const record = asRecord(body);
  if (record.kind !== "succeeded" || !("result" in record)) throw drift();
  return asRecord(record.result);
};

const readProjectRevision = (value: unknown): ProjectBusinessRevisionView => {
  const record = asRecord(value);
  const applicability = asRecord(record.applicabilityMetadata);
  const effectivePeriod = asRecord(record.effectivePeriod);
  const systemTime = asRecord(record.systemTime);
  return {
    projectRevisionRef: asKindRef(record.projectRevisionRef),
    name: asString(record.name),
    lifecycle: asString(record.lifecycle),
    applicabilityMetadata: {
      constructionMethod: asString(applicability.constructionMethod),
      stratumCondition: asString(applicability.stratumCondition),
      engineeringStage: asString(applicability.engineeringStage),
    },
    effectivePeriod: {
      validFrom: asString(effectivePeriod.validFrom),
      ...(effectivePeriod.validTo === undefined
        ? {}
        : { validTo: asString(effectivePeriod.validTo) }),
    },
    recordedAt: asString(systemTime.recordedAt),
  };
};

const readSpatialRevision = (value: unknown): SpatialBusinessRevisionView => {
  const record = asRecord(value);
  return {
    spatialScopeRef: asKindRef(record.spatialScopeRef),
    name: asString(record.name),
    worksiteLocation: asString(record.worksiteLocation),
    status: asString(record.status),
    ...(record.parentScopeRef === undefined
      ? {}
      : { parentScopeRef: asKindRef(record.parentScopeRef) }),
    ...(record.chainage === undefined
      ? {}
      : {
          chainage: {
            start: asNumber(asRecord(record.chainage).start),
            end: asNumber(asRecord(record.chainage).end),
          },
        }),
  };
};

const ingestionDetail = (record: Record<string, unknown>): string => {
  const stage = asString(record.stage);
  if (stage === "conversion") {
    const status = asString(record.status);
    const set = asOptionalString(
      record.sourceSegmentSetRef === undefined
        ? undefined
        : asKindRef(record.sourceSegmentSetRef).reference.entityId,
    );
    return `转换${status === "succeeded" ? "完成" : "失败"}${set === undefined ? "" : `（资料段 ${set}）`}`;
  }
  if (stage === "segments") {
    return `资料段 ${asNumber(record.segmentCount)} 段`;
  }
  if (stage === "cleaning") {
    return `清洗可用性 ${asString(record.availability)}（保留 ${asNumber(record.retainedCount)}/${asNumber(record.totalCount)}）`;
  }
  if (stage === "monitoring-batch") {
    return `监测批次 ${asString(record.recordedAt)}`;
  }
  if (stage === "monitoring-snapshot") {
    return `监测快照 ${asString(record.recordedAt)}`;
  }
  return stage;
};

/** 工程上下文精确读：当前或历史修订，缺失即为 null。 */
export const readEngineeringWorkspaceContext = async (
  projectId: string,
  payload: {
    readonly projectRevisionRef?: unknown;
    readonly scopeId?: string;
    readonly spatialScopeRef?: unknown;
  },
  signal?: AbortSignal,
): Promise<EngineeringWorkspaceContextView> => {
  const body = await postRaw({
    path: workspacePath(projectId, "engineering-workspace/queries"),
    body: {
      queryId: `ws-context-${Date.now().toString(36)}`,
      requestedAt: new Date().toISOString(),
      payload: {
        kind: "context",
        ...(payload.projectRevisionRef === undefined
          ? {}
          : { projectRevisionRef: payload.projectRevisionRef }),
        ...(payload.scopeId === undefined ? {} : { scopeId: payload.scopeId }),
        ...(payload.spatialScopeRef === undefined
          ? {}
          : { spatialScopeRef: payload.spatialScopeRef }),
      },
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = succeededResult(body);
  return {
    projectId: asString(result.projectId),
    project: result.project === null ? null : readProjectRevision(result.project),
    spatial: result.spatial === null ? null : readSpatialRevision(result.spatial),
  };
};

/** 接入关系目录：来源或监测序列的已登记处理关系。 */
export const readEngineeringWorkspaceIngestion = async (
  projectId: string,
  subject: KindRefView,
  signal?: AbortSignal,
): Promise<EngineeringWorkspaceIngestionView> => {
  const body = await postRaw({
    path: workspacePath(projectId, "engineering-workspace/queries"),
    body: {
      queryId: `ws-ingestion-${Date.now().toString(36)}`,
      requestedAt: new Date().toISOString(),
      payload: { kind: "ingestion", subject, pageSize: 50 },
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = succeededResult(body);
  return {
    projectId: asString(result.projectId),
    subject: asKindRef(result.subject),
    items: asArray(result.items).map((item) => {
      const record = asRecord(item);
      return {
        stage: asString(record.stage),
        recordRef: asKindRef(record.recordRef),
        recordedAt: asString(record.recordedAt),
        detail: ingestionDetail(record),
      };
    }),
  };
};

/**
 * 无版本旧序列地址的窄解析：按稳定序列身份解析当前可见引用。
 *
 * 只调用所属目录的窄读，不扫描目录页；解析不到即失败，不回落首条。
 */
export const resolveEngineeringWorkspaceMonitoringSeries = async (
  projectId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<{
  readonly monitoringSeriesRef: KindRefView;
  readonly monitoringObject: string;
  readonly monitoringIndicator: string;
  readonly canonicalUnit: string;
}> => {
  const body = await postRaw({
    path: workspacePath(projectId, "engineering-workspace/queries"),
    body: {
      queryId: `ws-resolve-${Date.now().toString(36)}`,
      requestedAt: new Date().toISOString(),
      payload: { kind: "resolve-monitoring", seriesId },
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = succeededResult(body);
  const series = asRecord(result.series);
  return {
    monitoringSeriesRef: asKindRef(series.monitoringSeriesRef),
    monitoringObject: asString(series.monitoringObject),
    monitoringIndicator: asString(series.monitoringIndicator),
    canonicalUnit: asString(series.canonicalUnit),
  };
};

/** 精确序列的快照目录。 */
export const readEngineeringWorkspaceSnapshots = async (
  projectId: string,
  monitoringSeriesRef: KindRefView,
  signal?: AbortSignal,
): Promise<readonly EngineeringWorkspaceSnapshotView[]> => {
  const body = await postRaw({
    path: workspacePath(projectId, "engineering-workspace/queries"),
    body: {
      queryId: `ws-snapshots-${Date.now().toString(36)}`,
      requestedAt: new Date().toISOString(),
      payload: { kind: "monitoring-snapshots", monitoringSeriesRef, pageSize: 50 },
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = succeededResult(body);
  return asArray(result.items).map((item) => {
    const record = asRecord(item);
    return {
      monitoringSnapshotRef: asKindRef(record.monitoringSnapshotRef),
      cutoff: asString(record.cutoff),
      availability: asString(record.availability),
      coverageRatio: asNumber(record.coverageRatio),
    };
  });
};

/** 正式清洗结果的排除项。 */
export const readEngineeringWorkspaceCleaningExclusions = async (
  projectId: string,
  resultRef: KindRefView,
  subject: KindRefView,
  signal?: AbortSignal,
): Promise<readonly EngineeringWorkspaceCleaningExclusionView[]> => {
  const body = await postRaw({
    path: workspacePath(projectId, "engineering-workspace/queries"),
    body: {
      queryId: `ws-exclusions-${Date.now().toString(36)}`,
      requestedAt: new Date().toISOString(),
      payload: { kind: "cleaning-exclusions", resultRef, subject, pageSize: 50 },
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = succeededResult(body);
  return asArray(result.items).map((item) => {
    const record = asRecord(item);
    return {
      decisionId: asString(record.decisionId),
      targetKind: asString(record.targetKind),
      reasonCode: asString(record.reasonCode),
      disposition: asString(record.disposition),
      ...(record.rejectionClass === undefined
        ? {}
        : { rejectionClass: asString(record.rejectionClass) }),
      ...(record.sourceSegmentId === undefined
        ? {}
        : { sourceSegmentId: asString(record.sourceSegmentId) }),
    };
  });
};

/**
 * 工程工作区修订的冻结请求。
 *
 * 命令身份、幂等键与签发时间在打开确认前冻结；重试重发同一份快照，不改写命令身份。
 */
export type PreparedEngineeringWorkspaceRevisionV1 = Readonly<{
  readonly projectId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}>;

let workspaceCommandSequence = 0;
const nextWorkspaceCommandId = (action: string): string => {
  workspaceCommandSequence += 1;
  return `ws-${action}-${Date.now().toString(36)}-${workspaceCommandSequence}`;
};

export const prepareEngineeringWorkspaceRevision = (
  projectId: string,
  payload: Record<string, unknown>,
  commandId?: string,
): PreparedEngineeringWorkspaceRevisionV1 => {
  const id = commandId ?? nextWorkspaceCommandId("revision");
  return Object.freeze({
    projectId,
    commandId: id,
    idempotencyKey: id,
    issuedAt: new Date().toISOString(),
    payload: Object.freeze({ ...payload }),
  });
};

export const sendEngineeringWorkspaceRevision = async (
  prepared: PreparedEngineeringWorkspaceRevisionV1,
  signal?: AbortSignal,
): Promise<void> => {
  const body = await postRaw({
    path: workspacePath(prepared.projectId, "engineering-workspace/commands"),
    body: {
      commandId: prepared.commandId,
      idempotencyKey: prepared.idempotencyKey,
      issuedAt: prepared.issuedAt,
      payload: prepared.payload,
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = asRecord(body);
  if (result.kind === "failed") {
    // 领域失败以安全 HTTP 错误表达；这里只把失败信封原样抛给页面状态机。
    throw clientError("BUSINESS_BLOCKED");
  }
  unwrapQueryResult(body);
};

/* -------------------------------------------------------------------------- */
/* 工程访问维护                                                                */
/* -------------------------------------------------------------------------- */

const accessQuery = async (
  projectId: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  const body = await postRaw({
    path: workspacePath(projectId, "access/queries"),
    body: {
      ...payload,
      queryId: `ws-access-${Date.now().toString(36)}`,
      requestedAt: new Date().toISOString(),
      projectId,
    },
    ...(signal === undefined ? {} : { signal }),
  });
  return succeededResult(body);
};

export const listWorkspaceMemberships = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly WorkspaceMembershipView[]> => {
  const result = await accessQuery(projectId, { kind: "memberships", pageSize: 50 }, signal);
  return asArray(result.items).map((item) => {
    const record = asRecord(item);
    return {
      membershipRef: asVersionRef(record.membershipRef),
      accountRef: asVersionRef(record.accountRef),
      displayName: asString(record.displayName),
      roles: asArray(record.roles).map(asString),
      status: asString(record.status),
    };
  });
};

export const listWorkspaceSpatialScopes = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly WorkspaceSpatialScopeView[]> => {
  const result = await accessQuery(projectId, { kind: "spatial-scopes", pageSize: 50 }, signal);
  return asArray(result.items).map((item) => {
    const record = asRecord(item);
    return {
      scopeRef: asVersionRef(record.scopeRef),
      ...(record.parentScopeRef === undefined
        ? {}
        : { parentScopeRef: asVersionRef(record.parentScopeRef) }),
      status: asString(record.status),
    };
  });
};

export const listWorkspaceMemberOptions = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly WorkspaceMemberOptionView[]> => {
  const result = await accessQuery(projectId, { kind: "member-options", pageSize: 50 }, signal);
  return asArray(result.items).map((item) => {
    const record = asRecord(item);
    return {
      accountRef: asVersionRef(record.accountRef),
      displayName: asString(record.displayName),
    };
  });
};

export const readWorkspaceSourceAccess = async (
  projectId: string,
  sourceVersionRef: KindRefView,
  signal?: AbortSignal,
): Promise<WorkspaceSourceAccessView> => {
  const result = await accessQuery(projectId, { kind: "source-access", sourceVersionRef }, signal);
  return {
    sourceGrantRef: asVersionRef(result.sourceGrantRef),
    visibility: asString(result.visibility),
    allowedAccountIds: asArray(result.allowedAccountIds).map(asString),
    registeredByAccountId: asString(result.registeredByAccountId),
  };
};

export type PreparedWorkspaceAccessCommandV1 = Readonly<{
  readonly projectId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}>;

export const prepareWorkspaceAccessCommand = (
  projectId: string,
  payload: Record<string, unknown>,
  commandId?: string,
): PreparedWorkspaceAccessCommandV1 => {
  const id = commandId ?? nextWorkspaceCommandId("access");
  return Object.freeze({
    projectId,
    commandId: id,
    idempotencyKey: id,
    issuedAt: new Date().toISOString(),
    payload: Object.freeze({ ...payload }),
  });
};

export const sendWorkspaceAccessCommand = async (
  prepared: PreparedWorkspaceAccessCommandV1,
  signal?: AbortSignal,
): Promise<VersionRefView> => {
  const body = await postRaw({
    path: workspacePath(prepared.projectId, "access/commands"),
    body: {
      commandId: prepared.commandId,
      idempotencyKey: prepared.idempotencyKey,
      issuedAt: prepared.issuedAt,
      payload: prepared.payload,
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const result = succeededResult(body);
  return asVersionRef(result.resultRef);
};
