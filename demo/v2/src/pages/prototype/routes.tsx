// PROTOTYPE · THROWAWAY — UI 重做票 05 的路由入口（替换旧的 ResponseTaskDetailPrototype）。

import type { ReactNode } from 'react';
import type { RouteContribution } from '../../app/routes';
import { PrototypeHost } from './PrototypeHost';

export const PROTOTYPE_ROUTES: readonly RouteContribution[] = [
  {
    routeId: 'prototype.ui',
    path: '/prototype/ui',
    title: 'UI 重做原型',
    section: null,
    shellKind: 'custom',
    contextRequirement: 'project',
    requiredViewCapability: null,
    render: (): ReactNode => <PrototypeHost />,
  },
];
