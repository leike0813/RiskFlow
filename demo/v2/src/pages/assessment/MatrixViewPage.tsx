// P-RA-06 P/C 风险矩阵视图（B 详情骨架）。
// 骨架：B 详情（标题区 + 字段分组卡 + 底部业务事件时间线）。
// 数据 branch：risk-assessment.evaluate；页面级能力位：risk-assessment.read。
// 矩阵定义与落点全部数据驱动：RiskMatrixVersionChart + 版本化 config（fixture），
// 落点来自评估记录 fixture；空阵也照常渲染。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「暂无评估记录」。

import type { RouteRenderInput } from '../../app/routes';
import { RiskMatrixVersionChart, type RiskMatrixPlot } from '../../charts';
import { PageFrame } from '../../shared/PageFrame';
import {
  ASSESSMENT_BASIS_VERSIONS,
  ASSESSMENT_RECORDS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  LINKS,
  RISK_MATRIX_CONFIG,
  matrixLevelAt,
} from '../../content/assessment';
import { FieldCard, RiskLevelBadge, VersionRefText } from './widgets';

const PLOTS: readonly RiskMatrixPlot[] = ASSESSMENT_RECORDS.map((record) => ({
  id: record.assessmentRecordId,
  p: record.matrixPlot.p,
  c: record.matrixPlot.c,
}));

export function MatrixViewPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="P/C 风险矩阵视图"
      state={input.pageState}
      skeleton="B"
      emptyMessage="暂无评估记录"
      content={
        <div className="ra-page">
          <p className="ra-context-subtitle">
            矩阵刻度、等级映射与可接受边界来自风险矩阵版本配置；落点为评估记录的 P/C 评分映射。
          </p>

          <FieldCard title="风险矩阵">
            <RiskMatrixVersionChart
              config={RISK_MATRIX_CONFIG}
              plots={PLOTS}
              title="P/C 风险矩阵"
              emptyMessage="暂无评估记录"
            />
          </FieldCard>

          <FieldCard title="落点清单">
            <div className="ra-table-wrap">
              <table className="ra-table">
                <thead>
                  <tr>
                    <th>评估记录</th>
                    <th>落点</th>
                    <th>风险等级（矩阵映射）</th>
                    <th>入口类别</th>
                    <th>记录时间</th>
                  </tr>
                </thead>
                <tbody>
                  {ASSESSMENT_RECORDS.map((record) => (
                    <tr key={record.assessmentRecordId}>
                      <td>
                        <a className="mono" href={LINKS.assessmentRecord(record.assessmentRecordId)}>
                          {record.assessmentRecordId}
                        </a>
                      </td>
                      <td className="mono">
                        {record.matrixPlot.p} × {record.matrixPlot.c}
                      </td>
                      <td>
                        <RiskLevelBadge
                          levelKey={
                            matrixLevelAt(record.matrixPlot.p, record.matrixPlot.c)?.key ?? record.riskLevel
                          }
                        />
                      </td>
                      <td>{ENTRY_MODE_LABELS[record.entryMode]}</td>
                      <td className="mono">{record.audit.recordedAt.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FieldCard>

          <FieldCard title="版本引用">
            <div className="ra-version-list">
              <VersionRefText
                label={BASIS_VERSION_LABELS.riskMatrix}
                reference={ASSESSMENT_BASIS_VERSIONS.riskMatrix}
              />
              <VersionRefText
                label={BASIS_VERSION_LABELS.riskAcceptanceThreshold}
                reference={ASSESSMENT_BASIS_VERSIONS.riskAcceptanceThreshold}
              />
            </div>
            <p className="ra-form-note">
              可接受区为矩阵版本中 III / IV 级格；I / II 级落点超出风险可接受阈值，进入处置流程。
            </p>
          </FieldCard>
        </div>
      }
    />
  );
}
