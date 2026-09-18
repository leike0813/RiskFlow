// P-PJ-01 工程概览：B 详情骨架 + KPI 横条网格形态。
// 数据：projection.query（只读投影）；页面级能力位 projection.query（框架层门控）。

import type { RouteRenderInput } from '../../app/routes';
import {
  CURRENT_PROJECT_REVISION,
  CURRENT_SPATIAL_REVISIONS,
  PROJECT_OVERVIEW_KPIS,
  PROJECT_TIMELINE,
} from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import { BusinessTimeline, Field, FieldGroup, VersionedRefText } from './widgets';

const LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  preparing: '筹备中',
  active: '在建',
  ended: '已完工',
  archived: '已归档',
};

function OverviewContent() {
  const revision = CURRENT_PROJECT_REVISION;
  return (
    <>
      <div className="pj-kpi-grid" aria-label="工程关键指标">
        {PROJECT_OVERVIEW_KPIS.map((kpi) => (
          <a key={kpi.key} className="pj-kpi" href={`#${kpi.path}`}>
            <span className="pj-kpi-label">{kpi.label}</span>
            <span className="pj-kpi-value">{kpi.value}</span>
            <span className="pj-kpi-hint">{kpi.hint}</span>
          </a>
        ))}
      </div>
      <FieldGroup title="当前业务上下文">
        <Field label="工程名称">{revision.name}</Field>
        <Field label="工程标识">
          <span className="mono">{revision.projectId}</span>
        </Field>
        <Field label="生命周期">{LIFECYCLE_LABELS[revision.lifecycle]}</Field>
        <Field label="当前修订">
          <VersionedRefText label="工程修订" reference={revision.projectRevisionRef} />
        </Field>
        <Field label="施工工法">{revision.applicabilityMetadata.constructionMethod}</Field>
        <Field label="地层条件">{revision.applicabilityMetadata.stratumCondition}</Field>
        <Field label="工程阶段">{revision.applicabilityMetadata.engineeringStage}</Field>
        <Field label="生效区间">
          自 {revision.effectivePeriod.validFrom.slice(0, 10)}
          {revision.effectivePeriod.validTo === undefined
            ? ' 起'
            : ` 至 ${revision.effectivePeriod.validTo.slice(0, 10)}`}
        </Field>
      </FieldGroup>
      <section className="pj-card">
        <h3>空间区段（当前修订）</h3>
        <ul className="pj-list">
          {CURRENT_SPATIAL_REVISIONS.map((spatial) => (
            <li key={spatial.spatialScopeRef.reference.versionId} className="pj-list-item">
              <span className="pj-list-item-title">
                <span>{spatial.name}</span>
                <VersionedRefText label="区段修订" reference={spatial.spatialScopeRef} />
              </span>
              <span className="pj-list-item-sub">
                {spatial.chainage === undefined
                  ? spatial.worksiteLocation
                  : `里程 ${spatial.chainage.start}–${spatial.chainage.end} · ${spatial.worksiteLocation}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="pj-form-note">
          区段修订与工序节点维护见 <a href="#/projects/spatial-scopes">空间区段与上下文修订</a>。
        </p>
      </section>
      <BusinessTimeline events={PROJECT_TIMELINE} />
    </>
  );
}

export function ProjectOverviewPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="工程概览"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前工程尚未登记业务上下文，请先完成工程开通。"
      content={<OverviewContent />}
    />
  );
}
