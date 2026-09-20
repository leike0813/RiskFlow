// 风险态势总览 fixture（P-OV-01，C34/C35 待定）。
// 总览是 projection.query（risk-overview）的只读投影呈现：
// - 风险态势查询请求形状：packages/contracts/src/ports/index.ts:1787-1792
//   （queryType 'risk-overview'，projectRevisionRef + 可选 spatialScopeRef）；
// - 查询成功结果：同文件 :2294-2297（仅 queryResultRef，投影形状未入契约，
//   见 docs/gap-inbox/overview.md）。
// 聚合口径全部从既有域 fixture 派生，不复制事实：
// - 风险记录与评估记录：content/identification.ts RISK_RECORDS、
//   content/assessment.ts ASSESSMENT_RECORDS（含重评估版本链）；
// - 预警与处置任务：content/warning.ts WARNING_RECORDS / WARNING_RESPONSE_TASKS；
// - 待复核：content/review.ts pendingReviewTasks；
// - 沉降趋势：content/project.ts MONITORING_SERIES（MON-001 地表沉降快照与阈值）。

import {
  ASSESSMENT_BASIS_VERSIONS,
  ASSESSMENT_RECORDS,
  BASIS_VERSION_LABELS,
  PENDING_RISKS,
  RISK_MATRIX_CONFIG,
  type AssessmentRecordFixture,
} from './assessment';
import { RISK_RECORDS, riskRecordKey } from './identification';
import { MONITORING_SERIES } from './project';
import { pendingReviewTasks } from './review';
import { WARNING_RECORDS, WARNING_RESPONSE_TASKS } from './warning';

/** 数据时点：与最新 fixture 事实（2026-09-18 评估与识别活动）对齐。 */
export const OVERVIEW_DATA_AS_OF = '2026-09-18 14:30';

// ---------------------------------------------------------------------------
// KPI 横条（PageForm kpi-grid）：计数全部派生，深链指向对应域页面
// ---------------------------------------------------------------------------

export interface OverviewKpi {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly hint: string;
  readonly path: string;
  /** 风险色角标（仅预警类 KPI 使用风险色通道）。 */
  readonly tone: 'neutral' | 'blue' | 'review' | 'risk';
}

const inAssessmentCount = PENDING_RISKS.filter((risk) => risk.status !== 'assessed').length;
const activeWarningCount = WARNING_RECORDS.length;
const executingTaskCount = WARNING_RESPONSE_TASKS.filter((task) => task.status === 'executing').length;
const pendingReviewCount = pendingReviewTasks().length;

export const OVERVIEW_KPIS: readonly OverviewKpi[] = [
  {
    key: 'in-assessment',
    label: '在评风险',
    value: inAssessmentCount,
    unit: '条',
    hint: '待评估与评估中的风险记录',
    path: '/assessment',
    tone: 'blue',
  },
  {
    key: 'active-warnings',
    label: '预警中',
    value: activeWarningCount,
    unit: '条',
    hint: '当前生效的预警记录',
    path: '/warnings',
    tone: 'risk',
  },
  {
    key: 'executing-tasks',
    label: '处置执行中',
    value: executingTaskCount,
    unit: '项',
    hint: '已确认且正在执行的处置任务',
    path: '/warnings/tasks',
    tone: 'blue',
  },
  {
    key: 'pending-reviews',
    label: '待复核',
    value: pendingReviewCount,
    unit: '项',
    hint: '等待人工决定的复核任务',
    path: '/review-audit',
    tone: 'review',
  },
];

// ---------------------------------------------------------------------------
// 最新评估口径：按风险记录取评估版本链上最新一条（重评估覆盖首次评估）
// ---------------------------------------------------------------------------

export const LATEST_ASSESSMENTS: readonly AssessmentRecordFixture[] = RISK_RECORDS.map((record) => {
  const key = riskRecordKey(record);
  const candidates = ASSESSMENT_RECORDS.filter((item) => item.riskRecordId === key);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, item) =>
    item.audit.recordedAt > latest.audit.recordedAt ? item : latest,
  );
}).filter((item): item is AssessmentRecordFixture => item !== undefined);

/** 风险等级 key → 图表风险色通道序号（按矩阵版本 levels 次序推导，不预存映射文案）。 */
export function riskLevelIndex(levelKey: string): 1 | 2 | 3 | 4 {
  const index = RISK_MATRIX_CONFIG.levels.findIndex((level) => level.key === levelKey);
  return (index < 0 ? 4 : index + 1) as 1 | 2 | 3 | 4;
}

/** 矩阵落点总览：最新评估口径；同格落点由图表按 id 合并计数。 */
export const OVERVIEW_MATRIX_PLOTS = LATEST_ASSESSMENTS.map((record) => ({
  id: record.assessmentRecordId,
  p: record.matrixPlot.p,
  c: record.matrixPlot.c,
}));

// ---------------------------------------------------------------------------
// 等级分布（最新评估口径 + 待评估计数；等级标签取自矩阵版本，未评估为中性项）
// ---------------------------------------------------------------------------

export interface LevelSliceFixture {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly riskLevel?: 1 | 2 | 3 | 4;
}

const assessedSlices: LevelSliceFixture[] = RISK_MATRIX_CONFIG.levels.map((level, index) => ({
  key: level.key,
  label: level.label,
  value: LATEST_ASSESSMENTS.filter((record) => record.riskLevel === level.key).length,
  riskLevel: (index + 1) as 1 | 2 | 3 | 4,
}));

const unassessedCount = RISK_RECORDS.length - LATEST_ASSESSMENTS.length;

export const LEVEL_DISTRIBUTION: readonly LevelSliceFixture[] = [
  ...assessedSlices,
  { key: 'pending', label: '待评估', value: unassessedCount },
].filter((slice) => slice.value > 0);

export const LEVEL_DISTRIBUTION_TOTAL = RISK_RECORDS.length;

// ---------------------------------------------------------------------------
// 沉降趋势（MON-001 地表沉降快照点 + 监测预警阈值；越限点走风险色通道）
// ---------------------------------------------------------------------------

const settlementSeries = MONITORING_SERIES.find((series) => series.seriesId === 'MON-001');

export interface OverviewTrendFixture {
  readonly seriesLabel: string;
  readonly unit: string;
  readonly threshold: {
    readonly value: number;
    readonly label: string;
    readonly riskLevel: 1 | 2 | 3 | 4;
    readonly thresholdRef: { readonly entityId: string; readonly versionId: string };
  };
  readonly points: readonly {
    readonly x: string;
    readonly y: number;
    readonly exceeded: boolean;
    readonly riskLevel?: 1 | 2 | 3 | 4;
  }[];
  readonly monitoringHref: string;
}

export const SETTLEMENT_TREND: OverviewTrendFixture | null =
  settlementSeries === undefined
    ? null
    : {
        seriesLabel: settlementSeries.monitoringIndicator,
        unit: settlementSeries.canonicalUnit,
        threshold: settlementSeries.threshold,
        points: settlementSeries.snapshot.points
          .filter((point) => point.value !== null)
          .map((point) => {
            const exceeded =
              settlementSeries.threshold.direction === 'above'
                ? (point.value ?? 0) > settlementSeries.threshold.value
                : (point.value ?? 0) < settlementSeries.threshold.value;
            return {
              x: point.sampledAt.slice(5, 10),
              y: point.value ?? 0,
              exceeded,
              ...(exceeded ? { riskLevel: settlementSeries.threshold.riskLevel } : {}),
            };
          }),
        monitoringHref: `#/projects/monitoring/${settlementSeries.seriesId}`,
      };

// ---------------------------------------------------------------------------
// 版本引用呈现（总览使用当前评估依据版本；不可变快照语义）
// ---------------------------------------------------------------------------

export const OVERVIEW_BASIS_REFS = [
  { label: BASIS_VERSION_LABELS.applicableRuleSet, reference: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet },
  { label: BASIS_VERSION_LABELS.weightSet, reference: ASSESSMENT_BASIS_VERSIONS.weightSet },
  { label: BASIS_VERSION_LABELS.riskMatrix, reference: ASSESSMENT_BASIS_VERSIONS.riskMatrix },
  { label: BASIS_VERSION_LABELS.riskAcceptanceThreshold, reference: ASSESSMENT_BASIS_VERSIONS.riskAcceptanceThreshold },
  { label: BASIS_VERSION_LABELS.monitoringWarningThreshold, reference: ASSESSMENT_BASIS_VERSIONS.monitoringWarningThreshold },
] as const;
