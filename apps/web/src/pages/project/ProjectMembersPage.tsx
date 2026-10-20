import { useEffect, useState } from "react";

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
import { listSourceCatalog, type SourceCatalogItemView } from "../../api/operations";
import { clientError } from "../../api/client";
import type {
  CommandConfirmationPlanV1,
  CommandConfirmationScopeV1,
} from "../../shared/confirmation";
import {
  ProjectMembershipForm,
  WorkspacePageMore,
  useWorkspaceDirectory,
  type WorkspaceDirectoryV1,
  type WorkspaceKindRefV1,
  type WorkspaceMembershipInputV1,
  type WorkspaceScopeOptionV1,
} from "./ProjectMembershipForm";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import "./ProjectWorkspace.css";

/**
 * 成员与资料访问页（design D-04）。
 *
 * 成员、空间、成员选项与来源目录都是有界服务端页，续页只在用户显式点击时按原游标追加，
 * 选择独立于当前页。四类维护动作复用原 C06 命令与统一确认：成员修订/移除、
 * 新建与修订授权空间、单来源访问修订；读取失败或对象/工程切换时不保留旧授权状态。
 */
const ROLE_LABEL: Record<string, string> = {
  "system-administrator": "系统管理员",
  "project-risk-manager": "工程风险负责人",
  reviewer: "复核人",
  "field-responder": "现场处置人",
  "business-viewer": "业务查看人",
};
const VISIBILITY_LABEL: Record<string, string> = {
  "project-shared": "工程内共享",
  restricted: "指定可见",
};

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
    key: "scopes",
    title: "空间范围",
    width: 220,
    render: (row) => (
      <span className="mono">
        {(row.scopes as readonly string[]).length === 0
          ? "—"
          : (row.scopes as readonly string[]).join("、")}
      </span>
    ),
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

const kindScopeRef = (ref: {
  readonly entityId: string;
  readonly versionId: string;
}): WorkspaceKindRefV1 => ({
  kind: "spatial-scope",
  reference: { entityId: ref.entityId, versionId: ref.versionId },
});

/** 新建空间身份只在表单生成一次；追加成功后重新生成，重试沿用同一身份。 */
const newScopeId = (): string => `spatial-scope-${globalThis.crypto.randomUUID()}`;

export default function ProjectMembersPage() {
  const { selector } = useEngineering();
  const projectId = selector.projectId ?? "";
  const confirmationScope = useProjectConfirmationScope();

  const memberships = useWorkspaceDirectory<WorkspaceMembershipView>(
    (id, signal, cursor) =>
      listWorkspaceMemberships(id, signal, cursor === undefined ? {} : { cursor }),
    [projectId],
  );
  const scopes = useWorkspaceDirectory<WorkspaceSpatialScopeView>(
    (id, signal, cursor) =>
      listWorkspaceSpatialScopes(id, signal, cursor === undefined ? {} : { cursor }),
    [projectId],
  );
  const options = useWorkspaceDirectory<WorkspaceMemberOptionView>(
    (id, signal, cursor) =>
      listWorkspaceMemberOptions(id, signal, cursor === undefined ? {} : { cursor }),
    [projectId],
  );
  const catalog = useWorkspaceDirectory<SourceCatalogItemView>(
    (id, signal, cursor) => listSourceCatalog(id, cursor === undefined ? {} : { cursor }, signal),
    [projectId],
  );

  const [pending, setPending] = useState<WorkspaceMembershipInputV1 | null>(null);
  const [source, setSource] = useState<SourceCatalogItemView | null>(null);

  // 工程切换即清空旧对象选择与待确认输入；旧确认由 ConfirmButton 的 scope 变化失效。
  useEffect(() => {
    setPending(null);
    setSource(null);
  }, [projectId, selector.revisionId]);

  const membershipPlan = (): CommandConfirmationPlanV1<PreparedWorkspaceAccessCommandV1> => {
    if (confirmationScope === undefined || confirmationScope.kind !== "project")
      throw clientError("CONTRACT_INVALID");
    if (pending === null) throw clientError("CONTRACT_INVALID");
    const request = prepareWorkspaceAccessCommand(projectId, {
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
      scope: confirmationScope,
      targets: [],
      inputVersions: [pending.expectedVersion],
      expectedFacts: [
        `对象：工程成员 ${pending.accountId}`,
        `预设角色：${pending.roles.map((role) => ROLE_LABEL[role] ?? role).join("、")}`,
        `空间范围：${pending.spatialScopeRefs.map((ref) => ref.reference.entityId).join("、")}`,
        `成员状态：${pending.status === "removed" ? "移除" : "有效"}`,
        "预计结果：新请求立即按新的空间范围与角色决定",
        "副作用：历史身份保留，撤权不删除历史审计",
      ],
      externalEffects: ["修订工程成员访问"],
      impact: pending.status === "removed" ? "high" : "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  return (
    <AppShell
      activeNav="project"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
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
                    roles: item.roles.map((role) => ROLE_LABEL[role] ?? role),
                    scopes: item.spatialScopeRefs.map((ref) => ref.reference.entityId),
                    status: item.status,
                  }))}
                />
              )}
            </PageStateView>
            <WorkspacePageMore
              nextCursor={memberships.nextCursor}
              loading={memberships.loadingMore}
              error={memberships.moreError}
              label="加载更多成员"
              onLoad={memberships.loadMore}
            />
          </Card>

          <Card title="成员修订">
            {memberships.state.kind !== "ready" ? (
              <PageStateView
                state={memberships.state}
                title="工程成员目录"
                emptyMessage="当前工程尚无成员"
                onRetry={memberships.retry}
              >
                {() => null}
              </PageStateView>
            ) : scopes.state.kind !== "ready" ? (
              <PageStateView
                state={scopes.state}
                title="授权空间目录"
                emptyMessage="当前工程尚无授权空间"
                onRetry={scopes.retry}
              >
                {() => null}
              </PageStateView>
            ) : (
              <ProjectMembershipForm
                key={projectId}
                memberships={memberships.state.value.map((item) => ({
                  membershipRef: item.membershipRef,
                  accountRef: item.accountRef,
                  displayName: item.displayName,
                  roles: item.roles,
                  spatialScopeRefs: item.spatialScopeRefs,
                  status: item.status,
                }))}
                scopes={scopes.state.value.map((item) => ({
                  scopeRef: item.scopeRef,
                  ...(item.parentScopeRef === undefined
                    ? {}
                    : { parentScopeRef: item.parentScopeRef }),
                  status: item.status,
                }))}
                onSubmit={(input) => setPending(input)}
                onDraftChange={() => setPending(null)}
              />
            )}
            {pending === null ? null : (
              <ConfirmButton
                label="确认提交成员修订"
                tone={pending.status === "removed" ? "danger" : "primary"}
                availability={
                  confirmationScope === undefined
                    ? { kind: "unavailable", reason: "context-incomplete" }
                    : { kind: "allowed" }
                }
                requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
                scope={confirmationScope}
                intentRevision={JSON.stringify([
                  projectId,
                  pending.membershipId,
                  pending.expectedVersion.versionId,
                  pending.accountId,
                  pending.roles,
                  pending.spatialScopeRefs.map((ref) => [
                    ref.reference.entityId,
                    ref.reference.versionId,
                  ]),
                  pending.status,
                ])}
                createPlan={membershipPlan}
                submit={async (frozen) => {
                  await sendWorkspaceAccessCommand(frozen.request);
                  return { kind: "command-result", result: { kind: "access-membership" } };
                }}
                onSucceeded={() => {
                  setPending(null);
                  memberships.retry();
                }}
                onClosed={() => setPending(null)}
              />
            )}
          </Card>

          <Card title="授权空间">
            {scopes.state.kind === "ready" ? (
              <SpatialScopeForms
                key={projectId}
                projectId={projectId}
                scopes={scopes.state.value.map((item) => ({
                  scopeRef: item.scopeRef,
                  ...(item.parentScopeRef === undefined
                    ? {}
                    : { parentScopeRef: item.parentScopeRef }),
                  status: item.status,
                }))}
                confirmationScope={confirmationScope}
                onSucceeded={scopes.retry}
              />
            ) : (
              <PageStateView
                state={scopes.state}
                title="授权空间"
                emptyMessage="当前工程尚无授权空间"
                onRetry={scopes.retry}
              >
                {() => null}
              </PageStateView>
            )}
            <WorkspacePageMore
              nextCursor={scopes.nextCursor}
              loading={scopes.loadingMore}
              error={scopes.moreError}
              label="加载更多空间范围"
              onLoad={scopes.loadMore}
            />
          </Card>

          <Card title="资料访问授权">
            <div className="pjwf-form">
              <div className="pjwf-field">
                <label htmlFor="pjwf-source">资料版本</label>
                <select
                  id="pjwf-source"
                  value={
                    source === null
                      ? ""
                      : `${source.sourceVersionRef.reference.entityId}@${source.sourceVersionRef.reference.versionId}`
                  }
                  onChange={(event) => {
                    const selected =
                      catalog.state.kind === "ready"
                        ? catalog.state.value.find(
                            (item) =>
                              `${item.sourceVersionRef.reference.entityId}@${item.sourceVersionRef.reference.versionId}` ===
                              event.target.value,
                          )
                        : undefined;
                    setSource(selected ?? null);
                  }}
                >
                  <option value="">请选择已登记资料</option>
                  {catalog.state.kind === "ready" &&
                    catalog.state.value.map((item) => (
                      <option
                        key={`${item.sourceVersionRef.reference.entityId}@${item.sourceVersionRef.reference.versionId}`}
                        value={`${item.sourceVersionRef.reference.entityId}@${item.sourceVersionRef.reference.versionId}`}
                      >
                        {String(item.sourceName ?? item.sourceId)}
                      </option>
                    ))}
                  {source !== null &&
                  !(
                    catalog.state.kind === "ready" &&
                    catalog.state.value.some(
                      (item) =>
                        `${item.sourceVersionRef.reference.entityId}@${item.sourceVersionRef.reference.versionId}` ===
                        `${source.sourceVersionRef.reference.entityId}@${source.sourceVersionRef.reference.versionId}`,
                    )
                  ) ? (
                    <option
                      value={`${source.sourceVersionRef.reference.entityId}@${source.sourceVersionRef.reference.versionId}`}
                    >
                      {String(source.sourceName ?? source.sourceId)}
                    </option>
                  ) : null}
                </select>
              </div>
            </div>
            <WorkspacePageMore
              nextCursor={catalog.nextCursor}
              loading={catalog.loadingMore}
              error={catalog.moreError}
              label="加载更多资料"
              onLoad={catalog.loadMore}
            />
            {catalog.state.kind === "ready" || catalog.state.kind === "loading" ? null : (
              <PageStateView
                state={catalog.state}
                title="资料目录"
                emptyMessage="当前工程尚无已登记资料"
                onRetry={catalog.retry}
              >
                {() => null}
              </PageStateView>
            )}
            {source === null ? (
              <p className="pjwf-note">选择精确资料版本后读取其当前访问授权。</p>
            ) : (
              <SourceAccessEditor
                key={`${source.sourceVersionRef.reference.entityId}@${source.sourceVersionRef.reference.versionId}`}
                projectId={projectId}
                source={source}
                scopes={scopes}
                options={options}
                confirmationScope={confirmationScope}
              />
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function SourceAccessEditor({
  projectId,
  source,
  scopes,
  options,
  confirmationScope,
}: {
  readonly projectId: string;
  readonly source: SourceCatalogItemView;
  readonly scopes: WorkspaceDirectoryV1<WorkspaceSpatialScopeView>;
  readonly options: WorkspaceDirectoryV1<WorkspaceMemberOptionView>;
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
}) {
  const sourceEntityId = source.sourceVersionRef.reference.entityId;
  const sourceVersionId = source.sourceVersionRef.reference.versionId;
  const read = usePageQuery<WorkspaceSourceAccessView>(
    (id, signal) => readWorkspaceSourceAccess(id, source.sourceVersionRef, signal),
    [projectId, sourceEntityId, sourceVersionId],
  );
  const access = read.state.kind === "ready" ? read.state.value : null;

  const [visibility, setVisibility] = useState("project-shared");
  const [allowedAccountIds, setAllowedAccountIds] = useState<readonly string[]>([]);
  const [spatialScopeRefs, setSpatialScopeRefs] = useState<readonly WorkspaceKindRefV1[]>([]);
  const [touched, setTouched] = useState(false);

  // 读取成功即按服务端当前授权重填；读取失败或切换来源不保留上一次的授权状态。
  useEffect(() => {
    setVisibility(access?.visibility ?? "project-shared");
    setAllowedAccountIds(access?.allowedAccountIds ?? []);
    setSpatialScopeRefs(
      access === null
        ? []
        : access.spatialScopeRefs.map((ref) => ({
            kind: "spatial-scope",
            reference: { entityId: ref.reference.entityId, versionId: ref.reference.versionId },
          })),
    );
    setTouched(false);
  }, [access]);

  const memberOptions =
    options.state.kind === "ready"
      ? options.state.value
      : ([] as readonly WorkspaceMemberOptionView[]);
  const directoryScopes =
    scopes.state.kind === "ready"
      ? scopes.state.value
      : ([] as readonly WorkspaceSpatialScopeView[]);
  const accountIds = [
    ...new Set([...memberOptions.map((item) => item.accountRef.entityId), ...allowedAccountIds]),
  ];
  const scopeIds = [
    ...new Set([
      ...directoryScopes.map((item) => item.scopeRef.entityId),
      ...spatialScopeRefs.map((ref) => ref.reference.entityId),
    ]),
  ];

  const issues: string[] = [];
  if (access !== null && confirmationScope === undefined) issues.push("当前会话不能构造工程命令");

  const plan = (): CommandConfirmationPlanV1<PreparedWorkspaceAccessCommandV1> => {
    if (confirmationScope === undefined || confirmationScope.kind !== "project")
      throw clientError("CONTRACT_INVALID");
    if (access === null || issues.length > 0) throw clientError("CONTRACT_INVALID");
    const request = prepareWorkspaceAccessCommand(projectId, {
      kind: "revise-source-access",
      expectedVersion: access.sourceGrantRef,
      sourceVersionRef: source.sourceVersionRef,
      visibility,
      allowedAccountIds,
      spatialScopeRefs,
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "project-workspace-access.execute",
      scope: confirmationScope,
      targets: [],
      inputVersions: [access.sourceGrantRef],
      expectedFacts: [
        `对象：资料 ${String(source.sourceName ?? source.sourceId)}`,
        `可见范围：${VISIBILITY_LABEL[visibility] ?? visibility}`,
        `指定账号：${allowedAccountIds.length === 0 ? "—" : allowedAccountIds.join("、")}`,
        `空间范围：${spatialScopeRefs.map((ref) => ref.reference.entityId).join("、")}`,
        `登记人：${access.registeredByAccountId}（服务端来源登记事实）`,
        "预计结果：下一次读取立即按新范围决定；历史身份与审计保留",
      ],
      externalEffects: ["修订资料访问授权"],
      impact: "high",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  if (read.state.kind !== "ready") {
    return (
      <PageStateView
        state={read.state}
        title="资料访问授权"
        emptyMessage="该资料尚无访问授权"
        forbiddenHint="该精确来源尚未完成授权绑定，或其当前授权对本会话不可见"
        onRetry={read.retry}
      >
        {() => null}
      </PageStateView>
    );
  }
  if (access === null) return null;

  return (
    <div className="pjwf-region" data-form="source-access">
      <dl className="pjwf-facts">
        <dt>来源登记人</dt>
        <dd className="mono" data-fact="来源登记人">
          {access.registeredByAccountId}
        </dd>
        <dt>授权引用</dt>
        <dd className="mono" data-fact="授权引用">
          {access.sourceGrantRef.entityId}@{access.sourceGrantRef.versionId}
        </dd>
      </dl>
      <div className="pjwf-form">
        <div className="pjwf-field">
          <label htmlFor="pjwf-source-visibility">可见范围</label>
          <select
            id="pjwf-source-visibility"
            value={visibility}
            onChange={(event) => {
              setTouched(true);
              setVisibility(event.target.value);
            }}
          >
            <option value="project-shared">工程内共享</option>
            <option value="restricted">指定可见</option>
          </select>
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-source-accounts">指定账号</label>
          <select
            id="pjwf-source-accounts"
            multiple
            value={[...allowedAccountIds]}
            onChange={(event) => {
              setTouched(true);
              setAllowedAccountIds(
                Array.from(event.target.selectedOptions, (option) => option.value),
              );
            }}
          >
            {accountIds.map((accountId) => {
              const member = memberOptions.find((item) => item.accountRef.entityId === accountId);
              return (
                <option key={accountId} value={accountId}>
                  {member === undefined ? accountId : `${member.displayName}（${accountId}）`}
                </option>
              );
            })}
          </select>
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-source-scopes">空间范围</label>
          <select
            id="pjwf-source-scopes"
            multiple
            value={spatialScopeRefs.map((ref) => ref.reference.entityId)}
            onChange={(event) => {
              setTouched(true);
              const wanted = new Set(
                Array.from(event.target.selectedOptions, (option) => option.value),
              );
              setSpatialScopeRefs((current) => {
                const kept = current.filter((ref) => wanted.has(ref.reference.entityId));
                const keptIds = new Set(kept.map((ref) => ref.reference.entityId));
                const added = [...wanted]
                  .filter((entityId) => !keptIds.has(entityId))
                  .flatMap((entityId) => {
                    const fromDirectory = directoryScopes.find(
                      (item) => item.scopeRef.entityId === entityId,
                    );
                    if (fromDirectory !== undefined) return [kindScopeRef(fromDirectory.scopeRef)];
                    const fromAccess = access.spatialScopeRefs.find(
                      (ref) => ref.reference.entityId === entityId,
                    );
                    return fromAccess === undefined
                      ? []
                      : [
                          {
                            kind: "spatial-scope",
                            reference: {
                              entityId: fromAccess.reference.entityId,
                              versionId: fromAccess.reference.versionId,
                            },
                          },
                        ];
                  });
                return [...kept, ...added];
              });
            }}
          >
            {scopeIds.map((scopeId) => (
              <option key={scopeId} value={scopeId}>
                {scopeId}
              </option>
            ))}
          </select>
        </div>
      </div>
      <WorkspacePageMore
        nextCursor={options.nextCursor}
        loading={options.loadingMore}
        error={options.moreError}
        label="加载更多成员选项"
        onLoad={options.loadMore}
      />
      {touched && issues.length > 0 ? (
        <ul className="pjwf-error-summary" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="pjwf-note">
        新版本用于后续读取，历史引用保留；指定账号只从本工程有效成员选择，登记人由服务端来源事实给出。
      </p>
      <ConfirmButton
        label="确认修订资料访问授权"
        tone="danger"
        availability={
          issues.length === 0
            ? { kind: "allowed" }
            : { kind: "unavailable", reason: "context-incomplete" }
        }
        requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
        scope={confirmationScope}
        intentRevision={JSON.stringify([
          projectId,
          sourceEntityId,
          sourceVersionId,
          access.sourceGrantRef.versionId,
          visibility,
          allowedAccountIds,
          spatialScopeRefs.map((ref) => [ref.reference.entityId, ref.reference.versionId]),
        ])}
        createPlan={plan}
        submit={async (frozen) => {
          await sendWorkspaceAccessCommand(frozen.request);
          return { kind: "command-result", result: { kind: "access-source" } };
        }}
        onSucceeded={() => read.retry()}
      />
    </div>
  );
}

function SpatialScopeForms({
  projectId,
  scopes,
  confirmationScope,
  onSucceeded,
}: {
  readonly projectId: string;
  readonly scopes: readonly WorkspaceScopeOptionV1[];
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
  readonly onSucceeded: () => void;
}) {
  return (
    <div className="pjwf-regions">
      <CreateSpatialScopeForm
        projectId={projectId}
        scopes={scopes}
        confirmationScope={confirmationScope}
        onSucceeded={onSucceeded}
      />
      <ReviseSpatialScopeForm
        projectId={projectId}
        scopes={scopes}
        confirmationScope={confirmationScope}
        onSucceeded={onSucceeded}
      />
    </div>
  );
}

function CreateSpatialScopeForm({
  projectId,
  scopes,
  confirmationScope,
  onSucceeded,
}: {
  readonly projectId: string;
  readonly scopes: readonly WorkspaceScopeOptionV1[];
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
  readonly onSucceeded: () => void;
}) {
  const [scopeId, setScopeId] = useState(newScopeId);
  const [parentScopeId, setParentScopeId] = useState("");
  const [touched, setTouched] = useState(false);
  const parents = scopes.filter((scope) => scope.status === "active");
  const parent = parents.find((scope) => scope.scopeRef.entityId === parentScopeId);
  const issues: string[] = [];
  if (parentScopeId === "") issues.push("请选择父空间");
  else if (parent === undefined) issues.push("父空间必须是当前有效的授权空间");

  const plan = (): CommandConfirmationPlanV1<PreparedWorkspaceAccessCommandV1> => {
    if (confirmationScope === undefined || confirmationScope.kind !== "project")
      throw clientError("CONTRACT_INVALID");
    if (parent === undefined) throw clientError("CONTRACT_INVALID");
    const request = prepareWorkspaceAccessCommand(projectId, {
      kind: "create-spatial-scope",
      expectedVersion: "none",
      scopeId,
      parentScopeRef: kindScopeRef(parent.scopeRef),
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "project-workspace-access.execute",
      scope: confirmationScope,
      targets: [],
      inputVersions: [parent.scopeRef],
      expectedFacts: [
        `对象：新授权空间 ${scopeId}`,
        `父空间：${parent.scopeRef.entityId}`,
        "预计结果：新增独立空间身份，不改变已有空间版本",
      ],
      externalEffects: ["新建工程授权空间"],
      impact: "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  return (
    <div className="pjwf-region" data-form="create-spatial-scope">
      <h3 className="pjwf-subtitle">新建子空间</h3>
      <div className="pjwf-form">
        <div className="pjwf-field">
          <label htmlFor="pjwf-create-parent">父空间</label>
          <select
            id="pjwf-create-parent"
            value={parentScopeId}
            onChange={(event) => {
              setTouched(true);
              setParentScopeId(event.target.value);
            }}
          >
            <option value="">请选择有效父空间</option>
            {parents.map((scope) => (
              <option key={scope.scopeRef.entityId} value={scope.scopeRef.entityId}>
                {scope.scopeRef.entityId}
              </option>
            ))}
          </select>
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-create-id">新空间标识（系统生成）</label>
          <input id="pjwf-create-id" value={scopeId} readOnly className="mono" />
        </div>
      </div>
      {touched && issues.length > 0 ? (
        <ul className="pjwf-error-summary" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <ConfirmButton
        label="确认新建授权空间"
        tone="primary"
        availability={
          issues.length === 0 && confirmationScope !== undefined
            ? { kind: "allowed" }
            : { kind: "unavailable", reason: "context-incomplete" }
        }
        requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
        scope={confirmationScope}
        intentRevision={JSON.stringify([projectId, scopeId, parentScopeId])}
        createPlan={plan}
        submit={async (frozen) => {
          await sendWorkspaceAccessCommand(frozen.request);
          return { kind: "command-result", result: { kind: "access-spatial-scope" } };
        }}
        onSucceeded={() => {
          setScopeId(newScopeId());
          setParentScopeId("");
          setTouched(false);
          onSucceeded();
        }}
      />
    </div>
  );
}

function ReviseSpatialScopeForm({
  projectId,
  scopes,
  confirmationScope,
  onSucceeded,
}: {
  readonly projectId: string;
  readonly scopes: readonly WorkspaceScopeOptionV1[];
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
  readonly onSucceeded: () => void;
}) {
  const [scopeId, setScopeId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [parentScopeId, setParentScopeId] = useState("");
  const [touched, setTouched] = useState(false);
  const selected = scopes.find((scope) => scope.scopeRef.entityId === scopeId);
  const rootScope = selected !== undefined && selected.parentScopeRef === undefined;
  const parents = scopes.filter(
    (scope) => scope.status === "active" && scope.scopeRef.entityId !== scopeId,
  );
  const parent =
    parentScopeId === ""
      ? undefined
      : (parents.find((scope) => scope.scopeRef.entityId === parentScopeId) ??
        (selected?.parentScopeRef?.entityId === parentScopeId ? selected : undefined));
  const issues: string[] = [];
  if (selected === undefined) issues.push("请选择要修订的授权空间");
  if (selected !== undefined && !rootScope && parent === undefined)
    issues.push("非根空间必须保留一个有效父空间");

  const plan = (): CommandConfirmationPlanV1<PreparedWorkspaceAccessCommandV1> => {
    if (confirmationScope === undefined || confirmationScope.kind !== "project")
      throw clientError("CONTRACT_INVALID");
    if (selected === undefined) throw clientError("CONTRACT_INVALID");
    if (!rootScope && parent === undefined) throw clientError("CONTRACT_INVALID");
    const request = prepareWorkspaceAccessCommand(projectId, {
      kind: "revise-spatial-scope",
      expectedVersion: selected.scopeRef,
      scopeId: selected.scopeRef.entityId,
      status,
      ...(rootScope || parent === undefined
        ? {}
        : { parentScopeRef: kindScopeRef(parent.scopeRef) }),
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "project-workspace-access.execute",
      scope: confirmationScope,
      targets: [],
      inputVersions: [selected.scopeRef],
      expectedFacts: [
        `对象：授权空间 ${selected.scopeRef.entityId}`,
        `空间状态：${status === "inactive" ? "已停用" : "进行中"}`,
        ...(rootScope || parent === undefined ? [] : [`父空间：${parent.scopeRef.entityId}`]),
        "预计结果：新请求立即按新授权决定；历史版本与审计保留",
      ],
      externalEffects: ["修订工程授权空间"],
      impact: status === "inactive" ? "high" : "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  return (
    <div className="pjwf-region" data-form="revise-spatial-scope">
      <h3 className="pjwf-subtitle">修订授权空间</h3>
      <div className="pjwf-form">
        <div className="pjwf-field">
          <label htmlFor="pjwf-revise-scope">授权空间</label>
          <select
            id="pjwf-revise-scope"
            value={scopeId}
            onChange={(event) => {
              const next = scopes.find((scope) => scope.scopeRef.entityId === event.target.value);
              setScopeId(event.target.value);
              setStatus(next?.status === "inactive" ? "inactive" : "active");
              setParentScopeId(next?.parentScopeRef?.entityId ?? "");
              setTouched(false);
            }}
          >
            <option value="">请选择授权空间</option>
            {scopes.map((scope) => (
              <option key={scope.scopeRef.entityId} value={scope.scopeRef.entityId}>
                {scope.scopeRef.entityId}
                {scope.status === "inactive" ? "（已停用）" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-revise-status">空间状态</label>
          <select
            id="pjwf-revise-status"
            value={status}
            disabled={selected === undefined}
            onChange={(event) => {
              setTouched(true);
              setStatus(event.target.value === "inactive" ? "inactive" : "active");
            }}
          >
            <option value="active">进行中</option>
            <option value="inactive">已停用</option>
          </select>
        </div>
        {rootScope ? null : (
          <div className="pjwf-field">
            <label htmlFor="pjwf-revise-parent">父空间</label>
            <select
              id="pjwf-revise-parent"
              value={parentScopeId}
              disabled={selected === undefined}
              onChange={(event) => {
                setTouched(true);
                setParentScopeId(event.target.value);
              }}
            >
              <option value="">请选择有效父空间</option>
              {parents.map((scope) => (
                <option key={scope.scopeRef.entityId} value={scope.scopeRef.entityId}>
                  {scope.scopeRef.entityId}
                </option>
              ))}
              {parentScopeId !== "" &&
              !parents.some((scope) => scope.scopeRef.entityId === parentScopeId) ? (
                <option value={parentScopeId}>{parentScopeId}</option>
              ) : null}
            </select>
          </div>
        )}
      </div>
      {touched && issues.length > 0 ? (
        <ul className="pjwf-error-summary" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="pjwf-note">停用立即对后续读取生效；历史授权版本与审计保留。</p>
      <ConfirmButton
        label="确认修订授权空间"
        tone={status === "inactive" ? "danger" : "primary"}
        availability={
          issues.length === 0 && confirmationScope !== undefined
            ? { kind: "allowed" }
            : { kind: "unavailable", reason: "context-incomplete" }
        }
        requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
        scope={confirmationScope}
        intentRevision={JSON.stringify([
          projectId,
          selected?.scopeRef.entityId ?? "",
          selected?.scopeRef.versionId ?? "",
          status,
          parentScopeId,
        ])}
        createPlan={plan}
        submit={async (frozen) => {
          await sendWorkspaceAccessCommand(frozen.request);
          return { kind: "command-result", result: { kind: "access-spatial-scope" } };
        }}
        onSucceeded={() => {
          setScopeId("");
          setTouched(false);
          onSucceeded();
        }}
      />
    </div>
  );
}
