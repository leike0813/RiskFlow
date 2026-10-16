import { constants, createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readdir, lstat, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  SourceOriginalInfoV1Schema,
  SourceOriginalQueryV1Schema,
  type SourceOriginalInfoV1,
  type SourceOriginalQueryV1,
  type SourceOriginalReadPortV1,
  type ContentArtifactRefV1,
  type AuthorizationContextV1,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  ArtifactReadRequestV1Schema,
  makeArtifactError,
  type ArtifactStoreV1,
  type ArtifactManifestReaderV1,
} from "@riskflow/core/artifacts";
import { SourceDeliveryMetadataEnvelopeV1Schema } from "@riskflow/core/engineering-data/context-source";
import type { PostgresEngineeringContextSourceRegistry } from "./postgres-engineering-context-source-registry.js";

export interface SourceOriginalReaderOptionsV1 {
  readonly access: LocalIdentityAccessV1;
  readonly source: Pick<
    PostgresEngineeringContextSourceRegistry,
    "resolveSourceVersionForRead" | "readSourceOriginalRegistration"
  >;
  readonly artifactStore: ArtifactStoreV1;
  readonly readManifest: ArtifactManifestReaderV1;
  readonly temporaryRoot: string;
  readonly policy: {
    readonly maxBytes: number;
    readonly maxConcurrentReads: number;
    readonly maxTemporaryBytes: number;
    readonly timeoutMs: number;
  };
}

const extensions: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};
const safeName = (name: string): string =>
  Array.from(name, (char) =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || /[/\\:"<>|?*]/u.test(char)
      ? "_"
      : char,
  )
    .join("")
    .replace(/^\.+/u, "_")
    .slice(0, 180) || "document";
const denied = () => makeArtifactError("ARTIFACT_ACCESS_DENIED", "source-original.authorization");

/** 只读登记原件；完整核验后才把暂存字节交给HTTP，不提供任意工件或路径入口。 */
export class SourceOriginalReaderV1 implements SourceOriginalReadPortV1 {
  readonly #options: SourceOriginalReaderOptionsV1;
  #active = 0;
  #temporaryBytes = 0;
  #rootReady?: Promise<void>;

  constructor(options: SourceOriginalReaderOptionsV1) {
    this.#options = options;
  }

  async #prepare(
    query: SourceOriginalQueryV1,
    signal: AbortSignal,
  ): Promise<{
    info: SourceOriginalInfoV1;
    artifactRef: ContentArtifactRefV1;
    authorization: AuthorizationContextV1;
    purposeCode: string;
  }> {
    const q = SourceOriginalQueryV1Schema.parse(query);
    const resolved = await this.#options.source.resolveSourceVersionForRead(
      {
        queryId: q.queryId,
        projectId: q.projectId,
        actorId: q.actorId,
        requestedAt: q.requestedAt,
        authorization: q.authorization,
        sourceVersionRef: q.payload.sourceVersionRef,
      },
      { verifyBranch: "engineering-data.source-original-read" },
    );
    if (resolved.kind !== "succeeded" || resolved.result.kind !== "source-processing-input")
      throw denied();
    const input = resolved.result.input;
    const currentScopes = input.spatialScopeRefs.map((scope) => {
      const current = q.authorization.spatialScopeRefs.find(
        (allowed) => allowed.reference.entityId === scope.reference.entityId,
      );
      if (current === undefined) throw denied();
      return current;
    });
    const decision = await this.#options.access.verify({
      authorizationContextRef: q.authorization.authorizationContextRef,
      invocationId: q.queryId,
      projectId: q.projectId,
      branch: "engineering-data.source-original-read",
      requestedSpatialScopeRefs: currentScopes,
      requestedSourceVersionRefs: [input.sourceVersionRef],
      requestedAt: q.authorization.decidedAt,
    });
    const authorization = decision.context;
    const metadataManifest = await this.#options.readManifest(
      q.projectId,
      input.metadataArtifactRef,
    );
    if (metadataManifest === undefined || metadataManifest.access.projectId !== q.projectId)
      throw denied();
    const metadata = await this.#options.artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: `${q.queryId}:metadata`,
        idempotencyKey: `${q.queryId}:metadata`,
        artifactRef: input.metadataArtifactRef,
        projectId: q.projectId,
        actorId: q.actorId,
        requestedAt: q.requestedAt,
        purposeCode: metadataManifest.purposeCode,
        requiredCapability: "engineering-data.read",
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of Readable.from(metadata.content, { signal })) {
      length += chunk.byteLength;
      if (length > 1_048_576)
        throw makeArtifactError("ARTIFACT_TOO_LARGE", "source-original.metadata");
      chunks.push(Buffer.from(chunk));
    }
    await metadata.completed;
    const envelope = SourceDeliveryMetadataEnvelopeV1Schema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    const manifest = await this.#options.readManifest(q.projectId, input.sourceArtifactRef);
    if (manifest === undefined || manifest.access.projectId !== q.projectId) throw denied();
    if (manifest.content.byteLength > this.#options.policy.maxBytes)
      throw makeArtifactError("ARTIFACT_TOO_LARGE", "source-original.bytes");
    // 信息在open完整消费并核验原件后才交给调用者。
    const mediaType = manifest.mediaType.split(";")[0]!.trim().toLowerCase();
    const charset = /;\s*charset\s*=\s*"?([^;"\s]+)/iu.exec(manifest.mediaType)?.[1]?.toLowerCase();
    const originalFileName =
      envelope.descriptor.kind === "file-upload" ? envelope.descriptor.originalFileName : undefined;
    const extension = extensions[mediaType] ?? "";
    const name = safeName(originalFileName ?? envelope.sourceItemName);
    const fileName =
      extension !== "" && !name.toLowerCase().endsWith(extension) ? name + extension : name;
    const registration = await this.#options.source.readSourceOriginalRegistration({
      queryId: q.queryId,
      projectId: q.projectId,
      actorId: q.actorId,
      requestedAt: q.requestedAt,
      authorization: q.authorization,
      sourceVersionRef: q.payload.sourceVersionRef,
    });
    const info = SourceOriginalInfoV1Schema.parse({
      kind: "source-original",
      sourceVersionRef: input.sourceVersionRef,
      ...registration,
      deliveryKind: envelope.descriptor.kind,
      sourceName: envelope.sourceItemName,
      ...(originalFileName === undefined ? {} : { originalFileName }),
      fileName,
      mediaType,
      byteLength: manifest.content.byteLength,
      previewKind:
        mediaType === "application/pdf"
          ? "pdf"
          : ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType)
            ? "image"
            : ["text/plain", "text/csv"].includes(mediaType) &&
                (charset === undefined || ["utf-8", "utf8"].includes(charset))
              ? "text"
              : "download",
    });
    return {
      info,
      artifactRef: input.sourceArtifactRef,
      authorization,
      purposeCode: manifest.purposeCode,
    };
  }

  async read(query: SourceOriginalQueryV1) {
    // 元数据也核验原件访问范围，不能只靠C11引用披露受保护工件的属性。
    const handle = await this.open(query, AbortSignal.timeout(this.#options.policy.timeoutMs));
    await handle.close();
    return { kind: "succeeded" as const, result: handle.info };
  }

  async #initializeRoot(): Promise<void> {
    await mkdir(this.#options.temporaryRoot, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.#options.temporaryRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
      throw denied();
    await chmod(this.#options.temporaryRoot, 0o700);
    for (const name of await readdir(this.#options.temporaryRoot)) {
      if (!/^source-original-[A-Za-z0-9]+$/u.test(name)) continue;
      const dir = join(this.#options.temporaryRoot, name);
      const st = await lstat(dir);
      if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== stat.uid) continue;
      // 专用暂存根只含本reader的一份content文件；其他内容不清理。
      const names = await readdir(dir);
      if (names.some((n) => n !== "content")) continue;
      if (names.includes("content")) await unlink(join(dir, "content"));
      await rmdir(dir);
    }
  }

  async open(query: SourceOriginalQueryV1, signal: AbortSignal) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(this.#options.policy.timeoutMs)]);
    const policy = this.#options.policy;
    if (this.#active >= policy.maxConcurrentReads)
      throw makeArtifactError("ARTIFACT_TOO_LARGE", "source-original.concurrency");
    this.#active += 1;
    let directory: string | undefined;
    let reserved = 0;
    let closed = false;
    let outgoing: ReturnType<typeof createReadStream> | undefined;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      outgoing?.destroy();
      try {
        if (directory !== undefined) {
          await unlink(join(directory, "content")).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
          await rmdir(directory);
        }
      } finally {
        this.#active -= 1;
        this.#temporaryBytes -= reserved;
      }
    };
    try {
      signal.throwIfAborted();
      const prepared = await this.#prepare(query, signal);
      reserved = prepared.info.byteLength;
      if (
        reserved > policy.maxBytes ||
        this.#temporaryBytes + reserved > policy.maxTemporaryBytes
      ) {
        reserved = 0;
        throw makeArtifactError("ARTIFACT_TOO_LARGE", "source-original.bytes");
      }
      this.#temporaryBytes += reserved;
      this.#rootReady ??= this.#initializeRoot();
      await this.#rootReady;
      directory = await mkdtemp(join(this.#options.temporaryRoot, "source-original-"));
      const file = await open(
        join(directory, "content"),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        const handle = await this.#options.artifactStore.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: `${query.queryId}:original`,
            idempotencyKey: `${query.queryId}:original`,
            artifactRef: prepared.artifactRef,
            projectId: query.projectId,
            actorId: query.actorId,
            requestedAt: query.requestedAt,
            purposeCode: prepared.purposeCode,
            requiredCapability: "engineering-data.read",
            authorization: prepared.authorization,
          }),
        );
        let count = 0;
        for await (const chunk of Readable.from(handle.content, { signal })) {
          signal.throwIfAborted();
          count += chunk.byteLength;
          if (count > reserved)
            throw makeArtifactError("ARTIFACT_TOO_LARGE", "source-original.content");
          let offset = 0;
          while (offset < chunk.byteLength) {
            const written = await file.write(chunk, offset, chunk.byteLength - offset);
            offset += written.bytesWritten;
          }
        }
        await handle.completed;
        signal.throwIfAborted();
      } finally {
        await file.close();
      }
      const path = join(directory, "content");
      const content = (async function* () {
        outgoing = createReadStream(path, { signal });
        try {
          yield* outgoing;
        } finally {
          await close();
        }
      })();
      return { info: prepared.info, content, close };
    } catch (error) {
      await close();
      throw error;
    }
  }
}
