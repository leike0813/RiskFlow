// 七项主导航。标签逐字对齐生产 apps/web/src/shell/navigation.ts:15-65；
// 能力三态渲染（allowed / denied / unknown）语义对齐 navigationPermission。

import type { NavigationId } from '../app/routes';
import type { IconName } from '../components/icons';

export interface NavigationItem {
  readonly id: NavigationId;
  readonly label: string;
  readonly path: string;
  readonly requiredCapability: string;
  readonly icon: IconName;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    id: 'overview',
    label: '风险态势',
    path: '/overview',
    requiredCapability: 'projection.query',
    icon: 'overview',
  },
  {
    id: 'projects',
    label: '工程项目',
    path: '/projects',
    requiredCapability: 'engineering-data.read',
    icon: 'project',
  },
  {
    id: 'identification',
    label: '风险识别',
    path: '/identification',
    requiredCapability: 'risk-identification.read',
    icon: 'identification',
  },
  {
    id: 'assessment',
    label: '风险评估',
    path: '/assessment',
    requiredCapability: 'risk-assessment.read',
    icon: 'assessment',
  },
  {
    id: 'warnings',
    label: '预警处置',
    path: '/warnings',
    requiredCapability: 'warning-response.read',
    icon: 'warnings',
  },
  {
    id: 'knowledge',
    label: '知识与规则',
    path: '/knowledge',
    requiredCapability: 'knowledge-modeling.read',
    icon: 'knowledge',
  },
  {
    id: 'review-audit',
    label: '复核与审计',
    path: '/review-audit',
    requiredCapability: 'review-audit.read',
    icon: 'review',
  },
];
