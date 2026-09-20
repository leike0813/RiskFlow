// 识别域路由：页面元数据来自 docs/page-manifest.json（单一事实源），
// 经 routesForDomain('identification') 生成基础贡献；M4 起仅替换 render 为真实页面组件，
// routeId / path 不得改动。

import type { ReactNode } from 'react';
import type { RouteContribution, RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { GraphViewPage } from './GraphViewPage';
import { IdentificationTasksPage } from './IdentificationTasksPage';
import { ProcessModelViewPage } from './ProcessModelViewPage';
import { RecordDetailPage } from './RecordDetailPage';
import { RecordsPage } from './RecordsPage';
import { RunDetailPage } from './RunDetailPage';
import { StartIdentificationPage } from './StartIdentificationPage';
import './identification.css';

const RENDER_BY_ROUTE_ID: Readonly<Record<string, (input: RouteRenderInput) => ReactNode>> = {
  'identification.root': (input) => <IdentificationTasksPage input={input} />,
  'identification.start': (input) => <StartIdentificationPage input={input} />,
  'identification.run-detail': (input) => <RunDetailPage input={input} />,
  'identification.process-model': (input) => <ProcessModelViewPage input={input} />,
  'identification.records': (input) => <RecordsPage input={input} />,
  'identification.record-detail': (input) => <RecordDetailPage input={input} />,
  'identification.graph': (input) => <GraphViewPage input={input} />,
};

export const IDENTIFICATION_ROUTES: readonly RouteContribution[] = routesForDomain(
  'identification',
).map((route) => {
  const render = RENDER_BY_ROUTE_ID[route.routeId];
  return render === undefined ? route : { ...route, render };
});
