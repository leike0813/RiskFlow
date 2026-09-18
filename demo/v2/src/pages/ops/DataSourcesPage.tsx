// P-OP-02 数据源与适配器连接（骨架 A+B 复合：左适配器列表 A，右连接详情 B；
// branch null / 页面级能力位 null，设施域）。
// 接入通路语义限定「实时多源监测数据 → 指标实际取值」（AGENTS.md §5 定位，
// 页面不呈现实现名）；P/C 计算与矩阵映射不在本页语义内。
// 连接定义引用以 versionedRef 呈现（CONN-MON-01 · v2026.08 等），
// 连接检查 / 停用动作按系统管理员身份三态门控。
// 七态由 PageFrame 经 input.pageState 承载，本组件不读取 URL 参数。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import {
  CONNECTION_STATUS_LABELS,
  DATA_SOURCE_ADAPTERS,
  DELIVERY_KIND_LABELS,
  type ConnectionStatus,
  type DataSourceAdapterView,
} from '../../content/ops';
import { PageFrame } from '../../shared/PageFrame';
import {
  Badge,
  ContextLine,
  Field,
  FieldGroup,
  FilterChips,
  SystemAction,
  VersionRefText,
  formatDateTime,
} from './widgets';

type StatusFilter = 'all' | ConnectionStatus;

const STATUS_FILTERS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'connected', label: '已连接' },
  { key: 'degraded', label: '连接退化' },
  { key: 'disconnected', label: '未连接' },
];

const STATUS_TONES: Readonly<Record<ConnectionStatus, 'success' | 'review' | 'neutral'>> = {
  connected: 'success',
  degraded: 'review',
  disconnected: 'neutral',
};

function ConnectionDetail({
  adapter,
  input,
}: {
  readonly adapter: DataSourceAdapterView;
  readonly input: RouteRenderInput;
}) {
  return (
    <div>
      <section className="op-card">
        <div className="op-card-head">
          <h3>{adapter.name}</h3>
          <Badge tone={STATUS_TONES[adapter.status]}>
            {CONNECTION_STATUS_LABELS[adapter.status]}
          </Badge>
        </div>
        <div className="op-field-grid">
          <Field label="适配器标识">
            <span className="mono">{adapter.adapterId}</span>
          </Field>
          <Field label="接入通路">{adapter.pathway}</Field>
          <Field label="交付通道">{DELIVERY_KIND_LABELS[adapter.deliveryKind]}</Field>
          <Field label="连接定义">
            {adapter.connectionDefinitionRef === null ? (
              <span className="op-muted">尚未建立连接定义</span>
            ) : (
              <VersionRefText kind="连接定义" reference={adapter.connectionDefinitionRef} />
            )}
          </Field>
          <Field label="最近连接检查">
            {adapter.lastCheckedAt === null ? (
              <span className="op-muted">未检查</span>
            ) : (
              <span className="mono">{formatDateTime(adapter.lastCheckedAt)}</span>
            )}
          </Field>
          <Field label="登记审计">
            <span className="mono">{adapter.audit.actorId}</span> ·{' '}
            <span className="mono">{formatDateTime(adapter.audit.recordedAt)}</span>
            {adapter.audit.reason === undefined ? null : (
              <>
                <br />
                <span className="op-muted">{adapter.audit.reason}</span>
              </>
            )}
          </Field>
        </div>
      </section>

      <FieldGroup title="服务对象">
        <Field label="供给范围">{adapter.serves.join('、')}</Field>
      </FieldGroup>

      <section className="op-card">
        <h3>被引用</h3>
        {adapter.referencedBy.length === 0 ? (
          <p className="op-muted">暂无业务对象引用本连接。</p>
        ) : (
          <ul className="op-timeline">
            {adapter.referencedBy.map((ref) => (
              <li key={ref.path + ref.label}>
                <a href={`#${ref.path}`}>{ref.label}</a>
              </li>
            ))}
          </ul>
        )}
        <p className="op-muted">
          监测数据接入产生的资料段与证据定位见 <a href="#/review-audit/trace">证据追溯</a>。
        </p>
      </section>

      <section className="op-card">
        <h3>连接检查记录</h3>
        {adapter.checks.length === 0 ? (
          <p className="op-muted">暂无检查记录。</p>
        ) : (
          <ol className="op-timeline">
            {adapter.checks.map((check) => (
              <li key={check.at}>
                <span className="mono op-timeline-at">{formatDateTime(check.at)}</span>
                <Badge tone={check.result === '通过' ? 'success' : 'review'}>{check.result}</Badge>
                <span>{check.note}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="op-actions" role="group" aria-label="连接运维动作">
          <SystemAction label="检查连接" capabilities={input.capabilities} />
          <SystemAction
            label="停用连接"
            capabilities={input.capabilities}
            danger={adapter.status !== 'disconnected'}
          />
        </div>
      </section>
    </div>
  );
}

export function DataSourcesPage({ input }: { readonly input: RouteRenderInput }) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string>(DATA_SOURCE_ADAPTERS[0].adapterId);

  const visible = DATA_SOURCE_ADAPTERS.filter(
    (adapter) => filter === 'all' || adapter.status === filter,
  );
  const selected =
    visible.find((adapter) => adapter.adapterId === selectedId) ?? visible[0] ?? null;

  return (
    <PageFrame
      title="数据源与适配器连接"
      state={input.pageState}
      skeleton="A+B"
      emptyMessage="暂无适配器连接，可登记第一个数据源适配器"
      content={
        <div>
          <ContextLine
            items={[
              `适配器 ${DATA_SOURCE_ADAPTERS.length} 个`,
              '实时监测通路语义：实时多源监测数据 → 指标实际取值',
              '数据时点 2026-09-18 09:00',
            ]}
          />
          <div className="op-master-detail">
            <aside>
              <FilterChips
                label="按连接状态筛选"
                options={STATUS_FILTERS}
                value={filter}
                onChange={setFilter}
              />
              {visible.length === 0 ? (
                <p className="op-muted">当前筛选下没有适配器。</p>
              ) : (
                <ul className="op-object-list">
                  {visible.map((adapter) => (
                    <li key={adapter.adapterId}>
                      <button
                        type="button"
                        className={`op-object${
                          selected !== null && adapter.adapterId === selected.adapterId
                            ? ' is-active'
                            : ''
                        }`}
                        aria-current={
                          selected !== null && adapter.adapterId === selected.adapterId
                        }
                        onClick={() => setSelectedId(adapter.adapterId)}
                      >
                        <span className="op-object-name">{adapter.name}</span>
                        <span className="op-object-meta">
                          <span className="mono">{adapter.adapterId}</span>
                          <Badge tone={STATUS_TONES[adapter.status]}>
                            {CONNECTION_STATUS_LABELS[adapter.status]}
                          </Badge>
                        </span>
                        <span className="op-muted">{adapter.pathway}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
            <div>
              {selected === null ? (
                <p className="op-muted">当前筛选下没有适配器。</p>
              ) : (
                <ConnectionDetail adapter={selected} input={input} />
              )}
            </div>
          </div>
        </div>
      }
    />
  );
}
