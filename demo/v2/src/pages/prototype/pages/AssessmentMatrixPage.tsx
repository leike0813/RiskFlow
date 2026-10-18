// PROTOTYPE · THROWAWAY — 票 05 第 16 页：等级落点视图

import {
  ASSESSMENT_RECORDS,
  ENTRY_MODE_LABELS,
  RISK_MATRIX_CONFIG,
  matrixLevel,
} from '../../../content/assessment';
import { AgentNote, Ids, RiskBadge, Section, Shortcuts, Stats, Tag } from '../parts';

const P_TICKS: readonly string[] = RISK_MATRIX_CONFIG.probability.ticks;
const C_TICKS: readonly string[] = RISK_MATRIX_CONFIG.consequence.ticks;

/** 矩阵格：维度全部来自 RISK_MATRIX_CONFIG，不假设任何格数。 */
function cellLevel(pIndex: number, cIndex: number): string | undefined {
  const row = RISK_MATRIX_CONFIG.cellLevels[pIndex];
  return row?.[cIndex];
}

function cellAcceptable(pIndex: number, cIndex: number): boolean | undefined {
  const row = RISK_MATRIX_CONFIG.acceptable[pIndex];
  return row?.[cIndex];
}

/** 落在某格的风险输入（按风险输入去重后计数）。 */
function risksAt(pIndex: number, cIndex: number): readonly string[] {
  return ASSESSMENT_RECORDS.filter(
    (r) => P_TICKS.indexOf(r.matrixPlot.p) === pIndex && C_TICKS.indexOf(r.matrixPlot.c) === cIndex,
  ).map((r) => r.riskRecordId);
}

/**
 * 矩阵网格。mark 为高亮落点集合（key = `p|c`）。
 * 等级色只经 RiskBadge 出现：空格只显示等级序号文字，占用格给出带文字标签的等级徽标。
 */
export function MatrixGrid({ mark = [] }: { mark?: readonly string[] }) {
  const marks = new Set(mark);
  return (
    <table className="dl-table" style={{ width: 'auto' }}>
      <thead>
        <tr>
          <th style={{ minWidth: 96 }}>{RISK_MATRIX_CONFIG.probability.label}</th>
          {C_TICKS.map((c) => (
            <th key={c} style={{ minWidth: 92, textAlign: 'center' }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...P_TICKS].reverse().map((p, revIndex) => {
          const pIndex = P_TICKS.length - 1 - revIndex;
          return (
            <tr key={p}>
              <th style={{ background: 'var(--dl-surface)' }}>{p}</th>
              {C_TICKS.map((c, cIndex) => {
                const levelKey = cellLevel(pIndex, cIndex);
                const level = levelKey ? matrixLevel(levelKey) : undefined;
                const hits = risksAt(pIndex, cIndex);
                const on = marks.has(`${p}|${c}`);
                return (
                  <td
                    key={c}
                    aria-selected={on}
                    style={{
                      textAlign: 'center',
                      background: on ? 'var(--dl-accent-soft)' : undefined,
                      outline: on ? '1px solid var(--dl-accent)' : undefined,
                    }}
                  >
                    {hits.length > 0 && level ? (
                      <div style={{ display: 'grid', gap: 2, justifyItems: 'center' }}>
                        <RiskBadge levelId={`level-${level.key.replace(/\D/g, '')}`} label={level.label} />
                        <span className="dl-xs dl-faint dl-num">{hits.length} 条记录 · {hits[0]}</span>
                      </div>
                    ) : (
                      <span className="dl-muted dl-num">{levelKey ?? '—'}</span>
                    )}
                    <div className="dl-xs dl-faint" style={{ marginTop: 2 }}>
                      {cellAcceptable(pIndex, cIndex) ? '可接受' : '需处置'}
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function AssessmentMatrixPage() {
  const levelCount = RISK_MATRIX_CONFIG.levels.length;
  const riskIds = new Set(ASSESSMENT_RECORDS.map((r) => r.riskRecordId));
  const overThreshold = ASSESSMENT_RECORDS.filter((r) => {
    const p = P_TICKS.indexOf(r.matrixPlot.p);
    const c = C_TICKS.indexOf(r.matrixPlot.c);
    return p >= 0 && c >= 0 && cellAcceptable(p, c) === false;
  });
  const levelsUsed = new Set(ASSESSMENT_RECORDS.map((r) => r.riskLevel));
  const highest = ASSESSMENT_RECORDS.reduce((acc, r) => {
    const rank = (key: string) => RISK_MATRIX_CONFIG.levels.findIndex((l) => l.key === key);
    return rank(r.riskLevel) >= 0 && (acc === '' || rank(r.riskLevel) < rank(acc)) ? r.riskLevel : acc;
  }, '');

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">评估 / 等级落点</div>
          <h1 className="dl-h1">本工程的风险落在矩阵哪里</h1>
          <div className="dl-head-meta">
            <Tag>
              {RISK_MATRIX_CONFIG.probability.label.split(' ')[0]} {P_TICKS.length} 档 × {RISK_MATRIX_CONFIG.consequence.label.split(' ')[0]}{' '}
              {C_TICKS.length} 档 × {levelCount} 级
            </Tag>
            <span className="dl-sm dl-muted">按风险输入汇总落点；矩阵的定义与版本治理在治理域。</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">按等级排序</button>
        </div>
      </header>

      <AgentNote
        why="依据：本页全部落点取自既有评估记录，未新增判断；是否处置由处置建议环节由人决定"
      >
        {riskIds.size} 个风险输入、共 {ASSESSMENT_RECORDS.length} 次评估落在矩阵 {P_TICKS.length}×{C_TICKS.length} 中，
        <strong>{overThreshold.length} 条记录落在需处置区</strong>。其中{' '}
        {ASSESSMENT_RECORDS.filter((r) => r.previousAssessmentRecordId).length} 次是同 一风险输入的重新评估，Agent 未按重评估次数重复计数。
      </AgentNote>

      <Stats
        items={[
          { label: '风险输入', value: riskIds.size },
          { label: '评估记录', value: ASSESSMENT_RECORDS.length },
          { label: '落在需处置区', value: overThreshold.length },
          { label: '已覆盖等级', value: `${levelsUsed.size} / ${levelCount}` },
          { label: '最高等级', value: highest ? (matrixLevel(highest)?.label ?? highest) : '—' },
        ]}
      />

      <Section
        title="落点分布"
        action={<span className="dl-xs dl-faint">行 = 发生可能性 P（底行为最低档），列 = 后果严重度 C；占用格标注最新一条记录的风险输入</span>}
        flush
      >
        <div style={{ padding: 'var(--dl-s4)', overflowX: 'auto' }}>
          <MatrixGrid mark={ASSESSMENT_RECORDS.map((r) => `${r.matrixPlot.p}|${r.matrixPlot.c}`)} />
        </div>
      </Section>

      <Section title="逐条落点">
        <table className="dl-table">
          <thead>
            <tr>
              <th>风险输入</th>
              <th>评估记录</th>
              <th>入口模式</th>
              <th className="is-right">P 分</th>
              <th className="is-right">C 分</th>
              <th>落点</th>
              <th>等级</th>
              <th>可接受</th>
            </tr>
          </thead>
          <tbody>
            {ASSESSMENT_RECORDS.map((r) => {
              const p = P_TICKS.indexOf(r.matrixPlot.p);
              const c = C_TICKS.indexOf(r.matrixPlot.c);
              const ok = p >= 0 && c >= 0 ? cellAcceptable(p, c) : undefined;
              const level = matrixLevel(r.riskLevel);
              return (
                <tr key={r.assessmentRecordId}>
                  <td>{r.riskRecordId}</td>
                  <td className="dl-mono dl-xs">{r.assessmentRecordId}</td>
                  <td>{ENTRY_MODE_LABELS[r.entryMode]}</td>
                  <td className="is-right is-num">{r.likelihoodScore}</td>
                  <td className="is-right is-num">{r.consequenceScore}</td>
                  <td className="dl-num">
                    {r.matrixPlot.p} × {r.matrixPlot.c}
                  </td>
                  <td>{level ? <RiskBadge levelId={`level-${level.key.replace(/\D/g, '')}`} label={level.label} /> : r.riskLevel}</td>
                  <td>{ok === undefined ? '—' : ok ? '可接受区' : '需处置区'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="快捷键">
        <Shortcuts
          groups={[
            {
              title: '矩阵',
              items: [
                ['方向键', '在矩阵格间移动'],
                ['Enter', '查看该格内全部评估记录'],
                ['R', '切换「按风险输入去重 / 按评估记录」计数'],
                ['⌘K', '搜索风险输入或评估记录'],
              ],
            },
          ]}
        />
      </Section>

      <Ids
        pairs={[
          ['矩阵', `${RISK_MATRIX_CONFIG.entityId} · ${RISK_MATRIX_CONFIG.versionId}`],
          ['可接受阈值版本', RISK_MATRIX_CONFIG.thresholdVersion],
        ]}
      />
    </div>
  );
}
