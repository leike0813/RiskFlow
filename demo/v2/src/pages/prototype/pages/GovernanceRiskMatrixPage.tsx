// PROTOTYPE · THROWAWAY — 票 05 第 25 页：风险矩阵治理（定义侧）
// 票 02 原则 3：本页是矩阵的「定义与版本治理」（有哪些版本、每个版本的档位与等级、
// 发布状态），不是「本工程风险落在哪里」的落点视图——后者在评估矩阵页。
// 矩阵维度全部从 RISK_MATRIX_CONFIG / detail.matrixConfig 派生，组件内零硬编码；
// 四级只有 levelId / ordinal 时，等级名缺失要能优雅降级。

import {
  ACCEPTANCE_THRESHOLD_REF,
  RISK_MATRIX_OBJECTS,
  RISK_MATRIX_REF,
  type KnowledgeLifecycle,
} from '../../../content/knowledge';
import { Ids, RiskBadge, Section, Stats, Tag, Timeline } from '../parts';

const lifecycleState: Readonly<Record<KnowledgeLifecycle, 'done' | 'current' | 'pending'>> = {
  published: 'done',
  'in-review': 'current',
  draft: 'pending',
  deactivated: 'pending',
};

const LIFECYCLE_TEXT: Readonly<Record<KnowledgeLifecycle, string>> = {
  draft: '草稿',
  'in-review': '审核中',
  published: '已发布',
  deactivated: '已停用',
};

export function GovernanceRiskMatrixPage() {
  const objects = RISK_MATRIX_OBJECTS;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">治理 / 风险矩阵</div>
          <h1 className="dl-h1">风险矩阵治理</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              {RISK_MATRIX_REF.entityId} · {RISK_MATRIX_REF.versionId}
            </span>
            <Tag accent>矩阵定义与版本</Tag>
            <span className="dl-xs dl-faint">本工程风险的落点视图在评估矩阵页</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">复制为新版本</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">提请发布</button>
        </div>
      </header>

      {objects.map((o) => {
        const cfg = o.detail.matrixConfig;
        const pTicks = cfg.probability.ticks;
        const cTicks = cfg.consequence.ticks;
        const levelLabel: Readonly<Record<string, string>> = Object.fromEntries(
          cfg.levels.map((l) => [l.key, l.label]),
        );
        // 等级名缺失时退回等级序号，不留空白、不报错
        const levelName = (key: string, ordinal: number) => levelLabel[key] ?? `第 ${ordinal + 1} 级`;

        return (
          <Section key={o.objectId} title={o.name}>
            <Stats
              items={[
                { label: '可能性档位', value: pTicks.length },
                { label: '后果档位', value: cTicks.length },
                { label: '等级划分', value: cfg.levels.length },
                { label: '已发布版本', value: o.versions.filter((v) => v.lifecycle === 'published').length },
              ]}
            />

            <hr className="dl-rule" />

            <div className="dl-h3 dl-faint" style={{ marginBottom: 8 }}>等级定义</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {cfg.levels.map((l, i) => (
                <RiskBadge key={l.key} levelId={`level-${i + 1}`} label={levelName(l.key, i)} />
              ))}
            </div>
            <div className="dl-xs dl-faint" style={{ marginTop: 8 }}>
              等级名与配色随矩阵配置给出；配置只给出等级序号时，界面退回「第 N 级」表述。
            </div>

            <hr className="dl-rule" />

            <div className="dl-h3 dl-faint" style={{ marginBottom: 8 }}>
              档位与等级映射（{cfg.probability.label} × {cfg.consequence.label}）
            </div>
            <table className="dl-table">
              <thead>
                <tr>
                  <th>{cfg.probability.label}</th>
                  {cTicks.map((t) => (
                    <th key={t} className="is-num">C = {t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pTicks.map((p, pi) => (
                  <tr key={p}>
                    <td className="dl-sm dl-num">P = {p}</td>
                    {cTicks.map((c, ci) => {
                      const key = cfg.cellLevels[pi]?.[ci] ?? '';
                      const ordinal = cfg.levels.findIndex((l) => l.key === key);
                      const acc = cfg.acceptable?.[pi]?.[ci];
                      return (
                        <td key={c} className="dl-xs">
                          <div>{key === '' ? '未定义' : levelName(key, ordinal)}</div>
                          <div className="dl-faint">{acc === undefined ? '' : acc ? '可接受' : '不可接受'}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dl-xs dl-faint" style={{ marginTop: 8 }}>
              可接受区边界取自验收阈值 {ACCEPTANCE_THRESHOLD_REF.entityId} · {cfg.thresholdVersion ?? ACCEPTANCE_THRESHOLD_REF.versionId}。
            </div>

            <hr className="dl-rule" />

            <div className="dl-h3 dl-faint" style={{ marginBottom: 8 }}>版本治理过程</div>
            <Timeline
              items={o.versions.map((v) => ({
                at: v.recordedAt.slice(0, 10),
                title: v.versionId,
                state: lifecycleState[v.lifecycle],
                meta: (
                  <>
                    <Tag accent={v.lifecycle === 'in-review'}>{LIFECYCLE_TEXT[v.lifecycle]}</Tag>
                    <span className="dl-xs dl-faint">{v.actor}</span>
                    {v.lifecycle === 'published' ? <Tag accent>现行</Tag> : null}
                  </>
                ),
                body: (
                  <div>
                    <div className="dl-sm dl-muted">{v.note}</div>
                    {v.rollbackOf ? (
                      <div className="dl-xs dl-faint">内容回滚至 {v.rollbackOf}，以新版本发布</div>
                    ) : null}
                    {v.diffs.map((d) => (
                      <div className="dl-xs" key={d.field} style={{ marginTop: 2 }}>
                        <span className="dl-faint">{d.field}：</span>
                        <span className="dl-delta-old">{d.before}</span> → {d.after}
                      </div>
                    ))}
                  </div>
                ),
              }))}
            />

            <Ids
              pairs={[
                ['矩阵', o.objectId],
                ['现行版本', o.currentVersion.versionId],
                ['验收阈值', `${ACCEPTANCE_THRESHOLD_REF.entityId} · ${ACCEPTANCE_THRESHOLD_REF.versionId}`],
              ]}
            />
          </Section>
        );
      })}
    </div>
  );
}
