// 预警域路由：页面元数据经 routesForDomain('warning') 取自 docs/page-manifest.json，
// 本文件只把四页的 render 从 PageScaffold 换成真实组件（PAGE-GUIDE §1）。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { WarningCenterPage } from './WarningCenterPage';
import { WarningDetailPage } from './WarningDetailPage';
import { WarningTaskDetailPage } from './WarningTaskDetailPage';
import { WarningTaskListPage } from './WarningTaskListPage';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (input: RouteRenderInput) => ReactNode>
> = {
  'warnings.root': (input) => <WarningCenterPage input={input} />,
  'warnings.detail': (input) => <WarningDetailPage input={input} />,
  'warnings.tasks': (input) => <WarningTaskListPage input={input} />,
  'warnings.task-detail': (input) => <WarningTaskDetailPage input={input} />,
};

export const WARNING_ROUTES = routesForDomain('warning').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
