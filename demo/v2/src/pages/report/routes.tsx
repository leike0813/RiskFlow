// 报告域路由：页面元数据经 routesForDomain('report') 取自 docs/page-manifest.json，
// 本文件只把 P-AU-01 的 render 从 PageScaffold 换成真实组件（PAGE-GUIDE §1）。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { ReportExportPage } from './ReportExportPage';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (input: RouteRenderInput) => ReactNode>
> = {
  'report.export': (input) => <ReportExportPage input={input} />,
};

export const REPORT_ROUTES = routesForDomain('report').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
