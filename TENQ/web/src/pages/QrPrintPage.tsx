import { useMemo, useState } from 'react';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { QrCode, qrUrl } from '../components/QrCode';
import { Alert, Button, Loading, PageHeader, useLoad } from '../components/ui';
import { currentQuery } from '../router';

interface Label { id: string; equipment_code: string; name: string; location: string | null; area_name: string | null; token: string }

/** A4 1 枚あたりの面付け。サイズは印刷 CSS（styles/print.css）と合わせる */
const LAYOUTS = {
  standard: { label: '標準（3列×5段＝15枚、QR 約35mm）', perPage: 15 },
  large: { label: '大（2列×4段＝8枚、QR 約50mm）', perPage: 8 },
} as const;
type LayoutKey = keyof typeof LAYOUTS;

export function QrPrintPage() {
  const { me } = useAuth();
  const q = currentQuery();
  const [factory, setFactory] = useState(q.get('factory') ?? me?.factories[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set((q.get('ids') ?? '').split(',').filter(Boolean)));
  const [layout, setLayout] = useState<LayoutKey>('standard');
  const [copies, setCopies] = useState(1);
  const { data, error, loading } = useLoad(
    () => (factory ? apiGet<{ items: Label[] }>(`/qr-labels?factory=${encodeURIComponent(factory)}`) : Promise.resolve({ items: [] })), [factory]);
  const all = useMemo(() => data?.items ?? [], [data]);

  const labels = useMemo(() => all.filter((l) => selected.has(l.id)).flatMap((l) => Array.from({ length: copies }, () => l)), [all, selected, copies]);
  const pages = useMemo(() => {
    const per = LAYOUTS[layout].perPage;
    const out: Label[][] = [];
    for (let i = 0; i < labels.length; i += per) out.push(labels.slice(i, i + per));
    return out;
  }, [labels, layout]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const base = me?.settings.qr_base_url ?? '';

  return (
    <>
      <div className="no-print">
        <PageHeader title="QRラベル印刷" sub="印刷する設備を選び、A4 用紙に印刷します。ラベル用紙（ラミネート推奨）に印刷して、設備の見やすい場所に貼ってください。"
          actions={<Button variant="primary" disabled={!labels.length} onClick={() => window.print()}>印刷する（{labels.length}枚・{pages.length}ページ）</Button>} />
        {error && <Alert kind="error">{error}</Alert>}

        <div className="filters">
          {(me?.factories.length ?? 0) > 1 && (
            <select aria-label="工場" value={factory} onChange={(e) => { setFactory(e.target.value); setSelected(new Set()); }}>
              {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <select aria-label="面付け" value={layout} onChange={(e) => setLayout(e.target.value as LayoutKey)}>
            {Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <label className="inline">1台あたり
            <select aria-label="枚数" value={copies} onChange={(e) => setCopies(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}枚</option>)}
            </select>
          </label>
        </div>

        {loading ? <Loading /> : (
          <div className="panel">
            <div className="button-row">
              <Button onClick={() => setSelected(new Set(all.map((l) => l.id)))}>すべて選ぶ</Button>
              <Button onClick={() => setSelected(new Set())}>選択を外す</Button>
              <span className="muted small">{selected.size} / {all.length} 台を選択中</span>
            </div>
            <ul className="check-list">
              {all.map((l) => (
                <li key={l.id}>
                  <label className="check">
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    <span><b className="code">{l.equipment_code}</b> {l.name}<small>{l.area_name ?? l.location ?? ''}</small></span>
                  </label>
                </li>
              ))}
            </ul>
            {all.length === 0 && <p className="empty">印刷できる設備がありません。</p>}
          </div>
        )}
        {labels.length > 0 && <h2 className="section-title">印刷イメージ</h2>}
      </div>

      <div className={`sheets layout-${layout}`}>
        {pages.map((page, pi) => (
          <div className="sheet" key={pi}>
            {page.map((l, i) => (
              <div className="label" key={`${l.id}-${i}`}>
                <QrCode value={qrUrl(base, l.token)} size="100%" label={`${l.equipment_code} の QR コード`} />
                <div className="label-text">
                  <span className="label-brand">TENQ 日常点検</span>
                  <span className="label-code">{l.equipment_code}</span>
                  <span className="label-name">{l.name}</span>
                  {(l.area_name ?? l.location) && <span className="label-area">{l.area_name ?? l.location}</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
