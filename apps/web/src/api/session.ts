import { createContext, createElement, useContext, type ReactNode } from "react";

import type { SessionMetadataViewV1 } from "./http.js";
import type { SessionStateV1 } from "../app/state.js";

/**
 * C37 D-17：薄会话适配。
 *
 * 会话元数据与登录/改密/登出都由 `api/http.ts#createC09Client` 唯一拥有；
 * 本模块只提供页面需要的 `sessionReturnTarget` 纯函数与一个注入式 Provider，
 * 不复制请求实现，也不维护第二份会话状态。
 */

/**
 * 登录回跳只接受本站业务路径。
 *
 * 外部 origin、协议相对地址与含 scheme 的值一律回落到概览，避免开放重定向。
 */
export const sessionReturnTarget = (value: string | null): string => {
  const fallback = "/overview";
  if (value === null) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("://") || value.includes("\\")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/change-password")) return fallback;
  return value;
};

export interface SessionContextValue {
  readonly state: SessionStateV1;
  readonly login: (loginName: string, password: string) => Promise<boolean>;
  readonly changePassword: (newPassword: string) => Promise<boolean>;
  readonly logout: () => Promise<boolean>;
  readonly retryRestore: () => void;
  readonly metadata: SessionMetadataViewV1 | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = (props: { value: SessionContextValue; children: ReactNode }) =>
  createElement(SessionContext.Provider, { value: props.value }, props.children);

export const useSession = (): SessionContextValue => {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
};
