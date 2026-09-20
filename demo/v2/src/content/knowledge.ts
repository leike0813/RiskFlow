// 知识与规则域（P-KM-01～P-KM-08）fixtures。
// 字段形状以 packages/contracts 为准：VersionReference / EvidenceReference /
// ApplicabilityMetadata / StructuredScoringRule 等均按 src/records、src/common、
// src/vocabulary 的 Schema 对齐；语义参照 v1 demo/src/content/knowledge.ts 并重对齐。
// 跨域标识沿典范追溯链：DOC2026001 → DOC2026001-S32-SEG007 → PN-VDS-04 →
// MEC-VDS-017 → RISK-2026-001 → ASSESS-2026-001 → WARN-2026-001 → RESP-2026-001。
// 规范标准库不编造国家标准编号，统一使用项目内部标识（沿用 v1 约定）。

import type { RiskMatrixVersionConfig } from '../charts';

/** 治理生命周期：草稿 / 审核中 / 已发布 / 已停用；回滚以新版本发布表达。 */
export type KnowledgeLifecycle = 'draft' | 'in-review' | 'published' | 'deactivated';

export const KNOWLEDGE_LIFECYCLE_LABELS: Readonly<Record<KnowledgeLifecycle, string>> = {
  draft: '草稿',
  'in-review': '审核中',
  published: '已发布',
  deactivated: '已停用',
};

/** 对齐 packages/contracts VersionReferenceSchema。 */
export interface VersionReference {
  readonly entityId: string;
  readonly versionId: string;
}

/** 对齐 packages/contracts EvidenceLocatorSchema / EvidenceReferenceSchema。 */
export interface EvidenceLocator {
  readonly sourceSegmentId: string;
}

export interface EvidenceReference {
  readonly locator: EvidenceLocator;
  readonly sourceVersion: VersionReference;
}

/** 对齐 packages/contracts ApplicabilityMetadataSchema（必含 3 个维度）。 */
export interface ApplicabilityMetadata {
  readonly constructionMethod: string;
  readonly stratumCondition: string;
  readonly engineeringStage: string;
}

export interface FieldDiff {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface KnowledgeVersion {
  readonly versionId: string;
  readonly lifecycle: KnowledgeLifecycle;
  readonly recordedAt: string;
  readonly actor: string;
  readonly note: string;
  /** 回滚即新版本：本版本内容回滚至的历史版本号。 */
  readonly rollbackOf?: string;
  /** 与上一版相比的字段 diff。 */
  readonly diffs: readonly FieldDiff[];
}

export interface KnowledgeObject<TDetail> {
  readonly objectId: string;
  readonly name: string;
  /** 当前生效版本（不可变快照引用，页面上以 versionedRef 呈现）。 */
  readonly currentVersion: VersionReference;
  readonly versions: readonly KnowledgeVersion[];
  readonly detail: TDetail;
}

const DOC_SOURCE_VERSION: VersionReference = { entityId: 'DOC2026001', versionId: 'v2026.06' };

function evidence(sourceSegmentId: string): EvidenceReference {
  return { locator: { sourceSegmentId }, sourceVersion: DOC_SOURCE_VERSION };
}

/** 跨页统一的证据追溯入口（P-RV-04）。 */
export const EVIDENCE_TRACE_HREF = '#/review-audit/trace';

// ---------------------------------------------------------------------------
// P-KM-01 风险机理库
// ---------------------------------------------------------------------------

export interface MechanismDetail {
  /** 机理类型，取值自 contracts RISK_MECHANISM_TYPE_VALUES。 */
  readonly mechanismType: string;
  readonly applicableProcessNodes: readonly { readonly nodeId: string; readonly name: string }[];
  readonly stratumCondition: string;
  readonly triggerCondition: string;
  /** 监测前兆，取值自 contracts MONITORING_INDICATOR_VALUES。 */
  readonly monitoringSigns: readonly string[];
  readonly riskEventExpression: string;
  readonly evidenceRequirement: string;
  readonly evidenceReferences: readonly EvidenceReference[];
  /** 沿追溯链关联的标准化风险记录（无则为 null）。 */
  readonly linkedRiskRecordId: string | null;
}

export type MechanismObject = KnowledgeObject<MechanismDetail>;

export const MECHANISM_LIBRARY_REF: VersionReference = {
  entityId: 'MEC-LIB-VDS',
  versionId: 'v2026.08',
};

export const MECHANISM_OBJECTS: readonly MechanismObject[] = [
  {
    objectId: 'MEC-VDS-017',
    name: '过挖与地表沉降',
    currentVersion: { entityId: 'MEC-VDS-017', versionId: 'v1.2' },
    versions: [
      {
        versionId: 'v1.3-draft',
        lifecycle: 'draft',
        recordedAt: '2026-09-12T09:30:00+08:00',
        actor: '项目风险经理',
        note: '补充注浆压力低于生效区间的触发判据描述',
        diffs: [
          {
            field: '触发条件',
            before: '支护闭合滞后且地表沉降短期斜率超限',
            after: '支护闭合滞后、注浆压力低于生效区间且地表沉降短期斜率超限',
          },
          {
            field: '监测前兆',
            before: '地表沉降、支护结构变形',
            after: '地表沉降、支护结构变形、注浆压力',
          },
        ],
      },
      {
        versionId: 'v1.2',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '按甲方复核意见发布',
        diffs: [
          {
            field: '证据要求',
            before: '地质资料与监测摘要各至少一段',
            after: '地质资料、专项施工方案、监测摘要各至少一段',
          },
        ],
      },
      {
        versionId: 'v1.1',
        lifecycle: 'deactivated',
        recordedAt: '2026-07-30T15:00:00+08:00',
        actor: '项目风险经理',
        note: '证据要求不完整，由 v1.2 取代后停用',
        diffs: [],
      },
    ],
    detail: {
      mechanismType: '过挖与地表沉降',
      applicableProcessNodes: [
        { nodeId: 'PN-VDS-04', name: '变径空间扩挖' },
        { nodeId: 'PN-VDS-02', name: '刀盘扩径' },
      ],
      stratumCondition: '富水软弱地层、高灵敏度软土',
      triggerCondition: '支护闭合滞后、注浆压力低于生效区间且地表沉降短期斜率超限',
      monitoringSigns: ['地表沉降', '支护结构变形', '注浆压力'],
      riskEventExpression: '变径空间扩挖引发过挖与地表沉降超限',
      evidenceRequirement: '地质资料、专项施工方案、监测摘要各至少一段',
      evidenceReferences: [
        evidence('DOC2026001-S32-SEG007'),
        evidence('DOC2026001-S61-SEG011'),
      ],
      linkedRiskRecordId: 'RISK-2026-001',
    },
  },
  {
    objectId: 'MEC-VDS-011',
    name: '掌子面稳定性失效',
    currentVersion: { entityId: 'MEC-VDS-011', versionId: 'v1.1' },
    versions: [
      {
        versionId: 'v1.2-review',
        lifecycle: 'in-review',
        recordedAt: '2026-09-15T14:00:00+08:00',
        actor: '项目风险经理',
        note: '提请审核：细化泥水压力波动判据',
        diffs: [
          {
            field: '触发条件',
            before: '土仓/泥水压力波动超出允许幅度',
            after: '土仓/泥水压力波动超出允许幅度，掌子面水土压力失衡',
          },
        ],
      },
      {
        versionId: 'v1.1',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '随机理库 MEC-LIB-VDS · v2026.08 发布',
        diffs: [],
      },
    ],
    detail: {
      mechanismType: '掌子面稳定性失效',
      applicableProcessNodes: [
        { nodeId: 'PN-VDS-04', name: '变径空间扩挖' },
        { nodeId: 'PN-VDS-02', name: '刀盘扩径' },
      ],
      stratumCondition: '软弱地层、砂性土层',
      triggerCondition: '土仓/泥水压力波动超出允许幅度，掌子面水土压力失衡',
      monitoringSigns: ['泥水压力', '盾构姿态参数', '地表沉降'],
      riskEventExpression: '开挖面局部失稳或坍塌',
      evidenceRequirement: '专项施工方案与监测摘要各至少一段',
      evidenceReferences: [evidence('DOC2026001-S61-SEG011')],
      linkedRiskRecordId: null,
    },
  },
  {
    objectId: 'MEC-VDS-012',
    name: '支护结构失效',
    currentVersion: { entityId: 'MEC-VDS-012', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '随机理库 MEC-LIB-VDS · v2026.08 发布',
        diffs: [],
      },
    ],
    detail: {
      mechanismType: '支护结构失效',
      applicableProcessNodes: [
        { nodeId: 'PN-VDS-04', name: '变径空间扩挖' },
        { nodeId: 'PN-VDS-03', name: '盾体扩径' },
        { nodeId: 'PN-VDS-05', name: '缩径转换' },
      ],
      stratumCondition: '富水软弱地层',
      triggerCondition: '支护施作滞后于开挖进尺，支护结构变形持续增长',
      monitoringSigns: ['支护结构变形', '地表沉降'],
      riskEventExpression: '支护结构变形超限或局部破坏',
      evidenceRequirement: '专项施工方案与支护变形监测摘要',
      evidenceReferences: [evidence('DOC2026001-S61-SEG011')],
      linkedRiskRecordId: null,
    },
  },
  {
    objectId: 'MEC-VDS-013',
    name: '渗流突涌',
    currentVersion: { entityId: 'MEC-VDS-013', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '随机理库 MEC-LIB-VDS · v2026.08 发布',
        diffs: [],
      },
    ],
    detail: {
      mechanismType: '渗流突涌',
      applicableProcessNodes: [
        { nodeId: 'PN-VDS-04', name: '变径空间扩挖' },
        { nodeId: 'PN-VDS-01', name: '扩径准备' },
      ],
      stratumCondition: '富水砂层、承压水地层',
      triggerCondition: '隔水层削薄或注浆压力低于区间，渗流通道发育',
      monitoringSigns: ['地下水位', '注浆压力'],
      riskEventExpression: '掌子面或支护间隙渗流突涌',
      evidenceRequirement: '水文地质资料与地下水位监测摘要',
      evidenceReferences: [evidence('DOC2026001-S51-SEG012')],
      linkedRiskRecordId: null,
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-02 项目工序模型治理
// ---------------------------------------------------------------------------

export interface ProcessNodeEntry {
  readonly nodeId: string;
  /** 工序名称，取值自 contracts PROCESS_NODE_VALUES（必含 5 项最小覆盖集）。 */
  readonly name: string;
  readonly input: string;
  readonly output: string;
  /** 取值自 contracts EQUIPMENT_COMPONENT_VALUES。 */
  readonly equipmentComponents: readonly string[];
  /** 取值自 contracts STRUCTURAL_COMPONENT_VALUES。 */
  readonly structuralComponents: readonly string[];
  /** 取值自 contracts STATE_PARAMETER_DESCRIPTION_VALUES。 */
  readonly stateParameters: readonly string[];
  /** 取值自 contracts MONITORING_INDICATOR_VALUES。 */
  readonly monitoringIndicators: readonly string[];
}

export interface ProcessDependency {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  /** 取值自 contracts PROCESS_DEPENDENCY_RELATION_TYPE_VALUES。 */
  readonly relationType: string;
}

export interface ProcessModelDetail {
  /** 必含 5 项最小覆盖集（可扩展、不可删减）。 */
  readonly requiredNodeNames: readonly string[];
  readonly nodes: readonly ProcessNodeEntry[];
  readonly dependencies: readonly ProcessDependency[];
}

export type ProcessModelObject = KnowledgeObject<ProcessModelDetail>;

export const PROCESS_MODEL_RELEASE_REF: VersionReference = {
  entityId: 'PM-VDS',
  versionId: 'v2026.08',
};

export const PROCESS_MODEL_OBJECTS: readonly ProcessModelObject[] = [
  {
    objectId: 'PM-VDS',
    name: '变径盾构站隧一体化项目工序模型',
    currentVersion: PROCESS_MODEL_RELEASE_REF,
    versions: [
      {
        versionId: 'v2026.09-review',
        lifecycle: 'in-review',
        recordedAt: '2026-09-14T11:00:00+08:00',
        actor: '项目风险经理',
        note: '提请审核：补充缩径转换节点的焊接/拼装状态参数',
        diffs: [
          {
            field: 'PN-VDS-05 状态参数',
            before: '盾体直径、支护状态',
            after: '盾体直径、支护状态、焊接/拼装状态',
          },
        ],
      },
      {
        versionId: 'v2026.08',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '必含 5 项工序节点全覆盖，经甲方复核发布',
        diffs: [
          {
            field: 'PN-VDS-04 输出描述',
            before: '扩挖断面成型',
            after: '扩挖断面成型、支护闭合',
          },
        ],
      },
    ],
    detail: {
      requiredNodeNames: ['扩径准备', '变径空间扩挖', '刀盘扩径', '盾体扩径', '缩径转换'],
      nodes: [
        {
          nodeId: 'PN-VDS-01',
          name: '扩径准备',
          input: '区间贯通状态、扩径专项方案审批完成',
          output: '扩径工作面与装备就位',
          equipmentComponents: ['小盾构', '扩径模块'],
          structuralComponents: [],
          stateParameters: ['盾体直径', '反力体系状态'],
          monitoringIndicators: ['地下水位', '注浆压力'],
        },
        {
          nodeId: 'PN-VDS-02',
          name: '刀盘扩径',
          input: '扩径工作面就位',
          output: '刀盘扩径到位、切削断面达标',
          equipmentComponents: ['扩径模块', '扩挖机构'],
          structuralComponents: [],
          stateParameters: ['刀盘直径', '主驱动伸出量', '土仓/泥水压力'],
          monitoringIndicators: ['泥水压力', '盾构姿态参数', '地表沉降'],
        },
        {
          nodeId: 'PN-VDS-03',
          name: '盾体扩径',
          input: '刀盘扩径到位',
          output: '盾体扩径段通过、结构转换完成',
          equipmentComponents: ['扩径模块', '反力系统', '推进系统'],
          structuralComponents: ['钢管片', '尾盾'],
          stateParameters: ['盾体直径', '反力体系状态', '支护状态'],
          monitoringIndicators: ['支护结构变形', '盾构姿态参数'],
        },
        {
          nodeId: 'PN-VDS-04',
          name: '变径空间扩挖',
          input: '盾体扩径段通过',
          output: '扩挖断面成型、支护闭合',
          equipmentComponents: ['扩挖机构', '拼装机械臂', '伸缩帽檐'],
          structuralComponents: ['钢管片', '锚杆'],
          stateParameters: ['土仓/泥水压力', '注浆参数', '支护状态'],
          monitoringIndicators: ['地表沉降', '支护结构变形', '注浆压力'],
        },
        {
          nodeId: 'PN-VDS-05',
          name: '缩径转换',
          input: '扩挖断面成型',
          output: '缩径段恢复常规断面、进入站体施工',
          equipmentComponents: ['拼装机械臂', '焊接装配单元'],
          structuralComponents: ['钢管片', '锚杆'],
          stateParameters: ['盾体直径', '支护状态'],
          monitoringIndicators: ['支护结构变形', '地表沉降'],
        },
      ],
      dependencies: [
        { sourceNodeId: 'PN-VDS-01', targetNodeId: 'PN-VDS-02', relationType: '时间先后关系' },
        { sourceNodeId: 'PN-VDS-02', targetNodeId: 'PN-VDS-03', relationType: '受力依赖关系' },
        { sourceNodeId: 'PN-VDS-03', targetNodeId: 'PN-VDS-04', relationType: '作用关系' },
        { sourceNodeId: 'PN-VDS-04', targetNodeId: 'PN-VDS-05', relationType: '时间先后关系' },
        { sourceNodeId: 'PN-VDS-01', targetNodeId: 'PN-VDS-04', relationType: '资源依赖关系' },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-03 规范标准库（不编造国家标准编号，使用项目内部标识）
// ---------------------------------------------------------------------------

export interface StandardDetail {
  readonly category: string;
  readonly issuer: string;
  readonly clauseSummary: string;
  readonly relatedIndicatorItems: readonly string[];
  readonly evidenceReferences: readonly EvidenceReference[];
}

export type StandardObject = KnowledgeObject<StandardDetail>;

export const STANDARD_LIBRARY_REF: VersionReference = {
  entityId: 'STD-LIB-001',
  versionId: 'v1.0',
};

export const STANDARD_OBJECTS: readonly StandardObject[] = [
  {
    objectId: 'STD-QUANT-001',
    name: '项目风险评估量化标准',
    currentVersion: { entityId: 'STD-QUANT-001', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-08-18T09:00:00+08:00',
        actor: '项目风险经理',
        note: '甲方提供并审核，原样导入',
        diffs: [],
      },
    ],
    detail: {
      category: '量化标准',
      issuer: '甲方提供 · 项目级文件',
      clauseSummary:
        '规定地表沉降、支护结构变形、注浆压力等指标的五档评分区间与例外条款，是结构化评分规则的来源依据。',
      relatedIndicatorItems: ['地表沉降累计值', '地表沉降短期斜率', '支护结构变形', '注浆压力'],
      evidenceReferences: [evidence('DOC2026001-S21-SEG004')],
    },
  },
  {
    objectId: 'STD-CONSTR-002',
    name: '变径扩挖专项施工要求',
    currentVersion: { entityId: 'STD-CONSTR-002', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-08-18T09:00:00+08:00',
        actor: '项目风险经理',
        note: '甲方提供并审核，原样导入',
        diffs: [],
      },
    ],
    detail: {
      category: '专项施工要求',
      issuer: '甲方提供 · 项目级文件',
      clauseSummary:
        '规定变径空间扩挖的支护闭合时限、注浆压力生效区间与作业节奏控制要求，是处置建议合规性校验的依据之一。',
      relatedIndicatorItems: ['注浆压力', '支护结构变形'],
      evidenceReferences: [evidence('DOC2026001-S61-SEG011')],
    },
  },
  {
    objectId: 'STD-MON-003',
    name: '监测量测与预警响应要求',
    currentVersion: { entityId: 'STD-MON-003', versionId: 'v1.1-review' },
    versions: [
      {
        versionId: 'v1.1-review',
        lifecycle: 'in-review',
        recordedAt: '2026-09-16T10:30:00+08:00',
        actor: '项目风险经理',
        note: '提请审核：按甲方 9 月来文更新监测频次条款',
        diffs: [
          {
            field: '条款摘要',
            before: '预警响应期间监测频次不低于每 12 小时一次',
            after: '预警响应期间监测频次不低于每 6 小时一次',
          },
        ],
      },
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-08-18T09:00:00+08:00',
        actor: '项目风险经理',
        note: '甲方提供并审核，原样导入',
        diffs: [],
      },
    ],
    detail: {
      category: '监测要求',
      issuer: '甲方提供 · 项目级文件',
      clauseSummary:
        '规定监测项目、测点布设、监测频次与预警响应期间的加密要求，是监测预警阈值与处置措施监测加密的依据。',
      relatedIndicatorItems: ['地表沉降', '支护结构变形', '地下水位'],
      evidenceReferences: [evidence('DOC2026001-S42-SEG009')],
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-04 类比工程案例库
// ---------------------------------------------------------------------------

export interface CaseDetail {
  readonly projectProfile: string;
  readonly constructionMethod: string;
  readonly stratumCondition: string;
  readonly similarityDimensions: readonly string[];
  readonly riskEventSummary: string;
  readonly responseSummary: string;
  readonly relatedMechanismIds: readonly string[];
  readonly evidenceReferences: readonly EvidenceReference[];
}

export type CaseObject = KnowledgeObject<CaseDetail>;

export const CASE_LIBRARY_REF: VersionReference = {
  entityId: 'CASE-LIB-001',
  versionId: 'v2026.07',
};

export const CASE_OBJECTS: readonly CaseObject[] = [
  {
    objectId: 'CASE-2023-001',
    name: '富水软土区盾构扩径区间工程',
    currentVersion: { entityId: 'CASE-2023-001', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-07-22T16:00:00+08:00',
        actor: '项目风险经理',
        note: '脱敏后入库，经甲方复核发布',
        diffs: [],
      },
    ],
    detail: {
      projectProfile: '城市轨道交通区间，变径盾构扩径段约 180 m，2023 年贯通',
      constructionMethod: '变径盾构法',
      stratumCondition: '富水软弱地层',
      similarityDimensions: ['工法相同', '地层相近', '扩径工况相近'],
      riskEventSummary: '扩挖段地表沉降累计值接近控制上限，短期斜率两次越限',
      responseSummary: '注浆参数调整与监测加密后沉降速率回落，未发展为险情',
      relatedMechanismIds: ['MEC-VDS-017'],
      evidenceReferences: [evidence('DOC2026001-S73-SEG002')],
    },
  },
  {
    objectId: 'CASE-2024-002',
    name: '砂性地层泥水盾构扩挖工程',
    currentVersion: { entityId: 'CASE-2024-002', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.1-draft',
        lifecycle: 'draft',
        recordedAt: '2026-09-10T15:20:00+08:00',
        actor: '项目风险经理',
        note: '补充突涌处置段的脱敏描述',
        diffs: [
          {
            field: '处置经过',
            before: '封堵后恢复掘进',
            after: '应急封堵并同步上报，地下水位受控后按审批方案恢复掘进',
          },
        ],
      },
      {
        versionId: 'v1.0',
        lifecycle: 'published',
        recordedAt: '2026-07-22T16:00:00+08:00',
        actor: '项目风险经理',
        note: '脱敏后入库，经甲方复核发布',
        diffs: [],
      },
    ],
    detail: {
      projectProfile: '越江通道联络段，泥水平衡盾构扩挖，2024 年完工',
      constructionMethod: '泥水平衡盾构（扩挖工况）',
      stratumCondition: '富水砂层、承压水地层',
      similarityDimensions: ['地层相近', '扩挖工况相近'],
      riskEventSummary: '扩挖间隙出现渗流突涌征兆，地下水位监测先觉',
      responseSummary: '应急封堵与降水联合处置，突涌点封止后恢复施工',
      relatedMechanismIds: ['MEC-VDS-013'],
      evidenceReferences: [evidence('DOC2026001-S74-SEG005')],
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-05 指标体系与量化标准
// ---------------------------------------------------------------------------

export interface IndicatorItem {
  readonly itemId: string;
  readonly name: string;
  /** 取值自 contracts QUANTITATIVE_INDICATOR_GROUP_VALUES。 */
  readonly group: string;
  /** 取值自 contracts RISK_ASSESSMENT_INDICATOR_TYPE_VALUES。 */
  readonly indicatorType: string;
  readonly unit: string;
  readonly quantitativeScale: string;
}

export interface IndicatorSystemDetail {
  /** 适用性元数据必含 3 个维度，取值自 contracts APPLICABILITY_METADATA_DIMENSION_VALUES。 */
  readonly requiredDimensions: readonly string[];
  readonly applicabilityMetadata: ApplicabilityMetadata;
  readonly items: readonly IndicatorItem[];
  readonly quantizationStandardRef: VersionReference;
  readonly weightSetRef: VersionReference;
}

export type IndicatorSystemObject = KnowledgeObject<IndicatorSystemDetail>;

export const INDICATOR_SYSTEM_REF: VersionReference = {
  entityId: 'IND-SYS-001',
  versionId: 'v1.3',
};

export const QUANTIZATION_STANDARD_REF: VersionReference = {
  entityId: 'QSTD-001',
  versionId: 'v1.0',
};

export const WEIGHT_SET_REF: VersionReference = {
  entityId: 'WGT-VDS-001',
  versionId: 'v2026.09',
};

export const INDICATOR_SYSTEM_OBJECTS: readonly IndicatorSystemObject[] = [
  {
    objectId: 'IND-SYS-001',
    name: '变径扩挖段评估指标体系',
    currentVersion: INDICATOR_SYSTEM_REF,
    versions: [
      {
        versionId: 'v1.3',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '按甲方审核的指标体系发布',
        diffs: [
          {
            field: '指标分组',
            before: '注浆压力归入「施工工艺与设备参数」',
            after: '注浆压力归入「开挖与支护参数」',
          },
        ],
      },
      {
        versionId: 'v1.2',
        lifecycle: 'deactivated',
        recordedAt: '2026-07-28T14:00:00+08:00',
        actor: '项目风险经理',
        note: '指标分组与甲方审核意见不一致，由 v1.3 取代后停用',
        diffs: [],
      },
    ],
    detail: {
      requiredDimensions: ['施工工法数据', '地层条件数据', '工程阶段数据'],
      applicabilityMetadata: {
        constructionMethod: '变径盾构法',
        stratumCondition: '富水软弱地层',
        engineeringStage: '变径空间扩挖与支护',
      },
      items: [
        {
          itemId: 'IND-SETTLE-TOTAL',
          name: '地表沉降累计值',
          group: '监测量测与周边环境',
          indicatorType: '发生可能性评估指标',
          unit: 'mm',
          quantitativeScale: '五档等距区间，控制上限 15.0 mm',
        },
        {
          itemId: 'IND-SETTLE-RATE',
          name: '地表沉降短期斜率',
          group: '监测量测与周边环境',
          indicatorType: '发生可能性评估指标',
          unit: 'mm/d',
          quantitativeScale: '五档等距区间，控制上限 2.6 mm/d',
        },
        {
          itemId: 'IND-SUPPORT-DEFORM',
          name: '支护结构变形',
          group: '开挖与支护参数',
          indicatorType: '后果严重性评估指标',
          unit: 'mm',
          quantitativeScale: '五档等距区间，控制上限 11.0 mm',
        },
        {
          itemId: 'IND-GROUT-PRESSURE',
          name: '注浆压力',
          group: '开挖与支护参数',
          indicatorType: '发生可能性评估指标',
          unit: 'MPa',
          quantitativeScale: '生效区间 0.20–0.25 MPa，按偏离幅度分档',
        },
        {
          itemId: 'IND-WATER-LEVEL',
          name: '地下水位',
          group: '地下水与渗透条件',
          indicatorType: '后果严重性评估指标',
          unit: 'm',
          quantitativeScale: '按变幅分档，控制区间以水文地质资料为准',
        },
      ],
      quantizationStandardRef: QUANTIZATION_STANDARD_REF,
      weightSetRef: WEIGHT_SET_REF,
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-06 结构化评分规则与适用规则集
// ---------------------------------------------------------------------------

/** 对齐 packages/contracts ScoringThresholdSchema（between 双值，其余单值）。 */
export interface ScoringThreshold {
  readonly thresholdId: string;
  readonly operator: 'lt' | 'lte' | 'eq' | 'gte' | 'gt' | 'between';
  readonly value: number | string | boolean;
  readonly upperValue?: number;
  readonly score: number;
}

/** 对齐 packages/contracts GradeIntervalSchema（上下界至少其一）。 */
export interface GradeInterval {
  readonly grade: string;
  readonly lowerBound?: number;
  readonly upperBound?: number;
}

/** 对齐 packages/contracts StructuredScoringRuleSchema。 */
export interface ScoringRule {
  readonly ruleId: string;
  readonly applicabilityConditions: {
    readonly constructionMethod: readonly string[];
    readonly stratumCondition: readonly string[];
    readonly engineeringStage: readonly string[];
  };
  readonly indicatorItem: string;
  readonly scoringThresholds: readonly ScoringThreshold[];
  readonly gradeIntervals: readonly GradeInterval[];
  readonly exceptionClauses: readonly string[];
  readonly evidenceLocator: EvidenceLocator;
  readonly ruleVersion: VersionReference;
  readonly reviewStatus: 'pending' | 'approved' | 'rejected';
}

export interface RuleSetDetail {
  readonly rules: readonly ScoringRule[];
  readonly applicableRuleSet: {
    readonly ref: VersionReference;
    readonly memberRuleIds: readonly string[];
    readonly metadataSnapshot: ApplicabilityMetadata;
    readonly publishedAt: string;
  };
  readonly weightSetRef: VersionReference;
  readonly riskMatrixRef: VersionReference;
  /** 沿追溯链引用本规则集的评估记录。 */
  readonly usedByAssessmentRecordId: string;
}

export type RuleSetObject = KnowledgeObject<RuleSetDetail>;

export const APPLICABLE_RULE_SET_REF: VersionReference = {
  entityId: 'RS-001',
  versionId: 'v2026.09',
};

export const RISK_MATRIX_REF: VersionReference = {
  entityId: 'RM-VDS-001',
  versionId: 'v2026.09',
};

const RULE_APPLICABILITY = {
  constructionMethod: ['变径盾构法'],
  stratumCondition: ['富水软弱地层'],
  engineeringStage: ['变径空间扩挖与支护'],
} as const;

const GRADE_INTERVALS: readonly GradeInterval[] = [
  { grade: '1', upperBound: 1 },
  { grade: '2', lowerBound: 1, upperBound: 2 },
  { grade: '3', lowerBound: 2, upperBound: 3 },
  { grade: '4', lowerBound: 3, upperBound: 4 },
  { grade: '5', lowerBound: 4 },
];

export const RULE_SET_OBJECTS: readonly RuleSetObject[] = [
  {
    objectId: 'RS-001',
    name: '变径空间扩挖适用规则集',
    currentVersion: APPLICABLE_RULE_SET_REF,
    versions: [
      {
        versionId: 'v2026.09',
        lifecycle: 'published',
        recordedAt: '2026-09-01T10:00:00+08:00',
        actor: '项目风险经理',
        note: '按甲方复核后的量化标准刷新成员规则版本',
        diffs: [
          {
            field: '成员规则',
            before: 'RULE-EXPAND-01 v1.2、RULE-EXPAND-02 v1.2、RULE-EXPAND-03 v1.2、RULE-EXPAND-04 v1.2',
            after: 'RULE-EXPAND-01 v1.3、RULE-EXPAND-02 v1.3、RULE-EXPAND-03 v1.3、RULE-EXPAND-04 v1.3',
          },
        ],
      },
      {
        versionId: 'v2026.08',
        lifecycle: 'deactivated',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '成员规则版本整体升级后停用',
        diffs: [],
      },
    ],
    detail: {
      applicableRuleSet: {
        ref: APPLICABLE_RULE_SET_REF,
        memberRuleIds: ['RULE-EXPAND-01', 'RULE-EXPAND-02', 'RULE-EXPAND-03', 'RULE-EXPAND-04'],
        metadataSnapshot: {
          constructionMethod: '变径盾构法',
          stratumCondition: '富水软弱地层',
          engineeringStage: '变径空间扩挖与支护',
        },
        publishedAt: '2026-09-01T10:00:00+08:00',
      },
      weightSetRef: WEIGHT_SET_REF,
      riskMatrixRef: RISK_MATRIX_REF,
      usedByAssessmentRecordId: 'ASSESS-2026-001',
      rules: [
        {
          ruleId: 'RULE-EXPAND-01',
          applicabilityConditions: RULE_APPLICABILITY,
          indicatorItem: '地表沉降累计值',
          scoringThresholds: [
            { thresholdId: 'RULE-EXPAND-01-T1', operator: 'lte', value: 6.0, score: 1 },
            { thresholdId: 'RULE-EXPAND-01-T2', operator: 'between', value: 6.0, upperValue: 9.0, score: 2 },
            { thresholdId: 'RULE-EXPAND-01-T3', operator: 'between', value: 9.0, upperValue: 12.0, score: 3 },
            { thresholdId: 'RULE-EXPAND-01-T4', operator: 'between', value: 12.0, upperValue: 15.0, score: 4 },
            { thresholdId: 'RULE-EXPAND-01-T5', operator: 'gt', value: 15.0, score: 5 },
          ],
          gradeIntervals: GRADE_INTERVALS,
          exceptionClauses: ['经复核确认为监测设备异常的数据不参与评分'],
          evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG007' },
          ruleVersion: { entityId: 'RULE-EXPAND-01', versionId: 'v1.3' },
          reviewStatus: 'approved',
        },
        {
          ruleId: 'RULE-EXPAND-02',
          applicabilityConditions: RULE_APPLICABILITY,
          indicatorItem: '地表沉降短期斜率',
          scoringThresholds: [
            { thresholdId: 'RULE-EXPAND-02-T1', operator: 'lte', value: 0.8, score: 1 },
            { thresholdId: 'RULE-EXPAND-02-T2', operator: 'between', value: 0.8, upperValue: 1.4, score: 2 },
            { thresholdId: 'RULE-EXPAND-02-T3', operator: 'between', value: 1.4, upperValue: 2.0, score: 3 },
            { thresholdId: 'RULE-EXPAND-02-T4', operator: 'between', value: 2.0, upperValue: 2.6, score: 4 },
            { thresholdId: 'RULE-EXPAND-02-T5', operator: 'gt', value: 2.6, score: 5 },
          ],
          gradeIntervals: GRADE_INTERVALS,
          exceptionClauses: ['降雨等环境扰动经确认后可在备注中说明'],
          evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG008' },
          ruleVersion: { entityId: 'RULE-EXPAND-02', versionId: 'v1.3' },
          reviewStatus: 'approved',
        },
        {
          ruleId: 'RULE-EXPAND-03',
          applicabilityConditions: RULE_APPLICABILITY,
          indicatorItem: '支护结构变形',
          scoringThresholds: [
            { thresholdId: 'RULE-EXPAND-03-T1', operator: 'lte', value: 3.0, score: 1 },
            { thresholdId: 'RULE-EXPAND-03-T2', operator: 'between', value: 3.0, upperValue: 5.0, score: 2 },
            { thresholdId: 'RULE-EXPAND-03-T3', operator: 'between', value: 5.0, upperValue: 8.0, score: 3 },
            { thresholdId: 'RULE-EXPAND-03-T4', operator: 'between', value: 8.0, upperValue: 11.0, score: 4 },
            { thresholdId: 'RULE-EXPAND-03-T5', operator: 'gt', value: 11.0, score: 5 },
          ],
          gradeIntervals: GRADE_INTERVALS,
          exceptionClauses: ['支护拆改期间的数据按专项说明处理'],
          evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG009' },
          ruleVersion: { entityId: 'RULE-EXPAND-03', versionId: 'v1.3' },
          reviewStatus: 'approved',
        },
        {
          ruleId: 'RULE-EXPAND-04',
          applicabilityConditions: RULE_APPLICABILITY,
          indicatorItem: '注浆压力',
          scoringThresholds: [
            { thresholdId: 'RULE-EXPAND-04-T1', operator: 'between', value: 0.2, upperValue: 0.25, score: 1 },
            { thresholdId: 'RULE-EXPAND-04-T2', operator: 'between', value: 0.18, upperValue: 0.2, score: 2 },
            { thresholdId: 'RULE-EXPAND-04-T3', operator: 'between', value: 0.25, upperValue: 0.27, score: 2 },
            { thresholdId: 'RULE-EXPAND-04-T4', operator: 'lt', value: 0.18, score: 4 },
            { thresholdId: 'RULE-EXPAND-04-T5', operator: 'gt', value: 0.27, score: 4 },
          ],
          gradeIntervals: GRADE_INTERVALS,
          exceptionClauses: ['注浆设备检修窗口期经确认后不计分'],
          evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG010' },
          ruleVersion: { entityId: 'RULE-EXPAND-04', versionId: 'v1.3' },
          reviewStatus: 'pending',
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-07 风险矩阵（矩阵定义全部数据驱动，组件内零硬编码）
// ---------------------------------------------------------------------------

export interface RiskMatrixDetail {
  readonly matrixConfig: RiskMatrixVersionConfig;
  readonly plots: readonly { readonly id: string; readonly p: string; readonly c: string }[];
  readonly acceptanceThresholdRef: VersionReference;
  /** 沿追溯链落点的评估记录。 */
  readonly plottedAssessmentRecordId: string;
}

export type RiskMatrixObject = KnowledgeObject<RiskMatrixDetail>;

export const RISK_MATRIX_CONFIG: RiskMatrixVersionConfig = {
  entityId: 'RM-VDS-001',
  versionId: 'v2026.09',
  probability: {
    label: '发生可能性 P（评分）',
    ticks: ['1', '2', '3', '4', '5'],
  },
  consequence: {
    label: '后果严重度 C（评分）',
    ticks: ['1', '2', '3', '4', '5'],
  },
  levels: [
    { key: 'L1', label: '一级（重大风险）', color: 'var(--risk-1)', softColor: 'var(--risk-1-soft)' },
    { key: 'L2', label: '二级（较大风险）', color: 'var(--risk-2)', softColor: 'var(--risk-2-soft)' },
    { key: 'L3', label: '三级（一般风险）', color: 'var(--risk-3)', softColor: 'var(--risk-3-soft)' },
    { key: 'L4', label: '四级（低风险）', color: 'var(--risk-4)', softColor: 'var(--risk-4-soft)' },
  ],
  cellLevels: [
    ['L4', 'L4', 'L4', 'L3', 'L3'],
    ['L4', 'L4', 'L3', 'L3', 'L2'],
    ['L4', 'L3', 'L3', 'L2', 'L2'],
    ['L3', 'L3', 'L2', 'L2', 'L1'],
    ['L3', 'L2', 'L2', 'L1', 'L1'],
  ],
  acceptable: [
    [true, true, true, true, true],
    [true, true, true, true, false],
    [true, true, true, false, false],
    [true, true, false, false, false],
    [true, false, false, false, false],
  ],
  thresholdVersion: 'v2026.09',
};

export const ACCEPTANCE_THRESHOLD_REF: VersionReference = {
  entityId: 'THR-ACC-001',
  versionId: 'v2026.09',
};

export const RISK_MATRIX_OBJECTS: readonly RiskMatrixObject[] = [
  {
    objectId: 'RM-VDS-001',
    name: '变径扩挖段 P/C 风险矩阵',
    currentVersion: RISK_MATRIX_REF,
    versions: [
      {
        versionId: 'v2026.10-draft',
        lifecycle: 'draft',
        recordedAt: '2026-09-17T09:00:00+08:00',
        actor: '项目风险经理',
        note: '拟调整 P=5 行二级/一级分界，待甲方复核',
        diffs: [
          {
            field: 'cellLevels[P=5][C=3]',
            before: '二级（较大风险）',
            after: '一级（重大风险）',
          },
        ],
      },
      {
        versionId: 'v2026.09',
        lifecycle: 'published',
        recordedAt: '2026-09-01T10:00:00+08:00',
        actor: '项目风险经理',
        note: 'v2026.08 等级映射复核不通过，内容回滚至 v2026.07 并以新版本发布',
        rollbackOf: 'v2026.07',
        diffs: [
          {
            field: 'cellLevels[P=4][C=4]',
            before: '一级（重大风险）',
            after: '二级（较大风险）',
          },
        ],
      },
      {
        versionId: 'v2026.08',
        lifecycle: 'deactivated',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: '项目风险经理',
        note: '等级映射未经甲方复核确认，停用',
        diffs: [],
      },
      {
        versionId: 'v2026.07',
        lifecycle: 'deactivated',
        recordedAt: '2026-07-25T10:00:00+08:00',
        actor: '项目风险经理',
        note: '由 v2026.08 取代后停用；v2026.09 回滚采用本版内容',
        diffs: [],
      },
    ],
    detail: {
      matrixConfig: RISK_MATRIX_CONFIG,
      plots: [{ id: 'ASSESS-2026-001', p: '4', c: '3' }],
      acceptanceThresholdRef: ACCEPTANCE_THRESHOLD_REF,
      plottedAssessmentRecordId: 'ASSESS-2026-001',
    },
  },
];

// ---------------------------------------------------------------------------
// P-KM-08 措施库
// ---------------------------------------------------------------------------

export interface MeasureDetail {
  readonly direction: string;
  readonly applicableEvents: string;
  readonly applicability: ApplicabilityMetadata;
  readonly resourceRequirements: readonly string[];
  /** 对齐 packages/contracts TargetIndicatorSchema。 */
  readonly targetIndicators: readonly {
    readonly indicatorItem: string;
    readonly targetValue: string | number | boolean;
  }[];
  /** 沿追溯链引用本措施的处置建议（无则为 null）。 */
  readonly usedByRecommendationId: string | null;
}

export type MeasureObject = KnowledgeObject<MeasureDetail>;

export const MEASURE_LIBRARY_REF: VersionReference = {
  entityId: 'MSL-VDS-001',
  versionId: 'v2026.08',
};

const MEASURE_APPLICABILITY: ApplicabilityMetadata = {
  constructionMethod: '变径盾构法',
  stratumCondition: '富水软弱地层',
  engineeringStage: '变径空间扩挖与支护',
};

const MEASURE_PUBLISHED_VERSION: KnowledgeVersion = {
  versionId: 'v1.0',
  lifecycle: 'published',
  recordedAt: '2026-08-20T10:00:00+08:00',
  actor: '项目风险经理',
  note: '随措施库 MSL-VDS-001 · v2026.08 发布',
  diffs: [],
};

export const MEASURE_OBJECTS: readonly MeasureObject[] = [
  {
    objectId: 'MS-GROUT-01',
    name: '注浆调整',
    currentVersion: { entityId: 'MS-GROUT-01', versionId: 'v1.0' },
    versions: [
      {
        versionId: 'v1.1-review',
        lifecycle: 'in-review',
        recordedAt: '2026-09-15T16:00:00+08:00',
        actor: '项目风险经理',
        note: '提请审核：目标区间与评分规则 RULE-EXPAND-04 生效区间对齐',
        diffs: [
          {
            field: '目标指标',
            before: '注浆压力恢复至控制区间',
            after: '注浆压力恢复至 0.20–0.25 MPa',
          },
        ],
      },
      MEASURE_PUBLISHED_VERSION,
    ],
    detail: {
      direction: '复核注浆压力与注浆量，使其恢复至生效规则允许区间',
      applicableEvents: '过挖与地表沉降、渗流类风险事件',
      applicability: MEASURE_APPLICABILITY,
      resourceRequirements: ['注浆班组', '注浆设备与材料'],
      targetIndicators: [{ indicatorItem: '注浆压力', targetValue: '恢复至 0.20–0.25 MPa' }],
      usedByRecommendationId: 'RESP-2026-001',
    },
  },
  {
    objectId: 'MS-PARAM-02',
    name: '参数控制',
    currentVersion: { entityId: 'MS-PARAM-02', versionId: 'v1.0' },
    versions: [MEASURE_PUBLISHED_VERSION],
    detail: {
      direction: '复核当前扩挖进尺与支护闭合状态，按已审批方案控制作业节奏',
      applicableEvents: '掌子面稳定性、过挖与地表沉降类风险事件',
      applicability: MEASURE_APPLICABILITY,
      resourceRequirements: ['现场负责人', '技术负责人'],
      targetIndicators: [{ indicatorItem: '支护结构变形', targetValue: '变形速率不再加速' }],
      usedByRecommendationId: 'RESP-2026-001',
    },
  },
  {
    objectId: 'MS-SUPPORT-03',
    name: '支护加固',
    currentVersion: { entityId: 'MS-SUPPORT-03', versionId: 'v1.0' },
    versions: [MEASURE_PUBLISHED_VERSION],
    detail: {
      direction: '检查伸缩帽檐、钢管片与锚杆支护状态，必要时执行经审批的加固措施',
      applicableEvents: '支护结构失效、装配连接失效类风险事件',
      applicability: {
        constructionMethod: '变径盾构法',
        stratumCondition: '不限地层',
        engineeringStage: '变径空间扩挖与支护',
      },
      resourceRequirements: ['支护班组', '加固材料'],
      targetIndicators: [{ indicatorItem: '支护结构变形', targetValue: '变形趋势稳定' }],
      usedByRecommendationId: null,
    },
  },
  {
    objectId: 'MS-DRAIN-04',
    name: '排水降水',
    currentVersion: { entityId: 'MS-DRAIN-04', versionId: 'v1.0' },
    versions: [MEASURE_PUBLISHED_VERSION],
    detail: {
      direction: '对渗流发育区段实施经审批的排水降水措施，控制地下水位',
      applicableEvents: '渗流突涌类风险事件',
      applicability: {
        constructionMethod: '变径盾构法',
        stratumCondition: '富水砂层',
        engineeringStage: '全部工程阶段',
      },
      resourceRequirements: ['降水设备', '排水班组'],
      targetIndicators: [{ indicatorItem: '地下水位', targetValue: '回落至控制区间' }],
      usedByRecommendationId: null,
    },
  },
  {
    objectId: 'MS-MON-05',
    name: '监测加密',
    currentVersion: { entityId: 'MS-MON-05', versionId: 'v1.0' },
    versions: [MEASURE_PUBLISHED_VERSION],
    detail: {
      direction: '按预警响应等级加密地表沉降和支护结构变形监测',
      applicableEvents: '全部风险事件',
      applicability: {
        constructionMethod: '全部工法',
        stratumCondition: '全部地层',
        engineeringStage: '全部工程阶段',
      },
      resourceRequirements: ['监测人员', '监测设备'],
      targetIndicators: [{ indicatorItem: '地表沉降短期斜率', targetValue: '回落至 ≤2.0 mm/d' }],
      usedByRecommendationId: 'RESP-2026-001',
    },
  },
  {
    objectId: 'MS-SEAL-07',
    name: '应急封堵',
    currentVersion: { entityId: 'MS-SEAL-07', versionId: 'v1.0' },
    versions: [MEASURE_PUBLISHED_VERSION],
    detail: {
      direction: '对突涌点位按应急预案实施封堵，并同步上报',
      applicableEvents: '渗流突涌类风险事件',
      applicability: {
        constructionMethod: '全部工法',
        stratumCondition: '富水地层',
        engineeringStage: '全部工程阶段',
      },
      resourceRequirements: ['应急物资', '应急班组'],
      targetIndicators: [{ indicatorItem: '地下水位', targetValue: '突涌点封止、渗流量受控' }],
      usedByRecommendationId: null,
    },
  },
];
