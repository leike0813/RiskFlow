import { useEffect, useRef, useState } from "react";

import { useEngineering, usePageQuery, type PageState } from "../../api/engineering";
import type { WorkspacePageView } from "../../api/engineeringWorkspace";

/**
 * 成员修订表单与工程访问目录的有界续页（design D-04）。
 *
 * 账号、角色、空间范围与预期版本都来自真实读面：成员更新只绑定已读到的当前成员引用，
 * 并保留其真实空间范围——不能因为切换成员就填首空间而重写权限。新增非成员账号仍走
 * 原系统管理入口，本页只修改/移除现有成员。
 */

export interface WorkspaceRefV1 {
  readonly entityId: string;
  readonly versionId: string;
}

export interface WorkspaceKindRefV1 {
  readonly kind: string;
  readonly reference: WorkspaceRefV1;
}

export interface WorkspaceScopeOptionV1 {
  readonly scopeRef: WorkspaceRefV1;
  readonly parentScopeRef?: WorkspaceRefV1;
  readonly status: string;
}

export interface WorkspaceMembershipOptionV1 {
  readonly membershipRef: WorkspaceRefV1;
  readonly accountRef: WorkspaceRefV1;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly spatialScopeRefs: readonly WorkspaceKindRefV1[];
  readonly status: string;
}

export interface WorkspaceMembershipInputV1 {
  readonly membershipId: string;
  readonly accountId: string;
  readonly expectedVersion: WorkspaceRefV1;
  readonly roles: readonly string[];
  readonly spatialScopeRefs: readonly WorkspaceKindRefV1[];
  readonly status: "active" | "removed";
}

export interface ProjectMembershipFormPropsV1 {
  readonly memberships: readonly WorkspaceMembershipOptionV1[];
  readonly scopes: readonly WorkspaceScopeOptionV1[];
  readonly onSubmit: (input: WorkspaceMembershipInputV1) => void;
  /** 编辑任何输入即通知调用方作废旧确认，避免用已改动的表单提交旧冻结请求。 */
  readonly onDraftChange?: () => void;
}

const PRESET_ROLE_OPTIONS = [
  { value: "project-risk-manager", label: "工程风险负责人" },
  { value: "reviewer", label: "复核人" },
  { value: "field-responder", label: "现场处置人" },
  { value: "business-viewer", label: "业务查看人" },
  { value: "system-administrator", label: "系统管理员（预设角色）" },
] as const;

export interface WorkspaceDirectoryV1<T> {
  readonly state: PageState<readonly T[]>;
  readonly nextCursor: string | undefined;
  readonly loadingMore: boolean;
  readonly moreError: string | null;
  readonly retry: () => void;
  readonly loadMore: () => void;
}

/**
 * 有界目录：首页经页面查询取得，续页只在用户显式点击时按原游标追加。
 *
 * 切工程/上下文即作废已追加的续页与在途请求；选择由调用方各自持有，不因切页改首行。
 */
export const useWorkspaceDirectory = <T,>(
  load: (projectId: string, signal: AbortSignal, cursor?: string) => Promise<WorkspacePageView<T>>,
  deps: readonly unknown[],
): WorkspaceDirectoryV1<T> => {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const key = JSON.stringify([projectId, ...deps]);
  const first = usePageQuery<WorkspacePageView<T>>((id, signal) => load(id, signal), deps);
  const [tail, setTail] = useState<{
    readonly key: string;
    readonly items: readonly T[];
    readonly nextCursor?: string;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    setTail(null);
    setMoreError(null);
    setLoadingMore(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [key]);

  const base = first.state.kind === "ready" ? first.state.value : null;
  const items: readonly T[] =
    base === null ? [] : [...base.items, ...(tail?.key === key ? tail.items : [])];
  const nextCursor = tail?.key === key ? tail.nextCursor : base?.nextCursor;

  const loadMore = (): void => {
    if (projectId === null || base === null || nextCursor === undefined || loadingMore) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoadingMore(true);
    setMoreError(null);
    const pageKey = key;
    load(projectId, controller.signal, nextCursor)
      .then(
        (page) => {
          if (
            controller.signal.aborted ||
            request.current !== controller ||
            keyRef.current !== pageKey
          )
            return;
          setTail((current) => ({
            key: pageKey,
            items: [...(current?.key === pageKey ? current.items : []), ...page.items],
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          }));
        },
        (error: unknown) => {
          if (controller.signal.aborted || keyRef.current !== pageKey) return;
          setMoreError(error instanceof Error ? error.message : "续页读取失败");
        },
      )
      .finally(() => {
        if (request.current === controller && keyRef.current === pageKey) {
          request.current = null;
          setLoadingMore(false);
        }
      });
  };

  const retry = (): void => {
    request.current?.abort();
    request.current = null;
    setLoadingMore(false);
    setTail(null);
    setMoreError(null);
    first.retry();
  };

  const state: PageState<readonly T[]> =
    first.state.kind === "ready"
      ? items.length === 0 && nextCursor === undefined
        ? { kind: "empty" }
        : { kind: "ready", value: items }
      : first.state.kind === "loading"
        ? { kind: "loading", previous: null }
        : first.state;

  return { state, nextCursor, loadingMore, moreError, retry, loadMore };
};

/** 目录续页按钮：只在确实存在下一页时出现，一次只追加一页。 */
export function WorkspacePageMore({
  nextCursor,
  loading,
  error,
  label,
  onLoad,
}: {
  readonly nextCursor: string | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly label: string;
  readonly onLoad: () => void;
}) {
  if (nextCursor === undefined && error === null) return null;
  return (
    <div className="pjwf-more">
      {nextCursor === undefined ? null : (
        <button type="button" className="pjwf-secondary" disabled={loading} onClick={onLoad}>
          {loading ? "加载中…" : label}
        </button>
      )}
      {error === null ? null : (
        <p className="pjwf-error" role="alert">
          续页读取失败：{error}
        </p>
      )}
    </div>
  );
}

export function ProjectMembershipForm({
  memberships,
  scopes,
  onSubmit,
  onDraftChange,
}: ProjectMembershipFormPropsV1) {
  const [membershipId, setMembershipId] = useState("");
  const [roles, setRoles] = useState<readonly string[]>([]);
  const [scopeRefs, setScopeRefs] = useState<readonly WorkspaceKindRefV1[]>([]);
  const [status, setStatus] = useState<"active" | "removed">("active");
  const [touched, setTouched] = useState(false);
  const markEdited = (): void => {
    setTouched(true);
    onDraftChange?.();
  };
  const selected = memberships.find((item) => item.membershipRef.entityId === membershipId);
  const scopeById = new Map(scopes.map((scope) => [scope.scopeRef.entityId, scope]));
  const selectedIds = new Set(scopeRefs.map((ref) => ref.reference.entityId));
  const optionIds = [
    ...new Set([...scopes.map((scope) => scope.scopeRef.entityId), ...selectedIds]),
  ];

  const issues: string[] = [];
  if (selected === undefined) issues.push("请选择要修改的现有工程成员");
  if (selected !== undefined && roles.length === 0) issues.push("至少保留一个预设角色");
  if (selected !== undefined && scopeRefs.length === 0) issues.push("至少保留一个空间范围");

  const refLabel = (ref: WorkspaceKindRefV1 | WorkspaceScopeOptionV1): string => {
    const entityId = "scopeRef" in ref ? ref.scopeRef.entityId : ref.reference.entityId;
    return entityId;
  };

  return (
    <div className="pjwf-form" data-form="membership">
      <div className="pjwf-field">
        <label htmlFor="pjwf-membership">成员</label>
        <select
          id="pjwf-membership"
          value={membershipId}
          onChange={(event) => {
            const next = memberships.find(
              (item) => item.membershipRef.entityId === event.target.value,
            );
            setMembershipId(event.target.value);
            // 保留该成员的真实角色与真实空间范围，不预填首空间。
            setRoles(next?.roles ?? []);
            setScopeRefs(next?.spatialScopeRefs ?? []);
            setStatus(next?.status === "removed" ? "removed" : "active");
            setTouched(false);
            onDraftChange?.();
          }}
        >
          <option value="">请选择工程成员</option>
          {memberships.map((item) => (
            <option key={item.membershipRef.entityId} value={item.membershipRef.entityId}>
              {item.displayName}（{item.accountRef.entityId}）
            </option>
          ))}
        </select>
        {touched && selected === undefined ? (
          <span className="pjwf-field-error">请选择要修改的现有工程成员</span>
        ) : null}
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-roles">预设角色</label>
        <select
          id="pjwf-roles"
          multiple
          value={[...roles]}
          aria-invalid={touched && roles.length === 0}
          onChange={(event) => {
            markEdited();
            setRoles(
              Array.from(event.target.selectedOptions, (option) => option.value).slice(0, 4),
            );
          }}
        >
          {PRESET_ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        {touched && roles.length === 0 ? (
          <span className="pjwf-field-error">至少保留一个预设角色</span>
        ) : null}
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-scopes">空间范围</label>
        <select
          id="pjwf-scopes"
          multiple
          value={[...selectedIds]}
          aria-invalid={touched && scopeRefs.length === 0}
          onChange={(event) => {
            markEdited();
            const wanted = new Set(
              Array.from(event.target.selectedOptions, (option) => option.value),
            );
            setScopeRefs((current) => {
              const kept = current.filter((ref) => wanted.has(ref.reference.entityId));
              const keptIds = new Set(kept.map((ref) => ref.reference.entityId));
              const added = [...wanted]
                .filter((entityId) => !keptIds.has(entityId))
                .flatMap((entityId) => {
                  const fromDirectory = scopeById.get(entityId);
                  const fromMember = selected?.spatialScopeRefs.find(
                    (ref) => ref.reference.entityId === entityId,
                  );
                  const reference = fromMember?.reference ?? fromDirectory?.scopeRef;
                  return reference === undefined ? [] : [{ kind: "spatial-scope", reference }];
                });
              return [...kept, ...added];
            });
          }}
        >
          {optionIds.map((entityId) => {
            const directory = scopeById.get(entityId);
            const memberRef = selected?.spatialScopeRefs.find(
              (ref) => ref.reference.entityId === entityId,
            );
            const label = directory === undefined ? memberRef : directory;
            const inactive = directory?.status === "inactive";
            return (
              <option key={entityId} value={entityId}>
                {label === undefined ? entityId : refLabel(label)}
                {inactive ? "（已停用）" : ""}
              </option>
            );
          })}
        </select>
        {touched && scopeRefs.length === 0 ? (
          <span className="pjwf-field-error">至少保留一个空间范围</span>
        ) : null}
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-status">成员状态</label>
        <select
          id="pjwf-status"
          value={status}
          onChange={(event) => {
            markEdited();
            setStatus(event.target.value === "removed" ? "removed" : "active");
          }}
        >
          <option value="active">有效</option>
          <option value="removed">移除</option>
        </select>
      </div>
      <button
        type="button"
        className="pjwf-primary"
        disabled={issues.length > 0}
        onClick={() => {
          setTouched(true);
          if (selected === undefined) return;
          onSubmit({
            membershipId: selected.membershipRef.entityId,
            accountId: selected.accountRef.entityId,
            // 目录返回的精确修订引用原样作为预期版本，交给所属边界换算，不在页面猜版本。
            expectedVersion: {
              entityId: selected.membershipRef.entityId,
              versionId: selected.membershipRef.versionId,
            },
            roles,
            spatialScopeRefs: scopeRefs,
            status,
          });
        }}
      >
        提交成员修订
      </button>
      {touched && issues.length > 0 ? (
        <ul className="pjwf-error-summary" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="pjwf-note">
        本页只修改或移除现有成员；新增成员仍在系统管理入口按账号目录登记，工程内不开放全局账号目录。
      </p>
    </div>
  );
}
