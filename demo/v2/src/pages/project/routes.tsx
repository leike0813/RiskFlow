// project 域路由：页面元数据来自 docs/page-manifest.json（routesForDomain 生成），
// 本文件仅把各页的 render 从脚手架替换为真实组件，routeId / path 不变。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { ProjectIngestionTasksPage } from './ProjectIngestionTasksPage';
import { ProjectMembersPage } from './ProjectMembersPage';
import { ProjectMonitoringDetailPage } from './ProjectMonitoringDetailPage';
import { ProjectMonitoringPage } from './ProjectMonitoringPage';
import { ProjectOpeningPage } from './ProjectOpeningPage';
import { ProjectOverviewPage } from './ProjectOverviewPage';
import { ProjectSourceDetailPage } from './ProjectSourceDetailPage';
import { ProjectSourceRegisterPage } from './ProjectSourceRegisterPage';
import { ProjectSourcesPage } from './ProjectSourcesPage';
import { ProjectSpatialScopesPage } from './ProjectSpatialScopesPage';

const RENDER_BY_ROUTE_ID: Readonly<Record<string, (input: RouteRenderInput) => ReactNode>> = {
  'projects.root': (input) => <ProjectOverviewPage input={input} />,
  'projects.opening': (input) => <ProjectOpeningPage input={input} />,
  'projects.spatial-scopes': (input) => <ProjectSpatialScopesPage input={input} />,
  'projects.members': (input) => <ProjectMembersPage input={input} />,
  'projects.sources': (input) => <ProjectSourcesPage input={input} />,
  'projects.source-register': (input) => <ProjectSourceRegisterPage input={input} />,
  'projects.source-detail': (input) => <ProjectSourceDetailPage input={input} />,
  'projects.ingestion-tasks': (input) => <ProjectIngestionTasksPage input={input} />,
  'projects.monitoring': (input) => <ProjectMonitoringPage input={input} />,
  'projects.monitoring-detail': (input) => <ProjectMonitoringDetailPage input={input} />,
};

export const PROJECT_ROUTES = routesForDomain('project').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
