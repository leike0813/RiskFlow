#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";

const { z } = createRequire(new URL("../../packages/contracts/dist/index.js", import.meta.url))(
  "zod",
);

import { SystemAdministrationCommandPayloadV1Schema } from "../../packages/core/dist/access/administration.js";
import {
  LoginCommandV1Schema,
  ProjectAccessCommandV1Schema,
  SessionMetadataV1Schema,
} from "../../packages/core/dist/access/schema.js";
import { ArtifactPutCommandV1Schema } from "../../packages/core/dist/artifacts/schema.js";
import {
  EngineeringContextRevisionCommandV1Schema,
  RegisterSourceSegmentSetCommandV1Schema,
} from "../../packages/core/dist/engineering-data/context-source/index.js";
import {
  EngineeringDataCommandV1Schema,
  StructuredDocumentConversionCommandV1Schema,
  SpatialScopeRefV1Schema,
  SourceVersionRefV1Schema,
} from "../../packages/contracts/dist/ports/index.js";
import { loadDeploymentFoundationInputV1, createDeploymentFoundationV1 } from "./start.mjs";
import { resolveTemplates } from "../acceptance/synthetic.mjs";

const scopeRefs = z.array(SpatialScopeRefV1Schema).max(128);
const sourceRefs = z.array(SourceVersionRefV1Schema).max(256);
const forbiddenPayloadFields = new Set([
  "actorId",
  "authorization",
  "authorizationContextRef",
  "commandId",
  "idempotencyKey",
  "issuedAt",
  "projectId",
  "sessionToken",
]);
const projectAccessPayloadSchema = z.discriminatedUnion(
  "kind",
  ProjectAccessCommandV1Schema.options.map((schema) =>
    schema.omit({
      commandId: true,
      idempotencyKey: true,
      projectId: true,
      authorizationContextRef: true,
    }),
  ),
);
const stepBase = {
  id: z.string().min(1).max(96),
  requestedSpatialScopeRefs: scopeRefs,
  requestedSourceVersionRefs: sourceRefs,
};
const steps = z.discriminatedUnion("op", [
  z.strictObject({
    ...stepBase,
    op: z.literal("system-administration"),
    payload: SystemAdministrationCommandPayloadV1Schema,
  }),
  z.strictObject({
    ...stepBase,
    op: z.literal("project-access"),
    payload: projectAccessPayloadSchema,
  }),
  z.strictObject({
    ...stepBase,
    op: z.literal("context-revise"),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    ...stepBase,
    op: z.literal("artifact-put"),
    payload: z.record(z.string(), z.unknown()),
    inputFile: z.string().refine(isAbsolute),
  }),
  z.strictObject({
    ...stepBase,
    op: z.literal("source-delivery"),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    ...stepBase,
    op: z.literal("document-convert"),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    ...stepBase,
    op: z.literal("source-segments"),
    payload: z.record(z.string(), z.unknown()),
  }),
]);
export const ProvisionConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    runId: z.string().min(1).max(96),
    loginName: z.string().min(1).max(96),
    passwordSecretId: z.string().min(1).max(96),
    projectId: z.string().min(1).max(96),
    steps: z.array(steps).min(1).max(128),
  })
  .superRefine((value, context) => {
    const ids = new Set();
    for (const [index, step] of value.steps.entries()) {
      if (ids.has(step.id))
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "duplicate step id",
        });
      ids.add(step.id);
      if ("inputFile" in step && !isAbsolute(step.inputFile))
        context.addIssue({
          code: "custom",
          path: ["steps", index, "inputFile"],
          message: "inputFile must be absolute",
        });
    }
  });

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const commandIdentity = (runId, id) => {
  const value = `${runId}-${id}`;
  return value.length <= 96 ? value : `${value.slice(0, 83)}-${digest(value).slice(0, 12)}`;
};
/**
 * 宿主只拥有命令信封：这些顶层字段一律由本文件按当前会话注入，配置不得携带。
 * 嵌套对象属于各领域 strict Schema，由领域契约自己判定，不在这里预判。
 */
export const assertPayloadHasNoOwnedFields = (payload) => {
  for (const key of Object.keys(payload)) {
    if (forbiddenPayloadFields.has(key))
      throw new ProvisionBlockedError("PAYLOAD_OWNS_COMMAND_FIELD");
  }
};
const writeCheckpoint = async (path, value) => {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};
const publicResultRef = (result) => {
  if (result?.kind === "succeeded" && result.result?.resultRef) return result.result.resultRef;
  if (result?.kind === "succeeded" && result.result?.sourceVersionRef)
    return result.result.sourceVersionRef;
  if (result?.kind === "succeeded" && result.result?.segmentSet?.sourceSegmentSetRef)
    return result.result.segmentSet.sourceSegmentSetRef;
  if (result?.kind === "succeeded" && result.result?.conversionRef)
    return result.result.conversionRef;
  if (result?.kind === "succeeded" && result.result?.sourceDeliveryRef)
    return result.result.sourceDeliveryRef;
  if (result?.kind === "succeeded" && result.result?.revision?.spatialScopeRef)
    return result.result.revision.spatialScopeRef;
  if (result?.kind === "succeeded" && result.result?.revision?.projectRevisionRef)
    return result.result.revision.projectRevisionRef;
  return undefined;
};

export class ProvisionBlockedError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProvisionBlockedError";
    this.code = code;
  }
}

const executeStep = async ({ step, config, foundation, sessionToken, now, previous }) => {
  const id = commandIdentity(config.runId, step.id);
  const issuedAt = previous?.issuedAt ?? now();
  const bindings = {};
  const priorSteps = new Map([...previous.results].map(([key, resultRef]) => [key, { resultRef }]));
  const payload = resolveTemplates(step.payload, {
    bindings,
    steps: priorSteps,
    packDir: process.cwd(),
  });
  const requestedSpatialScopeRefs = step.requestedSpatialScopeRefs;
  const requestedSourceVersionRefs = step.requestedSourceVersionRefs;
  if (step.op === "system-administration") {
    const parsed = SystemAdministrationCommandPayloadV1Schema.parse(payload);
    const result = await foundation.access.systemAdministration.execute({
      schemaVersion: "1",
      commandId: id,
      idempotencyKey: id,
      issuedAt,
      sessionToken,
      payload: parsed,
    });
    if (result.kind !== "succeeded") throw new ProvisionBlockedError(result.error.code);
    return {
      resultRef: { kind: "access-result", reference: result.result.resultRef },
      status: "completed",
    };
  }

  assertPayloadHasNoOwnedFields(payload);
  let result;
  if (step.op === "project-access") {
    result = await foundation.access.executeDeploymentProjectAccess({
      sessionToken,
      command: {
        ...payload,
        commandId: id,
        idempotencyKey: id,
        projectId: config.projectId,
      },
    });
    return {
      resultRef: { kind: "access-result", reference: result.resultRef },
      status: "completed",
    };
  }
  const decision = await foundation.access.authorize({
    invocation: { kind: "human-session", sessionToken },
    invocationId: id,
    projectId: config.projectId,
    branch: "engineering-data.register-source-delivery",
    requestedSpatialScopeRefs,
    requestedSourceVersionRefs,
  });
  const authorization = decision.context;
  const command = {
    ...payload,
    commandId: id,
    idempotencyKey: id,
    projectId: config.projectId,
    actorId: authorization.actorId,
    issuedAt,
    authorization,
  };
  if (step.op === "context-revise") {
    const validated = EngineeringContextRevisionCommandV1Schema.parse(command);
    result = await foundation.contextSource.reviseContext(validated);
  } else if (step.op === "artifact-put") {
    const validated = ArtifactPutCommandV1Schema.parse({
      ...command,
      requiredCapability: "engineering-data.write",
    });
    const inputStat = await stat(step.inputFile);
    if (!inputStat.isFile() || inputStat.size > foundation.config.artifacts.maxArtifactBytes) {
      throw new ProvisionBlockedError("ARTIFACT_INPUT_OUT_OF_BOUNDS");
    }
    result = await foundation.artifactStore.put(validated, createReadStream(step.inputFile));
  } else if (step.op === "source-delivery") {
    const validated = EngineeringDataCommandV1Schema.parse({
      ...command,
      kind: "register-source-delivery",
    });
    result = await foundation.contextSource.apply(validated);
  } else if (step.op === "document-convert") {
    // 转换 DTO 没有 commandId：按原契约组装，幂等键与 issuedAt 仍沿用同一步骤身份。
    const validated = StructuredDocumentConversionCommandV1Schema.parse({
      ...payload,
      schemaVersion: "1",
      runId: config.runId,
      threadId: id,
      conversionId: id,
      idempotencyKey: id,
      issuedAt,
      deadlineAt: new Date(Date.parse(issuedAt) + 300_000).toISOString(),
      projectId: config.projectId,
      actorId: authorization.actorId,
      authorization,
    });
    if (
      foundation.config.documentConversion.mineru === null &&
      ["docx", "text-pdf", "ocr-layout"].includes(validated.input.kind)
    )
      throw new ProvisionBlockedError("MINERU_NOT_CONFIGURED");
    result = await foundation.documentConverter.convert(validated);
  } else {
    const validated = RegisterSourceSegmentSetCommandV1Schema.parse(command);
    result = await foundation.contextSource.registerSegments(validated);
  }
  if (result?.kind === "failed")
    throw new ProvisionBlockedError(result.error?.code ?? "STEP_FAILED");
  const resultRef = result?.artifactRef
    ? { kind: "content-artifact", reference: result.artifactRef.reference }
    : publicResultRef(result);
  if (!resultRef) throw new ProvisionBlockedError("STEP_RESULT_REFERENCE_MISSING");
  return { resultRef, status: "completed" };
};

export const runProvisionV1 = async ({
  config: rawConfig,
  outputFile,
  foundation,
  secrets,
  bootstrap = false,
  now = () => new Date().toISOString(),
}) => {
  const config = ProvisionConfigV1Schema.parse(rawConfig);
  if (!isAbsolute(outputFile)) throw new TypeError("PROVISION_OUTPUT_PATH_NOT_ABSOLUTE");
  if (
    !bootstrap &&
    config.steps.some((step) => step.op === "system-administration" || step.op === "project-access")
  ) {
    throw new ProvisionBlockedError("BOOTSTRAP_FLAG_REQUIRED");
  }
  const secretRef = foundation.config.database.secretFileRefs.find(
    (entry) => entry.secretId === config.passwordSecretId,
  );
  if (!secretRef || typeof secrets[config.passwordSecretId] !== "string")
    throw new TypeError("PROVISION_PASSWORD_SECRET_MISSING");
  const inputDigest = digest(config);
  let prior;
  try {
    prior = JSON.parse(await readFile(outputFile, "utf8"));
    if (prior.runId !== config.runId || prior.inputDigest !== inputDigest)
      throw new TypeError("PROVISION_RESUME_CONFLICT");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const login = await foundation.access.login(
    LoginCommandV1Schema.parse({
      kind: "login",
      loginAttemptId: commandIdentity(config.runId, "login"),
      loginName: config.loginName,
      password: secrets[config.passwordSecretId],
    }),
  );
  const { sessionToken, ...sessionMetadata } = login;
  delete sessionMetadata.systemAdministrationContextRef;
  SessionMetadataV1Schema.parse(sessionMetadata);
  if (login.passwordChangeRequired || login.restricted)
    throw new ProvisionBlockedError("PROVISION_SESSION_RESTRICTED");
  const results = new Map(
    (prior?.steps ?? [])
      .filter((step) => step.status === "completed" && step.resultRef)
      .map((step) => [step.id, step.resultRef]),
  );
  const states = new Map((prior?.steps ?? []).map((step) => [step.id, step]));
  const output = {
    schemaVersion: "1",
    runId: config.runId,
    inputDigest,
    status: "RUNNING",
    steps: [],
  };
  for (const step of config.steps) {
    const old = states.get(step.id);
    if (old?.status === "completed") {
      output.steps.push(old);
      continue;
    }
    const issuedAt = old?.issuedAt ?? now();
    output.steps.push({ id: step.id, op: step.op, status: "sending", issuedAt });
    try {
      await writeCheckpoint(outputFile, output);
      const outcome = await executeStep({
        step,
        config,
        foundation,
        sessionToken,
        now: () => issuedAt,
        previous: { issuedAt, results },
      });
      results.set(step.id, outcome.resultRef);
      output.steps[output.steps.length - 1] = {
        id: step.id,
        op: step.op,
        status: outcome.status,
        issuedAt,
        resultRef: outcome.resultRef,
      };
      output.status = "RUNNING";
      await writeCheckpoint(outputFile, output);
    } catch (error) {
      const code =
        typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
          ? error.code
          : "STEP_FAILED";
      output.steps[output.steps.length - 1] = {
        id: step.id,
        op: step.op,
        status: "BLOCKED",
        issuedAt,
        code,
      };
      output.status = "BLOCKED";
      await writeCheckpoint(outputFile, output);
      return output;
    }
  }
  output.status = "COMPLETED";
  await writeCheckpoint(outputFile, output);
  return output;
};

const argumentsOf = (args) =>
  Object.fromEntries(
    args.reduce(
      (pairs, arg, index) =>
        arg.startsWith("--") ? [...pairs, [arg.slice(2), args[index + 1]]] : pairs,
      [],
    ),
  );
export const main = async (args = process.argv.slice(2)) => {
  const options = argumentsOf(args);
  const configFile = options.config ?? process.env.RISKFLOW_PROVISION_CONFIG;
  const outputFile = options.output;
  if (!configFile || !outputFile)
    throw new TypeError("usage: provision.mjs --config <file> --output <file>");
  const rawConfig = ProvisionConfigV1Schema.parse(JSON.parse(await readFile(configFile, "utf8")));
  const deploymentInput = await loadDeploymentFoundationInputV1({
    configFile: process.env.RISKFLOW_DEPLOYMENT_CONFIG,
    manifestFile: options.manifest ?? process.env.RISKFLOW_RELEASE_MANIFEST,
    role: "provision",
  });
  const passwordRef = deploymentInput.config.database.secretFileRefs.find(
    (entry) => entry.secretId === rawConfig.passwordSecretId,
  );
  if (!passwordRef) throw new TypeError("PROVISION_PASSWORD_SECRET_MISSING");
  const passwords = await (
    await import("../../packages/adapters/dist/deployment/secrets.js")
  ).createDeploymentSecretFileLoaderV1({ expectedUid: process.getuid?.() })([
    ...deploymentInput.config.database.secretFileRefs.filter((entry) =>
      Object.hasOwn(deploymentInput.secrets, entry.secretId),
    ),
    passwordRef,
  ]);
  const foundation = await createDeploymentFoundationV1(deploymentInput);
  try {
    const output = await runProvisionV1({
      config: rawConfig,
      outputFile: resolve(outputFile),
      foundation,
      secrets: passwords,
      bootstrap: args.includes("--bootstrap"),
    });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return output.status === "COMPLETED" ? 0 : 1;
  } finally {
    await foundation.close();
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(
    (code) => {
      process.exitCode = typeof code === "number" ? code : 0;
    },
    (error) => {
      process.stderr.write(`${error.code ?? "PROVISION_FAILED"}\n`);
      process.exitCode = 1;
    },
  );
}
