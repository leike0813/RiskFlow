import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";

import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

import {
  INITIAL_WEB_CONTEXT_V1,
  reduceWebContext,
  type SessionStateV1,
  type WebContextActionV1,
  type WebContextV1,
} from "./state.js";
import {
  resolveWebRoute,
  WEB_ROUTE_REGISTRY_V1,
  type WebRouteRegistryV1,
  type WebRouteResolutionV1,
} from "./routes.js";
import { AppShell, type AppShellPropsV1 } from "../shell/AppShell.js";
import type { SafeHttpErrorV1 } from "../api/errors.js";
import { safeErrorFields } from "../shared/page-shells/PageFrame.js";
import { PageFrame, type PageRegionV1 } from "../shared/page-shells/PageFrame.js";
import type { SessionChangePasswordInputV1, SessionLoginInputV1 } from "../api/http.js";
import { useAgentDockContribution } from "../agent/AgentDock.js";

export type AppPropsV1 = Readonly<{
  pathname?: string;
  session?: SessionStateV1;
  context?: WebContextV1;
  registry?: WebRouteRegistryV1;
  capabilities?: readonly ModuleCapabilityV1[];
  /** 入口能力读取的技术故障：带安全原因与重试；未就绪或无权都不走这里。 */
  capabilityFailure?:
    | Readonly<{
        error: SafeHttpErrorV1;
        retry: () => void;
      }>
    | undefined;
  projectOptions?: AppShellPropsV1["projectOptions"];
  spatialScopeOptions?: AppShellPropsV1["spatialScopeOptions"];
  processNodeOptions?: AppShellPropsV1["processNodeOptions"];
  onLogin?: (input: SessionLoginInputV1) => void;
  onChangePassword?: (input: SessionChangePasswordInputV1) => void;
  /** 恢复失败后的重试入口：重发同一条自省，不绕过既有工程门禁。 */
  onRetrySessionRestore?: () => void;
  /** 登出：宿主把真实会话终止动作交给外壳；失败由外壳呈现可重试。 */
  onLogout?: () => Promise<void>;
  routeContent?: (
    resolution: Extract<WebRouteResolutionV1, { kind: "matched" }>,
    context: WebContextV1,
  ) => ReactNode;
  initialDockPanel?: AppShellPropsV1["initialDockPanel"];
  evidence?: AppShellPropsV1["evidence"];
  evidenceContextRevision?: number;
  contextSummary?: ReactNode;
  versionAuditSummary?: ReactNode;
  relatedObjects?: ReactNode;
  agentContribution?: AppShellPropsV1["agentContribution"];
  /** 把真实工程上下文同步给宿主，供 EngineeringProvider 等上层门禁使用。 */
  onContextChange?: (context: WebContextV1) => void;
}>;

const initialPathname = (pathname: string | undefined): string => {
  if (pathname !== undefined) return pathname;
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
};

/**
 * 会话路由的回跳目标。只接受同源相对路径：`//host` 这类协议相对写法会跳到外站，
 * 一律丢弃，缺省回跳交给既有路由解析。
 */
const nextTargetOf = (): string | null => {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next");
  return next !== null && /^\/(?!\/)/.test(next) ? next : null;
};

const pathOfTarget = (target: string): string => target.split("?")[0] ?? target;

/** 只有真正的会话路由才可接管匿名/受限门禁；业务页面一律不参与。 */
const isSessionRouteV1 = (
  resolution: WebRouteResolutionV1 | undefined,
): resolution is Extract<WebRouteResolutionV1, { kind: "matched" }> =>
  resolution !== undefined &&
  resolution.kind === "matched" &&
  (resolution.route.routeId === "session.login" ||
    resolution.route.routeId === "session.change-password");

/** 已建立正式或受限会话：此时才提供登出入口。 */
const isAuthenticatedSessionV1 = (session: SessionStateV1): boolean =>
  session.kind === "authenticated" || session.kind === "restricted";

const sessionPage = (title: string, content: ReactNode): ReactNode => (
  <div className="session-page">
    <main className="app-main" aria-labelledby="main-heading">
      <h1 id="main-heading" tabIndex={-1}>
        {title}
      </h1>
      {content}
    </main>
  </div>
);

const LoginPage = ({
  onLogin,
}: {
  onLogin?: ((input: SessionLoginInputV1) => void) | undefined;
}): ReactNode => {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (onLogin === undefined) return;
    const data = new FormData(event.currentTarget);
    const loginName = String(data.get("loginName") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (loginName === "" || password === "") return;
    // 登录尝试标识按次生成：会话恢复后重新登录是常规路径，固定标识会让第二次登录
    // 被服务端判定为同一笔幂等重放而直接冲突。
    onLogin({ loginAttemptId: `web-login-${crypto.randomUUID()}`, loginName, password });
  };
  return sessionPage(
    "登录",
    <form onSubmit={submit} noValidate>
      <label>
        登录名
        <input name="loginName" autoComplete="username" required />
      </label>
      <label>
        密码
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={onLogin === undefined}>
        登录
      </button>
    </form>,
  );
};

const ChangePasswordPage = ({
  onChangePassword,
}: {
  onChangePassword?: ((input: SessionChangePasswordInputV1) => void) | undefined;
}): ReactNode => {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (onChangePassword === undefined) return;
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== "") onChangePassword({ newPassword });
  };
  return sessionPage(
    "修改密码",
    <form onSubmit={submit} noValidate>
      <label>
        新密码
        <input name="newPassword" type="password" autoComplete="new-password" required />
      </label>
      <button type="submit" disabled={onChangePassword === undefined}>
        保存
      </button>
    </form>,
  );
};

const RestrictedPage = ({
  session,
  onChangePassword,
}: {
  session: Extract<SessionStateV1, { kind: "restricted" }>;
  onChangePassword?: ((input: SessionChangePasswordInputV1) => void) | undefined;
}): ReactNode =>
  session.metadata.passwordChangeRequired ? (
    <ChangePasswordPage onChangePassword={onChangePassword} />
  ) : (
    sessionPage("访问受限", <p data-session-state="restricted">当前会话受限</p>)
  );

const sessionContent = (input: {
  session: SessionStateV1;
  sessionRoute?: Extract<WebRouteResolutionV1, { kind: "matched" }> | undefined;
  onLogin?: ((value: SessionLoginInputV1) => void) | undefined;
  onChangePassword?: ((value: SessionChangePasswordInputV1) => void) | undefined;
  onRetrySessionRestore?: (() => void) | undefined;
}): ReactNode => {
  if (input.session.kind === "checking")
    return sessionPage("正在检查会话", <p data-session-state="checking">正在检查会话</p>);
  // C37 D-17：登录只保留一份实现。注册表提供了 `session.login` renderer 时用迁移后的
  // 表单（它会 await 真实登录并按 `next` 回跳）；否则退回内联最小表单，
  // 供不注册路由的独立宿主（如 SSR 外壳测试）继续使用。
  if (input.session.kind === "anonymous")
    return isSessionRouteV1(input.sessionRoute) ? (
      // 委派给迁移后的表单，但仍由外壳标注会话状态：
      // `data-session-state` 是既有可观察契约，不能因换实现而消失。
      <div data-session-state="anonymous">
        {input.sessionRoute!.route.render!(input.sessionRoute!)}
      </div>
    ) : (
      <LoginPage onLogin={input.onLogin} />
    );
  if (input.session.kind === "restricted")
    // C37 D-17：受限会话同样委派给已注册的改密路由，避免内联与迁入页两套表单。
    return isSessionRouteV1(input.sessionRoute) &&
      input.sessionRoute.route.routeId === "session.change-password" &&
      input.sessionRoute.route.render !== null ? (
      input.sessionRoute.route.render(input.sessionRoute)
    ) : (
      <RestrictedPage session={input.session} onChangePassword={input.onChangePassword} />
    );
  if (input.session.kind === "failed")
    return sessionPage(
      "会话不可用",
      <Fragment>
        <p data-session-state="failed">{safeErrorFields(input.session.error)}</p>
        <button
          type="button"
          data-session-retry="restore"
          onClick={input.onRetrySessionRestore}
          disabled={input.onRetrySessionRestore === undefined}
        >
          重试
        </button>
      </Fragment>,
    );
  return null;
};

/**
 * 门禁骨架只占位一个 detail 区域：权限态、不可用态与工程空态不承载业务正文，
 * 因此这里不按路由登记的区域数量渲染内容——只有真实 ready 页面才组合自己的区域。
 */
const gateRegion: readonly PageRegionV1<never>[] = [
  { descriptor: { key: "gate", kind: "detail" }, content: null },
];

const UnavailableRoute = ({ title, code }: { title: string; code: string }): ReactNode => (
  <PageFrame
    title={title}
    regions={gateRegion}
    state={{ kind: "unavailable", reasons: [{ code }] }}
  />
);

const routeContentFor = (input: {
  resolution: WebRouteResolutionV1;
  context: WebContextV1;
  capabilities?: readonly ModuleCapabilityV1[] | undefined;
  routeContent?: AppPropsV1["routeContent"] | undefined;
}): ReactNode => {
  if (input.resolution.kind === "not-found")
    return <UnavailableRoute title="页面不可用" code="not-found" />;
  if (input.resolution.kind === "redirect")
    return <UnavailableRoute title="页面不可用" code="redirect-pending" />;
  const { route } = input.resolution;
  if (route.requiredViewCapability !== null) {
    if (input.capabilities === undefined)
      return (
        <PageFrame
          title={route.title}
          regions={gateRegion}
          state={{ kind: "unavailable", reasons: [{ code: "permission-checking" }] }}
        />
      );
    if (!input.capabilities.includes(route.requiredViewCapability))
      return (
        <PageFrame
          title={route.title}
          regions={gateRegion}
          state={{ kind: "forbidden", requiredCapability: route.requiredViewCapability }}
        />
      );
  }
  if (route.contextRequirement !== "none" && input.context.projectId === null)
    return <PageFrame title={route.title} regions={gateRegion} state={{ kind: "empty" }} />;
  if (route.render === null) return <UnavailableRoute title={route.title} code="route-missing" />;
  const node =
    input.routeContent?.(input.resolution, input.context) ?? route.render(input.resolution);
  // C37 D-17：注册表拥有路由元数据，React Router 负责匹配与参数。
  // 迁入页面用 `useParams()` 取 :id 之类的段参数，必须有对应的 <Route> 匹配，
  // 否则参数恒为空，页面会在发请求前就拒绝。
  return (
    <Routes>
      <Route path={route.path} element={node} />
    </Routes>
  );
};

/**
 * Router 内的应用外壳。
 *
 * C37 D-17：React Router 6 BrowserRouter 统一拥有 history。页面内 `navigate()`
 * 走 pushState，不会触发 popstate，因此 pathname 必须来自 Router 的 location，
 * 否则登录后回跳深链会因本地 pathname 过期而丢失。
 */
const RoutedApp = (props: AppPropsV1): ReactNode => {
  const routerLocation = useLocation();
  const routerNavigate = useNavigate();
  // 解析必须带上 search：旧前缀别名要保留 `?project=…`，否则深链回跳会丢工程上下文。
  return (
    <AppShellBody
      {...props}
      routerPathname={routerLocation.pathname}
      routerSearch={routerLocation.search}
      routerNavigate={routerNavigate}
    />
  );
};

/** 不在 Router 内的宿主（如 SSR 外壳测试）：保留自持 history 行为。 */
const SelfHostedApp = (props: AppPropsV1): ReactNode => <AppShellBody {...props} />;

export const App = (props: AppPropsV1 = {}): ReactNode =>
  useInRouterContext() ? <RoutedApp {...props} /> : <SelfHostedApp {...props} />;

const AppShellBody = ({
  routerPathname,
  routerSearch,
  routerNavigate,
  ...props
}: AppPropsV1 & {
  readonly routerPathname?: string;
  readonly routerSearch?: string;
  readonly routerNavigate?: (to: string, options?: { replace?: boolean }) => void;
}): ReactNode => {
  const registry = props.registry ?? WEB_ROUTE_REGISTRY_V1;
  // 停靠区的 Agent 标签由 Agent 域自己填充：共享任务 Provider 在树内时给内容槽，
  // 否则（如 SSR 外壳测试）保持「不可用」。宿主仍可用 agentContribution 覆盖。
  const defaultAgentContribution = useAgentDockContribution();
  const agentContribution = props.agentContribution ?? defaultAgentContribution;
  // C37 D-17：React Router 6 BrowserRouter 统一拥有 history。
  // 页面内 `navigate()` 走 pushState，不会触发 popstate；因此在 Router 内必须以
  // Router 的 location 为准，否则登录后回跳深链会因本地 pathname 过期而丢失。
  // 不在 Router 内（如 SSR 外壳测试）时回退到既有自持 history。
  const inRouter = routerPathname !== undefined;
  const [selfPathname, setSelfPathname] = useState(() => initialPathname(props.pathname));
  const pathname = inRouter ? routerPathname : selfPathname;
  const session: SessionStateV1 = props.session ?? { kind: "anonymous" };
  const [context, setContext] = useState<WebContextV1>(
    () => props.context ?? INITIAL_WEB_CONTEXT_V1,
  );
  const routeTarget = routerSearch === undefined ? pathname : `${pathname}${routerSearch}`;
  const resolution = useMemo(() => resolveWebRoute(routeTarget, registry), [routeTarget, registry]);
  // 只有会话门禁路由才算 sessionRoute；Agent 与系统管理虽是辅助入口（section 为 null），
  // 却是合法业务深链，登录成功后必须原样返回，不能被重定向到概览。
  const sessionRoute = isSessionRouteV1(resolution) ? resolution : undefined;
  // 匿名与受限都带原深链回跳：登录或改密完成后回到进入会话门之前的那一页。
  // 已经带着 `next` 时直接沿用，不把会话页自身再套一层。
  const currentUrl = (): string =>
    typeof window === "undefined"
      ? pathname
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const returnTarget = (): string => nextTargetOf() ?? currentUrl();
  const browserTarget =
    session.kind === "anonymous"
      ? pathname === "/login"
        ? undefined
        : `/login?next=${encodeURIComponent(returnTarget())}`
      : session.kind === "restricted" && session.metadata.passwordChangeRequired
        ? pathname === "/change-password"
          ? undefined
          : `/change-password?next=${encodeURIComponent(returnTarget())}`
        : session.kind === "authenticated"
          ? (nextTargetOf() ??
            (resolution.kind === "redirect"
              ? // 旧前缀别名等重定向要跳到它自己的目标；
                // 否则深链会被"统一回概览"吞掉。
                resolution.to
              : sessionRoute !== undefined
                ? "/overview"
                : undefined))
          : undefined;
  const effectiveResolution =
    session.kind === "authenticated" &&
    (resolution.kind === "redirect" || sessionRoute !== undefined)
      ? resolveWebRoute("/overview", registry)
      : resolution;
  useEffect(() => {
    if (props.pathname !== undefined || typeof window === "undefined" || inRouter) return undefined;
    const onPopState = (): void => setSelfPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [props.pathname]);
  useEffect(() => {
    if (
      props.pathname !== undefined ||
      typeof window === "undefined" ||
      browserTarget === undefined
    )
      return;
    if (pathname === pathOfTarget(browserTarget)) return;
    // Router 内交由 Router 推进历史，保证 location 与页面看到的 pathname 一致。
    if (inRouter) routerNavigate?.(browserTarget, { replace: true });
    else {
      window.history.replaceState({}, "", browserTarget);
      setSelfPathname(pathOfTarget(browserTarget));
    }
  }, [browserTarget, pathname, props.pathname]);
  // 登录/改密后由 `next` 回到带 `?project=` 的深链时，URL 才是工程上下文的真实来源。
  // 宿主只在挂载时读过一次 URL，之后不再同步——这会让回跳后的页面永远停在空工程。
  // 依赖整条路由目标而不只是 pathname：同一路径上换 `?project=`（浏览器前进后退、
  // 页面内 pushState）同样是真实的工程切换，漏掉它会让旧工程的在途读取与节拍继续跑。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const projectFromUrl = new URLSearchParams(window.location.search).get("project");
    if (projectFromUrl !== null && projectFromUrl !== context.projectId) {
      contextChange({ type: "project-selected", projectId: projectFromUrl });
    }
  }, [routeTarget]);

  const navigate = (routeId: string): void => {
    const target = registry.byId(routeId);
    if (target === undefined || target.path.includes(":")) return;
    if (inRouter) routerNavigate?.(target.path);
    else {
      if (typeof window !== "undefined") window.history.pushState({}, "", target.path);
      setSelfPathname(target.path);
    }
  };
  /**
   * 上下文栏是工程选择的真实来源，选完必须写回地址栏。
   * 不写回有两个后果：URL→上下文的同步（依赖整条路由目标）会在同一页上任何 search
   * 变化时把工程拽回旧值，刷新页面也退回旧工程。资料来源声明属于旧工程，一并丢掉。
   */
  const writeProjectToUrl = (projectId: string | null): void => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("project") === projectId) return;
    if (projectId === null) params.delete("project");
    else params.set("project", projectId);
    params.delete("assessmentSources");
    params.delete("revision");
    const query = params.toString();
    const target = `${window.location.pathname}${query === "" ? "" : `?${query}`}`;
    if (inRouter) routerNavigate?.(target, { replace: true });
    else window.history.replaceState({}, "", target);
  };
  const contextChange = (action: WebContextActionV1): void => {
    setContext((current) => {
      const next = reduceWebContext(current, action);
      // 宿主（main.tsx）需要在同一棵树上提供工程上下文，必须看到真实状态，
      // 否则它持有的只是一份初始快照。
      props.onContextChange?.(next);
      return next;
    });
    if (action.type === "project-selected") writeProjectToUrl(action.projectId ?? null);
  };
  if (session.kind !== "authenticated")
    return sessionContent({
      session,
      ...(sessionRoute === undefined ? {} : { sessionRoute }),
      onLogin: props.onLogin,
      onChangePassword: props.onChangePassword,
      onRetrySessionRestore: props.onRetrySessionRestore,
    });
  return (
    <AppShell
      pathname={pathname}
      route={effectiveResolution}
      registry={registry}
      context={context}
      routeContent={
        <Fragment key={`${pathname}:${context.revision}`}>
          {routeContentFor({
            resolution: effectiveResolution,
            context,
            capabilities: props.capabilities,
            routeContent: props.routeContent,
          })}
        </Fragment>
      }
      capabilities={props.capabilities}
      capabilityFailure={props.capabilityFailure}
      projectOptions={props.projectOptions}
      spatialScopeOptions={props.spatialScopeOptions}
      processNodeOptions={props.processNodeOptions}
      onNavigate={navigate}
      onContextChange={contextChange}
      onLogout={props.onLogout}
      sessionAuthenticated={isAuthenticatedSessionV1(session)}
      initialDockPanel={props.initialDockPanel}
      evidence={props.evidence}
      evidenceContextRevision={props.evidenceContextRevision}
      contextSummary={props.contextSummary}
      versionAuditSummary={props.versionAuditSummary}
      relatedObjects={props.relatedObjects}
      agentContribution={agentContribution}
    />
  );
};

export default App;
