import { useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { navItems, type NavKey } from "../content/context";
import {
  EngineeringContext,
  searchWithSelector,
  selectorFromSearch,
  useSession,
  type EngineeringContextState,
  type EngineeringSelector,
} from "../api/context";
import { Icon, type IconName } from "./icons";
import { EvidenceProvider } from "./EvidenceDrawer";
import { AgentDock } from "../agent/AgentDock";
import { toggleAgentDock, useAgentDockOpen } from "../agent/agentDockStore";
import "./AppShell.css";
import { readAssessmentSourceSelection } from "../api/client";

const navIcons: Record<NavKey, IconName> = {
  overview: "overview",
  project: "project",
  identification: "identification",
  assessment: "assessment",
  warnings: "warnings",
  knowledge: "knowledge",
  review: "review",
};

const CONTEXT_STATUS_LABEL: Record<string, string> = {
  preparing: "上下文准备中",
  active: "上下文已生效",
};

/**
 * 工程上下文对系统管理路由缺席：这些路由在工程门之外，本来就没有工程上下文。
 * 有工程门时用 Provider 的真实事实；没有时按 URL 选择器如实呈现「未选择工程」，
 * 不因为缺少上下文就补一份工程状态。
 */
function useOptionalEngineering(): {
  readonly available: boolean;
  readonly selector: EngineeringSelector;
  readonly state: EngineeringContextState;
} {
  const value = useContext(EngineeringContext);
  const [searchParams] = useSearchParams();
  return {
    available: value !== null,
    selector:
      value?.selector ??
      selectorFromSearch(`?${searchParams.toString()}`),
    state: value?.state ?? { kind: "idle" },
  };
}

/** 顶栏工程切换：手输工程标识写回 URL 参数，页面停留原地按新工程重新加载。 */
function EngineeringSwitcher({ selector }: { readonly selector: EngineeringSelector }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const project = draft.trim();
    if (project.length === 0) return;
    const next = new URLSearchParams(
      searchWithSelector(`?${searchParams.toString()}`, { project }),
    );
    next.delete("assessmentSources");
    setSearchParams(next);
    setEditing(false);
    setDraft("");
  };

  if (!editing) {
    return (
      <button type="button" className="shell-switch-btn" onClick={() => setEditing(true)}>
        {selector.projectId === null ? "选择工程" : "切换工程"}
      </button>
    );
  }
  return (
    <form className="shell-switch-form" onSubmit={onSubmit}>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="工程标识"
        aria-label="工程标识"
      />
      <button type="submit" className="shell-switch-btn">
        确定
      </button>
    </form>
  );
}

function AssessmentSourceSelector({ selector }: { readonly selector: EngineeringSelector }) {
  const [params, setParams] = useSearchParams();
  const selection = readAssessmentSourceSelection(`?${params.toString()}`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setEditing(false);
    setDraft("");
    setInvalid(false);
  }, [selector.projectId, selector.revisionId]);
  if (selector.projectId === null) return null;
  if (!editing)
    return (
      <button
        type="button"
        className="shell-switch-btn"
        onClick={() => {
          setDraft(selection === null ? "" : JSON.stringify(selection.refs));
          setEditing(true);
        }}
      >
        资料来源{selection === null ? "：未选择" : `：${selection.refs.length} 个版本`}
      </button>
    );
  return (
    <form
      className="shell-switch-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new URLSearchParams(params);
        if (draft.trim() === "") next.delete("assessmentSources");
        else {
          try {
            next.set(
              "assessmentSources",
              JSON.stringify({
                projectId: selector.projectId,
                revisionId: selector.revisionId,
                refs: JSON.parse(draft),
              }),
            );
          } catch {
            setInvalid(true);
            return;
          }
          if (readAssessmentSourceSelection(`?${next.toString()}`) === null) {
            setInvalid(true);
            return;
          }
        }
        setParams(next);
        setEditing(false);
        setInvalid(false);
      }}
    >
      <input
        aria-label="资料来源版本"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder='[{"entityId":"资料版本标识","versionId":"版本"}]'
        aria-invalid={invalid}
      />
      <button type="submit" className="shell-switch-btn">
        应用来源
      </button>
      <button type="button" className="shell-switch-btn" onClick={() => setEditing(false)}>
        取消
      </button>
      {invalid && <span role="alert">请填写 1～256 个完整来源版本引用</span>}
    </form>
  );
}

/**
 * 全局应用框架：左侧导航（224px）+ 顶部工程上下文栏（68px）+ 主工作区。
 * 顶栏工程事实由 context-read 驱动；内部挂载证据抽屉（EvidenceProvider）与 Agent 停靠栏。
 *
 * @param activeNav 当前一级导航；/agent 全屏工作台传 null
 * @param agentContext 传入 Agent 停靠栏头部的上下文标签
 */
export default function AppShell({
  activeNav,
  agentContext,
  children,
}: {
  activeNav: NavKey | null;
  agentContext?: string[];
  children: ReactNode;
}) {
  const dockOpen = useAgentDockOpen();
  const location = useLocation();
  const agentActive = dockOpen || location.pathname === "/agent";
  const { state: sessionState, logout, logoutPending, logoutFailed } = useSession();
  const { available: engineeringAvailable, selector, state: engineering } =
    useOptionalEngineering();
  const systemActive = location.pathname.startsWith("/ops");

  return (
    <EvidenceProvider>
      <div className="shell">
        <aside className="shell-nav">
          <div className="shell-brand">
            <div className="shell-brand-name">RiskFlow</div>
            <div className="shell-brand-sub">风险智能识别与评估系统</div>
          </div>
          <nav className="shell-menu">
            {navItems.map((item) => (
              <Link
                key={item.key}
                to={{ pathname: item.to, search: location.search }}
                className={`shell-menu-item${activeNav === item.key ? " shell-menu-item--active" : ""}`}
              >
                <Icon name={navIcons[item.key]} size={18} />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <header className="shell-topbar">
          <div className="shell-context">
            {selector.projectId === null ? (
              <span className="shell-context-item">未选择工程</span>
            ) : (
              <>
                <span className="shell-context-item">当前工程：{selector.projectId}</span>
                {engineering.kind === "ready" && (
                  <>
                    <span className="shell-context-item">
                      {CONTEXT_STATUS_LABEL[engineering.value.contextStatus] ??
                        engineering.value.contextStatus}
                    </span>
                    {engineering.value.currentProjectRevisionRef !== undefined && (
                      <span className="shell-context-item mono">
                        修订：{engineering.value.currentProjectRevisionRef.reference.versionId}
                      </span>
                    )}
                  </>
                )}
                {engineering.kind === "loading" && (
                  <span className="shell-context-item">上下文加载中…</span>
                )}
                {engineering.kind === "error" && (
                  <span className="shell-context-item">工程上下文加载失败</span>
                )}
                {engineering.kind === "forbidden" && (
                  <span className="shell-context-item">无权访问该工程</span>
                )}
              </>
            )}
          </div>
          <div className="shell-actions">
            {(activeNav === "overview" ||
              activeNav === "assessment" ||
              activeNav === "warnings") && <AssessmentSourceSelector selector={selector} />}
            {/* 工程切换只属于工程上下文；系统管理页不暗示存在可选工程。 */}
            {engineeringAvailable && <EngineeringSwitcher selector={selector} />}
            {sessionState.kind === "authenticated" && (
              <>
                <span className="shell-context-item mono">
                  {sessionState.session.accountRef.entityId}
                </span>
                {/* 系统管理是账号区辅助入口，不是第八项一级业务导航：七项业务导航顺序不变。 */}
                <Link
                  to="/ops/access"
                  className={`shell-system-btn${systemActive ? " shell-system-btn--active" : ""}`}
                  aria-current={systemActive ? "page" : undefined}
                >
                  <Icon name="project" size={16} />
                  系统管理
                </Link>
                <button
                  type="button"
                  className="shell-switch-btn"
                  disabled={logoutPending}
                  onClick={() => void logout()}
                >
                  登出
                </button>
                {/* 注销失败保持原会话并允许重试：只有成功注销才进入匿名。 */}
                {logoutFailed ? (
                  <button
                    type="button"
                    className="shell-switch-btn shell-switch-btn--warn"
                    disabled={logoutPending}
                    onClick={() => void logout()}
                  >
                    重试登出
                  </button>
                ) : null}
              </>
            )}
            {/* Agent 抽屉挂在工程任务上：系统管理路由没有工程上下文，此处不呈现。 */}
            {engineeringAvailable && (
              <button
                type="button"
                className={`shell-agent-btn${agentActive ? " shell-agent-btn--active" : ""}`}
                onClick={toggleAgentDock}
              >
                <Icon name="agent" size={16} />
                智能 Agent
              </button>
            )}
          </div>
        </header>

        <main className="shell-main">{children}</main>

        {engineeringAvailable && <AgentDock context={agentContext} />}
      </div>
    </EvidenceProvider>
  );
}
