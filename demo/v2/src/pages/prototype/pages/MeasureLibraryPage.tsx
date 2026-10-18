// PROTOTYPE · THROWAWAY — 票 05 第 24 页：措施库
// 注意：路由标题历史上误写成「指标库」，正确名称是「措施库」。

import {
  MEASURE_LIBRARY_REF,
  MEASURE_OBJECTS,
  type KnowledgeLifecycle,
} from '../../../content/knowledge';
import { Ids, Section, Stats, Tag, Timeline } from '../parts';

const lifecycleState: Readonly<Record<KnowledgeLifecycle, 'done' | 'current' | 'pending'>> = {
  published: 'done',
  'in-review': 'current',
  draft: 'pending',
  deactivated: 'pending',
};

const LIFECYCLE_TEXT: Readonly<Record<KnowledgeLifecycle, string>> = {
  draft: '草稿',
  'in-review': '审核中',
  published: '已发布',
  deactivated: '已停用',
};

export function MeasureLibraryPage() {
  const objects = MEASURE_OBJECTS;
  const events = [...new Set(objects.map((o) => o.detail.applicableEvents))];
  const inReview = objects.filter((o) => o.versions[0].lifecycle === 'in-review').length;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">治理 / 措施库</div>
          <h1 className="dl-h1">措施库</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              {MEASURE_LIBRARY_REF.entityId} · {MEASURE_LIBRARY_REF.versionId}
            </span>
            <Tag>按风险事件分类</Tag>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">新增措施</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">提请发布</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '措施项', value: objects.length },
          { label: '覆盖风险事件', value: events.length },
          { label: '审核中', value: inReview },
          { label: '已被处置建议引用', value: objects.filter((o) => o.detail.usedByRecommendationId !== null).length },
        ]}
      />

      {events.map((ev) => (
        <Section key={ev} title={ev} flush>
          <table className="dl-table">
            <thead>
              <tr>
                <th>措施</th>
                <th>执行方向</th>
                <th>资源要求</th>
                <th>目标指标</th>
                <th>治理状态</th>
              </tr>
            </thead>
            <tbody>
              {objects
                .filter((o) => o.detail.applicableEvents === ev)
                .map((o) => (
                  <tr key={o.objectId}>
                    <td className="dl-sm" style={{ fontWeight: 600 }}>{o.name}</td>
                    <td className="dl-sm dl-muted">{o.detail.direction}</td>
                    <td className="dl-xs dl-muted">{o.detail.resourceRequirements.join('、')}</td>
                    <td className="dl-xs dl-muted">
                      {o.detail.targetIndicators.map((t) => `${t.indicatorItem}：${t.targetValue}`).join('；')}
                    </td>
                    <td>
                      <Tag accent={o.versions[0].lifecycle === 'in-review'}>
                        {LIFECYCLE_TEXT[o.versions[0].lifecycle]}
                      </Tag>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
      ))}

      {objects.map((o) => (
        <Section
          key={`${o.objectId}-detail`}
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {o.name}
              <Tag accent={o.versions[0].lifecycle === 'in-review'}>{LIFECYCLE_TEXT[o.versions[0].lifecycle]}</Tag>
            </span>
          }
        >
          <div className="dl-kv">
            <dt>适用风险事件</dt>
            <dd>{o.detail.applicableEvents}</dd>
            <dt>适用工法</dt>
            <dd>{o.detail.applicability.constructionMethod}</dd>
            <dt>适用地层</dt>
            <dd>{o.detail.applicability.stratumCondition}</dd>
            <dt>适用阶段</dt>
            <dd>{o.detail.applicability.engineeringStage}</dd>
            <dt>资源要求</dt>
            <dd>{o.detail.resourceRequirements.join('、')}</dd>
            <dt>目标指标</dt>
            <dd>
              {o.detail.targetIndicators.map((t) => (
                <div key={t.indicatorItem}>
                  {t.indicatorItem} · {t.targetValue}
                </div>
              ))}
            </dd>
            <dt>处置建议引用</dt>
            <dd>{o.detail.usedByRecommendationId ?? '尚未被处置建议引用'}</dd>
          </div>

          <hr className="dl-rule" />
          <div className="dl-h3 dl-faint" style={{ marginBottom: 8 }}>版本过程</div>
          <Timeline
            items={o.versions.map((v) => ({
              at: v.recordedAt.slice(0, 10),
              title: v.versionId,
              state: lifecycleState[v.lifecycle],
              meta: (
                <>
                  <Tag accent={v.lifecycle === 'in-review'}>{LIFECYCLE_TEXT[v.lifecycle]}</Tag>
                  <span className="dl-xs dl-faint">{v.actor}</span>
                </>
              ),
              body: (
                <div>
                  <div className="dl-sm dl-muted">{v.note}</div>
                  {v.diffs.map((d) => (
                    <div className="dl-xs" key={d.field} style={{ marginTop: 2 }}>
                      <span className="dl-faint">{d.field}：</span>
                      <span className="dl-delta-old">{d.before}</span> → {d.after}
                    </div>
                  ))}
                </div>
              ),
            }))}
          />

          <Ids pairs={[['措施', o.objectId], ['现行版本', o.currentVersion.versionId]]} />
        </Section>
      ))}
    </div>
  );
}
