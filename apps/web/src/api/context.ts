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

/**
 * 只解析属于所选工程的修订：完整 `<projectId>@<versionId>` 必须工程一致；
 * 裸 `<versionId>` 按既有 project-revision 身份规则等于 projectId。
 * 多段、空值或别的工程的值不得到版本，调用方据此显示不可定位而不是回落当前修订。
 */
const revisionForProject = (
  projectId: string | null,
  rawRevisions: readonly string[],
): string | null => {
  if (projectId === null) return null;
  const versions = rawRevisions.flatMap((raw) => {
    const parts = raw.split("@");
    if (parts.length === 1) {
      const bare = parts[0] ?? "";
      return bare.trim() === "" ? [] : [bare];
    }
    if (parts.length !== 2) return [];
    const [entityId, versionId] = parts;
    return entityId === projectId && versionId !== undefined && versionId.trim() !== ""
      ? [versionId]
      : [];
  });
  const unique = [...new Set(versions)];
  return unique.length === 1 ? unique[0]! : null;
};

export const selectorFromSearch = (search: string): EngineeringSelector => {
  const params = new URLSearchParams(search);
  const projectId = params.get("project");
  const normalizedProject = projectId !== null && projectId.trim().length > 0 ? projectId : null;
  return {
    ...(params.has("assessmentSources")
      ? { assessmentSources: params.get("assessmentSources")! }
      : {}),
    projectId: normalizedProject,
    revisionId: revisionForProject(normalizedProject, params.getAll("revision")),
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
  if (selector.revisionId !== null) {
    // 写完整引用，避免裸版本在不同工程下被重新解释成另一个修订。
    params.set("revision", `${selector.projectId}@${selector.revisionId}`);
  } else {
    params.delete("revision");
  }
  if (selector.assessmentSources !== undefined) {
    params.set("assessmentSources", selector.assessmentSources);
  }
  return `${pathname}?${params.toString()}`;
};
