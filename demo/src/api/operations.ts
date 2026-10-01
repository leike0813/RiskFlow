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

/** 评估/处置链运行摘要：登记 risk-overview 投影查询后读尽 run-summary 条目。 */
export const readRiskOverviewRuns = async (
  projectId: string,
  projectRevisionRef: KindRef,
  signal?: AbortSignal,
): Promise<RunSummaryItemView[]> =>
  (
    await readProjectionItems(
      projectId,
      'risk-overview',
      { queryType: 'risk-overview', projectRevisionRef },
      signal,
    )
  ).flatMap((item) => {
    const summary = asRunSummaryItem(item)
    return summary === null ? [] : [summary]
  })
