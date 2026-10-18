// PROTOTYPE · THROWAWAY — 票 05 第 4 页：资料详情。

import {
  INGESTION_TASKS,
  SOURCE_RECORDS,
  type SourceSegmentFixture,
} from '../../../content/project';
import { AgentNote, Ids, KeyValue, Section, StateTag, Tag } from '../parts';

/** 主路径第一份资料（识别与评估的核心工序依据）。 */
const record = SOURCE_RECORDS[0];

const SEGMENT_KIND_LABELS: Readonly<Record<SourceSegmentFixture['kind'], string>> = {
  chapter: '文档段落',
  table: '表格',
  'monitoring-window': '监测时段',
};

function locatorText(segment: SourceSegmentFixture): string {
  switch (segment.locator.kind) {
    case 'document':
      return `第 ${segment.locator.pageNumber} 页 · ${segment.locator.headingPath.join(' / ')}`;
    case 'table':
      return `${segment.locator.sheet} · ${segment.locator.table} · 第 ${segment.locator.rowRange.start}–${segment.locator.rowRange.end} 行`;
    case 'record':
      return `${segment.locator.dataset} · ${segment.locator.stableRecordKey}`;
    case 'time-window':
      return `${segment.locator.from.slice(0, 16).replace('T', ' ')} 至 ${segment.locator.to.slice(0, 16).replace('T', ' ')}`;
  }
}

export function DocumentDetailPage() {
  const ingestion = INGESTION_TASKS.find(
    (task) => task.subjectRef.reference.entityId === record.sourceDeliveryRef.reference.entityId,
  );

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">工程 / 资料 / {record.category}</div>
          <h1 className="dl-h1">{record.name}</h1>
          <div className="dl-head-meta dl-sm dl-faint">
            <Tag accent>{record.metadata.externalVersion ?? '未标版本'}</Tag>
            <StateTag state={record.accessStatus === 'ready' ? 'done' : 'current'}>
              {record.accessStatus === 'ready' ? '已授权' : '待授权'}
            </StateTag>
            <span>{record.evidenceAccess === 'full' ? '全文可读' : '仅定位信息可读'}</span>
            <span>·</span>
            <span>登记于 {record.recordedAt.slice(0, 16).replace('T', ' ')}</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">查看原文</button>
          <button className="dl-btn" type="button">调整授权</button>
        </div>
      </header>

      <AgentNote
        why={`依据本资料的 ${record.segments.length} 个资料段与 ${record.referencedBy.length} 条下游引用；助手只说明它看到了什么，是否采纳由你决定。`}
        actions={<button className="dl-btn dl-btn--sm" type="button">按此段发起识别</button>}
      >
        助手读到本资料的「{record.segments[0]?.summary}」这一段，
        并核对到 {record.referencedBy.length} 处下游引用。是否据此发起新的识别，需要你点。
      </AgentNote>

      <Section title="资料信息">
        <KeyValue
          items={[
            ['资料名称', record.name],
            ['资料类别', record.category],
            ['文件类型', record.metadata.documentType ?? '—'],
            ['编制单位', record.metadata.sourceOrganization ?? '—'],
            ['形成时间', record.metadata.formedAt?.slice(0, 10) ?? '—'],
            ['作业位置', record.metadata.worksiteLocation ?? '—'],
            ['交付时间', record.occurredAt.slice(0, 16).replace('T', ' ')],
            ['可读范围', record.evidenceAccess === 'full' ? '全文可读' : '仅定位信息可读（授权限风险负责人）'],
            ['覆盖区段', `${record.spatialScopeRefs.length} 个区段`],
            ['登记说明', record.audit.reason],
          ]}
        />
      </Section>

      <Section
        title="资料段"
        action={<span className="dl-xs dl-faint">{record.segments.length} 段 · 引用证据都指到具体段</span>}
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 84 }}>类型</th>
              <th style={{ width: '30%' }}>定位</th>
              <th>内容摘要</th>
              <th style={{ width: 96 }}>覆盖区段</th>
            </tr>
          </thead>
          <tbody>
            {record.segments.map((segment) => (
              <tr key={segment.sourceSegmentId}>
                <td><Tag>{SEGMENT_KIND_LABELS[segment.kind]}</Tag></td>
                <td className="dl-sm">{locatorText(segment)}</td>
                <td>{segment.summary}</td>
                <td className="dl-sm dl-faint">{segment.spatialScopeRefs.length} 个</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="解析与入库" action={<span className="dl-xs dl-faint">资料从交付到可引用的过程</span>}>
        {ingestion ? (
          <table className="dl-table">
            <thead>
              <tr>
                <th style={{ width: 88 }}>环节</th>
                <th>说明</th>
                <th style={{ width: 108 }}>开始时间</th>
                <th style={{ width: 72 }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {ingestion.stages.map((stage) => (
                <tr key={stage.code}>
                  <td>{stage.label}</td>
                  <td className="dl-sm dl-faint">
                    {stage.status === 'succeeded'
                      ? '通过'
                      : stage.status === 'running'
                        ? '进行中'
                        : stage.status === 'failed'
                          ? `未通过：${stage.errorCode ?? '未说明原因'}`
                          : '未开始'}
                  </td>
                  <td className="dl-sm dl-faint">{stage.startedAt?.slice(11, 16) ?? '—'}</td>
                  <td>
                    <StateTag
                      state={stage.status === 'succeeded' ? 'done' : stage.status === 'pending' ? 'pending' : 'current'}
                    >
                      {stage.status === 'succeeded' ? '通过' : stage.status === 'running' ? '进行中' : stage.status === 'failed' ? '未通过' : '未开始'}
                    </StateTag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dl-sm dl-faint">本资料尚无接入任务记录。</div>
        )}
        {ingestion?.summary ? (
          <div className="dl-sm" style={{ marginTop: 'var(--dl-s3)' }}>
            入库产出 {ingestion.summary.outputCount} 项，成功率{' '}
            {Math.round(ingestion.summary.successRatio * 100)}%：
            {ingestion.summary.outputRefs.map((ref) => ref.label).join(' · ')}
          </div>
        ) : null}
      </Section>

      <Section title="被引用" flush action={<span className="dl-xs dl-faint">下游对象与资料段的追溯关系</span>}>
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 128 }}>引用方</th>
              <th>对象</th>
            </tr>
          </thead>
          <tbody>
            {record.referencedBy.map((ref) => (
              <tr key={ref.id}>
                <td><Tag>{ref.kind}</Tag></td>
                <td className="dl-mono">{ref.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Ids
        pairs={[
          ['资料', `${record.sourceId} ${record.sourceVersionRef.reference.versionId}`],
          ['交付', `${record.sourceDeliveryRef.reference.entityId} ${record.sourceDeliveryRef.reference.versionId}`],
          ['适用性口径', `${record.applicabilityMetadataSnapshotRef.reference.entityId} ${record.applicabilityMetadataSnapshotRef.reference.versionId}`],
          ...(record.sourceAccessGrantRef
            ? [['授权', `${record.sourceAccessGrantRef.reference.entityId} ${record.sourceAccessGrantRef.reference.versionId}`] as const]
            : []),
          ...record.segments.map((segment) => [locatorText(segment), segment.sourceSegmentId] as const),
        ]}
      />
    </div>
  );
}
