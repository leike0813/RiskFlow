import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_MANIFESTS, checkDependencyPolicy } from "./check-dependency-policy.mjs";

const temporaryRoots: string[] = [];

const validRegistration = {
  name: "registered-dependency",
  version: "1.2.3",
  purpose: "fixture",
  license: "MIT",
  source: "https://example.test/package",
  offline: "fixture store",
  exitCondition: "fixture replacement",
};

function writeFixture({ dependencyFields = {}, registrations = [] } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "riskflow-dependency-policy-"));
  temporaryRoots.push(rootDir);

  for (const manifestPath of PACKAGE_MANIFESTS) {
    const filePath = join(rootDir, manifestPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        manifestPath === "package.json"
          ? { name: "fixture", version: "0.0.0", ...dependencyFields }
          : { name: "fixture-member", version: "0.0.0" },
        null,
        2,
      ),
    );
  }

  const policyPath = join(rootDir, "config/dependency-policy.json");
  mkdirSync(dirname(policyPath), { recursive: true });
  writeFileSync(
    policyPath,
    JSON.stringify({ allowedLicenses: ["MIT"], dependencies: registrations }, null, 2),
  );
  return rootDir;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("dependency policy", () => {
  it.each([
    {
      name: "unregistered dependency",
      dependencyFields: { dependencies: { unregistered: "1.2.3" } },
      registrations: [],
      expectedCode: "UNREGISTERED_DEPENDENCY",
    },
    {
      name: "missing governance field",
      dependencyFields: { dependencies: { "registered-dependency": "1.2.3" } },
      registrations: [{ ...validRegistration, purpose: "" }],
      expectedCode: "MISSING_FIELD",
    },
  ])("rejects $name", ({ dependencyFields, registrations, expectedCode }) => {
    const rootDir = writeFixture({ dependencyFields, registrations });
    const problemCodes = checkDependencyPolicy({ rootDir }).map(({ code }) => code);

    expect(problemCodes).toContain(expectedCode);
  });
});
