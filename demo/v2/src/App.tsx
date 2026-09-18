// 应用入口与框架层注入：
// - URL 解析（?state / ?roles / ?gaps / ?vp / ?safearea）只发生在本文件与 review-params.ts；
// - 页面状态经 resolveFrameworkPageState 计算后经 RouteRenderInput.pageState 传给页面；
// - 角色覆盖经 contract-mirror 的 capabilitiesForRoles 推导（多选取并集，默认 project-risk-manager）；
// - /__review 为审阅控制台（内部设施），其余路径走 57 页 + 组合视图注册表。

import { useEffect, useState } from 'react';
import {
  capabilitiesForRoles,
  type PresetRole,
} from './app/contract-mirror';
import { createRouterAdapter, detectHistoryMode, type HistoryAdapter } from './app/history';
import {
  buildForcedState,
  parseReviewParams,
  resolveFrameworkPageState,
} from './app/review-params';
import { resolveRoute } from './app/routes';
import { INITIAL_CONTEXT, type ShellContext } from './app/state';
import { PAGES } from './pages/manifest';
import { BASE_ROUTES, REVIEW_CONSOLE_PATH } from './pages/routes';
import { GapsOverlay, SafeAreaOverlay, ViewportOverlay } from './review/overlays';
import { ReviewConsole } from './review/ReviewConsole';
import { AppShell, type ContextSelection } from './shell/AppShell';
import './theme/tokens.css';
import './theme/global.css';

const DEFAULT_ROLES: readonly PresetRole[] = ['project-risk-manager'];

function usePathWithQuery(adapter: HistoryAdapter): string {
  const [path, setPath] = useState(adapter.current());
  useEffect(() => adapter.subscribe(() => setPath(adapter.current())), [adapter]);
  return path;
}

const adapter = createRouterAdapter(detectHistoryMode());

export function App() {
  const currentPath = usePathWithQuery(adapter);
  const [context, setContext] = useState<ShellContext>(INITIAL_CONTEXT);

  const pathOnly = currentPath.split('?')[0];
  const review = parseReviewParams(currentPath);

  useEffect(() => {
    if (pathOnly === '/') adapter.replace('/overview');
  }, [pathOnly]);

  const roles = review.roles ?? DEFAULT_ROLES;
  const granted = review.rolesInvalid ? null : capabilitiesForRoles(roles);

  const onContextChange = (selection: ContextSelection): void => {
    setContext((current) => ({
      revision: current.revision + 1,
      projectId: selection.projectId,
      spatialScopeRef: selection.spatialScopeRef,
      processNodeId: selection.processNodeId,
    }));
  };

  const overlays = (
    <>
      {review.viewport === null ? null : <ViewportOverlay preset={review.viewport} />}
      {review.safeArea ? <SafeAreaOverlay /> : null}
    </>
  );

  if (pathOnly === REVIEW_CONSOLE_PATH) {
    return (
      <>
        <ReviewConsole
          currentPath={currentPath}
          roles={review.roles}
          rolesInvalid={review.rolesInvalid}
          viewport={review.viewport}
          safeArea={review.safeArea}
          onNavigate={(path) => adapter.navigate(path)}
        />
        {overlays}
      </>
    );
  }

  const resolution = pathOnly === '/' ? null : resolveRoute(BASE_ROUTES, pathOnly);

  if (!resolution) {
    return (
      <AppShell
        pathname={pathOnly}
        title="页面不存在"
        activeSection={null}
        capabilities={granted}
        context={context}
        onContextChange={onContextChange}
        onNavigate={(path) => adapter.navigate(path)}
      >
        <p>
          未找到路径 <code>{pathOnly}</code> 对应的路由。
        </p>
        {overlays}
      </AppShell>
    );
  }

  const { route, params } = resolution;
  const manifestPage = PAGES.find((page) => page.routeId === route.routeId) ?? null;
  const forced =
    review.state === null
      ? null
      : buildForcedState(review.state, {
          branch: manifestPage?.branch ?? null,
          capability: route.requiredViewCapability,
        });
  const pageState = resolveFrameworkPageState({
    forced,
    requiredCapability: route.requiredViewCapability,
    granted,
  });

  return (
    <AppShell
      pathname={pathOnly}
      title={route.title}
      activeSection={route.section}
      capabilities={granted}
      context={context}
      onContextChange={onContextChange}
      onNavigate={(path) => adapter.navigate(path)}
    >
      {route.render?.({ route, params, pathname: pathOnly, pageState, capabilities: granted })}
      {review.gaps ? <GapsOverlay pageId={manifestPage?.pageId ?? null} /> : null}
      {overlays}
    </AppShell>
  );
}
