import {
  ContractReferenceV1Schema,
  type AuthorizationContextRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ModuleCapabilityV1,
  type ContractReferenceV1,
  type ModuleErrorV1,
  type ProjectRevisionRefV1,
} from "@riskflow/contracts/ports";
import type { DomainEventV1 } from "@riskflow/contracts/events";

import { ArtifactReadRequestV1Schema, type ArtifactReadHandleV1 } from "../artifacts/index.js";
import type { ArtifactStoreV1 } from "../artifacts/index.js";
import type { KnowledgeRevisionV1 } from "../knowledge-governance/index.js";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitReceiptV1,
  type AtomicCommitV1,
  type AuditAppendV1,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "../persistence/index.js";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1,
  ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
  ASSESSMENT_CONFIGURATION_SCHEMA_VERSION_V1,
  AssessmentConfigurationMemberV1Schema,
  AssessmentConfigurationReleaseSetV1Schema,
  ResolveAssessmentConfigurationSetV1Schema,
  type AssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationDocumentV1,
  type AssessmentConfigurationMemberV1,
  type AssessmentConfigurationReleaseSetV1,
  type AssessmentConfigurationResolutionV1,
  type AssessmentConfigurationSetResultV1,
  type AssessmentConfigurationSummaryV1,
  type PreparedAssessmentConfigurationV1,
  type ResolveAssessmentConfigurationSetV1,
} from "./schema.js";
import {
  ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
  assessmentConfigurationDocumentDigest,
  assessmentConfigurationFailureFrom,
  buildAssessmentConfigurationMemberIdentity,
  failAssessmentConfiguration,
  parseAssessmentConfigurationDocument,
  summarizeAssessmentConfigurationDocument,
  validateAssessmentConfigurationDocument,
  validateAssessmentConfigurationSet,
  type AssessmentConfigurationFailureV1,
} from "./validation.js";

/* -------------------------------------------------------------------------- */
/* D1 governance policy seam                                                  */
/* -------------------------------------------------------------------------- */

export interface SubmitAssessmentConfigurationRevisionV1 {
  readonly projectId: string;
  readonly definitionType: AssessmentConfigurationDefinitionTypeV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
  /** C06-verified authorization context for the submit command. */
  readonly authorization: AuthorizationContextV1;
}

export interface AssessmentConfigurationRevisionAppendV1 {
  readonly revision: KnowledgeRevisionV1;
  readonly prepared: PreparedAssessmentConfigurationV1;
  readonly auditEntryId: string;
  readonly persistedAt: string;
}

export interface AssessmentConfigurationRevisionMetadataAssertionV1 {
  readonly projectId: string;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly authorization: AuthorizationContextV1;
}

export interface PublishOrRollbackAssessmentConfigurationV1 {
  readonly kind: "publish-approved-release" | "rollback-by-new-release";
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly authorizationContextRef: AuthorizationContextRefV1;
}

export interface AssessmentConfigurationReleaseAppendV1 {
  readonly command: PublishOrRollbackAssessmentConfigurationV1;
  readonly revision: KnowledgeRevisionV1;
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly audit: AuditAppendV1;
  readonly recordedAt: string;
}

export interface AssessmentConfigurationGovernancePolicyV1 {
  prepareRevision(
    command: SubmitAssessmentConfigurationRevisionV1,
  ): Promise<PreparedAssessmentConfigurationV1>;
  appendPreparedRevision(
    context: TransactionContextV1,
    input: AssessmentConfigurationRevisionAppendV1,
  ): Promise<void>;
  assertRevisionMetadata(input: AssessmentConfigurationRevisionMetadataAssertionV1): Promise<void>;
  appendRelease(
    context: TransactionContextV1,
    input: AssessmentConfigurationReleaseAppendV1,
  ): Promise<DomainEventV1[]>;
  resolveConfigurationSet(
    request: ResolveAssessmentConfigurationSetV1,
  ): Promise<AssessmentConfigurationSetResultV1>;
}

/* -------------------------------------------------------------------------- */
/* Bounded C04 artifact read                                                  */
/* -------------------------------------------------------------------------- */

export interface AssessmentConfigurationArtifactReadInputV1 {
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactRef: ContentArtifactRefV1;
  readonly definitionType: AssessmentConfigurationDefinitionTypeV1;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly requiredCapability: ModuleCapabilityV1;
  readonly authorization: AuthorizationContextV1;
}

const artifactFailure = (
  error: unknown,
  targetRef: ContractReferenceV1,
): AssessmentConfigurationFailureV1 => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  if (code === "ARTIFACT_ACCESS_DENIED" || code === "ARTIFACT_REFERENCE_NOT_FOUND") {
    return {
      code: "AUTHORIZATION_DENIED",
      reasonCode: "assessment-configuration-artifact-unavailable",
      targetRef,
    };
  }
  if (code === "ARTIFACT_IO_FAILURE" || code === "ARTIFACT_REGISTRY_FAILURE") {
    return {
      code: "TRANSIENT_FAILURE",
      reasonCode: "assessment-configuration-artifact-unavailable",
      targetRef,
    };
  }
  return {
    code: "TERMINAL_FAILURE",
    reasonCode: "assessment-configuration-artifact-unavailable",
    targetRef,
  };
};

const rethrowArtifactFailure = (error: unknown, targetRef: ContractReferenceV1): never => {
  if (assessmentConfigurationFailureFrom(error) !== undefined) throw error;
  const failure = artifactFailure(error, targetRef);
  return failAssessmentConfiguration(failure.reasonCode, targetRef, failure.code);
};

const readBoundedContent = async (handle: ArtifactReadHandleV1): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of handle.content) {
    byteLength += chunk.byteLength;
    if (byteLength > ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1) {
      failAssessmentConfiguration(
        "assessment-configuration-size-exceeded",
        ContractReferenceV1Schema.parse({
          kind: "content-artifact",
          reference: handle.manifest.artifactRef.reference,
        }),
      );
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * Read one bounded UTF-8 configuration document from C04 under the current
 * authorization and validate it into a prepared value. Never returns a value
 * before the artifact read is complete and verified.
 */
export const readPreparedAssessmentConfiguration = async (
  input: AssessmentConfigurationArtifactReadInputV1,
): Promise<PreparedAssessmentConfigurationV1> => {
  const targetRef = ContractReferenceV1Schema.parse({
    kind: "content-artifact",
    reference: input.artifactRef.reference,
  });
  if (input.authorization.projectId !== input.projectId) {
    failAssessmentConfiguration("assessment-configuration-project-mismatch", targetRef);
  }
  const handle = await input.artifactStore
    .open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: ASSESSMENT_CONFIGURATION_SCHEMA_VERSION_V1,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        artifactRef: input.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
        requiredCapability: input.requiredCapability,
        authorization: input.authorization,
      }),
    )
    .catch((error: unknown): never => {
      const failure = artifactFailure(error, targetRef);
      return failAssessmentConfiguration(failure.reasonCode, targetRef, failure.code);
    });
  const bytes = await readBoundedContent(handle).catch((error: unknown): never =>
    rethrowArtifactFailure(error, targetRef),
  );
  const receipt = await handle.verified.catch((error: unknown): never =>
    rethrowArtifactFailure(error, targetRef),
  );
  if (
    receipt.content.hash.value !== handle.manifest.content.hash.value ||
    receipt.content.byteLength !== handle.manifest.content.byteLength
  ) {
    failAssessmentConfiguration("assessment-configuration-artifact-mismatch", targetRef);
  }
  if (handle.manifest.mediaType !== ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1) {
    failAssessmentConfiguration("assessment-configuration-media-type-invalid", targetRef);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    failAssessmentConfiguration("assessment-configuration-content-invalid", targetRef);
  }
  const document = parseAssessmentConfigurationDocument(value, targetRef);
  if (document.definitionType !== input.definitionType) {
    failAssessmentConfiguration("assessment-configuration-type-mismatch", targetRef);
  }
  validateAssessmentConfigurationDocument(document);
  return {
    definitionType: document.definitionType,
    projectRevisionRef: document.projectRevisionRef,
    configurationSetRef: document.configurationSetRef,
    contentDigest: assessmentConfigurationDocumentDigest(document),
    summary: summarizeAssessmentConfigurationDocument(document),
    document,
  };
};

/* -------------------------------------------------------------------------- */
/* Exact configuration set resolution                                         */
/* -------------------------------------------------------------------------- */

/** C16-owned exact release member consumed by the C18 resolver. */
export interface GovernedConfigurationReleaseMemberV1 {
  readonly definitionType: string;
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
}

/** C18 metadata for one member, read by definition type from the C18 store. */
export interface AssessmentConfigurationMemberSourceV1 {
  readonly definitionType: AssessmentConfigurationDefinitionTypeV1;
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly artifactRef: ContentArtifactRefV1;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly configurationSetRef: { entityId: string; versionId: string };
  readonly contentDigest: string;
  readonly summary: AssessmentConfigurationSummaryV1;
}

export type AssessmentConfigurationMemberResolutionV1 =
  | {
      readonly kind: "succeeded";
      readonly members: readonly AssessmentConfigurationMemberSourceV1[];
    }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

export interface AssessmentConfigurationSetAppendV1 {
  readonly configurationSet: AssessmentConfigurationReleaseSetV1;
  readonly command: AtomicCommandV1;
  readonly auditEntryId: string;
}

export interface AssessmentConfigurationResolverPortsV1 {
  readonly artifactStore: ArtifactStoreV1;
  readonly transactionUnit: TransactionUnitV1;
  readonly now?: () => Date;
  resolveConfigurationMembers(request: {
    readonly projectId: string;
    readonly requiredDefinitionTypes: readonly AssessmentConfigurationDefinitionTypeV1[];
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<AssessmentConfigurationMemberResolutionV1>;
  appendConfigurationSet(
    context: TransactionContextV1,
    input: AssessmentConfigurationSetAppendV1,
  ): Promise<void>;
}

const REQUIRED_RESOLUTION_CAPABILITY_V1: ModuleCapabilityV1 = "knowledge-modeling.read";

const sameVersionReference = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

/** Members and canonical type order both use code-unit order, never locale order. */
const compareDefinitionType = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const memberTargetRef = (member: AssessmentConfigurationMemberSourceV1): ContractReferenceV1 =>
  member.releaseRef;

export class AssessmentConfigurationResolverV1 {
  readonly #ports: AssessmentConfigurationResolverPortsV1;

  constructor(ports: AssessmentConfigurationResolverPortsV1) {
    this.#ports = ports;
  }

  async resolveConfigurationSet(
    request: ResolveAssessmentConfigurationSetV1,
  ): Promise<AssessmentConfigurationResolutionV1> {
    if (
      request.projectId !== request.authorization.projectId ||
      request.actorId !== request.authorization.actorId
    ) {
      failAssessmentConfiguration(
        "assessment-configuration-project-mismatch",
        ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
        "AUTHORIZATION_DENIED",
      );
    }
    if (!request.authorization.grantedCapabilities.includes(REQUIRED_RESOLUTION_CAPABILITY_V1)) {
      failAssessmentConfiguration(
        "assessment-configuration-capability-required",
        ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
        "AUTHORIZATION_DENIED",
      );
    }
    const parsed = ResolveAssessmentConfigurationSetV1Schema.safeParse(request);
    if (!parsed.success) {
      failAssessmentConfiguration(
        "assessment-configuration-request-invalid",
        ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
      );
    }
    const valid = parsed.data as ResolveAssessmentConfigurationSetV1;
    const resolution = await this.#ports.resolveConfigurationMembers({
      projectId: valid.projectId,
      requiredDefinitionTypes: ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
      requiredAt: valid.requiredAt,
      asOfRecordedAt: valid.asOfRecordedAt,
      authorization: valid.authorization,
    });
    if (resolution.kind === "failed") {
      return { kind: "failed", error: resolution.error };
    }

    const canonicalTypes = [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1].sort(
      compareDefinitionType,
    );
    const ordered = [...resolution.members].sort((left, right) =>
      compareDefinitionType(left.definitionType, right.definitionType),
    );
    if (
      ordered.length !== canonicalTypes.length ||
      ordered.some((member, index) => member.definitionType !== canonicalTypes[index])
    ) {
      failAssessmentConfiguration(
        "assessment-configuration-incompatible",
        ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
      );
    }

    const head = ordered[0];
    if (head === undefined) {
      failAssessmentConfiguration(
        "assessment-configuration-set-incomplete",
        ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
      );
    }
    const coherent = ordered.every(
      (member) =>
        sameVersionReference(member.configurationSetRef, head.configurationSetRef) &&
        sameVersionReference(
          member.projectRevisionRef.reference,
          head.projectRevisionRef.reference,
        ),
    );
    if (!coherent) {
      failAssessmentConfiguration(
        "assessment-configuration-incompatible",
        ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
      );
    }

    const documents: AssessmentConfigurationDocumentV1[] = [];
    const members: AssessmentConfigurationMemberV1[] = [];
    const requiredCapability: ModuleCapabilityV1 = "knowledge-modeling.read";
    for (const member of ordered) {
      const prepared = await readPreparedAssessmentConfiguration({
        artifactStore: this.#ports.artifactStore,
        artifactRef: member.artifactRef,
        definitionType: member.definitionType,
        projectId: valid.projectId,
        actorId: valid.actorId,
        requestId: `${valid.requestId}:${member.definitionType}`,
        idempotencyKey: `${valid.idempotencyKey}:${member.definitionType}`,
        requestedAt: valid.requestedAt,
        requiredCapability,
        authorization: valid.authorization,
      });
      if (prepared.contentDigest !== member.contentDigest) {
        failAssessmentConfiguration(
          "assessment-configuration-artifact-mismatch",
          memberTargetRef(member),
        );
      }
      if (
        !sameVersionReference(prepared.configurationSetRef, member.configurationSetRef) ||
        !sameVersionReference(
          prepared.projectRevisionRef.reference,
          member.projectRevisionRef.reference,
        )
      ) {
        failAssessmentConfiguration(
          "assessment-configuration-incompatible",
          memberTargetRef(member),
        );
      }
      documents.push(prepared.document);
      members.push(
        AssessmentConfigurationMemberV1Schema.parse({
          definitionType: member.definitionType,
          releaseRef: member.releaseRef,
          revisionRef: member.revisionRef,
          artifactRef: member.artifactRef,
          contentDigest: prepared.contentDigest,
        }),
      );
    }
    try {
      validateAssessmentConfigurationSet(documents);
    } catch (error) {
      const failure = assessmentConfigurationFailureFrom(error);
      if (failure === undefined) throw error;
      failAssessmentConfiguration("assessment-configuration-incompatible", failure.targetRef);
    }

    const { memberDigest, identityDigest } = buildAssessmentConfigurationMemberIdentity({
      projectId: valid.projectId,
      projectRevisionRef: head.projectRevisionRef,
      configurationSetRef: head.configurationSetRef,
      requiredAt: valid.requiredAt,
      asOfRecordedAt: valid.asOfRecordedAt,
      members,
    });
    const setId = `assessment-configuration-release-set-${identityDigest}`;
    const recordedAt = (this.#ports.now?.() ?? new Date()).toISOString();
    const configurationSet = AssessmentConfigurationReleaseSetV1Schema.parse({
      setRef: { kind: "knowledge-query-result", reference: { entityId: setId, versionId: "1" } },
      schemaVersion: ASSESSMENT_CONFIGURATION_SCHEMA_VERSION_V1,
      projectId: valid.projectId,
      projectRevisionRef: head.projectRevisionRef,
      configurationSetRef: head.configurationSetRef,
      requiredAt: valid.requiredAt,
      asOfRecordedAt: valid.asOfRecordedAt,
      memberDigest,
      identityDigest,
      recordedAt,
      members,
    });
    const command = AtomicCommandV1Schema.parse({
      projectId: valid.projectId,
      commandKind: "knowledge.resolve-assessment-configuration-set.v1",
      commandId: valid.requestId,
      idempotencyKey: valid.idempotencyKey,
      payload: {
        configurationSetRef: head.configurationSetRef,
        requiredAt: valid.requiredAt,
        asOfRecordedAt: valid.asOfRecordedAt,
        identityDigest,
      },
      actorRef: valid.actorId,
      authorizationContextRef: valid.authorization.authorizationContextRef,
      issuedAt: valid.requestedAt,
    });
    const auditEntryId = `assessment-configuration-set-${sha256CanonicalJson({
      commandId: command.commandId,
      setRef: configurationSet.setRef,
    })}`;
    const receipt: AtomicCommitReceiptV1 = await this.#ports.transactionUnit.execute(
      command,
      async (context): Promise<AtomicCommitV1> => {
        await this.#ports.appendConfigurationSet(context, {
          configurationSet,
          command,
          auditEntryId,
        });
        const audit: AuditAppendV1 = {
          auditEntryId,
          projectId: valid.projectId,
          action: "knowledge.resolve-assessment-configuration-set",
          targetRef: configurationSet.setRef,
          actorRef: valid.actorId,
          authorizationContextRef: valid.authorization.authorizationContextRef,
          occurredAt: valid.requestedAt,
          recordedAt,
          version: configurationSet.setRef.reference,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
        };
        return { resultRef: configurationSet.setRef, audit, events: [] };
      },
    );
    const receiptRef = receipt.resultRef;
    if (
      !("reference" in receiptRef) ||
      !sameVersionReference(receiptRef.reference, configurationSet.setRef.reference)
    ) {
      failAssessmentConfiguration(
        "assessment-configuration-incompatible",
        configurationSet.setRef,
        "TERMINAL_FAILURE",
      );
    }
    return { kind: "succeeded", configurationSet };
  }
}
