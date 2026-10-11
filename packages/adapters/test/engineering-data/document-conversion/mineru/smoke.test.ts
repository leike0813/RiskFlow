import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { StructuredDocumentConversionCommandV1Schema } from "@riskflow/contracts/ports";
import { convertParsedDocument } from "@riskflow/core/engineering-data/document-conversion";
import { createMineruDocumentParser } from "../../../../src/engineering-data/document-conversion/mineru/index.js";
import { MineruConfigV1Schema } from "../../../../src/engineering-data/document-conversion/mineru/schema.js";
import { makeRequest } from "./fixture.js";
import { DocumentServiceParserError } from "../../../../src/engineering-data/document-conversion/structured-document-converter.js";
import {
  MineruAcceptanceSuiteSchema,
  verifyMineruAcceptanceSample,
  type MineruAcceptanceSample,
} from "./acceptance.js";

const enabled = process.env.MINERU_REAL_SMOKE === "1";
if (!enabled) console.info("MinerU real smoke not run: set MINERU_REAL_SMOKE=1 to opt in.");
const repoRoot = resolve(import.meta.dirname, "../../../../../..");
const suitePath = process.env.MINERU_SMOKE_SUITE;
const suite =
  enabled && suitePath !== undefined
    ? MineruAcceptanceSuiteSchema.parse(JSON.parse(await readFile(resolve(suitePath), "utf8")))
    : null;
const samples: (MineruAcceptanceSample | null)[] = suite?.samples ?? [null];

describe("MinerU real service smoke", () => {
  for (const sample of samples)
    it.skipIf(!enabled)(
      sample === null
        ? "converts one explicitly selected sample"
        : `accepts source checklist: ${sample.id}`,
      async () => {
        const configPath = resolve(
          process.env.MINERU_SMOKE_CONFIG ??
            join(repoRoot, "deployment/mineru-config.example.json"),
        );
        const inputPath = resolve(
          sample === null
            ? (process.env.MINERU_SMOKE_INPUT ??
                join(
                  repoRoot,
                  "packages/adapters/test/fixtures/structured-document-conversion/sample.pdf",
                ))
            : join(repoRoot, sample.inputPath),
        );
        const baseConfig = MineruConfigV1Schema.parse(
          JSON.parse(await readFile(configPath, "utf8")),
        );
        const config =
          sample === null
            ? baseConfig
            : MineruConfigV1Schema.parse({
                ...baseConfig,
                qualityPolicyRef: {
                  entityId: `mineru-source-checklist-${sample.id}`,
                  versionId: suite!.versionId,
                },
                qualityPolicy: {
                  minNonEmptyPageRatio: 1,
                  minKeyFieldCoverage: 1,
                  keyFields: sample.keyFields,
                },
              });
        const token = process.env.MINERU_TOKEN;
        if (config.credentialRef !== null && (token === undefined || token.trim() === ""))
          throw new Error("MINERU_TOKEN is required for this deployment credential");
        const mediaType =
          sample?.mediaType ?? process.env.MINERU_SMOKE_MEDIA_TYPE ?? "application/pdf";
        const inputKind = sample?.inputKind ?? process.env.MINERU_SMOKE_INPUT_KIND ?? "ocr-layout";
        const validPair =
          (mediaType === "application/pdf" &&
            (inputKind === "text-pdf" || inputKind === "ocr-layout")) ||
          ((mediaType === "image/png" || mediaType === "image/jpeg") &&
            inputKind === "ocr-layout") ||
          (mediaType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
            inputKind === "docx");
        if (!validPair) throw new Error("Smoke media type and input kind are unsupported");
        const bytes = new Uint8Array(await readFile(inputPath));
        const baseRequest = makeRequest();
        const request = {
          ...baseRequest,
          bytes,
          command: StructuredDocumentConversionCommandV1Schema.parse({
            ...baseRequest.command,
            conversionId: `smoke-${Date.now()}`,
            deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            mediaType,
            input: { kind: inputKind },
            converterDeploymentRef: config.deploymentRef,
            qualityPolicyRef: config.qualityPolicyRef,
          }),
        };
        const scratch = await mkdtemp(
          join(
            process.env.MINERU_SMOKE_OUTPUT_DIR === undefined
              ? tmpdir()
              : resolve(process.env.MINERU_SMOKE_OUTPUT_DIR),
            "riskflow-mineru-smoke-",
          ),
        );
        await chmod(scratch, 0o700);
        let sequence = 0;
        const started = performance.now();
        try {
          const result = await createMineruDocumentParser({
            config,
            credentials: config.credentialRef === null ? {} : { [config.credentialRef]: token! },
          }).parse({
            ...request,
            persistRawResponse: async ({ bytes: responseBytes, attempt }) => {
              const name = `response-${attempt}-${sequence++}.bin`;
              const path = join(scratch, name);
              await writeFile(path, responseBytes, { flag: "wx", mode: 0o600 });
              const persistedBytes = new Uint8Array(await readFile(path));
              const digest = createHash("sha256").update(persistedBytes).digest("hex");
              return {
                artifactRef: {
                  kind: "content-artifact",
                  reference: { entityId: `mineru-smoke-${attempt}`, versionId: `sha256:${digest}` },
                },
                bytes: persistedBytes,
              };
            },
          });
          await writeFile(join(scratch, "normalization.json"), JSON.stringify(result), {
            flag: "wx",
            mode: 0o600,
          });
          const converted = convertParsedDocument(result.parsedDocument, {
            strategyVersion: `${config.deploymentRef.entityId}@${config.deploymentRef.versionId}|${config.qualityPolicyRef.entityId}@${config.qualityPolicyRef.versionId}`,
          });
          await writeFile(join(scratch, "conversion.json"), JSON.stringify(converted), {
            flag: "wx",
            mode: 0o600,
          });
          expect(result.parsedDocument.blocks.some(({ text }) => text.trim().length > 0)).toBe(
            true,
          );
          expect(converted.document.sourceSegments.length).toBeGreaterThan(0);
          expect(converted.compliance.passed).toBe(true);
          const checks =
            sample === null ? null : verifyMineruAcceptanceSample(result.parsedDocument, sample);
          const report = {
            status: "completed",
            protocol: config.protocol,
            elapsedMs: performance.now() - started,
            sampleId: sample?.id ?? null,
            sourceChecklistVersion: suite?.versionId ?? null,
            scope: "isolated-parser-and-jsonld-acceptance",
            evidenceDirectory: scratch,
            inputBytes: bytes.byteLength,
            inputSha256: createHash("sha256").update(bytes).digest("hex"),
            deploymentRef: config.deploymentRef,
            resourceAllocationRef: config.resourceAllocationRef,
            qualityPolicyRef: config.qualityPolicyRef,
            checks,
            pages: result.parsedDocument.pageExtents?.length ?? null,
            blocks: result.parsedDocument.blocks.length,
            segments: converted.document.sourceSegments.length,
            compliance: converted.compliance.passed,
          };
          await writeFile(join(scratch, "acceptance.json"), JSON.stringify(report), {
            flag: "wx",
            mode: 0o600,
          });
          console.info(JSON.stringify(report));
        } catch (error) {
          const failure =
            error instanceof DocumentServiceParserError
              ? {
                  code: error.code,
                  stage: error.stage,
                  retryable: error.retryable,
                  diagnostic: error.diagnostic,
                }
              : { code: "SMOKE_VALIDATION_FAILED" };
          await writeFile(
            join(scratch, "failure.json"),
            JSON.stringify({
              ...failure,
              sampleId: sample?.id ?? null,
              protocol: config.protocol,
              elapsedMs: performance.now() - started,
            }),
            {
              flag: "wx",
              mode: 0o600,
            },
          );
          console.info(
            JSON.stringify({
              status: "failed",
              protocol: config.protocol,
              sampleId: sample?.id ?? null,
              elapsedMs: performance.now() - started,
              evidenceDirectory: scratch,
              inputBytes: bytes.byteLength,
              ...failure,
            }),
          );
          throw new Error(
            "MinerU real smoke failed; raw C04 response evidence was preserved in the reported directory",
            { cause: error },
          );
        }
      },
      11 * 60_000,
    );
});
