import { ArtifactRefV1Schema, type ArtifactRefV1 } from "@riskflow/core/artifacts";
import type { JsonValue } from "@riskflow/core/persistence";

import {
  DocumentServiceParserError,
  type DocumentServiceParserOutcomeV1,
  type DocumentServiceParserRequestV1,
} from "../structured-document-converter.js";
import { readDocumentPackage } from "../parsers.js";
import { preflightMineruSource } from "./source.js";
import { normalizeMineruMiddle } from "./normalization.js";
import { normalizeOfficialMineruLayout } from "./official-normalization.js";
import {
  MINERU_ERROR_CODES_V1,
  MINERU_OFFICIAL_TRANSFER_ORIGINS,
  MineruConfigV1Schema,
  type MineruConfigV1,
} from "./schema.js";

type FailureKey = keyof typeof MINERU_ERROR_CODES_V1;
type ResponseBudget = {
  consumed: number;
  sequence: number;
  pollCount: number;
  remoteIdentity?: string;
};
type DurableResponse = { response: Response; bytes: Uint8Array; artifactRef: ArtifactRefV1 };
type RequestControl = {
  readonly signal: AbortSignal;
  readonly abortKind: () => "caller" | "deadline" | undefined;
};

const failure = (key: FailureKey, diagnostic?: unknown): DocumentServiceParserError => {
  const definition = MINERU_ERROR_CODES_V1[key];
  return new DocumentServiceParserError({
    ...definition,
    ...(diagnostic === undefined ? {} : { diagnostic: json(diagnostic) }),
  });
};

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const sameRef = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
) => left.entityId === right.entityId && left.versionId === right.versionId;

const sourceFormat = (
  request: DocumentServiceParserRequestV1,
): { extension: string; scanned: boolean } => {
  const { kind } = request.command.input;
  const media = request.command.mediaType;
  if (
    kind === "docx" &&
    media === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return { extension: "docx", scanned: false };
  }
  if (kind === "text-pdf" && media === "application/pdf")
    return { extension: "pdf", scanned: false };
  if (kind === "ocr-layout" && media === "application/pdf")
    return { extension: "pdf", scanned: true };
  if (kind === "ocr-layout" && media === "image/png") return { extension: "png", scanned: true };
  if (kind === "ocr-layout" && media === "image/jpeg") return { extension: "jpg", scanned: true };
  throw failure("mediaTypeUnsupported");
};

const boundedBytes = async (response: Response, remaining: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > remaining) {
    await response.body?.cancel().catch(() => undefined);
    throw failure("responseLimitExceeded", { declaredBytes: declared });
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > remaining) {
        await reader.cancel().catch(() => undefined);
        throw failure("responseLimitExceeded", { responseBytes: size });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw failure("protocolInvalid");
  }
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const approvedUrl = (value: string, config: MineruConfigV1): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw failure("transferOriginRejected");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !config.allowedTransferOrigins.some((origin) => new URL(origin).origin === url.origin) ||
    (config.protocol === "official-v4" &&
      (url.protocol !== "https:" ||
        !MINERU_OFFICIAL_TRANSFER_ORIGINS.includes(
          url.origin as (typeof MINERU_OFFICIAL_TRANSFER_ORIGINS)[number],
        )))
  ) {
    throw failure("transferOriginRejected");
  }
  return url;
};

class RequestSlots {
  #active = 0;
  constructor(readonly limit: number) {}
  acquire(): (() => void) | undefined {
    if (this.#active >= this.limit) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}

export interface CreateMineruDocumentParserOptionsV1 {
  readonly config: unknown;
  readonly credentials?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

export const createMineruDocumentParser = (
  options: CreateMineruDocumentParserOptionsV1,
): { parse(request: DocumentServiceParserRequestV1): Promise<DocumentServiceParserOutcomeV1> } => {
  const config = MineruConfigV1Schema.parse(options.config);
  const fetchImpl = options.fetch ?? fetch;
  const slots = new RequestSlots(config.maxConcurrentRequests);
  const token =
    config.credentialRef === null ? undefined : options.credentials?.[config.credentialRef];

  const parse = async (
    request: DocumentServiceParserRequestV1,
  ): Promise<DocumentServiceParserOutcomeV1> => {
    const { command } = request;
    const startedAt = new Date().toISOString();
    const state: ResponseBudget & { taskId?: string } = { consumed: 0, sequence: 0, pollCount: 0 };
    const isOfficial = config.protocol === "official-v4";
    let remoteCancellationAttempted = false;
    if (
      !sameRef(command.converterDeploymentRef, config.deploymentRef) ||
      !sameRef(command.qualityPolicyRef, config.qualityPolicyRef)
    ) {
      throw failure("deploymentMismatch");
    }
    if (config.credentialRef !== null && (token === undefined || token.trim() === "")) {
      throw failure("deploymentMismatch", { credential: "missing" });
    }
    const file = sourceFormat(request);
    const inputLimit = request.resourcePolicy.maxInputBytes;
    if (request.bytes.byteLength === 0 || request.bytes.byteLength > inputLimit) {
      throw failure("inputInvalid", {
        inputBytes: request.bytes.byteLength,
        maxInputBytes: inputLimit,
      });
    }
    if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(command.conversionId)) throw failure("inputInvalid");
    const deadline = Date.parse(command.deadlineAt);
    const remainingMs = deadline - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw failure("timeout");
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), remainingMs);
    const signals = [deadlineController.signal];
    if (request.signal !== undefined) signals.push(request.signal);
    const control: RequestControl = {
      signal: AbortSignal.any(signals),
      abortKind: () =>
        request.signal?.aborted
          ? "caller"
          : deadlineController.signal.aborted
            ? "deadline"
            : undefined,
    };
    let release: (() => void) | undefined;
    const parents: ArtifactRefV1[] = [];
    try {
      if (control.signal.aborted) throw controlFailure(control);
      const sourceInfo = await preflightMineruSource(request);
      if (
        sourceInfo.pageCount !== undefined &&
        sourceInfo.pageCount > request.resourcePolicy.maxPdfPages
      ) {
        throw failure("inputInvalid", { pageCount: sourceInfo.pageCount });
      }
      if (control.signal.aborted) throw controlFailure(control);
      release = slots.acquire();
      if (release === undefined) throw failure("concurrencyLimit");

      const requestHeaders = (jsonBody: boolean): HeadersInit => ({
        ...(jsonBody ? { "content-type": "application/json" } : {}),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      });
      const durableRequest = async (
        urlValue: string,
        init: Omit<RequestInit, "signal" | "redirect">,
        stage: string,
      ): Promise<DurableResponse> => {
        const url = approvedUrl(urlValue, config);
        const requestController = new AbortController();
        const requestTimer = setTimeout(() => requestController.abort(), config.requestTimeoutMs);
        const signal = AbortSignal.any([control.signal, requestController.signal]);
        let response: Response;
        let bytes: Uint8Array;
        const remainingBytes = config.maxResponseBytes - state.consumed;
        try {
          response = await fetchImpl(url, { ...init, redirect: "error", signal });
          bytes = await boundedBytes(response, remainingBytes);
        } catch (error) {
          if (control.abortKind() === "caller") throw failure("aborted");
          if (control.abortKind() === "deadline" || requestController.signal.aborted)
            throw failure("timeout");
          if (error instanceof DocumentServiceParserError) throw error;
          throw failure("unavailable", { stage });
        } finally {
          clearTimeout(requestTimer);
        }
        if (control.signal.aborted) throw controlFailure(control);
        state.consumed += bytes.byteLength;
        const attempt = ++state.sequence;
        let persisted: Awaited<ReturnType<DocumentServiceParserRequestV1["persistRawResponse"]>>;
        try {
          persisted = await request.persistRawResponse({
            attempt,
            httpStatus: response.status,
            maxBytes: remainingBytes,
            bytes,
            trace: json({
              protocol: config.protocol,
              stage,
              httpStatus: response.status,
              responseBytes: bytes.byteLength,
            }),
          });
        } catch {
          if (control.signal.aborted) throw controlFailure(control);
          throw failure("artifactPersistenceFailed", { stage, attempt });
        }
        let artifactRef: ArtifactRefV1;
        try {
          artifactRef = ArtifactRefV1Schema.parse(persisted.artifactRef);
        } catch {
          throw failure("artifactPersistenceFailed", { stage, attempt });
        }
        if (
          !(persisted.bytes instanceof Uint8Array) ||
          persisted.bytes.byteLength !== bytes.byteLength ||
          persisted.bytes.byteLength > remainingBytes
        ) {
          throw failure("artifactPersistenceFailed", { stage, attempt });
        }
        parents.push(artifactRef);
        if (control.signal.aborted) throw controlFailure(control);
        if (
          config.protocol === "self-hosted-v1" &&
          response.status === 404 &&
          (stage === "self-hosted.task.poll" || stage === "self-hosted.task.result")
        ) {
          throw failure("taskLost", { stage, attempt });
        }
        if (response.status === 429) throw failure("rateLimited", { stage, attempt });
        if (response.status >= 500)
          throw failure("unavailable", { stage, attempt, httpStatus: response.status });
        if (!response.ok)
          throw failure("httpFailure", { stage, attempt, httpStatus: response.status });
        return { response, bytes: persisted.bytes, artifactRef };
      };
      const jsonRequest = async (
        url: string,
        init: Omit<RequestInit, "signal" | "redirect">,
        stage: string,
      ): Promise<{ value: Record<string, unknown>; artifactRef: ArtifactRefV1 }> => {
        const durable = await durableRequest(url, init, stage);
        const value = record(parseJson(durable.bytes));
        if (value === undefined) throw failure("protocolInvalid", { stage });
        return { value, artifactRef: durable.artifactRef };
      };
      const pause = async (): Promise<void> => {
        if (control.signal.aborted) throw controlFailure(control);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(done, config.pollIntervalMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(controlFailure(control));
          };
          function done() {
            control.signal.removeEventListener("abort", onAbort);
            resolve();
          }
          control.signal.addEventListener("abort", onAbort, { once: true });
          if (control.signal.aborted) onAbort();
        });
      };

      let middle: unknown;
      let taskIdentity: string;
      if (isOfficial) {
        const base = new URL(config.endpoint);
        const fileName = `${command.conversionId}.${file.extension}`;
        const created = await jsonRequest(
          new URL("/api/v4/file-urls/batch", base).toString(),
          {
            method: "POST",
            headers: requestHeaders(true),
            body: JSON.stringify({
              files: [{ name: fileName, data_id: command.conversionId, is_ocr: file.scanned }],
              model_version: "vlm",
              enable_table: true,
              enable_formula: true,
              language: "ch",
            }),
          },
          "official.batch.create",
        );
        const createdData = record(created.value.data);
        const uploadUrls = createdData?.file_urls;
        if (
          created.value.code !== 0 ||
          typeof createdData?.batch_id !== "string" ||
          createdData.batch_id.length === 0 ||
          !Array.isArray(uploadUrls) ||
          uploadUrls.length !== 1 ||
          typeof uploadUrls[0] !== "string"
        ) {
          throw failure("protocolInvalid", { stage: "official.batch.create" });
        }
        taskIdentity = createdData.batch_id;
        state.remoteIdentity = taskIdentity;
        const uploadUrl = approvedUrl(uploadUrls[0], config);
        const uploadController = new AbortController();
        const uploadRequestTimer = setTimeout(
          () => uploadController.abort(),
          config.requestTimeoutMs,
        );
        let uploadResponse: Response;
        try {
          uploadResponse = await fetchImpl(uploadUrl, {
            method: "PUT",
            body: new Uint8Array(request.bytes),
            redirect: "error",
            signal: AbortSignal.any([control.signal, uploadController.signal]),
          });
        } catch {
          if (control.abortKind() === "caller") throw failure("aborted");
          if (control.abortKind() === "deadline" || uploadController.signal.aborted)
            throw failure("timeout");
          throw failure("unavailable", { stage: "official.upload" });
        } finally {
          clearTimeout(uploadRequestTimer);
        }
        await uploadResponse.body?.cancel().catch(() => undefined);
        if (uploadResponse.status === 429)
          throw failure("rateLimited", { stage: "official.upload" });
        if (uploadResponse.status >= 500)
          throw failure("unavailable", {
            stage: "official.upload",
            httpStatus: uploadResponse.status,
          });
        if (!uploadResponse.ok)
          throw failure("httpFailure", {
            stage: "official.upload",
            httpStatus: uploadResponse.status,
          });

        let zipUrl: string | undefined;
        for (let poll = 0; poll < config.maxPolls; poll += 1) {
          if (poll > 0) await pause();
          state.pollCount += 1;
          const polled = await jsonRequest(
            new URL(
              `/api/v4/extract-results/batch/${encodeURIComponent(taskIdentity)}`,
              base,
            ).toString(),
            { method: "GET", headers: requestHeaders(false) },
            "official.batch.poll",
          );
          const data = record(polled.value.data);
          const results = data?.extract_result;
          if (
            polled.value.code !== 0 ||
            data?.batch_id !== taskIdentity ||
            !Array.isArray(results) ||
            results.length !== 1
          ) {
            throw failure("protocolInvalid", { stage: "official.batch.poll" });
          }
          const result = record(results[0]);
          if (result?.data_id !== command.conversionId || result.file_name !== fileName) {
            throw failure("protocolInvalid", { stage: "official.batch.identity" });
          }
          if (result.state === "failed")
            throw failure("taskFailed", { stage: "official.batch.poll" });
          if (["waiting-file", "pending", "running", "converting"].includes(String(result.state)))
            continue;
          if (result.state !== "done" || typeof result.full_zip_url !== "string") {
            throw failure("protocolInvalid", { stage: "official.batch.poll" });
          }
          zipUrl = result.full_zip_url;
          break;
        }
        if (zipUrl === undefined)
          throw failure("pollBudgetExhausted", { stage: "official.batch.poll" });
        const zip = await durableRequest(zipUrl, { method: "GET" }, "official.result.zip");
        const entries = readDocumentPackage(zip.bytes, request.resourcePolicy, "");
        if (
          entries["layout.json"] === undefined ||
          Object.keys(entries).filter((name) => name === "layout.json").length !== 1
        ) {
          throw failure("protocolInvalid", { stage: "official.result.zip-layout" });
        }
        middle = parseJson(entries["layout.json"]!);
      } else {
        const base = new URL(config.endpoint);
        const fileName = `${command.conversionId}.${file.extension}`;
        const submitUrl = new URL("/v1/tasks", base);
        submitUrl.searchParams.set("filename", fileName);
        submitUrl.searchParams.set("tier", file.extension === "docx" ? "flash" : "standard");
        submitUrl.searchParams.set("ocr_mode", file.scanned ? "ocr" : "auto");
        submitUrl.searchParams.set("output_formats", "middle_json");
        const created = await jsonRequest(
          submitUrl.toString(),
          {
            method: "POST",
            headers: {
              ...requestHeaders(false),
              "content-type": "application/octet-stream",
              "content-length": String(request.bytes.byteLength),
            },
            body: new Uint8Array(request.bytes),
          },
          "self-hosted.task.create",
        );
        const taskId = created.value.task_id;
        if (typeof taskId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/u.test(taskId)) {
          throw failure("protocolInvalid", { stage: "self-hosted.task.create" });
        }
        state.taskId = taskId;
        state.remoteIdentity = taskId;
        taskIdentity = taskId;
        let completed = false;
        for (let poll = 0; poll < config.maxPolls; poll += 1) {
          if (poll > 0) await pause();
          state.pollCount += 1;
          const polled = await jsonRequest(
            new URL(`/v1/tasks/${encodeURIComponent(taskId)}`, base).toString(),
            { method: "GET", headers: requestHeaders(false) },
            "self-hosted.task.poll",
          );
          if (polled.value.task_id !== taskId)
            throw failure("taskLost", { stage: "self-hosted.task.identity" });
          if (polled.value.status === "completed") {
            completed = true;
            break;
          }
          if (polled.value.status === "partial")
            throw failure("taskPartial", { stage: "self-hosted.task.poll" });
          if (polled.value.status === "failed" || polled.value.status === "canceled") {
            throw failure("taskFailed", { stage: "self-hosted.task.poll" });
          }
          if (polled.value.status !== "queued" && polled.value.status !== "running") {
            throw failure("protocolInvalid", { stage: "self-hosted.task.poll" });
          }
        }
        if (!completed) throw failure("pollBudgetExhausted", { stage: "self-hosted.task.poll" });
        const result = await jsonRequest(
          new URL(
            `/v1/tasks/${encodeURIComponent(taskId)}/result?response_format=json`,
            base,
          ).toString(),
          { method: "GET", headers: requestHeaders(false) },
          "self-hosted.task.result",
        );
        if (result.value.task_id !== taskId || result.value.status !== "completed") {
          throw failure("taskLost", { stage: "self-hosted.task.result" });
        }
        const files = result.value.files;
        if (!Array.isArray(files) || files.length !== 1)
          throw failure("taskPartial", { stage: "self-hosted.task.result" });
        const resultFile = record(files[0]);
        const content = record(resultFile?.content);
        if (resultFile?.status !== "completed")
          throw failure("taskPartial", { stage: "self-hosted.task.result" });
        if (content?.middle_json === undefined)
          throw failure("protocolInvalid", { stage: "self-hosted.task.middle-json" });
        middle = content.middle_json;
      }

      if (control.signal.aborted) throw controlFailure(control);
      const normalized = isOfficial
        ? normalizeOfficialMineruLayout(middle, request, config, sourceInfo)
        : normalizeMineruMiddle(middle, request, config, sourceInfo);
      if (control.signal.aborted) throw controlFailure(control);
      return {
        parsedDocument: normalized.parsedDocument,
        additionalParentArtifactRefs: parents,
        additionalEvidenceReferences: [],
        diagnostic: json({
          schemaVersion: "1",
          protocol: config.protocol,
          deploymentRef: config.deploymentRef,
          resourceAllocationRef: config.resourceAllocationRef,
          converterVersion: isOfficial ? null : "4.0.12",
          taskIdentity,
          inputBytes: request.bytes.byteLength,
          responseBytes: state.consumed,
          pollCount: state.pollCount,
          startedAt,
          finishedAt: new Date().toISOString(),
          remoteCancellationConfirmed: false,
          normalization: normalized.diagnostic,
        }),
      };
    } catch (error) {
      let diagnostic = error instanceof DocumentServiceParserError ? error.diagnostic : undefined;
      if (!isOfficial && state.taskId !== undefined) {
        remoteCancellationAttempted = true;
        let confirmed: boolean;
        try {
          const cancelUrl = new URL(
            `/v1/tasks/${encodeURIComponent(state.taskId)}`,
            config.endpoint,
          ).toString();
          const url = approvedUrl(cancelUrl, config);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2_000);
          try {
            const response = await fetchImpl(url, {
              method: "DELETE",
              headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
              redirect: "error",
              signal: controller.signal,
            });
            const bytes = await boundedBytes(response, config.maxResponseBytes - state.consumed);
            const attempt = ++state.sequence;
            const persisted = await request.persistRawResponse({
              attempt,
              httpStatus: response.status,
              maxBytes: config.maxResponseBytes - state.consumed,
              bytes,
              trace: json({
                protocol: config.protocol,
                stage: "self-hosted.task.cancel",
                httpStatus: response.status,
                responseBytes: bytes.byteLength,
              }),
            });
            const artifactRef = ArtifactRefV1Schema.parse(persisted.artifactRef);
            if (
              !(persisted.bytes instanceof Uint8Array) ||
              persisted.bytes.byteLength !== bytes.byteLength ||
              persisted.bytes.byteLength > config.maxResponseBytes - state.consumed
            )
              throw failure("artifactPersistenceFailed", {
                stage: "self-hosted.task.cancel",
                attempt,
              });
            parents.push(artifactRef);
            state.consumed += bytes.byteLength;
            const payload = record(parseJson(persisted.bytes));
            confirmed =
              !controller.signal.aborted &&
              response.ok &&
              payload?.task_id === state.taskId &&
              payload.status === "canceled";
          } finally {
            clearTimeout(timer);
          }
        } catch {
          confirmed = false;
        }
        diagnostic = json({
          ...(record(diagnostic) ?? {}),
          remoteTaskId: state.taskId,
          remoteCancellationAttempted,
          remoteCancellationConfirmed: confirmed,
        });
      } else if (isOfficial && state.remoteIdentity !== undefined) {
        diagnostic = json({
          ...(record(diagnostic) ?? {}),
          batchId: state.remoteIdentity,
          remoteCancellationConfirmed: false,
        });
      }
      if (error instanceof DocumentServiceParserError) {
        const errorParents = [...error.parents, ...parents];
        if (diagnostic === error.diagnostic && errorParents.length === error.parents.length)
          throw error;
        throw new DocumentServiceParserError({
          code: error.code,
          stage: error.stage,
          retryable: error.retryable,
          message: error.message,
          parents: errorParents,
          ...(diagnostic === undefined ? {} : { diagnostic }),
          ...(error.sourceSegmentId === undefined
            ? {}
            : { sourceSegmentId: error.sourceSegmentId }),
          ...(error.observedBytes === undefined ? {} : { observedBytes: error.observedBytes }),
        });
      }
      const invalid = failure("middleInvalid", {
        remoteCancellationAttempted,
        detail: "normalization or parsing failed",
      });
      const failureDiagnostic = diagnostic ?? invalid.diagnostic;
      throw new DocumentServiceParserError({
        code: invalid.code,
        stage: invalid.stage,
        retryable: invalid.retryable,
        message: invalid.message,
        parents,
        ...(failureDiagnostic === undefined ? {} : { diagnostic: failureDiagnostic }),
      });
    } finally {
      clearTimeout(deadlineTimer);
      release?.();
    }
  };

  return { parse };
};

const controlFailure = (control: RequestControl): DocumentServiceParserError =>
  control.abortKind() === "caller" ? failure("aborted") : failure("timeout");
