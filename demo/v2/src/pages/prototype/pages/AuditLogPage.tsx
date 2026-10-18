// PROTOTYPE · THROWAWAY — 票 05 第 26 页：审计日志
// 票 02：审计日志保留为面向合规查询的独立页。
// 票 01：界面不出现分页实现机制词，只说「按时间倒序」。

import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_ENTRIES,
  AUDIT_SOURCE_TYPE_LABELS,
  type AuditCategory,
} from '../../../content/review';
import { Ids, Section, Stats, Tag, Timeline } from '../parts';

const CATEGORIES = Object.keys(AUDIT_CATEGORY_LABELS) as readonly AuditCategory[];

/** 结果码的业务读法；未登记的结果码原样显示。 */
const RESULT_TEXT: Readonly<Record<string, string>> = {
  AUTHORIZATION_DENIED: '授权被拒',
  STALE_VERSION: '版本过时被拒',
};

/** 被拒绝的操作不加强调色。 */
const REJECTED_CODES = new Set(['AUTHORIZATION_DENIED', 'STALE_VERSION']);

export function AuditLogPage() {
  const entries = [...AUDIT_ENTRIES].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const rejected = entries.filter((e) => e.resultCode !== undefined).length;
  const earliest = entries[entries.length - 1];
  const latest = entries[0];

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">治理 / 审计日志</div>
          <h1 className="dl-h1">审计日志</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">按发生时间倒序</span>
            <Tag accent>合规查询</Tag>
          </div>
        </div>
        <div className="dl-head-actions">
          <input className="dl-input" placeholder="按操作人、对象或关键词筛选" aria-label="筛选审计条目" />
          <button className="dl-btn dl-btn--sm" type="button">导出</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '条目总数', value: entries.length },
          { label: '分类数', value: CATEGORIES.length },
          { label: '有拒绝结果的条目', value: rejected },
          { label: '覆盖时段', value: `${earliest.occurredAt.slice(0, 10)} 起` },
        ]}
      />

      <Section title="分类" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>类别</th>
              <th className="is-num">条目数</th>
              <th>最近一条</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => {
              const rows = entries.filter((e) => e.category === c);
              return (
                <tr key={c}>
                  <td className="dl-sm">{AUDIT_CATEGORY_LABELS[c]}</td>
                  <td className="is-num dl-num">{rows.length}</td>
                  <td className="dl-xs dl-faint">{rows[0]?.occurredAt.slice(0, 10) ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="审计条目" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>发生时间</th>
              <th>类别</th>
              <th>来源</th>
              <th>摘要</th>
              <th>操作人</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.entryId}>
                <td className="dl-xs dl-num dl-muted">{e.occurredAt.slice(0, 19).replace('T', ' ')}</td>
                <td className="dl-sm">{AUDIT_CATEGORY_LABELS[e.category]}</td>
                <td className="dl-xs dl-muted">{AUDIT_SOURCE_TYPE_LABELS[e.sourceType]}</td>
                <td>
                  <div className="dl-sm">{e.summary}</div>
                  {e.targetLabel ? <div className="dl-xs dl-faint">对象：{e.targetLabel}</div> : null}
                </td>
                <td className="dl-sm dl-muted">{e.actorLabel}</td>
                <td className="dl-xs">
                  {e.resultCode ? (
                    <Tag accent={!REJECTED_CODES.has(e.resultCode)}>{RESULT_TEXT[e.resultCode] ?? e.resultCode}</Tag>
                  ) : (
                    <span className="dl-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="时间线" flush>
        <div style={{ padding: '12px 16px' }}>
          <Timeline
            items={entries.slice(0, 8).map((e) => ({
              at: e.occurredAt.slice(5, 10),
              title: e.summary,
              state: e.resultCode !== undefined && REJECTED_CODES.has(e.resultCode) ? 'current' : 'done',
              meta: (
                <>
                  <Tag>{AUDIT_CATEGORY_LABELS[e.category]}</Tag>
                  <span className="dl-xs dl-faint">{e.actorLabel}</span>
                </>
              ),
              body: (
                <div>
                  <div className="dl-xs dl-faint">来源：{AUDIT_SOURCE_TYPE_LABELS[e.sourceType]}</div>
                  <Ids
                    pairs={[
                      ['条目', e.entryId],
                      ...(e.relatedReviewTaskId ? ([['关联复核任务', e.relatedReviewTaskId]] as const) : []),
                    ]}
                  />
                </div>
              ),
            }))}
          />
        </div>
      </Section>

      <div className="dl-xs dl-faint">
        审计条目一经写入不可更改，最近一条发生于 {latest.occurredAt.slice(0, 19).replace('T', ' ')}。
      </div>
    </div>
  );
}
