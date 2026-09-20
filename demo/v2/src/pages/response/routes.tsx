// 处置域路由：页面元数据经 routesForDomain('response') 取自 docs/page-manifest.json，
// 本文件只把五页的 render 从 PageScaffold 换成真实组件（PAGE-GUIDE §1）。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { routesForDomain } from '../domain-routes';
import { CalibrationDetailPage } from './CalibrationDetailPage';
import { ExecutionRegisterPage } from './ExecutionRegisterPage';
import { FeedbackDetailPage } from './FeedbackDetailPage';
import { PredictionDetailPage } from './PredictionDetailPage';
import { RecommendationDetailPage } from './RecommendationDetailPage';

const RENDER_BY_ROUTE_ID: Readonly<
  Record<string, (input: RouteRenderInput) => ReactNode>
> = {
  'response.recommendation-detail': (input) => <RecommendationDetailPage input={input} />,
  'response.execution-register': (input) => <ExecutionRegisterPage input={input} />,
  'response.prediction-detail': (input) => <PredictionDetailPage input={input} />,
  'response.feedback-detail': (input) => <FeedbackDetailPage input={input} />,
  'response.calibration-detail': (input) => <CalibrationDetailPage input={input} />,
};

export const RESPONSE_ROUTES = routesForDomain('response').map((route) => ({
  ...route,
  render: RENDER_BY_ROUTE_ID[route.routeId] ?? route.render,
}));
