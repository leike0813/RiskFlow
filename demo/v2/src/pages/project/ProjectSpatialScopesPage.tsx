// P-PJ-03 空间区段与上下文修订：D 治理骨架。
// 左：空间区段对象列表（业务状态筛选 chips）；右：修订表单（字段 diff + 提交说明）+ 版本列表。
// 动作名只取 PROJECT_MANAGER_ACCESS_ACTIONS：create-spatial-scope / revise-spatial-scope。
// 页面级能力位 engineering-data.write（框架层门控）；动作级同位门控。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import {
  CURRENT_PROJECT_REVISION,
  PROCESS_MODEL_RELEASE_REF,
  PROCESS_NODE_DEPENDENCIES,
  SPATIAL_SCOPE_REVISIONS,
  type SpatialScopeRevisionFixture,
} from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  FilterChips,
  GatedAction,
  VersionedRefText,
  formatDateTime,
} from './widgets';

type StatusFilter = 'all' | 'active' | 'inactive';

const STATUS_FILTER_OPTIONS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '启用' },
  { key: 'inactive', label: '停用' },
];

function currentRevisions(): readonly SpatialScopeRevisionFixture[] {
  const latest = new Map<string, SpatialScopeRevisionFixture>();
  for (const revision of SPATIAL_SCOPE_REVISIONS) {
    latest.set(revision.spatialScopeRef.reference.entityId, revision);
  }
  return [...latest.values()];
}

function DependencyChain({ scope }: { readonly scope: SpatialScopeRevisionFixture }) {
  const nodes = PROCESS_NODE_DEPENDENCIES.filter(
    (node) =>
      node.spatialScopeRef.reference.entityId === scope.spatialScopeRef.reference.entityId,
  );
  return (
    <section className="pj-card">
      <h3>project / spatial / process 三级依赖</h3>
      <div className="pj-dependency-chain">
        <span className="pj-node">
          工程修订{' '}
          <span className="mono">{CURRENT_PROJECT_REVISION.projectRevisionRef.reference.versionId}</span>
        </span>
        <span className="pj-arrow" aria-hidden>
          →
        </span>
        <span className="pj-node pj-node-current">
          区段修订{' '}
          <span className="mono">
            {scope.spatialScopeRef.reference.entityId} · {scope.spatialScopeRef.reference.versionId}
          </span>
        </span>
        <span className="pj-arrow" aria-hidden>
          →
        </span>
        {nodes.map((node) => (
          <span key={node.processNodeId} className="pj-node">
            <a href="#/identification/process-model" className="mono">
              {node.processNodeId}
            </a>{' '}
            {node.name}
          </span>
        ))}
      </div>
      <p className="pj-form-note">
        工序节点取自 <VersionedRefText label="工序模型发布" reference={PROCESS_MODEL_RELEASE_REF} />
        ；区段修订生效后，依赖该区段的工序节点按新区段修订重放适用性判断。
      </p>
    </section>
  );
}

function RevisionForm({
  scope,
  input,
}: {
  readonly scope: SpatialScopeRevisionFixture;
  readonly input: RouteRenderInput;
}) {
  const nextVersionId = `rev-${Number(scope.spatialScopeRef.reference.versionId.replace('rev-', '')) + 1}`;
  return (
    <section className="pj-card">
      <h3>修订表单</h3>
      <p className="pj-form-note">
        基于当前版本{' '}
        <span className="mono">
          {scope.spatialScopeRef.reference.entityId} · {scope.spatialScopeRef.reference.versionId}
        </span>{' '}
        提交；通过后生成 <span className="mono">{nextVersionId}</span>
        ，版本号单调递增，历史版本不被覆盖。
      </p>
      <h4>字段 diff</h4>
      <dl className="pj-field-grid">
        <div className="pj-field">
          <dt>区段名称</dt>
          <dd className="pj-diff">{scope.name}（未变更）</dd>
        </div>
        <div className="pj-field">
          <dt>里程</dt>
          <dd className="pj-diff">
            {scope.chainage === undefined
              ? '未登记（未变更）'
              : `${scope.chainage.start}–${scope.chainage.end}（未变更）`}
          </dd>
        </div>
        <div className="pj-field">
          <dt>地层条件覆盖</dt>
          <dd className="pj-diff">
            <span className="pj-diff-old">
              {scope.applicabilityOverrides.stratumCondition ?? '（继承工程级）'}
            </span>{' '}
            → <span className="pj-diff-new">富水砂层与软土交互段</span>
          </dd>
        </div>
        <div className="pj-field">
          <dt>业务状态</dt>
          <dd className="pj-diff">{scope.status === 'active' ? '启用（未变更）' : '停用（未变更）'}</dd>
        </div>
      </dl>
      <div className="pj-form-field" style={{ marginTop: 'var(--space-3)' }}>
        <label htmlFor="pj-spatial-reason">提交说明</label>
        <input id="pj-spatial-reason" defaultValue="补勘成果复核后更新地层条件覆盖" />
      </div>
      <div className="pj-actions" style={{ marginTop: 'var(--space-3)' }}>
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="提交区段修订"
          actionCode="revise-spatial-scope"
          primary
        />
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="新建空间区段"
          actionCode="create-spatial-scope"
        />
      </div>
    </section>
  );
}

function VersionList({ scope }: { readonly scope: SpatialScopeRevisionFixture }) {
  const versions = SPATIAL_SCOPE_REVISIONS.filter(
    (revision) =>
      revision.spatialScopeRef.reference.entityId === scope.spatialScopeRef.reference.entityId,
  );
  return (
    <section className="pj-card">
      <h3>版本列表（{scope.spatialScopeRef.reference.entityId}）</h3>
      <ol className="pj-timeline">
        {versions.map((revision) => {
          const current = revision.systemTime.supersededAt === undefined;
          return (
            <li key={revision.spatialScopeRef.reference.versionId}>
              <span className="mono pj-timeline-time">{revision.spatialScopeRef.reference.versionId}</span>
              <span>
                {current ? '当前版本' : `已由后续版本取代（${formatDateTime(revision.systemTime.supersededAt ?? '')}）`}
              </span>
              <Badge tone={current ? 'success' : 'neutral'}>{current ? '生效中' : '已取代'}</Badge>
              <span className="pj-timeline-actor">
                {revision.audit.action} · {formatDateTime(revision.systemTime.recordedAt)}
              </span>
              <span className="pj-form-note">{revision.audit.reason}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SpatialScopesContent({ input }: { readonly input: RouteRenderInput }) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const scopes = currentRevisions();
  const [selectedId, setSelectedId] = useState(scopes[0]?.spatialScopeRef.reference.entityId ?? '');
  const visible = scopes.filter((scope) => filter === 'all' || scope.status === filter);
  const selected = scopes.find((scope) => scope.spatialScopeRef.reference.entityId === selectedId) ?? scopes[0];
  return (
    <>
      <DependencyChain scope={selected} />
      <div className="pj-master-detail">
        <div>
          <FilterChips label="按业务状态筛选" options={STATUS_FILTER_OPTIONS} value={filter} onChange={setFilter} />
          {visible.length === 0 ? (
            <p className="pj-notice">当前筛选下没有空间区段。</p>
          ) : (
            <ul className="pj-list">
              {visible.map((scope) => {
                const id = scope.spatialScopeRef.reference.entityId;
                const active = id === selected.spatialScopeRef.reference.entityId;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`pj-list-item${active ? ' pj-list-item-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => setSelectedId(id)}
                    >
                      <span className="pj-list-item-title">
                        <span>{scope.name}</span>
                        <Badge tone={scope.status === 'active' ? 'success' : 'neutral'}>
                          {scope.status === 'active' ? '启用' : '停用'}
                        </Badge>
                      </span>
                      <span className="pj-list-item-sub mono">
                        {id} · {scope.spatialScopeRef.reference.versionId}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <RevisionForm scope={selected} input={input} />
          <VersionList scope={selected} />
        </div>
      </div>
    </>
  );
}

export function ProjectSpatialScopesPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="空间区段与上下文修订"
      state={input.pageState}
      skeleton="D"
      emptyMessage="当前工程尚未划分空间区段，可经「新建空间区段」创建第一个区段。"
      content={<SpatialScopesContent input={input} />}
    />
  );
}
