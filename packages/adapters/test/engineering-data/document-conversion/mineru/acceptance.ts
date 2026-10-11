import type { ParsedDocumentV1 } from "@riskflow/core/engineering-data/document-conversion";
import { z } from "@riskflow/core/model";

const field = z.string().trim().min(1).max(200);
const path = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part !== ".." && part !== ""),
  );
const page = z.number().int().positive().max(10_000).nullable();
export const MineruAcceptanceSampleSchema = z.strictObject({
  id: field,
  inputPath: path,
  inputKind: z.enum(["text-pdf", "ocr-layout", "docx"]),
  mediaType: z.enum([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  expectedPageCount: page,
  keyFields: z.array(field).min(1).max(128),
  recordChecks: z
    .array(
      z.strictObject({
        fields: z.array(field).min(1).max(16),
        expectedPageNumber: page,
      }),
    )
    .min(1)
    .max(128),
});
export const MineruAcceptanceSuiteSchema = z
  .object({
    schemaVersion: z.literal("1"),
    versionId: z.literal("2"),
    label: z.literal("合成样本，待甲方复核"),
    sourcePack: path,
    cases: path,
    samples: z.array(MineruAcceptanceSampleSchema).length(5),
  })
  .superRefine((suite, context) => {
    const kinds = suite.samples.map((sample) => `${sample.inputKind}:${sample.mediaType}`);
    if (new Set(kinds).size !== 5 || new Set(suite.samples.map(({ id }) => id)).size !== 5)
      context.addIssue({ code: "custom", message: "suite must cover five distinct formats" });
    for (const sample of suite.samples) {
      const valid =
        sample.inputKind === "docx"
          ? sample.mediaType ===
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
            sample.expectedPageCount === null
          : sample.inputKind === "text-pdf"
            ? sample.mediaType === "application/pdf" && sample.expectedPageCount !== null
            : sample.mediaType !==
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
              sample.expectedPageCount !== null;
      if (!valid) context.addIssue({ code: "custom", message: "sample format/page mismatch" });
    }
  });
export type MineruAcceptanceSample = z.infer<typeof MineruAcceptanceSampleSchema>;

const comparable = (text: string): string => text.replace(/\s/gu, "").toLocaleLowerCase();

/** 同一块或同一表格行证明字段关联；分散在其它记录中的值不能补足当前记录。 */
export const verifyMineruAcceptanceSample = (
  document: ParsedDocumentV1,
  sample: MineruAcceptanceSample,
): { keyFields: number; records: number; pages: number | null } => {
  const pages = document.pageExtents?.length ?? null;
  if (pages !== sample.expectedPageCount) throw new Error("MINERU_ACCEPTANCE_PAGE_COUNT");
  const groups = new Map<string, { text: string; pageNumber: number | null }>();
  const tablePages = new Map(
    document.blocks
      .filter(({ kind }) => kind === "table")
      .map((block) => [
        block.tableId,
        block.coordinate?.kind === "page" ? block.coordinate.pageNumber : null,
      ]),
  );
  for (const block of document.blocks) {
    if (block.text.trim() === "") continue;
    const key = block.kind === "cell" ? `${block.tableId}:${block.row}` : block.blockId;
    const pageNumber =
      block.coordinate?.kind === "page"
        ? block.coordinate.pageNumber
        : block.kind === "cell"
          ? (tablePages.get(block.tableId) ?? null)
          : null;
    const previous = groups.get(key);
    groups.set(key, { text: `${previous?.text ?? ""}\n${block.text}`, pageNumber });
  }
  const text = comparable(document.blocks.map((block) => block.text).join("\n"));
  if (sample.keyFields.some((value) => !text.includes(comparable(value))))
    throw new Error("MINERU_ACCEPTANCE_KEY_FIELDS");
  for (const check of sample.recordChecks) {
    if (
      ![...groups.values()].some(
        (group) =>
          group.pageNumber === check.expectedPageNumber &&
          check.fields.every((value) => comparable(group.text).includes(comparable(value))),
      )
    )
      throw new Error("MINERU_ACCEPTANCE_RECORD_OR_PAGE");
  }
  return { keyFields: sample.keyFields.length, records: sample.recordChecks.length, pages };
};
