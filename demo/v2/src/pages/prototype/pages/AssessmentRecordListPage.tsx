// PROTOTYPE · THROWAWAY — 票 05 第 14 页：评估记录列表

import { useMemo, useState } from 'react';
import {
  ASSESSMENT_BASIS_VERSIONS,
  ASSESSMENT_RECORDS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  matrixLevel,
  type AssessmentRecordFixture,
} from '../../../content/assessment';
import { AgentNote, Ids, RiskBadge, Section, Shortcuts, Stats, Tag } from '../parts';

type BasisKey = keyof typeof BASIS_VERSION_LABELS;
const BASIS_KEYS = Object.keys(BASIS_VERSION_LABELS) as BasisKey[];

/** 每条记录实际引用的依据版本（指标体系与阈值取全局固定引用，其余取记录上的版本引用）。 */
function basisVersionOf(rec: AssessmentRecordFixture, key: BasisKey): string {
  switch (key) {
    case 'applicableRuleSet':
      return rec.applicableRuleSetVersion.versionId;
    case 'weightSet':
      return rec.weightVersion.versionId;
    case 'riskMatrix':
      return rec.riskMatrixVersion.versionId;
    default:
      return ASSESSMENT_BASIS_VERSIONS[key].versionId;
  }
}

/** 筛选项：按依据类别列出记录中实际出现过的版本取值。 */
const BASIS_FILTERS: readonly { key: BasisKey; values: readonly string[] }[] = BASIS_KEYS.map((key) => ({
  key,
  values: [...new Set(ASSESSMENT_RECORDS.map((r) => basisVersionOf(r, key)))],
}));

function RiskRow({ rec, groupByRisk }: { rec: AssessmentRecordFixture; groupByRisk: boolean }) {
  const level = matrixLevel(rec.riskLevel);
  return (
    <tr>
      {groupByRisk ? null : <td>{rec.riskRecordId}</td>}
      <td className="dl-mono dl-xs">{rec.assessmentRecordId}</td>
      <td>
        <div className="dl-sm">{rec.audit.recordedAt.slice(0, 16).replace('T', ' ')}</div>
        <div className="dl-xs dl-faint">
          {ENTRY_MODE_LABELS[rec.entryMode]}
          {rec.audit.reason ? ` · ${rec.audit.reason}` : ''}
        </div>
      </td>
      <td className="is-right is-num">{rec.likelihoodScore}</td>
      <td className="is-right is-num">{rec.consequenceScore}</td>
      <td className="dl-num">
        {rec.matrixPlot.p} × {rec.matrixPlot.c}
      </td>
      <td>{level ? <RiskBadge levelId={`level-${level.key.replace(/\D/g, '')}`} label={level.label} /> : rec.riskLevel}</td>
      <td className="dl-mono dl-xs">
        {rec.applicableRuleSetVersion.versionId} / {rec.weightVersion.versionId} / {rec.riskMatrixVersion.versionId}
      </td>
      <td>{rec.previousAssessmentRecordId ? <Tag>前次 {rec.previousAssessmentRecordId}</Tag> : <span className="dl-faint">—</span>}</td>
      <td className="dl-mono dl-xs">
        {rec.warningRecordId ?? '—'}
      </td>
    </tr>
  );
}

export function AssessmentRecordListPage() {
  const [groupByRisk, setGroupByRisk] = useState(true);
  const [basisKey, setBasisKey] = useState<BasisKey | 'none'>('none');
  const [version, setVersion] = useState('');

  const filterOptions = basisKey === 'none' ? [] : (BASIS_FILTERS.find((f) => f.key === basisKey)?.values ?? []);

  const shown = useMemo(
    () => (basisKey === 'none' ? ASSESSMENT_RECORDS : ASSESSMENT_RECORDS.filter((r) => basisVersionOf(r, basisKey) === version)),
    [basisKey, version],
  );

  const groups = useMemo(() => {
    const byId: Record<string, AssessmentRecordFixture[]> = {};
    for (const rec of shown) (byId[rec.riskRecordId] ??= []).push(rec);
    return Object.entries(byId)
      .map(([riskRecordId, recs]) => ({
        riskRecordId,
        recs: [...recs].sort((a, b) => a.audit.recordedAt.localeCompare(b.audit.recordedAt)),
      }))
      .sort((a, b) => a.riskRecordId.localeCompare(b.riskRecordId));
  }, [shown]);

  const reassessed = shown.filter((r) => r.previousAssessmentRecordId);
  const levelCount = new Set(shown.map((r) => r.riskLevel)).size;
  const head: readonly { label: string; right?: boolean }[] = [
    ...(groupByRisk ? [{ label: '风险输入' }] : []),
    { label: '评估记录' },
    { label: '评估时点' },
    { label: 'P 分', right: true },
    { label: 'C 分', right: true },
    { label: '落点' },
    { label: '风险等级' },
    { label: '依据版本（规则 / 权重 / 矩阵）' },
    { label: '前次评估' },
    { label: '触发预警' },
  ];

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">评估 / 评估记录</div>
          <h1 className="dl-h1">评估记录</h1>
          <div className="dl-head-meta">
            <span className="dl-sm dl-muted">
              首次评估与重评估在同一份记录序列内，按风险输入成组查看。
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button" onClick={() => setGroupByRisk((v) => !v)}>
            {groupByRisk ? '按评估记录平铺' : '按风险输入分组'}
          </button>
          <button className="dl-btn" type="button">导出清单</button>
        </div>
      </header>

      <AgentNote
        why="依据：评估记录上的前次评估引用与记录时点；重评估是同一风险输入的新记录，不覆盖旧记录"
      >
        <strong>{groups.length} 个风险输入</strong>共 {shown.length} 次评估，其中 {reassessed.length} 次是重新评估。
        {reassessed.length > 0
          ? ' 重评估作为新记录追加，旧记录保留；是否需要再评估由你决定。'
          : ' 当前筛选下没有重新评估记录。'}
      </AgentNote>

      <Stats
        items={[
          { label: '评估记录', value: shown.length },
          { label: '风险输入', value: groups.length },
          { label: '重新评估', value: reassessed.length },
          { label: '涉及等级', value: levelCount },
          { label: '触发预警', value: shown.filter((r) => r.warningRecordId).length },
        ]}
      />

      <Section
        title="按评估依据版本筛选"
        action={<span className="dl-xs dl-faint">依据版本是评估当时的不可变快照，改版不影响历史记录</span>}
      >
        <div className="dl-sm" style={{ display: 'flex', gap: 'var(--dl-s3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dl-faint">依据类别</span>
          <select
            className="dl-input"
            value={basisKey}
            onChange={(e) => {
              const k = e.target.value as BasisKey | 'none';
              setBasisKey(k);
              setVersion(k === 'none' ? '' : BASIS_FILTERS.find((f) => f.key === k)?.values[0] ?? '');
            }}
          >
            <option value="none">不限</option>
            {BASIS_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {BASIS_VERSION_LABELS[f.key]}
              </option>
            ))}
          </select>
          <span className="dl-faint">取值</span>
          <select className="dl-input" disabled={filterOptions.length === 0} value={version} onChange={(e) => setVersion(e.target.value)}>
            {filterOptions.length === 0 ? <option value="">—</option> : null}
            {filterOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button className="dl-btn" type="button" onClick={() => { setBasisKey('none'); setVersion(''); }}>
            清除筛选
          </button>
        </div>
      </Section>

      {groupByRisk ? (
        groups.map((g) => (
          <Section
            key={g.riskRecordId}
            title={g.riskRecordId}
            action={
              <span className="dl-xs dl-faint">
                {g.recs.length} 次评估 · 最新 {g.recs[g.recs.length - 1]?.assessmentRecordId}
              </span>
            }
            flush
          >
            <table className="dl-table">
              <thead>
                <tr>
                {head.map((h) => (
                  <th key={h.label} className={h.right ? 'is-right' : undefined}>{h.label}</th>
                ))}
              </tr>
              </thead>
              <tbody>
                {g.recs.map((rec) => (
                  <RiskRow key={rec.assessmentRecordId} rec={rec} groupByRisk={groupByRisk} />
                ))}
              </tbody>
            </table>
          </Section>
        ))
      ) : (
        <Section title="全部记录" flush>
          <table className="dl-table">
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h.label} className={h.right ? 'is-right' : undefined}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...shown]
                .sort((a, b) => b.audit.recordedAt.localeCompare(a.audit.recordedAt))
                .map((rec) => (
                  <RiskRow key={rec.assessmentRecordId} rec={rec} groupByRisk={groupByRisk} />
                ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="快捷键">
        <Shortcuts
          groups={[
            {
              title: '列表',
              items: [
                ['J / K', '上下移动记录行'],
                ['G', '在分组视图与平铺视图间切换'],
                ['F', '聚焦依据版本筛选'],
                ['Enter', '打开该评估记录详情'],
                ['⌘K', '搜索风险输入、记录或依据版本'],
              ],
            },
          ]}
        />
      </Section>

      <Ids
        pairs={Object.entries(ASSESSMENT_BASIS_VERSIONS).map(([k, v]) => [
          BASIS_VERSION_LABELS[k as BasisKey],
          `${v.entityId} · ${v.versionId}`,
        ])}
      />
    </div>
  );
}
