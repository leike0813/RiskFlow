/**
 * demo 只读 operation 层：七条 C32 只读 branch 与既有 source-segments / monitoring-snapshot /
 * evidence-access / projection.query 查询，以及 C33 识别只读（run-list/run-read/record-catalog/
 * record-read）、复核队列只读（queue-read）与 decide-review 命令的请求构造与解码白名单。
 * 解码只提取契约内页面所需字段，形状漂移统一收敛为 TERMINAL_FAILURE，由浏览器验收在真实接缝上兜底。
 */
import { ApiError, submitCommand, submitQuery } from './client'

// ------------------------------------------------------------------ 解码工具

const drift = (): ApiError => new ApiError('TERMINAL_FAILURE')

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw drift()
  return value as Record<string, unknown>
}

const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw drift()
  return value
}

const asString = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) throw drift()
  return value
}

const asNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw drift()
  return value
}

const asBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw drift()
  return value
}

const asStringArray = (value: unknown): string[] => asArray(value).map(asString)

export interface VersionRef {
  readonly entityId: string
  readonly versionId: string
}

export interface KindRef {
  readonly kind: string
  readonly reference: VersionRef
}

const asVersionRef = (value: unknown): VersionRef => {
  const record = asRecord(value)
  return { entityId: asString(record.entityId), versionId: asString(record.versionId) }
}

const asKindRef = (value: unknown): KindRef => ({
  kind: asString(asRecord(value).kind),
  reference: asVersionRef(asRecord(value).reference),
})

/** 查询授权声明用的来源版本引用（C06 授权只接受 source-version 种类）。 */
const asSourceVersionRef = (ref: KindRef | VersionRef): unknown => ({
  kind: 'source-version',
  reference: 'reference' in ref ? ref.reference : ref,
})

// ------------------------------------------------------------------ 共享领域形状

export interface EvidenceReferenceView {
  readonly sourceSegmentId: string
  readonly sourceVersionRef: VersionRef
}

const asEvidenceReference = (value: unknown): EvidenceReferenceView => {
  const record = asRecord(value)
  const locator = asRecord(record.locator)
  return {
    sourceSegmentId: asString(locator.sourceSegmentId),
    sourceVersionRef: asVersionRef(record.sourceVersion),
  }
}

const asEvidenceList = (value: unknown): EvidenceReferenceView[] =>
  asArray(value).map(asEvidenceReference)

export interface ApplicabilityView {
  readonly constructionMethod: string[]
  readonly stratumCondition: string[]
  readonly engineeringStage: string[]
}

/** 适用性元数据快照三维度：单值（规则集冻结口径），与条件数组（机理/规则）区分。 */
export interface ApplicabilityMetadataView {
  readonly constructionMethod: string
  readonly stratumCondition: string
  readonly engineeringStage: string
}

const asApplicabilityMetadata = (value: unknown): ApplicabilityMetadataView => {
  const record = asRecord(value)
  return {
    constructionMethod: asString(record.constructionMethod),
    stratumCondition: asString(record.stratumCondition),
    engineeringStage: asString(record.engineeringStage),
  }
}

const asApplicability = (value: unknown): ApplicabilityView => {
  const record = asRecord(value)
  return {
    constructionMethod: asStringArray(record.constructionMethod),
    stratumCondition: asStringArray(record.stratumCondition),
    engineeringStage: asStringArray(record.engineeringStage),
  }
}

// ------------------------------------------------------------------ 工程上下文（context-read）

export interface SpatialScopeNodeView {
  readonly spatialScopeRef: KindRef
  readonly parentSpatialScopeRef?: KindRef
  readonly name: string
  readonly worksiteLocation?: string
}

export interface EngineeringContextView {
  readonly projectId: string
  readonly contextStatus: 'preparing' | 'active'
  readonly currentProjectRevisionRef?: KindRef
  readonly applicabilityMetadata?: Record<string, unknown>
  readonly missingApplicabilityDimensions: string[]
  readonly spatialScopes: SpatialScopeNodeView[]
}

export const readEngineeringContext = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<EngineeringContextView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.context-read',
      payload: {},
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'context-read') throw drift()
  const status = asString(result.contextStatus)
  if (status !== 'preparing' && status !== 'active') throw drift()
  return {
    projectId: asString(result.projectId),
    contextStatus: status,
    ...(result.currentProjectRevisionRef === undefined
      ? {}
      : { currentProjectRevisionRef: asKindRef(result.currentProjectRevisionRef) }),
    ...(result.applicabilityMetadata === undefined
      ? {}
      : { applicabilityMetadata: asRecord(result.applicabilityMetadata) }),
    missingApplicabilityDimensions: asStringArray(result.missingApplicabilityDimensions),
    spatialScopes: asArray(result.spatialScopes).map((node) => {
      const record = asRecord(node)
      return {
        spatialScopeRef: asKindRef(record.spatialScopeRef),
        ...(record.parentSpatialScopeRef === undefined
          ? {}
          : { parentSpatialScopeRef: asKindRef(record.parentSpatialScopeRef) }),
        name: asString(record.name),
        ...(record.worksiteLocation === undefined
          ? {}
          : { worksiteLocation: asString(record.worksiteLocation) }),
      }
    }),
  }
}

// ------------------------------------------------------------------ 资料目录（source-catalog）

export type SourceParseStatus = 'registered' | 'processing' | 'parsed' | 'failed'
export type CleaningAvailability = 'available' | 'partial' | 'unavailable'

export interface SourceCatalogItemView {
  readonly sourceVersionRef: KindRef
  readonly sourceId: string
  readonly documentType?: string
  readonly formedAt?: string
  readonly sourceOrganization?: string
  readonly externalVersion?: string
  readonly parseStatus: SourceParseStatus
  readonly cleaningAvailability?: CleaningAvailability
  readonly cleaningExclusionCount?: number
  readonly sourceSegmentSetRef?: KindRef
}

export interface SourceCatalogPageView {
  readonly items: SourceCatalogItemView[]
  readonly totalCount: number
  readonly nextCursor?: string
}

export const listSourceCatalog = async (
  projectId: string,
  options: { readonly cursor?: string; readonly documentType?: string } = {},
  signal?: AbortSignal,
): Promise<SourceCatalogPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.source-catalog',
      payload: {
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        pageSize: 50,
        ...(options.documentType === undefined ? {} : { documentType: options.documentType }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'source-catalog') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        sourceVersionRef: asKindRef(record.sourceVersionRef),
        sourceId: asString(record.sourceId),
        ...(record.documentType === undefined
          ? {}
          : { documentType: asString(record.documentType) }),
        ...(record.formedAt === undefined ? {} : { formedAt: asString(record.formedAt) }),
        ...(record.sourceOrganization === undefined
          ? {}
          : { sourceOrganization: asString(record.sourceOrganization) }),
        ...(record.externalVersion === undefined
          ? {}
          : { externalVersion: asString(record.externalVersion) }),
        parseStatus: asString(record.parseStatus) as SourceParseStatus,
        ...(record.cleaningAvailability === undefined
          ? {}
          : { cleaningAvailability: asString(record.cleaningAvailability) as CleaningAvailability }),
        ...(record.cleaningExclusionCount === undefined
          ? {}
          : { cleaningExclusionCount: asNumber(record.cleaningExclusionCount) }),
        ...(record.sourceSegmentSetRef === undefined
          ? {}
          : { sourceSegmentSetRef: asKindRef(record.sourceSegmentSetRef) }),
      }
    }),
    totalCount: asNumber(result.totalCount),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

// ------------------------------------------------------------------ 监测目录（monitoring-catalog）

export interface MonitoringSeriesItemView {
  readonly monitoringSeriesRef: KindRef
  readonly monitoringIndicator: string
  readonly monitoringObject: string
  readonly canonicalUnit: string
  readonly spatialScopeRef: KindRef
  readonly batchCount: number
  readonly latestSnapshotRef?: KindRef
}

export interface MonitoringSeriesPageView {
  readonly items: MonitoringSeriesItemView[]
  readonly totalCount: number
  readonly nextCursor?: string
}

export interface MonitoringBatchView {
  readonly monitoringBatchRef: KindRef
  readonly relation: 'original' | 'correction' | 'supplement'
  readonly window: { readonly from: string; readonly to: string }
  readonly sampleCount: number
  readonly occurredAt: string
}

export interface MonitoringSnapshotEntryView {
  readonly monitoringSnapshotRef: KindRef
  readonly cutoff: string
  readonly availability: CleaningAvailability
  readonly coverageRatio: number
  readonly evidenceSourceVersionRefs: KindRef[]
}

export interface MonitoringSeriesDetailView {
  readonly monitoringSeriesRef: KindRef
  readonly batches: MonitoringBatchView[]
  readonly snapshots: MonitoringSnapshotEntryView[]
  readonly nextCursor?: string
}

export const listMonitoringSeries = async (
  projectId: string,
  options: { readonly cursor?: string } = {},
  signal?: AbortSignal,
): Promise<MonitoringSeriesPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.monitoring-catalog',
      payload: {
        pageSize: 50,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'monitoring-series-list') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        monitoringSeriesRef: asKindRef(record.monitoringSeriesRef),
        monitoringIndicator: asString(record.monitoringIndicator),
        monitoringObject: asString(record.monitoringObject),
        canonicalUnit: asString(record.canonicalUnit),
        spatialScopeRef: asKindRef(record.spatialScopeRef),
        batchCount: asNumber(record.batchCount),
        ...(record.latestSnapshotRef === undefined
          ? {}
          : { latestSnapshotRef: asKindRef(record.latestSnapshotRef) }),
      }
    }),
    totalCount: asNumber(result.totalCount),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export const readMonitoringSeriesDetail = async (
  projectId: string,
  monitoringSeriesRef: KindRef,
  signal?: AbortSignal,
): Promise<MonitoringSeriesDetailView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.monitoring-catalog',
      payload: { monitoringSeriesRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'monitoring-series-detail') throw drift()
  return {
    monitoringSeriesRef: asKindRef(result.monitoringSeriesRef),
    batches: asArray(result.batches).map((batch) => {
      const record = asRecord(batch)
      const window = asRecord(record.window)
      return {
        monitoringBatchRef: asKindRef(record.monitoringBatchRef),
        relation: asString(record.relation) as MonitoringBatchView['relation'],
        window: { from: asString(window.from), to: asString(window.to) },
        sampleCount: asNumber(record.sampleCount),
        occurredAt: asString(record.occurredAt),
      }
    }),
    snapshots: asArray(result.snapshots).map((snapshot) => {
      const record = asRecord(snapshot)
      return {
        monitoringSnapshotRef: asKindRef(record.monitoringSnapshotRef),
        cutoff: asString(record.cutoff),
        availability: asString(record.availability) as CleaningAvailability,
        coverageRatio: asNumber(record.coverageRatio),
        evidenceSourceVersionRefs: asArray(record.evidenceSourceVersionRefs).map(asKindRef),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

// ------------------------------------------------------------------ 既有登记查询 + 结果再读取（read-result）

export interface QueryResultRefView {
  readonly kind: 'query-result'
  readonly reference: VersionRef
}

const asQueryResultRef = (value: unknown): QueryResultRefView => {
  const ref = asKindRef(value)
  if (ref.kind !== 'query-result') throw drift()
  return { kind: 'query-result', reference: ref.reference }
}

/** 既有登记查询：提交后只回引用，正文经 engineering-data.read-result 再读取。 */
const registerEngineeringQuery = async (
  projectId: string,
  branch: 'engineering-data.source-segments' | 'engineering-data.monitoring-snapshot-query' | 'engineering-data.evidence-access',
  payload: Record<string, unknown>,
  sourceVersionRefs: readonly (KindRef | VersionRef)[],
  signal?: AbortSignal,
): Promise<QueryResultRefView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch,
      payload,
      sourceVersionRefs: sourceVersionRefs.map(asSourceVersionRef),
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return asQueryResultRef(result.queryResultRef)
}

export interface SourceSegmentView {
  readonly sourceSegmentId: string
  readonly chapterId: string
  readonly segmentId: string
  readonly kind: 'chapter' | 'table' | 'monitoring-window'
  readonly headingPath: string[]
}

export interface SourceSegmentSetView {
  readonly sourceSegmentSetRef: KindRef
  readonly sourceVersionRef: KindRef
  readonly sourceId: string
  readonly segments: SourceSegmentView[]
  readonly recordedAt: string
  readonly sourceAccessGrantRef: KindRef
}

const asLocatorHeadingPath = (value: unknown): string[] => {
  const record = asRecord(value)
  if (record.kind === 'document') return asStringArray(record.headingPath)
  if (record.kind === 'table') return [asString(record.sheet), asString(record.table)]
  if (record.kind === 'record') return [asString(record.dataset), asString(record.stableRecordKey)]
  if (record.kind === 'time-window') {
    const window = asRecord(value)
    return [`${asString(window.from)} ~ ${asString(window.to)}`]
  }
  throw drift()
}

const asSegment = (value: unknown): SourceSegmentView => {
  const record = asRecord(value)
  return {
    sourceSegmentId: asString(record.sourceSegmentId),
    chapterId: asString(record.chapterId),
    segmentId: asString(record.segmentId),
    kind: asString(record.kind) as SourceSegmentView['kind'],
    headingPath: asLocatorHeadingPath(record.locator),
  }
}

/** 资料段集读取：登记 source-segments 查询后经 read-result 取回段结构定位（无段正文）。 */
export const readSourceSegments = async (
  projectId: string,
  sourceSegmentSetRef: KindRef,
  sourceVersionRef: KindRef,
  signal?: AbortSignal,
): Promise<SourceSegmentSetView> => {
  const queryResultRef = await registerEngineeringQuery(
    projectId,
    'engineering-data.source-segments',
    { sourceSegmentSetRef },
    [sourceVersionRef],
    signal,
  )
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.read-result',
      payload: { queryResultRef },
      sourceVersionRefs: [asSourceVersionRef(sourceVersionRef)],
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'read-result') throw drift()
  const inner = asRecord(result.result)
  if (inner.kind !== 'source-segments') throw drift()
  const segmentSet = asRecord(inner.segmentSet)
  return {
    sourceSegmentSetRef: asKindRef(segmentSet.sourceSegmentSetRef),
    sourceVersionRef: asKindRef(segmentSet.sourceVersionRef),
    sourceId: asString(segmentSet.sourceId),
    segments: asArray(segmentSet.segments).map(asSegment),
    recordedAt: asString(segmentSet.recordedAt),
    sourceAccessGrantRef: asKindRef(inner.sourceAccessGrantRef),
  }
}

/**
 * 段标识来源定位：沿资料目录与段集读取把段标识映射回来源版本；失败降级为空映射
 * （调用方只显定位摘要，不发起替代取数）。识别详情与证据追溯页共用。
 */
export const locateSegmentSources = async (
  projectId: string,
  segmentIds: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, VersionRef>> => {
  const found = new Map<string, VersionRef>()
  const needed = new Set(segmentIds)
  if (needed.size === 0) return found
  try {
    const catalog = await listSourceCatalog(projectId, {}, signal)
    for (const item of catalog.items) {
      if (item.sourceSegmentSetRef === undefined) continue
      const segmentSet = await readSourceSegments(
        projectId,
        item.sourceSegmentSetRef,
        item.sourceVersionRef,
        signal,
      )
      for (const segment of segmentSet.segments) {
        if (needed.has(segment.sourceSegmentId) && !found.has(segment.sourceSegmentId)) {
          found.set(segment.sourceSegmentId, item.sourceVersionRef.reference)
        }
      }
      if (found.size === needed.size) break
    }
  } catch {
    // 目录/段集不可读时降级：段节点仅呈现定位摘要，不发起替代取数。
  }
  return found
}

export interface EvidenceAccessItemView {
  readonly evidenceReference: EvidenceReferenceView
  readonly sourceVersionRef: KindRef
  readonly sourceSegmentSetRef: KindRef
  readonly sourceAccessGrantRef: KindRef
  readonly segment: SourceSegmentView
}

/** 证据定位读取：登记 evidence-access 查询后经 read-result 取回定位项（不含段正文原文）。 */
export const readEvidenceAccess = async (
  projectId: string,
  evidenceReferences: readonly { sourceSegmentId: string; sourceVersionRef: VersionRef }[],
  signal?: AbortSignal,
): Promise<EvidenceAccessItemView[]> => {
  const queryResultRef = await registerEngineeringQuery(
    projectId,
    'engineering-data.evidence-access',
    {
      evidenceReferences: evidenceReferences.map((reference) => ({
        locator: { sourceSegmentId: reference.sourceSegmentId },
        sourceVersion: reference.sourceVersionRef,
      })),
      purposeCode: 'demo-evidence-drawer',
    },
    evidenceReferences.map((reference) => reference.sourceVersionRef),
    signal,
  )
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.read-result',
      payload: { queryResultRef },
      sourceVersionRefs: evidenceReferences.map((reference) =>
        asSourceVersionRef(reference.sourceVersionRef),
      ),
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'read-result') throw drift()
  const inner = asRecord(result.result)
  if (inner.kind !== 'evidence-access') throw drift()
  return asArray(inner.items).map((item) => {
    const record = asRecord(item)
    return {
      evidenceReference: asEvidenceReference(record.evidenceReference),
      sourceVersionRef: asKindRef(record.sourceVersionRef),
      sourceSegmentSetRef: asKindRef(record.sourceSegmentSetRef),
      sourceAccessGrantRef: asKindRef(record.sourceAccessGrantRef),
      segment: asSegment(record.segment),
    }
  })
}

export interface MonitoringFeatureView {
  readonly featureType: string
  readonly value?: number
  readonly unit?: string
  readonly status: 'available' | 'unavailable'
  readonly reasonCode?: string
}

export interface MonitoringAlignedPointView {
  readonly sampledAt: string
  readonly value: number | null
  readonly unit: string
  readonly status: 'available' | 'interpolated' | 'missing'
}

export interface MonitoringSnapshotView {
  readonly monitoringSnapshotRef: KindRef
  readonly monitoringSeriesRef: KindRef
  readonly cutoff: string
  readonly recordedAt: string
  readonly window: { readonly from: string; readonly to: string }
  readonly availability: CleaningAvailability
  readonly coverageRatio: number
  readonly availabilityReasons: string[]
  readonly alignedPoints: MonitoringAlignedPointView[]
  readonly features: {
    readonly shortTermSlope: MonitoringFeatureView
    readonly acceleration: MonitoringFeatureView
    readonly dominantFrequency: MonitoringFeatureView
    readonly anomalyScore: MonitoringFeatureView
  }
  readonly monitoringBatchRefs: KindRef[]
  readonly evidenceReferences: EvidenceReferenceView[]
}

const asFeature = (value: unknown): MonitoringFeatureView => {
  const record = asRecord(value)
  return {
    featureType: asString(record.featureType),
    ...(record.value === undefined ? {} : { value: asNumber(record.value) }),
    ...(record.unit === undefined ? {} : { unit: asString(record.unit) }),
    status: asString(record.status) as MonitoringFeatureView['status'],
    ...(record.reasonCode === undefined ? {} : { reasonCode: asString(record.reasonCode) }),
  }
}

/** 监测快照读取：登记 monitoring-snapshot 查询后经 read-result 取回冻结快照载荷。 */
export const readMonitoringSnapshot = async (
  projectId: string,
  monitoringSnapshotRef: KindRef,
  sourceVersionRefs: readonly KindRef[],
  signal?: AbortSignal,
): Promise<MonitoringSnapshotView> => {
  const queryResultRef = await registerEngineeringQuery(
    projectId,
    'engineering-data.monitoring-snapshot-query',
    { monitoringSnapshotRef },
    sourceVersionRefs,
    signal,
  )
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'engineering-data.read-result',
      payload: { queryResultRef },
      sourceVersionRefs: sourceVersionRefs.map(asSourceVersionRef),
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'read-result') throw drift()
  const inner = asRecord(result.result)
  if (inner.kind !== 'monitoring-snapshot') throw drift()
  const snapshot = asRecord(inner.snapshot)
  const window = asRecord(snapshot.window)
  const features = asRecord(snapshot.features)
  return {
    monitoringSnapshotRef: asKindRef(snapshot.monitoringSnapshotRef),
    monitoringSeriesRef: asKindRef(snapshot.monitoringSeriesRef),
    cutoff: asString(snapshot.cutoff),
    recordedAt: asString(snapshot.recordedAt),
    window: { from: asString(window.from), to: asString(window.to) },
    availability: asString(snapshot.availability) as CleaningAvailability,
    coverageRatio: asNumber(snapshot.coverageRatio),
    availabilityReasons: asStringArray(snapshot.availabilityReasons),
    alignedPoints: asArray(snapshot.alignedPoints).map((point) => {
      const record = asRecord(point)
      return {
        sampledAt: asString(record.sampledAt),
        value: record.value === null ? null : asNumber(record.value),
        unit: asString(record.unit),
        status: asString(record.status) as MonitoringAlignedPointView['status'],
      }
    }),
    features: {
      shortTermSlope: asFeature(features.shortTermSlope),
      acceleration: asFeature(features.acceleration),
      dominantFrequency: asFeature(features.dominantFrequency),
      anomalyScore: asFeature(features.anomalyScore),
    },
    monitoringBatchRefs: asArray(snapshot.monitoringBatchRefs).map(asKindRef),
    evidenceReferences: asEvidenceList(snapshot.evidenceReferences),
  }
}

// ------------------------------------------------------------------ 知识治理（governance-read）

export type KnowledgeDefinitionType =
  | 'process-model'
  | 'risk-mechanism'
  | 'standard-library'
  | 'case-library'
  | 'structured-scoring-rule'
  | 'applicable-rule-set'
  | 'risk-matrix'
  | 'measure-library'
  | string

export type GovernanceLifecycleStatus = 'draft' | 'in-review' | 'published' | 'deactivated'

export interface GovernanceListItemView {
  readonly definitionRef: KindRef
  readonly definitionType: string
  readonly lifecycleStatus: GovernanceLifecycleStatus
  readonly currentRevisionRef?: KindRef
  readonly currentReleaseRef?: KindRef
  readonly updatedAt: string
}

export interface GovernanceListPageView {
  readonly items: GovernanceListItemView[]
  readonly totalCount: number
  readonly nextCursor?: string
}

export const listKnowledgeDefinitions = async (
  projectId: string,
  options: {
    readonly definitionType: string
    readonly lifecycleStatus?: GovernanceLifecycleStatus
    readonly keyword?: string
    readonly cursor?: string
  },
  signal?: AbortSignal,
): Promise<GovernanceListPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'knowledge-modeling.governance-read',
      payload: {
        operation: 'list-definitions',
        definitionType: options.definitionType,
        ...(options.lifecycleStatus === undefined
          ? {}
          : { lifecycleStatus: options.lifecycleStatus }),
        ...(options.keyword === undefined ? {} : { keyword: options.keyword }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        pageSize: 50,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'list-definitions') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        definitionRef: asKindRef(record.definitionRef),
        definitionType: asString(record.definitionType),
        lifecycleStatus: asString(record.lifecycleStatus) as GovernanceLifecycleStatus,
        ...(record.currentRevisionRef === undefined
          ? {}
          : { currentRevisionRef: asKindRef(record.currentRevisionRef) }),
        ...(record.currentReleaseRef === undefined
          ? {}
          : { currentReleaseRef: asKindRef(record.currentReleaseRef) }),
        updatedAt: asString(record.updatedAt),
      }
    }),
    totalCount: asNumber(result.totalCount),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

/** 治理正文按定义类型解码为类型化白名单（只取页面所需契约字段）。 */
export interface ProcessModelNodeView {
  readonly nodeId: string
  readonly processKind: string
  readonly inputs: string[]
  readonly outputs: string[]
  readonly equipmentRefs: string[]
  readonly structuralComponentRefs: string[]
  readonly stateParameters: string[]
  readonly monitoringIndicators: string[]
  readonly evidence: EvidenceReferenceView[]
}

export interface ProcessModelEdgeView {
  readonly edgeId: string
  readonly fromNodeId: string
  readonly toNodeId: string
  readonly relationType: string
  readonly evidence: EvidenceReferenceView[]
}

export interface MechanismView {
  readonly mechanismId: string
  readonly mechanismType: string
  readonly nodeIds: string[]
  readonly stateParameters: string[]
  readonly monitoringIndicators: string[]
  readonly applicability: ApplicabilityView
  readonly preconditions: string[]
  readonly triggeringFactors: string[]
  readonly evolutionPath: string[]
  readonly consequences: string[]
  readonly evidence: EvidenceReferenceView[]
}

export interface ScoringRuleView {
  readonly ruleId: string
  readonly indicatorItem: string
  readonly applicability: ApplicabilityView
  readonly ruleVersion: VersionRef
  readonly reviewStatus: string
}

export interface ScoringRuleMemberView {
  readonly rule: ScoringRuleView
  readonly sourceVersionRef: VersionRef
  readonly evidenceReferences: EvidenceReferenceView[]
}

export interface RuleSetMemberView {
  readonly ruleId: string
  readonly ruleVersion: string
  readonly releaseRef?: KindRef
  readonly revisionRef?: KindRef
}

export interface RuleSetDecisionView {
  readonly ruleId: string
  readonly ruleVersion: string
  readonly decision: string
  readonly reasonCode: string
  readonly matchedDimensions: string[]
}

export interface MatrixBandView {
  readonly bandId: string
  readonly lower: string
  readonly upper: string
}

export interface RiskMatrixView {
  readonly matrixId: string
  readonly matrixVersion: string
  readonly possibilityBands: MatrixBandView[]
  readonly consequenceBands: MatrixBandView[]
  readonly riskLevels: { readonly levelId: string; readonly ordinal: number }[]
  readonly cells: {
    readonly possibilityBandId: string
    readonly consequenceBandId: string
    readonly riskLevelId: string
  }[]
}

export interface MeasureView {
  readonly measureId: string
  readonly riskEventCategory: string
  readonly applicabilityConditions: { readonly dimension: string; readonly values: string[] }[]
  readonly triggerTypes: string[]
  readonly steps: { readonly stepOrdinal: number; readonly instruction: string }[]
  readonly resourceRequirements: string[]
  readonly targetIndicatorIds: string[]
  readonly evidenceRequirements: string[]
  readonly contraindications: string[]
}

export type GovernanceBodyView =
  | {
      readonly definitionType: 'process-model'
      readonly nodes: ProcessModelNodeView[]
      readonly dependencyEdges: ProcessModelEdgeView[]
    }
  | {
      readonly definitionType: 'risk-mechanism'
      readonly processModelReleaseRef: KindRef
      readonly mechanisms: MechanismView[]
    }
  | { readonly definitionType: 'structured-scoring-rule'; readonly members: ScoringRuleMemberView[] }
  | {
      readonly definitionType: 'applicable-rule-set'
      readonly applicabilitySnapshotRef: KindRef
      readonly applicability: ApplicabilityMetadataView
      readonly requiredAt: string
      readonly includedMembers: RuleSetMemberView[]
      readonly decisions: RuleSetDecisionView[]
    }
  | { readonly definitionType: 'risk-matrix'; readonly matrix: RiskMatrixView }
  | { readonly definitionType: 'measure-library'; readonly measures: MeasureView[] }

const asNodeView = (value: unknown): ProcessModelNodeView => {
  const record = asRecord(value)
  return {
    nodeId: asString(record.nodeId),
    processKind: asString(record.processKind),
    inputs: asStringArray(record.inputs),
    outputs: asStringArray(record.outputs),
    equipmentRefs: asStringArray(record.equipmentRefs),
    structuralComponentRefs: asStringArray(record.structuralComponentRefs),
    stateParameters: asStringArray(record.stateParameters),
    monitoringIndicators: asStringArray(record.monitoringIndicators),
    evidence: asEvidenceList(record.evidence),
  }
}

const asEdgeView = (value: unknown): ProcessModelEdgeView => {
  const record = asRecord(value)
  return {
    edgeId: asString(record.edgeId),
    fromNodeId: asString(record.fromNodeId),
    toNodeId: asString(record.toNodeId),
    relationType: asString(record.relationType),
    evidence: asEvidenceList(record.evidence),
  }
}

const asMechanismView = (value: unknown): MechanismView => {
  const record = asRecord(value)
  return {
    mechanismId: asString(record.mechanismId),
    mechanismType: asString(record.mechanismType),
    nodeIds: asStringArray(record.nodeIds),
    stateParameters: asStringArray(record.stateParameters),
    monitoringIndicators: asStringArray(record.monitoringIndicators),
    applicability: asApplicability(record.applicability),
    preconditions: asStringArray(record.preconditions),
    triggeringFactors: asStringArray(record.triggeringFactors),
    evolutionPath: asStringArray(record.evolutionPath),
    consequences: asStringArray(record.consequences),
    evidence: asEvidenceList(record.evidence),
  }
}

const asScoringRuleMember = (value: unknown): ScoringRuleMemberView => {
  const record = asRecord(value)
  const rule = asRecord(record.rule)
  const binding = asRecord(record.binding)
  return {
    rule: {
      ruleId: asString(rule.ruleId),
      indicatorItem: asString(rule.indicatorItem),
      applicability: asApplicability(rule.applicabilityConditions),
      ruleVersion: asVersionRef(rule.ruleVersion),
      reviewStatus: asString(rule.reviewStatus),
    },
    sourceVersionRef: asVersionRef(asRecord(binding.sourceVersionRef).reference),
    evidenceReferences: asEvidenceList(binding.evidenceReferences),
  }
}

const asRuleSetMember = (value: unknown): RuleSetMemberView => {
  const record = asRecord(value)
  return {
    ruleId: asString(record.ruleId),
    ruleVersion: asString(asRecord(record.ruleVersion).versionId),
    ...(record.releaseRef === undefined ? {} : { releaseRef: asKindRef(record.releaseRef) }),
    ...(record.revisionRef === undefined ? {} : { revisionRef: asKindRef(record.revisionRef) }),
  }
}

const asRuleSetDecision = (value: unknown): RuleSetDecisionView => {
  const record = asRecord(value)
  return {
    ruleId: asString(record.ruleId),
    ruleVersion: asString(asRecord(record.ruleVersion).versionId),
    decision: asString(record.decision),
    reasonCode: asString(record.reasonCode),
    matchedDimensions: asStringArray(record.matchedDimensions),
  }
}

const asBand = (value: unknown): MatrixBandView => {
  const record = asRecord(value)
  return {
    bandId: asString(record.bandId),
    lower: asString(record.lower),
    upper: asString(record.upper),
  }
}

const asMeasureView = (value: unknown): MeasureView => {
  const record = asRecord(value)
  return {
    measureId: asString(record.measureId),
    riskEventCategory: asString(record.riskEventCategory),
    applicabilityConditions: asArray(record.applicabilityConditions).map((condition) => {
      const entry = asRecord(condition)
      return { dimension: asString(entry.dimension), values: asStringArray(entry.values) }
    }),
    triggerTypes: asStringArray(record.triggerTypes),
    steps: asArray(record.steps).map((step) => {
      const entry = asRecord(step)
      return { stepOrdinal: asNumber(entry.stepOrdinal), instruction: asString(entry.instruction) }
    }),
    resourceRequirements: asStringArray(record.resourceRequirements),
    targetIndicatorIds: asStringArray(record.targetIndicatorIds),
    evidenceRequirements: asStringArray(record.evidenceRequirements),
    contraindications: asStringArray(record.contraindications),
  }
}

const asGovernanceBody = (value: unknown): GovernanceBodyView => {
  const record = asRecord(value)
  switch (record.definitionType) {
    case 'process-model':
      return {
        definitionType: 'process-model',
        nodes: asArray(record.nodes).map(asNodeView),
        dependencyEdges: asArray(record.dependencyEdges).map(asEdgeView),
      }
    case 'risk-mechanism':
      return {
        definitionType: 'risk-mechanism',
        processModelReleaseRef: asKindRef(record.processModelReleaseRef),
        mechanisms: asArray(record.mechanisms).map(asMechanismView),
      }
    case 'structured-scoring-rule':
      return {
        definitionType: 'structured-scoring-rule',
        members: asArray(record.members).map(asScoringRuleMember),
      }
    case 'applicable-rule-set':
      return {
        definitionType: 'applicable-rule-set',
        applicabilitySnapshotRef: asKindRef(record.applicabilitySnapshotRef),
        applicability: asApplicabilityMetadata(record.applicability),
        requiredAt: asString(record.requiredAt),
        includedMembers: asArray(record.includedMembers).map(asRuleSetMember),
        decisions: asArray(record.decisions).map(asRuleSetDecision),
      }
    case 'risk-matrix': {
      const possibilityAxis = asRecord(record.possibilityAxis)
      const consequenceAxis = asRecord(record.consequenceAxis)
      return {
        definitionType: 'risk-matrix',
        matrix: {
          matrixId: asString(record.matrixId),
          matrixVersion: asString(record.matrixVersion),
          possibilityBands: asArray(possibilityAxis.bands).map(asBand),
          consequenceBands: asArray(consequenceAxis.bands).map(asBand),
          riskLevels: asArray(record.riskLevels).map((level) => {
            const entry = asRecord(level)
            return { levelId: asString(entry.levelId), ordinal: asNumber(entry.ordinal) }
          }),
          cells: asArray(record.cells).map((cell) => {
            const entry = asRecord(cell)
            return {
              possibilityBandId: asString(entry.possibilityBandId),
              consequenceBandId: asString(entry.consequenceBandId),
              riskLevelId: asString(entry.riskLevelId),
            }
          }),
        },
      }
    }
    case 'measure-library':
      return {
        definitionType: 'measure-library',
        measures: asArray(record.measures).map(asMeasureView),
      }
    default:
      throw drift()
  }
}

export interface GovernanceRevisionView {
  readonly revisionRef: KindRef
  readonly definitionRef: KindRef
  readonly definitionType: string
  readonly revisionStatus: string
  readonly evidenceReferences: EvidenceReferenceView[]
  readonly body: GovernanceBodyView
}

export interface GovernanceReleaseView {
  readonly releaseRef: KindRef
  readonly definitionRef: KindRef
  readonly definitionType: string
  readonly revisionRef: KindRef
  readonly effectiveFrom: string
  readonly deactivatedAt?: string
  readonly evidenceReferences: EvidenceReferenceView[]
  readonly body: GovernanceBodyView
}

export const readKnowledgeRevision = async (
  projectId: string,
  knowledgeRevisionRef: KindRef,
  signal?: AbortSignal,
): Promise<GovernanceRevisionView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'knowledge-modeling.governance-read',
      payload: { operation: 'read-definition-revision', knowledgeRevisionRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'read-definition-revision') throw drift()
  return {
    revisionRef: asKindRef(result.revisionRef),
    definitionRef: asKindRef(result.definitionRef),
    definitionType: asString(result.definitionType),
    revisionStatus: asString(result.revisionStatus),
    evidenceReferences: asEvidenceList(result.evidenceReferences),
    body: asGovernanceBody(result.body),
  }
}

export const readKnowledgeRelease = async (
  projectId: string,
  knowledgeReleaseRef: KindRef,
  signal?: AbortSignal,
): Promise<GovernanceReleaseView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'knowledge-modeling.governance-read',
      payload: { operation: 'read-definition-release', knowledgeReleaseRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'read-definition-release') throw drift()
  return {
    releaseRef: asKindRef(result.releaseRef),
    definitionRef: asKindRef(result.definitionRef),
    definitionType: asString(result.definitionType),
    revisionRef: asKindRef(result.revisionRef),
    effectiveFrom: asString(result.effectiveFrom),
    ...(result.deactivatedAt === undefined
      ? {}
      : { deactivatedAt: asString(result.deactivatedAt) }),
    evidenceReferences: asEvidenceList(result.evidenceReferences),
    body: asGovernanceBody(result.body),
  }
}

export interface ReleaseSetMemberView {
  readonly definitionType: string
  readonly releaseRef: KindRef
}

export const readCurrentReleaseSet = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<ReleaseSetMemberView[]> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'knowledge-modeling.governance-read',
      payload: { operation: 'current-release-set' },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'current-release-set') throw drift()
  return asArray(result.releases).map((member) => {
    const record = asRecord(member)
    return {
      definitionType: asString(record.definitionType),
      releaseRef: asKindRef(record.releaseRef),
    }
  })
}

// ------------------------------------------------------------------ 检索结果再读取（retrieval-result）

export interface RetrievalHitView {
  readonly rank: number
  readonly memberRef: KindRef
  readonly sourceKind: string
  readonly sourceReleaseRef: KindRef
  readonly sourceEntryId: string
  readonly denseContribution: number
  readonly bm25Contribution: number
  readonly fusionScore: number
  readonly evidenceSourceVersionRefs: VersionRef[]
}

export interface RetrievalHybridView {
  readonly kind: 'hybrid-evidence'
  readonly knowledgeQueryResultRef: KindRef
  readonly policyRef: VersionRef
  readonly generationRef: KindRef
  readonly topK: number
  readonly hits: RetrievalHitView[]
}

export interface RetrievalRelationshipView {
  readonly kind: 'relationship-context'
  readonly knowledgeQueryResultRef: KindRef
  readonly nodeId: string
  readonly currentNode: Record<string, unknown>
  readonly neighborNodes: Record<string, unknown>[]
  readonly dependencyEdges: Record<string, unknown>[]
  readonly mechanisms: Record<string, unknown>[]
  readonly excludedMechanisms: { readonly mechanismId: string; readonly reasonCode: string }[]
  readonly releaseBinding: {
    readonly processModelReleaseRef: KindRef
    readonly riskMechanismReleaseRef: KindRef
    readonly retrievalEvidenceBaseReleaseRef: KindRef
  }
}

export type RetrievalResultView = RetrievalHybridView | RetrievalRelationshipView

export const readRetrievalResult = async (
  projectId: string,
  knowledgeQueryResultRef: KindRef,
  signal?: AbortSignal,
): Promise<RetrievalResultView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'knowledge-modeling.retrieval-result',
      payload: { knowledgeQueryResultRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind === 'hybrid-evidence') {
    return {
      kind: 'hybrid-evidence',
      knowledgeQueryResultRef: asKindRef(result.knowledgeQueryResultRef),
      policyRef: asVersionRef(result.policyRef),
      generationRef: asKindRef(result.generationRef),
      topK: asNumber(result.topK),
      hits: asArray(result.hits).map((hit) => {
        const record = asRecord(hit)
        return {
          rank: asNumber(record.rank),
          memberRef: asKindRef(record.memberRef),
          sourceKind: asString(record.sourceKind),
          sourceReleaseRef: asKindRef(record.sourceReleaseRef),
          sourceEntryId: asString(record.sourceEntryId),
          denseContribution: asNumber(record.denseContribution),
          bm25Contribution: asNumber(record.bm25Contribution),
          fusionScore: asNumber(record.fusionScore),
          evidenceSourceVersionRefs: asArray(record.evidenceSourceVersionRefs).map(asVersionRef),
        }
      }),
    }
  }
  if (result.kind === 'relationship-context') {
    const binding = asRecord(result.releaseBinding)
    return {
      kind: 'relationship-context',
      knowledgeQueryResultRef: asKindRef(result.knowledgeQueryResultRef),
      nodeId: asString(result.nodeId),
      currentNode: asRecord(result.currentNode),
      neighborNodes: asArray(result.neighborNodes).map(asRecord),
      dependencyEdges: asArray(result.dependencyEdges).map(asRecord),
      mechanisms: asArray(result.mechanisms).map(asRecord),
      excludedMechanisms: asArray(result.excludedMechanisms).map((excluded) => {
        const record = asRecord(excluded)
        return {
          mechanismId: asString(record.mechanismId),
          reasonCode: asString(record.reasonCode),
        }
      }),
      releaseBinding: {
        processModelReleaseRef: asKindRef(binding.processModelReleaseRef),
        riskMechanismReleaseRef: asKindRef(binding.riskMechanismReleaseRef),
        retrievalEvidenceBaseReleaseRef: asKindRef(binding.retrievalEvidenceBaseReleaseRef),
      },
    }
  }
  throw drift()
}

// ------------------------------------------------------------------ 投影结果读取（projection.query + projection.result-read）

export interface ProjectionItemView {
  readonly kind: string
  readonly [key: string]: unknown
}

export interface ProjectionPageView {
  readonly queryType: string
  readonly items: ProjectionItemView[]
  readonly nextCursor?: string
}

/** 主体投影两段读：登记 projection.query 后经 projection.result-read 分页读取。 */
const readProjectionSubjectPage = async (
  projectId: string,
  queryType: 'trace-chain' | 'association-graph',
  subjectRef: KindRef,
  signal?: AbortSignal,
): Promise<ProjectionPageView> => {
  const registered = asRecord(
    await submitQuery({
      projectId,
      branch: 'projection.query',
      payload: { queryType, subjectRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  const queryResultRef = asQueryResultRef(registered.queryResultRef)
  const page = asRecord(
    await submitQuery({
      projectId,
      branch: 'projection.result-read',
      payload: { queryResultRef, limit: 50 },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (page.kind !== 'page') throw drift()
  return {
    queryType: asString(page.queryType),
    items: asArray(page.items).map((item) => asRecord(item) as ProjectionItemView),
    ...(page.nextCursor === undefined ? {} : { nextCursor: asString(page.nextCursor) }),
  }
}

/** 治理条目关联对象：登记 trace-chain 投影查询后经 result-read 分页读取。 */
export const readTraceChain = (
  projectId: string,
  subjectRef: KindRef,
  signal?: AbortSignal,
): Promise<ProjectionPageView> => readProjectionSubjectPage(projectId, 'trace-chain', subjectRef, signal)

/** 关联图：登记 association-graph 投影查询后经 result-read 分页读取（只消费可证明链边）。 */
export const readAssociationGraph = (
  projectId: string,
  subjectRef: KindRef,
  signal?: AbortSignal,
): Promise<ProjectionPageView> =>
  readProjectionSubjectPage(projectId, 'association-graph', subjectRef, signal)

// ------------------------------------------------------------------ C33 识别运行只读（run-list / run-read）

export interface CompositeConfidenceView {
  readonly value: number
  readonly basis: string[]
}

const asCompositeConfidence = (value: unknown): CompositeConfidenceView => {
  const record = asRecord(value)
  return { value: asNumber(record.value), basis: asStringArray(record.basis) }
}

export interface IdentificationRunListItemView {
  readonly runRef: KindRef
  readonly stage: string
  readonly status: string
  /** 仅在服务端返回登记事实时存在；缺省页面呈现「—」。 */
  readonly triggerReason?: string
  readonly startedBy: string
  readonly startedAt: string
  readonly acceptedCount: number
  readonly pendingReviewCount: number
  readonly rejectedCount: number
}

export interface IdentificationRunListPageView {
  readonly items: IdentificationRunListItemView[]
  readonly nextCursor?: string
}

export const listIdentificationRuns = async (
  projectId: string,
  options: { readonly cursor?: string; readonly status?: string } = {},
  signal?: AbortSignal,
): Promise<IdentificationRunListPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'risk-identification.run-list',
      payload: {
        pageSize: 50,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.status === undefined ? {} : { status: options.status }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'run-list') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        runRef: asKindRef(record.runRef),
        stage: asString(record.stage),
        status: asString(record.status),
        ...(record.triggerReason === undefined
          ? {}
          : { triggerReason: asString(record.triggerReason) }),
        startedBy: asString(record.startedBy),
        startedAt: asString(record.startedAt),
        acceptedCount: asNumber(record.acceptedCount),
        pendingReviewCount: asNumber(record.pendingReviewCount),
        rejectedCount: asNumber(record.rejectedCount),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export interface IdentificationRunStageEntryView {
  readonly stage: string
  readonly status: string
  readonly failureCode?: string
  readonly retryable?: boolean
}

export interface IdentificationWorkItemCoverageView {
  readonly workItemRef: KindRef
  readonly processNodeId: string
  readonly status: string
}

export interface IdentificationMergeGroupView {
  readonly groupRef: KindRef
  readonly status: string
  readonly acceptanceKind?: string
}

/** Agent 任务引用：页面只呈现身份与任务类型；提交回写时不需要其余策略引用字段。 */
export interface AgentTaskRefView {
  readonly agentTaskRef: KindRef
  readonly taskType: string
  readonly triggerMode: string
}

/** 复核任务引用：字段与契约 ReviewTaskRefV1 一一对应，可原样回构为 decide-review 命令载荷。 */
export interface ReviewTaskRefView {
  readonly reviewTaskRef: KindRef
  readonly waitingRunRef: KindRef
  readonly reviewType: string
  readonly targetRef: KindRef
}

const asAgentTaskRef = (value: unknown): AgentTaskRefView => {
  const record = asRecord(value)
  if (asString(record.kind) !== 'agent-task') throw drift()
  return {
    agentTaskRef: { kind: 'agent-task', reference: asVersionRef(record.reference) },
    taskType: asString(record.taskType),
    triggerMode: asString(record.triggerMode),
  }
}

const asReviewTaskRef = (value: unknown): ReviewTaskRefView => {
  const record = asRecord(value)
  if (asString(record.kind) !== 'review-task') throw drift()
  return {
    reviewTaskRef: { kind: 'review-task', reference: asVersionRef(record.reference) },
    waitingRunRef: asKindRef(record.waitingRunRef),
    reviewType: asString(record.reviewType),
    targetRef: asKindRef(record.targetRef),
  }
}

export interface WaitingRefView {
  readonly kind: string
  readonly ref?: KindRef
}

/** 等待引用只取种类与内嵌引用的身份；未知种类不失败（只读呈现，不据此构造命令）。 */
const asWaitingRef = (value: unknown): WaitingRefView => {
  const record = asRecord(value)
  const kind = asString(record.kind)
  const inner =
    kind === 'review'
      ? record.reviewTaskRef
      : kind === 'agent-task'
        ? record.agentTaskRef
        : kind === 'knowledge-preparation'
          ? record.knowledgePreparationTaskRef
          : kind === 'user-confirmation'
            ? record.userConfirmationRef
            : kind === 'human-decision'
              ? record.routeDecisionRef
              : undefined
  return { kind, ...(inner === undefined ? {} : { ref: asKindRef(inner) }) }
}

export interface IdentificationRunResultCountsView {
  readonly plannedWorkItemCount: number
  readonly completedWorkItemCount: number
  readonly failedWorkItemCount: number
  readonly zeroResultCount: number
  readonly acceptedCount: number
  readonly pendingReviewCount: number
  readonly rejectedCount: number
}

export interface IdentificationRunDetailView {
  readonly runRef: KindRef
  readonly stage: string
  readonly status: string
  readonly stageEntries: IdentificationRunStageEntryView[]
  readonly workItemCoverage: IdentificationWorkItemCoverageView[]
  readonly mergeGroups: IdentificationMergeGroupView[]
  readonly agentTaskRefs: AgentTaskRefView[]
  readonly reviewTaskRefs: ReviewTaskRefView[]
  readonly resultCounts: IdentificationRunResultCountsView
  readonly acceptedRiskRecordRefs: KindRef[]
  readonly pendingReviewGroupRefs: KindRef[]
  readonly rejectedGroupRefs: KindRef[]
  readonly waitingRef?: WaitingRefView
}

export const readIdentificationRun = async (
  projectId: string,
  runRef: KindRef,
  signal?: AbortSignal,
): Promise<IdentificationRunDetailView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'risk-identification.run-read',
      payload: { runRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'run-read') throw drift()
  const counts = asRecord(result.resultCounts)
  return {
    runRef: asKindRef(result.runRef),
    stage: asString(result.stage),
    status: asString(result.status),
    stageEntries: asArray(result.stageEntries).map((entry) => {
      const record = asRecord(entry)
      return {
        stage: asString(record.stage),
        status: asString(record.status),
        ...(record.failureCode === undefined
          ? {}
          : { failureCode: asString(record.failureCode) }),
        ...(record.retryable === undefined ? {} : { retryable: asBoolean(record.retryable) }),
      }
    }),
    workItemCoverage: asArray(result.workItemCoverage).map((item) => {
      const record = asRecord(item)
      return {
        workItemRef: asKindRef(record.workItemRef),
        processNodeId: asString(record.processNodeId),
        status: asString(record.status),
      }
    }),
    mergeGroups: asArray(result.mergeGroups).map((group) => {
      const record = asRecord(group)
      return {
        groupRef: asKindRef(record.groupRef),
        status: asString(record.status),
        ...(record.acceptanceKind === undefined
          ? {}
          : { acceptanceKind: asString(record.acceptanceKind) }),
      }
    }),
    agentTaskRefs: asArray(result.agentTaskRefs).map(asAgentTaskRef),
    reviewTaskRefs: asArray(result.reviewTaskRefs).map(asReviewTaskRef),
    resultCounts: {
      plannedWorkItemCount: asNumber(counts.plannedWorkItemCount),
      completedWorkItemCount: asNumber(counts.completedWorkItemCount),
      failedWorkItemCount: asNumber(counts.failedWorkItemCount),
      zeroResultCount: asNumber(counts.zeroResultCount),
      acceptedCount: asNumber(counts.acceptedCount),
      pendingReviewCount: asNumber(counts.pendingReviewCount),
      rejectedCount: asNumber(counts.rejectedCount),
    },
    acceptedRiskRecordRefs: asArray(result.acceptedRiskRecordRefs).map(asKindRef),
    pendingReviewGroupRefs: asArray(result.pendingReviewGroupRefs).map(asKindRef),
    rejectedGroupRefs: asArray(result.rejectedGroupRefs).map(asKindRef),
    ...(result.waitingRef === undefined ? {} : { waitingRef: asWaitingRef(result.waitingRef) }),
  }
}

// ------------------------------------------------------------------ C33 风险记录只读（record-catalog / record-read）

export interface RiskRecordCatalogItemView {
  readonly riskRecordRef: KindRef
  readonly processNodeId: string
  readonly riskEventSummary: string
  readonly compositeConfidence: CompositeConfidenceView
  readonly acceptanceKind: string
  readonly supersededBy?: KindRef
}

export interface RiskRecordCatalogPageView {
  readonly items: RiskRecordCatalogItemView[]
  readonly nextCursor?: string
}

export const listRiskRecords = async (
  projectId: string,
  options: {
    readonly cursor?: string
    readonly processNodeId?: string
    readonly acceptanceKind?: string
    readonly identificationRunRef?: KindRef
  } = {},
  signal?: AbortSignal,
): Promise<RiskRecordCatalogPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'risk-identification.record-catalog',
      payload: {
        pageSize: 50,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.processNodeId === undefined ? {} : { processNodeId: options.processNodeId }),
        ...(options.acceptanceKind === undefined
          ? {}
          : { acceptanceKind: options.acceptanceKind }),
        ...(options.identificationRunRef === undefined
          ? {}
          : { identificationRunRef: options.identificationRunRef }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'record-catalog') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        riskRecordRef: asKindRef(record.riskRecordRef),
        processNodeId: asString(record.processNodeId),
        riskEventSummary: asString(record.riskEventSummary),
        compositeConfidence: asCompositeConfidence(record.compositeConfidence),
        acceptanceKind: asString(record.acceptanceKind),
        ...(record.supersededBy === undefined
          ? {}
          : { supersededBy: asKindRef(record.supersededBy) }),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export interface RiskElementRelationView {
  readonly sourceElement: string
  readonly relation: string
  readonly targetElement: string
}

/** C01 七字段正文原样只读：不改写识别事实。 */
export interface RiskRecordBodyView {
  readonly processNodeId: string
  readonly riskSource: string
  readonly riskFactor: string
  readonly riskEvent: string
  readonly riskElementRelations: RiskElementRelationView[]
  readonly evidenceLocator: { readonly sourceSegmentId: string }
  readonly modelConfidence: number
}

export interface RiskRecordDetailView {
  readonly riskRecordRef: KindRef
  readonly record: RiskRecordBodyView
  readonly riskMechanismEntryIds: string[]
  readonly sourceSegmentIds: string[]
  readonly compositeConfidence: CompositeConfidenceView
  /** 验收决定引用：自动路线为 route-decision，人工路线为 review-decision。 */
  readonly acceptanceDecisionRef: KindRef
  readonly identificationRunRef: KindRef
  readonly supersededBy?: KindRef
  readonly auditTrailRef: KindRef
}

export const readRiskRecord = async (
  projectId: string,
  riskRecordRef: KindRef,
  signal?: AbortSignal,
): Promise<RiskRecordDetailView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'risk-identification.record-read',
      payload: { riskRecordRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'record-read') throw drift()
  const record = asRecord(result.record)
  const locator = asRecord(record.evidenceLocator)
  return {
    riskRecordRef: asKindRef(result.riskRecordRef),
    record: {
      processNodeId: asString(record.processNodeId),
      riskSource: asString(record.riskSource),
      riskFactor: asString(record.riskFactor),
      riskEvent: asString(record.riskEvent),
      riskElementRelations: asArray(record.riskElementRelations).map((relation) => {
        const entry = asRecord(relation)
        return {
          sourceElement: asString(entry.sourceElement),
          relation: asString(entry.relation),
          targetElement: asString(entry.targetElement),
        }
      }),
      evidenceLocator: { sourceSegmentId: asString(locator.sourceSegmentId) },
      modelConfidence: asNumber(record.modelConfidence),
    },
    riskMechanismEntryIds: asStringArray(result.riskMechanismEntryIds),
    sourceSegmentIds: asStringArray(result.sourceSegmentIds),
    compositeConfidence: asCompositeConfidence(result.compositeConfidence),
    acceptanceDecisionRef: asKindRef(result.acceptanceDecisionRef),
    identificationRunRef: asKindRef(result.identificationRunRef),
    ...(result.supersededBy === undefined ? {} : { supersededBy: asKindRef(result.supersededBy) }),
    auditTrailRef: asKindRef(result.auditTrailRef),
  }
}

// ------------------------------------------------------------------ C33 复核队列只读（queue-read）与 decide-review 命令

export interface ReviewQueueItemView {
  readonly reviewTaskRef: ReviewTaskRefView
  readonly reviewType: string
  /** 仅在服务端返回登记事实时存在；缺省页面呈现「—」。 */
  readonly triggerReason?: string
  readonly submittedAt: string
  readonly status: string
  readonly stale: boolean
}

export interface ReviewQueuePageView {
  readonly items: ReviewQueueItemView[]
  readonly nextCursor?: string
}

export const readReviewQueue = async (
  projectId: string,
  options: {
    readonly reviewType?: string
    readonly status?: string
    readonly cursor?: string
  } = {},
  signal?: AbortSignal,
): Promise<ReviewQueuePageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: 'review-audit.queue-read',
      payload: {
        pageSize: 50,
        ...(options.reviewType === undefined ? {} : { reviewType: options.reviewType }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'queue-read') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        reviewTaskRef: asReviewTaskRef(record.reviewTaskRef),
        reviewType: asString(record.reviewType),
        ...(record.triggerReason === undefined
          ? {}
          : { triggerReason: asString(record.triggerReason) }),
        submittedAt: asString(record.submittedAt),
        status: asString(record.status),
        stale: asBoolean(record.stale),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export interface ReviewDecisionSubmittedView {
  readonly reviewDecisionRef: KindRef
}

/**
 * 原样通过/拒绝：经既有 review-audit.decide-review 命令提交。decision 由调用方按复核类型
 * 构造（契约判别联合），commandId 作幂等键可重放；陈旧版本/无权由服务端失败闭合。
 */
export const submitReviewDecision = async (
  projectId: string,
  input: {
    readonly reviewTaskRef: ReviewTaskRefView
    readonly decision: Record<string, unknown>
    readonly reasonCode: string
    readonly commandId?: string
  },
  signal?: AbortSignal,
): Promise<ReviewDecisionSubmittedView> => {
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'review-audit.decide-review',
      payload: {
        reviewTaskRef: {
          kind: 'review-task',
          reference: input.reviewTaskRef.reviewTaskRef.reference,
          waitingRunRef: input.reviewTaskRef.waitingRunRef,
          reviewType: input.reviewTaskRef.reviewType,
          targetRef: input.reviewTaskRef.targetRef,
        },
        targetRef: input.reviewTaskRef.targetRef,
        decision: input.decision,
        reasonCode: input.reasonCode,
      },
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return { reviewDecisionRef: asKindRef(result.reviewDecisionRef) }
}

// ------------------------------------------------------------------ 投影类型化读取（追溯链 / 关联图 / 运行记录页）

export interface TraceLinkItemView {
  readonly fromRef: KindRef
  readonly toRef: KindRef
  readonly relation: string
  readonly evidenceLocator?: { readonly sourceSegmentId: string }
}

/** trace-link 条目白名单解码；非链边条目返回 null，形状漂移收敛为 TERMINAL_FAILURE。 */
const asTraceLinkItem = (item: ProjectionItemView): TraceLinkItemView | null => {
  if (item.kind !== 'trace-link') return null
  const locator =
    item.evidenceLocator === undefined
      ? undefined
      : { sourceSegmentId: asString(asRecord(item.evidenceLocator).sourceSegmentId) }
  return {
    fromRef: asKindRef(item.fromRef),
    toRef: asKindRef(item.toRef),
    relation: asString(item.relation),
    ...(locator === undefined ? {} : { evidenceLocator: locator }),
  }
}

/** 投影页面上限保护：越界不再续页，收敛为 TERMINAL_FAILURE 而非呈现截断结果。 */
const PROJECTION_MAX_ITEMS = 1000

/** 沿游标读尽投影条目（每页 50，服务端有界；客户端总量越界显式失败，不呈现伪完整集）。 */
const readProjectionItems = async (
  projectId: string,
  queryType: 'trace-chain' | 'association-graph' | 'risk-overview',
  firstPayload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ProjectionItemView[]> => {
  const registered = asRecord(
    await submitQuery({
      projectId,
      branch: 'projection.query',
      payload: firstPayload,
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  const queryResultRef = asQueryResultRef(registered.queryResultRef)
  const items: ProjectionItemView[] = []
  let cursor: string | undefined
  for (;;) {
    const page = asRecord(
      await submitQuery({
        projectId,
        branch: 'projection.result-read',
        payload: {
          queryResultRef,
          limit: 50,
          ...(cursor === undefined ? {} : { cursor }),
        },
        ...(signal === undefined ? {} : { signal }),
      }),
    )
    if (page.kind !== 'page' || asString(page.queryType) !== queryType) throw drift()
    items.push(...asArray(page.items).map((item) => asRecord(item) as ProjectionItemView))
    if (items.length > PROJECTION_MAX_ITEMS) throw drift()
    cursor = page.nextCursor === undefined ? undefined : asString(page.nextCursor)
    if (cursor === undefined) return items
  }
}

/** 证据追溯链：登记 trace-chain 投影查询后读尽可证明链边（类型化解码）。 */
export const readTraceChainLinks = async (
  projectId: string,
  subjectRef: KindRef,
  signal?: AbortSignal,
): Promise<TraceLinkItemView[]> =>
  (await readProjectionItems(projectId, 'trace-chain', { queryType: 'trace-chain', subjectRef }, signal)).flatMap(
    (item) => {
      const link = asTraceLinkItem(item)
      return link === null ? [] : [link]
    },
  )

/** 关联图：登记 association-graph 投影查询后读尽可证明链边（类型化解码）。 */
export const readAssociationGraphLinks = async (
  projectId: string,
  subjectRef: KindRef,
  signal?: AbortSignal,
): Promise<TraceLinkItemView[]> =>
  (
    await readProjectionItems(
      projectId,
      'association-graph',
      { queryType: 'association-graph', subjectRef },
      signal,
    )
  ).flatMap((item) => {
    const link = asTraceLinkItem(item)
    return link === null ? [] : [link]
  })

export interface RunSummaryItemView {
  readonly workflowRunRef: KindRef
  readonly parentRunRef?: KindRef
  readonly status: string
  readonly entryIdentity: VersionRef
  readonly auditTrailRef: KindRef
}

const asRunSummaryItem = (item: ProjectionItemView): RunSummaryItemView | null => {
  if (item.kind !== 'run-summary') return null
  return {
    workflowRunRef: asKindRef(item.workflowRunRef),
    ...(item.parentRunRef === undefined ? {} : { parentRunRef: asKindRef(item.parentRunRef) }),
    status: asString(item.status),
    entryIdentity: asVersionRef(item.entryIdentity),
    auditTrailRef: asKindRef(item.auditTrailRef),
  }
}

export interface RiskOverviewRunPageView {
  readonly items: readonly RunSummaryItemView[]
  readonly queryResultRef: QueryResultRefView
  readonly nextCursor?: string
}

/**
 * P-OV-01 原 C31 投影的单页读取：登记 risk-overview 投影查询后按 `limit` 取一页，
 * 原样保留 queryResultRef 与 nextCursor。页面按页推进，不读尽投影也不在页面上重新聚合。
 */
export const readRiskOverviewRunPage = async (
  projectId: string,
  projectRevisionRef: KindRef,
  input: { readonly queryResultRef?: QueryResultRefView; readonly cursor?: string; readonly limit?: number } = {},
  signal?: AbortSignal,
): Promise<RiskOverviewRunPageView> => {
  // 续页复用原 queryResultRef：重新登记会得到另一个查询身份，等于丢掉原投影口径。
  const queryResultRef =
    input.queryResultRef ??
    asQueryResultRef(
      await submitQuery({
        projectId,
        branch: 'projection.query',
        payload: { queryType: 'risk-overview', projectRevisionRef },
        ...(signal === undefined ? {} : { signal }),
      }),
    )
  const page = asRecord(
    await submitQuery({
      projectId,
      branch: 'projection.result-read',
      payload: {
        queryResultRef,
        limit: input.limit ?? 50,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (page.kind !== 'page') throw drift()
  return {
    items: asArray(page.items)
      .map((item) => asRunSummaryItem(asRecord(item) as ProjectionItemView))
      .filter((item): item is RunSummaryItemView => item !== null),
    queryResultRef,
    ...(page.nextCursor === undefined ? {} : { nextCursor: asString(page.nextCursor) }),
  }
}

/**
 * 链运行摘要（run-records 页沿用）：等价于取第一页。调用方若要按页推进请用
 * `readRiskOverviewRunPage`，本页只呈现第一页并显式说明分页口径。
 */
export const readRiskOverviewRuns = async (
  projectId: string,
  projectRevisionRef: KindRef,
  signal?: AbortSignal,
): Promise<RunSummaryItemView[]> =>
  [...(await readRiskOverviewRunPage(projectId, projectRevisionRef, {}, signal)).items]

// ============================================================================
// C34 风险评估读面（design D-04、D-05）
//
// 每个操作一个显式返回类型：页面拿到的是已解码事实，不是需要自己再判断形状的
// unknown。形状漂移统一收敛为 TERMINAL_FAILURE，页面据此进入失败态，不用半个结果渲染。
// 事实一律带精确版本，解码后不得丢弃 version。
// ============================================================================

const C34_ASSESSMENT_READ_BRANCH = 'risk-assessment.read' as const

/** 动作可用性四态：`hidden` 不渲染，`denied` 置灰，`business-unavailable` 呈现原因。 */
export type ReadActionAvailability =
  | 'allowed'
  | 'denied'
  | 'business-unavailable'
  | 'hidden'

const READ_ACTION_AVAILABILITIES: readonly ReadActionAvailability[] = [
  'allowed',
  'denied',
  'business-unavailable',
  'hidden',
]

export interface ReadActionView {
  readonly branch: string
  readonly availability: ReadActionAvailability
  readonly reasonCode?: string
}

const asActions = (value: unknown): ReadActionView[] =>
  asArray(value).map((item) => {
    const record = asRecord(item)
    const availability = asString(record.availability)
    if (!READ_ACTION_AVAILABILITIES.includes(availability as ReadActionAvailability)) throw drift()
    return {
      branch: asString(record.branch),
      availability: availability as ReadActionAvailability,
      ...(record.reasonCode === undefined ? {} : { reasonCode: asString(record.reasonCode) }),
    }
  })

/** 写动作门控：`allowed` 才可渲染为可提交控件，其余给出原因而不渲染为可用按钮。 */
export const actionAvailability = (
  actions: readonly ReadActionView[],
  branch: string,
): ReadActionAvailability | null =>
  actions.find((action) => action.branch === branch)?.availability ?? null

/** 只读游标是不透明串：页面原样回传，不解析、不改写。 */
const asCursor = (value: unknown): { readonly nextCursor?: string } =>
  value === undefined ? {} : { nextCursor: asString(value) }

const asConfigRef = (value: unknown): VersionRef => asVersionRef(value)

/** 决策工件七项原引用：页面只展示，不用当前配置替换历史引用。 */
const CONFIGURATION_REF_KEYS_V1 = [
  'indicatorSystemRef',
  'indicatorFieldMappingRef',
  'weightSetRef',
  'scoringStrategyRef',
  'riskAcceptanceThresholdRef',
  'monitoringWarningThresholdRef',
  'jointTriggerPolicyRef',
] as const

export type AssessmentConfigurationRefsView = Readonly<Record<(typeof CONFIGURATION_REF_KEYS_V1)[number], VersionRef>>

const asConfigurationRefs = (value: unknown): AssessmentConfigurationRefsView => {
  const record = asRecord(value)
  return {
    indicatorSystemRef: asConfigRef(record.indicatorSystemRef),
    indicatorFieldMappingRef: asConfigRef(record.indicatorFieldMappingRef),
    weightSetRef: asConfigRef(record.weightSetRef),
    scoringStrategyRef: asConfigRef(record.scoringStrategyRef),
    riskAcceptanceThresholdRef: asConfigRef(record.riskAcceptanceThresholdRef),
    monitoringWarningThresholdRef: asConfigRef(record.monitoringWarningThresholdRef),
    jointTriggerPolicyRef: asConfigRef(record.jointTriggerPolicyRef),
  }
}

export interface RiskMatrixPlotView {
  readonly riskMatrixRef: VersionRef
  readonly possibilityBandId: string
  readonly consequenceBandId: string
  readonly riskLevelId: string
  readonly riskLevelOrdinal: number
}

const asMatrixPlot = (value: unknown): RiskMatrixPlotView => {
  const record = asRecord(value)
  return {
    riskMatrixRef: asConfigRef(record.riskMatrixRef),
    possibilityBandId: asString(record.possibilityBandId),
    consequenceBandId: asString(record.consequenceBandId),
    riskLevelId: asString(record.riskLevelId),
    riskLevelOrdinal: asNumber(record.riskLevelOrdinal),
  }
}

export interface PendingRiskItemView {
  readonly riskInput: KindRef
  readonly spatialScopeRefs: readonly KindRef[]
  readonly assessmentState: string
  readonly lastAssessmentRecordRef?: KindRef
  readonly evidenceReferences: readonly EvidenceReferenceView[]
}

const asPendingRiskItem = (value: unknown): PendingRiskItemView => {
  const record = asRecord(value)
  return {
    riskInput: asKindRef(record.riskInput),
    spatialScopeRefs: asArray(record.spatialScopeRefs).map(asKindRef),
    assessmentState: asString(record.assessmentState),
    ...(record.lastAssessmentRecordRef === undefined
      ? {}
      : { lastAssessmentRecordRef: asKindRef(record.lastAssessmentRecordRef) }),
    evidenceReferences: asEvidenceList(record.evidenceReferences),
  }
}

export interface AssessmentRecordCatalogItemView {
  readonly assessmentRecordRef: KindRef
  readonly riskInput: KindRef
  readonly entryMode: string
  readonly previousAssessmentRecordRef?: KindRef
  readonly occurredAt: string
  readonly likelihoodScore: number
  readonly consequenceScore: number
  readonly riskState: string
  readonly matrixPlot: RiskMatrixPlotView
}

const asRecordCatalogItem = (value: unknown): AssessmentRecordCatalogItemView => {
  const record = asRecord(value)
  return {
    assessmentRecordRef: asKindRef(record.assessmentRecordRef),
    riskInput: asKindRef(record.riskInput),
    entryMode: asString(record.entryMode),
    ...(record.previousAssessmentRecordRef === undefined
      ? {}
      : { previousAssessmentRecordRef: asKindRef(record.previousAssessmentRecordRef) }),
    occurredAt: asString(record.occurredAt),
    likelihoodScore: asNumber(record.likelihoodScore),
    consequenceScore: asNumber(record.consequenceScore),
    riskState: asString(record.riskState),
    matrixPlot: asMatrixPlot(record.matrixPlot),
  }
}

export interface ReassessmentHistoryItemView extends AssessmentRecordCatalogItemView {
  readonly reason?: string
  readonly changedInputRefs: readonly KindRef[]
}

const asReassessmentHistoryItem = (value: unknown): ReassessmentHistoryItemView => ({
  ...asRecordCatalogItem(value),
  ...(asRecord(value).reason === undefined ? {} : { reason: asString(asRecord(value).reason) }),
  changedInputRefs: asArray(asRecord(value).changedInputRefs).map(asKindRef),
})

export interface AssessmentIndicatorExplanationView {
  readonly indicatorId: string
  readonly actualValue: unknown
  readonly canonicalValue: string
  readonly canonicalUnit?: string
  readonly sourceReferences: readonly KindRef[]
  readonly evidenceReferences: readonly EvidenceReferenceView[]
  readonly ruleId: string
  readonly ruleVersion: VersionRef
  readonly grade: string
  readonly baseScore: string
}

const asIndicatorExplanation = (value: unknown): AssessmentIndicatorExplanationView => {
  const record = asRecord(value)
  return {
    indicatorId: asString(record.indicatorId),
    actualValue: record.actualValue,
    canonicalValue: asString(record.canonicalValue),
    ...(record.canonicalUnit === undefined ? {} : { canonicalUnit: asString(record.canonicalUnit) }),
    sourceReferences: asArray(record.sourceReferences).map(asKindRef),
    evidenceReferences: asEvidenceList(record.evidenceReferences),
    ruleId: asString(record.ruleId),
    ruleVersion: asConfigRef(record.ruleVersion),
    grade: asString(record.grade),
    baseScore: asString(record.baseScore),
  }
}

export interface AssessmentAxisView {
  readonly strategy: string
  readonly score: string
  readonly publicScore: number
  readonly weightSetRef?: VersionRef
  readonly contributions: readonly {
    readonly indicatorId: string
    readonly baseScore: string
    readonly weightedScore: string
    readonly basisPoints?: number
  }[]
}

const asAxis = (value: unknown): AssessmentAxisView => {
  const record = asRecord(value)
  return {
    strategy: asString(record.strategy),
    score: asString(record.score),
    publicScore: asNumber(record.publicScore),
    ...(record.weightSetRef === undefined ? {} : { weightSetRef: asConfigRef(record.weightSetRef) }),
    contributions: asArray(record.contributions).map((item) => {
      const contribution = asRecord(item)
      return {
        indicatorId: asString(contribution.indicatorId),
        baseScore: asString(contribution.baseScore),
        weightedScore: asString(contribution.weightedScore),
        ...(contribution.basisPoints === undefined
          ? {}
          : { basisPoints: asNumber(contribution.basisPoints) }),
      }
    }),
  }
}

export interface AssessmentTriggerFactView {
  readonly triggerType: string
  readonly indicatorItem: string
  readonly actualValue?: unknown
  readonly thresholdId?: string
  readonly thresholdValue?: string
  readonly jointRuleId?: string
  readonly evidenceReferences: readonly EvidenceReferenceView[]
}

const asTriggerFact = (value: unknown): AssessmentTriggerFactView => {
  const record = asRecord(value)
  return {
    triggerType: asString(record.triggerType),
    indicatorItem: asString(record.indicatorItem),
    ...(record.actualValue === undefined ? {} : { actualValue: record.actualValue }),
    ...(record.thresholdId === undefined ? {} : { thresholdId: asString(record.thresholdId) }),
    ...(record.thresholdValue === undefined
      ? {}
      : { thresholdValue: asString(record.thresholdValue) }),
    ...(record.jointRuleId === undefined ? {} : { jointRuleId: asString(record.jointRuleId) }),
    evidenceReferences: asEvidenceList(record.evidenceReferences),
  }
}

const submitAssessmentRead = async (
  projectId: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> =>
  asRecord(
    await submitQuery({
      projectId,
      branch: C34_ASSESSMENT_READ_BRANCH,
      payload,
      ...(signal === undefined ? {} : { signal }),
    }),
  )

export interface PendingCatalogView {
  readonly kind: 'pending-catalog'
  readonly actorId: string
  readonly items: readonly PendingRiskItemView[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/** P-RA-01 待评估风险目录：按风险输入分页，游标原样续页。 */
export const readPendingRiskCatalog = async (
  projectId: string,
  input: {
    readonly riskInputKind: 'risk-record' | 'external-risk-event'
    readonly spatialScopeRef?: KindRef
    readonly pageSize?: number
    readonly cursor?: string
  },
  signal?: AbortSignal,
): Promise<PendingCatalogView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'pending-catalog',
      riskInputKind: input.riskInputKind,
      ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    },
    signal,
  )
  if (result.kind !== 'pending-catalog') throw drift()
  return {
    kind: 'pending-catalog',
    actorId: asString(result.actorId),
    items: asArray(result.items).map(asPendingRiskItem),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface ApplicabilityCatalogItemView {
  readonly snapshotRef: KindRef
  readonly metadata: ApplicabilityMetadataView
}

const asApplicabilityCatalogItem = (value: unknown): ApplicabilityCatalogItemView => {
  const record = asRecord(value)
  return {
    snapshotRef: asKindRef(record.snapshotRef),
    metadata: asApplicabilityMetadata(record.metadata),
  }
}

export interface ExternalEventCatalogItemView {
  readonly riskInput: KindRef
  readonly spatialScopeRef: KindRef
  readonly sourceVersionRefs: readonly KindRef[]
  readonly evidenceReferences: readonly EvidenceReferenceView[]
}

const asExternalEventCatalogItem = (value: unknown): ExternalEventCatalogItemView => {
  const record = asRecord(value)
  return {
    riskInput: asKindRef(record.riskInput),
    spatialScopeRef: asKindRef(record.spatialScopeRef),
    sourceVersionRefs: asArray(record.sourceVersionRefs).map(asKindRef),
    evidenceReferences: asEvidenceList(record.evidenceReferences),
  }
}

/**
 * 部署注入的运行策略：不存在合格配置时为 unavailable，页面不得替用户补默认引用，
 * 也不得在没有精确版本的情况下启动。
 */
export type EntryRunPolicyView =
  | {
      readonly kind: 'available'
      readonly graphVersion: VersionRef
      readonly retryPolicyRef: VersionRef
    }
  | { readonly kind: 'unavailable'; readonly reasonCode: string }

const asRunPolicy = (value: unknown): EntryRunPolicyView => {
  const record = asRecord(value)
  const kind = asString(record.kind)
  if (kind === 'unavailable') return { kind, reasonCode: asString(record.reasonCode) }
  if (kind !== 'available') throw drift()
  return {
    kind,
    graphVersion: asConfigRef(record.graphVersion),
    retryPolicyRef: asConfigRef(record.retryPolicyRef),
  }
}

export interface EntryContextView {
  readonly kind: 'entry-context'
  readonly actorId: string
  readonly projectId: string
  readonly projectRevisionRef: KindRef
  readonly spatialScopeRef: KindRef
  readonly riskInput?: KindRef
  readonly applicabilityItems: readonly ApplicabilityCatalogItemView[]
  readonly externalEventItems: readonly ExternalEventCatalogItemView[]
  readonly applicabilityNextCursor?: string
  readonly externalEventNextCursor?: string
  readonly runPolicy: EntryRunPolicyView
  readonly actions: readonly ReadActionView[]
}

/** P-RA-02 启动入口上下文：两个独立目录各自游标，不合成一个列表。 */
export const readAssessmentEntryContext = async (
  projectId: string,
  input: {
    readonly projectRevisionRef: KindRef
    readonly spatialScopeRef: KindRef
    readonly riskInput?: KindRef
    readonly pageSize?: number
    readonly applicabilityCursor?: string
    readonly externalEventCursor?: string
  },
  signal?: AbortSignal,
): Promise<EntryContextView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'entry-context',
      projectRevisionRef: input.projectRevisionRef,
      spatialScopeRef: input.spatialScopeRef,
      ...(input.riskInput === undefined ? {} : { riskInput: input.riskInput }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.applicabilityCursor === undefined
        ? {}
        : { applicabilityCursor: input.applicabilityCursor }),
      ...(input.externalEventCursor === undefined
        ? {}
        : { externalEventCursor: input.externalEventCursor }),
    },
    signal,
  )
  if (result.kind !== 'entry-context') throw drift()
  return {
    kind: 'entry-context',
    actorId: asString(result.actorId),
    projectId: asString(result.projectId),
    projectRevisionRef: asKindRef(result.projectRevisionRef),
    spatialScopeRef: asKindRef(result.spatialScopeRef),
    ...(result.riskInput === undefined ? {} : { riskInput: asKindRef(result.riskInput) }),
    applicabilityItems: asArray(result.applicabilityItems).map(asApplicabilityCatalogItem),
    externalEventItems: asArray(result.externalEventItems).map(asExternalEventCatalogItem),
    ...(result.applicabilityNextCursor === undefined
      ? {}
      : { applicabilityNextCursor: asString(result.applicabilityNextCursor) }),
    ...(result.externalEventNextCursor === undefined
      ? {}
      : { externalEventNextCursor: asString(result.externalEventNextCursor) }),
    runPolicy: asRunPolicy(result.runPolicy),
    actions: asActions(result.actions),
  }
}

export interface RecordCatalogView {
  readonly kind: 'record-catalog'
  readonly actorId: string
  readonly items: readonly AssessmentRecordCatalogItemView[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/** P-RA-04 评估记录目录：条目只含摘要与冻结落点，正文由 record-read 解释。 */
export const readAssessmentRecordCatalog = async (
  projectId: string,
  input: {
    readonly riskInput?: KindRef
    readonly entryMode?: string
    readonly riskMatrixVersion?: VersionRef
    readonly spatialScopeRef?: KindRef
    readonly pageSize?: number
    readonly cursor?: string
  },
  signal?: AbortSignal,
): Promise<RecordCatalogView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'record-catalog',
      ...(input.riskInput === undefined ? {} : { riskInput: input.riskInput }),
      ...(input.entryMode === undefined ? {} : { entryMode: input.entryMode }),
      ...(input.riskMatrixVersion === undefined
        ? {}
        : { riskMatrixVersion: input.riskMatrixVersion }),
      ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    },
    signal,
  )
  if (result.kind !== 'record-catalog') throw drift()
  return {
    kind: 'record-catalog',
    actorId: asString(result.actorId),
    items: asArray(result.items).map(asRecordCatalogItem),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface ReassessmentHistoryView {
  readonly kind: 'reassessment-history'
  readonly actorId: string
  readonly items: readonly ReassessmentHistoryItemView[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/** P-RA-07 重评历史：原因与变化引用取登记的入口事实，页面不自己推断变化。 */
export const readReassessmentHistory = async (
  projectId: string,
  input: {
    readonly riskInput: KindRef
    readonly spatialScopeRef?: KindRef
    readonly pageSize?: number
    readonly cursor?: string
  },
  signal?: AbortSignal,
): Promise<ReassessmentHistoryView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'reassessment-history',
      riskInput: input.riskInput,
      ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    },
    signal,
  )
  if (result.kind !== 'reassessment-history') throw drift()
  return {
    kind: 'reassessment-history',
    actorId: asString(result.actorId),
    items: asArray(result.items).map(asReassessmentHistoryItem),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface AssessmentRecordView {
  readonly kind: 'record-read'
  readonly actorId: string
  readonly record: unknown
  readonly assessmentRecordRef: KindRef
  readonly preparationSnapshotRef: KindRef
  readonly inputSnapshotRef: KindRef
  readonly entryMode: string
  readonly previousAssessmentRecordRef?: KindRef
  readonly reassessmentReason?: string
  readonly changedInputRefs: readonly KindRef[]
  readonly configurationRefs: AssessmentConfigurationRefsView
  readonly indicators: readonly AssessmentIndicatorExplanationView[]
  readonly axes: { readonly possibility: AssessmentAxisView; readonly consequence: AssessmentAxisView }
  readonly matrixPlot: RiskMatrixPlotView
  readonly triggerFacts: readonly AssessmentTriggerFactView[]
  readonly evidenceReferences: readonly EvidenceReferenceView[]
  readonly auditTrailRef: KindRef
  readonly actions: readonly ReadActionView[]
}

/** P-RA-05 评估记录精确读：指标解释、轴贡献与落点都来自该记录保存的引用。 */
export const readAssessmentRecord = async (
  projectId: string,
  assessmentRecordRef: KindRef,
  signal?: AbortSignal,
): Promise<AssessmentRecordView> => {
  const result = await submitAssessmentRead(
    projectId,
    { operation: 'record-read', assessmentRecordRef },
    signal,
  )
  if (result.kind !== 'record-read') throw drift()
  const axes = asRecord(result.axes)
  return {
    kind: 'record-read',
    actorId: asString(result.actorId),
    record: result.record,
    assessmentRecordRef: asKindRef(result.assessmentRecordRef),
    preparationSnapshotRef: asKindRef(result.preparationSnapshotRef),
    inputSnapshotRef: asKindRef(result.inputSnapshotRef),
    entryMode: asString(result.entryMode),
    ...(result.previousAssessmentRecordRef === undefined
      ? {}
      : { previousAssessmentRecordRef: asKindRef(result.previousAssessmentRecordRef) }),
    ...(result.reassessmentReason === undefined
      ? {}
      : { reassessmentReason: asString(result.reassessmentReason) }),
    changedInputRefs: asArray(result.changedInputRefs).map(asKindRef),
    configurationRefs: asConfigurationRefs(result.configurationRefs),
    indicators: asArray(result.indicators).map(asIndicatorExplanation),
    axes: { possibility: asAxis(axes.possibility), consequence: asAxis(axes.consequence) },
    matrixPlot: asMatrixPlot(result.matrixPlot),
    triggerFacts: asArray(result.triggerFacts).map(asTriggerFact),
    evidenceReferences: asEvidenceList(result.evidenceReferences),
    auditTrailRef: asKindRef(result.auditTrailRef),
    actions: asActions(result.actions),
  }
}

export interface AssessmentOverviewView {
  readonly kind: 'overview'
  readonly actorId: string
  readonly projectId: string
  readonly spatialScopeRef?: KindRef
  readonly recordedAssessmentCount: number
  readonly riskLevelCounts: readonly { readonly riskLevel: string; readonly count: number }[]
  readonly asOf: string
  readonly actions: readonly ReadActionView[]
}

/** P-RA-01 评估摘要：只统计已入库记录版本，不声称识别风险总数。 */
export const readAssessmentOverview = async (
  projectId: string,
  input: { readonly projectRevisionRef: KindRef; readonly spatialScopeRef?: KindRef },
  signal?: AbortSignal,
): Promise<AssessmentOverviewView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'overview',
      projectRevisionRef: input.projectRevisionRef,
      ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
    },
    signal,
  )
  if (result.kind !== 'overview') throw drift()
  return {
    kind: 'overview',
    actorId: asString(result.actorId),
    projectId: asString(result.projectId),
    ...(result.spatialScopeRef === undefined
      ? {}
      : { spatialScopeRef: asKindRef(result.spatialScopeRef) }),
    recordedAssessmentCount: asNumber(result.recordedAssessmentCount),
    riskLevelCounts: asArray(result.riskLevelCounts).map((item) => {
      const count = asRecord(item)
      return { riskLevel: asString(count.riskLevel), count: asNumber(count.count) }
    }),
    asOf: asString(result.asOf),
    actions: asActions(result.actions),
  }
}

export interface AssessmentRunView {
  readonly kind: 'run-read'
  readonly actorId: string
  readonly runRef: KindRef
  readonly entryMode: string
  readonly status: string
  readonly stage: string
  readonly graphVersion: VersionRef
  readonly actorRef: string
  readonly startedAt: string
  readonly stateVersion: VersionRef
  readonly stages: readonly {
    readonly stageCode: string
    readonly state: string
    readonly stageResultRef?: KindRef
  }[]
  readonly resultRefs: readonly KindRef[]
  readonly reviewTaskRefs: readonly KindRef[]
  readonly assessmentRunRefs: readonly KindRef[]
  readonly selectedAssessmentRunRef?: KindRef
  readonly error?: KindRef
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/**
 * P-RA-03 运行精确读：父运行可带精确 `assessmentRunRef` 选择空间子运行，
 * 阶段按登记的 stageCode 展示，不把父图 R 阶段改称 A 阶段。
 */
export const readAssessmentRun = async (
  projectId: string,
  input: {
    readonly workflowRunRef: KindRef
    readonly assessmentRunRef?: KindRef
    readonly resultCursor?: string
    readonly reviewTaskCursor?: string
  },
  signal?: AbortSignal,
): Promise<AssessmentRunView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'run-read',
      workflowRunRef: input.workflowRunRef,
      ...(input.assessmentRunRef === undefined ? {} : { assessmentRunRef: input.assessmentRunRef }),
      ...(input.resultCursor === undefined ? {} : { resultCursor: input.resultCursor }),
      ...(input.reviewTaskCursor === undefined
        ? {}
        : { reviewTaskCursor: input.reviewTaskCursor }),
    },
    signal,
  )
  if (result.kind !== 'run-read') throw drift()
  return {
    kind: 'run-read',
    actorId: asString(result.actorId),
    runRef: asKindRef(result.runRef),
    entryMode: asString(result.entryMode),
    status: asString(result.status),
    stage: asString(result.stage),
    graphVersion: asConfigRef(result.graphVersion),
    actorRef: asString(result.actorRef),
    startedAt: asString(result.startedAt),
    stateVersion: asConfigRef(result.stateVersion),
    stages: asArray(result.stages).map((item) => {
      const stage = asRecord(item)
      return {
        stageCode: asString(stage.stageCode),
        state: asString(stage.state),
        ...(stage.stageResultRef === undefined
          ? {}
          : { stageResultRef: asKindRef(stage.stageResultRef) }),
      }
    }),
    resultRefs: asArray(result.resultRefs).map(asKindRef),
    reviewTaskRefs: asArray(result.reviewTaskRefs).map(asKindRef),
    assessmentRunRefs: asArray(result.assessmentRunRefs).map(asKindRef),
    ...(result.selectedAssessmentRunRef === undefined
      ? {}
      : { selectedAssessmentRunRef: asKindRef(result.selectedAssessmentRunRef) }),
    ...(result.error === undefined ? {} : { error: asKindRef(result.error) }),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface AssessmentResolveView {
  readonly kind: 'resolve'
  readonly actorId: string
  readonly targetKind: 'record' | 'run'
  readonly assessmentRecordRef?: KindRef
  readonly workflowRunRef?: KindRef
  readonly actions: readonly ReadActionView[]
}

/** 只含实体 ID 的书签入口：解析出可见版本，随后由调用方替换 URL。 */
export const readAssessmentResolve = async (
  projectId: string,
  input: {
    readonly entityId: string
    readonly targetKind: 'record' | 'run'
    readonly versionId?: string
  },
  signal?: AbortSignal,
): Promise<AssessmentResolveView> => {
  const result = await submitAssessmentRead(
    projectId,
    {
      operation: 'resolve',
      entityId: input.entityId,
      targetKind: input.targetKind,
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
    },
    signal,
  )
  if (result.kind !== 'resolve') throw drift()
  const targetKind = asString(result.targetKind)
  if (targetKind !== 'record' && targetKind !== 'run') throw drift()
  return {
    kind: 'resolve',
    actorId: asString(result.actorId),
    targetKind,
    ...(result.assessmentRecordRef === undefined
      ? {}
      : { assessmentRecordRef: asKindRef(result.assessmentRecordRef) }),
    ...(result.workflowRunRef === undefined
      ? {}
      : { workflowRunRef: asKindRef(result.workflowRunRef) }),
    actions: asActions(result.actions),
  }
}

// ============================================================================
// C34 预警处置读面（design D-05）
//
// 七组关系各自独立分页：公共契约只有一个 relatedCursor，游标内含它属于哪一组关系。
// 页面原样回传某一组的游标即可续该组，其余组回到首页；不解析游标内容、不合并成单一列表。
// ============================================================================

const C34_WARNING_READ_BRANCH = 'warning-response.read' as const

export interface WarningCatalogItemView {
  readonly warningRecordRef: KindRef
  readonly assessmentRecordRef: KindRef
  readonly taskRef: KindRef
  readonly triggerType: string
  readonly warningLevel: string
  readonly occurredAt: string
  readonly acknowledged: boolean
}

const asWarningCatalogItem = (value: unknown): WarningCatalogItemView => {
  const record = asRecord(value)
  return {
    warningRecordRef: asKindRef(record.warningRecordRef),
    assessmentRecordRef: asKindRef(record.assessmentRecordRef),
    taskRef: asKindRef(record.taskRef),
    triggerType: asString(record.triggerType),
    warningLevel: asString(record.warningLevel),
    occurredAt: asString(record.occurredAt),
    acknowledged: asBoolean(record.acknowledged),
  }
}

export interface WarningTaskCatalogItemView {
  readonly taskRef: KindRef
  readonly status: string
  readonly riskInput: KindRef
  readonly spatialScopeRef: KindRef
  readonly warningCount: number
  readonly occurredAt: string
}

const asTaskCatalogItem = (value: unknown): WarningTaskCatalogItemView => {
  const record = asRecord(value)
  return {
    taskRef: asKindRef(record.taskRef),
    status: asString(record.status),
    riskInput: asKindRef(record.riskInput),
    spatialScopeRef: asKindRef(record.spatialScopeRef),
    warningCount: asNumber(record.warningCount),
    occurredAt: asString(record.occurredAt),
  }
}

export interface WarningCatalogView {
  readonly kind: 'warning-catalog'
  readonly actorId: string
  readonly items: readonly WarningCatalogItemView[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/** P-WR-01 预警目录：按触发类型筛选，条目带任务与评估记录精确引用。 */
export const readWarningCatalog = async (
  projectId: string,
  input: {
    readonly spatialScopeRef?: KindRef
    readonly triggerType?: string
    readonly pageSize?: number
    readonly cursor?: string
  },
  signal?: AbortSignal,
): Promise<WarningCatalogView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: C34_WARNING_READ_BRANCH,
      payload: {
        operation: 'warning-catalog',
        ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
        ...(input.triggerType === undefined ? {} : { triggerType: input.triggerType }),
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'warning-catalog') throw drift()
  return {
    kind: 'warning-catalog',
    actorId: asString(result.actorId),
    items: asArray(result.items).map(asWarningCatalogItem),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface WarningTaskCatalogView {
  readonly kind: 'task-catalog'
  readonly actorId: string
  readonly items: readonly WarningTaskCatalogItemView[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/** P-WR-03 处置任务目录：条目只含风险输入、空间与预警计数。 */
export const readWarningTaskCatalog = async (
  projectId: string,
  input: {
    readonly spatialScopeRef?: KindRef
    readonly status?: string
    readonly pageSize?: number
    readonly cursor?: string
  },
  signal?: AbortSignal,
): Promise<WarningTaskCatalogView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: C34_WARNING_READ_BRANCH,
      payload: {
        operation: 'task-catalog',
        ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'task-catalog') throw drift()
  return {
    kind: 'task-catalog',
    actorId: asString(result.actorId),
    items: asArray(result.items).map(asTaskCatalogItem),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface WarningResponseOverviewView {
  readonly kind: 'overview'
  readonly actorId: string
  readonly openTaskCount: number
  readonly warningCount: number
  readonly levelCounts: readonly { readonly warningLevel: string; readonly count: number }[]
  readonly asOf: string
  readonly actions: readonly ReadActionView[]
}

/** 概览计数注明统计口径：只统计已登记的开放任务与预警，不外推识别风险总数。 */
export const readWarningResponseOverview = async (
  projectId: string,
  input: { readonly spatialScopeRef?: KindRef },
  signal?: AbortSignal,
): Promise<WarningResponseOverviewView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: C34_WARNING_READ_BRANCH,
      payload: {
        operation: 'overview',
        ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'overview') throw drift()
  return {
    kind: 'overview',
    actorId: asString(result.actorId),
    openTaskCount: asNumber(result.openTaskCount),
    warningCount: asNumber(result.warningCount),
    levelCounts: asArray(result.levelCounts).map((item) => {
      const level = asRecord(item)
      return { warningLevel: asString(level.warningLevel), count: asNumber(level.count) }
    }),
    asOf: asString(result.asOf),
    actions: asActions(result.actions),
  }
}

export interface WarningNotificationView {
  readonly intentRef: KindRef
  readonly recipientActorId: string
  readonly channel: string
  readonly recordedAt: string
  readonly deliveredAt?: string
}

const asNotification = (value: unknown): WarningNotificationView => {
  const record = asRecord(value)
  return {
    intentRef: asKindRef(record.intentRef),
    recipientActorId: asString(record.recipientActorId),
    channel: asString(record.channel),
    recordedAt: asString(record.recordedAt),
    ...(record.deliveredAt === undefined ? {} : { deliveredAt: asString(record.deliveredAt) }),
  }
}

export interface WarningRecordView {
  readonly kind: 'warning-read'
  readonly actorId: string
  readonly record: unknown
  readonly warningRecordRef: KindRef
  readonly assessmentRecordRef: KindRef
  readonly taskRef: KindRef
  readonly triggerFacts: readonly unknown[]
  readonly matrixPlot: RiskMatrixPlotView
  readonly notifications: readonly WarningNotificationView[]
  readonly notificationsNextCursor?: string
  readonly acknowledgement?: {
    readonly actorId: string
    readonly acknowledgedAt: string
    readonly auditTrailRef: KindRef
  }
  readonly actions: readonly ReadActionView[]
}

/**
 * P-WR-02 预警精确读：阈值解释取冻结的触发事实，通知披露区分意图与已登记投递。
 * 未登记投递时不补 deliveredAt——意图不等于送达。
 */
export const readWarningRecord = async (
  projectId: string,
  warningRecordRef: KindRef,
  input: { readonly notificationCursor?: string } = {},
  signal?: AbortSignal,
): Promise<WarningRecordView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: C34_WARNING_READ_BRANCH,
      payload: {
        operation: 'warning-read',
        warningRecordRef,
        ...(input.notificationCursor === undefined
          ? {}
          : { notificationCursor: input.notificationCursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'warning-read') throw drift()
  return {
    kind: 'warning-read',
    actorId: asString(result.actorId),
    record: result.record,
    warningRecordRef: asKindRef(result.warningRecordRef),
    assessmentRecordRef: asKindRef(result.assessmentRecordRef),
    taskRef: asKindRef(result.taskRef),
    triggerFacts: asArray(result.triggerFacts),
    matrixPlot: asMatrixPlot(result.matrixPlot),
    notifications: asArray(result.notifications).map(asNotification),
    ...(result.notificationsNextCursor === undefined
      ? {}
      : { notificationsNextCursor: asString(result.notificationsNextCursor) }),
    ...(result.acknowledgement === undefined
      ? {}
      : {
          acknowledgement: {
            actorId: asString(asRecord(result.acknowledgement).actorId),
            acknowledgedAt: asString(asRecord(result.acknowledgement).acknowledgedAt),
            auditTrailRef: asKindRef(asRecord(result.acknowledgement).auditTrailRef),
          },
        }),
    actions: asActions(result.actions),
  }
}

export interface WarningTaskRelationsView {
  readonly warningRefs: readonly KindRef[]
  readonly recommendationRefs: readonly KindRef[]
  readonly decisionRefs: readonly KindRef[]
  readonly executionRefs: readonly KindRef[]
  readonly forecastRefs: readonly KindRef[]
  readonly feedbackRefs: readonly KindRef[]
  readonly calibrationRefs: readonly KindRef[]
  readonly warningNextCursor?: string
  readonly recommendationNextCursor?: string
  readonly decisionNextCursor?: string
  readonly executionNextCursor?: string
  readonly forecastNextCursor?: string
  readonly feedbackNextCursor?: string
  readonly calibrationNextCursor?: string
}

const asTaskRelations = (value: unknown): WarningTaskRelationsView => {
  const record = asRecord(value)
  return {
    warningRefs: asArray(record.warningRefs).map(asKindRef),
    recommendationRefs: asArray(record.recommendationRefs).map(asKindRef),
    decisionRefs: asArray(record.decisionRefs).map(asKindRef),
    executionRefs: asArray(record.executionRefs).map(asKindRef),
    forecastRefs: asArray(record.forecastRefs).map(asKindRef),
    feedbackRefs: asArray(record.feedbackRefs).map(asKindRef),
    calibrationRefs: asArray(record.calibrationRefs).map(asKindRef),
    ...(record.warningNextCursor === undefined
      ? {}
      : { warningNextCursor: asString(record.warningNextCursor) }),
    ...(record.recommendationNextCursor === undefined
      ? {}
      : { recommendationNextCursor: asString(record.recommendationNextCursor) }),
    ...(record.decisionNextCursor === undefined
      ? {}
      : { decisionNextCursor: asString(record.decisionNextCursor) }),
    ...(record.executionNextCursor === undefined
      ? {}
      : { executionNextCursor: asString(record.executionNextCursor) }),
    ...(record.forecastNextCursor === undefined
      ? {}
      : { forecastNextCursor: asString(record.forecastNextCursor) }),
    ...(record.feedbackNextCursor === undefined
      ? {}
      : { feedbackNextCursor: asString(record.feedbackNextCursor) }),
    ...(record.calibrationNextCursor === undefined
      ? {}
      : { calibrationNextCursor: asString(record.calibrationNextCursor) }),
  }
}

export interface WarningTaskView {
  readonly kind: 'task-read'
  readonly actorId: string
  readonly taskRef: KindRef
  readonly status: string
  readonly riskInput: KindRef
  readonly spatialScopeRef: KindRef
  readonly occurredAt: string
  readonly relations: WarningTaskRelationsView
  readonly actions: readonly ReadActionView[]
}

/** P-WR-04 任务精确读：关系集合由各所属接缝分别提供，页面按组续页。 */
export const readWarningTask = async (
  projectId: string,
  warningResponseTaskRef: KindRef,
  input: { readonly relatedCursor?: string } = {},
  signal?: AbortSignal,
): Promise<WarningTaskView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: C34_WARNING_READ_BRANCH,
      payload: {
        operation: 'task-read',
        warningResponseTaskRef,
        ...(input.relatedCursor === undefined ? {} : { relatedCursor: input.relatedCursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'task-read') throw drift()
  return {
    kind: 'task-read',
    actorId: asString(result.actorId),
    taskRef: asKindRef(result.taskRef),
    status: asString(result.status),
    riskInput: asKindRef(result.riskInput),
    spatialScopeRef: asKindRef(result.spatialScopeRef),
    occurredAt: asString(result.occurredAt),
    relations: asTaskRelations(result.relations),
    actions: asActions(result.actions),
  }
}

// ============================================================================
// C34 处置精确读（design D-05）
//
// 预测可用性区分 available 与 unavailable：unavailable 只给原因码，页面不得补数值、
// 不用当前阈值解释冻结偏差。执行来源与 C28 登记事实同形，两类来源不混。
// ============================================================================

export interface RiskStateView {
  readonly likelihoodScore: number
  readonly consequenceScore: number
  readonly riskLevel: string
}

export interface ForecastAvailabilityView {
  readonly kind: 'available' | 'unavailable'
  readonly predictedValue?: unknown
  readonly predictedRiskState?: RiskStateView
  readonly reasonCode?: string
}

const asForecastAvailability = (value: unknown): ForecastAvailabilityView => {
  const record = asRecord(value)
  const kind = asString(record.kind)
  if (kind === 'unavailable') return { kind, reasonCode: asString(record.reasonCode) }
  if (kind !== 'available') throw drift()
  return {
    kind,
    predictedValue: record.predictedValue,
    predictedRiskState: asRiskState(record.predictedRiskState),
  }
}

const asRiskState = (value: unknown): RiskStateView => {
  const record = asRecord(value)
  return {
    likelihoodScore: asNumber(record.likelihoodScore),
    consequenceScore: asNumber(record.consequenceScore),
    riskLevel: asString(record.riskLevel),
  }
}

const submitWarningRead = async (
  projectId: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> =>
  asRecord(
    await submitQuery({
      projectId,
      branch: C34_WARNING_READ_BRANCH,
      payload,
      ...(signal === undefined ? {} : { signal }),
    }),
  )

export interface RecommendationView {
  readonly kind: 'recommendation-read'
  readonly actorId: string
  readonly recommendation: unknown
  readonly responseRecommendationRef: KindRef
  readonly taskRef: KindRef
  readonly validationResults: readonly {
    readonly checkId: string
    readonly pass: boolean
    readonly evidenceReferences: readonly EvidenceReferenceView[]
    readonly reasonCode?: string
  }[]
  readonly generationPolicyRef: VersionRef
  readonly validationPolicyRef: VersionRef
  readonly measureReleaseRefs: readonly KindRef[]
  readonly decision?: {
    readonly decisionRef: KindRef
    readonly state: 'adopted' | 'declined'
    readonly actorId: string
    readonly decidedAt: string
    readonly reasonCode: string
    readonly forecastRunRef?: KindRef
  }
  readonly actions: readonly ReadActionView[]
}

/** P-RS-01 建议精确读：策略是裸版本引用，页面不套一个不相干的 kind 去展示。 */
export const readResponseRecommendation = async (
  projectId: string,
  responseRecommendationRef: KindRef,
  signal?: AbortSignal,
): Promise<RecommendationView> => {
  const result = await submitWarningRead(
    projectId,
    { operation: 'recommendation-read', responseRecommendationRef },
    signal,
  )
  if (result.kind !== 'recommendation-read') throw drift()
  return {
    kind: 'recommendation-read',
    actorId: asString(result.actorId),
    recommendation: result.recommendation,
    responseRecommendationRef: asKindRef(result.responseRecommendationRef),
    taskRef: asKindRef(result.taskRef),
    validationResults: asArray(result.validationResults).map((item) => {
      const check = asRecord(item)
      return {
        checkId: asString(check.checkId),
        pass: asBoolean(check.pass),
        evidenceReferences: asEvidenceList(check.evidenceReferences),
        ...(check.reasonCode === undefined ? {} : { reasonCode: asString(check.reasonCode) }),
      }
    }),
    generationPolicyRef: asConfigRef(result.generationPolicyRef),
    validationPolicyRef: asConfigRef(result.validationPolicyRef),
    measureReleaseRefs: asArray(result.measureReleaseRefs).map(asKindRef),
    ...(result.decision === undefined
      ? {}
      : {
          decision: {
            decisionRef: asKindRef(asRecord(result.decision).decisionRef),
            state: asDecisionState(asRecord(result.decision).state),
            actorId: asString(asRecord(result.decision).actorId),
            decidedAt: asString(asRecord(result.decision).decidedAt),
            reasonCode: asString(asRecord(result.decision).reasonCode),
            ...(asRecord(result.decision).forecastRunRef === undefined
              ? {}
              : { forecastRunRef: asKindRef(asRecord(result.decision).forecastRunRef) }),
          },
        }),
    actions: asActions(result.actions),
  }
}

const asDecisionState = (value: unknown): 'adopted' | 'declined' => {
  const state = asString(value)
  if (state !== 'adopted' && state !== 'declined') throw drift()
  return state
}

export interface ForecastView {
  readonly kind: 'forecast-read'
  readonly actorId: string
  readonly effectForecastRef: KindRef
  readonly recommendationRef: KindRef
  readonly routeDecisionRef: KindRef
  readonly runRef: KindRef
  readonly inputSnapshotRef: KindRef
  readonly frozenAssessmentBasisRef: KindRef
  readonly preActionMonitoringSnapshotRef: KindRef
  readonly baselineAssessmentRecordRef: KindRef
  readonly forecastPolicyRef: KindRef
  readonly method: string
  readonly targetIndicatorId: string
  readonly unit: string
  readonly horizonSteps: number
  readonly availability: ForecastAvailabilityView
  readonly actions: readonly ReadActionView[]
}

/** P-RS-03 预测精确读：方法、步长与可用性取登记事实，页面不重算预测。 */
export const readEffectForecast = async (
  projectId: string,
  effectForecastRef: KindRef,
  signal?: AbortSignal,
): Promise<ForecastView> => {
  const result = await submitWarningRead(
    projectId,
    { operation: 'forecast-read', effectForecastRef },
    signal,
  )
  if (result.kind !== 'forecast-read') throw drift()
  return {
    kind: 'forecast-read',
    actorId: asString(result.actorId),
    effectForecastRef: asKindRef(result.effectForecastRef),
    recommendationRef: asKindRef(result.recommendationRef),
    routeDecisionRef: asKindRef(result.routeDecisionRef),
    runRef: asKindRef(result.runRef),
    inputSnapshotRef: asKindRef(result.inputSnapshotRef),
    frozenAssessmentBasisRef: asKindRef(result.frozenAssessmentBasisRef),
    preActionMonitoringSnapshotRef: asKindRef(result.preActionMonitoringSnapshotRef),
    baselineAssessmentRecordRef: asKindRef(result.baselineAssessmentRecordRef),
    forecastPolicyRef: asKindRef(result.forecastPolicyRef),
    method: asString(result.method),
    targetIndicatorId: asString(result.targetIndicatorId),
    unit: asString(result.unit),
    horizonSteps: asNumber(result.horizonSteps),
    availability: asForecastAvailability(result.availability),
    actions: asActions(result.actions),
  }
}

export interface ExecutionView {
  readonly kind: 'execution-read'
  readonly actorId: string
  readonly executionRecordRef: KindRef
  readonly source:
    | {
        readonly sourceKind: 'adopted-recommendation'
        readonly recommendationRef: KindRef
        readonly routeDecisionRef: KindRef
      }
    | {
        readonly sourceKind: 'independent-action'
        readonly measureReleaseRefs: readonly KindRef[]
      }
  readonly executedByActorId: string
  readonly recordedByActorId: string
  readonly occurredAt: string
  readonly spatialScopeRef: KindRef
  readonly evidenceReferences: readonly EvidenceReferenceView[]
  readonly feedbackRefs: readonly KindRef[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

const asExecutionSource = (
  value: unknown,
): ExecutionView['source'] => {
  const record = asRecord(value)
  const sourceKind = asString(record.sourceKind)
  if (sourceKind === 'independent-action') {
    return {
      sourceKind,
      measureReleaseRefs: asArray(record.measureReleaseRefs).map(asKindRef),
    }
  }
  if (sourceKind !== 'adopted-recommendation') throw drift()
  return {
    sourceKind,
    recommendationRef: asKindRef(record.recommendationRef),
    routeDecisionRef: asKindRef(record.routeDecisionRef),
  }
}

/** P-RS-02 执行登记页读取：来源与 C28 登记事实同形，采纳与独立行动不混。 */
export const readExecutionRecord = async (
  projectId: string,
  executionRecordRef: KindRef,
  input: { readonly feedbackCursor?: string } = {},
  signal?: AbortSignal,
): Promise<ExecutionView> => {
  const result = await submitWarningRead(
    projectId,
    {
      operation: 'execution-read',
      executionRecordRef,
      ...(input.feedbackCursor === undefined ? {} : { feedbackCursor: input.feedbackCursor }),
    },
    signal,
  )
  if (result.kind !== 'execution-read') throw drift()
  return {
    kind: 'execution-read',
    actorId: asString(result.actorId),
    executionRecordRef: asKindRef(result.executionRecordRef),
    source: asExecutionSource(result.source),
    executedByActorId: asString(result.executedByActorId),
    recordedByActorId: asString(result.recordedByActorId),
    occurredAt: asString(result.occurredAt),
    spatialScopeRef: asKindRef(result.spatialScopeRef),
    evidenceReferences: asEvidenceList(result.evidenceReferences),
    feedbackRefs: asArray(result.feedbackRefs).map(asKindRef),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface FeedbackView {
  readonly kind: 'feedback-read'
  readonly actorId: string
  readonly feedbackRef: KindRef
  readonly executionRef: KindRef
  readonly postActionMonitoringSnapshotRef: KindRef
  readonly feedbackArtifactRef: KindRef
  readonly actualAssessmentRecordRef: KindRef
  readonly occurredAt: string
  readonly forecastAvailability: ForecastAvailabilityView
  readonly deviationRecord?: unknown
  readonly deviation?: unknown
  readonly deviationRecordRef?: KindRef
  readonly calibrationRefs: readonly KindRef[]
  readonly nextCursor?: string
  readonly actions: readonly ReadActionView[]
}

/**
 * P-RS-04 反馈精确读：公共偏差记录与私有计算偏差解释分别给出，页面不把解释冒充
 * 公共记录；校准引用只在真实登记时出现。
 */
export const readFeedbackRecord = async (
  projectId: string,
  feedbackRef: KindRef,
  input: { readonly calibrationCursor?: string } = {},
  signal?: AbortSignal,
): Promise<FeedbackView> => {
  const result = await submitWarningRead(
    projectId,
    {
      operation: 'feedback-read',
      feedbackRef,
      ...(input.calibrationCursor === undefined
        ? {}
        : { calibrationCursor: input.calibrationCursor }),
    },
    signal,
  )
  if (result.kind !== 'feedback-read') throw drift()
  return {
    kind: 'feedback-read',
    actorId: asString(result.actorId),
    feedbackRef: asKindRef(result.feedbackRef),
    executionRef: asKindRef(result.executionRef),
    postActionMonitoringSnapshotRef: asKindRef(result.postActionMonitoringSnapshotRef),
    feedbackArtifactRef: asKindRef(result.feedbackArtifactRef),
    actualAssessmentRecordRef: asKindRef(result.actualAssessmentRecordRef),
    occurredAt: asString(result.occurredAt),
    forecastAvailability: asForecastAvailability(result.forecastAvailability),
    ...(result.deviationRecord === undefined ? {} : { deviationRecord: result.deviationRecord }),
    ...(result.deviation === undefined ? {} : { deviation: result.deviation }),
    ...(result.deviationRecordRef === undefined
      ? {}
      : { deviationRecordRef: asKindRef(result.deviationRecordRef) }),
    calibrationRefs: asArray(result.calibrationRefs).map(asKindRef),
    ...asCursor(result.nextCursor),
    actions: asActions(result.actions),
  }
}

export interface CalibrationView {
  readonly kind: 'calibration-read'
  readonly actorId: string
  readonly calibrationSuggestionRef: KindRef
  readonly targetKind: string
  readonly targetReleaseRef: KindRef
  readonly inputSnapshotRef: KindRef
  readonly validationPolicyRef: VersionRef
  readonly operations: readonly {
    readonly operation: unknown
    readonly valid: boolean
    readonly reasonCode?: string
  }[]
  readonly status: string
  readonly reviewTaskRef?: KindRef
  readonly deviationRecordRef: KindRef
  readonly deviationRecordVersionId: string
  readonly reviewDecisionRef?: KindRef
  readonly candidateArtifactRef?: KindRef
  readonly knowledgeRevisionRef?: KindRef
  readonly actions: readonly ReadActionView[]
}

/** P-RS-05 校准建议精确读：草案是未发布修订，页面不显示为已发布知识。 */
export const readCalibrationSuggestion = async (
  projectId: string,
  calibrationSuggestionRef: KindRef,
  signal?: AbortSignal,
): Promise<CalibrationView> => {
  const result = await submitWarningRead(
    projectId,
    { operation: 'calibration-read', calibrationSuggestionRef },
    signal,
  )
  if (result.kind !== 'calibration-read') throw drift()
  return {
    kind: 'calibration-read',
    actorId: asString(result.actorId),
    calibrationSuggestionRef: asKindRef(result.calibrationSuggestionRef),
    targetKind: asString(result.targetKind),
    targetReleaseRef: asKindRef(result.targetReleaseRef),
    inputSnapshotRef: asKindRef(result.inputSnapshotRef),
    validationPolicyRef: asConfigRef(result.validationPolicyRef),
    operations: asArray(result.operations).map((item) => {
      const operation = asRecord(item)
      return {
        operation: operation.operation,
        valid: asBoolean(operation.valid),
        ...(operation.reasonCode === undefined
          ? {}
          : { reasonCode: asString(operation.reasonCode) }),
      }
    }),
    status: asString(result.status),
    ...(result.reviewTaskRef === undefined
      ? {}
      : { reviewTaskRef: asKindRef(result.reviewTaskRef) }),
    deviationRecordRef: asKindRef(result.deviationRecordRef),
    deviationRecordVersionId: asString(result.deviationRecordVersionId),
    ...(result.reviewDecisionRef === undefined
      ? {}
      : { reviewDecisionRef: asKindRef(result.reviewDecisionRef) }),
    ...(result.candidateArtifactRef === undefined
      ? {}
      : { candidateArtifactRef: asKindRef(result.candidateArtifactRef) }),
    ...(result.knowledgeRevisionRef === undefined
      ? {}
      : { knowledgeRevisionRef: asKindRef(result.knowledgeRevisionRef) }),
    actions: asActions(result.actions),
  }
}

export type WarningResponseTargetKind =
  | 'warning'
  | 'task'
  | 'recommendation'
  | 'forecast'
  | 'execution'
  | 'feedback'
  | 'calibration'

export interface WarningResponseResolveView {
  readonly kind: 'resolve'
  readonly actorId: string
  readonly targetKind: WarningResponseTargetKind
  readonly refs: readonly KindRef[]
  readonly actions: readonly ReadActionView[]
}

const WARNING_RESPONSE_TARGET_KINDS_V1: readonly WarningResponseTargetKind[] = [
  'warning',
  'task',
  'recommendation',
  'forecast',
  'execution',
  'feedback',
  'calibration',
]

/** 只含实体 ID 的书签入口：解析出可见版本，随后由调用方替换 URL。 */
export const readWarningResponseResolve = async (
  projectId: string,
  input: { readonly entityId: string; readonly targetKind: WarningResponseTargetKind; readonly versionId?: string },
  signal?: AbortSignal,
): Promise<WarningResponseResolveView> => {
  const result = await submitWarningRead(
    projectId,
    {
      operation: 'resolve',
      entityId: input.entityId,
      targetKind: input.targetKind,
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
    },
    signal,
  )
  if (result.kind !== 'resolve') throw drift()
  const targetKind = asString(result.targetKind)
  if (!WARNING_RESPONSE_TARGET_KINDS_V1.includes(targetKind as WarningResponseTargetKind)) {
    throw drift()
  }
  return {
    kind: 'resolve',
    actorId: asString(result.actorId),
    targetKind: targetKind as WarningResponseTargetKind,
    refs: asArray(result.refs).map(asKindRef),
    actions: asActions(result.actions),
  }
}

// ============================================================================
// C34 写入封装（design D-07、D-08）
//
// 冻结完整命令信封：引用带 kind 与 version，不在页面里拼 HTTP 字段。
// commandId 由调用方给出并作幂等键，原载荷重试不改键；取消不得产生零提交。
// ============================================================================

/**
 * 初评/重评统一走 `workflow.start-run`：两种入口同一分支、同一控制字段，
 * 重评额外要求前驱、原因与变化集合，页面不得自行推断变化。
 */
export type StartAssessmentEntryMode = 'assess' | 'reassess'

/** 重评原因沿 vocabulary 的唯一常量，不在页面另写一份枚举。 */
export const WORKFLOW_REASSESSMENT_REASONS_V1 = [
  'monitoring-snapshot',
  'applicability-metadata',
  'applicable-rule-set',
  'weight-strategy',
  'risk-matrix',
] as const

export type WorkflowReassessmentReasonV1 = (typeof WORKFLOW_REASSESSMENT_REASONS_V1)[number]

export interface StartAssessmentInput {
  readonly commandId: string
  readonly graphVersion: VersionRef
  readonly retryPolicyRef: VersionRef
  readonly riskInput: KindRef
  readonly spatialScopeRef: KindRef
  readonly projectRevisionRef?: KindRef
  readonly applicabilityMetadataSnapshotRef: KindRef
  readonly monitoringSnapshotRefs?: readonly KindRef[]
  readonly previousAssessmentRecordRef?: KindRef
  readonly reason?: WorkflowReassessmentReasonV1
  readonly changedInputRefs?: readonly KindRef[]
}

/** P-RA-02 启动初评或重评；返回登记的运行引用，页面据此跳运行深链。 */
export const submitStartAssessment = async (
  projectId: string,
  input: StartAssessmentInput,
  signal?: AbortSignal,
): Promise<{ readonly workflowRunRef: KindRef; readonly entryMode: string }> => {
  const reassess = input.previousAssessmentRecordRef !== undefined
  if (reassess && (input.reason === undefined || (input.changedInputRefs?.length ?? 0) === 0)) {
    throw new ApiError('CONTRACT_INVALID')
  }
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'workflow.start-run',
      commandId: input.commandId,
      payload: reassess
        ? {
            graphVersion: input.graphVersion,
            retryPolicyRef: input.retryPolicyRef,
            entryMode: 'reassess',
            previousAssessmentRecordRef: input.previousAssessmentRecordRef,
            reason: input.reason,
            changedInputRefs: [...(input.changedInputRefs ?? [])],
            riskInput: input.riskInput,
            spatialScopeRef: input.spatialScopeRef,
            ...(input.projectRevisionRef === undefined
              ? {}
              : { projectRevisionRef: input.projectRevisionRef }),
            applicabilityMetadataSnapshotRef: input.applicabilityMetadataSnapshotRef,
            ...(input.monitoringSnapshotRefs === undefined
              ? {}
              : { monitoringSnapshotRefs: [...input.monitoringSnapshotRefs] }),
          }
        : {
            graphVersion: input.graphVersion,
            retryPolicyRef: input.retryPolicyRef,
            entryMode: 'assess',
            riskInput: input.riskInput,
            spatialScopeRef: input.spatialScopeRef,
            ...(input.projectRevisionRef === undefined
              ? {}
              : { projectRevisionRef: input.projectRevisionRef }),
            applicabilityMetadataSnapshotRef: input.applicabilityMetadataSnapshotRef,
            ...(input.monitoringSnapshotRefs === undefined
              ? {}
              : { monitoringSnapshotRefs: [...input.monitoringSnapshotRefs] }),
          },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return {
    workflowRunRef: asKindRef(result.workflowRunRef),
    entryMode: asString(result.entryMode),
  }
}

/** P-WR-02 预警确认：只形成确认事实，不关闭任务。 */
export const submitWarningAcknowledgement = async (
  projectId: string,
  input: {
    readonly commandId: string
    readonly warningRecordRef: KindRef
    readonly warningResponseTaskRef: KindRef
  },
  signal?: AbortSignal,
): Promise<{ readonly warningRecordRef: KindRef }> => {
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'warning-response.acknowledge',
      commandId: input.commandId,
      payload: {
        warningRecordRef: input.warningRecordRef,
        warningResponseTaskRef: input.warningResponseTaskRef,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return { warningRecordRef: asKindRef(result.warningRecordRef) }
}

/**
 * P-RS-01 采纳或拒绝正式建议：拒绝不启动预测。采纳必须带执行前监测快照的精确选择器，
 * 页面不提交“最新监测”。
 */
export const submitRecommendationDecision = async (
  projectId: string,
  input: {
    readonly commandId: string
    readonly responseRecommendationRef: KindRef
    readonly decision: 'adopted' | 'declined'
    readonly reasonCode: string
    readonly preActionMonitoringSnapshotRef?: KindRef
  },
  signal?: AbortSignal,
): Promise<{ readonly routeDecisionRef: KindRef; readonly decision: string }> => {
  if (input.decision === 'adopted' && input.preActionMonitoringSnapshotRef === undefined) {
    throw new ApiError('CONTRACT_INVALID')
  }
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'warning-response.adopt-recommendation',
      commandId: input.commandId,
      payload: {
        responseRecommendationRef: input.responseRecommendationRef,
        decision: input.decision,
        reasonCode: input.reasonCode,
        ...(input.preActionMonitoringSnapshotRef === undefined
          ? {}
          : { preActionMonitoringSnapshotRef: input.preActionMonitoringSnapshotRef }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return {
    routeDecisionRef: asKindRef(result.routeDecisionRef),
    decision: asString(result.decision),
  }
}

/** 证据引用按公共 Schema 组装：`{locator, sourceVersion}`，页面传入已登记的精确来源段与来源版本。 */
export interface EvidenceReferenceInput {
  readonly locator: { readonly sourceSegmentId: string }
  readonly sourceVersion: VersionRef
}

/**
 * P-RS-02 执行登记：两类来源都登记人工事实，采纳路径的建议不会被当作执行记录重复登记。
 * 执行身份取当前 verified actor，不提供自由编辑。
 */
export const submitExecutionRecord = async (
  projectId: string,
  input: {
    readonly commandId: string
    readonly actionSource:
      | {
          readonly kind: 'adopted-recommendation'
          readonly responseRecommendationRef: KindRef
        }
      | { readonly kind: 'independent-action'; readonly measureReleaseRefs: readonly KindRef[] }
    readonly executedByActorId: string
    readonly occurredAt: string
    readonly evidenceReferences: readonly EvidenceReferenceInput[]
  },
  signal?: AbortSignal,
): Promise<{ readonly executionRecordRef: KindRef }> => {
  if (input.evidenceReferences.length === 0) throw new ApiError('CONTRACT_INVALID')
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'warning-response.record-execution',
      commandId: input.commandId,
      payload: {
        actionSource: input.actionSource,
        executedByActorId: input.executedByActorId,
        recordedByActorId: input.executedByActorId,
        occurredAt: input.occurredAt,
        evidenceReferences: input.evidenceReferences,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return { executionRecordRef: asKindRef(result.executionRecordRef) }
}

/** P-RS-02 反馈登记：提交实际评估的精确选择器，页面不提交 P/C 数值。 */
export const submitResponseFeedback = async (
  projectId: string,
  input: {
    readonly commandId: string
    readonly executionRecordRef: KindRef
    readonly postActionMonitoringSnapshotRef: KindRef
    readonly feedbackArtifactRef: KindRef
    readonly occurredAt: string
    readonly actualAssessmentRecordRef: KindRef
  },
  signal?: AbortSignal,
): Promise<{ readonly feedbackRef: KindRef }> => {
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'warning-response.record-feedback',
      commandId: input.commandId,
      payload: {
        executionRecordRef: input.executionRecordRef,
        postActionMonitoringSnapshotRef: input.postActionMonitoringSnapshotRef,
        feedbackArtifactRef: input.feedbackArtifactRef,
        occurredAt: input.occurredAt,
        actualAssessmentRecordRef: input.actualAssessmentRecordRef,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return { feedbackRef: asKindRef(result.feedbackRef) }
}

export type CalibrationReviewOutcomeV1 = 'reject' | 'return-for-revision'

export interface CalibrationReviewOutcomeSubmittedView {
  readonly calibrationSuggestionRef: KindRef
  readonly outcome: CalibrationReviewOutcomeV1
  readonly deviationRecordRef: KindRef
  readonly deviationRecordVersionId: string
}

/**
 * P-RS-05 校准收口：拒绝与退回走各自的公共分支，错误 outcome 在契约边界被拒绝。
 * 命令只接受精确建议与决定引用，不接受裸标识。
 */
export const submitCalibrationReviewOutcome = async (
  projectId: string,
  input: {
    readonly commandId: string
    readonly calibrationSuggestionRef: KindRef
    readonly reviewDecisionRef: KindRef
    readonly outcome: CalibrationReviewOutcomeV1
  },
  signal?: AbortSignal,
): Promise<CalibrationReviewOutcomeSubmittedView> => {
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'warning-response.calibration-review-outcome',
      commandId: input.commandId,
      payload: {
        schemaVersion: '1',
        calibrationSuggestionRef: input.calibrationSuggestionRef,
        reviewDecisionRef: input.reviewDecisionRef,
        outcome: input.outcome,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  const outcome = asString(result.outcome)
  if (outcome !== 'reject' && outcome !== 'return-for-revision') throw drift()
  return {
    calibrationSuggestionRef: asKindRef(result.calibrationSuggestionRef),
    outcome,
    deviationRecordRef: asKindRef(result.deviationRecordRef),
    deviationRecordVersionId: asString(result.deviationRecordVersionId),
  }
}

export interface CalibrationGovernanceDraftSubmittedView {
  readonly governanceDraftRef: KindRef
  readonly knowledgeRevisionRef: KindRef
  readonly candidateArtifactRef: KindRef
  readonly deviationRecordRef: KindRef
  readonly deviationRecordVersionId: string
}

/**
 * P-RS-05 校准草案：只提交未发布修订，发布由既有知识治理负责，页面不得据此显示已发布。
 */
export const submitCalibrationGovernanceDraft = async (
  projectId: string,
  input: {
    readonly commandId: string
    readonly calibrationSuggestionRef: KindRef
    readonly reviewDecisionRef: KindRef
  },
  signal?: AbortSignal,
): Promise<CalibrationGovernanceDraftSubmittedView> => {
  const result = asRecord(
    await submitCommand({
      projectId,
      branch: 'warning-response.calibration-governance-draft',
      commandId: input.commandId,
      payload: {
        schemaVersion: '1',
        calibrationSuggestionRef: input.calibrationSuggestionRef,
        reviewDecisionRef: input.reviewDecisionRef,
        outcome: 'approve-draft-creation',
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return {
    governanceDraftRef: asKindRef(result.governanceDraftRef),
    knowledgeRevisionRef: asKindRef(result.knowledgeRevisionRef),
    candidateArtifactRef: asKindRef(result.candidateArtifactRef),
    deviationRecordRef: asKindRef(result.deviationRecordRef),
    deviationRecordVersionId: asString(result.deviationRecordVersionId),
  }
}
