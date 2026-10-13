import { z } from "zod";

import { IdentifierSchema } from "@riskflow/contracts/common";
import { AuthorizationContextV1Schema, WorkflowRunRefV1Schema } from "@riskflow/contracts/ports";

export const CHECKPOINT_RUNTIME_CONTEXT_KEY_V1 = "riskflowCheckpointContextV1" as const;

export const CheckpointRuntimeContextV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    threadId: IdentifierSchema,
    runRef: WorkflowRunRefV1Schema,
    authorization: AuthorizationContextV1Schema,
    invocationId: IdentifierSchema,
  })
  .superRefine((context, issue) => {
    if (
      context.authorization.projectId !== context.projectId ||
      context.authorization.actorId !== context.actorId
    ) {
      issue.addIssue({ code: "custom", path: ["authorization"], message: "context mismatch" });
    }
  });

export type CheckpointRuntimeContextV1 = z.infer<typeof CheckpointRuntimeContextV1Schema>;
