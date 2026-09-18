// 评估域路由：页面元数据来自 docs/page-manifest.json（单一事实源），
// 经 routesForDomain('assessment') 生成基础贡献；M4 起仅替换 render 为真实页面组件，
// routeId / path 不得改动。

import type { ReactNode } from 'react';
import type { RouteContribution, RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { MatrixViewPage } from './MatrixViewPage';
import { PendingRisksPage } from './PendingRisksPage';
import { ReassessmentsPage } from './ReassessmentsPage';
import { RecordDetailPage } from './RecordDetailPage';
import { RecordsPage } from './RecordsPage';
import { RunDetailPage } from './RunDetailPage';
import { StartAssessmentPage } from './StartAssessmentPage';
import './assessment.css';

const RENDER_BY_ROUTE_ID: Readonly<Record<string, (input: RouteRenderInput) => ReactNode>> = {
  'assessment.root': (input) => <PendingRisksPage input={input} />,
  'assessment.start': (input) => <StartAssessmentPage input={input} />,
  'assessment.run-detail': (input) => <RunDetailPage input={input} />,
  'assessment.records': (input) => <RecordsPage input={input} />,
  'assessment.record-detail': (input) => <RecordDetailPage input={input} />,
  'assessment.matrix': (input) => <MatrixViewPage input={input} />,
  'assessment.reassessments': (input) => <ReassessmentsPage input={input} />,
};

export const ASSESSMENT_ROUTES: readonly RouteContribution[] = routesForDomain('assessment').map(
  (route) => {
    const render = RENDER_BY_ROUTE_ID[route.routeId];
    return render === undefined ? route : { ...route, render };
  },
);
