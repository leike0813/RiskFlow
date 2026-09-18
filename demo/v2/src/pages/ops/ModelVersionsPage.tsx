// P-OP-04 模型与提示模板版本（骨架 D 治理；branch null / 页面级能力位 null，设施域）。
// 左：对象列表（审核状态筛选 chips）；右：对象详情 + 修订表单（字段 diff +
// 提交说明）+ 版本列表。模型部署与提示模板均以 versionedRef 呈现；
// 微调权重（低秩适应）与原始权重同时可加载、可回退的语义在详情区显式呈现。
// 治理动作在 29 个业务能力位中无专属位，按系统管理员身份三态门控
// （docs/gap-inbox/ops.md）。七态由 PageFrame 经 input.pageState 承载。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import {
  GOVERNED_OPS_OBJECTS,
  OPS_LIFECYCLE_LABELS,
  type FieldDiff,
  type GovernedOpsObject,
  type ModelDeploymentObject,
  type OpsGovernanceLifecycle,
  type PromptTemplateObject,
} from '../../content/ops';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextLine,
  DataTable,
  Field,
  FilterChips,
  SystemAction,
  VersionRefText,
} from './widgets';

type LifecycleFilter = 'all' | OpsGovernanceLifecycle;

const LIFECYCLE_FILTERS: readonly { readonly key: LifecycleFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'in-review', label: '审核中' },
  { key: 'published', label: '已发布' },
  { key: 'deactivated', label: '已停用' },
];

const LIFECYCLE_TONES: Readonly<
  Record<OpsGovernanceLifecycle, 'neutral' | 'blue' | 'success' | 'review'>
> = {
  draft: 'neutral',
  'in-review': 'review',
  published: 'success',
  deactivated: 'neutral',
};

function DiffTable({ diffs }: { readonly diffs: readonly FieldDiff[] }) {
  if (diffs.length === 0) {
    return <p className="op-muted">本版无字段级差异记录。</p>;
  }
  return (
    <DataTable caption="字段差异" head={['字段', '修订前', '修订后']}>
      {diffs.map((diff) => (
        <tr key={diff.field}>
          <td>{diff.field}</td>
          <td>{diff.before}</td>
          <td>{diff.after}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function ModelDetail({ object }: { readonly object: ModelDeploymentObject }) {
  return (
    <section className="op-card">
      <h3>部署详情</h3>
      <div className="op-field-grid">
        <Field label="对象标识">
          <span className="mono">{object.objectId}</span>
        </Field>
        <Field label="用途">{object.role}</Field>
        <Field label="权重加载语义">{object.weightLoading}</Field>
        <Field label="基础模型（原始权重）">
          {object.baseModelRef === null ? (
            <span className="op-muted">本对象即原始权重部署</span>
          ) : (
            <VersionRefText kind="基础模型" reference={object.baseModelRef} />
          )}
        </Field>
      </div>
      {object.baseModelRef === null ? null : (
        <p className="op-muted">
          回退不覆盖历史版本：以「回退为新版本」发布一个内容等于历史版本的版本，
          原始权重部署始终可独立加载。
        </p>
      )}
    </section>
  );
}

function PromptDetail({ object }: { readonly object: PromptTemplateObject }) {
  return (
    <section className="op-card">
      <h3>模板详情</h3>
      <div className="op-field-grid">
        <Field label="对象标识">
          <span className="mono">{object.objectId}</span>
        </Field>
        <Field label="适用任务">{object.taskScope}</Field>
      </div>
    </section>
  );
}

function UsedByCard({ object }: { readonly object: GovernedOpsObject }) {
  return (
    <section className="op-card">
      <h3>被引用</h3>
      <ul className="op-timeline">
        {object.usedBy.map((ref) => (
          <li key={ref.path + ref.label}>
            <a href={`#${ref.path}`}>{ref.label}</a>
          </li>
        ))}
      </ul>
      <p className="op-muted">
        版本与治理操作另入 <a href="#/review-audit/audit-log">版本与操作审计</a>。
      </p>
    </section>
  );
}

function RevisionPanel({
  object,
  input,
}: {
  readonly object: GovernedOpsObject;
  readonly input: RouteRenderInput;
}) {
  const draft = object.versions.find((version) => version.lifecycle === 'draft') ?? null;
  return (
    <section className="op-card" aria-label="修订表单">
      <h3>修订表单</h3>
      {draft === null ? (
        <p className="op-muted">当前无草稿修订；提交修订后在此维护字段 diff 与提交说明。</p>
      ) : (
        <>
          <p className="op-muted">
            草稿版本 <span className="mono">{draft.versionId}</span>（{draft.actor} ·{' '}
            {draft.recordedAt.slice(0, 16).replace('T', ' ')}）
          </p>
          <DiffTable diffs={draft.diffs} />
          <p className="op-muted">提交说明：{draft.note}</p>
        </>
      )}
      <div className="op-actions" role="group" aria-label="版本治理动作">
        <SystemAction label="提交修订" capabilities={input.capabilities} />
        <SystemAction label="提请审核" capabilities={input.capabilities} />
        <SystemAction label="发布新版本" capabilities={input.capabilities} primary />
        <SystemAction label="停用版本" capabilities={input.capabilities} />
        <SystemAction label="回退为新版本" capabilities={input.capabilities} />
      </div>
    </section>
  );
}

function VersionList({ object }: { readonly object: GovernedOpsObject }) {
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  return (
    <section className="op-card" aria-label="版本列表">
      <h3>版本列表</h3>
      <ul className="op-versions">
        {object.versions.map((version) => {
          const expanded = expandedVersionId === version.versionId;
          return (
            <li key={version.versionId} className="op-version">
              <div className="op-version-row">
                <span className="mono">{version.versionId}</span>
                <Badge tone={LIFECYCLE_TONES[version.lifecycle]}>
                  {OPS_LIFECYCLE_LABELS[version.lifecycle]}
                </Badge>
                {version.rollbackOf === undefined ? null : (
                  <Badge tone="blue">回退自 {version.rollbackOf}</Badge>
                )}
              </div>
              <p className="op-muted">
                {version.actor} · {version.recordedAt.slice(0, 16).replace('T', ' ')}
              </p>
              <p>{version.note}</p>
              {version.diffs.length === 0 ? null : (
                <p>
                  <button
                    type="button"
                    className="op-chip"
                    aria-expanded={expanded}
                    onClick={() => setExpandedVersionId(expanded ? null : version.versionId)}
                  >
                    {expanded ? '收起版本差异' : '与上一版对比'}
                  </button>
                </p>
              )}
              {expanded ? <DiffTable diffs={version.diffs} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function lifecycleOf(object: GovernedOpsObject): OpsGovernanceLifecycle {
  return (
    object.versions.find((version) => version.lifecycle === 'draft')?.lifecycle ??
    object.versions.find((version) => version.lifecycle === 'in-review')?.lifecycle ??
    object.versions[0]?.lifecycle ??
    'published'
  );
}

function objectKindLabel(object: GovernedOpsObject): string {
  return object.kind === 'model-deployment' ? '模型部署' : '提示模板';
}

export function ModelVersionsPage({ input }: { readonly input: RouteRenderInput }) {
  const [filter, setFilter] = useState<LifecycleFilter>('all');
  const [selectedId, setSelectedId] = useState<string>(GOVERNED_OPS_OBJECTS[0].objectId);

  const visible = GOVERNED_OPS_OBJECTS.filter(
    (object) =>
      filter === 'all' || object.versions.some((version) => version.lifecycle === filter),
  );
  const selected =
    visible.find((object) => object.objectId === selectedId) ?? visible[0] ?? null;

  return (
    <PageFrame
      title="模型与提示模板版本"
      state={input.pageState}
      skeleton="D"
      emptyMessage="暂无模型或提示模板版本，可登记第一个版本对象"
      content={
        <div>
          <ContextLine
            items={[
              `版本对象 ${GOVERNED_OPS_OBJECTS.length} 个`,
              '版本引用为不可变快照语义',
              '数据时点 2026-09-18 09:00',
            ]}
          />
          <div className="op-gov">
            <aside className="op-gov-side">
              <FilterChips
                label="审核状态筛选"
                options={LIFECYCLE_FILTERS}
                value={filter}
                onChange={setFilter}
              />
              {visible.length === 0 ? (
                <p className="op-muted">当前筛选下没有版本对象。</p>
              ) : (
                <ul className="op-object-list">
                  {visible.map((object) => (
                    <li key={object.objectId}>
                      <button
                        type="button"
                        className={`op-object${
                          selected !== null && object.objectId === selected.objectId
                            ? ' is-active'
                            : ''
                        }`}
                        aria-current={selected !== null && object.objectId === selected.objectId}
                        onClick={() => setSelectedId(object.objectId)}
                      >
                        <span className="op-object-name">{object.name}</span>
                        <span className="op-object-meta">
                          <span className="mono">{object.objectId}</span>
                          <Badge tone={LIFECYCLE_TONES[lifecycleOf(object)]}>
                            {OPS_LIFECYCLE_LABELS[lifecycleOf(object)]}
                          </Badge>
                        </span>
                        <span className="op-muted">{objectKindLabel(object)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
            <div className="op-gov-main">
              {selected === null ? (
                <p className="op-muted">当前筛选下没有版本对象。</p>
              ) : (
                <>
                  <section className="op-card">
                    <h3>{selected.name}</h3>
                    <p className="op-vref-row">
                      <VersionRefText
                        kind={objectKindLabel(selected)}
                        reference={selected.currentVersion}
                      />
                    </p>
                  </section>
                  {selected.kind === 'model-deployment' ? (
                    <ModelDetail object={selected} />
                  ) : (
                    <PromptDetail object={selected} />
                  )}
                  <UsedByCard object={selected} />
                  <RevisionPanel object={selected} input={input} />
                  <VersionList object={selected} />
                </>
              )}
            </div>
          </div>
        </div>
      }
    />
  );
}
