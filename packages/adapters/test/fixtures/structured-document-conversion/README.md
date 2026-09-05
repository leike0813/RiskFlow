# C12 structured-document fixtures

这些文件是 C12 适配器验收使用的最小落盘样例，内容仅包含可公开重建的合成工程文本：

- `sample.docx`：包含中文标题、段落和表格的 OOXML 文档。
- `sample.pdf`：包含一页文本层和坐标的最小 PDF。
- `sample.xlsx`：包含工作表、普通数值和公式缓存值的工作簿。
- `sample.csv`：包含 UTF-8 BOM、引用字段和多行字段的 CSV。

重新生成二进制样例：

```bash
pnpm --filter @riskflow/adapters exec node test/fixtures/structured-document-conversion/generate.mjs
```

样例由 `generate.mjs` 使用仓库已锁定的 `fflate` 与 `exceljs` 生成，不依赖外部资料或网络下载。
