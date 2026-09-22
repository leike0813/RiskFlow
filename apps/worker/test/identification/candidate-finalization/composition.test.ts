import { describe, expect, it } from "vitest";

import { createRiskCandidateFinalizationComposition } from "../../../src/identification/candidate-finalization/index.js";

import type { RiskCandidateFinalizationCompositionOptionsV1 } from "../../../src/identification/candidate-finalization/index.js";

/**
 * 组合根只做接线：全部必需依赖用最小替身注入，缺失任一项必须构造失败。
 * 具体行为由 `runtime.test.ts`、core 测试与 adapters 测试覆盖。
 */
const requiredOptions = (): RiskCandidateFinalizationCompositionOptionsV1 =>
  ({
    db: {},
    transactionUnit: {},
    artifactStore: {},
    modelGateway: {},
    review: {},
    modelContextReader: {},
    workPlanReader: {},
    policyProvider: {},
    reviewDecisionReader: {},
    authorization: {},
  }) as unknown as RiskCandidateFinalizationCompositionOptionsV1;

const REQUIRED_DEPENDENCIES = [
  "db",
  "transactionUnit",
  "artifactStore",
  "modelGateway",
  "review",
  "modelContextReader",
  "workPlanReader",
  "policyProvider",
  "reviewDecisionReader",
  "authorization",
] as const;

describe("C22 risk candidate finalization composition", () => {
  it.each(REQUIRED_DEPENDENCIES)("fails closed when %s is missing", (dependency) => {
    const options = { ...requiredOptions(), [dependency]: undefined } as never;
    expect(() => createRiskCandidateFinalizationComposition(options)).toThrow(
      new TypeError("risk candidate finalization composition requires every C03-C22 dependency"),
    );
  });

  it("exposes only the analyze, finalize and revision branches of the frozen service", () => {
    const composition = createRiskCandidateFinalizationComposition(requiredOptions());
    expect(typeof composition.service.analyze).toBe("function");
    expect(typeof composition.service.finalize).toBe("function");
    // C23 人工复核通过该窄接缝登记修订候选，不接触 C22 内部存储。
    expect(typeof composition.service.prepareReviewRevision).toBe("function");
    // C24 拥有 `plan`：C22 组合不提供该分支，也不暴露图或 API 接线。
    expect("plan" in composition.service).toBe(false);
    expect(typeof composition.adapter.registerResults).toBe("function");
    expect(typeof composition.adapter.insertRecords).toBe("function");
    expect(typeof composition.modelRuntime.generateCandidates).toBe("function");
    expect(typeof composition.modelRuntime.embedRiskEvents).toBe("function");
  });
});
