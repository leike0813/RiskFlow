// Agent 域路由：页面元数据经 routesForDomain('agent') 取自 docs/page-manifest.json，
// 本文件只把三页的 render 从 PageScaffold 换成真实组件（PAGE-GUIDE §1）。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { AgentDockPage } from './AgentDockPage';
import { AgentTaskDetailPage } from './AgentTaskDetailPage';
import { AgentWorkbenchPage } from './AgentWorkbenchPage';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (input: RouteRenderInput) => ReactNode>
> = {
  'agent.dock-panel': (input) => <AgentDockPage input={input} />,
  'agent.workbench': (input) => <AgentWorkbenchPage input={input} />,
  'agent.task-detail': (input) => <AgentTaskDetailPage input={input} />,
};

export const AGENT_ROUTES = routesForDomain('agent').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
