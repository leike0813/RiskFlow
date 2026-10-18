// PROTOTYPE · THROWAWAY — 票 05 第 15 页：评估记录详情

import { RISK_RECORDS } from '../../../content/identification';
import { useState } from 'react';
import {
  ASSESSMENT_BASIS_VERSIONS,
  ASSESSMENT_RECORDS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  INDICATOR_ITEMS,
  RISK_MATRIX_CONFIG,
  indicatorMeta,
  matrixLevel,
  matrixLevelAt,
  type AssessmentRecordFixture,
  type IndicatorResultFixture,
} from '../../../content/assessment';
import { AgentNote, Ids, KeyValue, RiskBadge, Section, Shortcuts, Stats, Tag } from '../parts';
import { MatrixGrid } from './AssessmentMatrixPage';

type BasisKey = keyof typeof BASIS_VERSION_LABELS;
const BASIS_KEYS = Object.keys(BASIS_VERSION_LABELS) as BasisKey[];

const P_TICKS: readonly string[] = RISK_MATRIX_CONFIG.probability.ticks;
const C_TICKS: readonly string[] = RISK_MATRIX_CONFIG.consequence.ticks;

function sideOf(item: IndicatorResultFixture): 'P' | 'C' {
  return indicatorMeta(item.indicatorItem)?.side ?? 'P';
}

/** 逐指标明细：指标名、取值、基础分、权重后得分、规则版本、证据。 */
function IndicatorTable({ items }: { items: readonly IndicatorResultFixture[] }) {
  if (items.length === 0) return <div className="dl-sm dl-faint">本侧没有参与计分的指标。</div>;
  return (
    <table className="dl-table">
      <thead>
        <tr>
          <th>指标</th>
          <th>实测取值</th>
          <th className="is-right">基础分</th>
          <th className="is-right">权重后得分</th>
          <th>适用规则集</th>
          <th>取值依据</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const meta = indicatorMeta(it.indicatorItem);
          return (
            <tr key={it.indicatorItem}>
              <td>
                <div className="dl-sm">{meta?.label ?? it.indicatorItem}</div>
                <div className="dl-xs dl-faint dl-mono">{it.indicatorItem}</div>
              </td>
              <td>
                {it.actualValue}
                {meta?.unit ? <span className="dl-faint"> {meta.unit}</span> : null}
              </td>
              <td className="is-right is-num">{it.baseScore}</td>
              <td className="is-right is-num">{it.weightedScore}</td>
              <td className="dl-mono dl-xs">{it.ruleVersion.versionId}</td>
              <td className="dl-mono dl-xs">{it.evidenceReferences.map((e) => e.locator.sourceSegmentId).join('、')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 得分汇总：逐项权重后得分合计 → 记录上的 P / C 分 → 落点刻度 → 等级。 */
function Derivation({ rec }: { rec: AssessmentRecordFixture }) {
  const pItems = rec.indicatorResults.filter((i) => sideOf(i) === 'P');
  const cItems = rec.indicatorResults.filter((i) => sideOf(i) === 'C');
  const pSum = pItems.reduce((s, i) => s + i.weightedScore, 0);
  const cSum = cItems.reduce((s, i) => s + i.weightedScore, 0);
  const level = matrixLevel(rec.riskLevel);
  const at = matrixLevelAt(rec.matrixPlot.p, rec.matrixPlot.c);

  const steps: readonly { label: string; value: string; note?: string }[] = [
    { label: 'P 侧指标权重后得分合计', value: pSum.toFixed(2), note: `${pItems.length} 项指标` },
    { label: '记录的发生可能性得分 P', value: String(rec.likelihoodScore), note: '评估运行按适用规则集与权重版本汇总后写入' },
    { label: 'C 侧指标权重后得分合计', value: cSum.toFixed(2), note: `${cItems.length} 项指标` },
    { label: '记录的后果严重度得分 C', value: String(rec.consequenceScore), note: '同上' },
    { label: '矩阵落点', value: `${rec.matrixPlot.p} × ${rec.matrixPlot.c}`, note: `矩阵 ${RISK_MATRIX_CONFIG.versionId}，P ${rec.likelihoodScore} → ${rec.matrixPlot.p}，C ${rec.consequenceScore} → ${rec.matrixPlot.c}` },
    {
      label: '落点对应等级',
      value: level?.label ?? rec.riskLevel,
      note: at && at.key === rec.riskLevel ? '与记录上的等级一致' : '与记录上的等级不一致，需人工复核',
    },
  ];

  return (
    <table className="dl-table">
      <thead>
        <tr>
          <th>推导步骤</th>
          <th style={{ width: 160 }}>取值</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.label}>
            <td>{s.label}</td>
            <td className="dl-num">
              {s.label === '落点对应等级' && level ? (
                <RiskBadge levelId={`level-${level.key.replace(/\D/g, '')}`} label={level.label} />
              ) : (
                <strong>{s.value}</strong>
              )}
            </td>
            <td className="dl-sm dl-muted">{s.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AssessmentRecordDetailPage() {
  const [recordId, setRecordId] = useState<string>(ASSESSMENT_RECORDS[0]?.assessmentRecordId ?? '');
  const rec = ASSESSMENT_RECORDS.find((r) => r.assessmentRecordId === recordId) ?? ASSESSMENT_RECORDS[0];
  const subject =
    RISK_RECORDS.find((r) => r.identity.kind === 'standardized-risk-record' && r.identity.riskRecordId === rec.riskRecordId)
      ?.record.riskEvent ?? '风险记录';

  if (!rec) {
    return (
      <div className="dl dl-page">
        <Section title="评估记录详情">
          <div className="dl-sm dl-faint">本工程尚无可用于评估的数据。</div>
        </Section>
      </div>
    );
  }

  const level = matrixLevel(rec.riskLevel);
  const pIndex = P_TICKS.indexOf(rec.matrixPlot.p);
  const cIndex = C_TICKS.indexOf(rec.matrixPlot.c);
  const acceptable = pIndex >= 0 && cIndex >= 0 ? RISK_MATRIX_CONFIG.acceptable[pIndex]?.[cIndex] : undefined;
  const snapshot = rec.applicabilityMetadataSnapshot;
  const prev = rec.previousAssessmentRecordId
    ? ASSESSMENT_RECORDS.find((r) => r.assessmentRecordId === rec.previousAssessmentRecordId)
    : undefined;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">
            评估 / 评估记录 / {subject}
          </div>
          <h1 className="dl-h1">
            {subject} · 评估记录
            {level ? <span style={{ marginLeft: 12 }}><RiskBadge levelId={`level-${level.key.replace(/\D/g, '')}`} label={level.label} /></span> : null}
          </h1>
          <div className="dl-head-meta">
            <Tag>{ENTRY_MODE_LABELS[rec.entryMode]}</Tag>
            <span className="dl-sm dl-muted">
              {rec.audit.recordedAt.slice(0, 16).replace('T', ' ')} · P {rec.likelihoodScore} · C {rec.consequenceScore} · 落点{' '}
              {rec.matrixPlot.p} × {rec.matrixPlot.c}
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <select className="dl-input" value={rec.assessmentRecordId} onChange={(e) => setRecordId(e.target.value)}>
            {ASSESSMENT_RECORDS.map((r) => (
              <option key={r.assessmentRecordId} value={r.assessmentRecordId}>
                {r.assessmentRecordId} · {r.riskRecordId}
              </option>
            ))}
          </select>
          <button className="dl-btn" type="button">导出评估说明</button>
        </div>
      </header>

      <AgentNote
        why="依据：本记录的逐指标取值、权重后得分与所引矩阵版本；Agent 只做对照说明，等级复核与是否处置由你决定"
        actions={
          <>
            <button className="dl-btn dl-btn--sm" type="button">标记已复核</button>
            <button className="dl-btn dl-btn--sm dl-btn--quiet" type="button">发起重新评估</button>
          </>
        }
      >
        本次评估落在 {rec.matrixPlot.p} × {rec.matrixPlot.c}，按矩阵 {RISK_MATRIX_CONFIG.versionId} 映射为{level?.label ?? rec.riskLevel}
        ，{acceptable === false ? '超出风险可接受阈值。' : '落在可接受区。'}
        {prev
          ? ` 与前次记录 ${prev.assessmentRecordId} 相比，发生可能性得分由 ${prev.likelihoodScore} 变为 ${rec.likelihoodScore}。`
          : ' 本次是该风险输入的首次评估。'}
      </AgentNote>

      <Stats
        items={[
          { label: '发生可能性 P', value: rec.likelihoodScore },
          { label: '后果严重度 C', value: rec.consequenceScore },
          { label: '参与计分指标', value: rec.indicatorResults.length },
          { label: '触发指标', value: rec.triggerIndicators.length },
          { label: '落点', value: `${rec.matrixPlot.p} × ${rec.matrixPlot.c}` },
        ]}
      />

      <Section title="等级是怎么来的" flush>
        <div className="dl-section-bd dl-section-bd--flush">
          <Derivation rec={rec} />
        </div>
      </Section>

      <Section
        title="落点与矩阵"
        action={
          <span className="dl-xs dl-faint">
            矩阵 {RISK_MATRIX_CONFIG.entityId} · {RISK_MATRIX_CONFIG.versionId}；维度与等级均由配置给出
          </span>
        }
        flush
      >
        <div className="dl-section-bd" style={{ overflowX: 'auto' }}>
          <MatrixGrid mark={[`${rec.matrixPlot.p}|${rec.matrixPlot.c}`]} />
        </div>
        <div className="dl-section-bd dl-sm dl-muted" style={{ paddingTop: 0 }}>
          本记录落在 {rec.matrixPlot.p} × {rec.matrixPlot.c}，
          {acceptable === true ? '属可接受区（III / IV 级格）。' : '属需处置区。'}
          网格横轴为{RISK_MATRIX_CONFIG.consequence.label}（{C_TICKS.join(' → ')}），纵轴为{RISK_MATRIX_CONFIG.probability.label}（自下而上{' '}
          {[...P_TICKS].reverse().join(' → ')}）。
        </div>
      </Section>

      <Section title="发生可能性 P 的逐指标取值" flush>
        <div className="dl-section-bd dl-section-bd--flush">
          <IndicatorTable items={rec.indicatorResults.filter((i) => sideOf(i) === 'P')} />
        </div>
      </Section>

      <Section title="后果严重度 C 的逐指标取值" flush>
        <div className="dl-section-bd dl-section-bd--flush">
          <IndicatorTable items={rec.indicatorResults.filter((i) => sideOf(i) === 'C')} />
        </div>
      </Section>

      <Section title="适用规则与版本">
        <KeyValue
          items={[
            [
              '适用规则集',
              <span className="dl-mono">{rec.applicableRuleSetVersion.entityId} · {rec.applicableRuleSetVersion.versionId}</span>,
            ],
            ['权重版本', <span className="dl-mono">{rec.weightVersion.entityId} · {rec.weightVersion.versionId}</span>],
            ['矩阵版本', <span className="dl-mono">{rec.riskMatrixVersion.entityId} · {rec.riskMatrixVersion.versionId}</span>],
            ...BASIS_KEYS.filter((k) => !(['applicableRuleSet', 'weightSet', 'riskMatrix'] as BasisKey[]).includes(k)).map(
              (k) =>
                [
                  BASIS_VERSION_LABELS[k],
                  <span className="dl-mono">
                    {ASSESSMENT_BASIS_VERSIONS[k].entityId} · {ASSESSMENT_BASIS_VERSIONS[k].versionId}
                  </span>,
                ] as const,
            ),
            [
              '适用性元数据快照',
              `${snapshot.constructionMethod} / ${snapshot.stratumCondition} / ${snapshot.engineeringStage}`,
            ],
            ['指标体系对照', `${INDICATOR_ITEMS.length} 项指标，其中 P 侧 ${INDICATOR_ITEMS.filter((i) => i.side === 'P').length} 项、C 侧 ${INDICATOR_ITEMS.filter((i) => i.side === 'C').length} 项`],
          ]}
        />
      </Section>

      <Section title="触发指标" flush>
        <div className="dl-section-bd dl-section-bd--flush">
          {rec.triggerIndicators.length === 0 ? (
            <div className="dl-section-bd dl-sm dl-faint">本次评估未触发任何指标。</div>
          ) : (
            <table className="dl-table">
              <thead>
                <tr>
                  <th>触发指标</th>
                  <th>触发类型</th>
                  <th>触发取值</th>
                </tr>
              </thead>
              <tbody>
                {rec.triggerIndicators.map((t) => (
                  <tr key={`${t.indicatorItem}-${t.triggerType}`}>
                    <td>{t.indicatorItem}</td>
                    <td>{t.triggerType}</td>
                    <td className="dl-num">{t.actualValue ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      <Section title="证据与记录">
        <KeyValue
          items={[
            [
              '取值与结论证据',
              <span className="dl-mono dl-xs">
                {rec.evidenceReferences
                  .map((e) => `${e.locator.sourceSegmentId}（${e.sourceVersion.entityId} ${e.sourceVersion.versionId}）`)
                  .join('、')}
              </span>,
            ],
            ['记录人', rec.audit.actorId],
            ['记录时间', rec.audit.recordedAt.slice(0, 16).replace('T', ' ')],
            ['记录说明', rec.audit.reason ?? '—'],
            ['前次评估', rec.previousAssessmentRecordId ?? '无（首次评估）'],
            ['触发预警', rec.warningRecordId ?? '未触发'],
          ]}
        />
      </Section>

      <Section title="快捷键">
        <Shortcuts
          groups={[
            {
              title: '记录',
              items: [
                ['[ / ]', '切换上一条 / 下一条评估记录'],
                ['P / C', '跳到 P 侧 / C 侧逐指标表'],
                ['M', '定位到矩阵中的本记录落点'],
                ['V', '查看评估依据版本'],
                ['⌘K', '搜索指标名、证据段或记录'],
              ],
            },
          ]}
        />
      </Section>

      <Ids
        pairs={[
          ['风险输入', rec.riskRecordId],
          ['评估记录', rec.assessmentRecordId],
          ['评估过程', rec.producedByRunId],
          ...(rec.warningRecordId ? ([['触发预警', rec.warningRecordId]] as const) : []),
        ]}
      />
    </div>
  );
}
