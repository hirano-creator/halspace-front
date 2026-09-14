import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma の生成物（大きいので lint 対象にするとヒープ不足で落ちる）
    "src/generated/**",
    // 旧構成（Cloudflare Workers / Netlify）のビルド成果物が残っていても拾わない
    ".open-next/**",
    ".netlify/**",
    ".wrangler/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
