import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet, apiSend, apiUpload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { shrinkPhoto } from '../components/Photo';
import { Alert, Button, Loading, ReasonDialog, errorMessage, useLoad } from '../components/ui';
import { JUDGMENT, formatTime } from '../labels';
import { navigate } from '../router';

/**
 * 設備点検（S-03）と点検完了（S-04）。QR を読むとここに来る。
 * 2026-10-31 簡単化（requirements §10 Q-15）: 項目ごとに ○ / ✕ を押し、✕ なら一言と写真（任意）、最後に「送る」。
 * ✕ の項目は API がそのまま異常として登録する（別の画面で報告し直さない）。写真は送ったあと、その異常に付ける。
 * 点検の開始は最初の項目を選んだとき（開いただけでは「点検中」を作らない）。
 * 入力途中は sessionStorage に置き、読み込み直しても消えないようにする（写真は残らない）。
 */

type Judgment = 'ok' | 'ng' | 'na';
interface Item { id: string; sort_order: number; group_label: string | null; label: string; criteria: string | null; required: number; allow_na: number }
interface Today {
  equipment: { id: string; equipment_code: string; name: string; status: string; frequency: string; factory_id: string };
  date: string; periodKey: string; isDue: boolean; canPerform: boolean;
  inspection: null | { id: string; status: 'in_progress' | 'completed'; inspector_name: string; started_at: string; completed_at: string | null; overall_result: 'ok' | 'ng' | null; mine: boolean };
  items: Item[];
  results: { item_id: string; judgment: Judgment; note: string | null }[];
}
interface Answer { judgment: Judgment; note: string }
interface Linked { item_id: string; id: string }

const draftKey = (eqId: string, period: string) => `tenq_draft_${eqId}_${period}`;
const idemKey = (inspectionId: string) => `tenq_complete_${inspectionId}`;

function readDraft(key: string): Record<string, Answer> {
  try { return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, Answer>; } catch { return {}; }
}
function writeDraft(key: string, v: Record<string, Answer> | null): void {
  try { if (v) sessionStorage.setItem(key, JSON.stringify(v)); else sessionStorage.removeItem(key); } catch { /* 何もしない */ }
}
/** 完了の冪等キー。通信に失敗して押し直しても同じキーを送る */
function completionKey(inspectionId: string): string {
  try {
    const k = sessionStorage.getItem(idemKey(inspectionId));
    if (k) return k;
    const n = crypto.randomUUID();
    sessionStorage.setItem(idemKey(inspectionId), n);
    return n;
  } catch { return crypto.randomUUID(); }
}

export function InspectPage({ equipmentId }: { equipmentId: string }) {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => apiGet<Today>(`/equipment/${encodeURIComponent(equipmentId)}/today`), [equipmentId]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'warn'; text: string } | null>(null);
  const [other, setOther] = useState<{ name: string; startedAt: string } | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ overall: 'ok' | 'ng'; ng: number; abnormalities: Linked[] } | null>(null);
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [upload, setUpload] = useState<{ state: 'sending' | 'done' | 'failed'; failed: number } | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);

  const dkey = data ? draftKey(data.equipment.id, data.periodKey) : null;

  // 読み込んだら、入力途中の内容を戻す
  if (data && dkey && loadedKey !== dkey) {
    setLoadedKey(dkey);
    setAnswers(readDraft(dkey));
    setInspectionId(data.inspection?.status === 'in_progress' && data.inspection.mine ? data.inspection.id : null);
    setOther(data.inspection?.status === 'in_progress' && !data.inspection.mine ? { name: data.inspection.inspector_name, startedAt: data.inspection.started_at } : null);
  }
  useEffect(() => { if (dkey && loadedKey === dkey) writeDraft(dkey, answers); }, [answers, dkey, loadedKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const remaining = items.filter((i) => i.required && !answers[i.id]).length;

  async function ensureStarted(takeover = false): Promise<string | null> {
    if (inspectionId && !takeover) return inspectionId;
    try {
      const r = await apiSend<{ inspectionId: string }>('POST', `/equipment/${equipmentId}/inspections`, takeover ? { takeover: true } : {});
      setInspectionId(r.inspectionId);
      setOther(null);
      return r.inspectionId;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({ kind: 'warn', text: e.message });
        reload();
        setLoadedKey(null);
      } else setMessage({ kind: 'error', text: errorMessage(e) });
      return null;
    }
  }

  async function choose(item: Item, judgment: Judgment) {
    setMessage(null);
    if (!inspectionId) {
      setBusy(true);
      const id = await ensureStarted();
      setBusy(false);
      if (!id) return;
    }
    setAnswers((a) => ({ ...a, [item.id]: { judgment, note: a[item.id]?.note ?? '' } }));
    setItemErrors((e) => { const n = { ...e }; delete n[`item.${item.id}`]; return n; });
  }

  async function complete() {
    if (!inspectionId || !dkey) return;
    setBusy(true); setMessage(null);
    try {
      const results = items.filter((i) => answers[i.id]).map((i) => ({ item_id: i.id, judgment: answers[i.id]!.judgment, note: answers[i.id]!.note.trim() || null }));
      const r = await apiSend<{ overall_result: 'ok' | 'ng'; abnormalities?: Linked[] }>('POST', `/inspections/${inspectionId}/complete`, { results },
        { 'Idempotency-Key': completionKey(inspectionId) });
      writeDraft(dkey, null);
      const abnormalities = r.abnormalities ?? [];
      setDone({ overall: r.overall_result, ng: results.filter((x) => x.judgment === 'ng').length, abnormalities });
      window.scrollTo(0, 0);
      void sendPhotos(abnormalities, photos);
    } catch (e) {
      // 通信できなかったときも、同じ冪等キーで押し直せば二重には記録されない
      setMessage({ kind: 'error', text: e instanceof ApiError && e.status === 0 ? '通信できませんでした。電波の届く場所で、もう一度「送る」を押してください（二重には記録されません）。' : errorMessage(e) });
      if (e instanceof ApiError) setItemErrors(e.errors);
    } finally {
      setBusy(false);
    }
  }

  /** ✕ の項目の写真を、登録された異常に付ける。送れなかったものは残して、押し直せるようにする */
  async function sendPhotos(abnormalities: Linked[], pending: Record<string, File[]>) {
    const jobs = abnormalities.flatMap((a) => (pending[a.item_id] ?? []).map((f) => ({ ...a, f })));
    if (!jobs.length) return;
    setUpload({ state: 'sending', failed: 0 });
    const left: Record<string, File[]> = {};
    for (const j of jobs) {
      try { await apiUpload(`/attachments?owner_type=abnormality&owner_id=${encodeURIComponent(j.id)}`, await shrinkPhoto(j.f), j.f.name); }
      catch { left[j.item_id] = [...(left[j.item_id] ?? []), j.f]; }
    }
    const failed = Object.values(left).flat().length;
    setPhotos(left);
    setUpload({ state: failed ? 'failed' : 'done', failed });
  }

  if (loading && !data) return <Loading label="点検表を開いています…" />;
  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data || !me) return null;
  const eq = data.equipment;

  // ===== 送ったあと（S-04） =====
  if (done) {
    return (
      <div className="done">
        <div className={`done-mark ${done.overall === 'ng' ? 'is-ng' : ''}`} aria-hidden="true">{done.overall === 'ng' ? '!' : '○'}</div>
        <h1>送りました</h1>
        <p className="muted">{eq.equipment_code} {eq.name}<br />{data.date} ・ {me.user.name}</p>
        {done.overall === 'ng' && (
          <Alert kind="error">✕ が {done.ng} 件あります。管理者の画面に赤く出ています。危ないときは設備を止めて、責任者に連絡してください。</Alert>
        )}
        {upload?.state === 'sending' && <Alert kind="info">写真を送っています…</Alert>}
        {upload?.state === 'done' && <Alert kind="success">写真も送りました。</Alert>}
        {upload?.state === 'failed' && (
          <Alert kind="warn">
            写真 {upload.failed} 枚を送れませんでした。電波の届く場所で、もう一度送ってください。
            <div className="button-row" style={{ marginTop: 8 }}><Button onClick={() => void sendPhotos(done.abnormalities, photos)}>写真をもう一度送る</Button></div>
          </Alert>
        )}
        <div className="done-actions">
          <Button variant="primary" className="block big" onClick={() => navigate('/scan')}>次の設備の QR を読む</Button>
          <Button className="block" onClick={() => navigate('/')}>ホームへ</Button>
        </div>
      </div>
    );
  }

  const header = (
    <div className="inspect-head">
      <div className="muted small">{eq.equipment_code} ・ {data.date}</div>
      <h1>{eq.name}</h1>
    </div>
  );

  if (eq.status !== 'active') return <>{header}<Alert kind="warn">この設備は{eq.status === 'stopped' ? '停止中' : '廃止'}のため、点検の対象外です。</Alert><Button onClick={() => navigate('/')}>ホームへ</Button></>;
  if (!items.length) return <>{header}<Alert kind="warn">この設備には点検基準が設定されていません。設備担当者または工場長に設定を依頼してください。</Alert></>;

  // ===== 今日の点検が済んでいる =====
  if (data.inspection?.status === 'completed') {
    const byItem = new Map(data.results.map((r) => [r.item_id, r]));
    return (
      <>
        {header}
        <Alert kind={data.inspection.overall_result === 'ng' ? 'error' : 'success'}>
          今回の点検は {data.inspection.inspector_name} さんが {formatTime(data.inspection.completed_at)} に完了しています（{data.inspection.overall_result === 'ng' ? '✕ あり' : 'ぜんぶ ○'}）。
        </Alert>
        <ul className="result-list">
          {items.map((i) => {
            const r = byItem.get(i.id);
            const j = r ? JUDGMENT[r.judgment] : null;
            return (
              <li key={i.id}>
                <span>{i.label}</span>
                {r && j ? <span className={`badge ${j.cls}`}>{r.judgment === 'ok' ? '○ ' : r.judgment === 'ng' ? '✕ ' : ''}{j.label}</span> : <span className="muted">—</span>}
                {r?.note && <small className="block muted">{r.note}</small>}
              </li>
            );
          })}
        </ul>
        <Button variant="primary" className="block big" onClick={() => navigate('/scan')}>次の設備の QR を読む</Button>
      </>
    );
  }

  if (!data.canPerform) return <>{header}<Alert kind="error">この設備を点検する権限がありません。</Alert></>;

  // ===== 点検表 =====
  return (
    <div className="inspect">
      {header}
      {!data.isDue && <Alert kind="info">今日は稼働日ではないため、点検の対象外です。点検した場合は記録として残ります。</Alert>}
      {other && (
        <Alert kind="warn">
          {other.name} さんが点検中です（{formatTime(other.startedAt)} 開始）。同じ設備を二重に点検しないよう、声をかけてください。
          <div className="button-row" style={{ marginTop: 8 }}>
            <Button onClick={() => { setBusy(true); void ensureStarted(true).finally(() => setBusy(false)); }} disabled={busy}>引き継いで点検する</Button>
            <Button onClick={() => navigate('/')}>やめる</Button>
          </div>
        </Alert>
      )}
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      {!other && (
        <>
          <ol className="ox-list">
            {items.map((it) => {
              const a = answers[it.id];
              const err = itemErrors[`item.${it.id}`];
              const pics = photos[it.id] ?? [];
              return (
                <li key={it.id} className={`ox-item ${a ? `ans-${a.judgment}` : ''} ${err ? 'has-error' : ''}`}>
                  <div className="ox-row">
                    <span className="ox-label">{it.label}{!it.required && <span className="opt">任意</span>}{it.criteria && <small>{it.criteria}</small>}</span>
                    <span className="ox" role="group" aria-label={`${it.label} の判定`}>
                      <button type="button" className={`o ${a?.judgment === 'ok' ? 'on' : ''}`} aria-pressed={a?.judgment === 'ok'} disabled={busy} onClick={() => void choose(it, 'ok')} aria-label="○ 正常">○</button>
                      <button type="button" className={`x ${a?.judgment === 'ng' ? 'on' : ''}`} aria-pressed={a?.judgment === 'ng'} disabled={busy} onClick={() => void choose(it, 'ng')} aria-label="✕ 異常">✕</button>
                    </span>
                  </div>
                  {!!it.allow_na && (
                    <button type="button" className={`na ${a?.judgment === 'na' ? 'on' : ''}`} aria-pressed={a?.judgment === 'na'} disabled={busy} onClick={() => void choose(it, 'na')}>
                      {a?.judgment === 'na' ? '対象外にしました' : '今日は対象外'}
                    </button>
                  )}
                  {a?.judgment === 'ng' && (
                    <div className="memo">
                      <input type="text" maxLength={200} value={a.note} aria-label={`${it.label} の異常の内容`} placeholder="どこが・どうなっているか（一言）"
                        onChange={(e) => setAnswers((x) => ({ ...x, [it.id]: { judgment: 'ng', note: e.target.value } }))} />
                      <label className="memo-photo">
                        {pics.length ? `写真 ${pics.length}` : '＋ 写真'}
                        <input type="file" accept="image/*" capture="environment" multiple
                          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; setPhotos((p) => ({ ...p, [it.id]: [...(p[it.id] ?? []), ...fs].slice(0, 5) })); }} />
                      </label>
                    </div>
                  )}
                  {err && <p className="field-error">{err}</p>}
                </li>
              );
            })}
          </ol>

          {inspectionId && <button type="button" className="link" onClick={() => setVoidOpen(true)}>この点検をやめる（取り消す）</button>}

          <div className="sticky-action">
            <Button variant="primary" className="block big" disabled={busy || remaining > 0 || !inspectionId} onClick={() => void complete()}>
              {busy ? '送っています…' : remaining > 0 ? `あと ${remaining} 項目` : '送る'}
            </Button>
          </div>
        </>
      )}

      <ReasonDialog open={voidOpen} title="点検をやめる" confirmLabel="取り消す" message="この点検を取り消します（記録は「取消」として残ります）。もう一度最初から点検できます。"
        onClose={() => setVoidOpen(false)}
        onConfirm={async (reason) => {
          if (!inspectionId || !dkey) return;
          await apiSend('POST', `/inspections/${inspectionId}/void`, { reason });
          writeDraft(dkey, null);
          setAnswers({}); setPhotos({}); setInspectionId(null); setLoadedKey(null); reload();
        }} />
    </div>
  );
}
