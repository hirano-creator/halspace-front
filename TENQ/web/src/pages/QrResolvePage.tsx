import { useEffect, useState } from 'react';
import { ApiError, apiGet } from '../api/client';
import { Alert, Button, Loading } from '../components/ui';
import { navigate } from '../router';

/**
 * QR を読んだとき（#/q/<トークン>）。ログイン済みの前提で App から呼ばれる。
 * 未ログインの場合は App がトークンを覚えてログイン画面へ送り、ログイン後にここへ戻す。
 */
export function QrResolvePage({ token }: { token: string }) {
  const [error, setError] = useState<{ status: number; message: string; equipmentId?: string } | null>(null);

  useEffect(() => {
    apiGet<{ equipmentId: string }>(`/qr/${encodeURIComponent(token)}`)
      .then((r) => navigate(`/inspect/${r.equipmentId}`, true))
      .catch((e: unknown) => setError(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 0, message: 'QR コードを確認できませんでした。' }));
  }, [token]);

  if (!error) return <Loading label="QR コードの設備を確認しています…" />;
  return (
    <div className="qr-error">
      <Alert kind={error.status === 410 ? 'warn' : 'error'}>{error.message}</Alert>
      <div className="button-row"><Button onClick={() => navigate('/', true)}>ホームへ</Button></div>
    </div>
  );
}
