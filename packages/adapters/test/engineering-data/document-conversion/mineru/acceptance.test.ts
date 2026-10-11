import { describe, expect, it } from "vitest";
import { normalizeOfficialMineruLayout } from "../../../../src/engineering-data/document-conversion/mineru/official-normalization.js";
import { MineruAcceptanceSampleSchema, verifyMineruAcceptanceSample } from "./acceptance.js";
import { makeConfig, makeRequest } from "./fixture.js";

const sample = MineruAcceptanceSampleSchema.parse({
  id: "scan",
  inputPath: "synthetic/scan.pdf",
  inputKind: "ocr-layout",
  mediaType: "application/pdf",
  expectedPageCount: 1,
  keyFields: ["GEO-001", "完整岩体", "DK12+300"],
  recordChecks: [{ fields: ["GEO-001", "完整岩体", "DK12+300"], expectedPageNumber: 1 }],
});
const document = (rows: string[]) =>
  normalizeOfficialMineruLayout(
    {
      _version_name: "3.4.4",
      _backend: "hybrid",
      pdf_info: [
        {
          page_idx: 0,
          page_size: [300, 200],
          para_blocks: rows.map((text, index) => ({
            type: "text",
            index,
            bbox: [10, 10 + index * 20, 290, 25 + index * 20],
            lines: [{ spans: [{ type: "text", content: text }] }],
          })),
        },
      ],
    },
    makeRequest(),
    makeConfig("official-v4"),
    { pageCount: 1 },
  ).parsedDocument;

describe("MinerU source checklist acceptance", () => {
  it("checks associated source fields and page while retaining recognized text", () => {
    const value = document(["GEO - 001 | 完整岩体 | DK12 + 300"]);
    expect(verifyMineruAcceptanceSample(value, sample)).toEqual({
      keyFields: 3,
      records: 1,
      pages: 1,
    });
    expect(value.blocks[0]?.text).toContain("GEO - 001");
  });
  it.each(["title-only", "wrong-record", "wrong-page"])("rejects %s", (scenario) => {
    const value = document(
      scenario === "title-only"
        ? ["工程地质报告"]
        : scenario === "wrong-record"
          ? ["GEO-001 | 中硬岩 | DK12+320", "GEO-002 | 完整岩体 | DK12+300"]
          : ["GEO-001 | 完整岩体 | DK12+300"],
    );
    const check =
      scenario === "wrong-page"
        ? { ...sample, recordChecks: [{ ...sample.recordChecks[0]!, expectedPageNumber: 2 }] }
        : sample;
    expect(() => verifyMineruAcceptanceSample(value, check)).toThrow(/MINERU_ACCEPTANCE/u);
  });
  it("checks table fields within a row and keeps the table's source page", () => {
    const value = normalizeOfficialMineruLayout(
      {
        _version_name: "3.4.4",
        _backend: "hybrid",
        pdf_info: [
          {
            page_idx: 0,
            page_size: [300, 200],
            para_blocks: [
              {
                type: "table",
                index: 0,
                bbox: [10, 10, 290, 190],
                blocks: [
                  {
                    type: "table_body",
                    index: 1,
                    bbox: [10, 10, 290, 190],
                    lines: [
                      {
                        spans: [
                          {
                            type: "table",
                            html: "<table><tr><td>GEO-001</td><td>完整岩体</td><td>DK12+300</td></tr><tr><td>GEO-002</td><td>中硬岩</td><td>DK12+320</td></tr></table>",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      makeRequest(),
      makeConfig("official-v4"),
      { pageCount: 1 },
    ).parsedDocument;
    expect(verifyMineruAcceptanceSample(value, sample).records).toBe(1);
    expect(() =>
      verifyMineruAcceptanceSample(value, {
        ...sample,
        recordChecks: [{ fields: ["GEO-001", "中硬岩", "DK12+320"], expectedPageNumber: 1 }],
      }),
    ).toThrow(/MINERU_ACCEPTANCE_RECORD_OR_PAGE/u);
  });
});
