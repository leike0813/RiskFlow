import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      ".scratch/**",
      ".agents/**",
      ".claude/**",
      "demo/**",
      "openspec/**",
      "references/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        console: "readonly",
        module: "readonly",
        process: "readonly",
        AbortController: "readonly",
        Buffer: "readonly",
        structuredClone: "readonly",
        AbortSignal: "readonly",
      },
      sourceType: "module",
    },
  },
);
