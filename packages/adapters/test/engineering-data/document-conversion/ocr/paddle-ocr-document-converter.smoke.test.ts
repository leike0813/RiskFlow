import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { z } from "@riskflow/core/model";
import { ArtifactReadRequestV1Schema, type ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import type {
  ContextSourceResultV1,
  EngineeringContextSourceRegistryV1,
  SourceProcessingInputV1,
} from "@riskflow/core/engineering-data/context-source";

import { StructuredDocumentConversionAdapter } from "../../../../src/engineering-data/document-conversion/index.js";
import * as ocrProductionModule from "../../../../src/engineering-data/document-conversion/ocr/index.js";
import {
  PaddleOcrLayoutConfigV1Schema,
  createPaddleOcrLayoutParser,
} from "../../../../src/engineering-data/document-conversion/ocr/index.js";
import { startArtifactFixture } from "../../../artifacts/fixture.js";

import { ocrTestAuthorization, ocrTestSource } from "./fixture.js";

/**
 * 真实内网 OCR 服务 smoke：仅在 `RISKFLOW_OCR_SMOKE=1` 且提供
 * `RISKFLOW_OCR_SMOKE_CONFIG` 时运行。测试不下载模型、不启停服务、不回退协议替身；
 * 显式启用但缺少配置、样例、服务或版本/资源证据时必须失败。报告只输出版本/资源
 * 引用、质量指标与工件引用，不输出正文、文件名与宿主路径。
 */
const enabled = process.env.RISKFLOW_OCR_SMOKE === "1";

const SmokeConfigSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  layout: PaddleOcrLayoutConfigV1Schema,
  samples: z
    .array(
      z.strictObject({
        fileName: IdentifierSchema,
        mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
      }),
    )
    .min(3),
  evidence: z.strictObject({
    serviceBuildInfo: IdentifierSchema,
    capturedAt: IsoDateTimeSchema,
    modelVersionRefs: z.array(VersionReferenceSchema).min(1),
    resourceAllocationRef: VersionReferenceSchema,
  }),
});

const smokeConfig = async (): Promise<{
  readonly configDir: string;
  readonly config: z.infer<typeof SmokeConfigSchema>;
}> => {
  const path = process.env.RISKFLOW_OCR_SMOKE_CONFIG;
  if (path === undefined || path.length === 0) {
    throw new Error("RISKFLOW_OCR_SMOKE_CONFIG is required when the OCR smoke is enabled");
  }
  const absolute = resolve(path);
  const raw: unknown = JSON.parse(await readFile(absolute, "utf8"));
  return { configDir: dirname(absolute), config: SmokeConfigSchema.parse(raw) };
};

describe.skipIf(!enabled)("paddle ocr real-service smoke", () => {
  it("converts the three frozen scanned samples through the production adapter", async () => {
    const { configDir, config } = await smokeConfig();
    const { deployment, quality } = config.layout;
    for (const required of ["application/pdf", "image/png", "image/jpeg"] as const) {
      if (!config.samples.some((sample) => sample.mediaType === required)) {
        throw new Error(`smoke samples must cover ${required}`);
      }
    }
    const evidenceKeys = config.evidence.modelVersionRefs.map(
      (ref) => `${ref.entityId}@${ref.versionId}`,
    );
    const deploymentKeys = deployment.modelVersionRefs.map(
      (ref) => `${ref.entityId}@${ref.versionId}`,
    );
    if (evidenceKeys.join("|") !== deploymentKeys.join("|")) {
      throw new Error("service evidence does not prove the frozen model version set");
    }
    if (
      config.evidence.resourceAllocationRef.entityId !== deployment.resourceAllocationRef.entityId ||
      config.evidence.resourceAllocationRef.versionId !== deployment.resourceAllocationRef.versionId
    ) {
      throw new Error("service evidence does not prove the frozen resource allocation");
    }

    const artifactFixture = await startArtifactFixture();
    const report: Array<Record<string, unknown>> = [];
    try {
      for (const [index, sample] of config.samples.entries()) {
        const bytes = new Uint8Array(await readFile(join(configDir, sample.fileName)));
        expect(bytes.byteLength).toBeGreaterThan(0);
        const authorization = ocrTestAuthorization();
        const sourceArtifact = await artifactFixture.store.put(
          {
            schemaVersion: "1",
            commandId: `smoke-ocr-input-${index}`,
            idempotencyKey: `smoke-ocr-input-${index}`,
            projectId: authorization.projectId,
            actorId: authorization.actorId,
            issuedAt: new Date().toISOString(),
            authorization,
            requiredCapability: "engineering-data.write",
            artifactId: `smoke-ocr-input-${index}`,
            artifactKind: "content",
            purposeCode: "engineering-data.register-source-delivery",
            mediaType: sample.mediaType,
            parentArtifactRefs: [],
            evidenceReferences: [],
            additionalSpatialScopeRefs: [],
            additionalSourceAccessGrantRefs: [],
          },
          (async function* (): AsyncGenerator<Uint8Array> {
            yield bytes;
          })(),
        );
        const source: SourceProcessingInputV1 = {
          ...ocrTestSource(),
          sourceArtifactRef: {
            kind: "content-artifact",
            reference: sourceArtifact.artifactRef.reference,
          },
        };
        const contextSource = {
          resolveSourceProcessingInput: async (): Promise<ContextSourceResultV1> =>
            ({
              kind: "succeeded",
              result: { kind: "source-processing-input", input: source },
            }) as ContextSourceResultV1,
          resolveSourceVersionForRead: async (): Promise<ContextSourceResultV1> =>
            ({
              kind: "succeeded",
              result: { kind: "source-processing-input", input: source },
            }) as ContextSourceResultV1,
          registerSegments: async (command): Promise<ContextSourceResultV1> =>
            ({
              kind: "succeeded",
              result: {
                kind: "source-segment-set",
                segmentSet: {
                  sourceSegmentSetRef: {
                    kind: "source-segment-set",
                    reference: { entityId: `smoke-ocr-segments-${command.commandId}`, versionId: "1" },
                  },
                },
              },
            }) as unknown as ContextSourceResultV1,
          reviseContext: async (): Promise<ContextSourceResultV1> =>
            ({ kind: "failed", error: new Error("not used") }) as unknown as ContextSourceResultV1,
          createApplicabilitySnapshot: async (): Promise<ContextSourceResultV1> =>
            ({ kind: "failed", error: new Error("not used") }) as unknown as ContextSourceResultV1,
        } as unknown as EngineeringContextSourceRegistryV1;
        const adapter = new StructuredDocumentConversionAdapter({
          contextSource,
          artifactStore: artifactFixture.store,
          qualityPolicyRef: quality.policyRef,
          converterDeploymentRef: deployment.deploymentRef,
          ocrLayoutParser: createPaddleOcrLayoutParser({ config: config.layout }),
        });
        const result = await adapter.convert({
          schemaVersion: "1",
          conversionId: `smoke-ocr-${index}`,
          idempotencyKey: `smoke-ocr-${index}`,
          runId: `smoke-ocr-run-${index}`,
          threadId: `smoke-ocr-thread-${index}`,
          issuedAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + 600_000).toISOString(),
          projectId: source.projectId,
          actorId: authorization.actorId,
          authorization,
          sourceVersionRef: source.sourceVersionRef,
          sourceArtifactRef: source.sourceArtifactRef,
          mediaType: sample.mediaType,
          input: { kind: "ocr-layout" },
          conversionPolicyRef: { entityId: "document-conversion-policy", versionId: "1" },
          qualityPolicyRef: quality.policyRef,
          converterDeploymentRef: deployment.deploymentRef,
        });
        if (result.kind !== "succeeded") {
          throw new Error(`production adapter rejected a frozen smoke sample: ${result.error.code}`);
        }
        const openArtifact = async (artifactRef: ArtifactRefV1) => {
          const handle = await artifactFixture.store.open(
            ArtifactReadRequestV1Schema.parse({
              schemaVersion: "1",
              requestId: `smoke-read-${index}-${artifactRef.reference.entityId}`,
              idempotencyKey: `smoke-read-${index}-${artifactRef.reference.entityId}`,
              artifactRef,
              projectId: source.projectId,
              actorId: authorization.actorId,
              requestedAt: new Date().toISOString(),
              purposeCode: "engineering-data.structured-document-conversion",
              requiredCapability: "engineering-data.write",
              authorization,
            }),
          );
          const chunks: Uint8Array[] = [];
          for await (const chunk of handle.content) chunks.push(chunk);
          await handle.verified;
          return { manifest: handle.manifest, text: Buffer.concat(chunks).toString("utf8") };
        };
        const jsonLdArtifact = await openArtifact(result.result.jsonLdArtifactRef);
        const rawRef = jsonLdArtifact.manifest.parentArtifactRefs.find(
          (ref) => ref.kind === "diagnostic-artifact" && ref.reference.entityId.includes("ocr-raw"),
        );
        if (rawRef === undefined) {
          throw new Error("smoke JSON-LD artifact is missing its raw OCR response parent");
        }
        const rawEnvelope = JSON.parse((await openArtifact(rawRef)).text) as {
          trace?: { metrics?: unknown[] };
        };
        const jsonLd = JSON.parse(jsonLdArtifact.text) as {
          pageExtents?: unknown[];
          textBlocks: unknown[];
        };
        expect(jsonLd.textBlocks.length).toBeGreaterThan(0);
        expect(jsonLd.pageExtents?.length ?? 0).toBeGreaterThan(0);
        report.push({
          sample: { mediaType: sample.mediaType, byteLength: bytes.byteLength },
          deploymentRef: deployment.deploymentRef,
          serviceBuildRef: deployment.serviceBuildRef,
          pipelineRef: deployment.pipelineRef,
          modelVersionRefs: deployment.modelVersionRefs,
          resourceAllocationRef: deployment.resourceAllocationRef,
          serviceBuildInfo: config.evidence.serviceBuildInfo,
          pageCount: jsonLd.pageExtents?.length ?? 0,
          textBlockCount: jsonLd.textBlocks.length,
          qualityMetrics: rawEnvelope.trace?.metrics ?? [],
          jsonLdArtifactRef: result.result.jsonLdArtifactRef,
          sourceSegmentSetRef: result.result.sourceSegmentSetRef,
        });
      }
      process.stdout.write(`${JSON.stringify({ schemaVersion: "1", smoke: report }, null, 2)}\n`);
    } finally {
      await artifactFixture.close();
    }
  });
});

describe.skipIf(enabled)("paddle ocr smoke gate", () => {
  it("keeps the default suite free of test doubles and automatic success fallbacks", () => {
    const exported = Object.keys(ocrProductionModule);
    expect(exported).toContain("createPaddleOcrLayoutParser");
    expect(exported.filter((name) => /stub|fixture|fake|fallback|sample/i.test(name))).toEqual([]);
  });
});
