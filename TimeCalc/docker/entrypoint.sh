#!/bin/sh
set -e

# ── Cronモード（将来の定時バッチ用。halspace-api と同じ運用に揃えている） ──
# CRON_COMMAND が設定されたサービスは Web サーバーを起動せず、そのコマンドを実行する。
# CRON_DAILY_UTC（例 "21:00" またはカンマ区切り "21:00,03:00"）があれば常駐ループになり、
# 毎日それらの時刻(UTC)のうち直近のものまで待って実行→次を待つ、を繰り返す。
# CRON_ENABLED=false にすると、ループは止めずに実行だけスキップする（手動の一時停止）。
# migrate は常時起動の Web 側が担うので、Cron サービスでは流さない。
if [ -n "$CRON_COMMAND" ]; then
  if [ -n "$CRON_DAILY_UTC" ]; then
    echo "[cron] daemon mode: daily at ${CRON_DAILY_UTC} UTC / command: $CRON_COMMAND"
    while true; do
      now=$(date -u +%s)
      target=""
      for t in $(echo "$CRON_DAILY_UTC" | tr ',' ' '); do
        cand=$(date -u -d "today ${t}" +%s)
        if [ "$cand" -le "$now" ]; then
          cand=$(date -u -d "tomorrow ${t}" +%s)
        fi
        if [ -z "$target" ] || [ "$cand" -lt "$target" ]; then
          target=$cand
        fi
      done
      echo "[cron] next run at $(date -u -d "@$target" +%Y-%m-%dT%H:%M:%SZ)"
      sleep $((target - now))
      if [ "${CRON_ENABLED:-true}" = "false" ]; then
        echo "[cron] skipped (CRON_ENABLED=false)"
      else
        sh -c "$CRON_COMMAND" || echo "[cron] command failed (exit $?)"
      fi
    done
  fi
  exec sh -c "$CRON_COMMAND"
fi

# ── Webモード ──
# 必須の環境変数が無ければ起動前に止める。SESSION_SECRET の読み取りは初回のログインまで遅延するため、
# 無いまま起動すると「ヘルスチェックは通るのにログインだけ全部 500」という分かりにくい壊れ方をする。
for v in DATABASE_URL SESSION_SECRET; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then
    echo "[web] environment variable $v is not set" >&2
    exit 1
  fi
done

# 未適用のマイグレーションを流してから Next.js（standalone）を起動する。
# 失敗したら起動しない（古いスキーマのまま動いて壊れたデータを作るより止まる方が安全）。
echo "[web] prisma migrate deploy"
prisma migrate deploy

echo "[web] starting next (port ${PORT:-3000})"
exec node server.js
