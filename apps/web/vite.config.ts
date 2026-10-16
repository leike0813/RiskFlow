import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pdf-original-resources",
      async generateBundle() {
        const pdfRoot = new URL("./", import.meta.resolve("pdfjs-dist/package.json"));
        for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
          const directory = new URL(`${folder}/`, pdfRoot);
          for (const file of await readdir(directory)) {
            this.emitFile({
              type: "asset",
              fileName: `pdfjs/${folder}/${file}`,
              source: await readFile(fileURLToPath(new URL(file, directory))),
            });
          }
        }
      },
    },
  ],
});
