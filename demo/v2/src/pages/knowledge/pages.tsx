// 知识与规则域八个页面（P-KM-01～P-KM-08）。
// 全部为 D 治理骨架，共用 GovernanceView；本文件只提供各页的对象详情区与
// 追溯链深链。七态由 PageFrame 经 input.pageState 承载，页面不读取 URL 参数。

import type { ReactNode } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import { RiskMatrixVersionChart } from '../../charts';
import {
  EVIDENCE_TRACE_HREF,
  INDICATOR_SYSTEM_OBJECTS,
  INDICATOR_SYSTEM_REF,
  MEASURE_LIBRARY_REF,
  MEASURE_OBJECTS,
  MECHANISM_LIBRARY_REF,
  MECHANISM_OBJECTS,
  PROCESS_MODEL_OBJECTS,
  PROCESS_MODEL_RELEASE_REF,
  QUANTIZATION_STANDARD_REF,
  CASE_LIBRARY_REF,
  CASE_OBJECTS,
  RULE_SET_OBJECTS,
  APPLICABLE_RULE_SET_REF,
  RISK_MATRIX_OBJECTS,
  RISK_MATRIX_REF,
  STANDARD_LIBRARY_REF,
  STANDARD_OBJECTS,
  WEIGHT_SET_REF,
  type CaseObject,
  type EvidenceReference,
  type IndicatorSystemObject,
  type KnowledgeObject,
  type MeasureObject,
  type MechanismObject,
  type ProcessModelObject,
  type RiskMatrixDetail,
  type RuleSetObject,
  type ScoringRule,
  type StandardObject,
} from '../../content/knowledge';
import type { PageManifestEntry } from '../manifest';
import { GovernanceView, VersionedRefView } from './governance';

interface KnowledgePageProps {
  readonly page: PageManifestEntry;
  readonly input: RouteRenderInput;
}

function EvidenceLinks({ references }: { readonly references: readonly EvidenceReference[] }) {
  return (
    <ul className="km-evidence">
      {references.map((reference) => (
        <li key={reference.locator.sourceSegmentId}>
          <a href={EVIDENCE_TRACE_HREF} className="mono">
            {reference.locator.sourceSegmentId}
          </a>
          <span className="km-muted">
            （资料 {reference.sourceVersion.entityId} · {reference.sourceVersion.versionId}）
          </span>
        </li>
      ))}
    </ul>
  );
}

function FieldCard({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="km-card" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DefinitionList({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="km-fields">
      {items.map(([label, value]) => (
        <div key={label} className="km-field-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// P-KM-01 风险机理库
// ---------------------------------------------------------------------------

function MechanismDetailView({ object }: { readonly object: MechanismObject }) {
  const detail = object.detail;
  return (
    <>
      <FieldCard title="机理条目">
        <DefinitionList
          items={[
            ['机理类型', detail.mechanismType],
            [
              '适用工序',
              <>
                {detail.applicableProcessNodes.map((node, index) => (
                  <span key={node.nodeId}>
                    {index > 0 ? '、' : ''}
                    <a href="#/knowledge/process-models">
                      {node.name}（{node.nodeId}）
                    </a>
                  </span>
                ))}
              </>,
            ],
            ['地层条件', detail.stratumCondition],
            ['触发条件', detail.triggerCondition],
            ['监测前兆', detail.monitoringSigns.join('、')],
            ['风险事件表达', detail.riskEventExpression],
            ['证据要求', detail.evidenceRequirement],
          ]}
        />
      </FieldCard>
      <FieldCard title="追溯链">
        <p className="km-trace">
          资料段 <a href={EVIDENCE_TRACE_HREF} className="mono">DOC2026001-S32-SEG007</a>
          {' → '}工序节点 <a href="#/knowledge/process-models">PN-VDS-04</a>
          {' → '}机理条目 <span className="mono">{object.objectId}</span>
          {detail.linkedRiskRecordId === null ? null : (
            <>
              {' → '}标准化风险记录{' '}
              <a href={`#/identification/records/${detail.linkedRiskRecordId}`} className="mono">
                {detail.linkedRiskRecordId}
              </a>
            </>
          )}
        </p>
      </FieldCard>
      <FieldCard title="证据">
        <EvidenceLinks references={detail.evidenceReferences} />
      </FieldCard>
    </>
  );
}

export function MechanismLibraryPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={MECHANISM_OBJECTS}
      libraryRef={{ kindLabel: '机理库', reference: MECHANISM_LIBRARY_REF }}
      objectKindLabel="机理条目"
      emptyMessage="当前筛选下没有机理条目，可提交第一份机理修订"
      renderDetail={(object) => <MechanismDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-02 项目工序模型治理
// ---------------------------------------------------------------------------

function ProcessModelDetailView({ object }: { readonly object: ProcessModelObject }) {
  const detail = object.detail;
  const covered = detail.requiredNodeNames.filter((name) =>
    detail.nodes.some((node) => node.name === name),
  );
  return (
    <>
      <FieldCard title="必含 5 项最小覆盖集">
        <p className="km-muted">
          已覆盖 {covered.length} / {detail.requiredNodeNames.length}
          项；最小覆盖集可扩展、不可删减。
        </p>
        <ul className="km-coverage">
          {detail.requiredNodeNames.map((name) => {
            const node = detail.nodes.find((entry) => entry.name === name);
            return (
              <li key={name}>
                <span className={node ? 'km-cover-ok' : 'km-cover-miss'} aria-hidden="true" />
                {name}
                {node ? <span className="mono km-muted">（{node.nodeId}）</span> : null}
              </li>
            );
          })}
        </ul>
        <p>
          <a href="#/identification/process-model">查看项目工序模型视图</a>
        </p>
      </FieldCard>
      <FieldCard title="工序节点">
        <table className="km-table">
          <thead>
            <tr>
              <th scope="col">节点</th>
              <th scope="col">输入描述</th>
              <th scope="col">输出描述</th>
              <th scope="col">装备部件 / 构件</th>
              <th scope="col">状态参数</th>
              <th scope="col">监测指标</th>
            </tr>
          </thead>
          <tbody>
            {detail.nodes.map((node) => (
              <tr key={node.nodeId} data-highlight={node.nodeId === 'PN-VDS-04' || undefined}>
                <td>
                  <span className="mono">{node.nodeId}</span>
                  <br />
                  {node.name}
                </td>
                <td>{node.input}</td>
                <td>{node.output}</td>
                <td>
                  {[...node.equipmentComponents, ...node.structuralComponents].join('、') || '—'}
                </td>
                <td>{node.stateParameters.join('、')}</td>
                <td>{node.monitoringIndicators.join('、')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </FieldCard>
      <FieldCard title="工序依赖关系">
        <table className="km-table">
          <thead>
            <tr>
              <th scope="col">前序节点</th>
              <th scope="col">后续节点</th>
              <th scope="col">关系类型</th>
            </tr>
          </thead>
          <tbody>
            {detail.dependencies.map((dependency) => (
              <tr key={`${dependency.sourceNodeId}-${dependency.targetNodeId}-${dependency.relationType}`}>
                <td className="mono">{dependency.sourceNodeId}</td>
                <td className="mono">{dependency.targetNodeId}</td>
                <td>{dependency.relationType}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="km-trace">
          节点机理关联见 <a href="#/knowledge/mechanisms">风险机理库</a>
          {'；'}识别侧视图见 <a href="#/identification/process-model">项目工序模型视图</a>
        </p>
      </FieldCard>
    </>
  );
}

export function ProcessModelsPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={PROCESS_MODEL_OBJECTS}
      libraryRef={{ kindLabel: '工序模型', reference: PROCESS_MODEL_RELEASE_REF }}
      objectKindLabel="工序模型版本"
      emptyMessage="当前筛选下没有工序模型，可提交第一份工序模型修订"
      renderDetail={(object) => <ProcessModelDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-03 规范标准库
// ---------------------------------------------------------------------------

function StandardDetailView({ object }: { readonly object: StandardObject }) {
  const detail = object.detail;
  return (
    <>
      <FieldCard title="标准条目">
        <DefinitionList
          items={[
            ['条目标识', <span className="mono">{object.objectId}</span>],
            ['类别', detail.category],
            ['来源', detail.issuer],
            ['条款摘要', detail.clauseSummary],
            ['关联指标项', detail.relatedIndicatorItems.join('、')],
          ]}
        />
      </FieldCard>
      <FieldCard title="被引用">
        <p className="km-trace">
          <a href="#/knowledge/indicator-systems">指标体系与量化标准</a>
          {' · '}
          <a href="#/knowledge/rule-sets">结构化评分规则与适用规则集</a>
        </p>
      </FieldCard>
      <FieldCard title="证据">
        <EvidenceLinks references={detail.evidenceReferences} />
      </FieldCard>
    </>
  );
}

export function StandardsPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={STANDARD_OBJECTS}
      libraryRef={{ kindLabel: '规范标准库', reference: STANDARD_LIBRARY_REF }}
      objectKindLabel="标准条目"
      emptyMessage="当前筛选下没有标准条目，可提交第一份标准修订"
      renderDetail={(object) => <StandardDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-04 类比工程案例库
// ---------------------------------------------------------------------------

function CaseDetailView({ object }: { readonly object: CaseObject }) {
  const detail = object.detail;
  return (
    <>
      <FieldCard title="案例条目">
        <DefinitionList
          items={[
            ['工程概况', detail.projectProfile],
            ['施工工法', detail.constructionMethod],
            ['地层条件', detail.stratumCondition],
            ['相似维度', detail.similarityDimensions.join('、')],
            ['风险事件经过', detail.riskEventSummary],
            ['处置经过', detail.responseSummary],
          ]}
        />
      </FieldCard>
      <FieldCard title="关联机理条目">
        <ul className="km-evidence">
          {detail.relatedMechanismIds.map((mechanismId) => (
            <li key={mechanismId}>
              <a href="#/knowledge/mechanisms" className="mono">
                {mechanismId}
              </a>
            </li>
          ))}
        </ul>
      </FieldCard>
      <FieldCard title="证据">
        <EvidenceLinks references={detail.evidenceReferences} />
      </FieldCard>
    </>
  );
}

export function CasesPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={CASE_OBJECTS}
      libraryRef={{ kindLabel: '类比工程案例库', reference: CASE_LIBRARY_REF }}
      objectKindLabel="案例条目"
      emptyMessage="当前筛选下没有案例条目，可提交第一份案例修订"
      renderDetail={(object) => <CaseDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-05 指标体系与量化标准
// ---------------------------------------------------------------------------

function IndicatorSystemDetailView({ object }: { readonly object: IndicatorSystemObject }) {
  const detail = object.detail;
  const metadata = detail.applicabilityMetadata;
  const dimensionValues: readonly (readonly [string, string])[] = [
    ['施工工法数据', metadata.constructionMethod],
    ['地层条件数据', metadata.stratumCondition],
    ['工程阶段数据', metadata.engineeringStage],
  ];
  return (
    <>
      <FieldCard title="适用性元数据（必含 3 个维度）">
        <p className="km-muted">
          已覆盖 {detail.requiredDimensions.length} / 3 个维度；最小覆盖集可扩展、不可删减。
        </p>
        <ul className="km-coverage">
          {dimensionValues.map(([dimension, value]) => (
            <li key={dimension}>
              <span className="km-cover-ok" aria-hidden="true" />
              {dimension}
              <span className="km-muted">：{value}</span>
            </li>
          ))}
        </ul>
      </FieldCard>
      <FieldCard title="指标项">
        <table className="km-table">
          <thead>
            <tr>
              <th scope="col">指标项</th>
              <th scope="col">指标组</th>
              <th scope="col">指标类型</th>
              <th scope="col">单位</th>
              <th scope="col">量化标准</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((item) => (
              <tr key={item.itemId}>
                <td>{item.name}</td>
                <td>{item.group}</td>
                <td>{item.indicatorType}</td>
                <td className="mono">{item.unit}</td>
                <td>{item.quantitativeScale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </FieldCard>
      <FieldCard title="版本引用">
        <p className="km-vref-row">
          <VersionedRefView kindLabel="量化标准" reference={QUANTIZATION_STANDARD_REF} />
          <VersionedRefView kindLabel="权重集" reference={WEIGHT_SET_REF} />
        </p>
        <p className="km-trace">
          量化标准来源见 <a href="#/knowledge/standards">规范标准库</a>
          {'；'}评分应用见 <a href="#/knowledge/rule-sets">结构化评分规则与适用规则集</a>
        </p>
      </FieldCard>
    </>
  );
}

export function IndicatorSystemsPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={INDICATOR_SYSTEM_OBJECTS}
      libraryRef={{ kindLabel: '指标体系', reference: INDICATOR_SYSTEM_REF }}
      objectKindLabel="指标体系版本"
      emptyMessage="当前筛选下没有指标体系，可提交第一份指标体系修订"
      renderDetail={(object) => <IndicatorSystemDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-06 结构化评分规则与适用规则集
// ---------------------------------------------------------------------------

const REVIEW_STATUS_LABELS: Readonly<Record<ScoringRule['reviewStatus'], string>> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已退回',
};

const OPERATOR_SYMBOLS: Readonly<Record<ScoringRule['scoringThresholds'][number]['operator'], string>> = {
  lt: '<',
  lte: '≤',
  eq: '=',
  gte: '≥',
  gt: '>',
  between: '–',
};

function thresholdText(threshold: ScoringRule['scoringThresholds'][number]): string {
  if (threshold.operator === 'between') {
    return `${threshold.value}–${threshold.upperValue ?? ''}`;
  }
  return `${OPERATOR_SYMBOLS[threshold.operator]} ${threshold.value}`;
}

function ScoringRuleCard({ rule }: { readonly rule: ScoringRule }) {
  return (
    <section className="km-rule" aria-label={rule.indicatorItem}>
      <div className="km-card-head">
        <h4>
          {rule.indicatorItem}
          <span className="mono km-muted">（{rule.ruleId}）</span>
        </h4>
        <span className="km-chip km-chip-review">{REVIEW_STATUS_LABELS[rule.reviewStatus]}</span>
      </div>
      <p className="km-vref-row">
        <VersionedRefView kindLabel="评分规则" reference={rule.ruleVersion} />
      </p>
      <p className="km-muted">
        适用条件：{rule.applicabilityConditions.constructionMethod.join('、')} ·{' '}
        {rule.applicabilityConditions.stratumCondition.join('、')} ·{' '}
        {rule.applicabilityConditions.engineeringStage.join('、')}
      </p>
      <table className="km-table">
        <thead>
          <tr>
            <th scope="col">阈值标识</th>
            <th scope="col">取值条件</th>
            <th scope="col">评分</th>
          </tr>
        </thead>
        <tbody>
          {rule.scoringThresholds.map((threshold) => (
            <tr key={threshold.thresholdId}>
              <td className="mono">{threshold.thresholdId}</td>
              <td className="mono">{thresholdText(threshold)}</td>
              <td className="mono">{threshold.score} 分</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="km-muted">
        档位区间：
        {rule.gradeIntervals
          .map((interval) => {
            const lower = interval.lowerBound === undefined ? '' : `> ${interval.lowerBound}`;
            const upper = interval.upperBound === undefined ? '' : `≤ ${interval.upperBound}`;
            return `${interval.grade} 分（${[lower, upper].filter(Boolean).join(' 且 ')}）`;
          })
          .join('；')}
      </p>
      <p className="km-muted">例外条款：{rule.exceptionClauses.join('；')}</p>
      <p>
        证据{' '}
        <a href={EVIDENCE_TRACE_HREF} className="mono">
          {rule.evidenceLocator.sourceSegmentId}
        </a>
      </p>
    </section>
  );
}

function RuleSetDetailView({ object }: { readonly object: RuleSetObject }) {
  const detail = object.detail;
  return (
    <>
      <FieldCard title="适用规则集">
        <p className="km-vref-row">
          <VersionedRefView kindLabel="适用规则集" reference={APPLICABLE_RULE_SET_REF} />
          <VersionedRefView kindLabel="权重集" reference={detail.weightSetRef} />
          <VersionedRefView kindLabel="风险矩阵" reference={detail.riskMatrixRef} />
        </p>
        <DefinitionList
          items={[
            ['成员规则', detail.applicableRuleSet.memberRuleIds.join('、')],
            [
              '适用性元数据快照',
              `${detail.applicableRuleSet.metadataSnapshot.constructionMethod} · ${detail.applicableRuleSet.metadataSnapshot.stratumCondition} · ${detail.applicableRuleSet.metadataSnapshot.engineeringStage}`,
            ],
            ['发布时间', detail.applicableRuleSet.publishedAt],
          ]}
        />
        <p className="km-trace">
          引用本规则集的评估记录{' '}
          <a href={`#/assessment/records/${detail.usedByAssessmentRecordId}`} className="mono">
            {detail.usedByAssessmentRecordId}
          </a>
          {'；'}风险矩阵见 <a href="#/knowledge/risk-matrices">风险矩阵</a>
        </p>
      </FieldCard>
      <FieldCard title="结构化评分规则">
        {detail.rules.map((rule) => (
          <ScoringRuleCard key={rule.ruleId} rule={rule} />
        ))}
      </FieldCard>
    </>
  );
}

export function RuleSetsPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={RULE_SET_OBJECTS}
      libraryRef={{ kindLabel: '适用规则集', reference: APPLICABLE_RULE_SET_REF }}
      objectKindLabel="规则集版本"
      emptyMessage="当前筛选下没有规则集，可提交第一份规则集修订"
      renderDetail={(object) => <RuleSetDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-07 风险矩阵
// ---------------------------------------------------------------------------

function RiskMatrixDetailView({ object }: { readonly object: KnowledgeObject<RiskMatrixDetail> }) {
  const detail = object.detail;
  return (
    <>
      <FieldCard title="矩阵定义（版本化配置）">
        <RiskMatrixVersionChart
          config={detail.matrixConfig}
          plots={[...detail.plots]}
          title="变径扩挖段 P/C 风险矩阵"
          emptyMessage="暂无评估记录"
        />
        <p className="km-vref-row">
          <VersionedRefView kindLabel="风险可接受阈值" reference={detail.acceptanceThresholdRef} />
        </p>
      </FieldCard>
      <FieldCard title="追溯链">
        <p className="km-trace">
          评估记录{' '}
          <a href={`#/assessment/records/${detail.plottedAssessmentRecordId}`} className="mono">
            {detail.plottedAssessmentRecordId}
          </a>
          {' 落点见 '}
          <a href="#/assessment/matrix">P/C 风险矩阵视图</a>
          {'；'}评分规则见 <a href="#/knowledge/rule-sets">结构化评分规则与适用规则集</a>
        </p>
      </FieldCard>
    </>
  );
}

export function RiskMatricesPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={RISK_MATRIX_OBJECTS}
      libraryRef={{ kindLabel: '风险矩阵', reference: RISK_MATRIX_REF }}
      objectKindLabel="矩阵版本"
      emptyMessage="当前筛选下没有风险矩阵，可提交第一份矩阵修订"
      renderDetail={(object) => <RiskMatrixDetailView object={object} />}
    />
  );
}

// ---------------------------------------------------------------------------
// P-KM-08 措施库
// ---------------------------------------------------------------------------

function MeasureDetailView({ object }: { readonly object: MeasureObject }) {
  const detail = object.detail;
  return (
    <>
      <FieldCard title="措施条目">
        <DefinitionList
          items={[
            ['处置方向', detail.direction],
            ['适用风险事件', detail.applicableEvents],
            [
              '适用性',
              `${detail.applicability.constructionMethod} · ${detail.applicability.stratumCondition} · ${detail.applicability.engineeringStage}`,
            ],
            ['资源需求', detail.resourceRequirements.join('、')],
            [
              '目标指标',
              detail.targetIndicators
                .map((target) => `${target.indicatorItem}：${target.targetValue}`)
                .join('；'),
            ],
          ]}
        />
      </FieldCard>
      <FieldCard title="追溯链">
        {detail.usedByRecommendationId === null ? (
          <p className="km-muted">本措施尚未被处置建议引用。</p>
        ) : (
          <p className="km-trace">
            预警{' '}
            <a href="#/warnings/WARN-2026-001" className="mono">
              WARN-2026-001
            </a>
            {' → '}处置建议{' '}
            <a href={`#/response/recommendations/${detail.usedByRecommendationId}`} className="mono">
              {detail.usedByRecommendationId}
            </a>
            {' 引用本措施'}
          </p>
        )}
      </FieldCard>
    </>
  );
}

export function MeasuresPage({ page, input }: KnowledgePageProps) {
  return (
    <GovernanceView
      page={page}
      input={input}
      objects={MEASURE_OBJECTS}
      libraryRef={{ kindLabel: '措施库', reference: MEASURE_LIBRARY_REF }}
      objectKindLabel="措施条目"
      emptyMessage="当前筛选下没有措施条目，可提交第一份措施修订"
      renderDetail={(object) => <MeasureDetailView object={object} />}
    />
  );
}
