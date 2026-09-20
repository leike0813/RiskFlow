// P-AU-01 报告导出（B 详情骨架）。
// 导出为独立界面：报告范围选择（工程 / 时间窗 / 章节组成）+ 版本引用清单预览 +
// 导出格式与产物清单 + 导出历史；报告由系统生成导出工件，不经浏览器打印（Electron 约束 7）。
// 数据 branch：projection.export；页面级能力位 projection.export（框架层门控），
// 「生成报告」动作按 projection.export 能力三态渲染。
// 导出请求形状对齐 ProjectionExportRequestV1（sourceRef + exportPolicyRef）。
// 七态：非 ready 态由 PageFrame 承载，本组件不读 URL 审阅参数。

import { useState } from 'react';
import { capabilityStateFor } from '../../app/capabilities';
import { BRANCH_CAPABILITY } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import {
  DEFAULT_REPORT_WINDOW,
  EXPORT_FORMATS,
  EXPORT_HISTORY,
  EXPORT_POLICY_REF,
  EXPORT_STATUS_LABELS,
  REPORT_SECTIONS,
  REPORT_SOURCE_REF,
  REPORT_VERSION_REFS,
  type ExportFormatId,
  type ReportSectionId,
} from '../../content/report';
import {
  SHELL_PROCESS_OPTIONS,
  SHELL_PROJECT_OPTIONS,
  SHELL_SPATIAL_OPTIONS,
} from '../../content/shell-context';
import { PageFrame } from '../../shared/PageFrame';
import './report.css';

const SECTION_LABEL = new Map(REPORT_SECTIONS.map((section) => [section.id, section.label]));
const FORMAT_LABEL = new Map(EXPORT_FORMATS.map((format) => [format.id, format.label]));

function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function ExportContent({ capabilities }: { readonly capabilities: ReadonlySet<string> | null }) {
  const [sections, setSections] = useState<ReadonlySet<ReportSectionId>>(
    () => new Set(REPORT_SECTIONS.map((section) => section.id)),
  );
  const [format, setFormat] = useState<ExportFormatId>('pdf');
  const [windowFrom, setWindowFrom] = useState<string>(DEFAULT_REPORT_WINDOW.from);
  const [windowTo, setWindowTo] = useState<string>(DEFAULT_REPORT_WINDOW.to);

  const exportCapability = BRANCH_CAPABILITY['projection.export'];
  const exportState = capabilityStateFor(exportCapability, capabilities);

  const toggleSection = (sectionId: ReportSectionId) => {
    setSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  return (
    <div>
      <p className="au-subtitle">
        {SHELL_PROJECT_OPTIONS[0].label} · {SHELL_SPATIAL_OPTIONS[0].label} ·{' '}
        {SHELL_PROCESS_OPTIONS[1].label}
      </p>

      <section className="au-card" aria-label="报告范围">
        <h3>报告范围</h3>
        <div className="au-form-grid">
          <div className="au-field">
            <label htmlFor="au-window-from">时间窗起</label>
            <input
              id="au-window-from"
              type="date"
              value={windowFrom}
              onChange={(event) => setWindowFrom(event.target.value)}
            />
          </div>
          <div className="au-field">
            <label htmlFor="au-window-to">时间窗止</label>
            <input
              id="au-window-to"
              type="date"
              value={windowTo}
              onChange={(event) => setWindowTo(event.target.value)}
            />
          </div>
        </div>
        <fieldset className="au-fieldset">
          <legend>章节组成</legend>
          <div className="au-section-options">
            {REPORT_SECTIONS.map((section) => (
              <label key={section.id} className="au-section-option">
                <input
                  type="checkbox"
                  checked={sections.has(section.id)}
                  onChange={() => toggleSection(section.id)}
                />
                <span>
                  <span className="au-section-label">{section.label}</span>
                  <span className="au-section-hint">{section.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="au-note">
          数据来源 <span className="mono">{REPORT_SOURCE_REF.reference.entityId} · {REPORT_SOURCE_REF.reference.versionId}</span>
          {' '}· 导出策略 <span className="mono">{EXPORT_POLICY_REF.entityId} · {EXPORT_POLICY_REF.versionId}</span>
        </p>
        <div className="au-actions">
          {exportState === 'allowed' ? (
            <button type="button" className="au-btn au-btn-primary" disabled={sections.size === 0}>
              生成报告
            </button>
          ) : (
            <>
              <button type="button" className="au-btn au-btn-primary" disabled aria-disabled="true" aria-describedby="au-export-gate">
                {exportState === 'unknown' ? '权限检查中' : '生成报告'}
              </button>
              <span id="au-export-gate" className="visually-hidden">
                {exportState === 'unknown' ? '权限检查中' : `需要能力 ${exportCapability}`}
              </span>
            </>
          )}
        </div>
      </section>

      <section className="au-card" aria-label="版本引用清单预览">
        <h3>版本引用清单预览</h3>
        <p className="au-note">报告引用的规则、矩阵、权重与阈值版本为不可变快照，随报告一并固化。</p>
        <table className="au-table">
          <caption className="visually-hidden">版本引用清单</caption>
          <thead>
            <tr>
              <th scope="col">类别</th>
              <th scope="col">版本引用</th>
            </tr>
          </thead>
          <tbody>
            {REPORT_VERSION_REFS.map((item) => (
              <tr key={`${item.label}-${item.reference.entityId}`}>
                <td>{item.label}</td>
                <td className="mono">
                  {item.reference.entityId} · {item.reference.versionId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="au-card" aria-label="导出格式与产物清单">
        <h3>导出格式与产物清单</h3>
        <div className="au-format-options" role="radiogroup" aria-label="导出格式">
          {EXPORT_FORMATS.map((item) => (
            <label key={item.id} className={`au-format-option${format === item.id ? ' au-format-option-active' : ''}`}>
              <input
                type="radio"
                name="export-format"
                checked={format === item.id}
                onChange={() => setFormat(item.id)}
              />
              <span>
                <span className="au-section-label">{item.label}</span>
                <span className="au-section-hint">{item.description}</span>
                <span className="au-section-hint">产物：{item.artifactHint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="au-note">导出工件生成后在导出历史中登记，可下载留存。</p>
      </section>

      <section className="au-card" aria-label="导出历史">
        <h3>导出历史</h3>
        <table className="au-table">
          <caption className="visually-hidden">导出历史</caption>
          <thead>
            <tr>
              <th scope="col">导出标识</th>
              <th scope="col">章节</th>
              <th scope="col">时间窗</th>
              <th scope="col">格式</th>
              <th scope="col">状态</th>
              <th scope="col">导出产物</th>
              <th scope="col">请求时间</th>
              <th scope="col">请求人</th>
            </tr>
          </thead>
          <tbody>
            {EXPORT_HISTORY.map((record) => (
              <tr key={record.exportId}>
                <td className="mono">{record.exportId}</td>
                <td>{record.sections.map((section) => SECTION_LABEL.get(section)).join('、')}</td>
                <td className="mono">{record.windowLabel}</td>
                <td>{FORMAT_LABEL.get(record.format)}</td>
                <td>
                  {EXPORT_STATUS_LABELS[record.status]}
                  {record.status === 'failed' && record.errorCode !== undefined ? (
                    <span className="au-note-inline">
                      <code>{record.errorCode}</code>
                      {record.retryable === true ? '（可重试）' : '（不可重试）'}
                    </span>
                  ) : null}
                </td>
                <td className="mono">
                  {record.exportArtifactRef === null
                    ? '—'
                    : `${record.exportArtifactRef.reference.entityId} · ${record.exportArtifactRef.reference.versionId}`}
                </td>
                <td className="mono">{formatDateTime(record.requestedAt)}</td>
                <td>{record.requestedByLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="au-card" aria-label="业务事件时间线">
        <h3>业务事件时间线</h3>
        <ol className="au-timeline">
          {EXPORT_HISTORY.map((record) => (
            <li key={record.exportId}>
              <span className="mono au-timeline-time">{formatDateTime(record.requestedAt)}</span>
              <span>
                {record.requestedByLabel}发起导出 {record.exportId}（{FORMAT_LABEL.get(record.format)}）
              </span>
              <span className="au-timeline-status">{EXPORT_STATUS_LABELS[record.status]}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function ReportExportPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="报告导出"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前工程暂无可导出的识别与评估内容。"
      content={<ExportContent capabilities={input.capabilities} />}
    />
  );
}
