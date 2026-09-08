import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// ローカル開発（next dev）でも getCloudflareContext() を使えるようにする。
// これがないと開発サーバーから D1 バインディングに一切アクセスできない。
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
