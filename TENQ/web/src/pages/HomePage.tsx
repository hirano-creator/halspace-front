import { useAuth } from '../auth/AuthContext';
import { Alert, PageHeader } from '../components/ui';

/**
 * ホーム。第3段階では入口だけ。
 * 今日の点検状況（スマホ）とエリア別カード一覧（PC）は第4〜6段階で追加する。
 */
export function HomePage() {
  const { me, can } = useAuth();
  if (!me) return null;
  const factories = me.factories.map((f) => f.name).join('・');

  return (
    <>
      <PageHeader title={`${me.user.name} さん`} sub={`${me.user.roleLabel ?? 'ロール未設定'}${factories ? ` ・ ${factories}` : ''}`} />
      {!me.user.role && (
        <Alert kind="warn">TENQ のロール（一般社員・設備担当者など）がまだ設定されていません。システム管理者に設定を依頼してください。</Alert>
      )}
      {me.user.role && me.factories.length === 0 && (
        <Alert kind="warn">所属工場が設定されていません。システム管理者に設定を依頼してください。</Alert>
      )}
      {me.via === 'device' && <p className="muted small">この端末に記憶したログインで入っています。</p>}

      <div className="tiles">
        <div className="tile tile-disabled" aria-disabled="true">
          <b>QRを読み取って点検</b>
          <span>点検画面は次の段階（第4段階）で追加します。設備の QR ラベルを読むと、今は設備の詳細が開きます。</span>
        </div>
        {can('equipment.view') && <a className="tile" href="#/equipment"><b>設備台帳</b><span>設備の一覧・詳細・QR コード</span></a>}
        {can('qr.issue') && <a className="tile" href="#/qr"><b>QRラベル印刷</b><span>A4 に面付けして印刷</span></a>}
        {can('layout.edit') && <a className="tile" href="#/admin/factories"><b>工場・エリア</b><span>カード一覧の枠（エリア）を作る</span></a>}
        {can('users.manage') && <a className="tile" href="#/admin/users"><b>ユーザー管理</b><span>ロール・所属工場・利用停止</span></a>}
      </div>
    </>
  );
}
