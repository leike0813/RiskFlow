import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { ProjectRevisionRefV1 } from "@riskflow/contracts/ports";

import {
  createC09Client,
  type SessionChangePasswordInputV1,
  type SessionLoginInputV1,
  type SessionMetadataViewV1,
} from "./api/http.js";
import { App } from "./app/App.js";
import { createWebRouteRegistry, type WebRouteResolutionV1 } from "./app/routes.js";
import { INITIAL_WEB_CONTEXT_V1, type SessionStateV1, type WebContextV1 } from "./app/state.js";
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

const AppRoot = (): ReactNode => {
  const [session, setSession] = useState<SessionStateV1>({ kind: "anonymous" });
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
  const onLogin = useCallback((input: SessionLoginInputV1): void => {
    void client.login(input, new AbortController().signal).then(
      (metadata) => setSession(sessionFromMetadata(metadata)),
      (error: unknown) => setSession({ kind: "failed", error: safeHttpErrorOf(error) }),
    );
  }, []);
  const onChangePassword = useCallback((input: SessionChangePasswordInputV1): void => {
    void client.changePassword(input, new AbortController().signal).then(
      (metadata) => setSession(sessionFromMetadata(metadata)),
      (error: unknown) => setSession({ kind: "failed", error: safeHttpErrorOf(error) }),
    );
  }, []);
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
      routeContent={routeContent}
    />
  );
};

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Web root element is missing");
}

createRoot(root).render(<AppRoot />);
