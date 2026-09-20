// 审阅参数解析与页面状态注入——只允许框架层（App）使用。
// 页面组件（含 PageScaffold）不得读取 ?state / ?roles / ?gaps 等参数。
//
// URL 契约（hash 模式下接在路径后）：
//   ?state=idle|loading|ready|empty|error|forbidden|unavailable  强制七态
//   ?roles=reviewer,field-responder                             角色覆盖（多选取并集）
//   ?gaps=on                                                    缺口覆盖层（默认关闭）
//   ?vp=1920|1440|1280|1024|min                                 视口宽度参考线叠加
//   ?safearea=on                                                Electron 可拖拽安全区叠加

import { PAGE_STATE_VALUES, type PageLoadState, type PageStateKind } from './state';
import { PRESET_ROLES, type PresetRole } from './contract-mirror';

export interface ReviewParams {
  readonly state: PageStateKind | null;
  /** null 表示未提供 roles 参数（用默认角色）。 */
  readonly roles: readonly PresetRole[] | null;
  /** roles 参数存在但含未识别角色：能力集按未知处理。 */
  readonly rolesInvalid: boolean;
  readonly gaps: boolean;
  readonly viewport: string | null;
  readonly safeArea: boolean;
}

export const VIEWPORT_PRESETS = ['1920', '1440', '1280', '1024', 'min'] as const;

export function parseReviewParams(pathWithQuery: string): ReviewParams {
  const query = pathWithQuery.includes('?') ? pathWithQuery.slice(pathWithQuery.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);

  const stateRaw = params.get('state');
  const state = (PAGE_STATE_VALUES as readonly string[]).includes(stateRaw ?? '')
    ? (stateRaw as PageStateKind)
    : null;

  const rolesRaw = params.get('roles');
  let roles: readonly PresetRole[] | null = null;
  let rolesInvalid = false;
  if (rolesRaw !== null) {
    const tokens = rolesRaw.split(',').filter((token) => token !== '');
    const valid = tokens.filter((token): token is PresetRole =>
      (PRESET_ROLES as readonly string[]).includes(token),
    );
    rolesInvalid = valid.length !== tokens.length;
    roles = valid;
  }

  const viewportRaw = params.get('vp');
  const viewport = (VIEWPORT_PRESETS as readonly string[]).includes(viewportRaw ?? '')
    ? viewportRaw
    : null;

  return {
    state,
    roles,
    rolesInvalid,
    gaps: params.get('gaps') === 'on',
    viewport,
    safeArea: params.get('safearea') === 'on',
  };
}

export interface ForcedStateContext {
  readonly branch: string | null;
  readonly capability: string | null;
}

/** 由 ?state= 构造强制页面状态；error / unavailable 只使用安全字段样例。 */
export function buildForcedState(
  kind: PageStateKind,
  context: ForcedStateContext,
): PageLoadState<unknown> {
  switch (kind) {
    case 'idle':
      return { kind: 'idle' };
    case 'loading':
      return { kind: 'loading', previous: null };
    case 'empty':
      return { kind: 'empty' };
    case 'error':
      return {
        kind: 'error',
        error: {
          code: 'UPSTREAM_TIMEOUT',
          retryable: true,
          requestId: 'REQ-20260918-0001',
          references: [{ kind: context.branch ?? 'projection.query' }],
        },
      };
    case 'forbidden':
      return {
        kind: 'forbidden',
        requiredCapability: context.capability ?? 'projection.query',
      };
    case 'unavailable':
      return { kind: 'unavailable', reasons: [{ code: 'capability-check-pending' }] };
    case 'ready':
      return { kind: 'ready', value: null };
  }
}

/**
 * 框架层页面状态解析：强制注入 > 能力门控 > 默认 ready。
 * granted 为 null 表示权限检查结果未知。
 */
export function resolveFrameworkPageState(
  input: {
    readonly forced: PageLoadState<unknown> | null;
    readonly requiredCapability: string | null;
    readonly granted: ReadonlySet<string> | null;
  },
): PageLoadState<unknown> {
  if (input.forced !== null) return input.forced;
  if (input.requiredCapability === null) return { kind: 'ready', value: null };
  if (input.granted === null) {
    return { kind: 'unavailable', reasons: [{ code: 'capability-check-pending' }] };
  }
  if (!input.granted.has(input.requiredCapability)) {
    return { kind: 'forbidden', requiredCapability: input.requiredCapability };
  }
  return { kind: 'ready', value: null };
}
