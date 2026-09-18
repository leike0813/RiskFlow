// 复核与审计域路由：页面元数据来自 docs/page-manifest.json（单一事实源），
// 经 routesForDomain('review') 生成基础贡献；M4 第二波起仅替换 render 为真实页面组件，
// routeId / path 不得改动。

import type { ReactNode } from 'react';
import type { RouteContribution, RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { AuditLogPage } from './AuditLogPage';
import { EvidenceTracePage } from './EvidenceTracePage';
import { IdentificationReviewPage } from './IdentificationReviewPage';
import { ReviewDetailPage } from './ReviewDetailPage';
import { ReviewQueuePage } from './ReviewQueuePage';
import { RunRecordsPage } from './RunRecordsPage';
import './review.css';

const RENDER_BY_ROUTE_ID: Readonly<Record<string, (input: RouteRenderInput) => ReactNode>> = {
  'review-audit.root': (input) => <ReviewQueuePage input={input} />,
  'review-audit.detail': (input) => <ReviewDetailPage input={input} />,
  'review-audit.identification': (input) => <IdentificationReviewPage input={input} />,
  'review-audit.trace': (input) => <EvidenceTracePage input={input} />,
  'review-audit.runs': (input) => <RunRecordsPage input={input} />,
  'review-audit.audit-log': (input) => <AuditLogPage input={input} />,
};

export const REVIEW_ROUTES: readonly RouteContribution[] = routesForDomain('review').map(
  (route) => {
    const render = RENDER_BY_ROUTE_ID[route.routeId];
    return render === undefined ? route : { ...route, render };
  },
);
