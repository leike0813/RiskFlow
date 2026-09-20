// 风险态势域路由：页面元数据经 routesForDomain('overview') 取自 docs/page-manifest.json，
// 本文件只把 P-OV-01 的 render 从 PageScaffold 换成真实组件（PAGE-GUIDE §1）。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { OverviewPage } from './OverviewPage';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (input: RouteRenderInput) => ReactNode>
> = {
  'overview.root': (input) => <OverviewPage input={input} />,
};

export const OVERVIEW_ROUTES = routesForDomain('overview').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
