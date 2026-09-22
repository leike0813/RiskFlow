import { describe, expect, it } from "vitest";

import { createIdentificationHumanReviewComposition } from "../../../src/identification/human-review/index.js";

import type { IdentificationHumanReviewCompositionOptionsV1 } from "../../../src/identification/human-review/index.js";

/**
 * 组合根只做接线：全部必需依赖用最小替身注入，缺失任一项必须构造失败。
 * 具体行为由 core 的 C23 测试与 adapters 的 C07 窄读测试覆盖。
 */
const requiredOptions = (): IdentificationHumanReviewCompositionOptionsV1 =>
  ({
    pendingReviewReader: {},
    reviewRevision: {},
    review: {},
  }) as unknown as IdentificationHumanReviewCompositionOptionsV1;

const REQUIRED_DEPENDENCIES = ["pendingReviewReader", "reviewRevision", "review"] as const;

describe("C23 identification human review composition", () => {
  it.each(REQUIRED_DEPENDENCIES)("fails closed when %s is missing", (dependency) => {
    const options = { ...requiredOptions(), [dependency]: undefined } as never;
    expect(() => createIdentificationHumanReviewComposition(options)).toThrow(
      new TypeError("identification human review composition requires every C07-C22 dependency"),
    );
  });

  it("exposes decide and decideBatch over the frozen C07/C22 seams", () => {
    const composition = createIdentificationHumanReviewComposition(requiredOptions());
    expect(typeof composition.service.decide).toBe("function");
    expect(typeof composition.service.decideBatch).toBe("function");
    // C24 拥有识别图事件消费、C33 拥有 HTTP/Web：C23 不接线工作流恢复或页面入口。
    expect("resumeRun" in composition.service).toBe(false);
    expect("requestReview" in composition.service).toBe(false);
  });
});
