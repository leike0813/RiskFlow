/**
 * C37 D-17：工程选择器只由 URL 表达。
 *
 * 本模块是纯函数：只解析与拼装 `?project=…&revision=…`，不持有会话、不发起请求、
 * 也不提供第二套工程上下文。会话与工程上下文状态分别由 `app/state.ts` 与
 * `AppShell` 唯一拥有。
 */

export interface EngineeringSelector {
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly assessmentSources?: string;
}

export const selectorFromSearch = (search: string): EngineeringSelector => {
  const params = new URLSearchParams(search);
  const projectId = params.get("project");
  const revision = params.get("revision");
  return {
    ...(params.has("assessmentSources")
      ? { assessmentSources: params.get("assessmentSources")! }
      : {}),
    projectId: projectId !== null && projectId.trim().length > 0 ? projectId : null,
    revisionId:
      revision !== null && revision.includes("@")
        ? (revision.split("@")[1] ?? null)
        : revision !== null && revision.trim().length > 0
          ? revision
          : null,
  };
};

export const searchWithSelector = (
  search: string,
  selector: { readonly project: string; readonly revision?: string | null },
): string => {
  const params = new URLSearchParams(search);
  params.set("project", selector.project);
  if (selector.revision !== undefined && selector.revision !== null) {
    params.set("revision", selector.revision);
  } else {
    params.delete("revision");
  }
  return `?${params.toString()}`;
};

/**
 * 把当前工程/版本选择器并入目标路径的查询串，避免详情跳转丢失上下文。
 * 无工程时只返回原路径。
 */
export const projectPathWithSelector = (path: string, selector: EngineeringSelector): string => {
  const absolutePath = path.startsWith("/") ? path : `/${path}`;
  if (selector.projectId === null) return absolutePath;
  const queryIndex = absolutePath.indexOf("?");
  const pathname = queryIndex === -1 ? absolutePath : absolutePath.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : absolutePath.slice(queryIndex + 1));
  params.set("project", selector.projectId);
  if (selector.revisionId !== null) params.set("revision", selector.revisionId);
  if (selector.assessmentSources !== undefined) {
    params.set("assessmentSources", selector.assessmentSources);
  }
  return `${pathname}?${params.toString()}`;
};
