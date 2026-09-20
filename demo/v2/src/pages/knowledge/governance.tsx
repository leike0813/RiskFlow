// 知识域 D 治理骨架共享视图（P-KM-01～P-KM-08 共用）。
// 布局按 PAGE-GUIDE §2：左为对象列表（审核状态筛选 chips），
// 右为对象详情 + 修订表单（字段 diff + 提交说明）+ 版本列表（版本 diff 入口）。
// 治理动作按 input.capabilities 三态渲染（allowed / denied / unknown），
// 动作能力位由 branch 在 contract-mirror 的映射取得，不发明动作名。

import { useState, type ReactNode } from 'react';
import { capabilityStateFor } from '../../app/capabilities';
import {
  BRANCH_CAPABILITY,
  versionedRef,
  type ModuleBranch,
} from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import {
  KNOWLEDGE_LIFECYCLE_LABELS,
  type FieldDiff,
  type KnowledgeLifecycle,
  type KnowledgeObject,
  type VersionReference,
} from '../../content/knowledge';
import { PageFrame } from '../../shared/PageFrame';
import type { PageManifestEntry } from '../manifest';

/** versionedRef 呈现：`<类别名> <entityId> · <versionId>`，等宽字体。 */
export function VersionedRefView({
  kindLabel,
  reference,
}: {
  readonly kindLabel: string;
  readonly reference: VersionReference;
}) {
  const ref = versionedRef(kindLabel, reference.entityId, reference.versionId);
  return (
    <span className="km-vref mono">
      {ref.kind} {ref.reference.entityId} · {ref.reference.versionId}
    </span>
  );
}

export function LifecycleChip({ lifecycle }: { readonly lifecycle: KnowledgeLifecycle }) {
  return (
    <span className={`km-chip km-chip-${lifecycle}`}>
      {KNOWLEDGE_LIFECYCLE_LABELS[lifecycle]}
    </span>
  );
}

interface GovernAction {
  readonly key: string;
  readonly label: string;
  readonly branch: ModuleBranch;
}

const GOVERN_ACTIONS: readonly GovernAction[] = [
  { key: 'submit', label: '提交修订', branch: 'knowledge-modeling.submit-revision' },
  { key: 'request-review', label: '提请审核', branch: 'knowledge-modeling.request-review' },
  { key: 'publish', label: '发布新版本', branch: 'knowledge-modeling.publish-approved-release' },
  { key: 'deactivate', label: '停用版本', branch: 'knowledge-modeling.deactivate-release' },
  { key: 'rollback', label: '回滚为新版本', branch: 'knowledge-modeling.rollback-by-new-release' },
];

function GovernActions({ capabilities }: { readonly capabilities: ReadonlySet<string> | null }) {
  return (
    <div className="km-actions" role="group" aria-label="治理动作">
      {GOVERN_ACTIONS.map((action) => {
        const capability = BRANCH_CAPABILITY[action.branch];
        const state = capabilityStateFor(capability, capabilities);
        if (state === 'allowed') {
          return (
            <button key={action.key} type="button" className="km-btn">
              {action.label}
            </button>
          );
        }
        if (state === 'unknown') {
          return (
            <button key={action.key} type="button" className="km-btn" disabled>
              权限检查中
            </button>
          );
        }
        return (
          <button key={action.key} type="button" className="km-btn" disabled aria-disabled="true">
            {action.label}
            <span className="visually-hidden">需要能力 {capability}</span>
          </button>
        );
      })}
    </div>
  );
}

function DiffTable({ diffs }: { readonly diffs: readonly FieldDiff[] }) {
  if (diffs.length === 0) {
    return <p className="km-muted">本版无字段级差异记录。</p>;
  }
  return (
    <table className="km-table">
      <thead>
        <tr>
          <th scope="col">字段</th>
          <th scope="col">修订前</th>
          <th scope="col">修订后</th>
        </tr>
      </thead>
      <tbody>
        {diffs.map((diff) => (
          <tr key={diff.field}>
            <td>{diff.field}</td>
            <td>{diff.before}</td>
            <td>{diff.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RevisionPanel<TDetail>({
  object,
  capabilities,
}: {
  readonly object: KnowledgeObject<TDetail>;
  readonly capabilities: ReadonlySet<string> | null;
}) {
  const draft = object.versions.find((version) => version.lifecycle === 'draft') ?? null;
  return (
    <section className="km-card" aria-label="修订表单">
      <h3>修订表单</h3>
      {draft === null ? (
        <p className="km-muted">当前无草稿修订；提交修订后在此维护字段 diff 与提交说明。</p>
      ) : (
        <>
          <p className="km-muted">
            草稿版本 <span className="mono">{draft.versionId}</span>（{draft.actor} ·{' '}
            {draft.recordedAt}）
          </p>
          <DiffTable diffs={draft.diffs} />
          <label className="km-field">
            <span>提交说明</span>
            <textarea rows={2} defaultValue={draft.note} />
          </label>
        </>
      )}
      <GovernActions capabilities={capabilities} />
    </section>
  );
}

function VersionList({ versions }: { readonly versions: KnowledgeObject<unknown>['versions'] }) {
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  return (
    <section className="km-card" aria-label="版本列表">
      <div className="km-card-head">
        <h3>版本列表</h3>
        <a href="#/review-audit/audit-log">版本与操作审计</a>
      </div>
      <ul className="km-versions">
        {versions.map((version) => {
          const expanded = expandedVersionId === version.versionId;
          return (
            <li key={version.versionId} className="km-version">
              <div className="km-version-row">
                <span className="mono">{version.versionId}</span>
                <LifecycleChip lifecycle={version.lifecycle} />
                {version.rollbackOf === undefined ? null : (
                  <span className="km-chip km-chip-rollback">回滚自 {version.rollbackOf}</span>
                )}
              </div>
              <p className="km-muted">
                {version.actor} · {version.recordedAt}
              </p>
              <p>{version.note}</p>
              <div className="km-version-links">
                {version.diffs.length === 0 ? null : (
                  <button
                    type="button"
                    className="km-link-btn"
                    aria-expanded={expanded}
                    onClick={() => setExpandedVersionId(expanded ? null : version.versionId)}
                  >
                    {expanded ? '收起版本差异' : '与上一版对比'}
                  </button>
                )}
                {version.lifecycle === 'in-review' ? (
                  <a href="#/review-audit">前往复核队列</a>
                ) : null}
              </div>
              {expanded ? <DiffTable diffs={version.diffs} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type LifecycleFilter = 'all' | KnowledgeLifecycle;

export interface LibraryRef {
  readonly kindLabel: string;
  readonly reference: VersionReference;
}

export function GovernanceView<TDetail>({
  page,
  input,
  objects,
  libraryRef,
  objectKindLabel,
  emptyMessage,
  renderDetail,
}: {
  readonly page: PageManifestEntry;
  readonly input: RouteRenderInput;
  readonly objects: readonly KnowledgeObject<TDetail>[];
  readonly libraryRef: LibraryRef;
  readonly objectKindLabel: string;
  readonly emptyMessage: string;
  readonly renderDetail: (object: KnowledgeObject<TDetail>) => ReactNode;
}) {
  const [filter, setFilter] = useState<LifecycleFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(objects[0]?.objectId ?? null);

  const visible =
    filter === 'all'
      ? objects
      : objects.filter((object) =>
          object.versions.some((version) => version.lifecycle === filter),
        );
  const selected = visible.find((object) => object.objectId === selectedId) ?? visible[0] ?? null;

  const countFor = (lifecycle: KnowledgeLifecycle): number =>
    objects.filter((object) =>
      object.versions.some((version) => version.lifecycle === lifecycle),
    ).length;

  const chips: readonly { readonly key: LifecycleFilter; readonly label: string; readonly count: number }[] = [
    { key: 'all', label: '全部', count: objects.length },
    { key: 'draft', label: '草稿', count: countFor('draft') },
    { key: 'in-review', label: '审核中', count: countFor('in-review') },
    { key: 'published', label: '已发布', count: countFor('published') },
    { key: 'deactivated', label: '已停用', count: countFor('deactivated') },
  ];

  return (
    <PageFrame
      title={page.title}
      state={input.pageState}
      skeleton={page.skeleton}
      emptyMessage={emptyMessage}
      content={
        <div className="km-gov">
          <aside className="km-gov-side">
            <div className="km-filters" role="group" aria-label="审核状态筛选">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={chip.key === filter ? 'km-filter is-active' : 'km-filter'}
                  aria-pressed={chip.key === filter}
                  onClick={() => setFilter(chip.key)}
                >
                  {chip.label}
                  <span className="km-filter-count mono">{chip.count}</span>
                </button>
              ))}
            </div>
            <ul className="km-objects">
              {visible.map((object) => {
                const lifecycle: KnowledgeLifecycle =
                  object.versions.find((version) => version.lifecycle === 'draft')?.lifecycle ??
                  object.versions.find((version) => version.lifecycle === 'in-review')?.lifecycle ??
                  object.versions[0]?.lifecycle ??
                  'published';
                const active = selected !== null && object.objectId === selected.objectId;
                return (
                  <li key={object.objectId}>
                    <button
                      type="button"
                      className={active ? 'km-object is-active' : 'km-object'}
                      aria-current={active}
                      onClick={() => setSelectedId(object.objectId)}
                    >
                      <span className="km-object-name">{object.name}</span>
                      <span className="km-object-meta">
                        <span className="mono">{object.objectId}</span>
                        <LifecycleChip lifecycle={lifecycle} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <div className="km-gov-main">
            {selected === null ? (
              <p className="km-muted">当前筛选下没有{objectKindLabel}。</p>
            ) : (
              <>
                <header className="km-main-head">
                  <h3>{selected.name}</h3>
                  <p className="km-vref-row">
                    <VersionedRefView
                      kindLabel={libraryRef.kindLabel}
                      reference={libraryRef.reference}
                    />
                    <VersionedRefView
                      kindLabel={objectKindLabel}
                      reference={selected.currentVersion}
                    />
                  </p>
                </header>
                {renderDetail(selected)}
                <RevisionPanel object={selected} capabilities={input.capabilities} />
                <VersionList versions={selected.versions} />
              </>
            )}
          </div>
        </div>
      }
    />
  );
}
