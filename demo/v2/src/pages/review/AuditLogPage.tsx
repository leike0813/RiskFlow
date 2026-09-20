// P-RV-06 版本与操作审计（A 列表骨架）。
// 骨架：A 列表（上下文副标题 + 筛选栏 + 独立主操作区（右上）+ 表格）。
// 数据 branch：review-audit.verify-knowledge-revision-approval；
// 页面级能力位：review-audit.read（框架层门控）。
// 动作级：「导出审计记录」需 projection.export（branch projection.export 映射）。
// 审计日志是合同交付物：规则冲突 / 适用性筛除 / 人工审核 / 版本发布与回滚 /
// 授权校验条目全部呈现，不可省略。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「当前没有审计条目」。

import { useState } from 'react';
import { BRANCH_CAPABILITY } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_ENTRIES,
  AUDIT_SOURCE_TYPE_LABELS,
  LINKS,
  type AuditCategory,
} from '../../content/review';
import { CapabilityGate, StatusBadge } from './widgets';

const EXPORT_CAPABILITY = BRANCH_CAPABILITY['projection.export'];

const CATEGORY_FILTER_OPTIONS: readonly { readonly key: AuditCategory | 'all'; readonly label: string }[] = [
  { key: 'all', label: '全部类别' },
  { key: 'manual-review', label: '人工审核' },
  { key: 'rule-conflict', label: '规则冲突' },
  { key: 'applicability-exclusion', label: '适用性筛除' },
  { key: 'release', label: '版本发布与回滚' },
  { key: 'security', label: '授权校验' },
];

function categoryTone(category: AuditCategory): 'review' | 'neutral' | 'running' | 'decided' | 'superseded' {
  if (category === 'manual-review') return 'review';
  if (category === 'release') return 'decided';
  if (category === 'security') return 'running';
  return 'neutral';
}

export function AuditLogPage({ input }: { readonly input: RouteRenderInput }) {
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory | 'all'>('all');
  const rows =
    categoryFilter === 'all'
      ? AUDIT_ENTRIES
      : AUDIT_ENTRIES.filter((entry) => entry.category === categoryFilter);

  return (
    <PageFrame
      title="版本与操作审计"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前没有审计条目"
      content={
        <div className="rv-page">
          <p className="rv-context-subtitle">
            示例工程 · 站隧一体化标；审计日志是合同交付物，含规则冲突、适用性筛除、人工审核、
            版本发布与回滚、授权校验条目，每条含发生 / 记录 / 入库三时点。
          </p>

          <div className="rv-batch-bar" aria-label="筛选与操作">
            <div className="rv-chips" role="group" aria-label="按审计类别筛选">
              {CATEGORY_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`rv-chip${categoryFilter === option.key ? ' rv-chip-active' : ''}`}
                  aria-pressed={categoryFilter === option.key}
                  onClick={() => setCategoryFilter(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <CapabilityGate capabilities={input.capabilities} capability={EXPORT_CAPABILITY}>
              导出审计记录
            </CapabilityGate>
          </div>

          <div className="rv-table-wrap">
            <table className="rv-table">
              <thead>
                <tr>
                  <th scope="col">发生时间</th>
                  <th scope="col">类别</th>
                  <th scope="col">活动码</th>
                  <th scope="col">摘要</th>
                  <th scope="col">对象</th>
                  <th scope="col">操作者</th>
                  <th scope="col">命令 / 幂等键</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.entryId}>
                    <td>
                      <div className="rv-cell-stack">
                        <span className="mono">{entry.occurredAt.slice(0, 16).replace('T', ' ')}</span>
                        <span className="rv-muted mono" title="记录 / 入库时点">
                          {entry.recordedAt.slice(11, 19)} / {entry.persistedAt.slice(11, 19)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <StatusBadge tone={categoryTone(entry.category)}>
                        {AUDIT_CATEGORY_LABELS[entry.category]}
                      </StatusBadge>
                      <div className="rv-muted">{AUDIT_SOURCE_TYPE_LABELS[entry.sourceType]}</div>
                    </td>
                    <td className="mono">{entry.activityCode}</td>
                    <td>{entry.summary}</td>
                    <td>
                      {entry.targetHref === undefined ? (
                        <span>{entry.targetLabel ?? '—'}</span>
                      ) : (
                        <a href={entry.targetHref}>{entry.targetLabel}</a>
                      )}
                    </td>
                    <td>{entry.actorLabel}</td>
                    <td>
                      <div className="rv-cell-stack mono">
                        <span>{entry.commandId ?? '—'}</span>
                        <span className="rv-muted">{entry.idempotencyKey ?? ''}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className="rv-muted">当前筛选下没有审计条目。</p> : null}

          <p className="rv-muted">
            复核任务级留痕见 <a href={LINKS.reviewQueue}>待复核队列</a> 的历史决定区；
            业务对象级追溯见 <a href={LINKS.evidenceTrace}>证据追溯</a>。
          </p>
        </div>
      }
    />
  );
}
