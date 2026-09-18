// 运营设施域路由：页面元数据经 routesForDomain('ops') 取自 docs/page-manifest.json，
// 本文件只把五页的 render 从 PageScaffold 换成真实组件（PAGE-GUIDE §1），
// routeId / path / branch / capability 不动。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { AccessPage } from './AccessPage';
import { BackupPage } from './BackupPage';
import { DataSourcesPage } from './DataSourcesPage';
import { HealthPage } from './HealthPage';
import { ModelVersionsPage } from './ModelVersionsPage';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (input: RouteRenderInput) => ReactNode>
> = {
  'ops.access': (input) => <AccessPage input={input} />,
  'ops.data-sources': (input) => <DataSourcesPage input={input} />,
  'ops.health': (input) => <HealthPage input={input} />,
  'ops.model-versions': (input) => <ModelVersionsPage input={input} />,
  'ops.backup': (input) => <BackupPage input={input} />,
};

export const OPS_ROUTES = routesForDomain('ops').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
