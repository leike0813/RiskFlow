import { sha256CanonicalJson } from "../../persistence/canonical-json.js";
import { ACCESS_POLICY_REF_V1, branchCapability } from "../../access/policy.js";
import {
  ModuleErrorV1Schema,
  type ContractReferenceV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import {
  CONTEXT_SOURCE_SCHEMA_VERSION_V1,
  ContextSourceResultV1Schema,
  CreateApplicabilitySnapshotCommandV1Schema,
  EngineeringContextRevisionCommandV1Schema,
  ProjectBusinessRevisionV1Schema,
  RegisterSourceSegmentSetCommandV1Schema,
  ResolveSourceVersionForReadQueryV1Schema,
  ResolveSourceProcessingInputQueryV1Schema,
  SourceSegmentSetV1Schema,
  SourceProcessingInputV1Schema,
  SourceVersionV1Schema,
  SpatialBusinessRevisionV1Schema,
  type ApplicabilityMetadataSnapshotV1,
  type ContextSourceCommandV1,
  type ContextSourceResultV1,
  type ContextSourceSuccessV1,
  type CreateApplicabilitySnapshotCommandV1,
  type EngineeringContextRevisionCommandV1,
  type ProjectBusinessRevisionV1,
  type RegisterSourceSegmentSetCommandV1,
  type ResolveSourceProcessingInputQueryV1,
  type ResolveSourceVersionForReadQueryV1,
  type SourceProcessingInputV1,
  type SourceSegmentSetV1,
  type SourceVersionV1,
  type SpatialBusinessRevisionV1,
  type SpatialApplicabilityOverridesV1,
} from "./schema.js";
import {
  ApplicabilityMetadataSnapshotV1Schema,
  ApplicabilityProvenanceV1Schema,
  ApplicabilityValueProvenanceV1Schema,
  ContextAuditV1Schema,
  SourceSegmentV1Schema,
  normalizeSourceSegments,
  normalizeSpatialScopeRefs,
  parseSourceSegmentId,
  versionReferenceEquals,
} from "./schema.js";

const moduleError = (
  value:
    | { code: "AUTHORIZATION_DENIED"; causalRunId: string }
    | {
        code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        causalRunId: string;
        targetRef: ContractReferenceV1;
      }
    | {
        code: "IDEMPOTENCY_CONFLICT";
        causalRunId: string;
        idempotencyKey: string;
        priorCommandId: string;
      }
    | { code: "BUSINESS_BLOCKED"; causalRunId: string; blockerRef: ContractReferenceV1 }
    | {
        code: "UNSUPPORTED_CONTRACT" | "TRANSIENT_FAILURE" | "TERMINAL_FAILURE";
        causalRunId: string;
      },
) => {
  const common = {
    stageCode: `engineering-data.context-source.${value.code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId: value.causalRunId,
  };
  if (value.code === "AUTHORIZATION_DENIED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: value.code,
      category: "authorization",
      retryable: false,
      requiredCapability: branchCapability("engineering-data.register-source-delivery"),
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    });
  }
  if (value.code === "ENTITY_NOT_FOUND" || value.code === "STALE_VERSION") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: value.code,
      category: value.code === "ENTITY_NOT_FOUND" ? "not-found" : "concurrency",
      retryable: false,
      targetRef: value.targetRef,
    });
  }
  if (value.code === "IDEMPOTENCY_CONFLICT") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: value.code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: value.idempotencyKey,
      priorCommandId: value.priorCommandId,
    });
  }
  if (value.code === "BUSINESS_BLOCKED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: value.code,
      category: "business-blocked",
      retryable: false,
      blockerKind: value.blockerRef.kind,
      blockerRef: value.blockerRef,
    });
  }
  if (value.code === "UNSUPPORTED_CONTRACT") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: value.code,
      category: "technical",
      retryable: false,
      schemaVersion: CONTEXT_SOURCE_SCHEMA_VERSION_V1,
    });
  }
  return ModuleErrorV1Schema.parse({
    ...common,
    code: value.code,
    category: "technical",
    retryable: value.code === "TRANSIENT_FAILURE",
    ...(value.code === "TRANSIENT_FAILURE"
      ? {
          attempt: 1,
          retryPolicyRef: { entityId: "engineering-data-retry-policy", versionId: "1" },
          diagnosticRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "engineering-data-context-source-failure", versionId: "1" },
          },
        }
      : {
          diagnosticRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "engineering-data-context-source-failure", versionId: "1" },
          },
        }),
  });
};

const failure = (error: ReturnType<typeof moduleError>): ContextSourceResultV1 =>
  ContextSourceResultV1Schema.parse({ kind: "failed", error });

const succeeded = (result: ContextSourceSuccessV1): ContextSourceResultV1 =>
  ContextSourceResultV1Schema.parse({ kind: "succeeded", result });

const reference = (
  kind: ContractReferenceV1["kind"],
  entityId: string,
  versionId: string,
): ContractReferenceV1 =>
  ({
    kind,
    reference: { entityId, versionId },
  }) as ContractReferenceV1;

const auditFor = (command: { actorId: string; issuedAt: string }, action: string) =>
  ContextAuditV1Schema.parse({
    actorId: command.actorId,
    action,
    recordedAt: command.issuedAt,
  });

const nextVersionId = (previous: { reference: { versionId: string } } | undefined): string => {
  if (previous === undefined) return "1";
  const number = Number(previous.reference.versionId);
  return Number.isSafeInteger(number) && number >= 1
    ? String(number + 1)
    : `${previous.reference.versionId}-next`;
};

const lifecycleRank: Record<ProjectBusinessRevisionV1["lifecycle"], number> = {
  preparing: 0,
  active: 1,
  ended: 2,
  archived: 3,
};

const commandKey = (command: ContextSourceCommandV1, kind: string): string =>
  `${command.projectId}\u0000${kind}\u0000${command.idempotencyKey}`;

const targetRef = (kind: string, ref: { reference: { entityId: string; versionId: string } }) =>
  reference(kind as ContractReferenceV1["kind"], ref.reference.entityId, ref.reference.versionId);

const expectedMatches = (
  expected: VersionReference | "none",
  current: { reference: { entityId: string; versionId: string } } | undefined,
): boolean =>
  expected === "none"
    ? current === undefined
    : current !== undefined &&
      expected.entityId === current.reference.entityId &&
      expected.versionId === current.reference.versionId;

const projectIdFromRevision = (revision: ProjectBusinessRevisionV1): string =>
  revision.projectRevisionRef.reference.entityId;

const spatialKey = (projectId: string, scopeRef: SpatialScopeRefV1): string =>
  `${projectId}\u0000${scopeRef.reference.entityId}`;

const projectRevisionFromCommand = (
  command: Extract<EngineeringContextRevisionCommandV1, { kind: "project" }>,
  previous: ProjectBusinessRevisionV1 | undefined,
): ProjectBusinessRevisionV1 =>
  ProjectBusinessRevisionV1Schema.parse({
    projectRevisionRef: {
      kind: "project-revision",
      reference: {
        entityId: command.projectId,
        versionId: nextVersionId(previous?.projectRevisionRef),
      },
    },
    name: command.name,
    lifecycle: command.lifecycle,
    applicabilityMetadata: command.applicabilityMetadata,
    effectivePeriod: command.effectivePeriod,
    systemTime: { recordedAt: command.issuedAt },
    ...(previous === undefined ? {} : { previousRevisionRef: previous.projectRevisionRef }),
    audit: auditFor(command, "engineering-data.revise-project-context"),
  });

const spatialRevisionFromCommand = (
  command: Extract<EngineeringContextRevisionCommandV1, { kind: "spatial" }>,
  previous: SpatialBusinessRevisionV1 | undefined,
): SpatialBusinessRevisionV1 => {
  const spatialScopeRef =
    previous === undefined
      ? command.spatialScopeRef
      : {
          kind: "spatial-scope" as const,
          reference: {
            entityId: command.spatialScopeRef.reference.entityId,
            versionId: nextVersionId(previous.spatialScopeRef),
          },
        };
  return SpatialBusinessRevisionV1Schema.parse({
    spatialScopeRef,
    projectRevisionRef: command.projectRevisionRef,
    ...(command.parentScopeRef === undefined ? {} : { parentScopeRef: command.parentScopeRef }),
    name: command.name,
    worksiteLocation: command.worksiteLocation,
    ...(command.chainage === undefined ? {} : { chainage: command.chainage }),
    applicabilityOverrides: command.applicabilityOverrides,
    status: command.status,
    effectivePeriod: command.effectivePeriod,
    systemTime: { recordedAt: command.issuedAt },
    ...(previous === undefined ? {} : { previousRevisionRef: previous.spatialScopeRef }),
    audit: auditFor(command, "engineering-data.revise-spatial-context"),
  });
};

const scopeIsCovered = (
  requested: readonly SpatialScopeRefV1[],
  allowed: readonly SpatialScopeRefV1[],
): boolean => {
  const allowedKeys = new Set(
    allowed.map((item) => `${item.reference.entityId}/${item.reference.versionId}`),
  );
  return requested.every((item) =>
    allowedKeys.has(`${item.reference.entityId}/${item.reference.versionId}`),
  );
};

const sourceGrantIsCovered = (
  requested: { reference: { entityId: string; versionId: string } },
  allowed: readonly { reference: { entityId: string; versionId: string } }[],
): boolean =>
  allowed.some(
    (item) =>
      item.reference.entityId === requested.reference.entityId &&
      item.reference.versionId === requested.reference.versionId,
  );

const processingInputFromSourceVersion = (
  sourceVersion: SourceVersionV1,
): SourceProcessingInputV1 =>
  SourceProcessingInputV1Schema.parse({
    sourceVersionRef: sourceVersion.sourceVersionRef,
    projectId: sourceVersion.projectId,
    sourceId: sourceVersion.sourceId,
    sourceItemId: sourceVersion.sourceItemId,
    projectRevisionRef: sourceVersion.projectRevisionRef,
    spatialScopeRefs: sourceVersion.spatialScopeRefs,
    sourceArtifactRef: sourceVersion.sourceArtifactRef,
    metadataArtifactRef: sourceVersion.metadataArtifactRef,
    sourceAccessGrantRef: sourceVersion.sourceAccessGrantRef,
    applicabilityMetadataSnapshotRef: sourceVersion.applicabilityMetadataSnapshotRef,
  });

const segmentSetFromCommand = (
  command: RegisterSourceSegmentSetCommandV1,
  sourceVersion: SourceVersionV1,
): SourceSegmentSetV1 => {
  if (sourceVersion.projectId !== command.projectId) {
    throw new Error("source version belongs to another project");
  }
  if (sourceVersion.sourceId !== command.sourceId) {
    throw new Error("source id does not match source version");
  }
  if (sourceVersion.accessStatus !== "ready") {
    throw new Error("source access is not ready");
  }
  const segments = command.segments.map((segment) => SourceSegmentV1Schema.parse(segment));
  const ids = new Set<string>();
  for (const segment of segments) {
    if (ids.has(segment.sourceSegmentId)) throw new Error("duplicate source segment");
    ids.add(segment.sourceSegmentId);
    const parts = parseSourceSegmentId(segment.sourceSegmentId);
    if (
      parts === undefined ||
      parts.sourceId !== command.sourceId ||
      parts.chapterId !== segment.chapterId ||
      parts.segmentId !== segment.segmentId
    ) {
      throw new Error("source segment identity does not match its components");
    }
    if (!scopeIsCovered(segment.spatialScopeRefs, sourceVersion.spatialScopeRefs)) {
      throw new Error("source segment scope is outside source version scope");
    }
  }
  const setRef = {
    kind: "source-segment-set" as const,
    reference: { entityId: `segment-set-${command.commandId}`, versionId: "1" },
  };
  return SourceSegmentSetV1Schema.parse({
    sourceSegmentSetRef: setRef,
    sourceVersionRef: sourceVersion.sourceVersionRef,
    sourceId: sourceVersion.sourceId,
    segments: normalizeSourceSegments(
      segments.map((segment) => ({
        ...segment,
        spatialScopeRefs: normalizeSpatialScopeRefs(segment.spatialScopeRefs),
      })),
    ),
    recordedAt: command.issuedAt,
    audit: auditFor(command, "engineering-data.register-source-segments"),
  });
};

const mergeApplicability = (
  project: ProjectBusinessRevisionV1,
  overrides: SpatialApplicabilityOverridesV1,
) => ({
  constructionMethod:
    overrides.constructionMethod ?? project.applicabilityMetadata.constructionMethod,
  stratumCondition: overrides.stratumCondition ?? project.applicabilityMetadata.stratumCondition,
  engineeringStage: overrides.engineeringStage ?? project.applicabilityMetadata.engineeringStage,
});

const applicabilitySnapshotFromParts = (
  command: CreateApplicabilitySnapshotCommandV1,
  project: ProjectBusinessRevisionV1,
  spatial: SpatialBusinessRevisionV1,
): ApplicabilityMetadataSnapshotV1 => {
  if (!versionReferenceEquals(project.projectRevisionRef, command.projectRevisionRef)) {
    throw new Error("project revision does not match current context");
  }
  if (!versionReferenceEquals(spatial.projectRevisionRef, command.projectRevisionRef)) {
    throw new Error("spatial revision belongs to another project revision");
  }
  const applicabilityMetadata = mergeApplicability(project, spatial.applicabilityOverrides);
  const provenance = ApplicabilityProvenanceV1Schema.parse({
    constructionMethod: ApplicabilityValueProvenanceV1Schema.parse(
      spatial.applicabilityOverrides.constructionMethod === undefined
        ? { source: "project-revision", revisionRef: project.projectRevisionRef }
        : { source: "spatial-scope-revision", revisionRef: spatial.spatialScopeRef },
    ),
    stratumCondition: ApplicabilityValueProvenanceV1Schema.parse(
      spatial.applicabilityOverrides.stratumCondition === undefined
        ? { source: "project-revision", revisionRef: project.projectRevisionRef }
        : { source: "spatial-scope-revision", revisionRef: spatial.spatialScopeRef },
    ),
    engineeringStage: ApplicabilityValueProvenanceV1Schema.parse(
      spatial.applicabilityOverrides.engineeringStage === undefined
        ? { source: "project-revision", revisionRef: project.projectRevisionRef }
        : { source: "spatial-scope-revision", revisionRef: spatial.spatialScopeRef },
    ),
  });
  return ApplicabilityMetadataSnapshotV1Schema.parse({
    snapshotRef: {
      kind: "applicability-metadata-snapshot",
      reference: {
        entityId: `applicability-${command.projectRevisionRef.reference.entityId}-${command.spatialScopeRef.reference.entityId}-${command.commandId}`,
        versionId: "1",
      },
    },
    applicabilityMetadata,
    provenance,
    projectRevisionRef: project.projectRevisionRef,
    spatialScopeRef: spatial.spatialScopeRef,
    formedAt: command.formedAt,
    worksiteLocation: spatial.worksiteLocation,
    ...(spatial.chainage === undefined ? {} : { chainage: spatial.chainage }),
    audit: auditFor(command, "engineering-data.create-applicability-snapshot"),
  });
};

export interface EngineeringContextSourceRegistryV1 {
  reviseContext(command: EngineeringContextRevisionCommandV1): Promise<ContextSourceResultV1>;
  registerSegments(command: RegisterSourceSegmentSetCommandV1): Promise<ContextSourceResultV1>;
  resolveSourceProcessingInput(
    query: ResolveSourceProcessingInputQueryV1,
  ): Promise<ContextSourceResultV1>;
  resolveSourceVersionForRead(
    query: ResolveSourceVersionForReadQueryV1,
  ): Promise<ContextSourceResultV1>;
  createApplicabilitySnapshot(
    command: CreateApplicabilitySnapshotCommandV1,
  ): Promise<ContextSourceResultV1>;
}

export interface EngineeringContextSourceSeedV1 {
  readonly projects?: readonly ProjectBusinessRevisionV1[];
  readonly spatialScopes?: readonly SpatialBusinessRevisionV1[];
  readonly sourceVersions?: readonly SourceVersionV1[];
}

export class EngineeringContextSourceService implements EngineeringContextSourceRegistryV1 {
  readonly #projects = new Map<string, ProjectBusinessRevisionV1>();
  readonly #spatialScopes = new Map<string, SpatialBusinessRevisionV1>();
  readonly #sourceVersions = new Map<string, SourceVersionV1>();
  readonly #segmentSets = new Map<string, SourceSegmentSetV1>();
  readonly #idempotency = new Map<
    string,
    { hash: string; commandId: string; result: ContextSourceResultV1 }
  >();

  constructor(seed: EngineeringContextSourceSeedV1 = {}) {
    for (const revision of seed.projects ?? [])
      this.#projects.set(projectIdFromRevision(revision), revision);
    for (const revision of seed.spatialScopes ?? []) {
      this.#spatialScopes.set(
        spatialKey(revision.projectRevisionRef.reference.entityId, revision.spatialScopeRef),
        revision,
      );
    }
    for (const version of seed.sourceVersions ?? []) {
      this.#sourceVersions.set(
        `${version.sourceVersionRef.reference.entityId}/${version.sourceVersionRef.reference.versionId}`,
        SourceVersionV1Schema.parse(version),
      );
    }
  }

  async reviseContext(
    command: EngineeringContextRevisionCommandV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = EngineeringContextRevisionCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return failure(
        moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "context-revision" }),
      );
    const valid = parsed.data;
    const kind = valid.kind === "project" ? "project-revision" : "spatial-revision";
    const key = commandKey(valid, `engineering-data.${kind}`);
    const prior = this.#idempotency.get(key);
    const hash = sha256CanonicalJson(valid);
    if (prior !== undefined) {
      return prior.hash === hash
        ? prior.result
        : failure(
            moduleError({
              code: "IDEMPOTENCY_CONFLICT",
              causalRunId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
              priorCommandId: prior.commandId,
            }),
          );
    }
    if (
      valid.projectId !== valid.authorization.projectId ||
      valid.actorId !== valid.authorization.actorId ||
      !valid.authorization.grantedCapabilities.includes("engineering-data.write")
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.commandId }));
    }
    try {
      const result =
        valid.kind === "project" ? this.#reviseProject(valid) : this.#reviseSpatial(valid);
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    } catch {
      const result = failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: valid.commandId,
          blockerRef: reference("project-revision", valid.projectId, "1"),
        }),
      );
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    }
  }

  async registerSegments(
    command: RegisterSourceSegmentSetCommandV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = RegisterSourceSegmentSetCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return failure(moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "source-segments" }));
    const valid = parsed.data;
    const key = commandKey(valid, "engineering-data.source-segments");
    const prior = this.#idempotency.get(key);
    const hash = sha256CanonicalJson(valid);
    if (prior !== undefined) {
      return prior.hash === hash
        ? prior.result
        : failure(
            moduleError({
              code: "IDEMPOTENCY_CONFLICT",
              causalRunId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
              priorCommandId: prior.commandId,
            }),
          );
    }
    if (
      valid.projectId !== valid.authorization.projectId ||
      valid.actorId !== valid.authorization.actorId ||
      !valid.authorization.grantedCapabilities.includes("engineering-data.write")
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.commandId }));
    }
    const sourceVersion = this.#sourceVersions.get(
      `${valid.sourceVersionRef.reference.entityId}/${valid.sourceVersionRef.reference.versionId}`,
    );
    if (sourceVersion === undefined) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.commandId }));
    }
    if (
      valid.segments.some(
        (segment) =>
          !scopeIsCovered(segment.spatialScopeRefs, valid.authorization.spatialScopeRefs),
      )
    ) {
      const result = failure(
        moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.commandId }),
      );
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    }
    const segmentSetKey = `${valid.sourceVersionRef.reference.entityId}/${valid.sourceVersionRef.reference.versionId}`;
    if (this.#segmentSets.has(segmentSetKey)) {
      const result = failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: valid.commandId,
          blockerRef: targetRef("source-version", valid.sourceVersionRef),
        }),
      );
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    }
    try {
      const set = segmentSetFromCommand(valid, sourceVersion);
      const result = succeeded({ kind: "source-segment-set", segmentSet: set });
      this.#segmentSets.set(segmentSetKey, set);
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    } catch {
      const result = failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: valid.commandId,
          blockerRef: targetRef("source-version", valid.sourceVersionRef),
        }),
      );
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    }
  }

  async resolveSourceProcessingInput(
    query: ResolveSourceProcessingInputQueryV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = ResolveSourceProcessingInputQueryV1Schema.safeParse(query);
    if (!parsed.success)
      return failure(
        moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "source-processing-input" }),
      );
    const valid = parsed.data;
    if (
      valid.projectId !== valid.authorization.projectId ||
      valid.actorId !== valid.authorization.actorId ||
      (!valid.authorization.grantedCapabilities.includes("engineering-data.read") &&
        !valid.authorization.grantedCapabilities.includes("engineering-data.write"))
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.queryId }));
    }
    const sourceVersion = this.#sourceVersions.get(
      `${valid.sourceVersionRef.reference.entityId}/${valid.sourceVersionRef.reference.versionId}`,
    );
    if (
      sourceVersion === undefined ||
      sourceVersion.projectId !== valid.projectId ||
      sourceVersion.accessStatus !== "ready" ||
      sourceVersion.sourceAccessGrantRef === undefined ||
      !sourceGrantIsCovered(
        sourceVersion.sourceAccessGrantRef,
        valid.authorization.sourceAccessGrantRefs,
      ) ||
      !scopeIsCovered(sourceVersion.spatialScopeRefs, valid.authorization.spatialScopeRefs)
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.queryId }));
    }
    const project = this.#projects.get(valid.projectId);
    if (
      project === undefined ||
      !versionReferenceEquals(project.projectRevisionRef, sourceVersion.projectRevisionRef)
    ) {
      return failure(
        moduleError({
          code: "STALE_VERSION",
          causalRunId: valid.queryId,
          targetRef: targetRef("source-version", valid.sourceVersionRef),
        }),
      );
    }
    const input = processingInputFromSourceVersion(sourceVersion);
    return succeeded({ kind: "source-processing-input", input });
  }

  async resolveSourceVersionForRead(
    query: ResolveSourceVersionForReadQueryV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = ResolveSourceVersionForReadQueryV1Schema.safeParse(query);
    if (!parsed.success)
      return failure(
        moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "source-version-read" }),
      );
    const valid = parsed.data;
    if (
      valid.projectId !== valid.authorization.projectId ||
      valid.actorId !== valid.authorization.actorId ||
      (!valid.authorization.grantedCapabilities.includes("engineering-data.read") &&
        !valid.authorization.grantedCapabilities.includes("engineering-data.write"))
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.queryId }));
    }
    const sourceVersion = this.#sourceVersions.get(
      `${valid.sourceVersionRef.reference.entityId}/${valid.sourceVersionRef.reference.versionId}`,
    );
    if (
      sourceVersion === undefined ||
      sourceVersion.projectId !== valid.projectId ||
      sourceVersion.accessStatus !== "ready" ||
      sourceVersion.sourceAccessGrantRef === undefined ||
      !sourceGrantIsCovered(
        sourceVersion.sourceAccessGrantRef,
        valid.authorization.sourceAccessGrantRefs,
      ) ||
      !scopeIsCovered(sourceVersion.spatialScopeRefs, valid.authorization.spatialScopeRefs)
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.queryId }));
    }
    const input = processingInputFromSourceVersion(sourceVersion);
    return succeeded({ kind: "source-processing-input", input });
  }

  async createApplicabilitySnapshot(
    command: CreateApplicabilitySnapshotCommandV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = CreateApplicabilitySnapshotCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return failure(
        moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "applicability-snapshot" }),
      );
    const valid = parsed.data;
    const key = commandKey(valid, "engineering-data.applicability-snapshot");
    const prior = this.#idempotency.get(key);
    const hash = sha256CanonicalJson(valid);
    if (prior !== undefined) {
      return prior.hash === hash
        ? prior.result
        : failure(
            moduleError({
              code: "IDEMPOTENCY_CONFLICT",
              causalRunId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
              priorCommandId: prior.commandId,
            }),
          );
    }
    if (
      valid.projectId !== valid.authorization.projectId ||
      valid.actorId !== valid.authorization.actorId ||
      !valid.authorization.grantedCapabilities.includes("engineering-data.write") ||
      valid.projectRevisionRef.reference.entityId !== valid.projectId
    ) {
      return failure(moduleError({ code: "AUTHORIZATION_DENIED", causalRunId: valid.commandId }));
    }
    const project = this.#projects.get(valid.projectRevisionRef.reference.entityId);
    const spatial = this.#spatialScopes.get(spatialKey(valid.projectId, valid.spatialScopeRef));
    if (
      project === undefined ||
      spatial === undefined ||
      !versionReferenceEquals(project.projectRevisionRef, valid.projectRevisionRef) ||
      !versionReferenceEquals(spatial.spatialScopeRef, valid.spatialScopeRef)
    ) {
      return failure(
        moduleError({
          code: "ENTITY_NOT_FOUND",
          causalRunId: valid.commandId,
          targetRef: targetRef("project-revision", valid.projectRevisionRef),
        }),
      );
    }
    if (
      project.lifecycle === "ended" ||
      project.lifecycle === "archived" ||
      spatial.status !== "active"
    ) {
      return failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: valid.commandId,
          blockerRef: targetRef("spatial-scope", valid.spatialScopeRef),
        }),
      );
    }
    try {
      const snapshot = applicabilitySnapshotFromParts(valid, project, spatial);
      const result = succeeded({ kind: "applicability-snapshot", snapshot });
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    } catch {
      const result = failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: valid.commandId,
          blockerRef: targetRef("spatial-scope", valid.spatialScopeRef),
        }),
      );
      this.#idempotency.set(key, { hash, commandId: valid.commandId, result });
      return result;
    }
  }

  #reviseProject(
    command: Extract<EngineeringContextRevisionCommandV1, { kind: "project" }>,
  ): ContextSourceResultV1 {
    const previous = this.#projects.get(command.projectId);
    if (!expectedMatches(command.expectedVersion, previous?.projectRevisionRef)) {
      return failure(
        moduleError({
          code: "STALE_VERSION",
          causalRunId: command.commandId,
          targetRef:
            command.expectedVersion === "none"
              ? reference("project-revision", command.projectId, "none")
              : reference(
                  "project-revision",
                  command.expectedVersion.entityId,
                  command.expectedVersion.versionId,
                ),
        }),
      );
    }
    if (
      previous !== undefined &&
      (previous.lifecycle === "ended" || previous.lifecycle === "archived")
    ) {
      return failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: command.commandId,
          blockerRef: targetRef("project-revision", previous.projectRevisionRef),
        }),
      );
    }
    if (
      previous !== undefined &&
      lifecycleRank[command.lifecycle] < lifecycleRank[previous.lifecycle]
    ) {
      return failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: command.commandId,
          blockerRef: targetRef("project-revision", previous.projectRevisionRef),
        }),
      );
    }
    const revision = projectRevisionFromCommand(command, previous);
    const result = succeeded({ kind: "project-revision", revision });
    this.#projects.set(command.projectId, revision);
    return result;
  }

  #reviseSpatial(
    command: Extract<EngineeringContextRevisionCommandV1, { kind: "spatial" }>,
  ): ContextSourceResultV1 {
    const currentProject = this.#projects.get(command.projectId);
    if (
      currentProject === undefined ||
      !versionReferenceEquals(currentProject.projectRevisionRef, command.projectRevisionRef)
    ) {
      return failure(
        moduleError({
          code: "STALE_VERSION",
          causalRunId: command.commandId,
          targetRef: targetRef("project-revision", command.projectRevisionRef),
        }),
      );
    }
    const key = spatialKey(command.projectId, command.spatialScopeRef);
    const previous = this.#spatialScopes.get(key);
    if (!expectedMatches(command.expectedVersion, previous?.spatialScopeRef)) {
      return failure(
        moduleError({
          code: "STALE_VERSION",
          causalRunId: command.commandId,
          targetRef: targetRef("spatial-scope", command.spatialScopeRef),
        }),
      );
    }
    if (command.parentScopeRef !== undefined) {
      if (
        command.parentScopeRef.reference.entityId === command.spatialScopeRef.reference.entityId
      ) {
        return failure(
          moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerRef: targetRef("spatial-scope", command.parentScopeRef),
          }),
        );
      }
      const parent = this.#spatialScopes.get(spatialKey(command.projectId, command.parentScopeRef));
      if (
        parent === undefined ||
        !versionReferenceEquals(parent.spatialScopeRef, command.parentScopeRef) ||
        parent.status !== "active"
      ) {
        return failure(
          moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerRef: targetRef("spatial-scope", command.parentScopeRef),
          }),
        );
      }
    }
    if (currentProject.lifecycle === "ended" || currentProject.lifecycle === "archived") {
      return failure(
        moduleError({
          code: "BUSINESS_BLOCKED",
          causalRunId: command.commandId,
          blockerRef: targetRef("project-revision", currentProject.projectRevisionRef),
        }),
      );
    }
    const revision = spatialRevisionFromCommand(command, previous);
    const result = succeeded({ kind: "spatial-revision", revision });
    this.#spatialScopes.set(key, revision);
    return result;
  }
}

export const createEngineeringContextSourceRegistry = (
  seed: EngineeringContextSourceSeedV1 = {},
): EngineeringContextSourceRegistryV1 => new EngineeringContextSourceService(seed);

export const buildProjectBusinessRevision = projectRevisionFromCommand;
export const buildSpatialBusinessRevision = spatialRevisionFromCommand;
export const buildSourceSegmentSet = segmentSetFromCommand;
export const buildApplicabilityMetadataSnapshot = applicabilitySnapshotFromParts;
export { moduleError as createContextSourceError };
