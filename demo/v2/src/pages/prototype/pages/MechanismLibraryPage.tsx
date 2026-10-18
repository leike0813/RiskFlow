// PROTOTYPE · THROWAWAY — 票 05 第 21 页：风险源清单（治理侧）
// 命名依据票 01：知识侧叫「风险源清单」，识别侧运行结果才叫「风险记录」。

import {
  KNOWLEDGE_LIFECYCLE_LABELS,
  MECHANISM_LIBRARY_REF,
  MECHANISM_OBJECTS,
  type KnowledgeLifecycle,
  type KnowledgeObject,
} from '../../../content/knowledge';
import { Ids, Section, Stats, Tag, Timeline } from '../parts';

function lifecycle(lc: KnowledgeLifecycle) {
  return <Tag accent={lc === 'in-review'}>{KNOWLEDGE_LIFECYCLE_LABELS[lc]}</Tag>;
}

const timelineState: Readonly<Record<KnowledgeLifecycle, 'done' | 'current' | 'pending'>> = {
  published: 'done',
  'in-review': 'current',
  draft: 'pending',
  deactivated: 'pending',
};

/** 各风险源的「当前状态」：取其最新一条版本记录。 */
function latest<T>(o: KnowledgeObject<T>) {
  return o.versions[0];
}

export function MechanismLibraryPage() {
  const objects = MECHANISM_OBJECTS;
  const published = objects.filter((o) => latest(o).lifecycle === 'published').length;
  const inReview = objects.filter((o) => latest(o).lifecycle === 'in-review').length;
  const linked = objects.filter((o) => o.detail.linkedRiskRecordId !== null).length;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">治理 / 风险源清单</div>
          <h1 className="dl-h1">风险源清单</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              风险源库 {MECHANISM_LIBRARY_REF.entityId} · {MECHANISM_LIBRARY_REF.versionId}
            </span>
            <Tag accent>知识侧治理对象</Tag>
            <span className="dl-xs dl-faint">运行后产出的结果在识别侧叫「风险记录」</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">新建风险源</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">提请发布</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '风险源条目', value: objects.length },
          { label: '现行有效', value: published },
          { label: '审核中', value: inReview },
          { label: '已产出风险记录', value: linked },
        ]}
      />

      <Section title="清单" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>风险源</th>
              <th>类型</th>
              <th>适用工序</th>
              <th>地层条件</th>
              <th>治理状态</th>
              <th>生效版本</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((o) => (
              <tr key={o.objectId}>
                <td>
                  <div className="dl-sm" style={{ fontWeight: 600 }}>{o.name}</div>
                  <div className="dl-xs dl-faint">{o.detail.riskEventExpression}</div>
                </td>
                <td className="dl-sm">{o.detail.mechanismType}</td>
                <td className="dl-sm dl-muted">
                  {o.detail.applicableProcessNodes.map((n) => n.name).join('、')}
                </td>
                <td className="dl-sm dl-muted">{o.detail.stratumCondition}</td>
                <td>{lifecycle(latest(o).lifecycle)}</td>
                <td className="dl-sm dl-num">{o.currentVersion.versionId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {objects.map((o) => (
        <Section
          key={o.objectId}
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {o.name}
              {lifecycle(latest(o).lifecycle)}
            </span>
          }
          action={<span className="dl-xs dl-faint">证据要求：{o.detail.evidenceRequirement}</span>}
        >
          <div className="dl-kv">
            <dt>触发条件</dt>
            <dd>{o.detail.triggerCondition}</dd>
            <dt>监测前兆</dt>
            <dd>{o.detail.monitoringSigns.join('、')}</dd>
            <dt>证据来源</dt>
            <dd>{o.detail.evidenceReferences.map((e) => e.locator.sourceSegmentId).join('、')}</dd>
            <dt>关联风险记录</dt>
            <dd>{o.detail.linkedRiskRecordId ?? '尚未产出风险记录'}</dd>
          </div>

          <hr className="dl-rule" />
          <div className="dl-h3 dl-faint" style={{ marginBottom: 8 }}>版本治理过程</div>
          <Timeline
            items={o.versions.map((v) => ({
              at: v.recordedAt.slice(0, 10),
              title: v.versionId,
              state: timelineState[v.lifecycle],
              meta: (
                <>
                  {lifecycle(v.lifecycle)}
                  <span className="dl-xs dl-faint">{v.actor}</span>
                </>
              ),
              body: (
                <div>
                  <div className="dl-sm dl-muted">{v.note}</div>
                  {v.rollbackOf ? (
                    <div className="dl-xs dl-faint">内容回滚至 {v.rollbackOf}，以新版本发布</div>
                  ) : null}
                  {v.diffs.length > 0 ? (
                    <div style={{ marginTop: 6 }}>
                      {v.diffs.map((d) => (
                        <div className="dl-xs" key={d.field}>
                          <span className="dl-faint">{d.field}：</span>
                          <span className="dl-delta-old">{d.before}</span> → {d.after}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            }))}
          />

          <Ids
            pairs={[
              ['对象', o.objectId],
              ['现行版本', o.currentVersion.versionId],
              ['类型', o.detail.mechanismType],
            ]}
          />
        </Section>
      ))}
    </div>
  );
}
