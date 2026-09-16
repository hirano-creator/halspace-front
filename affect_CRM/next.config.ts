import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway（Docker）で動かすため、実行に必要なファイルだけを .next/standalone に集める
  // （Dockerfile の最終ステージはこのディレクトリと static / public だけをコピーする）。
  output: "standalone",
};

export default nextConfig;
