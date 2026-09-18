// P-OP-05 备份与恢复（骨架 B 详情；branch null / 页面级能力位 null，设施域）。
// 备份策略以 versionedRef 呈现；恢复点列表逐项给出「恢复到该恢复点」入口，
// 恢复为危险操作：先经系统管理员身份三态门控，再经页内确认交互
// （勾选确认后果 + 确认/取消）才进入提交语义。底部业务事件时间线。
// 七态由 PageFrame 经 input.pageState 承载，本组件不读取 URL 参数。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import {
  BACKUP_POLICY,
  BACKUP_TIMELINE,
  RESTORE_POINTS,
  RESTORE_POINT_STATUS_LABELS,
  type RestorePointView,
} from '../../content/ops';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  BusinessTimeline,
  ContextLine,
  DataTable,
  Field,
  FieldGroup,
  SystemAction,
  VersionRefText,
  formatDateTime,
  systemActionState,
} from './widgets';

function RestoreConfirm({
  point,
  onCancel,
}: {
  readonly point: RestorePointView;
  readonly onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <div className="op-confirm" role="alertdialog" aria-label={`确认恢复到 ${point.restorePointId}`}>
      <p>
        恢复将把业务数据库、工件存储与运行检查点回退到恢复点{' '}
        <span className="mono">{point.restorePointId}</span>（{formatDateTime(point.createdAt)}
        ）时点，该时点之后的业务变更将不再可见。本操作不可撤销。
      </p>
      <label>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        我已确认恢复范围与后果
      </label>
      <div className="op-confirm-actions">
        <button type="button" className="op-btn op-btn-danger" disabled={!acknowledged}>
          确认恢复
        </button>
        <button type="button" className="op-btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export function BackupPage({ input }: { readonly input: RouteRenderInput }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const restoreState = systemActionState(input.capabilities);

  return (
    <PageFrame
      title="备份与恢复"
      state={input.pageState}
      skeleton="B"
      emptyMessage="暂无恢复点，可先按备份策略创建第一个恢复点"
      content={
        <div>
          <ContextLine
            items={[
              `恢复点 ${RESTORE_POINTS.length} 个`,
              `校验通过 ${RESTORE_POINTS.filter((point) => point.status === 'verified').length} 个`,
              '数据时点 2026-09-18 09:00',
            ]}
          />

          <FieldGroup title="备份策略">
            <Field label="策略版本">
              <VersionRefText kind="备份策略" reference={BACKUP_POLICY.policyRef} />
            </Field>
            <Field label="覆盖范围">{BACKUP_POLICY.scope.join('、')}</Field>
            <Field label="频率">{BACKUP_POLICY.scheduleText}</Field>
            <Field label="保留">{BACKUP_POLICY.retentionText}</Field>
            <Field label="发布审计">
              <span className="mono">{BACKUP_POLICY.audit.actorId}</span> ·{' '}
              <span className="mono">{formatDateTime(BACKUP_POLICY.audit.recordedAt)}</span>
              {BACKUP_POLICY.audit.reason === undefined ? null : (
                <>
                  <br />
                  <span className="op-muted">{BACKUP_POLICY.audit.reason}</span>
                </>
              )}
            </Field>
          </FieldGroup>

          <section className="op-card">
            <div className="op-card-head">
              <h3>恢复点</h3>
              <SystemAction label="立即建立恢复点" capabilities={input.capabilities} />
            </div>
            <DataTable
              caption="恢复点列表"
              head={['恢复点标识', '类型', '建立时间', '覆盖范围', '体量', '校验状态', '操作']}
            >
              {RESTORE_POINTS.map((point) => (
                <tr key={point.restorePointId}>
                  <td className="mono">{point.restorePointId}</td>
                  <td>{point.kind}</td>
                  <td className="mono">{formatDateTime(point.createdAt)}</td>
                  <td>{point.scope.join('、')}</td>
                  <td className="mono">{point.sizeLabel}</td>
                  <td>
                    <Badge tone={point.status === 'verified' ? 'success' : 'review'}>
                      {RESTORE_POINT_STATUS_LABELS[point.status]}
                    </Badge>
                  </td>
                  <td>
                    <SystemAction
                      label="恢复到该恢复点"
                      capabilities={input.capabilities}
                      danger
                      onClick={() =>
                        setConfirmingId(
                          confirmingId === point.restorePointId ? null : point.restorePointId,
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </DataTable>
            {confirmingId === null || restoreState !== 'allowed' ? null : (
              <RestoreConfirm
                point={
                  RESTORE_POINTS.find((point) => point.restorePointId === confirmingId) ??
                  RESTORE_POINTS[0]
                }
                onCancel={() => setConfirmingId(null)}
              />
            )}
            <p className="op-muted">
              恢复操作与其确认记录进入 <a href="#/review-audit/audit-log">版本与操作审计</a>。
            </p>
          </section>

          <BusinessTimeline events={BACKUP_TIMELINE} />
        </div>
      }
    />
  );
}
