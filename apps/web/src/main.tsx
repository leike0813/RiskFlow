import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import type { ProjectRevisionRefV1 } from "@riskflow/contracts/ports";

import {
  C09HttpError,
  createC09Client,
  makeSafeHttpError,
  type SessionChangePasswordInputV1,
  type SessionLoginInputV1,
  type SessionMetadataViewV1,
} from "./api/http.js";
import {
  EngineeringProvider,
  engineeringContextValueFrom,
  type EngineeringContextReadViewV1,
  type EngineeringPageState,
} from "./api/engineering.js";
import { readEngineeringContext } from "./api/operations.js";
import { selectorFromSearch } from "./api/context.js";
import { SessionProvider } from "./api/session.js";
import { AgentTaskProvider } from "./agent/AgentTaskProvider.js";
import { EvidenceProvider } from "./components/EvidenceDrawer.js";
import { App } from "./app/App.js";
import type { WebRouteResolutionV1 } from "./app/routes.js";
import { createBusinessRouteRegistryV1 } from "./app/business-routes.js";
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
  // 宿主持有的工程上下文镜像：初值来自 URL，之后由 App 的真实 reducer 驱动。
  // 它不是第二套状态——每次变更都由 App 算出后回传，二者始终一致。
  const [webContext, setWebContext] = useState<WebContextV1>(() => ({
    ...INITIAL_WEB_CONTEXT_V1,
    projectId: initialProjectId,
  }));
  // C37：完整业务界面注册表 = 全部 C32–C36 页面路由 + 质量页二级入口。
  // 页面按需加载；会话、工程上下文与确认仍由既有 Web 宿主唯一拥有。
  const registry = useMemo(
    () =>
      createBusinessRouteRegistryV1([
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
    resolution.route.routeId === "assessment.quality" ? (
      <QualityPage
        client={client}
        projectId={current.projectId}
        projectRevisionRef={projectRevisionRefFor(selection, current.projectId)}
        spatialScopeRef={current.spatialScopeRef}
      />
    ) : undefined;
  /**
   * 这里不再下发 pathname：`App` 自带 popstate 监听与会话跳转（匿名 → 带 `next` 的
   * 登录页、受限 → 带 `next` 的改密页），把 pathname 钉死会让这些跳转永不生效，
   * 原深链也就无法在登录或改密完成后被送回。
   */
  // 会话上下文是 AppRoot 状态的派生视图，不持有第二份会话状态。
  const sessionContextValue = useMemo(
    () => ({
      state: session,
      // 登录必须等到会话真正建立才返回：页面随后才可能跳回原深链。
      // 这里直接走唯一 C09 客户端，成功后再触发一次会话自省。
      login: async (loginName: string, password: string) => {
        await client.login(
          { loginAttemptId: `web-login-${Date.now().toString(36)}`, loginName, password },
          new AbortController().signal,
        );
        restoreSession();
        return true;
      },
      changePassword: async (newPassword: string) => {
        await client.changePassword({ newPassword }, new AbortController().signal);
        restoreSession();
        return true;
      },
      logout: async () => {
        await client.logout(new AbortController().signal);
        return true;
      },
      retryRestore: restoreSession,
      metadata:
        session.kind === "authenticated" || session.kind === "restricted" ? session.metadata : null,
    }),
    [session, onLogin, onChangePassword, restoreSession],
  );

  return (
    <SessionProvider value={sessionContextValue}>
      {/*
        Router 必须包住整棵业务树：证据抽屉（`EvidenceProvider` 的兄弟层）里的资料详情
        深链是真实 `<Link>`，放在 Router 外会解构到 null 的路由上下文并整页崩掉。
      */}
      <BrowserRouter>
        <EngineeringGate context={webContext} canReadBusiness={session.kind === "authenticated"}>
          <App
            session={session}
            context={webContext}
            registry={registry}
            projectOptions={selection.projectIds.map((projectId) => ({
              projectId,
              label: projectId,
            }))}
            onLogin={onLogin}
            onChangePassword={onChangePassword}
            onRetrySessionRestore={restoreSession}
            onContextChange={setWebContext}
            onLogout={async () => {
              // 注销失败必须抛出：外壳据此保留会话并提供重试。
              await client.logout(new AbortController().signal);
              restoreSession();
            }}
            routeContent={routeContent}
          />
        </EngineeringGate>
      </BrowserRouter>
    </SessionProvider>
  );
};

/**
 * 工程上下文门禁。
 *
 * 工程 context-read 必须在 Provider 内部发起：页面与本页共用同一读取与取消语义，
 * 因此把「查询 + 提供」收进一个组件，而不是在 AppRoot 里先查询再包 Provider。
 */
const EngineeringGate = ({
  context,
  canReadBusiness,
  children,
}: {
  readonly context: WebContextV1;
  /** 只有正式会话才允许发起业务读；受限/改密前不得有任何业务查询。 */
  readonly canReadBusiness: boolean;
  readonly children: ReactNode;
}): ReactNode => {
  // 工程 context-read 直接由 URL 选择器驱动：它自己就是 Provider 的生产者，
  // 不能再经 usePageQuery（那会反过来要求已存在的 Provider）。
  // 工程来源有两条：URL 自带的 `?project=`，以及用户在上下文栏按标识直接进入。
  // 两条都要驱动同一次 context-read；只看 URL 会让「按标识进入」后页面永远停在引导态。
  // 选择器只看 `?project=`：资料来源声明改了工程也没变，不订阅 popstate 就永远停在旧声明上。
  const [search, setSearch] = useState(() =>
    typeof window === "undefined" ? "" : window.location.search,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPopState = (): void => setSearch(window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const selector = useMemo(() => {
    const fromUrl = selectorFromSearch(search);
    const projectId = context.projectId ?? fromUrl.projectId;
    return {
      ...fromUrl,
      projectId,
      revisionId: context.projectId === null ? fromUrl.revisionId : null,
    };
  }, [context.projectId, search]);
  const [state, setState] = useState<EngineeringPageState<EngineeringContextReadViewV1>>({
    kind: "idle",
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (selector.projectId === null || !canReadBusiness) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading", previous: null });
    void readEngineeringContext(selector.projectId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ kind: "ready", value });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const code = error instanceof C09HttpError ? error.error.code : "TERMINAL_FAILURE";
        setState(
          code === "NOT_FOUND" || code === "AUTHENTICATION_REQUIRED"
            ? { kind: "forbidden", requiredCapability: "engineering-data.read" }
            : { kind: "error", error: makeSafeHttpError({ code, retryable: false }) },
        );
      },
    );
    return () => controller.abort();
  }, [selector.projectId, selector.revisionId, canReadBusiness, tick]);

  const value = useMemo(
    () =>
      engineeringContextValueFrom(context, () => setTick((current) => current + 1), state, search),
    [context, state, search],
  );
  // Agent 任务上下文：切工程即中止在途并停止刷新，服务器继续拥有任务事实。
  // 工程标识只有在 context-read 确认该工程可读时才交给 Provider：工程读失败（无权或
  // 不存在）后继续按标识轮询，等于对一份服务端从未确认的工程反复发读。
  return (
    <EngineeringProvider value={value}>
      <AgentTaskProvider
        {...(state.kind === "ready" && selector.projectId !== null
          ? { projectId: selector.projectId }
          : {})}
      >
        {/* 证据抽屉是迁入页面的共享入口：由 Provider 统一持有当前定位目标。 */}
        <EvidenceProvider>{children}</EvidenceProvider>
      </AgentTaskProvider>
    </EngineeringProvider>
  );
};

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Web root element is missing");
}

createRoot(root).render(<AppRoot />);
