// PROTOTYPE · THROWAWAY — 票 05 第 23 页：指标体系与量化标准
// 票 03 → 票 04 结论：契约层 11 类 definitionType 中没有独立的「量化标准」。
// 量化标准是通过指标体系内的 quantizationIntervalRef 表达的指标附属引用，
// 不是可独立发布、独立版本化的治理对象——本页据此呈现，不提供其发布动作。

import {
  INDICATOR_SYSTEM_OBJECTS,
  INDICATOR_SYSTEM_REF,
  QUANTIZATION_STANDARD_REF,
  WEIGHT_SET_REF,
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

export function IndicatorSystemPage() {
  const objects = INDICATOR_SYSTEM_OBJECTS;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">治理 / 指标体系与量化标准</div>
          <h1 className="dl-h1">指标体系与量化标准</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              {INDICATOR_SYSTEM_REF.entityId} · {INDICATOR_SYSTEM_REF.versionId}
            </span>
            <Tag accent>量化标准随指标体系发布</Tag>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">新增指标</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">提请发布指标体系</button>
        </div>
      </header>

      {objects.map((o) => {
        const d = o.detail;
        const groups = [...new Set(d.items.map((i) => i.group))];
        const probability = d.items.filter((i) => i.indicatorType === '发生可能性评估指标').length;
        const consequence = d.items.filter((i) => i.indicatorType === '后果严重性评估指标').length;

        return (
          <Section key={o.objectId} title={o.name}>
            <Stats
              items={[
                { label: '指标项', value: d.items.length },
                { label: '指标分组', value: groups.length },
                { label: '可能性指标', value: probability },
                { label: '严重性指标', value: consequence },
              ]}
            />

            <hr className="dl-rule" />

            <div className="dl-kv">
              <dt>适用工法</dt>
              <dd>{d.applicabilityMetadata.constructionMethod}</dd>
              <dt>适用地层</dt>
              <dd>{d.applicabilityMetadata.stratumCondition}</dd>
              <dt>适用阶段</dt>
              <dd>{d.applicabilityMetadata.engineeringStage}</dd>
              <dt>适用性必填维度</dt>
              <dd>{d.requiredDimensions.join('、')}</dd>
              <dt>关联权重集</dt>
              <dd>{d.weightSetRef.entityId} · {d.weightSetRef.versionId}</dd>
            </div>

            <Ids
              pairs={[
                ['指标体系', o.objectId],
                ['现行版本', o.currentVersion.versionId],
                ['指标附属引用', `量化区间 ${d.quantizationStandardRef.entityId} · ${d.quantizationStandardRef.versionId}`],
              ]}
            />
          </Section>
        );
      })}

      <Section
        title="指标与量化标准"
        action={<span className="dl-xs dl-faint">指标名与量化标准均为甲方原词</span>}
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th>指标分组</th>
              <th>指标名称</th>
              <th>评估用途</th>
              <th>单位</th>
              <th>量化标准</th>
            </tr>
          </thead>
          <tbody>
            {objects.flatMap((o) =>
              o.detail.items.map((i) => (
                <tr key={i.itemId}>
                  <td className="dl-sm dl-muted">{i.group}</td>
                  <td className="dl-sm">{i.name}</td>
                  <td className="dl-sm dl-muted">{i.indicatorType}</td>
                  <td className="dl-sm dl-num">{i.unit}</td>
                  <td className="dl-sm">{i.quantitativeScale}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <div className="dl-xs dl-faint" style={{ padding: '10px 16px', borderTop: '1px solid var(--dl-border)' }}>
          量化标准不是独立治理对象：它由每个指标的量化区间引用（{QUANTIZATION_STANDARD_REF.entityId} ·{' '}
          {QUANTIZATION_STANDARD_REF.versionId}）表达，随所属指标体系一起发布与停用，不能单独发布或单独升版。
        </div>
      </Section>

      <Section title="权重集" action={<Tag>{WEIGHT_SET_REF.versionId}</Tag>}>
        <div className="dl-sm dl-muted">
          权重集 {WEIGHT_SET_REF.entityId} · {WEIGHT_SET_REF.versionId} 与本指标体系配套使用，
          由评分规则与指标体系共同引用，本身不在本页发布。
        </div>
      </Section>

      {objects.map((o) => (
        <Section key={`${o.objectId}-versions`} title="指标体系版本过程" flush>
          <div style={{ padding: '12px 16px' }}>
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
                    {v.diffs.map((df) => (
                      <div className="dl-xs" key={df.field} style={{ marginTop: 2 }}>
                        <span className="dl-faint">{df.field}：</span>
                        <span className="dl-delta-old">{df.before}</span> → {df.after}
                      </div>
                    ))}
                  </div>
                ),
              }))}
            />
          </div>
        </Section>
      ))}
    </div>
  );
}
