// P-PJ-07 资料详情：B 详情骨架。
// 数据：engineering-data.source-segments；页面级能力位 engineering-data.read（框架层门控）。
// 体现资料段标识（资料ID-章节ID-段ID）、证据脱敏 full|redacted 两态与沿追溯链的深链。

import type { RouteRenderInput } from '../../app/routes';
import {
  findSourceRecord,
  type SourceRecordFixture,
  type SourceSegmentFixture,
} from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  BusinessTimeline,
  DataTable,
  Field,
  FieldGroup,
  VersionedRefText,
  formatDateTime,
} from './widgets';

const SEGMENT_KIND_LABELS: Readonly<Record<string, string>> = {
  chapter: '章节段',
  table: '表格段',
  'monitoring-window': '监测窗口段',
};

const DELIVERY_KIND_LABELS: Readonly<Record<string, string>> = {
  'file-upload': '文件上传',
  'database-snapshot': '数据库快照',
  'api-snapshot': '接口快照',
};

function locatorText(segment: SourceSegmentFixture): string {
  const locator = segment.locator;
  switch (locator.kind) {
    case 'document':
      return `第 ${locator.pageNumber} 页 · ${locator.headingPath.join(' / ')}`;
    case 'table':
      return `${locator.sheet} · ${locator.table} · 行 ${locator.rowRange.start}–${locator.rowRange.end}`;
    case 'record':
      return `${locator.dataset} · ${locator.stableRecordKey}`;
    case 'time-window':
      return `${formatDateTime(locator.from)} — ${formatDateTime(locator.to)}`;
  }
}

function SegmentSection({ record }: { readonly record: SourceRecordFixture }) {
  const redacted = record.evidenceAccess === 'redacted';
  if (record.segments.length === 0) {
    return (
      <section className="pj-card">
        <h3>资料段</h3>
        <p className="pj-notice">
          该资料版本尚未登记资料段集；段集登记完成后在此列出资料段标识与定位信息。
        </p>
      </section>
    );
  }
  return (
    <section className="pj-card">
      <h3>资料段（资料ID-章节ID-段ID）</h3>
      {redacted ? (
        <p className="pj-notice">
          当前授权决策下该资料版本为脱敏访问：仅呈现资料段定位信息，不呈现正文摘要。
        </p>
      ) : null}
      <DataTable
        caption="资料段列表"
        head={['资料段标识', '段类型', '定位信息', '空间区段', '证据']}
      >
        {record.segments.map((segment) => (
          <tr key={segment.sourceSegmentId}>
            <td className="mono">{segment.sourceSegmentId}</td>
            <td>{SEGMENT_KIND_LABELS[segment.kind]}</td>
            <td>
              {locatorText(segment)}
              {redacted ? null : (
                <>
                  <br />
                  <span className="pj-form-note">{segment.summary}</span>
                </>
              )}
            </td>
            <td className="mono">
              {segment.spatialScopeRefs.map((ref) => ref.reference.entityId).join('、')}
            </td>
            <td>
              <a href="#/review-audit/trace">证据追溯</a>
            </td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

function SourceDetail({ record }: { readonly record: SourceRecordFixture }) {
  return (
    <>
      <FieldGroup title="基本信息">
        <Field label="资料名称">{record.name}</Field>
        <Field label="资料标识">
          <span className="mono">{record.sourceId}</span>
        </Field>
        <Field label="资料条目">
          <span className="mono">{record.sourceItemId}</span>
        </Field>
        <Field label="资料类别">{record.category}</Field>
        <Field label="文件类型">{record.metadata.documentType ?? '未登记'}</Field>
        <Field label="形成单位">{record.metadata.sourceOrganization ?? '未登记'}</Field>
        <Field label="形成时间">
          {record.metadata.formedAt === undefined ? '未登记' : record.metadata.formedAt.slice(0, 10)}
        </Field>
        <Field label="外部版本">{record.metadata.externalVersion ?? '未登记'}</Field>
      </FieldGroup>
      <FieldGroup title="版本与访问">
        <Field label="资料版本">
          <VersionedRefText label="资料版本" reference={record.sourceVersionRef} />
        </Field>
        <Field label="访问状态">
          <Badge tone={record.accessStatus === 'ready' ? 'success' : 'review'}>
            {record.accessStatus === 'ready' ? '可访问' : '待授权'}
          </Badge>
        </Field>
        <Field label="证据脱敏状态">
          <Badge tone={record.evidenceAccess === 'full' ? 'blue' : 'risk-2'}>
            {record.evidenceAccess === 'full' ? 'full · 可读全文' : 'redacted · 仅定位信息'}
          </Badge>
        </Field>
        <Field label="访问授权">
          {record.sourceAccessGrantRef === undefined ? (
            '未授予'
          ) : (
            <VersionedRefText label="资料访问授权" reference={record.sourceAccessGrantRef} />
          )}
        </Field>
        <Field label="适用性元数据快照">
          <VersionedRefText label="适用性快照" reference={record.applicabilityMetadataSnapshotRef} />
        </Field>
        <Field label="工程修订">
          <VersionedRefText label="工程修订" reference={record.projectRevisionRef} />
        </Field>
      </FieldGroup>
      <FieldGroup title="交付信息">
        <Field label="交付记录">
          <VersionedRefText label="资料交付" reference={record.sourceDeliveryRef} />
        </Field>
        <Field label="交付方式">{DELIVERY_KIND_LABELS[record.descriptor.kind]}</Field>
        <Field label="交付发生时间">{formatDateTime(record.occurredAt)}</Field>
        <Field label="入库时间">{formatDateTime(record.recordedAt)}</Field>
        <Field label="登记人">
          <span className="mono">{record.registeredByAccountId}</span>
        </Field>
        <Field label="空间区段">
          <span className="mono">
            {record.spatialScopeRefs.map((ref) => ref.reference.entityId).join('、')}
          </span>
        </Field>
      </FieldGroup>
      <SegmentSection record={record} />
      <section className="pj-card">
        <h3>追溯链引用</h3>
        {record.referencedBy.length === 0 ? (
          <p className="pj-notice">该资料版本尚未进入识别与评估链路。</p>
        ) : (
          <ul className="pj-list">
            {record.referencedBy.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="pj-list-item">
                <span className="pj-list-item-title">
                  <span>{item.kind}</span>
                  <a href={`#${item.path}`} className="mono">
                    {item.id}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <BusinessTimeline
        events={[
          {
            time: record.occurredAt,
            title: `交付发生（${DELIVERY_KIND_LABELS[record.descriptor.kind]}）`,
            actor: record.registeredByAccountId,
          },
          {
            time: record.recordedAt,
            title: `资料版本 ${record.sourceVersionRef.reference.versionId} 登记入库`,
            actor: record.registeredByAccountId,
          },
          ...(record.sourceAccessGrantRef === undefined
            ? [
                {
                  time: record.recordedAt,
                  title: '访问状态：待授权（授予后转为可访问）',
                  actor: record.audit.actorId,
                },
              ]
            : [
                {
                  time: record.audit.recordedAt,
                  title: `访问授权 ${record.sourceAccessGrantRef.reference.entityId} 生效`,
                  actor: record.audit.actorId,
                },
              ]),
        ]}
      />
    </>
  );
}

export function ProjectSourceDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const sourceId = input.params['sourceId'] ?? '';
  const record = findSourceRecord(sourceId);
  return (
    <PageFrame
      title={record === undefined ? '资料详情' : `资料详情 · ${record.name}`}
      state={input.pageState}
      skeleton="B"
      emptyMessage="该资料版本暂无详情数据。"
      content={
        record === undefined ? (
          <p className="pj-notice">
            未找到资料 <span className="mono">{sourceId}</span>，返回{' '}
            <a href="#/projects/sources">资料目录</a>。
          </p>
        ) : (
          <SourceDetail record={record} />
        )
      }
    />
  );
}
