// 57 页清单的单一事实源是 docs/page-manifest.json（check-redlines 与审阅控制台共用）。
// 本模块只做类型化访问与派生映射，不复制数据。

import data from '../../docs/page-manifest.json';
import type { ContextRequirement, NavigationId, ShellKind } from '../app/routes';
import type { SkeletonKind } from '../shell/skeletons/skeletons';

export type PageDomain =
  | 'overview'
  | 'project'
  | 'knowledge'
  | 'identification'
  | 'assessment'
  | 'warning'
  | 'response'
  | 'agent'
  | 'review'
  | 'report'
  | 'ops';

export interface PageManifestEntry {
  readonly pageId: string;
  readonly routeId: string;
  readonly path: string;
  readonly samplePath: string;
  readonly title: string;
  readonly domain: PageDomain;
  readonly skeleton: SkeletonKind;
  readonly change: string;
  /** 数据来源 branch（53 个取值之一）；设施域（ops）页面无业务 branch，为 null。 */
  readonly branch: string | null;
  /** 页面级查看能力位（29 个取值之一）；无门控页面为 null。 */
  readonly capability: string | null;
}

export const PAGES: readonly PageManifestEntry[] = data.pages as readonly PageManifestEntry[];

export const DOMAIN_LABELS: Readonly<Record<PageDomain, string>> = {
  overview: '风险态势',
  project: '工程项目',
  knowledge: '知识与规则',
  identification: '风险识别',
  assessment: '风险评估',
  warning: '预警处置',
  response: '处置建议',
  agent: 'Agent',
  review: '复核与审计',
  report: '报告',
  ops: '运营设施',
};

export const SECTION_BY_DOMAIN: Readonly<Record<PageDomain, NavigationId | null>> = {
  overview: 'overview',
  project: 'projects',
  knowledge: 'knowledge',
  identification: 'identification',
  assessment: 'assessment',
  warning: 'warnings',
  response: 'warnings',
  agent: null,
  review: 'review-audit',
  report: null,
  ops: null,
};

export const CONTEXT_BY_DOMAIN: Readonly<Record<PageDomain, ContextRequirement>> = {
  overview: 'project',
  project: 'project',
  knowledge: 'project',
  identification: 'project',
  assessment: 'project',
  warning: 'project',
  response: 'project',
  agent: 'project',
  review: 'project',
  report: 'project',
  ops: 'none',
};

const SHELL_KIND_BY_SKELETON: Readonly<Record<SkeletonKind, ShellKind>> = {
  A: 'list',
  B: 'detail',
  C: 'run',
  D: 'governance',
  E: 'review',
  AG: 'custom',
  'A+C': 'list',
  'A+B': 'list',
};

export function shellKindForSkeleton(skeleton: SkeletonKind): ShellKind {
  return SHELL_KIND_BY_SKELETON[skeleton];
}

export function pagesByDomain(domain: PageDomain): readonly PageManifestEntry[] {
  return PAGES.filter((page) => page.domain === domain);
}

export function pageById(pageId: string): PageManifestEntry | undefined {
  return PAGES.find((page) => page.pageId === pageId);
}
