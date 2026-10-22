import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Loading, PageHeader, errorMessage } from '../components/ui';
import { EQUIPMENT_STATUS, FREQUENCY } from '../labels';
import { currentQuery, navigate } from '../router';

interface Row {
  id: string; factory_name: string; equipment_code: string; name: string; location: string | null; category: string | null;
  status: string; frequency: string; area_name: string | null; manager_name: string | null;
}

export function EquipmentListPage() {
  const { me, can } = useAuth();
  const q0 = currentQuery();
  const [factory, setFactory] = useState(q0.get('factory') ?? '');
  const [status, setStatus] = useState(q0.get('status') ?? '');
  const [keyword, setKeyword] = useState(q0.get('q') ?? '');
  const [items, setItems] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = (c?: string | null) => {
    const p = new URLSearchParams({ limit: '50' });
    if (factory) p.set('factory', factory);
    if (status) p.set('status', status);
    if (keyword.trim()) p.set('q', keyword.trim());
    if (c) p.set('cursor', c);
    return p.toString();
  };

  async function load(more = false) {
    setLoading(true);
    try {
      const r = await apiGet<{ items: Row[]; nextCursor: string | null }>(`/equipment?${params(more ? cursor : null)}`);
      setItems((prev) => (more ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // 絞り込みが変わったら読み直す（キーワードは入力が止まってから）
  useEffect(() => {
    const t = setTimeout(() => void load(false), keyword ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factory, status, keyword]);

  const showFactory = (me?.factories.length ?? 0) > 1;

  return (
    <>
      <PageHeader title="設備台帳" sub="設備の一覧です。行を押すと詳細と QR コードを開きます。"
        actions={can('equipment.create') && <Button variant="primary" onClick={() => navigate('/equipment/new')}>設備を登録</Button>} />

      <div className="filters">
        {showFactory && (
          <select aria-label="工場" value={factory} onChange={(e) => setFactory(e.target.value)}>
            <option value="">すべての工場</option>
            {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <select aria-label="使用状態" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">稼働・停止中</option>
          <option value="active">稼働のみ</option>
          <option value="stopped">停止中のみ</option>
          <option value="retired">廃止のみ</option>
          <option value="all">すべて（廃止を含む）</option>
        </select>
        <input type="search" aria-label="キーワード" placeholder="設備番号・設備名・設置場所" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>設備番号</th><th>設備名</th>{showFactory && <th>工場</th>}<th className="hide-sm">エリア・設置場所</th><th className="hide-sm">分類</th><th className="hide-sm">点検頻度</th><th className="hide-sm">管理担当</th><th>状態</th></tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="row-link" tabIndex={0} onClick={() => navigate(`/equipment/${e.id}`)} onKeyDown={(ev) => { if (ev.key === 'Enter') navigate(`/equipment/${e.id}`); }}>
                <td className="code">{e.equipment_code}</td>
                <td><a href={`#/equipment/${e.id}`} onClick={(ev) => ev.stopPropagation()}>{e.name}</a></td>
                {showFactory && <td>{e.factory_name}</td>}
                <td className="hide-sm">{e.area_name ?? <span className="muted">未配置</span>}{e.location && <small className="block muted">{e.location}</small>}</td>
                <td className="hide-sm">{e.category ?? '—'}</td>
                <td className="hide-sm">{FREQUENCY[e.frequency] ?? e.frequency}</td>
                <td className="hide-sm">{e.manager_name ?? '—'}</td>
                <td><span className={`badge ${EQUIPMENT_STATUS[e.status]?.cls ?? ''}`}>{EQUIPMENT_STATUS[e.status]?.label ?? e.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && !error && <p className="empty">該当する設備はありません。</p>}
      </div>
      {loading && <Loading />}
      {cursor && !loading && <div className="more"><Button onClick={() => void load(true)}>さらに読み込む</Button></div>}
    </>
  );
}
