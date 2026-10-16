import { describe, expect, it } from "vitest";

import { normalizeOfficialMineruLayout } from "../../../../src/engineering-data/document-conversion/mineru/official-normalization.js";
import { MineruConfigV1Schema } from "../../../../src/engineering-data/document-conversion/mineru/schema.js";
import { makeConfig, makeRequest, rawRef } from "./fixture.js";

type FixtureSpan = {
  type: string;
  content?: string;
  html?: string;
  bbox?: [number, number, number, number];
  cross_page?: boolean;
  [key: string]: unknown;
};
type FixtureBlock = {
  type: string;
  index: number;
  bbox?: [number, number, number, number];
  lines?: { spans: FixtureSpan[] }[];
  blocks?: FixtureBlock[];
  lines_deleted?: boolean;
  [key: string]: unknown;
};
type LayoutFixture = {
  _version_name: string;
  _backend: string;
  pdf_info: {
    page_idx: number;
    page_size?: [number, number];
    para_blocks: FixtureBlock[];
    preproc_blocks?: FixtureBlock[];
  }[];
};

const layout = (): LayoutFixture => ({
  _version_name: "3.4.4",
  _backend: "hybrid",
  pdf_info: [
    {
      page_idx: 0,
      page_size: [300, 200],
      para_blocks: [
        {
          type: "text",
          index: 0,
          bbox: [30, 20, 150, 100],
          is_numbered_style: false,
          lines: [{ spans: [{ type: "text", content: "工程资料", style: ["bold"] }] }],
        },
        {
          type: "table",
          index: 1,
          bbox: [30, 110, 270, 190],
          blocks: [
            {
              type: "table_body",
              index: 2,
              bbox: [30, 110, 270, 190],
              lines: [
                {
                  spans: [
                    {
                      type: "table",
                      html: '<table><tr><td colspan="2">指标</td></tr><tr><td>沉降</td><td>1.2</td></tr></table>',
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
});

describe("official MinerU layout mapping", () => {
  const config = MineruConfigV1Schema.parse(makeConfig("official-v4"));
  const source = {
    pageCount: 1,
    pageExtents: [
      { pageNumber: 1, width: 300, height: 200, coordinateSystem: "point-top-left" as const },
    ],
  };

  it("preserves absolute PDF geometry, logical table spans and unknown confidence", () => {
    const result = normalizeOfficialMineruLayout(layout(), makeRequest(), config, source);
    expect(result.parsedDocument.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "工程资料",
          coordinate: { kind: "page", pageNumber: 1, x: 30, y: 20, width: 120, height: 80 },
        }),
        expect.objectContaining({ text: "指标", columnSpan: 2 }),
      ]),
    );
    expect(result.parsedDocument.blocks.every((block) => block.confidence === undefined)).toBe(
      true,
    );
    expect(result.diagnostic).toMatchObject({
      sourceFormat: "official-layout-3.4.4",
      modelRevision: null,
      serviceBuild: null,
      normalization: { tier: null },
    });
  });

  it("preserves chart annotations and geometry without reading image payloads as text", () => {
    const value = layout();
    const body: FixtureBlock = {
      type: "chart_body",
      index: 0,
      bbox: [30, 20, 270, 100],
      lines: [{ spans: [{ type: "chart", image_path: "images/chart-only.png" }] }],
    };
    value.pdf_info[0]!.para_blocks.push({
      type: "chart",
      index: 2,
      bbox: [30, 20, 270, 180],
      blocks: [
        body,
        {
          type: "chart_caption",
          index: 1,
          bbox: [30, 110, 270, 140],
          lines: [{ spans: [{ type: "text", content: "监测曲线" }] }],
        },
        {
          type: "chart_footnote",
          index: 2,
          bbox: [30, 150, 270, 180],
          lines: [{ spans: [{ type: "text", content: "测点说明" }] }],
        },
      ],
    });
    const result = normalizeOfficialMineruLayout(value, makeRequest(), config, source);
    expect(result.parsedDocument.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "caption",
          text: "监测曲线",
          coordinate: {
            kind: "page",
            pageNumber: 1,
            x: 30,
            y: expect.closeTo(110, 8),
            width: 240,
            height: expect.closeTo(30, 8),
          },
        }),
        expect.objectContaining({ kind: "caption", text: "测点说明" }),
      ]),
    );
    expect(result.parsedDocument.blocks.some((block) => block.text.includes("chart-only"))).toBe(
      false,
    );
    body.lines![0]!.spans = [{ type: "text", content: "unrecognized chart data" }];
    expect(() => normalizeOfficialMineruLayout(value, makeRequest(), config, source)).toThrow(
      expect.objectContaining({ code: "MINERU_PROTOCOL_INVALID" }),
    );
  });

  it("retains mixed and image-only table cells without inventing text", () => {
    const value = layout();
    value.pdf_info[0]!.para_blocks[1]!.blocks![0]!.lines![0]!.spans[0]!.html =
      '<table><tr><td>测点<img src="symbol.png"/></td><td><img src="symbol.png"/></td></tr></table>';
    const image = {
      kind: "unrecognized-image" as const,
      rawResponseArtifactRef: rawRef("official-result-zip"),
      packageEntryPath: "images/symbol.png",
    };
    const result = normalizeOfficialMineruLayout(value, makeRequest(), config, source, () => image);
    const cells = result.parsedDocument.blocks.filter((block) => block.kind === "cell");
    expect(cells).toEqual([
      expect.objectContaining({ text: "测点", row: 1, column: 1, unrecognizedImages: [image] }),
      expect.objectContaining({
        text: "",
        value: null,
        row: 1,
        column: 2,
        unrecognizedImages: [image],
      }),
    ]);
    expect(result.parsedDocument.blocks.some((block) => block.text.includes("symbol.png"))).toBe(
      false,
    );
    expect(() => normalizeOfficialMineruLayout(value, makeRequest(), config, source)).toThrow();
    for (const markup of ['<img src="symbol.png" alt="x"/>', '<img src="symbol.png"></img>']) {
      value.pdf_info[0]!.para_blocks[1]!.blocks![0]!.lines![0]!.spans[0]!.html = `<table><tr><td>${markup}</td></tr></table>`;
      expect(() =>
        normalizeOfficialMineruLayout(value, makeRequest(), config, source, () => image),
      ).toThrow();
    }
  });

  it("scales rendered image geometry into actual source pixels", () => {
    const request = makeRequest();
    const result = normalizeOfficialMineruLayout(
      layout(),
      { ...request, command: { ...request.command, mediaType: "image/png" } },
      config,
      {
        pageCount: 1,
        pageExtents: [
          { pageNumber: 1, width: 600, height: 400, coordinateSystem: "pixel-top-left" },
        ],
      },
    );
    expect(result.parsedDocument.blocks[0]?.coordinate).toEqual({
      kind: "page",
      pageNumber: 1,
      x: 60,
      y: 40,
      width: 240,
      height: 160,
    });
  });

  it("uses only preprocessed page blocks when paragraph blocks cross pages", () => {
    const value = layout();
    const firstPage = value.pdf_info[0]!;
    const originalFirst = firstPage.para_blocks[0]!;
    firstPage.preproc_blocks = [
      {
        ...originalFirst,
        lines: [{ spans: [{ type: "text", content: "第一页完整原页资料正文内容" }] }],
      },
    ];
    firstPage.para_blocks = [
      {
        ...originalFirst,
        lines: [
          {
            spans: [
              { type: "text", content: "第一页完整原页资料正文内容" },
              { type: "text", content: "第二页完整原页资料正文内容", cross_page: true },
            ],
          },
        ],
      },
    ];
    value.pdf_info.push({
      page_idx: 1,
      page_size: [300, 200],
      preproc_blocks: [
        {
          type: "text",
          index: 0,
          bbox: [30, 40, 150, 80],
          lines: [{ spans: [{ type: "text", content: "第二页完整原页资料正文内容" }] }],
        },
      ],
      para_blocks: [
        {
          type: "text",
          index: 0,
          bbox: [30, 40, 150, 80],
          lines: [],
          lines_deleted: true,
        },
      ],
    });

    const result = normalizeOfficialMineruLayout(value, makeRequest(), config, {
      pageCount: 2,
      pageExtents: [
        { pageNumber: 1, width: 300, height: 200, coordinateSystem: "point-top-left" },
        { pageNumber: 2, width: 300, height: 200, coordinateSystem: "point-top-left" },
      ],
    });
    const originalPageText = result.parsedDocument.blocks.filter((block) =>
      ["第一页完整原页资料正文内容", "第二页完整原页资料正文内容"].includes(block.text),
    );
    expect(originalPageText).toEqual([
      expect.objectContaining({
        text: "第一页完整原页资料正文内容",
        coordinate: { kind: "page", pageNumber: 1, x: 30, y: 20, width: 120, height: 80 },
      }),
      expect.objectContaining({
        text: "第二页完整原页资料正文内容",
        coordinate: { kind: "page", pageNumber: 2, x: 30, y: 40, width: 120, height: 40 },
      }),
    ]);
    expect(result.diagnostic).toMatchObject({
      pageBlockSourceCounts: { preprocPages: 2, paraPages: 0, noBodyPages: 0 },
    });
  });

  it("does not fill an explicitly empty preprocessed page from paragraph blocks", () => {
    const value = layout();
    value.pdf_info[0]!.preproc_blocks = [];
    expect(() => normalizeOfficialMineruLayout(value, makeRequest(), config, source)).toThrow(
      expect.objectContaining({ code: "MINERU_QUALITY_REJECTED" }),
    );
  });

  it.each(["cross-page", "lines-deleted"])(
    "rejects %s paragraph markers when the page has no original blocks",
    (marker) => {
      const value = layout();
      if (marker === "cross-page")
        value.pdf_info[0]!.para_blocks[0]!.lines![0]!.spans[0]!.cross_page = true;
      else value.pdf_info[0]!.para_blocks[0]!.lines_deleted = true;
      expect(() => normalizeOfficialMineruLayout(value, makeRequest(), config, source)).toThrow(
        expect.objectContaining({ code: "MINERU_PROTOCOL_INVALID" }),
      );
    },
  );

  it("rejects cross-page markers inside nested source blocks", () => {
    const value = layout();
    value.pdf_info[0]!.para_blocks = [
      {
        type: "table",
        index: 0,
        bbox: [30, 20, 270, 100],
        blocks: [
          {
            type: "table_body",
            index: 0,
            bbox: [30, 20, 270, 100],
            lines: [
              {
                spans: [
                  {
                    type: "table",
                    html: "<table><tr><td>资料</td></tr></table>",
                    cross_page: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(() => normalizeOfficialMineruLayout(value, makeRequest(), config, source)).toThrow(
      expect.objectContaining({ code: "MINERU_PROTOCOL_INVALID" }),
    );
  });

  it("preserves equation LaTeX and its page geometry", () => {
    const value = layout();
    value.pdf_info[0]!.para_blocks = [
      {
        type: "interline_equation",
        index: 0,
        bbox: [30, 20, 150, 60],
        lines: [{ spans: [{ type: "interline_equation", content: "\\frac{a}{b}" }] }],
      },
      {
        type: "text",
        index: 1,
        bbox: [30, 70, 270, 100],
        lines: [
          {
            spans: [
              { type: "text", content: "行内" },
              { type: "inline_equation", content: "x_{raw}" },
              { type: "interline_equation", content: "\\alpha" },
              { type: "text", content: "公式" },
            ],
          },
        ],
      },
    ];
    const result = normalizeOfficialMineruLayout(value, makeRequest(), config, source);
    expect(result.parsedDocument.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "\\frac{a}{b}",
          coordinate: { kind: "page", pageNumber: 1, x: 30, y: 20, width: 120, height: 40 },
        }),
        expect.objectContaining({ text: "行内x_{raw}\\alpha公式" }),
      ]),
    );
  });

  it.each([
    "unknown-version",
    "unknown-type",
    "missing-content",
    "bad-index",
    "bad-box",
    "partial-pages",
  ])("rejects invalid official evidence: %s", (scenario) => {
    const value = layout();
    if (scenario === "unknown-version") value._version_name = "4.0.12";
    if (scenario === "unknown-type") value.pdf_info[0]!.para_blocks[0]!.type = "unknown";
    if (scenario === "missing-content")
      delete value.pdf_info[0]!.para_blocks[0]!.lines![0]!.spans[0]!.content;
    if (scenario === "bad-index") value.pdf_info[0]!.para_blocks[0]!.index = -1;
    if (scenario === "bad-box") value.pdf_info[0]!.para_blocks[0]!.bbox = [-1, 0, 20, 10];
    const expectedSource = scenario === "partial-pages" ? { ...source, pageCount: 2 } : source;
    expect(() =>
      normalizeOfficialMineruLayout(value, makeRequest(), config, expectedSource),
    ).toThrow();
  });
});
