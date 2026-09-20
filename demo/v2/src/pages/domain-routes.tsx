// 域路由工厂：每个域的 routes.tsx 以 routesForDomain('<域>') 生成该域的
// RouteContribution[]。页面元数据全部来自 docs/page-manifest.json（单一事实源），
// 渲染统一走 PageScaffold；M4 逐页替换为真实页面组件时只改对应域文件。

import type { RouteContribution } from '../app/routes';
import {
  CONTEXT_BY_DOMAIN,
  SECTION_BY_DOMAIN,
  pagesByDomain,
  shellKindForSkeleton,
  type PageDomain,
} from './manifest';
import { PageScaffold } from './scaffold/PageScaffold';

export function routesForDomain(domain: PageDomain): readonly RouteContribution[] {
  return pagesByDomain(domain).map((page) => ({
    routeId: page.routeId,
    path: page.path,
    title: page.title,
    section: SECTION_BY_DOMAIN[page.domain],
    shellKind: shellKindForSkeleton(page.skeleton),
    contextRequirement: CONTEXT_BY_DOMAIN[page.domain],
    requiredViewCapability: page.capability,
    render: (input) => <PageScaffold page={page} input={input} />,
  }));
}
