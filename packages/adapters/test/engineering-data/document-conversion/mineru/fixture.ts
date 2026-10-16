import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  ArtifactManifestV1Schema,
  ArtifactPutResultV1Schema,
  makeArtifactError,
  type ArtifactManifestV1,
  type ArtifactPutCommandV1,
  type ArtifactPutResultV1,
  type ArtifactReadHandleV1,
  type ArtifactReadReceiptV1,
  type ArtifactReadRequestV1,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import type {
  ContextSourceResultV1,
  EngineeringContextSourceRegistryV1,
  SourceProcessingInputV1,
} from "@riskflow/core/engineering-data/context-source";
import {
  ModuleErrorV1Schema,
  StructuredDocumentConversionCommandV1Schema,
} from "@riskflow/contracts/ports";
import { StructuredDocumentConversionAdapter } from "../../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1 } from "../../../../src/engineering-data/document-conversion/schema.js";
import type { DocumentServiceParserRequestV1 } from "../../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { createMineruDocumentParser } from "../../../../src/engineering-data/document-conversion/mineru/mineru-document-parser.js";

export const pdfBytes = new Uint8Array(
  readFileSync(
    new URL("../../../fixtures/structured-document-conversion/sample.pdf", import.meta.url),
  ),
);

export const refs = {
  sourceVersionRef: {
    kind: "source-version" as const,
    reference: { entityId: "source_1", versionId: "v1" },
  },
  sourceArtifactRef: {
    kind: "content-artifact" as const,
    reference: { entityId: "source_1", versionId: `sha256:${"a".repeat(64)}` },
  },
  metadataArtifactRef: {
    kind: "content-artifact" as const,
    reference: { entityId: "metadata_1", versionId: `sha256:${"b".repeat(64)}` },
  },
};

export const source = {
  ...refs,
  projectId: "project_1",
  sourceId: "source_1",
  sourceItemId: "item_1",
  projectRevisionRef: {
    kind: "project-revision" as const,
    reference: { entityId: "project_1", versionId: "v1" },
  },
  spatialScopeRefs: [
    { kind: "spatial-scope" as const, reference: { entityId: "scope_1", versionId: "v1" } },
  ],
  sourceAccessGrantRef: {
    kind: "source-access-grant" as const,
    reference: { entityId: "grant_1", versionId: "v1" },
  },
  applicabilityMetadataSnapshotRef: {
    kind: "applicability-metadata-snapshot" as const,
    reference: { entityId: "snapshot_1", versionId: "v1" },
  },
};

export const makeRequest = (
  overrides: Partial<DocumentServiceParserRequestV1> = {},
): DocumentServiceParserRequestV1 => {
  const authorization = {
    schemaVersion: "1" as const,
    authorizationContextRef: {
      kind: "authorization-context" as const,
      reference: { entityId: "auth_1", versionId: "v1" },
    },
    actorId: "actor_1",
    projectId: "project_1",
    grantedCapabilities: ["engineering-data.read", "engineering-data.write"],
    spatialScopeRefs: source.spatialScopeRefs,
    sourceAccessGrantRefs: [source.sourceAccessGrantRef],
    authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    decidedAt: "2030-01-01T00:00:00.000Z",
    invocation: { kind: "human" as const },
  };
  const command = StructuredDocumentConversionCommandV1Schema.parse({
    schemaVersion: "1",
    conversionId: "conversion_1",
    idempotencyKey: "conversion_idempotency_1",
    runId: "run_1",
    threadId: "thread_1",
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    projectId: "project_1",
    actorId: "actor_1",
    authorization,
    sourceVersionRef: refs.sourceVersionRef,
    sourceArtifactRef: refs.sourceArtifactRef,
    mediaType: "application/pdf",
    input: { kind: "ocr-layout" },
    conversionPolicyRef: { entityId: "document-conversion-policy", versionId: "1" },
    qualityPolicyRef: { entityId: "quality-policy", versionId: "v1" },
    converterDeploymentRef: { entityId: "mineru-deployment", versionId: "v1" },
  });
  return {
    command,
    source,
    bytes: pdfBytes,
    resourcePolicy: DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
    signal: undefined,
    persistRawResponse: async ({ bytes }) => ({
      artifactRef: {
        kind: "content-artifact",
        reference: { entityId: "raw-response", versionId: `sha256:${"c".repeat(64)}` },
      },
      bytes: new Uint8Array(bytes),
    }),
    ...overrides,
  };
};

export const makeConfig = (
  protocol: "official-v4" | "self-hosted-v1",
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: "1",
  deploymentRef: { entityId: "mineru-deployment", versionId: "v1" },
  qualityPolicyRef: { entityId: "quality-policy", versionId: "v1" },
  resourceAllocationRef: { entityId: "mineru-allocation", versionId: "v1" },
  protocol,
  endpoint: protocol === "official-v4" ? "https://mineru.net" : "http://127.0.0.1:8000",
  credentialRef: protocol === "official-v4" ? "mineru-token" : null,
  allowedTransferOrigins:
    protocol === "official-v4"
      ? [
          "https://mineru.net",
          "https://mineru.oss-cn-shanghai.aliyuncs.com",
          "https://cdn-mineru.openxlab.org.cn",
        ]
      : ["http://127.0.0.1:8000"],
  requestTimeoutMs: 500,
  pollIntervalMs: 1,
  maxPolls: 5,
  maxConcurrentRequests: 2,
  maxResponseBytes: 1_000_000,
  qualityPolicy: { minNonEmptyPageRatio: 1, minKeyFieldCoverage: 0, keyFields: [] },
  ...overrides,
});

export const middle = {
  schema: "docvortex.middle",
  schema_version: "2.0",
  is_full_document: true,
  metadata: { producer: { name: "mineru", version: "4.0.12" } },
  extensions: {
    mineru: { tier: "standard", parse_mode: "ocr" },
    docvortex_layout: { version: 1, pages: [{ page_idx: 0, width_pt: 300, height_pt: 200 }] },
  },
  pages: [
    {
      page_idx: 0,
      blocks: [
        {
          type: "text",
          index: 0,
          bbox: [0, 0, 1, 1],
          content: [{ type: "text", content: "transport fixture" }],
        },
      ],
    },
  ],
};

export const rawRef = (id: string) => ({
  kind: "content-artifact" as const,
  reference: { entityId: id, versionId: `sha256:${"c".repeat(64)}` },
});

/** Service seam fixture retained from the former OCR harness: C11 source authorization and C04 durable readback. */
export const makeServiceHarness = (options: {
  readonly fetch: typeof fetch;
  readonly config?: ReturnType<typeof makeConfig>;
  readonly bytes?: Uint8Array;
  readonly denySource?: boolean;
  readonly failRawReadback?: boolean;
}) => {
  const bytes = options.bytes ?? pdfBytes;
  const inputDigest = createHash("sha256").update(bytes).digest("hex");
  const sourceArtifactRef = {
    kind: "content-artifact" as const,
    reference: { entityId: "source_1", versionId: `sha256:${inputDigest}` },
  };
  const serviceSource: SourceProcessingInputV1 = { ...source, sourceArtifactRef };
  const baseRequest = makeRequest({ bytes, source: serviceSource });
  const command = StructuredDocumentConversionCommandV1Schema.parse({
    ...baseRequest.command,
    sourceArtifactRef,
    converterDeploymentRef:
      options.config?.deploymentRef ?? baseRequest.command.converterDeploymentRef,
    qualityPolicyRef: options.config?.qualityPolicyRef ?? baseRequest.command.qualityPolicyRef,
  });
  const artifacts = new Map<string, { bytes: Uint8Array; manifest: ArtifactManifestV1 }>();
  const events: string[] = [];
  const puts: ArtifactPutCommandV1[] = [];
  const opens: ArtifactReadRequestV1[] = [];
  let rawReadbackFailure = options.failRawReadback === true;

  const manifestFor = (
    artifactRef: ArtifactRefV1,
    artifactKind: "content" | "diagnostic",
    content: Uint8Array,
    metadata?: ArtifactPutCommandV1,
  ): ArtifactManifestV1 => {
    const digest = createHash("sha256").update(content).digest("hex");
    return ArtifactManifestV1Schema.parse({
      schemaVersion: "1",
      artifactRef,
      artifactKind,
      content: { hash: { algorithm: "sha256", value: digest }, byteLength: content.byteLength },
      mediaType: metadata?.mediaType ?? "application/pdf",
      purposeCode: metadata?.purposeCode ?? "engineering-data.register-source-delivery",
      access: {
        projectId: command.projectId,
        spatialScopeRefs: command.authorization.spatialScopeRefs,
        sourceAccessGrantRefs: command.authorization.sourceAccessGrantRefs,
        authorizationPolicyRefs: [command.authorization.authorizationPolicyRef],
      },
      writePolicyRef: { entityId: "artifact-policy", versionId: "1" },
      parentArtifactRefs: metadata?.parentArtifactRefs ?? [],
      evidenceReferences: metadata?.evidenceReferences ?? [],
      producerCommandId: metadata?.commandId ?? "mineru-fixture-seed",
      authorizationContextRef: command.authorization.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: "audit-mineru-fixture", versionId: "1" },
      },
      occurredAt: command.issuedAt,
      recordedAt: command.issuedAt,
      persistedAt: command.issuedAt,
    });
  };
  const seedManifest = manifestFor(sourceArtifactRef, "content", bytes);
  artifacts.set(
    `${sourceArtifactRef.reference.entityId}/${sourceArtifactRef.reference.versionId}`,
    { bytes, manifest: seedManifest },
  );

  const artifactStore: ArtifactStoreV1 = {
    async put(putCommand, stream): Promise<ArtifactPutResultV1> {
      events.push(`put:${putCommand.artifactId}`);
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(new Uint8Array(chunk));
      const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
      const content = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const digest = createHash("sha256").update(content).digest("hex");
      const artifactRef: ArtifactRefV1 = {
        kind: putCommand.artifactKind === "content" ? "content-artifact" : "diagnostic-artifact",
        reference: { entityId: putCommand.artifactId, versionId: `sha256:${digest}` },
      };
      const manifest = manifestFor(artifactRef, putCommand.artifactKind, content, putCommand);
      const result = ArtifactPutResultV1Schema.parse({
        artifactRef,
        manifest,
        manifestSha256: createHash("sha256").update(putCommand.commandId).digest("hex"),
        replayed: false,
        deduplicated: false,
      });
      puts.push(putCommand);
      artifacts.set(`${artifactRef.reference.entityId}/${artifactRef.reference.versionId}`, {
        bytes: content,
        manifest,
      });
      return result;
    },
    async open(readRequest): Promise<ArtifactReadHandleV1> {
      events.push(`open:${readRequest.artifactRef.reference.entityId}`);
      opens.push(readRequest);
      const stored = artifacts.get(
        `${readRequest.artifactRef.reference.entityId}/${readRequest.artifactRef.reference.versionId}`,
      );
      if (stored === undefined)
        throw makeArtifactError("ARTIFACT_REFERENCE_NOT_FOUND", "artifact-store.read");
      if (
        readRequest.artifactRef.reference.entityId.startsWith("document-service-raw-response-") &&
        rawReadbackFailure
      ) {
        rawReadbackFailure = false;
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "artifact-store.read");
      }
      const verified: ArtifactReadReceiptV1 = {
        schemaVersion: "1",
        requestId: readRequest.requestId,
        artifactRef: stored.manifest.artifactRef,
        content: stored.manifest.content,
        authorizationContextRef: stored.manifest.authorizationContextRef,
        verifiedAt: readRequest.requestedAt,
      };
      return {
        manifest: stored.manifest,
        content: (async function* () {
          yield new Uint8Array(stored.bytes);
        })(),
        completed: Promise.resolve(verified),
      };
    },
  };
  const registered: unknown[] = [];
  const contextSource = {
    async resolveSourceProcessingInput(): Promise<ContextSourceResultV1> {
      if (options.denySource === true) {
        return {
          kind: "failed",
          error: ModuleErrorV1Schema.parse({
            stageCode: "engineering-data.context-source.authorization_denied",
            occurredAt: command.issuedAt,
            causalRunId: command.runId,
            code: "AUTHORIZATION_DENIED",
            category: "authorization",
            retryable: false,
            requiredCapability: "engineering-data.read",
            authorizationPolicyRef: command.authorization.authorizationPolicyRef,
          }),
        } as ContextSourceResultV1;
      }
      return {
        kind: "succeeded",
        result: { kind: "source-processing-input", input: serviceSource },
      } as ContextSourceResultV1;
    },
    async resolveSourceVersionForRead(): Promise<ContextSourceResultV1> {
      return {
        kind: "succeeded",
        result: { kind: "source-processing-input", input: serviceSource },
      } as ContextSourceResultV1;
    },
    async registerSegments(registerCommand: { commandId: string }): Promise<ContextSourceResultV1> {
      events.push("register-segments");
      registered.push(registerCommand);
      return {
        kind: "succeeded",
        result: {
          kind: "source-segment-set",
          segmentSet: {
            sourceSegmentSetRef: {
              kind: "source-segment-set",
              reference: { entityId: `segment-set-${registerCommand.commandId}`, versionId: "1" },
            },
          },
        },
      } as ContextSourceResultV1;
    },
    async reviseContext(): Promise<ContextSourceResultV1> {
      return { kind: "failed", error: new Error("unused") } as ContextSourceResultV1;
    },
    async createApplicabilitySnapshot(): Promise<ContextSourceResultV1> {
      return { kind: "failed", error: new Error("unused") } as ContextSourceResultV1;
    },
  } as unknown as EngineeringContextSourceRegistryV1;
  const config = options.config ?? makeConfig("self-hosted-v1");
  const adapter = new StructuredDocumentConversionAdapter({
    contextSource,
    artifactStore,
    qualityPolicyRef: command.qualityPolicyRef,
    converterDeploymentRef: command.converterDeploymentRef,
    documentServiceParser: createMineruDocumentParser({ config, fetch: options.fetch }),
  });
  return { adapter, command, artifactStore, puts, opens, events, registered, artifacts };
};
