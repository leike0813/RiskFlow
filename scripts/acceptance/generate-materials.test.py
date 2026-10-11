import importlib.util
import tempfile
import unittest
from pathlib import Path

import fitz


SCRIPT = Path(__file__).with_name("generate-materials.py")
SPEC = importlib.util.spec_from_file_location("generate_materials", SCRIPT)
generate_materials = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generate_materials)


class PdfProjectionTests(unittest.TestCase):
    def test_short_row_is_written_once_on_one_page(self):
        document = fitz.open()
        try:
            pages = generate_materials._text_page(document, "title", ["ID", "value"], [["ROW-1", "short"]])
            self.assertEqual(pages, [1])
            self.assertEqual(document.page_count, 1)
            self.assertEqual(document[0].get_text().count("ROW-1"), 1)
        finally:
            document.close()

    def test_long_list_crosses_pages_without_losing_or_repeating_rows(self):
        rows = [[f"ROW-{index:03}", f"value-{index:03}"] for index in range(40)]
        document = fitz.open()
        try:
            pages = generate_materials._text_page(document, "title", ["ID", "value"], rows)
            self.assertGreater(document.page_count, 1)
            self.assertEqual(len(pages), len(rows))
            for page_number, (row, expected_page) in enumerate(zip(rows, pages, strict=True), start=1):
                matching_pages = [page.number + 1 for page in document if row[0] in page.get_text()]
                self.assertEqual(matching_pages, [expected_page])
                self.assertLessEqual(expected_page, document.page_count)
        finally:
            document.close()

    def test_row_too_tall_for_a_page_fails_explicitly(self):
        document = fitz.open()
        try:
            with self.assertRaisesRegex(ValueError, "cannot fit on one page"):
                generate_materials._text_page(
                    document, "title", ["ID"], [["ROW-TOO-LONG", "x" * 10000]]
                )
            self.assertEqual(document.page_count, 1)
        finally:
            document.close()

    def test_scan_pdf_is_rendered_without_a_text_layer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scan.pdf"
            generate_materials.write_scan_pdf(path, "title", ["ID"], [["ROW-1"]])
            with fitz.open(path) as document:
                self.assertTrue(all(not page.get_text().strip() for page in document))
                self.assertTrue(all(page.get_images() for page in document))
            self.assertEqual([item.name for item in Path(directory).iterdir()], ["scan.pdf"])


if __name__ == "__main__":
    unittest.main()
