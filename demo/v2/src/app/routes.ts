// 路由注册表，形状对齐 apps/web/src/app/routes.ts:43-52 的 WebRouteContributionV1。
// 57 页注册按域分模块（pages/<域>/routes.ts），在此汇总。

import type { ReactNode } from 'react';
import type { PageLoadState } from './state';

export type ShellKind = 'list' | 'detail' | 'run' | 'governance' | 'review' | 'custom';
export type ContextRequirement = 'none' | 'project' | 'spatial' | 'process';
export type NavigationId =
  | 'overview'
  | 'projects'
  | 'identification'
  | 'assessment'
  | 'warnings'
  | 'knowledge'
  | 'review-audit';

export interface RouteRenderInput {
  readonly route: RouteContribution;
  readonly params: Readonly<Record<string, string>>;
  readonly pathname: string;
  /**
   * 框架层已解析的页面状态：?state= 强制注入 > 能力 denied/unknown 门控 > ready。
   * 页面组件直接使用该状态，不得自行读取 URL 审阅参数。
   */
  readonly pageState: PageLoadState<unknown>;
  /** 当前角色并集推导出的能力集合；null 表示权限检查结果未知。 */
  readonly capabilities: ReadonlySet<string> | null;
}

export interface RouteContribution {
  readonly routeId: string;
  /** 路径模板，支持 `:param` 段，例如 `/identification/runs/:runId` */
  readonly path: string;
  readonly title: string;
  readonly section: NavigationId | null;
  readonly shellKind: ShellKind;
  readonly contextRequirement: ContextRequirement;
  readonly requiredViewCapability: string | null;
  readonly render: ((input: RouteRenderInput) => ReactNode) | null;
}

export interface RouteResolution {
  readonly route: RouteContribution;
  readonly params: Readonly<Record<string, string>>;
}

function compilePathTemplate(template: string): {
  readonly regex: RegExp;
  readonly keys: readonly string[];
} {
  const keys: string[] = [];
  const pattern = template
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${pattern}$`), keys };
}

export function resolveRoute(
  routes: readonly RouteContribution[],
  pathname: string,
): RouteResolution | null {
  // 静态段优先于参数段（对齐生产 resolveWebRoute 的参数计数排序），
  // 避免 /warnings/tasks 被 /warnings/:warningId 抢先命中。
  const ordered = [...routes].sort((left, right) => {
    const leftParams = (left.path.match(/:/g) ?? []).length;
    const rightParams = (right.path.match(/:/g) ?? []).length;
    return leftParams - rightParams;
  });
  for (const route of ordered) {
    const { regex, keys } = compilePathTemplate(route.path);
    const match = regex.exec(pathname);
    if (match) {
      const params: Record<string, string> = {};
      keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? '');
      });
      return { route, params };
    }
  }
  return null;
}
