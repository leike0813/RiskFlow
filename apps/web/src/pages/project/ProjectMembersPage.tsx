import { useState } from "react";

import AppShell from "../../components/AppShell";
import { Card } from "../../components/Card";
import { ConfirmButton, useProjectConfirmationScope } from "../../components/ConfirmButton";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { PageStateView } from "../../components/PageStateView";
import { SectionTabs } from "../../components/SectionTabs";
import { StatusTag } from "../../components/StatusTag";
import { useEngineering, usePageQuery } from "../../api/engineering";
import {
  listWorkspaceMemberOptions,
  listWorkspaceMemberships,
  listWorkspaceSpatialScopes,
  prepareWorkspaceAccessCommand,
  readWorkspaceSourceAccess,
  sendWorkspaceAccessCommand,
  type PreparedWorkspaceAccessCommandV1,
  type WorkspaceMemberOptionView,
  type WorkspaceMembershipView,
  type WorkspaceSpatialScopeView,
  type WorkspaceSourceAccessView,
} from "../../api/engineeringWorkspace";
import { listSourceCatalog, type SourceCatalogPageView } from "../../api/operations";
import { clientError } from "../../api/client";
import type { CommandConfirmationPlanV1 } from "../../shared/confirmation";
import { ProjectMembershipForm, type WorkspaceMembershipInputV1 } from "./ProjectMembershipForm";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import "./ProjectWorkspace.css";

/**
 * 成员与资料访问页（design D-04）。
 *
 * 成员目录、空间目录与单来源访问授权都只向当前工程风险管理员披露；不开放全局账号目录。
 * 成员修订沿原访问维护命令提交，新请求立即按新范围决定，历史身份不删除。
 */
const columns: DataTableColumn[] = [
  {
    key: "displayName",
    title: "成员",
    render: (row) => String(row.displayName),
  },
  {
    key: "accountRef",
    title: "账号",
    width: 220,
    render: (row) => <span className="mono">{String(row.accountRef)}</span>,
  },
  {
    key: "roles",
    title: "预设角色",
    width: 200,
    render: (row) => (row.roles as readonly string[]).join("、"),
  },
  {
    key: "status",
    title: "状态",
    width: 100,
    render: (row) => (
      <StatusTag tone={row.status === "active" ? "success" : "neutral"}>
        {row.status === "active" ? "有效" : "已移除"}
      </StatusTag>
    ),
  },
];

export default function ProjectMembersPage() {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const scope = useProjectConfirmationScope();

  const memberships = usePageQuery<readonly WorkspaceMembershipView[]>(
    (id, signal) => listWorkspaceMemberships(id, signal),
    [projectId],
  );
  const scopes = usePageQuery<readonly WorkspaceSpatialScopeView[]>(
    (id, signal) => listWorkspaceSpatialScopes(id, signal),
    [projectId],
  );
  const options = usePageQuery<readonly WorkspaceMemberOptionView[]>(
    (id, signal) => listWorkspaceMemberOptions(id, signal),
    [projectId],
  );
  const catalog = usePageQuery<SourceCatalogPageView>(
    (id, signal) => listSourceCatalog(id, {}, signal),
    [projectId],
  );

  const [pending, setPending] = useState<WorkspaceMembershipInputV1 | null>(null);
  const [sourceVersionRef, setSourceVersionRef] = useState("");
  const [sourceAccess, setSourceAccess] = useState<WorkspaceSourceAccessView | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const plan = (): CommandConfirmationPlanV1<PreparedWorkspaceAccessCommandV1> => {
    if (scope === undefined || scope.kind !== "project") throw clientError("CONTRACT_INVALID");
    if (pending === null) throw clientError("CONTRACT_INVALID");
    const request = prepareWorkspaceAccessCommand(projectId ?? "", {
      kind: "revise-membership",
      expectedVersion: pending.expectedVersion,
      membershipId: pending.membershipId,
      accountId: pending.accountId,
      roles: pending.roles,
      spatialScopeRefs: pending.spatialScopeRefs,
      status: pending.status,
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "project-workspace-access.execute",
      scope,
      targets: [],
      inputVersions: [pending.expectedVersion],
      expectedFacts: [
        `对象：工程成员 ${pending.accountId}`,
        `预设角色：${pending.roles.join("、")}`,
        "预计结果：新请求立即按新的空间范围与角色决定",
        "副作用：历史身份保留，撤权不删除历史审计",
      ],
      externalEffects: ["修订工程成员访问"],
      impact: "high",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  const readSourceAccess = async (): Promise<void> => {
    setSourceError(null);
    try {
      const selected = catalog.state.kind === "ready" ? catalog.state.value.items : [];
      const item = selected.find(
        (entry) => entry.sourceVersionRef.reference.entityId === sourceVersionRef,
      );
      if (item === undefined) {
        setSourceAccess(null);
        return;
      }
      setSourceAccess(await readWorkspaceSourceAccess(projectId ?? "", item.sourceVersionRef));
    } catch (error) {
      setSourceAccess(null);
      setSourceError(error instanceof Error ? error.message : "读取失败");
    }
  };

  return (
    <AppShell activeNav="project" agentContext={projectId === null ? [] : [projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">成员与资料访问</h1>
            <p className="page-subtitle">工程成员的预设角色、空间范围与单来源访问授权</p>
          </div>
        </header>

        <SectionTabs items={[...PROJECT_NAVIGATION_ITEMS_V1]} />

        <div className="pjwf-regions">
          <Card title="工程成员">
            <PageStateView
              state={memberships.state}
              title="工程成员目录"
              emptyMessage="当前工程尚无成员"
              onRetry={memberships.retry}
            >
              {(items) => (
                <DataTable
                  columns={columns}
                  rows={items.map((item) => ({
                    displayName: item.displayName,
                    accountRef: item.accountRef.entityId,
                    roles: item.roles,
                    status: item.status,
                  }))}
                />
              )}
            </PageStateView>
          </Card>

          <Card title="成员修订">
            {memberships.state.kind === "ready" &&
            scopes.state.kind === "ready" &&
            options.state.kind === "ready" ? (
              <ProjectMembershipForm
                memberships={memberships.state.value.map((item) => ({
                  membershipRef: item.membershipRef,
                  accountRef: item.accountRef,
                  displayName: item.displayName,
                  roles: item.roles,
                  status: item.status,
                }))}
                memberOptions={options.state.value.map((item) => ({
                  accountRef: item.accountRef,
                  displayName: item.displayName,
                }))}
                scopes={scopes.state.value.map((item) => ({
                  scopeRef: item.scopeRef,
                  status: item.status,
                }))}
                onSubmit={(input) => setPending(input)}
              />
            ) : (
              <p className="pjwf-note">成员、空间与成员选项读取就绪后可提交修订。</p>
            )}
            {pending !== null && (
              <ConfirmButton
                label="确认提交成员修订"
                tone="danger"
                availability={{ kind: "allowed" }}
                requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
                scope={scope}
                intentRevision={JSON.stringify([
                  pending.membershipId,
                  pending.accountId,
                  pending.roles,
                  pending.spatialScopeRefs,
                  pending.status,
                ])}
                createPlan={plan}
                submit={async (frozen) => {
                  const result = await sendWorkspaceAccessCommand(frozen.request);
                  return {
                    kind: "command-result",
                    result: {
                      kind: "membership",
                      resultRef: {
                        kind: "authorization-context",
                        reference: result,
                      },
                    },
                  };
                }}
                onSucceeded={() => {
                  setPending(null);
                  memberships.retry();
                }}
                onClosed={() => setPending(null)}
              />
            )}
          </Card>

          <Card title="资料访问授权">
            <div className="pjwf-form">
              <div className="pjwf-field">
                <label htmlFor="pjwf-source">资料版本</label>
                <select
                  id="pjwf-source"
                  value={sourceVersionRef}
                  onChange={(event) => setSourceVersionRef(event.target.value)}
                >
                  <option value="">请选择已登记资料</option>
                  {catalog.state.kind === "ready" &&
                    catalog.state.value.items.map((item) => (
                      <option
                        key={item.sourceVersionRef.reference.entityId}
                        value={item.sourceVersionRef.reference.entityId}
                      >
                        {String(item.sourceName ?? item.sourceId)}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="button"
                className="pjwf-primary"
                disabled={sourceVersionRef === ""}
                onClick={() => void readSourceAccess()}
              >
                读取访问授权
              </button>
            </div>
            {sourceError !== null && <p className="pjwf-note">读取失败：{sourceError}</p>}
            {sourceAccess !== null && (
              <dl className="pjwf-facts">
                <dt>可见范围</dt>
                <dd>{sourceAccess.visibility === "project-shared" ? "工程内共享" : "指定可见"}</dd>
                <dt>指定账号</dt>
                <dd className="mono">
                  {sourceAccess.allowedAccountIds.length === 0
                    ? "—"
                    : sourceAccess.allowedAccountIds.join("、")}
                </dd>
                <dt>授权引用</dt>
                <dd className="mono">
                  {sourceAccess.sourceGrantRef.entityId}@{sourceAccess.sourceGrantRef.versionId}
                </dd>
              </dl>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
