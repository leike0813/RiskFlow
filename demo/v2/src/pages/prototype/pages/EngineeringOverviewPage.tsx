// PROTOTYPE · THROWAWAY — 票 05 第 2 页：工程概览。

import {
  APPLICABILITY_SNAPSHOT_REF,
  CURRENT_PROJECT_REVISION,
  PROCESS_NODE_DEPENDENCIES,
  PROJECT_BUSINESS_REVISIONS,
  PROJECT_MEMBERS,
  PROJECT_OVERVIEW_KPIS,
  PROJECT_TIMELINE,
  SOURCE_ACCESS_GRANTS,
  SPATIAL_SCOPE_REVISIONS,
  type ProjectBusinessLifecycle,
} from '../../../content/project';
import { AgentNote, Ids, KeyValue, Section, StateTag, Stats, Tag, Timeline } from '../parts';

const LIFECYCLE_LABELS: Readonly<Record<ProjectBusinessLifecycle, string>> = {
  preparing: '施工准备',
  active: '施工中',
  ended: '已完工',
  archived: '已归档',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  'project-risk-manager': '项目风险负责人',
  reviewer: '复核专家',
  'field-responder': '现场处置员',
  'business-viewer': '业务查看',
};

const scopeName = (entityId: string, versionId: string): string => {
  const hit = SPATIAL_SCOPE_REVISIONS.find(
    (scope) =>
      scope.spatialScopeRef.reference.entityId === entityId &&
      scope.spatialScopeRef.reference.versionId === versionId,
  );
  return hit ? `${hit.name}（${hit.spatialScopeRef.reference.versionId}）` : `${entityId} ${versionId}`;
};

const activeMembers = PROJECT_MEMBERS.filter((member) => member.status === 'active');
const removedMembers = PROJECT_MEMBERS.filter((member) => member.status === 'removed');
const currentRev = CURRENT_PROJECT_REVISION;

export function EngineeringOverviewPage() {
  const superseded = PROJECT_BUSINESS_REVISIONS.filter(
    (revision) => revision.systemTime.supersededAt !== undefined,
  );

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">工程 / 概览</div>
          <h1 className="dl-h1">{currentRev.name}</h1>
          <div className="dl-head-meta dl-sm dl-faint">
            <StateTag state="current">{LIFECYCLE_LABELS[currentRev.lifecycle]}</StateTag>
            <span>
              生效自 {currentRev.effectivePeriod.validFrom.slice(0, 10)}
            </span>
            <span>·</span>
            <span>
              当前生效版本 {currentRev.projectRevisionRef.reference.versionId}（此前 {superseded.length} 个版本已换版）
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">导出工程概览</button>
        </div>
      </header>

      <AgentNote
        why={`依据工程 ${PROJECT_BUSINESS_REVISIONS.length} 个业务版本、${SPATIAL_SCOPE_REVISIONS.length} 条空间区段与 ${PROJECT_TIMELINE.length} 条工程事件推导；工程阶段与地层条件以已生效版本为准。`}
      >
        助手看到本工程当前处于{LIFECYCLE_LABELS[currentRev.lifecycle]}阶段，
        区段一的地层条件在 7 月补勘后细化过一次，最近一次工程事件是
        「{PROJECT_TIMELINE[PROJECT_TIMELINE.length - 1]?.title}」。若现场已换阶段，需要你先确认再改工程口径。
      </AgentNote>

      <Stats
        items={PROJECT_OVERVIEW_KPIS.map((kpi) => ({
          label: `${kpi.label} · ${kpi.hint}`,
          value: kpi.value,
        }))}
      />

      <Section title="工程口径" flush>
        <div style={{ padding: 'var(--dl-s4)' }}>
          <KeyValue
            items={[
              ['工程名称', currentRev.name],
              ['当前阶段', LIFECYCLE_LABELS[currentRev.lifecycle]],
              ['施工方法', currentRev.applicabilityMetadata.constructionMethod],
              ['地层条件', currentRev.applicabilityMetadata.stratumCondition],
              ['适用性口径', `${APPLICABILITY_SNAPSHOT_REF.reference.entityId} ${APPLICABILITY_SNAPSHOT_REF.reference.versionId}`],
              [
                '空间区段',
                <>
                  {SPATIAL_SCOPE_REVISIONS.filter((scope) => scope.status === 'active')
                    .map((scope) => (
                      <span key={scope.spatialScopeRef.reference.versionId} style={{ marginRight: 'var(--dl-s4)' }}>
                        {scope.name}
                      </span>
                    ))}
                </>,
              ],
              [
                '工序节点',
                PROCESS_NODE_DEPENDENCIES.map((node) => node.name).join(' · '),
              ],
              ['最近换版原因', currentRev.audit.reason],
              ['变更人', currentRev.audit.actorId],
            ]}
          />
        </div>
        <table className="dl-table">
          <thead>
            <tr>
              <th>业务版本</th>
              <th>阶段</th>
              <th>施工方法</th>
              <th>地层条件</th>
              <th>生效期间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {PROJECT_BUSINESS_REVISIONS.map((revision) => (
              <tr key={revision.projectRevisionRef.reference.versionId}>
                <td>
                  {revision.projectRevisionRef.reference.versionId}
                  {revision.projectRevisionRef.reference.versionId === currentRev.projectRevisionRef.reference.versionId ? (
                    <Tag accent>当前</Tag>
                  ) : null}
                </td>
                <td>{LIFECYCLE_LABELS[revision.lifecycle]}</td>
                <td>{revision.applicabilityMetadata.constructionMethod}</td>
                <td>{revision.applicabilityMetadata.stratumCondition}</td>
                <td className="dl-sm dl-faint">
                  {revision.effectivePeriod.validFrom.slice(0, 10)} 起
                  {revision.systemTime.supersededAt
                    ? ` · ${revision.systemTime.supersededAt.slice(0, 10)} 停用`
                    : ''}
                </td>
                <td>
                  <StateTag
                    state={revision.systemTime.supersededAt ? 'done' : 'current'}
                  >
                    {revision.systemTime.supersededAt ? '已换版' : '生效中'}
                  </StateTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="空间区段与工序节点" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>空间区段</th>
              <th>位置</th>
              <th>里程</th>
              <th>地层覆盖</th>
              <th>归属工序</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {SPATIAL_SCOPE_REVISIONS.map((scope) => (
              <tr key={scope.spatialScopeRef.reference.versionId}>
                <td>
                  {scope.name}
                  <span className="dl-xs dl-faint dl-mono" style={{ marginLeft: 6 }}>
                    {scope.spatialScopeRef.reference.versionId}
                  </span>
                </td>
                <td>{scope.worksiteLocation}</td>
                <td className="dl-num">
                  {scope.chainage ? `${scope.chainage.start} – ${scope.chainage.end}` : '—'}
                </td>
                <td className="dl-sm">
                  {scope.applicabilityOverrides.stratumCondition ?? currentRev.applicabilityMetadata.stratumCondition}
                </td>
                <td className="dl-sm">
                  {PROCESS_NODE_DEPENDENCIES.filter(
                    (node) =>
                      node.spatialScopeRef.reference.entityId === scope.spatialScopeRef.reference.entityId &&
                      node.spatialScopeRef.reference.versionId === scope.spatialScopeRef.reference.versionId,
                  )
                    .map((node) => node.name)
                    .join(' · ')}
                </td>
                <td>
                  <StateTag state={scope.status === 'active' ? 'current' : 'pending'}>
                    {scope.status === 'active' ? '生效中' : '停用'}
                  </StateTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="工程成员与资料授权" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>成员</th>
              <th>岗位</th>
              <th>可见区段</th>
              <th>状态</th>
              <th>入组 / 移出</th>
            </tr>
          </thead>
          <tbody>
            {[...activeMembers, ...removedMembers].map((member) => (
              <tr key={member.membershipId}>
                <td>{member.displayName}</td>
                <td>{member.roles.map((role) => ROLE_LABELS[role] ?? role).join(' · ')}</td>
                <td className="dl-sm dl-faint">
                  {member.spatialScopeRefs.map((ref) => scopeName(ref.reference.entityId, ref.reference.versionId)).join(' · ')}
                </td>
                <td>
                  <StateTag state={member.status === 'active' ? 'current' : 'done'}>
                    {member.status === 'active' ? '在岗' : '已移出'}
                  </StateTag>
                </td>
                <td className="dl-sm dl-faint">{member.audit.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="dl-table">
          <thead>
            <tr>
              <th>资料版本</th>
              <th>可见范围</th>
              <th>限授权人员</th>
              <th>授权理由</th>
            </tr>
          </thead>
          <tbody>
            {SOURCE_ACCESS_GRANTS.map((grant) => (
              <tr key={grant.sourceAccessGrantRef.reference.entityId}>
                <td className="dl-mono">
                  {grant.sourceVersionRef.reference.entityId} {grant.sourceVersionRef.reference.versionId}
                </td>
                <td>
                  <Tag accent={grant.visibility === 'restricted'}>
                    {grant.visibility === 'restricted' ? '限授权可读' : '工程内共享'}
                  </Tag>
                </td>
                <td className="dl-sm dl-faint">
                  {grant.allowedAccountIds.length === 0 ? '全部工程成员' : grant.allowedAccountIds.join(' · ')}
                </td>
                <td className="dl-sm dl-faint">{grant.audit.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="工程事件" action={<span className="dl-xs dl-faint">按发生时间</span>}>
        <Timeline
          items={PROJECT_TIMELINE.map((event, index) => ({
            at: event.time.slice(0, 16).replace('T', ' '),
            title: event.title,
            state: index === PROJECT_TIMELINE.length - 1 ? 'current' : 'done',
            meta: <Tag>{event.actor}</Tag>,
            body: event.ref ? (
              <div className="dl-sm dl-faint">
                关联 <span className="dl-mono">{event.ref.label}</span>
              </div>
            ) : null,
          }))}
        />
      </Section>

      <Ids
        pairs={[
          ['工程', `${currentRev.projectId} ${currentRev.projectRevisionRef.reference.versionId}`],
          ['适用性口径', `${APPLICABILITY_SNAPSHOT_REF.reference.entityId} ${APPLICABILITY_SNAPSHOT_REF.reference.versionId}`],
          ...PROCESS_NODE_DEPENDENCIES.map((node) => [node.name, node.processNodeId] as const),
        ]}
      />
    </div>
  );
}
