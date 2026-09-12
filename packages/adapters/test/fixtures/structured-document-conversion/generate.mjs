import { writeFile } from "node:fs/promises";
import { TextEncoder } from "node:util";
import { URL } from "node:url";

import exceljs from "exceljs";
import { strToU8, zipSync } from "fflate";

const { Workbook } = exceljs;

const write = (name, bytes) => writeFile(new URL(name, import.meta.url), bytes);

const docxXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="heading_custom"/></w:pPr><w:r><w:t>工序标题</w:t></w:r></w:p><w:p><w:r><w:t>真实文档段落</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格值</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
await write(
  "sample.docx",
  zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/styles.xml": strToU8(
      `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="heading_custom"><w:name w:val="标题1"/><w:outlineLvl w:val="0"/></w:style></w:styles>`,
    ),
    "word/document.xml": strToU8(docxXml),
  }),
);

const pdfText = "BT\n/F1 12 Tf\n72 120 Td\n(C12 fixture PDF) Tj\nET";
const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const pdfObjects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${byteLength(pdfText)} >>\nstream\n${pdfText}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let pdf = "%PDF-1.4\n";
const offsets = [];
for (const [index, object] of pdfObjects.entries()) {
  offsets.push(byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xrefOffset = byteLength(pdf);
pdf += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Root 1 0 R /Size ${pdfObjects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
await write("sample.pdf", new TextEncoder().encode(pdf));

const workbook = new Workbook();
const sheet = workbook.addWorksheet("指标");
sheet.getCell("A1").value = "指标";
sheet.getCell("B1").value = { formula: "1+1", result: 2 };
sheet.getCell("A2").value = "地表沉降";
sheet.getCell("B2").value = 1.2;
await write("sample.xlsx", new Uint8Array(await workbook.xlsx.writeBuffer()));

await write(
  "sample.csv",
  new TextEncoder().encode('\uFEFF指标,备注,值\n"地表沉降","第一行\n第二行",1.2\n'),
);
