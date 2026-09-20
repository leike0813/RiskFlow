// P-OP-01 账号与工程开通（骨架 A 列表；branch null，设施域无业务 branch；
// 页面级能力位 null，manifest 标注）。动作名严格取 SYSTEM_ACCESS_ACTIONS 六项
// （contract-mirror），动作级三态门控按「系统管理员身份」判定（见 widgets）。
// 字段形状对齐 packages/core/src/access/schema.ts：账号状态 active/disabled、
// 工程访问状态 active/suspended、命令身份 commandId / idempotencyKey。
// 七态由 PageFrame 经 input.pageState 承载，本组件不读取 URL 参数。

import { useState } from 'react';
import { ROLE_LABELS, SYSTEM_ACCESS_ACTIONS, type PresetRole } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import {
  ACCESS_COMMAND_LOG,
  LOCAL_ACCOUNTS,
  LOCAL_ACCOUNT_STATUS_LABELS,
  PROJECT_ACCESS_LIST,
  PROJECT_ACCESS_STATUS_LABELS,
  SYSTEM_ACCESS_ACTION_LABELS,
} from '../../content/ops';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextLine,
  DataTable,
  FilterChips,
  SystemAction,
  formatDateTime,
} from './widgets';

type AccountFilter = 'all' | 'active' | 'disabled';

const ACCOUNT_FILTERS: readonly { readonly key: AccountFilter; readonly label: string }[] = [
  { key: 'all', label: '全部账号' },
  { key: 'active', label: '正常' },
  { key: 'disabled', label: '已停用' },
];

function roleLabel(role: string): string {
  return ROLE_LABELS[role as PresetRole] ?? role;
}

export function AccessPage({ input }: { readonly input: RouteRenderInput }) {
  const [filter, setFilter] = useState<AccountFilter>('all');
  const accounts = LOCAL_ACCOUNTS.filter(
    (account) => filter === 'all' || account.status === filter,
  );

  return (
    <PageFrame
      title="账号与工程开通"
      state={input.pageState}
      skeleton="A"
      emptyMessage="暂无账号记录，可经「创建账号」登记第一个账号"
      content={
        <div>
          <ContextLine
            items={[
              `账号 ${LOCAL_ACCOUNTS.length} 个（正常 ${
                LOCAL_ACCOUNTS.filter((account) => account.status === 'active').length
              }）`,
              `工程 ${PROJECT_ACCESS_LIST.length} 个`,
              '数据时点 2026-09-18 09:00',
            ]}
          />

          <div className="op-actions" role="group" aria-label="系统管理动作">
            {SYSTEM_ACCESS_ACTIONS.map((action) => (
              <SystemAction
                key={action}
                label={SYSTEM_ACCESS_ACTION_LABELS[action] ?? action}
                actionCode={action}
                capabilities={input.capabilities}
                primary={action === 'create-account' || action === 'open-project'}
              />
            ))}
          </div>

          <section className="op-card">
            <h3>账号</h3>
            <FilterChips
              label="按账号状态筛选"
              options={ACCOUNT_FILTERS}
              value={filter}
              onChange={setFilter}
            />
            {accounts.length === 0 ? (
              <p className="op-muted">当前筛选下没有账号。</p>
            ) : (
              <DataTable
                caption="账号列表"
                head={['账号标识', '登录名', '姓名', '工程角色', '状态', '最近审计']}
              >
                {accounts.map((account) => (
                  <tr key={account.accountId}>
                    <td className="mono">{account.accountId}</td>
                    <td className="mono">{account.loginName}</td>
                    <td>{account.displayName}</td>
                    <td>{account.roles.map(roleLabel).join('、')}</td>
                    <td>
                      <Badge tone={account.status === 'active' ? 'success' : 'neutral'}>
                        {LOCAL_ACCOUNT_STATUS_LABELS[account.status]}
                      </Badge>
                    </td>
                    <td>
                      <span className="mono">{formatDateTime(account.audit.recordedAt)}</span>
                      <br />
                      <span className="op-muted">
                        {SYSTEM_ACCESS_ACTION_LABELS[account.audit.action] ?? account.audit.action}
                        {account.audit.reason === undefined ? '' : ` · ${account.audit.reason}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </section>

          <section className="op-card">
            <h3>工程开通状态</h3>
            <DataTable
              caption="工程开通列表"
              head={['工程标识', '名称', '访问状态', '当前业务修订', '初始风险负责人', '成员数', '最近审计']}
            >
              {PROJECT_ACCESS_LIST.map((project) => (
                <tr key={project.projectId}>
                  <td>
                    {project.accessStatus === 'active' ? (
                      <a className="mono" href="#/projects">
                        {project.projectId}
                      </a>
                    ) : (
                      <span className="mono">{project.projectId}</span>
                    )}
                  </td>
                  <td>{project.name}</td>
                  <td>
                    <Badge tone={project.accessStatus === 'active' ? 'success' : 'review'}>
                      {PROJECT_ACCESS_STATUS_LABELS[project.accessStatus]}
                    </Badge>
                  </td>
                  <td className="mono">
                    {project.currentRevisionRef.entityId} · {project.currentRevisionRef.versionId}
                  </td>
                  <td className="mono">{project.initialRiskManagerAccountId}</td>
                  <td className="mono">{project.memberCount}</td>
                  <td>
                    <span className="mono">{formatDateTime(project.audit.recordedAt)}</span>
                    <br />
                    <span className="op-muted">
                      {SYSTEM_ACCESS_ACTION_LABELS[project.audit.action] ?? project.audit.action}
                      {project.audit.reason === undefined ? '' : ` · ${project.audit.reason}`}
                    </span>
                  </td>
                </tr>
              ))}
            </DataTable>
            <p className="op-muted">
              成员与资料访问授权的工程内视图见 <a href="#/projects/members">工程成员与资料访问</a>
              ；全部访问命令另入 <a href="#/review-audit/audit-log">版本与操作审计</a>。
            </p>
          </section>

          <section className="op-card">
            <h3>访问命令台账</h3>
            <DataTable
              caption="访问命令台账"
              head={['命令标识', '动作', '幂等键', '目标', '操作者', '时间', '结果']}
            >
              {ACCESS_COMMAND_LOG.map((entry) => (
                <tr key={entry.commandId}>
                  <td className="mono">{entry.commandId}</td>
                  <td>
                    {SYSTEM_ACCESS_ACTION_LABELS[entry.action] ?? entry.action}
                    <br />
                    <code className="op-action-code">{entry.action}</code>
                  </td>
                  <td className="mono">{entry.idempotencyKey}</td>
                  <td>{entry.targetLabel}</td>
                  <td className="mono">{entry.actorId}</td>
                  <td className="mono">{formatDateTime(entry.recordedAt)}</td>
                  <td>{entry.result}</td>
                </tr>
              ))}
            </DataTable>
          </section>
        </div>
      }
    />
  );
}
