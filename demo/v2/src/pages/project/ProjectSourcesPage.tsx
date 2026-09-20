// P-PJ-05 资料目录：A 列表骨架。
// 数据：engineering-data.source-segments；页面级能力位 engineering-data.read（框架层门控）。
// 主操作「登记资料」深链 P-PJ-06 登记表单，动作级按 engineering-data.write 三态门控。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { SOURCE_RECORDS } from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextSubtitle,
  DataTable,
  FilterChips,
  GatedAction,
  formatDateTime,
} from './widgets';

type AccessFilter = 'all' | 'ready' | 'pending-access';

const ACCESS_FILTER_OPTIONS: readonly { readonly key: AccessFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ready', label: '可访问' },
  { key: 'pending-access', label: '待授权' },
];

const DELIVERY_KIND_LABELS: Readonly<Record<string, string>> = {
  'file-upload': '文件上传',
  'database-snapshot': '数据库快照',
  'api-snapshot': '接口快照',
};

function SourcesContent({ input }: { readonly input: RouteRenderInput }) {
  const [filter, setFilter] = useState<AccessFilter>('all');
  const records = SOURCE_RECORDS.filter((record) => filter === 'all' || record.accessStatus === filter);
  return (
    <>
      <ContextSubtitle
        items={[
          '工程 PRJ-001 · 站隧一体化标',
          '数据时点 2026-08-29 08:30',
          `资料版本 ${SOURCE_RECORDS.length} 份 · 待授权 ${SOURCE_RECORDS.filter((record) => record.accessStatus === 'pending-access').length} 份`,
        ]}
      />
      <div className="pj-actions">
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="登记资料"
          href="/projects/sources/register"
          primary
        />
      </div>
      <section className="pj-card">
        <FilterChips label="按访问状态筛选" options={ACCESS_FILTER_OPTIONS} value={filter} onChange={setFilter} />
        {records.length === 0 ? (
          <p className="pj-notice">当前筛选下没有资料版本。</p>
        ) : (
          <DataTable
            caption="资料目录"
            head={['资料标识', '名称', '类别', '资料版本', '交付方式', '访问状态', '脱敏状态', '资料段数', '登记时间']}
          >
            {records.map((record) => (
              <tr key={record.sourceVersionRef.reference.entityId}>
                <td className="mono">
                  <a href={`#/projects/sources/${record.sourceId}`}>{record.sourceId}</a>
                </td>
                <td>{record.name}</td>
                <td>{record.category}</td>
                <td className="mono">{record.sourceVersionRef.reference.versionId}</td>
                <td>{DELIVERY_KIND_LABELS[record.descriptor.kind]}</td>
                <td>
                  <Badge tone={record.accessStatus === 'ready' ? 'success' : 'review'}>
                    {record.accessStatus === 'ready' ? '可访问' : '待授权'}
                  </Badge>
                </td>
                <td>
                  <Badge tone={record.evidenceAccess === 'full' ? 'blue' : 'risk-2'}>
                    {record.evidenceAccess === 'full' ? '可读全文' : '仅定位信息'}
                  </Badge>
                </td>
                <td className="mono">{record.segments.length}</td>
                <td>{formatDateTime(record.recordedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}

export function ProjectSourcesPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="资料目录"
      state={input.pageState}
      skeleton="A"
      emptyMessage="当前工程尚未登记资料，可经「登记资料」录入第一份交付。"
      content={<SourcesContent input={input} />}
    />
  );
}
