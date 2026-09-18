// P-PJ-04 工程成员与资料访问：A 列表骨架。
// 数据：engineering-data.evidence-access（成员与资料访问授权投影）；
// 页面级能力位 engineering-data.read（框架层门控）。
// 动作名只取 PROJECT_MANAGER_ACCESS_ACTIONS：revise-membership / revise-source-access。

import { useState } from 'react';
import { ROLE_LABELS, type PresetRole } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import { PROJECT_MEMBERS, SOURCE_ACCESS_GRANTS } from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextSubtitle,
  DataTable,
  FilterChips,
  GatedAction,
  formatDateTime,
} from './widgets';

type MemberFilter = 'all' | 'active' | 'removed';

const MEMBER_FILTER_OPTIONS: readonly { readonly key: MemberFilter; readonly label: string }[] = [
  { key: 'all', label: '全部成员' },
  { key: 'active', label: '在岗' },
  { key: 'removed', label: '已移出' },
];

function roleLabel(role: string): string {
  return ROLE_LABELS[role as PresetRole] ?? role;
}

function MembersContent({ input }: { readonly input: RouteRenderInput }) {
  const [filter, setFilter] = useState<MemberFilter>('all');
  const members = PROJECT_MEMBERS.filter((member) => filter === 'all' || member.status === filter);
  return (
    <>
      <ContextSubtitle
        items={[
          '工程 PRJ-001 · 站隧一体化标',
          '数据时点 2026-08-29 08:30',
          `成员 ${PROJECT_MEMBERS.length} 名 · 资料访问授权 ${SOURCE_ACCESS_GRANTS.length} 项`,
        ]}
      />
      <div className="pj-actions">
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="修订成员"
          actionCode="revise-membership"
          primary
        />
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="修订资料访问"
          actionCode="revise-source-access"
        />
      </div>
      <section className="pj-card">
        <h3>工程成员</h3>
        <FilterChips label="按成员状态筛选" options={MEMBER_FILTER_OPTIONS} value={filter} onChange={setFilter} />
        {members.length === 0 ? (
          <p className="pj-notice">当前筛选下没有成员。</p>
        ) : (
          <DataTable
            caption="工程成员列表"
            head={['成员标识', '姓名', '角色', '可见空间区段', '状态', '最近修订']}
          >
            {members.map((member) => (
              <tr key={member.membershipId}>
                <td className="mono">{member.membershipId}</td>
                <td>{member.displayName}</td>
                <td>{member.roles.map(roleLabel).join('、')}</td>
                <td className="mono">
                  {member.spatialScopeRefs
                    .map((ref) => ref.reference.entityId)
                    .join('、')}
                </td>
                <td>
                  <Badge tone={member.status === 'active' ? 'success' : 'neutral'}>
                    {member.status === 'active' ? '在岗' : '已移出'}
                  </Badge>
                </td>
                <td>
                  {formatDateTime(member.audit.recordedAt)}
                  <br />
                  <span className="pj-form-note">{member.audit.reason}</span>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
      <section className="pj-card">
        <h3>资料访问授权</h3>
        <DataTable
          caption="资料访问授权列表"
          head={['授权标识', '资料版本', '可见性', '特许账号', '空间范围', '登记人']}
        >
          {SOURCE_ACCESS_GRANTS.map((grant) => (
            <tr key={grant.sourceAccessGrantRef.reference.entityId}>
              <td className="mono">
                {grant.sourceAccessGrantRef.reference.entityId} ·{' '}
                {grant.sourceAccessGrantRef.reference.versionId}
              </td>
              <td className="mono">
                <a href={`#/projects/sources/${grant.sourceVersionRef.reference.entityId}`}>
                  {grant.sourceVersionRef.reference.entityId} ·{' '}
                  {grant.sourceVersionRef.reference.versionId}
                </a>
              </td>
              <td>
                <Badge tone={grant.visibility === 'project-shared' ? 'blue' : 'risk-2'}>
                  {grant.visibility === 'project-shared' ? '工程内共享' : '受限'}
                </Badge>
              </td>
              <td className="mono">
                {grant.allowedAccountIds.length === 0
                  ? '（按角色可见）'
                  : grant.allowedAccountIds.join('、')}
              </td>
              <td className="mono">
                {grant.spatialScopeRefs.map((ref) => ref.reference.entityId).join('、')}
              </td>
              <td className="mono">{grant.registeredByAccountId}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </>
  );
}

export function ProjectMembersPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="工程成员与资料访问"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前工程暂无成员，可经「修订成员」添加第一名成员。"
      content={<MembersContent input={input} />}
    />
  );
}
