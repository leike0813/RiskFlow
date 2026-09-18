// 能力三态：导航与动作按 allowed / denied / unknown 渲染。
// 能力位取值（29 个）与角色策略镜像在 contract-mirror.ts 中维护，
// 并由 tools/check-contract-mirror.check.mjs 与 packages 事实源比对。

export type CapabilityState = 'allowed' | 'denied' | 'unknown';

export function capabilityStateFor(
  required: string | null,
  granted: ReadonlySet<string> | null,
): CapabilityState {
  if (required === null) return 'allowed';
  if (granted === null) return 'unknown';
  return granted.has(required) ? 'allowed' : 'denied';
}
