import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ビルド成果物。ここを読ませると ESLint がメモリ不足で落ちる
    ".open-next/**",
    ".wrangler/**",
    // 生成物（prisma generate / wrangler types で作り直せる）
    "src/generated/**",
    "worker-configuration.d.ts",
  ]),
]);

export default eslintConfig;
