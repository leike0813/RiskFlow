// 组合视图机制（指导性方案 §8.2）：拆页后跨页组合不再合并页面，
// 而是用专用组合路由把 2–3 个页面以只读、无重复事实的方式并置。
// 组合视图不属于 57 页清单，不进导航；供第 4、5 张汇报图使用，
// 组合成员对齐产品规格 §18 的截图派生点。
// 被组合页各自保持独立 URL 与页面契约；此处按 routeId 复用各域路由的
// 真实页面渲染，路由参数由被组合页的 samplePath 按路径模板解出。

import type { ReactNode } from 'react';
import { resolveRoute, type RouteContribution, type RouteRenderInput } from '../../app/routes';
import { ASSESSMENT_ROUTES } from '../assessment/routes';
import { IDENTIFICATION_ROUTES } from '../identification/routes';
import { REVIEW_ROUTES } from '../review/routes';
import { pageById } from '../manifest';
import { WARNING_ROUTES } from '../warning/routes';
import './compose.css';

// 组合视图只引用这四个域的页面；按 routeId 建渲染索引。
const DOMAIN_ROUTE_POOL: readonly RouteContribution[] = [
  ...IDENTIFICATION_ROUTES,
  ...ASSESSMENT_ROUTES,
  ...WARNING_ROUTES,
  ...REVIEW_ROUTES,
];

function realRenderByRouteId(routeId: string): (input: RouteRenderInput) => ReactNode {
  const route = DOMAIN_ROUTE_POOL.find((candidate) => candidate.routeId === routeId);
  if (!route || route.render === null) {
    throw new Error(`组合视图引用的页面 ${routeId} 没有可用的真实渲染`);
  }
  return route.render;
}

function ComposeView({
  pageIds,
  input,
}: {
  readonly pageIds: readonly string[];
  readonly input: RouteRenderInput;
}) {
  return (
    <div className="compose-grid">
      {pageIds.map((pageId) => {
        const page = pageById(pageId);
        if (!page) throw new Error(`组合视图引用了未登记的页面 ${pageId}`);
        const resolution = resolveRoute(
          DOMAIN_ROUTE_POOL.filter((route) => route.routeId === page.routeId),
          page.samplePath,
        );
        if (!resolution) throw new Error(`组合视图页面 ${pageId} 的 samplePath 无法解出参数`);
        const render = realRenderByRouteId(page.routeId);
        return (
          <section key={page.pageId} className="compose-cell" aria-label={page.title}>
            {render({
              route: resolution.route,
              params: resolution.params,
              pathname: page.samplePath,
              pageState: input.pageState,
              capabilities: input.capabilities,
            })}
          </section>
        );
      })}
    </div>
  );
}

function composeRoute(
  routeId: string,
  path: string,
  title: string,
  pageIds: readonly string[],
): RouteContribution {
  return {
    routeId,
    path,
    title,
    section: null,
    shellKind: 'custom',
    contextRequirement: 'project',
    requiredViewCapability: null,
    render: (input) => <ComposeView pageIds={pageIds} input={input} />,
  };
}

export const COMPOSE_ROUTES: readonly RouteContribution[] = [
  composeRoute(
    'compose.assessment-warning',
    '/compose/assessment-warning',
    '组合视图 · 风险评估与预警中心',
    ['P-RA-05', 'P-RA-06', 'P-WR-01'],
  ),
  composeRoute(
    'compose.trace',
    '/compose/trace',
    '组合视图 · 风险详情与证据追溯',
    ['P-RI-06', 'P-WR-04', 'P-RV-04'],
  ),
];
