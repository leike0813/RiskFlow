// 知识域路由：页面元数据仍取自 docs/page-manifest.json（单一事实源），
// 在 routesForDomain('knowledge') 生成的路由上把 render 从 PageScaffold
// 替换为各页真实实现（M4 knowledge 批次），routeId / path 不动。

import type { ReactNode } from 'react';
import type { RouteContribution, RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { pagesByDomain, type PageManifestEntry } from '../manifest';
import {
  CasesPage,
  IndicatorSystemsPage,
  MeasuresPage,
  MechanismLibraryPage,
  ProcessModelsPage,
  RiskMatricesPage,
  RuleSetsPage,
  StandardsPage,
} from './pages';
import './knowledge.css';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (page: PageManifestEntry, input: RouteRenderInput) => ReactNode>
> = {
  'knowledge.mechanisms': (page, input) => <MechanismLibraryPage page={page} input={input} />,
  'knowledge.process-models': (page, input) => <ProcessModelsPage page={page} input={input} />,
  'knowledge.standards': (page, input) => <StandardsPage page={page} input={input} />,
  'knowledge.cases': (page, input) => <CasesPage page={page} input={input} />,
  'knowledge.indicator-systems': (page, input) => (
    <IndicatorSystemsPage page={page} input={input} />
  ),
  'knowledge.rule-sets': (page, input) => <RuleSetsPage page={page} input={input} />,
  'knowledge.risk-matrices': (page, input) => <RiskMatricesPage page={page} input={input} />,
  'knowledge.measures': (page, input) => <MeasuresPage page={page} input={input} />,
};

const PAGES = routesForDomain('knowledge');
const PAGE_META = pagesByDomain('knowledge');

export const KNOWLEDGE_ROUTES: readonly RouteContribution[] = PAGES.map((route) => {
  const page = PAGE_META.find((entry) => entry.routeId === route.routeId);
  const render = RENDER_BY_ROUTE_ID[route.routeId];
  if (page === undefined || render === undefined) return route;
  return { ...route, render: (input) => render(page, input) };
});
