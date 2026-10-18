// 路由汇总：57 页按域分模块（pages/<域>/routes.tsx）注册，组合视图在
// pages/compose/routes.tsx，此处聚合。页面元数据事实源是 docs/page-manifest.json。
// 审阅控制台 /__review 属审阅设施，在 App 层单独处理，不在本注册表内。

import type { RouteContribution } from '../app/routes';
import { AGENT_ROUTES } from './agent/routes';
import { ASSESSMENT_ROUTES } from './assessment/routes';
import { COMPOSE_ROUTES } from './compose/routes';
import { IDENTIFICATION_ROUTES } from './identification/routes';
import { KNOWLEDGE_ROUTES } from './knowledge/routes';
import { OPS_ROUTES } from './ops/routes';
import { OVERVIEW_ROUTES } from './overview/routes';
import { PROJECT_ROUTES } from './project/routes';
// PROTOTYPE · THROWAWAY — 一次性原型路由，不进 57 页清单。
import { PROTOTYPE_ROUTES } from './prototype/routes';
import { REPORT_ROUTES } from './report/routes';
import { RESPONSE_ROUTES } from './response/routes';
import { REVIEW_ROUTES } from './review/routes';
import { WARNING_ROUTES } from './warning/routes';

export const BASE_ROUTES: readonly RouteContribution[] = [
  ...OVERVIEW_ROUTES,
  ...PROJECT_ROUTES,
  ...KNOWLEDGE_ROUTES,
  ...IDENTIFICATION_ROUTES,
  ...ASSESSMENT_ROUTES,
  ...WARNING_ROUTES,
  ...RESPONSE_ROUTES,
  ...AGENT_ROUTES,
  ...REVIEW_ROUTES,
  ...REPORT_ROUTES,
  ...OPS_ROUTES,
  ...COMPOSE_ROUTES,
  ...PROTOTYPE_ROUTES,
];

export const REVIEW_CONSOLE_PATH = '/__review';
