import { useEffect, useState } from 'react';
import { APP_TAGLINE, BOARD_STATUSES, BOARD_STATUS_LABELS } from '@tenq/shared';
import { apiGet } from './api/client';
import { Logo } from './components/Logo';

interface Health { ok: boolean; env: string; factories: number }

/**
 * 第2段階の仮の画面。開発環境（画面・API・ローカル D1）がつながっていることを確かめるだけのもの。
 * 第3段階でログイン・ホーム・カード一覧などの実画面に置き換える。
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Health>('/health').then(setHealth).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <header className="app-header">
        <Logo />
      </header>
      <main className="container">
        <h1 className="page-title">開発環境</h1>
        <p className="muted">TENQ — {APP_TAGLINE}。この画面は第2段階の確認用で、第3段階で実画面に置き換えます。</p>

        <section className="panel" aria-live="polite">
          <h2>API の接続</h2>
          {health && <p data-testid="health">接続できました（環境: {health.env}、工場 {health.factories} 件）</p>}
          {error && <p className="error">接続できません: {error}（`npm run dev:api` を起動してください）</p>}
          {!health && !error && <p className="muted">確認中…</p>}
        </section>

        <section className="panel">
          <h2>カードの状態の色</h2>
          <ul className="status-list">
            {BOARD_STATUSES.map((s) => (
              <li key={s} className={`status-chip st-${s}`}>{BOARD_STATUS_LABELS[s].label}</li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
