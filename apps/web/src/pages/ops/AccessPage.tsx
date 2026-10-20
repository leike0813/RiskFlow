/**
 * 账号与工程开通（v2 P-OP-01 的 A 骨架列表分区）。
 *
 * 事实全部来自 D-10 的系统管理接缝：identity、accounts/projects/memberships/
 * spatial-scopes 四个有界目录，以及 C06 原六项管理动作。页面不持有工程业务上下文，
 * 也不从业务能力推断管理员身份——获准动作取服务端返回的 allowedActions。
 *
 * 口令只存在于本组件的口令输入框与那一次请求体里：不写入任何 store、冻结命令表
 * 或确认摘要，提交成功、失败与关闭对话框后立即清空。
 */
import { useEffect, useState } from "react";
import { Card } from "../../components/Card";
import { ConfirmButton, useSystemConfirmationScope } from "../../components/ConfirmButton";
import { StatusTag } from "../../components/StatusTag";
import { VersionTag } from "../../components/VersionTag";
import {
  listSystemAccounts,
  listSystemMemberships,
  listSystemProjects,
  listSystemSpatialScopes,
  prepareCreateSystemAccount,
  prepareDisableSystemAccount,
  prepareOpenSystemProject,
  prepareResetSystemAccountPassword,
  prepareReviseSystemMembership,
  prepareSuspendSystemProject,
  readSystemIdentity,
  sendAdministrationCommand,
  type PreparedAdministrationCommandV1,
  type KindRef,
  type VersionRef,
  type SystemAccountView,
  type SystemMembershipView,
  type SystemProjectView,
  type SystemSpatialScopeView,
} from "../../api/agentAuditOperations";
import { clientError } from "../../api/client";
import { ProjectOpeningForm } from "../project/ProjectOpeningForm";
import type { CommandConfirmationPlanV1 } from "../../shared/confirmation";
import {
  ACCOUNT_STATUS_LABEL,
  HIGH_IMPACT_ACTIONS,
  MEMBERSHIP_STATUS_LABEL,
  PRESET_ROLE_LABEL,
  PROJECT_STATUS_LABEL,
  SCOPE_STATUS_LABEL,
  STATUS_TONE,
  SYSTEM_ACTION_LABEL,
  SystemReadView,
  OpsPage,
  useSystemRead,
} from "./opsShared";
import "./ops.css";

const PRESET_ROLES = [
  "system-administrator",
  "project-risk-manager",
  "reviewer",
  "field-responder",
  "business-viewer",
];

/** 六项动作的命令标识：同一次意图固定一个，重试沿用，改变字段即换新身份。 */
let commandSequence = 0;
const newCommandId = (action: string): string => {
  commandSequence += 1;
  return `demo-ui-${action}-${Date.now().toString(36)}-${commandSequence}`;
};

/** 待确认意图：只带目标与版本，口令不在其中。 */
type Intent =
  | {
      readonly action: "create-account";
      readonly commandId: string;
      readonly target: string;
      readonly loginName: string;
      readonly displayName: string;
      readonly summary: readonly string[];
    }
  | {
      readonly action: "disable-account";
      readonly commandId: string;
      readonly target: string;
      readonly expectedVersion: VersionRef;
      readonly summary: readonly string[];
    }
  | {
      readonly action: "reset-password";
      readonly commandId: string;
      readonly target: string;
      readonly expectedVersion: VersionRef;
      readonly summary: readonly string[];
    }
  | {
      readonly action: "open-project";
      readonly commandId: string;
      readonly target: string;
      readonly initialRiskManagerAccountId: string;
      readonly summary: readonly string[];
    }
  | {
      readonly action: "suspend-project";
      readonly commandId: string;
      readonly target: string;
      readonly expectedVersion: VersionRef;
      readonly summary: readonly string[];
    }
  | {
      readonly action: "revise-membership";
      readonly commandId: string;
      readonly target: string;
      readonly expectedVersion: VersionRef;
      readonly projectId: string;
      readonly membershipId: string;
      readonly scopeRefs: readonly KindRef[];
      readonly roles: readonly string[];
      readonly status: string;
      readonly summary: readonly string[];
    };

const scopeKey = (ref: KindRef): string =>
  `${ref.kind}:${ref.reference.entityId}@${ref.reference.versionId}`;

export default function AccessPage() {
  const identity = useSystemRead((signal) => readSystemIdentity(signal), []);
  const authorized = identity.state.kind === "ready" && identity.state.value.isSystemAdministrator;
  const allowedActions = identity.state.kind === "ready" ? identity.state.value.allowedActions : [];

  const accounts = useSystemRead<readonly SystemAccountView[]>(
    async (signal) => (authorized ? await listSystemAccounts(signal) : []),
    [authorized],
  );
  const projects = useSystemRead<readonly SystemProjectView[]>(
    async (signal) => (authorized ? await listSystemProjects(signal) : []),
    [authorized],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const memberships = useSystemRead<readonly SystemMembershipView[]>(
    async (signal) =>
      authorized && selectedProjectId !== null
        ? await listSystemMemberships(selectedProjectId, signal)
        : [],
    [authorized, selectedProjectId],
  );
  const scopes = useSystemRead<readonly SystemSpatialScopeView[]>(
    async (signal) =>
      authorized && selectedProjectId !== null
        ? await listSystemSpatialScopes(selectedProjectId, signal)
        : [],
    [authorized, selectedProjectId],
  );

  // 默认落在第一个已登记工程上；目录读取失败时不臆造目标。
  useEffect(() => {
    if (selectedProjectId !== null || projects.state.kind !== "ready") return;
    const first = projects.state.value[0];
    if (first !== undefined) setSelectedProjectId(first.projectId);
  }, [projects.state, selectedProjectId]);

  // --- 表单输入（口令只有这一处状态） ---
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetAccountId, setResetAccountId] = useState<string | null>(null);

  // --- 成员修订草稿 ---
  const [selectedMembershipKey, setSelectedMembershipKey] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<readonly string[]>([]);
  const [draftScopes, setDraftScopes] = useState<readonly string[]>([]);
  const [draftStatus, setDraftStatus] = useState("active");

  // --- 命令确认与结果 ---
  // CH-2 D-10：不再有第二套 Intent/acknowledged/submitting/retryIntent 状态机。
  // 唯一确认原语持有计划与提交状态；本组件只保留输入草稿与结果列表。
  const sessionScope = useSystemConfirmationScope();
  const scope = authorized ? sessionScope : undefined;
  // 待确认的管理意图：只带目标与版本，口令不在其中（口令只在冻结请求快照里）。
  const [pendingIntent, setPendingIntent] = useState<Intent | null>(null);
  const [outcomes, setOutcomes] = useState<
    readonly { readonly action: string; readonly target: string; readonly code: string }[]
  >([]);

  const ask = (next: Intent): void => {
    setPendingIntent(next);
  };

  const releaseSecrets = () => {
    // 关闭、失效或成功即释放口令输入：值不留在组件状态里。
    setPassword("");
  };

  const reloadAll = () => {
    accounts.reload();
    projects.reload();
    if (selectedProjectId !== null) {
      memberships.reload();
      scopes.reload();
    }
  };

  /**
   * CH-2 D-09/D-10：六项管理动作共用同一条确认路径与 system scope。
   *
   * 请求在打开确认这一刻构造并冻结，口令只存在于这份非渲染快照里：它不进摘要、
   * 目标、inputVersions、日志或任何缓存。重试重发原快照，因此同一命令身份下用户
   * 重新输入相同口令仍可原样提交；改输入则取得新身份并重新确认。
   */
  const administrationPlan = (
    current: Intent,
  ): CommandConfirmationPlanV1<PreparedAdministrationCommandV1> => {
    if (scope === undefined || scope.kind !== "system") throw clientError("CONTRACT_INVALID");
    const high = HIGH_IMPACT_ACTIONS.includes(current.action);
    const request =
      current.action === "create-account"
        ? prepareCreateSystemAccount({
            loginName: current.loginName,
            displayName: current.displayName,
            password,
            commandId: current.commandId,
          })
        : current.action === "reset-password"
          ? prepareResetSystemAccountPassword({
              accountId: current.target,
              expectedVersion: current.expectedVersion,
              password,
              commandId: current.commandId,
            })
          : current.action === "disable-account"
            ? prepareDisableSystemAccount({
                accountId: current.target,
                expectedVersion: current.expectedVersion,
                commandId: current.commandId,
              })
            : current.action === "open-project"
              ? prepareOpenSystemProject({
                  projectId: current.target,
                  initialRiskManagerAccountId: current.initialRiskManagerAccountId,
                  commandId: current.commandId,
                })
              : current.action === "suspend-project"
                ? prepareSuspendSystemProject({
                    projectId: current.target,
                    expectedVersion: current.expectedVersion,
                    commandId: current.commandId,
                  })
                : prepareReviseSystemMembership({
                    projectId: current.projectId,
                    membershipId: current.membershipId,
                    expectedVersion: current.expectedVersion,
                    accountId: current.target,
                    roles: current.roles,
                    spatialScopeRefs: current.scopeRefs,
                    status: current.status,
                    commandId: current.commandId,
                  });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "system-administration.execute",
      scope,
      targets: [],
      inputVersions: [],
      expectedFacts: current.summary,
      externalEffects: [SYSTEM_ACTION_LABEL[current.action] ?? current.action],
      impact: high ? "high" : "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  const administrationSucceeded = (current: Intent) => (): void => {
    setOutcomes((previous) => [
      { action: current.action, target: current.target, code: current.commandId },
      ...previous,
    ]);
    releaseSecrets();
    setLoginName("");
    setDisplayName("");
    setResetAccountId(null);
    reloadAll();
  };

  const can = (action: string) => allowedActions.includes(action);

  const actionHint = (action: string) => (can(action) ? undefined : "当前会话未获准该管理动作");

  return (
    <OpsPage title="账号与工程开通" subtitle="系统管理员的六项真实管理动作，不依赖工程上下文">
      <SystemReadView
        state={identity.state}
        title="系统管理身份"
        forbiddenHint="当前会话不是系统管理员，系统管理对象不予披露"
        onRetry={identity.reload}
      >
        {(me) => {
          if (!me.isSystemAdministrator) {
            return (
              <Card title="当前会话不具备系统管理身份">
                <p className="op-muted">
                  账号、成员与工程访问目录只向服务端确认的系统管理员披露；普通会话在此不显示任何系统对象。
                </p>
              </Card>
            );
          }
          return (
            <>
              <p className="op-context">
                {[
                  `系统管理员${me.accountRef === undefined ? "" : ` · 账号 ${me.accountRef.entityId}`}`,
                  `获准管理动作 ${me.allowedActions.length} 项`,
                  "系统管理身份不授予任何工程业务或资料访问权限",
                ].join(" · ")}
              </p>

              {outcomes.length > 0 && (
                <Card title="最近一次管理命令结果" style={{ marginBottom: 16 }}>
                  <ul className="op-outcome-list">
                    {outcomes.map((outcome, index) => (
                      <li key={`${outcome.action}-${index}`} className="op-muted">
                        {SYSTEM_ACTION_LABEL[outcome.action] ?? outcome.action} ·{" "}
                        <span className="mono">{outcome.target}</span> → 已登记{" "}
                        <span className="mono">{outcome.code}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <SystemReadView state={accounts.state} title="账号目录" onRetry={accounts.reload}>
                {(accountList) => (
                  <SystemReadView state={projects.state} title="工程目录" onRetry={projects.reload}>
                    {(projectList) => (
                      <>
                        <Card title="创建账号" style={{ marginBottom: 16 }}>
                          <div className="op-form">
                            <div className="op-form-row">
                              <div className="op-form-field">
                                <label htmlFor="access-login-name">登录名</label>
                                <input
                                  id="access-login-name"
                                  value={loginName}
                                  onChange={(event) => {
                                    setLoginName(event.target.value);
                                    setPendingIntent(null);
                                    releaseSecrets();
                                  }}
                                />
                              </div>
                              <div className="op-form-field">
                                <label htmlFor="access-display-name">姓名</label>
                                <input
                                  id="access-display-name"
                                  value={displayName}
                                  onChange={(event) => {
                                    setDisplayName(event.target.value);
                                    setPendingIntent(null);
                                    releaseSecrets();
                                  }}
                                />
                              </div>
                              <div className="op-form-field">
                                <label htmlFor="access-create-password">初始口令</label>
                                <input
                                  id="access-create-password"
                                  type="password"
                                  autoComplete="new-password"
                                  value={password}
                                  onChange={(event) => {
                                    setPassword(event.target.value);
                                    setPendingIntent(null);
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                className="op-btn op-btn-primary"
                                disabled={!can("create-account")}
                                title={actionHint("create-account")}
                                onClick={() => {
                                  ask({
                                    action: "create-account",
                                    commandId: newCommandId("create-account"),
                                    target: loginName,
                                    loginName,
                                    displayName,
                                    summary: [
                                      `对象：新账号 ${loginName}`,
                                      `姓名：${displayName}`,
                                      "口令：只随本次请求提交，不在页面留存或回显",
                                      "预计结果：账号进入正常状态，并按密码策略标记首次改密",
                                      "副作用：账号与访问审计写入 C06 原审计链；重复提交同一命令标识不重复建号",
                                    ],
                                  });
                                }}
                              >
                                创建账号
                              </button>
                            </div>
                            <p className="op-note">
                              初始口令需人工输入，不提供默认口令；提交后立即清空。
                            </p>
                          </div>
                        </Card>

                        <Card title="账号" style={{ marginBottom: 16 }}>
                          {accountList.length === 0 ? (
                            <p className="op-muted">当前没有已登记账号。</p>
                          ) : (
                            <div className="op-table-wrap">
                              <table className="op-table">
                                <thead>
                                  <tr>
                                    <th scope="col">账号标识</th>
                                    <th scope="col">登录名</th>
                                    <th scope="col">姓名</th>
                                    <th scope="col">状态</th>
                                    <th scope="col">首次改密</th>
                                    <th scope="col">重置口令</th>
                                    <th scope="col">操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {accountList.map((account) => (
                                    <tr key={account.accountRef.entityId}>
                                      <td className="mono">
                                        {account.accountRef.entityId}
                                        <br />
                                        <VersionTag>{account.accountRef.versionId}</VersionTag>
                                      </td>
                                      <td className="mono">{account.loginName}</td>
                                      <td>{account.displayName}</td>
                                      <td>
                                        <StatusTag tone={STATUS_TONE[account.status] ?? "neutral"}>
                                          {ACCOUNT_STATUS_LABEL[account.status] ?? account.status}
                                        </StatusTag>
                                      </td>
                                      <td>
                                        {account.passwordChangeRequired ? "需改密" : "无需改密"}
                                      </td>
                                      <td>
                                        {resetAccountId === account.accountRef.entityId ? (
                                          <div className="op-form-row">
                                            <div className="op-form-field">
                                              <label htmlFor="access-reset-password">
                                                新口令（{account.loginName}）
                                              </label>
                                              <input
                                                id="access-reset-password"
                                                type="password"
                                                autoComplete="new-password"
                                                value={password}
                                                onChange={(event) => {
                                                  setPassword(event.target.value);
                                                  setPendingIntent(null);
                                                }}
                                              />
                                            </div>
                                            <button
                                              type="button"
                                              className="op-btn"
                                              disabled={password.length === 0}
                                              onClick={() => {
                                                ask({
                                                  action: "reset-password",
                                                  commandId: newCommandId("reset-password"),
                                                  target: account.accountRef.entityId,
                                                  expectedVersion: account.accountRef,
                                                  summary: [
                                                    `对象：账号 ${account.loginName}`,
                                                    `精确标识：${account.accountRef.entityId}`,
                                                    "口令：只随本次请求提交，不在页面留存或回显",
                                                    "预计结果：账号口令被替换，并按密码策略标记首次改密",
                                                    "副作用：该账号既有会话按原撤销语义失效；重复提交同一命令标识不重复生效",
                                                  ],
                                                });
                                              }}
                                            >
                                              确认重置
                                            </button>
                                            <button
                                              type="button"
                                              className="op-btn"
                                              onClick={() => {
                                                setResetAccountId(null);
                                                setPassword("");
                                              }}
                                            >
                                              取消
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            className="op-btn"
                                            disabled={!can("reset-password")}
                                            title={actionHint("reset-password")}
                                            onClick={() => {
                                              setResetAccountId(account.accountRef.entityId);
                                              setPassword("");
                                            }}
                                          >
                                            重置口令
                                          </button>
                                        )}
                                      </td>
                                      <td>
                                        <button
                                          type="button"
                                          className="op-btn op-btn-danger"
                                          disabled={
                                            !can("disable-account") || account.status === "disabled"
                                          }
                                          title={actionHint("disable-account")}
                                          onClick={() => {
                                            ask({
                                              action: "disable-account",
                                              commandId: newCommandId("disable-account"),
                                              target: account.accountRef.entityId,
                                              expectedVersion: account.accountRef,
                                              summary: [
                                                `对象：账号 ${account.loginName}`,
                                                `精确标识：${account.accountRef.entityId}`,
                                                `当前状态：${ACCOUNT_STATUS_LABEL[account.status] ?? account.status}`,
                                                "预计结果：账号停用后不能再登录或发起会话",
                                                "副作用：该账号既有会话按原撤销语义失效；重复提交同一命令标识不重复生效",
                                              ],
                                            });
                                          }}
                                        >
                                          停用账号
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </Card>

                        <Card title="开通工程" style={{ marginBottom: 16 }}>
                          <ProjectOpeningForm
                            accounts={accountList.map((account) => ({
                              accountRef: account.accountRef,
                              displayName: account.displayName,
                              status: account.status,
                            }))}
                            disabled={!can("open-project")}
                            disabledHint={actionHint("open-project")}
                            onSubmit={(input) => {
                              ask({
                                action: "open-project",
                                commandId: newCommandId("open-project"),
                                target: input.projectId,
                                initialRiskManagerAccountId: input.initialRiskManagerAccountId,
                                summary: [
                                  `对象：新工程 ${input.projectId}`,
                                  `初始工程风险负责人：${input.initialRiskManagerAccountId}`,
                                  "预计结果：工程访问进入开通状态",
                                  "副作用：只建立访问与成员事实，不代为登记业务修订或评估配置",
                                ],
                              });
                            }}
                          />
                        </Card>

                        <Card title="工程开通状态" style={{ marginBottom: 16 }}>
                          {projectList.length === 0 ? (
                            <p className="op-muted">当前没有已登记工程。</p>
                          ) : (
                            <div className="op-table-wrap">
                              <table className="op-table">
                                <thead>
                                  <tr>
                                    <th scope="col">工程标识</th>
                                    <th scope="col">访问状态</th>
                                    <th scope="col">当前访问修订</th>
                                    <th scope="col">操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {projectList.map((project) => (
                                    <tr key={project.projectId}>
                                      <td className="mono">{project.projectId}</td>
                                      <td>
                                        <StatusTag tone={STATUS_TONE[project.status] ?? "neutral"}>
                                          {PROJECT_STATUS_LABEL[project.status] ?? project.status}
                                        </StatusTag>
                                      </td>
                                      <td>
                                        <span className="mono">
                                          {project.accessRevisionRef.entityId}
                                        </span>{" "}
                                        <VersionTag>
                                          {project.accessRevisionRef.versionId}
                                        </VersionTag>
                                      </td>
                                      <td>
                                        <button
                                          type="button"
                                          className="op-btn"
                                          aria-pressed={selectedProjectId === project.projectId}
                                          onClick={() => {
                                            setSelectedProjectId(project.projectId);
                                            setSelectedMembershipKey(null);
                                          }}
                                        >
                                          查看成员
                                        </button>{" "}
                                        <button
                                          type="button"
                                          className="op-btn op-btn-danger"
                                          disabled={
                                            !can("suspend-project") ||
                                            project.status === "suspended"
                                          }
                                          title={actionHint("suspend-project")}
                                          onClick={() => {
                                            ask({
                                              action: "suspend-project",
                                              commandId: newCommandId("suspend-project"),
                                              target: project.projectId,
                                              expectedVersion: project.accessRevisionRef,
                                              summary: [
                                                `对象：工程 ${project.projectId}`,
                                                `当前访问修订：${project.accessRevisionRef.versionId}`,
                                                "预计结果：工程访问进入暂停状态",
                                                "副作用：工程内成员后续业务访问按服务端新权限判定；重复提交同一命令标识不重复生效",
                                              ],
                                            });
                                          }}
                                        >
                                          暂停工程
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </Card>

                        <Card title="成员与空间范围">
                          <div className="op-chips" role="group" aria-label="按工程选择成员目录">
                            {projectList.map((project) => (
                              <button
                                key={project.projectId}
                                type="button"
                                className={`op-chip${
                                  selectedProjectId === project.projectId ? " op-chip-active" : ""
                                }`}
                                aria-pressed={selectedProjectId === project.projectId}
                                onClick={() => {
                                  setSelectedProjectId(project.projectId);
                                  setSelectedMembershipKey(null);
                                }}
                              >
                                <span className="mono">{project.projectId}</span>
                              </button>
                            ))}
                          </div>

                          {selectedProjectId === null ? (
                            <p className="op-muted">请选择一个工程查看其成员与空间范围。</p>
                          ) : (
                            <SystemReadView
                              state={memberships.state}
                              title="工程成员"
                              onRetry={memberships.reload}
                            >
                              {(membershipList) => (
                                <>
                                  {membershipList.length === 0 ? (
                                    <p className="op-muted">该工程当前没有登记成员。</p>
                                  ) : (
                                    <div className="op-table-wrap">
                                      <table className="op-table">
                                        <thead>
                                          <tr>
                                            <th scope="col">成员标识</th>
                                            <th scope="col">账号标识</th>
                                            <th scope="col">角色</th>
                                            <th scope="col">空间范围</th>
                                            <th scope="col">状态</th>
                                            <th scope="col">操作</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {membershipList.map((membership) => (
                                            <tr key={membership.membershipRef.entityId}>
                                              <td className="mono">
                                                {membership.membershipRef.entityId}
                                                <br />
                                                <VersionTag>
                                                  {membership.membershipRef.versionId}
                                                </VersionTag>
                                              </td>
                                              <td className="mono">
                                                {membership.accountRef.entityId}
                                              </td>
                                              <td>
                                                {membership.roles
                                                  .map((role) => PRESET_ROLE_LABEL[role] ?? role)
                                                  .join("、")}
                                              </td>
                                              <td>
                                                {membership.spatialScopeRefs.length === 0
                                                  ? "未分配"
                                                  : membership.spatialScopeRefs
                                                      .map((ref) => ref.reference.entityId)
                                                      .join("、")}
                                              </td>
                                              <td>
                                                <StatusTag
                                                  tone={STATUS_TONE[membership.status] ?? "neutral"}
                                                >
                                                  {MEMBERSHIP_STATUS_LABEL[membership.status] ??
                                                    membership.status}
                                                </StatusTag>
                                              </td>
                                              <td>
                                                <button
                                                  type="button"
                                                  className="op-btn"
                                                  disabled={!can("revise-membership")}
                                                  title={actionHint("revise-membership")}
                                                  onClick={() => {
                                                    setSelectedMembershipKey(
                                                      membership.membershipRef.entityId,
                                                    );
                                                    setDraftRoles(membership.roles);
                                                    setDraftScopes(
                                                      membership.spatialScopeRefs.map(scopeKey),
                                                    );
                                                    setDraftStatus(membership.status);
                                                  }}
                                                >
                                                  修订
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  <SystemReadView
                                    state={scopes.state}
                                    title="空间范围目录"
                                    onRetry={scopes.reload}
                                  >
                                    {(scopeList) => (
                                      <>
                                        {scopeList.length === 0 ? (
                                          <p className="op-muted">该工程当前没有登记空间范围。</p>
                                        ) : (
                                          <div className="op-table-wrap">
                                            <table className="op-table">
                                              <thead>
                                                <tr>
                                                  <th scope="col">范围标识</th>
                                                  <th scope="col">范围引用</th>
                                                  <th scope="col">父范围</th>
                                                  <th scope="col">状态</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {scopeList.map((scope) => (
                                                  <tr key={scope.scopeId}>
                                                    <td className="mono">{scope.scopeId}</td>
                                                    <td className="mono">
                                                      {scope.scopeRef.reference.entityId}
                                                    </td>
                                                    <td className="mono">
                                                      {scope.parentScopeRef === undefined
                                                        ? "根范围"
                                                        : scope.parentScopeRef.reference.entityId}
                                                    </td>
                                                    <td>
                                                      <StatusTag
                                                        tone={
                                                          STATUS_TONE[scope.status] ?? "neutral"
                                                        }
                                                      >
                                                        {SCOPE_STATUS_LABEL[scope.status] ??
                                                          scope.status}
                                                      </StatusTag>
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}

                                        {selectedMembershipKey === null ? null : (
                                          <div className="op-form" style={{ marginTop: 16 }}>
                                            <h4>修订成员 {selectedMembershipKey}</h4>
                                            <div className="op-form-field">
                                              <span className="op-muted">角色</span>
                                              <div
                                                className="op-chips"
                                                role="group"
                                                aria-label="选择角色"
                                              >
                                                {PRESET_ROLES.map((role) => (
                                                  <button
                                                    key={role}
                                                    type="button"
                                                    className={`op-chip${
                                                      draftRoles.includes(role)
                                                        ? " op-chip-active"
                                                        : ""
                                                    }`}
                                                    aria-pressed={draftRoles.includes(role)}
                                                    onClick={() =>
                                                      setDraftRoles((previous) =>
                                                        previous.includes(role)
                                                          ? previous.filter((item) => item !== role)
                                                          : [...previous, role],
                                                      )
                                                    }
                                                  >
                                                    {PRESET_ROLE_LABEL[role] ?? role}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                            <div className="op-form-field">
                                              <span className="op-muted">空间范围</span>
                                              <div
                                                className="op-chips"
                                                role="group"
                                                aria-label="选择空间范围"
                                              >
                                                {scopeList.map((scope) => {
                                                  const key = scopeKey(scope.scopeRef);
                                                  return (
                                                    <button
                                                      key={key}
                                                      type="button"
                                                      className={`op-chip${
                                                        draftScopes.includes(key)
                                                          ? " op-chip-active"
                                                          : ""
                                                      }`}
                                                      aria-pressed={draftScopes.includes(key)}
                                                      onClick={() =>
                                                        setDraftScopes((previous) =>
                                                          previous.includes(key)
                                                            ? previous.filter(
                                                                (item) => item !== key,
                                                              )
                                                            : [...previous, key],
                                                        )
                                                      }
                                                    >
                                                      <span className="mono">{scope.scopeId}</span>
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                            <div className="op-form-row">
                                              <div className="op-form-field">
                                                <label htmlFor="access-membership-status">
                                                  成员状态
                                                </label>
                                                <select
                                                  id="access-membership-status"
                                                  value={draftStatus}
                                                  onChange={(event) =>
                                                    setDraftStatus(event.target.value)
                                                  }
                                                >
                                                  <option value="active">生效</option>
                                                  <option value="removed">已移除</option>
                                                </select>
                                              </div>
                                              <button
                                                type="button"
                                                className="op-btn op-btn-primary"
                                                disabled={
                                                  !can("revise-membership") ||
                                                  draftRoles.length === 0 ||
                                                  draftScopes.length === 0
                                                }
                                                onClick={() => {
                                                  const selectedMembership = membershipList.find(
                                                    (membership) =>
                                                      membership.membershipRef.entityId ===
                                                      selectedMembershipKey,
                                                  );
                                                  if (selectedMembership === undefined) return;
                                                  const targetAccountId =
                                                    selectedMembership.accountRef.entityId;
                                                  ask({
                                                    action: "revise-membership",
                                                    commandId: newCommandId("revise-membership"),
                                                    target: targetAccountId,
                                                    expectedVersion:
                                                      selectedMembership.membershipRef,
                                                    projectId: selectedProjectId,
                                                    membershipId: selectedMembershipKey,
                                                    scopeRefs: scopeList
                                                      .filter((scope) =>
                                                        draftScopes.includes(
                                                          scopeKey(scope.scopeRef),
                                                        ),
                                                      )
                                                      .map((scope) => scope.scopeRef),
                                                    roles: draftRoles,
                                                    status: draftStatus,
                                                    summary: [
                                                      `工程：${selectedProjectId}`,
                                                      `成员：${selectedMembershipKey}`,
                                                      `账号：${targetAccountId}`,
                                                      `角色：${draftRoles
                                                        .map(
                                                          (role) => PRESET_ROLE_LABEL[role] ?? role,
                                                        )
                                                        .join("、")}`,
                                                      `空间范围：${draftScopes.length} 个`,
                                                      `状态：${MEMBERSHIP_STATUS_LABEL[draftStatus] ?? draftStatus}`,
                                                      "副作用：该成员后续业务访问按服务端新权限判定；重复提交同一命令标识不重复生效",
                                                    ],
                                                  });
                                                }}
                                              >
                                                提交修订
                                              </button>
                                              <button
                                                type="button"
                                                className="op-btn"
                                                onClick={() => setSelectedMembershipKey(null)}
                                              >
                                                取消
                                              </button>
                                            </div>
                                            <p className="op-note">
                                              角色与空间范围至少各选一项；成员权限只作用于所选工程。
                                            </p>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </SystemReadView>
                                </>
                              )}
                            </SystemReadView>
                          )}
                        </Card>
                      </>
                    )}
                  </SystemReadView>
                )}
              </SystemReadView>

              {/*
                CH-2 D-10：内联确认与孤立样式已删除。六项管理动作共用唯一确认原语与
                system scope；口令只在冻结请求快照里，摘要、日志与缓存都不含它。
              */}
              {pendingIntent === null ? null : (
                <ConfirmButton
                  label={`确认${SYSTEM_ACTION_LABEL[pendingIntent.action] ?? pendingIntent.action}`}
                  tone={HIGH_IMPACT_ACTIONS.includes(pendingIntent.action) ? "danger" : "primary"}
                  availability={{
                    kind:
                      can(pendingIntent.action) &&
                      !(
                        (pendingIntent.action === "create-account" ||
                          pendingIntent.action === "reset-password") &&
                        password.length === 0
                      )
                        ? "allowed"
                        : "unavailable",
                    reason: "context-incomplete",
                  }}
                  requiredPermission={{ kind: "system", action: pendingIntent.action }}
                  scope={scope}
                  intentRevision={JSON.stringify([
                    pendingIntent.commandId,
                    loginName,
                    displayName,
                    pendingIntent.action === "open-project" ? pendingIntent.target : "",
                    pendingIntent.action === "open-project"
                      ? pendingIntent.initialRiskManagerAccountId
                      : "",
                    selectedProjectId,
                    selectedMembershipKey,
                    draftRoles,
                    draftScopes,
                    draftStatus,
                    resetAccountId,
                  ])}
                  createPlan={() => administrationPlan(pendingIntent)}
                  submit={async (plan) => {
                    const result = await sendAdministrationCommand(plan.request);
                    return {
                      kind: "command-result",
                      result: {
                        kind: "system-administration",
                        resultRef: {
                          kind: "authorization-context",
                          reference: result.resultRef,
                        },
                      },
                    };
                  }}
                  onSucceeded={administrationSucceeded(pendingIntent)}
                  onClosed={() => {
                    releaseSecrets();
                    setPendingIntent(null);
                  }}
                />
              )}
            </>
          );
        }}
      </SystemReadView>
    </OpsPage>
  );
}
