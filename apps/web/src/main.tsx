import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { ProjectRevisionRefV1 } from "@riskflow/contracts/ports";

import {
  C09HttpError,
  createC09Client,
  type SessionChangePasswordInputV1,
  type SessionLoginInputV1,
  type SessionMetadataViewV1,
} from "./api/http.js";
import { App } from "./app/App.js";
import { createWebRouteRegistry, type WebRouteResolutionV1 } from "./app/routes.js";
import {
  createRequestRevisionGuard,
  INITIAL_WEB_CONTEXT_V1,
  type SessionStateV1,
  type WebContextV1,
} from "./app/state.js";
import { QUALITY_EVALUATION_QUERY_OPERATION_V1 } from "./quality/operation.js";
import {
  createQualityAssessmentRouteContribution,
  QualityPage,
  safeHttpErrorOf,
} from "./quality/QualityPage.js";
import "./shell/AppShell.css";

const client = createC09Client({ operations: [QUALITY_EVALUATION_QUERY_OPERATION_V1] });

/** 选择器里允许出现的标识：非空且不含路径分隔符；授权始终由服务端判定。 */
const safeSelectorValue = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
};

type ProjectSelectionV1 = Readonly<{
  projectIds: readonly string[];
  revisions: ReadonlyMap<string, string>;
}>;

/**
 * URL 只作为选择器输入，不参与授权：`?project=<工程>&revision=<工程>@<项目修订>`。
 * 两类参数都可重复出现，从而在同一页面提供多个可选工程；修订按工程归属，
 * 切换工程时不会把上一工程的项目修订张冠李戴。
 */
const readProjectSelection = (search: string): ProjectSelectionV1 => {
  const params = new URLSearchParams(search);
  const revisions = new Map<string, string>();
  for (const raw of params.getAll("revision")) {
    const [entityId, versionId, ...rest] = raw.split("@");
    const projectId = safeSelectorValue(entityId);
    const revisionId = safeSelectorValue(versionId);
    if (projectId === null || revisionId === null || rest.length > 0) continue;
    revisions.set(projectId, revisionId);
  }
  const projectIds: string[] = [];
  for (const raw of [...params.getAll("project"), ...revisions.keys()]) {
    const projectId = safeSelectorValue(raw);
    if (projectId !== null && !projectIds.includes(projectId)) projectIds.push(projectId);
  }
  return { projectIds: Object.freeze(projectIds), revisions };
};

/** 缺少工程或该工程没有对应修订时返回 null，页面据此呈现 empty 且不发请求。 */
const projectRevisionRefFor = (
  selection: ProjectSelectionV1,
  projectId: string | null,
): ProjectRevisionRefV1 | null => {
  const versionId = projectId === null ? undefined : selection.revisions.get(projectId);
  if (projectId === null || versionId === undefined) return null;
  return { kind: "project-revision", reference: { entityId: projectId, versionId } };
};

/** 需要在首次登录后改密时按受限会话呈现，不缓存任何令牌。 */
const sessionFromMetadata = (metadata: SessionMetadataViewV1): SessionStateV1 =>
  metadata.passwordChangeRequired
    ? { kind: "restricted", metadata }
    : { kind: "authenticated", metadata };

/**
 * 启动自省只有一种收敛为匿名的情形：服务端确认没有有效会话（401）。
 * 400/503/500、传输失败与解码失败都是技术故障，一律按可重试失败呈现，
 * 绝不把一次故障降级成未登录。
 */
const sessionFromRestoreFailure = (error: unknown): SessionStateV1 =>
  error instanceof C09HttpError && error.error.code === "AUTHENTICATION_REQUIRED"
    ? { kind: "anonymous" }
    : { kind: "failed", error: safeHttpErrorOf(error) };

/**
 * 认证代次直接复用既有请求 revision guard：它自带的 `requestId` 递进就是代次，
 * `begin` 会取消上一次在途请求，`accept` 只对仍属当前代次的响应放行。
 * 因此迟到的恢复响应不会覆盖更新的登录、改密或重试。
 */
const AUTH_GENERATION_REVISION = INITIAL_WEB_CONTEXT_V1.revision;

const AppRoot = (): ReactNode => {
  // 入口初态是 checking：恢复完成前既不跳登录页，也不发任何业务查询。
  const [session, setSession] = useState<SessionStateV1>({ kind: "checking" });
  const [authGuard] = useState(createRequestRevisionGuard);
  const [selection] = useState(() => readProjectSelection(window.location.search));
  const initialProjectId = selection.projectIds[0] ?? null;
  const context = useMemo<WebContextV1>(
    () => ({ ...INITIAL_WEB_CONTEXT_V1, projectId: initialProjectId }),
    [initialProjectId],
  );
  const registry = useMemo(
    () =>
      createWebRouteRegistry([
        createQualityAssessmentRouteContribution({
          client,
          projectRevisionRef: projectRevisionRefFor(selection, initialProjectId),
        }),
      ]),
    [selection, initialProjectId],
  );
  /** 启动恢复与恢复重试共用同一条路径，重试同样推进认证代次。 */
  const restoreSession = useCallback((): void => {
    const token = authGuard.begin({
      revision: AUTH_GENERATION_REVISION,
      routeId: "session.restore",
    });
    setSession({ kind: "checking" });
    void client.introspectSession(token.signal).then(
      (metadata: SessionMetadataViewV1) => {
        if (authGuard.accept(token)) setSession(sessionFromMetadata(metadata));
      },
      (error: unknown) => {
        if (authGuard.accept(token)) setSession(sessionFromRestoreFailure(error));
      },
    );
  }, [authGuard]);
  useEffect(() => {
    restoreSession();
    return () => authGuard.cancel();
  }, [authGuard, restoreSession]);
  const onLogin = useCallback(
    (input: SessionLoginInputV1): void => {
      const token = authGuard.begin({
        revision: AUTH_GENERATION_REVISION,
        routeId: "session.login",
      });
      void client.login(input, token.signal).then(
        (metadata) => {
          if (authGuard.accept(token)) setSession(sessionFromMetadata(metadata));
        },
        (error: unknown) => {
          if (authGuard.accept(token))
            setSession({ kind: "failed", error: safeHttpErrorOf(error) });
        },
      );
    },
    [authGuard],
  );
  const onChangePassword = useCallback(
    (input: SessionChangePasswordInputV1): void => {
      const token = authGuard.begin({
        revision: AUTH_GENERATION_REVISION,
        routeId: "session.change-password",
      });
      void client.changePassword(input, token.signal).then(
        (metadata) => {
          if (authGuard.accept(token)) setSession(sessionFromMetadata(metadata));
        },
        (error: unknown) => {
          if (authGuard.accept(token))
            setSession({ kind: "failed", error: safeHttpErrorOf(error) });
        },
      );
    },
    [authGuard],
  );
  /**
   * `App` 的 routeContent 是唯一能把实时 `context` 交给页面的位置：工程切换后
   * 页面收到新的 projectId（子树按 context.revision 重挂），旧查询立即取消。
   */
  const routeContent = (
    resolution: Extract<WebRouteResolutionV1, { kind: "matched" }>,
    current: WebContextV1,
  ): ReactNode =>
    resolution.route.routeId === "assessment.root" ? (
      <QualityPage
        client={client}
        projectId={current.projectId}
        projectRevisionRef={projectRevisionRefFor(selection, current.projectId)}
        spatialScopeRef={current.spatialScopeRef}
      />
    ) : undefined;
  return (
    <App
      pathname={window.location.pathname}
      session={session}
      context={context}
      registry={registry}
      projectOptions={selection.projectIds.map((projectId) => ({ projectId, label: projectId }))}
      onLogin={onLogin}
      onChangePassword={onChangePassword}
      onRetrySessionRestore={restoreSession}
      routeContent={routeContent}
    />
  );
};

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Web root element is missing");
}

createRoot(root).render(<AppRoot />);
