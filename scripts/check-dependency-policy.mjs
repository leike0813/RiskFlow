import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

export const PACKAGE_MANIFESTS = Object.freeze([
  "package.json",
  "apps/web/package.json",
  "apps/api/package.json",
  "apps/worker/package.json",
  "packages/contracts/package.json",
  "packages/core/package.json",
  "packages/adapters/package.json",
]);

const POLICY_FIELDS = Object.freeze([
  "name",
  "version",
  "purpose",
  "license",
  "source",
  "offline",
  "exitCondition",
]);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code, packagePath, dependency = "", detail = "") {
  return { code, packagePath, dependency, detail };
}

function compareIssues(left, right) {
  const leftKey = [left.code, left.packagePath, left.dependency, left.detail].join("\0");
  const rightKey = [right.code, right.packagePath, right.dependency, right.detail].join("\0");
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function readJson(rootDir, relativeFilePath, problems) {
  const filePath = resolve(rootDir, relativeFilePath);
  if (!existsSync(filePath)) {
    problems.push(issue("MISSING_FILE", relativeFilePath));
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    problems.push(issue("INVALID_JSON", relativeFilePath));
    return null;
  }
}

function collectDirectDependencies(rootDir, problems) {
  const dependencies = new Map();

  for (const manifestPath of PACKAGE_MANIFESTS) {
    const manifest = readJson(rootDir, manifestPath, problems);
    if (!isRecord(manifest)) {
      if (manifest !== null) {
        problems.push(issue("INVALID_MANIFEST", manifestPath));
      }
      continue;
    }

    const seenFields = new Map();
    for (const field of DEPENDENCY_FIELDS) {
      const fieldValue = manifest[field];
      if (fieldValue === undefined) continue;
      if (!isRecord(fieldValue)) {
        problems.push(issue("INVALID_DEPENDENCY_FIELD", manifestPath, field));
        continue;
      }

      for (const [name, version] of Object.entries(fieldValue)) {
        if (typeof version !== "string" || version.length === 0) {
          problems.push(issue("MISSING_FIELD", manifestPath, name, `${field}.version`));
          continue;
        }
        if (version.startsWith("workspace:")) continue;

        if (!EXACT_VERSION.test(version)) {
          problems.push(issue("RANGE_VERSION", manifestPath, name, `${field}=${version}`));
        }

        const previousField = seenFields.get(name);
        if (previousField) {
          problems.push(
            issue("DUPLICATE_DEPENDENCY", manifestPath, name, `${previousField},${field}`),
          );
        } else {
          seenFields.set(name, field);
        }

        const entries = dependencies.get(name) ?? [];
        entries.push({ manifestPath, field, version });
        dependencies.set(name, entries);
      }
    }
  }

  return dependencies;
}

function collectRegistrations(policy, policyPath, allowedLicenses, problems) {
  if (!isRecord(policy)) {
    problems.push(issue("INVALID_POLICY", policyPath));
    return new Map();
  }

  if (!Array.isArray(policy.dependencies)) {
    problems.push(issue("MISSING_FIELD", policyPath, "dependencies"));
    return new Map();
  }

  const registrations = new Map();
  for (const [index, registration] of policy.dependencies.entries()) {
    if (!isRecord(registration)) {
      problems.push(issue("INVALID_REGISTRATION", policyPath, String(index)));
      continue;
    }

    const name = typeof registration.name === "string" ? registration.name : "";
    for (const field of POLICY_FIELDS) {
      const value = registration[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        problems.push(issue("MISSING_FIELD", policyPath, name || String(index), field));
      }
    }

    if (!name) continue;
    if (registrations.has(name)) {
      problems.push(issue("DUPLICATE_REGISTRATION", policyPath, name));
      continue;
    }

    if (typeof registration.version === "string" && !EXACT_VERSION.test(registration.version)) {
      problems.push(issue("RANGE_VERSION", policyPath, name, `version=${registration.version}`));
    }
    if (typeof registration.license === "string" && !allowedLicenses.has(registration.license)) {
      problems.push(issue("DISALLOWED_LICENSE", policyPath, name, registration.license));
    }

    registrations.set(name, registration);
  }

  return registrations;
}

export function checkDependencyPolicy({ rootDir = SCRIPT_ROOT } = {}) {
  const problems = [];
  const policyPath = "config/dependency-policy.json";
  const policy = readJson(rootDir, policyPath, problems);
  const allowedLicenses = new Set(
    isRecord(policy) && Array.isArray(policy.allowedLicenses)
      ? policy.allowedLicenses.filter((license) => typeof license === "string")
      : [],
  );

  if (!isRecord(policy) || !Array.isArray(policy.allowedLicenses)) {
    problems.push(issue("MISSING_FIELD", policyPath, "allowedLicenses"));
  }

  const registrations = collectRegistrations(policy, policyPath, allowedLicenses, problems);
  const directDependencies = collectDirectDependencies(rootDir, problems);

  for (const [name, entries] of directDependencies) {
    const registration = registrations.get(name);
    if (!registration) {
      for (const entry of entries) {
        problems.push(issue("UNREGISTERED_DEPENDENCY", entry.manifestPath, name));
      }
      continue;
    }

    for (const entry of entries) {
      if (registration.version !== entry.version) {
        problems.push(
          issue(
            "VERSION_MISMATCH",
            entry.manifestPath,
            name,
            `${entry.version}!=${registration.version}`,
          ),
        );
      }
    }
  }

  for (const name of registrations.keys()) {
    if (!directDependencies.has(name)) {
      problems.push(issue("STALE_REGISTRATION", policyPath, name));
    }
  }

  return problems.sort(compareIssues);
}

export function formatIssue(problem) {
  const location = [problem.packagePath, problem.dependency].filter(Boolean).join(":");
  return `[${problem.code}] ${location}${problem.detail ? ` ${problem.detail}` : ""}`;
}

export function main({ rootDir = SCRIPT_ROOT } = {}) {
  const problems = checkDependencyPolicy({ rootDir });
  if (problems.length === 0) {
    console.log("dependency policy: OK");
    return 0;
  }

  for (const problem of problems) {
    console.error(formatIssue(problem));
  }
  console.error(`dependency policy: ${problems.length} problem(s)`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
