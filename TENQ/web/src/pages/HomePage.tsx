import { useState } from 'react';
import { BOARD_STATUS_LABELS, type BoardStatus } from '@tenq/shared';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Loading, PageHeader, useLoad } from '../components/ui';
import { formatTime } from '../labels';
import { navigate } from '../router';

interface BoardItem {
  id: string; equipment_code: string; name: string; board_status: BoardStatus; manager_name: string | null; open_abnormalities: number;
  inspection: null | { id: string; inspector_name: string; completed_at: string | null; started_at: string };
}
interface Board { factory: { id: string; name: string }; date: string; workingDay: boolean; lateThreshold: string; items: BoardItem[]; counts: Partial<Record<BoardStatus, number>> }

/** 先に片付けるものから並べる */
const ORDER: BoardStatus[] = ['late', 'doing', 'todo', 'ng', 'ok', 'stop'];

/**
 * ホーム（S-02）。スマホでは「QR を読む」と今日の未点検の一覧。
 * PC のエリア別カード一覧は第6段階で追加する。
 */
export function HomePage() {
  const { me, can } = useAuth();
  const [factoryId, setFactoryId] = useState(me?.factories[0]?.id ?? '');
  const board = useLoad(() => (factoryId ? apiGet<Board>(`/board?factory=${encodeURIComponent(factoryId)}`) : Promise.resolve(null)), [factoryId]);
  const [showDone, setShowDone] = useState(false);
  if (!me) return null;

  const items = [...(board.data?.items ?? [])].sort((a, b) => ORDER.indexOf(a.board_status) - ORDER.indexOf(b.board_status) || a.equipment_code.localeCompare(b.equipment_code));
  const pending = items.filter((i) => ['late', 'doing', 'todo'].includes(i.board_status));
  const finished = items.filter((i) => ['ok', 'ng'].includes(i.board_status));
  const c = board.data?.counts ?? {};
  const target = items.filter((i) => i.board_status !== 'stop').length;

  return (
    <>
      <PageHeader title={`${me.user.name} さん`} sub={`${me.user.roleLabel ?? 'ロール未設定'}${board.data ? ` ・ ${board.data.factory.name} ・ ${board.data.date}` : ''}`} />
      {!me.user.role && <Alert kind="warn">TENQ のロール（一般社員・設備担当者など）がまだ設定されていません。システム管理者に設定を依頼してください。</Alert>}
      {me.user.role && me.factories.length === 0 && <Alert kind="warn">所属工場が設定されていません。システム管理者に設定を依頼してください。</Alert>}

      {me.factories.length > 0 && (
        <>
          <Button variant="primary" className="block big scan-button" onClick={() => navigate('/scan')}>QR を読み取って点検</Button>

          {me.factories.length > 1 && (
            <div className="filters">
              <select aria-label="工場" value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
                {me.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}

          {board.error && <Alert kind="error">{board.error}</Alert>}
          {board.loading && !board.data ? <Loading /> : board.data && (
            <>
              <div className="today-stats" aria-label="今日の点検状況">
                <div><b>{target}</b><span>対象</span></div>
                <div className="st-ok"><b>{(c.ok ?? 0) + (c.ng ?? 0)}</b><span>完了</span></div>
                <div className="st-late"><b>{(c.late ?? 0) + (c.todo ?? 0) + (c.doing ?? 0)}</b><span>未点検</span></div>
                <div className="st-ng"><b>{c.ng ?? 0}</b><span>異常あり</span></div>
              </div>
              {!board.data.workingDay && <Alert kind="info">今日は稼働日ではありません（毎日点検の設備は対象外です）。</Alert>}

              <h2 className="section-title">まだ終わっていない点検（{pending.length}）</h2>
              {pending.length === 0 ? <p className="empty">今日の点検はすべて終わりました。</p> : (
                <ul className="today-list">
                  {pending.map((i) => <TodayRow key={i.id} item={i} />)}
                </ul>
              )}

              <button type="button" className="link" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                {showDone ? '完了した点検を隠す' : `完了した点検を見る（${finished.length}）`}
              </button>
              {showDone && <ul className="today-list">{finished.map((i) => <TodayRow key={i.id} item={i} />)}</ul>}
            </>
          )}
        </>
      )}

      <div className="tiles">
        {can('equipment.view') && <a className="tile" href="#/equipment"><b>設備台帳</b><span>設備の一覧・詳細・点検の履歴</span></a>}
        {can('template.edit') && <a className="tile" href="#/templates"><b>点検基準</b><span>点検項目と判定基準（版の管理）</span></a>}
        {can('qr.issue') && <a className="tile" href="#/qr"><b>QRラベル印刷</b><span>A4 に面付けして印刷</span></a>}
      </div>
    </>
  );
}

function TodayRow({ item }: { item: BoardItem }) {
  const st = BOARD_STATUS_LABELS[item.board_status];
  const done = item.board_status === 'ok' || item.board_status === 'ng';
  const href = done && item.inspection ? `#/inspections/${item.inspection.id}` : `#/inspect/${item.id}`;
  return (
    <li>
      <a href={href} className={`today-row st-${item.board_status}`}>
        <span className="today-code">{item.equipment_code}</span>
        <span className="today-name">{item.name}
          <small>
            {item.inspection && (done ? `${formatTime(item.inspection.completed_at)} ${item.inspection.inspector_name}` : `${item.inspection.inspector_name} さんが点検中`)}
            {!item.inspection && item.manager_name && `担当: ${item.manager_name}`}
            {item.open_abnormalities > 0 && <span className="abn-flag">未対応の異常 {item.open_abnormalities}</span>}
          </small>
        </span>
        <span className={`badge st-${item.board_status}`}>{st.short}</span>
      </a>
    </li>
  );
}
