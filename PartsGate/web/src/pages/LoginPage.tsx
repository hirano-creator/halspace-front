import { useState, type FormEvent } from 'react';
import { APP_KEY } from '@partsgate/shared';
import { useAuth } from '../auth/AuthContext';
import { markStandalone, saveSpaceSession } from '../auth/session';
import { SpaceLoginError, spaceLogin, spaceResend, spaceVerify, type SpaceLoginResult } from '../auth/spaceLogin';
import { Alert, Button, Field, errorMessage } from '../components/ui';

/**
 * 開発用の簡易ログイン。vite の開発サーバー（と VITE_DEV_LOGIN=1 のビルド）でだけ表示する。
 * 本番ビルドでは条件が false に置き換わり、コードごと含まれない。
 */
const DEV_LOGIN = import.meta.env.DEV || import.meta.env.VITE_DEV_LOGIN === '1';
const DEV_USERS = DEV_LOGIN
  ? [
      { hs: 900001, name: '管理 太郎', role: '会社A 管理者・運営' },
      { hs: 900002, name: '出荷場PC1', role: '会社A 一般' },
      { hs: 900101, name: '他社 管理者', role: '会社B 管理者' },
      { hs: 900102, name: '他社 一般', role: '会社B 一般' },
    ]
  : [];

export function LoginPage() {
  const { reload, error: meError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [mfa, setMfa] = useState<{ challenge: string; maskedEmail: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function finish(data: SpaceLoginResult) {
    const u = data.user;
    if (!(u.apps_enabled ?? []).includes(APP_KEY)) {
      throw new Error('このアカウントでは PARTS GATE を利用できません。管理者にお問い合わせください。');
    }
    saveSpaceSession(data.token, {
      id: u.id, name: u.name, email: u.email, role: u.role, company: u.company_name, company_id: u.company_id,
      apps: u.apps_enabled ?? [], token: data.token,
    });
    // PARTS GATE のログイン画面から入ったタブは、メニューに「ログアウト」を出す
    markStandalone();
    await reload();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mfa) {
        await finish(await spaceVerify(email, mfa.challenge, code.trim(), remember));
      } else {
        const step = await spaceLogin(email.trim(), password);
        if (step.mode === 'mfa') { setMfa({ challenge: step.challenge, maskedEmail: step.maskedEmail }); setCode(''); }
        else await finish(step.data);
      }
    } catch (err) {
      if (err instanceof SpaceLoginError && err.restart) setMfa(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function devLogin(hs: number, name: string) {
    if (!DEV_LOGIN) return;
    saveSpaceSession(`dev-${hs}`, { id: hs, name, email: '', role: 'general', company: null, company_id: null, apps: [APP_KEY], token: `dev-${hs}` });
    markStandalone();
    setBusy(true);
    try { await reload(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-md p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <img src="./favicon.svg" alt="" className="h-11 w-11" />
          <div>
            <p className="text-xl font-extrabold tracking-[0.14em]">PARTS GATE</p>
            <p className="text-xs text-slate-500">バーコード部品照合・出荷確認</p>
          </div>
        </div>
        <h1 className="mb-1 text-lg font-bold">{mfa ? '確認コードの入力' : 'ログイン'}</h1>
        {!mfa && <p className="mb-4 text-sm text-slate-500">Space.app のアカウントでログインします。</p>}
        {mfa && <p className="mb-4 text-sm text-slate-500">確認コードを <strong>{mfa.maskedEmail}</strong> にお送りしました。メールに書かれた 6 桁の数字を入力してください。</p>}
        <div className="mb-3 flex flex-col gap-2">
          {(error ?? meError) && <Alert kind="error">{error ?? meError}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
        </div>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
          {!mfa ? (
            <>
              <Field label="メールアドレス">
                <input className="input" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="パスワード">
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            </>
          ) : (
            <Field label="確認コード">
              <input className="input mono text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </Field>
          )}
          {mfa && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>この端末を信頼する（次回から確認コードを省く）<span className="block text-xs text-slate-500">共用のパソコンでは外してください。</span></span>
            </label>
          )}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || (!mfa && (!email || !password)) || (!!mfa && code.length !== 6)}>
            {busy ? '確認しています…' : mfa ? '確認してログイン' : 'ログイン'}
          </Button>
        </form>

        {mfa && (
          <div className="mt-3 flex justify-between text-sm">
            <button type="button" className="text-blue-700 underline" disabled={busy} onClick={async () => {
              setError(null);
              try { await spaceResend(mfa.challenge); setNotice('確認コードを再送しました。'); } catch (err) { setError(errorMessage(err)); }
            }}>コードを再送する</button>
            <button type="button" className="text-blue-700 underline" onClick={() => { setMfa(null); setError(null); setNotice(null); }}>メールアドレスの入力に戻る</button>
          </div>
        )}

        {DEV_LOGIN && (
          <div className="mt-6 grid grid-cols-2 gap-2 border-t border-dashed border-slate-300 pt-4">
            <p className="col-span-2 text-xs text-slate-500">開発用ログイン（ローカルのダミーデータ）</p>
            {DEV_USERS.map((u) => (
              <Button key={u.hs} onClick={() => void devLogin(u.hs, u.name)} disabled={busy} className="flex-col !items-start !gap-0 py-2 text-left">
                <span>{u.name}</span><small className="text-xs font-normal text-slate-500">{u.role}</small>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
