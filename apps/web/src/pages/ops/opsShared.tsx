/**
 * 系统管理域共享件（IP-10，design D-10/D-11）。
 *
 * 只承载跨页复用的三样东西：系统读状态原语、五个系统页的二级页签与页面外框、
 * 六项 C06 管理动作与目录状态的显示映射。页面之间不共享任何业务状态。
 *
 * 系统读不依赖工程上下文：这些路由在 EngineeringGate 之外，没有 ?project=
 * 也照常读取；只有明确带工程的已登记来源读才由页面自己决定是否停在 idle。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import AppShell from "../../components/AppShell";
import { PageStateView } from "../../components/PageStateView";
import { SectionTabs } from "../../components/SectionTabs";
import { C09HttpError } from "../../api/client";
import { makeSafeHttpError } from "../../api/http";
import { clientErrorCode } from "../../api/client";

// ------------------------------------------------------------------ 系统读状态

/** 系统读无权时只提示所需能力语义，不披露对象存在性。 */
const FORBIDDEN_CAPABILITY = "agent-task.read" as const;

export type SystemReadState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "forbidden" }
  | { readonly kind: "error"; readonly code: string };

/**
 * 有界系统读取：单在途请求、卸载即中止、迟到响应不覆盖新一次读取。
 *
 * 与 `usePageQuery` 的差别只在工程选择器：系统管理读没有工程维度，
 * 因此不读 URL 选择器，依赖由调用方按自己的筛选条件显式给出。
 * 鉴权类失败收敛为 forbidden，不披露系统对象；其余失败只保留结构化错误码。
 */
export function useSystemRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): { readonly state: SystemReadState<T>; readonly reload: () => void } {
  const [state, setState] = useState<SystemReadState<T>>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    sequence.current += 1;
    const current = sequence.current;
    const settle = (next: SystemReadState<T>) => {
      if (current === sequence.current) setState(next);
    };
    settle({ kind: "loading" });
    read(controller.signal)
      .then((value) => settle({ kind: "ready", value }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (
          error instanceof C09HttpError &&
          (error.error.code === "NOT_FOUND" || error.error.code === "AUTHENTICATION_REQUIRED")
        ) {
          settle({ kind: "forbidden" });
          return;
        }
        settle({
          kind: "error",
          code: error instanceof C09HttpError ? error.error.code : "TERMINAL_FAILURE",
        });
      });
    return () => {
      sequence.current += 1;
      controller.abort();
    };
    // 依赖由调用方显式给出：read 每次渲染都是新闭包，放进依赖会退回每次挂载都重取。
  }, [tick, ...deps]);

  return { state, reload: () => setTick((value) => value + 1) };
}

// ------------------------------------------------------------------ 页面外框

const OPS_TABS = [
  { to: "/ops/access", label: "账号与工程开通" },
  { to: "/ops/data-sources", label: "数据源" },
  { to: "/ops/health", label: "运行健康" },
  { to: "/ops/model-versions", label: "模型版本" },
  { to: "/ops/backup", label: "备份与恢复" },
];

/**
 * 系统页外框：与业务页同一 AppShell，但 activeNav 恒为 null——
 * 系统管理不是第八项一级业务导航，只从顶栏账号区辅助入口进入。
 */
export function OpsPage({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}) {
  return (
    <AppShell activeNav={null}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
        </header>
        <SectionTabs items={OPS_TABS} />
        {children}
      </div>
    </AppShell>
  );
}

/** 系统读取的七态呈现：沿用既有 PageStateView，页面不各自分叉骨架。 */
export function SystemReadView<T>({
  state,
  title,
  emptyMessage,
  forbiddenHint,
  onRetry,
  children,
}: {
  readonly state: SystemReadState<T>;
  readonly title: string;
  readonly emptyMessage?: string;
  readonly forbiddenHint?: string;
  readonly onRetry?: () => void;
  readonly children: (value: T) => ReactNode;
}) {
  if (state.kind === "ready") return <>{children(state.value)}</>;
  // 系统读状态收敛到页面既有七态：loading/forbidden 给出 Web 侧必需字段，
  // error 只保留结构化错误码，不把系统内部细节带给页面。
  const pageState =
    state.kind === "loading"
      ? ({ kind: "loading", previous: null } as const)
      : state.kind === "forbidden"
        ? ({ kind: "forbidden", requiredCapability: FORBIDDEN_CAPABILITY } as const)
        : ({
            kind: "error",
            error: makeSafeHttpError({ code: clientErrorCode(state.code), retryable: false }),
          } as const);
  return (
    <PageStateView
      state={pageState}
      title={title}
      {...(emptyMessage === undefined ? {} : { emptyMessage })}
      forbiddenHint={forbiddenHint ?? "当前会话不具备查看该系统对象的权限"}
      {...(onRetry === undefined ? {} : { onRetry })}
    >
      {() => null}
    </PageStateView>
  );
}

// ------------------------------------------------------------------ 显示映射

/** 六项 C06 管理动作（SYSTEM_ACCESS_ACTIONS_V1 原值，界面不另造动作码）。 */
export const SYSTEM_ACCESS_ACTIONS = [
  "create-account",
  "disable-account",
  "reset-password",
  "open-project",
  "suspend-project",
  "revise-membership",
] as const;

export const SYSTEM_ACTION_LABEL: Record<string, string> = {
  "create-account": "创建账号",
  "disable-account": "停用账号",
  "reset-password": "重置口令",
  "open-project": "开通工程",
  "suspend-project": "暂停工程",
  "revise-membership": "修订成员",
};

/** 高影响动作：停用/重置/工程暂停，命令确认必须附勾选。 */
export const HIGH_IMPACT_ACTIONS: readonly string[] = [
  "disable-account",
  "reset-password",
  "suspend-project",
];

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: "正常",
  disabled: "已停用",
};

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "开通中",
  suspended: "已暂停",
};

export const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  active: "生效",
  removed: "已移除",
};

export const SCOPE_STATUS_LABEL: Record<string, string> = {
  active: "生效",
  inactive: "停用",
};

export const PRESET_ROLE_LABEL: Record<string, string> = {
  "system-administrator": "系统管理员",
  "project-risk-manager": "工程风险管理员",
  reviewer: "复核人",
  "field-responder": "现场处置人",
  "business-viewer": "业务查看人",
};

/** 状态 → StatusTag 色调；未知取值走中性，不臆断成功。 */
export const STATUS_TONE: Record<string, "success" | "failed" | "review" | "neutral"> = {
  active: "success",
  available: "success",
  disabled: "neutral",
  suspended: "review",
  removed: "neutral",
  inactive: "neutral",
  unavailable: "failed",
  degraded: "review",
  unknown: "neutral",
};

export const HEALTH_STATUS_LABEL: Record<string, string> = {
  available: "可用",
  unavailable: "不可用",
  degraded: "降级",
  unknown: "未知",
};

export const SOURCE_PARSE_STATUS_LABEL: Record<string, string> = {
  registered: "已登记",
  processing: "处理中",
  parsed: "已解析",
  failed: "解析失败",
};

export const CLEANING_AVAILABILITY_LABEL: Record<string, string> = {
  available: "全部可用",
  partial: "部分可用",
  unavailable: "不可用",
};

/** 字段分组中的一格：标签在上、取值在下（v2 FieldGroup 的最小呈现）。 */
export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="op-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** ISO 时间戳按分钟呈现：只显示到分钟，不做时区换算推断。 */
export const formatDateTime = (iso: string): string => iso.slice(0, 16).replace("T", " ");
