# ───────────────────────────────────────────────────────────────
# TimeCalc 本番イメージ（Railway / Node.js）
#
# Next.js を standalone 出力（next.config.ts の output: "standalone"）で
# ビルドし、実行に必要なファイルだけを最終ステージへコピーする。
# Prisma は engineType="client"（Rust エンジン不要）なので OpenSSL 等の
# ネイティブ依存は要らない。
#
# 起動時の流れは docker/entrypoint.sh を参照（migrate deploy → node server.js）。
# ───────────────────────────────────────────────────────────────

# ── 1. 依存のインストール ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. ビルド ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate は DATABASE_URL の値を使わない（env() の存在だけ見る）ので
# ビルド時はダミーで足りる
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. 実行 ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 起動時の `prisma migrate deploy` に使う CLI。アプリ本体は engineType="client" で
# エンジン不要だが、マイグレーションを流す schema engine だけはネイティブバイナリで
# OpenSSL を要求するため、openssl を入れておく。
#
# postgresql-client-17（pg_dump / pg_restore）と curl は scripts/backup-db.sh（日次バックアップ）用。
# Debian 標準の postgresql-client は 15 で、pg_dump は自分より新しいサーバーを拒否するため
# PostgreSQL 公式リポジトリ（PGDG）から 17 を入れる（17 なら 15/16/17 のどのサーバーも dump できる）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y --auto-remove gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g prisma@6.19.3

# standalone には node_modules の必要分と server.js が含まれる。
# static と public は standalone に入らないため別途コピーする（Next.js の仕様）。
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

COPY docker/entrypoint.sh /usr/local/bin/app-entrypoint
COPY scripts/backup-db.sh /usr/local/bin/app-backup-db
RUN chmod +x /usr/local/bin/app-entrypoint /usr/local/bin/app-backup-db

EXPOSE 3000
ENTRYPOINT ["app-entrypoint"]
