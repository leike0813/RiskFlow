// 页面加载七态与外壳上下文，形状对齐 apps/web/src/app/state.ts:12-47。
// 强制状态注入只允许发生在框架层（review 控制台），页面组件不感知。

export interface SafeReason {
  readonly code: string;
}

export interface SafeErrorReference {
  readonly kind: string;
}

/** 错误态仅允许展示安全字段：code / retryable / requestId / references.kind。 */
export interface SafePageError {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly references: readonly SafeErrorReference[];
}

export type PageLoadState<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly previous: T | null }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly error: SafePageError }
  | { readonly kind: 'forbidden'; readonly requiredCapability: string }
  | { readonly kind: 'unavailable'; readonly reasons: readonly SafeReason[] };

export const PAGE_STATE_VALUES = [
  'idle',
  'loading',
  'ready',
  'empty',
  'error',
  'forbidden',
  'unavailable',
] as const;

export type PageStateKind = (typeof PAGE_STATE_VALUES)[number];

export interface ShellContext {
  readonly revision: number;
  readonly projectId: string | null;
  readonly spatialScopeRef: string | null;
  readonly processNodeId: string | null;
}

export const INITIAL_CONTEXT: ShellContext = {
  revision: 0,
  projectId: null,
  spatialScopeRef: null,
  processNodeId: null,
};
