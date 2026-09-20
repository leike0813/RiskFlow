// 历史适配器，形状对齐 apps/web/src/app/routes.ts:296-351 的 WebHistoryAdapterV1。
// 三种模式：hash（默认，file:// 与静态托管可用，审阅深链的基础）、memory、history。
// 约定：current() 与 navigate() 的 path 形如 `/identification/runs/RUN-001?state=empty`，不含前导 `#`。

export type HistoryMode = 'memory' | 'hash' | 'history';

export interface HistoryAdapter {
  readonly mode: HistoryMode;
  current(): string;
  navigate(path: string): void;
  replace(path: string): void;
  subscribe(listener: () => void): () => void;
}

function normalize(path: string): string {
  const stripped = path.startsWith('#') ? path.slice(1) : path;
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function createHashAdapter(): HistoryAdapter {
  const read = (): string => normalize(window.location.hash || '#/');
  return {
    mode: 'hash',
    current: read,
    navigate(path) {
      window.location.hash = `#${normalize(path)}`;
    },
    replace(path) {
      const url = `${window.location.pathname}${window.location.search}#${normalize(path)}`;
      window.history.replaceState(null, '', url);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    subscribe(listener) {
      window.addEventListener('hashchange', listener);
      return () => window.removeEventListener('hashchange', listener);
    },
  };
}

function createHistoryAdapter(): HistoryAdapter {
  const read = (): string =>
    normalize(`${window.location.pathname}${window.location.search}`);
  return {
    mode: 'history',
    current: read,
    navigate(path) {
      window.history.pushState(null, '', normalize(path));
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    replace(path) {
      window.history.replaceState(null, '', normalize(path));
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    subscribe(listener) {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
  };
}

function createMemoryAdapter(initial: string): HistoryAdapter {
  let stack = [normalize(initial)];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    mode: 'memory',
    current: () => stack[stack.length - 1],
    navigate(path) {
      stack = [...stack, normalize(path)];
      emit();
    },
    replace(path) {
      stack = [...stack.slice(0, -1), normalize(path)];
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createRouterAdapter(mode: HistoryMode, initial = '/'): HistoryAdapter {
  if (mode === 'hash') return createHashAdapter();
  if (mode === 'history') return createHistoryAdapter();
  return createMemoryAdapter(initial);
}

/** 协议为 file: 时强制 hash；否则读 `?__router=`，默认 hash。 */
export function detectHistoryMode(): HistoryMode {
  if (window.location.protocol === 'file:') return 'hash';
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('__router');
  if (requested === 'history' || requested === 'memory') return requested;
  return 'hash';
}
