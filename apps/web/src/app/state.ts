import type { ModuleCapabilityV1, SpatialScopeRefV1 } from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import type { SessionMetadataViewV1 } from "../api/http.js";
import type { SafeHttpErrorV1 } from "../api/errors.js";

export type SessionStateV1 =
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "restricted"; metadata: SessionMetadataViewV1 }>
  | Readonly<{ kind: "authenticated"; metadata: SessionMetadataViewV1 }>
  | Readonly<{ kind: "failed"; error: SafeHttpErrorV1 }>;

export type WebContextV1 = Readonly<{
  revision: number;
  projectId: string | null;
  spatialScopeRef: SpatialScopeRefV1 | null;
  processNodeId: string | null;
}>;

export type PageLoadStateV1<T> =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading"; previous: T | null }>
  | Readonly<{ kind: "ready"; value: T }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "error"; error: SafeHttpErrorV1 }>
  | Readonly<{ kind: "forbidden"; requiredCapability: ModuleCapabilityV1 }>
  | Readonly<{ kind: "unavailable"; reasons: readonly SafeReasonV1[] }>;

export type SafeReasonV1 = Readonly<{ code: string }>;

export const INITIAL_WEB_CONTEXT_V1: WebContextV1 = Object.freeze({
  revision: 0,
  projectId: null,
  spatialScopeRef: null,
  processNodeId: null,
});

export const WEB_PAGE_STATE_VALUES = [
  "idle",
  "loading",
  "ready",
  "empty",
  "error",
  "forbidden",
  "unavailable",
] as const;
export type WebPageStateKindV1 = (typeof WEB_PAGE_STATE_VALUES)[number];

export type WebContextActionV1 =
  | Readonly<{ type: "project-selected"; projectId: string | null }>
  | Readonly<{ type: "spatial-scope-selected"; spatialScopeRef: SpatialScopeRefV1 | null }>
  | Readonly<{ type: "process-node-selected"; processNodeId: string | null }>
  | Readonly<{ type: "replace"; context: WebContextV1 }>
  | Readonly<{ type: "clear" }>;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const validVersionReference = (value: unknown): value is VersionReference => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 && nonEmpty(record.entityId) && nonEmpty(record.versionId)
  );
};

const validSpatialScopeRef = (value: unknown): value is SpatialScopeRefV1 => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.kind === "spatial-scope" &&
    validVersionReference(record.reference)
  );
};

const freezeSpatialScopeRef = (value: SpatialScopeRefV1): SpatialScopeRefV1 =>
  Object.freeze({
    kind: "spatial-scope" as const,
    reference: Object.freeze({
      entityId: value.reference.entityId.trim(),
      versionId: value.reference.versionId.trim(),
    }),
  });

const sameSpatialScope = (
  left: SpatialScopeRefV1 | null,
  right: SpatialScopeRefV1 | null,
): boolean =>
  left?.kind === right?.kind &&
  left?.reference.entityId === right?.reference.entityId &&
  left?.reference.versionId === right?.reference.versionId;

const sameContext = (left: WebContextV1, right: WebContextV1): boolean =>
  left.projectId === right.projectId &&
  left.processNodeId === right.processNodeId &&
  sameSpatialScope(left.spatialScopeRef, right.spatialScopeRef);

const nextRevision = (revision: number): number => {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER)
    throw new Error("web context revision exhausted");
  return revision + 1;
};

const changed = (current: WebContextV1, next: Omit<WebContextV1, "revision">): WebContextV1 => {
  const candidate = { ...next, revision: current.revision };
  if (sameContext(current, candidate)) return current;
  return Object.freeze({ ...next, revision: nextRevision(current.revision) });
};

export const reduceWebContext = (
  current: WebContextV1,
  action: WebContextActionV1,
): WebContextV1 => {
  if (!Number.isSafeInteger(current.revision) || current.revision < 0)
    throw new Error("invalid web context revision");
  if (action.type === "clear")
    return changed(current, {
      projectId: null,
      spatialScopeRef: null,
      processNodeId: null,
    });
  if (action.type === "replace") {
    const projectId = action.context.projectId;
    const spatialScopeRef = action.context.spatialScopeRef;
    const processNodeId = action.context.processNodeId;
    if (projectId !== null && !nonEmpty(projectId)) return current;
    if (spatialScopeRef !== null && !validSpatialScopeRef(spatialScopeRef)) return current;
    if (spatialScopeRef !== null && projectId === null) return current;
    if (processNodeId !== null && !nonEmpty(processNodeId)) return current;
    return changed(current, {
      projectId: projectId?.trim() ?? null,
      spatialScopeRef: spatialScopeRef === null ? null : freezeSpatialScopeRef(spatialScopeRef),
      processNodeId: processNodeId?.trim() ?? null,
    });
  }
  if (action.type === "project-selected") {
    const projectId = action.projectId?.trim() ?? null;
    if (projectId !== null && !nonEmpty(projectId)) return current;
    return changed(current, {
      projectId,
      spatialScopeRef: null,
      processNodeId: null,
    });
  }
  if (action.type === "spatial-scope-selected") {
    if (current.projectId === null) return current;
    if (action.spatialScopeRef !== null && !validSpatialScopeRef(action.spatialScopeRef))
      return current;
    return changed(current, {
      projectId: current.projectId,
      spatialScopeRef:
        action.spatialScopeRef === null ? null : freezeSpatialScopeRef(action.spatialScopeRef),
      processNodeId: null,
    });
  }
  if (current.projectId === null) return current;
  const processNodeId = action.processNodeId?.trim() ?? null;
  if (processNodeId !== null && !nonEmpty(processNodeId)) return current;
  return changed(current, {
    projectId: current.projectId,
    spatialScopeRef: current.spatialScopeRef,
    processNodeId,
  });
};

export const contextReducer = reduceWebContext;
export const createInitialWebContext = (): WebContextV1 => INITIAL_WEB_CONTEXT_V1;

export type FrozenRunContextV1 = Readonly<{
  revision: number;
  projectId: string;
  spatialScopeRef: SpatialScopeRefV1 | null;
  processNodeId: string | null;
}>;

export const freezeRunContext = (context: WebContextV1): FrozenRunContextV1 => {
  if (
    context.projectId === null ||
    !nonEmpty(context.projectId) ||
    !Number.isSafeInteger(context.revision) ||
    context.revision < 0 ||
    (context.processNodeId !== null && !nonEmpty(context.processNodeId)) ||
    (context.spatialScopeRef !== null && !validSpatialScopeRef(context.spatialScopeRef))
  )
    throw new Error("invalid running context");
  return Object.freeze({
    revision: context.revision,
    projectId: context.projectId.trim(),
    spatialScopeRef:
      context.spatialScopeRef === null ? null : freezeSpatialScopeRef(context.spatialScopeRef),
    processNodeId: context.processNodeId?.trim() ?? null,
  });
};

export const contextMatchesFrozenRun = (
  context: WebContextV1,
  frozen: FrozenRunContextV1,
): boolean =>
  context.revision === frozen.revision &&
  context.projectId === frozen.projectId &&
  sameSpatialScope(context.spatialScopeRef, frozen.spatialScopeRef) &&
  context.processNodeId === frozen.processNodeId;

export type RequestRevisionTokenV1 = Readonly<{
  requestId: number;
  revision: number;
  routeId: string;
  signal: AbortSignal;
}>;

export type RequestRevisionGuardV1 = Readonly<{
  begin: (input: { revision: number; routeId: string }) => RequestRevisionTokenV1;
  isCurrent: (token: RequestRevisionTokenV1) => boolean;
  accept: (token: RequestRevisionTokenV1) => boolean;
  cancel: () => void;
}>;

export const createRequestRevisionGuard = (): RequestRevisionGuardV1 => {
  let sequence = 0;
  let current: { token: RequestRevisionTokenV1; controller: AbortController } | null = null;
  const cancel = (): void => {
    current?.controller.abort();
    current = null;
  };
  return Object.freeze({
    begin: (input: { revision: number; routeId: string }): RequestRevisionTokenV1 => {
      cancel();
      const controller = new AbortController();
      const token = Object.freeze({
        requestId: ++sequence,
        revision: input.revision,
        routeId: input.routeId,
        signal: controller.signal,
      });
      current = { token, controller };
      return token;
    },
    isCurrent: (token: RequestRevisionTokenV1): boolean => {
      if (current === null) return false;
      return (
        current.token.requestId === token.requestId &&
        current.token.revision === token.revision &&
        current.token.routeId === token.routeId &&
        !token.signal.aborted
      );
    },
    accept: (token: RequestRevisionTokenV1): boolean => {
      const accepted =
        current !== null &&
        current.token.requestId === token.requestId &&
        current.token.revision === token.revision &&
        current.token.routeId === token.routeId &&
        !token.signal.aborted;
      if (accepted) current = null;
      return accepted;
    },
    cancel,
  });
};

export const createRevisionGuard = createRequestRevisionGuard;

export type WebStateV1 = Readonly<{
  session: SessionStateV1;
  context: WebContextV1;
  pageLoads: Readonly<Record<string, PageLoadStateV1<unknown>>>;
}>;

export const INITIAL_WEB_STATE_V1: WebStateV1 = Object.freeze({
  session: { kind: "checking" },
  context: INITIAL_WEB_CONTEXT_V1,
  pageLoads: Object.freeze({}),
});

export type WebStateActionV1 =
  | Readonly<{ type: "session-updated"; session: SessionStateV1 }>
  | Readonly<{ type: "context"; action: WebContextActionV1 }>
  | Readonly<{ type: "page-load"; key: string; state: PageLoadStateV1<unknown> }>
  | Readonly<{ type: "session-invalidated" }>;

export const reduceWebState = (current: WebStateV1, action: WebStateActionV1): WebStateV1 => {
  if (action.type === "session-invalidated")
    return Object.freeze({
      session: { kind: "anonymous" },
      context: INITIAL_WEB_CONTEXT_V1,
      pageLoads: Object.freeze({}),
    });
  if (action.type === "session-updated")
    return Object.freeze({ ...current, session: action.session });
  if (action.type === "context") {
    const context = reduceWebContext(current.context, action.action);
    return Object.freeze({
      ...current,
      context,
      pageLoads: context === current.context ? current.pageLoads : Object.freeze({}),
    });
  }
  return Object.freeze({
    ...current,
    pageLoads: Object.freeze({ ...current.pageLoads, [action.key]: action.state }),
  });
};

export const clearSensitiveWebState = (): WebStateV1 =>
  reduceWebState(INITIAL_WEB_STATE_V1, { type: "session-invalidated" });
