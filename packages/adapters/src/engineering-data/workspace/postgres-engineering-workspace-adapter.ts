import {
  AccessServiceError,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ModuleErrorV1Schema,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type MonitoringBatchCatalogItemV1,
  type MonitoringSeriesCatalogItemV1,
  type MonitoringSeriesRefV1,
  type MonitoringSnapshotCatalogItemV1,
  type MonitoringSnapshotRefV1,
  type RouteDecisionRefV1,
  type SourceVersionRefV1,
  type SourceSegmentSetRefV1,
  type SpatialScopeRefV1,
  type StructuredDocumentConversionRecordV1,
} from "@riskflow/contracts/ports";
import type {
  DataCleaningExclusionDecisionV1,
  DataCleaningInputStatusV1,
} from "@riskflow/core/engineering-data/cleaning";
import type { VersionReference } from "@riskflow/contracts/common";
import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";
import {
  ENGINEERING_WORKSPACE_PAGE_SIZE_DEFAULT_V1,
  ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1,
  SourceSegmentIdV1Schema,
  type EngineeringWorkspaceIngestionItemV1,
  type EngineeringWorkspaceReadSuccessV1,
} from "@riskflow/contracts/engineering-workspace";
import {
  EngineeringWorkspaceReadRequestV1Schema,
  EngineeringWorkspaceRevisionRequestV1Schema,
} from "@riskflow/core/engineering-data/context-source";
import type {
  ContextSourceResultV1,
  EngineeringContextRevisionCommandV1,
  EngineeringWorkspacePortV1,
  EngineeringWorkspaceReadRequestV1,
  EngineeringWorkspaceReadResultV1,
  EngineeringWorkspaceRevisionRequestV1,
  SourceVersionV1,
} from "@riskflow/core/engineering-data/context-source";
import type {
  ProjectBusinessRevisionV1,
  SpatialBusinessRevisionV1,
} from "@riskflow/contracts/engineering-workspace";

/**
 * 工程工作区窄读适配器（design D-03、D-06）。
 *
 * 它只组合所属领域的既有窄读：C11 工程/空间修订、C12 转换、C15 清洗结果与
 * 监测批次快照。本适配器不建接入任务表、不复制任务状态机，也不从标识符猜因果；
 * 每一条关系都来自已登记事实，缺席即“当前未登记可读取的处理关系”。
 */

/**
 * 所属领域的窄读契约（design D-02）。
 *
 * 工作区只组合这些窄读，不接触各所属者的内部结构；真实实现由各自适配器提供。
 */
export interface WorkspaceContextSourceReaderV1 {
  reviseContext(command: EngineeringContextRevisionCommandV1): Promise<ContextSourceResultV1>;
  readProjectRevision(
    projectId: string,
    versionId: string,
  ): Promise<ProjectBusinessRevisionV1 | undefined>;
  readCurrentProjectRevision(projectId: string): Promise<ProjectBusinessRevisionV1 | undefined>;
  readSpatialRevision(
    projectId: string,
    scopeId: string,
    versionId: string,
  ): Promise<SpatialBusinessRevisionV1 | undefined>;
  readCurrentSpatialRevision(
    projectId: string,
    scopeId: string,
  ): Promise<SpatialBusinessRevisionV1 | undefined>;
  readSourceVersion(
    projectId: string,
    sourceVersionRef: SourceVersionRefV1,
  ): Promise<SourceVersionV1 | undefined>;
  readSegmentSetSummary(
    projectId: string,
    sourceVersionRef: SourceVersionRefV1,
  ): Promise<
    | { readonly sourceSegmentSetRef: SourceSegmentSetRefV1; readonly segmentCount: number }
    | undefined
  >;
}

export interface WorkspaceConversionReaderV1 {
  listBySourceVersion(input: {
    readonly projectId: string;
    readonly sourceVersionRef: SourceVersionRefV1;
    readonly limit: number;
  }): Promise<readonly StructuredDocumentConversionRecordV1[]>;
  readRecordByRef(
    projectId: string,
    conversionRef: StructuredDocumentConversionRecordV1["conversionRef"],
  ): Promise<StructuredDocumentConversionRecordV1 | undefined>;
  readFailureSummary(input: {
    readonly projectId: string;
    readonly conversionRef: StructuredDocumentConversionRecordV1["conversionRef"];
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<{ readonly reasonCode: string; readonly sourceSegmentId?: string } | undefined>;
}

export interface WorkspaceCleaningReaderV1 {
  listResultsForSource(input: {
    readonly projectId: string;
    readonly sourceVersionRef: SourceVersionRefV1;
    readonly limit: number;
  }): Promise<readonly DataCleaningResultForSubjectV1[]>;
  listResultsForMonitoringSnapshots(input: {
    readonly projectId: string;
    readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
    readonly limit: number;
  }): Promise<readonly DataCleaningResultForSubjectV1[]>;
  readResultExclusions(input: {
    readonly projectId: string;
    readonly resultRef: RouteDecisionRefV1;
    readonly subject:
      | { readonly sourceVersionRef: SourceVersionRefV1 }
      | { readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[] };
  }): Promise<readonly DataCleaningExclusionDecisionV1[]>;
}

export interface WorkspaceMonitoringReaderV1 {
  listBatchesBySeries(input: {
    readonly projectId: string;
    readonly monitoringSeriesRef: MonitoringSeriesRefV1;
    readonly limit: number;
  }): Promise<readonly MonitoringBatchCatalogItemV1[]>;
  listSnapshotsBySeries(input: {
    readonly projectId: string;
    readonly monitoringSeriesRef: MonitoringSeriesRefV1;
    readonly limit: number;
  }): Promise<readonly MonitoringSnapshotCatalogItemV1[]>;
  readCurrentSeriesCatalogItem(input: {
    readonly projectId: string;
    readonly seriesId: string;
  }): Promise<MonitoringSeriesCatalogItemV1 | undefined>;
  readSeriesScopeRef(input: {
    readonly projectId: string;
    readonly monitoringSeriesRef: MonitoringSeriesRefV1;
  }): Promise<SpatialScopeRefV1 | undefined>;
}

export interface PostgresEngineeringWorkspaceAdapterOptionsV1 {
  readonly access: LocalIdentityAccessV1;
  readonly contextSource: WorkspaceContextSourceReaderV1;
  readonly conversions: WorkspaceConversionReaderV1;
  readonly cleaning: WorkspaceCleaningReaderV1;
  readonly monitoring: WorkspaceMonitoringReaderV1;
}

type WorkspaceSubjectV1 = SourceVersionRefV1 | MonitoringSeriesRefV1;

/**
 * 与某 subject 相关的正式清洗结果投影（design D-06）。
 *
 * 只含所选输入的可用性事实与结果引用；不复制清洗模型，也不展开整体结果正文。
 */
export interface DataCleaningResultForSubjectV1 {
  readonly resultRef: RouteDecisionRefV1;
  readonly policyRef: VersionReference;
  readonly recordedAt: string;
  readonly input: DataCleaningInputStatusV1;
}

/** 目标不可见：按安全边界拒绝，不区分“存在但无权”与“不存在”。 */
class WorkspaceTargetDeniedError extends Error {}

const workspaceError = (
  code: "AUTHORIZATION_DENIED" | "ENTITY_NOT_FOUND" | "TRANSIENT_FAILURE" | "TERMINAL_FAILURE",
  causalRunId: string,
): ModuleErrorV1 => {
  const common = {
    stageCode: `engineering-data.workspace.${code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: "engineering-data.read",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "3" },
    });
  }
  if (code === "ENTITY_NOT_FOUND") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "not-found",
      retryable: false,
      targetRef: { kind: "query-result", reference: { entityId: causalRunId, versionId: "1" } },
    });
  }
  return ModuleErrorV1Schema.parse({
    ...common,
    code,
    category: "technical",
    retryable: code === "TRANSIENT_FAILURE",
    ...(code === "TRANSIENT_FAILURE"
      ? {
          attempt: 1,
          retryPolicyRef: { entityId: "engineering-data-retry-policy", versionId: "1" },
        }
      : {}),
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "engineering-data-workspace-failure", versionId: "1" },
    },
  });
};

/** 访问域失败按安全口径收敛：不泄露目标是否存在，也不折算成技术故障。 */
const fromAccessError = (error: unknown, causalRunId: string): ModuleErrorV1 => {
  if (error instanceof WorkspaceTargetDeniedError) {
    return workspaceError("AUTHORIZATION_DENIED", causalRunId);
  }
  if (error instanceof AccessServiceError) {
    if (error.details.code === "ACCESS_TRANSIENT_FAILURE") {
      return workspaceError("TRANSIENT_FAILURE", causalRunId);
    }
    if (error.details.code === "ACCESS_TERMINAL_FAILURE") {
      return workspaceError("TERMINAL_FAILURE", causalRunId);
    }
    return workspaceError("AUTHORIZATION_DENIED", causalRunId);
  }
  return workspaceError("TERMINAL_FAILURE", causalRunId);
};

const succeeded = (
  result: EngineeringWorkspaceReadSuccessV1,
): EngineeringWorkspaceReadResultV1 => ({
  kind: "succeeded",
  result,
});

const failed = (error: ModuleErrorV1): EngineeringWorkspaceReadResultV1 => ({
  kind: "failed",
  error,
});

const pageSizeOf = (pageSize: number | undefined): number =>
  pageSize ?? ENGINEERING_WORKSPACE_PAGE_SIZE_DEFAULT_V1;

/** 读取分支：复用既有只读分支资格，不给读角色增授任何写权。 */
const branchFor = (payload: {
  readonly kind: string;
  readonly subject?: WorkspaceSubjectV1;
}): ModuleBranchV1 => {
  if (payload.kind === "context") return "engineering-data.context-read";
  if (payload.kind === "resolve-monitoring" || payload.kind === "monitoring-snapshots") {
    return "engineering-data.monitoring-catalog";
  }
  if (payload.kind === "conversion-failure") return "engineering-data.source-catalog";
  const subject = payload.subject;
  if (subject !== undefined && subject.kind === "monitoring-series") {
    return "engineering-data.monitoring-catalog";
  }
  return "engineering-data.source-catalog";
};

export class PostgresEngineeringWorkspaceAdapter implements EngineeringWorkspacePortV1 {
  readonly #access: LocalIdentityAccessV1;
  readonly #contextSource: WorkspaceContextSourceReaderV1;
  readonly #conversions: WorkspaceConversionReaderV1;
  readonly #cleaning: WorkspaceCleaningReaderV1;
  readonly #monitoring: WorkspaceMonitoringReaderV1;

  constructor(options: PostgresEngineeringWorkspaceAdapterOptionsV1) {
    this.#access = options.access;
    this.#contextSource = options.contextSource;
    this.#conversions = options.conversions;
    this.#cleaning = options.cleaning;
    this.#monitoring = options.monitoring;
  }

  /**
   * 工程业务修订（design D-03）。
   *
   * 命令身份、幂等键与签发时间在确认时冻结；授权按既有 C11 写入口资格签发，
   * 修订事务、审计与事件仍由 C11 拥有。
   */
  async revise(request: EngineeringWorkspaceRevisionRequestV1): Promise<ContextSourceResultV1> {
    const parsed = EngineeringWorkspaceRevisionRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: workspaceError("TERMINAL_FAILURE", "engineering-workspace-revise"),
      };
    }
    const valid = parsed.data;
    try {
      const decision = await this.#access.authorize({
        invocationId: valid.commandId,
        projectId: valid.projectId,
        branch: "engineering-data.register-source-delivery",
        requestedSpatialScopeRefs:
          valid.payload.kind === "spatial" ? [valid.payload.spatialScopeRef] : [],
        requestedSourceVersionRefs: [],
        requestedAt: valid.issuedAt,
        invocation: { kind: "human-session", sessionToken: valid.sessionToken },
      });
      return await this.#contextSource.reviseContext({
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: decision.context.actorId,
        issuedAt: valid.issuedAt,
        authorization: decision.context,
        ...valid.payload,
      });
    } catch (error) {
      return { kind: "failed", error: fromAccessError(error, valid.commandId) };
    }
  }

  async read(
    request: EngineeringWorkspaceReadRequestV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const parsed = EngineeringWorkspaceReadRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return failed(workspaceError("TERMINAL_FAILURE", "engineering-workspace-read"));
    }
    const valid = parsed.data;
    const branch = branchFor(valid.payload);
    try {
      const decision = await this.#access.authorize({
        invocationId: valid.queryId,
        projectId: valid.projectId,
        branch,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: valid.requestedAt,
        invocation: { kind: "human-session", sessionToken: valid.sessionToken },
      });
      switch (valid.payload.kind) {
        case "context":
          return await this.#readContext(valid);
        case "ingestion":
          return await this.#readIngestion(valid, decision);
        case "resolve-monitoring":
          return await this.#readResolveMonitoring(valid, decision);
        case "monitoring-snapshots":
          return await this.#readMonitoringSnapshots(valid, decision);
        case "cleaning-exclusions":
          return await this.#readCleaningExclusions(valid, decision);
        case "conversion-failure":
          return await this.#readConversionFailure(valid, decision);
      }
    } catch (error) {
      return failed(fromAccessError(error, valid.queryId));
    }
  }

  /**
   * 工程与空间上下文精确读（design D-03）。
   *
   * 显式历史修订永不换当前；无首修订时工程为 null，不等于工程不存在。
   */
  async #readContext(
    request: EngineeringWorkspaceReadRequestV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const payload = request.payload;
    if (payload.kind !== "context") {
      return failed(workspaceError("TERMINAL_FAILURE", request.queryId));
    }
    const project =
      payload.projectRevisionRef === undefined
        ? await this.#contextSource.readCurrentProjectRevision(request.projectId)
        : await this.#contextSource.readProjectRevision(
            request.projectId,
            payload.projectRevisionRef.reference.versionId,
          );
    const spatial =
      payload.spatialScopeRef !== undefined
        ? await this.#contextSource.readSpatialRevision(
            request.projectId,
            payload.spatialScopeRef.reference.entityId,
            payload.spatialScopeRef.reference.versionId,
          )
        : payload.scopeId !== undefined
          ? await this.#contextSource.readCurrentSpatialRevision(request.projectId, payload.scopeId)
          : undefined;
    return succeeded({
      kind: "context",
      projectId: request.projectId,
      project: project ?? null,
      spatial: spatial ?? null,
    });
  }

  /**
   * 接入关系目录（design D-06）。
   *
   * 只列该 subject 已登记的转换、资料段、清洗结果与监测批次快照；
   * 阶段缺席以空 items 表达，不折算为“未清洗”或“处理成功”。
   */
  async #readIngestion(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const payload = request.payload;
    if (payload.kind !== "ingestion") {
      return failed(workspaceError("TERMINAL_FAILURE", request.queryId));
    }
    const limit = Math.min(pageSizeOf(payload.pageSize), ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1);
    const subject = payload.subject;
    if (subject.kind === "source-version") {
      await this.#verifySource(request, decision, subject);
      const items: EngineeringWorkspaceIngestionItemV1[] = [];
      const conversions = await this.#conversions.listBySourceVersion({
        projectId: request.projectId,
        sourceVersionRef: subject,
        limit,
      });
      for (const record of conversions) {
        items.push({
          stage: "conversion",
          recordRef: record.conversionRef,
          recordedAt: record.completedAt,
          conversionRef: record.conversionRef,
          status: record.status,
          statistics: record.statistics,
          ...(record.sourceSegmentSetRef === undefined
            ? {}
            : { sourceSegmentSetRef: record.sourceSegmentSetRef }),
          ...(record.diagnosticRef === undefined ? {} : { diagnosticRef: record.diagnosticRef }),
          completedAt: record.completedAt,
        });
      }
      const segmentSet = await this.#contextSource.readSegmentSetSummary(
        request.projectId,
        subject,
      );
      if (segmentSet !== undefined) {
        items.push({
          stage: "segments",
          recordRef: segmentSet.sourceSegmentSetRef,
          recordedAt: decision.context.decidedAt,
          sourceSegmentSetRef: segmentSet.sourceSegmentSetRef,
          segmentCount: segmentSet.segmentCount,
        });
      }
      const results = await this.#cleaning.listResultsForSource({
        projectId: request.projectId,
        sourceVersionRef: subject,
        limit,
      });
      for (const result of results) {
        items.push({
          stage: "cleaning",
          recordRef: result.resultRef,
          recordedAt: result.recordedAt,
          resultRef: result.resultRef,
          policyRef: result.policyRef,
          availability: result.input.availability,
          baselineAvailability: result.input.baselineAvailability,
          totalCount: result.input.totalCount,
          retainedCount: result.input.retainedCount,
          retainedRatio: result.input.retainedRatio,
          reasonCodes: result.input.reasonCodes,
        });
      }
      return succeeded({
        kind: "ingestion",
        projectId: request.projectId,
        subject,
        items: items.slice(0, limit),
      });
    }
    await this.#verifySeries(request, decision, subject);
    const items: EngineeringWorkspaceIngestionItemV1[] = [];
    const batches = await this.#monitoring.listBatchesBySeries({
      projectId: request.projectId,
      monitoringSeriesRef: subject,
      limit,
    });
    for (const batch of batches) {
      items.push({
        stage: "monitoring-batch",
        recordRef: batch.monitoringBatchRef,
        recordedAt: batch.occurredAt,
        batch,
      });
    }
    const snapshots = await this.#monitoring.listSnapshotsBySeries({
      projectId: request.projectId,
      monitoringSeriesRef: subject,
      limit,
    });
    for (const snapshot of snapshots) {
      items.push({
        stage: "monitoring-snapshot",
        recordRef: snapshot.monitoringSnapshotRef,
        recordedAt: snapshot.cutoff,
        snapshot,
      });
    }
    const seriesSnapshots = await this.#monitoring.listSnapshotsBySeries({
      projectId: request.projectId,
      monitoringSeriesRef: subject,
      limit: ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1,
    });
    const cleaningResults = await this.#cleaning.listResultsForMonitoringSnapshots({
      projectId: request.projectId,
      monitoringSnapshotRefs: seriesSnapshots.map((snapshot) => snapshot.monitoringSnapshotRef),
      limit,
    });
    for (const result of cleaningResults) {
      items.push({
        stage: "cleaning",
        recordRef: result.resultRef,
        recordedAt: result.recordedAt,
        resultRef: result.resultRef,
        policyRef: result.policyRef,
        availability: result.input.availability,
        baselineAvailability: result.input.baselineAvailability,
        totalCount: result.input.totalCount,
        retainedCount: result.input.retainedCount,
        retainedRatio: result.input.retainedRatio,
        reasonCodes: result.input.reasonCodes,
      });
    }
    return succeeded({
      kind: "ingestion",
      projectId: request.projectId,
      subject,
      items: items.slice(0, limit),
    });
  }

  /**
   * 无版本旧序列地址的窄解析（design D-06）。
   *
   * 只按稳定序列身份解析当前可见引用；解析不到即拒绝，不回落目录首页首条。
   */
  async #readResolveMonitoring(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const payload = request.payload;
    if (payload.kind !== "resolve-monitoring") {
      return failed(workspaceError("TERMINAL_FAILURE", request.queryId));
    }
    const item = await this.#monitoring.readCurrentSeriesCatalogItem({
      projectId: request.projectId,
      seriesId: payload.seriesId,
    });
    if (item === undefined) {
      return failed(workspaceError("ENTITY_NOT_FOUND", request.queryId));
    }
    await this.#verifySeries(
      request,
      decision,
      {
        kind: "monitoring-series",
        reference: item.monitoringSeriesRef.reference,
      },
      [item.spatialScopeRef],
    );
    return succeeded({ kind: "resolve-monitoring", series: item });
  }

  /** 精确序列的快照选择（design D-06）。 */
  async #readMonitoringSnapshots(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const payload = request.payload;
    if (payload.kind !== "monitoring-snapshots") {
      return failed(workspaceError("TERMINAL_FAILURE", request.queryId));
    }
    const scopeRef = await this.#monitoring.readSeriesScopeRef({
      projectId: request.projectId,
      monitoringSeriesRef: payload.monitoringSeriesRef,
    });
    await this.#verifySeries(
      request,
      decision,
      payload.monitoringSeriesRef,
      scopeRef === undefined ? [] : [scopeRef],
    );
    const limit = Math.min(pageSizeOf(payload.pageSize), ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1);
    const items = await this.#monitoring.listSnapshotsBySeries({
      projectId: request.projectId,
      monitoringSeriesRef: payload.monitoringSeriesRef,
      limit,
    });
    return succeeded({ kind: "monitoring-snapshots", items: [...items] });
  }

  /**
   * 正式清洗结果的排除项（design D-06）。
   *
   * 只返回属于该 subject 的判定；结果引用不可读时不披露任何条目。
   */
  async #readCleaningExclusions(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const payload = request.payload;
    if (payload.kind !== "cleaning-exclusions") {
      return failed(workspaceError("TERMINAL_FAILURE", request.queryId));
    }
    const limit = Math.min(pageSizeOf(payload.pageSize), ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1);
    let subject:
      | { readonly sourceVersionRef: SourceVersionRefV1 }
      | { readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[] };
    if (payload.subject.kind === "source-version") {
      await this.#verifySource(request, decision, payload.subject);
      subject = { sourceVersionRef: payload.subject };
    } else {
      await this.#verifySeries(request, decision, payload.subject);
      const snapshots = await this.#monitoring.listSnapshotsBySeries({
        projectId: request.projectId,
        monitoringSeriesRef: payload.subject,
        limit: ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1,
      });
      subject = {
        monitoringSnapshotRefs: snapshots.map((snapshot) => snapshot.monitoringSnapshotRef),
      };
    }
    const exclusions = await this.#cleaning.readResultExclusions({
      projectId: request.projectId,
      resultRef: payload.resultRef,
      subject,
    });
    return succeeded({
      kind: "cleaning-exclusions",
      items: exclusions.slice(0, limit).map((item) => ({
        decisionId: item.decisionId,
        targetKind: item.targetKind,
        reasonCode: item.reasonCode,
        disposition: item.disposition,
        ...(item.rejectionClass === undefined ? {} : { rejectionClass: item.rejectionClass }),
        ...(item.sourceSegmentId === undefined ? {} : { sourceSegmentId: item.sourceSegmentId }),
        ...(item.sampleVersionRef === undefined ? {} : { sampleVersionRef: item.sampleVersionRef }),
        evidenceReferences: item.evidenceReferences,
      })),
    });
  }

  /**
   * 失败转换的安全诊断摘要（design D-06）。
   *
   * 只给原因码与段定位；诊断正文不进入工作区读面。
   */
  async #readConversionFailure(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
  ): Promise<EngineeringWorkspaceReadResultV1> {
    const payload = request.payload;
    if (payload.kind !== "conversion-failure") {
      return failed(workspaceError("TERMINAL_FAILURE", request.queryId));
    }
    const record = await this.#conversions.readRecordByRef(
      request.projectId,
      payload.conversionRef,
    );
    if (record === undefined) {
      return failed(workspaceError("ENTITY_NOT_FOUND", request.queryId));
    }
    await this.#verifySource(request, decision, record.sourceVersionRef);
    const summary = await this.#conversions.readFailureSummary({
      projectId: request.projectId,
      conversionRef: payload.conversionRef,
      actorId: decision.context.actorId,
      requestedAt: request.requestedAt,
      authorization: decision.context,
    });
    if (summary === undefined) {
      return failed(workspaceError("ENTITY_NOT_FOUND", request.queryId));
    }
    return succeeded({
      kind: "conversion-failure",
      conversionRef: payload.conversionRef,
      reasonCode: summary.reasonCode,
      ...(summary.sourceSegmentId === undefined
        ? {}
        : { sourceSegmentId: SourceSegmentIdV1Schema.parse(summary.sourceSegmentId) }),
    });
  }

  /** 目标来源的当前权限复验：来源授权与空间范围都按已登记事实收窄。 */
  async #verifySource(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
    sourceVersionRef: SourceVersionRefV1,
  ): Promise<void> {
    const source = await this.#contextSource.readSourceVersion(request.projectId, sourceVersionRef);
    if (source === undefined) {
      throw new WorkspaceTargetDeniedError("workspace source target is not visible");
    }
    await this.#access.verify({
      authorizationContextRef: decision.context.authorizationContextRef,
      invocationId: request.queryId,
      projectId: request.projectId,
      branch: "engineering-data.source-catalog",
      requestedSpatialScopeRefs: source.spatialScopeRefs,
      requestedSourceVersionRefs: [sourceVersionRef],
      requestedAt: decision.context.decidedAt,
    });
  }

  /** 目标监测序列的当前权限复验：按序列登记的空间范围收窄。 */
  async #verifySeries(
    request: EngineeringWorkspaceReadRequestV1,
    decision: AuthorizationDecisionV1,
    seriesRef: MonitoringSeriesRefV1,
    scopeRefs: readonly SpatialScopeRefV1[] = [],
  ): Promise<void> {
    const fallback = await this.#monitoring.readSeriesScopeRef({
      projectId: request.projectId,
      monitoringSeriesRef: seriesRef,
    });
    const resolved: SpatialScopeRefV1[] =
      scopeRefs.length > 0 ? [...scopeRefs] : fallback === undefined ? [] : [fallback];
    await this.#access.verify({
      authorizationContextRef: decision.context.authorizationContextRef,
      invocationId: request.queryId,
      projectId: request.projectId,
      branch: "engineering-data.monitoring-catalog",
      requestedSpatialScopeRefs: resolved,
      requestedSourceVersionRefs: [],
      requestedAt: decision.context.decidedAt,
    });
  }
}

export const createPostgresEngineeringWorkspaceAdapter = (
  options: PostgresEngineeringWorkspaceAdapterOptionsV1,
): PostgresEngineeringWorkspaceAdapter => new PostgresEngineeringWorkspaceAdapter(options);
