// 工程域（P-PJ-01～P-PJ-10）fixtures。
// 字段形状以 packages/contracts 与 packages/core 的 engineering-data / access schema 为准：
// - 工程/空间区段修订：packages/core/src/engineering-data/context-source/schema.ts
//   （ProjectBusinessRevisionV1 / SpatialBusinessRevisionV1 / SourceVersionV1 /
//    SourceDeliveryV1 / SourceSegmentSetV1 / ApplicabilityMetadataSnapshotV1）
// - 监测：packages/core/src/engineering-data/monitoring/schema.ts
//   （MonitoringSeriesRevisionV1 / MonitoringBatchV1 / MonitoringSnapshotV1）
// - 成员与资料访问：packages/core/src/access/schema.ts
//   （ReviseMembershipCommandV1 / ReviseSourceAccessCommandV1 / SourceVisibilityV1）
// 跨域标识沿典范追溯链：DOC2026001 → DOC2026001-S32-SEG007 → PN-VDS-04 →
// MEC-VDS-017 → RISK-2026-001 → RUN-A-2026-001 / ASSESS-2026-001 → WARN-2026-001 →
// RESP-2026-001 → DEV-2026-001 / CAL-2026-001；识别运行 RUN-20260827-001。

// ---------- 共享形状（对齐 contracts/common） ----------

export interface VersionedEntityRef {
  readonly kind: string;
  readonly reference: {
    readonly entityId: string;
    readonly versionId: string;
  };
}

export interface AuditInfoFixture {
  readonly actorId: string;
  readonly action: string;
  readonly recordedAt: string;
  readonly reason?: string;
}

export interface EffectivePeriodFixture {
  readonly validFrom: string;
  readonly validTo?: string;
}

export interface SystemTimeFixture {
  readonly recordedAt: string;
  readonly supersededAt?: string;
}

/** 适用性元数据三维度（ApplicabilityMetadataSchema，最小覆盖集不可删减）。 */
export interface ApplicabilityMetadataFixture {
  readonly constructionMethod: string;
  readonly stratumCondition: string;
  readonly engineeringStage: string;
}

// ---------- 工程业务上下文修订（ProjectBusinessRevisionV1） ----------

export type ProjectBusinessLifecycle = 'preparing' | 'active' | 'ended' | 'archived';

export interface ProjectBusinessRevisionFixture {
  readonly projectRevisionRef: VersionedEntityRef;
  readonly projectId: string;
  readonly name: string;
  readonly lifecycle: ProjectBusinessLifecycle;
  readonly applicabilityMetadata: ApplicabilityMetadataFixture;
  readonly effectivePeriod: EffectivePeriodFixture;
  readonly systemTime: SystemTimeFixture;
  readonly previousRevisionRef?: VersionedEntityRef;
  readonly audit: AuditInfoFixture;
}

const PROJECT_REV_1: VersionedEntityRef = {
  kind: 'project-revision',
  reference: { entityId: 'PRJ-001', versionId: 'rev-1' },
};
const PROJECT_REV_2: VersionedEntityRef = {
  kind: 'project-revision',
  reference: { entityId: 'PRJ-001', versionId: 'rev-2' },
};

export const PROJECT_BUSINESS_REVISIONS: readonly ProjectBusinessRevisionFixture[] = [
  {
    projectRevisionRef: PROJECT_REV_1,
    projectId: 'PRJ-001',
    name: '站隧一体化标（变径盾构试验区段）',
    lifecycle: 'preparing',
    applicabilityMetadata: {
      constructionMethod: '变径盾构法',
      stratumCondition: '富水软弱地层',
      engineeringStage: '施工准备',
    },
    effectivePeriod: { validFrom: '2026-03-01T00:00:00+08:00' },
    systemTime: {
      recordedAt: '2026-03-01T09:30:00+08:00',
      supersededAt: '2026-06-15T10:20:00+08:00',
    },
    audit: {
      actorId: 'ACCT-001',
      action: 'project-context-revision',
      recordedAt: '2026-03-01T09:30:00+08:00',
      reason: '工程开通登记',
    },
  },
  {
    projectRevisionRef: PROJECT_REV_2,
    projectId: 'PRJ-001',
    name: '站隧一体化标（变径盾构试验区段）',
    lifecycle: 'active',
    applicabilityMetadata: {
      constructionMethod: '变径盾构法',
      stratumCondition: '富水软弱地层',
      engineeringStage: '变径段掘进',
    },
    effectivePeriod: { validFrom: '2026-06-15T00:00:00+08:00' },
    systemTime: { recordedAt: '2026-06-15T10:20:00+08:00' },
    previousRevisionRef: PROJECT_REV_1,
    audit: {
      actorId: 'ACCT-001',
      action: 'project-context-revision',
      recordedAt: '2026-06-15T10:20:00+08:00',
      reason: '进入变径段掘进阶段，修订工程阶段维度',
    },
  },
];

export const CURRENT_PROJECT_REVISION = PROJECT_BUSINESS_REVISIONS[1];

// ---------- 空间区段修订（SpatialBusinessRevisionV1） ----------

export type SpatialBusinessStatus = 'active' | 'inactive';

export interface SpatialApplicabilityOverridesFixture {
  readonly constructionMethod?: string;
  readonly stratumCondition?: string;
  readonly engineeringStage?: string;
}

export interface SpatialScopeRevisionFixture {
  readonly spatialScopeRef: VersionedEntityRef;
  readonly projectRevisionRef: VersionedEntityRef;
  readonly parentScopeRef?: VersionedEntityRef;
  readonly name: string;
  readonly worksiteLocation: string;
  readonly chainage?: { readonly start: number; readonly end: number };
  readonly applicabilityOverrides: SpatialApplicabilityOverridesFixture;
  readonly status: SpatialBusinessStatus;
  readonly effectivePeriod: EffectivePeriodFixture;
  readonly systemTime: SystemTimeFixture;
  readonly previousRevisionRef?: VersionedEntityRef;
  readonly audit: AuditInfoFixture;
}

const SS_001_REV_1: VersionedEntityRef = {
  kind: 'spatial-scope',
  reference: { entityId: 'SS-001', versionId: 'rev-1' },
};
const SS_001_REV_2: VersionedEntityRef = {
  kind: 'spatial-scope',
  reference: { entityId: 'SS-001', versionId: 'rev-2' },
};
const SS_002_REV_1: VersionedEntityRef = {
  kind: 'spatial-scope',
  reference: { entityId: 'SS-002', versionId: 'rev-1' },
};

export const SPATIAL_SCOPE_REVISIONS: readonly SpatialScopeRevisionFixture[] = [
  {
    spatialScopeRef: SS_001_REV_1,
    projectRevisionRef: PROJECT_REV_1,
    name: '区段一 · 始发井至换乘段',
    worksiteLocation: '试验区段北端始发井',
    chainage: { start: 1180.0, end: 1620.5 },
    applicabilityOverrides: {},
    status: 'active',
    effectivePeriod: { validFrom: '2026-03-01T00:00:00+08:00' },
    systemTime: {
      recordedAt: '2026-03-01T09:40:00+08:00',
      supersededAt: '2026-07-02T14:05:00+08:00',
    },
    audit: {
      actorId: 'ACCT-001',
      action: 'create-spatial-scope',
      recordedAt: '2026-03-01T09:40:00+08:00',
      reason: '初始空间区段划分',
    },
  },
  {
    spatialScopeRef: SS_001_REV_2,
    projectRevisionRef: PROJECT_REV_2,
    name: '区段一 · 始发井至换乘段',
    worksiteLocation: '试验区段北端始发井',
    chainage: { start: 1180.0, end: 1620.5 },
    applicabilityOverrides: { stratumCondition: '富水砂层发育段' },
    status: 'active',
    effectivePeriod: { validFrom: '2026-07-02T00:00:00+08:00' },
    systemTime: { recordedAt: '2026-07-02T14:05:00+08:00' },
    previousRevisionRef: SS_001_REV_1,
    audit: {
      actorId: 'ACCT-001',
      action: 'revise-spatial-scope',
      recordedAt: '2026-07-02T14:05:00+08:00',
      reason: '补勘后细化地层条件覆盖',
    },
  },
  {
    spatialScopeRef: SS_002_REV_1,
    projectRevisionRef: PROJECT_REV_2,
    name: '区段二 · 换乘段至接收井',
    worksiteLocation: '换乘段南端接收井',
    chainage: { start: 1620.5, end: 2088.0 },
    applicabilityOverrides: {},
    status: 'active',
    effectivePeriod: { validFrom: '2026-06-15T00:00:00+08:00' },
    systemTime: { recordedAt: '2026-06-15T10:25:00+08:00' },
    audit: {
      actorId: 'ACCT-001',
      action: 'create-spatial-scope',
      recordedAt: '2026-06-15T10:25:00+08:00',
      reason: '变径段掘进开工前补划区段',
    },
  },
];

export const CURRENT_SPATIAL_REVISIONS: readonly SpatialScopeRevisionFixture[] = [
  SPATIAL_SCOPE_REVISIONS[1],
  SPATIAL_SCOPE_REVISIONS[2],
];

// ---------- 工序节点（process 级，引用知识域工序模型发布版本） ----------

export interface ProcessNodeDependencyFixture {
  readonly processNodeId: string;
  readonly name: string;
  readonly spatialScopeRef: VersionedEntityRef;
  readonly processModelReleaseRef: VersionedEntityRef;
}

export const PROCESS_MODEL_RELEASE_REF: VersionedEntityRef = {
  kind: 'process-model-release',
  reference: { entityId: 'PM-VDS-001', versionId: 'v2026.08' },
};

export const PROCESS_NODE_DEPENDENCIES: readonly ProcessNodeDependencyFixture[] = [
  { processNodeId: 'PN-VDS-01', name: '扩径准备', spatialScopeRef: SS_001_REV_2, processModelReleaseRef: PROCESS_MODEL_RELEASE_REF },
  { processNodeId: 'PN-VDS-04', name: '变径空间扩挖', spatialScopeRef: SS_001_REV_2, processModelReleaseRef: PROCESS_MODEL_RELEASE_REF },
  { processNodeId: 'PN-VDS-02', name: '刀盘扩径', spatialScopeRef: SS_001_REV_2, processModelReleaseRef: PROCESS_MODEL_RELEASE_REF },
  { processNodeId: 'PN-VDS-03', name: '盾体扩径', spatialScopeRef: SS_002_REV_1, processModelReleaseRef: PROCESS_MODEL_RELEASE_REF },
  { processNodeId: 'PN-VDS-05', name: '缩径转换', spatialScopeRef: SS_002_REV_1, processModelReleaseRef: PROCESS_MODEL_RELEASE_REF },
];

/** 适用性元数据快照（ApplicabilityMetadataSnapshotV1），供资料版本与监测引用。 */
export const APPLICABILITY_SNAPSHOT_REF: VersionedEntityRef = {
  kind: 'applicability-metadata-snapshot',
  reference: { entityId: 'AMS-001', versionId: 'v2026.08' },
};

// ---------- 工程成员与资料访问授权（access schema） ----------

export interface ProjectMemberFixture {
  readonly membershipId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly spatialScopeRefs: readonly VersionedEntityRef[];
  readonly status: 'active' | 'removed';
  readonly audit: AuditInfoFixture;
}

export const PROJECT_MEMBERS: readonly ProjectMemberFixture[] = [
  {
    membershipId: 'MBR-001',
    accountId: 'ACCT-001',
    displayName: '张工',
    roles: ['project-risk-manager'],
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    status: 'active',
    audit: { actorId: 'ACCT-000', action: 'revise-membership', recordedAt: '2026-03-01T09:50:00+08:00', reason: '工程开通指定初始风险负责人' },
  },
  {
    membershipId: 'MBR-002',
    accountId: 'ACCT-002',
    displayName: '李工',
    roles: ['reviewer'],
    spatialScopeRefs: [SS_001_REV_2],
    status: 'active',
    audit: { actorId: 'ACCT-001', action: 'revise-membership', recordedAt: '2026-04-11T15:20:00+08:00', reason: '复核专家入场' },
  },
  {
    membershipId: 'MBR-003',
    accountId: 'ACCT-003',
    displayName: '陈工',
    roles: ['field-responder'],
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    status: 'active',
    audit: { actorId: 'ACCT-001', action: 'revise-membership', recordedAt: '2026-06-20T08:40:00+08:00', reason: '现场处置班组建档' },
  },
  {
    membershipId: 'MBR-004',
    accountId: 'ACCT-004',
    displayName: '刘工',
    roles: ['business-viewer'],
    spatialScopeRefs: [SS_001_REV_2],
    status: 'removed',
    audit: { actorId: 'ACCT-001', action: 'revise-membership', recordedAt: '2026-08-05T17:10:00+08:00', reason: '岗位调整移出工程' },
  },
];

export interface SourceAccessGrantFixture {
  readonly sourceAccessGrantRef: VersionedEntityRef;
  readonly sourceVersionRef: VersionedEntityRef;
  readonly visibility: 'project-shared' | 'restricted';
  readonly allowedAccountIds: readonly string[];
  readonly spatialScopeRefs: readonly VersionedEntityRef[];
  readonly registeredByAccountId: string;
  readonly audit: AuditInfoFixture;
}

// ---------- 资料（SourceItemV1 / SourceDeliveryV1 / SourceVersionV1 / SourceSegmentSetV1） ----------

export type SourceDeliveryKind = 'file-upload' | 'database-snapshot' | 'api-snapshot';
export type SourceAccessStatus = 'pending-access' | 'ready';
export type SourceSegmentKind = 'chapter' | 'table' | 'monitoring-window';

export type SourceSegmentLocatorFixture =
  | { readonly kind: 'document'; readonly pageNumber: number; readonly headingPath: readonly string[] }
  | { readonly kind: 'table'; readonly sheet: string; readonly table: string; readonly rowRange: { readonly start: number; readonly end: number }; readonly columnRange: { readonly start: number; readonly end: number } }
  | { readonly kind: 'record'; readonly dataset: string; readonly stableRecordKey: string }
  | { readonly kind: 'time-window'; readonly from: string; readonly to: string };

export interface SourceSegmentFixture {
  /** 资料段标识：资料ID-章节ID-段ID。 */
  readonly sourceSegmentId: string;
  readonly chapterId: string;
  readonly segmentId: string;
  readonly kind: SourceSegmentKind;
  readonly spatialScopeRefs: readonly VersionedEntityRef[];
  readonly locator: SourceSegmentLocatorFixture;
  readonly summary: string;
}

export interface SourceRecordFixture {
  readonly sourceItemId: string;
  readonly sourceId: string;
  readonly name: string;
  readonly category: string;
  readonly metadata: {
    readonly documentType?: string;
    readonly formedAt?: string;
    readonly worksiteLocation?: string;
    readonly sourceOrganization?: string;
    readonly externalVersion?: string;
  };
  readonly descriptor:
    | { readonly kind: 'file-upload'; readonly contentFingerprint: string }
    | { readonly kind: 'database-snapshot'; readonly connectionDefinitionRef: { readonly entityId: string; readonly versionId: string }; readonly queryFingerprint: string }
    | { readonly kind: 'api-snapshot'; readonly connectionDefinitionRef: { readonly entityId: string; readonly versionId: string }; readonly requestFingerprint: string; readonly responseFingerprint: string };
  readonly sourceDeliveryRef: VersionedEntityRef;
  readonly sourceVersionRef: VersionedEntityRef;
  readonly projectRevisionRef: VersionedEntityRef;
  readonly spatialScopeRefs: readonly VersionedEntityRef[];
  readonly accessStatus: SourceAccessStatus;
  readonly sourceAccessGrantRef?: VersionedEntityRef;
  readonly applicabilityMetadataSnapshotRef: VersionedEntityRef;
  /** 当前授权决策下的证据脱敏状态：full 可读全文，redacted 仅定位信息。 */
  readonly evidenceAccess: 'full' | 'redacted';
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly registeredByAccountId: string;
  readonly segments: readonly SourceSegmentFixture[];
  readonly referencedBy: readonly { readonly kind: string; readonly id: string; readonly path: string }[];
  readonly audit: AuditInfoFixture;
}

const GRANT_DOC_001: VersionedEntityRef = {
  kind: 'source-access-grant',
  reference: { entityId: 'GRANT-001', versionId: 'rev-1' },
};
const GRANT_DOC_002: VersionedEntityRef = {
  kind: 'source-access-grant',
  reference: { entityId: 'GRANT-002', versionId: 'rev-1' },
};
const GRANT_DOC_003: VersionedEntityRef = {
  kind: 'source-access-grant',
  reference: { entityId: 'GRANT-003', versionId: 'rev-1' },
};
const GRANT_DOC_004: VersionedEntityRef = {
  kind: 'source-access-grant',
  reference: { entityId: 'GRANT-004', versionId: 'rev-2' },
};

export const SOURCE_ACCESS_GRANTS: readonly SourceAccessGrantFixture[] = [
  {
    sourceAccessGrantRef: GRANT_DOC_001,
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026001', versionId: 'v2026.06' } },
    visibility: 'project-shared',
    allowedAccountIds: [],
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    registeredByAccountId: 'ACCT-001',
    audit: { actorId: 'ACCT-001', action: 'revise-source-access', recordedAt: '2026-06-16T09:10:00+08:00', reason: '工程内共享' },
  },
  {
    sourceAccessGrantRef: GRANT_DOC_002,
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026002', versionId: 'v2026.03' } },
    visibility: 'project-shared',
    allowedAccountIds: [],
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    registeredByAccountId: 'ACCT-001',
    audit: { actorId: 'ACCT-001', action: 'revise-source-access', recordedAt: '2026-03-15T10:00:00+08:00', reason: '工程内共享' },
  },
  {
    sourceAccessGrantRef: GRANT_DOC_003,
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026003', versionId: 'v2026.08' } },
    visibility: 'project-shared',
    allowedAccountIds: [],
    spatialScopeRefs: [SS_001_REV_2],
    registeredByAccountId: 'ACCT-001',
    audit: { actorId: 'ACCT-001', action: 'revise-source-access', recordedAt: '2026-08-27T09:30:00+08:00', reason: '监测数据工程内共享' },
  },
  {
    sourceAccessGrantRef: GRANT_DOC_004,
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026004', versionId: 'v2026.01' } },
    visibility: 'restricted',
    allowedAccountIds: ['ACCT-001'],
    spatialScopeRefs: [SS_001_REV_2],
    registeredByAccountId: 'ACCT-001',
    audit: { actorId: 'ACCT-001', action: 'revise-source-access', recordedAt: '2026-07-19T11:25:00+08:00', reason: '装备设计资料限风险负责人可读全文' },
  },
];

export const SOURCE_RECORDS: readonly SourceRecordFixture[] = [
  {
    sourceItemId: 'SRC-001',
    sourceId: 'DOC2026001',
    name: '变径空间扩挖与支护专项施工方案',
    category: '专项施工方案',
    metadata: {
      documentType: '专项施工方案',
      formedAt: '2026-06-02T00:00:00+08:00',
      worksiteLocation: '试验区段北端始发井',
      sourceOrganization: '施工单位',
      externalVersion: 'V3.1',
    },
    descriptor: { kind: 'file-upload', contentFingerprint: 'sha256:9f2c…施工方案V3.1' },
    sourceDeliveryRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-001', versionId: 'v1' } },
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026001', versionId: 'v2026.06' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    accessStatus: 'ready',
    sourceAccessGrantRef: GRANT_DOC_001,
    applicabilityMetadataSnapshotRef: APPLICABILITY_SNAPSHOT_REF,
    evidenceAccess: 'full',
    occurredAt: '2026-06-15T16:40:00+08:00',
    recordedAt: '2026-06-15T16:42:00+08:00',
    registeredByAccountId: 'ACCT-001',
    segments: [
      {
        sourceSegmentId: 'DOC2026001-S32-SEG007',
        chapterId: 'S32',
        segmentId: 'SEG007',
        kind: 'chapter',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'document', pageNumber: 34, headingPath: ['第 6 章 变径空间扩挖与支护', '6.2 扩挖进尺与支护闭合'] },
        summary: '明确扩挖进尺、支护闭合时限与注浆参数控制要求，是主风险识别与评估的核心工序依据。',
      },
      {
        sourceSegmentId: 'DOC2026001-S41-SEG003',
        chapterId: 'S41',
        segmentId: 'SEG003',
        kind: 'chapter',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'document', pageNumber: 18, headingPath: ['第 4 章 扩径准备', '4.1 扩径模块吊装与定位'] },
        summary: '规定扩径模块吊装、定位与调试的作业顺序和验收要点。',
      },
      {
        sourceSegmentId: 'DOC2026001-S63-SEG011',
        chapterId: 'S63',
        segmentId: 'SEG011',
        kind: 'table',
        spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
        locator: { kind: 'table', sheet: '参数表', table: '注浆参数控制表', rowRange: { start: 3, end: 9 }, columnRange: { start: 1, end: 6 } },
        summary: '给出注浆压力生效区间 0.20–0.25 MPa 与偏离处置口径。',
      },
      {
        sourceSegmentId: 'DOC2026001-S92-SEG002',
        chapterId: 'S92',
        segmentId: 'SEG002',
        kind: 'chapter',
        spatialScopeRefs: [SS_002_REV_1],
        locator: { kind: 'document', pageNumber: 66, headingPath: ['第 9 章 缩径转换', '9.2 支护刚度过渡'] },
        summary: '规定缩径转换段支护刚度过渡与受力转换控制要求。',
      },
    ],
    referencedBy: [
      { kind: '工序节点', id: 'PN-VDS-04', path: '/identification/process-model' },
      { kind: '风险机理条目', id: 'MEC-VDS-017', path: '/knowledge/mechanisms' },
      { kind: '标准化风险记录', id: 'RISK-2026-001', path: '/identification/records/RISK-2026-001' },
      { kind: '风险评估记录', id: 'ASSESS-2026-001', path: '/assessment/records/ASSESS-2026-001' },
    ],
    audit: { actorId: 'ACCT-001', action: 'register-source-delivery', recordedAt: '2026-06-15T16:42:00+08:00', reason: '专项方案 V3.1 交付登记' },
  },
  {
    sourceItemId: 'SRC-002',
    sourceId: 'DOC2026002',
    name: '工程地质勘察报告',
    category: '地质资料',
    metadata: {
      documentType: '地质资料',
      formedAt: '2026-03-12T00:00:00+08:00',
      worksiteLocation: '试验区段全线',
      sourceOrganization: '勘察设计单位',
      externalVersion: 'V2.0',
    },
    descriptor: { kind: 'file-upload', contentFingerprint: 'sha256:41ab…勘察报告V2.0' },
    sourceDeliveryRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-002', versionId: 'v1' } },
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026002', versionId: 'v2026.03' } },
    projectRevisionRef: PROJECT_REV_1,
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    accessStatus: 'ready',
    sourceAccessGrantRef: GRANT_DOC_002,
    applicabilityMetadataSnapshotRef: APPLICABILITY_SNAPSHOT_REF,
    evidenceAccess: 'full',
    occurredAt: '2026-03-14T10:05:00+08:00',
    recordedAt: '2026-03-14T10:08:00+08:00',
    registeredByAccountId: 'ACCT-001',
    segments: [
      {
        sourceSegmentId: 'DOC2026002-C04-SEG018',
        chapterId: 'C04',
        segmentId: 'SEG018',
        kind: 'chapter',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'document', pageNumber: 42, headingPath: ['第 4 章 水文地质与工程地质条件'] },
        summary: '试验区段为富水软弱地层，地下水位埋深浅，砂层发育，开挖扰动下易发生地层损失与渗流。',
      },
      {
        sourceSegmentId: 'DOC2026002-C03-SEG007',
        chapterId: 'C03',
        segmentId: 'SEG007',
        kind: 'chapter',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'document', pageNumber: 28, headingPath: ['第 3 章 岩土工程特性'] },
        summary: '给出试验区段各土层强度、变形与渗透参数建议值，作为开挖面稳定性评估输入。',
      },
    ],
    referencedBy: [
      { kind: '标准化风险记录', id: 'RISK-2026-001', path: '/identification/records/RISK-2026-001' },
    ],
    audit: { actorId: 'ACCT-001', action: 'register-source-delivery', recordedAt: '2026-03-14T10:08:00+08:00', reason: '勘察报告交付登记' },
  },
  {
    sourceItemId: 'SRC-003',
    sourceId: 'DOC2026003',
    name: '站隧一体化试验区段监测数据集',
    category: '监测数据',
    metadata: {
      documentType: '监测数据',
      formedAt: '2026-08-27T00:00:00+08:00',
      worksiteLocation: '试验区段北端始发井',
      sourceOrganization: '监测单位',
      externalVersion: '2026-08-27 批次',
    },
    descriptor: { kind: 'api-snapshot', connectionDefinitionRef: { entityId: 'CONN-MON-01', versionId: 'v2026.08' }, requestFingerprint: 'req:7c21…监测查询', responseFingerprint: 'resp:5e9d…监测响应' },
    sourceDeliveryRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-003', versionId: 'v1' } },
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026003', versionId: 'v2026.08' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRefs: [SS_001_REV_2],
    accessStatus: 'ready',
    sourceAccessGrantRef: GRANT_DOC_003,
    applicabilityMetadataSnapshotRef: APPLICABILITY_SNAPSHOT_REF,
    evidenceAccess: 'full',
    occurredAt: '2026-08-27T09:12:00+08:00',
    recordedAt: '2026-08-27T09:14:00+08:00',
    registeredByAccountId: 'ACCT-001',
    segments: [
      {
        sourceSegmentId: 'DOC2026003-M001-SEG021',
        chapterId: 'M001',
        segmentId: 'SEG021',
        kind: 'monitoring-window',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'time-window', from: '2026-08-21T00:00:00+08:00', to: '2026-08-27T09:00:00+08:00' },
        summary: '地表沉降监测窗口：累计 13.6 mm，超过监测预警阈值 12.0 mm。',
      },
      {
        sourceSegmentId: 'DOC2026003-M002-SEG035',
        chapterId: 'M002',
        segmentId: 'SEG035',
        kind: 'monitoring-window',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'time-window', from: '2026-08-21T00:00:00+08:00', to: '2026-08-27T09:00:00+08:00' },
        summary: '支护结构变形监测窗口：累计 8.4 mm，超过监测预警阈值 8.0 mm。',
      },
      {
        sourceSegmentId: 'DOC2026003-M003-SEG034',
        chapterId: 'M003',
        segmentId: 'SEG034',
        kind: 'monitoring-window',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'time-window', from: '2026-08-21T00:00:00+08:00', to: '2026-08-27T09:00:00+08:00' },
        summary: '注浆压力监测窗口：降至 0.18 MPa，低于生效区间 0.20–0.25 MPa 下限。',
      },
    ],
    referencedBy: [
      { kind: '标准化风险记录', id: 'RISK-2026-001', path: '/identification/records/RISK-2026-001' },
      { kind: '预警信息', id: 'WARN-2026-001', path: '/warnings/WARN-2026-001' },
    ],
    audit: { actorId: 'ACCT-001', action: 'register-source-delivery', recordedAt: '2026-08-27T09:14:00+08:00', reason: '监测数据集 2026-08-27 批次接入' },
  },
  {
    sourceItemId: 'SRC-004',
    sourceId: 'DOC2026004',
    name: '变径盾构装备设计资料',
    category: '装备设计资料',
    metadata: {
      documentType: '装备设计资料',
      formedAt: '2026-01-20T00:00:00+08:00',
      sourceOrganization: '装备制造单位',
      externalVersion: 'V1.4',
    },
    descriptor: { kind: 'file-upload', contentFingerprint: 'sha256:63f0…装备资料V1.4' },
    sourceDeliveryRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-004', versionId: 'v1' } },
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026004', versionId: 'v2026.01' } },
    projectRevisionRef: PROJECT_REV_1,
    spatialScopeRefs: [SS_001_REV_2],
    accessStatus: 'ready',
    sourceAccessGrantRef: GRANT_DOC_004,
    applicabilityMetadataSnapshotRef: APPLICABILITY_SNAPSHOT_REF,
    evidenceAccess: 'redacted',
    occurredAt: '2026-01-22T14:30:00+08:00',
    recordedAt: '2026-01-22T14:33:00+08:00',
    registeredByAccountId: 'ACCT-001',
    segments: [
      {
        sourceSegmentId: 'DOC2026004-C02-SEG005',
        chapterId: 'C02',
        segmentId: 'SEG005',
        kind: 'chapter',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'document', pageNumber: 12, headingPath: ['第 2 章 扩挖机构与拼装机械臂'] },
        summary: '给出扩挖机构行程、拼装机械臂定位精度与伸缩帽檐结构参数。',
      },
      {
        sourceSegmentId: 'DOC2026004-C03-SEG008',
        chapterId: 'C03',
        segmentId: 'SEG008',
        kind: 'chapter',
        spatialScopeRefs: [SS_001_REV_2],
        locator: { kind: 'document', pageNumber: 21, headingPath: ['第 3 章 主驱动与液压系统'] },
        summary: '给出主驱动额定扭矩、推力与液压系统额定负荷区间。',
      },
    ],
    referencedBy: [
      { kind: '风险机理条目', id: 'MEC-VDS-017', path: '/knowledge/mechanisms' },
    ],
    audit: { actorId: 'ACCT-001', action: 'register-source-delivery', recordedAt: '2026-01-22T14:33:00+08:00', reason: '装备设计资料交付登记' },
  },
  {
    sourceItemId: 'SRC-005',
    sourceId: 'DOC2026005',
    name: '施工组织设计（补充交付）',
    category: '施工资料',
    metadata: {
      documentType: '施工资料',
      formedAt: '2026-08-28T00:00:00+08:00',
      sourceOrganization: '施工单位',
      externalVersion: 'V2.2',
    },
    descriptor: { kind: 'file-upload', contentFingerprint: 'sha256:b704…施组V2.2' },
    sourceDeliveryRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-005', versionId: 'v1' } },
    sourceVersionRef: { kind: 'source-version', reference: { entityId: 'DOC2026005', versionId: 'v2026.08' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRefs: [SS_001_REV_2, SS_002_REV_1],
    accessStatus: 'pending-access',
    applicabilityMetadataSnapshotRef: APPLICABILITY_SNAPSHOT_REF,
    evidenceAccess: 'redacted',
    occurredAt: '2026-08-28T10:02:00+08:00',
    recordedAt: '2026-08-28T10:04:00+08:00',
    registeredByAccountId: 'ACCT-001',
    segments: [],
    referencedBy: [],
    audit: { actorId: 'ACCT-001', action: 'register-source-delivery', recordedAt: '2026-08-28T10:04:00+08:00', reason: '补充交付待授权' },
  },
];

export function findSourceRecord(param: string): SourceRecordFixture | undefined {
  return SOURCE_RECORDS.find(
    (record) => record.sourceId === param || record.sourceItemId === param,
  );
}

// ---------- 接入任务（register-source-delivery / register-monitoring-batch 流水线） ----------

export type IngestionTaskKind = 'source-delivery' | 'monitoring-batch';
export type IngestionTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type IngestionStageStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface IngestionStageFixture {
  readonly code: string;
  readonly label: string;
  readonly status: IngestionStageStatus;
  readonly startedAt?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

export interface IngestionTaskFixture {
  readonly taskId: string;
  readonly kind: IngestionTaskKind;
  readonly status: IngestionTaskStatus;
  readonly triggerReason: string;
  readonly operatorId: string;
  readonly startedAt: string;
  readonly idempotencyKey: string;
  readonly subjectRef: VersionedEntityRef;
  readonly subjectLabel: string;
  readonly stages: readonly IngestionStageFixture[];
  readonly summary: {
    readonly outputCount: number;
    readonly successRatio: number;
    readonly outputRefs: readonly { readonly label: string; readonly path: string }[];
  } | null;
}

const SOURCE_PIPELINE: readonly { code: string; label: string }[] = [
  { code: 'ING-01', label: '接收交付' },
  { code: 'ING-02', label: '指纹校验' },
  { code: 'ING-03', label: '结构化转换' },
  { code: 'ING-04', label: '数据清洗与部分可用判断' },
  { code: 'ING-05', label: '段集登记入库' },
];

const MONITORING_PIPELINE: readonly { code: string; label: string }[] = [
  { code: 'ING-01', label: '接收批次' },
  { code: 'ING-02', label: '指纹校验' },
  { code: 'ING-03', label: '样本版本化' },
  { code: 'ING-04', label: '数据清洗与部分可用判断' },
  { code: 'ING-05', label: '快照候选登记' },
];

function stagesFor(
  pipeline: readonly { code: string; label: string }[],
  statuses: readonly IngestionStageStatus[],
  base: string,
  failedError?: string,
): readonly IngestionStageFixture[] {
  let clock = Date.parse(base);
  return pipeline.map((stage, index) => {
    const status = statuses[index] ?? 'pending';
    if (status === 'pending') return { ...stage, status };
    const startedAt = new Date(clock).toISOString();
    if (status === 'running') return { ...stage, status, startedAt };
    const durationMs = 20_000 + index * 15_000;
    clock += durationMs + 5_000;
    return {
      ...stage,
      status,
      startedAt,
      durationMs,
      errorCode: status === 'failed' ? failedError : undefined,
    };
  });
}

export const INGESTION_TASKS: readonly IngestionTaskFixture[] = [
  {
    taskId: 'ING-20260827-001',
    kind: 'source-delivery',
    status: 'succeeded',
    triggerReason: '监测单位交付 2026-08-27 批次',
    operatorId: 'ACCT-001',
    startedAt: '2026-08-27T09:12:00+08:00',
    idempotencyKey: 'idem-20260827-src-003',
    subjectRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-003', versionId: 'v1' } },
    subjectLabel: '站隧一体化试验区段监测数据集',
    stages: stagesFor(SOURCE_PIPELINE, ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'], '2026-08-27T09:12:00+08:00'),
    summary: {
      outputCount: 3,
      successRatio: 1,
      outputRefs: [
        { label: '资料详情 DOC2026003', path: '/projects/sources/DOC2026003' },
        { label: '监测概览', path: '/projects/monitoring' },
      ],
    },
  },
  {
    taskId: 'ING-20260827-002',
    kind: 'monitoring-batch',
    status: 'succeeded',
    triggerReason: '监测批次 MON-B-20260827-001 登记',
    operatorId: 'ACCT-001',
    startedAt: '2026-08-27T09:15:00+08:00',
    idempotencyKey: 'idem-20260827-mon-001',
    subjectRef: { kind: 'monitoring-batch', reference: { entityId: 'MON-B-20260827-001', versionId: 'v1' } },
    subjectLabel: '地表沉降序列 2026-08-27 批次',
    stages: stagesFor(MONITORING_PIPELINE, ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'], '2026-08-27T09:15:00+08:00'),
    summary: {
      outputCount: 7,
      successRatio: 1,
      outputRefs: [
        { label: '监测序列详情 MON-001', path: '/projects/monitoring/MON-001' },
      ],
    },
  },
  {
    taskId: 'ING-20260828-001',
    kind: 'monitoring-batch',
    status: 'failed',
    triggerReason: '监测批次 MON-B-20260828-001 订正登记',
    operatorId: 'ACCT-001',
    startedAt: '2026-08-28T08:40:00+08:00',
    idempotencyKey: 'idem-20260828-mon-002',
    subjectRef: { kind: 'monitoring-batch', reference: { entityId: 'MON-B-20260828-001', versionId: 'v1' } },
    subjectLabel: '支护结构变形序列订正批次',
    stages: stagesFor(MONITORING_PIPELINE, ['succeeded', 'failed', 'pending', 'pending', 'pending'], '2026-08-28T08:40:00+08:00', 'DELIVERY_FINGERPRINT_MISMATCH'),
    summary: null,
  },
  {
    taskId: 'ING-20260828-002',
    kind: 'source-delivery',
    status: 'running',
    triggerReason: '施工单位补充交付施工组织设计',
    operatorId: 'ACCT-001',
    startedAt: '2026-08-28T10:02:00+08:00',
    idempotencyKey: 'idem-20260828-src-005',
    subjectRef: { kind: 'source-delivery', reference: { entityId: 'SRC-DLV-2026-005', versionId: 'v1' } },
    subjectLabel: '施工组织设计（补充交付）',
    stages: stagesFor(SOURCE_PIPELINE, ['succeeded', 'succeeded', 'succeeded', 'running', 'pending'], '2026-08-28T10:02:00+08:00'),
    summary: null,
  },
  {
    taskId: 'ING-20260829-001',
    kind: 'monitoring-batch',
    status: 'queued',
    triggerReason: '监测批次 MON-B-20260829-001 待接入',
    operatorId: 'ACCT-001',
    startedAt: '2026-08-29T08:30:00+08:00',
    idempotencyKey: 'idem-20260829-mon-001',
    subjectRef: { kind: 'monitoring-batch', reference: { entityId: 'MON-B-20260829-001', versionId: 'v1' } },
    subjectLabel: '注浆压力序列 2026-08-29 批次',
    stages: stagesFor(MONITORING_PIPELINE, ['pending', 'pending', 'pending', 'pending', 'pending'], '2026-08-29T08:30:00+08:00'),
    summary: null,
  },
];

// ---------- 监测序列（MonitoringSeriesRevisionV1 / MonitoringBatchV1 / MonitoringSnapshotV1） ----------

export interface MonitoringSamplePointFixture {
  /** 数据时间（sampledAt）。 */
  readonly sampledAt: string;
  /** 接入时间（样本版本 recordedAt）。 */
  readonly ingestedAt: string;
  readonly value: number | null;
  readonly status: 'available' | 'interpolated' | 'missing';
  readonly reasonCode?: string;
}

export interface MonitoringFeatureFixture {
  readonly featureType: 'short-term-slope' | 'acceleration' | 'dominant-frequency' | 'anomaly-score';
  readonly value?: number;
  readonly unit?: string;
  readonly windowSize: number;
  readonly inputCount: number;
  readonly algorithmVersion: string;
  readonly status: 'available' | 'unavailable';
  readonly reasonCode?: string;
}

export interface MonitoringBatchFixture {
  readonly monitoringBatchRef: VersionedEntityRef;
  readonly deliveryKey: string;
  readonly deliveryFingerprint: string;
  readonly sourceVersionRef: VersionedEntityRef;
  readonly sourceSegmentSetRef: VersionedEntityRef;
  /** 数据时间窗（样本实际发生区间）。 */
  readonly window: { readonly from: string; readonly to: string };
  readonly relation:
    | { readonly kind: 'original' }
    | { readonly kind: 'correction' | 'supplement'; readonly priorBatchRef: VersionedEntityRef };
  readonly sampleCount: number;
  readonly occurredAt: string;
  /** 接入时间。 */
  readonly recordedAt: string;
  readonly audit: AuditInfoFixture;
}

export interface MonitoringSeriesFixture {
  readonly seriesId: string;
  readonly monitoringSeriesRef: VersionedEntityRef;
  readonly projectRevisionRef: VersionedEntityRef;
  readonly spatialScopeRef: VersionedEntityRef;
  readonly monitoringObject: string;
  readonly monitoringIndicator: string;
  readonly parameterCode: string;
  readonly canonicalUnit: string;
  readonly effectivePeriod: EffectivePeriodFixture;
  /** 监测预警阈值（版本化业务配置，非序列修订字段）。 */
  readonly threshold: {
    readonly value: number;
    readonly label: string;
    readonly direction: 'above' | 'below';
    readonly riskLevel: 1 | 2 | 3 | 4;
    readonly thresholdRef: { readonly entityId: string; readonly versionId: string };
  };
  readonly availabilityPolicyRef: { readonly entityId: string; readonly versionId: string };
  readonly algorithmVersions: {
    readonly alignment: string;
    readonly slope: string;
    readonly acceleration: string;
    readonly frequency: string;
    readonly anomaly: string;
  };
  readonly latestValue: number;
  readonly latestSampledAt: string;
  readonly latestIngestedAt: string;
  readonly exceeded: boolean;
  readonly batches: readonly MonitoringBatchFixture[];
  readonly snapshot: {
    readonly monitoringSnapshotRef: VersionedEntityRef;
    readonly cutoff: string;
    readonly availability: 'available' | 'partial' | 'unavailable';
    readonly coverageRatio: number;
    readonly availabilityReasons: readonly string[];
    readonly points: readonly MonitoringSamplePointFixture[];
    readonly features: readonly MonitoringFeatureFixture[];
    readonly evidenceReferences: readonly {
      readonly sourceSegmentId: string;
      readonly sourceVersion: { readonly entityId: string; readonly versionId: string };
    }[];
  };
  readonly audit: AuditInfoFixture;
}

function segmentSetRef(sourceId: string): VersionedEntityRef {
  return {
    kind: 'source-segment-set',
    reference: { entityId: `${sourceId}-SEGSET`, versionId: 'v2026.08' },
  };
}

function batchFixture(
  entityId: string,
  deliveryKey: string,
  fingerprint: string,
  sourceId: string,
  sourceVersionId: string,
  relation: MonitoringBatchFixture['relation'],
  sampleCount: number,
  occurredAt: string,
  recordedAt: string,
): MonitoringBatchFixture {
  return {
    monitoringBatchRef: { kind: 'monitoring-batch', reference: { entityId, versionId: 'v1' } },
    deliveryKey,
    deliveryFingerprint: fingerprint,
    sourceVersionRef: { kind: 'source-version', reference: { entityId: sourceId, versionId: sourceVersionId } },
    sourceSegmentSetRef: segmentSetRef(sourceId),
    window: { from: '2026-08-21T00:00:00+08:00', to: occurredAt },
    relation,
    sampleCount,
    occurredAt,
    recordedAt,
    audit: { actorId: 'ACCT-001', action: 'register-monitoring-batch', recordedAt },
  };
}

function dailyPoints(
  values: readonly (number | null)[],
  ingestedAt: string,
): readonly MonitoringSamplePointFixture[] {
  return values.map((value, index) => {
    const day = String(21 + index).padStart(2, '0');
    const sampledAt = `2026-08-${day}T08:00:00+08:00`;
    if (value === null) {
      return { sampledAt, ingestedAt, value: null, status: 'missing' as const, reasonCode: 'FIELD_GAP' };
    }
    return { sampledAt, ingestedAt, value, status: 'available' as const };
  });
}

function featureSet(
  slope: number | undefined,
  acceleration: number | undefined,
  frequency: number | undefined,
  anomaly: number | undefined,
  slopeUnit: string,
): readonly MonitoringFeatureFixture[] {
  const make = (
    featureType: MonitoringFeatureFixture['featureType'],
    value: number | undefined,
    unit: string | undefined,
    windowSize: number,
    algorithmVersion: string,
  ): MonitoringFeatureFixture =>
    value === undefined
      ? { featureType, windowSize, inputCount: 0, algorithmVersion, status: 'unavailable', reasonCode: 'INSUFFICIENT_WINDOW' }
      : { featureType, value, unit, windowSize, inputCount: windowSize, algorithmVersion, status: 'available' };
  return [
    make('short-term-slope', slope, slopeUnit, 3, 'algo-slope-v1.2'),
    make('acceleration', acceleration, slopeUnit === undefined ? undefined : `${slopeUnit}/d`, 4, 'algo-accel-v1.1'),
    make('dominant-frequency', frequency, 'Hz', 5, 'algo-freq-v1.0'),
    make('anomaly-score', anomaly, undefined, 7, 'algo-anom-v1.3'),
  ];
}

const ALGORITHM_VERSIONS = {
  alignment: 'algo-align-v1.4',
  slope: 'algo-slope-v1.2',
  acceleration: 'algo-accel-v1.1',
  frequency: 'algo-freq-v1.0',
  anomaly: 'algo-anom-v1.3',
} as const;

export const MONITORING_SERIES: readonly MonitoringSeriesFixture[] = [
  {
    seriesId: 'MON-001',
    monitoringSeriesRef: { kind: 'monitoring-series', reference: { entityId: 'MON-001', versionId: 'rev-1' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRef: SS_001_REV_2,
    monitoringObject: '变径空间扩挖段地表',
    monitoringIndicator: '地表沉降',
    parameterCode: 'SETTLE-CUM',
    canonicalUnit: 'mm',
    effectivePeriod: { validFrom: '2026-06-15T00:00:00+08:00' },
    threshold: {
      value: 12.0,
      label: '监测预警阈值 12.0 mm',
      direction: 'above',
      riskLevel: 2,
      thresholdRef: { entityId: 'THRESH-MON-001', versionId: 'v2026.08' },
    },
    availabilityPolicyRef: { entityId: 'POLICY-MON-AVL-01', versionId: 'v2026.08' },
    algorithmVersions: ALGORITHM_VERSIONS,
    latestValue: 13.6,
    latestSampledAt: '2026-08-27T08:00:00+08:00',
    latestIngestedAt: '2026-08-27T09:18:00+08:00',
    exceeded: true,
    batches: [
      batchFixture('MON-B-20260827-001', 'mon-20260827-settle', 'a3f19c2e7b4d4f8a9c0e1b2d3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d', 'DOC2026003', 'v2026.08', { kind: 'original' }, 7, '2026-08-27T08:30:00+08:00', '2026-08-27T09:18:00+08:00'),
      batchFixture('MON-B-20260826-001', 'mon-20260826-settle', '7d2e4f6a8b0c1d3e5f7a9b1c2d4e6f8a0b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0f', 'DOC2026003', 'v2026.08', { kind: 'original' }, 6, '2026-08-26T08:30:00+08:00', '2026-08-26T09:11:00+08:00'),
    ],
    snapshot: {
      monitoringSnapshotRef: { kind: 'monitoring-snapshot', reference: { entityId: 'SNAP-MON-001-20260827', versionId: 'v1' } },
      cutoff: '2026-08-27T09:00:00+08:00',
      availability: 'available',
      coverageRatio: 1,
      availabilityReasons: [],
      points: dailyPoints([8.2, 8.8, 9.5, 10.1, 11.0, 12.2, 13.6], '2026-08-27T09:18:00+08:00'),
      features: featureSet(2.3, 0.4, undefined, 0.86, 'mm/d'),
      evidenceReferences: [
        { sourceSegmentId: 'DOC2026003-M001-SEG021', sourceVersion: { entityId: 'DOC2026003', versionId: 'v2026.08' } },
      ],
    },
    audit: { actorId: 'ACCT-001', action: 'revise-monitoring-series', recordedAt: '2026-06-15T10:30:00+08:00', reason: '监测序列建档' },
  },
  {
    seriesId: 'MON-002',
    monitoringSeriesRef: { kind: 'monitoring-series', reference: { entityId: 'MON-002', versionId: 'rev-1' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRef: SS_001_REV_2,
    monitoringObject: '变径空间扩挖段支护结构',
    monitoringIndicator: '支护结构变形',
    parameterCode: 'SUPPORT-DEFORM',
    canonicalUnit: 'mm',
    effectivePeriod: { validFrom: '2026-06-15T00:00:00+08:00' },
    threshold: {
      value: 8.0,
      label: '监测预警阈值 8.0 mm',
      direction: 'above',
      riskLevel: 2,
      thresholdRef: { entityId: 'THRESH-MON-002', versionId: 'v2026.08' },
    },
    availabilityPolicyRef: { entityId: 'POLICY-MON-AVL-01', versionId: 'v2026.08' },
    algorithmVersions: ALGORITHM_VERSIONS,
    latestValue: 8.4,
    latestSampledAt: '2026-08-27T08:00:00+08:00',
    latestIngestedAt: '2026-08-27T09:18:00+08:00',
    exceeded: true,
    batches: [
      batchFixture('MON-B-20260827-002', 'mon-20260827-deform', 'b4e5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef01234567', 'DOC2026003', 'v2026.08', { kind: 'original' }, 7, '2026-08-27T08:30:00+08:00', '2026-08-27T09:18:00+08:00'),
    ],
    snapshot: {
      monitoringSnapshotRef: { kind: 'monitoring-snapshot', reference: { entityId: 'SNAP-MON-002-20260827', versionId: 'v1' } },
      cutoff: '2026-08-27T09:00:00+08:00',
      availability: 'available',
      coverageRatio: 1,
      availabilityReasons: [],
      points: dailyPoints([5.1, 5.6, 6.0, 6.5, 7.1, 7.8, 8.4], '2026-08-27T09:18:00+08:00'),
      features: featureSet(1.1, 0.2, undefined, 0.72, 'mm/d'),
      evidenceReferences: [
        { sourceSegmentId: 'DOC2026003-M002-SEG035', sourceVersion: { entityId: 'DOC2026003', versionId: 'v2026.08' } },
      ],
    },
    audit: { actorId: 'ACCT-001', action: 'revise-monitoring-series', recordedAt: '2026-06-15T10:31:00+08:00', reason: '监测序列建档' },
  },
  {
    seriesId: 'MON-003',
    monitoringSeriesRef: { kind: 'monitoring-series', reference: { entityId: 'MON-003', versionId: 'rev-1' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRef: SS_001_REV_2,
    monitoringObject: '变径空间扩挖段注浆系统',
    monitoringIndicator: '注浆压力',
    parameterCode: 'GROUT-PRESSURE',
    canonicalUnit: 'MPa',
    effectivePeriod: { validFrom: '2026-06-15T00:00:00+08:00' },
    threshold: {
      value: 0.2,
      label: '生效区间下限 0.20 MPa',
      direction: 'below',
      riskLevel: 3,
      thresholdRef: { entityId: 'THRESH-MON-003', versionId: 'v2026.08' },
    },
    availabilityPolicyRef: { entityId: 'POLICY-MON-AVL-01', versionId: 'v2026.08' },
    algorithmVersions: ALGORITHM_VERSIONS,
    latestValue: 0.18,
    latestSampledAt: '2026-08-27T08:00:00+08:00',
    latestIngestedAt: '2026-08-27T09:18:00+08:00',
    exceeded: true,
    batches: [
      batchFixture('MON-B-20260827-003', 'mon-20260827-grout', 'c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e', 'DOC2026003', 'v2026.08', { kind: 'original' }, 7, '2026-08-27T08:30:00+08:00', '2026-08-27T09:18:00+08:00'),
    ],
    snapshot: {
      monitoringSnapshotRef: { kind: 'monitoring-snapshot', reference: { entityId: 'SNAP-MON-003-20260827', versionId: 'v1' } },
      cutoff: '2026-08-27T09:00:00+08:00',
      availability: 'available',
      coverageRatio: 1,
      availabilityReasons: [],
      points: dailyPoints([0.23, 0.23, 0.22, 0.22, 0.21, 0.2, 0.18], '2026-08-27T09:18:00+08:00'),
      features: featureSet(-0.01, undefined, undefined, 0.64, 'MPa/d'),
      evidenceReferences: [
        { sourceSegmentId: 'DOC2026003-M003-SEG034', sourceVersion: { entityId: 'DOC2026003', versionId: 'v2026.08' } },
      ],
    },
    audit: { actorId: 'ACCT-001', action: 'revise-monitoring-series', recordedAt: '2026-06-15T10:32:00+08:00', reason: '监测序列建档' },
  },
  {
    seriesId: 'MON-004',
    monitoringSeriesRef: { kind: 'monitoring-series', reference: { entityId: 'MON-004', versionId: 'rev-1' } },
    projectRevisionRef: PROJECT_REV_2,
    spatialScopeRef: SS_001_REV_2,
    monitoringObject: '变径空间扩挖段周边地层',
    monitoringIndicator: '地下水位',
    parameterCode: 'GW-LEVEL',
    canonicalUnit: 'm',
    effectivePeriod: { validFrom: '2026-06-15T00:00:00+08:00' },
    threshold: {
      value: 4.5,
      label: '监测预警阈值 4.5 m',
      direction: 'above',
      riskLevel: 2,
      thresholdRef: { entityId: 'THRESH-MON-004', versionId: 'v2026.08' },
    },
    availabilityPolicyRef: { entityId: 'POLICY-MON-AVL-01', versionId: 'v2026.08' },
    algorithmVersions: ALGORITHM_VERSIONS,
    latestValue: 3.9,
    latestSampledAt: '2026-08-27T08:00:00+08:00',
    latestIngestedAt: '2026-08-27T09:18:00+08:00',
    exceeded: false,
    batches: [
      batchFixture('MON-B-20260827-004', 'mon-20260827-gw', 'd6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80', 'DOC2026003', 'v2026.08', { kind: 'original' }, 7, '2026-08-27T08:30:00+08:00', '2026-08-27T09:18:00+08:00'),
    ],
    snapshot: {
      monitoringSnapshotRef: { kind: 'monitoring-snapshot', reference: { entityId: 'SNAP-MON-004-20260827', versionId: 'v1' } },
      cutoff: '2026-08-27T09:00:00+08:00',
      availability: 'partial',
      coverageRatio: 0.86,
      availabilityReasons: ['FIELD_GAP'],
      points: dailyPoints([3.5, 3.6, null, 3.7, 3.8, 3.8, 3.9], '2026-08-27T09:18:00+08:00'),
      features: featureSet(0.06, undefined, undefined, 0.31, 'm/d'),
      evidenceReferences: [
        { sourceSegmentId: 'DOC2026003-M001-SEG021', sourceVersion: { entityId: 'DOC2026003', versionId: 'v2026.08' } },
      ],
    },
    audit: { actorId: 'ACCT-001', action: 'revise-monitoring-series', recordedAt: '2026-06-15T10:33:00+08:00', reason: '监测序列建档' },
  },
];

export function findMonitoringSeries(seriesId: string): MonitoringSeriesFixture | undefined {
  return MONITORING_SERIES.find((series) => series.seriesId === seriesId);
}

// ---------- 工程概览时间线（B 骨架底部业务事件时间线） ----------

export interface BusinessTimelineEvent {
  readonly time: string;
  readonly title: string;
  readonly actor: string;
  readonly ref?: { readonly label: string; readonly path: string };
}

export const PROJECT_TIMELINE: readonly BusinessTimelineEvent[] = [
  { time: '2026-03-01T09:30:00+08:00', title: '工程开通，业务上下文 rev-1 生效', actor: '张工' },
  { time: '2026-06-15T10:20:00+08:00', title: '业务上下文修订 rev-2 生效（进入变径段掘进）', actor: '张工' },
  { time: '2026-08-27T09:14:00+08:00', title: '监测数据集批次接入完成', actor: '张工', ref: { label: 'ING-20260827-001', path: '/projects/ingestion-tasks' } },
  { time: '2026-08-27T09:18:00+08:00', title: '风险识别运行完成', actor: '系统', ref: { label: 'RUN-20260827-001', path: '/identification/runs/RUN-20260827-001' } },
  { time: '2026-08-27T09:21:00+08:00', title: '风险评估运行完成', actor: '系统', ref: { label: 'RUN-A-2026-001', path: '/assessment/runs/RUN-A-2026-001' } },
  { time: '2026-08-27T09:22:00+08:00', title: '预警信息入库', actor: '系统', ref: { label: 'WARN-2026-001', path: '/warnings/WARN-2026-001' } },
];

export const PROJECT_OVERVIEW_KPIS: readonly {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly path: string;
}[] = [
  { key: 'sources', label: '资料版本', value: '5', hint: '待授权 1 份', path: '/projects/sources' },
  { key: 'monitoring', label: '监测序列', value: '4', hint: '越限 3 条', path: '/projects/monitoring' },
  { key: 'spatial', label: '空间区段', value: '2', hint: '当前修订 rev-2 / rev-1', path: '/projects/spatial-scopes' },
  { key: 'members', label: '工程成员', value: '3', hint: '在岗；另 1 人已移出', path: '/projects/members' },
  { key: 'ingestion', label: '接入任务', value: '5', hint: '失败 1 · 进行中 1', path: '/projects/ingestion-tasks' },
];
