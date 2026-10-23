import { useState, type FormEvent } from 'react';
import { APP_TAGLINE } from '@tenq/shared';
import { apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { markStandalone, saveDeviceToken, saveSpaceSession } from '../auth/session';
import { SpaceLoginError, spaceLogin, spaceResend, spaceVerify, type SpaceLoginResult } from '../auth/spaceLogin';
import { Logo } from '../components/Logo';
import { Alert, Button, Field, errorMessage } from '../components/ui';

/** スマホ（指で操作する端末）では既定でログインを記憶する。PC は既定で記憶しない（共用 PC 対策） */
const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * 開発用の簡易ログイン。vite の開発サーバーと、実機確認用のプレビュー（VITE_DEV_LOGIN=1 でビルド）でだけ表示する。
 * 本番ビルドでは条件が false に置き換わり、コードごと含まれない（npm run check:size で確認）。
 */
const DEV_LOGIN = import.meta.env.DEV || import.meta.env.VITE_DEV_LOGIN === '1';
const DEV_USERS = DEV_LOGIN
  ? [
      { hs: 900001, name: '山本 健', role: '一般社員' },
      { hs: 900002, name: '佐藤 美咲', role: '設備担当者' },
      { hs: 900003, name: '鈴木 大地', role: '設備担当者' },
      { hs: 900004, name: '中村 誠', role: '工場長' },
      { hs: 900005, name: '高橋 遥', role: 'システム管理者' },
      { hs: 900006, name: '田中 翔', role: '一般社員（第2工場）' },
    ]
  : [];

export function LoginPage() {
  const { reload } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(isTouch);
  const [mfa, setMfa] = useState<{ challenge: string; maskedEmail: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function finish(data: SpaceLoginResult) {
    const u = data.user;
    if (!(u.apps_enabled ?? []).includes('tenq')) {
      throw new Error('このアカウントでは TENQ を利用できません。管理者にお問い合わせください。');
    }
    saveSpaceSession(data.token, {
      id: u.id, name: u.name, email: u.email, role: u.role, company: u.company_name, company_id: u.company_id,
      apps: u.apps_enabled ?? [], token: data.token,
    });
    // TENQ のログイン画面から入ったタブは、メニューに「アプリ選択に戻る」ではなく「ログアウト」を出す
    markStandalone();
    await afterLogin();
  }

  async function afterLogin() {
    if (remember) {
      // 失敗してもログイン自体は続ける（記憶されないだけ）
      try { saveDeviceToken((await apiSend<{ token: string }>('POST', '/auth/device', {})).token); } catch { /* 何もしない */ }
    }
    // 画面の移動（QR の設備へ戻るなど）は App 側で行う
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
      if (err instanceof SpaceLoginError && err.restart) { setMfa(null); }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function devLogin(hs: number, name: string) {
    if (!DEV_LOGIN) return;
    saveSpaceSession(`dev-${hs}`, { id: hs, name, email: '', role: 'general', company: null, company_id: null, apps: ['tenq'], token: `dev-${hs}` });
    setBusy(true);
    try { await afterLogin(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand"><Logo size={40} tagline={false} /><p>{APP_TAGLINE}</p></div>
        <h1 className="login-title">{mfa ? '確認コードの入力' : 'ログイン'}</h1>
        {!mfa && <p className="login-lead">Space.app のアカウントでログインします。</p>}
        {mfa && <p className="login-lead">確認コードを <strong>{mfa.maskedEmail}</strong> にお送りしました。メールに書かれた6桁の数字を入力してください。</p>}
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}

        <form onSubmit={onSubmit} noValidate>
          {!mfa ? (
            <>
              <Field label="メールアドレス">
                <input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="パスワード">
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            </>
          ) : (
            <Field label="確認コード">
              <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </Field>
          )}
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>この端末にログインを記憶する（30日）<small>個人のスマホ向けです。共用のパソコンでは外してください。</small></span>
          </label>
          <Button type="submit" variant="primary" className="block" disabled={busy || (!mfa && (!email || !password)) || (!!mfa && code.length !== 6)}>
            {busy ? '確認しています…' : mfa ? '確認してログイン' : 'ログイン'}
          </Button>
        </form>

        {mfa && (
          <div className="login-links">
            <button type="button" className="link" disabled={busy} onClick={async () => {
              setError(null);
              try { await spaceResend(mfa.challenge); setNotice('確認コードを再送しました。'); } catch (err) { setError(errorMessage(err)); }
            }}>コードを再送する</button>
            <button type="button" className="link" onClick={() => { setMfa(null); setError(null); setNotice(null); }}>メールアドレスの入力に戻る</button>
          </div>
        )}

        {DEV_LOGIN && (
          <div className="dev-login">
            <p>開発用ログイン（ローカルのダミーデータ）</p>
            {DEV_USERS.map((u) => (
              <Button key={u.hs} onClick={() => void devLogin(u.hs, u.name)} disabled={busy}>{u.name}<small>{u.role}</small></Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
