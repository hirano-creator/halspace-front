// OpenNext の Cloudflare 向け設定。
// 既定構成（Node.js ランタイムの Worker + 静的アセット）で十分なため、
// まずはデフォルトのまま利用する。キャッシュ等を調整する場合はここに追記する。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
