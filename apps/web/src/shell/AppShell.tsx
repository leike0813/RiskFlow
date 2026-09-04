import { useEffect, type ChangeEvent, type MouseEvent, type ReactNode } from "react";

import type { ModuleCapabilityV1, SpatialScopeRefV1 } from "@riskflow/contracts/ports";

import { focusMainHeading } from "../shared/focus.js";
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
  const spatialValue =
    context.spatialScopeRef === null
      ? ""
      : `${context.spatialScopeRef.reference.entityId}:${context.spatialScopeRef.reference.versionId}`;
  return (
    <div className="context-bar" aria-label="工程上下文">
      <label>
        工程
        <select value={context.projectId ?? ""} onChange={onProjectChange}>
          <option value="">未选择工程</option>
          {projectOptions?.map((option) => (
            <option key={option.projectId} value={option.projectId}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
  if (permission !== "allowed")
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
          {permission === "unknown" ? "权限检查中" : `需要能力 ${item.requiredCapability}`}
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
  initialDockPanel,
  evidence,
  evidenceContextRevision,
  contextSummary,
  versionAuditSummary,
  relatedObjects,
  agentContribution,
}: AppShellPropsV1): ReactNode => {
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
          <button type="button" disabled aria-disabled="true">
            用户
          </button>
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
        <h1 id="main-heading" tabIndex={-1}>
          {title}
        </h1>
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
