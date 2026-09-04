import { createHash } from "node:crypto";

import {
  ArtifactPutResultV1Schema,
  type ArtifactManifestV1,
  type ArtifactPutCommandV1,
  type ArtifactPutResultV1,
  type ArtifactReadHandleV1,
  type ArtifactReadRequestV1,
  type ArtifactReadReceiptV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import { StructuredCompletionRequestV1Schema } from "@riskflow/core/model";

const bytesOf = (value: string | Uint8Array): Uint8Array =>
  typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

export interface ScriptedFetchCall {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
  readonly signal: AbortSignal | null | undefined;
}

export class ScriptedFetch {
  readonly calls: ScriptedFetchCall[] = [];
  #responses: Array<Response | Error> = [];

  enqueue(response: Response): void {
    this.#responses.push(response);
  }

  enqueueError(error: Error): void {
    this.#responses.push(error);
  }

  readonly fetch: typeof fetch = async (input, init): Promise<Response> => {
    const url =
      input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    this.calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal,
    });
    const next = this.#responses.shift();
    if (next === undefined) throw new Error("scripted fetch exhausted");
    if (next instanceof Error) throw next;
    return next;
  };
}

export const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

export const streamResponse = (
  chunks: readonly (string | Uint8Array)[],
  status = 200,
): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(bytesOf(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
};

interface StoredArtifact {
  readonly bytes: Uint8Array;
  readonly result: ArtifactPutResultV1;
}

export class ArtifactStoreLatch implements ArtifactStoreV1 {
  readonly events: string[] = [];
  readonly commands: ArtifactPutCommandV1[] = [];
  readonly opened: ArtifactReadRequestV1[] = [];
  readonly artifacts = new Map<string, StoredArtifact>();
  #failPut: Error | undefined;
  #extraOpenBytes = 0;

  failNextPut(error = new Error("artifact put failed")): void {
    this.#failPut = error;
  }

  appendBytesToNextOpen(byteLength: number): void {
    this.#extraOpenBytes = byteLength;
  }

  async put(
    command: ArtifactPutCommandV1,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ArtifactPutResultV1> {
    this.events.push("put:start");
    const failure = this.#failPut;
    this.#failPut = undefined;
    if (failure !== undefined) throw failure;
    const parts: Uint8Array[] = [];
    for await (const chunk of content) parts.push(new Uint8Array(chunk));
    const bytes = concat(parts);
    const contentHash = sha256(bytes);
    const artifactRef = {
      kind: "diagnostic-artifact" as const,
      reference: { entityId: command.artifactId, versionId: `sha256:${contentHash}` },
    };
    const manifest: ArtifactManifestV1 = {
      schemaVersion: "1",
      artifactRef,
      artifactKind: "diagnostic",
      content: { hash: { algorithm: "sha256", value: contentHash }, byteLength: bytes.byteLength },
      mediaType: command.mediaType,
      purposeCode: command.purposeCode,
      access: {
        projectId: command.projectId,
        spatialScopeRefs: command.authorization.spatialScopeRefs,
        sourceAccessGrantRefs: command.authorization.sourceAccessGrantRefs,
        authorizationPolicyRefs: [command.authorization.authorizationPolicyRef],
      },
      writePolicyRef: { entityId: "artifact-policy", versionId: "v1" },
      parentArtifactRefs: command.parentArtifactRefs,
      evidenceReferences: command.evidenceReferences,
      producerCommandId: command.commandId,
      authorizationContextRef: command.authorization.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: `audit-${command.commandId}`, versionId: "v1" },
      },
      occurredAt: command.issuedAt,
      recordedAt: command.issuedAt,
      persistedAt: command.issuedAt,
    };
    const result = ArtifactPutResultV1Schema.parse({
      artifactRef,
      manifest,
      manifestSha256: sha256(new TextEncoder().encode(command.commandId)),
      replayed: false,
      deduplicated: false,
    });
    this.commands.push(command);
    this.artifacts.set(`${artifactRef.reference.entityId}/${artifactRef.reference.versionId}`, {
      bytes,
      result,
    });
    this.events.push("put:done");
    return result;
  }

  async open(request: ArtifactReadRequestV1): Promise<ArtifactReadHandleV1> {
    this.events.push("open:start");
    this.opened.push(request);
    const key = `${request.artifactRef.reference.entityId}/${request.artifactRef.reference.versionId}`;
    const stored = this.artifacts.get(key);
    if (stored === undefined) throw new Error("artifact not found");
    const extraOpenBytes = this.#extraOpenBytes;
    this.#extraOpenBytes = 0;
    const verified: ArtifactReadReceiptV1 = {
      schemaVersion: "1",
      requestId: request.requestId,
      artifactRef: stored.result.artifactRef,
      content: stored.result.manifest.content,
      authorizationContextRef: stored.result.manifest.authorizationContextRef,
      verifiedAt: request.requestedAt,
    };
    return {
      manifest: stored.result.manifest,
      content: (async function* (): AsyncGenerator<Uint8Array> {
        yield new Uint8Array(stored.bytes);
        if (extraOpenBytes > 0) yield new Uint8Array(extraOpenBytes);
      })(),
      verified: Promise.resolve().then(() => {
        this.events.push("verified");
        return verified;
      }),
    };
  }
}

export const testAuthorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "auth-model", versionId: "v1" },
  },
  actorId: "actor-model",
  projectId: "project-model",
  grantedCapabilities: ["risk-identification.run" as const],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

export const testDeployment = {
  schemaVersion: "1" as const,
  deploymentRef: { entityId: "llama-deployment", versionId: "v1" },
  serverBuildRef: { entityId: "llama-build", versionId: "v1" },
  expectedBuildInfo: "build-1",
  modelVersionRef: { entityId: "llama-model", versionId: "v1" },
  modelAlias: "riskflow-test",
  baseUrl: "http://llama.test",
  capabilities: ["completeStructured", "embed", "streamConversation"] as const,
  contextWindowTokens: 4096,
  embeddingDimensions: 3,
  requestTimeoutMs: 2_000,
  streamIdleTimeoutMs: 1_000,
  maxResponseBytes: 64 * 1024,
  maxInputBytes: 16 * 1024,
  maxBatchItems: 8,
  maxOutputTokens: 512,
  samplingPolicy: { temperature: 0 },
};

export const testRequestBase = {
  schemaVersion: "1" as const,
  invocationId: "invocation-model",
  idempotencyKey: "idempotency-model",
  issuedAt: "2030-01-01T00:00:00.000Z",
  projectId: "project-model",
  actorId: "actor-model",
  authorization: testAuthorization,
  requiredCapability: "risk-identification.run" as const,
  modelDeploymentRef: testDeployment.deploymentRef,
  budgetPolicyRef: { entityId: "budget", versionId: "v1" },
  deadlineAt: "2030-01-01T00:01:00.000Z",
  parentArtifactRefs: [],
  evidenceReferences: [],
};

export const modelProbeResponses = (): readonly Response[] => [
  jsonResponse({ status: "ok" }),
  jsonResponse({ build_info: "build-1", n_ctx: 4096, n_embd: 3 }),
  jsonResponse({ data: [{ id: "riskflow-test", meta: { n_embd: 3 } }] }),
];

export const structuredRequest = () =>
  StructuredCompletionRequestV1Schema.parse({
    ...testRequestBase,
    promptTemplateRef: { entityId: "prompt", versionId: "v1" },
    outputSchemaRef: { entityId: "schema", versionId: "v1" },
    messages: [{ role: "user", content: "分析当前工序" }],
    maxOutputTokens: 128,
  });
