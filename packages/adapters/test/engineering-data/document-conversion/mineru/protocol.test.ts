import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { DocumentServiceParserError } from "../../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { createMineruDocumentParser } from "../../../../src/engineering-data/document-conversion/mineru/index.js";
import { MineruConfigV1Schema } from "../../../../src/engineering-data/document-conversion/mineru/schema.js";
import { makeConfig, makeRequest, makeServiceHarness, middle, rawRef } from "./fixture.js";

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const legacyLayout = {
  _version_name: "3.4.4",
  _backend: "hybrid",
  pdf_info: [
    {
      page_idx: 0,
      page_size: [300, 200],
      para_blocks: [
        {
          type: "text",
          index: 0,
          bbox: [0, 0, 300, 200],
          lines: [{ spans: [{ type: "text", content: "legacy layout fixture" }] }],
        },
      ],
    },
  ],
};

const parserError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DocumentServiceParserError) return error;
    throw error;
  }
  throw new Error("expected parser rejection");
};

describe("MinerU transport protocols", () => {
  it("requires configured local credentials before accessing the service", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const error = await parserError(
      createMineruDocumentParser({
        config: makeConfig("self-hosted-v1", { credentialRef: "local-secret" }),
        fetch,
      }).parse(makeRequest()),
    );
    expect(error.code).toBe("MINERU_DEPLOYMENT_MISMATCH");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds concurrent conversions and releases capacity after cancellation", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      started();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const parser = createMineruDocumentParser({
      config: makeConfig("self-hosted-v1", { maxConcurrentRequests: 1 }),
      fetch,
    });
    const first = parserError(parser.parse(makeRequest({ signal: controller.signal })));
    await active;
    expect((await parserError(parser.parse(makeRequest()))).code).toBe("MINERU_CONCURRENCY_LIMIT");
    controller.abort();
    expect((await first).code).toBe("MINERU_ABORTED");
    const canceled = new AbortController();
    canceled.abort();
    expect((await parserError(parser.parse(makeRequest({ signal: canceled.signal })))).code).toBe(
      "MINERU_ABORTED",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(jsonResponse({}, 503));
    expect((await parserError(parser.parse(makeRequest()))).code).toBe(
      "MINERU_SERVICE_UNAVAILABLE",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["partial", "MINERU_TASK_PARTIAL"],
    ["running", "MINERU_POLL_BUDGET_EXHAUSTED"],
  ])("refuses local %s results within its poll budget", async (status, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (init?.method === "DELETE")
        return jsonResponse({ task_id: "bounded", status: "canceled" });
      if (String(input).includes("/v1/tasks?"))
        return jsonResponse({ task_id: "bounded", status: "queued" }, 202);
      return jsonResponse({ task_id: "bounded", status });
    });
    const error = await parserError(
      createMineruDocumentParser({
        config: makeConfig("self-hosted-v1", { maxPolls: 1 }),
        fetch,
      }).parse(makeRequest()),
    );
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(error.diagnostic).toMatchObject({ remoteCancellationConfirmed: true });
  });

  it("rejects response bytes exceeding the configured limit without parsing or persistence", async () => {
    const persistRawResponse = vi.fn(makeRequest().persistRawResponse);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array(20)));
    const error = await parserError(
      createMineruDocumentParser({
        config: makeConfig("self-hosted-v1", { maxResponseBytes: 10 }),
        fetch,
      }).parse(makeRequest({ persistRawResponse })),
    );
    expect(error.code).toBe("MINERU_RESPONSE_LIMIT_EXCEEDED");
    expect(persistRawResponse).not.toHaveBeenCalled();
  });

  it("cancels only the active task when its caller aborts during polling", async () => {
    const controller = new AbortController();
    const canceled: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        canceled.push(url);
        return jsonResponse({ task_id: "active-task", status: "canceled" });
      }
      if (url.includes("/v1/tasks?"))
        return jsonResponse({ task_id: "active-task", status: "queued" }, 202);
      controller.abort();
      throw new Error("aborted");
    });
    const error = await parserError(
      createMineruDocumentParser({ config: makeConfig("self-hosted-v1"), fetch }).parse(
        makeRequest({ signal: controller.signal }),
      ),
    );
    expect(error.code).toBe("MINERU_ABORTED");
    expect(canceled).toEqual(["http://127.0.0.1:8000/v1/tasks/active-task"]);
    expect(error.diagnostic).toMatchObject({ remoteCancellationConfirmed: true });
  });

  it.each([
    "symbol.png",
    "missing.png",
    "https://example.invalid/symbol.png",
    "../symbol.png",
    "ambiguous.png",
    "broken.png",
  ])(
    "consumes durable official ZIP table images and rejects unsafe references: %s",
    async (imageSrc) => {
      const imageBytes = new Uint8Array(
        readFileSync(new URL("../ocr/fixtures/synthetic-scanned.png", import.meta.url)),
      );
      const value = structuredClone(legacyLayout) as { pdf_info: { para_blocks: unknown[] }[] };
      value.pdf_info[0]!.para_blocks.push({
        type: "table",
        index: 1,
        bbox: [0, 0, 300, 200],
        blocks: [
          {
            type: "table_body",
            index: 0,
            bbox: [0, 0, 300, 200],
            lines: [
              {
                spans: [
                  {
                    type: "table",
                    html: `<table><tr><td>原文<img src="${imageSrc}"/></td></tr></table>`,
                  },
                ],
              },
            ],
          },
        ],
      });
      const zip = zipSync({
        "layout.json": strToU8(JSON.stringify(value)),
        "images/symbol.png": imageBytes,
        "a/ambiguous.png": imageBytes,
        "b/ambiguous.png": imageBytes,
        "images/broken.png": strToU8("not an image"),
      });
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/api/v4/file-urls/batch")) {
          return jsonResponse({
            code: 0,
            data: {
              batch_id: "batch-1",
              file_urls: ["https://mineru.oss-cn-shanghai.aliyuncs.com/signed"],
            },
          });
        }
        if (url === "https://mineru.oss-cn-shanghai.aliyuncs.com/signed")
          return new Response(null, { status: 200 });
        if (url.endsWith("/api/v4/extract-results/batch/batch-1")) {
          return jsonResponse({
            code: 0,
            data: {
              batch_id: "batch-1",
              extract_result: [
                {
                  data_id: "conversion_1",
                  file_name: "conversion_1.pdf",
                  state: "done",
                  full_zip_url: "https://cdn-mineru.openxlab.org.cn/result.zip",
                },
              ],
            },
          });
        }
        return new Response(zip, { status: 200 });
      });
      const persisted: Uint8Array[] = [];
      const request = makeRequest({
        persistRawResponse: async ({ bytes }) => {
          persisted.push(new Uint8Array(bytes));
          return { artifactRef: rawRef(`raw-${persisted.length}`), bytes: new Uint8Array(bytes) };
        },
      });
      const operation = createMineruDocumentParser({
        config: makeConfig("official-v4"),
        credentials: { "mineru-token": "test-token" },
        fetch,
      }).parse(request);
      if (imageSrc !== "symbol.png") {
        expect(await parserError(operation)).toMatchObject({ retryable: false });
        return;
      }
      const result = await operation;
      expect(result.parsedDocument.blocks.find((block) => block.kind === "cell")).toMatchObject({
        text: "原文",
        unrecognizedImages: [
          {
            kind: "unrecognized-image",
            rawResponseArtifactRef: rawRef("raw-3"),
            packageEntryPath: "images/symbol.png",
          },
        ],
      });

      expect(
        result.parsedDocument.blocks.some((block) => block.text.includes("legacy layout fixture")),
      ).toBe(true);
      expect(result.additionalParentArtifactRefs).toHaveLength(3);
      expect(persisted).toHaveLength(3);
      const upload = calls.find((call) => call.init?.method === "PUT");
      expect(upload?.init?.headers).toBeUndefined();
      expect(upload?.init?.body).toBeInstanceOf(Uint8Array);
      expect(
        (upload?.init?.headers as Record<string, string> | undefined)?.authorization,
      ).toBeUndefined();
    },
  );

  it("submits local V1 bytes and accepts queued while polling for completed Middle 2.0", async () => {
    const statuses = ["queued", "completed"];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/tasks?")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(Uint8Array);
        expect(new Headers(init?.headers).get("content-type")).toBe("application/octet-stream");
        expect(new Headers(init?.headers).get("content-length")).toBe(
          String((init?.body as Uint8Array).byteLength),
        );
        return jsonResponse({ task_id: "task-1", status: "queued" }, 202);
      }
      if (url.endsWith("/v1/tasks/task-1"))
        return jsonResponse({ task_id: "task-1", status: statuses.shift() });
      return jsonResponse({
        task_id: "task-1",
        status: "completed",
        files: [{ status: "completed", content: { middle_json: middle } }],
      });
    });
    const outcome = await createMineruDocumentParser({
      config: makeConfig("self-hosted-v1"),
      fetch,
    }).parse(makeRequest());
    expect(
      outcome.parsedDocument.blocks.some((block) => block.text.includes("transport fixture")),
    ).toBe(true);
  });

  it("refuses insecure official signed transfer URLs before sending them", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({
        code: 0,
        data: {
          batch_id: "batch-1",
          file_urls: ["http://mineru.oss-cn-shanghai.aliyuncs.com/signed"],
        },
      }),
    );
    const error = await parserError(
      createMineruDocumentParser({
        config: makeConfig("official-v4"),
        credentials: { "mineru-token": "test-token" },
        fetch,
      }).parse(makeRequest()),
    );
    expect(error.code).toBe("MINERU_TRANSFER_ORIGIN_REJECTED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps a missing local task to taskLost and durably confirms cancellation", async () => {
    const persistedStages: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/tasks?"))
        return jsonResponse({ task_id: "task-gone", status: "queued" }, 202);
      if (init?.method === "DELETE")
        return jsonResponse({ task_id: "task-gone", status: "canceled" });
      return jsonResponse({ detail: "missing" }, 404);
    });
    const error = await parserError(
      createMineruDocumentParser({ config: makeConfig("self-hosted-v1"), fetch }).parse(
        makeRequest({
          persistRawResponse: async ({ bytes, trace }) => {
            persistedStages.push(String((trace as { stage?: string }).stage));
            const id = `raw-${persistedStages.length}`;
            return { artifactRef: rawRef(id), bytes: new Uint8Array(bytes) };
          },
        }),
      ),
    );
    expect(error.code).toBe("MINERU_TASK_LOST");
    expect(error.parents).toHaveLength(3);
    expect(error.diagnostic).toMatchObject({
      remoteCancellationAttempted: true,
      remoteCancellationConfirmed: true,
    });
    expect(persistedStages).toEqual([
      "self-hosted.task.create",
      "self-hosted.task.poll",
      "self-hosted.task.cancel",
    ]);
  });

  it("retains already durable response parents when normalization rejects Middle", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/tasks?"))
        return jsonResponse({ task_id: "task-1", status: "queued" }, 202);
      if (url.endsWith("/v1/tasks/task-1"))
        return jsonResponse({ task_id: "task-1", status: "completed" });
      return jsonResponse({
        task_id: "task-1",
        status: "completed",
        files: [{ status: "completed", content: { middle_json: {} } }],
      });
    });
    const error = await parserError(
      createMineruDocumentParser({ config: makeConfig("self-hosted-v1"), fetch }).parse(
        makeRequest(),
      ),
    );
    expect(error.code).toBe("MINERU_MIDDLE_INVALID");
    expect(error.parents.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects non-private HTTP endpoints and does not mistake hostnames beginning fc/fd for IPv6", () => {
    expect(() =>
      MineruConfigV1Schema.parse(
        makeConfig("self-hosted-v1", { endpoint: "http://fc-service.example" }),
      ),
    ).toThrow();
    expect(() =>
      MineruConfigV1Schema.parse(
        makeConfig("self-hosted-v1", { endpoint: "http://fd-cache.example" }),
      ),
    ).toThrow();
    expect(() =>
      MineruConfigV1Schema.parse(
        makeConfig("self-hosted-v1", {
          endpoint: "http://[fc00::1]:8000",
          allowedTransferOrigins: ["http://[fc00::1]:8000"],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      MineruConfigV1Schema.parse(
        makeConfig("self-hosted-v1", {
          endpoint: "http://[::]:8000",
          allowedTransferOrigins: ["http://[::]:8000"],
        }),
      ),
    ).toThrow();
    expect(() =>
      MineruConfigV1Schema.parse(
        makeConfig("official-v4", {
          allowedTransferOrigins: ["https://mineru.net", "https://unapproved.example"],
        }),
      ),
    ).toThrow();
  });

  it("durably records a rate-limited response before returning the retryable contract error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ detail: "too many requests" }, 429),
    );
    const error = await parserError(
      createMineruDocumentParser({ config: makeConfig("self-hosted-v1"), fetch }).parse(
        makeRequest(),
      ),
    );
    expect(error.code).toBe("MINERU_RATE_LIMITED");
    expect(error.retryable).toBe(true);
    expect(error.parents).toHaveLength(1);
  });

  it("fails the request when response-body streaming exceeds the per-request timeout", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/v1/tasks?"))
        return jsonResponse({ task_id: "task-slow", status: "queued" }, 202);
      if (url.endsWith("/v1/tasks/task-slow") && init?.method === "DELETE")
        return jsonResponse({ task_id: "task-slow", status: "canceled" });
      if (url.endsWith("/v1/tasks/task-slow")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new Error("request aborted")),
              { once: true },
            );
          },
        });
        return new Response(body, { status: 200 });
      }
      throw new Error("unexpected transport request");
    });
    const error = await parserError(
      createMineruDocumentParser({
        config: makeConfig("self-hosted-v1", { requestTimeoutMs: 15 }),
        fetch,
      }).parse(makeRequest()),
    );
    expect(error.code).toBe("MINERU_TIMEOUT");
    expect(error.diagnostic).toMatchObject({
      remoteCancellationAttempted: true,
      remoteCancellationConfirmed: true,
    });
  });

  it("preserves durable parents when the raw-response store fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ task_id: "task-1", status: "queued" }, 202),
    );
    const request = makeRequest({
      persistRawResponse: async () => {
        throw new Error("storage unavailable");
      },
    });
    const error = await parserError(
      createMineruDocumentParser({ config: makeConfig("self-hosted-v1"), fetch }).parse(request),
    );
    expect(error.code).toBe("MINERU_ARTIFACT_PERSISTENCE_FAILED");
    expect(error.parents).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps C11 authorization denial non-enumerable before C04 or service access", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const harness = makeServiceHarness({ fetch, denySource: true });
    const result = await harness.adapter.convert(harness.command);
    expect(result).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED", retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.opens).toHaveLength(0);
    expect(harness.puts).toHaveLength(0);
    expect(harness.registered).toHaveLength(0);
  });

  it("does not register C11 segments or publish conversion artifacts when C04 raw readback fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ task_id: "task-1", status: "queued" }, 202),
    );
    const harness = makeServiceHarness({ fetch, failRawReadback: true });
    const result = await harness.adapter.convert(harness.command);
    expect(result).toMatchObject({ kind: "failed" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(harness.events).toContain("put:document-service-raw-response-conversion_1-attempt-1");
    expect(harness.events).toContain("open:document-service-raw-response-conversion_1-attempt-1");
    expect(harness.puts.some((command) => command.artifactId === "conversion-conversion_1")).toBe(
      false,
    );
    expect(harness.registered).toHaveLength(0);
  });

  it("replays an idempotent service conversion without another transport call or C11 registration", async () => {
    const statuses = ["queued", "completed"];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/tasks?"))
        return jsonResponse({ task_id: "task-service", status: "queued" }, 202);
      if (url.endsWith("/v1/tasks/task-service"))
        return jsonResponse({ task_id: "task-service", status: statuses.shift() });
      return jsonResponse({
        task_id: "task-service",
        status: "completed",
        files: [{ status: "completed", content: { middle_json: middle } }],
      });
    });
    const harness = makeServiceHarness({ fetch });
    const first = await harness.adapter.convert(harness.command);
    const putsAfterFirst = harness.puts.length;
    const second = await harness.adapter.convert(harness.command);
    expect(first.kind).toBe("succeeded");
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(harness.puts).toHaveLength(putsAfterFirst);
    expect(harness.registered).toHaveLength(1);
  });

  // V-01：parser 返回后的收尾必须继续受调用取消与截止时间约束，且不得登记 C11 段集合。
  const interruptions = [
    ["cancel", "MINERU_ABORTED", false],
    ["deadline", "MINERU_TIMEOUT", true],
  ] as const;
  const durableArtifactJson = (
    harness: ReturnType<typeof makeServiceHarness>,
    artifactId: string,
  ): Record<string, unknown> | undefined => {
    const stored = [...harness.artifacts.values()].find(
      (entry) => entry.manifest.artifactRef.reference.entityId === artifactId,
    );
    return stored === undefined
      ? undefined
      : (JSON.parse(new TextDecoder().decode(stored.bytes)) as Record<string, unknown>);
  };

  it.each(
    (
      [
        [
          "normalization-diagnostic",
          "document-service-normalization-diagnostic-conversion_1",
          false,
        ],
        ["json-ld", "conversion-conversion_1", true],
      ] as const
    ).flatMap(([boundary, artifactId, jsonLdDurable]) =>
      interruptions.map(([mode, code, retryable]) => [
        mode,
        boundary,
        artifactId,
        jsonLdDurable,
        code,
        retryable,
      ]),
    ),
  )(
    "refuses C11 segment registration when %s interrupts finalization after the %s artifact",
    async (mode, _boundary, triggerArtifactId, jsonLdDurable, code, retryable) => {
      const controller = new AbortController();
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.includes("/v1/tasks?"))
          return jsonResponse({ task_id: "finalization", status: "queued" }, 202);
        if (url.endsWith("/v1/tasks/finalization"))
          return jsonResponse({ task_id: "finalization", status: "completed" });
        return jsonResponse({
          task_id: "finalization",
          status: "completed",
          files: [{ status: "completed", content: { middle_json: middle } }],
        });
      });
      const harness = makeServiceHarness({ fetch });
      const put = harness.artifactStore.put.bind(harness.artifactStore);
      harness.artifactStore.put = async (putCommand, stream) => {
        const result = await put(putCommand, stream);
        if (putCommand.artifactId === triggerArtifactId) {
          if (mode === "cancel") controller.abort();
          else vi.spyOn(Date, "now").mockReturnValue(Date.parse(harness.command.deadlineAt) + 1);
        }
        return result;
      };
      try {
        const result = await harness.adapter.convert(harness.command, {
          signal: controller.signal,
        });

        expect(result.kind).toBe("failed");
        expect(harness.registered).toHaveLength(0);
        // 已经耐久的工件保留，未到达的收尾步骤不得补写。
        expect(harness.puts.some((putCommand) => putCommand.artifactId === triggerArtifactId)).toBe(
          true,
        );
        expect(
          harness.puts.some((putCommand) => putCommand.artifactId === "conversion-conversion_1"),
        ).toBe(jsonLdDurable);
        expect(durableArtifactJson(harness, "conversion-diagnostic-conversion_1")).toMatchObject({
          reasonCode: code,
          retryable,
        });
        const diagnosticPut = harness.puts.find(
          (putCommand) => putCommand.artifactId === "conversion-diagnostic-conversion_1",
        );
        expect(
          diagnosticPut?.parentArtifactRefs.some((parent) =>
            parent.reference.entityId.startsWith("document-service-raw-response-conversion_1"),
          ),
        ).toBe(true);

        const callsAfterFailure = fetch.mock.calls.length;
        const putsAfterFailure = harness.puts.length;
        const replay = await harness.adapter.convert(harness.command, {
          signal: controller.signal,
        });
        expect(replay.kind).toBe("failed");
        expect(fetch).toHaveBeenCalledTimes(callsAfterFailure);
        expect(harness.puts).toHaveLength(putsAfterFailure);
        expect(harness.registered).toHaveLength(0);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );
});
