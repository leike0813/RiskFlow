import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

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
import { safeErrorFields } from "../shared/page-shells/PageFrame.js";
import { PageFrame } from "../shared/page-shells/PageFrame.js";
import type { SessionChangePasswordInputV1, SessionLoginInputV1 } from "../api/http.js";

export type AppPropsV1 = Readonly<{
  pathname?: string;
  session?: SessionStateV1;
  context?: WebContextV1;
  registry?: WebRouteRegistryV1;
  capabilities?: readonly ModuleCapabilityV1[];
  projectOptions?: AppShellPropsV1["projectOptions"];
  spatialScopeOptions?: AppShellPropsV1["spatialScopeOptions"];
  processNodeOptions?: AppShellPropsV1["processNodeOptions"];
  onLogin?: (input: SessionLoginInputV1) => void;
  onChangePassword?: (input: SessionChangePasswordInputV1) => void;
  /** 恢复失败后的重试入口：重发同一条自省，不绕过既有工程门禁。 */
  onRetrySessionRestore?: () => void;
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
  onLogin?: ((value: SessionLoginInputV1) => void) | undefined;
  onChangePassword?: ((value: SessionChangePasswordInputV1) => void) | undefined;
  onRetrySessionRestore?: (() => void) | undefined;
}): ReactNode => {
  if (input.session.kind === "checking")
    return sessionPage("正在检查会话", <p data-session-state="checking">正在检查会话</p>);
  if (input.session.kind === "anonymous") return <LoginPage onLogin={input.onLogin} />;
  if (input.session.kind === "restricted")
    return <RestrictedPage session={input.session} onChangePassword={input.onChangePassword} />;
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

const shellVariant = (
  kind: "list" | "detail" | "run" | "governance" | "review" | "custom",
): "list" | "detail" | "run" | "governance" | "review" => (kind === "custom" ? "detail" : kind);

const UnavailableRoute = ({ title, code }: { title: string; code: string }): ReactNode => (
  <PageFrame title={title} variant="detail" state={{ kind: "unavailable", reasons: [{ code }] }} />
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
          variant={shellVariant(route.shellKind)}
          state={{ kind: "unavailable", reasons: [{ code: "permission-checking" }] }}
        />
      );
    if (!input.capabilities.includes(route.requiredViewCapability))
      return (
        <PageFrame
          title={route.title}
          variant={shellVariant(route.shellKind)}
          state={{ kind: "forbidden", requiredCapability: route.requiredViewCapability }}
        />
      );
  }
  if (route.contextRequirement !== "none" && input.context.projectId === null)
    return (
      <PageFrame
        title={route.title}
        variant={shellVariant(route.shellKind)}
        state={{ kind: "empty" }}
      />
    );
  if (route.render === null) return <UnavailableRoute title={route.title} code="route-missing" />;
  return input.routeContent?.(input.resolution, input.context) ?? route.render(input.resolution);
};

export const App = (props: AppPropsV1 = {}): ReactNode => {
  const registry = props.registry ?? WEB_ROUTE_REGISTRY_V1;
  const [pathname, setPathname] = useState(() => initialPathname(props.pathname));
  const session: SessionStateV1 = props.session ?? { kind: "anonymous" };
  const [context, setContext] = useState<WebContextV1>(
    () => props.context ?? INITIAL_WEB_CONTEXT_V1,
  );
  const resolution = useMemo(() => resolveWebRoute(pathname, registry), [pathname, registry]);
  const sessionRoute =
    resolution.kind === "matched" && resolution.route.section === null ? resolution : undefined;
  // 匿名与受限都带原深链回跳：登录或改密完成后回到进入会话门之前的那一页。
  // 已经带着 `next` 时直接沿用，不把会话页自身再套一层。
  const currentUrl = (): string =>
    typeof window === "undefined"
      ? pathname
      : `${window.location.pathname}${window.location.search}`;
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
            (resolution.kind === "redirect" || sessionRoute !== undefined
              ? "/overview"
              : undefined))
          : undefined;
  const effectiveResolution =
    session.kind === "authenticated" &&
    (resolution.kind === "redirect" || sessionRoute !== undefined)
      ? resolveWebRoute("/overview", registry)
      : resolution;
  useEffect(() => {
    if (props.pathname !== undefined || typeof window === "undefined") return undefined;
    const onPopState = (): void => setPathname(window.location.pathname);
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
    window.history.replaceState({}, "", browserTarget);
    setPathname(pathOfTarget(browserTarget));
  }, [browserTarget, pathname, props.pathname]);
  const navigate = (routeId: string): void => {
    const target = registry.byId(routeId);
    if (target === undefined || target.path.includes(":")) return;
    if (typeof window !== "undefined") window.history.pushState({}, "", target.path);
    setPathname(target.path);
  };
  const contextChange = (action: WebContextActionV1): void => {
    setContext((current) => reduceWebContext(current, action));
  };
  if (session.kind !== "authenticated")
    return sessionContent({
      session,
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
      projectOptions={props.projectOptions}
      spatialScopeOptions={props.spatialScopeOptions}
      processNodeOptions={props.processNodeOptions}
      onNavigate={navigate}
      onContextChange={contextChange}
      initialDockPanel={props.initialDockPanel}
      evidence={props.evidence}
      evidenceContextRevision={props.evidenceContextRevision}
      contextSummary={props.contextSummary}
      versionAuditSummary={props.versionAuditSummary}
      relatedObjects={props.relatedObjects}
      agentContribution={props.agentContribution}
    />
  );
};

export default App;
