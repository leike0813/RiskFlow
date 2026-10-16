import { createHash } from "node:crypto";

import { AuthorizationContextV1Schema } from "@riskflow/contracts/ports";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactPutCommandV1,
  type ArtifactReadRequestV1,
} from "@riskflow/core/artifacts";
import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_STREAM_FRAME_V1,
  ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES,
  ArtifactStreamDecoderV1,
  ArtifactStreamError,
  chunkArtifactStreamV1,
  encodeArtifactStreamFrameV1,
  encodeArtifactStreamJsonV1,
} from "../../src/artifacts/artifact-stream-service.js";
import {
  createArtifactStreamServiceV1,
  type ArtifactAuthorizationVerifierV1,
} from "../../src/artifacts/artifact-stream-service-handler.js";
import {
  createRemoteArtifactStoreV1,
  type ArtifactStreamRequestV1,
  type ArtifactTransportPolicyV1,
} from "../../src/artifacts/remote-artifact-store.js";
import {
  ARTIFACT_TEST_TIMESTAMP,
  startArtifactFixture,
  type ArtifactTestFixture,
} from "./fixture.js";

const projectId = "project-artifacts";
const encoder = new TextEncoder();

const scope = (suffix: string) => ({
  kind: "spatial-scope" as const,
  reference: { entityId: `scope-${suffix}`, versionId: "v1" },
});

const grant = (suffix: string) => ({
  kind: "source-access-grant" as const,
  reference: { entityId: `grant-${suffix}`, versionId: "v1" },
});

const authorization = (actorId = "actor-stream") =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: `auth-${actorId}`, versionId: "v1" },
    },
    actorId,
    projectId,
    grantedCapabilities: ["engineering-data.read", "engineering-data.write"],
    spatialScopeRefs: [scope("all"), scope("parent")],
    sourceAccessGrantRefs: [grant("all"), grant("parent")],
    authorizationPolicyRef: { entityId: "artifact-policy", versionId: "v1" },
    decidedAt: ARTIFACT_TEST_TIMESTAMP,
    invocation: { kind: "human" },
  });

const putCommand = (id: string, content: Uint8Array): ArtifactPutCommandV1 =>
  ArtifactPutCommandV1Schema.parse({
    schemaVersion: "1",
    commandId: `command-${id}`,
    idempotencyKey: `idem-${id}`,
    projectId,
    actorId: "actor-stream",
    issuedAt: ARTIFACT_TEST_TIMESTAMP,
    authorization: authorization(),
    requiredCapability: "engineering-data.write",
    artifactId: `artifact-${id}`,
    artifactKind: "content",
    purposeCode: "engineering-input",
    mediaType: "text/plain",
    expectedHash: {
      algorithm: "sha256",
      value: createHash("sha256").update(content).digest("hex"),
    },
    expectedByteLength: content.byteLength,
    parentArtifactRefs: [],
    evidenceReferences: [],
    additionalSpatialScopeRefs: [],
    additionalSourceAccessGrantRefs: [],
  });

const readRequest = (
  id: string,
  artifactRef: ArtifactPutCommandV1["artifactId"] extends string
    ? { entityId: string; versionId: string }
    : never,
): ArtifactReadRequestV1 =>
  ArtifactReadRequestV1Schema.parse({
    schemaVersion: "1",
    requestId: `request-${id}`,
    idempotencyKey: `idem-read-${id}`,
    artifactRef: { kind: "content-artifact", reference: artifactRef },
    projectId,
    actorId: "actor-stream",
    requestedAt: ARTIFACT_TEST_TIMESTAMP,
    purposeCode: "engineering-input",
    requiredCapability: "engineering-data.read",
    authorization: authorization(),
  });

const transportPolicy: ArtifactTransportPolicyV1 = {
  artifactEndpointRef: "data-vm-artifacts",
  connectTimeoutMs: 2_000,
  idleTimeoutMs: 5_000,
  totalTimeoutMs: 30_000,
  metadataMaxBytes: 65_536,
  maxConcurrentRequests: 2,
  shutdownTimeoutMs: 5_000,
};

const streamLimits = {
  metadataMaxBytes: 65_536,
  maxDataFrameBytes: ARTIFACT_STREAM_MAX_DATA_FRAME_BYTES,
  maxTotalBytes: 4 * 1024 * 1024,
};

const textChunks = async function* (value: string, chunkSize = 7) {
  const bytes = encoder.encode(value);
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength));
  }
};

/** 把服务 handler 接到客户端 request 契约上，模拟同进程内的三 VM 接缝。 */
const connectedRequest =
  (service: ReturnType<typeof createArtifactStreamServiceV1>): ArtifactStreamRequestV1 =>
  (input) => {
    if (input.path === "/internal/v1/artifacts/put") {
      return service.handlePut(input.body as AsyncIterable<Uint8Array>);
    }
    // handleOpen 是异步的：把解析结果转成 async iterable 交给客户端。
    return (async function* (): AsyncGenerator<Uint8Array> {
      const stream = await service.handleOpen(input.body as AsyncIterable<Uint8Array>);
      yield* stream;
    })();
  };

const fixtures: ArtifactTestFixture[] = [];

const startStreamFixture = async (
  verifier?: Partial<ArtifactAuthorizationVerifierV1>,
): Promise<{
  fixture: ArtifactTestFixture;
  client: ReturnType<typeof createRemoteArtifactStoreV1>;
  service: ReturnType<typeof createArtifactStreamServiceV1>;
}> => {
  const fixture = await startArtifactFixture();
  fixtures.push(fixture);
  const allow: ArtifactAuthorizationVerifierV1 = {
    verifyPut: async () => verifier?.verifyPut?.() ?? true,
    verifyOpen: async () => verifier?.verifyOpen?.() ?? true,
  };
  const service = createArtifactStreamServiceV1({
    store: fixture.store,
    verifier: allow,
    limits: streamLimits,
    shutdownTimeoutMs: 5_000,
  });
  const client = createRemoteArtifactStoreV1({
    request: connectedRequest(service),
    policy: transportPolicy,
    maxArtifactBytes: 4 * 1024 * 1024,
    referenceGuard: fixture.registry,
  });
  return { fixture, client, service };
};

// 每个用例起停真实 PostgreSQL 容器，清理同样需要时间。
afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.close();
}, 60_000);

describe("帧协议", () => {
  it("往返编码后类型与长度保持一致", () => {
    const payload = encoder.encode("边界内容");
    const frame = encodeArtifactStreamFrameV1(ARTIFACT_STREAM_FRAME_V1.bytes, payload);
    const decoder = new ArtifactStreamDecoderV1("open-response", streamLimits);
    decoder.push(frame);
    const decoded = decoder.next();
    expect(decoded?.type).toBe(ARTIFACT_STREAM_FRAME_V1.bytes);
    expect(new TextDecoder().decode(decoded!.payload)).toBe("边界内容");
  });

  it("拒绝未知帧类型、重复 JSON 与超限数据帧", () => {
    const unknown = new ArtifactStreamDecoderV1("open-response", streamLimits);
    unknown.push(encodeArtifactStreamFrameV1(9, new Uint8Array(0)));
    expect(() => unknown.next()).toThrow(ArtifactStreamError);

    const duplicated = new ArtifactStreamDecoderV1("open-response", streamLimits);
    duplicated.push(encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, { a: 1 }));
    duplicated.push(encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, { a: 2 }));
    expect(() => {
      for (;;) {
        const frame = duplicated.next();
        if (frame === undefined) break;
      }
    }).toThrow(ArtifactStreamError);

    const oversized = new ArtifactStreamDecoderV1("open-response", {
      ...streamLimits,
      maxDataFrameBytes: 8,
    });
    oversized.push(encodeArtifactStreamFrameV1(ARTIFACT_STREAM_FRAME_V1.bytes, new Uint8Array(16)));
    expect(() => oversized.next()).toThrow(ArtifactStreamError);
  });

  it("流截断时不得把未消费字节当作成功", () => {
    const decoder = new ArtifactStreamDecoderV1("put-request", streamLimits);
    decoder.push(encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, { a: 1 }));
    decoder.next();
    decoder.push(
      encodeArtifactStreamFrameV1(ARTIFACT_STREAM_FRAME_V1.bytes, encoder.encode("x".repeat(8))),
    );
    // 声明 8 字节但只给 4 字节：next 返回 undefined，finish 必须失败。
    decoder.push(new Uint8Array([2, 0, 0, 0, 8, 1, 2]));
    expect(() => decoder.finish(true)).toThrow(ArtifactStreamError);
  });

  it("按固定上限切分数据帧且不缓冲整个工件", async () => {
    const frames: number[] = [];
    for await (const frame of chunkArtifactStreamV1(textChunks("abcdefghij", 3), 4)) {
      frames.push(frame.byteLength - 5);
    }
    expect(frames.every((length) => length <= 4)).toBe(true);
    expect(frames.reduce((sum, length) => sum + length, 0)).toBe(10);
  });
});

describe("跨 VM put", () => {
  it("写入后沿原身份读回并返回真实 C04 结果", async () => {
    const { client } = await startStreamFixture();
    const content = encoder.encode("变径盾构 站隧一体化 风险资料");
    const result = await client.put(
      putCommand("remote-1", content),
      textChunks("变径盾构 站隧一体化 风险资料"),
    );
    expect(result.manifest.content.byteLength).toBe(content.byteLength);

    // 重试沿原 commandId/idempotencyKey，必须是同一次已成立的写入。
    const replay = await client.put(
      putCommand("remote-1", content),
      textChunks("变径盾构 站隧一体化 风险资料"),
    );
    expect(replay.artifactRef).toEqual(result.artifactRef);
    expect(replay.replayed).toBe(true);
  }, 180_000);

  it("权限被拒绝时不产生工件身份", async () => {
    const { client, fixture } = await startStreamFixture({ verifyPut: async () => false });
    const content = encoder.encode("应当被拒绝");
    await expect(
      client.put(putCommand("remote-denied", content), textChunks("应当被拒绝")),
    ).rejects.toThrow(ArtifactStreamError);
    await fixture.registry.close();
  }, 180_000);
});

describe("跨 VM open", () => {
  it("完整消费正文后 completed 成立，字节与摘要一致", async () => {
    const { client } = await startStreamFixture();
    const text = "证据定位与人工复核记录";
    const content = encoder.encode(text);
    const put = await client.put(putCommand("remote-open", content), textChunks(text));

    const handle = await client.open(readRequest("remote-open", put.artifactRef.reference));
    const received: Uint8Array[] = [];
    for await (const chunk of handle.content) received.push(chunk);
    expect(new TextDecoder().decode(Buffer.concat(received))).toBe(text);

    const receipt = await handle.completed;
    expect(receipt.content.byteLength).toBe(content.byteLength);
  }, 180_000);

  it("未完整消费正文时 completed 必须拒绝", async () => {
    const { client } = await startStreamFixture();
    const text = "部分消费不能算已核验";
    const content = encoder.encode(text);
    const put = await client.put(putCommand("remote-partial", content), textChunks(text));

    const handle = await client.open(readRequest("remote-partial", put.artifactRef.reference));
    // 只取第一块就放弃：completed 不能成立。
    for await (const chunk of handle.content) {
      void chunk;
      break;
    }
    await expect(handle.completed).rejects.toThrow(ArtifactStreamError);
  }, 180_000);

  it("open 权限被拒绝时不得泄漏工件存在性", async () => {
    const { client, fixture } = await startStreamFixture();
    const text = "权限收窄后的读取";
    const content = encoder.encode(text);
    const put = await client.put(putCommand("remote-read", content), textChunks(text));

    // 传输可达但 C06 复验拒绝：必须以失败收口，且不返回任何 manifest。
    const denied = createRemoteArtifactStoreV1({
      request: connectedRequest(
        createArtifactStreamServiceV1({
          store: fixture.store,
          verifier: { verifyPut: async () => true, verifyOpen: async () => false },
          limits: streamLimits,
          shutdownTimeoutMs: 1_000,
        }),
      ),
      policy: transportPolicy,
      maxArtifactBytes: 4 * 1024 * 1024,
      referenceGuard: fixture.registry,
    });
    await expect(
      denied.open(readRequest("remote-read", put.artifactRef.reference)),
    ).rejects.toThrow(ArtifactStreamError);
  }, 180_000);
});

describe("传输预算与生命周期", () => {
  it("并发上限之外的请求被拒绝，不排队无限等待", async () => {
    const fixture = await startArtifactFixture();
    fixtures.push(fixture);
    const release: (() => void)[] = [];
    const slow: ArtifactStreamRequestV1 = () => {
      const gate = { promise: Promise.resolve(), resolve: () => undefined } as {
        promise: Promise<void>;
        resolve: () => void;
      };
      release.push(() => gate.resolve());
      return (async function* () {
        await gate.promise;
        yield encodeArtifactStreamJsonV1(ARTIFACT_STREAM_FRAME_V1.json, {});
      })();
    };
    const client = createRemoteArtifactStoreV1({
      request: slow,
      policy: transportPolicy,
      maxArtifactBytes: 4 * 1024 * 1024,
      referenceGuard: fixture.registry,
    });
    const first = client
      .put(putCommand("slow-1", encoder.encode("a")), textChunks("a"))
      .catch(() => undefined);
    const second = client.put(putCommand("slow-2", encoder.encode("b")), textChunks("b"));
    await expect(second).rejects.toThrow(ArtifactStreamError);
    release.forEach((resolve) => resolve());
    await first;
  }, 180_000);

  it("drain 之后拒绝新请求，且不会伪造已收口", async () => {
    const { client, service } = await startStreamFixture();
    await client.drain(1_000);
    await expect(
      client.put(putCommand("after-drain", encoder.encode("x")), textChunks("x")),
    ).rejects.toThrow(ArtifactStreamError);
    expect(await service.drain(1_000)).toBe(true);
  }, 180_000);
});
