// PROTOTYPE · THROWAWAY — 票 05 第 22 页：评分规则（结构化评分规则）
// 指标名与量化标准一律用甲方原词，不改写、不翻译。

import { Fragment } from 'react';
import {
  APPLICABLE_RULE_SET_REF,
  KNOWLEDGE_LIFECYCLE_LABELS,
  RULE_SET_OBJECTS,
  type GradeInterval,
  type KnowledgeLifecycle,
  type ScoringThreshold,
} from '../../../content/knowledge';
import { Ids, Section, Stats, Tag, Timeline } from '../parts';

const lifecycleState: Readonly<Record<KnowledgeLifecycle, 'done' | 'current' | 'pending'>> = {
  published: 'done',
  'in-review': 'current',
  draft: 'pending',
  deactivated: 'pending',
};

const REVIEW_STATUS: Readonly<Record<'pending' | 'approved' | 'rejected', string>> = {
  pending: '待复核',
  approved: '已复核',
  rejected: '复核未通过',
};

/** 阈值运算符的业务读法，避免界面上出现原始符号。 */
const OPERATOR_TEXT: Readonly<Record<ScoringThreshold['operator'], string>> = {
  lte: '≤',
  lt: '<',
  gte: '≥',
  gt: '>',
  eq: '=',
  between: '介于',
};

function thresholdText(t: ScoringThreshold) {
  const base = String(t.value);
  return t.operator === 'between' ? `${OPERATOR_TEXT[t.operator]} ${base} ~ ${t.upperValue}` : `${OPERATOR_TEXT[t.operator]} ${base}`;
}

function gradeText(g: GradeInterval) {
  if (g.lowerBound !== undefined && g.upperBound !== undefined) return `${g.lowerBound} < 评分 ≤ ${g.upperBound}`;
  if (g.upperBound !== undefined) return `评分 ≤ ${g.upperBound}`;
  return `评分 > ${g.lowerBound}`;
}

export function RuleSetPage() {
  const objects = RULE_SET_OBJECTS;
  const rules = objects.flatMap((o) => o.detail.rules);

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">治理 / 评分规则</div>
          <h1 className="dl-h1">评分规则</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              适用规则集 {APPLICABLE_RULE_SET_REF.entityId} · {APPLICABLE_RULE_SET_REF.versionId}
            </span>
            <Tag accent>结构化评分规则</Tag>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">新增评分规则</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">提请发布</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '规则集', value: objects.length },
          { label: '成员规则', value: rules.length },
          { label: '已复核', value: rules.filter((r) => r.reviewStatus === 'approved').length },
          { label: '待复核', value: rules.filter((r) => r.reviewStatus === 'pending').length },
        ]}
      />

      {objects.map((o) => {
        const d = o.detail;
        return (
          <Fragment key={o.objectId}>
            <Section title={o.name} action={<Tag>{KNOWLEDGE_LIFECYCLE_LABELS[o.versions[0].lifecycle]}</Tag>}>
              <div className="dl-kv">
                <dt>适用工法</dt>
                <dd>{d.applicableRuleSet.metadataSnapshot.constructionMethod}</dd>
                <dt>适用地层</dt>
                <dd>{d.applicableRuleSet.metadataSnapshot.stratumCondition}</dd>
                <dt>适用阶段</dt>
                <dd>{d.applicableRuleSet.metadataSnapshot.engineeringStage}</dd>
                <dt>发布时间</dt>
                <dd className="dl-num">{d.applicableRuleSet.publishedAt.slice(0, 10)}</dd>
                <dt>关联权重集</dt>
                <dd>{d.weightSetRef.entityId} · {d.weightSetRef.versionId}</dd>
                <dt>关联风险矩阵</dt>
                <dd>{d.riskMatrixRef.entityId} · {d.riskMatrixRef.versionId}</dd>
              </div>
              <Ids
                pairs={[
                  ['规则集', o.objectId],
                  ['成员规则', d.applicableRuleSet.memberRuleIds.join(' / ')],
                  ['引用评估记录', d.usedByAssessmentRecordId],
                ]}
              />
            </Section>

            <Section title="规则集版本过程" flush>
              <div style={{ padding: '12px 16px' }}>
                <Timeline
                  items={o.versions.map((v) => ({
                    at: v.recordedAt.slice(0, 10),
                    title: v.versionId,
                    state: lifecycleState[v.lifecycle],
                    meta: (
                      <>
                        <Tag accent={v.lifecycle === 'in-review'}>{KNOWLEDGE_LIFECYCLE_LABELS[v.lifecycle]}</Tag>
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

            <Section title="成员规则" flush>
              <table className="dl-table">
                <thead>
                  <tr>
                    <th>适用指标（甲方原词）</th>
                    <th>评分档</th>
                    <th>例外条款</th>
                    <th>证据来源</th>
                    <th>规则版本</th>
                    <th>复核状态</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rules.map((r) => (
                    <tr key={r.ruleId}>
                      <td className="dl-sm">{r.indicatorItem}</td>
                      <td>
                        <div className="dl-xs dl-num dl-muted">
                          {r.scoringThresholds.map((t) => `${thresholdText(t)} → ${t.score} 分`).join('；')}
                        </div>
                      </td>
                      <td className="dl-xs dl-muted">{r.exceptionClauses.join('；')}</td>
                      <td className="dl-xs dl-muted">{r.evidenceLocator.sourceSegmentId}</td>
                      <td className="dl-sm dl-num">{r.ruleVersion.versionId}</td>
                      <td>
                        <Tag accent={r.reviewStatus === 'pending'}>{REVIEW_STATUS[r.reviewStatus]}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="评分档到等级的对应">
              <table className="dl-table">
                <thead>
                  <tr>
                    <th>等级</th>
                    <th>评分区间</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rules[0].gradeIntervals.map((g) => (
                    <tr key={g.grade}>
                      <td className="dl-sm">{g.grade} 级</td>
                      <td className="dl-sm dl-num dl-muted">{gradeText(g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="dl-xs dl-faint" style={{ marginTop: 8 }}>
                评分档与等级的对应在规则集内统一给出，各成员规则共用同一套区间。
              </div>
            </Section>
          </Fragment>
        );
      })}
    </div>
  );
}
