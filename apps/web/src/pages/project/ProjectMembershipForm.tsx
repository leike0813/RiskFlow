import { useState } from "react";

/**
 * 成员修订表单（design D-04）。
 *
 * 账号、角色与空间范围都从真实选择器取值：成员更新只绑定已读到的当前成员引用，
 * 不要求用户手输既有账号、空间或版本标识。新建身份由表单生成一次。
 */

export interface WorkspaceMemberOptionV1 {
  readonly accountRef: { readonly entityId: string; readonly versionId: string };
  readonly displayName: string;
}

export interface WorkspaceScopeOptionV1 {
  readonly scopeRef: { readonly entityId: string; readonly versionId: string };
  readonly status: string;
}

export interface WorkspaceMembershipOptionV1 {
  readonly membershipRef: { readonly entityId: string; readonly versionId: string };
  readonly accountRef: { readonly entityId: string; readonly versionId: string };
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly status: string;
}

export interface WorkspaceMembershipInputV1 {
  readonly membershipId: string;
  readonly accountId: string;
  readonly expectedVersion: { readonly entityId: string; readonly versionId: string };
  readonly roles: readonly string[];
  readonly spatialScopeRefs: readonly {
    readonly kind: "spatial-scope";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[];
  readonly status: "active" | "removed";
}

export interface ProjectMembershipFormPropsV1 {
  readonly memberships: readonly WorkspaceMembershipOptionV1[];
  readonly memberOptions: readonly WorkspaceMemberOptionV1[];
  readonly scopes: readonly WorkspaceScopeOptionV1[];
  readonly onSubmit: (input: WorkspaceMembershipInputV1) => void;
}

const PRESET_ROLE_OPTIONS = [
  { value: "project-risk-manager", label: "工程风险负责人" },
  { value: "reviewer", label: "复核人" },
  { value: "field-responder", label: "现场处置人" },
  { value: "business-viewer", label: "业务查看人" },
] as const;

export function ProjectMembershipForm({
  memberships,
  memberOptions,
  scopes,
  onSubmit,
}: ProjectMembershipFormPropsV1) {
  const [membershipId, setMembershipId] = useState("");
  const [roles, setRoles] = useState<readonly string[]>([]);
  const [scopeIds, setScopeIds] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<"active" | "removed">("active");
  const selected = memberships.find((item) => item.membershipRef.entityId === membershipId);
  const scopeById = new Map(scopes.map((scope) => [scope.scopeRef.entityId, scope]));
  const incomplete = selected === undefined || roles.length === 0 || scopeIds.length === 0;

  return (
    <div className="pjwf-form">
      <div className="pjwf-field">
        <label htmlFor="pjwf-membership">成员</label>
        <select
          id="pjwf-membership"
          value={membershipId}
          onChange={(event) => {
            setMembershipId(event.target.value);
            const target = memberships.find(
              (item) => item.membershipRef.entityId === event.target.value,
            );
            setRoles(target?.roles ?? []);
            setScopeIds([]);
          }}
        >
          <option value="">请选择工程成员</option>
          {memberships.map((item) => (
            <option key={item.membershipRef.entityId} value={item.membershipRef.entityId}>
              {item.displayName}（{item.accountRef.entityId}）
            </option>
          ))}
        </select>
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-roles">预设角色</label>
        <select
          id="pjwf-roles"
          multiple
          value={[...roles]}
          onChange={(event) =>
            setRoles(Array.from(event.target.selectedOptions, (option) => option.value).slice(0, 4))
          }
        >
          {PRESET_ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-scopes">空间范围</label>
        <select
          id="pjwf-scopes"
          multiple
          value={[...scopeIds]}
          onChange={(event) =>
            setScopeIds(Array.from(event.target.selectedOptions, (option) => option.value))
          }
        >
          {scopes
            .filter((scope) => scope.status === "active")
            .map((scope) => (
              <option key={scope.scopeRef.entityId} value={scope.scopeRef.entityId}>
                {scope.scopeRef.entityId}
              </option>
            ))}
        </select>
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-status">成员状态</label>
        <select
          id="pjwf-status"
          value={status}
          onChange={(event) => setStatus(event.target.value === "removed" ? "removed" : "active")}
        >
          <option value="active">有效</option>
          <option value="removed">移除</option>
        </select>
      </div>
      <button
        type="button"
        className="pjwf-primary"
        disabled={incomplete}
        onClick={() => {
          if (selected === undefined) return;
          onSubmit({
            membershipId: selected.membershipRef.entityId,
            accountId: selected.accountRef.entityId,
            expectedVersion: {
              entityId: selected.membershipRef.entityId,
              versionId: selected.membershipRef.versionId,
            },
            roles,
            spatialScopeRefs: scopeIds.flatMap((scopeId) => {
              const scope = scopeById.get(scopeId);
              return scope === undefined
                ? []
                : [
                    {
                      kind: "spatial-scope" as const,
                      reference: {
                        entityId: scope.scopeRef.entityId,
                        versionId: scope.scopeRef.versionId,
                      },
                    },
                  ];
            }),
            status,
          });
        }}
      >
        提交成员修订
      </button>
      {memberOptions.length === 0 && (
        <p className="pjwf-note">当前工程没有可用成员；新增成员仍从系统管理入口登记。</p>
      )}
    </div>
  );
}
