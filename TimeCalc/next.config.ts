import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// ローカル開発（next dev）でも getCloudflareContext() を使えるようにする。
// これにより src/lib/db.ts が dev 時もローカル D1（.wrangler/state 内の SQLite）へ接続する。
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
