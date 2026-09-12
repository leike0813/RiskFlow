import { PaddleOcrLayoutConfigV1Schema, type PaddleOcrLayoutConfigV1 } from "./schema.js";

/**
 * OCR 部署/质量配置由 composition root 注入后 strict 解析并深冻结；业务输入
 * 不能提供或覆盖端点、模型、设备与预算。冻结语义与 `packages/adapters/src/model/config.ts`
 * 的部署配置一致，但 OCR 配置独立解析，不读取 llama.cpp 的部署表或预算状态。
 */

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
};

export const parsePaddleOcrLayoutConfig = (value: unknown): PaddleOcrLayoutConfigV1 =>
  deepFreeze(PaddleOcrLayoutConfigV1Schema.parse(value));
