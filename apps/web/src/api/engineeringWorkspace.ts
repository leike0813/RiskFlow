import {
  AccessCommandResultV1Schema,
  EngineeringWorkspaceCommandPayloadV1Schema,
  EngineeringWorkspaceReadSuccessV1Schema,
  ProjectWorkspaceAccessCommandPayloadV1Schema,
  ProjectWorkspaceAccessReadSuccessV1Schema,
  type EngineeringWorkspaceIngestionItemV1,
  type EngineeringWorkspaceReadSuccessV1,
  type ProjectBusinessRevisionV1,
  type ProjectWorkspaceAccessReadSuccessV1,
  type SpatialBusinessRevisionV1,
} from "@riskflow/contracts/engineering-workspace";
import { clientError, postRaw, unwrapQueryResult } from "./client.js";

export interface KindRefView {
  readonly kind: string;
  readonly reference: VersionRefView;
}
export interface VersionRefView {
  readonly entityId: string;
  readonly versionId: string;
}
export interface WorkspacePageView<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string | undefined;
}
type PageOptions = { readonly cursor?: string };
type WorkspaceResult<K extends EngineeringWorkspaceReadSuccessV1["kind"]> = Extract<
  EngineeringWorkspaceReadSuccessV1,
  { kind: K }
>;
type AccessResult<K extends ProjectWorkspaceAccessReadSuccessV1["kind"]> = Extract<
  ProjectWorkspaceAccessReadSuccessV1,
  { kind: K }
>;
export type ProjectBusinessRevisionView = ProjectBusinessRevisionV1 & {
  readonly recordedAt: string;
};
export type SpatialBusinessRevisionView = SpatialBusinessRevisionV1 & {
  readonly recordedAt: string;
};
export interface EngineeringWorkspaceContextView {
  readonly projectId: string;
  readonly project: ProjectBusinessRevisionView | null;
  readonly spatial: SpatialBusinessRevisionView | null;
}
export type EngineeringWorkspaceIngestionItemView = EngineeringWorkspaceIngestionItemV1 & {
  readonly detail: string;
};
export interface EngineeringWorkspaceIngestionView extends WorkspacePageView<EngineeringWorkspaceIngestionItemView> {
  readonly projectId: string;
  readonly subject: KindRefView;
}
export type EngineeringWorkspaceSnapshotView =
  WorkspaceResult<"monitoring-snapshots">["items"][number];
export type EngineeringWorkspaceCleaningExclusionView =
  WorkspaceResult<"cleaning-exclusions">["items"][number];
export type WorkspaceMembershipView = AccessResult<"memberships">["items"][number];
export type WorkspaceSpatialScopeView = AccessResult<"spatial-scopes">["items"][number];
export type WorkspaceMemberOptionView = AccessResult<"member-options">["items"][number];
export type WorkspaceSourceAccessView = Omit<AccessResult<"source-access">, "kind">;

const workspacePath = (projectId: string, suffix: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}`;
const drift = () => clientError("TERMINAL_FAILURE");
const succeededResult = (body: unknown): unknown => {
  if (
    typeof body !== "object" ||
    body === null ||
    !("kind" in body) ||
    body.kind !== "succeeded" ||
    !("result" in body)
  )
    throw drift();
  return body.result;
};
let sequence = 0;
const nextId = (action: string): string => `ws-${action}-${Date.now().toString(36)}-${++sequence}`;

/** 四条固定接缝共用既有 Cookie 传输；页面不组装 HTTP 或授权。 */
const workspaceQuery = async (
  projectId: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<EngineeringWorkspaceReadSuccessV1> => {
  const body = await postRaw({
    path: workspacePath(projectId, "engineering-workspace/queries"),
    body: { queryId: nextId("read"), requestedAt: new Date().toISOString(), payload },
    ...(signal === undefined ? {} : { signal }),
  });
  const parsed = EngineeringWorkspaceReadSuccessV1Schema.safeParse(succeededResult(body));
  if (!parsed.success) throw drift();
  return parsed.data;
};

export const readEngineeringWorkspaceContext = async (
  projectId: string,
  payload: {
    readonly projectRevisionRef?: unknown;
    readonly scopeId?: string;
    readonly spatialScopeRef?: unknown;
  },
  signal?: AbortSignal,
): Promise<EngineeringWorkspaceContextView> => {
  const result = await workspaceQuery(projectId, { kind: "context", ...payload }, signal);
  if (result.kind !== "context") throw drift();
  return {
    projectId: result.projectId,
    project:
      result.project === null
        ? null
        : { ...result.project, recordedAt: result.project.systemTime.recordedAt },
    spatial:
      result.spatial === null
        ? null
        : { ...result.spatial, recordedAt: result.spatial.systemTime.recordedAt },
  };
};

const ingestionDetail = (item: EngineeringWorkspaceIngestionItemV1): string => {
  switch (item.stage) {
    case "conversion":
      return `转换${item.status === "succeeded" ? "完成" : "失败"}`;
    case "segments":
      return `资料段 ${item.segmentCount} 段`;
    case "preparation":
      return "已登记识别准备";
    case "cleaning":
      return `清洗可用性 ${item.availability}（保留 ${item.retainedCount}/${item.totalCount}）`;
    case "monitoring-batch":
      return `监测批次 ${item.recordedAt}`;
    case "monitoring-snapshot":
      return `监测快照 ${item.recordedAt}`;
  }
};
export const readEngineeringWorkspaceIngestion = async (
  projectId: string,
  subject: KindRefView,
  signal?: AbortSignal,
  options: PageOptions = {},
): Promise<EngineeringWorkspaceIngestionView> => {
  const result = await workspaceQuery(
    projectId,
    { kind: "ingestion", subject, pageSize: 50, ...options },
    signal,
  );
  if (result.kind !== "ingestion") throw drift();
  return {
    ...result,
    items: result.items.map((item) => ({ ...item, detail: ingestionDetail(item) })),
  };
};
export const resolveEngineeringWorkspaceMonitoringSeries = async (
  projectId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<WorkspaceResult<"resolve-monitoring">["series"]> => {
  const result = await workspaceQuery(projectId, { kind: "resolve-monitoring", seriesId }, signal);
  if (result.kind !== "resolve-monitoring") throw drift();
  return result.series;
};
export const readEngineeringWorkspaceSnapshots = async (
  projectId: string,
  monitoringSeriesRef: KindRefView,
  signal?: AbortSignal,
  options: PageOptions = {},
): Promise<WorkspacePageView<EngineeringWorkspaceSnapshotView>> => {
  const result = await workspaceQuery(
    projectId,
    { kind: "monitoring-snapshots", monitoringSeriesRef, pageSize: 50, ...options },
    signal,
  );
  if (result.kind !== "monitoring-snapshots") throw drift();
  return result;
};
export const readEngineeringWorkspaceCleaningExclusions = async (
  projectId: string,
  resultRef: KindRefView,
  subject: KindRefView,
  signal?: AbortSignal,
  options: PageOptions = {},
): Promise<WorkspacePageView<EngineeringWorkspaceCleaningExclusionView>> => {
  const result = await workspaceQuery(
    projectId,
    { kind: "cleaning-exclusions", resultRef, subject, pageSize: 50, ...options },
    signal,
  );
  if (result.kind !== "cleaning-exclusions") throw drift();
  return result;
};
export const readEngineeringWorkspaceConversionFailure = async (
  projectId: string,
  conversionRef: KindRefView,
  signal?: AbortSignal,
): Promise<WorkspaceResult<"conversion-failure">> => {
  const result = await workspaceQuery(
    projectId,
    { kind: "conversion-failure", conversionRef },
    signal,
  );
  if (result.kind !== "conversion-failure") throw drift();
  return result;
};

export type PreparedEngineeringWorkspaceRevisionV1 = Readonly<{
  projectId: string;
  commandId: string;
  idempotencyKey: string;
  issuedAt: string;
  payload: Readonly<Record<string, unknown>>;
}>;
export const prepareEngineeringWorkspaceRevision = (
  projectId: string,
  payload: Record<string, unknown>,
  commandId?: string,
): PreparedEngineeringWorkspaceRevisionV1 => {
  const parsed = EngineeringWorkspaceCommandPayloadV1Schema.safeParse(payload);
  if (!parsed.success) throw clientError("CONTRACT_INVALID");
  const id = commandId ?? nextId("revision");
  return Object.freeze({
    projectId,
    commandId: id,
    idempotencyKey: id,
    issuedAt: new Date().toISOString(),
    payload: Object.freeze(parsed.data),
  });
};
export const sendEngineeringWorkspaceRevision = async (
  prepared: PreparedEngineeringWorkspaceRevisionV1,
  signal?: AbortSignal,
): Promise<void> => {
  unwrapQueryResult(
    await postRaw({
      path: workspacePath(prepared.projectId, "engineering-workspace/commands"),
      body: {
        commandId: prepared.commandId,
        idempotencyKey: prepared.idempotencyKey,
        issuedAt: prepared.issuedAt,
        payload: prepared.payload,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  );
};

const accessQuery = async (
  projectId: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ProjectWorkspaceAccessReadSuccessV1> => {
  const body = await postRaw({
    path: workspacePath(projectId, "access/queries"),
    body: {
      ...payload,
      queryId: nextId("access-read"),
      requestedAt: new Date().toISOString(),
      projectId,
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const parsed = ProjectWorkspaceAccessReadSuccessV1Schema.safeParse(succeededResult(body));
  if (!parsed.success) throw drift();
  return parsed.data;
};
export const listWorkspaceMemberships = async (
  projectId: string,
  signal?: AbortSignal,
  options: PageOptions = {},
): Promise<WorkspacePageView<WorkspaceMembershipView>> => {
  const result = await accessQuery(
    projectId,
    { kind: "memberships", pageSize: 50, ...options },
    signal,
  );
  if (result.kind !== "memberships") throw drift();
  return result;
};
export const listWorkspaceSpatialScopes = async (
  projectId: string,
  signal?: AbortSignal,
  options: PageOptions = {},
): Promise<WorkspacePageView<WorkspaceSpatialScopeView>> => {
  const result = await accessQuery(
    projectId,
    { kind: "spatial-scopes", pageSize: 50, ...options },
    signal,
  );
  if (result.kind !== "spatial-scopes") throw drift();
  return result;
};
export const listWorkspaceMemberOptions = async (
  projectId: string,
  signal?: AbortSignal,
  options: PageOptions = {},
): Promise<WorkspacePageView<WorkspaceMemberOptionView>> => {
  const result = await accessQuery(
    projectId,
    { kind: "member-options", pageSize: 50, ...options },
    signal,
  );
  if (result.kind !== "member-options") throw drift();
  return result;
};
export const readWorkspaceSourceAccess = async (
  projectId: string,
  sourceVersionRef: KindRefView,
  signal?: AbortSignal,
): Promise<WorkspaceSourceAccessView> => {
  const result = await accessQuery(projectId, { kind: "source-access", sourceVersionRef }, signal);
  if (result.kind !== "source-access") throw drift();
  return result;
};
export type PreparedWorkspaceAccessCommandV1 = PreparedEngineeringWorkspaceRevisionV1;
export const prepareWorkspaceAccessCommand = (
  projectId: string,
  payload: Record<string, unknown>,
  commandId?: string,
): PreparedWorkspaceAccessCommandV1 => {
  const parsed = ProjectWorkspaceAccessCommandPayloadV1Schema.safeParse(payload);
  if (!parsed.success) throw clientError("CONTRACT_INVALID");
  const id = commandId ?? nextId("access");
  return Object.freeze({
    projectId,
    commandId: id,
    idempotencyKey: id,
    issuedAt: new Date().toISOString(),
    payload: Object.freeze(parsed.data),
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
  const parsed = AccessCommandResultV1Schema.safeParse(succeededResult(body));
  if (!parsed.success) throw drift();
  return parsed.data.resultRef;
};
