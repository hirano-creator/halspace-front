import { lazy, Suspense, useState } from 'react';
import { simpleStatus, type BoardStatus } from '@tenq/shared';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Loading, useLoad } from '../components/ui';
import { navigate } from '../router';

const BoardPage = lazy(() => import('./BoardPage').then((m) => ({ default: m.BoardPage })));

interface BoardItem { id: string; equipment_code: string; name: string; board_status: BoardStatus; open_abnormalities: number }
interface Board { factory: { id: string; name: string }; date: string; workingDay: boolean; items: BoardItem[] }

/**
 * ホーム（2026-10-31 簡単化。requirements §10 Q-15）。
 * 一般社員 = 「QR を読む」の大きなボタンと「あと N 台」だけ。それ以外のロール = 工場の見取り図（BoardPage）。
 */
export function HomePage() {
  const { me } = useAuth();
  if (!me) return null;
  if (!me.user.role) return <Alert kind="warn">TENQ のロール（一般社員・設備担当者など）がまだ設定されていません。システム管理者に設定を依頼してください。</Alert>;
  if (me.factories.length === 0) return <Alert kind="warn">所属工場が設定されていません。システム管理者に設定を依頼してください。</Alert>;
  if (me.user.role !== 'worker') return <Suspense fallback={<Loading />}><BoardPage /></Suspense>;
  return <WorkerHome />;
}

function WorkerHome() {
  const { me } = useAuth();
  const [factoryId, setFactoryId] = useState(me?.factories[0]?.id ?? '');
  const board = useLoad(() => apiGet<Board>(`/board?factory=${encodeURIComponent(factoryId)}`), [factoryId]);
  const [showLeft, setShowLeft] = useState(false);
  if (!me) return null;
  const left = (board.data?.items ?? []).filter((i) => simpleStatus(i.board_status, i.open_abnormalities) === 'todo')
    .sort((a, b) => a.equipment_code.localeCompare(b.equipment_code));

  return (
    <div className="worker-home">
      <p className="worker-hello">{me.user.name} さん{board.data && <> ・ {board.data.factory.name} ・ {board.data.date}</>}</p>
      {me.factories.length > 1 && (
        <select aria-label="工場" value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
          {me.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      <button type="button" className="scan-big" onClick={() => navigate('/scan')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" /></svg>
        <span>QR を読む</span>
        <small>設備に貼ってある QR にカメラを向けます</small>
      </button>

      {board.error && <Alert kind="error">{board.error}</Alert>}
      {board.data && (
        <div className="worker-left">
          {left.length === 0 ? <p>{board.data.workingDay ? <><b className="all-done">○</b>今日の点検はぜんぶ終わりました</> : '今日は稼働日ではありません'}</p> : (
            <>
              <p>今日の点検 あと<b>{left.length}</b>台</p>
              <button type="button" className="link" aria-expanded={showLeft} onClick={() => setShowLeft((s) => !s)}>{showLeft ? '閉じる' : 'まだの設備を見る'}</button>
              {showLeft && (
                <ul className="left-list">
                  {left.map((i) => <li key={i.id}><a href={`#/inspect/${i.id}`}><b>{i.equipment_code}</b> {i.name}</a></li>)}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
