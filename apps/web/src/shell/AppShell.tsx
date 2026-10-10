import { useEffect, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";

import type { ModuleCapabilityV1, SpatialScopeRefV1 } from "@riskflow/contracts/ports";

import { focusMainHeading } from "../shared/focus.js";
import { useEngineeringOptional } from "../api/engineering.js";
import { readAssessmentSourceSelection } from "../api/client.js";
import { selectorFromSearch } from "../api/context.js";
import type { WebContextActionV1, WebContextV1 } from "../app/state.js";
import { routePathFor, type WebRouteRegistryV1, type WebRouteResolutionV1 } from "../app/routes.js";
import {
  navigationPermission,
  WEB_NAVIGATION_V1,
  type NavigationPermissionStateV1,
} from "./navigation.js";
import {
  RightDock,
  type AgentContributionV1,
  type DockPanelV1,
  type EvidenceDockContentV1,
} from "./dock/RightDock.js";
import "./AppShell.css";

export type WebProjectOptionV1 = Readonly<{ projectId: string; label: string }>;
export type WebSpatialScopeOptionV1 = Readonly<{ ref: SpatialScopeRefV1; label: string }>;
export type WebProcessNodeOptionV1 = Readonly<{ processNodeId: string; label: string }>;

export type AppShellPropsV1 = Readonly<{
  pathname: string;
  route: WebRouteResolutionV1;
  registry: WebRouteRegistryV1;
  context: WebContextV1;
  routeContent?: ReactNode | undefined;
  capabilities?: readonly ModuleCapabilityV1[] | undefined;
  projectOptions?: readonly WebProjectOptionV1[] | undefined;
  spatialScopeOptions?: readonly WebSpatialScopeOptionV1[] | undefined;
  processNodeOptions?: readonly WebProcessNodeOptionV1[] | undefined;
  onNavigate?: ((routeId: string) => void) | undefined;
  onContextChange?: ((action: WebContextActionV1) => void) | undefined;
  /**
   * 登出：唯一的会话终止动作。
   * 没有它用户无法结束会话——这是宿主必须提供的真实能力，不是可选装饰。
   */
  /**
   * 登出：唯一的会话终止动作。
   * 返回 Promise 让外壳据此表达「进行中」与「失败可重试」——
   * 用户必须能看见注销失败并重试，而不是被静默留在原状态。
   */
  onLogout?: (() => Promise<void>) | undefined;
  /** 是否已建立正式会话；未认证时不渲染登出入口。 */
  sessionAuthenticated?: boolean;
  initialDockPanel?: DockPanelV1 | undefined;
  evidence?: EvidenceDockContentV1 | undefined;
  evidenceContextRevision?: number | undefined;
  contextSummary?: ReactNode | undefined;
  versionAuditSummary?: ReactNode | undefined;
  relatedObjects?: ReactNode | undefined;
  agentContribution?: AgentContributionV1 | undefined;
}>;

const routeTitle = (route: WebRouteResolutionV1): string =>
  route.kind === "matched"
    ? route.route.title
    : route.kind === "redirect"
      ? "风险态势"
      : "页面不可用";

const navigateClick = (
  event: MouseEvent<HTMLAnchorElement>,
  routeId: string,
  onNavigate: ((routeId: string) => void) | undefined,
): void => {
  if (
    onNavigate === undefined ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  onNavigate(routeId);
};

/**
 * 资料来源由用户声明（design D-07）：触达资料正文的查询必须带上用户选定的来源版本，
 * 宿主不代选、不猜最新版本。声明落在地址栏的 `assessmentSources` 上——那是页面发起
 * 读取时唯一读它的地方；工程内跳转由 `projectPathWithSelector` 原样带过去。
 */
const AssessmentSourcePicker = ({
  projectId,
}: {
  readonly projectId: string | null;
}): ReactNode => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setEditing(false);
    setInvalid(false);
  }, [projectId]);
  if (projectId === null) return null;
  // 宿主外壳参与 SSR，渲染期没有 window；服务端一律按「未声明来源」出首屏，
  // 客户端接管后再按真实地址栏收口。
  const search = typeof window === "undefined" ? "" : window.location.search;
  const selection = readAssessmentSourceSelection(search);
  if (!editing)
    return (
      <button
        type="button"
        className="context-apply"
        onClick={() => {
          setDraft(selection === null ? "" : JSON.stringify(selection.refs));
          setEditing(true);
        }}
      >
        {selection === null ? "资料来源：未选择" : `资料来源：${selection.refs.length} 个版本`}
      </button>
    );
  return (
    <form
      className="context-source-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new URLSearchParams(window.location.search);
        next.set("project", projectId);
        if (draft.trim() === "") next.delete("assessmentSources");
        else {
          try {
            next.set(
              "assessmentSources",
              JSON.stringify({
                projectId,
                revisionId: selectorFromSearch(window.location.search).revisionId,
                refs: JSON.parse(draft),
              }),
            );
          } catch {
            setInvalid(true);
            return;
          }
          // 声明要能被读取侧原样认回：解析不回来就说明这份引用不完整，不许提交。
          if (readAssessmentSourceSelection(`?${next.toString()}`) === null) {
            setInvalid(true);
            return;
          }
        }
        window.history.pushState({}, "", `${window.location.pathname}?${next.toString()}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
        setEditing(false);
        setInvalid(false);
      }}
    >
      <input
        aria-label="资料来源版本"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder='[{"entityId":"资料版本标识","versionId":"版本"}]'
        aria-invalid={invalid}
      />
      <button type="submit" className="context-apply">
        应用来源
      </button>
      <button type="button" className="context-apply" onClick={() => setEditing(false)}>
        取消
      </button>
      {invalid && <span role="alert">请填写 1～256 个完整来源版本引用</span>}
    </form>
  );
};

const ContextSelectors = ({
  context,
  projectOptions,
  spatialScopeOptions,
  processNodeOptions,
  onContextChange,
}: Pick<
  AppShellPropsV1,
  "context" | "projectOptions" | "spatialScopeOptions" | "processNodeOptions" | "onContextChange"
>): ReactNode => {
  const onProjectChange = (event: ChangeEvent<HTMLSelectElement>): void =>
    onContextChange?.({ type: "project-selected", projectId: event.currentTarget.value || null });
  const onSpatialChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const option = spatialScopeOptions?.find(
      (item) =>
        `${item.ref.reference.entityId}:${item.ref.reference.versionId}` ===
        event.currentTarget.value,
    );
    onContextChange?.({ type: "spatial-scope-selected", spatialScopeRef: option?.ref ?? null });
  };
  const onProcessChange = (event: ChangeEvent<HTMLSelectElement>): void =>
    onContextChange?.({
      type: "process-node-selected",
      processNodeId: event.currentTarget.value || null,
    });
  const [projectIdDraft, setProjectIdDraft] = useState("");
  // 工程 context-read 的真实结果由门禁注入；外壳据此说明当前工程可不可读，
  // 不从每条业务读的失败反推，也不因无权而谎称工程存在或不存在。
  const engineering = useEngineeringOptional();
  const engineeringStatus =
    engineering === null
      ? null
      : engineering.state.kind === "forbidden"
        ? "无权访问该工程"
        : engineering.state.kind === "error"
          ? "工程上下文读取失败"
          : engineering.state.kind === "loading"
            ? "上下文加载中…"
            : null;
  const visibleProjects =
    context.projectId === null ||
    projectOptions?.some((option) => option.projectId === context.projectId) === true
      ? projectOptions
      : [{ projectId: context.projectId, label: context.projectId }, ...(projectOptions ?? [])];
  const spatialValue =
    context.spatialScopeRef === null
      ? ""
      : `${context.spatialScopeRef.reference.entityId}:${context.spatialScopeRef.reference.versionId}`;
  const applyProjectId = (projectId: string): void => {
    const trimmed = projectId.trim();
    if (trimmed === "") return;
    onContextChange?.({ type: "project-selected", projectId: trimmed });
  };

  return (
    <div className="context-bar" aria-label="工程上下文">
      <label>
        工程
        <select value={context.projectId ?? ""} onChange={onProjectChange}>
          <option value="">未选择工程</option>
          {/*
            当前工程必须始终出现在选项里：它可能来自「工程标识」入口而不是 URL，
            此时不在 projectOptions 中。缺了这一条，下拉会显示「未选择工程」
            而上下文其实已切换，界面就在说假话。
          */}
          {(visibleProjects ?? []).map((option) => (
            <option key={option.projectId} value={option.projectId}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {/*
        工程目录没有只读分支（授权按工程收敛，服务端不提供全量枚举），
        下拉只能选「当前 URL 已带入」的工程。这里提供按标识直接进入工程的入口，
        否则用户无法从空上下文进入任何工程；权限仍由每次业务读在服务端判定。
      */}
      <label>
        工程标识
        <input
          name="projectId"
          value={projectIdDraft}
          onChange={(event) => setProjectIdDraft(event.currentTarget.value)}
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        className="context-apply"
        onClick={() => applyProjectId(projectIdDraft)}
      >
        确定
      </button>
      <label>
        空间区段
        <select
          value={spatialValue}
          onChange={onSpatialChange}
          disabled={context.projectId === null}
        >
          <option value="">未选择空间区段</option>
          {spatialScopeOptions?.map((option) => (
            <option
              key={`${option.ref.reference.entityId}:${option.ref.reference.versionId}`}
              value={`${option.ref.reference.entityId}:${option.ref.reference.versionId}`}
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        工序节点
        <select
          value={context.processNodeId ?? ""}
          onChange={onProcessChange}
          disabled={context.projectId === null}
        >
          <option value="">未选择工序节点</option>
          {processNodeOptions?.map((option) => (
            <option key={option.processNodeId} value={option.processNodeId}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <AssessmentSourcePicker projectId={context.projectId} />
      {engineeringStatus !== null ? (
        <span className="context-status" role="status">
          {engineeringStatus}
        </span>
      ) : null}
    </div>
  );
};

const NavigationItem = ({
  item,
  permission,
  active,
  registry,
  onNavigate,
}: {
  item: (typeof WEB_NAVIGATION_V1)[number];
  permission: NavigationPermissionStateV1;
  active: boolean;
  registry: WebRouteRegistryV1;
  onNavigate?: ((routeId: string) => void) | undefined;
}): ReactNode => {
  const path = routePathFor(item.routeId, registry) ?? item.path;
  // C37 D-17：会话自省不返回能力清单，客户端无从判断。`unknown` 不能渲染成
  // 永久的「权限检查中」——那是界面在说一件永远不成立的话。能力未知时保持可点击，
  // 真正的无权由每条业务读在服务端判定并以 forbidden 状态呈现。
  if (permission === "denied")
    return (
      <>
        <span
          role="link"
          aria-disabled="true"
          tabIndex={0}
          data-navigation={item.id}
          data-navigation-state={permission}
          aria-describedby={`${item.id}-navigation-reason`}
        >
          {item.label}
        </span>
        <span id={`${item.id}-navigation-reason`} className="visually-hidden">
          需要能力 {item.requiredCapability}
        </span>
      </>
    );
  return (
    <a
      href={path}
      aria-current={active ? "page" : undefined}
      data-navigation={item.id}
      onClick={(event) => navigateClick(event, item.routeId, onNavigate)}
    >
      {item.label}
    </a>
  );
};

export const AppShell = ({
  pathname,
  route,
  registry,
  context,
  routeContent,
  capabilities,
  projectOptions,
  spatialScopeOptions,
  processNodeOptions,
  onNavigate,
  onContextChange,
  onLogout,
  sessionAuthenticated,
  initialDockPanel,
  evidence,
  evidenceContextRevision,
  contextSummary,
  versionAuditSummary,
  relatedObjects,
  agentContribution,
}: AppShellPropsV1): ReactNode => {
  // 注销生命周期：进行中禁止重复提交；失败保持现有会话并提供重试。
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const logoutClick = (): void => {
    if (onLogout === undefined || logoutPending) return;
    setLogoutPending(true);
    setLogoutFailed(false);
    void onLogout().then(
      () => setLogoutPending(false),
      () => {
        setLogoutPending(false);
        setLogoutFailed(true);
      },
    );
  };
  useEffect(() => {
    focusMainHeading();
  }, [pathname, context.revision]);
  const activeSection = route.kind === "matched" ? route.route.section : null;
  const title = routeTitle(route);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <header className="app-header">
        <p className="app-header-title">RiskFlow</p>
        <div className="app-header-meta" aria-label="用户入口">
          <span>风险管理</span>
          <button type="button" disabled aria-disabled="true">
            通知
          </button>
          {onLogout === undefined || sessionAuthenticated !== true ? null : (
            <>
              <button
                type="button"
                onClick={logoutClick}
                // 注销进行中不允许重复提交：重复点击会产生并发注销。
                disabled={logoutPending}
                aria-busy={logoutPending}
              >
                登出
              </button>
              {logoutFailed ? (
                <button type="button" onClick={logoutClick} disabled={logoutPending}>
                  重试登出
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>
      <nav className="app-nav" aria-label="业务导航">
        <ul>
          {WEB_NAVIGATION_V1.map((item) => (
            <li key={item.id}>
              <NavigationItem
                item={item}
                permission={navigationPermission(item, capabilities)}
                active={activeSection === item.id}
                registry={registry}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>
      <main id="main-content" className="app-main" aria-labelledby="main-heading">
        {/*
          C37 D-17：页面标题由业务页面自己的 `<h1>` 承担，这里只保留跳转目标与
          可读标题文本。若外壳再出一个 h1，同页会出现两个一级标题，既破坏文档大纲，
          也让按 level=1 定位标题的验收变得不唯一。
        */}
        <p id="main-heading" className="app-main-title" tabIndex={-1}>
          {title}
        </p>
        <ContextSelectors
          context={context}
          projectOptions={projectOptions}
          spatialScopeOptions={spatialScopeOptions}
          processNodeOptions={processNodeOptions}
          onContextChange={onContextChange}
        />
        <p className="visually-hidden" role="status" aria-live="polite">
          {title}
        </p>
        {routeContent}
      </main>
      <RightDock
        initialPanel={initialDockPanel}
        evidence={evidence}
        evidenceContextRevision={evidenceContextRevision}
        contextRevision={context.revision}
        contextSummary={contextSummary}
        versionAuditSummary={versionAuditSummary}
        relatedObjects={relatedObjects}
        agentContribution={agentContribution}
      />
    </div>
  );
};
