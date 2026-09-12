import { z } from "@riskflow/core/model";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import type { JsonValue } from "@riskflow/core/persistence";

import {
  OcrLayoutParserError,
  type OcrLayoutParserFailureV1,
} from "../structured-document-converter.js";

/**
 * C13 OCR 私有协议 Schema。这里只描述 adapter 发送的请求、消费的 PaddleX
 * `POST /layout-parsing` 响应闭合视图，以及 OCR 自己的版本/质量追踪结构；
 * 业务输出一律复用 C12 DTO，PaddleX 原始响应不透传。
 */

export const OCR_SCHEMA_VERSION_V1 = "1" as const;
export const OCR_LAYOUT_PROTOCOL_VERSION_V1 = "pp-structurev3-layout-parsing-1" as const;

const positiveSafeInteger = z.number().int().positive().safe();
const nonNegativeSafeInteger = z.number().int().nonnegative().safe();
const finiteNumber = z.number().finite();
const finitePositive = finiteNumber.positive();
const unitInterval = finiteNumber.min(0).max(1);
const versionKey = (value: { entityId: string; versionId: string }): string =>
  `${value.entityId}\u0000${value.versionId}`;

/** 内网端点只允许 origin：不得携带用户信息、query、fragment 或子路径。 */
export const OcrOriginUrlV1Schema = z
  .string()
  .url()
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        context.addIssue({ code: "custom", message: "baseUrl must use http or https" });
      }
      if (
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        (url.pathname !== "" && url.pathname !== "/")
      ) {
        context.addIssue({ code: "custom", message: "baseUrl must be an origin" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "baseUrl must be a valid URL" });
    }
  });

export const PaddleOcrDeploymentConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal(OCR_SCHEMA_VERSION_V1),
    deploymentRef: VersionReferenceSchema,
    serviceBuildRef: VersionReferenceSchema,
    pipelineRef: VersionReferenceSchema,
    modelVersionRefs: z.array(VersionReferenceSchema).min(1).max(64),
    resourceAllocationRef: VersionReferenceSchema,
    retryPolicyRef: VersionReferenceSchema,
    baseUrl: OcrOriginUrlV1Schema,
    protocolVersion: z.literal(OCR_LAYOUT_PROTOCOL_VERSION_V1),
    maxInputBytes: positiveSafeInteger,
    maxResponseBytes: positiveSafeInteger,
    maxPages: positiveSafeInteger,
    maxConcurrentRequests: positiveSafeInteger,
    maxQueuedRequests: nonNegativeSafeInteger,
    requestTimeoutMs: positiveSafeInteger,
    maxAttempts: positiveSafeInteger,
    retryDelayMs: nonNegativeSafeInteger,
  })
  .superRefine((config, context) => {
    const keys = config.modelVersionRefs.map(versionKey);
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index]! <= keys[index - 1]!) {
        context.addIssue({
          code: "custom",
          path: ["modelVersionRefs", index],
          message: "model version references must be unique and ascending",
        });
      }
    }
    if (config.maxResponseBytes < config.maxInputBytes) {
      context.addIssue({
        code: "custom",
        path: ["maxResponseBytes"],
        message: "response budget must cover the largest accepted input",
      });
    }
  });
export type PaddleOcrDeploymentConfigV1 = z.infer<typeof PaddleOcrDeploymentConfigV1Schema>;

export const OcrKeyFieldV1Schema = z.strictObject({
  fieldId: IdentifierSchema,
  pageNumber: positiveSafeInteger,
  regionId: IdentifierSchema,
  expectedText: z.string().trim().min(1).max(200),
});
export type OcrKeyFieldV1 = z.infer<typeof OcrKeyFieldV1Schema>;

export const OcrQualityPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(OCR_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  requiredPageCoverage: z.literal(1),
  minimumNonEmptyPageRatio: unitInterval,
  minimumValidRegionRatio: unitInterval,
  minimumReadingOrderRatio: unitInterval,
  minimumMeanServiceConfidence: unitInterval,
  minimumRegionConfidence: unitInterval.optional(),
  requireCompleteTableCells: z.boolean(),
  minimumKeyFieldCoverage: unitInterval,
});
export type OcrQualityPolicyV1 = z.infer<typeof OcrQualityPolicyV1Schema>;

export const PaddleOcrLayoutConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal(OCR_SCHEMA_VERSION_V1),
    deployment: PaddleOcrDeploymentConfigV1Schema,
    quality: OcrQualityPolicyV1Schema,
    keyFields: z.array(OcrKeyFieldV1Schema).max(64),
  })
  .superRefine((config, context) => {
    if (config.quality.minimumKeyFieldCoverage > 0 && config.keyFields.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["keyFields"],
        message: "key field coverage requires a versioned key field checklist",
      });
    }
  });
export type PaddleOcrLayoutConfigV1 = z.infer<typeof PaddleOcrLayoutConfigV1Schema>;

/** adapter 只发送这些受控参数；不接收业务输入提供的 URL、路径、设备或模型参数。 */
export const PaddleLayoutRequestV1Schema = z.strictObject({
  file: z.string().min(1),
  fileType: z.union([z.literal(0), z.literal(1)]),
  visualize: z.literal(false),
  returnMarkdownImages: z.literal(false),
});
export type PaddleLayoutRequestV1 = z.infer<typeof PaddleLayoutRequestV1Schema>;

const boundingBoxSchema = z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]);
export type PaddleBoundingBoxV1 = z.infer<typeof boundingBoxSchema>;

/** PaddleX 响应含大量非业务字段：只解析消费字段，其余显式丢弃。 */
export const PaddleLayoutBlockV1Schema = z.object({
  block_label: z.string().min(1).max(64),
  block_content: z.string().max(200_000),
  block_bbox: boundingBoxSchema,
  block_id: z.union([z.number().int(), z.string().max(128)]).optional(),
});
export type PaddleLayoutBlockV1 = z.infer<typeof PaddleLayoutBlockV1Schema>;

export const PaddleTableResultV1Schema = z.object({
  cell_box_list: z.array(boundingBoxSchema).min(1).optional(),
  table_ocr_pred: z
    .object({
      rec_texts: z.array(z.string().max(200_000)),
      rec_scores: z.array(unitInterval),
      rec_boxes: z.array(boundingBoxSchema).optional(),
    })
    .superRefine((result, context) => {
      if (result.rec_scores.length !== result.rec_texts.length) {
        context.addIssue({
          code: "custom",
          path: ["rec_scores"],
          message: "OCR scores must align with text",
        });
      }
      if (result.rec_boxes !== undefined && result.rec_boxes.length !== result.rec_texts.length) {
        context.addIssue({
          code: "custom",
          path: ["rec_boxes"],
          message: "OCR boxes must align with text",
        });
      }
    })
    .optional(),
  pred_html: z.string().optional(),
});
export type PaddleTableResultV1 = z.infer<typeof PaddleTableResultV1Schema>;

export const PaddleLayoutPageV1Schema = z.object({
  prunedResult: z.object({
    page_index: nonNegativeSafeInteger.optional(),
    doc_preprocessor_res: z
      .object({
        output_img_shape: z.tuple([finitePositive, finitePositive]),
      })
      .optional(),
    parsing_res_list: z.array(PaddleLayoutBlockV1Schema).min(1),
    table_res_list: z.array(PaddleTableResultV1Schema).optional(),
    overall_ocr_res: z
      .object({
        rec_texts: z.array(z.string().max(200_000)),
        rec_scores: z.array(unitInterval),
        rec_boxes: z.array(boundingBoxSchema).optional(),
        rec_polys: z.array(z.array(z.tuple([finiteNumber, finiteNumber])).min(3)).optional(),
      })
      .superRefine((result, context) => {
        if (result.rec_scores.length !== result.rec_texts.length) {
          context.addIssue({
            code: "custom",
            path: ["rec_scores"],
            message: "OCR scores must align with text",
          });
        }
        if (result.rec_boxes !== undefined && result.rec_boxes.length !== result.rec_texts.length) {
          context.addIssue({
            code: "custom",
            path: ["rec_boxes"],
            message: "OCR boxes must align with text",
          });
        }
        if (result.rec_polys !== undefined && result.rec_polys.length !== result.rec_texts.length) {
          context.addIssue({
            code: "custom",
            path: ["rec_polys"],
            message: "OCR polygons must align with text",
          });
        }
      })
      .optional(),
  }),
});
export type PaddleLayoutPageV1 = z.infer<typeof PaddleLayoutPageV1Schema>;

export const PaddleLayoutResponseV1Schema = z.object({
  logId: z.string().max(256).optional(),
  errorCode: z.number().int(),
  errorMsg: z.string().max(2000).optional(),
  result: z.object({
    layoutParsingResults: z.array(PaddleLayoutPageV1Schema).min(1),
    dataInfo: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("image"),
        width: finitePositive,
        height: finitePositive,
      }),
      z.object({
        type: z.literal("pdf"),
        numPages: positiveSafeInteger,
        pages: z.array(z.object({ width: finitePositive, height: finitePositive })).min(1),
      }),
    ]),
  }),
});
export type PaddleLayoutResponseV1 = z.infer<typeof PaddleLayoutResponseV1Schema>;

export const OcrQualityMetricV1Schema = z.strictObject({
  metricId: IdentifierSchema,
  passed: z.boolean(),
  observed: finiteNumber.nonnegative(),
  threshold: finiteNumber.nonnegative(),
  pageNumber: positiveSafeInteger.optional(),
  regionId: IdentifierSchema.optional(),
});
export type OcrQualityMetricV1 = z.infer<typeof OcrQualityMetricV1Schema>;

export const OcrTraceV1Schema = z.strictObject({
  schemaVersion: z.literal(OCR_SCHEMA_VERSION_V1),
  conversionId: IdentifierSchema,
  deploymentRef: VersionReferenceSchema,
  serviceBuildRef: VersionReferenceSchema,
  pipelineRef: VersionReferenceSchema,
  modelVersionRefs: z.array(VersionReferenceSchema).min(1),
  resourceAllocationRef: VersionReferenceSchema,
  retryPolicyRef: VersionReferenceSchema,
  qualityPolicyRef: VersionReferenceSchema,
  protocolVersion: z.string().min(1).max(64),
  attempt: positiveSafeInteger,
  httpStatus: nonNegativeSafeInteger,
  inputBytes: nonNegativeSafeInteger,
  responseBytes: nonNegativeSafeInteger,
  pageCount: nonNegativeSafeInteger,
  regionCount: nonNegativeSafeInteger,
  tableCount: nonNegativeSafeInteger,
  cellCount: nonNegativeSafeInteger,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  metrics: z.array(OcrQualityMetricV1Schema).max(64),
});
export type OcrTraceV1 = z.infer<typeof OcrTraceV1Schema>;

export const OCR_ERROR_CODES_V1 = Object.freeze({
  OCR_AUTHORIZATION_DENIED: { stage: "authorization", retryable: false },
  OCR_INPUT_INVALID: { stage: "input", retryable: false },
  OCR_MEDIA_TYPE_UNSUPPORTED: { stage: "input", retryable: false },
  OCR_DEPLOYMENT_NOT_FOUND: { stage: "deployment", retryable: false },
  OCR_DEPLOYMENT_MISMATCH: { stage: "deployment", retryable: false },
  OCR_BUDGET_EXCEEDED: { stage: "budget", retryable: false },
  OCR_SERVICE_UNAVAILABLE: { stage: "service", retryable: true },
  OCR_SERVICE_RATE_LIMITED: { stage: "service", retryable: true },
  OCR_TIMEOUT: { stage: "service", retryable: true },
  OCR_PROTOCOL_INVALID: { stage: "protocol", retryable: false },
  OCR_OUTPUT_INVALID: { stage: "normalize", retryable: false },
  OCR_QUALITY_BLOCKED: { stage: "quality", retryable: false },
  OCR_ARTIFACT_PERSISTENCE_FAILED: { stage: "artifact", retryable: true },
  OCR_CANCELLED: { stage: "control", retryable: false },
} as const);
export type OcrErrorCodeV1 = keyof typeof OCR_ERROR_CODES_V1;

export interface OcrFailureContextV1 {
  readonly message?: string;
  readonly parents?: readonly ArtifactRefV1[];
  readonly evidence?: OcrLayoutParserFailureV1["evidence"];
  readonly diagnostic?: unknown;
  readonly sourceSegmentId?: string;
  readonly observedBytes?: number;
}

/** 诊断体只承载可序列化的白名单字段，进入 C04 诊断工件前先规整为 JSON 值。 */
export const toJsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

/** 错误码、可重试性与阶段的唯一映射出口，避免各调用点自定重试语义。 */
export const ocrFailure = (
  code: OcrErrorCodeV1,
  context: OcrFailureContextV1 = {},
): OcrLayoutParserError => {
  const definition = OCR_ERROR_CODES_V1[code];
  return new OcrLayoutParserError({
    code,
    stage: definition.stage,
    retryable: definition.retryable,
    ...(context.message === undefined ? {} : { message: context.message }),
    ...(context.parents === undefined ? {} : { parents: context.parents }),
    ...(context.evidence === undefined ? {} : { evidence: context.evidence }),
    ...(context.diagnostic === undefined ? {} : { diagnostic: toJsonValue(context.diagnostic) }),
    ...(context.sourceSegmentId === undefined ? {} : { sourceSegmentId: context.sourceSegmentId }),
    ...(context.observedBytes === undefined ? {} : { observedBytes: context.observedBytes }),
  });
};
