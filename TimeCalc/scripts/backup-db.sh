#!/bin/sh
# ───────────────────────────────────────────────────────────────
# 本番 PostgreSQL の日次バックアップ（pg_dump → Cloudflare R2）
#
# Railway の第2サービス（同じ Dockerfile、CRON_COMMAND="app-backup-db"、CRON_DAILY_UTC="18:00"）が
# docker/entrypoint.sh の Cron モードから毎日これを実行する。手動で1回流すときは
# CRON_DAILY_UTC を外して同じサービスを再デプロイするか、railway run で直接実行する。
#
# 必要な環境変数:
#   DATABASE_URL          バックアップ元（Railway の timecalc-db を参照）
#   R2_ACCOUNT_ID         Cloudflare アカウントID（R2 のエンドポイント <id>.r2.cloudflarestorage.com）
#   R2_BUCKET             保存先バケット名
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   R2 の API トークン（対象バケットの読み書き権限）
# 任意:
#   BACKUP_PREFIX         オブジェクトキーの先頭（既定 timecalc）→ timecalc/2026-09-18.dump
#   BACKUP_KEEP_DAYS      何日分残すか（既定 30）。それより古い日付のオブジェクトを1つ消す（ベストエフォート）
#
# 形式は pg_dump のカスタム形式（圧縮済み・pg_restore で戻す）。復元手順は README の「バックアップと復元」。
# アップロードは curl の AWS SigV4 署名（R2 は S3 互換）。追加のCLIを入れずに済ませている。
# ───────────────────────────────────────────────────────────────
set -eu

for v in DATABASE_URL R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then
    echo "[backup] environment variable $v is not set" >&2
    exit 1
  fi
done

PREFIX="${BACKUP_PREFIX:-timecalc}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
TODAY="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}"
WORK="$(mktemp -d)"
FILE="${WORK}/${PREFIX}-${STAMP}.dump"
trap 'rm -rf "$WORK"' EXIT

echo "[backup] pg_dump start ($STAMP)"
# --no-owner/--no-privileges: 復元先のロール名が違っても戻せるようにする
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$FILE"

# 壊れたアーカイブを保存しないよう、目次が読めることを確認する
pg_restore --list "$FILE" > /dev/null
SIZE="$(wc -c < "$FILE")"
echo "[backup] dump ok (${SIZE} bytes)"

# 1日1本に揃える（同じ日に複数回走ったら上書き）。復元時に探しやすいよう日付だけのキーにする
KEY="${PREFIX}/${TODAY}.dump"
echo "[backup] upload to ${ENDPOINT}/${KEY}"
curl -sS -f -X PUT \
  --aws-sigv4 "aws:amz:auto:s3" \
  --user "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" \
  -H "Content-Type: application/octet-stream" \
  --upload-file "$FILE" \
  "${ENDPOINT}/${KEY}" > /dev/null
echo "[backup] upload ok"

# 保持期間を過ぎた分を消す。毎日1本ずつ消えていけば残るのは KEEP_DAYS 本になる。
# 失敗しても当日のバックアップは成功しているので、警告だけ出して終了コードは 0 のまま
OLD_DAY="$(date -u -d "-${KEEP_DAYS} days" +%Y-%m-%d 2>/dev/null || true)"
if [ -n "$OLD_DAY" ]; then
  OLD_KEY="${PREFIX}/${OLD_DAY}.dump"
  if curl -sS -f -X DELETE \
      --aws-sigv4 "aws:amz:auto:s3" \
      --user "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" \
      "${ENDPOINT}/${OLD_KEY}" > /dev/null 2>&1; then
    echo "[backup] removed old backup ${OLD_KEY}"
  else
    echo "[backup] no old backup to remove (${OLD_KEY})"
  fi
fi

echo "[backup] done"
