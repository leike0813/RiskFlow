import {
  HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
  RETRIEVAL_BM25_VECTOR_NAME_V1,
  RETRIEVAL_DENSE_VECTOR_NAME_V1,
  RetrievalHybridQueryResultV1Schema,
  RetrievalPointPayloadV1Schema,
  RetrievalProjectionObservationV1Schema,
  retrievalCollectionNameFor,
  type HybridRetrievalFailureCodeV1,
  type HybridRetrievalPolicyV1,
  type RetrievalGenerationRefV1,
  type RetrievalHybridQueryResultV1,
  type RetrievalHybridQueryV1,
  type RetrievalIndexManifestV1,
  type RetrievalMemberManifestEntryV1,
  type RetrievalPointPayloadV1,
  type RetrievalProjectionObservationV1,
  type RetrievalProjectionPointV1,
  type RetrievalProjectionPortV1,
} from "@riskflow/core/retrieval";

/**
 * Qdrant 检索投影 adapter（design D4/D7）。只用 Node 原生 fetch 与既有 Zod 边界，
 * 不引入 Qdrant SDK；线上报文 Schema 留在这里，不泄漏为领域 API。
 *
 * 失败语义封闭：传输失败/超时/非 2xx 抛 `QDRANT_UNAVAILABLE`；响应形状或载荷违反本模块
 * 契约抛 `QDRANT_INVALID_RESPONSE`；已有 collection 与策略能力不一致抛 `POLICY_INCOMPATIBLE`；
 * 超出策略资源上限抛 `RESOURCE_LIMIT_EXCEEDED`。任何路径都不会把失败吞成空结果。
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const DISTANCE_BY_POLICY: Readonly<Record<HybridRetrievalPolicyV1["dense"]["distance"], string>> = {
  cosine: "Cosine",
  dot: "Dot",
  euclid: "Euclid",
};

/** adapter 结构化失败；`code` 取自 C20 固定失败码，`detailCode` 不含任何正文或授权信息。 */
export class QdrantRetrievalProjectionError extends Error {
  readonly code: HybridRetrievalFailureCodeV1;
  readonly detailCode: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: HybridRetrievalFailureCodeV1;
    readonly detailCode: string;
    readonly retryable?: boolean;
  }) {
    super(`${input.code}:${input.detailCode}`);
    this.name = "QdrantRetrievalProjectionError";
    this.code = input.code;
    this.detailCode = input.detailCode;
    this.retryable = input.retryable ?? false;
  }
}

export interface QdrantRetrievalProjectionOptionsV1 {
  readonly baseUrl: string;
  /** 无策略可用的调用（service version、collection 配置核对、分页 inspect）使用的墙钟上限。 */
  readonly requestTimeoutMs?: number;
  /** 测试注入点：用于确定性复现非法响应，不改变生产路径。 */
  readonly fetchImpl?: typeof fetch;
}

const invalidResponse = (detailCode: string): QdrantRetrievalProjectionError =>
  new QdrantRetrievalProjectionError({ code: "QDRANT_INVALID_RESPONSE", detailCode });

const incompatible = (detailCode: string): QdrantRetrievalProjectionError =>
  new QdrantRetrievalProjectionError({ code: "POLICY_INCOMPATIBLE", detailCode });

const recordAt = (value: unknown, detailCode: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(detailCode);
  }
  return value as Readonly<Record<string, unknown>>;
};

const optionalRecordAt = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
};

const arrayAt = (value: unknown, detailCode: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw invalidResponse(detailCode);
  return value;
};

const stringAt = (value: unknown, detailCode: string): string => {
  if (typeof value !== "string" || value.length === 0) throw invalidResponse(detailCode);
  return value;
};

const finiteNumberAt = (value: unknown, detailCode: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidResponse(detailCode);
  return value;
};

/** Qdrant 对字符串 uuid 回显字符串，对整数 id 回显数字；这里统一映射回 pointId 字符串空间。 */
const pointIdAt = (value: unknown, detailCode: string): string => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  throw invalidResponse(detailCode);
};

/** Qdrant 成功响应统一为 `{"result":…,"status":"ok"}`；status 非 ok 视为契约违例。 */
const envelopeAt = (body: unknown, detailCode: string): Readonly<Record<string, unknown>> => {
  const envelope = recordAt(body, detailCode);
  if (envelope["status"] !== "ok") throw invalidResponse(detailCode);
  return envelope;
};

const resultAt = (body: unknown, detailCode: string): Readonly<Record<string, unknown>> =>
  recordAt(envelopeAt(body, detailCode)["result"], detailCode);

const queryPointsAt = (body: unknown, detailCode: string): readonly unknown[] =>
  arrayAt(resultAt(body, detailCode)["points"], detailCode);

const collectionPath = (collectionName: string): string =>
  `/collections/${encodeURIComponent(collectionName)}`;

const filterBody = (input: {
  readonly projectId: string;
  readonly generationKey: string;
  readonly authorizationScopeDigest: string;
}): Readonly<Record<string, unknown>> => ({
  must: [
    { key: "projectId", match: { value: input.projectId } },
    { key: "generationKey", match: { value: input.generationKey } },
    { key: "authorizationScopeDigest", match: { value: input.authorizationScopeDigest } },
  ],
});

/** document 与 query 必须使用同一份 BM25 inference 配置，否则双路分值不可比。 */
const bm25InferenceBody = (
  policy: HybridRetrievalPolicyV1,
  text: string,
): Readonly<Record<string, unknown>> => ({
  text,
  model: policy.bm25.model,
  options: {
    tokenizer: policy.bm25.tokenizer,
    language: policy.bm25.language,
    stemmer: { type: policy.bm25.stemmer },
    stopwords: { languages: [], custom: [...policy.bm25.stopwords] },
    lowercase: true,
  },
});

const payloadFor = (
  manifest: RetrievalIndexManifestV1,
  member: RetrievalMemberManifestEntryV1,
): Readonly<Record<string, unknown>> =>
  RetrievalPointPayloadV1Schema.parse({
    schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
    projectId: manifest.projectId,
    generationRef: manifest.generationRef,
    generationKey: manifest.generationRef.reference.versionId,
    sourceKind: member.sourceKind,
    sourceReleaseRef: member.sourceReleaseRef,
    sourceEntryId: member.sourceEntryId,
    contentDigest: member.contentDigest,
    authorizationScopeDigest: member.authorizationScopeDigest,
  });

const routeHitsAt = (
  body: unknown,
  detailCode: string,
): readonly { readonly pointId: string; readonly rank: number; readonly score: number }[] =>
  queryPointsAt(body, detailCode).map((point, index) => {
    const record = recordAt(point, detailCode);
    return {
      pointId: pointIdAt(record["id"], detailCode),
      rank: index + 1,
      score: finiteNumberAt(record["score"], detailCode),
    };
  });

interface WireResponse {
  readonly status: number;
  readonly body: unknown;
}

export class QdrantRetrievalProjection implements RetrievalProjectionPortV1 {
  readonly #baseUrl: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: QdrantRetrievalProjectionOptionsV1) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async serviceVersion(): Promise<{ readonly version: string }> {
    const response = await this.#send({
      method: "GET",
      path: "/",
      timeoutMs: this.#requestTimeoutMs,
    });
    return {
      version: stringAt(recordAt(response.body, "service-version")["version"], "service-version"),
    };
  }

  async ensureCollection(input: {
    readonly collectionName: string;
    readonly policy: HybridRetrievalPolicyV1;
  }): Promise<{ readonly created: boolean }> {
    const path = collectionPath(input.collectionName);
    const response = await this.#send({
      method: "PUT",
      path,
      body: {
        vectors: {
          [input.policy.dense.vectorName]: {
            size: input.policy.dense.dimensions,
            distance: DISTANCE_BY_POLICY[input.policy.dense.distance],
          },
        },
        sparse_vectors: { [input.policy.bm25.vectorName]: { modifier: "idf" } },
      },
      timeoutMs: input.policy.projectionTimeoutMs,
      acceptStatuses: [409],
    });
    if (response.status === 409) {
      await this.#assertCollectionCompatible(path, input.policy, input.policy.projectionTimeoutMs);
      return { created: false };
    }
    if (envelopeAt(response.body, "collection-create")["result"] !== true) {
      throw invalidResponse("collection-create-result");
    }
    return { created: true };
  }

  async upsertMembers(input: {
    readonly collectionName: string;
    readonly policy: HybridRetrievalPolicyV1;
    readonly manifest: RetrievalIndexManifestV1;
    readonly texts: readonly { readonly pointId: string; readonly text: string }[];
    readonly denseVectors: readonly {
      readonly pointId: string;
      readonly vector: readonly number[];
    }[];
  }): Promise<void> {
    const policy = input.policy;
    if (input.manifest.members.length > policy.memberLimit) {
      throw new QdrantRetrievalProjectionError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        detailCode: "member-count",
      });
    }
    const textByPointId = new Map(input.texts.map((text) => [text.pointId, text.text]));
    const vectorByPointId = new Map(
      input.denseVectors.map((dense) => [dense.pointId, dense.vector]),
    );
    const points = input.manifest.members.map((member) => {
      const text = textByPointId.get(member.pointId);
      const dense = vectorByPointId.get(member.pointId);
      // 双索引要求每个成员同时具备正文投影与稠密表示；缺任一路都在这里封闭失败。
      if (text === undefined) {
        throw new QdrantRetrievalProjectionError({
          code: "DUAL_INDEX_MISMATCH",
          detailCode: "member-text-missing",
        });
      }
      if (dense === undefined) {
        throw new QdrantRetrievalProjectionError({
          code: "DUAL_INDEX_MISMATCH",
          detailCode: "member-dense-vector-missing",
        });
      }
      if (dense.length !== policy.dense.dimensions) {
        throw new QdrantRetrievalProjectionError({
          code: "EMBEDDING_DIMENSION_MISMATCH",
          detailCode: "dense-vector-dimensions",
        });
      }
      if (Buffer.byteLength(text, "utf8") > policy.memberByteLimit) {
        throw new QdrantRetrievalProjectionError({
          code: "RESOURCE_LIMIT_EXCEEDED",
          detailCode: "member-byte-limit",
        });
      }
      return {
        id: member.pointId,
        vector: {
          [policy.dense.vectorName]: [...dense],
          [policy.bm25.vectorName]: bm25InferenceBody(policy, text),
        },
        payload: payloadFor(input.manifest, member),
      };
    });

    for (let start = 0; start < points.length; start += policy.memberBatchLimit) {
      const response = await this.#send({
        method: "PUT",
        path: `${collectionPath(input.collectionName)}/points?wait=true`,
        body: { points: points.slice(start, start + policy.memberBatchLimit) },
        timeoutMs: policy.projectionTimeoutMs,
      });
      const operation = resultAt(response.body, "points-upsert");
      if (operation["status"] !== "completed") throw invalidResponse("points-upsert-status");
    }
  }

  async inspectGeneration(input: {
    readonly collectionName: string;
    readonly generationRef: RetrievalGenerationRefV1;
    readonly pageSize: number;
    readonly maxPoints: number;
  }): Promise<RetrievalProjectionObservationV1> {
    const { version } = await this.serviceVersion();
    const points: RetrievalProjectionPointV1[] = [];
    let complete = true;
    let offset: string | undefined;
    while (true) {
      const remaining = input.maxPoints - points.length;
      if (remaining <= 0) {
        // 到达调用方上限且仍有下一页：不得声称已核对完整代际。
        complete = false;
        break;
      }
      const response = await this.#send({
        method: "POST",
        path: `${collectionPath(input.collectionName)}/points/scroll`,
        body: {
          limit: Math.min(input.pageSize, remaining),
          with_payload: true,
          with_vector: [RETRIEVAL_DENSE_VECTOR_NAME_V1, RETRIEVAL_BM25_VECTOR_NAME_V1],
          ...(offset === undefined ? {} : { offset }),
        },
        timeoutMs: this.#requestTimeoutMs,
      });
      const result = resultAt(response.body, "points-scroll");
      for (const raw of arrayAt(result["points"], "points-scroll")) {
        points.push(this.#projectionPointAt(raw));
      }
      const next = result["next_page_offset"];
      if (next === null || next === undefined) break;
      if (typeof next !== "string" && typeof next !== "number") {
        throw invalidResponse("points-scroll-offset");
      }
      offset = pointIdAt(next, "points-scroll-offset");
    }
    return RetrievalProjectionObservationV1Schema.parse({
      collectionName: input.collectionName,
      generationRef: input.generationRef,
      serviceVersion: version,
      points,
      complete,
    });
  }

  async queryHybrid(input: RetrievalHybridQueryV1): Promise<RetrievalHybridQueryResultV1> {
    const policy = input.policy;
    const path = `${collectionPath(input.collectionName)}/points/query`;
    const filter = filterBody({
      projectId: input.filter.projectId,
      generationKey: input.filter.generationRef.reference.versionId,
      authorizationScopeDigest: input.filter.authorizationScopeDigest,
    });
    const denseRequest = {
      query: { nearest: [...input.queryDenseVector] },
      using: policy.dense.vectorName,
      limit: policy.densePrefetchLimit,
      // 过滤必须同时进入每个 prefetch：融合路径下顶层 filter 不约束各路候选，
      // 否则无权/跨代际点会占满召回窗口（design D6 候选收窄）。
      filter,
    };
    const bm25Request = {
      query: { nearest: bm25InferenceBody(policy, input.queryText) },
      using: policy.bm25.vectorName,
      limit: policy.bm25PrefetchLimit,
      filter,
    };

    // 耗时只覆盖服务端 RRF 请求本身；p95 门禁以该样本计量（design D11）。
    const started = performance.now();
    const fusedResponse = await this.#send({
      method: "POST",
      path,
      body: {
        prefetch: [denseRequest, bm25Request],
        query: {
          rrf: { k: policy.rrf.k, weights: [policy.rrf.denseWeight, policy.rrf.bm25Weight] },
        },
        limit: policy.topK,
        with_payload: true,
        filter,
      },
      timeoutMs: policy.projectionTimeoutMs,
    });
    const fusedQueryDurationMs = Math.max(0, performance.now() - started);

    const denseResponse = await this.#send({
      method: "POST",
      path,
      body: { ...denseRequest, with_payload: false },
      timeoutMs: policy.projectionTimeoutMs,
    });
    const bm25Response = await this.#send({
      method: "POST",
      path,
      body: { ...bm25Request, with_payload: false },
      timeoutMs: policy.projectionTimeoutMs,
    });

    const fused = queryPointsAt(fusedResponse.body, "fused-points").map((point, index) => {
      const record = recordAt(point, "fused-points");
      const payload = RetrievalPointPayloadV1Schema.safeParse(record["payload"]);
      if (!payload.success) throw invalidResponse("fused-payload");
      return {
        pointId: pointIdAt(record["id"], "fused-points"),
        rank: index + 1,
        score: finiteNumberAt(record["score"], "fused-points"),
        payload: payload.data,
      };
    });
    const denseRoute = routeHitsAt(denseResponse.body, "dense-route");
    const bm25Route = routeHitsAt(bm25Response.body, "bm25-route");

    // 融合命中必须能被至少一路名次解释；否则不返回部分结果（design D7）。
    const routedPointIds = new Set([
      ...denseRoute.map((hit) => hit.pointId),
      ...bm25Route.map((hit) => hit.pointId),
    ]);
    for (const hit of fused) {
      if (!routedPointIds.has(hit.pointId)) {
        throw new QdrantRetrievalProjectionError({
          code: "FUSION_RECONCILIATION_FAILED",
          detailCode: "fused-hit-missing-from-routes",
        });
      }
    }

    return RetrievalHybridQueryResultV1Schema.parse({
      collectionName: input.collectionName,
      generationRef: input.generationRef,
      serviceVersion: (await this.serviceVersion()).version,
      fused,
      denseRoute,
      bm25Route,
      fusedQueryDurationMs,
    });
  }

  async deleteGenerationCollection(input: {
    readonly collectionName: string;
    readonly generationRef: RetrievalGenerationRefV1;
  }): Promise<{ readonly deleted: boolean }> {
    // 只接受由代际身份确定性派生的名称，避免任何宽泛或跨代际删除。
    if (input.collectionName !== retrievalCollectionNameFor(input.generationRef)) {
      throw incompatible("collection-name-not-derived-from-generation");
    }
    const response = await this.#send({
      method: "DELETE",
      path: collectionPath(input.collectionName),
      timeoutMs: this.#requestTimeoutMs,
      acceptStatuses: [404],
    });
    if (response.status === 404) return { deleted: false };
    const result = envelopeAt(response.body, "collection-delete")["result"];
    if (typeof result !== "boolean") throw invalidResponse("collection-delete-result");
    return { deleted: result };
  }

  async listRetrievalCollections(input: {
    readonly namePrefix: string;
  }): Promise<readonly string[]> {
    const response = await this.#send({
      method: "GET",
      path: "/collections",
      timeoutMs: this.#requestTimeoutMs,
    });
    const collections = arrayAt(
      resultAt(response.body, "collections-list")["collections"],
      "collections-list",
    );
    return collections
      .map((entry) => stringAt(recordAt(entry, "collections-list")["name"], "collections-list"))
      .filter((name) => name.startsWith(input.namePrefix));
  }

  async #assertCollectionCompatible(
    path: string,
    policy: HybridRetrievalPolicyV1,
    timeoutMs: number,
  ): Promise<void> {
    const response = await this.#send({ method: "GET", path, timeoutMs });
    const params = recordAt(
      recordAt(resultAt(response.body, "collection-info")["config"], "collection-info")["params"],
      "collection-info",
    );
    const vectors = optionalRecordAt(params["vectors"]);
    const sparseVectors = optionalRecordAt(params["sparse_vectors"]);
    const dense = optionalRecordAt(vectors?.[policy.dense.vectorName]);
    if (dense === undefined) throw incompatible("dense-vector-missing");
    if (dense["size"] !== policy.dense.dimensions) throw incompatible("dense-dimensions-mismatch");
    if (dense["distance"] !== DISTANCE_BY_POLICY[policy.dense.distance]) {
      throw incompatible("dense-distance-mismatch");
    }
    const sparse = optionalRecordAt(sparseVectors?.[policy.bm25.vectorName]);
    if (sparse === undefined) throw incompatible("bm25-vector-missing");
    if (sparse["modifier"] !== "idf") throw incompatible("bm25-modifier-mismatch");
  }

  #projectionPointAt(raw: unknown): RetrievalProjectionPointV1 {
    const record = recordAt(raw, "projection-point");
    const vector = optionalRecordAt(record["vector"]);
    const dense = vector?.[RETRIEVAL_DENSE_VECTOR_NAME_V1];
    const denseVector = Array.isArray(dense) ? dense : undefined;
    const sparse = optionalRecordAt(vector?.[RETRIEVAL_BM25_VECTOR_NAME_V1]);
    const payload = record["payload"];
    let parsedPayload: RetrievalPointPayloadV1 | undefined;
    if (payload !== null && payload !== undefined) {
      const result = RetrievalPointPayloadV1Schema.safeParse(payload);
      if (!result.success) throw invalidResponse("projection-payload");
      parsedPayload = result.data;
    }
    return {
      pointId: pointIdAt(record["id"], "projection-point"),
      hasDenseVector: denseVector !== undefined,
      hasSparseVector: Array.isArray(sparse?.["indices"]) && Array.isArray(sparse["values"]),
      denseDimensions: denseVector?.length ?? 0,
      ...(parsedPayload === undefined ? {} : { payload: parsedPayload }),
    };
  }

  async #send(input: {
    readonly method: "GET" | "POST" | "PUT" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
    readonly timeoutMs: number;
    readonly acceptStatuses?: readonly number[];
  }): Promise<WireResponse> {
    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(`${this.#baseUrl}${input.path}`, {
        method: input.method,
        ...(input.body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) }),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new QdrantRetrievalProjectionError({
        code: "QDRANT_UNAVAILABLE",
        detailCode: timedOut ? "timeout" : "transport",
        retryable: true,
      });
    }

    const accepted =
      (response.status >= 200 && response.status < 300) ||
      (input.acceptStatuses ?? []).includes(response.status);
    let body: unknown;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        if (accepted) throw invalidResponse("invalid-json");
      }
    }
    if (!accepted) {
      throw new QdrantRetrievalProjectionError({
        code: "QDRANT_UNAVAILABLE",
        detailCode: `http-${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    if (text.length === 0) throw invalidResponse("empty-body");
    return { status: response.status, body };
  }
}
