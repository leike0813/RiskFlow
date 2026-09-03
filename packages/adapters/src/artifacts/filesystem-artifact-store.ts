import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  ArtifactContentIdentityV1Schema,
  ArtifactManifestV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactPutResultV1Schema,
  ArtifactReadReceiptV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactStoreError,
  ArtifactStorePolicyV1Schema,
  type ArtifactAccessRecordV1,
  makeArtifactError,
  manifestSha256,
  type ArtifactHashV1,
  type ArtifactContentIdentityV1,
  type ArtifactManifestV1,
  type ArtifactPutCommandV1,
  type ArtifactPutResultV1,
  type ArtifactReadHandleV1,
  type ArtifactReadRequestV1,
  type ArtifactStorePolicyV1,
} from "@riskflow/core/artifacts";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import { canonicalJson } from "@riskflow/core/persistence";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";

import { PostgresArtifactRegistry } from "./postgres-artifact-registry.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CHUNK_SIZE = 1024 * 1024;
const encoder = new TextEncoder();

export type ArtifactFailpointV1 =
  | "staging.sync"
  | "object.link"
  | "registry"
  | "registry.handler"
  | "audit"
  | "audit.commit"
  | "quarantine.rename"
  | "database.commit"
  | "response";

export interface FilesystemArtifactStoreOptionsV1 {
  readonly rootDirectory: string;
  readonly policy: ArtifactStorePolicyV1;
  readonly registry: PostgresArtifactRegistry;
  readonly transactionUnit: TransactionUnitV1;
  readonly now?: () => Date;
  readonly failpoint?: (point: ArtifactFailpointV1) => void | Promise<void>;
}

const transientCodes = new Set(["EIO", "EAGAIN", "EBUSY", "ETIMEDOUT", "ECONNRESET"]);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string";

const mapFileError = (error: unknown, stage: string): ArtifactStoreError => {
  if (error instanceof ArtifactStoreError) return error;
  const code = isNodeError(error) ? error.code : undefined;
  return makeArtifactError(
    transientCodes.has(code ?? "") ? "ARTIFACT_IO_FAILURE" : "ARTIFACT_IO_FAILURE",
    stage,
    [],
    transientCodes.has(code ?? ""),
  );
};

const isMissing = (error: unknown): boolean => isNodeError(error) && error.code === "ENOENT";

const writeAll = async (file: FileHandle, chunk: Uint8Array): Promise<void> => {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten <= 0) throw makeArtifactError("ARTIFACT_IO_FAILURE", "staging.write");
    offset += result.bytesWritten;
  }
};

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const fileDigest = async (
  file: FileHandle,
  expectedLength: number,
): Promise<{ readonly digest: string; readonly byteLength: number }> => {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
  let byteLength = 0;
  let position = 0;
  for (;;) {
    const result = await file.read(buffer, 0, buffer.byteLength, position);
    if (result.bytesRead === 0) break;
    const part = buffer.subarray(0, result.bytesRead);
    hash.update(part);
    byteLength += result.bytesRead;
    position += result.bytesRead;
    if (!Number.isSafeInteger(byteLength) || byteLength > expectedLength + 1) break;
  }
  return { digest: hash.digest("hex"), byteLength };
};

const assertNoSymlinkChain = async (path: string, stage: string): Promise<void> => {
  const absolute = resolve(path);
  const segments = absolute.split(sep).filter(Boolean);
  let current: string = sep;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", stage);
    } catch (error) {
      if (isMissing(error)) break;
      throw mapFileError(error, stage);
    }
  }
};

const assertDirectory = async (path: string, stage: string): Promise<void> => {
  await assertNoSymlinkChain(path, stage);
  const details = await lstat(path).catch((error: unknown) => {
    throw mapFileError(error, stage);
  });
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", stage);
  }
};

const pathWithin = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

class Semaphore {
  #available: number;
  readonly #waiters: Array<() => void> = [];

  constructor(size: number) {
    this.#available = size;
  }

  async acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available -= 1;
      return;
    }
    await new Promise<void>((resolvePromise) => this.#waiters.push(resolvePromise));
  }

  release(): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter();
    else this.#available += 1;
  }
}

export class FilesystemArtifactStore implements ArtifactStoreV1 {
  readonly #rootDirectory: string;
  readonly #stagingDirectory: string;
  readonly #objectsDirectory: string;
  readonly #quarantineDirectory: string;
  readonly #policy: ArtifactStorePolicyV1;
  readonly #registry: PostgresArtifactRegistry;
  readonly #now: () => Date;
  readonly #failpoint: (point: ArtifactFailpointV1) => void | Promise<void>;
  readonly #writeSlots: Semaphore;
  readonly #readSlots: Semaphore;
  readonly #pendingHandles = new Set<FileHandle>();
  readonly #pendingActiveResolvers = new Map<FileHandle, () => Promise<void>>();
  readonly #activeStreams = new Set<Promise<void>>();
  readonly #activeStagingPaths = new Set<string>();
  #stagingBytes = 0;
  #closed = false;

  private constructor(options: FilesystemArtifactStoreOptionsV1) {
    this.#rootDirectory = resolve(options.rootDirectory);
    this.#stagingDirectory = join(this.#rootDirectory, "staging");
    this.#objectsDirectory = join(this.#rootDirectory, "objects", "sha256");
    this.#quarantineDirectory = join(this.#rootDirectory, "quarantine");
    const parsedPolicy = ArtifactStorePolicyV1Schema.parse(options.policy);
    this.#policy = Object.freeze({
      ...parsedPolicy,
      policyRef: Object.freeze({ ...parsedPolicy.policyRef }),
    });
    this.#registry = options.registry;
    this.#now = options.now ?? (() => new Date());
    this.#failpoint = options.failpoint ?? (() => undefined);
    this.#writeSlots = new Semaphore(this.#policy.maxConcurrentWrites);
    this.#readSlots = new Semaphore(this.#policy.maxConcurrentReads);
  }

  static async create(options: FilesystemArtifactStoreOptionsV1): Promise<FilesystemArtifactStore> {
    const parsedPolicy = ArtifactStorePolicyV1Schema.parse(options.policy);
    if (
      !isAbsolute(options.rootDirectory) ||
      resolve(options.rootDirectory) !== options.rootDirectory
    ) {
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "filesystem.root");
    }
    await assertNoSymlinkChain(options.rootDirectory, "filesystem.root");
    await mkdir(options.rootDirectory, { recursive: true, mode: 0o700 });
    const stagingDirectory = join(options.rootDirectory, "staging");
    const objectsDirectory = join(options.rootDirectory, "objects", "sha256");
    const quarantineDirectory = join(options.rootDirectory, "quarantine");
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    await mkdir(objectsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
    await assertDirectory(options.rootDirectory, "filesystem.root");
    await assertDirectory(stagingDirectory, "filesystem.staging");
    await assertDirectory(join(options.rootDirectory, "objects"), "filesystem.objects-parent");
    await assertDirectory(objectsDirectory, "filesystem.objects");
    await assertDirectory(quarantineDirectory, "filesystem.quarantine");
    const rootStat = await stat(options.rootDirectory);
    for (const directory of [stagingDirectory, objectsDirectory, quarantineDirectory]) {
      const directoryStat = await stat(directory);
      if (rootStat.dev !== directoryStat.dev) {
        throw makeArtifactError("ARTIFACT_IO_FAILURE", "filesystem.same-volume");
      }
    }
    await syncDirectory(options.rootDirectory);
    return new FilesystemArtifactStore({ ...options, policy: parsedPolicy });
  }

  #objectPath(hash: string): string {
    if (!HASH_PATTERN.test(hash))
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "filesystem.hash");
    return join(this.#objectsDirectory, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  async #runFailpoint(point: ArtifactFailpointV1): Promise<void> {
    await this.#failpoint(point);
  }

  async #reserveStaging(bytes: number): Promise<void> {
    if (bytes > this.#policy.stagingMaxBytes - this.#stagingBytes) {
      throw makeArtifactError("ARTIFACT_TOO_LARGE", "staging.quota");
    }
    this.#stagingBytes += bytes;
  }

  #releaseStaging(bytes: number): void {
    this.#stagingBytes = Math.max(0, this.#stagingBytes - bytes);
  }

  async #createStaging(): Promise<{ readonly file: FileHandle; readonly path: string }> {
    await assertDirectory(this.#stagingDirectory, "filesystem.staging");
    for (;;) {
      const path = join(this.#stagingDirectory, `${randomUUID()}.part`);
      try {
        const file = await open(path, "wx", 0o600);
        return { file, path };
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") continue;
        throw mapFileError(error, "staging.create");
      }
    }
  }

  async #verifyObject(path: string, expected: ArtifactContentIdentityV1): Promise<void> {
    const details = await lstat(path).catch((error: unknown) => {
      throw mapFileError(error, "object.lstat");
    });
    if (details.isSymbolicLink() || !details.isFile()) {
      throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "object.type");
    }
    const file = await open(path, "r").catch((error: unknown) => {
      throw mapFileError(error, "object.open");
    });
    try {
      const descriptor = await file.stat();
      if (!descriptor.isFile() || descriptor.size !== expected.byteLength) {
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "object.length");
      }
      const actual = await fileDigest(file, expected.byteLength);
      if (actual.byteLength !== expected.byteLength || actual.digest !== expected.hash.value) {
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "object.hash");
      }
    } finally {
      await file.close();
    }
  }

  async #quarantineExisting(path: string, hash: string): Promise<void> {
    const runDirectory = join(this.#quarantineDirectory, `integrity-${randomUUID()}`);
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const destination = join(runDirectory, hash);
    try {
      await rename(path, destination);
      await syncDirectory(runDirectory);
      await syncDirectory(this.#quarantineDirectory);
    } catch {
      // Keep the original object for operator recovery when isolation itself fails.
    }
  }

  async #publishObject(stagingPath: string, content: ArtifactContentIdentityV1): Promise<boolean> {
    const stagingDetails = await lstat(stagingPath).catch((error: unknown) => {
      throw mapFileError(error, "staging.publish");
    });
    if (
      stagingDetails.isSymbolicLink() ||
      !stagingDetails.isFile() ||
      stagingDetails.size !== content.byteLength
    ) {
      throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "staging.publish-type");
    }
    const objectPath = this.#objectPath(content.hash.value);
    const objectDirectory = join(
      this.#objectsDirectory,
      content.hash.value.slice(0, 2),
      content.hash.value.slice(2, 4),
    );
    await assertDirectory(this.#rootDirectory, "filesystem.root");
    await assertNoSymlinkChain(objectDirectory, "object.directory");
    await mkdir(objectDirectory, { recursive: true, mode: 0o700 });
    await assertDirectory(objectDirectory, "object.directory");
    try {
      await lstat(objectPath);
      try {
        await this.#verifyObject(objectPath, content);
      } catch (error) {
        await this.#quarantineExisting(objectPath, content.hash.value);
        throw error;
      }
      return true;
    } catch (error) {
      if (!isMissing(error)) {
        if (error instanceof ArtifactStoreError) throw error;
        throw mapFileError(error, "object.inspect");
      }
    }
    try {
      await this.#runFailpoint("object.link");
      await link(stagingPath, objectPath);
      const object = await open(objectPath, "r");
      try {
        await object.sync();
      } finally {
        await object.close();
      }
      await syncDirectory(objectDirectory);
      await syncDirectory(join(this.#objectsDirectory, content.hash.value.slice(0, 2)));
      await syncDirectory(this.#objectsDirectory);
      await syncDirectory(join(this.#rootDirectory, "objects"));
      return false;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        try {
          await this.#verifyObject(objectPath, content);
          return true;
        } catch (verifyError) {
          await this.#quarantineExisting(objectPath, content.hash.value);
          throw verifyError;
        }
      }
      throw mapFileError(error, "object.link");
    }
  }

  async #removeStaging(stagingPath: string, stagedBytes: number): Promise<void> {
    let removed = false;
    try {
      await rm(stagingPath, { force: true });
      removed = true;
      await syncDirectory(this.#stagingDirectory);
    } catch {
      // A committed immutable object remains valid if cleanup is interrupted.
    } finally {
      if (removed) this.#releaseStaging(stagedBytes);
    }
  }

  async verifyObjectForMaintenance(content: ArtifactContentIdentityV1): Promise<void> {
    await this.#verifyObject(this.#objectPath(content.hash.value), content);
  }

  async verifyPathForMaintenance(path: string, content: ArtifactContentIdentityV1): Promise<void> {
    await this.#verifyObject(path, content);
  }

  async put(
    command: ArtifactPutCommandV1,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ArtifactPutResultV1> {
    if (this.#closed) throw makeArtifactError("ARTIFACT_IO_FAILURE", "store.closed");
    const parsed = ArtifactPutCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "put.command");
    const value = parsed.data;
    const prepared = await this.#registry.preparePutMetadata(value);
    await this.#writeSlots.acquire();
    if (this.#closed) {
      this.#writeSlots.release();
      throw makeArtifactError("ARTIFACT_IO_FAILURE", "store.closed");
    }
    let stagingPath: string | undefined;
    let stagedBytes = 0;
    try {
      const staging = await this.#createStaging();
      stagingPath = staging.path;
      this.#activeStagingPaths.add(stagingPath);
      const hash = createHash("sha256");
      try {
        for await (const chunk of content) {
          if (!(chunk instanceof Uint8Array))
            throw makeArtifactError("ARTIFACT_INPUT_INVALID", "staging.chunk");
          const nextLength = stagedBytes + chunk.byteLength;
          if (!Number.isSafeInteger(nextLength) || nextLength > this.#policy.maxArtifactBytes) {
            throw makeArtifactError("ARTIFACT_TOO_LARGE", "staging.max-artifact");
          }
          await this.#reserveStaging(chunk.byteLength);
          stagedBytes += chunk.byteLength;
          await writeAll(staging.file, chunk);
          hash.update(chunk);
        }
        await this.#runFailpoint("staging.sync");
        await staging.file.sync();
      } finally {
        await staging.file.close();
      }
      const actualHash = hash.digest("hex");
      const actualContent = ArtifactContentIdentityV1Schema.parse({
        hash: { algorithm: "sha256", value: actualHash },
        byteLength: stagedBytes,
      });
      if (
        (value.expectedHash !== undefined && value.expectedHash.value !== actualHash) ||
        (value.expectedByteLength !== undefined && value.expectedByteLength !== stagedBytes)
      ) {
        throw makeArtifactError("ARTIFACT_HASH_MISMATCH", "staging.expected");
      }
      const artifactRef = {
        kind:
          value.artifactKind === "content"
            ? ("content-artifact" as const)
            : ("diagnostic-artifact" as const),
        reference: { entityId: value.artifactId, versionId: `sha256:${actualHash}` },
      };
      const manifest: ArtifactManifestV1 = ArtifactManifestV1Schema.parse({
        schemaVersion: "1",
        artifactRef,
        artifactKind: value.artifactKind,
        content: actualContent,
        mediaType: value.mediaType,
        purposeCode: value.purposeCode,
        access: {
          ...prepared.access,
          spatialScopeRefs: prepared.access.spatialScopeRefs,
          sourceAccessGrantRefs: prepared.access.sourceAccessGrantRefs,
          authorizationPolicyRefs: prepared.access.authorizationPolicyRefs,
        },
        writePolicyRef: this.#policy.policyRef,
        parentArtifactRefs: value.parentArtifactRefs,
        evidenceReferences: prepared.evidenceReferences,
        producerCommandId: value.commandId,
        authorizationContextRef: value.authorization.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: `artifact-audit-${value.commandId}`, versionId: "v1" },
        },
        occurredAt: value.issuedAt,
        recordedAt: value.issuedAt,
        persistedAt: value.issuedAt,
      });
      const digest = manifestSha256(manifest);
      const result = await this.#registry.withAdvisoryLock(
        this.#policy,
        async () => {
          await this.#runFailpoint("registry");
          const deduplicated = await this.#publishObject(stagingPath!, actualContent);
          const registration = await this.#registry.register(
            value,
            manifest,
            digest,
            value.purposeCode === "artifact-hash-manifest"
              ? "artifact.hash-manifest-created"
              : "artifact.put",
          );
          const putResult = ArtifactPutResultV1Schema.parse({
            artifactRef: registration.manifest.artifactRef,
            manifest: registration.manifest,
            manifestSha256: registration.manifestSha256,
            replayed: registration.replayed,
            deduplicated,
          });
          await this.#runFailpoint("response");
          await this.#removeStaging(stagingPath!, stagedBytes);
          return putResult;
        },
        "shared",
      );
      return result;
    } catch (error) {
      if (stagingPath !== undefined) {
        await this.#registry
          .withAdvisoryLock(
            this.#policy,
            () => this.#removeStaging(stagingPath!, stagedBytes),
            "shared",
          )
          .catch(() => undefined);
      }
      throw mapFileError(error, "put");
    } finally {
      if (stagingPath !== undefined) this.#activeStagingPaths.delete(stagingPath);
      this.#writeSlots.release();
    }
  }

  async #recordAccess(
    request: ArtifactReadRequestV1,
    outcome: ArtifactAccessRecordV1["outcome"],
    stage: string,
    diagnosticRef?: ArtifactAccessRecordV1["diagnosticRef"],
  ): Promise<void> {
    await this.#registry.recordAccessOutcome({
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      projectId: request.projectId,
      actorId: request.actorId,
      occurredAt: this.#now().toISOString(),
      purposeCode: request.purposeCode,
      authorizationContextRef: request.authorization.authorizationContextRef,
      authorizationPolicyRef: request.authorization.authorizationPolicyRef,
      outcome,
      stage,
      ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
    });
  }

  async #saveDiagnostic(
    request: ArtifactReadRequestV1,
    stage: string,
    details: unknown,
  ): Promise<ArtifactAccessRecordV1["diagnosticRef"]> {
    const suffix = stage.replace(/[^A-Za-z0-9._-]/gu, "-");
    const id = `diagnostic-${request.requestId}-${suffix}`;
    const body = encoder.encode(canonicalJson({ schemaVersion: "1", stage, details }));
    const command = ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: id,
      idempotencyKey: id,
      projectId: request.projectId,
      actorId: request.actorId,
      issuedAt: this.#now().toISOString(),
      authorization: request.authorization,
      requiredCapability: request.requiredCapability,
      artifactId: id,
      artifactKind: "diagnostic",
      purposeCode: "artifact-diagnostic",
      mediaType: "application/json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    });
    const result = await this.put(
      command,
      (async function* () {
        yield body;
      })(),
    );
    return result.artifactRef.kind === "diagnostic-artifact" ? result.artifactRef : undefined;
  }

  async #recordDenied(request: ArtifactReadRequestV1, stage: string): Promise<void> {
    await this.#recordAccess(request, "denied", stage);
  }

  async #recordIntegrityFailure(
    request: ArtifactReadRequestV1,
    stage: string,
    error: unknown,
  ): Promise<void> {
    const diagnosticRef = await this.#saveDiagnostic(request, stage, {
      code: error instanceof ArtifactStoreError ? error.code : "ARTIFACT_IO_FAILURE",
    });
    await this.#recordAccess(request, "integrity-failed", stage, diagnosticRef);
  }

  async #readGenerator(
    file: FileHandle,
    request: ArtifactReadRequestV1,
    manifest: ArtifactManifestV1,
    resolveVerified: (receipt: ReturnType<typeof ArtifactReadReceiptV1Schema.parse>) => void,
    rejectVerified: (error: unknown) => void,
    resolveActive: () => void,
  ): Promise<AsyncIterable<Uint8Array>> {
    const pendingActiveResolvers = this.#pendingActiveResolvers;
    let started = false;
    let settled = false;
    let cancelled = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      pendingActiveResolvers.delete(file);
      this.#pendingHandles.delete(file);
      this.#readSlots.release();
      resolveActive();
    };
    const settleCancelled = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      await this.#recordAccess(request, "cancelled", "read.cancelled");
      rejectVerified(makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.cancelled"));
    };
    const abort = async (): Promise<void> => {
      cancelled = true;
      if (!started) {
        await settleCancelled();
        await file.close().catch(() => undefined);
        cleanup();
        return;
      }
      await file.close().catch(() => undefined);
    };
    const abortPending = (): Promise<void> => abort();
    pendingActiveResolvers.set(file, abortPending);
    const maxArtifactBytes = this.#policy.maxArtifactBytes;
    const now = this.#now;
    const recordAccess = this.#recordAccess.bind(this);
    const recordIntegrityFailure = this.#recordIntegrityFailure.bind(this);
    async function* consume(): AsyncGenerator<Uint8Array> {
      started = true;
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
      let byteLength = 0;
      let position = 0;
      try {
        for (;;) {
          const result = await file.read(buffer, 0, buffer.byteLength, position);
          if (result.bytesRead === 0) break;
          const chunk = buffer.subarray(0, result.bytesRead);
          hash.update(chunk);
          byteLength += result.bytesRead;
          position += result.bytesRead;
          if (!Number.isSafeInteger(byteLength) || byteLength > maxArtifactBytes)
            throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.length");
          yield chunk;
        }
        const digest = hash.digest("hex");
        if (byteLength !== manifest.content.byteLength || digest !== manifest.content.hash.value)
          throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.hash");
        const receipt = ArtifactReadReceiptV1Schema.parse({
          schemaVersion: "1",
          requestId: request.requestId,
          artifactRef: manifest.artifactRef,
          content: manifest.content,
          authorizationContextRef: request.authorization.authorizationContextRef,
          verifiedAt: now().toISOString(),
        });
        await recordAccess(request, "succeeded", "read.succeeded");
        settled = true;
        resolveVerified(receipt);
      } catch (error) {
        const mapped = mapFileError(error, "read.stream");
        if (!settled) {
          if (cancelled) {
            await settleCancelled();
          } else {
            settled = true;
            try {
              await recordIntegrityFailure(request, "read.integrity", mapped);
            } catch (recordError) {
              rejectVerified(recordError);
              throw recordError;
            }
            rejectVerified(mapped);
          }
        }
        throw mapped;
      } finally {
        await file.close().catch(() => undefined);
        if (!settled) await settleCancelled();
        cleanup();
      }
    }
    const iterator = consume();
    const wrapped: AsyncIterableIterator<Uint8Array> = {
      next: (value?: unknown) => {
        started = true;
        return iterator.next(value as undefined);
      },
      return: async (value?: unknown) => {
        cancelled = true;
        if (!started) {
          await abort();
          return { done: true, value: value as undefined };
        }
        return iterator.return(value as undefined);
      },
      throw: async (error?: unknown) => {
        cancelled = true;
        if (!started) await abort();
        return iterator.throw(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return wrapped;
  }

  async open(request: ArtifactReadRequestV1): Promise<ArtifactReadHandleV1> {
    if (this.#closed) throw makeArtifactError("ARTIFACT_IO_FAILURE", "store.closed");
    const parsed = ArtifactReadRequestV1Schema.safeParse(request);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "read.command");
    const value = parsed.data;
    let manifest: ArtifactManifestV1 | undefined;
    try {
      manifest = await this.#registry.readManifest(value.projectId, value.artifactRef);
      if (manifest === undefined)
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "read.authorization");
      this.#registry.assertReadable(manifest, {
        projectId: value.projectId,
        purposeCode: value.purposeCode,
        requiredCapability: value.requiredCapability,
        authorization: value.authorization,
      });
    } catch (error) {
      if (error instanceof ArtifactStoreError && error.code === "ARTIFACT_ACCESS_DENIED") {
        await this.#recordDenied(value, "read.authorization");
        throw error;
      }
      throw mapFileError(error, "read.authorization");
    }
    const digest = await this.#registry.readManifestDigest(value.projectId, value.artifactRef);
    if (digest === undefined) {
      await this.#recordDenied(value, "read.authorization");
      throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "read.authorization");
    }
    if (digest !== manifestSha256(manifest)) {
      await this.#recordIntegrityFailure(value, "read.manifest-digest", "manifest digest");
      throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.manifest-digest");
    }
    await this.#recordAccess(value, "authorized", "read.authorized");
    await this.#readSlots.acquire();
    try {
      await assertNoSymlinkChain(this.#rootDirectory, "read.root");
      const objectPath = this.#objectPath(manifest.content.hash.value);
      const realObjectPath = await realpath(objectPath).catch((error: unknown) => {
        throw mapFileError(error, "read.realpath");
      });
      if (!pathWithin(this.#rootDirectory, realObjectPath) || realObjectPath !== objectPath) {
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.path");
      }
      const details = await lstat(objectPath).catch((error: unknown) => {
        if (isMissing(error)) throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.missing");
        throw mapFileError(error, "read.lstat");
      });
      if (details.isSymbolicLink() || !details.isFile())
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.type");
      const file = await open(objectPath, "r").catch((error: unknown) => {
        throw mapFileError(error, "read.open");
      });
      this.#pendingHandles.add(file);
      let descriptor;
      try {
        descriptor = await file.stat();
      } catch (error) {
        await file.close().catch(() => undefined);
        this.#pendingHandles.delete(file);
        throw mapFileError(error, "read.fstat");
      }
      if (!descriptor.isFile() || descriptor.size !== manifest.content.byteLength) {
        await file.close();
        this.#pendingHandles.delete(file);
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "read.length");
      }
      let resolveVerified!: (receipt: ReturnType<typeof ArtifactReadReceiptV1Schema.parse>) => void;
      let rejectVerified!: (error: unknown) => void;
      const verified = new Promise<ReturnType<typeof ArtifactReadReceiptV1Schema.parse>>(
        (resolvePromise, rejectPromise) => {
          resolveVerified = resolvePromise;
          rejectVerified = rejectPromise;
        },
      );
      void verified.catch(() => undefined);
      let resolveActive!: () => void;
      const active = new Promise<void>((resolvePromise) => {
        resolveActive = resolvePromise;
      });
      this.#activeStreams.add(active);
      const content = await this.#readGenerator(
        file,
        value,
        manifest,
        resolveVerified,
        rejectVerified,
        resolveActive,
      );
      void active.finally(() => this.#activeStreams.delete(active));
      return { manifest, content, verified };
    } catch (error) {
      this.#readSlots.release();
      const mapped = mapFileError(error, "read");
      try {
        await this.#recordIntegrityFailure(value, mapped.stage, mapped);
      } catch (recordError) {
        throw mapFileError(recordError, "read.audit");
      }
      throw mapped;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const file of [...this.#pendingHandles]) {
      await this.#pendingActiveResolvers.get(file)?.();
      await file.close().catch(() => undefined);
    }
    await Promise.all([...this.#activeStreams]);
  }

  isStagingActiveForMaintenance(stagingId: string): boolean {
    return this.#activeStagingPaths.has(join(this.#stagingDirectory, `${stagingId}.part`));
  }

  objectPathForTesting(hash: ArtifactHashV1): string {
    return this.#objectPath(hash.value);
  }

  async listObjectHashesForTesting(): Promise<string[]> {
    const result: string[] = [];
    const first = await readdir(this.#objectsDirectory, { withFileTypes: true });
    for (const aa of first) {
      if (!aa.isDirectory() || !HASH_PATTERN.test(`${aa.name}${"0".repeat(62)}`.slice(0, 64)))
        continue;
      const second = await readdir(join(this.#objectsDirectory, aa.name), { withFileTypes: true });
      for (const bb of second) {
        if (!bb.isDirectory()) continue;
        const hashes = await readdir(join(this.#objectsDirectory, aa.name, bb.name), {
          withFileTypes: true,
        });
        for (const item of hashes)
          if (item.isFile() && HASH_PATTERN.test(item.name)) result.push(item.name);
      }
    }
    return result.sort();
  }
}

export const createFilesystemArtifactStore = (
  options: FilesystemArtifactStoreOptionsV1,
): Promise<FilesystemArtifactStore> => FilesystemArtifactStore.create(options);
